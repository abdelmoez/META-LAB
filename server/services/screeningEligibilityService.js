/**
 * screeningEligibilityService.js — server adapter for P10 "Criteria-based eligibility
 * screening" (feature flag: `eligibilityScreening`, default OFF).
 *
 * A project defines an ordered, VERSIONED set of inclusion/exclusion criteria. The pure,
 * deterministic engine (src/research-engine/screening/ai — evaluateEligibility) answers
 * each criterion per record (yes/no/unclear + confidence + evidence quote) and proposes
 * include/exclude/unclear. This adapter loads records + criteria from Prisma, calls the
 * engine, persists an EligibilityAssessment (with full provenance), and — ONLY under an
 * explicit, governed policy — auto-applies the suggestion as a ScreenDecision.
 *
 * SAFETY INVARIANTS:
 *   - The engine never *finalises* a human decision. Auto-apply is doubly gated (project
 *     opt-in AND global policy, plus a confidence floor and the global killSwitch) and can
 *     NEVER overwrite a human ScreenDecision — it writes under a dedicated system reviewer
 *     id, and it is skipped entirely when a human has already settled the record.
 *   - Everything is reviewable, reversible (undo), and traceable (audit + assessment
 *     provenance: engineVersion, configVersion, criteriaVersion, timestamp, confidence).
 *
 * The engine surface is imported as a NAMESPACE so a missing export (e.g. before the engine
 * agent lands `evaluateEligibility`) degrades to a controlled 503 instead of crashing the
 * whole screening router at import time.
 */
import { prisma } from '../db/client.js';
import { writeAudit } from '../screening/access.js';
import { emitToProjectMembers } from '../realtime/bus.js';
import { featureAccess } from './featureAccess.js';
import { syncConflicts, CONFLICT_STAGE } from './screeningConflictService.js';
import { touchProjectActivity } from '../store.js';
import * as screeningEngine from '../../src/research-engine/screening/ai/index.js';

export const ELIGIBILITY_FLAG_KEY = 'eligibilityScreening';
export const ELIGIBILITY_SETTINGS_KEY = 'eligibilityScreeningSettings';
export const DEFAULT_STAGE = 'title_abstract';
/** Stable, non-human reviewer identity for governed auto-applied decisions, so an
 *  auto-apply can NEVER share a row with (and therefore never overwrite) a human. */
export const ELIGIBILITY_ENGINE_REVIEWER_ID = 'eligibility-engine';
export const ELIGIBILITY_ENGINE_REVIEWER_NAME = 'Eligibility screening (automated)';
/** Config-version tag recorded on each assessment for provenance (the engine may return
 *  its own richer version; this is the adapter-side fallback). */
const CONFIG_VERSION = 'p10-cfg-1';
const INLINE_MAX_FALLBACK = 25;

/** Global (admin) eligibility policy defaults — merged under the stored SiteSetting. */
export const ELIGIBILITY_GLOBAL_DEFAULTS = Object.freeze({
  enabled: true,                          // master switch WITHIN the feature flag
  defaultPolicy: 'assist',                // assist (suggest only) | auto (governed auto-apply)
  includeConfidence: 0.85,                // min decisionConfidence to auto-apply an INCLUDE
  excludeConfidence: 0.85,                // min decisionConfidence to auto-apply an EXCLUDE
  autoApplyRequiresNoHumanDecision: true, // never auto-apply over a human decision
  maxRecordsPerRun: 5000,
  inlineMaxRecords: INLINE_MAX_FALLBACK,  // scopes at/under this size may evaluate inline
  killSwitch: false,                      // emergency global disable of governed auto-apply
});

/** Per-project eligibility policy defaults (stored on EligibilityProjectSetting.settingsJson). */
export const ELIGIBILITY_PROJECT_DEFAULTS = Object.freeze({
  enabled: true,      // project opt-in (within the global + flag)
  policy: 'assist',   // assist | auto
});

function safeParse(s, fallback) {
  try { const v = JSON.parse(s ?? ''); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}
function safeArray(s) {
  try { const v = JSON.parse(s ?? '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function clamp01(n) { return Math.min(1, Math.max(0, n)); }

// ── Feature flag + global/project policy ─────────────────────────────────────

/**
 * Whether the `eligibilityScreening` feature flag is on (best-effort; fail-closed).
 * 75.md Phase 7 — routed through the central seam. A gate passes `req.user` so admins
 * keep the feature usable while it is globally OFF; no user = plain flag state.
 */
export async function eligibilityFlagEnabled(user = null) {
  return (await featureAccess(ELIGIBILITY_FLAG_KEY, user)).allowed;
}

/** Global policy = defaults merged with the stored SiteSetting override (never throws). */
export async function getGlobalEligibilitySettings() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: ELIGIBILITY_SETTINGS_KEY } });
    return { ...ELIGIBILITY_GLOBAL_DEFAULTS, ...safeParse(row?.value, {}) };
  } catch { return { ...ELIGIBILITY_GLOBAL_DEFAULTS }; }
}

