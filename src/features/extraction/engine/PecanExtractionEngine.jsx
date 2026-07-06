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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { C } from '../../../frontend/workspace/ui/styles.js';
import { protocolOutcomes } from '../../../research-engine/extraction/protocolOutcomes.js';
import { confirmDraft as confirmDraftPure, parkRecord as parkRecordPure, unparkToDraft as unparkPure } from '../../../research-engine/extraction/records.js';
import { reconcileDrafts, identityOf } from '../../../research-engine/extraction/draftReconcile.js';
import { attachProvenanceMany } from '../../../research-engine/extraction/engine/articleProvenance.js';
import { buildArticleSummary } from '../../../research-engine/extraction/engine/articleList.js';
import ArticleList from './ArticleList.jsx';
import ArticleWorkspace from './ArticleWorkspace.jsx';
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
  const clientArticles = useMemo(() => studies.map((s) => buildArticleSummary(s, {})), [studies]);
  const articles = useMemo(() => {
    if (!serverArticles || !serverArticles.articles) return clientArticles;
    const pdfById = new Map(serverArticles.articles.map((a) => [a.id, a.pdfAvailable]));
    return clientArticles.map((a) => ({ ...a, pdfAvailable: pdfById.get(a.id) || false }));
  }, [clientArticles, serverArticles]);
  const stats = serverArticles ? serverArticles.stats : null;

  /* ── Blob writers (values + provenance + drafts) ── */
  const patchStudy = useCallback((id, patch) => updateProject(activeId, (p) => ({
    ...p, studies: (p.studies || []).map((s) => (s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s)),
  })), [updateProject, activeId]);

  const attachProvenance = useCallback((id, entriesByField) => updateProject(activeId, (p) => ({
    ...p, studies: (p.studies || []).map((s) => (s.id === id ? attachProvenanceMany(s, entriesByField) : s)),
  })), [updateProject, activeId]);

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
  const completeArticle = useCallback(async (id) => {
    setCompleting(true); setBanner('');
    try { await api.completeArticle(activeId, id); setBanner('Article marked complete.'); refreshList(); }
    catch (e) {
      if (e.status === 422 && e.payload && Array.isArray(e.payload.blocking)) {
        setBanner(`Cannot complete yet — ${e.payload.blocking.length} blocking check(s): ${e.payload.blocking.map((b) => b.msg).join(' · ')}`);
      } else setBanner(e.message || 'Could not complete this article.');
    } finally { setCompleting(false); }
  }, [activeId, refreshList]);
  const reopenArticle = useCallback(async (id) => {
    setCompleting(true); setBanner('');
    try { await api.reopenArticle(activeId, id); setBanner('Article reopened for editing.'); refreshList(); }
    catch (e) { setBanner(e.message || 'Could not reopen this article.'); }
    finally { setCompleting(false); }
  }, [activeId, refreshList]);

  // Merge the server article state (completedAt/locked) into the open study for the toolbar.
  const openArticleSummary = useMemo(() => {
    if (!openStudy) return null;
    const fromServer = serverArticles && serverArticles.articles && serverArticles.articles.find((a) => a.id === openStudy.id);
    return fromServer || buildArticleSummary(openStudy, {});
  }, [openStudy, serverArticles]);

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
        <div style={{ flex: 1, minHeight: 0 }}>
          <ArticleWorkspace
            projectId={activeId} study={openStudy} article={openArticleSummary} studies={studies}
            outcomes={outcomes} protocol={protocol} readOnly={readOnly} canEdit={canEdit} saveStatus={saveStatus}
            onBack={() => setOpenId('')} onPrev={goPrev} onNext={goNext} hasPrev={openIdx > 0} hasNext={openIdx >= 0 && openIdx < orderedIds.length - 1}
            onPatchStudy={patchStudy} onAttachProvenance={attachProvenance}
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
        onOpen={(id) => setOpenId(id)} onRefresh={refreshList}
      />
    </div>
  );
}
