/**
 * navConfigSearchSubmenu.test.js — 75.md: the Search workflow moves into the WHITE
 * project side-menu. Pure tests over navConfig + the shared stepperModel:
 *   - submenuForCategory('search') emits the mode-scoped Search WORKFLOW (numbered
 *     stages, ?tab=search&stage= deep links) — the SAME list the in-body workspace
 *     uses (automated drops Database Strategies), so the two surfaces can't drift;
 *   - Living Review + Citation Mining are UN-numbered "Optional tools" (utility rows,
 *     num:null in the stepper) in a visually-separate group, never in the 1..N count;
 *   - Citation Mining stays flag-gated (ctx.citationMiningEnabled);
 *   - searchStageHref / readSearchStageParam / activeSubmenuKey resolve the ?stage=.
 */
import { describe, it, expect } from 'vitest';
import {
  submenuForCategory, searchStageHref, readSearchStageParam, activeSubmenuKey,
  categoryShowsSubmenu, categoryForStage,
} from '../../src/frontend/stitch/nav/navConfig.js';
import { submenuSteps } from '../../src/frontend/stitch/nav/stepperModel.js';
import { stagesFor } from '../../src/features/searchWorkspace/searchStages.js';

const CTX = { projectId: 'p1', linkedSiftId: 's1' };
const stageKeysOf = (items) => items.filter((i) => !i.utility).map((i) => i.key);
const toolsOf = (items) => items.filter((i) => i.utility);

describe('75.md — submenuForCategory("search") is the mode-scoped Search workflow', () => {
  it('undecided / manual → the full 9-stage numbered workflow (existing projects keep working)', () => {
    for (const ctx of [CTX, { ...CTX, searchMode: null }, { ...CTX, searchMode: 'manual' }]) {
      const items = submenuForCategory('search', ctx);
      expect(stageKeysOf(items)).toEqual([
        'question', 'concepts', 'terms', 'mode', 'strategy', 'refine', 'results', 'documentation', 'screening',
      ]);
    }
  });

  it('automated → drops Database Strategies (8 numbered stages) — matches stagesFor', () => {
    const items = submenuForCategory('search', { ...CTX, searchMode: 'automated' });
    expect(stageKeysOf(items)).toEqual([
      'question', 'concepts', 'terms', 'mode', 'refine', 'results', 'documentation', 'screening',
    ]);
    expect(stageKeysOf(items).some((k) => k === 'strategy')).toBe(false);
  });

  it('no-drift: the numbered stage keys ALWAYS equal stagesFor(mode) (the one source of truth)', () => {
    for (const mode of [undefined, null, 'manual', 'automated']) {
      const items = submenuForCategory('search', { ...CTX, searchMode: mode });
      expect(stageKeysOf(items)).toEqual(stagesFor(mode == null ? null : mode).map((s) => s.id));
    }
  });

  it('each stage is a ?tab=search&stage=<id> deep link, labelled from the stage table', () => {
    const items = submenuForCategory('search', CTX);
    const q = items.find((i) => i.key === 'question');
    expect(q.href).toBe('/app/project/p1?tab=search&stage=question');
    expect(q.label).toBe('Research Question');
    expect(items.find((i) => i.key === 'screening').href).toBe('/app/project/p1?tab=search&stage=screening');
    // no stage item is disabled from the nav layer (in-body gating handles needsConcepts)
    expect(items.filter((i) => !i.utility).every((i) => !!i.href)).toBe(true);
  });

  it('Living Review is an UN-numbered optional tool opening its own tab + the group label', () => {
    const items = submenuForCategory('search', CTX);
    const living = items.find((i) => i.key === 'living');
    expect(living.utility).toBe(true);
    expect(living.href).toBe('/app/project/p1?tab=living');
    expect(living.groupLabel).toBe('Optional tools'); // first optional tool carries the separator
    // it sorts AFTER every numbered stage
    expect(items.indexOf(living)).toBe(stageKeysOf(items).length);
  });

  it('Citation Mining joins the optional tools ONLY when the flag is on (OFF ⇒ unchanged)', () => {
    expect(toolsOf(submenuForCategory('search', CTX)).map((i) => i.key)).toEqual(['living']);
    const withFlag = submenuForCategory('search', { ...CTX, citationMiningEnabled: true });
    expect(toolsOf(withFlag).map((i) => i.key)).toEqual(['living', 'citation']);
    const cite = withFlag.find((i) => i.key === 'citation');
    expect(cite.utility).toBe(true);
    expect(cite.href).toBe('/app/project/p1?tab=citation');
    // the group label rides the FIRST tool only
    expect(cite.groupLabel).toBeUndefined();
    expect(withFlag.find((i) => i.key === 'living').groupLabel).toBe('Optional tools');
  });

  it('still opens a persistent white submenu; Living/Citation stay in the Search category', () => {
    expect(categoryShowsSubmenu('search')).toBe(true);
    expect(categoryForStage('living')).toBe('search');
    expect(categoryForStage('citation')).toBe('search');
  });
});

