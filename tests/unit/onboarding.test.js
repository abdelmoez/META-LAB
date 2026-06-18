/**
 * onboarding.test.js — prompt32 Task 6/7. Pure-logic coverage for the per-question
 * onboarding system: pending computation, per-type answer validation, and the
 * admin question coercion. DB-coupled paths are exercised by the live smoke flow.
 */
import { describe, it, expect } from 'vitest';
import { pendingFromQuestions, validateAnswer, coerceQuestionInput } from '../../server/controllers/onboardingController.js';

const Q = (over = {}) => ({ id: 'q1', key: 'k', prompt: 'p', description: '', type: 'single_select', options: null, isActive: true, isRequired: false, allowSkip: true, displayOrder: 0, ...over });

describe('pendingFromQuestions', () => {
  it('returns active questions the user has neither answered nor skipped', () => {
    const active = [Q({ id: 'a' }), Q({ id: 'b' }), Q({ id: 'c' })];
    const pending = pendingFromQuestions(active, new Set(['b']));
    expect(pending.map(p => p.id)).toEqual(['a', 'c']);
  });
  it('a newly-added question appears even when others are all responded', () => {
    const active = [Q({ id: 'old' }), Q({ id: 'new' })];
    const pending = pendingFromQuestions(active, new Set(['old']));
    expect(pending.map(p => p.id)).toEqual(['new']); // new questions reach existing users
  });
  it('empty when everything is responded', () => {
    expect(pendingFromQuestions([Q({ id: 'a' })], new Set(['a']))).toEqual([]);
  });
  it('accepts a plain array of responded ids too', () => {
    expect(pendingFromQuestions([Q({ id: 'a' }), Q({ id: 'b' })], ['a']).map(p => p.id)).toEqual(['b']);
  });
});

describe('validateAnswer', () => {
  it('single_select accepts a listed option, rejects an unlisted one', () => {
    const q = Q({ type: 'single_select', options: JSON.stringify([{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]) });
    expect(validateAnswer(q, 'x')).toEqual({ ok: true, value: 'x' });
    expect(validateAnswer(q, 'z').ok).toBe(false);
  });
  it('required text rejects empty, accepts non-empty', () => {
    const q = Q({ type: 'text', isRequired: true });
    expect(validateAnswer(q, '   ').ok).toBe(false);
    expect(validateAnswer(q, 'hello')).toEqual({ ok: true, value: 'hello' });
  });
  it('multi_select keeps only listed options', () => {
    const q = Q({ type: 'multi_select', options: JSON.stringify([{ value: 'a' }, { value: 'b' }]) });
    expect(validateAnswer(q, ['a', 'b', 'zzz']).value).toEqual(['a', 'b']);
  });
  it('boolean coerces truthy strings', () => {
    expect(validateAnswer(Q({ type: 'boolean' }), 'true').value).toBe(true);
    expect(validateAnswer(Q({ type: 'boolean' }), false).value).toBe(false);
  });
  it('number rejects non-finite as null when optional', () => {
    expect(validateAnswer(Q({ type: 'number' }), 'abc').value).toBe(null);
    expect(validateAnswer(Q({ type: 'number' }), '42').value).toBe(42);
  });
});

describe('coerceQuestionInput', () => {
  it('falls back to single_select for an unknown type and serialises options', () => {
    const out = coerceQuestionInput({ prompt: 'Q?', type: 'bogus', options: [{ value: 'a', label: 'A' }] });
    expect(out.type).toBe('single_select');
    expect(JSON.parse(out.options)).toEqual([{ value: 'a', label: 'A' }]);
  });
  it('text type carries no options blob', () => {
    const out = coerceQuestionInput({ prompt: 'Free text', type: 'text' });
    expect(out.options).toBe(null);
  });
  it('respects isActive/isRequired/allowSkip flags', () => {
    const out = coerceQuestionInput({ prompt: 'P', type: 'text', isActive: false, isRequired: true, allowSkip: false });
    expect(out).toMatchObject({ isActive: false, isRequired: true, allowSkip: false });
  });
});
