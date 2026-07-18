/**
 * waitlistAdminController.js — Ops Console Beta Waitlist management (prompt48 §7).
 * ADMIN ONLY (enforced by requireAdmin on every route in routes/admin.js; this is
 * sensitive applicant PII). Reads the waitlist through the dedicated data layer —
 * applicant data is NEVER copied into the main user database.
 *
 * Read endpoints degrade gracefully to a `configured:false` empty state so the
 * tab can guide an admin to configure BETA_WAITLIST_DATABASE_URL; mutating
 * endpoints return 503 when the DB is unavailable (never a silent fallback).
 */

import * as waitlist from '../waitlist/waitlistService.js';
import * as invitationService from '../services/invitationService.js';
import { normalizeEmail } from '../../src/shared/betaWaitlist.js';
import { logAdminAction } from '../utils/audit.js';

/**
 * 80.md — enrich a set of waitlist rows with their MAIN-db invitation state
 * (derived lifecycle + eligibility + latest invitation view + existing user) in
 * TWO batched queries. Read-only cross-DB join; a failure degrades gracefully to
 * unenriched rows (the waitlist tab must never blank because the main-db lookup
 * hiccupped).
 */
async function enrichRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  try {
    const emails = rows.map((r) => normalizeEmail(r.email));
    const [invMap, userMap] = await Promise.all([
      invitationService.latestInvitationsForEmails(emails),
      invitationService.existingUsersForEmails(emails),
    ]);
    const now = Date.now();
    return rows.map((r) => {
      const ne = normalizeEmail(r.email);
      return { ...r, ...invitationService.enrichApplicant(r, invMap.get(ne) || null, userMap.get(ne) || null, now) };
    });
  } catch (err) {
    console.error('[waitlist-admin] enrich failed:', err?.message || err);
    return rows;
  }
}

const UNAVAILABLE = { error: 'The Beta Waitlist database is not configured or unavailable.', code: 'unavailable' };

function isUnavailable(code) {
  return code === 'not_configured' || code === 'client_unavailable';
}

