/**
 * Restricted Fetcher — integrated worker (port of leephil1907-lab/save-restricted-bot)
 * ---------------------------------------------------------------------------
 * Parses Telegram message links (public, private t.me/c/... and thread links),
 * fetches the referenced messages through the website's already-connected
 * GramJS (MTProto) client, then:
 *   1. delivers the content to a Telegram destination (clean repost, no
 *      "forwarded from" signature — required because restricted sources block
 *      native forwards), and/or
 *   2. downloads the media server-side so it can be pulled from the dashboard.
 *
 * Jobs are queued in-process, persisted to disk and streamed to the UI via SSE.
 */
import fs from 'fs';
import path from 'path';
import { TelegramEngine } from './telegramEngine.js';

export type FetcherMediaType = 'text' | 'photo' | 'video' | 'audio' | 'voice' | 'document' | 'sticker' | 'animation' | 'unknown';

export interface ParsedLink {
  chatRef: string;
  messageId: number;
  isPrivate: boolean;
  threadId?: number;
  originalUrl: string;
}

export interface FetcherItem {
  id: string;
  link: string;
  chatRef: string;
  chatTitle: string;
  messageId: number;
  isPrivate: boolean;
  threadId?: number;
  status: 'queued' | 'processing' | 'delivered' | 'failed' | 'skipped';
  error?: string;
  mediaType: FetcherMediaType;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  snippet: string;
  albumSize: number;
  deliveredTo?: string;
  deliveredMsgId?: string;
  downloadFiles: string[];
  downloadReady: boolean;
  retries: number;
}

export interface FetcherJobOptions {
  sendToTelegram: boolean;
  saveForDownload: boolean;
  targetId: string;
  targetTitle: string;
}

export interface FetcherJob {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  options: FetcherJobOptions;
  items: FetcherItem[];
  cancelRequested: boolean;
  stats: { total: number; delivered: number; failed: number; skipped: number; downloaded: number };
}

export interface FetcherJobInput {
  links: string[];
  sendToTelegram: boolean;
  saveForDownload: boolean;
  targetId?: string;
  targetTitle?: string;
}

const MAX_LINKS_PER_JOB = 100;
const ALBUM_SCAN_RADIUS = 20;
const MAX_ALBUM_ITEMS = 10;
const MAX_JOBS_KEPT = 50;

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/x-matroska': '.mkv',
  'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/opus': '.opus', 'audio/mp4': '.m4a', 'audio/wav': '.wav',
  'application/pdf': '.pdf', 'application/zip': '.zip',
  'text/plain': '.txt', 'application/json': '.json'
};

/** Parses t.me message links: public, private (t.me/c/...) and thread variants. */
export function parseTelegramLink(rawUrl: string): ParsedLink | null {
  const url = String(rawUrl || '').trim();
  if (!url) return null;

  // Private links: t.me/c/<internalId>/<msgId> or t.me/c/<internalId>/<threadId>/<msgId>
  const privateMatch = url.match(/t\.me\/c\/(\d+)\/(\d+)(?:\/(\d+))?/);
  if (privateMatch) {
    const internalId = privateMatch[1];
    let messageId: number;
    let threadId: number | undefined;
    if (privateMatch[3]) {
      threadId = parseInt(privateMatch[2], 10);
      messageId = parseInt(privateMatch[3], 10);
    } else {
      messageId = parseInt(privateMatch[2], 10);
    }
    return { chatRef: `-100${internalId}`, messageId, isPrivate: true, threadId, originalUrl: url };
  }

  if (/t\.me\/(joinchat\/|\+)/.test(url)) return null; // invite link, not a message link

  // Public links: t.me/<username>/<msgId> or t.me/<username>/<threadId>/<msgId>
  const publicMatch = url.match(/(?:^|\/)(?:t|telegram)\.me\/([A-Za-z0-9_]+)\/(\d+)(?:\/(\d+))?/);
  if (publicMatch) {
    const username = publicMatch[1].replace(/^@/, '');
    let messageId: number;
    let threadId: number | undefined;
    if (publicMatch[3]) {
      threadId = parseInt(publicMatch[2], 10);
      messageId = parseInt(publicMatch[3], 10);
    } else {
      messageId = parseInt(publicMatch[2], 10);
    }
    return { chatRef: `@${username}`, messageId, isPrivate: false, threadId, originalUrl: url };
  }

  return null;
}

