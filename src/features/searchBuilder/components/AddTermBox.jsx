/**
 * AddTermBox.jsx — 85.md A2. The evolved add-term box for the active concept:
 * input + an EXPLICIT "Add" button.
 *
 * Trust rules (fixing audit C3 + H2):
 *  - The first dropdown row is ALWAYS `Add "typed text"` — Enter commits exactly
 *    what the user typed, never a look-alike suggestion (the H2 trap).
 *  - Blur RETAINS the draft, uncommitted (never silently commits a fragment — C3 —
 *    and never discards it; the parent keys drafts per concept so navigator
 *    switches round-trip). Escape clears the draft.
 *  - Suggestion rows carry a type badge + a one-line "why".
 *  - Pasting a multi-term list (newline/semicolon — NEVER comma, headings contain
 *    commas) shows a confirmable "Add N terms?" chip preview before committing.
 *  - The outcome is reported inline ("2 added · 1 already present") in a polite
 *    live region — silent dedupe (H1) is gone.
 *
 * The Add button + suggestion rows use the onMouseDown-preventDefault guard so the
 * input's blur never races the click.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { C, FONT, MONO, alpha } from '../../../frontend/theme/tokens.js';
import { localMeshSuggestions, meshConfidence } from '../../../research-engine/searchBuilder/meshSuggest.js';
import { splitTermInput } from '../../../research-engine/searchBuilder/termEntry.js';

const SUGG_BADGE = { mesh: 'Subject heading', keyword: 'keyword', synonym: 'synonym' };
const SUGG_WHY = {
  mesh: 'Standard subject heading librarians tag articles with',
  keyword: 'Related text word',
  synonym: 'Another word authors use for the same idea',
};

function mergeSuggestions(local, remote) {
  const out = []; const seen = new Set();
  const push = (s) => { const k = `${s.type}:${(s.label || '').toLowerCase()}`; if (!s.label || seen.has(k)) return; seen.add(k); out.push(s); };
  remote.forEach(push); local.forEach(push);
  return out.slice(0, 7);
}

export default function AddTermBox({
  api, conceptLabel, value, onChange, onCommitTyped, onPickSuggestion, onClear,
  statusText, pendingSplit, onConfirmSplit, onCancelSplit, onMultiPaste,
}) {
  const [remote, setRemote] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const timer = useRef(null);
  const typed = String(value || '').trim();
  const local = useMemo(() => localMeshSuggestions(value), [value]);

  useEffect(() => {
    let live = true;
    clearTimeout(timer.current);
    if (typed.length < 2) { setRemote([]); return () => { live = false; }; }
    timer.current = setTimeout(async () => {
      if (!api || typeof api.meshSuggest !== 'function') { if (live) setRemote([]); return; }
      try {
        const recs = await api.meshSuggest(typed);
        const mapped = (Array.isArray(recs) ? recs : [])
          .map((r) => ({ label: r.mesh, type: 'mesh', mesh: r.mesh, vocab: r, source: 'remote', confidence: meshConfidence(typed, r.mesh) }))
          .filter((x) => x.label);
        if (live) setRemote(mapped);
      } catch { if (live) setRemote([]); }
    }, 320);
    return () => { live = false; clearTimeout(timer.current); };
  }, [typed, api]); // eslint-disable-line

  const suggestions = useMemo(() => mergeSuggestions(local, remote), [local, remote]);
  // Row 0 is ALWAYS the typed text; suggestion rows follow.
  const items = useMemo(() => (typed ? [{ kind: 'typed' }, ...suggestions.map((s) => ({ kind: 'sugg', s }))] : []), [typed, suggestions]);
  useEffect(() => { setOpen(items.length > 0); setHi(0); }, [items.length, value]);

  const commitTyped = () => { if (typed) { onCommitTyped && onCommitTyped(); setOpen(false); setHi(0); } };
  const pick = (item) => {
    if (!item) return;
    if (item.kind === 'typed') { commitTyped(); return; }
    onPickSuggestion && onPickSuggestion(item.s);
    setOpen(false); setHi(0);
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { if (open && items.length) { e.preventDefault(); setHi((h) => (h + 1) % items.length); } }
    else if (e.key === 'ArrowUp') { if (open && items.length) { e.preventDefault(); setHi((h) => (h <= 0 ? items.length - 1 : h - 1)); } }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && items.length) pick(items[Math.max(0, hi)]);
      else commitTyped();
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); setOpen(false); setHi(0); }
      else { onClear && onClear(); }
    }
  };

  const onPaste = (e) => {
    try {
      const txt = e.clipboardData ? e.clipboardData.getData('text') : '';
      const { terms } = splitTermInput(txt);
      if (terms.length > 1 && onMultiPaste) { e.preventDefault(); onMultiPaste(txt); }
    } catch { /* paste falls through to the input */ }
  };

  return (
    <div data-testid="sb-add-term" style={{ fontFamily: FONT }}>
      <div style={{ position: 'relative', display: 'flex', gap: 6, alignItems: 'center', maxWidth: 460 }}>
        <input
          data-testid="sb-add-term-input"
          value={value || ''}
          onChange={(e) => onChange && onChange(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => setOpen(items.length > 0)}
          onBlur={() => { setTimeout(() => setOpen(false), 140); /* draft is RETAINED — never committed or discarded on blur */ }}
          onPaste={onPaste}
          placeholder={`Add a term to ${conceptLabel || 'this concept'}…`}
          aria-label={`Add a term to ${conceptLabel || 'this concept'}`}
          role="combobox" aria-expanded={open} aria-autocomplete="list"
          style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '7px 10px', color: C.txt, fontFamily: FONT, fontSize: 12, flex: 1, minWidth: 0, boxSizing: 'border-box' }}
        />
        <button
          type="button"
          data-testid="sb-add-term-btn"
          onMouseDown={(e) => e.preventDefault() /* keep focus — no blur race */}
          onClick={commitTyped}
          disabled={!typed}
          style={{ background: typed ? `linear-gradient(135deg,${C.acc},${C.acc2})` : C.card2, border: 'none', borderRadius: 7, color: typed ? C.accText : C.muted, cursor: typed ? 'pointer' : 'default', fontSize: 11.5, fontWeight: 700, fontFamily: FONT, padding: '7px 16px', minHeight: 30, flexShrink: 0 }}>
          Add
        </button>
        {open && items.length > 0 && (
          <div role="listbox" style={{ position: 'absolute', zIndex: 90, top: 'calc(100% + 3px)', left: 0, minWidth: 260, maxWidth: 420, background: C.card, border: `1px solid ${alpha(C.acc, '55')}`, borderRadius: 8, boxShadow: `0 14px 40px var(--t-shadow)`, overflow: 'hidden' }}>
            {items.map((item, i) => {
              const active = i === hi;
              if (item.kind === 'typed') {
                return (
                  <div key="__typed" role="option" aria-selected={active}
                    onMouseDown={(e) => { e.preventDefault(); pick(item); }} onMouseEnter={() => setHi(i)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer', background: active ? alpha(C.acc, '1a') : 'transparent', borderBottom: items.length > 1 ? `1px solid ${C.brd}` : 'none' }}>
                    <span style={{ flex: 1, fontSize: 11.5, color: C.txt }}>Add “{typed}”</span>
                    <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4, color: C.grn, textTransform: 'uppercase', border: `1px solid ${alpha(C.grn, '55')}`, borderRadius: 4, padding: '0 4px', flexShrink: 0 }}>your words</span>
                  </div>
                );
              }
              const s = item.s;
              const badge = SUGG_BADGE[s.type] || SUGG_BADGE.keyword;
              return (
                <div key={`${s.type}:${s.label}`} role="option" aria-selected={active}
                  onMouseDown={(e) => { e.preventDefault(); pick(item); }} onMouseEnter={() => setHi(i)}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px', cursor: 'pointer', background: active ? alpha(C.acc, '1a') : 'transparent' }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontFamily: s.type === 'mesh' ? MONO : FONT, fontSize: 11.5, color: C.txt2, wordBreak: 'break-word' }}>{s.label}</span>
                    <span style={{ display: 'block', fontSize: 9.5, color: C.muted }}>{SUGG_WHY[s.type] || SUGG_WHY.keyword}</span>
                  </span>
                  {s.type === 'mesh' && s.confidence === 'review' && (
                    <span title="Low-confidence match — check this heading fits your topic before adding." style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.4, color: C.yel, textTransform: 'uppercase', flexShrink: 0, border: `1px solid ${alpha(C.yel, '66')}`, borderRadius: 4, padding: '0 4px', marginTop: 2 }}>review</span>
                  )}
                  <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.4, color: s.type === 'mesh' ? C.acc : C.muted, textTransform: 'uppercase', opacity: 0.9, flexShrink: 0, border: `1px solid ${alpha(s.type === 'mesh' ? C.acc : C.muted, '55')}`, borderRadius: 4, padding: '0 4px', marginTop: 2 }}>{badge}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pendingSplit && Array.isArray(pendingSplit.terms) && pendingSplit.terms.length > 1 && (
        <div data-testid="sb-split-confirm" style={{ marginTop: 8, background: alpha(C.acc, '0a'), border: `1px solid ${alpha(C.acc, '33')}`, borderRadius: 8, padding: '8px 12px' }}>
          <div style={{ fontSize: 11.5, color: C.txt2, marginBottom: 6 }}>Add {pendingSplit.terms.length} terms?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
            {pendingSplit.terms.map((x, i) => (
              <span key={i} style={{ background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 6, padding: '2px 8px', fontSize: 11, color: C.txt2 }}>{x}</span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onConfirmSplit}
              style={{ background: `linear-gradient(135deg,${C.acc},${C.acc2})`, border: 'none', borderRadius: 7, color: C.accText, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: FONT, padding: '5px 14px' }}>
              Add {pendingSplit.terms.length} terms
            </button>
            <button type="button" onClick={onCancelSplit}
              style={{ background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: FONT, padding: '5px 14px' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div data-testid="sb-add-status" role="status" aria-live="polite" style={{ minHeight: 16, marginTop: 4, fontSize: 10.5, color: C.muted }}>
        {statusText || ''}
      </div>
    </div>
  );
}
