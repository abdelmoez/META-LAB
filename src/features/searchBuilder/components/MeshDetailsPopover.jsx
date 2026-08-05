/**
 * MeshDetailsPopover.jsx — 97.md Phase 13 (plan §14). The lightweight hover/focus
 * details popover for a MeSH (controlled-vocabulary) term chip. INFORMATIONAL:
 * nothing here mutates state automatically — entry terms are listed with an
 * explicit per-term "Add this term" action and are NEVER bulk-inserted.
 *
 * Every field comes from the vocab record already riding on the term
 * (nlmClient meshLookup / offline CORE_VOCAB) — ZERO new fetches:
 *   preferred term ("X"[MeSH] form), scope note, entry terms (+ per-term add),
 *   narrower indexed terms, tree location, MeSH unique ID, explode status
 *   ("Include narrower indexed terms"), and the source database.
 *
 * Keyboard-accessible: the parent opens it on chip hover OR focus of the info
 * affordance; Escape closes (onClose). Presentational leaf — plain props.
 */
import { useEffect, useRef, useState } from 'react';
import { C, FONT, MONO, alpha } from '../../../frontend/theme/tokens.js';
// 98.md §10 — the details view names the EXACT syntax each selected database
// receives for this heading (compileStrategy on a one-term strategy; pure, no fetch).
import { compileStrategy } from '../../../research-engine/searchBuilder/compilers/index.js';
import { getDatabase } from '../../../research-engine/searchBuilder/databases.js';

function Row({ label, children }) {
  if (!children) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: C.txt2, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

export default function MeshDetailsPopover({ term, addedTexts, onAddEntryTerm, onClose, readOnly, syntaxDbs }) {
  const t = term || {};
  const v = (t.vocab && typeof t.vocab === 'object') ? t.vocab : {};
  const descriptor = String(v.mesh || t.text || '').trim();
  const synonyms = Array.isArray(v.synonyms) ? v.synonyms.filter((s) => typeof s === 'string' && s.trim()) : [];
  const children = Array.isArray(v.children) ? v.children.filter((s) => typeof s === 'string' && s.trim()) : [];
  const added = new Set((Array.isArray(addedTexts) ? addedTexts : []).map((s) => String(s || '').trim().toLowerCase()));
  const sourceLabel = v.source === 'core' ? 'Offline core vocabulary' : 'MeSH (National Library of Medicine)';
  const rootRef = useRef(null);
  const [pos, setPos] = useState({ dx: 0, flipUp: false });

  // Flip/clamp inside the viewport — re-run on scroll/resize so an open popover
  // never drifts off-screen (98.md §10; was mount-only). Client-only; SSR renders
  // the default anchor.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const measure = () => {
      const el = rootRef.current;
      if (!el || !el.getBoundingClientRect) return;
      try {
        const r = el.getBoundingClientRect();
        let dx = 0; let flipUp = false;
        if (r.right > window.innerWidth - 8) dx = Math.min(0, window.innerWidth - 8 - r.right);
        if (r.left + dx < 8) dx = 8 - r.left;
        if (r.bottom > window.innerHeight - 8 && r.top > r.height + 16) flipUp = true;
        setPos((p) => (p.dx === dx && p.flipUp === flipUp ? p : { dx, flipUp }));
      } catch { /* measurement is best-effort */ }
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => { window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); };
  }, []);

  return (
    <div ref={rootRef} data-testid="sb-mesh-popover" role="dialog" aria-label={`MeSH details for ${descriptor}`}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose && onClose(); } }}
      style={{
        position: 'absolute', zIndex: 72, width: 320, maxWidth: 'calc(100vw - 24px)',
        ...(pos.flipUp ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' }),
        left: 0, transform: `translateX(${pos.dx}px)`,
        background: C.card, border: `1px solid ${alpha(C.acc, '55')}`, borderRadius: 10, padding: '12px 14px',
        boxShadow: '0 16px 48px var(--t-shadow)', fontFamily: FONT, textAlign: 'left',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: C.txt }}>
          &quot;{descriptor}&quot;<span style={{ color: C.acc }}>[MeSH]</span>
        </span>
        <button type="button" onClick={onClose} aria-label="Close MeSH details"
          onMouseDown={(e) => e.preventDefault()} /* 98.md §15 — Safari: keep the opener focused so blur can't unmount before the click */
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 6px', minWidth: 24, minHeight: 24 }}>×</button>
      </div>

      {v.scope && <Row label="Scope note">{v.scope}</Row>}

      {synonyms.length > 0 && (
        <Row label="Entry terms (informational — not added automatically)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {synonyms.map((s) => {
              const already = added.has(s.trim().toLowerCase());
              return (
                <div key={s} data-testid="sb-mesh-entry-term" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{s}</span>
                  {already ? (
                    <span style={{ fontSize: 9, color: C.grn, flexShrink: 0 }}>✓ added</span>
                  ) : (!readOnly && onAddEntryTerm && (
                    <button type="button" onClick={() => onAddEntryTerm(s)}
                      onMouseDown={(e) => e.preventDefault()} /* 98.md §15 — Safari blur-before-click guard */
                      aria-label={`Add this term: ${s}`}
                      style={{ background: 'none', border: `1px solid ${alpha(C.acc, '55')}`, borderRadius: 6, color: C.acc, cursor: 'pointer', fontSize: 9.5, fontWeight: 700, fontFamily: FONT, padding: '1px 8px', minHeight: 20, flexShrink: 0 }}>
                      Add this term
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </Row>
      )}

      {children.length > 0 && <Row label="Narrower indexed terms">{children.join(' · ')}</Row>}
      {v.tree && <Row label="Tree location">{v.tree}</Row>}
      {v.meshUI && <Row label="MeSH unique ID"><span style={{ fontFamily: MONO }}>{v.meshUI}</span></Row>}

      <Row label="Include narrower indexed terms">
        {t.noExplode
          ? 'Off — only records indexed with this exact heading are matched.'
          : 'On — records indexed with any narrower heading under this one are matched too. This changes database indexing behaviour; it does not add visible free-text terms.'}
      </Row>

      {/* 98.md §10 — the exact controlled-vocabulary syntax per selected database
          (one-term compile through the real renderers — the same code path the
          strategy uses, so this can never drift from the compiled output). */}
      {Array.isArray(syntaxDbs) && syntaxDbs.length > 0 && (
        <Row label="Syntax by database">
          {/* 98.md review (L17) — never silently truncate: all selected databases
              render, bounded by an internal scroll. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 160, overflowY: 'auto' }}>
            {syntaxDbs.map((dbId) => {
              let res = null;
              try { res = compileStrategy({ concepts: [{ id: 'x', label: '', op: 'AND', terms: [{ ...t, id: t.id || 'x', disabled: false }] }] }, dbId); } catch { res = null; }
              if (!res || !res.query) return null;
              const db = getDatabase(dbId);
              const approx = !!(res.vocab && res.vocab.approximate);
              return (
                <div key={dbId} data-testid="sb-mesh-db-syntax" style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ flexShrink: 0, fontSize: 9.5, color: C.muted, minWidth: 72 }}>{(db && db.label) || dbId}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: C.txt2, overflowWrap: 'anywhere' }}>{res.query}</span>
                  {approx && <span title="Heuristic mapping — verify in the database" style={{ fontSize: 8.5, color: C.yel, flexShrink: 0 }}>approx.</span>}
                </div>
              );
            })}
          </div>
        </Row>
      )}

      <Row label="Source">{sourceLabel}</Row>
    </div>
  );
}
