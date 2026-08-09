/**
 * screenAccess.test.js — 107.md rec: the META·SIFT `access` object and the keyword
 * capability gate derived from it.
 *
 * REGRESSION THIS PINS: `access` used to be an inline literal in SiftProject.jsx that
 * enumerated its fields by hand and simply omitted `canManageSettings`. ScreeningTab's
 * keyword gate therefore read `undefined` — false for EVERY user including the project
 * owner — which killed the §2 suggestion-review panel, the §3 abstract-selection
 * shortcut, and (because `false !== undefined`) every edit control in the KeywordEditor
 * that used to be gated on `isLeader`. Nothing failed loudly; the whole surface just
 * stopped existing. Pure module, no DOM, no React.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildScreenAccess, canEditScreeningKeywords, SCREEN_ACCESS_FIELDS,
} from '../../../src/frontend/screening/lib/screenAccess.js';

// The three shapes `GET /api/screening/projects/:pid` really returns, per
// server/screening/access.js: `canManageSettings = isLeader || member.canManageSettings`
// and `isLeader = isOwner || role in (leader, owner)`.
const OWNER = {
  isLeader: true, myRole: 'owner', isOwner: true, perms: { canManageSettings: true },
  canScreen: true, canChat: true, canResolveConflicts: true,
  canManageMembers: true, canManageSettings: true, blindMode: false,
};
const LEADER = { ...OWNER, myRole: 'leader', isOwner: false };
const MEMBER = {
  isLeader: false, myRole: 'reviewer', isOwner: false, perms: { canScreen: true },
  canScreen: true, canChat: true, canResolveConflicts: false,
  canManageMembers: false, canManageSettings: false, blindMode: false,
};

describe('buildScreenAccess', () => {
  it('forwards canManageSettings — the field the hand-written literal dropped', () => {
    expect(buildScreenAccess(OWNER).canManageSettings).toBe(true);
    expect(buildScreenAccess(LEADER).canManageSettings).toBe(true);
    expect(buildScreenAccess(MEMBER).canManageSettings).toBe(false);
    // …and its sibling global flag.
    expect(buildScreenAccess(OWNER).canManageMembers).toBe(true);
    expect(buildScreenAccess(MEMBER).canManageMembers).toBe(false);
  });

  it('carries every field the screening tabs read, and no undefined holes', () => {
    const access = buildScreenAccess(OWNER);
    for (const f of SCREEN_ACCESS_FIELDS) {
      expect(access, `missing access field: ${f}`).toHaveProperty(f);
      expect(access[f], `undefined access field: ${f}`).not.toBeUndefined();
    }
    expect(Object.keys(access).sort()).toEqual([...SCREEN_ACCESS_FIELDS].sort());
  });

  it('keeps the pre-existing fields byte-for-byte', () => {
    const access = buildScreenAccess(MEMBER);
    expect(access.isLeader).toBe(false);
    expect(access.myRole).toBe('reviewer');
    expect(access.isOwner).toBe(false);
    expect(access.canScreen).toBe(true);
    expect(access.canChat).toBe(true);
    expect(access.canResolveConflicts).toBe(false);
    expect(access.blindMode).toBe(false);
    expect(access.perms).toEqual({ canScreen: true });
  });

  it('defaults perms to an object so `access.perms.x` never throws', () => {
    expect(buildScreenAccess({ isLeader: false }).perms).toEqual({});
  });

  it('is {} while the project is still loading', () => {
    expect(buildScreenAccess(null)).toEqual({});
    expect(buildScreenAccess(undefined)).toEqual({});
  });
});

describe('canEditScreeningKeywords', () => {
  it('grants the owner and every leader — the case that was broken', () => {
    expect(canEditScreeningKeywords(buildScreenAccess(OWNER))).toBe(true);
    expect(canEditScreeningKeywords(buildScreenAccess(LEADER))).toBe(true);
  });

  it('denies a plain member and grants one explicitly given the permission', () => {
    expect(canEditScreeningKeywords(buildScreenAccess(MEMBER))).toBe(false);
    expect(canEditScreeningKeywords(buildScreenAccess({ ...MEMBER, canManageSettings: true }))).toBe(true);
  });

  it('falls back to isLeader if a payload ever omits the granular flag', () => {
    // Degrades to the PRE-107 gate instead of hiding every control.
    expect(canEditScreeningKeywords({ isLeader: true })).toBe(true);
    expect(canEditScreeningKeywords({ isLeader: false })).toBe(false);
  });

  it('always returns a real boolean (KeywordEditor branches on `!== undefined`)', () => {
    for (const a of [null, undefined, {}, buildScreenAccess(null)]) {
      expect(typeof canEditScreeningKeywords(a)).toBe('boolean');
      expect(canEditScreeningKeywords(a)).toBe(false);
    }
  });
});

/* ── Source-level pin: the consumers must actually USE the shared helper ───────────
   A pure helper nobody calls is exactly what the original bug looked like from the
   test suite's point of view. These two assertions are the only thing standing
   between a future edit and a silently re-introduced inline literal. */

const SIFT_PROJECT = readFileSync(
  new URL('../../../src/frontend/screening/pages/SiftProject.jsx', import.meta.url), 'utf8',
);
const SCREENING_TAB = readFileSync(
  new URL('../../../src/frontend/screening/tabs/ScreeningTab.jsx', import.meta.url), 'utf8',
);

describe('access wiring (source-level regression pin)', () => {
  it('SiftProject builds `access` through buildScreenAccess, not a hand-written literal', () => {
    expect(SIFT_PROJECT).toContain("from '../lib/screenAccess.js'");
    expect(SIFT_PROJECT).toMatch(/const\s+access\s*=\s*buildScreenAccess\(project\)/);
    // The literal that dropped canManageSettings must not come back.
    expect(SIFT_PROJECT).not.toMatch(/canScreen:\s*project\.canScreen/);
    expect(SIFT_PROJECT).not.toMatch(/const\s+access\s*=\s*project\s*\?\s*\{/);
  });

  it('ScreeningTab derives canEditKeywords from the shared gate', () => {
    expect(SCREENING_TAB).toContain("from '../lib/screenAccess.js'");
    expect(SCREENING_TAB).toMatch(/const\s+canEditKeywords\s*=\s*canEditScreeningKeywords\(access\)/);
    // The single-field read that was always undefined must not come back.
    expect(SCREENING_TAB).not.toMatch(/canEditKeywords\s*=\s*!!access\?\.canManageSettings\s*;/);
  });
});
