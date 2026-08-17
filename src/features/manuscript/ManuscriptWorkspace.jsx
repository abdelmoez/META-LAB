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
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { C } from '../../frontend/workspace/ui/styles.js';
import { InfoBox } from '../../frontend/workspace/ui/primitives.jsx';
import { draftSectionIds } from '../../research-engine/manuscript/index.js';
import { useManuscript } from './useManuscript.js';
import {
  OverviewPanel, EditorPanel, TablesPanel, FiguresPanel, ReferencesPanel, PrismaPanel, ExportPanel,
  UpdatesPanel, ExportValidationDialog,
  // 121.md §3 — the ONE announced + revealed export feedback surface.
  ExportFeedbackRegion, ExportRunErrorNotice, EXPORT_FEEDBACK_HEADING_ID,
} from './manuscriptPanels.jsx';
// 119.md §7 — the reporting-structure switcher (preview · diff · mapping · undo).
import { StructureSwitcher, StructureChangeUndo } from './StructureSwitcher.jsx';
import {
  ManuscriptToolbar, ManuscriptToolbarSkeleton, ManuscriptViewSwitcher,
  MANUSCRIPT_TAB_IDS, MS_PANEL_ID, msTabDomId,
  normalizeManuscriptView, DEFAULT_MANUSCRIPT_VIEW,
} from './ManuscriptToolbar.jsx';
// 118.md §12 — the view preference is a per-USER workspace preference, so it is
// read from the signed-in user when there is one. Optional on purpose: this
// workspace renders in SSR contract tests and in shells without the provider.
import { useOptionalAuth } from '../../frontend/context/AuthContext.jsx';
/* 120.md §6 — the Writing Assistant. The HOOK lives here, at the one level that has
   BOTH the project blob (title/question/PICO/studies → the project lexicon) and the
   manuscript hook (sections, references, tables), and whose children are both the
   toolbar (which shows the chip) and the editor panel (which owns the prose). */
import { useWritingAssistant } from './writingAssistant/useWritingAssistant.js';
import { WritingAssistantControl } from './writingAssistant/WritingAssistantControl.jsx';
import { buildWaProjectShape } from './writingAssistant/waProjectShape.js';
import { publicFeatureFlags } from '../../frontend/featureAccess/featureFlagState.js';
// 119.md §4 — the Editor + included-article PDF split workspace.
/* 120.md §8 — ManuscriptSplitToggle is no longer mounted here: the PDF View
   destination in the toolbar's tablist replaced it, so the pane has exactly one
   control again. The component itself stays exported from PdfSplitPane.jsx (and the
   toolbar keeps its `splitToggle` slot) for a host without that navigation. */
import {
  PdfSplitPane, SplitResizeDivider, useManuscriptSplit, useSplitLayout,
} from './PdfSplitPane.jsx';
import {
  SPLIT_DIVIDER_PX, splitRatioKey, splitArticleKey, readStoredArticle, writeStoredArticle,
  buildSplitArticles, pickArticle,
} from './manuscriptSplit.js';
/* §4 — "Hide the normal left and right menus/panels to maximize writing space". The
   shell already has exactly one mechanism for that (Focus Mode UNMOUNTS both rails and
   leaves the slim focus bar), so the split DRIVES it instead of inventing a second
   hide-the-rails path that the global navigation would then have to know about. Safe
   outside the provider: `useFocusMode` returns a permanently-off no-op shape, which is
   what the SSR contract tests get.
   121.md §2 — CORRECTING what this comment used to claim: the LEGACY shell is NOT one
   of those. FocusModeProvider wraps every route (App.jsx), so `useFocusMode` there is
   the real thing and the split's entry really did flip global focus state — and
   request browser fullscreen — in a shell whose chrome never subscribes to it and
   stayed fully visible. `useFocusAvailable` is the synchronous "does the enclosing
   shell declare itself focusable?" answer (only StitchAppShell does), and it is what
   the entry below is gated on. */
import { useFocusMode, useFocusAvailable } from '../../frontend/focus/FocusModeContext.jsx';
/* 121.md §3 — the reveal reuses the manuscript's OWN scroll utilities rather than a
   fourth copy of "find the scroller": `scrollSectionIntoView` resolves the right one
   in every configuration (Stitch main, legacy div, Focus Mode, the pdfview split),
   compensates the sticky toolbar and honours prefers-reduced-motion, and
   `suppressActiveScroll` keeps the 118.md §16/§17 active-section indicator honest
   while the page flies past sections on the way to the message. */
import { scrollSectionIntoView, suppressActiveScroll, useReducedMotion } from './ContinuousView.jsx';

const safeName = (s) => String(s || 'manuscript').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'manuscript';

const normalizeSubtab = (id) => (MANUSCRIPT_TAB_IDS.includes(id) ? id : 'overview');

/* ── 120.md §8 — the 'PDF View' destination ────────────────────────────────────
   PDF View is NOT a ninth panel and NOT a second PDF viewer: it is the Editor
   destination with the 119.md §4 split pane open. `splitOpen` therefore stays the
   single source of truth and the toolbar's selected destination becomes a
   PROJECTION of (panel destination × pane state). These two pure functions are the
   entire mapping, in both directions, and are exported so the contract is testable
   without a DOM:

     destinationFor('editor', true)  → 'pdfview'    (what the nav and `?ms=` show)
     panelFor('pdfview')             → 'editor'     (which panel actually renders)

   The consequence that matters for §8's state-preservation list: EditorPanel keeps
   rendering under `tab === 'editor'` in the same position of the same tree, so
   moving between Editor and PDF View never remounts it — no lost caret, no lost
   undo history, no discarded unsaved text. */
export const PDF_VIEW_TAB = 'pdfview';
export const panelFor = (destination) => (destination === PDF_VIEW_TAB ? 'editor' : destination);
export const destinationFor = (panelTab, splitOpen) => (
  (panelTab === 'editor' && splitOpen) ? PDF_VIEW_TAB : panelTab
);

