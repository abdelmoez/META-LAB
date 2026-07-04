/**
 * AssistedExtractionPanel.jsx — RoadMap/1.md. The ONE unified extraction workspace:
 * inline PDF (left) + the four extraction methods (right), all writing the same
 * protocol-scoped per-outcome record model. Deterministic by default; the optional
 * LLM boost is a separate, clearly-labeled, off-by-default toggle.
 *
 *  1. Auto-generate  — deterministic first pass over the PDF/abstract text.
 *  2. Pick-a-source  — drag a region: a TABLE parses to a grid, a FIGURE opens the
 *                      local plot digitizer (KM→HR via Guyot, forest/bar/box/scatter).
 *  3. Click-assign   — click a number in the PDF to push it into a chosen field.
 *  4. Manual         — the classic study card below (always available).
 *
 * Nothing here writes directly into the analysable dataset without a human: methods
 * 1–2 produce DRAFTS the reviewer confirms; method 3 fills the selected study's own
 * fields (a fast manual aid) and is fully editable/auditable.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import AppPdfViewer from '../../../frontend/components/AppPdfViewer.jsx';
import { C, btnS, inp, lbl } from '../../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';
import { usePdfSource } from './usePdfSource.js';
import { renderRegionToDataUrl } from './renderRegion.js';
import PlotDigitizer from './PlotDigitizer.jsx';
import TableRegionMapper from './TableRegionMapper.jsx';
import { autoExtract } from '../../../research-engine/extraction/autoExtract.js';
import { normalizeItems, itemsToRows, detectColumns, buildGrid } from '../../../research-engine/extraction/pdfTextGrid.js';
import { mkExtractionRecord } from '../../../research-engine/extraction/records.js';
import { aiExtractStatus, aiExtract } from '../../../frontend/services/aiExtractService.js';

const ASSIGN_FIELDS = [
  ['es', 'Effect size (es)'], ['lo', 'CI lower'], ['hi', 'CI upper'],
  ['a', '2×2 a (event/Exp)'], ['b', '2×2 b (no event/Exp)'], ['c', '2×2 c (event/Ctrl)'], ['d', '2×2 d (no event/Ctrl)'],
  ['nExp', 'n (Exp)'], ['meanExp', 'mean (Exp)'], ['sdExp', 'SD (Exp)'],
  ['nCtrl', 'n (Ctrl)'], ['meanCtrl', 'mean (Ctrl)'], ['sdCtrl', 'SD (Ctrl)'],
  ['events', 'events'], ['total', 'total'], ['n', 'Total N'],
];

const firstNumber = (s) => {
  const m = String(s || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? m[0] : null;
};

export default function AssistedExtractionPanel({
  projectId, studies = [], outcomes = [], protocol = { outcomes: [] },
  selectedStudyId, onSelectStudy, onAddBlankStudy,
  onAddDrafts, onAddParked, onPatchStudy, readOnly = false,
}) {
  const [method, setMethod] = useState('auto');       // auto | pick | click | manual
  const [pickKind, setPickKind] = useState('table');  // table | figure
  const [assignField, setAssignField] = useState('es');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [digitizer, setDigitizer] = useState(null);   // { imageUrl, region, page } | null
  const [tableModal, setTableModal] = useState(null);  // { grid, region, page } | null
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiOn, setAiOn] = useState(false);            // OFF by default, per session
  const docRef = useRef(null);

  const study = useMemo(() => studies.find((s) => s.id === selectedStudyId) || null, [studies, selectedStudyId]);
  const pdf = usePdfSource(study, projectId);

  // Probe the optional LLM proxy once (fail-closed). Never auto-enables.
  useMemo(() => { aiExtractStatus().then((r) => setAiAvailable(!!(r && r.available))).catch(() => setAiAvailable(false)); return null; }, []);

  const interaction = useMemo(() => {
    if (readOnly || !pdf.url) return null;
    if (method === 'click') {
      return {
        mode: 'click',
        onTextClick: ({ str }) => {
          const num = firstNumber(str);
          if (num == null) { setStatus(`"${str}" has no number to assign.`); return; }
          if (!study) { setStatus('Pick a study first.'); return; }
          onPatchStudy && onPatchStudy(study.id, { [assignField]: num, source: study.source || 'text' });
          setStatus(`Assigned ${num} → ${assignField}.`);
        },
      };
    }
    if (method === 'pick') {
      return { mode: 'region', onRegion: handleRegion };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, pickKind, assignField, study, pdf.url, readOnly]);

  async function handleRegion({ page, region }) {
    setError(''); setStatus('');
    const doc = docRef.current;
    if (!doc) { setError('PDF is still loading.'); return; }
    try {
      if (pickKind === 'figure') {
        setStatus('Rendering the figure region…');
        const { dataUrl } = await renderRegionToDataUrl(doc, page, region, { maxWidth: 900 });
        setDigitizer({ imageUrl: dataUrl, region, page });
        setStatus('');
      } else {
        setStatus('Reading the table region…');
        const p = await doc.getPage(page);
        const content = await p.getTextContent();
        const items = normalizeItems(content.items || []);
        const inRegion = items.filter((it) => it.x >= region.x0 && it.x <= region.x1 && it.y >= region.y0 && it.y <= region.y1);
        const rows = itemsToRows(inRegion);
        const cols = detectColumns(rows);
        if (rows.length < 2 || cols.length < 2) {
          setError('That region did not look like a table (need ≥2 rows and ≥2 columns). Try a tighter selection, or use the figure digitizer.');
          setStatus('');
          return;
        }
        const grid = buildGrid(rows, cols);
        setTableModal({ grid, region, page });
        setStatus('');
      }
    } catch (e) {
      setError(e.message || 'Could not read that region.');
      setStatus('');
    }
  }

  const runAuto = useCallback(async () => {
    setError(''); setStatus(''); setBusy(true);
    try {
      let pages = [];
      if (pdf.url) {
        setStatus('Reading the PDF text…');
        const r = await pdf.extractPages();
        pages = r.pages;
      }
      const abstract = (study && study.abstract) || '';
      if (!pages.length && !abstract) {
        setError('No PDF text or abstract to read. Attach a PDF, or paste an abstract into the study’s citation metadata.');
        setBusy(false); return;
      }
      const at = new Date().toISOString();
      const { drafts, alsoReported, log } = autoExtract({ pages, abstract, protocol, baseStudy: study, at });
      onAddDrafts && onAddDrafts(drafts);
      onAddParked && onAddParked(alsoReported);
      setStatus(log[log.length - 1] || `Found ${drafts.length} draft(s).`);
    } catch (e) {
      setError(e.message || 'Auto-extract failed.');
    } finally {
      setBusy(false);
    }
  }, [pdf, study, protocol, onAddDrafts, onAddParked]);

  const runAi = useCallback(async () => {
    setError(''); setStatus(''); setBusy(true);
    try {
      let pdfBase64 = null, text = null;
      if (pdf.url) {
        const res = await fetch(pdf.url, { credentials: 'include' });
        if (!res.ok) throw new Error(`Could not download the PDF (HTTP ${res.status}).`);
        const buf = await res.arrayBuffer();
        // Guard: never base64-encode and send an HTML/JSON error body (e.g. an expired
        // session returns a login page) to the model. First bytes of a PDF are "%PDF-".
        const head = new Uint8Array(buf.slice(0, 5));
        const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
        if (!isPdf) throw new Error('The server did not return a PDF (your session may have expired). Reload the PDF and try again.');
        // btoa over a binary string; chunked to avoid call-stack limits on big files.
        let bin = ''; const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        pdfBase64 = btoa(bin);
      } else {
        text = (study && study.abstract) || '';
      }
      if (!pdfBase64 && !text) { setError('Attach a PDF or an abstract first.'); setBusy(false); return; }
      setStatus('Sending to the external model…');
      const { patch, warnings } = await aiExtract({ pdfBase64, text, focus: '' });
      const at = new Date().toISOString();
      const rec = mkExtractionRecord({
        author: (study && study.author) || '', year: (study && study.year) || '',
        outcome: patch.outcome || '', timepoint: patch.timepoint || '', esType: patch.esType || '',
        values: Object.fromEntries(Object.entries(patch).filter(([k]) => ['n', 'nExp', 'nCtrl', 'meanExp', 'sdExp', 'meanCtrl', 'sdCtrl', 'a', 'b', 'c', 'd', 'events', 'total', 'es', 'lo', 'hi'].includes(k))),
        provenance: { method: 'ai', page: null, region: null, excerpt: 'External model extraction — verify against the source.', at },
        confidence: 'low',
        conversions: patch.conversions || [],
        notes: [patch.notes, ...(warnings || [])].filter(Boolean).join(' · '),
      });
      onAddDrafts && onAddDrafts([rec]);
      setStatus('AI draft added — verify every value against the source.');
    } catch (e) {
      setError(e.message || 'AI extraction failed.');
    } finally {
      setBusy(false);
    }
  }, [pdf, study, onAddDrafts]);

  const applyFigure = useCallback((result) => {
    const at = new Date().toISOString();
    const page = digitizer && digitizer.page;
    const region = digitizer && digitizer.region;
    const recs = figureResultToRecords(result, { study, page, region, at });
    onAddDrafts && onAddDrafts(recs);
    setDigitizer(null);
    setStatus(`Digitized ${result.figureType} → ${recs.length} draft(s).`);
  }, [digitizer, study, onAddDrafts]);

  const applyTable = useCallback(({ esType, values }) => {
    const at = new Date().toISOString();
    const rec = mkExtractionRecord({
      author: (study && study.author) || '', year: (study && study.year) || '',
      esType: esType || '', values,
      provenance: { method: 'table', page: tableModal && tableModal.page, region: tableModal && tableModal.region, excerpt: 'Parsed from a selected table region.', at },
      confidence: 'medium',
    });
    onAddDrafts && onAddDrafts([rec]);
    setTableModal(null);
    setStatus('Table region → draft added.');
  }, [study, tableModal, onAddDrafts]);

  const onPickLocal = (file) => {
    setError('');
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setError('Please choose a PDF.'); return; }
    pdf.setLocalFile(file);
  };

  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 10, background: C.card, marginBottom: 14, overflow: 'hidden' }}>
      {digitizer && <PlotDigitizer imageUrl={digitizer.imageUrl} onCancel={() => setDigitizer(null)} onApply={applyFigure} />}
      {tableModal && <TableRegionMapper grid={tableModal.grid} onCancel={() => setTableModal(null)} onApply={applyTable} />}

      {/* Header: study picker + method bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', flexWrap: 'wrap', borderBottom: `1px solid ${C.brd}` }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.muted }}>🔬 ASSISTED EXTRACTION</span>
        <select value={selectedStudyId || ''} onChange={(e) => onSelectStudy && onSelectStudy(e.target.value)} style={{ ...inp, width: 'auto', fontSize: 12 }}>
          <option value="">— select a study —</option>
          {studies.map((s) => <option key={s.id} value={s.id}>{s.author || 'New study'}{s.year ? ` (${s.year})` : ''}{s.outcome ? ` · ${s.outcome}` : ''}</option>)}
        </select>
        {!readOnly && <button onClick={onAddBlankStudy} style={{ ...btnS('ghost'), fontSize: 11 }}>+ blank study</button>}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', border: `1px solid ${C.brd}`, borderRadius: 6, overflow: 'hidden' }}>
          {[['auto', 'Auto-generate'], ['pick', 'Pick a source'], ['click', 'Click-assign'], ['manual', 'Manual']].map(([m, label]) => (
            <button key={m} onClick={() => setMethod(m)} style={{ padding: '6px 12px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
              background: method === m ? C.acc : 'transparent', color: method === m ? C.accText : C.muted }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Body: PDF left, method controls right */}
      <div style={{ display: 'flex', gap: 0, minHeight: 420, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 420px', minWidth: 300, borderRight: `1px solid ${C.brd}`, display: 'flex', flexDirection: 'column', minHeight: 420 }}>
          {pdf.url ? (
            <AppPdfViewer
              key={pdf.url}
              url={pdf.url}
              flush
              onDocLoaded={(d) => { docRef.current = d; }}
              interaction={interaction}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, textAlign: 'center', color: C.muted }}>
              <div style={{ fontSize: 30 }}>📄</div>
              <div style={{ fontSize: 13, color: C.txt }}>{pdf.resolving ? 'Looking for this study’s PDF…' : study ? 'No PDF linked to this study.' : 'Select a study to load its PDF.'}</div>
              {study && !readOnly && (
                <label style={{ cursor: 'pointer' }}>
                  <span style={{ ...btnS('ghost'), fontSize: 12, display: 'inline-block' }}>⬆ Load a PDF for this session</span>
                  <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={(e) => { onPickLocal(e.target.files && e.target.files[0]); e.target.value = ''; }} />
                </label>
              )}
              <div style={{ fontSize: 11, color: C.dim }}>Auto-generate can still run from the study’s abstract without a PDF.</div>
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 320px', minWidth: 280, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!study && <div style={{ fontSize: 12, color: C.muted }}>Select a study above to begin. Every method writes the same per-outcome record; auto/assisted results appear as drafts you confirm below.</div>}

          {study && method === 'auto' && (
            <MethodBox title="Auto-generate (deterministic)" desc="Reads the PDF text (or the abstract) and drafts records for your protocol outcomes — matching outcomes, harvesting n / events / mean±SD / effect sizes with 95% CI. Conservative: it flags uncertainty and never emits a confident wrong value.">
              <button onClick={runAuto} disabled={busy || readOnly} style={{ ...btnS('primary'), opacity: (busy || readOnly) ? 0.5 : 1 }}>{busy ? '⟳ Reading…' : '⚙ Auto-extract from this study'}</button>
              <ProtocolOutcomeHint outcomes={outcomes} />
            </MethodBox>
          )}

          {study && method === 'pick' && (
            <MethodBox title="Pick a source" desc="Drag a rectangle on the PDF around the table or figure that holds a value.">
              <div style={{ display: 'flex', border: `1px solid ${C.brd}`, borderRadius: 6, overflow: 'hidden', width: 'fit-content' }}>
                {[['table', '▦ Table'], ['figure', '📈 Figure']].map(([k, label]) => (
                  <button key={k} onClick={() => setPickKind(k)} style={{ padding: '6px 12px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    background: pickKind === k ? C.purp : 'transparent', color: pickKind === k ? '#fff' : C.muted }}>{label}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.5 }}>
                {pickKind === 'table'
                  ? 'Drag around a results table → its cells parse into a grid you map to arms/fields.'
                  : 'Drag around a figure → the local plot digitizer opens (Kaplan–Meier → HR via Guyot 2012, forest, bar/error, box, scatter). No model call.'}
              </div>
              {!pdf.url && <div style={{ fontSize: 11, color: C.yel }}>Load a PDF first to pick a source.</div>}
            </MethodBox>
          )}

          {study && method === 'click' && (
            <MethodBox title="Click-assign" desc="Click a number in the PDF to push it into the field you choose here. Fast, precise, provenance-tracked.">
              <label style={lbl}>Assign clicked number to</label>
              <select value={assignField} onChange={(e) => setAssignField(e.target.value)} style={{ ...inp, fontSize: 12 }}>
                {ASSIGN_FIELDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              {!pdf.url && <div style={{ fontSize: 11, color: C.yel }}>Load a PDF first to click values.</div>}
            </MethodBox>
          )}

          {study && method === 'manual' && (
            <MethodBox title="Manual" desc="Type every value in the study card below — always available, every field editable and auditable.">
              <div style={{ fontSize: 12, color: C.muted }}>Scroll to this study’s card below to edit it directly.</div>
            </MethodBox>
          )}

          {/* Optional LLM boost — off by default, honestly labeled. */}
          {aiAvailable && study && (
            <div style={{ border: `1px dashed ${themeAlpha(C.purp, '66')}`, borderRadius: 8, padding: '10px 12px', background: themeAlpha(C.purp, '0d') }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={aiOn} onChange={(e) => setAiOn(e.target.checked)} style={{ accentColor: C.purp, width: 15, height: 15 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: C.purp }}>AI-assisted extraction</span>
              </label>
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>Sends the PDF (or abstract) to an external model. Off by default; nothing leaves the server unless you run it. The result is a draft you must verify.</div>
              {aiOn && <button onClick={runAi} disabled={busy} style={{ ...btnS('ghost'), color: C.purp, borderColor: themeAlpha(C.purp, '55'), fontSize: 12, marginTop: 8, opacity: busy ? 0.5 : 1 }}>{busy ? '⟳ Extracting…' : '✦ Run AI extraction'}</button>}
            </div>
          )}

          {status && <div style={{ fontSize: 11.5, color: C.grn, lineHeight: 1.5 }}>{status}</div>}
          {error && <div style={{ fontSize: 11.5, color: C.red, lineHeight: 1.5 }}>{error}</div>}
          {pdf.error && <div style={{ fontSize: 11.5, color: C.yel }}>{pdf.error}</div>}
        </div>
      </div>
    </div>
  );
}

function MethodBox({ title, desc, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.txt }}>{title}</div>
      <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{desc}</div>
      {children}
    </div>
  );
}

function ProtocolOutcomeHint({ outcomes }) {
  if (!outcomes || !outcomes.length) {
    return <div style={{ fontSize: 11, color: C.yel, lineHeight: 1.5 }}>No protocol outcomes are defined yet — set primary/secondary outcomes in the Protocol tab so auto-extract knows what to look for. Until then it parks everything it finds.</div>;
  }
  return (
    <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.6 }}>
      Target outcomes: {outcomes.map((o) => `${o.level === 'primary' ? '●' : '○'} ${o.name}`).join('  ')}
    </div>
  );
}

/* Map a PlotDigitizer result into one or more draft extraction records. */
function figureResultToRecords(result, { study, page, region, at }) {
  const base = { author: (study && study.author) || '', year: (study && study.year) || '' };
  const prov = { method: 'figure', page, region, excerpt: `Digitized from a ${result.figureType} figure.`, at };
  const v = result.values || {};
  if (result.figureType === 'forest' || (result.figureType === 'km')) {
    const measure = v.measure || (result.figureType === 'km' ? 'HR' : 'HR');
    const ratio = ['OR', 'RR', 'HR', 'IRR'].includes(measure);
    const values = ratio
      ? { es: String(Math.log(v.est)), lo: String(Math.log(v.lo)), hi: String(Math.log(v.hi)) }
      : { es: String(v.est), lo: String(v.lo), hi: String(v.hi) };
    return [mkExtractionRecord({
      ...base, esType: measure, values, provenance: prov, confidence: 'medium',
      conversions: ratio ? [{ id: Math.random().toString(36).slice(2, 10), type: 'ratio_log', method: 'ln(estimate); SE from CI', reason: `digitized ${result.figureType}`, at, inputs: { est: v.est, lo: v.lo, hi: v.hi }, result: { es: Math.log(v.est), lo: Math.log(v.lo), hi: Math.log(v.hi) } }] : [],
      notes: `Digitized ${measure} ${v.est} [${v.lo}, ${v.hi}] from a ${result.figureType}. Verify against the figure.`,
    })];
  }
  if (result.figureType === 'bar' && Array.isArray(v.arms)) {
    const [exp, ctrl] = v.arms;
    return [mkExtractionRecord({
      ...base, provenance: prov, confidence: 'low',
      values: {
        meanExp: exp && exp.mean != null ? String(exp.mean) : '', sdExp: exp && exp.sd != null ? String(exp.sd) : '', nExp: exp && exp.n != null ? String(exp.n) : '',
        meanCtrl: ctrl && ctrl.mean != null ? String(ctrl.mean) : '', sdCtrl: ctrl && ctrl.sd != null ? String(ctrl.sd) : '', nCtrl: ctrl && ctrl.n != null ? String(ctrl.n) : '',
      },
      notes: `Digitized bar chart means${v.arms.map((a) => ` ${a.label}=${a.mean}±${a.sd}`).join(';')}. Confirm arms and enter group sizes.`,
    })];
  }
  if (result.figureType === 'box') {
    return [mkExtractionRecord({
      ...base, provenance: prov, confidence: 'low',
      values: { meanExp: v.mean != null ? String(v.mean) : '', sdExp: v.sd != null ? String(v.sd) : '' },
      notes: `Digitized box plot → median ${v.median}, IQR [${v.q1}, ${v.q3}], n=${v.n} → mean≈${v.mean}, SD≈${v.sd} (Wan 2014).`,
    })];
  }
  // scatter / other → informational note only
  return [mkExtractionRecord({
    ...base, provenance: prov, confidence: 'low',
    notes: `Digitized ${result.figureType}: ${JSON.stringify(v).slice(0, 200)}`,
  })];
}
