/**
 * PdfAnnotationLayer.jsx — 116.md §75-§100. The rendering half of the collaborative
 * annotation subsystem: per-page highlight overlays, the drag-select control, the
 * compact annotation popover and the optional document-order list.
 *
 * ── WHY IT IS A SEPARATE FILE ────────────────────────────────────────────────
 * AppPdfViewer stays a viewer. It grows ONE new optional prop cluster (`annotation`)
 * following the exact inert-by-default pattern of `interaction` / `pageOverlay` /
 * `reveal`, and delegates every annotation pixel here. Existing callers that pass
 * nothing are byte-for-byte unchanged.
 *
 * ── PERFORMANCE (§92-§94) ────────────────────────────────────────────────────
 *  - the page layer is React.memo'd on its OWN slice of the page index, and the
 *    hook preserves slice identity for untouched pages, so one new highlight on
 *    page 25 re-renders exactly one overlay;
 *  - overlays exist only for pages the viewer has actually mounted (its ±900 px
 *    virtualization window), so a 300-page PDF renders a handful of overlays, not
 *    thousands (§93);
 *  - the popover is mounted only for the SELECTED annotation;
 *  - nothing here subscribes to a global store, adds a scroll handler, or reads
 *    layout during render.
 *
 * ── NOT INTERFERING (§75) ────────────────────────────────────────────────────
 * Selection capture listens for `mouseup` (the end of the §75 drag) and, when no
 * drag is in progress, for a debounced `selectionchange`. It never calls
 * preventDefault, never blocks copy, never touches scroll or zoom, and a click that
 * produced no selection just dismisses the control. Every capture re-validates that
 * the selection is inside THIS page's text layer, so a listener at document level
 * cannot steal another page's selection. On a scanned PDF with no text layer there
 * is nothing to select, so the control simply never appears (§96) — the viewer does
 * not pretend text exists.
 *
 * ── KEYBOARD (§100) ──────────────────────────────────────────────────────────
 * The `selectionchange` half is not a nicety: selecting with Shift+Arrow fires no
 * mouse event at all, so a `mouseup`-only capture path is unreachable without a
 * mouse. The timing rule (which event captures, and after how long) is pure and
 * lives in `selectionCaptureDelay`.
 *
 * ── SAFARI/WEBKIT (117.md §46-§48) ───────────────────────────────────────────
 * Two WebKit-specific defects are fixed HERE, at capture time — the stored anchor
 * contract (§76: PDF user space at scale 1, y-up, unrotated) is untouched, because a
 * highlight already on the server is not wrong, it was only ever captured wrong:
 *   1. `Range.getClientRects()` on the `scaleX`-transformed spans of a pdf.js text
 *      layer can come back mis-mapped. Every list is now audited against the layer box
 *      and rebuilt from per-word Range geometry when it fails — `captureSelectionRects`.
 *   2. WebKit collapses the selection on `mousedown` of the pending control, which used
 *      to unmount the control before its own `click` could fire. The payload is latched
 *      at pointerdown and selection-driven teardown stands down for the gesture.
 * The third half of the parity work — the pdf.js `endOfContent` selection sink that
 * makes the DRAG itself behave — belongs to the text layer and lives in AppPdfViewer.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import {
  ANNOTATION_COLORS, colorFor, cssRectsToUser,
  userRectsToCss, rectsBounds, annotationAriaLabel, isOwnAnnotation,
  canMutateAnnotation, sortForList, MAX_COMMENT,
  captureSelectionRects, selectionCaptureDelay,
} from './pdfAnnotationModel.js';

const EMPTY = Object.freeze([]);
/** Shared empty slice so a page with no annotations keeps a STABLE prop identity. */
export const NO_ANNOTATIONS = EMPTY;

/* ── One page's highlight overlay ─────────────────────────────────────────── */

