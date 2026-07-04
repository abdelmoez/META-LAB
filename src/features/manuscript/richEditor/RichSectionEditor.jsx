/**
 * features/manuscript/richEditor/RichSectionEditor.jsx — 65.md (MS-CORE). The
 * Word-like contentEditable surface over the pure mdDom converters. The user only
 * ever sees FORMATTED content (real headings/bold/lists/tables/citation chips);
 * markdown exists solely as the persistence format.
 *
 * Cursor safety: the DOM is rendered from props exactly ONCE per `key` — the
 * parent remounts the editor (key = section identity + lastGeneratedAt) instead
 * of re-rendering HTML into a surface the user is typing in. Every input event
 * serializes DOM → markdown and hands it to the parent, which debounces through
 * the existing useManuscript queueEdit path.
 *
 * Commands go through document.execCommand (keeps native undo/redo) with a
 * Range-API fallback when a command is unsupported. Paste is sanitized down to
 * the markdown subset (Word/Docs HTML → htmlToMd → mdToHtml).
 */
import { useRef, useEffect, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { C, btnS, inp } from '../../../frontend/workspace/ui/styles.js';
import { alpha } from '../../../frontend/theme/tokens.js';
import { mdToHtml, htmlToMd, citeChipHtml, CITE_CHIP_CLASS } from './mdDom.js';

/* Page-scoped CSS: the paper is LITERAL white in both themes (a printed page),
   so the ink colors are fixed — theme tokens on purpose only OUTSIDE the page. */
export const RICH_EDITOR_CSS = `
.ms-paper{background:#ffffff;color:#1c2330;border:1px solid rgba(15,23,42,0.10);border-radius:6px;
  box-shadow:0 1px 2px rgba(15,23,42,0.10),0 14px 34px rgba(15,23,42,0.12);}
.ms-page-body{font-family:Georgia,'Times New Roman',serif;font-size:14.5px;line-height:1.8;color:#1c2330;}
.ms-rich{outline:none;min-height:340px;caret-color:#1c2330;}
.ms-rich:empty::before{content:attr(data-placeholder);color:#98a1b3;font-style:italic;pointer-events:none;}
.ms-page-body h2{font-size:1.3em;font-weight:700;line-height:1.35;margin:1.05em 0 0.45em;}
.ms-page-body h3{font-size:1.12em;font-weight:700;line-height:1.35;margin:0.95em 0 0.4em;}
.ms-page-body h4{font-size:1em;font-weight:700;font-style:italic;margin:0.85em 0 0.35em;}
.ms-page-body p{margin:0 0 0.85em;}
.ms-page-body ul,.ms-page-body ol{margin:0 0 0.85em;padding-left:1.7em;}
.ms-page-body li{margin:0 0 0.25em;}
.ms-page-body table{border-collapse:collapse;width:100%;margin:0 0 1em;font-size:0.92em;}
.ms-page-body th,.ms-page-body td{border:1px solid #cbd2dc;padding:5px 9px;text-align:left;vertical-align:top;}
.ms-page-body th{background:#f4f6f9;font-weight:700;}
.ms-page-body code{font-family:'IBM Plex Mono',monospace;font-size:0.88em;background:#f4f6f9;
  border:1px solid #e2e6ee;border-radius:4px;padding:0 4px;}
.ms-page-body a{color:#2450b3;text-decoration:underline;}
.ms-page-body .${CITE_CHIP_CLASS}{display:inline-block;background:#e8edff;color:#3448c5;border:1px solid #c3cdf5;
  border-radius:10px;padding:0 6px;margin:0 1px;font:600 10.5px/1.7 'IBM Plex Sans',sans-serif;
  vertical-align:baseline;cursor:default;white-space:nowrap;}
`;

export const RichSectionEditor = forwardRef(function RichSectionEditor({
  value, orderMap, onChange, placeholder, minHeight = 340,
  ariaLabel, testId = 'stitch-manuscript-rich-editor', onActivate,
  // 73.md Part 9 — locked sections render read-only: contentEditable off, no
  // emits, no paste rewriting. The parent remounts on lock toggle (resetKey).
  readOnly = false,
}, ref) {
  const rootRef = useRef(null);
  const savedRange = useRef(null);
  const orderMapRef = useRef(orderMap);
  const onChangeRef = useRef(onChange);
  useEffect(() => { orderMapRef.current = orderMap; });
  useEffect(() => { onChangeRef.current = onChange; });

  // Rendered from props exactly once (per mount/key) — React sees the SAME
  // __html string on every re-render and never touches the live DOM again.
  const html0 = useRef(null);
  if (html0.current == null) html0.current = mdToHtml(value || '', { orderMap });

  // Chips renumber in place when the order of first appearance changes; chips
  // are contenteditable=false islands, so this never disturbs the caret.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !orderMap || typeof el.querySelectorAll !== 'function') return;
    el.querySelectorAll(`span.${CITE_CHIP_CLASS}[data-cite]`).forEach((chip) => {
      const n = orderMap.get(chip.getAttribute('data-cite'));
      const label = `[${n == null ? '?' : n}]`;
      if (chip.textContent !== label) chip.textContent = label;
    });
  }, [orderMap]);

  const readOnlyRef = useRef(readOnly);
  useEffect(() => { readOnlyRef.current = readOnly; });

  const emit = useCallback(() => {
    if (readOnlyRef.current) return;
    const el = rootRef.current;
    if (!el) return;
    onChangeRef.current && onChangeRef.current(htmlToMd(el.innerHTML));
  }, []);

  const selectionInRoot = () => {
    const sel = typeof window !== 'undefined' && window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || !rootRef.current) return false;
    return rootRef.current.contains(sel.getRangeAt(0).commonAncestorContainer);
  };

  const apiRef = useRef(null);

  const rememberSelection = () => {
    const sel = typeof window !== 'undefined' && window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || !rootRef.current) return;
    const r = sel.getRangeAt(0);
    if (rootRef.current.contains(r.commonAncestorContainer)) {
      savedRange.current = r.cloneRange();
      // hand THIS editor's api to the parent — one shared toolbar can then act on
      // whichever field last held the caret (abstract subsections, MS-5)
      onActivate && onActivate(apiRef.current);
    }
  };

  // Refocus the editor and restore the last known caret (toolbar buttons and the
  // citation picker steal focus). Falls back to caret-at-end.
  const focusWithSelection = () => {
    const el = rootRef.current;
    if (!el) return false;
    if (selectionInRoot()) return true;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return true;
    sel.removeAllRanges();
    if (savedRange.current && el.contains(savedRange.current.commonAncestorContainer)) {
      sel.addRange(savedRange.current);
    } else {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.addRange(r);
    }
    return true;
  };

  const exec = useCallback((cmd, val) => {
    if (!focusWithSelection()) return;
    try { document.execCommand(cmd, false, val); } catch { /* unsupported command → no-op */ }
    rememberSelection();
    emit();
  }, [emit]); // eslint-disable-line react-hooks/exhaustive-deps

  const insertHtml = useCallback((html) => {
    if (!focusWithSelection()) return;
    let ok = false;
    try { ok = document.execCommand('insertHTML', false, html); } catch { ok = false; }
    if (!ok) {
      // Range fallback for engines without insertHTML
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        r.deleteContents();
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        const lastNode = tpl.content.lastChild;
        r.insertNode(tpl.content);
        if (lastNode) {
          r.setStartAfter(lastNode);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
    }
    rememberSelection();
    emit();
  }, [emit]); // eslint-disable-line react-hooks/exhaustive-deps

  const api = useMemo(() => ({
    exec,
    focus: () => rootRef.current && rootRef.current.focus(),
    /** Insert subset markdown at the caret as normal editable content (MS-8). */
    insertMarkdown: (md) => insertHtml(mdToHtml(md, { orderMap: orderMapRef.current })),
    /** Insert an atomic citation chip at the caret. */
    insertCitation: (refId) => {
      if (!refId) return;
      const n = orderMapRef.current && orderMapRef.current.get(refId);
      insertHtml(`${citeChipHtml(refId, n)}&nbsp;`);
    },
  }), [exec, insertHtml]);
  apiRef.current = api;
  useImperativeHandle(ref, () => api, [api]);

  const onKeyDown = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = String(e.key || '').toLowerCase();
    if (k === 'b') { e.preventDefault(); exec('bold'); }
    else if (k === 'i') { e.preventDefault(); exec('italic'); }
  };

  const onPaste = (e) => {
    if (readOnly) { e.preventDefault(); return; }
    const cd = e.clipboardData;
    if (!cd) return;
    const html = cd.getData && cd.getData('text/html');
    if (!html) return; // plain-text paste → browser default (inserted as text)
    e.preventDefault();
    // Word/Docs HTML → markdown subset → clean HTML (everything else drops to text)
    insertHtml(mdToHtml(htmlToMd(html), { orderMap: orderMapRef.current }));
  };

  return (
    <div
      ref={rootRef}
      className="ms-rich ms-page-body"
      style={{ minHeight, ...(readOnly ? { opacity: 0.92 } : {}) }}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-readonly={readOnly ? 'true' : undefined}
      aria-label={ariaLabel || 'Section editor'}
      data-testid={testId}
      data-placeholder={placeholder || 'Write this section, or generate it from your project data.'}
      spellCheck
      onInput={() => { rememberSelection(); emit(); }}
      onKeyDown={readOnly ? undefined : onKeyDown}
      onKeyUp={rememberSelection}
      onMouseUp={rememberSelection}
      onFocus={rememberSelection}
      onPaste={onPaste}
      dangerouslySetInnerHTML={{ __html: html0.current }}
    />
  );
});

