export interface TelegramUserProfile {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
  phone?: string;
  isBot: boolean;
  connectedAt: number;
}

export interface SafeTelegramAccount {
  id: string;
  name?: string;
  username?: string;
  phone?: string;
  apiId?: number | string;
  userProfile?: TelegramUserProfile | null;
  status: 'disconnected' | 'connecting' | 'awaiting_code' | 'awaiting_2fa' | 'connected' | 'error';
  errorMessage?: string;
  connectedAt?: number;
}

export interface TelegramAccount extends SafeTelegramAccount {
  apiHash?: string;
  sessionString?: string;
}

export interface AuthState {
  status: 'disconnected' | 'connecting' | 'awaiting_code' | 'awaiting_2fa' | 'connected' | 'error';
  phoneCodeHash?: string;
  phoneNumber?: string;
  errorMessage?: string;
  userProfile?: TelegramUserProfile | null;
  accountId?: string;
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
  accountId?: string;
}

export interface MessageTypeFilter {
  allowText: boolean;
  allowPhoto: boolean;
  allowVideo: boolean;
  allowAudio: boolean;
  allowVoice: boolean;
  allowDocument: boolean;
  allowSticker: boolean;
  allowAnimation: boolean;
}

export interface SenderFilter {
  enabled: boolean;
  mode: 'whitelist' | 'blacklist';
  senderIds: string[];
  ignoreBots: boolean;
}

export interface ForwardingRule {
  id: string;
  name: string;
  accountId?: string; // 'all' or specific account id
  sourceId: string;
  sourceTitle: string;
  sourceUsername?: string;
  targetIds: string[];
  targetTitles: string[];
  removeForwardSignature: boolean; // clean repost without "forwarded from"
  autoPublish?: boolean; // true = publish instantly; false = stage in Pending Posts for review
  duplicateProtection: boolean;
  preserveFormatting?: boolean;
  useKeywordFilter?: boolean;
  includeKeywords?: string[];
  excludeKeywords?: string[];
  filterKeywords?: string[]; // backwards compatibility
  mediaFilter?: MessageTypeFilter;
  senderFilter?: SenderFilter;
  dropLinks?: boolean;
  prependText?: string;
  appendText?: string;
  enabled: boolean;
  createdAt: number;
}

export interface ActivityLog {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'success';
  category: 'auth' | 'forward' | 'duplicate' | 'filter' | 'system' | 'discovery' | 'fetcher';
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

export interface RateLimitConfig {
  minDelayMs: number;
  maxMessagesPerMinute: number;
  autoSleepOnFloodWait: boolean;
  retryAttempts: number;
  exponentialBackoff: boolean;
}

export type FetcherMediaType = 'text' | 'photo' | 'video' | 'audio' | 'voice' | 'document' | 'sticker' | 'animation' | 'unknown';

export interface FetcherItem {
  id: string;
  link: string;
  chatRef: string;
  chatTitle: string;
  messageId: number;
  isPrivate: boolean;
  threadId?: number;
  status: 'queued' | 'processing' | 'delivered' | 'failed' | 'skipped';
  error?: string;
  mediaType: FetcherMediaType;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  snippet: string;
  albumSize: number;
  deliveredTo?: string;
  deliveredMsgId?: string;
  downloadFiles: string[];
  downloadReady: boolean;
  retries: number;
}

export interface AutoImportWatch {
  id: string;
  sourceId: string;
  sourceTitle: string;
  targetId: string;
  targetTitle: string;
  intervalMinutes: number;
  enabled: boolean;
  lastMessageId: number | null;
  baselineSet: boolean;
  importLatestOnStart: boolean;
  createdAt: number;
  lastRunAt: number | null;
  lastRunMs?: number;
  lastError?: string;
  lastImportedCount: number;
  totalImported: number;
}

export interface FetcherJob {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  options: {
    sendToTelegram: boolean;
    saveForDownload: boolean;
    targetId: string;
    targetTitle: string;
  };
  items: FetcherItem[];
  cancelRequested: boolean;
  stats: { total: number; delivered: number; failed: number; skipped: number; downloaded: number };
}

export interface SafeConfig {
  apiId?: number | string;
  apiHash?: string;
  botToken?: string;
  hasSession: boolean;
  isEngineRunning: boolean;
  accounts?: SafeTelegramAccount[];
  rules: ForwardingRule[];
  globalRateLimit?: RateLimitConfig;
  defaultRemoveSignature: boolean;
  retryOnFloodWait: boolean;
  maxRetryCount: number;
}
