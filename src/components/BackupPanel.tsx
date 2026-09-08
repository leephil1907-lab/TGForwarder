import React, { useRef, useState } from 'react';
import { Database, Download, Upload, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { withTokenParam } from '../lib/authToken';

/**
 * Backup & Restore — one-click archive of the whole workspace (Telegram
 * session, rules, mappings, pending posts, watchers, fetch jobs). Restoring
 * replaces the current workspace and restarts the service.
 */
export const BackupPanel: React.FC = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'download' | 'restore' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingBundle, setPendingBundle] = useState<{ name: string; createdAt?: string; files: number } | null>(null);

  const download = () => {
    setBusy('download');
    try {
      // Authenticated download link (token rides in the query string).
      const a = document.createElement('a');
      a.href = withTokenParam('/api/backup');
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setMessage({ ok: true, text: 'Backup downloaded. Store it somewhere safe — it contains your Telegram session.' });
    } finally {
      setBusy(null);
    }
  };

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMessage(null);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      if (bundle?.tgforwarderBackup !== true || !bundle?.files) throw new Error('Not a TGForwarder backup file.');
      setPendingBundle({ name: file.name, createdAt: bundle.createdAt, files: Object.keys(bundle.files).length });
      (fileRef.current as any).__bundle = bundle;
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'Could not read that file.' });
    }
  };

  const restore = async () => {
    const bundle = (fileRef.current as any)?.__bundle;
    if (!bundle) return;
    setBusy('restore');
    setMessage(null);
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Restore failed.');
      setMessage({ ok: true, text: data.restarting ? 'Backup restored. The service is restarting to apply it — refresh this page in ~30 seconds.' : 'Backup restored.' });
      setPendingBundle(null);
      (fileRef.current as any).__bundle = null;
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'Restore failed.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-3">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-600/30 to-blue-600/20 border border-cyan-500/30 shrink-0">
          <Database className="w-5 h-5 text-cyan-400" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-white">Backup &amp; Restore</h2>
          <p className="text-xs text-slate-400 mt-1">
            Download a snapshot of your whole workspace — Telegram session, rules, mappings, pending posts, watchers and fetch jobs.
            Restoring a backup <span className="text-slate-200">replaces the current workspace</span> and restarts the service.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          onClick={download}
          disabled={busy !== null}
          className="flex-1 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-2"
        >
          {busy === 'download' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Download backup
        </button>
        <label className="flex-1 cursor-pointer">
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} className="hidden" />
          <span className="w-full px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800/60 hover:border-slate-600 text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-2">
            <Upload className="w-3.5 h-3.5" /> Choose backup file…
          </span>
        </label>
      </div>

      {pendingBundle && (
        <div className="rounded-xl border border-amber-800/50 bg-amber-950/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs text-amber-200 font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" />
            Restore “{pendingBundle.name}”?{pendingBundle.createdAt ? ` (created ${new Date(pendingBundle.createdAt).toLocaleString()})` : ''}
          </div>
          <p className="text-[11px] text-amber-300/80">
            This overwrites the current session, rules, mappings, pending posts, watchers and fetch jobs with the backup's {pendingBundle.files} file(s), then restarts the service.
          </p>
          <div className="flex gap-2">
            <button onClick={restore} disabled={busy !== null} className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[11px] font-bold inline-flex items-center gap-1.5">
              {busy === 'restore' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Yes, restore
            </button>
            <button onClick={() => setPendingBundle(null)} disabled={busy !== null} className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 text-[11px] font-semibold">Cancel</button>
          </div>
        </div>
      )}

      {message && (
        <div className={`text-xs rounded-lg px-3 py-2 border ${message.ok ? 'text-emerald-300 bg-emerald-950/30 border-emerald-900/50' : 'text-red-300 bg-red-950/30 border-red-900/50'}`}>
          {message.text}
        </div>
      )}
    </div>
  );
};
