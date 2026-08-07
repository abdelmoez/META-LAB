/**
 * stitch/nav/workflowSequence.js — 104.md Part 1 ("Navigation must remain available").
 *
 * Focus Mode hides the rail and the white submenu, so it needs Previous/Next. The
 * prompt is emphatic about how: *"Do not create a separate navigation system with
 * different logic. Reuse the application's existing routing/step definitions so the
 * normal navigation and Full Screen navigation cannot become inconsistent."*
 *
 * So this module invents nothing. It FLATTENS the existing nav model — the same
 * `PROJECT_CATEGORIES` the purple rail renders, each expanded through the same
 * `submenuForCategory()` the white column renders — into the single linear order a
 * user would traverse by clicking down the sidebar. Every destination is the href
 * the sidebar itself would produce.
 *
 * Two consequences fall out for free, which is the point of deriving rather than
 * restating:
 *   - a step the sidebar shows as disabled (screening sub-pages with no linked
 *     workspace ⇒ `href: null`) is disabled here too, so Next cannot smuggle a user
 *     past a gate the normal UI closes;
 *   - a step that only exists behind a feature flag (Citation Mining, the staged
 *     Search workflow) appears here exactly when it appears in the sidebar.
 *
 * Pure — no React, no router. Unit-testable in isolation.
 */
import {
  PROJECT_CATEGORIES, submenuForCategory, categoryEntryHref,
  categoryForStage, activeSubmenuKey, activeProjectStage,
} from './navConfig.js';

/**
 * The ordered list of navigable destinations for a project, in sidebar order.
 *
 * @param {object} ctx  the SAME ctx the rail/subnav pass: { projectId, linkedSiftId,
 *                      searchMode?, searchWorkspaceV2Enabled?, citationMiningEnabled? }
 * @param {object} opts
 *   - isBlocked(stageId, item) → true to mark a step inaccessible for this user.
 *     Permission gates live at render time in the workspace (e.g. the Analysis
 *     capability check), not in the pure nav config, so the caller supplies them.
 *   - includeReference (default true) — the Reference page is a destination in the
 *     rail, so it is one here.
 * @returns {Array<{id,key,categoryId,categoryLabel,label,href,disabled,utility}>}
 */
export function buildWorkflowSequence(ctx = {}, opts = {}) {
  const { isBlocked, includeReference = true } = opts;
  const out = [];

  for (const cat of PROJECT_CATEGORIES) {
    if (!includeReference && cat.kind === 'reference') continue;

    const children = submenuForCategory(cat.id, ctx);
    if (Array.isArray(children) && children.length) {
      for (const c of children) {
        out.push(makeItem(cat, c.key, c.label, c.href, {
          utility: !!c.utility,
          stage: c.stage || stageForChild(cat, c.key),
          isBlocked,
        }));
      }
    } else {
      // A single-destination category (Overview / Project Control / Reference) is
      // itself one step.
      out.push(makeItem(cat, cat.stage || cat.id, cat.label, categoryEntryHref(cat.id, ctx), {
        stage: cat.stage || cat.id,
        isBlocked,
      }));
    }
  }

  return out;
}

/** Which workspace stage a submenu child ultimately lands on. */
function stageForChild(cat, key) {
  if (cat.kind === 'screen') return key === 'prisma' ? 'prisma' : 'screening';
  if (cat.id === 'search') return key === 'living' || key === 'citation' ? key : 'search';
  return key; // phase categories: the child key IS the stage id
}

function makeItem(cat, key, label, href, { utility = false, stage, isBlocked } = {}) {
  const blocked = typeof isBlocked === 'function' ? !!isBlocked(stage, { categoryId: cat.id, key }) : false;
  return {
    id: `${cat.id}:${key}`,
    key,
    stage,
    categoryId: cat.id,
    categoryLabel: cat.label,
    label,
    href: blocked ? null : (href || null),
    // A step with no destination cannot be navigated to — same rule the stepper
    // uses (`disabled: !it.href`, stepperModel.js).
    disabled: blocked || !href,
    utility,
  };
}

/**
 * Where the current URL sits in the sequence.
 *
 * Matches on `categoryId:submenuKey` — the exact pair the sidebar uses to decide
 * which row is highlighted — then falls back to the first item of the active
 * category. The fallback matters for stages that live under a category without
 * being one of its submenu rows (e.g. Project History renders under Project
 * Control), which would otherwise report "not in the workflow" and disable both
 * arrows.
 *
 * @returns {number} index, or -1 when the location isn't in the sequence at all.
 */
export function sequenceIndex(seq, search) {
  if (!Array.isArray(seq) || !seq.length) return -1;
  const stage = activeProjectStage(search);
  const catId = categoryForStage(stage);
  const key = activeSubmenuKey(search);

  const exact = seq.findIndex((s) => s.categoryId === catId && s.key === key);
  if (exact >= 0) return exact;

  const byStage = seq.findIndex((s) => s.categoryId === catId && s.stage === stage);
  if (byStage >= 0) return byStage;

  const byCat = seq.findIndex((s) => s.categoryId === catId);
  return byCat;
}

/**
 * The nearest navigable neighbours either side of `index`.
 *
 * Disabled steps are STEPPED OVER rather than offered-and-refused: a Next button
 * that lands on a locked page is worse than one that skips it, and skipping is
 * exactly what a user does with the sidebar in front of them. Nothing is bypassed —
 * a skipped step is one the sidebar would also refuse to open.
 */
export function sequenceNeighbours(seq, index) {
  const empty = { prev: null, next: null, prevIndex: -1, nextIndex: -1 };
  if (!Array.isArray(seq) || index < 0) return empty;

  let prevIndex = -1;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!seq[i].disabled) { prevIndex = i; break; }
  }
  let nextIndex = -1;
  for (let i = index + 1; i < seq.length; i += 1) {
    if (!seq[i].disabled) { nextIndex = i; break; }
  }
  return {
    prev: prevIndex >= 0 ? seq[prevIndex] : null,
    next: nextIndex >= 0 ? seq[nextIndex] : null,
    prevIndex,
    nextIndex,
  };
}

/**
 * A human label for a neighbour, for the "Next: Search Strategy" tooltip. Includes
 * the category when the step's own label doesn't identify it on its own ("Overview"
 * and "Settings" appear in more than one category).
 */
export function stepTitle(item) {
  if (!item) return '';
  if (!item.categoryLabel || item.categoryLabel === item.label) return item.label;
  return AMBIGUOUS.has(item.label) ? `${item.categoryLabel} · ${item.label}` : item.label;
}

const AMBIGUOUS = new Set(['Overview', 'Settings', 'Control', 'Export', 'Import']);

export default buildWorkflowSequence;
