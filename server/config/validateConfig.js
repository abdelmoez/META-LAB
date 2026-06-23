/**
 * config/validateConfig.js — startup configuration diagnostics (prompt49 §10).
 *
 * Pure `validateConfig()` (unit-testable) inspects the environment and returns
 * structured errors/warnings. `runStartupConfigCheck()` logs them and, in
 * PRODUCTION only, refuses to start when a critical value is missing — so a
 * misconfiguration fails loudly at boot instead of silently breaking auth/CORS.
 * NEVER logs secret VALUES (only which key is missing/insecure).
 */

/**
 * @param {{env?:NodeJS.ProcessEnv}} [opts]
 * @returns {{ok:boolean, errors:string[], warnings:string[], isProd:boolean}}
 */
export function validateConfig({ env = process.env } = {}) {
  const isProd = env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];
  const critical = (msg) => (isProd ? errors : warnings).push(msg);

  // Session signing secret — required to sign/verify JWTs.
  if (!env.JWT_SECRET || String(env.JWT_SECRET).trim().length < 16) {
    critical('JWT_SECRET is missing or too short — set a long random secret (≥16 chars).');
  } else if (/change-me|changeme|secret|password/i.test(env.JWT_SECRET) && isProd) {
    errors.push('JWT_SECRET looks like a placeholder — set a real random secret in production.');
  }

  // Primary database.
  if (!env.DATABASE_URL || !String(env.DATABASE_URL).trim()) {
    critical('DATABASE_URL is not set.');
  }

  // Database provider selection (prompt49 item 2 — PostgreSQL readiness).
  const provider = String(env.DATABASE_PROVIDER || 'sqlite').trim().toLowerCase();
  if (provider === 'postgres' || provider === 'postgresql') {
    if (!env.POSTGRES_DATABASE_URL || !String(env.POSTGRES_DATABASE_URL).trim()) {
      critical('DATABASE_PROVIDER=postgres but POSTGRES_DATABASE_URL is not set.');
    }
  } else if (provider !== 'sqlite') {
    warnings.push(`DATABASE_PROVIDER="${provider}" is not recognised — expected "sqlite" or "postgres" (defaulting to sqlite).`);
  }

  // CORS / cookies (credentialed requests need an explicit, non-wildcard origin).
  if (isProd) {
    const origin = env.CORS_ORIGIN || env.APP_BASE_URL || '';
    if (!origin) {
      errors.push('CORS_ORIGIN or APP_BASE_URL must be set in production (credentialed CORS requires an explicit origin).');
    }
    if (env.CORS_ORIGIN && env.CORS_ORIGIN.includes('*')) {
      errors.push('CORS_ORIGIN must not be a wildcard when cookies are credentialed.');
    }
    if (env.APP_BASE_URL && /^http:\/\//i.test(env.APP_BASE_URL)) {
      warnings.push('APP_BASE_URL is http:// in production — Secure cookies require https.');
    }
  }

  // Content-Security-Policy rollout mode (prompt 51). Unknown values fall back
  // to report-only, but warn so a typo (e.g. "enforced") is noticed. Production
  // must not silently DISABLE CSP — flag it as a warning so it is a deliberate,
  // visible choice rather than an accident.
  const cspRaw = String(env.CSP_MODE || '').trim().toLowerCase();
  if (cspRaw && !['disabled', 'off', 'report-only', 'reportonly', 'report', 'enforce', 'enforcing', 'on'].includes(cspRaw)) {
    warnings.push(`CSP_MODE="${env.CSP_MODE}" is not recognised — expected disabled | report-only | enforce (defaulting to report-only).`);
  }
  if (isProd && (cspRaw === 'disabled' || cspRaw === 'off')) {
    warnings.push('CSP_MODE=disabled in production — Content-Security-Policy is OFF. Set report-only or enforce.');
  }
  if (!isProd && (cspRaw === 'enforce' || cspRaw === 'enforcing' || cspRaw === 'on')) {
    warnings.push('CSP_MODE=enforce outside production — the STRICT production policy is enforced; if Node serves the Vite dev HTML, the HMR inline preamble may be blocked. Use report-only for everyday dev, or build first for a faithful enforce test.');
  }

  // Email is optional, but half-configured email silently never sends.
  const hasHost = !!(env.SMTP_HOST && String(env.SMTP_HOST).trim());
  const hasFrom = !!(env.EMAIL_FROM && String(env.EMAIL_FROM).trim());
  if (hasHost !== hasFrom) {
    warnings.push('Email is partially configured — set BOTH SMTP_HOST and EMAIL_FROM to send (or neither to disable).');
  }

  return { ok: errors.length === 0, errors, warnings, isProd };
}

/**
 * Log the diagnostics and, in production, exit(1) on any critical error.
 * Returns true when configuration is acceptable.
 */
export function runStartupConfigCheck() {
  const { ok, errors, warnings, isProd } = validateConfig();
  for (const w of warnings) console.warn('[config] WARN:', w);
  for (const e of errors) console.error('[config] ERROR:', e);
  if (!ok && isProd) {
    console.error('[config] Critical configuration missing in production — refusing to start.');
    process.exit(1);
  }
  return ok;
}
