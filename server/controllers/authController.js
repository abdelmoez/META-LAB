import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/jwt.js';
import { notifyProjectInvite } from '../services/notificationService.js';
import { isValidEmail } from '../utils/validators.js';
import { recordUsage, USAGE } from '../utils/usage.js';
import { sendEmail, renderPasswordResetEmail, renderEmailVerificationEmail } from '../services/emailService.js';
import { createResetToken, consumeResetToken } from '../services/passwordResetService.js';
import { createVerificationToken, consumeVerificationToken } from '../services/emailVerificationService.js';
import { normalizeInstitution } from '../../src/research-engine/institutions/institutionMatch.js';
import { resolveCountry, getClientIp, hashIp } from '../utils/geo.js';

const COOKIE_NAME = 'metalab_session';

// Identical body for every forgot-password outcome — prevents account
// enumeration (a valid, an invalid, and a suspended email all look the same).
const FORGOT_PASSWORD_RESPONSE = {
  ok: true,
  message: 'If an account exists for that email, a password reset link has been sent.',
};

/**
 * Record a LoginEvent for ops unique-login metrics (prompt6 Task 9).
 * Fire-and-forget â€” never awaited in the response path, never throws.
 * Only called when a user row exists (userId is required; unknown-email
 * failures are already covered by the FAILED_LOGIN SecurityEvent).
 */
function recordLoginEvent(req, user, success) {
  prisma.loginEvent.create({
    data: {
      userId: user.id,
      email: user.email || '',
      ip: req.ip || '',
      userAgent: req.get('user-agent') || '',
      success,
    },
  }).catch(() => {});
}

/**
 * Claim pending METAÂ·SIFT invites at registration (prompt6 Task 1, plan Â§8
 * risk 12). Pending ScreenProjectMember rows (userId null) matching the new
 * user's normalized email are claimed (userId set, pending â†’ active) and a
 * deferred PROJECT_INVITE notification is created for each active membership.
 * The inviter is unknown at claim time (member rows carry no inviter info),
 * so the notification falls back to a generic actor.
 * Best-effort â€” registration must never fail or slow because of this.
 */
async function claimPendingScreenInvites(user) {
  try {
    const pending = await prisma.screenProjectMember.findMany({
      where: { email: user.email, userId: null },
    });
    for (const m of pending) {
      try {
        const member = await prisma.screenProjectMember.update({
          where: { id: m.id },
          data: {
            userId: user.id,
            name: m.name || user.name || '',
            // Activate pending invites; leave any other status untouched.
            status: m.status === 'pending' ? 'active' : m.status,
          },
        });
        if (member.status !== 'active') continue;
        const project = await prisma.screenProject.findUnique({ where: { id: m.projectId } });
        if (project) {
          await notifyProjectInvite({ member, project, roleLabel: member.permissionPreset || member.role });
        }
      } catch { /* per-row best-effort â€” keep claiming the rest */ }
    }
  } catch { /* best-effort side-effect â€” swallow */ }
}

/**
 * Best-effort COUNTRY-LEVEL capture at registration (prompt19 Task 12).
 * Resolves the registrant's country (proxy header → optional geoip → local/
 * unknown) and persists the 4 nullable registration* fields. Privacy: country
 * only — never city/coords, never the raw IP (only an optional salted hash).
 * Fully wrapped so geolocation can NEVER block or 500 registration.
 */
async function captureRegistrationCountry(req, user) {
  try {
    const { code, name, source } = await resolveCountry(req);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        registrationCountryCode: code || '',
        registrationCountryName: name || 'Unknown',
        registrationIpCountrySource: source || 'none',
        registrationIpHash: hashIp(getClientIp(req)),
        registrationCountryDetectedAt: new Date(),
      },
    });
  } catch { /* best-effort side-effect — swallow, never affect the response */ }
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  };
}

/**
 * Is email verification currently required? Reads appSettings.requireEmailVerification
 * (prompt26). Default/missing = false (OFF). A settings-read failure is treated as
 * OFF so verification can never block registration/login by accident.
 */
