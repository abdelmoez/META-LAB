/**
 * db-migrate-core.test.js — pure-logic coverage for the SQLite→Postgres data
 * migration core (server/db/migrate/core.js). The full DB round-trip lives in
 * tests/integration/db-migration-roundtrip.test.js (needs real Prisma DBs); this
 * file locks the provider-agnostic logic: delegate naming, @id detection,
 * topological FK ordering, and row equality — all hermetic.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import {
  delegateName, idFieldName, planModels, normalizeRow,
  requiredFkRelations, findOrphans, dryRunPlan, targetRequiresConfirmation,
} from '../../server/db/migrate/core.js';

// Synthetic DMMF-shaped models exercising parent→child FK ordering.
const SYNTHETIC = [
  { name: 'Project', fields: [
    { name: 'id', isId: true, kind: 'scalar' },
    { name: 'user', kind: 'object', type: 'User', relationFromFields: ['userId'] },
    { name: 'userId', kind: 'scalar' },
  ] },
  { name: 'User', fields: [{ name: 'id', isId: true, kind: 'scalar' }] },
  { name: 'RobAnswer', fields: [
    { name: 'id', isId: true, kind: 'scalar' },
    { name: 'assessment', kind: 'object', type: 'RobAssessment', relationFromFields: ['assessmentId'] },
  ] },
  { name: 'RobAssessment', fields: [
    { name: 'id', isId: true, kind: 'scalar' },
    { name: 'project', kind: 'object', type: 'Project', relationFromFields: ['projectId'] },
  ] },
];

describe('delegateName / idFieldName', () => {
  it('lowercases the first letter for the Prisma delegate', () => {
    expect(delegateName('User')).toBe('user');
    expect(delegateName('ScreenAiRun')).toBe('screenAiRun');
    expect(delegateName('AppSequence')).toBe('appSequence');
  });
  it('finds the @id field; non-uuid PKs too', () => {
    expect(idFieldName({ name: 'X', fields: [{ name: 'id', isId: true }] })).toBe('id');
    expect(idFieldName({ name: 'SiteSetting', fields: [{ name: 'key', isId: true }] })).toBe('key');
  });
  it('throws when a model has no @id', () => {
    expect(() => idFieldName({ name: 'NoId', fields: [{ name: 'x' }] })).toThrow(/no @id/);
  });
});

describe('planModels — topological FK ordering', () => {
  it('orders every parent before any child that holds its FK', () => {
    const order = planModels(SYNTHETIC).map((p) => p.model.name);
    expect(order.indexOf('User')).toBeLessThan(order.indexOf('Project'));
    expect(order.indexOf('Project')).toBeLessThan(order.indexOf('RobAssessment'));
    expect(order.indexOf('RobAssessment')).toBeLessThan(order.indexOf('RobAnswer'));
    expect(order).toHaveLength(SYNTHETIC.length);
  });
});

describe('planModels — against the REAL schema DMMF', () => {
  const require = createRequire(path.resolve('server/db/client.js'));
  const { Prisma } = require('@prisma/client');
  const models = Prisma.dmmf.datamodel.models;

  it('covers every model exactly once', () => {
    const plan = planModels(models);
    expect(plan).toHaveLength(models.length);
    expect(new Set(plan.map((p) => p.model.name)).size).toBe(models.length);
  });

  it('respects the real FK dependencies (User→Project, ScreenProject→ScreenRecord, RobAssessment→RobAnswer, ContactMessage→ContactMessageRead)', () => {
    const order = planModels(models).map((p) => p.model.name);
    const before = (a, b) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    before('User', 'Project');
    before('ScreenProject', 'ScreenRecord');
    before('ScreenRecord', 'ScreenDecision');
    before('RobAssessment', 'RobAnswer');
    before('RobAssessment', 'RobDomainJudgment');
    before('ContactMessage', 'ContactMessageRead');
    before('OnboardingQuestion', 'UserOnboardingResponse');
  });

  it('every model has a single-field @id usable for cursoring/upsert', () => {
    for (const m of models) expect(() => idFieldName(m)).not.toThrow();
  });
});

describe('normalizeRow', () => {
  it('serialises Dates to ISO and undefined to null for cross-store comparison', () => {
    const d = new Date('2021-03-04T05:06:07.000Z');
    expect(normalizeRow({ a: d, b: undefined, c: 'x', n: 3 })).toEqual({
      a: '2021-03-04T05:06:07.000Z', b: null, c: 'x', n: 3,
    });
  });
});

// ── 93.md — orphan detection + dry-run planning + production confirmation ─────

// Synthetic DMMF with one REQUIRED FK (Project.userId → User.id) and one
// NULLABLE FK (Note.projectId → Project.id, isRequired:false → must be skipped:
// a null/absent parent is legal for a nullable FK).
const ORPHAN_MODELS = [
  { name: 'User', fields: [{ name: 'id', isId: true, kind: 'scalar', isRequired: true }] },
  { name: 'Project', fields: [
    { name: 'id', isId: true, kind: 'scalar', isRequired: true },
    { name: 'user', kind: 'object', type: 'User', relationFromFields: ['userId'], relationToFields: ['id'] },
    { name: 'userId', kind: 'scalar', isRequired: true },
  ] },
  { name: 'Note', fields: [
    { name: 'id', isId: true, kind: 'scalar', isRequired: true },
    { name: 'project', kind: 'object', type: 'Project', relationFromFields: ['projectId'], relationToFields: ['id'] },
    { name: 'projectId', kind: 'scalar', isRequired: false },
  ] },
];

/** Hermetic fake Prisma delegate over an in-memory row array. */
function fakeDelegate(rows) {
  return {
    count: async () => rows.length,
    findMany: async ({ select } = {}) => rows.map((r) => {
      if (!select) return { ...r };
      const out = {};
      for (const k of Object.keys(select)) out[k] = r[k];
      return out;
    }),
    groupBy: async ({ by }) => {
      const key = by[0];
      const counts = new Map();
      for (const r of rows) counts.set(r[key], (counts.get(r[key]) || 0) + 1);
      return [...counts.entries()].map(([v, n]) => ({ [key]: v, _count: { _all: n } }));
    },
  };
}

