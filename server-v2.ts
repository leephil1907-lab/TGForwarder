import express from 'express';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer as createViteServer } from 'vite';
import { TelegramEngine } from './server/telegramEngine.js';
import { StorageManager } from './server/storage.js';
import { getOrCreateAuthToken, createAuthMiddleware } from './server/auth.js';

const clearEngineLogs = (engine: TelegramEngine) => {
  const raw = engine as any;
  if (Array.isArray(raw.recentLogs)) raw.recentLogs = [];
  if (typeof raw.broadcast === 'function') raw.broadcast('LOGS_CLEARED', { timestamp: Date.now() });
};

const getClient = (engine: TelegramEngine): any => {
  const client = (engine as any).client;
  if (!client) throw new Error('Telegram is not connected. Connect an account first.');
  return client;
};

const normalizeTelegramTimestamp = (value: any): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value < 100000000000 ? Math.round(value * 1000) : Math.round(value);
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 100000000000 ? Math.round(numeric * 1000) : Math.round(numeric);
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const normalizeHistoryMessage = (message: any) => {
  const media = message.media;
  let mediaType: string | null = null;
  if (message.photo) mediaType = 'photo';
  else if (message.video) mediaType = 'video';
  else if (message.document) mediaType = 'document';
  else if (message.audio) mediaType = 'audio';
  else if (message.voice) mediaType = 'voice';
  else if (message.gif) mediaType = 'animation';
  else if (media) mediaType = 'media';
  return { id: Number(message.id), date: normalizeTelegramTimestamp(message.date), text: message.message || message.text || '', mediaType, hasMedia: Boolean(media), views: message.views ?? null, forwards: message.forwards ?? null, senderId: message.senderId?.toString?.() ?? null, groupedId: message.groupedId?.toString?.() ?? null };
};

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const HOST = process.env.HOST || '0.0.0.0';
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '4mb' }));
  const AUTH_TOKEN = getOrCreateAuthToken();
  const requireAuth = createAuthMiddleware(AUTH_TOKEN);
  const authRateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many authentication attempts. Please wait and try again.' } });
  const apiRateLimiter = rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false });
  const engine = TelegramEngine.getInstance();
  const storage = StorageManager.getInstance();
  engine.initializeFromStorage().catch((err) => console.warn('[Server] Auto-connect skipped or failed:', err.message));

  const handleHealthCheck = async (_req: express.Request, res: express.Response) => {
    await engine.waitForInitialization();
    const authState = engine.getAuthState();
    res.json({ status: 'ok', worker: { status: authState.status === 'connected' ? 'online' : 'offline', engineRunning: engine.isEngineRunning(), isPaused: engine.isEnginePaused() }, engineRunning: engine.isEngineRunning(), isPaused: engine.isEnginePaused(), authStatus: authState.status, authenticated: authState.status === 'connected', userProfile: authState.userProfile, timestamp: Date.now() });
  };
  app.get('/api/health', handleHealthCheck);
  app.get('/api/health/status', handleHealthCheck);
  app.use('/api', apiRateLimiter, requireAuth);
  app.use('/api/auth', authRateLimiter);

  app.get('/api/config', async (_req, res) => { await engine.waitForInitialization(); res.json(storage.getSafeConfig()); });
  app.post('/api/config', (req, res) => { const { apiId, apiHash, defaultRemoveSignature, retryOnFloodWait, globalRateLimit, accounts } = req.body; storage.saveConfig({ ...(apiId !== undefined && { apiId }), ...(apiHash !== undefined && { apiHash }), ...(defaultRemoveSignature !== undefined && { defaultRemoveSignature }), ...(retryOnFloodWait !== undefined && { retryOnFloodWait }), ...(globalRateLimit !== undefined && { globalRateLimit }), ...(accounts !== undefined && { accounts }) }); res.json(storage.getSafeConfig()); });

  app.get('/api/auth/status', async (_req, res) => { await engine.waitForInitialization(); res.json(engine.getAuthState()); });
  app.post('/api/auth/request-code', async (req, res) => { try { clearEngineLogs(engine); const { apiId, apiHash, phoneNumber } = req.body; if (!apiId || !apiHash || !phoneNumber) return res.status(400).json({ error: 'API ID, API Hash, and Phone Number are required.' }); res.json(await engine.requestPhoneCode(apiId, apiHash, phoneNumber)); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to request verification code' }); } });
  app.post('/api/auth/verify-code', async (req, res) => { try { const { phoneCode } = req.body; if (!phoneCode) return res.status(400).json({ error: 'Phone verification code is required.' }); res.json(await engine.verifyCode(phoneCode)); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to verify code' }); } });
  app.post('/api/auth/verify-2fa', async (req, res) => { try { const { password } = req.body; if (!password) return res.status(400).json({ error: '2FA password is required.' }); res.json(await engine.verify2FA(password)); } catch (err: any) { res.status(500).json({ error: err.message || '2FA verification failed' }); } });
  app.post('/api/auth/bot-login', async (req, res) => { try { clearEngineLogs(engine); const { apiId, apiHash, botToken } = req.body; if (!apiId || !apiHash || !botToken) return res.status(400).json({ error: 'API ID, API Hash, and Bot Token are required.' }); res.json(await engine.connectWithBotToken(apiId, apiHash, botToken)); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to connect bot' }); } });
  app.post('/api/auth/session-login', async (req, res) => { try { clearEngineLogs(engine); const { apiId, apiHash, sessionString } = req.body; if (!apiId || !apiHash || !sessionString) return res.status(400).json({ error: 'API ID, API Hash, and Session String are required.' }); res.json(await engine.connectWithStringSession(apiId, apiHash, sessionString)); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to connect session' }); } });
  app.post('/api/auth/disconnect', async (_req, res) => { try { await engine.disconnect(); clearEngineLogs(engine); res.json({ success: true, message: 'Disconnected successfully. Session activity was cleared.' }); } catch (err: any) { clearEngineLogs(engine); res.status(500).json({ error: err.message || 'Error disconnecting' }); } });

  app.get('/api/chats/discover', async (_req, res) => { try { res.json({ success: true, chats: await engine.discoverChats() }); } catch (err: any) { res.status(500).json({ error: err.message || 'Error discovering chats' }); } });
  app.post('/api/chats/verify-permissions', async (req, res) => { try { const { sourceId, targetIds } = req.body; if (!sourceId || !Array.isArray(targetIds) || !targetIds.length) return res.status(400).json({ error: 'sourceId and targetIds array are required.' }); res.json(await engine.verifyPipelinePermissions(sourceId, targetIds)); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to verify pipeline permissions' }); } });
  app.post('/api/chats/test-target', async (req, res) => { try { if (!req.body.targetId) return res.status(400).json({ error: 'Target ID is required.' }); res.json(await engine.testTargetAccess(req.body.targetId, req.body.testMessage)); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to verify target entity' }); } });

  app.get('/api/rules', (_req, res) => res.json(storage.getConfig().rules));
  app.post('/api/rules', (req, res) => { try { const { name, sourceId, sourceTitle, sourceUsername, targetIds, targetTitles, removeForwardSignature, duplicateProtection, filterKeywords, dropLinks, prependText, appendText, enabled } = req.body; if (!sourceId || !Array.isArray(targetIds) || !targetIds.length) return res.status(400).json({ error: 'Source ID and at least one Target ID are required.' }); res.json(storage.addRule({ name: name || `Funnel: ${sourceTitle || sourceId}`, sourceId: sourceId.trim(), sourceTitle: sourceTitle || sourceId, sourceUsername, targetIds: targetIds.map((t: string) => t.trim()), targetTitles: targetTitles || targetIds, removeForwardSignature: removeForwardSignature ?? true, duplicateProtection: duplicateProtection ?? true, filterKeywords: filterKeywords || [], dropLinks: dropLinks ?? false, prependText: prependText || '', appendText: appendText || '', enabled: enabled ?? true })); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to save rule' }); } });
  app.put('/api/rules/:id', (req, res) => { try { const updated = storage.updateRule(req.params.id, req.body); if (!updated) return res.status(404).json({ error: 'Rule not found' }); res.json(updated); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to update rule' }); } });
  app.delete('/api/rules/:id', (req, res) => res.json({ success: storage.deleteRule(req.params.id) }));

  app.post('/api/engine/start', async (_req, res) => { try { res.json(await engine.startEngine()); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to start engine' }); } });
  app.post('/api/engine/stop', async (_req, res) => { try { await engine.stopEngine(); res.json({ success: true, message: 'Forwarding engine stopped.' }); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to stop engine' }); } });
  app.post('/api/engine/pause', (_req, res) => { try { res.json(engine.pauseEngine()); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to pause engine' }); } });
  app.post('/api/engine/resume', (_req, res) => { try { res.json(engine.resumeEngine()); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to resume engine' }); } });
  app.get('/api/stats', (_req, res) => res.json(engine.getStats()));
  app.get('/api/logs', (_req, res) => res.json(engine.getRecentLogs()));
  app.post('/api/logs/clear', (_req, res) => { clearEngineLogs(engine); res.json({ success: true }); });
  app.get('/api/mappings', (req, res) => { const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100; res.json({ totalCount: storage.getMappingsCount(), mappings: storage.getAllMappings(limit) }); });

  app.get('/api/pending', (_req, res) => { res.json({ success: true, posts: (engine as any).getPendingPosts?.() || [] }); });
  app.post('/api/pending/:key/publish', async (req, res) => { try { const key = decodeURIComponent(req.params.key); const result = await (engine as any).publishPendingPost?.(key, typeof req.body?.text === 'string' ? req.body.text : undefined); if (!result) return res.status(500).json({ error: 'Manual publishing is unavailable.' }); res.json(result); } catch (err: any) { res.status(502).json({ error: err.message || 'Failed to publish pending Telegram post.' }); } });
  app.delete('/api/pending/:key', (req, res) => { const key = decodeURIComponent(req.params.key); const result = (engine as any).discardPendingPost?.(key); res.json(result || { success: false }); });

  app.get('/api/history', async (req, res) => {
    try {
      const sourceId = String(req.query.sourceId || '').trim();
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
      const offsetId = Math.max(parseInt(String(req.query.offsetId || '0'), 10) || 0, 0);
      if (!sourceId) return res.status(400).json({ error: 'sourceId is required.' });
      const sourceEntity = await (engine as any).resolveEntity(sourceId);
      const client = getClient(engine);
      const messages: any[] = [];
      for await (const message of client.iterMessages(sourceEntity, { limit, offsetId: offsetId || undefined })) messages.push(normalizeHistoryMessage(message));
      const nextOffsetId = messages.length ? messages[messages.length - 1].id : null;
      res.json({ success: true, sourceId, count: messages.length, messages, nextOffsetId, hasMore: messages.length === limit && nextOffsetId !== null });
    } catch (err: any) { res.status(500).json({ error: err.message || 'Unable to retrieve Telegram history.' }); }
  });

  app.post('/api/history/forward', async (req, res) => {
    try {
      const { sourceId, messageId, targetIds, text } = req.body;
      if (!sourceId || !messageId || !Array.isArray(targetIds) || !targetIds.length) return res.status(400).json({ error: 'sourceId, messageId and targetIds are required.' });
      const sourceEntity = await (engine as any).resolveEntity(String(sourceId));
      const client = getClient(engine);
      const sourceMessages = await client.getMessages(sourceEntity, { ids: [Number(messageId)] });
      const sourceMessage = Array.isArray(sourceMessages) ? sourceMessages[0] : sourceMessages;
      if (!sourceMessage) return res.status(404).json({ error: 'Telegram source message was not found.' });
      const finalText = typeof text === 'string' ? text : (sourceMessage.message || sourceMessage.text || '');
      const results: any[] = [];
      for (const rawTargetId of targetIds) {
        const targetId = String(rawTargetId).trim();
        try {
          const targetEntity = await (engine as any).resolveEntity(targetId);
          let sent: any;
          if (sourceMessage.media) sent = await client.sendFile(targetEntity, { file: sourceMessage.media, caption: finalText });
          else sent = await client.sendMessage(targetEntity, { message: finalText });
          results.push({ targetId, success: true, targetMessageId: sent?.id ?? null });
        } catch (err: any) { results.push({ targetId, success: false, error: err.message || 'Telegram send failed' }); }
      }
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success);
      (engine as any).log?.({ level: succeeded === targetIds.length ? 'success' : 'error', category: 'forward', title: succeeded === targetIds.length ? 'Manual Post Forward' : 'Manual Post Forward Failed', message: succeeded === targetIds.length ? `Published Telegram message ${messageId} to ${succeeded}/${targetIds.length} destination(s).` : `Failed to publish Telegram message ${messageId} to ${targetIds.length} destination(s): ${failed.map((r: any) => `${r.targetId}: ${r.error}`).join(' | ')}`, sourceId: String(sourceId), targetId: targetIds[0] ? String(targetIds[0]) : undefined, targetTitle: targetIds[0] ? String(targetIds[0]) : undefined });
      res.status(succeeded === targetIds.length ? 200 : 502).json({ success: succeeded === targetIds.length, sourceId, messageId: Number(messageId), results, error: succeeded === targetIds.length ? undefined : failed.map((r: any) => `${r.targetId}: ${r.error}`).join(' | ') });
    } catch (err: any) { res.status(500).json({ error: err.message || 'Unable to forward the Telegram message.' }); }
  });

  app.get('/api/stream', (req, res) => { res.setHeader('Content-Type', 'text/event-stream; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache, no-transform'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders(); let closed = false; const write = (chunk: string) => { if (closed || res.writableEnded) return; try { res.write(chunk); } catch { closed = true; } }; write(': stream-connected\n\n'); const unsubscribe = engine.subscribeSSE((data) => write(`data: ${JSON.stringify(data)}\n\n`)); const heartbeat = setInterval(() => { if (closed || res.writableEnded) clearInterval(heartbeat); else write(': keepalive-ping\n\n'); }, 15000); const cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); unsubscribe(); }; req.on('close', cleanup); req.on('end', cleanup); res.on('finish', cleanup); res.on('error', cleanup); });
  app.get('/api/python-export', (_req, res) => { const config = storage.getConfig(); const rulesStr = config.rules.filter((r) => r.enabled && r.sourceId && r.targetIds.length).map((r) => `${r.sourceId}:${r.targetIds.join(':')}`).join(','); res.json({ envContent: `# TGForwarder Pro Exported .env\nAPI_ID="${config.apiId || ''}"\nAPI_HASH="${config.apiHash || ''}"\n${config.botToken ? `BOT_TOKEN="${config.botToken}\n` : ''}FORWARDING_RULES="${rulesStr}"\nREMOVE_FORWARD_SIGNATURE="${config.defaultRemoveSignature ? 'true' : 'false'}\n`, requirements: 'telethon==1.40.0\npython-dotenv==1.1.1\n', pythonScriptNotice: 'Use python3 telegram_forwarder.py --remove-forward-signature' }); });

  if (process.env.NODE_ENV !== 'production') { const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
  else { const distPath = path.join(process.cwd(), 'dist'); app.use(express.static(distPath)); app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html'))); }
  app.listen(PORT, HOST, () => console.log(`[TGForwarder] v2 server listening on ${HOST}:${PORT}`));
}

startServer().catch((err) => { console.error('[TGForwarder] Fatal startup error:', err); process.exit(1); });
