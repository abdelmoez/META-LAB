/**
 * applicantsForInviteFilter.test.js — the bulk-invite applicant resolver must
 * ALWAYS exclude REMOVED applicants and can never be tricked into resurrecting
 * them via an injected Prisma operator object (80.md review fix #5/#2). Uses a
 * fake client that captures the `where` clause — no DB.
 */
import { describe, it, expect } from 'vitest';
import { applicantsForInvite } from '../../server/waitlist/waitlistRepository.js';

function fakeClient() {
  const calls = [];
  return {
    calls,
    betaWaitlistApplicant: {
      findMany: async (args) => { calls.push(args); return []; },
    },
  };
}

// The REMOVED-exclusion clause is present iff some AND entry equals { status: { not: 'REMOVED' } }.
function hasRemovedGuard(where) {
  return Array.isArray(where.AND) && where.AND.some((c) => c && c.status && c.status.not === 'REMOVED');
}

describe('applicantsForInvite REMOVED protection', () => {
  it('always AND-combines the REMOVED exclusion (no filters)', async () => {
    const c = fakeClient();
    await applicantsForInvite(c, { filters: {} }, 50);
    expect(hasRemovedGuard(c.calls[0].where)).toBe(true);
  });

  it('keeps the REMOVED guard even when a status filter is supplied', async () => {
    const c = fakeClient();
    await applicantsForInvite(c, { filters: { status: 'INVITED' } }, 50);
    const where = c.calls[0].where;
    expect(hasRemovedGuard(where)).toBe(true);
    expect(where.AND).toContainEqual({ status: 'INVITED' });
  });

  it('cannot be tricked into selecting REMOVED via an operator object (injection defeated)', async () => {
    const c = fakeClient();
    await applicantsForInvite(c, { filters: { status: { in: ['REMOVED'] } } }, 50);
    const where = c.calls[0].where;
    // The operator object is coerced away (not a string) so no status equality is
    // added, and the base NOT:'REMOVED' guard survives.
    expect(hasRemovedGuard(where)).toBe(true);
    expect(where.AND.some((cl) => cl.status && cl.status.in)).toBe(false);
  });

  it('does not throw when search is a non-string (coerced, not .trim()ed)', async () => {
    const c = fakeClient();
    await expect(applicantsForInvite(c, { filters: { search: { contains: 'x' } } }, 50)).resolves.toEqual([]);
    const where = c.calls[0].where;
    // The object search is dropped — no OR clause is added.
    expect(where.AND.some((cl) => cl.OR)).toBe(false);
  });

  it('an explicit ids selection still carries the REMOVED guard', async () => {
    const c = fakeClient();
    await applicantsForInvite(c, { ids: ['a', 'b', 'a'] }, 50);
    const where = c.calls[0].where;
    expect(hasRemovedGuard(where)).toBe(true);
    expect(where.AND).toContainEqual({ id: { in: ['a', 'b'] } });
  });
});
