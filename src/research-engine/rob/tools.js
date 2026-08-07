/**
 * tools.js — the catalogue of Risk-of-Bias instruments a project can choose
 * (prompt28 Part 4). Pure data + helpers; no UI, no engine logic.
 *
 * Only RoB 2 is IMPLEMENTED today, so it is the single `active` tool. The others
 * are advertised as `coming-soon` (disabled in the UI) for future-proofing — the
 * selection is stored per META·LAB project (`project.robTool`) so each project
 * remembers its choice, but an unsupported tool can never actually be used:
 * `normalizeRobTool` collapses anything non-active back to the default.
 */

export const ROB_TOOLS = Object.freeze([
  {
    id: 'RoB2',
    label: 'RoB 2',
    sublabel: 'Randomised trials',
    status: 'active',
    description: 'Cochrane Risk of Bias 2 — effect of assignment (ITT). Five domains, signalling questions, algorithm-proposed judgements.',
  },
  {
    id: 'ROBINS-I',
    label: 'ROBINS-I',
    sublabel: 'Non-randomised studies of interventions',
    status: 'active',
    description: 'Risk Of Bias In Non-randomised Studies of Interventions (Sterne 2016). Seven domains, signalling questions, algorithm-proposed five-level judgements (Low / Moderate / Serious / Critical / No information).',
  },
  {
    id: 'QUADAS-2',
    label: 'QUADAS-2',
    sublabel: 'Diagnostic accuracy studies',
    status: 'coming-soon',
    description: 'Quality Assessment of Diagnostic Accuracy Studies, v2. Planned.',
  },
  // 101.md §18–§22 — the two OFFICIAL Newcastle–Ottawa forms are separate
  // instruments, because their domains genuinely differ (Outcome vs Exposure) and
  // §19/§20 require the workflow to be designed per study type. `scoring: 'stars'`
  // tells the UI to render a star profile rather than a traffic light (§26).
  {
    id: 'NOS',
    label: 'Newcastle–Ottawa (cohort)',
    sublabel: 'Observational cohort studies',
    status: 'active',
    scoring: 'stars',
    design: 'cohort',
    description: 'Newcastle–Ottawa Scale, official OHRI cohort form. Selection (4) + Comparability (2) + Outcome (3) = 9 stars. The scale defines no quality threshold; any cut-off is a project decision.',
  },
  {
    id: 'NOS-CC',
    label: 'Newcastle–Ottawa (case-control)',
    sublabel: 'Observational case-control studies',
    status: 'active',
    scoring: 'stars',
    design: 'case-control',
    description: 'Newcastle–Ottawa Scale, official OHRI case-control form. Selection (4) + Comparability (2) + Exposure (3) = 9 stars. The scale defines no quality threshold; any cut-off is a project decision.',
  },
  {
    id: 'custom',
    label: 'Custom template',
    sublabel: 'Define your own domains',
    status: 'coming-soon',
    description: 'Build a bespoke risk-of-bias instrument. Planned.',
  },
]);

export const DEFAULT_ROB_TOOL = 'RoB2';

/** The set of tool ids that are actually implemented/selectable right now. */
export const ACTIVE_ROB_TOOLS = Object.freeze(
  ROB_TOOLS.filter(t => t.status === 'active').map(t => t.id),
);

/** Look up a tool descriptor by id (or undefined). */
export function getRobTool(id) {
  return ROB_TOOLS.find(t => t.id === id);
}

/** True only for an implemented/selectable tool. */
export function isRobToolActive(id) {
  return ACTIVE_ROB_TOOLS.includes(id);
}

/**
 * Coerce any stored/selected value to a SAFE, selectable tool id. Unknown, empty,
 * or coming-soon tools collapse to the default so an unsupported instrument can
 * never be used by accident.
 * @param {string} id
 * @returns {string}
 */
export function normalizeRobTool(id) {
  return isRobToolActive(id) ? id : DEFAULT_ROB_TOOL;
}

/** True when the tool is star-scored (NOS) rather than judgement-based. */
export function isStarScoredTool(id) {
  const t = getRobTool(id);
  return !!(t && t.scoring === 'stars');
}

/**
 * 101.md §18/§19/§20 — which instrument suits a study design. Returns the ACTIVE
 * tool ids appropriate for a design, most-appropriate first, or [] when we have
 * nothing suitable (never a misleading fallback).
 *
 * Design strings are matched loosely because they arrive from extraction free
 * text ("prospective cohort study", "nested case-control").
 */
export function toolsForStudyDesign(design) {
  const d = String(design || '').toLowerCase();
  if (!d) return [];
  // Case-control must be tested BEFORE cohort: "nested case-control study within
  // a cohort" is a case-control design, and a cohort-first test would misroute it.
  if (/case[\s-]?control/.test(d)) return ['NOS-CC'];
  if (/cohort|longitudinal|prospective|retrospective/.test(d)) return ['NOS'];
  if (/randomi[sz]ed|\brct\b|\btrial\b/.test(d)) return ['RoB2'];
  if (/non[\s-]?randomi[sz]ed|quasi[\s-]?experimental|before[\s-]?after|interrupted time/.test(d)) return ['ROBINS-I'];
  return [];
}

/** The NOS form (cohort vs case-control) implied by a study design, or ''. */
export function nosVariantForDesign(design) {
  const t = toolsForStudyDesign(design)[0];
  if (t === 'NOS') return 'cohort';
  if (t === 'NOS-CC') return 'case-control';
  return '';
}
