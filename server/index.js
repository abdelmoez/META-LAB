/**
 * server/index.js
 * META·LAB API server — Express entry point, port 3001.
 */

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler }  from './middleware/errorHandler.js';

import authRouter        from './routes/auth.js';
import projectsRouter    from './routes/projects.js';
import studiesRouter     from './routes/studies.js';
import recordsRouter     from './routes/records.js';
import metaRouter        from './routes/meta.js';
import validationRouter  from './routes/validation.js';
import importExportRouter from './routes/importExport.js';
import profileRouter     from './routes/profile.js';
import contactRouter     from './routes/contact.js';

const app = express();

// ── Security headers ───────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ── Rate limiter for auth routes (20 req / 15 min per IP) ─────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Core middleware ────────────────────────────────────────────────────────────
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(requestLogger);

// ── Health check (public) ─────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' });
});

// ── Auth routes (public: register/login; protected: logout/me) ────────────────
app.use('/api/auth', authLimiter, authRouter);

// ── Protected route mounting ───────────────────────────────────────────────────
app.use('/api/profile',              profileRouter);
app.use('/api/contact',              contactRouter);
app.use('/api/projects',             projectsRouter);
app.use('/api/projects/:id/studies', studiesRouter);
app.use('/api/projects/:id/records', recordsRouter);
app.use('/api/meta',                 metaRouter);
app.use('/api/validation',           validationRouter);
app.use('/api',                      importExportRouter);  // /api/import/... and /api/export/...

// ── 404 fallback ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(errorHandler);

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`META·LAB API on :${PORT}`);
});

export default app;
