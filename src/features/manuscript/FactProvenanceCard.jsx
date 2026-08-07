/**
 * features/manuscript/FactProvenanceCard.jsx — 101.md §9/§10/§12/§35. The card a
 * researcher gets when they hover or click a changed value with Show Changes on.
 *
 * It answers exactly one question, the one §12 says the platform must always be able
 * to answer: "why does the manuscript currently say this?" So it renders the six §9
 * fields verbatim — Updated by / Changed / Reason / Previous value / Current value /
 * Affected manuscript field — and nothing that only a database would care about.
 * §9 is explicit that internal technical information with no researcher value stays
 * out: event ids, correlation ids and fact keys are carried in props for navigation
 * but never printed.
 *
 * §10 is the delicate part. "Restore previous wording" changes the MANUSCRIPT only —
 * it must never look like it edited the research record, because it did not. So the
 * card says so, in words, before the researcher clicks: the project still holds the
 * newer value, and the divergence stays visible afterwards (factDiscrepancies).
 * Reverting the underlying project event is a different act, in a different place.
 *
 * Presentational: every datum arrives as a prop, the component owns no state and no
 * business logic (the view model comes from describeChange() in the pure engine).
 * §35 — works on click as well as hover, is fully keyboard reachable, has a visible
 * focus ring, closes on Escape, and never uses colour as the only signal.
 */
import { C, btnS } from '../../frontend/workspace/ui/styles.js';
import { alpha } from '../../frontend/theme/tokens.js';
import { describeChange } from '../../research-engine/manuscript/factProvenance.js';
import { engineStyle, formatChangeDate, SHOW_CHANGES_CSS } from './showChanges.js';