describe('requiredFkRelations (93.md)', () => {
  it('returns only REQUIRED single-column FKs, child-side, with parent metadata', () => {
    const rels = requiredFkRelations(ORPHAN_MODELS);
    expect(rels).toEqual([{
      model: 'Project', delegate: 'project', fkField: 'userId',
      parentModel: 'User', parentDelegate: 'user', parentKeyField: 'id',
    }]);
  });

  it('skips nullable FKs (a missing parent is legal there)', () => {
    const rels = requiredFkRelations(ORPHAN_MODELS);
    expect(rels.find((r) => r.model === 'Note')).toBeUndefined();
  });

  it('is well-formed against the REAL schema DMMF (every entry references a real model + required scalar)', () => {
    const require = createRequire(path.resolve('server/db/client.js'));
    const { Prisma } = require('@prisma/client');
    const models = Prisma.dmmf.datamodel.models;
    const names = new Set(models.map((m) => m.name));
    const rels = requiredFkRelations(models);
    expect(rels.length).toBeGreaterThan(0); // the schema definitely has required FKs
    for (const r of rels) {
      expect(names.has(r.model)).toBe(true);
      expect(names.has(r.parentModel)).toBe(true);
      const child = models.find((m) => m.name === r.model);
      const fkScalar = child.fields.find((f) => f.name === r.fkField);
      expect(fkScalar?.isRequired).toBe(true);
    }
  });
});

