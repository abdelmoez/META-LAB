/**
 * screeningAiService.js — server adapter for the PecanRev Screening Intelligence
 * Engine (feature flag: `aiScreening`, default OFF).
 *
 * This is a THIN adapter: it loads records + human decisions from Prisma, calls
 * the pure deterministic engine (src/research-engine/screening/ai), persists the
 * result, and audits it. It contains NO model maths — that all lives in the pure,
 * unit-tested engine so the scores stay reproducible.
 *
 * SAFETY INVARIANT: this service NEVER writes a ScreenDecision. The AI scores and
 * ranks; humans decide. Enforced structurally — there is no decision write path.
 */
import { prisma } from '../db/client.js';
import { writeAudit } from '../screening/access.js';
import {
  trainAndScore,
  crossValidate,
  computeValidation,
  createEmbeddingProvider,
  resolveConfig,
  fitCalibrator,
  applyCalibrator,
  evaluateStopping,
  retrospectiveStopping,
} from '../../src/research-engine/screening/ai/index.js';
import { buildEmbedFn } from './aiEmbeddingClient.js';

export const AI_SETTINGS_KEY = 'aiScreeningSettings';
export const AI_FLAG_KEY = 'aiScreening';

/** Global (admin) AI screening defaults — surfaced in Ops, overridable per-site. */
export const AI_GLOBAL_DEFAULTS = Object.freeze({
  enabled: true,                    // master switch WITHIN the feature flag
  embeddingProvider: 'lexical',     // lexical | hashing | hosted
  maxRecordsPerRun: 5000,
  requireHumanFinalDecision: true,  // AI may never finalise a decision
  allowReviewersToRun: false,       // false → only leaders/owners may trigger scoring
  includeThreshold: 0.65,
  excludeThreshold: 0.35,
  defaultPolicy: 'assist',          // assist | prioritize | auto_after_human
  // se2.md §6 — near-real-time rescoring after each include/exclude decision.
  liveUpdateEnabled: true,          // queue a debounced rescore on new decisions
  retrainDebounceMs: 4000,          // coalesce rapid decisions into one job
  killSwitch: false,                // se2.md §4 — emergency global disable (overrides enabled)
});

/** Per-project AI policy defaults (stored on ScreenProject.aiSettings JSON). */
export const AI_PROJECT_DEFAULTS = Object.freeze({
  enabled: true,            // project opt-in (within global + flag)
  policy: 'assist',         // assist (suggest) | prioritize (reorder queue) | auto_after_human
  blindFromAi: false,       // hide AI scores until the reviewer has decided (independent screening first)
  includeThreshold: 0.65,
  excludeThreshold: 0.35,
});

function safeParse(s, fallback) {
  try { const v = JSON.parse(s ?? ''); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}
function safeArray(s) {
  try { const v = JSON.parse(s ?? '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

/** Whether the `aiScreening` feature flag is on (best-effort; fail-closed). */
export async function aiFlagEnabled() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
    const flags = safeParse(row?.value, {});
    return flags[AI_FLAG_KEY] === true;
  } catch { return false; }
}

/**
 * applyKillSwitch — when the emergency kill switch is set it forces `enabled=false`
 * everywhere the engine consults settings, overriding all other toggles. Pure (no
 * mutation of the input); exported for unit testing. se2.md §4.
 */
export function applyKillSwitch(settings) {
  const s = { ...settings };
  if (s.killSwitch) s.enabled = false;
  return s;
}

/**
 * getRawGlobalAiSettings — defaults merged with the stored override, WITHOUT the
 * kill-switch runtime override. Use this for the admin editor so the stored `enabled`
 * value is edited directly (the override is a runtime effect, not a persisted state —
 * applying it before save would clobber `enabled` whenever the kill switch is on).
 */
export async function getRawGlobalAiSettings() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: AI_SETTINGS_KEY } });
    return { ...AI_GLOBAL_DEFAULTS, ...safeParse(row?.value, {}) };
  } catch { return { ...AI_GLOBAL_DEFAULTS }; }
}

