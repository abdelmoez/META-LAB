/**
 * ExportDialog.jsx — the shared export dialog every download routes through
 * (prompt9 Task 6). Dependency-free; theme tokens + alpha() only.
 *
 * FROZEN adapter contract (F-monolith / F-sift / F-ops wire triggers to this):
 *
 *   <ExportDialog open onClose={fn} item={item} precision={precision} />
 *
 *   item = {
 *     id: string,
 *     title: string,                       // dialog heading
 *     formats: [{ id, label }],            // ONLY the formats valid for this item
 *     sizing: boolean,                     // true → PNG preset/size/transparent UI
 *     variants?: [{ id, label }],          // e.g. light/dark figure variants
 *     defaults?: { format?, presetId?, variantId? },
 *     run: async (choice) => void,         // performs the actual export/download
 *   }
 *   precision = { decimals: 2|3|4|5|6, trailingZeros: boolean }  (optional)
 *     — project-level precision passed from the monolith; the user can override
 *       it for this export only using the "Decimal places" selector in the dialog.
 *       Machine formats (CSV/JSON) always export raw full-precision values.
 *       Report/figure formats (SVG/PNG/table text) respect the chosen precision.
 *
 *   choice = { format, presetId, widthPx, transparent, variantId, precision }
 *     — presetId/widthPx/transparent are undefined/false unless
 *       (item.sizing && format === 'png'); variantId undefined without variants.
 *       precision = { decimals, trailingZeros, full } — full=true when user picks
 *       "Full precision (raw values)".
 *
 * Rendered through createPortal(document.body): trigger buttons live inside
 * the monolith's animated `.tab-content` (a transformed ancestor that hijacks
 * position:fixed) and inside z-9999 fixed wrappers — the portal keeps the
 * overlay in the ROOT stacking context at z 10000 everywhere.
 */
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import { PRESETS, validateCustomSize } from './exportCore.js';
import { DECIMAL_OPTIONS, DEFAULT_DECIMALS } from '../../research-engine/format/precision.js';

const sectionLabel = {
  fontSize: 10, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: C.muted, marginBottom: 7,
};

const fieldStyle = {
  width: '100%', boxSizing: 'border-box', background: C.surf,
  border: `1px solid ${C.brd2}`, borderRadius: 8, padding: '8px 10px',
  color: C.txt, fontSize: 12.5, fontFamily: FONT, outline: 'none',
};

function Spinner({ size = 13 }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      border: `2px solid ${C.brd2}`, borderTopColor: C.acc,
      borderRadius: '50%', animation: 'exp-spin 0.7s linear infinite',
    }} />
  );
}

// Machine formats (CSV/JSON) always export at full/raw precision; the
// precision selector applies to report/figure-style outputs (SVG/PNG/table text).
const MACHINE_FORMATS = new Set(['csv', 'json', 'ris', 'bib']);

