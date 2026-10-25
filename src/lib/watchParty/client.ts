import type {
  WatchPartyChatMessage,
  WatchPartyMedia,
  WatchPartyPlaybackState,
  WatchPartyRoom,
  WatchPartyMember,
} from "./types";

const baseUrl = () => {
  const value = process.env.EXPO_PUBLIC_WATCH_PARTY_URL?.trim();
  if (!value) throw new Error("Watch Party backend is not configured. Set EXPO_PUBLIC_WATCH_PARTY_URL.");
  return value.replace(/\/$/, "");
};

type RoomCredentials = {
  code: string;
  token: string;
  websocketUrl: string;
  expiresInSeconds: number;
};
export type CreateRoomResponse = RoomCredentials;
export type JoinRoomResponse = RoomCredentials & {
  room: WatchPartyRoom;
  mediaCompatible: boolean;
  memberCount: number;
};
export type WatchPartyEvent =
  | { type: "welcome"; room: WatchPartyRoom; members: WatchPartyMember[]; chat: WatchPartyChatMessage[]; playback: WatchPartyPlaybackState | null }
  | { type: "members"; members: WatchPartyMember[] }
  | { type: "chat"; message: WatchPartyChatMessage }
  | { type: "playback"; state: WatchPartyPlaybackState }
  | { type: "room_closed" | "room_expired" }
  | { type: "error"; code: string }
  | { type: "pong"; timestamp: number };

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(baseUrl() + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Watch Party request failed (${response.status})`);
  return payload;
}

export function createWatchPartyRoom(displayName: string, media: WatchPartyMedia) {
  return post<CreateRoomResponse>("/rooms", { displayName, media });
}

export function joinWatchPartyRoom(code: string, displayName: string, media: Pick<WatchPartyMedia, "mediaId" | "sourceFingerprint">) {
  return post<JoinRoomResponse>(`/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`, { displayName, media });
}

export function connectWatchParty(
  credentials: RoomCredentials,
  onEvent: (event: WatchPartyEvent) => void,
  onStatus?: (status: "connecting" | "connected" | "disconnected") => void,
) {
  const socketUrl = new URL(credentials.websocketUrl);
  socketUrl.searchParams.set("token", credentials.token);
  const socket = new WebSocket(socketUrl.toString());
  onStatus?.("connecting");
  socket.onopen = () => onStatus?.("connected");
  socket.onclose = () => onStatus?.("disconnected");
  socket.onerror = () => onStatus?.("disconnected");
  socket.onmessage = message => {
    try { onEvent(JSON.parse(String(message.data)) as WatchPartyEvent); } catch { /* Ignore malformed server messages. */ }
  };
  return {
    socket,
    send(event: Record<string, unknown>) {
      if (socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(event));
      return true;
    },
    close() {
      socket.close(1000, "Client left room");
    },
  };
}
