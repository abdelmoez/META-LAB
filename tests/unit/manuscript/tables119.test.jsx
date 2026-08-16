/**
 * 119.md §2 — the three table defects, pinned.
 *
 * What is provable in Node is pinned here; what is only provable in a real engine
 * (a click that produces no caret, a drag across every cell, execCommand's native
 * undo step) is pinned in e2e/manuscript/manuscript-tables-119.spec.ts, which runs
 * under BOTH chromium and the new `webkit-manuscript` Playwright project — §2 is
 * explicit that Safari must not be declared fixed from Chromium alone.
 *
 * The source-string assertions are deliberate: these are CONTRACTS between an event
 * handler and a mutation path that no rendered markup can express (an insertion must
 * hoist before execCommand; a modified chord must never be claimed; the meta stamps
 * must survive an undo). readSource is the repo's established way to pin them.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readSource } from '../../helpers/readSource.js';
import { TableGridPicker, newTableOpId } from '../../../src/features/manuscript/richEditor/RichSectionEditor.jsx';
import { htmlToMd, mdToHtml } from '../../../src/features/manuscript/richEditor/mdDom.js';

const noop = () => {};
const EDITOR = readSource('src/features/manuscript/richEditor/RichSectionEditor.jsx');
const MDDOM = readSource('src/features/manuscript/richEditor/mdDom.js');
const PANELS = readSource('src/features/manuscript/manuscriptPanels.jsx');

/** The rendered caption+table pair, exactly as the editor mounts it. */
const captionedTableHtml = (id = 'tbl-a1b2c3', title = 'Study characteristics') => mdToHtml(
  `[[tblcap:${id}]] ${title}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |`,
  { assetNumbers: new Map([[`table:${id}`, 1]]) },
);

/* ══════════════ (a) the empty-title caret ══════════════ */

describe('119.md §2(a) — typing into an empty table title', () => {
  it('gives the EMPTY title real caret geometry, and only the empty one', () => {
    // An empty inline island is a zero-width box; WebKit cannot derive a caret from
    // a click on it. A title WITH text keeps display:inline so it still wraps inside
    // the caption line like the prose it is.
    expect(EDITOR).toContain('.ms-page-body .${TABLE_CAPTION_TITLE_CLASS}:empty{display:inline-block;min-width:4px;}');
    expect(EDITOR).toContain('.ms-page-body .${TABLE_CAPTION_TITLE_CLASS}:empty::before{content:attr(data-placeholder)');
  });

  it('places the caret itself when a click lands in a caption', () => {
    expect(EDITOR).toContain('const onCaptionMouseDown = (e) => {');
    expect(EDITOR).toContain('const placeCaretInTitle = (titleEl, clientX, clientY) => {');
    // …and it is wired into the ONE delegated mousedown entry point, before the
    // placeholder pass (which would move the caret back out of the island).
    const md = EDITOR.slice(EDITOR.indexOf('const onEditorMouseDown = (e) => {'));
    expect(md.indexOf('if (onCaptionMouseDown(e)) return;'))
      .toBeLessThan(md.indexOf('onPlaceholderMouseDown(e);'));
  });

  it('leaves a NON-empty title to the browser (click-to-position must keep working)', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const onCaptionMouseDown = (e) => {'),
      EDITOR.indexOf('/** One mousedown entry point'));
    expect(fn).toContain('if (inTitle && !empty) return false;');
  });

  it('uses the standard caret-from-point APIs, and NO user-agent detection', () => {
    expect(EDITOR).toContain('document.caretRangeFromPoint');
    expect(EDITOR).toContain('document.caretPositionFromPoint');
    // 119.md §2 forbids fragile UA sniffing — the fix is standards + lifecycle.
    expect(EDITOR).not.toMatch(/navigator\.(userAgent|vendor)/);
    expect(EDITOR).not.toMatch(/\bisSafari\b|\bisWebkit\b/i);
  });

  it('never lets the caret reach the derived NUMBER', () => {
    // The number stays user-select:none inside the contenteditable=false wrapper;
    // a click on it is routed to the title instead of being a dead end.
    expect(EDITOR).toContain('.ms-page-body .${TABLE_CAPTION_NUM_CLASS}{font-weight:700');
    expect(EDITOR).toContain('user-select:none;');
    const html = captionedTableHtml();
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain('data-tblcap-num="true"');
    expect(html).toContain('data-tblcap-title="true" contenteditable="true"');
  });
});

/* ══════════════ (b) one gesture, one table ══════════════ */

