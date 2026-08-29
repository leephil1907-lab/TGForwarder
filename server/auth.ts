import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const DATA_DIR = path.join(process.cwd(), '.data');
const TOKEN_FILE = path.join(DATA_DIR, 'auth_token.txt');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Resolves the access token that protects every API route.
 * Priority: APP_AUTH_TOKEN env var > a token persisted on disk from a
 * previous run > a freshly generated random token (persisted for next time).
 * This means the app is never accidentally left wide open — a token always
 * exists, and it survives restarts unless you set your own via env.
 */
export function getOrCreateAuthToken(): string {
  const envToken = process.env.APP_AUTH_TOKEN?.trim();
  if (envToken) return envToken;

  ensureDataDir();
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const existing = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
      if (existing) return existing;
    }
  } catch (err) {
    console.warn('[Auth] Could not read persisted token:', (err as Error).message);
  }

  const generated = crypto.randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(TOKEN_FILE, generated, { mode: 0o600 });
  } catch (err) {
    console.warn('[Auth] Could not persist generated token to disk:', (err as Error).message);
  }
  return generated;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Express middleware guarding every non-public route. Accepts the token via
 * `Authorization: Bearer <token>` (used by normal fetch calls) or a `token`
 * query param (needed for EventSource, which cannot set custom headers).
 */
export function createAuthMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers['authorization'];
    const headerToken = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7).trim()
      : undefined;
    const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
    const provided = headerToken || queryToken;

    if (provided && safeEqual(provided, token)) {
      return next();
    }
    res.status(401).json({ error: 'Unauthorized. A valid access token is required.' });
  };
}
