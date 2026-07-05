/**
 * research-engine/progress/projectProgress.js — 75.md Phases 8-9 (Workstream D).
 *
 * THE ONE canonical workflow-progress model. A single pure function that every
 * surface (Overview, Workspace header bar, project rail, dashboard) can read so
 * they can never disagree. Progress is derived from MEANINGFUL persisted evidence
 * (saved PICO, saved criteria, a real search strategy, decided screening records,
 * extracted studies, pooled analysis, a GRADE table, a checked PRISMA list, drafted
 * manuscript sections) — NEVER from route visits or button clicks.
 *
 * Two design rules that fix long-standing convergence bugs:
 *   1. Optional tools (Living Review, Citation Mining, Methods) are NOT part of the
 *      numbered workflow and NEVER enter the denominator.
 *   2. Network Meta-Analysis (`nma`) is a REQUIRED step ONLY when the
 *      `networkMetaAnalysis` feature flag is on. When off it is reported (so a
 *      surface can still show it) but marked `required:false`, so 100% is reachable
 *      without any NMA data — mirroring how the legacy `phase:null` steps are left
 *      out of the map. Previously `nma` had no completion rule at all and `subgroup`
 *      could never reach `done`, which made "All workflow steps complete" and 100%
 *      literally unreachable.
 *
 * PURE + server-safe: imports only pure data/logic (no React, no DOM, no I/O), so
 * the Express controllers can compute `_progress` inline and the client can run the
 * identical model as a fallback. Same (project, evidence, opts) → same output.
 */
import { timeframeComplete } from '../../features/protocol/constants.js';
import { PRISMA_CL } from '../project-model/monolithConstants.js';

/* The real reporting-checklist size (PRISMA 2020, currently 26 items). Deriving it
   from PRISMA_CL keeps the "done" threshold in lock-step with the actual ReportTab
   checkboxes — the source of the historical 20-vs-27 disagreement (stepStatus said
   20, auditProject said 27; neither matched the list). */
export const PRISMA_TOTAL = PRISMA_CL.length;
const PROSPERO_FIELDS_REQUIRED = 15; // matches the legacy stepStatus/prospero rule
const GRADE_DOMAINS_REQUIRED = 5;    // GRADE has 5 downgrade domains
const MANUSCRIPT_SECTIONS_DONE = 3;  // ≥3 filled narrative sections = a real draft

/* The numbered workflow, mirroring TABS.filter(t=>t.phase) in projectHelpers.js.
   Labels are duplicated here (rather than importing projectHelpers, which pulls in
   client-only UI modules) so this module stays server-safe. `nma` is flag-gated. */
const STEP_DEFS = [
  { id: 'pico',        label: 'PICO & Question',        num: 1 },
  { id: 'prospero',    label: 'Protocol',               num: 2 },
  { id: 'search',      label: 'Search',                 num: 3 },
  { id: 'screening',   label: 'Screening',              num: 4 },
  { id: 'prisma',      label: 'PRISMA Flow',            num: 5 },
  { id: 'extraction',  label: 'Data Extraction',        num: 6 },
  { id: 'rob',         label: 'Risk of Bias',           num: 7 },
  { id: 'analysis',    label: 'Meta-Analysis',          num: 8 },
  { id: 'forest',      label: 'Forest Plot',            num: 9 },
  { id: 'sensitivity', label: 'Sensitivity & Bias',     num: 10 },
  { id: 'subgroup',    label: 'Subgroup Analysis',      num: 11 },
  { id: 'nma',         label: 'Network Meta-Analysis',  num: 12, optionalUnlessFlag: 'networkMetaAnalysis' },
  { id: 'grade',       label: 'GRADE Certainty',        num: 13 },
  { id: 'report',      label: 'PRISMA Checklist',       num: 14 },
  { id: 'manuscript',  label: 'Manuscript Draft',       num: 15 },
];

const STATUS_WEIGHT = { done: 1, partial: 0.5, empty: 0 };

const S = (status, reason) => (reason ? { status, reason } : { status });
const nonEmpty = (v) => v != null && String(v).trim() !== '';

/* Studies with a numeric effect size on the analysis scale. */
function countWithES(studies) {
  return studies.filter((s) => s && s.es !== '' && s.es != null && !Number.isNaN(Number(s.es))).length;
}
/* Studies that are actually poolable: a numeric ES AND a CI (lo+hi). This is the
   cheap server-derivable proxy for runMeta being runnable (recon §3), so the model
   needs no heavy statistics engine on the request path. */
function countPoolable(studies) {
  return studies.filter((s) => s
    && s.es !== '' && s.es != null && !Number.isNaN(Number(s.es))
    && s.lo !== '' && s.lo != null && !Number.isNaN(Number(s.lo))
    && s.hi !== '' && s.hi != null && !Number.isNaN(Number(s.hi))).length;
}

