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
import nmaRouter         from './routes/nma.js';
import gradeRouter       from './routes/grade.js';
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
import acceptInvitationRouter from './routes/acceptInvitation.js';
import eventsRouter       from './routes/events.js';
import robRouter          from './routes/rob.js';
import onboardingRouter   from './routes/onboarding.js';
import institutionsRouter from './routes/institutions.js';
import workflowStateRouter from './routes/workflowState.js';
import searchEngineRouter  from './routes/searchEngine.js';
import pecanSearchRouter    from './routes/pecanSearch.js';
import citationMiningRouter from './routes/citationMining.js';
import extractionRouter     from './routes/extraction.js';
import extractionEngineRouter from './routes/extractionEngine.js';
import provenanceRouter     from './routes/provenance.js';
import aiExtractRouter      from './routes/aiExtract.js';
import livingReviewRouter   from './routes/livingReview.js';
import publicSynthesisRouter from './routes/publicSynthesis.js';
import publicViewRouter      from './routes/publicView.js';
import fullTextRouter        from './routes/fullText.js';
import entitlementsRouter   from './routes/entitlements.js';
import waitlistRouter       from './routes/waitlist.js';
import { waitlistCount }    from './controllers/waitlistController.js';
import citationRouter       from './routes/citation.js';

import { prisma } from './db/client.js';
import { isWaitlistDbConfigured, redactedDbTarget } from './waitlist/config.js';
import { initDefaultSettings } from './controllers/settingsController.js';
import { backfillSharedMessageReadState } from './controllers/adminController.js';
import { seedOnboardingQuestions } from './controllers/onboardingController.js';
import { backfillUserNumbers } from './services/userNumber.js';
import { backfillProjectActivity } from './store.js';
import { startImportWorker } from './services/screeningImportWorker.js';
import { startPecanSearchWorker } from './pecanSearch/pecanSearchWorker.js';
import { startCitationChaseWorker } from './citationMining/citationChaseWorker.js';
// 62.md — durable, off-event-loop workers for AI scoring + large async exports.
import { startAiJobsWorker } from './services/screeningAiJobs.js';
import { startExportWorker } from './services/screeningExportWorker.js';
import { startEligibilityJobsWorker } from './services/screeningEligibilityService.js';
// 68.md P9 — durable, off-event-loop worker for automated OA full-text retrieval.
import { startFullTextWorker } from './fullText/fullTextWorker.js';
import { applySqlitePragmas } from './db/client.js';
import { seedAdmins } from './auth/seedAdmins.js';
import { getVersion } from './version.js';
import { resolveCorsAllowlist, corsOriginDelegate } from './config/cors.js';
import { runStartupConfigCheck } from './config/validateConfig.js';
import { cspMiddleware, cspMode, cspHeaderName, CSP_REPORT_PATH } from './security/csp.js';
import { cspReportHandler } from './security/cspReport.js';
import { helmetOptions, apiNoStore, publicVersion } from './security/headers.js';
import { verifyToken } from './auth/jwt.js';
import { sessionCookieName } from './config/cookies.js';

// prompt49 — fail-fast configuration diagnostic. In production a missing critical
// value (JWT_SECRET / DATABASE_URL / CORS origin) aborts boot; in dev it warns.
runStartupConfigCheck();

const app = express();

// Fingerprinting reduction (prompt 52): Express advertises itself via
// `X-Powered-By: Express` by default. helmet already strips it; disabling it
// explicitly is belt-and-suspenders and documents the intent. The app emits no
// Server/version/runtime header — a reverse proxy's `Server:` is removed at the
// proxy (see docs/manager/http-header-hardening.md).
app.disable('x-powered-by');

