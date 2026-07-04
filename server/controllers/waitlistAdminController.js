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
import { logAdminAction } from '../utils/audit.js';

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
    return res.json({ configured: true, config, metrics: result.metrics, diagnostics });
  } catch (err) {
    console.error('[waitlist-admin] metrics error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/beta-waitlist/applicants ─────────────────────────────────────
export async function adminListApplicants(req, res) {
  try {
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
    });
    if (!result.ok) {
      if (isUnavailable(result.code)) {
        return res.json({ configured: false, rows: [], total: 0, page: 1, limit: 25, pages: 1 });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
    return res.json({ configured: true, rows: result.rows, total: result.total, page: result.page, limit: result.limit, pages: result.pages });
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
    return res.json({ applicant: result.applicant });
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
    await logAdminAction(req, 'WAITLIST_REMOVE', 'BetaWaitlistApplicant', req.params.id, null);
    return res.json({ ok: true });
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