describe('findOrphans (93.md pre-flight)', () => {
  it('reports child rows whose required parent id is missing, with samples', async () => {
    const source = {
      user: fakeDelegate([{ id: 'u1' }]),
      project: fakeDelegate([
        { id: 'p1', userId: 'u1' },
        { id: 'p2', userId: 'ghost' },
        { id: 'p3', userId: 'ghost' },
      ]),
      note: fakeDelegate([{ id: 'n1', projectId: 'nowhere' }]), // nullable FK — never flagged
    };
    const orphans = await findOrphans(source, ORPHAN_MODELS);
    expect(orphans).toEqual([{
      model: 'Project', fkField: 'userId', parentModel: 'User',
      rows: 2, sampleMissingParents: ['ghost'],
    }]);
  });

  it('returns [] on a clean source (and tolerates a defensive null FK value)', async () => {
    const source = {
      user: fakeDelegate([{ id: 'u1' }]),
      project: fakeDelegate([{ id: 'p1', userId: 'u1' }, { id: 'p2', userId: null }]),
      note: fakeDelegate([]),
    };
    expect(await findOrphans(source, ORPHAN_MODELS)).toEqual([]);
  });

  it('caps sampleMissingParents at maxSamples', async () => {
    const projects = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, userId: `ghost${i}` }));
    const source = { user: fakeDelegate([]), project: fakeDelegate(projects), note: fakeDelegate([]) };
    const [orphan] = await findOrphans(source, ORPHAN_MODELS, { maxSamples: 3 });
    expect(orphan.rows).toBe(10);
    expect(orphan.sampleMissingParents).toHaveLength(3);
  });
});

describe('dryRunPlan (93.md)', () => {
  it('returns per-model source counts in the exact dependency order migrateAll uses — zero writes', async () => {
    const source = {
      user: fakeDelegate([{ id: 'u1' }, { id: 'u2' }]),
      project: fakeDelegate([{ id: 'p1', userId: 'u1' }]),
      note: fakeDelegate([]),
    };
    const plan = await dryRunPlan(source, ORPHAN_MODELS);
    expect(plan.map((p) => p.model)).toEqual(planModels(ORPHAN_MODELS).map((p) => p.model.name));
    expect(plan).toEqual([
      { model: 'User', delegate: 'user', idField: 'id', rows: 2 },
      { model: 'Project', delegate: 'project', idField: 'id', rows: 1 },
      { model: 'Note', delegate: 'note', idField: 'id', rows: 0 },
    ]);
  });
});

describe('targetRequiresConfirmation (93.md)', () => {
  it('always requires confirmation when NODE_ENV=production', () => {
    expect(targetRequiresConfirmation({ targetUrl: 'file:./x.db', nodeEnv: 'production' })).toBe(true);
    expect(targetRequiresConfirmation({ targetUrl: 'postgresql://u:p@localhost:5432/db', nodeEnv: 'production' })).toBe(true);
  });
  it('never requires confirmation for local targets outside production', () => {
    expect(targetRequiresConfirmation({ targetUrl: 'file:./scratch.db', nodeEnv: 'development' })).toBe(false);
    expect(targetRequiresConfirmation({ targetUrl: 'postgresql://u:p@localhost:5432/db', nodeEnv: '' })).toBe(false);
    expect(targetRequiresConfirmation({ targetUrl: 'postgresql://u:p@127.0.0.1:5432/db', nodeEnv: 'test' })).toBe(false);
  });
  it('requires confirmation for any remote host', () => {
    expect(targetRequiresConfirmation({ targetUrl: 'postgresql://u:p@db.example.com:5432/db', nodeEnv: 'development' })).toBe(true);
    expect(targetRequiresConfirmation({ targetUrl: 'postgresql://u:p@10.0.0.5:5432/db', nodeEnv: '' })).toBe(true);
  });
  it('fails SAFE (requires confirmation) on an unparseable URL', () => {
    expect(targetRequiresConfirmation({ targetUrl: 'not a url at all', nodeEnv: '' })).toBe(true);
  });
});
