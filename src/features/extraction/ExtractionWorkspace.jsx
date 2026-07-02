/**
 * features/extraction/ExtractionWorkspace.jsx — 66.md (P5). The structured
 * data-extraction workspace (flag `extractionAssist`). A first-class research surface
 * over the extraction backend (server/routes/extraction.js). It does NOT re-implement
 * extraction — it drives the contract API (extractionApi.js) and renders:
 *
 *   LEFT   — studies list + consensus progress (GET /overview).
 *   CENTER — the extraction form for the selected study; my own (blinded) values,
 *            debounced + explicit save (PUT /values), per-field provenance.
 *   RIGHT  — tabs: AI assist (suggestions only, POST /ai-suggest), Tables
 *            (POST /tables), Consensus (read-only reconciled values).
 *   ADJUDICATION — when overview.canAdjudicate, a full compare/resolve/send-to-MA
 *            surface replaces center+right for the selected study.
 *
 * Form setup: when no active form exists, an empty state offers a template picker;
 * a "Form" button opens the ElementsEditor. Reconstruction-first: panels always
 * refetch from the server; nothing is trusted from a previous render.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, btnS, themeAlpha, ErrorBanner, Skeleton, EmptyState } from './parts.jsx';
import { extractionApi } from './extractionApi.js';
import StudyList from './StudyList.jsx';
import FormPanel, { keyOf, DEFAULT_ARMS } from './FormPanel.jsx';
import AiAssistPanel from './AiAssistPanel.jsx';
import TablesPanel from './TablesPanel.jsx';
import ConsensusPanel from './ConsensusPanel.jsx';
import AdjudicationView from './AdjudicationView.jsx';
import ElementsEditor from './ElementsEditor.jsx';
import ValidationReportModal from './ValidationReportModal.jsx';

const SAVE_DEBOUNCE_MS = 800;
const RIGHT_TABS = [['ai', 'AI assist'], ['tables', 'Tables'], ['consensus', 'Consensus']];

export default function ExtractionWorkspace({ projectId }) {
  const mlpid = projectId;

  // ── Form + overview ──────────────────────────────────────────────────────────
  const [formData, setFormData] = useState(null);   // GET /form response
  const [overview, setOverview] = useState(null);    // GET /overview response
  const [bootState, setBootState] = useState('loading'); // loading | ready | error
  const [bootError, setBootError] = useState('');

  // ── Selection ────────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('extract'); // extract | adjudicate
  const [rightTab, setRightTab] = useState('ai');

  // ── Selected study values ────────────────────────────────────────────────────
  const [studyData, setStudyData] = useState(null); // GET /values response
  const [entries, setEntries] = useState({});        // key → { value, provenance, origin, suggestionId }
  const [studyState, setStudyState] = useState('idle'); // idle | loading | ready | error
  const [studyError, setStudyError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');  // '' | saving | saved | error

  // ── AI assist ────────────────────────────────────────────────────────────────
  const [suggestion, setSuggestion] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [rejectedKeys, setRejectedKeys] = useState(new Set());

  // ── Tables ───────────────────────────────────────────────────────────────────
  const [tables, setTables] = useState([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState('');
  const [parsing, setParsing] = useState(false);

  // ── Adjudication ─────────────────────────────────────────────────────────────
  const [compare, setCompare] = useState(null);
  const [compareState, setCompareState] = useState('idle');
  const [compareError, setCompareError] = useState('');
  const [adjudSaving, setAdjudSaving] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  // ── Modals ───────────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [formProblems, setFormProblems] = useState(null);
  const [showReport, setShowReport] = useState(false);

  const saveTimer = useRef(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const canEdit = formData ? formData.canEdit : false;
  const canAdjudicate = overview ? overview.canAdjudicate : false;
  const aiSettings = formData ? formData.aiSettings || {} : {};
  const elements = formData && formData.form ? formData.form.elements || [] : [];
  const elementsById = useMemo(() => {
    const m = {};
    for (const el of elements) m[el.id] = el;
    return m;
  }, [elements]);

  /* ── Boot: form + overview ─────────────────────────────────────────────────── */
  const loadBoot = useCallback(async () => {
    setBootState('loading'); setBootError('');
    try {
      const [form, ov] = await Promise.all([extractionApi.getForm(mlpid), extractionApi.getOverview(mlpid)]);
      setFormData(form);
      setOverview(ov);
      setBootState('ready');
      setSelectedId((prev) => prev || (ov.studies && ov.studies[0] ? ov.studies[0].studyId : null));
    } catch (e) {
      setBootError(e.message || 'Failed to load the extraction workspace');
      setBootState('error');
    }
  }, [mlpid]);

  useEffect(() => { loadBoot(); }, [loadBoot]);

  const refreshOverview = useCallback(async () => {
    try { setOverview(await extractionApi.getOverview(mlpid)); } catch { /* keep prior */ }
  }, [mlpid]);

  /* ── Load selected study values ────────────────────────────────────────────── */
  const loadStudy = useCallback(async (studyId) => {
    if (!studyId) return;
    setStudyState('loading'); setStudyError(''); setSuggestion(null); setAiError(''); setRejectedKeys(new Set());
    try {
      const data = await extractionApi.getStudyValues(mlpid, studyId);
      setStudyData(data);
      const map = {};
      for (const v of data.values || []) {
        map[keyOf(v.elementId, v.armKey)] = { value: v.value, provenance: v.provenance, origin: v.origin, suggestionId: v.suggestionId };
      }
      setEntries(map);
      setDirty(false); setSaveStatus('');
      setSuggestion(data.suggestion || null);
      setStudyState('ready');
    } catch (e) {
      setStudyError(e.message || 'Failed to load study values');
      setStudyState('error');
    }
  }, [mlpid]);

  useEffect(() => {
    if (selectedId && mode === 'extract') loadStudy(selectedId);
  }, [selectedId, mode, loadStudy]);

  /* ── Tables (lazy per study, when the tab is shown) ────────────────────────── */
  const loadTables = useCallback(async (studyId) => {
    if (!studyId) return;
    setTablesLoading(true); setTablesError('');
    try {
      const data = await extractionApi.getTables(mlpid, studyId);
      setTables(data.tables || []);
    } catch (e) {
      setTablesError(e.message || 'Failed to load tables');
    } finally {
      setTablesLoading(false);
    }
  }, [mlpid]);

  useEffect(() => {
    if (selectedId && mode === 'extract' && rightTab === 'tables') loadTables(selectedId);
  }, [selectedId, mode, rightTab, loadTables]);

  /* ── Save (debounced + explicit) ───────────────────────────────────────────── */
  const buildPayload = useCallback((map) => {
    const out = [];
    for (const [k, entry] of Object.entries(map)) {
      const idx = k.indexOf('::');
      const elementId = k.slice(0, idx);
      const armKey = k.slice(idx + 2);
      out.push({
        elementId, armKey,
        value: entry.value || {},
        provenance: entry.provenance || {},
        origin: entry.origin || 'manual',
        suggestionId: entry.suggestionId || null,
      });
    }
    return out;
  }, []);

  const doSave = useCallback(async () => {
    if (!selectedId) return;
    const payload = buildPayload(entriesRef.current);
    if (!payload.length) { setDirty(false); return; }
    setSaveStatus('saving');
    try {
      await extractionApi.putStudyValues(mlpid, selectedId, payload);
      setSaveStatus('saved'); setDirty(false);
      refreshOverview();
    } catch (e) {
      setSaveStatus('error');
      setStudyError(e.message || 'Save failed');
    }
  }, [mlpid, selectedId, buildPayload, refreshOverview]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { doSave(); }, SAVE_DEBOUNCE_MS);
  }, [doSave]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const onFieldChange = useCallback((element, armKey, value) => {
    setEntries((prev) => {
      const k = keyOf(element.id, armKey);
      const cur = prev[k] || {};
      // Manual edit of an accepted AI value downgrades origin to ai_edited.
      const origin = cur.origin === 'ai_accepted' ? 'ai_edited' : (cur.origin || 'manual');
      return { ...prev, [k]: { ...cur, value, origin } };
    });
    setDirty(true); setSaveStatus(''); scheduleSave();
  }, [scheduleSave]);

  const onFieldProvenance = useCallback((element, armKey, provenance) => {
    setEntries((prev) => {
      const k = keyOf(element.id, armKey);
      const cur = prev[k] || { value: {} };
      return { ...prev, [k]: { ...cur, provenance } };
    });
    setDirty(true); setSaveStatus(''); scheduleSave();
  }, [scheduleSave]);

  /* ── AI assist actions ─────────────────────────────────────────────────────── */
  const onSuggest = useCallback(async (text) => {
    if (!selectedId) return;
    setAiLoading(true); setAiError('');
    try {
      const res = await extractionApi.aiSuggest(mlpid, selectedId, text);
      setSuggestion(res.suggestion || null);
      setRejectedKeys(new Set());
      refreshOverview();
    } catch (e) {
      setAiError(e.message || 'AI suggestion failed');
    } finally {
      setAiLoading(false);
    }
  }, [mlpid, selectedId, refreshOverview]);

  const acceptSuggestion = useCallback((sg, edited) => {
    setEntries((prev) => ({
      ...prev,
      [keyOf(sg.elementId, sg.armKey)]: {
        value: sg.value,
        provenance: sg.provenance ? { type: sg.provenance.type || 'sentence', excerpt: sg.provenance.excerpt || '' } : {},
        origin: edited ? 'ai_edited' : 'ai_accepted',
        suggestionId: suggestion ? suggestion.id : null,
      },
    }));
    setDirty(true); setSaveStatus(''); scheduleSave();
  }, [suggestion, scheduleSave]);

  const rejectSuggestion = useCallback((sg) => {
    setRejectedKeys((prev) => { const n = new Set(prev); n.add(keyOf(sg.elementId, sg.armKey)); return n; });
  }, []);

  const markReviewed = useCallback(async () => {
    if (!suggestion) return;
    try {
      await extractionApi.reviewSuggestion(mlpid, suggestion.id);
      setSuggestion((s) => (s ? { ...s, status: 'reviewed' } : s));
      refreshOverview();
    } catch (e) { setAiError(e.message || 'Could not mark reviewed'); }
  }, [mlpid, suggestion, refreshOverview]);

  /* ── Tables actions ────────────────────────────────────────────────────────── */
  const onParseTable = useCallback(async (content, name) => {
    if (!selectedId) return;
    setParsing(true); setTablesError('');
    try {
      const fmt = /<table[\s>]/i.test(content) ? 'html' : (content.includes('\t') ? 'tsv' : 'csv');
      await extractionApi.parseTable(mlpid, { content, format: fmt, name, studyId: selectedId });
      await loadTables(selectedId);
    } catch (e) {
      setTablesError(e.message || 'Could not parse the table');
    } finally {
      setParsing(false);
    }
  }, [mlpid, selectedId, loadTables]);

  const onDeleteTable = useCallback(async (tid) => {
    try { await extractionApi.deleteTable(mlpid, tid); await loadTables(selectedId); }
    catch (e) { setTablesError(e.message || 'Delete failed'); }
  }, [mlpid, selectedId, loadTables]);

  /* ── Form template / editor ────────────────────────────────────────────────── */
  const applyTemplate = useCallback(async (templateKey) => {
    setFormSaving(true); setFormProblems(null);
    try {
      await extractionApi.putForm(mlpid, { templateKey });
      await loadBoot();
      setShowForm(false);
    } catch (e) {
      setBootError(e.message || 'Could not apply the template');
    } finally { setFormSaving(false); }
  }, [mlpid, loadBoot]);

  const saveForm = useCallback(async (els) => {
    setFormSaving(true); setFormProblems(null);
    try {
      await extractionApi.putForm(mlpid, { elements: els });
      await loadBoot();
      setShowForm(false);
    } catch (e) {
      if (e.status === 422 && e.payload && Array.isArray(e.payload.problems)) setFormProblems(e.payload.problems);
      else setBootError(e.message || 'Could not save the form');
    } finally { setFormSaving(false); }
  }, [mlpid, loadBoot]);

  /* ── Adjudication ──────────────────────────────────────────────────────────── */
  const openAdjudication = useCallback(async () => {
    if (!selectedId) return;
    setMode('adjudicate'); setCompareState('loading'); setCompareError(''); setSendResult(null);
    try {
      setCompare(await extractionApi.getCompare(mlpid, selectedId));
      setCompareState('ready');
    } catch (e) {
      setCompareError(e.message || 'Could not load the comparison');
      setCompareState('error');
    }
  }, [mlpid, selectedId]);

  const saveResolutions = useCallback(async (resolutions) => {
    setAdjudSaving(true);
    try {
      await extractionApi.adjudicate(mlpid, selectedId, resolutions);
      setCompare(await extractionApi.getCompare(mlpid, selectedId));
      refreshOverview();
    } catch (e) {
      setCompareError(e.message || 'Could not save resolutions');
    } finally { setAdjudSaving(false); }
  }, [mlpid, selectedId, refreshOverview]);

  // Returns { ok, warnings } on success, or { conflict: {current,proposed,warnings} } on 409.
  const sendToMa = useCallback(async ({ esType, overwrite }) => {
    setSendBusy(true);
    try {
      const res = await extractionApi.sendToMa(mlpid, selectedId, { esType, overwrite: !!overwrite });
      setSendResult({ ok: true, warnings: res.warnings });
      refreshOverview();
      return { ok: true, warnings: res.warnings };
    } catch (e) {
      if (e.status === 409 && e.payload && e.payload.code === 'HAS_EFFECT_SIZE') {
        return { conflict: { current: e.payload.current, proposed: e.payload.proposed, warnings: e.payload.warnings } };
      }
      setCompareError(e.message || 'Send to meta-analysis failed');
      return { error: e.message };
    } finally { setSendBusy(false); }
  }, [mlpid, selectedId, refreshOverview]);

  /* ── Render ────────────────────────────────────────────────────────────────── */
  if (bootState === 'loading') {
    return (
      <div style={{ padding: 4 }}>
        <Skeleton w="30%" mb={16} />
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 320px', gap: 14 }}>
          <div>{[0, 1, 2].map((i) => <Skeleton key={i} h={54} mb={8} />)}</div>
          <div>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={64} mb={10} />)}</div>
          <div><Skeleton h={120} /></div>
        </div>
      </div>
    );
  }
  if (bootState === 'error') {
    return <div style={{ padding: 4 }}><ErrorBanner message={bootError} onRetry={loadBoot} /></div>;
  }

  const hasForm = !!(formData && formData.form);
  const templates = formData ? formData.templates || [] : [];
  const selectedRow = overview && overview.studies ? overview.studies.find((s) => s.studyId === selectedId) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.txt }}>Structured extraction</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            Element-based extraction with provenance, dual review, and AI assist. Nothing AI-suggested is saved until you accept it.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {canAdjudicate && (
            <button onClick={() => setShowReport(true)} style={{ ...btnS('ghost'), fontSize: 11.5 }} title="How AI suggestions compare to human consensus">AI accuracy report</button>
          )}
          {hasForm && canEdit && (
            <button onClick={() => { setFormProblems(null); setShowForm(true); }} style={{ ...btnS('ghost'), fontSize: 12 }}>Form</button>
          )}
        </div>
      </div>

      {!hasForm ? (
        <EmptyState
          icon="🧩"
          title="No extraction form yet"
          hint={canEdit
            ? 'Pick a template to seed the data elements, then refine them. Every study is then extracted against this shared form.'
            : 'No extraction form has been set up for this project yet. An editor needs to choose a template or define elements first.'}
          action={canEdit ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {templates.map((t) => (
                <button key={t.key} onClick={() => applyTemplate(t.key)} disabled={formSaving}
                  title={t.description}
                  style={{ ...btnS('ghost'), fontSize: 12, opacity: formSaving ? 0.6 : 1 }}>
                  {t.label} <span style={{ color: C.dim }}>· {t.elementCount}</span>
                </button>
              ))}
              <button onClick={() => { setFormProblems(null); setShowForm(true); }} style={{ ...btnS('primary'), fontSize: 12 }}>Build from scratch</button>
            </div>
          ) : null}
        />
      ) : mode === 'adjudicate' ? (
        <div style={{ minHeight: 560 }}>
          <AdjudicationView
            compare={compare}
            loading={compareState === 'loading'}
            error={compareState === 'error' ? compareError : ''}
            onRetry={openAdjudication}
            onBack={() => { setMode('extract'); }}
            canSend={canAdjudicate}
            onSaveResolutions={saveResolutions}
            saving={adjudSaving}
            onSendToMa={sendToMa}
            sendBusy={sendBusy}
            sendResult={sendResult}
          />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0,1fr) 340px', gap: 14, alignItems: 'start' }} className="extraction-3col">
          {/* LEFT */}
          <div style={{ height: 620 }}>
            <StudyList
              studies={overview ? overview.studies || [] : []}
              selectedId={selectedId}
              onSelect={setSelectedId}
              loading={false}
              requiredCount={overview && overview.form ? 0 : 0}
            />
          </div>

          {/* CENTER */}
          <div style={{ height: 620 }}>
            {!selectedId ? (
              <EmptyState icon="👈" title="Select a study" hint="Choose a study from the list to start extracting." />
            ) : studyState === 'loading' ? (
              <div>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={72} mb={10} />)}</div>
            ) : studyState === 'error' ? (
              <ErrorBanner message={studyError} onRetry={() => loadStudy(selectedId)} />
            ) : studyData && studyData.study ? (
              <FormPanel
                study={studyData.study}
                elements={elements}
                entries={entries}
                arms={DEFAULT_ARMS}
                disabled={!canEdit}
                saveStatus={saveStatus}
                dirty={dirty}
                onFieldChange={onFieldChange}
                onFieldProvenance={onFieldProvenance}
                onSave={doSave}
                onAdjudicate={openAdjudication}
                canAdjudicate={canAdjudicate}
              />
            ) : (
              <EmptyState icon="📄" title="Study not found" hint="This study is no longer in the project." />
            )}
          </div>

          {/* RIGHT */}
          <div style={{ height: 620, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', border: `1px solid ${C.brd}`, borderRadius: 8, overflow: 'hidden', marginBottom: 12, width: 'fit-content' }}>
              {RIGHT_TABS.map(([k, label]) => (
                <button key={k} onClick={() => setRightTab(k)} style={{
                  padding: '6px 13px', border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
                  background: rightTab === k ? C.acc : 'transparent', color: rightTab === k ? C.accText : C.muted,
                }}>{label}</button>
              ))}
            </div>
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, paddingRight: 2 }}>
              {!selectedId ? (
                <div style={{ fontSize: 12, color: C.dim }}>Select a study to use AI assist, tables, and consensus.</div>
              ) : rightTab === 'ai' ? (
                <AiAssistPanel
                  elementsById={elementsById}
                  suggestion={suggestion}
                  llm={formData ? formData.llm : null}
                  aiEnabled={aiSettings.enabled !== false}
                  disabled={!canEdit}
                  loading={aiLoading}
                  error={aiError}
                  rejectedKeys={rejectedKeys}
                  onSuggest={onSuggest}
                  onAccept={(sg) => acceptSuggestion(sg, false)}
                  onEdit={(sg) => acceptSuggestion(sg, true)}
                  onReject={rejectSuggestion}
                  onMarkReviewed={markReviewed}
                />
              ) : rightTab === 'tables' ? (
                <TablesPanel
                  tables={tables}
                  loading={tablesLoading}
                  error={tablesError}
                  parsing={parsing}
                  tableParsingEnabled={aiSettings.tableParsingEnabled !== false}
                  disabled={!canEdit}
                  onParse={onParseTable}
                  onDelete={onDeleteTable}
                />
              ) : (
                <ConsensusPanel consensus={studyData ? studyData.consensus || [] : []} elementsById={elementsById} />
              )}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <ElementsEditor
          initialElements={elements}
          canEdit={canEdit}
          saving={formSaving}
          problems={formProblems}
          onSave={saveForm}
          onClose={() => setShowForm(false)}
        />
      )}
      {showReport && (
        <ValidationReportModal mlpid={mlpid} onClose={() => setShowReport(false)} />
      )}

      {/* Responsive: stack under 1100px. */}
      <style>{`@media (max-width: 1100px){.extraction-3col{grid-template-columns:1fr !important;}.extraction-3col > div{height:auto !important;}}`}</style>
    </div>
  );
}
