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
  // 54.md — only email, countryCode and consent are required now ("all optional
  // except Country"); names/role/institution/primaryUse are optional.
  it('flags the (reduced) required field set', () => {
    const r = validateApplication({});
    expect(r.ok).toBe(false);
    for (const k of ['email', 'countryCode', 'consent']) {
      expect(r.errors[k]).toBeTruthy();
    }
  });
  it('does NOT require name / role / institution / primaryUse', () => {
    const r = validateApplication({ email: 'a@b.co', countryCode: 'US', consent: true });
    expect(r.ok).toBe(true);
    for (const k of ['firstName', 'lastName', 'institutionName', 'role', 'primaryUse']) {
      expect(r.errors?.[k]).toBeFalsy();
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

describe('validateApplication — 54.md questionnaire fields', () => {
  it('accepts valid new questionnaire enums', () => {
    const r = validateApplication({
      ...base(),
      primaryField: 'Medicine',
      institutionType: 'University',
      covidenceLicense: 'No',
      priorReviewCount: '3–5',
      lastReviewTool: 'Rayyan',
    });
    expect(r.ok).toBe(true);
    expect(r.value.primaryField).toBe('Medicine');
    expect(r.value.institutionType).toBe('University');
    expect(r.value.covidenceLicense).toBe('No');
    expect(r.value.priorReviewCount).toBe('3–5');
    expect(r.value.lastReviewTool).toBe('Rayyan');
  });
  it('rejects invalid values for the new enums', () => {
    expect(validateApplication({ ...base(), primaryField: 'Astrology' }).errors.primaryField).toBeTruthy();
    expect(validateApplication({ ...base(), institutionType: 'Spaceship' }).errors.institutionType).toBeTruthy();
    expect(validateApplication({ ...base(), covidenceLicense: 'Maybe' }).errors.covidenceLicense).toBeTruthy();
    expect(validateApplication({ ...base(), priorReviewCount: 'lots' }).errors.priorReviewCount).toBeTruthy();
    expect(validateApplication({ ...base(), lastReviewTool: 'Notepad' }).errors.lastReviewTool).toBeTruthy();
  });
  it('treats the new fields as optional (omitting them is valid)', () => {
    const r = validateApplication(base());
    expect(r.ok).toBe(true);
    expect(r.value).not.toHaveProperty('primaryField');
    expect(r.value).not.toHaveProperty('covidenceLicense');
  });
});

describe('validateApplication — two-layer consent (54.md)', () => {
  it('operational consent is required; researchConsent defaults to false', () => {
    const r = validateApplication(base());
    expect(r.ok).toBe(true);
    expect(r.value.consent).toBe(true);
    expect(r.value.researchConsent).toBe(false);
  });
  it('records an explicit research-insights opt-in', () => {
    const r = validateApplication({ ...base(), researchConsent: true });
    expect(r.ok).toBe(true);
    expect(r.value.researchConsent).toBe(true);
  });
  it('research opt-in is never required (operational-only still submits)', () => {
    expect(validateApplication({ ...base(), researchConsent: false }).ok).toBe(true);
  });
  it('only literal true opts in (a truthy string does not)', () => {
    const r = validateApplication({ ...base(), researchConsent: 'yes' });
    expect(r.ok).toBe(true);
    expect(r.value.researchConsent).toBe(false);
  });
});

describe('isValidStatus', () => {
  it('accepts only known statuses', () => {
    for (const s of WAITLIST_STATUSES) expect(isValidStatus(s)).toBe(true);
    expect(isValidStatus('NOPE')).toBe(false);
    expect(isValidStatus('')).toBe(false);
  });
});
