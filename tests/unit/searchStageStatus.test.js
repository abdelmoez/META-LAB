/**
 * searchStageStatus.test.js — 85.md A1, re-keyed by 96.md D5 and 98.md §3. Per-stage
 * completion statuses for the 6-stage Search workflow: honest, visited-agnostic, and
 * PICO-free (98.md retired the standalone Research Question stage — the question is
 * edited inline on 'terms', so no 'question' status is emitted; terms = generic
 * concept groups).
 *
 * 114.md §2 splits the channel in two: STATUS answers "is this stage's goal met?"
 * ('attention' is reserved for a genuine blocker), while optional review items —
 * pending vocabulary suggestions and warning-severity quality findings — ride in
 * the additive ADVISORY channel and never demote a valid strategy.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  computeStageStatuses, computeStageAdvisories, computeStageModel,
  STAGE_IDS, STAGE_STATUS_VALUES,
} from '../../src/research-engine/searchBuilder/stageStatus.js';
import { STAGES, STAGE_ALIASES } from '../../src/features/searchWorkspace/searchStages.js';
import { rejectionKey } from '../../src/research-engine/searchBuilder/suggestionReview.js';

/* 114.md §2 — the CRITICAL severity is part of the searchQualityCheck contract
   but no shipped check emits one, so the "still blocks" half of the new rule is
   proved by injecting a critical finding through that exact seam. Off by
   default (vi.hoisted + vi.mock are lifted above the imports by the runner):
   every other test in this file runs the real quality check. */
const qcCtl = vi.hoisted(() => ({ injectCritical: false }));
vi.mock('../../src/research-engine/searchBuilder/crossConcept.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    searchQualityCheck: (concepts, opts) => {
      const out = actual.searchQualityCheck(concepts, opts);
      return qcCtl.injectCritical
        ? [{ id: 'crit:test', severity: 'critical', concept: 'test', message: 'blocker', action: 'fix it' }, ...out]
        : out;
    },
  };
});

const freetext = (text, extra = {}) => ({ id: `t-${text}`, text, type: 'freetext', field: 'tiab', ...extra });
const group = (id, label, terms = []) => ({ id, label, source: 'user_added', op: 'AND', terms });
// Legacy shape — saved pre-96 projects carry the five PICO groups forever.
const legacyGroup = (key, label, terms = []) => ({ id: `c${key}`, label, picoField: key, field: label, source: 'pico_auto', op: 'AND', terms });

describe('STAGE_IDS stays in sync with searchStages.js', () => {
  it('mirrors the canonical stage table exactly (ids + order)', () => {
    expect([...STAGE_IDS]).toEqual(STAGES.map((s) => s.id));
  });
  it('the retired stages are gone from BOTH lists and alias to terms', () => {
    // 96.md retired concepts/refine; 98.md §3 retires the question stage too.
    for (const retired of ['concepts', 'refine', 'question']) {
      expect(STAGE_IDS).not.toContain(retired);
      expect(STAGES.some((s) => s.id === retired)).toBe(false);
      expect(STAGE_ALIASES[retired]).toBe('terms');
    }
  });
  it('pins the NEW 6-stage list exactly (98.md §3)', () => {
    expect([...STAGE_IDS]).toEqual(['terms', 'mode', 'strategy', 'results', 'documentation', 'screening']);
  });
  it('every emitted status is a known value for every stage id', () => {
    const out = computeStageStatuses({});
    expect(Object.keys(out).sort()).toEqual([...STAGE_IDS].sort());
    for (const v of Object.values(out)) expect(STAGE_STATUS_VALUES).toContain(v);
  });
});

describe('98.md §3 — the question stage is retired (no status emitted)', () => {
  it('never emits a question key, even when a question is threaded', () => {
    expect(computeStageStatuses({}).question).toBeUndefined();
    expect(computeStageStatuses({ question: 'Do SGLT2i reduce readmission?' }).question).toBeUndefined();
    expect('question' in computeStageStatuses({ question: 'x' })).toBe(false);
  });
  it('opts.question / opts.pico are accepted-and-ignored (existing callers keep working)', () => {
    // Identical output with and without the retired inputs — they change nothing.
    const base = computeStageStatuses({});
    expect(computeStageStatuses({ question: 'legacy question' })).toEqual(base);
    expect(computeStageStatuses({ pico: { question: 'legacy', P: 'adults', I: 'metformin' } })).toEqual(base);
  });
});

