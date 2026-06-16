/**
 * META·LAB — Auth client
 *
 * Thin wrappers around /api/auth/* endpoints.
 * All requests include credentials: 'include' so the httpOnly cookie is sent.
 * On error, throws an Error whose message is the server's { error: "..." } string.
 * getMe() returns null (instead of throwing) on 401 — used for startup auth checks.
 */

const BASE = "/api/auth";

async function authReq(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message = (data && data.error) || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(message);
  }

  return data;
}

/**
 * Register a new account.
 * @param {string} email
 * @param {string} password
 * @param {string} [name]
 * @param {string} [inviteToken] — optional invite token (prompt9 Task 2);
 *   sent additively in the JSON body so the server can claim the pending
 *   invite by token even when the registered email differs from the invite.
 * @returns {Promise<{ user: object }>}
 */
export async function register(email, password, name, inviteToken, acceptedTerms) {
  const payload = { email, password, name, acceptedTerms: !!acceptedTerms };
  if (inviteToken) payload.inviteToken = inviteToken;
  return authReq("/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** prompt26 — confirm an email-verification token (public). */
export async function verifyEmail(token) {
  return authReq("/verify-email", { method: "POST", body: JSON.stringify({ token }) });
}

/** prompt26 — resend a verification email (no-enumeration; always resolves ok). */
export async function resendVerification(email) {
  return authReq("/resend-verification", { method: "POST", body: JSON.stringify({ email }) });
}

/** prompt26 — save the optional onboarding profile (auth). */
export async function saveOnboarding(profile) {
  return authReq("/onboarding", { method: "POST", body: JSON.stringify(profile || {}) });
}

/**
 * Log in with email + password. Sets the session cookie.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ user: object }>}
 */
export async function login(email, password) {
  return authReq("/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Log out the current session. Clears the session cookie.
 * @returns {Promise<any>}
 */
export async function logout() {
  return authReq("/logout", { method: "POST" });
}

/**
 * Fetch the currently authenticated user.
 * Returns null on 401 (not authenticated) instead of throwing.
 * @returns {Promise<object|null>}
 */
export async function getMe() {
  try {
    const res = await fetch(`${BASE}/me`, { credentials: "include" });
    if (res.status === 401) return null;
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const message = (data && data.error) || `HTTP ${res.status} ${res.statusText}`;
      throw new Error(message);
    }
    return data && data.user ? data.user : data;
  } catch (err) {
    // Network errors or unexpected failures — treat as unauthenticated
    if (err.message && err.message.startsWith("HTTP 4")) throw err;
    return null;
  }
}
