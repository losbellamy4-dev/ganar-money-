// Validación completa de una remesa de adeudos SEPA antes de generar el XML.
// Se usa en el navegador (vista previa) y en el servidor (autoridad final).
import { validateIban, validateBic } from './iban.js';
import { validateCreditorId } from './creditor-id.js';
import { sepaText, sepaIdentifier } from './text.js';
import { parseAmount, parseDate, todayIso, addBusinessDays, isTargetBusinessDay, formatEuros } from './values.js';

export const SEQUENCE_TYPES = ['RCUR', 'FRST', 'OOFF', 'FNAL'];
export const SCHEMES = ['CORE', 'B2B'];
export const HARD_MAX_TRANSACTIONS = 5000;

const SEQUENCE_ALIASES = {
  RCUR: 'RCUR', RECURRENTE: 'RCUR', RECURRENT: 'RCUR',
  FRST: 'FRST', PRIMERO: 'FRST', PRIMERA: 'FRST', FIRST: 'FRST',
  OOFF: 'OOFF', UNICO: 'OOFF', UNICA: 'OOFF', PUNTUAL: 'OOFF', 'ONE-OFF': 'OOFF',
  FNAL: 'FNAL', ULTIMO: 'FNAL', ULTIMA: 'FNAL', FINAL: 'FNAL',
};

export function normalizeSequence(value) {
  const key = String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().trim();
  return SEQUENCE_ALIASES[key] ?? null;
}

/**
 * @param {object} input  Datos de la remesa (ver README, sección «Formato de entrada»).
 * @param {{today?: string, maxTransactions?: number, allowB2B?: boolean}} [options]
 */
