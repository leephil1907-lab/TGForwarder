import express from 'express';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer as createViteServer } from 'vite';
import { TelegramEngine } from './server/telegramEngine.js';
import { StorageManager } from './server/storage.js';
import { getOrCreateAuthToken, createAuthMiddleware } from './server/auth.js';

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const HOST = process.env.HOST || '0.0.0.0';

  // Disable the default CSP directives — they're built for a server-rendered
  // app and will break the Vite/React bundle's inline scripts & dev HMR.
  // Everything else in helmet (X-Frame-Options, no-sniff, etc.) still applies.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '2mb' }));

  const AUTH_TOKEN = getOrCreateAuthToken();
  const requireAuth = createAuthMiddleware(AUTH_TOKEN);

  // Slow down brute-force attempts against the login endpoints specifically.
  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please wait and try again.' }
  });

  // General ceiling on the rest of the API so a stray script/loop can't hammer it.
  const apiRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 240,
    standardHeaders: true,
    legacyHeaders: false
  });

  const engine = TelegramEngine.getInstance();
  const storage = StorageManager.getInstance();

  // Try auto-reconnecting if saved session exists
  engine.initializeFromStorage().catch((err) => {
    console.warn('[Server] Auto-connect skipped or failed:', err.message);
  });

  // ==================== API ROUTES ====================

  // Health check is intentionally public (no token) — useful for uptime
  // monitors / container orchestrators that can't hold a secret.
  // Health & Worker status check (supports /api/health and /api/health/status)
  const handleHealthCheck = async (req: express.Request, res: express.Response) => {
    await engine.waitForInitialization();
    const authState = engine.getAuthState();
    const isRunning = engine.isEngineRunning();
    const isPaused = engine.isEnginePaused();

    res.json({
      status: 'ok',
      worker: {
        status: authState.status === 'connected' ? 'online' : 'offline',
        engineRunning: isRunning,
        isPaused: isPaused
      },
      engineRunning: isRunning,
      isPaused: isPaused,
      authStatus: authState.status,
      authenticated: authState.status === 'connected',
      userProfile: authState.userProfile,
      timestamp: Date.now()
    });
  };

  app.get('/api/health', handleHealthCheck);
  app.get('/api/health/status', handleHealthCheck);

  // ---- Everything below this line requires the app access token ----
  app.use('/api', apiRateLimiter, requireAuth);
  app.use('/api/auth', authRateLimiter);

  // Safe Configuration
  app.get('/api/config', async (req, res) => {
    await engine.waitForInitialization();
    res.json(storage.getSafeConfig());
  });

  app.post('/api/config', (req, res) => {
    const { apiId, apiHash, defaultRemoveSignature, retryOnFloodWait, globalRateLimit, accounts } = req.body;
    const updated = storage.saveConfig({
      ...(apiId !== undefined && { apiId }),
      ...(apiHash !== undefined && { apiHash }),
      ...(defaultRemoveSignature !== undefined && { defaultRemoveSignature }),
      ...(retryOnFloodWait !== undefined && { retryOnFloodWait }),
      ...(globalRateLimit !== undefined && { globalRateLimit }),
      ...(accounts !== undefined && { accounts })
    });
    res.json(storage.getSafeConfig());
  });

  // Auth Status & Actions
  app.get('/api/auth/status', async (req, res) => {
    await engine.waitForInitialization();
    res.json(engine.getAuthState());
  });

  app.post('/api/auth/request-code', async (req, res) => {
    try {
      const { apiId, apiHash, phoneNumber } = req.body;
      if (!apiId || !apiHash || !phoneNumber) {
        return res.status(400).json({ error: 'API ID, API Hash, and Phone Number are required.' });
      }
      const result = await engine.requestPhoneCode(apiId, apiHash, phoneNumber);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to request verification code' });
    }
  });

  app.post('/api/auth/verify-code', async (req, res) => {
    try {
      const { phoneCode } = req.body;
      if (!phoneCode) {
        return res.status(400).json({ error: 'Phone verification code is required.' });
      }
      const result = await engine.verifyCode(phoneCode);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to verify code' });
    }
  });

  app.post('/api/auth/verify-2fa', async (req, res) => {
    try {
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ error: '2FA password is required.' });
      }
      const result = await engine.verify2FA(password);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || '2FA verification failed' });
    }
  });

  app.post('/api/auth/bot-login', async (req, res) => {
    try {
      const { apiId, apiHash, botToken } = req.body;
      if (!apiId || !apiHash || !botToken) {
        return res.status(400).json({ error: 'API ID, API Hash, and Bot Token are required.' });
      }
      const result = await engine.connectWithBotToken(apiId, apiHash, botToken);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to connect bot' });
    }
  });

  app.post('/api/auth/session-login', async (req, res) => {
    try {
      const { apiId, apiHash, sessionString } = req.body;
      if (!apiId || !apiHash || !sessionString) {
        return res.status(400).json({ error: 'API ID, API Hash, and Session String are required.' });
      }
      const result = await engine.connectWithStringSession(apiId, apiHash, sessionString);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to connect session' });
    }
  });

  app.post('/api/auth/disconnect', async (req, res) => {
    try {
      await engine.disconnect();
      res.json({ success: true, message: 'Disconnected successfully.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Error disconnecting' });
    }
  });

  // Chat & Channel Discovery
  app.get('/api/chats/discover', async (req, res) => {
    try {
      const chats = await engine.discoverChats();
      res.json({ success: true, chats });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Error discovering chats' });
    }
  });

  app.post('/api/chats/verify-permissions', async (req, res) => {
    try {
      const { sourceId, targetIds } = req.body;
      if (!sourceId || !targetIds || !Array.isArray(targetIds) || targetIds.length === 0) {
        return res.status(400).json({ error: 'sourceId and targetIds array are required.' });
      }
      const result = await engine.verifyPipelinePermissions(sourceId, targetIds);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to verify pipeline permissions' });
    }
  });

  app.post('/api/chats/test-target', async (req, res) => {
    try {
      const { targetId, testMessage } = req.body;
      if (!targetId) {
        return res.status(400).json({ error: 'Target ID is required.' });
      }
      const result = await engine.testTargetAccess(targetId, testMessage);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to verify target entity' });
    }
  });

  // Forwarding Rules
  app.get('/api/rules', (req, res) => {
    res.json(storage.getConfig().rules);
  });

  app.post('/api/rules', (req, res) => {
    try {
      const { name, sourceId, sourceTitle, sourceUsername, targetIds, targetTitles, removeForwardSignature, duplicateProtection, filterKeywords, dropLinks, prependText, appendText, enabled } = req.body;
      if (!sourceId || !targetIds || targetIds.length === 0) {
        return res.status(400).json({ error: 'Source ID and at least one Target ID are required.' });
      }
      const newRule = storage.addRule({
        name: name || `Funnel: ${sourceTitle || sourceId}`,
        sourceId: sourceId.trim(),
        sourceTitle: sourceTitle || sourceId,
        sourceUsername,
        targetIds: targetIds.map((t: string) => t.trim()),
        targetTitles: targetTitles || targetIds,
        removeForwardSignature: removeForwardSignature ?? true,
        duplicateProtection: duplicateProtection ?? true,
        filterKeywords: filterKeywords || [],
        dropLinks: dropLinks ?? false,
        prependText: prependText || '',
        appendText: appendText || '',
        enabled: enabled ?? true
      });
      res.json(newRule);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to save rule' });
    }
  });

  app.put('/api/rules/:id', (req, res) => {
    try {
      const updated = storage.updateRule(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: 'Rule not found' });
      }
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update rule' });
    }
  });

  app.delete('/api/rules/:id', (req, res) => {
    const success = storage.deleteRule(req.params.id);
    res.json({ success });
  });

  // Automation Engine Controls
  app.post('/api/engine/start', async (req, res) => {
    try {
      const result = await engine.startEngine();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to start engine' });
    }
  });

  app.post('/api/engine/stop', async (req, res) => {
    try {
      await engine.stopEngine();
      res.json({ success: true, message: 'Forwarding engine stopped.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to stop engine' });
    }
  });

  app.post('/api/engine/pause', (req, res) => {
    try {
      const result = engine.pauseEngine();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to pause engine' });
    }
  });

  app.post('/api/engine/resume', (req, res) => {
    try {
      const result = engine.resumeEngine();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to resume engine' });
    }
  });

  // Telemetry, Mappings & Logs
  app.get('/api/stats', (req, res) => {
    res.json(engine.getStats());
  });

  app.get('/api/logs', (req, res) => {
    res.json(engine.getRecentLogs());
  });

  app.get('/api/mappings', (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    res.json({
      totalCount: storage.getMappingsCount(),
      mappings: storage.getAllMappings(limit)
    });
  });

  // Real-time SSE Stream (Optimized with anti-buffering headers & heartbeat ping)
  app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let isClosed = false;

    const safeWrite = (chunk: string): boolean => {
      if (isClosed || res.writableEnded) return false;
      try {
        return res.write(chunk);
      } catch (err) {
        isClosed = true;
        return false;
      }
    };

    // Send initial comment to establish proxy pipeline
    safeWrite(': stream-connected\n\n');

    const unsubscribe = engine.subscribeSSE((data) => {
      safeWrite(`data: ${JSON.stringify(data)}\n\n`);
    });

    // 15-second keep-alive heartbeat to prevent cloud/proxy timeouts
    const heartbeatTimer = setInterval(() => {
      if (isClosed || res.writableEnded) {
        clearInterval(heartbeatTimer);
        return;
      }
      safeWrite(': keepalive-ping\n\n');
    }, 15000);

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      clearInterval(heartbeatTimer);
      unsubscribe();
    };

    req.on('close', cleanup);
    req.on('end', cleanup);
    res.on('finish', cleanup);
    res.on('error', cleanup);
  });

  // Python Script Generator (for running on VPS / server)
  app.get('/api/python-export', (req, res) => {
    const config = storage.getConfig();
    const rulesStr = config.rules
      .filter((r) => r.enabled && r.sourceId && r.targetIds.length > 0)
      .map((r) => `${r.sourceId}:${r.targetIds.join(':')}`)
      .join(',');

    const envContent = `# TGForwarder Pro Exported .env
API_ID="${config.apiId || ''}"
API_HASH="${config.apiHash || ''}"
${config.botToken ? `BOT_TOKEN="${config.botToken}"\n` : ''}
FORWARDING_RULES="${rulesStr}"
REMOVE_FORWARD_SIGNATURE="${config.defaultRemoveSignature ? 'true' : 'false'}"
`;

    res.json({
      envContent,
      requirements: 'telethon==1.40.0\npython-dotenv==1.1.1\n',
      pythonScriptNotice: 'Use python3 telegram_forwarder.py --remove-forward-signature'
    });
  });

  // ==================== VITE MIDDLEWARE ====================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`[TGForwarder Pro] Server running on http://${HOST}:${PORT}`);
    if (!process.env.APP_AUTH_TOKEN) {
      console.log('[TGForwarder Pro] ─────────────────────────────────────────────');
      console.log('[TGForwarder Pro] No APP_AUTH_TOKEN set — generated one for you.');
      console.log(`[TGForwarder Pro] Access token: ${AUTH_TOKEN}`);
      console.log('[TGForwarder Pro] It is saved in .data/auth_token.txt and reused');
      console.log('[TGForwarder Pro] on restart. Set APP_AUTH_TOKEN in your .env to');
      console.log('[TGForwarder Pro] pin it yourself instead.');
      console.log('[TGForwarder Pro] ─────────────────────────────────────────────');
    }
  });

  // ==================== GRACEFUL SHUTDOWN ====================
  // Ensures a debounced mapping-file write in flight isn't lost, and closes
  // the Telegram socket cleanly, WITHOUT clearing the saved session or the
  // isEngineRunning flag — so a redeploy/restart auto-reconnects and
  // auto-resumes forwarding instead of forcing you to log in again.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[TGForwarder Pro] Received ${signal}, shutting down gracefully...`);

    const forceExitTimer = setTimeout(() => {
      console.warn('[TGForwarder Pro] Graceful shutdown timed out, forcing exit.');
      process.exit(1);
    }, 8000);
    forceExitTimer.unref();

    try {
      await engine.shutdownGracefully();
    } catch (err) {
      console.error('[TGForwarder Pro] Error during engine shutdown:', err);
    }
    try {
      storage.flushPendingWrites();
    } catch (err) {
      console.error('[TGForwarder Pro] Error flushing storage on shutdown:', err);
    }

    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('[TGForwarder Pro] Fatal startup error:', err);
  process.exit(1);
});