/* 118.md §12 — "store the user's preferred view where appropriate so refreshing the
   editor does not unnecessarily reset their workflow". It is a UI preference, never
   manuscript data, so it goes to localStorage under the established per-user key
   pattern (`metalab.<x>.${userId}` — the screening prefs precedent) and NEVER into
   the project blob, which must stay byte-stable. */
export const viewPrefKey = (userId) => (userId ? `metalab.manuscriptView.${userId}` : null);

/* ── 121.md §3 — WHEN is there something new to reveal? ────────────────────────
   The reveal must fire for a NEW message and stay quiet for a re-render, so it is
   keyed on stable CONTENT rather than on the review object — a fresh
   `{model, validation, fetchedAt}` is built on every attempt, and keying on its
   identity would re-scroll and re-steal focus on any unrelated re-render that
   happened to recreate it. `fetchedAt` + the recheck flag + the three finding counts
   are exactly what changes when there is something new to say, which is also why the
   recheck path re-reveals for free (a re-check always carries a newer fetchedAt).
   A run ERROR outranks a review: it is the thing that just happened, and the two are
   mutually exclusive in practice (runExport clears the error before every attempt).
   '' means "nothing to reveal", which also RESETS the latch, so raising the same
   message again after dismissing it reveals it again. Pure, and exported so the state
   machine is pinned without a DOM. */
export function exportRevealKey(exportError, exportReview) {
  if (exportError) return `error ${exportError}`;
  if (!exportReview) return '';
  const v = exportReview.validation || {};
  return [
    'review',
    exportReview.fetchedAt || '',
    exportReview.recheck ? 'recheck' : '',
    (v.errors || []).length,
    (v.warnings || []).length,
    (v.info || []).length,
  ].join(' ');
}

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

/* 119.md §4 — with the PDF pane open the workspace is a two-column writing surface,
   so the constant engine column gives way to the full width the shell now offers (the
   rails are gone). Same object shape, so nothing else in the layout moves. */
const SPLIT_SHELL_STYLE = { ...SHELL_STYLE, maxWidth: 'none' };

/* 121.md §2 — …and when the HOST has taken the workspace full-bleed for the open
   split (see `onWorkspaceChange` below), the engine column becomes a BOUNDED COLUMN:
   its height comes from the host's `calc(100vh - <real chrome>)` wrapper, the toolbar
   keeps its natural height at the top, and the split row takes everything that is
   left. That is what replaces PdfSplitPane's old `calc(100vh - 150px)` guess — the
   pane is simply `height:100%` of a box whose height was measured, so fullscreen
   enter/exit, a window resize, a divider drag and a pinned drawer all flow through
   flex with no viewport arithmetic anywhere. */
const SPLIT_SHELL_BOUNDED = {
  ...SPLIT_SHELL_STYLE,
  flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column',
};

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
 * @param {function} onWorkspaceChange 121.md §2 — (boolean) => void. Reports "the PDF
 *                   split is open in its two-column layout", so the host can take the
 *                   stage FULL-BLEED exactly as it already does for an open RoB
 *                   assessment and an open Extraction article (the
 *                   robInWorkspace/extractionInWorkspace seam). Keyed on the STATE,
 *                   never on the stage: Overview, Tables, References and the rest of
 *                   the manuscript destinations keep their reading column. Absent (the
 *                   legacy shell, the SSR contract tests) → the workspace keeps the
 *                   page-scroll model it has always had, unchanged.
 */
