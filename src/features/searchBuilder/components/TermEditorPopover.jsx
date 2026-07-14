/**
 * TermEditorPopover.jsx — 85.md A2. The evolved term editor popover (from the old
 * TermEditor): text editable in place (replace without delete), plain-words ↔
 * subject-term toggle, field scope, explode, truncation, exact phrase, a
 * Disable/Enable toggle (keep-but-off — A1 setTermDisabled), FIRST-CLASS
 * "Move to concept", Remove, duplicate-resolution actions that name the other
 * concept, and a per-database syntax preview line (expert mode).
 *
 * Popover behaviour: Escape closes (focus returns to the chip — TermChipRow),
 * flips/clamps inside the viewport (fixes audit M11: popovers ran off-screen).
 * Presentational: all mutations go through callbacks; `preview` is computed by the
 * parent so this leaf never imports the renderer (no cycles).
 */
import { useEffect, useRef, useState } from 'react';
import { C, FONT, MONO, alpha } from '../../../frontend/theme/tokens.js';

function Section({ label, children, help }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</span>
        {help && <span style={{ fontSize: 10, color: C.muted }}>{help}</span>}
      </div>
      {children}
    </div>
  );
}

function Opt({ active, onClick, children, title }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={active}
      style={{
        flex: 1, cursor: 'pointer', fontFamily: FONT, fontSize: 10.5, fontWeight: 600, minHeight: 26,
        color: active ? C.accText : C.txt2, background: active ? C.acc : 'transparent',
        border: `1px solid ${active ? C.acc : C.brd2}`, borderRadius: 7, padding: '4px 6px',
      }}>
      {children}
    </button>
  );
}

