/**
 * engineVersion/engineVersionService.js — DB-backed live state for the internal
 * engine-version registry (54.md Part 4/7). The canonical engine CATALOG (ids,
 * names, ownership) lives in code at src/research-engine/engine-registry; THIS
 * module owns the live version state + append-only history in the MAIN database.
 *
 * Architecture decision (documented in docs/manager/engine-versions.md):
 *   - Catalog in code  → code-reviewed, merge-conflict-safe, deterministic; a
 *     rename never orphans history because the stable `id` is the key.
 *   - Versions in DB   → atomic increments + history in a transaction, auditable,
 *     no production drift, no merge conflicts on a shared config file.
 *
 * Idempotency + concurrency: every applied change is keyed by (changeKey, engineId)
 * via the ProcessedEngineChange unique constraint, so re-running a bump for the
 * same commit/manifest is a no-op (CI retries, deploy retries, rebases, multiple
 * instances). The version increment + history row + processed-change row are
 * written in ONE transaction.
 *
 * NOTHING here is exposed to ordinary users — only the admin-gated Ops endpoints
 * (engineVersionController) read it.
 */

import { prisma } from '../db/client.js';
import {
  ENGINES, ENGINE_BY_ID, isEngineId, INITIAL_VERSION,
  bumpVersion, formatVersion, isValidChangeType,
} from '../../src/research-engine/engine-registry/index.js';

const MAX_SUMMARY = 280;

/**
 * True when an error is "the engine-version tables don't exist / are out of date"
 * — i.e. the MAIN database hasn't had `prisma db push` run after deploying the
 * 54.md engine-registry migration. On a fresh/under-migrated deployment the READ
 * paths must degrade to the in-code catalog (every engine at its initial version)
 * instead of 500-ing the whole Ops console. Write paths still surface real errors.
 *   P2021 — table does not exist   ·   P2022 — column does not exist
 */
function isMissingSchemaError(err) {
  if (!err) return false;
  if (err.code === 'P2021' || err.code === 'P2022') return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('no such table') || msg.includes('no such column');
}

/** Shape a DB registry row (or a catalog fallback) into the Ops view object. */
function toView(engineId, row) {
  const cat = ENGINE_BY_ID[engineId] || {};
  const major = row ? row.major : INITIAL_VERSION.major;
  const minor = row ? row.minor : INITIAL_VERSION.minor;
  return {
    id: engineId,
    displayName: (row && row.displayName) || cat.displayName || engineId,
    description: (row && row.description) || cat.description || '',
    status: (row && row.status) || cat.status || 'active',
    major,
    minor,
    version: formatVersion({ major, minor }),
    lastChangeType: row ? row.lastChangeType : null,
    lastChangeSummary: row ? row.lastChangeSummary : null,
    updatedAt: row ? row.updatedAt : null,
    seeded: !!row,
  };
}

/**
 * Idempotently seed every catalog engine at v0.1. On CREATE: initial version +
 * metadata. On UPDATE: refresh displayName/description/status from the catalog
 * (source of truth for those) but NEVER touch major/minor/lastChange* — so
 * re-seeding after a rename keeps the version history intact.
 */
export async function seedEngines() {
  const results = [];
  for (const e of ENGINES) {
    const existing = await prisma.engineRegistry.findUnique({ where: { id: e.id } });
    const row = await prisma.engineRegistry.upsert({
      where: { id: e.id },
      update: { displayName: e.displayName, description: e.description || null, status: e.status || 'active' },
      create: {
        id: e.id,
        displayName: e.displayName,
        description: e.description || null,
        status: e.status || 'active',
        major: INITIAL_VERSION.major,
        minor: INITIAL_VERSION.minor,
      },
    });
    results.push({ id: e.id, created: !existing, version: formatVersion(row) });
  }
  return { ok: true, total: results.length, results };
}

/** All engines for the Ops list — catalog overlaid with live DB state. */
export async function listEngines() {
  let rows;
  try {
    rows = await prisma.engineRegistry.findMany();
  } catch (err) {
    // Under-migrated DB → show the in-code catalog at its initial version rather
    // than 500-ing the Ops console. The Ops UI surfaces `seeded:false` already.
    if (isMissingSchemaError(err)) return ENGINES.map((e) => toView(e.id, null));
    throw err;
  }
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  // Catalog order first (every known engine always shows), then any DB-only rows.
  const out = ENGINES.map((e) => toView(e.id, byId[e.id]));
  for (const r of rows) if (!ENGINE_BY_ID[r.id]) out.push(toView(r.id, r));
  return out;
}

export async function getEngine(id) {
  try {
    const row = await prisma.engineRegistry.findUnique({ where: { id } });
    if (!isEngineId(id)) return row ? toView(id, row) : null;
    return toView(id, row);
  } catch (err) {
    // Missing tables → fall back to the catalog (initial version) for a known id.
    if (isMissingSchemaError(err)) return isEngineId(id) ? toView(id, null) : null;
    throw err;
  }
}

