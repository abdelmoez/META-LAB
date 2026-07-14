/**
 * searchModeStore.js — 78.md #5. ONE reactive, in-memory bridge for a project's
 * active search mode ('manual' | 'automated' | null), keyed by projectId.
 *
 * The in-body SearchWorkspace owns the mode decision (its local state + the persisted
 * `searchMode` on the search module). The WHITE project side-menu (StitchProjectSubnav
 * → navConfig.searchSubmenu → stagesFor) is a SIBLING component that must re-scope its
 * numbered stage list to the SAME mode the moment the body switches — without a page
 * reload. Before this, the subnav read the mode via a one-shot `loadSearch` fetch that
 * never re-ran on an in-body switch, so the menu could keep showing Database Strategies
 * after the user chose Automated (78.md #5).
 *
 * This store is that shared source of truth: the body PUBLISHES every mode change (and
 * its mount-load) here; the subnav's `useSearchMode` SUBSCRIBES so it re-renders
 * instantly. It is a display cache mirroring the persisted mode — the server stays
 * authoritative (a fresh page load seeds the cache from `loadSearch`). Pure module
 * state, no React/DOM, so it can be imported anywhere (nav layer included).
 */
const cache = new Map();   // projectId -> 'manual' | 'automated' | null
const subs = new Map();    // projectId -> Set<fn>

// 85.md — the per-stage completion statuses ({stageId: 'done'|'partial'|'empty'|
// 'attention'}) the mounted SearchWorkspace publishes so the white side-menu's
// numbered stepper can show honest per-stage status glyphs (navConfig.searchSubmenu
// reads this cache; glyph-less fallback when the workspace was never mounted).
const statusCache = new Map(); // projectId -> { [stageId]: status }
const statusSubs = new Map();  // projectId -> Set<fn>

const norm = (m) => (m === 'manual' || m === 'automated' ? m : null);

/** The cached mode for a project, or `undefined` when nothing has been resolved yet
 *  (distinct from `null`, which means "resolved: no mode chosen"). */
export function getSearchMode(projectId) {
  return projectId && cache.has(projectId) ? cache.get(projectId) : undefined;
}

/** Set the project's mode and notify every subscriber. Idempotent: a no-op when the
 *  value is unchanged (already cached to the same normalized mode), so republishing
 *  the same mode on every render never triggers a subscriber storm. */
export function publishSearchMode(projectId, mode) {
  if (!projectId) return;
  const m = norm(mode);
  if (cache.has(projectId) && cache.get(projectId) === m) return;
  cache.set(projectId, m);
  const set = subs.get(projectId);
  if (set) for (const fn of Array.from(set)) { try { fn(m); } catch { /* subscriber errors never block a publish */ } }
}

/** Subscribe to a project's mode changes. Returns an unsubscribe fn. */
export function subscribeSearchMode(projectId, fn) {
  if (!projectId || typeof fn !== 'function') return () => {};
  let set = subs.get(projectId);
  if (!set) { set = new Set(); subs.set(projectId, set); }
  set.add(fn);
  return () => { set.delete(fn); if (!set.size) subs.delete(projectId); };
}

/* ── 85.md — per-stage completion statuses (additive; mode API above unchanged) ── */

/** Sanitize a statuses object to plain {stageId: string} (junk → null). */
function normStatuses(statuses) {
  if (!statuses || typeof statuses !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(statuses)) {
    if (typeof k === 'string' && typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Deep-equal for the small flat status maps (publish must be idempotent). */
function statusesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a); const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/** The cached per-stage statuses for a project, or `undefined` when the workspace
 *  never published any (side-menu falls back to glyph-less rows). */
export function getSearchStageStatuses(projectId) {
  return projectId && statusCache.has(projectId) ? statusCache.get(projectId) : undefined;
}

/** Publish the project's per-stage statuses. Idempotent on deep-equal maps, so the
 *  workspace can republish every render without a subscriber storm. */
export function publishSearchStageStatuses(projectId, statuses) {
  if (!projectId) return;
  const s = normStatuses(statuses);
  if (s == null) return;
  if (statusCache.has(projectId) && statusesEqual(statusCache.get(projectId), s)) return;
  statusCache.set(projectId, s);
  const set = statusSubs.get(projectId);
  if (set) for (const fn of Array.from(set)) { try { fn(s); } catch { /* subscriber errors never block a publish */ } }
}

/** Subscribe to a project's stage-status changes. Returns an unsubscribe fn. */
export function subscribeSearchStageStatuses(projectId, fn) {
  if (!projectId || typeof fn !== 'function') return () => {};
  let set = statusSubs.get(projectId);
  if (!set) { set = new Set(); statusSubs.set(projectId, set); }
  set.add(fn);
  return () => { set.delete(fn); if (!set.size) statusSubs.delete(projectId); };
}

/** Test-only: clear all cached modes + statuses + subscribers. */
export function __resetSearchModeStore() {
  cache.clear();
  subs.clear();
  statusCache.clear();
  statusSubs.clear();
}
