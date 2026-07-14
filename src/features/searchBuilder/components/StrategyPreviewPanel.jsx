/**
 * StrategyPreviewPanel.jsx — 85.md A2, Terms & Vocabulary. The human-readable
 * structured preview: one row per concept — "(term OR term OR …)" with the concept
 * name — joined by the ACTUAL AND/OR chips from state (never hardcoded AND —
 * critique #5). Beginner mode shows an OR join read-only with an explainer; expert
 * mode toggles ops HERE, where both operands are visible (not on distant cards).
 * The active concept's row is highlighted (border + bold name + "editing" tag).
 * Raw PubMed syntax hides behind a native-details Disclosure. The live count chip
 * reuses the honest hit lifecycle; a failed count gets an inline Retry.
 *
 * Presentational leaf: plain props + callbacks, no fetch.
 */
import { C, FONT, MONO, alpha } from '../../../frontend/theme/tokens.js';
import { Disclosure } from '../../pecanSearch/components/parts.jsx';
import { liveTermsOf } from '../../../research-engine/searchBuilder/termLiveness.js';
import { termDisplay, opExplainer } from './uiShared.js';

function fmtCount(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function CountChip({ hitState, onRetry }) {
  const s = hitState || { status: 'idle' };
  if (s.status === 'updated' && s.hitCount != null) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, fontFamily: MONO, fontSize: 11.5 }}>
        <span style={{ color: C.acc, fontWeight: 700 }}>≈ {fmtCount(s.hitCount)} PubMed records</span>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: C.grn, border: `1px solid ${alpha(C.grn, '55')}`, borderRadius: 4, padding: '0 5px', textTransform: 'uppercase' }}>live</span>
      </span>
    );
  }
  if (s.status === 'updating' || s.status === 'stale') {
    return <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>updating estimate…</span>;
  }
  if (s.status === 'failed') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
        <span style={{ color: C.yel }}>estimate unavailable</span>
        {onRetry && (
          <button type="button" onClick={onRetry}
            style={{ background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, cursor: 'pointer', fontSize: 10.5, fontWeight: 600, fontFamily: FONT, padding: '2px 10px', minHeight: 22 }}>
            Retry
          </button>
        )}
      </span>
    );
  }
  return null;
}

export default function StrategyPreviewPanel({ concepts, activeId, beginner, hitState, onRetryHits, onToggleOp, pubmedQuery, onSelectConcept }) {
  const list = Array.isArray(concepts) ? concepts : [];
  const blocks = list
    .map((c, ci) => ({ c, ci, terms: liveTermsOf(c) }))
    .filter((b) => b.terms.length > 0);
  const emptyOnes = list.filter((c) => liveTermsOf(c).length === 0 && c.picoField !== 'T');

  return (
    <section data-testid="sb-strategy-preview" aria-label="Strategy preview"
      style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 14, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>Your search so far</span>
        <span style={{ marginLeft: 'auto' }}><CountChip hitState={hitState} onRetry={onRetryHits} /></span>
      </div>

      {blocks.length === 0 && (
        <div style={{ fontSize: 11.5, color: C.muted, fontStyle: 'italic' }}>No terms yet — the preview builds as you add terms to your concepts.</div>
      )}

      {blocks.map((b, bi) => {
        const active = b.c.id === activeId;
        const op = bi > 0 ? (blocks[bi - 1].c.op || 'AND') : null;
        const termText = b.terms.map((t) => termDisplay(t).main).join(' OR ');
        return (
          <div key={b.c.id || bi}>
            {op != null && (
              <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
                {beginner ? (
                  <span data-testid="sb-preview-op" title={opExplainer(op)}
                    style={{ fontSize: 9.5, fontWeight: 700, fontFamily: MONO, letterSpacing: 1, color: op === 'OR' ? C.yel : C.acc, border: `1px solid ${alpha(op === 'OR' ? C.yel : C.acc, '55')}`, borderRadius: 6, padding: '1px 12px' }}>
                    {op}
                  </span>
                ) : (
                  <button type="button" data-testid="sb-preview-op"
                    onClick={() => onToggleOp && onToggleOp(blocks[bi - 1].c.id)}
                    title={`${opExplainer(op)} Click to switch.`}
                    aria-label={`Joined with ${op} — click to switch to ${op === 'OR' ? 'AND' : 'OR'}`}
                    style={{ background: C.card2, border: `1px solid ${alpha(op === 'OR' ? C.yel : C.acc, '55')}`, borderRadius: 6, cursor: 'pointer', fontSize: 9.5, padding: '2px 12px', fontFamily: MONO, letterSpacing: 1, fontWeight: 700, color: op === 'OR' ? C.yel : C.acc, minHeight: 24 }}>
                    {op}
                  </button>
                )}
              </div>
            )}
            <div
              data-testid="sb-preview-row"
              onClick={onSelectConcept ? () => onSelectConcept(b.c.id) : undefined}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
                background: active ? alpha(C.acc, '0a') : C.surf,
                border: active ? `1.6px solid ${alpha(C.acc, '88')}` : `1px solid ${C.brd2}`,
                borderRadius: 8, padding: '7px 11px', cursor: onSelectConcept ? 'pointer' : 'default',
              }}>
              <span style={{ fontSize: 11.5, fontWeight: active ? 700 : 600, color: C.txt, flexShrink: 0 }}>{b.c.label}</span>
              {active && (
                <span data-testid="sb-preview-editing" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4, color: C.acc, textTransform: 'uppercase', border: `1px solid ${alpha(C.acc, '55')}`, borderRadius: 4, padding: '0 5px', flexShrink: 0 }}>editing</span>
              )}
              <span style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.6, minWidth: 0, overflowWrap: 'anywhere' }}>({termText})</span>
            </div>
          </div>
        );
      })}

      {emptyOnes.length > 0 && blocks.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: C.muted }}>
          Not in the search yet (no terms): {emptyOnes.map((c) => c.label).join(', ')}
        </div>
      )}

      {pubmedQuery ? (
        <Disclosure summary="Show database syntax">
          <pre data-testid="sb-preview-syntax" tabIndex={0} aria-label="PubMed syntax"
            style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 10, fontFamily: MONO, fontSize: 10.5, lineHeight: 1.6, color: C.txt2, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, maxHeight: 200, overflowY: 'auto' }}>{pubmedQuery}</pre>
          <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>PubMed syntax — the compiled per-database strategies live in Database Strategies.</div>
        </Disclosure>
      ) : null}
    </section>
  );
}
