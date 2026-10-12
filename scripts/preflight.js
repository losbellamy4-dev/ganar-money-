#!/usr/bin/env node
// Comprueba que la configuración de producción está completa ANTES de publicar.
// Sale con código 1 si falta algo obligatorio. Uso: NODE_ENV=production npm run preflight
import { accessSync, constants, mkdirSync } from 'node:fs';
import { loadConfig } from '../src/server/config.js';

const config = loadConfig();
const checks = [];
const add = (level, ok, label, help) => checks.push({ level, ok, label, help });

add('required', process.env.NODE_ENV === 'production', 'NODE_ENV=production', 'Activa cabeceras HSTS y exige secretos.');
add('required', (process.env.APP_SECRET ?? '').length >= 32, 'APP_SECRET (≥32 caracteres aleatorios)', 'Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))". No lo cambies después: invalidaría las licencias.');
add('required', config.baseUrl.startsWith('https://'), 'BASE_URL con https://', 'URL pública definitiva (dominio propio).');
add('required', Boolean(config.owner.name && config.owner.taxId && config.owner.address && config.owner.email), 'Datos del titular (OWNER_NAME, OWNER_TAX_ID, OWNER_ADDRESS, OWNER_EMAIL)', 'Obligatorios en el aviso legal (LSSI art. 10). Requiere decisión humana.');
add('required', config.emailProvider === 'resend' && Boolean(config.resendApiKey), 'Correo real configurado (EMAIL_PROVIDER=resend, RESEND_API_KEY)', 'Con EMAIL_PROVIDER=log los correos solo se registran: las licencias no llegarían a los clientes.');
add('required', /@/.test(config.emailFrom) && !config.emailFrom.includes('localhost'), 'EMAIL_FROM con dominio verificado', 'Ejemplo: "RemesaLista <hola@tudominio.es>".');
add('required', Boolean(config.adminEmail), 'ADMIN_EMAIL', 'Destino de alertas e informes diarios.');
add('recommended', config.trustProxy, 'TRUST_PROXY=1 si hay proxy inverso', 'Sin esto, el límite por IP vería la IP del proxy.');
const paymentsPartial = Boolean(config.checkoutUrl) !== Boolean(config.stripeWebhookSecret);
add('required', !paymentsPartial, 'Pagos: CHECKOUT_URL y STRIPE_WEBHOOK_SECRET juntos (o ninguno)', 'Vender sin webhook dejaría a clientes sin licencia.');
add('recommended', Boolean(config.checkoutUrl && config.stripeWebhookSecret), 'Pagos configurados', 'Sin ellos el plan Pro se muestra como «próximamente» (lista de espera).');
add('recommended', !config.checkoutUrl || Boolean(config.proPriceLabel), 'PRO_PRICE_LABEL (precio visible con IVA)', 'Obligatorio mostrar el precio final antes de la compra.');
let writable = true;
try {
  mkdirSync(config.dataDir, { recursive: true });
  accessSync(config.dataDir, constants.W_OK);
} catch {
  writable = false;
}
add('required', writable, `DATA_DIR escribible (${config.dataDir})`, 'Debe ser un volumen persistente: ahí viven la base de datos y las copias.');

let failed = 0;
for (const c of checks) {
  const mark = c.ok ? 'OK  ' : c.level === 'required' ? 'FALLA' : 'AVISO';
  if (!c.ok && c.level === 'required') failed++;
  console.log(`[${mark}] ${c.label}${c.ok ? '' : `\n        → ${c.help}`}`);
}
console.log(failed ? `\n${failed} comprobación(es) obligatoria(s) fallan: NO publicar todavía.` : '\nConfiguración de producción completa.');
process.exitCode = failed ? 1 : 0;
