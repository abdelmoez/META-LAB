/**
 * screeningSteps.js — pure status logic for the Screening workflow stepper
 * (prompt21 Task 9). No React/JSX so it stays unit-testable in isolation; the
 * <StepIndicator> component (Stepper.jsx) renders each returned step descriptor
 * beneath its matching Screening submenu tab (prompt22 Task 4).
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

  // `count`: a short, ALWAYS-PRESENT status line shown under each step in the
  // stepper (prompt23 Task 3). Reflects real project data; falls back to a safe
  // "Not started" / "—" rather than a fake number. `hint` is the legacy attention
  // string (kept for back-compat + tests).
  return [
    { id: 'import',        screen: 'import',        label: 'Import',           icon: 'upload',
      status: total > 0 ? 'done' : 'active',
      count: total > 0 ? `${total} record${total === 1 ? '' : 's'}` : 'Not started' },
    { id: 'duplicates',    screen: 'duplicates',    label: 'Duplicates',       icon: 'copy',
      status: total === 0 ? 'pending' : unresolvedDups > 0 ? 'attention' : (dupRun ? 'done' : 'active'),
      hint: unresolvedDups > 0 ? `${unresolvedDups} to resolve` : null,
      count: total === 0 ? '—' : unresolvedDups > 0 ? `${unresolvedDups} unresolved` : (dupRun ? 'Resolved' : 'Pending') },
    { id: 'screening',     screen: 'screening',     label: 'Title & Abstract', icon: 'filter',
      status: taStatus,
      hint: taExact && taPending > 0 ? `${taPending} to screen` : null,
      count: total === 0 ? '—'
        : taExact ? (taPending > 0 ? `${taPending} remaining` : 'Complete')
        : (advanced ? 'Complete' : 'In progress') },
    { id: 'conflicts',     screen: 'conflicts',     label: 'Conflicts',        icon: 'alert',
      status: total === 0 ? 'pending' : conflicts > 0 ? 'attention' : (advanced ? 'done' : 'pending'),
      hint: conflicts > 0 ? `${conflicts} open` : null,
      count: total === 0 ? '—' : conflicts > 0 ? `${conflicts} conflict${conflicts === 1 ? '' : 's'}` : (advanced ? 'Resolved' : 'None') },
    { id: 'second-review', screen: 'second-review', label: 'Final Review',     icon: 'checkSquare',
      status: eligible === 0 && accepted === 0 ? 'pending' : finalRemaining > 0 ? 'active' : 'done',
      hint: finalRemaining > 0 ? `${finalRemaining} pending` : null,
      count: eligible === 0 && accepted === 0 ? '—'
        : finalRemaining > 0 ? `${finalRemaining} pending`
        : (accepted > 0 ? `${accepted} sent` : 'Complete') },
    // Final, status-only step — Data Extraction lives outside the Screening stage.
    { id: 'extraction',    screen: null,            label: 'Data Extraction',  icon: 'download',
      status: accepted > 0 ? 'done' : 'pending',
      hint: accepted > 0 ? `${accepted} sent` : null,
      count: accepted > 0 ? `${accepted} sent` : 'Pending' },
  ];
}