describe('119.md §2(b) — creating one table creates exactly one table', () => {
  it('hoists the insertion point out of caption islands and cells first', () => {
    // 119.md §5 re-pin: the hoist gained an OPTIONS argument so a whole-block
    // insertion (an uploaded figure) can also be hoisted out of the paragraph it
    // would otherwise be spliced into. The table behaviour pinned here is
    // unchanged — insertTable still asks for the island hoist and nothing else.
    expect(EDITOR).toContain('const hoistInsertionPoint = (opts = {}) => {');
    expect(EDITOR).toContain('if (opts && opts.hoistFromIslands) hoistInsertionPoint({ blockLevel: !!(opts && opts.blockLevel) });');
    // the two BLOCK insertion paths ask for it …
    expect(EDITOR).toContain('insertHtml(`${html}<p><br></p>`, { hoistFromIslands: true });');
    /* 120.md §7 re-pin: the paste path's single insertion moved into `pasteMarkdown`
       (the ladder now has three rungs that reach it — Office HTML, tab-separated
       text, and ordinary prose — and they must all insert through ONE call). The
       hoist request is unchanged; only the local's name is. */
    expect(EDITOR).toContain('}), { hoistFromIslands: hasBlock });');
    expect(EDITOR.match(/const pasteMarkdown = \(e, md0, opts = \{\}\) => \{[\s\S]*?\n  \};/)[0]
      .match(/insertHtml\(/g)).toHaveLength(1);
    // … and the INLINE ones deliberately do not (a chip inside a cell is legal).
    const cite = EDITOR.slice(EDITOR.indexOf('insertCitation: (refId) => {'));
    expect(cite.slice(0, 600)).not.toContain('hoistFromIslands');
  });

  it('the grammar is the model — a nested table would be silently lost, so it is prevented', () => {
    // Proof the corruption is real: markdown cannot express a table inside a
    // caption, so a round trip DELETES it. That is why the hoist exists.
    const cap = captionedTableHtml();
    const corrupted = cap.replace('</span></div>', `${captionedTableHtml('tbl-d4e5f6', 'Nested')}</span></div>`);
    const md = htmlToMd(corrupted);
    expect((md.match(/\[\[tblcap:/g) || []).length).toBe(1);
    expect(md).toContain('[[tblcap:tbl-a1b2c3]]');
  });

  it('carries a per-gesture operation id that makes a re-entrant insert a no-op', () => {
    expect(EDITOR).toContain('const opId = tblOpts.opId ? String(tblOpts.opId) : \'\';');
    expect(EDITOR).toContain('if (opId && insertOpIds.current.has(opId)) return insertOpIds.current.get(opId);');
    expect(EDITOR).toContain('insertOpIds.current.set(opId, id);');
    // …and the picker mints ONE id per opened gesture, then closes the gesture.
    expect(EDITOR).toContain('opRef.current = newTableOpId();');
    expect(EDITOR).toContain('api.insertTable(r, c, { opId: opRef.current });');
    expect(EDITOR).toContain('if (doneRef.current) return;');
  });

  it('mints distinct operation ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newTableOpId()));
    expect(ids.size).toBe(50);
    expect([...ids][0]).toMatch(/^tblop-/);
  });

  it('is NOT a debounce on the visible button (§2 forbids that)', () => {
    const picker = EDITOR.slice(EDITOR.indexOf('export function TableGridPicker('));
    expect(picker).not.toMatch(/setTimeout|debounce/i);
  });

  it('can be driven by keyboard — the grid has a roving tabindex and arrow keys', () => {
    const html = renderToStaticMarkup(<TableGridPicker getApi={() => null} />);
    // closed: no grid at all (the picker is a popup, not a hidden control)
    expect(html).not.toContain('stitch-manuscript-table-grid-1-1');
    const picker = EDITOR.slice(EDITOR.indexOf('export function TableGridPicker('));
    expect(picker).toContain('tabIndex={isActive ? 0 : -1}');
    expect(picker).toContain('const onGridKeyDown = (e) => {');
    expect(picker).toContain("if (e.key === 'Escape') { markOverlayEscape(); e.preventDefault(); closePicker(true); return; }");
    // a MODIFIED chord is never claimed (108.md §23 shortcut-router rule)
    expect(picker).toContain('if (e.ctrlKey || e.metaKey || e.altKey) return;');
    // keyboard-opened → focus enters the grid; mouse-opened → focus never moves
    expect(picker).toContain('onClick={(e) => { if (open) closePicker(false); else openPicker(e.detail === 0); }}');
    expect(picker).toContain("if (!open || !kbRef.current || !gridRef.current) return;");
  });

  it('restores editor focus before execCommand, so the keyboard path inserts at the caret', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const focusWithSelection = () => {'),
      EDITOR.indexOf('const exec = useCallback('));
    expect(fn).toContain('document.activeElement');
    expect(fn).toContain('if (inside && live) return true;');
  });
});

/* ══════════════ (c) whole-table deletion ══════════════ */

describe('119.md §2(c) — Delete/Backspace over a whole table', () => {
  it('claims the key ONLY for a selection that covers a whole table', () => {
    expect(EDITOR).toContain('const onTableDeleteKey = (e) => {');
    const fn = EDITOR.slice(EDITOR.indexOf('const onTableDeleteKey = (e) => {'),
      EDITOR.indexOf('const onCut = (e) => {'));
    expect(fn).toContain("if (e.key !== 'Delete' && e.key !== 'Backspace') return false;");
    // no modified chord is ever claimed, and a partial selection stays native
    expect(fn).toContain('if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;');
    expect(fn).toContain('const table = fullySelectedTable();');
    expect(fn).toContain('if (!table) return false;');
    // …and it routes to the SAME op the ✕ Table menu runs, not a second deleter
    expect(fn).toContain("runTableOp('deleteTable', null, table);");
  });

  it('"fully covered" is two-sided: every cell, and nothing outside the object', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const fullySelectedTable = () => {'),
      EDITOR.indexOf('const emit = useCallback('));
    expect(fn).toContain('if (touched.length !== 1) return null;');
    expect(fn).toContain('const coversAllCells = cells.every((c) => r.intersectsNode(c));');
    expect(fn).toContain('const straysOutside =');
    // …expressed with intersectsNode, not boundary-point arithmetic: engines
    // normalise a table drag-selection to wildly different boundary containers, and
    // a rule written against those is a rule that works in one browser.
    expect(fn).not.toContain('compareBoundaryPoints');
  });

  it('is inert in a locked section', () => {
    const kd = EDITOR.slice(EDITOR.indexOf('const onKeyDown = (e) => {'));
    expect(kd.indexOf('if (readOnlyRef.current) return;'))
      .toBeLessThan(kd.indexOf('if (onTableDeleteKey(e)) return;'));
    expect(EDITOR).toContain('const onCut = (e) => {\n    if (readOnlyRef.current) return;');
  });

  it('Cut puts usable content on the clipboard and only then deletes', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('const onCut = (e) => {'),
      EDITOR.indexOf('const onKeyDown = (e) => {'));
    expect(fn).toContain("e.clipboardData.setData('text/html', html);");
    expect(fn).toContain("e.clipboardData.setData('text/plain', htmlToMd(html));");
    // an engine that refuses the write keeps the browser default rather than
    // deleting into a void
    expect(fn).toContain('if (!ok) return;');
    expect(fn.indexOf('if (!ok) return;')).toBeLessThan(fn.indexOf('e.preventDefault();'));
    expect(EDITOR).toContain('onCut={onCut}');
  });

  it('undo restores the PROVENANCE too — the stamps are no longer erased', () => {
    const fn = PANELS.slice(PANELS.indexOf('const confirmDeleteTable = () => {'),
      PANELS.indexOf('const status = sectionStatus(section);'));
    // …and it names the table it warned about, because by the time the researcher
    // confirms, the caret has been through a dialog (WebKit keeps no selection there).
    expect(fn).toContain("api.tableOp('deleteTable', { tableId: tableDelete && tableDelete.tableId })");
    expect(fn).not.toContain('setTableMeta');
    expect(fn).toContain('119.md §2');
  });
});

