/**
 * picoUi.jsx — prompt40 Task 1. Presentational helpers that restore visual parity
 * between the server-backed ProtocolModulePanel and the legacy in-monolith PICOTab
 * (SectionHeader, InfoBox, HelpTip, CriteriaList). Faithful re-implementations of
 * the monolith components, kept self-contained in the feature module (no monolith
 * coupling) and built on the shared app Icon/Tooltip + design tokens.
 */
import { useState } from 'react';
import { C, FONT, alpha } from '../../frontend/theme/tokens.js';
import Icon from '../../frontend/components/icons.jsx';
import Tooltip from '../../frontend/components/Tooltip.jsx';

export const lbl = { fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6, display: 'block' };
export const inp = {
  width: '100%', boxSizing: 'border-box', background: C.card, color: C.txt,
  border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 12px',
  fontSize: 13, fontFamily: FONT, outline: 'none',
};

export function SectionHeader({ icon, title, desc }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 7 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: alpha(C.acc, '18'), border: `1px solid ${alpha(C.acc, '28')}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.acc, flexShrink: 0 }}>
          <Icon name={icon} size={15} />
        </div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: -0.4, color: C.txt, lineHeight: 1.2 }}>{title}</h2>
      </div>
      {desc && <p style={{ margin: 0, fontSize: 12.5, color: C.muted, lineHeight: 1.7, paddingLeft: 46 }}>{desc}</p>}
    </div>
  );
}

export function InfoBox({ children, color }) {
  const col = color || C.acc;
  return (
    <div style={{ background: alpha(col, '0c'), border: `1px solid ${alpha(col, '22')}`, borderLeft: `3px solid ${alpha(col, '80')}`, borderRadius: 10, padding: '12px 16px', marginTop: 14, fontSize: 12.5, color: C.txt2, lineHeight: 1.7 }}>
      {children}
    </div>
  );
}

export function HelpTip({ text }) {
  return (
    <Tooltip content={text} wrapStyle={{ display: 'inline-flex', marginLeft: 6 }}>
      <span style={{ width: 16, height: 16, borderRadius: '50%', border: `1px solid ${C.brd2}`, color: C.muted, background: C.card2, fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'help' }}>?</span>
    </Tooltip>
  );
}

/**
 * CriteriaList — interactive add/remove criterion rows. Parses + serialises back
 * to the SAME "• item\n• item" string stored in protocol incl/excl, so screening
 * keyword extraction, export, and older projects keep working unchanged. Faithful
 * to the legacy monolith CriteriaList.
 */
export function CriteriaList({ value, onChange, accent, placeholders, disabled }) {
  const rows = String(value || '').split('\n').map((l) => l.replace(/^\s*[•\-*]\s?/, ''));
  const eff = rows.length ? rows : [''];
  const commit = (next) => onChange(next.map((r) => `• ${r}`).join('\n'));
  const upd = (i, v) => { const n = [...eff]; n[i] = v; commit(n); };
  const add = () => commit([...eff, '']);
  const remove = (i) => { const n = eff.filter((_, j) => j !== i); commit(n.length ? n : ['']); };
  const ph = placeholders || [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      {eff.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={r} onChange={(e) => upd(i, e.target.value)} disabled={disabled}
            placeholder={ph[i] || ph[ph.length - 1] || 'Add a criterion…'}
            style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 6, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} />
          <button type="button" onClick={() => remove(i)} disabled={disabled} title="Remove criterion" aria-label="Remove criterion"
            style={{ background: 'none', border: `1px solid ${C.brd}`, color: C.muted, cursor: disabled ? 'default' : 'pointer', borderRadius: 6, width: 28, height: 28, flexShrink: 0, lineHeight: 1, fontSize: 15 }}>×</button>
        </div>
      ))}
      {!disabled && (
        <button type="button" onClick={add}
          style={{ alignSelf: 'flex-start', background: alpha(accent, '14'), border: `1px dashed ${alpha(accent, '55')}`, color: accent, cursor: 'pointer', borderRadius: 6, padding: '6px 12px', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', marginTop: 2 }}>
          + Add criterion
        </button>
      )}
    </div>
  );
}

/** Required-PICO completion card (matches the legacy progress indicator). */
export function RequiredPicoCard({ filled, total }) {
  const done = filled === total;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: done ? C.grn : C.yel, marginBottom: 4 }}>
        {done ? '✓ All required PICO fields complete' : `${filled}/${total} required fields filled — P, I, C, and O are mandatory`}
      </div>
      <div style={{ height: 4, background: C.brd, borderRadius: 2 }}>
        <div style={{ height: 4, background: done ? C.grn : C.yel, borderRadius: 2, width: `${(filled / total) * 100}%`, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

// A purple token for the Outcome card (the monolith uses C.purp; tokens expose it).
export const PURPLE = C.purp || C.acc2 || C.acc;
