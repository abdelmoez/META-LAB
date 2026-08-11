/**
 * robAppraisal.test.js — deterministic guided appraisal (text → suggested
 * signalling answers + verbatim evidence → real instrument judgement).
 * Covers cue matching + polarity, verbatim evidence, NI on no cue, monotonic
 * confidence, thin-text warnings, and feeding BOTH instruments' algorithms.
 */
import { describe, it, expect } from 'vitest';
import { hasAppraisalCues, APPRAISAL_INSTRUMENT_IDS } from '../../src/research-engine/rob/appraisal.js';
import { instrumentIds as allInstrumentIds } from '../../src/research-engine/rob/engine.js';
import { appraiseFromText } from '../../src/research-engine/rob/index.js';

const Q = (res, domainId, questionId) =>
  res.domains.find(d => d.domainId === domainId).questions.find(q => q.questionId === questionId);

// ── Cue matching + verbatim evidence ──────────────────────────────────────────
describe('appraiseFromText — cue matching (RoB 2)', () => {
  const abstract =
    'Patients were randomly assigned to treatment or placebo using sequentially numbered opaque sealed envelopes. ' +
    'Baseline characteristics were similar at baseline between the two groups.';
  const res = appraiseFromText({ instrument: 'RoB2', abstract });

  it('suggests Yes for a random-sequence cue with verbatim evidence from the abstract', () => {
    const s = Q(res, 'D1', '1.1');
    expect(s.suggestedResponse).toBe('Y');
    expect(s.evidenceQuote).toBeTruthy();
    expect(abstract.includes(s.evidenceQuote)).toBe(true);         // verbatim substring
    expect(s.evidenceLocator.where).toBe('abstract');
    expect(abstract.slice(s.evidenceLocator.charStart, s.evidenceLocator.charEnd)).toBe(s.evidenceQuote);
  });

  it('suggests Yes for allocation concealment', () => {
    expect(Q(res, 'D1', '1.2').suggestedResponse).toBe('Y');
  });

  it('suggests No for "similar at baseline" (1.3)', () => {
    expect(Q(res, 'D1', '1.3').suggestedResponse).toBe('N');
  });

  it('defaults to No information (no evidence) when no cue matches', () => {
    const s = Q(res, 'D2', '2.1'); // no blinding language in this abstract
    expect(s.suggestedResponse).toBe('NI');
    expect(s.evidenceQuote).toBeNull();
    expect(s.evidenceLocator).toBeNull();
    expect(s.confidence).toBeLessThan(0.2);
  });
});

describe('appraiseFromText — cue polarity (ITT vs per-protocol)', () => {
  it('intention-to-treat ⇒ 2.6 = Yes', () => {
    const r = appraiseFromText({ instrument: 'RoB2', text: 'The primary analysis was by intention-to-treat.' });
    expect(Q(r, 'D2', '2.6').suggestedResponse).toBe('Y');
  });
  it('per-protocol ⇒ 2.6 = No', () => {
    const r = appraiseFromText({ instrument: 'RoB2', text: 'Only a per-protocol analysis was reported.' });
    expect(Q(r, 'D2', '2.6').suggestedResponse).toBe('N');
  });
});

// ── Confidence is monotonic in match strength ─────────────────────────────────
describe('appraiseFromText — monotonic confidence', () => {
  it('more/stronger matched cues ⇒ higher confidence for the same question', () => {
    const one = appraiseFromText({ instrument: 'RoB2', text: 'Patients were randomly assigned.' });
    const many = appraiseFromText({
      instrument: 'RoB2',
      text: 'Patients were randomly assigned using a computer-generated random sequence.',
    });
    const cOne = Q(one, 'D1', '1.1').confidence;
    const cMany = Q(many, 'D1', '1.1').confidence;
    expect(cMany).toBeGreaterThan(cOne);
    expect(cOne).toBeGreaterThan(0.1); // a real match beats the NI floor
  });

  it('a weak cue is less confident than a strong cue for the same question', () => {
    const weak = appraiseFromText({ instrument: 'RoB2', text: 'This was a randomized study.' });
    const strong = appraiseFromText({ instrument: 'RoB2', text: 'Participants were randomly assigned.' });
    expect(Q(strong, 'D1', '1.1').confidence).toBeGreaterThan(Q(weak, 'D1', '1.1').confidence);
  });
});