/* ══════════════ (c) orphan captions ══════════════ */

describe('119.md §2 — an orphan caption does not outlive its table', () => {
  const withTable = captionedTableHtml();
  const orphan = withTable.slice(0, withTable.indexOf('<table'));

  it('a caption WITH its table always survives', () => {
    expect(htmlToMd(withTable, { dropOrphanCaptions: true })).toContain('[[tblcap:tbl-a1b2c3]] Study characteristics');
    expect(htmlToMd(withTable, { dropOrphanCaptions: true })).toContain('| A | B |');
  });

  it('a caption whose table a native delete removed is dropped on serialization', () => {
    expect(orphan).toContain('data-tblcap="tbl-a1b2c3"');
    expect(htmlToMd(orphan, { dropOrphanCaptions: true })).toBe('');
  });

  it('is OPT-IN, so every other consumer stays byte-identical', () => {
    // Paste sanitisation, table-op round trips and the pinned mdDom tests all call
    // htmlToMd/1 — a repair there would be a silent deletion outside the one place
    // the researcher is actively editing.
    expect(htmlToMd(orphan)).toContain('[[tblcap:tbl-a1b2c3]]');
    expect(htmlToMd(withTable)).toBe(htmlToMd(withTable, { dropOrphanCaptions: true }));
    expect(MDDOM).toContain('function dropOrphanCaptionBlocks(blocks) {');
  });

  it('runs on the editor emit path only, which is what makes it undo-safe', () => {
    // A native undo puts the table back in the DOM; the very next serialization
    // then emits caption + table again, so the repair is never a lost table.
    expect(EDITOR).toContain('onChangeRef.current(htmlToMd(el.innerHTML, { dropOrphanCaptions: true }))');
    expect(EDITOR).not.toContain('htmlToMd(el.innerHTML)');
  });
});
