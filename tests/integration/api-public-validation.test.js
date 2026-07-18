/**
 * api-public-validation.test.js — 93.md §4.8: the permissive shape-guard
 * schemas wired into the public POST routes (register, login, forgot/reset
 * password, waitlist submit, contact) return the structured validateBody 400
 * ({ error, code: 'VALIDATION_ERROR', fieldErrors }) for MISTYPED bodies,
 * while well-formed-but-invalid bodies still reach the controllers (their
 * existing messages/statuses are asserted by the pre-existing suites).
 *
 * Repo convention: hits a LIVE server at :3001 and skips silently when it is
 * not running. Run: npx vitest run tests/integration/api-public-validation.test.js
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3001/api';

async function serverUp() {
  try { const r = await fetch(`${API}/health`); return r.ok; } catch { return false; }
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // string body → raw JSON (used for the __proto__ case JSON.stringify would drop)
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, data };
}

function expectValidation400({ status, data }, path) {
  expect(status).toBe(400);
  expect(data?.code).toBe('VALIDATION_ERROR');
  expect(Array.isArray(data?.fieldErrors)).toBe(true);
  if (path) expect(data.fieldErrors.some((e) => e.path === path)).toBe(true);
}

let up = false;
beforeAll(async () => { up = await serverUp(); });

describe('93.md §4.8 — shape-guard 400s on public POST routes', () => {
  it('POST /auth/register rejects a mistyped email with the validation shape', async () => {
    if (!up) return;
    expectValidation400(await post('/auth/register', { email: { $gt: '' }, password: 'password123' }), 'email');
  });

  it('POST /auth/login rejects a mistyped password with the validation shape', async () => {
    if (!up) return;
    expectValidation400(await post('/auth/login', { email: 'a@b.co', password: { $ne: null } }), 'password');
  });

  it('POST /auth/forgot-password rejects a non-string email with the validation shape', async () => {
    if (!up) return;
    expectValidation400(await post('/auth/forgot-password', { email: ['a@b.co'] }), 'email');
  });

  it('POST /auth/reset-password rejects a mistyped token with the validation shape', async () => {
    if (!up) return;
    expectValidation400(await post('/auth/reset-password', { token: { hex: 'x' }, password: 'LongEnough1!' }), 'token');
  });

  it('POST /waitlist rejects a mistyped email with the validation shape (before any DB access)', async () => {
    if (!up) return;
    // Works even when BETA_WAITLIST_DATABASE_URL is unconfigured (would be 503
    // from the controller) — the shape guard runs first.
    expectValidation400(await post('/waitlist', { email: 42, consent: true }), 'email');
  });

  it('POST /contact rejects a mistyped message with the validation shape', async () => {
    if (!up) return;
    expectValidation400(await post('/contact', { email: 'qa@example.com', message: { text: 'hi' } }), 'message');
  });

  it('rejects prototype-pollution keys with INVALID_BODY before schema parsing', async () => {
    if (!up) return;
    const res = await post('/contact', '{"email":"qa@example.com","message":"x","__proto__":{"admin":true}}');
    expect(res.status).toBe(400);
    expect(res.data?.code).toBe('INVALID_BODY');
  });

  it('still lets well-formed-but-invalid bodies through to the controllers (messages unchanged)', async () => {
    if (!up) return;
    // register without email → controller's own 400 message, NOT the zod shape
    const reg = await post('/auth/register', { password: 'password123' });
    expect(reg.status).toBe(400);
    expect(reg.data?.error).toBe('email is required');
    expect(reg.data?.code).toBeUndefined();
    // contact without message → controller's own 400 message
    const contact = await post('/contact', { email: 'qa@example.com' });
    expect(contact.status).toBe(400);
    expect(contact.data?.error).toBe('message is required');
  });
});
