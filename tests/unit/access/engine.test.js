/**
 * 91.md — pure access-state engine tests: restriction taxonomy, AccessDecision +
 * structured body + client parse-back (incl. legacy tier compat), capability registry,
 * and the deterministic resolver across roles/tiers/admin/archived.
 */
import { describe, it, expect } from 'vitest';
import {
  RESTRICTION_TYPES, restrictionMeta, isValidRestriction,
  allow, deny, buildAccessDenied, parseAccessError, isDenied,
  CAPABILITIES, CAPABILITY_KEYS,
  resolveCapability, can, resolveCapabilities, ctxFromProjectAccess,
} from '../../../src/shared/access/index.js';

describe('restriction types', () => {
  it('every capability restriction id is a valid restriction type', () => {
    for (const k of CAPABILITY_KEYS) {
      const r = CAPABILITIES[k].restriction;
      expect(isValidRestriction(r), `${k} → ${r}`).toBe(true);
    }
  });
  it('meta falls back to permission for unknown', () => {
    expect(restrictionMeta('nope')).toBe(RESTRICTION_TYPES.permission);
  });
  it('every restriction icon is a real Icon name (Icon returns null for unknown → empty cue)', () => {
    // Names present in src/frontend/components/icons.jsx (ICON_PATHS). Update if the set grows.
    const REAL_ICONS = new Set([
      'activity', 'alert', 'alertOctagon', 'alertTriangle', 'arrowLeft', 'arrowRight', 'award', 'barChart',
      'bell', 'bookOpen', 'chat', 'check', 'checkSquare', 'chevronDown', 'chevronLeft', 'chevronRight',
      'circleCheck', 'clipboard', 'clock', 'copy', 'diamond', 'download', 'externalLink', 'eye', 'fileText',
      'filter', 'flask', 'flow', 'folder', 'folders', 'forest', 'globe', 'grid', 'hexagon', 'home', 'info',
      'layers', 'link', 'lock', 'logout', 'mail', 'menu', 'minus', 'moon', 'pencil', 'pin', 'plus', 'refresh',
      'scale', 'search', 'send', 'settings', 'shield', 'shieldCheck', 'sigma', 'sliders', 'sun', 'table',
      'target', 'trash', 'upload', 'user', 'users',
    ]);
    for (const [id, meta] of Object.entries(RESTRICTION_TYPES)) {
      expect(REAL_ICONS.has(meta.icon), `${id} → ${meta.icon}`).toBe(true);
    }
  });
});

describe('AccessDecision + HTTP body', () => {
  it('allow() is allowed with no restriction', () => {
    const d = allow('runAnalysis');
    expect(d.allowed).toBe(true);
    expect(isDenied(d)).toBe(false);
  });
  it('deny() carries type meta + specifics', () => {
    const d = deny('owner_only', { capability: 'deleteProject', currentRole: 'reviewer', message: 'Only the owner can delete.' });
    expect(d.allowed).toBe(false);
    expect(d.tone).toBe('warn');
    expect(d.badge).toBe('Owner only');
    expect(d.nextAction.type).toBe('contact_owner');
    expect(isDenied(d)).toBe(true);
  });
  it('buildAccessDenied → generic body; tier keeps legacy TIER_LIMIT_EXCEEDED', () => {
    const perm = buildAccessDenied(deny('permission', { capability: 'screen', message: 'x' }));
    expect(perm.error).toBe('ACCESS_RESTRICTED');
    expect(perm.requiredPermission).toBe('screen');
    const tier = buildAccessDenied(deny('tier', { capability: 'exportDocx', requiredTier: 'professional', currentTier: 'free', message: 'x' }));
    expect(tier.error).toBe('TIER_LIMIT_EXCEEDED');
    expect(tier.requiredTier).toBe('professional');
    expect(tier.feature).toBe('exportDocx');
  });
  it('parseAccessError round-trips a served body', () => {
    const body = buildAccessDenied(deny('read_only', { capability: 'editExtraction', currentRole: 'viewer', message: 'View only.' }));
    const d = parseAccessError(body, 403);
    expect(d.restrictionType).toBe('read_only');
    expect(d.message).toBe('View only.');
    expect(d.technical).toBe('HTTP 403');
  });
  it('parseAccessError handles bare statuses without a structured body', () => {
    expect(parseAccessError(null, 403).restrictionType).toBe('permission');
    expect(parseAccessError(null, 401).restrictionType).toBe('membership');
    expect(parseAccessError(null, 503).restrictionType).toBe('temporarily_unavailable');
  });
  it('parseAccessError understands the legacy tier body', () => {
    const d = parseAccessError({ error: 'TIER_LIMIT_EXCEEDED', requiredTier: 'pro', currentTier: 'free', message: 'Upgrade.' }, 403);
    expect(d.restrictionType).toBe('tier');
    expect(d.requiredTier).toBe('pro');
  });
});

