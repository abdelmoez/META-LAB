/**
 * opsSettingsCatalog.test.js — 109.md §§3, 5, 42, 43.
 *
 * The typed Ops settings catalogue is now the single source for the feature-flag
 * defaults, both dependency graphs, server-side coercion and the audit diff. That
 * only holds if nothing drifts away from it again, so this file is as much a
 * DRIFT GATE as a unit test:
 *
 *   - flagDefaults() must equal settingsController's DEFAULTS.featureFlags;
 *   - server featureAccess.FEATURE_DEPS and the client featureFlagState mirror
 *     must be the SAME object as the catalogue's (they were hand-copied before);
 *   - the four 107/108 flags must default ON (a default of OFF silently regresses
 *     shipped v4.13 behaviour on upgrade);
 *   - 'scientific' and 'env' entries must be unwritable BY CONSTRUCTION.
 */
import { restoreShellEnv } from '../screening/helpers/prismaEnvGuard.js'; // FIRST import
import { describe, it, expect } from 'vitest';
import {
  OPS_FLAGS, VISIBLE_FLAGS, FLAG_KEYS, FLAG_KEY_SET, flagDefaults, flagEntry,
  FEATURE_DEPS, FEATURE_RUNTIME_DEPS, coerceFlagPatch,
  OPS_SETTINGS, RESEARCH_GOVERNANCE_KEY, DANGER, SOURCE, SETTING_TYPES,
  catalogEntry, isWritable, settingsForDomain, defaultsForDomain, mergeDomainDefaults,
  coerceSettingValue, coerceDomainPatch, diffDomainValues, resetDomainToDefaults,
  searchCatalog, catalogByCategory, CATALOG_CATEGORIES, WRITABLE_DOMAINS,
} from '../../src/shared/opsSettingsCatalog.js';
import { defaultFeatureFlags } from '../../server/controllers/settingsController.js';
import { FEATURE_DEPS as SERVER_DEPS, FEATURE_RUNTIME_DEPS as SERVER_RUNTIME_DEPS } from '../../server/services/featureAccess.js';
import { FEATURE_DEPS as CLIENT_DEPS, FEATURE_RUNTIME_DEPS as CLIENT_RUNTIME_DEPS } from '../../src/frontend/featureAccess/featureFlagState.js';

restoreShellEnv();

const G = RESEARCH_GOVERNANCE_KEY;

describe('flag registry — drift gate', () => {
  it('flagDefaults() matches the server DEFAULTS.featureFlags exactly', () => {
    const catalogue = flagDefaults();
    const server = defaultFeatureFlags();
    expect(Object.keys(catalogue).sort()).toEqual(Object.keys(server).sort());
    for (const k of Object.keys(server)) {
      expect(`${k}=${catalogue[k]}`).toBe(`${k}=${server[k]}`);
    }
  });

  it('every catalogue flag has a label and a description (no internal jargon in Ops)', () => {
    for (const f of OPS_FLAGS) {
      expect(typeof f.label, f.key).toBe('string');
      expect(f.label.length, f.key).toBeGreaterThan(0);
      expect(f.description.length, f.key).toBeGreaterThan(20);
      expect(typeof f.default, f.key).toBe('boolean');
    }
  });

  it('the four 107/108 flags default ON so an upgrade cannot regress shipped behaviour', () => {
    for (const key of ['keywordSuggestions', 'abstractKeywordShortcuts', 'keywordContextMenu', 'projectUndoRedo']) {
      expect(flagEntry(key), key).toBeTruthy();
      expect(flagDefaults()[key], key).toBe(true);
      expect(defaultFeatureFlags()[key], key).toBe(true);
    }
  });

  it('previously UI-invisible flags now have catalogue rows (the FLAG_META drift)', () => {
    for (const key of ['relationalProjectStore', 'researchProvenance', 'aiExtraction']) {
      const e = flagEntry(key);
      expect(e, key).toBeTruthy();
      expect(e.deprecated).toBeUndefined();
    }
  });

  it('the retired searchWorkspaceV2 key still parses but is hidden from Ops', () => {
    expect(FLAG_KEY_SET.has('searchWorkspaceV2')).toBe(true);
    expect(VISIBLE_FLAGS.some((f) => f.key === 'searchWorkspaceV2')).toBe(false);
  });

  it('flag keys are unique', () => {
    expect(new Set(FLAG_KEYS).size).toBe(FLAG_KEYS.length);
  });
});

