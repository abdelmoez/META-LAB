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

// 114.md §2 r2 — the ADVISORY channel travels the SAME bridge. It used to stop dead
// at this boundary: the workspace computed { statuses, advisories } but published only
// the statuses, so the side-menu stepper (the ONLY stage list the production Stitch
// shell renders — the in-body rail is suppressed by `railHidden`) could never show the
// review counts. Advisories are counts that ride BESIDE a status and never demote it.
const advisoryCache = new Map(); // projectId -> { [stageId]: {suggestions,warnings,total} }

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

/** Sanitize an advisory map to {stageId: {suggestions, warnings, total}} (junk → null).
 *  A missing/!finite/negative count reads 0; a missing total is derived from the split
 *  so a partial payload can never invent review items. */
function normAdvisories(advisories) {
  if (!advisories || typeof advisories !== 'object') return null;
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const out = {};
  for (const [k, v] of Object.entries(advisories)) {
    if (typeof k !== 'string' || !v || typeof v !== 'object') continue;
    const suggestions = n(v.suggestions);
    const warnings = n(v.warnings);
    out[k] = { suggestions, warnings, total: Number.isFinite(v.total) ? n(v.total) : suggestions + warnings };
  }
  return Object.keys(out).length ? out : null;
}

/** Deep-equal for the small advisory maps (publish must be idempotent). */
function advisoriesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a); const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => b[k] && a[k].suggestions === b[k].suggestions
    && a[k].warnings === b[k].warnings && a[k].total === b[k].total);
}

/** The cached per-stage statuses for a project, or `undefined` when the workspace
 *  never published any (side-menu falls back to glyph-less rows). */
export function getSearchStageStatuses(projectId) {
  return projectId && statusCache.has(projectId) ? statusCache.get(projectId) : undefined;
}

/** The cached per-stage ADVISORY counts, or `undefined` when none were published.
 *  Separate accessor so `getSearchStageStatuses` keeps its long-standing shape. */
export function getSearchStageAdvisories(projectId) {
  return projectId && advisoryCache.has(projectId) ? advisoryCache.get(projectId) : undefined;
}

/**
 * Publish the project's per-stage truth. Two accepted payloads (114.md §2 r2 widened
 * the publisher without breaking a single existing caller):
 *   publishSearchStageStatuses(id, { terms: 'done', … })                 // statuses only
 *   publishSearchStageStatuses(id, { statuses: {…}, advisories: {…} })   // the full model
 * The model form is detected by a `statuses` object key — never a stage id, so the two
 * forms can never be confused. Idempotent on deep-equal BOTH channels, so the workspace
 * can republish every render without a subscriber storm; a change in EITHER channel
 * notifies, because an advisory count moving while the status holds ('done' with one
 * fewer suggestion) still has to repaint the stepper.
 * Subscribers receive (statuses, advisories) — the second arg is additive, so existing
 * one-arg subscribers are unaffected.
 */
export function publishSearchStageStatuses(projectId, payload) {
  if (!projectId) return;
  const isModel = !!payload && typeof payload === 'object'
    && payload.statuses && typeof payload.statuses === 'object';
  const s = normStatuses(isModel ? payload.statuses : payload);
  const a = isModel ? normAdvisories(payload.advisories) : null;
  if (s == null && a == null) return;
  const prevS = statusCache.get(projectId);
  const prevA = advisoryCache.get(projectId);
  const sameS = s == null || (statusCache.has(projectId) && statusesEqual(prevS, s));
  // A statuses-only publish carries NO advisory information — it leaves whatever the
  // model form last published intact rather than silently clearing it.
  const sameA = a == null || (advisoryCache.has(projectId) && advisoriesEqual(prevA, a));
  if (sameS && sameA) return;
  // Re-cache the FRESH statuses object even when it is only deep-equal: subscribers
  // (useSearchStageStatuses → setStatuses) re-render on reference identity, so an
  // advisory-only change must hand them a new reference or the stepper's count line
  // would go stale behind an unchanged status map.
  if (s != null) statusCache.set(projectId, s);
  if (a != null) advisoryCache.set(projectId, a);
  const nextS = statusCache.get(projectId);
  const nextA = advisoryCache.get(projectId);
  const set = statusSubs.get(projectId);
  if (set) for (const fn of Array.from(set)) { try { fn(nextS, nextA); } catch { /* subscriber errors never block a publish */ } }
}

/**
 * The ONE honest wording for an advisory count, shared by every surface that shows it
 * (the in-body rail pill + tooltip, the side-menu stepper's count line, and the aria
 * labels both build). 114.md §2 r2: the old copy called every advisory a "suggestion",
 * so a strategy carrying only QUALITY WARNINGS was announced as "2 suggestions to
 * review" — the split fields exist precisely so the label can stay true:
 *   suggestions only → "N suggestions to review"
 *   warnings only    → "N quality notes to review"
 *   both             → "N suggestions, M quality notes"
 * Returns '' when there is nothing to review (callers render no pill at all).
 */
export function searchAdvisoryLabel(adv) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const suggestions = n(adv && adv.suggestions);
  const warnings = n(adv && adv.warnings);
  const total = n(adv && adv.total) || (suggestions + warnings);
  if (!total) return '';
  const sug = (k) => `${k} suggestion${k === 1 ? '' : 's'}`;
  const note = (k) => `${k} quality note${k === 1 ? '' : 's'}`;
  if (suggestions && warnings) return `${sug(suggestions)}, ${note(warnings)}`;
  if (warnings) return `${note(warnings)} to review`;
  if (suggestions) return `${sug(suggestions)} to review`;
  // A total with no split (a legacy payload) — stay generic rather than guess a noun.
  return `${total} item${total === 1 ? '' : 's'} to review`;
}

/** Subscribe to a project's stage-status/advisory changes: fn(statuses, advisories).
 *  Returns an unsubscribe fn. */
export function subscribeSearchStageStatuses(projectId, fn) {
  if (!projectId || typeof fn !== 'function') return () => {};
  let set = statusSubs.get(projectId);
  if (!set) { set = new Set(); statusSubs.set(projectId, set); }
  set.add(fn);
  return () => { set.delete(fn); if (!set.size) statusSubs.delete(projectId); };
}

/** Test-only: clear all cached modes + statuses + advisories + subscribers. */
export function __resetSearchModeStore() {
  cache.clear();
  subs.clear();
  statusCache.clear();
  advisoryCache.clear();
  statusSubs.clear();
}
