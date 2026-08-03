/**
 * TermEditorPopover.jsx — 85.md A2, reworked by 97.md (Phases 6/9/11/12/13).
 * The term editor popover: text editable in place, plain-words ↔ MeSH toggle,
 * field scope, "Include narrower indexed terms" (explode), truncation, exact
 * phrase, Disable/Enable, reorder buttons, move / move-to-new-group, an EXPLICIT
 * copy action (default drag MOVES — duplication only through this), combine-into-
 * phrase and split-phrase (component history when available, a safe manual split
 * for edited phrases), duplicate-resolution actions (find other / move / remove /
 * keep both intentionally / dismiss), and a per-database preview line.
 *
 * These menu actions are the REQUIRED keyboard alternative for every drag gesture
 * (97.md Phase 21) — drag is never the only way.
 *
 * Popover behaviour: Escape closes (focus returns to the chip — TermChipRow),
 * flips/clamps inside the viewport. Presentational: all mutations go through
 * callbacks; `preview` is computed by the parent (no renderer import cycles).
 */
import { useEffect, useRef, useState } from 'react';
import { C, FONT, MONO, alpha } from '../../../frontend/theme/tokens.js';
import { splitTermInput } from '../../../research-engine/searchBuilder/termEntry.js';
import { DUP_RED_BORDER, DUP_RED_BG } from './TermChipRow.jsx';

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

