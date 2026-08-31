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
  const video = message?.video || media?.video;
  const audio = message?.audio;
  const voice = message?.voice;
  const fileName = document?.attributes?.find?.((a: any) => a?.fileName)?.fileName || null;
  const mimeType = document?.mimeType || media?.mimeType || null;
  const size = document?.size ?? media?.size ?? null;
  const duration = video?.duration ?? audio?.duration ?? voice?.duration ?? null;
  const width = video?.w ?? video?.width ?? null;
  const height = video?.h ?? video?.height ?? null;
  return {
    mediaType: message?.video ? 'video' : message?.photo ? 'photo' : message?.document ? 'document' : message?.audio ? 'audio' : message?.voice ? 'voice' : message?.gif ? 'animation' : media ? 'media' : null,
    mimeType,
    fileName: safeString(fileName),
    size: typeof size === 'number' ? size : null,
    duration: typeof duration === 'number' ? duration : null,
    width: typeof width === 'number' ? width : null,
    height: typeof height === 'number' ? height : null,
    hasMedia: Boolean(media)
  };
};

try {
  const express = await import('express');
  const appProto: any = (express as any).application;
  if (appProto && !appProto.__tgforwarderHistoryMediaV1) {
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
            const mime = meta.mimeType || (meta.mediaType === 'photo' ? 'image/jpeg' : 'application/octet-stream');
            const downloaded = await client.downloadMedia(message, { workers: 1 });
            if (!downloaded) return res.status(404).json({ error: 'Telegram media could not be downloaded.' });
            const body = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded as any);
            if (body.length > 150 * 1024 * 1024) {
              return res.status(413).json({ error: 'This Telegram media file is too large for in-browser preview.' });
            }
            res.setHeader('Content-Type', mime);
            res.setHeader('Content-Length', String(body.length));
            res.setHeader('Cache-Control', 'private, max-age=60');
            res.setHeader('Content-Disposition', `inline${meta.fileName ? `; filename="${meta.fileName.replace(/"/g, '')}"` : ''}`);
            return res.end(body);
          } catch (error: any) {
            return res.status(502).json({ error: error?.message || 'Unable to load Telegram media.' });
          }
        });
        return result;
      }
      return originalGet.call(this, routePath, ...handlers);
    };
    appProto.__tgforwarderHistoryMediaV1 = true;
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
