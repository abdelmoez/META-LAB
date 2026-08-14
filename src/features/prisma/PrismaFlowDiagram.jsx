/**
 * features/prisma/PrismaFlowDiagram.jsx — 103.md §12/§21, 116.md §8/§20.
 *
 * "Simple on the surface, extremely rigorous underneath."
 *
 * The default view is a clean PRISMA 2020 diagram and nothing else. Every count is
 * ALSO a button: clicking one opens the inspector panel BELOW the diagram (116.md
 * §8 — never a modal over it) naming exactly which records produced it.
 *
 * The diagram itself is the pure `buildPrismaFlowSVG` string — the SAME builder the
 * export uses, so what a researcher inspects on screen and what lands in the
 * manuscript are the same drawing from the same numbers (§16). This component adds
 * only hit-targets on top of it; it never recomputes anything.
 *
 * 116.md §20 — the on-screen diagram SCALES to its container (the export keeps
 * fixed pixels): the svg string is re-attributed to width:100% for display, and
 * the hit-target overlay is positioned in FRACTIONAL coordinates, so browser zoom
 * and responsive scaling can never desync a click target from its drawn box.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { C } from '../../frontend/workspace/ui/styles.js';
import { buildPrismaFlowSVG, boxMeta } from '../../research-engine/prisma/index.js';
import { useRealtime } from '../../frontend/hooks/useRealtime.js';
import { PrismaInspector } from './PrismaInspector.jsx';
import { shouldReloadForRecordPoke } from './inspectorModel.js';

// Re-exported for existing importers/tests — the interactive inspector now lives
// in its own module (116.md §9-§12).
export { PrismaInspector } from './PrismaInspector.jsx';

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
 * @param {object} flow            derivePrismaFlow() output (slim wire shape is fine)
 * @param {object} reconciliation  reconcilePrismaFlow() output
 * @param {string} screenProjectId ScreenProject id — enables the interactive
 *                                 inspector (record lists + editing). Absent →
 *                                 boxes still select, panel shows aggregates only.
 * @param {function} onChanged     called after an inspector mutation → refetch flow
 * @param {boolean} interactive    false → a plain, non-clickable diagram (export preview)
 */
export function PrismaFlowDiagram({
  flow, reconciliation, screenProjectId = null, onChanged = null,
  title = '', interactive = true, perSource = true, updated = false,
}) {
  const [openBox, setOpenBox] = useState(null);

  /* 116.md §10 (r2) — the `record.updated` poke had NO subscriber anywhere in the
   * client: it was the only emitted event type with zero listeners, so the server
   * did two queries and an SSE write per metadata edit for nobody, while a
   * collaborator's diagram, counts and open inspector kept pre-edit numbers
   * indefinitely. That matters here specifically because an `identificationSource`
   * edit moves a record between the database and other-methods arms.
   *
   * The poke carries ids only (global invariant 8), so this refetches through the
   * authorized endpoints: `onChanged` re-derives the flow, and the bumped `syncKey`
   * re-loads the open box's page. Debounced so a burst of edits collapses into one. */
  const [syncKey, setSyncKey] = useState(0);
  const pokeTimer = useRef(null);
  const onChangedRef = useRef(onChanged); onChangedRef.current = onChanged;
  const onRecordPoke = useCallback((ev) => {
    if (!shouldReloadForRecordPoke(ev, screenProjectId)) return;
    if (pokeTimer.current) clearTimeout(pokeTimer.current);
    pokeTimer.current = setTimeout(() => {
      pokeTimer.current = null;
      setSyncKey((k) => k + 1);
      if (onChangedRef.current) onChangedRef.current();
    }, 1200);
  }, [screenProjectId]);
  useRealtime({ 'record.updated': onRecordPoke });

  const built = useMemo(
    () => (flow ? buildPrismaFlowSVG(flow, { title, perSource, updated }) : null),
    [flow, title, perSource, updated],
  );

  // 116.md §20 — display-only responsive re-attribution. The builder's string keeps
  // its fixed width/height (the export path depends on them); on screen the svg
  // scales to its container through the viewBox it already carries.
  const displaySvg = useMemo(() => (built
    ? built.svg.replace(
      `width="${built.W}" height="${built.H}"`,
      'style="width:100%;height:auto;display:block"',
    )
    : ''), [built]);

  if (!flow || !built) {
    return (
      <div data-testid="stitch-prisma-empty" style={{ fontSize: 12, color: C.muted, padding: 12 }}>
        No records have been identified yet — the flow will populate as searches run and
        results are imported.
      </div>
    );
  }

  const pct = (v, total) => `${((v / total) * 100).toFixed(4)}%`;

  return (
    <div data-testid="stitch-prisma-flow">
      <PrismaValidationBanner reconciliation={reconciliation} />

      <div style={{ position: 'relative', maxWidth: built.W, marginTop: 10 }}>
        {/* The diagram is the pure builder's own drawing — identical to the export. */}
        <div
          data-testid="stitch-prisma-svg"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: displaySvg }}
        />

        {/* Hit-targets positioned from the builder's returned geometry, in
            FRACTIONAL coordinates so they scale exactly with the svg (§20) and
            can never drift from the drawing. */}
        {interactive && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {built.boxes.map((bx) => {
              const meta = boxMeta(bx.id);
              const count = (flow.boxes[bx.id] || {}).n;
              return (
                <button
                  key={bx.id}
                  type="button"
                  onClick={() => setOpenBox(bx.id === openBox ? null : bx.id)}
                  aria-label={`Inspect ${meta ? meta.label.replace(/[*:]+$/, '') : bx.id} — ${count} ${meta ? meta.unit : 'records'}`}
                  aria-pressed={openBox === bx.id}
                  data-testid={`stitch-prisma-box-${bx.id}`}
                  style={{
                    position: 'absolute',
                    left: pct(bx.x, built.W),
                    top: pct(bx.y, built.H),
                    width: pct(bx.w, built.W),
                    height: pct(bx.h, built.H),
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
          screenProjectId={screenProjectId}
          onClose={() => setOpenBox(null)}
          onChanged={onChanged}
          syncKey={syncKey}
        />
      )}
    </div>
  );
}

export default PrismaFlowDiagram;
