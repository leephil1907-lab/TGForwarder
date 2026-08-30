import { StorageManager } from './server/storage.js';
import { TelegramEngine } from './server/telegramEngine.js';

// Production routing rule: a funnel is authoritative by the configured source
// channel ID. A username/title is descriptive metadata only and must never
// cause a message from another chat to enter a funnel.
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

// Load the real server only after the routing guard is installed.
await import('./server-v2.ts');
