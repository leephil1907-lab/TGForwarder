import React from 'react';
import { Play, Pause, Key, RefreshCw } from 'lucide-react';
import { AuthState, EngineStats } from '../types';

interface NavbarProps {
  authState: AuthState;
  isEngineRunning: boolean;
  stats: EngineStats;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenAuth: () => void;
  onToggleEngine: () => void;
  isEngineLoading: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  authState,
  isEngineRunning,
  stats,
  activeTab,
  setActiveTab,
  onOpenAuth,
  onToggleEngine,
  isEngineLoading,
}) => {
  const isConnected = authState.status === 'connected' && Boolean(authState.userProfile);

  const tabs = [
    {
      id: 'funnel',
      label: 'Pipeline Funnel',
      badge: stats.activeRulesCount > 0 ? stats.activeRulesCount : null,
    },
    { id: 'chats', label: 'Discovered Chats' },
    { id: 'history', label: 'Source History' },
    {
      id: 'console',
      label: 'Live Console',
      badge: stats.totalForwarded > 0 ? `${stats.totalForwarded} sent` : null,
    },
    { id: 'stats', label: 'Analytics & Duplicates' },
    { id: 'python', label: 'CLI & Python Daemon' },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-cyan-400/30 bg-slate-950 shadow-lg shadow-cyan-500/10">
              <img
                src="/tgforwarder-mark.svg"
                alt="TGForwarder Pro"
                className="h-full w-full object-cover"
              />
              {isEngineRunning && (
                <span className="absolute -right-1 -top-1 flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                </span>
              )}
            </div>

            <div>
              <div className="text-lg font-bold tracking-tight text-white">
                TGForwarder{' '}
                <span className="rounded border border-cyan-800/60 bg-cyan-950/60 px-1.5 py-0.5 text-sm text-cyan-400">
                  PRO
                </span>
              </div>
              <p className="hidden text-xs text-slate-400 sm:block">
                Precision Source → Target Telegram Automation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isConnected ? (
              <button
                onClick={onOpenAuth}
                className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-left text-xs hover:border-slate-700"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-600/30 text-[10px] font-semibold text-cyan-300">
                  {authState.userProfile?.firstName?.[0] || 'U'}
                </div>
                <div className="hidden md:block">
                  <div className="max-w-[120px] truncate font-medium leading-none text-slate-200">
                    {authState.userProfile?.firstName}
                  </div>
                  <div className="mt-1 text-[10px] leading-none text-emerald-400">
                    {authState.userProfile?.username || authState.userProfile?.phone || 'Online'}
                  </div>
                </div>
              </button>
            ) : (
              <button
                onClick={onOpenAuth}
                className="flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-600/20 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-600/30"
              >
                <Key className="h-3.5 w-3.5" />
                Connect Telegram
              </button>
            )}

            <button
              onClick={onToggleEngine}
              disabled={!isConnected || isEngineLoading}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold shadow-lg transition-all ${
                !isConnected
                  ? 'cursor-not-allowed border border-slate-700 bg-slate-800/80 text-slate-500'
                  : isEngineRunning
                    ? 'border border-emerald-400/40 bg-emerald-600 text-white hover:bg-emerald-500'
                    : 'border border-cyan-400/40 bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-500 hover:to-blue-500'
              }`}
            >
              {isEngineLoading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : isEngineRunning ? (
                <Pause className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              <span className="hidden sm:inline">
                {isEngineLoading ? 'Updating...' : isEngineRunning ? 'Engine Active' : 'Start Forwarder'}
              </span>
            </button>
          </div>
        </div>

        <nav className="no-scrollbar flex space-x-1 overflow-x-auto border-t border-slate-900 pb-2 pt-2 text-xs sm:space-x-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`nav-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
                  : 'text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge !== null && tab.badge !== undefined && (
                <span className="rounded-full border border-cyan-800/80 bg-cyan-950 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
};
