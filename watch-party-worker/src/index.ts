import { DurableObject } from "cloudflare:workers";

type Role = "host" | "member";
type Claims = { roomCode: string; userId: string; displayName: string; role: Role; exp: number };
type RoomMedia = { mediaId: string; title: string; episodeTitle?: string; providerId?: string; sourceFingerprint: string };
type RoomRecord = { code: string; hostUserId: string; status: "open" | "closed"; media: RoomMedia; createdAt: number; expiresAt: number };
type ClientState = { userId: string; displayName: string; role: Role; mediaCompatible: boolean };
type Env = { WATCH_PARTY_ROOMS: DurableObjectNamespace<WatchPartyRoom>; SESSION_SECRET: string; ALLOWED_ORIGINS?: string };

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const cors = (response: Response, origin: string | null, env: Env) => {
  const allowed = (env.ALLOWED_ORIGINS ?? "*").split(",").map(s => s.trim());
  const headers = new Headers(response.headers);
  if (origin && (allowed.includes("*") || allowed.includes(origin))) {
    headers.set("access-control-allow-origin", allowed.includes("*") ? "*" : origin);
    headers.set("vary", "Origin");
  }
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,authorization");
  return new Response(response.body, { status: response.status, headers });
};
const validText = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
const randomCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
};
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
async function sign(claims: Claims, secret: string) {
  const payload = encode(claims);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return payload + "." + base64url(signature);
}
export async function verifyToken(token: string, secret: string): Promise<Claims | null> {
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sig = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - signature.length % 4) % 4)), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(payload));
    if (!valid) return null;
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - payload.length % 4) % 4))) as Claims;
    return claims.exp > Date.now() && claims.roomCode && claims.userId ? claims : null;
  } catch { return null; }
}
function makeClaims(roomCode: string, userId: string, displayName: string, role: Role): Claims {
  return { roomCode, userId, displayName, role, exp: Date.now() + 12 * 60 * 60 * 1000 };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), origin, env);
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return cors(json({ error: "backend_not_configured" }, 503), origin, env);

    if (url.pathname === "/health" && request.method === "GET") return cors(json({ ok: true, service: "animeplex-watch-party" }), origin, env);

    if (url.pathname === "/rooms" && request.method === "POST") {
      let body: any;
      try { body = await request.json(); } catch { return cors(json({ error: "invalid_json" }, 400), origin, env); }
      if (!validText(body.displayName, 32) || !validText(body.media?.mediaId, 200) || !validText(body.media?.title, 200) || !validText(body.media?.sourceFingerprint, 200)) {
        return cors(json({ error: "displayName_and_media_identity_required" }, 400), origin, env);
      }
      let code = "";
      let stub: DurableObjectStub<WatchPartyRoom> | undefined;
      for (let i = 0; i < 4; i++) {
        code = randomCode();
        stub = env.WATCH_PARTY_ROOMS.getByName(code);
        const result = await stub.fetch("https://room.internal/internal/create", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, media: body.media, hostUserId: crypto.randomUUID() })
        });
        if (result.status === 201) break;
        stub = undefined;
      }
      if (!stub) return cors(json({ error: "room_creation_failed" }, 503), origin, env);
      const userId = crypto.randomUUID();
      // Initialize host identity on the room record before returning a signed token.
      await stub.fetch("https://room.internal/internal/set-host", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId }) });
      const hostToken = await sign(makeClaims(code, userId, body.displayName.trim(), "host"), env.SESSION_SECRET);
      return cors(json({ code, token: hostToken, websocketUrl: url.origin.replace(/^http/, "ws") + "/rooms/" + code + "/ws", expiresInSeconds: 43200 }), origin, env);
    }

    const joinMatch = url.pathname.match(/^\/rooms\/([A-HJ-NP-Z2-9]{6})\/join$/);
    if (joinMatch && request.method === "POST") {
      let body: any;
      try { body = await request.json(); } catch { return cors(json({ error: "invalid_json" }, 400), origin, env); }
      if (!validText(body.displayName, 32) || !validText(body.media?.mediaId, 200) || !validText(body.media?.sourceFingerprint, 200)) return cors(json({ error: "displayName_and_media_identity_required" }, 400), origin, env);
      const code = joinMatch[1];
      const stub = env.WATCH_PARTY_ROOMS.getByName(code);
      const infoResponse = await stub.fetch("https://room.internal/internal/info");
      if (!infoResponse.ok) return cors(json({ error: "room_not_found_or_closed" }, 404), origin, env);
      const info = await infoResponse.json() as { room: RoomRecord; memberCount: number };
      if (info.room.expiresAt <= Date.now() || info.room.status !== "open") return cors(json({ error: "room_expired_or_closed" }, 410), origin, env);
      const userId = crypto.randomUUID();
      const token = await sign(makeClaims(code, userId, body.displayName.trim(), "member"), env.SESSION_SECRET);
      const compatible = body.media.mediaId === info.room.media.mediaId && body.media.sourceFingerprint === info.room.media.sourceFingerprint;
      return cors(json({ code, token, websocketUrl: url.origin.replace(/^http/, "ws") + "/rooms/" + code + "/ws", room: info.room, mediaCompatible: compatible, memberCount: info.memberCount }), origin, env);
    }

    const wsMatch = url.pathname.match(/^\/rooms\/([A-HJ-NP-Z2-9]{6})\/ws$/);
    if (wsMatch) {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return cors(json({ error: "websocket_upgrade_required" }, 426), origin, env);
      const token = url.searchParams.get("token") ?? "";
      const claims = await verifyToken(token, env.SESSION_SECRET);
      if (!claims || claims.roomCode !== wsMatch[1]) return cors(json({ error: "unauthorized" }, 401), origin, env);
      const stub = env.WATCH_PARTY_ROOMS.getByName(wsMatch[1]);
      const forwarded = new Request(request, { headers: new Headers(request.headers) });
      forwarded.headers.set("x-watch-party-claims", encode(claims));
      return stub.fetch(forwarded);
    }

    return cors(json({ error: "not_found" }, 404), origin, env);
  }
};