describe('feature dependency graphs — one object, three consumers', () => {
  it('server and client re-export the SAME frozen catalogue graph', () => {
    expect(SERVER_DEPS).toBe(FEATURE_DEPS);
    expect(CLIENT_DEPS).toBe(FEATURE_DEPS);
    expect(SERVER_RUNTIME_DEPS).toBe(FEATURE_RUNTIME_DEPS);
    expect(CLIENT_RUNTIME_DEPS).toBe(FEATURE_RUNTIME_DEPS);
  });

  it('the hard graph is exactly the pre-109 table (no gate semantics changed)', () => {
    expect(JSON.parse(JSON.stringify(FEATURE_DEPS))).toEqual({
      guidedRobAppraisal: ['rob_engine_v2'],
      pecanSearch: ['searchEngine'],
      searchStrategyStudio: ['searchEngine', 'pecanSearch'],
    });
  });

  it('livingReview stays an ADVISORY dependency, never an existence gate', () => {
    expect(FEATURE_DEPS.livingReview).toBeUndefined();
    expect(JSON.parse(JSON.stringify(FEATURE_RUNTIME_DEPS))).toEqual({ livingReview: ['pecanSearch'] });
  });

  it('every dependency names a real flag', () => {
    for (const deps of [...Object.values(FEATURE_DEPS), ...Object.values(FEATURE_RUNTIME_DEPS)]) {
      for (const d of deps) expect(FLAG_KEY_SET.has(d), d).toBe(true);
    }
  });
});

describe('coerceFlagPatch', () => {
  const current = flagDefaults();

  it('accepts known boolean flags and reports what changed', () => {
    const { next, changed, rejected } = coerceFlagPatch({ projectUndoRedo: false }, current);
    expect(next.projectUndoRedo).toBe(false);
    expect(changed).toEqual(['projectUndoRedo']);
    expect(rejected).toEqual([]);
  });

  it('drops unknown keys and non-boolean values instead of persisting them', () => {
    const { next, changed, rejected } = coerceFlagPatch(
      { notAFlag: true, autosave: 'yes', __proto__: { evil: true } }, current,
    );
    expect(next.notAFlag).toBeUndefined();
    expect(next.autosave).toBe(true); // unchanged, not coerced from the string
    expect(changed).toEqual([]);
    expect(rejected).toContain('notAFlag');
    expect(rejected).toContain('autosave');
  });

  it('keys the patch omits keep their stored value (read-merge-write)', () => {
    const stored = { ...current, aiScreening: true };
    const { next } = coerceFlagPatch({ projectUndoRedo: false }, stored);
    expect(next.aiScreening).toBe(true);
  });

  it('stored-but-unknown keys survive so a rollback keeps its flag state', () => {
    const { next } = coerceFlagPatch({}, { ...current, someFutureFlag: true });
    expect(next.someFutureFlag).toBe(true);
  });

  it('a no-op patch reports no changes', () => {
    expect(coerceFlagPatch({ autosave: true }, current).changed).toEqual([]);
  });

  it('a junk `current` falls back to the defaults rather than throwing', () => {
    expect(coerceFlagPatch({}, null).next.autosave).toBe(true);
    expect(coerceFlagPatch(null, undefined).next.contactForm).toBe(true);
  });
});

