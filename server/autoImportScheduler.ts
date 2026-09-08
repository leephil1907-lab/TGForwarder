/**
 * Auto-Import Scheduler
 * ---------------------
 * Watches source channels on a schedule, detects NEW posts (via a per-watch
 * message-ID watermark) and stages them into the review/publish queue
 * (Pending Posts) where they can be edited and published to any target.
 *
 * - Watches persist to disk and survive restarts.
 * - A master tick runs every 30s; each watch fires at its own interval.
 * - Flood waits and errors back off naturally (the watch simply retries on
 *   its next interval) and are surfaced in the UI + Live Console.
 */
import fs from 'fs';
import path from 'path';
import { TelegramEngine } from './telegramEngine.js';
import { mirrorCapturedMessage } from './botMirror.js';

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

export interface AutoImportWatchInput {
  sourceId: string;
  sourceTitle?: string;
  targetId: string;
  targetTitle?: string;
  intervalMinutes: number;
  importLatestOnStart?: boolean;
}

const MASTER_TICK_MS = 30_000;
const MAX_PER_RUN = 30;
const MAX_WATCHES = 50;

export class AutoImportScheduler {
  private static instance: AutoImportScheduler;
  private engine: TelegramEngine;
  private file: string;
  private watches = new Map<string, AutoImportWatch>();
  private chain: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private constructor() {
    this.engine = TelegramEngine.getInstance();
    const base = process.env.TG_DATA_DIR || path.join(process.cwd(), '.data');
    const dir = path.join(base, 'tenants', 'default');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err: any) {
      console.error(`[AutoImport] Data directory is not usable (${dir}): ${err?.message || err}. Attach a writable volume at TG_DATA_DIR (e.g. /data).`);
    }
    this.file = path.join(dir, 'autoimport-watches.json');
    this.load();
    this.timer = setInterval(() => { void this.tick(); }, MASTER_TICK_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  public static getInstance(): AutoImportScheduler {
    if (!AutoImportScheduler.instance) AutoImportScheduler.instance = new AutoImportScheduler();
    return AutoImportScheduler.instance;
  }

  // ==================== PERSISTENCE ====================

  private load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const list = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(list)) for (const w of list) if (w?.id && w.sourceId && w.targetId) this.watches.set(w.id, w);
    } catch (err: any) {
      console.warn('[AutoImport] Could not restore watches:', err?.message || err);
    }
  }

  private persist() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Array.from(this.watches.values()), null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err: any) {
      console.error('[AutoImport] Could not persist watches:', err?.message || err);
    }
  }

  private emit() {
    try { this.engine.broadcastEvent('AUTOIMPORT_UPDATE', { watches: this.list() }); } catch { /* no clients */ }
  }

  // ==================== PUBLIC API ====================

  public list(): AutoImportWatch[] {
    return Array.from(this.watches.values()).sort((a, b) => b.createdAt - a.createdAt).map((w) => ({ ...w }));
  }

  public summary(): { total: number; active: number } {
    const all = Array.from(this.watches.values());
    return { total: all.length, active: all.filter((w) => w.enabled).length };
  }

  public createWatch(input: AutoImportWatchInput): AutoImportWatch {
    const sourceId = String(input.sourceId || '').trim();
    const targetId = String(input.targetId || '').trim();
    if (!sourceId || !targetId) throw new Error('Source and target are required.');
    if (Array.from(this.watches.values()).some((w) => w.sourceId === sourceId && w.targetId === targetId)) {
      throw new Error('A watcher for this source → target pair already exists.');
    }
    const intervalMinutes = Math.min(Math.max(Math.round(Number(input.intervalMinutes) || 15), 1), 1440);
    if (this.watches.size >= MAX_WATCHES) throw new Error(`Too many watchers (max ${MAX_WATCHES}).`);
    const watch: AutoImportWatch = {
      id: `watch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sourceId,
      sourceTitle: String(input.sourceTitle || sourceId),
      targetId,
      targetTitle: String(input.targetTitle || (targetId === 'me' ? 'Saved Messages' : targetId)),
      intervalMinutes,
      enabled: true,
      lastMessageId: null,
      baselineSet: false,
      importLatestOnStart: Boolean(input.importLatestOnStart),
      createdAt: Date.now(),
      lastRunAt: null,
      lastImportedCount: 0,
      totalImported: 0
    };
    this.watches.set(watch.id, watch);
    this.persist();
    this.engine.log({
      level: 'success', category: 'fetcher', title: '⏱️ Auto-Import Watcher Created',
      message: `Watching ${watch.sourceTitle} every ${intervalMinutes} min → new posts land in Pending Posts for ${watch.targetTitle}.`,
      sourceId, sourceTitle: watch.sourceTitle, targetId, targetTitle: watch.targetTitle,
      details: { watchId: watch.id }
    });
    this.emit();
    void this.tick();
    return { ...watch };
  }

  public updateWatch(id: string, patch: Partial<Pick<AutoImportWatch, 'enabled' | 'intervalMinutes' | 'targetId' | 'targetTitle'>>): AutoImportWatch {
    const watch = this.watches.get(id);
    if (!watch) throw new Error('Watcher not found.');
    if (patch.enabled !== undefined) watch.enabled = Boolean(patch.enabled);
    if (patch.intervalMinutes !== undefined) watch.intervalMinutes = Math.min(Math.max(Math.round(Number(patch.intervalMinutes) || watch.intervalMinutes), 1), 1440);
    if (patch.targetId !== undefined && String(patch.targetId).trim()) { watch.targetId = String(patch.targetId).trim(); watch.targetTitle = String(patch.targetTitle || watch.targetId); }
    this.persist();
    this.emit();
    return { ...watch };
  }

  public deleteWatch(id: string): { success: boolean } {
    const removed = this.watches.delete(id);
    if (removed) {
      this.persist();
      this.emit();
      this.engine.log({ level: 'info', category: 'fetcher', title: '🗑️ Auto-Import Watcher Removed', message: `Watcher ${id} deleted.`, details: { watchId: id } });
    }
    return { success: removed };
  }

  /** Forces a watch to run immediately (outside its schedule). */
  public async runNow(id: string): Promise<{ success: boolean; imported: number; message: string }> {
    const watch = this.watches.get(id);
    if (!watch) throw new Error('Watcher not found.');
    if (!this.engine.isAccountConnected()) throw new Error('Telegram account is not connected.');
    await this.runWatch(watch, Date.now());
    return { success: !watch.lastError, imported: watch.lastImportedCount, message: watch.lastError || `Imported ${watch.lastImportedCount} new post(s) into Pending Posts.` };
  }

  // ==================== SCHEDULER ====================

  private async tick(): Promise<void> {
    if (this.running) return;
    if (!this.engine.isAccountConnected()) return;
    const now = Date.now();
    const due = Array.from(this.watches.values()).filter((w) => w.enabled && (!w.lastRunAt || now - w.lastRunAt >= w.intervalMinutes * 60_000));
    if (!due.length) return;
    this.running = true;
    try {
      for (const watch of due) {
        this.chain = this.chain.then(() => this.runWatch(watch, Date.now())).catch(() => { /* errors are recorded per watch */ });
      }
      await this.chain;
    } finally {
      this.running = false;
    }
  }

  private async runWatch(watch: AutoImportWatch, startedAt: number): Promise<void> {
    const client = this.engine.getClient();
    if (!client || !this.engine.isAccountConnected()) return;
    try {
      const entity = await this.engine.resolveEntity(watch.sourceId);
      if (entity?.title && entity.title !== watch.sourceTitle) { watch.sourceTitle = String(entity.title); }

      let messages: any[] = [];
      if (!watch.baselineSet) {
        // First run: establish the watermark. Optionally import the latest posts.
        const initial: any[] = await client.getMessages(entity, { limit: watch.importLatestOnStart ? 5 : 1 });
        const valid = (Array.isArray(initial) ? initial : []).filter((m) => m && m.id && !m.action);
        if (valid.length) {
          watch.lastMessageId = Math.max(...valid.map((m) => Number(m.id)));
          messages = watch.importLatestOnStart ? valid : [];
        } else {
          watch.lastError = 'Source returned no messages yet.';
          watch.lastRunAt = startedAt;
          this.persist();
          return;
        }
        watch.baselineSet = true;
      } else {
        const fetched: any[] = await client.getMessages(entity, { limit: MAX_PER_RUN, minId: watch.lastMessageId || 0 });
        messages = (Array.isArray(fetched) ? fetched : []).filter((m) => m && m.id && Number(m.id) > Number(watch.lastMessageId || 0) && !m.action);
      }

      // Oldest first so the review queue reads top-down chronologically.
      messages.sort((a, b) => Number(a.id) - Number(b.id));
      if (messages.length > MAX_PER_RUN) messages = messages.slice(-MAX_PER_RUN);

      // Telegram Archive Bot: mirror each imported post into the operator's bot chat.
      if (messages.length) {
        const entityTitle = String(entity?.title || watch.sourceTitle || watch.sourceId);
        for (const m of messages) mirrorCapturedMessage(this.engine, m, { sourceId: watch.sourceId, sourceTitle: entityTitle, ruleName: 'auto-import' });
      }

      let imported = 0;
      const config = (this.engine as any).storage.getConfig();
      const rateLimit = config?.globalRateLimit;
      for (const message of messages) {
        try {
          await (this.engine as any).dispatchItem.call(this.engine, {
            event: { message, chat: entity },
            rule: {
              sourceId: watch.sourceId,
              sourceTitle: watch.sourceTitle,
              targetIds: [watch.targetId],
              targetTitles: [watch.targetTitle],
              removeForwardSignature: true,
              preserveFormatting: true
            },
            targetId: watch.targetId,
            targetTitle: watch.targetTitle,
            processedText: String(message.message || message.text || ''),
            scheduledTime: Date.now(),
            retries: 0
          }, rateLimit);
          imported++;
          watch.lastMessageId = Math.max(Number(watch.lastMessageId || 0), Number(message.id));
        } catch (err: any) {
          // Individual post failed — record and continue with the rest.
          watch.lastError = String(err?.message || err).slice(0, 200);
          this.engine.log({
            level: 'warn', category: 'fetcher', title: '⚠️ Auto-Import Item Failed',
            message: `${watch.sourceTitle} #${message.id}: ${watch.lastError}`,
            sourceId: watch.sourceId, sourceTitle: watch.sourceTitle, details: { watchId: watch.id }
          });
        }
      }

      watch.lastRunAt = startedAt;
      watch.lastRunMs = Date.now() - startedAt;
      watch.lastImportedCount = imported;
      watch.totalImported += imported;
      if (!watch.lastError || imported > 0) watch.lastError = undefined;
      this.persist();
      this.emit();
      if (imported > 0 || messages.length > 0) {
        this.engine.log({
          level: imported > 0 ? 'success' : 'info', category: 'fetcher', title: imported > 0 ? '📥 Auto-Import Delivered to Review Queue' : '⏱️ Auto-Import Check Complete',
          message: imported > 0
            ? `${imported} new post(s) from ${watch.sourceTitle} staged in Pending Posts → ${watch.targetTitle}. Watermark now #${watch.lastMessageId}.`
            : `No new posts in ${watch.sourceTitle} since #${watch.lastMessageId}.`,
          sourceId: watch.sourceId, sourceTitle: watch.sourceTitle, targetId: watch.targetId, targetTitle: watch.targetTitle,
          details: { watchId: watch.id, imported }
        });
      }
    } catch (err: any) {
      watch.lastRunAt = startedAt;
      watch.lastError = String(err?.message || err).slice(0, 200);
      this.persist();
      this.emit();
      this.engine.log({
        level: 'error', category: 'fetcher', title: '❌ Auto-Import Run Failed',
        message: `${watch.sourceTitle}: ${watch.lastError}`,
        sourceId: watch.sourceId, sourceTitle: watch.sourceTitle, details: { watchId: watch.id }
      });
    }
  }
}

export const autoImportScheduler = AutoImportScheduler.getInstance();
