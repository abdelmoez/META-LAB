/**
 * server/living/livingService.js — living systematic reviews (66.md P6, flag
 * `livingReview`, default OFF).
 *
 * Responsibilities:
 *  - saved-search lifecycle (each stores the EXACT canonical query snapshot);
 *  - launching update runs through the existing Pecan Search engine (durable
 *    worker, dedup pipeline, PRISMA-S accounting all reused — never duplicated);
 *  - reconciling completed runs back onto the saved search (stats, notifications,
 *    AI pre-scoring of new records, automatic update snapshot);
 *  - reproducible review snapshots (summary-only: counts + MA results + model
 *    version + search provenance — never a full data copy);
 *  - cautious evidence-shift alerts (pure detection in research-engine).
 */
import { prisma } from '../db/client.js';
import { createNotification } from '../services/notificationService.js';
import { scheduleRescore } from '../services/screeningAiJobs.js';
import { startRun, pecanSearchEnabled } from '../pecanSearch/runService.js';
import { runMeta } from '../../src/research-engine/statistics/meta-analysis.js';
import { detectEvidenceShift, DEFAULT_SHIFT_THRESHOLDS } from '../../src/research-engine/statistics/evidenceShift.js';
import { computeNextRunAt, CADENCES } from '../../src/research-engine/living/schedule.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FLAG = 'livingReview';
export const LIVING_SETTINGS_KEY = 'livingReviewSettings';

export const LIVING_DEFAULTS = Object.freeze({
  schedulerEnabled: true,
  allowedCadences: ['manual', 'daily', 'weekly', 'monthly'],
  maxSavedSearchesPerProject: 5,
  snapshotRetention: 100,
  evidenceShift: { ...DEFAULT_SHIFT_THRESHOLDS },
});

function safeParse(s, fallback) {
  try { const v = JSON.parse(s ?? ''); return v ?? fallback; } catch { return fallback; }
}

/** Whether the `livingReview` feature flag is on (fail-closed). */
export async function livingReviewEnabled() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
    return safeParse(row.value, {})[FLAG] === true;
  } catch { return false; }
}

/** Global admin living-review settings (defaults merged under the stored row). */
export async function getLivingSettings() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: LIVING_SETTINGS_KEY } });
    const stored = safeParse(row?.value, {});
    return {
      ...LIVING_DEFAULTS,
      ...stored,
      evidenceShift: { ...LIVING_DEFAULTS.evidenceShift, ...(stored.evidenceShift || {}) },
    };
  } catch { return { ...LIVING_DEFAULTS, evidenceShift: { ...LIVING_DEFAULTS.evidenceShift } }; }
}

let _appVersion = null;
function appVersion() {
  if (_appVersion == null) {
    try {
      const dir = path.dirname(fileURLToPath(import.meta.url));
      _appVersion = JSON.parse(readFileSync(path.join(dir, '..', 'version.json'), 'utf8')).version || '';
    } catch { _appVersion = ''; }
  }
  return _appVersion;
}

// ── Notifications ─────────────────────────────────────────────────────────────

/** Owner + active leaders of the linked screening workspaces (deduplicated). */
async function projectLeaderIds(metaLabProjectId) {
  const targets = new Set();
  const project = await prisma.project.findFirst({ where: { id: metaLabProjectId, deletedAt: null }, select: { userId: true } });
  if (project) targets.add(project.userId);
  const sps = await prisma.screenProject.findMany({
    where: { linkedMetaLabProjectId: metaLabProjectId, deletedAt: null },
    select: { id: true, ownerId: true },
  });
  for (const sp of sps) targets.add(sp.ownerId);
  if (sps.length) {
    const leaders = await prisma.screenProjectMember.findMany({
      where: { projectId: { in: sps.map(s => s.id) }, status: 'active', role: { in: ['owner', 'leader'] }, userId: { not: null } },
      select: { userId: true },
    });
    for (const l of leaders) if (l.userId) targets.add(l.userId);
  }
  return { userIds: [...targets], screenProjectId: sps[0]?.id || null };
}

