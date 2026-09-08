import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import { engineeringReUpload } from './engineeringForward.js';
import { notifyDeliveryFailure } from './alerts.js';
import { mirrorCapturedMessage } from './botMirror.js';
import crypto from 'crypto';
import { TelegramEngine } from './telegramEngine.js';
import { normalizeChatId } from './storage.js';

export async function installPrivateSourceAutoForward(): Promise<void> {
  const engine = TelegramEngine.getInstance() as any;
  await engine.waitForInitialization();
  attachPrivateSourceListener(engine);
}

/**
 * Attaches the private-source listener to ONE engine instance. Idempotent.
 * Multi-user safe: each tenant engine gets its own listener when it starts.
 */
export function attachPrivateSourceListener(engine: any): void {
  const client = engine.client;
  if (!client || engine.authState?.status !== 'connected') return;
  if (engine.__privateSourceListenerAttached) return;
  engine.__privateSourceListenerAttached = true;

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
      if (!engine.client || !engine.storage.getConfig().isEngineRunning) return;
      const message = event.message;
      if (!message?.id || !message.chatId) return;
      const config = engine.storage.getConfig();
      const rules = config.rules.filter((r: any) => r.enabled && r.sourceId && Array.isArray(r.targetIds) && r.targetIds.length && matchesSource(event, r));
      if (!rules.length) return;
      // This listener owns this message — the generic pipeline must skip it.
      (message as any).__tgforwarderClaimed = true;

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
        mirrorCapturedMessage(engine, message, { sourceId, sourceTitle, ruleName: rule.name });

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
              // MANUAL (review-first) mode: stage into Pending Posts instead of
              // sending. The user edits/approves there before delivery.
              if (!rule.autoPublish) {
                await engine.dispatchItem.call(engine, {
                  event, rule, targetId, targetTitle,
                  processedText, scheduledTime: Date.now(), retries: 0
                }, config?.globalRateLimit);
                return;
              }
              const targetEntity = await engine.resolveEntity(targetId);
              let sent: any;

              // Always create a NEW destination message. This intentionally does
              // not call Telegram's native forwardMessages operation.
              try {
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
              } catch (directErr: any) {
                // ENGINEERING FALLBACK: protected/restricted media — download via
                // this session and re-upload as a fresh file.
                if (!message.media) throw directErr;
                const { sent: reUploaded } = await engineeringReUpload(engine, message, targetEntity, {
                  caption: processedText,
                  log: (item: any) => engine.log({ ...item, sourceId, sourceTitle, targetId, targetTitle, messageSnippet: snippet }),
                });
                sent = reUploaded;
                engine.log({ level: 'info', category: 'forward', title: '🛠️ ENGINEERING RE-UPLOAD: Delivered', message: `Message #${message.id} delivered to "${targetTitle}" via session download + fresh re-upload.`, sourceId, sourceTitle, targetId, targetTitle, messageSnippet: snippet });
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
              notifyDeliveryFailure({ sourceId, targetId, ruleName: rule.name, error: errorMessage, context: 'private-source' });
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

  engine.log({ level: 'success', category: 'system', title: 'Private Source Listener Active', message: 'Listening for configured private-source messages while the engine is running.' });
}
