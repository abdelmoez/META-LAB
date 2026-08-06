/**
 * strategyShapes.test.js — 100.md §19. "Verify that the generated query remains
 * syntactically valid for every supported database" across the strategy shapes the
 * spec enumerates: one / two / three-or-more concepts, free text only, controlled
 * vocabulary only, mixed, and the no-equivalent-vocabulary case.
 *
 * Structural validation (not goldens — the per-database golden files own exact
 * strings): every result must be a non-empty runnable string with balanced
 * parentheses and quotes, no dangling or doubled operators, and no leftover
 * placeholder from a term the compiler failed to render.
 */
import { describe, it, expect } from 'vitest';
import { compileStrategy, listCompilerDatabases, capabilitiesFor } from '../../../src/research-engine/searchBuilder/compilers/index.js';

const DBS = listCompilerDatabases();

const ft = (text, extra = {}) => ({ text, type: 'freetext', field: 'tiab', ...extra });
const cv = (text, heading, extra = {}) => ({ text, type: 'controlled', field: 'tiab', vocab: { mesh: heading, meshUI: 'D000001' }, ...extra });
const grp = (id, label, terms, op = 'AND') => ({ id, label, op, terms });

/** Structural validity checks a runnable Boolean string must pass in any grammar. */
function expectRunnable(query, dbId) {
  const where = `[${dbId}]`;
  expect(query, where).toBeTypeOf('string');
  expect(query.length, where).toBeGreaterThan(0);

  // Balanced parentheses, never closing before opening.
  let depth = 0;
  for (const ch of query) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    expect(depth, `${where} parenthesis closed before it opened in: ${query}`).toBeGreaterThanOrEqual(0);
  }
  expect(depth, `${where} unbalanced parentheses in: ${query}`).toBe(0);

  // Balanced phrase delimiters for whichever grammar this database uses.
  const cap = capabilitiesFor(dbId);
  const quote = cap.phrase === 'single' ? "'" : '"';
  expect((query.split(quote).length - 1) % 2, `${where} unbalanced ${quote} in: ${query}`).toBe(0);

  // No dangling / doubled / empty operators, and no empty groups.
  expect(query, where).not.toMatch(/\b(AND|OR|NOT)\s*$/);
  expect(query, where).not.toMatch(/^\s*(AND|OR|NOT)\b/);
  expect(query, where).not.toMatch(/\b(AND|OR)\s+(AND|OR)\b/);
  expect(query, where).not.toMatch(/\(\s*\)/);
  expect(query, where).not.toMatch(/\(\s*(AND|OR)\b/);
  expect(query, where).not.toMatch(/\b(AND|OR)\s*\)/);
  // A term the compiler could not render would leave one of these behind.
  expect(query, where).not.toContain('undefined');
  expect(query, where).not.toContain('[object Object]');
}

const SHAPES = {
  'one concept, free text only': {
    concepts: [grp('c1', 'Hypertension', [ft('hypertension'), ft('high blood pressure')])],
    filters: {},
  },
  'one concept, controlled vocabulary only': {
    concepts: [grp('c1', 'Hypertension', [cv('high blood pressure', 'Hypertension')])],
    filters: {},
  },
  'one concept, mixed free text + vocabulary': {
    concepts: [grp('c1', 'Diabetes', [cv('t2d', 'Diabetes Mellitus, Type 2'), ft('type 2 diabetes'), ft('T2DM')])],
    filters: {},
  },
  'two concepts (AND)': {
    concepts: [
      grp('c1', 'Diabetes', [cv('t2d', 'Diabetes Mellitus, Type 2'), ft('type 2 diabetes')]),
      grp('c2', 'Metformin', [ft('metformin'), ft('glucophage')]),
    ],
    filters: {},
  },
  'three concepts, mixed AND/OR chain': {
    concepts: [
      grp('c1', 'Heart failure', [cv('hf', 'Heart Failure'), ft('cardiac failure')], 'AND'),
      grp('c2', 'SGLT2', [ft('sglt2', { truncate: true }), ft('empagliflozin')], 'OR'),
      grp('c3', 'Mortality', [cv('death', 'Mortality'), ft('death')]),
    ],
    filters: { dateFrom: '2010', dateTo: '2025', languages: ['en'], pubTypes: ['Randomized Controlled Trial'] },
  },
  'four concepts, every field scope, no-explode heading': {
    concepts: [
      grp('c1', 'CKD', [cv('ckd', 'Renal Insufficiency, Chronic', { noExplode: true })]),
      grp('c2', 'Title only', [ft('dialysis', { field: 'ti' })]),
      grp('c3', 'Abstract only', [ft('albuminuria', { field: 'ab' })]),
      grp('c4', 'Anywhere', [ft('outcome', { field: 'all' })]),
    ],
    filters: {},
  },
  'no equivalent vocabulary available (a hand-typed heading)': {
    concepts: [grp('c1', 'Made-up', [{ text: 'Widget Disease', type: 'controlled', field: 'tiab' }])],
    filters: {},
  },
};

describe('100.md §19 — every strategy shape compiles to valid syntax in all 16 databases', () => {
  for (const [name, strategy] of Object.entries(SHAPES)) {
    it(`${name}`, () => {
      for (const dbId of DBS) expectRunnable(compileStrategy(strategy, dbId).query, dbId);
    });
  }

  it('a subject heading NEVER produces another database\'s vocabulary syntax', () => {
    const s = SHAPES['one concept, controlled vocabulary only'];
    // Only the four MeSH-indexed databases may emit a subject-heading clause at all.
    const meshDbs = new Set(['pubmed', 'pmc', 'cochrane', 'europepmc']);
    for (const dbId of DBS) {
      const q = compileStrategy(s, dbId).query;
      if (meshDbs.has(dbId)) continue;
      expect(q, `[${dbId}] fabricated a subject heading: ${q}`)
        .not.toMatch(/\[Mesh|\[MeSH Terms\]|\[mh |MESH:|\/exp|\/de\b|\(MH |DE "|INDEXTERMS\(|MAINSUBJECT/);
    }
  });

  it('an empty strategy never compiles to a runnable string in any database', () => {
    for (const dbId of DBS) {
      const r = compileStrategy({ concepts: [], filters: { dateFrom: '2010', languages: ['en'] } }, dbId);
      expect(r.query, `[${dbId}]`).toBe('');
      expect(r.filtersApplied, `[${dbId}]`).toBe(false);
    }
  });
});
