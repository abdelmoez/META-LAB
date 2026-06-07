/**
 * validation.test.js
 * Unit tests for validateStudy, checkPoolability, and analysisTypeWarnings.
 */

import { describe, it, expect } from 'vitest';
import {
  validateStudy,
  checkPoolability,
  analysisTypeWarnings,
} from '../../src/research-engine/validation/study-validator.js';
import { mkStudy } from '../../src/research-engine/project-model/defaults.js';

// ── Helper factories ──────────────────────────────────────────────────────────

function makeStudy(overrides = {}) {
  return { ...mkStudy(), ...overrides };
}

function makePoolableStudy(id, es, lo, hi, esType = 'OR') {
  return makeStudy({ id, author: `Author${id}`, year: '2020', es, lo, hi, esType });
}

// ── validateStudy ─────────────────────────────────────────────────────────────
describe('validateStudy', () => {
  it('returns empty array for a study with no fields filled', () => {
    // A minimal empty study has warnings for no author/year/outcome
    // but no hard errors
    const s = mkStudy();
    const issues = validateStudy(s);
    const errors = issues.filter(i => i.sev === 'error');
    expect(errors).toHaveLength(0);
  });

  it('warns when author is missing', () => {
    const s = makeStudy({ author: '' });
    const issues = validateStudy(s);
    expect(issues.some(i => i.field === 'author' && i.sev === 'warn')).toBe(true);
  });

  it('warns when year is missing', () => {
    const s = makeStudy({ year: '' });
    const issues = validateStudy(s);
    expect(issues.some(i => i.field === 'year' && i.sev === 'warn')).toBe(true);
  });

  it('warns when outcome is missing', () => {
    const s = makeStudy({ outcome: '' });
    const issues = validateStudy(s);
    expect(issues.some(i => i.field === 'outcome' && i.sev === 'warn')).toBe(true);
  });

  it('no errors for a fully populated study (es within CI)', () => {
    const s = makeStudy({
      author: 'Smith', year: '2020', outcome: 'Mortality',
      es: '0.5', lo: '0.1', hi: '0.9', esType: 'OR',
    });
    const issues = validateStudy(s);
    const errors = issues.filter(i => i.sev === 'error');
    expect(errors).toHaveLength(0);
  });

  it('error when lo > hi', () => {
    const s = makeStudy({ es: '0.5', lo: '0.9', hi: '0.1', esType: 'OR' });
    const issues = validateStudy(s);
    expect(issues.some(i => i.sev === 'error' && i.field === 'lo')).toBe(true);
  });

  it('error when es lies outside its CI (es < lo)', () => {
    const s = makeStudy({ es: '-0.5', lo: '0.1', hi: '0.9', esType: 'OR' });
    const issues = validateStudy(s);
    expect(issues.some(i => i.sev === 'error' && i.field === 'es')).toBe(true);
  });

  it('error when es lies outside its CI (es > hi)', () => {
    const s = makeStudy({ es: '1.5', lo: '0.1', hi: '0.9', esType: 'OR' });
    const issues = validateStudy(s);
    expect(issues.some(i => i.sev === 'error' && i.field === 'es')).toBe(true);
  });

  it('error when SD is negative', () => {
    const s = makeStudy({ sdExp: '-2', esType: 'SMD' });
    const issues = validateStudy(s);
    expect(issues.some(i => i.sev === 'error' && i.field === 'sdExp')).toBe(true);
  });

  it('error when events exceed total in PROP', () => {
    const s = makeStudy({ esType: 'PROP', events: '110', total: '100' });
    const issues = validateStudy(s);
    expect(issues.some(i => i.sev === 'error' && i.field === 'events')).toBe(true);
  });

  it('error when nExp + nCtrl does not match n', () => {
    const s = makeStudy({ n: '100', nExp: '60', nCtrl: '50' });
    const issues = validateStudy(s);
    expect(issues.some(i => i.sev === 'error' && i.field === 'n')).toBe(true);
  });

  it('no error when nExp + nCtrl matches n', () => {
    const s = makeStudy({ n: '100', nExp: '50', nCtrl: '50' });
    const issues = validateStudy(s);
    const nErrors = issues.filter(i => i.field === 'n' && i.sev === 'error');
    expect(nErrors).toHaveLength(0);
  });

  it('warns when es is set but no CI provided', () => {
    const s = makeStudy({ es: '0.5', lo: '', hi: '' });
    const issues = validateStudy(s);
    expect(issues.some(i => i.sev === 'warn' && i.field === 'lo')).toBe(true);
  });

  it('warns when CI is filled but no es', () => {
    const s = makeStudy({ es: '', lo: '0.1', hi: '0.9' });
    const issues = validateStudy(s);
    expect(issues.some(i => i.sev === 'warn' && i.field === 'es')).toBe(true);
  });

  it('warns when es is set but esType is missing', () => {
    const s = makeStudy({ es: '0.5', lo: '0.1', hi: '0.9', esType: '' });
    const issues = validateStudy(s);
    expect(issues.some(i => i.sev === 'warn' && i.field === 'esType')).toBe(true);
  });

  it('warns when OR/RR 2×2 table is partially filled', () => {
    const s = makeStudy({ esType: 'OR', a: '10', b: '20' }); // c, d missing
    const issues = validateStudy(s);
    expect(issues.some(i => i.sev === 'warn' && i.field === 'a')).toBe(true);
  });

  it('warns when diagnostic cells are partial', () => {
    const s = makeStudy({ tp: '80', fp: '10' }); // fn, tn missing
    const issues = validateStudy(s);
    expect(issues.some(i => i.sev === 'warn' && i.field === 'tp')).toBe(true);
  });

  it('warns for "noconfirm" flag', () => {
    const s = makeStudy({ flags: ['noconfirm'] });
    const issues = validateStudy(s);
    expect(issues.some(i => i.field === 'flags' && i.sev === 'warn')).toBe(true);
  });

  it('warns for "highrisk" flag', () => {
    const s = makeStudy({ flags: ['highrisk'] });
    const issues = validateStudy(s);
    expect(issues.some(i => i.field === 'flags' && i.sev === 'warn')).toBe(true);
  });

  it('warns for converted study with no source', () => {
    const s = makeStudy({ converted: true, source: '' });
    const issues = validateStudy(s);
    expect(issues.some(i => i.field === 'source' && i.sev === 'warn')).toBe(true);
  });

  it('warns for converted study with no conversion record', () => {
    const s = makeStudy({ converted: true, conversions: [] });
    const issues = validateStudy(s);
    expect(issues.some(i => i.field === 'converted' && i.sev === 'warn')).toBe(true);
  });
});