/**
 * getGlobalAiSettings — EFFECTIVE global AI settings consumed by the engine: the raw
 * stored values with the emergency kill switch applied. Behaviour is unchanged for all
 * existing callers (kill switch still forces enabled=false).
 */
export async function getGlobalAiSettings() {
  try {
    return applyKillSwitch(await getRawGlobalAiSettings());
  } catch { return { ...AI_GLOBAL_DEFAULTS }; }
}

/** Effective per-project AI settings (project JSON over global defaults). */
export function getProjectAiSettings(project, global) {
  const g = global || AI_GLOBAL_DEFAULTS;
  const p = safeParse(project?.aiSettings, {});
  return {
    enabled: p.enabled ?? AI_PROJECT_DEFAULTS.enabled,
    policy: p.policy ?? g.defaultPolicy ?? AI_PROJECT_DEFAULTS.policy,
    blindFromAi: p.blindFromAi ?? AI_PROJECT_DEFAULTS.blindFromAi,
    includeThreshold: p.includeThreshold ?? g.includeThreshold ?? AI_PROJECT_DEFAULTS.includeThreshold,
    excludeThreshold: p.excludeThreshold ?? g.excludeThreshold ?? AI_PROJECT_DEFAULTS.excludeThreshold,
  };
}

/**
 * aggregateLabel — collapse a record's human decisions into a single training/
 * validation label. Strongest signal first: a settled final status, then a clean
 * unanimous reviewer vote. Unresolved conflicts and maybe-only records are left
 * UNLABELED (returned undefined) so the model never learns from disagreement.
 *
 * @returns {'include'|'exclude'|undefined}
 */
export function aggregateLabel(record, decisions) {
  if (record.finalStatus === 'accepted') return 'include';
  if (record.finalStatus === 'rejected') return 'exclude';
  let inc = 0, exc = 0;
  for (const d of decisions) {
    if (d.decision === 'include') inc++;
    else if (d.decision === 'exclude') exc++;
  }
  if (inc > 0 && exc === 0) return 'include';
  if (exc > 0 && inc === 0) return 'exclude';
  return undefined; // conflict / maybe-only / undecided → unlabeled
}

/**
 * loadEngineInput — assemble the pure-engine input from the DB for one project.
 */
export async function loadEngineInput(projectId, stage = 'title_abstract') {
  const project = await prisma.screenProject.findUnique({ where: { id: projectId } });
  if (!project) return null;

  const [records, decisions] = await Promise.all([
    prisma.screenRecord.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },   // deterministic "most recent first" so the per-run cap is reproducible
      select: {
        id: true, title: true, abstract: true, authors: true, year: true,
        journal: true, doi: true, pmid: true, keywords: true, isDuplicate: true,
        currentStage: true, finalStatus: true,
      },
    }),
    prisma.screenDecision.findMany({
      where: { projectId, stage },
      select: { recordId: true, reviewerId: true, decision: true, createdAt: true },
    }),
  ]);

  const decByRecord = new Map();
  for (const d of decisions) {
    if (!decByRecord.has(d.recordId)) decByRecord.set(d.recordId, []);
    decByRecord.get(d.recordId).push(d);
  }

  const labelByRecordId = {};
  for (const r of records) {
    const lab = aggregateLabel(r, decByRecord.get(r.id) || []);
    if (lab) labelByRecordId[r.id] = lab;
  }

  // Chronological settled labels (oldest→newest by latest decision time) — feeds the
  // stopping-rule "recent inclusion yield" precondition (se2.md §9).
  const settled = [];
  for (const r of records) {
    const lab = labelByRecordId[r.id];
    if (!lab) continue;
    let t = 0;
    for (const d of (decByRecord.get(r.id) || [])) {
      const ms = d.createdAt ? new Date(d.createdAt).getTime() : 0;
      if (ms > t) t = ms;
    }
    settled.push({ t, y: lab === 'include' ? 1 : 0 });
  }
  settled.sort((a, b) => a.t - b.t);
  const chronoLabels = settled.map(s => s.y);

  return {
    project,
    records,
    labelByRecordId,
    chronoLabels,
    picoSnapshot: project.picoSnapshot,
    inclusionKeywords: safeArray(project.inclusionKeywords),
    exclusionKeywords: safeArray(project.exclusionKeywords),
    studyTypeFilter: safeArray(project.studyTypeFilter),
  };
}

