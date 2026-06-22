/**
 * userNumber.test.js — the immutable, sequential numeric user id allocator
 * (prompt49 item 8) and the portable AppSequence counter (server/services/
 * sequence.js, userNumber.js). Hermetic: a tiny in-memory fake Prisma client
 * exercises the allocator semantics without a real DB (the real-DB behaviour is
 * additionally proven by the integration round-trip test).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { allocateNumber, ensureSequenceAtLeast } from '../../server/services/sequence.js';
import { backfillUserNumbers, ensureUserNumber } from '../../server/services/userNumber.js';

// Minimal in-memory Prisma-shaped fake supporting the allocator's operations.
function makeFakeClient(users = []) {
  const sequences = new Map(); // name -> { name, value, updatedAt }
  const userRows = users.map((u) => ({ ...u }));

  const appSequence = {
    async upsert({ where: { name }, create, update }) {
      const existing = sequences.get(name);
      if (!existing) { const row = { name, value: create.value ?? 0 }; sequences.set(name, row); return { ...row }; }
      if (update && 'value' in update) existing.value = update.value;
      return { ...existing };
    },
    async update({ where: { name }, data }) {
      const row = sequences.get(name);
      if (!row) throw new Error(`no sequence ${name}`);
      if (data.value && typeof data.value === 'object' && 'increment' in data.value) row.value += data.value.increment;
      else if (typeof data.value === 'number') row.value = data.value;
      return { ...row };
    },
    async updateMany({ where: { name, value }, data }) {
      const row = sequences.get(name);
      let count = 0;
      // Mirror Prisma: apply only when the guard (e.g. value < f) matches.
      if (row && (value == null || (value.lt != null && row.value < value.lt))) {
        if (typeof data.value === 'number') row.value = data.value;
        count = 1;
      }
      return { count };
    },
    async findUnique({ where: { name } }) { const r = sequences.get(name); return r ? { ...r } : null; },
  };

  const user = {
    async findMany({ where = {}, orderBy = [] } = {}) {
      let rows = userRows.filter((u) => (where.userNumber === null ? u.userNumber == null : true));
      const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
      rows = rows.slice().sort((a, b) => {
        for (const o of orders) {
          const [k, dir] = Object.entries(o)[0];
          if (a[k] < b[k]) return dir === 'desc' ? 1 : -1;
          if (a[k] > b[k]) return dir === 'desc' ? -1 : 1;
        }
        return 0;
      });
      return rows.map((u) => ({ ...u }));
    },
    async findUnique({ where: { id } }) { const u = userRows.find((x) => x.id === id); return u ? { ...u } : null; },
    async update({ where: { id }, data }) {
      const u = userRows.find((x) => x.id === id);
      if (!u) throw new Error('no user');
      Object.assign(u, data);
      return { ...u };
    },
    async aggregate() {
      const max = userRows.reduce((m, u) => (u.userNumber != null && u.userNumber > m ? u.userNumber : m), 0);
      return { _max: { userNumber: max || null } };
    },
  };

  return { appSequence, user, _users: userRows, _sequences: sequences };
}

describe('allocateNumber — atomic monotonic counter', () => {
  it('hands out 1,2,3,… and never repeats', async () => {
    const c = makeFakeClient();
    const got = [];
    for (let i = 0; i < 5; i++) got.push(await allocateNumber('userNumber', c));
    expect(got).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(got).size).toBe(5);
  });

  it('continues from an existing counter value', async () => {
    const c = makeFakeClient();
    await ensureSequenceAtLeast('userNumber', 100, c);
    expect(await allocateNumber('userNumber', c)).toBe(101);
  });
});

describe('ensureSequenceAtLeast — never lowers', () => {
  it('raises a fresh counter to the floor but keeps a higher existing value', async () => {
    const c = makeFakeClient();
    await ensureSequenceAtLeast('s', 50, c);
    expect((await c.appSequence.findUnique({ where: { name: 's' } })).value).toBe(50);
    await ensureSequenceAtLeast('s', 10, c); // lower floor → no change
    expect((await c.appSequence.findUnique({ where: { name: 's' } })).value).toBe(50);
  });
});

describe('backfillUserNumbers', () => {
  it('assigns numbers in (createdAt,id) order and is idempotent', async () => {
    const c = makeFakeClient([
      { id: 'b', createdAt: '2021-01-02', userNumber: null },
      { id: 'a', createdAt: '2021-01-01', userNumber: null },
      { id: 'c', createdAt: '2021-01-03', userNumber: null },
    ]);
    const r1 = await backfillUserNumbers(c);
    expect(r1.assigned).toBe(3);
    const num = (id) => c._users.find((u) => u.id === id).userNumber;
    expect(num('a')).toBe(1);
    expect(num('b')).toBe(2);
    expect(num('c')).toBe(3);
    // Re-running is a no-op (no reassignment, no duplicates).
    const r2 = await backfillUserNumbers(c);
    expect(r2.assigned).toBe(0);
    expect([num('a'), num('b'), num('c')]).toEqual([1, 2, 3]);
  });

  it('seeds the counter to the current MAX so new numbers never collide', async () => {
    const c = makeFakeClient([
      { id: 'existing', createdAt: '2020-01-01', userNumber: 7 },
      { id: 'new', createdAt: '2021-01-01', userNumber: null },
    ]);
    await backfillUserNumbers(c);
    expect(c._users.find((u) => u.id === 'new').userNumber).toBe(8);
  });
});

describe('ensureUserNumber — never reassigns', () => {
  it('assigns when missing, returns the existing number otherwise', async () => {
    const c = makeFakeClient([{ id: 'u', createdAt: '2020', userNumber: null }]);
    const first = await ensureUserNumber('u', c);
    expect(first).toBe(1);
    const again = await ensureUserNumber('u', c); // already numbered → unchanged
    expect(again).toBe(1);
    expect(c._users[0].userNumber).toBe(1);
  });
});
