import React, { useCallback, useEffect, useState } from 'react';
import { Edit3, FileText, Image, RefreshCw, Send, Trash2, Video, X } from 'lucide-react';

type PendingPost = {
  key: string;
  sourceId: string;
  sourceTitle: string;
  targetId: string;
  targetTitle: string;
  messageId: number;
  text: string;
  hasMedia: boolean;
  mediaType: string | null;
  createdAt: number;
};

const mediaLabel = (type: string | null) => {
  const value = (type || 'media').toLowerCase();
  if (value.includes('video')) return 'Video';
  if (value.includes('photo') || value.includes('image')) return 'Photo';
  if (value.includes('document')) return 'Document';
  if (value.includes('audio')) return 'Audio';
  if (value.includes('voice')) return 'Voice';
  if (value.includes('animation') || value.includes('gif')) return 'Animation';
  return 'Media';
};

const MediaPreview: React.FC<{ post: PendingPost }> = ({ post }) => {
  if (!post.hasMedia) return null;
  const label = mediaLabel(post.mediaType);
  const Icon = label === 'Video' ? Video : label === 'Document' ? FileText : Image;
  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
      <div className="aspect-video min-h-[150px] flex items-center justify-center bg-slate-950/80">
        <div className="text-center text-slate-400">
          <Icon className="w-9 h-9 mx-auto mb-2 text-cyan-400" />
          <div className="text-xs font-semibold text-slate-200">{label}</div>
          <div className="text-[10px] mt-1 text-slate-500">Original Telegram media attached to post #{post.messageId}</div>
        </div>
      </div>
    </div>
  );
};

export const PendingPosts: React.FC = () => {
  const [posts, setPosts] = useState<PendingPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<PendingPost | null>(null);
  const [text, setText] = useState('');
  const [preserveFormatting, setPreserveFormatting] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/pending', { credentials: 'include', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load pending posts');
      setPosts(Array.isArray(data.posts) ? data.posts : []);
    } catch (error: any) {
      setNotice(error.message || 'Unable to load pending posts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const openEditor = (post: PendingPost) => {
    setEditing(post);
    setText(post.text || '');
    setPreserveFormatting(true);
    setNotice(null);
  };

  const publish = async () => {
    if (!editing) return;
    setBusyKey(editing.key);
    setNotice(null);
    try {
      const response = await fetch(`/api/pending/${encodeURIComponent(editing.key)}/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, preserveFormatting })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Publish failed');
      setEditing(null);
      await load();
      setNotice(`Published Telegram post #${data.sourceMessageId ?? editing.messageId} to ${editing.targetTitle}.`);
    } catch (error: any) {
      setNotice(error.message || 'Publish failed');
    } finally {
      setBusyKey(null);
    }
  };

  const publishDirect = async (post: PendingPost) => {
    setBusyKey(post.key);
    setNotice(null);
    try {
      const response = await fetch(`/api/pending/${encodeURIComponent(post.key)}/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: post.text })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Publish failed');
      await load();
      setNotice(`Published Telegram post #${data.sourceMessageId ?? post.messageId} to ${post.targetTitle}.`);
    } catch (error: any) {
      setNotice(error.message || 'Publish failed');
    } finally {
      setBusyKey(null);
    }
  };

  const discard = async (key: string) => {
    setBusyKey(key);
    try {
      const response = await fetch(`/api/pending/${encodeURIComponent(key)}`, { method: 'DELETE', credentials: 'include' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to discard post');
      await load();
    } catch (error: any) {
      setNotice(error.message || 'Unable to discard post');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="mb-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-slate-800">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2"><Edit3 className="w-4 h-4 text-cyan-400" /> Pending Posts</h2>
          <p className="text-[11px] text-slate-500 mt-1">Real source messages waiting for review, editing, approval, and Telegram delivery.</p>
        </div>
        <button onClick={load} disabled={loading} className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white disabled:opacity-50" title="Refresh pending posts"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      {notice && <div className="px-5 py-3 text-xs text-cyan-300 bg-cyan-950/30 border-b border-cyan-900/50">{notice}</div>}

      {posts.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-slate-500">No source posts are waiting for review.</div>
      ) : (
        <div className="divide-y divide-slate-800">
          {posts.map((post) => (
            <article key={post.key} className="p-4">
              <div className="flex gap-4 items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-2 text-[10px] text-slate-500 mb-2">
                    <span className="px-2 py-1 rounded-md bg-slate-800 text-slate-300">POST #{post.messageId}</span>
                    <span className="px-2 py-1 rounded-md bg-slate-800">{new Date(post.createdAt).toLocaleString()}</span>
                    <span className="px-2 py-1 rounded-md bg-cyan-950/40 text-cyan-300">SOURCE: {post.sourceTitle || post.sourceId}</span>
                    <span className="px-2 py-1 rounded-md bg-emerald-950/40 text-emerald-300">DESTINATION: {post.targetTitle || post.targetId}</span>
                  </div>
                  <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                    <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">{post.text || '(media-only post)'}</p>
                    <MediaPreview post={post} />
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button onClick={() => openEditor(post)} className="px-3 py-2 rounded-lg bg-cyan-600/20 border border-cyan-700 text-cyan-300 text-xs font-semibold flex items-center gap-1.5"><Edit3 className="w-3.5 h-3.5" /> Edit</button>
                  <button onClick={() => publishDirect(post)} disabled={busyKey === post.key} className="px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-700 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"><Send className="w-3.5 h-3.5" />{busyKey === post.key ? 'Sending…' : 'Publish'}</button>
                  <button onClick={() => discard(post.key)} disabled={busyKey === post.key} className="px-3 py-2 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-300 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div><h3 className="text-base font-bold text-white">Edit Source Post #{editing.messageId}</h3><p className="text-xs text-slate-400 mt-1">{editing.sourceTitle} → {editing.targetTitle}</p></div>
              <button onClick={() => setEditing(null)} className="p-2 text-slate-400 hover:text-white" title="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded-lg bg-slate-950 border border-slate-800 p-3"><div className="text-slate-500">ORIGINAL SOURCE</div><div className="text-slate-200 mt-1 truncate">{editing.sourceTitle}</div></div>
              <div className="rounded-lg bg-slate-950 border border-slate-800 p-3"><div className="text-slate-500">POST ID / TIMESTAMP</div><div className="text-slate-200 mt-1">#{editing.messageId} · {new Date(editing.createdAt).toLocaleString()}</div></div>
            </div>
            {editing.hasMedia && <MediaPreview post={editing} />}
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-2">Editable text / caption</label>
              <textarea value={text} onChange={(event) => setText(event.target.value)} rows={10} className="w-full px-3 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500" placeholder="Edit the caption/text before publishing…" />
            </div>
            <label className="flex items-center gap-3 rounded-xl bg-slate-950 border border-slate-800 p-3 cursor-pointer">
              <input type="checkbox" checked={preserveFormatting} onChange={(event) => setPreserveFormatting(event.target.checked)} className="accent-cyan-500" />
              <span><span className="block text-xs font-semibold text-slate-200">Preserve formatting</span><span className="block text-[10px] text-slate-500 mt-0.5">Keep Telegram formatting where supported when the edited caption is published.</span></span>
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold">Cancel</button>
              <button onClick={publish} disabled={busyKey === editing.key} className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2"><Send className="w-3.5 h-3.5" />{busyKey === editing.key ? 'Publishing…' : 'Forward / Publish'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
