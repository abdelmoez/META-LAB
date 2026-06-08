/**
 * adminApiClient.js — Admin API methods for META·LAB Ops console.
 *
 * All /api/admin/* endpoints require admin role; the server enforces this.
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
  metrics:        ()         => req(`${BASE}/metrics`),
  health:         ()         => req(`${BASE}/health`),

  users: {
    list:         (p)        => req(`${BASE}/users?${new URLSearchParams(p || {})}`),
    get:          (id)       => req(`${BASE}/users/${id}`),
    getProjects:  (id, p)    => req(`${BASE}/users/${id}/projects?${new URLSearchParams(p || {})}`),
    updateStatus: (id, s)    => req(`${BASE}/users/${id}/status`, { method: 'PATCH', ...json(s) }),
  },

  projects: {
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
    getMetrics:   ()         => req(`${BASE}/screening/metrics`),
    listProjects: (p)        => req(`${BASE}/screening/projects?${new URLSearchParams(p || {})}`),
    getProject:   (id)       => req(`${BASE}/screening/projects/${id}`),
    setStatus:    (id, stage) => req(`${BASE}/screening/projects/${id}/status`, { method: 'PATCH', ...json({ stage }) }),
  },

  auditLog:       (p)        => req(`${BASE}/audit-log?${new URLSearchParams(p || {})}`),
  securityEvents: (p)        => req(`${BASE}/security-events?${new URLSearchParams(p || {})}`),

  messages: {
    list:         (p)        => req(`${BASE}/contact-messages?${new URLSearchParams(p || {})}`),
    update:       (id, b)    => req(`${BASE}/contact-messages/${id}`, { method: 'PATCH', ...json(b) }),
    delete:       (id)       => req(`${BASE}/contact-messages/${id}`, { method: 'DELETE' }),
  },
};

// Public settings — no auth required (used by Landing page)
export const publicSettings = () =>
  fetch(`${PUB}/public`, { credentials: 'include' }).then(r => r.json());
