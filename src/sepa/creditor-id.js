// Identificador de acreedor SEPA (AT-02, EPC262-08).
// Formato: país(2) + dígitos de control(2) + sufijo comercial(3) + identificador nacional.
// Los dígitos de control se calculan con ISO 7064 Mod 97-10 sobre identificador nacional + país + "00";
// el sufijo comercial NO entra en el cálculo.
import { mod97 } from './iban.js';

export function normalizeCreditorId(value) {
  return String(value ?? '').toUpperCase().replace(/[\s\-.]/g, '');
}

export function creditorCheckDigits(country, nationalId) {
  const remainder = mod97(`${nationalId}${country}00`);
  return String(98 - remainder).padStart(2, '0');
}

/**
 * Calcula el identificador de acreedor a partir del NIF/CIF y el sufijo (por defecto 000).
 */
export function computeCreditorId({ nationalId, suffix = '000', country = 'ES' }) {
  const nid = normalizeCreditorId(nationalId);
  const sfx = normalizeCreditorId(suffix || '000');
  const ctry = String(country || 'ES').toUpperCase();
  if (!/^[A-Z]{2}$/.test(ctry)) throw new Error('Código de país no válido.');
  if (!/^[A-Z0-9]{3}$/.test(sfx)) throw new Error('El sufijo debe tener 3 letras o números (normalmente 000).');
  if (!/^[A-Z0-9]{1,28}$/.test(nid)) throw new Error('El NIF/CIF solo puede contener letras y números.');
  return `${ctry}${creditorCheckDigits(ctry, nid)}${sfx}${nid}`;
}

export function validateCreditorId(value) {
  const id = normalizeCreditorId(value);
  if (!id) return { valid: false, id, code: 'CID_EMPTY', message: 'Falta el identificador de acreedor (te lo asigna tu banco; en España suele ser ES + 2 dígitos + 000 + NIF).' };
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/.test(id) || id.length > 35) {
    return { valid: false, id, code: 'CID_FORMAT', message: 'El identificador de acreedor tiene un formato incorrecto. Ejemplo válido: ES23000B12345674.' };
  }
  const country = id.slice(0, 2);
  const nationalId = id.slice(7);
  if (creditorCheckDigits(country, nationalId) !== id.slice(2, 4)) {
    return { valid: false, id, code: 'CID_CHECKSUM', message: 'Los dígitos de control del identificador de acreedor no cuadran. Usa la calculadora para obtener el correcto a partir de tu NIF.' };
  }
  const result = { valid: true, id, country, suffix: id.slice(4, 7), nationalId };
  if (country === 'ES') {
    const nif = validateSpanishTaxId(nationalId);
    if (!nif.valid) result.warning = `El NIF/CIF incluido (${nationalId}) no parece válido: ${nif.message}`;
  }
  return result;
}

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/**
 * Valida NIF (DNI), NIE y CIF/NIF de persona jurídica españoles.
 */
export function validateSpanishTaxId(value) {
  const id = normalizeCreditorId(value);
  if (/^[0-9]{8}[A-Z]$/.test(id)) {
    return DNI_LETTERS[Number(id.slice(0, 8)) % 23] === id[8]
      ? { valid: true, type: 'DNI' }
      : { valid: false, message: 'la letra del DNI no corresponde al número.' };
  }
  if (/^[XYZ][0-9]{7}[A-Z]$/.test(id)) {
    const num = 'XYZ'.indexOf(id[0]) + id.slice(1, 8);
    return DNI_LETTERS[Number(num) % 23] === id[8]
      ? { valid: true, type: 'NIE' }
      : { valid: false, message: 'la letra del NIE no corresponde al número.' };
  }
  if (/^[KLM][0-9]{7}[A-Z]$/.test(id)) {
    // K (menores de 14), L (residentes en el extranjero) y M (extranjeros sin NIE): control tipo DNI.
    return DNI_LETTERS[Number(id.slice(1, 8)) % 23] === id[8]
      ? { valid: true, type: 'NIF-KLM' }
      : { valid: false, message: 'la letra de control no corresponde al número.' };
  }
  if (/^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/.test(id)) {
    const digits = id.slice(1, 8);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      let n = Number(digits[i]);
      if (i % 2 === 0) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
    }
    const control = (10 - (sum % 10)) % 10;
    const last = id[8];
    // La norma asigna control alfabético o numérico según la letra inicial, pero en la práctica
    // circulan ambas formas; como esto solo produce un aviso, aceptamos las dos (igual que python-stdnum).
    const ok = last === 'JABCDEFGHI'[control] || last === String(control);
    return ok ? { valid: true, type: 'CIF' } : { valid: false, message: 'el carácter de control del CIF no corresponde.' };
  }
  return { valid: false, message: 'no tiene formato de DNI, NIE ni CIF.' };
}
