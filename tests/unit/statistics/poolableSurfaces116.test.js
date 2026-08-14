/**
 * poolableSurfaces116.test.js — 116.md §41/§46 (r2).
 *
 * §41 made raw proportion rows (events/total, no stored es) poolable by deriving
 * es/lo/hi at the analysis boundary. That view reached `runMeta` and the outcome
 * enumerators — but several COUNTING surfaces kept scanning for a STORED `es`, so they
 * disagreed with the pool their own document/rail was reporting: the PRISMA
 * "Studies in meta-analysis" box read "[not recorded]" beside a k=3 synthesis, the
 * readiness list called the reproducibility package incomplete while its own analysis
 * item said k=3, and the live fact `studies.inAnalysis` resolved to a MISSING
 * placeholder in a sentence whose neighbouring `analysis.k` token printed 3.
 *
 * Every assertion here is an AGREEMENT between two surfaces over the SAME rows — never
 * a magic number — because that is the property §46 exists to keep true. `poolableRow.js`
 * is the one predicate all of them now read.
 *
 * PURE — no React, no jsdom.
 */
import { describe, it, expect } from 'vitest';
import { rowHasEffect, rowIsPoolable } from '../../../src/research-engine/statistics/poolableRow.js';
import { runMeta } from '../../../src/research-engine/statistics/monolithStats.js';
import { computeProjectProgress } from '../../../src/research-engine/progress/projectProgress.js';
import { computePrismaCounts } from '../../../src/research-engine/manuscript/prismaCounts.js';
import { computeReadiness, smartInsights } from '../../../src/research-engine/manuscript/readiness.js';
import { primaryAnalysis, generateLimitations } from '../../../src/research-engine/manuscript/draft.js';
import { buildRobTable, buildSummaryOfFindingsTable } from '../../../src/research-engine/manuscript/tables.js';
import { buildFactContext, resolveFacts, renderFacts } from '../../../src/research-engine/manuscript/factTokens.js';

/** The §41 population, exactly as extraction leaves it: raw counts, no stored effect. */
const rawProp = (over = {}) => ({
  id: 'r1', author: 'Smith', year: '2024', outcome: 'Diagnostic yield', timepoint: '',
  esType: 'PROP', es: '', lo: '', hi: '', events: '23', total: '59',
  design: '', rob: {}, ...over,
});
const RAW_ROWS = [
  rawProp({ id: 'a', author: 'Alpha', events: '23', total: '59' }),
  rawProp({ id: 'b', author: 'Bravo', events: '31', total: '80' }),
  rawProp({ id: 'c', author: 'Charlie', events: '12', total: '44' }),
];
/** The same review with its PRISMA flow filled in by hand — isolates the count-side
 *  predicate from "the project simply has no PRISMA numbers". */
const FULL_PRISMA = { dbs: '120', reg: '', other: '', dedupe: '20', screened: '100', excTA: '90', excFull: '7', included: '3', reasons: [] };
const project = (over = {}) => ({
  id: 'p1', name: 'Raw proportion review', studies: RAW_ROWS,
  prisma: {}, pico: {}, search: {}, reportChecked: {}, ...over,
});

const K = () => runMeta(RAW_ROWS, 'random').k;

describe('116.md §46 (r2) — the row predicate IS the pool predicate', () => {
  it('rowHasEffect / rowIsPoolable count exactly the rows runMeta pools', () => {
    expect(RAW_ROWS.filter(rowHasEffect)).toHaveLength(K());
    expect(RAW_ROWS.filter(rowIsPoolable)).toHaveLength(K());
    expect(K()).toBe(3);
  });
});

describe('116.md §46 (r2) — the workflow rail agrees with the pool', () => {
  it('extraction is done and every pooled step is done for a raw-proportion review', () => {
    const steps = Object.fromEntries(computeProjectProgress(project()).steps.map((s) => [s.id, s.status]));
    expect(steps.extraction).toBe('done');
    expect(steps.analysis).toBe('done');
    expect(steps.forest).toBe('done');
  });
});