// ── checkPoolability ──────────────────────────────────────────────────────────
describe('checkPoolability', () => {
  const twoValidOR = [
    makePoolableStudy('a', '0.5', '0.1', '0.9', 'OR'),
    makePoolableStudy('b', '0.3', '-0.1', '0.7', 'OR'),
  ];

  it('returns ok:false with blocker when fewer than 2 valid studies', () => {
    const res = checkPoolability([]);
    expect(res.ok).toBe(false);
    expect(res.blockers.length).toBeGreaterThan(0);
  });

  it('returns ok:false with blocker for 1 valid study', () => {
    const res = checkPoolability([makePoolableStudy('a', '0.5', '0.1', '0.9')]);
    expect(res.ok).toBe(false);
    expect(res.blockers.length).toBeGreaterThan(0);
  });

  it('returns ok:true for 2+ valid studies with same esType', () => {
    const res = checkPoolability(twoValidOR);
    expect(res.ok).toBe(true);
    expect(res.blockers).toHaveLength(0);
  });

  it('returns ok:false when esTypes are mixed', () => {
    const mixed = [
      makePoolableStudy('a', '0.5', '0.1', '0.9', 'OR'),
      makePoolableStudy('b', '0.3', '0.0', '0.6', 'SMD'),
    ];
    const res = checkPoolability(mixed);
    expect(res.ok).toBe(false);
    expect(res.blockers.some(b => b.includes('Mixed effect measures'))).toBe(true);
  });

  it('includes types in the result', () => {
    const res = checkPoolability(twoValidOR);
    expect(res.types).toContain('OR');
  });

  it('valid field contains only studies with parseable es/lo/hi', () => {
    const withEmpty = [
      ...twoValidOR,
      makeStudy({ id: 'x', es: '', lo: '', hi: '' }),
    ];
    const res = checkPoolability(withEmpty);
    expect(res.valid).toHaveLength(2);
  });

  it('warns when designs are mixed', () => {
    const mixed = [
      makePoolableStudy('a', '0.5', '0.1', '0.9', 'OR'),
      { ...makePoolableStudy('b', '0.3', '-0.1', '0.7', 'OR'), design: 'cohort' },
    ];
    const res = checkPoolability(mixed);
    expect(res.warnings.some(w => w.includes('Mixed study designs'))).toBe(true);
  });

  it('warns when time points are mixed', () => {
    const mixed = [
      { ...makePoolableStudy('a', '0.5', '0.1', '0.9', 'OR'), timepoint: '6 months' },
      { ...makePoolableStudy('b', '0.3', '-0.1', '0.7', 'OR'), timepoint: '12 months' },
    ];
    const res = checkPoolability(mixed);
    expect(res.warnings.some(w => w.includes('time points'))).toBe(true);
  });

  it('blockers stop pooling (ok === false)', () => {
    const withNoconfirm = [
      ...twoValidOR.map(s => ({ ...s, flags: ['noconfirm'] })),
    ];
    const res = checkPoolability(withNoconfirm);
    expect(res.ok).toBe(false);
    expect(res.blockers.some(b => b.includes('do not pool'))).toBe(true);
  });

  it('result has composition object', () => {
    const res = checkPoolability(twoValidOR);
    expect(res.composition).toBeDefined();
    expect(res.composition.total).toBe(2);
  });
});

