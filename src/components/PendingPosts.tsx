import React, { useCallback, useEffect, useState } from 'react';
import { Edit3, Image, RefreshCw, Send, Trash2 } from 'lucide-react';

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

export const PendingPosts: React.FC = () => {
  const [posts, setPosts] = useState<PendingPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<PendingPost | null>(null);
  const [text, setText] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/pending');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load pending posts');
      setPosts(data.posts || []);
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
    setNotice(null);
  };

  const publish = async () => {
    if (!editing) return;
    setBusyKey(editing.key);
    try {
      const response = await fetch(`/api/pending/${encodeURIComponent(editing.key)}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Publish failed');
      setEditing(null);
      await load();
      setNotice('Edited post published successfully.');
    } catch (error: any) {
      setNotice(error.message || 'Publish failed');
    } finally {
      setBusyKey(null);
    }
  };

  const discard = async (key: string) => {
    setBusyKey(key);
    try {
      const response = await fetch(`/api/pending/${encodeURIComponent(key)}`, { method: 'DELETE' });
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
          <p className="text-[11px] text-slate-500 mt-1">New source posts wait here for editing and approval before delivery.</p>
        </div>
        <button onClick={load} disabled={loading} className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white disabled:opacity-50" title="Refresh pending posts"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      {notice && <div className="px-5 py-3 text-xs text-cyan-300 bg-cyan-950/30 border-b border-cyan-900/50">{notice}</div>}

      {posts.length === 0 ? (
        <div className="px-5 py-6 text-xs text-slate-500">No new posts are waiting for review.</div>
      ) : (
        <div className="divide-y divide-slate-800">
          {posts.map((post) => (
            <div key={post.key} className="p-4 flex gap-4 items-start">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-2 text-[10px] text-slate-500 mb-2">
                  <span>#{post.messageId}</span>
                  <span>{new Date(post.createdAt).toLocaleString()}</span>
                  <span className="text-cyan-300">Source: {post.sourceId}</span>
                  <span className="text-emerald-300">Target: {post.targetId}</span>
                </div>
                <p className="text-sm text-slate-200 whitespace-pre-wrap break-words line-clamp-4">{post.text || '(media-only post)'}</p>
                {post.hasMedia && <div className="mt-2 text-[10px] text-cyan-400 flex items-center gap-1"><Image className="w-3.5 h-3.5" /> {post.mediaType || 'media'}</div>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => openEditor(post)} className="px-3 py-2 rounded-lg bg-cyan-600/20 border border-cyan-700 text-cyan-300 text-xs font-semibold flex items-center gap-1.5"><Edit3 className="w-3.5 h-3.5" /> Edit</button>
                <button onClick={() => discard(post.key)} disabled={busyKey === post.key} className="p-2 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-300 disabled:opacity-50" title="Discard"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div><h3 className="text-base font-bold text-white">Edit Recent Post #{editing.messageId}</h3><p className="text-xs text-slate-400">{editing.sourceTitle} → {editing.targetTitle}</p></div>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-white text-xl">×</button>
            </div>
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800"><div className="text-[10px] text-slate-500 mb-1">ORIGINAL / CURRENT COPY</div><p className="text-sm text-slate-300 whitespace-pre-wrap">{editing.text || '(media-only post)'}</p></div>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={10} className="w-full px-3 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500" placeholder="Edit the caption/text before publishing…" />
            <div className="flex justify-end gap-2"><button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold">Cancel</button><button onClick={publish} disabled={busyKey === editing.key} className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2"><Send className="w-3.5 h-3.5" />{busyKey === editing.key ? 'Publishing…' : 'Preview & Publish'}</button></div>
          </div>
        </div>
      )}
    </section>
  );
};
