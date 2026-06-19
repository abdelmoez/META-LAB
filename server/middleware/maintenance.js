/**
 * server/middleware/maintenance.js — app-level maintenance mode (prompt9).
 *
 * When appSettings.maintenanceMode === true, every /api request 503s with the
 * configurable maintenance message EXCEPT:
 *   - the public plumbing the maintenance UX itself needs:
 *     /api/health, /api/version, /api/settings/public, /api/auth/*, /api/events
 *   - the entire admin console (/api/admin/*) so staff can turn it back off
 *   - any request carrying a valid admin|mod session JWT (staff bypass)
 *
 * The appSettings read is cached with a ~10s TTL so the gate adds no per-
 * request DB cost while disabled; updateAdminSettings busts the cache so a
 * toggle takes effect immediately. Default false = zero behavior change.
 * The gate itself NEVER throws — any internal failure fails open (next()).
 */
import { prisma } from '../db/client.js';
import { verifyToken } from '../auth/jwt.js';

const COOKIE_NAME = 'metalab_session';
const CACHE_TTL_MS = 10 * 1000;
const FALLBACK_MESSAGE = 'META·LAB is temporarily down for maintenance. Please check back soon.';

let cache = { at: 0, settings: null };

/** Force the next request to re-read appSettings (called on settings writes). */
export function bustMaintenanceCache() {
  cache = { at: 0, settings: null };
}

async function getAppSettingsCached() {
  const now = Date.now();
  if (cache.settings && now - cache.at < CACHE_TTL_MS) return cache.settings;
  let settings = {};
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'appSettings' } });
    settings = row ? JSON.parse(row.value || '{}') : {};
  } catch {
    settings = {};
  }
  cache = { at: now, settings };
  return settings;
}

function isExempt(path) {
  return (
    path === '/api/health' ||
    path === '/api/version' ||
    path === '/api/settings/public' ||
    path === '/api/settings/theme' ||
    path.startsWith('/api/auth') ||
    path.startsWith('/api/admin') ||
    path.startsWith('/api/events')
  );
}

export async function maintenanceGate(req, res, next) {
  try {
    if (!req.path.startsWith('/api')) return next();

    const settings = await getAppSettingsCached();
    if (settings.maintenanceMode !== true) return next();
    if (isExempt(req.path)) return next();

    // Staff bypass — verify the session JWT quickly (no DB hit; the role in
    // the signed token is sufficient for a maintenance gate, and every admin
    // route still DB-verifies the role per request).
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      try {
        const payload = verifyToken(token);
        if (payload.role === 'admin' || payload.role === 'mod') return next();
      } catch { /* invalid/expired token → treated as plain visitor */ }
    }

    const message =
      typeof settings.maintenanceMessage === 'string' && settings.maintenanceMessage.trim()
        ? settings.maintenanceMessage.trim()
        : FALLBACK_MESSAGE;
    return res.status(503).json({ error: message, maintenance: true });
  } catch {
    // The gate must never take the API down on its own — fail open.
    return next();
  }
}
