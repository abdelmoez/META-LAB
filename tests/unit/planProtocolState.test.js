/**
 * planProtocolState.test.js — pure Plan & Protocol module mappers (prompt46 #1).
 */
import { describe, it, expect } from 'vitest';
import {
  pickPlanProtocol, applyPlanProtocol, isBlankPlanProtocol,
  PLAN_PROTOCOL_FIELD_IDS, PLAN_PROTOCOL_DEFAULTS,
} from '../../src/features/planProtocol/planProtocolState.js';

describe('pickPlanProtocol', () => {
  it('reads the legacy nested project.prospero.fields shape', () => {
    const project = { prospero: { fields: { title: 'My review', synthesis: 'random-effects' }, generatedAt: '2024-01-01' } };
    const out = pickPlanProtocol(project);
    expect(out.title).toBe('My review');
    expect(out.synthesis).toBe('random-effects');
    expect(out.generatedAt).toBe('2024-01-01');
  });
  it('reads the new flat shape and prefers it over legacy nested', () => {
    const project = { prospero: { fields: { title: 'old' }, title: 'new', draft: '# Draft' } };
    const out = pickPlanProtocol(project);
    expect(out.title).toBe('new');     // flat wins
    expect(out.draft).toBe('# Draft');
  });
  it('handles a missing prospero blob', () => {
    expect(pickPlanProtocol({})).toEqual({});
    expect(pickPlanProtocol(null)).toEqual({});
  });
  it('only forwards declared field ids (no arbitrary keys)', () => {
    const project = { prospero: { title: 'T', hacker: 'x', __proto__: { polluted: true } } };
    const out = pickPlanProtocol(project);
    expect(out.title).toBe('T');
    expect(out.hacker).toBeUndefined();
  });
});

describe('applyPlanProtocol (blob mirror)', () => {
  it('merges a patch onto project.prospero, preserving legacy keys and other project keys', () => {
    const project = { id: 'x', studies: [1], prospero: { fields: { title: 'keep' }, draft: 'old' } };
    const merged = applyPlanProtocol(project, { draft: 'new', title: 'T' });
    expect(merged.id).toBe('x');
    expect(merged.studies).toEqual([1]);
    expect(merged.prospero.fields).toEqual({ title: 'keep' }); // legacy nested untouched
    expect(merged.prospero.draft).toBe('new');
    expect(merged.prospero.title).toBe('T');
  });
});

describe('isBlankPlanProtocol', () => {
  it('treats empty state as blank', () => {
    expect(isBlankPlanProtocol({})).toBe(true);
    expect(isBlankPlanProtocol({ title: '', draft: '   ' })).toBe(true);
  });
  it('treats any field or draft content as non-blank', () => {
    expect(isBlankPlanProtocol({ title: 'A review' })).toBe(false);
    expect(isBlankPlanProtocol({ draft: '# Protocol' })).toBe(false);
  });
});

describe('contract', () => {
  it('defaults cover every field id plus the draft meta keys', () => {
    for (const id of PLAN_PROTOCOL_FIELD_IDS) expect(PLAN_PROTOCOL_DEFAULTS[id]).toBe('');
    expect(PLAN_PROTOCOL_DEFAULTS.draft).toBe('');
    expect(PLAN_PROTOCOL_DEFAULTS.draftEditedManually).toBe(false);
  });
});
