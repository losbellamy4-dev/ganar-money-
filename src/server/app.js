// Manejador HTTP sin framework. createApp() recibe sus dependencias para poder probarlo aislado.
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRemittance } from '../sepa/validate.js';
import { buildPain008, newMessageId } from '../sepa/xml.js';
import { todayIso } from '../sepa/values.js';
import { incrementUsage } from './db.js';
import { verifyLicense } from './licenses.js';
import { verifyStripeSignature, handleStripeEvent, recordWebhookFailure } from './stripe.js';
import { clientKey, hit } from './ratelimit.js';
import { outboxStats } from './outbox.js';
import * as logger from './log.js';
import { timingSafeEqual } from 'node:crypto';

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_DIR = join(ROOT, 'public');
const SEPA_DIR = join(ROOT, 'src', 'sepa');
// Módulos del núcleo que el navegador puede cargar. xml.js NO está: el XML solo se genera en el servidor.
const BROWSER_MODULES = new Set(['iban.js', 'creditor-id.js', 'text.js', 'values.js', 'table.js', 'validate.js']);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const TEMPLATED = new Set(['.html', '.xml', '.txt']);

// Eventos de embudo que el navegador puede contar (sin datos personales ni cookies).
const CLIENT_EVENTS = new Set(['visit_app', 'data_loaded', 'validate_ok', 'validate_errors', 'pro_click', 'limit_hit', 'calc_creditor_id', 'template_download']);
const INTEREST_FEATURES = new Set(['pro', 'transferencias', 'devoluciones', 'xlsx']);

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function securityHeaders(config) {
  const h = {
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  };
  if (config.production) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

export function createApp({ config, db, clock = () => new Date(), emailerInfo = 'log', scheduler = null }) {
  const templateCache = new Map();
  const headers = securityHeaders(config);

  const send = (res, status, body, extraHeaders = {}) => {
    res.writeHead(status, { ...headers, ...extraHeaders });
    res.end(body);
  };
  const json = (res, status, data, extraHeaders = {}) => send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });

  const clientIp = (req) => {
    if (config.trustProxy) {
      // La última IP de la lista es la que añadió nuestro proxy; las anteriores las puede inventar el cliente.
      const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',').map((x) => x.trim()).filter(Boolean).at(-1);
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const limit = (req, scope, max, windowSec = 3600) => {
    const r = hit(db, clientKey(config.appSecret, scope, clientIp(req), clock()), max, windowSec, clock());
    if (!r.allowed) throw new HttpError(429, 'Has hecho demasiadas peticiones seguidas. Espera un poco y vuelve a intentarlo.', { retryAfter: r.retryAfterSec });
    return r;
  };

  async function readBody(req, maxBytes) {
    const tooLarge = () => new HttpError(413, 'Los datos enviados son demasiado grandes.');
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > maxBytes * 4) {
      // Tamaño desproporcionado: respondemos y cerramos sin leerlo.
      req.on('error', () => {});
      throw Object.assign(tooLarge(), { closeConnection: true });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      // Por encima del límite seguimos leyendo para responder limpiamente, pero sin acumular en memoria.
      if (size <= maxBytes) chunks.push(chunk);
      else if (size > maxBytes * 4) throw Object.assign(tooLarge(), { closeConnection: true });
    }
    if (size > maxBytes) throw tooLarge();
    return Buffer.concat(chunks).toString('utf8');
  }

  async function readJson(req, maxBytes = config.maxBodyBytes) {
    if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'Se esperaba JSON.');
    const raw = await readBody(req, maxBytes);
    try {
      return JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'JSON mal formado.');
    }
  }

  const ownerValue = (v, label) => v || `[PENDIENTE: ${label}]`;
  function renderTemplate(text) {
    return text
      .replaceAll('{{BASE_URL}}', config.baseUrl)
      .replaceAll('{{OWNER_NAME}}', ownerValue(config.owner.name, 'nombre o razón social del titular'))
      .replaceAll('{{OWNER_TAX_ID}}', ownerValue(config.owner.taxId, 'NIF del titular'))
      .replaceAll('{{OWNER_ADDRESS}}', ownerValue(config.owner.address, 'domicilio del titular'))
      .replaceAll('{{OWNER_EMAIL}}', ownerValue(config.owner.email, 'email de contacto'))
      .replaceAll('{{SUPPORT_EMAIL}}', ownerValue(config.supportEmail, 'email de soporte'))
      .replaceAll('{{FREE_MAX}}', String(config.freeMaxTransactions))
      .replaceAll('{{YEAR}}', String(clock().getUTCFullYear()));
  }

  async function serveFile(res, file, { cache }) {
    const ext = extname(file);
    let body;
    if (TEMPLATED.has(ext)) {
      if (!templateCache.has(file) || !config.production) templateCache.set(file, renderTemplate(await readFile(file, 'utf8')));
      body = templateCache.get(file);
    } else {
      body = await readFile(file);
    }
    send(res, 200, body, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': cache });
  }

  async function serveStatic(req, res, pathname) {
    if (pathname.startsWith('/lib/sepa/')) {
      const name = pathname.slice('/lib/sepa/'.length);
      if (!BROWSER_MODULES.has(name)) throw new HttpError(404, 'No encontrado.');
      return serveFile(res, join(SEPA_DIR, name), { cache: 'public, max-age=300' });
    }
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, 'Ruta no válida.');
    }
    if (rel.includes('\0')) throw new HttpError(400, 'Ruta no válida.');
    if (rel.endsWith('/')) rel += 'index.html';
    if (!extname(rel)) rel += '.html';
    const file = normalize(join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + '/')) throw new HttpError(404, 'No encontrado.');
    try {
      await serveFile(res, file, { cache: extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'EISDIR') throw new HttpError(404, 'No encontrado.');
      throw e;
    }
  }

  function health() {
    const jobs = db.prepare('SELECT job, last_finished_at, last_status, last_error FROM job_runs').all();
    const outbox = outboxStats(db);
    const now = clock();
    const problems = [];
    if (scheduler) {
      const beat = scheduler.lastTick();
      if (!beat || now - beat > 5 * 60 * 1000) problems.push('scheduler_stalled');
    }
    if (jobs.some((j) => j.last_status === 'error')) problems.push('job_error');
    const stuck = db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending' AND next_attempt_at < ?`).get(new Date(now - 15 * 60 * 1000).toISOString()).n;
    if (stuck > 0) problems.push('outbox_backlog');
    if ((outbox.failed ?? 0) > 0) problems.push('outbox_failed');
    return {
      status: problems.length ? 'degraded' : 'ok',
      problems,
      version: config.version,
      emailProvider: emailerInfo,
      paymentsConfigured: Boolean(config.checkoutUrl && config.stripeWebhookSecret),
      outbox,
      jobs,
      time: now.toISOString(),
    };
  }

  async function generate(req, res) {
    const body = await readJson(req);
    let plan = 'free';
    let licenseId = null;
    if (body.licenseKey) {
      const lic = verifyLicense(db, config, body.licenseKey, clock());
      if (!lic.valid) {
        limit(req, 'lic', 30);
        const why = { revoked: 'ha sido revocada', expired: 'ha caducado' }[lic.reason] ?? 'no es válida';
        throw new HttpError(402, `La clave de licencia ${why}. Puedes seguir usando el plan gratuito (hasta ${config.freeMaxTransactions} recibos por remesa) quitando la clave.`, { code: 'LICENSE_INVALID' });
      }
      plan = lic.plan;
      licenseId = lic.id;
    }
    const pro = plan === 'pro';
    if (pro) {
      const r = hit(db, `lic:${licenseId}`, config.proGenerationsPerHour, 3600, clock());
      if (!r.allowed) throw new HttpError(429, 'Has alcanzado el límite horario de generación. Vuelve a intentarlo en un rato.', { retryAfter: r.retryAfterSec });
    } else {
      limit(req, 'gen', config.freeGenerationsPerHour);
    }

    const version = body.version === '08' ? '08' : '02';
    const today = todayIso(clock());
    const result = validateRemittance(body.remittance, {
      today,
      maxTransactions: pro ? config.proMaxTransactions : config.freeMaxTransactions,
      allowB2B: pro,
    });
    const day = today;
    if (!result.ok) {
      const limitHit = result.errors.some((e) => e.code === 'LIMIT_TRANSACTIONS' || e.code === 'PLAN_B2B');
      incrementUsage(db, { day, event: limitHit ? 'generate_blocked_plan' : 'generate_invalid', plan });
      return json(res, 422, { ok: false, errors: result.errors, warnings: result.warnings, summary: result.summary, plan });
    }
    const messageId = newMessageId(clock());
    const xml = buildPain008(result.remittance, { version, messageId, createdAt: clock() });
    incrementUsage(db, { day, event: 'generate_ok', plan, count: 1, amount: result.remittance.count });
    logger.info('remittance_generated', { plan, version, transactions: result.remittance.count });
    return json(res, 200, {
      ok: true,
      plan,
      version,
      messageId,
      filename: `remesa-${result.remittance.collectionDate}-${messageId.slice(-8)}.xml`,
      xml,
      summary: result.summary,
      warnings: result.warnings,
    });
  }

  async function stripeWebhook(req, res) {
    const raw = await readBody(req, 1024 * 1024);
    const check = verifyStripeSignature(raw, req.headers['stripe-signature'], config.stripeWebhookSecret, { now: clock().getTime() });
    if (!check.ok) {
      logger.warn('stripe_webhook_rejected', { reason: check.reason });
      throw new HttpError(check.reason === 'not_configured' ? 503 : 400, 'Firma no válida.');
    }
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'JSON mal formado.');
    }
    try {
      const r = handleStripeEvent(db, config, event, clock());
      logger.info('stripe_webhook', { id: event.id, type: event.type, ...r });
      if (r.action === 'license_issued') scheduler?.kick('send-emails');
      return json(res, 200, { received: true, ...r });
    } catch (e) {
      recordWebhookFailure(db, config, event, e, clock());
      logger.alert('stripe_webhook_failed', { id: event.id, type: event.type, error: e.message });
      // 500 => Stripe reintenta con espera exponencial durante varios días.
      throw new HttpError(500, 'Error al procesar el evento.');
    }
  }

  const routes = {
    // 200 mientras el proceso y la base de datos respondan (para no provocar reinicios en bucle por un
    // correo fallido); los problemas que requieren atención humana van en `status`/`problems`.
    // El detalle (trabajos, cola de correo) solo se muestra con HEALTH_TOKEN.
    'GET /healthz': (req, res) => {
      const h = health();
      const auth = String(req.headers.authorization ?? '');
      const detailed = config.healthToken && safeEqual(auth, `Bearer ${config.healthToken}`);
      return json(res, 200, detailed ? h : { status: h.status, problems: h.problems, version: h.version, time: h.time });
    },
    'GET /api/config': (req, res) => json(res, 200, {
      freeMaxTransactions: config.freeMaxTransactions,
      proMaxTransactions: config.proMaxTransactions,
      proAvailable: Boolean(config.checkoutUrl && config.stripeWebhookSecret),
      checkoutUrl: config.checkoutUrl && config.stripeWebhookSecret ? config.checkoutUrl : null,
      proPriceLabel: config.proPriceLabel || null,
      today: todayIso(clock()),
    }),
    'POST /api/generate': generate,
    'POST /api/license/verify': async (req, res) => {
      limit(req, 'lic', 30);
      const body = await readJson(req, 4096);
      const lic = verifyLicense(db, config, body.key, clock());
      return json(res, 200, lic.valid ? { valid: true, plan: lic.plan, expiresAt: lic.expiresAt } : { valid: false, reason: lic.reason });
    },
    'POST /api/event': async (req, res) => {
      limit(req, 'evt', 120);
      const body = await readJson(req, 1024);
      if (!CLIENT_EVENTS.has(body.name)) throw new HttpError(400, 'Evento desconocido.');
      incrementUsage(db, { day: todayIso(clock()), event: `client_${body.name}` });
      return json(res, 200, { ok: true });
    },
    'POST /api/interest': async (req, res) => {
      limit(req, 'int', 10);
      const body = await readJson(req, 4096);
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(email)) throw new HttpError(400, 'Escribe un email válido.');
      if (body.consent !== true) throw new HttpError(400, 'Necesitamos tu consentimiento para guardar el email.');
      const feature = INTEREST_FEATURES.has(body.feature) ? body.feature : 'pro';
      const clean = (v) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || null;
      const now = clock().toISOString();
      const r = db.prepare(`INSERT INTO interest (email, feature, org_type, bank, consent_at, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (email, feature) DO NOTHING`).run(email, feature, clean(body.orgType), clean(body.bank), now, now);
      if (r.changes) incrementUsage(db, { day: todayIso(clock()), event: `interest_${feature}` });
      return json(res, 200, { ok: true });
    },
    'POST /api/webhooks/stripe': stripeWebhook,
  };

  return async function handler(req, res) {
    const started = Date.now();
    let pathname = '/';
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      pathname = url.pathname;
      const route = routes[`${req.method} ${pathname}`];
      if (route) await route(req, res);
      else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, pathname);
      else if (pathname.startsWith('/api/')) throw new HttpError(404, 'Ruta no encontrada.');
      else throw new HttpError(405, 'Método no permitido.');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) logger.error('request_failed', { path: pathname, error: e.message, stack: e.stack?.split('\n').slice(0, 3).join(' | ') });
      if (res.headersSent) return res.end();
      const extra = e.extra?.retryAfter ? { 'Retry-After': String(e.extra.retryAfter) } : {};
      if (e.closeConnection) {
        extra.Connection = 'close';
        res.on('finish', () => req.destroy());
      }
      if (status === 404 && !pathname.startsWith('/api/') && req.method === 'GET') {
        try {
          const page = renderTemplate(await readFile(join(PUBLIC_DIR, '404.html'), 'utf8'));
          return send(res, 404, page, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        } catch { /* sin página 404: JSON */ }
      }
      json(res, status, { ok: false, error: status === 500 ? 'Error interno. Vuelve a intentarlo; si persiste, escríbenos.' : e.message, code: e.extra?.code }, extra);
    } finally {
      if (pathname.startsWith('/api/') || pathname === '/healthz') {
        logger.info('http', { method: req.method, path: pathname, status: res.statusCode, ms: Date.now() - started });
      }
    }
  };
}
