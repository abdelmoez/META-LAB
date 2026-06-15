/**
 * screeningSteps.js — pure status logic for the Screening workflow stepper
 * (prompt21 Task 9). No React/JSX so it stays unit-testable in isolation; the
 * <Stepper> component (Stepper.jsx) renders the returned step descriptors.
 *
 * Derives each step's status from the Screening overview `dataSummary`. It is
 * deliberately CONSERVATIVE — it never invents progress and surfaces 'attention'
 * for unresolved duplicates/conflicts.
 *
 * Limitation (documented in docs/manager/screening-stepper-integration.md): there
 * is no single project-wide "title/abstract fully screened" / "final review
 * complete" count exposed to every member, so those are derived from records
 * advancing to full text (eligibleSecondReview) and the decided count
 * (acceptedToExtraction + rejectedSecond).
 *
 * Status values: 'done' | 'active' | 'attention' | 'pending'.
 */
export function buildScreeningSteps(summary) {
  const s = summary || {};
  const total          = s.totalArticles || 0;
  const dupRun         = !!s.duplicateDetectionRun;
  const unresolvedDups = s.unresolvedDuplicateGroups || 0;
  const eligible       = s.eligibleSecondReview || 0;   // records at full-text stage
  const accepted       = s.acceptedToExtraction || 0;   // finalStatus accepted (in extraction)
  const rejected       = s.rejectedSecond || 0;
  const conflicts      = s.unresolvedConflicts || 0;
  const decided        = accepted + rejected;
  const finalRemaining = Math.max(0, eligible - decided);
  const advanced       = eligible > 0 || decided > 0;
  // Exact, member-visible title/abstract progress when the overview exposes it
  // (prompt21 follow-up); falls back to the coarse "advanced" heuristic otherwise.
  const taExact   = typeof s.titleAbstractPending === 'number';
  const taPending = s.titleAbstractPending || 0;
  const taStatus  = total === 0 ? 'pending'
    : taExact ? (taPending === 0 ? 'done' : 'active')
    : (advanced ? 'done' : 'active');

  return [
    { id: 'import',        screen: 'import',        label: 'Import',           icon: 'upload',
      status: total > 0 ? 'done' : 'active' },
    { id: 'duplicates',    screen: 'duplicates',    label: 'Duplicates',       icon: 'copy',
      status: total === 0 ? 'pending' : unresolvedDups > 0 ? 'attention' : (dupRun ? 'done' : 'active'),
      hint: unresolvedDups > 0 ? `${unresolvedDups} to resolve` : null },
    { id: 'screening',     screen: 'screening',     label: 'Title & Abstract', icon: 'filter',
      status: taStatus,
      hint: taExact && taPending > 0 ? `${taPending} to screen` : null },
    { id: 'conflicts',     screen: 'conflicts',     label: 'Conflicts',        icon: 'alert',
      status: total === 0 ? 'pending' : conflicts > 0 ? 'attention' : (advanced ? 'done' : 'pending'),
      hint: conflicts > 0 ? `${conflicts} open` : null },
    { id: 'second-review', screen: 'second-review', label: 'Final Review',     icon: 'checkSquare',
      status: eligible === 0 && accepted === 0 ? 'pending' : finalRemaining > 0 ? 'active' : 'done',
      hint: finalRemaining > 0 ? `${finalRemaining} pending` : null },
    // Final, status-only step — Data Extraction lives outside the Screening stage.
    { id: 'extraction',    screen: null,            label: 'Data Extraction',  icon: 'download',
      status: accepted > 0 ? 'done' : 'pending',
      hint: accepted > 0 ? `${accepted} sent` : null },
  ];
}
