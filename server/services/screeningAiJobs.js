/**
 * screeningAiJobs.js — near-real-time background rescoring (se2.md §6/§12).
 *
 * When a reviewer finalises a new include/exclude decision, the engine should
 * re-rank using the latest human labels — but the decision request itself must
 * stay fast and must NEVER be blocked or lost by AI work. So scoring runs here,
 * asynchronously, with:
 *   - a short debounce (coalesce rapid decisions into one job),
 *   - one active job per (project, stage),
 *   - a rerun flag so decisions arriving mid-run are picked up afterwards,
 *   - a DB-backed ScreenAiJob row per run for observability/history,
 *   - graceful failure (the human decision is already saved; a failed job is
 *     recorded and the previous scores remain active).
 *
 * Single-node in-process scheduler. This is correct for the current single-node
 * deployment; a multi-node setup would swap the in-memory maps for a shared queue
 * (documented limitation — se2.md §12). The job table makes that migration clean.
 */
import { prisma } from '../db/client.js';
import { emitToProjectMembers } from '../realtime/bus.js';
import { aiFlagEnabled, getGlobalAiSettings, getProjectAiSettings, runScoring } from './screeningAiService.js';

const debounceTimers = new Map(); // key → Timeout
const active = new Set();          // key currently running
const rerun = new Set();           // key needs another run after the current one

const keyOf = (projectId, stage) => `${projectId}::${stage}`;

/** Whether live, decision-triggered rescoring is permitted for a project. */
export async function liveUpdateAllowed(projectId) {
  try {
    if (!(await aiFlagEnabled())) return false;
    const g = await getGlobalAiSettings();
    if (!g.enabled || g.liveUpdateEnabled === false) return false; // enabled already respects killSwitch
    const project = await prisma.screenProject.findUnique({ where: { id: projectId } });
    if (!project) return false;
    return !!getProjectAiSettings(project, g).enabled;
  } catch { return false; }
}

/**
 * scheduleRescore — debounce + enqueue a rescore for a project/stage. Fire-and-
 * forget; safe to call on every decision. The debounce window coalesces bursts.
 */
export function scheduleRescore(projectId, { stage = 'title_abstract', actor, debounceMs } = {}) {
  if (!projectId) return;
  const key = keyOf(projectId, stage);
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);
  const wait = Number.isFinite(debounceMs) ? debounceMs : null;
  const fire = () => { debounceTimers.delete(key); runJob(projectId, stage, actor).catch(() => {}); };
  // Resolve the debounce from settings on first schedule (best-effort; default 4s).
  if (wait != null) {
    const t = setTimeout(fire, wait); if (t.unref) t.unref(); debounceTimers.set(key, t);
    return;
  }
  getGlobalAiSettings()
    .then(g => { const ms = Number.isFinite(g.retrainDebounceMs) ? g.retrainDebounceMs : 4000; const t = setTimeout(fire, ms); if (t.unref) t.unref(); debounceTimers.set(key, t); })
    .catch(() => { const t = setTimeout(fire, 4000); if (t.unref) t.unref(); debounceTimers.set(key, t); });
}

async function runJob(projectId, stage, actor) {
  const key = keyOf(projectId, stage);
  if (active.has(key)) { rerun.add(key); return; }   // coalesce: a run is in progress
  if (!(await liveUpdateAllowed(projectId))) return;

  active.add(key);
  let job = null;
  const startedAt = new Date();
  try {
    job = await prisma.screenAiJob.create({
      data: { projectId, stage, kind: 'rescore', status: 'running', trigger: 'decision', startedAt },
    });
    const out = await runScoring({ projectId, stage, actor: actor || { id: 'system', name: 'auto-rescore' }, trigger: 'auto' });
    await prisma.screenAiJob.update({
      where: { id: job.id },
      data: { status: 'completed', runId: out.run.id, nScored: out.scoredCount, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime() },
    });
    emitToProjectMembers(projectId, { type: 'ai.updated' });
  } catch (e) {
    if (job) {
      await prisma.screenAiJob.update({
        where: { id: job.id },
        data: { status: 'failed', reason: String(e && e.message ? e.message : e).slice(0, 300), completedAt: new Date(), durationMs: Date.now() - startedAt.getTime() },
      }).catch(() => {});
    }
  } finally {
    active.delete(key);
    if (rerun.has(key)) { rerun.delete(key); scheduleRescore(projectId, { stage, actor }); }
  }
}

/**
 * getJobStatus — live state for the screening UI: whether a rescore is running or
 * queued, and how many include/exclude decisions have landed since the last
 * completed run (the "unprocessed decisions" count).
 */
export async function getJobStatus(projectId, stage = 'title_abstract') {
  const key = keyOf(projectId, stage);
  const [latest, lastCompleted] = await Promise.all([
    prisma.screenAiJob.findFirst({ where: { projectId, stage }, orderBy: { createdAt: 'desc' } }),
    prisma.screenAiJob.findFirst({ where: { projectId, stage, status: 'completed' }, orderBy: { completedAt: 'desc' } }),
  ]);
  const running = active.has(key) || latest?.status === 'running';
  const queued = debounceTimers.has(key) || rerun.has(key);
  let pending = 0;
  if (lastCompleted?.completedAt) {
    pending = await prisma.screenDecision.count({
      where: { projectId, stage, decision: { in: ['include', 'exclude'] }, updatedAt: { gt: lastCompleted.completedAt } },
    });
  }
  return {
    state: running ? 'updating' : (queued || pending > 0 ? 'queued' : 'idle'),
    running: !!running,
    queued: !!queued,
    pending,
    lastCompletedAt: lastCompleted?.completedAt || null,
    lastStatus: latest?.status || null,
    lastReason: latest?.status === 'failed' ? latest.reason : '',
  };
}

/** Test-only: clear in-memory scheduler state. */
export function _resetJobs() { for (const t of debounceTimers.values()) clearTimeout(t); debounceTimers.clear(); active.clear(); rerun.clear(); }
