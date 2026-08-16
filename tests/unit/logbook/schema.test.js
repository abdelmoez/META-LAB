/**
 * 119.md §8 / §10 "Schema and migration tests" — the ProjectLogEvent table.
 *
 * Pins the append-only Logbook table in BOTH schema files (dev SQLite + prod
 * Postgres mirror), the §8 field set, the indexes that keep a long-running
 * project's Logbook fast, and the repo's additive `db push` discipline (every
 * new column is defaulted or nullable, so pushing this table onto a live
 * database can never require --accept-data-loss).
 */
import { describe, it, expect } from 'vitest';
import { readSource } from '../../helpers/readSource.js';

const sqlite = readSource(new URL('../../../server/prisma/schema.prisma', import.meta.url));
const postgres = readSource(new URL('../../../server/prisma/postgres/schema.prisma', import.meta.url));

const modelBody = (schema, name) => {
  const start = schema.indexOf(`model ${name} {`);
  expect(start).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf('\n}', start) + 2);
};

const SQLITE = modelBody(sqlite, 'ProjectLogEvent');
const POSTGRES = modelBody(postgres, 'ProjectLogEvent');

/** Every §8 "Each event should include, where applicable" bullet → its column. */
const REQUIRED_FIELDS = {
  'Project ID': ['projectId', 'metaLabProjectId'],
  'Immutable event ID': ['id'],
  'Timestamp': ['createdAt', 'clientTs'],
  'Actor ID + name at the time + role at the time': ['actorId', 'actorName', 'actorRole'],
  'User/system/automation actor type': ['actorType'],
  'Engine/module': ['engine'],
  'Action category': ['action', 'actionCategory'],
  'Human-readable summary': ['summary'],
  'Affected resource type and stable ID': ['resourceType', 'resourceId', 'resourceLabel'],
  'Before/after summary': ['beforeSummary', 'afterSummary'],
  'Success/failure/reversal/restoration status': ['status'],
  'Related operation/request ID': ['opId', 'correlationId', 'sessionId'],
  'Undo/redo relationship': ['via', 'relatedEventId'],
  'Investigation metadata': ['metadata', 'severity', 'schemaVersion'],
  'Duplicate-submission protection': ['idempotencyKey'],
};

describe('ProjectLogEvent — schema', () => {
  it('exists in BOTH the SQLite source of truth and the Postgres mirror', () => {
    expect(SQLITE.length).toBeGreaterThan(0);
    expect(POSTGRES.length).toBeGreaterThan(0);
  });

  it('the Postgres mirror is byte-identical to the canonical model body', () => {
    expect(POSTGRES).toBe(SQLITE);
  });

  for (const [bullet, fields] of Object.entries(REQUIRED_FIELDS)) {
    it(`carries the §8 field(s) for "${bullet}"`, () => {
      for (const f of fields) expect(SQLITE).toMatch(new RegExp(`^\\s+${f}\\s`, 'm'));
    });
  }

  it('indexes the query shapes the Logbook UI actually issues', () => {
    // Timeline page (cursor), member view, engine view, action + status filters,
    // the mirrored-action cutover probe, and the META·LAB-scoped read.
    for (const idx of [
      '@@index([projectId, createdAt])',
      '@@index([projectId, id])',
      '@@index([projectId, engine, id])',
      '@@index([projectId, actorId, id])',
      '@@index([projectId, action, id])',
      '@@index([projectId, status, id])',
      '@@index([projectId, mirrors, id])',
      '@@index([metaLabProjectId, createdAt])',
      '@@index([correlationId])',
    ]) expect(SQLITE).toContain(idx);
  });

  it('is additive-safe: every scalar column is defaulted or nullable (db push discipline)', () => {
    const lines = SQLITE.split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@') && !l.startsWith('model') && l !== '}');
    for (const line of lines) {
      const [name, type] = line.split(/\s+/);
      if (name === 'id') continue;                       // @id @default(autoincrement())
      if (name === 'action') continue;                   // the ONE required column, always supplied by the writer
      const optional = type.endsWith('?') || line.includes('@default(');
      expect(optional, `column ${name} must be nullable or defaulted`).toBe(true);
    }
  });

  it('has NO relation/FK — audit rows outlive what they describe', () => {
    expect(SQLITE).not.toContain('@relation');
  });

  it('carries no free-form JSON column type (SQLite has no Json — bounded Strings only)', () => {
    expect(SQLITE).not.toMatch(/^\s+\w+\s+Json/m);
    for (const jsonCol of ['beforeSummary', 'afterSummary', 'metadata']) {
      expect(SQLITE).toMatch(new RegExp(`${jsonCol}\\s+String`));
    }
  });

  it('the existing ProjectEvent ledger is untouched (the Logbook is additive, not a rewrite)', () => {
    const pe = modelBody(sqlite, 'ProjectEvent');
    expect(pe).toContain('idempotencyKey            String?  @unique');
    expect(pe).toContain('@@index([projectId, id])');
    expect(pe).toContain('supersedesEventId         Int?');
  });
});
