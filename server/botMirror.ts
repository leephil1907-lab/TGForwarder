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

async function botCall(method: string, payload: Record<string, unknown>): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    await fetch(`${API_BASE}/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, ...payload }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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
      const form = new FormData();
      form.append('chat_id', CHAT_ID);
      form.append('caption', caption.slice(0, 1024));
      const bytes = fs.readFileSync(tmp);
      const method = className === 'MessageMediaPhoto' ? 'sendPhoto' : /Video/.test(className) ? 'sendVideo' : 'sendDocument';
      form.append(method === 'sendPhoto' ? 'photo' : method === 'sendVideo' ? 'video' : 'document', new Blob([bytes]), `msg-${info.messageId}.mp4`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      try {
        await fetch(`${API_BASE}/bot${BOT_TOKEN}/${method}`, { method: 'POST', body: form as any, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    }
  } catch {
    try { await botCall('sendMessage', { text: `${header(info)}\n\n(⚠️ media could not be mirrored: delivery or download failed — check the dashboard log)` }); } catch { /* mirror must never throw */ }
  }
}

/** Fire-and-forget mirror of a captured message. Serialized, deduped, never throws. */
export function mirrorCapturedMessage(engine: any, message: any, info: { sourceId: string; sourceTitle: string; ruleName?: string }): void {
  if (!botMirrorConfigured()) return;
  try {
    const messageId = Number(message?.id || 0);
    if (!messageId) return;
    const key = `${info.sourceId}:${messageId}`;
    if (!remember(key)) return;
    chain = chain
      .then(() => mirrorNow(engine, message, { ...info, messageId }))
      .catch(() => { /* never break forwarding */ });
  } catch {
    /* never break forwarding */
  }
}
