/**
 * 116.md §16/§17 — exclusion-reason grouping + conservative display formatting.
 *
 * Pins:
 *  1. groupKey: trim + collapse internal whitespace + casefold (grouping ONLY).
 *  2. displayReason: uppercase char 0 ONLY when the first word is all-lowercase;
 *     NEVER lowercase anything (the exact §16 examples, incl. the "No mri outcome"
 *     anti-example).
 *  3. preferredDisplay: most frequent original casing wins, then sentence-case.
 *  4. derive.js wiring: mixed-case duplicates group to ONE row (§21 Scenario C),
 *     stored strings untouched, same rules for not-retrieved + removed-other.
 */
import { describe, it, expect } from 'vitest';
import { groupKey, displayReason, preferredDisplay } from '../../../src/research-engine/prisma/reasonFormat.js';
import { derivePrismaFlow } from '../../../src/research-engine/prisma/derive.js';

describe('groupKey (§17) — grouping only, never display', () => {
  it('collapses case, edge whitespace and internal double spaces onto one key', () => {
    const k = groupKey('Wrong population');
    expect(groupKey('wrong population')).toBe(k);
    expect(groupKey('Wrong population ')).toBe(k);
    expect(groupKey('  Wrong  population')).toBe(k);
    expect(groupKey('WRONG POPULATION')).toBe(k);
  });

  it('does NOT merge semantically different reasons', () => {
    expect(groupKey('Wrong population')).not.toBe(groupKey('Wrong intervention'));
    expect(groupKey('No MRI outcome')).not.toBe(groupKey('No CT outcome'));
  });

  it('is empty for blank/nullish input', () => {
    expect(groupKey('')).toBe('');
    expect(groupKey('   ')).toBe('');
    expect(groupKey(null)).toBe('');
    expect(groupKey(undefined)).toBe('');
  });
});

describe('displayReason (§16) — the exact directive examples', () => {
  it('wrong population → Wrong population', () => {
    expect(displayReason('wrong population')).toBe('Wrong population');
  });

  it('no MRI outcome → No MRI outcome (never "No mri outcome")', () => {
    expect(displayReason('no MRI outcome')).toBe('No MRI outcome');
    expect(displayReason('no MRI outcome')).not.toBe('No mri outcome');
  });

  it('never lowercases anything — acronyms, drug names, deliberate casing survive', () => {
    expect(displayReason('Wrong population')).toBe('Wrong population');
    expect(displayReason('MRI-negative cohort')).toBe('MRI-negative cohort');
    expect(displayReason('mRNA vaccine only')).toBe('mRNA vaccine only'); // first word not all-lowercase
    expect(displayReason('pH imbalance')).toBe('pH imbalance');
    expect(displayReason('used TNF-alpha inhibitors')).toBe('Used TNF-alpha inhibitors');
  });

  it('leaves a non-letter first character alone', () => {
    expect(displayReason('18-month follow-up only')).toBe('18-month follow-up only');
  });

  it('collapses whitespace for DISPLAY without touching stored strings', () => {
    const stored = '  wrong   population ';
    expect(displayReason(stored)).toBe('Wrong population');
    expect(stored).toBe('  wrong   population '); // strings are immutable, but the intent is pinned
  });

  it('is empty for blank input', () => {
    expect(displayReason('')).toBe('');
    expect(displayReason(null)).toBe('');
  });
});

describe('preferredDisplay — most frequent original casing wins', () => {
  it('picks the majority variant, then sentence-cases it', () => {
    expect(preferredDisplay(['wrong population', 'wrong population', 'Wrong Population']))
      .toBe('Wrong population');
    expect(preferredDisplay(['Wrong Population', 'Wrong Population', 'wrong population']))
      .toBe('Wrong Population');
  });

  it('ties go to the first variant seen', () => {
    expect(preferredDisplay(['no MRI outcome', 'No MRI outcome'])).toBe('No MRI outcome');
  });

  it('ignores blanks', () => {
    expect(preferredDisplay(['', '  ', 'wrong dose'])).toBe('Wrong dose');
    expect(preferredDisplay([])).toBe('');
  });
});

describe('derive.js wiring (§21 Scenario C shape)', () => {
  let seq = 0;
  const rec = (o = {}) => ({ id: `r${seq++}`, origin: 'search', sourceDb: 'PubMed', ...o });
  const excluded = (reason) => rec({
    screeningDecision: 'include', soughtRetrieval: true, retrieved: true,
    fullTextDecision: 'exclude', exclusionReason: reason,
  });

  it('groups case/space variants of one reason into ONE row with a clean label', () => {
    const f = derivePrismaFlow([
      ...Array.from({ length: 3 }, () => excluded('wrong population')),
      excluded('Wrong population'),
      excluded('Wrong  population '),
      ...Array.from({ length: 3 }, () => excluded('Wrong intervention')),
      excluded('no MRI outcome'),
    ]);
    const rows = Object.fromEntries(f.exclusionReasons.map((r) => [r.label, r.n]));
    expect(rows['Wrong population']).toBe(5);    // 3 + 1 + 1 — one row, not three
    expect(rows['Wrong intervention']).toBe(3);
    expect(rows['No MRI outcome']).toBe(1);      // sentence-cased, acronym intact
    expect(f.exclusionReasons).toHaveLength(3);
    // ids still answer "which records created this number?" (§12)
    expect(f.exclusionReasons.find((r) => r.label === 'Wrong population').ids).toHaveLength(5);
  });

  it('keeps the per-arm rollups on the same rules', () => {
    const f = derivePrismaFlow([
      excluded('wrong dose'),
      { ...excluded('Wrong Dose'), origin: 'mining' },
    ]);
    expect(f.exclusionReasonsByArm.db.map((r) => r.label)).toEqual(['Wrong dose']);
    expect(f.exclusionReasonsByArm.other.map((r) => r.label)).toEqual(['Wrong Dose']);
  });

  it('normalizes not-retrieved reasons identically', () => {
    const f = derivePrismaFlow([
      rec({ screeningDecision: 'include', soughtRetrieval: true, retrieved: false, notRetrievedReason: 'no reply from authors' }),
      rec({ screeningDecision: 'include', soughtRetrieval: true, retrieved: false, notRetrievedReason: 'No reply from authors' }),
    ]);
    expect(f.notRetrievedReasons).toHaveLength(1);
    expect(f.notRetrievedReasons[0].n).toBe(2);
  });

  it('keeps the unrecorded-reason row honest', () => {
    const f = derivePrismaFlow([excluded(''), excluded('wrong population')]);
    const labels = f.exclusionReasons.map((r) => r.label);
    expect(labels).toContain('Reason not recorded');
    expect(labels).toContain('Wrong population');
  });
});
