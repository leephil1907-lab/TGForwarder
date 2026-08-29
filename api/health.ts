import { TelegramEngine } from '../server/telegramEngine.js';

export default async function handler(req: any, res: any) {
  try {
    const engine = TelegramEngine.getInstance();
    await engine.waitForInitialization();
    const authState = engine.getAuthState();
    res.status(200).json({
      status: 'ok',
      worker: {
        status: authState.status === 'connected' ? 'online' : 'offline',
        engineRunning: engine.isEngineRunning(),
        isPaused: engine.isEnginePaused()
      },
      engineRunning: engine.isEngineRunning(),
      isPaused: engine.isEnginePaused(),
      authStatus: authState.status,
      authenticated: authState.status === 'connected',
      userProfile: authState.userProfile,
      timestamp: Date.now()
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Health check failed' });
  }
}
