/**
 * features/manuscript/writingAssistant/WritingAssistantControl.jsx — 120.md §6
 * "Product name and toolbar control".
 *
 * The chip that lives in ManuscriptToolbar's Level-A RIGHT group, beside the save
 * pill, on the Editor and PDF View destinations. §6 requires the control to carry, in
 * ONE place: the on/off toggle, the current status, the issue count when enabled, a
 * checking state, a no-issues state, a recoverable-error state, next/previous issue,
 * and a tooltip explaining the feature. All of that is here.
 *
 * NAMING: "Writing Assistant" — §6 offers it as one of two acceptable names and asks
 * that the final wording follow existing PecanRev terminology. The product already
 * says "Manuscript", "Structure", "Citation style"; "Writing Assistant" reads as one
 * more capability of the writing surface, where "Spelling & Grammar" would read as a
 * dialog. The word "Assistant" is also the honest one: everything it produces is a
 * suggestion a human accepts.
 *
 * STYLING: Wave 1's purple-bar discipline, unchanged. Every colour comes from the
 * `TB` palette, every control takes an explicit `onDark` (never inferred from a
 * class), and the popover that opens from the bar keeps the design system's LIGHT
 * surface — which is exactly what 120.md §2 allows and what the '⋯' menu already
 * does. The chip carries `ms-tb-action ms-tb-dark` so it inherits the bar's own
 * hover and white focus ring rather than inventing a second set.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, btnS } from '../../../frontend/workspace/ui/styles.js';
import { Icon } from '../../../frontend/components/icons.jsx';
import Tooltip from '../../../frontend/components/Tooltip.jsx';
import { TB } from '../ManuscriptToolbar.jsx';
import { markOverlayEscape } from '../../../frontend/focus/overlayEscapeLatch.js';
import { CATEGORY_LABEL } from './engine/issueModel.js';
import { WA_STATUS, WA_VARIANTS } from './waState.js';

export const WA_TOOLTIP = 'Writing Assistant — a local spelling and grammar check built for '
  + 'medical and scientific manuscripts. It runs entirely in your browser: no part of your '
  + 'manuscript is ever sent anywhere. Suggestions are never applied automatically.';

/** §6 asks for a status, not a spinner: each state gets its own words and glyph. */
export function chipState(status, count) {
  switch (status) {
    case WA_STATUS.LOADING: return { glyph: 'clock', text: 'Starting…', tone: 'muted' };
    case WA_STATUS.CHECKING: return { glyph: 'refresh', text: 'Checking…', tone: 'muted' };
    case WA_STATUS.ERROR: return { glyph: 'alertTriangle', text: 'Unavailable', tone: 'rose' };
    case WA_STATUS.CLEAN: return { glyph: 'check', text: 'No issues', tone: 'mint' };
    case WA_STATUS.ISSUES: return { glyph: 'alert', text: String(count), tone: 'amber' };
    default: return { glyph: 'pencil', text: 'Writing', tone: 'muted' };
  }
}

const toneInk = (tone, onDark) => {
  if (!onDark) {
    return { rose: '#b42318', mint: '#046c4e', amber: '#8a5a00', muted: C.txt2 }[tone] || C.txt2;
  }
  return { rose: TB.rose, mint: TB.mint, amber: TB.amber, muted: TB.inkMuted }[tone] || TB.inkMuted;
};

/* ── the popover primitives (local copies, on purpose) ───────────────────────── */

/* ManuscriptToolbar's `popoverCard`, `useEscape` and `useViewportClamp` are
   module-local there and deliberately not exported; a source-pinned test also counts
   its `useViewportClamp(` call sites. Rather than widen that module's API for one
   consumer, this feature keeps its own equivalents — same geometry, same z-order,
   same Escape contract. */
const CATCHER_Z = 5;
const POPOVER_Z = 6;
const VIEWPORT_MARGIN = 8;

const popoverCard = {
  position: 'absolute', zIndex: POPOVER_Z, background: C.card,
  border: `1px solid ${C.brd}`, borderRadius: 10,
  boxShadow: '0 10px 30px var(--t-shadow)',
};

