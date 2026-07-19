/**
 * googleErrorCopy.js (94.md §2.8) — maps the server's `?googleError=<CODE>` query
 * param into human, non-sensitive copy. The server NEVER puts raw OAuth errors,
 * tokens, state, or provider responses in the URL — only these stable codes — and
 * the frontend must never surface a raw code. Any unknown/covert code falls back
 * to the generic failure line so we never leak an internal identifier to the user.
 *
 * Shared by Login, Register and Profile (the three plausible return targets).
 */
export const GOOGLE_ERROR_COPY = {
  GOOGLE_NOT_CONFIGURED: "Google sign-in isn't available right now.",
  GOOGLE_AUTH_FAILED: 'Google sign-in failed. Please try again.',
  GOOGLE_EXPIRED: 'The sign-in request expired. Please try again.',
  GOOGLE_DENIED: 'Google sign-in was cancelled.',
  GOOGLE_EMAIL_UNVERIFIED:
    'Your Google email address is not verified. Verify it with Google, then try again.',
  GOOGLE_NOT_INVITED:
    "PecanRev is in closed beta. This Google account's email has no invitation — join the waitlist or use your invitation email.",
  GOOGLE_SUSPENDED: 'Your account has been suspended. Please contact support.',
  ACCOUNT_EXISTS_LINK_REQUIRED:
    'An account with this email already exists. Sign in with your password, then connect Google from Profile → Security.',
  GOOGLE_ALREADY_LINKED_OTHER_USER:
    'That Google account is already connected to a different PecanRev account.',
  GOOGLE_LINK_CONFLICT:
    'A different Google account is already connected to your account.',
  GOOGLE_PROVIDER_UNAVAILABLE:
    'Google sign-in is temporarily unavailable. Please try again shortly.',
};

const GENERIC = 'Google sign-in failed. Please try again.';

/** Resolve a googleError code to safe copy. Unknown/empty → generic failure line. */
export function googleErrorMessage(code) {
  if (!code) return null;
  return GOOGLE_ERROR_COPY[code] || GENERIC;
}

export default googleErrorMessage;
