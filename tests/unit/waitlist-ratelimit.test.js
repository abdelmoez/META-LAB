/**
 * waitlist-ratelimit.test.js — pure rate-limit primitives (prompt48). `now` injected.
 */
import { describe, it, expect } from 'vitest';
import { createRateLimiter, resendCooldownRemaining } from '../../server/waitlist/rateLimit.js';

describe('createRateLimiter', () => {
  it('allows up to max within the window, then denies', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 2 });
    expect(rl.check('a', 0).allowed).toBe(true);
    expect(rl.check('a', 10).allowed).toBe(true);
    const third = rl.check('a', 20);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });
  it('slides the window so old hits expire', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(rl.check('k', 0).allowed).toBe(true);
    expect(rl.check('k', 500).allowed).toBe(false);
    expect(rl.check('k', 1001).allowed).toBe(true); // first hit aged out
  });
  it('keys are independent', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(rl.check('a', 0).allowed).toBe(true);
    expect(rl.check('b', 0).allowed).toBe(true);
  });
  it('peek does not consume; reset clears', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(rl.peek('a', 0).allowed).toBe(true);
    expect(rl.check('a', 0).allowed).toBe(true);
    expect(rl.check('a', 0).allowed).toBe(false);
    rl.reset('a');
    expect(rl.check('a', 0).allowed).toBe(true);
  });
});

describe('resendCooldownRemaining', () => {
  it('is 0 with no prior attempt', () => {
    expect(resendCooldownRemaining(null, 1000, 60000)).toBe(0);
  });
  it('returns remaining ms within the cooldown', () => {
    const last = new Date(1000);
    expect(resendCooldownRemaining(last, 1000 + 20000, 60000)).toBe(40000);
  });
  it('is 0 once the cooldown has passed', () => {
    expect(resendCooldownRemaining(new Date(0), 70000, 60000)).toBe(0);
  });
  it('tolerates bad input', () => {
    expect(resendCooldownRemaining('not-a-date', 1000, 60000)).toBe(0);
  });
});