/**
 * runScoring — train (if enough labels) + score every record, persist scores +
 * a run row with an internal-validation snapshot, and audit.
 *
 * @param {object} args
 * @param {string} args.projectId
 * @param {string} [args.stage]
 * @param {{id:string,name?:string,email?:string}} args.actor
 * @param {string} [args.trigger] 'manual' | 'auto'
 * @returns {Promise<{run:object, scoredCount:number}>}
 */
export async function runScoring({ projectId, stage = 'title_abstract', actor, trigger = 'manual' }) {
  const global = await getGlobalAiSettings();
  const input = await loadEngineInput(projectId, stage);
  if (!input) throw Object.assign(new Error('Project not found'), { status: 404 });

  const aiProject = getProjectAiSettings(input.project, global);
  const startedAt = new Date();

  // Cap records per run. Label-preserving: keep ALL human-labelled records (so the
  // training set + validation cohort are never silently shrunk) plus the most
  // recent unlabelled records up to the cap. records are already newest-first.
  const cap = global.maxRecordsPerRun || 5000;
  let records = input.records;
  if (records.length > cap) {
    const labeledSet = new Set(Object.keys(input.labelByRecordId));
    const labeled = records.filter(r => labeledSet.has(r.id));
    const unlabeled = records.filter(r => !labeledSet.has(r.id));
    const room = Math.max(0, cap - labeled.length);
    records = [...labeled, ...unlabeled.slice(0, room)];
  }

  const config = {
    provider: { embedding: global.embeddingProvider || 'lexical' },
    hybrid: {},
  };

  // Embedding provider: 'lexical' (default, no vectors), 'hashing' (in-process dense),
  // or 'hosted' (env-configured external service). Best-effort: any failure → no
  // dense vectors → the engine uses its in-process lexical semantic signal.
  let denseEmbeddings;
  let embeddingProviderUsed = 'lexical';
  try {
    const provider = createEmbeddingProvider(config.provider, { embed: buildEmbedFn(process.env) });
    if (provider.available) {
      const vecs = await provider.embedRecords(records);
      // All-or-nothing: only use embeddings when EVERY record got a uniform-length
      // dense vector. Any ragged/missing row → fall back to the lexical engine.
      const dim = Array.isArray(vecs) && Array.isArray(vecs[0]) ? vecs[0].length : 0;
      const uniform = Array.isArray(vecs) && vecs.length === records.length && dim > 0
        && vecs.every(v => Array.isArray(v) && v.length === dim && v.every(Number.isFinite));
      if (uniform) {
        denseEmbeddings = {};
        records.forEach((r, i) => { denseEmbeddings[r.id] = vecs[i]; });
        embeddingProviderUsed = provider.name;
      }
    }
  } catch { denseEmbeddings = undefined; }

  let result;
  try {
    result = trainAndScore({
      records,
      labelByRecordId: input.labelByRecordId,
      picoSnapshot: input.picoSnapshot,
      inclusionKeywords: input.inclusionKeywords,
      exclusionKeywords: input.exclusionKeywords,
      studyTypeFilter: input.studyTypeFilter,
      denseEmbeddings,
      config,
    });
  } catch (err) {
    const failed = await prisma.screenAiRun.create({
      data: {
        projectId, stage, status: 'failed', mode: 'cold_start', trigger,
        failureReason: String(err && err.message ? err.message : err).slice(0, 500),
        triggeredById: actor?.id || null, triggeredByName: actor?.name || actor?.email || '',
        startedAt, completedAt: new Date(),
      },
    });
    throw Object.assign(new Error('Scoring failed'), { status: 500, run: failed });
  }

  // Internal validation: AI score vs settled human labels (apparent/in-sample).
  const scoreById = new Map(result.scores.map(s => [s.recordId, s.score]));
  const valScores = [];
  const valLabels = [];
  for (const [rid, lab] of Object.entries(input.labelByRecordId)) {
    if (scoreById.has(rid)) {
      valScores.push(scoreById.get(rid));
      valLabels.push(lab === 'include' ? 1 : 0);
    }
  }
  const metrics = valScores.length >= 4
    ? { ...computeValidation(valScores, valLabels, { threshold: aiProject.includeThreshold }), inSample: true }
    : { insufficient: true, n: valScores.length };

  // Honest held-out metrics (stratified k-fold CV) when there are enough labels.
  // This trains k extra models; bounded by the same record cap, so it's cheap.
  if (result.meta.canTrain) {
    try {
      const cv = crossValidate({
        records,
        labelByRecordId: input.labelByRecordId,
        picoSnapshot: input.picoSnapshot,
        inclusionKeywords: input.inclusionKeywords,
        exclusionKeywords: input.exclusionKeywords,
        studyTypeFilter: input.studyTypeFilter,
        config,
      });
      metrics.crossVal = cv;
    } catch { /* CV is best-effort; in-sample metrics still stand */ }
  }

  // ── Probability calibration (se2.md §8) ──────────────────────────────────────
  // Fit the calibrator on the OUT-OF-FOLD CV predictions (never in-sample), then map
  // every record's ranking score → calibrated P(include). Below the sample-size floor
  // the method is 'none' and calibratedProba stays null (the UI shows the raw score).
  const cfg = resolveConfig(config);
  let calibration = { method: 'none', params: null, metrics: null, reason: 'Calibration needs held-out predictions from cross-validation (not enough labels yet).' };
  if (cfg.calibration?.enabled && metrics.crossVal?.oof?.scores?.length) {
    try { calibration = fitCalibrator(metrics.crossVal.oof.scores, metrics.crossVal.oof.labels, cfg.calibration); }
    catch { /* keep 'none' on any calibration failure — scores remain usable */ }
  }
  for (const s of result.scores) {
    s.calibratedProba = calibration.method === 'none' ? null : applyCalibrator(calibration.params, s.score);
  }
  // Persist calibration metadata + params (not the per-point reliability arrays twice).
  metrics.calibration = calibration;

  // ── Stopping-rule estimate (se2.md §9) ───────────────────────────────────────
  // Σ calibrated P(include) over UNSCREENED records = estimated remaining eligible.
  // Gated by preconditions (incl. adequate calibration) and judged against the
  // conservative lower bound. Decision support only — never actionable on its own.
  if (cfg.stopping?.enabled) {
    try {
      const labeledSet = new Set(Object.keys(input.labelByRecordId));
      const foundPositives = Object.values(input.labelByRecordId).filter(v => v === 'include').length;
      const nDecisions = result.meta.labelCounts?.labeledForTraining ?? labeledSet.size;
      const unscreenedProbs = result.scores
        .filter(s => !labeledSet.has(s.recordId) && s.calibratedProba != null)
        .map(s => s.calibratedProba);
      // Unscreened records dropped by the per-run cap (capping keeps every LABELED record,
      // so all dropped rows are unscreened). Their eligible mass is unaccounted for in
      // Σ p_i, so this MUST suppress any actionable recommendation (review HIGH finding).
      const unscoredUnscreened = Math.max(0, input.records.length - result.scores.length);
      const stopping = evaluateStopping({
        foundPositives, nDecisions, unscreenedProbs, calibration, unscoredUnscreened,
        chronoLabels: input.chronoLabels || [],
        targetRecall: cfg.stopping.targetRecall,
        config: cfg.stopping,
      });
      // Retrospective work-saved from the honest held-out (or in-sample) pairs.
      const retroPairs = metrics.crossVal?.oof?.scores?.length
        ? metrics.crossVal.oof
        : (valScores.length >= 4 ? { scores: valScores, labels: valLabels } : null);
      if (retroPairs) stopping.retrospective = retrospectiveStopping(retroPairs.scores, retroPairs.labels, cfg.stopping.targetRecall);
      stopping.coverage = { scoredRecords: result.scores.length, totalRecords: input.records.length, capped: unscoredUnscreened > 0 };
      metrics.stopping = stopping;
    } catch { /* stopping is best-effort; the scoring run still persists */ }
  }

  // Create the run row FIRST so every score can be stamped with the real run id
  // directly (no broad post-hoc updateMany that could mis-attribute scores across
  // concurrent/over-cap runs on the same project+stage).
  const run = await prisma.screenAiRun.create({
    data: {
      projectId, stage, status: 'completed', mode: result.meta.mode, trigger,
      nRecords: result.meta.nRecords,
      nScored: result.scores.length,
      nFeatures: result.meta.nFeatures,
      labelCountsJson: JSON.stringify(result.meta.labelCounts || {}),
      modelInfoJson: JSON.stringify(result.meta.modelInfo || {}),
      configJson: JSON.stringify({ provider: config.provider, embeddingProviderUsed, includeThreshold: aiProject.includeThreshold }),
      metricsJson: JSON.stringify(metrics),
      triggeredById: actor?.id || null,
      triggeredByName: actor?.name || actor?.email || '',
      startedAt, completedAt: new Date(),
    },
  });

  // Persist: upsert the latest score per (project, record, stage), stamped with run.id.
  for (const s of result.scores) {
    const data = {
      runId: run.id,
      stage,
      score: s.score,
      proba: s.proba,
      calibratedProba: s.calibratedProba ?? null,
      coldStartScore: s.coldStartScore,
      uncertainty: s.uncertainty,
      confidence: s.confidence,
      prediction: s.prediction,
      band: s.band,
      mode: s.mode,
      lowConfidence: !!s.lowConfidence,
      missingAbstract: !!s.missingAbstract,
      picoMean: s.picoMean ?? null,
      subScoresJson: JSON.stringify(s.subScores || {}),
      signalsJson: JSON.stringify(s.signals || {}),
      explanationJson: JSON.stringify(s.explanation || {}),
    };
    await prisma.screenAiScore.upsert({
      where: { projectId_recordId_stage: { projectId, recordId: s.recordId, stage } },
      create: { projectId, recordId: s.recordId, ...data },
      update: data,
    });
  }

  writeAudit(projectId, actor, 'AI_RUN_COMPLETED', {
    entityType: 'ScreenAiRun', entityId: run.id,
    details: { mode: result.meta.mode, scored: result.scores.length, labels: result.meta.labelCounts, auc: metrics.auc ?? null },
  });

  return { run, scoredCount: result.scores.length, meta: result.meta, metrics };
}

