import { TelegramEngine } from './telegramEngine.js';
import { getTenantId, DEFAULT_TENANT } from './tenantContext.js';

const engines = new Map<string, any>();
const originalGetInstance = (TelegramEngine as any).getInstance.bind(TelegramEngine);

function createEngine(tenantId: string) {
  let engine = engines.get(tenantId);
  if (!engine) {
    engine = new (TelegramEngine as any)();
    engines.set(tenantId, engine);
    Promise.resolve(engine.initializeFromStorage?.()).catch((error: any) => {
      engine.log?.({level:'warn',category:'system',title:'Session Auto-connect Failed',message:error?.message||'Unable to restore Telegram session.'});
    });
  }
  return engine;
}

const dynamicProxy = new Proxy({}, {
  get(_target, property) {
    const engine = createEngine(getTenantId() || DEFAULT_TENANT);
    const value = (engine as any)[property];
    return typeof value === 'function' ? value.bind(engine) : value;
  },
  set(_target, property, value) {
    (createEngine(getTenantId() || DEFAULT_TENANT) as any)[property] = value;
    return true;
  },
  has(_target, property) { return property in createEngine(getTenantId() || DEFAULT_TENANT); }
});

(TelegramEngine as any).getInstance = function () { return dynamicProxy; };
void originalGetInstance;
