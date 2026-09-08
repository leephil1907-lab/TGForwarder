import fs from 'fs';
import path from 'path';

/**
 * Engineering media re-upload (save-restricted-bot method).
 * Used as the LAST resort by every send path when both native forward and the
 * direct media re-send fail (protected/restricted sources, expired references).
 * Downloads the media through the user's own session and re-uploads it to the
 * target as a fresh file. Temp file is always cleaned up.
 */
export async function engineeringReUpload(
  engine: any,
  message: any,
  targetEntity: any,
  opts: { caption?: string; tenantId?: string; log?: (item: any) => void } = {}
): Promise<{ sent: any; bytes: number }> {
  const client = engine.client;
  if (!client || typeof client.downloadMedia !== 'function' || typeof client.sendFile !== 'function') {
    throw new Error('Engineering re-upload unavailable: client cannot download media.');
  }
  const mediaSize = Number(message?.document?.size ?? message?.file?.size ?? 0);
  const maxBytes = (Number(process.env.TG_REUPLOAD_MAX_MB) || 800) * 1024 * 1024;
  if (mediaSize > maxBytes) {
    throw Object.assign(new Error(`Media is ${(mediaSize / 1048576).toFixed(1)} MB — exceeds the ${Math.round(maxBytes / 1048576)} MB engineering re-upload limit (raise TG_REUPLOAD_MAX_MB to allow it).`), { reuploadSkipped: true });
  }

  const tenantRoot = path.join(process.env.TG_DATA_DIR || path.join(process.cwd(), '.data'), 'tenants', String(opts.tenantId || (engine as any).__tenantId || 'default'), 'reupload');
  fs.mkdirSync(tenantRoot, { recursive: true });
  const tmpFile = path.join(tenantRoot, `msg${message?.id ?? 'x'}-${Date.now()}.bin`);

  opts.log?.({ level: 'warn', category: 'forward', title: '🛠️ ENGINEERING RE-UPLOAD: Downloading from source', message: `Direct delivery failed. Downloading the media through your session and re-uploading it as a fresh file.` });
  await client.downloadMedia(message, { outputFile: tmpFile });
  try {
    // Re-upload with the ORIGINAL document attributes so the delivered media
    // keeps its exact Telegram behaviour: round video notes stay round,
    // videos stay streamable inline (not file attachments), filenames persist.
    const originalAttrs = Array.isArray(message?.document?.attributes) ? message.document.attributes : [];
    const isRoundNote = originalAttrs.some((a: any) => a?.className === 'DocumentAttributeVideo' && a?.roundMessage);
    const attributes = originalAttrs.length ? originalAttrs : undefined;
    const mediaClassName = String(message?.media?.className || '');
    const forceDocument = attributes ? undefined : ['MessageMediaDocument', 'MessageMediaAudio', 'MessageMediaVoice'].includes(mediaClassName);
    // Round video notes don't carry captions in Telegram clients — strip to avoid errors.
    const caption = isRoundNote ? undefined : opts.caption ? String(opts.caption).slice(0, 1000) : undefined;
    const sent = await client.sendFile(targetEntity, { file: tmpFile, caption, forceDocument, attributes });
    opts.log?.({ level: 'info', category: 'forward', title: '🛠️ ENGINEERING RE-UPLOAD: Delivered', message: `Media downloaded from the source and re-uploaded as a fresh file.` });
    return { sent, bytes: mediaSize };
  } finally {
    try { fs.rmSync(tmpFile, { force: true }); } catch { /* best-effort cleanup */ }
  }
}
