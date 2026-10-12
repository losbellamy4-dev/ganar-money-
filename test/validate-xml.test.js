import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRemittance, normalizeSequence } from '../src/sepa/validate.js';
import { buildPain008, newMessageId } from '../src/sepa/xml.js';
import { computeCreditorId } from '../src/sepa/creditor-id.js';
import { mod97 } from '../src/sepa/iban.js';
import { xsdValidate, sampleInput, TODAY } from './helpers.js';

const opts = { today: TODAY };
const codes = (list) => list.map((e) => e.code);

test('Remesa válida: normaliza datos y resume', () => {
  const r = validateRemittance(sampleInput(), opts);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.summary.count, 2);
  assert.equal(r.summary.totalCents, 2500 + 123456);
  assert.equal(r.remittance.creditor.name, 'Club Deportivo Nandu');
  assert.equal(r.remittance.creditor.iban, 'ES9121000418450200051332');
  const [a, b] = r.remittance.transactions;
  assert.equal(a.name, 'Jose Munoz Pena');
  assert.equal(a.sequence, 'RCUR');
  assert.equal(a.concept, 'Cuota octubre 2026');
  assert.equal(a.endToEndId, 'SOCIO-001-261020');
  assert.equal(b.mandateId, 'SOCIO-002');
  assert.equal(b.sequence, 'FRST');
  assert.equal(b.concept, 'Cuota anual (especial)');
  assert.ok(codes(r.warnings).includes('MANDATE_ID_ADJUSTED'));
  assert.ok(codes(r.warnings).includes('TEXT_ADAPTED'));
});

test('Errores del acreedor y de la remesa', () => {
  const r = validateRemittance(sampleInput({
    creditor: { name: '', iban: 'ES00', creditorId: 'ES99ZZZ47690558N', bic: 'XX' },
    collectionDate: '2026-10-12',
    scheme: 'XYZ',
    sequence: 'NOPE',
  }), opts);
  assert.equal(r.ok, false);
  assert.equal(r.remittance, null);
  for (const c of ['CREDITOR_NAME', 'IBAN_FORMAT', 'CID_CHECKSUM', 'BIC_FORMAT', 'COLLECTION_DATE_PAST', 'SCHEME', 'SEQUENCE']) {
    assert.ok(codes(r.errors).includes(c), `falta ${c}: ${JSON.stringify(r.errors)}`);
  }
});

test('Errores por recibo con número de línea', () => {
  const r = validateRemittance(sampleInput({
    transactions: [
      { name: '', iban: 'ES9121000418450200051333', amount: '0', mandateId: '', mandateDate: '2027-01-01' },
      { name: 'Ok', iban: 'ES9121000418450200051332', amount: '10', mandateId: 'M', mandateDate: '01/01/2024', sequence: 'mensual' },
      { name: 'Ok', iban: 'ES9121000418450200051332', amount: '10', mandateId: 'M2', mandateDate: '31/02/2024' },
    ],
  }), opts);
  const byLine = (l) => r.errors.filter((e) => e.line === l).map((e) => e.code);
  assert.deepEqual(byLine(1).sort(), ['AMOUNT', 'IBAN_CHECKSUM', 'MANDATE_DATE_FUTURE', 'MANDATE_ID', 'NAME'].sort());
  assert.deepEqual(byLine(2), ['SEQUENCE']);
  assert.deepEqual(byLine(3), ['MANDATE_DATE']);
});

test('Avisos: fecha próxima, día no hábil, duplicados, IBAN del acreedor', () => {
  const r = validateRemittance(sampleInput({
    collectionDate: '2026-10-13',
    transactions: [
      { name: 'A', iban: 'ES7921000813610123456789', amount: '5', mandateId: 'X', mandateDate: '2024-01-01' },
      { name: 'A', iban: 'ES7921000813610123456789', amount: '5', mandateId: 'X', mandateDate: '2024-01-01' },
      { name: 'B', iban: 'ES9121000418450200051332', amount: '5', mandateId: 'Y', mandateDate: '2024-01-01' },
    ],
  }), opts);
  assert.equal(r.ok, true);
  const w = codes(r.warnings);
  assert.ok(w.includes('COLLECTION_DATE_SOON'));
  assert.ok(w.includes('DUPLICATE'));
  assert.ok(w.includes('IBAN_SAME_AS_CREDITOR'));
  // EndToEndId únicos aunque el mandato se repita.
  const ids = r.remittance.transactions.map((t) => t.endToEndId);
  assert.equal(new Set(ids).size, ids.length);
  const sat = validateRemittance(sampleInput({ collectionDate: '2026-10-24' }), opts);
  assert.ok(codes(sat.warnings).includes('COLLECTION_DATE_HOLIDAY'));
});

test('Mandato firmado después de la fecha de cobro', () => {
  const r = validateRemittance(sampleInput({
    transactions: [{ name: 'A', iban: 'ES7921000813610123456789', amount: '5', mandateId: 'X', mandateDate: '2026-10-11' }],
    collectionDate: '2026-10-10',
  }), opts);
  assert.ok(codes(r.errors).includes('COLLECTION_DATE_PAST'));
});

test('Límites del plan: número de recibos y B2B', () => {
  const r = validateRemittance(sampleInput(), { ...opts, maxTransactions: 1 });
  assert.ok(codes(r.errors).includes('LIMIT_TRANSACTIONS'));
  const b2b = validateRemittance(sampleInput({ scheme: 'B2B' }), { ...opts, allowB2B: false });
  assert.ok(codes(b2b.errors).includes('PLAN_B2B'));
  assert.equal(validateRemittance(sampleInput({ scheme: 'b2b' }), { ...opts, allowB2B: true }).ok, true);
  assert.equal(validateRemittance(null, opts).ok, false);
  assert.equal(validateRemittance({ transactions: 'x' }, opts).ok, false);
});