const SESSION_COOKIE = sessionCookieName();

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
// helmet provides the well-tested baseline (X-Content-Type-Options: nosniff,
// Referrer-Policy, Cross-Origin-Opener/Resource-Policy, Strict-Transport-Security,
// X-Frame-Options, Origin-Agent-Cluster, …). CSP is handled by our own central
// generator instead (server/security/csp.js, prompt 51) so it can: serve the SPA
// HTML *and* the JSON API from one source of truth, attach a per-response nonce,
// set frame-ancestors/report-to, and switch report-only ↔ enforce via CSP_MODE.
// Disabling helmet's CSP here guarantees we never emit two conflicting policies.
app.use(helmet(helmetOptions()));
app.use(cspMiddleware());
// ── Embeddable public-synthesis framing (68.md P8) ─────────────────────────────
// helmet sets X-Frame-Options: DENY and cspMiddleware sets `frame-ancestors 'none'`
// on EVERY response, which is correct for the whole app EXCEPT the intentionally
// embeddable public-synthesis surface: the chrome-less SPA embed route
// (/embed/synthesis/:token) and its public JSON API (/api/public/*). For ONLY those
// paths we relax framing to allow any parent (frame-ancestors *) so a researcher can
// <iframe> their published synthesis into a blog/lab site. Runs AFTER cspMiddleware
// so it overwrites the header that middleware just set; leaves every other route's
// strict framing untouched.
app.use((req, res, next) => {
  const p = req.path || '';
  const isEmbed = p.startsWith('/embed/synthesis') || p.startsWith('/api/public/');
  if (isEmbed) {
    res.removeHeader('X-Frame-Options'); // drop helmet's DENY for this route only
    const name = cspHeaderName(cspMode());
    if (name) {
      // Rebuild a strict policy but with frame-ancestors * (embeddable). API path
      // is JSON-only so a minimal policy suffices; the SPA embed keeps default-src
      // 'self' so its own bundle still loads.
      const policy = p.startsWith('/api/')
        ? "default-src 'none'; frame-ancestors *; base-uri 'none'; form-action 'none'"
        : "default-src 'self'; frame-ancestors *; base-uri 'self'; object-src 'none'; form-action 'self'";
      res.setHeader(name, policy);
    }
  }
  next();
});
// Dynamic, often user-specific /api JSON must not be cached by shared/browser
// caches (prompt 52). Download/PDF/SSE handlers set their own Cache-Control and
// override this; static assets keep their long-lived cache headers.
app.use(apiNoStore);

// ── CSP violation reports (prompt 51) ──────────────────────────────────────────
// Mounted FIRST — before the maintenance gate, the global JSON body parser and
// every authenticated router — so browser reports always flow, carry no CSRF/auth
// assumptions, and use a tight body limit + a dedicated rate limiter. The handler
// sanitizes/redacts and logs one line; it never persists or reflects report data.
const cspReportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 120 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  // No body on rejection — a report endpoint must not become a chatty surface.
  handler: (_req, res) => res.status(429).end(),
});
const cspReportParser = express.json({
  type: ['application/csp-report', 'application/reports+json', 'application/json'],
  limit: '16kb',
});
app.post(CSP_REPORT_PATH, cspReportLimiter, (req, res, next) => {
  cspReportParser(req, res, (err) => {
    if (err) return res.status(err.type === 'entity.too.large' ? 413 : 400).end();
    return cspReportHandler(req, res);
  });
});

