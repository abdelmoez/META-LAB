/**
 * waitlist/waitlistService.js — business logic for the Beta Waitlist (prompt48).
 * Orchestrates: authoritative validation → dedicated DB client (fail-safe) →
 * repository → confirmation email. NEVER touches the main application database.
 *
 * Every public method returns a typed result object ({ ok, code?, ... }) with
 * SAFE messages only — no stack traces, DB internals, or SMTP errors leak out.
 */

import { validateApplication, normalizeEmail, isValidEmail, isValidStatus } from '../../src/shared/betaWaitlist.js';
import { getWaitlistClient } from './waitlistClient.js';
import { isWaitlistDbConfigured, waitlistConfigStatus, waitlistDbProvider } from './config.js';
import * as repo from './waitlistRepository.js';
import { computeWaitlistMetrics } from './metrics.js';
import { toCsv } from './csv.js';
import { createRateLimiter, resendCooldownRemaining } from './rateLimit.js';
import {
  sendEmail,
  isEmailConfigured,
  renderBetaWaitlistConfirmationEmail,
} from '../services/emailService.js';

const RESEND_COOLDOWN_MS = 60_000; // min 60s between confirmation sends for one applicant
// Burst guards (sliding window) — defence-in-depth on top of the persisted cooldown.
const resendByEmail = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 3 });
const resendByIp = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 12 });

function supportEmail() {
  const v = process.env.WAITLIST_SUPPORT_EMAIL;
  return v && String(v).trim() ? String(v).trim() : '';
}

/**
 * One-line cause from an error. Prisma validation errors are dozens of lines (the
 * full query + every available field); the actionable cause is the last line
 * (e.g. "Unknown field `primaryField` …"). Keeping logs to one line stops a
 * repeated failure (e.g. an Ops poll against a stale generated client) from
 * flooding the log with the full query dump on every request.
 */
function errDetail(err) {
  return String(err?.message || err || 'unknown error').trim().split('\n').filter(Boolean).pop() || 'unknown error';
}

/** Non-sensitive view returned to the public after submit/resend. */
function toPublicView(rec) {
  if (!rec) return null;
  return {
    id: rec.id,
    status: rec.status,
    createdAt: rec.createdAt,
    confirmationEmailStatus: rec.confirmationEmailStatus,
  };
}

/**
 * Send (or re-send) the confirmation email for an applicant and persist the
 * delivery result. Email failure never throws to the caller. Returns the updated
 * record. status mapping: sent → 'sent'; provider error → 'failed'; SMTP not
 * configured → 'skipped' (honest: not a real failure).
 */
async function sendConfirmation(client, applicant) {
  if (!isEmailConfigured()) {
    return repo.recordEmailResult(client, applicant.id, { status: 'skipped' });
  }
  const { html, text } = renderBetaWaitlistConfirmationEmail({
    appName: 'PecanRev',
    firstName: applicant.firstName || '',
    supportEmail: supportEmail(),
  });
  const result = await sendEmail({
    to: applicant.email,
    subject: "You're on the PecanRev beta waitlist",
    html,
    text,
    context: 'beta_waitlist_confirmation',
  });
  if (result.sent === true) {
    return repo.recordEmailResult(client, applicant.id, { status: 'sent' });
  }
  // result.reason ∈ not_configured | no_recipient | send_failed. Store a SAFE
  // short reason — never result.error verbatim (could contain SMTP detail).
  const safeReason = result.reason === 'send_failed' ? 'Provider temporarily unavailable' : (result.reason || 'unknown');
  const status = result.reason === 'not_configured' ? 'skipped' : 'failed';
  return repo.recordEmailResult(client, applicant.id, { status, error: safeReason });
}

/**
 * Resolve the dedicated client or a typed failure. Centralises the fail-safe
 * contract so every entry point refuses to operate (never falls back to the main
 * DB) when the waitlist DB is unconfigured/unavailable.
 */
async function resolveClient() {
  const res = await getWaitlistClient();
  if (!res.ok) return { ok: false, code: res.reason }; // 'not_configured' | 'client_unavailable'
  return { ok: true, client: res.client };
}

