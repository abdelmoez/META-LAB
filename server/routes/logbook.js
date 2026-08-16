/**
 * routes/logbook.js — 119.md §8. The project Logbook API, mounted at
 * /api/logbook with requireAuth at the mount point (server/index.js).
 *
 * ROUTE GUARD (one of §8's seven enforcement layers): `requireProjectLeader`
 * runs BEFORE any handler on this router. It re-resolves the caller's project
 * leadership and rejects members/contributors/viewers with 403 (and strangers
 * with 404) so a hand-typed URL never reaches a query — even if a future
 * handler were added here and forgot its own check. The handlers still resolve
 * access themselves (defence in depth + they need the scope + they log the
 * denial); this guard is the belt to that pair of braces.
 *
 * There are NO write endpoints. The Logbook is append-only and is written ONLY
 * by server/logbook/logbookService.js from inside the engines that act; nothing
 * over HTTP can edit or delete an event (§8 "Audit events must not be editable
 * or casually deletable").
 */
import { Router } from 'express';
import { resolveLogbookAccess } from '../logbook/logbookAccess.js';
import * as LB from '../controllers/logbookController.js';

const router = Router();

/** Owner/Leader-only route guard for every /projects/:pid/* path on this router. */
export async function requireProjectLeader(req, res, next) {
  try {
    const gate = await resolveLogbookAccess(req.params.pid, req.user);
    if (!gate.ok) {
      // §8 "Logbook security → Failed unauthorized attempts where appropriate":
      // the guard, not the handler, is where a hand-typed URL actually stops, so
      // the denied attempt is recorded HERE (best-effort; never blocks the 403).
      const surface = req.path.endsWith('/export') ? 'export' : (req.path.endsWith('/facets') ? 'facets' : 'view');
      await LB.logDenied(req, gate, surface);
      return res.status(gate.status).json({ error: gate.error });
    }
    // Hand the resolved gate down so handlers can reuse it without a second
    // round-trip; they still re-resolve if it is absent (direct unit calls).
    req.logbookGate = gate;
    return next();
  } catch (err) {
    console.error('[logbook] route guard:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

router.get('/projects/:pid/events', requireProjectLeader, LB.getLogbookEvents);
router.get('/projects/:pid/facets', requireProjectLeader, LB.getLogbookFacets);
router.get('/projects/:pid/export', requireProjectLeader, LB.exportLogbook);

export default router;
