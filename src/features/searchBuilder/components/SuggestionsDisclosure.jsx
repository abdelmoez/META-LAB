/**
 * SuggestionsDisclosure.jsx — 85.md A2. The "Suggestions to review (N)" area for
 * the active concept (native <details> — the parts.jsx Disclosure pattern):
 *  - one row per pending suggestion (A1 pendingSuggestions): term, kind badge,
 *    one-line why, Accept / Dismiss;
 *  - bulk "Accept all subject headings";
 *  - Dismiss persists (rejectedSuggestions) and "Show dismissed" lists the
 *    rejections with one-click restore (no hidden, unrecoverable "no" — critique #9);
 *  - the Hidden-terms restore panel (deleted auto suggestions) lives INSIDE this
 *    disclosure — one review surface, not three stacked panels (audit H6).
 *
 * Presentational leaf: plain props + callbacks, no fetch.
 */
import { C, FONT, MONO, alpha } from '../../../frontend/theme/tokens.js';
import { Disclosure } from '../../pecanSearch/components/parts.jsx';

const KIND_LABEL = { mesh: 'Subject heading', synonyms: 'Synonyms' };

function actionBtn(color) {
  return { background: 'none', border: `1px solid ${alpha(color, '55')}`, borderRadius: 6, color, cursor: 'pointer', fontSize: 10.5, fontWeight: 700, fontFamily: FONT, padding: '3px 10px', minHeight: 24, flexShrink: 0 };
}

export default function SuggestionsDisclosure({
  suggestions, onAccept, onDismiss, onAcceptAllHeadings,
  rejectedEntries, showDismissed, onToggleShowDismissed, onUnreject,
  ignoredGroups, onRestoreTerm, onRestoreField, onRestoreAll,
}) {
  const pending = Array.isArray(suggestions) ? suggestions : [];
  const rejected = Array.isArray(rejectedEntries) ? rejectedEntries : [];
  const hidden = Array.isArray(ignoredGroups) ? ignoredGroups : [];
  const hiddenCount = hidden.reduce((n, g) => n + ((g.items && g.items.length) || 0), 0);
  const meshCount = pending.filter((s) => s.kind === 'mesh').length;
  const empty = !pending.length && !rejected.length && !hiddenCount;

  return (
    <div data-testid="sb-suggestions" style={{ fontFamily: FONT }}>
      <Disclosure summary={`Suggestions to review`} count={pending.length} defaultOpen={pending.length > 0}>
        {empty && (
          <div style={{ fontSize: 11.5, color: C.muted, fontStyle: 'italic' }}>
            No suggestions right now — they appear as you add terms.
          </div>
        )}

        {pending.length > 0 && meshCount > 1 && onAcceptAllHeadings && (
          <div style={{ marginBottom: 8 }}>
            <button type="button" onClick={onAcceptAllHeadings} data-testid="sb-accept-all-headings" style={actionBtn(C.acc)}>
              Accept all {meshCount} subject headings
            </button>
          </div>
        )}

        {pending.map((s) => (
          <div key={s.key} data-testid="sb-suggestion-row" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0', borderTop: `1px solid ${C.brd}` }}>
            <span style={{ flex: '1 1 200px', minWidth: 0 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.txt, fontFamily: s.kind === 'mesh' ? MONO : FONT }}>
                {s.kind === 'synonyms' ? `${(s.synonyms || []).length} synonyms for “${s.text}”` : s.text}
                <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.4, color: C.acc, textTransform: 'uppercase', border: `1px solid ${alpha(C.acc, '55')}`, borderRadius: 4, padding: '0 4px' }}>
                  {KIND_LABEL[s.kind] || s.kind}
                </span>
              </span>
              <span style={{ display: 'block', fontSize: 10, color: C.muted }}>{s.why}</span>
            </span>
            <button type="button" onClick={() => onAccept && onAccept(s)} aria-label={`Accept suggestion ${s.text}`} style={actionBtn(C.grn)}>Accept</button>
            <button type="button" onClick={() => onDismiss && onDismiss(s)} aria-label={`Dismiss suggestion ${s.text}`} style={actionBtn(C.muted)}>Dismiss</button>
          </div>
        ))}

        {rejected.length > 0 && (
          <div style={{ marginTop: 8, borderTop: `1px solid ${C.brd}`, paddingTop: 6 }}>
            <button type="button" onClick={onToggleShowDismissed} aria-expanded={!!showDismissed}
              style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 10.5, fontFamily: MONO, textDecoration: 'underline', padding: 0 }}>
              {showDismissed ? 'Hide dismissed' : `Show dismissed (${rejected.length})`}
            </button>
            {showDismissed && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                {rejected.map((r) => (
                  <span key={r.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: C.surf, border: `1px dashed ${C.brd2}`, borderRadius: 6, padding: '2px 7px' }}>
                    <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.txt2 }}>{r.label}</span>
                    <button type="button" onClick={() => onUnreject && onUnreject(r.key)} aria-label={`Restore suggestion ${r.label}`}
                      title="Let this suggestion appear again"
                      style={{ background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1, minWidth: 20, minHeight: 20 }}>↩</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {hiddenCount > 0 && (
          <div data-testid="sb-hidden-terms" style={{ marginTop: 10, borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>Hidden terms</span>
              <span style={{ fontSize: 10, color: C.muted }}>removed suggestions — won&apos;t return until restored</span>
              {onRestoreAll && (
                <button type="button" onClick={onRestoreAll}
                  title={`Restore all ${hiddenCount} removed suggestion${hiddenCount === 1 ? '' : 's'} (also clears dismissed suggestions)`}
                  style={{ marginLeft: 'auto', ...actionBtn(C.txt2), borderColor: C.brd2 }}>
                  ↺ Restore all ({hiddenCount})
                </button>
              )}
            </div>
            {hidden.map((grp, gi) => (
              <div key={gi} style={{ marginBottom: gi < hidden.length - 1 ? 8 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>{grp.field || grp.label || 'Other'}</span>
                  {onRestoreField && (
                    <button type="button" onClick={() => onRestoreField(grp.field)} title={`Restore all from ${grp.field || 'this field'}`}
                      style={{ background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 9.5, fontFamily: MONO, textDecoration: 'underline', padding: 0 }}>
                      restore all from {grp.field || 'field'} ({grp.items.length})
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {grp.items.map((e, ei) => (
                    <span key={ei} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: C.surf, border: `1px dashed ${C.brd2}`, borderRadius: 6, padding: '2px 7px' }}>
                      <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.txt2 }}>{e.text}</span>
                      <button type="button" onClick={() => onRestoreTerm && onRestoreTerm(e)} title={`Restore "${e.text}"`} aria-label={`Restore ${e.text}`}
                        style={{ background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1, minWidth: 20, minHeight: 20 }}>↩</button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Disclosure>
    </div>
  );
}
