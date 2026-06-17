/**
 * robTrafficLight.test.js — prompt28 Part 3. The summary traffic-light SVG must
 * be wide enough to never clip the legend or title, must preserve full row labels
 * via a hover <title>, and must carry a viewBox so the display copy can scale.
 */
import { describe, it, expect } from 'vitest';
import { buildTrafficLightSVG } from '../../src/frontend/rob/RobTrafficLight.jsx';
import { JUDGMENT_LEGEND } from '../../src/frontend/rob/judgmentStyle.js';

const matrix = {
  domains: [
    { id: 'D1', shortLabel: 'Randomisation' },
    { id: 'D2', shortLabel: 'Deviations' },
    { id: 'D3', shortLabel: 'Missing data' },
    { id: 'D4', shortLabel: 'Measurement' },
    { id: 'D5', shortLabel: 'Selection' },
  ],
  rows: [
    { id: 'a', label: 'Smith 2020', overall: 'low', cells: [{ domainId: 'D1', judgment: 'low' }, { domainId: 'D2', judgment: 'some' }] },
    { id: 'b', label: 'A very very long study label that would otherwise overflow the row gutter and clip', overall: 'high', cells: [{ domainId: 'D1', judgment: 'high' }] },
  ],
};

describe('buildTrafficLightSVG', () => {
  it('produces a scalable SVG with a viewBox', () => {
    const { svg, width, height } = buildTrafficLightSVG(matrix, { title: 'RoB' });
    expect(svg).toContain('<svg');
    expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it('is wide enough to contain the legend (no clipping)', () => {
    const { svg, width } = buildTrafficLightSVG(matrix, { title: 'RoB' });
    // Re-derive the legend extent the same way the builder lays it out.
    // padL is dynamic, but the legend always starts at padL >= 180.
    let legend = 180;
    JUDGMENT_LEGEND.forEach(l => { legend += 40 + l.label.length * 6.6; });
    expect(width).toBeGreaterThanOrEqual(Math.floor(legend));
    // The last legend label must be present (not dropped/clipped from the markup).
    expect(svg).toContain(JUDGMENT_LEGEND[JUDGMENT_LEGEND.length - 1].label);
  });

  it('keeps a long title on-canvas', () => {
    const longTitle = 'A rather long plot title that names the project and the instrument RoB 2';
    const { width } = buildTrafficLightSVG(matrix, { title: longTitle });
    expect(width).toBeGreaterThanOrEqual(longTitle.length * 8); // ~title extent lower bound
  });

  it('truncates long row labels but preserves the full text in a <title>', () => {
    const { svg } = buildTrafficLightSVG(matrix, { title: 'RoB' });
    expect(svg).toContain('<title>A very very long study label that would otherwise overflow the row gutter and clip</title>');
    expect(svg).toContain('…'); // ellipsis on the visible text
  });

  it('escapes user text in labels and titles', () => {
    const { svg } = buildTrafficLightSVG({
      domains: [{ id: 'D1', shortLabel: 'x' }],
      rows: [{ id: 'a', label: 'A & B <script>', overall: 'low', cells: [] }],
    }, { title: 'T & <b>' });
    expect(svg).toContain('A &amp; B &lt;script&gt;');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('T &amp; &lt;b&gt;');
  });
});
