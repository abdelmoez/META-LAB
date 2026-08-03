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

function Row({ label, children }) {
  if (!children) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: C.txt2, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

export default function MeshDetailsPopover({ term, addedTexts, onAddEntryTerm, onClose, readOnly }) {
  const t = term || {};
  const v = (t.vocab && typeof t.vocab === 'object') ? t.vocab : {};
  const descriptor = String(v.mesh || t.text || '').trim();
  const synonyms = Array.isArray(v.synonyms) ? v.synonyms.filter((s) => typeof s === 'string' && s.trim()) : [];
  const children = Array.isArray(v.children) ? v.children.filter((s) => typeof s === 'string' && s.trim()) : [];
  const added = new Set((Array.isArray(addedTexts) ? addedTexts : []).map((s) => String(s || '').trim().toLowerCase()));
  const sourceLabel = v.source === 'core' ? 'Offline core vocabulary' : 'MeSH (National Library of Medicine)';
  const rootRef = useRef(null);
  const [pos, setPos] = useState({ dx: 0, flipUp: false });

  // Flip/clamp inside the viewport (client-only; SSR renders the default anchor).
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof window === 'undefined' || !el.getBoundingClientRect) return;
    try {
      const r = el.getBoundingClientRect();
      let dx = 0; let flipUp = false;
      if (r.right > window.innerWidth - 8) dx = Math.min(0, window.innerWidth - 8 - r.right);
      if (r.left + dx < 8) dx = 8 - r.left;
      if (r.bottom > window.innerHeight - 8 && r.top > r.height + 16) flipUp = true;
      if (dx !== 0 || flipUp) setPos({ dx, flipUp });
    } catch { /* measurement is best-effort */ }
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
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 6px', minWidth: 22, minHeight: 22 }}>×</button>
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

      <Row label="Source">{sourceLabel}</Row>
    </div>
  );
}
