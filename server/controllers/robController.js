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
import { getById as getOwnedProject } from '../store.js';
import { getRobMemberAccess } from '../screening/metalabAccess.js';
import { canMutateAssessment, normaliseScreeningStudy, normaliseManualStudy } from './robAccess.js';
import { getRobTool } from '../../src/research-engine/rob/tools.js';
import {
  getInstrument,
  proposeDomain,
  proposeAllDomains,
  proposeOverall,
  completeness as engineCompleteness,
  summaryMatrix,
  RESPONSES,
} from '../../src/research-engine/rob/index.js';

const INSTRUMENT = getInstrument('RoB2');
const VALID_RESPONSES = new Set(RESPONSES);
const VALID_JUDGMENTS = new Set(['low', 'some', 'high']);
const QUESTION_DOMAIN = (() => {
  const map = {};
  for (const d of INSTRUMENT.domains) for (const q of d.questions) map[q.id] = d.id;
  return map;
})();

// ── Feature flag ──────────────────────────────────────────────────────────────
// Default OFF: enabled ONLY when featureFlags.rob_engine_v2 === true. Missing /
// malformed flags → disabled (the opposite of the "missing = on" defaults used by
// long-standing features, because this one ships dark until the gate passes).
async function robEnabled() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
    if (!row) return false;
    const flags = JSON.parse(row.value || '{}');
    return flags.rob_engine_v2 === true;
  } catch {
    return false;
  }
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
function answersByDomainFrom(answers) {
  const out = {};
  for (const d of INSTRUMENT.domains) out[d.id] = {};
  for (const ans of answers) {
    if (!out[ans.domainId]) out[ans.domainId] = {};
    out[ans.domainId][ans.questionId] = ans.response;
  }
  return out;
}

/**
 * Recompute every PROPOSED judgement from the current answers and persist them,
 * PRESERVING any human override (final + overridden). Returns the fresh proposals.
 */