/** 117.md §44 — an overlay that CONSUMES an Escape must claim the fullscreen exit
    the same key also causes, or dismissing this popover ejects the writer from Focus
    Mode. Marked before the propagation is stopped, exactly like the bar's own. */
export function useWaEscape(open, onClose) {
  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      markOverlayEscape();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
}

/** Keep an anchored card inside the viewport; measures from the DECLARED anchor so
    repeated corrections never compound (the ManuscriptToolbar rule, same maths). */
export function useWaClamp(open) {
  const ref = useRef(null);
  const [dx, setDx] = useState(0);
  useEffect(() => {
    if (!open || typeof window === 'undefined') { setDx(0); return undefined; }
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth || 0;
      setDx((cur) => {
        const left = rect.left - cur;
        const right = rect.right - cur;
        const M = VIEWPORT_MARGIN;
        let shift = 0;
        if (right > vw - M) shift = (vw - M) - right;
        if (left + shift < M) shift = M - left;
        return Math.round(shift);
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);
  return [ref, dx];
}

/* ── the control ─────────────────────────────────────────────────────────────── */

export function WritingAssistantControl({ wa, condensed = false, onDark = true }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [cardRef, dx] = useWaClamp(open);
  const triggerRef = useRef(null);

  const state = chipState(wa.status, wa.summary.total);
  const ink = toneInk(state.tone, onDark);

  // §6 keyboard rules — Escape closes and returns focus to the control it came from.
  const closeAndRefocus = useCallback(() => {
    setOpen(false);
    if (triggerRef.current) triggerRef.current.focus();
  }, []);
  useWaEscape(open, closeAndRefocus);

  if (!wa.available) return null;

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <Tooltip content={WA_TOOLTIP} placement="bottom">
        <button
          ref={triggerRef}
          type="button"
          data-testid="stitch-manuscript-wa-chip"
          data-wa-status={wa.status}
          data-wa-count={wa.enabled ? wa.summary.total : undefined}
          className={onDark ? 'ms-tb-action ms-tb-dark ms-wa-chip' : 'ms-tb-action ms-wa-chip'}
          data-on-dark={onDark ? 'true' : undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={wa.enabled
            ? `Writing Assistant, ${state.text === String(wa.summary.total) ? `${wa.summary.total} issues` : state.text}`
            : 'Writing Assistant, off'}
          onClick={() => setOpen((o) => !o)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            // The bar's own control height — §6 "touch targets ≥ the bar's existing
            // control size" is satisfied by using the same number, not a new one.
            height: 26, padding: '0 9px', borderRadius: 7, cursor: 'pointer',
            background: open ? TB.activeBg : TB.chipBg,
            border: `1px solid ${open ? TB.chipBrdStrong : TB.chipBrd}`,
            color: wa.enabled ? ink : TB.inkMuted,
            fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
            fontFamily: "'IBM Plex Sans',sans-serif",
          }}
        >
          <Icon name={wa.enabled ? state.glyph : 'pencil'} size={12} />
          {!condensed && <span>Writing</span>}
          {wa.enabled && (
            <span
              data-testid="stitch-manuscript-wa-status"
              role="status"
              aria-live="polite"
              style={{ color: ink, fontWeight: 700 }}
            >
              {state.text}
            </span>
          )}
        </button>
      </Tooltip>

      {/* The polite live region for issue NAVIGATION (§6: "Spelling: 'hepatocelular',
          suggestion 'hepatocellular', issue 3 of 12"). Kept out of the button's own
          status region so a count change and a navigation announcement cannot
          interrupt each other. */}
      <span
        data-testid="stitch-manuscript-wa-live"
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute', width: 1, height: 1, overflow: 'hidden',
          clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
        }}
      >
        {wa.announcement}
      </span>

      {open && (
        <>
          <div
            data-testid="stitch-manuscript-wa-catcher"
            onClick={close}
            style={{ position: 'fixed', inset: 0, zIndex: CATCHER_Z, background: 'transparent' }}
          />
          <WritingAssistantPanel wa={wa} cardRef={cardRef} dx={dx} onClose={closeAndRefocus} />
        </>
      )}
    </span>
  );
}

