/**
 * rValidation.js — R validation engine (prompt44 item 2). Pure functions, no I/O,
 * NO code execution.
 *
 * Purpose: let a statistician INDEPENDENTLY validate PecanRev's meta-analysis in
 * R/RStudio. We generate a single, self-contained `metafor` script that reproduces,
 * from the same per-study inputs, the pooled effect, its 95% CI, heterogeneity
 * (I² / τ² / Q) and the prediction interval — then prints PecanRev's own reported
 * values alongside so the two can be compared line by line.
 *
 * Why a generated script (not in-app execution): the app runs in the browser /
 * Node and has no R runtime, and running arbitrary R would be an unacceptable
 * code-execution surface. The script is data + standard library calls the user
 * runs themselves. `buildExecutionRequest` is a deliberately INERT service boundary
 * so a future, sandboxed server-side R runner can be added without changing callers.
 *
 * Statistical mapping (kept faithful to src/research-engine/statistics/meta-analysis.js):
 *   - stored es/lo/hi are already on the ANALYSIS scale (log scale for OR/RR/HR), so
 *     yi = es and sei = (hi − lo) / (2 · 1.959964) with NO further transform;
 *   - random effects → DerSimonian–Laird  → rma(method = "DL"); + HKSJ → test = "knha";
 *   - fixed effects  → inverse-variance    → rma(method = "FE");
 *   - ratio measures are back-transformed with exp() for the human-readable summary.
 */

export const R_VALIDATION_VERSION = '1';

// 97.5th percentile of the standard normal — the same Z975 the app uses to turn a
// 95% CI back into a standard error.
const Z975 = 1.959963984540054;

/** Format a number for R source: a finite value rounded to `dp`, else NA. */
export function rNum(x, dp = 6) {
  if (x == null || x === '') return 'NA';
  const n = Number(x);
  if (!Number.isFinite(n)) return 'NA';
  // toFixed then strip trailing zeros, but ONLY after a decimal point — otherwise a
  // whole number like 10/100 (dp=0) would lose its significant trailing zeros.
  const s = n.toFixed(dp);
  return (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s) || '0';
}

/** Escape a JS string for safe use inside an R double-quoted string literal. */
export function rString(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ').trim();
}

/** Build an R numeric vector literal: c(1, 2, NA). */
function rNumVec(arr, dp = 6) {
  return `c(${(arr || []).map((v) => rNum(v, dp)).join(', ')})`;
}

/** Build an R character vector literal: c("a", "b"). */
function rStrVec(arr) {
  return `c(${(arr || []).map((v) => `"${rString(v)}"`).join(', ')})`;
}

/**
 * Normalize one outcome's study rows to the numeric arrays the script needs.
 * Keeps only rows with a finite es/lo/hi (mirrors runMeta's `valid` filter).
 * @returns {{ labels:string[], yi:number[], sei:number[], es:number[], lo:number[], hi:number[] }}
 */
export function studyVectors(studies) {
  const labels = [], yi = [], sei = [], es = [], lo = [], hi = [];
  for (const s of Array.isArray(studies) ? studies : []) {
    if (!s || s.es === '' || s.lo === '' || s.hi === '' || s.es == null || s.lo == null || s.hi == null) continue;
    const e = Number(s.es), l = Number(s.lo), h = Number(s.hi);
    if (![e, l, h].every(Number.isFinite)) continue;
    labels.push(s.label || s.name || s.author || s.study || `Study ${labels.length + 1}`);
    es.push(e); lo.push(l); hi.push(h);
    yi.push(e);
    sei.push((h - l) / (2 * Z975));
  }
  return { labels, yi, sei, es, lo, hi };
}

/** The exact rma() call for a model/HKSJ combination, matching the app's estimators. */
export function rmaCall(model, hksj) {
  const method = model === 'fixed' ? 'FE' : 'DL';
  const test = model !== 'fixed' && hksj ? ', test = "knha"' : '';
  return `rma(yi = yi, sei = sei, method = "${method}"${test})`;
}

