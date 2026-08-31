import fs from 'fs';
import path from 'path';
import { StorageManager } from './server/storage.js';
import { TelegramEngine } from './server/telegramEngine.js';
import { TelegramClient } from 'telegram';

const engineProto = TelegramEngine.prototype as any;
const storageProto = StorageManager.prototype as any;

const originalGetConfig = storageProto.getConfig;
if (!storageProto.__tgforwarderStrictSourceRouting) {
  storageProto.getConfig = function () {
    const config = originalGetConfig.call(this);
    return { ...config, rules: Array.isArray(config.rules) ? config.rules.map((rule: any) => ({ ...rule, sourceUsername: undefined })) : [] };
  };
  storageProto.__tgforwarderStrictSourceRouting = true;
}

export const normalizeTelegramTimestamp = (value: any): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value < 100000000000 ? Math.round(value * 1000) : Math.round(value);
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 100000000000 ? Math.round(numeric * 1000) : Math.round(numeric);
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

if (!engineProto.__tgforwarderAllDialogs) {
  engineProto.__tgforwarderOriginalDiscoverChats = engineProto.discoverChats;
  engineProto.discoverChats = async function () {
    if (!this.client || this.authState?.status !== 'connected') throw new Error('Telegram client is not connected. Please login first.');
    const discovered: any[] = [];
    const seen = new Set<string>();
    const dialogs = (this.client as any).iterDialogs ? (this.client as any).iterDialogs({}) : null;
    if (!dialogs) return this.__tgforwarderOriginalDiscoverChats();
    this.log({ level: 'info', category: 'discovery', title: 'Discovering Telegram Dialogs', message: 'Loading available channels, groups, bots, users and chats from Telegram.' });
    for await (const dialog of dialogs) {
      if (!dialog?.entity) continue;
      const entity = dialog.entity as any;
      const idStr = dialog.id ? dialog.id.toString() : entity.id?.toString?.() || '';
      if (!idStr || seen.has(idStr)) continue;
      seen.add(idStr);
      this.cacheEntity?.(entity, idStr);
      const title = dialog.title || entity.title || entity.firstName || 'Unnamed Chat';
      const username = entity.username ? `@${entity.username}` : undefined;
      let type = 'user';
      if (dialog.isChannel) type = entity.megagroup ? 'supergroup' : 'channel';
      else if (dialog.isGroup) type = 'group';
      else if (entity.bot) type = 'bot';
      const isPrivate = !entity.username;
      const canSendMessages = Boolean(entity.creator || (entity.adminRights && entity.adminRights.postMessages) || (!dialog.isChannel && !entity.defaultBannedRights?.sendMessages) || type === 'user' || type === 'group');
      discovered.push({ id: idStr, title, username, type, isPrivate, unreadCount: dialog.unreadCount, participantsCount: entity.participantsCount, canSendMessages });
    }
    this.log({ level: 'success', category: 'discovery', title: 'Chat Discovery Complete', message: `Found ${discovered.length} Telegram entities.` });
    return discovered;
  };

  engineProto.__tgforwarderOriginalResolveEntity = engineProto.resolveEntity;
  engineProto.resolveEntity = async function (idOrUsername: string | number) {
    try { return await this.__tgforwarderOriginalResolveEntity(idOrUsername); }
    catch (error) {
      if (!this.client) throw error;
      const raw = String(idOrUsername).trim();
      const normalized = raw.replace(/^-100/, '').replace(/^-/, '');
      const dialogs = (this.client as any).iterDialogs ? (this.client as any).iterDialogs({}) : null;
      if (dialogs) for await (const dialog of dialogs) {
        if (!dialog?.entity) continue;
        const id = dialog.id?.toString?.() || dialog.entity.id?.toString?.() || '';
        this.cacheEntity?.(dialog.entity, id);
        const candidates = [id, id.replace(/^-100/, ''), `-100${id.replace(/^-100/, '')}`];
        if (candidates.includes(raw) || candidates.includes(normalized) || candidates.includes(`-100${normalized}`)) return dialog.entity;
      }
      throw error;
    }
  };
  engineProto.__tgforwarderAllDialogs = true;
}

