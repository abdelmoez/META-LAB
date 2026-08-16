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
  ManuscriptToolbar, ManuscriptToolbarSkeleton, ManuscriptViewSwitcher,
  MANUSCRIPT_TAB_IDS, MS_PANEL_ID, msTabDomId,
  normalizeManuscriptView, DEFAULT_MANUSCRIPT_VIEW,
} from './ManuscriptToolbar.jsx';
// 118.md §12 — the view preference is a per-USER workspace preference, so it is
// read from the signed-in user when there is one. Optional on purpose: this
// workspace renders in SSR contract tests and in shells without the provider.
import { useOptionalAuth } from '../../frontend/context/AuthContext.jsx';

const safeName = (s) => String(s || 'manuscript').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'manuscript';

const normalizeSubtab = (id) => (MANUSCRIPT_TAB_IDS.includes(id) ? id : 'overview');

/* 118.md §12 — "store the user's preferred view where appropriate so refreshing the
   editor does not unnecessarily reset their workflow". It is a UI preference, never
   manuscript data, so it goes to localStorage under the established per-user key
   pattern (`metalab.<x>.${userId}` — the screening prefs precedent) and NEVER into
   the project blob, which must stay byte-stable. */
export const viewPrefKey = (userId) => (userId ? `metalab.manuscriptView.${userId}` : null);

export function readStoredView(key) {
  if (!key || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    // An unknown stored value is ignored rather than normalized-and-kept, so a
    // corrupted preference silently falls back to the default instead of sticking.
    return raw && normalizeManuscriptView(raw) === raw ? raw : null;
  } catch { return null; }
}

function writeStoredView(key, view) {
  if (!key || typeof localStorage === 'undefined') return;
  try { localStorage.setItem(key, view); } catch { /* storage full / denied — the URL still carries it */ }
}

/* 118.md §49 — one constant engine column. The toolbar spans it; only the document
   column inside changes width per destination, so the chrome never resizes. */
const SHELL_STYLE = { maxWidth: 1440, margin: '0 auto', padding: '4px 2px' };

/**
 * @param {string}   initialSubtab   118.md §47 — the host's URL sub-param (`?ms=`).
 *                   Stitch passes it; the LEGACY shell passes nothing, so the default
 *                   keeps that shell on pure component state (it has no such route).
 * @param {function} onSubtabChange  (id, view) => void — the router-aware host pushes
 *                   BOTH engine sub-params. 118.md §12/§47: the view is part of the
 *                   same URL state, so it travels through the same seam rather than
 *                   a second one that could push a href missing the other param.
 *                   Absent → local state only, exactly as before.
 * @param {string}   initialView     118.md §12/§47 — `?msv=`, or null/absent when the
 *                   URL does not name a view (the legacy shell never does).
 */
