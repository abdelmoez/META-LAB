/**
 * engine-version-service.test.js — DB-backed engine version registry (54.md
 * Part 4/5/7). Exercises the real Prisma client against the local SQLite DB:
 * seeding, minor/major increments, idempotency (same changeKey is a no-op), and
 * history recording. NOT part of the hermetic CI gate (it touches the DB); run via
 * `npm run test:integration`. Resilient to pre-existing DB state (asserts on
 * RELATIVE increments + unique change keys), so re-runs stay green.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  seedEngines, listEngines, getEngine, getHistory, applyBump,
} from '../../server/engineVersion/engineVersionService.js';
import { formatVersion, bumpVersion } from '../../src/research-engine/engine-registry/index.js';

const uniq = () => `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('engine version service (DB)', () => {
  beforeAll(async () => {
    await seedEngines();
  });

  it('seeds the full catalog (every engine present)', async () => {
    const engines = await listEngines();
    expect(engines.length).toBeGreaterThanOrEqual(11);
    const ids = engines.map((e) => e.id);
    for (const id of ['screening', 'meta-analysis', 'network-meta-analysis', 'risk-of-bias', 'validation']) {
      expect(ids).toContain(id);
    }
    // Every engine renders a structural v{major}.{minor}.
    for (const e of engines) expect(e.version).toMatch(/^v\d+\.\d+$/);
  });

  it('applies a MINOR bump (minor += 1) and records history', async () => {
    const before = await getEngine('validation');
    const key = uniq();
    const res = await applyBump({ engineId: 'validation', type: 'minor', summary: 'unit minor', changeKey: key });
    expect(res.ok).toBe(true);
    const after = await getEngine('validation');
    expect(after.major).toBe(before.major);
    expect(after.minor).toBe(before.minor + 1);
    expect(after.version).toBe(formatVersion(bumpVersion(before, 'minor')));
    const hist = await getHistory('validation', 5);
    expect(hist[0].next).toBe(after.version);
    expect(hist[0].changeSummary).toBe('unit minor');
  });

  it('is IDEMPOTENT for a repeated changeKey (no double increment)', async () => {
    const key = uniq();
    const r1 = await applyBump({ engineId: 'import-export', type: 'minor', summary: 'dup test', changeKey: key });
    expect(r1.ok).toBe(true);
    const mid = await getEngine('import-export');
    const r2 = await applyBump({ engineId: 'import-export', type: 'minor', summary: 'dup test', changeKey: key });
    expect(r2.ok).toBe(true);
    expect(r2.skipped).toBe(true);
    const after = await getEngine('import-export');
    expect(after.version).toBe(mid.version); // unchanged by the duplicate
  });

  it('applies a MAJOR bump (major += 1, minor → 0)', async () => {
    const before = await getEngine('data-extraction');
    const res = await applyBump({ engineId: 'data-extraction', type: 'major', summary: 'unit major', changeKey: uniq() });
    expect(res.ok).toBe(true);
    const after = await getEngine('data-extraction');
    expect(after.major).toBe(before.major + 1);
    expect(after.minor).toBe(0);
  });

  it('rejects an unknown engine id without mutating anything', async () => {
    const res = await applyBump({ engineId: 'totally-fake-engine', type: 'minor', summary: 'x', changeKey: uniq() });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown engine/i);
  });

  it('rejects an empty summary', async () => {
    const res = await applyBump({ engineId: 'screening', type: 'minor', summary: '   ', changeKey: uniq() });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/summary/i);
  });

  it('re-seeding preserves existing versions (never resets)', async () => {
    const before = await getEngine('validation'); // already bumped above
    await seedEngines();
    const after = await getEngine('validation');
    expect(after.version).toBe(before.version);
  });
});