async function recomputeAndPersist(assessmentId) {
  const answers = await prisma.robAnswer.findMany({ where: { assessmentId } });
  const abd = answersByDomainFrom(answers);
  const proposals = proposeAllDomains(INSTRUMENT, abd); // { D1:{judgment,reasons}, ... }

  // Upsert each domain's proposedJudgment (final/overridden untouched).
  for (const d of INSTRUMENT.domains) {
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
  const overall = proposeOverall(INSTRUMENT, resolvedByDomain);
  await prisma.robOverall.upsert({
    where: { assessmentId },
    update: { proposedOverall: overall.judgment, multiSomeConcernsFlag: overall.multiSomeConcernsFlag },
    create: { assessmentId, proposedOverall: overall.judgment, multiSomeConcernsFlag: overall.multiSomeConcernsFlag },
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
  const abd = answersByDomainFrom(a.answers);

  const djByDomain = {};
  for (const dj of a.domainJudgments) djByDomain[dj.domainId] = dj;

  const domains = INSTRUMENT.domains.map(d => {
    const dj = djByDomain[d.id] || { proposedJudgment: '', finalJudgment: null, overridden: false, overrideJustification: null };
    const prop = proposeDomain(INSTRUMENT, d.id, abd[d.id] || {});
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
  const overallProp = proposeOverall(INSTRUMENT, resolvedByDomain);
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

  const comp = engineCompleteness(INSTRUMENT, { answersByDomain: abd });

  return {
    id: a.id,
    projectId: a.projectId,
    studyId: a.studyId,
    outcomeId: a.outcomeId,
    resultLabel: a.resultLabel,
    instrumentId: a.instrumentId,
    instrumentVersion: a.instrumentVersion,
    instrumentLabel: getRobTool(a.instrumentId)?.label || a.instrumentId || 'Tool unknown', // prompt46 #5 — human tool label (e.g. "RoB 2")
    instrumentName: INSTRUMENT.name,
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
    })),
    domains,
    overall,
    completeness: comp,
  };
}

// ── GET /api/rob/instruments/rob2 ─────────────────────────────────────────────
export async function getRobInstrument(req, res) {
  if (!(await robEnabled())) return res.status(404).json({ error: 'Not found' });
  return res.json({ instrument: INSTRUMENT });
}

// ── POST /api/rob/assessments ─────────────────────────────────────────────────
export async function createAssessment(req, res) {
  try {
    if (!(await robEnabled())) return res.status(404).json({ error: 'Not found' });
    const { projectId, studyId, outcomeId, resultLabel } = req.body || {};
    if (!projectId || !studyId) {
      return res.status(400).json({ error: 'projectId and studyId are required' });
    }
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
        reviewerId: req.user.id,
        reviewerName: me?.name || me?.email || '',
        status: 'draft',
      },
    });
    await recomputeAndPersist(a.id); // initialise provisional proposals
    await audit(projectId, a.id, { ...req.user, name: me?.name }, 'ROB_CREATE', {
      entityType: 'RobAssessment', entityId: a.id, details: { studyId, outcomeId: outcomeId || null },
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
    if (!(await robEnabled())) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    // prompt46 #3 — surface per-assessment mutate permission so the UI disables
    // edit/delete for non-creators (the server still enforces it on every write).
    const view = await buildView(a.id);
    view.canMutate = canMutateAssessment(a, permsFor(a), req.user.id);
    return res.json({ assessment: view, instrument: INSTRUMENT });
  } catch (err) {
    console.error('[rob] getAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/rob/projects/:projectId/assessments ──────────────────────────────
export async function listProjectAssessments(req, res) {
  try {
    if (!(await robEnabled())) return res.status(404).json({ error: 'Not found' });
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

    const matrix = summaryMatrix(
      assessments.map(a => ({ id: a.id, label: a.label, domainJudgments: a.domainJudgments, overall: a.overall })),
      INSTRUMENT,
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
    if (!(await robEnabled())) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can modify or delete this assessment.' });
    if (a.status === 'complete') return res.status(409).json({ error: 'Assessment is finalised; re-open to edit' });

    const list = Array.isArray(req.body?.answers) ? req.body.answers : null;
    if (!list || list.length === 0) return res.status(400).json({ error: 'answers[] is required' });

    for (const item of list) {
      const questionId = String(item.questionId || '');
      const domainId = QUESTION_DOMAIN[questionId];
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
        },
        create: {
          assessmentId: a.id, domainId, questionId, response,
          rationale: item.rationale != null ? String(item.rationale).slice(0, 4000) : null,
          evidenceQuote: item.evidenceQuote != null ? String(item.evidenceQuote).slice(0, 4000) : null,
          evidenceLocator: item.evidenceLocator != null ? String(item.evidenceLocator).slice(0, 500) : null,
        },
      });
    }
    await recomputeAndPersist(a.id);
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
    if (!(await robEnabled())) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!canMutateAssessment(a, permsFor(a), req.user.id)) return res.status(403).json({ error: 'Only the assessment creator, a project leader, or the owner can modify or delete this assessment.' });
    // A finalised assessment is locked — overriding must go through reopen first
    // (mirrors upsertAnswers; without this the finalise lock is defeated).
    if (a.status === 'complete') return res.status(409).json({ error: 'Assessment is finalised; re-open to edit' });

    const { target, domainId, finalJudgment, justification, clear } = req.body || {};
    const wantClear = clear === true || finalJudgment == null || finalJudgment === '';

    if (!wantClear) {
      if (!VALID_JUDGMENTS.has(finalJudgment)) {
        return res.status(400).json({ error: "finalJudgment must be 'low', 'some', or 'high'" });
      }
      if (typeof justification !== 'string' || !justification.trim()) {
        return res.status(400).json({ error: 'A justification is required to override the algorithm' });
      }
    }

    if (target === 'domain') {
      if (!domainId || !INSTRUMENT.domains.some(d => d.id === domainId)) {
        return res.status(400).json({ error: `Unknown domainId: ${domainId}` });
      }
      await prisma.robDomainJudgment.upsert({
        where: { assessmentId_domainId: { assessmentId: a.id, domainId } },
        update: wantClear
          ? { overridden: false, finalJudgment: null, overrideJustification: null }
          : { overridden: true, finalJudgment, overrideJustification: justification.trim().slice(0, 4000) },
        create: wantClear
          ? { assessmentId: a.id, domainId, proposedJudgment: proposeDomain(INSTRUMENT, domainId, {}).judgment }
          : { assessmentId: a.id, domainId, proposedJudgment: proposeDomain(INSTRUMENT, domainId, {}).judgment, overridden: true, finalJudgment, overrideJustification: justification.trim().slice(0, 4000) },
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

    await recomputeAndPersist(a.id); // overall reflects override-aware resolved domains
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
    if (!(await robEnabled())) return res.status(404).json({ error: 'Not found' });
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
    if (!(await robEnabled())) return res.status(404).json({ error: 'Not found' });
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
    if (!(await robEnabled())) return res.status(404).json({ error: 'Not found' });
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
  try {
    if (!(await robEnabled())) return res.status(404).json({ error: 'Not found' });
    const a = await loadAssessment(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    const view = await buildView(a.id);
    const format = String(req.query.format || 'json').toLowerCase();
    const base = `rob2_${a.studyId}${a.resultLabel ? '_' + a.resultLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : ''}`;

    if (format === 'json') {
      return res.json({ format, filename: `${base}.json`, mime: 'application/json', content: view });
    }
    if (format === 'csv') {
      const rows = [['domain', 'questionId', 'response', 'rationale', 'proposed', 'final']];
      for (const d of view.domains) {
        const ans = view.answersByDomain[d.domainId] || {};
        const meta = view.answerMeta.filter(m => m.domainId === d.domainId);
        const qids = INSTRUMENT.domains.find(x => x.id === d.domainId).questions.map(q => q.id);
        for (const qid of qids) {
          const m = meta.find(x => x.questionId === qid);
          rows.push([d.domainId, qid, ans[qid] || '', (m?.rationale || '').replace(/\s+/g, ' '), d.proposedJudgment, d.resolvedJudgment]);
        }
      }
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      return res.json({ format, filename: `${base}.csv`, mime: 'text/csv', content: csv });
    }
    if (format === 'robvis') {
      // robvis "data" CSV: Study, D1..D5, Overall, Weight (one row).
      const header = ['Study', ...INSTRUMENT.domains.map(d => d.id), 'Overall', 'Weight'];
      const judgeChar = j => ({ low: 'Low', some: 'Some concerns', high: 'High' }[j] || 'No information');
      const row = [
        view.resultLabel || view.studyId,
        ...view.domains.map(d => judgeChar(d.resolvedJudgment)),
        judgeChar(view.overall.resolvedOverall),
        '1',
      ];
      const csv = [header, row].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      return res.json({ format, filename: `${base}_robvis.csv`, mime: 'text/csv', content: csv });
    }
    return res.status(400).json({ error: "format must be 'json', 'csv', or 'robvis'" });
  } catch (err) {
    console.error('[rob] exportAssessment error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/rob/projects/:projectId/studies (merged study universe) ───────────
// prompt46 #4 — screening/extraction-derived studies + RoB-local manual studies,
// each tagged with `source` ('screening' | 'manual'). View access is enough.
export async function listStudyUniverse(req, res) {
  try {
    if (!(await robEnabled())) return res.status(404).json({ error: 'Not found' });
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
    if (!(await robEnabled())) return res.status(404).json({ error: 'Not found' });
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
    if (!(await robEnabled())) return res.status(404).json({ error: 'Not found' });
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
