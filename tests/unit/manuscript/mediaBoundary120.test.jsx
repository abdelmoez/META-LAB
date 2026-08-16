/**
 * 120.md §3 (a paragraph below media) + §4 (unified, protected media entities).
 *
 * What is provable in Node lives here:
 *   · `repairCaptionBlocks` — the PURE serialize-time rule that reunites a caption
 *     with its table instead of deleting the caption (the §4 data-loss defect), and
 *     still drops the genuine 119.md §2 orphan;
 *   · `ensureTrailingParagraph` — the synthesized caret target, driven through a
 *     minimal fake DOM (this repo has no jsdom, by convention);
 *   · SERIALIZER NEUTRALITY — the affordance is invisible to the persisted markdown,
 *     which is what makes §3's "must not duplicate / must not export / must not
 *     create endless blank pages" clauses true by construction rather than by
 *     bookkeeping.
 *
 * What only a real engine can prove (a click that produces no caret, ArrowDown out
 * of a table, native undo granularity) is pinned in
 * e2e/manuscript/manuscript-tables-below-120.spec.ts, which runs under chromium AND
 * the `webkit-manuscript` project.
 *
 * The source-string assertions follow the established repo convention (readSource):
 * they pin CONTRACTS between an event handler and a mutation path that no rendered
 * markup can express — that the affordance is a direct DOM append and never an
 * execCommand, and that a key is only claimed once the caret has actually moved.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readSource } from '../../helpers/readSource.js';
import { mdToHtml, htmlToMd, repairCaptionBlocks } from '../../../src/features/manuscript/richEditor/mdDom.js';
import {
  RichSectionEditor, ensureTrailingParagraph, isMediaBlockNode, isEmptyParagraph,
  lastSignificantChild, nextSignificantSibling, prevSignificantSibling,
} from '../../../src/features/manuscript/richEditor/RichSectionEditor.jsx';

const EDITOR = readSource('src/features/manuscript/richEditor/RichSectionEditor.jsx');
const MDDOM = readSource('src/features/manuscript/richEditor/mdDom.js');
const noop = () => {};

const TABLE_MD = '| A | B |\n| --- | --- |\n| 1 | 2 |';
const capLine = (id, title) => `[[tblcap:${id}]] ${title}`;

/* ══════════════ §4 — repair, never delete ══════════════ */

