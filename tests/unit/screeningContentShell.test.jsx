/**
 * screeningContentShell.test.jsx — pins the shared Screening content-shell width
 * contract (prompt46 #2). SSR static markup (project convention; no jsdom).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScreeningContentShell } from '../../src/frontend/screening/ui/components.jsx';

describe('ScreeningContentShell width contract', () => {
  it('defaults to the widened 1560px max-width', () => {
    const html = renderToStaticMarkup(<ScreeningContentShell>x</ScreeningContentShell>);
    expect(html).toContain('max-width:1560px');
  });
  it('keeps the no-horizontal-scroll guarantees (full width, centered, border-box, 24px gutter floor)', () => {
    const html = renderToStaticMarkup(<ScreeningContentShell>x</ScreeningContentShell>);
    expect(html).toContain('width:100%');
    expect(html).toContain('margin:0 auto');
    expect(html).toContain('box-sizing:border-box');
    expect(html).toContain('padding:24px clamp(24px, 5vw, 96px) 56px');
  });
  it('honors an explicit maxWidth override', () => {
    const html = renderToStaticMarkup(<ScreeningContentShell maxWidth={680}>x</ScreeningContentShell>);
    expect(html).toContain('max-width:680px');
  });
});
