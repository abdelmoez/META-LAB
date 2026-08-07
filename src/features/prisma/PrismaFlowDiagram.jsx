/**
 * features/prisma/PrismaFlowDiagram.jsx — 103.md §12/§21.
 *
 * "Simple on the surface, extremely rigorous underneath."
 *
 * The default view is a clean PRISMA 2020 diagram and nothing else. Every count is
 * ALSO a button: clicking one opens a panel naming exactly which records produced
 * it, which is what turns the flow from a set of numbers into something auditable.
 *
 * The diagram itself is the pure `buildPrismaFlowSVG` string — the SAME builder the
 * export uses, so what a researcher inspects on screen and what lands in the
 * manuscript are the same drawing from the same numbers (§16). This component adds
 * only hit-targets on top of it; it never recomputes anything.
 */
import { useMemo, useState } from 'react';
import { C, btnS } from '../../frontend/workspace/ui/styles.js';
import {
  buildPrismaFlowSVG, boxMeta, DISPOSITION_LABELS,
} from '../../research-engine/prisma/index.js';

/* ════════════ the §12 inspection panel ════════════ */

/**
 * What a click reveals. Deliberately answers the question §11 poses — "which
 * records created this number?" — rather than dumping database internals (§21
 * warns against exactly that).
 */
export function PrismaInspector({ boxId, flow, records, onClose }) {
  const meta = boxMeta(boxId);
  const box = flow && flow.boxes && flow.boxes[boxId];
  const rows = useMemo(() => {
    if (!box) return [];
    const want = new Set(box.ids);
    return (records || []).filter((r) => r && want.has(r.id));
  }, [box, records]);

  if (!box) return null;

  // Breakdowns worth showing for the boxes that have one (§12's worked example is
  // "Duplicate records removed: 742" → where those 742 came from).
  const breakdown = boxId === 'removed_before_screening'
    ? (flow.removedBreakdown && flow.removedBreakdown.byStage) || []
    : boxId === 'excluded_full_text_db' ? (flow.exclusionReasonsByArm && flow.exclusionReasonsByArm.db) || []
      : boxId === 'excluded_full_text_other' ? (flow.exclusionReasonsByArm && flow.exclusionReasonsByArm.other) || []
        : boxId === 'not_retrieved_db' || boxId === 'not_retrieved_other' ? flow.notRetrievedReasons || []
          : boxId === 'identified_db' ? (flow.sources && flow.sources.db) || []
            : boxId === 'identified_other' ? (flow.sources && flow.sources.other) || []
              : [];

  // The count can legitimately exceed the inspectable records: import-time
  // duplicates are discarded before they become records, so they are counted but
  // have no ids. Say so rather than letting the lists look inconsistent.
  const uninspectable = Math.max(0, box.n - box.ids.length);

  return (
    <div
      data-testid="stitch-prisma-inspector"
      role="dialog"
      aria-label={`Records behind ${meta ? meta.label : boxId}`}
      style={{
        border: `1px solid ${C.brd}`, borderRadius: 12, background: C.card,
        padding: 14, marginTop: 12, fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.txt }}>
            {meta ? meta.label.replace(/[*:]+$/, '') : boxId}
            <span style={{ marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace", color: C.txt2 }}>
              n = {box.n}
            </span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {meta ? `Counts ${meta.unit}.` : ''} Every number here is the size of a record set —
            this is that set.
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close"
          data-testid="stitch-prisma-inspector-close"
          style={{ ...btnS('ghost'), padding: '3px 9px', fontSize: 11, border: `1px solid ${C.brd}` }}>
          Close
        </button>
      </div>

      {breakdown.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{
            fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
            color: C.muted, fontWeight: 700, marginBottom: 4,
          }}>
            Breakdown
          </div>
          {breakdown.map((r) => (
            <div key={r.key} style={{
              display: 'flex', justifyContent: 'space-between', gap: 10,
              fontSize: 12, padding: '3px 0', borderBottom: `1px solid ${C.brd}`,
            }}>
              <span style={{ color: C.txt2, minWidth: 0 }}>{r.label}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.txt }}>{r.n}</span>
            </div>
          ))}
        </div>
      )}

      {uninspectable > 0 && (
        <div style={{
          fontSize: 11, color: C.txt2, background: 'rgba(214,158,46,0.10)',
          border: '1px solid rgba(214,158,46,0.4)', borderRadius: 8, padding: '7px 9px', marginBottom: 10,
        }}>
          {uninspectable} of these were discarded during import before being stored as
          records, so they are counted but cannot be listed individually.
        </div>
      )}

      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: C.muted }}>
            {box.ids.length === 0
              ? 'No individual records to list for this box.'
              : 'Record details are not loaded.'}
          </div>
        ) : rows.slice(0, 200).map((r) => (
          <div key={r.id} style={{
            fontSize: 11.5, padding: '5px 0', borderBottom: `1px solid ${C.brd}`, color: C.txt,
          }}>
            <div style={{ fontWeight: 600 }}>{r.title || r.id}</div>
            <div style={{ color: C.muted, fontSize: 10.5 }}>
              {[r.year, r.journal, r.sourceDb].filter(Boolean).join(' · ')}
              {r._disposition ? ` · ${DISPOSITION_LABELS[r._disposition] || r._disposition}` : ''}
            </div>
          </div>
        ))}
        {rows.length > 200 && (
          <div style={{ fontSize: 11, color: C.muted, paddingTop: 6 }}>
            Showing the first 200 of {rows.length}.
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════ reconciliation status (§13) ════════════ */

/** Never silently display an inconsistent flow. */
export function PrismaValidationBanner({ reconciliation }) {
  if (!reconciliation) return null;
  const errors = (reconciliation.issues || []).filter((i) => i.severity === 'error');
  const warnings = (reconciliation.issues || []).filter((i) => i.severity === 'warning');
  if (!errors.length && !warnings.length) {
    return (
      <div data-testid="stitch-prisma-validation" style={{
        fontSize: 11.5, color: '#1e7a46', background: 'rgba(30,122,70,0.08)',
        border: '1px solid rgba(30,122,70,0.35)', borderRadius: 8, padding: '6px 10px',
      }}>
        ✓ Flow reconciles — every PRISMA identity checks out.
      </div>
    );
  }
  const bad = errors.length > 0;
  return (
    <div data-testid="stitch-prisma-validation" role={bad ? 'alert' : undefined} style={{
      fontSize: 11.5,
      color: bad ? '#8a1c1c' : '#8a5a00',
      background: bad ? 'rgba(138,28,28,0.08)' : 'rgba(214,158,46,0.10)',
      border: `1px solid ${bad ? 'rgba(138,28,28,0.4)' : 'rgba(214,158,46,0.45)'}`,
      borderRadius: 8, padding: '7px 10px',
    }}>
      <strong>{bad ? 'This flow does not reconcile' : 'Worth checking before submission'}</strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {[...errors, ...warnings].slice(0, 4).map((i) => <li key={i.id}>{i.message}</li>)}
      </ul>
    </div>
  );
}

/* ════════════ the diagram ════════════ */

/**
 * The PRISMA 2020 diagram with clickable counts.
 *
 * @param {object} flow          derivePrismaFlow() output
 * @param {object} reconciliation reconcilePrismaFlow() output
 * @param {Array}  records       optional record projections, for the inspector list
 * @param {boolean} interactive  false → a plain, non-clickable diagram (export preview)
 */
export function PrismaFlowDiagram({
  flow, reconciliation, records, title = '', interactive = true, perSource = true, updated = false,
}) {
  const [openBox, setOpenBox] = useState(null);

  const built = useMemo(
    () => (flow ? buildPrismaFlowSVG(flow, { title, perSource, updated }) : null),
    [flow, title, perSource, updated],
  );

  if (!flow || !built) {
    return (
      <div data-testid="stitch-prisma-empty" style={{ fontSize: 12, color: C.muted, padding: 12 }}>
        No records have been identified yet — the flow will populate as searches run and
        results are imported.
      </div>
    );
  }

  return (
    <div data-testid="stitch-prisma-flow">
      <PrismaValidationBanner reconciliation={reconciliation} />

      <div style={{ position: 'relative', overflowX: 'auto', marginTop: 10 }}>
        {/* The diagram is the pure builder's own string — identical to the export. */}
        <div
          data-testid="stitch-prisma-svg"
          style={{ minWidth: built.W }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: built.svg }}
        />

        {/* Hit-targets positioned from the builder's returned geometry, so the
            clickable areas can never drift from the drawing. */}
        {interactive && (
          <div style={{
            position: 'absolute', inset: 0, width: built.W, height: built.H, pointerEvents: 'none',
          }}>
            {built.boxes.map((bx) => {
              const meta = boxMeta(bx.id);
              const count = (flow.boxes[bx.id] || {}).n;
              return (
                <button
                  key={bx.id}
                  type="button"
                  onClick={() => setOpenBox(bx.id === openBox ? null : bx.id)}
                  aria-label={`Inspect ${meta ? meta.label.replace(/[*:]+$/, '') : bx.id} — ${count} ${meta ? meta.unit : 'records'}`}
                  data-testid={`stitch-prisma-box-${bx.id}`}
                  style={{
                    position: 'absolute',
                    left: bx.x, top: bx.y, width: bx.w, height: bx.h,
                    background: openBox === bx.id ? 'rgba(43,122,163,0.12)' : 'transparent',
                    border: openBox === bx.id ? '2px solid rgba(43,122,163,0.6)' : '2px solid transparent',
                    borderRadius: 4, cursor: 'pointer', pointerEvents: 'auto', padding: 0,
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {openBox && (
        <PrismaInspector
          boxId={openBox}
          flow={flow}
          records={records}
          onClose={() => setOpenBox(null)}
        />
      )}
    </div>
  );
}

export default PrismaFlowDiagram;