// ── Client error beacon (86.md P1.7) ───────────────────────────────────────────
// The SPA's installGlobalErrorHandlers() sendBeacon()s render crashes, chunk-load
// failures and unhandled rejections here. The route was missing, so every client
// crash 404'd and crash telemetry was fiction. Mounted early (before maintenance +
// the global JSON parser) with its own tight limiter + tiny body cap; log-only, it
// never persists or reflects. No auth: crashes happen pre-auth too, and the beacon
// carries only a correlation id + a truncated message (never a stack).
const clientErrorLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 120 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).end(),
});
const clientErrorParser = express.json({ type: ['application/json', 'text/plain'], limit: '8kb' });
app.post('/api/client-errors', clientErrorLimiter, (req, res) => {
  clientErrorParser(req, res, (err) => {
    if (err) return res.status(err.type === 'entity.too.large' ? 413 : 400).end();
    try {
      const e = req.body && typeof req.body === 'object' ? req.body : {};
      const s = (v, n) => (v == null ? '' : String(v).replace(/[\r\n\t]+/g, ' ').slice(0, n));
      console.warn('[client-error]', JSON.stringify({
        correlationId: s(e.correlationId, 64),
        name: s(e.name, 80),
        message: s(e.message, 300),
        route: s(e.route, 200),
        engine: s(e.engine, 60),
        release: s(e.release, 60),
        browser: s(e.browser, 120),
      }));
    } catch { /* never throw from the telemetry sink */ }
    return res.status(204).end();
  });
});

// ── Rate limiter for auth routes (20 req / 15 min in production; relaxed in dev/test) ──
// Dev cap sized for the FULL vitest suite: 3k+ tests register/login hundreds of
// throwaway users per run, and back-to-back runs share one 15-min window — at
// 1000 the tail-end integration files were 429ed (registrations fail → the
// follow-up logins 401), which read as flaky tests (65.md QA).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 5000,
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

// ── Rate limiter for the Search Engine (prompt: SearchEngine) — mesh/count fire
// on debounced typing and proxy NLM with the server-side key, so cap per IP. ─────
const searchEngineLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 600 : 2000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Rate limiter for the Pecan Search Engine (P1) — translate/preview-count fire
// on debounced typing and proxy external providers with server-side keys; run
// start/cancel/retry mutate durable jobs. Cap per IP (a bit tighter than the
// search-builder budget since previews fan out across multiple providers). ──────
const pecanSearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 400 : 2000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Rate limiter for the Pecan Extraction Engine (76.md) — article-list reads +
// completion/reopen/lock/inclusion mutations. Generous (these are per-article user
// clicks, not fan-out), prod-tight/dev-loose like the rest. ──────────────────────
const extractionEngineLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 900 : 4000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Rate limiter for the PUBLIC Beta Waitlist form (prompt48) — unauthenticated
// submit + resend per IP. Tight in production (spam/abuse protection); relaxed in
// dev/test so the integration suite can iterate. Per-email resend bursts +
// cooldown are additionally enforced in the waitlist service. ────────────────────
const waitlistLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 1000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// The public landing-page signup count (GET /api/waitlist/count) is a harmless
// read that fires on every page load, so it gets its OWN generous limiter rather
// than competing with the strict submit budget above. (Failure simply hides the
// count card — never an error to the visitor.)
const waitlistReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 240 : 2000,
  message: { count: null },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Rate limiter for PUBLIC synthesis reads (68.md P8) — unauthenticated payload
