# TGForwarder production deployment

## Recommended: Railway worker + dashboard

TGForwarder is a long-running Express + GramJS application. For the real Telegram worker, deploy the repository as a persistent Railway service rather than as Vercel-only serverless functions.

The repository now includes `railway.json` with:

- `npm run build` as the build command
- `npm start` as the start command
- `/api/health` as the health check
- automatic restart on failure

### Railway environment variables

Set these in Railway **Variables**. Never commit real values to GitHub.

- `APP_AUTH_TOKEN` — long random secret used by the dashboard API.
- `TG_API_ID` — optional Telegram API ID; you can also enter it through the dashboard.
- `TG_API_HASH` — optional Telegram API hash; you can also enter it through the dashboard.
- `TG_SESSION_STRING` — optional existing GramJS StringSession. Treat it like a password.
- `TG_BOT_TOKEN` — optional bot token login.
- `TG_SOURCE_ID` / `TG_TARGET_ID` — optional initial rule.
- `TG_DATA_DIR=/data` — recommended when a Railway Volume is mounted at `/data`.
- `NODE_ENV=production`
- `HOST=0.0.0.0`

### Persistence

Attach a Railway Volume and mount it at `/data`, then set `TG_DATA_DIR=/data`. This keeps configuration, forwarding mappings, and the saved Telegram session across redeploys/restarts. Without persistent storage, local files may be lost when the service is recreated.

### Dashboard connection

If Railway hosts the complete application, the React/Vite dashboard and Express API are served by the same origin. No separate API hostname is required; the browser calls `/api/*` directly.

If the frontend is hosted separately (for example on Vercel), configure the frontend's API base URL to the Railway public URL and ensure CORS is configured for that frontend origin.

### API verification

After deployment, open:

`https://YOUR-RAILWAY-DOMAIN/api/health`

It should return JSON containing `status: "ok"` and worker status. Do not proceed until this endpoint returns JSON rather than the frontend HTML.

## Vercel

Vercel can host the React UI, but it should not be treated as the durable Telegram worker host. Vercel Functions have ephemeral local storage and are not a substitute for a persistent MTProto process.

If Vercel is used for the UI, keep the Telegram engine on Railway/VPS and point the UI API requests to the Railway URL.
