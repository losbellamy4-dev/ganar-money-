// Conversión de importes y fechas tal como llegan de una hoja de cálculo española o inglesa.

export const MAX_AMOUNT_CENTS = 99999999999; // 999.999.999,99 € (límite del esquema).

/**
 * Convierte "1.234,56", "1234.56", "12,5", "€ 12,50" o un número a céntimos (entero).
 * @returns {{ok: true, cents: number} | {ok: false, message: string}}
 */
export function parseAmount(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, message: 'El importe no es un número.' };
    input = input.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
  }
  let s = String(input ?? '').trim().replace(/[€\s]|EUR/gi, '');
  if (!s) return { ok: false, message: 'Falta el importe.' };
  if (s.startsWith('-')) return { ok: false, message: 'El importe no puede ser negativo.' };
  if (!/^[0-9.,]+$/.test(s)) return { ok: false, message: `«${input}» no es un importe válido.` };

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart;
  let decPart = '';
  if (lastComma >= 0 && lastDot >= 0) {
    // Ambos separadores: el último es el decimal.
    const dec = lastComma > lastDot ? ',' : '.';
    const thou = dec === ',' ? '.' : ',';
    const [i, d, ...rest] = s.split(dec);
    if (rest.length) return { ok: false, message: `«${input}» tiene varios separadores decimales.` };
    if (!/^[0-9]{1,3}([.,][0-9]{3})*$/.test(i) || i.includes(dec)) return { ok: false, message: `«${input}» no es un importe válido.` };
    intPart = i.split(thou).join('');
    decPart = d;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = s.split(sep);
    if (sep === ',' && parts.length === 2 && parts[1].length === 3) {
      // "12,345": en una hoja española sería un error de tecleo; en una inglesa, 12345. No adivinamos con dinero.
      return { ok: false, message: `«${input}» es ambiguo: escribe el importe con dos decimales (por ejemplo 12,34 o 12345,00).` };
    }
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length > 0)) {
      // "1.234" o "1.234.567": separador de miles.
      if (!parts.slice(1).every((p) => p.length === 3)) return { ok: false, message: `«${input}» no es un importe válido.` };
      if (/^0*$/.test(parts[0])) return { ok: false, message: `«${input}» tiene más de dos decimales.` };
      intPart = parts.join('');
    } else {
      intPart = parts[0] || '0';
      decPart = parts[1] ?? '';
    }
  } else {
    intPart = s;
  }
  if (decPart.length > 2) return { ok: false, message: `«${input}» tiene más de dos decimales.` };
  if (!/^[0-9]+$/.test(intPart) || !/^[0-9]*$/.test(decPart)) return { ok: false, message: `«${input}» no es un importe válido.` };
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return { ok: false, message: 'El importe es demasiado grande.' };
  if (cents <= 0) return { ok: false, message: 'El importe debe ser mayor que 0.' };
  if (cents > MAX_AMOUNT_CENTS) return { ok: false, message: 'El importe supera el máximo permitido.' };
  return { ok: true, cents };
}

export function formatCents(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function formatEuros(cents) {
  const int = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${int},${String(cents % 100).padStart(2, '0')} €`;
}

/**
 * Convierte "31/12/2025", "31-12-25", "2025-12-31" o "31.12.2025" a "2025-12-31".
 * @returns {{ok: true, date: string} | {ok: false, message: string}}
 */
export function parseDate(input) {
  const s = String(input ?? '').trim();
  if (!s) return { ok: false, message: 'Falta la fecha.' };
  let y;
  let m;
  let d;
  let match;
  if ((match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/))) {
    [, y, m, d] = match;
  } else if ((match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    [, d, m, y] = match;
    if (y.length === 2) y = `20${y}`;
  } else {
    return { ok: false, message: `«${s}» no es una fecha válida (usa dd/mm/aaaa).` };
  }
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) {
    return { ok: false, message: `«${s}» no es una fecha que exista.` };
  }
  return { ok: true, date: iso };
}

export function todayIso(now = new Date()) {
  // Fecha local de España sin depender de la zona horaria del servidor.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(iso, days) {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Suma días hábiles TARGET2 (lunes a viernes, sin 1 ene, Viernes Santo, Lunes de Pascua, 1 may, 25 y 26 dic). */
export function addBusinessDays(iso, days) {
  let current = iso;
  let added = 0;
  while (added < days) {
    current = addDays(current, 1);
    if (isTargetBusinessDay(current)) added++;
  }
  return current;
}

export function isTargetBusinessDay(iso) {
  const dt = new Date(`${iso}T00:00:00Z`);
  const dow = dt.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const md = iso.slice(5);
  if (['01-01', '05-01', '12-25', '12-26'].includes(md)) return false;
  const easter = easterSunday(dt.getUTCFullYear());
  return iso !== addDays(easter, -2) && iso !== addDays(easter, 1);
}

// Algoritmo de Meeus/Jones/Butcher para el domingo de Pascua (calendario gregoriano).
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
