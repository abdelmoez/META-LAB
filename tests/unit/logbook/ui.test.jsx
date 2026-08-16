/**
 * tests/unit/logbook/ui.test.jsx — 119.md §8 Logbook UI contracts.
 *
 * SSR-safe (renderToStaticMarkup, no jsdom, no effects → no fetch). Covers:
 *  - NAV VISIBILITY: the stage is registered, resolves to Project Control, and the
 *    entry point is gated on the SAME `viewLogbook` capability the server enforces;
 *  - the deliberate narrowing vs resolveCapability's admin grant (server parity);
 *  - the pure presentation helpers (timezone, day grouping, before/after, links,
 *    honest empty states, member/engine focus);
 *  - the query serialiser + the authz'd export hrefs;
 *  - the page's SSR shell for a leader, and the access card (never a request) for
 *    a member/viewer.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { TABS } from '../../../src/frontend/workspace/projectHelpers.js';
import { activeProjectStage, categoryForStage, projectStageHref, submenuForCategory } from '../../../src/frontend/stitch/nav/navConfig.js';
import {
  canViewLogbook, canExportLogbook, logbookAccessContext, logbookViewDecision,
} from '../../../src/features/logbook/logbookAccess.js';
import {
  changePairs, countActiveFilters, dayLabel, emptyStateCopy, engineLabel, focusBanner,
  groupByDay, resourceLink, resourceText, statusMeta, timeZoneLabel, actorLine, formatValue,
} from '../../../src/features/logbook/logbookFormat.js';
import { filtersToQuery, logbookExportHref, PAGE_SIZE } from '../../../src/features/logbook/logbookApi.js';
import LogbookPage from '../../../src/features/logbook/LogbookPage.jsx';
import LogbookEventRow, { LogbookEventDetails } from '../../../src/features/logbook/LogbookEvent.jsx';
import LogbookTable from '../../../src/features/logbook/LogbookTable.jsx';

const EVENT = {
  id: 'logbook:42',
  source: 'logbook',
  at: '2026-08-15T09:30:00.000Z',
  actorId: 'u1', actorName: 'Dr Ada Lovelace', actorRole: 'leader', actorType: 'user',
  engine: 'screening', action: 'SCREEN_DECISION_CHANGED', actionCategory: 'decision',
  summary: 'Changed a screening decision from maybe to include',
  resourceType: 'record', resourceId: 'r-9', resourceLabel: 'Study 9',
  before: { decision: 'maybe' }, after: { decision: 'include' },
  status: 'success', via: 'user', opId: 'op-123', correlationId: 'corr-7',
  sessionId: null, relatedEventId: null, severity: 3, metadata: {},
};

const SYSTEM_EVENT = { ...EVENT, id: 'logbook:43', actorType: 'system', actorName: 'Import worker', status: 'failure', engine: 'search', summary: 'A database search failed' };

const OWNER = { role: 'owner', isOwner: true };
const LEADER = { role: 'leader', isOwner: false };
const MEMBER = { role: 'member', isOwner: false };
const VIEWER = { role: 'viewer', isOwner: false };

/* ═══════════════════ nav registration + visibility ════════════════════════ */

describe('119.md §8 — Logbook nav registration', () => {
  it('registers a Logbook stage that stays OUT of the numbered workflow', () => {
    const tab = TABS.find((t) => t.id === 'logbook');
    expect(tab).toBeTruthy();
    expect(tab.label).toBe('Logbook');
    expect(tab.phase).toBe(null);     // never a workflow step / progress denominator
    expect(tab.group).toBe('history'); // never in the legacy sidebar
  });

  it('resolves ?tab=logbook to the stage and to the Project Control category', () => {
    expect(activeProjectStage('?tab=logbook')).toBe('logbook');
    expect(categoryForStage('logbook')).toBe('control');
    expect(projectStageHref('logbook', { projectId: 'p1' })).toBe('/app/project/p1?tab=logbook');
  });

  it('never leaks into a submenu (Project Control has none — the entry is leadership-gated)', () => {
    expect(submenuForCategory('control', { projectId: 'p1' })).toBe(null);
    for (const cat of ['plan', 'search', 'screen', 'extract', 'analyze', 'report']) {
      const items = submenuForCategory(cat, { projectId: 'p1', linkedSiftId: 's1' }) || [];
      expect(items.some((i) => i.key === 'logbook')).toBe(false);
    }
  });
});

