// Configuración a partir de variables de entorno. Ver .env.example y DEPLOYMENT.md.
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const int = (v, def) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : def;
};

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const dataDir = resolve(env.DATA_DIR ?? './data');
  // En desarrollo se genera un secreto efímero; en producción es obligatorio (lo comprueba preflight).
  const appSecret = env.APP_SECRET || (production ? '' : randomBytes(32).toString('hex'));
  return {
    production,
    port: int(env.PORT, 3000),
    host: env.HOST ?? '0.0.0.0',
    baseUrl: (env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    dataDir,
    dbPath: env.DB_PATH ?? join(dataDir, 'remesalista.sqlite'),
    backupDir: env.BACKUP_DIR ?? join(dataDir, 'backups'),
    backupRetentionDays: int(env.BACKUP_RETENTION_DAYS, 14),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    appSecret,

    // Planes. Los límites se aplican SIEMPRE en el servidor.
    freeMaxTransactions: int(env.FREE_MAX_TRANSACTIONS, 25),
    proMaxTransactions: int(env.PRO_MAX_TRANSACTIONS, 5000),
    freeGenerationsPerHour: int(env.FREE_GENERATIONS_PER_HOUR, 20),
    proGenerationsPerHour: int(env.PRO_GENERATIONS_PER_HOUR, 300),
    proPassDays: int(env.PRO_PASS_DAYS, 365),
    maxBodyBytes: int(env.MAX_BODY_BYTES, 3 * 1024 * 1024),

    // Pagos (Stripe Checkout / Payment Links + webhook). Sin estas variables, Pro no se vende.
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    checkoutUrl: env.CHECKOUT_URL ?? '',
    proPriceLabel: env.PRO_PRICE_LABEL ?? '',

    // Correo saliente.
    emailProvider: env.EMAIL_PROVIDER ?? 'log', // 'log' | 'resend'
    resendApiKey: env.RESEND_API_KEY ?? '',
    resendApiUrl: env.RESEND_API_URL ?? 'https://api.resend.com/emails',
    emailFrom: env.EMAIL_FROM ?? 'RemesaLista <no-responder@localhost>',
    adminEmail: env.ADMIN_EMAIL ?? '',
    supportEmail: env.SUPPORT_EMAIL ?? env.OWNER_EMAIL ?? '',

    // Datos del titular para el aviso legal (LSSI art. 10). Deben rellenarse antes de publicar.
    owner: {
      name: env.OWNER_NAME ?? '',
      taxId: env.OWNER_TAX_ID ?? '',
      address: env.OWNER_ADDRESS ?? '',
      email: env.OWNER_EMAIL ?? '',
    },

    healthToken: env.HEALTH_TOKEN ?? '',
    schedulerEnabled: env.SCHEDULER !== 'off',
    version: env.APP_VERSION ?? '0.1.0',
  };
}