export default function TermEditorPopover({
  term, beginner, moveTargets, dupInfo, preview,
  onChange, onClose, onLookup, onConvertSynonyms, onToggleDisabled, onMove, onRemove,
}) {
  const t = term || {};
  const lk = t.vocab;
  const off = t.disabled === true;
  const rootRef = useRef(null);
  const [pos, setPos] = useState({ dx: 0, flipUp: false });
  const [moveOpen, setMoveOpen] = useState(false);

  // Flip/clamp within the viewport (client-only; SSR renders the default anchor).
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

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose && onClose(); }
  };

  const targets = Array.isArray(moveTargets) ? moveTargets : [];

  return (
    <div ref={rootRef} data-testid="sb-term-editor" role="dialog" aria-label={`Edit term ${t.text || ''}`}
      onKeyDown={onKeyDown}
      style={{
        position: 'absolute', zIndex: 70, width: 340, maxWidth: 'calc(100vw - 24px)',
        ...(pos.flipUp ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' }),
        left: 0, transform: `translateX(${pos.dx}px)`,
        background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 10, padding: 14,
        boxShadow: `0 16px 48px var(--t-shadow)`, fontFamily: FONT,
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>Edit term</span>
        <button type="button" onClick={onClose} aria-label="Close editor"
          style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 6px', minWidth: 24, minHeight: 24 }}>×</button>
      </div>

      <input autoFocus value={t.text || ''} aria-label="Term text"
        onChange={(e) => onChange && onChange({ text: e.target.value })}
        onBlur={(e) => onLookup && onLookup(e.target.value)}
        placeholder="term or phrase"
        style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '7px 10px', color: C.txt, fontFamily: FONT, fontSize: 12, width: '100%', boxSizing: 'border-box', marginBottom: 10 }} />

      <Section label="Search as">
        <div style={{ display: 'flex', gap: 6 }}>
          <Opt active={t.type !== 'controlled'} onClick={() => onChange && onChange({ type: 'freetext' })}
            title="Finds your exact wording in titles/abstracts — catches new papers and author phrasing.">
            Plain words
          </Opt>
          <Opt active={t.type === 'controlled'} onClick={() => onLookup && onLookup(t.text, true)}
            title="Finds articles librarians tagged with this topic (MeSH) — precise, but misses very recent papers.">
            Subject heading
          </Opt>
        </div>
        {t.type === 'controlled' && !lk && (
          <div style={{ marginTop: 6, background: alpha(C.yel, '10'), border: `1px solid ${alpha(C.yel, '44')}`, borderRadius: 7, padding: '7px 10px', fontSize: 11, color: C.txt2, lineHeight: 1.5 }}>
            <strong style={{ color: C.yel }}>Heading not found.</strong> A subject heading with this name doesn&apos;t exist, so it would match nothing.
            <button type="button" onClick={() => onChange && onChange({ type: 'freetext' })}
              style={{ display: 'block', marginTop: 6, background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, cursor: 'pointer', fontSize: 10.5, fontWeight: 600, fontFamily: FONT, padding: '3px 10px' }}>
              Convert to keyword
            </button>
          </div>
        )}
        {t.type === 'controlled' && lk && (
          <div style={{ marginTop: 6, fontSize: 11, color: C.grn }}>✓ Matched subject heading: {lk.mesh}</div>
        )}
      </Section>

      {t.type === 'controlled' && lk && (
        <Section label="Include narrower topics?" help="explode">
          <div style={{ display: 'flex', gap: 6 }}>
            <Opt active={!t.noExplode} onClick={() => onChange && onChange({ noExplode: false })} title="Also searches every more-specific topic beneath this heading — broader.">Include narrower</Opt>
            <Opt active={!!t.noExplode} onClick={() => onChange && onChange({ noExplode: true })} title="Searches only this exact topic — narrower.">Just this topic</Opt>
          </div>
        </Section>
      )}

      {t.type !== 'controlled' && (
        <>
          <Section label="Where to look">
            <div style={{ display: 'flex', gap: 6 }}>
              <Opt active={t.field === 'ti'} onClick={() => onChange && onChange({ field: 'ti' })} title="Title only — strictest">Title</Opt>
              <Opt active={!t.field || t.field === 'tiab'} onClick={() => onChange && onChange({ field: 'tiab' })} title="Title & abstract — the usual choice">Title &amp; abstract</Opt>
              <Opt active={t.field === 'all'} onClick={() => onChange && onChange({ field: 'all' })} title="Anywhere in the record — broadest and noisiest">Everywhere</Opt>
            </div>
          </Section>
          {!String(t.text || '').includes(' ') && (
            <Section label="Word endings">
              <div style={{ display: 'flex', gap: 6 }}>
                <Opt active={!t.truncate} onClick={() => onChange && onChange({ truncate: false })}>Exact word</Opt>
                <Opt active={!!t.truncate} onClick={() => onChange && onChange({ truncate: true })} title={`${String(t.text || '').replace(/\*+$/, '')}* also finds different endings — broader`}>Match endings</Opt>
              </div>
            </Section>
          )}
          {String(t.text || '').includes(' ') && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, cursor: 'pointer', color: C.txt2, fontSize: 11 }}>
              <input type="checkbox" checked={t.phrase !== false} onChange={(e) => onChange && onChange({ phrase: e.target.checked })} />
              Search as exact phrase (recommended for multi-word terms)
            </label>
          )}
        </>
      )}

      {dupInfo && (
        <div style={{ background: alpha(C.yel, '0e'), border: `1px solid ${alpha(C.yel, '44')}`, borderRadius: 7, padding: '8px 10px', marginBottom: 10, fontSize: 11, color: C.txt2, lineHeight: 1.5 }}>
          <div style={{ marginBottom: 6 }}><strong style={{ color: C.yel }}>Also in {dupInfo.otherLabel}.</strong> Concepts combine with AND, so the duplicate can over-narrow the search.</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {dupInfo.onKeepHere && (
              <button type="button" onClick={dupInfo.onKeepHere}
                style={{ background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, cursor: 'pointer', fontSize: 10.5, fontWeight: 600, fontFamily: FONT, padding: '3px 10px' }}>
                Keep here, remove from {dupInfo.otherLabel}
              </button>
            )}
            {dupInfo.onMoveThere && (
              <button type="button" onClick={dupInfo.onMoveThere}
                style={{ background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, cursor: 'pointer', fontSize: 10.5, fontWeight: 600, fontFamily: FONT, padding: '3px 10px' }}>
                Keep in {dupInfo.otherLabel}, remove here
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', borderTop: `1px solid ${C.brd}`, paddingTop: 10 }}>
        <button type="button" onClick={onToggleDisabled}
          title={off ? 'Switch this term back into the search' : 'Keep the term but leave it out of the search (no delete)'}
          style={{ background: off ? alpha(C.grn, '10') : 'none', border: `1px solid ${off ? alpha(C.grn, '55') : C.brd2}`, borderRadius: 7, color: off ? C.grn : C.txt2, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: FONT, padding: '4px 12px', minHeight: 26 }}>
          {off ? 'Enable' : 'Disable'}
        </button>
        {targets.length > 0 && (
          <span style={{ position: 'relative', display: 'inline-block' }}>
            <button type="button" onClick={() => setMoveOpen((o) => !o)} aria-expanded={moveOpen}
              style={{ background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: FONT, padding: '4px 12px', minHeight: 26 }}>
              Move to concept…
            </button>
            {moveOpen && (
              <span style={{ position: 'absolute', zIndex: 75, bottom: 'calc(100% + 4px)', left: 0, background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 8, boxShadow: `0 14px 40px var(--t-shadow)`, overflow: 'hidden', minWidth: 180 }}>
                {targets.map((x) => (
                  <button key={x.id} type="button" onClick={() => { setMoveOpen(false); onMove && onMove(x.id); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: C.txt2, cursor: 'pointer', fontSize: 11.5, padding: '7px 10px', fontFamily: FONT, minHeight: 26 }}>
                    {x.label}
                  </button>
                ))}
              </span>
            )}
          </span>
        )}
        {onConvertSynonyms && lk && t.type !== 'controlled' && (Array.isArray(lk.synonyms) && lk.synonyms.length > 0) && (
          <button type="button" onClick={onConvertSynonyms}
            style={{ background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.acc, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: FONT, padding: '4px 12px', minHeight: 26 }}>
            + add {lk.synonyms.length} synonyms
          </button>
        )}
        <button type="button" onClick={onRemove}
          style={{ background: 'none', border: `1px solid ${alpha(C.red, '44')}`, borderRadius: 7, color: C.red, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: FONT, padding: '4px 12px', minHeight: 26 }}>
          Remove
        </button>
        <button type="button" onClick={onClose}
          style={{ marginLeft: 'auto', background: `linear-gradient(135deg,${C.acc},${C.acc2})`, border: 'none', borderRadius: 7, color: C.accText, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: FONT, padding: '5px 14px', minHeight: 26 }}>
          Done
        </button>
      </div>

      {!beginner && preview && (
        <div data-testid="sb-term-syntax-preview" style={{ marginTop: 10, fontSize: 10.5, color: C.muted, fontFamily: MONO, wordBreak: 'break-word' }}>
          Searches as: <span style={{ color: C.txt2 }}>{preview}</span>
        </div>
      )}
    </div>
  );
}
