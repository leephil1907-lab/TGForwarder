import React, { useState } from 'react';
import { FolderSearch, Loader2, Download, Send, FileVideo, FileText, FileAudio, Image as ImageIcon, Mic, Sticker, Globe, ChevronDown, Bot } from 'lucide-react';
import { DiscoveredChat } from '../types';
import { withTokenParam } from '../lib/authToken';

interface CrawlItem {
  messageId: number;
  date: number | null;
  type: 'photo' | 'video' | 'audio' | 'voice' | 'sticker' | 'document';
  fileName: string;
  mimeType: string;
  size: number;
  caption: string;
  mediaUrl: string;
  thumbUrl: string;
}

const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
};

const TypeIcon: React.FC<{ type: CrawlItem['type'] }> = ({ type }) => {
  const cls = 'w-4 h-4 text-cyan-400';
  if (type === 'video') return <FileVideo className={cls} />;
  if (type === 'audio') return <FileAudio className={cls} />;
  if (type === 'voice') return <Mic className={cls} />;
  if (type === 'sticker') return <Sticker className={cls} />;
  if (type === 'document') return <FileText className={cls} />;
  return <ImageIcon className={cls} />;
};

/**
 * Channel Media Crawler — crawls a source channel's history and lists every
 * media file with instant preview, download, and send-to-target. This is the
 * "crawl the logs" half of the fetcher (the link-jobs above are the surgical half).
 */
