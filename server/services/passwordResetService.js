/**
 * passwordResetService.js — token-based password reset (prompt14 Task 4).
 *
 * Security model (mirrors the invite-token ceremony in invitesController.js):
 *   - Tokens are 32-byte CSPRNG hex. Only the SHA-256 HASH is stored
 *     (PasswordResetToken.tokenHash, plain-indexed). The raw token appears ONLY
 *     in the email link / authorized-operator response and is NEVER logged.
 *   - Single-use: consuming a token stamps `usedAt`; a race-safe updateMany guard
 *     (where usedAt:null) prevents a double-consume.
 *   - Time-limited: `expiresAt` = now + PASSWORD_RESET_TTL_MINUTES (default 60).
 *   - Issuing a new token invalidates the user's prior unused tokens (one live
 *     link at a time); a successful reset invalidates all remaining tokens.
 */
import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { hashPassword } from '../auth/password.js';

const DEFAULT_TTL_MINUTES = 60;

/** Configured reset-token lifetime in minutes (env override, sane default). */
export function resetTtlMinutes() {
  const n = parseInt(process.env.PASSWORD_RESET_TTL_MINUTES, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MINUTES;
}

/** SHA-256 hex of a raw token — the only form ever stored or compared. */
export function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

/**
 * createResetToken — issue a single-use reset token for a user.
 * Stores only the hash; returns the raw token + expiry to the caller.
 * @param {string} userId
 * @param {{requestedByUserId?:string|null, ip?:string}} [opts]
 * @returns {Promise<{token:string, expiresAt:Date}>}
 */
export async function createResetToken(userId, { requestedByUserId = null, ip = '' } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + resetTtlMinutes() * 60 * 1000);

  // One live link at a time — burn any prior unused tokens for this user.
  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  }).catch(() => {});

  await prisma.passwordResetToken.create({
    data: { userId, tokenHash, expiresAt, requestedByUserId: requestedByUserId || null, ip: ip || '' },
  });

  return { token, expiresAt };
}

/**
 * resolveResetToken — look up a claimable token row by raw token.
 * @param {string} token
 * @returns {Promise<{status:'invalid'|'expired'|'ok', row?:object}>}
 */
export async function resolveResetToken(token) {
  if (!token || typeof token !== 'string' || token.length > 256) return { status: 'invalid' };
  const row = await prisma.passwordResetToken.findFirst({ where: { tokenHash: hashResetToken(token) } });
  if (!row || row.usedAt) return { status: 'invalid' };
  if (row.expiresAt.getTime() < Date.now()) return { status: 'expired' };
  return { status: 'ok', row };
}

/**
 * consumeResetToken — atomically set a new password and burn the token.
 * @param {string} token
 * @param {string} newPassword (already length-validated by the caller)
 * @returns {Promise<{ok:true, userId:string} | {ok:false, reason:'invalid'|'expired'}>}
 */
export async function consumeResetToken(token, newPassword) {
  const { status, row } = await resolveResetToken(token);
  if (status !== 'ok') return { ok: false, reason: status };

  // Burn first (single-use) — the usedAt:null guard makes a concurrent
  // double-consume resolve to count 0 and bail before any password write.
  const burn = await prisma.passwordResetToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (burn.count === 0) return { ok: false, reason: 'invalid' };

  const hashed = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: row.userId }, data: { password: hashed } });

  // Invalidate any other outstanding tokens for this user.
  await prisma.passwordResetToken.updateMany({
    where: { userId: row.userId, usedAt: null },
    data: { usedAt: new Date() },
  }).catch(() => {});

  return { ok: true, userId: row.userId };
}