export function ManuscriptWorkspace({ project, upd, initialSubtab, onSubtabChange, initialView }) {
  const m = useManuscript(project, upd);
  const [tab, setTabState] = useState(() => normalizeSubtab(initialSubtab));

  /* ── 118.md §12/§45 — the editing VIEW ───────────────────────────────────────
     ONE piece of view state and NO manuscript state: both views render the same
     draft through the same hook (§13). First paint resolves URL → stored per-user
     preference → DEFAULT_MANUSCRIPT_VIEW, so a shared `?msv=` link opens the view it
     names even for someone whose own preference differs, while a plain reload keeps
     the workflow they chose (§12).
     119.md §3 — that middle step is the whole of "existing users with an explicitly
     saved view preference retain that preference": the default moved to Continuous
     View, and a stored 'sections' still wins over it. Nothing is written here, so a
     researcher who never chose is never given a preference they did not make. */
  const auth = useOptionalAuth();
  const userId = (auth && auth.user && auth.user.id) || null;
  const prefKey = viewPrefKey(userId);
  const [view, setViewState] = useState(() => (initialView
    ? normalizeManuscriptView(initialView)
    : (readStoredView(viewPrefKey(userId)) || DEFAULT_MANUSCRIPT_VIEW)));
  const viewRef = useRef(view);
  viewRef.current = view;

  /* The signed-in user arrives ASYNCHRONOUSLY, so the first render can have no
     storage key and the initializer above then reads nothing. Hydrate once the key
     exists — never over a choice already made in this session, and never over a view
     the URL asked for (the ScreeningTab prefs-hydration precedent). */
  const viewTouched = useRef(false);
  const hydratedKey = useRef(null);
  useEffect(() => {
    if (!prefKey || viewTouched.current || hydratedKey.current === prefKey) return;
    hydratedKey.current = prefKey;
    if (initialView) return;
    const stored = readStoredView(prefKey);
    if (stored) setViewState(stored);
  }, [prefKey, initialView]);

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
  /* Live handle for `m.flush`: the reconcile effects below are keyed on the URL
     props alone (a `m`-shaped dependency would re-run them on every keystroke),
     but they still owe the §45 flush. */
  const flushRef = useRef(m.flush);
  flushRef.current = m.flush;

  const setTab = useCallback((next) => {
    const id = normalizeSubtab(next);
    /* r2 — clicking the destination you are ALREADY on is not a navigation. Without
       this guard a same-tab click (the nav tab, an Overview CTA that lands where you
       already are, a keyboard re-activation) pushed a duplicate history entry, so
       browser Back appeared to do nothing; and re-clicking Updates re-ran the heavy
       sync plan. `refreshSyncPlan` belongs to genuine ENTRY, which is what this is. */
    if (id === tabRef.current) return;
    tabRef.current = id;
    setTabState(id);
    // 84.md — the Updates destination owns a heavy plan that is computed on entry only.
    if (id === 'updates' && refreshPlanRef.current) refreshPlanRef.current();
    if (typeof hostNavRef.current === 'function') hostNavRef.current(id, viewRef.current);
  }, []);

  /* 118.md §45 — EVERY view toggle FLUSHES first. The two debounces (600 ms field
     patch → 800 ms blob autosave) are usually still armed when someone types a
     sentence and immediately switches view, and the continuous document mounts its
     editors from the COMMITTED draft — so without this the last words typed in
     Section View would mount as absent. That is the whole of "switching views must
     never lose work": there is no second copy to reconcile, only a flush. */
  const setView = useCallback((next) => {
    const id = normalizeManuscriptView(next);
    viewTouched.current = true;
    if (m.flush) m.flush();
    setViewState(id);
    writeStoredView(viewPrefKey(userId), id);
    // The same ONE seam as a destination change, so the pushed href always carries
    // both engine sub-params instead of dropping whichever one it did not know.
    if (typeof hostNavRef.current === 'function') hostNavRef.current(tabRef.current, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, userId]);

  /* §47/§48 — once this session has PUT the view in the URL, the URL is
     authoritative in both directions, so Back/Forward walks view changes exactly.
     119.md §3 — an absent `?msv=` then means DEFAULT_MANUSCRIPT_VIEW, because that is
     precisely the value manuscriptSubHref omits; the two rules are symmetric and flip
     together, which is why this reads the constant rather than naming a view.
     Before the first toggle an absent param means "the URL does not express a view"
     and the stored preference above stands — otherwise every fresh load would
     silently overwrite the researcher's saved workflow with the default. */
  useEffect(() => {
    if (typeof hostNavRef.current !== 'function') return;
    if (initialView == null && !viewTouched.current) return;
    const id = normalizeManuscriptView(initialView || DEFAULT_MANUSCRIPT_VIEW);
    if (id === viewRef.current) return;
    /* r2 (118.md §45) — a view change that arrives through the URL (browser
       Back/Forward, a white side-menu href, a deep link) is the SAME view toggle as
       the switcher's, so it owes the SAME flush. `setView` flushes; this path did
       not, and the two debounces (600 ms field patch → 800 ms blob autosave) are
       usually still armed when someone types a sentence and reaches for Back. The
       other view mounts its editors from the COMMITTED draft, so the un-flushed
       words mounted as absent and the next keystroke overwrote them for good.
       Flush BEFORE the state write, exactly as the switcher does. */
    if (flushRef.current) flushRef.current();
    setViewState(id);
  }, [initialView]);

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

  /* 118.md §65 — "View in manuscript" from the Tables / Figures managers. The
     manager and the inline representation are the SAME entity, so this navigates to
     where that entity already is (the section that holds a manual table, or the
     first sentence that cross-references a generated one) and never creates a copy.
     `target` comes from assetManuscriptTarget, which returns null when the object is
     not in the text — the button does not render then. */
  const openAsset = useCallback((target) => {
    if (!target || !target.sectionId) return;
    setSectionRequest({ ...target, id: target.sectionId, at: Date.now() });
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
      <ManuscriptToolbar m={m} tab={tab} onTabChange={setTab}
        /* 118.md §12 — the documented right-hand slot, filled. It renders only on
           the Editor destination (the toolbar enforces that) and condenses with the
           rest of Level B. */
        viewSwitcher={({ condensed }) => (
          <ManuscriptViewSwitcher view={view} onChange={setView} condensed={condensed} />
        )} />

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
        {/* r2 — UpdatesPanel takes `onOpenSection` only: its cards' "View in
            manuscript" goes through openSection, which already switches to the
            Editor. The `onNavigate` that used to be passed here was never read. */}
        {tab === 'updates' && <UpdatesPanel m={m} onOpenSection={openSection} />}
        {/* 117.md §10 — "Edit table" on a GENERATED object opens the panel that owns
            it (a builder table has no prose to jump to). */}
        {tab === 'editor' && (
          <EditorPanel m={m} exporters={exporters} sectionRequest={sectionRequest}
            /* 118.md §10-§19 — the ONE Editor destination, in the view the
               researcher chose. Both views render the same draft through the same
               hook, so this prop changes the PRESENTATION and nothing else. */
            view={view}
            onNavigate={setTab}
            onOpenAssetPanel={(which) => setTab(which === 'figures' ? 'figures' : 'tables')}
            /* 117.md §38 — View / Edit / Open PDF / Go to References from a chip. */
            onOpenReference={openReference} />
        )}
        {/* 118.md §65 — "View in manuscript" on a table/figure row. */}
        {tab === 'tables' && <TablesPanel m={m} onNavigate={setTab} onOpenAsset={openAsset} />}
        {tab === 'figures' && <FiguresPanel m={m} onNavigate={setTab} onOpenAsset={openAsset} />}
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
