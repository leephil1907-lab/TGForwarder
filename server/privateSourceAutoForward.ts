import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import crypto from 'crypto';
import { TelegramEngine } from './telegramEngine.js';
import { normalizeChatId } from './storage.js';

export async function installPrivateSourceAutoForward(): Promise<void> {
  const engine = TelegramEngine.getInstance() as any;
  await engine.waitForInitialization();
  const client = engine.client;
  if (!client || engine.authState?.status !== 'connected') return;

  let running = Boolean(engine.storage.getConfig().isEngineRunning);
  let chain = Promise.resolve();

  const matchesSource = (event: NewMessageEvent, rule: any): boolean => {
    const message = event.message;
    const messageChatId = message?.chatId ? message.chatId.toString() : '';
    if (!messageChatId || !rule.sourceId) return false;
    const a = normalizeChatId(rule.sourceId.toString());
    const b = normalizeChatId(messageChatId);
    if (a && b && a === b) return true;
    const username = (event.chat as any)?.username;
    return Boolean(rule.sourceUsername && username && `@${String(username).toLowerCase()}` === String(rule.sourceUsername).toLowerCase());
  };

  const handler = async (event: NewMessageEvent) => {
    try {
      if (!running || !engine.client) return;
      const message = event.message;
      if (!message?.id || !message.chatId) return;
      const config = engine.storage.getConfig();
      const rules = config.rules.filter((r: any) => r.enabled && r.sourceId && Array.isArray(r.targetIds) && r.targetIds.length && matchesSource(event, r));
      if (!rules.length) return;

      for (const rule of rules) {
        const sourceId = message.chatId.toString();
        const rawText = message.message || message.text || '';
        const mediaFingerprint = message.media ? (message.media.className || 'media') : 'text';
        const contentHash = crypto.createHash('md5').update(`${sourceId}:${message.id}:${rawText}:${mediaFingerprint}`).digest('hex');
        let processedText = rawText;
        if (rule.dropLinks) processedText = processedText.replace(/https?:\/\/[^\s]+/g, '').replace(/t\.me\/[^\s]+/g, '').trim();
        if (rule.prependText?.trim()) processedText = `${rule.prependText.trim()}\n\n${processedText}`;
        if (rule.appendText?.trim()) processedText = `${processedText}\n\n${rule.appendText.trim()}`;
        const sourceTitle = (event.chat as any)?.title || (event.chat as any)?.firstName || sourceId;
        const snippet = processedText.length > 100 ? `${processedText.slice(0, 100)}...` : processedText || '[Media/Attachment]';

        engine.stats.totalReceived++;
        engine.stats.lastActiveTime = Date.now();
        engine.log({ level: 'info', category: 'forward', title: '🛰️ SOURCE CAPTURED', message: `New message #${message.id} captured from private source "${sourceTitle}"`, sourceId, sourceTitle, messageSnippet: snippet });

        for (let i = 0; i < rule.targetIds.length; i++) {
          const targetId = rule.targetIds[i];
          const targetTitle = rule.targetTitles?.[i] || targetId;
          if (rule.duplicateProtection && engine.storage.isDuplicate(sourceId, message.id, targetId, contentHash)) {
            engine.stats.duplicatesBlocked++;
            engine.log({ level: 'warn', category: 'duplicate', title: '🛡️ DUPLICATE BLOCKED', message: `Message #${message.id} is already mapped to "${targetTitle}"`, sourceId, sourceTitle, targetId, targetTitle });
            continue;
          }

          chain = chain.then(async () => {
            try {
              const targetEntity = await engine.resolveEntity(targetId);
              let sent: any;

              // Always create a NEW destination message. This intentionally does
              // not call Telegram's native forwardMessages operation.
              if (message.media) {
                sent = await client.sendMessage(targetEntity, {
                  message: processedText,
                  file: message.media,
                  formattingEntities: rule.preserveFormatting ? message.entities : undefined
                });
              } else {
                sent = await client.sendMessage(targetEntity, {
                  message: processedText,
                  formattingEntities: rule.preserveFormatting ? message.entities : undefined
                });
              }

              const targetMsgId = Array.isArray(sent) ? sent[0]?.id : sent?.id;
              if (!targetMsgId) throw new Error('Telegram did not return a destination message ID.');
              engine.storage.recordMapping(sourceId, message.id, targetId, targetMsgId, contentHash);
              engine.stats.totalForwarded++;
              engine.log({ level: 'success', category: 'forward', title: '✅ PUBLISHED', message: `New message #${message.id} created in "${targetTitle}" as #${targetMsgId}`, sourceId, sourceTitle, targetId, targetTitle, messageSnippet: snippet });
              engine.broadcast('STATS_UPDATED', engine.stats);
            } catch (err: any) {
              engine.stats.totalFailed++;
              const errorMessage = err?.message || String(err) || 'Telegram send failed';
              engine.log({ level: 'error', category: 'forward', title: '❌ PUBLISH FAILED', message: `Message #${message.id} → "${targetTitle}": ${errorMessage}`, sourceId, sourceTitle, targetId, targetTitle, messageSnippet: snippet });
              engine.broadcast('STATS_UPDATED', engine.stats);
            }
          });
        }
      }
    } catch (err: any) {
      engine.log({ level: 'error', category: 'forward', title: '❌ SOURCE LISTENER ERROR', message: err?.message || String(err) });
    }
  };

  engine.activeEventHandler = handler;
  client.addEventHandler(handler, new NewMessage({ incoming: true }));

  const originalStart = engine.startEngine.bind(engine);
  const originalStop = engine.stopEngine.bind(engine);
  engine.startEngine = async () => { const result = await originalStart(); running = true; return result; };
  engine.stopEngine = async () => { running = false; await originalStop(); };

  engine.log({ level: 'success', category: 'system', title: 'Private Source Listener Active', message: running ? 'Listening continuously for configured private-source messages.' : 'Listener installed; start the forwarding engine to begin automatic delivery.' });
}
