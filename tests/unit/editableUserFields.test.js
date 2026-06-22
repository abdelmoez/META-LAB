/**
 * editableUserFields.test.js (prompt20 Task 5) — the central, shared schema that
 * gates which User fields the Ops console may edit. These are security-critical:
 * the server's PATCH /api/admin/users/:id builds its Prisma patch ONLY from
 * buildUserUpdate, so anything this allowlist lets through can be written, and
 * anything it drops can never be. Lock the contract down with unit coverage.
 */
import { describe, it, expect } from 'vitest';
import {
  EDITABLE_USER_FIELDS, SENSITIVE_USER_FIELDS, READONLY_USER_FIELDS,
  editableFieldsForRole, buildUserUpdate,
} from '../../src/shared/editableUserFields.js';

describe('editableUserFields — role visibility', () => {
  it('admin may edit the full safe set; mod gets a strict subset', () => {
    const admin = editableFieldsForRole('admin').map(f => f.key);
    const mod   = editableFieldsForRole('mod').map(f => f.key);

    expect(admin).toEqual(expect.arrayContaining(['name', 'email', 'themePreference', 'registrationCountryCode', 'registrationCountryName']));
    // Mod can touch only the low-risk profile fields.
    expect(mod).toEqual(expect.arrayContaining(['name', 'email', 'themePreference']));
    expect(mod).not.toContain('registrationCountryCode');
    expect(mod).not.toContain('registrationCountryName');
    expect(mod).not.toContain('role');
  });

  it('treats the numeric userNumber as immutable: display-only, never editable (prompt49 item 8)', () => {
    const editableKeys = new Set(EDITABLE_USER_FIELDS.map(f => f.key));
    expect(editableKeys.has('userNumber')).toBe(false);
    expect(READONLY_USER_FIELDS.map(f => f.key)).toContain('userNumber');
    // An admin attempting to set it is silently dropped (not an error, not applied).
    const { data, changed } = buildUserUpdate({ userNumber: 999, name: 'X' }, 'admin');
    expect(data).not.toHaveProperty('userNumber');
    expect(changed).not.toContain('userNumber');
  });

  it('never lists a sensitive field as editable', () => {
    const editable = new Set(EDITABLE_USER_FIELDS.map(f => f.key));
    for (const secret of SENSITIVE_USER_FIELDS) expect(editable.has(secret)).toBe(false);
    expect(editable.has('password')).toBe(false);
    expect(editable.has('id')).toBe(false);
    expect(editable.has('createdAt')).toBe(false);
  });
});

describe('buildUserUpdate — allowlist enforcement + validation', () => {
  it('normalises and accepts generic profile fields for an admin', () => {
    const { data, changed, error } = buildUserUpdate({ name: '  Bob  ', email: 'A@B.COM' }, 'admin');
    expect(error).toBeUndefined();
    expect(data).toEqual({ name: 'Bob', email: 'a@b.com' });
    expect(changed.sort()).toEqual(['email', 'name']);
  });

  it('uppercases a country code and accepts blank as "unknown" (admin only)', () => {
    expect(buildUserUpdate({ registrationCountryCode: 'us' }, 'admin').data).toEqual({ registrationCountryCode: 'US' });
    expect(buildUserUpdate({ registrationCountryCode: '' }, 'admin').data).toEqual({ registrationCountryCode: '' });
    // A mod cannot set the country fields — silently dropped, not an error.
    expect(buildUserUpdate({ registrationCountryCode: 'us' }, 'mod').changed).toEqual([]);
  });

  it('IGNORES password, hashes, ids, and the dedicated role/suspended fields', () => {
    const { data, changed } = buildUserUpdate({
      password: 'hunter2', registrationIpHash: 'deadbeef', id: 'x', createdAt: '2020',
      role: 'admin', suspended: true,
    }, 'admin');
    expect(data).toEqual({});
    expect(changed).toEqual([]);
    expect(data).not.toHaveProperty('password');
    expect(data).not.toHaveProperty('role');
    expect(data).not.toHaveProperty('suspended');
  });

  it('rejects an invalid email and an invalid country code with a 400-style error', () => {
    expect(buildUserUpdate({ email: 'not-an-email' }, 'admin').error).toMatch(/valid email/i);
    expect(buildUserUpdate({ registrationCountryCode: 'USA' }, 'admin').error).toMatch(/2 letters/i);
  });

  it('only flags fields that are actually present (partial patches)', () => {
    const { data, changed } = buildUserUpdate({ themePreference: 'day' }, 'admin');
    expect(data).toEqual({ themePreference: 'day' });
    expect(changed).toEqual(['themePreference']);
  });
});
