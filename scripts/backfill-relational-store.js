/**
 * scripts/backfill-relational-store.js — roadmap 0.2, migration step 2.
 *
 * Backfills the additive ReviewRecord / ReviewStudy tables from every existing
 * Project.data JSON blob. IDEMPOTENT: writeRelationalRows() does a per-project
 * delete-all + recreate, so re-running converges (no duplicates). It never
 * mutates Project.data — the JSON blob stays the source of truth until reads are
 * switched at the evaluation gate.
 *
 * Usage:  node scripts/backfill-relational-store.js [--dry]
 *   --dry   report what would be written without touching the DB.
 *
 * Safe to run on production: purely additive (writes only the new tables).
 */
import { prisma } from '../server/db/client.js';
import { projectToRows, writeRelationalRows } from '../server/services/projectStore.js';

const DRY = process.argv.includes('--dry');

async function main() {
  const projects = await prisma.project.findMany({ select: { id: true, name: true, data: true } });
  console.log(`[backfill] ${projects.length} project(s) found${DRY ? ' (dry run)' : ''}`);

  let okRecords = 0, okStudies = 0, failed = 0;
  for (const row of projects) {
    let doc;
    try {
      doc = JSON.parse(row.data || '{}');
    } catch (e) {
      console.error(`[backfill] project ${row.id} has unparseable data — skipped (${e.message})`);
      failed++;
      continue;
    }
    doc.id = row.id; // ensure FK target matches the Project row
    const { records, studies } = projectToRows(doc);

    if (DRY) {
      console.log(`[backfill] ${row.id} "${row.name}": ${records.length} records, ${studies.length} studies`);
    } else {
      try {
        const res = await writeRelationalRows(prisma, doc);
        console.log(`[backfill] ${row.id} "${row.name}": wrote ${res.records} records, ${res.studies} studies`);
      } catch (e) {
        console.error(`[backfill] project ${row.id} write failed: ${e.message}`);
        failed++;
        continue;
      }
    }
    okRecords += records.length;
    okStudies += studies.length;
  }

  console.log(`[backfill] done — ${okRecords} records, ${okStudies} studies across ${projects.length - failed} project(s); ${failed} failed/skipped.`);
}

main()
  .catch(e => { console.error('[backfill] fatal:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
