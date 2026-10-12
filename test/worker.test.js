import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/server/config.js';
import { openDatabase, transaction } from '../src/server/db.js';
import { enqueueEmail } from '../src/server/outbox.js';
import { issueLicense } from '../src/server/licenses.js';
import { createEmailer, EmailError } from '../src/server/email.js';
import { createJobs, EMAIL_MAX_ATTEMPTS } from '../src/worker/jobs.js';
import { createScheduler, isDue } from '../src/worker/scheduler.js';
import { startTestServer, checkoutEvent, manyTransactions, logs } from './server-helpers.js';
import { sampleInput } from './helpers.js';

function setup({ env = {}, now = '2026-10-12T10:00:00Z' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rl-wrk-'));
  const config = loadConfig({ DATA_DIR: dir, APP_SECRET: 'x'.repeat(40), ADMIN_EMAIL: 'admin@example.com', BASE_URL: 'https://example.com', ...env });
  const db = openDatabase(config.dbPath);
  const clock = { current: new Date(now) };
  const sent = [];
  const emailer = { mode: 'ok', async send(m) {
    if (this.mode === 'retryable') throw new EmailError('503 temporal', { retryable: true });
    if (this.mode === 'permanent') throw new EmailError('422 dirección inválida', { retryable: false });
    sent.push(m);
    return { id: 'x' };
  } };
  const jobs = createJobs({ db, config, emailer, clock: () => clock.current });
  const scheduler = createScheduler({ db, config, jobs, clock: () => clock.current });
  const job = (name) => jobs.find((j) => j.name === name);
  return { dir, config, db, clock, sent, emailer, jobs, scheduler, job, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('Cola de correo', () => {
  test('envía, marca como enviado y borra el cuerpo de los correos de licencia', async () => {
    const t = setup();
    const { key } = transaction(t.db, () => issueLicense(t.db, t.config, { email: 'c@example.com', source: 'manual', now: t.clock.current }));
    enqueueEmail(t.db, { kind: 'report', to: 'admin@example.com', subject: 'r', body: 'cuerpo', now: t.clock.current });
    const r = await t.job('send-emails').run();
    assert.deepEqual(r, { sent: 2, failed: 0, retried: 0 });
    assert.ok(t.sent[0].text.includes(key), 'el correo enviado contiene la clave');
    const rows = t.db.prepare('SELECT kind, status, body FROM outbox ORDER BY id').all();
    assert.equal(rows[0].status, 'sent');
    assert.equal(rows[0].body.includes(key), false, 'la clave ya no está en la BD');
    assert.equal(rows[1].body, 'cuerpo');
    assert.equal((await t.job('send-emails').run()).sent, 0, 'no reenvía');
    t.close();
  });

  test('reintentos con espera creciente y fallo definitivo con alerta', async () => {
    const t = setup();
    enqueueEmail(t.db, { kind: 'license', to: 'c@example.com', subject: 'Licencia', body: 'clave', now: t.clock.current });
    t.emailer.mode = 'retryable';
    await t.job('send-emails').run();
    let row = t.db.prepare('SELECT * FROM outbox WHERE id = 1').get();
    assert.equal(row.attempts, 1);
    assert.equal(row.status, 'pending');
    assert.equal(row.next_attempt_at, '2026-10-12T10:01:00.000Z');
    // Antes de tiempo no reintenta.
    assert.equal((await t.job('send-emails').run()).retried, 0);
    for (let i = 1; i < EMAIL_MAX_ATTEMPTS; i++) {
      t.clock.current = new Date(t.clock.current.getTime() + 13 * 3600e3);
      await t.job('send-emails').run();
    }
    row = t.db.prepare('SELECT * FROM outbox WHERE id = 1').get();
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, EMAIL_MAX_ATTEMPTS);
    const alert = t.db.prepare(`SELECT * FROM outbox WHERE kind = 'alert'`).get();
    assert.match(alert.body, /no ha recibido su clave/);
    assert.ok(logs.some((l) => l.level === 'alert' && l.msg === 'email_failed_permanently'));
    t.close();
  });

  test('error permanente (4xx): falla sin reintentar', async () => {
    const t = setup();
    enqueueEmail(t.db, { kind: 'expired', to: 'c@example.com', subject: 's', body: 'b', now: t.clock.current });
    t.emailer.mode = 'permanent';
    assert.equal((await t.job('send-emails').run()).failed, 1);
    assert.equal(t.db.prepare('SELECT attempts FROM outbox WHERE id = 1').get().attempts, 1);
    t.close();
  });

  test('deduplicación por clave', () => {
    const t = setup();
    assert.equal(enqueueEmail(t.db, { kind: 'report', to: 'a@b.es', subject: 's', body: 'b', dedupeKey: 'k' }), true);
    assert.equal(enqueueEmail(t.db, { kind: 'report', to: 'a@b.es', subject: 's', body: 'b', dedupeKey: 'k' }), false);
    assert.equal(enqueueEmail(t.db, { kind: 'report', to: '', subject: 's', body: 'b' }), false, 'sin destinatario no encola');
    t.close();
  });
});

describe('Proveedor de correo Resend (contra un servidor HTTP simulado)', () => {
  test('éxito, error transitorio, error permanente y fallo de red', async () => {
    const statuses = [200, 503, 422, 429];
    const received = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push({ auth: req.headers.authorization, body: JSON.parse(body) });
        const status = statuses.shift();
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(status === 200 ? '{"id":"re_123"}' : '{"message":"x"}');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/emails`;
    const emailer = createEmailer(loadConfig({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_key', RESEND_API_URL: url, EMAIL_FROM: 'A <a@b.es>' }));
    assert.deepEqual(await emailer.send({ to: 'c@d.es', subject: 'Hola', text: 'Texto' }), { id: 're_123' });
    assert.equal(received[0].auth, 'Bearer re_key');
    assert.deepEqual(received[0].body, { from: 'A <a@b.es>', to: ['c@d.es'], subject: 'Hola', text: 'Texto' });
    await assert.rejects(emailer.send({ to: 'c@d.es', subject: 's', text: 't' }), (e) => e.retryable === true);
    await assert.rejects(emailer.send({ to: 'c@d.es', subject: 's', text: 't' }), (e) => e.retryable === false);
    await assert.rejects(emailer.send({ to: 'c@d.es', subject: 's', text: 't' }), (e) => e.retryable === true);
    await new Promise((r) => server.close(r));
    await assert.rejects(emailer.send({ to: 'c@d.es', subject: 's', text: 't' }), (e) => e.retryable === true && /red/.test(e.message));
    assert.throws(() => createEmailer(loadConfig({ EMAIL_PROVIDER: 'resend' })), /RESEND_API_KEY/);
  });
});

describe('Planificador', () => {
  test('isDue: intervalos y tareas diarias en hora de Madrid', () => {
    const every = { everyMs: 60e3 };
    assert.equal(isDue(every, null, new Date()), true);
    assert.equal(isDue(every, { last_started_at: '2026-10-12T10:00:00Z' }, new Date('2026-10-12T10:00:30Z')), false);
    assert.equal(isDue(every, { last_started_at: '2026-10-12T10:00:00Z' }, new Date('2026-10-12T10:01:00Z')), true);
    const daily = { dailyAtHour: 8 };
    // 06:30 UTC = 08:30 en Madrid (horario de verano).
    assert.equal(isDue(daily, { last_started_at: '2026-10-11T07:00:00Z' }, new Date('2026-10-12T06:30:00Z')), true);
    assert.equal(isDue(daily, { last_started_at: '2026-10-11T07:00:00Z' }, new Date('2026-10-12T05:30:00Z')), false);
    assert.equal(isDue(daily, { last_started_at: '2026-10-12T06:30:00Z' }, new Date('2026-10-12T20:00:00Z')), false);
  });

  test('el bloqueo impide ejecuciones simultáneas del mismo trabajo', async () => {
    const t = setup();
    let release;
    const slow = { name: 'lento', everyMs: 1, run: () => new Promise((r) => { release = r; }) };
    const s1 = createScheduler({ db: t.db, config: t.config, jobs: [slow], clock: () => t.clock.current });
    const s2 = createScheduler({ db: t.db, config: t.config, jobs: [slow], clock: () => t.clock.current });
    const p1 = s1.runJob(slow);
    t.clock.current = new Date(t.clock.current.getTime() + 1000);
    const r2 = await s2.runJob(slow);
    assert.equal(r2.skipped, 'locked');
    release('hecho');
    assert.equal((await p1).status, 'ok');
    const row = t.db.prepare(`SELECT * FROM job_runs WHERE job = 'lento'`).get();
    assert.equal(row.run_count, 1);
    assert.equal(row.locked_until, null);
    t.close();
  });

  test('un trabajo que falla queda registrado y genera alerta (una por día)', async () => {
    const t = setup();
    const bad = { name: 'roto', everyMs: 1, run: () => { throw new Error('disco lleno'); } };
    const s = createScheduler({ db: t.db, config: t.config, jobs: [bad], clock: () => t.clock.current });
    assert.equal((await s.runJob(bad)).status, 'error');
    t.clock.current = new Date(t.clock.current.getTime() + 1000);
    await s.runJob(bad);
    const row = t.db.prepare(`SELECT * FROM job_runs WHERE job = 'roto'`).get();
    assert.equal(row.last_status, 'error');
    assert.equal(row.last_error, 'disco lleno');
    assert.equal(t.db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE kind = 'alert'`).get().n, 1);
    t.close();
  });

  test('tick ejecuta todos los trabajos pendientes y no repite los no vencidos', async () => {
    const t = setup({ now: '2026-10-12T07:00:00Z' }); // 09:00 en Madrid
    const first = await t.scheduler.tick();
    assert.deepEqual(first.map((r) => r.status), ['ok', 'ok', 'ok', 'ok', 'ok']);
    const second = await t.scheduler.tick();
    assert.ok(second.every((r) => r.skipped === 'not_due'));
    assert.ok(t.scheduler.lastTick());
    t.close();
  });
});

