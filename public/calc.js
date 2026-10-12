// Calculadora y validador del identificador de acreedor SEPA (AT-02). Todo se calcula en el navegador.
import { computeCreditorId, validateCreditorId, validateSpanishTaxId, normalizeCreditorId } from '/lib/sepa/creditor-id.js';

const $ = (id) => document.getElementById(id);
let tracked = false;

function show(el, kind, html) {
  el.className = `notice ${kind}`;
  el.innerHTML = html;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

$('calc-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const out = $('calc-result');
  const nif = normalizeCreditorId($('calc-nif').value);
  const suffix = normalizeCreditorId($('calc-suffix').value || '000');
  if (!nif) return show(out, 'error', 'Escribe el NIF o CIF de la entidad que cobra.');
  try {
    const id = computeCreditorId({ nationalId: nif, suffix });
    const check = validateSpanishTaxId(nif);
    show(out, 'success', `<p>Identificador de acreedor:</p><p class="result-box">${esc(id)}</p>
      ${check.valid ? '' : `<p><strong>Atención:</strong> ${esc(nif)} no parece un NIF/CIF válido (${esc(check.message)}). Revisa que esté bien escrito.</p>`}
      <p>Confirma siempre con tu banco el sufijo asignado: el identificador definitivo es el que figura en tu contrato de adeudos.</p>`);
    if (!tracked) {
      tracked = true;
      fetch('/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'calc_creditor_id' }), keepalive: true }).catch(() => {});
    }
  } catch (e) {
    show(out, 'error', esc(e.message));
  }
});

$('check-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const out = $('check-result');
  const r = validateCreditorId($('check-id').value);
  if (r.valid) {
    show(out, 'success', `<p><strong>${esc(r.id)}</strong> es un identificador correcto (país ${esc(r.country)}, sufijo ${esc(r.suffix)}, identificador nacional ${esc(r.nationalId)}).</p>${r.warning ? `<p>${esc(r.warning)}</p>` : ''}`);
  } else {
    let hint = '';
    if (r.code === 'CID_CHECKSUM') {
      try {
        const fixed = computeCreditorId({ country: r.id.slice(0, 2), suffix: r.id.slice(4, 7), nationalId: r.id.slice(7) });
        hint = `<p>Con ese sufijo y NIF, el identificador correcto sería <span class="mono">${esc(fixed)}</span>.</p>`;
      } catch { /* sin sugerencia */ }
    }
    show(out, 'error', `<p>${esc(r.message)}</p>${hint}`);
  }
});
