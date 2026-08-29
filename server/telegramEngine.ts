import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import { Api } from 'telegram';
import { computeCheck } from 'telegram/Password.js';
import crypto from 'crypto';
import { StorageManager, ForwardingRule, ActivityLog, EngineStats, RateLimitConfig, normalizeChatId } from './storage.js';

export interface TelegramUserProfile {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
  phone?: string;
  isBot: boolean;
  connectedAt: number;
}

export interface DiscoveredChat {
  id: string;
  title: string;
  username?: string;
  type: 'channel' | 'supergroup' | 'group' | 'user' | 'bot';
  isPrivate: boolean;
  unreadCount?: number;
  participantsCount?: number;
  canSendMessages?: boolean;
}

export interface AuthState {
  status: 'disconnected' | 'connecting' | 'awaiting_code' | 'awaiting_2fa' | 'connected' | 'error';
  phoneCodeHash?: string;
  phoneNumber?: string;
  errorMessage?: string;
  userProfile?: TelegramUserProfile | null;
}

interface QueuedMessage {
  event: NewMessageEvent;
  rule: ForwardingRule;
  targetId: string;
  targetTitle: string;
  processedText: string;
  scheduledTime: number;
  retries: number;
}

export class TelegramEngine {
  private static instance: TelegramEngine;
  private client: TelegramClient | null = null;
  private storage: StorageManager;
  private authState: AuthState = { status: 'disconnected', userProfile: null };
  private activeEventHandler: ((event: NewMessageEvent) => Promise<void>) | null = null;
  private sseClients: Set<(data: { type: string; payload: any }) => void> = new Set();
  private recentLogs: ActivityLog[] = [];
  private entityCache: Map<string, any> = new Map();
  
  // Rate limiting queue & sliding window
  private isPaused = false;
  private messageQueue: QueuedMessage[] = [];
  private isProcessingQueue = false;
  private sentTimestamps: number[] = [];
  private lastDispatchTime = 0;

  private stats: EngineStats = {
    totalReceived: 0,
    totalForwarded: 0,
    totalFailed: 0,
    duplicatesBlocked: 0,
    filtersTriggered: 0,
    mediaBlocked: 0,
    sendersBlocked: 0,
    floodWaitsHandled: 0,
    activeRulesCount: 0,
    uptimeSeconds: 0,
    lastActiveTime: null,
    startTime: null
  };
  private uptimeInterval: NodeJS.Timeout | null = null;
  private initPromise: Promise<boolean> | null = null;

  private constructor() {
    this.storage = StorageManager.getInstance();
    this.initStats();
  }

  public static getInstance(): TelegramEngine {
    if (!TelegramEngine.instance) {
      TelegramEngine.instance = new TelegramEngine();
    }
    return TelegramEngine.instance;
  }

  public async waitForInitialization(): Promise<void> {
    if (this.initPromise) {
      try {
        await Promise.race([
          this.initPromise,
          new Promise((resolve) => setTimeout(resolve, 3000))
        ]);
      } catch (e) {
        // Ignore initialization errors during await
      }
    }
  }

  private initStats() {
    const config = this.storage.getConfig();
    this.stats.activeRulesCount = config.rules.filter((r) => r.enabled).length;
  }

  // Subscribe to real-time SSE stream
  public subscribeSSE(clientCallback: (data: { type: string; payload: any }) => void): () => void {
    this.sseClients.add(clientCallback);
    
    // Send initial snapshot immediately
    clientCallback({
      type: 'INIT_SNAPSHOT',
      payload: {
        authState: this.authState,
        stats: this.stats,
        isEngineRunning: this.isEngineRunning(),
        recentLogs: this.recentLogs.slice(-100)
      }
    });

    return () => {
      this.sseClients.delete(clientCallback);
    };
  }

  private broadcast(type: string, payload: any) {
    for (const callback of this.sseClients) {
      try {
        callback({ type, payload });
      } catch (err) {
        // Client connection closed
      }
    }
  }

  public log(logItem: Omit<ActivityLog, 'id' | 'timestamp'>) {
    const fullLog: ActivityLog = {
      ...logItem,
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now()
    };

    this.recentLogs.push(fullLog);
    if (this.recentLogs.length > 500) {
      this.recentLogs.shift();
    }

    console.log(`[TGForwarder] [${fullLog.level.toUpperCase()}] [${fullLog.category}] ${fullLog.title}: ${fullLog.message}`);
    this.broadcast('NEW_LOG', fullLog);
  }

  public getRecentLogs(): ActivityLog[] {
    return [...this.recentLogs];
  }

  public getStats(): EngineStats {
    return { ...this.stats };
  }

  public getAuthState(): AuthState {
    return { ...this.authState };
  }

  public isEngineRunning(): boolean {
    return this.storage.getConfig().isEngineRunning;
  }

  // ==================== TELEGRAM CONNECTION & AUTH ====================

