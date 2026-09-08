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
- **Persistent Telegram connection**: the session is stored in one global
  workspace (not per browser), auto-reconnects after restarts and network drops,
  and is only cleared when you explicitly press Disconnect.
- **Edit & Publish**: every fetched post (and every Source History post) can be
  opened in an editor — the photo/video from the source (including private
  channels) renders right in the dashboard, the caption/text is editable, and
  the result is published to any target chat as a clean repost.
- **Restricted Fetcher (integrated worker)**: paste Telegram message links — public (`t.me/channel/123`), private (`t.me/c/<id>/<msg>`) and topic/thread links — and the built-in worker fetches each post with the connected account, then delivers it to a Telegram destination (clean repost, no "forwarded from" signature) and/or stores it on disk for download from the dashboard.

## Production architecture

Railway runs the complete application as one persistent Node.js service. The Express server serves the compiled React dashboard and the `/api/*` backend from the same origin. The Telegram MTProto client stays alive as a long-running worker, which is required for real-time forwarding.

## Requirements

- Node.js 22
- A Telegram API ID and API hash from `my.telegram.org`
- A Telegram account session or bot token
- A persistent filesystem for production session/configuration data

## Restricted Fetcher

The dashboard's **Restricted Fetcher** tab integrates the
[save-restricted-bot](https://github.com/leephil1907-lab/save-restricted-bot)
worker directly into this service — no second process, runtime, or Telegram
session is needed.

- Paste one or many message links (newline/comma separated) and run the worker.
- The job queue processes items sequentially with the global rate-limit pacing,
  handles `FLOOD_WAIT` cooldowns automatically and survives restarts
  (interrupted jobs are requeued on boot).
- Delivery is a clean repost: media is re-sent from the fetched message's file
  reference, which strips the forward signature and works around
  "restrict saving content" sources. Albums are delivered as one album.
- Every fetched file can also be saved under `TG_DATA_DIR/fetcher/downloads/`
  and downloaded through the authenticated
  `/api/fetcher/download/:jobId/:itemId` endpoint.
- API: `GET/POST /api/fetcher/jobs`, `POST /api/fetcher/jobs/:id/cancel`,
  `POST /api/fetcher/jobs/:id/retry`, `DELETE /api/fetcher/jobs/:id`.
- The connected account must be a member of private chats you fetch from.

## Verifying the Railway volume

After attaching a volume and deploying, open `https://<your-app>/api/health`
(authenticated) and confirm:

```json
"storage": { "dir": "/data", "writable": true, "volumeAttached": true }
```

The boot log also prints the active data directory and whether it is writable —
if it says `NOT writable`, the volume is missing or `TG_DATA_DIR` is wrong.
- Each fetched item has an **Edit** action: preview the original media, edit the
  caption/text, choose a destination and publish.

## Backup & Restore

The **Analytics** tab has a **Backup & Restore** card. "Download backup" saves a single
JSON file containing your Telegram session, rules, mappings, pending posts, watchers and
fetch jobs. Restoring a backup replaces the current workspace and restarts the service.
Keep backups offline — they contain your Telegram session string.

## Telegram Archive Bot (optional)

Want to read captured posts — including media from private/restricted
channels — right inside Telegram? Create any bot with @BotFather and add:

- `ARCHIVE_BOT_TOKEN` — the bot token
- `ARCHIVE_CHAT_ID` — your chat with that bot (message it once and get your id,
  e.g. via @userinfobot), or an archive channel where the bot has post rights

Every post captured from a source (live pipeline, private-source listener,
auto-import watcher) is then mirrored into that chat: text as a message,
media as a file (downloaded through your session — restricted sources work;
Bot API caps uploads at 50 MB, larger files get a notice). Mirroring is
independent of rule delivery and never blocks forwarding.

## Failure Alerts (optional)

Get notified the moment deliveries start failing (deduped per route, max 20/hour):

- `ALERT_BOT_TOKEN` + `ALERT_CHAT_ID` — Telegram message via any @BotFather bot (add the bot to your channel/group or use your user id)
- `ALERT_WEBHOOK_URL` — receives `{type:"delivery_failure", sourceId, targetId, ruleName, error, at}`

## Storage: no database needed

All state lives as flat files on the persistent volume (`/data`). You do **not** need to
attach a Railway database (Postgres/MySQL/Redis) — that would add a network dependency
and another service to operate for zero benefit at this scale.

## Access

Single-operator deployment: the dashboard is unlocked with the server's `APP_AUTH_TOKEN`
(set it in the environment, or let the server generate one and print it on boot).
Connect your Telegram account (API ID + API Hash, phone, login code — 2FA password
only if your account has one) and everything runs in your workspace.

## Posting Modes: Auto vs Manual (per rule)

Every forwarding rule has a posting-mode toggle:

- **✋ Manual review (default)** — copied posts are staged in **Pending Posts**
  where you can edit the text/caption and publish when ready. Identical content
  is deduped at staging time so the review queue never fills with copies.
- **⚡ Auto** — copied posts are published to the target instantly through the
  normal dispatcher (rate-limited, flood-wait safe, duplicate-shielded).

Toggle it per rule from the rule card (**⚡ Auto / ✋ Review** button) or in the
rule form's "Posting mode" switch. API: included in `POST /api/rules` and
`PUT /api/rules/:id` payloads as `autoPublish: true|false`.

## Auto-Import Watchers

The Restricted Fetcher tab includes scheduled source watching: pick a source
channel, a review destination and a frequency (5 minutes to 6 hours), and the
scheduler imports every **new** post into the **Pending Posts** review queue on
the Pipeline Funnel tab — ready to edit and publish.

- Per-watch message-ID watermarks: only genuinely new posts are imported, with
  no duplicates across restarts.
- Optionally import the 5 most recent existing posts when the watcher starts.
- Watches persist on disk, pause/resume individually, support immediate
  "Run now", and report status (watermark, last check, totals, errors) live.
- API: `GET/POST /api/autoimport`, `PUT/DELETE /api/autoimport/:id`,
  `POST /api/autoimport/:id/run`.

## Session persistence

Login once — the `StringSession` is saved under `TG_DATA_DIR/tenants/default/`
and shared by every browser. On boot the engine restores the session and
resumes automatically; a watchdog reconnects dropped sockets. The session is
removed only via the dashboard's Disconnect action (or by deleting the data
directory).

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
