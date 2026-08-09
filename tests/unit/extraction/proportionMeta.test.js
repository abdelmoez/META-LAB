/**
 * proportionMeta.test.js — 107.md §8 (per-estimate proportion metadata) + §9 (the
 * derived percentage beside Events / Total).
 *
 * Covered here (the pure layer):
 *  - formatProportionDisplay: the §9 test list — 23/59, zero events, events==total,
 *    rounding, blanks, total 0, negatives, events>total, non-numeric.
 *  - the self-healing enum readers + requiresCustomDenominator.
 *  - the enum registries: the EXACT visible labels §8A/§8B mandates, and the derived
 *    `_LABEL` maps.
 *  - BOTH mkStudy factories mint the three fields as "" (they are separate files).
 *  - the validator rule: Other/custom without a description blocks; nothing else does,
 *    and a legacy row (keys absent) raises no new issue.
 */
import { describe, it, expect } from 'vitest';
import {
  PROPORTION_META_FIELDS, UNCLASSIFIED, UNCLASSIFIED_LABEL,
  formatProportionDisplay, proportionEquation,
  effectiveDenominatorPopulation, effectiveActionStatus,
  denominatorPopulationLabel, actionStatusLabel, denominatorCustomText,
  requiresCustomDenominator, isProportionMetaUnclassified,
  isDenominatorPopulationKey, isActionStatusKey,
  denominatorPopulationPatch, exportedDenominatorCustom,
} from '../../../src/research-engine/extraction/proportionMeta.js';
import {
  DENOMINATOR_POPULATIONS, ACTION_STATUSES,
  DENOMINATOR_POPULATION_LABEL, ACTION_STATUS_LABEL,
} from '../../../src/research-engine/project-model/monolithConstants.js';
import { mkStudy as mkStudyClassic } from '../../../src/frontend/workspace/projectHelpers.js';
import { mkStudy as mkStudyEngine } from '../../../src/research-engine/project-model/defaults.js';
import { validateStudy } from '../../../src/research-engine/validation/study-validator.js';
import { validateStudy as validateStudyMonolith } from '../../../src/research-engine/statistics/monolithStats.js';

/* ══════════════════════ §9 — the derived percentage ══════════════════════ */

