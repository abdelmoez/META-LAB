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
import { ELIGIBILITY_ENGINE_REVIEWER_ID } from './screeningEligibilityService.js';
import crypto from 'node:crypto';
import {
  computeValidation,
  createEmbeddingProvider,
  resolveConfig,
  resolveEngineConfig,
  ENGINE_CONFIG_VERSIONS,
  ENGINE_CONFIG_DEFAULT_VERSION,
  fitCalibrator,
  heldOutCalibrationMetrics,
  applyCalibrator,
  evaluateStopping,
  retrospectiveStopping,
  scoreHistogram,
  runDriftSnapshot,
  computeDrift,
  chunk,
} from '../../src/research-engine/screening/ai/index.js';
import { buildEmbedFn, embeddingModelInfo } from './aiEmbeddingClient.js';
import { featureAccess } from './featureAccess.js';
// 66.md P4.3/P4.6 — citation-graph enrichment + representative validation samples.
import { loadCitationByRecordId, getCitationStatus } from './citationEnrichmentService.js';
import { mulberry32 } from '../../src/research-engine/screening/sampling.js';
// 62.md — the two CPU-heavy phases (trainAndScore + cross-validation) now run in a
// worker_thread (with an inline fallback) so a large run never blocks the HTTP event
// loop. Results are identical (deterministic engine, same inputs).
import { runTrainAndScore, runCrossValidate } from './aiCompute.js';

const FEATURE_VERSION = 'feat-1.0';
const PERSIST_CHUNK = 500;   // se2.md §12 — score upserts per DB transaction (bounded write batch)

/** Deterministic hash of the training inputs (sorted labelled record→label pairs) + the
 *  model-defining config, so a run's model version is reproducible/comparable (se2.md §11). */
function snapshotHash(labelByRecordId, configKeys) {
  const labels = Object.keys(labelByRecordId || {}).sort().map(id => `${id}:${labelByRecordId[id]}`).join('|');
  const cfg = JSON.stringify(configKeys || {});
  return crypto.createHash('sha1').update(`${FEATURE_VERSION}\n${cfg}\n${labels}`).digest('hex').slice(0, 16);
}

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
  // 58.md §8 — minimum screened (decided) records before AI scores become visible.
  // Below this the API withholds scores and the UI shows progress toward it. Admins
  // can bypass per-request with ?showBelowThreshold=1 for testing.
  minScreenedDecisions: 50,
  // screeningEngine.md task 3 — named engine config version a run is scored under
  // (v2-lexical-tuned by default; v1-hybrid-legacy preserved for rollback). Projects
  // may override; a rollback pins the target run's version.
  engineConfigVersion: ENGINE_CONFIG_DEFAULT_VERSION,
});

/** Per-project AI policy defaults (stored on ScreenProject.aiSettings JSON). */
export const AI_PROJECT_DEFAULTS = Object.freeze({
  enabled: true,            // project opt-in (within global + flag)
  policy: 'assist',         // assist (suggest) | prioritize (reorder queue) | auto_after_human
  blindFromAi: false,       // hide AI scores until the reviewer has decided (independent screening first)
  includeThreshold: 0.65,
  excludeThreshold: 0.35,
  minScreenedDecisions: 50, // 58.md §8 — per-project override of the visibility threshold
  engineConfigVersion: null, // null → inherit the global engine config version
});

