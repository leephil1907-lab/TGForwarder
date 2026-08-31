import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

const context = new AsyncLocalStorage<string>();

export const DEFAULT_TENANT = 'default';

export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return context.run(tenantId || DEFAULT_TENANT, fn);
}

export function getTenantId(): string {
  return context.getStore() || DEFAULT_TENANT;
}

export function createTenantId(): string {
  return crypto.randomBytes(24).toString('hex');
}
