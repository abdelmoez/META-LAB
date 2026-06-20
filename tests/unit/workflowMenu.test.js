/**
 * workflowMenu.test.js — prompt39 Tasks 5/6/7. The centralized, pure workflow-menu
 * collapse rules: classification (workflow step vs project meta-tab) and the
 * pin/auto auto-collapse decision.
 */
import { describe, it, expect } from 'vitest';
import { makeWorkflowMenuRules, normalizeWorkflowMenuMode } from '../../src/frontend/pages/workflowMenu.js';

// A representative slice of the real TABS config (meta-lab-3-patched.jsx).
const TABS = [
  { id: 'overview',   phase: null,      group: 'project' },
  { id: 'control',    phase: null,      group: 'project' },
  { id: 'pico',       phase: 'Plan' },
  { id: 'screening',  phase: 'Screen' },
  { id: 'extraction', phase: 'Extract' },
  { id: 'rob',        phase: 'Extract' },
  { id: 'analysis',   phase: 'Analyze' },
  { id: 'grade',      phase: 'Report' },
  { id: 'methods',    phase: null,      group: 'reference' },
];

const rules = makeWorkflowMenuRules(TABS);

describe('makeWorkflowMenuRules — classification', () => {
  it('flags real workflow steps (tabs with a phase) as focus routes', () => {
    for (const id of ['pico', 'screening', 'extraction', 'rob', 'analysis', 'grade']) {
      expect(rules.isWorkflowFocusRoute(id)).toBe(true);
    }
  });
  it('does NOT treat Overview / Project Control / reference tabs as workflow routes', () => {
    expect(rules.isWorkflowFocusRoute('overview')).toBe(false);
    expect(rules.isWorkflowFocusRoute('control')).toBe(false);
    expect(rules.isWorkflowFocusRoute('methods')).toBe(false);
  });
  it('flags Overview and Project Control as non-collapsing project routes', () => {
    expect(rules.isNonCollapsingProjectRoute('overview')).toBe(true);
    expect(rules.isNonCollapsingProjectRoute('control')).toBe(true);
    expect(rules.isNonCollapsingProjectRoute('pico')).toBe(false);
    expect(rules.isNonCollapsingProjectRoute('methods')).toBe(false); // reference group, not project
  });
});

describe('shouldAutoCollapseWorkflowMenu — pin/auto rule', () => {
  it('AUTO mode: collapses when navigating TO a workflow step', () => {
    expect(rules.shouldAutoCollapseWorkflowMenu({ toId: 'screening', mode: 'auto' })).toBe(true);
    expect(rules.shouldAutoCollapseWorkflowMenu({ toId: 'rob', mode: 'auto' })).toBe(true);
  });
  it('AUTO mode: never collapses for Overview or Project Control', () => {
    expect(rules.shouldAutoCollapseWorkflowMenu({ toId: 'overview', mode: 'auto' })).toBe(false);
    expect(rules.shouldAutoCollapseWorkflowMenu({ toId: 'control', mode: 'auto' })).toBe(false);
  });
  it('PINNED mode: never auto-collapses anywhere, including workflow steps', () => {
    expect(rules.shouldAutoCollapseWorkflowMenu({ toId: 'screening', mode: 'pinned' })).toBe(false);
    expect(rules.shouldAutoCollapseWorkflowMenu({ toId: 'rob', mode: 'pinned' })).toBe(false);
    expect(rules.shouldAutoCollapseWorkflowMenu({ toId: 'overview', mode: 'pinned' })).toBe(false);
  });
  it('unknown / reference tabs never collapse', () => {
    expect(rules.shouldAutoCollapseWorkflowMenu({ toId: 'methods', mode: 'auto' })).toBe(false);
    expect(rules.shouldAutoCollapseWorkflowMenu({ toId: 'nope', mode: 'auto' })).toBe(false);
  });
  it('tolerates empty/no args', () => {
    expect(rules.shouldAutoCollapseWorkflowMenu()).toBe(false);
    expect(makeWorkflowMenuRules().shouldAutoCollapseWorkflowMenu({ toId: 'x', mode: 'auto' })).toBe(false);
  });
});

describe('normalizeWorkflowMenuMode', () => {
  it('maps only explicit "auto" to auto; everything else (incl null/legacy) to pinned (prompt44 item 3 default)', () => {
    expect(normalizeWorkflowMenuMode('auto')).toBe('auto');
    expect(normalizeWorkflowMenuMode('pinned')).toBe('pinned');
    expect(normalizeWorkflowMenuMode(null)).toBe('pinned');
    expect(normalizeWorkflowMenuMode(undefined)).toBe('pinned');
    expect(normalizeWorkflowMenuMode('garbage')).toBe('pinned');
  });
});
