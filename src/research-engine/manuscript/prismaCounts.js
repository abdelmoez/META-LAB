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
 * 117.md §21/§22 — on the CANONICAL (flow) path the tiers above do not apply: the
 * counts are derived from records and only an EXPLICIT, AUDITED override may sit on
 * top of them, as a non-destructive overlay that records the automated value it
 * displaced. See adaptFlow + PRISMA_OVERRIDE_FIELDS below.
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

/* ════════════ 117.md §21/§22 — the explicit, audited DATA override model ════
 *
 * §21 draws a line the previous implementation did not: a manual count is not a
 * replacement for project data, it is an OVERLAY on top of it. So every override
 * keeps BOTH numbers — `{ value, auto }` — and the UI is required to show them
 * together ("Automated value: 231 → Manual override: 229") with a revert control.
 * The derived value is never mutated, which is what makes "revert to automatic"
 * a deletion of one key rather than a recovery operation.
 *
 * This registry is the ONE place that says which boxes are overridable, so the
 * panel, the counts adapter and the audit log cannot drift.
 *
 * `flowOnly` fields exist only on the canonical record-derived flow (the legacy
 * counter chain has no retrieval stage and no reports-vs-studies split), so the
 * panel hides them for a project that has no linked records yet rather than
 * offering an input that would do nothing.
 */
export const PRISMA_OVERRIDE_FIELDS = Object.freeze([
  { key: 'identified', label: 'Records identified' },
  { key: 'dedupe', label: 'Duplicates removed' },
  { key: 'screened', label: 'Records screened' },
  { key: 'excludedScreen', label: 'Records excluded (screening)' },
  { key: 'sought', label: 'Reports sought for retrieval', flowOnly: true },
  { key: 'notRetrieved', label: 'Reports not retrieved', flowOnly: true },
  { key: 'reportsAssessed', label: 'Reports assessed for eligibility' },
  { key: 'reportsExcluded', label: 'Reports excluded (full text)' },
  { key: 'included', label: 'Studies included in review' },
  { key: 'includedReports', label: 'Reports of included studies', flowOnly: true },
  { key: 'includedQuant', label: 'Studies in meta-analysis' },
]);

export const PRISMA_OVERRIDE_KEYS = PRISMA_OVERRIDE_FIELDS.map((f) => f.key);

/** Human label for an overridable field (falls back to the raw key). Pure. */
export function prismaOverrideLabel(key) {
  const f = PRISMA_OVERRIDE_FIELDS.find((x) => x.key === key);
  return f ? f.label : String(key == null ? '' : key);
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

  // 117.md §21 — the SAME {value, auto} overlay shape the flow path publishes, so
  // the panel can render "Automated value → Manual override" on either path. The
  // legacy chain short-circuits at the first tier that answers, so the automated
  // value is recovered by re-resolving the SAME inputs with the overrides removed —
  // one extra pure pass, and only when an override actually exists. The recursion is
  // one level deep by construction: the inner call has no overrides, so no field can
  // resolve to 'override' and it cannot re-enter.
  const overrides = {};
  const overridden = Object.keys(provenance).filter((k) => provenance[k] === 'override');
  if (overridden.length) {
    const auto = computePrismaCounts(project, { ...opts, overrides: {} });
    for (const k of overridden) {
      overrides[k] = { value: counts[k], auto: auto.counts[k] == null ? null : auto.counts[k] };
    }
  }

  return {
    counts, provenance, warnings, hasAny, overrides,
    overrideNote: (opts.overrides && opts.overrides.note) || '',
  };
}

/* ════════ 117.md §17 (r2 fix) — the identities an OVERRIDE can break ════════
 *
 * The engine's own reconciliation runs over record-derived counts. An override is a
 * typed number laid on top of them AFTER that check, so the checked object and the
 * reported object are not the same object — which is precisely how "Override makes
 * records screened (2,164) exceed records identified (100)" can reach a Methods
 * paragraph without a single warning anywhere.
 *
 * This re-checks the POST-override counts against the basic PRISMA 2020 stage
 * identities. Deliberately narrow:
 *   · only pairs where BOTH sides resolved to a number are compared — a missing count
 *     is already reported by its own channel and must not be inferred as 0;
 *   · every message names the identity AND both numbers, because "counts do not
 *     reconcile" is not something a reviewer can act on;
 *   · nothing is repaired. The override stands; the contradiction is stated.
 *
 * `identified − removed = screened` is checked as an equality only when the removal
 * count is known, and as an inequality (`screened ≤ identified`) otherwise, because
 * §16 allows workflows that record no dedup step at all.
 * Pure; exported for the unit suite.
 */