if (!engineProto.__tgforwarderEnrichedEngineLog) {
  const originalLog = engineProto.log;
  engineProto.log = function (logItem: any) {
    if (logItem?.sourceId && !logItem.sourceTitle) logItem = { ...logItem, sourceTitle: String(logItem.sourceId) };
    if (logItem?.targetId && !logItem.targetTitle) logItem = { ...logItem, targetTitle: String(logItem.targetId) };
    if (logItem?.title === 'Forwarding Engine Active' && !logItem.sourceId) {
      const rules = this.storage?.getConfig?.()?.rules || [];
      const active = rules.find((r: any) => r.enabled && r.sourceId && Array.isArray(r.targetIds) && r.targetIds.length);
      if (active) logItem = { ...logItem, sourceId: active.sourceId, sourceTitle: active.sourceTitle || active.sourceId, targetId: active.targetIds[0], targetTitle: active.targetTitles?.[0] || active.targetIds[0], message: `${logItem.message} Source ${active.sourceId} → Target ${active.targetIds[0]}.` };
    }
    return originalLog.call(this, logItem);
  };
  engineProto.__tgforwarderEnrichedEngineLog = true;
}

/**
 * Production publish pipeline:
 * source message -> durable pending record -> user edit/approval -> Telegram publish.
 * Pending records contain only Telegram identifiers and text, never a serialized
 * Telegram client/message object, so they survive Railway restarts and redeploys.
 */
if (!engineProto.__tgforwarderManualReviewV2) {
  type PendingRecord = {
    key: string;
    sourceId: string;
    sourceTitle: string;
    targetId: string;
    targetTitle: string;
    messageId: number;
    text: string;
    hasMedia: boolean;
    mediaType: string | null;
    createdAt: number;
  };

  const dataDir = process.env.TG_DATA_DIR || path.join(process.cwd(), '.data');
  const pendingFile = path.join(dataDir, 'pending-posts.json');
  const pending = new Map<string, PendingRecord>();

  const loadPending = () => {
    try {
      if (!fs.existsSync(pendingFile)) return;
      const records = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
      if (!Array.isArray(records)) return;
      for (const record of records) {
        if (record?.key && record.sourceId && record.targetId && Number(record.messageId)) pending.set(record.key, record);
      }
    } catch (error) {
      console.warn('[TGForwarder] Could not restore pending posts:', (error as any)?.message || error);
    }
  };

  const savePending = () => {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const tmp = `${pendingFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Array.from(pending.values()).slice(-1000), null, 2), 'utf8');
      fs.renameSync(tmp, pendingFile);
    } catch (error) {
      throw new Error(`Unable to persist pending post state: ${(error as any)?.message || error}`);
    }
  };

  loadPending();

  const originalDispatch = engineProto.dispatchItem;
  engineProto.__tgforwarderOriginalDispatchV2 = originalDispatch;

  engineProto.dispatchItem = async function (item: any, rateLimit: any) {
    const message = item?.event?.message;
    const chatId = message?.chatId?.toString?.() || item?.rule?.sourceId || '';
    const targetId = String(item?.targetId || '').trim();
    if (!message || !chatId || !targetId) throw new Error('Invalid forwarding payload: source message or destination is missing.');

    const key = `${chatId}:${Number(message.id)}:${targetId}`;
    const pendingRecord: PendingRecord = {
      key,
      sourceId: chatId,
      sourceTitle: item.rule?.sourceTitle || chatId,
      targetId,
      targetTitle: item.targetTitle || targetId,
      messageId: Number(message.id),
      text: item.processedText ?? message.message ?? message.text ?? '',
      hasMedia: Boolean(message.media),
      mediaType: message.media?.className || null,
      createdAt: Date.now()
    };

    pending.set(key, pendingRecord);
    savePending();

    this.log({
      level: 'info',
      category: 'forward',
      title: 'Post Staged for Review',
      message: `Source post #${message.id} copied to the publish queue for ${pendingRecord.targetTitle}.`,
      sourceId: chatId,
      sourceTitle: pendingRecord.sourceTitle,
      targetId,
      targetTitle: pendingRecord.targetTitle,
      messageSnippet: pendingRecord.text.slice(0, 80) || '[Media]'
    });
  };

  engineProto.getPendingPosts = function () {
    return Array.from(pending.values()).sort((a, b) => b.createdAt - a.createdAt);
  };

  engineProto.publishPendingPost = async function (key: string, editedText?: string) {
    if (!this.client || this.authState?.status !== 'connected') throw new Error('Telegram account is not connected.');
    const record = pending.get(key);
    if (!record) throw new Error('Pending post not found or it has already been published.');

    // Re-resolve and re-read the real source message before every publish.
    // This verifies that the configured source is accessible and ensures the
    // media/caption being sent is the actual Telegram message, not UI data.
    const sourceEntity = await this.resolveEntity(record.sourceId);
    const sourceMessages = await this.client.getMessages(sourceEntity, { ids: [record.messageId] });
    const sourceMessage: any = Array.isArray(sourceMessages) ? sourceMessages[0] : sourceMessages;
    if (!sourceMessage) throw new Error(`Source message #${record.messageId} is no longer available in ${record.sourceTitle}.`);

    const targetEntity = await this.resolveEntity(record.targetId);
    if (!targetEntity) throw new Error(`Destination ${record.targetTitle} could not be resolved.`);

    const rule = (this.storage?.getConfig?.()?.rules || []).find((candidate: any) => candidate.sourceId && (
      candidate.sourceId === record.sourceId ||
      candidate.sourceId.replace(/^-100/, '') === record.sourceId.replace(/^-100/, '')
    ) && Array.isArray(candidate.targetIds) && candidate.targetIds.some((id: string) => id === record.targetId || id.replace(/^-100/, '') === record.targetId.replace(/^-100/, '')));

    const publishRule = rule || {
      removeForwardSignature: true,
      preserveFormatting: false,
      sourceId: record.sourceId,
      sourceTitle: record.sourceTitle,
      targetIds: [record.targetId],
      targetTitles: [record.targetTitle]
    };

    const finalText = typeof editedText === 'string' ? editedText : record.text;
    const syntheticEvent = { message: sourceMessage, chat: sourceEntity };
    const item = {
      event: syntheticEvent,
      rule: publishRule,
      targetId: record.targetId,
      targetTitle: record.targetTitle,
      processedText: finalText,
      scheduledTime: Date.now(),
      retries: 0,
      __tgforwarderPublishNow: true
    };

    this.log({
      level: 'info',
      category: 'forward',
      title: 'Publishing Approved Post',
      message: `Publishing source #${record.messageId} from ${record.sourceTitle} to ${record.targetTitle}.`,
      sourceId: record.sourceId,
      sourceTitle: record.sourceTitle,
      targetId: record.targetId,
      targetTitle: record.targetTitle,
      messageSnippet: finalText.slice(0, 80) || '[Media]'
    });

    await originalDispatch.call(this, item, this.storage?.getConfig?.()?.globalRateLimit);

    // dispatchItem records a mapping only after Telegram accepts the message.
    // Do not remove the pending record if the send failed, so the user can retry.
    const mapping = this.storage?.getMapping?.(record.sourceId, record.messageId, record.targetId);
    if (!mapping) {
      throw new Error(`Telegram did not confirm delivery to ${record.targetTitle}. The post remains pending for retry.`);
    }

    pending.delete(key);
    savePending();
    return { success: true, key, sourceId: record.sourceId, sourceMessageId: record.messageId, targetId: record.targetId, targetMessageId: mapping.targetMsgId };
  };

  engineProto.discardPendingPost = function (key: string) {
    const removed = pending.delete(key);
    if (removed) savePending();
    return { success: removed };
  };

  engineProto.__tgforwarderManualReviewV2 = true;
}

