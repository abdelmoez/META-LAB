/**
 * robController.js — META·LAB RoB (Risk of Bias) API (rob.md §5).
 *
 * The pure engine (src/research-engine/rob) is the SINGLE SOURCE OF TRUTH for
 * judgements — this controller never re-implements the algorithm. It persists
 * answers + BOTH the engine-PROPOSED and the (possibly overridden) FINAL
 * judgement, recomputing proposals server-side on every answer change.
 *
 * Access (prompt41 Task 5): the META·LAB project OWNER, OR a linked-workspace member
 * granted `canAssessRiskOfBias` (see resolveRobAccess). No access → 404 (existence
 * hidden); write actions further require edit rights (read-only RoB members → 403).
 * Gated behind feature flag `rob_engine_v2` (default OFF → 404).
 * Every create / answer / override / finalise / delete writes a RobAuditLog row.
 */
import { prisma } from '../db/client.js';
// 101.md §28/§29 — RoB changes reach the manuscript through the ONE project event
// ledger, not a second RoB-specific notification path.
import { recordEvent } from '../provenance/recordEvent.js';
import { getById as getOwnedProject, touchProjectActivity, mutateProjectBlob } from '../store.js';
import { getRobMemberAccess } from '../screening/metalabAccess.js';
import { featureAccess } from '../services/featureAccess.js';
import { canMutateAssessment, normaliseScreeningStudy, normaliseManualStudy } from './robAccess.js';
import { getRobTool, isStarScoredTool } from '../../src/research-engine/rob/tools.js';
import { sendTierLimit } from '../services/entitlementService.js';
import { requireProjectExport, settleProjectExport, EXPORT_TYPES } from '../services/projectExportGuard.js';
import {
  getInstrument,
  isScoringInstrument,
  proposeDomain,
  proposeAllDomains,
  proposeOverall,
  completeness as engineCompleteness,
  summaryMatrix,
  RESPONSES,
  // P14 — guided appraisal (deterministic text → suggested answers) + agreement.
  appraiseFromText,
  ROB_APPRAISAL_VERSION,
  robDomainAgreement,
  // 101.md §18–§22 — Newcastle–Ottawa Scale: star scoring + the deliberately
  // separate, deliberately optional threshold-interpretation layer.
  nosScoreAssessment,
  nosSelectedValues,
  interpretNos,
  NOS_THRESHOLD_MODES,
  NOS_DEFAULT_THRESHOLD_MODE,
  NOS_MAX_STARS,
  AHRQ_STANDARD,
  NOS_CONVENTIONAL_BANDS,
  NOS_CONVENTIONAL_BANDS_NOTICE,
} from '../../src/research-engine/rob/index.js';

// ── Instrument awareness (P14) ────────────────────────────────────────────────
// The RoB service was hardcoded to RoB2. It is now instrument-aware: each
// assessment carries its own `instrumentId` (RoB2 | ROBINS-I) and every judgement
// path derives its instrument + valid judgement set + question→domain map from
// THAT instrument. Responses (Y/PY/PN/N/NI/NA) are identical across instruments,
// so VALID_RESPONSES stays shared. The RoB2 path is byte-identical to before.
const VALID_RESPONSES = new Set(RESPONSES);
// 101.md §18 — the two OFFICIAL Newcastle–Ottawa forms join the supported set.
// They are SEPARATE instruments (Outcome vs Exposure domains) exactly as §19/§20
// require; nothing about the RoB 2 / ROBINS-I paths changes.
const SUPPORTED_INSTRUMENTS = ['RoB2', 'ROBINS-I', 'NOS', 'NOS-CC'];

// 101.md §25 — a reconciled dual-reviewer record is a THIRD RobAssessment row
// carrying this status. It is an IDENTITY, not a workflow stage: the row stays
// 'consensus' through finalise/reopen so the reconciled record is always findable.
export const CONSENSUS_STATUS = 'consensus';

/** The instrument for a loaded assessment (defaults to RoB2 → unchanged path). */
function instrumentFor(a) {
  return getInstrument((a && a.instrumentId) || 'RoB2');
}
/** True when the assessment/instrument is star-scored (NOS) rather than judgement-based. */
function isStarInstrument(instrument) {
  return isScoringInstrument(instrument);
}
/** Valid FINAL/override judgement values for an instrument (RoB2: low/some/high;
 *  ROBINS-I: low/moderate/serious/critical/ni). */
function validJudgments(instrument) {
  return new Set((instrument.judgmentLevels || []).map(l => l.value));
}
/** questionId → domainId map for an instrument. */
function questionDomainMap(instrument) {
  const map = {};
  for (const d of instrument.domains) for (const q of d.questions) map[q.id] = d.id;
  return map;
}

// ── NOS persistence boundary (101.md §18/§21) ─────────────────────────────────
// RobAnswer.response is a single String column, shared with RoB 2 / ROBINS-I. The
// NOS needs a SET for exactly one item (the additive Comparability question), so
// that one item is stored as a JSON array string and decoded here — this pair of
// functions is the ONLY place either encoding is applied. The pure engine never
// sees the wire format: nos.js selectedValues() receives a value or an array.

/**
 * Decode a stored RobAnswer.response into the value the engine expects.
 * '["a","b"]' → ['a','b']; 'a' → 'a'. A string that merely LOOKS like JSON but
 * does not parse is returned untouched (never throws, never loses an answer).
 * Pure.
 */
export function decodeAnswerResponse(raw) {
  const s = typeof raw === 'string' ? raw : '';
  if (s.length > 1 && s.charCodeAt(0) === 91 /* '[' */) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean);
    } catch { /* not JSON after all — fall through to the literal value */ }
  }
  return s;
}

/**
 * Encode validated option values for storage. select:'many' ALWAYS stores a JSON
 * array (even for one value) so the column shape is a function of the instrument,
 * not of what the reviewer happened to tick. Pure.
 */
export function encodeAnswerResponse(question, values) {
  const list = Array.isArray(values) ? values : (values == null || values === '' ? [] : [String(values)]);
  if (question && question.select === 'many') return JSON.stringify(list);
  return list.length ? String(list[0]) : '';
}

/** Locate a question (and its domain) in an instrument by question id. Pure. */
export function findInstrumentQuestion(instrument, questionId) {
  for (const d of (instrument && instrument.domains) || []) {
    for (const q of d.questions || []) {
      if (q.id === questionId) return { domainId: d.id, domain: d, question: q };
    }
  }
  return null;
}

/**
 * Validate ONE Newcastle–Ottawa answer against its item's own option list.
 *
 * Two rules, both from the official header note (101.md §21):
 *   · every value must be an option this item actually offers — an unknown value
 *     is never stored, because a junk value would silently score 0 stars and look
 *     like a considered "no star" judgement;
 *   · a select:'one' item accepts exactly ONE value. Several Selection/Outcome/
 *     Exposure items legitimately have two STARRED options, but they are mutually
 *     exclusive alternatives capped at one star — accepting both would over-score
 *     the study. Only the additive Comparability item takes a set.
 *
 * @returns {{ok:true,domainId,question,values:string[],encoded:string}|{ok:false,error:string}}
 * Pure.
 */
export function validateStarAnswer(instrument, questionId, raw) {
  const found = findInstrumentQuestion(instrument, questionId);
  if (!found) return { ok: false, error: `Unknown questionId: ${questionId}` };
  const { domainId, question } = found;
  const optionOrder = (question.options || []).map((o) => o.value);
  const allowed = new Set(optionOrder);

  const given = nosSelectedValues(typeof raw === 'string' ? decodeAnswerResponse(raw) : raw);
  const seen = [];
  for (const v of given) { const s = String(v).trim(); if (s && !seen.includes(s)) seen.push(s); }

  if (!seen.length) return { ok: false, error: `A response is required for ${questionId}` };

  const unknown = seen.filter((v) => !allowed.has(v));
  if (unknown.length) {
    return {
      ok: false,
      error: `Invalid option${unknown.length > 1 ? 's' : ''} for ${questionId}: ${unknown.join(', ')}. Allowed: ${optionOrder.join(', ')}`,
    };
  }
  if (question.select !== 'many' && seen.length > 1) {
    return {
      ok: false,
      error: `${questionId} accepts a single option — the Newcastle–Ottawa Scale awards at most one star for this item (received ${seen.length}).`,
    };
  }
  // Canonicalise to the instrument's own option order so ["b","a"] and ["a","b"]
  // are stored identically and compare equal in dual-reviewer disagreement checks.
  const values = optionOrder.filter((v) => seen.includes(v));
  return { ok: true, domainId, question, values, encoded: encodeAnswerResponse(question, values) };
}

/**
 * 101.md §22 — coerce a project's NOS interpretation config to something safe.
 *
 * Default mode is 'none': the Newcastle–Ottawa Scale defines NO threshold, so the
 * honest default is to report the star profile and no verdict. Bands are only kept
 * for 'custom' (AHRQ is a fixed published rule; 'none' has nothing to band) and are
 * clamped to the 0..9 star range so a bad payload can never produce a nonsense band.
 * Pure — this is the trust boundary for the PUT handler.
 */
export function coerceNosThresholds(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const mode = NOS_THRESHOLD_MODES.includes(src.mode) ? src.mode : NOS_DEFAULT_THRESHOLD_MODE;
  const label = String(src.label == null ? '' : src.label).slice(0, 120);
  let bands = [];
  if (mode === 'custom') {
    bands = (Array.isArray(src.bands) ? src.bands : [])
      .map((b) => ({
        max: Number(b && b.max),
        level: String((b && b.level) || '').trim().slice(0, 60),
        label: String((b && b.label) || '').trim().slice(0, 60),
      }))
      .filter((b) => Number.isInteger(b.max) && b.max >= 0 && b.max <= NOS_MAX_STARS && b.level)
      .sort((a, b) => a.max - b.max)
      .slice(0, 10);
  }
  return { mode, bands, label };
}

