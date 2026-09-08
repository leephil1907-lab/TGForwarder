/**
 * Media pipeline proof:
 *  1. Protected source: native forward AND direct repost fail → engineering
 *     method (download via session → fresh re-upload) delivers to the target.
 *  2. Staged (imported) posts download a local media copy for instant
 *     preview + dashboard download, inside the tenant workspace.
 *  3. Oversize media skips the re-upload gracefully and surfaces the failure.
 */
process.env.TG_DATA_DIR = '/tmp/tgf-media-e2e';
import fs from 'node:fs';
fs.rmSync('/tmp/tgf-media-e2e', { recursive: true, force: true });

const { runWithTenant } = await import('./server/tenantContext.js');
const { StorageManager } = await import('./server/storage.js');
const { TelegramEngine } = await import('./server/telegramEngine.js');
await import('./server/tenantIsolationPatch.js');

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mediaDoc = (size = 1024) => ({ className: 'MessageMediaDocument', document: { size, attributes: [{ className: 'DocumentAttributeFilename', fileName: 'clip.mp4' }] } });
// Real gramJS messages expose the document via a `document` getter on the message.
const mkMediaMsg = (id: number, chatId: string, text: string, size = 1024) => ({
  id, chatId, message: text, senderId: '55', entities: undefined,
  media: mediaDoc(size),
  get document() { return (this.media as any)?.document; },
});

await runWithTenant('default', async () => {
  const engine: any = new (TelegramEngine as any)();
  const storage = StorageManager.getInstance();
  const calls: any[] = [];
  const mock = {
    sendMessage: async (entity: any, p: any) => {
      calls.push({ op: 'send', to: String(entity?.id ?? entity), file: Boolean(p?.file) });
      if (p?.file) throw new Error('MEDIA_EMPTY: protected media cannot be re-sent directly');
      return { id: 4000 + calls.length };
    },
    forwardMessages: async () => { calls.push({ op: 'fwd' }); throw new Error('CHAT_FORWARDS_RESTRICTED'); },
    sendFile: async (entity: any, p: any) => { calls.push({ op: 'sendFile', to: String(entity?.id ?? entity), file: String(p?.file) }); return { id: 9000 + calls.length }; },
    downloadMedia: async (_m: any, p: any) => { calls.push({ op: 'download', to: String(p?.outputFile) }); fs.writeFileSync(p.outputFile, 'MEDIA-BYTES'); return p.outputFile; },
    getEntity: async (e: any) => ({ id: String(e), title: `Ent ${e}` }),
    getMessages: async () => [],
    addEventHandler: () => {}, removeEventHandler: () => {}, isConnected: () => true,
  };
  engine.client = mock;
  engine.authState = { status: 'connected', userProfile: { id: '777', firstName: 'T' } };

  // ---- 1. AUTO rule + protected source: forward→repost fail → engineering re-upload ----
  storage.saveConfig({ isEngineRunning: true });
  storage.addRule({ name: 'Protected auto', sourceId: '-1005550001', sourceTitle: 'Src', targetIds: ['-1006660002'], targetTitles: ['Tgt'], removeForwardSignature: false, duplicateProtection: true, enabled: true, autoPublish: true } as any);
  await engine.dispatchItem({
    event: { message: mkMediaMsg(3001, '-1005550001', 'protected clip'), chat: {} },
    rule: storage.getConfig().rules[0], targetId: '-1006660002', targetTitle: 'Tgt', processedText: 'protected clip', scheduledTime: Date.now(), retries: 0,
  }, storage.getConfig().globalRateLimit);
  const ops = calls.map((c) => c.op);
  check('attempted forward, then repost, then engineering', ops.includes('fwd') && ops.includes('send') && ops.includes('download') && ops.includes('sendFile'), JSON.stringify(ops));
  const sf = calls.find((c) => c.op === 'sendFile');
  check('re-upload delivered the downloaded file to the saved target', sf?.to === '-1006660002' && /reupload/.test(String(sf?.file)), JSON.stringify(sf));
  check('re-upload temp cleaned up after send', !calls.filter((c) => c.op === 'download').some((d) => fs.existsSync(String(d.to))));
  check('mapping recorded for the engineering delivery', Boolean(storage.getMapping('-1005550001', 3001, '-1006660002')));

  // ---- 2. Manual/import rule: staging triggers local media prefetch ----
  storage.addRule({ name: 'Import watch', sourceId: '-1007770001', sourceTitle: 'ImportSrc', targetIds: ['-1008880002'], targetTitles: ['ImportTgt'], removeForwardSignature: true, duplicateProtection: true, enabled: true, autoPublish: false } as any);
  await engine.dispatchItem({
    event: { message: mkMediaMsg(3002, '-1007770001', 'watch this'), chat: {} },
    rule: storage.getConfig().rules[1], targetId: '-1008880002', targetTitle: 'ImportTgt', processedText: 'watch this', scheduledTime: Date.now(), retries: 0,
  }, storage.getConfig().globalRateLimit);
  await sleep(400);
  const rec = engine.getPendingPosts().find((p: any) => p.messageId === 3002);
  check('staged post kept source+target', rec?.sourceId === '-1007770001' && rec?.targetId === '-1008880002');
  check('prefetch downloaded a local copy', rec?.mediaFileStatus === 'ready' && Boolean(rec?.mediaFile), JSON.stringify(rec));
  const localPath = `/tmp/tgf-media-e2e/tenants/default/pending-media/${rec.mediaFile}`;
  check('local copy exists in the tenant workspace', fs.existsSync(localPath) && fs.readFileSync(localPath, 'utf8') === 'MEDIA-BYTES', localPath);
  check('original filename preserved for downloads', rec.fileName === 'clip.mp4', JSON.stringify(rec?.fileName));

  // ---- 3. Oversize media: re-upload skipped gracefully, failure counted internally ----
  const statsBefore = engine.getStats().totalFailed;
  const downloadsBefore = calls.filter((c) => c.op === 'download').length; // engineering #1 + staging prefetch #1
  await engine.dispatchItem({
    event: { message: mkMediaMsg(3003, '-1005550001', 'huge', 900 * 1024 * 1024), chat: {} },
    rule: storage.getConfig().rules[0], targetId: '-1006660002', targetTitle: 'Tgt', processedText: 'huge', scheduledTime: Date.now(), retries: 0,
  }, storage.getConfig().globalRateLimit);
  check('oversize: re-upload skipped (no new download), failure counted', calls.filter((c) => c.op === 'download').length === downloadsBefore && engine.getStats().totalFailed === statsBefore + 1, JSON.stringify({ downloads: calls.filter((c) => c.op === 'download').length, downloadsBefore, failed: engine.getStats().totalFailed, before: statsBefore }));

  console.log(`\n=== media pipeline proof: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
});
