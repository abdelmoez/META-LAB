/**
 * countFirstArray.test.js — 122: the array COUNT is checked before any element
 * is parsed (server/schemas/countFirstArray.js), on the two bounded element
 * arrays: waitlist `areasOfInterest` (public) and admin bulk `ids`.
 *
 * Classic Zod ('zod/v3') keeps parsing every element of an over-long array and
 * records an issue per invalid element; a 10MB public body could build millions
 * of issues. Contract: in-bounds input parses exactly as before (same output,
 * paths, codes, messages); an out-of-bounds array yields ONE count issue.
 */
import { describe, it, expect } from 'vitest';
import { z } from '../../../server/node_modules/zod/v3/index.js';
import { countFirstArray } from '../../../server/schemas/countFirstArray.js';
import { waitlistSubmitSchema } from '../../../server/schemas/publicSchemas.js';
import { bulkUserActionSchema } from '../../../server/schemas/adminUserSchemas.js';

const issuesOf = (r) => (r.success ? [] : r.error.issues.map(({ code, path, message }) => ({ code, path, message })));
const waitlist = (areasOfInterest) => waitlistSubmitSchema.safeParse({ areasOfInterest });
const bulk = (ids) => bulkUserActionSchema.safeParse({ action: 'suspend', ids });

describe('countFirstArray helper', () => {
  it('rejects a non-array schema, and an array schema with a custom error map, at definition time', () => {
    expect(() => countFirstArray(z.string())).toThrow(TypeError);
    expect(() => countFirstArray(z.array(z.string(), { invalid_type_error: 'nope' }))).toThrow(TypeError);
  });

  // The count issues must be deep-equal to what the plain array schema reports.
  const variants = {
    'custom messages': z.array(z.string().max(3, 'elem long')).min(2, 'too few').max(4, 'too many'),
    'default messages': z.array(z.string().max(3)).min(2).max(4),
    'exact length': z.array(z.string().max(3)).length(3),
    'exact length + custom message': z.array(z.string()).length(3, 'need three'),
  };
  for (const [name, plain] of Object.entries(variants)) {
    it(`matches the plain schema exactly (${name})`, () => {
      const wrapped = countFirstArray(plain);
      const inputs = [[], ['a'], ['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd'], ['abcd', 'b'], ['a', 2, 'c'],
        ['a', 'b', 'c', 'd', 'e'], 'str', 5, null, undefined, {}];
      for (const input of inputs) {
        const a = plain.safeParse(input);
        const b = wrapped.safeParse(input);
        expect(b.success).toBe(a.success);
        if (a.success) { expect(b.data).toEqual(a.data); continue; }
        // Out of bounds: exactly the plain schema's count issue(s), deep-equal, and
        // none of its per-element issues (the intended difference). Otherwise: identical.
        const countIssues = a.error.issues.filter((i) => i.type === 'array' && i.path.length === 0);
        expect(b.error.issues).toEqual(countIssues.length ? countIssues : a.error.issues);
      }
      for (const input of [null, undefined, ['a', 'b', 'c']]) {
        expect(wrapped.nullish().safeParse(input)).toEqual(plain.nullish().safeParse(input));
      }
    });
  }

  it('an out-of-bounds array is rejected by its length alone: no element is ever read', () => {
    const plain = z.array(z.string()).max(100, 'too many');
    const trap = new Array(101).fill('x');
    for (let i = 0; i < trap.length; i++) {
      Object.defineProperty(trap, i, { get() { throw new Error(`element ${i} was read`); } });
    }
    const r = countFirstArray(plain).safeParse(trap);
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0]).toMatchObject({ code: 'too_big', maximum: 100, message: 'too many', path: [] });
    const sparse = countFirstArray(plain).safeParse(new Array(5_000_000));
    expect(sparse.error.issues).toHaveLength(1);
  });
});

describe('waitlist areasOfInterest (count first, max 100)', () => {
  it('keeps in-bounds behaviour: valid entries pass through, nullish still allowed', () => {
    const ok = waitlist(['Oncology', 'Meta-analysis']);
    expect(ok.success).toBe(true);
    expect(ok.data.areasOfInterest).toEqual(['Oncology', 'Meta-analysis']);
    expect(waitlist(null).success).toBe(true);
    expect(waitlist(undefined).success).toBe(true);
    expect(waitlist([]).success).toBe(true);
    expect(waitlist(new Array(100).fill('a')).success).toBe(true);
  });

  it('keeps in-bounds element issues exactly (path, code, message)', () => {
    expect(issuesOf(waitlist(['ok', 'x'.repeat(201), 7]))).toEqual([
      { code: 'too_big', path: ['areasOfInterest', 1], message: 'interest is too long' },
      { code: 'invalid_type', path: ['areasOfInterest', 2], message: 'Expected string, received number' },
    ]);
    expect(issuesOf(waitlist('not-an-array'))).toEqual([
      { code: 'invalid_type', path: ['areasOfInterest'], message: 'Expected array, received string' },
    ]);
  });

  it('a too-long array of INVALID elements yields exactly one issue: the count message', () => {
    expect(issuesOf(waitlist(new Array(101).fill(1)))).toEqual([
      { code: 'too_big', path: ['areasOfInterest'], message: 'too many interests' },
    ]);
  });

  it('a 1,000,000-element array of invalid elements still yields a single issue', () => {
    const r = waitlist(new Array(1_000_000).fill(1));
    expect(r.success).toBe(false);
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0].message).toBe('too many interests');
  });
});

describe('admin bulk ids (count first, 1..200)', () => {
  it('keeps in-bounds behaviour and element issues exactly', () => {
    const ok = bulk(['u1', 'u2']);
    expect(ok.success).toBe(true);
    expect(ok.data.ids).toEqual(['u1', 'u2']);
    expect(issuesOf(bulk(['u1', '', 5]))).toEqual([
      { code: 'too_small', path: ['ids', 1], message: 'String must contain at least 1 character(s)' },
      { code: 'invalid_type', path: ['ids', 2], message: 'Expected string, received number' },
    ]);
  });

  it('.min(1) still rejects an empty list with its count message', () => {
    expect(issuesOf(bulk([]))).toEqual([
      { code: 'too_small', path: ['ids'], message: 'Array must contain at least 1 element(s)' },
    ]);
  });

  it('too many ids (all invalid) yields exactly one count issue, even at 1,000,000', () => {
    expect(issuesOf(bulk(new Array(201).fill('')))).toEqual([
      { code: 'too_big', path: ['ids'], message: 'Array must contain at most 200 element(s)' },
    ]);
    const r = bulk(new Array(1_000_000).fill(''));
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0].code).toBe('too_big');
  });
});