// /export /qr reads per IP. A shared page can be embedded and hit by many anonymous
// visitors, so the budget is generous (120 req / 15 min in prod) but bounded to
// blunt scraping/DoS. Relaxed in dev/test for the integration suite. ─────────────
const publicSynthesisLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 120 : 2000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Core middleware ────────────────────────────────────────────────────────────
// CORS is an EXPLICIT, env-driven allowlist (CORS_ORIGIN — one origin or a
// comma-separated list for apex + www + a deliberate preview origin — unioned
// with APP_BASE_URL), falling back to the local Vite dev server. credentials:true
// is required so the httpOnly session cookie is sent on cross-origin requests;
// the delegate therefore echoes only allowlisted origins and NEVER a wildcard.
const CORS_ALLOWLIST = resolveCorsAllowlist();
console.log(`[cors] allowlist: ${CORS_ALLOWLIST.join(', ')}`);
app.use(cors({ origin: corsOriginDelegate(), credentials: true }));
// prompt50 WS2 — screening reference imports may carry tens of thousands of
// citations in one JSON payload, so the import endpoints get a much larger body
// budget than the 10MB default that protects every other route from oversized
// bodies. Matched on the path suffix (/import and /import/start).
const jsonStandard    = express.json({ limit: '10mb' });
const jsonLargeImport = express.json({ limit: '64mb' });
// AI extraction accepts a base64 PDF: the DECODED cap is 20MB (413 enforced in
// the controller), so the wire budget must cover base64 inflation (~27MB) plus
// the JSON envelope. Everything else keeps the 10MB default.
const jsonAiExtract   = express.json({ limit: '32mb' });
app.use((req, res, next) => {
  // 86.md P1.8 — the 64MB budget is ONLY for the authenticated screening import
  // routes. The old suffix-only regex matched ANY path ending in `/import`
  // (e.g. an unauthenticated POST /x/import), letting anonymous clients stream a
  // 64MB JSON body into JSON.parse before auth/rate-limit/maintenance ran — a
  // memory/CPU DoS. Scope it to the exact known routes; everything else keeps 10MB.
  const isScreeningImport = req.path.startsWith('/api/screening/') && /\/import(\/start)?$/.test(req.path);
  const parser = isScreeningImport ? jsonLargeImport
    : req.path === '/api/ai-extract' ? jsonAiExtract
    : jsonStandard;
  return parser(req, res, next);
});
app.use(cookieParser());
app.use(requestLogger);

// ── Maintenance mode gate (prompt9) ───────────────────────────────────────────
// AFTER cookieParser (needs the session cookie for the staff bypass), BEFORE
// every API router. Exempts /api/health, /api/version, /api/settings/public,
// /api/auth/*, /api/admin/*, /api/events; admin|mod sessions pass; everyone
// else gets 503 { error: <maintenanceMessage>, maintenance: true } while
// appSettings.maintenanceMode === true. 10s-TTL settings cache; default off.
app.use(maintenanceGate);

// ── Health check (public, liveness) ────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: getVersion().version });
});

// ── Readiness check (public, prompt49 §11) — verifies critical dependencies (DB)
// so a load balancer / post-deploy smoke test can gate traffic. 503 when not
// ready. Exposes NO secrets / connection strings / stack traces. ────────────────
app.get('/api/health/ready', async (_req, res) => {
  const checks = {};
  let ready = true;
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
    ready = false;
  }
  // Public readiness probe: a load balancer only needs the 200/503 + the coarse
  // check map. The environment name and DB latency are fingerprinting/infra detail
  // (prompt 52) — kept out of the public body (still in server logs / admin health).
  void t0;
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'unavailable',
    checks,
    version: getVersion().version,
    timestamp: new Date().toISOString(),
  });
});

// ── Version metadata ───────────────────────────────────────────────────────────
// The product version is intentionally public (shown in the UI). Build metadata
// (commit hash, commit/build dates) is fingerprinting (prompt 52) — it is only
// returned to an authenticated caller (the UI footer/Ops Console fetch it with
// credentials). A valid, unexpired session token is sufficient gating here.
app.get('/api/version', (req, res) => {
  const full = getVersion();
  let authed = false;
  try {
    const tok = req.cookies && req.cookies[SESSION_COOKIE];
    if (tok) { verifyToken(tok); authed = true; }
  } catch { authed = false; }
  return res.json(authed ? full : publicVersion(full));
});

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
app.use('/api/nma',                  nmaRouter);
// ── P12 GRADE certainty + Summary of Findings (grade.md). requireAuth at the mount;
// each handler additionally gates on the `gradeCertainty` flag (default OFF → 404)
// and enforces project permission. The pure engine loads lazily → 503 if absent.
app.use('/api/grade',                requireAuth, gradeRouter);
app.use('/api/validation',           validationRouter);
// Bell polling endpoint — own mount, NEVER under the rate-limited /api/auth
// or /api/admin routers (requireAuth applied inside the router).
app.use('/api/notifications',        notificationsRouter);

