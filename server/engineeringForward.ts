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

  // Classify the REAL media type so the fresh upload keeps Telegram's native
  // presentation: photos as inline previews, videos as inline players (full
  // view, never a white square/file attachment), round video notes round,
  // voice notes as voice bubbles, and plain files under their original name.
  const mediaClassName = String(message?.media?.className || '');
  const originalAttrs: any[] = Array.isArray(message?.document?.attributes) ? message.document.attributes : [];
  const mime = String(message?.document?.mimeType || '').toLowerCase();
  const isPhoto = mediaClassName === 'MessageMediaPhoto' || mime.startsWith('image/');
  const isRoundNote = originalAttrs.some((a: any) => a?.className === 'DocumentAttributeVideo' && a?.roundMessage);
  const isAnim = originalAttrs.some((a: any) => a?.className === 'DocumentAttributeAnimated');
  const isVideo = isAnim || (!isRoundNote && (originalAttrs.some((a: any) => a?.className === 'DocumentAttributeVideo') || mime.startsWith('video/')));
  const isVoice = originalAttrs.some((a: any) => a?.className === 'DocumentAttributeAudio' && a?.voice) || /Voice/.test(mediaClassName);
  const isAudio = !isVoice && (originalAttrs.some((a: any) => a?.className === 'DocumentAttributeAudio') || mime.startsWith('audio/'));
  const origName = String(originalAttrs.find((a: any) => a?.className === 'DocumentAttributeFilename')?.fileName || '');
  const extMatch = origName.match(/\.[a-z0-9]{1,5}$/i);
  const ext = isPhoto ? '.jpg'
    : isVoice ? '.ogg'
    : isAudio ? (extMatch?.[0] || '.mp3')
    : (isVideo || isRoundNote) ? (mime.includes('webm') ? '.webm' : '.mp4')
    : (extMatch?.[0] || '.bin');

  const tenantRoot = path.join(process.env.TG_DATA_DIR || path.join(process.cwd(), '.data'), 'tenants', String(opts.tenantId || (engine as any).__tenantId || 'default'), 'reupload');
  fs.mkdirSync(tenantRoot, { recursive: true });
  // The file extension is what GramJS uses to set the MIME type — a wrong or
  // missing one turns EVERYTHING into an octet-stream file attachment.
  const tmpFile = path.join(tenantRoot, `msg${message?.id ?? 'x'}-${Date.now()}${ext}`);

  opts.log?.({ level: 'warn', category: 'forward', title: '🛠️ ENGINEERING RE-UPLOAD: Downloading from source', message: `Direct delivery failed. Downloading the media through your session and re-uploading it as a fresh file.` });
  await client.downloadMedia(message, { outputFile: tmpFile });
  try {
    // Re-upload with the ORIGINAL document attributes so the delivered media
    // keeps its exact Telegram behaviour: round video notes stay round,
    // videos stay streamable inline (not file attachments), filenames persist.
    const attributes = originalAttrs.length ? originalAttrs : undefined;
    // Photos/videos/gifs/voice/audio must never degrade to file attachments;
    // generic documents explicitly keep their file presentation.
    const forceDocument = (isPhoto || isVideo || isRoundNote || isVoice || isAudio) ? false : (extMatch ? true : undefined);
    // Round video notes don't carry captions in Telegram clients — strip to avoid errors.
    const caption = isRoundNote ? undefined : opts.caption ? String(opts.caption).slice(0, 1000) : undefined;
    const sent = await client.sendFile(targetEntity, { file: tmpFile, caption, forceDocument, attributes });
    opts.log?.({ level: 'info', category: 'forward', title: '🛠️ ENGINEERING RE-UPLOAD: Delivered', message: `Media downloaded from the source and re-uploaded as a fresh file.` });
    return { sent, bytes: mediaSize };
  } finally {
    try { fs.rmSync(tmpFile, { force: true }); } catch { /* best-effort cleanup */ }
  }
}
