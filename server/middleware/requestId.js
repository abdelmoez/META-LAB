/**
 * requestId.js — per-request correlation id (93.md §4.11).
 *
 * Assigns a request id to every request so errors, audit events and user
 * reports can be traced through the logs safely:
 *   - honours an inbound `X-Request-Id` from the reverse proxy when it looks
 *     sane (proxies like nginx `$request_id` send a 32-hex value), so one id
 *     spans proxy access log → app log → error response;
 *   - otherwise mints a UUID;
 *   - echoes the id back in the `X-Request-Id` response header so a beta
 *     tester can read it from devtools and quote it in a bug report.
 *
 * The id is random and carries no user data — safe to expose to the client
 * and safe to log. Mounted FIRST so every later middleware (requestLogger,
 * errorHandler, audit sinks) can rely on `req.id`.
 */
import crypto from 'node:crypto';

// Proxy-supplied ids must be short, simple tokens — never trust arbitrary
// header bytes into logs (log-injection resistance).
const INBOUND_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function requestId(req, res, next) {
  const inbound = req.headers['x-request-id'];
  const id = (typeof inbound === 'string' && INBOUND_ID_RE.test(inbound))
    ? inbound
    : crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
