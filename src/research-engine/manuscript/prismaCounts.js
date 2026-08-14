/**
 * manuscript/prismaCounts.js — 64.md (P3). The ONE shared helper that normalizes
 * PRISMA 2020 flow counts for the manuscript (table + diagram + Methods/Results
 * draft all consume this — no duplicated arithmetic). Pure.
 *
 * 106.md — the one import below is deliberate: publication-vs-case collapsing has
 * exactly ONE implementation (extraction/caseSeries.countPublications). Re-deriving it
 * here is how the search-methodology split went wrong in 104.md.
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

import { countPublications } from '../extraction/caseSeries.js';
// 116.md §41/§46 (r2) — "does this row carry an effect estimate?" has exactly ONE
// answer, and the pools already use it: `journalSubmission.getOutcomePairs` /
// `filterStudiesForOutcome` derive es/lo/hi for raw proportion rows, so the manuscript's
// synthesis counts k=N while these boxes, scanning only STORED es, reported the
// quantitative-synthesis count as "[not recorded]" in the same document. Dependency-free
// on purpose (no statistics engine in the manuscript count path).
import { rowHasEffect } from '../statistics/poolableRow.js';

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
  // ── 103.md §10/§15 — the record-derived flow WINS ────────────────────────
  //
  // When the caller supplies the canonical flow (derivePrismaFlow over the
  // project's actual records), every count comes from records and this function
  // becomes a thin adapter. That is what makes the manuscript, the diagram, the
  // export and project statistics structurally incapable of disagreeing (§15),
  // and it is why the user-typed tiers below can no longer outrank real data:
  // 103.md's core principle is that PRISMA must never depend on a number the user
  // typed when PecanRev already knows it.
  //
  // The legacy precedence chain is preserved BELOW for projects that have no
  // record-level data yet (a manuscript-only project, or one predating this
  // round), so nothing regresses — but it is now the fallback, not the default.
  if (opts.flow) return adaptFlow(opts.flow, opts);

  const p = (project && project.prisma) || {};
  const ov = (opts && opts.overrides) || {};
  const sc = (opts && opts.screening) || {};
  const studies = Array.isArray(project && project.studies) ? project.studies : [];

  const provenance = {};
  const warnings = [];

  // Resolve a single field through the precedence chain. Accepts several computed keys
  // tried in order (first non-null wins), so a field can prefer an explicit value and fall
  // back to a coarser one.
  const pick = (key, manualKey, ...computedKeys) => {
    const o = toNum(ov[key]);
    if (o != null) { provenance[key] = 'override'; return o; }
    const m = toNum(p[manualKey != null ? manualKey : key]);
    if (m != null) { provenance[key] = 'manual'; return m; }
    for (const ck of computedKeys) {
      if (ck && toNum(sc[ck]) != null) { provenance[key] = 'computed'; return toNum(sc[ck]); }
    }
    provenance[key] = 'missing';
    return null;
  };

  // 77.md §1 — dbs prefers the explicit per-source split (sc.dbs), falling back to the whole
  // identified count only when no split is available (legacy behaviour). reg/other now read
  // the canonical split too (previously always manual/missing).
  const dbs = pick('dbs', 'dbs', 'dbs', 'identified');
  const reg = pick('reg', 'reg', 'reg');
  const other = pick('other', 'other', 'other');

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

  // 77.md §1 — deduplication is a TRI-STATE: performed (a real count, possibly 0),
  // not-performed, or unknown. A null count must never render as a confident "0".
  let dedupe = pick('dedupe', 'dedupe', null);
  // MetaSiftPrismaSync auto-persists project.prisma.dedupe="0" precisely when the live
  // source reports dedup NOT performed (duplicatesRemoved is 0 then). Don't let that echo
  // mask the honest "not-performed" state — only a deliberate override (draft.prismaOverrides)
  // or a non-zero manual value should stand.
  if (provenance.dedupe === 'manual' && dedupe === 0 && sc.dedupePerformed === false && toNum(ov.dedupe) == null) {
    dedupe = null;
  }
  if (dedupe == null) {
    if (toNum(sc.identified) != null && toNum(sc.afterDedup) != null && sc.dedupePerformed !== false) {
      dedupe = toNum(sc.identified) - toNum(sc.afterDedup);
      provenance.dedupe = 'computed';
    } else if (sc.dedupePerformed === false) {
      provenance.dedupe = 'not-performed';   // count stays null; the UI/text shows "not performed", not 0
    } else {
      provenance.dedupe = 'missing';
    }
  }
  const dedupePerformed = sc.dedupePerformed === true ? true : sc.dedupePerformed === false ? false : null;
  const dedupeMethod = sc.dedupeMethod || null;
  const dedupeLastRunAt = sc.dedupeLastRunAt || null;

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
    // 106.md §Prevent double counting — PRISMA's "included" box is PUBLICATIONS. This
    // last-resort fallback used to count extraction ROWS, so a case series of eight
    // patients (or a trial with three outcome rows) reported eight/three included
    // studies. Collapse rows onto their publication first; the numeric-`es` filter is
    // preserved so a study with no usable estimate still does not inflate the box —
    // 116.md §46 (r2): "usable" now means what the pool means (stored OR derived).
    const withEs = studies.filter((s) => rowHasEffect(s));
    const n = countPublications(withEs);
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
    // 106.md — same publication-scoping as `included` above: "studies in the
    // quantitative synthesis" is a study count, never a case count.
    // 116.md §46 (r2) — the ONLY computed source for this box, so a raw-proportion
    // review used to print "[not recorded]" beside its own k=N synthesis.
    const numeric = countPublications(studies.filter((s) => rowHasEffect(s)));
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
  // 77.md §1 — be explicit rather than silently reporting 0 duplicates.
  if (provenance.dedupe === 'not-performed') {
    warnings.push('Deduplication has not been performed (or is not recorded) — "duplicates removed" is unknown, not zero. Run deduplication in Screening, or enter the count here.');
  } else if (provenance.dedupe === 'missing' && identified != null) {
    warnings.push('Duplicates removed is not available — confirm whether deduplication was performed before reporting it.');
  }

  const counts = {
    dbs, reg, other, identified,
    dedupe, duplicatesRemoved,
    dedupePerformed, dedupeMethod, dedupeLastRunAt,
    screened, excludedScreen,
    reportsAssessed, reportsExcluded, excludedReasons,
    included, includedQual, includedQuant,
  };

  const hasAny = Object.values(counts).some((v) => typeof v === 'number' && Number.isFinite(v));

  return { counts, provenance, warnings, hasAny, overrideNote: (opts.overrides && opts.overrides.note) || '' };
}

/**
 * 103.md §10 — adapt the canonical record-derived flow to this module's legacy
 * output shape, so every existing consumer (the counts table, the SVG, the
 * Methods/Results narrative, the fact tokens) keeps working while now reading
 * numbers that came from records.
 *
 * Provenance for every key is 'records': the count is the size of a set the caller
 * can inspect (§12). There is no 'override'/'manual' tier here on purpose — a
 * number the project can derive must not be typeable.
 * Pure.
 */
