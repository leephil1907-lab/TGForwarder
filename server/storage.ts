import fs from 'fs';
import path from 'path';

export interface ForwardingRule {
  id: string;
  name: string;
  accountId?: string;
  sourceId: string;
  sourceTitle: string;
  sourceUsername?: string;
  targetIds: string[];
  targetTitles: string[];
  removeForwardSignature: boolean;
  duplicateProtection: boolean;
  preserveFormatting?: boolean;
  useKeywordFilter?: boolean;
  includeKeywords?: string[];
  excludeKeywords?: string[];
  filterKeywords?: string[];
  mediaFilter?: any;
  senderFilter?: any;
  dropLinks?: boolean;
  prependText?: string;
  appendText?: string;
  enabled: boolean;
  createdAt: number;
}

export interface RateLimitConfig { minDelayMs: number; maxMessagesPerMinute: number; autoSleepOnFloodWait: boolean; retryAttempts: number; exponentialBackoff: boolean; }
export interface ForwarderConfig {
  apiId?: number | string; apiHash?: string; sessionString?: string; botToken?: string;
  isEngineRunning: boolean; rules: ForwardingRule[]; accounts?: any[]; globalRateLimit?: RateLimitConfig;
  defaultRemoveSignature: boolean; retryOnFloodWait: boolean; maxRetryCount: number;
}
export interface ActivityLog { id: string; timestamp: number; level: 'info'|'warn'|'error'|'success'; category: 'auth'|'forward'|'duplicate'|'filter'|'system'|'discovery'; title: string; message: string; sourceId?: string; sourceTitle?: string; targetId?: string; targetTitle?: string; accountId?: string; details?: Record<string, any>; messageSnippet?: string; }
export interface EngineStats { totalReceived:number; totalForwarded:number; totalFailed:number; duplicatesBlocked:number; filtersTriggered:number; mediaBlocked?:number; sendersBlocked?:number; floodWaitsHandled?:number; activeRulesCount:number; uptimeSeconds:number; lastActiveTime:number|null; startTime:number|null; }
export interface MessageMappingRecord { id:string; sourceChatId:string; sourceMsgId:number|string; targetChatId:string; targetMsgId:number|string; hash?:string; timestamp:number; }
export const normalizeChatId = (id:string|number):string => id ? id.toString().trim().replace(/^-100/,'').replace(/^-/,'') : '';

// Vercel's deployed function filesystem is read-only. /tmp is writable but ephemeral.
// A persistent database/blob store should be introduced for durable multi-instance state.
const DATA_DIR = process.env.TG_DATA_DIR || (process.env.VERCEL ? '/tmp/tgforwarder-data' : path.join(process.cwd(), '.data'));
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const MAPPINGS_FILE = path.join(DATA_DIR, 'mappings.json');

const buildInitialRules = (): ForwardingRule[] => {
  const source = process.env.TG_SOURCE_ID?.trim(), target = process.env.TG_TARGET_ID?.trim();
  if (!source || !target) return [];
  return [{ id:'rule-env-primary', name:'Auto Funnel (Environment Config)', sourceId:source, sourceTitle:`Source Channel (${source})`, targetIds:[target], targetTitles:[`Target Channel (${target})`], removeForwardSignature:true, duplicateProtection:true, preserveFormatting:true, useKeywordFilter:false, includeKeywords:[], excludeKeywords:[], filterKeywords:[], dropLinks:false, prependText:'', appendText:'', enabled:true, createdAt:Date.now() }];
};
const DEFAULT_CONFIG: ForwarderConfig = {
  apiId:process.env.TG_API_ID||'', apiHash:process.env.TG_API_HASH||'', sessionString:process.env.TG_SESSION_STRING||'', botToken:process.env.TG_BOT_TOKEN||'',
  isEngineRunning:false, defaultRemoveSignature:true, retryOnFloodWait:true, maxRetryCount:3,
  globalRateLimit:{minDelayMs:1200,maxMessagesPerMinute:25,autoSleepOnFloodWait:true,retryAttempts:3,exponentialBackoff:true}, rules:buildInitialRules()
};

