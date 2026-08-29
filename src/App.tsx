import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { AuthModal } from './components/AuthModal';
import { RulesManager } from './components/RulesManager';
import { ChatExplorer } from './components/ChatExplorer';
import { LiveConsole } from './components/LiveConsole';
import { StatsCards } from './components/StatsCards';
import { PythonExporter } from './components/PythonExporter';
import { RateLimitModal } from './components/RateLimitModal';
import { AuthState, SafeConfig, DiscoveredChat, ActivityLog, EngineStats, ForwardingRule, RateLimitConfig, SafeTelegramAccount } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('funnel');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isRateLimitModalOpen, setIsRateLimitModalOpen] = useState<boolean>(false);

  // Core App State
  const [authState, setAuthState] = useState<AuthState>({ status: 'disconnected', userProfile: null });
  const [config, setConfig] = useState<SafeConfig | null>(null);
  const [discoveredChats, setDiscoveredChats] = useState<DiscoveredChat[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [stats, setStats] = useState<EngineStats>({
    totalReceived: 0,
    totalForwarded: 0,
    totalFailed: 0,
    duplicatesBlocked: 0,
    filtersTriggered: 0,
    activeRulesCount: 0,
    uptimeSeconds: 0,
    lastActiveTime: null,
    startTime: null
  });

  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isEngineLoading, setIsEngineLoading] = useState<boolean>(false);
  const [quickSourceChat, setQuickSourceChat] = useState<DiscoveredChat | null>(null);
  const [quickTargetChat, setQuickTargetChat] = useState<DiscoveredChat | null>(null);

  // Fetch initial data
  const fetchData = useCallback(async () => {
    try {
      const [configRes, authRes, statsRes, logsRes] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/auth/status'),
        fetch('/api/stats'),
        fetch('/api/logs')
      ]);

      if (configRes.ok) {
        const configData = await configRes.json();
        setConfig(configData);
      }
      if (authRes.ok) {
        const authData = await authRes.json();
        setAuthState(authData);
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setLogs(logsData);
      }
    } catch (err) {
      console.error('Error loading initial data:', err);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Setup Server-Sent Events (SSE) stream for real-time live events
    let eventSource: EventSource | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let isMounted = true;

    const connectSSE = () => {
      if (!isMounted) return;
      if (eventSource) {
        try {
          eventSource.close();
        } catch (e) {
          // ignore
        }
      }

      eventSource = new EventSource('/api/stream');

      eventSource.onopen = () => {
        // SSE connected
      };

      eventSource.onmessage = (event) => {
        try {
          if (!event.data || event.data.startsWith(':')) return; // ignore comments / heartbeats
          const data = JSON.parse(event.data);
          if (!data || !data.type) return;

          switch (data.type) {
            case 'INIT_SNAPSHOT':
              if (data.payload.authState) setAuthState(data.payload.authState);
              if (data.payload.stats) setStats(data.payload.stats);
              if (data.payload.recentLogs) setLogs(data.payload.recentLogs);
              if (typeof data.payload.isEngineRunning === 'boolean') {
                setConfig((prev) => prev ? { ...prev, isEngineRunning: data.payload.isEngineRunning } : null);
              }
              break;

            case 'NEW_LOG':
              setLogs((prev) => [...prev.slice(-250), data.payload]);
              break;

            case 'STATS_UPDATED':
              setStats(data.payload);
              break;

            case 'AUTH_STATUS_CHANGED':
              setAuthState(data.payload);
              break;

            case 'ENGINE_STATE_CHANGED':
              setConfig((prev) => prev ? { ...prev, isEngineRunning: data.payload.isRunning } : null);
              break;

            default:
              break;
          }
        } catch (err) {
          console.error('Error parsing SSE event:', err);
        }
      };

      eventSource.onerror = () => {
        if (eventSource) {
          try {
            eventSource.close();
          } catch (e) {
            // ignore
          }
          eventSource = null;
        }
        if (isMounted) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connectSSE, 2500);
        }
      };
    };

    connectSSE();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (eventSource) {
        try {
          eventSource.close();
        } catch (e) {
          // ignore
        }
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchData]);

  // Scan dialogs
  const handleScanChats = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/chats/discover');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to scan dialogs');
      if (data.chats) {
        setDiscoveredChats(data.chats);
      }
    } catch (err: any) {
      alert(`Chat Discovery Error: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  // Auto scan on connection
  useEffect(() => {
    if (authState.status === 'connected' && discoveredChats.length === 0) {
      handleScanChats();
    }
  }, [authState.status]);

  // Toggle Automation Engine (Start / Pause)
  const handleToggleEngine = async () => {
    if (!config) return;
    setIsEngineLoading(true);

    try {
      const endpoint = config.isEngineRunning ? '/api/engine/stop' : '/api/engine/start';
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Engine action failed');

      await fetchData();
    } catch (err: any) {
      alert(`Forwarding Engine Error: ${err.message}`);
    } finally {
      setIsEngineLoading(false);
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  const handleSelectAsSource = (chat: DiscoveredChat) => {
    setQuickSourceChat(chat);
    setActiveTab('funnel');
  };

  const handleSelectAsTarget = (chat: DiscoveredChat) => {
    setQuickTargetChat(chat);
    setActiveTab('funnel');
  };

  const handleSaveRateLimit = async (newConfig: RateLimitConfig) => {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ globalRateLimit: newConfig })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to save rate limit policy');
    }
    const updated = await res.json();
    setConfig(updated);
  };

  // Derive accounts array safely
  const activeAccounts: SafeTelegramAccount[] = config?.accounts && config.accounts.length > 0
    ? config.accounts
    : authState.userProfile
    ? [
        {
          id: authState.userProfile.id,
          name: authState.userProfile.firstName,
          username: authState.userProfile.username,
          phone: authState.userProfile.phone || authState.phoneNumber,
          status: 'connected',
          userProfile: authState.userProfile
        }
      ]
    : [];

  const defaultRateLimit: RateLimitConfig = config?.globalRateLimit || {
    minDelayMs: 1200,
    maxMessagesPerMinute: 25,
    autoSleepOnFloodWait: true,
    retryAttempts: 3,
    exponentialBackoff: true
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-['Plus_Jakarta_Sans']">
      {/* Top Navbar */}
      <Navbar
        authState={authState}
        isEngineRunning={Boolean(config?.isEngineRunning)}
        stats={stats}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onToggleEngine={handleToggleEngine}
        isEngineLoading={isEngineLoading}
      />

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'funnel' && (
          <RulesManager
            rules={config?.rules || []}
            accounts={activeAccounts}
            discoveredChats={discoveredChats}
            isEngineRunning={Boolean(config?.isEngineRunning)}
            onRefreshRules={fetchData}
            onOpenDiscovery={() => {
              setActiveTab('chats');
              if (discoveredChats.length === 0 && authState.status === 'connected') {
                handleScanChats();
              }
            }}
            quickSourceChat={quickSourceChat}
            quickTargetChat={quickTargetChat}
            onClearQuickSelection={() => {
              setQuickSourceChat(null);
              setQuickTargetChat(null);
            }}
          />
        )}

        {activeTab === 'chats' && (
          <ChatExplorer
            discoveredChats={discoveredChats}
            isScanning={isScanning}
            onScanChats={handleScanChats}
            onSelectAsSource={handleSelectAsSource}
            onSelectAsTarget={handleSelectAsTarget}
            authState={authState}
          />
        )}

        {activeTab === 'console' && (
          <LiveConsole
            logs={logs}
            onClearLogs={handleClearLogs}
            isEngineRunning={Boolean(config?.isEngineRunning)}
          />
        )}

        {activeTab === 'stats' && (
          <StatsCards
            stats={stats}
            rules={config?.rules || []}
            rateLimit={defaultRateLimit}
            isEngineRunning={Boolean(config?.isEngineRunning)}
            onOpenRateLimit={() => setIsRateLimitModalOpen(true)}
          />
        )}

        {activeTab === 'python' && (
          <PythonExporter
            config={config}
            rules={config?.rules || []}
          />
        )}
      </main>

      {/* Auth / Account Connection Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        authState={authState}
        config={config}
        onRefreshAuth={fetchData}
      />

      {/* Rate Limit Configuration Modal */}
      <RateLimitModal
        isOpen={isRateLimitModalOpen}
        onClose={() => setIsRateLimitModalOpen(false)}
        rateLimit={defaultRateLimit}
        onSaveRateLimit={handleSaveRateLimit}
      />
    </div>
  );
}
