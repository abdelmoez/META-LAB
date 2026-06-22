/**
 * stitchPrimitives.test.jsx — SSR smoke + behavior checks for the Stitch primitive
 * library. renderToStaticMarkup catches import/render regressions without a DOM,
 * and verifies the accessibility contracts (roles, aria) the design.md a11y section
 * requires.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  StitchCard, StitchButton, StitchIconButton, StitchBadge, StitchStatusDot, StitchAvatar,
  StitchAvatarGroup, StitchMetricCard, StitchProgressBar, StitchProgressRing, StitchEmptyState,
  StitchErrorState, StitchLoadingState, StitchPageHeader, StitchSectionHeader,
} from '../../src/frontend/stitch/primitives/core.jsx';
import {
  StitchField, StitchInput, StitchTextarea, StitchSelect, StitchSwitch, StitchCheckbox, StitchSearchInput,
} from '../../src/frontend/stitch/primitives/controls.jsx';
import { StitchTabs, StitchTable, StitchPagination } from '../../src/frontend/stitch/primitives/overlay.jsx';

const render = (el) => renderToStaticMarkup(el);

describe('Stitch core primitives render', () => {
  it('renders a card, buttons and badges with real content', () => {
    const html = render(h(StitchCard, null,
      h(StitchButton, { icon: 'download' }, 'Export'),
      h(StitchIconButton, { icon: 'bell', label: 'Notifications' }),
      h(StitchBadge, { tone: 'success' }, 'Included'),
    ));
    expect(html).toContain('Export');
    expect(html).toContain('Included');
    // icon button must expose an accessible name (no clickable-div anti-pattern)
    expect(html).toContain('aria-label="Notifications"');
    expect(html).toContain('<button');
  });

  it('metric card, progress ring + bar show their values', () => {
    expect(render(h(StitchMetricCard, { label: 'Included', value: 42 }))).toContain('42');
    expect(render(h(StitchProgressRing, { value: 75, sublabel: 'Completed' }))).toContain('75%');
    const bar = render(h(StitchProgressBar, { value: 30, max: 100, label: 'Screened', showValue: true }));
    expect(bar).toContain('role="progressbar"');
    expect(bar).toContain('aria-valuenow="30"');
  });

  it('status/avatars derive from data (no remote images)', () => {
    const html = render(h('div', null,
      h(StitchStatusDot, { status: 'online', title: 'Online' }),
      h(StitchAvatar, { name: 'Hasan Batal' }),
      h(StitchAvatarGroup, { names: ['A B', 'C D', 'E F', 'G H', 'I J'] }),
    ));
    expect(html).toContain('HB');   // initials, not an <img src=...>
    expect(html).not.toContain('<img');
    expect(html).toContain('+1');   // overflow count (5 names, max 4)
  });

  it('empty / error / loading states announce themselves', () => {
    expect(render(h(StitchEmptyState, { title: 'No projects yet' }))).toContain('No projects yet');
    expect(render(h(StitchErrorState, { title: 'Failed to load', onRetry: () => {} }))).toContain('role="alert"');
    expect(render(h(StitchLoadingState, { label: 'Loading projects…' }))).toContain('role="status"');
  });

  it('page + section headers use semantic headings', () => {
    expect(render(h(StitchPageHeader, { title: 'Command Center', subtitle: 'Phase 2' }))).toContain('<h1');
    expect(render(h(StitchSectionHeader, { title: 'Recent Activity' }))).toContain('<h2');
  });
});

describe('Stitch controls', () => {
  it('field associates label with control and shows errors', () => {
    const html = render(h(StitchField, { label: 'Email', htmlFor: 'em', required: true, error: 'Required' },
      h(StitchInput, { id: 'em', type: 'email' })));
    expect(html).toContain('for="em"');
    expect(html).toContain('id="em"');
    expect(html).toContain('role="alert"'); // error message
  });

  it('switch + checkbox are real controls with aria state', () => {
    expect(render(h(StitchSwitch, { checked: true, label: 'Blind mode' }))).toContain('role="switch"');
    expect(render(h(StitchSwitch, { checked: true }))).toContain('aria-checked="true"');
    expect(render(h(StitchCheckbox, { checked: false, label: 'Archived' }))).toContain('role="checkbox"');
  });

  it('textarea / select / search render', () => {
    expect(render(h(StitchTextarea, { rows: 3, defaultValue: 'note' }))).toContain('<textarea');
    expect(render(h(StitchSelect, null, h('option', null, 'A')))).toContain('<select');
    expect(render(h(StitchSearchInput, { value: '', onChange: () => {} }))).toContain('type="search"');
  });
});

describe('Stitch tabs / table / pagination', () => {
  it('tabs use role=tablist/tab with selection', () => {
    const html = render(h(StitchTabs, { tabs: [{ id: 'a', label: 'Overview' }, { id: 'b', label: 'Team' }], value: 'a' }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('Overview');
  });

  it('table renders a semantic table with headers + rows', () => {
    const html = render(h(StitchTable, {
      columns: [{ key: 'name', header: 'Name' }, { key: 'n', header: 'Studies', align: 'right' }],
      rows: [{ name: 'Project A', n: 12 }, { name: 'Project B', n: 5 }],
      rowKey: (r) => r.name,
    }));
    expect(html).toContain('<table');
    expect(html).toContain('scope="col"');
    expect(html).toContain('Project A');
    expect(html).toContain('12');
  });

  it('pagination hides for a single page and shows controls for many', () => {
    expect(render(h(StitchPagination, { page: 1, pageCount: 1 }))).toBe('');
    const html = render(h(StitchPagination, { page: 2, pageCount: 5 }));
    expect(html).toContain('Page 2 of 5');
    expect(html).toContain('aria-label="Next page"');
  });
});
