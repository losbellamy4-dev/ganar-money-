#!/usr/bin/env node
// Administración de licencias desde la línea de comandos (no hay panel web de administración: menos superficie de ataque).
//   npm run license -- issue --email cliente@ejemplo.es [--days 365] [--note "pago por transferencia"] [--no-email]
//   npm run license -- list
//   npm run license -- revoke --id 3
//   npm run license -- verify --key RL-XXXXX-XXXXX-XXXXX-XXXXX
//   npm run license -- interest-list                 (lista de espera, con fecha de consentimiento)
//   npm run license -- interest-delete --email x@y.es (derecho de supresión RGPD)
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/server/config.js';
import { openDatabase, transaction } from '../src/server/db.js';
import { issueLicense, verifyLicense } from '../src/server/licenses.js';

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    email: { type: 'string' }, days: { type: 'string' }, note: { type: 'string' },
    id: { type: 'string' }, key: { type: 'string' }, 'no-email': { type: 'boolean' },
  },
});

const config = loadConfig();
if (!process.env.APP_SECRET) {
  console.error('Falta APP_SECRET: sin él las claves no se pueden verificar después. Defínelo igual que en el servidor.');
  process.exit(1);
}
const db = openDatabase(config.dbPath);

try {
  if (command === 'issue') {
    const days = values.days ? Number(values.days) : null;
    const expiresAt = days ? new Date(Date.now() + days * 86400e3).toISOString() : null;
    const res = transaction(db, () => issueLicense(db, config, {
      email: values.email, source: 'manual', notes: values.note ?? null, expiresAt, sendEmail: !values['no-email'],
    }));
    console.log(`Licencia #${res.id} creada${expiresAt ? ` (caduca ${expiresAt.slice(0, 10)})` : ''}.`);
    console.log(`Clave: ${res.key}`);
    console.log(values['no-email'] ? 'No se ha enviado correo: entrega la clave por un canal seguro.' : 'Correo encolado; lo enviará el planificador.');
  } else if (command === 'list') {
    const rows = db.prepare('SELECT id, key_hint, email, plan, status, source, created_at, expires_at FROM licenses ORDER BY id DESC LIMIT 100').all();
    console.table(rows);
  } else if (command === 'revoke') {
    const n = db.prepare(`UPDATE licenses SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'`).run(new Date().toISOString(), Number(values.id)).changes;
    console.log(n ? `Licencia #${values.id} revocada.` : 'No había ninguna licencia activa con ese id.');
  } else if (command === 'verify') {
    console.log(verifyLicense(db, config, values.key));
  } else if (command === 'interest-list') {
    console.table(db.prepare('SELECT email, feature, org_type, bank, consent_at FROM interest ORDER BY created_at').all());
  } else if (command === 'interest-delete') {
    const n = db.prepare('DELETE FROM interest WHERE email = ?').run(String(values.email ?? '').trim().toLowerCase()).changes;
    console.log(n ? `Eliminados ${n} registro(s) de la lista de espera.` : 'No había registros con ese email.');
  } else {
    console.log('Comandos: issue | list | revoke | verify | interest-list | interest-delete (ver cabecera de scripts/license.js)');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
