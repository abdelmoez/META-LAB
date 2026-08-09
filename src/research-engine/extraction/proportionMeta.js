/**
 * extraction/proportionMeta.js — 107.md §8 (per-estimate proportion metadata) and
 * §9 (the derived percentage shown beside Events / Total).
 *
 * The two classifications live FLAT on the studies[] row — `denominatorPopulation`,
 * `denominatorCustom`, `actionStatus` — exactly like the 106.md `cv_*` case values and
 * the 82.md `reportedFormat`. Flat is not cosmetic: per-value provenance, the analysis
 * sync hash, the manuscript dependency fingerprint and jump-to-source all key on the
 * FIELD NAME, so nesting these under `extractionMeta` would silently remove all four.
 *
 * ── The legacy contract (107.md §8C) ──────────────────────────────────────────────
 * A row that predates this feature simply LACKS the keys. Missing / '' / an unknown
 * value all mean "not classified (legacy / unset)". That is deliberately NOT the same
 * as `actionStatus:'unclear'`, which means the ARTICLE reports the status as unclear.
 * Nothing in the load path writes these keys onto old rows (that would make every
 * project open dirty), so every reader must tolerate their absence — which is what the
 * `effective*` readers below are for. They are also SELF-HEALING: a value outside the
 * registry (hand-edited blob, forward-version file) reads back as unclassified rather
 * than rendering a broken <select>. The raw value stays on the row untouched, and the
 * validator raises a warning about it.
 *
 * PURE — no React, no IO, no Date/Math.random. Safe for client, server and tests.
 */

import {
  DENOMINATOR_POPULATIONS, ACTION_STATUSES,
  DENOMINATOR_POPULATION_LABEL, ACTION_STATUS_LABEL,
} from '../project-model/monolithConstants.js';
import { fmtPct, PCT_DEFAULT_DECIMALS } from '../format/precision.js';

/** The three flat row keys this module owns (allow-lists elsewhere are hand-written). */
export const PROPORTION_META_FIELDS = Object.freeze([
  'denominatorPopulation', 'denominatorCustom', 'actionStatus',
]);

/** The stored value that means "not classified (legacy / unset)" — 107.md §8C. */
export const UNCLASSIFIED = '';

/** What the UI shows for the unclassified state, so a legacy row is visibly unresolved. */
export const UNCLASSIFIED_LABEL = '— Not classified —';

const DENOMINATOR_KEYS = new Set(DENOMINATOR_POPULATIONS.map(([k]) => k));
const ACTION_KEYS = new Set(ACTION_STATUSES.map(([k]) => k));

const raw = (v) => (v == null ? '' : String(v).trim());

/**
 * effectiveDenominatorPopulation(study) — the row's denominator population, self-healed.
 * Missing key, '' and any value outside the registry all read as '' (unclassified).
 * @returns {string} a DENOMINATOR_POPULATIONS key, or '' when not classified
 */
export function effectiveDenominatorPopulation(study) {
  const v = raw(study && study.denominatorPopulation);
  return DENOMINATOR_KEYS.has(v) ? v : UNCLASSIFIED;
}

/**
 * effectiveActionStatus(study) — the row's action status, self-healed the same way.
 * NOTE '' is NOT coerced to 'unclear': see the legacy contract above (107.md §8C).
 * @returns {string} an ACTION_STATUSES key, or '' when not classified
 */
export function effectiveActionStatus(study) {
  const v = raw(study && study.actionStatus);
  return ACTION_KEYS.has(v) ? v : UNCLASSIFIED;
}

/**
 * isDenominatorPopulationKey / isActionStatusKey — registry MEMBERSHIP, not truthiness.
 * `DENOMINATOR_POPULATION_LABEL` and `ACTION_STATUS_LABEL` are plain `Object.fromEntries`
 * maps, so `LABEL['constructor']` / `LABEL['toString']` read TRUTHY off the prototype: a
 * row storing one of those strings suppressed the "unrecognised value" warning while every
 * Set-based reader here still treated it as unclassified (107.md §8E review fix). Callers
 * that GATE on the registry must use these, never a bare lookup.
 * @returns {boolean}
 */
export function isDenominatorPopulationKey(value) {
  return DENOMINATOR_KEYS.has(raw(value));
}

export function isActionStatusKey(value) {
  return ACTION_KEYS.has(raw(value));
}

/** The custom denominator description as stored (trimmed); '' when absent. */
export function denominatorCustomText(study) {
  return raw(study && study.denominatorCustom);
}

/** Human label for the row's denominator population; '' when unclassified. */
export function denominatorPopulationLabel(study) {
  const k = effectiveDenominatorPopulation(study);
  return k ? (DENOMINATOR_POPULATION_LABEL[k] || '') : '';
}

