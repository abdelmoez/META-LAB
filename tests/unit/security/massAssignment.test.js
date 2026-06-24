/**
 * massAssignment.test.js — mass-assignment / object-injection guard (prompt 53,
 * WS5). The admin onboarding update spreads `{...existing, ...req.body}` into
 * coerceQuestionInput before Prisma. This pins the invariant that the coercer is
 * a strict ALLOWLIST: only known question fields survive, so a client can never
 * smuggle protected columns (id, key, createdAt, __proto__, …) into the update.
 */
import { describe, it, expect } from 'vitest';
import { coerceQuestionInput } from '../../../server/controllers/onboardingController.js';

const ALLOWED = ['prompt', 'description', 'type', 'options', 'isActive', 'isRequired', 'allowSkip', 'displayOrder'];

describe('coerceQuestionInput allowlist (WS5)', () => {
  it('returns ONLY the whitelisted fields, dropping protected/unknown keys', () => {
    const out = coerceQuestionInput({
      prompt: 'Your role?',
      type: 'single_select',
      options: ['A', 'B'],
      // hostile / protected keys that must NOT survive:
      id: 'evil-id',
      key: 'evil_key',
      createdAt: '1999-01-01',
      isAdmin: true,
      userId: 'someone-else',
      __proto__: { polluted: true },
      constructor: { polluted: true },
      arbitraryColumn: 'x',
    });
    expect(Object.keys(out).sort()).toEqual([...ALLOWED].sort());
    expect(out).not.toHaveProperty('id');
    expect(out).not.toHaveProperty('key');
    expect(out).not.toHaveProperty('createdAt');
    expect(out).not.toHaveProperty('isAdmin');
    expect(out).not.toHaveProperty('userId');
    expect(out).not.toHaveProperty('arbitraryColumn');
    // no prototype pollution leaked onto the result
    expect({}.polluted).toBeUndefined();
  });

  it('type-coerces unknown question types and bounds string lengths', () => {
    const out = coerceQuestionInput({ prompt: 'x'.repeat(9999), type: 'nonsense' });
    expect(out.type).toBe('single_select');
    expect(out.prompt.length).toBeLessThanOrEqual(500);
  });
});
