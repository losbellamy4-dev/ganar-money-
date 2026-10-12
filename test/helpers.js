import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Valida un XML contra el XSD oficial con xmllint. */
export function xsdValidate(xml, version) {
  const dir = mkdtempSync(join(tmpdir(), 'rl-xsd-'));
  const file = join(dir, 'remesa.xml');
  writeFileSync(file, xml);
  try {
    execFileSync('xmllint', ['--noout', '--schema', join(ROOT, `test/fixtures/xsd/pain.008.001.${version}.xsd`), file], { stdio: 'pipe' });
    return { ok: true, output: '' };
  } catch (e) {
    return { ok: false, output: `${e.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const TODAY = '2026-10-12';

export function sampleInput(overrides = {}) {
  return {
    creditor: { name: 'Club Deportivo Ñandú', iban: 'ES91 2100 0418 4502 0005 1332', bic: '', creditorId: 'ES23ZZZ47690558N' },
    collectionDate: '2026-10-20',
    scheme: 'CORE',
    sequence: 'RCUR',
    concept: 'Cuota octubre 2026',
    transactions: [
      { name: 'José Muñoz Peña', iban: 'ES7921000813610123456789', amount: '25,00', mandateId: 'SOCIO-001', mandateDate: '15/01/2024' },
      { name: 'Ana García & Hijos', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', amount: '1.234,56', mandateId: 'SOCIO 002', mandateDate: '2025-03-01', concept: 'Cuota anual <especial>', sequence: 'FRST' },
    ],
    ...overrides,
  };
}