/** Governed auto-apply is permitted globally only when the engine is enabled and the
 *  emergency kill switch is OFF. Suggestions (assessments) are unaffected by the switch. */
export function autoApplyAllowedGlobally(global) {
  return !!(global && global.enabled && !global.killSwitch);
}

/**
 * Coerce a GLOBAL (admin) settings patch to the known schema (whitelist + clamp).
 * Mirrors coerceAiScreeningSettings; exported so the admin GET/PUT can reuse it.
 */
export function coerceGlobalEligibilitySettings(patch, current) {
  const out = { ...current };
  const p = patch && typeof patch === 'object' ? patch : {};
  if (typeof p.enabled === 'boolean') out.enabled = p.enabled;
  if (p.defaultPolicy === 'assist' || p.defaultPolicy === 'auto') out.defaultPolicy = p.defaultPolicy;
  if (Number.isFinite(p.includeConfidence)) out.includeConfidence = clamp01(p.includeConfidence);
  if (Number.isFinite(p.excludeConfidence)) out.excludeConfidence = clamp01(p.excludeConfidence);
  if (typeof p.autoApplyRequiresNoHumanDecision === 'boolean') out.autoApplyRequiresNoHumanDecision = p.autoApplyRequiresNoHumanDecision;
  if (Number.isFinite(p.maxRecordsPerRun)) out.maxRecordsPerRun = Math.min(100000, Math.max(10, Math.round(p.maxRecordsPerRun)));
  if (Number.isFinite(p.inlineMaxRecords)) out.inlineMaxRecords = Math.min(500, Math.max(0, Math.round(p.inlineMaxRecords)));
  if (typeof p.killSwitch === 'boolean') out.killSwitch = p.killSwitch;
  return out;
}

/** Persist the GLOBAL policy (admin). Returns the coerced value. */
export async function saveGlobalEligibilitySettings(patch, actorId) {
  const current = await getGlobalEligibilitySettings();
  const next = coerceGlobalEligibilitySettings(patch, current);
  await prisma.siteSetting.upsert({
    where: { key: ELIGIBILITY_SETTINGS_KEY },
    create: { key: ELIGIBILITY_SETTINGS_KEY, value: JSON.stringify(next), updatedBy: actorId || null },
    update: { value: JSON.stringify(next), updatedBy: actorId || null },
  });
  return next;
}

/** Coerce a per-project settings patch to the known schema (defends against junk). */
export function coerceProjectSettings(patch, current) {
  const out = { ...current };
  const p = patch && typeof patch === 'object' ? patch : {};
  if (typeof p.enabled === 'boolean') out.enabled = p.enabled;
  if (p.policy === 'assist' || p.policy === 'auto') out.policy = p.policy;
  if (Number.isFinite(p.includeConfidence)) out.includeConfidence = clamp01(p.includeConfidence);
  if (Number.isFinite(p.excludeConfidence)) out.excludeConfidence = clamp01(p.excludeConfidence);
  return out;
}

/** Effective per-project policy (project JSON over global defaults). */
export function getProjectEligibilitySettings(row, global) {
  const g = global || ELIGIBILITY_GLOBAL_DEFAULTS;
  const p = safeParse(row?.settingsJson, {});
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : ELIGIBILITY_PROJECT_DEFAULTS.enabled,
    policy: (p.policy === 'auto' || p.policy === 'assist') ? p.policy : (g.defaultPolicy || 'assist'),
    includeConfidence: Number.isFinite(p.includeConfidence) ? clamp01(p.includeConfidence) : clamp01(g.includeConfidence),
    excludeConfidence: Number.isFinite(p.excludeConfidence) ? clamp01(p.excludeConfidence) : clamp01(g.excludeConfidence),
  };
}

async function loadProjectSettingRow(projectId) {
  try { return await prisma.eligibilityProjectSetting.findUnique({ where: { projectId } }); }
  catch { return null; }
}

/** Read the effective (global-merged) per-project policy. */
export async function readEffectiveSettings(projectId) {
  const [global, row] = await Promise.all([getGlobalEligibilitySettings(), loadProjectSettingRow(projectId)]);
  return { global, project: getProjectEligibilitySettings(row, global) };
}

/** Persist a per-project policy patch (owner/leader) + audit. Returns the effective policy. */
export async function updateProjectSettings({ projectId, patch, actor }) {
  const global = await getGlobalEligibilitySettings();
  const row = await loadProjectSettingRow(projectId);
  const current = getProjectEligibilitySettings(row, global);
  const next = coerceProjectSettings(patch, current);
  await prisma.eligibilityProjectSetting.upsert({
    where: { projectId },
    create: { projectId, settingsJson: JSON.stringify(next), updatedById: actor?.id || null, updatedByName: actor?.name || actor?.email || '' },
    update: { settingsJson: JSON.stringify(next), updatedById: actor?.id || null, updatedByName: actor?.name || actor?.email || '' },
  });
  writeAudit(projectId, actor, 'ELIGIBILITY_SETTINGS_UPDATED', {
    entityType: 'EligibilityProjectSetting', entityId: projectId, details: next,
  });
  return next;
}

