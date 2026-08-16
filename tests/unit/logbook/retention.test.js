/**
 * 119.md §8 — the Logbook retention policy. The load-bearing assertion is the
 * NEGATIVE one: no configuration of this module may delete an accountability
 * event (membership / permissions / ownership / deletion / Logbook access).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const db = { rows: [] };

function matches(row, where = {}) {
  for (const [k, cond] of Object.entries(where)) {
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('lte' in cond && !(v <= cond.lte)) return false;
      if ('lt' in cond && !(v < cond.lt)) return false;
      if ('in' in cond && !cond.in.includes(v)) return false;
    } else if (v !== cond) return false;
  }
  return true;
}

const prisma = {
  projectLogEvent: {
    async findMany({ where = {}, orderBy = {}, take = 100 }) {
      let rows = db.rows.filter((r) => matches(r, where));
      if (orderBy.id === 'asc') rows = rows.sort((a, b) => a.id - b.id);
      return rows.slice(0, take).map((r) => ({ id: r.id }));
    },
    async deleteMany({ where }) {
      const before = db.rows.length;
      db.rows = db.rows.filter((r) => !matches(r, where));
      return { count: before - db.rows.length };
    },
    async count({ where }) { return db.rows.filter((r) => matches(r, where)).length; },
  },
};

vi.mock('../../../server/db/client.js', () => ({ prisma }));

const R = await import('../../../server/logbook/retention.js');
const { LOG_SEVERITY } = await import('../../../server/logbook/vocabulary.js');

const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

let id = 0;
const row = (severity, ageDays, projectId = 'sp1') => {
  const r = { id: ++id, projectId, severity, createdAt: daysAgo(ageDays) };
  db.rows.push(r);
  return r;
};

beforeEach(() => { db.rows = []; id = 0; });

describe('retention policy', () => {
  it('prunes only OLD, low-severity rows', async () => {
    row(LOG_SEVERITY.ROUTINE, 500);   // 1: prunable, old       → deleted
    row(LOG_SEVERITY.NOISE, 500);     // 2: prunable, old       → deleted
    row(LOG_SEVERITY.ROUTINE, 10);    // 3: prunable, recent    → kept
    row(LOG_SEVERITY.NOTABLE, 500);   // 4: severity 2, old     → kept
    const out = await R.pruneProjectLogbook('sp1');
    expect(out.byAge).toBe(2);
    expect(db.rows.map((r) => r.id).sort()).toEqual([3, 4]);
  });

  it('NEVER deletes an accountability event, at any age or cap', async () => {
    for (const sev of [LOG_SEVERITY.SENSITIVE, LOG_SEVERITY.CRITICAL, LOG_SEVERITY.IMPORTANT, LOG_SEVERITY.NOTABLE]) {
      row(sev, 5000);
    }
    const out = await R.pruneProjectLogbook('sp1', {
      noiseRetentionDays: 0, maxRowsPerProject: 0, maxDeletePerRun: 10_000,
    });
    expect(out.byAge).toBe(0);
    expect(out.byCap).toBe(0);
    expect(db.rows).toHaveLength(4);
  });

  it('applies the per-project cap to the oldest prunable rows only', async () => {
    for (let i = 0; i < 10; i++) row(LOG_SEVERITY.ROUTINE, 1);   // ids 1..10 (recent)
    row(LOG_SEVERITY.CRITICAL, 1);                                // id 11 (never counted)
    const out = await R.pruneProjectLogbook('sp1', { maxRowsPerProject: 4 });
    expect(out.byAge).toBe(0);           // nothing is old enough
    expect(out.byCap).toBe(6);           // 10 - 4
    expect(db.rows.map((r) => r.id)).toEqual([7, 8, 9, 10, 11]);
  });

  it('never touches another project', async () => {
    row(LOG_SEVERITY.ROUTINE, 500, 'sp1');
    row(LOG_SEVERITY.ROUTINE, 500, 'spOTHER');
    await R.pruneProjectLogbook('sp1');
    expect(db.rows.map((r) => r.projectId)).toEqual(['spOTHER']);
  });

  it('bounds one run so a prune is observable, not a surprise bulk delete', async () => {
    for (let i = 0; i < 50; i++) row(LOG_SEVERITY.ROUTINE, 500);
    const out = await R.pruneProjectLogbook('sp1', { maxDeletePerRun: 10 });
    expect(out.byAge).toBe(10);
    expect(db.rows).toHaveLength(40);
  });

  it('dryRun reports what it WOULD remove and removes nothing', async () => {
    row(LOG_SEVERITY.ROUTINE, 500);
    const out = await R.pruneProjectLogbook('sp1', { dryRun: true });
    expect(out.byAge).toBe(1);
    expect(out.dryRun).toBe(true);
    expect(db.rows).toHaveLength(1);
  });

  it('describeRetention states the policy honestly, including that nothing is scheduled', () => {
    const d = R.describeRetention();
    expect(d.scheduled).toBe(false);
    expect(d.permanent).toMatch(/Membership/);
    expect(d.prunedAfterDays).toBe(R.RETENTION_DEFAULTS.noiseRetentionDays);
    expect(d.scheduleNote).toMatch(/No automatic pruning/);
  });
});
