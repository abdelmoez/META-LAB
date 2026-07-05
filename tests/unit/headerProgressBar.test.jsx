/**
 * headerProgressBar.test.jsx — 75.md Phases 8-9 (Workstream F).
 *
 * SSR-static coverage for the thin canonical project-progress underline on the
 * Stitch top header and its driving hook (useProjectProgress):
 *   - the hook returns the server `_progress` annotation verbatim when present, and
 *     falls back to the identical pure client model when it is absent (no fetch);
 *   - the header bar renders a proper role="progressbar" with aria + fill width when
 *     `headerProgress` is set, and is ABSENT when it is null / non-numeric;
 *   - the width clamps to 0..100 and the prefers-reduced-motion override is emitted.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Header renders StitchAccountMenu (auth/theme/nav) + a NotificationsBell; stub the
// heavy chrome children so the header renders in isolation without a network.
vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: '/app/project/p1', search: '' }),
}));
vi.mock('../../src/frontend/context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Lee', email: 'l@b.co', role: 'user' }, logout: () => {} }),
}));
vi.mock('../../src/frontend/theme/ThemeContext.jsx', () => ({ useTheme: () => ({ theme: 'day', toggleTheme: () => {} }) }));
vi.mock('../../src/frontend/components/NotificationsBell.jsx', () => ({ default: () => null }));
vi.mock('../../src/frontend/components/chat/StitchChatLauncher.jsx', () => ({ default: () => null }));

const { StitchTopHeader } = await import('../../src/frontend/stitch/shell/shellParts.jsx');
const { useProjectProgress } = await import('../../src/frontend/stitch/hooks/useProjectProgress.js');

function Probe({ project }) {
  const p = useProjectProgress(project);
  return h('code', null,
    `pct=${p.pct};done=${p.requiredDone};total=${p.requiredTotal};next=${p.nextStepId};n=${p.steps.length}`);
}

describe('useProjectProgress', () => {
  it('returns the server _progress annotation verbatim when present', () => {
    const project = {
      _progress: {
        pct: 73,
        steps: [
          { id: 'pico', status: 'done', required: true },
          { id: 'search', status: 'partial', required: true },
        ],
        requiredDone: 5,
        requiredTotal: 14,
        nextStepId: 'search',
      },
    };
    const html = renderToStaticMarkup(h(Probe, { project }));
    expect(html).toContain('pct=73');
    expect(html).toContain('done=5');
    expect(html).toContain('total=14');
    expect(html).toContain('next=search');
    expect(html).toContain('n=2'); // the server steps, untouched
  });

  it('falls back to the identical canonical client model when _progress is absent', () => {
    // An empty project → all steps empty. The canonical signature (14 required steps
    // with nma excluded, 15 emitted steps, next=pico) proves computeProjectProgress
    // ran — not a shape a bare stepStatus map could produce.
    const html = renderToStaticMarkup(h(Probe, { project: { studies: [] } }));
    expect(html).toContain('pct=0');
    expect(html).toContain('total=14');
    expect(html).toContain('next=pico');
    expect(html).toContain('n=15');
  });

  it('returns a zeroed shape for a null project', () => {
    const html = renderToStaticMarkup(h(Probe, { project: null }));
    expect(html).toContain('pct=0');
    expect(html).toContain('total=0');
    expect(html).toContain('next=null');
    expect(html).toContain('n=0');
  });
});

describe('StitchTopHeader progress underline', () => {
  it('renders an accessible progressbar with the fill width when headerProgress is a number', () => {
    const html = renderToStaticMarkup(h(StitchTopHeader, { headerProgress: 42, onOpenNav: () => {} }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-label="Project progress: 42%"');
    expect(html).toContain('width:42%');
  });

  it('accepts the {pct,label} form and uses the label as the tooltip', () => {
    const html = renderToStaticMarkup(h(StitchTopHeader, {
      headerProgress: { pct: 60, label: 'Project progress: 60% · 8 of 14 steps · Next: Screening' },
      onOpenNav: () => {},
    }));
    expect(html).toContain('aria-valuenow="60"');
    expect(html).toContain('width:60%');
    expect(html).toContain('title="Project progress: 60% · 8 of 14 steps · Next: Screening"');
  });

  it('clamps out-of-range percentages to 0..100', () => {
    const over = renderToStaticMarkup(h(StitchTopHeader, { headerProgress: 150, onOpenNav: () => {} }));
    expect(over).toContain('aria-valuenow="100"');
    expect(over).toContain('width:100%');
    const under = renderToStaticMarkup(h(StitchTopHeader, { headerProgress: -20, onOpenNav: () => {} }));
    expect(under).toContain('aria-valuenow="0"');
    expect(under).toContain('width:0%');
  });

  it('emits the prefers-reduced-motion override that strips the width transition', () => {
    const html = renderToStaticMarkup(h(StitchTopHeader, { headerProgress: 30, onOpenNav: () => {} }));
    expect(html).toContain('stitch-hdr-progress-fill');
    expect(html).toContain('prefers-reduced-motion');
  });

  it('renders NO progressbar when headerProgress is null (non-project pages)', () => {
    const html = renderToStaticMarkup(h(StitchTopHeader, { onOpenNav: () => {} }));
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('stitch-header-progress');
  });

  it('renders NO progressbar when headerProgress carries a non-numeric pct', () => {
    const html = renderToStaticMarkup(h(StitchTopHeader, { headerProgress: { pct: 'abc' }, onOpenNav: () => {} }));
    expect(html).not.toContain('role="progressbar"');
  });
});
