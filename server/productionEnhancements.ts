import type { Response } from 'express';
import { TelegramEngine } from './telegramEngine.js';

const engineProto = TelegramEngine.prototype as any;

const safeString = (value: any): string | null => {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
};

const mediaMeta = (message: any) => {
  const media = message?.media;
  const document = message?.document || media?.document;
  const attributes = Array.isArray(document?.attributes) ? document.attributes : [];
  const videoAttribute = attributes.find((a: any) => a?.className === 'DocumentAttributeVideo' || (a?.duration !== undefined && (a?.w !== undefined || a?.h !== undefined)));
  const audioAttribute = attributes.find((a: any) => a?.className === 'DocumentAttributeAudio' || a?.voice === true);
  const fileAttribute = attributes.find((a: any) => a?.fileName);
  const mimeType = document?.mimeType || media?.mimeType || null;
  const isPhoto = Boolean(message?.photo) || String(mimeType || '').toLowerCase().startsWith('image/');
  const isVideo = Boolean(message?.video) || Boolean(videoAttribute) || String(mimeType || '').toLowerCase().startsWith('video/');
  const isVoice = Boolean(message?.voice) || Boolean(audioAttribute?.voice);
  const isAudio = Boolean(message?.audio) || Boolean(audioAttribute) || String(mimeType || '').toLowerCase().startsWith('audio/');
  const isAnimation = Boolean(message?.gif) || String(mimeType || '').toLowerCase() === 'image/gif';
  const mediaType = isPhoto ? 'photo' : isVideo ? 'video' : isVoice ? 'voice' : isAudio ? 'audio' : isAnimation ? 'animation' : document ? 'document' : media ? 'media' : null;
  const size = document?.size ?? media?.size ?? null;
  const duration = videoAttribute?.duration ?? audioAttribute?.duration ?? null;
  const width = videoAttribute?.w ?? null;
  const height = videoAttribute?.h ?? null;
  return { mediaType, mimeType, fileName: safeString(fileAttribute?.fileName), size: typeof size === 'number' ? size : null, duration: typeof duration === 'number' ? duration : null, width: typeof width === 'number' ? width : null, height: typeof height === 'number' ? height : null, hasMedia: Boolean(media) };
};

const parseRange = (header: string | undefined, size: number) => {
  if (!header || !header.startsWith('bytes=')) return null;
  const first = header.slice(6).split(',')[0].trim();
  const match = first.match(/^(\d*)-(\d*)$/);
  if (!match) return null;
  let start: number; let end: number;
  if (match[1] === '' && match[2] === '') return null;
  if (match[1] === '') { const suffix = Number(match[2]); if (!Number.isFinite(suffix) || suffix <= 0) return null; start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] === '' ? size - 1 : Number(match[2]); }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
};