// ── Public: submit ─────────────────────────────────────────────────────────────
/**
 * Submit a completed waitlist application.
 * @returns {Promise<{ok:boolean, code?:string, errors?:object, duplicate?:boolean, applicant?:object, emailStatus?:string}>}
 */
export async function submitApplication(payload, meta = {}) {
  const validation = validateApplication(payload);
  if (!validation.ok) return { ok: false, code: 'validation', errors: validation.errors };

  const c = await resolveClient();
  if (!c.ok) return { ok: false, code: c.code };

  // Idempotent dedupe on the case-insensitive normalized email.
  const existing = await repo.findByNormalizedEmail(c.client, validation.value.normalizedEmail);
  if (existing) {
    return {
      ok: true,
      duplicate: true,
      applicant: toPublicView(existing),
      emailStatus: existing.confirmationEmailStatus,
    };
  }

  let created;
  try {
    created = await repo.createApplicant(c.client, validation.value, { submissionSource: meta.submissionSource || 'public_web' });
  } catch (err) {
    // Unique-constraint race (two near-simultaneous submits): treat as duplicate.
    if (err && (err.code === 'P2002' || /unique/i.test(err.message || ''))) {
      const dup = await repo.findByNormalizedEmail(c.client, validation.value.normalizedEmail);
      if (dup) return { ok: true, duplicate: true, applicant: toPublicView(dup), emailStatus: dup.confirmationEmailStatus };
    }
    console.error('[waitlist] create failed:', err?.message || err);
    return { ok: false, code: 'db_error' };
  }

  // Best-effort confirmation email — a delivery failure must NOT fail the submit
  // or delete the record (prompt48 §6).
  let afterEmail = created;
  try {
    afterEmail = await sendConfirmation(c.client, created);
  } catch (err) {
    console.error('[waitlist] confirmation email error:', err?.message || err);
  }

  return {
    ok: true,
    duplicate: false,
    applicant: toPublicView(afterEmail),
    emailStatus: afterEmail.confirmationEmailStatus,
  };
}

// ── Public: resend confirmation ─────────────────────────────────────────────────
export async function resendConfirmation(email, meta = {}) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(email)) return { ok: false, code: 'validation' };

  const c = await resolveClient();
  if (!c.ok) return { ok: false, code: c.code };

  // Burst guards (do not reveal whether the email exists).
  const ipKey = meta.ip || 'unknown';
  if (!resendByIp.check(ipKey).allowed) return { ok: false, code: 'rate_limited' };
  if (!resendByEmail.check(normalized).allowed) return { ok: false, code: 'rate_limited' };

  const existing = await repo.findByNormalizedEmail(c.client, normalized);
  // Anti-enumeration: always return a generic success. Only actually resend when
  // the record exists and is not on cooldown.
  if (!existing) return { ok: true, resent: false };

  const cooldown = resendCooldownRemaining(existing.lastConfirmationAttemptAt, Date.now(), RESEND_COOLDOWN_MS);
  if (cooldown > 0) return { ok: true, resent: false, cooldownMs: cooldown };

  const updated = await sendConfirmation(c.client, existing);
  return { ok: true, resent: true, emailStatus: updated.confirmationEmailStatus };
}

// ── Public: signup count ────────────────────────────────────────────────────────
/**
 * Total active signups for the public landing page ("teams registered").
 * Fail-safe like every other entry point: returns a typed failure when the
 * dedicated DB is unconfigured/unavailable so the caller can simply omit the
 * count (never a fabricated number).
 */
export async function getPublicCount() {
  const c = await resolveClient();
  if (!c.ok) return { ok: false, code: c.code };
  try {
    const count = await repo.countActive(c.client);
    return { ok: true, count };
  } catch (err) {
    console.error('[waitlist] count query failed:', errDetail(err));
    return { ok: false, code: 'db_error' };
  }
}