describe('Trabajos de mantenimiento', () => {
  test('caducidad de licencias y recordatorios, sin duplicar avisos', () => {
    const t = setup();
    transaction(t.db, () => {
      issueLicense(t.db, t.config, { email: 'a@x.es', source: 'manual', expiresAt: '2026-10-12T09:00:00.000Z', sendEmail: false, now: t.clock.current });
      issueLicense(t.db, t.config, { email: 'b@x.es', source: 'manual', expiresAt: '2026-10-20T00:00:00.000Z', sendEmail: false, now: t.clock.current });
      issueLicense(t.db, t.config, { email: 'c@x.es', source: 'manual', expiresAt: null, sendEmail: false, now: t.clock.current });
    });
    assert.deepEqual(t.job('expire-licenses').run(), { expired: 1, reminders: 1 });
    assert.deepEqual(t.job('expire-licenses').run(), { expired: 0, reminders: 1 });
    const kinds = t.db.prepare('SELECT kind, to_addr FROM outbox ORDER BY id').all().map((r) => ({ ...r }));
    assert.deepEqual(kinds, [{ kind: 'expired', to_addr: 'a@x.es' }, { kind: 'expiry_reminder', to_addr: 'b@x.es' }]);
    t.close();
  });

  test('limpieza de datos temporales', () => {
    const t = setup();
    t.db.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)').run('old', 1000);
    t.db.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)').run('new', Math.floor(t.clock.current.getTime() / 1000));
    t.db.prepare(`INSERT INTO webhook_events (id, provider, type, received_at, status) VALUES ('e1','stripe','x','2026-01-01T00:00:00Z','processed'), ('e2','stripe','x','2026-01-01T00:00:00Z','error')`).run();
    assert.deepEqual(t.job('cleanup').run(), { rateLimits: 1, webhookEvents: 1, outbox: 0 });
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get().n, 1, 'los errores se conservan');
    t.close();
  });

  test('copia de seguridad legible y con retención', () => {
    const t = setup({ env: { BACKUP_RETENTION_DAYS: '7' } });
    transaction(t.db, () => issueLicense(t.db, t.config, { email: 'a@x.es', source: 'manual', sendEmail: false, now: t.clock.current }));
    const old = join(t.config.backupDir, 'remesalista-2026-09-01.sqlite');
    const recent = join(t.config.backupDir, 'remesalista-2026-10-10.sqlite');
    t.job('backup').run(); // crea el directorio
    writeFileSync(old, 'x');
    writeFileSync(recent, 'x');
    const r = t.job('backup').run();
    assert.equal(r.removed, 1);
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(recent), true);
    const copy = new DatabaseSync(r.file, { readOnly: true });
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM licenses').get().n, 1);
    copy.close();
    assert.deepEqual(readdirSync(t.config.backupDir).sort(), ['remesalista-2026-10-10.sqlite', 'remesalista-2026-10-12.sqlite']);
    t.close();
  });

  test('informe diario: un correo por día con contadores', () => {
    const t = setup();
    t.db.prepare(`INSERT INTO usage_daily (day, event, plan, count, amount) VALUES ('2026-10-11', 'generate_ok', 'free', 3, 40)`).run();
    assert.equal(t.job('daily-report').run().queued, true);
    assert.equal(t.job('daily-report').run().queued, false);
    const mail = t.db.prepare(`SELECT * FROM outbox WHERE kind = 'report'`).get();
    assert.equal(mail.to_addr, 'admin@example.com');
    assert.match(mail.body, /generate_ok \[free\]: 3 \(recibos: 40\)/);
    t.close();
  });
});