/**
 * The project's NOS threshold config, read from the Project.data blob key
 * `robNosThresholds`. Best-effort: an unreadable project degrades to the honest
 * default ('none') rather than failing an assessment read.
 */
async function loadNosThresholds(projectId) {
  try {
    const row = await prisma.project.findFirst({ where: { id: projectId }, select: { data: true } });
    let blob = {};
    try { blob = JSON.parse((row && row.data) || '{}'); } catch { blob = {}; }
    return coerceNosThresholds(blob.robNosThresholds);
  } catch {
    return coerceNosThresholds(null);
  }
}

// ── Feature flag ──────────────────────────────────────────────────────────────
// Default OFF: enabled ONLY when featureFlags.rob_engine_v2 === true. Missing /
// malformed flags → disabled (the opposite of the "missing = on" defaults used by
// long-standing features, because this one ships dark until the gate passes).
// 75.md Phase 7 — routed through the central seam so a globally-disabled RoB engine
// stays usable by admins (reason 'adminOnly') while non-admins keep the 404. Each
// handler passes `req.user`; no user = plain flag state.
async function robEnabled(user = null) {
  return (await featureAccess('rob_engine_v2', user)).allowed;
}

// P14 — the GUIDED APPRAISAL sub-feature (appraise + validation endpoints). It is
// gated behind its OWN flag `guidedRobAppraisal` AND functionally depends on
// `rob_engine_v2` (there is nothing to appraise without the RoB engine on). Both
// must be true; either off → 404 (existence hidden), exactly like robEnabled().
// The guided→rob_engine_v2 hard dependency now lives in featureAccess's FEATURE_DEPS
// (single source of truth). Pass `req.user` so admins keep guided appraisal usable
// while it is globally OFF; no user = plain flag state.
async function guidedAppraisalEnabled(user = null) {
  return (await featureAccess('guidedRobAppraisal', user)).allowed;
}

/**
 * 101.md §28/§30 — RoB audit action → project-event type. Only entries that are a
 * genuine scientific change appear here; ROB_CREATE (an empty draft assessment) and
 * ROB_EXPORT are deliberately absent, because neither changes what the manuscript
 * can say. `RISK_OF_BIAS_JUDGMENT_CHANGED` declares `rob.judgments`, which the
 * dependency graph maps to Results and Limitations.
 */
const ROB_EVENT_TYPES = Object.freeze({
  ROB_ANSWER: 'RISK_OF_BIAS_JUDGMENT_CHANGED',
  ROB_OVERRIDE: 'RISK_OF_BIAS_JUDGMENT_CHANGED',
  ROB_FINALISE: 'RISK_OF_BIAS_JUDGMENT_CHANGED',
  ROB_DELETE: 'RISK_OF_BIAS_JUDGMENT_CHANGED',
});

// ── Audit (best-effort; never throws into a handler) ──────────────────────────
async function audit(projectId, assessmentId, actor, action, { entityType = null, entityId = null, details = {} } = {}) {
  try {
    await prisma.robAuditLog.create({
      data: {
        projectId,
        assessmentId: assessmentId || '',
        actorId: actor?.id || 'system',
        actorName: actor?.name || actor?.email || '',
        action,
        entityType,
        entityId,
        details: JSON.stringify(details ?? {}).slice(0, 4000),
      },
    });
  } catch { /* audit is best-effort */ }

  // 101.md §28/§29 — a risk-of-bias change must reach the manuscript, and it must
  // do so through the ONE project event ledger rather than a second RoB-specific
  // notification path. This helper is the single funnel every RoB mutation already
  // passes through, so emitting here covers create/answer/override/finalise/delete
  // without instrumenting each handler separately.
  //
  // Materiality is NOT set here: classify.js derives significance, the affected
  // manuscript sections and the recalc flags from the event type's declared
  // dependencyKeys (`rob.judgments` → Results + Limitations). Actions that are not
  // scientific changes — opening, exporting — map to no event at all (§30).
  const eventType = ROB_EVENT_TYPES[action];
  if (eventType) {
    void recordEvent({
      eventType,
      entityType: 'rob_assessment',
      entityId: assessmentId || null,
      relatedStudy: details && details.studyId ? String(details.studyId) : null,
      metadata: {
        action,
        instrumentId: (details && details.instrumentId) || undefined,
        domainId: (details && details.domainId) || undefined,
      },
    }, {
      projectId,
      actorUserId: actor?.id || '',
      actorName: actor?.name || actor?.email || '',
    });
  }

  // prompt50 WS5 — every RoB mutation is meaningful activity on the META·LAB
  // project (projectId IS the META·LAB project id here). Best-effort, never throws.
  if (action !== 'ROB_EXPORT') void touchProjectActivity(projectId);
}

// ── Authorization (prompt41 Task 5) ───────────────────────────────────────────
// RoB access = the META·LAB project OWNER, OR a linked-workspace MEMBER granted the
// `canAssessRiskOfBias` permission. Previously ALL handlers were owner-only, so a
// member who was granted RoB access still got 404. The project store is owner-scoped,
// so for the member path the project is loaded via its (verified) owner id.
// Returns { project, canEdit } or null (→ 404, existence hidden).
async function resolveRobAccess(projectId, userId) {
  const owned = await getOwnedProject(projectId, userId);
  // prompt46 #3 — expose isOwner + role so per-assessment mutation can be scoped to
  // creator/owner/leader (canMutateAssessment). Owner path is always full owner.
  if (owned) return { project: owned, canEdit: true, isOwner: true, role: 'owner' };
  const m = await getRobMemberAccess(projectId, userId);
  if (m) {
    const project = await getOwnedProject(projectId, m.ownerId);
    if (project) return { project, canEdit: m.canEdit, isOwner: false, role: m.role };
  }
  return null;
}

// prompt46 #3 — the access flags a loaded assessment carries, for canMutateAssessment.
function permsFor(a) {
  return { canEdit: a._canEdit, isOwner: a._isOwner, role: a._role };
}