export function validateRemittance(input, options = {}) {
  const today = options.today ?? todayIso();
  const maxTransactions = Math.min(options.maxTransactions ?? HARD_MAX_TRANSACTIONS, HARD_MAX_TRANSACTIONS);
  const errors = [];
  const warnings = [];
  const err = (line, field, code, message) => errors.push({ line, field, code, message });
  const warn = (line, field, code, message) => warnings.push({ line, field, code, message });
  let adaptedTexts = 0;

  const src = input && typeof input === 'object' ? input : {};
  const cred = src.creditor && typeof src.creditor === 'object' ? src.creditor : {};

  // --- Acreedor -----------------------------------------------------------
  const credName = sepaText(cred.name, 70);
  if (!credName.value) err(0, 'creditor.name', 'CREDITOR_NAME', 'Falta el nombre del acreedor (tu asociación o empresa).');
  if (credName.truncated) warn(0, 'creditor.name', 'TRUNCATED', 'El nombre del acreedor se ha recortado a 70 caracteres.');
  const credIban = validateIban(cred.iban);
  if (!credIban.valid) err(0, 'creditor.iban', credIban.code, `IBAN del acreedor: ${credIban.message}`);
  const credBic = validateBic(cred.bic);
  if (!credBic.valid) err(0, 'creditor.bic', credBic.code, `BIC del acreedor: ${credBic.message}`);
  const cid = validateCreditorId(cred.creditorId);
  if (!cid.valid) err(0, 'creditor.creditorId', cid.code, cid.message);
  else if (cid.warning) warn(0, 'creditor.creditorId', 'CID_NIF', cid.warning);

  // --- Datos de la remesa -------------------------------------------------
  const scheme = String(src.scheme ?? 'CORE').toUpperCase();
  if (!SCHEMES.includes(scheme)) err(0, 'scheme', 'SCHEME', 'El esquema debe ser CORE (particulares) o B2B (solo empresas).');
  else if (scheme === 'B2B' && options.allowB2B === false) err(0, 'scheme', 'PLAN_B2B', 'El esquema B2B está disponible en el plan Pro.');

  const defaultSequence = normalizeSequence(src.sequence ?? 'RCUR');
  if (!defaultSequence) err(0, 'sequence', 'SEQUENCE', 'El tipo de adeudo debe ser RCUR, FRST, OOFF o FNAL.');

  const collection = parseDate(src.collectionDate);
  let collectionDate = '';
  if (!collection.ok) {
    err(0, 'collectionDate', 'COLLECTION_DATE', `Fecha de cobro: ${collection.message}`);
  } else {
    collectionDate = collection.date;
    if (collectionDate <= today) {
      err(0, 'collectionDate', 'COLLECTION_DATE_PAST', 'La fecha de cobro debe ser posterior a hoy.');
    } else {
      const minRecommended = addBusinessDays(today, 2);
      if (collectionDate < minRecommended) {
        warn(0, 'collectionDate', 'COLLECTION_DATE_SOON', `Fecha de cobro muy próxima: muchos bancos piden presentar la remesa con al menos 2 días hábiles de antelación (a partir del ${minRecommended}).`);
      }
      if (!isTargetBusinessDay(collectionDate)) {
        warn(0, 'collectionDate', 'COLLECTION_DATE_HOLIDAY', 'La fecha de cobro no es día hábil bancario; el banco la moverá al siguiente día hábil.');
      }
      if (collectionDate > addBusinessDays(today, 250)) {
        warn(0, 'collectionDate', 'COLLECTION_DATE_FAR', 'La fecha de cobro está a más de un año vista; revisa que sea correcta.');
      }
    }
  }

  const defaultConcept = sepaText(src.concept, 140);

  // --- Recibos ------------------------------------------------------------
  const rows = Array.isArray(src.transactions) ? src.transactions : [];
  if (!rows.length) err(0, 'transactions', 'NO_TRANSACTIONS', 'No hay ningún recibo en la remesa.');
  if (rows.length > maxTransactions) {
    err(0, 'transactions', 'LIMIT_TRANSACTIONS', `Esta remesa tiene ${rows.length} recibos y el límite de tu plan es ${maxTransactions} por remesa.`);
  }

  const transactions = [];
  const seenKeys = new Map();
  const usedE2E = new Set();
  const yymmdd = collectionDate ? collectionDate.slice(2).replace(/-/g, '') : '000000';
  let totalCents = 0;

  rows.slice(0, HARD_MAX_TRANSACTIONS).forEach((raw, idx) => {
    const line = idx + 1;
    const r = raw && typeof raw === 'object' ? raw : {};
    const before = errors.length;

    const name = sepaText(r.name, 70);
    if (!name.value) err(line, 'name', 'NAME', 'Falta el nombre del titular de la cuenta.');
    else if (name.changed && !name.truncated) adaptedTexts++;
    if (name.truncated) warn(line, 'name', 'TRUNCATED', 'Nombre recortado a 70 caracteres.');

    const iban = validateIban(r.iban);
    if (!iban.valid) err(line, 'iban', iban.code, iban.message);
    else if (iban.iban === credIban.iban) warn(line, 'iban', 'IBAN_SAME_AS_CREDITOR', 'El IBAN es el mismo que el de la cuenta del acreedor.');

    const bic = validateBic(r.bic);
    if (!bic.valid) err(line, 'bic', bic.code, bic.message);

    const amount = parseAmount(r.amount);
    if (!amount.ok) err(line, 'amount', 'AMOUNT', amount.message);

    const mandate = sepaIdentifier(r.mandateId, 35);
    if (!mandate.value) {
      err(line, 'mandateId', 'MANDATE_ID', 'Falta la referencia del mandato (la que figura en la orden de domiciliación firmada).');
    } else if (mandate.changed) {
      warn(line, 'mandateId', 'MANDATE_ID_ADJUSTED', `Referencia de mandato adaptada al formato SEPA: «${String(r.mandateId).trim()}» → «${mandate.value}». Usa siempre la misma referencia en cada remesa.`);
    }

    const mDate = parseDate(r.mandateDate);
    if (!mDate.ok) err(line, 'mandateDate', 'MANDATE_DATE', `Fecha de firma del mandato: ${mDate.message}`);
    else if (mDate.date > today) err(line, 'mandateDate', 'MANDATE_DATE_FUTURE', 'La fecha de firma del mandato no puede ser futura.');

    let sequence = defaultSequence;
    if (r.sequence !== undefined && String(r.sequence).trim() !== '') {
      sequence = normalizeSequence(r.sequence);
      if (!sequence) err(line, 'sequence', 'SEQUENCE', `Tipo de adeudo «${r.sequence}» no válido (usa RCUR, FRST, OOFF o FNAL).`);
    }

    const concept = r.concept !== undefined && String(r.concept).trim() !== '' ? sepaText(r.concept, 140) : defaultConcept;
    if (concept.truncated) warn(line, 'concept', 'TRUNCATED', 'Concepto recortado a 140 caracteres.');
    if (!concept.value) warn(line, 'concept', 'CONCEPT_EMPTY', 'Recibo sin concepto: tu socio no sabrá qué se le cobra.');

    if (errors.length !== before) return;

    const key = `${iban.iban}|${amount.cents}|${mandate.value}`;
    if (seenKeys.has(key)) warn(line, 'iban', 'DUPLICATE', `Posible recibo duplicado: igual que la línea ${seenKeys.get(key)} (mismo IBAN, importe y mandato).`);
    else seenKeys.set(key, line);

    let e2e = `${mandate.value.slice(0, 26)}-${yymmdd}`.replace(/\/-/g, '-');
    for (let n = 2; usedE2E.has(e2e); n++) e2e = `${mandate.value.slice(0, 22)}-${yymmdd}-${n}`;
    usedE2E.add(e2e);

    totalCents += amount.cents;
    transactions.push({
      line,
      name: name.value,
      iban: iban.iban,
      bic: bic.bic,
      amountCents: amount.cents,
      mandateId: mandate.value,
      mandateDate: mDate.date,
      sequence,
      concept: concept.value,
      endToEndId: e2e,
    });
  });

  if (adaptedTexts > 0) {
    warn(0, 'transactions', 'TEXT_ADAPTED', `${adaptedTexts} nombre(s) se han adaptado al juego de caracteres SEPA (por ejemplo, «Muñoz» → «Munoz»). Es normal y no afecta al cobro.`);
  }
  for (const t of transactions) {
    if (collectionDate && t.mandateDate > collectionDate) {
      err(t.line, 'mandateDate', 'MANDATE_AFTER_COLLECTION', 'El mandato está firmado después de la fecha de cobro.');
    }
  }

  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings,
    summary: { count: transactions.length, totalCents, total: formatEuros(totalCents), rowsReceived: rows.length },
    remittance: ok
      ? {
        creditor: { name: credName.value, iban: credIban.iban, bic: credBic.bic, creditorId: cid.id },
        scheme,
        collectionDate,
        transactions,
        count: transactions.length,
        totalCents,
      }
      : null,
  };
}
