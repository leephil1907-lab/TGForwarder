import React, { useEffect, useState } from 'react';
import { Lock, ArrowRight, KeyRound, Send, ShieldCheck, UserCheck } from 'lucide-react';
import { setStoredToken } from '../lib/authToken';

interface AccessGateProps {
  onUnlock: (token: string) => void;
  error?: string | null;
}

type Mode = 'connect' | 'admin';
type Step = 'start' | 'credentials' | 'code' | '2fa';

/**
 * The administrator entry is deliberately HIDDEN from the public page: it only
 * appears when the gate is opened with the secret hash `#admin`
 * (e.g. https://your-app.example/#admin).
 */
const isAdminEntry = () => typeof window !== 'undefined' && window.location.hash.toLowerCase() === '#admin';

/**
 * Invite deep-links carry the one-time access code in the URL, e.g.
 *   https://your-app.example/?invite=TGF-ABC123-XYZ789
 */
function readInviteFromUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('invite') || params.get('code');
    if (fromQuery) return fromQuery.trim().toUpperCase();
    const match = window.location.hash.match(/#invite=([A-Za-z0-9_-]+)/);
    return match ? match[1].trim().toUpperCase() : '';
  } catch {
    return '';
  }
}

function consumeInviteFromUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    url.searchParams.delete('code');
    if (url.hash.toLowerCase().startsWith('#invite=')) url.hash = '';
    window.history.replaceState(null, '', url.toString());
  } catch { /* ignore */ }
}

async function postJson(url: string, token: string | undefined, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) throw new Error(data?.error || `Request failed (${res.status}).`);
  return data;
}

/**
 * Telegram-first access gate — no site username/password.
 *  1. New users arrive with an invite (link or code) and connect their own
 *     Telegram account; the site reads their Telegram @username as identity.
 *  2. Returning users just connect Telegram again (same phone + code).
 *  3. 2FA Cloud Password is asked ONLY when Telegram requires it.
 *  4. "Admin" (hidden behind #admin) signs in with the master APP_AUTH_TOKEN.
 */