/** Latest scores for a project/stage, keyed by recordId. */
export async function getScoresMap(projectId, stage = 'title_abstract') {
  const rows = await prisma.screenAiScore.findMany({ where: { projectId, stage } });
  const map = {};
  for (const r of rows) {
    map[r.recordId] = {
      recordId: r.recordId,
      score: r.score,
      proba: r.proba,
      calibratedProba: r.calibratedProba ?? null,
      uncertainty: r.uncertainty,
      confidence: r.confidence,
      prediction: r.prediction,
      band: r.band,
      mode: r.mode,
      lowConfidence: r.lowConfidence,
      missingAbstract: r.missingAbstract,
      picoMean: r.picoMean,
      subScores: safeParse(r.subScoresJson, {}),
      updatedAt: r.updatedAt,
    };
  }
  return map;
}

/** Full explanation for one record (persisted; no recompute). */
export async function getRecordExplanation(projectId, recordId, stage = 'title_abstract') {
  const row = await prisma.screenAiScore.findUnique({
    where: { projectId_recordId_stage: { projectId, recordId, stage } },
  });
  if (!row) return null;
  return {
    recordId,
    score: row.score,
    calibratedProba: row.calibratedProba ?? null,
    prediction: row.prediction,
    confidence: row.confidence,
    uncertainty: row.uncertainty,
    mode: row.mode,
    band: row.band,
    signals: safeParse(row.signalsJson, {}),
    explanation: safeParse(row.explanationJson, {}),
    updatedAt: row.updatedAt,
  };
}

