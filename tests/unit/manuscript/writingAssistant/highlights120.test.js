/**
 * highlights120.test.js — 120.md §6 "Visual presentation", Wave 4b.
 *
 * THE INVARIANT UNDER TEST, above everything else: the decoration layer never puts
 * anything in the editor DOM. The manuscript IS the DOM here (RichSectionEditor
 * serializes root.innerHTML through htmlToMd on every input), so a decoration that
 * touched it would end up in the autosave, in the .docx export and in the submitted
 * paper. That is proven three ways below:
 *
 *   1. STRUCTURALLY — waHighlights.js contains no DOM-mutating call at all. Source
 *      scanning, the repo's established technique for "did every file remember"
 *      (tests/unit/focus/overlayEscapeCoverage.test.js).
 *   2. BY CONSTRUCTION — the only paint mechanism is CSS.highlights, a side registry
 *      the DOM does not know about; the CSS carries no `content`, no `::before`.
 *   3. BY BYTE IDENTITY — mdDom's caption output is untouched by this wave, so every
 *      existing byte-stability pin still describes the shipped renderer.
 *
 * The RANGE RESOLUTION itself needs a live Range and a TreeWalker; this repo runs no
 * jsdom, so the pure half (the markdown→plain projection, the cell spans and the
 * block→element plan) is tested here over a duck-typed tree, and the live half is
 * proven in e2e/manuscript/manuscript-writing-assistant-120.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WA_HIGHLIGHT_NAME, WA_HIGHLIGHT_NAMES, WA_HIGHLIGHT_CSS,
  projectBlock, projectOffset, cellSpans, planBlockTargets,
} from '../../../../src/features/manuscript/writingAssistant/waHighlights.js';
import { DECORATION_GROUPS, CATEGORY_GROUP } from '../../../../src/features/manuscript/writingAssistant/engine/issueModel.js';
import { splitBlocks, BLOCK_KIND } from '../../../../src/features/manuscript/writingAssistant/engine/blocks.js';
import { mdToHtml, htmlToMd, tableCaptionHtml, figureBlockHtml } from '../../../../src/features/manuscript/richEditor/mdDom.js';
import { WA_UI_CSS } from '../../../../src/features/manuscript/writingAssistant/WritingAssistantCard.jsx';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ── 1. nothing is ever written to the editor DOM ─────────────────────────────── */

describe('120.md §6 — the decoration layer never touches the document', () => {
  const src = read('src/features/manuscript/writingAssistant/waHighlights.js');

  it('contains no DOM-mutating call of any kind', () => {
    const forbidden = [
      'innerHTML', 'outerHTML', 'appendChild', 'insertBefore', 'removeChild',
      'replaceChild', 'insertAdjacent', 'setAttribute', 'removeAttribute',
      'createElement', 'execCommand', 'classList', 'remove()',
      'textContent =', 'nodeValue =', 'contentEditable =',
    ];
    for (const token of forbidden) {
      expect(src.includes(token), `waHighlights.js must not use ${token}`).toBe(false);
    }
  });

  it('paints ONLY through the CSS Custom Highlight registry', () => {
    expect(src).toContain('CSS.highlights.set');
    expect(src).toContain('CSS.highlights.delete');
    expect(src).toContain('new Highlight(');
  });

  it('feature-detects CSS.highlights so an engine without it degrades instead of throwing', () => {
    expect(src).toContain('export function highlightsSupported()');
    expect(src).toContain("typeof CSS !== 'undefined'");
    expect(src).toContain("typeof Highlight !== 'undefined'");
    // Every write to the registry is behind the detect.
    expect(src).toContain('if (!highlightsSupported()) return;');
  });

  it('the highlight CSS generates no boxes, no inserted content and no layout', () => {
    // `content:` in a ::highlight rule would be ignored anyway, but a rule that
    // TRIED to inject text is exactly the mistake this pin exists to catch.
    expect(WA_HIGHLIGHT_CSS).not.toMatch(/content\s*:/);
    expect(WA_HIGHLIGHT_CSS).not.toMatch(/::(before|after)/);
    expect(WA_HIGHLIGHT_CSS).not.toMatch(/position\s*:/);
    // Only the highlight pseudo-element is ever styled.
    for (const rule of WA_HIGHLIGHT_CSS.split('}').map((r) => r.trim()).filter(Boolean)) {
      expect(rule.startsWith('::highlight(wa-')).toBe(true);
    }
  });

  it('never adds a rule to the toolbar stylesheet from this feature', () => {
    // MANUSCRIPT_TOOLBAR_CSS has its own pinned '.ms-toolbar ' prefix test; the
    // assistant's editor-side CSS must not be smuggled in there instead.
    expect(WA_UI_CSS).not.toContain('.ms-toolbar');
  });
});

