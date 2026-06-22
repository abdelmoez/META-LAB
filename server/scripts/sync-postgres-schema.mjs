#!/usr/bin/env node
/**
 * sync-postgres-schema.mjs — derive the PostgreSQL Prisma schemas from the
 * canonical SQLite schemas so the two NEVER drift.
 *
 * Why this exists
 * ----------------
 * Prisma 5 requires `datasource.provider` to be a literal string — it cannot be
 * driven by an env var. To support both SQLite (today's deployment) and
 * PostgreSQL (the migration target) we keep ONE canonical model definition per
 * database and mechanically generate the Postgres variant from it. The model
 * definitions use only portable column types (String/Int/Float/Boolean/DateTime),
 * `@default(uuid())`, `@default(now())`, `@updatedAt`, `@@index`, `@@unique` and
 * relations with `onDelete: Cascade` — all identical across SQLite and Postgres —
 * so the ONLY thing that differs is the generator/datasource header.
 *
 * Two databases are handled, preserving the prompt48 isolation boundary:
 *   - the MAIN application DB   (prisma/schema.prisma           → postgres-client)
 *   - the BETA-WAITLIST DB      (prisma/waitlist/schema.prisma  → postgres-waitlist-client)
 * They get SEPARATE Postgres databases (POSTGRES_DATABASE_URL vs
 * POSTGRES_WAITLIST_DATABASE_URL) — applicant PII never mixes with user data.
 *
 * The Postgres clients are emitted to SEPARATE outputs so the data migration
 * tool can hold a SQLite *source* client and a Postgres *target* client at once.
 *
 * Run (from server/):  node scripts/sync-postgres-schema.mjs
 * A drift test asserts the generated files are in sync, so CI fails if someone
 * edits a canonical schema without re-running this.
 */
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRISMA_DIR = path.resolve(__dirname, '../prisma');

/** The databases to sync. Each entry: canonical SQLite schema → derived PG schema. */
export const TARGETS = [
  {
    name: 'main',
    canonical: path.join(PRISMA_DIR, 'schema.prisma'),
    pgSchema: path.join(PRISMA_DIR, 'postgres', 'schema.prisma'),
    generatorOutput: '../generated/postgres-client',
    urlEnv: 'POSTGRES_DATABASE_URL',
  },
  {
    name: 'waitlist',
    canonical: path.join(PRISMA_DIR, 'waitlist', 'schema.prisma'),
    pgSchema: path.join(PRISMA_DIR, 'postgres', 'waitlist-schema.prisma'),
    generatorOutput: '../generated/postgres-waitlist-client',
    urlEnv: 'POSTGRES_WAITLIST_DATABASE_URL',
  },
];

// DETERMINISTIC header (no cwd / Date / random) so the output is byte-stable and
// the drift test can recompute it exactly.
function header(target) {
  const schemaRel = `prisma/${path.relative(PRISMA_DIR, target.pgSchema).replace(/\\/g, '/')}`;
  return `// ──────────────────────────────────────────────────────────────────────────────
// PecanRev — PostgreSQL schema. GENERATED FILE — DO NOT EDIT BY HAND.
// Produced from the canonical SQLite schema by scripts/sync-postgres-schema.mjs.
// Edit the canonical schema, then re-run:  node scripts/sync-postgres-schema.mjs
//
// The model definitions below are identical to the canonical schema; only the
// generator output path and the datasource provider differ. The generated client
// lands in ${target.generatorOutput} (separate from the default @prisma/client) so
// the SQLite→Postgres migration tool can use source + target clients at once.
// Runtime selection is by DATABASE_PROVIDER=postgres (see server/db/client.js).
//
// Apply (from server/):
//   ${target.urlEnv}="postgresql://user:pass@host:5432/db?schema=public" \\
//     npx prisma generate --schema=${schemaRel}
//   ${target.urlEnv}=... npx prisma db push --schema=${schemaRel}
// ──────────────────────────────────────────────────────────────────────────────
`;
}

/**
 * Transform canonical schema text into the Postgres variant. Pure function so
 * the drift test can compare without touching disk.
 */
export function derivePostgresSchema(canonical, target) {
  const genIdx = canonical.indexOf('generator client');
  if (genIdx === -1) throw new Error('canonical schema missing `generator client` block');
  const dsIdx = canonical.indexOf('datasource db', genIdx);
  if (dsIdx === -1) throw new Error('canonical schema missing `datasource db` block');
  const dsClose = canonical.indexOf('}', dsIdx);
  if (dsClose === -1) throw new Error('canonical schema: unterminated `datasource db` block');

  const models = canonical.slice(dsClose + 1).replace(/^\s*\n/, '\n');
  const pgBlocks = `generator client {
  provider = "prisma-client-js"
  output   = "${target.generatorOutput}"
}

datasource db {
  provider = "postgresql"
  url      = env("${target.urlEnv}")
}
`;
  return `${header(target)}\n${pgBlocks}${models}`.replace(/\s*$/, '\n');
}

export function readCanonical(target) {
  return fs.readFileSync(target.canonical, 'utf8');
}

export function readGeneratedPostgres(target) {
  return fs.existsSync(target.pgSchema) ? fs.readFileSync(target.pgSchema, 'utf8') : null;
}

export function expectedPostgres(target) {
  return derivePostgresSchema(readCanonical(target), target);
}

function main() {
  for (const target of TARGETS) {
    const pg = expectedPostgres(target);
    fs.mkdirSync(path.dirname(target.pgSchema), { recursive: true });
    fs.writeFileSync(target.pgSchema, pg, 'utf8');
    console.log(`[${target.name}] wrote ${path.relative(process.cwd(), target.pgSchema)} (${pg.length} bytes).`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
