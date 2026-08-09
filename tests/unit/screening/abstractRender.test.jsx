/**
 * abstractRender.test.jsx — 107.md §4. The abstract renderer must bold structured
 * headings AND keep inclusion/exclusion keyword highlighting working, with no
 * overlapping markup and no raw-HTML injection.
 *
 * SSR static markup (project convention; no jsdom, no React Testing Library).
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup as r } from 'react-dom/server';
import { renderAbstract } from '../../../src/frontend/screening/ui/highlightRender.jsx';

const wrap = (children) => r(h('p', null, children));
// Strip tags to recover the visible text (what a user would select / copy).
const textOf = (html) => html.replace(/<[^>]*>/g, '');

const ABSTRACT =
  'BACKGROUND: Drug-resistant epilepsy is common. METHODS: A randomized controlled trial in adults. '
  + 'RESULTS: The animal study was excluded. CONCLUSIONS: Useful.';

describe('renderAbstract', () => {
  it('bolds structured headings', () => {
    const html = wrap(renderAbstract(ABSTRACT, {}));
    expect(html).toContain('<strong');
    for (const heading of ['BACKGROUND:', 'METHODS:', 'RESULTS:', 'CONCLUSIONS:']) {
      expect(html).toContain(`>${heading}</strong>`);
    }
  });

  it('renders headings AND keyword marks together without overlapping markup', () => {
    const html = wrap(renderAbstract(ABSTRACT, {
      inclusion: ['randomized controlled trial'],
      exclusion: ['animal study'],
    }));
    expect(html).toContain('<strong');
    expect(html).toContain('<mark');
    expect(html).toContain('>randomized controlled trial</mark>');
    expect(html).toContain('>animal study</mark>');
    expect(html).toContain('Inclusion term');
    expect(html).toContain('Exclusion term');
    // No <mark> may swallow a heading and no heading may swallow a <mark>.
    expect(html).not.toMatch(/<mark[^>]*>[^<]*<strong/);
    expect(html).not.toMatch(/<strong[^>]*>[^<]*<mark/);
  });

  it('keeps the rendered TEXT byte-identical to the source (selection + copying)', () => {
    const html = wrap(renderAbstract(ABSTRACT, {
      inclusion: ['randomized controlled trial'], exclusion: ['animal study'],
    }));
    expect(textOf(html)).toBe(ABSTRACT);
  });

  it('honours the inclusion / exclusion highlight toggles', () => {
    const onlyIncl = wrap(renderAbstract(ABSTRACT, {
      inclusion: ['randomized controlled trial'], exclusion: ['animal study'],
      showInclusion: true, showExclusion: false,
    }));
    expect(onlyIncl).toContain('Inclusion term');
    expect(onlyIncl).not.toContain('Exclusion term');

    const none = wrap(renderAbstract(ABSTRACT, {
      inclusion: ['randomized controlled trial'], exclusion: ['animal study'],
      showInclusion: false, showExclusion: false,
    }));
    expect(none).not.toContain('<mark');
    expect(none).toContain('<strong');   // headings are independent of the toggles
  });

  it('falls back to plain highlighting when the abstract has no headings', () => {
    const plain = 'A randomized controlled trial of adults; the animal study was excluded.';
    const html = wrap(renderAbstract(plain, {
      inclusion: ['randomized controlled trial'], exclusion: ['animal study'],
    }));
    expect(html).not.toContain('<strong');
    expect(html).toContain('<mark');
    expect(textOf(html)).toBe(plain);
  });

  it('does not bold heading words used as prose', () => {
    const prose = 'The methods used in previous studies differed. These results demonstrate improvement.';
    expect(wrap(renderAbstract(prose, {}))).not.toContain('<strong');
  });

  it('escapes text rather than injecting HTML', () => {
    const nasty = 'METHODS: <img src=x onerror=alert(1)> & "quoted".';
    const html = wrap(renderAbstract(nasty, { inclusion: ['quoted'] }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('renders nothing for an empty abstract', () => {
    expect(renderAbstract('', {})).toBeNull();
    expect(renderAbstract(null, {})).toBeNull();
  });
});
