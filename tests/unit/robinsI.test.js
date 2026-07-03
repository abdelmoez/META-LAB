/**
 * robinsI.test.js — ROBINS-I instrument (Sterne 2016): definition well-formedness,
 * per-domain 5-level judgements, the worst-domain overall roll-up (incl. the
 * "No information" rule), branch reachability, and engine dispatch parity.
 */
import { describe, it, expect } from 'vitest';
import {
  ROBINSI,
  robinsJudgeDomain as judgeDomain,
  robinsJudgeOverall as judgeOverall,
  getInstrument,
  nextQuestions,
  isReachable,
  proposeDomain,
  proposeOverall,
} from '../../src/research-engine/rob/index.js';

const J = (d, a) => judgeDomain(d, a).judgment;

// ── Instrument definition ─────────────────────────────────────────────────────
describe('ROBINS-I instrument definition', () => {
  it('has 7 domains D1–D7 with the ROBINS-I labels', () => {
    expect(ROBINSI.id).toBe('ROBINS-I');
    expect(ROBINSI.domains.map(d => d.id)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']);
    expect(ROBINSI.domains.find(d => d.id === 'D1').shortLabel).toBe('Confounding');
    expect(ROBINSI.domains.find(d => d.id === 'D7').shortLabel).toBe('Selective reporting');
  });
  it('exposes the 5-level ordinal scale', () => {
    expect(ROBINSI.judgmentLevels.map(l => l.value)).toEqual(['low', 'moderate', 'serious', 'critical', 'ni']);
    expect(ROBINSI.judgmentLevels.find(l => l.value === 'critical').label).toMatch(/critical/i);
    expect(ROBINSI.judgmentLevels.find(l => l.value === 'ni').label).toMatch(/no information/i);
  });
  it('uses the Y/PY/PN/N/NI response set (NA excluded from options)', () => {
    expect(ROBINSI.responseOptions.map(o => o.value)).toEqual(['Y', 'PY', 'PN', 'N', 'NI']);
  });
  it('every question is well-formed (id/text/guidance/branch)', () => {
    for (const d of ROBINSI.domains) {
      expect(d.questions.length).toBeGreaterThan(0);
      for (const q of d.questions) {
        expect(typeof q.id).toBe('string');
        expect(q.text.length).toBeGreaterThan(0);
        expect(typeof q.guidance).toBe('string');
        expect(q.branch === null || typeof q.branch === 'object').toBe(true);
      }
    }
  });
  it('is frozen and JSON-serialisable (no functions leak into ROBINSI)', () => {
    expect(Object.isFrozen(ROBINSI)).toBe(true);
    const round = JSON.parse(JSON.stringify(ROBINSI));
    expect(round.domains).toHaveLength(7);
    expect(round.domains[0].questions[1].branch).toBeTruthy();
  });
});

// ── Per-domain 5-level judgements ─────────────────────────────────────────────
describe('ROBINS-I D1 — confounding', () => {
  it('Low: no potential for confounding (1.1 = N)', () => {
    expect(J('D1', { '1.1': 'N' })).toBe('low');
  });
  it('Low: all confounders controlled + measured validly, no mediator adjustment', () => {
    expect(J('D1', { '1.1': 'Y', '1.2': 'N', '1.4': 'Y', '1.5': 'Y', '1.6': 'N' })).toBe('low');
  });
  it('Moderate: confounders controlled but not measured validly', () => {
    expect(J('D1', { '1.1': 'Y', '1.2': 'N', '1.4': 'Y', '1.5': 'N', '1.6': 'N' })).toBe('moderate');
  });
  it('Serious: important confounding not controlled (1.4 = N)', () => {
    expect(J('D1', { '1.1': 'Y', '1.2': 'N', '1.4': 'N' })).toBe('serious');
  });
  it('Serious: adjusted for a post-intervention mediator (1.6 = Y) despite otherwise-ok analysis', () => {
    expect(J('D1', { '1.1': 'Y', '1.2': 'N', '1.4': 'Y', '1.5': 'Y', '1.6': 'Y' })).toBe('serious');
  });
  it('Critical: adjusted for a mediator AND failed to control confounding', () => {
    expect(J('D1', { '1.1': 'Y', '1.2': 'N', '1.4': 'N', '1.6': 'Y' })).toBe('critical');
  });
  it('No information: analysis approach not established', () => {
    expect(J('D1', { '1.1': 'Y', '1.2': 'N' })).toBe('ni');
  });
});

describe('ROBINS-I D2 — selection', () => {
  it('Low: no post-baseline selection + follow-up coincides', () => {
    expect(J('D2', { '2.1': 'N', '2.4': 'Y' })).toBe('low');
  });
  it('Serious: post-baseline selection associated with intervention and outcome, unadjusted', () => {
    expect(J('D2', { '2.1': 'Y', '2.2': 'Y', '2.3': 'Y' })).toBe('serious');
  });
  it('Moderate: same selection but corrected by adjustment', () => {
    expect(J('D2', { '2.1': 'Y', '2.2': 'Y', '2.3': 'Y', '2.5': 'Y' })).toBe('moderate');
  });
  it('Serious: follow-up does not coincide with intervention (immortal time), unadjusted', () => {
    expect(J('D2', { '2.1': 'N', '2.4': 'N' })).toBe('serious');
  });
  it('No information: selection basis unknown', () => {
    expect(J('D2', { '2.1': 'NI' })).toBe('ni');
  });
});

describe('ROBINS-I D3 — classification', () => {
  it('Serious: classification affected by outcome knowledge (differential)', () => {
    expect(J('D3', { '3.3': 'Y' })).toBe('serious');
  });
  it('Low: clear, contemporaneous, unaffected by outcome', () => {
    expect(J('D3', { '3.1': 'Y', '3.2': 'Y', '3.3': 'N' })).toBe('low');
  });
  it('Moderate: no information on differential classification', () => {
    expect(J('D3', { '3.3': 'NI' })).toBe('moderate');
  });
  it('No information: nothing answered', () => {
    expect(J('D3', {})).toBe('ni');
  });
});

describe('ROBINS-I D4 — deviations', () => {
  it('Critical: unbalanced outcome-affecting deviations, no appropriate analysis', () => {
    expect(J('D4', { '4.1': 'Y', '4.2': 'Y' })).toBe('critical');
  });
  it('Serious: unbalanced outcome-affecting deviations but appropriate analysis used', () => {
    expect(J('D4', { '4.1': 'Y', '4.2': 'Y', '4.6': 'Y' })).toBe('serious');
  });
  it('Serious: co-interventions unbalanced, unadjusted', () => {
    expect(J('D4', { '4.3': 'N' })).toBe('serious');
  });
  it('Low: adherence imperfect but appropriate (per-protocol/IV) analysis', () => {
    expect(J('D4', { '4.4': 'N', '4.6': 'Y' })).toBe('low');
  });
  it('Low: no problematic deviations + balanced co-interventions', () => {
    expect(J('D4', { '4.1': 'N', '4.3': 'Y' })).toBe('low');
  });
  it('No information: nothing answered', () => {
    expect(J('D4', {})).toBe('ni');
  });
});

describe('ROBINS-I D5 — missing data', () => {
  it('Low: data for nearly all participants', () => {
    expect(J('D5', { '5.1': 'Y' })).toBe('low');
  });
  it('Low: missing data but result robust to it', () => {
    expect(J('D5', { '5.1': 'N', '5.5': 'Y' })).toBe('low');
  });
  it('Moderate: missing but similar across groups, no robustness shown', () => {
    expect(J('D5', { '5.1': 'N', '5.4': 'Y' })).toBe('moderate');
  });
  it('Serious: differential missingness, no robustness', () => {
    expect(J('D5', { '5.1': 'N', '5.4': 'N' })).toBe('serious');
  });
  it('No information: availability unknown', () => {
    expect(J('D5', {})).toBe('ni');
  });
});

describe('ROBINS-I D6 — measurement', () => {
  it('Serious: systematic measurement error related to intervention', () => {
    expect(J('D6', { '6.4': 'Y' })).toBe('serious');
  });
  it('Low: comparable methods + objective outcome', () => {
    expect(J('D6', { '6.3': 'Y', '6.1': 'N' })).toBe('low');
  });
  it('Serious: non-comparable methods + subjective outcome with aware assessors', () => {
    expect(J('D6', { '6.3': 'N', '6.1': 'Y', '6.2': 'Y' })).toBe('serious');
  });
  it('Moderate: comparable methods but subjective outcome, aware assessors', () => {
    expect(J('D6', { '6.3': 'Y', '6.1': 'Y', '6.2': 'Y' })).toBe('moderate');
  });
  it('No information: nothing answered', () => {
    expect(J('D6', {})).toBe('ni');
  });
});

describe('ROBINS-I D7 — selective reporting', () => {
  it('Serious: result-driven selection from multiple measurements', () => {
    expect(J('D7', { '7.1': 'Y' })).toBe('serious');
  });
  it('Low: pre-specified, no result-driven selection', () => {
    expect(J('D7', { '7.1': 'N', '7.2': 'N', '7.3': 'N' })).toBe('low');
  });
  it('No information: nothing answered', () => {
    expect(J('D7', {})).toBe('ni');
  });
});

describe('ROBINS-I domain reasons trace', () => {
  it('every judgement returns a non-empty reasons array', () => {
    for (const [d, a] of [['D1', { '1.1': 'N' }], ['D4', { '4.1': 'Y', '4.2': 'Y' }], ['D6', { '6.4': 'Y' }]]) {
      const r = judgeDomain(d, a);
      expect(r.reasons.length).toBeGreaterThan(0);
      expect(r.reasons.every(s => typeof s === 'string' && s.length > 0)).toBe(true);
    }
  });
  it('throws on unknown domain', () => {
    expect(() => judgeDomain('D9', {})).toThrow();
  });
});

// ── Overall roll-up — worst domain + No-information rule ───────────────────────
describe('ROBINS-I overall roll-up (worst domain)', () => {
  const base = { D1: 'low', D2: 'low', D3: 'low', D4: 'low', D5: 'low', D6: 'low', D7: 'low' };
  it('Low when every domain is Low', () => {
    expect(judgeOverall(base).judgment).toBe('low');
  });
  it('Moderate when the worst domain is Moderate', () => {
    expect(judgeOverall({ ...base, D3: 'moderate' }).judgment).toBe('moderate');
  });
  it('Serious when at least one domain is Serious (no Critical)', () => {
    expect(judgeOverall({ ...base, D2: 'moderate', D5: 'serious' }).judgment).toBe('serious');
  });
  it('Critical when at least one domain is Critical (dominates Serious)', () => {
    const r = judgeOverall({ ...base, D4: 'critical', D5: 'serious' });
    expect(r.judgment).toBe('critical');
    expect(r.criticalFlag).toBe(true);
  });
  it('overall can never be lower than the highest single domain', () => {
    expect(judgeOverall({ ...base, D6: 'serious' }).judgment).toBe('serious');
  });
  it('No information overrides Moderate when no Serious/Critical present', () => {
    const r = judgeOverall({ ...base, D2: 'moderate', D7: 'ni' });
    expect(r.judgment).toBe('ni');
    expect(r.noInformationFlag).toBe(true);
  });
  it('Serious dominates No information', () => {
    expect(judgeOverall({ ...base, D2: 'ni', D5: 'serious' }).judgment).toBe('serious');
  });
  it('accepts an array of judgement strings/objects', () => {
    expect(judgeOverall(['low', 'moderate', { judgment: 'critical' }]).judgment).toBe('critical');
  });
  it('empty input → No information', () => {
    const r = judgeOverall({});
    expect(r.judgment).toBe('ni');
    expect(r.noInformationFlag).toBe(true);
  });
});

// ── Branch reachability ───────────────────────────────────────────────────────
describe('ROBINS-I branch reachability', () => {
  it('D1: 1.1 = N hides everything else (no confounding to assess)', () => {
    expect(nextQuestions(ROBINSI, 'D1', { '1.1': 'N' }).map(q => q.id)).toEqual(['1.1']);
  });
  it('D1: standard path (1.2 = N) shows 1.4/1.6, hides 1.3/1.7/1.8', () => {
    const ids = nextQuestions(ROBINSI, 'D1', { '1.1': 'Y', '1.2': 'N' }).map(q => q.id);
    expect(ids).toContain('1.4');
    expect(ids).toContain('1.6');
    expect(ids).not.toContain('1.3');
    expect(ids).not.toContain('1.7');
    expect(ids).not.toContain('1.5'); // 1.5 needs 1.4 = Y/PY
  });
  it('D1: time-split path (1.2 = Y) shows 1.3/1.7, hides 1.4', () => {
    const ids = nextQuestions(ROBINSI, 'D1', { '1.1': 'Y', '1.2': 'Y' }).map(q => q.id);
    expect(ids).toContain('1.3');
    expect(ids).toContain('1.7');
    expect(ids).not.toContain('1.4');
  });
  it('D2: 2.2/2.3 only shown once post-baseline selection is indicated', () => {
    expect(nextQuestions(ROBINSI, 'D2', { '2.1': 'N' }).map(q => q.id)).not.toContain('2.2');
    expect(nextQuestions(ROBINSI, 'D2', { '2.1': 'Y' }).map(q => q.id)).toContain('2.2');
  });
  it('D5: 5.4/5.5 shown when there is missing data', () => {
    expect(nextQuestions(ROBINSI, 'D5', { '5.1': 'Y' }).map(q => q.id)).not.toContain('5.4');
    expect(nextQuestions(ROBINSI, 'D5', { '5.1': 'N' }).map(q => q.id)).toContain('5.4');
  });
  it('isReachable matches for a sample branched question', () => {
    const q17 = ROBINSI.domains.find(d => d.id === 'D1').questions.find(q => q.id === '1.7');
    expect(isReachable(q17, { '1.2': 'Y' })).toBe(true);
    expect(isReachable(q17, { '1.2': 'N' })).toBe(false);
  });
});

// ── Engine dispatch parity ────────────────────────────────────────────────────
describe('ROBINS-I via the generic engine (dispatch)', () => {
  it('getInstrument resolves ROBINS-I', () => {
    expect(getInstrument('ROBINS-I').id).toBe('ROBINS-I');
  });
  it('proposeDomain dispatches to the ROBINS-I algorithm', () => {
    const inst = getInstrument('ROBINS-I');
    expect(proposeDomain(inst, 'D3', { '3.3': 'Y' }).judgment).toBe('serious');
    expect(proposeDomain(inst, 'D1', { '1.1': 'N' }).judgment).toBe('low');
  });
  it('proposeOverall dispatches to the ROBINS-I roll-up (5-level)', () => {
    const inst = getInstrument('ROBINS-I');
    expect(proposeOverall(inst, { D1: 'low', D2: 'critical' }).judgment).toBe('critical');
  });
});
