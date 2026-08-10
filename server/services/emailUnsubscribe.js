/**
 * emailUnsubscribe.js — one-click unsubscribe for the DISABLEABLE outbound
 * emails (registry category 'optional' in ./emailTemplates.js).
 *
 * THE TOKEN. An unsubscribe link is followed from a mail client, often years
 * later, with no session and no CSRF context — so the link itself has to be the
 * whole credential, and it must be impossible to forge or to retarget at another
 * user. Same construction as the OAuth transaction cookie (server/auth/gauthTxn.js):
 *
 *   key    = HMAC-SHA256(JWT_SECRET, 'email-unsub-v1')     ← domain-separated
 *   body   = base64url(JSON{ v, userId, category, issuedAt })
 *   token  = body + '.' + base64url(HMAC-SHA256(key, body))
 *
 * The domain separation matters: an unsubscribe token can never be replayed as
 * a session, a gauth transaction, or any other JWT_SECRET-signed artifact, and
 * vice versa. Verification is length-checked then timingSafeEqual, and the body
 * is only parsed AFTER the signature verifies — nothing untrusted is decoded
 * into an object before it has been authenticated.
 *
 * 30-day TTL: long enough that a link in a month-old email still works, short
 * enough that a token leaked from an archived mailbox eventually dies.
 *
 * THE PREFERENCE BLOB. Writes land in `User.emailNotifications`, a small
 * JSON-string map of templateKey → boolean, following exactly the conventions
 * dashboardPreferences / screeningShortcuts use in profileController (object
 * serialised to a string, 500-character cap, unparseable content treated as
 * empty rather than fatal). Absence means "enabled" — this is an opt-OUT model,
 * so a user who has never touched a preference still gets their welcome email.
 *
 * NOTE: `User.emailNotifications` does not exist in the schema yet (W1-B owns
 * adding the column). setEmailPreference is written against it and is fully
 * unit-tested with an injected client; against the real database it returns
 * { ok:false, error:'unavailable' } until the column lands, and starts working
 * the moment it does — no code change required here.
 */

import crypto from 'crypto';
import { isDisableableCategory, getEmailTemplate } from './emailTemplates.js';

/** 30 days. */
export const UNSUBSCRIBE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Mirrors the 500-char cap profileController applies to its JSON-blob columns. */
export const EMAIL_PREFERENCE_MAX_CHARS = 500;

const UNSUBSCRIBE_PATH = '/api/email/unsubscribe';

function signingKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return crypto.createHmac('sha256', secret).update('email-unsub-v1').digest();
}

function hmac(data) {
  return crypto.createHmac('sha256', signingKey()).update(data).digest('base64url');
}

/**
 * createUnsubscribeToken — mint a signed opt-out token for one user + one
 * template key.
 * @param {{userId:string, category:string, issuedAt?:number}} opts
 * @returns {string} token
 */
