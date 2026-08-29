import express from 'express';
import rateLimit from 'express-rate-limit';
import { TelegramEngine } from '../server/telegramEngine.js';
import { StorageManager } from '../server/storage.js';
import { getOrCreateAuthToken, createAuthMiddleware } from '../server/auth.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
const engine = TelegramEngine.getInstance();
const storage = StorageManager.getInstance();
const authToken = getOrCreateAuthToken();
const requireAuth = createAuthMiddleware(authToken);
const authRateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const apiRateLimiter = rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false });
engine.initializeFromStorage().catch((err: any) => console.warn('[API] Auto-connect skipped or failed:', err?.message || err));

app.get('/api/health', async (_req, res) => {
  try { await engine.waitForInitialization(); const auth = engine.getAuthState(); res.json({ status: 'ok', worker: { status: auth.status === 'connected' ? 'online' : 'offline', engineRunning: engine.isEngineRunning(), isPaused: engine.isEnginePaused() }, engineRunning: engine.isEngineRunning(), isPaused: engine.isEnginePaused(), authStatus: auth.status, authenticated: auth.status === 'connected', userProfile: auth.userProfile, timestamp: Date.now() }); }
  catch (err: any) { res.status(503).json({ status: 'error', error: err?.message || 'Health check failed' }); }
});
app.get('/api/health/status', (_req, res) => res.redirect(307, '/api/health'));
app.use('/api', apiRateLimiter, requireAuth);
app.use('/api/auth', authRateLimiter);
app.get('/api/config', async (_req, res) => { await engine.waitForInitialization(); res.json(storage.getSafeConfig()); });
app.post('/api/config', (req, res) => { storage.saveConfig(req.body || {}); res.json(storage.getSafeConfig()); });
app.get('/api/auth/status', async (_req, res) => { await engine.waitForInitialization(); res.json(engine.getAuthState()); });
app.post('/api/auth/request-code', async (req, res) => { try { const { apiId, apiHash, phoneNumber } = req.body || {}; if (!apiId || !apiHash || !phoneNumber) return res.status(400).json({ error: 'API ID, API Hash, and Phone Number are required.' }); res.json(await engine.requestPhoneCode(apiId, apiHash, phoneNumber)); } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to request verification code' }); } });
app.post('/api/auth/verify-code', async (req, res) => { try { if (!req.body?.phoneCode) return res.status(400).json({ error: 'Phone verification code is required.' }); res.json(await engine.verifyCode(req.body.phoneCode)); } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to verify code' }); } });
app.post('/api/auth/verify-2fa', async (req, res) => { try { if (!req.body?.password) return res.status(400).json({ error: '2FA password is required.' }); res.json(await engine.verify2FA(req.body.password)); } catch (err: any) { res.status(500).json({ error: err?.message || '2FA verification failed' }); } });
app.post('/api/auth/bot-login', async (req, res) => { try { const { apiId, apiHash, botToken } = req.body || {}; if (!apiId || !apiHash || !botToken) return res.status(400).json({ error: 'API ID, API Hash, and Bot Token are required.' }); res.json(await engine.connectWithBotToken(apiId, apiHash, botToken)); } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to connect bot' }); } });
app.post('/api/auth/session-login', async (req, res) => { try { const { apiId, apiHash, sessionString } = req.body || {}; if (!apiId || !apiHash || !sessionString) return res.status(400).json({ error: 'API ID, API Hash, and Session String are required.' }); res.json(await engine.connectWithStringSession(apiId, apiHash, sessionString)); } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to connect session' }); } });
app.post('/api/auth/disconnect', async (_req, res) => { try { await engine.disconnect(); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err?.message || 'Error disconnecting' }); } });
app.get('/api/chats/discover', async (_req, res) => { try { res.json({ success: true, chats: await engine.discoverChats() }); } catch (err: any) { res.status(500).json({ error: err?.message || 'Error discovering chats' }); } });
app.post('/api/chats/verify-permissions', async (req, res) => { try { res.json(await engine.verifyPipelinePermissions(req.body.sourceId, req.body.targetIds)); } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to verify pipeline permissions' }); } });
app.post('/api/chats/test-target', async (req, res) => { try { res.json(await engine.testTargetAccess(req.body.targetId, req.body.testMessage)); } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to verify target entity' }); } });
app.get('/api/rules', (_req, res) => res.json(storage.getConfig().rules));
app.post('/api/rules', (req, res) => { try { const b = req.body || {}; if (!b.sourceId || !Array.isArray(b.targetIds) || !b.targetIds.length) return res.status(400).json({ error: 'Source ID and at least one Target ID are required.' }); res.json(storage.addRule({ ...b, name: b.name || `Funnel: ${b.sourceTitle || b.sourceId}`, sourceId: b.sourceId.trim(), targetIds: b.targetIds.map((x: string) => x.trim()), targetTitles: b.targetTitles || b.targetIds, removeForwardSignature: b.removeForwardSignature ?? true, duplicateProtection: b.duplicateProtection ?? true, filterKeywords: b.filterKeywords || [], dropLinks: b.dropLinks ?? false, prependText: b.prependText || '', appendText: b.appendText || '', enabled: b.enabled ?? true })); } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to save rule' }); } });
app.put('/api/rules/:id', (req, res) => { try { const value = storage.updateRule(req.params.id, req.body); if (!value) return res.status(404).json({ error: 'Rule not found' }); res.json(value); } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to update rule' }); } });
app.delete('/api/rules/:id', (req, res) => res.json({ success: storage.deleteRule(req.params.id) }));
app.post('/api/engine/start', async (_req, res) => { try { res.json(await engine.startEngine()); } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to start engine' }); } });
app.post('/api/engine/stop', async (_req, res) => { try { await engine.stopEngine(); res.json({ success: true }); } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to stop engine' }); } });
app.post('/api/engine/pause', (_req, res) => { try { res.json(engine.pauseEngine()); } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to pause engine' }); } });
app.post('/api/engine/resume', (_req, res) => { try { res.json(engine.resumeEngine()); } catch (err: any) { res.status(500).json({ error: err?.message || 'Failed to resume engine' }); } });
app.get('/api/stats', (_req, res) => res.json(engine.getStats()));
app.get('/api/logs', (_req, res) => res.json(engine.getRecentLogs()));
app.get('/api/mappings', (req, res) => { const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100; res.json({ totalCount: storage.getMappingsCount(), mappings: storage.getAllMappings(limit) }); });
app.get('/api/stream', (req, res) => { res.setHeader('Content-Type', 'text/event-stream; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache, no-transform'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders(); let closed = false; const write = (s: string) => { if (!closed && !res.writableEnded) { try { res.write(s); } catch { closed = true; } } }; write(': stream-connected\n\n'); const unsubscribe = engine.subscribeSSE((data) => write(`data: ${JSON.stringify(data)}\n\n`)); const timer = setInterval(() => write(': keepalive-ping\n\n'), 15000); const cleanup = () => { if (closed) return; closed = true; clearInterval(timer); unsubscribe(); }; req.on('close', cleanup); res.on('finish', cleanup); res.on('error', cleanup); });
app.get('/api/python-export', (_req, res) => { const config = storage.getConfig(); const rulesStr = config.rules.filter(r => r.enabled && r.sourceId && r.targetIds.length).map(r => `${r.sourceId}:${r.targetIds.join(':')}`).join(','); res.json({ envContent: `API_ID="${config.apiId || ''}"\nAPI_HASH="${config.apiHash || ''}"\n${config.botToken ? `BOT_TOKEN="${config.botToken}"\n` : ''}FORWARDING_RULES="${rulesStr}"\nREMOVE_FORWARD_SIGNATURE="${config.defaultRemoveSignature ? 'true' : 'false'}"\n`, requirements: 'telethon==1.40.0\npython-dotenv==1.1.1\n', pythonScriptNotice: 'Use python3 telegram_forwarder.py --remove-forward-signature' }); });
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error('[API]', err); if (!res.headersSent) res.status(500).json({ error: err?.message || 'Internal server error' }); });
export default app;
