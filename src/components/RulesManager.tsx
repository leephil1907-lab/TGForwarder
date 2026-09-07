import React, { useState, useEffect } from 'react';
import {
  Plus, ArrowRight, Shield, Trash2, Edit3, Check, RefreshCw, Send,
  Lock, Users, Radio, Filter, FileText, Image, Video, Music, Mic, File, Smile, Film,
  UserCheck, Sliders, Zap
} from 'lucide-react';
import { ForwardingRule, DiscoveredChat, SafeTelegramAccount, MessageTypeFilter, SenderFilter } from '../types';

interface RulesManagerProps {
  rules?: ForwardingRule[];
  accounts?: SafeTelegramAccount[];
  discoveredChats?: DiscoveredChat[];
  isEngineRunning: boolean;
  onRefreshRules: () => void;
  onOpenDiscovery: () => void;
  quickSourceChat?: DiscoveredChat | null;
  quickTargetChat?: DiscoveredChat | null;
  onClearQuickSelection?: () => void;
}

const DEFAULT_MEDIA_FILTER: MessageTypeFilter = {
  allowText: true,
  allowPhoto: true,
  allowVideo: true,
  allowAudio: true,
  allowVoice: true,
  allowDocument: true,
  allowSticker: true,
  allowAnimation: true
};

const DEFAULT_SENDER_FILTER: SenderFilter = {
  enabled: false,
  mode: 'blacklist',
  senderIds: [],
  ignoreBots: false
};

