/**
 * search-builder-benchmark.mjs — SB5 CLI for the Search Builder intelligence benchmark.
 * Runs the hand-authored gold cases + 1,000 generated corpus cases through the engine
 * and prints per-dimension pass rates, the overall score, and the worst failures.
 * Exits non-zero on regression (overall < 0.97 or any dimension < 0.95) so it can gate.
 *
 * RUN: npm run test:search-builder-intelligence   (offline; no network)
 */
import { runBenchmark } from '../src/research-engine/searchBuilder/searchBuilderBenchmark.js';
import { GOLD_CASES } from '../src/research-engine/searchBuilder/__fixtures__/searchBuilderGoldCases.js';
import { generateCorpus } from '../src/research-engine/searchBuilder/__fixtures__/searchBuilderCorpus.js';

const N = Number(process.env.SB_CORPUS_SIZE || 1000);
const cases = [...GOLD_CASES, ...generateCorpus(N)];
const report = runBenchmark(cases, { maxFailures: 30 });

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const bar = (x) => '█'.repeat(Math.round(x * 20)).padEnd(20, '·');

console.log('\n  Search Builder Intelligence Benchmark');
console.log('  ─────────────────────────────────────');
console.log(`  cases:        ${report.total}  (${GOLD_CASES.length} gold + ${N} generated)`);
console.log(`  overall pass: ${bar(report.overall.rate)} ${pct(report.overall.rate)}  (${report.overall.passed}/${report.total})\n`);
console.log('  dimension              rate    (passed/applicable)');
for (const [dim, v] of Object.entries(report.dimensions)) {
  console.log(`  ${dim.padEnd(20)} ${bar(v.rate)} ${pct(v.rate).padStart(6)}  (${v.passed}/${v.applicable})`);
}

if (report.failures.length) {
  console.log(`\n  worst failures (showing ${report.failures.length}):`);
  for (const f of report.failures) console.log(`   • [${f.dimension}] ${f.caseId} — ${f.detail}`);
}

const dimMin = Math.min(...Object.values(report.dimensions).map((v) => v.rate));
const ok = report.overall.rate >= 0.97 && dimMin >= 0.95;
console.log(`\n  ${ok ? '✓ PASS' : '✗ FAIL'} — overall ${pct(report.overall.rate)}, weakest dimension ${pct(dimMin)}\n`);
process.exit(ok ? 0 : 1);
