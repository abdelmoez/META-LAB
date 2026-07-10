/**
 * requestLoggerRedact.test.js — the access logger must never write a raw
 * single-use token (80.md Phase 12 / prompt49). redactUrl masks token path
 * segments and ?token= query values.
 */
import { describe, it, expect } from 'vitest';
import { redactUrl } from '../../server/middleware/requestLogger.js';

describe('redactUrl', () => {
  it('masks an invitation token in the accept path', () => {
    expect(redactUrl('/api/accept-invitation/263678c6211926e1fe5a67c303ee2e54')).toBe('/api/accept-invitation/<token>');
  });
  it('masks the token but keeps the /accept suffix', () => {
    expect(redactUrl('/api/accept-invitation/abc123/accept')).toBe('/api/accept-invitation/<token>/accept');
  });
  it('masks a project invite token', () => {
    expect(redactUrl('/api/invites/deadbeefdeadbeef')).toBe('/api/invites/<token>');
  });
  it('masks a ?token= query value', () => {
    expect(redactUrl('/reset?token=secret123')).toBe('/reset?token=<redacted>');
  });
  it('masks token in a mixed query string but keeps other params', () => {
    expect(redactUrl('/x?a=1&token=zzz&b=2')).toBe('/x?a=1&token=<redacted>&b=2');
  });
  it('leaves ordinary admin paths untouched', () => {
    const u = '/api/admin/beta-waitlist/applicants/123/invite';
    expect(redactUrl(u)).toBe(u);
  });
  it('never returns the raw token substring', () => {
    const tok = 'f'.repeat(64);
    expect(redactUrl(`/api/accept-invitation/${tok}/accept`)).not.toContain(tok);
  });
});