export function createUnsubscribeToken({ userId, category, issuedAt = Date.now() } = {}) {
  if (!userId) throw new Error('createUnsubscribeToken requires a userId');
  if (!category) throw new Error('createUnsubscribeToken requires a category');
  const payload = { v: 1, userId: String(userId), category: String(category), issuedAt };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(body)}`;
}

/**
 * verifyUnsubscribeToken — authenticate and decode. Typed result, never throws.
 * @param {string} token
 * @returns {{ok:true, payload:{userId:string, category:string, issuedAt:number}}
 *          | {ok:false, error:'missing'|'invalid'|'expired'}}
 */
export function verifyUnsubscribeToken(token) {
  if (!token || typeof token !== 'string') return { ok: false, error: 'missing' };
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return { ok: false, error: 'invalid' };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let expected;
  try { expected = hmac(body); } catch { return { ok: false, error: 'invalid' }; }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'invalid' };

  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false, error: 'invalid' }; }
  if (!payload || payload.v !== 1 || !payload.userId || !payload.category) return { ok: false, error: 'invalid' };
  if (typeof payload.issuedAt !== 'number' || Date.now() - payload.issuedAt > UNSUBSCRIBE_TTL_MS) {
    return { ok: false, error: 'expired' };
  }
  return { ok: true, payload: { userId: String(payload.userId), category: String(payload.category), issuedAt: payload.issuedAt } };
}

/**
 * unsubscribeUrl — the absolute link that goes in the email. Empty string when
 * APP_BASE_URL is unset (dev/preview) or the token cannot be minted, so callers
 * degrade to "no unsubscribe header" instead of shipping a broken relative link.
 * @returns {string}
 */
export function unsubscribeUrl(userId, category) {
  const base = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base || !userId || !category) return '';
  try {
    return `${base}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(createUnsubscribeToken({ userId, category }))}`;
  } catch {
    return ''; // JWT_SECRET missing — never break a send over a header
  }
}

/**
 * unsubscribeHeaders — the extra mail headers for a send, ready to hand to
 * sendEmail({ headers }). Returns {} for transactional categories: a
 * List-Unsubscribe on a password-reset email would advertise an opt-out we will
 * not honour.
 * @param {string} userId
 * @param {string} category  a template key, e.g. 'welcome'
 * @returns {{'List-Unsubscribe'?:string}}
 */
export function unsubscribeHeaders(userId, category) {
  if (!isDisableableCategory(category)) return {};
  const url = unsubscribeUrl(userId, category);
  if (!url) return {};
  return { 'List-Unsubscribe': `<${url}>` };
}

// ── The preference blob ───────────────────────────────────────────────────────

/**
 * parseEmailPreferences — tolerant read of the JSON-string column. Anything
 * unparseable, non-object, or non-boolean-valued is discarded rather than
 * thrown: a corrupted preference blob must never stop a user from receiving
 * mail or block the profile endpoints.
 * @param {string|object|null} raw
 * @returns {Record<string, boolean>}
 */
export function parseEmailPreferences(raw) {
  if (!raw) return {};
  let obj = raw;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch { return {}; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/**
 * isEmailCategoryEnabled — opt-OUT semantics: anything not explicitly set to
 * false is enabled, and transactional categories are ALWAYS enabled regardless
 * of what the blob says.
 * @param {string|object|null} raw  the stored emailNotifications value
 * @param {string} category
 * @returns {boolean}
 */
export function isEmailCategoryEnabled(raw, category) {
  if (!isDisableableCategory(category)) return true;
  const prefs = parseEmailPreferences(raw);
  return prefs[category] !== false;
}

/**
 * applyEmailPreference — PURE. Compute the next blob from the current one.
 * Exported separately from the DB write so the blob semantics (merge, cap,
 * tolerance of junk) are testable without any prisma at all.
 * @returns {{ok:true, json:string, preferences:Record<string,boolean>} | {ok:false, error:'too_large'}}
 */
export function applyEmailPreference(raw, category, enabled) {
  const prefs = parseEmailPreferences(raw);
  prefs[String(category)] = Boolean(enabled);
  const json = JSON.stringify(prefs);
  if (json.length > EMAIL_PREFERENCE_MAX_CHARS) return { ok: false, error: 'too_large' };
  return { ok: true, json, preferences: prefs };
}

/**
 * setEmailPreference — persist one category flag on User.emailNotifications.
 * Never throws.
 *
 * @param {string} userId
 * @param {string} category  a template key from the registry
 * @param {boolean} enabled  false to opt out, true to opt back in
 * @param {object} [client]  injectable prisma-shaped client ({ user: { findUnique, update } });
 *                           defaults to the app client, imported lazily so unit
 *                           tests of this module never construct Prisma.
 * @returns {Promise<{ok:true, preferences:Record<string,boolean>}
 *          | {ok:false, error:'unknown_category'|'not_disableable'|'not_found'|'too_large'|'unavailable'}>}
 */
export async function setEmailPreference(userId, category, enabled, client = null) {
  if (!userId) return { ok: false, error: 'not_found' };
  if (!getEmailTemplate(category)) return { ok: false, error: 'unknown_category' };
  // Opting OUT is only meaningful for the disableable ones; opting back IN is
  // always allowed so a stale `false` can be cleared even if a category's
  // classification later changes.
  if (!enabled && !isDisableableCategory(category)) return { ok: false, error: 'not_disableable' };

  let db = client;
  if (!db) {
    try {
      ({ prisma: db } = await import('../db/client.js'));
    } catch (err) {
      console.error('[emailUnsubscribe] prisma unavailable:', err?.message || err);
      return { ok: false, error: 'unavailable' };
    }
  }

  try {
    const user = await db.user.findUnique({ where: { id: String(userId) }, select: { emailNotifications: true } });
    if (!user) return { ok: false, error: 'not_found' };
    const next = applyEmailPreference(user.emailNotifications, category, enabled);
    if (!next.ok) return next;
    await db.user.update({ where: { id: String(userId) }, data: { emailNotifications: next.json } });
    return { ok: true, preferences: next.preferences };
  } catch (err) {
    // Until W1-B adds the column this is where we land: prisma rejects the
    // unknown `emailNotifications` field. Logged, never thrown — an unsubscribe
    // page must not 500 the process.
    console.error('[emailUnsubscribe] setEmailPreference failed:', err?.message || err);
    return { ok: false, error: 'unavailable' };
  }
}
