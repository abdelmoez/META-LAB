/**
 * rob2-domains.test.js — golden tests for the RoB 2 per-domain judgement
 * algorithm (src/research-engine/rob). Domain 1 is verified against the OFFICIAL
 * RoB 2 guidance Table 4 (every one of its 14 rows). Domains 2–5 cover the
 * current (2019) tool's branches incl. NI handling. See rob-validation.md.
 */
import { describe, it, expect } from 'vitest';
import { judgeDomain } from '../../src/research-engine/rob/index.js';

const J = (domainId, answers) => judgeDomain(domainId, answers).judgment;

// ── Domain 1 — official Table 4 (randomisation), all 14 rows ──────────────────
describe('RoB2 Domain 1 — official Table 4 (every row)', () => {
  // [1.1, 1.2, 1.3, expected]. "any" 1.3 expanded to both NI and Y/PY where the
  // row says "Any response".
  const TABLE = [
    ['Y', 'Y', 'N', 'low'], ['Y', 'Y', 'PN', 'low'], ['Y', 'Y', 'NI', 'low'],
    ['Y', 'Y', 'Y', 'some'], ['Y', 'Y', 'PY', 'some'],
    ['Y', 'N', 'N', 'high'], ['Y', 'N', 'Y', 'high'], ['Y', 'N', 'NI', 'high'],
    ['Y', 'NI', 'N', 'some'], ['Y', 'NI', 'NI', 'some'],
    ['Y', 'NI', 'Y', 'high'],
    ['N', 'Y', 'N', 'some'], ['N', 'Y', 'Y', 'some'], ['N', 'Y', 'NI', 'some'],
    ['N', 'N', 'N', 'high'], ['N', 'N', 'Y', 'high'],
    ['N', 'NI', 'PN', 'some'], ['N', 'NI', 'Y', 'high'],
    ['NI', 'Y', 'N', 'low'], ['NI', 'Y', 'PN', 'low'], ['NI', 'Y', 'NI', 'low'],
    ['NI', 'Y', 'Y', 'some'],
    ['NI', 'N', 'N', 'high'], ['NI', 'N', 'Y', 'high'],
    ['NI', 'NI', 'N', 'some'], ['NI', 'NI', 'NI', 'some'],
    ['NI', 'NI', 'Y', 'high'],
    // PY/PN behave as Y/N
    ['PY', 'PY', 'PN', 'low'], ['PY', 'PN', 'PN', 'high'], ['PN', 'PY', 'PN', 'some'],
  ];
  it.each(TABLE)('1.1=%s 1.2=%s 1.3=%s → %s', (q11, q12, q13, expected) => {
    expect(J('D1', { '1.1': q11, '1.2': q12, '1.3': q13 })).toBe(expected);
  });
});

// ── Domain 2 — deviations (effect of assignment) ──────────────────────────────
describe('RoB2 Domain 2 — deviations (effect of assignment)', () => {
  it('Low: blinded + appropriate ITT analysis', () => {
    expect(J('D2', { '2.1': 'N', '2.2': 'N', '2.6': 'Y' })).toBe('low');
  });
  it('Low: no trial-context deviations + appropriate analysis', () => {
    expect(J('D2', { '2.1': 'Y', '2.2': 'N', '2.3': 'N', '2.6': 'Y' })).toBe('low');
  });
  it('Some: deviations arose but unlikely to affect outcome (2.3 Y, 2.4 N) — cannot be Low', () => {
    expect(J('D2', { '2.1': 'Y', '2.2': 'Y', '2.3': 'Y', '2.4': 'N', '2.6': 'Y' })).toBe('some');
  });
  it('High: imbalanced deviations affecting the outcome', () => {
    expect(J('D2', { '2.1': 'Y', '2.2': 'Y', '2.3': 'Y', '2.4': 'Y', '2.5': 'N', '2.6': 'Y' })).toBe('high');
  });
  it('High: inappropriate analysis with substantial impact (2.7 = Y)', () => {
    expect(J('D2', { '2.1': 'N', '2.2': 'N', '2.6': 'N', '2.7': 'Y' })).toBe('high');
  });
  it('High: inappropriate analysis, impact unknown (2.7 = NI → High)', () => {
    expect(J('D2', { '2.1': 'N', '2.2': 'N', '2.6': 'N', '2.7': 'NI' })).toBe('high');
  });
  it('Some: inappropriate analysis but little potential impact (2.7 = N) — never Low', () => {
    expect(J('D2', { '2.1': 'N', '2.2': 'N', '2.6': 'N', '2.7': 'N' })).toBe('some');
  });
  it('Some: balanced deviations affecting outcome (2.5 = Y)', () => {
    expect(J('D2', { '2.1': 'Y', '2.2': 'Y', '2.3': 'Y', '2.4': 'Y', '2.5': 'Y', '2.6': 'Y' })).toBe('some');
  });
  it('High dominates: low deviations but high analysis', () => {
    expect(J('D2', { '2.1': 'N', '2.2': 'N', '2.6': 'PN', '2.7': 'PY' })).toBe('high');
  });
});

