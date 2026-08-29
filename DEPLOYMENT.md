# TGForwarder production deployment

## Vercel

TGForwarder is an Express application with a Vite/React frontend. Vercel should deploy the Express application as the backend entrypoint; do not add a separate `/api/*` rewrite that points API requests at the frontend.

Required environment variables:

- `APP_AUTH_TOKEN` — long random access token used by the dashboard.
- `TG_API_ID` — Telegram API ID (optional if entered through the dashboard).
- `TG_API_HASH` — Telegram API hash (optional if entered through the dashboard).
- `TG_SESSION_STRING` — optional GramJS StringSession for automatic login.
- `TG_BOT_TOKEN` — optional bot token login.
- `TG_SOURCE_ID` / `TG_TARGET_ID` — optional initial forwarding rule.

### Important persistence limitation

The forwarding engine uses local `.data` files for configuration, mappings and generated access-token fallback. Vercel Functions do not provide durable local storage between invocations. For a production Telegram forwarding worker, use a persistent Node host/VPS/container for the worker and a persistent database for application state.

`APP_AUTH_TOKEN` should therefore always be configured in Vercel rather than relying on the generated `.data/auth_token.txt` fallback.

### API verification

After deployment, verify:

- `GET /api/health` returns JSON, not `index.html`.
- Authenticated requests send `Authorization: Bearer <APP_AUTH_TOKEN>`.
- SSE uses `/api/stream?token=<APP_AUTH_TOKEN>` because EventSource cannot set Authorization headers.
- `/api/auth/request-code` accepts `{ apiId, apiHash, phoneNumber }`.
- `/api/auth/verify-code` accepts `{ phoneCode }`.
- `/api/auth/verify-2fa` accepts `{ password }`.
- `/api/auth/session-login` accepts `{ apiId, apiHash, sessionString }`.

## Recommended production architecture

For Telegram MTProto forwarding, run the persistent Express/Telegram worker on a VPS/container (Railway, Render, Fly.io, Docker host, etc.) and serve the React UI from Vercel if desired. Vercel can remain the frontend while the worker keeps its Telegram socket, background queues and persistent state alive.
