import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Clock, Download, Edit3, FileAudio, FileText, FileVideo, Globe,
  Image as ImageIcon, Inbox, Link2, Loader2, Mic, RefreshCw, Send, Sticker, Trash2,
  Ban, RotateCcw, Sparkles, X, XCircle
} from 'lucide-react';
import { AuthState, DiscoveredChat, FetcherJob, FetcherItem, FetcherMediaType } from '../types';
import { withTokenParam } from '../lib/authToken';
import { AutoImportPanel } from './AutoImportPanel';
import { ChannelCrawler } from './ChannelCrawler';

interface Props {
  chats: DiscoveredChat[];
  authState: AuthState;
  onOpenAuth: () => void;
  onScanChats: () => void;
}

const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
};

/** Authenticated media preview URLs (token goes in the query string — media tags can't send headers). */
const previewUrl = (chatRef: string, messageId: number): string =>
  withTokenParam(`/api/history/media?sourceId=${encodeURIComponent(chatRef)}&messageId=${messageId}`);
const thumbUrl = (chatRef: string, messageId: number): string =>
  withTokenParam(`/api/history/media/thumbnail?sourceId=${encodeURIComponent(chatRef)}&messageId=${messageId}`);

const PREVIEWABLE_TYPES: FetcherMediaType[] = ['photo', 'video', 'animation', 'sticker'];

const mediaIcon = (type: FetcherMediaType, className = 'w-3.5 h-3.5'): React.ReactElement => {
  switch (type) {
    case 'photo': return <ImageIcon className={`${className} text-emerald-400`} />;
    case 'video': case 'animation': return <FileVideo className={`${className} text-violet-400`} />;
    case 'audio': return <FileAudio className={`${className} text-amber-400`} />;
    case 'voice': return <Mic className={`${className} text-amber-400`} />;
    case 'sticker': return <Sticker className={`${className} text-pink-400`} />;
    case 'document': return <FileText className={`${className} text-cyan-400`} />;
    case 'text': return <FileText className={`${className} text-slate-400`} />;
    default: return <Globe className={`${className} text-slate-400`} />;
  }
};

const jobStatusChip = (status: FetcherJob['status']) => {
  const map: Record<FetcherJob['status'], { label: string; cls: string }> = {
    queued: { label: 'QUEUED', cls: 'bg-slate-800 border-slate-600 text-slate-300' },
    running: { label: 'RUNNING', cls: 'bg-cyan-950 border-cyan-700 text-cyan-300' },
    completed: { label: 'COMPLETED', cls: 'bg-emerald-950 border-emerald-700 text-emerald-300' },
    partial: { label: 'PARTIAL', cls: 'bg-amber-950 border-amber-700 text-amber-300' },
    failed: { label: 'FAILED', cls: 'bg-rose-950 border-rose-800 text-rose-300' },
    cancelled: { label: 'CANCELLED', cls: 'bg-slate-900 border-slate-700 text-slate-400' },
  };
  const chip = map[status];
  return <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${chip.cls}`}>{chip.label}</span>;
};

const itemStatusChip = (item: FetcherItem) => {
  const map: Record<FetcherItem['status'], { label: string; cls: string; icon: React.ReactElement }> = {
    queued: { label: 'Queued', cls: 'bg-slate-800/80 border-slate-700 text-slate-400', icon: <Clock className="w-3 h-3" /> },
    processing: { label: 'Fetching', cls: 'bg-cyan-950/80 border-cyan-800 text-cyan-300', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    delivered: { label: 'Done', cls: 'bg-emerald-950/80 border-emerald-800 text-emerald-300', icon: <CheckCircle2 className="w-3 h-3" /> },
    failed: { label: 'Failed', cls: 'bg-rose-950/80 border-rose-800 text-rose-300', icon: <XCircle className="w-3 h-3" /> },
    skipped: { label: 'Skipped', cls: 'bg-slate-900 border-slate-700 text-slate-500', icon: <Ban className="w-3 h-3" /> },
  };
  const chip = map[item.status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${chip.cls}`}>
      {chip.icon}{chip.label}
    </span>
  );
};

