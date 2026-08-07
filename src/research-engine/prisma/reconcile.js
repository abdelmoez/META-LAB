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

  // ── the PRISMA 2020 flow identities ───────────────────────────────────────
  // Database arm: identified − removed = screened.
  identity(
    'db_identified_minus_removed',
    'Records identified (databases/registers) − records removed before screening = records screened',
    box('identified_db') - box('removed_before_screening'),
    box('screened'),
    'Every identified record must be either removed before screening or screened.',
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

  // Screening: screened − excluded = sought for retrieval + still awaiting a decision.
  const awaiting = n(f.dispositions && f.dispositions.awaiting_screening && f.dispositions.awaiting_screening.n);
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

  if (n(rb.duplicate && rb.duplicate.n) === 0 && box('identified_db') > 0) {
    issues.push({
      id: 'no_duplicates',
      severity: 'warning',
      message: 'No duplicate records have been removed. Confirm deduplication was run before reporting this flow — "0 duplicates" is a claim, not a default.',
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
