/**
 * waitlistController.js — PUBLIC (unauthenticated) Beta Waitlist endpoints
 * (prompt48). Submitting a waitlist application NEVER creates a user account,
 * authentication identity, profile, or onboarding record — it writes ONLY to the
 * dedicated waitlist database via waitlistService.
 *
 * Mounted behind a dedicated rate limiter in server/index.js. All error messages
 * are safe (no stack traces, DB internals, or SMTP errors).
 */

import * as waitlist from '../waitlist/waitlistService.js';
import { redactedDbTarget } from '../waitlist/config.js';

// Generic, safe responses for the fail-safe paths.
const UNAVAILABLE = { error: 'The waitlist is temporarily unavailable. Please try again in a moment.', code: 'unavailable' };

function isUnavailable(code) {
  return code === 'not_configured' || code === 'client_unavailable';
}

/** POST /api/waitlist — submit a completed application. */
export async function submitWaitlist(req, res) {
  try {
    const body = req.body || {};

    // Honeypot: a hidden field real users never fill. If populated, it's a bot —
    // return a benign success WITHOUT writing anything (don't tip off the bot).
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return res.status(201).json({ ok: true, duplicate: false, status: 'WAITLISTED' });
    }

    const result = await waitlist.submitApplication(body, { submissionSource: 'public_web' });

    if (!result.ok) {
      if (result.code === 'validation') {
        return res.status(422).json({ error: 'Please correct the highlighted fields.', errors: result.errors });
      }
      if (isUnavailable(result.code)) {
        // Surface a redacted configuration problem to the server logs for admins;
        // the applicant only sees a generic temporary-unavailability message.
        console.error(`[waitlist] submission refused — DB ${result.code} (target ${redactedDbTarget()})`);
        return res.status(503).json(UNAVAILABLE);
      }
      return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }

    if (result.duplicate) {
      // Safe duplicate message — do not reveal private applicant details.
      return res.status(200).json({
        ok: true,
        duplicate: true,
        status: result.applicant?.status || 'WAITLISTED',
        message: 'This email is already on the PecanRev beta waitlist.',
      });
    }

    return res.status(201).json({
      ok: true,
      duplicate: false,
      status: result.applicant?.status || 'WAITLISTED',
      emailStatus: result.emailStatus || 'pending',
    });
  } catch (err) {
    console.error('[waitlist] submitWaitlist error:', err?.message || err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

/** POST /api/waitlist/resend — re-send the confirmation email (rate-limited). */
export async function resendWaitlist(req, res) {
  try {
    const email = (req.body && req.body.email) || '';
    const result = await waitlist.resendConfirmation(email, { ip: req.ip });

    if (!result.ok) {
      if (result.code === 'validation') {
        return res.status(422).json({ error: 'Enter a valid email address.' });
      }
      if (result.code === 'rate_limited') {
        return res.status(429).json({ error: 'Please wait a moment before requesting another email.' });
      }
      if (isUnavailable(result.code)) {
        return res.status(503).json(UNAVAILABLE);
      }
      return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }

    // Anti-enumeration: identical response whether or not the email exists.
    return res.status(200).json({ ok: true, message: 'If that email is on the waitlist, we have re-sent the confirmation.' });
  } catch (err) {
    console.error('[waitlist] resendWaitlist error:', err?.message || err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
