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
import { describe, it, expect, beforeEach } from 'vitest';
import {
  submenuForCategory, searchStageHref, readSearchStageParam, activeSubmenuKey,
  categoryShowsSubmenu, categoryForStage,
} from '../../src/frontend/stitch/nav/navConfig.js';
import { submenuSteps } from '../../src/frontend/stitch/nav/stepperModel.js';
import { stagesFor } from '../../src/features/searchWorkspace/searchStages.js';
// 85.md — the additive per-stage status flows from the shared store the mounted
// workspace publishes to (glyph-less fallback otherwise).
import { publishSearchStageStatuses, __resetSearchModeStore } from '../../src/features/searchWorkspace/searchModeStore.js';

// 75.md recs (Finding 1) — the numbered Search WORKFLOW submenu is gated behind the
// staged workspace flag (searchWorkspaceV2), because only then does the body honour
// `?stage=`. Every "9 stages" test therefore threads searchWorkspaceV2Enabled:true; a
// dedicated block below pins the legacy single-'Search' fallback when the flag is off.
const CTX = { projectId: 'p1', linkedSiftId: 's1', searchWorkspaceV2Enabled: true };
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

describe('85.md — additive per-stage `status` on the Search submenu items', () => {
  beforeEach(() => __resetSearchModeStore());

  it('no published statuses → status:null on every stage item (glyph-less fallback)', () => {
    const items = submenuForCategory('search', CTX);
    for (const it2 of items.filter((i) => !i.utility)) expect(it2.status).toBeNull();
  });

  it('an explicit ctx.searchStageStatuses wins and maps per stage id', () => {
    const items = submenuForCategory('search', {
      ...CTX,
      searchStageStatuses: { question: 'done', concepts: 'partial', terms: 'attention' },
    });
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.question.status).toBe('done');
    expect(byKey.concepts.status).toBe('partial');
    expect(byKey.terms.status).toBe('attention');
    expect(byKey.mode.status).toBeNull(); // unknown stages stay glyph-less
  });

  it('falls back to the shared store the mounted workspace publishes to', () => {
    publishSearchStageStatuses('p1', { question: 'done', screening: 'empty' });
    const items = submenuForCategory('search', CTX);
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.question.status).toBe('done');
    expect(byKey.screening.status).toBe('empty');
  });

  it('submenuSteps prefers the item status over the legacy statusMap', () => {
    const steps = submenuSteps('search', {
      ...CTX,
      searchStageStatuses: { question: 'done', concepts: 'attention' },
    }, { statusMap: {} });
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey.question.status).toBe('done');
    expect(byKey.concepts.status).toBe('attention');
    expect(byKey.terms.status).toBe('empty'); // no truth → the calm default
    expect(byKey.living.status).toBeNull();   // utility rows stay status-less
  });

  it('the legacy (flag OFF) single-Search submenu is untouched by the store', () => {
    publishSearchStageStatuses('p1', { question: 'done' });
    const items = submenuForCategory('search', { projectId: 'p1', linkedSiftId: 's1' });
    const search = items.find((i) => i.key === 'search');
    expect(search.status).toBeUndefined(); // legacy item shape is unchanged
    expect(search.completionKey).toBe('search');
  });
});

describe('75.md recs (Finding 1) — flag OFF falls back to the legacy single-Search submenu', () => {
  // With searchWorkspaceV2 off (default prod) the body renders the legacy
  // SearchWizard/SearchTab, which has NO `?stage=` support. The submenu must NOT show a
  // row of numbered stages that would dead-end — it shows the single 'Search'
  // destination (`?tab=search`) it did pre-75, plus the optional tools.
  const OFF = { projectId: 'p1', linkedSiftId: 's1' }; // no searchWorkspaceV2Enabled

  it('flag absent → a SINGLE numbered "Search" step (not the 9-stage workflow)', () => {
    const items = submenuForCategory('search', OFF);
    expect(stageKeysOf(items)).toEqual(['search']);
    const search = items.find((i) => i.key === 'search');
    expect(search.href).toBe('/app/project/p1?tab=search'); // the classic host route, no ?stage=
    expect(search.completionKey).toBe('search');
    // NONE of the workflow stage ids leak into the legacy submenu.
    for (const id of ['question', 'concepts', 'terms', 'mode', 'strategy', 'refine', 'documentation']) {
      expect(items.some((i) => i.key === id)).toBe(false);
    }
  });

  it('flag explicitly false → identical legacy fallback', () => {
    expect(stageKeysOf(submenuForCategory('search', { ...OFF, searchWorkspaceV2Enabled: false }))).toEqual(['search']);
  });

  it('the optional tools group STILL appears (both modes) and stays flag-gated', () => {
    expect(toolsOf(submenuForCategory('search', OFF)).map((i) => i.key)).toEqual(['living']);
    const withCite = submenuForCategory('search', { ...OFF, citationMiningEnabled: true });
    expect(toolsOf(withCite).map((i) => i.key)).toEqual(['living', 'citation']);
    expect(withCite.find((i) => i.key === 'living').groupLabel).toBe('Optional tools');
  });

  it('still shows a persistent submenu (legacy Search + Living = 2 navigable children)', () => {
    // categoryShowsSubmenu probes WITHOUT the flag → it must exercise the legacy path.
    expect(categoryShowsSubmenu('search')).toBe(true);
  });

  it('submenuSteps numbers the single legacy Search step 1 with its status + helper copy', () => {
    const steps = submenuSteps('search', OFF, { statusMap: { search: 'partial' } });
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey.search.num).toBe(1);
    expect(byKey.search.status).toBe('partial');
    expect(byKey.search.desc).toBe('Build and run your multi-database search');
    // the optional tool stays an un-numbered utility row
    expect(byKey.living.num).toBeNull();
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