describe('116.md §46 (r2) — the manuscript counts agree with the manuscript synthesis', () => {
  it('PRISMA "studies in meta-analysis" equals the Summary-of-Findings study count', () => {
    const p = project({ prisma: FULL_PRISMA });
    const counts = computePrismaCounts(p, {}).counts;
    const sof = buildSummaryOfFindingsTable(p);
    expect(sof.rows).toHaveLength(1);
    expect(String(counts.includedQuant)).toBe(String(sof.rows[0].nStudies));
    expect(counts.includedQuant).toBe(primaryAnalysis(p).result.k);
  });

  it('the last-resort "included" box counts derived rows too', () => {
    // No PRISMA data at all → the stored-es scan was the only source, and it read 0,
    // so the box printed nothing while the abstract claimed "3 studies were included".
    const counts = computePrismaCounts(project(), {}).counts;
    expect(counts.included).toBe(K());
    expect(counts.includedQuant).toBe(K());
  });

  it('readiness never calls the reproducibility package incomplete while the analysis is complete', () => {
    const items = Object.fromEntries(
      computeReadiness(project({ prisma: FULL_PRISMA }), { sections: {} }).items.map((i) => [i.key, i]),
    );
    expect(items.prisma.complete).toBe(true);
    expect(items.analysis.complete).toBe(true);
    expect(items.analysis.detail).toBe(`k=${K()}`);
    expect(items.reproducibility.complete).toBe(true);
  });

  it('smart insights see the rows being pooled (missing design is reported, not skipped)', () => {
    const msgs = smartInsights(project(), { sections: {} }).filter((i) => i.key === 'extraction').map((i) => i.message);
    expect(msgs.some((m) => /missing study design/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith(`${K()} included studies`))).toBe(true);
  });

  it('the RoB-coverage warning counts the pooled studies as included', () => {
    const t = buildRobTable(project({
      studies: RAW_ROWS.map((s, i) => (i === 0 ? { ...s, rob: { d1: 'Low' } } : s)),
    }));
    expect(t.warnings.join(' ')).toContain(`of ${K()} included studies have no risk-of-bias assessment`);
  });

  it('the drafted limitations name the un-assessed studies that actually contributed', () => {
    const md = generateLimitations(project(), { primary: primaryAnalysis(project()) });
    expect(md).toContain(`${K()} included studies have no risk-of-bias assessment`);
  });
});

describe('116.md §46 (r2) — the live fact layer cannot contradict itself', () => {
  it('studies.inAnalysis resolves whenever analysis.k does', () => {
    const p = project();
    const opts = { primary: primaryAnalysis(p) };
    const ctx = buildFactContext(p, opts);
    expect(ctx.analysis.k).toBe(K());
    expect(ctx.studies.withEffect).toBe(K());
    const resolved = resolveFacts(p, { ...opts, factContext: ctx });
    const text = renderFacts('We pooled [[fact:studies.inAnalysis]] studies (k = [[fact:analysis.k]]).', resolved);
    expect(text).toContain(`We pooled ${K()} studies (k = ${K()}).`);
    expect(text).not.toMatch(/not yet available/i);
  });
});

describe('116.md §46 (r2) — nothing changes for stored-effect rows (byte-stability)', () => {
  const stored = [
    { id: 's1', author: 'Delta', year: '2020', outcome: 'Pain', timepoint: '', esType: 'SMD', es: '0.4', lo: '0.1', hi: '0.7', design: 'RCT', rob: {} },
    { id: 's2', author: 'Echo', year: '2021', outcome: 'Pain', timepoint: '', esType: 'SMD', es: '0.2', lo: '-0.1', hi: '0.5', design: 'RCT', rob: {} },
  ];
  it('a classic review counts identically under the new predicate', () => {
    expect(stored.filter(rowHasEffect)).toHaveLength(2);
    const counts = computePrismaCounts({ ...project(), studies: stored }, {}).counts;
    expect(counts.includedQuant).toBe(2);
  });
  it('an unextracted row still counts for nothing', () => {
    const blank = { id: 'z', author: 'Zulu', year: '2019', outcome: 'Pain', esType: 'PROP', es: '', lo: '', hi: '', events: '', total: '' };
    expect(rowHasEffect(blank)).toBe(false);
    expect(rowIsPoolable(blank)).toBe(false);
  });
  it('invalid raw counts are not silently rescued', () => {
    expect(rowHasEffect(rawProp({ events: '80', total: '59' }))).toBe(false);
    expect(rowHasEffect(rawProp({ total: '0' }))).toBe(false);
    expect(rowHasEffect(rawProp({ esType: 'OR' }))).toBe(false);
  });
});