describe('119.md §8 — nav visibility is the same capability the server enforces', () => {
  it('allows the owner and leaders', () => {
    expect(canViewLogbook(OWNER)).toBe(true);
    expect(canViewLogbook(LEADER)).toBe(true);
    expect(canExportLogbook(OWNER)).toBe(true);
    expect(canExportLogbook(LEADER)).toBe(true);
  });

  it('refuses members, contributors and viewers — no nav item at all', () => {
    for (const p of [MEMBER, VIEWER, { role: 'contributor' }, { role: 'reviewer' }, {}]) {
      expect(canViewLogbook(p)).toBe(false);
      expect(canExportLogbook(p)).toBe(false);
    }
  });

  it('does NOT grant a site admin (server/logbook/logbookAccess.js is narrower on purpose)', () => {
    expect(logbookAccessContext({ role: 'member', isAdmin: true }).isAdmin).toBe(false);
    expect(canViewLogbook({ role: 'member', isAdmin: true })).toBe(false);
  });

  it('gives a member a specific, honest denial message (never "403")', () => {
    const d = logbookViewDecision(MEMBER);
    expect(d.allowed).toBe(false);
    expect(d.restrictionType).toBe('leader_only');
    expect(d.message).toBe('The Logbook is limited to the project owner and leaders. Your role is member.');
  });
});

/* ═══════════════════════════ presentation ═════════════════════════════════ */