// prompt46 #4 — the merged RoB "study universe": screening/extraction-derived
// studies (project.studies blob, source:'screening', NOT deletable from RoB) +
// RoB-local manual studies (RobManualStudy, source:'manual'). One list keyed by id.
async function loadStudyUniverse(project) {
  const screening = (Array.isArray(project.studies) ? project.studies : [])
    .filter((s) => s && s.id)
    .map(normaliseScreeningStudy);
  const manualRows = await prisma.robManualStudy.findMany({
    where: { projectId: project.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  const manual = manualRows.map(normaliseManualStudy);
  return [...screening, ...manual];
}

// ── Loaders ───────────────────────────────────────────────────────────────────
// Returns { a, project, canEdit } when the caller may at least VIEW the assessment,
// else null (404). Edit handlers additionally require `canEdit` (else 403).
async function loadAssessment(assessmentId, userId) {
  const a = await prisma.robAssessment.findFirst({
    where: { id: assessmentId, deletedAt: null },
    include: { answers: true, domainJudgments: true, overall: true },
  });
  if (!a) return null;
  const access = await resolveRobAccess(a.projectId, userId);
  if (!access) return null;
  a._canEdit = access.canEdit;   // project-level edit right (read-only members → false)
  a._isOwner = access.isOwner;   // prompt46 #3 — owner/leader bypass the creator check
  a._role = access.role;
  return a;
}

// Resolved judgement = final (when overridden) else proposed.
function resolvedDomain(dj) {
  return (dj.overridden && dj.finalJudgment) ? dj.finalJudgment : (dj.proposedJudgment || null);
}

/**
 * 101.md §21 — resolved STAR count for a domain. Prefers the dedicated Int column
 * and only falls back to parsing the numeral out of the judgement string for rows
 * written before those columns existed (§38 — old projects keep working).
 */
function resolvedDomainStars(dj) {
  const v = (dj.overridden && dj.finalStars != null) ? dj.finalStars : dj.proposedStars;
  if (v != null && Number.isFinite(Number(v))) return Number(v);
  const n = Number(resolvedDomain(dj));
  return Number.isFinite(n) ? n : 0;
}

/** Group flat RobAnswer rows into { [domainId]: { [questionId]: response } }.
 *  Star-scored instruments (NOS) decode the stored wire format first — that is the
 *  ONLY difference; the judgement-instrument path is byte-identical to before. */
function answersByDomainFrom(instrument, answers) {
  const star = isStarInstrument(instrument);
  const out = {};
  for (const d of instrument.domains) out[d.id] = {};
  for (const ans of answers) {
    if (!out[ans.domainId]) out[ans.domainId] = {};
    out[ans.domainId][ans.questionId] = star ? decodeAnswerResponse(ans.response) : ans.response;
  }
  return out;
}

/**
 * Recompute every PROPOSED judgement from the current answers and persist them,
 * PRESERVING any human override (final + overridden). Returns the fresh proposals.
 * `instrument` is the assessment's instrument (RoB2 default).
 */
async function recomputeAndPersist(assessmentId, instrument = getInstrument('RoB2')) {
  const answers = await prisma.robAnswer.findMany({ where: { assessmentId } });
  const abd = answersByDomainFrom(instrument, answers);
  const proposals = proposeAllDomains(instrument, abd); // { D1:{judgment,reasons}, ... }
  // 101.md §21 — for a star-scored instrument the SAME answers are also scored by
  // nosScoreAssessment, so the Int columns come from the instrument's own scorer
  // rather than from re-parsing a numeral back out of the judgement string.
  const star = isStarInstrument(instrument);
  const score = star ? nosScoreAssessment(instrument, abd) : null;

  // Upsert each domain's proposedJudgment (final/overridden untouched). Star
  // instruments write BOTH representations: the numeral into the existing String
  // column (backward compatibility) and the count into proposedStars.
  for (const d of instrument.domains) {
    const proposed = proposals[d.id].judgment;
    const starCols = star ? { proposedStars: score.byDomain[d.id].stars } : {};
    await prisma.robDomainJudgment.upsert({
      where: { assessmentId_domainId: { assessmentId, domainId: d.id } },
      update: { proposedJudgment: proposed, ...starCols },
      create: { assessmentId, domainId: d.id, proposedJudgment: proposed, ...starCols },
    });
  }

  // Overall is computed from the RESOLVED domain judgements (override-aware).
  const djs = await prisma.robDomainJudgment.findMany({ where: { assessmentId } });
  const resolvedByDomain = {};
  // Star instruments hand the resolved COUNT to judgeOverall ({ stars }) instead of
  // a numeral string, so an overridden domain contributes its overridden stars.
  for (const dj of djs) {
    resolvedByDomain[dj.domainId] = star ? { stars: resolvedDomainStars(dj) } : resolvedDomain(dj);
  }
  const overall = proposeOverall(instrument, resolvedByDomain);
  // multiSomeConcernsFlag is RoB2-specific; ROBINS-I overall returns no such flag →
  // coerce to a real boolean (false) so the non-nullable column is always set.
  const multiFlag = !!overall.multiSomeConcernsFlag;
  const overallStarCols = star
    ? { proposedStars: overall.stars != null ? Number(overall.stars) : null, maxStars: instrument.maxStars }
    : {};
  await prisma.robOverall.upsert({
    where: { assessmentId },
    update: { proposedOverall: overall.judgment, multiSomeConcernsFlag: multiFlag, ...overallStarCols },
    create: { assessmentId, proposedOverall: overall.judgment, multiSomeConcernsFlag: multiFlag, ...overallStarCols },
  });

  return { proposals, overall, score };
}

/**
 * Build the full assessment VIEW the API returns (answers + per-domain proposed/
 * final/resolved + reasons trace + overall + completeness + a summary row). Pure
 * read; reasons are recomputed from the engine for display (never stored).
 */
async function buildView(assessmentId) {
  const a = await prisma.robAssessment.findFirst({
    where: { id: assessmentId },
    include: { answers: true, domainJudgments: true, overall: true },
  });
  if (!a) return null;
  const inst = instrumentFor(a);
  const star = isStarInstrument(inst);
  const abd = answersByDomainFrom(inst, a.answers);

  const djByDomain = {};
  for (const dj of a.domainJudgments) djByDomain[dj.domainId] = dj;

  const domains = inst.domains.map(d => {
    const dj = djByDomain[d.id] || { proposedJudgment: '', finalJudgment: null, overridden: false, overrideJustification: null };
    const prop = proposeDomain(inst, d.id, abd[d.id] || {});
    const row = {
      domainId: d.id,
      proposedJudgment: prop.judgment,
      reasons: prop.reasons,
      finalJudgment: dj.finalJudgment || null,
      overridden: !!dj.overridden,
      overrideJustification: dj.overrideJustification || null,
      resolvedJudgment: (dj.overridden && dj.finalJudgment) ? dj.finalJudgment : prop.judgment,
    };
    // 101.md §21/§26 — star instruments surface the count as a NUMBER alongside the
    // numeral string, so no consumer has to parse a judgement vocabulary.
    if (star) {
      row.name = d.name;
      row.maxStars = d.maxStars;
      row.additive = !!d.additive;
      row.proposedStars = prop.stars != null ? Number(prop.stars) : 0;
      row.finalStars = dj.finalStars != null ? Number(dj.finalStars) : null;
      row.resolvedStars = (dj.overridden && row.finalStars != null) ? row.finalStars : row.proposedStars;
    }
    return row;
  });

  const resolvedByDomain = {};
  for (const d of domains) resolvedByDomain[d.domainId] = star ? { stars: d.resolvedStars } : d.resolvedJudgment;
  const overallProp = proposeOverall(inst, resolvedByDomain);
  const ov = a.overall || {};
  const overall = {
    proposedOverall: overallProp.judgment,
    reasons: overallProp.reasons,
    multiSomeConcernsFlag: overallProp.multiSomeConcernsFlag,
    finalOverall: ov.finalOverall || null,
    overridden: !!ov.overridden,
    overrideJustification: ov.overrideJustification || null,
    resolvedOverall: (ov.overridden && ov.finalOverall) ? ov.finalOverall : overallProp.judgment,
  };
  if (star) {
    overall.proposedStars = overallProp.stars != null ? Number(overallProp.stars) : 0;
    overall.finalStars = ov.finalStars != null ? Number(ov.finalStars) : null;
    overall.resolvedStars = (ov.overridden && overall.finalStars != null) ? overall.finalStars : overall.proposedStars;
    overall.maxStars = inst.maxStars;
    overall.profile = overallProp.profile || '';
  }

  const comp = engineCompleteness(inst, { answersByDomain: abd });

  // 101.md §21/§22 — the RESOLVED star profile (override-aware) plus, separately,
  // the project's chosen interpretation. `score` is the profile; `interpretation`
  // always carries `official:false` and an attribution, so no UI can render a
  // verdict without saying whose rule produced it. Default mode is 'none' → no
  // verdict at all, because the NOS defines no threshold.
  let score = null;
  let interpretation = null;
  let thresholds = null;
  if (star) {
    const byDomain = {};
    for (const d of domains) {
      byDomain[d.domainId] = { domainId: d.domainId, stars: d.resolvedStars, maxStars: d.maxStars };
    }
    score = {
      instrumentId: inst.id,
      variant: inst.variant,
      byDomain,
      total: overall.resolvedStars,
      maxStars: inst.maxStars,
      complete: comp.overall.complete,
      profile: domains.map(d => `${d.resolvedStars}/${d.maxStars}`).join(' · '),
    };
    thresholds = await loadNosThresholds(a.projectId);
    interpretation = interpretNos(score, thresholds);
  }

  return {
    id: a.id,
    projectId: a.projectId,
    studyId: a.studyId,
    outcomeId: a.outcomeId,
    resultLabel: a.resultLabel,
    instrumentId: a.instrumentId,
    instrumentVersion: a.instrumentVersion,
    instrumentLabel: getRobTool(a.instrumentId)?.label || a.instrumentId || 'Tool unknown', // prompt46 #5 — human tool label (e.g. "RoB 2")
    instrumentName: inst.name,
    variant: a.variant,
    reviewerId: a.reviewerId,
    reviewerName: a.reviewerName,
    status: a.status,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    answersByDomain: abd,
    answerMeta: a.answers.map(x => ({
      domainId: x.domainId, questionId: x.questionId, response: x.response,
      rationale: x.rationale || null, evidenceQuote: x.evidenceQuote || null, evidenceLocator: x.evidenceLocator || null,
      // P14 — guided-appraisal provenance (a machine SUGGESTION, never a decision).
      aiSuggested: x.aiSuggested === true,
      aiConfidence: x.aiConfidence != null ? x.aiConfidence : null,
      aiModel: x.aiModel || null,
      aiModelVersion: x.aiModelVersion || null,
    })),
    domains,
    overall,
    completeness: comp,
    // Star-scored instruments only; null for RoB 2 / ROBINS-I (unchanged shape).
    scoring: star ? 'stars' : 'judgment',
    score,
    interpretation,
    nosThresholds: thresholds,
    // 101.md §25 — a reconciled dual-reviewer record identifies itself.
    isConsensus: a.status === CONSENSUS_STATUS,
  };
}

// ── GET /api/rob/instruments/:id  (rob2 | robins-i | nos | nos-cc) ────────────
// Serves the serialisable instrument definition for a data-driven UI. `/rob2`
// keeps working (RoB2 default); `/robins-i` serves the 7-domain, 5-level tool;
// `/nos` and `/nos-cc` serve the two official Newcastle–Ottawa forms (101.md §18).
const INSTRUMENT_URL_IDS = {
  rob2: 'RoB2',
  'robins-i': 'ROBINS-I',
  robinsi: 'ROBINS-I',
  nos: 'NOS',
  'nos-cohort': 'NOS',
  'nos-cc': 'NOS-CC',
  noscc: 'NOS-CC',
  'nos-case-control': 'NOS-CC',
};
export async function getRobInstrument(req, res) {
  if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
  const raw = String(req.params.id || 'rob2').toLowerCase();
  const instrumentId = INSTRUMENT_URL_IDS[raw];
  if (!instrumentId) return res.status(404).json({ error: 'Unknown instrument' });
  return res.json({ instrument: getInstrument(instrumentId) });
}

// ── POST /api/rob/assessments ─────────────────────────────────────────────────
export async function createAssessment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const { projectId, studyId, outcomeId, resultLabel, instrumentId } = req.body || {};
    if (!projectId || !studyId) {
      return res.status(400).json({ error: 'projectId and studyId are required' });
    }
    // Instrument selection (P14): RoB2 (default, unchanged), ROBINS-I, or either
    // official Newcastle–Ottawa form. Any other value is rejected rather than
    // silently coerced (an unsupported tool must never be stored). The version +
    // variant are taken from the instrument definition.
    const wantInstrumentId = instrumentId ? String(instrumentId) : 'RoB2';
    if (!SUPPORTED_INSTRUMENTS.includes(wantInstrumentId)) {
      return res.status(400).json({ error: `instrumentId must be one of: ${SUPPORTED_INSTRUMENTS.join(', ')}` });
    }
    // ROBINS-I is part of the guided-appraisal feature, so it may only be created
    // when `guidedRobAppraisal` is ON. With the flag OFF the workspace behaves
    // exactly as before (a stray ROBINS-I request → 400). The NOS is NOT gated on
    // guided appraisal: it is a manual, human-scored instrument (101.md §18/§23)
    // with no machine-suggestion path, so it rides the `rob_engine_v2` flag alone.
    if (wantInstrumentId === 'ROBINS-I' && !(await guidedAppraisalEnabled(req.user))) {
      return res.status(400).json({ error: 'ROBINS-I requires the Guided RoB Appraisal feature, which is not enabled.' });
    }
    const instrument = getInstrument(wantInstrumentId);
    const access = await resolveRobAccess(projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You have read-only access to Risk of Bias for this project.' });
    const project = access.project;
    // prompt46 #4 — validate against the merged study UNIVERSE (screening-derived +
    // RoB-local manual). Empty universe → accept any studyId (preserves the prior
    // behaviour the integration suite relies on for study-less projects).
    const universe = await loadStudyUniverse(project);
    if (universe.length && !universe.some(s => s.id === studyId)) {
      return res.status(404).json({ error: 'Study not found in project' });
    }

    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, email: true } });
    const a = await prisma.robAssessment.create({
      data: {
        projectId, studyId,
        outcomeId: outcomeId ? String(outcomeId) : null,
        resultLabel: resultLabel ? String(resultLabel).slice(0, 300) : null,
        instrumentId: instrument.id,
        instrumentVersion: instrument.instrumentVersion,
        variant: instrument.variant,
        reviewerId: req.user.id,
        reviewerName: me?.name || me?.email || '',
        status: 'draft',
      },
    });
    await recomputeAndPersist(a.id, instrument); // initialise provisional proposals
    await audit(projectId, a.id, { ...req.user, name: me?.name }, 'ROB_CREATE', {
      entityType: 'RobAssessment', entityId: a.id, details: { studyId, outcomeId: outcomeId || null, instrumentId: instrument.id },
    });
    const view = await buildView(a.id);
    return res.status(201).json({ assessment: view });
  } catch (err) {
    console.error('[rob] createAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/rob/assessments/:id ──────────────────────────────────────────────
export async function getAssessment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    // prompt46 #3 — surface per-assessment mutate permission so the UI disables
    // edit/delete for non-creators (the server still enforces it on every write).
    const view = await buildView(a.id);
    view.canMutate = canMutateAssessment(a, permsFor(a), req.user.id);
    return res.json({ assessment: view, instrument: instrumentFor(a) });
  } catch (err) {
    console.error('[rob] getAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/rob/projects/:projectId/assessments ──────────────────────────────
export async function listProjectAssessments(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    const project = access.project;

    const rows = await prisma.robAssessment.findMany({
      where: { projectId: req.params.projectId, deletedAt: null },
      include: { domainJudgments: true, overall: true },
      orderBy: { createdAt: 'asc' },
    });
    // prompt46 #4 — resolve labels/source against the merged study universe so
    // manual studies get correct labels and a source badge.
    const universe = await loadStudyUniverse(project);
    const studiesById = {};
    for (const s of universe) studiesById[s.id] = s;

    const assessments = rows.map(a => {
      const dj = {};
      for (const d of a.domainJudgments) dj[d.domainId] = resolvedDomain(d);
      const ov = a.overall;
      const overall = ov ? ((ov.overridden && ov.finalOverall) ? ov.finalOverall : ov.proposedOverall) : null;
      const st = studiesById[a.studyId];
      const label = a.resultLabel
        ? `${st ? `${st.author || ''} ${st.year || ''}`.trim() || a.studyId : a.studyId} — ${a.resultLabel}`
        : (st ? `${st.author || ''} ${st.year || ''}`.trim() || a.studyId : a.studyId);
      const row = {
        id: a.id, studyId: a.studyId, resultLabel: a.resultLabel, status: a.status, label, domainJudgments: dj, overall,
        // prompt46 #3/#5 — creator + tool surfaced to the list UI.
        reviewerId: a.reviewerId, reviewerName: a.reviewerName,
        instrumentId: a.instrumentId,
        instrumentLabel: getRobTool(a.instrumentId)?.label || a.instrumentId || 'Tool unknown',
        // prompt46 #4 — study source ('manual' studies are visually distinct).
        source: st ? st.source : 'screening',
        // prompt46 #3 — per-row mutate permission for disabling edit/delete in the UI.
        canMutate: canMutateAssessment(a, { canEdit: access.canEdit, isOwner: access.isOwner, role: access.role }, req.user.id),
        // 101.md §25 — the reconciled dual-reviewer record is visually distinct.
        isConsensus: a.status === CONSENSUS_STATUS,
      };
      // 101.md §26 — a star-scored row carries its PROFILE, not a traffic light.
      if (isStarScoredTool(a.instrumentId)) {
        const starsByDomain = {};
        for (const d of a.domainJudgments) starsByDomain[d.domainId] = resolvedDomainStars(d);
        const inst = getInstrument(a.instrumentId);
        row.scoring = 'stars';
        row.starsByDomain = starsByDomain;
        row.maxStarsByDomain = Object.fromEntries(inst.domains.map(d => [d.id, d.maxStars]));
        row.stars = ov && ov.overridden && ov.finalStars != null
          ? Number(ov.finalStars)
          : inst.domains.reduce((sum, d) => sum + (starsByDomain[d.id] || 0), 0);
        row.maxStars = (ov && ov.maxStars != null) ? Number(ov.maxStars) : inst.maxStars;
        row.profile = inst.domains.map(d => `${starsByDomain[d.id] || 0}/${d.maxStars}`).join(' · ');
      }
      return row;
    });

    // The traffic-light matrix is per-instrument (RoB2 has 5 domains, ROBINS-I 7).
    // A single project SHOULD use one instrument; if assessments mix instruments we
    // fall back to RoB2's shape rather than dropping/misaligning domains. (The
    // validation endpoint strictly scopes agreement by instrument.)
    const distinctInstruments = [...new Set(rows.map(r => r.instrumentId || 'RoB2'))];
    const matrixInstrument = getInstrument(
      distinctInstruments.length === 1 && SUPPORTED_INSTRUMENTS.includes(distinctInstruments[0])
        ? distinctInstruments[0]
        : 'RoB2',
    );
    const matrix = summaryMatrix(
      assessments.map(a => ({ id: a.id, label: a.label, domainJudgments: a.domainJudgments, overall: a.overall })),
      matrixInstrument,
    );
    return res.json({ assessments, matrix });
  } catch (err) {
    console.error('[rob] listProjectAssessments error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PUT /api/rob/assessments/:id/answers ──────────────────────────────────────
// Body: { answers: [{ domainId?, questionId, response, rationale?, evidenceQuote?, evidenceLocator? }] }
export async function upsertAnswers(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can modify or delete this assessment.' });
    if (a.status === 'complete') return res.status(409).json({ error: 'Assessment is finalised; re-open to edit' });

    const list = Array.isArray(req.body?.answers) ? req.body.answers : null;
    if (!list || list.length === 0) return res.status(400).json({ error: 'answers[] is required' });

    const instrument = instrumentFor(a);
    const star = isStarInstrument(instrument);
    const questionDomain = questionDomainMap(instrument);

    // 101.md §18 — validate the WHOLE batch before writing any of it, so a bad item
    // can never leave half a batch persisted. Judgement instruments validate against
    // the shared Y/PY/PN/N/NI/NA set; star instruments validate against the item's
    // OWN option list, with the select:'one' arity enforced (never store junk).
    const prepared = [];
    for (const item of list) {
      const questionId = String(item.questionId || '');
      const domainId = questionDomain[questionId];
      if (!domainId) return res.status(400).json({ error: `Unknown questionId: ${questionId}` });
      let response;
      if (star) {
        const v = validateStarAnswer(instrument, questionId, item.response);
        if (!v.ok) return res.status(400).json({ error: v.error });
        response = v.encoded;
      } else {
        response = String(item.response || '');
        if (!VALID_RESPONSES.has(response)) return res.status(400).json({ error: `Invalid response for ${questionId}: ${response}` });
      }
      prepared.push({ questionId, domainId, response, item });
    }

    for (const { questionId, domainId, response, item } of prepared) {
      await prisma.robAnswer.upsert({
        where: { assessmentId_questionId: { assessmentId: a.id, questionId } },
        update: {
          domainId, response,
          rationale: item.rationale != null ? String(item.rationale).slice(0, 4000) : undefined,
          evidenceQuote: item.evidenceQuote != null ? String(item.evidenceQuote).slice(0, 4000) : undefined,
          evidenceLocator: item.evidenceLocator != null ? String(item.evidenceLocator).slice(0, 500) : undefined,
          // A human answering/editing this question clears any machine-suggestion
          // provenance (P14): the row is now a HUMAN answer, not a suggestion.
          aiSuggested: false, aiConfidence: null, aiModel: null, aiModelVersion: null,
        },
        create: {
          assessmentId: a.id, domainId, questionId, response,
          rationale: item.rationale != null ? String(item.rationale).slice(0, 4000) : null,
          evidenceQuote: item.evidenceQuote != null ? String(item.evidenceQuote).slice(0, 4000) : null,
          evidenceLocator: item.evidenceLocator != null ? String(item.evidenceLocator).slice(0, 500) : null,
          aiSuggested: false,
        },
      });
    }
    await recomputeAndPersist(a.id, instrument);
    await prisma.robAssessment.update({ where: { id: a.id }, data: { updatedAt: new Date() } });
    await audit(a.projectId, a.id, req.user, 'ROB_ANSWER', { entityType: 'RobAnswer', entityId: a.id, details: { count: list.length } });
    return res.json({ assessment: await buildView(a.id) });
  } catch (err) {
    console.error('[rob] upsertAnswers error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/rob/assessments/:id/override ────────────────────────────────────
// Body: { target: 'domain'|'overall', domainId?, finalJudgment, justification }
// finalJudgment empty/null + clear:true → clears the override.
export async function overrideJudgment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can modify or delete this assessment.' });
    // A finalised assessment is locked — overriding must go through reopen first
    // (mirrors upsertAnswers; without this the finalise lock is defeated).
    if (a.status === 'complete') return res.status(409).json({ error: 'Assessment is finalised; re-open to edit' });

    const instrument = instrumentFor(a);
    const star = isStarInstrument(instrument);
    const validJ = validJudgments(instrument);
    const { target, domainId, finalJudgment, justification, clear } = req.body || {};
    const wantClear = clear === true || finalJudgment == null || finalJudgment === '';

    // 101.md §21 — on a star-scored instrument an "override" is a reviewer setting
    // the STAR COUNT for a domain (or the total), not picking a judgement level, so
    // it is validated as a whole number within that domain's official maximum. Both
    // representations are then written: the numeral into the existing String column
    // and the Int into finalStars.
    let starValue = null;
    if (!wantClear) {
      if (star) {
        let max = instrument.maxStars;
        if (target === 'domain') {
          const d = instrument.domains.find(x => x.id === domainId);
          if (!d) return res.status(400).json({ error: `Unknown domainId: ${domainId}` });
          max = d.maxStars;
        }
        const n = Number(finalJudgment);
        if (!Number.isInteger(n) || n < 0 || n > max) {
          return res.status(400).json({ error: `finalJudgment must be a whole number of stars between 0 and ${max}` });
        }
        starValue = n;
      } else if (!validJ.has(finalJudgment)) {
        return res.status(400).json({ error: `finalJudgment must be one of: ${[...validJ].join(', ')}` });
      }
      if (typeof justification !== 'string' || !justification.trim()) {
        return res.status(400).json({ error: 'A justification is required to override the algorithm' });
      }
    }
    // The value written into the legacy judgement String column.
    const finalValue = star && !wantClear ? String(starValue) : finalJudgment;

    if (target === 'domain') {
      if (!domainId || !instrument.domains.some(d => d.id === domainId)) {
        return res.status(400).json({ error: `Unknown domainId: ${domainId}` });
      }
      const seed = proposeDomain(instrument, domainId, {});
      const seedStars = star ? { proposedStars: seed.stars != null ? Number(seed.stars) : 0 } : {};
      const starCols = star ? { finalStars: wantClear ? null : starValue } : {};
      await prisma.robDomainJudgment.upsert({
        where: { assessmentId_domainId: { assessmentId: a.id, domainId } },
        update: wantClear
          ? { overridden: false, finalJudgment: null, overrideJustification: null, ...starCols }
          : { overridden: true, finalJudgment: finalValue, overrideJustification: justification.trim().slice(0, 4000), ...starCols },
        create: wantClear
          ? { assessmentId: a.id, domainId, proposedJudgment: seed.judgment, ...seedStars }
          : { assessmentId: a.id, domainId, proposedJudgment: seed.judgment, ...seedStars, overridden: true, finalJudgment: finalValue, overrideJustification: justification.trim().slice(0, 4000), ...starCols },
      });
    } else if (target === 'overall') {
      const starCols = star ? { finalStars: wantClear ? null : starValue, maxStars: instrument.maxStars } : {};
      await prisma.robOverall.upsert({
        where: { assessmentId: a.id },
        update: wantClear
          ? { overridden: false, finalOverall: null, overrideJustification: null, ...starCols }
          : { overridden: true, finalOverall: finalValue, overrideJustification: justification.trim().slice(0, 4000), ...starCols },
        create: wantClear
          ? { assessmentId: a.id, ...starCols }
          : { assessmentId: a.id, overridden: true, finalOverall: finalValue, overrideJustification: justification.trim().slice(0, 4000), ...starCols },
      });
    } else {
      return res.status(400).json({ error: "target must be 'domain' or 'overall'" });
    }

    await recomputeAndPersist(a.id, instrument); // overall reflects override-aware resolved domains
    await audit(a.projectId, a.id, req.user, 'ROB_OVERRIDE', {
      entityType: target === 'domain' ? 'RobDomainJudgment' : 'RobOverall',
      entityId: a.id,
      details: {
        target, domainId: domainId || null,
        finalJudgment: wantClear ? null : finalValue,
        ...(star ? { finalStars: wantClear ? null : starValue } : {}),
        cleared: wantClear,
      },
    });
    return res.json({ assessment: await buildView(a.id) });
  } catch (err) {
    console.error('[rob] overrideJudgment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/rob/assessments/:id/finalise ────────────────────────────────────
export async function finaliseAssessment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can modify or delete this assessment.' });

    const instrument = instrumentFor(a);
    const star = isStarInstrument(instrument);
    const view = await buildView(a.id);
    if (!view.completeness.overall.complete) {
      return res.status(400).json({ error: 'Assessment is incomplete', completeness: view.completeness });
    }
    // Lock in final = resolved for every domain + overall.
    for (const d of view.domains) {
      await prisma.robDomainJudgment.update({
        where: { assessmentId_domainId: { assessmentId: a.id, domainId: d.domainId } },
        data: { finalJudgment: d.resolvedJudgment, ...(star ? { finalStars: d.resolvedStars } : {}) },
      });
    }
    await prisma.robOverall.update({
      where: { assessmentId: a.id },
      data: {
        finalOverall: view.overall.resolvedOverall,
        ...(star ? { finalStars: view.overall.resolvedStars, maxStars: instrument.maxStars } : {}),
      },
    });
    // 101.md §25 — 'consensus' is the row's IDENTITY, not a workflow stage, so a
    // reconciled record stays findable after it is finalised. Everything else goes
    // to 'complete' exactly as before.
    const nextStatus = a.status === CONSENSUS_STATUS ? CONSENSUS_STATUS : 'complete';
    await prisma.robAssessment.update({ where: { id: a.id }, data: { status: nextStatus } });
    await audit(a.projectId, a.id, req.user, 'ROB_FINALISE', {
      entityType: 'RobAssessment', entityId: a.id,
      details: {
        overall: view.overall.resolvedOverall,
        ...(star ? { totalStars: view.overall.resolvedStars, maxStars: instrument.maxStars, profile: view.score && view.score.profile } : {}),
        consensus: nextStatus === CONSENSUS_STATUS,
      },
    });
    return res.json({ assessment: await buildView(a.id) });
  } catch (err) {
    console.error('[rob] finaliseAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/rob/assessments/:id/reopen ──────────────────────────────────────
export async function reopenAssessment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can modify or delete this assessment.' });
    // Returning to draft must release the finalise-locked finals on NON-overridden
    // rows (genuine overrides are preserved) so the stored state matches "draft".
    // finalStars rides along: it is the star twin of finalJudgment (null on every
    // judgement-instrument row, so clearing it there is a no-op).
    await prisma.robDomainJudgment.updateMany({ where: { assessmentId: a.id, overridden: false }, data: { finalJudgment: null, finalStars: null } });
    await prisma.robOverall.updateMany({ where: { assessmentId: a.id, overridden: false }, data: { finalOverall: null, finalStars: null } });
    // 101.md §25 — reopening a consensus record does NOT strip its identity; it just
    // becomes editable again. Only ordinary assessments return to 'draft'.
    const nextStatus = a.status === CONSENSUS_STATUS ? CONSENSUS_STATUS : 'draft';
    await prisma.robAssessment.update({ where: { id: a.id }, data: { status: nextStatus } });
    await audit(a.projectId, a.id, req.user, 'ROB_REOPEN', { entityType: 'RobAssessment', entityId: a.id, details: { consensus: nextStatus === CONSENSUS_STATUS } });
    return res.json({ assessment: await buildView(a.id) });
  } catch (err) {
    console.error('[rob] reopenAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /api/rob/assessments/:id (soft delete) ─────────────────────────────
export async function deleteAssessment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can modify or delete this assessment.' });
    await prisma.robAssessment.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    await audit(a.projectId, a.id, req.user, 'ROB_DELETE', { entityType: 'RobAssessment', entityId: a.id });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[rob] deleteAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/rob/assessments/:id/export?format=csv|json|robvis ────────────────
export async function exportAssessment(req, res) {
  let reservation; // declared here so a post-reservation error can refund it (79.md §3)
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    const inst = instrumentFor(a);
    const view = await buildView(a.id);
    const format = String(req.query.format || 'json').toLowerCase();
    if (!['json', 'csv', 'robvis'].includes(format)) {
      return res.status(400).json({ error: "format must be 'json', 'csv', or 'robvis'" });
    }
    // 101.md §26 — robvis renders Cochrane traffic-light DOMAIN JUDGEMENTS. A NOS
    // star profile is not that, and coercing "3 stars" into a Low/High colour would
    // misrepresent the instrument. Refused before the export allowance is reserved.
    if (isStarInstrument(inst) && format === 'robvis') {
      return res.status(400).json({
        error: 'The robvis traffic-light export does not apply to the Newcastle–Ottawa Scale, which reports a star profile rather than risk-of-bias judgements. Export as CSV or JSON instead.',
      });
    }
    // 79.md §3 — RoB assessment export is a project export: Free tier is blocked and
    // permitted tiers consume one unit of the monthly allowance. Reserved once here,
    // after the format is known to be valid, and confirmed on the successful return.
    try {
      reservation = await requireProjectExport(req.user, {
        exportType: EXPORT_TYPES.ROB_ASSESSMENT, projectId: a.projectId || null, format,
      });
    } catch (e) { if (sendTierLimit(res, e)) return; throw e; }
    const FILE_PREFIXES = { RoB2: 'rob2', 'ROBINS-I': 'robins-i', NOS: 'nos-cohort', 'NOS-CC': 'nos-case-control' };
    const filePrefix = FILE_PREFIXES[inst.id] || 'robins-i';
    const base = `${filePrefix}_${a.studyId}${a.resultLabel ? '_' + a.resultLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : ''}`;

    if (format === 'json') {
      settleProjectExport(reservation.reservationId, { status: 'succeeded' });
      return res.json({ format, filename: `${base}.json`, mime: 'application/json', content: view });
    }
    if (format === 'csv') {
      // 101.md §26 — a star-scored instrument gets its OWN item-level CSV: the chosen
      // option value(s), the option TEXT as printed on the official form, the stars
      // that item earned, and the domain total. The judgement-instrument CSV below is
      // untouched (byte-identical to before).
      const rows = isStarInstrument(inst)
        ? [['domain', 'questionId', 'question', 'selected', 'selectedText', 'stars', 'rationale', 'evidenceQuote', 'evidenceLocator', 'domainStars', 'domainMaxStars']]
        : [['domain', 'questionId', 'response', 'rationale', 'proposed', 'final']];
      for (const d of view.domains) {
        const ans = view.answersByDomain[d.domainId] || {};
        const meta = view.answerMeta.filter(m => m.domainId === d.domainId);
        const defn = inst.domains.find(x => x.id === d.domainId);
        for (const q of defn.questions) {
          const qid = q.id;
          const m = meta.find(x => x.questionId === qid);
          if (isStarInstrument(inst)) {
            const chosen = nosSelectedValues(ans[qid]);
            const texts = chosen.map(v => (q.options.find(o => o.value === v) || {}).text || v);
            const starred = new Set((q.options || []).filter(o => o.star).map(o => o.value));
            const hits = chosen.filter(v => starred.has(v)).length;
            rows.push([
              d.domainId, qid, q.text, chosen.join('; '), texts.join('; '),
              q.select === 'many' ? hits : (hits > 0 ? 1 : 0),
              (m?.rationale || '').replace(/\s+/g, ' '),
              (m?.evidenceQuote || '').replace(/\s+/g, ' '),
              m?.evidenceLocator || '',
              d.resolvedStars, d.maxStars,
            ]);
          } else {
            rows.push([d.domainId, qid, ans[qid] || '', (m?.rationale || '').replace(/\s+/g, ' '), d.proposedJudgment, d.resolvedJudgment]);
          }
        }
      }
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      settleProjectExport(reservation.reservationId, { status: 'succeeded', fileSize: Buffer.byteLength(csv) });
      return res.json({ format, filename: `${base}.csv`, mime: 'text/csv', content: csv });
    }
    if (format === 'robvis') {
      // robvis "data" CSV: Study, D1..Dn, Overall, Weight (one row). The judgement
      // labels are the exact strings robvis expects, per instrument (RoB2 3-level;
      // ROBINS-I 5-level) — RoB2 labels are byte-identical to before.
      const ROBVIS_LABELS = {
        RoB2: { low: 'Low', some: 'Some concerns', high: 'High' },
        'ROBINS-I': { low: 'Low', moderate: 'Moderate', serious: 'Serious', critical: 'Critical', ni: 'No information' },
      };
      const labelSet = ROBVIS_LABELS[inst.id] || ROBVIS_LABELS.RoB2;
      const header = ['Study', ...inst.domains.map(d => d.id), 'Overall', 'Weight'];
      const judgeChar = j => (labelSet[j] || 'No information');
      const row = [
        view.resultLabel || view.studyId,
        ...view.domains.map(d => judgeChar(d.resolvedJudgment)),
        judgeChar(view.overall.resolvedOverall),
        '1',
      ];
      const csv = [header, row].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      settleProjectExport(reservation.reservationId, { status: 'succeeded', fileSize: Buffer.byteLength(csv) });
      return res.json({ format, filename: `${base}_robvis.csv`, mime: 'text/csv', content: csv });
    }
    // Unreachable (format validated above); kept as a defensive guard.
    return res.status(400).json({ error: "format must be 'json', 'csv', or 'robvis'" });
  } catch (err) {
    // A post-reservation failure produced no file → refund the allowance (79.md §3).
    settleProjectExport(reservation?.reservationId, { status: 'failed', failureReason: err?.message });
    console.error('[rob] exportAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/rob/projects/:projectId/studies (merged study universe) ───────────
// prompt46 #4 — screening/extraction-derived studies + RoB-local manual studies,
// each tagged with `source` ('screening' | 'manual'). View access is enough.
export async function listStudyUniverse(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    return res.json({ studies: await loadStudyUniverse(access.project) });
  } catch (err) {
    console.error('[rob] listStudyUniverse error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/rob/projects/:projectId/manual-studies ──────────────────────────
// Body: { title, authors?, year?, doi?, pmid?, notes? }. Requires RoB edit access.
export async function createManualStudy(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You have read-only access to Risk of Bias for this project.' });

    const { title, authors, year, doi, pmid, notes } = req.body || {};
    if (!String(title || '').trim() && !String(authors || '').trim()) {
      return res.status(400).json({ error: 'A study title (or authors) is required' });
    }
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, email: true } });
    const row = await prisma.robManualStudy.create({
      data: {
        projectId: req.params.projectId,
        title: String(title || '').slice(0, 500),
        authors: String(authors || '').slice(0, 300),
        year: String(year || '').slice(0, 12),
        doi: doi ? String(doi).slice(0, 200) : null,
        pmid: pmid ? String(pmid).slice(0, 40) : null,
        notes: notes ? String(notes).slice(0, 4000) : null,
        createdById: req.user.id,
        createdByName: me?.name || me?.email || '',
      },
    });
    await audit(req.params.projectId, '', { ...req.user, name: me?.name }, 'ROB_MANUAL_STUDY_ADD', {
      entityType: 'RobManualStudy', entityId: row.id, details: { title: row.title },
    });
    return res.status(201).json({ study: normaliseManualStudy(row) });
  } catch (err) {
    console.error('[rob] createManualStudy error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /api/rob/projects/:projectId/manual-studies/:studyId ────────────────
// Soft-delete a MANUAL study (creator/owner/leader only). Screening-derived studies
// have no RobManualStudy row → 404 (they are NOT deletable from RoB). If the study
// has assessments, require ?force=true (the assessments are kept, not deleted).
export async function deleteManualStudy(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });

    const row = await prisma.robManualStudy.findFirst({
      where: { id: req.params.studyId, projectId: req.params.projectId, deletedAt: null },
    });
    if (!row) return res.status(404).json({ error: 'Manual study not found' });

    // Creator OR owner OR leader, AND must have edit rights (mirrors canMutateAssessment:
    // a read-only leader cannot mutate). Owner always has canEdit via resolveRobAccess.
    const allowed = access.canEdit && (access.isOwner || access.role === 'leader' || row.createdById === req.user.id);
    if (!allowed) return res.status(403).json({ error: 'Only the study creator, a project leader, or the owner can delete this manual study.' });

    const n = await prisma.robAssessment.count({ where: { projectId: req.params.projectId, studyId: req.params.studyId, deletedAt: null } });
    if (n > 0 && String(req.query.force) !== 'true') {
      return res.status(409).json({ error: 'This study has risk-of-bias assessments. Confirm to remove the manual study (its assessments are kept).', assessmentCount: n });
    }
    await prisma.robManualStudy.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, email: true } });
    await audit(req.params.projectId, '', { ...req.user, name: me?.name || me?.email }, 'ROB_MANUAL_STUDY_DELETE', {
      entityType: 'RobManualStudy', entityId: row.id, details: { keptAssessments: n },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[rob] deleteManualStudy error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── P14 — Guided appraisal + validation ───────────────────────────────────────

/**
 * Resolve title + abstract for a RoB study from its linked screening RECORD.
 * The server has NO PDF-text extractor, so the ONLY server-side text is the
 * screening record's title/abstract (full text comes from the client body).
 * Mirrors screeningController.getMetaLabStudyRecord's workspace resolution
 * (own workspace preferred, else active membership). Best-effort → null when
 * there is no linked record (e.g. a manual study). Never throws.
 */
async function resolveStudyText(projectId, studyId, userId) {
  try {
    const candidates = await prisma.screenProject.findMany({
      where: { linkedMetaLabProjectId: projectId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    let sp = candidates.find(x => x.ownerId === userId) || null;
    if (!sp && candidates.length) {
      const membership = await prisma.screenProjectMember.findFirst({
        where: { projectId: { in: candidates.map(x => x.id) }, userId, status: 'active' },
        select: { projectId: true },
      });
      if (membership) sp = candidates.find(x => x.id === membership.projectId) || null;
    }
    if (!sp || !studyId) return null;
    const rec = await prisma.screenRecord.findFirst({
      where: { projectId: sp.id, handoffStudyId: String(studyId) },
      select: { title: true, abstract: true },
    });
    return rec || null;
  } catch {
    return null;
  }
}

// ── POST /api/rob/assessments/:id/appraise ────────────────────────────────────
// Gated behind `guidedRobAppraisal` (+ rob_engine_v2). Body: { fullText?, force? }.
// Runs the DETERMINISTIC guided-appraisal engine over the study's text (linked
// screening title/abstract + client-supplied fullText) and writes each suggested
// signalling answer to RobAnswer as a MACHINE SUGGESTION (aiSuggested=true,
// aiModel/aiModelVersion/aiConfidence + evidence). It writes ONLY questions with
// no existing HUMAN answer (unless force=true), then recomputes the PROPOSED
// judgements. It NEVER writes finalJudgment / overridden / overrideJustification —
// human decisions are untouched. Mutate access required (creator/owner/leader).
export async function appraiseAssessment(req, res) {
  try {
    if (!(await guidedAppraisalEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can run a guided appraisal for this assessment.' });
    if (a.status === 'complete') return res.status(409).json({ error: 'Assessment is finalised; re-open to edit' });

    const instrument = instrumentFor(a);
    // 101.md §17 — the guided appraiser maps text onto the shared Y/PY/PN/N/NI
    // signalling vocabulary. The Newcastle–Ottawa items have their own closed option
    // lists and no such mapping exists, so we refuse rather than manufacture answers
    // that would look like a considered human appraisal.
    if (isStarInstrument(instrument)) {
      return res.status(400).json({ error: 'Guided appraisal is not available for the Newcastle–Ottawa Scale; its items must be assessed by a reviewer against the study text.' });
    }
    const force = req.body?.force === true;
    const fullText = typeof req.body?.fullText === 'string' ? req.body.fullText : '';

    // Server-side text = linked screening record title/abstract (best-effort) +
    // client-supplied full text. No project data leaves the server.
    const rec = await resolveStudyText(a.projectId, a.studyId, req.user.id);
    const title = rec?.title || '';
    const abstract = rec?.abstract || '';

    const appraisal = appraiseFromText({ instrument, title, abstract, text: fullText });

    // SAFETY-CRITICAL: never overwrite a human answer. A row is a human answer when
    // aiSuggested !== true (upsertAnswers stamps aiSuggested=false on human edits;
    // legacy rows created before P14 have null → also treated as human). Unless
    // force, those questions are skipped entirely.
    const existing = await prisma.robAnswer.findMany({ where: { assessmentId: a.id } });
    const humanAnswered = new Set(existing.filter(x => x.aiSuggested !== true && x.response).map(x => x.questionId));

    let written = 0;
    let skipped = 0;
    for (const d of appraisal.domains) {
      for (const q of d.questions) {
        if (humanAnswered.has(q.questionId) && !force) { skipped += 1; continue; }
        const locator = q.evidenceLocator ? JSON.stringify(q.evidenceLocator) : null;
        const suggestion = {
          domainId: d.domainId,
          response: q.suggestedResponse,
          evidenceQuote: q.evidenceQuote || null,
          evidenceLocator: locator,
          rationale: q.rationale || null,
          aiSuggested: true,
          aiModel: 'pecan-rob-appraisal',
          aiModelVersion: ROB_APPRAISAL_VERSION,
          aiConfidence: q.confidence,
        };
        await prisma.robAnswer.upsert({
          where: { assessmentId_questionId: { assessmentId: a.id, questionId: q.questionId } },
          update: suggestion,
          create: { assessmentId: a.id, questionId: q.questionId, ...suggestion },
        });
        written += 1;
      }
    }

    // Recompute PROPOSED judgements only (finalJudgment / overridden untouched).
    await recomputeAndPersist(a.id, instrument);
    await prisma.robAssessment.update({ where: { id: a.id }, data: { updatedAt: new Date() } });
    await audit(a.projectId, a.id, req.user, 'ROB_APPRAISE', {
      entityType: 'RobAssessment', entityId: a.id,
      details: {
        instrumentId: instrument.id, written, skipped, force,
        hasFullText: appraisal.coverage.hasFullText, textChars: appraisal.coverage.textChars,
        version: ROB_APPRAISAL_VERSION,
      },
    });
    return res.json({ appraisal, written, skipped, assessment: await buildView(a.id) });
  } catch (err) {
    console.error('[rob] appraiseAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/rob/projects/:projectId/rob-validation ───────────────────────────
// Gated behind `guidedRobAppraisal`. View access is enough. Measures agreement
// between the MACHINE-proposed per-domain judgement and the HUMAN judgement
// (finalJudgment — set only on override or finalise) for every assessment in the
// project, via weighted κ (robDomainAgreement). Agreement is STRICTLY SCOPED to
// one instrument (?instrumentId=RoB2|ROBINS-I, default RoB2) because the 3-level
// RoB2 scale and the 5-level ROBINS-I scale must NEVER be pooled into one κ.
// `?format=csv` returns a per-domain + overall summary CSV.
export async function robValidation(req, res) {
  try {
    if (!(await guidedAppraisalEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });

    const instrumentId = SUPPORTED_INSTRUMENTS.includes(String(req.query.instrumentId))
      ? String(req.query.instrumentId)
      : 'RoB2';
    const instrument = getInstrument(instrumentId);
    // 101.md §21/§26 — weighted κ needs an ORDINAL judgement scale. The NOS has none
    // (it has a star count), and there is no machine appraiser to compare against, so
    // this endpoint refuses rather than computing a κ over an empty category list.
    if (isStarInstrument(instrument)) {
      return res.status(400).json({ error: 'Machine-vs-human agreement is not defined for the Newcastle–Ottawa Scale, which has no ordinal judgement scale and no guided appraiser.' });
    }
    // Ordinal, severity-ASCENDING categories for weighted κ. Use the instrument's
    // explicit `judgmentOrder` when present (ROBINS-I: low<moderate<ni<serious<
    // critical — `ni` is NOT most-severe); RoB2's judgmentLevels order already IS
    // its severity order, so it falls back cleanly.
    const categories = instrument.judgmentOrder || instrument.judgmentLevels.map(l => l.value);

    const rows = await prisma.robAssessment.findMany({
      where: { projectId: req.params.projectId, deletedAt: null, instrumentId },
      include: { domainJudgments: true },
    });

    // One pair per (study, domain) where a machine proposal exists AND the human
    // made an EXPLICIT judgement (`overridden` = they actively set finalJudgment —
    // whether it agrees with or differs from the proposal). We deliberately EXCLUDE
    // non-overridden domains: `finaliseAssessment` auto-copies proposedJudgment into
    // finalJudgment for those, which would otherwise manufacture guaranteed-agreement
    // pairs and inflate κ. So this measures agreement over domains the reviewer
    // independently judged (see `n`), not auto-accepted defaults.
    const pairs = [];
    for (const a of rows) {
      for (const dj of a.domainJudgments) {
        const proposed = dj.proposedJudgment || '';
        const human = dj.finalJudgment || '';
        if (!proposed || !dj.overridden || !human) continue;
        pairs.push({ studyId: a.studyId, domainId: dj.domainId, a: proposed, b: human });
      }
    }

    const report = robDomainAgreement(pairs, { categories });

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      const esc = c => `"${String(c ?? '').replace(/"/g, '""')}"`;
      const lines = [['scope', 'domainId', 'n', 'kappa', 'agreementPct'].map(esc).join(',')];
      const ov = report.overall;
      lines.push(['overall', '', report.n, ov ? ov.kappa.toFixed(4) : '', (report.percentAgreement).toFixed(4)].map(esc).join(','));
      for (const d of report.byDomain) {
        lines.push(['domain', d.domainId, d.n, d.kappa != null ? d.kappa.toFixed(4) : '', d.agreementPct.toFixed(4)].map(esc).join(','));
      }
      return res.json({
        format: 'csv', filename: `rob-validation_${instrumentId}.csv`, mime: 'text/csv',
        content: lines.join('\n'),
      });
    }

    return res.json({
      instrumentId,
      categories,
      n: report.n,
      percentAgreement: report.percentAgreement,
      overall: report.overall,
      byDomain: report.byDomain,
      disagreements: report.disagreements,
      appraisalVersion: ROB_APPRAISAL_VERSION,
    });
  } catch (err) {
    console.error('[rob] robValidation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── 101.md §22 — project-level NOS interpretation thresholds ──────────────────
// Stored on the Project.data blob under `robNosThresholds`. There is deliberately
// no server default other than 'none': the Newcastle–Ottawa Scale defines NO
// quality threshold, so a project that has not chosen one reports the star profile
// and nothing else. `interpretNos` always stamps `official:false` + an attribution,
// so a configured threshold can never be presented as a NOS rule.

// GET /api/rob/projects/:projectId/nos-thresholds — view access is enough.
export async function getNosThresholds(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    return res.json({
      thresholds: coerceNosThresholds(access.project.robNosThresholds),
      modes: NOS_THRESHOLD_MODES,
      defaultMode: NOS_DEFAULT_THRESHOLD_MODE,
      maxStars: NOS_MAX_STARS,
      // Offered as an explicitly-attributed option, never as "the NOS threshold".
      ahrq: AHRQ_STANDARD,
      conventionalBands: NOS_CONVENTIONAL_BANDS,
      conventionalBandsNotice: NOS_CONVENTIONAL_BANDS_NOTICE,
      canEdit: access.canEdit,
    });
  } catch (err) {
    console.error('[rob] getNosThresholds error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PUT /api/rob/projects/:projectId/nos-thresholds — body { mode, bands?, label? }.
// Requires RoB edit rights. Written through mutateProjectBlob's compare-and-swap so
// a concurrent project save can never lose it (101.md §32).
export async function putNosThresholds(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You have read-only access to Risk of Bias for this project.' });

    const next = coerceNosThresholds(req.body);
    if (next.mode === 'custom' && !next.bands.length) {
      return res.status(400).json({ error: 'A project-defined interpretation needs at least one band of the form { max, level }, with max between 0 and 9.' });
    }
    let before = null;
    const out = await mutateProjectBlob(req.params.projectId, (data) => {
      before = coerceNosThresholds(data.robNosThresholds);
      // A no-op PUT must not bump the project autosave revision (101.md §2/§30 — a
      // change that changes nothing is not a material project change).
      if (JSON.stringify(before) === JSON.stringify(next)) return { result: { changed: false }, commit: false };
      data.robNosThresholds = next;
      return { result: { changed: true } };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });

    if (out.result.changed) {
      await audit(req.params.projectId, '', req.user, 'ROB_NOS_THRESHOLDS', {
        entityType: 'Project', entityId: req.params.projectId, details: { before, after: next },
      });
    }
    return res.json({
      thresholds: next,
      changed: !!out.result.changed,
      // Any project-defined banding gets the "this is your rule, not the NOS's" notice.
      notice: next.mode === 'custom' ? NOS_CONVENTIONAL_BANDS_NOTICE : '',
    });
  } catch (err) {
    console.error('[rob] putNosThresholds error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── 101.md §25 — dual reviewer + consensus ────────────────────────────────────

/**
 * Compare the INDEPENDENT reviewer assessments of one study under ONE instrument.
 *
 * Two rows sharing (projectId, studyId, instrumentId) with different reviewerId
 * are the two independent assessments; the reconciled record is the row whose
 * status is 'consensus' and it is excluded from the comparison (it is the OUTPUT
 * of reconciliation, not an input to it).
 *
 * A disagreement is a question that at least two reviewers ANSWERED and on which
 * they chose different option values. A question only one reviewer has reached is
 * incomplete, not a disagreement — reporting it as one would overstate discord
 * (101.md §17). Comparison is order-insensitive for the additive Comparability
 * item, so ['b','a'] and ['a','b'] agree.
 *
 * @param {object} instrument
 * @param {Array<{id,reviewerId,reviewerName,status,answersByDomain}>} rows
 * Pure.
 */
export function reviewerComparison(instrument, rows = []) {
  const star = isStarInstrument(instrument);
  const all = Array.isArray(rows) ? rows : [];
  const consensusRow = all.find(r => r && r.status === CONSENSUS_STATUS) || null;
  const independent = all.filter(r => r && r !== consensusRow);

  const shape = (r) => {
    if (!r) return null;
    const abd = r.answersByDomain || {};
    const out = {
      assessmentId: r.id,
      reviewerId: r.reviewerId || '',
      reviewerName: r.reviewerName || '',
      status: r.status || 'draft',
      completeness: engineCompleteness(instrument, { answersByDomain: abd }).overall,
      score: null,
    };
    if (star) {
      const s = nosScoreAssessment(instrument, abd);
      out.score = {
        total: s.total, maxStars: s.maxStars, profile: s.profile, complete: s.complete,
        byDomain: Object.fromEntries(instrument.domains.map(d => [d.id, s.byDomain[d.id].stars])),
      };
    }
    return out;
  };

  // Comparison key: sorted so option ORDER never manufactures a disagreement.
  const keyOf = (vals) => vals.slice().sort().join('+');

  const disagreements = [];
  let compared = 0;
  for (const d of instrument.domains) {
    for (const q of d.questions) {
      const values = {};
      const keys = [];
      for (const r of independent) {
        const raw = (r.answersByDomain && r.answersByDomain[d.id]) ? r.answersByDomain[d.id][q.id] : undefined;
        const vals = nosSelectedValues(raw);
        if (!vals.length) continue;
        values[r.reviewerId || r.id] = vals.length === 1 ? vals[0] : vals;
        keys.push(keyOf(vals));
      }
      if (keys.length < 2) continue;
      compared += 1;
      if (new Set(keys).size > 1) {
        disagreements.push({
          domainId: d.id,
          domainName: d.name,
          questionId: q.id,
          questionText: q.text,
          select: q.select || 'one',
          values,
        });
      }
    }
  }

  return {
    reviewers: independent.map(shape),
    disagreements,
    consensus: shape(consensusRow),
    agreement: {
      comparedQuestions: compared,
      agreedQuestions: compared - disagreements.length,
      disagreedQuestions: disagreements.length,
      // Null (not 1) when nothing has been compared yet — a study nobody has
      // double-assessed has no agreement, rather than perfect agreement.
      percentAgreement: compared ? (compared - disagreements.length) / compared : null,
    },
  };
}

// GET /api/rob/projects/:projectId/studies/:studyId/reviewers[?instrumentId=] ──
// The dual-reviewer view for one study: each independent reviewer's assessment,
// the per-question disagreements between them, and the consensus row if one exists.
// Read-only — this endpoint NEVER writes, so it can never overwrite a reviewer's
// judgement. View access is enough.
export async function getStudyReviewers(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });

    const wanted = String(req.query.instrumentId || '');
    const scopedId = SUPPORTED_INSTRUMENTS.includes(wanted) ? wanted : null;
    const rows = await prisma.robAssessment.findMany({
      where: {
        projectId: req.params.projectId,
        studyId: req.params.studyId,
        deletedAt: null,
        ...(scopedId ? { instrumentId: scopedId } : {}),
      },
      include: { answers: true, domainJudgments: true, overall: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!rows.length) {
      return res.json({
        studyId: req.params.studyId,
        instrumentId: scopedId,
        instrumentLabel: scopedId ? (getRobTool(scopedId)?.label || scopedId) : '',
        reviewers: [], disagreements: [], consensus: null,
        agreement: { comparedQuestions: 0, agreedQuestions: 0, disagreedQuestions: 0, percentAgreement: null },
        instrumentIds: [],
      });
    }

    // Comparison is STRICTLY scoped to one instrument — a RoB 2 row and a NOS row
    // answer different questions entirely, so pooling them would be meaningless.
    const instrumentIds = [...new Set(rows.map(r => r.instrumentId || 'RoB2'))];
    const useId = scopedId || (SUPPORTED_INSTRUMENTS.includes(instrumentIds[0]) ? instrumentIds[0] : 'RoB2');
    const inst = getInstrument(useId);
    const scoped = rows.filter(r => (r.instrumentId || 'RoB2') === useId);

    const cmp = reviewerComparison(inst, scoped.map(r => ({
      id: r.id,
      reviewerId: r.reviewerId,
      reviewerName: r.reviewerName,
      status: r.status,
      answersByDomain: answersByDomainFrom(inst, r.answers),
    })));

    return res.json({
      studyId: req.params.studyId,
      instrumentId: inst.id,
      instrumentLabel: getRobTool(inst.id)?.label || inst.id,
      scoring: isStarInstrument(inst) ? 'stars' : 'judgment',
      maxStars: isStarInstrument(inst) ? inst.maxStars : null,
      // Surfaced so a UI can warn that this study also carries assessments under a
      // different instrument rather than silently hiding them.
      instrumentIds,
      ...cmp,
    });
  } catch (err) {
    console.error('[rob] getStudyReviewers error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /api/rob/projects/:projectId/studies/:studyId/consensus ────────────────
// Body: { instrumentId, outcomeId?, resultLabel?, seedFromAssessmentId? }
// Creates the THIRD, reconciled assessment row (status 'consensus'). It requires
// two genuinely independent reviewer assessments to already exist — a "consensus"
// with nothing to reconcile would be a fabricated methodological claim (101.md §17).
// Seeding COPIES a reviewer's answers into the NEW row; the source row is read and
// never written to (§25 — never silently overwrite one reviewer with the other).
export async function createConsensusAssessment(req, res) {
  try {
    if (!(await robEnabled(req.user))) return res.status(404).json({ error: 'Not found' });
    const access = await resolveRobAccess(req.params.projectId, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You have read-only access to Risk of Bias for this project.' });

    const { instrumentId, outcomeId, resultLabel, seedFromAssessmentId } = req.body || {};
    const wantId = instrumentId ? String(instrumentId) : '';
    if (!SUPPORTED_INSTRUMENTS.includes(wantId)) {
      return res.status(400).json({ error: `instrumentId must be one of: ${SUPPORTED_INSTRUMENTS.join(', ')}` });
    }
    const instrument = getInstrument(wantId);

    const existing = await prisma.robAssessment.findMany({
      where: { projectId: req.params.projectId, studyId: req.params.studyId, instrumentId: wantId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const already = existing.find(r => r.status === CONSENSUS_STATUS);
    if (already) {
      return res.status(409).json({ error: 'A consensus assessment already exists for this study.', assessmentId: already.id });
    }
    const independent = existing.filter(r => r.status !== CONSENSUS_STATUS);
    const reviewerIds = [...new Set(independent.map(r => r.reviewerId || '').filter(Boolean))];
    if (reviewerIds.length < 2) {
      return res.status(409).json({
        error: 'A consensus record requires two independent reviewer assessments of this study.',
        reviewerCount: reviewerIds.length,
      });
    }

    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, email: true } });
    const row = await prisma.robAssessment.create({
      data: {
        projectId: req.params.projectId,
        studyId: req.params.studyId,
        outcomeId: outcomeId ? String(outcomeId) : (independent[0].outcomeId || null),
        resultLabel: resultLabel ? String(resultLabel).slice(0, 300) : (independent[0].resultLabel || null),
        instrumentId: instrument.id,
        instrumentVersion: instrument.instrumentVersion,
        variant: instrument.variant,
        reviewerId: req.user.id,
        reviewerName: me?.name || me?.email || '',
        status: CONSENSUS_STATUS,
      },
    });

    // Optional seed: copy one reviewer's answers into the NEW row so reconciliation
    // starts from a real assessment rather than a blank form.
    let seededFrom = null;
    if (seedFromAssessmentId) {
      const src = independent.find(r => r.id === String(seedFromAssessmentId));
      if (!src) return res.status(400).json({ error: 'seedFromAssessmentId must be one of the reviewer assessments for this study.' });
      const answers = await prisma.robAnswer.findMany({ where: { assessmentId: src.id } });
      for (const ans of answers) {
        await prisma.robAnswer.create({
          data: {
            assessmentId: row.id,
            domainId: ans.domainId,
            questionId: ans.questionId,
            response: ans.response,
            rationale: ans.rationale || null,
            evidenceQuote: ans.evidenceQuote || null,
            evidenceLocator: ans.evidenceLocator || null,
            // A copied answer is a human starting point for reconciliation, and it
            // carries no machine-suggestion provenance forward.
            aiSuggested: false,
          },
        });
      }
      seededFrom = { assessmentId: src.id, reviewerId: src.reviewerId, answerCount: answers.length };
    }

    await recomputeAndPersist(row.id, instrument);
    await audit(req.params.projectId, row.id, { ...req.user, name: me?.name }, 'ROB_CONSENSUS_CREATE', {
      entityType: 'RobAssessment', entityId: row.id,
      details: { studyId: req.params.studyId, instrumentId: instrument.id, reviewerIds, seededFrom },
    });
    return res.status(201).json({ assessment: await buildView(row.id), seededFrom });
  } catch (err) {
    console.error('[rob] createConsensusAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
