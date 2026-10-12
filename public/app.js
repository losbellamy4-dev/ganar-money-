// Interfaz de RemesaLista. La validación se hace aquí (vista previa inmediata) con el mismo código que usa
// el servidor; el XML lo genera siempre el servidor, que es quien aplica los límites del plan.
import { tableToRecords } from '/lib/sepa/table.js';
import { validateRemittance } from '/lib/sepa/validate.js';
import { formatEuros, addBusinessDays, addDays, todayIso } from '/lib/sepa/values.js';
import { formatIban } from '/lib/sepa/iban.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* almacenamiento no disponible */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  config: { freeMaxTransactions: 25, proMaxTransactions: 5000, proAvailable: false, checkoutUrl: null, proPriceLabel: null, today: todayIso() },
  license: null,
  table: { records: [], hasHeader: false, firstDataLine: 1 },
  lastResult: null,
};

const sent = new Set();
function track(name, once = true) {
  if (once && sent.has(name)) return;
  sent.add(name);
  fetch('/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }), keepalive: true }).catch(() => {});
}

const CREDITOR_FIELDS = ['cred-name', 'cred-iban', 'cred-id', 'cred-bic', 'opt-sequence', 'opt-scheme', 'opt-version', 'concept'];

function isPro() {
  return state.license?.plan === 'pro';
}

function buildInput() {
  return {
    creditor: { name: $('cred-name').value, iban: $('cred-iban').value, bic: $('cred-bic').value, creditorId: $('cred-id').value },
    collectionDate: $('collection-date').value,
    scheme: $('opt-scheme').value,
    sequence: $('opt-sequence').value,
    concept: $('concept').value,
    transactions: state.table.records,
  };
}

function sheetLine(line) {
  return line + state.table.firstDataLine - 1;
}

const FIELD_LABELS = {
  name: 'Nombre', iban: 'IBAN', bic: 'BIC', amount: 'Importe', mandateId: 'Mandato', mandateDate: 'Fecha firma', concept: 'Concepto', sequence: 'Tipo',
};

function renderIssues(list, kind) {
  const global = list.filter((e) => e.line === 0);
  const rows = list.filter((e) => e.line > 0);
  const items = [
    ...global.map((e) => `<li>${esc(e.message)}</li>`),
    ...rows.slice(0, 50).map((e) => `<li><strong>Fila ${sheetLine(e.line)}${FIELD_LABELS[e.field] ? ` · ${FIELD_LABELS[e.field]}` : ''}:</strong> ${esc(e.message)}</li>`),
  ];
  if (rows.length > 50) items.push(`<li>… y ${rows.length - 50} más.</li>`);
  return items.join('');
}

function renderTable(result) {
  const recs = state.table.records;
  if (!recs.length) return '';
  const errorsByLine = new Map();
  for (const e of result.errors) if (e.line > 0) errorsByLine.set(e.line, [...(errorsByLine.get(e.line) ?? []), e]);
  const shown = recs.slice(0, 200);
  const body = shown.map((r, i) => {
    const line = i + 1;
    const errs = errorsByLine.get(line);
    const ok = result.remittance?.transactions[i] ?? null;
    return `<tr class="${errs ? 'row-error' : ''}">
      <td>${sheetLine(line)}</td>
      <td>${esc(r.name)}</td>
      <td class="mono">${esc(r.iban ? formatIban(r.iban) : '')}</td>
      <td class="num">${esc(r.amount)}</td>
      <td>${esc(r.mandateId)}</td>
      <td>${esc(r.mandateDate)}</td>
      <td>${esc(r.sequence || ok?.sequence || '')}</td>
      <td>${errs ? `<span class="err">${errs.map((e) => esc(FIELD_LABELS[e.field] ?? e.field)).join(', ')}</span>` : 'Correcto'}</td>
    </tr>`;
  }).join('');
  const more = recs.length > shown.length ? `<p class="hint">Se muestran las primeras ${shown.length} filas de ${recs.length}.</p>` : '';
  return `<div class="table-wrap"><table><caption class="visually-hidden">Vista previa de los recibos</caption>
    <thead><tr><th scope="col">Fila</th><th scope="col">Nombre</th><th scope="col">IBAN</th><th scope="col">Importe</th><th scope="col">Mandato</th><th scope="col">Fecha firma</th><th scope="col">Tipo</th><th scope="col">Estado</th></tr></thead>
    <tbody>${body}</tbody></table></div>${more}`;
}

function markCreditorFields(errors) {
  const map = { 'creditor.name': 'cred-name', 'creditor.iban': 'cred-iban', 'creditor.creditorId': 'cred-id', 'creditor.bic': 'cred-bic', collectionDate: 'collection-date' };
  for (const id of Object.values(map)) $(id).removeAttribute('aria-invalid');
  for (const e of errors) if (map[e.field] && ($(map[e.field]).value || e.field === 'collectionDate')) $(map[e.field]).setAttribute('aria-invalid', 'true');
}

function validateNow() {
  const text = $('rows').value;
  state.table = tableToRecords(text);
  if (state.table.records.length) track('data_loaded');
  const maxTransactions = isPro() ? state.config.proMaxTransactions : state.config.freeMaxTransactions;
  const result = validateRemittance(buildInput(), { today: state.config.today, maxTransactions, allowB2B: isPro() });
  state.lastResult = result;
  markCreditorFields(result.errors);

  const status = $('status');
  if (!state.table.records.length) {
    status.innerHTML = '<p class="hint">Pega o sube los recibos en el paso 2 para ver aquí el resumen.</p>';
    $('preview').innerHTML = '';
    $('generate').disabled = true;
    $('generate-note').textContent = '';
    return;
  }
  const limitHit = result.errors.some((e) => e.code === 'LIMIT_TRANSACTIONS');
  if (limitHit) track('limit_hit');
  let html = `<div class="summary-bar"><span>Recibos: <strong>${Number(result.summary.rowsReceived)}</strong></span><span>Total: <strong>${esc(formatEuros(result.summary.totalCents))}</strong>${result.summary.count !== result.summary.rowsReceived ? ' <small>(solo filas correctas)</small>' : ''}</span>${state.table.hasHeader ? '<span><small>Fila de títulos detectada</small></span>' : ''}</div>`;
  if (limitHit && !isPro()) {
    html += `<div class="notice warning" role="alert"><h3>Esta remesa supera el plan gratuito</h3><p>El plan gratuito admite hasta ${Number(state.config.freeMaxTransactions)} recibos por remesa y esta tiene ${Number(result.summary.rowsReceived)}. Puedes dividirla en varias remesas o <a href="#planes">usar el plan Pro</a>.</p></div>`;
  }
  const otherErrors = result.errors.filter((e) => e.code !== 'LIMIT_TRANSACTIONS');
  if (otherErrors.length) {
    html += `<div class="notice error" role="alert"><h3>Hay ${otherErrors.length} error(es) que corregir antes de generar el fichero</h3><ul>${renderIssues(otherErrors)}</ul></div>`;
    track('validate_errors');
  } else if (result.ok) {
    html += '<div class="notice success"><h3>Todo correcto</h3><p>Puedes generar el fichero.</p></div>';
    track('validate_ok');
  }
  if (result.warnings.length) {
    html += `<details class="notice warning"><summary>${result.warnings.length} aviso(s) (no impiden generar el fichero)</summary><ul>${renderIssues(result.warnings)}</ul></details>`;
  }
  status.innerHTML = html;
  $('preview').innerHTML = renderTable(result);
  $('generate').disabled = !result.ok;
  $('generate-note').textContent = result.ok ? '' : 'Corrige los errores para continuar.';
}

let timer = null;
function scheduleValidate() {
  clearTimeout(timer);
  timer = setTimeout(validateNow, 250);
  $('result').innerHTML = '';
}

function downloadXml(filename, xml) {
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  return url;
}

async function generate() {
  const btn = $('generate');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Generando…';
  const out = $('result');
  out.innerHTML = '';
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remittance: buildInput(), version: $('opt-version').value, licenseKey: isPro() ? store.get('rl-license') : undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      const url = downloadXml(data.filename, data.xml);
      out.innerHTML = `<div class="notice success" role="status"><h3>Fichero generado: ${esc(data.filename)}</h3>
        <p>${esc(data.summary.count)} recibos por un total de ${esc(data.summary.total)}. Si la descarga no ha empezado, <a href="${url}" download="${esc(data.filename)}">descárgalo aquí</a>.</p>
        <p><strong>Siguiente paso:</strong> entra en la banca online de tu banco, busca el apartado de remesas, recibos, adeudos o envío de ficheros y sube este XML. Comprueba que el número de recibos y el importe total coinciden.</p></div>`;
    } else if (res.status === 422) {
      out.innerHTML = `<div class="notice error" role="alert"><h3>El servidor ha encontrado errores</h3><ul>${renderIssues(data.errors ?? [])}</ul></div>`;
    } else {
      out.innerHTML = `<div class="notice error" role="alert">${esc(data.error ?? `Error ${res.status}. Vuelve a intentarlo.`)}</div>`;
      if (res.status === 402) setLicense(null);
    }
  } catch {
    out.innerHTML = '<div class="notice error" role="alert">No se ha podido conectar con el servidor. Comprueba tu conexión y vuelve a intentarlo.</div>';
  } finally {
    btn.textContent = label;
    btn.disabled = !state.lastResult?.ok;
  }
}