/* ════════════ toolbar ════════════ */

const TB_BUTTONS = [
  { key: 'p', glyph: '¶', aria: 'Paragraph', title: 'Paragraph', cmd: ['formatBlock', '<p>'] },
  { key: 'h2', glyph: 'H2', aria: 'Heading level 2', title: 'Heading 2', cmd: ['formatBlock', '<h2>'] },
  { key: 'h3', glyph: 'H3', aria: 'Heading level 3', title: 'Heading 3', cmd: ['formatBlock', '<h3>'] },
  { key: 'bold', glyph: 'B', aria: 'Bold (Ctrl+B)', title: 'Bold (Ctrl+B)', cmd: ['bold'], style: { fontWeight: 800 } },
  { key: 'italic', glyph: 'I', aria: 'Italic (Ctrl+I)', title: 'Italic (Ctrl+I)', cmd: ['italic'], style: { fontStyle: 'italic', fontFamily: 'Georgia,serif' } },
  { key: 'ul', glyph: '• List', aria: 'Bulleted list', title: 'Bulleted list', cmd: ['insertUnorderedList'] },
  { key: 'ol', glyph: '1. List', aria: 'Numbered list', title: 'Numbered list', cmd: ['insertOrderedList'] },
];

/**
 * Formatting toolbar. `getApi()` returns the imperative handle of the editor that
 * last had the caret (one toolbar serves the abstract's multiple fields too).
 * onMouseDown preventDefault keeps the editor selection alive through the click.
 */