// ── Ops: metrics ────────────────────────────────────────────────────────────────
export async function getMetrics() {
  const c = await resolveClient();
  if (!c.ok) return { ok: false, code: c.code };
  try {
    const rows = await repo.allForMetrics(c.client);
    return { ok: true, metrics: computeWaitlistMetrics(rows) };
  } catch (err) {
    console.error('[waitlist] metrics query failed:', errDetail(err));
    return { ok: false, code: 'db_error' };
  }
}

// ── Ops: list ─────────────────────────────────────────────────────────────────
export async function listApplicants(params) {
  const c = await resolveClient();
  if (!c.ok) return { ok: false, code: c.code };
  try {
    const result = await repo.listApplicants(c.client, params || {});
    return { ok: true, ...result };
  } catch (err) {
    console.error('[waitlist] list query failed:', errDetail(err));
    return { ok: false, code: 'db_error' };
  }
}

// ── Ops: resolve applicants for a bulk invite (80.md) ───────────────────────────
/**
 * Resolve the applicants a bulk-invite operation targets — either an explicit
 * `ids` array or the same filter set as the list view. Fail-safe like every entry
 * point. Returns minimal fields only (id, email, normalizedEmail, names, status).
 */
export async function applicantsForInvite({ ids = null, filters = {} } = {}, cap = 500) {
  const c = await resolveClient();
  if (!c.ok) return { ok: false, code: c.code };
  try {
    const rows = await repo.applicantsForInvite(c.client, { ids, filters }, cap);
    return { ok: true, rows };
  } catch (err) {
    console.error('[waitlist] applicantsForInvite failed:', errDetail(err));
    return { ok: false, code: 'db_error' };
  }
}

// ── Ops: detail ─────────────────────────────────────────────────────────────────
export async function getApplicant(id) {
  const c = await resolveClient();
  if (!c.ok) return { ok: false, code: c.code };
  try {
    const applicant = await repo.getApplicantById(c.client, id);
    if (!applicant) return { ok: false, code: 'not_found' };
    return { ok: true, applicant };
  } catch (err) {
    console.error('[waitlist] detail query failed:', errDetail(err));
    return { ok: false, code: 'db_error' };
  }
}

// ── Ops: status change ──────────────────────────────────────────────────────────
export async function setStatus(id, toStatus, opts = {}) {
  if (!isValidStatus(toStatus)) return { ok: false, code: 'validation' };
  const c = await resolveClient();
  if (!c.ok) return { ok: false, code: c.code };
  const updated = await repo.updateStatus(c.client, id, toStatus, opts);
  if (!updated) return { ok: false, code: 'not_found' };
  return { ok: true, applicant: updated };
}

// ── Ops: internal notes ─────────────────────────────────────────────────────────
export async function setNotes(id, notes) {
  const c = await resolveClient();
  if (!c.ok) return { ok: false, code: c.code };
  try {
    const updated = await repo.updateNotes(c.client, id, notes);
    return { ok: true, applicant: updated };
  } catch (err) {
    if (err?.code === 'P2025') return { ok: false, code: 'not_found' };
    throw err;
  }
}

// ── Ops: resend for a specific applicant id ─────────────────────────────────────
export async function resendForApplicant(id, opts = {}) {
  const c = await resolveClient();
  if (!c.ok) return { ok: false, code: c.code };
  const applicant = await repo.getApplicantById(c.client, id);
  if (!applicant) return { ok: false, code: 'not_found' };
  const cooldown = resendCooldownRemaining(applicant.lastConfirmationAttemptAt, Date.now(), RESEND_COOLDOWN_MS);
  if (cooldown > 0 && !opts.force) return { ok: false, code: 'rate_limited', cooldownMs: cooldown };
  const updated = await sendConfirmation(c.client, applicant);
  return { ok: true, applicant: updated, emailConfigured: isEmailConfigured() };
}

// ── Ops: remove ─────────────────────────────────────────────────────────────────
export async function removeApplicant(id) {
  const c = await resolveClient();
  if (!c.ok) return { ok: false, code: c.code };
  try {
    await repo.deleteApplicant(c.client, id);
    return { ok: true };
  } catch (err) {
    if (err?.code === 'P2025') return { ok: false, code: 'not_found' };
    throw err;
  }
}

