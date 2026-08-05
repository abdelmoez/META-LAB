/**
 * searchStageStatus.test.js — 85.md A1, re-keyed by 96.md D5 and 98.md §3. Per-stage
 * completion statuses for the 6-stage Search workflow: honest, visited-agnostic, and
 * PICO-free (98.md retired the standalone Research Question stage — the question is
 * edited inline on 'terms', so no 'question' status is emitted; terms = generic
 * concept groups).
 */
import { describe, it, expect } from 'vitest';
import {
  computeStageStatuses, STAGE_IDS, STAGE_STATUS_VALUES,
} from '../../src/research-engine/searchBuilder/stageStatus.js';
import { STAGES, STAGE_ALIASES } from '../../src/features/searchWorkspace/searchStages.js';
import { rejectionKey } from '../../src/research-engine/searchBuilder/suggestionReview.js';

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
  it('attention when ≥1 vocabulary suggestion is pending', () => {
    const concepts = [group('a', 'Heart failure', [freetext('heart failure', { vocab: { mesh: 'Heart Failure' } })])];
    expect(computeStageStatuses({ concepts }).terms).toBe('attention');
  });
  it('rejected suggestions release the attention state (no dead-end status)', () => {
    const concepts = [group('a', 'Heart failure', [freetext('heart failure', { vocab: { mesh: 'Heart Failure' } })])];
    const rejected = [rejectionKey(concepts[0], 'heart failure')];
    expect(computeStageStatuses({ concepts, rejected }).terms).toBe('done');
  });
  it('attention on an un-dismissed warning-severity QC finding; dismissing releases', () => {
    // 96.md re-keyed empty-group check: a second group with zero live terms warns.
    const empty = group('b', 'Readmission');
    const concepts = [group('a', 'Heart failure', [freetext('heart failure')]), empty];
    expect(computeStageStatuses({ concepts }).terms).toBe('attention');
    const dismissed = computeStageStatuses({ concepts, dismissedWarnings: [`empty:${empty.id}`] });
    expect(dismissed.terms).toBe('done');
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
