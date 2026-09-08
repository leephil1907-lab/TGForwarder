/**
 * Telegram Archive Bot proof:
 *  1. Captured posts (pipeline + private source + auto-import) are mirrored to
 *     the bot: text via sendMessage, video via sendVideo, round video notes
 *     via sendVideoNote (stay round!), each with real downloaded bytes.
 *  2. Media too large for the Bot API gets a text notice instead.
 *  3. Same message is mirrored once (dedupe).
 *  4. History backfill via POST /api/fetcher/mirror (paged, deduped).
 */
process.env.TG_DATA_DIR = '/tmp/tgf-mirror-e2e';
process.env.APP_AUTH_TOKEN = 'mirror-e2e-master-token-0123456789abcdef';
process.env.PORT = '3985'; process.env.HOST = '127.0.0.1';
process.env.ARCHIVE_BOT_TOKEN = '999:test-bot-token';
process.env.ARCHIVE_CHAT_ID = '424242';
process.env.TG_BOT_API_BASE = 'http://127.0.0.1:3986';
import fs from 'node:fs';
import http from 'node:http';
fs.rmSync('/tmp/tgf-mirror-e2e', { recursive: true, force: true });

const MASTER = process.env.APP_AUTH_TOKEN!;
let pass = 0, fail = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + ' ' + d); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- mock Bot API ----
const botCalls: Array<{ method: string; payload: any }> = [];
const botServer = http.createServer((rq, rs) => {
  let chunks: Buffer[] = [];
  rq.on('data', (c) => chunks.push(c));
  rq.on('end', () => {
    const method = rq.url?.split('/').pop() || '';
    const ct = String(rq.headers['content-type'] || '');
    let payload: any = {};
    if (ct.includes('application/json')) { try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {} }
    else if (ct.includes('multipart/form-data')) { const body = Buffer.concat(chunks).toString('latin1'); payload = { multipart: true, hasBytes: Buffer.concat(chunks).length > 1000, caption: /msg caption|#\d+/.test(body), streaming: /supports_streaming/.test(body) }; }
    let status = 200;
    if (method === 'sendMessage' && /rate probe/.test(JSON.stringify(payload)) && !botCalls.some((c) => /rate probe/.test(JSON.stringify(c.payload)))) status = 429;
    botCalls.push({ method, payload });
    rs.writeHead(status, { 'Content-Type': 'application/json' });
    rs.end(JSON.stringify(status === 429 ? { ok: false, parameters: { retry_after: 0 } } : { ok: true }));
  });
});
await new Promise<void>((r) => botServer.listen(3986, () => r()));

await import('./production-bootstrap.ts');
await sleep(2500);

const { runWithTenant } = await import('./server/tenantContext.js');
const { StorageManager } = await import('./server/storage.js');
const { TelegramEngine } = await import('./server/telegramEngine.js');
await import('./server/tenantIsolationPatch.js');
const psaf = await import('./server/privateSourceAutoForward.js');
const { mirrorCapturedMessage } = await import('./server/botMirror.js');

const mkMsg = (id: number, chatId: string, text: string, media?: any) => ({
  id, chatId, message: text, senderId: '55', entities: undefined,
  media: media ?? undefined,
  get document() { return (this.media as any)?.document; },
});
const mediaDoc = (size = 4096, attrs: any[] = [{ className: 'DocumentAttributeFilename', fileName: 'clip.mp4' }]) => ({ className: 'MessageMediaDocument', document: { size, mimeType: 'video/mp4', attributes: attrs } });

// Paged history for the backfill test: source -1007770007 has 5 posts (IDs 700..704).
const historyPages = (offsetId: number): any[] => {
  if (offsetId && offsetId <= 700) return [];
  const names = ['zero', 'one', 'two', 'three', 'four'];
  const all = [704, 703, 702, 701, 700].map((id, i) => mkMsg(id, '-1007770007', `history post ${names[i]}`));
  if (!offsetId) return all.slice(0, 3);
  return all.filter((m) => m.id < offsetId);
};

await runWithTenant('default', async () => {
  const engine: any = TelegramEngine.getInstance();
  const handlers: any[] = [];
  (engine as any).client = {
    sendMessage: async () => ({ id: 1 }),
    forwardMessages: async () => [{ id: 2 }],
    downloadMedia: async (_m: any, p: any) => { fs.writeFileSync(p.outputFile, 'X'.repeat(4096)); return p.outputFile; },
    getEntity: async (e: any) => ({ id: String(e), title: 'X' }),
    getMessages: async (_e: any, p: any) => {
      if (Array.isArray(p?.ids)) {
        const want = Number(p.ids[0]);
        const names = ['zero', 'one', 'two', 'three', 'four'];
        return [700, 701, 702, 703, 704].includes(want) ? [mkMsg(want, '-1007770007', `history post ${names[want - 700]}`)] : [];
      }
      return historyPages(Number(p?.offsetId || 0));
    },
    addEventHandler: (h: any) => handlers.push(h),
    removeEventHandler: () => {},
    isConnected: () => true,
  };
  engine.authState = { status: 'connected', userProfile: { id: '1', firstName: 'T' } };
  (engine as any).broadcast = () => {};
  const storage = StorageManager.getInstance();
  storage.saveConfig({ isEngineRunning: true });
  (engine as any).startQueueProcessor();
  storage.addRule({ name: 'Live rule', sourceId: '-1005550001', sourceTitle: 'Restricted Channel', targetIds: ['-1006660002'], targetTitles: ['T'], removeForwardSignature: true, duplicateProtection: true, enabled: true, autoPublish: true } as any);

  // ---- 1. text post captured by the live pipeline → sendMessage ----
  await engine.handleIncomingMessage({ message: mkMsg(5001, '-1005550001', 'hello from the restricted channel'), chat: { title: 'Restricted Channel' } });
  await sleep(500);
  const textCall = botCalls.find((c) => c.method === 'sendMessage');
  check('text post mirrored to the bot', Boolean(textCall) && /Restricted Channel/.test(textCall.payload.text || '') && /hello from the restricted channel/.test(textCall.payload.text || ''), JSON.stringify(botCalls));

  // ---- 2. same message again → NOT re-mirrored ----
  await engine.handleIncomingMessage({ message: mkMsg(5001, '-1005550001', 'hello from the restricted channel'), chat: { title: 'Restricted Channel' } });
  await sleep(400);
  check('same message not mirrored twice', botCalls.filter((c) => c.method === 'sendMessage').length === 1, String(botCalls.length));

  // ---- 3. video from private source → sendVideo with real bytes + streaming ----
  psaf.attachPrivateSourceListener(engine);
  await handlers[0]({ message: mkMsg(5002, '-1005550001', 'private clip', mediaDoc()), chat: {} });
  await sleep(800);
  const videoCall = botCalls.find((c) => c.method === 'sendVideo');
  check('video mirrored via sendVideo (multipart, streaming)', Boolean(videoCall) && videoCall.payload.multipart === true && videoCall.payload.hasBytes === true && videoCall.payload.streaming === true, JSON.stringify(botCalls.map((c) => c.method)));

  // ---- 4. oversize media → text notice ----
  const before = botCalls.length;
  mirrorCapturedMessage(engine, mkMsg(5003, '-1005550001', 'huge file', mediaDoc(60 * 1024 * 1024)), { sourceId: '-1005550001', sourceTitle: 'Restricted Channel' });
  await sleep(600);
  const newCalls = botCalls.slice(before);
  check('oversize media gets a text notice instead', newCalls.length === 1 && newCalls[0].method === 'sendMessage' && /too large/.test(newCalls[0].payload.text || ''), JSON.stringify(newCalls));

  // ---- 4b. ROUND video note → sendVideoNote (no caption, stays round) ----
  const roundMsg = mkMsg(5013, '-1005550001', '', mediaDoc(4096, [{ className: 'DocumentAttributeVideo', roundMessage: true, duration: 7, w: 240, h: 240 }]));
  const beforeRound = botCalls.length;
  mirrorCapturedMessage(engine, roundMsg, { sourceId: '-1005550001', sourceTitle: 'Restricted Channel' });
  await sleep(600);
  const roundCalls = botCalls.slice(beforeRound);
  check('round video note mirrored via sendVideoNote (no caption)', roundCalls.length === 1 && roundCalls[0].method === 'sendVideoNote' && roundCalls[0].payload.multipart === true, JSON.stringify(roundCalls.map((c) => c.method)));

  // ---- 4c. GIF animation → sendAnimation; voice note → sendVoice ----
  const beforeAV = botCalls.length;
  mirrorCapturedMessage(engine, mkMsg(5014, '-1005550001', '', { className: 'MessageMediaDocument', document: { size: 4096, mimeType: 'video/mp4', attributes: [{ className: 'DocumentAttributeAnimated' }, { className: 'DocumentAttributeFilename', fileName: 'fun.gif' }] } }), { sourceId: '-1005550001', sourceTitle: 'Restricted Channel' });
  mirrorCapturedMessage(engine, mkMsg(5015, '-1005550001', '', { className: 'MessageMediaDocument', document: { size: 4096, mimeType: 'audio/ogg', attributes: [{ className: 'DocumentAttributeAudio', voice: true, duration: 5 }] } }), { sourceId: '-1005550001', sourceTitle: 'Restricted Channel' });
  await sleep(900);
  const avCalls = botCalls.slice(beforeAV);
  check('GIF animation mirrored via sendAnimation', avCalls.some((c) => c.method === 'sendAnimation' && c.payload.multipart === true), JSON.stringify(avCalls.map((c) => c.method)));
  check('voice note mirrored via sendVoice', avCalls.some((c) => c.method === 'sendVoice' && c.payload.multipart === true), JSON.stringify(avCalls.map((c) => c.method)));

  // ---- 4d. Telegram 429 flood control → retried, never dropped ----
  mirrorCapturedMessage(engine, mkMsg(5016, '-1005550001', 'rate probe message'), { sourceId: '-1005550001', sourceTitle: 'Restricted Channel' });
  await sleep(4500);
  const probeCalls = botCalls.filter((c) => /rate probe/.test(c.payload.text || ''));
  check('429 flood control retried until delivered', probeCalls.length === 2, JSON.stringify(probeCalls.map((c) => c.payload.text)));

  // ---- 5. auto-import path (same shared mirror) ----
  mirrorCapturedMessage(engine, mkMsg(5004, '-1008880004', 'imported post'), { sourceId: '-1008880004', sourceTitle: 'Watched Source', ruleName: 'auto-import' });
  await sleep(500);
  check('auto-import mirror path works', botCalls.some((c) => c.method === 'sendMessage' && /Watched Source/.test(c.payload.text || '') && /imported post/.test(c.payload.text || '')));

  // ---- 6. forwarding unaffected ----
  check('pipeline delivery still recorded mapping', Boolean(storage.getMapping('-1005550001', 5001, '-1006660002')));

  // ---- 7. HISTORY BACKFILL via the API route ----
  const api = async (m: string, p: string, b?: any) => { const r = await fetch(`http://127.0.0.1:3985${p}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MASTER}` }, body: b ? JSON.stringify(b) : undefined }); let d: any = null; try { d = await r.json(); } catch {} return { status: r.status, data: d }; };
  const sys = await api('GET', '/api/system');
  check('system reports archiveBot enabled', sys.data?.archiveBot === true);
  const beforeBackfill = botCalls.length;
  const bf = await api('POST', '/api/fetcher/mirror', { sourceId: '-1007770007', limit: 10 });
  await sleep(1200);
  check('history backfill queued all 5 posts', bf.status === 200 && bf.data?.queued === 5, JSON.stringify(bf.data));
  const historyCalls = botCalls.slice(beforeBackfill).filter((c) => c.method === 'sendMessage' && /history post/.test(c.payload.text || ''));
  check('history posts arrived at the bot (oldest-first)', historyCalls.length === 5 && /history post zero/.test(historyCalls[0]?.payload?.text || '') && /history post four/.test(historyCalls[4]?.payload?.text || ''), JSON.stringify(historyCalls.map((c) => (c.payload.text || '').match(/history post \w+/)?.[0])));
  const bf2 = await api('POST', '/api/fetcher/mirror', { sourceId: '-1007770007', limit: 10 });
  check('backfill re-run deduped (queued 0)', bf2.data?.queued === 0, JSON.stringify(bf2.data));

  // ---- 8. single-message mirror ----
  const one = await api('POST', '/api/fetcher/mirror', { sourceId: '-1007770007', messageId: 703 });
  check('single re-mirror reports dedupe', one.status === 200 && one.data?.deduped === true, JSON.stringify(one.data));
  const one2 = await api('POST', '/api/fetcher/mirror', { sourceId: '-1007770007', messageId: 710 });
  check('unknown message -> 404', one2.status === 404, JSON.stringify(one2.data));
});

botServer.close();
console.log(`\n=== archive bot proof: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