describe('resolver — roles', () => {
  const reviewer = { role: 'reviewer', isOwner: false, isLeader: false, perms: { canScreen: true, canRunAnalysis: false } };
  const leader = { role: 'leader', isOwner: false, isLeader: true, perms: {} };
  const owner = { role: 'owner', isOwner: true, isLeader: true, perms: {} };
  const admin = { role: null, isAdmin: true, perms: {} };

  it('deleteProject: owner allowed, reviewer denied owner_only', () => {
    expect(can('deleteProject', owner)).toBe(true);
    const d = resolveCapability('deleteProject', reviewer);
    expect(d.allowed).toBe(false);
    expect(d.restrictionType).toBe('owner_only');
    expect(d.message).toContain('owner');
  });
  it('manageMembers: leader allowed, reviewer denied leader_only', () => {
    expect(can('manageMembers', leader)).toBe(true);
    expect(resolveCapability('manageMembers', reviewer).restrictionType).toBe('leader_only');
  });
  it('runAnalysis: reviewer WITHOUT perm denied permission; WITH perm allowed', () => {
    expect(resolveCapability('runAnalysis', reviewer).restrictionType).toBe('permission');
    expect(can('runAnalysis', { ...reviewer, perms: { canRunAnalysis: true } })).toBe(true);
    expect(can('runAnalysis', leader)).toBe(true); // leaders always
  });
  it('view-only member editing → read_only framing', () => {
    const viewer = { role: 'viewer', perms: { readOnlyMetaLab: true } };
    const d = resolveCapability('editExtraction', viewer);
    expect(d.restrictionType).toBe('read_only');
    expect(d.tone).toBe('info');
  });
  it('configureGuidedScreening: admin only', () => {
    expect(can('configureGuidedScreening', admin)).toBe(true);
    expect(resolveCapability('configureGuidedScreening', leader).restrictionType).toBe('admin_only');
    // regular screener can still runScoring
    expect(can('runScoring', reviewer)).toBe(true);
  });
});

describe('resolver — tier + archived', () => {
  it('tier capability (wordExport) gated by hasEntitlement + admin bypass', () => {
    const free = { tierId: 'free', hasEntitlement: (k) => k === 'never', requiredTierFor: () => 'professional' };
    const d = resolveCapability('wordExport', free);
    expect(d.allowed).toBe(false);
    expect(d.restrictionType).toBe('tier');
    expect(d.requiredTier).toBe('professional');
    expect(d.currentTier).toBe('free');
    expect(d.nextAction.type).toBe('upgrade');
    // grant via entitlement
    expect(can('wordExport', { hasEntitlement: (k) => k === 'manuscript.wordExport' })).toBe(true);
    // admin bypass
    expect(can('networkMetaAnalysis', { isAdmin: true })).toBe(true);
  });
  it('archived project blocks EDIT capabilities for everyone incl. owner', () => {
    const owner = { role: 'owner', isOwner: true, isLeader: true, perms: {}, project: { archived: true } };
    const d = resolveCapability('runAnalysis', owner);
    expect(d.restrictionType).toBe('archived');
    // a non-edit capability is unaffected
    expect(can('viewAdminMetrics', { isAdmin: true, project: { archived: true } })).toBe(true);
  });
  it('ctxFromProjectAccess maps the getProjectAccess shape', () => {
    const ctx = ctxFromProjectAccess({ isOwner: false, isLeader: false, role: 'reviewer', perms: { canScreen: true } }, { isAdmin: false });
    expect(ctx.role).toBe('reviewer');
    expect(ctx.perms.canScreen).toBe(true);
    expect(can('screen', ctx)).toBe(true);
  });
});

describe('resolveCapabilities batch', () => {
  it('returns a decision per key', () => {
    const map = resolveCapabilities(['deleteProject', 'screen'], { role: 'reviewer', perms: { canScreen: true } });
    expect(map.deleteProject.allowed).toBe(false);
    expect(map.screen.allowed).toBe(true);
  });
});

describe('review fixes — fail-closed / active / metalab perms / nextAction round-trip', () => {
  it('unknown capability FAILS CLOSED (deny), never silently authorizes', () => {
    const d = resolveCapability('runAnalysisTypo', { isOwner: true, isAdmin: true });
    expect(d.allowed).toBe(false);
    expect(d.technical).toBe('unknown capability');
    expect(can('totallyMadeUp', { isAdmin: true })).toBe(false);
  });
  it('inactive membership cannot perform EDIT actions even with the flag', () => {
    const d = resolveCapability('screen', { role: 'reviewer', active: false, perms: { canScreen: true } });
    expect(d.allowed).toBe(false);
    expect(d.restrictionType).toBe('membership');
    // active member with the flag still allowed
    expect(can('screen', { role: 'reviewer', active: true, perms: { canScreen: true } })).toBe(true);
  });
  it('ctxFromProjectAccess reconstructs META·LAB flags when there is no perms bundle', () => {
    // mlAccessFromMember shape: top-level canEdit/canRunAnalysis/canExport, NO perms object.
    const ml = { role: 'reviewer', isOwner: false, isLeader: false, canView: true, canEdit: true, canRunAnalysis: true, canExport: true, canAssessRiskOfBias: true };
    const ctx = ctxFromProjectAccess(ml);
    expect(can('runAnalysis', ctx)).toBe(true);
    expect(can('editExtraction', ctx)).toBe(true);   // mapped from canEdit
    expect(can('assessRiskOfBias', ctx)).toBe(true);
    expect(can('exportProject', ctx)).toBe(true);
  });
  it('an explicitly-suppressed nextAction survives the body round-trip', () => {
    const suppressed = deny('membership', { capability: 'x', message: 'No access.', nextAction: null });
    expect(suppressed.nextAction).toBe(null);
    const back = parseAccessError(buildAccessDenied(suppressed), 403);
    expect(back.nextAction).toBe(null); // did NOT resurrect the type default
  });
});
