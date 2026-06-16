/**
 * cors-origin.test.js — guard for roadmap 0.3.
 * The CORS allowed origin must be env-driven (never a hard-coded prod host).
 */
import { describe, it, expect } from 'vitest';
import { resolveCorsOrigin } from '../../../server/config/cors.js';

describe('resolveCorsOrigin (env-driven CORS)', () => {
  it('prefers CORS_ORIGIN', () => {
    expect(resolveCorsOrigin({ CORS_ORIGIN: 'https://a.example', APP_BASE_URL: 'https://b.example' }))
      .toBe('https://a.example');
  });

  it('falls back to APP_BASE_URL when CORS_ORIGIN is unset', () => {
    expect(resolveCorsOrigin({ APP_BASE_URL: 'https://b.example' })).toBe('https://b.example');
  });

  it('falls back to the local Vite dev server when nothing is set', () => {
    expect(resolveCorsOrigin({})).toBe('http://localhost:3000');
  });

  it('does not bake any production host into the default', () => {
    // The default must be localhost only — production hosts come from env.
    expect(resolveCorsOrigin({})).not.toMatch(/metalab|\.com|\.org|\.io/i);
  });
});
