/**
 * SearchImportProgressModal.jsx — the centered, accessible progress experience for the
 * Automated Search → Add to Screening operation (87.md).
 *
 * It renders the REAL work happening behind the Pecan Search Engine run: an honest
 * 0→100% bar (never a timer — see research-engine/search/runProgress.js), a run-level
 * step list, a live "current activity" line, live counts, and a satisfying completion
 * state with "Go to Screening" / "Stay in Search". The heavy lifting is the durable
 * backend job that already fetches, de-duplicates, imports and finalises; this surface
 * only makes that transparent so the app never feels frozen.
 *
 * Accessibility: role=dialog + aria-modal, focus trap + restore, Escape MINIMISES
 * (never cancels), a throttled role=status live region announces phase transitions
 * (not every count), a real role=progressbar with aria-value*, reduced-motion aware.
 *
 * SSR-safe / testable: with no `document` it renders the dialog inline (no portal),
 * so it can be asserted with renderToStaticMarkup; in the browser it portals to
 * document.body with a blurred backdrop.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { C, btnS } from '../../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';
import { Icon } from '../../../frontend/components/icons.jsx';
import { StatTile, StatusPill, Note, Btn, Disclosure } from './parts.jsx';
import { computeRunProgress, providerLabel } from '../../../research-engine/search/runProgress.js';

/* Ported focus-trap (matches stitch/primitives/overlay.jsx) on the legacy palette:
   focus first control on open, wrap Tab, Escape→onClose (minimise), lock body scroll,
   restore focus to the trigger on close. */
function useFocusTrap(active, onClose) {
  const ref = useRef(null);
  const prevFocus = useRef(null);
  useEffect(() => {
    if (!active) return undefined;
    if (typeof document === 'undefined') return undefined;
    prevFocus.current = document.activeElement;
    const node = ref.current;
    const sel = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
    const focusFirst = () => {
      const f = node && node.querySelectorAll(sel);
      if (f && f.length) f[0].focus(); else if (node) node.focus();
    };
    const t = setTimeout(focusFirst, 0);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); if (onClose) onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from((node && node.querySelectorAll(sel)) || []).filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      try { if (prevFocus.current && prevFocus.current.focus) prevFocus.current.focus(); } catch { /* ignore */ }
    };
  }, [active, onClose]);
  return ref;
}

const SCOPED_CSS = `
@keyframes pv-indet { 0% { left: -42%; } 100% { left: 100%; } }
@keyframes pv-spin { to { transform: rotate(360deg); } }
@keyframes pv-scale-in { from { opacity: 0; transform: scale(0.97) translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes pv-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
.pv-scale-in { animation: pv-scale-in 0.18s cubic-bezier(0.22,1,0.36,1); }
.pv-spin { display: inline-block; animation: pv-spin 0.9s linear infinite; }
.pv-pulse { animation: pv-pulse 1.4s ease-in-out infinite; }
.pv-bar-fill { transition: width 0.5s cubic-bezier(0.22,1,0.36,1); }
.pv-indet-seg { animation: pv-indet 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .pv-scale-in, .pv-spin, .pv-pulse { animation: none !important; }
  .pv-bar-fill { transition: none !important; }
  .pv-indet-seg { animation: none !important; left: 0 !important; width: 100% !important; opacity: 0.5; }
}
`;

/* Per-step status → glyph + tone. Text glyph, never colour-only. */
function StepIcon({ status, dominant }) {
  if (status === 'done') return <Icon name="check" size={14} style={{ color: C.grn }} />;
  if (status === 'warning') return <Icon name="alertTriangle" size={14} style={{ color: C.yel }} />;
  if (status === 'failed') return <Icon name="x" size={14} style={{ color: C.red }} />;
  if (status === 'skipped') return <span aria-hidden="true" style={{ color: C.dim, fontSize: 14, lineHeight: 1 }}>–</span>;
  if (status === 'active') {
    if (dominant) return <span className="pv-spin" aria-hidden="true" style={{ color: C.acc, fontSize: 13, lineHeight: 1 }}>⟳</span>;
    return <span className="pv-pulse" aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: C.acc, display: 'inline-block' }} />;
  }
  return <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', border: `2px solid ${C.brd2}`, display: 'inline-block' }} />;
}

