/**
 * features/manuscript/writingAssistant/WritingAssistantCard.jsx — 120.md §6
 * "Hover and click interactions" + "Keyboard accessibility".
 *
 * The card anchored at an issue. §6 lists exactly what it must show (the detected
 * text, the category, a concise explanation, the recommended correction, alternative
 * suggestions, the rule in plain language) and exactly what it must offer (apply,
 * dismiss, ignore the rule in this manuscript, ignore the term throughout, add to the
 * personal dictionary, add to the project dictionary subject to permissions).
 *
 * §6 is equally clear about what it must NOT do: "Do not silently autocorrect text
 * while the user is typing. A correction should occur only after a clear user
 * action." Nothing in this component writes anything until a button is pressed.
 *
 * GEOMETRY: anchored to the resolved DOM Range's client rect and clamped to the
 * viewport, positioned `fixed` so no editor container's overflow can clip it and no
 * toolbar stacking context can cover it (§6 "Avoid tooltips being clipped by editor
 * containers or toolbar stacking contexts"). Re-measured on scroll and resize so the
 * card stays with its word — §6 "Ensure underlines remain aligned during scrolling,
 * zooming, continuous view, and full-screen mode".
 *
 * FOCUS: role=dialog with a real focus trap and a focus RESTORE — Escape returns the
 * caret to the exact editor location it came from, which is §6's keyboard
 * requirement and the reason the Escape is latched (markOverlayEscape) before it is
 * consumed.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { C, btnS } from '../../../frontend/workspace/ui/styles.js';
import { Icon } from '../../../frontend/components/icons.jsx';
import { markOverlayEscape } from '../../../frontend/focus/overlayEscapeLatch.js';
import { CATEGORY_LABEL } from './engine/issueModel.js';
import { WA_HIGHLIGHT_CSS } from './waHighlights.js';

const CARD_W = 300;
const MARGIN = 8;
const GAP = 6;

/**
 * The feature's own stylesheet: the four highlight registrations plus the two rules
 * the card genuinely needs CSS for (:hover / :focus-visible cannot be inline).
 * Deliberately NOT part of MANUSCRIPT_TOOLBAR_CSS — every rule there must start with
 * `.ms-toolbar ` (pinned), and none of this belongs to the bar.
 */
export const WA_UI_CSS = `${WA_HIGHLIGHT_CSS}
.ms-wa-card .ms-wa-btn:hover{border-color:var(--t-brd2);background:var(--t-card2);}
.ms-wa-card .ms-wa-primary:hover{filter:brightness(1.06);}
`;

/** Confidence, in words. §6 — "Label confidence and category appropriately." */
export function confidenceLabel(issue) {
  if (!issue) return '';
  if (issue.severity === 'error') return 'Likely error';
  if (issue.confidence >= 0.75) return 'Probable';
  if (issue.confidence >= 0.5) return 'Possible';
  return 'Worth a look';
}

/** Clamp a rect-anchored card into the viewport. Pure, so the maths is testable. */
export function cardPosition(rect, viewport, size) {
  if (!rect) return null;
  const vw = viewport.width;
  const vh = viewport.height;
  const w = size.width || CARD_W;
  const h = size.height || 160;
  let left = Math.round(rect.left);
  if (left + w > vw - MARGIN) left = vw - MARGIN - w;
  if (left < MARGIN) left = MARGIN;
  // Below the word by default; above it when there is no room below.
  let top = Math.round(rect.bottom + GAP);
  if (top + h > vh - MARGIN) {
    const above = Math.round(rect.top - GAP - h);
    top = above >= MARGIN ? above : Math.max(MARGIN, vh - MARGIN - h);
  }
  return { left, top };
}