const menuBtn = { background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: FONT, padding: '4px 12px', minHeight: 26 };
const menuItem = { display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', color: C.txt2, cursor: 'pointer', fontSize: 11.5, padding: '7px 10px', fontFamily: FONT, minHeight: 26 };
const dupActionBtn = { background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, cursor: 'pointer', fontSize: 10.5, fontWeight: 600, fontFamily: FONT, padding: '3px 10px' };

export default function TermEditorPopover({
  term, beginner, moveTargets, dupInfo, preview,
  onChange, onClose, onLookup, onToggleDisabled, onMove, onRemove,
  onReorder, canMoveEarlier, canMoveLater,
  // 97.md — new seams:
  onMoveToNewGroup,           // move this term into a brand-new search group
  onCopyTo,                   // (targetConceptId | null → new group) explicit COPY
  combineTargets,             // [{ id, text }] other terms in this group
  onCombineWith,              // (otherTermId) combine into one phrase
  onSplitPhrase,              // () restore recorded components (when available)
  onManualSplit,              // (parts:string[]) safe split for edited phrases
}) {
  const t = term || {};
  const lk = t.vocab;
  const off = t.disabled === true;
  const rootRef = useRef(null);
  const [pos, setPos] = useState({ dx: 0, flipUp: false });
  const [moveOpen, setMoveOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [combineOpen, setCombineOpen] = useState(false);
  const [splitDraft, setSplitDraft] = useState(null); // manual-split textarea value | null
  const components = Array.isArray(t.components) ? t.components.filter((c) => c && String(c.text || '').trim()) : [];
  const multiWord = String(t.text || '').trim().includes(' ');

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
  const combinable = Array.isArray(combineTargets) ? combineTargets : [];
  const manualParts = splitDraft != null ? splitTermInput(splitDraft).terms : [];
  const exactDup = dupInfo && (dupInfo.kind === 'exact-cross' || dupInfo.kind === 'exact-in-group');

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
            Free text
          </Opt>
          <Opt active={t.type === 'controlled'} onClick={() => onLookup && onLookup(t.text, true)}
            title="Finds articles indexers tagged with this MeSH term — precise, but misses very recent papers.">
            MeSH term
          </Opt>
        </div>
        {t.type === 'controlled' && !lk && (
          <div style={{ marginTop: 6, background: alpha(C.yel, '10'), border: `1px solid ${alpha(C.yel, '44')}`, borderRadius: 7, padding: '7px 10px', fontSize: 11, color: C.txt2, lineHeight: 1.5 }}>
            <strong style={{ color: C.yel }}>This is no longer a MeSH term.</strong> No MeSH heading matches this text, so it would match nothing.
            <button type="button" onClick={() => onChange && onChange({ type: 'freetext' })}
              style={{ display: 'block', marginTop: 6, background: 'none', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, cursor: 'pointer', fontSize: 10.5, fontWeight: 600, fontFamily: FONT, padding: '3px 10px' }}>
              Convert to free text
            </button>
          </div>
        )}
        {t.type === 'controlled' && lk && (
          <div style={{ marginTop: 6, fontSize: 11, color: C.grn }}>✓ Matched MeSH term: {lk.mesh}</div>
        )}
      </Section>

      {t.type === 'controlled' && lk && (
        <Section label="Include narrower indexed terms" help="explode">
          <div style={{ display: 'flex', gap: 6 }}>
            <Opt active={!t.noExplode} onClick={() => onChange && onChange({ noExplode: false })}
              title="Also matches records indexed under every more-specific MeSH heading beneath this one — broader.">
              Include narrower
            </Opt>
            <Opt active={!!t.noExplode} onClick={() => onChange && onChange({ noExplode: true })}
              title="Matches only records indexed with this exact heading — narrower.">
              Just this topic
            </Opt>
          </div>
          <div style={{ marginTop: 4, fontSize: 10, color: C.muted, lineHeight: 1.5 }}>
            This changes how the database&apos;s index is searched — it does not add any visible free-text terms.
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
          {!multiWord && (
            <Section label="Word endings">
              <div style={{ display: 'flex', gap: 6 }}>
                <Opt active={!t.truncate} onClick={() => onChange && onChange({ truncate: false })}>Exact word</Opt>
                <Opt active={!!t.truncate} onClick={() => onChange && onChange({ truncate: true })} title={`${String(t.text || '').replace(/\*+$/, '')}* also finds different endings — broader`}>Match endings</Opt>
              </div>
            </Section>
          )}
          {multiWord && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, cursor: 'pointer', color: C.txt2, fontSize: 11 }}>
              <input type="checkbox" checked={t.phrase !== false} onChange={(e) => onChange && onChange({ phrase: e.target.checked })} />
              Search as exact phrase (recommended for multi-word terms)
            </label>
          )}
        </>
      )}

      {/* 97.md Phase 12 — duplicate resolution (chip menu). Exact duplicates get the
          full action set; family variants only a soft, non-blocking note. */}
      {dupInfo && exactDup && (
        <div data-testid="sb-dup-actions" style={{ background: DUP_RED_BG, border: `1px solid ${DUP_RED_BORDER}`, borderRadius: 7, padding: '8px 10px', marginBottom: 10, fontSize: 11, color: C.txt, lineHeight: 1.5 }}>
          <div style={{ marginBottom: 6 }}>
            <strong><span aria-hidden="true">⚠ </span>Exact duplicate{dupInfo.kind === 'exact-in-group' ? ' in this group' : ' across AND groups'}.</strong>{' '}
            {dupInfo.kind === 'exact-in-group'
              ? `“${t.text}” appears more than once in this group — duplicate copies only add noise.`
              : `“${t.text}” also appears in ${dupInfo.otherLabel}. Because search groups are connected with AND, this may make the search unnecessarily restrictive.`}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {dupInfo.onFindOther && (
              <button type="button" onClick={dupInfo.onFindOther} style={dupActionBtn}>Find other duplicate</button>
            )}
            {dupInfo.onMoveThere && dupInfo.kind === 'exact-cross' && (
              <button type="button" onClick={dupInfo.onMoveThere} style={dupActionBtn}>Move to {dupInfo.otherLabel}</button>
            )}
            {dupInfo.onRemoveCopy && (
              <button type="button" onClick={dupInfo.onRemoveCopy} style={{ ...dupActionBtn, color: C.red, borderColor: alpha(C.red, '55') }}>Remove this copy</button>
            )}
            {dupInfo.onKeepBoth && dupInfo.kind === 'exact-cross' && (
              <button type="button" onClick={dupInfo.onKeepBoth} style={dupActionBtn}>Keep both intentionally</button>
            )}
            {dupInfo.onDismiss && dupInfo.kind === 'exact-cross' && (
              <button type="button" onClick={dupInfo.onDismiss} title="Hide this warning for this exact configuration — it returns if the terms or groups change" style={dupActionBtn}>Dismiss warning</button>
            )}
          </div>
        </div>
      )}
      {dupInfo && dupInfo.kind === 'variant' && (
        <div data-testid="sb-dup-variant-note" style={{ background: C.surf, border: `1px dashed ${C.brd2}`, borderRadius: 7, padding: '7px 10px', marginBottom: 10, fontSize: 11, color: C.txt2, lineHeight: 1.5 }}>
          <strong>Possible variant.</strong> A similar term lives in {dupInfo.otherLabel}. Similar terms can be valid synonyms — this is informational only.
        </div>
      )}
      {dupInfo && dupInfo.intentional && dupInfo.onUnkeep && (
        <div style={{ marginBottom: 10, fontSize: 11, color: C.muted, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Kept intentionally (duplicate warning muted for this configuration).</span>
          <button type="button" onClick={dupInfo.onUnkeep} style={dupActionBtn}>No longer intentional</button>
        </div>
      )}

      {onReorder && (
        <Section label="Position in this group">
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" data-testid="sb-term-move-earlier"
              onClick={() => canMoveEarlier && onReorder(-1)}
              disabled={!canMoveEarlier} aria-disabled={!canMoveEarlier || undefined}
              aria-label={`Move ${t.text || 'term'} earlier in the group`}
              title={canMoveEarlier ? 'Move this term earlier in the OR chain' : 'Already first in the group'}
              style={{
                flex: 1, cursor: canMoveEarlier ? 'pointer' : 'not-allowed', fontFamily: FONT, fontSize: 10.5, fontWeight: 600, minHeight: 26,
                color: C.txt2, background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, padding: '4px 6px', opacity: canMoveEarlier ? 1 : 0.5,
              }}>
              ↑ Move earlier
            </button>
            <button type="button" data-testid="sb-term-move-later"
              onClick={() => canMoveLater && onReorder(1)}
              disabled={!canMoveLater} aria-disabled={!canMoveLater || undefined}
              aria-label={`Move ${t.text || 'term'} later in the group`}
              title={canMoveLater ? 'Move this term later in the OR chain' : 'Already last in the group'}
              style={{
                flex: 1, cursor: canMoveLater ? 'pointer' : 'not-allowed', fontFamily: FONT, fontSize: 10.5, fontWeight: 600, minHeight: 26,
                color: C.txt2, background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, padding: '4px 6px', opacity: canMoveLater ? 1 : 0.5,
              }}>
              ↓ Move later
            </button>
          </div>
        </Section>
      )}

      {/* 97.md Phase 6 — combine / split (the keyboard alternative to drag-combine). */}
      {(combinable.length > 0 && onCombineWith) || ((components.length > 1 || multiWord) && (onSplitPhrase || onManualSplit)) ? (
        <Section label="Phrase">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {combinable.length > 0 && onCombineWith && (
              <span style={{ position: 'relative', display: 'inline-block' }}>
                <button type="button" data-testid="sb-combine-btn" onClick={() => { setCombineOpen((o) => !o); setMoveOpen(false); setCopyOpen(false); }} aria-expanded={combineOpen} style={menuBtn}>
                  Combine into a phrase…
                </button>
                {combineOpen && (
                  <span style={{ position: 'absolute', zIndex: 75, bottom: 'calc(100% + 4px)', left: 0, background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 8, boxShadow: `0 14px 40px var(--t-shadow)`, overflow: 'hidden', minWidth: 200 }}>
                    <span style={{ display: 'block', fontSize: 9, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase', padding: '6px 10px 2px' }}>Combine “{t.text}” with</span>
                    {combinable.map((x) => (
                      <button key={x.id} type="button" onClick={() => { setCombineOpen(false); onCombineWith(x.id); }} style={menuItem}>
                        {x.text}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            )}
            {components.length > 1 && onSplitPhrase && (
              <button type="button" data-testid="sb-split-phrase-btn" onClick={onSplitPhrase} style={menuBtn}
                title={`Restore the original parts: ${components.map((c) => c.text).join(' · ')}`}>
                Split phrase ({components.length} parts)
              </button>
            )}
            {/* QA M14 — an EDITED combined phrase (components no longer match the
                text — the parent passes no onSplitPhrase then) gets the SAFE
                manual split too, never a destructive stale-component guess. */}
            {!onSplitPhrase && multiWord && onManualSplit && splitDraft == null && (
              <button type="button" data-testid="sb-split-phrase-btn" onClick={() => setSplitDraft(String(t.text || '').trim().split(/\s+/).join('\n'))}
                title="This phrase's recorded parts are unknown or out of date — choose the split yourself (nothing is guessed)." style={menuBtn}>
                Split phrase…
              </button>
            )}
          </div>
          {splitDraft != null && (
            <div data-testid="sb-manual-split" style={{ marginTop: 8, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 7, padding: '8px 10px' }}>
              <div style={{ fontSize: 10.5, color: C.txt2, marginBottom: 6, lineHeight: 1.5 }}>
                One part per line — the phrase becomes these separate terms (its original parts are unknown, so nothing is split automatically).
              </div>
              <textarea value={splitDraft} onChange={(e) => setSplitDraft(e.target.value)} aria-label="Phrase parts, one per line"
                style={{ width: '100%', minHeight: 64, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 7, padding: 8, fontFamily: FONT, fontSize: 11.5, color: C.txt, boxSizing: 'border-box', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                <button type="button" disabled={manualParts.length < 2}
                  onClick={() => { if (manualParts.length >= 2 && onManualSplit) { onManualSplit(manualParts); setSplitDraft(null); } }}
                  style={{ ...menuBtn, color: manualParts.length >= 2 ? C.acc : C.muted, opacity: manualParts.length >= 2 ? 1 : 0.6 }}>
                  Split into {manualParts.length || 2} terms
                </button>
                <button type="button" onClick={() => setSplitDraft(null)} style={menuBtn}>Cancel</button>
              </div>
            </div>
          )}
        </Section>
      ) : null}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', borderTop: `1px solid ${C.brd}`, paddingTop: 10 }}>
        <button type="button" onClick={onToggleDisabled}
          title={off ? 'Switch this term back into the search' : 'Keep the term but leave it out of the search (no delete)'}
          style={{ background: off ? alpha(C.grn, '10') : 'none', border: `1px solid ${off ? alpha(C.grn, '55') : C.brd2}`, borderRadius: 7, color: off ? C.grn : C.txt2, cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: FONT, padding: '4px 12px', minHeight: 26 }}>
          {off ? 'Enable' : 'Disable'}
        </button>
        {(targets.length > 0 || onMoveToNewGroup) && (
          <span style={{ position: 'relative', display: 'inline-block' }}>
            <button type="button" onClick={() => { setMoveOpen((o) => !o); setCopyOpen(false); setCombineOpen(false); }} aria-expanded={moveOpen} style={menuBtn}>
              Move to group…
            </button>
            {moveOpen && (
              <span style={{ position: 'absolute', zIndex: 75, bottom: 'calc(100% + 4px)', left: 0, background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 8, boxShadow: `0 14px 40px var(--t-shadow)`, overflow: 'hidden', minWidth: 180 }}>
                {targets.map((x) => (
                  <button key={x.id} type="button" onClick={() => { setMoveOpen(false); onMove && onMove(x.id); }} style={menuItem}>
                    {x.label}
                  </button>
                ))}
                {onMoveToNewGroup && (
                  <button type="button" data-testid="sb-move-new-group" onClick={() => { setMoveOpen(false); onMoveToNewGroup(); }}
                    style={{ ...menuItem, color: C.acc, borderTop: targets.length ? `1px solid ${C.brd}` : 'none' }}>
                    ＋ New search group
                  </button>
                )}
              </span>
            )}
          </span>
        )}
        {onCopyTo && (
          <span style={{ position: 'relative', display: 'inline-block' }}>
            <button type="button" data-testid="sb-copy-btn" onClick={() => { setCopyOpen((o) => !o); setMoveOpen(false); setCombineOpen(false); }} aria-expanded={copyOpen}
              title="Duplicate this term intentionally into another group (dragging always MOVES — copying is explicit)" style={menuBtn}>
              Copy to group…
            </button>
            {copyOpen && (
              <span style={{ position: 'absolute', zIndex: 75, bottom: 'calc(100% + 4px)', left: 0, background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 8, boxShadow: `0 14px 40px var(--t-shadow)`, overflow: 'hidden', minWidth: 180 }}>
                {targets.map((x) => (
                  <button key={x.id} type="button" onClick={() => { setCopyOpen(false); onCopyTo(x.id); }} style={menuItem}>
                    {x.label}
                  </button>
                ))}
                <button type="button" onClick={() => { setCopyOpen(false); onCopyTo(null); }}
                  style={{ ...menuItem, color: C.acc, borderTop: targets.length ? `1px solid ${C.brd}` : 'none' }}>
                  ＋ New search group
                </button>
              </span>
            )}
          </span>
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
