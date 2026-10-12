// Planificador en proceso con bloqueo en base de datos: si hay dos instancias, cada trabajo
// solo lo ejecuta una. El estado de cada trabajo queda en job_runs (visible en /healthz).
import * as logger from '../server/log.js';
import { enqueueEmail } from '../server/outbox.js';

export function madridParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export function isDue(job, row, now) {
  if (!row?.last_started_at) return true;
  if (job.everyMs) return now - new Date(row.last_started_at) >= job.everyMs;
  if (job.dailyAtHour !== undefined) {
    const current = madridParts(now);
    const last = madridParts(new Date(row.last_started_at));
    return current.hour >= job.dailyAtHour && last.day < current.day;
  }
  return false;
}

export function createScheduler({ db, config, jobs, clock = () => new Date(), tickMs = 30000, lockMs = 10 * 60 * 1000 }) {
  let timer = null;
  let lastTick = null;
  let running = false;

  const getRow = db.prepare('SELECT * FROM job_runs WHERE job = ?');
  const ensureRow = db.prepare('INSERT INTO job_runs (job) VALUES (?) ON CONFLICT (job) DO NOTHING');
  const lock = db.prepare(`UPDATE job_runs SET locked_until = ?, last_started_at = ?
    WHERE job = ? AND (locked_until IS NULL OR locked_until < ?)`);
  const finish = db.prepare(`UPDATE job_runs SET locked_until = NULL, last_finished_at = ?, last_status = ?, last_error = ?,
    run_count = run_count + 1 WHERE job = ?`);

  async function runJob(job, { force = false } = {}) {
    const now = clock();
    ensureRow.run(job.name);
    if (!force && !isDue(job, getRow.get(job.name), now)) return { job: job.name, skipped: 'not_due' };
    const acquired = lock.run(new Date(now.getTime() + lockMs).toISOString(), now.toISOString(), job.name, now.toISOString()).changes;
    if (!acquired) return { job: job.name, skipped: 'locked' };
    try {
      const result = await job.run();
      finish.run(clock().toISOString(), 'ok', null, job.name);
      return { job: job.name, status: 'ok', result };
    } catch (e) {
      finish.run(clock().toISOString(), 'error', String(e.message).slice(0, 500), job.name);
      logger.alert('job_failed', { job: job.name, error: e.message });
      enqueueEmail(db, {
        kind: 'alert',
        to: config.adminEmail,
        subject: `[RemesaLista] Fallo en la tarea programada «${job.name}»`,
        body: `La tarea «${job.name}» ha fallado: ${e.message}\n\nSe reintentará en la próxima ejecución programada. Estado completo en ${config.baseUrl}/healthz`,
        dedupeKey: `alert-job-${job.name}-${madridParts(now).day}`,
        now,
      });
      return { job: job.name, status: 'error', error: e.message };
    }
  }

  async function tick({ force = false } = {}) {
    if (running) return [];
    running = true;
    lastTick = clock();
    try {
      const results = [];
      for (const job of jobs) results.push(await runJob(job, { force }));
      return results;
    } finally {
      running = false;
    }
  }

  return {
    tick,
    runJob,
    // Ejecuta ya un trabajo concreto (p. ej. enviar la licencia nada más pagar) sin esperar al siguiente ciclo.
    kick(name) {
      const job = jobs.find((j) => j.name === name);
      if (!job) return Promise.resolve(null);
      return runJob(job, { force: true }).catch((e) => logger.error('scheduler_kick_failed', { job: name, error: e.message }));
    },
    lastTick: () => lastTick,
    start() {
      if (timer) return;
      tick().catch((e) => logger.error('scheduler_tick_failed', { error: e.message }));
      timer = setInterval(() => tick().catch((e) => logger.error('scheduler_tick_failed', { error: e.message })), tickMs);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