describe('catalogue shape invariants', () => {
  it('setting keys are unique and every entry declares type/category/danger/source', () => {
    const keys = OPS_SETTINGS.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    const catIds = new Set(CATALOG_CATEGORIES.map((c) => c.id));
    const types = new Set(Object.values(SETTING_TYPES));
    for (const e of OPS_SETTINGS) {
      expect(types.has(e.type), e.key).toBe(true);
      expect(catIds.has(e.category), e.key).toBe(true);
      expect(Object.values(DANGER).includes(e.danger), e.key).toBe(true);
      expect(Object.values(SOURCE).includes(e.source), e.key).toBe(true);
      expect(String(e.label).length, e.key).toBeGreaterThan(0);
      expect(String(e.description).length, e.key).toBeGreaterThan(20);
    }
  });

  it("'scientific' and 'env' entries are unwritable and carry a rationale", () => {
    for (const e of OPS_SETTINGS) {
      if (e.danger !== DANGER.SCIENTIFIC && e.danger !== DANGER.ENV) continue;
      expect(isWritable(e), e.key).toBe(false);
      expect(e.domain, e.key).toBeUndefined();
      expect(String(e.rationale || '').length, e.key).toBeGreaterThan(20);
    }
  });

  it("every 'env' entry names its variable and never carries a value to echo", () => {
    const envEntries = OPS_SETTINGS.filter((e) => e.danger === DANGER.ENV);
    expect(envEntries.length).toBeGreaterThanOrEqual(9);
    for (const e of envEntries) {
      expect(typeof e.envVar, e.key).toBe('string');
      expect(e.source, e.key).toBe(SOURCE.ENVIRONMENT);
      expect(e.domain, e.key).toBeUndefined();
    }
    for (const v of ['SCREEN_DUP_STUCK_MS', 'SCREEN_DUP_MAX_BLOCK', 'SCREEN_DUP_MAX_COMPARISONS',
      'SCREEN_DUP_MAX_ACTIVE_PER_USER', 'SCREEN_DUP_MAX_GROUP_SIZE']) {
      expect(envEntries.some((e) => e.envVar === v), v).toBe(true);
    }
  });

  it('the proportion compatibility guard has no off switch (109.md §§2, 30)', () => {
    const e = catalogEntry('analysis.compatibilityGuard');
    expect(e.default).toBe(true);
    expect(e.danger).toBe(DANGER.SCIENTIFIC);
    expect(isWritable(e)).toBe(false);
    expect(coerceSettingValue(e, false).ok).toBe(false);
  });

  it('the stored enum registries are read-only and keep identifier separate from label', () => {
    for (const key of ['extraction.denominatorPopulations', 'extraction.actionStatuses']) {
      const e = catalogEntry(key);
      expect(isWritable(e), key).toBe(false);
      for (const o of e.default) {
        expect(typeof o.value, key).toBe('string');
        expect(typeof o.label, key).toBe('string');
      }
    }
    expect(catalogEntry('extraction.denominatorPopulations').default.map((o) => o.value))
      .toEqual(['plp_molecular_diagnoses', 'all_patients_tested', 'patients_with_management_change',
        'patients_with_follow_up', 'other']);
    expect(catalogEntry('extraction.actionStatuses').default.map((o) => o.value))
      .toEqual(['implemented', 'recommended_planned', 'potential_theoretical', 'unclear']);
  });

  it('the ambiguous-keyword conflict enum has no "silently activate in both lists" option', () => {
    const opts = catalogEntry('keywords.conflictBehavior').options.map((o) => o.value);
    expect(opts).toEqual(['flag_for_review', 'omit_ambiguous', 'prevent_duplicate_activation']);
    expect(catalogEntry('keywords.conflictBehavior').default).toBe('flag_for_review');
  });

  it('the relocated duplicate-detection toggle is not writable through this catalogue', () => {
    const e = catalogEntry('duplicates.allowDuplicateDetection');
    expect(e.domain).toBe('metaSiftSettings');
    expect(e.managedBy).toBe('metaSiftSettings');
    expect(isWritable(e)).toBe(false);
    expect(WRITABLE_DOMAINS).toEqual([G]);
  });
});

