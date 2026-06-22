/**
 * postgres-schema-sync.test.js — guards that the generated PostgreSQL schemas
 * stay in sync with the canonical SQLite schemas. If someone edits
 * server/prisma/schema.prisma (or the waitlist schema) without re-running
 * `node scripts/sync-postgres-schema.mjs`, this fails — so the Postgres variant
 * can never silently drift from the source of truth.
 */
import { describe, it, expect } from 'vitest';
import {
  TARGETS, derivePostgresSchema, readCanonical, readGeneratedPostgres, expectedPostgres,
} from '../../server/scripts/sync-postgres-schema.mjs';

describe('postgres schema sync', () => {
  for (const target of TARGETS) {
    describe(`[${target.name}]`, () => {
      it('a generated Postgres schema exists on disk', () => {
        expect(readGeneratedPostgres(target)).not.toBeNull();
      });

      it('the on-disk Postgres schema matches what the sync script would write (no drift)', () => {
        expect(readGeneratedPostgres(target)).toBe(expectedPostgres(target));
      });

      it('uses the postgresql provider and keeps every model body byte-identical to the canonical schema', () => {
        const canonical = readCanonical(target);
        const pg = derivePostgresSchema(canonical, target);
        expect(pg).toContain('provider = "postgresql"');
        expect(pg).not.toContain('provider = "sqlite"');
        // Everything after each schema's datasource block (the model definitions)
        // must be identical between canonical and derived.
        const tail = (s) => s.slice(s.indexOf('}', s.indexOf('datasource db')) + 1).trim();
        expect(tail(pg)).toBe(tail(canonical));
      });
    });
  }
});