// ── Criteria (versioned) ─────────────────────────────────────────────────────

/** The project's current criteria-set version = max(version) across rows, else 0. */
export async function currentCriteriaVersion(projectId) {
  const top = await prisma.eligibilityCriterion.findFirst({
    where: { projectId }, orderBy: { version: 'desc' }, select: { version: true },
  });
  return top?.version || 0;
}

function toCriterionDTO(c) {
  return {
    id: c.id, key: c.key, category: c.category, question: c.question,
    kind: c.kind, required: c.required, polarity: c.polarity,
    orderIndex: c.orderIndex, version: c.version, active: c.active, notes: c.notes,
  };
}

/** The active criteria set (ordered) + its version. */
export async function listCriteria(projectId) {
  const version = await currentCriteriaVersion(projectId);
  const rows = version
    ? await prisma.eligibilityCriterion.findMany({
        where: { projectId, version, active: true }, orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
      })
    : [];
  return { criteria: rows.map(toCriterionDTO), criteriaVersion: version };
}

/** Normalise + validate one incoming criterion (from PUT body). */
function coerceIncomingCriterion(raw, i) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const kind = c.kind === 'exclude' ? 'exclude' : 'include';
  const polarity = c.polarity === 'negative' ? 'negative' : 'positive';
  const question = String(c.question ?? '').trim();
  const key = String(c.key ?? '').trim() || `c${i + 1}`;
  return {
    key: key.slice(0, 120),
    category: String(c.category ?? '').trim().slice(0, 60),
    question: question.slice(0, 2000),
    kind, required: !!c.required, polarity,
    orderIndex: Number.isFinite(c.orderIndex) ? Math.trunc(c.orderIndex) : i,
    notes: String(c.notes ?? '').slice(0, 2000),
  };
}

/**
 * Replace the whole criteria set (owner/leader). Bumps the version, writes an
 * EligibilityCriterionAudit before/after snapshot, and returns the new set.
 */
export async function replaceCriteria({ projectId, criteria, actor }) {
  const incoming = Array.isArray(criteria) ? criteria : [];
  const cleaned = incoming.map(coerceIncomingCriterion).filter(c => c.question.length > 0);
  if (incoming.length && !cleaned.length) {
    throw Object.assign(new Error('Every criterion needs a question'), { status: 400 });
  }
  const before = await listCriteria(projectId);
  const newVersion = (before.criteriaVersion || 0) + 1;

  const result = await prisma.$transaction(async (tx) => {
    await tx.eligibilityCriterion.deleteMany({ where: { projectId } });
    for (let i = 0; i < cleaned.length; i++) {
      const c = cleaned[i];
      await tx.eligibilityCriterion.create({
        data: { projectId, version: newVersion, active: true, ...c, orderIndex: i },
      });
    }
    const rows = await tx.eligibilityCriterion.findMany({
      where: { projectId, version: newVersion }, orderBy: [{ orderIndex: 'asc' }],
    });
    await tx.eligibilityCriterionAudit.create({
      data: {
        projectId, version: newVersion, changeType: 'replace',
        beforeJson: JSON.stringify(before.criteria),
        afterJson: JSON.stringify(rows.map(toCriterionDTO)),
        changedById: actor?.id || null, changedByName: actor?.name || actor?.email || '',
      },
    });
    return rows;
  });

  writeAudit(projectId, actor, 'ELIGIBILITY_CRITERIA_REPLACED', {
    entityType: 'EligibilityCriterion', entityId: projectId,
    details: { version: newVersion, count: result.length },
  });
  emitToProjectMembers(projectId, { type: 'eligibility.updated' });
  return { criteria: result.map(toCriterionDTO), criteriaVersion: newVersion };
}

// ── Engine access ────────────────────────────────────────────────────────────

/** Resolve the engine's evaluate fn, or throw a controlled 503 if it has not landed. */
function requireEngine() {
  const fn = screeningEngine.evaluateEligibility;
  if (typeof fn !== 'function') {
    throw Object.assign(new Error('Eligibility engine is not available'), { status: 503, code: 'ENGINE_UNAVAILABLE' });
  }
  return fn;
}

function buildEngineConfig(global, project) {
  return {
    version: CONFIG_VERSION,
    includeConfidence: project.includeConfidence,
    excludeConfidence: project.excludeConfidence,
    defaultPolicy: project.policy,
  };
}

function recordForEngine(rec) {
  const raw = safeParse(rec.rawData, {});
  return {
    title: rec.title || '',
    abstract: rec.abstract || '',
    fullText: typeof raw.fullText === 'string' ? raw.fullText : undefined,
  };
}

