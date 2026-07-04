import { describe, it, expect } from 'vitest';
import { decideWrite, canWriteSilently, originRank } from '../../../src/research-engine/extraction/valuePrecedence.js';
import {
  mkSourceIdentity,
  identityOf,
  reconcileDrafts,
  stampIdentity,
} from '../../../src/research-engine/extraction/draftReconcile.js';

describe('valuePrecedence.decideWrite (§27 / §4.3)', () => {
  it('writes into an empty field', () => {
    const d = decideWrite({ existingValue: '', incoming: '2.24', incomingOrigin: 'click' });
    expect(d.action).toBe('write');
    expect(canWriteSilently(d)).toBe(true);
  });

  it('machine value NEVER silently overwrites a user-typed value → propose-replace', () => {
    const d = decideWrite({ existingValue: '2.10', existingOrigin: 'user-typed', incoming: '2.24', incomingOrigin: 'click' });
    expect(d.action).toBe('propose-replace');
    expect(canWriteSilently(d)).toBe(false);
  });

  it('a human write overrides any existing value', () => {
    const d = decideWrite({ existingValue: '2.10', existingOrigin: 'machine', incoming: '2.24', incomingOrigin: 'user-typed' });
    expect(d.action).toBe('write');
  });

  it('identical value already present → keep-existing (idempotent)', () => {
    const d = decideWrite({ existingValue: '2.24', existingOrigin: 'machine', incoming: '2.24', incomingOrigin: 'click' });
    expect(d.action).toBe('keep-existing');
  });

  it('a different machine value over an existing machine draft → add-alternative', () => {
    const d = decideWrite({ existingValue: '2.10', existingOrigin: 'auto', incoming: '2.24', incomingOrigin: 'table' });
    expect(d.action).toBe('add-alternative');
  });

  it('a weaker human origin does NOT silently overwrite a stronger one (F7 ladder)', () => {
    // user-confirmed (rank 3) must not clobber user-typed (rank 1)
    const d = decideWrite({ existingValue: '0.42', existingOrigin: 'user-typed', incoming: '0.55', incomingOrigin: 'user-confirmed' });
    expect(d.action).toBe('propose-replace');
    // but a stronger human origin over a weaker one writes
    const d2 = decideWrite({ existingValue: '0.42', existingOrigin: 'user-confirmed', incoming: '0.55', incomingOrigin: 'user-typed' });
    expect(d2.action).toBe('write');
  });

  it('empty incoming is a no-op', () => {
    const d = decideWrite({ existingValue: '2.10', existingOrigin: 'user-typed', incoming: '' });
    expect(d.action).toBe('keep-existing');
  });

  it('origin ranks: human always outranks machine', () => {
    expect(originRank('user-typed')).toBeLessThan(originRank('machine'));
    expect(originRank('user-corrected')).toBeLessThan(originRank('machine'));
    expect(originRank('click')).toBe(originRank('machine'));
    expect(originRank(null)).toBe(originRank('empty'));
  });

  it('never throws on malformed input', () => {
    expect(() => decideWrite()).not.toThrow();
    expect(() => decideWrite({})).not.toThrow();
  });
});

