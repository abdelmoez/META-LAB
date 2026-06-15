/**
 * projectLanding.helpers.js — pure helpers extracted from ProjectLanding.jsx.
 *
 * No React import. Unit-testable in jsdom/node without a DOM.
 * May import theme tokens (non-React).
 */
import { C } from '../theme/tokens.js';

/* ════════════════════════════════════════════════════════════════════════
   Role display
   ════════════════════════════════════════════════════════════════════════ */

export const ROLE_LABEL = { owner: 'Owner', leader: 'Leader', reviewer: 'Reviewer', viewer: 'Viewer' };
export const ROLE_COLOR = { owner: 'gold', leader: 'purple', reviewer: 'blue', viewer: 'default' };

/* ════════════════════════════════════════════════════════════════════════
   Status derivation
   ════════════════════════════════════════════════════════════════════════ */

/** Derive a coarse lifecycle status for a project row. */
export function statusOf(p) {
  if (p._archived) return 'archived';
  const ps = p._linkedMetaSift && p._linkedMetaSift.progressStatus;
  if (ps === 'done') return 'done';
  if (ps === 'in_progress') return 'in_progress';
  return 'active';
}

export const STATUS_META = {
  active:      { label: 'Active',      color: C.acc,   tag: 'blue'   },
  in_progress: { label: 'In progress', color: C.acc,   tag: 'blue'   },
  done:        { label: 'Done',        color: C.grn,   tag: 'green'  },
  archived:    { label: 'Archived',    color: C.muted, tag: 'default'},
};

/* ════════════════════════════════════════════════════════════════════════
   Role / permission accessors
   ════════════════════════════════════════════════════════════════════════ */

export function roleOf(p) {
  const r = (p._permissions && p._permissions.role) || p._role || 'owner';
  return r;
}
export function isOwnerOf(p) {
  if (p._permissions && typeof p._permissions.isOwner === 'boolean') return p._permissions.isOwner;
  return roleOf(p) === 'owner' && !p._shared;
}
export function canEditOf(p) {
  if (p._permissions && typeof p._permissions.canEdit === 'boolean') return p._permissions.canEdit;
  return !!p._canEdit || isOwnerOf(p);
}

/* ════════════════════════════════════════════════════════════════════════
   Relative time
   ════════════════════════════════════════════════════════════════════════ */

/** Relative "x ago" for an ISO timestamp; falls back to a short date. */
export function relTime(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/* ════════════════════════════════════════════════════════════════════════
   Progress signal
   ════════════════════════════════════════════════════════════════════════ */

/** A meaningful progress signal exists only for an actively-screening workspace. */
export function progressOf(p) {
  const ms = p._linkedMetaSift;
  if (!ms) return null;
  if (ms.progressStatus === 'done') return 100;
  if (ms.progressStatus === 'in_progress') return 50;
  return null; // not_started / unknown → no fake bar
}

/* ════════════════════════════════════════════════════════════════════════
   Tag colours
   ════════════════════════════════════════════════════════════════════════ */

export const TAG_COLORS = {
  green:   C.grn,
  red:     C.red,
  yellow:  C.yel,
  blue:    C.acc,
  purple:  C.purp,
  teal:    C.teal,
  gold:    C.gold,
  default: C.muted,
};

/* ════════════════════════════════════════════════════════════════════════
   Filter / sort / role-order definitions
   ════════════════════════════════════════════════════════════════════════ */

export const FILTERS = [
  { key: 'all',        label: 'All',             test: () => true },
  { key: 'owned',      label: 'Owned by me',     test: (p) => isOwnerOf(p) },
  { key: 'lead',       label: 'I lead',          test: (p) => roleOf(p) === 'leader' },
  { key: 'shared',     label: 'Shared with me',  test: (p) => !!p._shared && !isOwnerOf(p) },
  { key: 'readonly',   label: 'Read-only',       test: (p) => !!(p._readOnly || (p._permissions && p._permissions.readOnly)) },
  { key: 'active',     label: 'Active',          test: (p) => statusOf(p) === 'active' },
  { key: 'inprogress', label: 'In progress',     test: (p) => statusOf(p) === 'in_progress' },
  { key: 'done',       label: 'Done',            test: (p) => statusOf(p) === 'done' },
  { key: 'linked',     label: 'Linked',          test: (p) => !!p._linkedMetaSift },
  { key: 'notlinked',  label: 'Not linked',      test: (p) => !p._linkedMetaSift },
  { key: 'archived',   label: 'Archived',        test: (p) => !!p._archived },
];

export const SORTS = [
  { key: 'modified', label: 'Last modified', cmp: (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0) },
  { key: 'created',  label: 'Created',       cmp: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0) },
  { key: 'title',    label: 'Title A–Z',     cmp: (a, b) => (a.name || '').localeCompare(b.name || '') },
  { key: 'status',   label: 'Status',        cmp: (a, b) => statusOf(a).localeCompare(statusOf(b)) },
  { key: 'role',     label: 'My role',       cmp: (a, b) => roleOf(a).localeCompare(roleOf(b)) },
];

export const ROLE_ORDER = { owner: 0, leader: 1, reviewer: 2, viewer: 3 };

/* ════════════════════════════════════════════════════════════════════════
   Dashboard view preferences (prompt23 Task 2)
   Persist the user's sort / filter / view / show-archived choices so they
   survive refresh, browser restart, and logout/login. Keyed PER USER so two
   accounts on one browser keep separate preferences. Every stored value is
   re-validated against the live FILTERS/SORTS lists on read, so a stale or
   tampered value falls back safely to the default rather than breaking the list.
   ════════════════════════════════════════════════════════════════════════ */
const DASH_PREFS_PREFIX = 'metalab.dashboardPrefs.';
const DASH_VIEWS = ['cards', 'table'];

function dashPrefsKey(userId) {
  return DASH_PREFS_PREFIX + (userId || 'anon');
}

/** Read + validate the saved dashboard prefs for a user. Unknown keys dropped. */
export function readDashboardPrefs(userId) {
  try {
    const raw = localStorage.getItem(dashPrefsKey(userId));
    if (!raw) return {};
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return {};
    const out = {};
    if (SORTS.some(s => s.key === p.sort)) out.sort = p.sort;
    if (FILTERS.some(f => f.key === p.filter)) out.filter = p.filter;
    if (DASH_VIEWS.includes(p.view)) out.view = p.view;
    if (typeof p.showArchived === 'boolean') out.showArchived = p.showArchived;
    return out;
  } catch {
    return {};
  }
}

/** Merge + persist dashboard prefs for a user. Best-effort (never throws). */
export function writeDashboardPrefs(userId, prefs) {
  try {
    const next = { ...readDashboardPrefs(userId), ...(prefs || {}) };
    localStorage.setItem(dashPrefsKey(userId), JSON.stringify(next));
    return next;
  } catch {
    return prefs || {};
  }
}
