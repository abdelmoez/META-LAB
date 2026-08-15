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
import { useRef, useState, useEffect, useMemo, useCallback, useImperativeHandle, forwardRef } from 'react';
import { C, btnS, inp } from '../../../frontend/workspace/ui/styles.js';
import { alpha } from '../../../frontend/theme/tokens.js';
import {
  mdToHtml, htmlToMd, citeChipHtml, citeChipLabel, citeChipAria,
  assetChipHtml, assetChipLabel, assetChipAria,
  factChipText, factOf,
  CITE_CHIP_CLASS, ASSET_CHIP_CLASS, FACT_CHIP_CLASS, INPUT_CHIP_CLASS,
  TABLE_CAPTION_CLASS, TABLE_CAPTION_NUM_CLASS, TABLE_CAPTION_TITLE_CLASS,
} from './mdDom.js';
// 117.md §35 — one chip may carry several reference ids; the parser is shared with
// the engine so the editor and the export can never disagree about a token.
import { parseCiteIds } from '../../../research-engine/manuscript/citations.js';
// 116.md §59-§66 — pure structural table ops; the editor only ever applies them
// by whole-table replacement through the execCommand/insertHtml path below.
// 117.md §4 — a new table is inserted WITH its caption marker (identity + title).
import { makeCaptionedTableMd, applyTableOp } from './tableOps.js';
import {
  mintManualTableId, remintDuplicateCaptions, formatCaptionPrefix, tableCaptionLine,
} from '../../../research-engine/manuscript/refTokens.js';
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
/* 117.md §38 — the citation chip is INTERACTIVE (hover preview + action menu), so
   it reads as something you can act on: pointer cursor, hover/focus affordances,
   exactly like the cross-reference chip. */
.ms-page-body .${CITE_CHIP_CLASS}{display:inline-block;background:#e8edff;color:#3448c5;border:1px solid #c3cdf5;
  border-radius:10px;padding:0 6px;margin:0 1px;font:600 10.5px/1.7 'IBM Plex Sans',sans-serif;
  vertical-align:baseline;cursor:pointer;white-space:nowrap;}
