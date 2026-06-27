/**
 * uploadLimit.js — the ONE resolver for the screening article upload limit
 * (58.md §3/§5). Nothing else should read the limit directly; everyone calls
 * resolveScreeningUploadLimit() so future per-user / paid-tier limits drop in here
 * without touching call sites.
 *
 * Resolution order (first defined wins), clamped to the hard safety ceiling:
 *   1. per-USER override          (future — not implemented; placeholder)
 *   2. organization/WORKSPACE     (future — the app has no orgs yet; placeholder)
 *   3. subscription PLAN/tier     (future — no billing yet; placeholder)
 *   4. global Ops Console default (settings.maxRecordsPerProject) — IMPLEMENTED
 *   5. code default               (DEFAULT_MAX_RECORDS_PER_PROJECT = 100,000)
 *   └─ hard ceiling               (MAX_RECORDS_PER_IMPORT = 200,000) — never exceeded
 *
 * Pure given its inputs (the caller passes the resolved Ops settings), so it is
 * unit-testable without a DB.
 */
import { DEFAULT_MAX_RECORDS_PER_PROJECT, MAX_RECORDS_PER_IMPORT } from '../services/screeningImportService.js';

/** Minimum a global/admin limit may be set to (matches the Ops Console validation). */
export const MIN_SCREENING_UPLOAD_LIMIT = 1000;

const posInt = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : null);

/**
 * resolveScreeningUploadLimit({ settings, userLimit, workspaceLimit, planLimit })
 * Returns the effective max records a project may hold. `settings` is the Ops
 * screening settings object (has maxRecordsPerProject). The override params are
 * accepted now (so call sites never change) but are null until those features ship.
 */
export function resolveScreeningUploadLimit({ settings = {}, userLimit = null, workspaceLimit = null, planLimit = null } = {}) {
  const layered =
    posInt(userLimit) ??                                  // 1. per-user (future)
    posInt(workspaceLimit) ??                             // 2. workspace/org (future)
    posInt(planLimit) ??                                  // 3. subscription tier (future)
    posInt(settings && settings.maxRecordsPerProject) ??  // 4. global Ops default
    DEFAULT_MAX_RECORDS_PER_PROJECT;                       // 5. code default (100k)
  // Floor at the minimum and never above the hard per-import safety ceiling.
  return Math.min(MAX_RECORDS_PER_IMPORT, Math.max(MIN_SCREENING_UPLOAD_LIMIT, layered));
}