if (!engineProto.__tgforwarderClientSendResolution) {
  const clientProto = TelegramClient.prototype as any;
  if (!clientProto.__tgforwarderClientSendResolution) {
    const originalSendMessage = clientProto.sendMessage;
    const originalSendFile = clientProto.sendFile;
    clientProto.sendMessage = async function (entityOrPeer: any, ...args: any[]) {
      let resolved = entityOrPeer;
      if (typeof entityOrPeer === 'string' || typeof entityOrPeer === 'number') {
        try { resolved = await this.getEntity(entityOrPeer); } catch (error: any) { throw new Error(`Unable to resolve Telegram destination ${String(entityOrPeer)}: ${error?.message || 'entity not accessible'}`); }
      }
      return originalSendMessage.call(this, resolved, ...args);
    };
    clientProto.sendFile = async function (entityOrPeer: any, ...args: any[]) {
      let resolved = entityOrPeer;
      if (typeof entityOrPeer === 'string' || typeof entityOrPeer === 'number') {
        try { resolved = await this.getEntity(entityOrPeer); } catch (error: any) { throw new Error(`Unable to resolve Telegram destination ${String(entityOrPeer)}: ${error?.message || 'entity not accessible'}`); }
      }
      return originalSendFile.call(this, resolved, ...args);
    };
    clientProto.__tgforwarderClientSendResolution = true;
  }
  engineProto.__tgforwarderClientSendResolution = true;
}

await import('./production-server.ts');
