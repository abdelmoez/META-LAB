/**
 * AssistedExtractionPanel.jsx — e1.md. THE main Data Extraction interface:
 * inline PDF (left, scrolls) + the four extraction methods and the draft-review list
 * (right, fixed-height with its own scroll), all writing the same protocol-scoped
 * per-outcome record model. Deterministic by default; the optional LLM boost is a
 * separate, clearly-labeled, off-by-default toggle.
 *
 *  1. Auto-generate  — deterministic first pass over the PDF/abstract text.
 *  2. Pick-a-source  — drag a region: a TABLE parses to a grid, a FIGURE opens the
 *                      local plot digitizer (KM→HR via Guyot, forest/bar/box/scatter).
 *  3. Click-assign   — click a number in the PDF to push it into a chosen field.
 *  4. Manual entry   — the classic study card in the "Extracted records" area below.
 *
 * Nothing here writes into the analysable dataset without a human: methods 1–2 produce
 * DRAFTS the reviewer confirms; method 3 fills the selected study's own fields (a fast,
 * provenance-noted manual aid) and is fully editable/auditable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppPdfViewer from '../../../frontend/components/AppPdfViewer.jsx';
import { C, btnS, inp, lbl } from '../../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';
import { usePdfSource } from './usePdfSource.js';
import { renderRegionToDataUrl } from './renderRegion.js';
import PlotDigitizer from './PlotDigitizer.jsx';
import TableRegionMapper from './TableRegionMapper.jsx';
import DraftReviewList from './DraftReviewList.jsx';
import { autoExtract } from '../../../research-engine/extraction/autoExtract.js';
import { normalizeItems, itemsToRows, detectColumns, buildGrid } from '../../../research-engine/extraction/pdfTextGrid.js';
import { snapNumberToken } from '../../../research-engine/extraction/numberTokens.js';
import { mkExtractionRecord } from '../../../research-engine/extraction/records.js';
import { decideWrite } from '../../../research-engine/extraction/valuePrecedence.js';
import { aiExtractStatus, aiExtract } from '../../../frontend/services/aiExtractService.js';

/** Study fields a click can fill (the value slots) — used by the overwrite guard. */
const VALUE_PATCH_FIELDS = [
  'es', 'lo', 'hi', 'a', 'b', 'c', 'd', 'nExp', 'meanExp', 'sdExp',
  'nCtrl', 'meanCtrl', 'sdCtrl', 'events', 'total', 'n',
];
/** Patch keys that are bookkeeping, not user-visible captured values. */
const PATCH_META_FIELDS = ['needsReview', 'notes', 'source', 'conversions', 'converted'];

const ASSIGN_FIELDS = [
  ['smart', '✦ Smart (value + its 95% CI / events + total)'],
  ['es', 'Effect size (es)'], ['lo', 'CI lower'], ['hi', 'CI upper'],
  ['a', '2×2 a (event/Exp)'], ['b', '2×2 b (no event/Exp)'], ['c', '2×2 c (event/Ctrl)'], ['d', '2×2 d (no event/Ctrl)'],
  ['nExp', 'n (Exp)'], ['meanExp', 'mean (Exp)'], ['sdExp', 'SD (Exp)'],
  ['nCtrl', 'n (Ctrl)'], ['meanCtrl', 'mean (Ctrl)'], ['sdCtrl', 'SD (Ctrl)'],
  ['events', 'events'], ['total', 'total'], ['n', 'Total N'],
];