// ==================== disk-backed media cache ====================
// Media/thumbnails are downloaded to disk once (gramJS streams to the file —
// the Node process never holds the file in RAM) and then served with ranged
// streams from the cache. Concurrent requests for the same media share one
// download. Total cache size is capped with oldest-first eviction.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
const MEDIA_CACHE_DIR = path.join(process.env.TG_DATA_DIR || path.join(process.cwd(), '.data'), 'mediacache');
const MEDIA_CACHE_MAX_FILES = 600;
const MEDIA_CACHE_MAX_BYTES = (Number(process.env.TG_MEDIA_CACHE_MAX_GB) || 2) * 1024 * 1024 * 1024;
const mediaCacheKey = (sourceId: string, messageId: number, kind: string) => crypto.createHash('sha1').update(`${sourceId}:${messageId}:${kind}`).digest('hex');
const inflightMedia = new Map<string, Promise<string>>();
const evictMediaCache = () => {
  try {
    if (!fs.existsSync(MEDIA_CACHE_DIR)) return;
    const entries = fs.readdirSync(MEDIA_CACHE_DIR).map((name) => {
      const full = path.join(MEDIA_CACHE_DIR, name);
      const stat = fs.statSync(full);
      return { full, size: stat.size, mtime: stat.mtimeMs };
    });
    const totalBytes = entries.reduce((acc, e) => acc + e.size, 0);
    if (entries.length <= MEDIA_CACHE_MAX_FILES && totalBytes <= MEDIA_CACHE_MAX_BYTES) return;
    const overflow = Math.max(entries.length - MEDIA_CACHE_MAX_FILES, 0);
    let bytesToRemove = Math.max(totalBytes - MEDIA_CACHE_MAX_BYTES, 0);
    entries.sort((a, b) => a.mtime - b.mtime);
    for (const entry of entries) {
      if (overflow > 0 || bytesToRemove > 0) {
        try { fs.rmSync(entry.full, { force: true }); } catch { /* best effort */ }
        if (overflow > 0) { /* counted via loop index below */ }
        bytesToRemove -= entry.size;
      } else break;
    }
    void overflow;
  } catch { /* cache is best-effort */ }
};
const getOrDownloadMediaFile = (cacheKey: string, download: (outputFile: string) => Promise<unknown>): Promise<string> => {
  const cached = path.join(MEDIA_CACHE_DIR, cacheKey);
  if (fs.existsSync(cached)) return Promise.resolve(cached);
  const existing = inflightMedia.get(cacheKey);
  if (existing) return existing;
  const task = (async () => {
    fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true });
    const tmp = `${cached}.part-${Date.now()}`;
    await download(tmp);
    fs.renameSync(tmp, cached);
    evictMediaCache();
    return cached;
  })().finally(() => inflightMedia.delete(cacheKey));
  inflightMedia.set(cacheKey, task);
  return task;
};
const serveMediaFile = (res: any, filePath: string, mime: string, filename: string, download: boolean, rangeHeader: string) => {
  const stat = fs.statSync(filePath);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}${filename ? `; filename="${filename.replace(/["\r\n]/g, '')}"` : ''}`);
  const range = parseRange(rangeHeader, stat.size);
  if (range) {
    res.status(206);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
    return fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
  }
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', String(stat.size));
  return fs.createReadStream(filePath).pipe(res);
};

const loadTelegramMessage = async (sourceId: string, messageId: number) => {
  const engine = TelegramEngine.getInstance();
  await engine.waitForInitialization();
  const client = (engine as any).client;
  if (!client || engine.getAuthState().status !== 'connected') throw Object.assign(new Error('Telegram account is not connected.'), { status: 401 });
  const entity = await (engine as any).resolveEntity(sourceId);
  const result = await client.getMessages(entity, { ids: [messageId] });
  const message: any = Array.isArray(result) ? result[0] : result;
  if (!message || !message.media) throw Object.assign(new Error('Telegram media was not found.'), { status: 404 });
  return { client, message, meta: mediaMeta(message) };
};

try {
  const express = await import('express');
  const appProto: any = (express as any).application;
  if (appProto && !appProto.__tgforwarderHistoryMediaV4) {
    const originalGet = appProto.get;
    appProto.get = function (routePath: any, ...handlers: any[]) {
      if (routePath === '/api/history' && handlers.length) {
        const last = handlers[handlers.length - 1];
        handlers[handlers.length - 1] = async function (req: any, res: Response, next: any) {
          const originalJson = res.json.bind(res);
          res.json = (body: any) => {
            if (body?.success && Array.isArray(body.messages)) {
              const sourceId = String(req.query?.sourceId || '');
              body = { ...body, messages: body.messages.map((m: any) => ({ ...m, mediaUrl: m.hasMedia && Number.isFinite(Number(m.id)) ? `/api/history/media?sourceId=${encodeURIComponent(sourceId)}&messageId=${encodeURIComponent(String(m.id))}` : null, thumbnailUrl: m.hasMedia && Number.isFinite(Number(m.id)) ? `/api/history/media/thumbnail?sourceId=${encodeURIComponent(sourceId)}&messageId=${encodeURIComponent(String(m.id))}` : null })) };
            }
            return originalJson(body);
          };
          return last.call(this, req, res, next);
        };
        const result = originalGet.call(this, routePath, ...handlers);

        originalGet.call(this, '/api/history/media', async (req: any, res: Response) => {
          try {
            const sourceId = String(req.query?.sourceId || '').trim();
            const messageId = Number(req.query?.messageId || 0);
            if (!sourceId || !Number.isFinite(messageId) || messageId <= 0) return res.status(400).json({ error: 'sourceId and messageId are required.' });
            const { client, message, meta } = await loadTelegramMessage(sourceId, messageId);
            const mime = meta.mimeType || (meta.mediaType === 'photo' ? 'image/jpeg' : meta.mediaType === 'video' ? 'video/mp4' : 'application/octet-stream');
            // Streamed through a disk cache: the file is downloaded once by gramJS
            // directly to disk and then served in ranges — the process RAM stays flat.
            const cacheKey = mediaCacheKey(sourceId, messageId, 'full');
            const filePath = await getOrDownloadMediaFile(cacheKey, (outputFile) => client.downloadMedia(message, { outputFile, workers: 1 }));
            return serveMediaFile(res, filePath, mime, meta.fileName || '', req.query?.dl === '1', String(req.headers.range || ''));
          } catch (error: any) {
            const status = Number(error?.status) || 502;
            return res.status(status).json({ error: error?.message || 'Unable to load Telegram media.' });
          }
        });

        originalGet.call(this, '/api/history/media/thumbnail', async (req: any, res: Response) => {
          try {
            const sourceId = String(req.query?.sourceId || '').trim();
            const messageId = Number(req.query?.messageId || 0);
            if (!sourceId || !Number.isFinite(messageId) || messageId <= 0) return res.status(400).json({ error: 'sourceId and messageId are required.' });
            const { client, message, meta } = await loadTelegramMessage(sourceId, messageId);
            // Smallest-available thumbnail, disk-cached and de-duplicated: a grid
            // of N concurrent requests shares ONE Telegram download.
            const cacheKey = mediaCacheKey(sourceId, messageId, 'thumb');
            const filePath = await getOrDownloadMediaFile(cacheKey, (outputFile) => client.downloadMedia(message, { outputFile, thumb: -1, workers: 1 }));
            const mime = meta.mediaType === 'photo' || meta.mediaType === 'video' || meta.mediaType === 'animation' ? 'image/jpeg' : 'application/octet-stream';
            return serveMediaFile(res, filePath, mime, '', false, String(req.headers.range || ''));
          } catch (error: any) {
            const status = Number(error?.status) || 502;
            return res.status(status).json({ error: error?.message || 'Unable to load Telegram thumbnail.' });
          }
        });
        return result;
      }
      return originalGet.call(this, routePath, ...handlers);
    };
    appProto.__tgforwarderHistoryMediaV4 = true;
  }
} catch (error) {
  console.warn('[TGForwarder] History media enhancement could not initialize:', (error as any)?.message || error);
}

if (!engineProto.__tgforwarderDeterministicDiscoveryV1) {
  const originalDiscover = engineProto.discoverChats;
  if (typeof originalDiscover === 'function') {
    engineProto.discoverChats = async function () {
      const chats = await originalDiscover.call(this);
      const unique = new Map<string, any>();
      for (const chat of Array.isArray(chats) ? chats : []) {
        if (!chat?.id) continue;
        unique.set(String(chat.id), { ...chat, id: String(chat.id), title: String(chat.title || 'Unnamed Telegram chat'), isPrivate: Boolean(chat.isPrivate), accountBound: true, verifiedAt: Date.now() });
      }
      return Array.from(unique.values()).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    };
  }
  engineProto.__tgforwarderDeterministicDiscoveryV1 = true;
}
