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
 * @param {boolean} [acceptedTerms]
 * @param {string} [turnstileToken] — optional Cloudflare Turnstile token (94.md
 *   §3.10). Sent additively when present; the server verifies it and fails open
 *   when Cloudflare is unreachable, so registration never hard-blocks on it.
 * @returns {Promise<{ user: object }>}
 */
export async function register(email, password, name, inviteToken, acceptedTerms, turnstileToken) {
  const payload = { email, password, name, acceptedTerms: !!acceptedTerms };
  if (inviteToken) payload.inviteToken = inviteToken;
  if (turnstileToken) payload.turnstileToken = turnstileToken;
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
 * prompt32 — fetch pending onboarding questions for the current user.
 * Returns { questions: [], intro: null } on any error so the app is never blocked.
 * @returns {Promise<{ questions: Array, intro: object|null }>}
 */
export async function getPendingOnboarding() {
  try {
    const res = await fetch("/api/onboarding/pending", { credentials: "include" });
    if (!res.ok) return { questions: [], intro: null };
    const data = await res.json();
    // Treat an all-empty intro ({title:'',body:''}) as null so the UI shows its
    // friendly default rather than a blank heading.
    const intro = data.intro && (data.intro.title || data.intro.body) ? data.intro : null;
    return { questions: data.questions || [], intro };
  } catch {
    return { questions: [], intro: null };
  }
}

/**
 * prompt32 — submit answers to onboarding questions.
 * @param {{ questionId: string, answer: any }[]} responses
 * @returns {Promise<{ ok: boolean, pending: Array }>}
 */
export async function submitOnboardingResponses(responses) {
  const res = await fetch("/api/onboarding/responses", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ responses }),
  });
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const message = (data && data.error) || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data;
}

/**
 * prompt32 — skip pending onboarding questions (all skippable, or a subset by id).
 * @param {string[]} [questionIds] — omit to skip all currently-pending skippable questions
 * @returns {Promise<{ ok: boolean, pending: Array }>}
 */
export async function skipOnboarding(questionIds) {
  const body = questionIds ? { questionIds } : {};
  const res = await fetch("/api/onboarding/skip", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const message = (data && data.error) || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data;
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
