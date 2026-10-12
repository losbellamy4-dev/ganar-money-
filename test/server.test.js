import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, checkoutEvent, manyTransactions } from './server-helpers.js';
import { sampleInput, xsdValidate } from './helpers.js';
import { transaction } from '../src/server/db.js';
import { issueLicense } from '../src/server/licenses.js';

describe('API de generación', () => {
  let s;
  before(async () => {
    s = await startTestServer();
  });
  after(() => s.close());

  test('healthz y config', async () => {
    const h = await (await fetch(`${s.base}/healthz`)).json();
    assert.equal(h.status, 'ok');
    assert.deepEqual(h.problems, []);
    const c = await (await fetch(`${s.base}/api/config`)).json();
    assert.equal(c.freeMaxTransactions, 25);
    assert.equal(c.proAvailable, true);
    assert.equal(c.today, '2026-10-12');
  });

  test('genera XML válido en plan gratuito y registra uso sin datos personales', async () => {
    for (const version of ['02', '08']) {
      const res = await s.post('/api/generate', { remittance: sampleInput(), version });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.plan, 'free');
      assert.match(body.filename, /^remesa-2026-10-20-[A-Z0-9]{8}\.xml$/);
      assert.equal(xsdValidate(body.xml, version).ok, true);
      assert.ok(body.warnings.length > 0);
    }
    const usage = s.db.prepare(`SELECT * FROM usage_daily WHERE event = 'generate_ok'`).get();
    assert.equal(usage.count, 2);
    assert.equal(usage.amount, 4);
    assert.equal(JSON.stringify(s.db.prepare('SELECT * FROM usage_daily').all()).includes('ES79'), false);
  });

  test('límite gratuito de recibos y B2B se aplican en el servidor; una licencia válida los levanta', async () => {
    const big = sampleInput({ transactions: manyTransactions(26) });
    let res = await s.post('/api/generate', { remittance: big });
    assert.equal(res.status, 422);
    assert.ok((await res.json()).errors.some((e) => e.code === 'LIMIT_TRANSACTIONS'));
    res = await s.post('/api/generate', { remittance: sampleInput({ scheme: 'B2B' }) });
    assert.equal(res.status, 422);
    assert.ok((await res.json()).errors.some((e) => e.code === 'PLAN_B2B'));

    const { key } = transaction(s.db, () => issueLicense(s.db, s.config, { email: 'pro@example.com', source: 'manual', now: s.clock.current }));
    res = await s.post('/api/generate', { remittance: big, licenseKey: key });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.plan, 'pro');
    assert.equal(body.summary.count, 26);
    res = await s.post('/api/generate', { remittance: sampleInput({ scheme: 'B2B' }), licenseKey: key.toLowerCase().replace(/-/g, ' ') });
    assert.equal(res.status, 200, 'la clave se normaliza (minúsculas y espacios)');

    const blocked = s.db.prepare(`SELECT count FROM usage_daily WHERE event = 'generate_blocked_plan'`).get();
    assert.equal(blocked.count, 2);
  });

  test('clave de licencia inexistente: 402 con mensaje claro', async () => {
    const res = await s.post('/api/generate', { remittance: sampleInput(), licenseKey: 'RL-AAAAA-BBBBB-CCCCC-DDDDD' });
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.code, 'LICENSE_INVALID');
    assert.match(body.error, /no es válida/);
  });

  test('entradas inválidas: JSON roto, tipo de contenido, tamaño, ruta desconocida', async () => {
    assert.equal((await s.post('/api/generate', '{roto')).status, 400);
    assert.equal((await s.post('/api/generate', '{}', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await s.post('/api/generate', { remittance: { x: 'a'.repeat(4 * 1024 * 1024) } })).status, 413);
    assert.equal((await s.post('/api/nada', {})).status, 404);
    const r = await s.post('/api/generate', { remittance: {} });
    assert.equal(r.status, 422);
    assert.equal((await fetch(`${s.base}/`, { method: 'DELETE' })).status, 405);
  });
});

describe('Límite de peticiones', () => {
  test('el plan gratuito se limita por IP y devuelve Retry-After', async () => {
    const s = await startTestServer({ env: { FREE_GENERATIONS_PER_HOUR: '2' } });
    try {
      assert.equal((await s.post('/api/generate', { remittance: sampleInput() })).status, 200);
      assert.equal((await s.post('/api/generate', { remittance: sampleInput() })).status, 200);
      const res = await s.post('/api/generate', { remittance: sampleInput() });
      assert.equal(res.status, 429);
      assert.ok(Number(res.headers.get('retry-after')) > 0);
      // En la ventana siguiente vuelve a permitir.
      s.clock.current = new Date('2026-10-12T11:00:01Z');
      assert.equal((await s.post('/api/generate', { remittance: sampleInput() })).status, 200);
      // No se guardan IPs en claro.
      const keys = s.db.prepare('SELECT key FROM rate_limits').all().map((r) => r.key);
      assert.ok(keys.every((k) => !k.includes('127.0.0.1')));
    } finally {
      await s.close();
    }
  });
});

