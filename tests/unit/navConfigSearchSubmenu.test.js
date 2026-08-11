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
// `?stage=`. Every numbered-stages test therefore threads searchWorkspaceV2Enabled:true;
// a dedicated block below pins the legacy single-'Search' fallback when the flag is off.
const CTX = { projectId: 'p1', linkedSiftId: 's1', searchWorkspaceV2Enabled: true };
const stageKeysOf = (items) => items.filter((i) => !i.utility).map((i) => i.key);
const toolsOf = (items) => items.filter((i) => i.utility);

describe('75.md — submenuForCategory("search") is the mode-scoped Search workflow', () => {
  it('undecided / manual → the full 6-stage numbered workflow (96/98.md — concepts/refine/question retired)', () => {
    for (const ctx of [CTX, { ...CTX, searchMode: null }, { ...CTX, searchMode: 'manual' }]) {
      const items = submenuForCategory('search', ctx);
      expect(stageKeysOf(items)).toEqual([
        'terms', 'mode', 'strategy', 'results', 'documentation', 'screening',
      ]);
    }
  });

  it('automated → drops Database Strategies (5 numbered stages) — matches stagesFor', () => {
    const items = submenuForCategory('search', { ...CTX, searchMode: 'automated' });
    expect(stageKeysOf(items)).toEqual([
      'terms', 'mode', 'results', 'documentation', 'screening',
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
    const t = items.find((i) => i.key === 'terms');
    expect(t.href).toBe('/app/project/p1?tab=search&stage=terms');
    expect(t.label).toBe('Select & Build Key Terms');
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
      searchStageStatuses: { terms: 'attention', strategy: 'done' },
    });
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.terms.status).toBe('attention');
    expect(byKey.strategy.status).toBe('done');
    expect(byKey.mode.status).toBeNull(); // unknown stages stay glyph-less
  });

  it('falls back to the shared store the mounted workspace publishes to', () => {
    publishSearchStageStatuses('p1', { terms: 'done', screening: 'empty' });
    const items = submenuForCategory('search', CTX);
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.terms.status).toBe('done');
    expect(byKey.screening.status).toBe('empty');
  });

  it('submenuSteps prefers the item status over the legacy statusMap', () => {
    const steps = submenuSteps('search', {
      ...CTX,
      searchStageStatuses: { terms: 'attention', strategy: 'done' },
    }, { statusMap: {} });
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey.terms.status).toBe('attention');
    expect(byKey.strategy.status).toBe('done');
    expect(byKey.mode.status).toBe('empty'); // no truth → the calm default
    expect(byKey.living.status).toBeNull();   // utility rows stay status-less
  });

  it('the legacy (flag OFF) single-Search submenu is untouched by the store', () => {
    publishSearchStageStatuses('p1', { terms: 'done' });
    const items = submenuForCategory('search', { projectId: 'p1', linkedSiftId: 's1' });
    const search = items.find((i) => i.key === 'search');
    expect(search.status).toBeUndefined(); // legacy item shape is unchanged
    expect(search.completionKey).toBe('search');
  });
});

/* 114.md §2 r2 — the ADVISORY count reaches the WHITE STEPPER.
   The in-body rail's advisory pill never renders in the production Stitch shell (the
   side-menu stepper hides that rail), so the counts have to travel: workspace → store
   → submenu item.advisory → step.count. They ride BESIDE the status and never demote
   it: a strategy with pending review items is still 'done'. */
