/**
 * prismaEnvGuard.js — shell-env fidelity for single-fork integration runs.
 *
 * Importing the shared Prisma client (server/db/client.js) makes Prisma's
 * generated client inject server/.env into process.env as a side effect. In the
 * single-fork integration process (`--poolOptions.forks.singleFork=true`) that
 * poisons the environment for every test FILE that runs later: suites that log
 * in as the seeded dev admin with `process.env.ADMIN_SEED_PASSWORD || <default>`
 * suddenly use the .env value, which the long-seeded dev admin account never
 * had (the boot seeder only CREATES missing admins — it never rotates an
 * existing password), so their admin logins 401 and admin-gated tests skip or
 * fail depending on the suite.
 *
 * Usage (in any test file that imports server modules):
 *   import { restoreShellEnv } from '../helpers/prismaEnvGuard.js'; // FIRST import
 *   import { prisma } from '../../../server/db/client.js';
 *   restoreShellEnv(); // at module top, after the import block
 *
 * ES-module evaluation order guarantees this module's snapshot runs before the
 * prisma import's injection (leaf modules evaluate first, in declaration
 * order), so the snapshot captures the values the LAUNCHING SHELL defined.
 * restoreShellEnv() then deletes anything prisma injected that the shell did
 * not define (and restores shell-defined values verbatim). Only the vars listed
 * in GUARDED_KEYS are touched — .env-injected provider keys the server process
 * legitimately owns are irrelevant to the test process and left alone.
 */

// Vars whose leakage across test files is known to change suite behaviour.
const GUARDED_KEYS = ['ADMIN_SEED_PASSWORD'];

const shellValues = new Map(
  GUARDED_KEYS.map((k) => [
    k,
    Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined,
  ]),
);

/** Reset the guarded vars to what the launching shell defined. Idempotent. */
export function restoreShellEnv() {
  for (const [k, v] of shellValues) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
