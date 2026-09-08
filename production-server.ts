import express from 'express';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer as createViteServer } from 'vite';
import { TelegramEngine } from './server/telegramEngine.js';
import { StorageManager } from './server/storage.js';
import { getOrCreateAuthToken, createAuthMiddleware } from './server/auth.js';
import { restrictedFetcher } from './server/restrictedFetcher.js';
import { autoImportScheduler } from './server/autoImportScheduler.js';
import { userRegistry } from './server/users.js';
import fs from 'fs';

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
  app.set('trust proxy', 1);
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const HOST = process.env.HOST || '0.0.0.0';
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '4mb' }));
  const AUTH_TOKEN = getOrCreateAuthToken();
  const requireAuth = createAuthMiddleware(AUTH_TOKEN);
  console.log(`[TGForwarder] Dashboard access control active (${process.env.APP_AUTH_TOKEN?.trim() ? 'token loaded from APP_AUTH_TOKEN env' : `generated token: ${AUTH_TOKEN} — also stored in the data directory`}).`);
  // Storage/volume check: the data dir must be writable or sessions/jobs cannot persist.
  const effectiveDataDir = process.env.TG_DATA_DIR || path.join(process.cwd(), '.data');
  let storageWritable = false;
  try { fs.mkdirSync(effectiveDataDir, { recursive: true }); fs.accessSync(effectiveDataDir, fs.constants.W_OK); storageWritable = true; } catch { storageWritable = false; }
  console.log(`[TGForwarder] Data directory: ${effectiveDataDir} (${storageWritable ? 'writable' : 'NOT writable — sessions will fail to persist. Attach a volume and set TG_DATA_DIR, e.g. /data'})`);
  const authRateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many authentication attempts. Please wait and try again.' } });
  const apiRateLimiter = rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false });
  const engine = TelegramEngine.getInstance();
  const storage = StorageManager.getInstance();
  engine.initializeFromStorage().catch((err) => console.warn('[Server] Auto-connect skipped or failed:', err.message));
  restrictedFetcher.resumeInterruptedJobs();

  const handleHealthCheck = async (_req: express.Request, res: express.Response) => {
    await engine.waitForInitialization();
    const authState = engine.getAuthState();
    const fetcherSummary = (() => { try { const jobs = restrictedFetcher.getJobs(50); return { total: jobs.length, active: jobs.filter((j) => j.status === 'queued' || j.status === 'running').length, lastJobAt: jobs.length ? jobs[0].createdAt : null }; } catch { return { total: 0, active: 0, lastJobAt: null }; } })();
    const autoImportSummary = (() => { try { return autoImportScheduler.aggregateSummary(); } catch { return { total: 0, active: 0 }; } })();
    res.json({ status: 'ok', worker: { status: authState.status === 'connected' ? 'online' : 'offline', engineRunning: engine.isEngineRunning(), isPaused: engine.isEnginePaused() }, engineRunning: engine.isEngineRunning(), isPaused: engine.isEnginePaused(), authStatus: authState.status, authenticated: authState.status === 'connected', userProfile: authState.userProfile, fetcher: fetcherSummary, autoImport: autoImportSummary, storage: { dir: effectiveDataDir, writable: storageWritable, volumeAttached: effectiveDataDir === '/data' }, timestamp: Date.now() });
  };
  app.get('/api/health', handleHealthCheck);
  app.get('/api/health/status', handleHealthCheck);
  // Optional edge lock: when EDGE_SECRET is set, /api only accepts traffic that
  // carries the shared secret — i.e. your Deno Deploy edge gateway. Set the
  // same value on the gateway. /api/health stays open for platform healthchecks.
  const EDGE_SECRET = process.env.EDGE_SECRET?.trim();
  if (EDGE_SECRET) {
    app.use('/api', (req, res, next) => {
      if (req.path === '/health' || req.path === '/health/status') return next();
      if (req.headers['x-edge-secret'] === EDGE_SECRET) return next();
      return res.status(403).json({ error: 'This API only accepts traffic from the configured edge gateway.' });
    });
  }
  // ==================== PUBLIC USER AUTH (before the auth wall) ====================
  const loginRateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait and try again.' } });
  app.post('/api/auth/user-login', loginRateLimiter, (req, res) => {
    try {
      const { username, password } = req.body || {};
      const { user, token } = userRegistry.login(String(username || ''), String(password || ''));
      res.json({ success: true, token, user: userRegistry.publicUser(user) });
    } catch (err: any) { res.status(Number(err?.status) || 401).json({ success: false, error: err.message || 'Login failed.' }); }
  });
  app.post('/api/auth/user-register', loginRateLimiter, (req, res) => {
    try {
      const { inviteCode, username, password } = req.body || {};
      const { user, token } = userRegistry.registerWithInvite(String(inviteCode || ''), String(username || ''), String(password || ''));
      (engine as any).log?.({ level: 'success', category: 'auth', title: '👤 New User Registered', message: `User "${user.username}" activated an invite and joined with an isolated workspace.` });
      res.json({ success: true, token, user: userRegistry.publicUser(user) });
    } catch (err: any) { res.status(Number(err?.status) || 400).json({ success: false, error: err.message || 'Registration failed.' }); }
  });

  app.use('/api', apiRateLimiter, requireAuth);
  app.use('/api/auth', authRateLimiter);

  app.get('/api/config', async (_req, res) => { await engine.waitForInitialization(); res.json(StorageManager.getInstance().getSafeConfig()); });
  app.post('/api/config', (req, res) => { const { apiId, apiHash, defaultRemoveSignature, retryOnFloodWait, globalRateLimit, accounts } = req.body; StorageManager.getInstance().saveConfig({ ...(apiId !== undefined && { apiId }), ...(apiHash !== undefined && { apiHash }), ...(defaultRemoveSignature !== undefined && { defaultRemoveSignature }), ...(retryOnFloodWait !== undefined && { retryOnFloodWait }), ...(globalRateLimit !== undefined && { globalRateLimit }), ...(accounts !== undefined && { accounts }) }); res.json(StorageManager.getInstance().getSafeConfig()); });

  app.get('/api/auth/status', async (_req, res) => { await engine.waitForInitialization(); res.json(engine.getAuthState()); });
  app.post('/api/auth/request-code', async (req, res) => { try { clearEngineLogs(engine); const { apiId, apiHash, phoneNumber } = req.body; if (!apiId || !apiHash || !phoneNumber) return res.status(400).json({ error: 'API ID, API Hash, and Phone Number are required.' }); res.json(await engine.requestPhoneCode(apiId, apiHash, phoneNumber)); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to request verification code' }); } });
  app.post('/api/auth/verify-code', async (req, res) => { try { const { phoneCode } = req.body; if (!phoneCode) return res.status(400).json({ error: 'Phone verification code is required.' }); res.json(await engine.verifyCode(phoneCode)); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to verify code' }); } });
  app.post('/api/auth/verify-2fa', async (req, res) => { try { const { password } = req.body; if (!password) return res.status(400).json({ error: '2FA password is required.' }); res.json(await engine.verify2FA(password)); } catch (err: any) { res.status(500).json({ error: err.message || '2FA verification failed' }); } });
  app.post('/api/auth/bot-login', async (req, res) => { try { clearEngineLogs(engine); const { apiId, apiHash, botToken } = req.body; if (!apiId || !apiHash || !botToken) return res.status(400).json({ error: 'API ID, API Hash, and Bot Token are required.' }); res.json(await engine.connectWithBotToken(apiId, apiHash, botToken)); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to connect bot' }); } });
  app.post('/api/auth/session-login', async (req, res) => { try { clearEngineLogs(engine); const { apiId, apiHash, sessionString } = req.body; if (!apiId || !apiHash || !sessionString) return res.status(400).json({ error: 'API ID, API Hash, and Session String are required.' }); res.json(await engine.connectWithStringSession(apiId, apiHash, sessionString)); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to connect session' }); } });
  // ==================== USER SESSION & ADMIN MANAGEMENT ====================
  const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => { if ((req as any).role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' }); return next(); };
  app.get('/api/auth/me', (req, res) => { res.json({ success: true, mode: (req as any).role === 'admin' && (req as any).username === 'admin' ? 'admin' : 'user', user: { username: (req as any).username, role: (req as any).role, userId: (req as any).userId } }); });
  app.post('/api/auth/user-logout', (req, res) => { const header = req.headers['authorization']; const provided = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : (typeof req.query.token === 'string' ? req.query.token : ''); res.json({ success: userRegistry.logout(provided) }); });
  app.get('/api/users', requireAdmin, (_req, res) => res.json({ success: true, users: userRegistry.listUsers() }));
  app.put('/api/users/:id', requireAdmin, (req, res) => { const updated = userRegistry.setUserDisabled(decodeURIComponent(req.params.id), Boolean(req.body?.disabled)); if (!updated) return res.status(404).json({ success: false, error: 'User not found.' }); res.json({ success: true, user: updated }); });
  app.get('/api/users/invites', requireAdmin, (_req, res) => res.json({ success: true, invites: userRegistry.listInvites() }));
  app.post('/api/users/invites', requireAdmin, (req, res) => { const invite = userRegistry.createInvite((req as any).username || 'admin', String(req.body?.label || '')); res.json({ success: true, invite }); });
  app.delete('/api/users/invites/:code', requireAdmin, (req, res) => res.json({ success: userRegistry.deleteInvite(decodeURIComponent(req.params.code).toUpperCase()) }));
  app.post('/api/auth/disconnect', async (_req, res) => { try { await engine.disconnect(); clearEngineLogs(engine); res.json({ success: true, message: 'Disconnected successfully. Session activity was cleared.' }); } catch (err: any) { clearEngineLogs(engine); res.status(500).json({ error: err.message || 'Error disconnecting' }); } });

  app.get('/api/chats/discover', async (_req, res) => { try { res.json({ success: true, chats: await engine.discoverChats() }); } catch (err: any) { res.status(500).json({ error: err.message || 'Error discovering chats' }); } });
  app.post('/api/chats/verify-permissions', async (req, res) => { try { const { sourceId, targetIds } = req.body; if (!sourceId || !Array.isArray(targetIds) || !targetIds.length) return res.status(400).json({ error: 'sourceId and targetIds array are required.' }); res.json(await engine.verifyPipelinePermissions(sourceId, targetIds)); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to verify pipeline permissions' }); } });
  app.post('/api/chats/test-target', async (req, res) => { try { if (!req.body.targetId) return res.status(400).json({ error: 'Target ID is required.' }); res.json(await engine.testTargetAccess(req.body.targetId, req.body.testMessage)); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to verify target entity' }); } });

  app.get('/api/rules', (_req, res) => res.json(StorageManager.getInstance().getConfig().rules));
  app.post('/api/rules', (req, res) => { try { const { name, sourceId, sourceTitle, sourceUsername, targetIds, targetTitles, removeForwardSignature, duplicateProtection, filterKeywords, dropLinks, prependText, appendText, enabled, autoPublish } = req.body; if (!sourceId || !Array.isArray(targetIds) || !targetIds.length) return res.status(400).json({ error: 'Source ID and at least one Target ID are required.' }); res.json(StorageManager.getInstance().addRule({ name: name || `Funnel: ${sourceTitle || sourceId}`, sourceId: sourceId.trim(), sourceTitle: sourceTitle || sourceId, sourceUsername, targetIds: targetIds.map((t: string) => t.trim()), targetTitles: targetTitles || targetIds, removeForwardSignature: removeForwardSignature ?? true, autoPublish: autoPublish ?? false, duplicateProtection: duplicateProtection ?? true, filterKeywords: filterKeywords || [], dropLinks: dropLinks ?? false, prependText: prependText || '', appendText: appendText || '', enabled: enabled ?? true })); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to save rule' }); } });
  app.put('/api/rules/:id', (req, res) => { try { const updated = StorageManager.getInstance().updateRule(req.params.id, req.body); if (!updated) return res.status(404).json({ error: 'Rule not found' }); res.json(updated); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to update rule' }); } });
  app.delete('/api/rules/:id', (req, res) => res.json({ success: StorageManager.getInstance().deleteRule(req.params.id) }));

  app.post('/api/engine/start', async (_req, res) => { try { res.json(await engine.startEngine()); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to start engine' }); } });
  app.post('/api/engine/stop', async (_req, res) => { try { await engine.stopEngine(); res.json({ success: true, message: 'Forwarding engine stopped.' }); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to stop engine' }); } });
  app.post('/api/engine/pause', (_req, res) => { try { res.json(engine.pauseEngine()); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to pause engine' }); } });
  app.post('/api/engine/resume', (_req, res) => { try { res.json(engine.resumeEngine()); } catch (err: any) { res.status(500).json({ error: err.message || 'Failed to resume engine' }); } });
  app.get('/api/stats', (_req, res) => res.json(engine.getStats()));
  app.get('/api/logs', (_req, res) => res.json(engine.getRecentLogs()));
  app.post('/api/logs/clear', (_req, res) => { clearEngineLogs(engine); res.json({ success: true }); });
  app.get('/api/mappings', (req, res) => { const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100; res.json({ totalCount: StorageManager.getInstance().getMappingsCount(), mappings: StorageManager.getInstance().getAllMappings(limit) }); });

  app.get('/api/pending', (_req, res) => { res.json({ success: true, posts: (engine as any).getPendingPosts?.() || [] }); });
  app.post('/api/pending/:key/publish', async (req, res) => { try { const key = decodeURIComponent(req.params.key); const result = await (engine as any).publishPendingPost?.(key, typeof req.body?.text === 'string' ? req.body.text : undefined); if (!result) return res.status(500).json({ error: 'Manual publishing is unavailable.' }); res.json(result); } catch (err: any) { res.status(502).json({ error: err.message || 'Failed to publish pending Telegram post.' }); } });
  app.delete('/api/pending/:key', (req, res) => { const key = decodeURIComponent(req.params.key); const result = (engine as any).discardPendingPost?.(key); res.json(result || { success: false }); });

  app.get('/api/history', async (req, res) => {
    try {
      const sourceId = String(req.query.sourceId || '').trim();
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || '100'), 10) || 100, 1), 100);
      const offsetIdRaw = String(req.query.offsetId || '').trim();
      const offsetId = offsetIdRaw ? Number(offsetIdRaw) : 0;
      if (!sourceId) return res.status(400).json({ error: 'sourceId is required.' });
      const entity = await (engine as any).resolveEntity(sourceId);
      const client = getClient(engine);
      const messages = await client.getMessages(entity, { limit, offsetId });
      const normalized = messages.map(normalizeHistoryMessage);
      const last = normalized[normalized.length - 1];
      const nextOffsetId = last ? Number(last.id) : null;
      res.json({ success: true, sourceId, count: normalized.length, messages: normalized, nextOffsetId, hasMore: normalized.length === limit && nextOffsetId !== null });
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

  // ==================== RESTRICTED FETCHER (integrated save-restricted-bot worker) ====================
  app.get('/api/fetcher/jobs', (req, res) => { const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 30; res.json({ success: true, jobs: restrictedFetcher.getJobs(limit) }); });
  app.post('/api/fetcher/jobs', (req, res) => { try { const { links, sendToTelegram, saveForDownload, targetId, targetTitle } = req.body || {}; const job = restrictedFetcher.createJob({ links, sendToTelegram: Boolean(sendToTelegram), saveForDownload: Boolean(saveForDownload), targetId, targetTitle }); res.json({ success: true, job }); } catch (err: any) { res.status(400).json({ success: false, error: err.message || 'Failed to create fetch job.' }); } });
  app.get('/api/fetcher/jobs/:id', (req, res) => { const job = restrictedFetcher.getJob(decodeURIComponent(req.params.id)); if (!job) return res.status(404).json({ success: false, error: 'Job not found.' }); res.json({ success: true, job }); });
  app.post('/api/fetcher/jobs/:id/cancel', (req, res) => res.json(restrictedFetcher.cancelJob(decodeURIComponent(req.params.id))));
  app.post('/api/fetcher/jobs/:id/retry', async (req, res) => { try { res.json(await Promise.resolve().then(() => restrictedFetcher.retryJob(decodeURIComponent(req.params.id)))); } catch (err: any) { res.status(400).json({ success: false, message: err.message || 'Retry failed.' }); } });
  app.delete('/api/fetcher/jobs/:id', (req, res) => res.json(restrictedFetcher.deleteJob(decodeURIComponent(req.params.id))));
  app.get('/api/fetcher/download/:jobId/:itemId', (req, res) => {
    try {
      const jobId = decodeURIComponent(req.params.jobId);
      const itemId = decodeURIComponent(req.params.itemId);
      const requested = typeof req.query.file === 'string' ? req.query.file : '';
      const job = restrictedFetcher.getJob(jobId);
      const item = job?.items.find((i) => i.id === itemId);
      if (!job || !item) return res.status(404).json({ success: false, error: 'Fetched item not found.' });
      const fileName = requested && item.downloadFiles.includes(requested) ? requested : item.downloadFiles[0];
      if (!fileName) return res.status(404).json({ success: false, error: 'No downloaded file available for this item. Re-run the job with "Save for download" enabled.' });
      const filePath = restrictedFetcher.getDownloadPath(jobId, itemId, fileName);
      if (!filePath) return res.status(404).json({ success: false, error: 'File is no longer on disk.' });
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => { if (!res.headersSent) res.status(500).json({ success: false, error: 'Unable to read file.' }); else res.end(); });
      stream.pipe(res);
    } catch (err: any) { res.status(500).json({ success: false, error: err.message || 'Download failed.' }); }
  });

  // Full message payload for the fetcher editor: text + media meta + preview URLs.
  app.get('/api/fetcher/message', async (req, res) => {
    try {
      const chatRef = String(req.query.chat || '').trim();
      const messageId = Number(req.query.msg || 0);
      if (!chatRef || !Number.isFinite(messageId) || messageId <= 0) return res.status(400).json({ success: false, error: 'chat and msg query parameters are required.' });
      const client = getClient(engine);
      const entity = await (engine as any).resolveEntity(chatRef);
      const result = await client.getMessages(entity, { ids: [messageId] });
      const message: any = Array.isArray(result) ? result[0] : result;
      if (!message) return res.status(404).json({ success: false, error: 'Message not found. It may be deleted, or the connected account has no access.' });
      const document = message?.document || message?.media?.document || null;
      const attributes = Array.isArray(document?.attributes) ? document.attributes : [];
      const videoAttribute = attributes.find((a: any) => a?.className === 'DocumentAttributeVideo');
      const audioAttribute = attributes.find((a: any) => a?.className === 'DocumentAttributeAudio');
      const fileAttribute = attributes.find((a: any) => a?.className === 'DocumentAttributeFilename');
      const isPhoto = Boolean(message.photo) || message.media?.className === 'MessageMediaPhoto';
      const mimeType: string | null = document?.mimeType || null;
      const mediaType = isPhoto ? 'photo'
        : videoAttribute ? 'video'
        : audioAttribute?.voice ? 'voice'
        : audioAttribute ? 'audio'
        : message.media?.className === 'MessageMediaWebPage' ? 'text'
        : document ? 'document'
        : message.media ? 'unknown' : 'text';
      const chatParam = encodeURIComponent(chatRef);
      res.json({
        success: true,
        chat: chatRef,
        messageId,
        text: message.message || message.text || '',
        hasMedia: Boolean(message.media) && mediaType !== 'text',
        mediaType,
        mimeType,
        fileName: fileAttribute?.fileName || null,
        size: typeof document?.size === 'number' ? document.size : null,
        duration: typeof videoAttribute?.duration === 'number' ? videoAttribute.duration : typeof audioAttribute?.duration === 'number' ? audioAttribute.duration : null,
        width: typeof videoAttribute?.w === 'number' ? videoAttribute.w : null,
        height: typeof videoAttribute?.h === 'number' ? videoAttribute.h : null,
        groupedId: message.groupedId ? String(message.groupedId) : null,
        mediaUrl: message.media && mediaType !== 'text' ? `/api/history/media?sourceId=${chatParam}&messageId=${messageId}` : null,
        thumbnailUrl: message.media && mediaType !== 'text' ? `/api/history/media/thumbnail?sourceId=${chatParam}&messageId=${messageId}` : null
      });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message || 'Unable to load the Telegram message.' }); }
  });

  // ==================== AUTO-IMPORT SCHEDULER ====================
  app.get('/api/autoimport', (_req, res) => res.json({ success: true, watches: autoImportScheduler.list() }));
  app.post('/api/autoimport', (req, res) => { try { const { sourceId, sourceTitle, targetId, targetTitle, intervalMinutes, importLatestOnStart } = req.body || {}; const watch = autoImportScheduler.createWatch({ sourceId, sourceTitle, targetId, targetTitle, intervalMinutes, importLatestOnStart }); res.json({ success: true, watch }); } catch (err: any) { res.status(400).json({ success: false, error: err.message || 'Failed to create watcher.' }); } });
  app.put('/api/autoimport/:id', (req, res) => { try { res.json({ success: true, watch: autoImportScheduler.updateWatch(decodeURIComponent(req.params.id), req.body || {}) }); } catch (err: any) { res.status(400).json({ success: false, error: err.message || 'Failed to update watcher.' }); } });
  app.delete('/api/autoimport/:id', (req, res) => { try { res.json(autoImportScheduler.deleteWatch(decodeURIComponent(req.params.id))); } catch (err: any) { res.status(400).json({ success: false, error: err.message }); } });
  app.post('/api/autoimport/:id/run', async (req, res) => { try { res.json(await autoImportScheduler.runNow(decodeURIComponent(req.params.id))); } catch (err: any) { res.status(400).json({ success: false, error: err.message || 'Run failed.' }); } });

  app.get('/api/stream', (req, res) => { res.setHeader('Content-Type', 'text/event-stream; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache, no-transform'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders(); let closed = false; const write = (chunk: string) => { if (closed || res.writableEnded) return; try { res.write(chunk); } catch { closed = true; } }; write(': stream-connected\n\n'); const unsubscribe = engine.subscribeSSE((data) => write(`data: ${JSON.stringify(data)}\n\n`)); const heartbeat = setInterval(() => { if (closed || res.writableEnded) clearInterval(heartbeat); else write(': keepalive-ping\n\n'); }, 15000); const cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); unsubscribe(); }; req.on('close', cleanup); req.on('end', cleanup); res.on('finish', cleanup); res.on('error', cleanup); });
  app.get('/api/python-export', (_req, res) => { const config = StorageManager.getInstance().getConfig(); const rulesStr = config.rules.filter((r) => r.enabled && r.sourceId && r.targetIds.length).map((r) => `${r.sourceId}:${r.targetIds.join(':')}`).join(','); res.json({ envContent: `# TGForwarder Pro Exported .env\nAPI_ID="${config.apiId || ''}"\nAPI_HASH="${config.apiHash || ''}"\n${config.botToken ? `BOT_TOKEN="${config.botToken}"\n` : ''}FORWARDING_RULES="${rulesStr}"\nREMOVE_FORWARD_SIGNATURE="${config.defaultRemoveSignature ? 'true' : 'false'}"\n`, requirements: 'telethon==1.40.0\npython-dotenv==1.1.1\n', pythonScriptNotice: 'Use python3 telegram_forwarder.py --remove-forward-signature' }); });

  if (process.env.NODE_ENV !== 'production') { const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
  else { const distPath = path.join(process.cwd(), 'dist'); app.use(express.static(distPath)); app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html'))); }
  app.listen(PORT, HOST, () => console.log(`[TGForwarder] server listening on ${HOST}:${PORT}`));
}
startServer().catch((err) => { console.error('[TGForwarder] Fatal startup error:', err); process.exit(1); });