describe('75.md — searchStageHref / readSearchStageParam / activeSubmenuKey', () => {
  it('builds a stage deep link', () => {
    expect(searchStageHref('concepts', { projectId: 'p1' })).toBe('/app/project/p1?tab=search&stage=concepts');
    expect(searchStageHref('mode', { projectId: 'a b' })).toBe('/app/project/a%20b?tab=search&stage=mode');
    expect(searchStageHref(undefined, { projectId: 'p1' })).toBe('/app/project/p1?tab=search&stage=question');
  });
  it('reads ?stage= (bare ?tab=search → question)', () => {
    expect(readSearchStageParam('?tab=search&stage=refine')).toBe('refine');
    expect(readSearchStageParam('?tab=search')).toBe('question');
    expect(readSearchStageParam('')).toBe('question');
  });
  it('activeSubmenuKey resolves the Search stage, and Living/Citation match their own key', () => {
    expect(activeSubmenuKey('?tab=search&stage=terms')).toBe('terms');
    expect(activeSubmenuKey('?tab=search')).toBe('question');
    expect(activeSubmenuKey('?tab=living')).toBe('living');
    expect(activeSubmenuKey('?tab=citation')).toBe('citation');
    // unchanged for the other categories
    expect(activeSubmenuKey('?tab=screening&screen=conflicts')).toBe('conflicts');
    expect(activeSubmenuKey('?tab=pico')).toBe('pico');
  });
});

describe('75.md — submenuSteps("search"): numbered workflow + un-numbered optional tools', () => {
  it('numbers ONLY the workflow stages 1..9; Living/Citation are num:null utility rows', () => {
    const steps = submenuSteps('search', { ...CTX, citationMiningEnabled: true }, { statusMap: {} });
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey.question.num).toBe(1);
    expect(byKey.screening.num).toBe(9);
    // the numbered stages count 1..9 with no gaps
    const nums = steps.filter((s) => s.num != null).map((s) => s.num);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // optional tools are NOT numbered
    expect(byKey.living.num).toBeNull();
    expect(byKey.citation.num).toBeNull();
    // and the group label survives to the stepper for the separator
    expect(byKey.living.groupLabel).toBe('Optional tools');
    // per-stage helper copy comes from the stage table
    expect(byKey.question.desc).toBe('Frame the question');
  });

  it('automated → 8 numbered stages (Database Strategies gone), tools unchanged', () => {
    const steps = submenuSteps('search', { ...CTX, searchMode: 'automated' }, { statusMap: {} });
    const nums = steps.filter((s) => s.num != null).map((s) => s.num);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(steps.some((s) => s.key === 'strategy')).toBe(false);
    expect(steps.find((s) => s.key === 'living').num).toBeNull();
  });
});