/** Latest run + status summary for a project. */
export async function getStatus(projectId, stage = 'title_abstract') {
  const [latestRun, scoreCount, global, project] = await Promise.all([
    prisma.screenAiRun.findFirst({ where: { projectId, stage }, orderBy: { createdAt: 'desc' } }),
    prisma.screenAiScore.count({ where: { projectId, stage } }),
    getGlobalAiSettings(),
    prisma.screenProject.findUnique({ where: { id: projectId } }),
  ]);
  const aiProject = getProjectAiSettings(project, global);
  return {
    enabled: global.enabled && aiProject.enabled,
    project: aiProject,
    global: { embeddingProvider: global.embeddingProvider, requireHumanFinalDecision: global.requireHumanFinalDecision, allowReviewersToRun: global.allowReviewersToRun },
    scoreCount,
    latestRun: latestRun ? {
      id: latestRun.id,
      mode: latestRun.mode,
      status: latestRun.status,
      nScored: latestRun.nScored,
      nFeatures: latestRun.nFeatures,
      labelCounts: safeParse(latestRun.labelCountsJson, {}),
      modelInfo: safeParse(latestRun.modelInfoJson, {}),
      metrics: safeParse(latestRun.metricsJson, {}),
      triggeredByName: latestRun.triggeredByName,
      completedAt: latestRun.completedAt,
    } : null,
  };
}