function StepRow({ step }) {
  const active = step.status === 'active';
  const done = step.status === 'done';
  const color = step.status === 'failed' ? C.red
    : step.status === 'warning' ? C.yel
      : done ? C.txt2 : active ? C.txt : C.muted;
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0' }}>
      <span style={{ width: 18, height: 18, marginTop: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <StepIcon status={step.status} dominant={step.dominant} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: active ? 700 : 600, color }}>{step.label}</span>
        {step.detail ? <span style={{ display: 'block', fontSize: 11, color: C.muted, marginTop: 1 }}>{step.detail}</span> : null}
      </span>
    </li>
  );
}

/* The honest overall bar. Determinate → role=progressbar + aria-value*; indeterminate
   → an animated segment with no aria-valuenow (assistive tech reads it as busy). */
function ProgressBar({ percent, indeterminate, tone }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const barColor = tone === 'green' ? C.grn : tone === 'yellow' ? C.yel : tone === 'red' ? C.red : C.acc;
  const common = { height: 8, borderRadius: 99, background: C.brd, position: 'relative', overflow: 'hidden', flex: 1 };
  if (indeterminate) {
    return (
      <div role="progressbar" aria-label="Overall progress" aria-valuetext="Working…" style={common}>
        <div className="pv-indet-seg" style={{ position: 'absolute', top: 0, bottom: 0, width: '42%', background: barColor, borderRadius: 99 }} />
      </div>
    );
  }
  return (
    <div role="progressbar" aria-label="Overall progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${pct}%`} style={common}>
      <div className="pv-bar-fill" style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 99 }} />
    </div>
  );
}

/* Completion summary bullets — exact numbers straight from the operation result. */
function CompletionSummary({ counts, state }) {
  const rows = [
    { label: 'records processed', value: counts.retrieved, always: true },
    { label: 'duplicates removed', value: counts.duplicates, show: counts.duplicates > 0 },
    { label: 'already in your project', value: counts.existing, show: counts.existing > 0 },
    { label: state === 'cancelled' ? 'records kept' : 'articles added to Screening', value: counts.imported, always: true, tone: 'green' },
    { label: 'to review as possible duplicates', value: counts.ambiguous, show: counts.ambiguous > 0, tone: 'yellow' },
    { label: 'records skipped (missing required information)', value: counts.failed, show: counts.failed > 0, tone: 'red' },
  ].filter((r) => r.always || r.show);
  return (
    <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r) => (
        <li key={r.label} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5, color: C.txt2 }}>
          <strong style={{ fontVariantNumeric: 'tabular-nums', minWidth: 56, textAlign: 'right', color: r.tone === 'green' ? C.grn : r.tone === 'red' ? C.red : r.tone === 'yellow' ? C.yel : C.txt, fontFamily: "'IBM Plex Mono',monospace" }}>{Number(r.value || 0).toLocaleString()}</strong>
          <span>{r.label}</span>
        </li>
      ))}
    </ul>
  );
}

