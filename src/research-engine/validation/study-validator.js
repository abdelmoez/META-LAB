/**
 * study-validator.js
 * Per-study field validation, cross-study analysis-type warnings,
 * poolability gate checks, and duplicate detection.
 *
 * All logic copied verbatim from meta-lab-3-patched.jsx.
 * References to ADJUST_LABEL / DATA_NATURE_LABEL / isNonPrimary are imported
 * from the project-model so this module stays free of duplicated constants.
 */

import { ADJUST_LABEL, DATA_NATURE_LABEL, isNonPrimary } from '../project-model/constants.js';

/**
 * validateStudy(s)
 * Per-study field-level validation.
 *
 * @param {object} s  A study object (shape: mkStudy())
 * @returns {Array<{sev:"error"|"warn", field:string, msg:string}>}
 *          Empty array means no issues found.
 */
export function validateStudy(s) {
  const out = [];
  const num = v => v !== "" && v !== null && v !== undefined && !isNaN(+v);
  const add = (sev, field, msg) => out.push({ sev, field, msg });

  if (!s.author) add("warn", "author", "No author/study label.");
  if (!s.year)   add("warn", "year",   "No publication year.");
  if (!s.outcome) add("warn", "outcome",
    "Outcome not named — needed to keep outcomes consistent across studies.");

  // group sizes vs total n
  if (num(s.n) && num(s.nExp) && num(s.nCtrl)) {
    if (Math.abs((+s.nExp + +s.nCtrl) - +s.n) > 0.5)
      add("error", "n",
        `Group sizes (${+s.nExp}+${+s.nCtrl}=${+s.nExp + +s.nCtrl}) don't match total n (${+s.n}).`);
  }

  // negative / impossible values
  ["sdExp","sdCtrl"].forEach(k => {
    if (num(s[k]) && +s[k] < 0) add("error", k, "SD cannot be negative.");
  });
  ["nExp","nCtrl","n","a","b","c","d","events","total","tp","fp","fn","tn"].forEach(k => {
    if (num(s[k]) && +s[k] < 0) add("error", k, `${k} cannot be negative.`);
  });

  // 2×2 table sanity
  if (["OR","RR"].includes(s.esType)) {
    const cells  = ["a","b","c","d"];
    const filled = cells.filter(k => num(s[k]));
    if (filled.length > 0 && filled.length < 4)
      add("warn", "a", "2×2 table is partly filled — enter all of a, b, c, d.");
    if (filled.length === 4 && (+s.a + +s.b === 0 || +s.c + +s.d === 0))
      add("error", "a", "A 2×2 group total is zero.");
  }

  // single-arm proportion
  if (s.esType === "PROP" && num(s.events) && num(s.total) && +s.events > +s.total)
    add("error", "events", "Events exceed total in single-arm proportion.");

  // diagnostic cells
  if (num(s.tp) || num(s.fp) || num(s.fn) || num(s.tn)) {
    const dcells = ["tp","fp","fn","tn"].filter(k => num(s[k]));
    if (dcells.length > 0 && dcells.length < 4)
      add("warn", "tp", "Diagnostic 2×2 partly filled — enter TP, FP, FN, TN.");
  }

  // effect size + CI coherence
  if (num(s.es) && num(s.lo) && num(s.hi)) {
    if (+s.lo > +s.hi)
      add("error", "lo", "95% CI lower bound is greater than upper bound.");
    else if (+s.es < +s.lo - 1e-6 || +s.es > +s.hi + 1e-6)
      add("error", "es", "Effect size lies outside its 95% CI.");
  }
  if (num(s.es) && !num(s.lo) && !num(s.hi))
    add("warn", "lo",
      "Effect size has no confidence interval — it can't be weighted in the meta-analysis.");
  if (!num(s.es) && (num(s.lo) || num(s.hi)))
    add("warn", "es", "CI entered but effect size is missing.");

  // effect-measure type
  if (num(s.es) && !s.esType)
    add("warn", "esType",
      "No effect-measure type set — required to confirm studies are on the same scale.");

  // ratio measures should be on the log scale
  if (["OR","RR","HR"].includes(s.esType) && num(s.es) && +s.es > 0 && num(s.lo) && +s.lo > 0) {
    if (+s.es > 1.6 && +s.lo > 0.3)
      add("warn", "es",
        "For OR/RR/HR the meta-analysis expects the LOG of the ratio. Use the calculator or " +
        "the OR/RR/HR conversion so the value and CI are log-transformed correctly.");
  }

  // continuous outcome missing spread
  if ((s.esType === "SMD" || s.esType === "MD") &&
      (num(s.meanExp) || num(s.meanCtrl)) &&
      !(num(s.sdExp) && num(s.sdCtrl)) &&
      !num(s.es))
    add("warn", "sdExp",
      "Means entered without both SDs. Use the conversion panel (SE→SD, CI→SD, " +
      "median/IQR→SD) to recover the SD.");

  // flag-driven reminders
  const flags = s.flags || [];
  if (flags.includes("noconfirm"))
    add("warn", "flags", '"do not pool unless confirmed" — resolve before including in a pooled analysis.');
  if (flags.includes("highrisk"))
    add("warn", "flags", "Flagged high risk of extraction error — verify against the source.");
  if ((flags.includes("conv") || s.converted) && !s.source)
    add("warn", "source", "Value was converted but its data source isn't labelled.");
  if (flags.includes("figure") && s.source !== "figure")
    add("warn", "source", "Flagged as figure-derived but data source isn't set to figure.");

  // converted value should have a record
  if (s.converted && (!s.conversions || s.conversions.length === 0))
    add("warn", "converted",
      "Marked converted but no conversion record is stored — re-run via the conversion " +
      "panel for a full audit trail.");

  return out;
}

