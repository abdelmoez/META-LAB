/**
 * server/index.js
 * META·LAB API server — Express entry point, port 3001.
 */

import './load-env.js';   // MUST be first: populate process.env before Prisma/JWT load
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler }  from './middleware/errorHandler.js';
import { requireAuth }   from './middleware/auth.js';
import { maintenanceGate } from './middleware/maintenance.js';
import { spaEnabled, serveSpa, distDir } from './middleware/spaTheme.js';

import authRouter        from './routes/auth.js';
import projectsRouter    from './routes/projects.js';
import studiesRouter     from './routes/studies.js';
import recordsRouter     from './routes/records.js';
import metaRouter        from './routes/meta.js';
import validationRouter  from './routes/validation.js';
import importExportRouter from './routes/importExport.js';
import profileRouter     from './routes/profile.js';
import presenceRouter    from './routes/presence.js';
import contactRouter     from './routes/contact.js';
import settingsRouter    from './routes/settings.js';
import adminRouter       from './routes/admin.js';
import screeningRouter    from './routes/screening.js';
import notificationsRouter from './routes/notifications.js';
import invitesRouter      from './routes/invites.js';
import eventsRouter       from './routes/events.js';
import robRouter          from './routes/rob.js';
import onboardingRouter   from './routes/onboarding.js';
import institutionsRouter from './routes/institutions.js';

import { initDefaultSettings } from './controllers/settingsController.js';
import { seedOnboardingQuestions } from './controllers/onboardingController.js';
import { seedAdmins } from './auth/seedAdmins.js';
import { getVersion } from './version.js';
import { resolveCorsOrigin } from './config/cors.js';

const app = express();

// ── Trust proxy (prompt30 Part 1) ────────────────────────────────────────────────
// Behind a reverse proxy / load balancer (nginx, Cloudflare, a cloud LB) the real
// client IP arrives in X-Forwarded-For. Express only derives req.ip from it when
// 'trust proxy' is configured — otherwise req.ip is the PROXY's (private) IP, which
// made registration geolocation save "Local" and weakened IP-based rate limits.
// Default trusts only LOCAL/PRIVATE upstream proxies (the common nginx / CF-tunnel /
// LB-on-private-net setup) so a public client can never spoof X-Forwarded-For.
// Override with TRUST_PROXY: 'true'/'false', a hop count (e.g. '1'), or a CSV of
// subnets ('loopback, linklocal, uniquelocal').
function resolveTrustProxy(raw) {
  if (raw == null || String(raw).trim() === '') return 'loopback, linklocal, uniquelocal';
  const v = String(raw).trim();
  if (v.toLowerCase() === 'true') return true;
  if (v.toLowerCase() === 'false') return false;
  if (/^\d+$/.test(v)) return parseInt(v, 10); // hop count
  return v;                                     // subnet list / 'loopback' etc.
}
app.set('trust proxy', resolveTrustProxy(process.env.TRUST_PROXY));

// ── Security headers ───────────────────────────────────────────────────────────
// The API serves JSON only, so its CSP can be maximally strict (default-src 'none').
// The SPA's own CSP lives in index.html (<meta http-equiv>) because the frontend
// is served by Vite/nginx, not this process.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
}));