export function ManuscriptWorkspace({ project, upd, initialSubtab, onSubtabChange, initialView, onWorkspaceChange }) {
  const m = useManuscript(project, upd);
  /* 120.md §8 — the URL names a DESTINATION ('pdfview' included); the state below
     holds the PANEL it resolves to. A `?ms=pdfview` deep link therefore lands on the
     Editor panel with the pane already open, on the first paint, with no flash of a
     paneless editor and no extra history entry. */
  const initialDestination = normalizeSubtab(initialSubtab);
  const [tab, setTabState] = useState(() => panelFor(initialDestination));

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
  /* r2 — WHAT AN ABSENT `?msv=` MEANS FOR THIS SESSION. Not "the default": the view
     the workspace was actually SHOWING before the first toggle, i.e. URL → stored
     preference → default, resolved once. A researcher whose saved preference is
     Sections opens a bare link and sees Sections; the history entry for that bare
     URL therefore means Sections, and resolving it to Continuous when they navigate
     back to it would show them a view that entry never displayed. Frozen at the
     first toggle by construction: nothing below writes it once `viewTouched`. */
  const baselineView = useRef(view);

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
    if (stored) { setViewState(stored); baselineView.current = stored; }
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

  /* 120.md §8 — live handles for the projection, so `setTab` can stay referentially
     STABLE (it is handed to the toolbar and to every panel) while still reading the
     current pane state and driving the one open/close path defined further down. */
  const destinationRef = useRef(destinationFor(tab, initialDestination === PDF_VIEW_TAB));
  const setSplitRef = useRef(null);

  const setTab = useCallback((next) => {
    const id = normalizeSubtab(next);
    /* r2 — clicking the destination you are ALREADY on is not a navigation. Without
       this guard a same-tab click (the nav tab, an Overview CTA that lands where you
       already are, a keyboard re-activation) pushed a duplicate history entry, so
       browser Back appeared to do nothing; and re-clicking Updates re-ran the heavy
       sync plan. `refreshSyncPlan` belongs to genuine ENTRY, which is what this is.
       120.md §8 — compared against the DESTINATION (the thing the nav shows and the
       URL carries), not the panel: Editor and PDF View share a panel, so comparing
       panels would swallow every move between them. */
    if (id === destinationRef.current) return;
    /* 120.md §8 — the two Editor destinations differ ONLY by the pane, and both
       transitions go through the ONE flush-first open/close path (`setSplitTo`), so
       nothing typed in the last 600 ms can be lost by navigating. Choosing any other
       destination leaves the pane exactly as it was — a researcher who opened a PDF
       and stepped over to Tables comes back to it. */
    if (id === PDF_VIEW_TAB) { if (setSplitRef.current) setSplitRef.current(true); }
    else if (id === 'editor') { if (setSplitRef.current) setSplitRef.current(false); }
    const panel = panelFor(id);
    if (panel !== tabRef.current) {
      tabRef.current = panel;
      setTabState(panel);
    }
    destinationRef.current = id;
    // 84.md — the Updates destination owns a heavy plan that is computed on entry only.
    if (id === 'updates' && refreshPlanRef.current) refreshPlanRef.current();
    if (typeof hostNavRef.current === 'function') hostNavRef.current(id, viewRef.current, viewTouched.current);
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
    // r2 — and, from the first toggle on, an EXPLICIT `?msv=` for BOTH values: a
    // href identical to the bare URL already displayed would push a duplicate
    // history entry (Back looks dead), and it would also be ambiguous with the
    // pre-toggle entries that meant the stored preference. See manuscriptSubHref.
    if (typeof hostNavRef.current === 'function') hostNavRef.current(tabRef.current, id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, userId]);

  /* §47/§48 — once this session has PUT the view in the URL, the URL is
     authoritative in both directions, so Back/Forward walks view changes exactly.
     Before the first toggle an absent param means "the URL does not express a view"
     and the stored preference above stands — otherwise every fresh load would
     silently overwrite the researcher's saved workflow with the default.

     119.md §3 / r2 — AFTER the first toggle, every entry this session pushes names
     its view explicitly (manuscriptSubHref's `explicitView`), so an absent param can
     only belong to an entry that existed BEFORE the toggle — and what that entry was
     displaying is `baselineView`, the session's URL → stored-preference → default
     resolution. Reading the CONSTANT default here was wrong for exactly the
     researchers §3 promised not to disturb: someone whose saved preference is
     Sections pressed Back onto their own bare-URL entry and stayed in Continuous,
     so Back looked dead and needed a second press to leave the page. */
  useEffect(() => {
    if (typeof hostNavRef.current !== 'function') return;
    if (initialView == null && !viewTouched.current) return;
    const id = normalizeManuscriptView(initialView || baselineView.current || DEFAULT_MANUSCRIPT_VIEW);
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
    if (id === destinationRef.current) return;
    /* 120.md §8 — a destination that arrives through the URL (a deep link, the white
       side-menu, browser Back/Forward) opens and closes the pane through the SAME
       flush-first path a click takes, so Back out of PDF View cannot lose the words
       typed just before it. Reporting back out of here would loop, so this writes
       LOCAL state only. */
    if (id === PDF_VIEW_TAB) { if (setSplitRef.current) setSplitRef.current(true); }
    else if (id === 'editor') { if (setSplitRef.current) setSplitRef.current(false); }
    const panel = panelFor(id);
    if (panel !== tabRef.current) {
      tabRef.current = panel;
      setTabState(panel);
    }
    destinationRef.current = id;
    if (id === 'updates' && refreshPlanRef.current) refreshPlanRef.current();
  }, [initialSubtab]);

  /* 119.md §7 — the structure dialog lives HERE, above the panel host, for the same
     reason ExportValidationDialog does: it is reachable from the toolbar and from
     the Export destination, and applying a structure re-lays the whole document —
     so it must not be a child of the panel it is about to rebuild. */
  const [structureOpen, setStructureOpen] = useState(false);
  const openStructure = useCallback(() => {
    // A structure change re-reads the COMMITTED draft, so pending prose is flushed
    // before the preview is computed (118.md §45) — the diff must be of real text.
    if (m.flush) m.flush();
    setStructureOpen(true);
  }, [m]);

  const [exporting, setExporting] = useState(null); // null | 'word' | 'repro' | 'prisma' | 'prismaS'
  const [exportError, setExportError] = useState('');
  // 85.md B2 — pre-export validation review ({ model, validation, fetchedAt })
  // + figure-rasterization progress label for the Word button.
  const [exportReview, setExportReview] = useState(null);
  const [exportProgress, setExportProgress] = useState('');
  // 73.md Part 9 — Overview/Consistency "Open" actions jump into the Editor at a
  // specific section (or straight to the References tab for reference findings).
  const [sectionRequest, setSectionRequest] = useState(null);
  /* 121.md §3 — "go to this place in the manuscript" means the EDITOR PANEL, and the
     destination that names it is PDF View whenever the pane is open (destinationFor is
     that projection). Asking for `'editor'` by name went through setTab's one open/
     close path and CLOSED the researcher's PDF as a side effect of a jump that was
     never about the pane — and, because the workspace un-full-bleeds with it, the
     scroll that jump just computed was measured against a column that no longer
     existed, so the reader landed nowhere. One helper, used by every in-manuscript
     jump, so Overview CTAs and "View in manuscript" get the same fix. */
  const openEditorDestination = useCallback(
    () => setTab(destinationFor('editor', splitOpenRef.current)), [setTab],
  );
  const openSection = useCallback((id) => {
    if (id === 'references') { setTab('references'); return; }
    // 119.md §7 — the DRAFT'S sections: a jump can legitimately name a section a
    // template introduced (CARE's Timeline) or one preserved from an older one.
    if (!draftSectionIds(m.activeDraft).includes(id)) { openEditorDestination(); return; }
    setSectionRequest({ id, at: Date.now() });
    openEditorDestination();
  }, [setTab, openEditorDestination, m.activeDraft]);

  /* 118.md §65 — "View in manuscript" from the Tables / Figures managers. The
     manager and the inline representation are the SAME entity, so this navigates to
     where that entity already is (the section that holds a manual table, or the
     first sentence that cross-references a generated one) and never creates a copy.
     `target` comes from assetManuscriptTarget, which returns null when the object is
     not in the text — the button does not render then. */
  const openAsset = useCallback((target) => {
    if (!target || !target.sectionId) return;
    setSectionRequest({ ...target, id: target.sectionId, at: Date.now() });
    // 121.md §3 — same rule as openSection: land on the editor PANEL without closing
    // an open PDF pane (see openEditorDestination).
    openEditorDestination();
  }, [openEditorDestination]);

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

  /* ── 119.md §4 — the Editor + included-article PDF split ─────────────────────
     Everything here is LAYOUT. It is deliberately kept in this file, above the panel
     host, because the whole of §4's reliability list ("must not reload the manuscript
     / reset the cursor / discard unsaved changes / break autosave") follows from ONE
     structural rule: the editor's position in the element tree never changes. The row
     and the editor pane are rendered ALWAYS — opening, closing and resizing the split
     change their STYLE and append siblings AFTER the editor, so React never unmounts
     the panel host and `useManuscript` (which is above all of this) never re-runs. */
  const projectId = (project && project.id) || '';
  const splitRowRef = useRef(null);
  // 120.md §8 — a `?ms=pdfview` deep link IS "the pane is open", resolved on the
  // first render so the pane is never opened by a second, post-mount transition.
  const [splitOpen, setSplitOpen] = useState(initialDestination === PDF_VIEW_TAB);
  const splitOpenRef = useRef(splitOpen);
  splitOpenRef.current = splitOpen;
  /* 120.md §8 — once the pane has been opened in this session it stays MOUNTED, and
     closing it only HIDES it. Unmounting destroyed PdfSplitPane's keep-alive viewer
     pool (SPLIT_KEEPALIVE), which is where the open document's page, zoom, rotation
     and search live — so with PDF View as a toolbar destination, every Editor⇄PDF
     View move would have re-downloaded and re-rendered the PDF and thrown all of it
     away. §8 lists exactly those as state that must survive the switch. */
  const [splitMounted, setSplitMounted] = useState(splitOpen);
  /* 120.md §8 — the destination the NAVIGATION shows and the URL carries. Derived on
     every render from the two pieces of state, so it can never drift from them. */
  const destination = destinationFor(tab, splitOpen);
  destinationRef.current = destination;
  const [articleId, setArticleId] = useState('');
  const [reportId, setReportId] = useState('');
  const [stackPane, setStackPane] = useState('editor');   // narrow layout: which pane is shown
  const split = useManuscriptSplit(splitRowRef, splitRatioKey(userId));
  const splitLayout = useSplitLayout(splitRowRef, splitOpen);

  /* ── 121.md §2 — the fill fix, in ONE flag ───────────────────────────────────
     `splitFills` is true exactly when the two-column split is on screen in a host
     that offers the full-bleed seam. It is the same flag on both sides of that
     seam: the host uses it to drop the 1560 shell cap, the rounded card's 20px
     frame and the content padding, and this workspace uses it to become a bounded
     column inside the height the host derived from REAL chrome (57px header, or
     the 40px focus bar). Reported through `onWorkspaceChange`, the precedent an
     open RoB assessment and an open Extraction article already use.

     Deliberately conditioned on the callback existing: a host that does not offer
     the seam (the legacy shell, the SSR contract tests) never gets a bounded
     column it has no bounded height for, so its layout is untouched. */
  const splitFills = splitOpen && splitLayout === 'split' && typeof onWorkspaceChange === 'function';
  useEffect(() => {
    if (typeof onWorkspaceChange !== 'function') return undefined;
    onWorkspaceChange(splitFills);
    // Leaving the Manuscript stage with the pane open must not strand the shell
    // full-bleed (the PecanExtractionEngine cleanup, same reason).
    return () => onWorkspaceChange(false);
  }, [splitFills, onWorkspaceChange]);

  /* 121.md §2 — the divider's `reduced` prop has existed since 119 §4 and was never
     wired. Read once per mount and kept live, because the OS setting can change
     while the workspace is open. */
  const reducedMotion = useReducedMotion();

  const articles = useMemo(
    () => buildSplitArticles(m.references, project && project.studies),
    [m.references, project],
  );
  const activeArticle = useMemo(
    () => pickArticle(articles, articleId, m.referencePdfIds, m.screenProjectId),
    [articles, articleId, m.referencePdfIds, m.screenProjectId],
  );

  /* The remembered article + open state (§4 "Remembering the most recently viewed
     article when appropriate"), per user and per project, in localStorage — never in
     the blob, and never a server call: §4 forbids "audit events repeatedly from layout
     noise", and the cheapest way to honour that is for layout to make no writes at all
     that leave the browser. Hydrated once, exactly like the view preference, because
     the signed-in user arrives asynchronously. */
  const articleKey = splitArticleKey(userId);
  const splitHydrated = useRef(null);
  /* 120.md r2 — has the pane been set by the USER in this session? The `viewTouched`
     precedent: a stored layout preference may seed a fresh mount, never overrule a
     choice already made on screen. */
  const splitTouched = useRef(false);
  useEffect(() => {
    if (!articleKey || !projectId || splitHydrated.current === `${articleKey}:${projectId}`) return;
    splitHydrated.current = `${articleKey}:${projectId}`;
    const stored = readStoredArticle(articleKey, projectId);
    if (!stored) return;
    setArticleId(stored.refId);
    setReportId(stored.reportId || '');
    /* 120.md §8 — hydration deliberately does NOT go through `setSplitTo`: that path
       re-writes the remembered article, and at this instant `articleId` is still the
       pre-hydration value, so the stored choice would be clobbered by its own
       restoration. It opens the pane directly and arms the keep-alive latch.

       120.md r2 — but ONLY when the mount's URL does not already say otherwise, and
       only when the researcher has not already set the pane themselves this session.
       `?ms=` is authoritative and the toolbar's destination is a projection of
       (panel × splitOpen), so opening the pane under `?ms=editor` made the two
       disagree permanently: the nav showed PDF View while the URL said editor,
       clicking 'PDF View' was swallowed by setTab's same-destination guard (the URL
       could never be corrected from the tab that was selected), and clicking 'Editor'
       pushed a href identical to the current one — a duplicate history entry, so Back
       looked dead. A URL that names `editor` HAS named the pane: closed. Nothing is
       written back here, so the no-history-push-on-load property is untouched, and
       `?ms=pdfview` still opens on the first render through `splitOpen`'s initializer.
       `splitTouched` mirrors `viewTouched` ten lines above: hydration arriving late
       (auth resolves asynchronously) must never reopen a pane the user just closed. */
    if (stored.open && !splitTouched.current && initialDestination !== 'editor') {
      splitOpenRef.current = true;
      setSplitOpen(true);
      setSplitMounted(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleKey, projectId]);

  const rememberSplit = useCallback((next) => {
    if (!articleKey || !projectId) return;
    writeStoredArticle(articleKey, projectId, next);
  }, [articleKey, projectId]);

  /* §4 "PDF availability status" — resolved through the 117 seam (one listPdf per
     included screening record, batched + cached + soft-failing to "unknown"), and only
     once the researcher has actually opened the pane. */
  const resolvedFor = useRef('');
  useEffect(() => {
    if (!splitOpen || !articles.length) return;
    const sig = `${projectId}:${articles.length}`;
    if (resolvedFor.current === sig) return;
    resolvedFor.current = sig;
    if (m.resolveReferencePdfs) m.resolveReferencePdfs(articles.map((a) => a.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitOpen, articles, projectId]);

  /* §4 — the maximized layout. Focus Mode is the shell's own rail-hiding mechanism, so
     the split enters it and, on exit, RELEASES it only when the split is what turned it
     on (a researcher who was already in Focus Mode stays there).

     121.md §2 — "opening the PDF viewer must not automatically enter fullscreen". The
     LAYOUT half of that is still exactly right and stays (without the rails hidden a
     1440px laptop's row falls under SPLIT_STACK_BELOW and the split degrades to one
     stacked pane — a 119 §4 regression), so the fix is the entry, not the intent:
     `{ fullscreen: false }` asks Focus Mode for its layout and leaves the browser
     chrome alone. Fullscreen stays one explicit gesture away (the focus bar's "Enter
     full screen", the header toggle, Ctrl+Shift+F), and a click-opened pane now lands
     in the SAME state a `?ms=pdfview` deep link already did — that mount has no user
     activation, so its request was always refused into windowed focus.

     …and the entry is GATED on the shell actually being able to render the focused
     layout. FocusModeProvider wraps every route, so in the legacy shell this used to
     flip global focus state (and request real fullscreen) while the legacy chrome —
     which never subscribes — stayed fully visible. */
  const focus = useFocusMode();
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const focusAvailable = useFocusAvailable();
  const focusAvailableRef = useRef(focusAvailable);
  focusAvailableRef.current = focusAvailable;
  const focusOwned = useRef(false);
  const prevSplitOpen = useRef(false);
  /* 121.md r2 — OWNERSHIP CANNOT SURVIVE AN EXIT THE SPLIT DID NOT PERFORM.
     `focusOwned` was raised on the open transition and lowered only by the split's own
     close branch, so a researcher who left Focus Mode themselves (the focus bar's exit,
     Ctrl+Shift+F) and later re-entered it DELIBERATELY — that time with real fullscreen,
     which the gesture grants — was still recorded as "the split turned this on".
     Closing the pane then dropped them out of the fullscreen they had just chosen, and
     so did leaving the stage with the pane open. Focus being OFF while the pane is open
     is proof the split no longer owns it, whoever turned it off; anything after that is
     the researcher's own. Declared BEFORE the open/close effect on purpose: effects run
     in declaration order, and the open transition must be able to claim ownership in
     the same commit that this one observes the pre-open (focus-off) state. */
  useEffect(() => {
    if (splitOpen && !focus.focus) focusOwned.current = false;
  }, [splitOpen, focus.focus]);
  useEffect(() => {
    if (splitOpen === prevSplitOpen.current) return;
    prevSplitOpen.current = splitOpen;
    const api = focusRef.current;
    if (splitOpen) {
      if (focusAvailableRef.current && !api.focus && api.setFocus) {
        api.setFocus(true, { fullscreen: false });
        focusOwned.current = true;
      }
    } else if (focusOwned.current) {
      focusOwned.current = false;
      if (api.setFocus) api.setFocus(false);
    }
  }, [splitOpen]);
  // Leaving the workspace with the pane open must not strand the shell in Focus Mode.
  useEffect(() => () => {
    if (focusOwned.current && focusRef.current && focusRef.current.setFocus) focusRef.current.setFocus(false);
  }, []);

  /* ARCH-119 §4 — `m.flush()` before every LAYOUT transition, for the same reason the
     view toggle owes one (118.md §45): the two debounces (600 ms field patch → 800 ms
     blob autosave) are usually still armed, and a re-laid-out editor re-reads the
     COMMITTED draft. Resizing does NOT flush — it re-renders nothing but the divider. */
  /* 120.md §8 — THE one open/close path. Every route into the pane now goes through
     it (the PDF View / Editor destinations, a `?ms=` deep link, browser Back/Forward,
     and the pane's own "Exit PDF view"), which is what keeps the flush, the stacked
     -layout rule and the remembered-article write from drifting apart. Idempotent on
     purpose: asking for the state it is already in does nothing at all — no flush, no
     localStorage write, no re-render. */
  const setSplitTo = useCallback((next) => {
    // 120.md r2 — from here on the pane state is the researcher's, not localStorage's.
    splitTouched.current = true;
    if (splitOpenRef.current === next) return;
    if (m.flush) m.flush();
    splitOpenRef.current = next;
    setSplitOpen(next);
    if (next) {
      setSplitMounted(true);
      /* Asking for PDF view on a NARROW screen means "show me the PDF": the stacked
         layout can only show one pane, so opening lands on the one just requested (on
         a wide screen the row shows both and this is inert). The pane switch is right
         there to go back to the manuscript. */
      setStackPane('pdf');
    }
    rememberSplit({ refId: articleId || (activeArticle && activeArticle.id) || '', reportId, open: next });
  }, [m, rememberSplit, articleId, activeArticle, reportId]);
  // The stable `setTab` reaches the live callback through this ref (see above).
  setSplitRef.current = setSplitTo;

  /* 120.md §8 — the pane's own exit control is the SAME navigation as choosing the
     Editor destination, so it reports through `setTab` and the URL follows (`?ms=`
     goes back to `editor`). From any other destination the pane is not what the nav
     is showing, so exiting is a pure layout change and pushes no history entry. */
  const exitSplit = useCallback(() => {
    if (tabRef.current === 'editor') setTab('editor');
    else setSplitTo(false);
  }, [setTab, setSplitTo]);

  const pickArticleId = useCallback((a) => {
    if (!a || !a.id) return;
    setArticleId(a.id);
    setReportId('');
    rememberSplit({ refId: a.id, reportId: '', open: true });
  }, [rememberSplit]);

  const pickReportId = useCallback((id) => {
    setReportId(id || '');
    rememberSplit({ refId: (activeArticle && activeArticle.id) || articleId, reportId: id || '', open: true });
  }, [rememberSplit, activeArticle, articleId]);

  /* ══════════ 121.md §3 — the export feedback region, revealed ══════════════════
     "An export error or warning may appear near the top of the page while the user
     remains lower on the page and does not understand why the export failed."

     ALL of the reveal lives here because this file is already the one seam that owns
     both feedback states (`exportError`, `exportReview`), the one every exporter
     funnels through (`runExport`), and the level the feedback already mounts at —
     above the panel host, so it is visible from whichever destination started the
     export. Nothing new is invented: the region is scrolled with the manuscript's own
     sticky-toolbar-aware `scrollSectionIntoView` (which resolves the correct scroller
     in every configuration §3 lists) and the heading is focused with
     `focus({preventScroll:true})` so the browser's default focus-scroll cannot fight
     the reduced-motion-aware one. */
  const exportFeedbackRef = useRef(null);
  const exportHeadingRef = useRef(null);

  /* Blocking vs advisory decides the live-region politeness, and both surfaces feed
     it: a failed RUN is always blocking (nothing was produced), a review is blocking
     only when it carries errors. */
  const exportBlocked = !!exportError
    || !!(exportReview && exportReview.validation && (exportReview.validation.errors || []).length);

  // See exportRevealKey (above, exported and pinned): stable CONTENT, never the
  // review object's identity, and '' resets the latch so a dismissed message can be
  // revealed again if it comes back.
  const revealKey = exportRevealKey(exportError, exportReview);
  const lastRevealed = useRef('');
  useEffect(() => {
    // Dismissed / resolved: forget it, so raising the SAME message again re-reveals.
    if (!revealKey) { lastRevealed.current = ''; return undefined; }
    if (lastRevealed.current === revealKey) return undefined;
    lastRevealed.current = revealKey;
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    /* ONE requestAnimationFrame — the house pattern (never a setTimeout with a magic
       delay). React has committed the region by the time an effect runs, and the frame
       is what guarantees the browser has LAID IT OUT before its box is measured. */
    const run = () => {
      const el = exportFeedbackRef.current;
      if (el) {
        // 118.md §16/§17 — the sections this scroll crosses must not steal the
        // Continuous View indicator from where the reader is being taken.
        suppressActiveScroll(800);
        scrollSectionIntoView(el);
      }
      const h = exportHeadingRef.current;
      if (h && typeof h.focus === 'function') {
        try { h.focus({ preventScroll: true }); } catch { h.focus(); }
      }
    };
    const raf = window.requestAnimationFrame
      ? window.requestAnimationFrame(run)
      : setTimeout(run, 0);
    return () => {
      if (window.cancelAnimationFrame && window.requestAnimationFrame) window.cancelAnimationFrame(raf);
      else clearTimeout(raf);
    };
  }, [revealKey]);

  /* §3 — "If the message relates to a particular section, table, figure, citation or
     reference, provide a control that navigates directly to it." The validation
     entries now carry the identity their producing sites always had (see
     exportValidation.js), and the three navigation callbacks above already implement
     view-aware scrolling, the suppressActive discipline and object-level reveal — so
     this is pure routing, not a fourth navigation path. */
  const goToFinding = useCallback((target) => {
    if (!target) return;
    /* 121.md r2 — the References panel lives in the SAME `split-editor` wrapper the
       comment below is protecting (it is one of the editor tabpanels, not a third
       pane), so a refId jump in the stacked layout updated a display:none panel and
       left the PDF on screen: the control appeared to do nothing. Every destination
       this router can reach is inside that wrapper, so every target is pane-bound. */
    const editorBound = !!(target.sectionId || target.assetId || target.manualId || target.refId);
    /* The narrow stacked split shows ONE pane, and the hidden one is display:none —
       a jump into the editor there would scroll a box with no layout. */
    if (editorBound) setStackPane('editor');
    if (target.assetId || target.manualId) {
      if (target.sectionId) {
        openAsset({ sectionId: target.sectionId, assetId: target.assetId, manualId: target.manualId });
        return;
      }
      /* 121.md r2 — a GENERATED table/figure is not anchored in the prose, so it has
         no sectionId and `openAsset` cannot route it — yet the control was rendered
         anyway and did nothing (stale-asset and included-not-mentioned are the common
         classes). The object still HAS a home: the Tables & Figures panel, which is
         literally where these entries' own action text sends the researcher ("Add a
         title or caption in the Tables & Figures panel", "exclude it from the
         export"). `kind` is carried by the target from the producing site so this is
         not an id-string guess. */
      setTab(target.kind === 'figure' ? 'figures' : 'tables');
      return;
    }
    if (target.sectionId) { openSection(target.sectionId); return; }
    // A finding about the LIBRARY (incomplete metadata, probable duplicates) is not
    // anchored in the prose at all; the References panel is where it is fixed.
    if (target.refId) { openReference(target.refId, 'view'); return; }
  }, [openAsset, openSection, openReference, setTab]);

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
        // 119.md §5 — how the builder fetches an uploaded figure's bytes (through
        // the authenticated raw route). Without it a picture would export as the
        // honest "could not be embedded" note instead of the actual image.
        figureBlobUrl: model.figureBlobUrl,
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
      // 119.md §5 — the bundled manuscript embeds uploaded pictures too: the LIVE
      // registry (which knows which figures are placed) plus the authenticated byte
      // resolver. Without both, the bundle's .docx would carry the honest
      // "could not be embedded" note where the downloaded one carries the image.
      assets: m.assets,
      figureBlobUrl: (a) => (a && a.figureId ? m.figureRawUrl(a.figureId) : null),
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

  /* ── 120.md §6 — the Writing Assistant ───────────────────────────────────────
     Instantiated HERE because this is the only level with both halves of what it
     needs: the raw project blob (title/question/PICO/studies → the project-aware
     lexicon) and the manuscript hook (the live sections it checks, the references
     and captions it learns from). Its chip goes up into the toolbar's Level-A right
     group; its decorations, its suggestion card and its editor registrations go down
     into EditorPanel. One hook, two consumers, no duplicated state.

     `available` is the OPS flag — availability only. The feature itself stays off for
     every user until they turn it on (§6), which is the `prefs.enabled` the hook
     reads from User.writingAssistant. Fail-closed: a failed settings fetch means the
     control simply does not appear. */
  const [waAvailable, setWaAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    publicFeatureFlags()
      .then((flags) => { if (alive) setWaAvailable(!!(flags && flags.writingAssistant === true)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  /* The LIVE draft (pending, pre-autosave edits overlaid) is what the researcher can
     see, so it is what gets checked — an underline must appear under the sentence
     they are looking at, not under the version that last reached the server. */
  const waLive = m.liveDraft || m.activeDraft || {};
  const waSections = useMemo(() => {
    const secs = (waLive && waLive.sections) || {};
    const out = {};
    for (const id of Object.keys(secs)) out[id] = (secs[id] && secs[id].content) || '';
    return out;
  }, [waLive]);
  /* Memoized on the four STABLE inputs, never on the whole `m` surface (a fresh
     object every keystroke) — see buildWaProjectShape's own note. The keyword list is
     keyed by its joined text so a re-created array with identical contents does not
     count as a change. */
  const waKeywordSig = ((m.activeDraft && m.activeDraft.keywords) || []).join('|');
  const waProjectShape = useMemo(() => buildWaProjectShape(project, {
    references: m.references,
    tables: m.tables,
    figures: m.figures,
    keywords: waKeywordSig ? waKeywordSig.split('|') : [],
  }), [project, m.references, m.tables, m.figures, waKeywordSig]);

  const wa = useWritingAssistant({
    available: waAvailable,
    userId,
    projectId,
    docId: `${projectId}:${m.activeId || ''}`,
    sections: waSections,
    projectShape: waProjectShape,
  });

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
    <div data-testid="stitch-manuscript-workspace"
      /* 121.md §2 — three states, not two: the ordinary reading column, the wide
         split column, and the BOUNDED split column the host has taken full-bleed. */
      data-fills={splitFills ? 'true' : undefined}
      style={splitFills ? SPLIT_SHELL_BOUNDED : splitOpen ? SPLIT_SHELL_STYLE : SHELL_STYLE}>
      {/* 120.md §8 — the toolbar is told the DESTINATION, which is the projection of
          the panel and the pane. 119.md §4's separate `splitToggle` is deliberately
          NOT passed any more: one state must have one control, and §8 puts that
          control in the navigation. The slot itself stays in the toolbar's signature
          (and ManuscriptSplitToggle stays exported) for hosts that have no tablist. */}
      <ManuscriptToolbar m={m} tab={destination} onTabChange={setTab}
        /* 119.md §7 — "Structure: <name> ▾" opens the preview/diff/mapping dialog. */
        onOpenStructure={openStructure}
        /* 118.md §12 — the documented right-hand slot, filled. It renders on the
           Editor and PDF View destinations (the toolbar enforces that) and condenses
           with the rest of Level B. 120.md §2 — `onDark` is the toolbar telling the
           control which surface it landed on. */
        viewSwitcher={({ condensed, onDark }) => (
          <ManuscriptViewSwitcher view={view} onChange={setView} condensed={condensed} onDark={onDark} />
        )}
        /* 120.md §6 — the Writing Assistant chip. Same node-or-function slot
           contract as the view switcher; the toolbar owns the Editor/PDF-View gate
           and tells the control which surface it landed on. */
        writingAssistant={({ condensed, onDark }) => (
          <WritingAssistantControl wa={wa} condensed={condensed} onDark={onDark} />
        )} />

      {/* 119.md §7 — the structure switcher, and the in-context undo the switch
          leaves behind. Both sit above the panels: the undo bar must stay visible
          from whichever destination the researcher lands on after applying. */}
      {structureOpen && <StructureSwitcher m={m} onClose={() => setStructureOpen(false)} />}
      {m.lastStructureChange && (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <StructureChangeUndo m={m} />
        </div>
      )}

      {/* 85.md B2 — pre-export validation review. 118.md keeps it mounted ABOVE
          every panel so it is visible from whichever destination started the export.
          121.md §3 — and now it shares ONE live region with the run-error banner: a
          single announced, focusable, scrolled-to surface, because two of them would
          make a screen reader say the same failure twice. The four per-panel
          exportError InfoBoxes stay as UNANNOUNCED echoes (no role, no aria-live) so
          the message is also local to where the button was pressed. */}
      {(exportError || exportReview) && (
        <ExportFeedbackRegion
          regionRef={exportFeedbackRef}
          blocked={exportBlocked}
          headingId={EXPORT_FEEDBACK_HEADING_ID}
          /* In the bounded split column the region is a flex sibling of the split
             row, so a long list of findings must scroll inside itself rather than
             squeeze the writing surface out of the viewport. */
          style={splitFills ? { flexShrink: 0, maxHeight: '38vh', overflowY: 'auto' } : undefined}>
          {exportError && (
            <ExportRunErrorNotice message={exportError}
              headingId={EXPORT_FEEDBACK_HEADING_ID} headingRef={exportHeadingRef} />
          )}
          <ExportValidationDialog review={exportReview} exporting={exporting}
            onExportAnyway={onExportAnyway} onClose={() => setExportReview(null)}
            /* The heading the reveal focuses is the FIRST one in the region: a failed
               run outranks a review, because it is the thing that just happened. */
            headingId={exportError ? undefined : EXPORT_FEEDBACK_HEADING_ID}
            headingRef={exportError ? undefined : exportHeadingRef}
            onGoTo={goToFinding} />
        </ExportFeedbackRegion>
      )}

      {/* 119.md §4 — the split ROW. Rendered in BOTH states on purpose: the editor
          pane below is always this row's first child, so toggling the PDF pane only
          appends siblings after it and changes styles. React therefore keeps the whole
          editor subtree mounted — which is the entire mechanism behind §4's "opening,
          closing, or resizing the PDF must not reload the manuscript, reset the
          manuscript cursor, discard unsaved changes or break autosave". */}
      <div
        ref={splitRowRef}
        data-testid="stitch-manuscript-split"
        data-split={splitOpen ? 'on' : 'off'}
        data-layout={splitOpen ? splitLayout : 'off'}
        data-ratio={splitOpen ? Math.round(split.ratio * 100) : undefined}
        style={splitOpen && splitLayout === 'split' ? {
          display: 'grid',
          // minmax(0, …) on BOTH panes is what keeps a long title or a wide table from
          // widening its column — §4 forbids nested horizontal scrolling.
          gridTemplateColumns: `minmax(0, var(--ms-editor-pct, 50%)) ${SPLIT_DIVIDER_PX}px minmax(0, 1fr)`,
          /* 121.md §2 — in the bounded column the row IS the remaining height, one
             explicit row track, and both panes stretch to fill it. Outside it the row
             keeps 119 §4's content-height behaviour exactly. */
          ...(splitFills ? {
            flex: '1 1 0%', minHeight: 0,
            gridTemplateRows: 'minmax(0, 1fr)',
            alignItems: 'stretch',
          } : { alignItems: 'start' }),
        } : { display: 'block' }}
      >
        {/* §4 responsive floor — below ~1024px the row shows ONE pane at a time
            instead of two unusable columns, and this is how the other one comes back.
            Always rendered (stable positions), shown only in the stacked layout. */}
        <div
          data-testid="stitch-manuscript-split-panes"
          role="radiogroup"
          aria-label="Visible pane"
          style={{
            display: splitOpen && splitLayout === 'stacked' ? 'flex' : 'none',
            gap: 2, padding: 2, marginBottom: 8, alignSelf: 'start',
            background: C.card2, border: `1px solid ${C.brd}`, borderRadius: 8, width: 'fit-content',
          }}
        >
          {[{ id: 'editor', label: 'Manuscript' }, { id: 'pdf', label: 'PDF' }].map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={stackPane === p.id ? 'true' : 'false'}
              data-testid={`stitch-manuscript-split-pane-${p.id}`}
              data-active={stackPane === p.id ? 'true' : undefined}
              onClick={() => {
                if (stackPane === p.id) return;
                if (m.flush) m.flush();     // a layout transition, so it owes a flush
                setStackPane(p.id);
              }}
              style={{
                height: 26, padding: '0 12px', borderRadius: 6, cursor: 'pointer',
                background: stackPane === p.id ? C.card : 'transparent',
                border: `1px solid ${stackPane === p.id ? 'var(--t-acc)' : 'transparent'}`,
                color: stackPane === p.id ? 'var(--t-acc)' : C.txt2,
                fontSize: 11.5, fontWeight: stackPane === p.id ? 700 : 600,
                fontFamily: "'IBM Plex Sans',sans-serif",
              }}
            >{p.label}</button>
          ))}
        </div>

        {/* The EDITOR pane. This wrapper exists in both layouts and never moves.
            121.md §2 — in the bounded column it becomes its OWN scroller: the prose
            scrolls inside the pane while the ribbon stays put and the PDF beside it
            never moves, which is what removes the page-level scroll the old
            `calc(100vh - …)` pane was fighting. */}
        <div
          data-testid="stitch-manuscript-split-editor"
          style={{
            minWidth: 0,
            display: (splitOpen && splitLayout === 'stacked' && stackPane === 'pdf') ? 'none' : 'block',
            ...(splitFills ? { height: '100%', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' } : null),
          }}
        >
          {/* panels — the tablist's one tabpanel (118.md §42). */}
          <div
            id={MS_PANEL_ID}
            role="tabpanel"
            /* 120.md §8 — labelled by the SELECTED tab, which on the Editor panel is
               'PDF View' whenever the pane is open. */
            aria-labelledby={msTabDomId(destination)}
            data-testid="stitch-manuscript-panel"
            style={{ maxWidth: (splitOpen || tab === 'editor') ? 'none' : 900, margin: '0 auto' }}
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
                onOpenReference={openReference}
                /* 120.md §6 — the assistant's editor half: root registration for the
                   decoration layer, api registration for the one apply path, the
                   caret's section, and the suggestion card. */
                wa={wa} />
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
            {tab === 'export' && <ExportPanel m={m} exporters={exporters} onNavigate={setTab} onOpenStructure={openStructure} />}
          </div>
        </div>

        {/* 119.md §4 — the divider and the PDF pane, appended AFTER the editor pane so
            their presence can never shift it. The pane stays MOUNTED in the stacked
            layout (hidden) so switching back to it keeps the open document. */}
        {splitOpen && splitLayout === 'split' && <SplitResizeDivider split={split} reduced={reducedMotion} />}
        {/* 120.md §8 — mounted from the first time the pane is opened and NEVER
            unmounted afterwards (see `splitMounted`): closing it hides it, so the
            keep-alive viewer pool, the selected study, the page and the zoom are all
            still there when PDF View is chosen again. */}
        {splitMounted && (
          <PdfSplitPane
            projectId={projectId}
            articles={articles}
            activeArticle={activeArticle}
            activeReportId={reportId}
            onPickArticle={pickArticleId}
            onPickReport={pickReportId}
            resolved={m.referencePdfIds}
            screenProjectId={m.screenProjectId}
            /* §4 — "Opening the existing article record or PDF association": the
               References library owns reference records, so this is the SAME seam a
               citation chip uses, not a second record surface. */
            onOpenRecord={(a) => openReference(a.id, 'view')}
            onExit={exitSplit}
            split={split}
            layout={splitLayout}
            /* 121.md §2 — "the PDF viewer must completely fill its assigned pane".
               In the bounded column the pane is simply 100% of a measured box, so
               every resize trigger the prompt lists (fullscreen enter/exit, window
               resize, divider drag, a drawer pinned or unpinned) reaches the viewer
               through flex and the pane's existing ResizeObserver — no vh math. */
            bounded={splitFills}
            hidden={!splitOpen || (splitLayout === 'stacked' && stackPane !== 'pdf')}
          />
        )}
      </div>
    </div>
  );
}

export default ManuscriptWorkspace;