test('Alias de secuencia', () => {
  assert.equal(normalizeSequence('recurrente'), 'RCUR');
  assert.equal(normalizeSequence('Primera'), 'FRST');
  assert.equal(normalizeSequence('único'), 'OOFF');
  assert.equal(normalizeSequence('Último'), 'FNAL');
  assert.equal(normalizeSequence('x'), null);
});

for (const version of ['02', '08']) {
  test(`XML pain.008.001.${version}: válido contra el XSD oficial`, () => {
    const r = validateRemittance(sampleInput(), opts);
    const xml = buildPain008(r.remittance, { version, messageId: 'RL-20261012-TEST', createdAt: new Date('2026-10-12T10:00:00Z') });
    const v = xsdValidate(xml, version);
    assert.equal(v.ok, true, v.output);
    assert.match(xml, new RegExp(`pain\\.008\\.001\\.${version}`));
    assert.match(xml, /<NbOfTxs>2<\/NbOfTxs>/);
    assert.match(xml, /<CtrlSum>1259\.56<\/CtrlSum>/);
    assert.match(xml, /<SeqTp>RCUR<\/SeqTp>/);
    assert.match(xml, /<SeqTp>FRST<\/SeqTp>/);
    assert.match(xml, /<Id>NOTPROVIDED<\/Id>/);
    assert.match(xml, version === '02' ? /<BIC>COBADEFFXXX<\/BIC>/ : /<BICFI>COBADEFFXXX<\/BICFI>/);
    assert.match(xml, /<Nm>Ana Garcia Y Hijos<\/Nm>/);
    assert.match(xml, /<CreDtTm>2026-10-12T10:00:00<\/CreDtTm>/);
  });
}

test('El XSD detecta un XML manipulado (control de la prueba)', () => {
  const r = validateRemittance(sampleInput(), opts);
  const xml = buildPain008(r.remittance, { version: '02', messageId: 'RL-X' }).replace('<PmtMtd>DD</PmtMtd>', '<PmtMtd>XX</PmtMtd>');
  assert.equal(xsdValidate(xml, '02').ok, false);
});

test('buildPain008 rechaza entradas no validadas', () => {
  assert.throws(() => buildPain008(null, { messageId: 'A' }));
  const r = validateRemittance(sampleInput(), opts);
  assert.throws(() => buildPain008(r.remittance, { messageId: 'con espacios' }));
  assert.throws(() => buildPain008(r.remittance, { messageId: 'A', version: '99' }));
  assert.match(newMessageId(new Date('2026-10-12T10:11:12Z'), () => 0), /^RL-20261012101112-00000000$/);
});

// Prueba aleatoria: muchas remesas con datos variados deben producir siempre XML válido.
test('Prueba aleatoria: 60 remesas generadas al azar son válidas contra ambos XSD', () => {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = (s) => s[Math.floor(rand() * s.length)];
  const NAMES = ['José Ñúñez', "O'Connor & Cía.", 'Asociación «Vecinos» Nº3', 'Ærø Øster', 'Zoë—Ünal', '😀 Emoji', 'García-López, M.ª'];
  const randIbanEs = () => {
    let bban = '';
    for (let i = 0; i < 20; i++) bban += Math.floor(rand() * 10);
    // Ajusta los dígitos de control del CCC.
    const w = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6];
    const dc = (d) => {
      const r = 11 - ([...d].reduce((a, c, i) => a + Number(c) * w[i], 0) % 11);
      return r === 11 ? 0 : r === 10 ? 1 : r;
    };
    bban = bban.slice(0, 8) + dc(`00${bban.slice(0, 8)}`) + dc(bban.slice(10)) + bban.slice(10);
    return `ES${String(98 - mod97(`${bban}ES00`)).padStart(2, '0')}${bban}`;
  };
  for (let i = 0; i < 60; i++) {
    const n = 1 + Math.floor(rand() * 40);
    const transactions = Array.from({ length: n }, (_, k) => ({
      name: pick(NAMES) + k,
      iban: randIbanEs(),
      bic: rand() < 0.3 ? 'CAIXESBBXXX' : '',
      amount: `${Math.floor(rand() * 5000)},${String(Math.floor(rand() * 100)).padStart(2, '0')}`.replace(/^0,00$/, '1,00'),
      mandateId: rand() < 0.5 ? `Socio ${k} / año` : `M-${k}`,
      mandateDate: '01/01/2024',
      sequence: pick(['', 'FRST', 'RCUR', 'OOFF', 'FNAL']),
      concept: rand() < 0.5 ? `Cuota <${k}> "especial" & más ${'x'.repeat(Math.floor(rand() * 200))}` : '',
    }));
    const input = sampleInput({
      creditor: { name: pick(NAMES), iban: randIbanEs(), creditorId: computeCreditorId({ nationalId: 'G12345678', suffix: '000' }) },
      transactions,
    });
    const r = validateRemittance(input, opts);
    // Importes 0,xx pueden salir "0,00" solo si ambos son cero: se corrigió arriba.
    assert.equal(r.ok, true, JSON.stringify(r.errors.slice(0, 3)));
    for (const version of ['02', '08']) {
      const xml = buildPain008(r.remittance, { version, messageId: `RL-RAND-${i}` });
      const v = xsdValidate(xml, version);
      assert.equal(v.ok, true, `remesa ${i} v${version}: ${v.output}`);
    }
  }
});
