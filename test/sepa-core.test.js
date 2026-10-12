import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateIban, validateBic, mod97, formatIban } from '../src/sepa/iban.js';
import { computeCreditorId, validateCreditorId, validateSpanishTaxId } from '../src/sepa/creditor-id.js';
import { sepaText, sepaIdentifier, escapeXml } from '../src/sepa/text.js';
import { parseAmount, parseDate, formatCents, formatEuros, addBusinessDays, isTargetBusinessDay, todayIso } from '../src/sepa/values.js';
import { ROOT } from './helpers.js';

const fixtures = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/stdnum-crosscheck.json'), 'utf8'));

test('IBAN: ejemplos conocidos', () => {
  assert.equal(validateIban('ES91 2100 0418 4502 0005 1332').valid, true);
  assert.equal(validateIban('es9121000418450200051332').valid, true);
  assert.equal(validateIban('DE89370400440532013000').valid, true);
  assert.equal(validateIban('GB82WEST12345698765432').valid, true);
  assert.equal(validateIban('ES9121000418450200051333').code, 'IBAN_CHECKSUM');
  assert.equal(validateIban('ES912100041845020005133').code, 'IBAN_LENGTH');
  assert.equal(validateIban('BR1800360305000010009795493C1').code, 'IBAN_NOT_SEPA');
  assert.equal(validateIban('').code, 'IBAN_EMPTY');
  assert.equal(validateIban('ES91-2100-0418-ÑÑ').code, 'IBAN_FORMAT');
  assert.equal(formatIban('ES9121000418450200051332'), 'ES91 2100 0418 4502 0005 1332');
  assert.equal(mod97('123456789'), 123456789 % 97);
});

test('IBAN: CCC español con dígitos de control internos incorrectos pero mod97 correcto', () => {
  // Cambiamos el DC interno (45 -> 46) y recalculamos el control IBAN para que mod97 cuadre.
  const bban = '21000418460200051332';
  const check = String(98 - mod97(`${bban}ES00`)).padStart(2, '0');
  const r = validateIban(`ES${check}${bban}`);
  assert.equal(r.valid, false);
  assert.equal(r.code, 'IBAN_ES_CCC');
});

test('IBAN: verificación cruzada con python-stdnum (840 casos)', () => {
  let n = 0;
  for (const c of fixtures.ibans) {
    const ours = validateIban(c.value).valid;
    if ('valid' in c) assert.equal(ours, c.valid, `ES ${c.value}`);
    else assert.equal(ours, c.mod97, `extranjero ${c.value}`);
    n++;
  }
  assert.equal(n, 840);
});

test('BIC: opcional y con formato', () => {
  assert.equal(validateBic('').valid, true);
  assert.equal(validateBic('CAIXESBBXXX').valid, true);
  assert.equal(validateBic('caix esbb').valid, true);
  assert.equal(validateBic('CAIXES').valid, false);
  assert.equal(validateBic('1AIXESBBXXX').valid, false);
});

test('Identificador de acreedor: ejemplo de referencia y cálculo', () => {
  assert.equal(validateCreditorId('ES23ZZZ47690558N').valid, true);
  assert.equal(validateCreditorId('ES24ZZZ47690558N').code, 'CID_CHECKSUM');
  assert.equal(computeCreditorId({ nationalId: '47690558N', suffix: 'ZZZ' }), 'ES23ZZZ47690558N');
  // El sufijo no afecta a los dígitos de control.
  assert.equal(computeCreditorId({ nationalId: '47690558N' }), 'ES2300047690558N');
  assert.equal(validateCreditorId('').code, 'CID_EMPTY');
  assert.equal(validateCreditorId('ES2').code, 'CID_FORMAT');
  assert.throws(() => computeCreditorId({ nationalId: 'B1234', suffix: '0' }));
});

test('Identificador de acreedor: verificación cruzada con python-stdnum (800 casos)', () => {
  for (const c of fixtures.creditorIds) {
    if (c.expected) {
      assert.equal(computeCreditorId({ nationalId: c.nationalId, suffix: c.suffix }), c.expected);
      assert.equal(validateCreditorId(c.expected).valid, c.valid);
    } else {
      assert.equal(validateCreditorId(c.value).valid, c.valid, c.value);
    }
  }
});

test('NIF/NIE/CIF/KLM: verificación cruzada con python-stdnum (1200 casos)', () => {
  for (const c of fixtures.taxIds) {
    assert.equal(validateSpanishTaxId(c.value).valid, c.valid, c.value);
  }
});