.ms-page-body .${CITE_CHIP_CLASS}:hover{background:#dae2ff;}
.ms-page-body .${CITE_CHIP_CLASS}:focus-visible{outline:2px solid #3448c5;outline-offset:1px;}
/* 117.md §39 — a citation whose reference is gone. Same never-colour-alone rule as
   the broken cross-reference: the label itself says "?" and the border is dashed. */
.ms-page-body .${CITE_CHIP_CLASS}[data-cite-broken="true"]{background:#fdecec;color:#a32020;
  border:1px dashed #dda0a0;}
.ms-page-body .${CITE_CHIP_CLASS}[data-cite-broken="true"]:hover{background:#fadada;}
.ms-page-body .${CITE_CHIP_CLASS}[data-cite-broken="true"]:focus-visible{outline-color:#a32020;}
.ms-page-body .${ASSET_CHIP_CLASS}{display:inline-block;background:#eaf6ef;color:#1e7a46;border:1px solid #bfe3cd;
  border-radius:10px;padding:0 6px;margin:0 1px;font:600 10.5px/1.7 'IBM Plex Sans',sans-serif;
  vertical-align:baseline;cursor:pointer;white-space:nowrap;}
.ms-page-body .${ASSET_CHIP_CLASS}:hover{background:#dcefe4;}
.ms-page-body .${ASSET_CHIP_CLASS}:focus-visible{outline:2px solid #1e7a46;outline-offset:1px;}
/* 117.md §11 — a reference whose target no longer exists. It must be impossible to
   mistake for a working one, and the signal cannot be colour alone (print, high
   contrast, colour blindness): the label itself says "(deleted)" and the border is
   dashed. Clicking it opens Relink / Remove — the fix is one action away. */
.ms-page-body .${ASSET_CHIP_CLASS}[data-asset-broken="true"]{background:#fdecec;color:#a32020;
  border:1px dashed #dda0a0;}
.ms-page-body .${ASSET_CHIP_CLASS}[data-asset-broken="true"]:hover{background:#fadada;}
.ms-page-body .${ASSET_CHIP_CLASS}[data-asset-broken="true"]:focus-visible{outline-color:#a32020;}

/* 117.md §4/§8 — the manual-table caption. A caption is NOT prose: it uses the UI
   sans face, sits tight above its table, and its number is derived (never typed).
   Only the title region is editable, so the researcher edits meaning and the
   template owns the rest. */
.ms-page-body .${TABLE_CAPTION_CLASS}{font:500 12.5px/1.55 'IBM Plex Sans',sans-serif;color:#1c2330;
  margin:0 0 5px;}
.ms-page-body .${TABLE_CAPTION_NUM_CLASS}{font-weight:700;color:#1e7a46;margin-right:6px;white-space:nowrap;
  user-select:none;}
.ms-page-body .${TABLE_CAPTION_TITLE_CLASS}{outline:none;display:inline;border-radius:3px;padding:0 2px;}
.ms-page-body .${TABLE_CAPTION_TITLE_CLASS}:empty::before{content:attr(data-placeholder);color:#98a1b3;
  font-style:italic;}
.ms-page-body .${TABLE_CAPTION_TITLE_CLASS}:hover{background:rgba(30,122,70,0.07);}
.ms-page-body .${TABLE_CAPTION_TITLE_CLASS}:focus{background:rgba(30,122,70,0.12);}
.ms-page-body .${TABLE_CAPTION_CLASS}[data-tblcap-current="true"]{box-shadow:0 0 0 2px rgba(30,122,70,0.40);
  border-radius:4px;}
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
  // 116.md §61/§62 — notified when the caret enters/leaves a table so the parent
  // can show the floating table controls. Called with {gridRow, col, rows, cols,
  // rect} while inside a table, null on leaving; never called during SSR.
  onTableFocus = null,
  // 117.md §11 — the live registry id set. A token outside it renders BROKEN.
  // Omitted (null) means "the registry is not known here", and every reference is
  // assumed valid — an editor that has not resolved its assets must never accuse
  // an honest reference of being deleted.
  knownAssetIds = null,
  // 117.md §8 — the draft's journal template drives the caption/label formatter.
  templateId = null,
  // 117.md §4(d) — ids used by OTHER sections, so a table pasted across sections
  // still mints a fresh id instead of colliding.
  existingTableIds = null,
  // 117.md §10 — chip interaction. The editor owns the DOM (and the caret); the
  // parent owns the popovers, because rendering React into a contentEditable is
  // how carets get destroyed. Both callbacks are pure notifications.
  onAssetChipMenu = null,     // ({id, label, broken, rect}) on click/Enter
  onAssetChipHover = null,    // ({id, label, broken, rect}) on hover, null on leave
  // 117.md §4 — created/modified stamps for the draft-side table metadata map.
  onTableMeta = null,         // (tableId, patch)
  // 117.md §37 — the draft's citation style drives the CHIP LABEL: numeric styles
  // render "[1,2]"/"[1–4]", Harvard renders "(Smith, 2020)". Absent → vancouver.
  citationStyle = null,
  // 117.md §37/§38/§39 — reference metadata by id (alias keys included). Needed by
  // author-year labels and by the broken-citation check. Absent (null) means "the
  // library is not known here", and every citation is assumed valid — the same rule
  // knownAssetIds follows for cross-references.
  refsById = null,
  // 117.md §38 — citation chip interaction. Same division of labour as the
  // cross-reference chip: the editor owns the DOM and the caret, the parent owns
  // the popovers.
  onCiteChipMenu = null,      // ({ids, label, broken, rect}) on click/Enter
  onCiteChipHover = null,     // ({ids, label, broken, rect}) on hover, null on leave
}, ref) {
  const rootRef = useRef(null);
  const savedRange = useRef(null);
  const orderMapRef = useRef(orderMap);
  const assetNumbersRef = useRef(assetNumbers);
  const onChangeRef = useRef(onChange);
  useEffect(() => { orderMapRef.current = orderMap; });
  useEffect(() => { assetNumbersRef.current = assetNumbers; });
  useEffect(() => { onChangeRef.current = onChange; });
  // 117.md — render-context refs so the memoized api closures never go stale.
  const refOptsRef = useRef(null);
  refOptsRef.current = { knownAssetIds, templateId, citationStyle, refsById };
  const onAssetChipMenuRef = useRef(onAssetChipMenu);
  const onAssetChipHoverRef = useRef(onAssetChipHover);
  const onCiteChipMenuRef = useRef(onCiteChipMenu);
  const onCiteChipHoverRef = useRef(onCiteChipHover);
  const onTableMetaRef = useRef(onTableMeta);
  const existingTableIdsRef = useRef(existingTableIds);
  useEffect(() => { onAssetChipMenuRef.current = onAssetChipMenu; });
  useEffect(() => { onAssetChipHoverRef.current = onAssetChipHover; });
  useEffect(() => { onCiteChipMenuRef.current = onCiteChipMenu; });
  useEffect(() => { onCiteChipHoverRef.current = onCiteChipHover; });
  useEffect(() => { onTableMetaRef.current = onTableMeta; });
  useEffect(() => { existingTableIdsRef.current = existingTableIds; });
  /** The chip the action menu is currently bound to (never rendered — DOM only). */
  const activeChipRef = useRef(null);
  const hoverChipRef = useRef(null);
  /** 117.md §38 — the same two refs for the CITATION chip surface. */
  const activeCiteRef = useRef(null);
  const hoverCiteRef = useRef(null);
  // One bundle so insertMarkdown()/paste render fact tokens against the SAME
  // snapshot the rest of the section is showing (§16).
  const factOptsRef = useRef(null);
  factOptsRef.current = { facts, factOverrides, factChanges, showChanges };

  // Rendered from props exactly once (per mount/key) — React sees the SAME
  // __html string on every re-render and never touches the live DOM again.
  const html0 = useRef(null);
  if (html0.current == null) {
    html0.current = mdToHtml(value || '', {
      orderMap, assetNumbers, facts, factOverrides, factChanges, showChanges,
      knownAssetIds, templateId, citationStyle, refsById,
    });
  }

  // Chips renumber in place when the order of first appearance changes; chips
  // are contenteditable=false islands, so this never disturbs the caret.
  //
  // 117.md §36/§37/§39 — this IS the renumbering seam for citations, exactly as the
  // asset effect below is for tables/figures: moving a paragraph, deleting a
  // citation, merging two references or changing the citation style all land here,
  // in place, without remounting the editor or touching one character of prose. The
  // label comes from the same `citeChipLabel` the first render used, so a chip can
  // never show a number the export disagrees with, and a citation whose reference
  // has gone flips to the visibly broken state rather than renumbering to whatever
  // now happens to sit at that position.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof el.querySelectorAll !== 'function') return;
    if (!orderMap && !refsById) return;
    el.querySelectorAll(`span.${CITE_CHIP_CLASS}[data-cite]`).forEach((chip) => {
      const raw = chip.getAttribute('data-cite') || '';
      const { label, broken } = citeChipLabel(raw, orderMap, citationStyle, refsById);
      if (chip.textContent !== label) chip.textContent = label;
      setAttr(chip, 'data-cite-broken', broken ? 'true' : '');
      setAttr(chip, 'aria-label', citeChipAria(label, broken));
    });
  }, [orderMap, citationStyle, refsById]);

  // Asset chips renumber the same way ('Table 2' ⇄ 'Table ?') when numbering or
  // availability changes — atomic islands, caret-safe.
  //
  // 117.md §5-§7/§11 — this is now the WHOLE renumbering seam: because numbering is
  // derived per render and applied in place, deleting a table, moving one, or
  // regenerating a section renumbers every chip AND every manual-table caption
  // without remounting the editor or touching a single character of prose. A chip
  // whose target has disappeared flips to the broken state here too, so a deleted
  // table can never leave a confidently-wrong "Table 2" behind.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof el.querySelectorAll !== 'function') return;
    if (!assetNumbers && !knownAssetIds) return;
    el.querySelectorAll(`span.${ASSET_CHIP_CLASS}[data-asset]`).forEach((chip) => {
      const id = chip.getAttribute('data-asset') || '';
      const { label, broken } = assetChipLabel(id, assetNumbers, knownAssetIds, templateId);
      if (chip.textContent !== label) chip.textContent = label;
      setAttr(chip, 'data-asset-broken', broken ? 'true' : '');
      setAttr(chip, 'aria-label', assetChipAria(label, broken));
    });
    // 117.md §4 — the caption's number is derived exactly like a chip's.
    el.querySelectorAll(`div.${TABLE_CAPTION_CLASS}[data-tblcap]`).forEach((cap) => {
      const num = cap.querySelector(`span.${TABLE_CAPTION_NUM_CLASS}`);
      if (!num) return;
      const id = `table:${cap.getAttribute('data-tblcap') || ''}`;
      const n = assetNumbers
        ? (typeof assetNumbers.get === 'function' ? assetNumbers.get(id) : assetNumbers[id])
        : null;
      const prefix = formatCaptionPrefix('table', n == null ? null : n, { templateId });
      if (num.textContent !== prefix) num.textContent = prefix;
    });
  }, [assetNumbers, knownAssetIds, templateId]);

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
    // 108 review — the PLAIN chord only. Ctrl/Cmd+Enter is the manuscript's
    // placeholder-STEPPING chord (102.md §26, now `manuscript.stepPlaceholder` in the
    // 108.md §23 router). This handler runs on React's root bubble, i.e. before the
    // window-bubble router, and its preventDefault() sets `defaultPrevented` — which
    // the adapter treats as "a nearer handler already claimed this event"
    // (ShortcutProvider.shouldRouteEvent). Cancelling a modified Enter here therefore
    // killed stepping outright whenever a chip happened to hold focus.
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const chip = placeholderFrom(e.target);
    if (!chip) return false;
    e.preventDefault();
    selectPlaceholderNode(chip);
    onPlaceholderFocusRef.current && onPlaceholderFocusRef.current(chip.getAttribute('data-input') || '');
    return true;
  };

  /* ══════════ 117.md §10/§11 — cross-reference chip interaction ══════════
   *
   * Delegated, DOM-only and caret-neutral. A chip is a contenteditable=false
   * island, so a mousedown on it would otherwise drop a collapsed caret beside it;
   * preventDefault keeps the researcher's caret exactly where it was while the
   * action menu opens. Nothing here mutates the document — the ACTIONS do, and
   * they go through the same execCommand/insertHtml path as every other edit, so
   * native undo and the input→autosave emit still own the history.
   */
  const chipInfo = (chip) => ({
    id: chip.getAttribute('data-asset') || '',
    label: chip.textContent || '',
    broken: chip.getAttribute('data-asset-broken') === 'true',
    rect: typeof chip.getBoundingClientRect === 'function' ? chip.getBoundingClientRect() : null,
  });

  const assetChipFrom = (target) => {
    if (!target || typeof target.closest !== 'function') return null;
    const el = target.closest(`span.${ASSET_CHIP_CLASS}[data-asset]`);
    return el && rootRef.current && rootRef.current.contains(el) ? el : null;
  };

  const openChipMenu = (chip) => {
    activeChipRef.current = chip;
    const cb = onAssetChipMenuRef.current;
    if (cb) cb(chipInfo(chip));
  };

  const onChipMouseOver = (e) => {
    const cb = onAssetChipHoverRef.current;
    if (!cb) return;
    const chip = assetChipFrom(e.target);
    if (!chip) {
      if (hoverChipRef.current) { hoverChipRef.current = null; cb(null); }
      return;
    }
    if (hoverChipRef.current === chip) return;
    hoverChipRef.current = chip;
    cb(chipInfo(chip));
  };

  const onChipMouseLeave = () => {
    const cb = onAssetChipHoverRef.current;
    if (cb && hoverChipRef.current) { hoverChipRef.current = null; cb(null); }
    const cc = onCiteChipHoverRef.current;
    if (cc && hoverCiteRef.current) { hoverCiteRef.current = null; cc(null); }
  };

  /* ══════════ 117.md §38 — citation chip interaction ══════════
   *
   * Structurally identical to the cross-reference surface above (delegated,
   * DOM-only, caret-neutral), on purpose: a researcher should not have to learn two
   * chip idioms, and one mechanism means one place where the caret contract can be
   * got right.
   */
  const citeInfo = (chip) => ({
    ids: parseCiteIds(chip.getAttribute('data-cite') || ''),
    label: chip.textContent || '',
    broken: chip.getAttribute('data-cite-broken') === 'true',
    rect: typeof chip.getBoundingClientRect === 'function' ? chip.getBoundingClientRect() : null,
  });

  const citeChipFrom = (target) => {
    if (!target || typeof target.closest !== 'function') return null;
    const el = target.closest(`span.${CITE_CHIP_CLASS}[data-cite]`);
    return el && rootRef.current && rootRef.current.contains(el) ? el : null;
  };

  const openCiteMenu = (chip) => {
    activeCiteRef.current = chip;
    const cb = onCiteChipMenuRef.current;
    if (cb) cb(citeInfo(chip));
  };

  const onCiteMouseOver = (e) => {
    const cb = onCiteChipHoverRef.current;
    if (!cb) return;
    const chip = citeChipFrom(e.target);
    if (!chip) {
      if (hoverCiteRef.current) { hoverCiteRef.current = null; cb(null); }
      return;
    }
    if (hoverCiteRef.current === chip) return;
    hoverCiteRef.current = chip;
    cb(citeInfo(chip));
  };

  /** Every manual-table id currently visible here, plus the rest of the draft. */
  const usedTableIds = () => {
    const out = new Set();
    for (const id of (existingTableIdsRef.current || [])) out.add(String(id).replace(/^table:/, ''));
    const el = rootRef.current;
    if (el && typeof el.querySelectorAll === 'function') {
      el.querySelectorAll('[data-tblcap]').forEach((n) => out.add(n.getAttribute('data-tblcap') || ''));
    }
    return out;
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

  /** One mousedown entry point: reference chips, then cross-refs, then placeholders. */
  const onEditorMouseDown = (e) => {
    // 117.md §38 — a click on a citation opens its action menu without moving the
    // caret (same preventDefault rule as §10).
    const cite = onCiteChipMenuRef.current ? citeChipFrom(e.target) : null;
    if (cite) { e.preventDefault(); openCiteMenu(cite); return; }
    const chip = assetChipFrom(e.target);
    if (chip) {
      e.preventDefault();  // §10 — "never disturb the caret"
      openChipMenu(chip);
      return;
    }
    if (!readOnly) onPlaceholderMouseDown(e);
  };

  const readOnlyRef = useRef(readOnly);
  useEffect(() => { readOnlyRef.current = readOnly; });
  const onPlaceholderFocusRef = useRef(onPlaceholderFocus);
  useEffect(() => { onPlaceholderFocusRef.current = onPlaceholderFocus; });
  const onTableFocusRef = useRef(onTableFocus);
  useEffect(() => { onTableFocusRef.current = onTableFocus; });

  /* ══════════ 116.md §59-§66 — native table support ══════════
   *
   * Structural ops NEVER mutate the table DOM directly: a raw insertRow/
   * removeChild would be invisible to the browser's native undo stack AND would
   * not fire an input event, so autosave would miss it until the next keystroke
   * (the two-sided trap of §63/§64). Instead every op is a WHOLE-TABLE
   * replacement routed through the same insertHtml/execCommand path the toolbar
   * uses: serialize the table (htmlToMd), transform it with the pure tableOps
   * module, re-render (mdToHtml) and insertHTML over the selected table node.
   * Native undo records it, emit() autosaves it, and the markdown stays inside
   * the pipe grammar, so nothing here can become a DOM-only table.
   */

  /** The enclosing td/th of a DOM node, or null when outside root/table. */
  const cellFromNode = (node) => {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    while (el && el !== rootRef.current) {
      const tag = el.tagName;
      if (tag === 'TD' || tag === 'TH') return el;
      el = el.parentElement;
    }
    return null;
  };

  /** Caret's table context: { table, cell, gridRow, col, rows, cols } | null. */
  const tableDomContext = () => {
    const sel = typeof window !== 'undefined' && window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || !rootRef.current) return null;
    const cell = cellFromNode(sel.getRangeAt(0).startContainer);
    if (!cell || typeof cell.closest !== 'function') return null;
    const table = cell.closest('table');
    if (!table || !rootRef.current.contains(table)) return null;
    const trs = Array.from(table.querySelectorAll('tr'));
    const tr = cell.closest('tr');
    const gridRow = trs.indexOf(tr);
    const rowCells = tr ? Array.from(tr.querySelectorAll('th,td')) : [];
    const col = rowCells.indexOf(cell);
    if (gridRow < 0 || col < 0) return null;
    return { table, cell, gridRow, col, rows: trs.length, cols: rowCells.length };
  };

  /** Word-style cell entry: select the cell's contents so typing replaces them. */
  const selectCellContents = (cell) => {
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    r.selectNodeContents(cell);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange.current = r.cloneRange();
  };

  const focusCellAt = (table, gridRow, col) => {
    const trs = table.querySelectorAll('tr');
    const tr = trs[Math.max(0, Math.min(gridRow, trs.length - 1))];
    if (!tr) return;
    const cells = tr.querySelectorAll('th,td');
    const cell = cells[Math.max(0, Math.min(col, cells.length - 1))];
    if (!cell) return;
    rootRef.current && rootRef.current.focus();
    selectCellContents(cell);
  };

  /** 117.md §4 — the caption element bound to a table (its previous sibling). */
  const captionForTable = (table) => {
    const prev = table && table.previousElementSibling;
    return (prev && prev.classList && prev.classList.contains(TABLE_CAPTION_CLASS)) ? prev : null;
  };

  // Notify the parent when the caret enters/moves within/leaves a table. Only
  // the leave transition sends null (once), so a caret outside any table costs
  // nothing per keystroke.
  const wasInTable = useRef(false);
  const notifyTableFocus = () => {
    const cb = onTableFocusRef.current;
    if (!cb) return;
    const ctx = tableDomContext();
    if (!ctx) {
      if (wasInTable.current) { wasInTable.current = false; cb(null); }
      return;
    }
    wasInTable.current = true;
    const cap = captionForTable(ctx.table);
    cb({
      gridRow: ctx.gridRow,
      col: ctx.col,
      rows: ctx.rows,
      cols: ctx.cols,
      // 117.md §11 — the table's stable id, so the parent can count the
      // cross-references that would break BEFORE it is deleted.
      tableId: cap ? (cap.getAttribute('data-tblcap') || null) : null,
      rect: typeof ctx.table.getBoundingClientRect === 'function' ? ctx.table.getBoundingClientRect() : null,
    });
  };

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
      // 116.md §61 — keep the parent's floating table controls in step with the
      // caret (runs on keyup/mouseup/focus/input, so the anchor rect stays fresh
      // while the table grows).
      notifyTableFocus();
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

  /** 116.md §61 — apply a pure table op by whole-table replacement (see the
      table header comment above). Returns true when a table op was applied. */
  const runTableOp = (opId, ctxOverride) => {
    if (readOnlyRef.current) return false;
    const ctx = tableDomContext();
    if (!ctx) return false;
    const res = applyTableOp(opId, htmlToMd(ctx.table.outerHTML), {
      gridRow: ctx.gridRow, col: ctx.col, ...(ctxOverride || {}),
    });
    if (!res) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    const cap = captionForTable(ctx.table);
    const tableId = cap ? (cap.getAttribute('data-tblcap') || '') : '';
    const r = document.createRange();
    // 117.md §4 — a table and its caption are ONE object. Deleting the table
    // selects the caption too, so the id disappears with the data instead of
    // leaving an orphan caption that would keep numbering an empty slot. One
    // native undo restores both, which is exactly why identity lives in the prose.
    if (res.md == null && cap) r.setStartBefore(cap); else r.setStartBefore(ctx.table);
    r.setEndAfter(ctx.table);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange.current = r.cloneRange();
    if (res.md == null) {
      // delete-table → an empty paragraph keeps a caret target; htmlToMd drops
      // it again, so the persisted markdown stays clean
      insertHtml('<p><br></p>');
      notifyTableFocus();
      return true;
    }
    const html = mdToHtml(res.md, {
      orderMap: orderMapRef.current, assetNumbers: assetNumbersRef.current,
      ...factOptsRef.current, ...refOptsRef.current,
    }).replace('<table>', '<table data-ms-new="1">');
    insertHtml(html);
    const nt = rootRef.current && rootRef.current.querySelector('table[data-ms-new="1"]');
    if (nt) {
      // the marker only exists to find the replacement table again; it is removed
      // immediately and htmlToMd ignores unknown attributes, so it never persists
      nt.removeAttribute('data-ms-new');
      if (res.caret) focusCellAt(nt, res.caret.gridRow, res.caret.col);
    }
    // 117.md §4 — a STRUCTURAL change stamps the table's last-modified time (prose
    // typing does not: the draft's own updatedAt already covers that, and stamping
    // per keystroke would be write amplification for a hover tooltip).
    if (tableId && onTableMetaRef.current) onTableMetaRef.current(tableId, { updatedAt: new Date().toISOString() });
    notifyTableFocus();
    return true;
  };

  /**
   * 117.md §10 — replace or delete ONE node through the editor's normal mutation
   * path (selection → execCommand), so native undo records it and the resulting
   * input event autosaves it. Returns false when the node is no longer ours.
   */
  const replaceNode = (node, html) => {
    const el = rootRef.current;
    if (readOnlyRef.current || !el || !node || !el.contains(node)) return false;
    if (typeof window === 'undefined' || !window.getSelection) return false;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return false;
    const r = document.createRange();
    r.selectNode(node);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange.current = r.cloneRange();
    if (html) { insertHtml(html); return true; }
    let ok = false;
    try { ok = document.execCommand('delete'); } catch { ok = false; }
    if (!ok) r.deleteContents();
    rememberSelection();
    emit();
    return true;
  };

  const api = useMemo(() => ({
    exec,
    focus: () => rootRef.current && rootRef.current.focus(),
    /** Insert subset markdown at the caret as normal editable content (MS-8). */
    insertMarkdown: (md) => insertHtml(mdToHtml(md, {
      orderMap: orderMapRef.current, assetNumbers: assetNumbersRef.current,
      ...factOptsRef.current, ...refOptsRef.current,
    })),
    /**
     * 116.md §60 + 117.md §4 — insert a fresh rows × cols table at the caret,
     * WITH its caption marker so it is a first-class manuscript object from the
     * first keystroke (numbered, referenceable, exportable). Goes through
     * insertHtml → native undo + autosave emit; returns the new table's id.
     *
     * The caret lands in the TITLE region rather than the first cell: §4 is
     * "automatic numbering AND naming", the number is already filled in, and the
     * one thing only the researcher can supply is what the table is called.
     */
    insertTable: (rows, cols, tblOpts = {}) => {
      if (readOnlyRef.current) return null;
      const id = mintManualTableId(usedTableIds());
      const md = makeCaptionedTableMd(id, tblOpts.title || '', rows, cols);
      const html = mdToHtml(md, {
        orderMap: orderMapRef.current, assetNumbers: assetNumbersRef.current,
        ...factOptsRef.current, ...refOptsRef.current,
      }).replace('<table>', '<table data-ms-new="1">');
      // the trailing empty paragraph gives a caret target below a table inserted
      // at the section end; htmlToMd drops it, so the markdown stays clean
      insertHtml(`${html}<p><br></p>`);
      const root = rootRef.current;
      const nt = root && root.querySelector('table[data-ms-new="1"]');
      if (nt) nt.removeAttribute('data-ms-new');
      const cap = root && root.querySelector(`div.${TABLE_CAPTION_CLASS}[data-tblcap="${id}"]`);
      const titleEl = cap && cap.querySelector(`span.${TABLE_CAPTION_TITLE_CLASS}`);
      if (titleEl) {
        titleEl.focus();
        selectCellContents(titleEl);
      } else if (nt) focusCellAt(nt, 0, 0);
      if (onTableMetaRef.current) {
        onTableMetaRef.current(id, { origin: 'manual', createdAt: new Date().toISOString() });
      }
      notifyTableFocus();
      return id;
    },
    /** 116.md §61 — structural op ('rowAbove'|'rowBelow'|'colLeft'|'colRight'|
        'deleteRow'|'deleteCol'|'deleteTable') on the table holding the caret. */
    tableOp: (opId, ctxOverride) => runTableOp(opId, ctxOverride),
    /**
     * 117.md §4 — promote the ANONYMOUS pipe table under the caret to a numbered
     * manuscript object by giving it a caption marker. This is what makes the
     * export notice ("add a caption to number it") an action rather than advice,
     * and it is how every table typed before this feature existed joins the
     * numbering sequence. Returns the new id, or null when there is nothing to do.
     */
    addTableCaption: (title = '') => {
      if (readOnlyRef.current) return null;
      const ctx = tableDomContext();
      if (!ctx || captionForTable(ctx.table)) return null;
      const id = mintManualTableId(usedTableIds());
      const md = `${tableCaptionLine(id, title)}\n\n${htmlToMd(ctx.table.outerHTML)}`;
      const html = mdToHtml(md, {
        orderMap: orderMapRef.current, assetNumbers: assetNumbersRef.current,
        ...factOptsRef.current, ...refOptsRef.current,
      });
      if (!replaceNode(ctx.table, html)) return null;
      const root = rootRef.current;
      const cap = root && root.querySelector(`div.${TABLE_CAPTION_CLASS}[data-tblcap="${id}"]`);
      const titleEl = cap && cap.querySelector(`span.${TABLE_CAPTION_TITLE_CLASS}`);
      if (titleEl) { titleEl.focus(); selectCellContents(titleEl); }
      if (onTableMetaRef.current) {
        onTableMetaRef.current(id, { origin: 'manual', createdAt: new Date().toISOString() });
      }
      notifyTableFocus();
      return id;
    },
    /**
     * Insert an atomic citation chip at the caret.
     *
     * 117.md §34/§35 — accepts ONE id or a LIST. A multi-select insertion becomes a
     * SINGLE chip carrying every id (`[[cite:a,b,c]]` → "[1,2,5]"), not three
     * adjacent chips: the researcher selected one citation, and "Remove citation"
     * plus the range collapse both need one object to act on.
     */
    insertCitation: (refId) => {
      const ids = (Array.isArray(refId) ? refId : parseCiteIds(refId)).filter(Boolean);
      if (!ids.length || readOnlyRef.current) return;
      const ro = refOptsRef.current || {};
      const { label, broken } = citeChipLabel(ids, orderMapRef.current, ro.citationStyle, ro.refsById);
      insertHtml(`${citeChipHtml(ids, label, { broken })}&nbsp;`);
    },
    /**
     * 117.md §38 — "Remove citation". Removing ONE id from a multi-cite chip leaves
     * the others in place (the sentence keeps the citations it still means);
     * removing the last id removes the chip itself. `null` removes the whole chip.
     */
    removeCitation: (refId) => {
      const chip = activeCiteRef.current;
      activeCiteRef.current = null;
      if (!chip) return false;
      const ids = parseCiteIds(chip.getAttribute('data-cite') || '');
      const next = refId ? ids.filter((x) => x !== String(refId)) : [];
      if (!next.length) return replaceNode(chip, null);
      const ro = refOptsRef.current || {};
      const { label, broken } = citeChipLabel(next, orderMapRef.current, ro.citationStyle, ro.refsById);
      return replaceNode(chip, citeChipHtml(next, label, { broken }));
    },
    /** Forget the citation chip the menu was bound to (dismissed without acting). */
    clearActiveCitation: () => { activeCiteRef.current = null; },
    /**
     * 117.md §9 — insert a cross-reference chip AT THE CARET.
     *
     * Deliberately not `insertMarkdown(assetToken(id))`: mdToHtml wraps a bare
     * token in a <p>, and inserting a block mid-sentence splits the paragraph the
     * researcher is writing. The chip is inline, so it lands inside the sentence,
     * which is the only place a cross-reference belongs.
     */
    insertAssetRef: (assetId) => {
      if (!assetId || readOnlyRef.current) return;
      const ro = refOptsRef.current || {};
      const { label, broken } = assetChipLabel(assetId, assetNumbersRef.current, ro.knownAssetIds, ro.templateId);
      insertHtml(`${assetChipHtml(assetId, label, { broken })}&nbsp;`);
    },
    /** 117.md §10 — "Remove cross-reference": the CHIP goes, the table stays. */
    removeCrossRef: () => {
      const chip = activeChipRef.current;
      activeChipRef.current = null;
      return replaceNode(chip, null);
    },
    /** 117.md §11 — "Relink": rebind the chip in place to another object. */
    relinkCrossRef: (assetId) => {
      const chip = activeChipRef.current;
      activeChipRef.current = null;
      if (!chip || !assetId) return false;
      const ro = refOptsRef.current || {};
      const { label, broken } = assetChipLabel(assetId, assetNumbersRef.current, ro.knownAssetIds, ro.templateId);
      return replaceNode(chip, assetChipHtml(assetId, label, { broken }));
    },
    /** Forget the chip the menu was bound to (menu dismissed without an action). */
    clearActiveCrossRef: () => { activeChipRef.current = null; },
    /**
     * 117.md §10 — "Go to table": scroll a manual table's caption into view and
     * mark it, so the jump is visible rather than a silent scroll. Returns false
     * when this section does not hold that table (the parent then switches
     * section and retries — same pattern as placeholder navigation).
     */
    focusManualTable: (tableId) => {
      const el = rootRef.current;
      if (!el || !tableId || typeof el.querySelector !== 'function') return false;
      const cap = el.querySelector(`div.${TABLE_CAPTION_CLASS}[data-tblcap="${String(tableId).replace(/"/g, '')}"]`);
      if (!cap) return false;
      if (typeof cap.scrollIntoView === 'function') cap.scrollIntoView({ block: 'center', inline: 'nearest' });
      el.querySelectorAll(`div.${TABLE_CAPTION_CLASS}[data-tblcap-current="true"]`)
        .forEach((n) => n.removeAttribute('data-tblcap-current'));
      cap.setAttribute('data-tblcap-current', 'true');
      return true;
    },
    /** Focus a manual table's TITLE region ("Edit table" on a manual object). */
    editManualTable: (tableId) => {
      const el = rootRef.current;
      if (!el || !tableId || typeof el.querySelector !== 'function') return false;
      const cap = el.querySelector(`div.${TABLE_CAPTION_CLASS}[data-tblcap="${String(tableId).replace(/"/g, '')}"]`);
      const titleEl = cap && cap.querySelector(`span.${TABLE_CAPTION_TITLE_CLASS}`);
      if (!titleEl) return false;
      if (typeof cap.scrollIntoView === 'function') cap.scrollIntoView({ block: 'center', inline: 'nearest' });
      titleEl.focus();
      selectCellContents(titleEl);
      return true;
    },
    /** Every manual-table id this section currently renders (document order). */
    manualTableIds: () => {
      const el = rootRef.current;
      if (!el || typeof el.querySelectorAll !== 'function') return [];
      return Array.from(el.querySelectorAll('[data-tblcap]')).map((n) => n.getAttribute('data-tblcap') || '');
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
    // runTableOp/focusCellAt/notifyTableFocus close over refs only, so the
    // memoized closures can never go stale (same pattern as factOptsRef).
  }), [exec, insertHtml, selectPlaceholderNode]); // eslint-disable-line react-hooks/exhaustive-deps
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
  /**
   * 116.md §61 — Word-style Tab/Shift+Tab cell navigation. ONLY the unmodified
   * Tab (Shift for direction) is claimed, and only while the caret sits inside a
   * table cell: preventDefault on a MODIFIED chord would mark it claimed for the
   * 108.md §23 shortcut router (exactly the regression the placeholder handler
   * above documents), and outside tables the browser's focus-move behaviour must
   * stay untouched. Runs on React's root bubble, so the claim is visible to the
   * window-bubble router via defaultPrevented. Tab in the LAST cell appends a
   * row (Word behaviour) through the same replace-table op as the menus.
   */
  const onTableTab = (e) => {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return false;
    const ctx = tableDomContext();
    if (!ctx) return false;
    e.preventDefault();
    const cellsAll = Array.from(ctx.table.querySelectorAll('th,td'));
    const idx = cellsAll.indexOf(ctx.cell);
    if (e.shiftKey) {
      if (idx > 0) selectCellContents(cellsAll[idx - 1]); // first cell → stay put (Word)
    } else if (idx + 1 < cellsAll.length) {
      selectCellContents(cellsAll[idx + 1]);
    } else {
      runTableOp('rowBelow', { col: 0 }); // caret lands in the new row's first cell
    }
    rememberSelection();
    return true;
  };

  /**
   * 117.md §10/§71 — keyboard parity for the chip menu. The chip carries
   * role="button" + tabindex=0, so Tab reaches it; Enter/Space opens the same
   * action menu a click opens. Modified chords fall through untouched, for exactly
   * the reason the placeholder handler documents (a preventDefault on a modified
   * key would steal it from the 108.md §23 shortcut router).
   */
  const onChipKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const chip = assetChipFrom(e.target);
    if (!chip) return false;
    e.preventDefault();
    openChipMenu(chip);
    return true;
  };

  /** 117.md §38 — Enter/Space on a focused citation chip opens its action menu. */
  const onCiteKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (!onCiteChipMenuRef.current) return false;
    const chip = citeChipFrom(e.target);
    if (!chip) return false;
    e.preventDefault();
    openCiteMenu(chip);
    return true;
  };

  const onKeyDown = (e) => {
    // 117.md §38 — the citation chip first (it is the innermost target).
    if (onCiteKeyDown(e)) return;
    // 117.md §10 — Enter/Space on a focused cross-reference opens its menu. This
    // runs even in a LOCKED section: "Go to table" is a read-only action, and the
    // mutating ones re-check readOnly before touching the document.
    if (onChipKeyDown(e)) return;
    if (readOnlyRef.current) return;
    // 102.md §3 — Enter/Space on a focused placeholder selects the whole field.
    if (onPlaceholderKeyDown(e)) return;
    // 116.md §61 — Tab moves between table cells (and never leaves the editor
    // while inside a table).
    if (onTableTab(e)) return;
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
    // 117.md §4(c)/(d) — the caption marker survives sanitization (htmlToMd knows
    // data-tblcap), and a DUPLICATE id is re-minted: copying a table produces a new
    // table, never a second claimant to the original's identity. Moving a table
    // (cut → paste) keeps its id, so its cross-references survive the move.
    const { md } = remintDuplicateCaptions(htmlToMd(html), usedTableIds());
    insertHtml(mdToHtml(md, {
      orderMap: orderMapRef.current, assetNumbers: assetNumbersRef.current,
      ...factOptsRef.current, ...refOptsRef.current,
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
      onKeyDown={onKeyDown}
      onKeyUp={rememberSelection}
      onMouseUp={rememberSelection}
      /* 102.md §3 — click anywhere in a placeholder and the WHOLE field (both
         brackets included) is selected, ready to be typed over.
         117.md §10 — a click on a cross-reference opens its action menu instead,
         WITHOUT moving the caret. */
      onMouseDown={onEditorMouseDown}
      /* 117.md §10/§38 — ONE delegated hover entry point for both chip kinds. */
      onMouseOver={(onAssetChipHover || onCiteChipHover) ? ((e) => { onChipMouseOver(e); onCiteMouseOver(e); }) : undefined}
      onMouseLeave={(onAssetChipHover || onCiteChipHover) ? onChipMouseLeave : undefined}
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
 * 116.md §60 — Insert → Table: a compact grid selector (Word-style rows × cols
 * picker) behind one toolbar button. Same selection-preserving onMouseDown
 * preventDefault pattern as every other toolbar control, so the editor caret
 * survives the whole interaction; insertion goes through api.insertTable →
 * insertHtml (native undo + autosave emit).
 */
const TABLE_GRID_MAX = 6;
export function TableGridPicker({ getApi, disabled, onInserted }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState({ r: 0, c: 0 });
  const insert = (r, c) => {
    setOpen(false);
    setHover({ r: 0, c: 0 });
    const api = getApi && getApi();
    if (!(api && api.insertTable)) return;
    // 117.md §4 — insertTable returns the new object's stable id so the parent can
    // record its creation stamp / focus it.
    const id = api.insertTable(r, c);
    if (onInserted) onInserted(id);
  };
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" aria-label="Insert table" title="Insert a table"
        disabled={disabled} aria-haspopup="true" aria-expanded={open}
        data-testid="stitch-manuscript-tb-table"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...btnS('ghost'), padding: '5px 9px', fontSize: 11.5, border: '1px solid transparent',
          background: 'transparent', color: C.txt2, opacity: disabled ? 0.5 : 1,
        }}>
        ⊞ Table
      </button>
      {open && !disabled && (
        <>
          {/* click-away backdrop; preventDefault keeps the editor selection */}
          <div onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}
            style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' }} />
          <div role="dialog" aria-label="Table size"
            data-testid="stitch-manuscript-table-grid"
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 41,
              background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10,
              padding: 10, boxShadow: '0 10px 26px rgba(15,23,42,0.18)',
            }}>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${TABLE_GRID_MAX}, 16px)`, gap: 3 }}>
              {Array.from({ length: TABLE_GRID_MAX * TABLE_GRID_MAX }, (_, i) => {
                const r = Math.floor(i / TABLE_GRID_MAX) + 1;
                const c = (i % TABLE_GRID_MAX) + 1;
                const on = r <= hover.r && c <= hover.c;
                return (
                  <button key={i} type="button" tabIndex={-1}
                    aria-label={`Insert ${r} by ${c} table`}
                    data-testid={`stitch-manuscript-table-grid-${r}-${c}`}
                    onMouseEnter={() => setHover({ r, c })}
                    onFocus={() => setHover({ r, c })}
                    onClick={() => insert(r, c)}
                    style={{
                      width: 16, height: 16, padding: 0, cursor: 'pointer', borderRadius: 3,
                      border: `1px solid ${on ? C.acc : C.brd2}`,
                      background: on ? alpha(C.acc, '22') : 'transparent',
                    }} />
                );
              })}
            </div>
            <div aria-live="polite" style={{ marginTop: 6, fontSize: 10.5, color: C.txt2, textAlign: 'center' }}>
              {hover.r > 0 ? `${hover.r} × ${hover.c} (first row is the header)` : 'Pick rows × columns'}
            </div>
          </div>
        </>
      )}
    </span>
  );
}

/* ══════════ 117.md §9 — Insert → Cross-reference ══════════
 *
 * The old control was a bare <select> of asset titles. That is wrong for three
 * reasons: a native select has no search (§9 explicitly asks for it when there are
 * many tables), it cannot show a number and an origin next to a title, and it
 * inserted a BLOCK at the caret. This is a real picker: type-to-filter over every
 * table AND figure, each row showing what the researcher actually recognises — the
 * live number, the title and where the object came from — and picking one inserts
 * an inline chip exactly where the caret is.
 *
 * `items` are precomputed by the caller: { id, kind, label, title, origin }.
 */
export const CROSSREF_EMPTY_TEXT = 'No tables or figures to reference yet.';
export const CROSSREF_NO_MATCH_TEXT = 'Nothing matches that search.';

const originBadge = (origin) => (origin === 'manual' ? 'Manual' : 'Auto');

export function CrossRefList({ items, onPick, testIdPrefix, autoFocus = false, emptyText }) {
  const [q, setQ] = useState('');
  const list = Array.isArray(items) ? items : [];
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? list.filter((it) => `${it.label} ${it.title} ${originBadge(it.origin)} ${it.id}`.toLowerCase().includes(needle))
    : list;
  return (
    <div>
      <input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search tables and figures…"
        aria-label="Search tables and figures"
        data-testid={`${testIdPrefix}-search`}
        style={{ ...inp, fontSize: 11.5, marginBottom: 6 }} />
      <div role="listbox" aria-label="Tables and figures"
        style={{ maxHeight: 236, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {shown.map((it) => (
          <button key={it.id} type="button" role="option" aria-selected="false"
            data-testid={`${testIdPrefix}-item-${String(it.id).replace(/:/g, '-')}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick && onPick(it.id)}
            title={`${it.label} — ${it.title || it.id}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left', width: '100%',
              padding: '5px 7px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
              border: '1px solid transparent', background: 'transparent', color: C.txt2, fontSize: 11.5,
            }}>
            <span style={{
              flexShrink: 0, fontWeight: 700, fontSize: 10, color: C.acc,
              background: alpha(C.acc, '14'), borderRadius: 99, padding: '1px 7px', whiteSpace: 'nowrap',
            }}>{it.label}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.title || it.id}
            </span>
            <span style={{
              flexShrink: 0, fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase',
              color: C.muted, border: `1px solid ${C.brd2}`, borderRadius: 99, padding: '0 6px',
            }}>{originBadge(it.origin)}</span>
          </button>
        ))}
        {!shown.length && (
          <div data-testid={`${testIdPrefix}-empty`} style={{ fontSize: 11, color: C.muted, padding: '6px 4px' }}>
            {list.length ? CROSSREF_NO_MATCH_TEXT : (emptyText || CROSSREF_EMPTY_TEXT)}
          </div>
        )}
      </div>
    </div>
  );
}

/** The popover form of the picker: one button that opens CrossRefList. */
export function CrossRefPicker({
  items, onPick, disabled, testIdPrefix = 'stitch-manuscript-crossref',
  label = '⧉ Cross-reference', title = 'Insert a reference to a table or figure at the cursor',
  block = false,
}) {
  const [open, setOpen] = useState(false);
  const pick = (id) => { setOpen(false); if (onPick) onPick(id); };
  return (
    <span style={{ position: 'relative', display: block ? 'block' : 'inline-flex' }}>
      <button type="button" aria-label="Insert cross-reference" title={title}
        disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
        data-testid={`${testIdPrefix}-open`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...btnS('ghost'), padding: '5px 9px', fontSize: 11.5, border: '1px solid transparent',
          background: 'transparent', color: C.txt2, opacity: disabled ? 0.5 : 1,
          ...(block ? { width: '100%', justifyContent: 'center' } : {}),
        }}>
        {label}
      </button>
      {open && !disabled && (
        <>
          <div onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}
            style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' }} />
          <div role="dialog" aria-label="Insert cross-reference"
            data-testid={`${testIdPrefix}-popover`}
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 41, width: 288,
              background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10,
              padding: 10, boxShadow: '0 10px 26px rgba(15,23,42,0.18)',
            }}>
            <CrossRefList items={items} onPick={pick} testIdPrefix={testIdPrefix} autoFocus />
          </div>
        </>
      )}
    </span>
  );
}

/* ══════════ 117.md §34/§35 — Insert → Citation ══════════
 *
 * The old control was a bare <select> of "Family Year" strings. §34 asks for search
 * across author, title, DOI, PMID, journal, year and keyword, and §35 asks for a
 * MULTI-reference citation — neither is expressible in a native select. This is the
 * same picker idiom as the cross-reference control above (type-to-filter list in a
 * popover, selection-preserving onMouseDown), with one addition: rows are
 * CHECKABLE, and "Insert" emits every checked id as ONE chip.
 *
 * `items` are precomputed by the caller: { id, label, title, meta, search, cited }.
 */
export const CITE_EMPTY_TEXT = 'No references yet — add included studies, or add a reference in the References tab.';
export const CITE_NO_MATCH_TEXT = 'No reference matches that search.';

/**
 * Turn a reference row ({ id, ref, index }) into a picker item. §34's six
 * searchable fields all land in `search`, so the filter needs no field knowledge.
 */
export function citeItemOf(row, refLabel) {
  const r = (row && row.ref) || row || {};
  const a = (r.authorsList && r.authorsList[0]) || null;
  const fam = (a && (a.family || a.raw)) || r.title || row.id;
  const label = refLabel ? refLabel(row) : `${fam}${r.year ? ` ${r.year}` : ''}`;
  const kw = [
    ...(Array.isArray(r.keywords) ? r.keywords : []),
    ...(Array.isArray(r.tags) ? r.tags : []),
  ].join(' ');
  return {
    id: row.id || r.id,
    label,
    title: r.title || '',
    meta: r.year || '',
    cited: !!row.cited,
    search: [label, r.title, r.authorsRaw, r.journal, r.year, r.doi, r.pmid, kw]
      .filter(Boolean).join(' '),
  };
}

export function CiteRefList({
  items, onInsert, testIdPrefix = 'stitch-manuscript-cite', autoFocus = false, emptyText,
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const list = Array.isArray(items) ? items : [];
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? list.filter((it) => String(it.search || `${it.label} ${it.title}`).toLowerCase().includes(needle))
    : list;
  const toggle = (id) => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const commit = (ids) => {
    if (!ids.length) return;
    setPicked([]);
    setQ('');
    if (onInsert) onInsert(ids);
  };
  return (
    <div>
      <input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search author, title, DOI, PMID, journal, year…"
        aria-label="Search references"
        data-testid={`${testIdPrefix}-search`}
        style={{ ...inp, fontSize: 11.5, marginBottom: 6 }} />
      <div role="listbox" aria-label="References" aria-multiselectable="true"
        style={{ maxHeight: 236, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {shown.map((it) => {
          const on = picked.includes(it.id);
          return (
            <button key={it.id} type="button" role="option" aria-selected={on ? 'true' : 'false'}
              data-testid={`${testIdPrefix}-item-${String(it.id).replace(/[^A-Za-z0-9_-]/g, '-')}`}
              onMouseDown={(e) => e.preventDefault()}
              /* A plain click inserts THIS reference immediately (the overwhelmingly
                 common case is one citation); the checkbox builds a multi-cite. */
              onClick={() => commit([it.id])}
              title={it.title || it.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left', width: '100%',
                padding: '5px 7px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${on ? alpha(C.acc, '55') : 'transparent'}`,
                background: on ? alpha(C.acc, '10') : 'transparent', color: C.txt2, fontSize: 11.5,
              }}>
              <span role="checkbox" aria-checked={on ? 'true' : 'false'}
                aria-label={`Add ${it.label} to a multiple citation`}
                data-testid={`${testIdPrefix}-check-${String(it.id).replace(/[^A-Za-z0-9_-]/g, '-')}`}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(it.id); }}
                style={{
                  flexShrink: 0, width: 13, height: 13, borderRadius: 3, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 9, lineHeight: 1,
                  border: `1px solid ${on ? C.acc : C.brd2}`, color: '#fff',
                  background: on ? C.acc : 'transparent',
                }}>{on ? '✓' : ''}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong style={{ color: C.txt, fontWeight: 700 }}>{it.label}</strong>
                {it.title ? ` — ${it.title}` : ''}
              </span>
              {it.meta && (
                <span style={{
                  flexShrink: 0, fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase',
                  color: C.muted, border: `1px solid ${C.brd2}`, borderRadius: 99, padding: '0 6px',
                }}>{it.meta}</span>
              )}
            </button>
          );
        })}
        {!shown.length && (
          <div data-testid={`${testIdPrefix}-empty`} style={{ fontSize: 11, color: C.muted, padding: '6px 4px' }}>
            {list.length ? CITE_NO_MATCH_TEXT : (emptyText || CITE_EMPTY_TEXT)}
          </div>
        )}
      </div>
      {picked.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, paddingTop: 7, borderTop: `1px solid ${C.brd}` }}>
          <span style={{ fontSize: 10.5, color: C.muted, flex: 1 }} data-testid={`${testIdPrefix}-picked`}>
            {picked.length} selected
          </span>
          <button type="button" data-testid={`${testIdPrefix}-insert`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commit(picked)}
            style={{ ...btnS('primary'), fontSize: 11 }}>
            Insert {picked.length} citations
          </button>
        </div>
      )}
    </div>
  );
}

