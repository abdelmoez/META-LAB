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
