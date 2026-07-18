/**
 * publicSchemas.test.js — permissive shape-guard schemas for the public POST
 * endpoints (93.md §4.8). Pure (mock req/res/next), mirroring the style of
 * tests/unit/validateBody.test.js.
 *
 * Contract under test: types + max lengths + top-level-object + prototype-
 * pollution rejection ONLY. Presence/format stay with the controllers, so a
 * "valid" body here includes bodies MISSING required-by-controller fields.
 */
import { describe, it, expect } from 'vitest';
import { validateBody } from '../../../server/middleware/validateBody.js';
import {
  authRegisterSchema, authLoginSchema,
  passwordResetRequestSchema, passwordResetCompleteSchema,
  waitlistSubmitSchema, contactSubmitSchema,
} from '../../../server/schemas/publicSchemas.js';

function run(schema, body) {
  const req = { body };
  let nexted = false;
  const res = {
    statusCode: 200,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; return this; },
  };
  validateBody(schema)(req, res, () => { nexted = true; });
  return { req, res, nexted };
}

describe('authRegisterSchema', () => {
  it('accepts a normal registration body (and the additive inviteToken)', () => {
    const { res, nexted } = run(authRegisterSchema, {
      email: 'a@b.co', password: 'password123', name: 'QA', acceptedTerms: true, inviteToken: 'deadbeef',
    });
    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('stays permissive: missing email/password pass the shape guard (controller owns presence)', () => {
    expect(run(authRegisterSchema, {}).nexted).toBe(true);
    expect(run(authRegisterSchema, { password: 'password123' }).nexted).toBe(true);
    expect(run(authRegisterSchema, { email: null, name: null }).nexted).toBe(true);
  });

  it('rejects mistyped fields with the structured 400', () => {
    const { res, nexted } = run(authRegisterSchema, { email: { $gt: '' }, password: 'password123' });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.payload.code).toBe('VALIDATION_ERROR');
    expect(res.payload.fieldErrors.some((e) => e.path === 'email')).toBe(true);
  });

  it('rejects oversized fields (email > 320, password > 1024, name > 200)', () => {
    expect(run(authRegisterSchema, { email: `${'x'.repeat(321)}@b.co` }).res.statusCode).toBe(400);
    expect(run(authRegisterSchema, { password: 'p'.repeat(1025) }).res.statusCode).toBe(400);
    expect(run(authRegisterSchema, { name: 'n'.repeat(201) }).res.statusCode).toBe(400);
  });

  it('rejects a non-object top level (array/string) with a structured 400', () => {
    expect(run(authRegisterSchema, ['email', 'password']).res.statusCode).toBe(400);
    expect(run(authRegisterSchema, 'email=a@b.co').res.statusCode).toBe(400);
  });

  it('rejects prototype-pollution keys before schema parsing (INVALID_BODY)', () => {
    const { res, nexted } = run(authRegisterSchema, JSON.parse('{"email":"a@b.co","__proto__":{"admin":true}}'));
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.payload.code).toBe('INVALID_BODY');
  });

  it('passes unknown keys through (passthrough policy)', () => {
    const { req, nexted } = run(authRegisterSchema, { email: 'a@b.co', password: 'password123', futureField: 'x' });
    expect(nexted).toBe(true);
    expect(req.body.futureField).toBe('x');
  });
});

describe('authLoginSchema', () => {
  it('accepts { email, password } and stays permissive on missing fields', () => {
    expect(run(authLoginSchema, { email: 'a@b.co', password: 'pw123456' }).nexted).toBe(true);
    expect(run(authLoginSchema, {}).nexted).toBe(true);
  });

  it('rejects mistyped/oversized fields', () => {
    expect(run(authLoginSchema, { email: 123, password: 'pw' }).res.statusCode).toBe(400);
    expect(run(authLoginSchema, { email: 'a@b.co', password: { $ne: null } }).res.statusCode).toBe(400);
    expect(run(authLoginSchema, { email: 'a@b.co', password: 'p'.repeat(1025) }).res.statusCode).toBe(400);
  });

  it('rejects prototype pollution via validateBody', () => {
    const { res } = run(authLoginSchema, JSON.parse('{"email":"a@b.co","constructor":{"x":1}}'));
    expect(res.statusCode).toBe(400);
    expect(res.payload.code).toBe('INVALID_BODY');
  });
});

describe('passwordResetRequestSchema', () => {
  it('accepts { email } and an empty body (controller owns the required-email 400)', () => {
    expect(run(passwordResetRequestSchema, { email: 'a@b.co' }).nexted).toBe(true);
    expect(run(passwordResetRequestSchema, {}).nexted).toBe(true);
  });

  it('rejects a mistyped/oversized email', () => {
    expect(run(passwordResetRequestSchema, { email: ['a@b.co'] }).res.statusCode).toBe(400);
    expect(run(passwordResetRequestSchema, { email: 'x'.repeat(400) }).res.statusCode).toBe(400);
  });
});

