/**
 * features/extraction/engine/ConverterPanel.jsx — 77.md §4 (restore the Converter).
 *
 * The legacy "Data Conversion" tool (formerly a modal in the classic extraction tab,
 * src/frontend/workspace/tabs/extractionTabs.jsx ConversionPanel) restored as an
 * INLINE panel inside the Pecan Extraction Engine, in the slot the parked
 * "Also reported (not in this review)" list used to occupy.
 *
 * It reuses the pure, tested conversion catalogue (research-engine/conversions/catalogue.js
 * — NOT the monolith, so the engine bundle stays lean) and never writes study fields
 * itself: every apply routes through `onApply({ patch, conversion, targetLabel })` so the
 * workspace applies the SAME immediate-replace + provenance + conversions-audit path as
 * click-to-pick (no silent overwrite, ln-scale contract preserved).
 *
 * Design-system compliant (C/token styles → light+dark), keyboard-navigable (native
 * controls), accessible (labelled inputs, aria-live result, explicit units + direction),
 * and cross-browser (no browser-specific APIs).
 */
import { useMemo, useState } from 'react';
import { CONVERSIONS } from '../../../research-engine/conversions/catalogue.js';
import { C, btnS, inp, lbl } from '../../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';

/* Which study fields a conversion result can be applied to, given its output shape.
   Mirrors the legacy apply() targets so behaviour is familiar. */
function targetsFor(values) {
  const v = values || {};
  const t = [];
  if (v.mean != null && v.sd != null) {
    t.push(['continuous_exp', '→ Intervention mean & SD']);
    t.push(['continuous_ctrl', '→ Control mean & SD']);
  } else if (v.sd != null) {
    t.push(['sd_exp', '→ Intervention SD']);
    t.push(['sd_ctrl', '→ Control SD']);
  }
  if (v.events != null) t.push(['counts', '→ Events / total']);
  if (v.es != null) t.push(['es', '→ Effect size + 95% CI (log scale)']);
  return t;
}

/** Map a target + result values → the study-field patch it writes. */
function patchFor(target, values) {
  const v = values || {};
  const p = {};
  if (target === 'continuous_exp') { if (v.mean != null) p.meanExp = String(v.mean); if (v.sd != null) p.sdExp = String(v.sd); }
  else if (target === 'continuous_ctrl') { if (v.mean != null) p.meanCtrl = String(v.mean); if (v.sd != null) p.sdCtrl = String(v.sd); }
  else if (target === 'sd_exp') { if (v.sd != null) p.sdExp = String(v.sd); }
  else if (target === 'sd_ctrl') { if (v.sd != null) p.sdCtrl = String(v.sd); }
  else if (target === 'counts') { if (v.events != null) p.events = String(v.events); if (v.total != null) p.total = String(v.total); }
  else if (target === 'es') { if (v.es != null) p.es = String(v.es); if (v.lo != null) p.lo = String(v.lo); if (v.hi != null) p.hi = String(v.hi); }
  return p;
}

