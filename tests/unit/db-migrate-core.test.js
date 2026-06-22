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
