import React, { useState } from 'react';
import { X, Zap, Shield, Clock, AlertTriangle, Check, Sliders, RefreshCw, Save } from 'lucide-react';
import { RateLimitConfig } from '../types';

interface RateLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  rateLimit: RateLimitConfig;
  onSaveRateLimit: (newConfig: RateLimitConfig) => Promise<void>;
}

export const RateLimitModal: React.FC<RateLimitModalProps> = ({
  isOpen,
  onClose,
  rateLimit,
  onSaveRateLimit
}) => {
  const [minDelayMs, setMinDelayMs] = useState<number>(rateLimit?.minDelayMs || 1200);
  const [maxMessagesPerMinute, setMaxMessagesPerMinute] = useState<number>(rateLimit?.maxMessagesPerMinute || 25);
  const [autoSleepOnFloodWait, setAutoSleepOnFloodWait] = useState<boolean>(rateLimit?.autoSleepOnFloodWait ?? true);
  const [retryAttempts, setRetryAttempts] = useState<number>(rateLimit?.retryAttempts || 3);
  const [exponentialBackoff, setExponentialBackoff] = useState<boolean>(rateLimit?.exponentialBackoff ?? true);

  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSaveRateLimit({
        minDelayMs: Number(minDelayMs),
        maxMessagesPerMinute: Number(maxMessagesPerMinute),
        autoSleepOnFloodWait,
        retryAttempts: Number(retryAttempts),
        exponentialBackoff
      });
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 1000);
    } catch (err: any) {
      alert(`Failed to save rate limit policy: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefaults = () => {
    setMinDelayMs(1200);
    setMaxMessagesPerMinute(25);
    setAutoSleepOnFloodWait(true);
    setRetryAttempts(3);
    setExponentialBackoff(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-800/80 text-cyan-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Telegram API Rate Limiting & Cooldowns</h2>
              <p className="text-xs text-slate-400">Anti-ban safeguards, queue pacing, and FloodWait handler</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {savedSuccess && (
            <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Rate limit policies saved and activated!</span>
            </div>
          )}

          {/* Setting 1: Min Delay */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-white">Minimum Inter-Message Delay</label>
              <span className="text-xs font-mono font-bold text-cyan-300">
                {(minDelayMs / 1000).toFixed(1)}s ({minDelayMs}ms)
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Adds an intentional pacing pause between message forwards to emulate organic human posting.
            </p>
            <input
              type="range"
              min={200}
              max={10000}
              step={100}
              value={minDelayMs}
              onChange={(e) => setMinDelayMs(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>0.2s (Fast)</span>
              <span>1.2s (Recommended)</span>
              <span>10s (Cautious)</span>
            </div>
          </div>

          {/* Setting 2: Messages Per Minute Window */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-white">Max Posts per 60-Second Window</label>
              <span className="text-xs font-mono font-bold text-emerald-300">
                {maxMessagesPerMinute} msgs / min
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Prevents burst-forwarding when a source channel publishes multiple posts or media albums at once.
            </p>
            <input
              type="range"
              min={5}
              max={60}
              step={1}
              value={maxMessagesPerMinute}
              onChange={(e) => setMaxMessagesPerMinute(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>5 / min</span>
              <span>25 / min (Optimal)</span>
              <span>60 / min</span>
            </div>
          </div>

          {/* Setting 3: Auto Sleep on FloodWait */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-white block">Auto-Sleep on FloodWaitError</label>
                <p className="text-[11px] text-slate-400">
                  When Telegram requests a cooldown period (e.g., wait 14s), automatically sleep and resume without dropping messages.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                <input
                  type="checkbox"
                  checked={autoSleepOnFloodWait}
                  onChange={(e) => setAutoSleepOnFloodWait(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-600"></div>
              </label>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-900">
              <div>
                <label className="text-xs font-semibold text-white block">Exponential Retry Backoff</label>
                <p className="text-[11px] text-slate-400">
                  Gradually increase wait times between retried failed deliveries.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                <input
                  type="checkbox"
                  checked={exponentialBackoff}
                  onChange={(e) => setExponentialBackoff(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-600"></div>
              </label>
            </div>
          </div>

          {/* Setting 4: Max Retry Count */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div>
              <label className="text-xs font-semibold text-white block">Maximum Retry Attempts</label>
              <p className="text-[11px] text-slate-400">Number of retry dispatches before logging a permanent delivery failure.</p>
            </div>
            <select
              value={retryAttempts}
              onChange={(e) => setRetryAttempts(Number(e.target.value))}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-cyan-300 font-mono font-bold focus:outline-none focus:border-cyan-500"
            >
              <option value={1}>1 Retry</option>
              <option value={2}>2 Retries</option>
              <option value={3}>3 Retries</option>
              <option value={5}>5 Retries</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
            >
              Reset to Defaults
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md shadow-cyan-950 flex items-center gap-1.5"
              >
                {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Save Policies</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