function safeParse(s, fallback) {
  try { const v = JSON.parse(s ?? ''); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}
function safeArray(s) {
  try { const v = JSON.parse(s ?? '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

/**
 * Whether the `aiScreening` feature flag is on (best-effort; fail-closed).
 * 75.md Phase 7 — routed through the central seam. The member-facing controller gate
 * passes `req.user` so admins keep the feature usable while it is globally OFF; the
 * background workers / shared screening list call it with no user (plain flag state).
 */
export async function aiFlagEnabled(user = null) {
  return (await featureAccess(AI_FLAG_KEY, user)).allowed;
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
    // Engine config version: project override → global → registry default. Unknown ids
    // fall back to the default inside resolveEngineConfig, so a stale value is safe.
    engineConfigVersion: (ENGINE_CONFIG_VERSIONS[p.engineConfigVersion] ? p.engineConfigVersion : null)
      ?? (ENGINE_CONFIG_VERSIONS[g.engineConfigVersion] ? g.engineConfigVersion : null)
      ?? ENGINE_CONFIG_DEFAULT_VERSION,
  };
}

/** Catalogue of selectable engine config versions (id + label + summary), with the
 *  registry default flagged. Surfaced in status + admin so a leader can pick/roll back. */
export function listEngineConfigVersions() {
  return Object.entries(ENGINE_CONFIG_VERSIONS).map(([id, v]) => ({
    id, label: v.label, summary: v.summary, isDefault: id === ENGINE_CONFIG_DEFAULT_VERSION,
  }));
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
      // 86.md P2.94 — never train the relevance model on the eligibility engine's
      // OWN auto-applied decisions (a label feedback loop where the model learns to
      // predict its sibling engine). Human labels only; the engine reviewerId is
      // excluded at the source.
      where: { projectId, stage, reviewerId: { not: ELIGIBILITY_ENGINE_REVIEWER_ID } },
      // prompt49 item 1 — also load rating + notes so the engine can derive
      // SEPARATE reviewer-quality + note signals (relevance classifier unchanged).
      select: { recordId: true, reviewerId: true, decision: true, rating: true, notes: true, createdAt: true },
    }),
  ]);

  const decByRecord = new Map();
  for (const d of decisions) {
    if (!decByRecord.has(d.recordId)) decByRecord.set(d.recordId, []);
    decByRecord.get(d.recordId).push(d);
  }

  // Per-record reviewer decisions (with rating + note) for the quality/note signal
  // layer. Plain objects keyed by recordId; the engine treats notes as untrusted.
  const decisionsByRecordId = {};
  for (const [rid, ds] of decByRecord) {
    decisionsByRecordId[rid] = ds.map((d) => ({ reviewerId: d.reviewerId, decision: d.decision, rating: d.rating ?? null, notes: d.notes || '' }));
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
    decisionsByRecordId,
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
 * @param {string} [args.trigger] 'manual' | 'auto' | 'rollback'
 * @param {object} [args.pinnedConfig] — se2.md §11: pin the model config (e.g. embedding
 *   provider) from a prior version, for rollback. Falls back to the global setting.
 * @param {string} [args.rollbackFromRunId] — stamp the new run as a rollback of this run.
 * @returns {Promise<{run:object, scoredCount:number}>}
 */
// se2.md §11 — in-process per-(project,stage) mutex so ALL runScoring entry points
// (manual run, rollback, AND the background rescore job) serialize. Two interleaving runs
// would race the active-version lineage + per-record run attribution and could leave two
// active versions. The chain never rejects, so one failed run can't wedge the queue; the
// map self-cleans at the tail. (Single-process scope; a multi-process deploy would need a
// DB advisory lock — documented.)
const _runLocks = new Map();
function withRunLock(key, fn) {
  const prev = _runLocks.get(key) || Promise.resolve();
  const run = prev.then(() => fn(), () => fn());
  const tail = run.then(() => {}, () => {});
  _runLocks.set(key, tail);
  tail.then(() => { if (_runLocks.get(key) === tail) _runLocks.delete(key); });
  return run;
}

export async function runScoring(opts = {}) {
  const stage = opts.stage || 'title_abstract';
  return withRunLock(`${opts.projectId}::${stage}`, () => _runScoring({ ...opts, stage }));
}

async function _runScoring({ projectId, stage = 'title_abstract', actor, trigger = 'manual', pinnedConfig = null, rollbackFromRunId = null, onProgress = null }) {
  // 62.md — best-effort progress hook (drives the durable-job progress bar); a reporter
  // error must never interrupt scoring.
  const report = (data) => { try { if (onProgress) onProgress(data); } catch { /* ignore */ } };
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
  report({ phase: 'scoring', processed: 0, total: records.length });

  // screeningEngine.md task 3 — resolve the engine config VERSION (rollback pin →
  // project/global setting), then build the fully-populated config under that version
  // with the run's embedding provider overlaid. The version id is stamped on the run so
  // it is reproducible and rollback-able; v1-hybrid-legacy stays available untouched.
  const engineConfigVersion =
    (pinnedConfig && ENGINE_CONFIG_VERSIONS[pinnedConfig.engineConfigVersion] ? pinnedConfig.engineConfigVersion : null)
    || aiProject.engineConfigVersion || ENGINE_CONFIG_DEFAULT_VERSION;
  const config = resolveEngineConfig(engineConfigVersion, {
    // se2.md §11 — a rollback pins the prior version's embedding provider; otherwise the
    // current global setting governs.
    provider: { embedding: (pinnedConfig && pinnedConfig.provider && pinnedConfig.provider.embedding) || global.embeddingProvider || 'lexical' },
  });

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

  // 66.md P4.3 — citation-graph metadata (from the enrichment cache; {} when the
  // project was never enriched). Passed as RAW metadata: the pure engine derives
  // the actual features from each call's own labels, keeping CV leakage-free.
  const citationByRecordId = await loadCitationByRecordId(records);
  const hasCitationData = Object.keys(citationByRecordId).length > 0;

  let result;
  try {
    result = await runTrainAndScore({
      records,
      citationByRecordId: hasCitationData ? citationByRecordId : undefined,
      labelByRecordId: input.labelByRecordId,
      decisionsByRecordId: input.decisionsByRecordId,
      // Blind review → suppress reviewer signals so one reviewer's hidden
      // rating/note never leaks to another (the relevance score is unaffected).
      revealReviewerSignals: !input.project.blindMode,
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
      const cv = await runCrossValidate({
        records,
        citationByRecordId: hasCitationData ? citationByRecordId : undefined,
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

  // ── Representative-sample validation split (66.md P4.6) ─────────────────────
  // Prioritized screening biases validation labels. When a random validation seed
  // sample exists, ALSO cross-validate on the sample's labels alone (unbiased
  // protocol: train+test inside the random sample) and label the provenance of
  // every metric set: random | prioritized | mixed.
  try {
    const sample = await prisma.screenValidationSample.findFirst({
      where: { projectId, stage }, orderBy: { createdAt: 'desc' },
    });
    const labeledIds = Object.keys(input.labelByRecordId);
    if (sample) {
      const sampleIds = new Set(safeArray(sample.recordIds));
      const inSample = labeledIds.filter(id => sampleIds.has(id));
      const outSample = labeledIds.length - inSample.length;
      metrics.validationSource = inSample.length > 0 ? (outSample === 0 ? 'random' : 'mixed') : 'prioritized';
      metrics.validationSample = {
        sampleId: sample.id, size: sampleIds.size, labeled: inSample.length,
        includes: inSample.filter(id => input.labelByRecordId[id] === 'include').length,
      };
      if (inSample.length >= 10) {
        const sampleLabels = {};
        for (const id of inSample) sampleLabels[id] = input.labelByRecordId[id];
        try {
          const cvU = await runCrossValidate({
            records,
            citationByRecordId: hasCitationData ? citationByRecordId : undefined,
            labelByRecordId: sampleLabels,
            picoSnapshot: input.picoSnapshot,
            inclusionKeywords: input.inclusionKeywords,
            exclusionKeywords: input.exclusionKeywords,
            studyTypeFilter: input.studyTypeFilter,
            config,
          });
          // Strip the bulky OOF arrays — only the unbiased metric summary is kept.
          if (cvU && cvU.oof) delete cvU.oof;
          metrics.crossValUnbiased = { ...cvU, source: 'random_sample', nSampleLabels: inSample.length };
        } catch { /* unbiased CV is best-effort */ }
      }
    } else {
      metrics.validationSource = labeledIds.length ? 'prioritized' : 'none';
    }
  } catch { /* sample lookup is best-effort */ }

  // ── Probability calibration (se2.md §8) ──────────────────────────────────────
  // Fit the calibrator on the OUT-OF-FOLD CV predictions (never in-sample), then map
  // every record's ranking score → calibrated P(include). Below the sample-size floor
  // the method is 'none' and calibratedProba stays null (the UI shows the raw score).
  const cfg = resolveConfig(config);
  let calibration = { method: 'none', params: null, metrics: null, reason: 'Calibration needs held-out predictions from cross-validation (not enough labels yet).' };
  if (cfg.calibration?.enabled && metrics.crossVal?.oof?.scores?.length) {
    try {
      const oof = metrics.crossVal.oof;
      // The PRODUCTION calibrator is fit on ALL out-of-fold pairs (best use of the data
      // for mapping every record's score → P(include)). Keep that as-is.
      calibration = fitCalibrator(oof.scores, oof.labels, cfg.calibration);
      // screeningEngine.md task 4 — but the panel must show HELD-OUT calibration quality,
      // not the apparent ECE≈0 (isotonic scored on its own fit points). Recompute the
      // reported ECE/slope/intercept via NESTED CV and surface THOSE; keep the apparent
      // numbers under `apparentMetrics` for provenance. Only the measurement changes.
      if (calibration.method !== 'none') {
        const heldOut = heldOutCalibrationMetrics(oof.scores, oof.labels, cfg.calibration);
        calibration.apparentMetrics = calibration.metrics;
        calibration.metrics = heldOut;
        calibration.heldOut = true;
      }
    } catch { /* keep 'none'/apparent on any calibration failure — scores remain usable */ }
  }
  for (const s of result.scores) {
    s.calibratedProba = calibration.method === 'none' ? null : applyCalibrator(calibration.params, s.score);
  }
  // Persist calibration metadata + params (not the per-point reliability arrays twice).
  metrics.calibration = calibration;

  // ── Recall-targeted operating point (66.md P4.5) ─────────────────────────────
  // Screening is recall-first: when the CROSS-VALIDATED operating point is reliable
  // (enough held-out labels), per-record predictions use the recall-targeted
  // threshold instead of the conservative fixed bands. Provenance is stamped on the
  // run so the UI can say exactly which policy produced each prediction.
  const op = (metrics.crossVal && metrics.crossVal.operatingPoint) || null;
  let predictionPolicy = 'conservative_bands';
  if (op && op.reliable) {
    predictionPolicy = 'recall_targeted';
    for (const s of result.scores) {
      s.prediction = s.score >= op.threshold ? 'include' : 'exclude';
    }
  }
  metrics.operatingPoint = op
    ? { ...op, applied: predictionPolicy === 'recall_targeted', source: 'cross_validated' }
    : null;
  metrics.predictionPolicy = predictionPolicy;

  // Citation feature availability for this run (66.md P4.3) — honest coverage.
  metrics.citation = result.meta.citation || { available: false, coverage: 0, nWithMetadata: 0 };

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

  // ── Model version lifecycle + drift (se2.md §11) ─────────────────────────────
  // This run is a new model version. Compare it to the previously ACTIVE version and
  // record drift warnings; stamp a reproducible snapshot hash + lineage. Best-effort —
  // a drift-comparison failure must never block the run.
  // prevActive is the lineage parent (parentRunId), so fetch it OUTSIDE the best-effort
  // drift block — a drift-math failure must never null the lineage. Only the pure drift
  // computation below is best-effort.
  const prevActive = await prisma.screenAiRun.findFirst({
    where: { projectId, stage, isActive: true, status: 'completed' },
    orderBy: { createdAt: 'desc' },
  });
  let driftSnap = null, drift = { baseline: true, warnings: [] }, snapHash = '';
  try {
    const dist = scoreHistogram(result.scores.map(s => s.score));
    driftSnap = runDriftSnapshot(metrics, dist);
    let prevSnap = null;
    if (prevActive) { try { prevSnap = JSON.parse(prevActive.driftJson || '{}').snapshot || null; } catch { prevSnap = null; } }
    drift = computeDrift(prevSnap, driftSnap, cfg.drift);
    metrics.drift = drift;
    snapHash = snapshotHash(input.labelByRecordId, { provider: config.provider, includeThreshold: aiProject.includeThreshold, calibration: calibration.method });
  } catch (e) { console.error('[ai] drift/version computation failed:', e.message); }

  // Create the run (ACTIVE) FIRST so every score is stamped with the real run id, persist
  // its scores, then demote the previous active version — all GUARDED so a mid-persist
  // failure can never leave TWO active versions (§11 invariant). On failure the just-
  // created run is flipped inactive/failed, so the previous active version stays sole-
  // active. (Concurrent runs for the same project+stage are serialized by withRunLock.)
  let run;
  try {
    run = await prisma.screenAiRun.create({
      data: {
        projectId, stage, status: 'completed', mode: result.meta.mode, trigger,
        nRecords: result.meta.nRecords,
        nScored: result.scores.length,
        nFeatures: result.meta.nFeatures,
        labelCountsJson: JSON.stringify(result.meta.labelCounts || {}),
        modelInfoJson: JSON.stringify(result.meta.modelInfo || {}),
        configJson: JSON.stringify({ provider: config.provider, embeddingProviderUsed, includeThreshold: aiProject.includeThreshold, engineConfigVersion, predictionPolicy, citationFeatures: !!(result.meta.citation && result.meta.citation.available) }),
        metricsJson: JSON.stringify(metrics),
        triggeredById: actor?.id || null,
        triggeredByName: actor?.name || actor?.email || '',
        isActive: true,
        parentRunId: prevActive?.id || null,
        rollbackFromRunId: rollbackFromRunId || null,
        snapshotHash: snapHash,
        featureVersion: FEATURE_VERSION,
        driftJson: JSON.stringify({ snapshot: driftSnap, drift }),
        startedAt, completedAt: new Date(),
      },
    });

    // Persist the latest score per (project, record, stage), stamped with run.id — in
    // CHUNKED TRANSACTIONS (se2.md §12) so a large review commits in bounded batches
    // (fewer round-trips, bounded write set) instead of N sequential upserts. Scores
    // become visible progressively as each chunk commits.
    const toData = (s) => ({
      runId: run.id, stage,
      score: s.score, proba: s.proba, calibratedProba: s.calibratedProba ?? null,
      coldStartScore: s.coldStartScore, uncertainty: s.uncertainty, confidence: s.confidence,
      prediction: s.prediction, band: s.band, mode: s.mode,
      lowConfidence: !!s.lowConfidence, missingAbstract: !!s.missingAbstract,
      picoMean: s.picoMean ?? null,
      subScoresJson: JSON.stringify(s.subScores || {}),
      signalsJson: JSON.stringify(s.signals || {}),
      explanationJson: JSON.stringify(s.explanation || {}),
    });
    let persisted = 0;
    report({ phase: 'persisting', processed: 0, total: result.scores.length });
    for (const part of chunk(result.scores, PERSIST_CHUNK)) {
      await prisma.$transaction(part.map(s => {
        const data = toData(s);
        return prisma.screenAiScore.upsert({
          where: { projectId_recordId_stage: { projectId, recordId: s.recordId, stage } },
          create: { projectId, recordId: s.recordId, ...data },
          update: data,
        });
      }));
      persisted += part.length;
      report({ phase: 'persisting', processed: persisted, total: result.scores.length });
      // Yield between chunks so a large commit never holds the event loop in one burst
      // (matters in inline-compute mode; harmless otherwise).
      await new Promise(r => setImmediate(r));
    }

    // Demote the previous active version(s) now that the new version's scores are live
    // (se2.md §11). Decisions, scores and the old run rows are all preserved — only the
    // ACTIVE pointer moves.
    await prisma.screenAiRun.updateMany({
      where: { projectId, stage, isActive: true, id: { not: run.id } },
      data: { isActive: false, supersededAt: new Date() },
    });
  } catch (persistErr) {
    // Keep "exactly one active": flip the half-written new run out of the active slot so
    // the previous active version (whose demote was skipped) remains the sole active one.
    if (run?.id) {
      await prisma.screenAiRun.update({
        where: { id: run.id },
        data: { isActive: false, status: 'failed', failureReason: String(persistErr?.message || persistErr).slice(0, 500) },
      }).catch(() => {});
    }
    throw persistErr;
  }

  writeAudit(projectId, actor, trigger === 'rollback' ? 'AI_MODEL_ROLLED_BACK' : 'AI_RUN_COMPLETED', {
    entityType: 'ScreenAiRun', entityId: run.id,
    details: { mode: result.meta.mode, scored: result.scores.length, labels: result.meta.labelCounts, auc: metrics.auc ?? null, driftWarnings: drift.warnings || [], rollbackFromRunId: rollbackFromRunId || null },
  });

  return { run, scoredCount: result.scores.length, meta: result.meta, metrics };
}

/**
 * rollbackToRun — revert to a previous model version (se2.md §11). The deterministic
 * engine re-scores using the TARGET run's pinned configuration (embedding provider +
 * threshold), producing a new ACTIVE version stamped as a rollback. Human decisions, all
 * prior runs, and their scores are preserved; only the active pointer and config change.
 * NOTE: this reverts the model CONFIGURATION and re-scores current data — it is not a
 * byte-identical restore of old scores (the deterministic engine reflects current
 * decisions). Documented honestly.
 *
 * @returns {Promise<{run:object, scoredCount:number, rolledBackFrom:string}>}
 */
export async function rollbackToRun({ projectId, runId, actor, stage = 'title_abstract' }) {
  const target = await prisma.screenAiRun.findFirst({ where: { id: runId, projectId, stage } });
  if (!target) throw Object.assign(new Error('Model version not found'), { status: 404 });
  if (target.status !== 'completed') throw Object.assign(new Error('Can only roll back to a completed model version'), { status: 400 });
  const cfg = safeParse(target.configJson, {});
  const out = await runScoring({
    projectId, stage, actor, trigger: 'rollback',
    // Pin BOTH the embedding provider and the engine config version of the target run,
    // so a rollback restores the exact prior model configuration (screeningEngine.md
    // task 3 — current/legacy version stays reachable).
    pinnedConfig: { provider: cfg.provider || { embedding: 'lexical' }, engineConfigVersion: cfg.engineConfigVersion || null },
    rollbackFromRunId: runId,
  });
  return { ...out, rolledBackFrom: runId };
}

/**
 * listModelVersions — recent model versions for a project/stage (se2.md §11), newest
 * first, with the lifecycle + drift summary the UI needs to show history + offer rollback.
 */
export async function listModelVersions(projectId, stage = 'title_abstract', limit = 20) {
  const runs = await prisma.screenAiRun.findMany({
    where: { projectId, stage }, orderBy: { createdAt: 'desc' }, take: Math.min(50, Math.max(1, limit)),
    select: {
      id: true, status: true, mode: true, isActive: true, supersededAt: true, parentRunId: true,
      rollbackFromRunId: true, snapshotHash: true, nScored: true, trigger: true,
      triggeredByName: true, metricsJson: true, driftJson: true, configJson: true, createdAt: true,
    },
  });
  return runs.map(r => {
    const drift = safeParse(r.driftJson, {});
    const metrics = safeParse(r.metricsJson, {});
    const config = safeParse(r.configJson, {});
    const cv = metrics.crossVal && metrics.crossVal.heldOut ? metrics.crossVal : metrics;
    const ecv = config.engineConfigVersion;
    return {
      id: r.id, status: r.status, mode: r.mode, isActive: r.isActive,
      supersededAt: r.supersededAt, parentRunId: r.parentRunId, rollbackFromRunId: r.rollbackFromRunId,
      snapshotHash: r.snapshotHash, nScored: r.nScored, trigger: r.trigger, by: r.triggeredByName,
      auc: typeof cv.auc === 'number' ? cv.auc : null,
      wss95: typeof cv.wss95 === 'number' ? cv.wss95 : null,
      // screeningEngine.md task 3 — the engine config version this run was scored under,
      // so the model-history UI can show and roll back to a specific configuration.
      engineConfigVersion: ecv || null,
      engineConfigLabel: (ecv && ENGINE_CONFIG_VERSIONS[ecv]?.label) || null,
      driftWarnings: drift.drift?.warnings || [],
      createdAt: r.createdAt,
    };
  });
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

/**
 * Strip every reviewer-derived signal from a persisted explanation payload
 * (prompt49 item 1 — blind-mode read-path defense-in-depth). Suppression at
 * SCORING time can go stale if blindMode is toggled ON after a non-blind run, so
 * we ALSO re-suppress on READ: a blind reviewer must never see signals derived
 * from peers' ratings/notes/decisions, regardless of when the row was scored.
 */
function stripReviewerSignals(payload) {
  if (payload.signals && typeof payload.signals === 'object') payload.signals.reviewer = null;
  const ex = payload.explanation;
  if (ex && typeof ex === 'object') {
    ex.reviewer = null;
    const dropReviewer = (arr) => Array.isArray(arr) ? arr.filter((r) => !String(r.kind || '').startsWith('reviewer_')) : arr;
    ex.reasonsInclude = dropReviewer(ex.reasonsInclude);
    ex.reasonsExclude = dropReviewer(ex.reasonsExclude);
  }
  return payload;
}

/** Full explanation for one record (persisted; no recompute). */
export async function getRecordExplanation(projectId, recordId, stage = 'title_abstract') {
  const [row, project] = await Promise.all([
    prisma.screenAiScore.findUnique({ where: { projectId_recordId_stage: { projectId, recordId, stage } } }),
    prisma.screenProject.findUnique({ where: { id: projectId }, select: { blindMode: true } }),
  ]);
  if (!row) return null;
  const payload = {
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
  // Blind review → never serve peer-derived reviewer signals (timing-independent).
  return project?.blindMode ? stripReviewerSignals(payload) : payload;
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
  // 66.md P4.10 — model status card: embedding provider + citation enrichment,
  // both best-effort (a status failure must never break the panel).
  const embedding = { provider: global.embeddingProvider || 'lexical', ...embeddingModelInfo(process.env) };
  let citationStatus = null;
  try { citationStatus = await getCitationStatus(projectId); } catch { citationStatus = null; }
  return {
    enabled: global.enabled && aiProject.enabled,
    project: aiProject,
    embedding,
    citation: citationStatus,
    global: { embeddingProvider: global.embeddingProvider, requireHumanFinalDecision: global.requireHumanFinalDecision, allowReviewersToRun: global.allowReviewersToRun },
    // screeningEngine.md task 3 — the active engine config version + the catalogue, so
    // the panel/admin can display and (for leaders) switch which engine scores the project.
    engineConfig: {
      active: aiProject.engineConfigVersion,
      activeLabel: ENGINE_CONFIG_VERSIONS[aiProject.engineConfigVersion]?.label || aiProject.engineConfigVersion,
      versions: listEngineConfigVersions(),
    },
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

// ── Representative validation seed samples (66.md P4.6) ──────────────────────

/**
 * createValidationSample — draw a seeded uniform-random sample of the project's
 * records for unbiased model validation. The seed + method + membership are
 * persisted so the sample (and every metric computed on it) is reproducible.
 *
 * @param {object} args {projectId, stage, size, seed, actor}
 */
export async function createValidationSample({ projectId, stage = 'title_abstract', size, seed, actor }) {
  const records = await prisma.screenRecord.findMany({
    where: { projectId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],   // deterministic base order
    select: { id: true },
  });
  if (!records.length) throw Object.assign(new Error('No records to sample'), { status: 400 });
  const n = Math.max(10, Math.min(Number(size) || 100, records.length));
  const s = Number.isFinite(Number(seed)) ? (Number(seed) >>> 0) : (Math.floor(Math.random() * 2 ** 31) >>> 0);

  // Seeded Fisher–Yates partial shuffle → first n ids form the sample.
  const ids = records.map(r => r.id);
  const rng = mulberry32(s);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const sampleIds = ids.slice(0, n);

  const sample = await prisma.screenValidationSample.create({
    data: {
      projectId, stage, seed: s, method: 'uniform_random', size: n,
      recordIds: JSON.stringify(sampleIds),
      createdById: actor?.id || null,
      createdByName: actor?.name || actor?.email || '',
    },
  });
  writeAudit(projectId, actor, 'AI_VALIDATION_SAMPLE_CREATED', {
    entityType: 'ScreenValidationSample', entityId: sample.id,
    details: { size: n, seed: s, method: 'uniform_random', stage },
  });
  return getValidationSampleStatus(projectId, stage);
}

/**
 * getValidationSampleStatus — latest sample + labelling progress, plus the
 * provenance summary the UI needs ("Current validation set: random/prioritized/
 * mixed"). Returns { sample: null } when no sample exists.
 */
export async function getValidationSampleStatus(projectId, stage = 'title_abstract') {
  const sample = await prisma.screenValidationSample.findFirst({
    where: { projectId, stage }, orderBy: { createdAt: 'desc' },
  });
  const input = await loadEngineInput(projectId, stage);
  const labeledIds = input ? Object.keys(input.labelByRecordId) : [];
  if (!sample) {
    return {
      sample: null,
      validationSource: labeledIds.length ? 'prioritized' : 'none',
      totalLabeled: labeledIds.length,
    };
  }
  const sampleIds = new Set(safeArray(sample.recordIds));
  const inSample = labeledIds.filter(id => sampleIds.has(id));
  return {
    sample: {
      id: sample.id, size: sample.size, seed: sample.seed, method: sample.method,
      createdAt: sample.createdAt, createdByName: sample.createdByName,
      recordIds: [...sampleIds],
      labeled: inSample.length,
      remaining: Math.max(0, sample.size - inSample.length),
      includes: inSample.filter(id => input.labelByRecordId[id] === 'include').length,
      excludes: inSample.filter(id => input.labelByRecordId[id] === 'exclude').length,
    },
    validationSource: inSample.length > 0
      ? (labeledIds.length === inSample.length ? 'random' : 'mixed')
      : (labeledIds.length ? 'prioritized' : 'none'),
    totalLabeled: labeledIds.length,
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