// ── Ops: CSV export ─────────────────────────────────────────────────────────────
const EXPORT_COLUMNS = [
  { header: 'Submitted', value: (r) => (r.createdAt ? new Date(r.createdAt).toISOString() : '') },
  { header: 'Status', value: (r) => r.status },
  { header: 'First name', value: (r) => r.firstName || '' },
  { header: 'Last name', value: (r) => r.lastName || '' },
  { header: 'Email', value: (r) => r.email },
  { header: 'Institution', value: (r) => r.institutionName || '' },
  { header: 'Institution type', value: (r) => r.institutionType || '' },
  { header: 'Role', value: (r) => (r.role === 'Other' && r.customRole ? r.customRole : (r.role || '')) },
  { header: 'Field', value: (r) => r.primaryField || '' },
  { header: 'Country', value: (r) => r.countryName || r.countryCode || '' },
  { header: 'Covidence license', value: (r) => r.covidenceLicense || '' },
  { header: 'Reviews completed', value: (r) => r.priorReviewCount || '' },
  { header: 'Last review tool', value: (r) => r.lastReviewTool || '' },
  { header: 'Primary use', value: (r) => r.primaryUse || '' },
  { header: 'Experience', value: (r) => r.researchExperienceLevel || '' },
  { header: 'Annual reviews', value: (r) => r.annualReviewVolume || '' },
  { header: 'Working style', value: (r) => r.workingStyle || '' },
  { header: 'Team size', value: (r) => r.teamSize || '' },
  { header: 'Areas of interest', value: (r) => (Array.isArray(r.areasOfInterest) ? r.areasOfInterest.join('; ') : '') },
  { header: 'Referral source', value: (r) => r.referralSource || '' },
  { header: 'Research insights opt-in', value: (r) => (r.researchConsent ? 'Yes' : 'No') },
  { header: 'Confirmation email', value: (r) => r.confirmationEmailStatus },
  { header: 'Confirmation sent at', value: (r) => (r.confirmationEmailSentAt ? new Date(r.confirmationEmailSentAt).toISOString() : '') },
];

export async function exportApplicants(params) {
  const c = await resolveClient();
  if (!c.ok) return { ok: false, code: c.code };
  try {
    const rows = await repo.forExport(c.client, params || {});
    const csv = toCsv(rows, EXPORT_COLUMNS);
    return { ok: true, csv, count: rows.length };
  } catch (err) {
    console.error('[waitlist] export query failed:', errDetail(err));
    return { ok: false, code: 'db_error' };
  }
}

/** Config snapshot for the Ops console (no secrets). */
export function configStatus() {
  return { ...waitlistConfigStatus(), emailConfigured: isEmailConfigured() };
}

// ── Ops: diagnostics ────────────────────────────────────────────────────────────
/**
 * 73.md Part 11 — pinpoint WHY the waitlist data layer is down (env unset vs
 * generated client missing vs live query failing) for the admin metrics panel.
 * Resolves the dedicated client and runs one cheap COUNT. No secrets: `target`
 * is the same redacted value the Ops config already shows. Never throws.
 * @returns {Promise<{dbConfigured:boolean, target:string, provider:string, clientOk:boolean, reason:'not_configured'|'client_unavailable'|'query_failed'|'ok'}>}
 */
export async function diagnose() {
  const { dbConfigured, target } = waitlistConfigStatus();
  const base = { dbConfigured, target, provider: waitlistDbProvider() };
  if (!dbConfigured) return { ...base, clientOk: false, reason: 'not_configured' };
  const c = await resolveClient();
  if (!c.ok) return { ...base, clientOk: false, reason: c.code };
  try {
    await repo.countActive(c.client);
    return { ...base, clientOk: true, reason: 'ok' };
  } catch (err) {
    console.error('[waitlist] diagnose query failed:', errDetail(err));
    return { ...base, clientOk: false, reason: 'query_failed' };
  }
}

export { isWaitlistDbConfigured };
