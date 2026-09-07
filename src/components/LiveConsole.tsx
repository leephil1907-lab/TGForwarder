import React, { useEffect, useRef, useState } from 'react';
import { Activity, AlarmClock, AlertCircle, ArrowRight, CheckCircle, Clock, Cpu, Download, Link2, Radio, Search, Send, Terminal, Trash2, Zap } from 'lucide-react';
import { ActivityLog, AuthState } from '../types';

interface LiveConsoleProps {
  logs: ActivityLog[];
  onClearLogs: () => void;
  isEngineRunning: boolean;
  authState: AuthState;
}

interface HealthSnapshot {
  authStatus?: string;
  authenticated?: boolean;
  engineRunning?: boolean;
  isPaused?: boolean;
  userProfile?: { firstName?: string; username?: string } | null;
  fetcher?: { total: number; active: number; lastJobAt: number | null };
  autoImport?: { total: number; active: number };
  timestamp?: number;
}

const mergeLogs = (current: ActivityLog[], incoming: ActivityLog[]): ActivityLog[] => {
  const byId = new Map<string, ActivityLog>();
  current.forEach((log) => byId.set(log.id, log));
  incoming.forEach((log) => byId.set(log.id, log));
  return Array.from(byId.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-500);
};

const CATEGORY_FILTERS = ['all', 'forward', 'fetcher', 'discovery', 'duplicate', 'filter', 'auth', 'system'] as const;

