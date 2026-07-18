/**
 * feedbackReference.js — 93.md §9.3. Short human-quotable references for
 * feedback / bug reports ("FB-4F7K2Q"): 6 crypto-random base32 characters.
 *
 * Alphabet is RFC-4648 base32 (A–Z, 2–7): unambiguous in most fonts and safe to
 * read over the phone. 32^6 ≈ 1.07e9 combinations — collisions are practically
 * impossible at beta scale, and the column is a plain @@index (uniqueness by
 * construction, mirroring the User.userNumber additive-`db push` reasoning), so
 * a one-in-a-billion duplicate would be cosmetic, never a crash.
 */

import crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * generateFeedbackReference — e.g. "FB-4F7K2Q". Pure CSPRNG; no I/O.
 * @returns {string}
 */
export function generateFeedbackReference() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += BASE32_ALPHABET[bytes[i] % 32];
  return `FB-${out}`;
}

/** Reporter-suggested / admin-adjustable severity levels (93.md §9.3). */
export const FEEDBACK_SEVERITIES = ['critical', 'high', 'medium', 'low'];

/** Bug-triage lifecycle states (93.md §9.3). */
export const TRIAGE_STATUSES = ['new', 'acknowledged', 'needs_info', 'planned', 'in_progress', 'shipped', 'declined', 'duplicate'];
