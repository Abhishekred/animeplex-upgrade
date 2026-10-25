# AnimePlex Watch Party implementation plan

## Chosen architecture

Use Cloudflare Workers + Durable Objects. A Worker validates API requests and signs short-lived room-session tokens; one Durable Object per room coordinates WebSocket presence, chat, room lifecycle, and host-authoritative playback events. Use Durable Object storage for room metadata, latest playback state, and bounded chat history.

## Feature scope

- Create private room with a six-character join code; host can close room and transfer host role.
- Join/leave room, member list, reconnect/presence indicators, room expiry.
- Live text chat with bounded message length, retained history, and basic per-member rate limiting.
- Host-authoritative play/pause/seek and latest playback snapshot for late joiners.
- Episode/source compatibility checks: only sync when participants report the same stable media identity and compatible playable source. Never assume different providers' URLs point to the same stream.
- Graceful fallback when realtime is disconnected; local playback must continue independently.

## Playback sync design

The host emits versioned events: `play`, `pause`, `seek`, `media_changed`, and periodic `state` snapshots. Events include room code, media identity, position in seconds, host timestamp, and monotonic sequence number. Clients reject stale sequence numbers and apply drift correction. Only the current host may issue authoritative controls. Player integration must avoid feedback loops when applying remote seek/play/pause.

## Security

- Room session tokens are signed by a Worker secret configured with Wrangler; never ship it to the mobile app.
- Host privileges are validated server-side, chat length/rate is bounded, and room codes expire.
- Keep the session signing secret out of GitHub and all `EXPO_PUBLIC_*` variables.
- Before public launch, add global/IP-based rate limits, moderation/reporting, and abuse monitoring.

## Required configuration

Worker secret: `SESSION_SECRET`, set with `npx wrangler secret put SESSION_SECRET`.

Mobile app configuration after the Worker is deployed: `EXPO_PUBLIC_WATCH_PARTY_URL`. This is a public endpoint URL, not a secret.

## Phased delivery

1. Shared app types and repository/player inspection. (Done)
2. Cloudflare Worker + Durable Object API, room lifecycle, WebSocket chat/presence, signed sessions, and host-authoritative playback events. (Initial backend slice added on feature branch)
3. Add native app client and Watch Party UI for create/join, members, host controls, and chat.
4. Integrate playback events with the existing player and add compatibility warnings.
5. Add automated tests, deploy Worker, and verify cross-device end-to-end behavior.

## Current status

The backend starter and app API client have been added on `feature/watch-party-cloudflare`; it is not deployed and the mobile UI/player are not wired to it yet. Treat Watch Party as in development until typechecks, security review, deployment, and cross-device tests pass.
