import React, { useState } from 'react';
import { Search, RefreshCw, Lock, Users, Radio, MessageSquare, Bot, Copy, Check, Send, Plus, ArrowRight, ExternalLink } from 'lucide-react';
import { DiscoveredChat, AuthState } from '../types';

interface ChatExplorerProps {
  discoveredChats: DiscoveredChat[];
  isScanning: boolean;
  onScanChats: () => void;
  onSelectAsSource: (chat: DiscoveredChat) => void;
  onSelectAsTarget: (chat: DiscoveredChat) => void;
  authState: AuthState;
}

export const ChatExplorer: React.FC<ChatExplorerProps> = ({
  discoveredChats,
  isScanning,
  onScanChats,
  onSelectAsSource,
  onSelectAsTarget,
  authState
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'channel' | 'group' | 'supergroup' | 'user'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [manualId, setManualId] = useState('');
  const [manualTitle, setManualTitle] = useState('');

  const isConnected = authState.status === 'connected';

  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredChats = discoveredChats.filter((chat) => {
    const matchesSearch =
      chat.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      chat.id.includes(searchQuery) ||
      (chat.username && chat.username.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;
    if (filterType === 'all') return true;
    if (filterType === 'group') return chat.type === 'group' || chat.type === 'supergroup';
    return chat.type === filterType;
  });

  const getChatIcon = (type: DiscoveredChat['type'], isPrivate: boolean) => {
    switch (type) {
      case 'channel':
        return isPrivate ? <Lock className="w-4 h-4 text-amber-400" /> : <Radio className="w-4 h-4 text-cyan-400" />;
      case 'supergroup':
      case 'group':
        return <Users className="w-4 h-4 text-emerald-400" />;
      case 'bot':
        return <Bot className="w-4 h-4 text-purple-400" />;
      default:
        return <MessageSquare className="w-4 h-4 text-blue-400" />;
    }
  };

  const handleAddManual = (asRole: 'source' | 'target') => {
    if (!manualId.trim()) return;
    const customChat: DiscoveredChat = {
      id: manualId.trim(),
      title: manualTitle.trim() || `Chat (${manualId.trim()})`,
      type: 'channel',
      isPrivate: true
    };
    if (asRole === 'source') {
      onSelectAsSource(customChat);
    } else {
      onSelectAsTarget(customChat);
    }
    setManualId('');
    setManualTitle('');
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white tracking-tight">Telegram Chat & Channel Discovery</h1>
            <span className="px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 text-xs font-mono font-bold">
              {discoveredChats.length} Discovered
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Real MTProto scan: Fetches all private channels, groups, and dialogs accessible by your Telegram account.
          </p>
        </div>

        <button
          id="btn-scan-chats"
          onClick={onScanChats}
          disabled={!isConnected || isScanning}
          className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md shadow-cyan-950 flex items-center justify-center gap-2 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
          <span>{isScanning ? 'Scanning Account...' : 'Scan / Refresh Dialogs'}</span>
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            id="input-search-chats"
            type="text"
            placeholder="Search title, @username, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 font-medium"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex space-x-1 p-1 bg-slate-900/80 rounded-xl border border-slate-800 text-xs font-medium w-full sm:w-auto overflow-x-auto">
          {[
            { id: 'all', label: 'All' },
            { id: 'channel', label: 'Channels' },
            { id: 'group', label: 'Groups' },
            { id: 'user', label: 'Direct Chats' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id as any)}
              className={`px-3 py-1 rounded-lg transition-colors whitespace-nowrap ${
                filterType === tab.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Discovered Chats Grid */}
      {discoveredChats.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-slate-900/50 border border-slate-800 space-y-3">
          <Users className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-white">No Dialogs Discovered Yet</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {isConnected
              ? 'Click "Scan / Refresh Dialogs" above to query your Telegram channels and private groups.'
              : 'Connect your Telegram account in the top-right corner to discover private channels and groups.'}
          </p>
          {isConnected && (
            <button
              onClick={onScanChats}
              disabled={isScanning}
              className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors inline-flex items-center gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>Scan Now</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredChats.map((chat) => (
            <div
              key={chat.id}
              className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 shrink-0">
                      {getChatIcon(chat.type, chat.isPrivate)}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-white truncate">{chat.title}</h4>
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <span className="capitalize">{chat.type}</span>
                        {chat.isPrivate ? ' • Private' : ' • Public'}
                        {chat.username && ` • ${chat.username}`}
                      </span>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-400 shrink-0">
                    {chat.participantsCount ? `${chat.participantsCount} mem` : 'Active'}
                  </span>
                </div>

                {/* ID badge with copy */}
                <div className="flex items-center justify-between p-1.5 rounded-lg bg-slate-950 border border-slate-800/80 text-[11px] font-mono text-slate-300">
                  <span className="truncate max-w-[170px]">{chat.id}</span>
                  <button
                    onClick={() => handleCopy(chat.id)}
                    className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-900 transition-colors"
                    title="Copy Telegram ID"
                  >
                    {copiedId === chat.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Quick Funnel Actions */}
              <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-slate-800/80 text-xs">
                <button
                  id={`btn-set-source-${chat.id}`}
                  onClick={() => onSelectAsSource(chat)}
                  className="px-2.5 py-1.5 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-800/60 text-cyan-300 text-[11px] font-semibold transition-colors flex items-center justify-center gap-1"
                >
                  <Radio className="w-3 h-3" />
                  <span>Use as Source</span>
                </button>
                <button
                  id={`btn-set-target-${chat.id}`}
                  onClick={() => onSelectAsTarget(chat)}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-800/60 text-emerald-300 text-[11px] font-semibold transition-colors flex items-center justify-center gap-1"
                >
                  <Send className="w-3 h-3" />
                  <span>Use as Target</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Manual Chat Adder Card */}
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
          Manual Channel / Group ID Direct Mapper
        </h3>
        <p className="text-xs text-slate-400">
          Need to forward from an archived or non-dialog private channel? Enter its ID directly (e.g. <code className="text-cyan-300">-1001928374829</code> or <code className="text-cyan-300">@username</code>).
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="Telegram ID or Username"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
          />
          <input
            type="text"
            placeholder="Label (e.g. VIP Private 2)"
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
            className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleAddManual('source')}
              disabled={!manualId.trim()}
              className="flex-1 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors"
            >
              + To Source
            </button>
            <button
              onClick={() => handleAddManual('target')}
              disabled={!manualId.trim()}
              className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors"
            >
              + To Target
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