/** Human label for the row's action status; '' when unclassified. */
export function actionStatusLabel(study) {
  const k = effectiveActionStatus(study);
  return k ? (ACTION_STATUS_LABEL[k] || '') : '';
}

/**
 * requiresCustomDenominator(value) — true only for the 'Other/custom' option, which is
 * the single case where the free-text description becomes REQUIRED (107.md §8A/§8E).
 * Takes the raw enum VALUE (not a study) so the form can call it on the pending select
 * value before anything is written.
 * @returns {boolean}
 */
export function requiresCustomDenominator(value) {
  return raw(value) === 'other';
}

/**
 * denominatorPopulationPatch(study, nextValue) — 107.md §8A (review fix). The COMBINED row
 * patch for changing the denominator population: the free-text description only means
 * anything under 'Other/custom', and the input that shows it is hidden for every other
 * option, so text left behind by an earlier choice is invisible on screen yet still
 * exported — two contradictory denominator statements in one submission package. Clearing
 * it HERE keeps value + provenance in a single blob write (83.md §5) instead of two
 * sequential field writes that a save could flush between.
 *
 * Returns the single-key patch when there is nothing to clear, so switching the population
 * on a row that never had a description writes exactly what it wrote before.
 * @returns {{denominatorPopulation:*, denominatorCustom?:string}}
 */
export function denominatorPopulationPatch(study, nextValue) {
  const patch = { denominatorPopulation: nextValue };
  if (!requiresCustomDenominator(nextValue) && denominatorCustomText(study)) patch.denominatorCustom = '';
  return patch;
}

/**
 * exportedDenominatorCustom(study) — the description an EXPORT should carry: '' unless the
 * row's effective population is 'Other/custom'. Belt and braces beside the patch above —
 * a project saved before that fix can still hold stale text, and no load-path normalizer
 * strips it (writing to old rows would make every project open dirty, 107.md §15).
 * @returns {string}
 */
export function exportedDenominatorCustom(study) {
  return requiresCustomDenominator(effectiveDenominatorPopulation(study)) ? denominatorCustomText(study) : '';
}

/**
 * isProportionMetaUnclassified(study) — true when this estimate has not been fully
 * classified yet: either field missing / '' / unknown. Legacy rows answer true, which
 * is what lets a reviewer find and resolve them (107.md §8C "until reviewed").
 * @returns {boolean}
 */
export function isProportionMetaUnclassified(study) {
  return !effectiveDenominatorPopulation(study) || !effectiveActionStatus(study);
}

/** Numeric coercion for the derived display: blank / non-numeric / non-finite → null. */
function num(v) {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'number' ? String(v) : String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * formatProportionDisplay(events, total) — 107.md §9. The DERIVED percentage shown next
 * to the Events / Total inputs. Display-only: nothing is stored, the analysis keeps
 * using events/total (calcES('PROP') owns the logit transform and its continuity
 * correction — this is deliberately NOT that).
 *
 * Precision: one decimal place, via the repo's CENTRALISED convention rather than a new
 * one — `fmtPct` from format/precision.js is fixed at PCT_DEFAULT_DECIMALS (1) for
 * exactly this class of quantity (see the rationale comment at precision.js:143-151),
 * which is what 107.md §9 "reuse it instead of creating a conflicting one" asks for.
 *
 * Returns null — never a misleading string — for every invalid/incomplete input listed
 * in §9: blank events or total, non-numeric input, total ≤ 0, negative events, and
 * events > total (which validateStudy already reports as a blocking error).
 * `0 / 59` → '0.0%' and `59 / 59` → '100.0%' are VALID and must render.
 *
 * @param {*} events  raw row value (string on a studies[] row)
 * @param {*} total   raw row value
 * @returns {string|null}  e.g. '39.0%', or null when nothing should be shown
 */
export function formatProportionDisplay(events, total) {
  const e = num(events);
  const t = num(total);
  if (e === null || t === null) return null;
  if (!(t > 0)) return null;          // total blank/0/negative
  if (e < 0) return null;             // negative events
  if (e > t) return null;             // impossible — the validator explains why
  return `${fmtPct((e / t) * 100, undefined, PCT_DEFAULT_DECIMALS)}%`;
}

/**
 * proportionEquation(events, total) — the full "23 / 59 = 39.0%" string from 107.md §9,
 * or null when the derived percentage would be misleading. The operands are echoed as
 * the reviewer typed them (trimmed), so the line always matches the two inputs.
 * @returns {string|null}
 */
export function proportionEquation(events, total) {
  const pct = formatProportionDisplay(events, total);
  if (pct === null) return null;
  return `${raw(events)} / ${raw(total)} = ${pct}`;
}
