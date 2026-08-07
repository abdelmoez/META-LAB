/**
 * features/manuscript/ManualFieldsPanel.jsx — 102.md §2/§4/§5/§6.
 *
 * The "N manual fields remaining" indicator, its prev/next controls, and the
 * expandable list that says WHICH section each unresolved field is in.
 *
 * Design intent (§81): a researcher should open the editor and immediately know
 * whether anything still needs them, then step through every field without hunting
 * — "similar to moving through fields in a professionally designed form". So the
 * counter is always visible when anything is outstanding, and disappears entirely
 * when nothing is, rather than sitting there saying "0".
 *
 * The two kinds are never merged. A 'manual' field is the researcher's to write; a
 * 'pending' one is waiting on the project (a search that has not run, an analysis
 * with no data yet). Counting them together would tell a researcher they have work
 * to do that typing cannot finish — and inviting them to type into one would invite
 * fabricated methodology (101.md §17).
 */
import { useState } from 'react';
import { C, btnS } from '../../frontend/workspace/ui/styles.js';
// 102.md follow-up — a 'pending' field must say WHERE it gets resolved. Leaving a
// researcher with "awaiting project data" and no destination invites the one action
// that must not happen: typing over it (101.md §17).
import { resolutionHint } from '../../research-engine/manuscript/placeholders.js';

const KIND_TEXT = {
  manual: { label: 'Manual input required', hint: 'You write this.' },
  pending: {
    label: 'Awaiting project data',
    hint: 'Fills in automatically once the project step is done — do not type over it.',
  },
};

/**
 * "Awaiting Search Engine — Run or import a database search…"
 *
 * Keeps the "awaiting" framing (so the row still reads as not-yours-to-write) AND
 * names the destination, rather than trading one for the other.
 */
function resolveText(p) {
  const h = resolutionHint(p);
  if (!h) return KIND_TEXT.pending.label;
  return h.engineLabel ? `Awaiting ${h.engineLabel} — ${h.action}` : `Awaiting project data — ${h.action}`;
}

function KindDot({ kind }) {
  const pending = kind === 'pending';
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block', width: 7, height: 7, borderRadius: 2, flexShrink: 0,
        background: pending ? '#2b7aa3' : '#d69e2e',
        // Shape differs too — §4's styling must not depend on colour alone.
        transform: pending ? 'rotate(45deg)' : 'none',
      }}
    />
  );
}

/**
 * The compact indicator. Renders nothing when the manuscript is complete, which is
 * itself the signal §83 wants ("immediately know whether anything still requires
 * their input").
 */
export function ManualFieldsBadge({ stats, onNext, onOpen, expanded }) {
  const manual = (stats && stats.manual) || 0;
  const pending = (stats && stats.pending) || 0;
  if (!manual && !pending) return null;
  return (
    <div
      data-testid="stitch-manuscript-manual-fields-badge"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
    >
      <button
        type="button"
        onClick={onNext}
        disabled={!manual}
        title={manual ? 'Go to the next field that needs your input' : 'No manual fields remain'}
        data-testid="stitch-manuscript-manual-fields-count"
        style={{
          ...btnS('ghost'), display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 10px', fontSize: 11.5, borderRadius: 99,
          border: `1px solid ${manual ? 'rgba(214,158,46,0.55)' : C.brd}`,
          background: manual ? 'rgba(214,158,46,0.12)' : 'transparent',
          color: manual ? '#8a5a00' : C.txt2,
          cursor: manual ? 'pointer' : 'default',
        }}
      >
        <KindDot kind="manual" />
        {manual > 0
          ? `${manual} manual field${manual === 1 ? '' : 's'} remaining`
          : 'No manual fields remaining'}
      </button>

      {pending > 0 && (
        <span
          title={KIND_TEXT.pending.hint}
          data-testid="stitch-manuscript-pending-fields-count"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px',
            fontSize: 11.5, borderRadius: 99, border: '1px solid rgba(43,122,163,0.45)',
            background: 'rgba(43,122,163,0.10)', color: '#1f5673', whiteSpace: 'nowrap',
          }}
        >
          <KindDot kind="pending" />
          {pending} awaiting project data
        </span>
      )}

      <button
        type="button"
        onClick={onOpen}
        aria-expanded={!!expanded}
        title={expanded ? 'Hide the list of outstanding fields' : 'List every outstanding field'}
        aria-label={expanded ? 'Hide outstanding fields' : 'Show outstanding fields'}
        data-testid="stitch-manuscript-manual-fields-toggle"
        style={{
          ...btnS('ghost'), padding: '3px 7px', fontSize: 11, color: C.txt2,
          border: `1px solid ${C.brd}`, background: 'transparent', borderRadius: 7,
        }}
      >
        {expanded ? 'Hide' : 'List'}
      </button>
    </div>
  );
}

