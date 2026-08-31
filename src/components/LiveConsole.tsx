import React, { useState, useEffect, useRef } from 'react';
import { Terminal, ArrowRight, CheckCircle, Trash2, Download, Search, Radio, Send, Clock, AlertCircle } from 'lucide-react';
import { ActivityLog } from '../types';

interface LiveConsoleProps {
  logs: ActivityLog[];
  onClearLogs: () => void;
  isEngineRunning: boolean;
}

export const LiveConsole: React.FC<LiveConsoleProps> = ({ logs, onClearLogs, isEngineRunning }) => {
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [liveLogs, setLiveLogs] = useState<ActivityLog[]>(logs);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep a local copy so the console can recover delivery events even if an
  // SSE reconnect happens between the Telegram event and the browser update.
  useEffect(() => {
    setLiveLogs((current) => {
      const byId = new Map(current.map((log) => [log.id, log]));
      for (const log of logs) byId.set(log.id, log);
      return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp).slice(-500);
    });
  }, [logs]);

  // Poll the same authenticated log endpoint as a reliability fallback for
  // missed SSE events. This is intentionally lightweight and stops when the
  // console component is unmounted.
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/logs', { cache: 'no-store' });
        if (!response.ok || !mounted) return;
        const data = await response.json();
        if (Array.isArray(data)) {
          setLiveLogs((current) => {
            const byId = new Map(current.map((log: ActivityLog) => [log.id, log]));
            for (const log of data as ActivityLog[]) byId.set(log.id, log);
            return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp).slice(-500);
          });
        }
      } catch {
        // SSE remains the primary transport; polling is only a recovery path.
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [liveLogs, autoScroll]);

  const filteredLogs = liveLogs.filter((log) => {
    if (filterCategory !== 'all' && log.category !== filterCategory) return false;
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return log.title.toLowerCase().includes(q) ||
        log.message.toLowerCase().includes(q) ||
        (log.sourceTitle && log.sourceTitle.toLowerCase().includes(q)) ||
        (log.targetTitle && log.targetTitle.toLowerCase().includes(q)) ||
        (log.messageSnippet && log.messageSnippet.toLowerCase().includes(q));
    }
    return true;
  });

  const forwardLogs = liveLogs.filter((log) => log.category === 'forward');
  const publishedLogs = forwardLogs.filter((log) => log.level === 'success' && /PUBLISHED|Forward Delivered|Manual Post Forward/i.test(log.title));
  const failedLogs = forwardLogs.filter((log) => log.level === 'error');
  const latestDelivery = [...publishedLogs].sort((a, b) => b.timestamp - a.timestamp)[0];

  const getCategoryBadge = (category: ActivityLog['category']) => {
    switch (category) {
      case 'forward': return <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-mono font-bold">FORWARD</span>;
      case 'duplicate': return <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[10px] font-mono font-bold">DUPLICATE</span>;
      case 'filter': return <span className="px-2 py-0.5 rounded bg-orange-950 text-orange-300 border border-orange-800 text-[10px] font-mono font-bold">FILTERED</span>;
      case 'auth': return <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px] font-mono font-bold">AUTH</span>;
      case 'discovery': return <span className="px-2 py-0.5 rounded bg-violet-950 text-violet-300 border border-violet-800 text-[10px] font-mono font-bold">DISCOVERY</span>;
      default: return <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-mono font-bold">SYSTEM</span>;
    }
  };

  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(liveLogs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tgforwarder-logs-${new Date().toISOString().replace(/:/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearLogs = async () => {
    await onClearLogs();
    setLiveLogs([]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-cyan-400" />
            <h1 className="text-lg font-bold text-white tracking-tight">Live Activity Telemetry Stream</h1>
            {isEngineRunning && <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded-full border border-emerald-800 font-mono"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />Streaming</span>}
          </div>
          <p className="text-xs text-slate-400">Real Telegram activity: capture → queue → processing → send → delivery confirmation.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setAutoScroll(!autoScroll)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${autoScroll ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>{autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}</button>
          <button onClick={exportLogs} disabled={liveLogs.length === 0} className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold flex items-center gap-1.5"><Download className="w-3.5 h-3.5 text-cyan-400" />Export</button>
          <button onClick={clearLogs} disabled={liveLogs.length === 0} className="px-3 py-1.5 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-900/40 text-red-300 text-xs font-semibold flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" />Clear</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/20 p-4"><div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold"><Send className="w-4 h-4" />DELIVERED</div><div className="text-2xl font-bold text-white mt-1">{publishedLogs.length}</div><div className="text-[11px] text-slate-500">Confirmed forwarding events in this session</div></div>
        <div className="rounded-2xl border border-amber-900/50 bg-amber-950/20 p-4"><div className="flex items-center gap-2 text-amber-300 text-xs font-semibold"><Clock className="w-4 h-4" />FORWARD EVENTS</div><div className="text-2xl font-bold text-white mt-1">{forwardLogs.length}</div><div className="text-[11px] text-slate-500">Detected, queued, processed and delivery events</div></div>
        <div className="rounded-2xl border border-red-900/50 bg-red-950/20 p-4"><div className="flex items-center gap-2 text-red-300 text-xs font-semibold"><AlertCircle className="w-4 h-4" />FAILED</div><div className="text-2xl font-bold text-white mt-1">{failedLogs.length}</div><div className="text-[11px] text-slate-500">Forward delivery failures</div></div>
      </div>

      {latestDelivery && (
        <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/20 p-4">
          <div className="flex items-center gap-2 text-emerald-300 text-xs font-bold mb-2"><CheckCircle className="w-4 h-4" />LATEST CONFIRMED DELIVERY</div>
          <div className="text-sm text-white font-semibold">{latestDelivery.message}</div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] mt-2 text-slate-400">
            <span>{new Date(latestDelivery.timestamp).toLocaleString()}</span>
            {latestDelivery.sourceTitle && <><span>•</span><span className="text-cyan-300">{latestDelivery.sourceTitle}</span></>}
            {latestDelivery.targetTitle && <><ArrowRight className="w-3 h-3" /><span className="text-emerald-300">{latestDelivery.targetTitle}</span></>}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-72"><Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" /><input type="text" placeholder="Search forwarding activity..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500" /></div>
        <div className="flex space-x-1 p-1 bg-slate-900/80 rounded-xl border border-slate-800 text-xs font-medium overflow-x-auto w-full sm:w-auto">
          {[['all','All Logs'],['forward','Forwarding'],['discovery','Discovery'],['duplicate','Duplicates'],['filter','Filtered'],['auth','Auth'],['system','System']].map(([id,label]) => <button key={id} onClick={() => setFilterCategory(id)} className={`px-3 py-1 rounded-lg whitespace-nowrap ${filterCategory === id ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}>{label}</button>)}
        </div>
      </div>

      <div className="rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/80 border-b border-slate-800 text-xs"><div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-500/80" /><span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" /><span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" /><span className="text-slate-400 font-mono ml-2 text-[11px]">telemetry.stream.log</span></div><span className="text-[11px] font-mono text-slate-500">{filteredLogs.length} events logged</span></div>
        <div className="p-4 font-mono text-xs max-h-[560px] overflow-y-auto space-y-2">
          {filteredLogs.length === 0 ? <div className="p-12 text-center text-slate-600 space-y-2"><Terminal className="w-8 h-8 mx-auto opacity-50" /><p>No activity logs recorded yet in this filter view.</p><p className="text-[11px]">When a monitored source receives a Telegram message, the forwarding lifecycle will appear here.</p></div> : filteredLogs.map((log) => {
            const isPublished = log.level === 'success' && /PUBLISHED|Forward Delivered|Manual Post Forward/i.test(log.title);
            return <div key={log.id} onClick={() => setSelectedLog(log)} className={`p-3 rounded-xl border transition-all cursor-pointer space-y-1.5 ${isPublished ? 'bg-emerald-950/20 border-emerald-800/50 hover:border-emerald-600' : 'bg-slate-900/40 border-slate-800/60 hover:bg-slate-900 hover:border-slate-700'}`}>
              <div className="flex items-center justify-between gap-2 text-[11px]"><div className="flex items-center gap-2 flex-wrap"><span className="text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>{getCategoryBadge(log.category)}<span className={`font-bold ${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-amber-400' : log.level === 'success' ? 'text-emerald-300' : 'text-cyan-300'}`}>{log.title}</span></div>{log.messageSnippet && <span className="text-[10px] text-slate-500 truncate max-w-[220px] hidden md:inline">"{log.messageSnippet}"</span>}</div>
              <p className="text-slate-300 text-xs font-sans leading-relaxed">{log.message}</p>
              {(log.sourceTitle || log.targetTitle || log.sourceId || log.targetId) && <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400 pt-1 border-t border-slate-800/40">{log.sourceTitle && <span className="flex items-center gap-1 text-cyan-300/80"><Radio className="w-3 h-3" />Source: {log.sourceTitle}</span>}{log.sourceId && <span className="text-slate-600 font-mono">{log.sourceId}</span>}{log.sourceTitle && log.targetTitle && <ArrowRight className="w-3 h-3 text-slate-600" />}{log.targetTitle && <span className="flex items-center gap-1 text-emerald-300/80"><CheckCircle className="w-3 h-3" />Target: {log.targetTitle}</span>}{log.targetId && <span className="text-slate-600 font-mono">{log.targetId}</span>}</div>}
            </div>;
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      {selectedLog && <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"><div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4 text-slate-200"><div className="flex items-center justify-between border-b border-slate-800 pb-3"><div className="flex items-center gap-2">{getCategoryBadge(selectedLog.category)}<h3 className="text-sm font-bold text-white">{selectedLog.title}</h3></div><button onClick={() => setSelectedLog(null)} className="px-2 py-1 rounded bg-slate-800 text-xs text-slate-400 hover:text-white">Close</button></div><div className="space-y-3 text-xs"><div><span className="text-slate-500 block mb-1">Timestamp:</span><span className="font-mono text-slate-300">{new Date(selectedLog.timestamp).toLocaleString()}</span></div><div><span className="text-slate-500 block mb-1">Details:</span><p className="text-slate-200 p-2.5 rounded-lg bg-slate-950 border border-slate-800 leading-relaxed font-sans">{selectedLog.message}</p></div>{selectedLog.messageSnippet && <div><span className="text-slate-500 block mb-1">Message Content:</span><pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto">{selectedLog.messageSnippet}</pre></div>}<div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800"><div><span className="text-slate-500 block">Source:</span><span className="text-cyan-300 font-semibold">{selectedLog.sourceTitle || 'N/A'}</span>{selectedLog.sourceId && <span className="text-[10px] font-mono text-slate-500 block">{selectedLog.sourceId}</span>}</div><div><span className="text-slate-500 block">Target:</span><span className="text-emerald-300 font-semibold">{selectedLog.targetTitle || 'N/A'}</span>{selectedLog.targetId && <span className="text-[10px] font-mono text-slate-500 block">{selectedLog.targetId}</span>}</div></div></div></div></div>}
    </div>
  );
};