describe('defaults + merge for the research-governance domain', () => {
  it('defaultsForDomain covers every writable entry, keyed by stored path', () => {
    const d = defaultsForDomain(G);
    for (const e of settingsForDomain(G)) expect(d).toHaveProperty(e.path);
    expect(d.historyCap).toBe(20);
    expect(d.autoLoadMoreEnabled).toBe(true);
    expect(d.percentDisplayDecimals).toBe(1);
    expect(d.conflictBehavior).toBe('flag_for_review');
    expect(d.stopListAdditions).toEqual([]);
  });

  it('array defaults are copies, so a caller cannot mutate the catalogue', () => {
    const a = defaultsForDomain(G).stopListAdditions;
    a.push('leak');
    expect(defaultsForDomain(G).stopListAdditions).toEqual([]);
  });

  it('mergeDomainDefaults lets a stored value win and backfills new keys', () => {
    const merged = mergeDomainDefaults(G, { historyCap: 50 });
    expect(merged.historyCap).toBe(50);
    expect(merged.undoToastMs).toBe(8000);
  });

  it('mergeDomainDefaults tolerates a junk stored blob', () => {
    for (const junk of [null, undefined, 'nope', [], 42]) {
      expect(mergeDomainDefaults(G, junk).historyCap).toBe(20);
    }
  });
});

describe('coerceDomainPatch', () => {
  const current = defaultsForDomain(G);

  it('clamps numbers into the declared range and rounds to integers', () => {
    expect(coerceDomainPatch(G, { historyCap: 9999 }, current).next.historyCap).toBe(100);
    expect(coerceDomainPatch(G, { historyCap: -5 }, current).next.historyCap).toBe(5);
    expect(coerceDomainPatch(G, { historyCap: 33.7 }, current).next.historyCap).toBe(34);
    expect(coerceDomainPatch(G, { autoLoadMoreBatchSize: 100000 }, current).next.autoLoadMoreBatchSize).toBe(200);
    expect(coerceDomainPatch(G, { percentDisplayDecimals: 9 }, current).next.percentDisplayDecimals).toBe(3);
  });

  it('rejects non-numeric numbers and non-boolean booleans without writing them', () => {
    const r = coerceDomainPatch(G, { historyCap: 'lots', autoLoadMoreEnabled: 'yes' }, current);
    expect(r.next.historyCap).toBe(20);
    expect(r.next.autoLoadMoreEnabled).toBe(true);
    expect(r.rejected.map((x) => x.key).sort()).toEqual(['interaction.historyCap', 'screening.autoLoadMore']);
    expect(r.changed).toEqual([]);
  });

  it('filters enums to the declared option list', () => {
    expect(coerceDomainPatch(G, { conflictBehavior: 'omit_ambiguous' }, current).next.conflictBehavior)
      .toBe('omit_ambiguous');
    const bad = coerceDomainPatch(G, { conflictBehavior: 'put_it_in_both' }, current);
    expect(bad.next.conflictBehavior).toBe('flag_for_review');
    expect(bad.rejected[0].key).toBe('keywords.conflictBehavior');
  });

  it('normalises, dedupes, lowercases and bounds string lists', () => {
    const { next } = coerceDomainPatch(G, {
      stopListAdditions: ['  Patient ', 'patient', 'STUDY', 42, null, 'x'.repeat(200)],
    }, current);
    expect(next.stopListAdditions).toEqual(['patient', 'study', 'x'.repeat(64)]);
  });

  it('accepts either the catalogue key or the stored path', () => {
    expect(coerceDomainPatch(G, { 'interaction.historyCap': 40 }, current).next.historyCap).toBe(40);
    expect(coerceDomainPatch(G, { historyCap: 40 }, current).next.historyCap).toBe(40);
  });

  it('drops unknown keys and read-only entries — Ops cannot write a scientific setting', () => {
    const r = coerceDomainPatch(G, {
      evil: 1, __proto__: { x: 1 },
      'analysis.compatibilityGuard': false,
      'duplicates.env.SCREEN_DUP_MAX_BLOCK': 1,
      'duplicates.allowDuplicateDetection': false,
    }, current);
    expect(r.next.evil).toBeUndefined();
    expect(r.next.compatibilityGuard).toBeUndefined();
    expect(r.next.allowDuplicateDetection).toBeUndefined();
    expect(r.changed).toEqual([]);
    expect(r.rejected.length).toBeGreaterThanOrEqual(4);
  });

  it('does not mutate the current object it was given', () => {
    const snapshot = { ...current };
    coerceDomainPatch(G, { historyCap: 60 }, current);
    expect(current).toEqual(snapshot);
  });

  it('keys the patch omits are preserved (read-merge-write, not whole-blob)', () => {
    const stored = { ...current, undoToastMs: 3000 };
    expect(coerceDomainPatch(G, { historyCap: 60 }, stored).next.undoToastMs).toBe(3000);
  });
});

