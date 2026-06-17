/**
 * tooltip.test.jsx — prompt29 Part 8. The reusable Tooltip must render its
 * trigger children transparently (the floating bubble is portal + hover state,
 * so it is absent in static render — that's expected). This guards that wrapping
 * an element in <Tooltip> never hides or breaks it.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Tooltip from '../../src/frontend/components/Tooltip.jsx';

describe('Tooltip', () => {
  it('renders its trigger children', () => {
    const html = renderToStaticMarkup(
      createElement(Tooltip, { content: 'Sent to META·LAB' }, createElement('span', null, 'SENT')),
    );
    expect(html).toContain('SENT');
  });

  it('does not render the bubble before interaction (no leaked tooltip text)', () => {
    const html = renderToStaticMarkup(
      createElement(Tooltip, { content: 'hidden help text' }, createElement('span', null, 'trigger')),
    );
    expect(html).toContain('trigger');
    expect(html).not.toContain('hidden help text');
    expect(html).not.toContain('role="tooltip"');
  });

  it('supports a div wrapper and custom wrap style without crashing', () => {
    const html = renderToStaticMarkup(
      createElement(Tooltip, { content: 'x', as: 'div', wrapStyle: { position: 'absolute' } }, createElement('span', null, 'pip')),
    );
    expect(html).toContain('pip');
  });
});
