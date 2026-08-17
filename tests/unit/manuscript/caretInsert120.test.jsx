/**
 * 120.md §5 — exact-caret citation and cross-reference insertion, pinned.
 *
 * Two kinds of assertion, both deliberate:
 *
 *  1. The PURE resolution rule (`richEditor/caretBookmark.js`): given a block's
 *     text and a remembered position, is this still the same place? That is the
 *     decision the whole feature turns on — it is what makes the difference
 *     between inserting where the researcher was writing, inserting somewhere
 *     else, and honestly refusing — and it is expressible in Node.
 *
 *  2. SOURCE PINS for the wiring. The four defects §5 names are all orderings
 *     inside event handlers and hook plumbing (focus() firing onFocus before the
 *     saved caret is read; a picker taking focus before anything bookmarked it; an
 *     insert routed through a scroll-driven section; a registry entry outliving its
 *     editor). None of that is observable through renderToStaticMarkup and this
 *     repo has no jsdom, so it is pinned the way 116/119 pinned the same class of
 *     contract — see tests/helpers/readSource.js for why that technique stays.
 *
 * The interaction proof (type mid-sentence → open the picker → search → insert →
 * the chip is at the caret, not at the start of the section) is
 * e2e/manuscript/manuscript-citation-caret-120.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readSource } from '../../helpers/readSource.js';
import {
  logicalContext, resolveContext, CARET_CONTEXT_CHARS,
} from '../../../src/features/manuscript/richEditor/caretBookmark.js';
import { CiteRefPicker, CrossRefPicker } from '../../../src/features/manuscript/richEditor/RichSectionEditor.jsx';
import { CARET_LOST_TEXT } from '../../../src/features/manuscript/manuscriptPanels.jsx';

const EDITOR = readSource('src/features/manuscript/richEditor/RichSectionEditor.jsx');
const PANELS = readSource('src/features/manuscript/manuscriptPanels.jsx');
const ABSTRACT = readSource('src/features/manuscript/richEditor/AbstractEditor.jsx');

const SENTENCE = 'Pooled estimates favoured the intervention in every sensitivity analysis.';

describe('120.md §5 — the pure bookmark resolution rule', () => {
  it('remembers the text either side of the caret', () => {
    const at = SENTENCE.indexOf('favoured');
    const lg = logicalContext(SENTENCE, at);
    expect(lg.charOffset).toBe(at);
    expect(lg.before.length).toBeLessThanOrEqual(CARET_CONTEXT_CHARS);
    expect(SENTENCE.slice(at - lg.before.length, at)).toBe(lg.before);
    expect(SENTENCE.slice(at, at + lg.after.length)).toBe(lg.after);
  });

  it('an UNCHANGED block resolves to exactly the same offset', () => {
    const at = SENTENCE.indexOf('favoured');
    expect(resolveContext(SENTENCE, logicalContext(SENTENCE, at))).toBe(at);
  });

  it('text typed EARLIER in the block moves the position with it', () => {
    // The §5 "concurrent changes" case: something changed while the picker was open.
    const at = SENTENCE.indexOf('favoured');
    const lg = logicalContext(SENTENCE, at);
    const edited = `In the primary analysis, ${SENTENCE}`;
    const resolved = resolveContext(edited, lg);
    expect(resolved).toBe(edited.indexOf('favoured'));
    expect(resolved).not.toBe(at);
  });

  it('the caret at the very START and the very END of a block both resolve', () => {
    expect(resolveContext(SENTENCE, logicalContext(SENTENCE, 0))).toBe(0);
    expect(resolveContext(SENTENCE, logicalContext(SENTENCE, SENTENCE.length)))
      .toBe(SENTENCE.length);
  });

  it('REFUSES when the surrounding text is gone', () => {
    const lg = logicalContext(SENTENCE, SENTENCE.indexOf('favoured'));
    expect(resolveContext('An entirely different paragraph about screening.', lg)).toBe(null);
    expect(resolveContext('', lg)).toBe(null);
  });

  it('REFUSES when the position is AMBIGUOUS — never guesses between two matches', () => {
    // The remembered offset no longer fits, so the context has to be searched for.
    const lg = { charOffset: 999, before: 'ab', after: 'cd' };
    expect(resolveContext('abcd once only', lg)).toBe(2);          // exactly one match
    expect(resolveContext('abcd and again abcd', lg)).toBe(null);  // two → refuse
  });

  it('an EMPTY context only ever resolves into a still-empty block', () => {
    // Otherwise every empty paragraph would match at offset 0 — which is precisely
    // the "insert at position zero" behaviour §5 exists to remove.
    const lg = logicalContext('', 0);
    expect(resolveContext('', lg)).toBe(0);
    expect(resolveContext('Someone typed here since.', lg)).toBe(null);
  });

  it('is defensive about junk', () => {
    expect(resolveContext(SENTENCE, null)).toBe(null);
    expect(resolveContext(null, logicalContext('abc', 1))).toBe(null);
    expect(logicalContext(null, 99)).toEqual({ charOffset: 0, before: '', after: '' });
  });
});

describe('120.md §5 — the focus clobber (the "start of section" defect)', () => {
  it('focusWithSelection reads the saved caret BEFORE el.focus() can overwrite it', () => {
    /* THE DEFECT: the root's onFocus={rememberSelection} fires synchronously inside
       el.focus(), after the browser has installed its own position-0 caret for a
       newly-focused contentEditable — so the restore overwrote the very range it
       was about to read, and every lost-selection insert landed at the beginning of
       the section. Both halves of the fix are pinned: the local capture and the
       re-entrancy flag. */
    const fn = EDITOR.slice(EDITOR.indexOf('const focusWithSelection = ()'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    const savedAt = body.indexOf('const saved = savedRange.current;');
    const focusAt = body.indexOf('el.focus()');
    expect(savedAt).toBeGreaterThan(-1);
    expect(focusAt).toBeGreaterThan(-1);
    expect(savedAt).toBeLessThan(focusAt);
    expect(body).toContain('restoringRef.current = true;');
    expect(body).toContain('finally { restoringRef.current = false; }');
    // …and the fallback now reads the LOCAL, never the ref the focus just touched.
    expect(body).toContain('else if (saved && el.contains(saved.commonAncestorContainer))');
  });

  it('rememberSelection is a no-op while a restoration is in flight', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const rememberSelection = ()'));
    expect(fn.slice(0, 120)).toContain('if (restoringRef.current) return;');
  });
});

