/**
 * Delivery-failure alerts.
 * Optional: configure BOTH env vars to get a Telegram message, and/or
 * ALERT_WEBHOOK_URL for a generic JSON POST on failures.
 *   ALERT_BOT_TOKEN=123456:ABC...   (from @BotFather)
 *   ALERT_CHAT_ID=123456789         (your user id / channel id — bot must be a member)
 *   ALERT_WEBHOOK_URL=https://...   (receives {type,sourceId,targetId,error,count,at})
 * Alerts are de-duplicated per source→target pair (10-minute window) and
 * globally capped per hour so a broken channel can never spam you.
 */

const BOT_TOKEN = process.env.ALERT_BOT_TOKEN?.trim() || '';
const CHAT_ID = process.env.ALERT_CHAT_ID?.trim() || '';
const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL?.trim() || '';
const DEDUPE_WINDOW_MS = 10 * 60_000;
const MAX_ALERTS_PER_HOUR = 20;

const lastSentAt = new Map<string, number>();
const sentTimestamps: number[] = [];

export function alertsConfigured(): boolean {
  return Boolean((BOT_TOKEN && CHAT_ID) || WEBHOOK_URL);
}

async function post(url: string, body: unknown, timeoutMs = 8000): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget failure alert. Never throws. */
export function notifyDeliveryFailure(info: { sourceId?: string; targetId?: string; ruleName?: string; error: string; context?: string }): void {
  if (!alertsConfigured()) return;
  try {
    const key = `${info.sourceId || '?'}->${info.targetId || '?'}:${info.context || ''}`;
    const now = Date.now();
    const last = lastSentAt.get(key) || 0;
    if (now - last < DEDUPE_WINDOW_MS) return;
    // hourly global cap
    while (sentTimestamps.length && now - sentTimestamps[0] > 3_600_000) sentTimestamps.shift();
    if (sentTimestamps.length >= MAX_ALERTS_PER_HOUR) return;
    lastSentAt.set(key, now);
    sentTimestamps.push(now);

    const text = [
      '🚨 TGForwarder delivery failure',
      info.ruleName ? `Rule: ${info.ruleName}` : null,
      info.sourceId && info.targetId ? `Route: ${info.sourceId} → ${info.targetId}` : null,
      info.context ? `Stage: ${info.context}` : null,
      `Error: ${String(info.error).slice(0, 300)}`,
      `At: ${new Date().toISOString()}`,
    ].filter(Boolean).join('\n');

    const payload = { type: 'delivery_failure', ...info, at: new Date().toISOString() };
    const tasks: Promise<void>[] = [];
    if (BOT_TOKEN && CHAT_ID) tasks.push(post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: CHAT_ID, text }).catch(() => {}));
    if (WEBHOOK_URL) tasks.push(post(WEBHOOK_URL, payload).catch(() => {}));
    void Promise.all(tasks);
  } catch {
    // alerts must never break forwarding
  }
}
