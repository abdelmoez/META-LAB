#!/usr/bin/env node
/**
 * backfill-creator-membership.js  (75.md Phase 6 — creator auto-membership)
 *
 * Guarantees that EVERY ScreenProject has its creator (the `ownerId`) present as
 * an ACTIVE 'owner' ScreenProjectMember row. Heals three shapes:
 *
 *   - missing   : no member row for the owner at all               → create it
 *   - needsHeal : an owner-userId row exists but is not role 'owner'/status
 *                 'active' (legacy 'leader'-as-owner, deactivated) → heal it
 *   - ok        : already an active 'owner' row                    → skip
 *
 * A ScreenProject whose owner USER no longer exists is reported as
 * `skippedNoOwner` (ensureLeaderMember returns null — nothing to create).
 *
 * Safe + idempotent + non-destructive:
 *   - DRY-RUN by default: prints what WOULD change, writes nothing.
 *   - `--apply` performs the writes; each project is healed inside its own
 *     `$transaction` (ensureLeaderMember is the single owner-row writer, shared
 *     with the create paths), wrapped in a per-project try/catch so one failure
 *     never aborts the run.
 *   - `--json` emits a single machine-readable JSON object (counts + a capped
 *     list of affected project ids; NO emails / user data).
 *   - Re-running after `--apply` reports 0 needing work.
 *
 * Run from project root:
 *   node server/scripts/backfill-creator-membership.js            # dry-run
 *   node server/scripts/backfill-creator-membership.js --apply    # write
 *   node server/scripts/backfill-creator-membership.js --json     # machine output
 */
import '../load-env.js'; // populate DATABASE_URL from server/.env before Prisma loads
import { prisma } from '../db/client.js';
import { ensureLeaderMember } from '../screening/access.js';

const STATE = { OK: 'ok', MISSING: 'missing', NEEDS_HEAL: 'needsHeal', NO_OWNER: 'noOwner' };

/**
 * Read-only classification of every ScreenProject's creator-membership state.
 * Never writes. One findMany over projects + one over member rows (no N+1).
 *
 * @param {object} [db=prisma]
 * @returns {Promise<{ total, ok, missing, needsHeal, noOwner, items: Array<{ id, ownerId, state }> }>}
 */
export async function scanCreatorMembership(db = prisma) {
  const projects = await db.screenProject.findMany({
    select: { id: true, ownerId: true },
  });
  // One pass over member rows that COULD be an owner's row (userId not null).
  // Keyed by `${projectId}::${userId}` → { role, status }. Small column set.
  const memberRows = await db.screenProjectMember.findMany({
    where: { userId: { not: null } },
    select: { projectId: true, userId: true, role: true, status: true },
  });
  const byKey = new Map();
  for (const m of memberRows) byKey.set(`${m.projectId}::${m.userId}`, m);

  // Which owners still exist? Only owners of projects that are NOT already ok
  // need the existence check, but a single set keeps it simple + bounded.
  const ownerIds = [...new Set(projects.map(p => p.ownerId))];
  const existingOwners = new Set(
    (await db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true } })).map(u => u.id),
  );

  const out = { total: projects.length, ok: 0, missing: 0, needsHeal: 0, noOwner: 0, items: [] };
  for (const p of projects) {
    const row = byKey.get(`${p.id}::${p.ownerId}`);
    let state;
    if (row && row.role === 'owner' && row.status === 'active') {
      state = STATE.OK;
    } else if (!existingOwners.has(p.ownerId)) {
      // Owner user is gone — ensureLeaderMember can't create a row for a
      // nonexistent user. Report separately; never a hard failure.
      state = STATE.NO_OWNER;
    } else if (row) {
      state = STATE.NEEDS_HEAL;
    } else {
      state = STATE.MISSING;
    }
    out[state === STATE.OK ? 'ok' : state === STATE.MISSING ? 'missing' : state === STATE.NEEDS_HEAL ? 'needsHeal' : 'noOwner'] += 1;
    if (state !== STATE.OK) out.items.push({ id: p.id, ownerId: p.ownerId, state });
  }
  return out;
}

