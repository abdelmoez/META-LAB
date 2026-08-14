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
 * Selection capture is a single `mouseup` listener on the existing text layer. It
 * never calls preventDefault, never blocks copy, never touches scroll or zoom, and
 * a click that produced no selection just dismisses the control. On a scanned PDF
 * with no text layer there is nothing to select, so the control simply never
 * appears (§96) — the viewer does not pretend text exists.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import {
  ANNOTATION_COLORS, colorFor, toPageRects, mergeLineRects, cssRectsToUser,
  userRectsToCss, rectsBounds, annotationAriaLabel, isOwnAnnotation,
  canMutateAnnotation, sortForList, MAX_COMMENT,
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
  const [pending, setPending] = useState(null);  // { cssRects, text, anchor:{left,top} }
  const hostRef = useRef(null);

  // 116.md §76 — the stored anchor lives in the UNROTATED page frame, exactly like
  // extraction provenance and the jump-to-source box. Drawing (or capturing) while
  // the page is rotated would need a second, divergent projection, so annotation
  // affordances stand down at any non-zero rotation instead of drawing a highlight
  // in the wrong place. Rotating back restores everything — nothing is lost.
  const unrotated = (rotation % 360) === 0;
  const usable = !!(pageDims && +scale > 0 && unrotated);

  /* Selection capture (§75). */
  const captureSelection = useCallback(() => {
    if (!canCreate || !usable) return;
    const tl = textLayerRef && textLayerRef.current;
    if (!tl || typeof window === 'undefined') return;
    let sel;
    try { sel = window.getSelection(); } catch { return; }
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setPending(null); return; }
    const range = sel.getRangeAt(0);
    // Only a selection that lives inside THIS page's text layer counts — a drag
    // that started on the previous page must not stamp a highlight here.
    const anchorNode = range.commonAncestorContainer;
    if (!anchorNode || !tl.contains(anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentNode)) { setPending(null); return; }
    const text = String(sel.toString() || '').replace(/\s+/g, ' ').trim();
    if (!text) { setPending(null); return; }
    let host;
    try { host = tl.getBoundingClientRect(); } catch { return; }
    const merged = mergeLineRects(toPageRects(Array.from(range.getClientRects() || []), host));
    if (!merged.length) { setPending(null); return; }
    const last = merged[merged.length - 1];
    setPending({ cssRects: merged, text, anchor: { left: last.x0, top: last.y1 } });
  }, [canCreate, textLayerRef, usable]);

  useEffect(() => {
    const tl = textLayerRef && textLayerRef.current;
    if (!tl || !canCreate || !usable) return undefined;
    // `mouseup` on the text layer, bubble phase, no preventDefault: plain selection
    // and copy keep working exactly as before (§75).
    const onUp = () => { setTimeout(captureSelection, 0); };
    tl.addEventListener('mouseup', onUp);
    return () => tl.removeEventListener('mouseup', onUp);
  }, [captureSelection, canCreate, textLayerRef, usable]);

  // Escape / a click elsewhere dismisses the control (§75) without touching the
  // browser selection, so the user can still copy what they selected.
  useEffect(() => {
    if (!pending || typeof document === 'undefined') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setPending(null); };
    const onDown = (e) => {
      const host = hostRef.current;
      if (host && e.target && host.contains(e.target)) return;
      setPending(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [pending]);

  const commit = useCallback((colorKey) => {
    if (!pending || !usable || !onCreate) return;
    const rects = cssRectsToUser(pending.cssRects, { scale, pageHeight: pageDims.h });
    if (!rects.length) { setPending(null); return; }
    onCreate({ page, rects, selectedText: pending.text, color: colorKey });
    setPending(null);
    try { window.getSelection().removeAllRanges(); } catch { /* noop */ }
  }, [onCreate, page, pageDims, pending, scale, usable]);

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
          role="group"
          aria-label="Highlight the selected text"
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
