import { TelegramEngine } from './telegramEngine.js';
import { StorageManager } from './storage.js';
import { getTenantId, DEFAULT_TENANT, runWithTenant } from './tenantContext.js';

const engines = new Map<string, any>();
const storages = new Map<string, any>();
const originalEngineGet = (TelegramEngine as any).getInstance.bind(TelegramEngine);
const originalStorageGet = (StorageManager as any).getInstance.bind(StorageManager);

function engineFor(id: string) {
  let engine = engines.get(id);
  if (!engine) {
    engine = runWithTenant(id, () => new (TelegramEngine as any)());
    engine.__tenantId = id;
    engines.set(id, engine);
    runWithTenant(id, () => Promise.resolve(engine.initializeFromStorage?.()).catch((error: any) => {
      engine.log?.({ level: 'warn', category: 'system', title: 'Session Auto-connect Failed', message: error?.message || 'Unable to restore Telegram session.' });
    }));
    // Every user's engine gets the private-source listener the first time its
    // forwarding engine starts (it needs a live client, which exists by then).
    const originalStart = engine.startEngine.bind(engine);
    engine.startEngine = async (...args: any[]) => {
      const result = await originalStart(...args);
      try {
        const { attachPrivateSourceListener } = await import('./privateSourceAutoForward.js');
        attachPrivateSourceListener(engine);
      } catch (error: any) {
        engine.log?.({ level: 'warn', category: 'system', title: 'Private Source Listener Skipped', message: error?.message || 'Unable to attach the private-source listener.' });
      }
      return result;
    };
  }
  return engine;
}

function storageFor(id: string) {
  let storage = storages.get(id);
  if (!storage) {
    storage = runWithTenant(id, () => originalStorageGet());
    storages.set(id, storage);
  }
  return storage;
}

const dynamicEngine = new Proxy({}, {
  get(_target, property) {
    const engine = engineFor(getTenantId() || DEFAULT_TENANT);
    const value = engine[property];
    return typeof value === 'function' ? value.bind(engine) : value;
  },
  set(_target, property, value) {
    engineFor(getTenantId() || DEFAULT_TENANT)[property] = value;
    return true;
  },
  has(_target, property) {
    return property in engineFor(getTenantId() || DEFAULT_TENANT);
  }
});

const dynamicStorage = new Proxy({}, {
  get(_target, property) {
    const storage = storageFor(getTenantId() || DEFAULT_TENANT);
    const value = storage[property];
    return typeof value === 'function' ? value.bind(storage) : value;
  },
  set(_target, property, value) {
    storageFor(getTenantId() || DEFAULT_TENANT)[property] = value;
    return true;
  },
  has(_target, property) {
    return property in storageFor(getTenantId() || DEFAULT_TENANT);
  }
});

(TelegramEngine as any).getInstance = function () {
  return dynamicEngine;
};

(StorageManager as any).getInstance = function () {
  return dynamicStorage;
};

void originalEngineGet;
