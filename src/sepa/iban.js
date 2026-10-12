// Validación de IBAN (ISO 13616) y BIC (ISO 9362). Sin dependencias; funciona en navegador y Node.

// Longitud del IBAN por país, solo para países del ámbito SEPA (lista EPC409-09).
export const SEPA_IBAN_LENGTHS = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20,
  ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26,
  IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28,
  PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22,
  // Territorios que usan el código IBAN de Francia o Reino Unido.
  GG: 22, IM: 22, JE: 22, PM: 27, BL: 27, MF: 27, GF: 27, GP: 27, MQ: 27, RE: 27, YT: 27,
};

export function normalizeIban(value) {
  return String(value ?? '').toUpperCase().replace(/[\s\-.]/g, '').replace(/^IBAN:?/, '');
}

// Convierte letras a números (A=10 … Z=35) y calcula el resto módulo 97 por bloques.
export function mod97(alnum) {
  let remainder = 0;
  for (const ch of alnum) {
    const code = ch.charCodeAt(0);
    const digits = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return remainder;
}

/**
 * @returns {{valid: boolean, iban: string, country?: string, code?: string, message?: string}}
 */
export function validateIban(value) {
  const iban = normalizeIban(value);
  if (!iban) return { valid: false, iban, code: 'IBAN_EMPTY', message: 'Falta el IBAN.' };
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) {
    return { valid: false, iban, code: 'IBAN_FORMAT', message: 'El IBAN solo puede contener letras y números y debe empezar por el código de país (por ejemplo, ES).' };
  }
  const country = iban.slice(0, 2);
  const expected = SEPA_IBAN_LENGTHS[country];
  if (!expected) {
    return { valid: false, iban, country, code: 'IBAN_NOT_SEPA', message: `El país ${country} no pertenece a la zona SEPA o no es un código IBAN válido.` };
  }
  if (iban.length !== expected) {
    return { valid: false, iban, country, code: 'IBAN_LENGTH', message: `Un IBAN de ${country} tiene ${expected} caracteres y este tiene ${iban.length}.` };
  }
  if (mod97(iban.slice(4) + iban.slice(0, 4)) !== 1) {
    return { valid: false, iban, country, code: 'IBAN_CHECKSUM', message: 'Los dígitos de control del IBAN no cuadran: probablemente hay un número mal copiado.' };
  }
  if (country === 'ES' && !validSpanishAccountDigits(iban)) {
    return { valid: false, iban, country, code: 'IBAN_ES_CCC', message: 'El IBAN cuadra, pero los dígitos de control de la cuenta española (CCC) no: revisa el número de cuenta.' };
  }
  return { valid: true, iban, country };
}

// Dígitos de control internos de la cuenta española (CCC): entidad(4) oficina(4) DC(2) cuenta(10).
function validSpanishAccountDigits(iban) {
  const bban = iban.slice(4);
  const weights = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6];
  const dc = (digits) => {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += Number(digits[i]) * weights[i];
    const r = 11 - (sum % 11);
    return r === 11 ? 0 : r === 10 ? 1 : r;
  };
  const first = dc('00' + bban.slice(0, 8));
  const second = dc(bban.slice(10, 20));
  return `${first}${second}` === bban.slice(8, 10);
}

export function formatIban(value) {
  return normalizeIban(value).replace(/(.{4})/g, '$1 ').trim();
}

export function normalizeBic(value) {
  return String(value ?? '').toUpperCase().replace(/\s/g, '');
}

export function validateBic(value) {
  const bic = normalizeBic(value);
  if (!bic) return { valid: true, bic: '' }; // El BIC es opcional en operaciones SEPA.
  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) {
    return { valid: false, bic, code: 'BIC_FORMAT', message: 'El BIC debe tener 8 u 11 caracteres (por ejemplo, CAIXESBBXXX). Si no lo sabes, déjalo vacío.' };
  }
  return { valid: true, bic };
}