/**
 * analysisTypeWarnings(studies)
 * Cross-study check: detects mismatches between raw data and the chosen
 * effect measure (e.g. two-arm data analysed as a single-arm proportion).
 *
 * Only studies that have an es value set (and will be pooled) are checked.
 *
 * @param {Array} studies
 * @returns {Array<{sev:"error"|"warn", id:string, author:string, msg:string}>}
 */
export function analysisTypeWarnings(studies) {
  const num = v => v !== "" && v != null && !isNaN(+v);
  const out = [];

  studies.forEach(s => {
    if (s.es === "") return; // only studies that will actually be pooled
    const who       = (s.author || "a study") + (s.year ? ` ${s.year}` : "");
    const has2x2    = ["a","b","c","d"].some(k => num(s[k]));
    const hasFull2x2 = ["a","b","c","d"].every(k => num(s[k]));
    const hasProp   = num(s.events) && num(s.total);
    const hasCont   = num(s.meanExp) || num(s.meanCtrl) || num(s.sdExp) || num(s.sdCtrl);
    const hasDiag   = ["tp","fp","fn","tn"].some(k => num(s[k]));
    const t = s.esType;

    // two-arm counts present but analysed as single-arm proportion
    if (t === "PROP" && has2x2)
      out.push({ sev:"error", id:s.id, author:who,
        msg:`${who} has two-arm event counts (a/b/c/d) but is set as a single-arm Proportion. ` +
            `A two-arm outcome like mortality should be Odds Ratio or Risk Ratio, not a proportion. ` +
            `Change the measure, or clear the 2×2 cells if you truly want a single-arm rate.` });

    // proportion data but analysed as a comparative ratio
    if ((t === "OR" || t === "RR") && !hasFull2x2 && hasProp && !has2x2)
      out.push({ sev:"warn", id:s.id, author:who,
        msg:`${who} is set as ${t} but only single-arm events/total are filled. ${t} needs both groups (a, b, c, d).` });

    // continuous data but analysed as a ratio/proportion
    if ((t === "OR" || t === "RR" || t === "PROP") && hasCont)
      out.push({ sev:"warn", id:s.id, author:who,
        msg:`${who} has continuous data (means/SDs) but is set as ${t}. Continuous outcomes are usually MD or SMD.` });

    // 2×2 present but measure is continuous
    if ((t === "SMD" || t === "MD") && hasFull2x2 && !hasCont)
      out.push({ sev:"warn", id:s.id, author:who,
        msg:`${who} has a 2×2 event table but is set as ${t} (a continuous measure). Dichotomous outcomes are usually OR or RR.` });

    // diagnostic cells present but not a diagnostic measure
    if (hasDiag && t && t !== "DIAG")
      out.push({ sev:"warn", id:s.id, author:who,
        msg:`${who} has TP/FP/FN/TN cells but is set as ${t}. Diagnostic data should use the Diagnostic (DOR) measure.` });
  });

  return out;
}

/**
 * checkPoolability(studies)
 * Project-level gate: should these studies be pooled at all?
 * Returns blockers (hard stops) and warnings (soft concerns).
 *
 * @param {Array} studies
 * @returns {{
 *   ok: boolean,
 *   blockers: string[],
 *   warnings: string[],
 *   valid: Array,
 *   types?: string[],
 *   designs?: string[],
 *   composition?: object
 * }}
 */
