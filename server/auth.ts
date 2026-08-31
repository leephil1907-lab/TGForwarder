import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { createTenantId } from './tenantContext.js';

const DATA_DIR = process.env.TG_DATA_DIR || path.join(process.cwd(), '.data');
const TOKEN_FILE = path.join(DATA_DIR, 'auth_token.txt');
export const SESSION_COOKIE = 'tgforwarder_session';

function ensureDataDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

export function getOrCreateAuthToken(): string {
  const envToken = process.env.APP_AUTH_TOKEN?.trim();
  if (envToken) return envToken;
  ensureDataDir();
  try { if (fs.existsSync(TOKEN_FILE)) { const existing = fs.readFileSync(TOKEN_FILE, 'utf-8').trim(); if (existing) return existing; } } catch (err) { console.warn('[Auth] Could not read persisted token:', (err as Error).message); }
  const generated = crypto.randomBytes(24).toString('hex');
  try { fs.writeFileSync(TOKEN_FILE, generated, { mode: 0o600 }); } catch (err) { console.warn('[Auth] Could not persist generated token:', (err as Error).message); }
  return generated;
}

function safeEqual(a: string, b: string): boolean { const A=Buffer.from(a), B=Buffer.from(b); return A.length===B.length && crypto.timingSafeEqual(A,B); }
function parseCookies(header?: string): Record<string,string> {
  const result: Record<string,string> = {};
  for (const part of String(header || '').split(';')) { const i=part.indexOf('='); if(i<=0)continue; const k=part.slice(0,i).trim(); const v=part.slice(i+1).trim(); try{result[k]=decodeURIComponent(v);}catch{result[k]=v;} }
  return result;
}
export function getSessionId(req: Request): string { const value=parseCookies(req.headers.cookie)[SESSION_COOKIE]; return value && /^[a-f0-9]{48}$/.test(value) ? value : ''; }

/** Shared access key + independent HttpOnly browser session. */
export function createAuthMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header=req.headers['authorization'];
    const headerToken=typeof header==='string'&&header.startsWith('Bearer ')?header.slice(7).trim():undefined;
    const queryToken=typeof req.query.token==='string'?req.query.token:undefined;
    const provided=headerToken||queryToken;
    if(!provided||!safeEqual(provided,token)) return res.status(401).json({error:'Unauthorized. A valid access token is required.'});
    let sessionId=getSessionId(req);
    if(!sessionId){
      sessionId=createTenantId();
      res.setHeader('Set-Cookie',`${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV==='production'?'; Secure':''}`);
    }
    (req as any).tenantId=sessionId;
    return next();
  };
}