/** Version-change history for one engine (newest first). */
export async function getHistory(id, limit = 50) {
  const take = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  let rows;
  try {
    rows = await prisma.engineVersionHistory.findMany({
      where: { engineId: id },
      orderBy: { createdAt: 'desc' },
      take,
    });
  } catch (err) {
    if (isMissingSchemaError(err)) return []; // no history table yet → empty history
    throw err;
  }
  return rows.map((h) => ({
    id: h.id,
    engineId: h.engineId,
    previous: formatVersion({ major: h.previousMajor, minor: h.previousMinor }),
    next: formatVersion({ major: h.newMajor, minor: h.newMinor }),
    changeType: h.changeType,
    changeSummary: h.changeSummary,
    classificationReason: h.classificationReason || null,
    commitSha: h.commitSha || null,
    branch: h.branch || null,
    actor: h.actor || null,
    pullRequest: h.pullRequest || null,
    automatic: h.automatic,
    createdAt: h.createdAt,
  }));
}

/** Has this (changeKey, engineId) already been applied? (idempotency probe) */
export async function isProcessed(changeKey, engineId) {
  if (!changeKey) return false;
  const row = await prisma.processedEngineChange.findUnique({
    where: { changeKey_engineId: { changeKey, engineId } },
  });
  return !!row;
}

/**
 * Apply a single engine version bump. Idempotent + concurrency-safe.
 * @returns {Promise<{ok:boolean, skipped?:boolean, engineId:string, from?:string, to?:string, error?:string}>}
 */
export async function applyBump(change) {
  const { engineId, type, summary } = change || {};
  if (!isEngineId(engineId)) return { ok: false, engineId, error: `unknown engine id: ${engineId}` };
  if (!isValidChangeType(type)) return { ok: false, engineId, error: `invalid change type: ${type}` };
  const cleanSummary = String(summary == null ? '' : summary).trim().slice(0, MAX_SUMMARY);
  if (!cleanSummary) return { ok: false, engineId, error: 'a non-empty summary is required' };

  const changeKey = change.changeKey ? String(change.changeKey) : null;

  // Fast idempotency probe (also re-checked atomically by the unique constraint).
  if (changeKey && (await isProcessed(changeKey, engineId))) {
    return { ok: true, skipped: true, engineId };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Ensure the registry row exists (seed-on-demand at v0.1). UPSERT (not
      // create) so a concurrent FIRST bump of a brand-new engine cannot raise a
      // P2002 on the EngineRegistry PK — which the catch below would otherwise
      // misread as an idempotent skip and silently drop the bump. After this, the
      // ONLY P2002 that can fire is the intended (changeKey, engineId) boundary.
      const cat = ENGINE_BY_ID[engineId] || {};
      const row = await tx.engineRegistry.upsert({
        where: { id: engineId },
        update: {},
        create: {
          id: engineId,
          displayName: cat.displayName || engineId,
          description: cat.description || null,
          status: cat.status || 'active',
          major: INITIAL_VERSION.major,
          minor: INITIAL_VERSION.minor,
        },
      });
      const from = { major: row.major, minor: row.minor };
      const to = bumpVersion(from, type);

      // Idempotency/concurrency boundary: a duplicate (changeKey, engineId) raises
      // P2002 here and rolls the whole transaction back (no double-increment).
      if (changeKey) {
        await tx.processedEngineChange.create({ data: { changeKey, engineId } });
      }

      await tx.engineRegistry.update({
        where: { id: engineId },
        data: { major: to.major, minor: to.minor, lastChangeType: type, lastChangeSummary: cleanSummary },
      });
      await tx.engineVersionHistory.create({
        data: {
          engineId,
          previousMajor: from.major,
          previousMinor: from.minor,
          newMajor: to.major,
          newMinor: to.minor,
          changeType: type,
          changeSummary: cleanSummary,
          classificationReason: change.classificationReason || null,
          commitSha: change.commitSha || null,
          branch: change.branch || null,
          actor: change.actor || null,
          pullRequest: change.pullRequest || null,
          automatic: change.automatic !== false,
        },
      });
      return { ok: true, engineId, from: formatVersion(from), to: formatVersion(to) };
    });
  } catch (err) {
    // Lost the concurrency race on the processed-change unique constraint → the
    // other writer applied it; treat as an idempotent skip. Only a P2002 on the
    // (changeKey, engineId) boundary counts — any other unique conflict is a real
    // error, never a silent "skip" (defense in depth; the upsert above already
    // removes the EngineRegistry-PK conflict source).
    if (err && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(',') : String(err.meta?.target || '');
      if (!target || /changekey|engineid|processedenginechange/i.test(target)) {
        return { ok: true, skipped: true, engineId };
      }
    }
    return { ok: false, engineId, error: err?.message || 'bump failed' };
  }
}

/** Apply many bumps (used by the CLI). Returns per-change results. */
export async function applyBumps(changes = []) {
  const results = [];
  for (const c of changes) results.push(await applyBump(c));
  return results;
}
