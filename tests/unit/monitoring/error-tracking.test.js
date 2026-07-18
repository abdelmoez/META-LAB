/**
 * error-tracking.test.js — unit tests for the DSN-gated Sentry wrapper
 * (93.md §5.1, server/services/errorTracking.js).
 *
 * The 93.md contract: with NO SENTRY_DSN configured the module must be a
 * complete no-op — init resolves without importing the SDK, and every capture/
 * flush call is safe to invoke from hot error paths (never throws, never
 * blocks). These tests pin the disabled path only; the enabled path would
 * talk to the real SDK and is deliberately not exercised in unit tests.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  errorTrackingEnabled,
  initErrorTracking,
  captureException,
  flushErrorTracking,
} from '../../../server/services/errorTracking.js';

beforeAll(() => {
  // Guarantee the disabled path even if a local server/.env leaked a DSN into
  // this fork via an earlier import (dotenv side effect).
  delete process.env.SENTRY_DSN;
});

describe('errorTracking with no SENTRY_DSN (disabled path)', () => {
  it('errorTrackingEnabled() is false', () => {
    expect(errorTrackingEnabled()).toBe(false);
  });

  it('initErrorTracking() resolves without throwing (and is idempotent)', async () => {
    await expect(initErrorTracking()).resolves.toBeUndefined();
    await expect(initErrorTracking()).resolves.toBeUndefined(); // second call: same
  });

  it('captureException never throws — Error, string, null, and rich ctx inputs', () => {
    expect(() => captureException(new Error('boom'))).not.toThrow();
    expect(() => captureException('plain string failure')).not.toThrow();
    expect(() => captureException(null)).not.toThrow();
    expect(() => captureException(undefined, {})).not.toThrow();
    expect(() => captureException(new Error('ctx'), {
      requestId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      route: '/api/projects/:id',
      method: 'POST',
      status: 500,
      userId: 'user_123',
    })).not.toThrow();
  });

  it('flushErrorTracking resolves immediately as a no-op', async () => {
    const t0 = Date.now();
    await expect(flushErrorTracking(2000)).resolves.toBeUndefined();
    // No SDK → nothing to flush; must not sit anywhere near the 2s bound.
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