  public initializeFromStorage(): Promise<boolean> {
    const runInit = async (): Promise<boolean> => {
      const config = this.storage.getConfig();
      const apiId = config.apiId || process.env.TG_API_ID;
      const apiHash = config.apiHash || process.env.TG_API_HASH;
      const sessionString = config.sessionString || process.env.TG_SESSION_STRING;
      const botToken = config.botToken || process.env.TG_BOT_TOKEN;

      if (!apiId || !apiHash) {
        this.authState = { status: 'disconnected', userProfile: null };
        return false;
      }

      const apiIdNum = typeof apiId === 'string' ? parseInt(apiId, 10) : apiId;

      // Option A: Bot Token Login
      if (botToken && botToken.trim().length > 10 && (!sessionString || sessionString.trim().length < 10)) {
        try {
          await this.connectWithBotToken(apiIdNum, apiHash.trim(), botToken.trim());
          if (config.isEngineRunning) {
            await this.startEngine();
          }
          return true;
        } catch (err: any) {
          console.warn('[TelegramEngine] Bot login initialization error:', err.message);
        }
      }

      // Option B: StringSession Login (User Account)
      if (sessionString && sessionString.trim().length > 10) {
        try {
          this.authState.status = 'connecting';
          this.broadcast('AUTH_STATUS_CHANGED', this.authState);

          const session = new StringSession(sessionString.trim());

          this.client = new TelegramClient(session, apiIdNum, apiHash.trim(), {
            connectionRetries: 10,
            useWSS: false,
            autoReconnect: true
          });

          await this.client.connect();

          if (await this.client.isUserAuthorized()) {
            const me: any = await this.client.getMe();
            const userProfile: TelegramUserProfile = {
              id: me.id ? me.id.toString() : 'Unknown',
              firstName: me.firstName || 'Telegram User',
              lastName: me.lastName || '',
              username: me.username ? `@${me.username}` : undefined,
              phone: me.phone ? `+${me.phone}` : undefined,
              isBot: Boolean(me.bot),
              connectedAt: Date.now()
            };

            this.authState = {
              status: 'connected',
              userProfile
            };

            this.storage.saveConfig({
              accounts: [
                {
                  id: userProfile.id,
                  name: userProfile.firstName,
                  username: userProfile.username,
                  phone: userProfile.phone,
                  status: 'connected',
                  userProfile
                }
              ]
            });

            this.log({
              level: 'success',
              category: 'auth',
              title: 'Telegram Account Connected',
              message: `Authenticated as ${userProfile.firstName} ${userProfile.lastName || ''} (${userProfile.username || userProfile.phone || userProfile.id})`
            });

            this.broadcast('AUTH_STATUS_CHANGED', this.authState);

            // Auto-start forwarding engine if configured
            if (config.isEngineRunning || (config.rules.some((r) => r.enabled && r.sourceId && r.targetIds.length > 0))) {
              await this.startEngine().catch((err) => {
                console.warn('[TelegramEngine] Auto-start engine notice:', err.message);
              });
            }

            return true;
          } else {
            this.authState = { status: 'disconnected', userProfile: null };
            this.storage.clearSession();
            this.broadcast('AUTH_STATUS_CHANGED', this.authState);
            return false;
          }
        } catch (err: any) {
          console.error('[TelegramEngine] Auto-connect error:', err);
          this.authState = {
            status: 'error',
            errorMessage: err.message || 'Failed to restore Telegram session',
            userProfile: null
          };
          this.broadcast('AUTH_STATUS_CHANGED', this.authState);
          return false;
        }
      }

      return false;
    };

    this.initPromise = runInit();
    return this.initPromise;
  }

  // Step 1: Send Phone Code
  public async requestPhoneCode(apiId: number | string, apiHash: string, phoneNumber: string): Promise<{ success: boolean; phoneCodeHash?: string; message: string }> {
    try {
      this.authState = { status: 'connecting', phoneNumber, userProfile: null };
      this.broadcast('AUTH_STATUS_CHANGED', this.authState);

      const apiIdNum = typeof apiId === 'string' ? parseInt(apiId, 10) : apiId;
      if (isNaN(apiIdNum) || !apiHash.trim()) {
        throw new Error('Valid API ID (numeric) and API HASH are required.');
      }

      this.storage.saveConfig({ apiId: apiIdNum, apiHash: apiHash.trim() });

      const session = new StringSession('');
      this.client = new TelegramClient(session, apiIdNum, apiHash.trim(), {
        connectionRetries: 5,
        autoReconnect: true
      });

      await this.client.connect();

      const cleanPhone = phoneNumber.trim().replace(/[\s\-\(\)]/g, '');
      const result = await this.client.sendCode(
        {
          apiId: apiIdNum,
          apiHash: apiHash.trim()
        },
        cleanPhone
      );

      this.authState = {
        status: 'awaiting_code',
        phoneNumber: cleanPhone,
        phoneCodeHash: result.phoneCodeHash,
        userProfile: null
      };

      this.log({
        level: 'info',
        category: 'auth',
        title: 'Verification Code Dispatched',
        message: `Telegram verification code sent to ${cleanPhone}`
      });

      this.broadcast('AUTH_STATUS_CHANGED', this.authState);

      return {
        success: true,
        phoneCodeHash: result.phoneCodeHash,
        message: `Verification code sent to ${cleanPhone}`
      };
    } catch (err: any) {
      console.error('[TelegramEngine] requestPhoneCode error:', err);
      this.authState = {
        status: 'error',
        errorMessage: err.message || 'Failed to send phone code',
        userProfile: null
      };
      this.broadcast('AUTH_STATUS_CHANGED', this.authState);
      throw err;
    }
  }