describe('Flujo automático completo (sin intervención manual)', () => {
  test('pago → webhook → licencia → correo enviado → uso Pro → cancelación → bloqueo', async () => {
    const s = await startTestServer();
    try {
      const sent = [];
      const emailer = { async send(m) { sent.push(m); } };
      const scheduler = createScheduler({ db: s.db, config: s.config, jobs: createJobs({ db: s.db, config: s.config, emailer, clock: () => s.clock.current }), clock: () => s.clock.current });

      assert.equal((await s.stripe(checkoutEvent({ id: 'evt_flow', subscription: 'sub_flow', email: 'tesorera@ampa.es' }))).status, 200);
      await scheduler.tick();
      const mail = sent.find((m) => m.to === 'tesorera@ampa.es');
      assert.ok(mail, 'el cliente recibe el correo');
      const key = mail.text.match(/RL-[0-9A-Z-]{23}/)[0];

      let res = await s.post('/api/generate', { remittance: sampleInput({ transactions: manyTransactions(100) }), licenseKey: key });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).summary.count, 100);

      await s.stripe({ id: 'evt_flow_end', type: 'customer.subscription.deleted', data: { object: { id: 'sub_flow' } } });
      res = await s.post('/api/generate', { remittance: sampleInput(), licenseKey: key });
      assert.equal(res.status, 402);
      assert.match((await res.json()).error, /revocada/);
    } finally {
      await s.close();
    }
  });
});
