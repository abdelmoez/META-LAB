/**
 * stitch55Categories.test.js — 55.md project-category navigation contract.
 * Pure tests over navConfig's category model: the 9 rail categories, route→active
 * category resolution, submenu visibility (Overview/Control/Reference suppress it),
 * submenu child resolution (incl. the special Screen category = screening sub-steps
 * + PRISMA), and active-submenu-key derivation from `?screen=`/`?tab=`.
 */
import { describe, it, expect } from 'vitest';
import {
  PROJECT_CATEGORIES, PROJECT_CATEGORY_IDS, categoryForStage, categoryShowsSubmenu,
  submenuForCategory, activeSubmenuKey, buildCategoryNav, readScreenParam,
} from '../../src/frontend/stitch/nav/navConfig.js';

const CTX = { projectId: 'p1', linkedSiftId: 'sift1' };

describe('55.md — the 9 project categories', () => {
  it('is exactly the 9 spec categories in workflow order', () => {
    expect(PROJECT_CATEGORY_IDS).toEqual([
      'overview', 'control', 'plan', 'search', 'screen', 'extract', 'analyze', 'report', 'reference',
    ]);
  });
  it('every category has a label + icon', () => {
    for (const c of PROJECT_CATEGORIES) {
      expect(typeof c.label).toBe('string');
      expect(c.label.length).toBeGreaterThan(0);
      expect(typeof c.icon).toBe('string');
    }
  });
});

describe('55.md — route → active category', () => {
  it('maps each workflow stage to its category', () => {
    expect(categoryForStage('overview')).toBe('overview');
    expect(categoryForStage('control')).toBe('control');
    expect(categoryForStage('pico')).toBe('plan');
    expect(categoryForStage('prospero')).toBe('plan');
    expect(categoryForStage('search')).toBe('search');
    expect(categoryForStage('discovery')).toBe('search');
    expect(categoryForStage('screening')).toBe('screen');
    expect(categoryForStage('prisma')).toBe('screen'); // PRISMA lives under Screen
    expect(categoryForStage('extraction')).toBe('extract');
    expect(categoryForStage('rob')).toBe('extract'); // RoB stays under Extract
    expect(categoryForStage('analysis')).toBe('analyze');
    expect(categoryForStage('nma')).toBe('analyze');
    expect(categoryForStage('grade')).toBe('report');
    expect(categoryForStage('manuscript')).toBe('report');
    expect(categoryForStage('methods')).toBe('reference');
  });
  it('falls back to overview for unknown/empty stages (deep links never break)', () => {
    expect(categoryForStage('')).toBe('overview');
    expect(categoryForStage('does-not-exist')).toBe('overview');
  });
  it('buildCategoryNav resolves active category from the search string', () => {
    expect(buildCategoryNav('?tab=rob').activeCategory).toBe('extract');
    expect(buildCategoryNav('').activeCategory).toBe('overview');
    expect(buildCategoryNav('?tab=screening&screen=conflicts').activeCategory).toBe('screen');
  });
});

describe('55.md — submenu visibility (Overview/Control/Reference reclaim width)', () => {
  it('suppresses the white submenu for overview, control, reference', () => {
    expect(categoryShowsSubmenu('overview')).toBe(false);
    expect(categoryShowsSubmenu('control')).toBe(false);
    expect(categoryShowsSubmenu('reference')).toBe(false);
    expect(submenuForCategory('overview', CTX)).toBeNull();
    expect(submenuForCategory('control', CTX)).toBeNull();
    expect(submenuForCategory('reference', CTX)).toBeNull();
  });
  it('shows the white submenu for multi-child categories', () => {
    for (const id of ['plan', 'search', 'screen', 'extract', 'analyze', 'report']) {
      expect(categoryShowsSubmenu(id)).toBe(true);
    }
  });
  // prompt60 folded discovery into the unified Search wizard (single child);
  // 66.md P6 adds the Living Review dashboard beside it, so Search opens a white
  // submenu again: Search wizard + Living Review (the latter is NOT a numbered
  // workflow step — same append pattern as PRISMA Flow inside Screen).
  it('search = Search wizard + Living Review (66.md P6)', () => {
    expect(categoryShowsSubmenu('search')).toBe(true);
    const items = submenuForCategory('search', CTX);
    expect(items.map((i) => i.key)).toEqual(['search', 'living']);
    expect(items[1].href).toBe('/app/project/p1?tab=living');
  });
});

describe('55.md — submenu children', () => {
  it('plan = PICO + Protocol with real hrefs', () => {
    const items = submenuForCategory('plan', CTX);
    expect(items.map((i) => i.key)).toEqual(['pico', 'prospero']);
    expect(items[0].href).toBe('/app/project/p1?tab=pico');
  });
  it('extract = Data Extraction + Risk of Bias', () => {
    expect(submenuForCategory('extract', CTX).map((i) => i.key)).toEqual(['extraction', 'rob']);
  });
  it('analyze includes all five analysis stages', () => {
    expect(submenuForCategory('analyze', CTX).map((i) => i.key)).toEqual(
      ['analysis', 'forest', 'sensitivity', 'subgroup', 'nma'],
    );
  });
  it('screen exposes the full screening sub-workflow + PRISMA (import → export, then PRISMA)', () => {
    const keys = submenuForCategory('screen', CTX).map((i) => i.key);
    expect(keys).toEqual([
      'overview', 'import', 'duplicates', 'screening', 'conflicts', 'second-review', 'control', 'export', 'prisma',
    ]);
  });
  it('screening sub-items are DISABLED (href null) when there is no linked workspace', () => {
    const items = submenuForCategory('screen', { projectId: 'p1', linkedSiftId: null });
    const importItem = items.find((i) => i.key === 'import');
    expect(importItem.href).toBeNull(); // not navigable until screening is linked
    // PRISMA is a project tab, not a screening sub-page → still navigable
    expect(items.find((i) => i.key === 'prisma').href).toBe('/app/project/p1?tab=prisma');
  });
});

describe('55.md — active submenu key', () => {
  it('derives the screening sub-page from ?screen=', () => {
    expect(readScreenParam('?tab=screening&screen=conflicts')).toBe('conflicts');
    expect(activeSubmenuKey('?tab=screening&screen=conflicts')).toBe('conflicts');
    expect(activeSubmenuKey('?tab=screening')).toBe('overview'); // default screening sub-page
    expect(activeSubmenuKey('?tab=prisma')).toBe('prisma');
  });
  it('uses the stage id for non-screen categories', () => {
    expect(activeSubmenuKey('?tab=forest')).toBe('forest');
    expect(activeSubmenuKey('?tab=pico')).toBe('pico');
  });
});
