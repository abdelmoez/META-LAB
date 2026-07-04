/**
 * manuscript/prismaCounts.js — 64.md (P3). The ONE shared helper that normalizes
 * PRISMA 2020 flow counts for the manuscript (table + diagram + Methods/Results
 * draft all consume this — no duplicated arithmetic). Pure, dependency-free.
 *
 * Precedence per field (highest first):
 *   1. MANUAL OVERRIDE  — manuscript draft `prismaOverrides` (clearly labelled in UI/export).
 *   2. MANUAL           — the project's PRISMA flow numbers (`Project.data.prisma`),
 *                         which the user already maintains in the PRISMA Flow tab.
 *   3. COMPUTED         — live screening summary counts (records identified, after
 *                         dedup, decided) when passed in via opts.screening.
 *   4. DERIVED          — arithmetic between the above (screened = identified − dups …).
 *   5. MISSING          — nothing known → null + a warning; NEVER fabricated.
 *
 * The arithmetic mirrors buildPrismaSVG (svgBuilders.js) so the table, the diagram
 * and the narrative always agree:
 *   identified = dbs + reg + other
 *   screened   = identified − dedupe
 *   reportsAssessed = screened − excludedScreen
 *   included   = reportsAssessed − reportsExcluded
 */

function toNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} project   Project.data blob (uses project.prisma + project.studies)
 * @param {object} [opts]
 *   overrides: object       manuscript draft.prismaOverrides (manual overrides + note)
 *   screening: object       live screening summary, e.g.
 *                           { identified, afterDedup, screened, excluded, included }
 *                           (any subset; from _linkedMetaSift / API). Optional.
 * @returns normalized counts with `provenance` + `warnings`.
 */
