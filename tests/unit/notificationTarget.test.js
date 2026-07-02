/**
 * notificationTarget.test.js — 65.md NAV-1 + NAV-2 pure seams.
 *
 * The deep-link resolver must never point a NON-STAFF viewer at the
 * staff-only, 404-cloaked /sift-beta routes; buildTitle is the tab-title
 * composer behind useDocumentTitle.
 */
import { describe, it, expect } from 'vitest';
import { notificationTarget, isStaffUser } from '../../src/frontend/components/notificationTarget.js';
import { buildTitle, TITLE_SUFFIX } from '../../src/frontend/hooks/useDocumentTitle.js';

describe('isStaffUser', () => {
  it('is true only for admin and mod', () => {
    expect(isStaffUser({ role: 'admin' })).toBe(true);
    expect(isStaffUser({ role: 'mod' })).toBe(true);
    expect(isStaffUser({ role: 'user' })).toBe(false);
    expect(isStaffUser(null)).toBe(false);
    expect(isStaffUser(undefined)).toBe(false);
    expect(isStaffUser({})).toBe(false);
  });
});

describe('notificationTarget', () => {
  it('workspace id wins for everyone (staff and not)', () => {
    const n = { relatedMetaLabProjectId: 'ml1', relatedScreenProjectId: 'sp1' };
    expect(notificationTarget(n, { staff: false })).toBe('/app?project=ml1');
    expect(notificationTarget(n, { staff: true })).toBe('/app?project=ml1');
  });

  it('screening-only rows deep-link staff to the engine route', () => {
    const n = { relatedScreenProjectId: 'sp1' };
    expect(notificationTarget(n, { staff: true })).toBe('/sift-beta/projects/sp1');
  });

  it('screening-only rows resolve to NO target for non-staff (never a 404 link)', () => {
    const n = { relatedScreenProjectId: 'sp1' };
    expect(notificationTarget(n, { staff: false })).toBeNull();
    expect(notificationTarget(n)).toBeNull(); // default is the safe (non-staff) case
  });

  it('legacy relatedMetaSiftProjectId alias behaves like relatedScreenProjectId', () => {
    const n = { relatedMetaSiftProjectId: 'ms1' };
    expect(notificationTarget(n, { staff: true })).toBe('/sift-beta/projects/ms1');
    expect(notificationTarget(n, { staff: false })).toBeNull();
  });

  it('rows with no related ids and nullish rows resolve to null', () => {
    expect(notificationTarget({}, { staff: true })).toBeNull();
    expect(notificationTarget(null, { staff: true })).toBeNull();
  });
});

describe('buildTitle', () => {
  it('joins parts with a middle dot and the PecanRev suffix', () => {
    expect(buildTitle('Screening', 'My SR')).toBe(`Screening · My SR — ${TITLE_SUFFIX}`);
  });

  it('skips blank/nullish parts', () => {
    expect(buildTitle('', null, 'Ops Console', undefined)).toBe(`Ops Console — ${TITLE_SUFFIX}`);
  });

  it('falls back to the bare suffix when nothing usable is passed', () => {
    expect(buildTitle()).toBe(TITLE_SUFFIX);
    expect(buildTitle('', '  ')).toBe(TITLE_SUFFIX);
  });
});
