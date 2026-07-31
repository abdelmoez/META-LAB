/**
 * searchMigrationFixtures.test.js — 96.md Phase 10 "Migration tests" (QA L30).
 *
 * Eight PURE module-level fixtures covering the persisted-state archetypes a
 * pre-96 (and freshly-96) project can carry, each pushed through the four
 * load-bearing seams every open of the Search workspace exercises:
 *
 *   1. pickPersisted / serializeSearchState — the load path MUST be
 *      signature-idempotent (loading and re-picking never changes the byte
 *      signature, so historical saves never trigger a spurious autosave);
 *   2. compileStrategy(…, 'pubmed') — the strategy compiler accepts the shape;
 *   3. computeStageStatuses — the stage rail derives without throwing and
 *      always emits all 7 stage ids;
 *   4. diffStrategies(x, x) — the version-diff round-trip reports no changes
 *      for an identical snapshot (identity stability incl. legacy picoField).
 *
 * Shapes mirror the realistic fixtures in searchState.test.js (five-group PICO
 * scaffold, Concepts-era field/label strings, legacy string[] ignored, …).
 * Plan invariants exercised: 1 (byte-stable signatures), 3 (legacy shapes load
 * forever).
 */
import { describe, it, expect } from 'vitest';
import {
  pickPersisted, serializeSearchState, seedStateFromQuestion,
} from '../../src/research-engine/searchBuilder/searchState.js';
import { computeStageStatuses, STAGE_IDS } from '../../src/research-engine/searchBuilder/stageStatus.js';
import { searchQualityCheck } from '../../src/research-engine/searchBuilder/crossConcept.js';
import { compileStrategy } from '../../src/research-engine/searchBuilder/compilers/index.js';
import { diffStrategies } from '../../src/research-engine/searchBuilder/versionDiff.js';

/* ── the 8 archetypes (96.md Phase 10) ─────────────────────────────────────── */

const term = (id, text, extra = {}) => ({ id, text, type: 'freetext', field: 'tiab', source: 'pico_auto', ...extra });

/** 1 — brand-new project, no PICO anywhere (revision-0 seed). */
const NEW_NO_PICO = {
  ...seedStateFromQuestion('Does metformin reduce mortality in adults with type 2 diabetes?'),
  overrides: {}, ignored: [],
};

/** 2 — legacy five-group PICO scaffold (P/I with terms; C/O empty; T note-only). */
const LEGACY_FIVE_GROUP = {
  concepts: [
    { id: 'cP', label: 'Population', picoField: 'P', field: 'Population', source: 'pico_auto', op: 'AND', terms: [term('t1', 'type 2 diabetes'), term('t2', 'T2DM', { vocab: { mesh: 'Diabetes Mellitus, Type 2', emtree: 'type 2 diabetes mellitus' }, type: 'controlled' })] },
    { id: 'cI', label: 'Intervention / Exposure', picoField: 'I', field: 'Intervention / Exposure', source: 'pico_auto', op: 'AND', terms: [term('t3', 'metformin'), term('t4', 'biguanide', { source: 'synonym' })] },
    { id: 'cC', label: 'Comparator / Control', picoField: 'C', field: 'Comparator / Control', source: 'pico_auto', op: 'AND', terms: [] },
    { id: 'cO', label: 'Outcomes', picoField: 'O', field: 'Outcomes', source: 'pico_auto', op: 'AND', terms: [] },
    { id: 'cT', label: 'Time Frame', picoField: 'T', field: 'Time Frame', source: 'pico_auto', op: 'AND', note: 'Last 5 years', terms: [] },
  ],
  overrides: {}, ignored: [{ text: 'adults', field: 'Population', label: 'Population' }],
  databases: ['pubmed', 'embase', 'cochrane'], readyForScreening: false, dismissedWarnings: [],
};

/** 3 — Concepts-era selections: legacy `field`/`label` strings, NO picoField. */
const LEGACY_CONCEPTS_ERA = {
  concepts: [
    { id: 'k1', label: 'Population', field: 'Population', source: 'pico_auto', op: 'AND', terms: [term('t1', 'heart failure')] },
    { id: 'k2', label: 'Intervention / Exposure', field: 'Intervention / Exposure', source: 'pico_auto', op: 'AND', terms: [term('t2', 'SGLT2 inhibitors'), term('t3', 'dapagliflozin', { disabled: true })] },
  ],
  overrides: {}, ignored: [],
};

/** 4 — generated strings / per-database manual overrides ride along. */
const WITH_OVERRIDES = {
  concepts: [
    { id: 'c1', label: 'heart failure', sourcePhrase: 'heart failure', source: 'user_added', op: 'AND', terms: [{ id: 't1', text: 'heart failure', type: 'freetext', field: 'tiab', source: 'user_added', phrase: true }] },
  ],
  overrides: { pubmed: '"heart failure"[tiab] AND humans[mh]', embase: "'heart failure'/exp" },
  ignored: [], databases: ['pubmed', 'embase'],
};

