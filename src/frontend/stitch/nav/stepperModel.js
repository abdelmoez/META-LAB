/**
 * stepperModel.js — pure, shared step model for the white-submenu vertical
 * workflow steppers (57.md §5/§7). No React/DOM → unit-testable.
 *
 * ONE function turns a project category's submenu (from the centralized
 * `submenuForCategory` contract) into an ordered list of normalized step
 * descriptors that the shared <StitchWorkflowStepper> renders identically for
 * Plan & Protocol, Search, Screen, Extract, Analyze and Report:
 *
 *   { key, label, icon, href, num, status, count, desc, disabled }
 *
 * - `num` is the 1-based WORKFLOW step number (null for utility rows like the
 *   Screen category's Overview / Settings / Export / PRISMA, which are not steps).
 * - `status` uses the shared navStatus vocabulary ('done' | 'partial' | 'empty' |
 *   'attention'); the Screen category maps the live screeningSteps vocabulary onto
 *   it and carries a live `count` ("312 unresolved", "1,796 remaining").
 * - `disabled` mirrors an unavailable destination (e.g. screening sub-pages with no
 *   linked workspace) so the stepper shows them disabled with an explanation.
 */
import { submenuForCategory, PROJECT_CATEGORIES } from './navConfig.js';

const CATEGORY_BY_ID = PROJECT_CATEGORIES.reduce((m, c) => { m[c.id] = c; return m; }, {});

// Screening stepper status vocabulary → the shared navStatus vocabulary.
const SCREEN_TO_NAV = { done: 'done', active: 'partial', attention: 'attention', pending: 'empty' };

// Brief, optional helper text per workflow stage (single line; shown muted).
const STEP_DESC = {
  pico: 'Population, intervention, comparator, outcome',
  prospero: 'Register the review protocol',
  search: 'Build and run your multi-database search',
  living: 'Schedule search updates & track evidence shifts',
  citation: 'Mine references & chase citations',
  extraction: 'Extract study + outcome data',
  rob: 'Assess risk of bias per study',
  analysis: 'Pool effect sizes (meta-analysis)',
  forest: 'Plot the pooled forest',
  sensitivity: 'Sensitivity & publication bias',
  subgroup: 'Compare pre-specified subgroups',
  nma: 'Network meta-analysis',
  grade: 'Rate certainty of evidence',
  report: 'Complete the PRISMA checklist',
  manuscript: 'Draft the manuscript',
};

/**
 * Build the ordered step descriptors for a category's white submenu, or null when
 * the category has no submenu. ctx = { projectId, linkedSiftId }.
 * opts = { statusMap, screeningSteps } (screeningSteps from buildScreeningSteps()).
 */
export function submenuSteps(category, ctx = {}, opts = {}) {
  const items = submenuForCategory(category, ctx);
  if (!items) return null;
  const cat = CATEGORY_BY_ID[category];
  const { statusMap = {}, screeningSteps = null } = opts;

  if (cat && cat.kind === 'screen') {
    const stepById = {};
    for (const s of (screeningSteps || [])) stepById[s.id] = s;
    let n = 0;
    return items.map((it) => {
      const sc = it.completionKey ? stepById[it.completionKey] : null;
      const isStep = !!sc;
      if (isStep) n += 1;
      return {
        key: it.key, label: it.label, icon: it.icon, href: it.href,
        num: isStep ? n : null,
        status: sc ? (SCREEN_TO_NAV[sc.status] || 'empty') : null,
        count: sc ? (sc.count || null) : null,
        desc: null,
        disabled: !it.href,
      };
    });
  }

  // Phase categories (Plan, Search, Extract, Analyze, Report): every submenu item
  // is a numbered workflow step; status comes from the legacy stepStatus() truth.
  return items.map((it, i) => ({
    key: it.key, label: it.label, icon: it.icon, href: it.href,
    num: i + 1,
    status: statusMap[it.completionKey] || 'empty',
    count: null,
    desc: STEP_DESC[it.completionKey] || null,
    disabled: !it.href,
  }));
}
