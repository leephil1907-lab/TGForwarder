import React from 'react';
import { Send, Shield, Zap, Filter, Clock, CheckCircle, Radio, AlertTriangle, UserX, Image } from 'lucide-react';
import { EngineStats, ForwardingRule, RateLimitConfig } from '../types';

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
    </div>
  );
};
