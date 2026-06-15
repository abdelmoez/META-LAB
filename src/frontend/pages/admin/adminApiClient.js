/**
 * adminApiClient.js — Admin API methods for META·LAB Ops console.
 *
 * /api/admin/* endpoints require a staff role enforced PER ROUTE on the server:
 * most read/support endpoints allow admin OR mod (requireAdminOrMod); metrics,
 * settings, flags, security, projects lifecycle, and all screening/* admin
 * endpoints are admin-only (requireAdmin).
 * This client is ONLY imported by AdminConsole.jsx.
 */

const BASE = '/api/admin';
const PUB  = '/api/settings';

async function req(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const err = new Error((body?.error) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

const json = body => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const adminApi = {
  // Platform metrics (admin only). prompt6 Task 9 adds unique-login counts:
  // logins: { day, week, month, quarter, year } — distinct userIds, rolling windows.
  metrics:        ()         => req(`${BASE}/metrics`),
  // Per-day trend buckets (admin only, prompt8 ops control center):
  // GET /metrics/timeseries?days=N → { days: [{ date:'YYYY-MM-DD', logins,
  // uniqueLogins, newUsers, newProjects, screeningDecisions, doneTransitions,
  // contactMessages, failedLogins }] } — ascending, zero-filled, last = today.
  // Callers MUST treat any error/404 as "no trend data" (explicit chart empty
  // state) — never fabricate values.
  metricsTimeseries: (days = 14) => req(`${BASE}/metrics/timeseries?days=${encodeURIComponent(days)}`),
  health:         ()         => req(`${BASE}/health`),
  // Console capability descriptor — { role, sections, emailConfigured }. (admin + mod)
  console:        ()         => req(`${BASE}/console`),

  users: {
    list:         (p)        => req(`${BASE}/users?${new URLSearchParams(p || {})}`),
    // prompt19 — aggregate users-by-country distribution (admin only). Returns
    // { countries: [{ countryCode, countryName, userCount, percentage,
    // latestRegistrationAt }], summary: { totalUsers, totalKnown, unknown,
    // countriesRepresented } } sorted by userCount desc. COUNTRY-LEVEL only.
    countries:    ()         => req(`${BASE}/users/countries`),
    get:          (id)       => req(`${BASE}/users/${id}`),
    getProjects:  (id, p)    => req(`${BASE}/users/${id}/projects?${new URLSearchParams(p || {})}`),
    update:       (id, b)    => req(`${BASE}/users/${id}`, { method: 'PATCH', ...json(b) }),
    updateStatus: (id, s)    => req(`${BASE}/users/${id}/status`, { method: 'PATCH', ...json(s) }),
    updateRole:   (id, role) => req(`${BASE}/users/${id}/role`, { method: 'PATCH', ...json({ role }) }),
    resetPassword:(id)       => req(`${BASE}/users/${id}/reset-password`, { method: 'POST' }),
    // prompt14 — token-based reset: emails a self-service link. Returns
    // { sent, emailConfigured, expiresAt, link? } (link only when not sent).
    sendPasswordReset:(id)   => req(`${BASE}/users/${id}/send-password-reset`, { method: 'POST' }),
  },

  projects: {
    // Rows include linkedMetaSift: { id, title } | null (prompt6 Task 11) —
    // the linked ScreenProject IS the Review Workspace (workspaceId == linkedMetaSift.id).
    list:         (p)        => req(`${BASE}/projects?${new URLSearchParams(p || {})}`),
    archive:      (id)       => req(`${BASE}/projects/${id}/archive`, { method: 'PATCH' }),
    restore:      (id)       => req(`${BASE}/projects/${id}/restore`, { method: 'PATCH' }),
  },

  settings: {
    get:          ()         => req(`${BASE}/settings`),
    save:         (body)     => req(`${BASE}/settings`, { method: 'PUT', ...json(body) }),
  },

  landingContent: {
    get:          ()         => req(`${BASE}/landing-content`),
    save:         (body)     => req(`${BASE}/landing-content`, { method: 'PUT', ...json(body) }),
  },

  featureFlags: {
    get:          ()         => req(`${BASE}/feature-flags`),
    save:         (body)     => req(`${BASE}/feature-flags`, { method: 'PUT', ...json(body) }),
  },

  screening: {
    getSettings:  ()         => req(`${BASE}/screening/settings`),
    saveSettings: (body)     => req(`${BASE}/screening/settings`, { method: 'PUT', ...json(body) }),
    // prompt6 Task 12 adds doneToday / doneThisWeek / doneThisMonth
    // (DISTINCT projects whose status changed to 'done' in the window).
    getMetrics:   ()         => req(`${BASE}/screening/metrics`),
    // Internal screening-engine health (prompt18): projects with/without a module.
    getWorkspaceHealth: ()   => req(`${BASE}/screening/workspace-health`),
    repairWorkspaces:   ()   => req(`${BASE}/screening/workspace-health/repair`, { method: 'POST' }),
    listProjects: (p)        => req(`${BASE}/screening/projects?${new URLSearchParams(p || {})}`),
    // prompt6 Task 11: expanded progress detail — total/screened/unscreened/
    // included/excluded/maybe/conflicts/duplicates/secondReview/sentToExtraction
    // plus per-member progress.
    getProject:   (id)       => req(`${BASE}/screening/projects/${id}`),
    setStatus:    (id, stage) => req(`${BASE}/screening/projects/${id}/status`, { method: 'PATCH', ...json({ stage }) }),
    // Independent lifecycle flag toggle (PATCH { disabled?, archived? }).
    setFlags:     (id, flags) => req(`${BASE}/screening/projects/${id}/status`, { method: 'PATCH', ...json(flags) }),
    getMembers:   (id)       => req(`${BASE}/screening/projects/${id}/members`),
    getHandoffs:  ()         => req(`${BASE}/screening/handoffs`),
    getAudit:     (p)        => req(`${BASE}/screening/audit?${new URLSearchParams(p || {})}`),
    // Restore an owner-soft-deleted workspace (clears deletedAt + deletedSource).
    // PATCH /api/admin/screening/projects/:id/restore → { ok:true } | 400 if not deleted.
    restore:      (id)       => req(`${BASE}/screening/projects/${id}/restore`, { method: 'PATCH' }),
  },

  auditLog:       (p)        => req(`${BASE}/audit-log?${new URLSearchParams(p || {})}`),
  securityEvents: (p)        => req(`${BASE}/security-events?${new URLSearchParams(p || {})}`),

  messages: {
    list:         (p)        => req(`${BASE}/contact-messages?${new URLSearchParams(p || {})}`),
    update:       (id, b)    => req(`${BASE}/contact-messages/${id}`, { method: 'PATCH', ...json(b) }),
    delete:       (id)       => req(`${BASE}/contact-messages/${id}`, { method: 'DELETE' }),
    // Reply by email. Returns { reply, emailConfigured, sent }. Saved as draft if not configured.
    reply:        (id, b)    => req(`${BASE}/contact-messages/${id}/reply`, { method: 'POST', ...json(b) }),
    replies:      (id)       => req(`${BASE}/contact-messages/${id}/replies`),
    // Per-staff read state (prompt5 Task 9). unreadCount → { unread }; markRead → { ok, read, unread }.
    unreadCount:  ()         => req(`${BASE}/contact-messages/unread-count`),
    markRead:     (id, read = true) => req(`${BASE}/contact-messages/${id}/mark-read`, { method: 'POST', ...json({ read }) }),
  },
};

// App version — { name, version, commit, buildDate }. Returns null on 404 (may be
// wired by another dev concurrently). Never throws.
export const fetchVersion = async () => {
  try {
    const res = await fetch('/api/version', { credentials: 'include' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

// Public settings — no auth required (used by Landing page)
export const publicSettings = () =>
  fetch(`${PUB}/public`, { credentials: 'include' }).then(r => r.json());