export function overrideCoherenceWarnings(counts) {
  const c = counts || {};
  const n = (k) => (typeof c[k] === 'number' && Number.isFinite(c[k]) ? c[k] : null);
  const fmt = (v) => Number(v).toLocaleString('en-US');
  const out = [];

  const identified = n('identified');
  const dedupe = n('dedupe');
  const screened = n('screened');
  const excludedScreen = n('excludedScreen');
  const sought = n('sought');
  const notRetrieved = n('notRetrieved');
  const assessed = n('reportsAssessed');
  const reportsExcluded = n('reportsExcluded');
  const included = n('included');
  const includedQuant = n('includedQuant');

  // No stage can be negative, whoever typed it.
  const NEG = [
    ['identified', 'Records identified'], ['dedupe', 'Duplicates removed'],
    ['screened', 'Records screened'], ['excludedScreen', 'Records excluded (screening)'],
    ['sought', 'Reports sought for retrieval'], ['notRetrieved', 'Reports not retrieved'],
    ['reportsAssessed', 'Reports assessed for eligibility'], ['reportsExcluded', 'Reports excluded (full text)'],
    ['included', 'Studies included in review'], ['includedQuant', 'Studies in meta-analysis'],
  ];
  for (const [key, label] of NEG) {
    const v = n(key);
    if (v != null && v < 0) out.push(`Override makes ${label.toLowerCase()} negative (${fmt(v)}) — no PRISMA stage can hold fewer than zero records.`);
  }

  if (identified != null && screened != null) {
    if (screened > identified) {
      // The headline impossibility, stated first and on its own: no dedup count can
      // make this legal, so it is reported whether or not one is known. Reporting the
      // equality break as well would be two sentences about one mistake.
      out.push(`Override makes records screened (${fmt(screened)}) exceed records identified (${fmt(identified)}).`);
    } else if (dedupe != null) {
      const expect = identified - dedupe;
      if (screened !== expect) {
        out.push(
          `Override breaks records identified − duplicates removed = records screened `
          + `(${fmt(identified)} − ${fmt(dedupe)} = ${fmt(expect)}, but records screened is ${fmt(screened)}).`,
        );
      }
    }
  }
  if (identified != null && dedupe != null && dedupe > identified) {
    out.push(`Override makes duplicates removed (${fmt(dedupe)}) exceed records identified (${fmt(identified)}).`);
  }
  if (screened != null && excludedScreen != null && excludedScreen > screened) {
    out.push(`Override makes records excluded at screening (${fmt(excludedScreen)}) exceed records screened (${fmt(screened)}).`);
  }
  if (screened != null && sought != null && sought > screened) {
    out.push(`Override makes reports sought for retrieval (${fmt(sought)}) exceed records screened (${fmt(screened)}).`);
  }
  if (sought != null && notRetrieved != null && notRetrieved > sought) {
    out.push(`Override makes reports not retrieved (${fmt(notRetrieved)}) exceed reports sought for retrieval (${fmt(sought)}).`);
  }
  if (sought != null && notRetrieved != null && assessed != null) {
    const expect = sought - notRetrieved;
    if (assessed !== expect) {
      out.push(
        `Override breaks reports sought − reports not retrieved = reports assessed `
        + `(${fmt(sought)} − ${fmt(notRetrieved)} = ${fmt(expect)}, but reports assessed is ${fmt(assessed)}).`,
      );
    }
  }
  if (screened != null && assessed != null && excludedScreen != null && sought == null) {
    const expect = screened - excludedScreen;
    if (assessed !== expect) {
      out.push(
        `Override breaks records screened − records excluded = reports assessed `
        + `(${fmt(screened)} − ${fmt(excludedScreen)} = ${fmt(expect)}, but reports assessed is ${fmt(assessed)}).`,
      );
    }
  }
  if (assessed != null && reportsExcluded != null && reportsExcluded > assessed) {
    out.push(`Override makes reports excluded at full text (${fmt(reportsExcluded)}) exceed reports assessed for eligibility (${fmt(assessed)}).`);
  }
  if (assessed != null && included != null && included > assessed) {
    out.push(`Override makes studies included (${fmt(included)}) exceed reports assessed for eligibility (${fmt(assessed)}).`);
  }
  if (included != null && includedQuant != null && includedQuant > included) {
    out.push(`Override makes studies in the meta-analysis (${fmt(includedQuant)}) exceed studies included in the review (${fmt(included)}).`);
  }
  return out;
}

