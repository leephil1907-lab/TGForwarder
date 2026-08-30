import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { AuthModal } from './components/AuthModal';
import { RulesManager } from './components/RulesManager';
import { ChatExplorer } from './components/ChatExplorer';
import { LiveConsole } from './components/LiveConsole';
import { StatsCards } from './components/StatsCards';
import { PythonExporter } from './components/PythonExporter';
import { RateLimitModal } from './components/RateLimitModal';
import { AccessGate } from './components/AccessGate';
import { PostHistory } from './components/PostHistory';
import { getStoredToken, clearStoredToken, withTokenParam } from './lib/authToken';
import { AuthState, SafeConfig, DiscoveredChat, ActivityLog, EngineStats, RateLimitConfig, SafeTelegramAccount } from './types';

export default function AppV2() {
  const [activeTab,setActiveTab]=useState('funnel');
  const [authOpen,setAuthOpen]=useState(false);
  const [rateOpen,setRateOpen]=useState(false);
  const [hasToken,setHasToken]=useState(()=>Boolean(getStoredToken()));
  const [gateError,setGateError]=useState<string|null>(null);
  const [authState,setAuthState]=useState<AuthState>({status:'disconnected',userProfile:null});
  const [config,setConfig]=useState<SafeConfig|null>(null);
  const [chats,setChats]=useState<DiscoveredChat[]>([]);
  const [logs,setLogs]=useState<ActivityLog[]>([]);
  const [stats,setStats]=useState<EngineStats>({totalReceived:0,totalForwarded:0,totalFailed:0,duplicatesBlocked:0,filtersTriggered:0,activeRulesCount:0,uptimeSeconds:0,lastActiveTime:null,startTime:null});
  const [scanning,setScanning]=useState(false);
  const [engineLoading,setEngineLoading]=useState(false);
  const [quickSource,setQuickSource]=useState<DiscoveredChat|null>(null);
  const [quickTarget,setQuickTarget]=useState<DiscoveredChat|null>(null);

  const fetchData=useCallback(async()=>{
    try{
      const rs=await Promise.all([fetch('/api/config'),fetch('/api/auth/status'),fetch('/api/stats'),fetch('/api/logs')]);
      if(rs.some(r=>r.status===401)){clearStoredToken();setHasToken(false);setGateError('The access token was rejected by the server.');return;}
      const [c,a,s,l]=rs;
      if(c.ok)setConfig(await c.json()); if(a.ok)setAuthState(await a.json()); if(s.ok)setStats(await s.json()); if(l.ok)setLogs(await l.json());
    }catch(e){console.error('[TGForwarder] initial load failed',e);}
  },[]);

  useEffect(()=>{
    if(!hasToken)return; fetchData(); let es:EventSource|null=null; let timer:ReturnType<typeof setTimeout>|null=null; let mounted=true;
    const connect=()=>{if(!mounted)return; es?.close(); es=new EventSource(withTokenParam('/api/stream')); es.onmessage=(ev)=>{try{if(!ev.data||ev.data.startsWith(':'))return;const d=JSON.parse(ev.data);switch(d.type){case'INIT_SNAPSHOT':d.payload.authState&&setAuthState(d.payload.authState);d.payload.stats&&setStats(d.payload.stats);d.payload.recentLogs&&setLogs(d.payload.recentLogs);break;case'NEW_LOG':setLogs(v=>[...v.slice(-250),d.payload]);break;case'LOGS_CLEARED':setLogs([]);break;case'STATS_UPDATED':setStats(d.payload);break;case'AUTH_STATUS_CHANGED':setAuthState(d.payload);break;case'ENGINE_STATE_CHANGED':setConfig(v=>v?{...v,isEngineRunning:d.payload.isRunning}:v);break;}}catch(e){console.error('SSE parse error',e);}}; es.onerror=()=>{es?.close();es=null;if(mounted){if(timer)clearTimeout(timer);timer=setTimeout(connect,2500);}};};
    connect(); const vis=()=>document.visibilityState==='visible'&&fetchData(); document.addEventListener('visibilitychange',vis); return()=>{mounted=false;if(timer)clearTimeout(timer);es?.close();document.removeEventListener('visibilitychange',vis);};
  },[fetchData,hasToken]);

  const scan=async()=>{setScanning(true);try{const r=await fetch('/api/chats/discover');const d=await r.json();if(!r.ok)throw new Error(d.error);setChats(d.chats||[]);}catch(e:any){alert(`Chat Discovery Error: ${e.message}`);}finally{setScanning(false);}};
  useEffect(()=>{if(authState.status==='connected'&&!chats.length)scan();},[authState.status]);
  const toggleEngine=async()=>{if(!config)return;setEngineLoading(true);try{const r=await fetch(config.isEngineRunning?'/api/engine/stop':'/api/engine/start',{method:'POST'});const d=await r.json();if(!r.ok)throw new Error(d.error);await fetchData();}catch(e:any){alert(`Forwarding Engine Error: ${e.message}`);}finally{setEngineLoading(false);}};
  const clearLogs=async()=>{try{await fetch('/api/logs/clear',{method:'POST'});}finally{setLogs([]);}};
  const saveRateLimit=async(v:RateLimitConfig)=>{const r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({globalRateLimit:v})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Failed to save rate limit');setConfig(d);};
  const accounts:SafeTelegramAccount[]=config?.accounts?.length?config.accounts:(authState.userProfile?[{id:authState.userProfile.id,name:authState.userProfile.firstName,username:authState.userProfile.username,phone:authState.userProfile.phone||authState.phoneNumber,status:'connected',userProfile:authState.userProfile}]:[]);
  const rate=config?.globalRateLimit||{minDelayMs:1200,maxMessagesPerMinute:25,autoSleepOnFloodWait:true,retryAttempts:3,exponentialBackoff:true};
  if(!hasToken)return <AccessGate error={gateError} onUnlock={()=>{setGateError(null);setHasToken(true);}}/>;

  return <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-['Plus_Jakarta_Sans']">
    <Navbar authState={authState} isEngineRunning={Boolean(config?.isEngineRunning)} stats={stats} activeTab={activeTab} setActiveTab={setActiveTab} onOpenAuth={()=>setAuthOpen(true)} onToggleEngine={toggleEngine} isEngineLoading={engineLoading}/>
    <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {activeTab==='funnel'&&<RulesManager rules={config?.rules||[]} accounts={accounts} discoveredChats={chats} isEngineRunning={Boolean(config?.isEngineRunning)} onRefreshRules={fetchData} onOpenDiscovery={()=>setActiveTab('chats')} quickSourceChat={quickSource} quickTargetChat={quickTarget} onClearQuickSelection={()=>{setQuickSource(null);setQuickTarget(null);}}/>}
      {activeTab==='chats'&&<ChatExplorer discoveredChats={chats} isScanning={scanning} onScanChats={scan} onSelectAsSource={c=>{setQuickSource(c);setActiveTab('funnel');}} onSelectAsTarget={c=>{setQuickTarget(c);setActiveTab('funnel');}} authState={authState}/>} 
      {activeTab==='history'&&<PostHistory chats={chats} authState={authState}/>} 
      {activeTab==='console'&&<LiveConsole logs={logs} onClearLogs={clearLogs} isEngineRunning={Boolean(config?.isEngineRunning)}/>} 
      {activeTab==='stats'&&<StatsCards stats={stats} rules={config?.rules||[]} rateLimit={rate} isEngineRunning={Boolean(config?.isEngineRunning)} onOpenRateLimit={()=>setRateOpen(true)}/>} 
      {activeTab==='python'&&<PythonExporter config={config} rules={config?.rules||[]}/>} 
    </main>
    <AuthModal isOpen={authOpen} onClose={()=>setAuthOpen(false)} authState={authState} config={config} onRefreshAuth={fetchData}/>
    <RateLimitModal isOpen={rateOpen} onClose={()=>setRateOpen(false)} rateLimit={rate} onSaveRateLimit={saveRateLimit}/>
  </div>;
}
