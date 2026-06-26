#!/usr/bin/env node
/**
 * seed-engine-registry.js — seed every discovered engine into EngineRegistry at
 * v0.1 (54.md Part 4/7). IDEMPOTENT: re-running never resets a version (upsert
 * with update only refreshing displayName/description/status; create sets v0.1).
 * Safe to run on every deploy.
 *
 * Run from project root:  node server/scripts/seed-engine-registry.js
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { seedEngines } = await import('../engineVersion/engineVersionService.js');
const { prisma } = await import('../db/client.js');

async function main() {
  console.log('Seeding engine registry (every engine starts at v0.1)…');
  const res = await seedEngines();
  for (const r of res.results) {
    console.log(`  ${r.id}: ${r.created ? 'created @ ' + r.version : 'exists @ ' + r.version + ' (version preserved)'}`);
  }
  console.log(`Done. ${res.total} engines.`);
}

main()
  .catch((err) => {
    console.error('seed-engine-registry failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
