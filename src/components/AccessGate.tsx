import React, { useEffect, useState } from 'react';
import { Lock, ArrowRight, User, Ticket, KeyRound } from 'lucide-react';
import { setStoredToken } from '../lib/authToken';

interface AccessGateProps {
  onUnlock: (token: string) => void;
  error?: string | null;
}

type Mode = 'token' | 'signin' | 'register';

/**
 * The administrator entry is deliberately HIDDEN from the public page: it only
 * appears when the gate is opened with the secret hash `#admin`
 * (e.g. https://your-app.example/#admin). Regular visitors see just
 * Sign in / Register and cannot tell that an admin console exists.
 */
const isAdminEntry = () => typeof window !== 'undefined' && window.location.hash.toLowerCase() === '#admin';

/**
 * Multi-user access gate:
 *  - "Sign in"   → registered user (username + password).
 *  - "Register"  → activate an admin-issued invite code + choose a password.
 *  - "Admin"     → only with #admin in the URL; master APP_AUTH_TOKEN sign-in.
 */
export function AccessGate({ onUnlock, error }: AccessGateProps) {
  const [adminEntry, setAdminEntry] = useState(isAdminEntry);
  const [mode, setMode] = useState<Mode>(() => (isAdminEntry() ? 'token' : 'signin'));
  const [value, setValue] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => {
      const isAdmin = isAdminEntry();
      setAdminEntry(isAdmin);
      setMode((current) => (isAdmin ? 'token' : current === 'token' ? 'signin' : current));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const shownError = localError || error || null;

  const callAuth = async (url: string, body: Record<string, string>) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) throw new Error(data?.error || `Request failed (${res.status}).`);
    return data.token as string;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      if (mode === 'token') {
        const trimmed = value.trim();
        if (!trimmed) return;
        setStoredToken(trimmed);
        onUnlock(trimmed);
      } else if (mode === 'signin') {
        const token = await callAuth('/api/auth/user-login', { username: username.trim(), password });
        setStoredToken(token);
        onUnlock(token);
      } else {
        if (password.length < 8) throw new Error('Password must be at least 8 characters.');
        if (password !== password2) throw new Error('Passwords do not match.');
        const token = await callAuth('/api/auth/user-register', { inviteCode: inviteCode.trim(), username: username.trim(), password });
        setStoredToken(token);
        onUnlock(token);
      }
    } catch (err: any) {
      setLocalError(err?.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm mb-3 outline-none focus:border-sky-500';
  const tabCls = (active: boolean) =>
    `flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
      active ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30' : 'text-slate-400 hover:text-slate-200 border border-transparent'
    }`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4 font-['Plus_Jakarta_Sans']">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl"
      >
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
            <Lock size={18} />
          </div>
          <h1 className="text-lg font-semibold">TGForwarder Access</h1>
        </div>

        <div className="flex gap-1 mb-4 bg-slate-950/60 border border-slate-800/60 rounded-xl p-1">
          <button type="button" className={tabCls(mode === 'signin')} onClick={() => { setMode('signin'); setLocalError(null); }}>
            <User size={13} /> Sign in
          </button>
          <button type="button" className={tabCls(mode === 'register')} onClick={() => { setMode('register'); setLocalError(null); }}>
            <Ticket size={13} /> Register
          </button>
          {adminEntry && (
            <button type="button" className={tabCls(mode === 'token')} onClick={() => { setMode('token'); setLocalError(null); }}>
              <KeyRound size={13} /> Admin
            </button>
          )}
        </div>

        {mode === 'signin' && (
          <>
            <p className="text-sm text-slate-400 mb-4">Sign in with your TGForwarder account to open your private workspace.</p>
            <input
              type="text" autoFocus value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="Username" autoComplete="username" className={inputCls}
            />
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Password" autoComplete="current-password" className={inputCls}
            />
          </>
        )}

        {mode === 'register' && (
          <>
            <p className="text-sm text-slate-400 mb-4">
              New here? Enter the <span className="text-slate-200">invite code</span> you received, then pick a username and password.
            </p>
            <input
              type="text" autoFocus value={inviteCode} onChange={(e) => setInviteCode(e.target.value)}
              placeholder="Invite code (e.g. TGF-ABC123-XYZ789)" className={`${inputCls} font-mono uppercase`}
            />
            <input
              type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username" autoComplete="username" className={inputCls}
            />
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min. 8 characters)" autoComplete="new-password" className={inputCls}
            />
            <input
              type="password" value={password2} onChange={(e) => setPassword2(e.target.value)}
              placeholder="Repeat password" autoComplete="new-password" className={inputCls}
            />
          </>
        )}

        {mode === 'token' && adminEntry && (
          <>
            <p className="text-sm text-slate-400 mb-4">
              Administrator sign-in: enter the server's <code className="text-slate-300">APP_AUTH_TOKEN</code> to manage invites, users, and the operator workspace.
            </p>
            <input
              type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)}
              placeholder="Master access token" className={inputCls}
            />
          </>
        )}

        {shownError && <p className="text-sm text-red-400 mb-3">{shownError}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-medium rounded-lg px-3 py-2 text-sm transition"
        >
          {submitting ? 'Please wait…' : mode === 'register' ? 'Create my workspace' : mode === 'signin' ? 'Sign in' : 'Unlock'} {!submitting && <ArrowRight size={16} />}
        </button>
      </form>
    </div>
  );
}