describe('passwordResetCompleteSchema', () => {
  it('accepts { token, password } and missing fields', () => {
    expect(run(passwordResetCompleteSchema, { token: 'deadbeef', password: 'LongEnough1!' }).nexted).toBe(true);
    expect(run(passwordResetCompleteSchema, {}).nexted).toBe(true);
  });

  it('rejects mistyped/oversized token and password', () => {
    expect(run(passwordResetCompleteSchema, { token: { hex: 'x' }, password: 'LongEnough1!' }).res.statusCode).toBe(400);
    expect(run(passwordResetCompleteSchema, { token: 't'.repeat(513) }).res.statusCode).toBe(400);
    expect(run(passwordResetCompleteSchema, { token: 't', password: 'p'.repeat(1025) }).res.statusCode).toBe(400);
  });
});

describe('waitlistSubmitSchema', () => {
  const valid = {
    email: 'wl@example.com',
    firstName: 'Test', lastName: 'Applicant',
    institutionName: 'Integration University',
    role: 'Researcher', countryCode: 'US',
    primaryUse: 'Systematic review',
    areasOfInterest: ['Title & abstract screening', 'Meta-analysis & forest plots'],
    workingStyle: 'Research team', teamSize: '2–5',
    referralSource: 'Search engine',
    message: 'Unit test submission.',
    consent: true,
  };

  it('accepts a full valid application', () => {
    const { res, nexted } = run(waitlistSubmitSchema, valid);
    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('stays permissive: a bare { email } passes so the domain validator can 422 it', () => {
    expect(run(waitlistSubmitSchema, { email: 'nope' }).nexted).toBe(true);
    expect(run(waitlistSubmitSchema, {}).nexted).toBe(true);
  });

  it('keeps the website honeypot AND unknown keys in the body (controller must see them)', () => {
    const { req, nexted } = run(waitlistSubmitSchema, { ...valid, website: 'http://spam.example', futureQ: 'x' });
    expect(nexted).toBe(true);
    expect(req.body.website).toBe('http://spam.example');
    expect(req.body.futureQ).toBe('x');
  });

  it('rejects mistyped fields (non-string email, non-array interests items, non-boolean handled by domain)', () => {
    expect(run(waitlistSubmitSchema, { ...valid, email: 42 }).res.statusCode).toBe(400);
    expect(run(waitlistSubmitSchema, { ...valid, areasOfInterest: [{ a: 1 }] }).res.statusCode).toBe(400);
  });

  it('rejects oversized payloads (message > 5000, > 100 interests)', () => {
    expect(run(waitlistSubmitSchema, { ...valid, message: 'm'.repeat(5001) }).res.statusCode).toBe(400);
    expect(run(waitlistSubmitSchema, { ...valid, areasOfInterest: Array(101).fill('x') }).res.statusCode).toBe(400);
  });

  it('rejects prototype pollution', () => {
    const { res } = run(waitlistSubmitSchema, JSON.parse('{"email":"a@b.co","prototype":{"x":1}}'));
    expect(res.statusCode).toBe(400);
    expect(res.payload.code).toBe('INVALID_BODY');
  });
});

describe('contactSubmitSchema', () => {
  it('accepts a valid contact body and permissively passes missing fields', () => {
    expect(run(contactSubmitSchema, {
      name: 'QA Bot', email: 'qa@example.com', subject: 'Hi', message: 'Hello there.',
    }).nexted).toBe(true);
    expect(run(contactSubmitSchema, {}).nexted).toBe(true); // controller 400s with its own message
  });

  it('rejects mistyped/oversized fields', () => {
    expect(run(contactSubmitSchema, { email: { $gt: '' }, message: 'x' }).res.statusCode).toBe(400);
    expect(run(contactSubmitSchema, { email: 'a@b.co', message: 'm'.repeat(10_001) }).res.statusCode).toBe(400);
    expect(run(contactSubmitSchema, { email: 'a@b.co', message: 'x', subject: 's'.repeat(501) }).res.statusCode).toBe(400);
  });

  it('rejects a non-object top level and prototype pollution', () => {
    expect(run(contactSubmitSchema, [1, 2, 3]).res.statusCode).toBe(400);
    const { res } = run(contactSubmitSchema, JSON.parse('{"message":"x","__proto__":{"x":1}}'));
    expect(res.statusCode).toBe(400);
    expect(res.payload.code).toBe('INVALID_BODY');
  });
});