describe('120.md §4 — a caption separated from its table is REPAIRED, not dropped', () => {
  it('leaves an already-adjacent pair exactly as it is', () => {
    const blocks = [capLine('t1', 'Study characteristics'), TABLE_MD];
    expect(repairCaptionBlocks(blocks)).toEqual(blocks);
  });

  it('moves the caption back when ONE paragraph was typed between the two', () => {
    // This is the §4 defect verbatim: the caret sits between the caption island and
    // its table, one keystroke lands there, and the caption used to be DELETED on
    // the next emit — identity, title, number and every cross-reference with it.
    const out = repairCaptionBlocks([capLine('t1', 'Study characteristics'), 'stray text', TABLE_MD]);
    expect(out).toEqual(['stray text', capLine('t1', 'Study characteristics'), TABLE_MD]);
    // …and the interloper is NEVER deleted — it is the researcher's text.
    expect(out).toContain('stray text');
  });

  it('moves it across MANY interlopers, keeping their order', () => {
    const out = repairCaptionBlocks([capLine('t1', 'A'), 'p1', 'p2', 'p3', TABLE_MD]);
    expect(out).toEqual(['p1', 'p2', 'p3', capLine('t1', 'A'), TABLE_MD]);
  });

  it('repairs the FIRST pair without disturbing a second captioned table', () => {
    const out = repairCaptionBlocks([
      capLine('t1', 'A'), 'interloper', TABLE_MD, capLine('t2', 'B'), TABLE_MD,
    ]);
    expect(out).toEqual(['interloper', capLine('t1', 'A'), TABLE_MD, capLine('t2', 'B'), TABLE_MD]);
  });

  it('never gives ONE table two captions — a caption followed by another caption is an orphan', () => {
    // t1's table is genuinely gone; the surviving table belongs to t2, and guessing
    // otherwise would be exactly the "dangerous guess" 120.md §4 forbids.
    const out = repairCaptionBlocks([capLine('t1', 'A'), 'x', capLine('t2', 'B'), TABLE_MD]);
    expect(out).toEqual(['x', capLine('t2', 'B'), TABLE_MD]);
  });

  it('STILL drops the genuine 119.md §2 orphan (no table anywhere after it)', () => {
    expect(repairCaptionBlocks([capLine('t1', 'A'), 'prose'])).toEqual(['prose']);
    expect(repairCaptionBlocks(['prose', capLine('t1', 'A')])).toEqual(['prose']);
    expect(repairCaptionBlocks([capLine('t1', 'A')])).toEqual([]);
  });

  it('is idempotent: repair(repair(x)) === repair(x)', () => {
    const inputs = [
      [capLine('t1', 'A'), TABLE_MD],
      [capLine('t1', 'A'), 'x', TABLE_MD],
      [capLine('t1', 'A'), 'x', 'y', TABLE_MD, capLine('t2', 'B'), 'z', TABLE_MD],
      [capLine('t1', 'A'), 'orphaned'],
      ['prose only'],
      [],
    ];
    for (const blocks of inputs) {
      const once = repairCaptionBlocks(blocks);
      expect(repairCaptionBlocks(once)).toEqual(once);
    }
  });

  it('runs through htmlToMd on the LIVE EMIT PATH ONLY (byte-identity doctrine)', () => {
    // The DOM shape the defect produces: caption, an arbitrary paragraph, the table.
    const html = `${mdToHtml(capLine('t1', 'Study characteristics'))}<p>stray text</p>${mdToHtml(TABLE_MD)}`;
    // The live editor emit repairs …
    const repaired = htmlToMd(html, { dropOrphanCaptions: true });
    expect(repaired).toBe(`stray text\n\n${capLine('t1', 'Study characteristics')}\n\n${TABLE_MD}`);
    // … and the caption is STILL THERE, so its id, its title and every [[table:t1]]
    // cross-reference survive the accident that used to erase them.
    expect(repaired).toContain('[[tblcap:t1]]');
    // …while every other consumer (paste sanitisation, table-op round trips, the
    // pinned mdDom suite) is byte-identical to what it always was.
    expect(htmlToMd(html)).toBe(`${capLine('t1', 'Study characteristics')}\n\nstray text\n\n${TABLE_MD}`);
    expect(MDDOM).toContain('function dropOrphanCaptionBlocks(blocks) {');
    expect(MDDOM).toContain('export function repairCaptionBlocks(blocks) {');
  });

  it('the repaired markdown is a fixed point of the round trip', () => {
    const md = `stray text\n\n${capLine('t1', 'A')}\n\n${TABLE_MD}`;
    const once = htmlToMd(mdToHtml(md), { dropOrphanCaptions: true });
    expect(once).toBe(md);
    expect(htmlToMd(mdToHtml(once), { dropOrphanCaptions: true })).toBe(once);
  });
});

/* ══════════════ §3 — the synthesized caret target ══════════════ */

/**
 * A minimal DOM good enough for ensureTrailingParagraph: elements with children,
 * sibling links, class lists and text content. The repo has no jsdom (vitest.config
 * runs in node), and the helper is written against exactly this much of the DOM —
 * childNodes, lastChild/previousSibling, classList.contains, ownerDocument — so a
 * fake is a fair test of it rather than a test of a mock.
 */
function fakeDom() {
  const doc = { createElement: (tag) => el(tag) };
  const sib = (n, step) => {
    if (!n.parentNode) return null;
    const i = n.parentNode.childNodes.indexOf(n);
    return i < 0 ? null : (n.parentNode.childNodes[i + step] || null);
  };
  function base(n) {
    Object.defineProperty(n, 'lastChild', {
      get: () => (n.childNodes.length ? n.childNodes[n.childNodes.length - 1] : null),
    });
    Object.defineProperty(n, 'previousSibling', { get: () => sib(n, -1) });
    Object.defineProperty(n, 'nextSibling', { get: () => sib(n, 1) });
    return n;
  }
  function el(tag, cls) {
    const classes = new Set(cls ? [cls] : []);
    const n = base({
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      childNodes: [],
      parentNode: null,
      ownerDocument: doc,
      classList: { contains: (c) => classes.has(c) },
      appendChild(child) { child.parentNode = n; n.childNodes.push(child); return child; },
    });
    Object.defineProperty(n, 'textContent', {
      get: () => n.childNodes.map((c) => c.textContent).join(''),
    });
    return n;
  }
  function text(data) {
    const n = base({ nodeType: 3, childNodes: [], parentNode: null, textContent: data });
    return n;
  }
  const host = el('div');
  return { doc, el, text, host };
}