export class StorageManager {
  private static instance:StorageManager; private config:ForwarderConfig; private mappings:Map<string,MessageMappingRecord>=new Map(); private mappingsSaveTimer:NodeJS.Timeout|null=null; private mappingsDirty=false; private static readonly MAPPINGS_FLUSH_INTERVAL_MS=3000;
  private constructor(){ this.ensureDataDir(); this.config=this.loadConfig(); this.loadMappings(); }
  public static getInstance(){ if(!StorageManager.instance) StorageManager.instance=new StorageManager(); return StorageManager.instance; }
  private ensureDataDir(){ if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true}); }
  private loadConfig():ForwarderConfig{ try{ if(fs.existsSync(CONFIG_FILE)){ const parsed=JSON.parse(fs.readFileSync(CONFIG_FILE,'utf-8')); parsed.rules=Array.isArray(parsed.rules)?parsed.rules.filter((r:ForwardingRule)=>r.sourceId?.trim()):[]; for(const k of ['apiId','apiHash','sessionString','botToken']) if(!parsed[k] && process.env[`TG_${k.replace(/([A-Z])/g,'_$1').toUpperCase()}`]) parsed[k]=process.env[`TG_${k.replace(/([A-Z])/g,'_$1').toUpperCase()}`]; if(!parsed.rules.length && process.env.TG_SOURCE_ID&&process.env.TG_TARGET_ID) parsed.rules=buildInitialRules(); return {...DEFAULT_CONFIG,...parsed}; }}catch(e){console.error('[StorageManager] Error loading config:',e);} return {...DEFAULT_CONFIG}; }
  private loadMappings(){ try{ if(fs.existsSync(MAPPINGS_FILE)){ const parsed=JSON.parse(fs.readFileSync(MAPPINGS_FILE,'utf-8')); if(Array.isArray(parsed)) for(const m of parsed) this.mappings.set(m.id,m); } }catch(e){console.warn('[StorageManager] Error loading mappings:',e);} }
  private saveConfig(){ try{ this.ensureDataDir(); fs.writeFileSync(CONFIG_FILE,JSON.stringify(this.config,null,2)); }catch(e){console.warn('[StorageManager] Could not persist config:',(e as Error).message);} }
  public saveConfig(partial:Partial<ForwarderConfig>){ this.config={...this.config,...partial}; this.saveConfig(); }
  public getConfig(){return this.config;}
  public getSafeConfig(){const c={...this.config}; delete c.apiHash; delete c.botToken; delete c.sessionString; return c;}
  public addRule(rule:Omit<ForwardingRule,'id'|'createdAt'>){const r={...rule,id:cryptoRandom(),createdAt:Date.now()}; this.config.rules.push(r); this.saveConfig(); return r;}
  public updateRule(id:string, updates:Partial<ForwardingRule>){const i=this.config.rules.findIndex(r=>r.id===id); if(i<0)return null; this.config.rules[i]={...this.config.rules[i],...updates}; this.saveConfig(); return this.config.rules[i];}
  public deleteRule(id:string){const n=this.config.rules.length; this.config.rules=this.config.rules.filter(r=>r.id!==id); if(n!==this.config.rules.length)this.saveConfig(); return n!==this.config.rules.length;}
  public addMapping(m:MessageMappingRecord){this.mappings.set(m.id,m); this.mappingsDirty=true; this.scheduleMappingsSave();}
  private scheduleMappingsSave(){if(this.mappingsSaveTimer)return; this.mappingsSaveTimer=setTimeout(()=>{this.mappingsSaveTimer=null;if(this.mappingsDirty){this.mappingsDirty=false;try{fs.writeFileSync(MAPPINGS_FILE,JSON.stringify([...this.mappings.values()]));}catch(e){console.warn('[StorageManager] Could not persist mappings:',(e as Error).message);}}},StorageManager.MAPPINGS_FLUSH_INTERVAL_MS);}
  public getMappingsCount(){return this.mappings.size;}
  public getAllMappings(limit=100){return [...this.mappings.values()].sort((a,b)=>b.timestamp-a.timestamp).slice(0,limit);}
}
function cryptoRandom(){return Math.random().toString(36).slice(2)+Date.now().toString(36);}
