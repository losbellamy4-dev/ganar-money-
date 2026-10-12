#!/usr/bin/env node
// Calcula el ranking de oportunidades a partir de research/opportunities.json.
// Uso: node scripts/score-opportunities.mjs [--markdown]
// Determinista: mismas entradas => mismas salidas.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'research/opportunities.json'), 'utf8'));

export function weightedScore(scores, weights) {
  let total = 0;
  let weightSum = 0;
  for (const [id, w] of Object.entries(weights)) {
    if (!(id in scores)) throw new Error(`Falta la puntuación del criterio ${id}`);
    const s = scores[id];
    if (!Number.isInteger(s) || s < 1 || s > 5) throw new Error(`Puntuación fuera de rango (${id}=${s})`);
    total += s * w;
    weightSum += w;
  }
  // Normaliza a escala 0-100 (1 => 0, 5 => 100).
  return Math.round(((total / weightSum - 1) / 4) * 1000) / 10;
}

function rank(weights) {
  return data.opportunities
    .map((o) => ({ id: o.id, name: o.name, score: weightedScore(o.scores, weights) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

const baseWeights = Object.fromEntries(data.criteria.map((c) => [c.id, c.weight]));
const weightSum = Object.values(baseWeights).reduce((a, b) => a + b, 0);
if (weightSum !== 100) throw new Error(`Los pesos base deben sumar 100 (suman ${weightSum})`);

const scenarios = { base: baseWeights };
for (const [name, w] of Object.entries(data.alternative_weightings)) {
  scenarios[name] = w === 'all_equal' ? Object.fromEntries(data.criteria.map((c) => [c.id, 1])) : w;
}

const results = Object.fromEntries(Object.entries(scenarios).map(([k, w]) => [k, rank(w)]));

if (process.argv.includes('--markdown')) {
  const base = results.base;
  const others = Object.keys(results).filter((k) => k !== 'base');
  const pos = (scenario, id) => results[scenario].findIndex((r) => r.id === id) + 1;
  console.log(`| # | Oportunidad | Puntuación base (0-100) | ${others.map((o) => `Posición con «${o}»`).join(' | ')} |`);
  console.log(`|---|---|---|${others.map(() => '---').join('|')}|`);
  base.forEach((r, i) => {
    console.log(`| ${i + 1} | ${r.name} | ${r.score} | ${others.map((o) => pos(o, r.id)).join(' | ')} |`);
  });
} else {
  for (const [k, list] of Object.entries(results)) {
    console.log(`\n== Escenario: ${k} ==`);
    list.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.score.toFixed(1).padStart(5)}  ${r.id}`));
  }
}
