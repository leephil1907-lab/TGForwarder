import fs from 'fs';
import path from 'path';

export interface ForwardingRule {
  id: string;
  name: string;
  accountId?: string;
  sourceId: string;
  sourceTitle: string;
  sourceUsername?: string;
  targetIds: string[];
  targetTitles: string[];
  removeForwardSignature: boolean; // clean repost without "forwarded from"
  duplicateProtection: boolean;
  preserveFormatting?: boolean;
  useKeywordFilter?: boolean;
  includeKeywords?: string[];
  excludeKeywords?: string[];
  filterKeywords?: string[];
  mediaFilter?: {
    allowText: boolean;
    allowPhoto: boolean;
    allowVideo: boolean;
    allowAudio: boolean;
    allowVoice: boolean;
    allowDocument: boolean;
    allowSticker: boolean;
    allowAnimation: boolean;
  };
  senderFilter?: {
    enabled: boolean;
    mode: 'whitelist' | 'blacklist';
    senderIds: string[];
    ignoreBots: boolean;
  };
  dropLinks?: boolean;
  prependText?: string;
  appendText?: string;
  enabled: boolean;
  createdAt: number;
}

export interface RateLimitConfig {
  minDelayMs: number;
  maxMessagesPerMinute: number;
  autoSleepOnFloodWait: boolean;
  retryAttempts: number;
  exponentialBackoff: boolean;
}

export interface ForwarderConfig {
  apiId?: number | string;
  apiHash?: string;
  sessionString?: string;
  botToken?: string;
  isEngineRunning: boolean;
  rules: ForwardingRule[];
  accounts?: any[];
  globalRateLimit?: RateLimitConfig;
  defaultRemoveSignature: boolean;
  retryOnFloodWait: boolean;
  maxRetryCount: number;
}

export interface ActivityLog {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  category: 'auth' | 'forward' | 'duplicate' | 'filter' | 'system' | 'discovery';
  title: string;
  message: string;
  sourceId?: string;
  sourceTitle?: string;
  targetId?: string;
  targetTitle?: string;
  accountId?: string;
  details?: Record<string, any>;
  messageSnippet?: string;
}

export interface EngineStats {
  totalReceived: number;
  totalForwarded: number;
  totalFailed: number;
  duplicatesBlocked: number;
  filtersTriggered: number;
  mediaBlocked?: number;
  sendersBlocked?: number;
  floodWaitsHandled?: number;
  activeRulesCount: number;
  uptimeSeconds: number;
  lastActiveTime: number | null;
  startTime: number | null;
}

export interface MessageMappingRecord {
  id: string;
  sourceChatId: string;
  sourceMsgId: number | string;
  targetChatId: string;
  targetMsgId: number | string;
  hash?: string;
  timestamp: number;
}

export const normalizeChatId = (id: string | number): string => {
  if (!id) return '';
  const str = id.toString().trim();
  return str.replace(/^-100/, '').replace(/^-/, '');
};