/** Prev / next controls (§2), with their keyboard shortcuts advertised in the title. */
export function ManualFieldsNav({ stats, onPrev, onNext }) {
  const manual = (stats && stats.manual) || 0;
  if (!manual) return null;
  const btn = {
    ...btnS('ghost'), padding: '3px 8px', fontSize: 11, color: C.txt2,
    border: `1px solid ${C.brd}`, background: 'transparent', borderRadius: 7,
  };
  return (
    <div role="group" aria-label="Move between manual fields" style={{ display: 'inline-flex', gap: 4 }}>
      <button type="button" onClick={onPrev} style={btn}
        title="Previous manual field (Ctrl+Shift+Enter)"
        aria-label="Previous manual field"
        data-testid="stitch-manuscript-manual-prev">‹ Prev</button>
      <button type="button" onClick={onNext} style={btn}
        title="Next manual field (Ctrl+Enter)"
        aria-label="Next manual field"
        data-testid="stitch-manuscript-manual-next">Next ›</button>
    </div>
  );
}

/**
 * The expandable list. §53: "The user should be able to see which manuscript
 * section contains each unresolved field" — so it is grouped by section, and every
 * row navigates straight to the field.
 */
export function ManualFieldsList({ groups, currentId, onGo }) {
  const list = Array.isArray(groups) ? groups : [];
  if (!list.length) return null;
  return (
    <div
      data-testid="stitch-manuscript-manual-fields-list"
      style={{
        marginTop: 8, border: `1px solid ${C.brd}`, borderRadius: 10,
        background: C.card, padding: 8, maxHeight: 260, overflowY: 'auto',
      }}
    >
      {list.map((g) => (
        <div key={g.sectionId} style={{ marginBottom: 8 }}>
          <div style={{
            fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
            color: C.muted, fontWeight: 700, marginBottom: 4,
          }}>
            {g.sectionLabel}
            <span style={{ marginLeft: 6, fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>
              {g.manual > 0 ? `${g.manual} to write` : ''}
              {g.manual > 0 && g.pending > 0 ? ' · ' : ''}
              {g.pending > 0 ? `${g.pending} awaiting data` : ''}
            </span>
          </div>
          {g.items.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onGo && onGo(p)}
              aria-current={p.id === currentId ? 'true' : undefined}
              title={KIND_TEXT[p.kind].hint}
              data-testid={`stitch-manuscript-manual-field-${p.id}`}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 7, width: '100%',
                textAlign: 'left', padding: '5px 7px', marginBottom: 2,
                border: `1px solid ${p.id === currentId ? 'rgba(214,158,46,0.55)' : 'transparent'}`,
                background: p.id === currentId ? 'rgba(214,158,46,0.12)' : 'transparent',
                borderRadius: 7, cursor: 'pointer', fontSize: 11.5,
                color: p.kind === 'pending' ? C.txt2 : C.txt,
                fontFamily: "'IBM Plex Sans', sans-serif", lineHeight: 1.45,
              }}
            >
              <span style={{ paddingTop: 4 }}><KindDot kind={p.kind} /></span>
              <span style={{ minWidth: 0 }}>
                {p.label}
                <span style={{ display: 'block', fontSize: 10, color: C.muted }}>
                  {p.kind === 'pending'
                    ? resolveText(p)
                    : KIND_TEXT[p.kind].label}
                </span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Badge + nav + list, as one self-contained block for the editor chrome. */
export function ManualFieldsPanel({ stats, groups, currentId, onPrev, onNext, onGo }) {
  const [open, setOpen] = useState(false);
  const manual = (stats && stats.manual) || 0;
  const pending = (stats && stats.pending) || 0;
  if (!manual && !pending) return null;
  return (
    <div data-testid="stitch-manuscript-manual-fields">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <ManualFieldsBadge
          stats={stats}
          onNext={onNext}
          onOpen={() => setOpen((v) => !v)}
          expanded={open}
        />
        <ManualFieldsNav stats={stats} onPrev={onPrev} onNext={onNext} />
      </div>
      {open && <ManualFieldsList groups={groups} currentId={currentId} onGo={onGo} />}
    </div>
  );
}

export default ManualFieldsPanel;
