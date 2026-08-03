/**
 * searchBuilderDndDup.test.js — 97.md. Hermetic unit coverage for the U-side pure
 * models behind the Select & Build Key Terms drag-and-drop and duplicate chips:
 *
 *  - dnd/dndModel.js — pointer hit-testing: drag threshold, insert vs merge zones
 *    (DISTINCT targets — Phase 6), group/new-group zones, merge hover arming,
 *    reorder index normalization, and the question-token span combine;
 *  - dupSignals.js — the per-term duplicate presentation model over the
 *    research-engine exact-duplicate engine (exact-cross dark-red state,
 *    same-group state, soft "Possible variant", intentional overrides,
 *    configuration-scoped dismissals).
 *
 * House style: pure functions only — no DOM, no React, no network.
 */
import { describe, it, expect } from 'vitest';
import {
  DRAG_START_PX, MERGE_HOVER_MS,
  shouldStartDrag, pointInRect, resolveDropTarget, trackMergeHover, mergeArmed,
  normalizeReorderIndex, combineSpanFromTokens,
} from '../../src/features/searchBuilder/dnd/dndModel.js';
import { buildDupModel, exactDupDismissalId } from '../../src/features/searchBuilder/dupSignals.js';
import { applyDupOverride } from '../../src/research-engine/searchBuilder/exactDuplicate.js';

/* ── geometry fixtures ────────────────────────────────────────────────────── */
const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
// Two chips side by side in group g1: A [0..100], B [110..210], both y 0..30.
const GEO = {
  chips: [
    { id: 'a', groupId: 'g1', index: 0, rect: rect(0, 0, 100, 30) },
    { id: 'b', groupId: 'g1', index: 1, rect: rect(110, 0, 210, 30) },
  ],
  groups: [{ id: 'g2', rect: rect(0, 100, 80, 130) }],
  newGroup: { rect: rect(100, 100, 180, 130) },
};

