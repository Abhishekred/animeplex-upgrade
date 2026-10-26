/**
 * Minimal Metroproto wire helpers for React Native.
 *
 * Metroserver accepts uncompressed protobuf payloads when compression is not
 * negotiated. This keeps the client free of native gzip dependencies.
 * Keep payload handling deliberately small; add fields only as they are used.
 */
export type ProtoScalar = string | number | boolean | Uint8Array;

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

function varint(value: number | bigint): number[] {
  let n = typeof value === "bigint" ? value : BigInt(Math.max(0, Math.trunc(value)));
  const out: number[] = [];
  while (n > 0x7fn) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return out;
}

function readVarint(bytes: Uint8Array, offset: number): { value: bigint; next: number } {
  let value = 0n;
  let shift = 0n;
  let cursor = offset;
  while (cursor < bytes.length && shift < 70n) {
    const byte = bytes[cursor++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    shift += 7n;
  }
  throw new Error("Malformed protobuf varint");
}

function lengthDelimited(field: number, value: Uint8Array): number[] {
  return [...varint((field << 3) | 2), ...varint(value.length), ...value];
}

export function encodeProto(fields: Array<[number, ProtoScalar]>): Uint8Array {
  const out: number[] = [];
  for (const [field, value] of fields) {
    if (typeof value === "string") {
      if (value.length) out.push(...lengthDelimited(field, utf8Encoder.encode(value)));
    } else if (value instanceof Uint8Array) {
      if (value.length) out.push(...lengthDelimited(field, value));
    } else if (typeof value === "boolean") {
      if (value) out.push(...varint(field << 3), ...varint(1));
    } else if (value !== 0) {
      out.push(...varint(field << 3), ...varint(value));
    }
  }
  return new Uint8Array(out);
}

export function decodeProto(bytes: Uint8Array): Map<number, ProtoScalar[]> {
  const fields = new Map<number, ProtoScalar[]>();
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    offset = tag.next;
    const field = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    let value: ProtoScalar;
    if (wire === 0) {
      const parsed = readVarint(bytes, offset);
      offset = parsed.next;
      value = parsed.value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed.value) : parsed.value.toString();
    } else if (wire === 2) {
      const size = readVarint(bytes, offset);
      offset = size.next;
      const length = Number(size.value);
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) {
        throw new Error("Malformed protobuf length");
      }
      value = bytes.slice(offset, offset + length);
      offset += length;
    } else if (wire === 1) {
      if (offset + 8 > bytes.length) throw new Error("Malformed fixed64");
      value = bytes.slice(offset, offset + 8);
      offset += 8;
    } else if (wire === 5) {
      if (offset + 4 > bytes.length) throw new Error("Malformed fixed32");
      value = bytes.slice(offset, offset + 4);
      offset += 4;
    } else {
      throw new Error("Unsupported protobuf wire type");
    }
    const list = fields.get(field) ?? [];
    list.push(value);
    fields.set(field, list);
  }
  return fields;
}

function first(fields: Map<number, ProtoScalar[]>, field: number): ProtoScalar | undefined {
  return fields.get(field)?.[0];
}
function asBytes(value: ProtoScalar | undefined): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array();
}
function asString(value: ProtoScalar | undefined): string {
  if (typeof value === "string") return value;
  return value instanceof Uint8Array ? utf8Decoder.decode(value) : "";
}

export type MetroEnvelope = {
  type: string;
  payload: Uint8Array;
  compressed: boolean;
  requestId: number;
};

export function encodeEnvelope(type: string, payload: Uint8Array, requestId = 0): Uint8Array {
  return encodeProto([[1, type], [2, payload], [4, requestId]]);
}

export function decodeEnvelope(bytes: Uint8Array): MetroEnvelope {
  const fields = decodeProto(bytes);
  const compressed = Number(first(fields, 3) ?? 0) !== 0;
  if (compressed) {
    throw new Error("Metroserver sent gzip-compressed data, but compression was not negotiated");
  }
  return {
    type: asString(first(fields, 1)),
    payload: asBytes(first(fields, 2)),
    compressed,
    requestId: Number(first(fields, 4) ?? 0),
  };
}

export function encodeCreateRoom(username: string): Uint8Array {
  return encodeProto([[1, username]]);
}
export function encodeJoinRoom(roomCode: string, username: string): Uint8Array {
  return encodeProto([[1, roomCode], [2, username]]);
}
export function encodeLeaveRoom(): Uint8Array {
  return new Uint8Array();
}
export function encodeCapabilities(clientVersion = "AnimePlex"): Uint8Array {
  // supports_protobuf=true; supports_compression=false; feature list omitted.
  return encodeProto([[1, true], [3, clientVersion]]);
}
export function encodePlaybackAction(action: "play" | "pause" | "seek", trackId: string, positionMs: number, hostSequence: number): Uint8Array {
  return encodeProto([[1, action], [2, trackId], [3, positionMs], [14, hostSequence]]);
}
export function encodePing(clientTime: number, sequence: number): Uint8Array {
  return encodeProto([[1, clientTime], [2, sequence]]);
}

export function decodeMessagePayload(type: string, payload: Uint8Array): Record<string, unknown> {
  const f = decodeProto(payload);
  if (type === "room_created") {
    return { roomCode: asString(first(f, 1)), userId: asString(first(f, 2)), sessionToken: asString(first(f, 3)) };
  }
  if (type === "join_approved") {
    return { roomCode: asString(first(f, 1)), userId: asString(first(f, 2)), sessionToken: asString(first(f, 3)), stateBytes: asBytes(first(f, 4)) };
  }
  if (type === "join_rejected") return { reason: asString(first(f, 1)) };
  if (type === "error") return { code: asString(first(f, 1)), message: asString(first(f, 2)) };
  if (type === "user_joined" || type === "user_left" || type === "user_reconnected" || type === "user_disconnected") {
    return { userId: asString(first(f, 1)), username: asString(first(f, 2)) };
  }
  if (type === "sync_playback" || type === "sync_state") {
    return {
      currentTrackBytes: asBytes(first(f, 1)),
      isPlaying: Number(first(f, 2) ?? 0) !== 0,
      positionMs: Number(first(f, 3) ?? 0),
      lastUpdate: Number(first(f, 4) ?? 0),
      revision: Number(first(f, 7) ?? 0),
    };
  }
  if (type === "server_capabilities") {
    return { supportsProtobuf: Number(first(f, 1) ?? 0) !== 0, supportsCompression: Number(first(f, 2) ?? 0) !== 0, serverVersion: asString(first(f, 3)), features: (f.get(4) ?? []).map(asString), canHost: Number(first(f, 5) ?? 0) !== 0 };
  }
  return { rawFields: f };
}
