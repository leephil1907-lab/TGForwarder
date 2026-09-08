import fs from 'fs';
import path from 'path';

/**
 * Telegram Archive Bot — mirrors every captured post (text + media) from
 * private/restricted sources into a Telegram bot chat you control.
 *
 * Optional. Enable with env vars:
 *   ARCHIVE_BOT_TOKEN=123456:ABC…   (any bot from @BotFather)
 *   ARCHIVE_CHAT_ID=123456789       (your chat with the bot, or an archive
 *                                    channel where the bot has post rights)
 *   TG_BOT_API_BASE (optional, overrides https://api.telegram.org — used by tests)
 *
 * Mirroring happens at CAPTURE time (independent of rule delivery), runs
 * through a serialized queue, de-duplicates by message, and can never break
 * forwarding. Bot API media uploads are capped at 50 MB; larger files get a
 * text notice pointing at the dashboard.
 */

const BOT_TOKEN = process.env.ARCHIVE_BOT_TOKEN?.trim() || '';
const CHAT_ID = process.env.ARCHIVE_CHAT_ID?.trim() || '';
const API_BASE = (process.env.TG_BOT_API_BASE?.trim() || 'https://api.telegram.org').replace(/\/$/, '');
const MIRROR_MEDIA_MAX_BYTES = 50 * 1024 * 1024; // Bot API upload limit
const DEDUPE_MAX = 5000;

const mirroredKeys = new Map<string, true>(); // LRU-ish dedupe
let chain: Promise<void> = Promise.resolve();

export function botMirrorConfigured(): boolean {
  return Boolean(BOT_TOKEN && CHAT_ID);
}

function remember(key: string): boolean {
  if (mirroredKeys.has(key)) return false;
  mirroredKeys.set(key, true);
  if (mirroredKeys.size > DEDUPE_MAX) {
    const first = mirroredKeys.keys().next().value;
    if (first) mirroredKeys.delete(first);
  }
  return true;
}

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a Bot API request, honouring Telegram's 429 flood control
 * (parameters.retry_after) with up to 4 attempts. Never throws.
 */
async function botFetch(attempt: () => Promise<Response>): Promise<void> {
  for (let i = 1; i <= 4; i++) {
    let res: Response;
    try {
      res = await attempt();
    } catch {
      if (i < 4) { await sleepMs(1500 * i); continue; }
      return;
    }
    if (res.status !== 429) return;
    let waitSec = 2;
    try { const j: any = await res.clone().json(); waitSec = Number(j?.parameters?.retry_after) || Number(res.headers.get('retry-after')) || 2; } catch { waitSec = Number(res.headers.get('retry-after')) || 2; }
    if (i < 4) await sleepMs(Math.min(waitSec, 30) * 1000 + 250);
  }
}

