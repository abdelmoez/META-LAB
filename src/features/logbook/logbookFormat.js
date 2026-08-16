/**
 * features/logbook/logbookFormat.js — 119.md §8 presentation helpers for the
 * Logbook. Pure (no React, no DOM writes, no network) so the unit tests can pin the
 * exact strings the interface shows.
 *
 * The vocabulary mirrors server/logbook/vocabulary.js — engines, statuses and actor
 * types are a CLOSED set on the server, so an unknown value here is displayed
 * verbatim rather than silently relabelled (an honest "we don't have a nicer name
 * for this yet" beats a wrong one).
 */
import { projectStageHref } from '../../frontend/stitch/nav/navConfig.js';

/** Engine → human label (server LOG_ENGINES, in the same order). */
export const ENGINE_LABELS = Object.freeze({
  core: 'Project & members',
  protocol: 'Protocol',
  search: 'Search',
  screening: 'Screening',
  extraction: 'Extraction',
  rob: 'Risk of bias',
  analysis: 'Analysis',
  manuscript: 'Manuscript',
  files: 'Files',
  logbook: 'Logbook access',
});

/** Status → label + legacy tag tone (server LOG_STATUSES). */
export const STATUS_META = Object.freeze({
  success: { label: 'Succeeded', tone: 'green' },
  failure: { label: 'Failed', tone: 'red' },
  reversed: { label: 'Reversed', tone: 'yellow' },
  restored: { label: 'Restored', tone: 'blue' },
});

/** Actor type → label (§8 "User, system, or automation actor type"). */
export const ACTOR_TYPE_LABELS = Object.freeze({
  user: 'Person',
  system: 'System',
  automation: 'Automation',
});

/** §8 "Human activity versus system activity filter" — the two-way split. */
export const ACTIVITY_FILTERS = Object.freeze([
  { value: '', label: 'People and system' },
  { value: 'user', label: 'People only' },
  { value: 'system,automation', label: 'System only' },
]);

/** How the action reached the server (server LOG_VIA). Only shown when notable. */
export const VIA_LABELS = Object.freeze({
  undo: 'via undo',
  redo: 'via redo',
  job: 'via a background job',
  api: 'via the API',
});

export const engineLabel = (e) => ENGINE_LABELS[e] || e || 'Other';
export const statusMeta = (s) => STATUS_META[s] || { label: s || 'Unknown', tone: 'grey' };
export const actorTypeLabel = (t) => ACTOR_TYPE_LABELS[t] || t || 'Unknown';

/** The viewer's own IANA zone — §8 "Clear timezone display". SSR-safe. */
export function viewerTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || 'UTC';
  } catch { return 'UTC'; }
}

