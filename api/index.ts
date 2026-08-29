import type { Request, Response } from 'express';

let serverStarted: Promise<void> | null = null;

async function ensureLocalServer() {
  if (!serverStarted) {
    serverStarted = import('../server.js').then(() => undefined);
  }
  await serverStarted;
}

async function readBody(req: Request): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Vercel adapter for the existing Express application. */
export default async function handler(req: Request, res: Response) {
  try {
    await ensureLocalServer();
    const port = Number(process.env.PORT || 3000);
    const body = await readBody(req);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    headers.delete('host');
    headers.delete('content-length');

    const upstream = await fetch(`http://127.0.0.1:${port}${req.originalUrl || req.url}`, {
      method: req.method,
      headers,
      body: body && body.length ? body : undefined,
      redirect: 'manual'
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'transfer-encoding') res.setHeader(key, value);
    });
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Backend initialization failed', message: error?.message || 'Unable to reach Express backend' });
    }
  }
}
