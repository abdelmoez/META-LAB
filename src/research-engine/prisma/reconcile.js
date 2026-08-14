/**
 * prisma/reconcile.js — 103.md §13. "Never silently display mathematically
 * inconsistent PRISMA numbers."
 *
 * ── WHY THESE CHECKS SHOULD ALL PASS ────────────────────────────────────────
 * With the record-level model, the flow identities are not something the code
 * has to keep true by careful arithmetic — they are true because every record has
 * exactly one disposition and each box is a filter over the same set. So a FAILURE
 * here does not mean "the user typed inconsistent numbers"; it means the derivation
 * itself is wrong, or the projection fed it contradictory record state.
 *
 * That makes these checks far more valuable than the old warnings, which mostly
 * told a researcher to reconcile numbers they had typed by hand. They are now a
 * genuine self-audit, and they are cheap: every check is a comparison of counts
 * already computed.
 *
 * Severity:
 *   'error'   — the flow is internally contradictory. Show it; never publish it.
 *   'warning' — legitimate but worth a look before submission (e.g. nothing has
 *               been screened yet, an unusually large not-retrieved count).
 *   'info'    — reporting guidance, not a defect.
 *
 * Pure — no DOM/React/network/Date.
 */

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * reconcilePrismaFlow(flow) → { ok, issues, checks }
 *
 * `checks` lists every identity that was tested with its two sides, so a debug or
 * admin view can show exactly WHERE a discrepancy comes from (§13) rather than
 * just that one exists.
 * Pure.
 */