async function readFileText(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Excel en Windows guarda los CSV en ANSI (Windows-1252): sin esto, «Muñoz» llegaría como «Mu�oz».
    return new TextDecoder('windows-1252').decode(buf);
  }
}

// --- Datos del acreedor guardados (solo en este navegador y solo si el usuario lo pide) -------------
function saveCreditor() {
  if (!$('remember').checked) return;
  store.set('rl-creditor', JSON.stringify(Object.fromEntries(CREDITOR_FIELDS.map((id) => [id, $(id).value]))));
}
function restoreCreditor() {
  const raw = store.get('rl-creditor');
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    for (const id of CREDITOR_FIELDS) if (typeof data[id] === 'string' && $(id)) $(id).value = data[id];
    $('remember').checked = true;
  } catch { store.del('rl-creditor'); }
}

// --- Licencia -------------------------------------------------------------------------------------------
function setLicense(lic, key) {
  state.license = lic;
  const status = $('license-status');
  if (lic) {
    store.set('rl-license', key);
    status.innerHTML = `<div class="notice success">Licencia Pro activa${lic.expiresAt ? ` hasta el ${esc(lic.expiresAt.slice(0, 10).split('-').reverse().join('/'))}` : ''}.</div>`;
    $('license-remove').hidden = false;
  } else {
    store.del('rl-license');
    $('license-remove').hidden = true;
  }
  scheduleValidate();
}

