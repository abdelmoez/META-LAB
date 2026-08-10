/**
 * opsGovernanceClient.test.js — 109.md §§5, 16, 29, 36 (W2-B).
 *
 * The client half of the Ops control plane. Every case here answers one of two
 * questions:
 *   1. DEFAULT-ON: does an absent/failed flag snapshot resolve to the catalogue
 *      default rather than "off"? (An upgrade must never regress a shipped feature.)
 *   2. NO CHANGE AT DEFAULTS: does each newly-wired knob reproduce the pre-109
 *      behaviour byte-for-byte when it holds its catalogue default?
 *
 * Pure modules only — no jsdom, no React rendering (the house style).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  GOVERNANCE_DEFAULTS, resolveFlag, resolveFlags, governanceSettings, resetGovernanceCache,
} from '../../src/frontend/featureAccess/opsGovernance.js';
import {
  RESEARCH_GOVERNANCE_KEY, mergeDomainDefaults, flagDefaults, catalogEntry,
} from '../../src/shared/opsSettingsCatalog.js';
import {
  suggestCriteriaKeywords, resolveSuggestionOptions, effectiveStopList,
  MAX_SUGGESTIONS_PER_SIDE, CONFLICT_BEHAVIOR,
} from '../../src/research-engine/screening/suggestKeywords.js';
import {
  HISTORY_CAP, historyCap, setHistoryCap, resetHistoryCap,
  emptyHistory, recordAction, counts,
} from '../../src/research-engine/interaction/historyStacks.js';
import { isRedoChord } from '../../src/research-engine/interaction/undoChords.js';
import { dismissDelayMs, AUTO_DISMISS_MS } from '../../src/frontend/screening/components/KeywordSnackbar.jsx';
import { percentDecimals, formatProportionDisplay } from '../../src/research-engine/extraction/proportionMeta.js';
import { resolveBatchSize } from '../../src/frontend/screening/tabs/ScreeningTab.jsx';

/* ══════════════════════════ 1. flags — default ON ══════════════════════════ */

describe('109.md §5 — the 107/108 kill switches resolve DEFAULT-ON', () => {
  const shipped = ['keywordSuggestions', 'abstractKeywordShortcuts', 'keywordContextMenu', 'projectUndoRedo'];

  it('every one of the four defaults to true in the catalogue', () => {
    for (const k of shipped) expect(flagDefaults()[k]).toBe(true);
  });

  it('an ABSENT key reads as its default, not as off (old server / failed fetch)', () => {
    for (const k of shipped) {
      expect(resolveFlag(null, k)).toBe(true);          // no snapshot at all
      expect(resolveFlag({}, k)).toBe(true);            // server predates the flag
      expect(resolveFlag({ autosave: true }, k)).toBe(true);
    }
  });

  it('an explicit false is honoured — the operator kill switch really kills', () => {
    for (const k of shipped) expect(resolveFlag({ [k]: false }, k)).toBe(false);
  });

  it('a non-boolean stored value is NOT treated as on', () => {
    expect(resolveFlag({ keywordSuggestions: 'yes' }, 'keywordSuggestions')).toBe(false);
    expect(resolveFlag({ keywordSuggestions: 1 }, 'keywordSuggestions')).toBe(false);
  });

  it('a flag that defaults OFF still defaults OFF when absent', () => {
    expect(resolveFlag({}, 'rob_engine_v2')).toBe(false);
    expect(resolveFlag(null, 'aiScreening')).toBe(false);
  });

  it('hard dependencies still gate a flag the server DID send', () => {
    // pecanSearch requires searchEngine.
    expect(resolveFlag({ pecanSearch: true, searchEngine: false }, 'pecanSearch')).toBe(false);
    expect(resolveFlag({ pecanSearch: true, searchEngine: true }, 'pecanSearch')).toBe(true);
  });

  it('resolveFlags maps a whole list', () => {
    expect(resolveFlags({}, shipped)).toEqual({
      keywordSuggestions: true, abstractKeywordShortcuts: true,
      keywordContextMenu: true, projectUndoRedo: true,
    });
    expect(resolveFlags(null, [])).toEqual({});
  });
});