export const ChannelCrawler: React.FC<{ chats: DiscoveredChat[] }> = ({ chats }) => {
  const [sourceId, setSourceId] = useState('');
  const [limit, setLimit] = useState(100);
  const [typeFilter, setTypeFilter] = useState<'all' | CrawlItem['type']>('all');
  const [items, setItems] = useState<CrawlItem[]>([]);
  const [nextOffsetId, setNextOffsetId] = useState<number | null>(null);
  const [crawling, setCrawling] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crawled, setCrawled] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [rowNotice, setRowNotice] = useState<{ id: number; ok: boolean; text: string } | null>(null);
  const [botReady, setBotReady] = useState(false);
  const [botBusy, setBotBusy] = useState<'item' | 'bulk' | null>(null);

  React.useEffect(() => {
    fetch('/api/system').then((r) => (r.ok ? r.json() : null)).then((d) => setBotReady(Boolean(d?.archiveBot))).catch(() => {});
  }, []);

  const mirrorToBot = async (messageId?: number) => {
    if (!sourceId.trim()) return;
    messageId ? setBotBusy('item') : setBotBusy('bulk');
    setRowNotice(null);
    try {
      const res = await fetch('/api/fetcher/mirror', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: sourceId.trim(), ...(messageId ? { messageId } : { limit: 500 }) }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Mirror failed.');
      const text = messageId
        ? (data.deduped ? 'Already in the bot archive' : 'Sent to your bot')
        : `${data.queued} post${data.queued === 1 ? '' : 's'} queued to your bot`;
      if (messageId) setRowNotice({ id: messageId, ok: true, text });
      else setRowNotice({ id: -1, ok: true, text });
    } catch (err: any) {
      const text = err?.message || 'Mirror failed.';
      setRowNotice({ id: messageId ?? -1, ok: false, text });
    } finally {
      setBotBusy(null);
    }
  };

  const sources = chats.length > 0 ? chats : [];
  const targets = sources.filter((c) => c.canSendMessages);

  const crawl = async (offsetId?: number) => {
    const ref = sourceId.trim();
    if (!ref) return;
    offsetId ? setLoadingMore(true) : setCrawling(true);
    setError(null);
    try {
      const res = await fetch(`/api/fetcher/crawl?sourceId=${encodeURIComponent(ref)}&limit=${limit}${offsetId ? `&offsetId=${offsetId}` : ''}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Crawl failed.');
      setItems((prev) => (offsetId ? [...prev, ...(data.items || [])] : data.items || []));
      setNextOffsetId(data.nextOffsetId ?? null);
      setCrawled(true);
    } catch (err: any) {
      setError(err?.message || 'Crawl failed.');
    } finally {
      offsetId ? setLoadingMore(false) : setCrawling(false);
    }
  };

  const sendToTarget = async (item: CrawlItem) => {
    if (!targetId) return;
    setSendingId(item.messageId);
    setRowNotice(null);
    try {
      const res = await fetch('/api/history/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: sourceId.trim(), messageId: item.messageId, targetIds: [targetId] }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Send failed.');
      setRowNotice({ id: item.messageId, ok: true, text: `Delivered as #${data.results?.[0]?.targetMessageId ?? '—'}` });
    } catch (err: any) {
      setRowNotice({ id: item.messageId, ok: false, text: err?.message || 'Send failed.' });
    } finally {
      setSendingId(null);
    }
  };

  const shown = typeFilter === 'all' ? items : items.filter((i) => i.type === typeFilter);

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-600/30 to-blue-600/20 border border-cyan-500/30 shrink-0">
          <FolderSearch className="w-5 h-5 text-cyan-400" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-white">Channel Media Crawler</h2>
          <p className="text-xs text-slate-400 mt-1">
            Crawl a source channel's history and list every file it contains — preview, download, or deliver any of them to a target.
            Restricted and private channels work: media is pulled with your connected account.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        {sources.length > 0 ? (
          <select
            value={sourceId}
            onChange={(e) => { setSourceId(e.target.value); setCrawled(false); setItems([]); }}
            className="flex-1 px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500"
          >
            <option value="">Select source channel…</option>
            {sources.map((c) => (
              <option key={c.id} value={c.id}>{c.title}{c.username ? ` (${c.username})` : ''}</option>
            ))}
            <option value="__custom__">Custom / not listed…</option>
          </select>
        ) : null}
        {(sources.length === 0 || sourceId === '__custom__') && (
          <input
            value={sourceId === '__custom__' ? '' : sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            placeholder="@channel, t.me link, or -100… ID"
            className="flex-1 px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
          />
        )}
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500">
          <option value={50}>50 files</option>
          <option value={100}>100 files</option>
          <option value={200}>200 files</option>
        </select>
        <button
          onClick={() => crawl()}
          disabled={crawling || !sourceId.trim() || sourceId === '__custom__'}
          className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-2 shrink-0"
        >
          {crawling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderSearch className="w-3.5 h-3.5" />}
          {crawling ? 'Crawling…' : 'Crawl channel'}
        </button>
      </div>

      {error && <div className="text-xs text-red-300 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">{error}</div>}

      {crawled && items.length === 0 && !error && (
        <p className="text-xs text-slate-500 py-2">No media files found in the crawled range.</p>
      )}

      {shown.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'video', 'photo', 'document', 'audio', 'voice', 'sticker'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition ${typeFilter === t ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'}`}
              >
                {t === 'all' ? `All (${items.length})` : t}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5">
              {botReady && (
                <button
                  onClick={() => mirrorToBot()}
                  disabled={botBusy !== null}
                  className="flex items-center gap-1.5 rounded-lg border border-sky-700/60 bg-sky-600/20 px-2.5 py-1.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-600/30 disabled:opacity-50"
                  title="Mirror the newest 500 posts of this channel into your Telegram bot"
                >
                  {botBusy === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
                  Mirror history to bot
                </button>
              )}
              <Globe className="w-3 h-3 text-slate-600" />
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-[11px] text-slate-200 focus:outline-none focus:border-cyan-500 max-w-[220px]"
              >
                <option value="">Deliver to target…</option>
                {targets.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                {sources.filter((c) => !targets.includes(c)).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
          </div>

          <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 overflow-hidden">
            {shown.map((item) => (
              <div key={item.messageId} className="flex items-center gap-3 p-2.5 bg-slate-950/40 hover:bg-slate-900/60 transition">
                <img
                  src={withTokenParam(`/api/history/media/thumbnail?sourceId=${encodeURIComponent(sourceId.trim())}&messageId=${item.messageId}`)}
                  onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                  alt="" className="w-10 h-10 rounded-lg object-cover bg-slate-900 border border-slate-800 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-200 font-medium truncate">
                    <TypeIcon type={item.type} />
                    <span className="truncate">{item.fileName || item.caption || `${item.type} #${item.messageId}`}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                    #{item.messageId}{item.date ? ` · ${new Date(item.date).toLocaleDateString()}` : ''}{item.size ? ` · ${formatBytes(item.size)}` : ''}
                    {rowNotice?.id === item.messageId && <span className={rowNotice.ok ? ' text-emerald-400' : ' text-red-400'}> · {rowNotice.text}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={`${withTokenParam(item.mediaUrl)}&dl=1`}
                    className="p-2 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-sky-300 hover:border-sky-500/40"
                    title="Download file"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                  {botReady && (
                    <button
                      onClick={() => mirrorToBot(item.messageId)}
                      disabled={botBusy !== null}
                      className="p-2 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-sky-300 hover:border-sky-500/40 disabled:opacity-40"
                      title="Send this post to your bot archive"
                    >
                      {botBusy === 'item' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <button
                    onClick={() => sendToTarget(item)}
                    disabled={!targetId || sendingId === item.messageId}
                    className="p-2 rounded-lg border border-cyan-700/60 bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={targetId ? `Send to target` : 'Pick a target first'}
                  >
                    {sendingId === item.messageId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {crawled && nextOffsetId && shown.length > 0 && (
        <button
          onClick={() => crawl(nextOffsetId)}
          disabled={loadingMore}
          className="w-full py-2 rounded-xl border border-slate-800 bg-slate-950 text-xs text-slate-300 hover:border-slate-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Load older files
        </button>
      )}
    </div>
  );
};