// ── Honesty: thin text / abstract-only warnings ───────────────────────────────
describe('appraiseFromText — honest coverage + warnings', () => {
  it('flags thin text and absence of full text; never fabricates high confidence', () => {
    const r = appraiseFromText({ instrument: 'RoB2', abstract: 'A short abstract with no methods detail.' });
    const types = r.warnings.map(w => w.type);
    expect(types).toContain('thin-text');
    expect(types).toContain('no-fulltext');
    // every suggestion is either evidence-backed or low-confidence NI
    for (const d of r.domains) {
      for (const q of d.questions) {
        if (q.suggestedResponse === 'NI') expect(q.confidence).toBeLessThan(0.2);
        else expect(q.evidenceQuote).toBeTruthy();
      }
    }
  });

  it('reports coverage (chars, full-text presence, domains with evidence)', () => {
    const r = appraiseFromText({ instrument: 'RoB2', text: 'Patients were randomly assigned to groups. '.repeat(20) });
    expect(r.coverage.textChars).toBeGreaterThan(400);
    expect(r.coverage.hasFullText).toBe(true);
    expect(r.coverage.domainsWithEvidence).toBeGreaterThanOrEqual(1);
  });
});

// ── Feeds the REAL judgement algorithm for BOTH instruments ────────────────────
describe('appraiseFromText — feeds the instrument algorithm (one source of truth)', () => {
  it('RoB 2: random + concealed + balanced baseline ⇒ D1 proposed Low', () => {
    const r = appraiseFromText({
      instrument: 'RoB2',
      text:
        'Patients were randomly assigned to treatment or placebo using sequentially numbered opaque sealed envelopes. ' +
        'Groups were similar at baseline.',
    });
    expect(r.instrumentId).toBe('RoB2');
    expect(r.domains.find(d => d.domainId === 'D1').proposedJudgment).toBe('low');
    expect(typeof r.overall.proposedOverall).toBe('string');
  });

  it('ROBINS-I: retrospective exposure with recall bias ⇒ D3 proposed Serious', () => {
    const r = appraiseFromText({
      instrument: 'ROBINS-I',
      text:
        'This was a retrospective cohort study. Exposure was ascertained retrospectively and could be subject to recall bias.',
    });
    expect(r.instrumentId).toBe('ROBINS-I');
    expect(r.domains).toHaveLength(7);
    expect(Q(r, 'D3', '3.3').suggestedResponse).toBe('Y');
    expect(r.domains.find(d => d.domainId === 'D3').proposedJudgment).toBe('serious');
  });

  it('defaults to RoB 2 when no instrument is given', () => {
    const r = appraiseFromText({ text: 'Patients were randomly assigned.' });
    expect(r.instrumentId).toBe('RoB2');
  });
});

// ── Cue COVERAGE is a hard gate, not a warning ────────────────────────────────
// The appraiser is a cue-phrase matcher with a hand-written table per instrument.
// Run against a tool with no table, every question falls through to the "No
// information" default — and the result is not a thin appraisal but a fabricated
// one: 'NI' is off-vocabulary for most of the 2026 set, so the suggestions are not
// even storable answers, and feeding that clean sweep to the instrument's own
// algorithm makes it propose a judgement from ZERO evidence.
describe('guided appraisal — cue coverage', () => {
  it('covers exactly RoB 2 and ROBINS-I today', () => {
    expect([...APPRAISAL_INSTRUMENT_IDS].sort()).toEqual(['ROBINS-I', 'RoB2']);
    expect(hasAppraisalCues('RoB2')).toBe(true);
    expect(hasAppraisalCues('ROBINS-I')).toBe(true);
  });

  it('is false for every other registered instrument', () => {
    const uncovered = allInstrumentIds().filter(id => !APPRAISAL_INSTRUMENT_IDS.includes(id));
    expect(uncovered.length).toBeGreaterThan(0);
    for (const id of uncovered) expect(hasAppraisalCues(id), id).toBe(false);
  });

  it('accepts an instrument OBJECT as well as an id, and never throws', () => {
    expect(hasAppraisalCues({ id: 'RoB2' })).toBe(true);
    expect(hasAppraisalCues({ id: 'QUADAS-2' })).toBe(false);
    expect(hasAppraisalCues(null)).toBe(false);
    expect(hasAppraisalCues(undefined)).toBe(false);
    expect(hasAppraisalCues('')).toBe(false);
    expect(hasAppraisalCues('constructor')).toBe(false);   // no prototype leak
  });

  it('shows WHY an uncovered tool must be refused rather than appraised', () => {
    // Nothing here matches a QUADAS-2 cue, because there are none. Every question
    // comes back 'NI' — a response QUADAS-2 does not even define…
    const r = appraiseFromText({
      instrument: 'QUADAS-2',
      text: 'A consecutive sample of patients underwent the index test and the reference standard.',
    });
    const answers = r.domains.flatMap(d => d.questions.map(q => q.suggestedResponse));
    expect(new Set(answers)).toEqual(new Set(['NI']));
    // …and the instrument dutifully proposes a judgement off the back of it.
    expect(r.domains.every(d => d.questions.every(q => q.evidenceQuote === null))).toBe(true);
    expect(r.warnings.some(w => w.type === 'no-evidence')).toBe(true);
  });
});
