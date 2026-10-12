// Cola de correos salientes. Se escribe en la misma transacción que el hecho que la origina
// (p. ej. una licencia nueva), de modo que nunca hay licencia sin correo ni correo sin licencia.

/**
 * Encola un correo. Si dedupeKey ya existe no se duplica (reintentos de webhooks, informes diarios…).
 * @returns {boolean} true si se ha encolado uno nuevo.
 */
export function enqueueEmail(db, { kind, to, subject, body, dedupeKey = null, now = new Date() }) {
  if (!to) return false;
  const res = db.prepare(`INSERT INTO outbox (kind, to_addr, subject, body, dedupe_key, next_attempt_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING`)
    .run(kind, to, subject, body, dedupeKey, now.toISOString(), now.toISOString());
  return res.changes > 0;
}

export function outboxStats(db) {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM outbox GROUP BY status').all();
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
