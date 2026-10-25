# AnimePlex Watch Party Worker

Cloudflare Worker + Durable Objects backend for room-coordinated WebSocket chat, presence, room lifecycle, and host-authoritative playback events.

## Deploy

1. Install Wrangler: `npm install --save-dev wrangler` (or use `npx wrangler`).
2. From this directory, create a strong random signing secret of at least 32 characters and set it interactively:
   `npx wrangler secret put SESSION_SECRET`
3. Deploy: `npx wrangler deploy`
4. Keep the Worker URL for app configuration. Do not put the signing secret in the app, source control, or an `EXPO_PUBLIC_*` variable.

## API

- `GET /health` — service health.
- `POST /rooms` — create a room. JSON: `{ "displayName": "Host", "media": { "mediaId": "stable-title-episode-id", "title": "Title", "episodeTitle": "Episode 1", "providerId": "provider-key", "sourceFingerprint": "stable-source-identity" } }`. Returns room code, signed host token and WebSocket URL.
- `POST /rooms/:code/join` — JSON: `{ "displayName": "Guest", "media": { "mediaId": "...", "sourceFingerprint": "..." } }`. Returns a signed member token and compatibility result.
- `GET /rooms/:code/ws?token=SIGNED_TOKEN` — WebSocket upgrade. Send JSON events: `chat`, `media_compatibility`, `playback`, `transfer_host`, `close_room`, or `ping`.

## Security and limitations

- Configure `SESSION_SECRET` using Wrangler secrets; never commit it.
- Tokens expire after 12 hours. Room metadata expires after 12 hours.
- Chat is plain text, capped at 500 characters and 100 retained messages per room, with a basic per-member send interval.
- Host-only actions are checked server-side. Room codes use a non-ambiguous six-character alphabet.
- Playback events are accepted only from the host and include monotonic sequence numbers.
- A source is compatible only when both the stable media ID and source fingerprint match. The app must calculate the fingerprint without embedding provider credentials or signed URLs.
- This first backend slice does not yet include durable user accounts, abuse reporting/moderation, global IP-based rate limiting, or a production UI. Do not treat a room code as a user identity.
- The native app has not yet been wired to this API; the Watch Party UI and player event integration are the next phase.

## Native app configuration

Add the deployed base URL to app configuration as a public endpoint (for example, `EXPO_PUBLIC_WATCH_PARTY_URL`). This URL is not a secret. Never ship `SESSION_SECRET` in the mobile app.
