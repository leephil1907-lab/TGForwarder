import { StorageManager } from './server/storage.js';
import { TelegramEngine } from './server/telegramEngine.js';
import { TelegramClient } from 'telegram';

const engineProto = TelegramEngine.prototype as any;
const storageProto = StorageManager.prototype as any;

const originalGetConfig = storageProto.getConfig;
if (!storageProto.__tgforwarderStrictSourceRouting) {
  storageProto.getConfig = function () {
    const config = originalGetConfig.call(this);
    return {
      ...config,
      rules: Array.isArray(config.rules)
        ? config.rules.map((rule: any) => ({ ...rule, sourceUsername: undefined }))
        : []
    };
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
    try {
      return await this.__tgforwarderOriginalResolveEntity(idOrUsername);
    } catch (error) {
      if (!this.client) throw error;
      const raw = String(idOrUsername).trim();
      const normalized = raw.replace(/^-100/, '').replace(/^-/, '');
      const dialogs = (this.client as any).iterDialogs ? (this.client as any).iterDialogs({}) : null;
      if (dialogs) {
        for await (const dialog of dialogs) {
          if (!dialog?.entity) continue;
          const id = dialog.id?.toString?.() || dialog.entity.id?.toString?.() || '';
          this.cacheEntity?.(dialog.entity, id);
          const candidates = [id, id.replace(/^-100/, ''), `-100${id.replace(/^-100/, '')}`];
          if (candidates.includes(raw) || candidates.includes(normalized) || candidates.includes(`-100${normalized}`)) return dialog.entity;
        }
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
      if (active) {
        logItem = { ...logItem, sourceId: active.sourceId, sourceTitle: active.sourceTitle || active.sourceId, targetId: active.targetIds[0], targetTitle: active.targetTitles?.[0] || active.targetIds[0], message: `${logItem.message} Source ${active.sourceId} → Target ${active.targetIds[0]}.` };
      }
    }
    return originalLog.call(this, logItem);
  };
  engineProto.__tgforwarderEnrichedEngineLog = true;
}

if (!engineProto.__tgforwarderManualReview) {
  const pending = new Map<string, any>();
  const originalDispatch = engineProto.dispatchItem;
  engineProto.__tgforwarderOriginalDispatch = originalDispatch;

  engineProto.dispatchItem = async function (item: any, rateLimit: any) {
    if (item?.__tgforwarderPublishNow) return originalDispatch.call(this, item, rateLimit);
    const message = item?.event?.message;
    const chatId = message?.chatId?.toString?.() || item?.rule?.sourceId || '';
    const key = `${chatId}:${message?.id}:${item?.targetId}`;
    pending.set(key, {
      key,
      sourceId: chatId,
      sourceTitle: item.rule?.sourceTitle || chatId,
      targetId: item.targetId,
      targetTitle: item.targetTitle || item.targetId,
      messageId: Number(message?.id),
      text: item.processedText || message?.message || message?.text || '',
      hasMedia: Boolean(message?.media),
      mediaType: message?.media?.className || null,
      createdAt: Date.now(),
      item
    });
    this.log({ level: 'info', category: 'forward', title: 'Incoming Post Awaiting Approval', message: `Post #${message?.id} is waiting for publish approval.`, sourceId: chatId, sourceTitle: item.rule?.sourceTitle || chatId, targetId: item.targetId, targetTitle: item.targetTitle || item.targetId, messageSnippet: (item.processedText || '').slice(0, 80) });
  };

  engineProto.getPendingPosts = function () { return Array.from(pending.values()).map(({ item, ...post }) => post); };
  engineProto.publishPendingPost = async function (key: string, text?: string) {
    const post = pending.get(key);
    if (!post) throw new Error('Pending post not found or it has already been published.');
    const item = post.item;
    if (typeof text === 'string') item.processedText = text;
    item.__tgforwarderPublishNow = true;
    try {
      await originalDispatch.call(this, item, this.storage?.getConfig?.()?.globalRateLimit);
      pending.delete(key);
      return { success: true, key };
    } catch (error) {
      item.__tgforwarderPublishNow = false;
      throw error;
    }
  };
  engineProto.discardPendingPost = function (key: string) { return { success: pending.delete(key) }; };
  const originalDisconnect = engineProto.disconnect;
  engineProto.disconnect = async function () { pending.clear(); return originalDisconnect.call(this); };
  engineProto.__tgforwarderManualReview = true;
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

await import('./server.ts');