/**
 * 103.md §10 — adapt the canonical record-derived flow to this module's legacy
 * output shape, so every existing consumer (the counts table, the SVG, the
 * Methods/Results narrative, the fact tokens) keeps working while now reading
 * numbers that came from records.
 *
 * Provenance for every key is 'records': the count is the size of a set the caller
 * can inspect (§12). There is still no 'manual' tier — a number the project can
 * derive must not be silently outranked by a stale typed one — but 117.md §21 adds
 * one EXPLICIT, AUDITED override tier on top, which is a different thing: it keeps
 * the automated value, is labelled everywhere it applies, and is revertible in one
 * click. See the overlay below.
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

  /* ── 117.md §21/§22 — explicit audited overrides ON the canonical flow ──────
   *
   * 103.md deliberately gave adaptFlow NO override tier: "a number the project can
   * derive must not be typeable". 117.md §21 revisits that, and the resolution is
   * not a retreat — it is a different mechanism. The derived counts are computed
   * FIRST and kept intact; an override is then layered on top and RECORDS the
   * automated value it displaced (`{ value, auto }`), so:
   *
   *   - nothing derived is destroyed (the auto value is still in the result, and
   *     the record sets behind `flow.boxes` are untouched);
   *   - the UI can state both numbers, which is exactly what §21 demands;
   *   - reverting is deleting one key, never a repair;
   *   - the figure, the counts table, the narrative and the export all read this
   *     one object, so an override cannot apply to some surfaces and not others.
   */
  const ov = (opts && opts.overrides) || {};
  const overrides = {};
  for (const key of PRISMA_OVERRIDE_KEYS) {
    const v = toNum(ov[key]);
    if (v == null) continue;
    overrides[key] = { value: v, auto: counts[key] == null ? null : counts[key] };
    counts[key] = v;
    provenance[key] = 'override';
    // `dedupe` and `duplicatesRemoved` are the SAME number under two names in this
    // object (the arithmetic twin the legacy chain introduced). Leaving one behind
    // would make the result self-contradictory, so they move together — this is the
    // only propagation, and it is an identity, not an inference.
    if (key === 'dedupe') { counts.duplicatesRemoved = v; provenance.duplicatesRemoved = 'override'; }
  }
  const overriddenKeys = Object.keys(overrides);
  if (overriddenKeys.length) {
    // 117.md §17 (r2 fix) — THE OVERRIDDEN NUMBERS GET THE SAME AUDIT THE DERIVED
    // ONES DO. `flow.reconciliation` above was computed by the PRISMA engine over the
    // RECORD-derived counts; the overlay then replaces some of them, and nothing
    // re-checked the result. A reviewer could type 2164 into "records screened" on a
    // review that identified 100 records and the counts table, the narrative and the
    // export would all print it without a word. §17 is explicit: "do not silently
    // render impossible PRISMA diagrams" — so the post-override counts are checked
    // against the stage identities and every broken one is NAMED with its numbers.
    for (const w of overrideCoherenceWarnings(counts)) warnings.push(w);

    // Never silent (§21). The DIAGRAM is deliberately left alone: every box in it is
    // a record set a reviewer can click into (§12), and a typed number has no records
    // behind it — redrawing the figure from an override would destroy exactly the
    // inspectability that makes the flow trustworthy. So the override governs the
    // reported counts and the figure keeps showing what the records say, and this
    // warning states that difference rather than hiding it.
    warnings.push(
      `${overriddenKeys.length} PRISMA count${overriddenKeys.length === 1 ? ' is' : 's are'} manually overridden `
      + `(${overriddenKeys.map(prismaOverrideLabel).join(', ')}) — the counts table, narrative and export report the `
      + 'override; the flow diagram still draws the record-derived figures.',
    );
  }

  return {
    counts,
    provenance,
    warnings,
    hasAny: Object.values(counts).some((v) => typeof v === 'number' && Number.isFinite(v)),
    overrides,
    overrideNote: (opts.overrides && opts.overrides.note) || '',
    flow,
    // §18 — the structural self-audit, surfaced as an object rather than only as
    // warning strings, so a panel can show an issue COUNT and severity without
    // re-deriving anything.
    reconciliation: rec,
  };
}

