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
  // revision with ≥1 LIVE concept group is a genuine strategy — the meaningful
  // signal, not the stale "≥3 database checkboxes" heuristic. Used verbatim when the
  // server loads it. `conceptCount` counts LIVE groups only (see JSDoc + 98.md §6).
  const s = ev && ev.search;
  if (s) {
    const liveConcepts = s.conceptCount || 0;
    if (s.revision > 0 && liveConcepts > 0) return S('done', 'Search strategy saved with concepts');
    // 98.md §6 — a bare revision is NOT progress: the workspace's no-user-action
    // seed save already writes revision 1 with zero content. Partial requires
    // actual content (a live concept group) or the explicit screening hand-off.
    if (s.revision > 0 && (liveConcepts > 0 || s.readyForScreening)) return S('partial');
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

/* 98.md §14 Defect 5 — "0" is not completion evidence. The PRISMA auto-fill writes
   String(count) fields — a "0" from an empty screening workspace used to satisfy
   nonEmpty and flip prisma 'done'. A numeric value must be POSITIVE; non-numeric
   non-empty legacy strings (e.g. "12 (3 RCTs)", "n/a") keep the old nonEmpty
   behaviour for back-compat with hand-typed blobs. */
function positiveOrLegacyCount(v) {
  if (!nonEmpty(v)) return false;
  const n = Number(v);
  return Number.isNaN(n) ? true : n > 0;
}

/* 98.md §14 Defect 2b — resolve the screening evidence bag. The server-derived
   `ev.screening` wins; on the client-side recompute (no server evidence, e.g. after
   an optimistic edit dropped `_progress` — Defect 6) the SAME shape is rebuilt from
   the transient `_linkedMetaSift` annotation so both paths judge the same counts. */
function screeningEvidenceBag(p, ev) {
  if (ev && ev.screening) return ev.screening;
  const lm = p._linkedMetaSift;
  if (!lm) return null;
  const bag = {
    decidedCount: lm.decidedCount,
    screenablePool: lm.screenablePool,
    recordCount: lm.recordCount,
    progressStatus: lm.progressStatus,
  };
  if (lm.pending && typeof lm.pending === 'object') bag.pending = lm.pending;
  if (typeof lm.complete === 'boolean') bag.complete = lm.complete;
  return bag;
}

/* 98.md §14 — the optional screening substate, emitted as an ADDITIVE `detail`
   field on the screening step ('not_started' | 'in_progress' |
   'awaiting_second_review' | 'conflicts_remaining' | 'completed') so the Overview
   can label the real substep. Consumers that ignore it see the unchanged
   status/reason contract. Purely derived from the same evidence as the status. */
function screeningDetail(sc, status) {
  if (status === 'done') return 'completed';
  if (status === 'empty') return 'not_started';
  const pending = (sc && sc.pending) || {};
  if ((pending.unresolvedConflicts || 0) > 0) return 'conflicts_remaining';
  // Title/abstract KNOWN finished (count present and zero) with full-text work
  // outstanding = the between-stages wait. Only computable on the detail path,
  // where the quorum-aware count travels.
  if (pending.titleAbstractPending === 0 && (pending.secondReviewPending || 0) > 0) return 'awaiting_second_review';
  return 'in_progress';
}

function screeningRule(p, ev) {
  const sc = screeningEvidenceBag(p, ev);
  // Legacy blob fallback when there is no linked workspace summary at all
  // (98.md §14 scenario: migrated legacy project). "0" is not evidence (Defect 5).
  if (!sc) {
    if (p.prisma && positiveOrLegacyCount(p.prisma.included)) return { ...S('partial'), detail: 'in_progress' };
    return { ...S('empty'), detail: 'not_started' };
  }
  const decided = sc.decidedCount || 0;
  const pool = sc.screenablePool || 0;
  const records = sc.recordCount || 0;
  // Substep counts (98.md §14 Defect 2b). The detail GET carries the FULL bag plus
  // the server-computed `complete` (isScreeningWorkComplete over quorum-aware
  // counts); the list GET carries only the cheaply-batched counts (conflicts +
  // duplicate groups) and NO `complete` — see projectsController.listProjects.
  const pending = (sc.pending && typeof sc.pending === 'object') ? sc.pending : {};
  const pendingWork = Object.values(pending).some((n) => Number.isFinite(n) && n > 0);
  // Server-computed completeness is authoritative when present; otherwise the
  // decided/pool heuristic. decidedCount is isDuplicate-filtered server-side
  // (Defect 2a), so records swept into duplicate groups AFTER being finalized can
  // no longer fake `decided >= pool` while live records sit unscreened.
  const evidenceComplete = typeof sc.complete === 'boolean'
    ? sc.complete
    : (pool > 0 && decided >= pool && !pendingWork);
  const withDetail = (res) => ({ ...res, detail: screeningDetail(sc, res.status) });

  if (sc.progressStatus === 'done') {
    // 98.md §14 Defect 1 — human sign-off stays meaningful but must be CORROBORATED:
    // affirmative counter-evidence (zero records, pending substeps, or the server's
    // complete:false) downgrades the report to partial — the canonical progress
    // must not lie even though the write itself is accepted (leader freedom).
    // NOTE `decided < pool` alone is NOT counter-evidence: title/abstract-excluded
    // records never receive a finalStatus, so finished screens legitimately sit
    // below the pool (the Defect 2 mismatched-population bug).
    if (records === 0 || sc.complete === false || pendingWork) {
      return withDetail(S('partial', 'Signed off, but screening work is pending'));
    }
    return withDetail(S('done', 'Screening signed off'));
  }
  if (evidenceComplete) {
    return withDetail(S('done', typeof sc.complete === 'boolean'
      ? 'All screening steps complete'
      : 'All screenable records decided'));
  }
  if (decided > 0 || records > 0) return withDetail(S('partial'));
  // 98.md review (L12) — a LINKED-BUT-EMPTY workspace (0 records, 0 decided)
  // carries no counter-evidence, so hand-typed PRISMA numbers still count:
  // legacy projects screened externally must not regress from partial to empty
  // just because a (never-used) workspace was linked. '0' is still not evidence.
  if (p.prisma && positiveOrLegacyCount(p.prisma.included)) return withDetail(S('partial'));
  return withDetail(S('empty'));
}

function prismaRule(p) {
  const prisma = p.prisma || {};
  // 98.md §14 Defect 5 — done needs a POSITIVE include count (or a non-numeric
  // legacy string); the auto-filled "0" of an empty workspace is at most partial.
  if (positiveOrLegacyCount(prisma.included)) return S('done');
  if (nonEmpty(prisma.included) || nonEmpty(prisma.dbs) || nonEmpty(prisma.dedupe)) return S('partial');
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
 *   - screening?: { decidedCount, screenablePool, recordCount, progressStatus,
 *                   complete?, pending?, includedFinal? }
 *       decidedCount is isDuplicate-filtered (98.md §14 Defect 2a). `complete` is
 *       the server-computed substep predicate (isScreeningWorkComplete — note it
 *       does NOT require includedFinal>0; an all-rejected screen IS complete) and
 *       travels on the detail GET only. `pending` = { titleAbstractPending?,
 *       unresolvedConflicts?, unresolvedDuplicateGroups?, secondReviewPending? } —
 *       any count may be absent (the list GET batches only the cheap ones).
 *   - search?:    { revision, conceptCount, searchMode, readyForScreening }
 *       conceptCount = LIVE concept groups only (≥1 term with non-blank text and
 *       disabled!==true — mirrors searchBuilder/termLiveness.js), NOT raw groups;
 *       empty seed groups never count toward Search progress (98.md §6).
 *   - rob?:       { assessed }   (distinct studyIds with a RobAssessment row)
 *   Any field may be omitted; each rule falls back to the blob.
 * @param {object} [opts]  feature flags. `networkMetaAnalysis:true` makes `nma` a
 *                         required (counted) step.
 * @returns {{ pct:number, steps:Array<{id,label,num,required,status,reason?,detail?}>,
 *            requiredDone:number, requiredTotal:number, nextStepId:string|null }}
 *   `detail` (98.md §14, additive) is currently emitted by the screening step only.
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
    const { status, reason, detail } = ruleFor[def.id]();
    const required = def.optionalUnlessFlag ? !!flags[def.optionalUnlessFlag] : true;
    const step = { id: def.id, label: def.label, num: def.num, required, status };
    if (reason) step.reason = reason;
    // 98.md §14 — additive substate (screening only today); absent elsewhere so
    // existing consumers are unaffected.
    if (detail) step.detail = detail;
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
