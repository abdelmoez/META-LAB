/**
 * server/utils/validators.js — shared input validators (prompt9).
 *
 * isValidEmail is the single backend email-format gate, used by:
 *   - screeningMemberController.addMember (member/invite emails)
 *   - authController.register (account emails)
 *
 * The regex is deliberately pragmatic (one '@', non-empty local part,
 * domain containing at least one dot, no whitespace) — full RFC 5322
 * validation rejects real addresses and is not worth the false negatives.
 * Verified against every email used in tests/ and scripts/ (all are
 * `local@domain.tld` shaped: @example.com, @t.local, @metalab.local, ...).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * isValidEmail — pragmatic email format check.
 * @param {*} s candidate email (any type; non-strings fail)
 * @returns {boolean}
 */
export function isValidEmail(s) {
  if (typeof s !== 'string') return false;
  const v = s.trim();
  if (!v || v.length > 254) return false;
  return EMAIL_RE.test(v);
}
