# TGForwarder

Production Telegram forwarding and channel-management service built with React, TypeScript, Express and GramJS/MTProto.

## What it does

- Connects a Telegram user account or bot through the real Telegram API.
- Discovers the chats, groups and channels available to the connected account.
- Creates source-to-target forwarding rules using authoritative Telegram chat IDs.
- Supports multiple destinations per source.
- Applies keyword filters, link filtering, text prefixes/suffixes and duplicate protection.
- Handles media forwarding and removes the Telegram forwarded-message signature when configured.
- Supports Telegram history retrieval and controlled publishing of existing posts.
- Provides live engine state, activity logs, statistics and server-sent events.
- Handles Telegram flood waits with configurable pacing and retries.
- Persists configuration, sessions and forwarding mappings on a mounted data directory.
- Protects the dashboard/API with `APP_AUTH_TOKEN` and rate limiting.

## Production architecture

Railway runs the complete application as one persistent Node.js service. The Express server serves the compiled React dashboard and the `/api/*` backend from the same origin. The Telegram MTProto client stays alive as a long-running worker, which is required for real-time forwarding.

## Requirements

- Node.js 22
- A Telegram API ID and API hash from `my.telegram.org`
- A Telegram account session or bot token
- A persistent filesystem for production session/configuration data

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

## Production setup

```bash
npm install
npm run build
npm start
```

Set these environment variables in the production service:

- `APP_AUTH_TOKEN` — long random secret for dashboard/API access.
- `TG_API_ID` — Telegram API ID.
- `TG_API_HASH` — Telegram API hash.
- `TG_SESSION_STRING` — optional existing GramJS StringSession.
- `TG_BOT_TOKEN` — optional bot login token.
- `TG_DATA_DIR` — persistent data directory, recommended as `/data` on Railway.
- `TG_SOURCE_ID`, `TG_TARGET_ID` or `TG_FORWARDING_RULES` — optional initial forwarding configuration.
- `NODE_ENV=production`
- `HOST=0.0.0.0`

Do not commit Telegram API credentials, bot tokens, session strings or `APP_AUTH_TOKEN`.

## Railway

The repository contains a Railway configuration that builds the Docker image, starts the persistent service with `npm start`, restarts it after failures and checks `/api/health`.

Mount a Railway Volume at `/data` and set `TG_DATA_DIR=/data` so Telegram sessions, configuration and forwarding mappings survive redeployments.

After deployment, verify:

```text
https://YOUR-RAILWAY-DOMAIN/api/health
```

The endpoint should return JSON with `status: "ok"`.

## Security

- Keep `APP_AUTH_TOKEN` private.
- Never commit `.env`, session files or production data.
- Use a strong unique dashboard token.
- Only connect Telegram accounts you control or are authorized to operate.
- Configure source and destination chats using their real Telegram IDs.
- Respect Telegram's terms, privacy requirements and applicable laws when forwarding content.

## License

See `LICENSE` for the repository license terms.
