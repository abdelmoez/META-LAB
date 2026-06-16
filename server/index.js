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

import { initDefaultSettings } from './controllers/settingsController.js';
import { seedAdmins } from './auth/seedAdmins.js';
import { getVersion } from './version.js';
import { resolveCorsOrigin } from './config/cors.js';

const app = express();

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

// ── Realtime SSE stream (prompt6 Task 7) — own mount, NEVER under the
// rate-limited /api/auth or /api/admin routers (requireAuth inside the router).
app.use('/api/events', eventsRouter);

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
  seedAdmins().catch(err => console.error('[seed] admin seed failed:', err.message));
});

export default app;
