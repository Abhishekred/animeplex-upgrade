# AnimePlex Watch Party implementation plan

## Chosen architecture

Use Supabase Realtime for room presence, broadcast events, and chat, with Supabase Postgres tables/RLS for room membership and durable room metadata. The mobile app must use only the Supabase project URL and publishable/anon key; service-role keys must never ship in the app.

## Feature scope

- Create private room with short join code; host can close room and transfer host role.
- Join/leave room, member list, reconnect/presence indicators, room capacity.
- Live text chat with bounded message length and basic rate limiting.
- Host-authoritative play/pause/seek and periodic playback position snapshots.
- Late joiners receive current playback state.
- Episode/source compatibility checks: only sync when participants report the same media identity and compatible playable source. Never assume different providers' URLs point to the same stream.
- Graceful fallback when realtime is disconnected; local playback must continue independently.
- Room expiry and cleanup for abandoned rooms.

## Playback sync design

The host emits versioned events: `play`, `pause`, `seek`, `media_changed`, and periodic `state` snapshots. Events include room ID, media identity, position in seconds, host timestamp, and monotonic sequence number. Clients reject stale sequence numbers and apply small drift correction; larger drift seeks to the host position. Only the current host may issue authoritative controls.

## Security

- Room membership and host privileges are validated server-side.
- RLS policies prevent reading rooms/messages without membership.
- Join codes are random, rate-limited, and expire.
- Do not put service-role secrets or admin credentials in the app.
- Chat content is plain text; enforce length and rate limits.

## Required configuration

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

A Supabase project must be created and database schema/RLS policies deployed before rooms can work across devices. These values are public client configuration, not service-role secrets. Never commit private keys.

## Phased delivery

1. Add shared types and client contract; verify player integration points.
2. Add database schema, RLS, room lifecycle, and realtime chat/presence.
3. Add Watch Party UI for create/join, members, host controls, and chat.
4. Integrate playback events with the existing player and add compatibility warnings.
5. Add tests for room permissions, reconnects, stale events, host departure, and incompatible sources.

## Current status

Planning and repository inspection only. The repository currently has no Watch Party feature or ready-to-use realtime room backend. Do not advertise this as working until a Supabase project is configured and end-to-end tests pass.
