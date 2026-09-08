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

## Multi-User Access (invite-only)

TGForwarder supports multiple isolated users on one deployment:

- **Administrator** — the admin entry is hidden from the public page: open the gate with `#admin` in the URL (e.g. `https://your-app.example/#admin`) and sign in with the server's `APP_AUTH_TOKEN`. Regular visitors see only Sign in / Register and cannot tell that an admin console exists. The admin keeps the original `default` workspace (existing rules, session and data are untouched) and manages invites and users under the **Access Control** tab.
- **Invites** — admin generates single-use codes (`TGF-XXXXXX-XXXXXX`, optional label, optional expiry: 24 h / 7 days / 30 days). Share either the raw code or the one-click **invite link** (`https://your-app/?invite=TGF-…`, copy button in the Access Control tab) — the gate auto-reads the code from the link, so the new user only picks a username + password and lands straight in their dashboard. Codes work exactly once; unused/expired ones can be revoked; used ones are kept for audit.
- **Connecting Telegram** — inside the dashboard each user opens **Connect Telegram** and signs in with their own API ID + API Hash (from my.telegram.org), phone number, and the login code Telegram sends. If (and only if) their account is protected by a 2FA Cloud Password, a password step appears; accounts without 2FA connect right after the phone-code check.
- **Users** — each registered user gets a fully isolated workspace under `data/tenants/<tenantId>/`: their own Telegram session, forwarding rules, fetch jobs + downloads, watchers, pending posts, mappings, logs and stats. Users can never see each other's data. Passwords are stored as `scrypt` hashes; sessions are sha256-hashed tokens with a 30-day TTL.
- **Admin controls** — overview cards (users / active / invites), per-user **Disable** (signs them out immediately and blocks re-login), **Force sign-out** (revokes all their sessions without disabling), and re-enable at any time.
- **Appearance** — light/dark theme toggle in the navbar (persisted per browser) and Telegram-brand blue across the UI.

No extra configuration is needed: multi-user is always on, and the master token remains the admin identity.

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
