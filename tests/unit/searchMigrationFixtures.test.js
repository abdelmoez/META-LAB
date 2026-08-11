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
 *   3. computeStageModel — the stage rail derives without throwing and always
 *      emits all 6 stage ids (98.md §3 — no 'question' status) plus the 114.md
 *      §2 advisory counts;
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
import { computeStageStatuses, computeStageModel, STAGE_IDS } from '../../src/research-engine/searchBuilder/stageStatus.js';
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

/** 9 — (97.md) legacy five-group scaffold whose Population was USER-RENAMED —
 *      migration must preserve the custom name forever. */
const LEGACY_RENAMED_GROUP = {
  ...LEGACY_FIVE_GROUP,
  concepts: LEGACY_FIVE_GROUP.concepts.map((c, i) => (i === 0 ? { ...c, label: 'People with diabetes' } : c)),
};

/** 10 — (97.md) ALREADY-MIGRATED doc: neutral labels + per-concept labelMigrated
 *       marker, picoField RETAINED (invariant 5). Must load byte-stably and
 *       re-migrate as a no-op. */
const MIGRATED_NEUTRAL_LABELS = {
  concepts: [
    { id: 'cP', label: 'Search Group 1', labelMigrated: 1, picoField: 'P', field: 'Population', source: 'pico_auto', op: 'AND', terms: [term('t1', 'type 2 diabetes')] },
    { id: 'cI', label: 'Search Group 2', labelMigrated: 1, picoField: 'I', field: 'Intervention / Exposure', source: 'pico_auto', op: 'AND', terms: [term('t2', 'metformin')] },
    { id: 'cT', label: 'Search Group 3', labelMigrated: 1, picoField: 'T', field: 'Time Frame', source: 'pico_auto', op: 'AND', note: 'Last 5 years', terms: [] },
  ],
  overrides: {}, ignored: [],
};

/** 11 — (97.md) post-97 doc: `meta` top-level key + concept-riding term fields
 *       (dupOverride, components) — everything the 97 state layer persists. */
const WITH_META_AND_OVERRIDES = {
  concepts: [
    {
      id: 'g1',
      label: 'Search Group 1',
      sourcePhrase: 'EUS',
      source: 'user_added',
      op: 'AND',
      terms: [{ id: 't1', text: 'EUS', type: 'freetext', field: 'tiab', source: 'user_added', dupOverride: { key: 'eus', groups: ['g1', 'g2'] } }],
    },
    {
      id: 'g2',
      label: 'Search Group 2',
      source: 'user_added',
      op: 'AND',
      terms: [
        { id: 't2', text: 'eus', type: 'freetext', field: 'tiab', source: 'copied', dupOverride: { key: 'eus', groups: ['g1', 'g2'] } },
        { id: 't3', text: 'sodium-glucose cotransporter 2', type: 'freetext', field: 'tiab', source: 'user_added', phrase: true, components: [{ text: 'sodium-glucose' }, { text: 'cotransporter' }, { text: '2' }] },
      ],
    },
  ],
  overrides: {}, ignored: [],
  questionSnapshot: 'EUS drainage with SGLT2?',
  meta: {
    generatedAt: '2026-08-02T10:00:00.000Z',
    generatedBy: { id: 'u1', name: 'Ada' },
    sourceQuestion: 'EUS drainage with SGLT2?',
    manuallyModifiedAt: '2026-08-02T11:00:00.000Z',
    manuallyModifiedBy: { id: 'u1', name: 'Ada' },
  },
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
  ['9 (97) user-renamed legacy group', LEGACY_RENAMED_GROUP],
  ['10 (97) already-migrated neutral labels', MIGRATED_NEUTRAL_LABELS],
  ['11 (97) meta + dupOverride + components', WITH_META_AND_OVERRIDES],
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
      it('derives all 6 stage statuses (+ the advisory channel) without throwing', () => {
        const opts = {
          concepts: fx.concepts,
          overrides: fx.overrides,
          databases: fx.databases, dismissedWarnings: fx.dismissedWarnings,
          rejected: fx.rejectedSuggestions, searchMode: fx.searchMode || null,
        };
        const { statuses: st, advisories } = computeStageModel(opts);
        expect(Object.keys(st).sort()).toEqual([...STAGE_IDS].sort());
        for (const id of STAGE_IDS) expect(['done', 'partial', 'empty', 'attention']).toContain(st[id]);
        // 114.md §2 — advisories recompute from the SAME persisted inputs
        // (rejectedSuggestions / dismissedWarnings), so a reload reproduces them.
        expect(computeStageStatuses(opts)).toEqual(st);
        for (const k of ['suggestions', 'warnings', 'total']) {
          expect(Number.isFinite(advisories.terms[k])).toBe(true);
          expect(advisories.terms[k]).toBeGreaterThanOrEqual(0);
        }
        expect(advisories.terms.total).toBe(advisories.terms.suggestions + advisories.terms.warnings);
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
    // up with `empty:<id>` warnings (crossConcept exempts legacy groups). Since
    // 114.md §2 those warnings are advisory rather than a status anyway — this
    // pins that a migrated project opens with a clean advisory count too.
    const findings = searchQualityCheck(LEGACY_FIVE_GROUP.concepts);
    expect(findings.filter((w) => w.id.startsWith('empty:'))).toEqual([]);
  });
});

