import {
  decodeEnvelope,
  decodeMessagePayload,
  encodeCapabilities,
  encodeCreateRoom,
  encodeEnvelope,
  encodeJoinRoom,
  encodeLeaveRoom,
  encodePing,
  encodePlaybackAction,
} from "./metroproto";

export type MetroserverEvent = {
  type: string;
  payload: Record<string, unknown>;
};

export type MetroserverConnection = {
  socket: WebSocket;
  createRoom(username: string): boolean;
  joinRoom(roomCode: string, username: string): boolean;
  leaveRoom(): boolean;
  playback(action: "play" | "pause" | "seek", trackId: string, positionMs: number): boolean;
  ping(): boolean;
  close(): void;
};

/**
 * Connect to a Metroserver WebSocket endpoint, e.g. a self-hosted
 * wss://host/ws URL. The server URL is supplied by the app configuration;
 * this module intentionally does not hard-code a third-party public server.
 */
export function connectMetroserver(
  endpoint: string,
  onEvent: (event: MetroserverEvent) => void,
  onStatus?: (status: "connecting" | "connected" | "disconnected") => void,
): MetroserverConnection {
  const url = endpoint.trim();
  if (!/^wss?:\/\//i.test(url)) {
    throw new Error("Metroserver URL must start with ws:// or wss://");
  }

  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  let sequence = 0;
  onStatus?.("connecting");

  const send = (type: string, payload: Uint8Array) => {
    if (socket.readyState !== WebSocket.OPEN) return false;
    const envelope = encodeEnvelope(type, payload);
    socket.send(envelope.buffer.slice(envelope.byteOffset, envelope.byteOffset + envelope.byteLength));
    return true;
  };

  socket.onopen = () => {
    onStatus?.("connected");
    send("client_capabilities", encodeCapabilities());
  };
  socket.onclose = () => onStatus?.("disconnected");
  socket.onerror = () => onStatus?.("disconnected");
  socket.onmessage = message => {
    try {
      let bytes: Uint8Array;
      if (message.data instanceof ArrayBuffer) {
        bytes = new Uint8Array(message.data);
      } else if (ArrayBuffer.isView(message.data)) {
        bytes = new Uint8Array(message.data.buffer, message.data.byteOffset, message.data.byteLength);
      } else {
        // Metroserver's protocol is binary protobuf; text frames are not valid.
        return;
      }
      const envelope = decodeEnvelope(bytes);
      onEvent({ type: envelope.type, payload: decodeMessagePayload(envelope.type, envelope.payload) });
    } catch {
      // Ignore malformed frames; keep the connection alive for valid frames.
    }
  };

  return {
    socket,
    createRoom: username => send("create_room", encodeCreateRoom(username.trim())),
    joinRoom: (roomCode, username) => send("join_room", encodeJoinRoom(roomCode.trim().toUpperCase(), username.trim())),
    leaveRoom: () => send("leave_room", encodeLeaveRoom()),
    playback: (action, trackId, positionMs) => send("playback_action", encodePlaybackAction(action, trackId, positionMs, ++sequence)),
    ping: () => send("ping", encodePing(Date.now(), ++sequence)),
    close: () => socket.close(1000, "AnimePlex left room"),
  };
}