/**
 * Apply the backfill: for every ScreenProject that lacks an active 'owner' row
 * (and whose owner user still exists), run ensureLeaderMember inside its own
 * transaction. Idempotent + partial-failure-safe (per-project try/catch).
 *
 * @param {object} [db=prisma]
 * @param {{ log?: (msg: string) => void }} [opts]
 * @returns {Promise<{ scanned, needing, created, healed, failed, skippedNoOwner, errors: Array<{ id, error }> }>}
 */
export async function applyCreatorMembership(db = prisma, { log = () => {} } = {}) {
  const scan = await scanCreatorMembership(db);
  const summary = {
    scanned: scan.total,
    needing: scan.missing + scan.needsHeal,
    created: 0,
    healed: 0,
    failed: 0,
    skippedNoOwner: scan.noOwner,
    errors: [],
  };
  for (const item of scan.items) {
    if (item.state === STATE.NO_OWNER) {
      log(`skip ${item.id}: owner user ${item.ownerId} no longer exists`);
      continue;
    }
    try {
      await db.$transaction((tx) => ensureLeaderMember({ id: item.id, ownerId: item.ownerId }, tx));
      if (item.state === STATE.MISSING) { summary.created += 1; log(`created owner member for ${item.id}`); }
      else { summary.healed += 1; log(`healed owner member for ${item.id}`); }
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({ id: item.id, error: err.message });
      log(`FAILED for ${item.id}: ${err.message}`);
    }
  }
  return summary;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const asJson = args.has('--json');
  const log = asJson ? () => {} : (msg) => console.log('  ' + msg);

  const scan = await scanCreatorMembership();
  const needing = scan.missing + scan.needsHeal;

  if (!apply) {
    if (asJson) {
      // Capped id list keeps the payload small; NO emails / user data.
      console.log(JSON.stringify({
        mode: 'dry-run',
        scanned: scan.total,
        ok: scan.ok,
        missing: scan.missing,
        needsHeal: scan.needsHeal,
        skippedNoOwner: scan.noOwner,
        needing,
        affectedProjectIds: scan.items.filter(i => i.state !== STATE.NO_OWNER).slice(0, 200).map(i => i.id),
      }, null, 2));
    } else {
      console.log('\nbackfill-creator-membership (DRY-RUN — nothing written):');
      console.log(`  ScreenProjects scanned    : ${scan.total}`);
      console.log(`  already OK                 : ${scan.ok}`);
      console.log(`  missing owner member       : ${scan.missing}`);
      console.log(`  owner row needs healing    : ${scan.needsHeal}`);
      console.log(`  skipped (owner user gone)  : ${scan.noOwner}`);
      console.log(`  → would change             : ${needing}`);
      console.log('\n  Re-run with --apply to write the owner member rows.');
    }
    return;
  }

  const result = await applyCreatorMembership(prisma, { log });
  if (asJson) {
    console.log(JSON.stringify({ mode: 'apply', ...result }, null, 2));
  } else {
    console.log('\nbackfill-creator-membership complete (--apply):');
    console.log(`  ScreenProjects scanned    : ${result.scanned}`);
    console.log(`  owner rows created         : ${result.created}`);
    console.log(`  owner rows healed          : ${result.healed}`);
    console.log(`  skipped (owner user gone)  : ${result.skippedNoOwner}`);
    console.log(`  failed                     : ${result.failed}`);
    if (result.errors.length) {
      console.log('\n  errors:');
      for (const e of result.errors) console.log(`    ${e.id}: ${e.error}`);
    }
  }
}

// Run as a script (but stay importable for tests — only main() touches argv/exit).
import { fileURLToPath } from 'url';
const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  main()
    .catch((e) => { console.error('Backfill failed:', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