/** A short zone label for the header line, e.g. "Europe/Paris (UTC+01:00)". */
export function timeZoneLabel(at = new Date()) {
  const tz = viewerTimeZone();
  const mins = -new Date(at).getTimezoneOffset();
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${tz} (UTC${sign}${hh}:${mm})`;
}

/** Stable YYYY-MM-DD key for day grouping, in the VIEWER's zone (not UTC). */
export function dayKey(at) {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "Today" / "Yesterday" / a written date — the timeline's day separators. */
export function dayLabel(at, now = new Date()) {
  const key = dayKey(at);
  if (!key) return 'Unknown date';
  if (key === dayKey(now)) return 'Today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === dayKey(y)) return 'Yesterday';
  try {
    return new Date(at).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return key; }
}

/** Clock time for a row. The full ISO instant is always available in the details. */
export function clockTime(at) {
  try { return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return ''; }
}

/** Absolute local timestamp for the table mode / details block. */
export function fullTime(at) {
  try { return new Date(at).toLocaleString(); } catch { return String(at || ''); }
}

/** The UTC instant, always shown next to the local one so a shared screenshot is unambiguous. */
export function isoTime(at) {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? d.toISOString() : '';
}

/** Group an already-sorted page into day buckets for the timeline. Order is preserved. */
export function groupByDay(events = []) {
  const out = [];
  for (const e of events) {
    const key = dayKey(e.at);
    const last = out[out.length - 1];
    if (last && last.key === key) last.events.push(e);
    else out.push({ key, label: dayLabel(e.at), events: [e] });
  }
  return out;
}

/** Render one before/after value compactly, without inventing precision. */
export function formatValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v === '' ? '(empty)' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.length ? v.map(formatValue).join(', ') : '(none)';
  try { return JSON.stringify(v); } catch { return String(v); }
}

/**
 * §8 "Clear before/after changes". Pairs the two structured summaries key-by-key
 * when both are objects; falls back to a single whole-value row otherwise. Keys
 * whose value did not change are dropped — the point is the DIFF.
 */
export function changePairs(before, after) {
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(before) || isObj(after)) {
    const b = isObj(before) ? before : {};
    const a = isObj(after) ? after : {};
    const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
    const pairs = keys
      .map((k) => ({ key: k, from: formatValue(b[k]), to: formatValue(a[k]) }))
      .filter((p) => p.from !== p.to);
    if (pairs.length) return pairs;
  }
  if (before === undefined || before === null) {
    if (after === undefined || after === null) return [];
    return [{ key: '', from: '—', to: formatValue(after) }];
  }
  const from = formatValue(before);
  const to = formatValue(after);
  return from === to ? [] : [{ key: '', from, to }];
}

/**
 * §8 "Links to affected resources when the viewer still has access".
 *
 * Only Owner/Leader ever render this page, and every destination below is a project
 * stage they can already open — so the link is honest by construction. Resource
 * types with no stable destination (or whose target is the Logbook itself) return
 * null rather than a link that would land on a guess.
 */
const RESOURCE_STAGE = Object.freeze({
  project: 'control', member: 'control', invite: 'control', settings: 'control',
  protocol: 'pico', pico: 'pico', eligibility: 'pico', registration: 'prospero',
  search: 'search', searchRun: 'search', searchStrategy: 'search', importBatch: 'search',
  record: 'screening', decision: 'screening', conflict: 'screening', duplicateGroup: 'screening',
  study: 'extraction', extraction: 'extraction', extractionField: 'extraction',
  rob: 'rob', robAssessment: 'rob',
  analysis: 'analysis', outcome: 'analysis',
  manuscript: 'manuscript', manuscriptSection: 'manuscript', table: 'manuscript',
  figure: 'manuscript', reference: 'manuscript', export: 'manuscript',
  prisma: 'prisma',
});

export function resourceLink(event, projectId) {
  if (!event || !projectId) return null;
  const type = String(event.resourceType || '');
  const stage = RESOURCE_STAGE[type];
  if (!stage) return null;
  return {
    href: projectStageHref(stage, { projectId }),
    label: event.resourceLabel || event.resourceId || type,
  };
}

/** The one-line identity of a resource, used when there is no link to give. */
export function resourceText(event) {
  if (!event || !event.resourceType) return '';
  const label = event.resourceLabel || event.resourceId || '';
  return label ? `${event.resourceType}: ${label}` : String(event.resourceType);
}

/** The actor line — name, role at the time, and whether it was a person. */
export function actorLine(event) {
  const name = (event && event.actorName) || '';
  const type = (event && event.actorType) || 'user';
  if (type !== 'user') return name ? `${actorTypeLabel(type)} · ${name}` : actorTypeLabel(type);
  const role = (event && event.actorRole) || '';
  const who = name || 'Unknown member';
  return role ? `${who} · ${role}` : who;
}

/**
 * §8 "Useful empty states" — say WHY it is empty, honestly. An unfiltered empty
 * Logbook is a young project; a filtered one is a filter that matched nothing.
 */
export function emptyStateCopy(filters = {}) {
  const active = countActiveFilters(filters);
  if (!active) {
    return {
      title: 'No activity recorded yet',
      body: 'Everything meaningful that happens in this project — imports, screening decisions, extractions, analyses, manuscript edits, member changes and exports — will appear here as it happens.',
    };
  }
  return {
    title: 'No events match these filters',
    body: 'Nothing in this project matches the filters you selected. Widen the date range or clear a filter to see more.',
  };
}

/**
 * 119.md §8 — how COMPLETE the loaded page really is.
 *
 * The server drains each history source until it can fill a page, but a selective
 * filter over deep bridged history can hit its scan bound first; the response then
 * carries `scanIncomplete`, meaning "this page came back short because we stopped
 * looking, not because the history ended". The interface must not translate that
 * into an empty state that says nothing matched — nobody checked yet.
 *
 *   complete  everything matching these filters is on screen
 *   more      there are definitely more matching entries behind the cursor
 *   partial   some entries are shown; older history has not been searched yet
 *   searching nothing found so far, and older history has not been searched yet
 */
export function completenessState({ loaded = 0, cursor = null, scanIncomplete = false } = {}) {
  if (!cursor) return 'complete';
  if (!loaded) return 'searching';
  return scanIncomplete ? 'partial' : 'more';
}

/** The copy for the two honest "we stopped looking, we did not finish" states. */
export function scanIncompleteCopy() {
  return {
    title: 'Nothing matched in the history searched so far',
    body: 'This project has more history than one page can search. Nothing here matches these filters yet, and the older entries have not been searched — keep loading to continue.',
    notice: 'Older entries have not been searched yet — keep loading to continue.',
  };
}

/** How many filters the viewer has actually applied (drives the empty state + the Clear button). */
export function countActiveFilters(f = {}) {
  let n = 0;
  if (f.q) n += 1;
  for (const k of ['engines', 'actions', 'members', 'roles', 'resourceTypes', 'statuses', 'actorTypes']) {
    if (Array.isArray(f[k]) && f[k].length) n += 1;
  }
  if (f.from) n += 1;
  if (f.to) n += 1;
  return n;
}

/**
 * §8 "Member-focused view" / "Engine-focused view". A focus is simply a filter
 * narrowed to exactly one member or one engine — the same query, announced clearly
 * at the top so the viewer knows they are no longer looking at the whole project.
 */
export function focusBanner(filters = {}, facets = {}) {
  const members = filters.members || [];
  const engines = filters.engines || [];
  if (members.length === 1) {
    const hit = (facets.actors || []).find((a) => a.value === members[0]);
    return { kind: 'member', label: `Everything ${hit ? hit.label : 'this member'} did in this project` };
  }
  if (engines.length === 1) {
    return { kind: 'engine', label: `All ${engineLabel(engines[0])} activity in this project` };
  }
  return null;
}

export default {
  ENGINE_LABELS, STATUS_META, ACTOR_TYPE_LABELS, ACTIVITY_FILTERS, VIA_LABELS,
  engineLabel, statusMeta, actorTypeLabel, viewerTimeZone, timeZoneLabel,
  dayKey, dayLabel, clockTime, fullTime, isoTime, groupByDay,
  formatValue, changePairs, resourceLink, resourceText, actorLine,
  emptyStateCopy, completenessState, scanIncompleteCopy, countActiveFilters, focusBanner,
};
