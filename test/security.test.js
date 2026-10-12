import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './server-helpers.js';
import { sampleInput, ROOT } from './helpers.js';

describe('Endurecimiento HTTP', () => {
  test('X-Forwarded-For: se usa la IP que añade el proxy (la última), no la que inventa el cliente', async () => {
    const s = await startTestServer({ env: { TRUST_PROXY: '1', FREE_GENERATIONS_PER_HOUR: '2' } });
    try {
      const statuses = [];
      for (let i = 0; i < 3; i++) {
        const r = await s.post('/api/generate', { remittance: sampleInput() }, { 'X-Forwarded-For': `6.6.6.${i}, 10.0.0.1` });
        statuses.push(r.status);
      }
      assert.deepEqual(statuses, [200, 200, 429]);
    } finally {
      await s.close();
    }
  });

  test('intentos con claves de licencia inválidas también se limitan', async () => {
    const s = await startTestServer();
    try {
      let last;
      for (let i = 0; i < 31; i++) last = await s.post('/api/generate', { remittance: sampleInput(), licenseKey: `RL-AAAAA-BBBBB-CCCCC-${String(i).padStart(5, '0')}` });
      assert.equal(last.status, 429);
    } finally {
      await s.close();
    }
  });

  test('URL mal codificada → 400; errores sin trazas internas y con cabeceras de seguridad', async () => {
    const s = await startTestServer();
    try {
      assert.equal((await fetch(`${s.base}/%E0%A4%A`)).status, 400);
      for (const [path, init] of [['/api/nada', { method: 'POST' }], ['/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }]]) {
        const res = await fetch(s.base + path, init);
        const text = await res.text();
        assert.doesNotMatch(text, /\bat .*\.js:\d+/, 'sin trazas de pila');
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.match(res.headers.get('content-type'), /application\/json/);
        assert.ok(res.headers.get('content-security-policy'));
      }
      // Un intento de inyección en la ruta no se refleja como HTML.
      const res = await fetch(`${s.base}/api/<script>alert(1)</script>`, { method: 'POST' });
      assert.match(res.headers.get('content-type'), /application\/json/);
      assert.doesNotMatch(await res.text(), /<script>/);
    } finally {
      await s.close();
    }
  });

  test('/healthz público sin detalles internos; con HEALTH_TOKEN, completo', async () => {
    const s = await startTestServer({ env: { HEALTH_TOKEN: 'tok-123' } });
    try {
      const pub = await (await fetch(`${s.base}/healthz`)).json();
      assert.deepEqual(Object.keys(pub).sort(), ['problems', 'status', 'time', 'version']);
      const bad = await (await fetch(`${s.base}/healthz`, { headers: { Authorization: 'Bearer otro' } })).json();
      assert.equal(bad.jobs, undefined);
      const full = await (await fetch(`${s.base}/healthz`, { headers: { Authorization: 'Bearer tok-123' } })).json();
      assert.ok(Array.isArray(full.jobs));
      assert.equal(full.paymentsConfigured, true);
    } finally {
      await s.close();
    }
  });
});

describe('Salvaguardas de producción', () => {
  const run = (script, env) => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-prod-'));
    try {
      return spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', script], {
        cwd: ROOT, env: { PATH: process.env.PATH, DATA_DIR: dir, PORT: '0', ...env }, encoding: 'utf8', timeout: 10000,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test('el servidor no arranca en producción sin APP_SECRET', () => {
    const r = run('src/server/index.js', { NODE_ENV: 'production' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /APP_SECRET es obligatorio/);
  });

  test('el servidor no arranca con pagos activos y correo simulado', () => {
    const r = run('src/server/index.js', { NODE_ENV: 'production', APP_SECRET: 'x'.repeat(40), CHECKOUT_URL: 'https://buy.stripe.com/x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /EMAIL_PROVIDER=log/);
  });

  test('preflight falla con configuración incompleta y pasa con la completa', () => {
    const bad = run('scripts/preflight.js', {});
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /\[FALLA\] APP_SECRET/);
    assert.match(bad.stdout, /NO publicar todavía/);
    const good = run('scripts/preflight.js', {
      NODE_ENV: 'production', APP_SECRET: 'a'.repeat(64), BASE_URL: 'https://remesalista.example',
      OWNER_NAME: 'Titular', OWNER_TAX_ID: '00000000T', OWNER_ADDRESS: 'Calle 1', OWNER_EMAIL: 'hola@remesalista.example',
      EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_x', EMAIL_FROM: 'RemesaLista <hola@remesalista.example>', ADMIN_EMAIL: 'admin@remesalista.example',
      TRUST_PROXY: '1',
    });
    assert.equal(good.status, 0, good.stdout);
    assert.match(good.stdout, /Configuración de producción completa/);
  });
});
