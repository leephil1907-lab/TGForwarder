import React, { useCallback, useEffect, useState } from 'react';
import { Ticket, Users, Copy, Check, Trash2, RefreshCw, ShieldOff, ShieldCheck, Plus } from 'lucide-react';

interface Invite {
  code: string;
  label: string;
  createdBy: string;
  createdAt: number;
  usedBy?: string | null;
  usedAt?: number | null;
}
interface ManagedUser {
  id: string;
  username: string;
  role: string;
  createdAt: number;
  lastLoginAt?: number | null;
  disabled?: boolean;
}

export const AdminPanel: React.FC = () => {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [invRes, usrRes] = await Promise.all([fetch('/api/users/invites'), fetch('/api/users')]);
      const invData = await invRes.json().catch(() => ({}));
      const usrData = await usrRes.json().catch(() => ({}));
      if (!invRes.ok) throw new Error(invData.error || 'Failed to load invites.');
      if (!usrRes.ok) throw new Error(usrData.error || 'Failed to load users.');
      setInvites(invData.invites || []);
      setUsers(usrData.users || []);
      setLoaded(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to load access control data.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/users/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to create invite.');
      setLabel('');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to create invite.');
    } finally {
      setBusy(false);
    }
  };

  const deleteInvite = async (code: string) => {
    setBusy(true);
    try {
      await fetch(`/api/users/invites/${encodeURIComponent(code)}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggleUser = async (user: ManagedUser) => {
    setBusy(true);
    try {
      await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: !user.disabled }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const fmt = (ts?: number | null) => (ts ? new Date(ts).toLocaleString() : '—');

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Access Control</h2>
        <p className="text-sm text-slate-400 mt-1">
          Invite-only onboarding. Generate a code, share it with the new user — they register with it and get a fully isolated workspace.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div>}

      {/* Invites */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Ticket size={16} className="text-cyan-400" /> Invite Codes
          </h3>
          <button onClick={load} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-700 disabled:opacity-50">
            <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        <form onSubmit={createInvite} className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional) — e.g. “for Maria”"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm outline-none focus:border-sky-500"
          />
          <button type="submit" disabled={busy} className="flex items-center justify-center gap-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 px-4 py-2 text-sm font-medium text-slate-950">
            <Plus size={14} /> Generate invite
          </button>
        </form>

        {loaded && invites.length === 0 ? (
          <p className="text-sm text-slate-500 py-3">No invite codes yet. Generate one to let someone register.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500 border-b border-slate-800">
                <tr>
                  <th className="py-2 pr-3 font-medium">Code</th>
                  <th className="py-2 pr-3 font-medium">Label</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Created</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {invites.map((invite) => (
                  <tr key={invite.code} className="border-b border-slate-800/50">
                    <td className="py-2 pr-3">
                      <button onClick={() => copy(invite.code)} title="Copy code" className="flex items-center gap-1.5 font-mono text-cyan-300 hover:text-cyan-200">
                        {invite.code} {copied === invite.code ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} className="text-slate-500" />}
                      </button>
                    </td>
                    <td className="py-2 pr-3 max-w-[160px] truncate">{invite.label || '—'}</td>
                    <td className="py-2 pr-3">
                      {invite.usedBy ? (
                        <span className="text-slate-500">Used by <span className="text-slate-300">{invite.usedBy}</span></span>
                      ) : (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">AVAILABLE</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{fmt(invite.createdAt)}</td>
                    <td className="py-2 text-right">
                      {!invite.usedBy && (
                        <button onClick={() => deleteInvite(invite.code)} disabled={busy} title="Revoke invite" className="text-slate-500 hover:text-red-400 disabled:opacity-50">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Users */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200 mb-4">
          <Users size={16} className="text-cyan-400" /> Registered Users
        </h3>
        {loaded && users.length === 0 ? (
          <p className="text-sm text-slate-500 py-3">No users have registered yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500 border-b border-slate-800">
                <tr>
                  <th className="py-2 pr-3 font-medium">Username</th>
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">Registered</th>
                  <th className="py-2 pr-3 font-medium">Last login</th>
                  <th className="py-2 font-medium text-right">Access</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-slate-800/50">
                    <td className="py-2 pr-3 font-medium text-slate-200">{user.username}</td>
                    <td className="py-2 pr-3">
                      <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] font-semibold text-slate-300">{user.role}</span>
                    </td>
                    <td className="py-2 pr-3 text-slate-500">{fmt(user.createdAt)}</td>
                    <td className="py-2 pr-3 text-slate-500">{fmt(user.lastLoginAt)}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => toggleUser(user)}
                        disabled={busy}
                        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 ${
                          user.disabled
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                            : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-red-500/40 hover:text-red-300'
                        }`}
                      >
                        {user.disabled ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
                        {user.disabled ? 'Re-enable' : 'Disable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-500 mt-3">
          Disabled users are signed out immediately and cannot log back in until re-enabled. Each user's rules, jobs, downloads and Telegram session are fully isolated.
        </p>
      </section>
    </div>
  );
};