describe('draftReconcile — stable identity + idempotent merge (§10.5 / §19.10 / §4.4)', () => {
  const prov = (extra) => ({
    provenance: { method: 'table', page: 6, region: { x0: 10, y0: 20, x1: 100, y1: 40 }, rowIndex: 3, parserVersion: 'v1', pdfFingerprint: 'FP', ...extra },
    scope: { outcomeId: 'o1' },
    timepoint: '30-day',
  });

  it('mkSourceIdentity is deterministic and source-derived (not random)', () => {
    const a = mkSourceIdentity({ pdfFingerprint: 'FP', page: 6, rowIndex: 3, method: 'table', outcomeId: 'o1' });
    const b = mkSourceIdentity({ pdfFingerprint: 'FP', page: 6, rowIndex: 3, method: 'table', outcomeId: 'o1' });
    expect(a).toBe(b);
    expect(a).toMatch(/^src_/);
    const c = mkSourceIdentity({ pdfFingerprint: 'FP', page: 7, rowIndex: 3, method: 'table', outcomeId: 'o1' });
    expect(c).not.toBe(a);
  });

  it('sub-pixel region jitter does not change identity', () => {
    const r1 = identityOf(prov({}));
    const r2 = identityOf({ ...prov({}), provenance: { ...prov({}).provenance, region: { x0: 10.3, y0: 19.8, x1: 100.2, y1: 40.1 } } });
    expect(r1).toBe(r2);
  });

  it('rerun over unchanged source produces the same state (idempotent — no duplicates)', () => {
    const first = [prov({}), prov({ rowIndex: 4 })].map((r, i) => ({ id: 'x' + i, ...r }));
    const second = [prov({}), prov({ rowIndex: 4 })].map((r, i) => ({ id: 'y' + i, ...r }));
    const { drafts, added, skipped } = reconcileDrafts(first, second);
    expect(drafts.length).toBe(2);
    expect(added.length).toBe(0);
    expect(skipped.length).toBe(2);
  });

  it('a genuinely new finding is appended', () => {
    const first = [{ id: 'a', ...prov({}) }];
    const second = [{ id: 'b', ...prov({ rowIndex: 9 }) }];
    const { drafts, added } = reconcileDrafts(first, second);
    expect(drafts.length).toBe(2);
    expect(added.length).toBe(1);
  });

  it('a dismissed identity is NOT resurrected', () => {
    const dismissedId = identityOf(prov({}));
    const { drafts, suppressed } = reconcileDrafts([], [{ id: 'a', ...prov({}) }], { dismissedIdentities: [dismissedId] });
    expect(drafts.length).toBe(0);
    expect(suppressed.length).toBe(1);
  });

  it('existing human-edited record is preserved on rerun; a value edit does NOT spawn a duplicate', () => {
    // A draft is stamped when first added (frozen identity from its ORIGINAL value 2.24),
    // then the reviewer edits the value to 9.99 — the stamp stays. On rerun the fresh
    // draft (original value 2.24) resolves to the SAME frozen identity → deduped.
    const original = { id: 'a', ...prov({}), values: { es: '2.24' } };
    const edited = { ...stampIdentity(original), values: { es: '9.99' }, provenance: { ...stampIdentity(original).provenance, userCorrected: true } };
    const fresh = { id: 'b', ...prov({}), values: { es: '2.24' } };
    const { drafts, added } = reconcileDrafts([edited], [fresh]);
    expect(drafts.length).toBe(1);           // no duplicate
    expect(added.length).toBe(0);
    expect(drafts[0].values.es).toBe('9.99'); // human edit survives
  });

  it('distinct rows from the SAME table region do NOT collapse (no data loss)', () => {
    const base = { provenance: { method: 'table', page: 6, region: { x0: 10, y0: 20, x1: 300, y1: 200 }, parserVersion: 'v1', pdfFingerprint: 'FP' }, scope: { outcomeId: '' }, timepoint: '' };
    const rowA = { id: 'a', ...base, values: { es: '0.80', lo: '0.65', hi: '0.98' }, provenance: { ...base.provenance, excerpt: 'AKI' } };
    const rowB = { id: 'b', ...base, values: { es: '1.20', lo: '0.90', hi: '1.60' }, provenance: { ...base.provenance, excerpt: 'Sepsis' } };
    const rowC = { id: 'c', ...base, values: { es: '2.10', lo: '1.50', hi: '2.94' }, provenance: { ...base.provenance, excerpt: 'LOS' } };
    const { drafts } = reconcileDrafts([], [rowA, rowB, rowC]);
    expect(drafts.length).toBe(3); // all three kept — distinct values ⇒ distinct identity
  });

  it('re-scoping a draft (outcome/timepoint) does NOT change its identity', () => {
    const d = stampIdentity({ ...prov({}), values: { es: '0.8' }, scope: { outcomeId: '' }, timepoint: '' });
    const id1 = identityOf(d);
    const rescoped = { ...d, scope: { outcomeId: 'mortality' }, timepoint: '30-day' };
    expect(identityOf(rescoped)).toBe(id1); // stamped identity is frozen
  });

  it('AI drafts get a real identity (not misclassified as manual)', () => {
    const ai = { provenance: { method: 'ai', excerpt: 'HR 0.8' }, values: { es: '-0.22' }, scope: {} };
    expect(identityOf(ai)).not.toBe('');
  });

  it('manual records with no source facts never dedupe (identity empty)', () => {
    expect(identityOf({ provenance: { method: 'manual' } })).toBe('');
  });
});