// ── Public invite endpoints (prompt9) — token landing + accept. Own mount with
// a dedicated limiter. MUST be mounted BEFORE the bare '/api' importExport
// router below: that router applies requireAuth at router level and would 401
// every unauthenticated /api/* request, killing the pre-auth invite landing.
app.use('/api/invites', inviteLimiter, invitesRouter);

// ── Public waitlist → account invitation acceptance (80.md) — token landing +
// password-set/account-create. Own mount, reusing the invite limiter; MUST be
// BEFORE the bare '/api' importExport router (which applies requireAuth and would
// 401 the pre-auth acceptance page). The URL token is the only credential.
app.use('/api/accept-invitation', inviteLimiter, acceptInvitationRouter);

// ── Public Beta Waitlist (prompt48) — unauthenticated submit/resend. Own mount
// with a dedicated limiter; MUST be BEFORE the bare '/api' importExport router
// (which applies requireAuth at router level and would 401 the public form).
// Writes ONLY to the strictly-separate waitlist DB — never the user database.
// The public signup-count GET is registered FIRST with its own lenient limiter so
// a normal page load never spends the strict submit budget (Express matches this
// exact route before falling through to the strict-limited router below).
app.get('/api/waitlist/count', waitlistReadLimiter, waitlistCount);
app.use('/api/waitlist', waitlistLimiter, waitlistRouter);

// ── Public Synthesis public reads (68.md P8) — NO requireAuth (a shared token is
// the only credential), a dedicated per-IP limiter, and the embed-framing exemption
// applied above. Serves ONLY the frozen, pre-sanitized published payload; unknown or
// unpublished tokens return a clean 404. MUST be mounted BEFORE the bare '/api'
// importExport router below, which applies requireAuth at router level and would
// otherwise 401 every unauthenticated public read (same reason as invites/waitlist).
app.use('/api/public', publicSynthesisLimiter, publicViewRouter);

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

// ── Citation metadata proxy (prompt 51 review fix) — same-origin pass-through to
// CrossRef / NCBI for the DOI/PMID "Add Study" auto-fill, so the strict
// `connect-src 'self'` CSP need not whitelist those external origins. requireAuth
// (never an open relay) + a dedicated limiter (typeahead-ish, but bounded).
const citationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 120 : 1000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/citation', requireAuth, citationLimiter, citationRouter);

// ── Realtime SSE stream (prompt6 Task 7) — own mount, NEVER under the
// rate-limited /api/auth or /api/admin routers (requireAuth inside the router).
app.use('/api/events', eventsRouter);

// ── Server-backed per-module workflow state (prompt38) — requireAuth at the
// mount; each handler additionally gates on the serverBackedWorkflowState flag
// (default OFF → 404) and the caller's META·LAB project access. :projectId is the
// META·LAB Project id (the "review workspace").
app.use('/api/workspaces', requireAuth, workflowStateRouter);

// ── Separated Search Engine (BACKEND_CONTRACT.md) — requireAuth + dedicated
// limiter at the mount; each handler gates on the `searchEngine` flag (default
// OFF → 404). NLM proxies (mesh/count) keep the NCBI key server-side; per-project
// load/save reuse the per-module workflow-state infra (moduleKey 'search').
app.use('/api/search-builder', requireAuth, searchEngineLimiter, searchEngineRouter);

// ── Pecan Search Engine (P1) — automated literature search, auto-import, dedup,
// provenance, PRISMA-S. requireAuth + a dedicated limiter at the mount; each
// handler gates on the `pecanSearch` flag (default OFF → 404) and the caller's
// META·LAB project access. External provider calls + API keys stay server-side.
app.use('/api/pecan-search', requireAuth, pecanSearchLimiter, pecanSearchRouter);

