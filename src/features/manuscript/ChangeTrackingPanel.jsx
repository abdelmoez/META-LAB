/**
 * features/manuscript/ChangeTrackingPanel.jsx — 101.md §34 (+ §7/§14/§35). The small
 * "Recent manuscript updates" list that sits beside Show Changes.
 *
 * §14 is what makes it usable: one research action moves seven values, and the
 * researcher must see ONE entry — "Updated literature search — August 6" — not seven
 * notifications. groupChanges() (pure engine) already collapses the log by
 * correlation id, so this file only paints it.
 *
 * §34 is explicit that this stays lightweight: a side panel, not a dashboard. So it
 * lists grouped updates newest-first with their engines and time, and clicking one
 * navigates to the affected text. It does not chart, score, or summarize.
 *
 * Presentational: no state, no fetching, no business logic. §35 — every entry is a
 * real <button> (keyboard reachable, focus ring from the app's global
 * :focus-visible rule), every engine is identified by glyph AND label as well as
 * colour, and there are no animations.
 */
import { useMemo } from 'react';
import { C, btnS } from '../../frontend/workspace/ui/styles.js';
import { alpha } from '../../frontend/theme/tokens.js';
import { groupChanges } from '../../research-engine/manuscript/factProvenance.js';
import {
  LEGEND_ITEMS, SHOW_CHANGES_CSS, engineStyle, changeSummary, formatChangeStamp,
} from './showChanges.js';
import { EngineBadge } from './FactProvenanceCard.jsx';

/**
 * The §7 legend. Colour is one of three channels here (swatch + glyph + label), which
 * is the whole point — a reader who cannot separate the hues still gets the origin.
 */
export function ShowChangesLegend({ engines, compact = false }) {
  const items = Array.isArray(engines) && engines.length
    ? engines.map((id) => engineStyle(id))
    : LEGEND_ITEMS;
  return (
    <div data-testid="stitch-manuscript-changes-legend"
      aria-label="What the highlight colours mean"
      style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 6 : 8, alignItems: 'center' }}>
      <style>{SHOW_CHANGES_CSS}</style>
      {!compact && (
        <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Updated by
        </span>
      )}
      {items.map((e) => (
        <span key={e.id} title={e.label} data-testid={`stitch-manuscript-legend-${e.id}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: C.txt2, whiteSpace: 'nowrap' }}>
          <span aria-hidden="true" style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 15, height: 15, borderRadius: 4, fontSize: 9.5, lineHeight: 1,
            color: e.cssVar,
            background: `color-mix(in srgb, ${e.cssVar} 14%, transparent)`,
            borderBottom: `2px solid ${e.cssVar}`,
          }}>
            {e.glyph}
          </span>
          {e.label}
        </span>
      ))}
    </div>
  );
}

function GroupRow({ group, onNavigate, active }) {
  // §14 — clicking the coherent research event lands on the text it moved. When the
  // group holds one value we can also show §8's "three → four" inline, for free.
  const primary = group.changes[0] || null;
  const summary = group.changes.length === 1 ? changeSummary(primary) : '';
  const stamp = formatChangeStamp(group.at);
  const allReverted = group.changes.every((c) => c.reverted);
  return (
    <button
      type="button"
      onClick={() => onNavigate && onNavigate(primary, group)}
      disabled={!onNavigate}
      aria-current={active ? 'true' : undefined}
      data-testid={`stitch-manuscript-change-group-${group.id}`}
      title={group.changes.map((c) => `${c.label}: ${changeSummary(c)}`).join('\n')}
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: onNavigate ? 'pointer' : 'default',
        padding: '8px 10px', borderRadius: 9, fontFamily: 'inherit',
        border: `1px solid ${active ? alpha(C.acc, '40') : 'transparent'}`,
        background: active ? alpha(C.acc, '10') : 'transparent',
      }}>
      <span style={{
        display: 'block', fontSize: 12, fontWeight: 600, color: C.txt, lineHeight: 1.45,
        textDecoration: allReverted ? 'line-through' : 'none', opacity: allReverted ? 0.7 : 1,
      }}>
        {group.label}
      </span>
      {summary && (
        <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: C.txt2, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
          {summary}
        </span>
      )}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
        {group.engines.map((id) => <EngineBadge key={id} engine={id} />)}
        {group.count > 1 && (
          <span style={{ fontSize: 10, color: C.muted }}>{`${group.count} values`}</span>
        )}
        {stamp && <span style={{ fontSize: 10, color: C.muted, marginLeft: 'auto' }}>{stamp}</span>}
      </span>
    </button>
  );
}

/**
 * @param {object}   props
 * @param {Array}    [props.factLog]   draft.factLog — grouped here via groupChanges().
 * @param {Array}    [props.groups]    pre-grouped entries (skips the grouping step).
 * @param {Function} [props.onNavigate] (change, group) => void — scroll to the affected text (§34).
 * @param {boolean}  [props.showChanges] current toggle state, for the inline hint.
 * @param {Function} [props.onToggle]  (next:boolean) => void — renders the Show Changes switch.
 * @param {string}   [props.activeChangeId] id of the change currently being inspected.
 * @param {number}   [props.limit=8]   how many groups to list. §34: lightweight.
 */
export function ChangeTrackingPanel({
  factLog, groups, onNavigate, showChanges = false, onToggle, activeChangeId, limit = 8,
}) {
  const all = useMemo(
    () => (Array.isArray(groups) ? groups : groupChanges(factLog)),
    [groups, factLog],
  );
  const shown = limit > 0 ? all.slice(0, limit) : all;
  const enginesInUse = useMemo(() => {
    const seen = [];
    for (const g of shown) for (const e of g.engines) if (!seen.includes(e)) seen.push(e);
    return seen;
  }, [shown]);

  return (
    <div data-testid="stitch-manuscript-change-panel"
      style={{
        background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 12,
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}>
      <style>{SHOW_CHANGES_CSS}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: C.txt, flex: 1, minWidth: 0 }}>
          Recent manuscript updates
        </h4>
        {onToggle && (
          <button type="button" onClick={() => onToggle(!showChanges)}
            aria-pressed={showChanges ? 'true' : 'false'}
            data-testid="stitch-manuscript-show-changes-toggle"
            title="Highlight automatically updated values in the manuscript. Your text is not changed."
            style={{
              ...btnS('ghost'), fontSize: 10.5, padding: '4px 10px',
              ...(showChanges ? { color: C.acc, borderColor: alpha(C.acc, '50'), background: alpha(C.acc, '10') } : {}),
            }}>
            {showChanges ? 'Show changes: on' : 'Show changes: off'}
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p data-testid="stitch-manuscript-change-panel-empty"
          style={{ margin: 0, fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
          {/* §38 — an honest empty state. No history is not the same as no changes. */}
          No automatic updates yet. When your project data changes, the values it feeds
          in the manuscript update here.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {shown.map((g) => (
              <GroupRow key={g.id} group={g} onNavigate={onNavigate}
                active={!!activeChangeId && g.changes.some((c) => c.id === activeChangeId)} />
            ))}
          </div>
          {all.length > shown.length && (
            <p style={{ margin: '8px 2px 0', fontSize: 10, color: C.muted }}>
              {`${all.length - shown.length} earlier update${all.length - shown.length === 1 ? '' : 's'} in the project history.`}
            </p>
          )}
          <div style={{ marginTop: 10, paddingTop: 9, borderTop: `1px solid ${C.brd}` }}>
            <ShowChangesLegend engines={enginesInUse} compact />
          </div>
        </>
      )}
    </div>
  );
}

export default ChangeTrackingPanel;
