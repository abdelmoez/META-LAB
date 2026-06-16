/**
 * emailVerificationService.js — token-based email verification (prompt26).
 *
 * Mirrors passwordResetService's security model, but stores the token state
 * INLINE on the User row (no new table needed):
 *   - 32-byte CSPRNG hex token; only its SHA-256 HASH is stored
 *     (User.emailVerificationTokenHash). The raw token is only in the email link.
 *   - Single-use: consuming clears the hash (race-safe updateMany guard).
 *   - Time-limited: User.emailVerificationExpiresAt (default 24h).
 * Verification is OFF by default (appSettings.requireEmailVerification); this
 * service is only exercised when an admin turns it on.
 */
import crypto from 'crypto';
import { prisma } from '../db/client.js';

const DEFAULT_TTL_MINUTES = 60 * 24; // 24 hours

export function verificationTtlMinutes() {
  const n = parseInt(process.env.EMAIL_VERIFICATION_TTL_MINUTES, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MINUTES;
}

/** SHA-256 hex of a raw token — the only form ever stored or compared. */
export function hashVerificationToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

/**
 * Issue a single-use verification token for a user. Stores only the hash;
 * returns the raw token + expiry to the caller (for the email link).
 */
export async function createVerificationToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashVerificationToken(token);
  const expiresAt = new Date(Date.now() + verificationTtlMinutes() * 60 * 1000);
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: expiresAt },
  });
  return { token, expiresAt };
}

/**
 * Consume a verification token: mark the user verified and burn the token.
 * @returns {Promise<{ok:true, userId} | {ok:false, reason:'invalid'|'expired'}>}
 */
export async function consumeVerificationToken(token) {
  if (!token || typeof token !== 'string' || token.length > 256) return { ok: false, reason: 'invalid' };
  const hash = hashVerificationToken(token);
  const user = await prisma.user.findFirst({ where: { emailVerificationTokenHash: hash } });
  if (!user) return { ok: false, reason: 'invalid' };
  if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  // Single-use: clear the hash/expiry + stamp verifiedAt. The hash-match guard
  // makes a concurrent double-consume resolve to count 0 and bail.
  const burn = await prisma.user.updateMany({
    where: { id: user.id, emailVerificationTokenHash: hash },
    data: { emailVerifiedAt: new Date(), emailVerificationTokenHash: null, emailVerificationExpiresAt: null },
  });
  if (burn.count === 0) return { ok: false, reason: 'invalid' };
  return { ok: true, userId: user.id };
}