// ── Bibliomine citation mining (P15) — requireAuth at the mount; each handler
// gates on the `citationMining` flag (default OFF → 404) and the caller's META·LAB
// project access. Uploads carry client-extracted TEXT only; external resolution +
// citation chasing reuse the Pecan connectors (server-side, bounded, cancellable).
app.use('/api/citation-mining', requireAuth, pecanSearchLimiter, citationMiningRouter);

// ── Structured Data Extraction (66.md P5) — requireAuth at the mount; each
// handler gates on the `extractionAssist` flag (default OFF → 404) and the
// caller's META·LAB project access. AI suggestions never auto-commit.
app.use('/api/extraction', requireAuth, extractionRouter);

// ── Pecan Extraction Engine (76.md) — requireAuth at the mount; each handler gates
// on the `extractionEngine` flag (default OFF → 404) + META·LAB project access. Owns
// article STATE only (list / complete / reopen / lock / inclusion / audit); extraction
// VALUES stay on the project-blob autosave, so this never races value writes.
app.use('/api/extraction-engine', requireAuth, extractionEngineLimiter, extractionEngineRouter);

// ── Research Provenance ledger (88.md) — requireAuth at the mount; each handler
// gates on the `researchProvenance` flag (default OFF → 404) + project access. The
// append-only Project History across search/screening/extraction/RoB/analysis/
// manuscript. Reads are membership-scoped; reason/invalidate are leadership-scoped.
app.use('/api/provenance', requireAuth, provenanceRouter);

// ── AI extraction (server-proxied LLM) — requireAuth at the mount; the POST
// handler gates on the `aiExtraction` flag (default OFF → 404). The Anthropic
// key stays server-side (the browser never calls api.anthropic.com — CSP
// connect-src 'self' stands); results are a validated patch flagged
// needsReview. This is the ONE real model call in the app.
app.use('/api/ai-extract', requireAuth, aiExtractRouter);

// ── Living Reviews (66.md P6) — requireAuth at the mount; each handler gates on
// the `livingReview` flag (default OFF → 404) and project access. Scheduled
// re-runs go through the existing Pecan Search engine + durable worker.
app.use('/api/living', requireAuth, livingReviewRouter);

// ── Public Synthesis authoring (68.md P8) — requireAuth at the mount; each handler
// gates on the `publicSynthesis` flag (default OFF → 404) + project access. This is
// the AUTHENTICATED side (publish/settings/preview/dashboard). The public read side
// is mounted separately below WITHOUT auth.
app.use('/api/synthesis', requireAuth, publicSynthesisRouter);

// ── Automated OA full-text retrieval (68.md P9) — requireAuth at the mount; each
// handler gates on the `fullTextRetrieval` flag (default OFF → 404) and screening
// project access. Only legal open-access PDFs (Unpaywall / Europe PMC / OpenAlex)
// are fetched; the durable worker runs off the request thread.
app.use('/api/full-text', requireAuth, fullTextRouter);

// ── Product-tier entitlements (67.md) — the signed-in user's resolved plan.
// Own mount (never under the rate-limited /api/auth); enforcement itself lives
// in each endpoint via entitlementService.require*.
app.use('/api/entitlements', requireAuth, entitlementsRouter);

// ── SPA serving with server-injected theme (prompt37 follow-up) ────────────────
// When a production build exists (or SERVE_SPA=true), serve dist/ assets and the
// index.html with the live brand palette injected pre-paint, so the admin's
// chosen color is correct on the very first paint for first-time visitors too.
// Mounted AFTER every /api route so matched API routes always win; serveSpa
// skips /api/* (those fall through to the JSON 404 below).
if (spaEnabled()) {
  app.use(express.static(distDir, {
    index: false,
    maxAge: '1h',
    // prompt41 Task 2 (defense-in-depth) — ensure ES-module assets (e.g. a pdf.js
    // worker emitted as .mjs) are served with a JavaScript MIME type, so the browser
    // will instantiate them as module workers/scripts. `send`'s default mime db may
    // otherwise label .mjs as application/octet-stream and the worker fails to load.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    },
  }));
  app.use(serveSpa);
}