export default function ExportDialog({ open, onClose, item, precision }) {
  const [format, setFormat]           = useState(null);
  const [presetId, setPresetId]       = useState(PRESETS[0].id);
  const [customPx, setCustomPx]       = useState('1600');
  const [transparent, setTransparent] = useState(false);
  const [variantId, setVariantId]     = useState(null);
  const [running, setRunning]         = useState(false);
  const [progress, setProgress]       = useState('');   // prompt42 — live step text from run()
  const [error, setError]             = useState(null);
  // Precision selector: default from the project-level precision prop.
  // 'full' means raw unrounded values (overrides decimals for report formats).
  const defaultDecimals = precision?.decimals ?? DEFAULT_DECIMALS;
  const [decimals, setDecimals]       = useState(defaultDecimals);
  const [fullPrec, setFullPrec]       = useState(false);
  const [trailZeros, setTrailZeros]   = useState(precision?.trailingZeros !== false);

  // (Re)initialise from item.defaults each time the dialog opens.
  useEffect(() => {
    if (!open || !item) return;
    const d = item.defaults || {};
    setFormat(d.format || item.formats?.[0]?.id || null);
    setPresetId(d.presetId || PRESETS[0].id);
    setVariantId(d.variantId || item.variants?.[0]?.id || null);
    setCustomPx('1600');
    setTransparent(false);
    setRunning(false);
    setProgress('');
    setError(null);
    setDecimals(precision?.decimals ?? DEFAULT_DECIMALS);
    setFullPrec(false);
    setTrailZeros(precision?.trailingZeros !== false);
  }, [open, item, precision]);

  const close = useCallback(() => { if (!running) onClose?.(); }, [running, onClose]);

  // Escape closes (no-op while an export is running).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open || !item) return null;

  // PNG figures and the journal ZIP (which contains figure PNGs) both offer the
  // size selector; prompt42 Task 8.
  const showSizing = !!item.sizing && (format === 'png' || format === 'zip');
  const custom = presetId === 'custom' ? validateCustomSize(customPx) : null;
  const sizeInvalid = showSizing && presetId === 'custom' && !(custom && custom.ok);

  // Resolved precision for this export.
  // Machine formats (CSV/JSON/RIS/BIB) always get full/raw precision regardless
  // of the user's selector — lossless data is always correct for those formats.
  // Report/figure formats (SVG/PNG/table text) use the selected precision.
  const isMachine = format ? MACHINE_FORMATS.has(format.toLowerCase()) : false;
  const chosenPrecision = isMachine
    ? { decimals: DEFAULT_DECIMALS, trailingZeros: true, full: true }
    : { decimals, trailingZeros: trailZeros, full: fullPrec };

  // One-click "validation table" preset: fixed decimals + trailing zeros, no
  // raw-precision collapsing — the journal/metafor-comparison-friendly style.
  const applyValidationPreset = () => {
    setFullPrec(false);
    setDecimals(precision?.decimals ?? DEFAULT_DECIMALS);
    setTrailZeros(true);
    setError(null);
  };

  const runExport = async () => {
    if (running || !format) return;
    let widthPx;
    if (showSizing) {
      if (presetId === 'custom') {
        const v = validateCustomSize(customPx);
        if (!v.ok) { setError(v.error); return; }
        widthPx = v.value;
      } else {
        widthPx = PRESETS.find(p => p.id === presetId)?.px;
      }
    }
    setRunning(true); setError(null); setProgress('');
    try {
      // 2nd arg = progress reporter (optional; older run() functions ignore it).
      await item.run({
        format,
        presetId: showSizing ? presetId : undefined,
        widthPx,
        transparent: showSizing ? transparent : false,
        variantId: item.variants?.length ? variantId : undefined,
        precision: chosenPrecision,
      }, (msg) => setProgress(String(msg || '')));
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Export failed. Please try again.');
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000, background: alpha(C.bg, 0.55),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: FONT, animation: 'exp-fade 0.15s ease', padding: 16,
      }}>
      <style>{`
        @keyframes exp-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes exp-spin { to { transform: rotate(360deg); } }
      `}</style>
      <div
        role="dialog" aria-modal="true" aria-label={`Export ${item.title}`}
        style={{
          width: 'min(440px, 94vw)', maxHeight: '90vh', overflowY: 'auto',
          background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 12,
          boxShadow: `0 24px 64px ${C.shadow}`, padding: '18px 20px 16px', color: C.txt,
        }}>

        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
          <span className="t-truncate" title={item.title} style={{ fontSize: 14.5, fontWeight: 700 }}>Export — {item.title}</span>
        </div>

        {/* Format radio group (only this item's valid formats) */}
        <div style={{ marginBottom: 14 }}>
          <div style={sectionLabel}>Format</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(item.formats || []).map(f => (
              <label key={f.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px',
                border: `1px solid ${format === f.id ? alpha(C.acc, '60') : C.brd}`,
                background: format === f.id ? alpha(C.acc, '14') : 'transparent',
                borderRadius: 8, cursor: 'pointer', fontSize: 12.5, color: C.txt,
              }}>
                <input
                  type="radio" name="exp-format" value={f.id}
                  checked={format === f.id}
                  onChange={() => { setFormat(f.id); setError(null); }}
                  style={{ accentColor: C.acc, margin: 0 }}
                />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        {/* Size presets — figures only, PNG only */}
        {showSizing && (
          <div style={{ marginBottom: 14 }}>
            <div style={sectionLabel}>Size</div>
            <select value={presetId} onChange={e => { setPresetId(e.target.value); setError(null); }} style={fieldStyle}>
              {PRESETS.map(p => (
                <option key={p.id} value={p.id}>
                  {p.label}{p.px ? ` — ${p.px}px` : ''}{p.note ? ` (${p.note})` : ''}
                </option>
              ))}
            </select>
            {presetId === 'custom' && (
              <div style={{ marginTop: 8 }}>
                <input
                  type="number" min={320} max={6000} step={10} value={customPx}
                  onChange={e => { setCustomPx(e.target.value); setError(null); }}
                  placeholder="Width in px (320–6000)"
                  style={{ ...fieldStyle, fontFamily: MONO }}
                />
                {custom && !custom.ok && (
                  <div style={{ fontSize: 11, color: C.red, marginTop: 5 }}>{custom.error}</div>
                )}
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 9, fontSize: 12, color: C.txt2, cursor: 'pointer' }}>
              <input
                type="checkbox" checked={transparent}
                onChange={e => setTransparent(e.target.checked)}
                style={{ accentColor: C.acc, margin: 0 }}
              />
              Transparent background
            </label>
          </div>
        )}

        {/* Variant (e.g. light/dark) */}
        {!!item.variants?.length && (
          <div style={{ marginBottom: 14 }}>
            <div style={sectionLabel}>Variant</div>
            <select value={variantId || ''} onChange={e => setVariantId(e.target.value)} style={fieldStyle}>
              {item.variants.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
        )}

        {/* Decimal places — report/figure formats only.
            Machine formats (CSV/JSON/RIS/BIB) are always exported at raw precision
            for lossless data; this selector is hidden for those formats. */}
        {!isMachine && (
          <div style={{ marginBottom: 14 }}>
            <div style={sectionLabel}>Decimal places</div>
            <select
              value={fullPrec ? 'full' : String(decimals)}
              onChange={e => {
                if (e.target.value === 'full') { setFullPrec(true); }
                else { setFullPrec(false); setDecimals(Number(e.target.value)); }
                setError(null);
              }}
              style={fieldStyle}
              disabled={isMachine}
            >
              {DECIMAL_OPTIONS.map(d => (
                <option key={d} value={String(d)}>
                  {d} decimal{d !== 1 ? 's' : ''}{d === defaultDecimals ? ' (project default)' : ''}
                </option>
              ))}
              <option value="full">Full precision (raw values)</option>
            </select>
            {fullPrec && (
              <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, marginTop: 5, letterSpacing: '0.03em' }}>
                Raw unrounded values — recommended for supplementary tables.
              </div>
            )}
            {!fullPrec && decimals !== defaultDecimals && (
              <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, marginTop: 5, letterSpacing: '0.03em' }}>
                Overrides the project default ({defaultDecimals} dp) for this export only.
              </div>
            )}
            {!fullPrec && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 9, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.txt2, cursor: 'pointer' }}>
                  <input type="checkbox" checked={trailZeros} onChange={e => setTrailZeros(e.target.checked)} style={{ accentColor: C.acc, margin: 0 }} />
                  Keep trailing zeros
                </label>
                <button
                  type="button" onClick={applyValidationPreset}
                  title="Fixed decimals with trailing zeros — journal / metafor-comparison style"
                  style={{
                    background: 'none', border: `1px solid ${C.brd2}`, color: C.txt2,
                    fontSize: 11, fontFamily: FONT, fontWeight: 600, borderRadius: 7,
                    padding: '4px 10px', cursor: 'pointer',
                  }}>Validation table preset</button>
              </div>
            )}
          </div>
        )}
        {isMachine && format && (
          <div style={{ marginBottom: 14, padding: '7px 10px', background: alpha(C.acc, '0a'), border: `1px solid ${alpha(C.acc, '20')}`, borderRadius: 7 }}>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {format.toUpperCase()} — exported at full raw precision (lossless data format)
            </span>
          </div>
        )}

        {/* Inline error */}
        {error && (
          <div style={{
            marginBottom: 12, padding: '8px 11px', background: C.redBg,
            border: `1px solid ${alpha(C.red, 0.35)}`, borderRadius: 8,
            color: C.red, fontSize: 12, lineHeight: 1.45,
          }}>{error}</div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 4 }}>
          <button
            type="button" onClick={close} disabled={running}
            style={{
              background: 'none', border: `1px solid ${C.brd2}`, color: C.txt2,
              fontSize: 12.5, fontFamily: FONT, fontWeight: 600, borderRadius: 8,
              padding: '8px 14px', cursor: running ? 'not-allowed' : 'pointer',
              opacity: running ? 0.5 : 1,
            }}>Cancel</button>
          <button
            type="button" onClick={runExport} disabled={running || !format || sizeInvalid}
            style={{
              background: C.acc2, border: 'none', color: C.accText,
              fontSize: 12.5, fontFamily: FONT, fontWeight: 600, borderRadius: 8,
              padding: '8px 18px', minWidth: 86, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', gap: 7,
              cursor: running || !format || sizeInvalid ? 'not-allowed' : 'pointer',
              opacity: running || !format || sizeInvalid ? 0.55 : 1,
            }}>
            {running ? <><Spinner /> {progress || 'Exporting…'}</> : 'Export'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
