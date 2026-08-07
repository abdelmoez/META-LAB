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
 *
 * 101.md adds two things on top of that, both deliberately small:
 *   §4/§33  fact chips refresh IN PLACE from `facts`, using the same effect pattern
 *           as cite/asset renumbering. A project change therefore updates the
 *           manuscript without a remount, without touching prose, and without
 *           moving the caret of someone mid-sentence.
 *   §6      `showChanges` sets one attribute on the root. Nothing else. Every
 *           overlay pixel lives in CSS behind [data-show-changes="true"], so the
 *           document is byte-identical in both modes and turning the toggle off
 *           leaves a genuinely clean manuscript.
 */
import { useRef, useEffect, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { C, btnS, inp } from '../../../frontend/workspace/ui/styles.js';
import { alpha } from '../../../frontend/theme/tokens.js';
import {
  mdToHtml, htmlToMd, citeChipHtml, factChipText, factOf,
  CITE_CHIP_CLASS, ASSET_CHIP_CLASS, FACT_CHIP_CLASS, INPUT_CHIP_CLASS,
} from './mdDom.js';
import { SHOW_CHANGES_CSS, indexFactChanges, factChipTitle } from '../showChanges.js';

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
.ms-page-body .${ASSET_CHIP_CLASS}{display:inline-block;background:#eaf6ef;color:#1e7a46;border:1px solid #bfe3cd;
  border-radius:10px;padding:0 6px;margin:0 1px;font:600 10.5px/1.7 'IBM Plex Sans',sans-serif;
  vertical-align:baseline;cursor:default;white-space:nowrap;}
/* 101.md §6 — the fact chip is deliberately NOT a chip to look at. It is an element
   only so a project-derived value stays atomic and caret-safe; visually it must be
   indistinguishable from the prose around it, or "turn Show Changes off → completely
   clean manuscript" would be a half-truth. Everything is reset to inherit, so a
   future global chip rule cannot accidentally start decorating facts either. All of
   its paint lives in SHOW_CHANGES_CSS, behind [data-show-changes="true"]. */
.ms-page-body .${FACT_CHIP_CLASS}{background:none;border:0;border-radius:0;padding:0;margin:0;
  color:inherit;font:inherit;letter-spacing:inherit;text-decoration:none;box-shadow:none;
  display:inline;white-space:normal;cursor:inherit;}

/* 102.md §4 — an unresolved manual field must be "noticeable enough that users
   understand they require manual input, but not visually distracting". So: the
   prose font is kept (this is draft manuscript text, not a widget), and the only
   decoration is a soft tint plus a dotted underline. The dotted underline is what
   carries the meaning when colour is unavailable — printouts, high-contrast mode,
   and colour-blind readers all still see "this is unfinished". */
.ms-page-body .${INPUT_CHIP_CLASS}{font:inherit;color:#8a5a00;background:rgba(214,158,46,0.10);
  border-bottom:1px dotted rgba(138,90,0,0.75);border-radius:2px;padding:0 2px;
  cursor:pointer;white-space:normal;}
.ms-page-body .${INPUT_CHIP_CLASS}:hover{background:rgba(214,158,46,0.18);}
/* The current navigation target, so "next field" has somewhere visible to land. */
.ms-page-body .${INPUT_CHIP_CLASS}[data-input-current="true"]{background:rgba(214,158,46,0.28);
  box-shadow:0 0 0 2px rgba(214,158,46,0.45);}
.ms-page-body .${INPUT_CHIP_CLASS}:focus-visible{outline:2px solid #8a5a00;outline-offset:1px;}
/* A field the PROJECT will fill (101.md §17: typing here would fabricate
   methodology). Cool tint + a dashed rule so it reads as "waiting", not "yours to
   write", and the two kinds stay distinguishable without relying on hue alone. */
.ms-page-body .${INPUT_CHIP_CLASS}[data-input-kind="pending"]{color:#1f5673;
  background:rgba(43,122,163,0.10);border-bottom:1px dashed rgba(31,86,115,0.75);}
.ms-page-body .${INPUT_CHIP_CLASS}[data-input-kind="pending"]:hover{background:rgba(43,122,163,0.18);}
@media (prefers-reduced-motion: reduce){
  .ms-page-body .${INPUT_CHIP_CLASS}{transition:none;}
}
${SHOW_CHANGES_CSS}`;

/** Set-or-remove an attribute, writing only when it actually differs (a no-op write
    inside a contentEditable can still cost a style recalculation). */
function setAttr(el, name, val) {
  if (val) { if (el.getAttribute(name) !== val) el.setAttribute(name, val); }
  else if (el.hasAttribute(name)) el.removeAttribute(name);
}

export const RichSectionEditor = forwardRef(function RichSectionEditor({
  value, orderMap, onChange, placeholder, minHeight = 340,
  ariaLabel, testId = 'stitch-manuscript-rich-editor', onActivate,
  // 85.md B2 — asset-chip numbering (resolveNumbering.byId, Map or plain object;
  // absent → chips read 'Table ?'). The workspace gates this on sourcesSettled
  // (pre-settle it passes a '…' lookup) so numbers never flicker.
  assetNumbers = null,
  // 73.md Part 9 — locked sections render read-only: contentEditable off, no
  // emits, no paste rewriting. The parent remounts on lock toggle (resetKey).
  readOnly = false,
  // 101.md §4/§5 — live fact resolution. `facts` is resolveFacts() output,
  // `factOverrides` the §10 pinned wordings, `factChanges` the change log (or key
  // set) that marks a value as recently updated. All three are refreshed IN PLACE
  // by the effect below, never by re-rendering HTML into the surface (§33).
  facts = null,
  factOverrides = null,
  factChanges = null,
  // 101.md §6 — pure visualization switch. It only sets an attribute; the DOM's
  // text content is byte-identical in both modes.
  showChanges = false,
  // 102.md §3 — notified with the placeholder's label when the researcher clicks
  // one, so the workspace can keep its "current field" marker in step.
  onPlaceholderFocus = null,
}, ref) {
  const rootRef = useRef(null);
  const savedRange = useRef(null);
  const orderMapRef = useRef(orderMap);
  const assetNumbersRef = useRef(assetNumbers);
  const onChangeRef = useRef(onChange);
  useEffect(() => { orderMapRef.current = orderMap; });
  useEffect(() => { assetNumbersRef.current = assetNumbers; });
  useEffect(() => { onChangeRef.current = onChange; });
  // One bundle so insertMarkdown()/paste render fact tokens against the SAME
  // snapshot the rest of the section is showing (§16).
  const factOptsRef = useRef(null);
  factOptsRef.current = { facts, factOverrides, factChanges, showChanges };

  // Rendered from props exactly once (per mount/key) — React sees the SAME
  // __html string on every re-render and never touches the live DOM again.
  const html0 = useRef(null);
  if (html0.current == null) {
    html0.current = mdToHtml(value || '', { orderMap, assetNumbers, facts, factOverrides, factChanges, showChanges });
  }

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

  // Asset chips renumber the same way ('Table 2' ⇄ 'Table ?') when numbering or
  // availability changes — atomic islands, caret-safe.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !assetNumbers || typeof el.querySelectorAll !== 'function') return;
    const lookup = typeof assetNumbers.get === 'function'
      ? (id) => assetNumbers.get(id) : (id) => assetNumbers[id];
    el.querySelectorAll(`span.${ASSET_CHIP_CLASS}[data-asset]`).forEach((chip) => {
      const id = chip.getAttribute('data-asset') || '';
      const n = lookup(id);
      const label = `${id.startsWith('figure:') ? 'Figure' : 'Table'} ${n == null ? '?' : n}`;
      if (chip.textContent !== label) chip.textContent = label;
    });
  }, [assetNumbers]);

  // 101.md §4/§33 — THE live-synchronization seam. When the project changes, the
  // engine re-resolves the facts and this effect writes the new values into the
  // existing chips. Exactly the cite/asset renumbering pattern above: chips are
  // contenteditable=false islands, so an engine-driven update lands mid-sentence
  // WITHOUT touching the surrounding prose, remounting the editor, or moving the
  // caret of a researcher who is typing three words away. That is what makes §4
  // ("no Refresh manuscript button") and §5 ("do not overwrite human prose")
  // simultaneously true.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof el.querySelectorAll !== 'function') return;
    const changed = indexFactChanges(factChanges);
    el.querySelectorAll(`span.${FACT_CHIP_CLASS}[data-fact]`).forEach((chip) => {
      const key = chip.getAttribute('data-fact') || '';
      const f = factOf(facts, key);
      const text = factChipText(key, facts, factOverrides);
      if (chip.textContent !== text) chip.textContent = text;
      // Inert provenance hooks — CSS in showChanges.js is the only thing that reads
      // them, and only while the toggle is on.
      setAttr(chip, 'data-engine', f && f.engine ? f.engine : '');
      setAttr(chip, 'data-changed', changed.has(key) ? 'true' : '');
      setAttr(chip, 'data-missing', f && f.missing ? 'true' : '');
      // §6 — a tooltip is a provenance marker too, so it exists only in the mode
      // that is meant to show provenance.
      setAttr(chip, 'title', showChanges ? factChipTitle(key, f, changed.get(key)) : '');
    });
  }, [facts, factOverrides, factChanges, showChanges]);

  /* ══════════ 102.md §3 — click a placeholder, select ALL of it ══════════
   *
   * "Clicking anywhere inside `[Enter institution name]` should select the entire
   * `[Enter institution name]`" so the researcher can type straight over it.
   *
   * The chip is an atomic contenteditable=false island, so a click lands next to
   * it rather than inside it; selecting the node explicitly is what turns it into
   * the form-field behaviour §85 asks for. Nothing here mutates the document, so
   * undo/redo, autosave and the caret contract (§9) are untouched — this only
   * moves the selection.
   */
  const selectPlaceholderNode = useCallback((node) => {
    if (!node || typeof window === 'undefined' || !window.getSelection) return;
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    r.selectNode(node);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange.current = r.cloneRange();
  }, []);

  /** The placeholder chip a click/keypress landed on, or null. */
  const placeholderFrom = (target) => {
    if (!target || typeof target.closest !== 'function') return null;
    const el = target.closest(`span.${INPUT_CHIP_CLASS}[data-input]`);
    return el && rootRef.current && rootRef.current.contains(el) ? el : null;
  };

  /**
   * Keyboard parity for §3. The chip carries role="button" and tabindex=0, so it is
   * reachable by Tab; without this it would be focusable but inert, which is worse
   * than not being focusable at all. Enter/Space selects the whole field so the very
   * next keystroke replaces it — the same outcome a click gives.
   */
  const onPlaceholderKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return false;
    const chip = placeholderFrom(e.target);
    if (!chip) return false;
    e.preventDefault();
    selectPlaceholderNode(chip);
    onPlaceholderFocusRef.current && onPlaceholderFocusRef.current(chip.getAttribute('data-input') || '');
    return true;
  };

  const onPlaceholderMouseDown = (e) => {
    const chip = placeholderFrom(e.target);
    if (!chip) return;
    // preventDefault stops the browser placing a collapsed caret beside the chip,
    // which would immediately undo the selection we are about to make.
    e.preventDefault();
    selectPlaceholderNode(chip);
    if (!readOnlyRef.current) rootRef.current && rootRef.current.focus();
    onPlaceholderFocusRef.current && onPlaceholderFocusRef.current(chip.getAttribute('data-input') || '');
  };

  const readOnlyRef = useRef(readOnly);
  useEffect(() => { readOnlyRef.current = readOnly; });
  const onPlaceholderFocusRef = useRef(onPlaceholderFocus);
  useEffect(() => { onPlaceholderFocusRef.current = onPlaceholderFocus; });

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
    insertMarkdown: (md) => insertHtml(mdToHtml(md, {
      orderMap: orderMapRef.current, assetNumbers: assetNumbersRef.current, ...factOptsRef.current,
    })),
    /** Insert an atomic citation chip at the caret. */
    insertCitation: (refId) => {
      if (!refId) return;
      const n = orderMapRef.current && orderMapRef.current.get(refId);
      insertHtml(`${citeChipHtml(refId, n)}&nbsp;`);
    },
    /**
     * 102.md §2/§27 — reveal the Nth placeholder in THIS section: scroll it into
     * view, select the whole thing, and focus the editor so the researcher can type
     * immediately. Returns false when this section has no such placeholder, which
     * is how the workspace knows to move on to the next section.
     */
    focusPlaceholder: (ordinal = 0) => {
      const el = rootRef.current;
      if (!el || typeof el.querySelectorAll !== 'function') return false;
      const chips = el.querySelectorAll(`span.${INPUT_CHIP_CLASS}[data-input]`);
      const chip = chips[ordinal];
      if (!chip) return false;
      if (typeof chip.scrollIntoView === 'function') {
        // 'nearest' avoids yanking the page when the field is already visible;
        // reduced-motion users get an instant jump from the CSS side.
        chip.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      el.focus();
      selectPlaceholderNode(chip);
      return true;
    },
    /** How many placeholder chips this section currently renders. */
    placeholderCount: () => {
      const el = rootRef.current;
      if (!el || typeof el.querySelectorAll !== 'function') return 0;
      return el.querySelectorAll(`span.${INPUT_CHIP_CLASS}[data-input]`).length;
    },
  }), [exec, insertHtml, selectPlaceholderNode]);
  apiRef.current = api;
  useImperativeHandle(ref, () => api, [api]);

  /**
   * 101.md §11 — undo.
   *
   * Ctrl/Cmd+Z is deliberately NOT intercepted. Every mutation this editor makes
   * goes through document.execCommand, which pushes onto the browser's NATIVE undo
   * stack, so the platform shortcut already does the right thing; swallowing it here
   * would only replace a working implementation with a worse one. The subsequent
   * `input` event (inputType 'historyUndo') re-runs emit(), so the parent's autosave
   * sees the reverted markdown like any other edit.
   *
   * §11's real requirement is the SCOPE, and it holds structurally: this stack is
   * owned by one contentEditable element and contains only text operations on it.
   * Research data — screening decisions, extracted values, analysis settings, risk-of-
   * bias judgments — is never mutated from this surface; it changes through the
   * engines, is recorded in the ProjectEvent ledger, and reaches the manuscript only
   * as re-resolved fact-chip TEXT (see the fact effect above). There is therefore no
   * path by which Ctrl+Z here can undo a research operation. Reverting project data
   * is the project history's job; reverting a fact's WORDING is the §10 provenance
   * card's job. Three separate histories, on purpose.
   *
   * Redo: Ctrl+Shift+Z is the cross-platform gesture, Ctrl+Y the Windows one. Both
   * route to execCommand('redo') — the same native stack, just a shortcut some
   * engines do not map by default.
   */
  const onKeyDown = (e) => {
    // 102.md §3 — Enter/Space on a focused placeholder selects the whole field.
    if (onPlaceholderKeyDown(e)) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = String(e.key || '').toLowerCase();
    if (k === 'b') { e.preventDefault(); exec('bold'); }
    else if (k === 'i') { e.preventDefault(); exec('italic'); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); exec('redo'); }
    // k === 'z' without shift → falls through to the browser's native undo.
  };

  const onPaste = (e) => {
    if (readOnly) { e.preventDefault(); return; }
    const cd = e.clipboardData;
    if (!cd) return;
    const html = cd.getData && cd.getData('text/html');
    if (!html) return; // plain-text paste → browser default (inserted as text)
    e.preventDefault();
    // Word/Docs HTML → markdown subset → clean HTML (everything else drops to text)
    insertHtml(mdToHtml(htmlToMd(html), {
      orderMap: orderMapRef.current, assetNumbers: assetNumbersRef.current, ...factOptsRef.current,
    }));
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
      /* 101.md §6 — the ONE thing the Show Changes toggle changes. Every overlay rule
         in SHOW_CHANGES_CSS hangs off this attribute, so the document itself (text,
         chips, markdown) is byte-identical in both modes. */
      data-show-changes={showChanges ? 'true' : 'false'}
      data-placeholder={placeholder || 'Write this section, or generate it from your project data.'}
      spellCheck
      onInput={() => { rememberSelection(); emit(); }}
      onKeyDown={readOnly ? undefined : onKeyDown}
      onKeyUp={rememberSelection}
      onMouseUp={rememberSelection}
      /* 102.md §3 — click anywhere in a placeholder and the WHOLE field (both
         brackets included) is selected, ready to be typed over. */
      onMouseDown={readOnly ? undefined : onPlaceholderMouseDown}
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
