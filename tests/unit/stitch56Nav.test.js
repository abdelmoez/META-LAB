/**
 * stitch56Nav.test.js — 56.md pure-logic contracts:
 *   · navConfig grouping + separators + Back to Projects (§7/§8)
 *   · presence total-members single source (§5)
 *   · Overview "My work" + "Attention required" role-aware models (§1 D/E)
 */
import { describe, it, expect } from 'vitest';
import {
  PROJECT_NAV_GROUPS, buildRailGroups, railWorkflowStepCount, projectsHref,
} from '../../src/frontend/stitch/nav/navConfig.js';
import { totalMembersOf } from '../../src/frontend/stitch/shell/presence.js';
import { buildMyWork, buildAttention } from '../../src/frontend/stitch/pages/overviewModel.js';

describe('56.md §7/§8 — rail grouping + Back to Projects', () => {
  it('defines exactly three conceptual groups in order', () => {
    expect(PROJECT_NAV_GROUPS.map((g) => g.id)).toEqual(['manage', 'workflow', 'resources']);
  });
  it('only the Research Workflow group is a stepper', () => {
    expect(PROJECT_NAV_GROUPS.find((g) => g.id === 'workflow').stepper).toBe(true);
    expect(PROJECT_NAV_GROUPS.find((g) => g.id === 'manage').stepper).toBe(false);
    expect(PROJECT_NAV_GROUPS.find((g) => g.id === 'resources').stepper).toBe(false);
  });
  it('buildRailGroups resolves categories and numbers the workflow steps 1..6', () => {
    const groups = buildRailGroups();
    expect(groups.map((g) => g.id)).toEqual(['manage', 'workflow', 'resources']);
    const manage = groups.find((g) => g.id === 'manage');
    expect(manage.categories.map((c) => c.id)).toEqual(['overview', 'control']);
    expect(manage.categories.every((c) => c.stepNum === null)).toBe(true);
    const workflow = groups.find((g) => g.id === 'workflow');
    expect(workflow.categories.map((c) => c.id)).toEqual(['plan', 'search', 'screen', 'extract', 'analyze', 'report']);
    expect(workflow.categories.map((c) => c.stepNum)).toEqual([1, 2, 3, 4, 5, 6]);
    const resources = groups.find((g) => g.id === 'resources');
    expect(resources.categories.map((c) => c.id)).toEqual(['reference']);
  });
  it('every resolved category keeps a label + icon', () => {
    for (const g of buildRailGroups()) {
      for (const c of g.categories) { expect(typeof c.label).toBe('string'); expect(typeof c.icon).toBe('string'); }
    }
  });
  it('railWorkflowStepCount is 6 and Back to Projects links to the dashboard (never history)', () => {
    expect(railWorkflowStepCount()).toBe(6);
    expect(projectsHref()).toBe('/app');
  });
});

describe('56.md §5 — one shared total-members source', () => {
  it('prefers the cached memberCount when present (identical on every page)', () => {
    expect(totalMembersOf({ _linkedMetaSift: { memberCount: 8 } }, [{}, {}])).toBe(8);
  });
  it('falls back to the roster length when no cached count', () => {
    expect(totalMembersOf({}, [{}, {}, {}])).toBe(3);
    expect(totalMembersOf({ _linkedMetaSift: { memberCount: 0 } }, [{}])).toBe(1);
  });
  it('returns undefined when neither source is available', () => {
    expect(totalMembersOf({}, null)).toBeUndefined();
    expect(totalMembersOf(null, undefined)).toBeUndefined();
  });
});

describe('56.md §1E — My work (role-aware, real data)', () => {
  const base = { statusMap: {}, readiness: { ok: true, missing: [] }, conflictsCount: 0, perms: { isOwner: true }, studyCount: 0 };

  it('is empty when nothing is actionable', () => {
    expect(buildMyWork(base)).toEqual([]);
  });
  it('surfaces open conflicts first, then protocol gaps', () => {
    const items = buildMyWork({ ...base, conflictsCount: 3, readiness: { ok: false, missing: ['P', 'I'] } });
    expect(items.map((i) => i.key)).toEqual(['conflicts', 'protocol']);
    expect(items[0].tone).toBe('danger');
  });
  it('includes risk-of-bias only for an owner/assessor with studies and incomplete RoB', () => {
    const items = buildMyWork({ ...base, studyCount: 5, statusMap: { rob: 'partial' } });
    expect(items.map((i) => i.key)).toContain('rob');
    const noPerm = buildMyWork({ ...base, studyCount: 5, statusMap: { rob: 'partial' }, perms: { isOwner: false, canAssessRiskOfBias: false } });
    expect(noPerm.map((i) => i.key)).not.toContain('rob');
  });
  it('shows nothing for read-only members (cannot act)', () => {
    const items = buildMyWork({ ...base, conflictsCount: 9, readiness: { ok: false, missing: ['P'] }, perms: { readOnly: true } });
    expect(items).toEqual([]);
  });
});

describe('56.md §1D — Attention required (prioritized)', () => {
  it('promotes unresolved conflicts to the top as high severity', () => {
    const out = buildAttention({ conflictsCount: 4, auditItems: [{ sev: 'low', phase: 'Plan', msg: 'x' }], phasePrimary: { Plan: 'pico' } });
    expect(out[0].key).toBe('conflicts');
    expect(out[0].sev).toBe('high');
    expect(out[0].stage).toBe('screening');
  });
  it('sorts audit items high → med → low and maps phase → stage', () => {
    const out = buildAttention({
      conflictsCount: 0,
      auditItems: [{ sev: 'low', phase: 'Plan', msg: 'a' }, { sev: 'high', phase: 'Extract', msg: 'b' }, { sev: 'med', phase: 'Search', msg: 'c' }],
      phasePrimary: { Plan: 'pico', Extract: 'extraction', Search: 'search' },
    });
    expect(out.map((i) => i.sev)).toEqual(['high', 'med', 'low']);
    expect(out[0].stage).toBe('extraction');
  });
  it('respects the limit', () => {
    const auditItems = Array.from({ length: 12 }, (_, i) => ({ sev: 'low', phase: 'Plan', msg: `m${i}` }));
    expect(buildAttention({ conflictsCount: 0, auditItems, phasePrimary: { Plan: 'pico' }, limit: 5 })).toHaveLength(5);
  });
});