describe('120.md §3 — ensureTrailingParagraph', () => {
  it('appends ONE empty paragraph after a trailing table, and never a second one', () => {
    const { el, host } = fakeDom();
    host.appendChild(el('p')).appendChild({ nodeType: 3, textContent: 'prose', childNodes: [] });
    host.appendChild(el('table'));
    expect(ensureTrailingParagraph(host)).toBe(true);
    expect(host.childNodes.length).toBe(3);
    const added = host.lastChild;
    expect(added.tagName).toBe('P');
    expect(added.childNodes[0].tagName).toBe('BR');
    // Idempotent by construction: the last child is no longer media.
    expect(ensureTrailingParagraph(host)).toBe(false);
    expect(ensureTrailingParagraph(host)).toBe(false);
    expect(host.childNodes.length).toBe(3);
  });

  it('appends after a caption island and after a figure island too', () => {
    for (const [tag, cls] of [['div', 'ms-tblcap'], ['figure', 'ms-figblock']]) {
      const { el, host } = fakeDom();
      host.appendChild(el(tag, cls));
      expect(ensureTrailingParagraph(host)).toBe(true);
      expect(host.lastChild.tagName).toBe('P');
    }
  });

  it('does NOTHING after ordinary prose (no endless blank pages)', () => {
    const { el, host } = fakeDom();
    const p = host.appendChild(el('p'));
    p.appendChild({ nodeType: 3, textContent: 'Closing paragraph.', childNodes: [] });
    expect(ensureTrailingParagraph(host)).toBe(false);
    expect(host.childNodes.length).toBe(1);
    // …and not after a heading or a list either.
    host.appendChild(el('ul'));
    expect(ensureTrailingParagraph(host)).toBe(false);
  });

  it('sees past the whitespace text nodes engines sprinkle between blocks', () => {
    const { el, text, host } = fakeDom();
    host.appendChild(el('table'));
    host.appendChild(text('\n  '));
    expect(ensureTrailingParagraph(host)).toBe(true);
    expect(host.lastChild.tagName).toBe('P');
  });

  it('is inert without a host or a document (SSR / detached nodes)', () => {
    expect(ensureTrailingParagraph(null)).toBe(false);
    expect(ensureTrailingParagraph({})).toBe(false);
    const orphanHost = {
      appendChild: () => {}, lastChild: { nodeType: 1, tagName: 'TABLE' }, ownerDocument: null,
    };
    expect(ensureTrailingParagraph(orphanHost)).toBe(false);
  });

  it('classifies exactly the three media blocks, and the affordance itself', () => {
    const { el, text, host } = fakeDom();
    expect(isMediaBlockNode(el('table'))).toBe(true);
    expect(isMediaBlockNode(el('div', 'ms-tblcap'))).toBe(true);
    expect(isMediaBlockNode(el('figure', 'ms-figblock'))).toBe(true);
    expect(isMediaBlockNode(el('p'))).toBe(false);
    expect(isMediaBlockNode(el('div'))).toBe(false);
    expect(isMediaBlockNode(text(' '))).toBe(false);
    expect(isMediaBlockNode(null)).toBe(false);

    const empty = el('p');
    empty.appendChild(el('br'));
    expect(isEmptyParagraph(empty)).toBe(true);
    const filled = el('p');
    filled.appendChild(text('x'));
    expect(isEmptyParagraph(filled)).toBe(false);
    expect(isEmptyParagraph(el('table'))).toBe(false);

    const t = host.appendChild(el('table'));
    host.appendChild(text('\n'));
    const p = host.appendChild(el('p'));
    expect(lastSignificantChild(host)).toBe(p);
    expect(nextSignificantSibling(t)).toBe(p);
    expect(prevSignificantSibling(p)).toBe(t);
    expect(nextSignificantSibling(p)).toBe(null);
  });
});

/* ══════════════ §3 — the affordance is invisible to the model ══════════════ */

