/**
 * searchStageStatus.test.js — 85.md A1. Per-stage completion statuses for the
 * 9-stage Search workflow: honest, visited-agnostic, and kind to legitimately
 * empty Comparator/Outcomes/Time concepts.
 */
import { describe, it, expect } from 'vitest';
import {
  computeStageStatuses, STAGE_IDS, STAGE_STATUS_VALUES,
} from '../../src/research-engine/searchBuilder/stageStatus.js';
import { STAGES } from '../../src/features/searchWorkspace/searchStages.js';
import { rejectionKey } from '../../src/research-engine/searchBuilder/suggestionReview.js';

const freetext = (text, extra = {}) => ({ id: `t-${text}`, text, type: 'freetext', field: 'tiab', ...extra });
const group = (key, label, terms = []) => ({ id: `c${key}`, label, picoField: key, field: label, source: 'pico_auto', op: 'AND', terms });
const fiveGroups = ({ P = [], I = [], C = [], O = [], T = [] } = {}) => [
  group('P', 'Population', P),
  group('I', 'Intervention / Exposure', I),
  group('C', 'Comparator / Control', C),
  group('O', 'Outcomes', O),
  group('T', 'Time Frame', T),
];

describe('STAGE_IDS stays in sync with searchStages.js', () => {
  it('mirrors the canonical stage table exactly (ids + order)', () => {
    expect([...STAGE_IDS]).toEqual(STAGES.map((s) => s.id));
  });
  it('every emitted status is a known value for every stage id', () => {
    const out = computeStageStatuses({});
    expect(Object.keys(out).sort()).toEqual([...STAGE_IDS].sort());
    for (const v of Object.values(out)) expect(STAGE_STATUS_VALUES).toContain(v);
  });
});

describe('question stage', () => {
  it('done when any PICO field is captured, empty otherwise', () => {
    expect(computeStageStatuses({ pico: { P: 'adults with obesity' } }).question).toBe('done');
    expect(computeStageStatuses({ pico: { P: '', I: '  ' } }).question).toBe('empty');
    expect(computeStageStatuses({}).question).toBe('empty');
  });
});

describe('concepts stage — P AND I required, C/O/T legitimately optional', () => {
  it('empty when no live terms exist anywhere', () => {
    expect(computeStageStatuses({ concepts: fiveGroups() }).concepts).toBe('empty');
    expect(computeStageStatuses({}).concepts).toBe('empty');
  });
  it('done with P + I populated and C/O/T empty (no PECO/prognosis nagging)', () => {
    const concepts = fiveGroups({ P: [freetext('obesity')], I: [freetext('metformin')] });
    expect(computeStageStatuses({ concepts }).concepts).toBe('done');
  });
  it('partial when only one of P/I has live terms', () => {
    expect(computeStageStatuses({ concepts: fiveGroups({ P: [freetext('obesity')] }) }).concepts).toBe('partial');
    expect(computeStageStatuses({ concepts: fiveGroups({ I: [freetext('metformin')] }) }).concepts).toBe('partial');
  });
  it('disabled terms are NOT live (a switched-off P reads partial, not done)', () => {
    const concepts = fiveGroups({ P: [freetext('obesity', { disabled: true })], I: [freetext('metformin')] });
    expect(computeStageStatuses({ concepts }).concepts).toBe('partial');
  });
});

describe('terms stage', () => {
  const doneConcepts = () => fiveGroups({
    P: [freetext('obesity'), freetext('overweight')],
    I: [freetext('metformin'), freetext('biguanide')],
  });

  it('mirrors concepts while concepts are not done', () => {
    expect(computeStageStatuses({ concepts: fiveGroups() }).terms).toBe('empty');
    expect(computeStageStatuses({ concepts: fiveGroups({ P: [freetext('obesity')] }) }).terms).toBe('partial');
  });
  it('done when concepts are done, no pending suggestions and no warning-level QC finding', () => {
    expect(computeStageStatuses({ concepts: doneConcepts() }).terms).toBe('done');
  });
  it('attention when ≥1 vocabulary suggestion is pending', () => {
    const concepts = doneConcepts();
    concepts[0].terms[0] = freetext('obesity', { vocab: { mesh: 'Obesity' } });
    expect(computeStageStatuses({ concepts }).terms).toBe('attention');
  });
  it('rejected suggestions release the attention state (no dead-end status)', () => {
    const concepts = doneConcepts();
    concepts[0].terms[0] = freetext('obesity', { vocab: { mesh: 'Obesity' } });
    const rejected = [rejectionKey(concepts[0], 'obesity')];
    expect(computeStageStatuses({ concepts, rejected }).terms).toBe('done');
  });
  it('attention on a warning-severity quality finding; dismissing it releases', () => {
    const concepts = doneConcepts();
    // same term in two AND-ed concepts → multi: warning
    concepts[2].terms = [freetext('metformin')];
    const out = computeStageStatuses({ concepts });
    expect(out.terms).toBe('attention');
    const dismissed = computeStageStatuses({ concepts, dismissedWarnings: ['multi:fam:metformin', 'multi:metformin'] });
    expect(dismissed.terms).toBe('done');
  });
  it('info-severity findings (optional outcomes / narrow C-O guidance) never block done', () => {
    const concepts = doneConcepts();
    concepts[3].terms = [freetext('mortality')]; // outcomes populated → narrow:O info
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
  const concepts = fiveGroups({ P: [freetext('obesity')], I: [freetext('metformin')] });
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

describe('refine stage', () => {
  const concepts = fiveGroups({ P: [freetext('obesity')], I: [freetext('metformin')] });
  it('done only on a FRESH live count (honesty: stale/failed counts are not done)', () => {
    expect(computeStageStatuses({ concepts, hitState: { status: 'updated', hitCount: 120 } }).refine).toBe('done');
    expect(computeStageStatuses({ concepts, hitState: { status: 'stale', hitCount: 120 } }).refine).toBe('partial');
    expect(computeStageStatuses({ concepts, hitState: { status: 'failed' } }).refine).toBe('partial');
  });
  it('active limits count as started; nothing observed = empty', () => {
    expect(computeStageStatuses({ concepts, filters: { dateFrom: '2015', dateTo: '', languages: [], pubTypes: [] } }).refine).toBe('partial');
    expect(computeStageStatuses({ concepts }).refine).toBe('empty');
    expect(computeStageStatuses({ hitState: { status: 'updated', hitCount: 5 } }).refine).toBe('empty'); // no strategy → nothing to refine
  });
});

describe('results / documentation stages — never claimed done (visited-agnostic honesty)', () => {
  const concepts = fiveGroups({ P: [freetext('obesity')], I: [freetext('metformin')] });
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
    for (const junk of [null, undefined, 42, 'x', { concepts: 'bad', pico: 7, hitState: 'nope' }]) {
      const out = computeStageStatuses(junk);
      expect(Object.keys(out).sort()).toEqual([...STAGE_IDS].sort());
    }
  });
});