// ── GET /api/admin/beta-waitlist/metrics ────────────────────────────────────────
export async function adminWaitlistMetrics(req, res) {
  try {
    const result = await waitlist.getMetrics();
    const config = waitlist.configStatus();
    // 73.md Part 11 — additive diagnostics so an admin can see WHY the waitlist
    // is unavailable (not_configured | client_unavailable | query_failed | ok)
    // without shell access. Secret-free (redacted target + provider only).
    const diagnostics = await waitlist.diagnose();
    if (!result.ok) {
      if (isUnavailable(result.code)) return res.json({ configured: false, config, metrics: null, diagnostics });
      return res.status(500).json({ error: 'Internal server error', diagnostics });
    }
    // 80.md — invitation KPIs come from the MAIN db (WaitlistInvitation), separate
    // from the waitlist-DB applicant metrics. Best-effort: on failure omit them
    // rather than 500 the whole panel.
    let invitations = null;
    try { invitations = await invitationService.invitationMetrics(); }
    catch (e) { console.error('[waitlist-admin] invitation metrics failed:', e?.message || e); }
    return res.json({ configured: true, config, metrics: { ...result.metrics, invitations }, diagnostics });
  } catch (err) {
    console.error('[waitlist-admin] metrics error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/beta-waitlist/applicants ─────────────────────────────────────
export async function adminListApplicants(req, res) {
  try {
    // 93.md §9.1 — optional cohort filter. Cohort lives on the MAIN-db
    // WaitlistInvitation, so it is resolved to a normalized-email set here and
    // intersected inside the waitlist query (the waitlist layer never touches
    // the main database). An unknown cohort yields an honest empty page.
    let emailIn = null;
    const cohortQ = typeof req.query.cohort === 'string' ? req.query.cohort.trim().slice(0, 64) : '';
    if (cohortQ) {
      try {
        emailIn = await invitationService.normalizedEmailsForCohort(cohortQ);
      } catch (e) {
        console.error('[waitlist-admin] cohort resolve failed:', e?.message || e);
        emailIn = [];
      }
    }

    const result = await waitlist.listApplicants({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
      role: req.query.role,
      countryCode: req.query.countryCode,
      emailStatus: req.query.emailStatus,
      institutionType: req.query.institutionType,
      covidenceLicense: req.query.covidenceLicense,
      primaryField: req.query.primaryField,
      search: req.query.search,
      sortBy: req.query.sortBy,
      sortDir: req.query.sortDir,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      emailIn,
    });
    if (!result.ok) {
      if (isUnavailable(result.code)) {
        return res.json({ configured: false, rows: [], total: 0, page: 1, limit: 25, pages: 1 });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
    const rows = await enrichRows(result.rows);
    return res.json({ configured: true, rows, total: result.total, page: result.page, limit: result.limit, pages: result.pages });
  } catch (err) {
    console.error('[waitlist-admin] list error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/beta-waitlist/applicants/:id ─────────────────────────────────
export async function adminGetApplicant(req, res) {
  try {
    const result = await waitlist.getApplicant(req.params.id);
    if (!result.ok) {
      if (isUnavailable(result.code)) return res.status(503).json(UNAVAILABLE);
      if (result.code === 'not_found') return res.status(404).json({ error: 'Applicant not found' });
      return res.status(500).json({ error: 'Internal server error' });
    }
    // Enrich the detail record + attach the full invitation history for the drawer.
    const [enriched] = await enrichRows([result.applicant]);
    let invitations = [];
    try {
      invitations = await invitationService.invitationHistoryForApplicant(result.applicant.id, result.applicant.normalizedEmail || result.applicant.email);
    } catch (e) { console.error('[waitlist-admin] history in detail failed:', e?.message || e); }
    return res.json({ applicant: enriched || result.applicant, invitations });
  } catch (err) {
    console.error('[waitlist-admin] detail error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PATCH /api/admin/beta-waitlist/applicants/:id/status ────────────────────────
export async function adminUpdateStatus(req, res) {
  try {
    const status = req.body?.status;
    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    const result = await waitlist.setStatus(req.params.id, status, { changedBy: req.user.id, note });
    if (!result.ok) {
      if (result.code === 'validation') return res.status(422).json({ error: 'Invalid status value' });
      if (isUnavailable(result.code)) return res.status(503).json(UNAVAILABLE);
      if (result.code === 'not_found') return res.status(404).json({ error: 'Applicant not found' });
      return res.status(500).json({ error: 'Internal server error' });
    }
    await logAdminAction(req, 'WAITLIST_STATUS_CHANGE', 'BetaWaitlistApplicant', req.params.id, { status });
    return res.json({ applicant: result.applicant });
  } catch (err) {
    console.error('[waitlist-admin] status error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PATCH /api/admin/beta-waitlist/applicants/:id/notes ─────────────────────────
export async function adminUpdateNotes(req, res) {
  try {
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';
    const result = await waitlist.setNotes(req.params.id, notes);
    if (!result.ok) {
      if (isUnavailable(result.code)) return res.status(503).json(UNAVAILABLE);
      if (result.code === 'not_found') return res.status(404).json({ error: 'Applicant not found' });
      return res.status(500).json({ error: 'Internal server error' });
    }
    await logAdminAction(req, 'WAITLIST_NOTES_UPDATE', 'BetaWaitlistApplicant', req.params.id, null);
    return res.json({ applicant: result.applicant });
  } catch (err) {
    console.error('[waitlist-admin] notes error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/beta-waitlist/applicants/:id/resend ─────────────────────────
export async function adminResendConfirmation(req, res) {
  try {
    const force = req.body?.force === true;
    const result = await waitlist.resendForApplicant(req.params.id, { changedBy: req.user.id, force });
    if (!result.ok) {
      if (isUnavailable(result.code)) return res.status(503).json(UNAVAILABLE);
      if (result.code === 'not_found') return res.status(404).json({ error: 'Applicant not found' });
      if (result.code === 'rate_limited') {
        return res.status(429).json({ error: 'A confirmation was sent very recently. Try again shortly.', cooldownMs: result.cooldownMs || 0 });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
    await logAdminAction(req, 'WAITLIST_RESEND_EMAIL', 'BetaWaitlistApplicant', req.params.id, { emailStatus: result.applicant?.confirmationEmailStatus });
    return res.json({ applicant: result.applicant, emailConfigured: result.emailConfigured });
  } catch (err) {
    console.error('[waitlist-admin] resend error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /api/admin/beta-waitlist/applicants/:id ──────────────────────────────
export async function adminRemoveApplicant(req, res) {
  try {
    const result = await waitlist.removeApplicant(req.params.id);
    if (!result.ok) {
      if (isUnavailable(result.code)) return res.status(503).json(UNAVAILABLE);
      if (result.code === 'not_found') return res.status(404).json({ error: 'Applicant not found' });
      return res.status(500).json({ error: 'Internal server error' });
    }
    // 86.md P1.10 — removing an applicant must also KILL any pending account
    // invitation for them. The invitation lives in the MAIN db and its accept flow
    // validates only against that row, so without this a deliberately-removed person
    // could still create an account from an emailed link. Best-effort (main-db side):
    // never let a revoke hiccup fail the remove the admin already saw succeed.
    let revoked = 0;
    try {
      const r = await invitationService.revokeInvitationForApplicant(req.params.id, { revokedByUserId: req.user?.id || null });
      revoked = (r && (r.revoked ?? r.count)) || 0;
    } catch (e) {
      console.error('[waitlist-admin] revoke-on-remove failed:', e?.message || e);
    }
    await logAdminAction(req, 'WAITLIST_REMOVE', 'BetaWaitlistApplicant', req.params.id, { invitationsRevoked: revoked });
    return res.json({ ok: true, invitationsRevoked: revoked });
  } catch (err) {
    console.error('[waitlist-admin] remove error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/beta-waitlist/export ─────────────────────────────────────────
export async function adminExportApplicants(req, res) {
  try {
    const result = await waitlist.exportApplicants({
      status: req.query.status,
      role: req.query.role,
      countryCode: req.query.countryCode,
      emailStatus: req.query.emailStatus,
      institutionType: req.query.institutionType,
      covidenceLicense: req.query.covidenceLicense,
      primaryField: req.query.primaryField,
      search: req.query.search,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
    });
    if (!result.ok) {
      if (isUnavailable(result.code)) return res.status(503).json(UNAVAILABLE);
      return res.status(500).json({ error: 'Internal server error' });
    }
    await logAdminAction(req, 'WAITLIST_EXPORT', 'BetaWaitlistApplicant', null, { count: result.count });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="beta-waitlist-${stamp}.csv"`);
    // Prepend a UTF-8 BOM so Excel opens accented names correctly.
    return res.send('﻿' + result.csv);
  } catch (err) {
    console.error('[waitlist-admin] export error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