describe('119.md §8 — presentation helpers', () => {
  it('labels engines and outcomes from the server vocabulary', () => {
    expect(engineLabel('screening')).toBe('Screening');
    expect(engineLabel('rob')).toBe('Risk of bias');
    expect(engineLabel('logbook')).toBe('Logbook access');
    expect(engineLabel('brand-new-engine')).toBe('brand-new-engine'); // honest, not relabelled
    expect(statusMeta('failure').label).toBe('Failed');
    expect(statusMeta('reversed').label).toBe('Reversed');
  });

  it('states the viewer timezone explicitly (§8 "Clear timezone display")', () => {
    expect(timeZoneLabel(new Date('2026-08-15T09:30:00Z'))).toMatch(/\(UTC[+-]\d{2}:\d{2}\)$/);
  });

  it('groups the timeline by day with Today/Yesterday labels', () => {
    const now = new Date('2026-08-15T12:00:00');
    expect(dayLabel(new Date('2026-08-15T09:00:00'), now)).toBe('Today');
    expect(dayLabel(new Date('2026-08-14T09:00:00'), now)).toBe('Yesterday');
    const days = groupByDay([
      { at: '2026-08-15T09:00:00' }, { at: '2026-08-15T08:00:00' }, { at: '2026-08-14T22:00:00' },
    ]);
    expect(days.length).toBe(2);
    expect(days[0].events.length).toBe(2);
  });

  it('pairs before/after key-by-key and drops unchanged keys', () => {
    expect(changePairs({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual([{ key: 'b', from: '2', to: '3' }]);
    expect(changePairs(null, 'included')).toEqual([{ key: '', from: '—', to: 'included' }]);
    expect(changePairs('same', 'same')).toEqual([]);
    expect(changePairs(null, null)).toEqual([]);
    expect(formatValue('')).toBe('(empty)');
    expect(formatValue([])).toBe('(none)');
  });

  it('links only to destinations the viewer can really open, and never guesses', () => {
    expect(resourceLink(EVENT, 'p1').href).toBe('/app/project/p1?tab=screening');
    expect(resourceLink({ resourceType: 'figure' }, 'p1').href).toBe('/app/project/p1?tab=manuscript');
    expect(resourceLink({ resourceType: 'logbook' }, 'p1')).toBe(null);  // the Logbook itself
    expect(resourceLink({ resourceType: 'something-new' }, 'p1')).toBe(null);
    expect(resourceText(EVENT)).toBe('record: Study 9');
  });

  it('names the actor with the role held AT THE TIME, and marks non-humans', () => {
    expect(actorLine(EVENT)).toBe('Dr Ada Lovelace · leader');
    expect(actorLine(SYSTEM_EVENT)).toBe('System · Import worker');
  });

  it('tells the truth in empty states — young project vs filters that matched nothing', () => {
    expect(emptyStateCopy({}).title).toBe('No activity recorded yet');
    expect(emptyStateCopy({ engines: ['search'] }).title).toBe('No events match these filters');
    expect(countActiveFilters({ q: 'x', engines: ['search'], from: '2026-01-01' })).toBe(3);
  });

  it('announces the member-focused and engine-focused views', () => {
    const facets = { actors: [{ value: 'u1', label: 'Dr Ada Lovelace', n: 4 }] };
    expect(focusBanner({ members: ['u1'] }, facets).label).toBe('Everything Dr Ada Lovelace did in this project');
    expect(focusBanner({ engines: ['analysis'] }, facets).label).toBe('All Analysis activity in this project');
    expect(focusBanner({ engines: ['analysis', 'search'] }, facets)).toBe(null);
    expect(focusBanner({}, facets)).toBe(null);
  });
});

/* ═════════════════════════════ API client ═════════════════════════════════ */

describe('119.md §8 — query + export hrefs', () => {
  it('pages at 50 and omits empty filters entirely', () => {
    expect(PAGE_SIZE).toBe(50);
    expect(filtersToQuery({ q: '', engines: [], sort: 'desc' }).toString()).toBe('');
  });

  it('serialises every §8 filter into the params the server normalises', () => {
    const qs = filtersToQuery({
      q: 'import', engines: ['search'], actions: ['SEARCH_RUN_COMPLETED'], members: ['u1'],
      roles: ['leader'], resourceTypes: ['record'], statuses: ['failure'], actorTypes: ['system', 'automation'],
      from: '2026-01-01', to: '2026-02-01', sort: 'asc',
    }).toString();
    for (const part of [
      'q=import', 'engine=search', 'action=SEARCH_RUN_COMPLETED', 'member=u1', 'role=leader',
      'resource=record', 'status=failure', 'actorType=system%2Cautomation', 'from=2026-01-01', 'to=2026-02-01', 'sort=asc',
    ]) expect(qs).toContain(part);
  });

  it('exports through the authz\'d endpoint carrying the current filters', () => {
    const href = logbookExportHref('p1', { engines: ['screening'] }, 'json');
    expect(href.startsWith('/api/logbook/projects/p1/export?')).toBe(true);
    expect(href).toContain('engine=screening');
    expect(href).toContain('format=json');
    expect(logbookExportHref('p1', {}, 'anything-else')).toContain('format=csv');
  });
});

/* ══════════════════════════════ SSR shell ═════════════════════════════════ */

describe('119.md §8 — the page renders the whole §8 interface for a leader', () => {
  const html = renderToStaticMarkup(h(LogbookPage, { projectId: 'p1', perms: OWNER }));

  it('shows the Logbook identity, the leadership scope and the timezone', () => {
    expect(html).toContain('data-testid="logbook-page"');
    expect(html).toContain('Logbook');
    expect(html).toContain('Owner and leaders only');
    expect(html).toContain('Times are shown in your timezone');
    expect(html).toContain('Exports use UTC');
  });

  it('offers both display modes, both exports, and every §8 filter', () => {
    expect(html).toContain('data-testid="logbook-mode-timeline"');
    expect(html).toContain('data-testid="logbook-mode-table"');
    expect(html).toContain('data-testid="logbook-refresh"');
    expect(html).toContain('data-testid="logbook-export-csv"');
    expect(html).toContain('data-testid="logbook-export-json"');
    expect(html).toContain('data-testid="logbook-search"');
    for (const f of ['from', 'to', 'member', 'role', 'engine', 'action', 'resource', 'status', 'actorType']) {
      expect(html).toContain(`data-testid="logbook-filter-${f}"`);
    }
    expect(html).toContain('data-testid="logbook-sort"');
  });

  it('starts in the loading state (SSR runs no effects → no unauthorised prefetch)', () => {
    expect(html).toContain('data-testid="logbook-loading"');
  });
});

describe('119.md §8 — a member/viewer gets the access card, never a Logbook', () => {
  for (const [name, perms] of [['member', MEMBER], ['viewer', VIEWER]]) {
    it(`renders the denial for a ${name} and no timeline, filters or export`, () => {
      const html = renderToStaticMarkup(h(LogbookPage, { projectId: 'p1', perms }));
      expect(html).toContain('data-testid="logbook-denied"');
      expect(html).toContain('The Logbook is limited to the project owner and leaders.');
      expect(html).not.toContain('data-testid="logbook-page"');
      expect(html).not.toContain('data-testid="logbook-export-csv"');
      expect(html).not.toContain('data-testid="logbook-search"');
    });
  }
});

describe('119.md §8 — an event row and its expandable details', () => {
  it('collapsed: who, what, engine and resource on one line', () => {
    const html = renderToStaticMarkup(h(LogbookEventRow, { event: EVENT, projectId: 'p1', expanded: false, onToggle: () => {} }));
    expect(html).toContain('data-testid="logbook-event-logbook:42"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Changed a screening decision from maybe to include');
    expect(html).toContain('Dr Ada Lovelace · leader');
    expect(html).toContain('record: Study 9');
    expect(html).not.toContain('data-testid="logbook-details-logbook:42"');
  });

  it('flags system activity and a failed outcome without hiding them', () => {
    const html = renderToStaticMarkup(h(LogbookEventRow, { event: SYSTEM_EVENT, projectId: 'p1', expanded: false, onToggle: () => {} }));
    expect(html).toContain('System');
    expect(html).toContain('Failed');
  });

  it('expanded: before/after, the resource link, the ids, and the focused views', () => {
    const html = renderToStaticMarkup(h(LogbookEventDetails, {
      event: EVENT, projectId: 'p1', onFocusMember: () => {}, onFocusEngine: () => {},
    }));
    expect(html).toContain('What changed');
    expect(html).toContain('decision');
    expect(html).toContain('maybe');
    expect(html).toContain('include');
    expect(html).toContain('href="/app/project/p1?tab=screening"');
    expect(html).toContain('op-123');
    expect(html).toContain('corr-7');
    expect(html).toContain('2026-08-15T09:30:00.000Z UTC');
    expect(html).toContain('Show everything this member did');
    expect(html).toContain('Show all Screening activity');
  });

  it('says so honestly when no before/after was recorded', () => {
    const html = renderToStaticMarkup(h(LogbookEventDetails, { event: { ...EVENT, before: null, after: null }, projectId: 'p1' }));
    expect(html).toContain('No before/after values were recorded for this event.');
  });

  it('labels a bridged legacy row as coming from the older audit store', () => {
    const html = renderToStaticMarkup(h(LogbookEventDetails, { event: { ...EVENT, source: 'screen_audit' }, projectId: 'p1' }));
    expect(html).toContain('Recorded by the screening audit log before the Logbook existed.');
  });
});

describe('119.md §8 — compact table mode shows the same events', () => {
  const html = renderToStaticMarkup(h(LogbookTable, {
    events: [EVENT, SYSTEM_EVENT], projectId: 'p1', expandedId: 'logbook:42', onToggle: () => {},
  }));

  it('renders the columns, both rows, and the expanded details inline', () => {
    expect(html).toContain('data-testid="logbook-table"');
    for (const col of ['When', 'Who', 'Engine', 'What happened', 'Resource', 'Outcome']) expect(html).toContain(col);
    expect(html).toContain('data-testid="logbook-row-logbook:42"');
    expect(html).toContain('data-testid="logbook-row-logbook:43"');
    expect(html).toContain('data-testid="logbook-details-logbook:42"');
    expect(html).not.toContain('data-testid="logbook-details-logbook:43"');
  });

  it('scrolls the wide table inside its own container (the page never scrolls sideways)', () => {
    expect(html).toContain('overflow-x:auto');
  });
});
