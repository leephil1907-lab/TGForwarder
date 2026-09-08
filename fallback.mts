/**
 * Private-source engineering-fallback proof:
 * A protected source message (direct re-send fails with CHAT_FORWARDS_RESTRICTED)
 * must be delivered via the engineering method: session download → fresh re-upload.
 */
process.env.TG_DATA_DIR = '/tmp/tgf-fallback-e2e';
import fs from 'node:fs';
fs.rmSync('/tmp/tgf-fallback-e2e', { recursive: true, force: true });

const { runWithTenant } = await import('./server/tenantContext.js');
const { StorageManager } = await import('./server/storage.js');
const { TelegramEngine } = await import('./server/telegramEngine.js');
await import('./server/tenantIsolationPatch.js');
const psaf = await import('./server/privateSourceAutoForward.js');

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mkMediaMsg = (id: number, chatId: string, text: string) => ({
  id, chatId, message: text, senderId: '55', entities: undefined,
  media: { className: 'MessageMediaDocument', document: { size: 2048, mimeType: 'video/mp4', attributes: [{ className: 'DocumentAttributeFilename', fileName: 'episode.mp4' }] } },
  get document() { return (this.media as any)?.document; },
});

await runWithTenant('default', async () => {
  const engine: any = new (TelegramEngine as any)();
  const storage = StorageManager.getInstance();
  const calls: any[] = [];
  const handlers: any[] = [];
  const mock = {
    sendMessage: async (entity: any, p: any) => {
      calls.push({ op: 'send', to: String(entity?.id ?? entity), withFile: Boolean(p?.file) });
      if (p?.file) throw new Error('CHAT_FORWARDS_RESTRICTED (caused by messages.SendMedia)');
      return { id: 7000 + calls.length };
    },
    sendFile: async (entity: any, p: any) => { calls.push({ op: 'sendFile', to: String(entity?.id ?? entity), file: String(p?.file), forceDocument: p?.forceDocument, attributes: p?.attributes, caption: p?.caption }); return { id: 8000 + calls.length }; },
    downloadMedia: async (_m: any, p: any) => { calls.push({ op: 'download' }); fs.writeFileSync(p.outputFile, 'EPISODE-BYTES'); return p.outputFile; },
    getEntity: async (e: any) => ({ id: String(e), title: `Ent ${e}` }),
    getMessages: async () => [],
    addEventHandler: (h: any) => handlers.push(h),
    removeEventHandler: () => {},
    isConnected: () => true,
  };
  engine.client = mock;
  engine.authState = { status: 'connected', userProfile: { id: '777', firstName: 'T' } };
  (engine as any).broadcast = () => {};

  storage.saveConfig({ isEngineRunning: true });
  storage.addRule({ name: 'Private auto', sourceId: '-1005550001', sourceTitle: 'PrivateSrc', targetIds: ['-1006660002'], targetTitles: ['MyChannel'], removeForwardSignature: true, duplicateProtection: true, enabled: true, autoPublish: true } as any);

  psaf.attachPrivateSourceListener(engine);
  check('listener attached and captured the handler', handlers.length === 1);

  // Fire a protected media message from the private source (autoPublish rule).
  await handlers[0]({ message: mkMediaMsg(4001, '-1005550001', 'new episode'), chat: {} });
  await sleep(500);

  const ops = calls.map((c) => c.op);
  check('direct re-send attempted first, then engineering', calls.some((c) => c.op === 'send' && c.withFile) && ops.includes('download') && ops.includes('sendFile'), JSON.stringify(calls));
  const sf = calls.find((c) => c.op === 'sendFile');
  check('fresh re-upload went to the saved target', sf?.to === '-1006660002' && /reupload/.test(String(sf?.file)), JSON.stringify(sf));
  check('mapping recorded (real delivery)', Boolean(storage.getMapping('-1005550001', 4001, '-1006660002')));
  check('stats count a forward (not a failure)', engine.getStats().totalForwarded === 1 && engine.getStats().totalFailed === 0, JSON.stringify(engine.getStats()));
  check('temp re-upload file cleaned up', !calls.filter((c) => c.op === 'download').length || !fs.readdirSync('/tmp/tgf-fallback-e2e/tenants/default/reupload').length);
  check('video re-uploads inline (full view, not a file attachment) with original attributes', sf?.forceDocument === false && /\.mp4$/.test(String(sf?.file)) && Array.isArray(sf?.attributes) && sf.attributes.length > 0, JSON.stringify(sf));

  // ---- media fidelity: every media type must keep its native presentation ----
  // Photo: inline picture preview (.jpg), never a file attachment.
  const beforePhoto = calls.length;
  await handlers[0]({ message: { id: 4003, chatId: '-1005550001', message: 'photo post', senderId: '55', entities: undefined, media: { className: 'MessageMediaPhoto', photo: { id: 1 } } }, chat: {} });
  await sleep(500);
  const photoSf = calls.slice(beforePhoto).find((c) => c.op === 'sendFile');
  check('photo re-uploads as an inline picture (.jpg, not attachment)', Boolean(photoSf) && /\.jpg$/.test(String(photoSf?.file)) && photoSf?.forceDocument === false, JSON.stringify(photoSf));

  // Voice note: voice bubble (.ogg), not an audio file.
  const beforeVoice = calls.length;
  await handlers[0]({ message: { id: 4004, chatId: '-1005550001', message: '', senderId: '55', entities: undefined, media: { className: 'MessageMediaDocument', document: { size: 4096, mimeType: 'audio/ogg', attributes: [{ className: 'DocumentAttributeAudio', voice: true, duration: 9 }] } }, get document() { return (this.media as any)?.document; } }, chat: {} });
  await sleep(500);
  const voiceSf = calls.slice(beforeVoice).find((c) => c.op === 'sendFile');
  check('voice note re-uploads as a voice bubble (.ogg)', Boolean(voiceSf) && /\.ogg$/.test(String(voiceSf?.file)) && voiceSf?.forceDocument === false, JSON.stringify(voiceSf));

  // Generic document: keeps its file presentation and original name.
  const beforeDoc = calls.length;
  await handlers[0]({ message: { id: 4005, chatId: '-1005550001', message: 'docs', senderId: '55', entities: undefined, media: { className: 'MessageMediaDocument', document: { size: 8192, mimeType: 'application/pdf', attributes: [{ className: 'DocumentAttributeFilename', fileName: 'notes.pdf' }] } }, get document() { return (this.media as any)?.document; } }, chat: {} });
  await sleep(500);
  const docSf = calls.slice(beforeDoc).find((c) => c.op === 'sendFile');
  check('generic document keeps file presentation + original name (.pdf)', Boolean(docSf) && /\.pdf$/.test(String(docSf?.file)) && docSf?.forceDocument === true, JSON.stringify(docSf));

  // Text-only message from the same source: direct path must work untouched.
  const before = calls.length;
  await handlers[0]({ message: { id: 4002, chatId: '-1005550001', message: 'plain text post', senderId: '55', entities: undefined }, chat: {} });
  await sleep(400);
  check('text posts still deliver via the direct path (no re-upload)', calls.slice(before).some((c) => c.op === 'send' && !c.withFile) && !calls.slice(before).some((c) => c.op === 'download'));

  console.log(`\n=== private-source fallback proof: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
});
