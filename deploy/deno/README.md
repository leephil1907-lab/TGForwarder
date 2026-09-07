# Deno Deploy — edge gateway for TGForwarder

Deno Deploy runs **ephemeral, request-scoped edge isolates with no persistent
disk** — the perfect home for a globally fast dashboard, but not for a
long-lived Telegram MTProto worker that must keep one connection (and one data
directory) alive. So this project deploys as a **hybrid**:

```
                    ┌────────────────────────────┐
   Users ──────────▶│  Deno Deploy (edge)        │
                    │  • serves dist/ dashboard  │
                    │  • proxies /api/* (+ SSE)  │
                    └─────────────┬──────────────┘
                                  │ HTTPS (+ x-edge-secret)
                                  ▼
                    ┌────────────────────────────┐
                    │  Worker (Railway/VPS)      │
                    │  • MTProto session 24/7    │
                    │  • volume at /data         │
                    │  • fetcher jobs, watchers  │
                    └────────────────────────────┘
```

## 1. Deploy the worker first

Deploy this repo to **Railway** (see the main README), attach a volume at
`/data`, and log in once. Note the public URL, e.g.
`https://tgforwarder-production.up.railway.app`.

To lock the worker API so **only** your edge gateway can call it, set this
variable on the worker:

```
EDGE_SECRET=<long random string>
```

(`/api/health` stays open so Railway's healthcheck keeps working.)

## 2. Deploy the edge gateway

Either push to `main` (the included workflow
`.github/workflows/deno-deploy.yml` builds the dashboard and deploys
automatically — add `DENO_DEPLOY_TOKEN` and `DENO_DEPLOY_PROJECT` repo
secrets), or run locally:

```bash
npm run build
deno install -gArf jsr:@deno/deployctl
deployctl deploy --prod --project=<your-project> \
  --entrypoint=deploy/deno/server.ts --include=dist --include=deploy
```

Then set these env vars on the Deno Deploy project dashboard:

```
WORKER_URL=https://tgforwarder-production.up.railway.app
EDGE_SECRET=<same value as the worker>
```

## 3. Verify

- `https://<edge>.deno.dev/healthz` → `{"ok":true,"role":"edge","workerConfigured":true}`
- Open the dashboard, unlock with `APP_AUTH_TOKEN`, check `/api/health` in the
  network tab shows the worker's storage block (`"writable": true`).
- Direct API access to the worker without the edge secret returns **403**.

## Why not the whole app on Deno Deploy?

| Requirement | Deno Deploy (classic edge) | Deno Deploy Machines | Railway worker |
|---|---|---|---|
| Long-lived MTProto connection | ✗ (ephemeral isolates) | ✓ (paid long-running) | ✓ |
| Persistent filesystem (session, jobs, downloads) | ✗ | ✗ (needs DenoSaurus/S3/DB port) | ✓ volume at `/data` |
| Sticky single-region process | ✗ (multi-region hops) | ✓ | ✓ |
| Global edge for the dashboard | ✓ | ✓ | – |

The classic-edge gateway (this directory) is production-ready today. A
full-app port to Deploy Machines is possible but requires re-plumbing all
persistence (sessions, jobs, media) to an external store — worth it only if
you want a single vendor/bill.
