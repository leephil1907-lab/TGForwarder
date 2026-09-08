import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { TelegramEngine } from './telegramEngine.js';

const proto:any=TelegramEngine.prototype as any;
if(proto.__tgforwarderTenantIsolationPatch)throw new Error('Tenant isolation patch loaded twice.');
const BASE_DATA_DIR=process.env.TG_DATA_DIR||(process.env.VERCEL?'/tmp/tgforwarder-data':path.join(process.cwd(),'.data'));
const stateFor=(engine:any)=>{
  if(engine.__tenantPendingState)return engine.__tenantPendingState;
  const tenantId=String(engine.__tenantId||'default');
  const dir=path.join(BASE_DATA_DIR,'tenants',tenantId),file=path.join(dir,'pending-posts.json');
  const pending=new Map<string,any>();
  try{if(fs.existsSync(file)){const list=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(list))for(const r of list)if(r?.key&&r.sourceId&&r.targetId&&Number(r.messageId))pending.set(r.key,r);}}catch(err){console.warn('[TGForwarder] Could not restore tenant pending posts:',(err as Error).message);}
  const save=()=>{fs.mkdirSync(dir,{recursive:true});const tmp=`${file}.tmp`;fs.writeFileSync(tmp,JSON.stringify(Array.from(pending.values()).slice(-1000),null,2),'utf8');fs.renameSync(tmp,file);};
  return engine.__tenantPendingState={pending,save};
};
const baseDispatch=proto.__tgforwarderOriginalDispatchV2||proto.dispatchItem;
// ================= staged-media prefetch (import → download if possible) =================
// When a post with media is staged (auto-import sessions, manual rules, private
// sources), the media is downloaded through the user's session into their own
// tenant directory. The review queue then previews/downloads instantly, and the
// file survives source-side deletion. Size-capped; larger media still streams
// from Telegram in the preview and uses the engineering re-upload at publish.
const PENDING_MEDIA_MAX_BYTES=(Number(process.env.TG_PENDING_MEDIA_MAX_MB)||150)*1024*1024;
const mediaExtFor=(type:string|null,message:any):string=>{
  const t=String(type||'').toLowerCase();
  if(t.includes('photo'))return 'jpg';
  if(t.includes('video')||t.includes('animation'))return 'mp4';
  if(t.includes('voice'))return 'ogg';
  if(t.includes('audio'))return 'mp3';
  const doc=message?.document?.attributes?.find?.((a:any)=>a.className==='DocumentAttributeFilename')?.fileName;
  const ext=String(doc||'').includes('.')?String(doc).split('.').pop()!:'';
  return /^[A-Za-z0-9]{1,6}$/.test(ext)?ext.toLowerCase():'bin';
};
const stageFileName=(key:string,ext:string)=>`${key.replace(/[^A-Za-z0-9_-]/g,'_')}.${ext}`;
const prefetchPendingMedia=async(engine:any,state:any,record:any,message:any)=>{
  record.mediaFileStatus='downloading';state.save();
  try{
    if(!engine.client||typeof engine.client.downloadMedia!=='function')throw new Error('client cannot download');
    const size=Number(message?.document?.size??message?.file?.size??0);
    if(size>PENDING_MEDIA_MAX_BYTES){record.mediaFileStatus='too-large';state.save();return;}
    const dir=path.join(BASE_DATA_DIR,'tenants',String(engine.__tenantId||'default'),'pending-media');
    fs.mkdirSync(dir,{recursive:true});
    const name=stageFileName(record.key,mediaExtFor(record.mediaType,message));
    await engine.client.downloadMedia(message,{outputFile:path.join(dir,name)});
    record.mediaFile=name;record.mediaFileStatus='ready';
    const doc=message?.document?.attributes?.find?.((a:any)=>a.className==='DocumentAttributeFilename')?.fileName;
    if(doc)record.fileName=String(doc).slice(0,120);
    state.save();
  }catch(err:any){
    record.mediaFileStatus='failed';state.save();
    engine.log?.({level:'warn',category:'forward',title:'Media Preview Download Skipped',message:`Local copy not saved (${String(err?.message||err).slice(0,120)}). Preview will stream from Telegram instead.`});
  }
};
// Messages claimed by the private-source listener are owned by that listener's
// rule flow (which honours each rule's autoPublish mode) — the generic pipeline
// must not process them a second time.
const originalHandleIncoming=proto.handleIncomingMessage;
if(typeof originalHandleIncoming==='function'&&!proto.__tgforwarderClaimGuard){
  proto.handleIncomingMessage=async function(event:any){ if((event?.message as any)?.__tgforwarderClaimed) return; return originalHandleIncoming.call(this,event); };
  proto.__tgforwarderClaimGuard=true;
}
proto.dispatchItem=async function(item:any,rateLimit:any){const state=stateFor(this),message=item?.event?.message,sourceId=message?.chatId?.toString?.()||item?.rule?.sourceId||'',targetId=String(item?.targetId||'').trim();if(!message||!sourceId||!targetId)throw new Error('Invalid forwarding payload: source message or destination is missing.');if(item?.rule?.autoPublish){return baseDispatch.call(this,item,rateLimit);}
  // Review-first mode: skip content that is already staged for this target
  // (same source + same text/media hash) so the review queue never fills with copies.
  const mediaFingerprint=message.media?(message.media.className||'media'):'text';
  const stagedHash=crypto.createHash('md5').update(`${sourceId}:${String(item.processedText??message.message??message.text??'')}:${mediaFingerprint}`).digest('hex');
  for(const rec of state.pending.values()){if(rec.sourceId===sourceId&&rec.targetId===targetId&&(rec as any).hash===stagedHash){this.log?.({level:'warn',category:'duplicate',title:'🛡️ DUPLICATE STAGE BLOCKED',message:`Identical content from ${item.rule?.sourceTitle||sourceId} is already waiting in the review queue for this destination.`,sourceId,sourceTitle:item.rule?.sourceTitle||sourceId,targetId,targetTitle:item.targetTitle||targetId});if(this.stats){this.stats.duplicatesBlocked=(this.stats.duplicatesBlocked||0)+1;}return;} }
  const key=`${sourceId}:${Number(message.id)}:${targetId}`;const stagedRecord:any={key,sourceId,sourceTitle:item.rule?.sourceTitle||sourceId,targetId,targetTitle:item.targetTitle||targetId,messageId:Number(message.id),text:item.processedText??message.message??message.text??'',hasMedia:Boolean(message.media),mediaType:message.media?.className||null,createdAt:Date.now(),hash:stagedHash};if(stagedRecord.hasMedia){const doc=message.document?.attributes?.find?.((a:any)=>a.className==='DocumentAttributeFilename')?.fileName;if(doc)stagedRecord.fileName=String(doc).slice(0,120);}state.pending.set(key,stagedRecord);state.save();if(stagedRecord.hasMedia){void prefetchPendingMedia(this,state,stagedRecord,message).catch(()=>{});}this.log?.({level:'info',category:'forward',title:'Post Staged for Review',message:`Source post #${message.id} copied to the publish queue for ${item.targetTitle||targetId}.`,sourceId,sourceTitle:item.rule?.sourceTitle||sourceId,targetId,targetTitle:item.targetTitle||targetId,messageSnippet:String(item.processedText??message.message??message.text??'').slice(0,80)||'[Media]'});};