const DATA_DIR = path.join(process.cwd(), '.data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const MAPPINGS_FILE = path.join(DATA_DIR, 'mappings.json');

const buildInitialRules = (): ForwardingRule[] => {
  const envSource = process.env.TG_SOURCE_ID?.trim();
  const envTarget = process.env.TG_TARGET_ID?.trim();
  if (envSource && envTarget) {
    return [
      {
        id: 'rule-env-primary',
        name: 'Auto Funnel (Environment Config)',
        sourceId: envSource,
        sourceTitle: `Source Channel (${envSource})`,
        targetIds: [envTarget],
        targetTitles: [`Target Channel (${envTarget})`],
        removeForwardSignature: true,
        duplicateProtection: true,
        preserveFormatting: true,
        useKeywordFilter: false,
        includeKeywords: [],
        excludeKeywords: [],
        filterKeywords: [],
        dropLinks: false,
        prependText: '',
        appendText: '',
        enabled: true,
        createdAt: Date.now()
      }
    ];
  }
  return [];
};

const DEFAULT_CONFIG: ForwarderConfig = {
  apiId: process.env.TG_API_ID || '',
  apiHash: process.env.TG_API_HASH || '',
  sessionString: process.env.TG_SESSION_STRING || '',
  botToken: process.env.TG_BOT_TOKEN || '',
  isEngineRunning: false,
  defaultRemoveSignature: true,
  retryOnFloodWait: true,
  maxRetryCount: 3,
  globalRateLimit: {
    minDelayMs: 1200,
    maxMessagesPerMinute: 25,
    autoSleepOnFloodWait: true,
    retryAttempts: 3,
    exponentialBackoff: true
  },
  rules: buildInitialRules()
};

export class StorageManager {
  private static instance: StorageManager;
  private config: ForwarderConfig;
  private mappings: Map<string, MessageMappingRecord> = new Map();
  private mappingsSaveTimer: NodeJS.Timeout | null = null;
  private mappingsDirty = false;
  private static readonly MAPPINGS_FLUSH_INTERVAL_MS = 3000;

  private constructor() {
    this.ensureDataDir();
    this.config = this.loadConfig();
    this.loadMappings();
  }

  public static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadConfig(): ForwarderConfig {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        
        // Remove legacy placeholder rules that had no real IDs
        if (parsed.rules && Array.isArray(parsed.rules)) {
          parsed.rules = parsed.rules.filter((r: ForwardingRule) => r.sourceId && r.sourceId.trim() !== '');
        }

        // Merge environment variables if not present in saved config
        if (!parsed.apiId && process.env.TG_API_ID) parsed.apiId = process.env.TG_API_ID;
        if (!parsed.apiHash && process.env.TG_API_HASH) parsed.apiHash = process.env.TG_API_HASH;
        if (!parsed.sessionString && process.env.TG_SESSION_STRING) parsed.sessionString = process.env.TG_SESSION_STRING;
        if (!parsed.botToken && process.env.TG_BOT_TOKEN) parsed.botToken = process.env.TG_BOT_TOKEN;

        // If no rules exist but env has source and target, insert initial rule
        if ((!parsed.rules || parsed.rules.length === 0) && process.env.TG_SOURCE_ID && process.env.TG_TARGET_ID) {
          parsed.rules = buildInitialRules();
        }

        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (err) {
      console.error('[StorageManager] Error loading config:', err);
    }
    return { ...DEFAULT_CONFIG };
  }

  private loadMappings() {
    try {
      if (fs.existsSync(MAPPINGS_FILE)) {
        const raw = fs.readFileSync(MAPPINGS_FILE, 'utf-8');
        const list: MessageMappingRecord[] = JSON.parse(raw);
        const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000; // keep 14 days of message mappings
        for (const item of list) {
          if (item.timestamp > cutoff) {
            const normSrc = normalizeChatId(item.sourceChatId);
            const normTgt = normalizeChatId(item.targetChatId);
            const key = `${normSrc}_${item.sourceMsgId}_${normTgt}`;
            this.mappings.set(key, item);
            if (item.hash) {
              this.mappings.set(`${normSrc}_hash_${item.hash}_${normTgt}`, item);
            }
          }
        }
      }
    } catch (err) {
      console.error('[StorageManager] Error loading mappings:', err);
    }
  }

  // Marks the mappings as needing a save and schedules a single debounced
  // flush a few seconds out. Called once per forwarded message, so without
  // debouncing every single forward would trigger a synchronous rewrite of
  // the entire (up to 10k-record) mappings file and stall the event loop.
  private scheduleMappingsSave() {
    this.mappingsDirty = true;
    if (this.mappingsSaveTimer) return;
    this.mappingsSaveTimer = setTimeout(() => {
      this.mappingsSaveTimer = null;
      this.flushMappings();
    }, StorageManager.MAPPINGS_FLUSH_INTERVAL_MS);
    // Don't let a pending flush keep the process alive on shutdown.
    if (typeof this.mappingsSaveTimer.unref === 'function') {
      this.mappingsSaveTimer.unref();
    }
  }

  // Synchronous immediate write. Used for the debounced flush, for
  // user-initiated actions like clearMappings(), and on process shutdown.
  private flushMappings() {
    if (!this.mappingsDirty) return;
    this.mappingsDirty = false;
    try {
      this.ensureDataDir();
      // De-duplicate items by id or exact key when persisting
      const uniqueRecords = new Map<string, MessageMappingRecord>();
      for (const [key, item] of this.mappings.entries()) {
        if (!key.includes('_hash_')) {
          uniqueRecords.set(item.id || key, item);
        }
      }
      const list = Array.from(uniqueRecords.values());
      const tmpFile = `${MAPPINGS_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(list.slice(-10000), null, 2), 'utf-8');
      fs.renameSync(tmpFile, MAPPINGS_FILE); // atomic on POSIX filesystems — avoids a torn/corrupt file on crash
    } catch (err) {
      console.error('[StorageManager] Error writing mappings:', err);
    }
  }

  // Call on graceful shutdown so a pending debounced save isn't lost.
  public flushPendingWrites(): void {
    if (this.mappingsSaveTimer) {
      clearTimeout(this.mappingsSaveTimer);
      this.mappingsSaveTimer = null;
    }
    this.flushMappings();
  }

  public isDuplicate(sourceChatId: string, sourceMsgId: number | string, targetChatId: string, contentHash?: string): boolean {
    const normSrc = normalizeChatId(sourceChatId);
    const normTgt = normalizeChatId(targetChatId);
    const key = `${normSrc}_${sourceMsgId}_${normTgt}`;
    if (this.mappings.has(key)) {
      return true;
    }
    if (contentHash) {
      const hashKey = `${normSrc}_hash_${contentHash}_${normTgt}`;
      if (this.mappings.has(hashKey)) {
        return true;
      }
    }
    return false;
  }

  public recordMapping(sourceChatId: string, sourceMsgId: number | string, targetChatId: string, targetMsgId: number | string, contentHash?: string): MessageMappingRecord {
    const normSrc = normalizeChatId(sourceChatId);
    const normTgt = normalizeChatId(targetChatId);
    const key = `${normSrc}_${sourceMsgId}_${normTgt}`;
    const record: MessageMappingRecord = {
      id: `map-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      sourceChatId: sourceChatId.toString(),
      sourceMsgId,
      targetChatId: targetChatId.toString(),
      targetMsgId,
      hash: contentHash,
      timestamp: Date.now()
    };

    this.mappings.set(key, record);
    if (contentHash) {
      this.mappings.set(`${normSrc}_hash_${contentHash}_${normTgt}`, record);
    }
    this.scheduleMappingsSave();
    return record;
  }

  public getMapping(sourceChatId: string, sourceMsgId: number | string, targetChatId: string): MessageMappingRecord | null {
    const normSrc = normalizeChatId(sourceChatId);
    const normTgt = normalizeChatId(targetChatId);
    const key = `${normSrc}_${sourceMsgId}_${normTgt}`;
    return this.mappings.get(key) || null;
  }

  public getMappedTargetMsgId(sourceChatId: string, sourceMsgId: number | string, targetChatId: string): number | string | null {
    const record = this.getMapping(sourceChatId, sourceMsgId, targetChatId);
    return record ? record.targetMsgId : null;
  }

  public getAllMappingsForSource(sourceChatId: string, sourceMsgId: number | string): MessageMappingRecord[] {
    const normSrc = normalizeChatId(sourceChatId);
    const prefix = `${normSrc}_${sourceMsgId}_`;
    const results: MessageMappingRecord[] = [];
    for (const [key, record] of this.mappings.entries()) {
      if (key.startsWith(prefix) && !key.includes('_hash_')) {
        results.push(record);
      }
    }
    return results;
  }

  public getAllMappings(limit = 100): MessageMappingRecord[] {
    const uniqueRecords = new Map<string, MessageMappingRecord>();
    for (const [key, item] of this.mappings.entries()) {
      if (!key.includes('_hash_')) {
        uniqueRecords.set(item.id || key, item);
      }
    }
    return Array.from(uniqueRecords.values()).slice(-limit).reverse();
  }

  public getMappingsCount(): number {
    let count = 0;
    for (const key of this.mappings.keys()) {
      if (!key.includes('_hash_')) count++;
    }
    return count;
  }

  public clearMappings(): void {
    this.mappings.clear();
    this.mappingsDirty = true;
    this.flushMappings();
  }

  public getConfig(): ForwarderConfig {
    return { ...this.config };
  }

  public getSafeConfig(): Omit<ForwarderConfig, 'sessionString' | 'botToken'> & { hasSession: boolean; hasBotToken: boolean } {
    const { sessionString, apiHash, botToken, accounts, ...rest } = this.config;
    const safeAccounts = accounts?.map((acc) => ({
      id: acc.id,
      name: acc.name,
      username: acc.username,
      phone: acc.phone,
      status: acc.status,
      userProfile: acc.userProfile
    }));

    return {
      ...rest,
      accounts: safeAccounts,
      apiHash: apiHash ? (apiHash.length > 8 ? `${apiHash.slice(0, 4)}••••${apiHash.slice(-4)}` : '••••••••') : '',
      hasSession: Boolean(sessionString && sessionString.length > 5),
      hasBotToken: Boolean(botToken && botToken.length > 5)
    };
  }

  public saveConfig(newConfig: Partial<ForwarderConfig>): ForwarderConfig {
    this.config = { ...this.config, ...newConfig };
    try {
      this.ensureDataDir();
      const tmpFile = `${CONFIG_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(this.config, null, 2), 'utf-8');
      fs.renameSync(tmpFile, CONFIG_FILE); // atomic on POSIX filesystems
    } catch (err) {
      console.error('[StorageManager] Error writing config:', err);
    }
    return this.config;
  }

  public saveSession(sessionString: string) {
    this.config.sessionString = sessionString;
    this.saveConfig({ sessionString });
  }

  public clearSession() {
    this.config.sessionString = '';
    this.saveConfig({ sessionString: '' });
  }

  public addRule(rule: Omit<ForwardingRule, 'id' | 'createdAt'>): ForwardingRule {
    const newRule: ForwardingRule = {
      ...rule,
      id: `rule-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      createdAt: Date.now()
    };
    this.config.rules.push(newRule);
    this.saveConfig({ rules: this.config.rules });
    return newRule;
  }

  public updateRule(id: string, updates: Partial<ForwardingRule>): ForwardingRule | null {
    const index = this.config.rules.findIndex((r) => r.id === id);
    if (index === -1) return null;
    this.config.rules[index] = { ...this.config.rules[index], ...updates };
    this.saveConfig({ rules: this.config.rules });
    return this.config.rules[index];
  }

  public deleteRule(id: string): boolean {
    const initialLen = this.config.rules.length;
    this.config.rules = this.config.rules.filter((r) => r.id !== id);
    if (this.config.rules.length !== initialLen) {
      this.saveConfig({ rules: this.config.rules });
      return true;
    }
    return false;
  }
}
