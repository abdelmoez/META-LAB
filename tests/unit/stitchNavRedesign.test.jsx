/**
 * stitchNavRedesign.test.jsx — design2.md redesign guarantees.
 *
 * Pure tests over the centralized nav config + the small chrome helpers, plus SSR
 * smoke assertions over the dashboard chrome (global rail = no standalone engines,
 * white column = real menu not a project list, PecanRev branding, prominent
 * welcome). Modal interaction lives behind portals (not rendered by
 * renderToStaticMarkup), so deletion/Ops gating are validated via their extracted
 * pure helpers instead.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GLOBAL_NAV, DASHBOARD_MENU, buildProjectNav, projectStageHref, SCREENING_SUBNAV,
  screeningSubHref, readView, normalizeDashboardView, activeGlobalKey, globalHref,
  dashboardHref, deleteConfirmMatches, welcomeGreeting, workflowStepCount,
  activeProjectStage, submenuForCategory,
} from '../../src/frontend/stitch/nav/navConfig.js';

describe('navConfig — global rail (design2.md Part 1)', () => {
  it('contains only global destinations — no standalone engines', () => {
    const keys = GLOBAL_NAV.map((g) => g.key);
    expect(keys).toEqual(['dashboard', 'activity', 'invitations', 'help']);
    expect(keys).not.toContain('screening');
    expect(keys).not.toContain('rob');
    expect(keys).not.toContain('ops'); // Ops moves to the profile dropdown (Part 3)
  });
  it('routes global destinations to the dashboard hub views', () => {
    expect(globalHref(GLOBAL_NAV[0])).toBe('/app');
    expect(globalHref(GLOBAL_NAV[1])).toBe('/app?view=activity');
  });
});

describe('navConfig — dashboard menu (no duplicated project list)', () => {
  it('is a workspace menu with real views', () => {
    const keys = DASHBOARD_MENU.map((m) => m.view);
    expect(keys).toContain('overview');
    expect(keys).toContain('mywork');
    expect(keys).toContain('invitations');
    expect(keys).toContain('archived');
    expect(keys).toContain('resources');
  });
  it('normalizes + routes views', () => {
    expect(normalizeDashboardView('mywork')).toBe('mywork');
    expect(normalizeDashboardView('nope')).toBe('overview');
    expect(dashboardHref('overview')).toBe('/app');
    expect(dashboardHref('archived')).toBe('/app?view=archived');
    expect(readView('?view=invitations')).toBe('invitations');
    expect(readView('?view=bogus')).toBe('overview');
    expect(readView('')).toBe('overview');
  });
});

describe('navConfig — project workflow nav (derived from legacy TABS)', () => {
  const nav = buildProjectNav();
  it('mirrors the legacy project + workflow + reference structure', () => {
    expect(nav.project.map((s) => s.id)).toEqual(['overview', 'control']);
    expect(nav.reference.map((s) => s.id)).toContain('methods');
    expect(nav.phases.map((p) => p.phase)).toEqual(['Plan', 'Search', 'Screen', 'Extract', 'Analyze', 'Report']);
    expect(nav.phases[0].label).toBe('Plan & Protocol'); // display label override
    // prompt60 — the two search tabs (search + discovery) are unified into ONE "Search"
    // stage, so the workflow has one fewer step.
    expect(nav.flat.length).toBe(18); // 2 project + 15 workflow + 1 reference
    expect(workflowStepCount()).toBe(15);
    // Search phase now has exactly one stage, relabelled "Search".
    const searchPhase = nav.phases.find((p) => p.phase === 'Search');
    expect(searchPhase.steps.map((s) => s.id)).toEqual(['search']);
    expect(searchPhase.steps[0].label).toBe('Search');
  });
  it('opens EVERY stage inside the unified Stitch workspace via ?tab= (design4.md)', () => {
    expect(projectStageHref('overview', { projectId: 'p1' })).toBe('/app/project/p1');
    // design4: no stage escapes to a standalone engine route or ?ui=legacy — every
    // engine renders inside the one shared Stitch project workspace.
    expect(projectStageHref('pico', { projectId: 'p1' })).toBe('/app/project/p1?tab=pico');
    expect(projectStageHref('control', { projectId: 'p1' })).toBe('/app/project/p1?tab=control');
    expect(projectStageHref('search', { projectId: 'p1' })).toBe('/app/project/p1?tab=search');
    expect(projectStageHref('discovery', { projectId: 'p1' })).toBe('/app/project/p1?tab=discovery');
    expect(projectStageHref('screening', { projectId: 'p1', linkedSiftId: 's1' })).toBe('/app/project/p1?tab=screening');
    expect(projectStageHref('rob', { projectId: 'p1' })).toBe('/app/project/p1?tab=rob');
    expect(projectStageHref('extraction', { projectId: 'p1' })).toBe('/app/project/p1?tab=extraction');
    expect(projectStageHref('analysis', { projectId: 'p1' })).toBe('/app/project/p1?tab=analysis');
    expect(projectStageHref('prisma', { projectId: 'p1' })).toBe('/app/project/p1?tab=prisma');
    expect(projectStageHref('report', { projectId: 'p1' })).toBe('/app/project/p1?tab=report');
    expect(projectStageHref('methods', { projectId: 'p1' })).toBe('/app/project/p1?tab=methods');
  });
});

describe('navConfig — screening contextual sub-nav (design2.md Part 6)', () => {
  it('matches the canonical 8-item order + labels', () => {
    expect(SCREENING_SUBNAV.map((s) => s.label)).toEqual([
      'Overview', 'Import', 'Duplicates', 'Title & Abstract', 'Conflicts', 'Final Review', 'Settings', 'Export',
    ]);
  });
  it('deep-links each subpage into the screening engine EMBEDDED in the Stitch workspace', () => {
    // design4: the screening engine runs inside /app/project/:id?tab=screening; its
    // own sub-navigation reads the collision-free ?screen= param.
    expect(screeningSubHref('import', { projectId: 'p1', linkedSiftId: 's1' })).toBe('/app/project/p1?tab=screening&screen=import');
    expect(screeningSubHref('conflicts', { projectId: 'p1', linkedSiftId: 's1' })).toBe('/app/project/p1?tab=screening&screen=conflicts');
    expect(screeningSubHref('second-review', { projectId: 'p1', linkedSiftId: 's1' })).toBe('/app/project/p1?tab=screening&screen=second-review');
    expect(screeningSubHref('overview', { projectId: 'p1', linkedSiftId: 's1' })).toBe('/app/project/p1?tab=screening');
    expect(screeningSubHref('overview', {})).toBeNull(); // no linked workspace yet
  });
});

describe('navConfig — active-route matching (preserve deep links)', () => {
  it('resolves the active global key', () => {
    expect(activeGlobalKey('/app', '?view=activity')).toBe('activity');
    expect(activeGlobalKey('/app', '')).toBe('dashboard');
    expect(activeGlobalKey('/app/project/p1', '')).toBe('dashboard');
    expect(activeGlobalKey('/profile', '')).toBeNull();
  });
  // prompt60 — the former `discovery` stage folds into `search`. Old deep links must
  // resolve to the unified Search wizard, not 404 / fall through to overview.
  it('redirects ?tab=discovery to the unified search stage', () => {
    expect(activeProjectStage('?tab=discovery')).toBe('search');
    expect(activeProjectStage('?tab=search')).toBe('search');
    expect(activeProjectStage('?tab=screening')).toBe('screening');
    expect(activeProjectStage('')).toBe('overview');
  });
  it('collapses the Search category submenu to a single Search entry', () => {
    const items = submenuForCategory('search', { projectId: 'p1' });
    expect(items.map((i) => i.key)).toEqual(['search']);
  });
});

describe('chrome helpers — deletion confirm + welcome (Parts 1)', () => {
  it('gates deletion on an exact (trimmed, case-sensitive) name match', () => {
    expect(deleteConfirmMatches('Cherry', 'Cherry')).toBe(true);
    expect(deleteConfirmMatches('  Cherry  ', 'Cherry')).toBe(true); // whitespace lenient
    expect(deleteConfirmMatches('cherry', 'Cherry')).toBe(false);    // case sensitive
    expect(deleteConfirmMatches('', '')).toBe(false);                 // empty never matches
    expect(deleteConfirmMatches('مشروع البحث', 'مشروع البحث')).toBe(true); // unicode/arabic
    expect(deleteConfirmMatches('Project: A/B (2024)', 'Project: A/B (2024)')).toBe(true); // punctuation
  });
  it('never renders "Welcome, undefined", an email or a placeholder', () => {
    expect(welcomeGreeting('Test Admin')).toBe('Welcome, Test');
    expect(welcomeGreeting('')).toBe('Welcome back');
    expect(welcomeGreeting(undefined)).toBe('Welcome back');
    expect(welcomeGreeting('  ')).toBe('Welcome back');
    expect(welcomeGreeting('user@example.com')).toBe('Welcome back'); // email guard
  });
});

/* ─── SSR chrome smoke (mocks like the existing Stitch tests) ─────────────────── */
vi.mock('../../src/frontend/context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Maya Lopez', email: 'm@b.co', role: 'admin' }, logout: () => {} }),
}));
vi.mock('../../src/frontend/theme/ThemeContext.jsx', () => ({ useTheme: () => ({ theme: 'day', toggleTheme: () => {} }) }));
vi.mock('../../src/frontend/design/DesignModeContext.jsx', () => ({
  useDesignMode: () => ({ mode: 'stitch', isStitch: true, isAdmin: true, setMode: () => {}, toggle: () => {} }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: '/app', search: '' }),
  useParams: () => ({}),
}));
vi.mock('../../src/frontend/api-client/apiClient.js', () => ({
  api: { projects: { list: () => new Promise(() => {}) } },
}));

const StitchDashboard = (await import('../../src/frontend/stitch/pages/StitchDashboard.jsx')).default;

describe('StitchDashboard chrome (SSR)', () => {
  const html = renderToStaticMarkup(h(StitchDashboard));

  it('global rail has the global destinations and NO standalone engines', () => {
    expect(html).toContain('aria-label="Dashboard"');
    expect(html).toContain('aria-label="Activity"');
    expect(html).toContain('aria-label="Help &amp; Feedback"'); // & is HTML-escaped in SSR
    expect(html).not.toContain('aria-label="Risk of Bias"');
    expect(html).not.toContain('aria-label="Screening"'); // no engine button in the global rail
  });

  it('uses PecanRev branding and a prominent welcome — not "Research OS"', () => {
    expect(html).toContain('PecanRev');
    expect(html).toContain('Welcome, Maya');
    expect(html).not.toContain('Research OS');
  });

  it('white column is a menu, not a duplicated project list', () => {
    expect(html).toContain('Workspace Overview');
    expect(html).toContain('My Work');
    expect(html).toContain('Archived Projects');
    expect(html).toContain('Resources');
    expect(html).not.toMatch(/YOUR PROJECTS/i);
  });
});