function classifyMedia(msg: any): { type: FetcherMediaType; mimeType?: string; fileName?: string } {
  const media = msg?.media;
  if (!media || media.className === 'MessageMediaWebPage') return { type: 'text' };
  if (media.className === 'MessageMediaPhoto' || media.photo) return { type: 'photo' };
  if (media.className === 'MessageMediaDocument' && media.document) {
    const doc = media.document;
    const mime: string = doc.mimeType || '';
    const attrs: any[] = doc.attributes || [];
    const fileAttr = attrs.find((a) => a.className === 'DocumentAttributeFilename');
    const audioAttr = attrs.find((a) => a.className === 'DocumentAttributeAudio');
    const videoAttr = attrs.find((a) => a.className === 'DocumentAttributeVideo');
    const stickerAttr = attrs.find((a) => a.className === 'DocumentAttributeSticker');
    const base = { mimeType: mime || undefined, fileName: fileAttr?.fileName || undefined };
    if (audioAttr?.voice) return { type: 'voice', ...base };
    if (stickerAttr) return { type: 'sticker', ...base };
    if (videoAttr && media.className === 'MessageMediaDocument') {
      if (videoAttr.roundMessage) return { type: 'video', ...base };
      return { type: 'video', ...base };
    }
    if (mime.startsWith('video/')) return { type: 'video', ...base };
    if (mime.startsWith('audio/')) return { type: 'audio', ...base };
    if (mime.startsWith('image/')) return { type: 'photo', ...base };
    if (mime.startsWith('animation/') || (mime === 'application/octet-stream' && videoAttr)) return { type: 'animation', ...base };
    return { type: 'document', ...base };
  }
  return { type: 'unknown' };
}

function extFor(mimeType?: string, fileName?: string, fallback = '.bin'): string {
  if (fileName && /\.[A-Za-z0-9]{1,6}$/.test(fileName)) return '';
  if (mimeType && MIME_EXT[mimeType]) return MIME_EXT[mimeType];
  if (mimeType?.startsWith('video/')) return `.${mimeType.split('/')[1].split(';')[0]}`;
  if (mimeType?.startsWith('audio/')) return `.${mimeType.split('/')[1].split(';')[0]}`;
  if (mimeType?.startsWith('image/')) return `.${mimeType.split('/')[1].split(';')[0]}`;
  return fallback;
}

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120).trim() || 'file';
}