/* ── Per-step completion rules ─────────────────────────────────────────────
   Each returns { status, reason? }. Every rule reads only persisted evidence:
   the blob (`p`) plus the server-derived `ev` bag (screening/search/rob counts). */

function picoRule(p) {
  const pico = p.pico || {};
  if (pico.P && pico.I && pico.C && pico.O && timeframeComplete(pico)) return S('done');
  if (pico.P || pico.I || pico.C || pico.O || nonEmpty(pico.question)) return S('partial');
  return S('empty', 'Define Population, Intervention, Comparator, Outcome');
}

function prosperoRule(p) {
  const fields = p.prospero && p.prospero.fields;
  const n = fields ? Object.values(fields).filter(nonEmpty).length : 0;
  if (n >= PROSPERO_FIELDS_REQUIRED) return S('done');
  if (n > 0) return S('partial');
  return S('empty');
}

function searchRule(p, ev) {
  // REAL evidence: the saved search strategy (WorkflowModuleState 'search'). A saved
  // revision with ≥1 concept is a genuine strategy — the meaningful signal, not the
  // stale "≥3 database checkboxes" heuristic. Used verbatim when the server loads it.
  const s = ev && ev.search;
  if (s) {
    if (s.revision > 0 && (s.conceptCount || 0) > 0) return S('done', 'Search strategy saved with concepts');
    if (s.revision > 0 || (s.conceptCount || 0) > 0 || s.readyForScreening) return S('partial');
    return S('empty');
  }
  // Fallback (list path / no module loaded): legacy blob heuristic.
  const search = p.search || {};
  const dbCount = Object.values(search.dbs || {}).filter(Boolean).length;
  const meshResults = p.mesh && p.mesh.results;
  if ((dbCount >= 3 && nonEmpty(search.string)) || meshResults) return S('done');
  if (dbCount > 0 || nonEmpty(search.string)) return S('partial');
  return S('empty');
}

function screeningRule(p, ev) {
  const sc = ev && ev.screening;
  const progressStatus = sc ? sc.progressStatus : (p._linkedMetaSift && p._linkedMetaSift.progressStatus);
  const decided = sc ? (sc.decidedCount || 0) : 0;
  const pool = sc ? (sc.screenablePool || 0) : 0;
  const records = sc ? (sc.recordCount || 0) : 0;
  // Human sign-off wins (leader marks the workspace 'done') — preserved.
  if (progressStatus === 'done') return S('done', 'Screening signed off');
  // Derived completion: every screenable record has a terminal decision.
  if (pool > 0 && decided >= pool) return S('done', 'All screenable records decided');
  if (decided > 0 || records > 0) return S('partial');
  // Legacy blob fallback when there is no linked workspace summary.
  if (p.prisma && nonEmpty(p.prisma.included)) return S('partial');
  return S('empty');
}

function prismaRule(p) {
  const prisma = p.prisma || {};
  if (nonEmpty(prisma.included)) return S('done');
  if (nonEmpty(prisma.dbs) || nonEmpty(prisma.dedupe)) return S('partial');
  return S('empty');
}

function extractionRule(studies, withES) {
  if (studies.length === 0) return S('empty', 'No studies extracted');
  if (withES === studies.length && withES > 0) return S('done');
  return S('partial', `${withES}/${studies.length} studies have an effect size`);
}

function robRule(studies, ev) {
  const total = studies.length;
  let assessed;
  if (ev && ev.rob && typeof ev.rob.assessed === 'number') {
    assessed = ev.rob.assessed; // first-class RobAssessment rows (rob_engine_v2)
  } else {
    assessed = studies.filter((s) => s && s.rob && Object.keys(s.rob).length > 0).length; // legacy blob
  }
  if (total > 0 && assessed >= total) return S('done');
  if (assessed > 0) return S('partial', `${assessed}/${total} studies assessed`);
  return S('empty');
}

function analysisRule(poolable, withES) {
  if (poolable >= 2) return S('done');
  if (poolable === 1 || withES >= 1) return S('partial', 'Needs ≥2 studies with an effect size + CI');
  return S('empty');
}
function forestRule(poolable) {
  return poolable >= 2 ? S('done') : S('empty');
}
function sensitivityRule(poolable) {
  return poolable >= 3 ? S('done') : (poolable >= 2 ? S('partial') : S('empty'));
}
function subgroupRule(poolable) {
  // Sibling-consistent with forest/sensitivity (which auto-complete from the pooled
  // data). ≥4 poolable studies is enough to have meaningfully explored subgroups.
  if (poolable >= 4) return S('done');
  if (poolable >= 2) return S('partial');
  return S('empty');
}
function nmaRule(poolable) {
  // No NMA result is persisted in the blob (the engine is stateless via /api/nma),
  // so completion is a network-feasibility proxy: ≥3 poolable studies can form a
  // network. Only ever counted when the networkMetaAnalysis flag is on.
  if (poolable >= 3) return S('done');
  if (poolable >= 1) return S('partial');
  return S('empty');
}

