/**
 * Channel-routing proof: the source & target saved in a pipeline rule are the
 * EXACT channels used for copying/importing and sending. A captured mock
 * Telegram client records every outgoing call so we can assert destinations.
 */
process.env.TG_DATA_DIR = '/tmp/tgf-route-e2e';
import fs from 'node:fs';
fs.rmSync('/tmp/tgf-route-e2e', { recursive: true, force: true });

const { runWithTenant } = await import('./server/tenantContext.js');
const { StorageManager } = await import('./server/storage.js');
const { TelegramEngine } = await import('./server/telegramEngine.js');
await import('./server/tenantIsolationPatch.js'); // staging/dedupe/claim patches

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mkMsg = (chatId: string, id: number, text: string) => ({ id, chatId, message: text, media: undefined, senderId: '55', entities: undefined });

await runWithTenant('default', async () => {
  const engine: any = new (TelegramEngine as any)();
  const storage = StorageManager.getInstance();

  const calls: Array<{ op: string; to: string; text?: string; from?: string }> = [];
  const mock = {
    sendMessage: async (entity: any, params: any) => { calls.push({ op: 'send', to: String(entity?.id ?? entity), text: params?.message }); return { id: 5000 + calls.length }; },
    forwardMessages: async (entity: any, p: any) => { calls.push({ op: 'fwd', to: String(entity?.id ?? entity), from: String(p?.fromPeer) }); return [{ id: 6000 + calls.length }]; },
    getEntity: async (e: any) => ({ id: String(e), title: `Ent ${e}` }),
    getMessages: async (_entity: any, p: any) => [mkMsg('-1007770001', Number(p?.ids?.[0] ?? 0), 'stage me')],
    addEventHandler: () => {}, removeEventHandler: () => {}, isConnected: () => true,
  };
  engine.client = mock;
  engine.authState = { status: 'connected', userProfile: { id: '777', firstName: 'T' } };

  // FIXED rules — exactly what a user saves in the UI
  storage.saveConfig({ isEngineRunning: true });
  storage.addRule({ name: 'Route A (auto)', sourceId: '-1005550001', sourceTitle: 'Source A', targetIds: ['-1006660002', '-1006660003'], targetTitles: ['Target 2', 'Target 3'], removeForwardSignature: true, duplicateProtection: true, enabled: true, autoPublish: true } as any);
  storage.addRule({ name: 'Route B (manual)', sourceId: '-1007770001', sourceTitle: 'Source B', targetIds: ['-1008880002'], targetTitles: ['Target 8'], removeForwardSignature: true, duplicateProtection: true, enabled: true, autoPublish: false } as any);

  // (Re)start the queue drainer AFTER isEngineRunning is set — its first tick
  // stops the loop unless the engine is running. In production startEngine()
  // provides this order; the scratch skips startEngine.
  engine.startQueueProcessor();

  // ---- 1. Message from Source A → must go to EXACTLY its two fixed targets ----
  await engine.handleIncomingMessage({ message: mkMsg('-1005550001', 1001, 'hello world'), chat: {} });
  await sleep(700);
  const aCalls = calls.filter((c) => c.op === 'send');
  check('exactly 2 sends (one per saved target)', aCalls.length === 2, JSON.stringify(calls));
  check('sent ONLY to the rule’s saved targets', aCalls.every((c) => c.to === '-1006660002' || c.to === '-1006660003'), JSON.stringify(aCalls));
  check('both saved targets covered', new Set(aCalls.map((c) => c.to)).size === 2);
  check('content copied from the saved source message', aCalls.every((c) => c.text === 'hello world'));
  check('mapping recorded per (source,msg,target)', Boolean(storage.getMapping('-1005550001', 1001, '-1006660002')) && Boolean(storage.getMapping('-1005550001', 1001, '-1006660003')));
  check('no cross-sends anywhere else', calls.every((c) => c.to.startsWith('-100666')), JSON.stringify(calls));

  // ---- 2. Message from a NON-rule channel → nothing sent anywhere ----
  const before = calls.length;
  await engine.handleIncomingMessage({ message: mkMsg('-1009999999', 1002, 'unrelated'), chat: {} });
  await sleep(400);
  check('unrelated channel: zero sends', calls.length === before);
  check('unrelated channel: not counted as received', engine.getStats().totalReceived === 1);

  // ---- 3. Duplicate of msg 1001 → blocked, no resend ----
  await engine.handleIncomingMessage({ message: mkMsg('-1005550001', 1001, 'hello world'), chat: {} });
  await sleep(400);
  check('duplicate blocked (no new sends)', calls.length === before && engine.getStats().duplicatesBlocked === 1);

  // ---- 4. Manual rule: staged for the EXACT saved target, then publishes there ----
  await engine.handleIncomingMessage({ message: mkMsg('-1007770001', 2002, 'stage me'), chat: {} });
  await sleep(400);
  check('no direct send before approval', calls.every((c) => c.to !== '-1008880002'));
  const pending = engine.getPendingPosts();
  check('staged exactly once', pending.length === 1, JSON.stringify(pending));
  check('staged record keeps the saved source', pending[0]?.sourceId === '-1007770001');
  check('staged record keeps the saved target', pending[0]?.targetId === '-1008880002' && pending[0]?.targetTitle === 'Target 8');
  check('staged record keeps the source message id', Number(pending[0]?.messageId) === 2002);

  const pub = await engine.publishPendingPost(pending[0].key);
  const pubCalls = calls.filter((c) => c.to === '-1008880002');
  check('publish sends to the saved target only', pub.success === true && pubCalls.length === 1 && pub.targetId === '-1008880002', JSON.stringify({ pub, pubCalls }));
  check('publish copies the same source message', pubCalls[0]?.text === 'stage me' && pub.sourceMessageId === 2002);
  check('publish mapping recorded for (source,msg,target)', Boolean(storage.getMapping('-1007770001', 2002, '-1008880002')));
  check('pending queue cleared after publish', engine.getPendingPosts().length === 0);

  console.log(`\n=== channel-routing proof: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
});