/* ── the settings / issues panel ─────────────────────────────────────────────── */

function Row({ children, style, className }) {
  return (
    <div className={className} style={{ display: 'flex', alignItems: 'center', gap: 8, ...style }}>{children}</div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
      color: C.muted, margin: '12px 0 6px',
    }}>{children}</div>
  );
}

export function WritingAssistantPanel({ wa, cardRef, dx, onClose }) {
  const [tab, setTab] = useState('issues');
  const [newTerm, setNewTerm] = useState('');

  const byCategory = useMemo(
    () => Object.entries(wa.summary.byCategory).sort((a, b) => b[1] - a[1]),
    [wa.summary.byCategory],
  );

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="Writing Assistant"
      data-testid="stitch-manuscript-wa-popover"
      style={{
        ...popoverCard, top: 'calc(100% + 7px)', right: 0, width: 320, padding: 12,
        transform: dx ? `translateX(${dx}px)` : undefined,
        maxHeight: '70vh', overflowY: 'auto',
      }}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 12.5, color: C.txt }}>Writing Assistant</strong>
        <button type="button" onClick={onClose} aria-label="Close"
          data-testid="stitch-manuscript-wa-close"
          style={{ ...btnS, padding: '2px 6px', minWidth: 0 }}>
          <Icon name="x" size={12} />
        </button>
      </Row>

      {/* ON/OFF — §6: the feature is off until the user enables it. */}
      <Row style={{ marginTop: 10, justifyContent: 'space-between' }}>
        <label htmlFor="wa-enabled" style={{ fontSize: 12, color: C.txt, cursor: 'pointer' }}>
          Check this manuscript
        </label>
        <input
          id="wa-enabled"
          type="checkbox"
          role="switch"
          data-testid="stitch-manuscript-wa-toggle"
          checked={wa.enabled}
          onChange={(e) => wa.setEnabled(e.target.checked)}
          style={{ width: 16, height: 16, cursor: 'pointer' }}
        />
      </Row>
      <p style={{ fontSize: 10.5, color: C.muted, margin: '4px 0 0', lineHeight: 1.5 }}>
        Runs locally in your browser. Nothing you write is sent anywhere.
      </p>

      {wa.enabled && !wa.decorationsSupported && (
        <p data-testid="stitch-manuscript-wa-degraded"
          style={{ fontSize: 10.5, color: C.muted, margin: '8px 0 0', lineHeight: 1.5 }}>
          This browser cannot draw inline underlines. Every issue is still listed here,
          and Next / Previous still take you to it.
        </p>
      )}

      {wa.status === WA_STATUS.ERROR && (
        <Row style={{ marginTop: 10, alignItems: 'flex-start' }}>
          <div data-testid="stitch-manuscript-wa-error" style={{ fontSize: 11, color: '#b42318', flex: 1 }}>
            {(wa.error && wa.error.message) || 'The writing assistant is unavailable.'}
            {' '}Your typing and autosave are unaffected.
          </div>
          <button type="button" style={{ ...btnS, padding: '3px 8px' }}
            data-testid="stitch-manuscript-wa-retry" onClick={wa.retry}>Retry</button>
        </Row>
      )}

      {wa.enabled && (
        <>
          {/* English variant — §6 "Language or English-variant preference". */}
          <SectionLabel>English</SectionLabel>
          <Row>
            {WA_VARIANTS.map((v) => (
              <button
                key={v}
                type="button"
                data-testid={`stitch-manuscript-wa-variant-${v}`}
                aria-pressed={wa.prefs.variant === v}
                onClick={() => wa.setVariant(v)}
                style={{
                  ...btnS, padding: '3px 10px', fontSize: 11,
                  borderColor: wa.prefs.variant === v ? 'var(--t-acc)' : C.brd,
                  color: wa.prefs.variant === v ? 'var(--t-acc)' : C.txt2,
                  fontWeight: wa.prefs.variant === v ? 700 : 600,
                }}
              >{v === 'en-US' ? 'US' : 'UK'}</button>
            ))}
            <label style={{ marginLeft: 'auto', fontSize: 11, color: C.txt2, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <input type="checkbox" checked={wa.prefs.showStyle}
                data-testid="stitch-manuscript-wa-style-toggle"
                onChange={(e) => wa.setShowStyle(e.target.checked)} />
              Style hints
            </label>
          </Row>

          {/* Navigation — §6 "A way to move to the next and previous issue". */}
          <SectionLabel>Issues</SectionLabel>
          <Row>
            <button type="button" style={{ ...btnS, padding: '3px 9px', fontSize: 11 }}
              data-testid="stitch-manuscript-wa-prev"
              disabled={!wa.issues.length} onClick={wa.prev}>
              <Icon name="chevronLeft" size={11} /> Previous
            </button>
            <button type="button" style={{ ...btnS, padding: '3px 9px', fontSize: 11 }}
              data-testid="stitch-manuscript-wa-next"
              disabled={!wa.issues.length} onClick={wa.next}>
              Next <Icon name="chevronRight" size={11} />
            </button>
            {/* §6 action list — "Recheck". Distinct from the error state's Retry:
                this throws the cached results away and looks again. */}
            <button type="button" style={{ ...btnS, padding: '3px 9px', fontSize: 11 }}
              data-testid="stitch-manuscript-wa-recheck" onClick={wa.recheck}>
              <Icon name="refresh" size={11} /> Recheck
            </button>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: C.txt2 }}
              data-testid="stitch-manuscript-wa-total">
              {wa.summary.total} total
            </span>
          </Row>

          <div role="tablist" aria-label="Writing Assistant panels" style={{ display: 'flex', gap: 6, margin: '10px 0 0' }}>
            {[['issues', 'This section'], ['categories', 'Categories'], ['dictionary', 'Dictionaries']].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                data-testid={`stitch-manuscript-wa-tab-${id}`}
                onClick={() => setTab(id)}
                style={{
                  ...btnS, padding: '3px 8px', fontSize: 10.5,
                  borderColor: tab === id ? 'var(--t-acc)' : C.brd,
                  color: tab === id ? 'var(--t-acc)' : C.txt2,
                }}
              >{label}</button>
            ))}
          </div>

          {tab === 'issues' && (
            <div data-testid="stitch-manuscript-wa-list" style={{ marginTop: 8 }}>
              {!wa.issues.length && (
                <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>
                  {wa.status === WA_STATUS.CHECKING ? 'Checking…'
                    : wa.status === WA_STATUS.ERROR ? 'Checking did not finish.'
                      : 'No issues in this section.'}
                </p>
              )}
              {wa.issues.slice(0, 40).map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  className="ms-wa-row"
                  data-testid={`stitch-manuscript-wa-issue-${issue.id}`}
                  onClick={() => { wa.goTo(issue); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                    background: 'transparent', border: 0, borderRadius: 6, padding: '5px 6px',
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{ fontSize: 11.5, color: C.txt, fontWeight: 600 }}>{issue.original}</span>
                  <span style={{ fontSize: 10.5, color: C.muted, marginLeft: 6 }}>
                    {CATEGORY_LABEL[issue.category] || issue.category}
                    {issue.severity === 'suggestion' ? ' · suggestion' : ''}
                  </span>
                </button>
              ))}
            </div>
          )}

          {tab === 'categories' && (
            <div data-testid="stitch-manuscript-wa-categories" style={{ marginTop: 8 }}>
              {!byCategory.length && <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>Nothing found yet.</p>}
              {byCategory.map(([cat, n]) => (
                <Row key={cat} style={{ padding: '3px 0' }}>
                  <label style={{ fontSize: 11.5, color: C.txt, display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!wa.prefs.mutedCategories.includes(cat)}
                      onChange={(e) => wa.muteCategory(cat, !e.target.checked)}
                    />
                    {CATEGORY_LABEL[cat] || cat}
                  </label>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: C.txt2 }}>{n}</span>
                </Row>
              ))}
              {wa.prefs.mutedRules.length > 0 && (
                <>
                  <SectionLabel>Muted rules</SectionLabel>
                  {wa.prefs.mutedRules.map((ruleId) => (
                    <Row key={ruleId} style={{ padding: '2px 0' }}>
                      <code style={{ fontSize: 10.5, color: C.txt2 }}>{ruleId}</code>
                      <button type="button" style={{ ...btnS, marginLeft: 'auto', padding: '2px 7px', fontSize: 10.5 }}
                        onClick={() => wa.unmuteRule(ruleId)}>Unmute</button>
                    </Row>
                  ))}
                </>
              )}
            </div>
          )}

          {tab === 'dictionary' && (
            <div data-testid="stitch-manuscript-wa-dictionaries" style={{ marginTop: 8 }}>
              <form
                onSubmit={(e) => { e.preventDefault(); if (newTerm.trim()) { wa.addTerm('personal', newTerm.trim()); setNewTerm(''); } }}
                style={{ display: 'flex', gap: 6 }}
              >
                <input
                  value={newTerm}
                  onChange={(e) => setNewTerm(e.target.value)}
                  placeholder="Add a term…"
                  aria-label="Add a term to your personal dictionary"
                  data-testid="stitch-manuscript-wa-dict-input"
                  style={{
                    flex: 1, minWidth: 0, height: 26, padding: '0 8px', fontSize: 11.5,
                    border: `1px solid ${C.brd}`, borderRadius: 6, background: C.card2, color: C.txt,
                  }}
                />
                <button type="submit" style={{ ...btnS, padding: '3px 9px', fontSize: 11 }}
                  data-testid="stitch-manuscript-wa-dict-add">Add</button>
              </form>
              {wa.dictError && (
                <p data-testid="stitch-manuscript-wa-dict-error"
                  style={{ fontSize: 10.5, color: '#b42318', margin: '6px 0 0' }}>{wa.dictError}</p>
              )}

              <SectionLabel>Personal ({wa.personal.length})</SectionLabel>
              {!wa.personal.length && <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>No terms yet.</p>}
              {wa.personal.map((entry) => (
                <Row key={entry.id} className="ms-wa-row" style={{ padding: '2px 0' }}>
                  <span style={{ fontSize: 11.5, color: C.txt }}>{entry.term}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${entry.term} from your dictionary`}
                    data-testid={`stitch-manuscript-wa-dict-remove-${entry.term}`}
                    onClick={() => wa.removeTerm('personal', entry.id)}
                    style={{ ...btnS, marginLeft: 'auto', padding: '2px 7px', fontSize: 10.5 }}
                  >Remove</button>
                </Row>
              ))}

              <SectionLabel>Project ({wa.project.length})</SectionLabel>
              {!wa.projectCanEdit && (
                <p style={{ fontSize: 10.5, color: C.muted, margin: '0 0 4px' }}>
                  You can see the project list; adding to it needs edit access.
                </p>
              )}
              {!wa.project.length && <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>No shared terms yet.</p>}
              {wa.project.map((entry) => (
                <Row key={entry.id} className="ms-wa-row" style={{ padding: '2px 0' }}>
                  <span style={{ fontSize: 11.5, color: C.txt }}>{entry.term}</span>
                  <span style={{ fontSize: 10, color: C.muted }}>{entry.addedByName || ''}</span>
                  {wa.projectCanEdit && (
                    <button
                      type="button"
                      aria-label={`Remove ${entry.term} from the project dictionary`}
                      onClick={() => wa.removeTerm('project', entry.id)}
                      style={{ ...btnS, marginLeft: 'auto', padding: '2px 7px', fontSize: 10.5 }}
                    >Remove</button>
                  )}
                </Row>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default WritingAssistantControl;