async function isEmailVerificationRequired() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'appSettings' } });
    const appSettings = row ? JSON.parse(row.value || '{}') : {};
    return appSettings.requireEmailVerification === true;
  } catch { return false; }
}

/**
 * Mint a verify token + send the verification email. Best-effort: never throws,
 * never blocks the caller. Returns the sendEmail result (or a {sent:false} shape).
 */
async function sendVerificationEmail(req, user) {
  try {
    const { token, expiresAt } = await createVerificationToken(user.id);
    const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/verify-email?token=${token}`;
    const { html, text } = renderEmailVerificationEmail({ toName: user.name || '', link, expiresAt });
    return await sendEmail({ to: user.email, subject: 'Verify your PecanRev email', html, text, context: 'email_verification' });
  } catch (e) {
    console.error('[auth] sendVerificationEmail issue:', e.message);
    return { sent: false, reason: 'error' };
  }
}

// prompt26 — accepted onboarding option values (server-side allow-list; unknown
// values are stored as-is but trimmed/length-capped so the field can't be abused).
function cleanProfileValue(v, max = 120) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * POST /api/auth/register
 * Body: { email, password, name? }
 */
export async function register(req, res) {
  try {
    const { email, password, name, acceptedTerms } = req.body || {};

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // prompt9 — registrationOpen enforcement. Default/missing = open; only an
    // explicit false closes the doors. Settings-read failures never block
    // registration (best-effort gate).
    try {
      const row = await prisma.siteSetting.findUnique({ where: { key: 'appSettings' } });
      const appSettings = row ? JSON.parse(row.value || '{}') : {};
      if (appSettings.registrationOpen === false) {
        return res.status(403).json({ error: 'Registration is currently closed' });
      }
    } catch { /* default open */ }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    // prompt26 — email verification gate (OFF by default). When ON, the account
    // is created unverified and a verify email is sent; when OFF, the account is
    // auto-verified so existing behaviour and ops stats stay clean.
    const verifyRequired = await isEmailVerificationRequired();

    const hashed = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name?.trim() || null,
        password: hashed,
        role: 'user',
        termsAcceptedAt: acceptedTerms ? new Date() : null,
        emailVerifiedAt: verifyRequired ? null : new Date(),
      },
    });

    // Claim pending METAÂ·SIFT invites for this email + emit deferred invite
    // notifications â€” fire-and-forget, never blocks registration.
    claimPendingScreenInvites(user).catch(() => {});

    // Best-effort COUNTRY-LEVEL capture for ops analytics (prompt19 Task 12).
    // Fire-and-forget — geolocation must never block or 500 registration.
    captureRegistrationCountry(req, user).catch(() => {});

    // Send the verification email when required (fire-and-forget; never 500s,
    // and registration succeeds even if SMTP is unconfigured).
    if (verifyRequired) sendVerificationEmail(req, user).catch(() => {});

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.cookie(COOKIE_NAME, token, cookieOptions());

    return res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt },
      emailVerified: !verifyRequired,
      requireEmailVerification: verifyRequired,
    });
  } catch (err) {
    console.error('[auth] register error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
export async function login(req, res) {
  try {
    const { email, password } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'password is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    // Use constant-time comparison via bcrypt even if user not found (prevent timing attacks)
    const passwordMatches = user ? await verifyPassword(password, user.password) : false;

    if (!user || !passwordMatches) {
      // Log failed login attempt as a SecurityEvent
      await prisma.securityEvent.create({
        data: {
          type: 'FAILED_LOGIN',
          email: normalizedEmail,
          ip: req.ip || null,
          userAgent: req.get('user-agent') || null,
          details: JSON.stringify({ reason: 'invalid_credentials' }),
        },
      }).catch(() => {});

      // Known account, wrong password â†’ failed LoginEvent for ops metrics
      // (unknown email skipped: LoginEvent requires a userId; the SecurityEvent
      // above already covers forensics). Fire-and-forget.
      if (user) recordLoginEvent(req, user, false);

      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user is suspended
    if (user.suspended) {
      recordLoginEvent(req, user, false);
      return res.status(401).json({ error: 'Your account has been suspended. Please contact support.' });
    }

    // prompt26 — block unverified sign-in ONLY when verification is required.
    // Default OFF → no effect on existing behaviour. code lets the UI offer resend.
    if (!user.emailVerifiedAt && await isEmailVerificationRequired()) {
      return res.status(403).json({
        error: 'Please verify your email to sign in. Check your inbox, or request a new verification link.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    // Login metrics + lastActive (prompt6 Tasks 9/10) â€” fire-and-forget, never
    // awaited: a metrics failure must never fail or slow the login response.
    recordLoginEvent(req, user, true);
    prisma.user.update({ where: { id: user.id }, data: { lastActive: new Date() } }).catch(() => {});

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.cookie(COOKIE_NAME, token, cookieOptions());

    return res.json({
      // prompt31 Part 1 — expose onboarding status so the client can send a user
      // who has never completed/skipped onboarding there (incl. after verifying
      // their email and signing in).
      user: { id: user.id, email: user.email, name: user.name, role: user.role, onboardingCompleted: !!user.onboardingCompletedAt },
    });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/auth/logout
 * Requires auth (protected by requireAuth middleware).
 */
export async function logout(req, res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict' });
  return res.json({ ok: true });
}

/**
 * GET /api/auth/me
 * Requires auth (protected by requireAuth middleware).
 */
export async function getMe(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, name: true, role: true, suspended: true, createdAt: true,
        themePreference: true, workflowMenuMode: true, lastActive: true,
        emailVerifiedAt: true, onboardingCompletedAt: true,
        primaryRole: true, researchField: true, mainUseCase: true,
        institutionOriginal: true, country: true,
      },
    });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    const requireEmailVerification = await isEmailVerificationRequired();
    return res.json({
      user: {
        ...user,
        emailVerified: !!user.emailVerifiedAt,
        onboardingCompleted: !!user.onboardingCompletedAt,
      },
      requireEmailVerification,
    });
  } catch (err) {
    console.error('[auth] getMe error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/auth/forgot-password (public; authLimiter)
 * Body: { email }
 * Self-service reset request. ALWAYS returns the same generic 200 body — it never
 * reveals whether an account exists (no enumeration). When the email maps to a
 * real, non-suspended account a single-use token is minted and the reset link is
 * emailed (best-effort). The raw token is never returned to an unauthenticated
 * caller and never logged.
 */
export async function forgotPassword(req, res) {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string' || !isValidEmail(email.trim())) {
      // Malformed input is a format error, not an existence oracle.
      return res.status(400).json({ error: 'A valid email is required' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const ip = req.ip || '';
    const userAgent = req.get('user-agent') || null;
    const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;

    // Fire-and-forget the lookup + token mint + email send so the response time is
    // INDEPENDENT of whether the account exists — closing the timing/latency
    // enumeration side-channel (an awaited SMTP round-trip would otherwise make a
    // known email measurably slower than an unknown one). Mirrors the
    // recordLoginEvent fire-and-forget convention in this controller.
    (async () => {
      try {
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user || user.suspended) return;
        const { token, expiresAt } = await createResetToken(user.id, { ip });
        const link = `${base}/reset?token=${token}`;
        const { html, text } = renderPasswordResetEmail({ toName: user.name || '', link, expiresAt });
        const result = await sendEmail({
          to: user.email,
          subject: 'Reset your PecanRev password',
          html,
          text,
          context: 'password_reset',
        });
        if (result.sent) recordUsage({ type: USAGE.PASSWORD_RESET_EMAIL_SENT, userId: user.id, meta: { self: true } });
        else if (result.reason === 'send_failed') recordUsage({ type: USAGE.PASSWORD_RESET_EMAIL_FAILED, userId: user.id, meta: { self: true, reason: result.reason } });
        // Audit the request (no raw token) for abuse forensics.
        await prisma.securityEvent.create({
          data: {
            type: 'PASSWORD_RESET_REQUESTED',
            userId: user.id,
            email: user.email,
            ip: ip || null,
            userAgent,
            details: JSON.stringify({ self: true, emailSent: result.sent }),
          },
        }).catch(() => {});
      } catch (e) {
        console.error('[auth] forgotPassword issue:', e.message);
      }
    })();

    // Always the same generic body, returned immediately for every input.
    return res.json(FORGOT_PASSWORD_RESPONSE);
  } catch (err) {
    console.error('[auth] forgotPassword error:', err.message);
    return res.json(FORGOT_PASSWORD_RESPONSE);
  }
}

/**
 * POST /api/auth/reset-password (public; authLimiter)
 * Body: { token, password }
 * Consumes a single-use reset token and sets the new password. The token is
 * invalidated on success; expired/invalid/used tokens are rejected with 400.
 */
export async function resetPassword(req, res) {
  try {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing reset token' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const result = await consumeResetToken(token, password);
    if (!result.ok) {
      if (result.reason === 'expired') {
        return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
      }
      return res.status(400).json({ error: 'This reset link is invalid or has already been used.' });
    }

    await prisma.securityEvent.create({
      data: {
        type: 'PASSWORD_RESET_COMPLETED',
        userId: result.userId,
        ip: req.ip || null,
        userAgent: req.get('user-agent') || null,
      },
    }).catch(() => {});

    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth] resetPassword error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/auth/verify-email (public)  Body: { token }
 * Consumes a single-use verify token and marks the user verified.
 */
export async function verifyEmail(req, res) {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid or missing verification token' });
    }
    const result = await consumeVerificationToken(token);
    if (!result.ok) {
      return res.status(400).json({
        error: result.reason === 'expired'
          ? 'This verification link has expired. Request a new one.'
          : 'This verification link is invalid or has already been used.',
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth] verifyEmail error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/auth/resend-verification (public; authLimiter)  Body: { email }
 * No-enumeration: always returns the same generic 200. Sends a fresh verify
 * email only for a real, unverified account when verification is enabled.
 */
export async function resendVerification(req, res) {
  const GENERIC = { ok: true, message: 'If that account exists and needs verification, a new link has been sent.' };
  try {
    const { email } = req.body || {};
    const normalizedEmail = (email || '').trim().toLowerCase();
    (async () => {
      try {
        if (!normalizedEmail || !(await isEmailVerificationRequired())) return;
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user || user.suspended || user.emailVerifiedAt) return;
        await sendVerificationEmail(req, user);
      } catch (e) { console.error('[auth] resendVerification issue:', e.message); }
    })();
    return res.json(GENERIC);
  } catch {
    return res.json(GENERIC);
  }
}

/**
 * POST /api/auth/onboarding (requireAuth)
 * Body: { primaryRole?, researchField?, mainUseCase?, institution?, country? }
 * Saves the OPTIONAL onboarding profile. Never blocks; preserves the exact
 * institution text and also stores a normalized matching key. Marks onboarding
 * complete. Institution matching failure is non-fatal.
 */
export async function updateOnboarding(req, res) {
  try {
    const b = req.body || {};
    // prompt31 Part 1 — "Skip for now" just marks onboarding done (so the user is
    // not re-prompted) WITHOUT overwriting any profile fields they may already have.
    if (b.skipped === true) {
      const u = await prisma.user.update({
        where: { id: req.user.id },
        data: { onboardingCompletedAt: new Date() },
        select: { id: true, onboardingCompletedAt: true },
      });
      return res.json({ ok: true, user: { ...u, onboardingCompleted: true, skipped: true } });
    }
    const institutionOriginal = cleanProfileValue(b.institution, 200);
    let institutionNormalized = null;
    try { institutionNormalized = institutionOriginal ? normalizeInstitution(institutionOriginal) || null : null; } catch { institutionNormalized = null; }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        primaryRole: cleanProfileValue(b.primaryRole),
        researchField: cleanProfileValue(b.researchField),
        mainUseCase: cleanProfileValue(b.mainUseCase),
        country: cleanProfileValue(b.country),
        institutionOriginal,
        institutionNormalized,
        onboardingCompletedAt: new Date(),
      },
      select: {
        id: true, primaryRole: true, researchField: true, mainUseCase: true,
        institutionOriginal: true, country: true, onboardingCompletedAt: true,
      },
    });
    return res.json({ ok: true, user: { ...user, onboardingCompleted: true } });
  } catch (err) {
    console.error('[auth] updateOnboarding error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
