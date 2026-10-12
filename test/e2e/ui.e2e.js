// Pruebas de extremo a extremo: servidor real (proceso aparte) + Chromium real.
// Requiere Chromium (CHROMIUM_PATH o el de /opt/pw-browsers) y xmllint.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { ROOT, xsdValidate } from '../helpers.js';

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = join(ROOT, 'docs', 'screenshots');

function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startServer(extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rl-e2e-'));
  const port = await freePort();
  const env = {
    ...process.env,
    PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, APP_SECRET: 'e2e-secret-0123456789abcdef0123456789',
    BASE_URL: `http://127.0.0.1:${port}`, EMAIL_PROVIDER: 'log', NODE_ENV: 'development', ...extraEnv,
  };
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  proc.stdout.on('data', (d) => { output += d; });
  proc.stderr.on('data', (d) => { output += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch { /* aún arrancando */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    base, env, dir, logs: () => output,
    async stop() {
      proc.kill('SIGTERM');
      await new Promise((r) => proc.on('exit', r));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let server;
let browser;
const consoleErrors = [];

before(async () => {
  if (!existsSync(CHROMIUM)) throw new Error(`No se encuentra Chromium en ${CHROMIUM}`);
  mkdirSync(SHOTS, { recursive: true });
  server = await startServer();
  browser = await chromium.launch({ executablePath: CHROMIUM });
});

after(async () => {
  await browser?.close();
  await server?.stop();
});

async function newPage(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true, locale: 'es-ES' });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  return page;
}

async function downloadXml(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#generate')]);
  const path = await download.path();
  return { name: download.suggestedFilename(), xml: readFileSync(path, 'utf8') };
}

test('flujo completo con el ejemplo: valida, genera y descarga un XML válido', async () => {
  const page = await newPage();
  await page.goto(server.base);
  await page.click('#load-example');
  await page.waitForSelector('#status .notice.success');
  assert.equal(await page.isEnabled('#generate'), true);
  await page.screenshot({ path: join(SHOTS, 'escritorio-ejemplo.png'), fullPage: true });
  const { name, xml } = await downloadXml(page);
  assert.match(name, /^remesa-\d{4}-\d{2}-\d{2}-[A-Z0-9]{8}\.xml$/);
  assert.equal(xsdValidate(xml, '02').ok, true);
  assert.match(xml, /<NbOfTxs>4<\/NbOfTxs>/);
  assert.match(xml, /<Nm>Jose Munoz Pena \(EJEMPLO\)<\/Nm>/);
  await page.waitForSelector('#result .notice.success');
  assert.match(await page.textContent('#result'), /4 recibos por un total de 115,00 €/);

  // Versión 2019 desde las opciones avanzadas.
  await page.click('details summary');
  await page.selectOption('#opt-version', '08');
  const v8 = await downloadXml(page);
  assert.equal(xsdValidate(v8.xml, '08').ok, true);
  await page.context().close();
});

test('errores: se señalan por fila y campo y bloquean la generación', async () => {
  const page = await newPage();
  await page.goto(server.base);
  await page.fill('#cred-name', 'AMPA Colegio Ejemplo');
  await page.fill('#cred-iban', 'ES14 3058 0990 2627 1234 5678');
  await page.fill('#cred-id', 'ES99000G12345674');
  await page.fill('#rows', 'Nombre\tIBAN\tImporte\tMandato\tFecha firma\nAna\tES91 2100 0418 4502 0005 1333\t25\tM1\t01/01/2024\nLuis\tES70 0049 1500 0105 1234 5678\t12,345\tM2\t31/02/2024');
  await page.waitForSelector('#status .notice.error');
  const text = await page.textContent('#status');
  assert.match(text, /dígitos de control del identificador de acreedor/);
  assert.match(text, /Fila 2 · IBAN/);
  assert.match(text, /Fila 3 · Importe: «12,345» es ambiguo/);
  assert.match(text, /Fila 3 · Fecha firma/);
  assert.equal(await page.getAttribute('#cred-id', 'aria-invalid'), 'true');
  assert.equal(await page.isDisabled('#generate'), true);
  assert.equal(await page.locator('tr.row-error').count(), 2);
  await page.context().close();
});

test('límite gratuito → licencia emitida por CLI → Pro desbloquea la remesa grande', async () => {
  const page = await newPage();
  await page.goto(server.base);
  await page.click('#load-example');
  const rows = ['Nombre\tIBAN\tImporte\tMandato\tFecha firma'];
  for (let i = 0; i < 30; i++) rows.push(`Socio ${i}\tES91 2100 0418 4502 0005 1332\t10\tM-${i}\t01/01/2024`);
  await page.fill('#rows', rows.join('\n'));
  await page.waitForSelector('#status .notice.warning[role=alert]');
  assert.match(await page.textContent('#status'), /supera el plan gratuito/);
  assert.equal(await page.isDisabled('#generate'), true);

  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/license.js', 'issue', '--email', 'tesoreria@example.com', '--no-email', '--days', '30'], { cwd: ROOT, env: server.env }).toString();
  const key = out.match(/RL-[0-9A-Z-]{23}/)[0];
  await page.fill('#license-key', key);
  await page.click('#license-check');
  await page.waitForSelector('#license-status .notice.success');
  await page.waitForFunction(() => !document.querySelector('#generate').disabled);
  const { xml } = await downloadXml(page);
  assert.match(xml, /<NbOfTxs>30<\/NbOfTxs>/);
  assert.equal(xsdValidate(xml, '02').ok, true);

  // La licencia se recuerda al recargar.
  await page.reload();
  await page.waitForSelector('#license-status .notice.success');
  await page.context().close();
});

test('lista de espera de Pro (sin pagos configurados)', async () => {
  const page = await newPage();
  await page.goto(server.base);
  assert.equal(await page.isVisible('#waitlist'), true);
  assert.equal(await page.isVisible('#license-remove'), false, 'el botón Quitar está oculto sin licencia');
  // La casilla y su texto forman una sola línea lógica: el texto no se parte en columnas.
  const parts = await page.$$eval('label:has(#wl-consent) > *', (els) => els.length);
  assert.equal(parts, 2);
  await page.fill('#wl-email', 'interesado@example.com');
  await page.click('#waitlist-form button[type=submit]');
  assert.match(await page.textContent('#waitlist-status'), /consentimiento/);
  await page.check('#wl-consent');
  await page.selectOption('#wl-org', 'Club deportivo');
  await page.click('#waitlist-form button[type=submit]');
  await page.waitForSelector('#waitlist-status .notice.success');
  await page.context().close();
});

test('CSV guardado por Excel en Windows-1252 conserva las eñes', async () => {
  const page = await newPage();
  await page.goto(server.base);
  const file = join(server.dir, 'socios.csv');
  writeFileSync(file, Buffer.from('Nombre;IBAN;Importe;Referencia mandato;Fecha firma\r\nIñaki Muñoz;ES91 2100 0418 4502 0005 1332;25,00;M1;01/01/2024\r\n', 'latin1'));
  await page.setInputFiles('#csv-file', file);
  await page.waitForSelector('#preview table');
  assert.match(await page.textContent('#preview'), /Iñaki Muñoz/);
  await page.context().close();
});

test('calculadora del identificador de acreedor', async () => {
  const page = await newPage();
  await page.goto(`${server.base}/calculadora-identificador-acreedor`);
  await page.fill('#calc-nif', 'g12345674');
  await page.click('#calc-form button');
  assert.match(await page.textContent('#calc-result'), /ES37000G12345674/);
  await page.fill('#check-id', 'ES38000G12345674');
  await page.click('#check-form button');
  assert.match(await page.textContent('#check-result'), /el identificador correcto sería ES37000G12345674/);
  await page.context().close();
});

test('móvil (375 px): sin desplazamiento horizontal en ninguna página', async () => {
  const page = await newPage({ width: 375, height: 800 });
  for (const path of ['/', '/calculadora-identificador-acreedor', '/guias/remesa-sepa-xml', '/guias/errores-remesa-sepa', '/legal/privacidad']) {
    await page.goto(server.base + path);
    if (path === '/') await page.click('#load-example');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${path} desborda ${overflow}px`);
  }
  await page.goto(server.base);
  await page.click('#load-example');
  await page.waitForSelector('#status .notice.success');
  await page.screenshot({ path: join(SHOTS, 'movil-ejemplo.png'), fullPage: true });
  await page.context().close();
});

test('sin errores de consola ni violaciones de CSP en todo el recorrido', () => {
  assert.deepEqual(consoleErrors, []);
});

test('pagos configurados: botón de compra visible y sin lista de espera', async () => {
  const paid = await startServer({ CHECKOUT_URL: 'https://buy.stripe.com/test_123', STRIPE_WEBHOOK_SECRET: 'whsec_x', PRO_PRICE_LABEL: '5,90 €/mes (IVA incl.)' });
  try {
    const page = await newPage();
    await page.goto(paid.base);
    await page.waitForSelector('#pro-buy a[href="https://buy.stripe.com/test_123"]');
    assert.equal(await page.textContent('#pro-price'), '5,90 €/mes (IVA incl.)');
    assert.equal(await page.isVisible('#waitlist'), false);
    await page.context().close();
  } finally {
    await paid.stop();
  }
});
