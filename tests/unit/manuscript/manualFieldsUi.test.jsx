/**
 * 102.md §2/§4/§5 — the manual-field indicator, navigation controls and list.
 *
 * §81's goal is that manual completion be "almost impossible to overlook", so the
 * assertions here are about what a researcher can SEE and reach, not about markup
 * details.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ManualFieldsPanel, ManualFieldsBadge, ManualFieldsNav, ManualFieldsList,
} from '../../../src/features/manuscript/ManualFieldsPanel.jsx';
import {
  collectPlaceholders, groupPlaceholders, placeholderCounts,
} from '../../../src/research-engine/manuscript/index.js';

const DRAFT = {
  sections: {
    introduction: { content: 'A [State the rationale and the gap this review addresses].' },
    methods: { content: 'We searched [No database search has been recorded]. [Specify subgroup].' },
  },
  statements: { funding: '[State the funding source, or “None.”]' },
};

const all = collectPlaceholders(DRAFT);
const stats = placeholderCounts(all);
const groups = groupPlaceholders(all);

describe('§5 — the counter', () => {
  it('states how many manual fields remain', () => {
    const html = renderToStaticMarkup(<ManualFieldsBadge stats={stats} />);
    expect(html).toContain('3 manual fields remaining');
  });

  it('uses the singular for one field', () => {
    const html = renderToStaticMarkup(<ManualFieldsBadge stats={{ manual: 1, pending: 0 }} />);
    expect(html).toContain('1 manual field remaining');
    expect(html).not.toContain('fields remaining');
  });

  it('reports project-supplied gaps SEPARATELY from the researcher\'s own work', () => {
    // Merging them would tell a researcher they have typing to do that no amount
    // of typing can finish (101.md §17).
    const html = renderToStaticMarkup(<ManualFieldsBadge stats={stats} />);
    expect(html).toContain('1 awaiting project data');
  });

  it('renders nothing at all when the manuscript is complete', () => {
    expect(renderToStaticMarkup(<ManualFieldsBadge stats={{ manual: 0, pending: 0 }} />)).toBe('');
    expect(renderToStaticMarkup(<ManualFieldsPanel stats={{ manual: 0, pending: 0 }} />)).toBe('');
  });
});

describe('§2 — navigation controls', () => {
  it('offers previous and next, with their shortcuts discoverable', () => {
    const html = renderToStaticMarkup(<ManualFieldsNav stats={stats} />);
    expect(html).toContain('Prev');
    expect(html).toContain('Next');
    expect(html).toMatch(/Ctrl\+Enter/);
    expect(html).toMatch(/Ctrl\+Shift\+Enter/);
  });

  it('hides navigation when there is nothing to navigate to', () => {
    expect(renderToStaticMarkup(<ManualFieldsNav stats={{ manual: 0, pending: 2 }} />)).toBe('');
  });
});

describe('§53 — the list says which section each field is in', () => {
  const html = renderToStaticMarkup(<ManualFieldsList groups={groups} />);

  it('names every section that still contains a field', () => {
    expect(html).toContain('Introduction');
    expect(html).toContain('Methods');
    expect(html).toContain('Funding');
  });

  it('shows each outstanding field and what kind it is', () => {
    expect(html).toContain('Specify subgroup');
    expect(html).toContain('Manual input required');
    expect(html).toMatch(/Awaiting /);
  });

  it('tells a pending field WHERE it gets resolved, not just that it is waiting', () => {
    // Leaving a researcher with "awaiting project data" and no destination invites
    // the one action that must not happen — typing over it (101.md §17).
    expect(html).toContain('Awaiting Search Engine');
    expect(html).toMatch(/Run or import a database search/i);
    expect(html).not.toMatch(/Awaiting Search Engine[^<]*type/i);
  });

  it('distinguishes the two kinds without relying on colour alone', () => {
    // Each row carries a written kind label, and the marker differs in SHAPE.
    expect(html).toMatch(/Awaiting /);
    expect(html).toContain('rotate(45deg)');
  });

  it('marks the current field for assistive technology', () => {
    const current = all.find((p) => p.label === 'Specify subgroup');
    const withCurrent = renderToStaticMarkup(
      <ManualFieldsList groups={groups} currentId={current.id} />,
    );
    expect(withCurrent).toContain('aria-current="true"');
  });
});

describe('the panel composes badge, nav and list', () => {
  it('shows the count and the controls together', () => {
    const html = renderToStaticMarkup(
      <ManualFieldsPanel stats={stats} groups={groups} />,
    );
    expect(html).toContain('3 manual fields remaining');
    expect(html).toContain('Next');
    expect(html).toContain('data-testid="stitch-manuscript-manual-fields"');
  });

  it('exposes stable testids for the counter and the step controls', () => {
    const html = renderToStaticMarkup(<ManualFieldsPanel stats={stats} groups={groups} />);
    expect(html).toContain('stitch-manuscript-manual-fields-count');
    expect(html).toContain('stitch-manuscript-manual-next');
    expect(html).toContain('stitch-manuscript-manual-prev');
  });
});

describe('§6 — the surface reflects resolution immediately', () => {
  it('drops to nothing once every field is filled', () => {
    const resolved = {
      sections: {
        introduction: { content: 'A clear rationale.' },
        methods: { content: 'We searched PubMed. Adults only.' },
      },
      statements: { funding: 'None.' },
    };
    const s = placeholderCounts(collectPlaceholders(resolved));
    expect(s).toEqual({ manual: 0, pending: 0, total: 0 });
    expect(renderToStaticMarkup(<ManualFieldsPanel stats={s} groups={[]} />)).toBe('');
  });
});