export const RulesManager: React.FC<RulesManagerProps> = ({
  rules = [],
  accounts = [],
  discoveredChats = [],
  isEngineRunning,
  onRefreshRules,
  onOpenDiscovery,
  quickSourceChat,
  quickTargetChat,
  onClearQuickSelection
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('all');
  const [sourceId, setSourceId] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [targetIdInput, setTargetIdInput] = useState('');
  const [targetTitlesInput, setTargetTitlesInput] = useState('');

  // Signature & Copy Settings
  const [removeForwardSignature, setRemoveForwardSignature] = useState(true);
  const [duplicateProtection, setDuplicateProtection] = useState(true);
  const [preserveFormatting, setPreserveFormatting] = useState(true);
  const [dropLinks, setDropLinks] = useState(false);
  const [prependText, setPrependText] = useState('');
  const [appendText, setAppendText] = useState('');

  // Granular Filters
  const [useKeywordFilter, setUseKeywordFilter] = useState(false);
  const [includeKeywordsStr, setIncludeKeywordsStr] = useState('');
  const [excludeKeywordsStr, setExcludeKeywordsStr] = useState('');
  const [mediaFilter, setMediaFilter] = useState<MessageTypeFilter>({ ...DEFAULT_MEDIA_FILTER });
  const [senderFilter, setSenderFilter] = useState<SenderFilter>({ ...DEFAULT_SENDER_FILTER });
  const [senderIdsStr, setSenderIdsStr] = useState('');

  const [testStatus, setTestStatus] = useState<{ [ruleId: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (quickSourceChat) {
      setIsCreating(true);
      setSourceId(quickSourceChat.id);
      setSourceTitle(quickSourceChat.title);
      setName((prev) => prev || `Pipeline: ${quickSourceChat.title}`);
      if (quickSourceChat.accountId) setAccountId(quickSourceChat.accountId);
    }
  }, [quickSourceChat]);

  useEffect(() => {
    if (quickTargetChat) {
      setIsCreating(true);
      setTargetIdInput((prev) => {
        const list = prev ? prev.split(',').map((s) => s.trim()).filter(Boolean) : [];
        if (!list.includes(quickTargetChat.id)) list.push(quickTargetChat.id);
        return list.join(', ');
      });
      setTargetTitlesInput((prev) => {
        const list = prev ? prev.split(',').map((s) => s.trim()).filter(Boolean) : [];
        if (!list.includes(quickTargetChat.title)) list.push(quickTargetChat.title);
        return list.join(', ');
      });
    }
  }, [quickTargetChat]);

  const resetForm = () => {
    setName('');
    setAccountId('all');
    setSourceId('');
    setSourceTitle('');
    setTargetIdInput('');
    setTargetTitlesInput('');
    setRemoveForwardSignature(true);
    setDuplicateProtection(true);
    setPreserveFormatting(true);
    setDropLinks(false);
    setPrependText('');
    setAppendText('');
    setUseKeywordFilter(false);
    setIncludeKeywordsStr('');
    setExcludeKeywordsStr('');
    setMediaFilter({ ...DEFAULT_MEDIA_FILTER });
    setSenderFilter({ ...DEFAULT_SENDER_FILTER });
    setSenderIdsStr('');
    setIsCreating(false);
    setEditingRuleId(null);
  };

  const handleEditRule = (rule: ForwardingRule) => {
    setEditingRuleId(rule.id);
    setName(rule.name);
    setAccountId(rule.accountId || 'all');
    setSourceId(rule.sourceId);
    setSourceTitle(rule.sourceTitle);
    setTargetIdInput(rule.targetIds.join(', '));
    setTargetTitlesInput(rule.targetTitles.join(', '));
    setRemoveForwardSignature(rule.removeForwardSignature);
    setDuplicateProtection(rule.duplicateProtection);
    setPreserveFormatting(rule.preserveFormatting ?? true);
    setDropLinks(rule.dropLinks ?? false);
    setPrependText(rule.prependText || '');
    setAppendText(rule.appendText || '');
    setUseKeywordFilter(rule.useKeywordFilter ?? false);
    setIncludeKeywordsStr((rule.includeKeywords || []).join(', '));
    setExcludeKeywordsStr((rule.excludeKeywords || []).join(', '));
    setMediaFilter(rule.mediaFilter || { ...DEFAULT_MEDIA_FILTER });
    setSenderFilter(rule.senderFilter || { ...DEFAULT_SENDER_FILTER });
    setSenderIdsStr((rule.senderFilter?.senderIds || []).join(', '));
    setIsCreating(true);
  };

  const handleSourceSelect = (chatId: string) => {
    const chat = discoveredChats.find((c) => c.id === chatId);
    if (chat) {
      setSourceId(chat.id);
      setSourceTitle(chat.title);
      if (!name) setName(`Funnel: ${chat.title}`);
      if (chat.accountId) setAccountId(chat.accountId);
    }
  };

  const handleTargetAdd = (chatId: string) => {
    const chat = discoveredChats.find((c) => c.id === chatId);
    if (!chat) return;

    const currentTargets = targetIdInput ? targetIdInput.split(',').map((t) => t.trim()) : [];
    const currentTitles = targetTitlesInput ? targetTitlesInput.split(',').map((t) => t.trim()) : [];

    if (!currentTargets.includes(chat.id)) {
      currentTargets.push(chat.id);
      currentTitles.push(chat.title);
      setTargetIdInput(currentTargets.join(', '));
      setTargetTitlesInput(currentTitles.join(', '));
    }
  };

  const handleSubmitRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceId || !targetIdInput) return;

    setIsSubmitting(true);
    const targetIds = targetIdInput.split(',').map((t) => t.trim()).filter(Boolean);
    const targetTitles = targetTitlesInput
      ? targetTitlesInput.split(',').map((t) => t.trim()).filter(Boolean)
      : targetIds;

    const includeKeywords = includeKeywordsStr.split(',').map((k) => k.trim()).filter(Boolean);
    const excludeKeywords = excludeKeywordsStr.split(',').map((k) => k.trim()).filter(Boolean);
    const parsedSenderIds = senderIdsStr.split(',').map((s) => s.trim()).filter(Boolean);

    const payload = {
      name: name || `Funnel: ${sourceTitle || sourceId}`,
      accountId,
      sourceId,
      sourceTitle: sourceTitle || sourceId,
      targetIds,
      targetTitles,
      removeForwardSignature,
      duplicateProtection,
      preserveFormatting,
      dropLinks,
      prependText,
      appendText,
      useKeywordFilter: Boolean(useKeywordFilter || includeKeywords.length > 0 || excludeKeywords.length > 0),
      includeKeywords,
      excludeKeywords,
      mediaFilter,
      senderFilter: {
        ...senderFilter,
        senderIds: parsedSenderIds
      },
      enabled: true
    };

    try {
      if (editingRuleId) {
        await fetch(`/api/rules/${editingRuleId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        await fetch('/api/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      resetForm();
      onRefreshRules();
    } catch (err) {
      console.error('Failed to save rule:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleRule = async (rule: ForwardingRule) => {
    try {
      await fetch(`/api/rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled })
      });
      onRefreshRules();
    } catch (err) {
      console.error('Error toggling rule:', err);
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm('Delete this forwarding pipeline funnel?')) return;
    try {
      await fetch(`/api/rules/${id}`, { method: 'DELETE' });
      onRefreshRules();
    } catch (err) {
      console.error('Error deleting rule:', err);
    }
  };

  const handleTestTargetAccess = async (rule: ForwardingRule) => {
    if (!rule.targetIds || rule.targetIds.length === 0) return;
    const targetId = rule.targetIds[0];
    setTestStatus((prev) => ({ ...prev, [rule.id]: 'Testing access...' }));

    try {
      const res = await fetch('/api/chats/test-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId, accountId: rule.accountId !== 'all' ? rule.accountId : undefined })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Access check failed');

      setTestStatus((prev) => ({ ...prev, [rule.id]: `Verified (${data.title || 'OK'})` }));
      setTimeout(() => {
        setTestStatus((prev) => {
          const next = { ...prev };
          delete next[rule.id];
          return next;
        });
      }, 4000);
    } catch (err: any) {
      setTestStatus((prev) => ({ ...prev, [rule.id]: `Failed: ${err.message}` }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-800 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white tracking-tight">Active Pipeline Funnels & Filters</h1>
            <span className="px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 text-xs font-mono font-bold">
              {rules.length} Configured
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Define multi-account source monitors, keyword whitelists/blacklists, media selectors, and destination relays.
          </p>
        </div>

        <button
          id="btn-create-funnel"
          onClick={() => {
            if (isCreating) resetForm();
            else setIsCreating(true);
          }}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold transition-all shadow-md shadow-cyan-950 flex items-center justify-center gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{isCreating ? 'Close Creator' : 'New Funnel Pipeline'}</span>
        </button>
      </div>

      {/* Rule Creator / Editor Drawer */}
      {isCreating && (
        <form onSubmit={handleSubmitRule} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-5 animate-in fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>{editingRuleId ? 'Edit Forwarding Pipeline' : 'Create High-Precision Funnel Pipeline'}</span>
            </h2>
            <button type="button" onClick={resetForm} className="text-xs text-slate-400 hover:text-white">
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left Column: Account & Routing */}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Pipeline Name</label>
                <input
                  type="text"
                  placeholder="e.g. VIP Signals -> Archive + Client Channel"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Account Binding */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Assigned Telegram Account</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="all">⚡ Any Connected Account (Default)</option>
                  {(accounts || []).map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name || acc.userProfile?.firstName || acc.phone || acc.id} ({acc.username || acc.userProfile?.username || acc.phone || (acc.userProfile?.isBot ? 'Bot' : 'User')})
                    </option>
                  ))}
                </select>
              </div>

              {/* Source Chat */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">Source Channel / Group ID</label>
                  {discoveredChats.length > 0 && (
                    <span className="text-[11px] text-cyan-400 cursor-pointer" onClick={onOpenDiscovery}>
                      Pick from Dialogs ➔
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="-1001234567890 or @source_channel"
                    value={sourceId}
                    onChange={(e) => {
                      setSourceId(e.target.value);
                      handleSourceSelect(e.target.value);
                    }}
                    required
                    className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                  {discoveredChats.length > 0 && (
                    <select
                      onChange={(e) => handleSourceSelect(e.target.value)}
                      value=""
                      className="px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400 focus:outline-none max-w-[140px]"
                    >
                      <option value="">Quick Dialog</option>
                      {discoveredChats.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Destination Targets */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">Destination Channels (Comma separated)</label>
                  {discoveredChats.length > 0 && (
                    <span className="text-[11px] text-emerald-400">Add Target +</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="-1009876543210, -1005544332211"
                    value={targetIdInput}
                    onChange={(e) => setTargetIdInput(e.target.value)}
                    required
                    className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                  {discoveredChats.length > 0 && (
                    <select
                      onChange={(e) => handleTargetAdd(e.target.value)}
                      value=""
                      className="px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-400 focus:outline-none max-w-[140px]"
                    >
                      <option value="">Add Target</option>
                      {discoveredChats.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Header/Footer modifications */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Prepend Header Text</label>
                  <input
                    type="text"
                    placeholder="e.g. 🚨 [VIP SIGNAL]"
                    value={prependText}
                    onChange={(e) => setPrependText(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Append Footer Text</label>
                  <input
                    type="text"
                    placeholder="e.g. Join @myvipchannel"
                    value={appendText}
                    onChange={(e) => setAppendText(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>

            {/* Right Column: Filters & Media Selectors */}
            <div className="space-y-4">
              {/* Media Type Selectors */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
                  <span>Allowed Content & Media Types</span>
                  <span className="text-[10px] text-cyan-400 font-normal">Selective copy filter</span>
                </label>
                <div className="grid grid-cols-4 gap-1.5 text-xs">
                  {[
                    { key: 'allowText', label: 'Text', icon: FileText },
                    { key: 'allowPhoto', label: 'Photos', icon: Image },
                    { key: 'allowVideo', label: 'Videos', icon: Video },
                    { key: 'allowAudio', label: 'Audio', icon: Music },
                    { key: 'allowVoice', label: 'Voice', icon: Mic },
                    { key: 'allowDocument', label: 'Docs', icon: File },
                    { key: 'allowSticker', label: 'Stickers', icon: Smile },
                    { key: 'allowAnimation', label: 'GIFs', icon: Film }
                  ].map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setMediaFilter((prev) => ({ ...prev, [key]: !prev[key as keyof MessageTypeFilter] }))}
                      className={`p-2 rounded-lg border flex flex-col items-center justify-center gap-1 transition-all ${
                        mediaFilter[key as keyof MessageTypeFilter]
                          ? 'bg-cyan-950/60 border-cyan-500/50 text-cyan-300 font-semibold'
                          : 'bg-slate-900 border-slate-800 text-slate-500'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span className="text-[10px]">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Keyword Filters */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Filter className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Keyword Filters (Whitelist & Blacklist)</span>
                  </label>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-[11px] text-emerald-400 block mb-0.5">
                      Include Keywords (Whitelist - post must contain at least one)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. BTC, BUY, LONG, TARGET (comma separated)"
                      value={includeKeywordsStr}
                      onChange={(e) => setIncludeKeywordsStr(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-amber-400 block mb-0.5">
                      Exclude Keywords (Blacklist - skip messages containing any)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. promo, sponsor, ad, discount, contact (comma separated)"
                      value={excludeKeywordsStr}
                      onChange={(e) => setExcludeKeywordsStr(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              </div>

              {/* Sender Filter */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-purple-400" />
                    <span>Sender Filtering</span>
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={senderFilter.ignoreBots}
                      onChange={(e) => setSenderFilter((prev) => ({ ...prev, ignoreBots: e.target.checked }))}
                      className="w-3.5 h-3.5 text-cyan-500 rounded bg-slate-900 border-slate-700"
                    />
                    <span>Ignore Bots</span>
                  </label>
                </div>
                <input
                  type="text"
                  placeholder="Whitelist/Blacklist Sender IDs or @usernames (e.g. @admin, 98765432)"
                  value={senderIdsStr}
                  onChange={(e) => {
                    setSenderIdsStr(e.target.value);
                    setSenderFilter((prev) => ({ ...prev, enabled: Boolean(e.target.value.trim() || prev.ignoreBots) }));
                  }}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={removeForwardSignature}
                    onChange={(e) => setRemoveForwardSignature(e.target.checked)}
                    className="w-4 h-4 text-cyan-500 rounded bg-slate-900 border-slate-700"
                  />
                  <span className="text-slate-300 font-medium">Clean Repost (Hide Sender)</span>
                </label>

                <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={duplicateProtection}
                    onChange={(e) => setDuplicateProtection(e.target.checked)}
                    className="w-4 h-4 text-cyan-500 rounded bg-slate-900 border-slate-700"
                  />
                  <span className="text-slate-300 font-medium">MD5 Duplicate Shield</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !sourceId || !targetIdInput}
              className="px-6 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-md shadow-cyan-950 flex items-center gap-1.5"
            >
              {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              <span>{editingRuleId ? 'Update Pipeline' : 'Save & Activate Pipeline'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Rules List */}
      {rules.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-slate-900/50 border border-slate-800 space-y-3">
          <Shield className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-white">No Forwarding Pipelines Configured</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Create your first funnel to relay posts from any private channel or group to your destination channels.
          </p>
          <button
            onClick={() => setIsCreating(true)}
            className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Create First Pipeline</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {(rules || []).map((rule) => {
            const hasKeywords = (rule.includeKeywords?.length || 0) > 0 || (rule.excludeKeywords?.length || 0) > 0;
            const assignedAccount = (accounts || []).find((a) => a?.id === rule.accountId);

            return (
              <div
                key={rule.id}
                className={`p-5 rounded-2xl border transition-all ${
                  rule.enabled
                    ? 'bg-slate-900/90 border-slate-800 hover:border-slate-700 shadow-xl'
                    : 'bg-slate-900/40 border-slate-800/40 opacity-70'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`w-2.5 h-2.5 rounded-full ${rule.enabled && isEngineRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}></span>
                      <h3 className="text-sm font-bold text-white">{rule.name}</h3>
                      <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] font-mono text-cyan-300">
                        {assignedAccount ? (assignedAccount.name || assignedAccount.userProfile?.firstName || assignedAccount.phone || assignedAccount.id) : 'All Accounts'}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-400">
                        {rule.removeForwardSignature ? 'Clean Repost' : 'Native Forward'}
                      </span>
                    </div>

                    {/* Routing Path */}
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <div className="px-2.5 py-1 rounded-lg bg-cyan-950/60 border border-cyan-800/60 text-cyan-300 font-medium flex items-center gap-1.5">
                        <Radio className="w-3.5 h-3.5" />
                        <span>{rule.sourceTitle}</span>
                        <span className="text-[10px] font-mono text-cyan-400/80">({rule.sourceId})</span>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-500" />
                      <div className="px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 font-medium flex items-center gap-1.5">
                        <Send className="w-3.5 h-3.5" />
                        <span>{rule.targetTitles.join(', ')}</span>
                      </div>
                    </div>

                    {/* Active Filter Badges */}
                    <div className="flex items-center gap-2 text-[10px] flex-wrap pt-1">
                      {rule.duplicateProtection && (
                        <span className="px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                          🛡️ Duplicate Hash Protected
                        </span>
                      )}
                      {hasKeywords && (
                        <span className="px-2 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/60">
                          🔍 Keywords Filtered ({rule.includeKeywords?.length || 0} inc, {rule.excludeKeywords?.length || 0} exc)
                        </span>
                      )}
                      {rule.senderFilter?.ignoreBots && (
                        <span className="px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/60">
                          🤖 Bots Excluded
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleTestTargetAccess(rule)}
                      className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-cyan-500 text-slate-300 text-xs font-semibold transition-colors"
                    >
                      {testStatus[rule.id] || 'Test Access'}
                    </button>
                    <button
                      onClick={() => handleToggleRule(rule)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                        rule.enabled
                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {rule.enabled ? 'Enabled' : 'Paused'}
                    </button>
                    <button
                      onClick={() => handleEditRule(rule)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                      title="Edit Pipeline"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      className="p-2 rounded-xl bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-900/40 transition-colors"
                      title="Delete Pipeline"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
