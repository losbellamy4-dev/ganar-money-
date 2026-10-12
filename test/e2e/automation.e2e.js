// Automatización en un proceso real en modo producción: webhook firmado → licencia → correo enviado por el
// planificador del propio proceso a un proveedor (Resend simulado por HTTP) → la clave funciona → tareas
// programadas registradas. Sin intervención manual en ningún paso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, sampleInput, xsdValidate } from '../helpers.js';
import { signStripePayload } from '../../src/server/stripe.js';

const freePort = () => new Promise((resolve) => {
  const s = netServer();
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

test('proceso de producción: pago → correo con licencia en segundos → uso Pro → tareas ejecutadas', async () => {
  // Proveedor de correo simulado (misma API que Resend).
  const inbox = [];
  const mail = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      inbox.push({ auth: req.headers.authorization, ...JSON.parse(body) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(`{"id":"re_${inbox.length}"}`);
    });
  });
  await new Promise((r) => mail.listen(0, '127.0.0.1', r));

  const dir = mkdtempSync(join(tmpdir(), 'rl-auto-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const secret = 'whsec_e2e_automation';
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server/index.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir,
      APP_SECRET: 'p'.repeat(64), BASE_URL: 'https://remesalista.example', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test',
      RESEND_API_URL: `http://127.0.0.1:${mail.address().port}/emails`, EMAIL_FROM: 'RemesaLista <hola@remesalista.example>',
      ADMIN_EMAIL: 'admin@remesalista.example', CHECKOUT_URL: 'https://buy.stripe.com/test', STRIPE_WEBHOOK_SECRET: secret, HEALTH_TOKEN: 'h',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  proc.stdout.on('data', (d) => { logs += d; });
  proc.stderr.on('data', (d) => { logs += d; });

  try {
    for (let i = 0; i < 50 && !logs.includes('server_started'); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(logs, /server_started/);
    const home = await fetch(base);
    assert.match(home.headers.get('strict-transport-security'), /max-age=31536000/, 'HSTS en producción');

    const event = { id: 'evt_prod_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'subscription', payment_status: 'paid', subscription: 'sub_prod_1', customer_details: { email: 'club@example.com' } } } };
    const payload = JSON.stringify(event);
    const wh = await fetch(`${base}/api/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signStripePayload(payload, secret, Math.floor(Date.now() / 1000)) }, body: payload });
    assert.equal(wh.status, 200);

    const started = Date.now();
    while (!inbox.some((m) => m.to?.[0] === 'club@example.com') && Date.now() - started < 10000) await new Promise((r) => setTimeout(r, 100));
    const licenseMail = inbox.find((m) => m.to?.[0] === 'club@example.com');
    assert.ok(licenseMail, `el correo de licencia no llegó en 10 s. Logs:\n${logs}`);
    assert.equal(licenseMail.auth, 'Bearer re_test');
    assert.ok(Date.now() - started < 5000, 'el correo sale en segundos, no en el siguiente ciclo');
    const key = licenseMail.text.match(/RL-[0-9A-Z-]{23}/)[0];

    const transactions = Array.from({ length: 60 }, (_, i) => ({ name: `Socio ${i}`, iban: 'ES9121000418450200051332', amount: '15,00', mandateId: `S${i}`, mandateDate: '2024-01-01' }));
    const gen = await fetch(`${base}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remittance: { ...sampleInput({ transactions }), collectionDate: new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10) }, licenseKey: key }) });
    const body = await gen.json();
    assert.equal(gen.status, 200, JSON.stringify(body.errors));
    assert.equal(body.plan, 'pro');
    assert.equal(xsdValidate(body.xml, '02').ok, true);

    const health = await (await fetch(`${base}/healthz`, { headers: { Authorization: 'Bearer h' } })).json();
    const jobs = Object.fromEntries(health.jobs.map((j) => [j.job, j.last_status]));
    for (const name of ['send-emails', 'expire-licenses', 'cleanup', 'backup', 'daily-report']) assert.equal(jobs[name], 'ok', `${name}: ${JSON.stringify(health.jobs)}`);
    assert.equal(health.outbox.sent >= 1, true);
    assert.equal(health.emailProvider, 'resend');
    assert.ok(existsSync(join(dir, 'backups')) && readdirSync(join(dir, 'backups')).length === 1, 'copia de seguridad creada');
    // El informe diario también se envió al administrador.
    assert.ok(inbox.some((m) => m.to?.[0] === 'admin@remesalista.example' && /Informe diario/.test(m.subject)));
    // Ningún dato personal de los recibos en los registros.
    assert.doesNotMatch(logs, /ES9121000418450200051332|Socio 1\b/);
    assert.doesNotMatch(logs, new RegExp(key));
  } finally {
    proc.kill('SIGTERM');
    await new Promise((r) => proc.on('exit', r));
    await new Promise((r) => mail.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
