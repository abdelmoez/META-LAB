#!/usr/bin/env node
/**
 * backfill-workspaces.js  (prompt18 — unified Review Workspace)
 *
 * Ensures EVERY live META·LAB project has its internal META·SIFT screening
 * module (a linked ScreenProject), so the unified "Screening" stage works for
 * projects created before this change. Safe + idempotent + non-destructive:
 *
 *   - Only CREATES a missing module; never deletes, downgrades, or relinks.
 *   - Owner-scoped per project (ownerId = Project.userId) → no foreign links.
 *   - Re-runnable: projects already linked are skipped.
 *
 * Standalone META·SIFT projects (no linkedMetaLabProjectId) are deliberately
 * left as-is — they remain reachable via admin/deep-link as screening-only
 * workspaces (see docs/manager/unified-workflow-migration-plan.md).
 *
 * Run from project root:  node server/scripts/backfill-workspaces.js
 */
import '../load-env.js'; // populate DATABASE_URL from server/.env before Prisma loads
import { backfillScreenModules } from '../screening/ensureWorkspace.js';
import { prisma } from '../db/client.js';

async function main() {
  const summary = await backfillScreenModules({ log: msg => console.log('  ' + msg) });
  console.log('\nbackfill-workspaces complete:');
  console.log(`  META·LAB projects scanned : ${summary.scanned}`);
  console.log(`  screening modules created : ${summary.created}`);
  console.log(`  already had a module      : ${summary.skipped}`);
  console.log(`  failed                    : ${summary.failed}`);
  if (summary.errors.length) {
    console.log('\n  errors:');
    for (const e of summary.errors) console.log(`    ${e.projectId}: ${e.error}`);
  }
}

main()
  .catch(e => { console.error('Backfill failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