/** 5 — searchMode 'automated' stored alongside the strategy (73.md P5 key). */
const WITH_SEARCH_MODE = {
  ...WITH_OVERRIDES,
  searchMode: 'automated',
};

/** 6 — dismissedWarnings incl. RETIRED PICO-keyed ids + rejected-suggestion keys. */
const WITH_DISMISSALS = {
  ...LEGACY_FIVE_GROUP,
  dismissedWarnings: ['empty:P', 'novocab:I', 'narrow:C', 'outcomes-optional', 'multi:fam:eus'],
  rejectedSuggestions: ['cP|Population:mesh:diabetes mellitus', 'cI|Intervention / Exposure:fam:metformin'],
};

/** 7 — the OLDEST persisted `ignored` form: plain string[]. */
const WITH_STRING_IGNORED = {
  concepts: [{ id: 'c1', label: 'Population', picoField: 'P', field: 'Population', source: 'pico_auto', op: 'AND', terms: [term('t1', 'obesity')] }],
  overrides: {},
  ignored: ['overweight', 'bmi'],
};

/** 8 — version-snapshot-shaped strategy (what SearchStrategyVersion stores:
 *      concepts + databases + filters, incl. legacy picoField identity). */
const VERSION_SNAPSHOT_SHAPE = {
  concepts: [
    { id: 'cP', label: 'Population', picoField: 'P', field: 'Population', source: 'pico_auto', op: 'AND', terms: [term('t1', 'copd')] },
    { id: 'm1', label: 'Setting', source: 'user_added', op: 'OR', terms: [{ id: 't2', text: 'hospital', type: 'freetext', field: 'tiab', source: 'user_added' }] },
  ],
  overrides: {},
  ignored: [],
  databases: ['pubmed'],
  filters: { dateFrom: '2015', dateTo: '2025', languages: ['en'], pubTypes: ['Randomized Controlled Trial'] },
  questionSnapshot: 'Does pulmonary rehab help COPD patients in hospital?',
};

const FIXTURES = [
  ['1 new project, no PICO', NEW_NO_PICO],
  ['2 legacy PICO five-group scaffold', LEGACY_FIVE_GROUP],
  ['3 legacy Concepts-era selections', LEGACY_CONCEPTS_ERA],
  ['4 generated strings / overrides', WITH_OVERRIDES],
  ['5 searchMode automated', WITH_SEARCH_MODE],
  ['6 dismissedWarnings + rejected keys', WITH_DISMISSALS],
  ['7 legacy string[] ignored', WITH_STRING_IGNORED],
  ['8 version-snapshot-shaped concepts', VERSION_SNAPSHOT_SHAPE],
];

describe('96.md Phase 10 — migration fixtures load through every seam (QA L30)', () => {
  for (const [name, fx] of FIXTURES) {
    describe(name, () => {
      it('loads signature-idempotently through pickPersisted/serializeSearchState (no spurious autosave)', () => {
        const once = pickPersisted(fx);
        // Loading is signature-stable: re-picking the picked state changes nothing.
        expect(serializeSearchState(once)).toBe(serializeSearchState(fx));
        expect(serializeSearchState(pickPersisted(once))).toBe(serializeSearchState(fx));
        // …and legacy concept shapes ride through UNTOUCHED (invariant 3).
        expect(once.concepts).toEqual(Array.isArray(fx.concepts) ? fx.concepts : []);
      });
      it("compiles through compileStrategy('pubmed') without throwing", () => {
        const r = compileStrategy({ concepts: fx.concepts, overrides: fx.overrides, filters: fx.filters }, 'pubmed');
        expect(typeof r.query).toBe('string');
        expect(Array.isArray(r.warnings)).toBe(true);
      });
      it('derives all 7 stage statuses without throwing', () => {
        const st = computeStageStatuses({
          concepts: fx.concepts,
          question: fx.questionSnapshot || '',
          filters: fx.filters, overrides: fx.overrides,
          databases: fx.databases, dismissedWarnings: fx.dismissedWarnings,
          rejected: fx.rejectedSuggestions, searchMode: fx.searchMode || null,
        });
        expect(Object.keys(st).sort()).toEqual([...STAGE_IDS].sort());
        for (const id of STAGE_IDS) expect(['done', 'partial', 'empty', 'attention']).toContain(st[id]);
      });
      it('round-trips versionDiff: an identical snapshot reports NO changes', () => {
        const d = diffStrategies(fx, fx);
        expect(d.changed).toBe(false);
        expect(d.concepts).toEqual({ added: [], removed: [] });
        expect(d.terms).toEqual([]);
      });
    });
  }

  it('L23 sanity — the legacy five-group scaffold raises NO empty-group warnings', () => {
    // Intentionally-empty C/O scaffold groups must not wake historical projects
    // up with `empty:<id>` warnings (crossConcept exempts legacy groups); any
    // remaining 'attention' can only come from live suggestions, never from the
    // scaffold's empty groups.
    const findings = searchQualityCheck(LEGACY_FIVE_GROUP.concepts);
    expect(findings.filter((w) => w.id.startsWith('empty:'))).toEqual([]);
  });
});