export function AccessGate({ onUnlock, error }: AccessGateProps) {
  const linkedInvite = readInviteFromUrl();
  const [adminEntry, setAdminEntry] = useState(isAdminEntry);
  const [mode, setMode] = useState<Mode>(() => (isAdminEntry() ? 'admin' : 'connect'));

  const [inviteCode, setInviteCode] = useState(linkedInvite);
  const [showInviteField, setShowInviteField] = useState(false);

  const [step, setStep] = useState<Step>('start');
  const [pendingToken, setPendingToken] = useState('');

  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [twoFaPassword, setTwoFaPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (linkedInvite) consumeInviteFromUrl();
    const onHash = () => {
      const isAdmin = isAdminEntry();
      setAdminEntry(isAdmin);
      setMode((current) => (isAdmin ? 'admin' : current === 'admin' ? 'connect' : current));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const shownError = localError || error || null;

  /** Validate the invite (or open a returning-user handshake) and start. */
  const startConnect = async (withInvite: string) => {
    setLocalError(null);
    setBusy(true);
    try {
      const data = withInvite
        ? await postJson('/api/auth/invite-connect', undefined, { inviteCode: withInvite.trim() })
        : await postJson('/api/auth/telegram-connect', undefined, {});
      setPendingToken(data.token);
      setStep('credentials');
    } catch (err: any) {
      setLocalError(err?.message || 'Could not start the Telegram sign-in.');
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setBusy(true);
    try {
      await postJson('/api/auth/pending/request-code', pendingToken, { apiId: apiId.trim(), apiHash: apiHash.trim(), phoneNumber: phone.trim() });
      setStep('code');
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to send the Telegram code.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setBusy(true);
    try {
      const data = await postJson('/api/auth/pending/verify-code', pendingToken, { phoneCode: phoneCode.trim() });
      if (data.requires2FA) {
        setStep('2fa');
        return;
      }
      finish(data.token);
    } catch (err: any) {
      setLocalError(err?.message || 'Code verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const verify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setBusy(true);
    try {
      const data = await postJson('/api/auth/pending/verify-2fa', pendingToken, { password: twoFaPassword });
      if (data.requires2FA) throw new Error('That password did not work. Try again.');
      finish(data.token);
    } catch (err: any) {
      setLocalError(err?.message || '2FA verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const finish = (token: string) => {
    setStoredToken(token);
    onUnlock(token);
  };

  const inputCls = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm mb-3 outline-none focus:border-sky-500';
  const stepChip = (active: boolean, label: string) => (
    <div className={`flex items-center gap-1.5 text-[11px] font-medium ${active ? 'text-sky-300' : 'text-slate-500'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-sky-400' : 'bg-slate-700'}`} /> {label}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4 font-['Plus_Jakarta_Sans']">
      <form
        onSubmit={(e) => { e.preventDefault(); if (mode === 'connect' && step === 'start') startConnect(inviteCode); }}
        className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl"
      >
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
            <Lock size={18} />
          </div>
          <h1 className="text-lg font-semibold">TGForwarder Access</h1>
        </div>

        {mode === 'connect' ? (
          <>
            {linkedInvite && step === 'start' && (
              <p className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                Invite <span className="font-mono">{linkedInvite}</span> detected from your link — continue with Telegram to claim it.
              </p>
            )}

            {step === 'start' && (
              <>
                <p className="text-sm text-slate-400 mb-4">
                  {linkedInvite
                    ? 'Claim your invite by connecting your own Telegram account. Your Telegram identity becomes your TGForwarder login — no passwords here.'
                    : 'Sign in by connecting your Telegram account — your Telegram identity is your login.'}
                </p>
                <button
                  type="button"
                  onClick={() => startConnect(linkedInvite || (showInviteField && inviteCode.trim() ? inviteCode : ''))}
                  disabled={busy}
                  className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-medium rounded-lg px-3 py-2.5 text-sm transition mb-3"
                >
                  <Send size={15} /> {busy ? 'Starting…' : linkedInvite ? 'Continue with Telegram' : 'Sign in with Telegram'}
                </button>
                {!linkedInvite && (
                  <div className="text-center">
                    {showInviteField ? (
                      <div className="mt-1">
                        <input
                          type="text" autoFocus value={inviteCode} onChange={(e) => setInviteCode(e.target.value)}
                          placeholder="Invite code (e.g. TGF-ABC123-XYZ789)"
                          className={`${inputCls} font-mono uppercase`}
                        />
                        <button
                          type="button" onClick={() => startConnect(inviteCode)} disabled={busy || !inviteCode.trim()}
                          className="w-full flex items-center justify-center gap-2 border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 disabled:opacity-50 text-sky-300 font-medium rounded-lg px-3 py-2 text-sm transition"
                        >
                          <UserCheck size={15} /> Claim invite & connect Telegram
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setShowInviteField(true)} className="text-xs text-slate-400 hover:text-sky-300 underline underline-offset-4">
                        New here? Use your invite code
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {step === 'credentials' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  {stepChip(true, '1 · App credentials')}
                  {stepChip(false, '2 · Telegram code')}
                </div>
                <p className="text-sm text-slate-400 mb-4">
                  Connect your own Telegram account. Your <span className="text-slate-200">API ID</span> and <span className="text-slate-200">API Hash</span> come from{' '}
                  <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">my.telegram.org</a> (free, one-time) — they stay private in your workspace.
                </p>
                <input type="text" autoFocus value={apiId} onChange={(e) => setApiId(e.target.value)} placeholder="API ID (numbers)" className={inputCls} />
                <input type="password" value={apiHash} onChange={(e) => setApiHash(e.target.value)} placeholder="API Hash" className={inputCls} />
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number (international, e.g. +234…)" className={inputCls} />
                {shownError && <p className="text-sm text-red-400 mb-3">{shownError}</p>}
                <button type="button" onClick={sendCode} disabled={busy || !apiId.trim() || !apiHash.trim() || !phone.trim()} className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg px-3 py-2 text-sm transition">
                  <Send size={15} /> {busy ? 'Sending…' : 'Send Telegram code'}
                </button>
              </>
            )}

            {step === 'code' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  {stepChip(false, '1 · App credentials')}
                  {stepChip(true, '2 · Telegram code')}
                </div>
                <p className="text-sm text-slate-400 mb-4">
                  Enter the login code Telegram just sent to <span className="text-slate-200">{phone}</span>.
                </p>
                <input type="text" autoFocus value={phoneCode} onChange={(e) => setPhoneCode(e.target.value)} placeholder="Login code" className={`${inputCls} font-mono tracking-widest`} />
                {shownError && <p className="text-sm text-red-400 mb-3">{shownError}</p>}
                <button type="button" onClick={verifyCode} disabled={busy || !phoneCode.trim()} className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg px-3 py-2 text-sm transition">
                  <ShieldCheck size={15} /> {busy ? 'Verifying…' : 'Verify & sign in'}
                </button>
              </>
            )}

            {step === '2fa' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  {stepChip(false, '2 · Telegram code')}
                  {stepChip(true, '3 · Cloud password')}
                </div>
                <p className="text-sm text-slate-400 mb-4">
                  Your Telegram account is protected with <span className="text-slate-200">2-Step Verification</span>. Enter your Telegram Cloud Password to finish.
                </p>
                <input type="password" autoFocus value={twoFaPassword} onChange={(e) => setTwoFaPassword(e.target.value)} placeholder="Telegram Cloud Password" className={inputCls} />
                {shownError && <p className="text-sm text-red-400 mb-3">{shownError}</p>}
                <button type="button" onClick={verify2FA} disabled={busy || !twoFaPassword} className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg px-3 py-2 text-sm transition">
                  <ShieldCheck size={15} /> {busy ? 'Verifying…' : 'Verify password'}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-slate-400 mb-4">
              Administrator sign-in: enter the server's <code className="text-slate-300">APP_AUTH_TOKEN</code> to manage invites, users, and the operator workspace.
            </p>
            <AdminTokenForm inputCls={inputCls} onUnlock={finish} />
          </>
        )}
      </form>
    </div>
  );
}

/** Separate component so admin state never mixes with the connect wizard. */
function AdminTokenForm({ inputCls, onUnlock }: { inputCls: string; onUnlock: (token: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <>
      <input
        type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)}
        placeholder="Master access token" className={inputCls}
      />
      <button
        type="button"
        onClick={() => { if (value.trim()) { setStoredToken(value.trim()); onUnlock(value.trim()); } }}
        disabled={!value.trim()}
        className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg px-3 py-2 text-sm transition"
      >
        Unlock <ArrowRight size={16} />
      </button>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
        <KeyRound size={11} /> Regular users never need this screen — sign in with Telegram instead.
      </p>
    </>
  );
}