export function WritingAssistantCard({ wa }) {
  const issue = wa.activeIssue;
  const cardRef = useRef(null);
  const [pos, setPos] = useState(null);
  const returnFocus = useRef(null);

  const close = useCallback(() => {
    wa.closeCard();
    // §6 "Return focus to the exact editor location." The editor's own api restores
    // its remembered caret; a bare focus() would land at position 0.
    const restore = returnFocus.current;
    returnFocus.current = null;
    if (restore && typeof restore.focus === 'function') restore.focus();
  }, [wa]);

  // Remember where the caret was BEFORE the card takes focus.
  useEffect(() => {
    if (!issue) { returnFocus.current = null; return; }
    if (!returnFocus.current && typeof document !== 'undefined') {
      returnFocus.current = document.activeElement;
    }
  }, [issue]);

  const measure = useCallback(() => {
    if (!issue) { setPos(null); return; }
    const range = wa.rangeFor(issue);
    const rect = range && typeof range.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : null;
    if (!rect || (!rect.width && !rect.height)) { setPos(null); return; }
    const el = cardRef.current;
    setPos(cardPosition(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      { width: el ? el.offsetWidth : CARD_W, height: el ? el.offsetHeight : 160 },
    ));
  }, [issue, wa]);

  useLayoutEffect(() => { measure(); }, [measure]);

  useEffect(() => {
    if (!issue || typeof window === 'undefined') return undefined;
    // `capture` so a scroll inside the editor's own scroller is seen too.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [issue, measure]);

  // Escape + a real focus trap (role=dialog owes both).
  useEffect(() => {
    if (!issue || typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        markOverlayEscape();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const el = cardRef.current;
      if (!el) return;
      const focusable = el.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [issue, close]);

  // Move focus into the card once it is placed, so the keyboard path works.
  useEffect(() => {
    if (!issue || !pos) return;
    const el = cardRef.current;
    if (!el || el.contains(document.activeElement)) return;
    const first = el.querySelector('button');
    if (first) first.focus();
  }, [issue, pos]);

  if (!issue) return null;

  const suggestions = issue.suggestions || [];
  const primary = suggestions[0] || null;
  const canProject = wa.projectCanEdit;

  return (
    <div
      ref={cardRef}
      className="ms-wa-card"
      role="dialog"
      aria-label={`${CATEGORY_LABEL[issue.category] || issue.category}: ${issue.original}`}
      data-testid="stitch-manuscript-wa-card"
      data-wa-category={issue.category}
      style={{
        position: 'fixed',
        left: pos ? pos.left : -9999,
        top: pos ? pos.top : -9999,
        width: CARD_W,
        // Above the manuscript toolbar (20) and below the app's modals (60).
        zIndex: 40,
        background: C.card,
        border: `1px solid ${C.brd}`,
        borderRadius: 10,
        boxShadow: '0 10px 30px var(--t-shadow)',
        padding: 12,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: C.muted }}>
          {CATEGORY_LABEL[issue.category] || issue.category}
        </span>
        <span data-testid="stitch-manuscript-wa-card-confidence"
          style={{ fontSize: 10, color: C.muted, marginLeft: 'auto' }}>
          {confidenceLabel(issue)}
        </span>
        <button type="button" onClick={close} aria-label="Close" className="ms-wa-btn"
          data-testid="stitch-manuscript-wa-card-close"
          style={{ ...btnS, padding: '1px 5px', minWidth: 0 }}>
          <Icon name="x" size={11} />
        </button>
      </div>

      <div data-testid="stitch-manuscript-wa-card-original"
        style={{ fontSize: 13, fontWeight: 700, color: C.txt, margin: '6px 0 2px', wordBreak: 'break-word' }}>
        {issue.original}
      </div>
      <p style={{ fontSize: 11, color: C.txt2, margin: '0 0 2px', lineHeight: 1.5 }}>{issue.message}</p>
      {issue.explanation && (
        <p data-testid="stitch-manuscript-wa-card-explanation"
          style={{ fontSize: 10.5, color: C.muted, margin: '0 0 6px', lineHeight: 1.5 }}>
          {issue.explanation}
        </p>
      )}

      {primary ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 4px' }}>
          <button
            type="button"
            className="ms-wa-primary"
            data-testid="stitch-manuscript-wa-apply"
            onClick={() => wa.applyCorrection(issue, primary)}
            style={{
              ...btnS, padding: '4px 10px', fontSize: 11.5, fontWeight: 700,
              background: 'var(--t-acc)', color: '#fff', borderColor: 'var(--t-acc)',
            }}
          >{primary}</button>
          {suggestions.slice(1, 5).map((s) => (
            <button
              key={s}
              type="button"
              className="ms-wa-btn"
              data-testid={`stitch-manuscript-wa-alt-${s}`}
              onClick={() => wa.applyCorrection(issue, s)}
              style={{ ...btnS, padding: '4px 9px', fontSize: 11 }}
            >{s}</button>
          ))}
        </div>
      ) : (
        <p data-testid="stitch-manuscript-wa-card-nosuggestion"
          style={{ fontSize: 10.5, color: C.muted, margin: '8px 0 4px' }}>
          No confident correction to offer — this may be a term worth adding to a dictionary.
        </p>
      )}

      <div style={{ borderTop: `1px solid ${C.brd}`, marginTop: 8, paddingTop: 8, display: 'grid', gap: 4 }}>
        <Action testid="stitch-manuscript-wa-dismiss" onClick={() => wa.dismiss(issue)}>Dismiss</Action>
        <Action testid="stitch-manuscript-wa-ignore-term" onClick={() => wa.ignoreTerm(issue)}>
          Ignore “{issue.original}” in this manuscript
        </Action>
        <Action testid="stitch-manuscript-wa-ignore-rule" onClick={() => wa.ignoreRule(issue)}>
          Ignore this rule in this manuscript
        </Action>
        <Action testid="stitch-manuscript-wa-add-personal"
          onClick={async () => { await wa.addTerm('personal', issue.original); wa.dismiss(issue); }}>
          Add to my dictionary
        </Action>
        {canProject && (
          <Action testid="stitch-manuscript-wa-add-project"
            onClick={async () => { await wa.addTerm('project', issue.original); wa.dismiss(issue); }}>
            Add to the project dictionary
          </Action>
        )}
      </div>
    </div>
  );
}

function Action({ children, onClick, testid }) {
  return (
    <button
      type="button"
      className="ms-wa-btn"
      data-testid={testid}
      onClick={onClick}
      style={{
        ...btnS, padding: '3px 8px', fontSize: 11, textAlign: 'left',
        justifyContent: 'flex-start', width: '100%',
      }}
    >{children}</button>
  );
}

export default WritingAssistantCard;