export const LiveConsole: React.FC<LiveConsoleProps> = ({ logs, onClearLogs, isEngineRunning, authState }) => {
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [liveLogs, setLiveLogs] = useState<ActivityLog[]>(logs);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLiveLogs((current) => mergeLogs(current, logs));
  }, [logs]);

  // Recovery polling (SSE is the primary transport) + system status snapshot.
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/logs', { cache: 'no-store' });
        if (!response.ok || !mounted) return;
        const data: unknown = await response.json();
        if (Array.isArray(data)) {
          setLiveLogs((current) => mergeLogs(current, data as ActivityLog[]));
        }
      } catch {
        // SSE remains the primary transport; polling is only recovery.
      }
    };
    const refreshHealth = async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        if (!response.ok || !mounted) return;
        setHealth((await response.json()) as HealthSnapshot);
      } catch {
        // transient
      }
    };
    void refresh();
    void refreshHealth();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    const healthTimer = window.setInterval(() => { void refreshHealth(); }, 5000);
    return () => { mounted = false; window.clearInterval(timer); window.clearInterval(healthTimer); };
  }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [liveLogs, autoScroll]);

  const filteredLogs = liveLogs.filter((log) => {
    if (filterCategory !== 'all' && log.category !== filterCategory) return false;
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [log.title, log.message, log.sourceTitle, log.targetTitle, log.messageSnippet]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });

  const forwardLogs = liveLogs.filter((log) => log.category === 'forward');
  const fetcherLogs = liveLogs.filter((log) => log.category === 'fetcher');
  const publishedLogs = forwardLogs.filter((log) => log.level === 'success' && /PUBLISHED|Forward Delivered|Manual Post Forward|Restricted Post Fetched/i.test(log.title));
  const fetchedLogs = fetcherLogs.filter((log) => log.level === 'success' && /Fetched|Fetch Job/i.test(log.title));
  const failedLogs = liveLogs.filter((log) => log.level === 'error');
  const latestDelivery = [...publishedLogs].sort((a, b) => b.timestamp - a.timestamp)[0];
  const newestLogAge = liveLogs.length ? Date.now() - liveLogs[liveLogs.length - 1].timestamp : Infinity;
  const streamLive = newestLogAge < 30000;

  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(liveLogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tgforwarder-logs-${new Date().toISOString().replace(/:/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearLogs = async () => {
    await onClearLogs();
    setLiveLogs([]);
  };

  const badge = (category: ActivityLog['category']) => {
    const labels: Record<ActivityLog['category'], string> = {
      forward: 'FORWARD', duplicate: 'DUPLICATE', filter: 'FILTERED',
      auth: 'AUTH', discovery: 'DISCOVERY', system: 'SYSTEM', fetcher: 'FETCHER'
    };
    const styles: Record<ActivityLog['category'], string> = {
      forward: 'bg-slate-800 text-slate-300 border-slate-700',
      duplicate: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
      filter: 'bg-purple-950/60 text-purple-300 border-purple-800/60',
      auth: 'bg-sky-950/60 text-sky-300 border-sky-800/60',
      discovery: 'bg-teal-950/60 text-teal-300 border-teal-800/60',
      system: 'bg-slate-800 text-slate-400 border-slate-700',
      fetcher: 'bg-cyan-950/70 text-cyan-300 border-cyan-700/70'
    };
    return <span className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${styles[category]}`}>{labels[category]}</span>;
  };

  const telegramConnected = authState.status === 'connected' && Boolean(authState.userProfile);
  const activeFetchJobs = health?.fetcher?.active ?? 0;

  const statusPill = (opts: { icon: React.ReactElement; label: string; value: string; ok: boolean; neutral?: boolean }) => (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] font-semibold ${opts.ok ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300' : opts.neutral ? 'bg-slate-900 border-slate-800 text-slate-400' : 'bg-rose-950/30 border-rose-900/60 text-rose-300'}`}>
      <span className={opts.ok ? 'text-emerald-400' : opts.neutral ? 'text-slate-500' : 'text-rose-400'}>{opts.icon}</span>
      <span className="text-slate-500 uppercase tracking-wide text-[9px]">{opts.label}</span>
      <span className={opts.ok ? 'text-emerald-300' : opts.neutral ? 'text-slate-300' : 'text-rose-300'}>{opts.value}</span>
      {opts.ok && <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-cyan-400" />
            <h1 className="text-lg font-bold text-white">Live Activity Telemetry Stream</h1>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-mono flex items-center gap-1.5 ${streamLive ? 'text-emerald-400 bg-emerald-950 border-emerald-800' : 'text-slate-500 bg-slate-900 border-slate-800'}`}>
              {streamLive && <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>}
              {streamLive ? 'LIVE' : 'IDLE'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Real Telegram activity: capture → queue → processing → send → delivery confirmation.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setAutoScroll((value) => !value)} className="px-3 py-1.5 rounded-xl text-xs font-semibold border bg-slate-800 text-slate-300">Auto-scroll {autoScroll ? 'ON' : 'OFF'}</button>
          <button onClick={exportLogs} disabled={!liveLogs.length} className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"><Download className="w-3.5 h-3.5" />Export</button>
          <button onClick={() => void clearLogs()} disabled={!liveLogs.length} className="px-3 py-1.5 rounded-xl bg-red-950/40 border border-red-900/40 text-red-300 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" />Clear</button>
        </div>
      </div>

      {/* System status — is the script fully active and running? */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {statusPill({
          icon: <Link2 className="w-3.5 h-3.5" />,
          label: 'Telegram',
          value: telegramConnected ? `Connected${authState.userProfile?.firstName ? ` · ${authState.userProfile.firstName}` : ''}` : (authState.status === 'connecting' ? 'Connecting…' : 'Disconnected'),
          ok: telegramConnected,
          neutral: authState.status === 'connecting',
        })}
        {statusPill({
          icon: <Zap className="w-3.5 h-3.5" />,
          label: 'Forward engine',
          value: isEngineRunning ? (health?.isPaused ? 'Paused' : 'Running') : 'Stopped',
          ok: isEngineRunning && !health?.isPaused,
          neutral: !isEngineRunning,
        })}
        {statusPill({
          icon: <Cpu className="w-3.5 h-3.5" />,
          label: 'Fetch worker',
          value: activeFetchJobs > 0 ? `${activeFetchJobs} active job${activeFetchJobs > 1 ? 's' : ''}` : `${health?.fetcher?.total ?? 0} jobs · idle`,
          ok: activeFetchJobs > 0,
          neutral: activeFetchJobs === 0,
        })}
        {statusPill({
          icon: <AlarmClock className="w-3.5 h-3.5" />,
          label: 'Auto-import',
          value: (health?.autoImport?.active ?? 0) > 0 ? `${health?.autoImport?.active} watching` : `${health?.autoImport?.total ?? 0} watchers`,
          ok: (health?.autoImport?.active ?? 0) > 0,
          neutral: (health?.autoImport?.active ?? 0) === 0,
        })}
        {statusPill({
          icon: <Activity className="w-3.5 h-3.5" />,
          label: 'Telemetry',
          value: streamLive ? 'Streaming' : 'Waiting for events',
          ok: streamLive,
          neutral: !streamLive,
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/20 p-4"><div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold"><Send className="w-4 h-4" />DELIVERED</div><div className="text-2xl font-bold text-white mt-1">{publishedLogs.length}</div></div>
        <div className="rounded-2xl border border-cyan-900/50 bg-cyan-950/20 p-4"><div className="flex items-center gap-2 text-cyan-300 text-xs font-semibold"><Download className="w-4 h-4" />FETCHED</div><div className="text-2xl font-bold text-white mt-1">{fetchedLogs.length}</div></div>
        <div className="rounded-2xl border border-amber-900/50 bg-amber-950/20 p-4"><div className="flex items-center gap-2 text-amber-300 text-xs font-semibold"><Clock className="w-4 h-4" />FORWARD EVENTS</div><div className="text-2xl font-bold text-white mt-1">{forwardLogs.length}</div></div>
        <div className="rounded-2xl border border-red-900/50 bg-red-950/20 p-4"><div className="flex items-center gap-2 text-red-300 text-xs font-semibold"><AlertCircle className="w-4 h-4" />FAILED</div><div className="text-2xl font-bold text-white mt-1">{failedLogs.length}</div></div>
      </div>

      {latestDelivery && <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/20 p-4"><div className="flex items-center gap-2 text-emerald-300 text-xs font-bold mb-2"><CheckCircle className="w-4 h-4" />LATEST CONFIRMED DELIVERY</div><div className="text-sm text-white font-semibold">{latestDelivery.message}</div><div className="flex flex-wrap items-center gap-2 text-[11px] mt-2 text-slate-400"><span>{new Date(latestDelivery.timestamp).toLocaleString()}</span>{latestDelivery.sourceTitle && <><span>•</span><span className="text-cyan-300">{latestDelivery.sourceTitle}</span></>}{latestDelivery.targetTitle && <><ArrowRight className="w-3 h-3" /><span className="text-emerald-300">{latestDelivery.targetTitle}</span></>}</div></div>}

      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between"><div className="relative w-full sm:w-72"><Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search forwarding activity..." className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500" /></div><div className="flex space-x-1 p-1 bg-slate-900/80 rounded-xl border border-slate-800 text-xs overflow-x-auto w-full sm:w-auto">{CATEGORY_FILTERS.map((id) => <button key={id} onClick={() => setFilterCategory(id)} className={`px-3 py-1 rounded-lg whitespace-nowrap ${filterCategory === id ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold' : 'text-slate-400'}`}>{id}</button>)}</div></div>

      <div className="flex justify-end"><div className="flex space-x-1 p-1 bg-slate-900/80 rounded-xl border border-slate-800 text-xs">{['all', 'success', 'warn', 'error', 'info'].map((level) => <button key={level} onClick={() => setFilterLevel(level)} className={`px-3 py-1 rounded-lg whitespace-nowrap capitalize ${filterLevel === level ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold' : 'text-slate-400'}`}>{level}</button>)}</div></div>

      <div className="rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden shadow-2xl"><div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/80 border-b border-slate-800 text-xs"><div className="flex items-center gap-2"><Radio className="w-3.5 h-3.5 text-cyan-400" /><span className="text-slate-400 font-mono text-[11px]">telemetry.stream.log</span></div><span className="text-[11px] font-mono text-slate-500">{filteredLogs.length} events</span></div><div className="p-4 font-mono text-xs max-h-[560px] overflow-y-auto space-y-2">{filteredLogs.length === 0 ? <div className="p-12 text-center text-slate-600"><Terminal className="w-8 h-8 mx-auto opacity-50 mb-2" />No activity logs recorded.</div> : filteredLogs.map((log) => <button key={log.id} type="button" onClick={() => setSelectedLog(log)} className={`w-full text-left p-3 rounded-xl border transition-all ${log.level === 'error' ? 'bg-rose-950/20 border-rose-900/50' : log.category === 'fetcher' ? 'bg-cyan-950/20 border-cyan-900/50' : log.level === 'success' ? 'bg-emerald-950/20 border-emerald-800/50' : 'bg-slate-900/40 border-slate-800/60'}`}><div className="flex items-center justify-between gap-2 text-[11px]"><div className="flex items-center gap-2 flex-wrap"><span className="text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>{badge(log.category)}<span className={log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-amber-400' : log.level === 'success' ? 'text-emerald-300' : 'text-cyan-300'}>{log.title}</span>{log.details?.jobId && <span className="text-slate-600 font-mono">job {String(log.details.jobId).slice(-6)}</span>}</div></div><p className="text-slate-300 text-xs font-sans leading-relaxed mt-1">{log.message}</p>{(log.sourceTitle || log.targetTitle) && <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400 pt-1 mt-1 border-t border-slate-800/40">{log.sourceTitle && <span className="text-cyan-300/80">Source: {log.sourceTitle}</span>}{log.sourceTitle && log.targetTitle && <ArrowRight className="w-3 h-3" />}{log.targetTitle && <span className="text-emerald-300/80">Target: {log.targetTitle}</span>}</div>}</button>)}<div ref={bottomRef} /></div></div>

      {selectedLog && <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80" onClick={() => setSelectedLog(null)}><div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4 text-slate-200" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div className="flex items-center gap-2">{badge(selectedLog.category)}<h3 className="text-sm font-bold text-white">{selectedLog.title}</h3></div><button type="button" onClick={() => setSelectedLog(null)} className="px-2 py-1 rounded bg-slate-800 text-xs text-slate-400">Close</button></div><div className="text-xs"><span className="text-slate-500 block mb-1">Timestamp</span><span className="font-mono">{new Date(selectedLog.timestamp).toLocaleString()}</span></div><div className="text-xs"><span className="text-slate-500 block mb-1">Details</span><p className="p-3 rounded-lg bg-slate-950 border border-slate-800 leading-relaxed">{selectedLog.message}</p></div>{selectedLog.messageSnippet && <div className="text-xs"><span className="text-slate-500 block mb-1">Message Content</span><pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 whitespace-pre-wrap max-h-40 overflow-y-auto">{selectedLog.messageSnippet}</pre></div>}</div></div>}
    </div>
  );
};
