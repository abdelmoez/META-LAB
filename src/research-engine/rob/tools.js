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
  {
    id: 'NOS',
    label: 'Newcastle–Ottawa',
    sublabel: 'Observational (cohort / case-control)',
    status: 'coming-soon',
    description: 'Newcastle–Ottawa Scale star system. Planned.',
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