  // Step 2: Verify Phone Code
  public async verifyCode(phoneCode: string): Promise<{ success: boolean; requires2FA?: boolean; message: string }> {
    if (!this.client || !this.authState.phoneNumber || !this.authState.phoneCodeHash) {
      throw new Error('No active authentication session. Please request code first.');
    }

    try {
      await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: this.authState.phoneNumber,
          phoneCodeHash: this.authState.phoneCodeHash,
          phoneCode: phoneCode.trim()
        })
      );

      // Successfully signed in!
      const sessionString = (this.client.session as any).save();
      this.storage.saveSession(sessionString);

      const me: any = await this.client.getMe();
      const userProfile: TelegramUserProfile = {
        id: me.id ? me.id.toString() : 'Unknown',
        firstName: me.firstName || 'Telegram User',
        lastName: me.lastName || '',
        username: me.username ? `@${me.username}` : undefined,
        phone: me.phone ? `+${me.phone}` : undefined,
        isBot: Boolean(me.bot),
        connectedAt: Date.now()
      };

      this.authState = {
        status: 'connected',
        userProfile
      };

      this.log({
        level: 'success',
        category: 'auth',
        title: 'Authentication Complete',
        message: `Successfully connected to Telegram account ${userProfile.firstName} (${userProfile.username || userProfile.phone})`
      });

      this.broadcast('AUTH_STATUS_CHANGED', this.authState);
      return { success: true, message: 'Logged in successfully!' };
    } catch (err: any) {
      // Check if 2FA password is required (standard Telegram SRP protocol response)
      if (err.message && (err.message.includes('SESSION_PASSWORD_NEEDED') || err.errorMessage === 'SESSION_PASSWORD_NEEDED')) {
        console.log('[TelegramEngine] Account requires 2FA Cloud Password. Transitioning authState to awaiting_2fa.');
        this.authState.status = 'awaiting_2fa';
        this.authState.errorMessage = undefined;
        this.broadcast('AUTH_STATUS_CHANGED', this.authState);
        return { success: false, requires2FA: true, message: '2FA Cloud Password required' };
      }

      console.error('[TelegramEngine] verifyCode error:', err);
      this.authState.status = 'error';
      this.authState.errorMessage = err.message || 'Verification failed';
      this.broadcast('AUTH_STATUS_CHANGED', this.authState);
      throw err;
    }
  }

  // Step 3: 2FA Password Verification with SRP
  public async verify2FA(password: string): Promise<{ success: boolean; message: string }> {
    if (!this.client) {
      throw new Error('Telegram client is not initialized.');
    }

    try {
      const passwordSrpResult = await this.client.invoke(new Api.account.GetPassword());
      const passwordSrpCheck = await computeCheck(passwordSrpResult, password.trim());
      await this.client.invoke(new Api.auth.CheckPassword({
        password: passwordSrpCheck
      }));

      const sessionString = (this.client.session as any).save();
      this.storage.saveSession(sessionString);

      const me: any = await this.client.getMe();
      const userProfile: TelegramUserProfile = {
        id: me.id ? me.id.toString() : 'Unknown',
        firstName: me.firstName || 'Telegram User',
        lastName: me.lastName || '',
        username: me.username ? `@${me.username}` : undefined,
        phone: me.phone ? `+${me.phone}` : undefined,
        isBot: Boolean(me.bot),
        connectedAt: Date.now()
      };

      this.authState = {
        status: 'connected',
        userProfile
      };

      this.log({
        level: 'success',
        category: 'auth',
        title: '2FA Verification Passed',
        message: `Connected securely as ${userProfile.firstName}`
      });

      this.broadcast('AUTH_STATUS_CHANGED', this.authState);
      return { success: true, message: '2FA verification succeeded!' };
    } catch (err: any) {
      console.error('[TelegramEngine] 2FA error:', err);
      this.authState.status = 'awaiting_2fa';
      this.authState.errorMessage = err.message || 'Incorrect 2FA password';
      this.broadcast('AUTH_STATUS_CHANGED', this.authState);
      throw err;
    }
  }

  // Connect via Bot Token
  public async connectWithBotToken(apiId: number | string, apiHash: string, botToken: string): Promise<{ success: boolean; message: string }> {
    try {
      this.authState = { status: 'connecting', userProfile: null };
      this.broadcast('AUTH_STATUS_CHANGED', this.authState);

      const apiIdNum = typeof apiId === 'string' ? parseInt(apiId, 10) : apiId;
      this.storage.saveConfig({ apiId: apiIdNum, apiHash: apiHash.trim(), botToken: botToken.trim() });

      const session = new StringSession('');
      this.client = new TelegramClient(session, apiIdNum, apiHash.trim(), {
        connectionRetries: 5,
        autoReconnect: true
      });

      await this.client.start({
        botAuthToken: botToken.trim()
      });

      const sessionString = (this.client.session as any).save();
      this.storage.saveSession(sessionString);

      const me: any = await this.client.getMe();
      const userProfile: TelegramUserProfile = {
        id: me.id ? me.id.toString() : 'Bot',
        firstName: me.firstName || 'Telegram Bot',
        username: me.username ? `@${me.username}` : undefined,
        isBot: true,
        connectedAt: Date.now()
      };

      this.authState = {
        status: 'connected',
        userProfile
      };

      this.log({
        level: 'success',
        category: 'auth',
        title: 'Bot Authenticated',
        message: `Bot @${me.username} connected successfully`
      });

      this.broadcast('AUTH_STATUS_CHANGED', this.authState);
      return { success: true, message: 'Bot connected successfully!' };
    } catch (err: any) {
      this.authState = {
        status: 'error',
        errorMessage: err.message || 'Failed to connect bot',
        userProfile: null
      };
      this.broadcast('AUTH_STATUS_CHANGED', this.authState);
      throw err;
    }
  }

  // Direct StringSession Login
  public async connectWithStringSession(apiId: number | string, apiHash: string, sessionString: string): Promise<{ success: boolean; message: string }> {
    try {
      this.authState = { status: 'connecting', userProfile: null };
      this.broadcast('AUTH_STATUS_CHANGED', this.authState);

      const apiIdNum = typeof apiId === 'string' ? parseInt(apiId, 10) : apiId;
      this.storage.saveConfig({ apiId: apiIdNum, apiHash: apiHash.trim(), sessionString: sessionString.trim() });

      const session = new StringSession(sessionString.trim());
      this.client = new TelegramClient(session, apiIdNum, apiHash.trim(), {
        connectionRetries: 5,
        autoReconnect: true
      });

      await this.client.connect();

      if (!(await this.client.isUserAuthorized())) {
        throw new Error('Provided session string is invalid or has expired.');
      }

      const me: any = await this.client.getMe();
      const userProfile: TelegramUserProfile = {
        id: me.id ? me.id.toString() : 'Unknown',
        firstName: me.firstName || 'Telegram User',
        lastName: me.lastName || '',
        username: me.username ? `@${me.username}` : undefined,
        phone: me.phone ? `+${me.phone}` : undefined,
        isBot: Boolean(me.bot),
        connectedAt: Date.now()
      };

      this.authState = {
        status: 'connected',
        userProfile
      };

      this.log({
        level: 'success',
        category: 'auth',
        title: 'Session String Verified',
        message: `Successfully connected as ${userProfile.firstName} (${userProfile.username || userProfile.phone || userProfile.id})`
      });

      this.broadcast('AUTH_STATUS_CHANGED', this.authState);
      return { success: true, message: 'Session connected successfully!' };
    } catch (err: any) {
      this.authState = {
        status: 'error',
        errorMessage: err.message || 'Failed to connect session',
        userProfile: null
      };
      this.broadcast('AUTH_STATUS_CHANGED', this.authState);
      throw err;
    }
  }

  // Disconnect / Logout
  public async disconnect(): Promise<void> {
    await this.stopEngine();
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (err) {
        // ignore
      }
      this.client = null;
    }
    this.storage.clearSession();
    this.authState = { status: 'disconnected', userProfile: null };
    this.log({
      level: 'info',
      category: 'auth',
      title: 'Telegram Disconnected',
      message: 'Account session was cleared and disconnected.'
    });
    this.broadcast('AUTH_STATUS_CHANGED', this.authState);
  }

  private cacheEntity(entity: any, idStr?: string) {
    if (!entity) return;
    if (idStr) {
      this.entityCache.set(idStr, entity);
      const normalized = normalizeChatId(idStr);
      if (normalized) this.entityCache.set(normalized, entity);
      if (!idStr.startsWith('-100') && !idStr.startsWith('-')) {
        this.entityCache.set(`-100${idStr}`, entity);
      }
    }
    if (entity.id) {
      const eId = entity.id.toString();
      this.entityCache.set(eId, entity);
      this.entityCache.set(normalizeChatId(eId), entity);
      this.entityCache.set(`-100${eId}`, entity);
    }
    if (entity.username) {
      this.entityCache.set(`@${entity.username.toLowerCase()}`, entity);
      this.entityCache.set(entity.username.toLowerCase(), entity);
    }
  }

  public async resolveEntity(idOrUsername: string | number): Promise<any> {
    if (!this.client) {
      throw new Error('Telegram client is not connected.');
    }

    const raw = typeof idOrUsername === 'string' ? idOrUsername.trim() : idOrUsername.toString();
    const normalized = normalizeChatId(raw);

    // 1. Check local entity cache
    if (this.entityCache.has(raw)) return this.entityCache.get(raw);
    if (this.entityCache.has(normalized)) return this.entityCache.get(normalized);
    if (this.entityCache.has(`-100${normalized}`)) return this.entityCache.get(`-100${normalized}`);

    // 2. Direct getEntity attempt
    try {
      const entity = await this.client.getEntity(raw);
      if (entity) {
        this.cacheEntity(entity, raw);
        return entity;
      }
    } catch (err) {
      const num = parseInt(raw, 10);
      if (!isNaN(num)) {
        try {
          const entity = await this.client.getEntity(num);
          if (entity) {
            this.cacheEntity(entity, raw);
            return entity;
          }
        } catch (e2) {
          // ignore
        }
      }
    }

    // 3. Fallback: refresh dialogs cache to warm up entity access hashes
    try {
      const dialogs = await this.client.getDialogs({ limit: 150 });
      for (const d of dialogs) {
        if (d.entity) {
          const dId = d.id ? d.id.toString() : '';
          this.cacheEntity(d.entity, dId);
        }
      }
      if (this.entityCache.has(raw)) return this.entityCache.get(raw);
      if (this.entityCache.has(normalized)) return this.entityCache.get(normalized);
      if (this.entityCache.has(`-100${normalized}`)) return this.entityCache.get(`-100${normalized}`);
    } catch (e3) {
      // ignore
    }

    // 4. Final attempt
    return await this.client.getEntity(raw);
  }

  // ==================== REAL CHAT DISCOVERY ====================

  public async discoverChats(): Promise<DiscoveredChat[]> {
    if (!this.client || this.authState.status !== 'connected') {
      throw new Error('Telegram client is not connected. Please login first.');
    }

    try {
      this.log({
        level: 'info',
        category: 'discovery',
        title: 'Discovering Dialogs',
        message: 'Querying Telegram account dialogs across channels, groups, supergroups...'
      });

      const dialogs = await this.client.getDialogs({ limit: 150 });
      const discovered: DiscoveredChat[] = [];

      for (const dialog of dialogs) {
        if (!dialog.entity) continue;

        const entity = dialog.entity as any;
        const idStr = dialog.id ? dialog.id.toString() : '';
        this.cacheEntity(entity, idStr);

        const title = dialog.title || entity.title || entity.firstName || 'Unnamed Chat';
        const username = entity.username ? `@${entity.username}` : undefined;

        let type: DiscoveredChat['type'] = 'user';
        if (dialog.isChannel) {
          type = entity.megagroup ? 'supergroup' : 'channel';
        } else if (dialog.isGroup) {
          type = 'group';
        } else if (entity.bot) {
          type = 'bot';
        }

        const isPrivate = !entity.username;
        const canSendMessages = Boolean(
          entity.creator ||
          (entity.adminRights && entity.adminRights.postMessages) ||
          (!dialog.isChannel && !entity.defaultBannedRights?.sendMessages) ||
          type === 'user' ||
          type === 'group'
        );

        discovered.push({
          id: idStr,
          title,
          username,
          type,
          isPrivate,
          unreadCount: dialog.unreadCount,
          participantsCount: entity.participantsCount,
          canSendMessages
        });
      }

      this.log({
        level: 'success',
        category: 'discovery',
        title: 'Chat Discovery Complete',
        message: `Found ${discovered.length} real Telegram entities (channels, groups, DMs)`
      });

      return discovered;
    } catch (err: any) {
      console.error('[TelegramEngine] Chat discovery error:', err);
      this.log({
        level: 'error',
        category: 'discovery',
        title: 'Discovery Failed',
        message: err.message || 'Error querying dialogs'
      });
      throw err;
    }
  }

  // Verify access & permissions for source and target entities
  public async verifyPipelinePermissions(sourceId: string, targetIds: string[]): Promise<{
    source: { id: string; title: string; readable: boolean; type: string };
    targets: Array<{ id: string; title: string; canPost: boolean; type: string }>;
    verified: boolean;
  }> {
    if (!this.client || this.authState.status !== 'connected') {
      throw new Error('Telegram client is not connected.');
    }

    let sourceInfo = { id: sourceId, title: sourceId, readable: false, type: 'unknown' };
    try {
      const srcEntity: any = await this.resolveEntity(sourceId);
      sourceInfo = {
        id: sourceId,
        title: srcEntity.title || srcEntity.firstName || sourceId,
        readable: true,
        type: srcEntity.megagroup ? 'supergroup' : srcEntity.broadcast ? 'channel' : srcEntity.firstName ? 'user' : 'group'
      };
    } catch (err: any) {
      throw new Error(`Failed to access source chat (${sourceId}): ${err.message || 'Entity not accessible'}`);
    }

    const targetsInfo = [];
    for (const targetId of targetIds) {
      try {
        const tgtEntity: any = await this.resolveEntity(targetId);
        const canPost = Boolean(
          tgtEntity.creator ||
          (tgtEntity.adminRights && tgtEntity.adminRights.postMessages) ||
          (!tgtEntity.broadcast && !tgtEntity.defaultBannedRights?.sendMessages) ||
          tgtEntity.firstName
        );
        targetsInfo.push({
          id: targetId,
          title: tgtEntity.title || tgtEntity.firstName || targetId,
          canPost,
          type: tgtEntity.megagroup ? 'supergroup' : tgtEntity.broadcast ? 'channel' : tgtEntity.firstName ? 'user' : 'group'
        });
      } catch (err: any) {
        targetsInfo.push({
          id: targetId,
          title: targetId,
          canPost: false,
          type: 'error'
        });
      }
    }

    const verified = sourceInfo.readable && targetsInfo.every((t) => t.canPost);
    return {
      source: sourceInfo,
      targets: targetsInfo,
      verified
    };
  }

  // Test sending a ping or verifying permission on target entity
  public async testTargetAccess(targetId: string, testMessage?: string): Promise<{ success: boolean; title?: string; message: string }> {
    if (!this.client || this.authState.status !== 'connected') {
      throw new Error('Telegram client is not connected.');
    }

    try {
      const entity: any = await this.resolveEntity(targetId);
      const title = entity.title || entity.firstName || `Entity (${targetId})`;

      if (testMessage) {
        await this.client.sendMessage(entity, {
          message: `🛰️ [TGForwarder Pro Test Ping]\nPipeline active at ${new Date().toISOString()}\nTarget: ${title}`
        });
      }

      return {
        success: true,
        title,
        message: `Access verified for ${title}. Ready to receive forwarded messages.`
      };
    } catch (err: any) {
      console.error('[TelegramEngine] testTargetAccess error:', err);
      throw new Error(`Failed to access target ${targetId}: ${err.message || 'Chat not found or permission denied'}`);
    }
  }

  // ==================== ENGINE LIFECYCLE (START / STOP / PAUSE) ====================

  public async startEngine(): Promise<{ success: boolean; message: string }> {
    if (!this.client || this.authState.status !== 'connected') {
      throw new Error('Cannot start forwarder: Telegram account is not authenticated.');
    }

    const config = this.storage.getConfig();
    const activeRules = config.rules.filter((r) => r.enabled && r.sourceId && r.targetIds.length > 0);

    if (activeRules.length === 0) {
      throw new Error('No enabled forwarding rules configured. Please add at least one rule with valid Source and Target.');
    }

    // Clean up existing listener if any
    await this.stopEngine();

    this.stats.startTime = Date.now();
    this.stats.activeRulesCount = activeRules.length;
    this.isPaused = false;
    this.storage.saveConfig({ isEngineRunning: true });

    // Start uptime tracker
    if (this.uptimeInterval) clearInterval(this.uptimeInterval);
    this.uptimeInterval = setInterval(() => {
      if (this.stats.startTime) {
        this.stats.uptimeSeconds = Math.floor((Date.now() - this.stats.startTime) / 1000);
        this.broadcast('STATS_UPDATED', this.stats);
      }
    }, 5000);

    // Setup event listener
    const handler = async (event: NewMessageEvent) => {
      await this.handleIncomingMessage(event);
    };

    this.activeEventHandler = handler;
    this.client.addEventHandler(handler, new NewMessage({}));

    // Start queue processor
    this.startQueueProcessor();

    this.log({
      level: 'success',
      category: 'system',
      title: 'Forwarding Engine Active',
      message: `Active pipeline listening on ${activeRules.length} rule funnels.`
    });

    this.broadcast('ENGINE_STATE_CHANGED', { isRunning: true });
    return { success: true, message: `Forwarding Engine running with ${activeRules.length} active rules.` };
  }

  public async stopEngine(): Promise<void> {
    if (this.client && this.activeEventHandler) {
      try {
        this.client.removeEventHandler(this.activeEventHandler, new NewMessage({}));
      } catch (err) {
        // ignore
      }
      this.activeEventHandler = null;
    }

    if (this.uptimeInterval) {
      clearInterval(this.uptimeInterval);
      this.uptimeInterval = null;
    }

    this.isPaused = false;
    this.storage.saveConfig({ isEngineRunning: false });
    this.broadcast('ENGINE_STATE_CHANGED', { isRunning: false, isPaused: false });

    this.log({
      level: 'info',
      category: 'system',
      title: 'Forwarding Engine Stopped',
      message: 'Background listener detached.'
    });
  }

  public pauseEngine(): { success: boolean; message: string } {
    if (!this.storage.getConfig().isEngineRunning) {
      throw new Error('Engine is not running.');
    }
    this.isPaused = true;
    this.broadcast('ENGINE_STATE_CHANGED', { isRunning: true, isPaused: true });
    this.log({
      level: 'warn',
      category: 'system',
      title: '⏸️ Forwarding Engine Paused',
      message: 'Processing paused. Incoming messages will be held/skipped.'
    });
    return { success: true, message: 'Forwarding engine paused.' };
  }

  public resumeEngine(): { success: boolean; message: string } {
    if (!this.storage.getConfig().isEngineRunning) {
      throw new Error('Engine is not running.');
    }
    this.isPaused = false;
    this.broadcast('ENGINE_STATE_CHANGED', { isRunning: true, isPaused: false });
    this.log({
      level: 'info',
      category: 'system',
      title: '▶️ Forwarding Engine Resumed',
      message: 'Processing resumed. Real-time forwarding active.'
    });
    return { success: true, message: 'Forwarding engine resumed.' };
  }

  public isEnginePaused(): boolean {
    return this.isPaused;
  }

  // ==================== 5-STAGE MESSAGE PIPELINE ====================
  // DETECTED → FILTER → QUEUED → PROCESSING → PUBLISHED (or error)

  private async handleIncomingMessage(event: NewMessageEvent) {
    if (!this.storage.getConfig().isEngineRunning || !this.client) return;
    if (this.isPaused) {
      return; // Engine paused
    }

    try {
      const message = event.message;
      if (!message) return;

      const chatId = message.chatId ? message.chatId.toString() : '';
      if (!chatId) return;

      const config = this.storage.getConfig();
      
      // Match rules by sourceId
      const matchingRules = config.rules.filter((rule) => {
        if (!rule.enabled || !rule.sourceId) return false;
        const normalizedRuleSource = rule.sourceId.replace(/^-100/, '').trim();
        const normalizedChatId = chatId.replace(/^-100/, '').trim();
        return (
          rule.sourceId === chatId ||
          normalizedRuleSource === normalizedChatId ||
          (rule.sourceUsername && event.chat && (event.chat as any).username && `@${(event.chat as any).username.toLowerCase()}` === rule.sourceUsername.toLowerCase())
        );
      });

      if (matchingRules.length === 0) {
        return; // Not a monitored source
      }

      this.stats.totalReceived++;
      this.stats.lastActiveTime = Date.now();

      const rawText = message.message || message.text || '';
      const chatTitle = event.chat ? (event.chat as any).title || (event.chat as any).firstName || chatId : chatId;
      const snippet = rawText.length > 80 ? rawText.substring(0, 80) + '...' : rawText || '[Media/Attachment]';

      // ================= 1. DETECTED =================
      this.log({
        level: 'info',
        category: 'forward',
        title: '🛰️ DETECTED: Incoming Message',
        message: `Message #${message.id} intercepted from source: "${chatTitle}"`,
        sourceId: chatId,
        sourceTitle: chatTitle,
        messageSnippet: snippet
      });

      for (const rule of matchingRules) {
        // ================= 2. FILTER =================
        this.log({
          level: 'info',
          category: 'filter',
          title: '🔍 FILTER: Rule & Safeguard Checks',
          message: `Evaluating filters for rule "${rule.name}"`,
          sourceId: chatId,
          sourceTitle: rule.sourceTitle,
          messageSnippet: snippet
        });

        // 2a. Duplicate Protection
        const mediaFingerprint = message.media ? (message.media.className || 'media') : 'text';
        const contentHash = crypto.createHash('md5').update(`${chatId}:${rawText}:${mediaFingerprint}`).digest('hex');

        if (rule.duplicateProtection) {
          // Check if already forwarded to any target
          let isDupe = false;
          for (const targetId of rule.targetIds) {
            if (this.storage.isDuplicate(chatId, message.id, targetId, contentHash)) {
              isDupe = true;
              break;
            }
          }

          if (isDupe) {
            this.stats.duplicatesBlocked++;
            this.log({
              level: 'warn',
              category: 'duplicate',
              title: '🛡️ DUPLICATE BLOCKED: Message Already Relayed',
              message: `Duplicate skipped for message #${message.id} in rule "${rule.name}"`,
              sourceId: chatId,
              sourceTitle: rule.sourceTitle,
              messageSnippet: snippet
            });
            continue;
          }
        }

        // 2b. Keyword Filters (Include / Exclude)
        const lowerText = rawText.toLowerCase();
        const excludeKeywords = [...(rule.excludeKeywords || []), ...(rule.filterKeywords || [])];
        if (excludeKeywords.length > 0) {
          const matchedExclude = excludeKeywords.find((kw) => kw.trim() && lowerText.includes(kw.trim().toLowerCase()));
          if (matchedExclude) {
            this.stats.filtersTriggered++;
            this.log({
              level: 'warn',
              category: 'filter',
              title: '🛑 FILTERED: Exclude Keyword Match',
              message: `Message skipped due to keyword: "${matchedExclude}"`,
              sourceId: chatId,
              sourceTitle: rule.sourceTitle,
              messageSnippet: snippet
            });
            continue;
          }
        }

        if (rule.useKeywordFilter && rule.includeKeywords && rule.includeKeywords.length > 0) {
          const hasIncludeMatch = rule.includeKeywords.some((kw) => kw.trim() && lowerText.includes(kw.trim().toLowerCase()));
          if (!hasIncludeMatch) {
            this.stats.filtersTriggered++;
            this.log({
              level: 'warn',
              category: 'filter',
              title: '🛑 FILTERED: Missing Required Keyword',
              message: `Message did not match any required include keywords`,
              sourceId: chatId,
              sourceTitle: rule.sourceTitle,
              messageSnippet: snippet
            });
            continue;
          }
        }

        // 2c. Sender Filters
        if (rule.senderFilter && rule.senderFilter.enabled) {
          const senderId = message.senderId ? message.senderId.toString() : '';
          const senderIsBot = message.sender ? Boolean((message.sender as any).bot) : false;

          if (rule.senderFilter.ignoreBots && senderIsBot) {
            this.stats.sendersBlocked = (this.stats.sendersBlocked || 0) + 1;
            this.log({
              level: 'warn',
              category: 'filter',
              title: '🛑 FILTERED: Bot Sender Ignored',
              message: `Message from bot sender ignored by rule policy`,
              sourceId: chatId,
              sourceTitle: rule.sourceTitle
            });
            continue;
          }

          if (rule.senderFilter.senderIds && rule.senderFilter.senderIds.length > 0) {
            const inList = rule.senderFilter.senderIds.includes(senderId);
            if (rule.senderFilter.mode === 'whitelist' && !inList) {
              this.stats.sendersBlocked = (this.stats.sendersBlocked || 0) + 1;
              this.log({
                level: 'warn',
                category: 'filter',
                title: '🛑 FILTERED: Sender Not in Whitelist',
                message: `Sender ID ${senderId} not in authorized whitelist`,
                sourceId: chatId,
                sourceTitle: rule.sourceTitle
              });
              continue;
            } else if (rule.senderFilter.mode === 'blacklist' && inList) {
              this.stats.sendersBlocked = (this.stats.sendersBlocked || 0) + 1;
              this.log({
                level: 'warn',
                category: 'filter',
                title: '🛑 FILTERED: Blacklisted Sender',
                message: `Sender ID ${senderId} is blacklisted in rule`,
                sourceId: chatId,
                sourceTitle: rule.sourceTitle
              });
              continue;
            }
          }
        }

        // 2d. Media Filter
        if (rule.mediaFilter) {
          const hasMedia = Boolean(message.media);
          if (!hasMedia && !rule.mediaFilter.allowText) {
            this.stats.mediaBlocked = (this.stats.mediaBlocked || 0) + 1;
            this.log({
              level: 'warn',
              category: 'filter',
              title: '🛑 FILTERED: Plain Text Disallowed',
              message: `Text-only messages disabled for this rule`,
              sourceId: chatId,
              sourceTitle: rule.sourceTitle
            });
            continue;
          }
        }

        // ================= 3. TEXT TRANSFORMATION (PROCESSING PREP) =================
        let processedText = rawText;
        if (rule.dropLinks) {
          processedText = processedText.replace(/https?:\/\/[^\s]+/g, '').replace(/t\.me\/[^\s]+/g, '').trim();
        }
        if (rule.prependText && rule.prependText.trim()) {
          processedText = `${rule.prependText.trim()}\n\n${processedText}`;
        }
        if (rule.appendText && rule.appendText.trim()) {
          processedText = `${processedText}\n\n${rule.appendText.trim()}`;
        }

        // ================= 4. QUEUED =================
        for (let i = 0; i < rule.targetIds.length; i++) {
          const targetId = rule.targetIds[i];
          const targetTitle = rule.targetTitles[i] || targetId;

          this.log({
            level: 'info',
            category: 'system',
            title: '⏳ QUEUED: Pacing & Rate Limit Queue',
            message: `Enqueued for dispatch to "${targetTitle}"`,
            sourceId: chatId,
            sourceTitle: rule.sourceTitle,
            targetId,
            targetTitle,
            messageSnippet: snippet
          });

          this.messageQueue.push({
            event,
            rule,
            targetId,
            targetTitle,
            processedText,
            scheduledTime: Date.now(),
            retries: 0
          });
        }
      }

      this.broadcast('STATS_UPDATED', this.stats);
    } catch (err: any) {
      console.error('[TelegramEngine] Error in handleIncomingMessage:', err);
      this.log({
        level: 'error',
        category: 'system',
        title: '❌ FAILED: Pipeline Execution Error',
        message: err.message || 'Unexpected error processing message'
      });
    }
  }

  // ==================== QUEUE PROCESSOR & PACING ====================

  private startQueueProcessor() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    const processNext = async () => {
      if (!this.storage.getConfig().isEngineRunning || !this.client) {
        this.isProcessingQueue = false;
        return;
      }

      if (this.messageQueue.length === 0) {
        setTimeout(processNext, 200);
        return;
      }

      const rateLimit: RateLimitConfig = this.storage.getConfig().globalRateLimit || {
        minDelayMs: 1200,
        maxMessagesPerMinute: 25,
        autoSleepOnFloodWait: true,
        retryAttempts: 3,
        exponentialBackoff: true
      };

      const now = Date.now();
      // Clean old timestamps for sliding 1-minute window
      this.sentTimestamps = this.sentTimestamps.filter((t) => now - t < 60000);

      // Check max messages per minute
      if (this.sentTimestamps.length >= rateLimit.maxMessagesPerMinute) {
        const oldest = this.sentTimestamps[0];
        const waitMs = Math.max(200, 60000 - (now - oldest));
        setTimeout(processNext, waitMs);
        return;
      }

      // Check min delay between sends
      const timeSinceLast = now - this.lastDispatchTime;
      if (timeSinceLast < rateLimit.minDelayMs) {
        setTimeout(processNext, rateLimit.minDelayMs - timeSinceLast);
        return;
      }

      const item = this.messageQueue.shift();
      if (!item) {
        setTimeout(processNext, 100);
        return;
      }

      try {
        await this.dispatchItem(item, rateLimit);
        this.lastDispatchTime = Date.now();
        this.sentTimestamps.push(this.lastDispatchTime);
      } catch (err) {
        console.error('[TelegramEngine] Error dispatching queue item:', err);
      }

      setTimeout(processNext, rateLimit.minDelayMs);
    };

    processNext();
  }

  private async dispatchItem(item: QueuedMessage, rateLimit: RateLimitConfig) {
    const { event, rule, targetId, targetTitle, processedText } = item;
    const message = event.message;
    const chatId = message.chatId ? message.chatId.toString() : '';
    const snippet = processedText.length > 80 ? processedText.substring(0, 80) + '...' : processedText || '[Media]';

    // ================= 4. PROCESSING =================
    this.log({
      level: 'info',
      category: 'forward',
      title: '⚙️ PROCESSING: Transforming Content Payload',
      message: `Preparing dispatch (Signature: ${rule.removeForwardSignature ? 'Clean Repost' : 'Native Forward'}) → "${targetTitle}"`,
      sourceId: chatId,
      sourceTitle: rule.sourceTitle,
      targetId,
      targetTitle,
      messageSnippet: snippet
    });

    try {
      const targetEntity = await this.resolveEntity(targetId);
      let targetMsgId: number | string = 0;

      if (rule.removeForwardSignature) {
        // Clean Repost without "Forwarded from" header (Direct MTProto message generation)
        const sent: any = await this.client!.sendMessage(targetEntity, {
          message: processedText,
          file: message.media || undefined,
          formattingEntities: rule.preserveFormatting ? message.entities : undefined
        });
        targetMsgId = sent ? sent.id : 0;
      } else {
        // Native Telegram Forward with auto-fallback for restricted private channels
        try {
          const sent: any = await this.client!.forwardMessages(targetEntity, {
            messages: [message.id],
            fromPeer: message.chatId
          });
          targetMsgId = sent && Array.isArray(sent) && sent[0] ? sent[0].id : 0;
        } catch (fwdErr: any) {
          if (fwdErr.message && (fwdErr.message.includes('FORWARDS_RESTRICTED') || fwdErr.message.includes('RESTRICTED') || fwdErr.message.includes('CHAT_FORWARDS_RESTRICTED'))) {
            this.log({
              level: 'warn',
              category: 'forward',
              title: '🛡️ RESTRICTED SOURCE: Bypassing with Clean Repost',
              message: `Source channel has saving restrictions. Automatically relayed via direct repost.`
            });
            const sent: any = await this.client!.sendMessage(targetEntity, {
              message: processedText,
              file: message.media || undefined,
              formattingEntities: rule.preserveFormatting ? message.entities : undefined
            });
            targetMsgId = sent ? sent.id : 0;
          } else {
            throw fwdErr;
          }
        }
      }

      // ================= 5. PUBLISHED =================
      const mediaFingerprint = message.media ? (message.media.className || 'media') : 'text';
      const contentHash = crypto.createHash('md5').update(`${chatId}:${message.message || ''}:${mediaFingerprint}`).digest('hex');
      this.storage.recordMapping(chatId, message.id, targetId, targetMsgId, contentHash);

      this.stats.totalForwarded++;
      this.log({
        level: 'success',
        category: 'forward',
        title: '✅ PUBLISHED: Forward Delivered',
        message: `Successfully relayed to "${targetTitle}" (Target Msg #${targetMsgId})`,
        sourceId: rule.sourceId,
        sourceTitle: rule.sourceTitle,
        targetId,
        targetTitle,
        messageSnippet: snippet
      });

      this.broadcast('STATS_UPDATED', this.stats);
    } catch (err: any) {
      console.error(`[TelegramEngine] Error dispatching to ${targetId}:`, err);

      // Handle FloodWait
      if (err.message && err.message.includes('FLOOD_WAIT_')) {
        this.stats.floodWaitsHandled = (this.stats.floodWaitsHandled || 0) + 1;
        const secondsMatch = err.message.match(/FLOOD_WAIT_(\d+)/);
        const waitSec = secondsMatch ? parseInt(secondsMatch[1], 10) : 30;

        this.log({
          level: 'warn',
          category: 'system',
          title: '⚠️ FLOOD WAIT: Cooldown Triggered',
          message: `Telegram rate limit hit. Pausing queue for ${waitSec}s...`
        });

        if (rateLimit.autoSleepOnFloodWait && item.retries < rateLimit.retryAttempts) {
          item.retries++;
          setTimeout(() => {
            this.messageQueue.unshift(item);
          }, (waitSec + 1) * 1000);
        } else {
          this.stats.totalFailed++;
        }
      } else {
        this.stats.totalFailed++;
        this.log({
          level: 'error',
          category: 'forward',
          title: '❌ FAILED: Forward Delivery Failed',
          message: `Failed relaying to "${targetTitle}": ${err.message || 'Write permission denied or chat not found'}`,
          targetId,
          targetTitle
        });
      }

      this.broadcast('STATS_UPDATED', this.stats);
    }
  }
}