export default function ConverterPanel({ onApply, disabled = false, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [convId, setConvId] = useState(CONVERSIONS[0].id);
  const [vals, setVals] = useState({});
  const [reason, setReason] = useState('');
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');

  const conv = useMemo(() => CONVERSIONS.find((c) => c.id === convId) || CONVERSIONS[0], [convId]);
  const groups = useMemo(() => [...new Set(CONVERSIONS.map((c) => c.group))], []);
  const targets = res ? targetsFor(res.values) : [];

  const setInput = (k, v) => setVals((prev) => ({ ...prev, [k]: v }));
  const pickConversion = (id) => { setConvId(id); setRes(null); setErr(''); setVals({}); };

  const compute = () => {
    setErr('');
    const r = conv.run(vals);
    if (!r || !r.ok) { setRes(null); setErr((r && r.error) || 'Check the inputs.'); return; }
    setRes(r);
  };

  const apply = (target) => {
    if (!res || disabled || !onApply) return;
    const patch = patchFor(target, res.values);
    if (!Object.keys(patch).length) return;
    onApply({
      patch,
      targetLabel: (targets.find(([t]) => t === target) || [null, target])[1],
      conversion: { type: conv.id, label: conv.label, method: conv.method, formula: res.formula, detail: res.detail, inputs: { ...vals }, reason: reason || '' },
    });
  };

  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 8, background: C.card, overflow: 'hidden' }} data-testid="pex-converter">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer', color: C.txt }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: C.muted }}>🔄 CONVERTER</span>
        <span style={{ fontSize: 11, color: C.dim }}>{open ? 'Hide' : 'Recover mean/SD, SE, counts, log-ratios…'}</span>
      </button>

      {open && (
        <div style={{ padding: '4px 12px 14px' }}>
          <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.5, margin: '2px 0 10px' }}>
            Convert a reported statistic into the form the analysis needs. The original numbers are preserved — the
            converted value is labelled, logged with its formula, and only applied when you choose a target field.
          </p>

          <label style={lbl} htmlFor="pex-conv-select">Conversion</label>
          <select id="pex-conv-select" value={convId} onChange={(e) => pickConversion(e.target.value)} disabled={disabled}
            style={{ ...inp, marginBottom: 10, fontSize: 12 }}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {CONVERSIONS.filter((c) => c.group === g).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </optgroup>
            ))}
          </select>

          <div style={{ background: C.bg, border: `1px solid ${themeAlpha(C.acc, '33')}`, borderLeft: `3px solid ${C.acc}`, borderRadius: 6, padding: '8px 11px', marginBottom: 10, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
            <strong style={{ color: C.acc }}>Method:</strong> {conv.method}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            {conv.inputs.map(([k, label]) => (
              <div key={k}>
                <label style={lbl} htmlFor={`pex-conv-${k}`}>{label}</label>
                <input id={`pex-conv-${k}`} value={vals[k] || ''} onChange={(e) => setInput(k, e.target.value)} disabled={disabled}
                  inputMode="decimal" placeholder={label}
                  style={{ ...inp, fontSize: 12, fontFamily: "'IBM Plex Mono',monospace" }} />
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={lbl} htmlFor="pex-conv-reason">Reason / assumption (optional)</label>
            <input id="pex-conv-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={disabled}
              placeholder="e.g. SD not reported; recovered from the 95% CI" style={{ ...inp, fontSize: 12 }} />
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: res ? 10 : 0, flexWrap: 'wrap' }}>
            <button type="button" onClick={compute} disabled={disabled} style={{ ...btnS('primary'), fontSize: 12 }}>Compute →</button>
            {err && <span role="alert" style={{ fontSize: 11.5, color: C.red }}>{err}</span>}
          </div>

          {res && (
            <div aria-live="polite" style={{ background: C.bg, border: `1px solid ${themeAlpha(C.grn, '44')}`, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.grn, letterSpacing: 0.5, marginBottom: 6 }}>RESULT</div>
              <div style={{ fontSize: 13, fontFamily: "'IBM Plex Mono',monospace", color: C.grn, marginBottom: 6 }}>{res.detail}</div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}><strong style={{ color: C.txt }}>Formula:</strong> {res.formula}</div>
              {targets.length > 0 ? (
                <>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 7 }}>Apply the converted value to:</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {targets.map(([t, label]) => (
                      <button key={t} type="button" onClick={() => apply(t)} disabled={disabled} style={{ ...btnS('ghost'), fontSize: 11 }}>{label}</button>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: C.muted }}>
                  This result is informational (e.g. an SE or a percentage). Copy it into the relevant field, or use it as
                  an input to another conversion: <strong style={{ color: C.txt, fontFamily: "'IBM Plex Mono',monospace" }}>{JSON.stringify(res.values)}</strong>
                </div>
              )}
              <div style={{ fontSize: 10.5, color: C.yel, marginTop: 10, lineHeight: 1.5 }}>
                ⚠ The original reported numbers stay in the conversion log; converted values are tagged so the analysis can flag reliance on indirect data.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
