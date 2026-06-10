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

import authRouter        from './routes/auth.js';
import projectsRouter    from './routes/projects.js';
import studiesRouter     from './routes/studies.js';
import recordsRouter     from './routes/records.js';
import metaRouter        from './routes/meta.js';
import validationRouter  from './routes/validation.js';
import importExportRouter from './routes/importExport.js';
import profileRouter     from './routes/profile.js';
import contactRouter     from './routes/contact.js';
import settingsRouter    from './routes/settings.js';
import adminRouter       from './routes/admin.js';
import screeningRouter    from './routes/screening.js';

import { initDefaultSettings } from './controllers/settingsController.js';
import { seedAdmins } from './auth/seedAdmins.js';
import { getVersion } from './version.js';

const app = express();

// ── Security headers ───────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ── Rate limiter for auth routes (20 req / 15 min in production; relaxed in dev/test) ──
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 1000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Core middleware ────────────────────────────────────────────────────────────
// CORS origin is env-driven for deployment (CORS_ORIGIN, then APP_BASE_URL),
// falling back to the local Vite dev server. credentials:true is required so the
// httpOnly session cookie is sent on cross-origin requests.
const ORIGIN = process.env.CORS_ORIGIN || process.env.APP_BASE_URL || 'http://localhost:3000';
app.use(cors({ origin: ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(requestLogger);

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
app.use('/api/contact',              contactRouter);
app.use('/api/projects',             projectsRouter);
app.use('/api/projects/:id/studies', studiesRouter);
app.use('/api/projects/:id/records', recordsRouter);
app.use('/api/meta',                 metaRouter);
app.use('/api/validation',           validationRouter);
app.use('/api',                      importExportRouter);  // /api/import/... and /api/export/...

// ── Admin routes (requireAuth + requireAdmin applied inside admin router) ──────
app.use('/api/admin', requireAuth, adminRouter);

// ── META·SIFT Beta screening routes (requireAuth applied inside router) ────────
app.use('/api/screening', screeningRouter);

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
