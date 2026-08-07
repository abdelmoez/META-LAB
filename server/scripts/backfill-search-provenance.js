#!/usr/bin/env node
/**
 * backfill-search-provenance.js — 104.md Part 2.
 *
 * Two jobs, and it is worth being clear that the FIRST one is a data repair, not a
 * convenience:
 *
 * 1. REPAIR poisoned `ScreenRecord.sourceDb` values.
 *    Until 104.md, the importer stamped `sourceDb: r.sourceDb || r.source || format`.
 *    So every file whose records carried no per-record source label got the FILE
 *    FORMAT written into the database-name column — 'ris', 'csv', 'nbib', 'bibtex'.
 *    Those strings are read by the search-provenance layer and by the PRISMA source
 *    rows, which means an affected project can currently generate a Methods sentence
 *    claiming the team "searched Ris". The code no longer writes them, but the rows
 *    already written are still there and still wrong. This clears them to '', which
 *    is the honest value: provenance drops unattributed records rather than
 *    inventing a database, and PRISMA labels them "Unspecified source".
 *
 * 2. INFER `ScreenImportBatch.sourceDatabase` where the records agree.
 *    When every attributable record in a batch canonicalizes to ONE database, that
 *    batch was a search of that database and can say so. Where the records disagree,
 *    or none of them canonicalize to anything known, the batch is LEFT BLANK — a
 *    guess here would be indistinguishable from a fact in the manuscript.
 *
 * What it deliberately does NOT do
 * --------------------------------
 * It does not set `searchedAt`. We do not know when a historical search was run;
 * `createdAt` is the day the file was uploaded, and the entire point of the
 * `searchedAt` column is that those are different facts. Writing the upload date
 * into it would erase the distinction the column exists to preserve, and would do so
 * invisibly — the manuscript would report a precise, confident, wrong date. Batches
 * keep falling back to `createdAt` (unchanged behaviour) until a human states the
 * real date in the Import History UI.
 *
 * It does not touch `contributesToReview`. Every existing batch already counts, and
 * deciding retrospectively that one should not is a research judgement, not a
 * migration.
 *
 * Safe to re-run: idempotent, and it only ever fills blanks or clears known-bad
 * values.
 *
 *   node server/scripts/backfill-search-provenance.js [--dry-run] [--project <id>]
 */
import { PrismaClient } from '@prisma/client';
import { canonicalDbKey, dbLabel } from '../../src/research-engine/search/searchProvenance.js';

const prisma = new PrismaClient();

/**
 * File formats the old fallback could write into sourceDb. These are the ONLY
 * values cleared — an unrecognised label is left alone, because it may well be a
 * real database this list has never heard of, and destroying a real attribution
 * would be a worse bug than the one being fixed.
 */
const FORMAT_TOKENS = new Set([
  'ris', 'csv', 'tsv', 'nbib', 'bibtex', 'bib', 'enw', 'endnote', 'txt', 'xml',
  'json', 'medline', 'pubmed-xml', 'file', 'auto', 'unknown', 'undefined', 'null',
]);

/**
 * MEDLINE is a genuine database AND a file format, so it appears in both worlds.
 * A record whose sourceDb is exactly the format token 'medline' is ambiguous, and
 * ambiguity is not grounds for deleting data — leave it, and let a human decide.
 */
const AMBIGUOUS = new Set(['medline']);