// ── 404 fallback ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(errorHandler);

// ── Fail-safe process guards ─────────────────────────────────────────────────
// Node 20 terminates the process on an unhandled promise rejection by default. A
// single stray rejection escaping an async route handler or a background worker
// must NEVER take the whole API down. Log it server-side (never to a client) and
// keep serving — matching the app's "isolate the failure, keep the process alive"
// posture (per-search isolation in the living scheduler, best-effort notifications,
// etc.). Uncaught synchronous exceptions are logged for the same reason; we
// deliberately do not exit here.
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason instanceof Error ? (reason.stack || reason.message) : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err?.stack || err?.message || err);
});

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  const { version, commit } = getVersion();
  console.log(`PecanRev API on :${PORT} (v${version} · ${commit})`);
  console.log(`[csp] mode=${cspMode()} (CSP_MODE; disabled|report-only|enforce) → reports at ${CSP_REPORT_PATH}`);
  // Initialize default settings + ensure admin accounts exist (non-blocking)
  initDefaultSettings().catch(console.error);
  seedOnboardingQuestions().catch(err => console.error('[seed] onboarding seed failed:', err.message));
  seedAdmins().catch(err => console.error('[seed] admin seed failed:', err.message));
  // prompt49 — one-time idempotent backfill so any message a staff member already
  // read becomes globally read under the new shared read-state model.
  backfillSharedMessageReadState().catch(err => console.error('[seed] message read backfill failed:', err.message));
  // prompt49 item 8 — assign the immutable numeric userNumber to any user created
  // before the column existed (idempotent; a no-op once everyone is numbered).
  backfillUserNumbers().catch(err => console.error('[seed] userNumber backfill failed:', err.message));
  // prompt50 WS5 — seed Project.lastActivityAt (the authoritative "Last Modified"
  // timestamp) for any legacy/`db push` row where it is still NULL, so project
  // sorting is correct from the first request. Idempotent; a no-op once seeded.
  backfillProjectActivity()
    .then(n => { if (n) console.log(`[seed] backfilled lastActivityAt on ${n} project(s)`); })
    .catch(err => console.error('[seed] project activity backfill failed:', err.message));
  // Reliability: switch the main SQLite DB to WAL + busy_timeout BEFORE the durable
  // workers begin writing, so an in-progress write can never block reads into a
  // timeout (the prod.db "failed to respond within the timeout" errors). No-op
  // under Postgres; never blocks boot (fail-safe). Workers start once it settles.
  applySqlitePragmas()
    .catch(err => console.error('[db] SQLite pragma init failed:', err?.message || err))
    .finally(() => {
      // prompt50 WS2 — start the durable screening-import worker. Re-queues any job
      // a crash left mid-flight, then drains the queue off the request thread.
      startImportWorker().catch(err => console.error('[import-worker] start failed:', err.message));
      // p1.md — start the durable Pecan Search Engine worker. Re-queues any search
      // job a crash left mid-flight (resumes from each source's cursor), then drains.
      startPecanSearchWorker().catch(err => console.error('[pecan-search-worker] start failed:', err.message));
      // P15 — start the durable citation-chase worker. Re-queues any chase job a
      // crash left mid-flight (under the retry cap), then drains off the request thread.
      startCitationChaseWorker().catch(err => console.error('[citation-chase-worker] start failed:', err.message));
      // 62.md — start the durable AI-scoring worker (manual runs + decision rescores run
      // here, off the request thread, with crash recovery) and the async export worker
      // (large exports stream to a file instead of buffering in one request → no 504).
      startAiJobsWorker().catch(err => console.error('[ai-worker] start failed:', err.message));
      startExportWorker().catch(err => console.error('[export-worker] start failed:', err.message));
      // 70.md P10 — start the durable Eligibility-Screener bulk-eval worker (crash
      // recovery of stuck jobs, then drains criteria evaluations off the request thread).
      startEligibilityJobsWorker().catch(err => console.error('[eligibility-worker] start failed:', err.message));
      // 68.md P9 — start the durable full-text retrieval worker. Re-queues any job
      // a crash left mid-flight (under the retry cap), then drains off the request
      // thread. No-op unless the fullTextRetrieval flag + admin setting allow it.
      startFullTextWorker().catch(err => console.error('[fulltext-worker] start failed:', err.message));
      // 66.md P6 — living-review scheduler: launches due saved searches through the
      // Pecan worker and reconciles finished update runs (notifications, AI
      // pre-scoring, automatic snapshots). No-ops unless the livingReview flag +
      // admin setting allow it; interval is unref'd.
      import('./living/scheduler.js')
        .then(m => m.startLivingScheduler())
        .catch(err => console.error('[living-scheduler] start failed:', err.message));
      // 67.md — seed the default product-tier rows (create-if-missing; admin
      // edits are never overwritten). Idempotent. 72.md — then backfill an initial
      // tier-assignment history row for any user that has none (concrete User.tierId
      // + one 'backfill' row). Both idempotent; a no-op once seeded/backfilled.
      import('./services/entitlementService.js')
        .then(async (m) => {
          await m.seedProductTiers();
          const n = await m.backfillUserTiers();
          if (n) console.log(`[tiers] backfilled initial tier assignment for ${n} user(s)`);
        })
        .catch(err => console.error('[tiers] seed/backfill failed:', err.message));
    });

  // prompt48 — fail-safe waitlist config check. If the betaWaitlist flag is ON but
  // the dedicated DB is not configured, log a CLEAR, REDACTED warning for admins.
  // This is non-fatal: submissions already fail safe (503) at request time and
  // NEVER fall back to the main user database. The flag lives in the main DB's
  // featureFlags SiteSetting (read here, in the orchestrator, not in waitlist code
  // — that keeps the waitlist module's isolation boundary intact).
  (async () => {
    try {
      const { prisma } = await import('./db/client.js');
      const row = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
      let flags = {};
      try { flags = JSON.parse(row?.value || '{}'); } catch { flags = {}; }
      if (flags.betaWaitlist && !isWaitlistDbConfigured()) {
        console.warn('[waitlist] WARNING: betaWaitlist is ENABLED but no waitlist DB URL is set ' +
          '(BETA_WAITLIST_DATABASE_URL, or the POSTGRES_WAITLIST_DATABASE_URL fallback). ' +
          'The page will load, but submissions fail safe (503) and NEVER write to the user database. ' +
          'Fix: set BETA_WAITLIST_DATABASE_URL, then `cd server && npm run db:ensure:waitlist` (or redeploy — postinstall runs it).');
      } else if (isWaitlistDbConfigured()) {
        console.log(`[waitlist] dedicated DB configured (${redactedDbTarget()}).`);
      }
    } catch { /* non-fatal */ }
  })();
});

// 62.md — defense-in-depth HTTP timeouts. The real fix for the scoring/export freeze is
// to stop blocking the event loop (durable workers + worker_thread compute above); these
// timeouts just ensure a genuinely slow request fails CLEANLY instead of hanging until a
// silent upstream 504. Set requestTimeout ≥ the reverse-proxy timeout (REQUEST_TIMEOUT_MS,
// default 120s) and keepAliveTimeout below it. Heavy work no longer rides a long request,
// so this should rarely trigger.
server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS) || 120000;
server.headersTimeout = (Number(process.env.REQUEST_TIMEOUT_MS) || 120000) + 5000;
server.keepAliveTimeout = Number(process.env.KEEPALIVE_TIMEOUT_MS) || 75000;

export default app;
