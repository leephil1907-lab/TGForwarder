# TGForwarder production deployment

TGForwarder is a persistent Express + GramJS Telegram worker and dashboard. Deploy it as a long-running service.

## Railway deployment

The repository is configured for Railway with:

- Docker-based build
- `npm start` runtime
- `/api/health` health check
- automatic restart on failure
- persistent application data under `/data`

### Required variables

Set these in Railway Variables:

- `APP_AUTH_TOKEN` — long random dashboard/API secret.
- `TG_API_ID` — Telegram API ID.
- `TG_API_HASH` — Telegram API hash.
- `TG_SESSION_STRING` — optional existing GramJS StringSession.
- `TG_BOT_TOKEN` — optional bot token.
- `TG_DATA_DIR=/data`.
- `NODE_ENV=production`.
- `HOST=0.0.0.0`.

You can also configure Telegram credentials and forwarding rules through the authenticated dashboard.

### Persistent storage

Create a Railway Volume and mount it at `/data`. This is important because the Telegram session, configuration and forwarding mappings are stored on disk and must survive restarts and redeployments.

### Health verification

After Railway finishes deploying, request:

`https://YOUR-RAILWAY-DOMAIN/api/health`

Expected response is JSON containing `status: "ok"`. The response also reports Telegram authentication and forwarding-engine state.

### First production login

1. Open the Railway service URL.
2. Enter the `APP_AUTH_TOKEN` when prompted.
3. Open Telegram account connection.
4. Provide the Telegram API ID and API hash.
5. Complete phone verification and 2FA when required, or use a bot token/session string.
6. Discover the chats available to the connected account.
7. Create a source-to-target forwarding rule using the actual Telegram chat IDs.
8. Verify destination permissions.
9. Start the forwarding engine.
10. Monitor the live console and statistics.

### Operational requirements

The Telegram account must actually have access to the source and destination chats. A deployment cannot bypass Telegram permissions. Protected/private content should only be processed where the connected account is authorized to access and republish it.