function gradeRule(p) {
  const n = p.grade ? Object.keys(p.grade).length : 0;
  if (n >= GRADE_DOMAINS_REQUIRED) return S('done');
  if (n > 0) return S('partial');
  return S('empty');
}

function reportRule(p) {
  const n = p.reportChecked ? Object.values(p.reportChecked).filter(Boolean).length : 0;
  if (n >= PRISMA_TOTAL) return S('done');
  if (n > 0) return S('partial', `${n}/${PRISMA_TOTAL} checklist items`);
  return S('empty');
}

function manuscriptRule(p) {
  // 64.md editor persists to data.manuscripts[] (draft.sections[id].content); the
  // legacy AI drafter used data.manuscript.drafts{}. Honour BOTH.
  const list = Array.isArray(p.manuscripts) ? p.manuscripts : [];
  let best = 0;
  for (const d of list) {
    const sections = d && d.sections;
    if (sections && typeof sections === 'object') {
      const filled = Object.values(sections)
        .filter((sec) => sec && typeof sec.content === 'string' && sec.content.trim() !== '').length;
      if (filled > best) best = filled;
    }
  }
  const legacy = p.manuscript && p.manuscript.drafts;
  if (legacy && typeof legacy === 'object') {
    const legacyCount = Object.values(legacy).filter(nonEmpty).length;
    if (legacyCount > best) best = legacyCount;
  }
  if (best >= MANUSCRIPT_SECTIONS_DONE) return S('done');
  if (best >= 1) return S('partial');
  return S('empty');
}

/**
 * computeProjectProgress — THE canonical workflow-progress model.
 *
 * @param {object} project  parsed Project blob (pico, prospero, prisma, search,
 *                          studies[], grade, reportChecked, manuscripts[], …).
 * @param {object} [evidence] server-derived counts NOT in the blob:
 *   - screening?: { decidedCount, screenablePool, recordCount, progressStatus }
 *   - search?:    { revision, conceptCount, searchMode, readyForScreening }
 *   - rob?:       { assessed }   (distinct studyIds with a RobAssessment row)
 *   Any field may be omitted; each rule falls back to the blob.
 * @param {object} [opts]  feature flags. `networkMetaAnalysis:true` makes `nma` a
 *                         required (counted) step.
 * @returns {{ pct:number, steps:Array<{id,label,num,required,status,reason?}>,
 *            requiredDone:number, requiredTotal:number, nextStepId:string|null }}
 */
export function computeProjectProgress(project, evidence = {}, opts = {}) {
  const p = project || {};
  const ev = evidence || {};
  const flags = opts || {};
  const studies = Array.isArray(p.studies) ? p.studies : [];
  const withES = countWithES(studies);
  const poolable = countPoolable(studies);

  const ruleFor = {
    pico:        () => picoRule(p),
    prospero:    () => prosperoRule(p),
    search:      () => searchRule(p, ev),
    screening:   () => screeningRule(p, ev),
    prisma:      () => prismaRule(p),
    extraction:  () => extractionRule(studies, withES),
    rob:         () => robRule(studies, ev),
    analysis:    () => analysisRule(poolable, withES),
    forest:      () => forestRule(poolable),
    sensitivity: () => sensitivityRule(poolable),
    subgroup:    () => subgroupRule(poolable),
    nma:         () => nmaRule(poolable),
    grade:       () => gradeRule(p),
    report:      () => reportRule(p),
    manuscript:  () => manuscriptRule(p),
  };

  const steps = STEP_DEFS.map((def) => {
    const { status, reason } = ruleFor[def.id]();
    const required = def.optionalUnlessFlag ? !!flags[def.optionalUnlessFlag] : true;
    const step = { id: def.id, label: def.label, num: def.num, required, status };
    if (reason) step.reason = reason;
    return step;
  });

  const required = steps.filter((s) => s.required);
  const requiredTotal = required.length;
  const score = required.reduce((n, s) => n + (STATUS_WEIGHT[s.status] || 0), 0);
  const pct = requiredTotal ? Math.round((score / requiredTotal) * 100) : 0;
  const requiredDone = required.filter((s) => s.status === 'done').length;
  const next = required.find((s) => s.status !== 'done');

  return { pct, steps, requiredDone, requiredTotal, nextStepId: next ? next.id : null };
}

export default computeProjectProgress;
