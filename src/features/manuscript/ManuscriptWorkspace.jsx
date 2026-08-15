/**
 * features/manuscript/ManuscriptWorkspace.jsx — 64.md (P3), restructured by 118.md
 * §1-§9. The Manuscript Editor's workspace SHELL. PRESENTATIONAL only: it wires the
 * already-tested `useManuscript` hook to the panels and lazy-loads the heavy
 * .docx/.zip exporters inside click handlers so they never enter the main bundle.
 *
 * 118.md §1/§3/§9 — the old layout (a section header, a loose control row, a yellow
 * banner and eight CTA-styled buttons) is gone. Those controls now belong to ONE
 * dedicated engine header (ManuscriptToolbar), sticky above the document, and this
 * file is what is left: state, routing and the panel host.
 *
 * Renders in BOTH the legacy and the Stitch shell — styled exclusively with the
 * legacy token system (Stitch auto-remaps --t-*).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { C } from '../../frontend/workspace/ui/styles.js';
import { InfoBox } from '../../frontend/workspace/ui/primitives.jsx';
import { SECTION_IDS } from '../../research-engine/manuscript/index.js';
import { useManuscript } from './useManuscript.js';
import {
  OverviewPanel, EditorPanel, TablesPanel, FiguresPanel, ReferencesPanel, PrismaPanel, ExportPanel,
  UpdatesPanel, ExportValidationDialog,
} from './manuscriptPanels.jsx';
import {
  ManuscriptToolbar, ManuscriptToolbarSkeleton, MANUSCRIPT_TAB_IDS, MS_PANEL_ID, msTabDomId,
} from './ManuscriptToolbar.jsx';

const safeName = (s) => String(s || 'manuscript').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'manuscript';

const normalizeSubtab = (id) => (MANUSCRIPT_TAB_IDS.includes(id) ? id : 'overview');

/* 118.md §49 — one constant engine column. The toolbar spans it; only the document
   column inside changes width per destination, so the chrome never resizes. */
const SHELL_STYLE = { maxWidth: 1440, margin: '0 auto', padding: '4px 2px' };

/**
 * @param {string}   initialSubtab   118.md §47 — the host's URL sub-param (`?ms=`).
 *                   Stitch passes it; the LEGACY shell passes nothing, so the default
 *                   keeps that shell on pure component state (it has no such route).
 * @param {function} onSubtabChange  (id) => void — the router-aware host pushes the
 *                   sub-param. Absent → local state only, exactly as before.
 */
