// Lectura de datos pegados desde Excel/Google Sheets (tabuladores) o de un CSV (; o ,).

/**
 * Detecta el delimitador mirando la primera línea no vacía (fuera de comillas).
 */
export function detectDelimiter(text) {
  const firstLine = String(text).split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const counts = { '\t': 0, ';': 0, ',': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  if (counts['\t'] > 0) return '\t';
  if (counts[';'] > 0) return ';';
  if (counts[','] > 0) return ',';
  return '\t';
}

/**
 * Parser CSV (RFC 4180) tolerante: comillas dobles, saltos de línea dentro de comillas, BOM.
 * @returns {string[][]}
 */
export function parseDelimited(text, delimiter = detectDelimiter(text)) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

// Sinónimos de cabecera → campo interno. Se comparan sin tildes, en minúsculas y sin signos.
const HEADER_SYNONYMS = {
  name: ['nombre', 'titular', 'deudor', 'socio', 'cliente', 'nombre titular', 'nombre y apellidos', 'apellidos y nombre', 'pagador', 'name', 'debtor'],
  iban: ['iban', 'cuenta', 'cuenta bancaria', 'numero de cuenta', 'iban deudor', 'cuenta iban', 'account'],
  bic: ['bic', 'swift', 'bic swift', 'codigo bic'],
  amount: ['importe', 'cantidad', 'cuota', 'euros', 'importe eur', 'total', 'amount', 'importe euros'],
  mandateId: ['referencia mandato', 'mandato', 'ref mandato', 'id mandato', 'referencia del mandato', 'referencia unica del mandato', 'mandate', 'mandate id', 'referencia'],
  mandateDate: ['fecha firma', 'fecha mandato', 'fecha de firma', 'fecha firma mandato', 'fecha de firma del mandato', 'fecha alta', 'mandate date', 'signature date'],
  concept: ['concepto', 'descripcion', 'detalle', 'concept', 'remittance'],
  sequence: ['secuencia', 'tipo', 'tipo adeudo', 'tipo de adeudo', 'seqtp', 'sequence'],
};

export function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const DEFAULT_COLUMN_ORDER = ['name', 'iban', 'amount', 'mandateId', 'mandateDate', 'concept'];

/**
 * Asigna columnas a campos a partir de la fila de cabecera. Devuelve null si la fila no parece una cabecera.
 * @returns {Record<string, number> | null}
 */
export function detectColumns(headerRow) {
  const mapping = {};
  headerRow.forEach((cell, index) => {
    const h = normalizeHeader(cell);
    if (!h) return;
    for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (field in mapping) continue;
      if (synonyms.includes(h)) {
        mapping[field] = index;
        return;
      }
    }
  });
  // Pasadas parciales para cabeceras tipo "IBAN del socio": primero por el inicio (lo más
  // significativo, «IBAN del socio» es un IBAN), después por el final.
  const partial = (matches) => headerRow.forEach((cell, index) => {
    const h = normalizeHeader(cell);
    if (!h || Object.values(mapping).includes(index)) return;
    for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (field in mapping) continue;
      if (synonyms.some((s) => s.length >= 4 && matches(h, s))) {
        mapping[field] = index;
        return;
      }
    }
  });
  partial((h, s) => h.startsWith(`${s} `));
  partial((h, s) => h.endsWith(` ${s}`));
  const recognised = Object.keys(mapping).length;
  return recognised >= 2 && 'iban' in mapping ? mapping : null;
}

/**
 * Convierte texto pegado o CSV en registros con campos internos.
 * @returns {{records: Array<Record<string,string>>, mapping: Record<string, number>, hasHeader: boolean, firstDataLine: number}}
 */
export function tableToRecords(text, explicitMapping) {
  const rows = parseDelimited(text);
  if (!rows.length) return { records: [], mapping: {}, hasHeader: false, firstDataLine: 1 };
  let mapping = explicitMapping ?? detectColumns(rows[0]);
  const hasHeader = !explicitMapping && mapping !== null;
  if (!mapping) mapping = Object.fromEntries(DEFAULT_COLUMN_ORDER.map((f, i) => [f, i]));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const records = dataRows.map((row) => {
    const rec = {};
    for (const [field, index] of Object.entries(mapping)) rec[field] = row[index] ?? '';
    return rec;
  });
  return { records, mapping, hasHeader, firstDataLine: hasHeader ? 2 : 1 };
}