async function checkLicense(key, { silent = false } = {}) {
  const status = $('license-status');
  if (!key) return;
  try {
    const res = await fetch('/api/license/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    const data = await res.json();
    if (data.valid) setLicense({ plan: data.plan, expiresAt: data.expiresAt }, key);
    else {
      setLicense(null);
      if (!silent || data.reason !== 'not_found') {
        const why = { revoked: 'Esta licencia ha sido cancelada.', expired: 'Esta licencia ha caducado.', format: 'La clave no tiene el formato correcto (RL-XXXXX-XXXXX-XXXXX-XXXXX).' }[data.reason] ?? (data.error ?? 'No encontramos esa clave. Revisa que esté bien copiada.');
        status.innerHTML = `<div class="notice error">${esc(why)}</div>`;
      }
    }
  } catch {
    if (!silent) status.innerHTML = '<div class="notice error">No se ha podido comprobar la licencia. Inténtalo de nuevo.</div>';
  }
}

function setupPlans() {
  const c = state.config;
  if (c.proAvailable && c.checkoutUrl) {
    $('pro-price').textContent = c.proPriceLabel ?? 'Ver precio';
    const a = document.createElement('a');
    a.className = 'btn primary';
    a.href = c.checkoutUrl;
    a.rel = 'noopener';
    a.textContent = 'Contratar Pro';
    a.addEventListener('click', () => track('pro_click', false));
    $('pro-buy').append(a);
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Pago seguro con Stripe. Recibirás la clave por correo en unos minutos.';
    $('pro-buy').append(p);
  } else {
    $('pro-price').textContent = 'Próximamente';
    $('waitlist').hidden = false;
    const b = document.createElement('a');
    b.className = 'btn primary';
    b.href = '#waitlist';
    b.textContent = 'Quiero Pro: avisadme';
    b.addEventListener('click', () => track('pro_click', false));
    $('pro-buy').append(b);
  }
}

async function submitWaitlist(ev) {
  ev.preventDefault();
  const status = $('waitlist-status');
  const email = $('wl-email').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    status.innerHTML = '<div class="notice error">Escribe un email válido.</div>';
    $('wl-email').setAttribute('aria-invalid', 'true');
    $('wl-email').focus();
    return;
  }
  $('wl-email').removeAttribute('aria-invalid');
  if (!$('wl-consent').checked) {
    status.innerHTML = '<div class="notice error">Marca la casilla de consentimiento para poder guardar tu email.</div>';
    return;
  }
  try {
    const res = await fetch('/api/interest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, orgType: $('wl-org').value, bank: $('wl-bank').value, consent: true, feature: 'pro' }) });
    const data = await res.json();
    status.innerHTML = res.ok ? '<div class="notice success">¡Apuntado! Te escribiremos solo para avisarte de Pro.</div>' : `<div class="notice error">${esc(data.error)}</div>`;
    if (res.ok) $('waitlist-form').reset();
  } catch {
    status.innerHTML = '<div class="notice error">No se ha podido enviar. Inténtalo de nuevo.</div>';
  }
}

const EXAMPLE_ROWS = [
  'Nombre\tIBAN\tImporte\tReferencia mandato\tFecha firma\tConcepto',
  'Ana López Martín (EJEMPLO)\tES91 2100 0418 4502 0005 1332\t25,00\tSOCIO-001\t15/01/2024\t',
  'José Muñoz Peña (EJEMPLO)\tES70 0049 1500 0105 1234 5678\t25,00\tSOCIO-002\t03/02/2024\t',
  'Lucía Fernández (EJEMPLO)\tES80 0182 2370 4402 0123 4567\t40,00\tSOCIO-003\t20/09/2025\tCuota familiar octubre',
  'Pedro Sanz Gil (EJEMPLO)\tES34 2038 1234 6660 0012 3456\t25,00\tSOCIO-004\t11/03/2025\t',
].join('\n');

async function init() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) state.config = { ...state.config, ...(await res.json()) };
  } catch { /* se usan los valores por defecto */ }

  const today = state.config.today;
  $('collection-date').min = addDays(today, 1);
  $('collection-date').value = addBusinessDays(today, 3);
  restoreCreditor();
  setupPlans();

  for (const id of [...CREDITOR_FIELDS, 'collection-date', 'rows']) {
    $(id).addEventListener('input', () => { scheduleValidate(); saveCreditor(); });
    $(id).addEventListener('change', () => { scheduleValidate(); saveCreditor(); });
  }
  $('remember').addEventListener('change', () => ($('remember').checked ? saveCreditor() : store.del('rl-creditor')));
  $('csv-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      $('status').innerHTML = '<div class="notice error">El fichero es demasiado grande (máximo 2 MB).</div>';
      return;
    }
    $('rows').value = await readFileText(file);
    ev.target.value = '';
    scheduleValidate();
  });
  $('template-link').addEventListener('click', () => track('template_download'));
  $('load-example').addEventListener('click', () => {
    if (!$('cred-name').value) $('cred-name').value = 'Club Deportivo Ejemplo';
    if (!$('cred-iban').value) $('cred-iban').value = 'ES14 3058 0990 2627 1234 5678';
    if (!$('cred-id').value) $('cred-id').value = 'ES37000G12345674';
    if (!$('concept').value) $('concept').value = 'Cuota de socio';
    $('rows').value = EXAMPLE_ROWS;
    $('result').innerHTML = '<div class="notice info">Datos de ejemplo ficticios: sustitúyelos por los tuyos antes de enviar nada al banco.</div>';
    validateNow();
  });
  $('clear-rows').addEventListener('click', () => {
    $('rows').value = '';
    scheduleValidate();
  });
  $('generate').addEventListener('click', generate);
  $('license-check').addEventListener('click', () => checkLicense($('license-key').value.trim()));
  $('license-remove').addEventListener('click', () => {
    $('license-key').value = '';
    $('license-status').innerHTML = '';
    setLicense(null);
  });
  $('waitlist-form').addEventListener('submit', submitWaitlist);

  const savedKey = store.get('rl-license');
  if (savedKey) {
    $('license-key').value = savedKey;
    checkLicense(savedKey, { silent: true });
  }
  track('visit_app');
  validateNow();
}

init();
