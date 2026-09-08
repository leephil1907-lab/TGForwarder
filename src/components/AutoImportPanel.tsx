import React, { useCallback, useEffect, useState } from 'react';
import { AlarmClock, AlertCircle, CheckCircle2, Loader2, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { AuthState, AutoImportWatch, DiscoveredChat } from '../types';

interface Props {
  chats: DiscoveredChat[];
  authState: AuthState;
}

const INTERVALS = [
  { value: 5, label: 'Every 5 minutes' },
  { value: 10, label: 'Every 10 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 120, label: 'Every 2 hours' },
  { value: 360, label: 'Every 6 hours' },
];

const ago = (ts: number | null): string => {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const AutoImportPanel: React.FC<Props> = ({ chats, authState }) => {
  const [watches, setWatches] = useState<AutoImportWatch[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('me');
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [importLatest, setImportLatest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const connected = authState.status === 'connected';

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/autoimport', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setWatches(data.watches || []);
    } catch { /* transient */ }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const sourceChats = chats.filter((c) => ['channel', 'supergroup', 'group'].includes(c.type));
  const sendableChats = chats.filter((c) => c.canSendMessages !== false);

  const create = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const source = sourceChats.find((c) => c.id === sourceId);
      const target = targetId === 'me' ? { title: 'Saved Messages' } : sendableChats.find((c) => c.id === targetId);
      const res = await fetch('/api/autoimport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId,
          sourceTitle: source?.title,
          targetId,
          targetTitle: target?.title,
          intervalMinutes,
          importLatestOnStart: importLatest,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create the watcher.');
      setNotice({ ok: true, text: `Watcher created — new posts from ${data.watch.sourceTitle} will appear in Pending Posts automatically.` });
      setSourceId('');
      void refresh();
    } catch (err: any) {
      setNotice({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: 'toggle' | 'delete' | 'run', watch?: AutoImportWatch) => {
    if (action === 'run') setRunningId(id);
    try {
      let res: Response;
      if (action === 'delete') res = await fetch(`/api/autoimport/${encodeURIComponent(id)}`, { method: 'DELETE' });
      else if (action === 'toggle') res = await fetch(`/api/autoimport/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !watch?.enabled }) });
      else res = await fetch(`/api/autoimport/${encodeURIComponent(id)}/run`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || data.message || 'Action failed.');
      if (action === 'run') setNotice({ ok: true, text: data.message || 'Run complete.' });
      void refresh();
    } catch (err: any) {
      setNotice({ ok: false, text: err.message });
    } finally {
      setRunningId(null);
    }
  };

  if (!connected) return null;

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-white flex items-center gap-2"><AlarmClock className="w-4 h-4 text-cyan-400" /> Auto-Import Watchers</h2>
          <p className="text-[11px] text-slate-500 mt-1">Schedule a source channel to be scanned for new posts. New messages land in <span className="text-cyan-400">Pending Posts</span> on the Pipeline Funnel tab for editing and publishing.</p>
        </div>
        <button onClick={() => void refresh()} className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white shrink-0" title="Refresh watchers"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {/* Create form */}
      <div className="px-4 sm:px-5 py-4 space-y-3 bg-slate-950/40 border-b border-slate-800">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Source to watch</label>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500">
              <option value="">Select source channel…</option>
              {sourceChats.map((c) => <option key={c.id} value={c.id}>{c.title}{c.username ? ` (${c.username})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Review destination (Pending Posts target)</label>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500">
              <option value="me">Saved Messages (you)</option>
              {sendableChats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Check frequency</label>
            <select value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))} className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500">
              {INTERVALS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
          </div>
          <button
            onClick={create}
            disabled={busy || !sourceId}
            className="self-end px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-40 text-white text-xs font-bold flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add Watcher
          </button>
        </div>
        <label className="inline-flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer">
          <input type="checkbox" checked={importLatest} onChange={(e) => setImportLatest(e.target.checked)} className="accent-cyan-500" />
          Also import the 5 most recent existing posts when watching starts
        </label>
        {notice && (
          <div className={`p-3 rounded-xl border text-xs flex gap-2 ${notice.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-rose-950/40 border-rose-800 text-rose-300'}`}>
            {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}{notice.text}
          </div>
        )}
      </div>

      {/* Watch list */}
      {watches.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-slate-500">No watchers yet. Pick a source above and the scheduler will import every new post automatically.</div>
      ) : (
        <div className="divide-y divide-slate-800/60">
          {watches.map((w) => (
            <div key={w.id} className="px-4 sm:px-5 py-3 flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                  <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold font-mono ${w.enabled ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
                    {w.enabled ? 'ACTIVE' : 'PAUSED'}
                  </span>
                  <span className="text-slate-200 font-semibold truncate max-w-[220px]">{w.sourceTitle}</span>
                  <span className="text-slate-600">→</span>
                  <span className="text-emerald-300/90 truncate max-w-[160px]">{w.targetTitle}</span>
                  <span className="text-slate-500">· every {w.intervalMinutes}m</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500 mt-1">
                  <span>watermark #{w.lastMessageId ?? '—'}</span>
                  <span>last check {ago(w.lastRunAt)}</span>
                  <span>{w.totalImported} imported total</span>
                  {w.lastError && <span className="text-rose-400 truncate max-w-[260px]">⚠ {w.lastError}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => act(w.id, 'run')}
                  disabled={runningId === w.id}
                  className="px-2.5 py-1.5 rounded-lg bg-cyan-950/60 border border-cyan-800 text-cyan-300 text-[10px] font-bold flex items-center gap-1 hover:bg-cyan-900/60 disabled:opacity-50"
                >
                  {runningId === w.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Run now
                </button>
                <button
                  onClick={() => act(w.id, 'toggle', w)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-bold flex items-center gap-1 hover:bg-slate-700"
                >
                  {w.enabled ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Resume</>}
                </button>
                <button
                  onClick={() => act(w.id, 'delete')}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-rose-300 hover:border-rose-800 text-[10px] font-bold flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
