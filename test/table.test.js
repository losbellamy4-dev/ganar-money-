import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDelimiter, parseDelimited, detectColumns, tableToRecords, normalizeHeader } from '../src/sepa/table.js';

test('Detección de delimitador', () => {
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a;b;c'), ';');
  assert.equal(detectDelimiter('a,b,c'), ',');
  assert.equal(detectDelimiter('"a;b",c'), ',');
  assert.equal(detectDelimiter('solo'), '\t');
});

test('CSV con comillas, comillas escapadas, saltos de línea internos y BOM', () => {
  const csv = '﻿nombre;importe\r\n"Pérez; Juan";"25,00"\r\n"Dice ""hola""";"1"\n"Multi\nlínea";2\n\n';
  assert.deepEqual(parseDelimited(csv), [
    ['nombre', 'importe'],
    ['Pérez; Juan', '25,00'],
    ['Dice "hola"', '1'],
    ['Multi\nlínea', '2'],
  ]);
});

test('Cabeceras: sinónimos, tildes y coincidencias parciales', () => {
  assert.equal(normalizeHeader('  Fecha de Firma (mandato) '), 'fecha de firma mandato');
  const m = detectColumns(['Nombre y apellidos', 'IBAN', 'Cuota', 'Referencia mandato', 'Fecha firma', 'Concepto']);
  assert.deepEqual(m, { name: 0, iban: 1, amount: 2, mandateId: 3, mandateDate: 4, concept: 5 });
  const p = detectColumns(['Importe cuota', 'IBAN del socio', 'Nombre del socio']);
  assert.equal(p.amount, 0);
  assert.equal(p.name, 2);
  assert.equal(p.iban, 1);
  // Una fila de datos no se toma por cabecera.
  assert.equal(detectColumns(['Juan', 'ES9121000418450200051332', '25']), null);
});

test('Texto pegado desde Excel con y sin cabecera', () => {
  const withHeader = 'Nombre\tIBAN\tImporte\tMandato\tFecha firma\nJuan\tES91 2100 0418 4502 0005 1332\t25,00\tM1\t01/01/2024\n';
  const r = tableToRecords(withHeader);
  assert.equal(r.hasHeader, true);
  assert.equal(r.firstDataLine, 2);
  assert.deepEqual(r.records, [{ name: 'Juan', iban: 'ES91 2100 0418 4502 0005 1332', amount: '25,00', mandateId: 'M1', mandateDate: '01/01/2024' }]);

  const noHeader = 'Juan\tES9121000418450200051332\t25\tM1\t01/01/2024\tCuota';
  const r2 = tableToRecords(noHeader);
  assert.equal(r2.hasHeader, false);
  assert.equal(r2.records[0].concept, 'Cuota');
  assert.equal(r2.records[0].iban, 'ES9121000418450200051332');
  assert.deepEqual(tableToRecords('').records, []);
});