/** Validation metrics from the latest run. */
export async function getValidation(projectId, stage = 'title_abstract') {
  const run = await prisma.screenAiRun.findFirst({
    where: { projectId, stage, status: 'completed' },
    orderBy: { createdAt: 'desc' },
  });
  if (!run) return null;
  return {
    runId: run.id,
    mode: run.mode,
    completedAt: run.completedAt,
    labelCounts: safeParse(run.labelCountsJson, {}),
    metrics: safeParse(run.metricsJson, {}),
  };
}

/** Record human feedback on an AI suggestion. */
export async function recordFeedback({ projectId, recordId, stage = 'title_abstract', actor, body }) {
  const score = await prisma.screenAiScore.findUnique({
    where: { projectId_recordId_stage: { projectId, recordId, stage } },
  }).catch(() => null);

  const humanDecision = String(body?.humanDecision || '');
  const aiPrediction = score?.prediction || String(body?.aiPrediction || '');
  const agree = humanDecision && aiPrediction
    ? (humanDecision === aiPrediction || (humanDecision === 'maybe' && aiPrediction === 'uncertain'))
    : null;

  const fb = await prisma.screenAiFeedback.create({
    data: {
      projectId, recordId, runId: score?.runId || '',
      aiPrediction, aiScore: score?.score ?? (body?.aiScore ?? null),
      humanDecision, agree,
      rating: String(body?.rating || ''),
      note: String(body?.note || '').slice(0, 2000),
      givenById: actor?.id || null, givenByName: actor?.name || actor?.email || '',
    },
  });
  writeAudit(projectId, actor, 'AI_FEEDBACK', {
    entityType: 'ScreenAiFeedback', entityId: fb.id,
    details: { recordId, agree, rating: fb.rating },
  });
  return fb;
}