const isFormatToken = (v) => {
  const s = String(v || '').trim().toLowerCase();
  return !!s && FORMAT_TOKENS.has(s) && !AMBIGUOUS.has(s);
};

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const pIdx = args.indexOf('--project');
  const onlyProject = pIdx >= 0 ? args[pIdx + 1] : null;

  if (dryRun) console.log('DRY RUN — nothing will be written.\n');

  const where = onlyProject ? { projectId: onlyProject } : {};

  /* ── 1. repair format-token sourceDb values ──────────────────────────────── */
  const groups = await prisma.screenRecord.groupBy({
    by: ['sourceDb'],
    where,
    _count: { _all: true },
  });

  const poisoned = groups
    .map((g) => ({ value: String(g.sourceDb || ''), n: g._count?._all || 0 }))
    .filter((g) => isFormatToken(g.value));

  let cleared = 0;
  for (const p of poisoned) {
    console.log(`  repair  "${p.value}" → ""   (${p.n} record${p.n === 1 ? '' : 's'})`);
    if (!dryRun) {
      const r = await prisma.screenRecord.updateMany({
        where: { ...where, sourceDb: p.value },
        data: { sourceDb: '' },
      });
      cleared += r.count;
    } else {
      cleared += p.n;
    }
  }
  console.log(poisoned.length
    ? `\nCleared ${cleared} record${cleared === 1 ? '' : 's'} whose "database" was really a file format.\n`
    : 'No poisoned sourceDb values found.\n');

  /* ── 2. infer batch sourceDatabase where records agree ───────────────────── */
  let batches;
  try {
    batches = await prisma.screenImportBatch.findMany({
      where: onlyProject ? { projectId: onlyProject } : {},
      select: { id: true, projectId: true, filename: true, source: true, searchRunId: true, sourceDatabase: true },
    });
  } catch (e) {
    console.error('\nCould not read ScreenImportBatch.sourceDatabase — run `prisma db push` first.');
    throw e;
  }

  // Only MANUAL batches. A Pecan batch's database is already recorded on its run's
  // per-provider rows; writing a second copy here would create a second truth.
  const manual = batches.filter((b) => b.source !== 'pecan-search'
    && !String(b.searchRunId || '').trim()
    && !String(b.sourceDatabase || '').trim());

  if (!manual.length) {
    console.log('No manual batches need a database inferred.');
    return summary(cleared, 0, 0, dryRun);
  }

  const perBatch = await prisma.screenRecord.groupBy({
    by: ['importBatchId', 'sourceDb'],
    where: { importBatchId: { in: manual.map((b) => b.id) } },
    _count: { _all: true },
  });

  const keysByBatch = new Map();
  for (const row of perBatch) {
    const id = String(row.importBatchId || '');
    const key = canonicalDbKey(String(row.sourceDb || '').trim());
    if (!id || !key) continue;           // blank / unattributable contributes nothing
    const set = keysByBatch.get(id) || new Set();
    set.add(key);
    keysByBatch.set(id, set);
  }

  let filled = 0;
  let skipped = 0;
  for (const b of manual) {
    const keys = keysByBatch.get(b.id);
    if (!keys || keys.size === 0) {
      skipped += 1;
      continue;                          // nothing to infer from — stays blank
    }
    if (keys.size > 1) {
      // A batch spanning several databases is one import of a merged export. There
      // is no single answer, and picking the most common one would be a guess
      // presented as a fact.
      console.log(`  skip    ${b.filename || b.id} — records span ${keys.size} databases`);
      skipped += 1;
      continue;
    }
    const key = [...keys][0];
    console.log(`  infer   ${b.filename || b.id} → ${dbLabel(key)}`);
    if (!dryRun) {
      await prisma.screenImportBatch.update({ where: { id: b.id }, data: { sourceDatabase: key } });
    }
    filled += 1;
  }

  return summary(cleared, filled, skipped, dryRun);
}

function summary(cleared, filled, skipped, dryRun) {
  console.log('\n─────────────────────────────────────────────');
  console.log(`records repaired      ${cleared}`);
  console.log(`batches attributed    ${filled}`);
  console.log(`batches left blank    ${skipped}`);
  console.log('\nsearchedAt was NOT backfilled: the upload date is not the search');
  console.log('date, and inventing one would make the manuscript confidently wrong.');
  console.log('Set real search dates in Import History → Search record.');
  if (dryRun) console.log('\n(dry run — nothing was written)');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
