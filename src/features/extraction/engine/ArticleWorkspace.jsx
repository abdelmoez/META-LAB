/**
 * features/extraction/engine/ArticleWorkspace.jsx — 76.md §7–§17 & §22, 77.md §2/§3/§4/§7/§8.
 *
 * The full-screen, article-centred extraction workspace: a resizable split with the
 * PDF on the left (AppPdfViewer, with jump-to-source reveal) and a structured
 * extraction form on the right, plus a stable top toolbar (methods · progress ·
 * validation · honest save status · prev/next article · complete).
 *
 * TWO input methods only (77.md §3):
 *   • Pick from PDF — choose/focus a field, click its number in the PDF → it fills that
 *     field, KEEPING structured per-value provenance (page + bbox). Clicking a second
 *     number over an existing value REPLACES it immediately (the prior value is kept in
 *     the value's provenance history — never a silent loss). The active field is obvious
 *     and auto-advances through the effect measure's required fields (77.md §2/§7/§8).
 *   • Manual Entry — the always-visible form; every field is editable + auditable.
 * A Converter (77.md §4) sits where the parked list used to, to recover mean/SD, SE,
 * counts and log-ratios from what the paper reports.
 *
 * Table- and figure-recognition modes were removed from the user-facing workflow
 * (77.md §3); the pure engines remain in the repo for reuse/migration but are not
 * surfaced here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppPdfViewer from '../../../frontend/components/AppPdfViewer.jsx';
import { C, btnS, inp, lbl, tagS } from '../../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';
import { usePdfSource } from '../unified/usePdfSource.js';
import DraftReviewList from '../unified/DraftReviewList.jsx';
import { snapToken } from '../../../research-engine/extraction/cellGrammar.js';
import { findNumberTokens } from '../../../research-engine/extraction/numberTokens.js';
import { useExtractionSplit } from './useExtractionSplit.js';
import { expectedFieldsFor, progressOf, assignableFieldsFor, usesEffectSlot, nextAssignableField } from '../../../research-engine/extraction/engine/articleStatus.js';
import { evaluateCompletion } from '../../../research-engine/extraction/engine/completionGate.js';
import { readProvenance, hasSourceEvidence } from '../../../research-engine/extraction/engine/articleProvenance.js';
import {
  familyOf, reportedFormatsFor, effectiveReportedFormat, defaultReportedFormat,
  harmonizeStudy, conversionStatusOf, CONVERSION_STATUS_LABELS, validateReported,
} from '../../../research-engine/extraction/harmonize.js';
import ConverterPanel from './ConverterPanel.jsx';

const RATIO_MEASURES = ['OR', 'RR', 'HR', 'IRR'];
const ES_TYPES = [['', '—'], ['OR', 'Odds ratio'], ['RR', 'Risk ratio'], ['HR', 'Hazard ratio'], ['IRR', 'Incidence-rate ratio'], ['SMD', 'Std. mean diff'], ['MD', 'Mean difference'], ['PROP', 'Proportion'], ['COR', 'Correlation'], ['DIAG', 'Diagnostic 2×2']];

const FIELD_LABELS = {
  author: 'Author / label', year: 'Year', outcome: 'Outcome', timepoint: 'Time point', esType: 'Effect measure',
  a: '2×2 a (event/Exp)', b: '2×2 b (no event/Exp)', c: '2×2 c (event/Ctrl)', d: '2×2 d (no event/Ctrl)',
  events: 'Events', total: 'Total', tp: 'TP', fp: 'FP', fn: 'FN', tn: 'TN',
  nExp: 'n (Exp)', meanExp: 'Mean (Exp)', sdExp: 'SD (Exp)', nCtrl: 'n (Ctrl)', meanCtrl: 'Mean (Ctrl)', sdCtrl: 'SD (Ctrl)',
  es: 'Effect size (analysis scale)', lo: 'CI lower', hi: 'CI upper',
  // 82.md reported-as-stated continuous fields (per arm)
  medianExp: 'Median (Exp)', q1Exp: 'Q1 / 25th pct (Exp)', q3Exp: 'Q3 / 75th pct (Exp)', minExp: 'Minimum (Exp)', maxExp: 'Maximum (Exp)', seExp: 'SE (Exp)', ciLoExp: 'Mean 95% CI lower (Exp)', ciHiExp: 'Mean 95% CI upper (Exp)',
  medianCtrl: 'Median (Ctrl)', q1Ctrl: 'Q1 / 25th pct (Ctrl)', q3Ctrl: 'Q3 / 75th pct (Ctrl)', minCtrl: 'Minimum (Ctrl)', maxCtrl: 'Maximum (Ctrl)', seCtrl: 'SE (Ctrl)', ciLoCtrl: 'Mean 95% CI lower (Ctrl)', ciHiCtrl: 'Mean 95% CI upper (Ctrl)',
};
const REPORTED_CONT_FIELDS = ['medianExp', 'q1Exp', 'q3Exp', 'minExp', 'maxExp', 'seExp', 'ciLoExp', 'ciHiExp', 'medianCtrl', 'q1Ctrl', 'q3Ctrl', 'minCtrl', 'maxCtrl', 'seCtrl', 'ciLoCtrl', 'ciHiCtrl'];
const IDENTITY_FIELDS = ['author', 'year', 'outcome', 'timepoint'];
const NUMERIC_FIELDS = new Set(['a', 'b', 'c', 'd', 'events', 'total', 'tp', 'fp', 'fn', 'tn', 'nExp', 'meanExp', 'sdExp', 'nCtrl', 'meanCtrl', 'sdCtrl', 'es', 'lo', 'hi', 'year', ...REPORTED_CONT_FIELDS]);
const ALL_VALUE_KEYS = ['es', 'lo', 'hi', 'a', 'b', 'c', 'd', 'events', 'total', 'tp', 'fp', 'fn', 'tn', 'nExp', 'meanExp', 'sdExp', 'nCtrl', 'meanCtrl', 'sdCtrl', ...REPORTED_CONT_FIELDS];
const nonEmpty = (v) => v !== '' && v !== null && v !== undefined;

const COACH_KEY = 'metalab.extraction.pickCoachDismissed';

const onlyToken = (s) => { const toks = findNumberTokens(String(s || '')); return toks.length === 1 ? snapToken(String(s), toks[0].start) : null; };
const tokenPrimary = (t) => (t == null ? null : t.value != null ? t.value : t.est != null ? t.est : t.a != null ? t.a : t.lo != null ? t.lo : null);

/** The next-click target options for the current measure: Smart + its expected fields. */
function assignOptionsFor(study) {
  const fields = assignableFieldsFor(study);
  const opts = [['smart', '✦ Smart (value + its 95% CI, or events + total)']];
  for (const f of fields) opts.push([f, FIELD_LABELS[f] || f]);
  return opts;
}
/** The sensible default pick target for a measure: Smart for effect-slot measures,
 *  else the first required value field so the 2×2/continuous boxes fill in order. */