describe('114.md §2 — per-stage advisory counts on the Search submenu + stepper', () => {
  beforeEach(() => __resetSearchModeStore());

  const MODEL = {
    statuses: { terms: 'done', mode: 'done' },
    advisories: { terms: { suggestions: 2, warnings: 0, total: 2 }, mode: { suggestions: 0, warnings: 0, total: 0 } },
  };

  it('no advisories published → advisory:null on every stage item', () => {
    const items = submenuForCategory('search', CTX);
    for (const it2 of items.filter((i) => !i.utility)) expect(it2.advisory).toBeNull();
  });

  it('attaches { total, label } from the shared store, and NOTHING for a clean stage', () => {
    publishSearchStageStatuses('p1', MODEL);
    const byKey = Object.fromEntries(submenuForCategory('search', CTX).map((i) => [i.key, i]));
    expect(byKey.terms.advisory).toEqual({ total: 2, label: '2 suggestions to review' });
    expect(byKey.mode.advisory).toBeNull();     // total 0 → no pill, no count line
    expect(byKey.strategy.advisory).toBeNull(); // no advisory for this stage at all
  });

  it('an explicit ctx.searchStageAdvisories wins over the store (host threading / tests)', () => {
    publishSearchStageStatuses('p1', MODEL);
    const byKey = Object.fromEntries(submenuForCategory('search', {
      ...CTX,
      searchStageAdvisories: { terms: { suggestions: 0, warnings: 1, total: 1 } },
    }).map((i) => [i.key, i]));
    expect(byKey.terms.advisory).toEqual({ total: 1, label: '1 quality note to review' });
  });

  it('the label is composed honestly per split — suggestions / quality notes / both', () => {
    const labelFor = (adv) => submenuForCategory('search', { ...CTX, searchStageAdvisories: { terms: adv } })
      .find((i) => i.key === 'terms').advisory.label;
    expect(labelFor({ suggestions: 2, warnings: 0, total: 2 })).toBe('2 suggestions to review');
    expect(labelFor({ suggestions: 0, warnings: 2, total: 2 })).toBe('2 quality notes to review');
    expect(labelFor({ suggestions: 2, warnings: 1, total: 3 })).toBe('2 suggestions, 1 quality note');
  });

  it('submenuSteps threads the advisory into `count` — which the stepper shows INSTEAD of desc', () => {
    publishSearchStageStatuses('p1', MODEL);
    const byKey = Object.fromEntries(submenuSteps('search', CTX, { statusMap: {} }).map((s) => [s.key, s]));
    // The stage keeps its earned status (green/done) — the count never demotes it.
    expect(byKey.terms.status).toBe('done');
    expect(byKey.terms.count).toBe('2 suggestions to review');
    // …and a stage with nothing to review keeps its ordinary helper copy.
    expect(byKey.mode.count).toBeNull();
    expect(byKey.strategy.count).toBeNull();
    expect(typeof byKey.strategy.desc).toBe('string');
  });

  it('advisories NEVER reach a utility row, and an attention stage is unaffected', () => {
    publishSearchStageStatuses('p1', {
      statuses: { terms: 'attention' },
      advisories: { terms: { suggestions: 0, warnings: 0, total: 0 } },
    });
    const byKey = Object.fromEntries(submenuSteps('search', CTX, { statusMap: {} }).map((s) => [s.key, s]));
    expect(byKey.terms.status).toBe('attention');
    expect(byKey.terms.count).toBeNull();   // a blocker is not a review item
    expect(byKey.living.count).toBeNull();
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
    for (const id of ['terms', 'mode', 'strategy', 'documentation']) {
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
  it('builds a stage deep link (98.md §3 — the default stage is terms)', () => {
    expect(searchStageHref('terms', { projectId: 'p1' })).toBe('/app/project/p1?tab=search&stage=terms');
    expect(searchStageHref('mode', { projectId: 'a b' })).toBe('/app/project/a%20b?tab=search&stage=mode');
    expect(searchStageHref(undefined, { projectId: 'p1' })).toBe('/app/project/p1?tab=search&stage=terms');
  });
  it('reads ?stage= (bare ?tab=search → terms, 98.md §3)', () => {
    expect(readSearchStageParam('?tab=search&stage=mode')).toBe('mode');
    expect(readSearchStageParam('?tab=search')).toBe('terms');
    expect(readSearchStageParam('')).toBe('terms');
  });
  it('96/98.md — RETIRED stage params (incl. question) resolve through STAGE_ALIASES to terms', () => {
    expect(readSearchStageParam('?tab=search&stage=concepts')).toBe('terms');
    expect(readSearchStageParam('?tab=search&stage=refine')).toBe('terms');
    expect(readSearchStageParam('?tab=search&stage=question')).toBe('terms');
    expect(activeSubmenuKey('?tab=search&stage=concepts')).toBe('terms');
    expect(activeSubmenuKey('?tab=search&stage=refine')).toBe('terms');
    expect(activeSubmenuKey('?tab=search&stage=question')).toBe('terms');
  });
  it('a blank/absent ?stage= value falls back to terms (the workflow home)', () => {
    expect(readSearchStageParam('?tab=search&stage=')).toBe('terms'); // blank value → the default
    expect(readSearchStageParam(null)).toBe('terms');
    expect(readSearchStageParam(undefined)).toBe('terms');
  });
  it('activeSubmenuKey resolves the Search stage, and Living/Citation match their own key', () => {
    expect(activeSubmenuKey('?tab=search&stage=terms')).toBe('terms');
    expect(activeSubmenuKey('?tab=search')).toBe('terms');
    expect(activeSubmenuKey('?tab=living')).toBe('living');
    expect(activeSubmenuKey('?tab=citation')).toBe('citation');
    // unchanged for the other categories
    expect(activeSubmenuKey('?tab=screening&screen=conflicts')).toBe('conflicts');
    expect(activeSubmenuKey('?tab=pico')).toBe('pico');
  });
});

describe('75.md — submenuSteps("search"): numbered workflow + un-numbered optional tools', () => {
  it('numbers ONLY the workflow stages 1..6; Living/Citation are num:null utility rows', () => {
    const steps = submenuSteps('search', { ...CTX, citationMiningEnabled: true }, { statusMap: {} });
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(byKey.terms.num).toBe(1);
    expect(byKey.screening.num).toBe(6);
    // the numbered stages count 1..6 with no gaps
    const nums = steps.filter((s) => s.num != null).map((s) => s.num);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6]);
    // optional tools are NOT numbered
    expect(byKey.living.num).toBeNull();
    expect(byKey.citation.num).toBeNull();
    // and the group label survives to the stepper for the separator
    expect(byKey.living.groupLabel).toBe('Optional tools');
    // per-stage helper copy comes from the stage table
    expect(byKey.terms.desc).toBe('Build your search');
  });

  it('automated → 5 numbered stages (Database Strategies gone), tools unchanged', () => {
    const steps = submenuSteps('search', { ...CTX, searchMode: 'automated' }, { statusMap: {} });
    const nums = steps.filter((s) => s.num != null).map((s) => s.num);
    expect(nums).toEqual([1, 2, 3, 4, 5]);
    expect(steps.some((s) => s.key === 'strategy')).toBe(false);
    expect(steps.find((s) => s.key === 'living').num).toBeNull();
  });
});
