// Generación del XML pain.008 (adeudos directos SEPA). Solo se ejecuta en el servidor:
// la autorización del plan (límites, B2B) se decide allí, nunca en el navegador.
import { escapeXml } from './text.js';
import { formatCents } from './values.js';

export const VERSIONS = {
  '02': { ns: 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.02', bicTag: 'BIC' },
  '08': { ns: 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.08', bicTag: 'BICFI' },
};

function el(name, content, indent) {
  return `${indent}<${name}>${content}</${name}>`;
}

function agent(bic, bicTag, indent) {
  const inner = bic
    ? el(bicTag, escapeXml(bic), `${indent}    `)
    : `${indent}    <Othr>\n${el('Id', 'NOTPROVIDED', `${indent}      `)}\n${indent}    </Othr>`;
  return `${indent}  <FinInstnId>\n${inner}\n${indent}  </FinInstnId>`;
}

/**
 * @param {object} remittance  Resultado `remittance` de validateRemittance (ya validado).
 * @param {{version?: '02'|'08', messageId: string, createdAt?: Date}} opts
 * @returns {string} XML UTF-8
 */
export function buildPain008(remittance, opts) {
  const version = opts.version ?? '02';
  const v = VERSIONS[version];
  if (!v) throw new Error(`Versión no soportada: ${version}`);
  if (!remittance || !remittance.transactions?.length) throw new Error('Remesa vacía o no validada.');
  if (!/^[A-Za-z0-9-]{1,35}$/.test(opts.messageId)) throw new Error('messageId inválido.');

  const created = (opts.createdAt ?? new Date()).toISOString().slice(0, 19);
  const { creditor } = remittance;

  // Un bloque PmtInf por tipo de secuencia (SeqTp va a nivel de bloque).
  const groups = new Map();
  for (const t of remittance.transactions) {
    if (!groups.has(t.sequence)) groups.set(t.sequence, []);
    groups.get(t.sequence).push(t);
  }

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<Document xmlns="${v.ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`);
  lines.push('  <CstmrDrctDbtInitn>');
  lines.push('    <GrpHdr>');
  lines.push(el('MsgId', escapeXml(opts.messageId), '      '));
  lines.push(el('CreDtTm', created, '      '));
  lines.push(el('NbOfTxs', String(remittance.transactions.length), '      '));
  lines.push(el('CtrlSum', formatCents(remittance.totalCents), '      '));
  lines.push('      <InitgPty>');
  lines.push(el('Nm', escapeXml(creditor.name), '        '));
  lines.push('        <Id>');
  lines.push('          <OrgId>');
  lines.push('            <Othr>');
  lines.push(el('Id', escapeXml(creditor.creditorId), '              '));
  lines.push('            </Othr>');
  lines.push('          </OrgId>');
  lines.push('        </Id>');
  lines.push('      </InitgPty>');
  lines.push('    </GrpHdr>');

  for (const [sequence, txs] of groups) {
    const sum = txs.reduce((a, t) => a + t.amountCents, 0);
    lines.push('    <PmtInf>');
    lines.push(el('PmtInfId', escapeXml(`${opts.messageId}-${sequence}`.slice(0, 35)), '      '));
    lines.push(el('PmtMtd', 'DD', '      '));
    lines.push(el('BtchBookg', 'true', '      '));
    lines.push(el('NbOfTxs', String(txs.length), '      '));
    lines.push(el('CtrlSum', formatCents(sum), '      '));
    lines.push('      <PmtTpInf>');
    lines.push('        <SvcLvl>');
    lines.push(el('Cd', 'SEPA', '          '));
    lines.push('        </SvcLvl>');
    lines.push('        <LclInstrm>');
    lines.push(el('Cd', remittance.scheme, '          '));
    lines.push('        </LclInstrm>');
    lines.push(el('SeqTp', sequence, '        '));
    lines.push('      </PmtTpInf>');
    lines.push(el('ReqdColltnDt', remittance.collectionDate, '      '));
    lines.push('      <Cdtr>');
    lines.push(el('Nm', escapeXml(creditor.name), '        '));
    lines.push('      </Cdtr>');
    lines.push('      <CdtrAcct>');
    lines.push('        <Id>');
    lines.push(el('IBAN', creditor.iban, '          '));
    lines.push('        </Id>');
    lines.push(el('Ccy', 'EUR', '        '));
    lines.push('      </CdtrAcct>');
    lines.push('      <CdtrAgt>');
    lines.push(agent(creditor.bic, v.bicTag, '      '));
    lines.push('      </CdtrAgt>');
    lines.push(el('ChrgBr', 'SLEV', '      '));
    lines.push('      <CdtrSchmeId>');
    lines.push('        <Id>');
    lines.push('          <PrvtId>');
    lines.push('            <Othr>');
    lines.push(el('Id', escapeXml(creditor.creditorId), '              '));
    lines.push('              <SchmeNm>');
    lines.push(el('Prtry', 'SEPA', '                '));
    lines.push('              </SchmeNm>');
    lines.push('            </Othr>');
    lines.push('          </PrvtId>');
    lines.push('        </Id>');
    lines.push('      </CdtrSchmeId>');

    for (const t of txs) {
      lines.push('      <DrctDbtTxInf>');
      lines.push('        <PmtId>');
      lines.push(el('EndToEndId', escapeXml(t.endToEndId), '          '));
      lines.push('        </PmtId>');
      lines.push(`        <InstdAmt Ccy="EUR">${formatCents(t.amountCents)}</InstdAmt>`);
      lines.push('        <DrctDbtTx>');
      lines.push('          <MndtRltdInf>');
      lines.push(el('MndtId', escapeXml(t.mandateId), '            '));
      lines.push(el('DtOfSgntr', t.mandateDate, '            '));
      lines.push(el('AmdmntInd', 'false', '            '));
      lines.push('          </MndtRltdInf>');
      lines.push('        </DrctDbtTx>');
      lines.push('        <DbtrAgt>');
      lines.push(agent(t.bic, v.bicTag, '        '));
      lines.push('        </DbtrAgt>');
      lines.push('        <Dbtr>');
      lines.push(el('Nm', escapeXml(t.name), '          '));
      lines.push('        </Dbtr>');
      lines.push('        <DbtrAcct>');
      lines.push('          <Id>');
      lines.push(el('IBAN', t.iban, '            '));
      lines.push('          </Id>');
      lines.push('        </DbtrAcct>');
      if (t.concept) {
        lines.push('        <RmtInf>');
        lines.push(el('Ustrd', escapeXml(t.concept), '          '));
        lines.push('        </RmtInf>');
      }
      lines.push('      </DrctDbtTxInf>');
    }
    lines.push('    </PmtInf>');
  }
  lines.push('  </CstmrDrctDbtInitn>');
  lines.push('</Document>');
  return `${lines.join('\n')}\n`;
}

export function newMessageId(now = new Date(), random = Math.random) {
  const stamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand = Array.from({ length: 8 }, () => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(random() * 34)]).join('');
  return `RL-${stamp}-${rand}`;
}