describe('audit diff + reset (109.md §§42, 43)', () => {
  it('diffDomainValues reports one labelled row per changed setting', () => {
    const before = defaultsForDomain(G);
    const after = { ...before, historyCap: 50, undoToastEnabled: false };
    const rows = diffDomainValues(G, before, after);
    expect(rows.map((r) => r.key).sort()).toEqual(['interaction.historyCap', 'interaction.undoToastEnabled']);
    const cap = rows.find((r) => r.key === 'interaction.historyCap');
    expect(cap.from).toBe(20);
    expect(cap.to).toBe(50);
    expect(cap.scope).toBe('global');
    expect(cap.label).toBe(catalogEntry('interaction.historyCap').label);
  });

  it('an unchanged write produces an empty diff (no audit noise)', () => {
    expect(diffDomainValues(G, defaultsForDomain(G), defaultsForDomain(G))).toEqual([]);
  });

  it('list changes are diffed by content, not identity', () => {
    const before = defaultsForDomain(G);
    expect(diffDomainValues(G, before, { ...before, stopListAdditions: [] })).toEqual([]);
    expect(diffDomainValues(G, before, { ...before, stopListAdditions: ['patient'] })).toHaveLength(1);
  });

  it('resetDomainToDefaults previews exactly what will change', () => {
    const current = { ...defaultsForDomain(G), historyCap: 95, conflictBehavior: 'omit_ambiguous' };
    const { next, changes } = resetDomainToDefaults(G, current);
    expect(next).toEqual(defaultsForDomain(G));
    expect(changes.map((c) => c.key).sort())
      .toEqual(['interaction.historyCap', 'keywords.conflictBehavior']);
  });
});

describe('settings search (109.md §44)', () => {
  it('"undo" surfaces the flag, the history cap, the toast settings and the redo alias', () => {
    const keys = searchCatalog('undo').map((r) => r.entry.key);
    expect(keys).toContain('projectUndoRedo');
    expect(keys).toContain('interaction.historyCap');
    expect(keys).toContain('interaction.undoToastEnabled');
    expect(keys).toContain('interaction.ctrlYRedoAlias');
  });

  it('"duplicate" surfaces the duplicate-detection entries', () => {
    const keys = searchCatalog('duplicate').map((r) => r.entry.key);
    expect(keys).toContain('duplicates.allowDuplicateDetection');
    expect(keys.some((k) => k.startsWith('duplicates.env.'))).toBe(true);
  });

  it('matches the internal key too, and returns nothing for an empty query', () => {
    expect(searchCatalog('percentDisplayDecimals').map((r) => r.entry.key))
      .toContain('extraction.percentDisplayDecimals');
    expect(searchCatalog('   ')).toEqual([]);
  });

  it('retired flags never appear in search results', () => {
    expect(searchCatalog('searchWorkspaceV2')).toEqual([]);
  });
});

describe('catalogByCategory', () => {
  it('groups every entry into a declared category, in sidebar order', () => {
    const groups = catalogByCategory();
    expect(groups.map((g) => g.id)).toEqual(CATALOG_CATEGORIES.map((c) => c.id));
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(OPS_SETTINGS.length);
    for (const g of groups) expect(g.entries.length, g.id).toBeGreaterThan(0);
  });
});
