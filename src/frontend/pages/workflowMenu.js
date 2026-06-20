/**
 * workflowMenu.js — prompt39 Task 6. CENTRALIZED, pure classification + collapse
 * rules for the left workflow menu, extracted from the monolith so the behaviour
 * is unit-testable and lives in ONE place (no scattered auto-collapse conditions).
 *
 * Classification (derived from the TABS config):
 *   - "workflow focus" route  = a tab with a phase (a real workflow step:
 *      PICO, Protocol, Search, Screening, Extraction, RoB, Analysis, …).
 *   - "non-collapsing" route   = a project meta-tab (group "project": Overview,
 *      Project Control) — orientation/settings pages that must never throw the
 *      user into focus mode.
 *
 * Rule: the menu auto-collapses ONLY when navigating TO a workflow step AND the
 * user's menu mode is "auto" (not "pinned"). Overview / Project Control never
 * collapse; a pinned menu never auto-collapses anywhere.
 */
export function makeWorkflowMenuRules(tabs) {
  const workflow = new Set((tabs || []).filter((t) => t && t.phase).map((t) => t.id));
  const project  = new Set((tabs || []).filter((t) => t && t.group === 'project').map((t) => t.id));

  const isWorkflowFocusRoute = (tabId) => workflow.has(tabId);
  const isNonCollapsingProjectRoute = (tabId) => project.has(tabId);
  const shouldAutoCollapseWorkflowMenu = ({ toId, mode } = {}) => {
    if (mode === 'pinned') return false;                 // pinned → never auto-collapse
    if (isNonCollapsingProjectRoute(toId)) return false; // Overview / Project Control
    return isWorkflowFocusRoute(toId);                   // only real workflow steps
  };

  return {
    workflowTabIds: workflow,
    projectTabIds: project,
    isWorkflowFocusRoute,
    isNonCollapsingProjectRoute,
    shouldAutoCollapseWorkflowMenu,
  };
}

// Normalize any stored value to the two valid modes. prompt44 item 3 — the menu is
// PINNED by default, so null/legacy/garbage ⇒ "pinned"; only an explicit "auto" opts
// out. Mirrors the monolith's inline default so this stays the single source of truth.
export function normalizeWorkflowMenuMode(mode) {
  return mode === 'auto' ? 'auto' : 'pinned';
}
