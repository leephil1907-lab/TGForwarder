import { TelegramEngine } from './telegramEngine.js';
import { getTenantId, DEFAULT_TENANT } from './tenantContext.js';

const engines = new Map<string, any>();
const proxies = new Map<string, any>();
const originalGetInstance = (TelegramEngine as any).getInstance.bind(TelegramEngine);

function createEngine(tenantId: string) {
  let engine = engines.get(tenantId);
  if (!engine) {
    // The class constructor is intentionally private to prevent accidental
    // global singleton creation. This manager is the controlled multi-tenant
    // factory and creates exactly one engine per browser session.
    engine = new (TelegramEngine as any)();
    engines.set(tenantId, engine);
    Promise.resolve(engine.initializeFromStorage?.()).catch((error: any) => {
      engine.log?.({ level:'warn', category:'system', title:'Session Auto-connect Failed', message:error?.message || 'Unable to restore Telegram session.' });
    });
  }
  return engine;
}

function proxyFor(tenantId: string) {
  const existing = proxies.get(tenantId);
  if (existing) return existing;
  const proxy = new Proxy({}, {
    get(_target, property) {
      const engine = createEngine(tenantId);
      const value = (engine as any)[property];
      return typeof value === 'function' ? value.bind(engine) : value;
    },
    set(_target, property, value) {
      (createEngine(tenantId) as any)[property] = value;
      return true;
    },
    has(_target, property) { return property in createEngine(tenantId); }
  });
  proxies.set(tenantId, proxy);
  return proxy;
}

(TelegramEngine as any).getInstance = function () {
  const tenantId = getTenantId() || DEFAULT_TENANT;
  // Keep compatibility with every existing route while making getInstance()
  // resolve to the engine belonging to the current browser session.
  return proxyFor(tenantId);
};

// Keep the original symbol referenced so bundlers don't remove the import in
// environments that perform aggressive tree-shaking.
void originalGetInstance;