/** The popover form of the citation picker: one button that opens CiteRefList. */
export function CiteRefPicker({
  items, onInsert, disabled, testIdPrefix = 'stitch-manuscript-insert-citation',
  label = '+ Cite…', title = 'Insert a citation at the cursor', block = false,
}) {
  const [open, setOpen] = useState(false);
  const insert = (ids) => { setOpen(false); if (onInsert) onInsert(ids); };
  return (
    <span style={{ position: 'relative', display: block ? 'block' : 'inline-flex' }}>
      <button type="button" aria-label="Insert citation" title={title}
        disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
        data-testid={testIdPrefix}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...btnS('ghost'), padding: '5px 9px', fontSize: 11.5, border: '1px solid transparent',
          background: 'transparent', color: C.txt2, opacity: disabled ? 0.5 : 1,
          ...(block ? { width: '100%', justifyContent: 'center' } : {}),
        }}>
        {label}
      </button>
      {open && !disabled && (
        <>
          <div onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}
            style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' }} />
          <div role="dialog" aria-label="Insert citation"
            data-testid={`${testIdPrefix}-popover`}
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 41, width: 320,
              background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10,
              padding: 10, boxShadow: '0 10px 26px rgba(15,23,42,0.18)',
            }}>
            <CiteRefList items={items} onInsert={insert} testIdPrefix={testIdPrefix} autoFocus />
          </div>
        </>
      )}
    </span>
  );
}

