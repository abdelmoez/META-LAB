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

// Build a query string from only the NON-EMPTY params (avoids '?x=undefined').
const qs = (params = {}) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

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
    // prompt25 — global online/offline head-count (admin only).
    // Returns { totalUsers, online, offline, percentOnline }.
    // "Online" = presence heartbeat received within ~75 s.
    activitySummary: ()     => req(`${BASE}/users/activity-summary`),
    // prompt25 — per-user real-time activity snapshot (admin only).
    // Returns { id, name, email, lastActive, onlineNow, currentProjectId,
    //           currentProjectTitle, currentLocation }.
    activity:     (id)      => req(`${BASE}/users/${id}/activity`),
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
    // prompt50 WS1 — list params now include sort (lastActivity|created|updated|name),
    // dir (asc|desc), and linked (yes|no), plus search/status/page/limit.
    list:         (p)        => req(`${BASE}/projects?${new URLSearchParams(p || {})}`),
    detail:       (id)       => req(`${BASE}/projects/${id}/detail`),
    archive:      (id)       => req(`${BASE}/projects/${id}/archive`, { method: 'PATCH' }),
    restore:      (id)       => req(`${BASE}/projects/${id}/restore`, { method: 'PATCH' }),
    // prompt50 WS1 — platform-wide project analytics (mirror the Users tab).
    overview:     ()         => req(`${BASE}/projects/overview`),
    growth:       (year)     => req(`${BASE}/project-growth${year ? `?year=${encodeURIComponent(year)}` : ''}`),
    analytics:    (window)   => req(`${BASE}/project-analytics${window && window !== 'all' ? `?window=${encodeURIComponent(window)}` : ''}`),
  },

  settings: {
    get:          ()         => req(`${BASE}/settings`),
    save:         (body)     => req(`${BASE}/settings`, { method: 'PUT', ...json(body) }),
  },

  // ── Global brand theme (prompt37, admin only) ────────────────────────────────
  // get → { brandColor, preset, palette:{day,night}|null, updatedAt };
  // save(body) PATCHes { brandColor, preset, palette } (or { reset:true }) →
  // the stored record. Every color is strictly hex-validated server-side.
  theme: {
    get:          ()         => req(`${BASE}/settings/theme`),
    save:         (body)     => req(`${BASE}/settings/theme`, { method: 'PATCH', ...json(body) }),
  },

  // ── Stitch UI rollout (prompt61, admin only) ─────────────────────────────────
  // get → { allowAllUsers, defaultMode }; save(body) PUTs a partial
  // { allowAllUsers?, defaultMode? } → the merged record. Validated server-side.
  design: {
    get:          ()         => req(`${BASE}/design-settings`),
    save:         (body)     => req(`${BASE}/design-settings`, { method: 'PUT', ...json(body) }),
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

  // ── AI Screening Intelligence Engine (screeningEngin.md, admin only) ─────────
  // getSettings → { settings:{ enabled, embeddingProvider, maxRecordsPerRun,
  //   requireHumanFinalDecision, allowReviewersToRun, includeThreshold,
  //   excludeThreshold, defaultPolicy }, defaults:{...} }.
  // getRuns(p) → { runs:[{ id, projectId, status, mode, nScored, metrics, ... }], errorCount }.
  aiScreening: {
    getSettings:  ()         => req(`${BASE}/ai-screening/settings`),
    saveSettings: (body)     => req(`${BASE}/ai-screening/settings`, { method: 'PUT', ...json(body) }),
    getRuns:      (p)        => req(`${BASE}/ai-screening/runs?${new URLSearchParams(p || {})}`),
  },

  // ── Pecan Search Engine providers (admin only) ───────────────────────────────
  // getSettings() → { engine, defaults, settings (editable non-secret policy block),
  //   providers:[{ id, label, platform, enabled, requiresCredentials, configured
  //   (boolean only — NEVER a key), available, supportsCountPreview, maxResults,
  //   defaultCap, maxCap, supportedFields, implemented }], queue:{ queued,
  //   processing, completed, failed, cancelled, stale }, runs:{ total, completed,
  //   partial, failed }, recentFailedJobs:[{ id, runId, error, updatedAt, attempts }],
  //   recentFailedSources:[{ provider, errorClass, errorDetail, updatedAt }] }.
  // updateSettings(body) PATCHes the policy block (caps/concurrency/retry/timeouts/
  //   preview throttle/institutional mode + per-provider enable/defaultCap/maxCap/
  //   timeoutMs) → { ok, settings }. Server validates + bounds everything; secrets
  //   are NEVER accepted or returned here.
  // requeueJob(jobId) POSTs a safe requeue of a failed or stuck job → { ok }.
  searchProviders: {
    getSettings:    ()         => req(`${BASE}/search-providers`),
    updateSettings: (body)     => req(`${BASE}/search-providers`, { method: 'PATCH', ...json(body) }),
    requeueJob:     (jobId)    => req(`${BASE}/search-providers/jobs/${jobId}/requeue`, { method: 'POST' }),
  },

  // ── Onboarding (prompt32 Task 7, admin only) ─────────────────────────────────
  // Behaviour settings: getSettings → { enabled, introTitle, introBody };
  // saveSettings(body) PUTs the same shape. Questions manager:
  //   list → { questions:[{ id, key, prompt, description, type, options:[{value,
  //     label}], isRequired, allowSkip, isActive, displayOrder, counts:{answered,
  //     skipped,pending}, createdAt, updatedAt }], totalUsers };
  //   create(body) → { ok, question }; update(id, body) → { ok, question };
  //   reorder(order:[id,...]) → { ok }; reset(id, userId?) (omit userId ⇒ ALL
  //   users) → { ok, cleared }; remove(id) → { ok }.
  onboarding: {
    getSettings:  ()         => req(`${BASE}/onboarding-settings`),
    saveSettings: (body)     => req(`${BASE}/onboarding-settings`, { method: 'PUT', ...json(body) }),
    list:         ()         => req(`${BASE}/onboarding-questions`),
    create:       (body)     => req(`${BASE}/onboarding-questions`, { method: 'POST', ...json(body) }),
    update:       (id, body) => req(`${BASE}/onboarding-questions/${id}`, { method: 'PATCH', ...json(body) }),
    reorder:      (order)    => req(`${BASE}/onboarding-questions/reorder`, { method: 'POST', ...json({ order }) }),
    reset:        (id, userId) => req(`${BASE}/onboarding-questions/${id}/reset`, { method: 'POST', ...json(userId ? { userId } : {}) }),
    remove:       (id)       => req(`${BASE}/onboarding-questions/${id}`, { method: 'DELETE' }),
    // prompt36 Task 6 — analytics. analytics() → { overview, questions:[…],
    //   users:[…], usersTruncated, denominatorNote }; questionAnalytics(id) →
    //   { question, answeredUsers, skippedUsers, pendingUsers, pendingCount, … };
    //   userStatus(id) → { user, counts, items:[{ status, answer, … }] }.
    analytics:         ()   => req(`${BASE}/onboarding-analytics`),
    questionAnalytics: (id) => req(`${BASE}/onboarding-questions/${id}/analytics`),
    userStatus:        (id) => req(`${BASE}/onboarding-users/${id}/status`),
  },

  // ── Risk of Bias engine controls (prompt32 Task 12, admin only) ──────────────
  // getSettings → { settings:{...robSettings}, engineEnabled:boolean } (the
  //   engineEnabled mirrors the rob_engine_v2 feature flag — read-only here);
  // saveSettings(settings) PUTs the settings object → { ok, settings };
  // getMetrics → { projectsUsingRoB, totalAssessments, completedAssessments,
  //   pendingAssessments, overall:{low,some,high}, reviewerConflicts }.
  rob: {
    getSettings:  ()         => req(`${BASE}/rob/settings`),
    saveSettings: (body)     => req(`${BASE}/rob/settings`, { method: 'PUT', ...json(body) }),
    getMetrics:   ()         => req(`${BASE}/rob/metrics`),
  },

  // ── Beta Waitlist (prompt48, admin only) ─────────────────────────────────────
  // metrics() → { configured, config, metrics } (metrics null when not configured);
  // list(p)   → { configured, rows, total, page, limit, pages };
  // get(id)   → { applicant } (full record + statusEvents);
  // exportUrl(p) builds the CSV download URL (fetched as a blob with credentials).
  betaWaitlist: {
    metrics:   ()              => req(`${BASE}/beta-waitlist/metrics`),
    list:      (p)             => req(`${BASE}/beta-waitlist/applicants${qs(p)}`),
    get:       (id)            => req(`${BASE}/beta-waitlist/applicants/${id}`),
    setStatus: (id, status, note) => req(`${BASE}/beta-waitlist/applicants/${id}/status`, { method: 'PATCH', ...json({ status, note }) }),
    setNotes:  (id, notes)     => req(`${BASE}/beta-waitlist/applicants/${id}/notes`, { method: 'PATCH', ...json({ notes }) }),
    resend:    (id, force)     => req(`${BASE}/beta-waitlist/applicants/${id}/resend`, { method: 'POST', ...json({ force: !!force }) }),
    remove:    (id)            => req(`${BASE}/beta-waitlist/applicants/${id}`, { method: 'DELETE' }),
    exportUrl: (p)             => `${BASE}/beta-waitlist/export${qs(p)}`,
  },

  // 54.md Part 6 — engine versions (admin-only, read-only).
  engineVersions: {
    list:    ()   => req(`${BASE}/engine-versions`),
    history: (id) => req(`${BASE}/engine-versions/${id}/history`),
  },

  auditLog:        (p)       => req(`${BASE}/audit-log?${new URLSearchParams(p || {})}`),
  securityEvents:  (p)       => req(`${BASE}/security-events?${new URLSearchParams(p || {})}`),
  securitySummary: (p)       => req(`${BASE}/security-summary?${new URLSearchParams(p || {})}`),

  // ── Ops Users analytics + institution management (admin only) ────────────────
  // getUserAnalytics(window) → distributions filtered to accounts CREATED in the
  // window ('today'|'week'|'month'|'quarter'|'year'|'all', default 'all'):
  //   { window, totalUsers, byResearchField:[{label,count}],
  //     byPrimaryRole, byMainUseCase, byCountry,
  //     topInstitutions:[{key,canonicalName,count}], onboarding:{completed,total},
  //     verification:{verified,unverified,total}, institution:{provided,missing,total} }.
  getUserAnalytics: (window) =>
    req(`${BASE}/user-analytics${window && window !== 'all' ? `?window=${encodeURIComponent(window)}` : ''}`),
  // getUserGrowth(year?) → new-user registration analytics over time (prompt27):
  //   { timezone, weekStart, now, windows:{today,week,month,quarter,year,total}
  //     (each {count,prev,deltaPct}), byYear:[{year,count,growthPct}],
  //     availableYears, selectedYear, byMonth, byQuarter, byDay (90), byMonth12,
  //     insights:{topCountry,topInstitution,topResearchField,topPrimaryRole,
  //     topMainUseCase}, stats:{...} }. Treat any error as "no data".
  getUserGrowth: (year)      =>
    req(`${BASE}/user-growth${year ? `?year=${encodeURIComponent(year)}` : ''}`),
  // getInstitutions → { institutions:[{ key, canonicalName, userCount,
  //   aliases:[string], possibleDuplicates:[{key,canonicalName,confidence}] }] }.
  getInstitutions:  ()       => req(`${BASE}/institutions`),
  // merge → { ok:true, moved:number } (repoints User.institutionNormalized).
  mergeInstitutions: (fromKey, toKey) =>
    req(`${BASE}/institutions/merge`, { method: 'POST', ...json({ fromKey, toKey }) }),
  // rename → { ok:true } (sets the canonical display-name override for a key).
  renameInstitution: (key, name) =>
    req(`${BASE}/institutions/rename`, { method: 'POST', ...json({ key, name }) }),
  // reject → { ok:true } (marks a pair "not a duplicate"; never resurfaces).
  rejectInstitutionDuplicate: (keyA, keyB) =>
    req(`${BASE}/institutions/reject`, { method: 'POST', ...json({ keyA, keyB }) }),

  messages: {
    list:         (p)        => req(`${BASE}/contact-messages?${new URLSearchParams(p || {})}`),
    update:       (id, b)    => req(`${BASE}/contact-messages/${id}`, { method: 'PATCH', ...json(b) }),
    delete:       (id)       => req(`${BASE}/contact-messages/${id}`, { method: 'DELETE' }),
    // Reply by email. Returns { reply, emailConfigured, sent }. Saved as draft if not configured.
    reply:        (id, b)    => req(`${BASE}/contact-messages/${id}/reply`, { method: 'POST', ...json(b) }),
    // Compose & send a NEW email to any recipient (staff-initiated). b = { to, subject, body, toName? }.
    compose:      (b)        => req(`${BASE}/emails`, { method: 'POST', ...json(b) }),
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