// ── analysisTypeWarnings ──────────────────────────────────────────────────────
describe('analysisTypeWarnings', () => {
  it('returns empty array for studies with no es set', () => {
    const s = [makeStudy({ es: '', esType: 'OR' })];
    expect(analysisTypeWarnings(s)).toEqual([]);
  });

  it('returns error when PROP study has two-arm data (a/b/c/d)', () => {
    const s = [makeStudy({
      es: '0.5', esType: 'PROP',
      a: '10', b: '20', c: '5', d: '25',
    })];
    const issues = analysisTypeWarnings(s);
    expect(issues.some(i => i.sev === 'error')).toBe(true);
  });

  it('warns when OR study has only single-arm data (events/total) but no 2×2', () => {
    const s = [makeStudy({
      es: '0.5', esType: 'OR',
      events: '30', total: '100',
      a: '', b: '', c: '', d: '',
    })];
    const issues = analysisTypeWarnings(s);
    expect(issues.some(i => i.sev === 'warn')).toBe(true);
  });

  it('warns when SMD/MD study has 2×2 table but no continuous data', () => {
    const s = [makeStudy({
      es: '0.5', esType: 'SMD',
      a: '30', b: '70', c: '20', d: '80',
    })];
    const issues = analysisTypeWarnings(s);
    expect(issues.some(i => i.sev === 'warn')).toBe(true);
  });

  it('warns when diagnostic cells present but esType is not DIAG', () => {
    const s = [makeStudy({
      es: '0.5', esType: 'OR',
      tp: '80', fp: '10', fn: '20', tn: '90',
    })];
    const issues = analysisTypeWarnings(s);
    expect(issues.some(i => i.sev === 'warn')).toBe(true);
  });

  it('no warnings for a clean OR study with correct 2×2 data', () => {
    const s = [makeStudy({
      es: '0.5', esType: 'OR',
      a: '30', b: '70', c: '20', d: '80',
    })];
    const issues = analysisTypeWarnings(s);
    expect(issues).toHaveLength(0);
  });

  it('no warnings for a clean DIAG study', () => {
    const s = [makeStudy({
      es: '2.0', esType: 'DIAG',
      tp: '80', fp: '10', fn: '20', tn: '90',
    })];
    const issues = analysisTypeWarnings(s);
    expect(issues).toHaveLength(0);
  });
});