describe('terms stage — ≥1 group with ≥1 live term = done (no PICO roles)', () => {
  it('empty when no live terms exist anywhere', () => {
    expect(computeStageStatuses({ concepts: [group('a', 'Heart failure')] }).terms).toBe('empty');
    expect(computeStageStatuses({}).terms).toBe('empty');
  });
  it('done with a single question-derived group carrying one live term', () => {
    const concepts = [group('a', 'Heart failure', [freetext('heart failure')])];
    expect(computeStageStatuses({ concepts }).terms).toBe('done');
  });
  it('disabled terms are NOT live (a switched-off only group reads empty)', () => {
    const concepts = [group('a', 'Heart failure', [freetext('heart failure', { disabled: true })])];
    expect(computeStageStatuses({ concepts }).terms).toBe('empty');
  });
  it('legacy five-group saves still compute (P+I live → done)', () => {
    const concepts = [
      legacyGroup('P', 'Population', [freetext('obesity')]),
      legacyGroup('I', 'Intervention / Exposure', [freetext('metformin')]),
    ];
    expect(computeStageStatuses({ concepts }).terms).toBe('done');
  });
  it('info-severity findings (novocab guidance) never block done', () => {
    // Two groups with live free text → novocab:<id> info entries only.
    const concepts = [
      group('a', 'Heart failure', [freetext('heart failure')]),
      group('b', 'Readmission', [freetext('readmission')]),
    ];
    expect(computeStageStatuses({ concepts }).terms).toBe('done');
  });
});

/* ── 114.md §2 — STATUS vs ADVISORY ───────────────────────────────────────────
   The red "Build your search" bug: pending vocabulary suggestions and
   warning-severity quality findings used to demote terms to 'attention', which
   the shared status language renders in the DANGER tone. Both fire for almost
   every real strategy (a suggestion exists as soon as a term carries a MeSH
   vocab record; only an explicit reject clears it), so a valid, runnable search
   read as a failure — and, because rejections/dismissals persist, so did the
   red. They are review items now: the status stays 'done' and the counts ride
   in the additive advisory channel. Only a CRITICAL finding still blocks. */
describe('terms stage — suggestions/warnings are ADVISORY, never a red status (114.md §2)', () => {
  const withSuggestion = () => [group('a', 'Heart failure', [freetext('heart failure', { vocab: { mesh: 'Heart Failure' } })])];
  // 96.md re-keyed empty-group check: a second group with zero live terms warns.
  const withWarning = () => [group('a', 'Heart failure', [freetext('heart failure')]), group('b', 'Readmission')];

  it('a pending vocabulary suggestion leaves the stage DONE and reports one advisory', () => {
    const concepts = withSuggestion();
    expect(computeStageStatuses({ concepts }).terms).toBe('done');
    expect(computeStageAdvisories({ concepts }).terms).toEqual({ suggestions: 1, warnings: 0, total: 1 });
  });
  it('rejecting the suggestion clears the advisory (the persisted memory recomputes it)', () => {
    const concepts = withSuggestion();
    const rejected = [rejectionKey(concepts[0], 'heart failure')];
    const { statuses, advisories } = computeStageModel({ concepts, rejected });
    expect(statuses.terms).toBe('done');
    expect(advisories.terms).toEqual({ suggestions: 0, warnings: 0, total: 0 });
  });
  it('a warning-severity QC finding leaves the stage DONE and reports one advisory', () => {
    const concepts = withWarning();
    expect(computeStageStatuses({ concepts }).terms).toBe('done');
    expect(computeStageAdvisories({ concepts }).terms).toEqual({ suggestions: 0, warnings: 1, total: 1 });
  });
  it('dismissing the warning clears the advisory (persisted dismissals recompute too)', () => {
    const concepts = withWarning();
    const dismissedWarnings = [`empty:${concepts[1].id}`];
    expect(computeStageStatuses({ concepts, dismissedWarnings }).terms).toBe('done');
    expect(computeStageAdvisories({ concepts, dismissedWarnings }).terms).toEqual({ suggestions: 0, warnings: 0, total: 0 });
  });
  it('advisories add up across both kinds', () => {
    const concepts = [
      group('a', 'Heart failure', [freetext('heart failure', { vocab: { mesh: 'Heart Failure' } })]),
      group('b', 'Readmission'), // empty group → one warning
    ];
    expect(computeStageAdvisories({ concepts }).terms).toEqual({ suggestions: 1, warnings: 1, total: 2 });
    expect(computeStageStatuses({ concepts }).terms).toBe('done');
  });
  it('info findings are counted nowhere (calm guidance, not a review item)', () => {
    const concepts = [
      group('a', 'Heart failure', [freetext('heart failure')]),
      group('b', 'Readmission', [freetext('readmission')]),
    ];
    expect(computeStageAdvisories({ concepts }).terms).toEqual({ suggestions: 0, warnings: 0, total: 0 });
  });
  it('a CRITICAL finding — and only a critical one — still reads attention', () => {
    // No shipped check emits 'critical' today (the severity is part of the
    // searchQualityCheck contract and reserved for a real blocker), so the
    // blocker path is proved by injecting one through that same seam.
    const concepts = [group('a', 'Heart failure', [freetext('heart failure')])];
    expect(computeStageStatuses({ concepts }).terms).toBe('done');
    qcCtl.injectCritical = true;
    try {
      const { statuses, advisories } = computeStageModel({ concepts });
      expect(statuses.terms).toBe('attention');
      // …and a blocker is NOT an advisory: the review counts stay clean.
      expect(advisories.terms).toEqual({ suggestions: 0, warnings: 0, total: 0 });
    } finally {
      qcCtl.injectCritical = false;
    }
    expect(computeStageStatuses({ concepts }).terms).toBe('done');
  });
  it('an empty board has no advisories at all (nothing to review yet)', () => {
    expect(computeStageAdvisories({}).terms).toEqual({ suggestions: 0, warnings: 0, total: 0 });
    expect(computeStageAdvisories({ concepts: [group('a', 'Heart failure')] }).terms)
      .toEqual({ suggestions: 0, warnings: 0, total: 0 });
  });
});

