/**
 * emailPublic.js — the unauthenticated email endpoints. Currently one:
 *
 *   GET /api/email/unsubscribe?token=…
 *
 * This is followed from a mail client, so it has to work with no session, no
 * JavaScript, and no SPA route — a redirect into the React app would break for
 * anyone whose client opens links in a stripped-down webview, and would make
 * the outcome depend on a bundle load. It therefore renders its own tiny,
 * self-contained HTML page and nothing else.
 *
 * The signed token is the only credential (see services/emailUnsubscribe.js).
 * Only 'optional'-category templates can be switched off; a token naming a
 * transactional one is a 400, not a silent no-op — if something ever mints an
 * unsubscribe link for a password-reset email we want to hear about it rather
 * than quietly promise an opt-out we will not honour.
 */

import express from 'express';
import { escapeHtml, getEmailTemplate } from '../services/emailTemplates.js';
import { verifyUnsubscribeToken, setEmailPreference } from '../services/emailUnsubscribe.js';

const router = express.Router();

/** Minimal standalone confirmation page — no SPA, no external assets, no JS. */
function page(res, status, title, message) {
  res.status(status).type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)} · PecanRev</title>
</head>
<body style="margin:0;padding:48px 16px;background:#f3f4f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1f2937;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:28px 32px;">
    <div style="font-size:18px;font-weight:700;letter-spacing:0.04em;color:#111827;margin-bottom:18px;">PecanRev</div>
    <h1 style="font-size:18px;font-weight:600;color:#111827;margin:0 0 12px;">${escapeHtml(title)}</h1>
    <p style="font-size:14px;line-height:1.7;color:#374151;margin:0;">${escapeHtml(message)}</p>
  </div>
</body>
</html>`);
}

/**
 * handleUnsubscribe — exported for direct unit testing (no supertest, no live
 * server). Mounted below as the route handler.
 */
export async function handleUnsubscribe(req, res) {
  const token = typeof req.query?.token === 'string' ? req.query.token : '';
  const verified = verifyUnsubscribeToken(token);

  if (!verified.ok) {
    return page(
      res,
      400,
      verified.error === 'expired' ? 'This link has expired' : 'This link is not valid',
      verified.error === 'expired'
        ? 'Unsubscribe links stop working after 30 days. You can change your email preferences from your account settings instead.'
        : 'We could not read that unsubscribe link. Please use the link from the most recent email, or change your email preferences from your account settings.',
    );
  }

  const { userId, category } = verified.payload;
  const template = getEmailTemplate(category);

  if (!template || template.category !== 'optional') {
    return page(
      res,
      400,
      'This email cannot be turned off',
      'That link refers to a transactional email — a security notice or an action you asked for, such as a password reset or an invitation. Those are part of running your account and cannot be unsubscribed from.',
    );
  }

  const result = await setEmailPreference(userId, category, false);
  if (!result.ok) {
    return page(
      res,
      503,
      'We could not save that',
      'Something went wrong while updating your email preferences. Please try the link again shortly, or change the setting from your account settings.',
    );
  }

  return page(
    res,
    200,
    'You have been unsubscribed',
    `You will no longer receive: ${template.description} You will still receive account and security emails, which are required to run your account.`,
  );
}

router.get('/unsubscribe', handleUnsubscribe);

export default router;
