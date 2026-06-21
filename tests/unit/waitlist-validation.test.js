/**
 * waitlist-validation.test.js — the shared, server-authoritative waitlist
 * validator (prompt48). Pure; no DB, no server.
 */
import { describe, it, expect } from 'vitest';
import {
  validateApplication, normalizeEmail, isValidEmail, isValidStatus,
  WAITLIST_STATUSES,
} from '../../src/shared/betaWaitlist.js';

const base = () => ({
  email: 'Jane.Doe@Example.com',
  firstName: 'Jane', lastName: 'Doe',
  institutionName: 'Test University',
  role: 'Researcher',
  countryCode: 'US',
  primaryUse: 'Systematic review',
  consent: true,
});

describe('normalizeEmail / isValidEmail', () => {
  it('normalizes to trimmed lowercase', () => {
    expect(normalizeEmail('  Foo.Bar@EXAMPLE.com ')).toBe('foo.bar@example.com');
    expect(normalizeEmail(null)).toBe('');
  });
  it('validates structure + length cap', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(`${'a'.repeat(250)}@b.com`)).toBe(false); // > 254
  });
});

describe('validateApplication — happy path', () => {
  it('accepts a valid payload and normalizes email + country', () => {
    const r = validateApplication(base());
    expect(r.ok).toBe(true);
    expect(r.value.email).toBe('Jane.Doe@Example.com'.trim());
    expect(r.value.normalizedEmail).toBe('jane.doe@example.com');
    expect(r.value.countryCode).toBe('US');
    expect(r.value.countryName).toBe('United States');
    expect(r.value.consentVersion).toBeTruthy();
  });

  it('uppercases a lowercase country code', () => {
    const r = validateApplication({ ...base(), countryCode: 'gb' });
    expect(r.ok).toBe(true);
    expect(r.value.countryCode).toBe('GB');
  });
});

describe('validateApplication — mass assignment protection', () => {
  it('drops server-owned / unknown fields', () => {
    const r = validateApplication({
      ...base(),
      status: 'ACCEPTED', internalNotes: 'hax', id: 'x',
      confirmationEmailStatus: 'sent', createdAt: '2000-01-01', invitedAt: '2000-01-01',
      somethingRandom: true,
    });
    expect(r.ok).toBe(true);
    expect(r.value).not.toHaveProperty('status');
    expect(r.value).not.toHaveProperty('internalNotes');
    expect(r.value).not.toHaveProperty('id');
    expect(r.value).not.toHaveProperty('confirmationEmailStatus');
    expect(r.value).not.toHaveProperty('createdAt');
    expect(r.value).not.toHaveProperty('invitedAt');
    expect(r.value).not.toHaveProperty('somethingRandom');
  });
});

describe('validateApplication — required fields & consent', () => {
  it('flags missing required fields', () => {
    const r = validateApplication({});
    expect(r.ok).toBe(false);
    for (const k of ['email', 'firstName', 'lastName', 'institutionName', 'role', 'countryCode', 'primaryUse', 'consent']) {
      expect(r.errors[k]).toBeTruthy();
    }
  });
  it('requires consent to be explicitly true', () => {
    expect(validateApplication({ ...base(), consent: false }).ok).toBe(false);
    expect(validateApplication({ ...base(), consent: 'yes' }).ok).toBe(false);
    const { consent, ...noConsent } = base();
    expect(validateApplication(noConsent).errors.consent).toBeTruthy();
  });
  it('rejects an invalid email', () => {
    expect(validateApplication({ ...base(), email: 'nope' }).errors.email).toBeTruthy();
  });
});

describe('validateApplication — closed option lists', () => {
  it('rejects unknown role / country / primaryUse', () => {
    expect(validateApplication({ ...base(), role: 'Wizard' }).errors.role).toBeTruthy();
    expect(validateApplication({ ...base(), countryCode: 'ZZ' }).errors.countryCode).toBeTruthy();
    expect(validateApplication({ ...base(), primaryUse: 'Vibes' }).errors.primaryUse).toBeTruthy();
  });
  it('requires a custom role when role is Other', () => {
    expect(validateApplication({ ...base(), role: 'Other' }).errors.customRole).toBeTruthy();
    const r = validateApplication({ ...base(), role: 'Other', customRole: 'Data librarian' });
    expect(r.ok).toBe(true);
    expect(r.value.customRole).toBe('Data librarian');
  });
  it('filters + dedupes areas of interest against the closed list', () => {
    const r = validateApplication({
      ...base(),
      areasOfInterest: ['Title & abstract screening', 'bogus', 'Title & abstract screening', 'Data extraction'],
    });
    expect(r.ok).toBe(true);
    expect(r.value.areasOfInterest).toEqual(['Title & abstract screening', 'Data extraction']);
  });
  it('validates optional enums only when present', () => {
    expect(validateApplication({ ...base(), researchExperienceLevel: 'nope' }).errors.researchExperienceLevel).toBeTruthy();
    expect(validateApplication({ ...base(), researchExperienceLevel: '' }).ok).toBe(true);
  });
});

describe('validateApplication — length caps', () => {
  it('truncates over-long single-line fields', () => {
    const r = validateApplication({ ...base(), firstName: 'x'.repeat(300) });
    expect(r.ok).toBe(true);
    expect(r.value.firstName.length).toBe(100);
  });
});

describe('isValidStatus', () => {
  it('accepts only known statuses', () => {
    for (const s of WAITLIST_STATUSES) expect(isValidStatus(s)).toBe(true);
    expect(isValidStatus('NOPE')).toBe(false);
    expect(isValidStatus('')).toBe(false);
  });
});
