/**
 * features/extraction/engine/PecanExtractionEngine.jsx — 76.md orchestrator.
 *
 * The flag-gated Pecan Extraction Engine surface. Two views inside one full-screen
 * workspace: the ARTICLE LIST (§6) and, when an article is open, the ARTICLE WORKSPACE
 * (§7). The open state is reflected in `?article=<id>` (deep-link + refresh safe) and
 * lifted to the Stitch shell via `onWorkspaceChange` so the page goes full-bleed.
 *
 * It owns the blob writes for extraction VALUES + per-value provenance + drafts
 * (reusing the same pure reconcile/confirm helpers as the classic tab, so data written
 * here is identical and interoperable), while article STATE (complete/reopen) round-
 * trips through the engine API. Analysis keeps reading the same studies[] blob.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C } from '../../../frontend/workspace/ui/styles.js';
import { protocolOutcomes } from '../../../research-engine/extraction/protocolOutcomes.js';
import { confirmDraft as confirmDraftPure, parkRecord as parkRecordPure, unparkToDraft as unparkPure } from '../../../research-engine/extraction/records.js';
import { reconcileDrafts, identityOf } from '../../../research-engine/extraction/draftReconcile.js';
import { attachProvenanceMany } from '../../../research-engine/extraction/engine/articleProvenance.js';
import { deriveEffectSizeFromRaw } from '../../../research-engine/extraction/deriveEffectSize.js';
import { buildArticleSummary, articleListStats } from '../../../research-engine/extraction/engine/articleList.js';
import { mkStudy } from '../../../research-engine/project-model/defaults.js';
import { addOutcome, duplicateOutcome, renameOutcome, setOutcomeRole, archiveOutcome, groupForStudy, activeOutcomes } from '../../../research-engine/extraction/outcomeGroups.js';
import {
  isCaseRow, enableCaseSeries, disableCaseSeries, addCase, duplicateCase, removeCase,
  renameCase, propagateArticleFields, normalizeCaseVariables, defaultCaseVariables,
  buildCaseExportRows,
} from '../../../research-engine/extraction/caseSeries.js';
import { downloadBlob } from '../../../frontend/components/exportCore.js';
// 108.md §8 — the project-wide history + the pure extraction inverse appliers.
import { useProjectHistory } from '../../../frontend/history/HistoryContext.jsx';
import {
  applyExtractionWrite, findStudyRow, matchesExpected, isExtractionRowLocked,
  EXTRACTION_HISTORY_KIND, EXTRACTION_LOCKED_REFUSAL,
} from '../../../research-engine/interaction/extractionHistory.js';
import ArticleList from './ArticleList.jsx';
import ArticleWorkspace from './ArticleWorkspace.jsx';
import OutcomeNavigator from './OutcomeNavigator.jsx';
import CaseSeriesBar from './CaseSeriesBar.jsx';
import * as api from './engineApi.js';

/** Read/write the ?article= param without pulling react-router into this leaf. */
function readArticleParam() {
  try { return new URLSearchParams(window.location.search).get('article') || ''; } catch { return ''; }
}
function writeArticleParam(id) {
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('article', id); else url.searchParams.delete('article');
    window.history.replaceState({}, '', url);
  } catch { /* ignore */ }
}

