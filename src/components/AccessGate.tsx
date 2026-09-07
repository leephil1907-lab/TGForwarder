import React, { useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';
import { setStoredToken } from '../lib/authToken';

interface AccessGateProps {
  onUnlock: (token: string) => void;
  error?: string | null;
}

export function AccessGate({ onUnlock, error }: AccessGateProps) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setStoredToken(trimmed);
    onUnlock(trimmed);
    setSubmitting(false);
  };

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
        <p className="text-sm text-slate-400 mb-4">
          Enter the access token printed in the server console (or set via <code className="text-slate-300">APP_AUTH_TOKEN</code>) to unlock this dashboard.
        </p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Access token"
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm mb-3 outline-none focus:border-sky-500"
        />
        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !value.trim()}
          className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-medium rounded-lg px-3 py-2 text-sm transition"
        >
          Unlock <ArrowRight size={16} />
        </button>
      </form>
    </div>
  );
}
