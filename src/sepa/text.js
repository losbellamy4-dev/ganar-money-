// Juego de caracteres SEPA (EPC «basic Latin»): a-z A-Z 0-9 / - ? : ( ) . , ' + espacio.
// Transliteramos lo habitual en castellano/catalán/gallego/euskera para que el banco no rechace el fichero.

const SPECIAL = {
  'ß': 'ss', 'Æ': 'AE', 'æ': 'ae', 'Ø': 'O', 'ø': 'o', 'Œ': 'OE', 'œ': 'oe', 'Ł': 'L', 'ł': 'l',
  'Đ': 'D', 'đ': 'd', 'ª': 'a', 'º': 'o', '°': 'o', '&': 'Y', '€': 'EUR', '_': '-', '·': '.',
  '"': "'", '«': "'", '»': "'", '“': "'", '”': "'", '‘': "'", '’': "'", '–': '-', '—': '-',
  ';': ',', '!': '.', '¡': '', '¿': '', '#': 'N', '%': 'PCT', '*': '', '=': '-', '@': '(at)',
  '[': '(', ']': ')', '{': '(', '}': ')', '<': '(', '>': ')', '|': '/', '\\': '/', '$': 'USD',
};

const ALLOWED = /[A-Za-z0-9/\-?:().,'+ ]/;

function transliterate(input) {
  let out = '';
  for (const ch of String(input ?? '').normalize('NFD')) {
    if (/\p{M}/u.test(ch)) continue; // Elimina tildes y diéresis (á → a, ñ → n, ç → c).
    if (ALLOWED.test(ch)) out += ch;
    else if (ch in SPECIAL) out += SPECIAL[ch];
    else if (/\s/.test(ch)) out += ' ';
    // Cualquier otro carácter se descarta.
  }
  return out;
}

/**
 * Texto libre (nombres, concepto): transliteración + espacios normalizados + longitud máxima.
 * @returns {{value: string, changed: boolean, truncated: boolean}}
 */
export function sepaText(input, maxLength) {
  const original = String(input ?? '').trim();
  let value = transliterate(original).replace(/\s+/g, ' ').trim();
  let truncated = false;
  if (maxLength && value.length > maxLength) {
    value = value.slice(0, maxLength).trim();
    truncated = true;
  }
  return { value, changed: value !== original, truncated };
}

/**
 * Identificadores (referencia de mandato, EndToEndId…): sin espacios, sin "/" inicial o final ni "//".
 * La transformación es determinista: el mismo texto produce siempre la misma referencia.
 */
export function sepaIdentifier(input, maxLength = 35) {
  const original = String(input ?? '').trim();
  let value = transliterate(original)
    .replace(/\s+/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/-{2,}/g, '-')
    .replace(/^[/-]+|[/-]+$/g, '');
  let truncated = false;
  if (value.length > maxLength) {
    value = value.slice(0, maxLength).replace(/[/-]+$/g, '');
    truncated = true;
  }
  return { value, changed: value !== original, truncated };
}

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