export default function PecanExtractionEngine({ project, updateProject, activeId, setTab, saveStatus = '', onWorkspaceChange, readOnly = false }) {
  const studies = useMemo(() => (Array.isArray(project.studies) ? project.studies : []), [project.studies]);
  const protocol = useMemo(() => protocolOutcomes(project), [project.prospero, project.pico]); // eslint-disable-line react-hooks/exhaustive-deps
  const outcomes = protocol.outcomes;
  const drafts = project.extractionDrafts || [];
  // 106.md — the review's patient-level variable definitions. Declared here (not with
  // the case mutations below) because the article-list summaries need them for a case
  // row's progress denominator.
  const caseVariables = useMemo(
    () => normalizeCaseVariables(project.caseVariables),
    [project.caseVariables],
  );
  const parked = project.extractionParked || [];

  const [openId, setOpenId] = useState(() => readArticleParam());
  const [serverArticles, setServerArticles] = useState(null);   // enriched (PDF availability) list from the API
  const [listErr, setListErr] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [canEdit, setCanEdit] = useState(!readOnly);
  const [completing, setCompleting] = useState(false);
  const [banner, setBanner] = useState('');

  const openStudy = useMemo(() => studies.find((s) => s.id === openId) || null, [studies, openId]);

  // Lift the full-bleed signal whenever an article is open.
  useEffect(() => { onWorkspaceChange && onWorkspaceChange(!!openStudy); return () => { onWorkspaceChange && onWorkspaceChange(false); }; }, [openStudy, onWorkspaceChange]);
  useEffect(() => { writeArticleParam(openStudy ? openId : ''); }, [openId, openStudy]);

  // Fetch the enriched article list (PDF availability + server-computed stats).
  const refreshList = useCallback(() => {
    setLoadingList(true); setListErr('');
    api.listArticles(activeId)
      .then((r) => { setServerArticles(r); setCanEdit(!readOnly && !!r.canEdit); })
      .catch((e) => { setListErr(e.status === 404 ? '' : (e.message || 'Could not load the article list.')); setServerArticles(null); })
      .finally(() => setLoadingList(false));
  }, [activeId, readOnly]);
  useEffect(() => { refreshList(); }, [refreshList]);

  // Client-side summaries always available (instant, from the live blob); the server
  // list only adds PDF-availability + authoritative stats. Merge PDF flags in when present.
  const clientArticles = useMemo(
    () => studies.map((s) => buildArticleSummary(s, {}, caseVariables)),
    [studies, caseVariables],
  );
  const articles = useMemo(() => {
    if (!serverArticles || !serverArticles.articles) return clientArticles;
    const pdfById = new Map(serverArticles.articles.map((a) => [a.id, a.pdfAvailable]));
    return clientArticles.map((a) => ({ ...a, pdfAvailable: pdfById.get(a.id) || false }));
  }, [clientArticles, serverArticles]);
  // 106.md — the header stats are derived from the LIVE blob, not from the server list.
  // `refreshList` only runs on mount and after complete/reopen, so server stats would
  // still say "1 article" after the reviewer added six cases, and the publication/case
  // header and the Export-cases button (both gated on `hasCaseSeries`) would not appear
  // until a reload. The server contributes nothing to these counts anyway.
  const stats = useMemo(() => articleListStats(articles), [articles]);

  /* ── Blob writers (values + provenance + drafts) ── */
  // 106.md §Shared article-level information — every study write goes through
  // propagateArticleFields: for an ordinary study it is a plain single-row patch
  // (identical to the old behaviour), and for a CASE it additionally mirrors the
  // article-level keys (authors, year, journal, DOI, design, country, the PDF link)
  // onto every sibling case, so shared metadata is entered once and can never drift
  // between the patients of one publication.
  const patchStudy = useCallback((id, patch) => updateProject(activeId, (p) => ({
    ...p,
    studies: propagateArticleFields(p.studies || [], id, patch, { at: new Date().toISOString() }).studies,
  })), [updateProject, activeId]);

  const attachProvenance = useCallback((id, entriesByField) => updateProject(activeId, (p) => ({
    ...p, studies: (p.studies || []).map((s) => (s.id === id ? attachProvenanceMany(s, entriesByField) : s)),
  })), [updateProject, activeId]);

  // 83.md §5 — value fields + their provenance land in ONE functional update, so an
  // autosave flush can never persist a captured value without its provenance/history.
  // 106.md — article-level keys fan out to sibling cases FIRST (still one functional
  // update), then this row's provenance is attached. Provenance stays strictly per-row:
  // a source link belongs to the case whose value it justifies, never to its siblings,
  // even when the underlying field was propagated.
  // 108.md §8 — the body moved into the pure applyExtractionWrite so the undo executor
  // below and the forward write are provably ONE path, and so the inverse can carry
  // `null` for a field whose provenance must be REMOVED (see extractionHistory.js).
  const writeStudy = useCallback((id, patch, entriesByField) => {
    // Purity rule: the timestamp is seeded OUTSIDE the updater (StrictMode invokes
    // updaters twice, and a CAS retry re-runs them).
    const at = new Date().toISOString();
    return updateProject(activeId, (p) => ({
      ...p, studies: applyExtractionWrite(p.studies || [], id, patch, entriesByField, { at }),
    }));
  }, [updateProject, activeId]);

  /* ── 108.md §8 — the extraction undo/redo executor ──────────────────────────────
     Undo is a REAL mutation through the same write path as the forward action, never
     a local rollback: it restores the value(s), the FULL prior provenance entry and
     `needsReview` in one blob update, and the ordinary autosave persists it.
     Precondition (§14/§15): the row is re-read from the FRESHEST render, never from
     the closure the entry was recorded in, and the write is refused when the field no
     longer holds what this entry produced — a collaborator (or the AI extractor) got
     there first. An outstanding autosave 409 is reported as a persistence failure so
     the entry is restored to its stack instead of being silently popped.
     Pending saves need no special handling: both blob stacks are replace-not-queue and
     serialize their sends, so this updateProject supersedes the pending post-change
     blob and an older in-flight PUT cannot resurrect the undone value (inv108 §3).
     Note it calls writeStudy, NOT ArticleWorkspace's setFields/writeValues: those are
     the RECORDING call sites, and replaying an inverse through them would both destroy
     the provenance and log the undo as a fresh action (clearing the redo branch).
     108 review, [major] — the gate is PER ROW, not per open article. `canEdit` is a
     project-level permission from the server article list, and the entry may name a
     study the user has since navigated away from, so the completed/locked state is
     re-derived from the target row itself (the same `extractionMeta` flags
     ArticleWorkspace's `editable = !readOnly && !completed` is computed from). Without
     it an undo rewrites values, provenance and needsReview on an article the UI has
     closed for editing — and fans article-level keys out to its locked siblings. */
  const live = useRef({});
  live.current = { studies, saveStatus, canEdit, readOnly };
  const { registerExecutor } = useProjectHistory();
  useEffect(() => registerExecutor(EXTRACTION_HISTORY_KIND, async (op) => {
    const now = live.current;
    if (now.readOnly || !now.canEdit) return { ok: false, reason: 'refused' };
    if (now.saveStatus === 'conflict') return { ok: false, reason: 'failed' };
    const row = findStudyRow(now.studies, op && op.studyId);
    if (!row) return { ok: false, reason: 'refused' };
    if (isExtractionRowLocked(row)) {
      // The generic §17 note says "changed by a collaborator", which is not what
      // happened; the banner names the actual remedy (Reopen from the toolbar).
      setBanner(EXTRACTION_LOCKED_REFUSAL);
      return { ok: false, reason: 'refused', detail: EXTRACTION_LOCKED_REFUSAL };
    }
    if (!matchesExpected(row, op.expect)) return { ok: false, reason: 'refused' };
    writeStudy(op.studyId, op.fields, op.provenance);
    return true;
  }), [registerExecutor, writeStudy]);

  const addDrafts = useCallback((recs) => { if (!recs || !recs.length) return; updateProject(activeId, (p) => ({ ...p, extractionDrafts: reconcileDrafts(p.extractionDrafts || [], recs, { dismissedIdentities: p.extractionDismissed || [] }).drafts })); }, [updateProject, activeId]);
  const addParked = useCallback((recs) => { if (!recs || !recs.length) return; updateProject(activeId, (p) => ({ ...p, extractionParked: reconcileDrafts(p.extractionParked || [], recs, { dismissedIdentities: p.extractionDismissed || [] }).drafts })); }, [updateProject, activeId]);
  const dismissDraft = useCallback((id) => updateProject(activeId, (p) => {
    const rec = (p.extractionDrafts || []).find((d) => d.id === id) || (p.extractionParked || []).find((d) => d.id === id) || null;
    const sid = rec ? identityOf(rec) : '';
    const dismissed = p.extractionDismissed || [];
    return { ...p, extractionDrafts: (p.extractionDrafts || []).filter((d) => d.id !== id), extractionParked: (p.extractionParked || []).filter((d) => d.id !== id), extractionDismissed: (sid && !dismissed.includes(sid)) ? [...dismissed, sid] : dismissed };
  }), [updateProject, activeId]);
  const editDraftField = useCallback((id, key, value) => updateProject(activeId, (p) => ({ ...p, extractionDrafts: (p.extractionDrafts || []).map((d) => (d.id === id ? { ...d, [key]: value } : d)) })), [updateProject, activeId]);
  const withResolved = (p, rec) => { const sid = rec ? identityOf(rec) : ''; const dismissed = p.extractionDismissed || []; return (sid && !dismissed.includes(sid)) ? [...dismissed, sid] : dismissed; };
  const confirmDraft = useCallback((id) => updateProject(activeId, (p) => {
    const at = new Date().toISOString();
    const d = (p.extractionDrafts || []).find((x) => x.id === id);
    const citationBaseId = (d && d.sourceStudyId) || openId || null;
    const res = confirmDraftPure({ studies: p.studies || [], drafts: p.extractionDrafts || [] }, id, { at, citationBaseId });
    if (!res.ok) return p;
    return { ...p, studies: res.studies, extractionDrafts: res.drafts, extractionDismissed: withResolved(p, d) };
  }), [updateProject, activeId, openId]);
  const parkDraft = useCallback((id) => updateProject(activeId, (p) => {
    const d = (p.extractionDrafts || []).find((x) => x.id === id);
    const res = parkRecordPure({ drafts: p.extractionDrafts || [], parked: p.extractionParked || [] }, id, { at: new Date().toISOString() });
    if (!res.ok) return p;
    return { ...p, extractionDrafts: res.drafts, extractionParked: res.parked, extractionDismissed: withResolved(p, d) };
  }), [updateProject, activeId]);
  const unparkRecord = useCallback((id, scope) => updateProject(activeId, (p) => {
    const res = unparkPure({ parked: p.extractionParked || [], drafts: p.extractionDrafts || [] }, id, { scope });
    if (!res.ok) return p;
    return { ...p, extractionParked: res.parked, extractionDrafts: res.drafts };
  }), [updateProject, activeId]);

  /* ── Article state (round-trips through the engine API) ── */
  // The engine writes article STATE (completion/lock/sync/inclusion) server-side into
  // the SAME Project.data blob the client autosaves. To stop the next whole-blob autosave
  // from reverting it (76.md review, high finding), merge the server's authoritative
  // completion fields back into project.studies here — preserving the client's own
  // provenance/value edits (we copy only the completion keys, not the whole meta).
  const COMPLETION_META_KEYS = ['completedAt', 'completedBy', 'completedByName', 'locked', 'reopenedAt', 'reopenedBy', 'syncHash', 'syncedAt', 'syncedBy', 'includedInAnalysis'];
  const mergeServerMeta = useCallback((id, serverMeta) => {
    if (!serverMeta) return;
    updateProject(activeId, (p) => ({
      ...p,
      studies: (p.studies || []).map((s) => {
        if (s.id !== id) return s;
        const meta = { ...(s.extractionMeta || {}) };
        for (const k of COMPLETION_META_KEYS) meta[k] = serverMeta[k];
        return { ...s, extractionMeta: meta };
      }),
    }));
  }, [updateProject, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const completeArticle = useCallback(async (id) => {
    setCompleting(true); setBanner('');
    // 86.md P0.3 — before completing, backfill a poolable effect size from RAW cells
    // when the reviewer captured 2×2 / continuous / etc. data for a raw-derivable
    // measure but never entered es/lo/hi (the engine dropped the classic tab's inline
    // calculator, so such studies silently never pooled). Never overwrites a
    // reviewer-entered effect size; records a conversions[] audit + provenance.
    let derivedMsg = '';
    updateProject(activeId, (p) => {
      const studies = Array.isArray(p.studies) ? p.studies : [];
      const s = studies.find((x) => x.id === id);
      if (!s) return p;
      const d = deriveEffectSizeFromRaw(s, { at: new Date().toISOString() });
      if (!d) return p;
      derivedMsg = ` Effect size auto-derived from raw ${d.esType} data.`;
      const now = new Date().toISOString();
      const provFields = {};
      for (const f of ['es', 'lo', 'hi']) provFields[f] = { method: 'calculated', at: now, excerpt: d.conversion.method };
      return {
        ...p,
        studies: studies.map((x) => {
          if (x.id !== id) return x;
          const next = {
            ...x, es: d.es, lo: d.lo, hi: d.hi, esType: d.esType,
            source: x.source || 'calculated',
            conversions: [...(Array.isArray(x.conversions) ? x.conversions : []), d.conversion],
            updatedAt: now,
          };
          return attachProvenanceMany(next, provFields);
        }),
      };
    });
    try {
      const r = await api.completeArticle(activeId, id);
      mergeServerMeta(id, r && r.extractionMeta);
      setBanner(`Article marked complete.${derivedMsg}`); refreshList();
    } catch (e) {
      if (e.status === 422 && e.payload && Array.isArray(e.payload.blocking)) {
        setBanner(`Cannot complete yet — ${e.payload.blocking.length} blocking check(s): ${e.payload.blocking.map((b) => b.msg).join(' · ')}`);
      } else setBanner(e.message || 'Could not complete this article.');
    } finally { setCompleting(false); }
  }, [activeId, refreshList, mergeServerMeta]);
  const reopenArticle = useCallback(async (id) => {
    setCompleting(true); setBanner('');
    try {
      const r = await api.reopenArticle(activeId, id);
      mergeServerMeta(id, r && r.extractionMeta);
      setBanner('Article reopened for editing.'); refreshList();
    } catch (e) { setBanner(e.message || 'Could not reopen this article.'); }
    finally { setCompleting(false); }
  }, [activeId, refreshList, mergeServerMeta]);

  // Toolbar summary: compute from the (merge-fresh) blob study so completion state flips
  // instantly after a complete/reopen, enriched with server-only pdfAvailable.
  const openArticleSummary = useMemo(() => {
    if (!openStudy) return null;
    const fromServer = serverArticles && serverArticles.articles && serverArticles.articles.find((a) => a.id === openStudy.id);
    return { ...buildArticleSummary(openStudy, {}), pdfAvailable: fromServer ? fromServer.pdfAvailable : false };
  }, [openStudy, serverArticles]);

  /* ── 82.md — multi-outcome (pure outcomeGroups over studies[]) ──
     83.md §5 — every mutation RECOMPUTES inside the functional updater (from
     p.studies, the freshest state) instead of precomputing from the render-time
     array and replacing studies[] wholesale, which could clobber a write that
     landed between render and click. New ids are pre-generated so navigation
     never depends on reading a side effect out of the updater (StrictMode-safe). */
  const applyPure = useCallback((mutate) => updateProject(activeId, (p) => {
    const r = mutate(Array.isArray(p.studies) ? p.studies : []);
    if (!r || r.error || !r.studies) return p;
    return { ...p, studies: r.studies };
  }), [updateProject, activeId]);
  const newRowId = () => Math.random().toString(36).slice(2, 10);
  const onAddOutcome = useCallback((srcId) => {
    if (!studies.some((s) => s && s.id === srcId)) return;
    const id = newRowId();
    applyPure((rows) => addOutcome(rows, srcId, { mkStudy, idFn: () => id }));
    setOpenId(id);
  }, [applyPure, studies]);
  const onDuplicateOutcome = useCallback((srcId) => {
    if (!studies.some((s) => s && s.id === srcId)) return;
    const id = newRowId();
    applyPure((rows) => duplicateOutcome(rows, srcId, { idFn: () => id }));
    setOpenId(id);
  }, [applyPure, studies]);
  const onRenameOutcome = useCallback((id, name) => applyPure((rows) => renameOutcome(rows, id, name)), [applyPure]);
  const onSetOutcomeRole = useCallback((id, role) => applyPure((rows) => setOutcomeRole(rows, id, role)), [applyPure]);
  const onArchiveOutcome = useCallback((id) => {
    applyPure((rows) => archiveOutcome(rows, id));
    // Jump to the nearest remaining outcome OF THE SAME PAPER (never an unrelated
    // study). Compute against the post-archive rows so the archived one is excluded.
    const r = archiveOutcome(studies, id);
    if (r.error || !r.studies) return;
    const group = groupForStudy(r.studies, id);
    const sibling = group ? activeOutcomes(group).find((o) => o.id !== id) : null;
    if (sibling) setOpenId(sibling.id);
    else setOpenId(''); // no active sibling → back to the article list
  }, [applyPure, studies]);

  /* ── 106.md — Case Series Mode (pure caseSeries engine over studies[]) ──
     Mirrors the 82.md outcome mutations exactly: new ids are pre-generated so
     navigation never reads a side effect out of the updater (StrictMode-safe), and
     every mutation RECOMPUTES from `p.studies` inside the functional update so a
     write that landed between render and click is never clobbered. */
  const setCaseVariables = useCallback((next) => updateProject(activeId, (p) => ({
    ...p, caseVariables: normalizeCaseVariables(next),
  })), [updateProject, activeId]);

  const onEnableCaseSeries = useCallback((studyId) => {
    // The updater is a React setState function: StrictMode invokes it TWICE in dev and
    // only the last result is kept. Calling Math.random() inside it would therefore mint
    // a different publicationId per invocation. Seed OUTSIDE and count INSIDE, so every
    // invocation produces byte-identical ids (the 82.md pre-generated-id contract, which
    // enableCaseSeries supports by taking an injectable idFn).
    const seed = newRowId();
    // The banner must state what actually happened, so compute the conversion from the
    // rows this render sees (the updater recomputes it independently and authoritatively).
    const preview = enableCaseSeries(studies, studyId, { idFn: () => seed });
    updateProject(activeId, (p) => {
      let n = 0;
      const r = enableCaseSeries(p.studies || [], studyId, { idFn: () => `${seed}${n++}`, at: new Date().toISOString() });
      if (r.error || !r.studies) return p;
      // Seed the review's patient-level fields the first time anyone turns the mode on,
      // so the case form is immediately usable instead of empty. Never overwrites a
      // review that already defined its own variables.
      const vars = normalizeCaseVariables(p.caseVariables);
      return { ...p, studies: r.studies, caseVariables: vars.length ? vars : defaultCaseVariables() };
    });
    const converted = (preview && preview.converted) || 1;
    setBanner(converted > 1
      // Existing rows of this paper (e.g. separate outcome rows) had to join the same
      // publication — say so rather than letting the reviewer discover N unexpected cases.
      ? `Case Series Mode is on. This article already had ${converted} extraction rows, so they became Case 1–${converted} — rename or delete any that are not separate patients, then use “+ Add case”.`
      : 'Case Series Mode is on. This article is now Case 1 — use “+ Add case” for each further patient.');
  }, [updateProject, activeId, studies]);

  const onDisableCaseSeries = useCallback((publicationId) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Turn Case Series Mode off for this article? The cases become ordinary study rows — no case and no extracted value is deleted.')) return;
    updateProject(activeId, (p) => {
      const r = disableCaseSeries(p.studies || [], publicationId, { at: new Date().toISOString() });
      return (r.error || !r.studies) ? p : { ...p, studies: r.studies };
    });
    setBanner('Case Series Mode is off. Every case was kept as a study row.');
  }, [updateProject, activeId]);

  const onAddCase = useCallback((publicationId) => {
    const id = newRowId();
    updateProject(activeId, (p) => {
      const r = addCase(p.studies || [], publicationId, { mkStudy, idFn: () => id, at: new Date().toISOString() });
      return (r.error || !r.studies) ? p : { ...p, studies: r.studies };
    });
    setOpenId(id);
  }, [updateProject, activeId]);

  const onDuplicateCase = useCallback((studyId) => {
    const id = newRowId();
    updateProject(activeId, (p) => {
      const r = duplicateCase(p.studies || [], studyId, { idFn: () => id, at: new Date().toISOString() });
      return (r.error || !r.studies) ? p : { ...p, studies: r.studies };
    });
    setOpenId(id);
  }, [updateProject, activeId]);

  const onRemoveCase = useCallback((studyId) => {
    // The id to open next is computed from the CURRENT render's rows; the updater
    // recomputes the deletion itself, so a concurrent write cannot desync the two.
    const preview = removeCase(studies, studyId, {});
    updateProject(activeId, (p) => {
      const r = removeCase(p.studies || [], studyId, { at: new Date().toISOString() });
      return (r.error || !r.studies) ? p : { ...p, studies: r.studies };
    });
    if (!preview.error && preview.nextOpenId) setOpenId(preview.nextOpenId);
  }, [updateProject, activeId, studies]);

  const onRenameCase = useCallback((studyId, label) => updateProject(activeId, (p) => {
    const r = renameCase(p.studies || [], studyId, label);
    return (r.error || !r.studies) ? p : { ...p, studies: r.studies };
  }), [updateProject, activeId]);

  // 106.md §Export — ONE row per individual patient, every row still carrying its
  // article identifiers (publication, DOI, PubMed ID, study row id) so a case-level
  // file can always be traced back to its parent publication.
  const exportCases = useCallback(() => {
    const { columns, rows } = buildCaseExportRows(studies, caseVariables);
    if (!rows.length) { setBanner('No individual cases to export yet — turn on Case Series Mode for an article first.'); return; }
    const esc = (v) => {
      const t = String(v == null ? '' : v).replace(/"/g, '""');
      return /[",\n]/.test(t) ? `"${t}"` : t;
    };
    const csv = [
      columns.map((c) => esc(c.label)).join(','),
      ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')),
    ].join('\n');
    const name = `${(project.name || 'extraction').replace(/[^a-z0-9]/gi, '_')}_cases.csv`;
    // UTF-8 BOM so Excel opens it in the right encoding (same contract as the classic tab).
    downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), name);
    setBanner(`Exported ${rows.length} case${rows.length === 1 ? '' : 's'} to ${name}.`);
  }, [studies, caseVariables, project.name]);

  const orderedIds = useMemo(() => articles.map((a) => a.id), [articles]);
  const openIdx = orderedIds.indexOf(openId);
  const goPrev = () => { if (openIdx > 0) setOpenId(orderedIds[openIdx - 1]); };
  const goNext = () => { if (openIdx >= 0 && openIdx < orderedIds.length - 1) setOpenId(orderedIds[openIdx + 1]); };

  // Esc closes the workspace back to the list.
  useEffect(() => {
    if (!openStudy) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) setOpenId(''); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openStudy]);

  if (openStudy) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {banner && <div style={{ padding: '6px 12px', fontSize: 12, color: C.txt, background: C.card, borderBottom: `1px solid ${C.brd}` }}>{banner}</div>}
        {/* 106.md — exactly ONE navigator renders. A case series navigates by PATIENT,
            an ordinary article by OUTCOME; showing both bars at once was the confusing
            part, and the outcome bar would otherwise list all eight cases as unnamed
            outcomes (they share the paper's citation identity by design). */}
        {isCaseRow(openStudy) ? (
          <CaseSeriesBar
            studies={studies} openId={openId} caseVariables={caseVariables} canEdit={canEdit && !readOnly}
            onOpen={(id) => setOpenId(id)} onEnable={onEnableCaseSeries} onDisable={onDisableCaseSeries}
            onAdd={onAddCase} onDuplicate={onDuplicateCase} onRemove={onRemoveCase} onRename={onRenameCase}
          />
        ) : (
          <>
            <OutcomeNavigator
              studies={studies} openId={openId} canEdit={canEdit && !readOnly}
              onOpen={(id) => setOpenId(id)} onAdd={onAddOutcome} onRename={onRenameOutcome}
              onSetRole={onSetOutcomeRole} onDuplicate={onDuplicateOutcome} onArchive={onArchiveOutcome}
            />
            <CaseSeriesBar
              studies={studies} openId={openId} caseVariables={caseVariables} canEdit={canEdit && !readOnly}
              onEnable={onEnableCaseSeries}
            />
          </>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>
          <ArticleWorkspace
            projectId={activeId} study={openStudy} article={openArticleSummary} studies={studies}
            outcomes={outcomes} protocol={protocol} readOnly={readOnly} canEdit={canEdit} saveStatus={saveStatus}
            caseVariables={caseVariables} onSetCaseVariables={setCaseVariables}
            onBack={() => setOpenId('')} onPrev={goPrev} onNext={goNext} hasPrev={openIdx > 0} hasNext={openIdx >= 0 && openIdx < orderedIds.length - 1}
            onPatchStudy={patchStudy} onAttachProvenance={attachProvenance} onWriteStudy={writeStudy}
            onAddDrafts={addDrafts} onAddParked={addParked} drafts={drafts} parked={parked}
            onConfirmDraft={confirmDraft} onDismissDraft={dismissDraft} onParkDraft={parkDraft} onUnparkRecord={unparkRecord} onEditDraftField={editDraftField}
            onComplete={completeArticle} onReopen={reopenArticle} completing={completing}
          />
        </div>
      </div>
    );
  }

  return (
    // minHeight fallback so the list is usable even before an article opens (the stage
    // is only full-bleed once ArticleWorkspace lifts onWorkspaceChange).
    <div style={{ height: '100%', minHeight: 'calc(100vh - 230px)', display: 'flex', flexDirection: 'column', padding: '10px 4px 4px' }}>
      {banner && <div style={{ padding: '8px 12px', fontSize: 12, color: C.txt, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, marginBottom: 8 }}>{banner}</div>}
      <ArticleList
        articles={articles} stats={stats} loading={loadingList && !serverArticles && !clientArticles.length}
        error={listErr} canEdit={canEdit} lastArticleId={(project.extractionEngine && project.extractionEngine.lastArticleId) || ''}
        onOpen={(id) => setOpenId(id)} onRefresh={refreshList} onExportCases={exportCases}
      />
    </div>
  );
}
