// Trabajos automáticos. Cada uno es idempotente: ejecutarlo dos veces no duplica efectos.
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { enqueueEmail } from '../server/outbox.js';
import * as logger from '../server/log.js';
import { madridParts } from './scheduler.js';
import { addDays } from '../sepa/values.js';

export const EMAIL_BACKOFF_MS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 12 * 3600e3];
export const EMAIL_MAX_ATTEMPTS = EMAIL_BACKOFF_MS.length + 1;

export function createJobs({ db, config, emailer, clock = () => new Date() }) {
  async function sendEmails() {
    const now = clock();
    const due = db.prepare(`SELECT * FROM outbox WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 25`).all(now.toISOString());
    let sent = 0;
    let failed = 0;
    let retried = 0;
    for (const m of due) {
      const attempts = m.attempts + 1;
      try {
        await emailer.send({ to: m.to_addr, subject: m.subject, text: m.body });
        // Tras el envío se borra el cuerpo de los correos de licencia: la clave no queda en claro en ningún sitio.
        const body = m.kind === 'license' ? '[contenido eliminado tras el envío]' : m.body;
        db.prepare(`UPDATE outbox SET status = 'sent', attempts = ?, sent_at = ?, last_error = NULL, body = ? WHERE id = ?`)
          .run(attempts, clock().toISOString(), body, m.id);
        sent++;
      } catch (e) {
        const permanent = e.retryable === false || attempts >= EMAIL_MAX_ATTEMPTS;
        if (permanent) {
          db.prepare(`UPDATE outbox SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?`).run(attempts, String(e.message).slice(0, 500), m.id);
          failed++;
          logger.alert('email_failed_permanently', { id: m.id, kind: m.kind, attempts, error: e.message });
          if (m.kind !== 'alert') {
            enqueueEmail(db, {
              kind: 'alert',
              to: config.adminEmail,
              subject: `[RemesaLista] No se ha podido enviar un correo (${m.kind})`,
              body: `El correo #${m.id} («${m.subject}») a ${m.to_addr} ha fallado ${attempts} veces.\nÚltimo error: ${e.message}\n\nRequiere revisión manual.${m.kind === 'license' ? ' Es un correo de licencia: el cliente ha pagado y no ha recibido su clave. Emite una nueva con «npm run license -- issue».' : ''}`,
              dedupeKey: `alert-email-${m.id}`,
              now: clock(),
            });
          }
        } else {
          const next = new Date(clock().getTime() + EMAIL_BACKOFF_MS[attempts - 1]).toISOString();
          db.prepare(`UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`).run(attempts, next, String(e.message).slice(0, 500), m.id);
          retried++;
        }
      }
    }
    return { sent, failed, retried };
  }

  function expireLicenses() {
    const now = clock().toISOString();
    const expired = db.prepare(`UPDATE licenses SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
      RETURNING id, email`).all(now);
    for (const l of expired) {
      enqueueEmail(db, {
        kind: 'expired', to: l.email, subject: 'Tu licencia de RemesaLista Pro ha caducado',
        body: `Tu licencia Pro ha caducado. Puedes seguir usando el plan gratuito (hasta ${config.freeMaxTransactions} recibos por remesa)${config.checkoutUrl ? ` o renovarla en ${config.checkoutUrl}` : ''}.`,
        dedupeKey: `expired-${l.id}`, now: clock(),
      });
    }
    const soon = new Date(clock().getTime() + 14 * 86400e3).toISOString();
    const expiring = db.prepare(`SELECT id, email, expires_at FROM licenses WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?`).all(now, soon);
    for (const l of expiring) {
      enqueueEmail(db, {
        kind: 'expiry_reminder', to: l.email, subject: 'Tu licencia de RemesaLista Pro caduca pronto',
        body: `Tu licencia Pro caduca el ${l.expires_at.slice(0, 10)}.${config.checkoutUrl ? ` Puedes renovarla en ${config.checkoutUrl}.` : ''}`,
        dedupeKey: `expiry-reminder-${l.id}`, now: clock(),
      });
    }
    return { expired: expired.length, reminders: expiring.length };
  }

  function cleanup() {
    const nowMs = clock().getTime();
    const rl = db.prepare('DELETE FROM rate_limits WHERE window_start < ?').run(Math.floor(nowMs / 1000) - 2 * 86400).changes;
    const wh = db.prepare(`DELETE FROM webhook_events WHERE status != 'error' AND received_at < ?`).run(new Date(nowMs - 90 * 86400e3).toISOString()).changes;
    const ob = db.prepare(`DELETE FROM outbox WHERE status = 'sent' AND sent_at < ?`).run(new Date(nowMs - 30 * 86400e3).toISOString()).changes;
    return { rateLimits: rl, webhookEvents: wh, outbox: ob };
  }

  function backup() {
    if (config.dbPath === ':memory:') return { skipped: 'memory_db' };
    mkdirSync(config.backupDir, { recursive: true });
    const day = madridParts(clock()).day;
    const file = join(config.backupDir, `remesalista-${day}.sqlite`);
    if (existsSync(file)) rmSync(file);
    db.prepare('VACUUM INTO ?').run(file);
    const cutoff = addDays(day, -config.backupRetentionDays);
    let removed = 0;
    for (const f of readdirSync(config.backupDir)) {
      const m = f.match(/^remesalista-(\d{4}-\d{2}-\d{2})\.sqlite$/);
      if (m && m[1] < cutoff) {
        rmSync(join(config.backupDir, f));
        removed++;
      }
    }
    return { file, removed };
  }

  function dailyReport() {
    const today = madridParts(clock()).day;
    const day = addDays(today, -1);
    const usage = db.prepare('SELECT event, plan, count, amount FROM usage_daily WHERE day = ? ORDER BY event, plan').all(day);
    const newLicenses = db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE substr(created_at, 1, 10) = ?').get(day).n;
    const activeLicenses = db.prepare(`SELECT COUNT(*) AS n FROM licenses WHERE status = 'active'`).get().n;
    const failedEmails = db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'failed'`).get().n;
    const pendingEmails = db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'`).get().n;
    const webhookErrors = db.prepare(`SELECT COUNT(*) AS n FROM webhook_events WHERE status = 'error'`).get().n;
    const interest = db.prepare('SELECT feature, COUNT(*) AS n FROM interest GROUP BY feature').all();
    const lines = [
      `Informe de RemesaLista del ${day} (generado automáticamente)`,
      '',
      'Uso del día (contadores sin datos personales):',
      ...(usage.length ? usage.map((u) => `  - ${u.event}${u.plan ? ` [${u.plan}]` : ''}: ${u.count}${u.amount ? ` (recibos: ${u.amount})` : ''}`) : ['  - Sin actividad registrada.']),
      '',
      `Licencias nuevas: ${newLicenses} · Licencias activas: ${activeLicenses}`,
      `Interesados registrados (total por función): ${interest.map((i) => `${i.feature}=${i.n}`).join(', ') || 'ninguno'}`,
      '',
      'Estado operativo:',
      `  - Correos pendientes: ${pendingEmails} · Correos fallidos (requieren revisión): ${failedEmails}`,
      `  - Webhooks con error: ${webhookErrors}`,
      `  - Salud completa: ${config.baseUrl}/healthz`,
    ];
    const queued = enqueueEmail(db, {
      kind: 'report', to: config.adminEmail, subject: `[RemesaLista] Informe diario ${day}`,
      body: lines.join('\n'), dedupeKey: `report-${day}`, now: clock(),
    });
    if (!config.adminEmail) logger.info('daily_report', { day, report: lines.join('\n') });
    return { day, queued };
  }

  return [
    { name: 'send-emails', everyMs: 60e3, run: sendEmails },
    { name: 'expire-licenses', everyMs: 3600e3, run: expireLicenses },
    { name: 'cleanup', dailyAtHour: 3, run: cleanup },
    { name: 'backup', dailyAtHour: 4, run: backup },
    { name: 'daily-report', dailyAtHour: 8, run: dailyReport },
  ];
}
