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
import { getById as getOwnedProject, touchProjectActivity } from '../store.js';
import { getRobMemberAccess } from '../screening/metalabAccess.js';
import { featureAccess } from '../services/featureAccess.js';
import { canMutateAssessment, normaliseScreeningStudy, normaliseManualStudy } from './robAccess.js';
import { getRobTool } from '../../src/research-engine/rob/tools.js';
import { sendTierLimit } from '../services/entitlementService.js';
import { requireProjectExport, settleProjectExport, EXPORT_TYPES } from '../services/projectExportGuard.js';
import {
  getInstrument,
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
} from '../../src/research-engine/rob/index.js';

// ── Instrument awareness (P14) ────────────────────────────────────────────────
// The RoB service was hardcoded to RoB2. It is now instrument-aware: each
// assessment carries its own `instrumentId` (RoB2 | ROBINS-I) and every judgement
// path derives its instrument + valid judgement set + question→domain map from
// THAT instrument. Responses (Y/PY/PN/N/NI/NA) are identical across instruments,
// so VALID_RESPONSES stays shared. The RoB2 path is byte-identical to before.
const VALID_RESPONSES = new Set(RESPONSES);
const SUPPORTED_INSTRUMENTS = ['RoB2', 'ROBINS-I'];

/** The instrument for a loaded assessment (defaults to RoB2 → unchanged path). */
function instrumentFor(a) {
  return getInstrument((a && a.instrumentId) || 'RoB2');
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

/** Group flat RobAnswer rows into { [domainId]: { [questionId]: response } }. */
function answersByDomainFrom(instrument, answers) {
  const out = {};
  for (const d of instrument.domains) out[d.id] = {};
  for (const ans of answers) {
    if (!out[ans.domainId]) out[ans.domainId] = {};
    out[ans.domainId][ans.questionId] = ans.response;
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

  // Upsert each domain's proposedJudgment (final/overridden untouched).
  for (const d of instrument.domains) {
    const proposed = proposals[d.id].judgment;
    await prisma.robDomainJudgment.upsert({
      where: { assessmentId_domainId: { assessmentId, domainId: d.id } },
      update: { proposedJudgment: proposed },
      create: { assessmentId, domainId: d.id, proposedJudgment: proposed },
    });
  }

  // Overall is computed from the RESOLVED domain judgements (override-aware).
  const djs = await prisma.robDomainJudgment.findMany({ where: { assessmentId } });
  const resolvedByDomain = {};
  for (const dj of djs) resolvedByDomain[dj.domainId] = resolvedDomain(dj);
  const overall = proposeOverall(instrument, resolvedByDomain);
  // multiSomeConcernsFlag is RoB2-specific; ROBINS-I overall returns no such flag →
  // coerce to a real boolean (false) so the non-nullable column is always set.
  const multiFlag = !!overall.multiSomeConcernsFlag;
  await prisma.robOverall.upsert({
    where: { assessmentId },
    update: { proposedOverall: overall.judgment, multiSomeConcernsFlag: multiFlag },
    create: { assessmentId, proposedOverall: overall.judgment, multiSomeConcernsFlag: multiFlag },
  });

  return { proposals, overall };
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
  const abd = answersByDomainFrom(inst, a.answers);

  const djByDomain = {};
  for (const dj of a.domainJudgments) djByDomain[dj.domainId] = dj;

  const domains = inst.domains.map(d => {
    const dj = djByDomain[d.id] || { proposedJudgment: '', finalJudgment: null, overridden: false, overrideJustification: null };
    const prop = proposeDomain(inst, d.id, abd[d.id] || {});
    return {
      domainId: d.id,
      proposedJudgment: prop.judgment,
      reasons: prop.reasons,
      finalJudgment: dj.finalJudgment || null,
      overridden: !!dj.overridden,
      overrideJustification: dj.overrideJustification || null,
      resolvedJudgment: (dj.overridden && dj.finalJudgment) ? dj.finalJudgment : prop.judgment,
    };
  });

  const resolvedByDomain = {};
  for (const d of domains) resolvedByDomain[d.domainId] = d.resolvedJudgment;
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

  const comp = engineCompleteness(inst, { answersByDomain: abd });

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
  };
}

// ── GET /api/rob/instruments/:id  (rob2 | robins-i) ───────────────────────────
// Serves the serialisable instrument definition for a data-driven UI. `/rob2`
// keeps working (RoB2 default); `/robins-i` serves the 7-domain, 5-level tool.
const INSTRUMENT_URL_IDS = { rob2: 'RoB2', 'robins-i': 'ROBINS-I', robinsi: 'ROBINS-I' };
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
    // Instrument selection (P14): RoB2 (default, unchanged) or ROBINS-I. Any other
    // value is rejected rather than silently coerced (an unsupported tool must never
    // be stored). The version + variant are taken from the instrument definition.
    const wantInstrumentId = instrumentId ? String(instrumentId) : 'RoB2';
    if (!SUPPORTED_INSTRUMENTS.includes(wantInstrumentId)) {
      return res.status(400).json({ error: `instrumentId must be one of: ${SUPPORTED_INSTRUMENTS.join(', ')}` });
    }
    // Any non-RoB2 instrument (ROBINS-I) is part of the guided-appraisal feature, so
    // it may only be created when `guidedRobAppraisal` is ON. With the flag OFF the
    // workspace stays RoB2-only exactly as before (a stray ROBINS-I request → 400).
    if (wantInstrumentId !== 'RoB2' && !(await guidedAppraisalEnabled(req.user))) {
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
      return {
        id: a.id, studyId: a.studyId, resultLabel: a.resultLabel, status: a.status, label, domainJudgments: dj, overall,
        // prompt46 #3/#5 — creator + tool surfaced to the list UI.
        reviewerId: a.reviewerId, reviewerName: a.reviewerName,
        instrumentId: a.instrumentId,
        instrumentLabel: getRobTool(a.instrumentId)?.label || a.instrumentId || 'Tool unknown',
        // prompt46 #4 — study source ('manual' studies are visually distinct).
        source: st ? st.source : 'screening',
        // prompt46 #3 — per-row mutate permission for disabling edit/delete in the UI.
        canMutate: canMutateAssessment(a, { canEdit: access.canEdit, isOwner: access.isOwner, role: access.role }, req.user.id),
      };
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
    const questionDomain = questionDomainMap(instrument);
    for (const item of list) {
      const questionId = String(item.questionId || '');
      const domainId = questionDomain[questionId];
      if (!domainId) return res.status(400).json({ error: `Unknown questionId: ${questionId}` });
      const response = String(item.response || '');
      if (!VALID_RESPONSES.has(response)) return res.status(400).json({ error: `Invalid response for ${questionId}: ${response}` });
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
    const validJ = validJudgments(instrument);
    const { target, domainId, finalJudgment, justification, clear } = req.body || {};
    const wantClear = clear === true || finalJudgment == null || finalJudgment === '';

    if (!wantClear) {
      if (!validJ.has(finalJudgment)) {
        return res.status(400).json({ error: `finalJudgment must be one of: ${[...validJ].join(', ')}` });
      }
      if (typeof justification !== 'string' || !justification.trim()) {
        return res.status(400).json({ error: 'A justification is required to override the algorithm' });
      }
    }

    if (target === 'domain') {
      if (!domainId || !instrument.domains.some(d => d.id === domainId)) {
        return res.status(400).json({ error: `Unknown domainId: ${domainId}` });
      }
      await prisma.robDomainJudgment.upsert({
        where: { assessmentId_domainId: { assessmentId: a.id, domainId } },
        update: wantClear
          ? { overridden: false, finalJudgment: null, overrideJustification: null }
          : { overridden: true, finalJudgment, overrideJustification: justification.trim().slice(0, 4000) },
        create: wantClear
          ? { assessmentId: a.id, domainId, proposedJudgment: proposeDomain(instrument, domainId, {}).judgment }
          : { assessmentId: a.id, domainId, proposedJudgment: proposeDomain(instrument, domainId, {}).judgment, overridden: true, finalJudgment, overrideJustification: justification.trim().slice(0, 4000) },
      });
    } else if (target === 'overall') {
      await prisma.robOverall.upsert({
        where: { assessmentId: a.id },
        update: wantClear
          ? { overridden: false, finalOverall: null, overrideJustification: null }
          : { overridden: true, finalOverall: finalJudgment, overrideJustification: justification.trim().slice(0, 4000) },
        create: wantClear
          ? { assessmentId: a.id }
          : { assessmentId: a.id, overridden: true, finalOverall: finalJudgment, overrideJustification: justification.trim().slice(0, 4000) },
      });
    } else {
      return res.status(400).json({ error: "target must be 'domain' or 'overall'" });
    }

    await recomputeAndPersist(a.id, instrument); // overall reflects override-aware resolved domains
    await audit(a.projectId, a.id, req.user, 'ROB_OVERRIDE', {
      entityType: target === 'domain' ? 'RobDomainJudgment' : 'RobOverall',
      entityId: a.id,
      details: { target, domainId: domainId || null, finalJudgment: wantClear ? null : finalJudgment, cleared: wantClear },
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

    const view = await buildView(a.id);
    if (!view.completeness.overall.complete) {
      return res.status(400).json({ error: 'Assessment is incomplete', completeness: view.completeness });
    }
    // Lock in final = resolved for every domain + overall.
    for (const d of view.domains) {
      await prisma.robDomainJudgment.update({
        where: { assessmentId_domainId: { assessmentId: a.id, domainId: d.domainId } },
        data: { finalJudgment: d.resolvedJudgment },
      });
    }
    await prisma.robOverall.update({
      where: { assessmentId: a.id },
      data: { finalOverall: view.overall.resolvedOverall },
    });
    await prisma.robAssessment.update({ where: { id: a.id }, data: { status: 'complete' } });
    await audit(a.projectId, a.id, req.user, 'ROB_FINALISE', { entityType: 'RobAssessment', entityId: a.id, details: { overall: view.overall.resolvedOverall } });
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
    await prisma.robDomainJudgment.updateMany({ where: { assessmentId: a.id, overridden: false }, data: { finalJudgment: null } });
    await prisma.robOverall.updateMany({ where: { assessmentId: a.id, overridden: false }, data: { finalOverall: null } });
    await prisma.robAssessment.update({ where: { id: a.id }, data: { status: 'draft' } });
    await audit(a.projectId, a.id, req.user, 'ROB_REOPEN', { entityType: 'RobAssessment', entityId: a.id });
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
    // 79.md §3 — RoB assessment export is a project export: Free tier is blocked and
    // permitted tiers consume one unit of the monthly allowance. Reserved once here,
    // after the format is known to be valid, and confirmed on the successful return.
    try {
      reservation = await requireProjectExport(req.user, {
        exportType: EXPORT_TYPES.ROB_ASSESSMENT, projectId: a.projectId || null, format,
      });
    } catch (e) { if (sendTierLimit(res, e)) return; throw e; }
    const filePrefix = inst.id === 'RoB2' ? 'rob2' : 'robins-i';
    const base = `${filePrefix}_${a.studyId}${a.resultLabel ? '_' + a.resultLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : ''}`;

    if (format === 'json') {
      settleProjectExport(reservation.reservationId, { status: 'succeeded' });
      return res.json({ format, filename: `${base}.json`, mime: 'application/json', content: view });
    }
    if (format === 'csv') {
      const rows = [['domain', 'questionId', 'response', 'rationale', 'proposed', 'final']];
      for (const d of view.domains) {
        const ans = view.answersByDomain[d.domainId] || {};
        const meta = view.answerMeta.filter(m => m.domainId === d.domainId);
        const qids = inst.domains.find(x => x.id === d.domainId).questions.map(q => q.id);
        for (const qid of qids) {
          const m = meta.find(x => x.questionId === qid);
          rows.push([d.domainId, qid, ans[qid] || '', (m?.rationale || '').replace(/\s+/g, ' '), d.proposedJudgment, d.resolvedJudgment]);
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