export function computePrismaCounts(project, opts = {}) {
  const p = (project && project.prisma) || {};
  const ov = (opts && opts.overrides) || {};
  const sc = (opts && opts.screening) || {};
  const studies = Array.isArray(project && project.studies) ? project.studies : [];

  const provenance = {};
  const warnings = [];

  // Resolve a single field through the precedence chain.
  const pick = (key, manualKey, computedKey) => {
    const o = toNum(ov[key]);
    if (o != null) { provenance[key] = 'override'; return o; }
    const m = toNum(p[manualKey != null ? manualKey : key]);
    if (m != null) { provenance[key] = 'manual'; return m; }
    if (computedKey && toNum(sc[computedKey]) != null) {
      provenance[key] = 'computed';
      return toNum(sc[computedKey]);
    }
    provenance[key] = 'missing';
    return null;
  };

  const dbs = pick('dbs', 'dbs', 'identified');
  const reg = pick('reg', 'reg', null);
  const other = pick('other', 'other', null);

  // identified = dbs+reg+other when any present, else fall back to screening.identified
  let identified = null;
  const idParts = [dbs, reg, other].filter((x) => x != null);
  if (toNum(ov.identified) != null) { identified = toNum(ov.identified); provenance.identified = 'override'; }
  else if (idParts.length) {
    identified = idParts.reduce((a, b) => a + b, 0);
    // ≥2 source counts → a genuine sum (derived); a single source → inherit that
    // source's provenance so identified is never labelled "missing" when it is known.
    provenance.identified = idParts.length >= 2
      ? 'derived'
      : (dbs != null ? provenance.dbs : (reg != null ? provenance.reg : provenance.other));
  } else if (toNum(sc.identified) != null) { identified = toNum(sc.identified); provenance.identified = 'computed'; }
  else { provenance.identified = 'missing'; }

  const dedupe = pick('dedupe', 'dedupe', null) ?? (
    (toNum(sc.identified) != null && toNum(sc.afterDedup) != null)
      ? (provenance.dedupe = 'computed', toNum(sc.identified) - toNum(sc.afterDedup))
      : null
  );

  // screened = explicit manual `screened` OR identified − dedupe
  let screened = null;
  if (toNum(ov.screened) != null) { screened = toNum(ov.screened); provenance.screened = 'override'; }
  else if (toNum(p.screened) != null) { screened = toNum(p.screened); provenance.screened = 'manual'; }
  else if (identified != null && dedupe != null) { screened = identified - dedupe; provenance.screened = 'derived'; }
  else if (toNum(sc.screened) != null) { screened = toNum(sc.screened); provenance.screened = 'computed'; }
  else { provenance.screened = 'missing'; }

  const excludedScreen = pick('excludedScreen', 'excTA', 'excluded');

  // reportsAssessed = screened − excludedScreen
  let reportsAssessed = null;
  if (toNum(ov.reportsAssessed) != null) { reportsAssessed = toNum(ov.reportsAssessed); provenance.reportsAssessed = 'override'; }
  else if (toNum(p.ftRet) != null) { reportsAssessed = toNum(p.ftRet); provenance.reportsAssessed = 'manual'; }
  else if (screened != null && excludedScreen != null) { reportsAssessed = screened - excludedScreen; provenance.reportsAssessed = 'derived'; }
  else { provenance.reportsAssessed = 'missing'; }

  const reportsExcluded = pick('reportsExcluded', 'excFull', null);

  // included = reportsAssessed − reportsExcluded, OR manual `included`, OR the live
  // screening include count (recs round — sc.included was documented but never read),
  // OR #numeric studies as the last resort.
  let included = null;
  if (toNum(ov.included) != null) { included = toNum(ov.included); provenance.included = 'override'; }
  else if (toNum(p.included) != null) { included = toNum(p.included); provenance.included = 'manual'; }
  else if (reportsAssessed != null && reportsExcluded != null) { included = reportsAssessed - reportsExcluded; provenance.included = 'derived'; }
  else if (toNum(sc.included) != null) { included = toNum(sc.included); provenance.included = 'computed'; }
  else if (studies.length) {
    const n = studies.filter((s) => s && s.es !== '' && s.es != null && !isNaN(+s.es)).length;
    if (n) { included = n; provenance.included = 'computed'; }
    else { provenance.included = 'missing'; }
  } else { provenance.included = 'missing'; }

  // qualitative / quantitative synthesis counts
  let includedQual = toNum(ov.includedQual) ?? toNum(p.qual);
  provenance.includedQual = toNum(ov.includedQual) != null ? 'override' : (toNum(p.qual) != null ? 'manual' : 'missing');
  if (includedQual == null && included != null) { includedQual = included; provenance.includedQual = 'derived'; }

  let includedQuant = toNum(ov.includedQuant) ?? toNum(p.quant);
  provenance.includedQuant = toNum(ov.includedQuant) != null ? 'override' : (toNum(p.quant) != null ? 'manual' : 'missing');
  if (includedQuant == null) {
    const numeric = studies.filter((s) => s && s.es !== '' && s.es != null && !isNaN(+s.es)).length;
    if (numeric) { includedQuant = numeric; provenance.includedQuant = 'computed'; }
  }

  const duplicatesRemoved = dedupe;

  const reasonsRaw = Array.isArray(ov.reasons) && ov.reasons.length ? ov.reasons : (Array.isArray(p.reasons) ? p.reasons : []);
  const excludedReasons = reasonsRaw
    .map((r) => ({ reason: String(r.r || r.reason || '').trim(), n: toNum(r.n) }))
    .filter((r) => r.reason || r.n != null);

  // ── Honesty checks (never silently swallow contradictions) ──
  const neg = [];
  if (screened != null && screened < 0) neg.push('records screened');
  if (reportsAssessed != null && reportsAssessed < 0) neg.push('reports assessed');
  if (included != null && included < 0) neg.push('studies included');
  if (neg.length) warnings.push(`Derived PRISMA value(s) are negative (${neg.join(', ')}) — check the entered counts.`);

  if (reportsExcluded != null && excludedReasons.length) {
    const sumReasons = excludedReasons.reduce((a, r) => a + (r.n || 0), 0);
    if (sumReasons && reportsExcluded && sumReasons !== reportsExcluded) {
      warnings.push(`Full-text exclusion reasons sum to ${sumReasons} but ${reportsExcluded} reports were excluded — reconcile before submission.`);
    }
  }
  if (includedQuant != null && included != null && includedQuant > included) {
    warnings.push(`More studies in meta-analysis (${includedQuant}) than included in review (${included}) — check counts.`);
  }
  const missingKey = ['identified', 'screened', 'included'].filter((k) => provenance[k] === 'missing');
  if (missingKey.length) warnings.push(`PRISMA counts incomplete: ${missingKey.join(', ')} not available. Enter them in the PRISMA Flow tab or override here.`);

  const counts = {
    dbs, reg, other, identified,
    dedupe, duplicatesRemoved,
    screened, excludedScreen,
    reportsAssessed, reportsExcluded, excludedReasons,
    included, includedQual, includedQuant,
  };

  const hasAny = Object.values(counts).some((v) => typeof v === 'number' && Number.isFinite(v));

  return { counts, provenance, warnings, hasAny, overrideNote: (opts.overrides && opts.overrides.note) || '' };
}

/**
 * Project a computePrismaCounts result back into the `prisma` object shape that
 * svgBuilders.buildPrismaSVG expects (dbs/reg/other/dedupe/excTA/excFull/reasons/quant),
 * so the inline diagram is driven by the SAME resolved numbers. Pure.
 */
export function countsToPrismaShape(result) {
  const c = (result && result.counts) || {};
  return {
    dbs: c.dbs ?? '',
    reg: c.reg ?? '',
    other: c.other ?? '',
    dedupe: c.dedupe ?? '',
    excTA: c.excludedScreen ?? '',
    excFull: c.reportsExcluded ?? '',
    reasons: (c.excludedReasons || []).map((r) => ({ r: r.reason, n: r.n })),
    quant: c.includedQuant ?? '',
  };
}

export default { computePrismaCounts, countsToPrismaShape };
