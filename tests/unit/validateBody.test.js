/**
 * validateBody.test.js — Zod request-boundary validation + prototype-pollution
 * guard for import/autosave (prompt49 §9). Pure (mock req/res/next).
 */
import { describe, it, expect } from 'vitest';
import { validateBody, hasDangerousKeys } from '../../server/middleware/validateBody.js';
import { autosaveProjectSchema, importReferencesSchema } from '../../server/schemas/requestSchemas.js';

function run(schema, body) {
  const req = { body };
  let nexted = false;
  const res = {
    statusCode: 200,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; return this; },
  };
  validateBody(schema)(req, res, () => { nexted = true; });
  return { req, res, nexted };
}

describe('hasDangerousKeys', () => {
  it('detects prototype-pollution keys at any depth', () => {
    expect(hasDangerousKeys({ a: 1 })).toBe(false);
    expect(hasDangerousKeys(JSON.parse('{"__proto__":{"x":1}}'))).toBe(true);
    expect(hasDangerousKeys({ nested: { constructor: 1 } })).toBe(true);
    expect(hasDangerousKeys({ list: [{ prototype: 1 }] })).toBe(true);
    expect(hasDangerousKeys(null)).toBe(false);
    expect(hasDangerousKeys('a string')).toBe(false);
  });
});

describe('validateBody — autosave', () => {
  it('accepts a valid project blob and passes unknown keys through', () => {
    const { res, nexted, req } = run(autosaveProjectSchema, {
      name: 'My review', studies: [{ id: 's1' }], records: [{ id: 'r1', decision: 'include' }],
      pico: { population: 'adults' }, futureFeatureField: { x: 1 },
    });
    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(req.body.futureFeatureField).toEqual({ x: 1 }); // passthrough kept it
  });

  it('rejects a missing/empty name with a structured 400', () => {
    const { res, nexted } = run(autosaveProjectSchema, { studies: [] });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.payload.code).toBe('VALIDATION_ERROR');
    expect(res.payload.fieldErrors.some((e) => e.path === 'name')).toBe(true);
  });

  it('rejects prototype-pollution payloads before schema parsing', () => {
    const { res, nexted } = run(autosaveProjectSchema, JSON.parse('{"name":"x","__proto__":{"admin":true}}'));
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.payload.code).toBe('INVALID_BODY');
  });

  it('rejects an oversized records array', () => {
    const { res, nexted } = run(autosaveProjectSchema, { name: 'x', records: { length: 2_000_000 } });
    // records must be an array; a non-array fails type before the max check
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(400);
  });
});

describe('validateBody — import', () => {
  it('accepts valid import and strips unknown keys', () => {
    const { res, nexted, req } = run(importReferencesSchema, { text: 'TY  - JOUR', projectId: 'abc123', extra: 'nope' });
    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(req.body.extra).toBeUndefined(); // stripped (fixed contract)
  });

  it('rejects empty text / missing projectId', () => {
    expect(run(importReferencesSchema, { text: '', projectId: 'p' }).res.statusCode).toBe(400);
    expect(run(importReferencesSchema, { text: 'x' }).res.statusCode).toBe(400);
  });

  it('rejects an oversized import', () => {
    const big = 'x'.repeat(2_000_001);
    const { res } = run(importReferencesSchema, { text: big, projectId: 'p' });
    expect(res.statusCode).toBe(400);
  });
});
