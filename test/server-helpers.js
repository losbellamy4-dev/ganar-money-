import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { createApp } from '../src/server/app.js';
import { setLogSink } from '../src/server/log.js';
import { signStripePayload } from '../src/server/stripe.js';

export const logs = [];
setLogSink((line) => logs.push(JSON.parse(line)));

/** Arranca la app real en un puerto libre con BD temporal. */
export async function startTestServer({ env = {}, now = '2026-10-12T10:00:00Z', scheduler = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rl-srv-'));
  const config = loadConfig({
    DATA_DIR: dir,
    APP_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
    BASE_URL: 'http://localhost',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
    CHECKOUT_URL: 'https://buy.stripe.com/test_abc',
    ADMIN_EMAIL: 'admin@example.com',
    ...env,
  });
  const db = openDatabase(config.dbPath);
  const clock = { current: new Date(now) };
  const app = createApp({ config, db, clock: () => clock.current, scheduler });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    config, db, clock, base, dir,
    async close() {
      await new Promise((r) => server.close(r));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
    post(path, body, headers = {}) {
      return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    },
    stripe(event, { secret = config.stripeWebhookSecret, timestamp = Math.floor(clock.current.getTime() / 1000) } = {}) {
      const payload = JSON.stringify(event);
      return fetch(`${base}/api/webhooks/stripe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signStripePayload(payload, secret, timestamp) },
        body: payload,
      });
    },
  };
}

export function checkoutEvent({ id = 'evt_1', session = 'cs_1', subscription = 'sub_1', email = 'cliente@example.com', paymentStatus = 'paid', mode = 'subscription', type = 'checkout.session.completed' } = {}) {
  return {
    id, type,
    data: { object: { id: session, object: 'checkout.session', mode, payment_status: paymentStatus, subscription, customer_details: { email } } },
  };
}

export function manyTransactions(n) {
  return Array.from({ length: n }, (_, i) => ({ name: `Socio ${i}`, iban: 'ES7921000813610123456789', amount: '10,00', mandateId: `M-${i}`, mandateDate: '01/01/2024' }));
}
