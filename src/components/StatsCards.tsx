import React, { useEffect, useState } from 'react';
import { AlarmClock, Download, FileVideo, Inbox, Send, Shield, Zap, Filter, Clock, CheckCircle, Radio, AlertTriangle, UserX, Image } from 'lucide-react';
import { EngineStats, FetcherJob, ForwardingRule, RateLimitConfig } from '../types';

interface StatsCardsProps {
  stats: EngineStats;
  rules?: ForwardingRule[];
  rateLimit?: RateLimitConfig;
  isEngineRunning: boolean;
  onOpenRateLimit?: () => void;
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  minDelayMs: 1200,
  maxMessagesPerMinute: 25,
  autoSleepOnFloodWait: true,
  retryAttempts: 3,
  exponentialBackoff: true
};

export const StatsCards: React.FC<StatsCardsProps> = ({
  stats,
  rules = [],
  rateLimit = DEFAULT_RATE_LIMIT,
  isEngineRunning,
  onOpenRateLimit = () => {}
}) => {
  // ---- Restricted Fetcher & Auto-Import telemetry ----
  const [jobs, setJobs] = useState<FetcherJob[]>([]);
  const [watcherCount, setWatcherCount] = useState({ total: 0, active: 0 });

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const [jobsRes, watchRes] = await Promise.all([
          fetch('/api/fetcher/jobs?limit=100', { cache: 'no-store' }),
          fetch('/api/autoimport', { cache: 'no-store' }),
        ]);
        if (jobsRes.ok && mounted) { const d = await jobsRes.json(); setJobs(d.jobs || []); }
        if (watchRes.ok && mounted) {
          const d = await watchRes.json();
          const list: Array<{ enabled: boolean }> = d.watches || [];
          setWatcherCount({ total: list.length, active: list.filter((w) => w.enabled).length });
        }
      } catch { /* transient — next poll recovers */ }
    };
    void refresh();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000);
    return () => { mounted = false; window.clearInterval(t); };
  }, []);

  const fetcherTotals = jobs.reduce(
    (acc, j) => ({
      delivered: acc.delivered + j.stats.delivered,
      downloaded: acc.downloaded + j.stats.downloaded,
      failed: acc.failed + j.stats.failed,
      active: acc.active + (j.status === 'queued' || j.status === 'running' ? 1 : 0),
    }),
    { delivered: 0, downloaded: 0, failed: 0, active: 0 }
  );
  const lastFetchAt = jobs.length ? Math.max(...jobs.map((j) => j.updatedAt || j.createdAt)) : null;
  const formatUptime = (seconds: number) => {
    if (!seconds || seconds <= 0) return '0m 0s';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const successRate = stats.totalReceived > 0
    ? Math.min(100, Math.round((stats.totalForwarded / (stats.totalForwarded + stats.totalFailed || 1)) * 100))
    : 100;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-cyan-400" />
            <h1 className="text-lg font-bold text-white tracking-tight">Engine Analytics & Rate Limit Telemetry</h1>
          </div>
          <p className="text-xs text-slate-400">
            Real-time pipeline performance, Telegram API rate limiting health, and filter shield metrics.
          </p>
        </div>

        <button
          onClick={onOpenRateLimit}
          className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 text-xs font-bold transition-all flex items-center gap-2 shrink-0"
        >
          <Zap className="w-4 h-4 text-amber-400" />
          <span>Adjust Rate Limit Policies</span>
        </button>
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Total Relayed */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Total Relayed</span>
            <div className="p-2 rounded-xl bg-emerald-950/80 border border-emerald-800/80 text-emerald-400">
              <Send className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white font-mono tracking-tight">
            {stats.totalForwarded.toLocaleString()}
          </div>
          <p className="text-[11px] text-emerald-400 flex items-center gap-1 font-medium">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>{successRate}% Delivery Success Rate</span>
          </p>
        </div>

        {/* Metric 2: Duplicate Shielded */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Duplicates Blocked</span>
            <div className="p-2 rounded-xl bg-cyan-950/80 border border-cyan-800/80 text-cyan-400">
              <Shield className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white font-mono tracking-tight">
            {stats.duplicatesBlocked.toLocaleString()}
          </div>
          <p className="text-[11px] text-cyan-300 font-medium">
            MD5 Content Fingerprint Shield
          </p>
        </div>

        {/* Metric 3: Filter Drops */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">Filter Drops (KW/Media)</span>
            <div className="p-2 rounded-xl bg-amber-950/80 border border-amber-800/80 text-amber-400">
              <Filter className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white font-mono tracking-tight">
            {(stats.filtersTriggered + (stats.mediaBlocked || 0) + (stats.sendersBlocked || 0)).toLocaleString()}
          </div>
          <p className="text-[11px] text-amber-400 font-medium">
            Keywords, Media & Sender Filters
          </p>
        </div>

        {/* Metric 4: FloodWait Recovery */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">FloodWaits Handled</span>
            <div className="p-2 rounded-xl bg-purple-950/80 border border-purple-800/80 text-purple-400">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white font-mono tracking-tight">
            {stats.floodWaitsHandled || 0}
          </div>
          <p className="text-[11px] text-purple-300 font-medium">
            Auto-Sleep & Resume Resilient
          </p>
        </div>
      </div>

      {/* Active Rate Limit Policy Status */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <h3 className="text-sm font-bold text-white tracking-tight flex items-center justify-between">
          <span>Active Telegram API Rate Limiting Configuration</span>
          <span className="text-xs font-mono font-normal text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
            PROTECTION LIVE
          </span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1">
            <span className="text-slate-400 block">Min Delay Between Posts</span>
            <span className="text-base font-bold text-cyan-300 font-mono">
              {(rateLimit.minDelayMs / 1000).toFixed(1)}s ({rateLimit.minDelayMs}ms)
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1">
            <span className="text-slate-400 block">Max Per-Minute Window Cap</span>
            <span className="text-base font-bold text-emerald-300 font-mono">
              {rateLimit.maxMessagesPerMinute} msgs / min
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1">
            <span className="text-slate-400 block">Retry Backoff & Auto-Sleep</span>
            <span className="text-base font-bold text-amber-300 font-mono">
              {rateLimit.retryAttempts}x Retries ({rateLimit.autoSleepOnFloodWait ? 'Auto-Sleep ON' : 'OFF'})
            </span>
          </div>
        </div>
      </div>

      {/* Restricted Fetcher & Auto-Import Activity */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Inbox className="w-5 h-5 text-cyan-400" />
              <h2 className="text-lg font-bold text-white tracking-tight">Restricted Fetcher & Auto-Import</h2>
            </div>
            <p className="text-xs text-slate-400">
              Link-fetch worker and scheduled source watchers — {watcherCount.active > 0 ? `${watcherCount.active} of ${watcherCount.total} watcher(s) active` : `${watcherCount.total} watcher(s) configured`}{lastFetchAt ? ` · last job ${new Date(lastFetchAt).toLocaleString()}` : ''}.
            </p>
          </div>
          {fetcherTotals.active > 0 && (
            <span className="text-[10px] text-cyan-300 bg-cyan-950 px-2.5 py-1 rounded-full border border-cyan-800 font-mono flex items-center gap-1.5 self-start">
              <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400" /></span>
              {fetcherTotals.active} JOB{fetcherTotals.active > 1 ? 'S' : ''} RUNNING
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">Fetch Jobs</span>
              <div className="p-2 rounded-xl bg-cyan-950/80 border border-cyan-800/80 text-cyan-400"><Inbox className="w-4 h-4" /></div>
            </div>
            <div className="text-2xl font-bold text-white font-mono tracking-tight">{jobs.length.toLocaleString()}</div>
            <p className="text-[11px] text-slate-500 font-medium">{fetcherTotals.active > 0 ? `${fetcherTotals.active} currently active` : 'all finished'}</p>
          </div>

          <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">Posts Delivered</span>
              <div className="p-2 rounded-xl bg-emerald-950/80 border border-emerald-800/80 text-emerald-400"><Send className="w-4 h-4" /></div>
            </div>
            <div className="text-2xl font-bold text-white font-mono tracking-tight">{fetcherTotals.delivered.toLocaleString()}</div>
            <p className="text-[11px] text-emerald-400 font-medium">Clean reposts & fetches</p>
          </div>

          <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">Files Saved</span>
              <div className="p-2 rounded-xl bg-violet-950/80 border border-violet-800/80 text-violet-400"><Download className="w-4 h-4" /></div>
            </div>
            <div className="text-2xl font-bold text-white font-mono tracking-tight">{fetcherTotals.downloaded.toLocaleString()}</div>
            <p className="text-[11px] text-violet-300 font-medium">Available for download</p>
          </div>

          <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">Fetch Failures</span>
              <div className="p-2 rounded-xl bg-rose-950/80 border border-rose-800/80 text-rose-400"><FileVideo className="w-4 h-4" /></div>
            </div>
            <div className="text-2xl font-bold text-white font-mono tracking-tight">{fetcherTotals.failed.toLocaleString()}</div>
            <p className="text-[11px] text-rose-300/90 font-medium">Retryable from job view</p>
          </div>

          <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">Auto-Import</span>
              <div className="p-2 rounded-xl bg-amber-950/80 border border-amber-800/80 text-amber-400"><AlarmClock className="w-4 h-4" /></div>
            </div>
            <div className="text-2xl font-bold text-white font-mono tracking-tight">{watcherCount.active}<span className="text-sm text-slate-500">/{watcherCount.total}</span></div>
            <p className="text-[11px] text-amber-300/90 font-medium">Watchers active</p>
          </div>
        </div>
      </div>
    </div>
  );
};
