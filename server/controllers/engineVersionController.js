/**
 * engineVersionController.js — Ops Console engine-version endpoints (54.md Part 6).
 * ADMIN ONLY (enforced by requireAdmin on every route in routes/admin.js). Engine
 * versions are an INTERNAL operational concept — they are NEVER exposed on any
 * public/user endpoint (not /api/version, /api/settings/public, or /api/health).
 *
 * Read-only: the current version + history. Version BUMPS happen through the
 * controlled CLI (scripts/engine-version.mjs) / CI, not the UI, so the deterministic
 * safeguards (idempotency, classification) stay in one place.
 *
 * Responses contain only engine ids, display names, versions, and change summaries —
 * no secret paths, credentials, stack traces, or raw infrastructure detail.
 */

import * as engineVersion from '../engineVersion/engineVersionService.js';

// ── GET /api/admin/engine-versions ───────────────────────────────────────────────
export async function adminListEngineVersions(req, res) {
  try {
    const engines = await engineVersion.listEngines();
    return res.json({ engines });
  } catch (err) {
    console.error('[engine-version] list error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/engine-versions/:id/history ───────────────────────────────────
export async function adminEngineVersionHistory(req, res) {
  try {
    const engine = await engineVersion.getEngine(req.params.id);
    if (!engine) return res.status(404).json({ error: 'Engine not found' });
    const history = await engineVersion.getHistory(req.params.id, req.query.limit);
    return res.json({ engine, history });
  } catch (err) {
    console.error('[engine-version] history error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