/* ══════════════════════ 2. governance snapshot defaults ════════════════════ */

describe('109.md §3 — the client governance snapshot', () => {
  beforeEach(() => resetGovernanceCache());

  it('starts at the catalogue defaults, so the synchronous reader is never undefined', () => {
    expect(governanceSettings()).toEqual(mergeDomainDefaults(RESEARCH_GOVERNANCE_KEY, null));
  });

  it('GOVERNANCE_DEFAULTS carries every writable research-governance path', () => {
    for (const key of [
      'keyboardNavigationEnabled', 'autoLoadMoreEnabled', 'autoLoadMoreBatchSize',
      'blockNavigationWhileLoading', 'decisionIndicatorsEnabled', 'selectedRowAutoScroll',
      'keywordSuggestionsDefaultOn', 'maxSuggestionsPerList', 'preferPhrases',
      'allowAmbiguousSingleWords', 'conflictBehavior', 'stopListAdditions', 'stopListRemovals',
      'historyCap', 'undoToastEnabled', 'undoToastMs', 'redoEnabled', 'ctrlYRedoAlias',
      'percentDisplayDecimals', 'allowCompatibilityOverride', 'requireOverrideRationale',
    ]) {
      expect(GOVERNANCE_DEFAULTS, key).toHaveProperty(key);
    }
  });
});

/* ═════════════ 3. keyword suggestions — §§11-13, unchanged at defaults ═════ */

const PICO = {
  incl: 'Adults with drug-resistant epilepsy undergoing bariatric surgery',
  excl: 'Patients without confirmed molecular diagnosis; animal studies',
};

