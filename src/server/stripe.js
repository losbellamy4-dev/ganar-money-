// Integración con Stripe por webhook (sin SDK). Implementa la verificación de firma documentada por Stripe:
// cabecera Stripe-Signature "t=<unix>,v1=<hex>", firma = HMAC-SHA256(secreto, `${t}.${cuerpo}`).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { transaction } from './db.js';
import { issueLicense, revokeLicenses } from './licenses.js';
import { enqueueEmail } from './outbox.js';

export function signStripePayload(payload, secret, timestamp) {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

export function verifyStripeSignature(rawBody, header, secret, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!secret) return { ok: false, reason: 'not_configured' };
  if (!header) return { ok: false, reason: 'missing_header' };
  const parts = Object.groupBy(String(header).split(','), (p) => p.split('=')[0].trim());
  const t = Number(parts.t?.[0]?.split('=')[1]);
  const sigs = (parts.v1 ?? []).map((p) => p.split('=')[1]);
  if (!Number.isFinite(t) || !sigs.length) return { ok: false, reason: 'malformed_header' };
  if (Math.abs(now / 1000 - t) > toleranceSec) return { ok: false, reason: 'timestamp_out_of_tolerance' };
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'), 'hex');
  const match = sigs.some((s) => {
    const got = Buffer.from(s ?? '', 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  return match ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

const PAID_STATUSES = new Set(['paid', 'no_payment_required']);

/**
 * Procesa un evento ya verificado. Idempotente: el id del evento se registra en webhook_events
 * dentro de la misma transacción que sus efectos.
 * @returns {{status: 'processed'|'duplicate'|'ignored', action?: string}}
 */
export function handleStripeEvent(db, config, event, now = new Date()) {
  if (!event?.id || !event?.type) throw new Error('Evento sin id o tipo.');
  return transaction(db, () => {
    const seen = db.prepare('SELECT status FROM webhook_events WHERE id = ?').get(event.id);
    if (seen && seen.status !== 'error') return { status: 'duplicate' };

    let action = 'ignored';
    const obj = event.data?.object ?? {};
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      if (PAID_STATUSES.has(obj.payment_status)) {
        const email = obj.customer_details?.email ?? obj.customer_email;
        if (!email) throw new Error('La sesión de pago no incluye email del cliente.');
        const subscription = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id;
        const isSubscription = obj.mode === 'subscription';
        const expiresAt = isSubscription ? null : new Date(now.getTime() + config.proPassDays * 86400000).toISOString();
        const res = issueLicense(db, config, {
          email,
          plan: 'pro',
          source: 'stripe',
          externalRef: subscription ?? obj.id,
          expiresAt,
          now,
        });
        action = res.duplicate ? 'license_already_issued' : 'license_issued';
      } else {
        action = 'awaiting_payment';
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const n = revokeLicenses(db, { source: 'stripe', externalRef: obj.id, now });
      action = n ? 'license_revoked' : 'no_license_to_revoke';
    }

    db.prepare(`INSERT INTO webhook_events (id, provider, type, received_at, processed_at, status, error)
      VALUES (?, 'stripe', ?, ?, ?, ?, NULL)
      ON CONFLICT (id) DO UPDATE SET processed_at = excluded.processed_at, status = excluded.status, error = NULL`)
      .run(event.id, event.type, now.toISOString(), now.toISOString(), action === 'ignored' ? 'ignored' : 'processed');
    return { status: action === 'ignored' ? 'ignored' : 'processed', action };
  });
}

/** Registra un fallo de procesamiento (fuera de la transacción revertida) y avisa al administrador. */
export function recordWebhookFailure(db, config, event, err, now = new Date()) {
  db.prepare(`INSERT INTO webhook_events (id, provider, type, received_at, status, error) VALUES (?, 'stripe', ?, ?, 'error', ?)
    ON CONFLICT (id) DO UPDATE SET status = 'error', error = excluded.error`)
    .run(String(event?.id ?? `unknown-${now.getTime()}`), String(event?.type ?? 'unknown'), now.toISOString(), String(err?.message ?? err).slice(0, 500));
  enqueueEmail(db, {
    kind: 'alert',
    to: config.adminEmail,
    subject: `[RemesaLista] Fallo al procesar webhook de Stripe (${event?.type ?? 'desconocido'})`,
    body: `Evento: ${event?.id}\nTipo: ${event?.type}\nError: ${err?.message ?? err}\n\nStripe reintentará el envío automáticamente. Si el fallo persiste, revisa los registros y el evento en el panel de Stripe.`,
    dedupeKey: `alert-webhook-${event?.id}`,
    now,
  });
}