/* ══════════════ 97.md Phase 15 — legacy-label migration through the seams ═══════ */

import { migrateLegacyGroupLabels } from '../../src/research-engine/searchBuilder/searchState.js';

describe('97.md — migrateLegacyGroupLabels across the archetypes (98.md §8 — Concept N)', () => {
  it('archetype 2 (five-group scaffold) converts ONCE to Concept 1..5, then no-ops by signature', () => {
    const once = migrateLegacyGroupLabels(LEGACY_FIVE_GROUP.concepts);
    expect(once.map((c) => c.label)).toEqual(['Concept 1', 'Concept 2', 'Concept 3', 'Concept 4', 'Concept 5']);
    expect(once.map((c) => c.picoField)).toEqual(['P', 'I', 'C', 'O', 'T']); // retained (invariant 5)
    const state = (concepts) => serializeSearchState({ ...LEGACY_FIVE_GROUP, concepts });
    expect(state(once)).not.toBe(state(LEGACY_FIVE_GROUP.concepts)); // signature flips exactly once…
    expect(migrateLegacyGroupLabels(once)).toBe(once);               // …then the SAME array forever
    expect(state(migrateLegacyGroupLabels(once))).toBe(state(once));
  });

  it('archetype 3 (Concepts-era, no picoField) converts by canonical label too', () => {
    const out = migrateLegacyGroupLabels(LEGACY_CONCEPTS_ERA.concepts);
    expect(out.map((c) => c.label)).toEqual(['Concept 1', 'Concept 2']);
    expect(out.every((c) => c.labelMigrated === 2)).toBe(true);
  });

  it('archetype 9 (user-renamed group) keeps the custom name and gets no marker', () => {
    const out = migrateLegacyGroupLabels(LEGACY_RENAMED_GROUP.concepts);
    expect(out[0].label).toBe('People with diabetes');
    expect(out[0].labelMigrated).toBeUndefined();
    expect(out[1].label).toBe('Concept 2');
  });

  it('98.md §8 — archetypes 10/11 (97-era "Search Group N" defaults) take the SECOND one-shot pass', () => {
    // The 97-era default labels are renamed Concept N (SAME number — position is
    // irrelevant), marker bumps to 2; then the doc is byte-stable forever.
    for (const fx of [MIGRATED_NEUTRAL_LABELS, WITH_META_AND_OVERRIDES]) {
      const once = migrateLegacyGroupLabels(fx.concepts);
      expect(once).not.toBe(fx.concepts);
      once.forEach((c, i) => {
        const m = /^Search Group (\d+)$/.exec(fx.concepts[i].label);
        expect(c.label).toBe(m ? `Concept ${m[1]}` : fx.concepts[i].label);
        expect(c.labelMigrated).toBe(2);
      });
      expect(migrateLegacyGroupLabels(once)).toBe(once); // idempotent from here on
    }
  });

  it('archetypes 1/4 (no legacy groups) and a 98-era Concept-labeled doc are byte-stable no-ops', () => {
    const CONCEPT_LABELED = {
      concepts: [
        { id: 'g1', label: 'Concept 1', labelMigrated: 2, source: 'user_added', op: 'AND', terms: [] },
        { id: 'g2', label: 'Drainage', source: 'user_added', op: 'AND', terms: [] },
      ],
      overrides: {}, ignored: [],
    };
    for (const fx of [NEW_NO_PICO, WITH_OVERRIDES, CONCEPT_LABELED]) {
      expect(migrateLegacyGroupLabels(fx.concepts || [])).toBe(fx.concepts || []); // SAME reference
      expect(serializeSearchState({ ...fx, concepts: migrateLegacyGroupLabels(fx.concepts || []) }))
        .toBe(serializeSearchState(fx));
    }
  });

  it('the migrated scaffold STILL raises no empty-group warnings (picoField retained → exemptions hold)', () => {
    const findings = searchQualityCheck(migrateLegacyGroupLabels(LEGACY_FIVE_GROUP.concepts));
    expect(findings.filter((w) => w.id.startsWith('empty:'))).toEqual([]);
  });
});