export function reconcilePrismaFlow(flow) {
  const f = flow || {};
  const b = f.boxes || {};
  const c = f.counts || {};
  const box = (id) => n(b[id] && b[id].n);

  const checks = [];
  const issues = [];

  /** Assert lhs === rhs, recording the identity either way. */
  const identity = (id, label, lhs, rhs, explain) => {
    const ok = lhs === rhs;
    checks.push({ id, label, lhs, rhs, ok, explain });
    if (!ok) {
      issues.push({
        id,
        severity: 'error',
        message: `${label}: ${lhs} ≠ ${rhs}. ${explain}`,
        lhs,
        rhs,
      });
    }
    return ok;
  };

  // 116.md §13 (r2) — the other-methods arm's pre-retrieval accounting. PRISMA 2020
  // draws no removal/screening box in that column, so derive.js publishes the sets
  // here instead of dropping them; `oa` is that structure (absent on a legacy flow).
  const oa = f.otherArm || null;
  const oaN = (key) => n(oa && oa[key] && oa[key].n);

  // ── the PRISMA 2020 flow identities ───────────────────────────────────────
  // Database arm: identified − removed = screened.
  identity(
    'db_identified_minus_removed',
    'Records identified (databases/registers) − records removed before screening = records screened',
    box('identified_db') - box('removed_before_screening'),
    box('screened'),
    'Every identified record must be either removed before screening or screened.',
  );

  // 116.md §13 (r2) — THE MISSING HALF. Until this check existed, the other arm had
  // no identity at all: a project whose records all came from an unattributed file
  // import could lose every duplicate removal and every title/abstract decision and
  // still reconcile "OK". The identity mirrors the database arm's exactly; the sets
  // are `flow.otherArm` rather than boxes because that column has no boxes to draw.
  if (oa) {
    identity(
      'other_identified_minus_removed',
      'Records identified (other methods) − records removed before screening = records entering screening (other methods)',
      box('identified_other') - oaN('removed'),
      oaN('screened'),
      'An other-methods record is either removed before screening or enters the screening pool, exactly like a database record.',
    );
  }

  // The PROJECT-level statement the manuscript makes ("N records were screened").
  // Column-scoped boxes cannot express it, and scoping it to one column is what let
  // a paper report "0 records were screened" for a project that screened 80.
  identity(
    'project_identified_minus_removed',
    'Records identified (all arms) − records removed before screening (all arms) = records screened (all arms)',
    n(c.identified) - n(c.removedBeforeScreening),
    n(c.screened),
    'Every identified record in either arm is removed before screening or screened; the reported totals must say so.',
  );

  // The removal sub-lines must account for the whole removal box.
  const rb = f.removedBreakdown || {};
  identity(
    'removed_subtotals',
    'Duplicates + automation-ineligible + other = records removed before screening',
    n(rb.duplicate && rb.duplicate.n) + n(rb.automation && rb.automation.n) + n(rb.other && rb.other.n),
    box('removed_before_screening'),
    'The three official sub-lines must partition the removal box exactly.',
  );

  // §3 — the duplicate stage breakdown is a partition of the duplicates, so it
  // can never exceed them. This is the check that makes double-counting visible.
  identity(
    'duplicate_stages',
    'Duplicates removed, summed across stages = duplicates removed',
    (rb.byStage || []).reduce((a, r) => a + n(r.n), 0),
    n(rb.duplicate && rb.duplicate.n),
    'A duplicate removed during search must not be counted again in screening.',
  );

  // 116.md §13 (r2) — every duplicate removal the project performed, wherever it
  // happened, must equal the two arms' duplicate sub-lines plus the never-inserted
  // import discards. This is what stops `counts.duplicatesRemoved` (the manuscript's
  // number) drifting away from `removedBreakdown.duplicate` (the diagram's number).
  identity(
    'duplicates_total',
    'Duplicates removed (project) = database-arm duplicates + other-methods-arm duplicates',
    n(c.duplicatesRemoved),
    n(rb.duplicate && rb.duplicate.n) + n(rb.otherArm && rb.otherArm.duplicate && rb.otherArm.duplicate.n),
    'The reported duplicate total must be the sum of the per-arm duplicate sets, including import-time discards.',
  );

  // Screening: screened − excluded = sought for retrieval + still awaiting a decision.
  // DATABASE ARM only — the boxes in this identity are the drawn, column-scoped ones,
  // so the awaiting count must be column-scoped too (116.md §13 r2: `awaitingScreening`
  // is now the PROJECT total; `awaitingScreeningDb` is the column's share).
  const awaiting = c.awaitingScreeningDb != null ? n(c.awaitingScreeningDb) : n(c.awaitingScreening);
  identity(
    'screened_minus_excluded',
    'Records screened − records excluded − awaiting screening = reports sought for retrieval (databases)',
    box('screened') - box('excluded_screening') - awaiting,
    box('sought_db'),
    'Records that passed title/abstract screening must be sought for retrieval.',
  );

  // Retrieval: sought − not retrieved = assessed. Checked per arm, because the
  // two columns are independent flows.
  identity(
    'retrieval_db',
    'Reports sought − reports not retrieved = reports assessed (databases/registers)',
    box('sought_db') - box('not_retrieved_db'),
    box('assessed_db'),
    'A report that was sought is either retrieved and assessed, or not retrieved.',
  );
  identity(
    'retrieval_other',
    'Reports sought − reports not retrieved = reports assessed (other methods)',
    box('sought_other') - box('not_retrieved_other'),
    box('assessed_other'),
    'A report that was sought is either retrieved and assessed, or not retrieved.',
  );

  // Eligibility: assessed − excluded − still awaiting = included reports.
  const awaitingFt = n(f.dispositions && f.dispositions.awaiting_full_text && f.dispositions.awaiting_full_text.n);
  identity(
    'eligibility',
    'Reports assessed − reports excluded − awaiting assessment = reports of included studies',
    box('assessed_db') + box('assessed_other') - box('excluded_full_text_db')
      - box('excluded_full_text_other') - awaitingFt,
    box('included_reports'),
    'Every assessed report is included, excluded, or still under assessment.',
  );

  /* ══ 116.md §13 (r2) — DISPOSITION COVERAGE ═══════════════════════════════
   *
   * The identities above all compare boxes with boxes. That is exactly how the
   * §13 regression stayed silent: when an entire arm's screening work was dropped,
   * every box-to-box identity still balanced (0 − 0 = 0) while
   * `dispositions.excluded_screening.n` said 50. The dispositions are the ground
   * truth — exhaustive and disjoint by construction (model.js) — so the real
   * question is whether the reported sets ACCOUNT FOR every record, and nothing
   * asked it.
   *
   * These checks ask it. A record whose disposition is not represented anywhere in
   * the flow's reported sets is an ERROR: reconciliation.ok goes false rather than
   * a paper reporting numbers that leave 70 identified records nowhere.
   */
  const disp = f.dispositions || {};
  const dispN = (k) => n(disp[k] && disp[k].n);
  // The removal box carries the never-inserted import discards, which have no
  // disposition (no record exists), so they come off both sides.
  const phantomDb = n(c.unrecordedDuplicatesDb != null ? c.unrecordedDuplicatesDb : c.unrecordedDuplicates);
  const phantomOther = n(c.unrecordedDuplicatesOther);

  identity(
    'dispositions_removed_covered',
    'Records removed before screening (dispositions) = the removal sets both arms report',
    dispN('removed_duplicate') + dispN('removed_automation') + dispN('removed_other'),
    (box('removed_before_screening') - phantomDb) + (oa ? oaN('removed') - phantomOther : 0),
    'Every record removed before screening must appear in a removal set — the database arm’s box or the other arm’s reported removals.',
  );
  identity(
    'dispositions_excluded_screening_covered',
    'Records excluded at title/abstract (dispositions) = the excluded-at-screening sets both arms report',
    dispN('excluded_screening'),
    box('excluded_screening') + (oa ? oaN('excludedScreening') : 0),
    'A title/abstract exclusion must be reported by whichever arm the record belongs to, never dropped because its column has no box.',
  );
  identity(
    'dispositions_awaiting_screening_covered',
    'Records awaiting title/abstract screening (dispositions) = the awaiting sets both arms report',
    dispN('awaiting_screening'),
    awaiting + (oa ? oaN('awaitingScreening') : 0),
    'A record still awaiting a screening decision must be counted in exactly one arm.',
  );
  identity(
    'dispositions_not_retrieved_covered',
    'Reports not retrieved (dispositions) = the two not-retrieved boxes',
    dispN('not_retrieved'),
    box('not_retrieved_db') + box('not_retrieved_other'),
    'Every not-retrieved report is drawn in one of the two columns.',
  );
  identity(
    'dispositions_excluded_full_text_covered',
    'Reports excluded at full text (dispositions) = the two full-text exclusion boxes',
    dispN('excluded_full_text'),
    box('excluded_full_text_db') + box('excluded_full_text_other'),
    'Every full-text exclusion is drawn in one of the two columns.',
  );
  identity(
    'dispositions_included_covered',
    'Included records (dispositions) = reports of included studies',
    dispN('included'),
    box('included_reports'),
    'Every included record is a report of an included study.',
  );

  /* Id-level membership — the same question asked of the actual SETS rather than
   * their sizes, so two wrong numbers that happen to agree cannot pass. Skipped on
   * a SLIM flow (116.md §11 strips id arrays for the wire); the authoritative
   * reconciliation is computed server-side on the full flow before slimming. */
  const idsOf = (o) => (o && Array.isArray(o.ids) ? o.ids : null);
  const dispIdsAvailable = Object.keys(disp).every((k) => idsOf(disp[k]));
  if (dispIdsAvailable && Object.keys(disp).length) {
    const union = (...sets) => {
      const out = new Set();
      for (const s of sets) for (const id of (s || [])) out.add(id);
      return out;
    };
    const home = {
      removed_duplicate: union(idsOf(b.removed_before_screening), oa && idsOf(oa.removed)),
      removed_automation: union(idsOf(b.removed_before_screening), oa && idsOf(oa.removed)),
      removed_other: union(idsOf(b.removed_before_screening), oa && idsOf(oa.removed)),
      excluded_screening: union(idsOf(b.excluded_screening), oa && idsOf(oa.excludedScreening)),
      awaiting_screening: union(idsOf(b.screened), oa && idsOf(oa.awaitingScreening)),
      not_retrieved: union(idsOf(b.not_retrieved_db), idsOf(b.not_retrieved_other)),
      excluded_full_text: union(idsOf(b.excluded_full_text_db), idsOf(b.excluded_full_text_other)),
      awaiting_full_text: union(idsOf(b.assessed_db), idsOf(b.assessed_other)),
      included: union(idsOf(b.included_reports)),
    };
    const orphans = [];
    for (const [k, bucketOfDisp] of Object.entries(disp)) {
      const want = home[k];
      if (!want) continue;
      for (const id of idsOf(bucketOfDisp) || []) {
        if (!want.has(id)) orphans.push({ id, disposition: k });
        if (orphans.length >= 25) break;
      }
      if (orphans.length >= 25) break;
    }
    const ok = orphans.length === 0;
    checks.push({
      id: 'disposition_box_membership',
      label: 'Every record appears in a reported set matching its disposition',
      lhs: orphans.length,
      rhs: 0,
      ok,
      explain: 'A record that belongs to no reported set is invisible to the diagram and to the manuscript.',
    });
    if (!ok) {
      issues.push({
        id: 'disposition_box_membership',
        severity: 'error',
        message: `${orphans.length} record(s) belong to no reported set for their disposition (e.g. ${orphans.slice(0, 3).map((o) => `${o.id} → ${o.disposition}`).join(', ')}). The flow is reporting fewer records than it holds.`,
        lhs: orphans.length,
        rhs: 0,
      });
    }
  }

  // §9 — a study is reported by at least one report, so studies can never exceed
  // reports. This is the check that catches a broken report→study link.
  const studies = box('included_studies');
  const reports = box('included_reports');
  if (studies > reports) {
    issues.push({
      id: 'studies_exceed_reports',
      severity: 'error',
      message: `Included studies (${studies}) exceeds reports of included studies (${reports}) — every study needs at least one report.`,
      lhs: studies,
      rhs: reports,
    });
  }
  checks.push({
    id: 'studies_le_reports',
    label: 'Studies included ≤ reports of included studies',
    lhs: studies,
    rhs: reports,
    ok: studies <= reports,
    explain: 'Several reports may describe one study, never the reverse.',
  });

  // Meta-analysis is a subset of the review.
  if (n(c.includedQuant) > studies) {
    issues.push({
      id: 'quant_exceeds_included',
      severity: 'error',
      message: `More studies in the meta-analysis (${n(c.includedQuant)}) than included in the review (${studies}).`,
      lhs: n(c.includedQuant),
      rhs: studies,
    });
  }

  // No box can be negative — impossible by construction, so if it happens the
  // projection contradicted itself and we want to know loudly.
  for (const [id, v] of Object.entries(b)) {
    if (n(v && v.n) < 0) {
      issues.push({ id: `negative_${id}`, severity: 'error', message: `Box "${id}" is negative (${v.n}).`, lhs: v.n, rhs: 0 });
    }
  }

  // ── advisory, not defects ─────────────────────────────────────────────────
  if (box('identified_db') === 0 && box('identified_other') === 0) {
    issues.push({
      id: 'no_records',
      severity: 'info',
      message: 'No records have been identified yet — the flow will populate as searches run and results are imported.',
    });
  } else if (box('screened') > 0 && awaiting === box('screened')) {
    issues.push({
      id: 'screening_not_started',
      severity: 'info',
      message: 'No title/abstract decisions have been recorded yet.',
    });
  }

  // 116.md §13 (r2) — gated on the PROJECT's duplicate total and the PROJECT's
  // identified total. Gating on the database column meant an all-other-arm project
  // (the population §13 created) skipped even this advisory.
  if (n(c.duplicatesRemoved) === 0 && (box('identified_db') + box('identified_other')) > 0) {
    issues.push({
      id: 'no_duplicates',
      severity: 'warning',
      message: 'No duplicate records have been removed. Confirm deduplication was run before reporting this flow — "0 duplicates" is a claim, not a default.',
    });
  }

  // 116.md §13 (r2) — a column reporting records that no stored record and no named
  // source backs. Reachable only when a batch's import-time discards are the sole
  // contents of a column (every record was a duplicate), so it is reported rather
  // than treated as a contradiction: the count is honest, but the figure will draw a
  // placeholder source line, and a reader deserves to be told why.
  const unbacked = (boxId, sourceKey, label) => {
    const bx = b[boxId];
    const ids = bx && Array.isArray(bx.ids) ? bx.ids : null;
    const srcs = (f.sources && f.sources[sourceKey]) || [];
    if (n(bx && bx.n) > 0 && ids && ids.length === 0 && srcs.length === 0) {
      issues.push({
        id: `unbacked_${boxId}`,
        severity: 'warning',
        message: `${label} reports ${n(bx.n)} record(s), but no stored record and no named source backs them — they are import-time duplicates counted from batch accounting alone. Name the batch's database (Import history → search details) so the figure can label them.`,
        lhs: n(bx.n),
        rhs: 0,
      });
    }
  };
  unbacked('identified_db', 'db', 'The databases-and-registers column');
  unbacked('identified_other', 'other', 'The other-methods column');

  // 116.md §13 (r2) — PRISMA 2020 gives the other-methods column no removal box, so
  // removals there can be REPORTED but never DRAWN. Say so rather than letting a
  // reader wonder why the column's identification count does not flow onward.
  const otherRemoved = oa ? oaN('removed') : 0;
  if (otherRemoved > 0) {
    issues.push({
      id: 'other_arm_removals_not_drawn',
      severity: 'info',
      message: `${otherRemoved} record(s) identified through other methods were removed before screening (duplicates or documented removals). PRISMA 2020 draws no "records removed" box in that column, so the figure cannot show them — report them in the text; the inspector lists them.`,
      lhs: otherRemoved,
      rhs: 0,
    });
  }
  const otherScreeningWork = oa ? oaN('excludedScreening') : 0;
  if (otherScreeningWork > 0) {
    issues.push({
      id: 'other_arm_screening_not_drawn',
      severity: 'info',
      message: `${otherScreeningWork} record(s) identified through other methods were excluded at title/abstract screening. PRISMA 2020 gives that column no screening box, so these are included in the reported project totals ("records screened", "records excluded") but cannot be drawn in the figure.`,
      lhs: otherScreeningWork,
      rhs: 0,
    });
  }

  const notRetrieved = box('not_retrieved_db') + box('not_retrieved_other');
  const sought = box('sought_db') + box('sought_other');
  if (sought > 0 && notRetrieved / sought > 0.2) {
    issues.push({
      id: 'high_not_retrieved',
      severity: 'warning',
      message: `${notRetrieved} of ${sought} reports could not be retrieved (${Math.round((notRetrieved / sought) * 100)}%). A high non-retrieval rate should be discussed as a limitation.`,
    });
  }

  // §8 — reasons should account for the exclusions they explain.
  const reasonTotal = (f.exclusionReasons || []).reduce((a, r) => a + n(r.n), 0);
  const excludedFt = box('excluded_full_text_db') + box('excluded_full_text_other');
  if (excludedFt > 0 && reasonTotal !== excludedFt) {
    issues.push({
      id: 'exclusion_reasons_incomplete',
      severity: 'warning',
      message: `Full-text exclusion reasons account for ${reasonTotal} of ${excludedFt} excluded reports. PRISMA 2020 asks for a reason against every exclusion.`,
      lhs: reasonTotal,
      rhs: excludedFt,
    });
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return {
    ok: errors.length === 0,
    errorCount: errors.length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    issues,
    checks,
  };
}

export default { reconcilePrismaFlow };