/**
 * Build the R block for a single outcome.
 * @param {object} outcome
 *   { label, esType, esTypeLabel, isLog, model, hksj, studies, app }
 *   `app` (optional) = PecanRev's reported values for the comparison footer:
 *     { k, pooled, lo, hi, I2, tau2, Q, Qdf, Qp, predLo, predHi }  (analysis scale)
 * @param {number} index 1-based outcome index (for unique R object names)
 * @returns {{ block:string, k:number, skipped?:string }}
 */
export function buildOutcomeBlock(outcome, index) {
  const o = outcome || {};
  const v = studyVectors(o.studies);
  const id = `o${index}`;
  const isLog = !!o.isLog;
  const heading = `# ── Outcome ${index}: ${rString(o.label || 'Outcome')} — ${rString(o.esTypeLabel || o.esType || 'effect size')} ──`;

  if (v.yi.length < 2) {
    return { block: `${heading}\n# Skipped — needs at least 2 studies with a complete effect size and 95% CI (has ${v.yi.length}).\n`, k: v.yi.length, skipped: 'not enough studies' };
  }

  const app = o.app || {};
  const bt = (x) => (isLog ? `exp(${x})` : x);            // back-transform for ratio measures
  const appLine = (label, val, dp = 4) => `#   ${label.padEnd(22)} ${rNum(val, dp)}`;

  const lines = [];
  lines.push(heading);
  lines.push(`${id}_labels <- ${rStrVec(v.labels)}`);
  lines.push(`yi  <- ${rNumVec(v.yi)}`);
  lines.push(`sei <- ${rNumVec(v.sei)}`);
  lines.push(`${id}_res <- ${rmaCall(o.model, o.hksj)}`);
  lines.push(`yi <- NULL; sei <- NULL  # (locals consumed; results live on ${id}_res)`);
  lines.push('');
  lines.push(`cat("\\n==== Outcome ${index}: ${rString(o.label || 'Outcome')} ====\\n")`);
  lines.push(`print(summary(${id}_res))`);
  lines.push(`cat(sprintf("I^2 = %.1f%%   tau^2 = %.4f   Q(%d) = %.3f, p = %.4f\\n",`);
  lines.push(`            ${id}_res$I2, ${id}_res$tau2, ${id}_res$k - ${id}_res$p, ${id}_res$QE, ${id}_res$QEp))`);
  // Prediction interval (metafor needs k >= 3 for a meaningful PI).
  lines.push(`if (${id}_res$k >= 3) { ${id}_pi <- predict(${id}_res${isLog ? ', transf = exp' : ''}); ` +
    `cat(sprintf("95%% prediction interval: %.4f to %.4f\\n", ${id}_pi$pi.lb, ${id}_pi$pi.ub)) }`);
  if (isLog) {
    lines.push(`${id}_bt <- predict(${id}_res, transf = exp)`);
    lines.push(`cat(sprintf("Pooled (back-transformed): %.4f  95%% CI %.4f to %.4f\\n", ${id}_bt$pred, ${id}_bt$ci.lb, ${id}_bt$ci.ub))`);
  }
  // PecanRev comparison footer (analysis scale; the script's own values print above).
  lines.push('');
  lines.push('# --- PecanRev reported values for this outcome (compare with the output above) ---');
  if (Number.isFinite(Number(app.k))) lines.push(`#   studies (k)            ${rNum(app.k, 0)}`);
  if (Number.isFinite(Number(app.pooled))) lines.push(appLine('pooled (analysis)', app.pooled));
  if (Number.isFinite(Number(app.lo)) && Number.isFinite(Number(app.hi))) lines.push(`#   95% CI (analysis)      ${rNum(app.lo, 4)} to ${rNum(app.hi, 4)}`);
  if (isLog && Number.isFinite(Number(app.pooled))) lines.push(`#   pooled (back-transf.)  ${rNum(Math.exp(Number(app.pooled)), 4)}  [${rNum(Math.exp(Number(app.lo)), 4)}, ${rNum(Math.exp(Number(app.hi)), 4)}]`);
  if (Number.isFinite(Number(app.I2))) lines.push(`#   I^2                    ${rNum(app.I2, 1)}%`);
  if (Number.isFinite(Number(app.tau2))) lines.push(appLine('tau^2', app.tau2));
  if (Number.isFinite(Number(app.Q))) lines.push(`#   Q                      ${rNum(app.Q, 3)}${Number.isFinite(Number(app.Qp)) ? `  (p = ${rNum(app.Qp, 4)})` : ''}`);
  if (Number.isFinite(Number(app.predLo)) && Number.isFinite(Number(app.predHi))) {
    lines.push(`#   95% prediction int.    ${rNum(app.predLo, 4)} to ${rNum(app.predHi, 4)}`);
    // Back-transform for ratio measures so it matches the script's exp()-transformed PI.
    if (isLog) lines.push(`#   95% pred. int. (bt)    ${rNum(Math.exp(Number(app.predLo)), 4)} to ${rNum(Math.exp(Number(app.predHi)), 4)}`);
  }
  lines.push('');
  return { block: lines.join('\n'), k: v.yi.length };
}