export class WatchPartyRoom extends DurableObject<Env> {
  private env: Env;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/internal/create" && request.method === "POST") {
      const existing = await this.ctx.storage.get<RoomRecord>("room");
      if (existing && existing.expiresAt > Date.now() && existing.status === "open") return json({ error: "collision" }, 409);
      const input = await request.json() as { code: string; media: RoomMedia; hostUserId: string };
      const room: RoomRecord = { code: input.code, hostUserId: input.hostUserId, status: "open", media: input.media, createdAt: Date.now(), expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
      await this.ctx.storage.put("room", room);
      await this.ctx.storage.put("chat", []);
      await this.ctx.storage.setAlarm(room.expiresAt);
      return json({ ok: true }, 201);
    }
    if (url.pathname === "/internal/set-host" && request.method === "POST") {
      const room = await this.ctx.storage.get<RoomRecord>("room");
      if (!room) return json({ error: "not_found" }, 404);
      const input = await request.json() as { userId: string };
      room.hostUserId = input.userId;
      await this.ctx.storage.put("room", room);
      return json({ ok: true });
    }
    if (url.pathname === "/internal/info" && request.method === "GET") {
      const room = await this.ctx.storage.get<RoomRecord>("room");
      if (!room || room.status !== "open" || room.expiresAt <= Date.now()) return json({ error: "not_found" }, 404);
      return json({ room, memberCount: this.ctx.getWebSockets().length });
    }
    if (url.pathname === "/internal/close" && request.method === "POST") {
      const room = await this.ctx.storage.get<RoomRecord>("room");
      if (room) { room.status = "closed"; await this.ctx.storage.put("room", room); this.broadcast({ type: "room_closed" }); }
      return json({ ok: true });
    }

