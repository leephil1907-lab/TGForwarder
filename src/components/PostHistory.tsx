import React, { useState } from 'react';
import { History, RefreshCw, Send, X, Edit3, Image, Video, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { DiscoveredChat, AuthState } from '../types';

interface Props { chats: DiscoveredChat[]; authState: AuthState; }
type Msg = { id:number; date:number|null; text:string; mediaType:string|null; hasMedia:boolean; views:number|null; forwards:number|null };

export const PostHistory: React.FC<Props> = ({ chats, authState }) => {
  const [sourceId, setSourceId] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Msg | null>(null);
  const [editedText, setEditedText] = useState('');
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<{ok:boolean;text:string}|null>(null);

  const loadHistory = async () => {
    if (!sourceId) return;
    setLoading(true); setNotice(null);
    try {
      const res = await fetch(`/api/history?sourceId=${encodeURIComponent(sourceId)}&limit=100`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load Telegram history');
      setMessages(data.messages || []);
    } catch (e:any) { setNotice({ok:false,text:e.message}); }
    finally { setLoading(false); }
  };

  const openEditor = (msg: Msg) => { setSelected(msg); setEditedText(msg.text || ''); setTargetIds([]); setNotice(null); };
  const toggleTarget = (id:string) => setTargetIds(v => v.includes(id) ? v.filter(x=>x!==id) : [...v,id]);

  const publish = async () => {
    if (!selected || !targetIds.length) return;
    setPublishing(true); setNotice(null);
    try {
      const res = await fetch('/api/history/forward', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ sourceId, messageId:selected.id, targetIds, text:editedText }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Telegram publish failed');
      const failed = (data.results || []).filter((r:any)=>!r.success).length;
      setNotice({ok: failed===0, text: failed===0 ? `Published message #${selected.id} successfully.` : `Published with ${failed} destination failure(s).`});
      if (failed===0) setSelected(null);
    } catch(e:any) { setNotice({ok:false,text:e.message}); }
    finally { setPublishing(false); }
  };

  if (authState.status !== 'connected') return <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-slate-400">Connect Telegram to retrieve real source-channel history.</div>;

  return <div className="space-y-5">
    <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="flex-1"><div className="flex items-center gap-2 mb-2"><History className="w-5 h-5 text-cyan-400"/><h2 className="text-lg font-bold text-white">Source Post History</h2></div><p className="text-xs text-slate-400">Loads actual older messages from Telegram. Nothing is generated from local forwarding logs.</p></div>
        <select value={sourceId} onChange={e=>setSourceId(e.target.value)} className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white min-w-[260px]">
          <option value="">Select source channel</option>{chats.filter(c=>c.type==='channel'||c.type==='group'||c.type==='supergroup').map(c=><option key={c.id} value={c.id}>{c.title} ({c.id})</option>)}
        </select>
        <button onClick={loadHistory} disabled={!sourceId||loading} className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2"><RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`}/>{loading?'Loading…':'Load History'}</button>
      </div>
    </div>

    {notice && <div className={`p-3 rounded-xl border text-xs flex gap-2 ${notice.ok?'bg-emerald-950/40 border-emerald-800 text-emerald-300':'bg-rose-950/40 border-rose-800 text-rose-300'}`}>{notice.ok?<CheckCircle2 className="w-4 h-4"/>:<AlertCircle className="w-4 h-4"/>}{notice.text}</div>}

    <div className="space-y-2">
      {messages.map(msg=><div key={msg.id} className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex gap-4">
        <div className="flex-1 min-w-0"><div className="flex items-center gap-2 text-[10px] text-slate-500 mb-2"><span>#{msg.id}</span>{msg.date&&<span>{new Date(msg.date).toLocaleString()}</span>}{msg.mediaType&&<span className="text-cyan-400">{msg.mediaType}</span>}</div><p className="text-sm text-slate-200 whitespace-pre-wrap break-words line-clamp-5">{msg.text || '(media-only post)'}</p></div>
        <button onClick={()=>openEditor(msg)} className="self-center px-3 py-2 rounded-lg bg-cyan-600/20 border border-cyan-700 text-cyan-300 text-xs font-semibold flex items-center gap-1.5"><Edit3 className="w-3.5 h-3.5"/>Edit & Publish</button>
      </div>)}
      {!loading && sourceId && messages.length===0 && <div className="p-10 text-center text-xs text-slate-500">No messages were returned by Telegram for this source.</div>}
    </div>

    {selected && <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-auto rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between"><div><h3 className="text-base font-bold text-white">Edit Post #{selected.id}</h3><p className="text-xs text-slate-400">The edited content is sent as a new Telegram message.</p></div><button onClick={()=>setSelected(null)} className="p-2 text-slate-400 hover:text-white"><X className="w-5 h-5"/></button></div>
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800"><div className="text-[10px] text-slate-500 mb-2">ORIGINAL</div><p className="text-sm text-slate-300 whitespace-pre-wrap">{selected.text || '(media-only post)'}</p>{selected.mediaType&&<div className="mt-2 text-xs text-cyan-400 flex items-center gap-1"><Image className="w-3.5 h-3.5"/>Media: {selected.mediaType}</div>}</div>
        <textarea value={editedText} onChange={e=>setEditedText(e.target.value)} rows={9} className="w-full px-3 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500" placeholder="Edit the caption/text before publishing…"/>
        <div><div className="text-xs font-bold text-slate-300 mb-2">DESTINATIONS</div><div className="grid sm:grid-cols-2 gap-2">{chats.filter(c=>c.id!==sourceId).map(c=><button key={c.id} onClick={()=>toggleTarget(c.id)} className={`text-left p-3 rounded-xl border text-xs ${targetIds.includes(c.id)?'bg-cyan-950/60 border-cyan-500 text-cyan-200':'bg-slate-950 border-slate-800 text-slate-400'}`}>{c.title}<div className="font-mono text-[10px] mt-1 opacity-70">{c.id}</div></button>)}</div></div>
        <div className="flex justify-end gap-2"><button onClick={()=>setSelected(null)} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold">Cancel</button><button onClick={publish} disabled={!targetIds.length||publishing} className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2"><Send className="w-3.5 h-3.5"/>{publishing?'Publishing…':'Publish Edited Post'}</button></div>
      </div>
    </div>}
  </div>;
};