describe('Ficheros estáticos y cabeceras de seguridad', () => {
  let s;
  before(async () => {
    s = await startTestServer();
  });
  after(() => s.close());

  test('página principal con CSP y sin caché agresiva', async () => {
    const res = await fetch(`${s.base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await res.text(), /<html lang="es">/);
  });

  test('módulos del núcleo permitidos; el generador XML no se sirve al navegador', async () => {
    assert.equal((await fetch(`${s.base}/lib/sepa/validate.js`)).status, 200);
    assert.equal((await fetch(`${s.base}/lib/sepa/xml.js`)).status, 404);
    assert.equal((await fetch(`${s.base}/lib/sepa/../server/app.js`)).status, 404);
  });

  test('sin acceso fuera de public/', async () => {
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/.env', '/%00']) {
      const res = await fetch(`${s.base}${p}`);
      assert.ok([400, 404].includes(res.status), `${p} → ${res.status}`);
    }
  });

  test('plantillas: BASE_URL y datos pendientes del titular visibles', async () => {
    const legal = await (await fetch(`${s.base}/legal/aviso-legal`)).text();
    assert.match(legal, /\[PENDIENTE: NIF del titular\]/);
    const sitemap = await (await fetch(`${s.base}/sitemap.xml`)).text();
    assert.match(sitemap, /<loc>http:\/\/localhost\/<\/loc>/);
    const res404 = await fetch(`${s.base}/no-existe`);
    assert.equal(res404.status, 404);
    assert.match(await res404.text(), /no existe/i);
  });
});

describe('Webhook de Stripe → licencia', () => {
  let s;
  before(async () => {
    s = await startTestServer();
  });
  after(() => s.close());

  test('rechaza peticiones sin firma, con firma errónea o antiguas', async () => {
    assert.equal((await s.post('/api/webhooks/stripe', checkoutEvent())).status, 400);
    assert.equal((await s.stripe(checkoutEvent(), { secret: 'whsec_otro' })).status, 400);
    const old = Math.floor(s.clock.current.getTime() / 1000) - 3600;
    assert.equal((await s.stripe(checkoutEvent(), { timestamp: old })).status, 400);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM licenses').get().n, 0);
  });

  test('pago completado: emite licencia y encola el correo, de forma idempotente', async () => {
    let res = await s.stripe(checkoutEvent({ id: 'evt_A', subscription: 'sub_A' }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).action, 'license_issued');
    const lic = s.db.prepare(`SELECT * FROM licenses WHERE external_ref = 'sub_A'`).get();
    assert.equal(lic.email, 'cliente@example.com');
    assert.equal(lic.status, 'active');
    assert.equal(lic.expires_at, null);
    const mail = s.db.prepare(`SELECT * FROM outbox WHERE kind = 'license'`).get();
    assert.match(mail.body, /RL-[0-9A-Z]{5}-/);

    // Reintento del mismo evento (Stripe reenvía): no duplica.
    res = await s.stripe(checkoutEvent({ id: 'evt_A', subscription: 'sub_A' }));
    assert.equal((await res.json()).status, 'duplicate');
    // Otro evento de la misma suscripción: tampoco duplica.
    res = await s.stripe(checkoutEvent({ id: 'evt_A2', type: 'checkout.session.async_payment_succeeded', subscription: 'sub_A' }));
    assert.equal((await res.json()).action, 'license_already_issued');
    assert.equal(s.db.prepare(`SELECT COUNT(*) AS n FROM licenses`).get().n, 1);
    assert.equal(s.db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE kind = 'license'`).get().n, 1);
  });

  test('pago único: licencia con caducidad; pago pendiente: no emite', async () => {
    await s.stripe(checkoutEvent({ id: 'evt_B', session: 'cs_B', subscription: null, mode: 'payment' }));
    const lic = s.db.prepare(`SELECT * FROM licenses WHERE external_ref = 'cs_B'`).get();
    assert.equal(lic.expires_at.slice(0, 10), '2027-10-12');
    const res = await s.stripe(checkoutEvent({ id: 'evt_C', session: 'cs_C', subscription: null, mode: 'payment', paymentStatus: 'unpaid' }));
    assert.equal((await res.json()).action, 'awaiting_payment');
    assert.equal(s.db.prepare(`SELECT COUNT(*) AS n FROM licenses WHERE external_ref = 'cs_C'`).get().n, 0);
  });

  test('cancelación de suscripción revoca la licencia', async () => {
    const res = await s.stripe({ id: 'evt_D', type: 'customer.subscription.deleted', data: { object: { id: 'sub_A' } } });
    assert.equal((await res.json()).action, 'license_revoked');
    assert.equal(s.db.prepare(`SELECT status FROM licenses WHERE external_ref = 'sub_A'`).get().status, 'revoked');
  });

  test('evento con datos incompletos: 500 (Stripe reintentará), alerta al administrador y reproceso posterior', async () => {
    const bad = checkoutEvent({ id: 'evt_E', subscription: 'sub_E', email: null });
    let res = await s.stripe(bad);
    assert.equal(res.status, 500);
    assert.equal(s.db.prepare(`SELECT status FROM webhook_events WHERE id = 'evt_E'`).get().status, 'error');
    assert.equal(s.db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE kind = 'alert' AND to_addr = 'admin@example.com'`).get().n, 1);
    res = await s.stripe(checkoutEvent({ id: 'evt_E', subscription: 'sub_E' }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).action, 'license_issued');
  });

  test('webhook sin secreto configurado: 503', async () => {
    const s2 = await startTestServer({ env: { STRIPE_WEBHOOK_SECRET: '' } });
    try {
      assert.equal((await s2.stripe(checkoutEvent(), { secret: 'x' })).status, 503);
      assert.equal((await (await fetch(`${s2.base}/api/config`)).json()).proAvailable, false);
    } finally {
      await s2.close();
    }
  });
});

describe('Lista de espera, eventos y verificación de licencias', () => {
  let s;
  before(async () => {
    s = await startTestServer();
  });
  after(() => s.close());

  test('interés: valida email y consentimiento; no duplica', async () => {
    assert.equal((await s.post('/api/interest', { email: 'malo', consent: true })).status, 400);
    assert.equal((await s.post('/api/interest', { email: 'a@b.es' })).status, 400);
    assert.equal((await s.post('/api/interest', { email: 'A@B.es', consent: true, feature: 'pro', orgType: 'AMPA', bank: 'Caja\u0000Rural' })).status, 200);
    assert.equal((await s.post('/api/interest', { email: 'a@b.es', consent: true, feature: 'pro' })).status, 200);
    const rows = s.db.prepare('SELECT * FROM interest').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, 'a@b.es');
    assert.equal(rows[0].bank, 'CajaRural');
    assert.equal(s.db.prepare(`SELECT count FROM usage_daily WHERE event = 'interest_pro'`).get().count, 1);
  });

  test('eventos de embudo: solo los permitidos', async () => {
    assert.equal((await s.post('/api/event', { name: 'pro_click' })).status, 200);
    assert.equal((await s.post('/api/event', { name: '<script>' })).status, 400);
    assert.equal(s.db.prepare(`SELECT count FROM usage_daily WHERE event = 'client_pro_click'`).get().count, 1);
  });

  test('verificación de licencia', async () => {
    const { key } = transaction(s.db, () => issueLicense(s.db, s.config, { email: 'x@y.es', source: 'manual', expiresAt: '2026-10-13T00:00:00.000Z', now: s.clock.current }));
    let r = await (await s.post('/api/license/verify', { key })).json();
    assert.equal(r.valid, true);
    s.clock.current = new Date('2026-10-14T00:00:00Z');
    r = await (await s.post('/api/license/verify', { key })).json();
    assert.deepEqual(r, { valid: false, reason: 'expired' });
    r = await (await s.post('/api/license/verify', { key: 'basura' })).json();
    assert.deepEqual(r, { valid: false, reason: 'format' });
  });
});

describe('Rendimiento', () => {
  test('remesa máxima Pro (5.000 recibos) por la API en menos de 3 s y con XML válido', async () => {
    const s = await startTestServer();
    try {
      const { key } = transaction(s.db, () => issueLicense(s.db, s.config, { email: 'big@example.com', source: 'manual', now: s.clock.current }));
      const started = performance.now();
      const res = await s.post('/api/generate', { remittance: sampleInput({ transactions: manyTransactions(5000) }), licenseKey: key });
      const ms = performance.now() - started;
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.summary.count, 5000);
      assert.ok(ms < 3000, `tardó ${ms.toFixed(0)} ms`);
      assert.equal(xsdValidate(body.xml, '02').ok, true);
      // Por encima del máximo absoluto se rechaza incluso con licencia.
      const over = await s.post('/api/generate', { remittance: sampleInput({ transactions: manyTransactions(5001) }), licenseKey: key });
      assert.equal(over.status, 422);
    } finally {
      await s.close();
    }
  });
});
