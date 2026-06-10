/**
 * routes/events.js — GET /api/events: the single SSE stream per browser tab
 * (prompt6 Task 7 — see docs/manager/realtime-architecture.md).
 *
 * Mounted at /api/events on its OWN router behind requireAuth ONLY — NEVER
 * under the rate-limited /api/auth or /api/admin mounts (a reconnecting
 * EventSource would burn through those limiters).
 *
 * The stream is identity-only (userId from the session cookie); authorization
 * always happens at refetch time through the existing endpoints. Events are
 * thin pokes — no content ever travels on this channel.
 *
 * No compression middleware exists in this server (verified), so res.write
 * frames flush immediately. A comment heartbeat (":hb") every ~25s keeps
 * proxies/sockets alive and lets dead clients be detected via 'close'.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { register, unregister } from '../realtime/bus.js';

const HEARTBEAT_MS = 25000;

const router = Router();

router.get('/', requireAuth, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: disable proxy buffering for this response
  });
  res.flushHeaders();

  // Reconnect hint for the browser's native EventSource retry, then an opening
  // comment so the client sees bytes immediately.
  res.write('retry: 5000\n\n');
  res.write(':connected\n\n');

  register(req.user.id, res);

  const heartbeat = setInterval(() => {
    try { res.write(':hb\n\n'); } catch { /* dead socket — 'close' cleans up */ }
  }, HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    unregister(req.user.id, res);
  });
});

export default router;