function PdfAnnotationPageLayerBase({
  page, items, pageDims, scale, rotation, textLayerRef,
  userId, canCreate, canModerate, interactive = true,
  selectedId, onSelect, onCreate, onRecolor, onComment, onDelete,
}) {
  const [pending, setPending] = useState(null);  // { cssRects, text, anchor:{left,top}, source }
  const hostRef = useRef(null);
  // 117.md §46 — the Safari commit race. WebKit collapses the document selection on
  // `mousedown` of a control that sits outside it, which fires `selectionchange` →
  // `captureSelection(collapsed)` → `setPending(null)` BEFORE the button's `click` is
  // dispatched: the control unmounts under the pointer and the highlight is never
  // created. (Chromium keeps the selection long enough that the click always lands,
  // which is why this only ever reproduced on Safari.) Two guards, together:
  //   `controlHeldRef` — the pointer went down on the control, so selection-driven
  //     clearing stands down until the gesture resolves or the user clicks elsewhere;
  //   `latchedRef`     — the payload captured at that pointerdown, so `commit` has the
  //     rectangles even if a re-render slipped `pending` out from under it.
  const controlRef = useRef(null);
  const controlHeldRef = useRef(false);
  const latchedRef = useRef(null);

  // 116.md §76 — the stored anchor lives in the UNROTATED page frame, exactly like
  // extraction provenance and the jump-to-source box. Drawing (or capturing) while
  // the page is rotated would need a second, divergent projection, so annotation
  // affordances stand down at any non-zero rotation instead of drawing a highlight
  // in the wrong place. Rotating back restores everything — nothing is lost.
  const unrotated = (rotation % 360) === 0;
  const usable = !!(pageDims && +scale > 0 && unrotated);

  /**
   * §46 — is the user currently working the pending control itself? Then a selection
   * that just went away is the BROWSER's doing, not the reviewer's, and must not tear
   * the control down. Pointer state covers the mouse gesture; `activeElement` covers
   * the keyboard one (focusing the button can clear the selection in WebKit too).
   */
  const engagingControl = useCallback(() => {
    if (controlHeldRef.current) return true;
    const box = controlRef.current;
    if (!box || typeof document === 'undefined') return false;
    const active = document.activeElement;
    return !!(active && box.contains(active));
  }, []);

  /** Give up the pending control for a reason that is genuinely the user's. */
  const clearPending = useCallback(() => {
    controlHeldRef.current = false;
    latchedRef.current = null;
    setPending(null);
  }, []);

  /* Selection capture (§75). */
  const captureSelection = useCallback(() => {
    if (!canCreate || !usable) return;
    // §46 — see `engagingControl`: while the control is the thing being pressed or
    // focused, the selection state is not evidence about what the reviewer wants.
    if (engagingControl()) return;
    const tl = textLayerRef && textLayerRef.current;
    if (!tl || typeof window === 'undefined') return;
    let sel;
    try { sel = window.getSelection(); } catch { return; }
    if (!sel || sel.isCollapsed || !sel.rangeCount) { clearPending(); return; }
    const range = sel.getRangeAt(0);
    // Only a selection that lives inside THIS page's text layer counts — a drag
    // that started on the previous page must not stamp a highlight here.
    const anchorNode = range.commonAncestorContainer;
    if (!anchorNode || !tl.contains(anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentNode)) { clearPending(); return; }
    const text = String(sel.toString() || '').replace(/\s+/g, ' ').trim();
    if (!text) { clearPending(); return; }
    let host;
    try { host = tl.getBoundingClientRect(); } catch { return; }
    // 116.md §76 + 117.md §47 — one call decides the geometry: the zoom-projected
    // noise floor and line-gap (a highlight must mean the same thing at every zoom),
    // the bounds audit that catches WebKit's mis-mapped client rects on `scaleX`'d
    // spans, and the per-word Range rebuild that replaces them when it fires. An empty
    // result still means "there is nothing honest to highlight", never a guess.
    const capture = captureSelectionRects(range, host, { scale });
    if (!capture.rects.length) { clearPending(); return; }
    const last = capture.rects[capture.rects.length - 1];
    setPending({ cssRects: capture.rects, text, anchor: { left: last.x0, top: last.y1 }, source: capture.source });
  }, [canCreate, clearPending, engagingControl, scale, textLayerRef, usable]);

  useEffect(() => {
    const tl = textLayerRef && textLayerRef.current;
    if (!tl || !canCreate || !usable || typeof document === 'undefined') return undefined;
    let timer = 0;
    let dragging = false;
    // No preventDefault anywhere below: plain selection, copy, scroll and zoom keep
    // working exactly as before (§75). `captureSelection` re-validates that the
    // selection really is inside THIS page's text layer, so listening at document
    // level is safe — and it is what makes a drag that ENDS outside the text layer
    // (past the right margin, the usual way a line gets selected) still offer the
    // control instead of silently doing nothing.
    const schedule = (source) => {
      const delay = selectionCaptureDelay(source, { dragging });
      if (delay == null) return;
      clearTimeout(timer);
      timer = setTimeout(captureSelection, delay);
    };
    const onDown = () => { dragging = true; };
    const onUp = () => { dragging = false; schedule('mouseup'); };
    // §100 — a reviewer selecting with Shift+Arrow produces NO mouseup at all, so
    // `mouseup` alone left the keyboard path with no way to reach the control.
    // `selectionchange` is the only event a caret-driven selection fires; it is
    // debounced and ignored mid-drag, so the mouse gesture still resolves once, on
    // release, instead of flickering along under the cursor.
    const onSelChange = () => schedule('selectionchange');
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('mouseup', onUp, true);
    document.addEventListener('selectionchange', onSelChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('mouseup', onUp, true);
      document.removeEventListener('selectionchange', onSelChange);
    };
  }, [captureSelection, canCreate, textLayerRef, usable]);

  // Escape / a click elsewhere dismisses the control (§75) without touching the
  // browser selection, so the user can still copy what they selected. §46 — a mousedown
  // anywhere but the control also releases the pointer latch, which is why holding it
  // through the commit gesture cannot leave capture wedged: the very next click outside
  // frees it, and so does the invariant effect below.
  useEffect(() => {
    if (!pending || typeof document === 'undefined') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') clearPending(); };
    const onDown = (e) => {
      const host = hostRef.current;
      if (host && e.target && host.contains(e.target)) return;
      clearPending();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [clearPending, pending]);

  // §46 — the latch is a guard, and a guard that can stick is a new bug. There is no
  // control without a `pending`, so the moment one goes the other must too: this is the
  // invariant, stated once, rather than a clear() at every teardown site.
  useEffect(() => {
    if (!pending) { controlHeldRef.current = false; latchedRef.current = null; }
  }, [pending]);

  const commit = useCallback((colorKey) => {
    // §46 — `latchedRef` is the payload snapshotted when the pointer went down on the
    // control. It is the fallback, never the primary: a live `pending` always wins.
    const src = pending || latchedRef.current;
    if (!src || !usable || !onCreate) { clearPending(); return; }
    const rects = cssRectsToUser(src.cssRects, { scale, pageHeight: pageDims.h });
    if (!rects.length) { clearPending(); return; }
    onCreate({ page, rects, selectedText: src.text, color: colorKey });
    clearPending();
    try { window.getSelection().removeAllRanges(); } catch { /* noop */ }
  }, [clearPending, onCreate, page, pageDims, pending, scale, usable]);

  const selected = useMemo(
    () => (selectedId ? (items || EMPTY).find((a) => a && (a.id === selectedId || a.clientId === selectedId)) || null : null),
    [items, selectedId],
  );

  if (!usable) return null;

  return (
    <div ref={hostRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
      {(items || EMPTY).map((a) => (
        <HighlightMarks
          key={a.id}
          annotation={a}
          pageDims={pageDims}
          scale={scale}
          own={isOwnAnnotation(a, userId)}
          active={!!selected && selected.id === a.id}
          interactive={interactive}
          onSelect={onSelect}
        />
      ))}

      {/* §75 step 2-3 — the small context control near the selection. */}
      {pending && (
        <div
          ref={controlRef}
          role="group"
          aria-label="Highlight the selected text"
          // 117.md §46 — LATCH FIRST. Both handlers run in the capture phase, before
          // WebKit gets to collapse the selection on this same mousedown, so the
          // rectangles are safely in hand and `captureSelection` stands down until the
          // gesture resolves. Nothing is prevented or stopped here: §75's "do not
          // interfere" still holds — plain selection, copy and scroll are untouched.
          onPointerDownCapture={() => { controlHeldRef.current = true; latchedRef.current = pending; }}
          onMouseDownCapture={() => { controlHeldRef.current = true; latchedRef.current = pending; }}
          // Which path produced these rectangles — 'client-rects' when the browser was
          // believed, 'geometry' when the §47 audit rejected it and they were rebuilt.
          data-selection-source={pending.source || 'client-rects'}
          style={{
            position: 'absolute', left: Math.max(0, pending.anchor.left), top: pending.anchor.top + 6,
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px',
            background: C.card, border: `1px solid ${C.brd}`, borderRadius: 9,
            boxShadow: `0 4px 16px -4px ${C.shadow}`, pointerEvents: 'auto', zIndex: 8,
          }}
        >
          <button
            type="button" onClick={() => commit(ANNOTATION_COLORS[0].key)}
            aria-label="Highlight selected text"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 6,
              border: `1px solid ${alpha(C.acc, '45')}`, background: alpha(C.acc, '14'), color: C.acc,
              fontSize: 11.5, fontFamily: FONT, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: ANNOTATION_COLORS[0].swatch, display: 'inline-block' }} />
            Highlight
          </button>
          <span aria-hidden="true" style={{ width: 1, height: 16, background: C.brd }} />
          <ColorSwatches onPick={commit} labelPrefix="Highlight in" />
        </div>
      )}

      {/* §97 — one compact popover, only for the selected annotation. */}
      {selected && interactive && (
        <AnnotationPopover
          annotation={selected}
          pageDims={pageDims}
          scale={scale}
          own={isOwnAnnotation(selected, userId)}
          canMutate={canMutateAnnotation(selected, { userId, canModerate })}
          onClose={() => onSelect && onSelect(null)}
          onRecolor={onRecolor}
          onComment={onComment}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

/**
 * §94 — the memo boundary. `items` is the page's slice of the annotation index and
 * keeps its identity while that page is unchanged, so this bails out for every page
 * except the one that actually changed.
 */
const PdfAnnotationPageLayer = memo(PdfAnnotationPageLayerBase);
export default PdfAnnotationPageLayer;

/* ── The painted rectangles ───────────────────────────────────────────────── */

function HighlightMarks({ annotation, pageDims, scale, own, active, interactive = true, onSelect }) {
  const boxes = useMemo(
    () => userRectsToCss(annotation.rects, pageDims, scale),
    [annotation.rects, pageDims, scale],
  );
  if (!boxes.length) return null;
  const palette = colorFor(annotation.color);
  // §81 — other members' highlights keep the HUE and lose only intensity; they are
  // never greyed out, so the colour still carries its meaning.
  const fill = own ? palette.fill : palette.fillMuted;
  const label = annotationAriaLabel(annotation, own ? annotation.authorId : '');
  return boxes.map((b, i) => (
    <button
      key={i}
      type="button"
      onClick={(e) => { e.stopPropagation(); onSelect && onSelect(annotation); }}
      title={own ? 'Your highlight' : `Highlighted by ${annotation.authorName || 'another member'}`}
      // §75 — while a capture tool owns the page (extraction click-to-pick / region
      // drag) the marks are DECORATION ONLY: not clickable, not focusable, not
      // announced. They still show what the team highlighted; they just never steal a
      // click the reviewer aimed at a number.
      aria-label={interactive && i === 0 ? label : undefined}
      aria-hidden={interactive && i === 0 ? undefined : 'true'}
      tabIndex={interactive && i === 0 ? 0 : -1}
      disabled={!interactive}
      data-annotation-id={annotation.id}
      style={{
        position: 'absolute',
        left: b.left, top: b.top, width: Math.max(2, b.width), height: Math.max(2, b.height),
        background: fill,
        // §100 — ownership must not be COLOUR-ONLY: an author's own highlight has a
        // solid underline, someone else's a dashed one, and the selected annotation
        // gains an outline. All three read without perceiving hue.
        borderBottom: `2px ${own ? 'solid' : 'dashed'} ${palette.border}`,
        outline: active ? `2px solid ${palette.border}` : 'none',
        outlineOffset: active ? 1 : 0,
        borderRadius: 2,
        padding: 0, margin: 0, cursor: interactive ? 'pointer' : 'default',
        pointerEvents: interactive ? 'auto' : 'none', zIndex: active ? 7 : 6,
        opacity: annotation.pending ? 0.55 : 1,
        boxShadow: annotation.failed ? `0 0 0 2px ${C.red}` : 'none',
      }}
    />
  ));
}

/* ── The compact popover (§79/§82/§97) ────────────────────────────────────── */

function AnnotationPopover({ annotation, pageDims, scale, own, canMutate, onClose, onRecolor, onComment, onDelete }) {
  const bounds = rectsBounds(annotation.rects);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.comment || '');
  const boxRef = useRef(null);
  useEffect(() => { setDraft(annotation.comment || ''); setEditing(false); }, [annotation.id, annotation.comment]);
  // §100 — opening the popover moves focus into it so the keyboard path works. A
  // plain effect (not useLayoutEffect): focus is not a layout read, and useLayoutEffect
  // warns loudly under renderToStaticMarkup, which every UI test in this repo uses.
  useEffect(() => { try { boxRef.current && boxRef.current.focus({ preventScroll: true }); } catch { /* noop */ } }, [annotation.id]);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose && onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!bounds || !pageDims || !(+scale > 0)) return null;
  const left = Math.max(0, bounds.x0 * scale);
  const top = (pageDims.h - bounds.y0) * scale + 6;
  const palette = colorFor(annotation.color);
  const excerpt = String(annotation.selectedText || '').trim();

  return (
    <div
      ref={boxRef}
      tabIndex={-1}
      role="dialog"
      aria-label={`Highlight by ${own ? 'you' : (annotation.authorName || 'another member')}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        // §97 — compact and anchored; it must never cover most of the PDF.
        position: 'absolute', left, top, width: 264, maxWidth: '92%',
        background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10,
        boxShadow: `0 8px 26px -8px ${C.shadow}`, padding: 10,
        pointerEvents: 'auto', zIndex: 9, fontFamily: FONT,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: palette.swatch, flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.txt, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {/* §82 — "Highlighted by Sarah", using the existing display-name convention. */}
          {own ? 'Highlighted by you' : `Highlighted by ${annotation.authorName || 'a project member'}`}
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onClose} aria-label="Close highlight details"
          style={{ background: 'none', border: 'none', color: C.muted, fontSize: 13, lineHeight: 1, cursor: 'pointer', padding: 2 }}>✕</button>
      </div>

      {excerpt && (
        <blockquote style={{
          margin: '0 0 8px', padding: '5px 8px', borderLeft: `3px solid ${palette.swatch}`,
          background: C.surf, borderRadius: 4, fontSize: 11.5, color: C.txt2, lineHeight: 1.45,
          maxHeight: 74, overflow: 'auto',
        }}>{excerpt.length > 260 ? `${excerpt.slice(0, 260)}…` : excerpt}</blockquote>
      )}

      {!editing && annotation.comment && (
        <p style={{ margin: '0 0 8px', fontSize: 12, color: C.txt, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{annotation.comment}</p>
      )}

      {editing ? (
        <div>
          <label htmlFor={`ann-comment-${annotation.id}`} style={{ display: 'block', fontSize: 10, fontFamily: MONO, color: C.muted, marginBottom: 3 }}>COMMENT</label>
          <textarea
            id={`ann-comment-${annotation.id}`}
            value={draft}
            maxLength={MAX_COMMENT}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '6px 8px',
              background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt,
              fontSize: 12, fontFamily: FONT,
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button type="button" onClick={() => { onComment && onComment(annotation, draft); setEditing(false); }} style={primaryBtn}>Save</button>
            <button type="button" onClick={() => { setDraft(annotation.comment || ''); setEditing(false); }} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {canMutate && (
            <button type="button" onClick={() => setEditing(true)} style={ghostBtn}>
              {annotation.comment ? 'Edit comment' : 'Add comment'}
            </button>
          )}
          {canMutate && <ColorSwatches current={annotation.color} onPick={(k) => onRecolor && onRecolor(annotation, k)} labelPrefix="Change colour to" />}
          {canMutate && (
            <button type="button" onClick={() => { onDelete && onDelete(annotation); onClose && onClose(); }} style={dangerBtn}>Delete</button>
          )}
          {!canMutate && (
            <span style={{ fontSize: 11, color: C.muted }}>Only the author or a project leader can change this highlight.</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Shared bits ──────────────────────────────────────────────────────────── */

function ColorSwatches({ current, onPick, labelPrefix = 'Use' }) {
  return (
    <span role="group" aria-label="Highlight colour" style={{ display: 'inline-flex', gap: 3 }}>
      {ANNOTATION_COLORS.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onPick && onPick(c.key)}
          aria-label={`${labelPrefix} ${c.label}`}
          aria-pressed={current ? current === c.key : undefined}
          title={c.label}
          style={{
            width: 16, height: 16, borderRadius: 4, padding: 0, cursor: 'pointer',
            background: c.swatch,
            border: current === c.key ? `2px solid ${C.txt}` : `1px solid ${alpha(C.txt2, '55')}`,
          }}
        />
      ))}
    </span>
  );
}

const primaryBtn = {
  background: alpha(C.acc, '16'), border: `1px solid ${alpha(C.acc, '45')}`, color: C.acc,
  fontSize: 11.5, fontFamily: FONT, fontWeight: 600, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
};
const ghostBtn = {
  background: 'none', border: `1px solid ${C.brd2}`, color: C.txt2,
  fontSize: 11.5, fontFamily: FONT, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
};
const dangerBtn = {
  background: 'none', border: `1px solid ${alpha(C.red, '55')}`, color: C.red,
  fontSize: 11.5, fontFamily: FONT, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
};
/** §85 — the inline confirmation strip (no window.confirm; wording is test-pinned). */
const confirmBox = {
  margin: '0 10px 8px', padding: '8px 10px', background: C.card,
  border: `1px solid ${C.brd2}`, borderRadius: 8,
};
const confirmText = { margin: '0 0 7px', fontSize: 11.5, color: C.txt2, lineHeight: 1.5, fontFamily: FONT };

/* ── §98/§99 — the optional collapsible list ──────────────────────────────── */

/**
 * AnnotationListPanel — annotations in document order, filterable mine/all, each
 * row jumping to its page and location (§99). Deliberately lightweight: it renders
 * text rows from the SAME array the overlays use (no second fetch, no second
 * source of truth) and is collapsed by default so it costs nothing until opened.
 */
export function AnnotationListPanel({ annotations, userId, onJump, selectedId, canClearMine, canClearAll, onClear, busy = false }) {
  const [open, setOpen] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  // §85 — the clear affordances are TWO-STEP, inline (the KeywordContextMenu pattern:
  // no window.confirm, so the wording is pinned by an SSR test and screen readers get
  // it). `mine` asks once; `all` asks with a stronger sentence that names the count and
  // the whole team, because it destroys other people's work.
  const [confirming, setConfirming] = useState('');   // '' | 'mine' | 'all'
  const rows = useMemo(() => {
    const all = sortForList(annotations);
    return mineOnly ? all.filter((a) => isOwnAnnotation(a, userId)) : all;
  }, [annotations, mineOnly, userId]);
  const all = useMemo(() => sortForList(annotations), [annotations]);
  const total = all.length;
  const mineCount = useMemo(() => all.filter((a) => isOwnAnnotation(a, userId)).length, [all, userId]);

  const runClear = (mode) => { setConfirming(''); if (onClear) onClear(mode); };

  return (
    <div style={{ borderTop: `1px solid ${C.brd}`, background: C.surf, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', flexWrap: 'wrap' }}>
        <button
          type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          Highlights <span style={{ fontFamily: MONO, color: C.muted }}>({total})</span>
        </button>
        {open && (
          <>
            <button type="button" onClick={() => setMineOnly((v) => !v)} aria-pressed={mineOnly} style={mineOnly ? primaryBtn : ghostBtn}>
              {mineOnly ? 'Mine' : 'All'}
            </button>
            <div style={{ flex: 1 }} />
            {canClearMine && (
              <button type="button" disabled={busy || !mineCount} onClick={() => setConfirming('mine')} style={ghostBtn}>Clear my annotations</button>
            )}
            {canClearAll && (
              <button type="button" disabled={busy || !total} onClick={() => setConfirming('all')} style={dangerBtn}>Clear all annotations on this PDF</button>
            )}
          </>
        )}
      </div>

      {open && confirming === 'mine' && (
        <div role="alertdialog" aria-label="Clear my annotations" style={confirmBox}>
          <p style={confirmText}>
            Remove your {mineCount} highlight{mineCount === 1 ? '' : 's'} on this PDF? Other members&apos; highlights are not touched, and the PDF itself is not deleted.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => runClear('mine')} style={dangerBtn}>Clear my annotations</button>
            <button type="button" onClick={() => setConfirming('')} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}
      {open && confirming === 'all' && (
        <div role="alertdialog" aria-label="Clear all annotations on this PDF" style={{ ...confirmBox, borderColor: alpha(C.red, '55') }}>
          <p style={confirmText}>
            <strong>This removes every member&apos;s highlights.</strong> All {total} highlight{total === 1 ? '' : 's'} and comment{total === 1 ? '' : 's'} on this PDF will be cleared for the whole project. The PDF file itself is not deleted. This cannot be undone from here.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => runClear('all')} style={dangerBtn}>Yes, clear all {total} annotations</button>
            <button type="button" onClick={() => setConfirming('')} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}
      {open && (
        <ul style={{ listStyle: 'none', margin: 0, padding: '0 10px 8px', maxHeight: 190, overflow: 'auto' }}>
          {!rows.length && <li style={{ fontSize: 11.5, color: C.muted, padding: '4px 0' }}>No highlights yet.</li>}
          {rows.map((a) => {
            const own = isOwnAnnotation(a, userId);
            const palette = colorFor(a.color);
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onJump && onJump(a)}
                  aria-current={selectedId === a.id ? 'true' : undefined}
                  style={{
                    display: 'flex', gap: 7, alignItems: 'flex-start', width: '100%', textAlign: 'left',
                    background: selectedId === a.id ? alpha(C.acc, '12') : 'none',
                    border: 'none', borderBottom: `1px solid ${C.brd}`, padding: '6px 2px',
                    cursor: 'pointer', fontFamily: FONT,
                  }}
                >
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: palette.swatch, marginTop: 4, flexShrink: 0 }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 11.5, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {String(a.selectedText || '').trim() || '(no text captured)'}
                    </span>
                    <span style={{ display: 'block', fontSize: 10, fontFamily: MONO, color: C.muted }}>
                      p.{a.page} · {own ? 'you' : (a.authorName || 'member')}{a.comment ? ' · comment' : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
