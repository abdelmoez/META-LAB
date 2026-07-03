/**
 * features/extraction/ConsensusPanel.jsx — 66.md (P5). RIGHT-panel "Consensus" tab.
 * A read-only list of the reconciled consensus values for the selected study: value,
 * a source badge (agreement / accept_a / accept_b / adjudicated), an AI-assisted
 * marker, and who resolved it. Consensus is written only by adjudication; this panel
 * never edits.
 */
import { C, Chip, renderValue } from './parts.jsx';

const SOURCE_LABEL = {
  agreement: 'Both agreed',
  accept_a: 'Extractor A',
  accept_b: 'Extractor B',
  adjudicated: 'Adjudicated',
};
const SOURCE_TONE = {
  agreement: 'green', accept_a: 'blue', accept_b: 'blue', adjudicated: 'purple',
};

export default function ConsensusPanel({ consensus, elementsById }) {
  if (!consensus || consensus.length === 0) {
    return (
      <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.5 }}>
        No consensus values yet. An adjudicator resolves the two extractors' values into consensus, which then appears here.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {consensus.map((c, i) => {
        const el = elementsById[c.elementId];
        return (
          <div key={`${c.elementId}::${c.armKey || ''}-${i}`} style={{ border: `1px solid ${C.brd}`, borderRadius: 8, padding: '9px 11px', background: C.card }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.txt, flex: 1, minWidth: 0 }}>
                {el ? el.name : c.elementId}
                {c.armKey ? <span style={{ color: C.dim, fontWeight: 400 }}> · {c.armKey}</span> : null}
              </span>
              <Chip tone={SOURCE_TONE[c.source] || 'muted'}>{SOURCE_LABEL[c.source] || c.source}</Chip>
              {c.aiAssisted && <Chip tone="amber" title="Derived, at least in part, from a suggestion">Assisted</Chip>}
            </div>
            <div style={{ fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", color: C.acc }}>
              {el ? renderValue(el, c.value) : JSON.stringify(c.value)}
            </div>
            {c.note ? <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.45 }}>{c.note}</div> : null}
            {c.resolvedByName ? <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Resolved by {c.resolvedByName}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