export default function SearchImportProgressModal({
  open,
  run,
  starting = false,
  startError = '',
  displayPercent,        // monotonic-clamped % from the parent; falls back to model.percent
  onClose,               // minimise (job keeps running)
  onCancel,              // cancel the run (null → not offered)
  onRetry,               // retry failed sources (null → not offered)
  screeningHref = '',    // href for "Go to Screening"
  onGoToScreening,       // optional click handler alongside the href (e.g. close first)
  readOnly = false,
}) {
  const trapRef = useFocusTrap(open, onClose);
  const titleId = useId();
  const descId = useId();
  // Non-blocking inline confirmation for Cancel (no window.confirm — that would freeze
  // the extension/page and is an alarming interruption).
  const [confirming, setConfirming] = useState(false);
  if (!open) return null;

  // Optimistic pre-run stub so the modal opens INSTANTLY on click, before the 202 lands.
  const effectiveRun = run || { state: 'queued', sources: [] };
  const model = computeRunProgress(effectiveRun);
  const terminal = model.terminal && !starting;
  const fatalStart = !!startError && !run;

  const pct = typeof displayPercent === 'number' ? displayPercent : model.percent;
  const tone = terminal
    ? (model.state === 'completed' ? 'green' : model.state === 'failed' ? 'red' : 'yellow')
    : 'accent';
  const indeterminate = (starting && !run) || model.indeterminate;

  // Announce only major transitions to screen readers (phase label / terminal), never
  // the per-count activity line — see 87.md accessibility requirement.
  const announce = fatalStart ? 'The search could not be started'
    : terminal ? model.phaseLabel
      : starting ? 'Preparing your search' : model.phaseLabel;

  const cancelling = effectiveRun && effectiveRun.cancelRequested && !terminal;
  const canCancel = !!onCancel && !readOnly && !terminal && !starting && !fatalStart && !cancelling;
  const showGoToScreening = terminal && (model.state === 'completed' || model.state === 'partial' || model.state === 'cancelled') && (model.counts.imported > 0 || model.counts.existing > 0);
  const showRetry = !!onRetry && (model.state === 'failed' || model.state === 'partial') && !fatalStart;

  const headTitle = fatalStart ? 'Could not start the search'
    : terminal
      ? (model.state === 'completed' ? 'Articles added to Screening'
        : model.state === 'partial' ? 'Added, with some databases incomplete'
          : model.state === 'cancelled' ? 'Search cancelled'
            : 'The search did not complete')
      : 'Adding articles to Screening';
  const headIcon = fatalStart ? 'alertOctagon'
    : terminal
      ? (model.state === 'completed' ? 'circleCheck' : model.state === 'failed' ? 'alertOctagon' : model.state === 'cancelled' ? 'clock' : 'alertTriangle')
      : 'activity';
  const iconColor = fatalStart || model.state === 'failed' ? C.red
    : terminal && model.state === 'completed' ? C.grn
      : terminal ? C.yel : C.acc;

  const closeLabel = terminal || fatalStart ? 'Close' : 'Run in background';

  const dialog = (
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabIndex={-1}
      data-testid="search-import-progress"
      data-run-state={effectiveRun.state}
      className="pv-scale-in"
      style={{
        width: '100%', maxWidth: 540, maxHeight: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column',
        background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 14, boxShadow: '0 24px 80px var(--t-shadow)',
        overflow: 'hidden', fontFamily: 'inherit',
      }}
    >
      <style>{SCOPED_CSS}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '18px 22px 14px' }}>
        <div aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, color: iconColor, background: themeAlpha(iconColor, '16'), border: `1px solid ${themeAlpha(iconColor, '30')}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={headIcon} size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id={titleId} style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.txt, letterSpacing: -0.2 }}>{headTitle}</h2>
          <p id={descId} style={{ margin: '3px 0 0', fontSize: 12, color: C.muted, lineHeight: 1.55 }}>
            {fatalStart
              ? 'No records were created. You can safely try again.'
              : terminal
                ? 'Here is exactly what was added to your screening dataset.'
                : 'Your search results are being fetched, checked for duplicates, and added to your screening dataset.'}
          </p>
        </div>
        <button
          type="button" onClick={onClose} aria-label={terminal || fatalStart ? 'Close' : 'Run in the background'}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.muted, display: 'inline-flex', padding: 4, borderRadius: 6, flexShrink: 0 }}
        >
          <Icon name="x" size={18} />
        </button>
      </div>

      {/* Visually-hidden live region: major transitions only (not per-count noise). */}
      <span role="status" aria-live="polite" style={SR_ONLY}>{announce}.</span>

      {/* Scrollable body */}
      <div style={{ padding: '0 22px', overflowY: 'auto', flex: 1 }}>
        {fatalStart ? (
          <Note tone="error" role="alert">{startError}</Note>
        ) : (
          <>
            {/* Overall progress bar */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ProgressBar percent={pct} indeterminate={indeterminate} tone={tone} />
                <span aria-hidden="true" style={{ fontSize: 13, fontWeight: 700, color: C.txt2, minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {indeterminate ? '…' : `${Math.round(pct)}%`}
                </span>
              </div>
              {/* Current activity — visible, NOT a live region (updates too often to announce). */}
              <div data-testid="progress-activity" style={{ marginTop: 8, fontSize: 12.5, color: C.txt2, lineHeight: 1.5, minHeight: 18 }}>
                {model.activityText}
              </div>
            </div>

            {/* Live counts */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(96px,1fr))', gap: 8, marginBottom: 14 }}>
              <StatTile label="Retrieved" value={model.counts.retrieved.toLocaleString()} />
              <StatTile label={terminal ? 'Added' : 'Imported'} value={model.counts.imported.toLocaleString()} tone="green" />
              <StatTile label="Duplicates" value={model.counts.duplicates.toLocaleString()} />
              {model.counts.ambiguous > 0 && <StatTile label="To review" value={model.counts.ambiguous.toLocaleString()} tone="yellow" />}
              {model.counts.failed > 0 && <StatTile label="Skipped" value={model.counts.failed.toLocaleString()} tone="red" />}
            </div>

            {/* Step list */}
            <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0 6px', borderTop: `1px solid ${C.brd}` }}>
              {model.steps.map((s) => <StepRow key={s.id} step={s} />)}
            </ul>

            {/* Terminal summary + guidance */}
            {terminal && (
              <div style={{ marginTop: 6, paddingTop: 12, borderTop: `1px solid ${C.brd}` }}>
                <CompletionSummary counts={model.counts} state={model.state} />
                {model.state === 'partial' && <div style={{ marginTop: 10 }}><Note tone="warn">Some databases did not finish. Every count above is exact for the ones that completed — you can retry the rest without creating duplicates.</Note></div>}
                {model.state === 'failed' && <div style={{ marginTop: 10 }}><Note tone="error" role="alert">{effectiveRun.errorSummary || 'The search failed before any records were added.'} You can safely try again.</Note></div>}
                {model.counts.ambiguous > 0 && model.state !== 'failed' && <div style={{ marginTop: 10 }}><Note tone="info">Resolve the {model.counts.ambiguous.toLocaleString()} possible duplicate{model.counts.ambiguous === 1 ? '' : 's'} in duplicate review before you begin title/abstract screening.</Note></div>}
              </div>
            )}

            {/* Per-source detail (progressive disclosure; default collapsed) */}
            {model.sources.length > 0 && (
              <div style={{ marginTop: 10, marginBottom: 6 }}>
                <Disclosure summary="View processing details" defaultOpen={false}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                      <thead>
                        <tr>
                          {['Database', 'Retrieved', 'Added', 'Dup', 'Status'].map((h, i) => (
                            <th key={h} scope="col" style={{ textAlign: i === 0 || i === 4 ? 'left' : 'right', padding: '5px 8px', color: C.muted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${C.brd}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {model.sources.map((s) => (
                          <tr key={s.provider}>
                            <td style={{ padding: '5px 8px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{providerLabel(s.provider)}</td>
                            <td style={cellR}>{s.retrieved.toLocaleString()}{s.expected != null ? <span style={{ color: C.dim }}> / {s.expected.toLocaleString()}</span> : ''}</td>
                            <td style={cellR}>{s.imported.toLocaleString()}</td>
                            <td style={cellR}>{s.duplicates.toLocaleString()}</td>
                            <td style={{ padding: '5px 8px', borderBottom: `1px solid ${C.brd}` }}><StatusPill state={s.state} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Disclosure>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 22px', borderTop: `1px solid ${C.brd}`, background: C.card, flexWrap: 'wrap' }}>
        {confirming && canCancel ? (
          <>
            <span style={{ fontSize: 12, color: C.txt2, flex: 1, minWidth: 180 }}>
              Cancel this search? Records already saved will be kept.
            </span>
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <Btn variant="ghost" onClick={() => setConfirming(false)}>Keep running</Btn>
              <Btn variant="danger" onClick={() => { setConfirming(false); if (onCancel) onCancel(); }}>Yes, cancel</Btn>
            </div>
          </>
        ) : (
          <>
            {!terminal && !fatalStart && (
              <span style={{ fontSize: 11, color: C.muted, flex: 1, minWidth: 160 }}>
                {cancelling ? 'Cancelling — finishing the current page safely…' : 'This continues in the background if you close it.'}
              </span>
            )}
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
              {canCancel && (
                <Btn variant="ghost" onClick={() => setConfirming(true)} style={{ color: C.red, borderColor: themeAlpha(C.red, '40') }}>Cancel search</Btn>
              )}
              {showRetry && <Btn variant="ghost" onClick={onRetry}><Icon name="refresh" size={13} /> Retry</Btn>}
              <Btn variant={showGoToScreening ? 'ghost' : 'primary'} onClick={onClose}>
                {showGoToScreening ? 'Stay in Search' : closeLabel}
              </Btn>
              {showGoToScreening && (
                <a
                  href={screeningHref || '#'} onClick={onGoToScreening}
                  style={{ ...btnS('primary'), textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Icon name="arrowRight" size={13} /> Go to Screening
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  // SSR (no document) → render the dialog inline so it can be statically asserted.
  if (typeof document === 'undefined') return dialog;

  return createPortal(
    <div
      data-testid="search-import-progress-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2147482100, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, background: themeAlpha(C.bg, '99'), backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      {dialog}
    </div>,
    document.body,
  );
}

const SR_ONLY = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 };
const cellR = { padding: '5px 8px', textAlign: 'right', color: C.txt2, fontFamily: "'IBM Plex Mono',monospace", borderBottom: `1px solid ${C.brd}` };