export const FetcherPanel: React.FC<Props> = ({ chats, authState, onOpenAuth, onScanChats }) => {
  const [linksText, setLinksText] = useState('');
  const [sendToTelegram, setSendToTelegram] = useState(true);
  const [saveForDownload, setSaveForDownload] = useState(true);
  const [targetId, setTargetId] = useState('me');
  const [jobs, setJobs] = useState<FetcherJob[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [editorItem, setEditorItem] = useState<{ job: FetcherJob; item: FetcherItem } | null>(null);
  const [editorMeta, setEditorMeta] = useState<any>(null);
  const [editorText, setEditorText] = useState('');
  const [editorTarget, setEditorTarget] = useState('me');
  const [editorLoading, setEditorLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editorNotice, setEditorNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const connected = authState.status === 'connected';
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshJobs = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoadingJobs(true);
    try {
      const res = await fetch('/api/fetcher/jobs?limit=30', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch {
      // transient — next poll will recover
    } finally {
      if (showSpinner) setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    void refreshJobs(true);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshJobs();
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refreshJobs]);

  const sendableChats = useMemo(
    () => chats.filter((c) => c.canSendMessages !== false),
    [chats]
  );

  const parsedLinkCount = useMemo(() => {
    const chunks = linksText.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    return chunks.filter((s) => /t\.me\//.test(s) || /telegram\.me\//.test(s)).length;
  }, [linksText]);

  const submit = async () => {
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch('/api/fetcher/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          links: linksText.split('\n').map((l) => l.trim()).filter(Boolean),
          sendToTelegram,
          saveForDownload,
          targetId: sendToTelegram ? targetId : undefined,
          targetTitle: sendToTelegram ? (targetId === 'me' ? 'Saved Messages' : sendableChats.find((c) => c.id === targetId)?.title) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create the fetch job.');
      setLinksText('');
      setNotice({ ok: true, text: 'Fetch job queued — the worker is picking it up now.' });
      void refreshJobs(true);
    } catch (err: any) {
      setNotice({ ok: false, text: err.message || 'Failed to create the fetch job.' });
    } finally {
      setSubmitting(false);
    }
  };

  const act = async (jobId: string, action: 'cancel' | 'retry' | 'delete') => {
    try {
      const res = await fetch(`/api/fetcher/jobs/${encodeURIComponent(jobId)}${action === 'cancel' ? '/cancel' : action === 'retry' ? '/retry' : ''}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || `Failed to ${action} job.`);
      setNotice({ ok: true, text: data.message || 'Done.' });
      void refreshJobs();
    } catch (err: any) {
      setNotice({ ok: false, text: err.message });
    }
  };

  const openEditor = async (job: FetcherJob, item: FetcherItem) => {
    setEditorItem({ job, item });
    setEditorText(item.snippet || '');
    setEditorTarget(job.options.sendToTelegram ? job.options.targetId : 'me');
    setEditorNotice(null);
    setEditorMeta(null);
    setEditorLoading(true);
    try {
      const res = await fetch(`/api/fetcher/message?chat=${encodeURIComponent(item.chatRef)}&msg=${item.messageId}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load the message from Telegram.');
      setEditorMeta(data);
      setEditorText(data.text || '');
    } catch (err: any) {
      setEditorNotice({ ok: false, text: err.message });
    } finally {
      setEditorLoading(false);
    }
  };

  const publishEdit = async () => {
    if (!editorItem) return;
    setPublishing(true);
    setEditorNotice(null);
    try {
      const res = await fetch('/api/history/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: editorItem.item.chatRef, messageId: editorItem.item.messageId, targetIds: [editorTarget], text: editorText }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Telegram publish failed.');
      const targetTitle = editorTarget === 'me' ? 'Saved Messages' : (sendableChats.find((c) => c.id === editorTarget)?.title || editorTarget);
      const resolved = editorItem.job.id;
      const resolvedItem = editorItem.item.id;
      setJobs((prev) => prev.map((j) => j.id === resolved ? { ...j, items: j.items.map((i) => i.id === resolvedItem ? { ...i, deliveredTo: targetTitle } : i) } : j));
      setEditorNotice({ ok: true, text: `Published to ${targetTitle}.` });
    } catch (err: any) {
      setEditorNotice({ ok: false, text: err.message });
    } finally {
      setPublishing(false);
    }
  };

  if (!connected) {
    return (
      <div className="p-6 sm:p-10 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4">
        <Inbox className="w-10 h-10 mx-auto text-slate-600" />
        <div>
          <h2 className="text-lg font-bold text-white">Restricted Fetcher</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            The worker uses the connected Telegram account to fetch posts from message links — including
            chats that block forwarding and private <code className="text-cyan-400">t.me/c/…</code> links.
            Connect an account to activate it.
          </p>
        </div>
        <button onClick={onOpenAuth} className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold inline-flex items-center gap-2">
          <Link2 className="w-3.5 h-3.5" /> Connect Telegram
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5 w-full min-w-0">
      {/* Header */}
      <div className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-600/30 to-blue-600/20 border border-cyan-500/30 shrink-0">
            <Link2 className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              Restricted Fetcher
              <span className="rounded border border-emerald-800/60 bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-mono text-emerald-400">WORKER ONLINE</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Paste Telegram message links — the worker fetches each post with your connected account and
              delivers it to a target chat and/or stores it here for download. Restricted (no-forward) and
              private sources are handled with a clean repost.
            </p>
          </div>
        </div>
      </div>

      {/* Channel media crawler — browse a source's history and download/deliver its files */}
      <ChannelCrawler chats={chats} />

      {/* New job */}
      <div className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Message links — one per line</label>
          <span className={`text-[10px] font-mono ${parsedLinkCount > 0 ? 'text-cyan-400' : 'text-slate-600'}`}>{parsedLinkCount} detected</span>
        </div>
        <textarea
          value={linksText}
          onChange={(e) => setLinksText(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={'https://t.me/somechannel/1234\nhttps://t.me/c/1234567890/567\nhttps://t.me/c/1234567890/15/418'}
          className="w-full px-3 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-cyan-500 placeholder:text-slate-700"
        />
        <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-500">
          <span className="px-2 py-1 rounded-md bg-slate-950 border border-slate-800 font-mono">t.me/&#123;channel&#125;/&#123;post&#125;</span>
          <span className="px-2 py-1 rounded-md bg-slate-950 border border-slate-800 font-mono">t.me/c/&#123;id&#125;/&#123;post&#125; <span className="text-slate-600">(private)</span></span>
          <span className="px-2 py-1 rounded-md bg-slate-950 border border-slate-800 font-mono">t.me/&#123;channel&#125;/&#123;topic&#125;/&#123;post&#125; <span className="text-slate-600">(topic)</span></span>
        </div>

        {/* Delivery options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setSaveForDownload((v) => !v)}
            className={`text-left p-3 rounded-xl border text-xs transition-colors ${saveForDownload ? 'bg-cyan-950/60 border-cyan-600 text-cyan-200' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'}`}
          >
            <div className="flex items-center gap-2 font-bold">
              <Download className="w-3.5 h-3.5" /> Save for download
              <span className={`ml-auto w-7 h-4 rounded-full relative transition-colors ${saveForDownload ? 'bg-cyan-500' : 'bg-slate-700'}`}>
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${saveForDownload ? 'left-3.5' : 'left-0.5'}`} />
              </span>
            </div>
            <p className="mt-1 opacity-70">Media is downloaded server-side; download buttons appear below.</p>
          </button>
          <button
            type="button"
            onClick={() => setSendToTelegram((v) => !v)}
            className={`text-left p-3 rounded-xl border text-xs transition-colors ${sendToTelegram ? 'bg-cyan-950/60 border-cyan-600 text-cyan-200' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'}`}
          >
            <div className="flex items-center gap-2 font-bold">
              <Send className="w-3.5 h-3.5" /> Send to Telegram
              <span className={`ml-auto w-7 h-4 rounded-full relative transition-colors ${sendToTelegram ? 'bg-cyan-500' : 'bg-slate-700'}`}>
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${sendToTelegram ? 'left-3.5' : 'left-0.5'}`} />
              </span>
            </div>
            <p className="mt-1 opacity-70">Clean repost to the destination below — no "forwarded from" header.</p>
          </button>
        </div>

        <div className={`flex flex-col sm:flex-row gap-2 ${sendToTelegram ? '' : 'opacity-50 pointer-events-none'}`}>
          <div className="flex-1">
            <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Telegram destination</label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="me">Saved Messages (you)</option>
              {targetId && targetId !== 'me' && !sendableChats.some((c) => c.id === targetId) && (
                <option value={targetId}>Saved destination ({targetId})</option>
              )}
              {sendableChats.map((c) => (
                <option key={c.id} value={c.id}>{c.title}{c.username ? ` (${c.username})` : ` (${c.id})`}</option>
              ))}
            </select>
          </div>
          <button
            onClick={onScanChats}
            className="self-end px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold flex items-center gap-2 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh chats
          </button>
        </div>

        {notice && (
          <div className={`p-3 rounded-xl border text-xs flex gap-2 ${notice.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-rose-950/40 border-rose-800 text-rose-300'}`}>
            {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            {notice.text}
          </div>
        )}

        <button
          onClick={submit}
          disabled={submitting || !linksText.trim() || (!sendToTelegram && !saveForDownload)}
          className="w-full px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-cyan-950/40"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {submitting ? 'Queueing…' : 'Run Fetch Worker'}
        </button>
      </div>

      {/* Jobs */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-2"><Inbox className="w-4 h-4 text-cyan-400" /> Fetch Jobs</h3>
        <button onClick={() => refreshJobs(true)} className="text-[11px] text-slate-400 hover:text-cyan-300 flex items-center gap-1.5">
          <RefreshCw className={`w-3 h-3 ${loadingJobs ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="p-10 text-center rounded-2xl bg-slate-900 border border-slate-800 text-xs text-slate-500">
          No fetch jobs yet. Paste message links above and run the worker.
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const done = job.stats.delivered + job.stats.failed + job.stats.skipped;
            const pct = job.stats.total ? Math.round((done / job.stats.total) * 100) : 0;
            const active = job.status === 'queued' || job.status === 'running';
            return (
              <div key={job.id} className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-lg">
                {/* Job header */}
                <div className="px-4 py-3 bg-slate-950/60 border-b border-slate-800 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    {jobStatusChip(job.status)}
                    <span className="font-mono text-slate-500">{job.id}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-500">{new Date(job.createdAt).toLocaleString()}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-400">
                      {job.stats.delivered}/{job.stats.total} delivered
                      {job.stats.failed > 0 && <span className="text-rose-400"> · {job.stats.failed} failed</span>}
                    </span>
                    <span className="ml-auto flex items-center gap-1.5">
                      {active && <button onClick={() => act(job.id, 'cancel')} className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[10px] font-bold">Cancel</button>}
                      {!active && job.stats.failed + job.stats.skipped > 0 && job.stats.failed + job.stats.skipped > job.items.filter((i) => i.messageId === 0).length && (
                        <button onClick={() => act(job.id, 'retry')} className="px-2.5 py-1 rounded-lg bg-amber-950 hover:bg-amber-900 border border-amber-800 text-amber-300 text-[10px] font-bold flex items-center gap-1"><RotateCcw className="w-3 h-3" />Retry failed</button>
                      )}
                      <button onClick={() => act(job.id, 'delete')} className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-950 hover:border-rose-800 border border-slate-700 text-slate-300 hover:text-rose-300 text-[10px] font-bold flex items-center gap-1"><Trash2 className="w-3 h-3" />Delete</button>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${job.status === 'failed' ? 'bg-rose-500' : job.status === 'partial' ? 'bg-amber-500' : 'bg-gradient-to-r from-cyan-500 to-emerald-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                    {job.options.sendToTelegram && <span className="px-2 py-0.5 rounded-md bg-slate-800/80 text-slate-300">→ {job.options.targetTitle}</span>}
                    {job.options.saveForDownload && <span className="px-2 py-0.5 rounded-md bg-slate-800/80 text-slate-300">⬇ server download</span>}
                  </div>
                </div>
                {/* Items */}
                <div className="divide-y divide-slate-800/60">
                  {job.items.map((item) => (
                    <div key={item.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
                      <div className="shrink-0 flex sm:flex-col items-center gap-1.5 pt-0.5">
                        {item.messageId > 0 && item.status === 'delivered' && PREVIEWABLE_TYPES.includes(item.mediaType)
                          ? <img
                              src={thumbUrl(item.chatRef, item.messageId)}
                              alt=""
                              loading="lazy"
                              className="w-20 h-14 rounded-lg object-cover border border-slate-800 bg-slate-950"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                            />
                          : <div className="p-1.5">{mediaIcon(item.mediaType, 'w-4 h-4')}</div>}
                        {item.messageId > 0 && item.status !== 'processing' && (
                          <button
                            onClick={() => openEditor(job, item)}
                            title="Edit caption/text and publish to a target chat"
                            className="px-1.5 py-1 rounded-md bg-cyan-600/20 border border-cyan-700 text-cyan-300 hover:bg-cyan-600/30 text-[9px] font-bold flex items-center gap-1"
                          >
                            <Edit3 className="w-2.5 h-2.5" /> Edit
                          </button>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                          <span className="text-slate-200 font-semibold">{item.chatTitle}</span>
                          {item.messageId > 0 && <span className="font-mono text-slate-500">#{item.messageId}</span>}
                          <span className="text-slate-600 capitalize">{item.mediaType}</span>
                          {item.albumSize > 1 && <span className="text-violet-400">album ×{item.albumSize}</span>}
                          {item.fileSize ? <span className="text-slate-500">{formatBytes(item.fileSize)}</span> : null}
                          {item.fileName && item.mediaType !== 'text' && <span className="text-slate-600 truncate max-w-[180px]">{item.fileName}</span>}
                          <span className="ml-auto">{itemStatusChip(item)}</span>
                        </div>
                        {item.snippet && <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 whitespace-pre-wrap break-words">{item.snippet}</p>}
                        {item.error && <p className="text-[11px] text-rose-400 mt-1 break-words">{item.error}</p>}
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[10px]">
                          {item.deliveredTo && (
                            <span className="px-1.5 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-900 text-emerald-400">
                              sent → {item.deliveredTo}{item.deliveredMsgId ? ` · #${item.deliveredMsgId}` : ''}
                            </span>
                          )}
                          {item.downloadFiles.map((file) => (
                            <a
                              key={file}
                              href={withTokenParam(`/api/fetcher/download/${encodeURIComponent(job.id)}/${encodeURIComponent(item.id)}?file=${encodeURIComponent(file)}`)}
                              className="px-1.5 py-0.5 rounded-md bg-cyan-950/60 border border-cyan-900 text-cyan-300 hover:bg-cyan-900/60 inline-flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" />
                              {item.downloadFiles.length > 1 ? file.slice(0, 28) : 'Download'}
                            </a>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Auto-import watchers */}
      <AutoImportPanel chats={chats} authState={authState} />

      {/* Edit & Publish modal */}
      {editorItem && (() => {
        const { job, item } = editorItem;
        const modalType: string = editorMeta?.mediaType || item.mediaType;
        const modalSrc = item.chatRef && item.messageId > 0 ? previewUrl(item.chatRef, item.messageId) : '';
        const modalPoster = item.chatRef && item.messageId > 0 ? thumbUrl(item.chatRef, item.messageId) : '';
        const showPreview = editorMeta ? Boolean(editorMeta.hasMedia) : PREVIEWABLE_TYPES.includes(item.mediaType);
        return (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4" onClick={() => { if (!publishing) setEditorItem(null); }}>
            <div className="w-full max-w-3xl max-h-[94vh] overflow-auto rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-4 sm:p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white">Edit & Publish Post #{item.messageId}</h3>
                  <p className="text-xs text-slate-400 truncate">{item.chatTitle}{item.albumSize > 1 ? ` · album ×${item.albumSize} (publishes the main item)` : ''}</p>
                </div>
                <button onClick={() => { if (!publishing) setEditorItem(null); }} className="p-2 text-slate-400 hover:text-white shrink-0"><X className="w-5 h-5" /></button>
              </div>

              {editorNotice && (
                <div className={`p-3 rounded-xl border text-xs flex gap-2 ${editorNotice.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-rose-950/40 border-rose-800 text-rose-300'}`}>
                  {editorNotice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                  {editorNotice.text}
                </div>
              )}

              {editorLoading ? (
                <div className="w-full aspect-video max-h-[360px] rounded-xl bg-slate-800 animate-pulse" />
              ) : showPreview && modalType === 'photo' && (
                <div className="w-full max-h-[420px] rounded-xl overflow-hidden bg-black border border-slate-800 flex items-center justify-center">
                  <img src={modalSrc} alt="Telegram photo" loading="lazy" decoding="async" className="block max-w-full max-h-[420px] object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                </div>
              )}
              {!editorLoading && showPreview && (modalType === 'video' || modalType === 'animation') && (
                <div className="relative w-full max-h-[420px] aspect-video rounded-xl overflow-hidden bg-black border border-slate-800">
                  <video src={modalSrc} controls preload="metadata" playsInline poster={modalPoster || undefined} className="block w-full h-full object-contain" />
                </div>
              )}
              {!editorLoading && showPreview && (modalType === 'audio' || modalType === 'voice') && (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-3">
                  <FileAudio className="w-5 h-5 text-amber-400 shrink-0" />
                  <audio controls preload="metadata" src={modalSrc} className="w-full" />
                </div>
              )}
              {!editorLoading && showPreview && modalType !== 'photo' && modalType !== 'video' && modalType !== 'animation' && modalType !== 'audio' && modalType !== 'voice' && (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-3">
                  <FileText className="w-5 h-5 text-cyan-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-slate-200 truncate">{editorMeta?.fileName || item.fileName || 'Telegram file'}</div>
                    <div className="text-[10px] text-slate-500">{editorMeta?.mimeType || item.mimeType || 'media'}{editorMeta?.size ? ` · ${formatBytes(editorMeta.size)}` : ''}</div>
                  </div>
                  <a href={modalSrc} target="_blank" rel="noreferrer" className="ml-auto text-xs text-cyan-300 shrink-0">Open</a>
                </div>
              )}

              <textarea
                value={editorText}
                onChange={(e) => setEditorText(e.target.value)}
                rows={8}
                className="w-full px-3 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500"
                placeholder="Edit the caption/text before publishing…"
              />

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-1">Publish destination</label>
                  <select
                    value={editorTarget}
                    onChange={(e) => setEditorTarget(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="me">Saved Messages (you)</option>
                    {editorTarget && editorTarget !== 'me' && !sendableChats.some((c) => c.id === editorTarget) && (
                      <option value={editorTarget}>Saved destination ({editorTarget})</option>
                    )}
                    {sendableChats.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}{c.username ? ` (${c.username})` : ` (${c.id})`}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col-reverse sm:flex-row sm:items-end gap-2">
                  <button onClick={() => setEditorItem(null)} disabled={publishing} className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold">Close</button>
                  <button onClick={publishEdit} disabled={publishing || editorLoading} className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2">
                    {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    {publishing ? 'Publishing…' : 'Publish to Target'}
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-slate-600">Publishing re-sends the original media with your edited text as a clean repost — no “forwarded from” header, so restricted sources work.</p>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