function criterionForEngine(c) {
  return {
    id: c.id, key: c.key, category: c.category, question: c.question,
    kind: c.kind === 'exclude' ? 'exclude' : 'include',
    required: !!c.required,
    polarity: c.polarity === 'negative' ? 'negative' : 'positive',
  };
}

// ── Decision writes (governed) ───────────────────────────────────────────────

/**
 * Write a ScreenDecision the SAME way the normal decision flow does (upsert on the
 * unique (recordId, reviewerId, stage) key, then recompute conflicts + poke clients).
 * Because auto-apply uses a dedicated non-human reviewerId, it can never share a row
 * with a human and therefore can never overwrite one.
 */
async function writeDecisionRow({ project, recordId, reviewerId, reviewerName, decision, stage }) {
  const d = await prisma.screenDecision.upsert({
    where: { recordId_reviewerId_stage: { recordId, reviewerId, stage } },
    update: { decision, reviewerName },
    create: { recordId, projectId: project.id, reviewerId, reviewerName, stage, decision },
  });
  try { await syncConflicts(project.id, recordId, { stage }); } catch (e) { console.error('[eligibility] syncConflicts:', e?.message); }
  try { await touchProjectActivity(project.linkedMetaLabProjectId); } catch { /* best-effort */ }
  emitToProjectMembers(project.id, { type: 'decision.saved' });
  return d;
}

/** Does a *human* settled include/exclude decision already exist for this record+stage? */
async function humanDecisionExists(recordId, stage) {
  const d = await prisma.screenDecision.findFirst({
    where: {
      recordId, stage,
      reviewerId: { not: ELIGIBILITY_ENGINE_REVIEWER_ID },
      decision: { in: ['include', 'exclude'] },
    },
    select: { id: true },
  });
  return !!d;
}

// ── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Evaluate one record against the current criteria, upsert its assessment, and (if the
 * batch permits + policy allows) governed-auto-apply the suggestion. Pure-ish orchestration
 * around the deterministic engine; returns { assessment, autoApplied }.
 */
async function evaluateOneRecord(ctx, record) {
  const { project, criteria, criteriaVersion, engineFn, global, projectPolicy, allowAutoApply, stage, actor } = ctx;
  const result = engineFn({
    record: recordForEngine(record),
    criteria: criteria.map(criterionForEngine),
    config: buildEngineConfig(global, projectPolicy),
  }) || {};

  const answers = Array.isArray(result.answers) ? result.answers : [];
  const blockers = Array.isArray(result.blockers) ? result.blockers : [];
  const suggested = ['include', 'exclude', 'unclear'].includes(result.suggestedDecision) ? result.suggestedDecision : 'unclear';
  const confidence = Number.isFinite(result.decisionConfidence) ? clamp01(result.decisionConfidence) : null;
  const engineVersion = String(result.engineVersion || '');
  const configVersion = String(result.configVersion || CONFIG_VERSION);

  const base = {
    stage,
    answersJson: JSON.stringify(answers),
    blockersJson: JSON.stringify(blockers),
    suggestedDecision: suggested,
    decisionConfidence: confidence,
    engineVersion, configVersion, criteriaVersion,
    autoApplyPolicy: projectPolicy.policy,
  };
  const assessment = await prisma.eligibilityAssessment.upsert({
    where: { projectId_recordId: { projectId: project.id, recordId: record.id } },
    update: base,
    create: { projectId: project.id, recordId: record.id, ...base },
  });

  let autoApplied = false;
  if (allowAutoApply && (suggested === 'include' || suggested === 'exclude') && confidence != null) {
    const floor = suggested === 'include' ? projectPolicy.includeConfidence : projectPolicy.excludeConfidence;
    if (confidence >= floor) {
      // Governed auto-apply MUST NOT overwrite a human decision.
      const humanExists = global.autoApplyRequiresNoHumanDecision === false ? false : await humanDecisionExists(record.id, stage);
      if (!humanExists) {
        await writeDecisionRow({
          project, recordId: record.id, reviewerId: ELIGIBILITY_ENGINE_REVIEWER_ID,
          reviewerName: ELIGIBILITY_ENGINE_REVIEWER_NAME, decision: suggested, stage,
        });
        await prisma.eligibilityAssessment.update({
          where: { id: assessment.id },
          data: { autoApplied: true, autoApplyPolicy: 'auto', autoAppliedAt: new Date(), decidedAt: new Date() },
        });
        autoApplied = true;
        writeAudit(project.id, actor, 'ELIGIBILITY_AUTO_APPLIED', {
          entityType: 'ScreenRecord', entityId: record.id,
          details: { decision: suggested, confidence, engineVersion, configVersion, criteriaVersion, stage },
        });
      }
    }
  }
  return { assessment, autoApplied };
}