describe('120.md §3 — the trailing paragraph never reaches the document', () => {
  const ending = {
    'a table': `Intro\n\n${TABLE_MD}`,
    'a captioned table': `Intro\n\n${capLine('t1', 'Baseline')}\n\n${TABLE_MD}`,
    'a figure': 'Intro\n\n[[figcap:fa1]] Study flow',
    'a table alone in the section': TABLE_MD,
  };

  for (const [what, md] of Object.entries(ending)) {
    it(`serializes byte-identically with and without it — section ending in ${what}`, () => {
      const html = mdToHtml(md);
      expect(htmlToMd(html)).toBe(md);
      // The affordance the editor appends after mounting this section:
      expect(htmlToMd(`${html}<p><br></p>`)).toBe(md);
      // …and on the live emit path, where the §4 repair also runs.
      expect(htmlToMd(`${html}<p><br></p>`, { dropOrphanCaptions: true })).toBe(md);
      // Two of them (a paranoid double-call) still serialize to the same bytes.
      expect(htmlToMd(`${html}<p><br></p><p><br></p>`)).toBe(md);
    });
  }

  it('typing in it makes it ORDINARY content — the paragraph only exists once it says something', () => {
    const md = `Intro\n\n${TABLE_MD}`;
    const html = mdToHtml(md);
    expect(htmlToMd(`${html}<p>Typed below the table.</p>`))
      .toBe(`${md}\n\nTyped below the table.`);
  });

  it('is NOT in the first paint — SSR markup is byte-identical to before', () => {
    const html = renderToStaticMarkup(
      <RichSectionEditor value={`Intro\n\n${TABLE_MD}`} orderMap={new Map()} onChange={noop} />,
    );
    expect(html).toContain('<table>');
    // The affordance is a mount-time DOM pass, never rendered markup: React must
    // keep seeing the same __html string (the mount-once contract).
    expect(html.endsWith('</table></div>')).toBe(true);
  });
});

/* ══════════════ the wiring contracts ══════════════ */

