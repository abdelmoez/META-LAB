/**
 * adminUsers.test.js — 95.md Phase 13 — pure derivations behind the Ops user
 * management area (hermetic; house style: editableUserFields.test.js).
 */
import { describe, it, expect } from 'vitest';
import {
  classifyRegistrationMethod, deriveAuthMethods, authMethodLabel, deriveStatus,
  SAME_TX_WINDOW_MS,
} from '../../src/shared/adminUsers.js';
import { parseUsersListQuery } from '../../server/schemas/adminUserSchemas.js';
import { buildUsersOrderBy } from '../../server/services/adminUserQuery.js';

const T0 = new Date('2026-05-01T10:00:00Z');

describe('classifyRegistrationMethod (backfill rules — never the email domain)', () => {
  it('rule A: same-transaction google AuthAccount ⇒ google (even with a password set later)', () => {
    expect(classifyRegistrationMethod({ createdAt: T0, hasPassword: false, googleAccountCreatedAt: T0 })).toBe('google');
    expect(classifyRegistrationMethod({ createdAt: T0, hasPassword: true, googleAccountCreatedAt: new Date(T0.getTime() + SAME_TX_WINDOW_MS - 1) })).toBe('google');
  });
  it('rule B: password + link-later google ⇒ email (original method preserved)', () => {
    const linkLater = new Date(T0.getTime() + SAME_TX_WINDOW_MS + 60_000);
    expect(classifyRegistrationMethod({ createdAt: T0, hasPassword: true, googleAccountCreatedAt: linkLater })).toBe('email');
    expect(classifyRegistrationMethod({ createdAt: T0, hasPassword: true, googleAccountCreatedAt: null })).toBe('email');
  });
  it('rule C: passwordless with no same-tx google ⇒ unknown (honest, no guessing)', () => {
    expect(classifyRegistrationMethod({ createdAt: T0, hasPassword: false, googleAccountCreatedAt: null })).toBe('unknown');
  });
});

describe('deriveAuthMethods + authMethodLabel (current methods ≠ registration method)', () => {
  it('derives from password presence + provider rows only', () => {
    expect(deriveAuthMethods({ hasPassword: true, providers: [] })).toEqual(['email']);
    expect(deriveAuthMethods({ hasPassword: false, providers: [{ provider: 'google' }] })).toEqual(['google']);
    expect(deriveAuthMethods({ hasPassword: true, providers: [{ provider: 'google' }] })).toEqual(['email', 'google']);
    expect(deriveAuthMethods({ hasPassword: false, providers: [] })).toEqual([]);
  });
  it('labels match the 95.md badge vocabulary; no method is a warning', () => {
    expect(authMethodLabel(['email', 'google'])).toBe('Google + Email');
    expect(authMethodLabel(['google'])).toBe('Google');
    expect(authMethodLabel(['email'])).toBe('Email');
    expect(authMethodLabel([])).toBe('No login method');
  });
});

describe('deriveStatus', () => {
  it('suspension dominates; unverified surfaces; verified+unsuspended is active', () => {
    expect(deriveStatus({ suspended: true, emailVerifiedAt: new Date() })).toBe('suspended');
    expect(deriveStatus({ suspended: false, emailVerifiedAt: null })).toBe('pending_verification');
    expect(deriveStatus({ suspended: false, emailVerifiedAt: new Date() })).toBe('active');
  });
});

describe('parseUsersListQuery (zod — invalid single filters degrade, never throw)', () => {
  it('coerces numbers, accepts enums, drops junk per-field', () => {
    const f = parseUsersListQuery({ page: '3', limit: '50', authMethod: 'google_only', status: 'suspended', sort: 'projects', order: 'asc' });
    expect(f).toMatchObject({ page: 3, limit: 50, authMethod: 'google_only', status: 'suspended', sort: 'projects', order: 'asc' });
    const g = parseUsersListQuery({ authMethod: 'DROP TABLE', status: 'nope', limit: '9999', search: 'ok' });
    expect(g.authMethod).toBeUndefined();
    expect(g.status).toBeUndefined();
    expect(g.limit).toBeUndefined(); // >100 → dropped, handler default applies
    expect(g.search).toBe('ok');
  });
  it('keeps the legacy params working', () => {
    const f = parseUsersListQuery({ suspended: 'true', verified: 'false', sort: 'oldest', createdWithin: 'week' });
    expect(f).toMatchObject({ suspended: 'true', verified: 'false', sort: 'oldest', createdWithin: 'week' });
  });
});

describe('buildUsersOrderBy', () => {
  it('maps sorts incl. legacy values, defaults to createdAt desc, nulls-last for lastActive', () => {
    expect(buildUsersOrderBy(undefined, undefined)).toEqual({ createdAt: 'desc' });
    expect(buildUsersOrderBy('oldest')).toEqual({ createdAt: 'asc' });
    expect(buildUsersOrderBy('name', 'asc')).toEqual({ name: 'asc' });
    expect(buildUsersOrderBy('projects', 'desc')).toEqual({ projects: { _count: 'desc' } });
    expect(buildUsersOrderBy('lastActive', 'desc')).toEqual({ lastActive: { sort: 'desc', nulls: 'last' } });
  });
});
