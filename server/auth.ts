import './productionEnhancements.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { createTenantId, runWithTenant } from './tenantContext.js';

const DATA_DIR = process.env.TG_DATA_DIR || path.join(process.cwd(), '.data');
const TOKEN_FILE = path.join(DATA_DIR, 'auth_token.txt');
export const SESSION_COOKIE = 'tgforwarder_session';
const SESSION_MAX_AGE_SECONDS = 31536000;
function ensureDataDir(){if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});}
export function getOrCreateAuthToken():string{const env=process.env.APP_AUTH_TOKEN?.trim();if(env)return env;ensureDataDir();try{if(fs.existsSync(TOKEN_FILE)){const v=fs.readFileSync(TOKEN_FILE,'utf8').trim();if(v)return v;}}catch(err){console.warn('[Auth] Could not read persisted token:',(err as Error).message);}const generated=crypto.randomBytes(24).toString('hex');try{fs.writeFileSync(TOKEN_FILE,generated,{mode:0o600});}catch(err){console.warn('[Auth] Could not persist generated token:',(err as Error).message);}return generated;}
function safeEqual(a:string,b:string){const A=Buffer.from(a),B=Buffer.from(b);return A.length===B.length&&crypto.timingSafeEqual(A,B);}
function parseCookies(header?:string):Record<string,string>{const out:Record<string,string>={};for(const part of String(header||'').split(';')){const i=part.indexOf('=');if(i<=0)continue;const k=part.slice(0,i).trim(),v=part.slice(i+1).trim();try{out[k]=decodeURIComponent(v);}catch{out[k]=v;}}return out;}
export function getSessionId(req:Request){const v=parseCookies(req.headers.cookie)[SESSION_COOKIE];return v&&/^[a-f0-9]{48}$/.test(v)?v:'';}

export function createAuthMiddleware(token:string){return(req:Request,res:Response,next:NextFunction)=>{const header=req.headers['authorization'];const headerToken=typeof header==='string'&&header.startsWith('Bearer ')?header.slice(7).trim():undefined;const queryToken=typeof req.query.token==='string'?req.query.token:undefined;const provided=headerToken||queryToken;if(!provided||!safeEqual(provided,token))return res.status(401).json({error:'Unauthorized. A valid access token is required.'});let sessionId=getSessionId(req);if(!sessionId){sessionId=createTenantId();res.setHeader('Set-Cookie',`${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${process.env.NODE_ENV==='production'?'; Secure':''}`);} (req as any).tenantId=sessionId;return runWithTenant(sessionId,()=>next());};}