describe('120.md §3/§4 — editor wiring', () => {
  it('the affordance is a DIRECT DOM append, deliberately invisible to undo', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('export function ensureTrailingParagraph(el) {'),
      EDITOR.indexOf('export const RichSectionEditor ='));
    expect(fn).toContain('el.appendChild(p);');
    expect(fn).not.toContain('execCommand');
    expect(fn).not.toContain('insertHtml');
    // …and it checks BEFORE it appends, which is what makes repeat calls free.
    expect(fn).toContain('if (!isMediaBlockNode(last)) return false;');
  });

  it('runs on every mount AND on every emit (so an undo re-establishes it)', () => {
    expect(EDITOR).toContain('    if (readOnly) return;\n    ensureTrailingParagraph(rootRef.current);');
    const emitFn = EDITOR.slice(EDITOR.indexOf('const emit = useCallback(() => {'),
      EDITOR.indexOf('const selectionInRoot = () => {'));
    expect(emitFn).toContain('repairCaptionIslands(el);');
    expect(emitFn).toContain('ensureTrailingParagraph(el);');
    // …before the serialization, which is harmless because htmlToMd drops empties.
    expect(emitFn.indexOf('ensureTrailingParagraph(el);'))
      .toBeLessThan(emitFn.indexOf('onChangeRef.current(htmlToMd('));
    // the 119.md §2 emit contract is untouched
    expect(EDITOR).toContain('onChangeRef.current(htmlToMd(el.innerHTML, { dropOrphanCaptions: true }))');
    expect(EDITOR).not.toContain('htmlToMd(el.innerHTML)');
  });

  it('claims ArrowDown only after the caret has actually moved, and never a chord', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const onMediaBoundaryKeyDown = (e) => {'),
      EDITOR.indexOf('const captionGapCaption = () => {'));
    expect(fn).toContain('if (e.ctrlKey || e.metaKey || e.altKey) return false;');
    // an IME composition keystroke is never a command (the Enter that commits a
    // CJK candidate must reach the input method, not move the caret)
    expect(fn).toContain('if (e.isComposing || e.keyCode === 229) return false;');
    // a Shift-extended ArrowDown is a selection gesture — always the browser's
    expect(fn).toContain('if (e.shiftKey) return false;');
    // preventDefault comes AFTER the move, never before it
    expect(fn.indexOf('if (!placeCaretAfterBlock(top)) return false;'))
      .toBeLessThan(fn.indexOf('e.preventDefault();   // …only now'));
    // only the LAST row of a table, and only when the media is trailing
    expect(fn).toContain("if (trs.indexOf(cell.closest('tr')) !== trs.length - 1) return false;");
    expect(fn).toContain('if (next && !(isEmptyParagraph(next) && !nextSignificantSibling(next))) return false;');
  });

  it('Enter in a title moves below the media instead of splitting the entity (§4)', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const onMediaBoundaryKeyDown = (e) => {'),
      EDITOR.indexOf('const captionGapCaption = () => {'));
    expect(fn).toContain("if (e.key === 'Enter') {");
    expect(fn).toContain('if (e.shiftKey) return true;');       // no line breaks in a title
    expect(fn).toContain('if (!caretAtEndOfNode(titleEl, r)) return true;');
    expect(fn).toContain('placeCaretAfterBlock(mediaObjectEndBlock(r.startContainer));');
  });

  it('typing between a caption and its table is redirected INTO the title', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const onCaptionGapKeyDown = (e) => {'),
      EDITOR.indexOf('const onBelowMediaMouseDown = (e) => {'));
    expect(fn).toContain('if (e.isComposing || e.keyCode === 229) return false;');
    expect(fn).toContain('const printable = typeof e.key === \'string\' && e.key.length === 1;');
    expect(fn).toContain('placeCaretInTitle(titleEl);');
    // the character follows the caret through the SAME execCommand path as typing,
    // so it is one native undo step and one ordinary autosave emit
    expect(fn).toContain("if (printable) exec('insertText', e.key);");
    // …and the gap is recognised both as a root offset and as a whitespace text node
    const gap = EDITOR.slice(EDITOR.indexOf('const captionGapCaption = () => {'),
      EDITOR.indexOf('const onCaptionGapKeyDown = (e) => {'));
    expect(gap).toContain('if (r.startContainer === el) {');
    expect(gap).toContain('r.startContainer.nodeType === 3 && r.startContainer.parentNode === el');
    expect(gap).toContain('TABLE_CAPTION_CLASS');
  });

  it('is wired into the ONE keydown entry point, after the readOnly gate', () => {
    const kd = EDITOR.slice(EDITOR.indexOf('const onKeyDown = (e) => {'));
    expect(kd.indexOf('if (readOnlyRef.current) return;'))
      .toBeLessThan(kd.indexOf('if (onCaptionGapKeyDown(e)) return;'));
    expect(kd.indexOf('if (onCaptionGapKeyDown(e)) return;'))
      .toBeLessThan(kd.indexOf('if (onMediaBoundaryKeyDown(e)) return;'));
    // …and a click below trailing media joins the ONE mousedown entry point.
    const md = EDITOR.slice(EDITOR.indexOf('const onEditorMouseDown = (e) => {'));
    expect(md.indexOf('if (onCaptionMouseDown(e)) return;'))
      .toBeLessThan(md.indexOf('onPlaceholderMouseDown(e);'));
    expect(md.indexOf('onPlaceholderMouseDown(e);'))
      .toBeLessThan(md.indexOf('if (!e.defaultPrevented) onBelowMediaMouseDown(e);'));
  });

  it('a paste in the caption gap is moved into the title before it lands', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const onPaste = (e) => {'),
      EDITOR.indexOf('const onDragStart = (e) => {'));
    expect(fn).toContain('const gapCap = captionGapCaption();');
    expect(fn.indexOf('placeCaretInTitle(gapTitle);')).toBeLessThan(fn.indexOf('insertHtml(mdToHtml(md2'));
  });

  it('refuses the native drag of a media island (§4 separation vector)', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const onDragStart = (e) => {'),
      EDITOR.indexOf('const onDragOver = (e) => {'));
    expect(fn).toContain('TABLE_CAPTION_CLASS');
    expect(fn).toContain('FIGURE_BLOCK_CLASS');
    expect(fn).toContain('e.preventDefault();');
    expect(EDITOR).toContain('onDragStart={onDragStart}');
    // the image-file DROP path is untouched
    expect(EDITOR).toContain('onDrop={onDrop}');
  });

  it('adds no user-agent detection (120.md §3 "Safari" is a caret problem, not a UA)', () => {
    expect(EDITOR).not.toMatch(/navigator\.(userAgent|vendor)/);
    expect(EDITOR).not.toMatch(/\bisSafari\b|\bisWebkit\b/i);
  });
});
