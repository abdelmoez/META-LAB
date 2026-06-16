/**
 * server/config/cors.js
 *
 * Single source of truth for the CORS allowed origin. Extracted from
 * server/index.js (roadmap 0.3) so the env-driven resolution is unit-testable
 * without booting the Express server.
 *
 * Precedence: CORS_ORIGIN  →  APP_BASE_URL  →  local Vite dev server.
 * Never hard-code a production host here; deployment sets CORS_ORIGIN.
 */
export function resolveCorsOrigin(env = process.env) {
  return env.CORS_ORIGIN || env.APP_BASE_URL || 'http://localhost:3000';
}