/** Resolve the concrete record-id list for a scope. */
async function resolveScopeRecordIds(projectId, scope, stage) {
  if (scope && typeof scope === 'object' && Array.isArray(scope.recordIds)) {
    const ids = scope.recordIds.map(String);
    const rows = await prisma.screenRecord.findMany({ where: { projectId, id: { in: ids } }, select: { id: true } });
    return rows.map(r => r.id);
  }
  const all = await prisma.screenRecord.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (scope === 'undecided') {
    const settled = await prisma.screenDecision.findMany({
      where: { projectId, stage, decision: { in: ['include', 'exclude'] }, reviewerId: { not: ELIGIBILITY_ENGINE_REVIEWER_ID } },
      select: { recordId: true }, distinct: ['recordId'],
    });
    const decided = new Set(settled.map(d => d.recordId));
    return all.map(r => r.id).filter(id => !decided.has(id));
  }
  return all.map(r => r.id); // 'all' (default)
}

/**
 * Build the shared evaluation context (project, criteria, policy, engine fn). Throws a
 * controlled error when there are no criteria or the engine has not landed.
 */
async function buildContext({ projectId, stage, allowAutoApply, actor }) {
  const project = await prisma.screenProject.findUnique({ where: { id: projectId } });
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
  const { criteria, criteriaVersion } = await listCriteria(projectId);
  if (!criteria.length) throw Object.assign(new Error('Define eligibility criteria before evaluating'), { status: 400, code: 'NO_CRITERIA' });
  const engineFn = requireEngine();
  const { global, project: projectPolicy } = await readEffectiveSettings(projectId);
  const autoOk = !!allowAutoApply && autoApplyAllowedGlobally(global) && projectPolicy.enabled && projectPolicy.policy === 'auto';
  return { project, criteria, criteriaVersion, engineFn, global, projectPolicy, allowAutoApply: autoOk, stage, actor };
}

/**
 * Evaluate a small scope INLINE (used when the scope is at/under inlineMaxRecords).
 * Returns { assessed, autoApplied, assessments }.
 */
export async function evaluateInline({ projectId, scope, stage = DEFAULT_STAGE, actor }) {
  const ctx = await buildContext({ projectId, stage, allowAutoApply: true, actor });
  const ids = await resolveScopeRecordIds(projectId, scope, stage);
  let autoApplied = 0;
  const out = [];
  for (const id of ids) {
    const record = await prisma.screenRecord.findUnique({ where: { id } });
    if (!record) continue;
    const r = await evaluateOneRecord(ctx, record);
    if (r.autoApplied) autoApplied++;
    out.push(serializeAssessment(r.assessment));
  }
  emitToProjectMembers(projectId, { type: 'eligibility.updated' });
  return { assessed: out.length, autoApplied, assessments: out };
}

// ── Assessments (read) ───────────────────────────────────────────────────────

