/**
 * rob/usage.js — 101.md §27/§28. Which risk-of-bias instruments a project ACTUALLY
 * used, derived from its completed assessments.
 *
 * The distinction this module exists to enforce: `project.robMethod` records the
 * instrument a user SELECTED in a settings panel. That is not evidence that any
 * assessment was performed with it. §27 is explicit — "Do not insert the statement
 * merely because NOS exists as an available option. Only include it if it was
 * actually used." So the manuscript reads THIS, never the setting.
 *
 * It also handles the multi-tool case §27 asks for: a review that used RoB 2 for
 * its trials, ROBINS-I for its non-randomised intervention studies and the
 * Newcastle–Ottawa Scale for its cohort studies should say exactly that, with the
 * designs each tool covered — not collapse them into one claim.
 *
 * Pure — no DOM/React/network/Date.
 */

import { getRobTool, isStarScoredTool } from './tools.js';

/** An assessment counts as "used" only once it is finished, not while in draft. */
const COMPLETED_STATUSES = new Set(['complete', 'consensus']);

/** Human design labels for the Methods sentence, keyed by instrument id. */
const DESIGN_LABEL = Object.freeze({
  RoB2: 'randomised trials',
  'ROBINS-I': 'non-randomised studies of interventions',
  NOS: 'cohort studies',
  'NOS-CC': 'case-control studies',
  'QUADAS-2': 'diagnostic accuracy studies',
});

/** Manuscript-ready instrument names (full, citable wording). */
const TOOL_PHRASE = Object.freeze({
  RoB2: 'the Cochrane risk-of-bias tool for randomized trials (RoB 2)',
  'ROBINS-I': 'the ROBINS-I tool',
  NOS: 'the Newcastle–Ottawa Scale',
  'NOS-CC': 'the Newcastle–Ottawa Scale',
  'QUADAS-2': 'QUADAS-2',
});

/**
 * deriveRobUsage(assessments, opts) — the honest usage summary.
 *
 * @param {Array} assessments  [{ instrumentId, variant, status, studyId, reviewerId }]
 *   Typically the project's RobAssessment rows. Rows that are soft-deleted should
 *   already be filtered out by the caller.
 * @param {object} [opts]
 *   countDrafts  include 'draft' assessments too (default false — a draft is not
 *                evidence that the study was assessed)
 * @returns {{
 *   tools: Array<{ id, label, designLabel, scoring, count, studyIds:string[] }>,
 *   assessedCount: number,   // DISTINCT studies with at least one completed assessment
 *   toolIds: string[],
 *   multiTool: boolean,
 *   any: boolean,
 * }}
 * Both NOS forms are reported as ONE tool ("the Newcastle–Ottawa Scale") because
 * that is how a methods section names it, but their design labels are merged so the
 * sentence can still say which designs it covered.
 * Pure.
 */
export function deriveRobUsage(assessments, opts = {}) {
  const list = Array.isArray(assessments) ? assessments : [];
  const keep = list.filter((a) => a && a.instrumentId
    && (opts.countDrafts ? true : COMPLETED_STATUSES.has(String(a.status || ''))));

  // Group by the PHRASE, so NOS + NOS-CC collapse into one named instrument.
  const byPhrase = new Map();
  const assessedStudies = new Set();

  for (const a of keep) {
    const id = String(a.instrumentId);
    const phrase = TOOL_PHRASE[id] || (getRobTool(id) && getRobTool(id).label) || id;
    if (!byPhrase.has(phrase)) {
      byPhrase.set(phrase, {
        id, label: phrase, designs: new Set(), scoring: isStarScoredTool(id) ? 'stars' : 'judgement',
        studyIds: new Set(), ids: new Set(),
      });
    }
    const g = byPhrase.get(phrase);
    g.ids.add(id);
    const design = DESIGN_LABEL[id] || '';
    if (design) g.designs.add(design);
    if (a.studyId) { g.studyIds.add(String(a.studyId)); assessedStudies.add(String(a.studyId)); }
  }

  const tools = Array.from(byPhrase.values()).map((g) => ({
    id: g.ids.size === 1 ? g.id : Array.from(g.ids).sort().join('+'),
    label: g.label,
    designLabel: joinDesigns(Array.from(g.designs)),
    scoring: g.scoring,
    // Count DISTINCT studies, not assessment rows — two reviewers assessing the
    // same study is one study assessed, not two (101.md §25).
    count: g.studyIds.size,
    studyIds: Array.from(g.studyIds).sort(),
  }))
    .filter((t) => t.count > 0)
    .sort((a, b) => (b.count - a.count) || (a.label < b.label ? -1 : 1));

  return {
    tools,
    assessedCount: assessedStudies.size,
    toolIds: tools.map((t) => t.id),
    multiTool: tools.length > 1,
    any: tools.length > 0,
  };
}

/** "cohort studies and case-control studies" → grammatical join. Pure. */
function joinDesigns(designs) {
  const xs = (designs || []).filter(Boolean);
  if (!xs.length) return '';
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
}

/**
 * The manuscript sentence fragment naming the tools actually used, or '' when
 * none were. Kept here (rather than in the Methods template) so the Methods
 * paragraph, the Abstract and the `rob.tools` fact token cannot disagree.
 * Pure.
 */
export function robToolsPhrase(usage) {
  const tools = (usage && usage.tools) || [];
  if (!tools.length) return '';
  const parts = tools.map((t) => (t.designLabel ? `${t.label} for ${t.designLabel}` : t.label));
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export default { deriveRobUsage, robToolsPhrase };