/**
 * Formatting toolbar. `getApi()` returns the imperative handle of the editor that
 * last had the caret (one toolbar serves the abstract's multiple fields too).
 * onMouseDown preventDefault keeps the editor selection alive through the click.
 */
export function RichToolbar({ getApi, citeRefs, refLabel, disabled, crossRefs, onInsertCrossRef, onInsertCitation }) {
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
      {/* 116.md §60 — Insert → Table grid selector */}
      <TableGridPicker getApi={getApi} disabled={disabled} />
      {/* 117.md §9 — Insert → Cross-reference, at the caret */}
      <CrossRefPicker items={crossRefs || []} disabled={disabled}
        onPick={(id) => {
          if (onInsertCrossRef) { onInsertCrossRef(id); return; }
          const api = getApi && getApi();
          if (api && api.insertAssetRef) api.insertAssetRef(id);
        }} />
      {/* 117.md §34/§35 — Insert → Citation. It replaces the bare <select>, which
          had no search (§34 asks for six searchable fields) and could not express a
          multi-reference citation at all (§35). Rendered even when the library is
          empty so the control has a stable place in the toolbar and can say WHY it
          is empty; the old select silently vanished. */}
      {!disabled && (
        <>
          <span style={{ width: 1, alignSelf: 'stretch', background: C.brd, margin: '0 4px' }} />
          <CiteRefPicker
            items={(citeRefs || []).map((r) => citeItemOf(r, refLabel))}
            onInsert={(ids) => {
              if (onInsertCitation) { onInsertCitation(ids); return; }
              const api = getApi && getApi();
              if (api && api.insertCitation) api.insertCitation(ids);
            }} />
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