export function checkPoolability(studies) {
  const valid = studies.filter(
    s => s.es !== "" && s.lo !== "" && s.hi !== "" &&
         !isNaN(+s.es) && !isNaN(+s.lo) && !isNaN(+s.hi)
  );
  const blockers = [], warnings = [];

  if (valid.length < 2) {
    blockers.push("Fewer than 2 studies have a usable effect size + 95% CI.");
    return { ok: false, blockers, warnings, valid };
  }

  // mixed effect measures
  const types   = [...new Set(valid.map(s => s.esType).filter(Boolean))];
  if (types.length > 1) {
    blockers.push(
      `Mixed effect measures: ${types.join(", ")}. Pooling different measures ` +
      `(e.g. OR with SMD, or OR with RR) is not valid — split into separate analyses.`
    );
  }
  const untyped = valid.filter(s => !s.esType).length;
  if (untyped > 0 && types.length >= 1)
    warnings.push(
      `${untyped} stud${untyped === 1 ? "y has" : "ies have"} no effect-measure type set — ` +
      `confirm they are the same measure as the rest.`
    );

  // mixed study designs
  const designs = [...new Set(valid.map(s => s.design).filter(Boolean))];
  if (designs.length > 1)
    warnings.push(
      `Mixed study designs: ${designs.join(", ")}. Pooling RCTs with observational studies ` +
      `is usually inappropriate — consider separate syntheses or subgrouping by design.`
    );

  // mixed time points
  const tps = [...new Set(valid.map(s => (s.timepoint || "").trim()).filter(Boolean))];
  if (tps.length > 1)
    warnings.push(
      `Multiple time points present (${tps.join(", ")}). Pool only comparable follow-up ` +
      `windows for the same outcome.`
    );

  // mixed adjusted/unadjusted
  const adj     = [...new Set(valid.map(s => s.adjusted || "unadjusted"))];
  const hasUnadj = adj.includes("unadjusted");
  const hasAdj  = adj.some(a => a && a !== "unadjusted");
  if (hasUnadj && hasAdj)
    warnings.push(
      `Mix of unadjusted and adjusted estimates (${adj.map(a => ADJUST_LABEL[a] || a).join(", ")}). ` +
      `Don't combine them without a clear plan — prefer one type, or analyse separately.`
    );
  else if (adj.length > 1)
    warnings.push(
      `Multiple adjustment methods present (${adj.map(a => ADJUST_LABEL[a] || a).join(", ")}). ` +
      `Confirm they are comparable before pooling.`
    );

  // mixed outcomes
  const outs = [...new Set(valid.map(s => (s.outcome || "").trim().toLowerCase()).filter(Boolean))];
  if (outs.length > 1)
    warnings.push(
      `Studies name ${outs.length} different outcomes. Confirm they measure the same ` +
      `construct before pooling.`
    );

  // primary vs non-primary data composition
  const nonPrimary = valid.filter(isNonPrimary);
  const converted  = valid.filter(s => s.converted || (s.flags || []).includes("conv"));
  const natures    = [...new Set(valid.map(s => s.dataNature || "primary"))];
  if (natures.length > 1)
    warnings.push(
      `Mix of data roles: ${natures.map(n => DATA_NATURE_LABEL[n] || n).join(", ")}. ` +
      `Pooling secondary/subgroup/post-hoc estimates with primary-outcome data can bias the result.`
    );
  if (nonPrimary.length > 0 && nonPrimary.length / valid.length >= 0.5)
    warnings.push(
      `${nonPrimary.length} of ${valid.length} pooled values are non-primary, converted, ` +
      `figure-derived, or adjusted. The pooled estimate depends heavily on indirect data — ` +
      `interpret with caution and consider a sensitivity analysis limited to directly-reported primary data.`
    );
  if (converted.length > 0 && converted.length < valid.length) {
    const labelled = converted.every(
      s => s.source === "converted" || s.source === "calculated" || (s.conversions || []).length > 0
    );
    if (!labelled)
      warnings.push(
        "Converted and non-converted values are mixed but not all conversions are labelled. " +
        "Label each converted value's source and method."
      );
  }

  // hard stop: values marked do-not-pool
  const noconfirm = valid.filter(s => (s.flags || []).includes("noconfirm"));
  if (noconfirm.length > 0)
    blockers.push(
      `${noconfirm.length} value${noconfirm.length === 1 ? " is" : "s are"} marked ` +
      `"do not pool unless confirmed". Resolve or unflag before pooling.`
    );

  return {
    ok: blockers.length === 0, blockers, warnings, valid, types, designs,
    composition: {
      total:      valid.length,
      nonPrimary: nonPrimary.length,
      converted:  converted.length,
      primary:    valid.length - nonPrimary.length,
      natures, adj,
    },
  };
}

/**
 * findDuplicates(studies)
 * Detects studies with the same author+year, or identical effect size and n.
 *
 * @param {Array} studies
 * @returns {Object}  Map of { [studyId]: true } for each study flagged as a duplicate.
 */
export function findDuplicates(studies) {
  const dup = {};
  for (let i = 0; i < studies.length; i++) {
    for (let j = i + 1; j < studies.length; j++) {
      const a = studies[i], b = studies[j];
      const sameAY = a.author && b.author && a.year && b.year &&
        a.author.trim().toLowerCase() === b.author.trim().toLowerCase() &&
        String(a.year).trim() === String(b.year).trim();
      const sameES = a.es !== "" && a.es === b.es && a.n !== "" && a.n === b.n;
      if (sameAY || sameES) { dup[a.id] = true; dup[b.id] = true; }
    }
  }
  return dup;
}
