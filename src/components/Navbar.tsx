import React from 'react';
import { Play, Pause, Shield, Key, RefreshCw, Radio, CheckCircle2, AlertCircle } from 'lucide-react';
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
  isEngineLoading
}) => {
  const isConnected = authState.status === 'connected' && authState.userProfile;

  return (
    <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20 text-white font-bold">
              <Radio className="w-5 h-5" />
              {isEngineRunning && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold tracking-tight text-white font-['Plus_Jakarta_Sans']">
                  TGForwarder <span className="text-cyan-400 text-sm px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60">PRO</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">Private Channel ➔ Target Channel Forwarding Engine</p>
            </div>
          </div>

          {/* Controls & Account */}
          <div className="flex items-center gap-3">
            {/* Telegram Account Pill */}
            {isConnected ? (
              <button
                id="btn-account-profile"
                onClick={onOpenAuth}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors text-left text-xs"
              >
                <div className="w-6 h-6 rounded-full bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 font-semibold flex items-center justify-center text-[10px]">
                  {authState.userProfile?.firstName?.[0] || 'U'}
                </div>
                <div className="hidden md:block">
                  <div className="text-slate-200 font-medium leading-none truncate max-w-[120px]">
                    {authState.userProfile?.firstName}
                  </div>
                  <div className="text-[10px] text-emerald-400 leading-none mt-1 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    {authState.userProfile?.username || authState.userProfile?.phone || 'Online'}
                  </div>
                </div>
              </button>
            ) : (
              <button
                id="btn-connect-telegram"
                onClick={onOpenAuth}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 text-xs font-semibold transition-all shadow-sm shadow-cyan-950"
              >
                <Key className="w-3.5 h-3.5" />
                <span>Connect Telegram</span>
              </button>
            )}

            {/* Automation Master Button */}
            <button
              id="btn-toggle-engine"
              onClick={onToggleEngine}
              disabled={!isConnected || isEngineLoading}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-lg ${
                !isConnected
                  ? 'bg-slate-800/80 text-slate-500 border border-slate-700 cursor-not-allowed'
                  : isEngineRunning
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/60 border border-emerald-400/40 ring-2 ring-emerald-500/20'
                  : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-950/60 border border-cyan-400/40'
              }`}
            >
              {isEngineLoading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : isEngineRunning ? (
                <Pause className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span className="hidden sm:inline">
                {isEngineLoading ? 'Updating...' : isEngineRunning ? 'Engine Active' : 'Start Forwarder'}
              </span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex space-x-1 sm:space-x-2 border-t border-slate-900 pt-2 pb-2 overflow-x-auto no-scrollbar text-xs">
          {[
            { id: 'funnel', label: 'Pipeline Funnel', badge: stats.activeRulesCount > 0 ? stats.activeRulesCount : null },
            { id: 'chats', label: 'Discovered Chats', icon: '🔎' },
            { id: 'console', label: 'Live Console', badge: stats.totalForwarded > 0 ? `${stats.totalForwarded} sent` : null },
            { id: 'stats', label: 'Analytics & Duplicates' },
            { id: 'python', label: 'CLI & Python Daemon' }
          ].map((tab) => (
            <button
              key={tab.id}
              id={`nav-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="px-1.5 py-0.2 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800/80 text-[10px] font-mono font-semibold">
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