export function ManuscriptWorkspace({ project, upd, initialSubtab, onSubtabChange }) {
  const m = useManuscript(project, upd);
  const [tab, setTabState] = useState(() => normalizeSubtab(initialSubtab));

  /* ── 118.md §46-§48 — ONE navigation seam ────────────────────────────────────
     Every destination change in this workspace goes through `setTab`, so there is
     exactly one place that (a) keeps the Updates panel's lazy heavy sync plan
     refreshed on entry and (b) reports the change to the router-aware host. The
     panels are siblings of `useManuscript`, which stays mounted ABOVE all of them:
     switching destinations therefore never unmounts the hook, and a debounced edit
     in flight survives the switch untouched (§46). */
  /* Live handles, so `setTab` can be referentially STABLE for the whole mount: it is
     handed to the toolbar and to every panel, and a fresh identity on each render
     would churn their memo/effect dependency lists for no behavioural gain. */
  const hostNavRef = useRef(onSubtabChange);
  hostNavRef.current = onSubtabChange;
  const refreshPlanRef = useRef(m.refreshSyncPlan);
  refreshPlanRef.current = m.refreshSyncPlan;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const setTab = useCallback((next) => {
    const id = normalizeSubtab(next);
    setTabState(id);
    // 84.md — the Updates destination owns a heavy plan that is computed on entry only.
    if (id === 'updates' && refreshPlanRef.current) refreshPlanRef.current();
    if (typeof hostNavRef.current === 'function') hostNavRef.current(id);
  }, []);

  /* 118.md §47/§48 — the URL is authoritative wherever the host supplies it. The
     host re-renders on every location change (deep link, white side-menu, browser
     Back/Forward), so reconciling the incoming prop in an effect catches all three
     with one mechanism — the SearchWorkspace `initialStage` precedent. Reporting
     back out of here would loop, so the reconcile writes LOCAL state only. */
  useEffect(() => {
    if (typeof hostNavRef.current !== 'function' || initialSubtab == null) return;
    const id = normalizeSubtab(initialSubtab);
    if (id === tabRef.current) return;
    setTabState(id);
    if (id === 'updates' && refreshPlanRef.current) refreshPlanRef.current();
  }, [initialSubtab]);

  const [exporting, setExporting] = useState(null); // null | 'word' | 'repro' | 'prisma' | 'prismaS'
  const [exportError, setExportError] = useState('');
  // 85.md B2 — pre-export validation review ({ model, validation, fetchedAt })
  // + figure-rasterization progress label for the Word button.
  const [exportReview, setExportReview] = useState(null);
  const [exportProgress, setExportProgress] = useState('');
  // 73.md Part 9 — Overview/Consistency "Open" actions jump into the Editor at a
  // specific section (or straight to the References tab for reference findings).
  const [sectionRequest, setSectionRequest] = useState(null);
  const openSection = useCallback((id) => {
    if (id === 'references') { setTab('references'); return; }
    if (!SECTION_IDS.includes(id)) { setTab('editor'); return; }
    setSectionRequest({ id, at: Date.now() });
    setTab('editor');
  }, [setTab]);

  /* 117.md §38 — the citation chip's menu actions. "View reference" / "Edit
     reference" / "Open PDF" all live in the References tab (which owns the library),
     so the chip's job is to say WHICH reference and WHAT to do with it; the panel
     opens on that reference. `focusReference` changes on every request so repeating
     the same action re-triggers it. */
  const [focusReference, setFocusReference] = useState(null);
  const openReference = useCallback((refId, action) => {
    setFocusReference(refId ? { id: refId, action: action || 'view', at: Date.now() } : null);
    setTab('references');
  }, [setTab]);

  const runExport = useCallback(async (key, fn) => {
    setExporting(key);
    setExportError('');
    try {
      await fn();
    } catch (e) {
      setExportError((e && e.message) ? e.message : 'Export failed. Please try again.');
    } finally {
      setExporting(null);
    }
  }, []);

  // recs round — flush any in-flight (≤600ms debounced) edit and export the FLUSHED
  // draft, so a .docx/zip never misses the researcher's last-typed text.
  const freshDraft = useCallback(() => {
    const flushed = typeof m.flush === 'function' ? m.flush() : null;
    if (flushed && m.activeDraft) {
      const d = flushed.find((x) => x && x.id === m.activeDraft.id);
      if (d) return d;
    }
    return m.activeDraft;
  }, [m]);

  // 85.md B2 — Word export builds from a FRESH export model (flush pending edits,
  // re-fetch live sources, recompute tables/assets/numbering/placements) so the
  // .docx can never embed sources from project-open time.
  const doWordExport = useCallback(async (model) => {
    const { buildManuscriptDocx } = await import('./export/manuscriptDocx.js');
    const { downloadBlob } = await import('../../frontend/components/exportCore.js');
    setExportProgress('');
    try {
      const blob = await buildManuscriptDocx(project, model.draft, {
        runMeta: m.runMeta, gradeByOutcome: m.gradeByOutcome,
        prec: project && project.analysisPrecision,
        prismaResult: model.prismaCounts, primary: model.primary, tables: model.tables,
        analyses: model.analyses, assets: model.assets,
        numbering: model.numbering, placements: model.placements,
        // 117.md §41 — the resolved, validated bibliography + its alias map, so the
        // .docx cites exactly what the export dialog just checked.
        references: model.references, referenceAliases: model.referenceAliases,
        robAssessments: model.robAssessments, robByStudyId: model.robByStudyId,
        screening: model.screening, validation: model.validation,
        onProgress: (step, total, label) => setExportProgress(`Rendering figure ${step}/${total}…`),
      });
      downloadBlob(blob, `${safeName(project.name)}.docx`);
    } finally {
      setExportProgress('');
    }
  }, [project, m.runMeta, m.gradeByOutcome]);

  // Pre-export flow: CLEAN (no errors AND no warnings) → export immediately, no
  // dialog. Errors → blocked review. Warnings only → review with "Export anyway".
  const onExportWord = useCallback(() => runExport('word', async () => {
    setExportReview(null);
    const model = await m.prepareExport();
    if (!model) return;
    const v = model.validation || { errors: [], warnings: [] };
    if ((v.errors || []).length || (v.warnings || []).length) {
      setExportReview({ model, validation: v, fetchedAt: model.fetchedAt });
      return;
    }
    await doWordExport(model);
  }), [runExport, m, doWordExport]);

  // "Export anyway" must never ship the model frozen when the dialog opened: the
  // dialog's own action hints send the user off to edit the draft, so we re-run
  // prepareExport and export the FRESH model. If the re-check now finds ERRORS,
  // the dialog re-opens (with a notice) instead of exporting; warnings alone
  // don't re-prompt — the user already chose to export despite warnings.
  const onExportAnyway = useCallback(() => {
    if (!exportReview) return;
    setExportReview(null);
    runExport('word', async () => {
      const model = await m.prepareExport();
      if (!model) return;
      const v = model.validation || { errors: [], warnings: [] };
      if ((v.errors || []).length) {
        setExportReview({ model, validation: v, fetchedAt: model.fetchedAt, recheck: true });
        return;
      }
      await doWordExport(model);
    });
  }, [exportReview, runExport, m, doWordExport]);

  const onExportRepro = useCallback(() => runExport('repro', async () => {
    const { buildReproPackage } = await import('./export/manuscriptRepro.js');
    const { downloadBlob } = await import('../../frontend/components/exportCore.js');
    const blob = await buildReproPackage(project, freshDraft(), {
      runMeta: m.runMeta, appVersion: window.__APP_VERSION__, gradeByOutcome: m.gradeByOutcome,
      screening: m.screening, screeningWorkflow: m.screeningWorkflow,
      searchMethodsText: m.searchMethodsText,
      robAssessments: m.robAssessments, robByStudyId: m.robByStudyId,
      perSource: m.perSource, analysis: m.genOpts && m.genOpts.analysis,
      prec: project && project.analysisPrecision,
      // 117.md §12/§57 — the canonical record-derived flow, so the bundle's PRISMA
      // counts, prisma_2020.svg/png and bundled .docx are the SAME PRISMA the editor
      // displayed. Absent (unlinked / record-less project) → legacy counter chain.
      prismaFlow: m.prismaFlow,
    });
    downloadBlob(blob, `${safeName(project.name)}-reproducibility.zip`);
  }), [runExport, project, freshDraft, m.runMeta, m.gradeByOutcome, m.screening, m.screeningWorkflow, m.searchMethodsText, m.robAssessments, m.robByStudyId, m.perSource, m.genOpts, m.prismaFlow]);

  const onPrismaChecklist = useCallback(() => runExport('prisma', async () => {
    const cx = await import('./export/checklistExport.js');
    cx.downloadPrismaChecklist(project, freshDraft());
  }), [runExport, project, freshDraft]);

  const onPrismaSChecklist = useCallback(() => runExport('prismaS', async () => {
    const cx = await import('./export/checklistExport.js');
    cx.downloadPrismaSChecklist(project);
  }), [runExport, project]);

  const exporters = { onExportWord, onExportRepro, onPrismaChecklist, onPrismaSChecklist, exporting, exportError, exportProgress };

  if (!m.activeDraft) {
    // 118.md §49 — reserve the toolbar's dimensions while the manuscript resolves,
    // so the workspace does not jump when the real bar arrives.
    return (
      <div data-testid="stitch-manuscript-workspace" style={SHELL_STYLE}>
        <ManuscriptToolbarSkeleton />
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <InfoBox color={C.muted}>Preparing manuscript…</InfoBox>
        </div>
      </div>
    );
  }

  return (
    /* 118.md §49/§57 — the engine column is now a CONSTANT width: the toolbar is
       chrome and must not resize when the destination changes. Only the document
       column below it narrows (the Editor's outline · page · tools layout, 65.md
       MS-3, needs the full width; the other destinations keep the calmer 900px
       reading column). */
    <div data-testid="stitch-manuscript-workspace" style={SHELL_STYLE}>
      <ManuscriptToolbar m={m} tab={tab} onTabChange={setTab} />

      {/* 85.md B2 — pre-export validation review. 118.md keeps it mounted ABOVE
          every panel so it is visible from whichever destination started the export. */}
      {exportReview && (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <ExportValidationDialog review={exportReview} exporting={exporting}
            onExportAnyway={onExportAnyway} onClose={() => setExportReview(null)} />
        </div>
      )}

      {/* panels — the tablist's one tabpanel (118.md §42). */}
      <div
        id={MS_PANEL_ID}
        role="tabpanel"
        aria-labelledby={msTabDomId(tab)}
        data-testid="stitch-manuscript-panel"
        style={{ maxWidth: tab === 'editor' ? 'none' : 900, margin: '0 auto' }}
      >
        {/* 118.md §3 — `onNavigate` is the ONE way a panel changes destination, so
            an Overview CTA and a nav tab take exactly the same path (Updates plan
            refresh + the ?ms= round-trip included). */}
        {tab === 'overview' && <OverviewPanel m={m} exporters={exporters} onOpenSection={openSection} onNavigate={setTab} />}
        {tab === 'updates' && <UpdatesPanel m={m} onNavigate={setTab} onOpenSection={openSection} />}
        {/* 117.md §10 — "Edit table" on a GENERATED object opens the panel that owns
            it (a builder table has no prose to jump to). */}
        {tab === 'editor' && (
          <EditorPanel m={m} exporters={exporters} sectionRequest={sectionRequest}
            onNavigate={setTab}
            onOpenAssetPanel={(which) => setTab(which === 'figures' ? 'figures' : 'tables')}
            /* 117.md §38 — View / Edit / Open PDF / Go to References from a chip. */
            onOpenReference={openReference} />
        )}
        {tab === 'tables' && <TablesPanel m={m} onNavigate={setTab} />}
        {tab === 'figures' && <FiguresPanel m={m} onNavigate={setTab} />}
        {tab === 'references' && (
          <ReferencesPanel m={m} focusReference={focusReference} onNavigate={setTab}
            /* 117.md §34 — "Cite" from the library inserts at the end of Results when
               no editor is mounted, exactly like the Tables panel's Insert reference. */
            onInsertCitation={(id) => {
              const ok = m.insertCitationReference && m.insertCitationReference(id);
              if (ok) setTab('editor');
            }} />
        )}
        {tab === 'prisma' && <PrismaPanel m={m} exporters={exporters} onNavigate={setTab} />}
        {tab === 'export' && <ExportPanel m={m} exporters={exporters} onNavigate={setTab} />}
      </div>
    </div>
  );
}

export default ManuscriptWorkspace;