function defaultActiveField(study) {
  if (usesEffectSlot(study) || !study.esType) return 'smart';
  const fields = assignableFieldsFor(study);
  return fields[0] || 'smart';
}

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
  const [method, setMethod] = useState('click');      // click (Pick from PDF) | manual
  const [activeField, setActiveField] = useState('smart');  // the field the next PDF click fills
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [reveal, setReveal] = useState(null);          // { page, region, nonce }
  const [showChecks, setShowChecks] = useState(true);
  const [convOpen, setConvOpen] = useState(false);   // 82.md — discoverable Converter panel
  const converterRef = useRef(null);
  const [coachDismissed, setCoachDismissed] = useState(() => {
    try { return localStorage.getItem(COACH_KEY) === '1'; } catch { return false; }
  });
  const revealNonce = useRef(0);
  const docRef = useRef(null);
  const rowRef = useRef(null);
  const split = useExtractionSplit(rowRef);

  // When a PDF is persisted to the blob-anchored study-document store (a non-screening
  // study), stamp the pointer into the study blob so a whole-blob autosave can't clobber
  // the server's durable write (77.md §5).
  const onDocPersisted = useCallback((sid, document) => { if (onPatchStudy && document) onPatchStudy(sid, { document, updatedAt: new Date().toISOString() }); }, [onPatchStudy]);
  const pdf = usePdfSource(study, projectId, { onDocumentPersisted: onDocPersisted });
  const completion = useMemo(() => evaluateCompletion(study || {}), [study]);
  const progress = useMemo(() => progressOf(study || {}), [study]);
  // Show every EXPECTED field, plus any OTHER value field that already carries data, so a
  // value captured for this measure is never invisible (77.md §7 — e.g. a Smart capture of
  // RR + CI into es/lo/hi stays visible even though RR "expects" the 2×2 cells).
  const valueFields = useMemo(() => {
    const expected = expectedFieldsFor(study || {}).filter((f) => !['author', 'year', 'outcome', 'timepoint', 'esType'].includes(f));
    const extra = ALL_VALUE_KEYS.filter((f) => !expected.includes(f) && nonEmpty((study || {})[f]));
    return [...expected, ...extra];
  }, [study]);
  const assignOptions = useMemo(() => assignOptionsFor(study || {}), [study && study.esType]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = !!(article && article.status === 'locked');
  const completed = !!(article && (article.status === 'complete' || article.status === 'locked'));
  const editable = !readOnly && !completed;

  const studyId = study && study.id;
  const esType = study && study.esType;
  // New article → reset the transient UI + the pick target to the measure default.
  useEffect(() => {
    setReveal(null); setStatus(''); setError('');
    setActiveField(defaultActiveField(study || {}));
  }, [studyId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Measure changed (same article) → clamp the pick target to a field the new measure
  // actually uses (77.md §7 root cause: a stale 'smart'/off-measure target inserted nothing).
  useEffect(() => {
    setActiveField((cur) => {
      if (cur === 'smart') return usesEffectSlot(study || {}) || !esType ? 'smart' : defaultActiveField(study || {});
      return assignableFieldsFor(study || {}).includes(cur) ? cur : defaultActiveField(study || {});
    });
  }, [esType]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = useCallback((p) => { if (onPatchStudy && study) onPatchStudy(study.id, p); }, [onPatchStudy, study]);

  const dismissCoach = useCallback(() => { setCoachDismissed(true); try { localStorage.setItem(COACH_KEY, '1'); } catch { /* ignore */ } }, []);

  /* ── Jump-to-source: reveal a field's stored provenance in the PDF (§15) ── */
  const jumpToSource = useCallback((field) => {
    const prov = readProvenance(study, field);
    if (!prov || (!prov.page && !prov.bbox)) { setStatus('No saved source for this value yet.'); return; }
    revealNonce.current += 1;
    setReveal({ page: prov.page || 1, region: prov.bbox || null, nonce: revealNonce.current });
    setStatus(`Jumped to the source of ${FIELD_LABELS[field] || field}${prov.page ? ` (p. ${prov.page})` : ''}.`);
  }, [study]);

  /**
   * writeValues — the ONE write path for both click-to-pick and the Converter. Writes
   * the value fields in `values`, RECORDING any replaced prior value in that field's
   * provenance history (so replacement is immediate but never a silent data loss — 77.md
   * §2), attaches fresh per-value provenance, and threads an optional conversions[] audit.
   * @returns {{written:string[], replaced:Array<{field,from,to}>}}
   */
  const writeValues = useCallback((values, prov = {}, extra = {}) => {
    if (!study || !editable) return { written: [], replaced: [] };
    const now = new Date().toISOString();
    const written = [];
    const replaced = [];
    const provFields = {};
    const p = {};
    for (const f of Object.keys(values)) {
      if (!ALL_VALUE_KEYS.includes(f)) continue;
      const nextVal = String(values[f]);
      // Identical value → a true no-op: never churn autosave or shed history on a re-pick.
      if (nonEmpty(study[f]) && String(study[f]) === nextVal) continue;
      p[f] = values[f];
      written.push(f);
      const prior = readProvenance(study, f);
      const history = Array.isArray(prior && prior.history) ? prior.history.slice(-10) : [];
      if (nonEmpty(study[f])) {
        replaced.push({ field: f, from: String(study[f]), to: nextVal });
        history.push({ value: String(study[f]), method: (prior && prior.method) || 'manual', at: now });
      }
      provFields[f] = {
        method: prov.method || 'manual', page: prov.page || null, bbox: prov.bbox || null,
        excerpt: prov.excerpt ? String(prov.excerpt).slice(0, 200) : undefined, at: now,
        history: history.length ? history.slice(-10) : undefined,
      };
    }
    if (!written.length) return { written: [], replaced: [] };
    p.needsReview = true;
    if (!study.source && !extra.source) p.source = 'text';
    Object.assign(p, extra);
    patch(p);
    if (onAttachProvenance) onAttachProvenance(study.id, provFields);
    return { written, replaced };
  }, [study, editable, patch, onAttachProvenance]);

  /* ── Pick from PDF: snap a token, write the active field(s), auto-advance ── */
  const assignFromClick = useCallback((payload) => {
    if (!study || !editable) return;
    const runStr = payload.str || '';
    const token = (payload.offset != null) ? snapToken(runStr, payload.offset) : onlyToken(runStr);
    if (!token) {
      const n = findNumberTokens(runStr).length;
      setStatus(n === 0 ? `"${runStr}" has no number to capture.` : 'Could not pinpoint which number you clicked — zoom in and click directly on it.');
      return;
    }
    const target = activeField;
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

    const values = {};
    let advance = true;   // single-field captures auto-advance; composite Smart captures don't
    if (target === 'smart') {
      advance = false;
      if (token.kind === 'p') { setStatus('That looks like a p-value — pick the effect estimate or its CI instead.'); return; }
      if (token.kind === 'percent') { setStatus('That looks like a percentage — choose the exact field (events, n, …) from the field selector.'); return; }
      if (token.kind === 'ratioCI') { const e = esFields(token.est, token.lo, token.hi); if (!e) { setStatus('That estimate/CI is ≤ 0, which a ratio measure cannot take.'); return; } Object.assign(values, e); }
      else if (token.kind === 'range') { const e = esFields(null, token.lo, token.hi); if (!e) { setStatus('That CI is ≤ 0, which a ratio measure cannot take.'); return; } Object.assign(values, e); }
      else if (token.kind === 'pair') { values.events = String(token.a); values.total = String(token.b); }
      else if (token.kind === 'meanSd') { values.meanExp = String(token.a); values.sdExp = String(token.b); }
      else {
        const raw = tokenPrimary(token);
        if (raw == null) { setStatus(`"${runStr}" has no number to capture.`); return; }
        // A lone number in Smart mode only makes sense as the effect estimate for an
        // es/lo/hi measure. For a 2×2 / continuous / count measure, route the user to the
        // exact field instead of silently writing it into the (hidden) es slot (77.md §7).
        if (!usesEffectSlot(study)) { setStatus('That is a single number — choose the exact field (events, n, or a 2×2 cell) above, then click it.'); return; }
        const e = esFields(Number(raw), null, null); if (!e) { setStatus('That value is ≤ 0, which a ratio measure cannot take on the log scale.'); return; }
        Object.assign(values, e);
      }
    } else {
      // A specific field is the target — but a p-value or percentage is almost never the
      // literal value for a count/effect field, so guard the same way Smart mode does.
      if (token.kind === 'p') { setStatus('That looks like a p-value — pick the effect estimate or its CI instead.'); return; }
      if (token.kind === 'percent') { setStatus('That looks like a percentage — capture the reported count, not the percent.'); return; }
      const n = tokenPrimary(token);
      if (n == null) { setStatus(`"${runStr}" has no number to capture.`); return; }
      // es/lo/hi live on the ANALYSIS (ln) scale for ratio measures — a direct capture
      // must ln-transform too (76.md review), otherwise the raw ratio pools as ln(ratio).
      if (isRatio && (target === 'es' || target === 'lo' || target === 'hi')) {
        if (!(n > 0)) { setStatus('That value is ≤ 0, which a ratio measure cannot take on the log scale.'); return; }
        values[target] = String(Math.log(n));
        conv.push({ id: Math.random().toString(36).slice(2, 10), type: 'ratio_log', method: 'ln(value)', reason: `click-assign ${target} (${study.esType})`, at: new Date().toISOString(), inputs: { [target]: n }, result: { [target]: Math.log(n) } });
      } else {
        values[target] = String(n);
      }
    }
    if (!Object.keys(values).length) { setStatus('Nothing captured — click directly on the number.'); return; }

    const extra = conv.length ? { conversions: [...(Array.isArray(study.conversions) ? study.conversions : []), ...conv], converted: true } : {};
    const { written, replaced } = writeValues(values, { method: 'click', page: payload.page || null, bbox: payload.spanBox || null, excerpt: runStr }, extra);
    if (!written.length) return;

    // Human-readable confirmation (aria-live) — say what filled and what was replaced.
    const names = written.map((f) => FIELD_LABELS[f] || f);
    if (replaced.length) {
      const r = replaced[0];
      setStatus(`Replaced ${FIELD_LABELS[r.field] || r.field} (was ${r.from}) → ${r.to}. Previous value kept in history.`);
    } else {
      setStatus(`Captured ${names.join(', ')} from the PDF.`);
    }

    // Auto-advance the active field to the next empty required field (fills a→b→c→d).
    if (advance) {
      const after = { ...study, ...values };
      const next = nextAssignableField(after, target);
      if (next && next !== target) setActiveField(next);
    }
  }, [study, activeField, editable, writeValues]);

  /* ── Converter apply (77.md §4): route through the same write path + audit ── */
  const applyConversion = useCallback(({ patch: convPatch, conversion, targetLabel }) => {
    if (!study || !editable || !convPatch) return;
    // The 'es' converter target (ratio_log) emits es/lo/hi already on the LN scale. Only a
    // ratio measure stores es on the ln scale — applying it under a non-ratio (or unset)
    // measure would silently mis-scale the effect size (77.md §4, review finding).
    if (['es', 'lo', 'hi'].some((k) => k in convPatch) && !RATIO_MEASURES.includes(study.esType)) {
      setStatus('This conversion produces a log-scale effect size, which only applies to a ratio measure (OR/RR/HR/IRR). Set the effect measure first.');
      return;
    }
    const now = new Date().toISOString();
    const record = { id: Math.random().toString(36).slice(2, 10), type: conversion.type, method: conversion.method, reason: conversion.reason || '', inputs: conversion.inputs || {}, formula: conversion.formula, at: now, target: targetLabel };
    const note = `Converted (${conversion.label}): ${conversion.detail}${conversion.reason ? ` — ${conversion.reason}` : ''}.`;
    const extra = {
      conversions: [...(Array.isArray(study.conversions) ? study.conversions : []), record],
      converted: true,
      notes: study.notes ? `${study.notes} | ${note}` : note,
    };
    const { written, replaced } = writeValues(convPatch, { method: 'manual', excerpt: note }, extra);
    if (!written.length) { setStatus('Nothing applied.'); return; }
    setStatus(replaced.length
      ? `Applied converted value; replaced ${FIELD_LABELS[replaced[0].field] || replaced[0].field} (kept in history).`
      : `Applied converted value to ${written.map((f) => FIELD_LABELS[f] || f).join(', ')}.`);
  }, [study, editable, writeValues]);

  /* ── 82.md — reported→analysis harmonization (auto-convert median/IQR etc.) ── */
  const harmonization = useMemo(() => harmonizeStudy(study || {}), [study]);
  const convStatus = useMemo(() => conversionStatusOf(study || {}), [study]);
  const reportedFormats = useMemo(() => reportedFormatsFor((study && study.esType) || ''), [study && study.esType]);
  const activeFormat = effectiveReportedFormat(study || {});

  /** Apply the pending harmonization: derive meanExp/sdExp/… from the reported values,
   *  stamp the conversion audit (formatId + inputsHash so stale-detection works), and
   *  route through the SAME immediate-replace + provenance write path. Never touches the
   *  reported fields, so the paper's original numbers are preserved. */
  const applyHarmonization = useCallback(() => {
    if (!study || !editable) return;
    const plan = harmonizeStudy(study);
    if (!plan.required || !Object.keys(plan.writes).length) { setStatus('Nothing to convert — enter the reported values first.'); return; }
    const now = new Date().toISOString();
    const records = plan.conversions.map((c) => ({
      ...c, id: Math.random().toString(36).slice(2, 10), at: now,
      type: c.method, reason: `Harmonized ${activeFormat} → analysis (${c.target === 'exp' ? 'intervention' : 'comparator'} arm)`,
    }));
    // Replace any prior harmonization records (they carry formatId); keep other conversions.
    const priorOther = (Array.isArray(study.conversions) ? study.conversions : []).filter((c) => !c || !c.formatId);
    const extra = { conversions: [...priorOther, ...records], converted: true };
    const { written } = writeValues(plan.writes, { method: 'manual', excerpt: `Auto-harmonized from ${activeFormat}` }, extra);
    if (!written.length) { setStatus('Conversion produced no change.'); return; }
    const warn = plan.warnings.length ? ` ⚠ ${plan.warnings[0]}` : '';
    setStatus(`Converted the reported values to ${written.map((f) => FIELD_LABELS[f] || f).join(', ')}. Original reported values are preserved.${warn}`);
  }, [study, editable, writeValues, activeFormat]);

  const interaction = useMemo(() => {
    if (!editable || !pdf.url || method !== 'click') return null;
    return { mode: 'click', onTextClick: assignFromClick, onTextMiss: () => setStatus('No number there — zoom in, or run text recognition on scanned pages.') };
  }, [method, assignFromClick, pdf.url, editable]);

  const setField = useCallback((f, v) => {
    if (!editable || !study) return;
    patch({ [f]: v, needsReview: true });
    // 77.md §2/§15 — a manually typed VALUE invalidates any prior click/table source
    // location (which described the previous value). Re-attribute the field to 'manual',
    // drop the stale page/bbox so jump-to-source can't point at the wrong place, and keep
    // the replaced value in history.
    if (ALL_VALUE_KEYS.includes(f) && onAttachProvenance) {
      const prior = readProvenance(study, f);
      const changed = String(study[f] || '') !== String(v);
      if (prior && (prior.page || prior.bbox || prior.method) && changed) {
        const history = Array.isArray(prior.history) ? prior.history.slice(-10) : [];
        if (nonEmpty(study[f])) history.push({ value: String(study[f]), method: prior.method || 'manual', at: new Date().toISOString() });
        onAttachProvenance(study.id, { [f]: { method: 'manual', page: null, bbox: null, history: history.length ? history : undefined } });
      }
    }
  }, [editable, study, patch, onAttachProvenance]);
  const focusField = useCallback((f) => { if (method === 'click' && assignOptions.some(([k]) => k === f)) setActiveField(f); }, [method, assignOptions]);

  const activeLabel = activeField === 'smart'
    ? 'Smart (value + its 95% CI, or events + total)'
    : (FIELD_LABELS[activeField] || activeField);

  const saveBadge = saveStatus === 'saving' ? { t: 'Saving…', c: C.acc }
    : saveStatus === 'saved' ? { t: 'Saved', c: C.grn }
      : saveStatus === 'error' ? { t: 'Save failed', c: C.red } : null;

  return (
    <div data-testid="pex-workspace" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
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
          <div role="tablist" aria-label="Extraction input mode" style={{ display: 'flex', border: `1px solid ${C.brd}`, borderRadius: 6, overflow: 'hidden', marginLeft: 6 }}>
            {[['click', '⊹ Pick from PDF'], ['manual', '⌨ Manual Entry']].map(([m, label]) => (
              <button key={m} role="tab" aria-selected={method === m} onClick={() => setMethod(m)}
                style={{ padding: '6px 12px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: method === m ? C.acc : 'transparent', color: method === m ? C.accText : C.muted }}>{label}</button>
            ))}
          </div>
        )}
        {!readOnly && (
          <button onClick={() => { setConvOpen(true); setTimeout(() => { try { converterRef.current && converterRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* ignore */ } }, 30); }}
            style={{ ...btnS('ghost'), fontSize: 11 }} title="Open the data converter (median/IQR → mean/SD, SE → SD, CI → SE, log-ratios…)">🔄 Convert</button>
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
                <label style={{ cursor: pdf.uploading ? 'default' : 'pointer' }}>
                  <span style={{ ...btnS('ghost'), fontSize: 12, display: 'inline-block', opacity: pdf.uploading ? 0.6 : 1 }}>{pdf.uploading ? 'Uploading…' : '⬆ Upload a PDF'}</span>
                  <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} disabled={pdf.uploading}
                    onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; pdf.setLocalFile(f, { persist: true }); }} />
                </label>
              )}
              <div style={{ fontSize: 11, color: C.dim }}>
                {pdf.resolving
                  ? 'Manual entry works without a PDF — type values on the right.'
                  : pdf.canPersistUpload === false
                    ? 'An uploaded PDF stays in this tab only for now. Manual entry works without a PDF.'
                    : 'A PDF you upload here is saved to the project — it stays after you reload and is available in Risk of Bias (and Screening, when the study is screening-linked).'}
              </div>
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
          {/* Pick-from-PDF guidance + active-field selector (§8) */}
          {method === 'click' && !readOnly && (
            <div style={{ border: `1px solid ${themeAlpha(C.acc, '44')}`, background: themeAlpha(C.acc, '0c'), borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!coachDismissed && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.5, flex: 1 }}>
                    <strong style={{ color: C.txt }}>Pick from PDF is on.</strong> Choose the field to fill (below), then <strong>click that number in the PDF</strong>.
                    Click a different number to replace it — no need to clear it first.
                  </div>
                  <button onClick={dismissCoach} title="Dismiss this tip" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label htmlFor="pex-active-field" style={{ ...lbl, margin: 0 }}>Next click fills →</label>
                <select id="pex-active-field" value={activeField} onChange={(e) => setActiveField(e.target.value)} style={{ ...inp, width: 'auto', fontSize: 12 }}>
                  {assignOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {!pdf.url && <span style={{ fontSize: 11, color: C.yel }}>Load a PDF to click values.</span>}
              </div>
              {pdf.url && <div style={{ fontSize: 11, color: C.acc, fontWeight: 600 }}>◎ Now click the value for <strong>{activeLabel}</strong> in the PDF.</div>}
            </div>
          )}

          <div role="status" aria-live="polite" style={{ minHeight: status || error || pdf.error ? undefined : 0 }}>
            {status && <div style={{ fontSize: 11.5, color: C.grn, lineHeight: 1.5 }}>{status}</div>}
            {error && <div style={{ fontSize: 11.5, color: C.red, lineHeight: 1.5 }}>{error}</div>}
            {pdf.error && <div style={{ fontSize: 11.5, color: C.yel }}>{pdf.error}</div>}
          </div>

          {/* Structured form (§14 — identity + esType + value group) */}
          <FormSection title="Study & outcome">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {IDENTITY_FIELDS.map((f) => (
                <Field key={f} field={f} value={study[f] || ''} onChange={(v) => setField(f, v)} readOnly={!editable}
                  hasSource={hasSourceEvidence(study, f)} onJump={() => jumpToSource(f)} numeric={NUMERIC_FIELDS.has(f)} />
              ))}
              <div>
                <label style={lbl} htmlFor="pex-esType">{FIELD_LABELS.esType}</label>
                <select id="pex-esType" data-testid="pex-esType" value={study.esType || ''} onChange={(e) => setField('esType', e.target.value)} disabled={!editable} style={{ ...inp, fontSize: 12 }}>
                  {ES_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              {/* 82.md — REPORTED FORMAT is separate from the analytical effect measure.
                  Only shown for continuous measures, where the paper may report mean/SD,
                  median/IQR, median/range, mean/SE or mean/CI. Drives the fields below. */}
              {familyOf(study.esType) === 'continuous' && reportedFormats.length > 0 && (
                <div>
                  <label style={lbl} htmlFor="pex-reportedFormat">Reported as</label>
                  <select id="pex-reportedFormat" data-testid="pex-reportedFormat" value={activeFormat}
                    onChange={(e) => setField('reportedFormat', e.target.value)} disabled={!editable} style={{ ...inp, fontSize: 12 }}>
                    {reportedFormats.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                </div>
              )}
            </div>
          </FormSection>

          <FormSection title={`Values${RATIO_MEASURES.includes(study.esType) ? ' · es/lo/hi stored on the ln scale' : ''}`}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {valueFields.map((f) => (
                <Field key={f} field={f} value={study[f] || ''} onChange={(v) => setField(f, v)} readOnly={!editable}
                  hasSource={hasSourceEvidence(study, f)} onJump={() => jumpToSource(f)} numeric
                  picking={method === 'click' && !readOnly} active={method === 'click' && activeField === f}
                  onFocusField={() => focusField(f)} />
              ))}
            </div>
            {/* 82.md — harmonization review: reported→analysis conversion status, transparent
                and reversible. The reported values above are never overwritten. */}
            {harmonization.required && (
              <div data-testid="pex-harmonize" style={{ marginTop: 10, border: `1px solid ${convStatus === 'stale' ? themeAlpha(C.yel, '66') : themeAlpha(C.acc, '44')}`, background: convStatus === 'stale' ? themeAlpha(C.yel, '10') : themeAlpha(C.acc, '0c'), borderRadius: 8, padding: '9px 11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: convStatus === 'stale' ? C.yel : convStatus === 'unable' ? C.red : C.acc }}>
                    {CONVERSION_STATUS_LABELS[convStatus] || convStatus}
                  </span>
                  <span style={{ fontSize: 11, color: C.muted, flex: 1, minWidth: 120 }}>
                    → estimated mean &amp; SD for analysis (reported values are kept).
                  </span>
                  {editable && (convStatus === 'eligible' || convStatus === 'stale') && (
                    <button onClick={applyHarmonization} style={{ ...btnS(convStatus === 'stale' ? 'ghost' : 'primary'), fontSize: 11 }}>
                      {convStatus === 'stale' ? '↻ Update conversion' : '✦ Convert to mean & SD'}
                    </button>
                  )}
                </div>
                {convStatus === 'stale' && <div style={{ fontSize: 11, color: C.yel, marginTop: 6, lineHeight: 1.5 }}>A reported value changed since this was converted — the analysis mean/SD are out of date. Recompute before using them.</div>}
                {convStatus === 'missing' && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Enter the reported values above (both arms) to enable the conversion.</div>}
                {convStatus === 'generated' && <div style={{ fontSize: 11, color: C.grn, marginTop: 6 }}>✓ Converted values applied and up to date.</div>}
                {harmonization.errors.map((e, i) => <div key={`e${i}`} style={{ fontSize: 11, color: C.red, marginTop: 5, lineHeight: 1.5 }}>✗ {e}</div>)}
                {harmonization.warnings.map((w, i) => <div key={`w${i}`} style={{ fontSize: 11, color: C.yel, marginTop: 5, lineHeight: 1.5 }}>⚠ {w}</div>)}
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <label style={lbl}>Notes — assumptions, conversions, unclear data</label>
              <textarea value={study.notes || ''} onChange={(e) => setField('notes', e.target.value)} disabled={!editable}
                placeholder="e.g. SD imputed from SE; median/IQR converted via Wan 2014; adjusted for age & sex…" style={{ ...inp, height: 48, resize: 'vertical', fontSize: 12 }} />
            </div>
          </FormSection>

          {/* Drafts to confirm (from assisted/auto paths; parked list replaced by the Converter). */}
          {drafts.length > 0 && (
            <DraftReviewList drafts={drafts} parked={[]} outcomes={outcomes} compact showParked={false}
              onConfirm={onConfirmDraft} onDismiss={onDismissDraft} onPark={onParkDraft} onUnpark={onUnparkRecord} onEditField={onEditDraftField} />
          )}

          {/* Converter (§4) — discoverable via the toolbar "🔄 Convert" button (82.md Part 4). */}
          {!readOnly && (
            <div ref={converterRef}>
              <ConverterPanel onApply={applyConversion} disabled={!editable} open={convOpen} onOpenChange={setConvOpen} />
            </div>
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

function Field({ field, value, onChange, readOnly, hasSource, onJump, numeric, picking, active, onFocusField }) {
  const borderColor = active ? C.acc : hasSource ? themeAlpha(C.acc, '55') : C.brd;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <label style={{ ...lbl, margin: 0, color: active ? C.acc : undefined }}>
          {active ? '◎ ' : ''}{FIELD_LABELS[field] || field}
        </label>
        {hasSource ? (
          <button onClick={onJump} title="Jump to this value’s source in the PDF"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.acc, fontSize: 10.5, fontWeight: 700, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            ⌖ source
          </button>
        ) : null}
      </div>
      <input value={value} onChange={(e) => onChange(e.target.value)} disabled={readOnly}
        inputMode={numeric ? 'decimal' : undefined}
        onFocus={picking ? onFocusField : undefined}
        aria-label={active ? `${FIELD_LABELS[field] || field} — active pick target` : undefined}
        style={{ ...inp, fontSize: 12.5, fontFamily: numeric ? "'IBM Plex Mono',monospace" : 'inherit', borderColor, boxShadow: active ? `0 0 0 2px ${themeAlpha(C.acc, '33')}` : undefined }} />
    </div>
  );
}