describe('dndModel — drag threshold + rect hit', () => {
  it('shouldStartDrag: a click stays a click until the pointer travels the threshold', () => {
    expect(shouldStartDrag({ x: 0, y: 0 }, { x: DRAG_START_PX - 1, y: 0 })).toBe(false);
    expect(shouldStartDrag({ x: 0, y: 0 }, { x: DRAG_START_PX, y: 0 })).toBe(true);
    expect(shouldStartDrag({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true); // 5px diagonal
    expect(shouldStartDrag(null, { x: 99, y: 99 })).toBe(false);
  });
  it('pointInRect is inclusive of edges and junk-safe', () => {
    expect(pointInRect({ x: 0, y: 0 }, rect(0, 0, 10, 10))).toBe(true);
    expect(pointInRect({ x: 10, y: 10 }, rect(0, 0, 10, 10))).toBe(true);
    expect(pointInRect({ x: 11, y: 5 }, rect(0, 0, 10, 10))).toBe(false);
    expect(pointInRect(null, rect(0, 0, 10, 10))).toBe(false);
  });
});

describe('dndModel.resolveDropTarget — insert vs merge are DISTINCT targets (Phase 6)', () => {
  it('the chip CENTRE resolves to a merge target (excluding the dragged chip itself)', () => {
    const t = resolveDropTarget(GEO, { x: 160, y: 15 }, { dragId: 'a' }); // centre of B
    expect(t).toEqual({ kind: 'merge', targetId: 'b', groupId: 'g1' });
    // the dragged chip's own centre never merges with itself → insert instead
    const self = resolveDropTarget(GEO, { x: 50, y: 15 }, { dragId: 'a' });
    expect(self.kind).toBe('insert');
  });
  it('the chip EDGES resolve to insertion positions (before / after)', () => {
    expect(resolveDropTarget(GEO, { x: 112, y: 15 }, { dragId: 'a' }))
      .toEqual({ kind: 'insert', groupId: 'g1', index: 1 }); // left edge of B → before B
    expect(resolveDropTarget(GEO, { x: 208, y: 15 }, { dragId: 'a' }))
      .toEqual({ kind: 'insert', groupId: 'g1', index: 2 }); // right edge of B → after B
  });
  it('the gap BETWEEN chips resolves to the nearest insertion index', () => {
    const t = resolveDropTarget(GEO, { x: 105, y: 15 }, { dragId: 'b' });
    expect(t.kind).toBe('insert');
    expect(t.groupId).toBe('g1');
    expect(t.index === 1).toBe(true); // between A and B
  });
  it('another group\'s pill zone wins over chips → { kind:"group" }', () => {
    expect(resolveDropTarget(GEO, { x: 40, y: 115 }, { dragId: 'a' }))
      .toEqual({ kind: 'group', groupId: 'g2' });
  });
  it('the New-group zone resolves to { kind:"new-group" }', () => {
    expect(resolveDropTarget(GEO, { x: 140, y: 115 }, { dragId: 'a' }))
      .toEqual({ kind: 'new-group' });
  });
  it('outside every zone → null (the drop cancels; nothing is deleted)', () => {
    expect(resolveDropTarget(GEO, { x: 500, y: 500 }, { dragId: 'a' })).toBeNull();
    expect(resolveDropTarget({ chips: [] }, { x: 1, y: 1 }, {})).toBeNull();
  });
});

describe('dndModel — merge hover arming (accidental merges stay hard)', () => {
  it('arms only after MERGE_HOVER_MS on the SAME target', () => {
    let hover = trackMergeHover(null, { kind: 'merge', targetId: 'b' }, 1000);
    expect(hover).toEqual({ targetId: 'b', since: 1000 });
    expect(mergeArmed(hover, 1000 + MERGE_HOVER_MS - 1)).toBe(false);
    expect(mergeArmed(hover, 1000 + MERGE_HOVER_MS)).toBe(true);
  });
  it('keeps the original timestamp while hovering the same target; resets on a new one', () => {
    let hover = trackMergeHover(null, { kind: 'merge', targetId: 'b' }, 1000);
    hover = trackMergeHover(hover, { kind: 'merge', targetId: 'b' }, 1200);
    expect(hover.since).toBe(1000);
    hover = trackMergeHover(hover, { kind: 'merge', targetId: 'c' }, 1300);
    expect(hover).toEqual({ targetId: 'c', since: 1300 });
  });
  it('leaving the merge zone clears the hover state', () => {
    const hover = trackMergeHover({ targetId: 'b', since: 1000 }, { kind: 'insert', groupId: 'g1', index: 1 }, 1400);
    expect(hover).toBeNull();
    expect(mergeArmed(null, 99999)).toBe(false);
  });
});

describe('dndModel.normalizeReorderIndex — removing-before-inserting arithmetic', () => {
  it('moving forward shifts the insertion index down by one', () => {
    expect(normalizeReorderIndex(0, 3)).toBe(2);
    expect(normalizeReorderIndex(1, 2)).toBe(null); // lands where it already is
  });
  it('moving backward keeps the raw index; no-ops return null', () => {
    expect(normalizeReorderIndex(3, 1)).toBe(1);
    expect(normalizeReorderIndex(2, 2)).toBe(null);
    expect(normalizeReorderIndex(0, 0)).toBe(null);
    expect(normalizeReorderIndex(0, 1)).toBe(null); // "after itself" is the same slot
  });
});

describe('dndModel.combineSpanFromTokens — the Phase 5 phrase-building example', () => {
  const tokens = [
    { text: 'sodium-glucose' }, { text: 'cotransporter' }, { text: '2' }, { text: 'inhibitors' },
  ];
  it('combines the contiguous span in SEMANTIC order, either drag direction', () => {
    expect(combineSpanFromTokens(tokens, 0, 2)).toEqual({
      text: 'sodium-glucose cotransporter 2',
      components: [{ text: 'sodium-glucose' }, { text: 'cotransporter' }, { text: '2' }],
    });
    // dragging backwards (3 → 0) still yields the reading-order phrase
    expect(combineSpanFromTokens(tokens, 3, 0).text).toBe('sodium-glucose cotransporter 2 inhibitors');
  });
  it('normalizes repeated whitespace and preserves hyphens', () => {
    const messy = [{ text: '  sodium-glucose  ' }, { text: ' cotransporter ' }];
    expect(combineSpanFromTokens(messy, 0, 1)).toEqual({
      text: 'sodium-glucose cotransporter',
      components: [{ text: 'sodium-glucose' }, { text: 'cotransporter' }],
    });
  });
  it('returns null for a single token, same indices, or out-of-range input', () => {
    expect(combineSpanFromTokens(tokens, 1, 1)).toBeNull();
    expect(combineSpanFromTokens(tokens, -1, 2)).toBeNull();
    expect(combineSpanFromTokens(tokens, 0, 99)).toBeNull();
    expect(combineSpanFromTokens([], 0, 1)).toBeNull();
  });
});

/* ── dupSignals — the per-term duplicate presentation model ───────────────── */
const term = (id, text, extra = {}) => ({ id, text, type: 'freetext', field: 'tiab', ...extra });
const group = (id, label, terms) => ({ id, label, op: 'AND', terms });

describe('dupSignals.buildDupModel — exact cross-group duplicates (dark-red path)', () => {
  const concepts = [
    group('g1', 'Search Group 1', [term('a1', 'EUS'), term('a2', 'endosonography')]),
    group('g2', 'Search Group 2', [term('b1', '“eus”'), term('b2', 'drainage')]),
  ];
  it('marks EVERY affected chip with kind exact-cross, the shared key and the others list', () => {
    const { byTermId } = buildDupModel({ concepts });
    expect(byTermId.a1).toBeTruthy();
    expect(byTermId.b1).toBeTruthy();
    expect(byTermId.a1.kind).toBe('exact-cross');
    expect(byTermId.b1.kind).toBe('exact-cross');
    expect(byTermId.a1.key).toBe('eus'); // case + curly quotes normalized (conservative)
    expect(byTermId.a1.groupIds).toEqual(['g1', 'g2']);
    expect(byTermId.a1.others).toEqual([{ conceptId: 'g2', conceptLabel: 'Search Group 2', termId: 'b1', termText: '“eus”' }]);
    // unrelated terms carry NO signal
    expect(byTermId.a2).toBeUndefined();
    expect(byTermId.b2).toBeUndefined();
  });
  it('97: distinct clinical phrases are NEVER exact duplicates', () => {
    const distinct = [
      group('g1', 'One', [term('x1', 'EUS')]),
      group('g2', 'Two', [term('x2', 'EUS-guided biliary drainage')]),
    ];
    const { byTermId } = buildDupModel({ concepts: distinct });
    expect(byTermId.x1?.kind).not.toBe('exact-cross');
    expect(byTermId.x2?.kind).not.toBe('exact-cross');
  });
  it('a configuration-scoped dismissal mutes the pair (dismissed flag on both chips)', () => {
    const { byTermId } = buildDupModel({ concepts, dismissed: [exactDupDismissalId('eus')] });
    expect(byTermId.a1.dismissed).toBe(true);
    expect(byTermId.b1.dismissed).toBe(true);
  });
  it('disabled terms are invisible to duplicate detection (liveness rule)', () => {
    const off = [
      group('g1', 'One', [term('x1', 'EUS')]),
      group('g2', 'Two', [term('x2', 'EUS', { disabled: true })]),
    ];
    expect(buildDupModel({ concepts: off }).byTermId.x1).toBeUndefined();
  });
});

describe('dupSignals — intentional overrides (dupOverride) and their auto-reevaluation', () => {
  const base = [
    group('g1', 'One', [term('a1', 'EUS')]),
    group('g2', 'Two', [term('b1', 'eus')]),
  ];
  it('an active override flips every copy to intentional (warning muted, badge shown)', () => {
    const { concepts: kept } = applyDupOverride(base, 'eus');
    const { byTermId } = buildDupModel({ concepts: kept });
    expect(byTermId.a1.intentional).toBe(true);
    expect(byTermId.b1.intentional).toBe(true);
  });
  it('a THIRD copy invalidates the stored override (the warning re-fires)', () => {
    const { concepts: kept } = applyDupOverride(base, 'eus');
    const withThird = [...kept, group('g3', 'Three', [term('c1', 'EUS')])];
    const { byTermId } = buildDupModel({ concepts: withThird });
    expect(byTermId.a1.intentional).toBe(false);
    expect(byTermId.c1.kind).toBe('exact-cross');
  });
  it('editing the term text invalidates the override (key changed)', () => {
    const { concepts: kept } = applyDupOverride(base, 'eus');
    const edited = kept.map((c) => (c.id === 'g1'
      ? { ...c, terms: c.terms.map((t) => (t.id === 'a1' ? { ...t, text: 'EUS-FNA' } : t)) }
      : c));
    const { byTermId } = buildDupModel({ concepts: edited });
    // No EXACT duplicate remains (keys differ), so the override is moot; at most
    // the SOFT family-variant hint applies ("EUS-FNA" still maps to the EUS
    // family) — never the dark-red exact state, never "intentional".
    expect(byTermId.a1 ? byTermId.a1.kind : undefined).not.toBe('exact-cross');
    expect(byTermId.b1 ? byTermId.b1.kind : undefined).not.toBe('exact-cross');
    expect(byTermId.a1 ? byTermId.a1.intentional : false).toBe(false);
  });
});

describe('dupSignals — same-group exact duplicates + soft family variants', () => {
  it('legacy same-group copies get kind exact-in-group (both chips)', () => {
    const concepts = [group('g1', 'One', [term('a1', 'EUS'), term('a2', '"EUS"'), term('a3', 'other')])];
    const { byTermId } = buildDupModel({ concepts });
    expect(byTermId.a1.kind).toBe('exact-in-group');
    expect(byTermId.a2.kind).toBe('exact-in-group');
    expect(byTermId.a1.others[0].termId).toBe('a2');
    expect(byTermId.a3).toBeUndefined();
  });
  it('family equivalents (EUS vs endoscopic ultrasound) are a SOFT variant, never exact', () => {
    const concepts = [
      group('g1', 'One', [term('a1', 'EUS')]),
      group('g2', 'Two', [term('b1', 'endoscopic ultrasound')]),
    ];
    const { byTermId } = buildDupModel({ concepts });
    expect(byTermId.a1.kind).toBe('variant');
    expect(byTermId.b1.kind).toBe('variant');
    expect(byTermId.a1.id).toMatch(/^multi:/); // legacy dismissal ids keep working
  });
  it('a legacy multi: dismissal silences ONLY the soft variant signal', () => {
    const concepts = [
      group('g1', 'One', [term('a1', 'EUS')]),
      group('g2', 'Two', [term('b1', 'endoscopic ultrasound')]),
    ];
    const famId = buildDupModel({ concepts }).byTermId.a1.id;
    const { byTermId } = buildDupModel({ concepts, dismissed: [famId] });
    expect(byTermId.a1).toBeUndefined();
    expect(byTermId.b1).toBeUndefined();
  });
  it('an exact signal always wins over the variant signal on the same chip', () => {
    const concepts = [
      group('g1', 'One', [term('a1', 'EUS')]),
      group('g2', 'Two', [term('b1', 'eus'), term('b2', 'endoscopic ultrasound')]),
    ];
    const { byTermId } = buildDupModel({ concepts });
    expect(byTermId.a1.kind).toBe('exact-cross');
    expect(byTermId.b1.kind).toBe('exact-cross');
  });
});

/* ══════════ 97 QA M15 — the QUESTION-TOKEN tray is mergeOnly (no reorder) ═════ */
describe('dndModel.resolveDropTarget — mergeOnly (the question-token tray, QA M15)', () => {
  it('the WHOLE chip resolves to merge (edges included — combine is easier to hit)', () => {
    expect(resolveDropTarget(GEO, { x: 160, y: 15 }, { dragId: 'a', mergeOnly: true }))
      .toEqual({ kind: 'merge', targetId: 'b', groupId: 'g1' }); // centre of B
    expect(resolveDropTarget(GEO, { x: 112, y: 15 }, { dragId: 'a', mergeOnly: true }))
      .toEqual({ kind: 'merge', targetId: 'b', groupId: 'g1' }); // left EDGE of B — merge, never insert
  });
  it('NEVER resolves an insert target: gaps and the dragged chip itself are null', () => {
    // The source sentence's order is fixed — a reorder signal here would promise
    // a drop the tray does not perform (the old silent no-op).
    expect(resolveDropTarget(GEO, { x: 105, y: 15 }, { dragId: 'b', mergeOnly: true })).toBeNull(); // gap
    expect(resolveDropTarget(GEO, { x: 50, y: 15 }, { dragId: 'a', mergeOnly: true })).toBeNull();  // own chip
  });
  it('the full model is untouched when mergeOnly is off (default)', () => {
    expect(resolveDropTarget(GEO, { x: 112, y: 15 }, { dragId: 'a' }).kind).toBe('insert');
  });
});