describe('computeStageModel — statuses and advisories are separate channels', () => {
  it('the model returns exactly { statuses, advisories }, and the two helpers are its slices', () => {
    const concepts = [group('a', 'Heart failure', [freetext('heart failure', { vocab: { mesh: 'Heart Failure' } })])];
    const opts = { concepts, searchMode: 'manual', databases: ['pubmed'] };
    const model = computeStageModel(opts);
    expect(Object.keys(model).sort()).toEqual(['advisories', 'statuses']);
    expect(model.statuses).toEqual(computeStageStatuses(opts));
    expect(model.advisories).toEqual(computeStageAdvisories(opts));
    // The status map keeps its long-standing shape — advisories never leak into it.
    expect(Object.keys(model.statuses).sort()).toEqual([...STAGE_IDS].sort());
    expect('advisories' in model.statuses).toBe(false);
  });
  it('tolerates junk input like the status map does', () => {
    for (const junk of [null, undefined, 42, 'x', { concepts: 'bad' }]) {
      expect(computeStageAdvisories(junk).terms).toEqual({ suggestions: 0, warnings: 0, total: 0 });
    }
  });
});

describe('mode stage', () => {
  it('done only on an explicit choice', () => {
    expect(computeStageStatuses({ searchMode: 'manual' }).mode).toBe('done');
    expect(computeStageStatuses({ searchMode: 'automated' }).mode).toBe('done');
    expect(computeStageStatuses({ searchMode: null }).mode).toBe('empty');
    expect(computeStageStatuses({ searchMode: 'junk' }).mode).toBe('empty');
  });
});

describe('strategy stage (manual only)', () => {
  const concepts = [group('a', 'Heart failure', [freetext('heart failure')])];
  it('empty without a strategy', () => {
    expect(computeStageStatuses({}).strategy).toBe('empty');
  });
  it('partial once a strategy compiles, done on explicit engagement (databases or an override)', () => {
    expect(computeStageStatuses({ concepts }).strategy).toBe('partial');
    expect(computeStageStatuses({ concepts, databases: ['pubmed'] }).strategy).toBe('done');
    expect(computeStageStatuses({ concepts, overrides: { pubmed: 'obesity[tiab]' } }).strategy).toBe('done');
    expect(computeStageStatuses({ concepts, overrides: { pubmed: '   ' } }).strategy).toBe('partial'); // blank override ≠ engagement
  });
});

describe('results / documentation stages — never claimed done (visited-agnostic honesty)', () => {
  const concepts = [group('a', 'Heart failure', [freetext('heart failure')])];
  it('empty without a strategy, partial with one — never done', () => {
    const none = computeStageStatuses({});
    expect(none.results).toBe('empty');
    expect(none.documentation).toBe('empty');
    const some = computeStageStatuses({ concepts, hitState: { status: 'updated', hitCount: 9 }, readyForScreening: true });
    expect(some.results).toBe('partial');
    expect(some.documentation).toBe('partial');
  });
});

describe('screening stage', () => {
  it('done = the readyForScreening marker, nothing else', () => {
    expect(computeStageStatuses({ readyForScreening: true }).screening).toBe('done');
    expect(computeStageStatuses({ readyForScreening: false }).screening).toBe('empty');
    expect(computeStageStatuses({}).screening).toBe('empty');
  });
});

describe('defensive input', () => {
  it('tolerates junk everywhere', () => {
    for (const junk of [null, undefined, 42, 'x', { concepts: 'bad', pico: 7, question: 9, hitState: 'nope' }]) {
      const out = computeStageStatuses(junk);
      expect(Object.keys(out).sort()).toEqual([...STAGE_IDS].sort());
    }
  });
});
