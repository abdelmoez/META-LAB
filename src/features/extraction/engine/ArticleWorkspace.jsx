/**
 * features/extraction/engine/ArticleWorkspace.jsx — 76.md §7–§17 & §22.
 *
 * The full-screen, article-centred extraction workspace: a resizable split with the
 * PDF on the left (AppPdfViewer, with jump-to-source reveal) and a structured
 * extraction form on the right, plus a stable top toolbar (methods · progress ·
 * validation · honest save status · prev/next article · complete). Three methods:
 *   • Table Extractor — drag a region → the pure grid pipeline → TableRegionMapper.
 *   • Click-to-Capture — click a number in the PDF → snapToken → the chosen field,
 *     KEEPING structured per-value provenance (page + bbox) so the source is jumpable.
 *   • Manual Entry — the always-visible form; every field is editable + auditable.
 *
 * Reuses the proven pieces wholesale (AppPdfViewer, usePdfSource, TableRegionMapper,
 * PlotDigitizer, DraftReviewList, the pure cell grammar + engine); it only adds the
 * full-screen shell, per-value provenance/jump, validation tiers and the completion gate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppPdfViewer from '../../../frontend/components/AppPdfViewer.jsx';
import { C, btnS, inp, lbl, tagS } from '../../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';
import { usePdfSource } from '../unified/usePdfSource.js';
import { renderRegionToDataUrl } from '../unified/renderRegion.js';
import PlotDigitizer from '../unified/PlotDigitizer.jsx';
import TableRegionMapper from '../unified/TableRegionMapper.jsx';
import DraftReviewList from '../unified/DraftReviewList.jsx';
import { normalizeItems, itemsToRows, detectColumns, buildGrid } from '../../../research-engine/extraction/pdfTextGrid.js';
import { snapToken } from '../../../research-engine/extraction/cellGrammar.js';
import { findNumberTokens } from '../../../research-engine/extraction/numberTokens.js';
import { mkExtractionRecord } from '../../../research-engine/extraction/records.js';
import { decideWrite } from '../../../research-engine/extraction/valuePrecedence.js';
import { useExtractionSplit } from './useExtractionSplit.js';
import { expectedFieldsFor, progressOf } from '../../../research-engine/extraction/engine/articleStatus.js';
import { evaluateCompletion } from '../../../research-engine/extraction/engine/completionGate.js';
import { readProvenance, hasSourceEvidence } from '../../../research-engine/extraction/engine/articleProvenance.js';

const RATIO_MEASURES = ['OR', 'RR', 'HR', 'IRR'];
const ES_TYPES = [['', '—'], ['OR', 'Odds ratio'], ['RR', 'Risk ratio'], ['HR', 'Hazard ratio'], ['IRR', 'Incidence-rate ratio'], ['SMD', 'Std. mean diff'], ['MD', 'Mean difference'], ['PROP', 'Proportion'], ['COR', 'Correlation'], ['DIAG', 'Diagnostic 2×2']];

const FIELD_LABELS = {
  author: 'Author / label', year: 'Year', outcome: 'Outcome', timepoint: 'Time point', esType: 'Effect measure',
  a: '2×2 a (event/Exp)', b: '2×2 b (no event/Exp)', c: '2×2 c (event/Ctrl)', d: '2×2 d (no event/Ctrl)',
  events: 'Events', total: 'Total', tp: 'TP', fp: 'FP', fn: 'FN', tn: 'TN',
  nExp: 'n (Exp)', meanExp: 'Mean (Exp)', sdExp: 'SD (Exp)', nCtrl: 'n (Ctrl)', meanCtrl: 'Mean (Ctrl)', sdCtrl: 'SD (Ctrl)',
  es: 'Effect size (analysis scale)', lo: 'CI lower', hi: 'CI upper',
};
const IDENTITY_FIELDS = ['author', 'year', 'outcome', 'timepoint'];
const NUMERIC_FIELDS = new Set(['a', 'b', 'c', 'd', 'events', 'total', 'tp', 'fp', 'fn', 'tn', 'nExp', 'meanExp', 'sdExp', 'nCtrl', 'meanCtrl', 'sdCtrl', 'es', 'lo', 'hi', 'year']);

const ASSIGN_FIELDS = [
  ['smart', '✦ Smart (value + its 95% CI / events + total)'],
  ['es', 'Effect size (es)'], ['lo', 'CI lower'], ['hi', 'CI upper'],
  ['a', '2×2 a'], ['b', '2×2 b'], ['c', '2×2 c'], ['d', '2×2 d'],
  ['nExp', 'n (Exp)'], ['meanExp', 'mean (Exp)'], ['sdExp', 'SD (Exp)'],
  ['nCtrl', 'n (Ctrl)'], ['meanCtrl', 'mean (Ctrl)'], ['sdCtrl', 'SD (Ctrl)'],
  ['events', 'events'], ['total', 'total'],
];

const onlyToken = (s) => { const toks = findNumberTokens(String(s || '')); return toks.length === 1 ? snapToken(String(s), toks[0].start) : null; };
const tokenPrimary = (t) => (t == null ? null : t.value != null ? t.value : t.est != null ? t.est : t.a != null ? t.a : t.lo != null ? t.lo : null);

function ProgressRing({ pct }) {
  const r = 9, cir = 2 * Math.PI * r, off = cir * (1 - pct / 100);
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" style={{ flexShrink: 0 }} aria-label={`${pct}% extracted`}>
      <circle cx="12" cy="12" r={r} fill="none" stroke={themeAlpha(C.brd, 'aa')} strokeWidth="3" />
      <circle cx="12" cy="12" r={r} fill="none" stroke={pct >= 100 ? C.grn : C.acc} strokeWidth="3"
        strokeDasharray={cir} strokeDashoffset={off} strokeLinecap="round" transform="rotate(-90 12 12)" />
    </svg>
  );
}

export default function ArticleWorkspace({
  projectId, study, article, studies = [], outcomes = [], protocol = { outcomes: [] },
  readOnly = false, saveStatus = '', canEdit = true,
  onBack, onPrev, onNext, hasPrev, hasNext,
  onPatchStudy, onAttachProvenance,
  onAddDrafts, onAddParked, drafts = [], parked = [],
  onConfirmDraft, onDismissDraft, onParkDraft, onUnparkRecord, onEditDraftField,
  onComplete, onReopen, completing = false,
}) {
  const [method, setMethod] = useState('click');      // click | table | figure | manual
  const [assignField, setAssignField] = useState('smart');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [reveal, setReveal] = useState(null);          // { page, region, nonce }
  const [digitizer, setDigitizer] = useState(null);
  const [tableModal, setTableModal] = useState(null);
  const [showChecks, setShowChecks] = useState(true);
  const revealNonce = useRef(0);
  const docRef = useRef(null);
  const rowRef = useRef(null);
  const split = useExtractionSplit(rowRef);

  const pdf = usePdfSource(study, projectId);
  const completion = useMemo(() => evaluateCompletion(study || {}), [study]);
  const progress = useMemo(() => progressOf(study || {}), [study]);
  const valueFields = useMemo(() => expectedFieldsFor(study || {}).filter((f) => !['author', 'year', 'outcome', 'timepoint', 'esType'].includes(f)), [study]);

  // A completed article is read-only until it is reopened (§22); locked is a stronger,
  // adjudicator-only completed state. `editable` gates every capture/edit path.
  const locked = !!(article && article.status === 'locked');
  const completed = !!(article && (article.status === 'complete' || article.status === 'locked'));
  const editable = !readOnly && !completed;

  // Clear a stale source-flash when switching articles so it never re-flashes on the
  // wrong article (76.md review, medium finding).
  const studyId = study && study.id;
  useEffect(() => { setReveal(null); setStatus(''); setError(''); }, [studyId]);

  const patch = useCallback((p) => { if (onPatchStudy && study) onPatchStudy(study.id, p); }, [onPatchStudy, study]);

  /* ── Jump-to-source: reveal a field's stored provenance in the PDF (§15) ── */
  const jumpToSource = useCallback((field) => {
    const prov = readProvenance(study, field);
    if (!prov || (!prov.page && !prov.bbox)) { setStatus('No saved source for this value yet.'); return; }
    revealNonce.current += 1;
    setReveal({ page: prov.page || 1, region: prov.bbox || null, nonce: revealNonce.current });
    setStatus(`Jumped to the source of ${FIELD_LABELS[field] || field}${prov.page ? ` (p. ${prov.page})` : ''}.`);
  }, [study]);

  /* ── Click-to-Capture: snap a token, write the field(s), KEEP provenance ── */
  const assignFromClick = useCallback((payload) => {
    if (!study || !editable) return;
    const runStr = payload.str || '';
    const token = (payload.offset != null) ? snapToken(runStr, payload.offset) : onlyToken(runStr);
    if (!token) {
      const n = findNumberTokens(runStr).length;
      setStatus(n === 0 ? `"${runStr}" has no number to capture.` : 'Could not pinpoint which number you clicked — zoom in and click directly on it.');
      return;
    }
    if (assignField === 'smart' && token.kind === 'p') { setStatus('That looks like a p-value — click the effect estimate or its CI instead.'); return; }
    if (assignField === 'smart' && token.kind === 'percent') { setStatus('That looks like a percentage — choose the exact field (events, n, …).'); return; }
    const isRatio = RATIO_MEASURES.includes(study.esType);
    const conv = [];
    const esFields = (est, lo, hi) => {
      if (isRatio) {
        for (const v of [est, lo, hi]) if (v != null && !(v > 0)) return null;
        const out = {};
        if (est != null) out.es = String(Math.log(est));
        if (lo != null) out.lo = String(Math.log(lo));
        if (hi != null) out.hi = String(Math.log(hi));
        conv.push({ id: Math.random().toString(36).slice(2, 10), type: 'ratio_log', method: 'ln(estimate); CI on ln scale', reason: `click-assign (${study.esType})`, at: new Date().toISOString(), inputs: { est, lo, hi }, result: { ...out } });
        return out;
      }
      const out = {};
      if (est != null) out.es = String(est);
      if (lo != null) out.lo = String(lo);
      if (hi != null) out.hi = String(hi);
      return out;
    };
    const p = {};
    if (assignField === 'smart') {
      if (token.kind === 'ratioCI') { const e = esFields(token.est, token.lo, token.hi); if (!e) { setStatus('That estimate/CI is ≤ 0, which a ratio measure cannot take.'); return; } Object.assign(p, e); }
      else if (token.kind === 'range') { const e = esFields(null, token.lo, token.hi); if (!e) { setStatus('That CI is ≤ 0, which a ratio measure cannot take.'); return; } Object.assign(p, e); }
      else if (token.kind === 'pair') { p.events = String(token.a); p.total = String(token.b); }
      else if (token.kind === 'meanSd') { p.meanExp = String(token.a); p.sdExp = String(token.b); }
      else {
        const raw = tokenPrimary(token);
        if (raw == null) { setStatus(`"${runStr}" has no number to capture.`); return; }
        const e = esFields(Number(raw), null, null); if (!e) { setStatus('That value is ≤ 0, which a ratio measure cannot take on the log scale.'); return; }
        Object.assign(p, e);
      }
    } else {
      const n = tokenPrimary(token);
      if (n == null) { setStatus(`"${runStr}" has no number to capture.`); return; }
      // es/lo/hi live on the ANALYSIS (ln) scale for ratio measures — a DIRECT-field
      // capture must ln-transform too, exactly like Smart mode; otherwise the raw ratio
      // is silently pooled as ln(ratio) (76.md review, high finding).
      if (isRatio && (assignField === 'es' || assignField === 'lo' || assignField === 'hi')) {
        if (!(n > 0)) { setStatus('That value is ≤ 0, which a ratio measure cannot take on the log scale.'); return; }
        p[assignField] = String(Math.log(n));
        conv.push({ id: Math.random().toString(36).slice(2, 10), type: 'ratio_log', method: 'ln(value)', reason: `click-assign ${assignField} (${study.esType})`, at: new Date().toISOString(), inputs: { [assignField]: n }, result: { [assignField]: Math.log(n) } });
      } else {
        p[assignField] = String(n);
      }
    }
    if (conv.length) { p.conversions = [...(Array.isArray(study.conversions) ? study.conversions : []), ...conv]; p.converted = true; }
    if (!Object.keys(p).length) { setStatus('Nothing captured — click directly on the number.'); return; }

    // Overwrite guard (§32): never silently replace an existing human value.
    const VALUE_KEYS = ['es', 'lo', 'hi', 'a', 'b', 'c', 'd', 'nExp', 'meanExp', 'sdExp', 'nCtrl', 'meanCtrl', 'sdCtrl', 'events', 'total'];
    for (const f of VALUE_KEYS) {
      if (!(f in p)) continue;
      const d = decideWrite({ existingValue: study[f], existingOrigin: 'user-typed', incoming: p[f], incomingOrigin: 'click' });
      if (d.action === 'propose-replace' || d.action === 'add-alternative') {
        setStatus(`${FIELD_LABELS[f] || f} already has a value — clear it first or use Manual entry to change it.`);
        return;
      }
    }
    p.needsReview = true;
    if (!study.source) p.source = 'text';
    patch(p);

    // Per-value provenance (§15): page + span bbox for every field this click filled.
    const provFields = {};
    for (const f of Object.keys(p)) {
      if (!VALUE_KEYS.includes(f)) continue;
      provFields[f] = { method: 'click', page: payload.page || null, bbox: payload.spanBox || null, excerpt: runStr.slice(0, 200), at: new Date().toISOString() };
    }
    if (Object.keys(provFields).length && onAttachProvenance) onAttachProvenance(study.id, provFields);
    setStatus(`Captured ${Object.keys(p).filter((k) => VALUE_KEYS.includes(k)).join(', ')} from the PDF.`);
  }, [study, assignField, editable, patch, onAttachProvenance]);

  /* ── Table Extractor: region → grid → mapper ── */
  const handleRegion = useCallback(async ({ page, region }) => {
    setError(''); setStatus('');
    const doc = docRef.current;
    if (!doc) { setError('PDF is still loading.'); return; }
    try {
      if (method === 'figure') {
        setStatus('Rendering the figure region…');
        const { dataUrl } = await renderRegionToDataUrl(doc, page, region, { maxWidth: 900 });
        setDigitizer({ imageUrl: dataUrl, region, page }); setStatus('');
      } else {
        setStatus('Reading the table region…');
        const pg = await doc.getPage(page);
        const content = await pg.getTextContent();
        const items = normalizeItems(content.items || []);
        const inRegion = items.filter((it) => it.x >= region.x0 && it.x <= region.x1 && it.y >= region.y0 && it.y <= region.y1);
        const rows = itemsToRows(inRegion);
        const cols = detectColumns(rows);
        if (rows.length < 2 || cols.length < 2) { setError('That region did not look like a table (need ≥2 rows and ≥2 columns). Try a tighter selection or the figure digitizer.'); setStatus(''); return; }
        setTableModal({ grid: buildGrid(rows, cols), region, page }); setStatus('');
      }
    } catch (e) { setError(e.message || 'Could not read that region.'); setStatus(''); }
  }, [method]);

  const applyTable = useCallback((payload) => {
    const at = new Date().toISOString();
    const list = Array.isArray(payload) ? payload : [payload];
    const built = list.map((r) => ({
      park: !!(r.scope && r.scope.level === 'other'),
      rec: mkExtractionRecord({
        author: (study && study.author) || '', year: (study && study.year) || '', sourceStudyId: (study && study.id) || '',
        outcome: r.outcome || '', timepoint: r.timepoint || '', comparison: r.comparison || '', esType: r.esType || '',
        scope: r.scope, values: r.values || {},
        provenance: { method: 'table', page: tableModal && tableModal.page, region: tableModal && tableModal.region, excerpt: r.excerpt || 'Parsed from a selected table region.', at },
        confidence: r.confidence || 'medium',
        conversions: (r.conversions || []).map((cv, i) => ({ ...cv, at, id: `${Math.random().toString(36).slice(2, 8)}${i}` })),
      }),
    }));
    const draftRecs = built.filter((b) => !b.park).map((b) => b.rec);
    const parkRecs = built.filter((b) => b.park).map((b) => b.rec);
    if (draftRecs.length) onAddDrafts && onAddDrafts(draftRecs);
    if (parkRecs.length) onAddParked && onAddParked(parkRecs);
    setTableModal(null);
    setStatus(`Table → ${draftRecs.length} draft(s)${parkRecs.length ? ` + ${parkRecs.length} also-reported` : ''}. Confirm below to fill the form.`);
  }, [study, tableModal, onAddDrafts, onAddParked]);

  const applyFigure = useCallback((result) => {
    setStatus(`Digitized ${result.figureType}. Confirm the draft below.`);
    // Figure → draft (reuse the records path via the same shape the split panel used).
    const at = new Date().toISOString();
    const rec = mkExtractionRecord({
      author: (study && study.author) || '', year: (study && study.year) || '', sourceStudyId: (study && study.id) || '',
      values: result.values && result.values.es != null ? { es: String(result.values.es), lo: String(result.values.lo), hi: String(result.values.hi) } : {},
      provenance: { method: 'figure', page: digitizer && digitizer.page, region: digitizer && digitizer.region, excerpt: `Digitized ${result.figureType}.`, at },
      confidence: 'medium', notes: `Digitized ${result.figureType} — verify against the figure.`,
    });
    onAddDrafts && onAddDrafts([rec]);
    setDigitizer(null);
  }, [study, digitizer, onAddDrafts]);

  const interaction = useMemo(() => {
    if (!editable || !pdf.url) return null;
    if (method === 'click') return { mode: 'click', onTextClick: assignFromClick, onTextMiss: () => setStatus('No number there — zoom in, or run text recognition on scanned pages.') };
    if (method === 'table' || method === 'figure') return { mode: 'region', onRegion: handleRegion };
    return null;
  }, [method, assignFromClick, handleRegion, pdf.url, editable]);

  const setField = (f, v) => { if (editable) patch({ [f]: v, needsReview: true }); };

  const saveBadge = saveStatus === 'saving' ? { t: 'Saving…', c: C.acc }
    : saveStatus === 'saved' ? { t: 'Saved', c: C.grn }
      : saveStatus === 'error' ? { t: 'Save failed', c: C.red } : null;

  return (
    <div data-testid="pex-workspace" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {digitizer && <PlotDigitizer imageUrl={digitizer.imageUrl} onCancel={() => setDigitizer(null)} onApply={applyFigure} />}
      {tableModal && <TableRegionMapper grid={tableModal.grid} outcomes={outcomes} onCancel={() => setTableModal(null)} onApply={applyTable} />}

      {/* ── Stable top toolbar (§7) ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: `1px solid ${C.brd}`, background: C.card, flexWrap: 'wrap', flexShrink: 0 }}>
        <button onClick={onBack} style={{ ...btnS('ghost'), fontSize: 11 }} title="Back to the article list (Esc)">← Articles</button>
        <div style={{ display: 'flex', gap: 2 }}>
          <button onClick={onPrev} disabled={!hasPrev} style={{ ...btnS('ghost'), fontSize: 11, opacity: hasPrev ? 1 : 0.4 }} title="Previous article">‹</button>
          <button onClick={onNext} disabled={!hasNext} style={{ ...btnS('ghost'), fontSize: 11, opacity: hasNext ? 1 : 0.4 }} title="Next article">›</button>
        </div>
        <div style={{ minWidth: 0, maxWidth: '32ch', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 700, color: C.txt }}>
          {study ? `${study.author || 'Untitled'}${study.year ? ` (${study.year})` : ''}` : ''}
        </div>
        {!readOnly && (
          <div style={{ display: 'flex', border: `1px solid ${C.brd}`, borderRadius: 6, overflow: 'hidden', marginLeft: 6 }}>
            {[['table', '▦ Table'], ['click', '⊹ Click'], ['figure', '📈 Figure'], ['manual', '⌨ Manual']].map(([m, label]) => (
              <button key={m} onClick={() => setMethod(m)} style={{ padding: '6px 11px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: method === m ? C.acc : 'transparent', color: method === m ? C.accText : C.muted }}>{label}</button>
            ))}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={`${progress.filledFields}/${progress.totalFields} expected fields`}>
          <ProgressRing pct={progress.pct} /><span style={{ fontSize: 11, color: C.muted }}>{progress.pct}%</span>
        </div>
        {completion.blocking.length > 0
          ? <span style={tagS('red')}>{completion.blocking.length} to fix</span>
          : completion.warnings.length > 0 ? <span style={tagS('yellow')}>{completion.warnings.length} warn</span> : <span style={tagS('green')}>checks ok</span>}
        {saveBadge ? <span style={{ fontSize: 11, color: saveBadge.c, fontWeight: 600 }}>● {saveBadge.t}</span> : null}
        {!readOnly && canEdit && (completed
          ? <button onClick={() => onReopen && onReopen(study.id)} style={{ ...btnS('ghost'), fontSize: 11 }} disabled={completing}>↺ Reopen</button>
          : <button onClick={() => onComplete && onComplete(study.id)} style={{ ...btnS(completion.canComplete ? 'success' : 'ghost'), fontSize: 11 }} disabled={completing} title={completion.canComplete ? 'Mark this article complete' : 'Resolve the blocking checks first'}>
            {completing ? '…' : '✓ Complete'}</button>)}
      </div>

      {/* ── Split: PDF left, form right ── */}
      <div ref={rowRef} style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'var(--pex-pdf-pct, 55%) 16px minmax(0,1fr)' }}>
        {/* PDF */}
        <div style={{ minWidth: 0, minHeight: 0, borderRight: `1px solid ${C.brd}`, display: 'flex', flexDirection: 'column' }}>
          {pdf.url ? (
            <AppPdfViewer key={pdf.url} url={pdf.url} flush onDocLoaded={(d) => { docRef.current = d; }} interaction={interaction} reveal={reveal} />
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, textAlign: 'center', color: C.muted }}>
              <div style={{ fontSize: 30 }}>📄</div>
              <div style={{ fontSize: 13, color: C.txt }}>{pdf.resolving ? 'Looking for this article’s PDF…' : 'No PDF linked to this article.'}</div>
              {!readOnly && (
                <label style={{ cursor: 'pointer' }}>
                  <span style={{ ...btnS('ghost'), fontSize: 12, display: 'inline-block' }}>⬆ Upload a PDF</span>
                  <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={(e) => { pdf.setLocalFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
                </label>
              )}
              <div style={{ fontSize: 11, color: C.dim }}>Manual entry works without a PDF — type values on the right.</div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div role="separator" aria-orientation="vertical" tabIndex={0} aria-label="Resize the PDF and form panels"
          aria-valuemin={Math.round(split.min * 100)} aria-valuemax={Math.round(split.max * 100)} aria-valuenow={Math.round(split.ratio * 100)}
          onPointerDown={split.onPointerDown} onDoubleClick={split.reset}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') { split.nudge(-0.02); e.preventDefault(); } else if (e.key === 'ArrowRight') { split.nudge(0.02); e.preventDefault(); } else if (e.key === 'Home') { split.reset(); e.preventDefault(); } }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'col-resize', touchAction: 'none', outline: 'none', background: C.bg }}>
          <span style={{ width: split.dragging ? 5 : 3, height: 48, borderRadius: 5, background: split.dragging ? C.acc : C.brd2 }} />
        </div>

        {/* Form + methods + drafts + validation */}
        <div style={{ minWidth: 0, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14, background: C.bg }}>
          {/* method hint */}
          {method === 'click' && !readOnly && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ ...lbl, margin: 0 }}>Click a number → </label>
              <select value={assignField} onChange={(e) => setAssignField(e.target.value)} style={{ ...inp, width: 'auto', fontSize: 12 }}>
                {ASSIGN_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {!pdf.url && <span style={{ fontSize: 11, color: C.yel }}>Load a PDF to click values.</span>}
            </div>
          )}
          {(method === 'table' || method === 'figure') && !readOnly && (
            <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>
              {method === 'table' ? 'Drag a rectangle around a results table on the PDF → its shape is detected and pre-mapped for you to confirm.' : 'Drag a rectangle around a figure → a guided digitizer opens (no model call).'}
              {!pdf.url && <span style={{ color: C.yel }}> Load a PDF first.</span>}
            </div>
          )}

          {status && <div style={{ fontSize: 11.5, color: C.grn, lineHeight: 1.5 }}>{status}</div>}
          {error && <div style={{ fontSize: 11.5, color: C.red, lineHeight: 1.5 }}>{error}</div>}
          {pdf.error && <div style={{ fontSize: 11.5, color: C.yel }}>{pdf.error}</div>}

          {/* Structured form (§14 — identity + esType + value group) */}
          <FormSection title="Study & outcome">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {IDENTITY_FIELDS.map((f) => (
                <Field key={f} field={f} value={study[f] || ''} onChange={(v) => setField(f, v)} readOnly={!editable}
                  hasSource={hasSourceEvidence(study, f)} onJump={() => jumpToSource(f)} numeric={NUMERIC_FIELDS.has(f)} />
              ))}
              <div>
                <label style={lbl}>{FIELD_LABELS.esType}</label>
                <select value={study.esType || ''} onChange={(e) => setField('esType', e.target.value)} disabled={!editable} style={{ ...inp, fontSize: 12 }}>
                  {ES_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>
          </FormSection>

          <FormSection title={`Values${RATIO_MEASURES.includes(study.esType) ? ' · es/lo/hi stored on the ln scale' : ''}`}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {valueFields.map((f) => (
                <Field key={f} field={f} value={study[f] || ''} onChange={(v) => setField(f, v)} readOnly={!editable}
                  hasSource={hasSourceEvidence(study, f)} onJump={() => jumpToSource(f)} numeric />
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={lbl}>Notes — assumptions, conversions, unclear data</label>
              <textarea value={study.notes || ''} onChange={(e) => setField('notes', e.target.value)} disabled={!editable}
                placeholder="e.g. SD imputed from SE; median/IQR converted via Wan 2014; adjusted for age & sex…" style={{ ...inp, height: 48, resize: 'vertical', fontSize: 12 }} />
            </div>
          </FormSection>

          {/* Drafts to confirm (table/figure) */}
          {(drafts.length > 0 || parked.length > 0) && (
            <DraftReviewList drafts={drafts} parked={parked} outcomes={outcomes} compact
              onConfirm={onConfirmDraft} onDismiss={onDismissDraft} onPark={onParkDraft} onUnpark={onUnparkRecord} onEditField={onEditDraftField} />
          )}

          {/* Validation panel (§17 tiers) */}
          <div style={{ border: `1px solid ${C.brd}`, borderRadius: 8, background: C.card, overflow: 'hidden' }}>
            <button onClick={() => setShowChecks((s) => !s)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer', color: C.txt }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: C.muted }}>DATA CHECKS</span>
              <span style={{ display: 'flex', gap: 6 }}>
                {completion.blocking.length > 0 && <span style={tagS('red')}>{completion.blocking.length} blocking</span>}
                {completion.warnings.length > 0 && <span style={tagS('yellow')}>{completion.warnings.length} warnings</span>}
                {completion.blocking.length === 0 && completion.warnings.length === 0 && <span style={tagS('green')}>all clear</span>}
              </span>
            </button>
            {showChecks && (completion.blocking.length + completion.warnings.length + completion.info.length > 0) && (
              <div style={{ padding: '4px 12px 12px' }}>
                {[['block', completion.blocking, C.red, '✗'], ['warn', completion.warnings, C.yel, '⚠'], ['info', completion.info, C.muted, 'ℹ']].map(([kind, list, col, icon]) => (
                  list.map((it, i) => (
                    <div key={`${kind}${i}`} style={{ display: 'flex', gap: 8, fontSize: 11.5, color: C.txt2, marginBottom: 5, lineHeight: 1.5 }}>
                      <span style={{ color: col, flexShrink: 0 }}>{icon}</span><span>{it.msg}</span>
                    </div>
                  ))
                ))}
              </div>
            )}
          </div>

          {completed && <div style={{ fontSize: 11.5, color: C.grn, textAlign: 'center', padding: 6 }}>✓ This article is marked complete{locked ? ' and locked' : ''}. {!locked && !readOnly && 'Reopen from the toolbar to edit.'}</div>}
        </div>
      </div>
    </div>
  );
}

function FormSection({ title, children }) {
  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 8, background: C.card, padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: C.muted, marginBottom: 10 }}>{title.toUpperCase()}</div>
      {children}
    </div>
  );
}

function Field({ field, value, onChange, readOnly, hasSource, onJump, numeric }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <label style={{ ...lbl, margin: 0 }}>{FIELD_LABELS[field] || field}</label>
        {hasSource ? (
          <button onClick={onJump} title="Jump to this value’s source in the PDF"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.acc, fontSize: 10.5, fontWeight: 700, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            ⌖ source
          </button>
        ) : null}
      </div>
      <input value={value} onChange={(e) => onChange(e.target.value)} disabled={readOnly}
        inputMode={numeric ? 'decimal' : undefined}
        style={{ ...inp, fontSize: 12.5, fontFamily: numeric ? "'IBM Plex Mono',monospace" : 'inherit', borderColor: hasSource ? themeAlpha(C.acc, '55') : C.brd }} />
    </div>
  );
}