async function botCall(method: string, payload: Record<string, unknown>): Promise<void> {
  const send = () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    return fetch(`${API_BASE}/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, ...payload }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  };
  await botFetch(send);
}

const header = (info: { sourceTitle: string; messageId: number; ruleName?: string }) =>
  `📡 ${info.sourceTitle} · #${info.messageId}${info.ruleName ? ` · ${info.ruleName}` : ''}`;

async function mirrorNow(engine: any, message: any, info: { sourceId: string; sourceTitle: string; messageId: number; ruleName?: string }): Promise<void> {
  const caption = `${header(info)}${message?.message ? `\n\n${String(message.message).slice(0, 900)}` : ''}`;
  const media = message?.media || null;
  const className = String(media?.className || '');
  const size = Number(message?.document?.size ?? message?.file?.size ?? 0);

  try {
    if (!media) {
      await botCall('sendMessage', { text: caption });
      return;
    }
    if (size > MIRROR_MEDIA_MAX_BYTES) {
      await botCall('sendMessage', { text: `${header(info)}\n\n📦 Media is ${(size / 1048576).toFixed(1)} MB — too large for a bot upload. Preview/download it in the dashboard.` });
      return;
    }
    if (!engine?.client || typeof engine.client.downloadMedia !== 'function') {
      await botCall('sendMessage', { text: caption });
      return;
    }
    const dataDir = process.env.TG_DATA_DIR || path.join(process.cwd(), '.data');
    const dir = path.join(dataDir, 'botmirror');
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `msg${info.messageId}-${Date.now()}.bin`);
    await engine.client.downloadMedia(message, { outputFile: tmp });
    try {
      // Choose the Bot API method from the REAL media type: photos inline,
      // videos stream inline, round video notes stay round (sendVideoNote),
      // everything else goes as a document.
      const attrs = Array.isArray(message?.document?.attributes) ? message.document.attributes : [];
      const mime = String(message?.document?.mimeType || message?.media?.mimeType || '').toLowerCase();
      const isRoundNote = attrs.some((a: any) => a?.className === 'DocumentAttributeVideo' && a?.roundMessage);
      const isAnim = attrs.some((a: any) => a?.className === 'DocumentAttributeAnimated');
      const isVoice = attrs.some((a: any) => a?.className === 'DocumentAttributeAudio' && a?.voice) || /Voice/.test(className);
      const isAudio = !isVoice && (attrs.some((a: any) => a?.className === 'DocumentAttributeAudio') || mime.startsWith('audio/'));
      let method = 'sendDocument';
      if (className === 'MessageMediaPhoto' || mime.startsWith('image/')) method = 'sendPhoto';
      else if (isRoundNote) method = 'sendVideoNote';
      else if (isAnim) method = 'sendAnimation';
      else if (mime.startsWith('video/')) method = 'sendVideo';
      else if (isVoice) method = 'sendVoice';
      else if (isAudio) method = 'sendAudio';
      const field = method === 'sendPhoto' ? 'photo' : method === 'sendVideo' ? 'video' : method === 'sendVideoNote' ? 'video_note' : method === 'sendAnimation' ? 'animation' : method === 'sendVoice' ? 'voice' : method === 'sendAudio' ? 'audio' : 'document';
      const origName = String(attrs.find((a: any) => a?.className === 'DocumentAttributeFilename')?.fileName || '');
      const docExt = origName.match(/\.[a-z0-9]{1,5}$/i)?.[0] || '.bin';
      const ext = method === 'sendPhoto' ? '.jpg'
        : method === 'sendVoice' ? '.ogg'
        : method === 'sendAudio' ? (origName.match(/\.[a-z0-9]{1,5}$/i)?.[0] || '.mp3')
        : method === 'sendDocument' ? docExt
        : (mime.includes('webm') ? '.webm' : '.mp4');
      const form = new FormData();
      form.append('chat_id', CHAT_ID);
      if (method === 'sendVideo') form.append('supports_streaming', 'true');
      if (method !== 'sendVideoNote') form.append('caption', caption.slice(0, 1024));
      const bytes = fs.readFileSync(tmp);
      form.append(field, new Blob([bytes]), `msg-${info.messageId}${ext}`);
      await botFetch(() => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);
        return fetch(`${API_BASE}/bot${BOT_TOKEN}/${method}`, { method: 'POST', body: form as any, signal: controller.signal }).finally(() => clearTimeout(timer));
      });
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    }
  } catch {
    try { await botCall('sendMessage', { text: `${header(info)}\n\n(⚠️ media could not be mirrored: delivery or download failed — check the dashboard log)` }); } catch { /* mirror must never throw */ }
  }
}

/** Fire-and-forget mirror of a captured message. Serialized, deduped, never throws. Returns true when newly queued. */
export function mirrorCapturedMessage(engine: any, message: any, info: { sourceId: string; sourceTitle: string; ruleName?: string }): boolean {
  if (!botMirrorConfigured()) return false;
  try {
    const messageId = Number(message?.id || 0);
    if (!messageId) return false;
    const key = `${info.sourceId}:${messageId}`;
    if (!remember(key)) return false;
    chain = chain
      .then(() => mirrorNow(engine, message, { ...info, messageId }))
      .catch(() => { /* never break forwarding */ });
    return true;
  } catch {
    return false;
  }
}

/**
 * History backfill: mirror the newest `limit` posts of a source (paging the
 * channel history) into the bot. Dedupe makes re-runs safe. Returns the
 * number of newly queued messages.
 */
export async function mirrorHistory(engine: any, sourceId: string, limit = 100): Promise<number> {
  if (!botMirrorConfigured()) throw Object.assign(new Error('Archive bot is not configured (set ARCHIVE_BOT_TOKEN and ARCHIVE_CHAT_ID).'), { status: 400 });
  const client = engine?.client;
  if (!client || typeof client.getMessages !== 'function') throw Object.assign(new Error('Telegram account is not connected.'), { status: 401 });
  await engine.waitForInitialization?.();
  const entity = await engine.resolveEntity(sourceId);
  const title = String(entity?.title || sourceId);
  let offsetId = 0;
  let queued = 0;
  const seen = new Set<number>();
  while (queued < limit) {
    const batch: any[] = await client.getMessages(entity, { limit: Math.min(100, limit - queued), offsetId });
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const m of batch) {
      if (!m?.id || seen.has(Number(m.id))) continue;
      seen.add(Number(m.id));
      if (mirrorCapturedMessage(engine, m, { sourceId, sourceTitle: title, ruleName: 'history' })) queued++;
    }
    const nextOffset = Number(batch[batch.length - 1]?.id || 0);
    if (!nextOffset || nextOffset === offsetId) break;
    offsetId = nextOffset;
  }
  return queued;
}
