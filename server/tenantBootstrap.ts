import { TelegramEngine } from './telegramEngine.js';
import { StorageManager } from './storage.js';
import { getTenantId, DEFAULT_TENANT, runWithTenant } from './tenantContext.js';

const engines=new Map<string,any>(),storages=new Map<string,any>();
const originalEngineGet=(TelegramEngine as any).getInstance.bind(TelegramEngine);
const originalStorageGet=(StorageManager as any).getInstance.bind(StorageManager);
function storageFor(id:string){let s=storages.get(id);if(!s){s=runWithTenant(id,()=>originalStorageGet());storages.set(id,s);}return s;}
function engineFor(id:string){let e=engines.get(id);if(!e){e=new (TelegramEngine as any)();e.__tenantId=id;e.storage=storageFor(id);engines.set(id,e);Promise.resolve(e.initializeFromStorage?.()).catch((error:any)=>{e.log?.({level:'warn',category:'system',title:'Session Auto-connect Failed',message:error?.message||'Unable to restore Telegram session.'});});}return e;}
const dynamicEngine=new Proxy({}, {get(_t,p){const e=engineFor(getTenantId()||DEFAULT_TENANT),v=e[p];return typeof v==='function'?v.bind(e):v;},set(_t,p,v){engineFor(getTenantId()||DEFAULT_TENANT)[p]=v;return true;},has(_t,p){return p in engineFor(getTenantId()||DEFAULT_TENANT);}});
const dynamicStorage=new Proxy({}, {get(_t,p){const s=storageFor(getTenantId()||DEFAULT_TENANT),v=s[p];return typeof v==='function'?v.bind(s):v;},set(_t,p,v){storageFor(getTenantId()||DEFAULT_TENANT)[p]=v;return true;},has(_t,p){return p in storageFor(getTenantId()||DEFAULT_TENANT);}});
(TelegramEngine as any).getInstance=function(){return dynamicEngine;};
(StorageManager as any).getInstance=function(){return dynamicStorage;};
void originalEngineGet;
