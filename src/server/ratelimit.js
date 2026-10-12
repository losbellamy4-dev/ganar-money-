// Límite de peticiones por ventana fija, persistido en SQLite (sobrevive a reinicios).
import { createHmac } from 'node:crypto';

/**
 * Seudonimiza la IP con un HMAC que cambia cada día: no guardamos IPs en claro y no se pueden
 * correlacionar entre días.
 */
export function clientKey(secret, scope, ip, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return `${scope}:${createHmac('sha256', secret).update(`${day}|${ip}`).digest('hex').slice(0, 32)}`;
}

export function hit(db, key, limit, windowSec, now = new Date()) {
  const nowSec = Math.floor(now.getTime() / 1000);
  const windowStart = nowSec - (nowSec % windowSec);
  const row = db.prepare(`INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count`).get(key, windowStart);
  const count = row.count;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSec: windowStart + windowSec - nowSec,
  };
}