describe('109.md §§11-13 — the keyword-suggestion knobs', () => {
  it('no options == the shipped 107 output, exactly', () => {
    const base = suggestCriteriaKeywords(PICO);
    expect(suggestCriteriaKeywords(PICO, undefined)).toEqual(base);
    expect(suggestCriteriaKeywords(PICO, {})).toEqual(base);
    // …and passing every catalogue DEFAULT explicitly changes nothing either.
    expect(suggestCriteriaKeywords(PICO, {
      maxSuggestionsPerList: GOVERNANCE_DEFAULTS.maxSuggestionsPerList,
      preferPhrases: GOVERNANCE_DEFAULTS.preferPhrases,
      allowAmbiguousSingleWords: GOVERNANCE_DEFAULTS.allowAmbiguousSingleWords,
      conflictBehavior: GOVERNANCE_DEFAULTS.conflictBehavior,
      stopListAdditions: GOVERNANCE_DEFAULTS.stopListAdditions,
      stopListRemovals: GOVERNANCE_DEFAULTS.stopListRemovals,
    })).toEqual(base);
  });

  it('resolveSuggestionOptions clamps the cap to the catalogue range and defaults the rest', () => {
    expect(resolveSuggestionOptions(undefined).maxSuggestionsPerList).toBe(MAX_SUGGESTIONS_PER_SIDE);
    expect(resolveSuggestionOptions({ maxSuggestionsPerList: 0 }).maxSuggestionsPerList).toBe(1);
    expect(resolveSuggestionOptions({ maxSuggestionsPerList: 999 }).maxSuggestionsPerList).toBe(24);
    expect(resolveSuggestionOptions({ maxSuggestionsPerList: 'x' }).maxSuggestionsPerList).toBe(12);
    expect(resolveSuggestionOptions({ conflictBehavior: 'anything' }).conflictBehavior)
      .toBe(CONFLICT_BEHAVIOR.FLAG);
    expect(resolveSuggestionOptions({ preferPhrases: false }).preferPhrases).toBe(false);
    expect(resolveSuggestionOptions({ allowAmbiguousSingleWords: true }).allowAmbiguousSingleWords).toBe(true);
  });

  it('maxSuggestionsPerList really caps each list', () => {
    const one = suggestCriteriaKeywords(PICO, { maxSuggestionsPerList: 1 });
    expect(one.include.length).toBeLessThanOrEqual(1);
    expect(one.exclude.length).toBeLessThanOrEqual(1);
  });

  it('the stop-list deltas never mutate the shipped blocklist', () => {
    const before = effectiveStopList({});
    const widened = effectiveStopList({ stopListAdditions: ['Epilepsy'] });
    expect(widened.has('epilepsy')).toBe(true);
    expect(before.has('epilepsy')).toBe(false);          // the shipped set is untouched
    // Clearing the two lists returns the SAME shared set — "restore defaults" is real.
    expect(effectiveStopList({ stopListAdditions: [], stopListRemovals: [] })).toBe(before);
  });

  it('an addition suppresses a concept the shipped list would have kept', () => {
    const base = suggestCriteriaKeywords(PICO);
    expect(base.include.map(t => t.toLowerCase())).toContain('bariatric surgery');
    const suppressed = suggestCriteriaKeywords(PICO, { stopListAdditions: ['bariatric surgery'] });
    expect(suppressed.include.map(t => t.toLowerCase())).not.toContain('bariatric surgery');
  });

  it('a removal takes a built-in generic term back out of the blocklist', () => {
    // The removal acts on the BLOCKLIST, which is what Ops governs; whether the
    // concept extractor then produces the term is a separate (unchanged) concern.
    expect(effectiveStopList({}).has('adults')).toBe(true);
    expect(effectiveStopList({ stopListRemovals: ['Adults'] }).has('adults')).toBe(false);
  });

  it('conflictBehavior: omit_ambiguous reports nothing; prevent_duplicate keeps both sides', () => {
    const both = { incl: 'sepsis in adults', excl: 'sepsis' };
    const flagged = suggestCriteriaKeywords(both, { conflictBehavior: CONFLICT_BEHAVIOR.FLAG });
    const omitted = suggestCriteriaKeywords(both, { conflictBehavior: CONFLICT_BEHAVIOR.OMIT });
    const kept = suggestCriteriaKeywords(both, { conflictBehavior: CONFLICT_BEHAVIOR.PREVENT_DUPLICATE });
    expect(omitted.conflicts).toEqual([]);
    expect(omitted.include).toEqual(flagged.include);      // still off both sides
    expect(omitted.exclude).toEqual(flagged.exclude);
    expect(kept.conflicts).toEqual(flagged.conflicts);     // still reported
    expect(kept.exclude.length).toBeGreaterThanOrEqual(flagged.exclude.length);
  });
});

/* ═══════════════════ 4. history cap / redo alias — §16 ═════════════════════ */

describe('109.md §16 — interaction.historyCap', () => {
  beforeEach(() => resetHistoryCap());

  const entry = (n) => ({
    id: `e${n}`, kind: 'k', scope: 's', projectId: 'p', undoOp: { n },
  });
  const fill = (howMany) => {
    let h = emptyHistory();
    for (let i = 0; i < howMany; i += 1) h = recordAction(h, entry(i));
    return h;
  };

  it('defaults to the shipped 20', () => {
    expect(historyCap()).toBe(HISTORY_CAP);
    expect(HISTORY_CAP).toBe(GOVERNANCE_DEFAULTS.historyCap);
    expect(counts(fill(30), 's').undo).toBe(20);
  });

  it('a configured cap trims to the configured number', () => {
    setHistoryCap(5);
    expect(counts(fill(30), 's').undo).toBe(5);
  });

  it('clamps to the catalogue 5-100 and restores the default for garbage', () => {
    expect(setHistoryCap(1)).toBe(5);
    expect(setHistoryCap(9999)).toBe(100);
    expect(setHistoryCap('nope')).toBe(HISTORY_CAP);
    expect(setHistoryCap(undefined)).toBe(HISTORY_CAP);
  });
});