// Fallback for older payloads that only carry the whole run string (no offset): grab the
// first full number token. The rich path uses snapNumberToken(runStr, offset).
const firstNumber = (s) => {
  const m = String(s || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? m[0] : null;
};

const PANE_H = 'calc(100vh - 230px)';   // both panes share a fixed height with their own scroll

export default function AssistedExtractionPanel({
  projectId, studies = [], outcomes = [], protocol = { outcomes: [] },
  selectedStudyId, onSelectStudy, onAddBlankStudy,
  onAddDrafts, onAddParked, onPatchStudy,
  drafts = [], parked = [],
  onConfirmDraft, onDismissDraft, onParkDraft, onUnparkRecord, onEditDraftField,
  onNextStudy, onViewRecords, onContinueToRob,
  readOnly = false,
}) {
  const [method, setMethod] = useState('auto');       // auto | pick | click | manual
  const [pickKind, setPickKind] = useState('table');  // table | figure
  const [assignField, setAssignField] = useState('smart');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [digitizer, setDigitizer] = useState(null);   // { imageUrl, region, page } | null
  const [tableModal, setTableModal] = useState(null);  // { grid, region, page } | null
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiOn, setAiOn] = useState(false);            // OFF by default, per session
  const [detected, setDetected] = useState([]);       // detectedOutcomes chooser (empty/unmatched PICO)
  const [pendingAssign, setPendingAssign] = useState(null); // held click-assign overwrite (§21.5)
  const docRef = useRef(null);

  const study = useMemo(() => studies.find((s) => s.id === selectedStudyId) || null, [studies, selectedStudyId]);
  const pdf = usePdfSource(study, projectId);

  // Probe the optional LLM proxy once (fail-closed). Never auto-enables.
  useEffect(() => {
    let dead = false;
    aiExtractStatus().then((r) => { if (!dead) setAiAvailable(!!(r && r.available)); }).catch(() => { if (!dead) setAiAvailable(false); });
    return () => { dead = true; };
  }, []);

  // A click writes the captured number(s) into the selected study's field(s). It is a
  // fast manual aid: provenance (page + excerpt) is appended to the study note and the
  // row is flagged needsReview, and it never leaves a value un-auditable.
  const assignFromClick = useCallback((payload) => {
    if (!study) { setStatus('Pick a study first.'); return; }
    const runStr = payload.str || '';
    const token = (payload.offset != null) ? snapNumberToken(runStr, payload.offset) : null;
    // When the caret couldn't be resolved (no offset) and the run holds several numbers,
    // refuse to guess — assigning the run's FIRST number could be a confident wrong value.
    if (!token && payload.offset == null && (runStr.match(/-?\d[\d.,]*/g) || []).length > 1) {
      setStatus('Could not pinpoint which number you clicked — zoom in and click directly on it.'); return;
    }
    // es/lo/hi are stored on the ANALYSIS scale: ln for ratio measures (OR/RR/HR/IRR).
    // Click-assign must honour that, matching the table/figure paths — never write a raw ratio.
    const isRatio = ['OR', 'RR', 'HR', 'IRR'].includes(study.esType);
    const conv = [];
    const esFields = (est, lo, hi) => {
      if (isRatio) {
        for (const v of [est, lo, hi]) if (v != null && !(v > 0)) return null; // non-positive ratio can't be logged
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
    const patch = {};
    if (assignField === 'smart') {
      if (token && token.kind === 'ratioCI') { const e = esFields(token.est, token.lo, token.hi); if (!e) { setStatus('That estimate/CI is ≤ 0, which a ratio measure cannot take — check the value or the study’s measure.'); return; } Object.assign(patch, e); }
      else if (token && token.kind === 'range') { const e = esFields(null, token.lo, token.hi); if (!e) { setStatus('That CI is ≤ 0, which a ratio measure cannot take — check the value or the study’s measure.'); return; } Object.assign(patch, e); }
      else if (token && token.kind === 'pair') { patch.events = String(token.a); patch.total = String(token.b); }
      else if (token && token.kind === 'meanSd') { patch.meanExp = String(token.a); patch.sdExp = String(token.b); }
      else {
        const raw = token && token.value != null ? token.value : firstNumber(runStr);
        if (raw == null) { setStatus(`"${runStr}" has no number to capture.`); return; }
        const e = esFields(Number(raw), null, null); if (!e) { setStatus('That value is ≤ 0, which a ratio measure cannot take on the log scale.'); return; }
        Object.assign(patch, e);
      }
    } else {
      // A specific field is chosen: take the number FROM the snapped token under the cursor
      // (its primary component), only falling back to the run's first number if no token.
      const n = token
        ? (token.value != null ? token.value : token.est != null ? token.est : token.a != null ? token.a : token.lo != null ? token.lo : firstNumber(runStr))
        : firstNumber(runStr);
      if (n == null) { setStatus(`"${runStr}" has no number to capture.`); return; }
      patch[assignField] = String(n);
    }
    if (conv.length) { patch.conversions = [...(Array.isArray(study.conversions) ? study.conversions : []), ...conv]; patch.converted = true; }
    if (!Object.keys(patch).length) { setStatus('Nothing captured — try clicking directly on the number.'); return; }
    // Provenance note (page + the source text) + needsReview so a click is always auditable.
    const prov = `[click${payload.page ? ` p${payload.page}` : ''}] ${runStr}`.trim();
    patch.needsReview = true;
    patch.notes = study.notes ? `${study.notes} · ${prov}` : prov;
    if (!study.source) patch.source = 'text';

    // Overwrite guard (§21.5): a click must NEVER silently replace a value already in a
    // destination field. Existing study values are treated as human-origin; a differing
    // machine (click) value against them is a conflict → ask before replacing, default keep.
    const conflicts = [];
    for (const field of VALUE_PATCH_FIELDS) {
      if (!(field in patch)) continue;
      const decision = decideWrite({
        existingValue: study[field], existingOrigin: 'user-typed',
        incoming: patch[field], incomingOrigin: 'click',
      });
      if (decision.action === 'propose-replace' || decision.action === 'add-alternative') {
        conflicts.push({ field, existing: String(study[field]), incoming: String(patch[field]) });
      }
    }
    if (conflicts.length) { setPendingAssign({ studyId: study.id, patch, conflicts }); setStatus(''); return; }

    onPatchStudy && onPatchStudy(study.id, patch);
    const shown = Object.entries(patch).filter(([k]) => !PATCH_META_FIELDS.includes(k)).map(([k, v]) => `${v}→${k}`).join(', ');
    setStatus(`Assigned ${shown}.`);
  }, [study, assignField, onPatchStudy]);

  // Resolve a held overwrite decision. 'replace' applies the whole captured patch;
  // 'keep' drops only the conflicting value fields (empty/agreeing fields still write).
  const resolvePendingAssign = useCallback((mode) => {
    setPendingAssign((pending) => {
      if (!pending) return null;
      let patch = pending.patch;
      if (mode === 'keep') {
        const drop = new Set(pending.conflicts.map((c) => c.field));
        patch = Object.fromEntries(Object.entries(pending.patch).filter(([k]) => !drop.has(k)));
        // If nothing but meta remains, don't churn the study.
        if (!Object.keys(patch).some((k) => !PATCH_META_FIELDS.includes(k))) {
          setStatus('Kept the existing value(s).');
          return null;
        }
      }
      onPatchStudy && onPatchStudy(pending.studyId, patch);
      setStatus(mode === 'replace' ? 'Replaced with the clicked value(s).' : 'Kept existing; filled the empty field(s).');
      return null;
    });
  }, [onPatchStudy]);

  const interaction = useMemo(() => {
    if (readOnly || !pdf.url) return null;
    if (method === 'click') {
      return {
        mode: 'click',
        onTextClick: assignFromClick,
        onTextMiss: () => setStatus('No number there — zoom in, or (for scanned pages) run text recognition first.'),
      };
    }
    if (method === 'pick') {
      return { mode: 'region', onRegion: handleRegion };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, pickKind, assignFromClick, pdf.url, readOnly]);

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
          setError('That region did not look like a table (need ≥2 rows and ≥2 columns). Try a tighter selection, or use the figure digitizer. (Scanned page? Run text recognition first.)');
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
    setError(''); setStatus(''); setBusy(true); setDetected([]);
    try {
      let pages = [];
      let ocrPageSet = new Set();
      let ocrCount = 0;
      if (pdf.url) {
        setStatus('Reading the PDF text…');
        const r = await pdf.extractPages();
        pages = r.pages;
        ocrPageSet = new Set((r.pages || []).filter((p) => p.ocr).map((p) => p.page));
        ocrCount = r.ocrPages || 0;
      }
      const abstract = (study && study.abstract) || '';
      if (!pages.length && !abstract) {
        setError('No PDF text or abstract to read. Attach a PDF, or paste an abstract into the study’s citation metadata.');
        setBusy(false); return;
      }
      const at = new Date().toISOString();
      const { drafts: newDrafts, alsoReported, detectedOutcomes, log } = autoExtract({ pages, abstract, protocol, baseStudy: study, at });
      // Tag every draft with its origin study, and mark + de-confidence any draft whose text
      // came from OCR ("text recognition") — a digit misread must be scrutinised, not trusted.
      const markOcr = (d) => {
        const rec = { ...d, sourceStudyId: (study && study.id) || '' };
        if (d.provenance && ocrPageSet.has(d.provenance.page)) {
          rec.confidence = 'low';
          rec.provenance = { ...d.provenance, ocr: true };
          rec.notes = [d.notes, 'From text recognition (OCR) — verify every digit against the page.'].filter(Boolean).join(' · ');
        }
        return rec;
      };
      const tagged = (newDrafts || []).map(markOcr);
      onAddDrafts && onAddDrafts(tagged);
      onAddParked && onAddParked((alsoReported || []).map(markOcr));
      // Anti-silent-fail: when the protocol has no outcomes, or nothing matched, offer the
      // outcomes the engine DID detect in the paper so the reviewer can choose.
      if ((!tagged.length) && Array.isArray(detectedOutcomes) && detectedOutcomes.length) {
        setDetected(detectedOutcomes);
      }
      const ocrNote = ocrCount ? ` (text recognition used on ${ocrCount} scanned page${ocrCount > 1 ? 's' : ''} — verify those digits)` : '';
      setStatus(((log && log[log.length - 1]) || `Found ${tagged.length} draft(s).`) + ocrNote);
    } catch (e) {
      setError(e.message || 'Auto-extract failed.');
    } finally {
      setBusy(false);
    }
  }, [pdf, study, protocol, onAddDrafts, onAddParked]);

  // Extract one reviewer-chosen detected outcome as a manual-entry starting draft.
  const extractDetected = useCallback((cand) => {
    if (!study) return;
    const at = new Date().toISOString();
    const rec = mkExtractionRecord({
      author: study.author || '', year: study.year || '',
      outcome: cand.label || '', sourceStudyId: study.id,
      provenance: { method: 'auto', page: cand.page || null, region: null, excerpt: cand.excerpt || cand.statPreview || '', at },
      confidence: 'low',
      notes: `Chosen from detected outcomes — enter the values from ${cand.statPreview || 'the source'} and assign the protocol outcome.`,
    });
    onAddDrafts && onAddDrafts([rec]);
    setDetected((ds) => ds.filter((d) => d !== cand));
    setStatus(`Added a draft for "${cand.label}" — fill its values and confirm.`);
  }, [study, onAddDrafts]);

  const runAi = useCallback(async () => {
    setError(''); setStatus(''); setBusy(true);
    try {
      let pdfBase64 = null, text = null;
      if (pdf.url) {
        const res = await fetch(pdf.url, { credentials: 'include' });
        if (!res.ok) throw new Error(`Could not download the PDF (HTTP ${res.status}).`);
        const buf = await res.arrayBuffer();
        const head = new Uint8Array(buf.slice(0, 5));
        const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
        if (!isPdf) throw new Error('The server did not return a PDF (your session may have expired). Reload the PDF and try again.');
        let bin = ''; const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        pdfBase64 = btoa(bin);
      } else {
        text = (study && study.abstract) || '';
      }
      if (!pdfBase64 && !text) { setError('Attach a PDF or an abstract first.'); setBusy(false); return; }
      // Steer the model at the first pre-specified outcome so the draft is protocol-scoped.
      const primary = (outcomes || []).find((o) => o.level === 'primary') || (outcomes || [])[0] || null;
      const focus = primary ? `Outcome of interest: ${primary.name}${primary.timepointHint ? ` at ${primary.timepointHint}` : ''}.` : '';
      setStatus('Sending to the external model…');
      const { patch, conversions, warnings } = await aiExtract({ pdfBase64, text, focus });
      const at = new Date().toISOString();
      const rec = mkExtractionRecord({
        author: (study && study.author) || '', year: (study && study.year) || '', sourceStudyId: (study && study.id) || '',
        outcome: patch.outcome || (primary ? primary.name : ''), timepoint: patch.timepoint || '', comparison: patch.comparison || '', esType: patch.esType || '',
        scope: primary ? { level: primary.level, outcomeId: primary.id, canonicalName: primary.canonical || primary.name } : undefined,
        values: Object.fromEntries(Object.entries(patch).filter(([k]) => ['n', 'nExp', 'nCtrl', 'meanExp', 'sdExp', 'meanCtrl', 'sdCtrl', 'a', 'b', 'c', 'd', 'events', 'total', 'es', 'lo', 'hi'].includes(k))),
        provenance: { method: 'ai', page: null, region: null, excerpt: 'External model extraction — verify against the source.', at },
        confidence: 'low',
        conversions: conversions || [],
        notes: [patch.notes, patch.author && `model author: ${patch.author}`, ...(warnings || [])].filter(Boolean).join(' · '),
      });
      onAddDrafts && onAddDrafts([rec]);
      setStatus('AI draft added — verify every value against the source.');
    } catch (e) {
      setError(e.message || 'AI extraction failed.');
    } finally {
      setBusy(false);
    }
  }, [pdf, study, outcomes, onAddDrafts]);

  const applyFigure = useCallback((result) => {
    const at = new Date().toISOString();
    const page = digitizer && digitizer.page;
    const region = digitizer && digitizer.region;
    try {
      const recs = figureResultToRecords(result, { study, page, region, at });
      onAddDrafts && onAddDrafts(recs);
      setDigitizer(null);
      setStatus(`Digitized ${result.figureType} → ${recs.length} draft(s).`);
    } catch (e) {
      setError(e.message || 'Could not turn that digitization into a record.');
    }
  }, [digitizer, study, onAddDrafts]);

  const applyTable = useCallback((payload) => {
    const at = new Date().toISOString();
    // The mapper may return a single record ({esType, values, ...}) or several
    // (per-variable direct-effect tables → one record per selected row).
    const list = Array.isArray(payload) ? payload : [payload];
    const built = list.map((r) => ({
      // Route by the mapper's EXPLICIT intent (input scope), not the record's defaulted
      // scope: only a row the reviewer tagged out-of-scope (scope.level 'other') is parked;
      // a two-arm record with no scope is an unassigned DRAFT, not "also reported".
      park: !!(r.scope && r.scope.level === 'other'),
      rec: mkExtractionRecord({
        author: (study && study.author) || '', year: (study && study.year) || '', sourceStudyId: (study && study.id) || '',
        outcome: r.outcome || '', timepoint: r.timepoint || '', comparison: r.comparison || '', esType: r.esType || '',
        scope: r.scope,
        values: r.values || {},
        provenance: { method: 'table', page: tableModal && tableModal.page, region: tableModal && tableModal.region, excerpt: r.excerpt || 'Parsed from a selected table region.', at },
        confidence: r.confidence || 'medium',
        // Re-stamp the mapper's (pure, placeholder-timestamped) conversion audit with the real time + a unique id.
        conversions: (r.conversions || []).map((cv, i) => ({ ...cv, at, id: `${Math.random().toString(36).slice(2, 8)}${i}` })),
      }),
    }));
    const draftRecs = built.filter((b) => !b.park).map((b) => b.rec);
    const parkRecs = built.filter((b) => b.park).map((b) => b.rec);
    if (draftRecs.length) onAddDrafts && onAddDrafts(draftRecs);
    if (parkRecs.length) onAddParked && onAddParked(parkRecs);
    setTableModal(null);
    setStatus(`Table → ${draftRecs.length} draft(s)${parkRecs.length ? ` + ${parkRecs.length} also-reported` : ''}.`);
  }, [study, tableModal, onAddDrafts, onAddParked]);

  const onPickLocal = (file) => {
    setError('');
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setError('Please choose a PDF.'); return; }
    pdf.setLocalFile(file);
  };

  const draftsForStudy = drafts;   // drafts are project-wide; the list labels each by its outcome
  const canConfirm = typeof onConfirmDraft === 'function';

  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 10, background: C.card, marginBottom: 14, overflow: 'hidden' }}>
      {digitizer && <PlotDigitizer imageUrl={digitizer.imageUrl} onCancel={() => setDigitizer(null)} onApply={applyFigure} />}
      {tableModal && <TableRegionMapper grid={tableModal.grid} outcomes={outcomes} onCancel={() => setTableModal(null)} onApply={applyTable} />}

      {/* Header: study picker + method bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', flexWrap: 'wrap', borderBottom: `1px solid ${C.brd}` }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.muted }}>🔬 EXTRACTION WORKSPACE</span>
        <select value={selectedStudyId || ''} onChange={(e) => onSelectStudy && onSelectStudy(e.target.value)} style={{ ...inp, width: 'auto', fontSize: 12 }}>
          <option value="">— select a study —</option>
          {studies.map((s) => <option key={s.id} value={s.id}>{s.author || '(untitled study)'}{s.year ? ` (${s.year})` : ''}{s.outcome ? ` · ${s.outcome}` : ''}</option>)}
        </select>
        {!readOnly && <button onClick={onAddBlankStudy} style={{ ...btnS('ghost'), fontSize: 11 }}>+ blank study</button>}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', border: `1px solid ${C.brd}`, borderRadius: 6, overflow: 'hidden' }}>
          {[['auto', 'Auto-generate'], ['pick', 'Pick a source'], ['click', 'Click-assign'], ['manual', 'Manual entry']].map(([m, label]) => (
            <button key={m} onClick={() => setMethod(m)} style={{ padding: '6px 12px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
              background: method === m ? C.acc : 'transparent', color: method === m ? C.accText : C.muted }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Source bar: which PDF is loaded + how to change it. */}
      <PdfSourceBar pdf={pdf} study={study} readOnly={readOnly} onPickLocal={onPickLocal} />

      {/* Body: PDF left (scrolls), method + drafts right (own scroll) */}
      <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 380px', minWidth: 300, height: PANE_H, minHeight: 420, borderRight: `1px solid ${C.brd}`, display: 'flex', flexDirection: 'column' }}>
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
                  <span style={{ ...btnS('ghost'), fontSize: 12, display: 'inline-block' }}>⬆ Upload a PDF</span>
                  <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={(e) => { onPickLocal(e.target.files && e.target.files[0]); e.target.value = ''; }} />
                </label>
              )}
              <div style={{ fontSize: 11, color: C.dim }}>Auto-generate can still run from the study’s abstract without a PDF.</div>
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 320px', minWidth: 300, maxWidth: 460, height: PANE_H, minHeight: 420, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!study && <div style={{ fontSize: 12, color: C.muted }}>Select a study above to begin. Every method writes the same per-outcome record; auto/assisted results appear as drafts you confirm below.</div>}

          {study && method === 'auto' && (
            <MethodBox title="Auto-generate (deterministic)" desc="Reads the PDF text (or the abstract) and drafts records for your protocol outcomes — matching outcomes, harvesting n / events / mean±SD / effect sizes with 95% CI, and computing the effect size where the raw cells allow. Conservative: it flags uncertainty and never emits a confident wrong value.">
              <button onClick={runAuto} disabled={busy || readOnly} style={{ ...btnS('primary'), opacity: (busy || readOnly) ? 0.5 : 1 }}>{busy ? '⟳ Reading…' : '⚙ Auto-extract from this study'}</button>
              <ProtocolOutcomeHint outcomes={outcomes} />
              {detected.length > 0 && (
                <div style={{ marginTop: 4, border: `1px solid ${themeAlpha(C.yel, '55')}`, borderRadius: 8, padding: '10px 12px', background: themeAlpha(C.yel, '10') }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.txt, marginBottom: 6 }}>Outcomes detected in this paper</div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>Nothing matched your protocol outcomes. Pick one below to start a draft, or set your primary/secondary outcomes in the Protocol tab.</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {detected.slice(0, 12).map((cand, i) => (
                      <button key={i} onClick={() => extractDetected(cand)} style={{ ...btnS('ghost'), fontSize: 11, textAlign: 'left', justifyContent: 'flex-start' }} title={cand.excerpt || ''}>
                        + {cand.label}{cand.statPreview ? ` — ${cand.statPreview}` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
                  ? 'Drag around a results table → its shape is detected (effect + CI, 2×2, or mean/SD) and pre-mapped for you to confirm.'
                  : 'Drag around a figure → a guided digitizer opens (Kaplan–Meier → HR via Guyot 2012, forest, bar/error, box, scatter). No model call.'}
              </div>
              {!pdf.url && <div style={{ fontSize: 11, color: C.yel }}>Load a PDF first to pick a source.</div>}
            </MethodBox>
          )}

          {study && method === 'click' && (
            <MethodBox title="Click-assign" desc="Click a number in the PDF to push it into the field you choose here. A single click captures the whole number — including a value with its 95% CI, or an events/total pair. Provenance-noted and editable.">
              <label style={lbl}>Assign clicked number to</label>
              <select value={assignField} onChange={(e) => setAssignField(e.target.value)} style={{ ...inp, fontSize: 12 }}>
                {ASSIGN_FIELDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              {!pdf.url && <div style={{ fontSize: 11, color: C.yel }}>Load a PDF first to click values.</div>}
            </MethodBox>
          )}

          {study && method === 'manual' && (
            <MethodBox title="Manual entry" desc="Type every value in this study’s card — always available, every field editable and auditable.">
              <button onClick={onViewRecords} style={{ ...btnS('ghost'), fontSize: 12 }}>↓ Edit this study’s card in Extracted records</button>
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

          {/* Overwrite guard (§21.5): a click that would replace an existing value asks first. */}
          {pendingAssign && (
            <div role="alertdialog" aria-label="Confirm replacing existing values"
              style={{ border: `1.5px solid ${themeAlpha(C.yel, '66')}`, borderRadius: 8, padding: '10px 12px', background: themeAlpha(C.yel, '10') }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, marginBottom: 6 }}>
                This field already has a value
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                {pendingAssign.conflicts.map((c) => (
                  <div key={c.field} style={{ fontSize: 11.5, fontFamily: "'IBM Plex Mono',monospace", color: C.txt2 }}>
                    Replace <b>{c.field}</b> {c.existing} with {c.incoming}?
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => resolvePendingAssign('keep')} style={{ ...btnS('ghost'), fontSize: 11 }}>Keep current</button>
                <button onClick={() => resolvePendingAssign('replace')} style={{ ...btnS('danger'), fontSize: 11 }}>Replace</button>
              </div>
            </div>
          )}

          {status && <div style={{ fontSize: 11.5, color: C.grn, lineHeight: 1.5 }}>{status}</div>}
          {error && <div style={{ fontSize: 11.5, color: C.red, lineHeight: 1.5 }}>{error}</div>}
          {pdf.error && <div style={{ fontSize: 11.5, color: C.yel }}>{pdf.error}</div>}

          {/* Drafts to review — inside the sticky panel so you confirm next to the PDF. */}
          {(draftsForStudy.length > 0 || parked.length > 0) && (
            <div style={{ marginTop: 4 }}>
              <DraftReviewList
                drafts={draftsForStudy}
                parked={parked}
                outcomes={outcomes}
                compact
                onConfirm={canConfirm ? onConfirmDraft : undefined}
                onDismiss={onDismissDraft}
                onPark={onParkDraft}
                onUnpark={onUnparkRecord}
                onEditField={onEditDraftField}
              />
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Done → continue */}
          {study && (
            <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>When done:</span>
              {onNextStudy && <button onClick={onNextStudy} style={{ ...btnS('ghost'), fontSize: 11 }}>Next study →</button>}
              {onViewRecords && <button onClick={onViewRecords} style={{ ...btnS('ghost'), fontSize: 11 }}>View records</button>}
              {onContinueToRob && <button onClick={onContinueToRob} style={{ ...btnS('primary'), fontSize: 11 }}>Continue to Risk of Bias →</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PdfSourceBar({ pdf, study, readOnly, onPickLocal }) {
  if (!study) return null;
  const label = pdf.source === 'screening' ? 'Attached PDF (from screening/full-text)'
    : pdf.source === 'oa' ? 'Open-access PDF (auto-retrieved)'
    : pdf.source === 'local' ? 'Uploaded PDF (this session)'
    : pdf.resolving ? 'Resolving…' : 'No PDF loaded';
  const canRetrieve = !!(pdf.canRetrieveOa && pdf.retrieveOa);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', borderBottom: `1px solid ${C.brd}`, background: C.bg, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: pdf.url ? C.grn : C.muted }}>{pdf.url ? '● ' : '○ '}{label}</span>
      <div style={{ flex: 1 }} />
      {!readOnly && (
        <label style={{ cursor: 'pointer' }}>
          <span style={{ ...btnS('ghost'), fontSize: 11, display: 'inline-block' }}>{pdf.url ? '↻ Replace' : '⬆ Upload'}</span>
          <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={(e) => { onPickLocal(e.target.files && e.target.files[0]); e.target.value = ''; }} />
        </label>
      )}
      {!readOnly && canRetrieve && (
        <button onClick={() => pdf.retrieveOa()} disabled={pdf.retrieving} style={{ ...btnS('ghost'), fontSize: 11, opacity: pdf.retrieving ? 0.5 : 1 }}>
          {pdf.retrieving ? '⟳ Finding…' : '🔎 Find open-access PDF'}
        </button>
      )}
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
    return <div style={{ fontSize: 11, color: C.yel, lineHeight: 1.5 }}>No protocol outcomes are defined yet — set primary/secondary outcomes in the Protocol tab so auto-extract knows what to look for. Until then it lists what it finds so you can choose.</div>;
  }
  return (
    <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.6 }}>
      Target outcomes: {outcomes.map((o) => `${o.level === 'primary' ? '●' : '○'} ${o.name}`).join('  ')}
    </div>
  );
}

/* Map a PlotDigitizer result into one or more draft extraction records.
   Ratio measures are stored on the ln scale (records/analysis convention). A digitization
   that yields a non-positive ratio estimate is a calibration error — we REJECT it (throw)
   rather than silently write NaN/-Infinity into es/lo/hi. */
function figureResultToRecords(result, { study, page, region, at }) {
  const base = { author: (study && study.author) || '', year: (study && study.year) || '', sourceStudyId: (study && study.id) || '' };
  const prov = { method: 'figure', page, region, excerpt: `Digitized from a ${result.figureType} figure.`, at };
  const v = result.values || {};
  if (result.figureType === 'forest' || result.figureType === 'km') {
    const measure = v.measure || (result.figureType === 'km' ? 'HR' : null);
    if (!measure) throw new Error('Choose the forest plot’s measure (OR / RR / HR / SMD …) before applying.');
    const ratio = ['OR', 'RR', 'HR', 'IRR'].includes(measure);
    if (ratio) {
      const est = Number(v.est), lo = Number(v.lo), hi = Number(v.hi);
      if (!(est > 0) || !(lo > 0) || !(hi > 0)) {
        throw new Error('The digitized estimate/CI came out ≤ 0, which a ratio measure cannot take — re-check the axis calibration (is the axis on a log scale?).');
      }
      return [mkExtractionRecord({
        ...base, esType: measure, values: { es: String(Math.log(est)), lo: String(Math.log(lo)), hi: String(Math.log(hi)) }, provenance: prov, confidence: 'medium',
        conversions: [{ id: Math.random().toString(36).slice(2, 10), type: 'ratio_log', method: 'ln(estimate); SE from CI', reason: `digitized ${result.figureType}`, at, inputs: { est, lo, hi }, result: { es: Math.log(est), lo: Math.log(lo), hi: Math.log(hi) } }],
        notes: `Digitized ${measure} ${est} [${lo}, ${hi}] from a ${result.figureType}. Verify against the figure.`,
      })];
    }
    return [mkExtractionRecord({
      ...base, esType: measure, values: { es: String(v.est), lo: String(v.lo), hi: String(v.hi) }, provenance: prov, confidence: 'medium',
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
  return [mkExtractionRecord({
    ...base, provenance: prov, confidence: 'low',
    notes: `Digitized ${result.figureType}: ${JSON.stringify(v).slice(0, 200)}`,
  })];
}