export function serializeAssessment(a) {
  if (!a) return null;
  return {
    id: a.id, projectId: a.projectId, recordId: a.recordId, stage: a.stage,
    answers: safeArray(a.answersJson),
    blockers: safeArray(a.blockersJson),
    suggestedDecision: a.suggestedDecision,
    decisionConfidence: a.decisionConfidence,
    engineVersion: a.engineVersion, configVersion: a.configVersion, criteriaVersion: a.criteriaVersion,
    autoApplied: a.autoApplied, autoApplyPolicy: a.autoApplyPolicy, autoAppliedAt: a.autoAppliedAt,
    reviewerDecision: a.reviewerDecision, reviewerId: a.reviewerId, reviewerName: a.reviewerName,
    overrideReason: a.overrideReason, decidedAt: a.decidedAt,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

/** Paginated assessments for a project (newest first). */
export async function listAssessments(projectId, { skip = 0, take = 50 } = {}) {
  const t = Math.min(200, Math.max(1, Number(take) || 50));
  const s = Math.max(0, Number(skip) || 0);
  const [rows, total] = await Promise.all([
    prisma.eligibilityAssessment.findMany({ where: { projectId }, orderBy: { updatedAt: 'desc' }, skip: s, take: t }),
    prisma.eligibilityAssessment.count({ where: { projectId } }),
  ]);
  return { assessments: rows.map(serializeAssessment), total, skip: s, take: t };
}

/** Single assessment for a record. */
export async function getAssessment(projectId, recordId) {
  const a = await prisma.eligibilityAssessment.findUnique({ where: { projectId_recordId: { projectId, recordId } } });
  return serializeAssessment(a);
}

/** Project rollup: assessed / autoApplied / pendingReview. */
export async function getSummary(projectId) {
  const [assessed, autoApplied, pendingReview] = await Promise.all([
    prisma.eligibilityAssessment.count({ where: { projectId } }),
    prisma.eligibilityAssessment.count({ where: { projectId, autoApplied: true } }),
    prisma.eligibilityAssessment.count({ where: { projectId, autoApplied: false, reviewerDecision: '' } }),
  ]);
  return { assessed, autoApplied, pendingReview };
}

// ── Reviewer adjudication (human override; reversible) ───────────────────────

/**
 * A reviewer accepts/overrides the eligibility suggestion. Writes a human ScreenDecision
 * through the normal decision path and records the override on the assessment. Refuses to
 * clobber a pre-existing HUMAN adjudication unless `force` is set. Removes any prior
 * governed auto-apply decision (the human now governs).
 */
export async function adjudicate({ projectId, recordId, decision, reason = '', actor, stage = DEFAULT_STAGE, force = false }) {
  if (decision !== 'include' && decision !== 'exclude') {
    throw Object.assign(new Error('decision must be include or exclude'), { status: 400 });
  }
  const project = await prisma.screenProject.findUnique({ where: { id: projectId } });
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
  const existing = await prisma.eligibilityAssessment.findUnique({ where: { projectId_recordId: { projectId, recordId } } });
  if (!existing) throw Object.assign(new Error('No eligibility assessment for this record yet'), { status: 404 });

  // Guard: do not silently overwrite an existing HUMAN adjudication without an explicit force.
  const priorHuman = existing.reviewerDecision && existing.reviewerId && existing.reviewerId !== ELIGIBILITY_ENGINE_REVIEWER_ID;
  if (priorHuman && !force) {
    throw Object.assign(new Error('This record has already been adjudicated'), {
      status: 409, code: 'ALREADY_ADJUDICATED',
      details: { reviewerId: existing.reviewerId, reviewerName: existing.reviewerName, decision: existing.reviewerDecision },
    });
  }

  // The human takes over: drop any governed auto-apply decision row so it can't linger.
  try {
    await prisma.screenDecision.deleteMany({ where: { recordId, stage, reviewerId: ELIGIBILITY_ENGINE_REVIEWER_ID } });
  } catch { /* best-effort */ }

  await writeDecisionRow({
    project, recordId, reviewerId: actor.id,
    reviewerName: actor.name || actor.email || '', decision, stage,
  });

  const updated = await prisma.eligibilityAssessment.update({
    where: { id: existing.id },
    data: {
      reviewerDecision: decision, reviewerId: actor.id, reviewerName: actor.name || actor.email || '',
      overrideReason: String(reason || '').slice(0, 2000), decidedAt: new Date(),
      autoApplied: false, // superseded by a human decision
    },
  });
  writeAudit(projectId, actor, 'ELIGIBILITY_ADJUDICATED', {
    entityType: 'ScreenRecord', entityId: recordId,
    details: { decision, reason: String(reason || '').slice(0, 500), force: !!force, supersededAuto: existing.autoApplied },
  });
  // A new human label may improve the AI ranking; fire-and-forget (self-gated on its flag).
  try {
    const { scheduleRescore } = await import('./screeningAiJobs.js');
    scheduleRescore(projectId, { stage, actor });
  } catch { /* AI engine optional */ }
  emitToProjectMembers(projectId, { type: 'eligibility.updated' });
  return serializeAssessment(updated);
}

/**
 * Undo a governed auto-applied decision (owner/leader). Deletes the engine's ScreenDecision
 * row + clears the assessment's auto-apply provenance. Reversible + audited.
 */
export async function undoAutoApply({ projectId, recordId, actor, stage = DEFAULT_STAGE }) {
  const project = await prisma.screenProject.findUnique({ where: { id: projectId } });
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
  const a = await prisma.eligibilityAssessment.findUnique({ where: { projectId_recordId: { projectId, recordId } } });
  if (!a || !a.autoApplied) throw Object.assign(new Error('No auto-applied decision to undo'), { status: 404 });
  await prisma.screenDecision.deleteMany({ where: { recordId, stage, reviewerId: ELIGIBILITY_ENGINE_REVIEWER_ID } });
  try { await syncConflicts(projectId, recordId, { stage }); } catch { /* best-effort */ }
  const updated = await prisma.eligibilityAssessment.update({
    where: { id: a.id }, data: { autoApplied: false, autoAppliedAt: null, decidedAt: null },
  });
  writeAudit(projectId, actor, 'ELIGIBILITY_AUTO_APPLY_UNDONE', { entityType: 'ScreenRecord', entityId: recordId, details: { stage } });
  emitToProjectMembers(projectId, { type: 'eligibility.updated' });
  return serializeAssessment(updated);
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate the engine's suggestions against settled HUMAN decisions. Uses the engine's
 * computeEligibilityValidation when available; returns null when the engine has not landed.
 */
export async function getValidation(projectId, stage = DEFAULT_STAGE) {
  const fn = screeningEngine.computeEligibilityValidation;
  if (typeof fn !== 'function') return null;

  const [assessRows, decisionRows, { project }] = await Promise.all([
    prisma.eligibilityAssessment.findMany({ where: { projectId } }),
    prisma.screenDecision.findMany({
      where: { projectId, stage, decision: { in: ['include', 'exclude'] }, reviewerId: { not: ELIGIBILITY_ENGINE_REVIEWER_ID } },
      select: { recordId: true, decision: true },
    }),
    readEffectiveSettings(projectId),
  ]);

  // Ground truth per record = unanimous human label (skip records with disagreement).
  const byRecord = new Map();
  for (const d of decisionRows) {
    const cur = byRecord.get(d.recordId);
    if (cur === undefined) byRecord.set(d.recordId, d.decision);
    else if (cur !== d.decision) byRecord.set(d.recordId, 'conflict');
  }
  const humanDecisions = [];
  for (const [recordId, decision] of byRecord) {
    if (decision === 'include' || decision === 'exclude') humanDecisions.push({ recordId, decision });
  }
  const assessments = assessRows.map(a => ({
    recordId: a.recordId,
    suggestedDecision: a.suggestedDecision,
    decisionConfidence: a.decisionConfidence,
    answers: safeArray(a.answersJson),
  }));
  const thresholds = { includeConfidence: project.includeConfidence, excludeConfidence: project.excludeConfidence };
  const metrics = fn({ assessments, humanDecisions, thresholds }) || {};
  return { metrics, n: humanDecisions.length, assessed: assessRows.length, stage };
}

/** Flatten a validation metrics object to CSV (robust to the engine's exact shape). */
export function validationToCsv(validation) {
  const rows = [['metric', 'value']];
  const m = (validation && validation.metrics) || {};
  rows.push(['n', String(validation?.n ?? '')]);
  rows.push(['assessed', String(validation?.assessed ?? '')]);
  for (const [k, v] of Object.entries(m)) {
    if (v == null) continue;
    if (typeof v === 'object') continue; // nested blocks handled below
    rows.push([k, String(v)]);
  }
  const cm = m.confusionMatrix;
  if (cm && typeof cm === 'object') {
    for (const [k, v] of Object.entries(cm)) rows.push([`confusionMatrix.${k}`, String(v)]);
  }
  const per = m.perCriterion;
  if (Array.isArray(per)) {
    for (const p of per) {
      const key = p.key || p.criterionId || p.id || '';
      for (const [k, v] of Object.entries(p)) {
        if (k === 'key' || k === 'criterionId' || k === 'id') continue;
        if (v != null && typeof v !== 'object') rows.push([`perCriterion.${key}.${k}`, String(v)]);
      }
    }
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function csvCell(s) {
  const v = String(s ?? '');
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Optional 0..1 eligibility score for a serialized assessment (engine helper, best-effort). */
export function scoreOf(assessment) {
  const fn = screeningEngine.eligibilityScoreFromAssessment;
  if (typeof fn !== 'function' || !assessment) return null;
  try { const v = fn(assessment); return Number.isFinite(v) ? clamp01(v) : null; } catch { return null; }
}

// ── Durable bulk-evaluation jobs (mirror of screeningAiJobs) ──────────────────

const STUCK_MS = 15 * 60 * 1000;
const MAX_CLAIM_RACES = 1000;
const MAX_JOB_ATTEMPTS = 5;
let draining = false;
let bootRecovered = false;

/** Enqueue (or reuse) a bulk-evaluation job for a project. */
export async function enqueueEvaluation({ projectId, scope = 'undecided', stage = DEFAULT_STAGE, autoApply = true, actor }) {
  await recoverStuckOnce();
  const scopeKind = (scope && typeof scope === 'object') ? 'ids' : (scope === 'all' ? 'all' : 'undecided');
  const recordIds = scopeKind === 'ids' ? (scope.recordIds || []).map(String) : [];
  const existing = await prisma.screenEligibilityJob.findFirst({
    where: { projectId, stage, status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) { kickWorker(); return existing; }
  const job = await prisma.screenEligibilityJob.create({
    data: {
      projectId, stage, scope: scopeKind, recordIdsJson: JSON.stringify(recordIds),
      autoApply: !!autoApply, status: 'queued', trigger: 'manual',
      createdById: actor?.id || null, createdByName: actor?.name || actor?.email || '',
    },
  });
  kickWorker();
  return job;
}

/** Latest job status for a project/stage (for polling). */
export async function getJobStatus(projectId, stage = DEFAULT_STAGE) {
  const [latest, queued] = await Promise.all([
    prisma.screenEligibilityJob.findFirst({ where: { projectId, stage }, orderBy: { createdAt: 'desc' } }),
    prisma.screenEligibilityJob.findFirst({ where: { projectId, stage, status: 'queued' }, orderBy: { createdAt: 'asc' } }),
  ]);
  const running = latest?.status === 'running';
  const progress = running && latest?.total > 0 ? Math.min(100, Math.round((latest.processed / latest.total) * 100)) : 0;
  return {
    state: running ? 'running' : (queued ? 'queued' : 'idle'),
    running: !!running, queued: !!queued,
    jobId: (running ? latest?.id : queued?.id) || null,
    processed: running ? (latest?.processed || 0) : 0,
    total: running ? (latest?.total || 0) : 0,
    progress,
    lastStatus: latest?.status || null,
    lastReason: latest?.status === 'failed' ? latest.reason : '',
    nAssessed: latest?.nAssessed || 0,
    nAutoApplied: latest?.nAutoApplied || 0,
    completedAt: latest?.completedAt || null,
  };
}

async function claimNext() {
  for (let race = 0; race < MAX_CLAIM_RACES; race++) {
    const next = await prisma.screenEligibilityJob.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!next) return null;
    const claim = await prisma.screenEligibilityJob.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'running', startedAt: new Date(), heartbeatAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 1) return prisma.screenEligibilityJob.findUnique({ where: { id: next.id } });
  }
  return null;
}

async function processJob(job) {
  const startMs = (job.startedAt ? new Date(job.startedAt) : new Date()).getTime();
  try {
    const actor = job.createdById ? { id: job.createdById, name: job.createdByName || '' } : { id: 'system', name: 'eligibility-worker' };
    const scope = job.scope === 'ids' ? { recordIds: safeArray(job.recordIdsJson) } : job.scope;
    const ctx = await buildContext({ projectId: job.projectId, stage: job.stage, allowAutoApply: job.autoApply, actor });
    const ids = await resolveScopeRecordIds(job.projectId, scope, job.stage);
    await prisma.screenEligibilityJob.update({ where: { id: job.id }, data: { total: ids.length, heartbeatAt: new Date() } });

    let processed = 0, assessed = 0, autoApplied = 0, lastBeat = 0;
    for (const id of ids) {
      const record = await prisma.screenRecord.findUnique({ where: { id } });
      processed++;
      if (record) {
        const r = await evaluateOneRecord(ctx, record);
        assessed++;
        if (r.autoApplied) autoApplied++;
      }
      const now = Date.now();
      if (now - lastBeat >= 750) {
        lastBeat = now;
        await prisma.screenEligibilityJob.update({ where: { id: job.id }, data: { processed, nAssessed: assessed, nAutoApplied: autoApplied, heartbeatAt: new Date() } }).catch(() => {});
      }
    }
    await prisma.screenEligibilityJob.update({
      where: { id: job.id },
      data: { status: 'completed', processed, total: ids.length, nAssessed: assessed, nAutoApplied: autoApplied, completedAt: new Date(), durationMs: Date.now() - startMs },
    });
    emitToProjectMembers(job.projectId, { type: 'eligibility.updated' });
  } catch (e) {
    await prisma.screenEligibilityJob.update({
      where: { id: job.id },
      data: { status: 'failed', reason: String(e && e.message ? e.message : e).slice(0, 300), completedAt: new Date(), durationMs: Date.now() - startMs },
    }).catch(() => {});
  }
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const job = await claimNext();
      if (!job) break;
      await processJob(job);
    }
  } catch (e) {
    console.error('[eligibility-worker] drain:', e?.message);
  } finally {
    draining = false;
  }
}

/** Kick the worker (call after enqueueing). Idempotent / non-blocking. */
export function kickWorker() { setImmediate(() => { drain().catch(() => {}); }); }

/** Re-queue jobs left `running` by a crash; permanently fail poison pills over the cap. */
export async function recoverStuckEligibilityJobs(now = Date.now(), maxAttempts = MAX_JOB_ATTEMPTS) {
  const cutoff = now - STUCK_MS;
  const running = await prisma.screenEligibilityJob.findMany({ where: { status: 'running' }, select: { id: true, attempts: true, heartbeatAt: true, startedAt: true } });
  const stuck = running.filter(j => { const last = j.heartbeatAt || j.startedAt; return !last || new Date(last).getTime() < cutoff; });
  if (!stuck.length) return { requeued: 0, failed: 0 };
  const giveUp = stuck.filter(j => (j.attempts || 0) >= maxAttempts);
  const retry = stuck.filter(j => (j.attempts || 0) < maxAttempts);
  for (const job of giveUp) {
    await prisma.screenEligibilityJob.update({ where: { id: job.id }, data: { status: 'failed', reason: `Evaluation stopped after ${maxAttempts} interrupted attempts.`, completedAt: new Date() } }).catch(() => {});
  }
  if (retry.length) {
    await prisma.screenEligibilityJob.updateMany({ where: { id: { in: retry.map(j => j.id) } }, data: { status: 'queued', startedAt: null, heartbeatAt: null } });
  }
  return { requeued: retry.length, failed: giveUp.length };
}

async function recoverStuckOnce() {
  if (bootRecovered) return;
  bootRecovered = true;
  try { await recoverStuckEligibilityJobs(); } catch (e) { console.error('[eligibility-worker] recover:', e?.message); }
}

/** Explicit boot hook (optional; enqueue also self-recovers + kicks). Idempotent. */
export async function startEligibilityJobsWorker() {
  await recoverStuckOnce();
  kickWorker();
}

/** Test-only: reset the one-shot boot-recovery guard. */
export function _resetEligibilityWorker() { bootRecovered = false; draining = false; }