export function RichToolbar({ getApi, citeRefs, refLabel, disabled }) {
  const run = (cmd) => {
    const api = getApi && getApi();
    if (api && api.exec) api.exec(cmd[0], cmd[1]);
  };
  return (
    <div role="toolbar" aria-label="Formatting" data-testid="stitch-manuscript-toolbar"
      style={{
        display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', padding: '6px 8px',
        background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, marginBottom: 10,
      }}>
      {TB_BUTTONS.map((b) => (
        <button key={b.key} type="button" aria-label={b.aria} title={b.title} disabled={disabled}
          data-testid={`stitch-manuscript-tb-${b.key}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run(b.cmd)}
          style={{
            ...btnS('ghost'), padding: '5px 9px', fontSize: 11.5, border: '1px solid transparent',
            background: 'transparent', color: C.txt2, opacity: disabled ? 0.5 : 1,
            ...(b.style || {}),
          }}>
          {b.glyph}
        </button>
      ))}
      {!disabled && citeRefs && citeRefs.length > 0 && (
        <>
          <span style={{ width: 1, alignSelf: 'stretch', background: C.brd, margin: '0 4px' }} />
          <select value="" aria-label="Insert citation" title="Insert a numbered citation at the cursor"
            data-testid="stitch-manuscript-insert-citation"
            onMouseDown={() => { /* selection already remembered by the editor's blur path */ }}
            onChange={(e) => {
              const id = e.target.value;
              e.target.value = '';
              const api = getApi && getApi();
              if (id && api && api.insertCitation) api.insertCitation(id);
            }}
            style={{ ...inp, width: 'auto', cursor: 'pointer', fontSize: 11, paddingTop: 4, paddingBottom: 4, paddingRight: 22 }}>
            <option value="">+ Cite…</option>
            {citeRefs.map((r) => <option key={r.id} value={r.id}>{refLabel ? refLabel(r) : r.id}</option>)}
          </select>
        </>
      )}
      <span style={{
        marginLeft: 'auto', fontSize: 10, color: C.muted, letterSpacing: 0.3,
        background: alpha(C.acc, '08'), padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap',
      }}>
        Formatted editing — no markup needed
      </span>
    </div>
  );
}

export default RichSectionEditor;