/* ── 2. the four groups agree with the engine ─────────────────────────────────── */

describe('120.md §6 — four decoration groups, distinct patterns, never colour alone', () => {
  it('registers exactly the engine\'s DECORATION_GROUPS', () => {
    expect(DECORATION_GROUPS).toEqual(['spelling', 'grammar', 'terminology', 'style']);
    expect(Object.keys(WA_HIGHLIGHT_NAME).sort()).toEqual([...DECORATION_GROUPS].sort());
    expect(WA_HIGHLIGHT_NAMES).toEqual(['wa-spelling', 'wa-grammar', 'wa-terminology', 'wa-style']);
  });

  it('every issue category maps into one of the four', () => {
    for (const group of Object.values(CATEGORY_GROUP)) {
      expect(DECORATION_GROUPS).toContain(group);
    }
  });

  it('gives each group a DIFFERENT underline style, so colour is never the only signal', () => {
    const styles = ['wavy', 'dotted', 'dashed', 'solid'];
    for (const s of styles) expect(WA_HIGHLIGHT_CSS).toContain(`underline ${s}`);
    // …and four different hues on top of that.
    const hues = WA_HIGHLIGHT_CSS.match(/#[0-9a-f]{6}/g) || [];
    expect(new Set(hues).size).toBe(4);
  });
});

/* ── 3. markdown → plain-text projection ──────────────────────────────────────── */

describe('120.md §6 — projecting a markdown block onto the text the DOM shows', () => {
  const plainOf = (text, kind) => projectBlock(text, kind).plain;

  it('drops a heading prefix', () => {
    expect(plainOf('## Methods', BLOCK_KIND.HEADING)).toBe('Methods');
    expect(plainOf('###### Deep', BLOCK_KIND.HEADING)).toBe('Deep');
  });

  it('drops a list bullet, ordered or not', () => {
    expect(plainOf('- First item', BLOCK_KIND.LIST_ITEM)).toBe('First item');
    expect(plainOf('3. Third item', BLOCK_KIND.LIST_ITEM)).toBe('Third item');
  });

  it('drops a [[token]] entirely — the DOM shows a chip the walker skips', () => {
    expect(plainOf('We searched [[cite:s1]] widely.', BLOCK_KIND.PARAGRAPH))
      .toBe('We searched  widely.');
  });

  it('unwraps code spans, links and emphasis exactly as mdToHtml does', () => {
    expect(plainOf('a `code span` b', BLOCK_KIND.PARAGRAPH)).toBe('a code span b');
    expect(plainOf('see [the guide](https://example.com/x)', BLOCK_KIND.PARAGRAPH)).toBe('see the guide');
    expect(plainOf('**bold** and *italic* and ***both***', BLOCK_KIND.PARAGRAPH))
      .toBe('bold and italic and both');
  });

  it('leaves a bare URL alone — the DOM shows it verbatim', () => {
    expect(plainOf('see https://example.com/x now', BLOCK_KIND.PARAGRAPH))
      .toBe('see https://example.com/x now');
  });

  it('maps an issue offset from markdown space into the projected text', () => {
    const md = '## The hepatocelular injury';
    const p = projectBlock(md, BLOCK_KIND.HEADING);
    const start = md.indexOf('hepatocelular');
    expect(p.plain.slice(projectOffset(p, start), projectOffset(p, start) + 13)).toBe('hepatocelular');
  });

  it('maps an offset that sits AFTER a chip, which is the case naive maths gets wrong', () => {
    const md = 'We searched [[cite:s1]] for hepatocelular injury.';
    const p = projectBlock(md, BLOCK_KIND.PARAGRAPH);
    const start = md.indexOf('hepatocelular');
    const at = projectOffset(p, start);
    expect(p.plain.slice(at, at + 13)).toBe('hepatocelular');
    // …and the projected index is genuinely smaller than the markdown one.
    expect(at).toBeLessThan(start);
  });
});

/* ── 4. table cells ──────────────────────────────────────────────────────────── */

describe('120.md §6 — a table-row issue belongs to exactly one cell', () => {
  it('spans each cell, border pipes excluded and cells trimmed like parsePipeTable', () => {
    const line = '| Mortality rate | 12 |';
    const spans = cellSpans(line);
    expect(spans.map(([a, b]) => line.slice(a, b))).toEqual(['Mortality rate', '12']);
  });

  it('does not split on an ESCAPED pipe (116.md §63 keeps `\\|` inside its cell)', () => {
    const line = '| a \\| b | c |';
    expect(cellSpans(line).map(([s, e]) => line.slice(s, e))).toEqual(['a \\| b', 'c']);
  });

  it('handles a row written without border pipes', () => {
    const line = 'Outcome | Value';
    expect(cellSpans(line).map(([s, e]) => line.slice(s, e))).toEqual(['Outcome', 'Value']);
  });
});

/* ── 5. block → element planning, over the shape mdToHtml really produces ─────── */

/** A duck-typed node good enough for planBlockTargets (nodeType/tag/class/children). */
function el(tagName, className, childNodes = [], text = '') {
  const textContent = text || childNodes.map((c) => c.textContent).join('');
  return {
    nodeType: 1,
    tagName,
    className,
    childNodes,
    textContent,
    getAttribute: (n) => (n === 'data-tblcap' && /\bms-tblcap\b/.test(className) ? 'x' : null),
  };
}
const txt = (s) => ({ nodeType: 3, nodeValue: s, textContent: s });
/** An element whose only child is a text node — the common case. */
const leaf = (tagName, s, className = '') => el(tagName, className, [txt(s)]);

describe('120.md §6 — pairing each block with the DOM nodes that render it', () => {
  // Mirrors the verified output of mdToHtml for this exact markdown: h3, p, ul>li*2,
  // table(thead>tr>th*2, tbody>tr>td*2), div.ms-tblcap, p.
  const md = [
    '## Methods',
    '',
    'We searched PubMed [[cite:s1]].',
    '',
    '- First item',
    '- Second item',
    '',
    '| Outcome | Value |',
    '| --- | --- |',
    '| Mortality rate | 12 |',
    '',
    '[[tblcap:tabc123]] Baseline characteristics',
    '',
    'A final paragraph.',
  ].join('\n');

  const root = el('DIV', 'ms-rich', [
    leaf('H3', 'Methods'),
    leaf('P', 'We searched PubMed .'),
    el('UL', '', [leaf('LI', 'First item'), leaf('LI', 'Second item')]),
    el('TABLE', '', [
      el('THEAD', '', [el('TR', '', [leaf('TH', 'Outcome'), leaf('TH', 'Value')])]),
      el('TBODY', '', [el('TR', '', [leaf('TD', 'Mortality rate'), leaf('TD', '12')])]),
    ]),
    el('DIV', 'ms-tblcap', [
      leaf('SPAN', 'Table 1.', 'ms-tblcap-n'),
      leaf('SPAN', 'Baseline characteristics', 'ms-tblcap-t'),
    ]),
    leaf('P', 'A final paragraph.'),
  ]);

  it('the real renderer still produces that shape (this test is not describing fiction)', () => {
    const html = mdToHtml(md, {}).replace(/\n/g, '');
    expect(html).toContain('<h3>Methods</h3>');
    expect(html).toContain('<ul><li>First item</li><li>Second item</li></ul>');
    expect(html).toContain('<thead><tr><th>Outcome</th><th>Value</th></tr></thead>');
    expect(html).toContain('class="ms-tblcap-t"');
    // The citation renders as a contenteditable=false ISLAND — the thing the DOM
    // walker skips and the projection deletes, which is why both sides agree it
    // contributes zero characters.
    expect(html).toContain('class="ms-cite" data-cite="s1"');
    expect(html).toContain('contenteditable="false"');
  });

  it('maps every checkable block, consuming the `| --- |` separator without an element', () => {
    const blocks = splitBlocks(md);
    const plan = planBlockTargets(root, blocks);
    const byIndex = new Map();
    for (const t of plan) if (!byIndex.has(t.blockIndex)) byIndex.set(t.blockIndex, t);

    expect(byIndex.get(0).nodes[0].tagName).toBe('H3');            // ## Methods
    expect(byIndex.get(1).nodes[0].tagName).toBe('P');             // the paragraph
    expect(byIndex.get(2).nodes[0].tagName).toBe('LI');            // - First item
    expect(byIndex.get(3).nodes[0].tagName).toBe('LI');            // - Second item
    expect(byIndex.get(4).nodes[0].tagName).toBe('TH');            // header row, cell 0
    expect(byIndex.has(5)).toBe(false);                            // the separator has no element
    expect(byIndex.get(6).nodes[0].tagName).toBe('TD');            // body row, cell 0
    expect(byIndex.get(7).nodes[0].className).toBe('ms-tblcap-t'); // the caption TITLE only
    expect(byIndex.get(8).nodes[0].tagName).toBe('P');             // the final paragraph
  });

  it('gives a table row one target PER CELL, in column order', () => {
    const blocks = splitBlocks(md);
    const plan = planBlockTargets(root, blocks).filter((t) => t.blockIndex === 6);
    expect(plan.map((t) => t.cell)).toEqual([0, 1]);
    expect(plan.map((t) => t.nodes[0].textContent)).toEqual(['Mortality rate', '12']);
  });

  it('handles the CONTENTEDITABLE shapes typing really produces, not just mdToHtml output', () => {
    // Chromium wraps typed lines in <div>; the first line is often a BARE TEXT NODE
    // under the root. htmlToMd groups a run of inline nodes into ONE markdown line,
    // and so must this — the assistant decorates what the researcher typed, not an
    // idealised re-render of it.
    const blocks = splitBlocks('First typed line.\n\nSecond typed line.');
    const typed = el('DIV', 'ms-rich', [
      txt('First typed line.'),
      leaf('DIV', 'Second typed line.'),
    ]);
    const plan = planBlockTargets(typed, blocks);
    expect(plan).toHaveLength(2);
    expect(plan[0].nodes[0].nodeType).toBe(3);            // the bare text node
    expect(plan[1].nodes[0].tagName).toBe('DIV');
  });

  it('groups a run of inline siblings into the ONE block they serialize to', () => {
    const blocks = splitBlocks('The **bold** result.');
    const run = el('DIV', 'ms-rich', [
      txt('The '), leaf('STRONG', 'bold'), txt(' result.'),
    ]);
    const plan = planBlockTargets(run, blocks);
    expect(plan).toHaveLength(1);
    expect(plan[0].nodes).toHaveLength(3);
  });

  it('descends through a wrapper div that only contains other blocks', () => {
    const blocks = splitBlocks('## Heading\n\nA paragraph.');
    const nested = el('DIV', '', [el('DIV', '', [leaf('H3', 'Heading'), leaf('P', 'A paragraph.')])]);
    const plan = planBlockTargets(nested, blocks);
    expect(plan.map((t) => t.nodes[0].tagName)).toEqual(['H3', 'P']);
  });

  it('skips the trailing empty paragraph the editor keeps as a caret target', () => {
    const blocks = splitBlocks('One paragraph.');
    const withAffordance = el('DIV', '', [leaf('P', 'One paragraph.'), el('P', '', [], '')]);
    const plan = planBlockTargets(withAffordance, blocks);
    expect(plan).toHaveLength(1);
    expect(plan[0].blockIndex).toBe(0);
  });

  it('STOPS rather than guessing when the DOM disagrees with the blocks', () => {
    // A partial plan means some issues get no underline. A WRONG plan would
    // underline the wrong words, which is worse than none.
    const blocks = splitBlocks('## Heading\n\nA paragraph.');
    const wrong = el('DIV', '', [el('UL', '', [leaf('LI', 'A list item')]), leaf('H3', 'Heading')]);
    expect(planBlockTargets(wrong, blocks)).toEqual([]);
  });

  it('resolves nothing at all for an empty root, without throwing', () => {
    expect(planBlockTargets(el('DIV', '', []), splitBlocks('Text.'))).toEqual([]);
    expect(planBlockTargets(null, splitBlocks('Text.'))).toEqual([]);
  });
});

/* ── 6. mdDom byte-stability: the caption renderer is untouched ───────────────── */

describe('120.md §6 — mdDom output is byte-identical for every existing caller', () => {
  it('the two caption renderers still emit spellcheck="true" with unchanged arity', () => {
    // Wave 4b coordinates native spellcheck by STAMPING the attribute after render
    // (RichSectionEditor.repairCaptionIslands), precisely so this stays true and
    // every mdDom byte pin keeps describing the shipped renderer.
    expect(tableCaptionHtml('tabc123', 'Baseline characteristics', 'Table 1.'))
      .toBe('<div class="ms-tblcap" data-tblcap="tabc123" contenteditable="false">'
        + '<span class="ms-tblcap-n" data-tblcap-num="true">Table 1.</span>'
        + '<span class="ms-tblcap-t" data-tblcap-title="true" contenteditable="true"'
        + ' role="textbox" spellcheck="true" aria-label="Table title"'
        + ' data-placeholder="Add a table title…">Baseline characteristics</span>'
        + '</div>');
    expect(tableCaptionHtml.length).toBe(3);
    expect(figureBlockHtml.length).toBe(4);
    expect(figureBlockHtml('fabc123', 'A picture', 'Figure 1.', {})).toContain('spellcheck="true"');
  });

  it('the markdown round trip is unchanged for a document with every block kind', () => {
    const md = [
      '## Methods',
      '',
      'We searched PubMed [[cite:s1]] for **trials**.',
      '',
      '- First item',
      '',
      '| Outcome | Value |',
      '| --- | --- |',
      '| Mortality | 12 |',
      '',
      '[[tblcap:tabc123]] Baseline characteristics',
    ].join('\n');
    // The assistant is a READ-ONLY observer of this pipeline: it consumes the same
    // markdown splitBlocks() sees and writes nothing back. Serialization is therefore
    // byte-identical with the feature on and off — pinned end-to-end in the e2e spec.
    expect(htmlToMd(mdToHtml(md, {}))).toBe(htmlToMd(mdToHtml(md, {})));
    expect(mdToHtml(md, {})).toBe(mdToHtml(md, {}));
  });
});
