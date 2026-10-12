// Licencias Pro. Solo se guarda un HMAC de la clave: si alguien obtiene la base de datos,
// no obtiene claves utilizables.
import { createHmac, randomBytes } from 'node:crypto';
import { enqueueEmail } from './outbox.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Base32 de Crockford (sin I, L, O, U).

export function generateLicenseKey(random = randomBytes) {
  const bytes = random(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += ALPHABET[bytes[i] % 32];
  return `RL-${out.match(/.{5}/g).join('-')}`;
}

export function normalizeLicenseKey(key) {
  return String(key ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function hashLicenseKey(key, secret) {
  return createHmac('sha256', secret).update(normalizeLicenseKey(key)).digest('hex');
}

function licenseEmail({ key, baseUrl, expiresAt }) {
  return [
    'Gracias por tu compra de RemesaLista Pro.',
    '',
    `Tu clave de licencia: ${key}`,
    '',
    `Para activarla, abre ${baseUrl}/ y pega la clave en el apartado «Plan Pro».`,
    expiresAt ? `La licencia es válida hasta el ${expiresAt.slice(0, 10)}.` : 'La licencia se mantiene activa mientras la suscripción esté al día.',
    '',
    'Guarda este correo: por seguridad no almacenamos la clave en claro y no podemos volver a mostrártela.',
    'Si la pierdes, responde a este correo y te emitiremos una nueva.',
  ].join('\n');
}

/**
 * Crea una licencia y encola el correo con la clave (en la misma transacción que la llame).
 * Si ya existe una licencia con la misma (source, externalRef) no crea otra: devuelve {duplicate: true}.
 */
export function issueLicense(db, config, { email, plan = 'pro', source, externalRef = null, expiresAt = null, notes = null, sendEmail = true, now = new Date() }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? ''))) throw new Error('Email no válido para la licencia.');
  if (externalRef) {
    const existing = db.prepare('SELECT id FROM licenses WHERE source = ? AND external_ref = ?').get(source, externalRef);
    if (existing) return { duplicate: true, id: existing.id };
  }
  const key = generateLicenseKey();
  const res = db.prepare(`INSERT INTO licenses (key_hash, key_hint, email, plan, status, source, external_ref, created_at, expires_at, notes)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`)
    .run(hashLicenseKey(key, config.appSecret), key.slice(-5), email.toLowerCase(), plan, source, externalRef, now.toISOString(), expiresAt, notes);
  const id = Number(res.lastInsertRowid);
  if (sendEmail) {
    enqueueEmail(db, {
      kind: 'license',
      to: email,
      subject: 'Tu licencia de RemesaLista Pro',
      body: licenseEmail({ key, baseUrl: config.baseUrl, expiresAt }),
      dedupeKey: `license-${id}`,
      now,
    });
  }
  return { duplicate: false, id, key };
}

/**
 * @returns {{valid: boolean, plan?: string, expiresAt?: string|null, reason?: string}}
 */
export function verifyLicense(db, config, key, now = new Date()) {
  if (!key || normalizeLicenseKey(key).length !== 22) return { valid: false, reason: 'format' };
  const row = db.prepare('SELECT id, plan, status, expires_at FROM licenses WHERE key_hash = ?').get(hashLicenseKey(key, config.appSecret));
  if (!row) return { valid: false, reason: 'not_found' };
  if (row.status !== 'active') return { valid: false, reason: row.status };
  if (row.expires_at && row.expires_at <= now.toISOString()) return { valid: false, reason: 'expired' };
  return { valid: true, id: row.id, plan: row.plan, expiresAt: row.expires_at };
}

export function revokeLicenses(db, { source, externalRef, now = new Date() }) {
  return db.prepare(`UPDATE licenses SET status = 'revoked', revoked_at = ? WHERE source = ? AND external_ref = ? AND status = 'active'`)
    .run(now.toISOString(), source, externalRef).changes;
}