describe('120.md §5 — the picker session', () => {
  it('the editor exposes save / restore / clear', () => {
    expect(EDITOR).toContain('saveCaretBookmark: () => {');
    expect(EDITOR).toContain('restoreCaretBookmark: (bmIn) => {');
    expect(EDITOR).toContain('clearCaretBookmark: () => { bookmarkRef.current = null; }');
  });

  it('a bookmark that cannot be resolved returns FALSE — there is no third fallback', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('restoreCaretBookmark: (bmIn) => {'));
    const body = fn.slice(0, fn.indexOf('\n    },'));
    /* The live-range test is TWO conditions, and the second is not optional: a DOM
       Range survives the removal of its own nodes (the browser re-points it at the
       surviving parent), so a wiped section leaves the saved range collapsed at
       (root, 0) — which `contains` accepts, and which is the position-zero insertion
       §5 exists to remove. Reproduced under chromium. */
    expect(body).toContain('if (anchor && el.contains(anchor) && liveRangeStillValid(live, bm.logical)) {');
    expect(body).toContain('if (!r) r = rangeFromLogical(bm.logical);');
    expect(body).toContain('if (!r) return false;');
    // a locked section refuses outright
    expect(body).toContain('readOnlyRef.current');
    const verify = EDITOR.slice(EDITOR.indexOf('const liveRangeStillValid = (r, logical) => {'));
    expect(verify.slice(0, verify.indexOf('\n  };')))
      .toContain('return !!now && now.before === logical.before && now.after === logical.after;');
  });

  it('a bare text node at the root is a resolvable block, not a non-block', () => {
    /* Typing the first run into an empty contentEditable leaves the text as a bare
       text-node child of the editing host in Blink. Filtering those out made every
       bookmark taken in a freshly typed section unresolvable. */
    const fn = EDITOR.slice(EDITOR.indexOf('const rangeFromLogical = (logical) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('const blocks = significantChildren(el);');
    expect(body).not.toContain('nodeType === 1');
    expect(EDITOR).toContain('if (top.nodeType === 3) {');
  });

  it('both pickers bookmark BEFORE the popover renders and clear on cancel', () => {
    for (const name of ['CrossRefPicker', 'CiteRefPicker']) {
      const fn = EDITOR.slice(EDITOR.indexOf(`export function ${name}({`));
      const body = fn.slice(0, fn.indexOf('\n}\n'));
      expect(body).toContain('if (onSessionStart) onSessionStart();');
      // the save happens before the state change that mounts the search input
      expect(body.indexOf('if (onSessionStart) onSessionStart();'))
        .toBeLessThan(body.indexOf('setOpen(true);'));
      expect(body).toContain('const cancel = () => { setOpen(false); if (onSessionEnd) onSessionEnd(); };');
      // …and the backdrop close is a CANCEL, not a bare setOpen(false)
      expect(body).toContain("onMouseDown={(e) => { e.preventDefault(); cancel(); }}");
      // the mousedown-preventDefault net stays: it is load-bearing for the mouse path
      expect(body).toContain('onMouseDown={(e) => e.preventDefault()}');
    }
  });

  it('the pickers still render without the session props (no host is required)', () => {
    const cite = renderToStaticMarkup(<CiteRefPicker items={[]} onInsert={() => {}} />);
    expect(cite).toContain('aria-label="Insert citation"');
    const xref = renderToStaticMarkup(<CrossRefPicker items={[]} onPick={() => {}} />);
    expect(xref).toContain('aria-label="Insert cross-reference"');
  });

  it('the workspace routes the insert to the BOOKMARKED section, never through getApi()', () => {
    const fn = PANELS.slice(PANELS.indexOf('const withBookmarkedCaret = (run) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('const api = apiFor(s.sectionId);');
    expect(body).toContain('api.restoreCaretBookmark(s.bm)');
    expect(body).toContain('setInsertNotice(CARET_LOST_TEXT);');
    // the locked-section guard survives the routing
    expect(body).toContain("if ((sections[s.sectionId] || {}).locked) return;");
    // getApi() remains ONLY for the no-session callers
    expect(body.indexOf('const api = getApi();')).toBeGreaterThan(body.indexOf('setInsertNotice(CARET_LOST_TEXT);'));
  });

  it('both Insert paths go through the session', () => {
    expect(PANELS).toContain('withBookmarkedCaret((api) => { if (api.insertCitation) api.insertCitation(ids); });');
    expect(PANELS).toContain('if (api.insertAssetRef) api.insertAssetRef(assetId);');
    // …and the caret's section is resolved from the CARET, not from the scroll-driven `sel`
    expect(PANELS).toContain('const caretSectionId = () => (activeApi.current && activeSectionRef.current) || caretSection || sel;');
  });

  it('the refusal is non-destructive and asks for the caret back', () => {
    expect(CARET_LOST_TEXT).toMatch(/could not be found/i);
    expect(CARET_LOST_TEXT).toMatch(/click where/i);
    expect(PANELS).toContain('data-testid="stitch-manuscript-insert-notice"');
  });
});

describe('120.md §5 — grouping, selected text, and the abstract registry', () => {
  it('an adjacent chip is MERGED through the same replaceNode + citeChipLabel path', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const mergeIntoCiteChip = (chip, ids) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('parseCiteIds(chip.getAttribute(\'data-cite\')');
    expect(body).toContain('if (!next.includes(String(id))) next.push(String(id));');   // dedupe
    expect(body).toContain('citeChipLabel(next,');                                       // style engine
    // one node swap → one native undo step (the wrapper is the §5 chip-shape fix)
    expect(body).toContain('replaceNode(chip, wrapInlineChip(citeChipHtml(next, label, { broken })));');
    // nothing new to add → no mutation at all, so no undo step is spent
    expect(body).toContain('if (next.length === cur.length) return true;');
  });

  it('adjacency is at most ONE whitespace, direction-checked, and never across punctuation', () => {
    expect(EDITOR).toContain('const joinableGap = (s) => s.length <= 1 && !NON_SPACE_RE.test(s);');
    // scoped to the caret's own line block, because a block boundary contributes
    // NOTHING to Range.toString() and would otherwise read as adjacent
    const fn = EDITOR.slice(EDITOR.indexOf('const adjacentCiteChip = () => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('const line = lineBlockOf(r.startContainer);');
    expect(body).toContain('if (lineBlockOf(chip) !== line) continue;');
    /* The DIRECTION is established before the gap is measured. A Range whose end is
       set before its start does not throw — it collapses onto the end point — so an
       unguarded probe reports an EMPTY gap for every chip on the wrong side, and any
       chip in the paragraph read as adjacent. Reproduced under chromium. */
    expect(body).toContain('end.compareBoundaryPoints(Range.START_TO_START, caret) <= 0');
  });

  it('120.md r2 — a SOFT LINE BREAK in the gap is content, so nothing merges across it', () => {
    /* Shift+Enter reaches the browser untouched (only Enter inside a caption title is
       claimed), so it puts a real <br> in the paragraph — and a <br> contributes
       NOTHING to Range.toString(). The gap between a chip and a caret one visual line
       below stringified to the single nbsp the chip inserter leaves behind, so
       citation B merged into the chip on the PREVIOUS line and nothing appeared where
       the researcher was typing. mdDom serializes br → '\n', so this is model content,
       not decoration. */
    const fn = EDITOR.slice(EDITOR.indexOf('const adjacentCiteChip = () => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('if (gapHasElement(gap)) continue;');
    expect(body.indexOf('if (gapHasElement(gap)) continue;'))
      .toBeLessThan(body.indexOf('if (joinableGap(gap.toString())) return chip;'));
    // the probe CLONES the range, because toString() cannot see an element boundary
    const probe = EDITOR.slice(EDITOR.indexOf('const gapHasElement = (range) => {'));
    const probeBody = probe.slice(0, probe.indexOf('\n  };'));
    expect(probeBody).toContain('range.cloneContents()');
    expect(probeBody).toContain('frag.querySelectorAll(\'*\')');
    expect(EDITOR).toContain("const VOID_CONTENT_TAGS = new Set(['BR', 'IMG', 'HR', 'VIDEO', 'CANVAS', 'INPUT']);");
  });

  it('an inline chip is inserted inside a sacrificial wrapper (the list-item defect)', () => {
    /* Blink's execCommand('insertHTML') UNWRAPS the outermost element of the
       fragment when the caret is inside an <li>: the chip arrived as literal text,
       with no data-cite and nothing for the renumbering effect to find. The repair
       is a shape, not a browser check. */
    expect(EDITOR).toContain('const wrapInlineChip = (chipHtml) => `<span>${chipHtml}</span>`;');
    expect(EDITOR).toContain('insertHtml(`${wrapInlineChip(citeChipHtml(ids, label, { broken }))}&nbsp;`);');
    expect(EDITOR).toContain('insertHtml(`${wrapInlineChip(assetChipHtml(assetId, label, { broken }))}&nbsp;`);');
    /* …and every chip mutation path uses it, so the shape can never drift apart:
       insert citation, insert cross-reference, group into an existing chip, remove
       one id from a multi-cite, relink a cross-reference. */
    expect(EDITOR.match(/wrapInlineChip\(/g)).toHaveLength(5);
  });

  it('a selection is collapsed to its END — never deleted, marks untouched', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const collapseSelectionToEnd = () => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('end.collapse(false);');
    expect(body).not.toContain('deleteContents');
    // both inline inserts use it, and both resolve the caret first
    for (const m of ['insertCitation: (refId) => {', 'insertAssetRef: (assetId) => {']) {
      const f = EDITOR.slice(EDITOR.indexOf(m));
      const b = f.slice(0, f.indexOf('\n    },'));
      expect(b).toContain('if (!focusWithSelection()) return;');
      expect(b).toContain('collapseSelectionToEnd();');
    }
  });

  it('the chip DOM shape (the serialization contract) is untouched', () => {
    // 120.md §5 changes WHERE a chip goes and how many ids one carries — never what
    // a chip IS. data-cite / data-asset are read by htmlToMd and by the exporter.
    expect(EDITOR).toContain('citeChipHtml(ids, label, { broken })');
    expect(EDITOR).toContain('assetChipHtml(assetId, label, { broken })');
  });

  it('the abstract un-registers its sub-editors when they unmount', () => {
    expect(ABSTRACT).toContain('const refFor = (slot) => {');
    expect(ABSTRACT).toContain('if (prev && releaseRef.current) releaseRef.current(prev);');
    expect(ABSTRACT).toContain('ref={refFor(i)}');
    expect(ABSTRACT).toContain("ref={refFor('free')}");
    // identity-checked on the workspace side: several editors share one section id
    const fn = PANELS.slice(PANELS.indexOf('release: (api) => {'));
    const body = fn.slice(0, fn.indexOf('\n        },'));
    expect(body).toContain('if (apis.current.get(s.id) === api) apis.current.delete(s.id);');
    expect(body).toContain('if (activeApi.current === api) activeApi.current = null;');
    expect(PANELS).toContain('onRelease: handles.abstract ? handles.abstract.release : null,');
  });
});

describe('120.md §7 — the paste ladder is ONE handler with an HTML-first order', () => {
  it('exactly one paste handler exists, and no beforeinput layer was added', () => {
    expect(EDITOR.match(/const onPaste = \(e\) => \{/g)).toHaveLength(1);
    expect(EDITOR.match(/onPaste=\{onPaste\}/g)).toHaveLength(1);
    expect(EDITOR).not.toMatch(/onBeforeInput|addEventListener\(\s*['"]beforeinput/);
    expect(EDITOR).not.toContain("addEventListener('paste'");
  });

  it('the table check runs BEFORE the image branch', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const onPaste = (e) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    const tableAt = body.indexOf('if (hasPipeTableBlock(mdHtml))');
    const imageAt = body.indexOf('const imgs = imageFilesFrom(cd);');
    expect(tableAt).toBeGreaterThan(-1);
    expect(imageAt).toBeGreaterThan(-1);
    expect(tableAt).toBeLessThan(imageAt);
    /* the check is asked of the SANITIZED markdown, never of the raw string.
       120.md r2 — and of the sanitized markdown with DEGENERATE (1×1) tables already
       reduced to their text, so one copied Excel cell cannot mint a manuscript Table
       object. Still one conversion of the clipboard HTML, still before the image rung. */
    expect(body).toContain('const mdHtml = html ? flattenDegenerateTables(htmlToMd(html)) : \'\';');
    // …and every branch is a mutually-exclusive return
    expect(body).toContain('{ pasteMarkdown(e, mdHtml, { table: true }); return; }');
    expect(body).toContain('{ e.preventDefault(); placeImageFiles(imgs); return; }');
    expect(body).toContain('{ pasteMarkdown(e, tsv, { table: true }); return; }');
  });

  it('120.md r2 — a GAP-redirected multi-block prose paste is hoisted, not truncated', () => {
    /* The §4 gap redirect moves the caret into the caption title before the ladder
       runs, so `titleRegionAtCaret()` is truthy for ANY paste that lands there — and
       the title rung flattens to the first line. That contract is right for a paste
       the researcher aimed at a title and wrong for a caret the BROWSER chose (a
       boundary click lands between the caption island and its table): two pasted
       paragraphs became one line inside the title and the rest was silently gone,
       while the identical paste WITH a table in it kept every paragraph. */
    const fn = EDITOR.slice(EDITOR.indexOf('const onPaste = (e) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('if (gapTitle) { placeCaretInTitle(gapTitle); gapRedirected = true; }');
    expect(body).toContain('if (gapRedirected && /\\n/.test(String(mdHtml).trim())) {');
    expect(body).toContain('pasteMarkdown(e, mdHtml, { block: true });');
    // …and `block` hoists past the whole media object, exactly like a table paste.
    expect(EDITOR).toContain('const hasBlock = opts.table || opts.block');
  });

  it('the TSV rung is reached only when there is no text/html at all', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const onPaste = (e) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    const noHtmlAt = body.indexOf('if (!html) {');
    const tsvAt = body.indexOf('const tsv = tsvToPipeTable(plain);');
    expect(noHtmlAt).toBeGreaterThan(-1);
    expect(tsvAt).toBeGreaterThan(noHtmlAt);
    // no UA sniffing anywhere in the editor
    expect(EDITOR).not.toMatch(/navigator\.(userAgent|vendor)/);
  });

  it('readOnly still swallows the paste, and image FILES are still the only image path', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const onPaste = (e) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body.indexOf('if (readOnly) { e.preventDefault(); return; }')).toBe(body.indexOf('if (readOnly)'));
    expect(body).toContain('imageFilesFrom(cd)');
    expect(EDITOR).not.toContain('data:image');            // nothing is ever inlined
  });

  it('a pasted table is inserted through the ONE insertHtml call and stamped as imported', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const pasteMarkdown = (e, md0, opts = {}) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body.match(/insertHtml\(/g)).toHaveLength(1);   // ONE undo step per paste
    expect(body).toContain('transformPastedMd(md0, {');
    expect(body).toContain("cb(t.id, { origin: 'paste', createdAt });");
    expect(body).toContain('hoistFromIslands: hasBlock');
  });

  it('a non-table paste into a media TITLE inserts plain text, verified against WebKit', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const insertPlainText = (text) => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    // execCommand may report success and do nothing in WebKit → prove it, then fall back
    expect(body).toContain("document.execCommand('insertText', false, s)");
    expect(body).toContain("const moved = host ? (host.textContent || '') !== was : false;");
    expect(body).toContain('if ((!ok || !moved) && s) {');
    const paste = EDITOR.slice(EDITOR.indexOf('const onPaste = (e) => {'));
    expect(paste.slice(0, paste.indexOf('\n  };')))
      .toContain('insertPlainText(firstLineOf(plain || stripInlineMd(mdHtml)));');
  });
});
