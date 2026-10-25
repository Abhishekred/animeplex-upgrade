# Metroserver compatibility spike

## Scope

Evaluate whether AnimePlex can reuse the public Metroserver implementation used by Metrolist's Listen Together feature, before changing the app's Watch Party architecture.

## Findings from source inspection

- AnimePlex's current Watch Party client (`src/lib/watchParty/client.ts`) expects HTTP JSON endpoints for `POST /rooms` and `POST /rooms/{code}/join`, followed by a JSON WebSocket event stream.
- Metroserver is a Go WebSocket server using the Metroproto Protobuf schema and gzip-compressed messages. Its message vocabulary includes `create_room`, `join_room`, `playback_action`, `sync_playback`, and `sync_state`.
- Metroserver's playback model is audio-track oriented (`track_id`, track metadata, queue and volume). It has useful room/session/playback-sync concepts, but it is not a drop-in backend for AnimePlex.
- The music app's configured public endpoint is `wss://metroserverx.meowery.eu/ws`. Its ownership, current reachability, usage terms, and suitability for video Watch Parties have not been verified.

## Compatibility verdict

**Direct reuse: no.** The existing AnimePlex JSON client cannot connect to Metroserver as-is. An adapter or a dedicated Metroproto client implementation would be needed. Before choosing either, confirm the protobuf envelope/compression details and whether the operator permits video-app use. Do not send video URLs, credentials, or provider tokens to the music server.

## Test checklist

- [x] Inspect AnimePlex Watch Party client contracts.
- [x] Inspect Metroserver protocol names, payloads, and project README.
- [ ] Verify the public endpoint's reachability from a suitable network.
- [ ] Read Metroproto schema and document the binary envelope/compression framing.
- [ ] If authorized, prototype room create/join and host playback events using test-only metadata.
- [ ] Verify two-client play/pause/seek behavior.
- [ ] Decide between adapter, native protocol client, or retaining the existing Cloudflare design.

## Safety / rollout

This spike does not change player behavior, does not configure the public server in the app, and does not claim a live connection or cross-device test has passed. Keep the current Watch Party backend path unchanged until protocol and operator permission are confirmed.