/** Best-effort in-app notification fan-out to owner/leaders. */
export async function notifyLeaders(metaLabProjectId, { type, title, message }) {
  try {
    const { userIds, screenProjectId } = await projectLeaderIds(metaLabProjectId);
    await Promise.all(userIds.map(userId => createNotification({
      userId, type, title, message,
      app: 'metalab',
      relatedMetaLabProjectId: metaLabProjectId,
      relatedScreenProjectId: screenProjectId,
    })));
  } catch { /* notifications are best-effort */ }
}

// ── Saved searches ────────────────────────────────────────────────────────────

export function shapeSearch(row) {
  return {
    id: row.id,
    name: row.name,
    providerIds: safeParse(row.providerIds, []),
    canonicalText: row.canonicalText || '',
    cadence: row.cadence,
    enabled: row.enabled,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastRunId: row.lastRunId,
    lastRunState: row.lastRunState,
    lastResultCount: row.lastResultCount,
    lastNewCount: row.lastNewCount,
    lastError: row.lastError,
    notes: row.notes,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createSavedSearch(metaLabProjectId, body, actor) {
  const settings = await getLivingSettings();
  const count = await prisma.livingSavedSearch.count({ where: { metaLabProjectId } });
  if (count >= settings.maxSavedSearchesPerProject) {
    throw Object.assign(new Error(`This project already has ${count} saved searches (max ${settings.maxSavedSearchesPerProject}).`), { status: 400 });
  }
  const cadence = CADENCES.includes(body.cadence) ? body.cadence : 'manual';
  if (!settings.allowedCadences.includes(cadence)) {
    throw Object.assign(new Error(`Cadence "${cadence}" is not allowed by the administrator.`), { status: 400 });
  }
  const canonicalQuery = body.canonicalQuery && typeof body.canonicalQuery === 'object' ? body.canonicalQuery : null;
  if (!canonicalQuery) throw Object.assign(new Error('A canonical query snapshot is required (build the search strategy first).'), { status: 400 });
  const providerIds = Array.isArray(body.providerIds) ? body.providerIds.filter(p => typeof p === 'string').slice(0, 10) : [];
  if (!providerIds.length) throw Object.assign(new Error('Select at least one search source.'), { status: 400 });

  const row = await prisma.livingSavedSearch.create({
    data: {
      metaLabProjectId,
      name: String(body.name || 'Living search').slice(0, 200),
      providerIds: JSON.stringify(providerIds),
      canonicalQuery: JSON.stringify(canonicalQuery),
      canonicalText: String(body.canonicalText || '').slice(0, 5000),
      cadence,
      enabled: body.enabled !== false,
      nextRunAt: cadence !== 'manual' ? new Date(computeNextRunAt(cadence, new Date().toISOString())) : null,
      notes: body.notes ? String(body.notes).slice(0, 2000) : null,
      createdById: actor?.id || null,
      createdByName: actor?.name || actor?.email || '',
    },
  });
  return shapeSearch(row);
}

export async function updateSavedSearch(metaLabProjectId, searchId, body) {
  const settings = await getLivingSettings();
  const row = await prisma.livingSavedSearch.findFirst({ where: { id: searchId, metaLabProjectId } });
  if (!row) throw Object.assign(new Error('Saved search not found'), { status: 404 });
  const data = {};
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 200);
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (typeof body.notes === 'string') data.notes = body.notes.slice(0, 2000);
  if (Array.isArray(body.providerIds) && body.providerIds.length) data.providerIds = JSON.stringify(body.providerIds.slice(0, 10));
  if (body.canonicalQuery && typeof body.canonicalQuery === 'object') {
    data.canonicalQuery = JSON.stringify(body.canonicalQuery);
    if (typeof body.canonicalText === 'string') data.canonicalText = body.canonicalText.slice(0, 5000);
  }
  if (typeof body.cadence === 'string' && CADENCES.includes(body.cadence)) {
    if (!settings.allowedCadences.includes(body.cadence)) {
      throw Object.assign(new Error(`Cadence "${body.cadence}" is not allowed by the administrator.`), { status: 400 });
    }
    data.cadence = body.cadence;
    data.nextRunAt = body.cadence !== 'manual' ? new Date(computeNextRunAt(body.cadence, new Date().toISOString())) : null;
  }
  const updated = await prisma.livingSavedSearch.update({ where: { id: row.id }, data });
  return shapeSearch(updated);
}

// ── Update runs ───────────────────────────────────────────────────────────────

/**
 * runSavedSearch — launch a Pecan Search run from a saved search's stored query
 * snapshot. `reason` 'manual' | 'scheduled'. Requires the pecanSearch engine.
 */
export async function runSavedSearch(search, { actorId, reason = 'manual' } = {}) {
  if (!(await pecanSearchEnabled())) {
    throw Object.assign(new Error('Automated re-runs need the Pecan Search engine (flags searchEngine + pecanSearch).'), { status: 409, code: 'PECAN_DISABLED' });
  }
  const canonicalQuery = safeParse(search.canonicalQuery, null);
  if (!canonicalQuery) throw Object.assign(new Error('This saved search has no stored query snapshot.'), { status: 400 });
  const providerIds = safeParse(search.providerIds, []);
  const userId = actorId || search.createdById;
  if (!userId) throw Object.assign(new Error('No user available to run this search as.'), { status: 400 });

  // Idempotency: scheduled runs are keyed by the period (nextRunAt) so restarts
  // never double-run a period; manual runs get a fresh key per click.
  const idempotencyKey = reason === 'scheduled'
    ? `living:${search.id}:${search.nextRunAt ? new Date(search.nextRunAt).toISOString() : 'once'}`
    : `living:${search.id}:manual:${Date.now()}`;

  const { run } = await startRun({
    metaLabProjectId: search.metaLabProjectId,
    user: { id: userId },
    name: `Living update — ${search.name}`,
    canonicalQuery,
    sources: providerIds,
    idempotencyKey,
  });

  const now = new Date();
  await prisma.livingSavedSearch.update({
    where: { id: search.id },
    data: {
      lastRunAt: now,
      lastRunId: run.id,
      lastRunState: run.state,
      lastError: null,
      nextRunAt: search.cadence !== 'manual'
        ? new Date(computeNextRunAt(search.cadence, now.toISOString()))
        : null,
    },
  });
  return run;
}

/**
 * reconcileSearch — sync a saved search with its latest run's terminal state.
 * On a NEWLY completed run: update stats, notify leaders, pre-score new records
 * with the current project model, and create an automatic update snapshot (which
 * also performs the evidence-shift check). Safe to call repeatedly.
 */
export async function reconcileSearch(search) {
  if (!search.lastRunId) return search;
  const run = await prisma.pecanSearchRun.findUnique({ where: { id: search.lastRunId } });
  if (!run) return search;
  const state = run.state;
  const terminal = ['completed', 'partial', 'failed', 'cancelled'].includes(state);
  if (!terminal || search.lastRunState === state) {
    if (search.lastRunState !== state) {
      const updated = await prisma.livingSavedSearch.update({ where: { id: search.id }, data: { lastRunState: state } });
      return updated;
    }
    return search;
  }

  const counts = safeParse(run.counts, {});
  const imported = Number(counts.imported ?? counts.recordsToScreening ?? 0) || 0;
  const raw = Number(counts.rawRetrieved ?? counts.raw ?? 0) || 0;
  const updated = await prisma.livingSavedSearch.update({
    where: { id: search.id },
    data: {
      lastRunState: state,
      lastResultCount: raw || imported,
      lastNewCount: imported,
      lastError: state === 'failed' ? String(safeParse(run.errorSummary, {})?.message || 'Search run failed').slice(0, 500) : null,
    },
  });

  if (state === 'failed') {
    await notifyLeaders(search.metaLabProjectId, {
      type: 'LIVING_RUN_FAILED',
      title: 'Living review search failed',
      message: `Scheduled search “${search.name}” failed. Open the Living Review dashboard to retry.`,
    });
    return updated;
  }

  await notifyLeaders(search.metaLabProjectId, {
    type: 'LIVING_RUN_COMPLETED',
    title: imported > 0 ? `${imported} new record${imported === 1 ? '' : 's'} found` : 'Living review search completed',
    message: imported > 0
      ? `Search “${search.name}” found ${imported} new record${imported === 1 ? '' : 's'} — they are waiting in the screening queue, pre-scored by the project's AI model.`
      : `Search “${search.name}” completed with no new records.`,
  });

  // AI pre-scoring of the new records with the CURRENT project model (P6.4) —
  // reuses the durable rescore job; a disabled AI simply no-ops.
  if (imported > 0 && run.screenProjectId) {
    scheduleRescore(run.screenProjectId, { stage: 'title_abstract', actor: { id: 'system', name: 'living-review' }, debounceMs: 500 });
  }

  // Automatic reproducible snapshot for the update (P6.7) + evidence-shift check.
  try {
    await createSnapshot(search.metaLabProjectId, {
      kind: 'update',
      label: `Update — ${search.name}`,
      runId: run.id,
      actor: { id: 'system', name: 'living-review' },
    });
  } catch { /* snapshot is best-effort here; manual snapshots remain available */ }

  return updated;
}

// ── Snapshots (P6.7) ─────────────────────────────────────────────────────────

/** Build the summary-only snapshot payload for a project. */
export async function buildSnapshotSummary(metaLabProjectId) {
  const project = await prisma.project.findFirst({ where: { id: metaLabProjectId, deletedAt: null } });
  if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
  const data = safeParse(project.data, {});
  const studies = Array.isArray(data.studies) ? data.studies : [];

  // Screening counts across linked workspaces.
  const sps = await prisma.screenProject.findMany({
    where: { linkedMetaLabProjectId: metaLabProjectId, deletedAt: null },
    select: { id: true },
  });
  const spIds = sps.map(s => s.id);
  let screening = { total: 0, decided: 0, includedK: 0, fullTextAssessed: 0 };
  let prismaCounts = { identified: null, duplicatesRemoved: null, screened: null, fullTextAssessed: null, included: null };
  let aiModel = null;
  if (spIds.length) {
    const [total, batches, decidedRecords, accepted, fullText, latestRun] = await Promise.all([
      prisma.screenRecord.count({ where: { projectId: { in: spIds } } }),
      prisma.screenImportBatch.findMany({ where: { projectId: { in: spIds } }, select: { duplicateCount: true } }),
      prisma.screenDecision.findMany({ where: { projectId: { in: spIds }, decision: { in: ['include', 'exclude', 'maybe'] } }, select: { recordId: true }, distinct: ['recordId'] }),
      prisma.screenRecord.count({ where: { projectId: { in: spIds }, finalStatus: 'accepted' } }),
      prisma.screenRecord.count({ where: { projectId: { in: spIds }, currentStage: 'full_text' } }),
      prisma.screenAiRun.findFirst({ where: { projectId: { in: spIds }, isActive: true, status: 'completed' }, orderBy: { createdAt: 'desc' }, select: { id: true, configJson: true, snapshotHash: true } }),
    ]);
    const importDups = batches.reduce((a, b) => a + (b.duplicateCount || 0), 0);
    screening = { total, decided: decidedRecords.length, includedK: accepted, fullTextAssessed: fullText + accepted };
    prismaCounts = {
      identified: total + importDups,
      duplicatesRemoved: importDups,
      screened: decidedRecords.length,
      fullTextAssessed: fullText + accepted,
      included: accepted,
    };
    if (latestRun) {
      const cfg = safeParse(latestRun.configJson, {});
      aiModel = { runId: latestRun.id, engineConfigVersion: cfg.engineConfigVersion || null, snapshotHash: latestRun.snapshotHash || null };
    }
  }

  // Meta-analysis results per (outcome, timepoint, esType) — canonical engine,
  // same grouping rule as the Analysis tab.
  const groups = new Map();
  for (const s of studies) {
    if (s.es === '' || s.lo === '' || s.hi === '' || s.es == null) continue;
    const key = `${s.outcome || 'Primary'}||${s.timepoint || ''}||${s.esType || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const ma = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const [outcome, timepoint, esType] = key.split('||');
    try {
      const result = runMeta(group, 'random');
      if (!result) continue;
      ma.push({
        outcome, timepoint, esType,
        k: result.k, es: result.pES, lo: result.lo95, hi: result.hi95,
        pval: result.pval, i2: result.I2, method: result.method,
      });
    } catch { /* skip un-poolable groups */ }
  }
  ma.sort((a, b) => (a.outcome + a.timepoint).localeCompare(b.outcome + b.timepoint));

  const [consensusCount, searches] = await Promise.all([
    prisma.extractionConsensus.count({ where: { projectId: metaLabProjectId } }).catch(() => 0),
    prisma.livingSavedSearch.findMany({ where: { metaLabProjectId }, select: { name: true, lastResultCount: true, lastNewCount: true, lastRunAt: true, canonicalText: true } }),
  ]);

  return {
    createdAt: new Date().toISOString(),
    prisma: prismaCounts,
    screening,
    extraction: { consensusCount, studiesWithEs: studies.filter(s => s.es !== '' && s.es != null).length, totalStudies: studies.length },
    ma,
    model: aiModel,
    searches: searches.map(s => ({ name: s.name, resultCount: s.lastResultCount, newCount: s.lastNewCount, lastRunAt: s.lastRunAt, query: (s.canonicalText || '').slice(0, 500) })),
  };
}

/**
 * createSnapshot — persist a snapshot + run the evidence-shift check against the
 * previous snapshot (alerts + notification on any shift; severity from the pure
 * detector). Retention-prunes oldest snapshots past the admin limit.
 */
export async function createSnapshot(metaLabProjectId, { kind = 'manual', label = null, runId = null, actor } = {}) {
  const summary = await buildSnapshotSummary(metaLabProjectId);
  const prev = await prisma.reviewSnapshot.findFirst({
    where: { metaLabProjectId },
    orderBy: { createdAt: 'desc' },
  });
  const snapshot = await prisma.reviewSnapshot.create({
    data: {
      metaLabProjectId, kind, label, runId,
      appVersion: appVersion(),
      summary: JSON.stringify(summary),
      createdById: actor?.id || null,
      createdByName: actor?.name || actor?.email || '',
    },
  });

  // Evidence-shift check (P6.9) — cautious, reproducible, never definitive.
  let alert = null;
  if (prev) {
    try {
      const settings = await getLivingSettings();
      const prevSummary = safeParse(prev.summary, {});
      const res = detectEvidenceShift(prevSummary.ma || [], summary.ma || [], settings.evidenceShift);
      if (res.any) {
        const severity = res.shifts.some(s => s.severity === 'major') ? 'major'
          : res.shifts.some(s => s.severity === 'notable') ? 'notable' : 'info';
        alert = await prisma.evidenceShiftAlert.create({
          data: {
            metaLabProjectId,
            snapshotId: snapshot.id,
            prevSnapshotId: prev.id,
            severity,
            shifts: JSON.stringify(res.shifts),
          },
        });
        if (severity !== 'info') {
          await notifyLeaders(metaLabProjectId, {
            type: 'EVIDENCE_SHIFT',
            title: 'Potential evidence shift detected',
            message: 'A living-review update changed a meta-analysis result since the last snapshot. This is not an automatic conclusion — review recommended.',
          });
        }
      }
    } catch { /* shift detection is best-effort */ }
  }

  // Retention pruning (oldest first, never the one just created).
  try {
    const settings = await getLivingSettings();
    const count = await prisma.reviewSnapshot.count({ where: { metaLabProjectId } });
    if (count > settings.snapshotRetention) {
      const oldest = await prisma.reviewSnapshot.findMany({
        where: { metaLabProjectId }, orderBy: { createdAt: 'asc' }, take: count - settings.snapshotRetention,
        select: { id: true },
      });
      await prisma.reviewSnapshot.deleteMany({ where: { id: { in: oldest.map(o => o.id) } } });
    }
  } catch { /* pruning is best-effort */ }

  return { snapshot, alert };
}

// ── New-since-last-run queue (P6.3) ──────────────────────────────────────────

/**
 * getUpdateQueue — records landed by living-review runs that no reviewer has
 * decided yet, with their AI scores for priority triage.
 */
export async function getUpdateQueue(metaLabProjectId, { limit = 200 } = {}) {
  const livingRuns = await prisma.pecanSearchRun.findMany({
    where: { metaLabProjectId, idempotencyKey: { startsWith: 'living:' } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, screenProjectId: true, name: true, completedAt: true, state: true },
  });
  if (!livingRuns.length) return { records: [], runs: [] };
  const sourceRecords = await prisma.pecanSourceRecord.findMany({
    where: { runId: { in: livingRuns.map(r => r.id) }, screenRecordId: { not: null }, dedupOutcome: { in: ['new', 'ambiguous'] } },
    select: { runId: true, screenRecordId: true },
  });
  const recordIds = [...new Set(sourceRecords.map(r => r.screenRecordId))];
  if (!recordIds.length) return { records: [], runs: livingRuns };

  const [records, decisions, scores] = await Promise.all([
    prisma.screenRecord.findMany({
      where: { id: { in: recordIds } },
      select: { id: true, projectId: true, title: true, authors: true, year: true, journal: true, doi: true, pmid: true, createdAt: true },
    }),
    prisma.screenDecision.findMany({
      where: { recordId: { in: recordIds }, decision: { in: ['include', 'exclude', 'maybe'] } },
      select: { recordId: true }, distinct: ['recordId'],
    }),
    prisma.screenAiScore.findMany({
      where: { recordId: { in: recordIds }, stage: 'title_abstract' },
      select: { recordId: true, score: true, calibratedProba: true, prediction: true, band: true, runId: true },
    }),
  ]);
  const decided = new Set(decisions.map(d => d.recordId));
  const scoreById = new Map(scores.map(s => [s.recordId, s]));
  const runByRecord = new Map(sourceRecords.map(r => [r.screenRecordId, r.runId]));

  const pending = records
    .filter(r => !decided.has(r.id))
    .map(r => ({
      recordId: r.id,
      screenProjectId: r.projectId,
      title: r.title, authors: r.authors, year: r.year, journal: r.journal,
      doi: r.doi, pmid: r.pmid,
      addedAt: r.createdAt,
      runId: runByRecord.get(r.id) || null,
      ai: scoreById.has(r.id) ? {
        score: scoreById.get(r.id).score,
        calibratedProba: scoreById.get(r.id).calibratedProba,
        prediction: scoreById.get(r.id).prediction,
        band: scoreById.get(r.id).band,
      } : null,
    }))
    .sort((a, b) => (b.ai?.score ?? -1) - (a.ai?.score ?? -1))
    .slice(0, limit);

  return { records: pending, runs: livingRuns, totalPending: records.filter(r => !decided.has(r.id)).length };
}
