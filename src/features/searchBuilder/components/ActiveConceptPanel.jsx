/**
 * ActiveConceptPanel.jsx — 85.md A2, Terms & Vocabulary master-detail. The DETAIL
 * panel for the active concept: header (inline name, role badge, MeSH-coverage
 * badge, readiness status) + a plain-language guidance line. The parent composes
 * the working surfaces (add box, chip row, suggestions/advanced disclosures) as
 * children so each stays an independently-testable leaf.
 *
 * Presentational: plain props + callbacks, no fetch.
 */
import { C, FONT, alpha } from '../../../frontend/theme/tokens.js';
import { CONCEPT_STATUS_LABELS } from '../../../research-engine/searchBuilder/searchState.js';
import { liveTermsOf } from '../../../research-engine/searchBuilder/termLiveness.js';
import { conceptAccent, CONCEPT_STATUS_GLYPH } from './uiShared.js';

export default function ActiveConceptPanel({ concept, conceptIndex, status, onRename, children }) {
  const c = concept || {};
  const accent = conceptAccent(conceptIndex || 0);
  const live = liveTermsOf(c);
  const meshN = live.filter((t) => t.type === 'controlled' && t.vocab).length;
  const st = status || 'empty';
  const stCol = { empty: C.dim, 'needs-review': C.yel, 'mesh-suggested': C.acc, ready: C.grn }[st] || C.muted;

  return (
    <section data-testid="sb-active-concept" aria-label={`Concept: ${c.label || ''}`}
      style={{ background: C.card, border: `1px solid ${C.brd}`, borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: 14, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <input value={c.label || ''} onChange={(e) => onRename && onRename(e.target.value)}
          aria-label={`Concept name: ${c.label || ''}`}
          style={{ fontWeight: 700, flex: '1 1 160px', minWidth: 140, background: 'transparent', border: 'none', padding: '2px 0', fontSize: 14, color: C.txt, fontFamily: FONT }} />
        {c.picoField && (
          <span title="One of the five PICO groups — auto-generated from your protocol"
            style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4, color: C.acc, textTransform: 'uppercase', background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '44')}`, borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>
            {c.field || 'PICO'}
          </span>
        )}
        {c.picoField !== 'T' && live.length > 0 && (
          <span data-testid="sb-mesh-coverage"
            title={meshN > 0 ? 'This concept includes a matched subject heading (MeSH)' : 'No subject heading yet — accepting one from the suggestions usually improves recall'}
            style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', borderRadius: 4, padding: '0 5px', color: meshN > 0 ? C.grn : C.muted, border: `1px solid ${alpha(meshN > 0 ? C.grn : C.muted, '55')}`, flexShrink: 0 }}>
            {meshN > 0 ? 'has heading' : 'no heading yet'}
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: stCol, textTransform: 'uppercase', background: alpha(stCol, '14'), border: `1px solid ${alpha(stCol, '44')}`, borderRadius: 5, padding: '1px 7px', flexShrink: 0 }}>
          <span aria-hidden="true">{CONCEPT_STATUS_GLYPH[st] || '○'}</span>{CONCEPT_STATUS_LABELS[st] || st}
        </span>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
        Add different words researchers may use for {c.label || 'this idea'}. Any one of them counts as a match.
      </p>
      {children}
    </section>
  );
}
