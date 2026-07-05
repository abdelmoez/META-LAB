/**
 * useProjectProgress.js — 75.md Phases 8-9 (Workstream F).
 *
 * The ONE client entry point for a project's canonical workflow progress. Every
 * Stitch surface (the top-header progress bar, the Project Overview numbers, the
 * workflow rail dots) reads from THIS hook so they can never disagree.
 *
 * Source of truth priority:
 *   1. `project._progress` — the transient annotation the server attaches to
 *      GET /api/projects/:id (computeProjectProgress run server-side with the
 *      first-class screening / search / RoB evidence it alone can see). When
 *      present it wins verbatim — ZERO new fetches, and it is the value the
 *      dashboard/rail share.
 *   2. Client fallback — the IDENTICAL pure model (computeProjectProgress) run in
 *      the browser from the blob plus the `_linkedMetaSift` screening counts that
 *      already ride on the project object. Used only until the server annotation
 *      is present (older payloads / optimistic edits), so a surface is never blank.
 *
 * Re-derives whenever the project object identity changes — the existing realtime
 * pokes (project.updated / search.updated / decision.saved / handoff.updated) call
 * setProject with a fresh object, so the bar and numbers live-update for free.
 */
import { useMemo } from 'react';
import { computeProjectProgress } from '../../../research-engine/progress/projectProgress.js';

const EMPTY = Object.freeze({ pct: 0, steps: [], requiredDone: 0, requiredTotal: 0, nextStepId: null });

/**
 * @param {object|null} project  the project object from api.projects.get (may carry
 *   the transient `_progress` annotation and `_linkedMetaSift` counts).
 * @returns {{ pct:number, steps:Array, requiredDone:number, requiredTotal:number,
 *            nextStepId:string|null }}
 */
export function useProjectProgress(project) {
  return useMemo(() => {
    if (!project) return EMPTY;

    // 1. Server-computed canonical annotation wins (the value every surface shares).
    const srv = project._progress;
    if (srv && typeof srv.pct === 'number' && Array.isArray(srv.steps)) {
      const required = srv.steps.filter((s) => s && s.required);
      return {
        pct: srv.pct,
        steps: srv.steps,
        requiredDone: typeof srv.requiredDone === 'number'
          ? srv.requiredDone
          : required.filter((s) => s.status === 'done').length,
        requiredTotal: typeof srv.requiredTotal === 'number'
          ? srv.requiredTotal
          : required.length,
        nextStepId: srv.nextStepId != null ? srv.nextStepId : null,
      };
    }

    // 2. Client fallback: the identical pure model, fed the blob + the screening
    //    counts already on the object (no new request). networkMetaAnalysis is left
    //    off here, so `nma` is non-required and 100% stays reachable — mirroring how
    //    the server excludes it when the flag is off.
    const lm = project._linkedMetaSift;
    const evidence = lm
      ? {
          screening: {
            decidedCount: lm.decidedCount,
            screenablePool: lm.screenablePool,
            recordCount: lm.recordCount,
            progressStatus: lm.progressStatus,
          },
        }
      : {};
    return computeProjectProgress(project, evidence);
  }, [project]);
}

export default useProjectProgress;