function adaptFlow(flow, opts = {}) {
  const c = (flow && flow.counts) || {};
  const rec = (flow && flow.reconciliation) || null;
  const provenance = {};
  const counts = {
    dbs: c.identifiedDb ?? null,
    // The other-methods arm is PRISMA 2020's own split; registers are already
    // folded into the database arm, so `reg` stays null rather than double-count.
    reg: null,
    other: c.identifiedOther ?? null,
    identified: c.identified ?? null,
    dedupe: c.duplicatesRemoved ?? null,
    duplicatesRemoved: c.duplicatesRemoved ?? null,
    dedupePerformed: (c.duplicatesRemoved ?? 0) > 0 ? true : null,
    dedupeMethod: null,
    dedupeLastRunAt: null,
    screened: c.screened ?? null,
    excludedScreen: c.excludedScreen ?? null,
    // NEW in 103.md — the retrieval stage the old model could not represent.
    sought: c.sought ?? null,
    notRetrieved: c.notRetrieved ?? null,
    reportsAssessed: c.reportsAssessed ?? null,
    reportsExcluded: c.reportsExcluded ?? null,
    excludedReasons: (flow.exclusionReasons || []).map((r) => ({ reason: r.label, n: r.n })),
    included: c.included ?? null,
    includedReports: c.includedReports ?? null,
    includedQual: c.included ?? null,
    includedQuant: c.includedQuant ?? null,
  };
  for (const k of Object.keys(counts)) provenance[k] = counts[k] == null ? 'missing' : 'records';

  // §13 — reconciliation issues surface as warnings on the existing channel, so
  // every current consumer shows them without changing.
  const warnings = rec
    ? rec.issues.filter((i) => i.severity !== 'info').map((i) => i.message)
    : [];

  return {
    counts,
    provenance,
    warnings,
    hasAny: Object.values(counts).some((v) => typeof v === 'number' && Number.isFinite(v)),
    overrideNote: (opts.overrides && opts.overrides.note) || '',
    flow,
  };
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