/** The small engine badge: colour + glyph + label, so colour is never alone (§7). */
export function EngineBadge({ engine, size = 'sm', title }) {
  const e = engineStyle(engine);
  const small = size === 'sm';
  return (
    <span
      title={title || e.label}
      data-testid={`stitch-manuscript-engine-badge-${e.id}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
        padding: small ? '1px 7px' : '2px 9px', borderRadius: 99,
        fontSize: small ? 9.5 : 10.5, fontWeight: 700, letterSpacing: 0.3,
        color: e.cssVar,
        border: `1px solid color-mix(in srgb, ${e.cssVar} 40%, transparent)`,
        background: `color-mix(in srgb, ${e.cssVar} 12%, transparent)`,
      }}>
      <span aria-hidden="true" style={{ fontSize: small ? 9 : 10, lineHeight: 1 }}>{e.glyph}</span>
      {e.short}
    </span>
  );
}

function Field({ label, children, testId, mono }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '3px 0' }}>
      <span style={{
        flex: '0 0 118px', fontSize: 9.5, fontWeight: 700, color: C.muted,
        letterSpacing: 0.5, textTransform: 'uppercase', lineHeight: 1.7,
      }}>
        {label}
      </span>
      <span data-testid={testId} style={{
        flex: 1, minWidth: 0, fontSize: 11.5, color: C.txt, lineHeight: 1.6,
        overflowWrap: 'anywhere', ...(mono ? { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" } : {}),
      }}>
        {children}
      </span>
    </div>
  );
}

/** Em dash rather than an empty cell — an unknown field must read as unknown (§17). */
const orDash = (s) => (s == null || s === '' ? '—' : s);

/**
 * @param {object}   props
 * @param {object}   props.change    a factProvenance change ({key,label,engine,from,to,at,reason,…}).
 *                                   Absent → the card explains the fact without claiming a history (§38).
 * @param {object}   props.fact      the resolved fact (resolveFacts() entry) this span renders.
 * @param {string[]} props.sections  human labels of the manuscript sections this value feeds (§9).
 * @param {Function} props.onRevert  (change) => void — §10 "Restore previous wording" (manuscript only).
 * @param {Function} props.onKeep    (change) => void — §10 "Keep current wording".
 * @param {Function} [props.onClose] optional dismiss handler (Escape / close button).
 */
export function FactProvenanceCard({ change, fact, sections, onRevert, onKeep, onClose }) {
  const c = change || null;
  const f = fact || null;
  const view = c ? describeChange(c, { sections }) : null;
  const engine = engineStyle((c && c.engine) || (f && f.engine));
  const field = (view && view.field) || (f && f.label) || (c && c.key) || 'Project value';
  const sectionList = Array.isArray(sections) ? sections.filter(Boolean) : [];
  const current = view ? view.currentValue : (f && !f.missing ? f.value : '');
  const reverted = !!(c && c.reverted);

  return (
    <div
      role="group"
      aria-label={`Provenance for ${field}`}
      data-testid="stitch-manuscript-fact-provenance"
      onKeyDown={(e) => { if (e.key === 'Escape' && onClose) { e.stopPropagation(); onClose(); } }}
      style={{
        width: 340, maxWidth: '100%', boxSizing: 'border-box',
        background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 14,
        boxShadow: `0 10px 30px ${alpha(C.acc, '14')}, 0 1px 2px ${C.brd}`,
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}>
      {/* the overlay's engine ink tokens — idempotent, so it is safe to inject here
          as well as inside the editor page */}
      <style>{SHOW_CHANGES_CSS}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <EngineBadge engine={engine.id} size="md" />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.txt, minWidth: 0, flex: 1 }}>{field}</span>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close provenance details"
            data-testid="stitch-manuscript-fact-provenance-close"
            style={{ ...btnS('ghost'), padding: '2px 7px', fontSize: 12, border: 'none', background: 'transparent', color: C.muted }}>
            ✕
          </button>
        )}
      </div>

      {/* ── the six §9 fields, in the order the brief lists them ── */}
      <Field label="Updated by" testId="stitch-manuscript-fact-updated-by">
        {orDash(view ? view.updatedBy : engine.label)}
        {view && view.actorName ? <span style={{ color: C.muted }}>{` · ${view.actorName}`}</span> : null}
      </Field>
      <Field label="Changed" testId="stitch-manuscript-fact-changed-at">
        {orDash(view ? formatChangeDate(view.changedAt) : '')}
      </Field>
      <Field label="Reason" testId="stitch-manuscript-fact-reason">
        {view
          ? orDash(view.reason || `${engine.label} recorded a change to this value.`)
          : 'No automatic updates recorded for this value yet.'}
      </Field>
      <Field label="Previous value" testId="stitch-manuscript-fact-previous" mono>
        <span style={{ textDecoration: view && view.previousValue ? 'line-through' : 'none', color: C.muted }}>
          {orDash(view ? view.previousValue : '')}
        </span>
      </Field>
      <Field label="Current value" testId="stitch-manuscript-fact-current" mono>
        {orDash(current)}
      </Field>
      <Field label="Affected manuscript field" testId="stitch-manuscript-fact-sections">
        {sectionList.length ? sectionList.join(' · ') : field}
      </Field>

      {/* §17 — a value the project cannot answer says so, and says what to do. */}
      {f && f.missing && (
        <p data-testid="stitch-manuscript-fact-missing" style={{
          margin: '10px 0 0', padding: '7px 9px', borderRadius: 8, fontSize: 11, lineHeight: 1.6,
          color: C.txt2, background: alpha(C.yel, '12'), border: `1px solid ${alpha(C.yel, '30')}`,
        }}>
          <strong style={{ color: C.yel }}>Not yet available. </strong>
          {f.hint || 'This value appears in the manuscript as a placeholder until your project can answer it.'}
        </p>
      )}

      {/* ── §10 actions ── */}
      {view && !reverted && (onRevert || onKeep) && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.brd}`, paddingTop: 10 }}>
          <p style={{ margin: '0 0 8px', fontSize: 10.5, lineHeight: 1.6, color: C.muted }}>
            {/* §10 — say plainly which history is being touched, BEFORE the click. */}
            Restoring the previous wording changes the manuscript only. Your project record keeps
            the current value, and the difference stays flagged until you resolve it.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {onRevert && (
              <button type="button" onClick={() => onRevert(c)}
                data-testid="stitch-manuscript-fact-restore"
                title="Pin the earlier wording in the manuscript. The project record is not changed."
                style={{ ...btnS('ghost'), fontSize: 11, padding: '6px 12px' }}>
                Restore previous wording
              </button>
            )}
            {onKeep && (
              <button type="button" onClick={() => onKeep(c)}
                data-testid="stitch-manuscript-fact-keep"
                title="Keep the value the project data produced."
                style={{ ...btnS('primary'), fontSize: 11, padding: '6px 12px' }}>
                Keep current wording
              </button>
            )}
          </div>
        </div>
      )}

      {reverted && (
        <p data-testid="stitch-manuscript-fact-reverted" style={{
          margin: '10px 0 0', fontSize: 10.5, lineHeight: 1.6, color: C.muted,
        }}>
          {/* §12 — a revert is itself part of the record, never a deletion of it. */}
          This update was reverted in the manuscript. It stays in the project history.
        </p>
      )}
    </div>
  );
}

export default FactProvenanceCard;