test('Texto SEPA: transliteración y límites', () => {
  assert.deepEqual(sepaText('José Muñoz Peña', 70), { value: 'Jose Munoz Pena', changed: true, truncated: false });
  assert.equal(sepaText('Ana García & Hijos', 70).value, 'Ana Garcia Y Hijos');
  assert.equal(sepaText('Çà_ü  «x»', 70).value, "Ca-u 'x'");
  assert.equal(sepaText('Nº 5 – 3ª', 70).value, 'No 5 - 3a');
  assert.equal(sepaText('a'.repeat(80), 70).value.length, 70);
  assert.equal(sepaText('a'.repeat(80), 70).truncated, true);
  assert.equal(sepaText('  ', 70).value, '');
  assert.equal(sepaText('emoji 😀 ok', 70).value, 'emoji ok');
});

test('Identificadores SEPA: sin espacios, sin barras al borde ni dobles', () => {
  assert.equal(sepaIdentifier('SOCIO 002').value, 'SOCIO-002');
  assert.equal(sepaIdentifier('/abc//def/').value, 'abc/def');
  assert.equal(sepaIdentifier('Peña-01').value, 'Pena-01');
  assert.equal(sepaIdentifier('x'.repeat(40)).value.length, 35);
  assert.equal(sepaIdentifier('ABC-123').changed, false);
  // Determinista.
  assert.equal(sepaIdentifier('Socio Nº 7').value, sepaIdentifier('Socio Nº 7').value);
});

test('escapeXml', () => {
  assert.equal(escapeXml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
});

test('Importes: formatos españoles e ingleses', () => {
  const cases = {
    '25': 2500, '25,5': 2550, '25,50': 2550, '25.50': 2550, '1.234,56': 123456, '1,234.56': 123456,
    '1.234': 123400, '1.234.567': 123456700, '1234567,89': 123456789, '€ 12,50': 1250, '12,50 €': 1250,
    '0,01': 1, ',5': 50, '999999999,99': 99999999999,
  };
  for (const [input, cents] of Object.entries(cases)) {
    const r = parseAmount(input);
    assert.equal(r.ok, true, `${input}: ${r.message}`);
    assert.equal(r.cents, cents, input);
  }
  assert.equal(parseAmount(12.5).cents, 1250);
  assert.equal(parseAmount(0.1 + 0.2).cents, 30);
  for (const bad of ['', '-5', '0', '0,00', '12,345', '0.123', 'abc', '1.23,45', '1,2,3', '1000000000', NaN]) {
    assert.equal(parseAmount(bad).ok, false, `debería fallar: ${bad}`);
  }
  assert.equal(formatCents(123456), '1234.56');
  assert.equal(formatCents(5), '0.05');
  assert.equal(formatEuros(123456789), '1.234.567,89 €');
});

test('Fechas: formatos y fechas imposibles', () => {
  assert.equal(parseDate('31/12/2025').date, '2025-12-31');
  assert.equal(parseDate('1-2-25').date, '2025-02-01');
  assert.equal(parseDate('2025-12-31').date, '2025-12-31');
  assert.equal(parseDate('2025-12-31T10:00:00').date, '2025-12-31');
  assert.equal(parseDate('31.12.2025').date, '2025-12-31');
  assert.equal(parseDate('29/02/2024').ok, true);
  assert.equal(parseDate('29/02/2025').ok, false);
  assert.equal(parseDate('31/04/2025').ok, false);
  assert.equal(parseDate('ayer').ok, false);
  assert.equal(parseDate('').ok, false);
});

test('Días hábiles TARGET2', () => {
  assert.equal(isTargetBusinessDay('2026-10-12'), true); // Lunes (festivo nacional en España, pero hábil TARGET2).
  assert.equal(isTargetBusinessDay('2026-10-17'), false); // Sábado.
  assert.equal(isTargetBusinessDay('2026-12-25'), false);
  assert.equal(isTargetBusinessDay('2027-03-26'), false); // Viernes Santo 2027.
  assert.equal(isTargetBusinessDay('2027-03-29'), false); // Lunes de Pascua 2027.
  assert.equal(addBusinessDays('2026-10-16', 1), '2026-10-19');
  assert.equal(addBusinessDays('2026-12-23', 2), '2026-12-28');
  assert.match(todayIso(new Date('2026-10-12T23:30:00Z')), /^2026-10-13$/); // Ya es día 13 en Madrid.
});
