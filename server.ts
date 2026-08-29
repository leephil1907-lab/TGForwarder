import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { TelegramEngine } from './server/telegramEngine.js';
import { StorageManager } from './server/storage.js';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const engine = TelegramEngine.getInstance();
  const storage = StorageManager.getInstance();

  // Try auto-reconnecting if saved session exists
  engine.initializeFromStorage().catch((err) => {
    console.warn('[Server] Auto-connect skipped or failed:', err.message);
  });

  // ==================== API ROUTES ====================

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[TGForwarder Pro] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[TGForwarder Pro] Fatal startup error:', err);
});
