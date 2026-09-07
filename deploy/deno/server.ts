/**
 * TGForwarder — Deno Deploy edge gateway
 * --------------------------------------
 * Serves the built dashboard (dist/) from Deno's global edge and proxies
 * /api/* (including SSE streams) to the persistent worker running on a
 * platform with a real filesystem and long-lived processes (Railway/VPS).
 *
 * Required env (set in the Deno Deploy dashboard):
 *   WORKER_URL   — e.g. https://tgforwarder-production.up.railway.app
 *   EDGE_SECRET  — shared secret; the worker rejects /api calls without it
 *                  (only if you set the same EDGE_SECRET on the worker)
 *
 * The edge never holds Telegram state — restarts are free and stateless.
 */

const WORKER_URL = (Deno.env.get("WORKER_URL") ?? "").trim().replace(/\/+$/, "");
const EDGE_SECRET = Deno.env.get("EDGE_SECRET")?.trim() ?? "";
const PORT = Number(Deno.env.get("PORT") ?? 8000);

if (!WORKER_URL) {
  console.warn("[edge] WORKER_URL is not set — /api/* will return 503. Set it to your worker's public URL.");
}

// dist/ sits at the repo root relative to this file (deploy/deno/server.ts),
// both locally and on Deno Deploy (deployctl preserves the relative layout).
const DIST = new URL("../../dist", import.meta.url);

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  ico: "image/x-icon",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  map: "application/json",
};

function staticResponse(pathname: string): Promise<Response> {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  // Traversal guard: strip any parent-segment attempts.
  const clean = rel.replace(/\\/g, "/").replace(/\.{2,}(\/|$)/g, "");
  const ext = clean.includes(".") ? (clean.split(".").pop() ?? "") : "";
  return (async () => {
    try {
      const file = await Deno.readFile(new URL(`.${clean.startsWith("/") ? clean : `/${clean}`}`, DIST));
      return new Response(file, {
        headers: {
          "content-type": MIME[ext] ?? "application/octet-stream",
          "cache-control": ext === "html" || !ext ? "no-cache" : "public, max-age=31536000, immutable",
        },
      });
    } catch {
      // SPA fallback — client-side routes render from index.html.
      try {
        const index = await Deno.readFile(new URL("./index.html", DIST));
        return new Response(index, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
      } catch {
        return new Response(
          "dist/ is not part of this deployment. Run `npm run build` and deploy with --include=dist (see .github/workflows/deno-deploy.yml).",
          { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } },
        );
      }
    }
  })();
}

async function proxyToWorker(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = `${WORKER_URL}${url.pathname}${url.search}`;

  const headers = new Headers();
  for (const name of ["authorization", "cookie", "content-type", "accept", "last-event-id", "user-agent"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (EDGE_SECRET) headers.set("x-edge-secret", EDGE_SECRET);

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
    });

    const responseHeaders = new Headers();
    upstream.headers.forEach((value, name) => {
      const n = name.toLowerCase();
      if (["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"].includes(n)) return;
      responseHeaders.set(name, value);
    });

    // Stream the body untouched — this is what keeps SSE (/api/stream) working.
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Worker unreachable at ${WORKER_URL}: ${message}` },
      { status: 502 },
    );
  }
}

Deno.serve({ port: PORT }, (req: Request) => {
  const { pathname } = new URL(req.url);

  if (pathname === "/healthz") {
    return Response.json({ ok: true, role: "edge", workerConfigured: Boolean(WORKER_URL) });
  }

  if (pathname.startsWith("/api/")) {
    if (!WORKER_URL) {
      return Response.json({ error: "Edge gateway has no WORKER_URL configured." }, { status: 503 });
    }
    return proxyToWorker(req);
  }

  return staticResponse(pathname);
});
