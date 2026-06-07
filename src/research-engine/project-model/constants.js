/**
 * constants.js
 * All option arrays, label maps, effect-measure metadata, risk-of-bias
 * instrument definitions, and helper predicates for the project data model.
 *
 * Copied verbatim from meta-lab-3-patched.jsx — do not rename or reorder
 * entries without updating the UI and validation modules.
 */

/**
 * SOURCE_OPTIONS
 * Physical location of an extracted value (WHERE in the paper).
 * Format: [value, display-label]
 * @type {Array<[string, string]>}
 */
export const SOURCE_OPTIONS = [
  ["",           "— where from? —"],
  ["text",       "Reported in text"],
  ["table",      "From a table"],
  ["figure",     "Figure / Kaplan–Meier curve"],
  ["supplement", "Supplementary material"],
  ["calculated", "Calculated from reported data"],
  ["converted",  "Converted from another format"],
  ["author",     "Obtained from authors"],
  ["unclear",    "Unclear / needs verification"],
];

/**
 * DATA_NATURE
 * Methodological role of the extracted estimate (WHAT KIND of result).
 * Format: [value, display-label, isNonPrimary:boolean]
 * @type {Array<[string, string, boolean]>}
 */
export const DATA_NATURE = [
  ["primary",     "Primary outcome (directly reported)", false],
  ["secondary",   "Secondary outcome",                   true],
  ["subgroup",    "Subgroup analysis",                   true],
  ["posthoc",     "Post-hoc analysis",                   true],
  ["sensitivity", "Sensitivity analysis",                true],
];

/**
 * ADJUST_OPTIONS
 * Adjustment status of the estimate.
 * Format: [value, display-label]
 * @type {Array<[string, string]>}
 */
export const ADJUST_OPTIONS = [
  ["unadjusted",    "Unadjusted"],
  ["adjusted",      "Adjusted (covariates)"],
  ["multivariable", "Multivariable-adjusted"],
  ["propensity",    "Propensity-matched"],
  ["iptw",          "IPTW-adjusted"],
];

/**
 * EXTRACT_FLAGS
 * Reliability / provenance flags (multi-select checkboxes).
 * Format: [value, display-label]
 * @type {Array<[string, string]>}
 */
export const EXTRACT_FLAGS = [
  ["calc",       "Requires calculation"],
  ["conv",       "Requires conversion"],
  ["figure",     "Estimated from figure"],
  ["notprimary", "Not primary data"],
  ["highrisk",   "High risk of extraction error"],
  ["noconfirm",  "Do not pool unless confirmed"],
];

// ── Derived label maps ────────────────────────────────────────────────────────

/** @type {Object<string,string>} */
export const DATA_NATURE_LABEL = Object.fromEntries(DATA_NATURE.map(([k, l]) => [k, l]));

/** @type {Object<string,string>} */
export const ADJUST_LABEL = Object.fromEntries(ADJUST_OPTIONS.map(([k, l]) => [k, l]));

/** @type {Object<string,string>} */
export const FLAG_LABEL = Object.fromEntries(EXTRACT_FLAGS.map(([k, l]) => [k, l]));

/** @type {Object<string,string>} */
export const SOURCE_LABEL = Object.fromEntries(SOURCE_OPTIONS.map(([k, l]) => [k, l]));

// ── Helper predicates ─────────────────────────────────────────────────────────

/**
 * isNonPrimary(s)
 * Returns true if the study's estimate is non-primary — i.e. it comes from
 * a secondary/subgroup/post-hoc analysis, was converted, is figure-derived,
 * or carries certain reliability flags.
 *
 * Used by checkPoolability to assess data-composition risk.
 *
 * @param {object} s  Study object
 * @returns {boolean}
 */
export const isNonPrimary = s => {
  const nat = s.dataNature && s.dataNature !== "primary";
  const flg = (s.flags || []).some(f =>
    ["notprimary","figure","conv","calc","noconfirm","highrisk"].includes(f)
  );
  const src = ["figure","converted","calculated","author","unclear"].includes(s.source);
  return nat || flg || src || s.converted;
};

// ── Effect-measure metadata ───────────────────────────────────────────────────

/**
 * ES_TYPES
 * Metadata for each supported effect measure.
 *
 * Properties:
 *   label   {string}   Human-readable name
 *   family  {string}   Grouping: "continuous" | "continuous-raw" | "ratio" | "correlation" | "proportion"
 *   log     {boolean}  True if the analysis scale is logarithmic (OR, RR, HR)
 *   nullVal {number|null}  Value representing no effect (0 for most; null for PROP)
 *   scale   {string}   Internal scale name
 *
 * @type {Object<string, {label:string, family:string, log:boolean, nullVal:number|null, scale:string}>}
 */
export const ES_TYPES = {
  SMD:  { label: "SMD (standardized mean diff)",    family: "continuous",     log: false, nullVal: 0,    scale: "SMD"   },
  MD:   { label: "Mean Difference (raw units)",     family: "continuous-raw", log: false, nullVal: 0,    scale: "MD"    },
  OR:   { label: "Odds Ratio (log scale)",          family: "ratio",          log: true,  nullVal: 0,    scale: "lnOR"  },
  RR:   { label: "Risk Ratio (log scale)",          family: "ratio",          log: true,  nullVal: 0,    scale: "lnRR"  },
  HR:   { label: "Hazard Ratio (log scale)",        family: "ratio",          log: true,  nullVal: 0,    scale: "lnHR"  },
  COR:  { label: "Correlation (Fisher z)",          family: "correlation",    log: false, nullVal: 0,    scale: "z"     },
  PROP: { label: "Single-arm proportion (logit)",   family: "proportion",     log: false, nullVal: null, scale: "logit" },
};

// ── Risk-of-bias instrument definitions ──────────────────────────────────────

/**
 * ROB2
 * Cochrane Risk of Bias 2 (RoB 2) domains for randomised trials.
 * @type {Array<{id:string, label:string}>}
 */
export const ROB2 = [
  { id: "D1", label: "Randomisation process" },
  { id: "D2", label: "Deviations from intended interventions" },
  { id: "D3", label: "Missing outcome data" },
  { id: "D4", label: "Measurement of the outcome" },
  { id: "D5", label: "Selection of the reported result" },
];

/**
 * NOS
 * Newcastle–Ottawa Scale domains for observational studies.
 * @type {Array<{id:string, g:string, label:string}>}
 */
export const NOS = [
  { id: "SC1", g: "Selection",     label: "Representativeness of exposed cohort" },
  { id: "SC2", g: "Selection",     label: "Selection of non-exposed cohort" },
  { id: "SC3", g: "Selection",     label: "Ascertainment of exposure" },
  { id: "SC4", g: "Selection",     label: "Absence of outcome at start" },
  { id: "CO1", g: "Comparability", label: "Comparability (most important factor)" },
  { id: "CO2", g: "Comparability", label: "Comparability (additional factor)" },
  { id: "OC1", g: "Outcome",       label: "Assessment of outcome" },
  { id: "OC2", g: "Outcome",       label: "Adequate follow-up length" },
  { id: "OC3", g: "Outcome",       label: "Adequate follow-up rate" },
];
