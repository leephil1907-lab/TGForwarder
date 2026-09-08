/**
 * Ops features proof:
 *  1. Failure alerts — a delivery failure fires ONE webhook (deduped), with
 *     Telegram-bot path exercised via the same code (webhook is assertable).
 *  2. Backup — GET /api/backup bundles the workspace files.
 *  3. Restore — POST /api/backup/restore writes the bundle back to disk
 *     (restart suppressed via TGF_RESTART_ON_RESTORE=0 for the test),
 *     rejects bad/corrupt/foreign bundles.
 */
process.env.TG_DATA_DIR = '/tmp/tgf-ops-e2e';
process.env.APP_AUTH_TOKEN = 'ops-e2e-master-token-0123456789abcdef';
process.env.PORT = '3983'; process.env.HOST = '127.0.0.1';
process.env.TGF_RESTART_ON_RESTORE = '0';
process.env.ALERT_WEBHOOK_URL = 'http://127.0.0.1:3984/hook';
import fs from 'node:fs';
import http from 'node:http';
fs.rmSync('/tmp/tgf-ops-e2e', { recursive: true, force: true });

const BASE = 'http://127.0.0.1:3983';
const MASTER = process.env.APP_AUTH_TOKEN!;
let pass = 0, fail = 0;
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n + ' ' + d); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const req = async (m: string, p: string, b?: any) => { const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MASTER}` }, body: b ? JSON.stringify(b) : undefined }); let d: any = null; try { d = await r.json(); } catch {} return { status: r.status, data: d, text: async () => await r.clone().text() }; };

// local webhook receiver
const hooks: any[] = [];
const receiver = http.createServer((rq, rs) => {
  let body = '';
  rq.on('data', (c) => (body += c));
  rq.on('end', () => { hooks.push(JSON.parse(body || '{}')); rs.writeHead(200); rs.end('ok'); });
});
receiver.listen(3984);

await import('./production-bootstrap.ts');
await sleep(2500);

const { runWithTenant } = await import('./server/tenantContext.js');
const { StorageManager } = await import('./server/storage.js');
const { TelegramEngine } = await import('./server/telegramEngine.js');

// wire a failing client (text message → direct path throws)
await runWithTenant('default', async () => {
  const engine: any = TelegramEngine.getInstance();
  (engine as any).client = {
    sendMessage: async () => { throw new Error('CHAT_WRITE_FORBIDDEN'); },
    forwardMessages: async () => { throw new Error('CHAT_WRITE_FORBIDDEN'); },
    getEntity: async (e: any) => ({ id: String(e), title: 'X' }),
    getMessages: async () => [],
    addEventHandler: () => {}, removeEventHandler: () => {}, isConnected: () => true,
  };
  engine.authState = { status: 'connected', userProfile: { id: '1', firstName: 'T' } };
  const storage = StorageManager.getInstance();
  storage.saveConfig({ isEngineRunning: true });
  storage.addRule({ name: 'Alert rule', sourceId: '-1005550001', sourceTitle: 'S', targetIds: ['-1006660002'], targetTitles: ['T'], removeForwardSignature: true, duplicateProtection: true, enabled: true, autoPublish: true } as any);

  // ---- 1. failure alert fires, then dedupes ----
  await engine.dispatchItem({
    event: { message: { id: 11, chatId: '-1005550001', message: 'boom', media: undefined, senderId: '5', entities: undefined }, chat: {} },
    rule: storage.getConfig().rules[0], targetId: '-1006660002', targetTitle: 'T', processedText: 'boom', scheduledTime: Date.now(), retries: 0,
  }, storage.getConfig().globalRateLimit);
  await engine.dispatchItem({
    event: { message: { id: 12, chatId: '-1005550001', message: 'boom again', media: undefined, senderId: '5', entities: undefined }, chat: {} },
    rule: storage.getConfig().rules[0], targetId: '-1006660002', targetTitle: 'T', processedText: 'boom again', scheduledTime: Date.now(), retries: 0,
  }, storage.getConfig().globalRateLimit);
  await sleep(800);
  check('failure webhook fired', hooks.length >= 1 && hooks[0].type === 'delivery_failure' && /CHAT_WRITE_FORBIDDEN/.test(hooks[0].error || ''), JSON.stringify(hooks));
  check('duplicate failure deduped (10-min window)', hooks.length === 1, String(hooks.length));

  // different route → not deduped
  storage.addRule({ name: 'Other route', sourceId: '-1005550001', sourceTitle: 'S', targetIds: ['-1007770003'], targetTitles: ['T3'], removeForwardSignature: true, duplicateProtection: true, enabled: true, autoPublish: true } as any);
  await engine.dispatchItem({
    event: { message: { id: 13, chatId: '-1005550001', message: 'other', media: undefined, senderId: '5', entities: undefined }, chat: {} },
    rule: storage.getConfig().rules[1], targetId: '-1007770003', targetTitle: 'T3', processedText: 'other', scheduledTime: Date.now(), retries: 0,
  }, storage.getConfig().globalRateLimit);
  await sleep(600);
  check('different target gets its own alert', hooks.length === 2, String(hooks.length));
});

// ---- 2. backup ----
const backup = await req('GET', '/api/backup');
check('backup downloads with workspace files', backup.status === 200 && backup.data?.tgforwarderBackup === true && Object.keys(backup.data.files).includes('tenants/default/config.json'), JSON.stringify(Object.keys(backup.data?.files || {})));
check('backup contains the rules', JSON.stringify(backup.data.files['tenants/default/config.json'] || '').includes('Alert rule'));

// ---- 3. restore roundtrip ----
const bundle = backup.data;
const cfg = JSON.parse(bundle.files['tenants/default/config.json']);
cfg.rules[0].name = 'Restored rule name';
bundle.files['tenants/default/config.json'] = JSON.stringify(cfg);
const restore = await req('POST', '/api/backup/restore', bundle);
check('restore accepted', restore.status === 200 && restore.data?.success === true && restore.data.restarting === false, JSON.stringify(restore.data));
const onDisk = JSON.parse(fs.readFileSync('/tmp/tgf-ops-e2e/tenants/default/config.json', 'utf8'));
check('restored file written to disk', onDisk.rules.some((r: any) => r.name === 'Restored rule name'));

// ---- 4. restore rejections ----
check('foreign bundle rejected', (await req('POST', '/api/backup/restore', { hello: 1 })).status === 400);
const corrupt = JSON.parse(JSON.stringify(bundle));
corrupt.files['tenants/default/mappings.json'] = '{not json';
check('corrupt file in bundle rejected', (await req('POST', '/api/backup/restore', corrupt)).status === 400);
const sneaky = JSON.parse(JSON.stringify(bundle));
sneaky.files['tenants/default/../../users.json'] = '{}';
check('path traversal filtered', (await req('POST', '/api/backup/restore', sneaky)).status === 400);

receiver.close();
console.log(`\n=== ops features proof: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