// ── Domain 3 — missing outcome data ───────────────────────────────────────────
describe('RoB2 Domain 3 — missing outcome data', () => {
  it('Low: data available for nearly all (3.1 = Y)', () => {
    expect(J('D3', { '3.1': 'Y' })).toBe('low');
  });
  it('Low: evidence result not biased by missingness (3.2 = Y)', () => {
    expect(J('D3', { '3.1': 'N', '3.2': 'Y' })).toBe('low');
  });
  it('Low: missingness could not depend on true value (3.3 = N)', () => {
    expect(J('D3', { '3.1': 'N', '3.2': 'N', '3.3': 'N' })).toBe('low');
  });
  it('High: missingness could and likely did depend on true value', () => {
    expect(J('D3', { '3.1': 'N', '3.2': 'N', '3.3': 'Y', '3.4': 'Y' })).toBe('high');
  });
  it('Some: could depend but unlikely (3.4 = N)', () => {
    expect(J('D3', { '3.1': 'N', '3.2': 'N', '3.3': 'Y', '3.4': 'N' })).toBe('some');
  });
  it('High: could depend, no information whether it did (3.4 = NI → High)', () => {
    expect(J('D3', { '3.1': 'N', '3.2': 'N', '3.3': 'Y', '3.4': 'NI' })).toBe('high');
  });
});

// ── Domain 4 — measurement of the outcome ─────────────────────────────────────
describe('RoB2 Domain 4 — measurement of the outcome', () => {
  it('High: inappropriate measurement method (4.1 = Y)', () => {
    expect(J('D4', { '4.1': 'Y' })).toBe('high');
  });
  it('High: measurement differed between groups (4.2 = Y)', () => {
    expect(J('D4', { '4.1': 'N', '4.2': 'Y' })).toBe('high');
  });
  it('High: assessment likely influenced by knowledge (4.5 = Y)', () => {
    expect(J('D4', { '4.1': 'N', '4.2': 'N', '4.3': 'Y', '4.4': 'Y', '4.5': 'Y' })).toBe('high');
  });
  it('High: assessment influence unknown (4.5 = NI → High)', () => {
    expect(J('D4', { '4.1': 'N', '4.2': 'N', '4.3': 'Y', '4.4': 'Y', '4.5': 'NI' })).toBe('high');
  });
  it('Low: assessors blinded (4.3 = N)', () => {
    expect(J('D4', { '4.1': 'N', '4.2': 'N', '4.3': 'N' })).toBe('low');
  });
  it('Low: knowledge could not influence assessment (4.4 = N)', () => {
    expect(J('D4', { '4.1': 'N', '4.2': 'N', '4.3': 'Y', '4.4': 'N' })).toBe('low');
  });
  it('Low: no info on appropriateness but appropriate+comparable+blinded (4.1 = NI → still Low)', () => {
    expect(J('D4', { '4.1': 'NI', '4.2': 'N', '4.3': 'N' })).toBe('low');
  });
  it('Some: could be influenced but not clearly likely (4.5 = N)', () => {
    expect(J('D4', { '4.1': 'N', '4.2': 'N', '4.3': 'Y', '4.4': 'Y', '4.5': 'N' })).toBe('some');
  });
  it('Some: no info whether measurement differs between groups (4.2 = NI blocks Low)', () => {
    expect(J('D4', { '4.1': 'N', '4.2': 'NI', '4.3': 'N' })).toBe('some');
  });
});

// ── Domain 5 — selection of the reported result ───────────────────────────────
describe('RoB2 Domain 5 — selection of the reported result', () => {
  it('Low: pre-specified plan, no selection (5.1 Y, 5.2 N, 5.3 N)', () => {
    expect(J('D5', { '5.1': 'Y', '5.2': 'N', '5.3': 'N' })).toBe('low');
  });
  it('High: selected from multiple measurements (5.2 = Y)', () => {
    expect(J('D5', { '5.1': 'Y', '5.2': 'Y', '5.3': 'N' })).toBe('high');
  });
  it('High: selected from multiple analyses (5.3 = Y)', () => {
    expect(J('D5', { '5.1': 'Y', '5.2': 'N', '5.3': 'Y' })).toBe('high');
  });
  it('Some: no pre-specified plan (5.1 = N) but no result-driven selection', () => {
    expect(J('D5', { '5.1': 'N', '5.2': 'N', '5.3': 'N' })).toBe('some');
  });
  it('Some: selection status uncertain (5.2 = NI)', () => {
    expect(J('D5', { '5.1': 'Y', '5.2': 'NI', '5.3': 'N' })).toBe('some');
  });
});

// ── reasons trace is always present and non-empty ─────────────────────────────
describe('RoB2 domain reasons trace', () => {
  it('every domain returns a non-empty human-readable reasons array', () => {
    for (const [d, a] of [
      ['D1', { '1.1': 'Y', '1.2': 'Y', '1.3': 'N' }],
      ['D2', { '2.1': 'N', '2.2': 'N', '2.6': 'Y' }],
      ['D3', { '3.1': 'Y' }],
      ['D4', { '4.1': 'N', '4.2': 'N', '4.3': 'N' }],
      ['D5', { '5.1': 'Y', '5.2': 'N', '5.3': 'N' }],
    ]) {
      const r = judgeDomain(d, a);
      expect(Array.isArray(r.reasons)).toBe(true);
      expect(r.reasons.length).toBeGreaterThan(0);
      expect(r.reasons.every(s => typeof s === 'string' && s.length > 0)).toBe(true);
    }
  });
  it('throws on an unknown domain id', () => {
    expect(() => judgeDomain('D9', {})).toThrow();
  });
});
