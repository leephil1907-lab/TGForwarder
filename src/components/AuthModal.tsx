import React, { useState } from 'react';
import { X, Key, Shield, Phone, Bot, CheckCircle2, AlertCircle, RefreshCw, LogOut, Info, ExternalLink, Sparkles } from 'lucide-react';
import { AuthState, SafeConfig } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  authState: AuthState;
  config: SafeConfig | null;
  onRefreshAuth: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  authState,
  config,
  onRefreshAuth
}) => {
  const [tab, setTab] = useState<'phone' | 'bot' | 'session'>('phone');
  const [apiId, setApiId] = useState<string>(config?.apiId ? String(config.apiId) : '');
  const [apiHash, setApiHash] = useState<string>(config?.apiHash || '');
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [phoneCode, setPhoneCode] = useState<string>('');
  const [twoFaPassword, setTwoFaPassword] = useState<string>('');
  const [botToken, setBotToken] = useState<string>(config?.botToken || '');
  const [sessionString, setSessionString] = useState<string>('');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [localAwaiting2FA, setLocalAwaiting2FA] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const isConnected = authState.status === 'connected' && authState.userProfile;
  const isAwaiting2FA = authState.status === 'awaiting_2fa' || localAwaiting2FA;

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId, apiHash, phoneNumber })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send verification code');

      setSuccessMsg(data.message || `Code sent to ${phoneNumber}`);
      onRefreshAuth();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneCode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Code verification failed');

      if (data.requires2FA) {
        setLocalAwaiting2FA(true);
        setSuccessMsg('2FA Cloud Password is required for this account.');
      } else {
        setSuccessMsg('Telegram Account Connected Successfully!');
        setTimeout(() => onClose(), 1200);
      }
      onRefreshAuth();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: twoFaPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '2FA Password verification failed');

      setLocalAwaiting2FA(false);
      setSuccessMsg('2FA Verified! Telegram Account Connected.');
      onRefreshAuth();
      setTimeout(() => onClose(), 1200);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBotLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/bot-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId, apiHash, botToken })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to authenticate bot token');

      setSuccessMsg('Bot Authenticated Successfully!');
      onRefreshAuth();
      setTimeout(() => onClose(), 1200);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSessionLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/session-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId, apiHash, sessionString })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to connect with session string');

      setSuccessMsg('Session Restored Successfully!');
      onRefreshAuth();
      setTimeout(() => onClose(), 1200);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect your Telegram account?')) return;
    setIsLoading(true);
    try {
      await fetch('/api/auth/disconnect', { method: 'POST' });
      onRefreshAuth();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-800/80 text-cyan-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Telegram MTProto Connection</h2>
              <p className="text-xs text-slate-400">Secure real-time account authorization</p>
            </div>
          </div>
          <button
            id="btn-close-auth-modal"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Active Account View */}
          {isConnected ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-emerald-600 to-cyan-600 text-white font-bold flex items-center justify-center text-lg shadow-md shadow-emerald-950">
                      {authState.userProfile?.firstName?.[0] || 'U'}
                    </div>
                    <div>
                      <div className="font-bold text-white text-base">
                        {authState.userProfile?.firstName} {authState.userProfile?.lastName || ''}
                      </div>
                      <div className="text-xs text-emerald-400 flex items-center gap-1 font-mono">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {authState.userProfile?.username || authState.userProfile?.phone || 'Authenticated User'}
                      </div>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/80 text-[11px] font-semibold">
                    Live MTProto
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-900">
                  <div>
                    <span className="text-slate-500 block">Telegram ID:</span>
                    <span className="font-mono text-slate-300">{authState.userProfile?.id}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Account Type:</span>
                    <span className="text-slate-300">{authState.userProfile?.isBot ? 'Bot API' : 'User Account (Private Channel Access)'}</span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-800/40 text-xs text-cyan-200 space-y-1.5">
                <div className="flex items-center gap-1.5 font-semibold text-cyan-300">
                  <Shield className="w-4 h-4" />
                  <span>Session Security Guard</span>
                </div>
                <p className="text-slate-300 leading-relaxed text-[11px]">
                  Your Telegram authentication session is securely held in server memory. It is never transmitted over untrusted networks, never committed to git, and never exposed in the dashboard.
                </p>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  id="btn-disconnect-session"
                  onClick={handleDisconnect}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 text-red-300 text-xs font-semibold transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Disconnect Account</span>
                </button>
                <button
                  id="btn-done-connected"
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors shadow-md shadow-cyan-950"
                >
                  Close & Open Dashboard
                </button>
              </div>
            </div>
          ) : (
            /* Login Steps */
            <div className="space-y-4">
              {/* Method Switcher */}
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs font-medium">
                <button
                  onClick={() => setTab('phone')}
                  className={`py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                    tab === 'phone'
                      ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>User Phone</span>
                </button>
                <button
                  onClick={() => setTab('bot')}
                  className={`py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                    tab === 'bot'
                      ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>Bot Token</span>
                </button>
                <button
                  onClick={() => setTab('session')}
                  className={`py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                    tab === 'session'
                      ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>StringSession</span>
                </button>
              </div>

              {/* Status or Error Notifications */}
              {errorMsg && (
                <div className="p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-800/80 text-emerald-200 text-xs flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Step 1: API ID & API Hash inputs */}
              <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">Telegram API Credentials</label>
                  <a
                    href="https://my.telegram.org/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 hover:underline"
                  >
                    <span>Get from my.telegram.org</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">API ID (Numeric)</label>
                    <input
                      id="input-api-id"
                      type="text"
                      placeholder="e.g. 28491823"
                      value={apiId}
                      onChange={(e) => setApiId(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">API HASH</label>
                    <input
                      id="input-api-hash"
                      type="password"
                      placeholder="e.g. 7c9a...b4f1"
                      value={apiHash}
                      onChange={(e) => setApiHash(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* TAB 1: PHONE LOGIN (Step-by-Step) */}
              {tab === 'phone' && (
                <div>
                  {isAwaiting2FA ? (
                    /* Step 3: 2FA Password */
                    <form onSubmit={handleVerify2FA} className="space-y-3">
                      <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/50 text-xs text-amber-200">
                        <span className="font-semibold block mb-1">Two-Factor Authentication (2FA) Active</span>
                        Please enter your Cloud Password to unlock and authenticate this session.
                      </div>
                      <div>
                        <label className="text-xs text-slate-300 block mb-1">2FA Cloud Password</label>
                        <input
                          id="input-2fa-password"
                          type="password"
                          placeholder="Your Telegram 2FA Password"
                          value={twoFaPassword}
                          onChange={(e) => setTwoFaPassword(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                      <button
                        id="btn-submit-2fa"
                        type="submit"
                        disabled={isLoading || !twoFaPassword}
                        className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-cyan-950 flex items-center justify-center gap-2"
                      >
                        {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                        <span>Verify 2FA Password</span>
                      </button>
                    </form>
                  ) : authState.status === 'awaiting_code' ? (
                    /* Step 2: Verification Code */
                    <form onSubmit={handleVerifyCode} className="space-y-3">
                      <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-800/60 text-xs text-cyan-200">
                        A login code was sent to your Telegram app or SMS for phone <span className="font-mono font-bold text-white">{authState.phoneNumber || phoneNumber}</span>.
                      </div>
                      <div>
                        <label className="text-xs text-slate-300 block mb-1">Telegram Login Code</label>
                        <input
                          id="input-telegram-code"
                          type="text"
                          placeholder="e.g. 58392"
                          value={phoneCode}
                          onChange={(e) => setPhoneCode(e.target.value)}
                          className="w-full px-3 py-2.5 bg-slate-950 border border-cyan-500/60 rounded-xl text-sm font-mono text-center tracking-widest text-cyan-300 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onRefreshAuth();
                          }}
                          className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                        >
                          Back / Retry
                        </button>
                        <button
                          id="btn-submit-phone-code"
                          type="submit"
                          disabled={isLoading || !phoneCode}
                          className="flex-1 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-cyan-950 flex items-center justify-center gap-2"
                        >
                          {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                          <span>Authorize Telegram Session</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    /* Step 1: Phone Request */
                    <form onSubmit={handleRequestCode} className="space-y-3">
                      <div>
                        <label className="text-xs text-slate-300 block mb-1">Phone Number (International Format)</label>
                        <input
                          id="input-phone-number"
                          type="tel"
                          placeholder="+1234567890"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
                        />
                        <span className="text-[10px] text-slate-500 mt-1 block">
                          Must include country code (e.g., +1 for US, +44 for UK, +49 for DE)
                        </span>
                      </div>
                      <button
                        id="btn-request-code"
                        type="submit"
                        disabled={isLoading || !apiId || !apiHash || !phoneNumber}
                        className="w-full py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-cyan-950 flex items-center justify-center gap-2"
                      >
                        {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                        <span>Send Verification Code</span>
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* TAB 2: BOT TOKEN LOGIN */}
              {tab === 'bot' && (
                <form onSubmit={handleBotLogin} className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-300 block mb-1">Bot Token (from @BotFather)</label>
                    <input
                      id="input-bot-token"
                      type="password"
                      placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">
                      Note: Bot accounts cannot read private channels they aren't invited to as admin.
                    </span>
                  </div>
                  <button
                    id="btn-login-bot"
                    type="submit"
                    disabled={isLoading || !apiId || !apiHash || !botToken}
                    className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-cyan-950 flex items-center justify-center gap-2"
                  >
                    {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                    <span>Connect Bot Token</span>
                  </button>
                </form>
              )}

              {/* TAB 3: STRING SESSION IMPORT */}
              {tab === 'session' && (
                <form onSubmit={handleSessionLogin} className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-300 block mb-1">Paste StringSession</label>
                    <textarea
                      id="input-session-string"
                      rows={3}
                      placeholder="1BVtsOHQBu... (Telethon or GramJS StringSession)"
                      value={sessionString}
                      onChange={(e) => setSessionString(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 font-mono resize-none"
                    />
                  </div>
                  <button
                    id="btn-login-session"
                    type="submit"
                    disabled={isLoading || !apiId || !apiHash || !sessionString}
                    className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-cyan-950 flex items-center justify-center gap-2"
                  >
                    {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                    <span>Connect Session String</span>
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
