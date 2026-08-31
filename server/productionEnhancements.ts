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
  const isPhoto = Boolean(message?.photo);
  const isVideo = Boolean(message?.video) || Boolean(videoAttribute) || String(mimeType || '').toLowerCase().startsWith('video/');
  const isVoice = Boolean(message?.voice) || Boolean(audioAttribute?.voice);
  const isAudio = Boolean(message?.audio) || Boolean(audioAttribute) || String(mimeType || '').toLowerCase().startsWith('audio/');
  const isAnimation = Boolean(message?.gif) || String(mimeType || '').toLowerCase() === 'image/gif';
  const mediaType = isPhoto ? 'photo' : isVideo ? 'video' : isVoice ? 'voice' : isAudio ? 'audio' : isAnimation ? 'animation' : document ? 'document' : media ? 'media' : null;
  const size = document?.size ?? media?.size ?? null;
  const duration = videoAttribute?.duration ?? audioAttribute?.duration ?? null;
  const width = videoAttribute?.w ?? null;
  const height = videoAttribute?.h ?? null;
  return {
    mediaType,
    mimeType,
    fileName: safeString(fileAttribute?.fileName),
    size: typeof size === 'number' ? size : null,
    duration: typeof duration === 'number' ? duration : null,
    width: typeof width === 'number' ? width : null,
    height: typeof height === 'number' ? height : null,
    hasMedia: Boolean(media)
  };
};

const parseRange = (header: string | undefined, size: number) => {
  if (!header || !header.startsWith('bytes=')) return null;
  const first = header.slice(6).split(',')[0].trim();
  const match = first.match(/^(\d*)-(\d*)$/);
  if (!match) return null;
  const startRaw = match[1];
  const endRaw = match[2];
  let start: number;
  let end: number;
  if (startRaw === '' && endRaw === '') return null;
  if (startRaw === '') {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? size - 1 : Number(endRaw);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
};

try {
  const express = await import('express');
  const appProto: any = (express as any).application;
  if (appProto && !appProto.__tgforwarderHistoryMediaV3) {
    const originalGet = appProto.get;
    appProto.get = function (routePath: any, ...handlers: any[]) {
      if (routePath === '/api/history' && handlers.length) {
        const last = handlers[handlers.length - 1];
        handlers[handlers.length - 1] = async function (req: any, res: Response, next: any) {
          const originalJson = res.json.bind(res);
          res.json = (body: any) => {
            if (body?.success && Array.isArray(body.messages)) {
              const sourceId = String(req.query?.sourceId || '');
              body = {
                ...body,
                messages: body.messages.map((m: any) => ({
                  ...m,
                  mediaUrl: m.hasMedia && Number.isFinite(Number(m.id))
                    ? `/api/history/media?sourceId=${encodeURIComponent(sourceId)}&messageId=${encodeURIComponent(String(m.id))}`
                    : null
                }))
              };
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
            if (!sourceId || !Number.isFinite(messageId) || messageId <= 0) {
              return res.status(400).json({ error: 'sourceId and messageId are required.' });
            }

            const engine = TelegramEngine.getInstance();
            await engine.waitForInitialization();
            const client = (engine as any).client;
            if (!client || engine.getAuthState().status !== 'connected') {
              return res.status(401).json({ error: 'Telegram account is not connected.' });
            }

            const entity = await (engine as any).resolveEntity(sourceId);
            const result = await client.getMessages(entity, { ids: [messageId] });
            const message: any = Array.isArray(result) ? result[0] : result;
            if (!message || !message.media) return res.status(404).json({ error: 'Telegram media was not found.' });

            const meta = mediaMeta(message);
            const mime = meta.mimeType || (meta.mediaType === 'photo' ? 'image/jpeg' : meta.mediaType === 'video' ? 'video/mp4' : 'application/octet-stream');
            const downloaded = await client.downloadMedia(message, { workers: 1 });
            if (!downloaded) return res.status(404).json({ error: 'Telegram media could not be downloaded.' });
            const body = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as any);
            if (body.length > 150 * 1024 * 1024) {
              return res.status(413).json({ error: 'This Telegram media file is too large for in-browser preview.' });
            }

            const range = parseRange(req.headers.range, body.length);
            const filename = meta.fileName ? meta.fileName.replace(/["\r\n]/g, '') : '';
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', 'private, max-age=60');
            res.setHeader('Content-Disposition', `inline${filename ? `; filename="${filename}"` : ''}`);

            if (range) {
              const chunk = body.subarray(range.start, range.end + 1);
              res.status(206);
              res.setHeader('Content-Type', mime);
              res.setHeader('Content-Length', String(chunk.length));
              res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${body.length}`);
              return res.end(chunk);
            }

            res.setHeader('Content-Type', mime);
            res.setHeader('Content-Length', String(body.length));
            return res.end(body);
          } catch (error: any) {
            return res.status(502).json({ error: error?.message || 'Unable to load Telegram media.' });
          }
        });
        return result;
      }
      return originalGet.call(this, routePath, ...handlers);
    };
    appProto.__tgforwarderHistoryMediaV3 = true;
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
        unique.set(String(chat.id), {
          ...chat,
          id: String(chat.id),
          title: String(chat.title || 'Unnamed Telegram chat'),
          isPrivate: Boolean(chat.isPrivate),
          accountBound: true,
          verifiedAt: Date.now()
        });
      }
      return Array.from(unique.values()).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    };
  }
  engineProto.__tgforwarderDeterministicDiscoveryV1 = true;
}