function floodWaitSeconds(err: any): number | null {
  if (!err) return null;
  const msg = String(err.message || '');
  const match = msg.match(/FLOOD_WAIT_(\d+)/);
  if (match) return parseInt(match[1], 10);
  if (err.errorMessage === 'FLOOD_WAIT' && typeof err.seconds === 'number') return err.seconds;
  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class RestrictedFetcher {
  private static instance: RestrictedFetcher;
  private engine: TelegramEngine;
  private dataDir: string;
  private jobsFile: string;
  private downloadsDir: string;
  private jobs = new Map<string, FetcherJob>();
  private queue: string[] = [];
  private processing = false;
  private pendingDeletions = new Set<string>();
  private watchdog: NodeJS.Timeout | null = null;

  private constructor() {
    this.engine = TelegramEngine.getInstance();
    const base = process.env.TG_DATA_DIR || path.join(process.cwd(), '.data');
    this.dataDir = path.join(base, 'fetcher');
    this.jobsFile = path.join(this.dataDir, 'jobs.json');
    this.downloadsDir = path.join(this.dataDir, 'downloads');
    fs.mkdirSync(this.downloadsDir, { recursive: true });
    this.loadJobs();
    this.watchdog = setInterval(() => {
      if (!this.processing && this.queue.length > 0 && this.engine.isAccountConnected()) {
        void this.runQueue();
      }
    }, 8000);
    if (typeof this.watchdog.unref === 'function') this.watchdog.unref();
  }

  public static getInstance(): RestrictedFetcher {
    if (!RestrictedFetcher.instance) {
      RestrictedFetcher.instance = new RestrictedFetcher();
    }
    return RestrictedFetcher.instance;
  }

  // ==================== PERSISTENCE ====================

  private loadJobs() {
    try {
      if (!fs.existsSync(this.jobsFile)) return;
      const list = JSON.parse(fs.readFileSync(this.jobsFile, 'utf8'));
      if (!Array.isArray(list)) return;
      for (const job of list) {
        if (job?.id && Array.isArray(job.items)) {
          this.jobs.set(job.id, { ...job, cancelRequested: false });
        }
      }
    } catch (err: any) {
      console.warn('[RestrictedFetcher] Could not restore jobs:', err?.message || err);
    }
  }

  private persist() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const list = Array.from(this.jobs.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MAX_JOBS_KEPT);
      const tmp = `${this.jobsFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
      fs.renameSync(tmp, this.jobsFile);
    } catch (err: any) {
      console.error('[RestrictedFetcher] Error persisting jobs:', err?.message || err);
    }
  }

  private emit(job: FetcherJob) {
    this.engine.broadcastEvent('FETCHER_UPDATE', this.sanitizeJob(job));
  }

  private sanitizeJob(job: FetcherJob): FetcherJob {
    return JSON.parse(JSON.stringify(job));
  }

  private recomputeStats(job: FetcherJob) {
    job.stats = {
      total: job.items.length,
      delivered: job.items.filter((i) => i.status === 'delivered').length,
      failed: job.items.filter((i) => i.status === 'failed').length,
      skipped: job.items.filter((i) => i.status === 'skipped').length,
      downloaded: job.items.filter((i) => i.downloadReady).length
    };
  }

  private finalize(job: FetcherJob) {
    this.recomputeStats(job);
    const anyProcessing = job.items.some((i) => i.status === 'queued' || i.status === 'processing');
    if (job.cancelRequested) job.status = 'cancelled';
    else if (anyProcessing) job.status = job.items.some((i) => i.status === 'processing') ? 'running' : 'queued';
    else if (job.stats.failed > 0 || job.stats.skipped > 0) job.status = job.stats.delivered > 0 ? 'partial' : 'failed';
    else job.status = 'completed';
    job.updatedAt = Date.now();
  }

  // ==================== PUBLIC API ====================

  public createJob(input: FetcherJobInput): FetcherJob {
    const links = (Array.isArray(input.links) ? input.links : [])
      .flatMap((chunk) => String(chunk).split(/[\s,;]+/))
      .map((l) => l.trim())
      .filter(Boolean);
    if (!links.length) throw new Error('At least one Telegram message link is required.');
    if (links.length > MAX_LINKS_PER_JOB) throw new Error(`Too many links. Maximum is ${MAX_LINKS_PER_JOB} per job.`);

    const sendToTelegram = Boolean(input.sendToTelegram);
    const saveForDownload = Boolean(input.saveForDownload);
    if (!sendToTelegram && !saveForDownload) {
      throw new Error('Choose at least one delivery mode: send to a Telegram target or save for download.');
    }
    if (!this.engine.isAccountConnected()) {
      throw new Error('Telegram account is not connected. Connect an account in the dashboard first.');
    }
    const targetId = (input.targetId || 'me').trim() || 'me';
    const targetTitle = (input.targetTitle || (targetId === 'me' ? 'Saved Messages' : targetId)).trim();

    const job: FetcherJob = {
      id: `fetch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'queued',
      cancelRequested: false,
      options: { sendToTelegram, saveForDownload, targetId, targetTitle },
      items: [],
      stats: { total: 0, delivered: 0, failed: 0, skipped: 0, downloaded: 0 }
    };

    const seen = new Set<string>();
    let itemIndex = 0;
    for (const link of links) {
      const parsed = parseTelegramLink(link);
      const id = `item-${job.id}-${itemIndex++}`;
      if (!parsed) {
        const isInvite = /t\.me\/(joinchat\/|\+)/.test(link);
        job.items.push({
          id, link, chatRef: '', chatTitle: 'Unknown source', messageId: 0, isPrivate: false,
          status: 'failed', error: isInvite
            ? 'This is an invite link, not a message link. Open the channel and copy the link to a specific message (contains a message number).'
            : 'Unsupported or malformed Telegram message link.',
          mediaType: 'unknown', snippet: '', albumSize: 1, downloadFiles: [], downloadReady: false, retries: 0
        });
        continue;
      }
      const key = `${parsed.chatRef}:${parsed.messageId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      job.items.push({
        id, link, chatRef: parsed.chatRef, chatTitle: parsed.chatRef, messageId: parsed.messageId,
        isPrivate: parsed.isPrivate, threadId: parsed.threadId, status: 'queued',
        mediaType: 'unknown', snippet: '', albumSize: 1, downloadFiles: [], downloadReady: false, retries: 0
      });
    }

    if (!job.items.some((i) => i.status === 'queued')) {
      throw new Error('No valid Telegram message links were found in the input.');
    }

    this.finalize(job);
    job.status = 'queued';
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this.persist();

    this.engine.log({
      level: 'success', category: 'fetcher', title: '📥 Fetch Job Queued',
      message: `Queued ${job.items.length} message link(s) — ${sendToTelegram ? `deliver to ${targetTitle}` : 'no Telegram delivery'}${sendToTelegram && saveForDownload ? ' + ' : ''}${saveForDownload ? 'server-side download' : ''}.`,
      sourceId: job.options.targetId, sourceTitle: job.options.targetTitle, details: { jobId: job.id, total: job.items.length }
    });
    this.emit(job);

    if (!this.processing) void this.runQueue();
    return this.sanitizeJob(job);
  }

  public getJobs(limit = 30): FetcherJob[] {
    this.kickIfIdle();
    return Array.from(this.jobs.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.min(Math.max(limit, 1), 100))
      .map((j) => this.sanitizeJob(j));
  }

  public getJob(id: string): FetcherJob | null {
    const job = this.jobs.get(id);
    return job ? this.sanitizeJob(job) : null;
  }

  public cancelJob(id: string): { success: boolean; message: string } {
    const job = this.jobs.get(id);
    if (!job) return { success: false, message: 'Job not found.' };
    if (job.status !== 'queued' && job.status !== 'running') return { success: false, message: `Job is already ${job.status}.` };
    job.cancelRequested = true;
    job.updatedAt = Date.now();
    this.persist();
    this.emit(job);
    this.engine.log({ level: 'warn', category: 'fetcher', title: '✋ Fetch Job Cancel Requested', message: `Job ${id} will stop after the current item finishes.` });
    return { success: true, message: 'Cancel requested. The job stops after the current item.' };
  }

  public retryJob(id: string): { success: boolean; message: string } {
    const job = this.jobs.get(id);
    if (!job) return { success: false, message: 'Job not found.' };
    if (job.status === 'running' || job.status === 'queued') return { success: false, message: 'Job is still active.' };
    if (!this.engine.isAccountConnected()) throw new Error('Telegram account is not connected.');
    const retryable = job.items.filter((i) => i.status === 'failed' || i.status === 'skipped');
    if (!retryable.length) return { success: false, message: 'No failed items to retry.' };
    for (const item of retryable) {
      if (item.messageId > 0) {
        item.status = 'queued';
        item.error = undefined;
      }
    }
    // Drop permanently-invalid items from the retry count (they never had a message id)
    this.finalize(job);
    job.status = job.items.some((i) => i.status === 'queued') ? 'queued' : job.status;
    job.cancelRequested = false;
    job.updatedAt = Date.now();
    if (job.status === 'queued') this.queue.push(job.id);
    this.persist();
    this.emit(job);
    this.engine.log({ level: 'info', category: 'fetcher', title: '🔁 Fetch Job Retry Queued', message: `Requeued ${retryable.filter((i) => i.status === 'queued').length} item(s) for job ${id}.` });
    if (!this.processing) void this.runQueue();
    return { success: true, message: 'Retry queued.' };
  }

  public deleteJob(id: string): { success: boolean; message: string } {
    const job = this.jobs.get(id);
    if (!job) return { success: false, message: 'Job not found.' };
    if (job.status === 'running' || job.status === 'queued') {
      job.cancelRequested = true;
      this.pendingDeletions.add(id);
      this.persist();
      this.emit(job);
      return { success: true, message: 'Job is active — it will be deleted after the current item finishes.' };
    }
    this.removeJobData(job);
    return { success: true, message: 'Job deleted.' };
  }

  private removeJobData(job: FetcherJob) {
    this.jobs.delete(job.id);
    this.queue = this.queue.filter((q) => q !== job.id);
    try {
      fs.rmSync(path.join(this.downloadsDir, job.id), { recursive: true, force: true });
    } catch { /* ignore */ }
    this.persist();
  }

  /** Absolute path of a downloadable file, or null when unavailable. */
  public getDownloadPath(jobId: string, itemId: string, file: string): string | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    const item = job.items.find((i) => i.id === itemId);
    if (!item || !item.downloadFiles.includes(file)) return null;
    const safe = safeFileName(file);
    const full = path.join(this.downloadsDir, jobId, itemId, safe);
    if (!full.startsWith(this.downloadsDir) || !fs.existsSync(full)) return null;
    return full;
  }

  public resumeInterruptedJobs() {
    let resumed = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'running' || job.status === 'queued') {
        for (const item of job.items) {
          if (item.status === 'processing') {
            item.status = 'queued';
            item.error = 'Interrupted by restart — requeued.';
          }
        }
        this.finalize(job);
        if (job.items.some((i) => i.status === 'queued')) {
          job.status = 'queued';
          this.queue.push(job.id);
          resumed++;
        } else {
          this.finalize(job);
        }
        job.updatedAt = Date.now();
      }
    }
    if (resumed) {
      this.persist();
      console.log(`[RestrictedFetcher] Requeued ${resumed} interrupted job(s).`);
    }
  }

  private kickIfIdle() {
    if (!this.processing && this.queue.length > 0 && this.engine.isAccountConnected()) {
      void this.runQueue();
    }
  }

  // ==================== WORKER ====================

  private async runQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const jobId = this.queue.shift()!;
        const job = this.jobs.get(jobId);
        if (!job || job.cancelRequested) {
          if (job && this.pendingDeletions.has(jobId)) { this.pendingDeletions.delete(jobId); this.removeJobData(job); }
          continue;
        }
        await this.runJob(job);
        if (this.pendingDeletions.has(jobId)) { this.pendingDeletions.delete(jobId); this.removeJobData(job); }
      }
    } finally {
      this.processing = false;
    }
  }

  private async runJob(job: FetcherJob) {
    job.status = 'running';
    job.updatedAt = Date.now();
    this.persist();
    this.emit(job);

    const minDelayMs = this.getPacingDelayMs();
    const maxRetries = this.getRetryAttempts();

    for (const item of job.items) {
      if (job.cancelRequested) break;
      if (item.status !== 'queued') continue;

      item.status = 'processing';
      item.error = undefined;
      item.retries = 0;
      this.emit(job);

      let attempts = 0;
      // Retry loop for flood waits
      for (;;) {
        attempts++;
        try {
          await this.processItem(job, item);
          break;
        } catch (err: any) {
          const wait = floodWaitSeconds(err);
          if (wait && attempts <= maxRetries) {
            item.retries = attempts;
            this.engine.log({
              level: 'warn', category: 'fetcher', title: '⚠️ Flood Wait — Cooling Down',
              message: `Telegram rate limit hit while processing ${item.chatTitle} #${item.messageId}. Waiting ${wait}s before retry ${attempts}/${maxRetries}.`
            });
            await sleep(Math.min(wait + 1, 900) * 1000);
            continue;
          }
          item.status = 'failed';
          item.error = this.humanizeError(err);
          this.engine.log({
            level: 'error', category: 'fetcher', title: '❌ Fetch Item Failed',
            message: `${item.chatTitle} #${item.messageId}: ${item.error}`,
            sourceId: item.chatRef || undefined, sourceTitle: item.chatTitle
          });
          break;
        }
      }

      this.finalize(job);
      job.updatedAt = Date.now();
      this.persist();
      this.emit(job);

      if (job.cancelRequested) break;
      const remaining = job.items.filter((i) => i.status === 'queued').length;
      if (remaining > 0) await sleep(minDelayMs);
    }

    // Mark anything left unprocessed as skipped
    for (const item of job.items) {
      if (item.status === 'queued' || item.status === 'processing') item.status = 'skipped';
    }
    this.finalize(job);
    job.updatedAt = Date.now();
    this.persist();
    this.emit(job);

    this.engine.log({
      level: job.stats.failed > 0 ? (job.stats.delivered > 0 ? 'info' : 'error') : 'success',
      category: 'fetcher', title: '🏁 Fetch Job Finished',
      message: `Job ${job.id}: ${job.stats.delivered}/${job.stats.total} delivered, ${job.stats.downloaded} downloaded, ${job.stats.failed} failed${job.cancelRequested ? ' (cancelled)' : ''}.`,
      details: { jobId: job.id, ...job.stats }
    });
  }

  private async processItem(job: FetcherJob, item: FetcherItem) {
    const client = this.engine.getClient();
    if (!client || !this.engine.isAccountConnected()) throw new Error('Telegram account is not connected.');

    // 1. Resolve the source chat (works for @usernames and -100... private ids)
    const entity = await this.engine.resolveEntity(item.chatRef);
    if (!entity) throw new Error(`Could not resolve ${item.chatRef}. Your account must be a member of this chat.`);
    if (entity.title) item.chatTitle = String(entity.title);
    else if (entity.username) item.chatTitle = `@${entity.username}`;

    // 2. Fetch the message
    const result: any = await client.getMessages(entity, { ids: item.messageId });
    const msg = Array.isArray(result) ? result[0] : result;
    if (!msg) {
      throw new Error('Message not found. It may be deleted, or the connected account has no access to this chat.');
    }

    // 3. Classify media + detect albums (grouped media)
    const mediaInfo = classifyMedia(msg);
    item.mediaType = mediaInfo.type;
    item.mimeType = mediaInfo.mimeType;
    item.fileName = mediaInfo.fileName;
    item.snippet = String(msg.message || '').slice(0, 300);
    const albumMessages = await this.collectAlbum(client, entity, msg);

    // 4. Deliver to the Telegram target (clean repost — restricted sources block native forwards)
    if (job.options.sendToTelegram) {
      const delivery = await this.deliverToTelegram(job, client, msg, albumMessages, mediaInfo);
      item.deliveredTo = job.options.targetTitle;
      item.deliveredMsgId = delivery;
    }

    // 5. Download for the dashboard
    if (job.options.saveForDownload) {
      const files = await this.downloadItem(job, item, client, msg, albumMessages, mediaInfo);
      item.downloadFiles = files;
      item.downloadReady = files.length > 0;
      const primaryPath = this.getDownloadPath(job.id, item.id, files[0] || '');
      if (primaryPath) {
        item.fileSize = fs.statSync(primaryPath).size;
        if (!item.fileName) item.fileName = files[0];
      }
    }

    item.status = 'delivered';
    this.engine.log({
      level: 'success', category: 'fetcher', title: '✅ Restricted Post Fetched',
      message: `${item.chatTitle} #${item.messageId} (${item.mediaType}${item.albumSize > 1 ? `, album of ${item.albumSize}` : ''}) — ${job.options.sendToTelegram ? `delivered to ${job.options.targetTitle}${item.deliveredMsgId ? ` (#${item.deliveredMsgId})` : ''}` : 'fetched'}${job.options.saveForDownload && item.downloadReady ? ` + ${item.downloadFiles.length} file(s) saved` : ''}.`,
      sourceId: item.chatRef || undefined, sourceTitle: item.chatTitle,
      targetId: job.options.sendToTelegram ? job.options.targetId : undefined,
      targetTitle: job.options.sendToTelegram ? job.options.targetTitle : undefined,
      messageSnippet: item.snippet.slice(0, 80) || `[${item.mediaType}]`
    });
  }

  private async collectAlbum(client: any, entity: any, msg: any): Promise<any[]> {
    try {
      const groupedId = msg.groupedId ? String(msg.groupedId) : '';
      if (!groupedId || !msg.media) return [msg];
      const baseId = Number(msg.id);
      const ids: number[] = [];
      for (let offset = -ALBUM_SCAN_RADIUS; offset <= ALBUM_SCAN_RADIUS; offset++) {
        const candidate = baseId + offset;
        if (candidate > 0 && candidate !== baseId) ids.push(candidate);
      }
      const neighbors: any[] = await client.getMessages(entity, { ids });
      const album = [msg, ...neighbors.filter((m: any) => m && m.media && m.groupedId && String(m.groupedId) === groupedId)];
      album.sort((a: any, b: any) => Number(a.id) - Number(b.id));
      return album.slice(0, MAX_ALBUM_ITEMS);
    } catch {
      return [msg];
    }
  }

  private async deliverToTelegram(job: FetcherJob, client: any, msg: any, albumMessages: any[], mediaInfo: { type: FetcherMediaType }): Promise<string> {
    const target = job.options.targetId;
    const text = String(msg.message || '');
    const isMedia = mediaInfo.type !== 'text' && mediaInfo.type !== 'unknown';

    if (isMedia) {
      const forceDocument = mediaInfo.type === 'document' || mediaInfo.type === 'audio' || mediaInfo.type === 'voice' || mediaInfo.type === 'sticker';
      if (albumMessages.length > 1) {
        try {
          const files = albumMessages.map((m: any) => m.media);
          const captions = albumMessages.map((m: any, index: number) => (index === 0 ? text.slice(0, 1000) : ''));
          const sent: any = await client.sendFile(target, { file: files, caption: captions, forceDocument });
          const first = Array.isArray(sent) ? sent[0] : sent;
          return first?.id ? String(first.id) : '';
        } catch (albumErr: any) {
          this.engine.log({
            level: 'warn', category: 'fetcher', title: '📚 Album Send Fell Back',
            message: `Album dispatch failed (${String(albumErr?.message || albumErr).slice(0, 120)}). Sending items one by one instead.`
          });
        }
        let lastId = '';
        for (let index = 0; index < albumMessages.length; index++) {
          const sent: any = await client.sendFile(target, {
            file: albumMessages[index].media,
            caption: index === 0 ? text.slice(0, 1000) : '',
            forceDocument
          });
          lastId = sent?.id ? String(sent.id) : lastId;
        }
        return lastId;
      }
      const sent: any = await client.sendFile(target, { file: msg.media, caption: text ? text.slice(0, 1000) : undefined, forceDocument });
      return sent?.id ? String(sent.id) : '';
    }

    // Text-only message
    const sent: any = await client.sendMessage(target, {
      message: text || '(empty message)',
      linkPreview: true,
      formattingEntities: msg.entities || undefined
    });
    return sent?.id ? String(sent.id) : '';
  }

  private async downloadItem(job: FetcherJob, item: FetcherItem, client: any, msg: any, albumMessages: any[], mediaInfo: { type: FetcherMediaType; mimeType?: string; fileName?: string }): Promise<string[]> {
    const saved: string[] = [];

    const messagesToSave = albumMessages.length > 1 ? albumMessages : [msg];
    for (const message of messagesToSave) {
      const msgId = Number(message.id);
      const info = messagesToSave.length > 1 ? classifyMedia(message) : mediaInfo;
      let fileName: string;

      if (info.type === 'text') {
        fileName = `message_${msgId}.txt`;
        const dir = this.ensureItemDir(job.id, item.id);
        const content = String(message.message || '');
        fs.writeFileSync(path.join(dir, fileName), content, 'utf8');
        saved.push(fileName);
        continue;
      }

      const baseName = info.fileName ? safeFileName(info.fileName) : '';
      const fallbackExt = info.type === 'photo' ? '.jpg' : info.type === 'video' ? '.mp4' : info.type === 'voice' ? '.ogg'
        : info.type === 'audio' ? '.mp3' : info.type === 'sticker' ? '.webp' : info.type === 'animation' ? '.mp4' : '.bin';
      fileName = baseName
        ? (messagesToSave.length > 1 ? `${msgId}_${baseName}` : baseName)
        : `${msgId}_${info.type}${extFor(info.mimeType, info.fileName, fallbackExt)}`;

      const dir = this.ensureItemDir(job.id, item.id);
      const filePath = path.join(dir, fileName);
      try {
        const written: any = await client.downloadMedia(message, { outputFile: filePath });
        if (!fs.existsSync(filePath)) {
          const buffer: any = await client.downloadMedia(message, {});
          if (!buffer) throw new Error('Telegram returned no downloadable media.');
          fs.writeFileSync(filePath, Buffer.from(buffer));
        }
        void written;
        saved.push(fileName);
      } catch (err: any) {
        this.engine.log({
          level: 'warn', category: 'fetcher', title: '💾 Download Failed (delivery unaffected)',
          message: `Could not download ${info.type} #${msgId}: ${String(err?.message || err).slice(0, 140)}`
        });
      }
    }
    return saved;
  }

  private ensureItemDir(jobId: string, itemId: string): string {
    // Files live in downloads/<jobId>/<itemId>/ — the download endpoint resolves
    // paths with the exact same layout (see getDownloadPath).
    const dir = path.join(this.downloadsDir, jobId, itemId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getPacingDelayMs(): number {
    try {
      const config = (this.engine as any).storage?.getConfig?.();
      return Math.max(350, Number(config?.globalRateLimit?.minDelayMs) || 1200);
    } catch {
      return 1200;
    }
  }

  private getRetryAttempts(): number {
    try {
      const config = (this.engine as any).storage?.getConfig?.();
      return Math.max(1, Number(config?.globalRateLimit?.retryAttempts) || 3);
    } catch {
      return 3;
    }
  }

  private humanizeError(err: any): string {
    const raw = String(err?.message || err || 'Unknown error');
    if (/CHANNEL_PRIVATE|ChatPrivate|channel private/i.test(raw)) return 'This chat is private and the connected account is not a member of it. Join the channel with this account first.';
    if (/CHAT_FORWARDS_RESTRICTED|FORWARDS_RESTRICTED/i.test(raw)) return 'Source restricts forwarding — the clean-repost delivery should have handled this. Please retry.';
    if (/AUTH_KEY_UNREGISTERED|Unauthorized/i.test(raw)) return 'Telegram session is no longer valid. Reconnect the account.';
    if (/Could not resolve/i.test(raw)) return `Could not resolve ${raw.replace(/^.*Could not resolve\s*/, '').replace(/[.:].*$/, '')}. The account may not have access.`;
    return raw.slice(0, 240);
  }
}

export const restrictedFetcher = RestrictedFetcher.getInstance();