// ── Rate limiter for auth routes (20 req / 15 min in production; relaxed in dev/test) ──
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 1000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Rate limiter for the public, unauthenticated contact form ──────────────────
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 8 : 1000,
  message: { error: 'Too many messages, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Rate limiter for public invite endpoints (prompt9; 30 req / 15 min in prod) ─
const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 30 : 1000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Rate limiter for institution autocomplete (prompt35) — typeahead fires often,
// so a generous-but-bounded budget (120 req / 15 min in prod) per IP. ───────────
const institutionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 120 : 1000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Core middleware ────────────────────────────────────────────────────────────
// CORS origin is env-driven for deployment (CORS_ORIGIN, then APP_BASE_URL),
// falling back to the local Vite dev server. credentials:true is required so the
// httpOnly session cookie is sent on cross-origin requests.
const ORIGIN = resolveCorsOrigin();
app.use(cors({ origin: ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(requestLogger);

// ── Maintenance mode gate (prompt9) ───────────────────────────────────────────
// AFTER cookieParser (needs the session cookie for the staff bypass), BEFORE
// every API router. Exempts /api/health, /api/version, /api/settings/public,
// /api/auth/*, /api/admin/*, /api/events; admin|mod sessions pass; everyone
// else gets 503 { error: <maintenanceMessage>, maintenance: true } while
// appSettings.maintenanceMode === true. 10s-TTL settings cache; default off.
app.use(maintenanceGate);

// ── Health check (public) ─────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: getVersion().version });
});

// ── Version metadata (public, no auth) ─────────────────────────────────────────
app.get('/api/version', (_req, res) => res.json(getVersion()));

// ── Auth routes (public: register/login; protected: logout/me) ────────────────
app.use('/api/auth', authLimiter, authRouter);

// ── Public settings ────────────────────────────────────────────────────────────
app.use('/api/settings', settingsRouter);

// ── Protected route mounting ───────────────────────────────────────────────────
app.use('/api/profile',              profileRouter);
app.use('/api/presence',             presenceRouter);
app.use('/api/contact',              contactLimiter, contactRouter);
app.use('/api/projects',             projectsRouter);
app.use('/api/projects/:id/studies', studiesRouter);
app.use('/api/projects/:id/records', recordsRouter);
app.use('/api/meta',                 metaRouter);
app.use('/api/validation',           validationRouter);
// Bell polling endpoint — own mount, NEVER under the rate-limited /api/auth
// or /api/admin routers (requireAuth applied inside the router).
app.use('/api/notifications',        notificationsRouter);

// ── Public invite endpoints (prompt9) — token landing + accept. Own mount with
// a dedicated limiter. MUST be mounted BEFORE the bare '/api' importExport
// router below: that router applies requireAuth at router level and would 401
// every unauthenticated /api/* request, killing the pre-auth invite landing.
app.use('/api/invites', inviteLimiter, invitesRouter);

app.use('/api',                      importExportRouter);  // /api/import/... and /api/export/...

// ── Admin routes (requireAuth + requireAdmin applied inside admin router) ──────
app.use('/api/admin', requireAuth, adminRouter);

// ── META·SIFT Beta screening routes (requireAuth applied inside router) ────────
app.use('/api/screening', screeningRouter);

// ── META·LAB RoB (Risk of Bias) routes (rob.md). requireAuth at the mount;
// each handler additionally gates on the rob_engine_v2 flag (default OFF → 404)
// and enforces project ownership. ──────────────────────────────────────────────
app.use('/api/rob', requireAuth, robRouter);

// ── Onboarding questions (prompt32 Task 6) — requireAuth inside the router.
// Per-user pending computation so newly-added active questions interrupt
// already-registered users on their next login.
app.use('/api/onboarding', onboardingRouter);

// ── Institution autocomplete (prompt35) — own mount with a dedicated limiter;
// requireAuth applied inside the router. Backend-only ROR/local search.
app.use('/api/institutions', institutionLimiter, institutionsRouter);

// ── Realtime SSE stream (prompt6 Task 7) — own mount, NEVER under the
// rate-limited /api/auth or /api/admin routers (requireAuth inside the router).
app.use('/api/events', eventsRouter);

// ── SPA serving with server-injected theme (prompt37 follow-up) ────────────────
// When a production build exists (or SERVE_SPA=true), serve dist/ assets and the
// index.html with the live brand palette injected pre-paint, so the admin's
// chosen color is correct on the very first paint for first-time visitors too.
// Mounted AFTER every /api route so matched API routes always win; serveSpa
// skips /api/* (those fall through to the JSON 404 below).
if (spaEnabled()) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.use(serveSpa);
}

// ── 404 fallback ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(errorHandler);

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  const { version, commit } = getVersion();
  console.log(`META·LAB API on :${PORT} (v${version} · ${commit})`);
  // Initialize default settings + ensure admin accounts exist (non-blocking)
  initDefaultSettings().catch(console.error);
  seedOnboardingQuestions().catch(err => console.error('[seed] onboarding seed failed:', err.message));
  seedAdmins().catch(err => console.error('[seed] admin seed failed:', err.message));
});

export default app;