/**
 * Build the full, self-contained R validation script for a project.
 * @param {object} args
 *   { projectName, generatedAt (ISO string), appVersion, outcomes: Outcome[] }
 * @returns {string} the .R file contents
 */
export function buildMetaValidationR({ projectName, generatedAt, appVersion, outcomes } = {}) {
  const list = Array.isArray(outcomes) ? outcomes : [];
  const blocks = list.map((o, i) => buildOutcomeBlock(o, i + 1));
  const ran = blocks.filter((b) => !b.skipped).length;

  const header = [
    '# ============================================================================',
    `# PecanRev — R validation script${appVersion ? ` (app ${appVersion})` : ''}`,
    `# Project: ${rString(projectName || 'Untitled project')}`,
    generatedAt ? `# Generated: ${rString(generatedAt)}` : null,
    `# Outcomes: ${list.length} (${ran} with enough data to pool)`,
    '#',
    '# WHAT THIS IS: an INDEPENDENT reproduction of PecanRev\'s meta-analysis using the',
    '# `metafor` package. Run it in R / RStudio and compare each outcome\'s output with',
    '# the "PecanRev reported values" printed beneath it. They should match within',
    '# rounding. This script does NOT run inside the app — it is yours to run + audit.',
    '#',
    '# Estimators (matched to PecanRev): random effects = DerSimonian–Laird (method "DL"),',
    '# optional Hartung–Knapp (test "knha"); fixed effect = inverse-variance (method "FE").',
    '# For ratio measures (OR/RR/HR) inputs are on the log scale and back-transformed',
    '# with exp() for the human-readable summary.',
    '#',
    '# REQUIREMENTS: R >= 4.0 and the metafor package:  install.packages("metafor")',
    '# ============================================================================',
    '',
    'if (!requireNamespace("metafor", quietly = TRUE)) {',
    '  stop("The \'metafor\' package is required. Install it with: install.packages(\\"metafor\\")")',
    '}',
    'library(metafor)',
    '',
  ].filter((l) => l !== null).join('\n');

  const body = list.length
    ? blocks.map((b) => b.block).join('\n')
    : '# No outcomes with effect sizes were found in this project.\n';

  const footer = [
    '',
    '# ── End of validation script. If any outcome differs by more than rounding,',
    '#    re-check the per-study effect sizes and 95% CIs that were entered. ──',
    '',
  ].join('\n');

  return `${header}\n${body}${footer}`;
}

/**
 * INERT service boundary for a FUTURE sandboxed server-side R runner. It performs no
 * execution — it returns a structured request describing what WOULD be run, so the
 * UI can show clear "not executed here" messaging and a real runner can be slotted in
 * later without changing call sites.
 */
export function buildExecutionRequest({ script = '', projectId = null, outcomeId = null } = {}) {
  return {
    engine: 'R',
    library: 'metafor',
    status: 'not_executed',
    reason: 'In-app R execution is not enabled. Download the script and run it in R / RStudio to validate.',
    script: String(script || ''),
    projectId,
    outcomeId,
    version: R_VALIDATION_VERSION,
  };
}
