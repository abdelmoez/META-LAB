#!/usr/bin/env node
/**
 * backfill-keywords.js — seed the default include/exclude keyword lists into any
 * ScreenProject whose list is EMPTY (projects created before keyword seeding
 * existed). Safe + idempotent: only fills empty lists, never overwrites a
 * project that already has custom keywords.
 *
 * Run from project root:  node server/scripts/backfill-keywords.js
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_INCLUDE_KEYWORDS, DEFAULT_EXCLUDE_KEYWORDS } from '../../src/research-engine/screening/defaultKeywords.js';

const prisma = new PrismaClient();

function isEmptyList(json) {
  try { const v = JSON.parse(json || '[]'); return !Array.isArray(v) || v.length === 0; }
  catch { return true; }
}

async function main() {
  const projects = await prisma.screenProject.findMany({
    select: { id: true, title: true, inclusionKeywords: true, exclusionKeywords: true },
  });
  let inc = 0, exc = 0;
  for (const p of projects) {
    const data = {};
    if (isEmptyList(p.inclusionKeywords)) { data.inclusionKeywords = JSON.stringify(DEFAULT_INCLUDE_KEYWORDS); inc++; }
    if (isEmptyList(p.exclusionKeywords)) { data.exclusionKeywords = JSON.stringify(DEFAULT_EXCLUDE_KEYWORDS); exc++; }
    if (Object.keys(data).length) {
      await prisma.screenProject.update({ where: { id: p.id }, data });
      console.log(`  filled ${p.title || p.id}: ${Object.keys(data).join(', ')}`);
    }
  }
  console.log(`\nBackfill complete — include lists filled: ${inc}, exclude lists filled: ${exc} (of ${projects.length} projects).`);
}

main().catch(e => { console.error('Backfill failed:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