describe('109.md §16 — interaction.ctrlYRedoAlias', () => {
  const ctrlY = { key: 'y', ctrlKey: true };
  const ctrlShiftZ = { key: 'z', ctrlKey: true, shiftKey: true };

  it('the pure predicate is unchanged for callers that pass no option', () => {
    expect(isRedoChord(ctrlY)).toBe(true);
    expect(isRedoChord(ctrlShiftZ)).toBe(true);
  });

  it('the alias can be switched off; Ctrl+Shift+Z never can', () => {
    expect(isRedoChord(ctrlY, { ctrlYAlias: false })).toBe(false);
    expect(isRedoChord(ctrlShiftZ, { ctrlYAlias: false })).toBe(true);
    expect(isRedoChord(ctrlY, { ctrlYAlias: true })).toBe(true);
  });

  it('Cmd+Y is never claimed, alias on or off', () => {
    expect(isRedoChord({ key: 'y', metaKey: true }, { ctrlYAlias: true })).toBe(false);
  });
});

describe('109.md §16 — interaction.undoToastMs', () => {
  it('absent/invalid keeps the shipped 8 s', () => {
    expect(dismissDelayMs(undefined)).toBe(AUTO_DISMISS_MS);
    expect(dismissDelayMs(null)).toBe(AUTO_DISMISS_MS);
    expect(dismissDelayMs('soon')).toBe(AUTO_DISMISS_MS);
    expect(AUTO_DISMISS_MS).toBe(GOVERNANCE_DEFAULTS.undoToastMs);
  });
  it('clamps to the catalogue 2000-30000', () => {
    expect(dismissDelayMs(0)).toBe(2000);
    expect(dismissDelayMs(1e9)).toBe(30000);
    expect(dismissDelayMs(5000)).toBe(5000);
  });
});

/* ══════════════ 5. display precision + batch size — §§29, 36 ═══════════════ */

describe('109.md §29 — extraction.percentDisplayDecimals is DISPLAY only', () => {
  it('defaults to the shipped one decimal place', () => {
    expect(percentDecimals(undefined)).toBe(1);
    expect(GOVERNANCE_DEFAULTS.percentDisplayDecimals).toBe(1);
    expect(formatProportionDisplay(23, 59)).toBe('39.0%');
    expect(formatProportionDisplay(23, 59, 1)).toBe('39.0%');
  });
  it('clamps to 0-3 and re-renders the SAME underlying number', () => {
    expect(percentDecimals(-4)).toBe(0);
    expect(percentDecimals(9)).toBe(3);
    expect(formatProportionDisplay(23, 59, 0)).toBe('39%');
    expect(formatProportionDisplay(23, 59, 3)).toBe('38.983%');
  });
  it('the invalid-input contract is untouched by the new argument', () => {
    expect(formatProportionDisplay('', 59, 3)).toBe(null);
    expect(formatProportionDisplay(60, 59, 3)).toBe(null);
    expect(formatProportionDisplay(1, 0, 3)).toBe(null);
  });
});

describe('109.md §36 — screening.autoLoadMoreBatchSize', () => {
  it('defaults to the shipped page size of 50', () => {
    expect(resolveBatchSize(undefined)).toBe(50);
    expect(resolveBatchSize('x')).toBe(50);
    expect(GOVERNANCE_DEFAULTS.autoLoadMoreBatchSize).toBe(50);
  });
  it('clamps to the catalogue 10-200 so no setting can pull a whole corpus into one tab', () => {
    expect(resolveBatchSize(1)).toBe(10);
    expect(resolveBatchSize(100000)).toBe(200);
    expect(resolveBatchSize(75)).toBe(75);
    expect(resolveBatchSize(catalogEntry('screening.autoLoadMoreBatchSize').max)).toBe(200);
  });
});