describe('formatProportionDisplay (107.md §9)', () => {
  it('23 / 59 → "39.0%" (the worked example)', () => {
    expect(formatProportionDisplay('23', '59')).toBe('39.0%');
  });

  it('zero events is VALID data, not an error → "0.0%"', () => {
    expect(formatProportionDisplay('0', '59')).toBe('0.0%');
    expect(formatProportionDisplay(0, 59)).toBe('0.0%');
  });

  it('events === total → "100.0%"', () => {
    expect(formatProportionDisplay('59', '59')).toBe('100.0%');
    expect(formatProportionDisplay('1', '1')).toBe('100.0%');
  });

  it('rounds to ONE decimal place via the centralised fmtPct convention', () => {
    expect(formatProportionDisplay('1', '3')).toBe('33.3%');     // 33.333…
    expect(formatProportionDisplay('2', '3')).toBe('66.7%');     // 66.666… → half-up
    expect(formatProportionDisplay('1', '8')).toBe('12.5%');
    expect(formatProportionDisplay('1', '1000')).toBe('0.1%');
    expect(formatProportionDisplay('1', '10000')).toBe('0.0%');  // rounds down, still valid
  });

  it('accepts numbers, numeric strings and surrounding whitespace alike', () => {
    expect(formatProportionDisplay(23, 59)).toBe('39.0%');
    expect(formatProportionDisplay(' 23 ', ' 59 ')).toBe('39.0%');
    expect(formatProportionDisplay('23.0', '59')).toBe('39.0%');
  });

  it('returns null (never a misleading %) for blank / partially typed input', () => {
    expect(formatProportionDisplay('', '')).toBeNull();
    expect(formatProportionDisplay('23', '')).toBeNull();
    expect(formatProportionDisplay('', '59')).toBeNull();
    expect(formatProportionDisplay('   ', '59')).toBeNull();
    expect(formatProportionDisplay(null, 59)).toBeNull();
    expect(formatProportionDisplay(undefined, undefined)).toBeNull();
  });

  it('returns null for total = 0 and total < 0', () => {
    expect(formatProportionDisplay('0', '0')).toBeNull();
    expect(formatProportionDisplay('5', '0')).toBeNull();
    expect(formatProportionDisplay('5', '-10')).toBeNull();
  });

  it('returns null for negative events', () => {
    expect(formatProportionDisplay('-1', '59')).toBeNull();
  });

  it('returns null when events > total (the validator explains why)', () => {
    expect(formatProportionDisplay('60', '59')).toBeNull();
    expect(formatProportionDisplay('59.5', '59')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(formatProportionDisplay('abc', '59')).toBeNull();
    expect(formatProportionDisplay('23', 'n/a')).toBeNull();
    expect(formatProportionDisplay('2 3', '59')).toBeNull();
    expect(formatProportionDisplay('23%', '59')).toBeNull();
    expect(formatProportionDisplay(NaN, 59)).toBeNull();
    expect(formatProportionDisplay(Infinity, 59)).toBeNull();
  });

  it('recomputes purely from its arguments (an "immediate update" is just a re-call)', () => {
    // Simulates the reviewer typing "5" then "59" into Total: no memoised/stale value.
    expect(formatProportionDisplay('23', '5')).toBeNull();       // 23 > 5 → nothing shown
    expect(formatProportionDisplay('23', '59')).toBe('39.0%');
    expect(formatProportionDisplay('24', '59')).toBe('40.7%');
  });

  it('proportionEquation renders the full "23 / 59 = 39.0%" line, or null', () => {
    expect(proportionEquation('23', '59')).toBe('23 / 59 = 39.0%');
    expect(proportionEquation(' 0 ', '59')).toBe('0 / 59 = 0.0%');
    expect(proportionEquation('23', '')).toBeNull();
  });
});

/* ══════════════════════ §8A/§8B — the enum registries ══════════════════════ */

describe('DENOMINATOR_POPULATIONS / ACTION_STATUSES registries (107.md §8A/§8B)', () => {
  it('exposes EXACTLY the visible labels 107.md §8A mandates, in order', () => {
    expect(DENOMINATOR_POPULATIONS).toEqual([
      ['plp_molecular_diagnoses', 'P/LP molecular diagnoses'],
      ['all_patients_tested', 'All patients tested'],
      ['patients_with_management_change', 'Patients with management change'],
      ['patients_with_follow_up', 'Patients with follow-up'],
      ['other', 'Other/custom'],
    ]);
  });

  it('exposes EXACTLY the visible categories 107.md §8B mandates, in order', () => {
    expect(ACTION_STATUSES).toEqual([
      ['implemented', 'Implemented'],
      ['recommended_planned', 'Recommended/planned'],
      ['potential_theoretical', 'Potential/theoretical'],
      ['unclear', 'Unclear'],
    ]);
  });

  it('derives the _LABEL maps from the tuples (never hand-written)', () => {
    expect(DENOMINATOR_POPULATION_LABEL).toEqual(
      Object.fromEntries(DENOMINATOR_POPULATIONS.map(([k, l]) => [k, l])));
    expect(ACTION_STATUS_LABEL).toEqual(
      Object.fromEntries(ACTION_STATUSES.map(([k, l]) => [k, l])));
    expect(DENOMINATOR_POPULATION_LABEL.plp_molecular_diagnoses).toBe('P/LP molecular diagnoses');
    expect(ACTION_STATUS_LABEL.recommended_planned).toBe('Recommended/planned');
  });

  it('"" is NOT a member of either registry — unclassified is not a category (§8C)', () => {
    expect(DENOMINATOR_POPULATIONS.map(([k]) => k)).not.toContain('');
    expect(ACTION_STATUSES.map(([k]) => k)).not.toContain('');
    expect(UNCLASSIFIED).toBe('');
    expect(UNCLASSIFIED_LABEL).toBe('— Not classified —');
  });
});

/* ══════════════════════ self-healing readers ══════════════════════ */

describe('effective* readers self-heal (107.md §8C)', () => {
  it('returns the stored key when it is a registry member', () => {
    expect(effectiveDenominatorPopulation({ denominatorPopulation: 'all_patients_tested' })).toBe('all_patients_tested');
    expect(effectiveActionStatus({ actionStatus: 'implemented' })).toBe('implemented');
  });

  it('a LEGACY row (keys absent) reads as unclassified, NOT as "unclear"', () => {
    const legacy = { id: 'x', esType: 'PROP', events: '23', total: '59' };
    expect('denominatorPopulation' in legacy).toBe(false);
    expect('actionStatus' in legacy).toBe(false);
    expect(effectiveDenominatorPopulation(legacy)).toBe('');
    expect(effectiveActionStatus(legacy)).toBe('');
    expect(effectiveActionStatus(legacy)).not.toBe('unclear');
    expect(isProportionMetaUnclassified(legacy)).toBe(true);
  });

  it('an UNKNOWN / forward-version value reads as unclassified instead of breaking', () => {
    expect(effectiveDenominatorPopulation({ denominatorPopulation: 'PLP_MOLECULAR_DIAGNOSES' })).toBe('');
    expect(effectiveDenominatorPopulation({ denominatorPopulation: 'martians' })).toBe('');
    expect(effectiveActionStatus({ actionStatus: 'IMPLEMENTED' })).toBe('');
    expect(effectiveActionStatus({ actionStatus: 42 })).toBe('');
  });

  it('tolerates null / undefined / non-object input', () => {
    expect(effectiveDenominatorPopulation(null)).toBe('');
    expect(effectiveDenominatorPopulation(undefined)).toBe('');
    expect(effectiveActionStatus({})).toBe('');
    expect(effectiveDenominatorPopulation({ denominatorPopulation: '  other  ' })).toBe('other');
  });

  it('labels resolve through the readers (unclassified → "")', () => {
    expect(denominatorPopulationLabel({ denominatorPopulation: 'other' })).toBe('Other/custom');
    expect(denominatorPopulationLabel({ denominatorPopulation: 'nope' })).toBe('');
    expect(denominatorPopulationLabel({})).toBe('');
    expect(actionStatusLabel({ actionStatus: 'potential_theoretical' })).toBe('Potential/theoretical');
    expect(actionStatusLabel({})).toBe('');
    expect(denominatorCustomText({ denominatorCustom: '  post-test counselling  ' })).toBe('post-test counselling');
    expect(denominatorCustomText({})).toBe('');
  });

  it('isProportionMetaUnclassified is false only once BOTH are classified', () => {
    expect(isProportionMetaUnclassified({ denominatorPopulation: 'other' })).toBe(true);
    expect(isProportionMetaUnclassified({ actionStatus: 'unclear' })).toBe(true);
    expect(isProportionMetaUnclassified({ denominatorPopulation: 'other', actionStatus: 'unclear' })).toBe(false);
  });
});

describe('requiresCustomDenominator (107.md §8A)', () => {
  it('is true ONLY for the Other/custom option', () => {
    expect(requiresCustomDenominator('other')).toBe(true);
    expect(requiresCustomDenominator(' other ')).toBe(true);
    for (const [k] of DENOMINATOR_POPULATIONS) {
      if (k !== 'other') expect(requiresCustomDenominator(k)).toBe(false);
    }
    expect(requiresCustomDenominator('')).toBe(false);
    expect(requiresCustomDenominator(null)).toBe(false);
    expect(requiresCustomDenominator(undefined)).toBe(false);
    expect(requiresCustomDenominator('OTHER')).toBe(false);   // internal values are exact
  });
});

/* ═════════════ registry membership is a Set test, never a truthy lookup ═════════════ */

/** Keys every plain object inherits from Object.prototype. `LABEL[k]` is TRUTHY for each
 *  of them, which is why gating logic must ask the registry, not the label map. */
const PROTOTYPE_KEYS = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'];

describe('isDenominatorPopulationKey / isActionStatusKey (107.md §8E review fix)', () => {
  it('true for every registry member, trimmed', () => {
    for (const [k] of DENOMINATOR_POPULATIONS) expect(isDenominatorPopulationKey(k)).toBe(true);
    for (const [k] of ACTION_STATUSES) expect(isActionStatusKey(k)).toBe(true);
    expect(isDenominatorPopulationKey('  other  ')).toBe(true);
  });

  it('false for "", null, undefined and unknown values', () => {
    for (const v of ['', '   ', null, undefined, 'martians', 'OTHER', 42]) {
      expect(isDenominatorPopulationKey(v)).toBe(false);
      expect(isActionStatusKey(v)).toBe(false);
    }
  });

  it('false for inherited Object.prototype keys (a bare label lookup reads TRUTHY)', () => {
    for (const k of PROTOTYPE_KEYS) {
      expect(DENOMINATOR_POPULATION_LABEL[k]).toBeTruthy();   // the trap being guarded
      expect(ACTION_STATUS_LABEL[k]).toBeTruthy();
      expect(isDenominatorPopulationKey(k)).toBe(false);
      expect(isActionStatusKey(k)).toBe(false);
    }
  });

  it('the readers already treat those values as unclassified — so must the validators', () => {
    for (const k of PROTOTYPE_KEYS) {
      expect(effectiveDenominatorPopulation({ denominatorPopulation: k })).toBe('');
      expect(effectiveActionStatus({ actionStatus: k })).toBe('');
      expect(denominatorPopulationLabel({ denominatorPopulation: k })).toBe('');
      expect(actionStatusLabel({ actionStatus: k })).toBe('');
    }
  });
});

/* ═══════════ §8A — switching the population clears an orphaned description ═══════════ */

describe('denominatorPopulationPatch (107.md §8A review fix)', () => {
  const withCustom = { esType: 'PROP', denominatorPopulation: 'other', denominatorCustom: 'Patients who completed post-test genetic counseling' };

  it('clears denominatorCustom in the SAME patch when leaving Other/custom', () => {
    for (const [k] of DENOMINATOR_POPULATIONS) {
      if (k === 'other') continue;
      expect(denominatorPopulationPatch(withCustom, k))
        .toEqual({ denominatorPopulation: k, denominatorCustom: '' });
    }
  });

  it('also clears it when the reviewer goes back to "— Not classified —"', () => {
    expect(denominatorPopulationPatch(withCustom, '')).toEqual({ denominatorPopulation: '', denominatorCustom: '' });
  });

  it('KEEPS the description when the new value is still Other/custom', () => {
    expect(denominatorPopulationPatch(withCustom, 'other')).toEqual({ denominatorPopulation: 'other' });
    expect(denominatorPopulationPatch(withCustom, ' other ')).toEqual({ denominatorPopulation: ' other ' });
  });

  it('writes the single key when there is nothing to clear (no gratuitous blob churn)', () => {
    expect(denominatorPopulationPatch({ esType: 'PROP' }, 'all_patients_tested'))
      .toEqual({ denominatorPopulation: 'all_patients_tested' });
    expect(denominatorPopulationPatch({ denominatorCustom: '   ' }, 'all_patients_tested'))
      .toEqual({ denominatorPopulation: 'all_patients_tested' });
    expect(denominatorPopulationPatch(undefined, 'all_patients_tested'))
      .toEqual({ denominatorPopulation: 'all_patients_tested' });
  });

  it('passes the raw select value through untouched (it is what the row stores)', () => {
    expect(denominatorPopulationPatch({}, 'plp_molecular_diagnoses').denominatorPopulation).toBe('plp_molecular_diagnoses');
  });
});

describe('exportedDenominatorCustom (107.md §8A review fix — belt and braces)', () => {
  it('returns the description for an Other/custom row', () => {
    expect(exportedDenominatorCustom({ denominatorPopulation: 'other', denominatorCustom: '  Completed counselling  ' }))
      .toBe('Completed counselling');
  });

  it('returns "" for a STALE row written before the select started clearing it', () => {
    expect(exportedDenominatorCustom({ denominatorPopulation: 'all_patients_tested', denominatorCustom: 'Completed counselling' })).toBe('');
  });

  it('returns "" for an unclassified, unknown-value or legacy row', () => {
    expect(exportedDenominatorCustom({ denominatorPopulation: '', denominatorCustom: 'junk' })).toBe('');
    expect(exportedDenominatorCustom({ denominatorPopulation: 'martians', denominatorCustom: 'junk' })).toBe('');
    expect(exportedDenominatorCustom({ denominatorPopulation: 'constructor', denominatorCustom: 'junk' })).toBe('');
    expect(exportedDenominatorCustom({})).toBe('');
    expect(exportedDenominatorCustom(null)).toBe('');
  });
});

/* ══════════════════════ the model: BOTH mkStudy factories ══════════════════════ */

describe('mkStudy mints the three fields as "" (BOTH factories — 107.md §15)', () => {
  it('the classic-tab factory (frontend/workspace/projectHelpers.js)', () => {
    const s = mkStudyClassic();
    for (const f of PROPORTION_META_FIELDS) {
      expect(s).toHaveProperty(f);
      expect(s[f]).toBe('');
    }
  });

  it('the Pecan-engine factory (research-engine/project-model/defaults.js)', () => {
    const s = mkStudyEngine();
    for (const f of PROPORTION_META_FIELDS) {
      expect(s).toHaveProperty(f);
      expect(s[f]).toBe('');
    }
  });

  it('a fresh row is therefore UNCLASSIFIED, never a fabricated category', () => {
    expect(isProportionMetaUnclassified(mkStudyClassic())).toBe(true);
    expect(isProportionMetaUnclassified(mkStudyEngine())).toBe(true);
    expect(effectiveActionStatus(mkStudyEngine())).not.toBe('unclear');
  });

  it('PROPORTION_META_FIELDS names exactly the three keys', () => {
    expect([...PROPORTION_META_FIELDS]).toEqual(['denominatorPopulation', 'denominatorCustom', 'actionStatus']);
  });
});

/* ══════════════════════ §8E — validation ══════════════════════ */

const CUSTOM_REQUIRED = 'Custom denominator description is required for Other/custom.';
const prop = (over = {}) => ({ ...mkStudyEngine(), author: 'Smith', year: '2024', outcome: 'Dx yield', esType: 'PROP', events: '23', total: '59', ...over });
const msgs = (s) => validateStudy(s).map((i) => i.msg);
const errs = (s) => validateStudy(s).filter((i) => i.sev === 'error');

describe('validateStudy — Other/custom requires its description (107.md §8E)', () => {
  it('Other/custom + blank description → a BLOCKING error', () => {
    const issues = errs(prop({ denominatorPopulation: 'other', denominatorCustom: '' }));
    expect(issues.map((i) => i.msg)).toContain(CUSTOM_REQUIRED);
    expect(issues.find((i) => i.msg === CUSTOM_REQUIRED).field).toBe('denominatorCustom');
  });

  it('whitespace-only description does not satisfy the requirement', () => {
    expect(msgs(prop({ denominatorPopulation: 'other', denominatorCustom: '   ' }))).toContain(CUSTOM_REQUIRED);
  });

  it('Other/custom + a filled description → no error', () => {
    const s = prop({ denominatorPopulation: 'other', denominatorCustom: 'Patients who completed post-test genetic counseling' });
    expect(msgs(s)).not.toContain(CUSTOM_REQUIRED);
    expect(errs(s)).toHaveLength(0);
  });

  it('is NEVER required for the other options', () => {
    for (const [k] of DENOMINATOR_POPULATIONS) {
      if (k === 'other') continue;
      expect(msgs(prop({ denominatorPopulation: k, denominatorCustom: '' }))).not.toContain(CUSTOM_REQUIRED);
    }
  });

  it('is not required for an unclassified row, and not for a non-PROP measure', () => {
    expect(msgs(prop({ denominatorPopulation: '' }))).not.toContain(CUSTOM_REQUIRED);
    expect(msgs(prop({ esType: 'OR', denominatorPopulation: 'other', denominatorCustom: '' }))).not.toContain(CUSTOM_REQUIRED);
  });

  it('a LEGACY PROP row (keys absent) raises no new issue at all', () => {
    const legacy = { id: 'L', author: 'Old', year: '2011', outcome: 'Yield', esType: 'PROP', events: '4', total: '10', es: '-0.847', lo: '-2.0', hi: '0.3' };
    expect(validateStudy(legacy)).toEqual([]);
  });

  it('an unknown enum value is a WARNING, never blocking (the readers cope)', () => {
    const s = prop({ denominatorPopulation: 'martians', actionStatus: 'IMPLEMENTED' });
    const issues = validateStudy(s);
    expect(issues.filter((i) => i.sev === 'error')).toHaveLength(0);
    const warns = issues.filter((i) => i.sev === 'warn').map((i) => i.field);
    expect(warns).toContain('denominatorPopulation');
    expect(warns).toContain('actionStatus');
  });

  it('an inherited-key value ("constructor"/"toString") also WARNS — both copies', () => {
    // Before the review fix `!DENOMINATOR_POPULATION_LABEL['constructor']` was false, so the
    // warning was suppressed while every reader still showed "— Not classified —": the
    // screen said unclassified and nothing flagged the junk on the row.
    for (const k of PROTOTYPE_KEYS) {
      for (const validate of [validateStudy, validateStudyMonolith]) {
        const issues = validate(prop({ denominatorPopulation: k, actionStatus: k }));
        expect(issues.filter((i) => i.sev === 'error')).toHaveLength(0);
        const warned = issues.filter((i) => i.sev === 'warn').map((i) => i.field);
        expect(warned).toContain('denominatorPopulation');
        expect(warned).toContain('actionStatus');
      }
    }
  });

  it('"other" is still the ONLY value that demands a description (prototype keys do not)', () => {
    for (const k of PROTOTYPE_KEYS) {
      expect(msgs(prop({ denominatorPopulation: k, denominatorCustom: '' }))).not.toContain(CUSTOM_REQUIRED);
    }
  });

  it('the monolithStats DUPLICATE of validateStudy carries the same rules', () => {
    // extractionTabs.jsx renders THIS copy — a rule that lands in only one is invisible
    // on the classic tab (docs/case-series-106.md records that exact bug).
    const bad = prop({ denominatorPopulation: 'other', denominatorCustom: '' });
    expect(validateStudyMonolith(bad).map((i) => i.msg)).toContain(CUSTOM_REQUIRED);
    const good = prop({ denominatorPopulation: 'other', denominatorCustom: 'X' });
    expect(validateStudyMonolith(good).map((i) => i.msg)).not.toContain(CUSTOM_REQUIRED);
    expect(validateStudyMonolith({ id: 'L', author: 'A', year: '2011', outcome: 'O', esType: 'PROP', events: '4', total: '10' })
      .filter((i) => i.sev === 'error')).toHaveLength(0);
  });
});