/* ════════════ 117.md §22 — the override record ON THE DRAFT ════════════
 *
 * The overlay above is a READ-time projection; these are the pure write/compare
 * primitives behind it, kept in this module so the override model has exactly one
 * home (the registry, the read overlay and the audit entry cannot drift apart).
 *
 * Byte-stability (repo rule): `prismaOverrideLog` materializes ONLY when non-empty,
 * exactly like draft.assets / draft.snapshots, and the writer both caps it and
 * deletes it when it empties — so a project that never overrode a count normalizes
 * byte-identically and needs no migration. The cap is enforced on every WRITE (there
 * is no read-side normalizer for this key), which is also what heals a blob that
 * arrived with an over-long array.
 */

/** How many audit entries the in-draft override log keeps (oldest dropped first). */
export const PRISMA_OVERRIDE_LOG_CAP = 50;

const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** The stored override for one field — a number, or null when it tracks the project. Pure. */
export function prismaOverrideOf(draft, field) {
  const d = asObj(draft);
  const ov = d ? asObj(d.prismaOverrides) : null;
  if (!ov || !field) return null;
  return toNum(ov[field]);
}

/**
 * The §14 undo precondition: does this field's override still hold the value the
 * history entry was recorded against? `expected` null/'' means "no override".
 * Pure.
 */
export function prismaOverrideMatches(draft, field, expected) {
  const exp = expected == null || expected === '' ? null : toNum(expected);
  return prismaOverrideOf(draft, field) === exp;
}

/**
 * setPrismaOverride(draft, field, value, meta) → draft
 *
 * `value` null/'' REVERTS THE FIELD TO AUTOMATIC (the key is deleted — reverting is
 * a deletion, never a repair, because the derived value was never destroyed).
 * A no-op (same value already stored, or a revert of a field that has none) returns
 * the draft UNCHANGED and writes no audit entry.
 *
 * @param {object} meta { auto, nowIso, by, reason, via } — `auto` is the automated
 *   value being displaced (from the counts result), recorded so the audit line can
 *   be read years later without re-deriving anything. `via` marks an undo/redo
 *   application (108.md audit-marker convention); a user action omits it.
 * Pure.
 */
export function setPrismaOverride(draft, field, value, meta = {}) {
  const d = asObj(draft);
  if (!d || !field) return draft;
  const from = prismaOverrideOf(d, field);
  const to = value == null || value === '' ? null : toNum(value);
  if (to == null && value != null && value !== '') return draft;   // unparseable → ignore
  if (from === to) return draft;

  const prev = asObj(d.prismaOverrides) || {};
  const next = { ...prev };
  if (to == null) delete next[field];
  else next[field] = to;

  const entry = {
    field,
    from,
    to,
    auto: meta.auto == null ? null : toNum(meta.auto),
    at: meta.nowIso || null,
  };
  if (meta.by) entry.by = String(meta.by);
  if (meta.reason) entry.reason = String(meta.reason);
  // 108.md — an undo APPENDS an audit row, it never rewrites one, so the marker
  // rides on the new entry. Absent for an ordinary user edit (byte-stability).
  if (meta.via && meta.via !== 'user') entry.via = String(meta.via);

  const log = [...(Array.isArray(d.prismaOverrideLog) ? d.prismaOverrideLog : []), entry]
    .slice(-PRISMA_OVERRIDE_LOG_CAP);

  const out = { ...d, prismaOverrides: next };
  if (log.length) out.prismaOverrideLog = log;
  else delete out.prismaOverrideLog;
  return out;
}

/** Revert one field to live automatic synchronization (§22). Pure. */
export function clearPrismaOverride(draft, field, meta = {}) {
  return setPrismaOverride(draft, field, null, meta);
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

export default {
  computePrismaCounts,
  countsToPrismaShape,
  overrideCoherenceWarnings,
  PRISMA_OVERRIDE_FIELDS,
  PRISMA_OVERRIDE_KEYS,
  PRISMA_OVERRIDE_LOG_CAP,
  prismaOverrideLabel,
  prismaOverrideOf,
  prismaOverrideMatches,
  setPrismaOverride,
  clearPrismaOverride,
};