proto.getPendingPosts=function(){return Array.from(stateFor(this).pending.values()).sort((a:any,b:any)=>b.createdAt-a.createdAt);};
proto.publishPendingPost=async function(key:string,editedText?:string){if(!this.client||this.authState?.status!=='connected')throw new Error('Telegram account is not connected.');const state=stateFor(this),record=state.pending.get(key);if(!record)throw new Error('Pending post not found or it has already been published.');const sourceEntity=await this.resolveEntity(record.sourceId),sourceMessages=await this.client.getMessages(sourceEntity,{ids:[record.messageId]}),sourceMessage=Array.isArray(sourceMessages)?sourceMessages[0]:sourceMessages;if(!sourceMessage)throw new Error(`Source message #${record.messageId} is no longer available in ${record.sourceTitle}.`);const targetEntity=await this.resolveEntity(record.targetId);if(!targetEntity)throw new Error(`Destination ${record.targetTitle} could not be resolved.`);const rule=(this.storage?.getConfig?.()?.rules||[]).find((candidate:any)=>candidate.sourceId&&((candidate.sourceId===record.sourceId)||(candidate.sourceId.replace(/^-100/,'')===record.sourceId.replace(/^-100/,'')))&&Array.isArray(candidate.targetIds)&&candidate.targetIds.some((id:string)=>id===record.targetId||id.replace(/^-100/,'')===record.targetId.replace(/^-100/,'')));const publishRule=rule||{removeForwardSignature:true,preserveFormatting:false,sourceId:record.sourceId,sourceTitle:record.sourceTitle,targetIds:[record.targetId],targetTitles:[record.targetTitle]};const finalText=typeof editedText==='string'?editedText:record.text;const item={event:{message:sourceMessage,chat:sourceEntity},rule:publishRule,targetId:record.targetId,targetTitle:record.targetTitle,processedText:finalText,scheduledTime:Date.now(),retries:0,__tgforwarderPublishNow:true};this.log?.({level:'info',category:'forward',title:'Publishing Approved Post',message:`Publishing source #${record.messageId} from ${record.sourceTitle} to ${record.targetTitle}.`,sourceId:record.sourceId,sourceTitle:record.sourceTitle,targetId:record.targetId,targetTitle:record.targetTitle,messageSnippet:finalText.slice(0,80)||'[Media]'});await baseDispatch.call(this,item,this.storage?.getConfig?.()?.globalRateLimit);const mapping=this.storage?.getMapping?.(record.sourceId,record.messageId,record.targetId);if(!mapping)throw new Error(`Telegram did not confirm delivery to ${record.targetTitle}. The post remains pending for retry.`);state.pending.delete(key);state.save();return{success:true,key,sourceId:record.sourceId,sourceMessageId:record.messageId,targetId:record.targetId,targetMessageId:mapping.targetMsgId};};
proto.discardPendingPost=function(key:string){const state=stateFor(this),removed=state.pending.delete(key);if(removed)state.save();return{success:removed};};
proto.__tgforwarderTenantIsolationPatch=true;
