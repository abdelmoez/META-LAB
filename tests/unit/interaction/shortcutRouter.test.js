/**
 * shortcutRouter.test.js — 108.md §§23-24. Priority tiers, registration-order
 * tiebreaks, context gating and unregistration. Pure registry + pure routing, so
 * the entire precedence model is asserted without a DOM.
 */
import { describe, it, expect } from 'vitest';
import {
  TIER, ROUTE_REASON, createRegistry, registerBinding, routeKeydown,
  bindingCount, bindingIds,
} from '../../../src/research-engine/interaction/shortcutRouter.js';

const ctrlZ = { key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
const always = () => true;

/** A binding that matches everything, so tests isolate the priority logic. */
const b = (id, tier, over = {}) => ({ id, tier, match: always, ...over });

const ctx = (over = {}) => ({
  scope: 'screening', modalOpen: false, editableTarget: false,
  canUndo: true, canRedo: false, ...over,
});

describe('registerBinding', () => {
  it('registers, counts and unregisters', () => {
    const reg = createRegistry();
    const off = registerBinding(reg, b('undo', TIER.GLOBAL));
    expect(bindingCount(reg)).toBe(1);
    expect(routeKeydown(reg, ctrlZ, ctx()).binding.id).toBe('undo');
    off();
    expect(bindingCount(reg)).toBe(0);
    expect(routeKeydown(reg, ctrlZ, ctx())).toBeNull();
    off();                                   // idempotent
    expect(bindingCount(reg)).toBe(0);
  });

  it('re-registering an id replaces the previous binding (remount safety)', () => {
    const reg = createRegistry();
    registerBinding(reg, b('undo', TIER.GLOBAL, { run: () => 'first' }));
    registerBinding(reg, b('undo', TIER.GLOBAL, { run: () => 'second' }));
    expect(bindingCount(reg)).toBe(1);
    expect(routeKeydown(reg, ctrlZ, ctx()).binding.run()).toBe('second');
  });

  it('an unregister from a replaced registration cannot remove the new one', () => {
    const reg = createRegistry();
    const stale = registerBinding(reg, b('undo', TIER.GLOBAL));
    registerBinding(reg, b('undo', TIER.GLOBAL));
    stale();
    expect(bindingCount(reg)).toBe(1);
  });

  it('ignores invalid declarations instead of throwing', () => {
    const reg = createRegistry();
    expect(typeof registerBinding(reg, null)).toBe('function');
    registerBinding(reg, null);
    registerBinding(reg, { id: '', tier: TIER.GLOBAL, match: always });
    registerBinding(reg, { id: 'x', tier: 9, match: always });          // bad tier
    registerBinding(reg, { id: 'y', tier: TIER.GLOBAL });               // no match fn
    registerBinding(reg, { id: 'z', tier: TIER.GLOBAL, match: 'nope' });
    expect(bindingCount(reg)).toBe(0);
    expect(typeof registerBinding(null, b('a', TIER.GLOBAL))).toBe('function');
  });
});

describe('108.md §24 — the tier precedence matrix', () => {
  it('the lowest tier wins, whatever order they registered in', () => {
    const order = [TIER.GLOBAL, TIER.COMPONENT, TIER.MODAL, TIER.ENGINE, TIER.EDITOR];
    const reg = createRegistry();
    for (const t of order) registerBinding(reg, b(`t${t}`, t));
    expect(routeKeydown(reg, ctrlZ, ctx()).binding.id).toBe('t1');
    expect(bindingIds(reg)).toEqual(['t1', 't2', 't3', 't4', 't5']);
  });

  it('reports the winning tier as the reason', () => {
    const cases = [
      [TIER.MODAL, ROUTE_REASON[1]], [TIER.EDITOR, ROUTE_REASON[2]],
      [TIER.COMPONENT, ROUTE_REASON[3]], [TIER.ENGINE, ROUTE_REASON[4]],
      [TIER.GLOBAL, ROUTE_REASON[5]],
    ];
    for (const [tier, reason] of cases) {
      const reg = createRegistry();
      registerBinding(reg, b('only', tier));
      expect(routeKeydown(reg, ctrlZ, ctx()).reason).toBe(reason);
    }
    expect(ROUTE_REASON[1]).toBe('modal');
    expect(ROUTE_REASON[5]).toBe('global');
  });

  it('each tier beats every higher-numbered tier, pairwise', () => {
    const tiers = [TIER.MODAL, TIER.EDITOR, TIER.COMPONENT, TIER.ENGINE, TIER.GLOBAL];
    for (let i = 0; i < tiers.length; i += 1) {
      for (let j = i + 1; j < tiers.length; j += 1) {
        const reg = createRegistry();
        registerBinding(reg, b('low', tiers[j]));       // registered FIRST, weaker tier
        registerBinding(reg, b('high', tiers[i]));
        expect(routeKeydown(reg, ctrlZ, ctx()).binding.id).toBe('high');
      }
    }
  });

  it('within a tier, the EARLIER registration wins (child effects run first)', () => {
    const reg = createRegistry();
    registerBinding(reg, b('child', TIER.COMPONENT));
    registerBinding(reg, b('parent', TIER.COMPONENT));
    expect(routeKeydown(reg, ctrlZ, ctx()).binding.id).toBe('child');
    expect(bindingIds(reg)).toEqual(['child', 'parent']);
  });
});

describe('match / when gating', () => {
  it('skips a binding whose match declines and falls through to the next', () => {
    const reg = createRegistry();
    registerBinding(reg, b('redo', TIER.COMPONENT, { match: (e) => e.shiftKey === true }));
    registerBinding(reg, b('undo', TIER.GLOBAL, { match: (e) => e.shiftKey === false }));
    expect(routeKeydown(reg, ctrlZ, ctx()).binding.id).toBe('undo');
    expect(routeKeydown(reg, { ...ctrlZ, shiftKey: true }, ctx()).binding.id).toBe('redo');
  });

  it('when(ctx) gates on scope, modal, editable and availability', () => {
    const reg = createRegistry();
    registerBinding(reg, b('screening-undo', TIER.ENGINE, {
      when: (c) => c.scope === 'screening' && !c.modalOpen && !c.editableTarget && c.canUndo,
    }));
    expect(routeKeydown(reg, ctrlZ, ctx()).binding.id).toBe('screening-undo');
    expect(routeKeydown(reg, ctrlZ, ctx({ scope: 'extraction' }))).toBeNull();
    expect(routeKeydown(reg, ctrlZ, ctx({ modalOpen: true }))).toBeNull();
    expect(routeKeydown(reg, ctrlZ, ctx({ editableTarget: true }))).toBeNull();
    expect(routeKeydown(reg, ctrlZ, ctx({ canUndo: false }))).toBeNull();
  });

  it('108.md §7 — with no history the undo binding declines, so the browser keeps Ctrl+Z', () => {
    const reg = createRegistry();
    registerBinding(reg, b('undo', TIER.GLOBAL, { when: (c) => c.canUndo }));
    expect(routeKeydown(reg, ctrlZ, ctx({ canUndo: false }))).toBeNull();
  });

  it('a declining higher-priority binding lets a lower one through', () => {
    const reg = createRegistry();
    registerBinding(reg, b('modal', TIER.MODAL, { when: (c) => c.modalOpen }));
    registerBinding(reg, b('global', TIER.GLOBAL));
    expect(routeKeydown(reg, ctrlZ, ctx()).binding.id).toBe('global');
    expect(routeKeydown(reg, ctrlZ, ctx({ modalOpen: true })).binding.id).toBe('modal');
  });

  it('a throwing match or when never claims the key', () => {
    const reg = createRegistry();
    registerBinding(reg, b('boom-match', TIER.MODAL, { match: () => { throw new Error('x'); } }));
    registerBinding(reg, b('boom-when', TIER.EDITOR, { when: () => { throw new Error('x'); } }));
    registerBinding(reg, b('ok', TIER.GLOBAL));
    expect(routeKeydown(reg, ctrlZ, ctx()).binding.id).toBe('ok');
  });
});

describe('routeKeydown — edges', () => {
  it('returns null for an empty registry, a junk event, or a junk registry', () => {
    expect(routeKeydown(createRegistry(), ctrlZ, ctx())).toBeNull();
    expect(routeKeydown(null, ctrlZ, ctx())).toBeNull();
    const reg = createRegistry();
    registerBinding(reg, b('a', TIER.GLOBAL));
    expect(routeKeydown(reg, null, ctx())).toBeNull();
    expect(routeKeydown(reg, 'z', ctx())).toBeNull();
  });

  it('tolerates a missing context (every field simply reads undefined)', () => {
    const reg = createRegistry();
    registerBinding(reg, b('a', TIER.GLOBAL));
    expect(routeKeydown(reg, ctrlZ).binding.id).toBe('a');
    expect(routeKeydown(reg, ctrlZ, null).binding.id).toBe('a');
  });

  it('ctx.suspended stands the whole router down (the Profile capture screen)', () => {
    const reg = createRegistry();
    registerBinding(reg, b('modal', TIER.MODAL));
    expect(routeKeydown(reg, ctrlZ, ctx({ suspended: true }))).toBeNull();
    expect(routeKeydown(reg, ctrlZ, ctx({ suspended: false })).binding.id).toBe('modal');
  });

  it('carries allowRepeat through to the caller (the adapter enforces it)', () => {
    const reg = createRegistry();
    registerBinding(reg, b('hold', TIER.ENGINE, { allowRepeat: true }));
    expect(routeKeydown(reg, ctrlZ, ctx()).binding.allowRepeat).toBe(true);
    registerBinding(reg, b('hold', TIER.ENGINE));
    expect(routeKeydown(reg, ctrlZ, ctx()).binding.allowRepeat).toBe(false);
  });
});