    const claimsEncoded = request.headers.get("x-watch-party-claims");
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket" || !claimsEncoded) return json({ error: "not_found" }, 404);
    let claims: Claims;
    try {
      claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(claimsEncoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - claimsEncoded.length % 4) % 4)), c => c.charCodeAt(0))) as Claims;
    } catch { return json({ error: "unauthorized" }, 401); }
    const room = await this.ctx.storage.get<RoomRecord>("room");
    if (!room || room.status !== "open" || room.expiresAt <= Date.now() || room.code !== claims.roomCode) return json({ error: "room_not_available" }, 410);
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    const clientState: ClientState = { userId: claims.userId, displayName: claims.displayName, role: claims.role, mediaCompatible: true };
    server.serializeAttachment(clientState);
    server.send(JSON.stringify({ type: "welcome", room, members: this.members(), chat: await this.ctx.storage.get("chat") ?? [], playback: await this.ctx.storage.get("playback") ?? null }));
    this.broadcast({ type: "members", members: this.members() });
    return new Response(null, { status: 101, webSocket: client });
  }

  private members() {
    return this.ctx.getWebSockets().map(ws => {
      const state = ws.deserializeAttachment() as ClientState | null;
      return state ? { userId: state.userId, displayName: state.displayName, role: state.role, mediaCompatible: state.mediaCompatible } : null;
    }).filter(Boolean);
  }
  private broadcast(value: unknown) {
    const payload = JSON.stringify(value);
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(payload); } catch {} }
  }
  private sendError(ws: WebSocket, code: string) { try { ws.send(JSON.stringify({ type: "error", code })); } catch {} }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 5000) return this.sendError(ws, "invalid_message");
    let data: any;
    try { data = JSON.parse(message); } catch { return this.sendError(ws, "invalid_json"); }
    const state = ws.deserializeAttachment() as ClientState | null;
    if (!state || !validText(data.type, 40)) return this.sendError(ws, "invalid_message");
    const room = await this.ctx.storage.get<RoomRecord>("room");
    if (!room || room.status !== "open" || room.expiresAt <= Date.now()) return this.sendError(ws, "room_closed");
    if (data.type === "chat") {
      if (!validText(data.text, 500)) return this.sendError(ws, "chat_length");
      const now = Date.now();
      const last = await this.ctx.storage.get<number>("chat-rate:" + state.userId) ?? 0;
      if (now - last < 700) return this.sendError(ws, "rate_limited");
      await this.ctx.storage.put("chat-rate:" + state.userId, now);
      const chat = await this.ctx.storage.get<any[]>("chat") ?? [];
      const item = { id: crypto.randomUUID(), roomId: room.code, userId: state.userId, displayName: state.displayName, text: data.text.trim(), createdAt: new Date(now).toISOString() };
      chat.push(item);
      await this.ctx.storage.put("chat", chat.slice(-100));
      this.broadcast({ type: "chat", message: item });
      return;
    }
    if (data.type === "media_compatibility") {
      state.mediaCompatible = data.mediaId === room.media.mediaId && data.sourceFingerprint === room.media.sourceFingerprint;
      ws.serializeAttachment(state);
      this.broadcast({ type: "members", members: this.members() });
      return;
    }
    if (data.type === "playback") {
      if (state.role !== "host" || room.hostUserId !== state.userId) return this.sendError(ws, "host_only");
      if (!["play", "pause", "seek", "state", "media_changed"].includes(data.action) || !Number.isFinite(data.positionSeconds) || data.positionSeconds < 0) return this.sendError(ws, "invalid_playback");
      const sequence = (await this.ctx.storage.get<number>("playback-sequence") ?? 0) + 1;
      await this.ctx.storage.put("playback-sequence", sequence);
      const playback = { roomId: room.code, sequence, action: data.action, positionSeconds: data.positionSeconds, playing: Boolean(data.playing), mediaId: room.media.mediaId, sourceFingerprint: room.media.sourceFingerprint, hostTimestamp: Date.now() };
      await this.ctx.storage.put("playback", playback);
      this.broadcast({ type: "playback", state: playback });
      return;
    }
    if (data.type === "transfer_host") {
      if (state.role !== "host" || room.hostUserId !== state.userId || !validText(data.userId, 100)) return this.sendError(ws, "host_only");
      const target = this.ctx.getWebSockets().find(s => (s.deserializeAttachment() as ClientState | null)?.userId === data.userId);
      if (!target) return this.sendError(ws, "member_not_found");
      const targetState = target.deserializeAttachment() as ClientState;
      targetState.role = "host";
      ws.serializeAttachment({ ...state, role: "member" });
      target.serializeAttachment(targetState);
      room.hostUserId = targetState.userId;
      await this.ctx.storage.put("room", room);
      this.broadcast({ type: "members", members: this.members() });
      return;
    }
    if (data.type === "close_room") {
      if (state.role !== "host" || room.hostUserId !== state.userId) return this.sendError(ws, "host_only");
      room.status = "closed";
      await this.ctx.storage.put("room", room);
      this.broadcast({ type: "room_closed" });
      for (const client of this.ctx.getWebSockets()) { try { client.close(1000, "Room closed by host"); } catch {} }
      return;
    }
    if (data.type === "ping") { try { ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() })); } catch {} return; }
    this.sendError(ws, "unsupported_event");
  }

  async webSocketClose() { this.broadcast({ type: "members", members: this.members() }); }
  async webSocketError() { this.broadcast({ type: "members", members: this.members() }); }
  async alarm() {
    const room = await this.ctx.storage.get<RoomRecord>("room");
    if (room && room.expiresAt <= Date.now()) {
      room.status = "closed";
      await this.ctx.storage.put("room", room);
      this.broadcast({ type: "room_expired" });
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, "Room expired"); } catch {} }
    }
  }
}