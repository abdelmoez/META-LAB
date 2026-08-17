/**
 * features/manuscript/manuscriptPanels.jsx — 64.md (P3). Presentational panels for
 * the Manuscript workspace sub-tabs (Overview / Editor / Tables / Figures /
 * References / PRISMA / Export). PURE UI: every datum comes from the already-tested
 * `useManuscript` hook + pure engine; this file owns ZERO business logic. Styled with
 * the legacy token system only (Stitch auto-remaps --t-*), so it renders in both shells.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { C, btnS, inp, tagS } from '../../frontend/workspace/ui/styles.js';
import { InfoBox } from '../../frontend/workspace/ui/primitives.jsx';
import { Icon } from '../../frontend/components/icons.jsx';
import { alpha } from '../../frontend/theme/tokens.js';
// 108.md §23 — the ONE keyboard router. Replaces this file's ad-hoc window keydown
// listener (which also had no dependency array — see the binding below).
import { useShortcut, TIER } from '../../frontend/shortcuts/ShortcutProvider.jsx';
import {
  SECTION_TYPES, STATEMENT_TYPES, CITATION_STYLES, JOURNAL_TEMPLATES, sectionStatus,
  draftSectionTypes, draftSectionIds, draftSectionLabel, draftStructure,
  collectCitationOrder, draftSectionTexts, studySelectionParagraph,
  explainKeys, SECTION_DEPENDENCIES,
  // 85.md B2 — structured asset references (tokens ↔ live numbering).
  assetToken,
  // 117.md §4-§11 — cross-reference counting + the ONE caption/label formatter.
  countAssetMentions, formatAssetLabel, assetKindLabel,
  // 118.md §65 — where a table/figure actually sits in the live manuscript text.
  findAssetTokens, orderedSections,
  // 101.md §34 — locate the section that states a given project fact.
  factToken,
  // 117.md §21/§22 — the ONE registry of overridable PRISMA boxes + its labels, so
  // the panel, the counts adapter and the audit log cannot list different fields.
  PRISMA_OVERRIDE_FIELDS, prismaOverrideLabel,
} from '../../research-engine/manuscript/index.js';
// 117.md §26-§39 — the reference-library vocabulary the panel renders: the §28 type
// taxonomy + its per-type field reveal, and the §33 search/filter/sort helpers.
import {
  REFERENCE_TYPES, DEFAULT_REFERENCE_TYPE, referenceTypeLabel, fieldsForType,
  filterReferenceRows, sortReferences, collectReferenceTags, REFERENCE_SORTS,
} from '../../research-engine/manuscript/referenceLibrary.js';
import { authorYearLabel } from '../../research-engine/manuscript/citations.js';
// 121.md §3 — "is this finding anchored to something the editor can navigate to?",
// as ONE pure rule the dialog and its tests both read.
import { findingTarget } from '../../research-engine/manuscript/exportValidation.js';
// 117.md §J.3 — decorate references with the PDF attachment the lazy resolver found,
// so "Open PDF" appears exactly when a PDF really is reachable.
import { withResolvedPdfIds } from './referencePdfLinks.js';
import {
  RichSectionEditor, RichToolbar, RICH_EDITOR_CSS, CrossRefPicker, CrossRefList,
  CiteRefPicker, citeItemOf,
} from './richEditor/RichSectionEditor.jsx';
/* 121.md §4:168 — the ONE editor-safe insertion utility. The picker-session lifecycle
   (bookmark on open, clear on cancel, route to the bookmarked section on insert) is
   its pure half; this layer supplies only the app knowledge it needs. */
import { createInsertionSession } from './richEditor/insertionSession.js';
// 120.md §6 — the Writing Assistant's editor-side surface: the anchored suggestion
// card and the stylesheet carrying the four ::highlight() registrations.
import { WritingAssistantCard, WA_UI_CSS } from './writingAssistant/WritingAssistantCard.jsx';
// 101.md §34 — the optional "recent manuscript updates" panel paired with Show Changes.
import { ChangeTrackingPanel } from './ChangeTrackingPanel.jsx';
// 119.md §7 — the guideline/journal provenance renderers and the ONE no-compliance
// wording, shared with the structure switcher so both surfaces say the same thing.
import { StructureProvenance, JournalProfileNotes, NO_COMPLIANCE_NOTE } from './StructureSwitcher.jsx';
// 102.md §2/§5 — the manual-field counter, prev/next controls and section list.
import { ManualFieldsPanel } from './ManualFieldsPanel.jsx';
import { AbstractEditor } from './richEditor/AbstractEditor.jsx';
// 118.md §28-§40/§70 — the Overview is its own component family now (readiness,
// needs-attention, structure, connected data, the submission checklist). This file
// only mounts it; every Overview concern lives in ManuscriptOverview.jsx.
import { ManuscriptOverview } from './ManuscriptOverview.jsx';
// r2 (118.md §32) — ONE section-status rule + ONE chip palette, shared with the
// Overview. This file used to carry a second copy whose tones had already drifted.
import { sectionRowStatus } from './sectionStatusRule.js';
// 119.md §6 — the demographics cell vocabulary (statistic types + the four empty
// states). The manuscript RENDERS them; extraction owns them.
import {
  statType, DEFAULT_STAT_TYPE, DEMOGRAPHIC_VALUE_STATES,
} from '../../research-engine/extraction/demographics.js';
import { extractOutline, mdToHtml } from './richEditor/mdDom.js';
// 118.md §10-§19 — the Continuous Document View and the scroll / active-section
// mechanics this panel's outline shares with it. The dependency is ONE-WAY
// (ContinuousView never imports from here), so the editor's shared primitives stay
// in one place and the document view stays a leaf module.
import {
  ContinuousView, scrollToSectionId, scrollSectionIntoView, msSectionSelector, prefersReducedMotion,
  useStickyBarHeight, useElementWidth, OUTLINE_STICKY_MIN_WIDTH,
  // r3 — ONE title block for both views (it lives with the document primitives and
  // the canonical INK palette; this file renders it for Section View).
  TitleBlock,
} from './ContinuousView.jsx';
// 67.md — Word (.docx) export is a Plus-plan feature (server-enforced). This is
// UX-only, fail-open: only disable the button once we KNOW the plan lacks it.
import { useEntitlements } from '../../frontend/entitlements';

const WORD_EXPORT_LOCKED_MSG = 'Word export is available on the Plus plan and above.';

/* ════════════ shared bits ════════════ */

/**
 * 101.md §34 — "Clicking an item could navigate directly to the affected
 * manuscript text". A change identifies a FACT KEY; a fact can be stated in more
 * than one section (a count usually appears in both Results and the Abstract), so
 * this returns the FIRST section that states it, in canonical manuscript order.
 * Returns '' when the fact is no longer stated anywhere.
 */
export function sectionStatingFact(draft, factKey) {
  if (!draft || !factKey) return '';
  const token = factToken(factKey);
  const secs = draft.sections || {};
  // 119.md §7 — "in canonical manuscript order" is the DRAFT'S order now.
  for (const s of draftSectionTypes(draft)) {
    const content = (secs[s.id] && secs[s.id].content) || '';
    if (content.includes(token)) return s.id;
  }
  return '';
}

export function Select({ value, onChange, children, style, ...rest }) {
  return (
    <select value={value} onChange={onChange}
      style={{ ...inp, width: 'auto', cursor: 'pointer', paddingRight: 28, ...style }} {...rest}>
      {children}
    </select>
  );
}

export function Labeled({ label, children, style }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>{label}</span>
      {children}
    </label>
  );
}

function Card({ children, style, ...rest }) {
  return <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 16, ...style }} {...rest}>{children}</div>;
}

function Block({ title, children, right, desc }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: desc ? 4 : 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.txt }}>{title}</h3>
        {right}
      </div>
      {desc && <p style={{ margin: '0 0 10px', fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>{desc}</p>}
      {children}
    </div>
  );
}

/* The WYSIWYG converters (markdown ⇄ HTML, escape-first) live in
   ./richEditor/mdDom.js — the editor IS the preview (65.md MS-CORE). */

/* ── generic engine-table renderer ── */
const cellTh = { padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: C.muted, background: C.bg, borderBottom: `1px solid ${C.brd}`, whiteSpace: 'nowrap' };
const cellTd = { padding: '8px 12px', fontSize: 12, color: C.txt2, borderBottom: `1px solid ${C.brd}`, verticalAlign: 'top' };

export function DataTable({ table }) {
  if (!table) return null;
  if (!table.available) {
    return <InfoBox color={C.muted}>{table.note || 'Not enough data to build this table yet.'}</InfoBox>;
  }
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${C.brd}`, borderRadius: 10 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>{table.columns.map((c) => <th key={c.key} style={cellTh}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {(table.rows || []).map((row, i) => (
            <tr key={i}>
              {table.columns.map((c) => {
                const v = row[c.key];
                return <td key={c.key} style={cellTd}>{v == null || v === '' ? '—' : String(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── lazy figure SVGs (forest / prisma) ── */
function useFigureSvgs(m, { forest = false, prisma = false }) {
  const [state, setState] = useState({ forest: null, prisma: null, loading: true, error: '' });
  const primaryResult = m.primary && m.primary.result;
  const esType = m.primary && m.primary.pair && m.primary.pair.esType;
  // 116.md §26/§32 — the preview shows the persisted axis name / favours texts, so it
  // is the same figure the export writes (primaryAnalysis resolves them onto the entry).
  const figure = (m.primary && m.primary.figure) || null;
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    (async () => {
      try {
        const fig = await import('./export/figures.js');
        const next = { forest: null, prisma: null, loading: false, error: '' };
        if (prisma) next.prisma = fig.prismaSvg(m.prismaCounts);
        if (forest && primaryResult) next.forest = fig.forestSvg(primaryResult, { esType, ...(figure || {}) });
        if (alive) setState(next);
      } catch (e) {
        if (alive) setState({ forest: null, prisma: null, loading: false, error: (e && e.message) || 'Could not render figures.' });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forest, prisma, primaryResult, esType, figure, m.prismaCounts]);
  return state;
}

function SvgBox({ svg }) {
  return (
    <div style={{ overflow: 'auto', maxHeight: 540, background: '#ffffff', borderRadius: 10, border: `1px solid ${C.brd}`, padding: 12 }}
      dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

/* ── reusable export-button group ── */
export function ExportButtons({ exporters, canonical }) {
  const { onExportWord, onExportRepro, onPrismaChecklist, onPrismaSChecklist, exporting, exportProgress } = exporters;
  const ent = useEntitlements();
  const wordLocked = !ent.loading && !ent.has('manuscript.wordExport');
  const busy = (k) => exporting === k;
  // 85.md B2 — the Word button narrates figure rasterization ("Rendering figure 2/5…").
  const lbl = (k, base) => (busy(k) ? ((k === 'word' && exportProgress) || 'Generating…') : base);
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <button onClick={onExportWord} disabled={!!exporting || wordLocked}
        title={wordLocked ? WORD_EXPORT_LOCKED_MSG : undefined}
        data-testid={canonical ? 'stitch-manuscript-export-word' : undefined}
        style={{ ...btnS('primary'), opacity: (exporting || wordLocked) ? 0.6 : 1, cursor: wordLocked ? 'not-allowed' : undefined }}>
        <Icon name="fileText" size={13} /> {lbl('word', 'Export Word')}
      </button>
      <button onClick={onExportRepro} disabled={!!exporting}
        data-testid={canonical ? 'stitch-manuscript-export-repro' : undefined}
        style={{ ...btnS('ghost'), opacity: exporting ? 0.6 : 1 }}>
        <Icon name="download" size={13} /> {lbl('repro', 'Reproducibility .zip')}
      </button>
      <button onClick={onPrismaChecklist} disabled={!!exporting}
        style={{ ...btnS('ghost'), opacity: exporting ? 0.6 : 1 }}>
        <Icon name="checkSquare" size={13} /> {lbl('prisma', 'PRISMA checklist')}
      </button>
      <button onClick={onPrismaSChecklist} disabled={!!exporting}
        style={{ ...btnS('ghost'), opacity: exporting ? 0.6 : 1 }}>
        <Icon name="checkSquare" size={13} /> {lbl('prismaS', 'PRISMA-S checklist')}
      </button>
    </div>
  );
}

/* ════════════ 85.md B2 — pre-export validation review ════════════ */

const fmtFetched = (iso) => { try { return iso ? new Date(iso).toLocaleTimeString() : null; } catch { return null; } };

/* ════════════ 121.md §3 — the ONE announced export feedback surface ════════════
   §3's complaint is that "an export error or warning may appear near the top of the
   page while the user remains lower on the page". The fix is not a toast (§3 forbids
   relying on one) and not a second copy of the message: it is ONE region, at the
   workspace seam that already owns both feedback states, which is announced, focused
   and scrolled to.

   Why one region and not per-surface roles: a live region per panel would make a
   screen reader announce the same failed export two to four times (the run-error
   InfoBox exists in four panels). The four panel copies therefore stay EXACTLY as
   they are — no role, no aria-live, unannounced echoes local to the button that was
   pressed — and everything assistive happens here. */

/** The id the region is labelled by, and the heading the reveal moves focus to. */
export const EXPORT_FEEDBACK_HEADING_ID = 'ms-export-feedback-heading';

/**
 * @param {object}  props
 * @param {object}  props.regionRef  the workspace's ref — the element the reveal scrolls to.
 * @param {boolean} props.blocked    true when nothing was exported and cannot be until
 *                                   something is fixed. Decides the politeness ONLY.
 *
 * role="alert" (implicitly assertive) for blocking failures — the repo's
 * Workspace.jsx / waitlist precedent — and role="status" (polite) for a warnings-only
 * review or an informational notice, which is what §3's "an appropriate status or
 * alert behavior depending on whether they block export" asks for. The old
 * role="alertdialog" on the review Card is GONE (see ExportValidationDialog): it is
 * not a modal, nothing traps focus in it, and telling a screen reader "dialog" about
 * an in-flow card is worse than saying nothing.
 */
export function ExportFeedbackRegion({ regionRef, blocked, headingId, style, children }) {
  return (
    <div
      ref={regionRef}
      data-testid="stitch-manuscript-export-feedback"
      data-tone={blocked ? 'blocking' : 'advisory'}
      role={blocked ? 'alert' : 'status'}
      aria-live={blocked ? 'assertive' : 'polite'}
      aria-atomic="false"
      aria-labelledby={headingId}
      style={{ maxWidth: 900, margin: '0 auto', ...style }}
    >
      {children}
    </div>
  );
}

/**
 * 121.md §3 — the run-error banner, hoisted from the four panels to the workspace
 * seam so there is exactly one element a reveal effect can target and exactly one
 * announcement point. Says what happened and what to do next, which is §3's
 * "explain what happened … and provide an actionable next step"; there is no
 * per-item target because a failed RUN is about the export, not about one object.
 */
export function ExportRunErrorNotice({ message, headingId, headingRef }) {
  if (!message) return null;
  return (
    <Card data-testid="stitch-manuscript-export-error"
      style={{ marginBottom: 18, borderColor: C.red, borderLeft: `3px solid ${C.red}` }}>
      <h3 id={headingId} ref={headingRef} tabIndex={-1}
        data-testid="stitch-manuscript-export-error-heading"
        style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.txt, outline: 'none' }}>
        Export failed — nothing was downloaded
      </h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', padding: '6px 0' }}>
        <span style={{ ...tagS('red'), flexShrink: 0 }}>Blocks export</span>
        <span style={{ flex: '1 1 280px', minWidth: 0, fontSize: 12, color: C.txt2, lineHeight: 1.6 }}>
          {message}
          <span style={{ display: 'block', fontSize: 11, color: C.muted }}>
            Fix the problem and run the export again — this message stays until you do.
          </span>
        </span>
      </div>
    </Card>
  );
}

/**
 * Pre-export validation review (85.md B2). Shown ONLY when validateExport found
 * something: errors BLOCK the export (each with an action hint); warnings offer
 * "Export anyway" / "Fix first". A clean report never mounts this — the export
 * stays one-click.
 */
export function ExportValidationDialog({
  review, onExportAnyway, onClose, exporting,
  // 121.md §3 — supplied when the dialog renders inside ExportFeedbackRegion: the
  // heading becomes the region's label and the reveal's focus target.
  headingId, headingRef,
  // 121.md §3 — "provide a control that navigates directly to it". Absent (a host
  // that cannot navigate) → no buttons, which is the honest degrade.
  onGoTo,
}) {
  if (!review || !review.validation) return null;
  const v = review.validation;
  const errors = v.errors || [];
  const warnings = v.warnings || [];
  const info = v.info || [];
  const blocked = errors.length > 0;
  const fetched = fmtFetched(review.fetchedAt);
  const row = (e, tone, i, prefix) => {
    /* Statement-anchored citation findings carry a `statementKey` and no section:
       `statement:<key>` is not a place openSection can go, so findingTarget returns
       null and the control is OMITTED rather than offered and then doing nothing. */
    const target = onGoTo ? findingTarget(e) : null;
    return (
      <div key={`${prefix}-${e.code}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', padding: '6px 0' }}>
        <span style={{ ...tagS(tone), flexShrink: 0 }}>{tone === 'red' ? 'Blocks export' : tone === 'yellow' ? 'Check' : 'Note'}</span>
        <span style={{ flex: '1 1 280px', minWidth: 0, fontSize: 12, color: C.txt2, lineHeight: 1.6 }}>
          {e.message}
          {e.action && <span style={{ display: 'block', fontSize: 11, color: C.muted }}>{e.action}</span>}
        </span>
        {target && (
          <button type="button"
            data-testid={`stitch-manuscript-export-goto-${prefix}-${i}`}
            data-code={e.code}
            onClick={() => onGoTo(target)}
            title="Open the part of the manuscript this is about"
            style={{ ...btnS('ghost'), fontSize: 10.5, padding: '3px 9px', flexShrink: 0 }}>
            Go to it
          </button>
        )}
      </div>
    );
  };
  return (
    /* 121.md §3 — role="alertdialog" REMOVED (deliberate, see ExportFeedbackRegion):
       this Card is an in-flow panel, not a modal, and nothing ever moved focus into
       it or trapped focus in it. The announcement now belongs to the one live region
       this renders inside. */
    <Card data-testid="stitch-manuscript-export-validation"
      aria-label="Export check results"
      style={{ marginBottom: 18, borderColor: blocked ? C.red : C.yel, borderLeft: `3px solid ${blocked ? C.red : C.yel}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h3 id={headingId} ref={headingRef} tabIndex={headingId ? -1 : undefined}
          data-testid="stitch-manuscript-export-validation-heading"
          style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.txt, outline: 'none' }}>
          {blocked ? 'Export blocked — fix these first' : 'Check before you export'}
        </h3>
        {fetched && (
          <span data-testid="stitch-manuscript-export-fetchedat" style={{ fontSize: 10.5, color: C.muted }}>
            Live data refreshed at {fetched}
          </span>
        )}
      </div>
      {review.recheck && (
        <div data-testid="stitch-manuscript-export-recheck"
          style={{ fontSize: 11.5, color: C.txt2, marginBottom: 6 }}>
          Your latest edits were re-checked before exporting — new blocking problems were found, so nothing was exported.
        </div>
      )}
      {errors.map((e, i) => row(e, 'red', i, 'err'))}
      {warnings.map((e, i) => row(e, 'yellow', i, 'warn'))}
      {info.map((e, i) => row(e, 'gray', i, 'info'))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {!blocked && (
          <button onClick={onExportAnyway} disabled={!!exporting}
            data-testid="stitch-manuscript-export-anyway"
            style={{ ...btnS('primary'), fontSize: 11, opacity: exporting ? 0.6 : 1 }}>
            <Icon name="fileText" size={12} /> Export anyway
          </button>
        )}
        <button onClick={onClose} data-testid="stitch-manuscript-export-fix-first"
          style={{ ...btnS('ghost'), fontSize: 11 }}>
          {blocked ? 'Close' : 'Fix first'}
        </button>
      </div>
    </Card>
  );
}

/* ════════════ 84.md — live sync: freshness pill + Updates review ════════════ */

/** Overall freshness → pill tone. synced=green, warnings/missing=yellow,
    updates=blue, critical=red, unknown=gray. */
const FRESHNESS_TONE = {
  synced: 'green', warnings: 'yellow', updates: 'blue',
  'missing-info': 'yellow', critical: 'red', unknown: 'gray',
};

/** Dependency category → chip tone (84.md severity colouring). */
const CATEGORY_TONE = { critical: 'red', methods: 'blue', numerical: 'yellow', wording: 'gray' };

export function FreshnessPill({ freshness, style }) {
  if (!freshness) return null;
  return (
    <span data-testid="stitch-manuscript-freshness"
      title="How closely the manuscript matches the current project data"
      style={{ ...tagS(FRESHNESS_TONE[freshness.status] || 'gray'), ...style }}>
      {freshness.label || 'Sync status'}
    </span>
  );
}

const previewBox = {
  background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8,
  padding: '10px 12px', fontSize: 12, color: C.txt2, lineHeight: 1.6,
  overflow: 'auto', maxHeight: 240, minWidth: 0, flex: '1 1 260px',
};

/** CURRENT vs PROPOSED preview — input is our own markdown, rendered through the
    same escape-first mdToHtml sanitizer the editor uses. */
function DiffPreview({ current, proposed }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '10px 0' }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>Current</div>
        <div style={previewBox} dangerouslySetInnerHTML={{ __html: mdToHtml(current || '') || '<em>Empty</em>' }} />
      </div>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.acc, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>Proposed</div>
        <div data-testid="stitch-manuscript-update-proposed" style={previewBox}
          dangerouslySetInnerHTML={{ __html: mdToHtml(proposed || '') || '<em>Empty</em>' }} />
      </div>
    </div>
  );
}

const sectionLabel = (id) => (SECTION_TYPES.find((s) => s.id === id) || {}).label || id;

function UpdateCard({ entry, m, onOpenSection }) {
  const id = entry.sectionId;
  const detachConfirm = 'Detach stops this section from auto-updating when the project data changes. You can Relink it later. Continue?';
  const onDetach = () => { if (typeof window === 'undefined' || window.confirm(detachConfirm)) m.decide(id, 'detach'); };
  return (
    <Card data-testid={`stitch-manuscript-update-${id}`} style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.txt }}>{sectionLabel(id)}</h3>
        {entry.detached ? (
          <span style={tagS('gray')}>Detached</span>
        ) : entry.locked ? (
          <span style={tagS('yellow')}><Icon name="lock" size={9} /> Locked</span>
        ) : entry.syncState === 'edited' ? (
          <span style={tagS('yellow')}>Manually edited — review required</span>
        ) : (
          <span style={tagS('blue')}>Update available</span>
        )}
      </div>

      {/* reason chips — WHY this is out of date, coloured by severity */}
      {Array.isArray(entry.reasons) && entry.reasons.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {entry.reasons.map((r) => <span key={r.key} style={tagS(CATEGORY_TONE[r.category] || 'gray')}>{r.label}</span>)}
        </div>
      )}

      {entry.locked && (
        <InfoBox color={C.yel}>
          <strong>This section is locked.</strong> The project data behind it changed, so the locked text <strong>may now be inaccurate</strong>. Unlock it in the Editor to accept the update.
        </InfoBox>
      )}
      {entry.interpretive && (
        <div data-testid={`stitch-manuscript-update-interpretive-${id}`}
          style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, marginBottom: 6 }}>
          Interpretive section — review carefully; never auto-applied.
        </div>
      )}

      <DiffPreview current={entry.current} proposed={entry.proposed} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => m.decide(id, 'accept')} disabled={!!entry.locked}
          data-testid="stitch-manuscript-update-accept"
          title={entry.locked ? 'Unlock this section in the Editor to accept the update' : 'Replace the current text with the proposed update'}
          style={{ ...btnS('primary'), fontSize: 11, opacity: entry.locked ? 0.5 : 1, cursor: entry.locked ? 'not-allowed' : undefined }}>
          <Icon name="check" size={12} /> Accept update
        </button>
        <button onClick={() => m.decide(id, 'keep')} style={{ ...btnS('ghost'), fontSize: 11 }}>
          Keep my wording
        </button>
        {entry.detached ? (
          <button onClick={() => m.decide(id, 'relink')} style={{ ...btnS('ghost'), fontSize: 11 }}>
            <Icon name="refresh" size={12} /> Relink
          </button>
        ) : (
          <button onClick={onDetach} style={{ ...btnS('ghost'), fontSize: 11 }}>
            Detach
          </button>
        )}
        {/* 118.md §64 — read the section where it lives before deciding. The Editor
            scrolls to it in Continuous View and opens it in Section View; either
            way this is the SAME section, not a copy of it. */}
        {onOpenSection && (
          <button onClick={() => onOpenSection(id)}
            data-testid={`stitch-manuscript-update-view-${id}`}
            title={`Open ${sectionLabel(id)} in the manuscript editor`}
            style={{ ...btnS('ghost'), fontSize: 11 }}>
            <Icon name="pencil" size={12} /> View in manuscript
          </button>
        )}
      </div>
    </Card>
  );
}

function ContradictionsCard({ items }) {
  const sorted = [...(items || [])].sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1));
  return (
    <Card data-testid="stitch-manuscript-contradictions" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <span style={{ ...tagS(c.severity === 'critical' ? 'red' : 'yellow'), flexShrink: 0 }}>
              {c.severity === 'critical' ? 'Critical' : 'Check'}
            </span>
            {c.section && <span style={{ ...tagS('gray'), flexShrink: 0 }}>{sectionLabel(c.section)}</span>}
            <span style={{ fontSize: 12, color: C.txt2, lineHeight: 1.6, flex: '1 1 240px' }}>{c.message}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MissingInfoCard({ items }) {
  return (
    <Card data-testid="stitch-manuscript-missing-info" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(items || []).map((mi, i) => (
          <div key={mi.field || i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <span style={{ ...tagS('yellow'), flexShrink: 0 }}>Missing</span>
            <span style={{ fontSize: 12, color: C.txt2, lineHeight: 1.6, flex: '1 1 240px' }}>
              {mi.hint || mi.field}
              {mi.resolveAt && <span style={{ color: C.muted }}> — add it in {mi.resolveAt}.</span>}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function UpdatesPanel({ m, onOpenSection }) {
  const plan = m.syncPlan;
  const entries = (plan && plan.entries) || [];
  // Outdated sections need review (this already subsumes edited-conflicts and
  // locked-stale, which the engine flags outdated); a detached section whose text
  // now differs is shown so its Relink action is reachable.
  const shown = entries.filter((e) => e.outdated || (e.detached && !e.sameText));
  const safeCount = entries.filter((e) => e.canAutoApply).length;
  const contradictions = m.contradictions || [];
  const missing = m.missingInfo || [];
  const nothing = shown.length === 0 && contradictions.length === 0 && missing.length === 0;

  return (
    <div data-testid="stitch-manuscript-updates">
      {plan && plan.error && (
        /* 84.md Part 22 — a sync failure is DISPLAYED with a retry, never silent. */
        <div role="alert" data-testid="stitch-manuscript-sync-error"
          style={{ border: `1px solid ${C.red}`, borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 12.5, color: C.txt2, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>Synchronization failed: {plan.error}. The manuscript was not changed.</span>
          <button onClick={() => m.refreshSyncPlan && m.refreshSyncPlan()} style={{ ...btnS('ghost'), fontSize: 11 }}>Retry</button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <FreshnessPill freshness={m.freshness} />
        <span style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, flex: '1 1 200px' }}>
          The manuscript tracks your project data. When a number, method or count changes, the affected sections show the proposed update here — you decide what to accept.
        </span>
        {safeCount > 0 && (
          <button onClick={() => m.acceptAllSafe && m.acceptAllSafe()}
            data-testid="stitch-manuscript-accept-all"
            title="Accept every update that is safe to apply automatically (interpretive and edited sections are left for you to review)"
            style={{ ...btnS('primary'), fontSize: 11 }}>
            <Icon name="check" size={12} /> Accept all safe updates ({safeCount})
          </button>
        )}
      </div>

      {contradictions.length > 0 && (
        <Block title="Contradictions" desc="Statements in the manuscript that conflict with the current project data. Resolve these before submission.">
          <ContradictionsCard items={contradictions} />
        </Block>
      )}

      {missing.length > 0 && (
        <Block title="Missing information" desc="Facts a complete manuscript needs that are not in the project yet.">
          <MissingInfoCard items={missing} />
        </Block>
      )}

      {shown.length > 0 ? (
        <Block title="Section updates" desc="Each card shows the current text beside the proposed update, and why it changed.">
          {shown.map((e) => <UpdateCard key={e.sectionId} entry={e} m={m} onOpenSection={onOpenSection} />)}
        </Block>
      ) : nothing ? (
        <InfoBox color={C.grn}>Fully synchronized with the project.</InfoBox>
      ) : null}
    </div>
  );
}

/* ════════════ 1. OVERVIEW ════════════ */

/* r2 (118.md §32) — the section-status rule now has ONE home,
   ./sectionStatusRule.js, shared with ManuscriptOverview. Re-exported here because
   this module is the rule's historical import site (tests and the Editor's own
   chips read it from here); the implementation is no longer duplicated. */
export { sectionRowStatus };

/**
 * 118.md §28-§40 — the Overview redesign. This panel is now a MOUNT POINT: the
 * command-center page (readiness → needs attention → structure → connected project
 * data → before-submission checklist → authors → export) lives in its own component
 * family, ManuscriptOverview.jsx (§70). `onNavigate` is the workspace's one
 * navigation seam, which the Overview's CTAs need (§31/§34/§35).
 */
export function OverviewPanel({ m, exporters, onOpenSection, onNavigate }) {
  return (
    <ManuscriptOverview m={m} exporters={exporters} onOpenSection={onOpenSection} onNavigate={onNavigate} />
  );
}

/* ════════════ 2. EDITOR (65.md MS-CORE/MS-3) — outline · paper page · tools ════════════ */
const dotColor = (st) => (st === 'edited' ? C.grn : st === 'ai-draft' ? C.yel : C.dim);

/**
 * 116.md §61/§62 — the floating table controls: visible ONLY while the caret is
 * inside a table (the editor reports the context via onTableFocus), anchored to
 * the table's top-right corner inside the paper page. Subtle by design: small
 * ghost buttons, no decorative theme, and it disappears the moment the caret
 * leaves the table. Every op routes through api.tableOp → whole-table
 * replacement on the editor's execCommand path, so native undo (§64) and the
 * input→autosave emit (§63) both record it.
 */
const TABLE_CTL_OPS = [
  { op: 'rowAbove', glyph: '+ Row ↑', aria: 'Insert row above' },
  { op: 'rowBelow', glyph: '+ Row ↓', aria: 'Insert row below' },
  { op: 'colLeft', glyph: '+ Col ←', aria: 'Insert column left' },
  { op: 'colRight', glyph: '+ Col →', aria: 'Insert column right' },
  { op: 'deleteRow', glyph: '− Row', aria: 'Delete row', danger: true },
  { op: 'deleteCol', glyph: '− Col', aria: 'Delete column', danger: true },
  { op: 'deleteTable', glyph: '✕ Table', aria: 'Delete table', danger: true },
];

export function TableContextBar({ ctx, pageEl, getApi, onDeleteTable, onAddCaption }) {
  if (!ctx || !ctx.rect || !pageEl || typeof pageEl.getBoundingClientRect !== 'function') return null;
  const pr = pageEl.getBoundingClientRect();
  // Anchor above the table's top-right corner; clamp inside the page so a table
  // at the very top still shows its controls.
  const top = Math.max(ctx.rect.top - pr.top - 34, 2);
  const right = Math.max(pr.right - ctx.rect.right, 8);
  const run = (op) => {
    // 117.md §11 — deleting a table is the one op that can break other people's
    // sentences, so it is routed to the parent, which counts the cross-references
    // first and asks. Every other op is immediate, as before.
    if (op === 'deleteTable' && onDeleteTable) { onDeleteTable(ctx); return; }
    const api = getApi && getApi();
    if (api && api.tableOp) api.tableOp(op);
  };
  return (
    <div role="toolbar" aria-label="Table controls" data-testid="stitch-manuscript-table-ctl"
      style={{
        position: 'absolute', top, right, zIndex: 5,
        display: 'flex', alignItems: 'center', gap: 2, padding: '3px 5px',
        background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8,
        boxShadow: '0 4px 14px rgba(15,23,42,0.14)', whiteSpace: 'nowrap',
      }}>
      {/* 117.md §4 — an older, anonymous pipe table can be promoted to a numbered
          object in one click. Without this the export notice ("add a caption to
          number it") would be advice with no control behind it. */}
      {!ctx.tableId && (
        <button type="button" aria-label="Add table caption" title="Give this table a number and a title"
          data-testid="stitch-manuscript-table-op-addCaption"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const api = getApi && getApi();
            const id = api && api.addTableCaption && api.addTableCaption();
            if (id && onAddCaption) onAddCaption(id);
          }}
          style={{
            ...btnS('ghost'), padding: '3px 7px', fontSize: 10.5,
            border: '1px solid transparent', background: 'transparent', color: C.acc, fontWeight: 700,
          }}>
          + Caption
        </button>
      )}
      {TABLE_CTL_OPS.map((b) => (
        <button key={b.op} type="button" aria-label={b.aria} title={b.aria}
          data-testid={`stitch-manuscript-table-op-${b.op}`}
          // preventDefault keeps the editor caret alive through the click — the
          // same selection-preserving pattern as every toolbar control
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run(b.op)}
          style={{
            ...btnS('ghost'), padding: '3px 7px', fontSize: 10.5,
            border: '1px solid transparent', background: 'transparent',
            color: b.danger ? C.red : C.txt2,
          }}>
          {b.glyph}
        </button>
      ))}
    </div>
  );
}

/**
 * 119.md §5 — the floating controls for the uploaded figure under the pointer.
 *
 * The TableContextBar contract, applied to a picture: everything mutating goes
 * back through the editor's imperative API (so native undo owns the history), the
 * width/alignment writes are per-asset draft overrides (the same buffered channel
 * captions use), and the destructive action is routed to the parent, which counts
 * the cross-references it would break BEFORE asking (§5 "Deleting a referenced
 * figure must warn the user and identify affected references").
 */
export const FIGURE_WIDTH_STEPS = [40, 60, 80, 100];

export function FigureContextBar({ ctx, pageEl, getApi, onReplace, onRemove, onResize, onAlign }) {
  if (!ctx || !ctx.rect || !pageEl || typeof pageEl.getBoundingClientRect !== 'function') return null;
  const pr = pageEl.getBoundingClientRect();
  const top = Math.max(ctx.rect.top - pr.top - 34, 2);
  const right = Math.max(pr.right - ctx.rect.right, 8);
  const hold = (e) => e.preventDefault();   // keep the caret/selection through a click
  const btn = (extra = {}) => ({
    ...btnS('ghost'), padding: '3px 7px', fontSize: 10.5,
    border: '1px solid transparent', background: 'transparent', color: C.txt2, ...extra,
  });
  return (
    <div role="toolbar" aria-label="Figure controls" data-testid="stitch-manuscript-figure-ctl"
      style={{
        position: 'absolute', top, right, zIndex: 5,
        display: 'flex', alignItems: 'center', gap: 2, padding: '3px 5px',
        background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8,
        boxShadow: '0 4px 14px rgba(15,23,42,0.14)', whiteSpace: 'nowrap',
      }}>
      <button type="button" aria-label="Replace this image" title="Replace this image — the figure keeps its number and every cross-reference"
        data-testid="stitch-manuscript-figure-op-replace"
        onMouseDown={hold} onClick={() => onReplace && onReplace(ctx)} style={btn()}>Replace</button>
      {FIGURE_WIDTH_STEPS.map((w) => (
        <button key={w} type="button" aria-label={`Set figure width to ${w} percent`} title={`${w}% of the page width`}
          data-testid={`stitch-manuscript-figure-width-${w}`}
          onMouseDown={hold} onClick={() => onResize && onResize(ctx, w)}
          style={btn(ctx.width === w ? { color: C.acc, fontWeight: 700 } : {})}>{w}%</button>
      ))}
      {[['left', '◧'], ['center', '▣'], ['right', '◨']].map(([a, glyph]) => (
        <button key={a} type="button" aria-label={`Align figure ${a}`} title={`Align ${a}`}
          data-testid={`stitch-manuscript-figure-align-${a}`}
          onMouseDown={hold} onClick={() => onAlign && onAlign(ctx, a)}
          style={btn(ctx.align === a ? { color: C.acc, fontWeight: 700 } : {})}>{glyph}</button>
      ))}
      <button type="button" aria-label="Remove this figure from the manuscript" title="Take this figure out of the document (the image is kept, and Ctrl+Z restores it)"
        data-testid="stitch-manuscript-figure-op-remove"
        onMouseDown={hold} onClick={() => onRemove && onRemove(ctx, getApi && getApi())}
        style={btn({ color: C.red })}>✕ Figure</button>
    </div>
  );
}

/* ════════════ 117.md §10/§11 — cross-reference chip surfaces ════════════
 *
 * The chip lives inside a contentEditable; its popovers cannot. Both of these are
 * rendered by the PANEL, absolutely positioned inside the paper page (which is
 * position:relative), anchored to the rect the editor reported. Nothing here
 * touches the document — actions call back into the editor's imperative API, which
 * mutates through the same execCommand path as typing, so native undo still owns
 * the history.
 */
const popoverBox = {
  position: 'absolute', zIndex: 6, background: C.card, border: `1px solid ${C.brd}`,
  borderRadius: 8, boxShadow: '0 8px 22px rgba(15,23,42,0.18)',
};

/** Anchor a popover under a chip rect, clamped inside the page. */
function anchorUnder(rect, pageEl, width) {
  if (!rect || !pageEl || typeof pageEl.getBoundingClientRect !== 'function') return null;
  const pr = pageEl.getBoundingClientRect();
  const top = (rect.bottom == null ? rect.top : rect.bottom) - pr.top + 6;
  const maxLeft = Math.max(4, (pr.width || 0) - width - 8);
  const left = Math.max(4, Math.min((rect.left || 0) - pr.left, maxLeft));
  return { top, left };
}

export function fmtWhen(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch { return ''; }
}

/** §10 — hover preview: number, title, origin, last modified when known. */
export function AssetRefHoverCard({ info, asset, pageEl }) {
  const pos = info && anchorUnder(info.rect, pageEl, 260);
  if (!info || !pos) return null;
  const when = asset && (asset.updatedAt || asset.createdAt);
  return (
    <div data-testid="stitch-manuscript-xref-hover" role="tooltip"
      style={{ ...popoverBox, top: pos.top, left: pos.left, width: 260, padding: '8px 10px', pointerEvents: 'none' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: info.broken ? C.red : C.acc, marginBottom: 2 }}>
        {info.label}
      </div>
      <div style={{ fontSize: 11.5, color: C.txt, lineHeight: 1.45 }}>
        {info.broken
          ? 'This table or figure no longer exists in the manuscript.'
          : ((asset && (asset.title || asset.defaultCaption)) || info.id)}
      </div>
      {!info.broken && (
        <div style={{ marginTop: 5, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 10, color: C.muted }}>
          <span>{asset && asset.origin === 'manual' ? 'Manual table' : 'Generated from project data'}</span>
          {when && <span>Last modified {fmtWhen(when)}</span>}
        </div>
      )}
    </div>
  );
}

/** §10/§11 — the chip action menu (and the §11 relink picker it can open). */
export function AssetRefMenu({
  info, asset, pageEl, relinkItems, relinking,
  onGo, onEdit, onRemove, onStartRelink, onRelink, onClose,
}) {
  const pos = info && anchorUnder(info.rect, pageEl, relinking ? 288 : 210);
  if (!info || !pos) return null;
  const btn = {
    ...btnS('ghost'), width: '100%', justifyContent: 'flex-start', fontSize: 11.5,
    padding: '5px 8px', border: '1px solid transparent', background: 'transparent',
  };
  return (
    <>
      <div onMouseDown={(e) => { e.preventDefault(); onClose && onClose(); }}
        style={{ position: 'fixed', inset: 0, zIndex: 5, background: 'transparent' }} />
      <div role="dialog" aria-label="Cross-reference actions"
        data-testid="stitch-manuscript-xref-menu"
        onMouseDown={(e) => e.preventDefault()}
        style={{ ...popoverBox, top: pos.top, left: pos.left, width: relinking ? 288 : 210, padding: 8 }}>
        <div style={{ fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: C.muted, padding: '0 4px 5px' }}>
          {info.broken ? 'Broken reference' : info.label}
        </div>
        {relinking ? (
          <CrossRefList items={relinkItems || []} onPick={onRelink}
            testIdPrefix="stitch-manuscript-xref-relink" autoFocus />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {!info.broken && (
              <button type="button" style={btn} data-testid="stitch-manuscript-xref-goto"
                onClick={onGo}>Go to {assetKindLabel(info.id).toLowerCase()}</button>
            )}
            {!info.broken && (
              <button type="button" style={btn} data-testid="stitch-manuscript-xref-edit"
                onClick={onEdit}>Edit {assetKindLabel(info.id).toLowerCase()}</button>
            )}
            <button type="button" style={btn} data-testid="stitch-manuscript-xref-relink-open"
              onClick={onStartRelink}>Relink to another object…</button>
            <button type="button" style={{ ...btn, color: C.red }}
              data-testid="stitch-manuscript-xref-remove"
              onClick={onRemove}>Remove cross-reference</button>
            <div style={{ fontSize: 10, color: C.muted, padding: '4px 6px 1px', lineHeight: 1.45 }}>
              Removing the reference leaves the {assetKindLabel(info.id).toLowerCase()} itself untouched.
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ════════════ 117.md §38 — citation chip surfaces ════════════
 *
 * Deliberately the SAME two components as the cross-reference chip (hover card +
 * action menu), anchored the same way inside the paper page. A citation and a table
 * reference are the same interaction to a researcher — click the thing, act on it —
 * so they are the same interaction here.
 */

/** One line of "Smith et al., 2020 · Journal · Year" for a reference. */
export function referencePreviewLine(ref) {
  const r = ref || {};
  return [r.journal, r.year].filter(Boolean).join(' · ');
}

/**
 * §38 — hover preview: first author, year, title, journal.
 * §K.4 — `yearSuffixes` keeps the preview's "Smith, 2020a" identical to the chip and
 * to the bibliography entry; without it the preview would name a year that the
 * marker beside it disambiguated differently.
 */
export function CiteHoverCard({ info, refs, pageEl, yearSuffixes = null }) {
  const pos = info && anchorUnder(info.rect, pageEl, 280);
  if (!info || !pos) return null;
  const list = Array.isArray(refs) ? refs.filter(Boolean) : [];
  const sfx = (r) => (yearSuffixes && r ? (yearSuffixes[r.id] || '') : '');
  return (
    <div data-testid="stitch-manuscript-cite-hover" role="tooltip"
      style={{ ...popoverBox, top: pos.top, left: pos.left, width: 280, padding: '8px 10px', pointerEvents: 'none' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: info.broken ? C.red : C.acc, marginBottom: 3 }}>
        {info.label}
      </div>
      {list.length === 0 ? (
        <div style={{ fontSize: 11.5, color: C.txt, lineHeight: 1.45 }}>
          This citation does not match any reference in the library.
        </div>
      ) : list.slice(0, 3).map((r, i) => (
        <div key={r.id || i} style={{ marginTop: i ? 6 : 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.txt, lineHeight: 1.4 }}>{authorYearLabel(r, sfx(r))}</div>
          <div style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.45 }}>{r.title || '(no title)'}</div>
          {referencePreviewLine(r) && (
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{referencePreviewLine(r)}</div>
          )}
        </div>
      ))}
      {list.length > 3 && (
        <div style={{ fontSize: 10, color: C.muted, marginTop: 5 }}>+{list.length - 3} more in this citation</div>
      )}
    </div>
  );
}

/**
 * §38 — the citation action menu: View reference · Edit reference · Open PDF ·
 * Go to References · Remove citation.
 *
 * "Open PDF" appears ONLY when the reference actually carries a linked attachment.
 * A dead button that always says "no PDF" would be worse than no button — it would
 * teach the researcher the action never works.
 *
 * On a MULTI-reference citation the per-reference actions are offered per reference
 * (each row is one reference), because "Edit reference" has to mean a specific one.
 */
export function CiteRefMenu({
  info, refs, pageEl, onView, onEdit, onOpenPdf, onGoToReferences, onRemove, onClose,
  yearSuffixes = null,
}) {
  const pos = info && anchorUnder(info.rect, pageEl, 268);
  if (!info || !pos) return null;
  const list = Array.isArray(refs) ? refs : [];
  const sfx = (r) => (yearSuffixes && r ? (yearSuffixes[r.id] || '') : '');
  const btn = {
    ...btnS('ghost'), width: '100%', justifyContent: 'flex-start', fontSize: 11.5,
    padding: '5px 8px', border: '1px solid transparent', background: 'transparent',
  };
  const multi = list.length > 1;
  return (
    <>
      <div onMouseDown={(e) => { e.preventDefault(); onClose && onClose(); }}
        style={{ position: 'fixed', inset: 0, zIndex: 5, background: 'transparent' }} />
      <div role="dialog" aria-label="Citation actions"
        data-testid="stitch-manuscript-cite-menu"
        onMouseDown={(e) => e.preventDefault()}
        style={{ ...popoverBox, top: pos.top, left: pos.left, width: 268, padding: 8 }}>
        <div style={{ fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: C.muted, padding: '0 4px 5px' }}>
          {info.broken ? 'Citation not found' : info.label}
        </div>
        {list.length === 0 ? (
          <div style={{ fontSize: 11, color: C.txt2, padding: '2px 6px 6px', lineHeight: 1.5 }}
            data-testid="stitch-manuscript-cite-menu-missing">
            The reference this points at is not in the library.
          </div>
        ) : list.map((r) => (
          <div key={r.id} style={{ marginBottom: multi ? 6 : 0 }}>
            {multi && (
              <div style={{ fontSize: 10.5, fontWeight: 700, color: C.txt, padding: '3px 6px 1px' }}>
                {authorYearLabel(r, sfx(r))}
              </div>
            )}
            <button type="button" style={btn} data-testid={`stitch-manuscript-cite-view-${r.id}`}
              onClick={() => onView && onView(r.id)}>View reference</button>
            <button type="button" style={btn} data-testid={`stitch-manuscript-cite-edit-${r.id}`}
              onClick={() => onEdit && onEdit(r.id)}>Edit reference</button>
            {r.pdfAttachmentId && (
              <button type="button" style={btn} data-testid={`stitch-manuscript-cite-pdf-${r.id}`}
                onClick={() => onOpenPdf && onOpenPdf(r.id)}>Open PDF</button>
            )}
            {multi && (
              <button type="button" style={{ ...btn, color: C.red }}
                data-testid={`stitch-manuscript-cite-remove-${r.id}`}
                onClick={() => onRemove && onRemove(r.id)}>Remove this reference</button>
            )}
          </div>
        ))}
        <button type="button" style={btn} data-testid="stitch-manuscript-cite-goto-references"
          onClick={onGoToReferences}>Go to References</button>
        <button type="button" style={{ ...btn, color: C.red }}
          data-testid="stitch-manuscript-cite-remove"
          onClick={() => onRemove && onRemove(null)}>Remove citation</button>
        <div style={{ fontSize: 10, color: C.muted, padding: '4px 6px 1px', lineHeight: 1.45 }}>
          Removing the citation leaves the reference in your library.
        </div>
      </div>
    </>
  );
}

/**
 * 117.md §11 — the delete confirmation for a table that is cited.
 *
 * It states the exact count (the sentence §11 asks for), and it says out loud that
 * Ctrl+Z brings everything back — which is TRUE here precisely because the table,
 * its caption and its identity are all one stretch of prose on the native undo
 * stack. Deleting is still allowed: the researcher is warned, not blocked.
 */
export const TABLE_DELETE_UNDO_NOTE = 'Press Ctrl+Z (Cmd+Z) right after deleting to restore the table, its caption and its references.';

/**
 * 120.md §5 — "If the original location no longer exists and cannot be resolved
 * safely, show a clear non-destructive message and ask the user to place the caret
 * again. Do not fall back to the beginning of the section."
 *
 * This is that message. It is shown INSTEAD of an insertion — nothing is written,
 * nothing is deleted, the undo stack is untouched — and it says what the researcher
 * has to do next rather than what went wrong internally.
 */
export const CARET_LOST_TEXT = 'The place you were writing could not be found — this section changed while the picker was open. Click where the reference belongs and insert it again.';

/**
 * 119.md §5 — "Deleting a referenced figure must warn the user and identify
 * affected references. Undo must restore the figure and its references."
 *
 * The wording states what ACTUALLY happens, which is not what a naive warning
 * would say. Taking a picture out of the text removes its PLACEMENT, not the
 * figure: the row and its bytes stay (that is what makes Ctrl+Z restore a marker
 * pointing at a live file), so every cross-reference keeps resolving and the
 * picture is printed at the end of the exported document until it is placed
 * again. Claiming the references "will break" would be a lie, and claiming
 * nothing changed would hide a real consequence — so it says both.
 */
export const FIGURE_REMOVE_UNDO_NOTE =
  'The image file is kept — Ctrl+Z puts the figure, its title and its place in the text back.';

export function FigureDeleteDialog({ info, onConfirm, onCancel }) {
  if (!info) return null;
  const n = info.count || 0;
  return (
    <div role="dialog" aria-modal="true" aria-label="Remove figure"
      data-testid="stitch-manuscript-figure-delete-confirm"
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(15,23,42,0.35)', padding: 16,
      }}>
      <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 18, maxWidth: 420, width: '100%' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: C.txt }}>
          Remove {info.label || 'this figure'}?
        </h3>
        <p style={{ margin: '0 0 6px', fontSize: 12.5, color: C.txt2, lineHeight: 1.55 }}
          data-testid="stitch-manuscript-figure-delete-count">
          This figure is referenced {n} time{n === 1 ? '' : 's'} in the manuscript.
          {' '}Those references keep working — the figure stays in this project and will be
          {' '}printed at the end of the exported document until you place it again.
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>
          {FIGURE_REMOVE_UNDO_NOTE}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} data-testid="stitch-manuscript-figure-delete-cancel"
            onMouseDown={(e) => e.preventDefault()}
            style={{ ...btnS('ghost'), fontSize: 11.5 }}>Keep figure</button>
          <button onClick={onConfirm} data-testid="stitch-manuscript-figure-delete-confirm-btn"
            onMouseDown={(e) => e.preventDefault()}
            style={{ ...btnS('danger'), fontSize: 11.5 }}>Remove anyway</button>
        </div>
      </div>
    </div>
  );
}

export function TableDeleteDialog({ info, onConfirm, onCancel }) {
  if (!info) return null;
  const n = info.count || 0;
  return (
    <div role="dialog" aria-modal="true" aria-label="Delete table"
      data-testid="stitch-manuscript-table-delete-confirm"
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(15,23,42,0.35)', padding: 16,
      }}>
      <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 18, maxWidth: 420, width: '100%' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: C.txt }}>
          Delete {info.label || 'this table'}?
        </h3>
        <p style={{ margin: '0 0 6px', fontSize: 12.5, color: C.txt2, lineHeight: 1.55 }}>
          This table is referenced {n} time{n === 1 ? '' : 's'} in the manuscript.
          {' '}Those references will show as broken until you relink or remove them.
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>
          {TABLE_DELETE_UNDO_NOTE}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {/* 119.md §2 — the same selection-preserving mousedown every editor control
              uses. WebKit drops a contentEditable's selection the moment focus lands
              on a real button, and the op behind "Delete anyway" runs against the
              document the researcher was just editing: without this, confirming
              deleted nothing at all in Safari. */}
          <button onClick={onCancel} data-testid="stitch-manuscript-table-delete-cancel"
            onMouseDown={(e) => e.preventDefault()}
            style={{ ...btnS('ghost'), fontSize: 11.5 }}>Keep table</button>
          <button onClick={onConfirm} data-testid="stitch-manuscript-table-delete-confirm-btn"
            onMouseDown={(e) => e.preventDefault()}
            style={{ ...btnS('danger'), fontSize: 11.5 }}>Delete anyway</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 118.md §10-§19 — the Editor destination hosts BOTH views.
 *
 * `view` is the ONLY difference between them. Everything below — the api registry,
 * the citation/asset numbering, the outline, the popovers, the tools column — is
 * shared, and both views mount their editors from the SAME `editorProps` factory,
 * so §13 ("two presentations of the exact same manuscript state") and §18 ("full
 * editing parity") hold structurally instead of by discipline.
 *
 * @param {'sections'|'continuous'} view  118.md §10/§12. Section View shows one
 *        section at a time (unchanged); Continuous View renders the whole document.
 */
export function EditorPanel({ m, exporters, sectionRequest, onOpenAssetPanel, onOpenReference, onNavigate, view = 'sections', wa = null }) {
  const continuous = view === 'continuous';
  // Live handle for the callbacks that are built ONCE (the per-section api/activate
  // handles below) and must still know which view is on screen.
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;

  const [sel, setSel] = useState('title');
  const [genNotice, setGenNotice] = useState(null); // { only:null|[id], skipped:[...], skippedLocked:[...] }
  const [toolsOpen, setToolsOpen] = useState(true);
  const [whyOpen, setWhyOpen] = useState(false); // 84.md — "Why does this say this?"

  const sections = m.activeDraft.sections || {};
  const section = sections[sel] || {};
  const lastGen = section.lastGeneratedAt || null;
  // 73.md Part 9 — per-section lock + outdated state.
  const locked = !!section.locked;
  const outdatedMap = m.outdated || {};
  const isOutdated = !!outdatedMap[sel];

  /* 118.md §13 — the LIVE draft (pending, pre-autosave edits included) is what the
     derived views read. It is the hook's own overlay, so Continuous View sees a
     table typed in Methods the instant it exists, and Section View reads exactly
     the same object — there is no per-view buffer of manuscript text any more. */
  const liveDraft = m.liveDraft || m.activeDraft;

  // The TITLE is a plain input, so it needs a controlled buffer; every other
  // section is an uncontrolled rich editor mounted from the committed draft.
  const titleContent = (sections.title || {}).content || '';
  const titleGen = (sections.title || {}).lastGeneratedAt || '';
  const [titleBuf, setTitleBuf] = useState(titleContent);
  useEffect(() => {
    setTitleBuf((((m.activeDraft.sections || {}).title) || {}).content || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.activeId, titleGen]);

  // keywords buffer (comma-separated)
  const [kw, setKw] = useState((m.activeDraft.keywords || []).join(', '));
  useEffect(() => { setKw((m.activeDraft.keywords || []).join(', ')); }, [m.activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The ONE write path for prose, from either view. Locked sections never write. */
  const commitSection = useCallback((id, val) => {
    if (((m.activeDraft.sections || {})[id] || {}).locked) return;
    m.updateSection(id, val);
    /* 120.md §6 — RE-ANCHOR after every emit. The decorations are DOM Ranges over
       live text nodes; an edit that only reflows the block (a chip renumbering, a
       table op, an undo) leaves the issue offsets valid but the Range objects
       pointing at detached nodes. Re-anchoring here costs one pass over the visible
       issues and is what keeps the underlines aligned through typing, undo,
       Continuous View and fullscreen (§6 "Efficient decoration updates"). */
    if (waRef.current) waRef.current.reanchor();
  }, [m]);
  const onTitleType = (val) => { if (locked) return; setTitleBuf(val); commitSection('title', val); };

  /* ══════════ 118.md §18 — one api per MOUNTED section ══════════
   *
   * Section View mounts one editor; Continuous View mounts one per body section.
   * `apis` is therefore a registry rather than a single ref, and `activeApi` stays
   * what it always was: the editor that last owned the CARET, which is what the
   * shared toolbar and the Tools column act on. Chip menus and table controls are
   * routed by the OWNING section id instead (they are anchored to a specific chip),
   * so an action can never land in the wrong section of a 10-editor document.
   */
  const apis = useRef(new Map());
  const activeApi = useRef(null);
  const activeSectionRef = useRef(null);
  /* 120.md §6 — the writing assistant, read through a ref. The `handles` below are
     built ONCE per section SET (never per keystroke), so an assistant read directly
     from the closure would be frozen at the first render, exactly like every other
     callback in this factory. */
  const waRef = useRef(wa);
  waRef.current = wa;
  /* r2 — the caret-owning section as RENDER state, not just a ref. `sel` cannot
     serve: in Continuous View it is also written by the IntersectionObserver as the
     reader scrolls, so it answers "what am I looking at", not "where is my caret".
     The shared toolbar and the Insert pickers act on the caret, so they are gated on
     this. Null until a caret has actually landed somewhere. */
  const [caretSection, setCaretSection] = useState(null);
  /* 119.md §7 — one handle per section THIS draft has. Rebuilt when the section
     SET changes (never on a keystroke), so a template switch gives the new sections
     working editors and a preserved one keeps its own. */
  const handleSig = draftSectionIds(m.activeDraft).join(',');
  const handles = useMemo(() => {
    const out = {};
    for (const s of draftSectionTypes(m.activeDraft)) {
      out[s.id] = {
        // Stable callback ref: an inline arrow would detach/re-attach the handle on
        // every render of a document that re-renders on every keystroke.
        apiRef: (api) => {
          // 120.md §6 — the assistant applies a correction through the SAME api the
          // toolbar uses, so it needs the same registry entry and the same
          // unregistration. Kept beside the existing bookkeeping so the two can
          // never fall out of step on a remount.
          if (waRef.current) waRef.current.registerEditor(s.id, api || null);
          if (api) {
            apis.current.set(s.id, api);
            /* r2 — a regenerate changes the section's mountKey, so React UNMOUNTS
               the editor instance and mounts a fresh one. `activeApi` kept pointing
               at the dead instance, and every toolbar action (Bold, Insert citation,
               a table op) silently no-op'd against detached DOM until the writer
               happened to click back into the text. Re-point at the live instance
               when the caret's own section remounts. */
            if (activeSectionRef.current === s.id) activeApi.current = api;
          } else {
            apis.current.delete(s.id);
            // …and never keep a handle to an editor that has just been unmounted.
            if (activeSectionRef.current === s.id) activeApi.current = null;
          }
        },
        activate: (api) => {
          activeApi.current = api;
          activeSectionRef.current = s.id;
          setCaretSection(s.id);
          // 120.md §6 — the assistant checks the section the CARET is in, which in
          // Continuous View is not the section the reader is scrolled to.
          if (waRef.current) waRef.current.setCaretSection(s.id);
          // The abstract's subsection editors have no ref of their own — activating
          // is how they register, which keeps `apiFor('abstract')` honest.
          if (api) apis.current.set(s.id, api);
          // §16 — putting the caret in a section makes it the active section, in the
          // outline as well. Same value → React bails out, so this is free.
          if (continuousRef.current) setSel((cur) => (cur === s.id ? cur : s.id));
        },
        /* 120.md §6 — a STABLE root-handout per section (built once with the rest of
           the handle, never per render): an inline arrow would detach and re-attach
           the decoration layer's root on every keystroke. */
        rootRef: (el) => { if (waRef.current) waRef.current.registerRoot(s.id, el); },
        /* 120.md §5 — the missing HALF of `activate`, for the editors that register
           through it: drop the registry entry when the handle that owns it is
           unmounted. Identity-checked, because the abstract mounts several editors
           under ONE section id — a field unmounting while another field holds the
           caret must change nothing. Without this, `apis['abstract']` outlived its
           DOM after every regenerate / template switch / snapshot restore and
           swallowed inserts into detached nodes. Mirrors the `apiRef` body exactly. */
        release: (api) => {
          if (!api) return;
          if (apis.current.get(s.id) === api) apis.current.delete(s.id);
          if (activeApi.current === api) activeApi.current = null;
        },
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSig]);
  const apiFor = useCallback((id) => (
    apis.current.get(id) || (activeSectionRef.current === id ? activeApi.current : null)
  ), []);
  /* The editor the shared tools act on. `activeApi` first (the caret's own), then —
     r2 — the LIVE registry entry for the caret's section, so a remount that cleared
     `activeApi` still resolves to the same section rather than falling through to
     whatever `sel` happens to be after a scroll. `sel` remains the last resort, for
     Section View and for a document nobody has clicked into yet. */
  const getApi = () => activeApi.current
    || (activeSectionRef.current ? apis.current.get(activeSectionRef.current) : null)
    || apis.current.get(sel)
    || null;
  const setActive = (api) => { activeApi.current = api; };

  /* ══════════ r2 — WHICH section's lock gates the shared editing tools ══════════
   *
   * The formatting toolbar and every Insert control write at the CARET. In Section
   * View the caret is necessarily in `sel`. In Continuous View it is not: `sel` is
   * driven by scrolling, so gating on it meant that scrolling a locked Results
   * section into the reading band disabled Bold and greyed out "+ Cite…" for a
   * caret sitting in an unlocked Methods paragraph four screens up. Scroll position
   * is not an editing permission.
   *
   * `toolSectionId` is the section the tools will really write to; `toolsLocked` is
   * its lock. With no caret yet in Continuous View, nothing is disabled (there is
   * nothing to protect and nothing to write); the runtime guards below still resolve
   * the target section and refuse a locked one, so the enabled control cannot write
   * where it must not.
   */
  const toolSectionId = continuous ? caretSection : sel;
  const toolsLocked = !!(toolSectionId && (sections[toolSectionId] || {}).locked);
  /** The lock of the section an insert would ACTUALLY land in, resolved at click. */
  const targetLocked = () => {
    if (!continuous) return locked;
    const id = (activeApi.current && activeSectionRef.current) || caretSection || sel;
    return !!((sections[id] || {}).locked);
  };

  const pageRef = useRef(null);
  const pendingScroll = useRef(null);
  /* 118.md §15 — the outline stays on screen in the continuous document. Both
     measurements are real: how far down the sticky toolbar ends, and whether the
     three columns still fit side by side (below that they wrap, and a pinned
     outline would hang over the prose rather than beside it). */
  const rowRef = useRef(null);
  const rowWidth = useElementWidth(rowRef);
  const barH = useStickyBarHeight();
  const stickyOutline = continuous && barH > 0 && rowWidth >= OUTLINE_STICKY_MIN_WIDTH;
  /* 118.md §16/§17 — a programmatic scroll owns the active section until it
     settles, so the sections it flies past cannot steal the indicator. */
  const suppressActiveRef = useRef(0);
  const suppressActive = (ms) => { suppressActiveRef.current = Date.now() + ms; };

  // 116.md §61/§62 — the caret's table context (null outside tables), reported by
  // the editor that owns it (`sectionId` is added here so a 10-editor document
  // routes the ops back to the right one); drives the floating table controls.
  const [tableCtx, setTableCtx] = useState(null);
  /* 119.md §5 — the same idea for an uploaded FIGURE: which picture the pointer
     last claimed, so the floating figure controls (replace / size / align /
     remove) act on the object the researcher is looking at. */
  const [figureCtx, setFigureCtx] = useState(null);
  /** The hidden file input the "Insert picture" toolbar action opens. */
  const figureFileRef = useRef(null);
  const [figureTargetSection, setFigureTargetSection] = useState(null);

  const citeRefs = m.references || [];
  const refLabel = (r) => {
    const a = r.ref && r.ref.authorsList && r.ref.authorsList[0];
    const fam = a ? (a.family || a.raw) : ((r.ref && r.ref.title) || 'ref');
    return `${fam}${r.ref && r.ref.year ? ` ${r.ref.year}` : ''}`;
  };
  // inline-citation numbering (the LIVE draft, pending edits included)
  // 117.md §32/§36 — alias-resolved, so a citation of a merged-away reference numbers
  // as its survivor rather than falling out of the sequence.
  const citeAliases = m.referenceAliases || null;
  // 117.md §39 — an unresolvable citation takes no number, so the chips stay in step
  // with the bibliography instead of shifting after a typo.
  const citeKnownIds = m.referenceKnownIds || null;
  /* 118.md §13/§19 — numbering comes from the HOOK's citation order: the same
     derivation over the same live draft, memoized there on the citation SIGNATURE.
     Two consequences that matter here: the panel can never disagree with the
     bibliography (§13), and typing a word does not hand every mounted editor a new
     orderMap to renumber against (§19). The local fallback exists only for hosts
     that do not expose it; its memo body short-circuits, so it costs nothing. */
  const orderMapFallback = useMemo(
    () => (m.citationOrderMap
      ? null
      : collectCitationOrder(draftSectionTexts(liveDraft), { aliases: citeAliases, knownIds: citeKnownIds }).orderMap),
    [m.citationOrderMap, liveDraft, citeAliases, citeKnownIds],
  );
  const orderMap = m.citationOrderMap || orderMapFallback;
  // 117.md §34 — the searchable picker items (author/title/DOI/PMID/journal/year/keyword).
  const citeItems = useMemo(() => citeRefs.map((r) => citeItemOf(r, refLabel)), [citeRefs]); // eslint-disable-line react-hooks/exhaustive-deps

  // 85.md B2 — asset-chip numbering for the WYSIWYG surface. Gated on settle:
  // until the live sources resolve, availability (and therefore numbers) may
  // still change, so chips read 'Table …' instead of flickering through numbers.
  const pendingAssetNumbers = useMemo(() => ({ get: () => '…' }), []);
  const settled = m.sourcesSettled !== false;
  const assetNumbers = settled
    ? ((m.assetNumbering && m.assetNumbering.byId) || null)
    : pendingAssetNumbers;
  const availableAssets = (m.assets || []).filter((a) => a.available);

  /* ══════════ 117.md §9/§10/§11 — the cross-reference surface ══════════ */
  // The registry id set is passed to the editor ONLY once the live sources settle:
  // before that, availability (and therefore the registry) can still change, and
  // accusing an honest reference of being deleted for one frame would be worse
  // than showing it unnumbered for one frame.
  const knownAssetIds = settled ? (m.knownAssetIds || null) : null;
  const assetById = useMemo(() => {
    const map = new Map();
    for (const a of (m.assets || [])) {
      map.set(a.id, a);
      for (const al of (a.aliasIds || [])) if (!map.has(al)) map.set(al, a);
    }
    return map;
  }, [m.assets]);
  // Every object a researcher can reference, labelled the way they see it.
  const crossRefItems = useMemo(() => (m.assets || [])
    .filter((a) => a.available)
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      origin: a.origin || 'auto',
      title: a.title || a.defaultCaption || a.id,
      label: assetNumberLabel(m, a),
    })), [m.assets, m.assetNumbering, m.sourcesSettled]); // eslint-disable-line react-hooks/exhaustive-deps
  // Manual-table ids from EVERY section, so a table pasted from another section
  // still mints a fresh id instead of colliding (§4d).
  const existingTableIds = useMemo(
    () => (m.manualTables || []).map((a) => a.manualId).filter(Boolean),
    [m.manualTables],
  );

  const [chipMenu, setChipMenu] = useState(null);   // {id,label,broken,rect,sectionId}
  const [chipHover, setChipHover] = useState(null);
  const [relinking, setRelinking] = useState(false);
  const [tableDelete, setTableDelete] = useState(null); // {tableId,label,count}
  // 119.md §5 — {figKey,label,count,sectionId} while the remove warning is up.
  const [figureDelete, setFigureDelete] = useState(null);
  // 117.md §38 — the citation chip's own popovers ({ids,label,broken,rect,sectionId}).
  const [citeMenu, setCiteMenu] = useState(null);
  const [citeHover, setCiteHover] = useState(null);
  /* Every anchored popover dies when the DOM it is anchored to is remounted. In
     Section View that is a section switch or a regeneration; in Continuous View
     nothing remounts on scroll, so the epoch is the generation stamps alone —
     closing the menus while the reader merely scrolls would be a bug, not safety. */
  const genSignature = useMemo(
    () => draftSectionTypes(m.activeDraft).map((s) => ((m.activeDraft.sections || {})[s.id] || {}).lastGeneratedAt || '').join('|'),
    [m.activeDraft],
  );
  // 119.md §7 — a structure switch / snapshot restore remounts every editor, so the
  // anchored popovers die with the DOM they were anchored to, exactly as on a
  // generation.
  const mountEpoch = `${continuous ? genSignature : `${sel}:${lastGen || ''}`}:${m.contentEpoch || 0}`;
  useEffect(() => {
    setChipMenu(null); setChipHover(null); setRelinking(false); setTableDelete(null);
    setCiteMenu(null); setCiteHover(null); setTableCtx(null);
  }, [m.activeId, mountEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeChipMenu = () => {
    const api = apiFor(chipMenu && chipMenu.sectionId) || getApi();
    if (api && api.clearActiveCrossRef) api.clearActiveCrossRef();
    setChipMenu(null);
    setRelinking(false);
  };

  const closeCiteMenu = () => {
    const api = apiFor(citeMenu && citeMenu.sectionId) || getApi();
    if (api && api.clearActiveCitation) api.clearActiveCitation();
    setCiteMenu(null);
  };

  /**
   * 117.md §38 — the reference objects behind a chip's ids (alias-resolved).
   * §J.3 — decorated with whatever the lazy PDF resolver has learned, which is what
   * makes "Open PDF" appear for a screening-linked study. `m.referencePdfIds` is
   * empty until a menu asks, so a hover costs nothing.
   */
  const refsOf = (info) => {
    const by = m.refsById;
    if (!info || !by) return [];
    const list = (info.ids || [])
      .map((id) => (typeof by.get === 'function' ? by.get(id) : by[id]))
      .filter(Boolean);
    return withResolvedPdfIds(list, m.screenProjectId, m.referencePdfIds);
  };

  /* §J.3 — resolve on MENU OPEN, never on hover: opening the action menu is the one
     moment a researcher is about to ask for the PDF, and it is a deliberate click. */
  const openCiteMenu = (info) => {
    setCiteHover(null);
    setCiteMenu(info);
    if (info && m.resolveReferencePdfs) {
      Promise.resolve(m.resolveReferencePdfs(info.ids || [])).catch(() => { /* soft-fail */ });
    }
  };

  // MS-11: derive sub-entries from headings at render time — no model change.
  // 118.md §13 — off the LIVE draft, so a heading typed a moment ago is already in
  // the outline in BOTH views (never a single-section buffer override).
  const outline = useMemo(() => {
    const map = {};
    for (const s of draftSectionTypes(liveDraft)) {
      if (s.id === 'title') continue;
      const md = ((liveDraft.sections || {})[s.id] || {}).content || '';
      const entries = extractOutline(md).filter((h) => h.level <= 2);
      if (entries.length) map[s.id] = entries;
    }
    return map;
  }, [liveDraft]);

  // flush any pending debounced edit before changing section so resync reads fresh content
  /* Section View mounts ONE editor, so leaving a section leaves no caret behind:
     r2 clears the owner too, not just the handle, or `getApi` would keep resolving
     through the departed section's registry entry. */
  const switchTo = (id) => {
    if (m.flush) m.flush();
    activeApi.current = null;
    activeSectionRef.current = null;
    setCaretSection(null);
    setSel(id);
  };

  /* 118.md §15/§17 — Continuous View never switches away from the document: the
     section navigation SCROLLS, with the sticky toolbar's height accounted for. */
  const scrollToSection = (id, opts) => {
    suppressActive((opts && opts.instant) ? 250 : 800);
    return scrollToSectionId(pageRef.current, id, opts);
  };

  /** The outline's primary action, in whichever view is on screen. */
  const goToSection = (id) => {
    if (!continuous) { switchTo(id); return; }
    setSel(id);
    scrollToSection(id);
  };

  /* ══════════ 102.md §2 — navigation across the WHOLE manuscript ══════════
   *
   * In SECTION VIEW "next field" often means: switch section, wait for that editor
   * to mount, then reveal the field inside it — `pendingRevealRef` carries the
   * target across the remount and the effect below fires once the new editor's
   * handle exists.
   *
   * 118.md §19 — in CONTINUOUS VIEW every section is already mounted, so there is
   * no remount to wait for and no retry loop: the reveal is a direct call on the
   * owning editor's handle (which scrolls the field into view itself).
   *
   * Placeholders are addressed by their ORDINAL within a section rather than by a
   * DOM id, because the chips are re-rendered from markdown on every mount and any
   * id we stamped would not survive.
   */
  const pendingRevealRef = useRef(null);
  // 117.md §10 / 118.md §65 — the same across-remount carrier for "Go to table" /
  // "Edit table" / "View in manuscript" when the target lives in another section.
  const pendingAssetRevealRef = useRef(null);

  /** Reveal an asset (manual table or cross-reference chip) inside ONE section. */
  const revealAssetIn = (secId, req) => {
    const api = apiFor(secId);
    if (!api || !req) return false;
    if (req.manualId) {
      if (req.edit && api.editManualTable) return !!api.editManualTable(req.manualId);
      if (api.focusManualTable) return !!api.focusManualTable(req.manualId);
      return false;
    }
    return !!(req.assetId && api.focusAssetRef && api.focusAssetRef(req.assetId));
  };

  const revealPlaceholderIn = (secId, p) => {
    const api = apiFor(secId);
    if (!api || typeof api.focusPlaceholder !== 'function') return false;
    return api.focusPlaceholder(p.ordinal);
  };

  /* The freshly switched section's editor mounts asynchronously, so both carriers
     retry across a few frames rather than assuming one timeout is enough on a slow
     render. Written twice on purpose: a shared "custom hook" declared inside a
     component is exactly the shape the rules-of-hooks lint forbids. */
  const revealRunRef = useRef({ asset: null, placeholder: null });
  revealRunRef.current = {
    asset: (t) => revealAssetIn(t.sectionId, t),
    placeholder: (p) => revealPlaceholderIn(p.sectionId, p),
  };
  useEffect(() => {
    const target = pendingAssetRevealRef.current;
    if (!target || target.sectionId !== sel) return undefined;
    let tries = 0;
    let timer = null;
    const attempt = () => {
      if (pendingAssetRevealRef.current !== target) return;
      if (revealRunRef.current.asset(target)) { pendingAssetRevealRef.current = null; return; }
      tries += 1;
      if (tries < 10) timer = setTimeout(attempt, 24);
      else pendingAssetRevealRef.current = null; // give up quietly; never loop forever
    };
    timer = setTimeout(attempt, 0);
    return () => { if (timer) clearTimeout(timer); };
  }, [sel]);
  useEffect(() => {
    const target = pendingRevealRef.current;
    if (!target || target.sectionId !== sel) return undefined;
    let tries = 0;
    let timer = null;
    const attempt = () => {
      if (pendingRevealRef.current !== target) return;
      if (revealRunRef.current.placeholder(target)) { pendingRevealRef.current = null; return; }
      tries += 1;
      if (tries < 10) timer = setTimeout(attempt, 24);
      else pendingRevealRef.current = null;
    };
    timer = setTimeout(attempt, 0);
    return () => { if (timer) clearTimeout(timer); };
  }, [sel]);

  /** 118.md §11 — the declarations are IN the continuous document; scroll to them. */
  const scrollToStatements = () => {
    const el = pageRef.current
      && pageRef.current.querySelector('[data-testid="stitch-manuscript-continuous-statements"]');
    if (el) { suppressActive(800); scrollSectionIntoView(el); return true; }
    return false;
  };

  const goToPlaceholder = (p) => {
    if (!p) return;
    m.setCurrentPlaceholderId && m.setCurrentPlaceholderId(p.id);
    // A statement field lives in the Statements editor, not a section page.
    if (p.group === 'statement') {
      pendingRevealRef.current = null;
      if (continuous) { scrollToStatements(); return; }
      setSel('statements');
      return;
    }
    if (continuous) {
      setSel(p.sectionId);
      suppressActive(800);
      if (!revealPlaceholderIn(p.sectionId, p)) scrollToSection(p.sectionId);
      return;
    }
    if (p.sectionId === sel) { revealPlaceholderIn(sel, p); return; }
    pendingRevealRef.current = p;
    switchTo(p.sectionId);
  };

  const stepToPlaceholder = (direction) => {
    const p = m.nextPlaceholder && m.nextPlaceholder(direction);
    if (p) goToPlaceholder(p);
  };

  /* 102.md §26 — keyboard shortcuts. Ctrl/Cmd+Enter is the next field, with Shift
     for the previous one. Both are chosen because neither is bound by the editor
     (which only intercepts B/I) nor by the browser inside a contentEditable, so
     normal typing, undo and selection (§9) are untouched.

     108.md §23 — this WAS a bare `window.addEventListener('keydown')` with NO
     dependency array, so the listener was torn down and re-added on every render
     (twice per render under StrictMode) and its precedence against anything mounted
     later was non-deterministic. It is now one declaration in the central router,
     registered once for the panel's lifetime.

     Deliberately NOT gated on ctx.editableTarget: this chord's whole purpose is to
     jump between manual-input placeholders WHILE the caret is in the prose editor.
     It is tier ENGINE, so a modal or a focused component binding still wins, and
     the adapter skips any event a nearer React handler already cancelled. */
  useShortcut({
    id: 'manuscript.stepPlaceholder',
    tier: TIER.ENGINE,
    // 109.md §15 — descriptive metadata for the read-only Ops shortcut inventory.
    chord: 'Ctrl/Cmd + Enter', label: 'Jump to the next unresolved placeholder', scopeLabel: 'Manuscript editor',
    match: (e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter',
    run: (e) => { stepToPlaceholder(e.shiftKey ? -1 : 1); return true; },
  }, []);

  /* 73.md Part 9 / 118.md §64-§65 — another destination asked for a place in the
     manuscript ({ id, at, assetId?, manualId?, edit? }); honour every request (`at`
     changes even for the same id). Section View opens the section; Continuous View
     scrolls to it — §15's "do not switch out of Continuous View" applies to every
     caller, not just the outline. */
  useEffect(() => {
    // 119.md §7 — a request may name a template-introduced or preserved section.
    if (!sectionRequest || !sectionRequest.id || !draftSectionIds(m.activeDraft).includes(sectionRequest.id)) return;
    const id = sectionRequest.id;
    const wantsAsset = !!(sectionRequest.assetId || sectionRequest.manualId);
    if (continuous) {
      setSel(id);
      /* 121.md §3 — and the LIVE handle with it, synchronously.
         Arriving at the Editor destination from somewhere else (an export finding's
         "Go to it", an Overview CTA, "View in manuscript") MOUNTS this panel, so the
         mount effect fifteen lines below — which lands the reader on the section they
         were last in — is scheduled in the same commit as this one. Its rAF reads
         `selRef.current`, and a `setSel` from a passive effect had not re-rendered
         yet when that frame ran: the mount effect then scrolled back to the OLD
         section and silently undid this jump (measured: the request scrolled +2825,
         the mount frame scrolled to +400 and won). Writing the ref here closes the
         window without changing anything else — it is re-assigned from `sel` on every
         render anyway, so this only affects the frames before that render. */
      selRef.current = id;
      suppressActive(800);
      // The asset reveal scrolls to the object itself, which is more precise than
      // scrolling to the section that holds it.
      if (!(wantsAsset && revealAssetIn(id, sectionRequest))) scrollToSection(id);
      return;
    }
    if (wantsAsset) pendingAssetRevealRef.current = { ...sectionRequest, sectionId: id };
    switchTo(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionRequest]);

  /* 118.md §12 — switching INTO the continuous document lands on the section the
     researcher was last in, instantly (an animated flight down a 10-section page on
     a view toggle would be motion for its own sake — §58). */
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    if (!continuous || typeof window === 'undefined') return undefined;
    const raf = window.requestAnimationFrame
      ? window.requestAnimationFrame(() => scrollToSection(selRef.current, { instant: true }))
      : setTimeout(() => scrollToSection(selRef.current, { instant: true }), 0);
    return () => {
      if (window.cancelAnimationFrame && window.requestAnimationFrame) window.cancelAnimationFrame(raf);
      else clearTimeout(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuous]);

  /* MS-11 — heading navigation, scoped to the OWNING editor's root. In Continuous
     View the paper holds ten editors, so an unscoped `h2` query would count every
     heading in the document and jump to the wrong one. */
  const headingRoot = (secId) => {
    const page = pageRef.current;
    if (!page || typeof page.querySelector !== 'function') return null;
    return continuous ? page.querySelector(`${msSectionSelector(secId)} .ms-rich`) : page;
  };
  const scrollToHeading = (secId, idx) => {
    const root = headingRoot(secId);
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const h = root.querySelectorAll('h2,h3,h4')[idx];
    // §58 — reduced motion jumps instead of gliding.
    if (h && h.scrollIntoView) h.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  };
  const jumpTo = (secId, headingIndex) => {
    if (continuous) { setSel(secId); suppressActive(800); scrollToHeading(secId, headingIndex); return; }
    if (secId === sel) { scrollToHeading(secId, headingIndex); return; }
    pendingScroll.current = headingIndex;
    switchTo(secId);
  };
  useEffect(() => {
    if (pendingScroll.current == null) return;
    const idx = pendingScroll.current;
    pendingScroll.current = null;
    scrollToHeading(sel, idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const doGenerate = (only) => {
    // recs round — never generate from pre-fetch (empty) live sources.
    if (m.sourcesSettled === false) return;
    const res = m.generate(only ? { only } : {});
    const skipped = (res && res.skipped) || [];
    const skippedLocked = (res && res.skippedLocked) || [];
    if (skipped.length || skippedLocked.length) setGenNotice({ only: only || null, skipped, skippedLocked });
    else setGenNotice(null);
  };
  const doOverwrite = () => {
    const opts = { overwriteEdited: true };
    if (genNotice && genNotice.only) opts.only = genNotice.only;
    m.generate(opts); // locked sections stay skipped even on overwrite
    setGenNotice(null);
  };

  /* ══════════ 120.md §5 — the picker-session caret bookmark ══════════
   *
   * §5's lifecycle in three calls, owned HERE because this is the only layer that
   * knows which section's editor the caret was in:
   *
   *   beginInsertSession()  a picker is opening. Bookmark the caret NOW, before the
   *                         popover, its list or its autoFocus'd search input can
   *                         take focus (WebKit drops the document selection the
   *                         moment focus reaches a control — the same defect
   *                         documented for the table-delete confirmation below).
   *   endInsertSession()    the picker closed without inserting: clear the bookmark
   *                         and touch nothing else ("Canceling the picker must clear
   *                         the saved bookmark without modifying the manuscript").
   *   withBookmarkedCaret() an item was chosen: route to the BOOKMARKED SECTION'S
   *                         editor — never through getApi()'s activeApi → scroll-sel
   *                         chain, which in Continuous View could resolve to
   *                         whatever section the reader had scrolled into view — and
   *                         insert only if that editor can put the caret back.
   *
   * When it cannot, nothing is inserted anywhere and the notice says so. That is
   * the whole point: §5 forbids the start-of-section fallback, and a wrong-place
   * insertion in a manuscript is worse than an insertion that did not happen.
   */
  /* 121.md §4:168 — the lifecycle itself now lives in the SHARED insertion utility
     (richEditor/insertionSession.js), which citations, cross-references and symbols all
     go through; what stays here is the thin glue only this layer can supply: which
     section holds the caret, how to reach an editor handle, what "locked" means, and
     where the honest refusal is shown. The session object is rebuilt each render on
     purpose — its STATE lives in the ref below, so the callbacks always close over the
     current draft instead of a stale one. */
  const caretSectionId = () => (activeApi.current && activeSectionRef.current) || caretSection || sel;
  const insertSession = useRef(null);          // { sectionId, bm }
  const [insertNotice, setInsertNotice] = useState(null);

  const insertionSession = createInsertionSession({
    store: insertSession,
    caretSectionId,
    apiFor,
    getApi,
    isLocked: (id) => !!(sections[id] || {}).locked,
    targetLocked,
    onBegin: () => setInsertNotice(null),
    onRefusal: () => setInsertNotice(CARET_LOST_TEXT),
  });

  const beginInsertSession = () => insertionSession.begin();
  const endInsertSession = () => insertionSession.end();
  const withBookmarkedCaret = (run) => insertionSession.withBookmarkedCaret(run);

  // 117.md §34/§35 — one or MANY ids; the editor turns them into ONE chip.
  // 120.md §5 — routed through the picker session (see above).
  const insertCitation = (refIds) => {
    const ids = (Array.isArray(refIds) ? refIds : [refIds]).filter(Boolean);
    if (!ids.length) return;
    withBookmarkedCaret((api) => { if (api.insertCitation) api.insertCitation(ids); });
  };

  /** 117.md §38 — remove one id from the active chip (null → the whole chip). */
  const removeCitation = (refId) => {
    const api = apiFor(citeMenu && citeMenu.sectionId) || getApi();
    if (api && api.removeCitation) api.removeCitation(refId);
    setCiteMenu(null);
  };
  // MS-8: insert the generated study-selection paragraph as normal editable text.
  // 85.md B2 — token variant ONLY when the draft already uses structured tokens
  // (no silent mixed mode; a legacy draft keeps the legacy "(Figure 1)" text and
  // validation warns if modes ever mix).
  const insertPrisma = () => {
    if (targetLocked()) return;
    const api = getApi();
    if (api) api.insertMarkdown(studySelectionParagraph(m.prismaCounts, { assetRefs: !!m.draftUsesTokens }));
  };
  // 85.md B2 / 117.md §9 — insert a live [[table:…]]/[[figure:…]] reference AT THE
  // CARET as an inline chip (insertMarkdown would splice a block and split the
  // sentence being written).
  // 120.md §5 — same picker-session routing as insertCitation: the cross-reference
  // lands on the caret the researcher left, in the section they left it in.
  const insertAssetRef = (assetId) => {
    if (!assetId) return;
    withBookmarkedCaret((api) => {
      if (api.insertAssetRef) api.insertAssetRef(assetId);
      else api.insertMarkdown(assetToken(assetId)); // abstract subfields, older handles
    });
  };
  /* 121.md §1 — "clicking the Symbols menu must not cause the editor to lose the
     intended insertion position. Save the active editor selection when the menu opens
     and insert the selected symbol at that exact I-beam cursor location."
     That is the SAME session the citation and cross-reference pickers use, routed to
     the same bookmarked section's editor, refusing the same way when the position can
     no longer be found honestly. The payload is what differs (plain text, no wrapper,
     no nbsp — see insertionSession.js). */
  const insertSymbol = (ch) => {
    if (!ch) return;
    withBookmarkedCaret((api) => { if (api.insertSymbol) api.insertSymbol(ch); });
  };

  /* ── 117.md §10/§11 — chip menu actions ── */
  const chipAsset = chipMenu ? (assetById.get(chipMenu.id) || null) : null;
  const hoverAsset = chipHover ? (assetById.get(chipHover.id) || null) : null;

  const goToAsset = (assetId, edit = false) => {
    const a = assetById.get(assetId) || null;
    if (a && a.origin === 'manual') {
      const req = { sectionId: a.sectionId, manualId: a.manualId, edit };
      // Same section (or Continuous View, where every section is mounted) → reveal
      // now. Otherwise switch and let the retry fire once the editor exists.
      if (revealAssetIn(continuous ? a.sectionId : sel, req)) return;
      if (a.sectionId && (continuous || a.sectionId !== sel)) {
        if (continuous) { setSel(a.sectionId); suppressActive(800); scrollToSection(a.sectionId); return; }
        pendingAssetRevealRef.current = req;
        switchTo(a.sectionId);
      }
      return;
    }
    // A generated object has no place in the prose — its panel IS the object.
    if (onOpenAssetPanel) onOpenAssetPanel(a && a.kind === 'figure' ? 'figures' : 'tables');
  };

  const editAsset = (assetId) => goToAsset(assetId, true);

  const removeChipRef = () => {
    const api = apiFor(chipMenu && chipMenu.sectionId) || getApi();
    if (api && api.removeCrossRef) api.removeCrossRef();
    setChipMenu(null);
    setRelinking(false);
  };

  const relinkChipRef = (assetId) => {
    const api = apiFor(chipMenu && chipMenu.sectionId) || getApi();
    if (api && api.relinkCrossRef) api.relinkCrossRef(assetId);
    setChipMenu(null);
    setRelinking(false);
  };

  /* ── 117.md §11 — delete a table that other sentences point at ── */
  const askDeleteTable = (ctx) => {
    const tableId = ctx && ctx.tableId;
    const api = apiFor(ctx && ctx.sectionId) || getApi();
    if (!tableId) { if (api && api.tableOp) api.tableOp('deleteTable'); return; }
    const count = countAssetMentions(liveDraft, `table:${tableId}`);
    // 119.md §2 — name the object. WebKit drops the editor's selection the moment
    // focus reaches this button, so an op that reads the caret is a no-op in Safari.
    if (!count) { if (api && api.tableOp) api.tableOp('deleteTable', { tableId }); return; }
    const a = assetById.get(`table:${tableId}`) || null;
    setTableDelete({ tableId, count, sectionId: ctx && ctx.sectionId, label: a ? assetNumberLabel(m, a) : 'this table' });
  };

  const confirmDeleteTable = () => {
    const api = apiFor(tableDelete && tableDelete.sectionId) || getApi();
    /* 119.md §2 — the confirmation names the table it warned about. By the time the
       researcher confirms, the caret has been through a dialog; WebKit does not keep
       a selection across that, so reading the target off the caret deleted nothing in
       Safari (reproduced under the webkit-manuscript project). */
    if (api && api.tableOp) api.tableOp('deleteTable', { tableId: tableDelete && tableDelete.tableId });
    /* 119.md §2 — the stamps are NOT nulled here any more.
       "Undo must restore the table with its data, title, number, formatting,
       PROVENANCE and cross-references" — and the deletion's undo is the browser's
       native one, which restores the prose only. Side metadata lives outside that
       stack, so nulling it made `createdAt`/`origin` the one thing Ctrl+Z could not
       bring back: the table came home with its provenance permanently erased.
       Keeping the entry costs a few inert bytes for a table that may never return
       (the registry derives from the PROSE, so an entry no caption claims is never
       read or rendered); erasing it costs the researcher a fact about their own
       manuscript that nothing can recover. */
    setTableDelete(null);
  };

  /* ── 119.md §5 — figure actions from the floating controls ────────────────
   *
   * Replace and Remove are the two that need more than an editor call:
   *   · REPLACE moves bytes (a file picker + an authenticated upload), and the
   *     figure keeps its key, its number and every cross-reference — which is the
   *     whole point of §5's "without destroying its stable figure identity".
   *   · REMOVE takes the picture OUT OF THE DOCUMENT. It is a prose edit, so one
   *     native Ctrl+Z restores it, and the bytes are deliberately NOT deleted
   *     (the server only ever deletes an unreferenced figure) — otherwise the
   *     restored marker would point at a purged file. When other sentences
   *     cross-reference it, we say how many before doing anything.
   */
  const askReplaceFigure = (ctx) => {
    const a = assetById.get(`figure:${ctx && ctx.figKey}`) || null;
    if (!a || !a.figureId) return;
    setFigureTargetSection({ figureId: a.figureId, figKey: ctx.figKey });
    if (figureFileRef.current) { figureFileRef.current.value = ''; figureFileRef.current.click(); }
  };

  const doRemoveFigure = (figKey, sectionId) => {
    const api = apiFor(sectionId) || getApi();
    if (api && api.removeFigure) api.removeFigure(figKey);
    setFigureCtx(null);
    setFigureDelete(null);
  };

  const askRemoveFigure = (ctx) => {
    const figKey = ctx && ctx.figKey;
    if (!figKey) return;
    const count = countAssetMentions(liveDraft, `figure:${figKey}`);
    if (!count) { doRemoveFigure(figKey, ctx.sectionId); return; }
    const a = assetById.get(`figure:${figKey}`) || null;
    setFigureDelete({
      figKey, count, sectionId: ctx.sectionId,
      label: a ? assetNumberLabel(m, a) : 'this figure',
    });
  };

  const status = sectionStatus(section);
  const isTitle = sel === 'title';
  const isAbstract = sel === 'abstract';
  const sectionLabelOf = (id) => draftSectionLabel(m.activeDraft, id) || 'Section';

  /* ══════════ 118.md §13/§18 — the ONE editor prop factory ══════════
   *
   * Both views mount from this. Section View calls it for the selected section;
   * Continuous View calls it once per body section. Because the props are built in
   * one place, "citations / cross-references / tables / placeholders / undo work in
   * Continuous View" is not a second implementation that could drift — it is the
   * same one.
   *
   * `mountKey` (not `key`) is returned as an ordinary prop and applied by the
   * caller: the DOM is rendered from props exactly once per key — section identity
   * + generation stamp — and the mount value is the COMMITTED draft, never a
   * buffer, so a keyed remount can never resurrect stale text.
   */
  const editorProps = (id) => {
    const sec = sections[id] || {};
    const secLocked = !!sec.locked;
    const h = handles[id];
    return {
      /* 119.md §7 — `contentEpoch` joins the key: a snapshot restore and a
         structure merge both replace a section's text without moving its
         generation stamp, and an editor that did not remount would show the old
         paragraph and then commit it back over the new one. */
      mountKey: `${m.activeId}:${id}:${sec.lastGeneratedAt || ''}:${m.contentEpoch || 0}`,
      apiRef: h ? h.apiRef : undefined,
      // Section View keeps the historical single test id; the continuous document
      // needs one per mounted section (ten editors on one page).
      testId: continuous ? `stitch-manuscript-rich-editor-${id}` : 'stitch-manuscript-rich-editor',
      value: sec.content || '',
      orderMap,
      assetNumbers,
      // 101.md §4/§5/§6 — the live fact layer. `facts` makes project values resolve
      // at render (so no refresh action exists), and `showChanges` toggles ONLY the
      // overlay: the markdown behind the editor is byte-identical in both modes.
      facts: m.resolvedFacts,
      factOverrides: m.factOverrides,
      factChanges: (m.activeDraft && m.activeDraft.factLog) || null,
      showChanges: m.showChanges,
      // 102.md §3 — keep the panel's "current field" marker in step when the
      // researcher reaches a placeholder by clicking rather than by pressing Next.
      onPlaceholderFocus: (label) => {
        const hit = (m.placeholders || []).find((x) => x.sectionId === id && x.label === label);
        if (hit) m.setCurrentPlaceholderId && m.setCurrentPlaceholderId(hit.id);
      },
      onChange: (md) => commitSection(id, md),
      onActivate: h ? h.activate : setActive,
      readOnly: secLocked,
      // 116.md §61 — report the caret's table context for the floating table
      // controls (never while locked: no edits are possible).
      onTableFocus: secLocked ? null : ((ctx) => setTableCtx(ctx ? { ...ctx, sectionId: id } : null)),
      /* 119.md §5 — uploaded figures. `figures` is what the editor paints each
         placed picture from (one derived map, shared with the panel and the
         export); `onImageFiles` is the ONE upload seam behind the file picker,
         clipboard paste AND drag-and-drop, so all three run the same server-side
         validation. A locked section takes neither (no edits are possible). */
      figures: m.figureInfo,
      onImageFiles: secLocked ? null : (async (files) => {
        const created = await m.uploadFigures(files);
        return created.map((f) => ({ figKey: f.figKey, title: '' }));
      }),
      onFigureFocus: secLocked ? null : ((info) => setFigureCtx(info ? { ...info, sectionId: id } : null)),
      // 117.md §4/§8/§10/§11 — the manuscript-object layer.
      knownAssetIds,
      templateId: m.activeDraft.templateId,
      existingTableIds,
      onAssetChipMenu: (info) => { setChipHover(null); setRelinking(false); setChipMenu({ ...info, sectionId: id }); },
      onAssetChipHover: (info) => setChipHover(info ? { ...info, sectionId: id } : null),
      onTableMeta: m.setTableMeta,
      // 117.md §37/§38/§39 — the citation layer: style-aware chip labels, the
      // reference metadata behind them, and the two chip callbacks.
      citationStyle: m.activeDraft.citationStyle,
      refsById: m.refsById,
      yearSuffixes: m.citationYearSuffixes,
      onCiteChipMenu: (info) => openCiteMenu({ ...info, sectionId: id }),
      onCiteChipHover: (info) => setCiteHover(info ? { ...info, sectionId: id } : null),
      ariaLabel: sectionLabelOf(id),
      placeholder: 'Write this section here, or generate it from your project data. Use the toolbar for headings, lists and citations.',
      /* 120.md §6 — native spellcheck coordination. Only ever false while the
         assistant is ENABLED for this user, and only for the manuscript editor: the
         browser's own checker keeps working everywhere else in the app, and comes
         straight back when the assistant is switched off (a prop, not a remount). */
      nativeSpellcheck: !(wa && wa.suppressNativeSpellcheck),
      /* The live root, handed to the decoration layer. It only READS this element —
         the underlines live in CSS.highlights, outside the DOM. */
      onRootRef: (wa && h) ? h.rootRef : null,
    };
  };

  /* 118.md §8.1 — the props that belong to a SECTION rather than to one rendered
   * field: the asset registry, the fact layer, the citation layer and the chip
   * callbacks. Body sections take them straight off `editorProps`; the abstract
   * renders one editor per subsection, so it needs the same bag handed to each of
   * them. Building it by projection from `editorProps(id)` (never by re-listing the
   * values) is what keeps §8.1 from regressing: a new shared prop added to the
   * factory reaches the abstract by being named here, and the values themselves
   * still have exactly one source.
   *
   * Excluded on purpose: `value`/`onChange`/`mountKey`/`apiRef`/`testId`/`ariaLabel`/
   * `placeholder` (per-field identity, owned by the field that renders), and
   * `onTableFocus` — the floating table controls are deliberately not rendered over
   * the abstract in Section View, so reporting a caret's table context from there
   * would only set state nothing consumes.
   */
  const sharedFieldProps = (id) => {
    const p = editorProps(id);
    return {
      orderMap: p.orderMap,
      assetNumbers: p.assetNumbers,
      knownAssetIds: p.knownAssetIds,
      templateId: p.templateId,
      existingTableIds: p.existingTableIds,
      // 101.md §4/§5/§6 — the live fact layer.
      facts: p.facts,
      factOverrides: p.factOverrides,
      factChanges: p.factChanges,
      showChanges: p.showChanges,
      onPlaceholderFocus: p.onPlaceholderFocus,
      // 119.md §5 — the figure layer reaches the abstract's sub-editors too, so a
      // picture pasted there renders and uploads exactly as it does in the body.
      figures: p.figures,
      onImageFiles: p.onImageFiles,
      // 117.md §10/§11 — cross-reference chips.
      onAssetChipMenu: p.onAssetChipMenu,
      onAssetChipHover: p.onAssetChipHover,
      onTableMeta: p.onTableMeta,
      // 117.md §37/§38/§39 — the citation layer: style-aware chip labels (Harvard
      // author-year included), the reference metadata behind them, and both chip
      // callbacks. Every one of these carries `sectionId: id`, so an action opened
      // from a chip in the abstract routes back to the abstract.
      citationStyle: p.citationStyle,
      refsById: p.refsById,
      yearSuffixes: p.yearSuffixes,
      onCiteChipMenu: p.onCiteChipMenu,
      onCiteChipHover: p.onCiteChipHover,
    };
  };

  /** The abstract is structured (MS-5), so it gets its own factory — same rules. */
  const abstractProps = () => {
    const sec = sections.abstract || {};
    const key = `${m.activeId}:abstract:${sec.lastGeneratedAt || ''}:${m.contentEpoch || 0}`;
    return {
      value: sec.content || '',
      templateId: m.activeDraft.templateId,
      orderMap,
      assetNumbers,
      // 117.md §8/§11 — same registry + caption template as the body sections.
      knownAssetIds,
      captionTemplateId: m.activeDraft.templateId,
      resetKey: key,
      onChange: (md) => commitSection('abstract', md),
      onActivate: handles.abstract ? handles.abstract.activate : setActive,
      // 120.md §5 — …and the un-registration the abstract never had.
      onRelease: handles.abstract ? handles.abstract.release : null,
      readOnly: !!sec.locked,
      // 118.md §8.1 — everything a body section's editor gets, reported as 'abstract'.
      fieldProps: sharedFieldProps('abstract'),
    };
  };

  /** 84.md — the provenance card, shared by both views (Continuous renders it per section). */
  const renderWhy = (sectionId, sec) => <WhySectionPanel section={sec || {}} sectionId={sectionId} />;

  const mainEditor = editorProps(sel);

  return (
    <div ref={rowRef} data-testid="stitch-manuscript-editor" data-view={view}
      style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <style>{RICH_EDITOR_CSS}</style>
      {/* 120.md §6 — the assistant's own stylesheet: the four ::highlight()
          registrations and the suggestion card's two hover rules. Injected beside
          RICH_EDITOR_CSS (the same precedent), never merged into
          MANUSCRIPT_TOOLBAR_CSS, whose every rule must stay scoped to `.ms-toolbar `. */}
      {wa && wa.enabled && <style>{WA_UI_CSS}</style>}
      {/* §6 — the anchored suggestion card. Rendered ONCE for the panel (there is one
          active issue at a time) and positioned `fixed` against the resolved range,
          so no editor container's overflow can clip it. */}
      {wa && wa.enabled && <WritingAssistantCard wa={wa} />}
      {/* 117.md §11 — deleting a cited table warns first, then allows it. */}
      <TableDeleteDialog info={tableDelete} onConfirm={confirmDeleteTable} onCancel={() => setTableDelete(null)} />
      {/* 119.md §5 — the referenced-figure removal warning. */}
      <FigureDeleteDialog info={figureDelete}
        onConfirm={() => doRemoveFigure(figureDelete.figKey, figureDelete.sectionId)}
        onCancel={() => setFigureDelete(null)} />
      {/* 119.md §5 — the ONE hidden picker behind "Insert picture" and "Replace".
          Which of the two it serves is decided by `figureTargetSection`, so there is
          never a second upload path to keep in step. */}
      <input ref={figureFileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
        data-testid="stitch-manuscript-figure-file" style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files && e.target.files[0];
          e.target.value = '';
          if (!file) { setFigureTargetSection(null); return; }
          const target = figureTargetSection;
          setFigureTargetSection(null);
          if (target && target.figureId) { await m.replaceFigureFile(target.figureId, file); return; }
          const created = await m.uploadFigures([file]);
          const api = apiFor(target && target.sectionId) || getApi();
          for (const f of created) if (api && api.insertFigure) api.insertFigure(f.figKey, '');
        }} />
      {/* Honest, non-blocking upload feedback (§5 "corrupted files" / governance). */}
      {m.figureError && (
        <div style={{ maxWidth: 760, margin: '0 auto 10px' }}>
          <InfoBox color={C.red}>
            <span data-testid="stitch-manuscript-figure-error">{m.figureError}</span>
          </InfoBox>
        </div>
      )}

      {/* ── left: outline (118.md §15 — present in BOTH views) ──
          In the continuous document it also STAYS present: the page is ten sections
          long, so a navigator that scrolled away with the prose would satisfy §15
          only until the reader used it once. It pins below the sticky toolbar (whose
          height is measured, not assumed) and scrolls internally when the outline is
          taller than the screen. Section View shows one section at a time, so its
          outline is already beside what it navigates. */}
      <div data-testid="stitch-manuscript-outline" data-sticky={stickyOutline ? 'true' : undefined}
        style={{
          width: 216, flexShrink: 0, minWidth: 180, flex: '0 1 216px',
          ...(stickyOutline ? {
            position: 'sticky', top: barH + 8,
            maxHeight: `calc(100vh - ${barH + 48}px)`, overflowY: 'auto', overflowX: 'hidden',
          } : {}),
        }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {draftSectionTypes(liveDraft).map((s) => {
            const sec = sections[s.id] || {};
            const st = sectionStatus(sec);
            const active = s.id === sel;
            const subs = outline[s.id] || [];
            return (
              <div key={s.id}>
                <button onClick={() => goToSection(s.id)}
                  data-testid={`stitch-manuscript-section-${s.id}`}
                  data-active={active ? 'true' : undefined}
                  aria-current={active ? 'true' : undefined}
                  title={continuous ? `Scroll to ${s.label}` : `Open ${s.label}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', cursor: 'pointer',
                    width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit',
                    border: `1px solid ${active ? alpha(C.acc, '40') : 'transparent'}`,
                    background: active ? alpha(C.acc, '12') : 'transparent',
                    color: active ? C.txt : C.txt2, fontWeight: active ? 600 : 500,
                  }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor(st), flexShrink: 0, border: st === 'empty' ? `1px solid ${C.brd2}` : 'none' }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                  {sec.locked && (
                    <span title="Locked — generation skips this section" style={{ color: C.muted, display: 'inline-flex', flexShrink: 0 }}
                      data-testid={`stitch-manuscript-outline-lock-${s.id}`}>
                      <Icon name="lock" size={10} />
                    </span>
                  )}
                  {outdatedMap[s.id] && (
                    <span title="Project data changed since this was generated"
                      data-testid={`stitch-manuscript-outline-outdated-${s.id}`}
                      style={{ fontSize: 8.5, fontWeight: 700, color: C.yel, letterSpacing: 0.4, textTransform: 'uppercase', flexShrink: 0 }}>
                      Outdated
                    </span>
                  )}
                </button>
                {subs.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: '1px 0 3px' }}>
                    {subs.map((h) => (
                      <button key={`${s.id}-${h.headingIndex}`} onClick={() => jumpTo(s.id, h.headingIndex)}
                        title={h.text}
                        data-testid={`stitch-manuscript-outline-${s.id}-${h.headingIndex}`}
                        style={{
                          textAlign: 'left', cursor: 'pointer', border: 'none', background: 'transparent',
                          color: C.muted, fontSize: 11, fontFamily: 'inherit', lineHeight: 1.5,
                          padding: `2px 8px 2px ${h.level === 1 ? 27 : 39}px`,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                        {h.text}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 10, fontSize: 10.5, color: C.muted, lineHeight: 1.6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: C.grn }} /> Edited</span>{'  '}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 8 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: C.yel }} /> Auto-draft</span>{'  '}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 8 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: C.dim, border: `1px solid ${C.brd2}` }} /> Empty</span>
        </div>
      </div>

      {/* ── center: paper page ── */}
      <div style={{ flex: '1 1 460px', minWidth: 300 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* 118.md §11 — in the continuous document every section carries its own
                status row, so the page chrome names the DOCUMENT instead of
                repeating one section's state above ten sections. */}
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.txt }}>
              {continuous ? 'Full manuscript' : sectionLabelOf(sel)}
            </h3>
            {!continuous && locked && (
              <span style={tagS('purple')} data-testid="stitch-manuscript-locked-badge">
                <Icon name="lock" size={9} /> Locked
              </span>
            )}
            {!continuous && status === 'ai-draft' && <span style={tagS('yellow')}>Auto-draft — verify</span>}
            {!continuous && status === 'edited' && <span style={tagS('green')}>Edited</span>}
            {!continuous && isOutdated && (
              <span style={tagS('yellow')} data-testid="stitch-manuscript-outdated-badge"
                title="Project data changed since this was generated">
                Outdated
              </span>
            )}
            {continuous && (
              <span style={{ fontSize: 11, color: C.muted }}>
                Scroll to read and edit the whole document — every section is live.
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {!continuous && isOutdated && !locked && (
              <button onClick={() => doGenerate([sel])}
                title="Regenerate this section from the latest project data"
                data-testid="stitch-manuscript-regenerate"
                style={{ ...btnS('ghost'), fontSize: 11 }}>
                <Icon name="refresh" size={12} /> Regenerate
              </button>
            )}
            {!continuous && (
              <button onClick={() => m.setSectionLocked && m.setSectionLocked(sel, !locked)}
                aria-pressed={locked}
                aria-label={locked ? `Unlock ${sectionLabelOf(sel)}` : `Lock ${sectionLabelOf(sel)}`}
                title={locked ? 'Unlock this section — editing and regeneration become available again' : 'Lock this section — read-only, and generation always skips it'}
                data-testid="stitch-manuscript-lock-toggle"
                style={{ ...btnS(locked ? 'primary' : 'ghost'), fontSize: 11 }}>
                <Icon name="lock" size={12} /> {locked ? 'Unlock' : 'Lock'}
              </button>
            )}
            {!continuous && (
              <button onClick={() => setWhyOpen((v) => !v)} aria-expanded={whyOpen}
                aria-label="Why does this section say this?"
                title="Show what this section was generated from and what it depends on"
                data-testid="stitch-manuscript-why-toggle"
                style={{ ...btnS(whyOpen ? 'primary' : 'ghost'), fontSize: 11 }}>
                <Icon name="info" size={12} /> Why?
              </button>
            )}
            <button onClick={() => setToolsOpen((v) => !v)} aria-label={toolsOpen ? 'Hide tools panel' : 'Show tools panel'}
              title={toolsOpen ? 'Hide tools panel' : 'Show tools panel'}
              data-testid="stitch-manuscript-tools-toggle"
              style={{ ...btnS('ghost'), fontSize: 11 }}>
              <Icon name="layers" size={12} /> {toolsOpen ? 'Hide tools' : 'Tools'}
            </button>
          </div>
        </div>

        {/* 73.md Part 9 — per-section provenance (stamped at generation time) */}
        {!continuous && Array.isArray(section.sources) && section.sources.length > 0 && (
          <div data-testid="stitch-manuscript-sources"
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>Generated from</span>
            {section.sources.map((s) => <span key={s.key} style={tagS('blue')}>{s.label}</span>)}
          </div>
        )}
        {!continuous && Array.isArray(section.missing) && section.missing.length > 0 && (
          <div data-testid="stitch-manuscript-missing" style={{ fontSize: 11, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
            Missing: {section.missing.slice(0, 2).map((x) => x.hint).join(' · ')}
          </div>
        )}

        {/* 84.md — "Why does this say this?" provenance detail (sources / missing /
            last generated / declared dependencies). Compact; keyboard-toggled. */}
        {!continuous && whyOpen && (
          <WhySectionPanel section={section} sectionId={sel} />
        )}

        {genNotice && (
          <div style={{ marginBottom: 12 }}>
            <InfoBox color={C.yel}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span data-testid="stitch-manuscript-gen-notice">
                  {genNotice.skipped.length > 0 && `${genNotice.skipped.length} section(s) you edited were preserved and not overwritten.`}
                  {genNotice.skipped.length > 0 && genNotice.skippedLocked.length > 0 && ' '}
                  {genNotice.skippedLocked.length > 0 && `${genNotice.skippedLocked.length} locked section(s) were skipped.`}
                </span>
                <span style={{ display: 'flex', gap: 8 }}>
                  {genNotice.skipped.length > 0 && (
                    <button onClick={doOverwrite} style={{ ...btnS('danger'), fontSize: 11 }}>Overwrite anyway</button>
                  )}
                  <button onClick={() => setGenNotice(null)} style={{ ...btnS('ghost'), fontSize: 11 }}>
                    {genNotice.skipped.length > 0 ? 'Keep edits' : 'OK'}
                  </button>
                </span>
              </div>
            </InfoBox>
          </div>
        )}

        {/* 102.md §5 — always in view while anything is outstanding, so manual
            completion is "almost impossible to overlook" (§81). */}
        {(m.placeholderStats && (m.placeholderStats.manual || m.placeholderStats.pending)) ? (
          <div style={{ marginBottom: 8 }}>
            <ManualFieldsPanel
              stats={m.placeholderStats}
              groups={m.placeholderGroups}
              currentId={m.currentPlaceholderId}
              onPrev={() => stepToPlaceholder(-1)}
              onNext={() => stepToPlaceholder(1)}
              onGo={goToPlaceholder}
            />
          </div>
        ) : null}
        {/* 118.md §18 — the formatting toolbar serves whichever editor last held the
            caret, which is exactly what a ten-editor document needs.

            r2 (§71) — and in Continuous View it STICKS. A writer four thousand
            pixels into the document had scrolled the only formatting and citation
            controls off the top of the page; the tools column is not a substitute
            (it has no Bold, no Italic, no heading levels). It pins directly beneath
            the manuscript toolbar, whose height is MEASURED (`barH`, the same value
            the outline pins against, so the two never disagree at a responsive
            density change), at z=19 — under the manuscript toolbar's 20, above the
            prose. When the bar has not been measured yet (SSR, no ResizeObserver)
            barH is 0 and this degrades to a normal, non-sticky toolbar rather than
            pinning to the wrong place. It stays inside the document COLUMN, so the
            §15 outline column beside it is untouched at every width. */}
        {/* 120.md §5 — the honest refusal. Shown INSTEAD of an insertion when the
            bookmarked position cannot be resolved safely: nothing was written and
            nothing was deleted, so the only thing to do is dismiss it and put the
            caret back. Sits directly above the toolbar that opened the picker, in
            both views, and clears itself the next time a picker opens. */}
        {insertNotice && (
          <div style={{ marginBottom: 10 }}>
            <InfoBox color={C.yel}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span data-testid="stitch-manuscript-insert-notice" role="status" aria-live="polite">
                  {insertNotice}
                </span>
                <button onClick={() => setInsertNotice(null)}
                  data-testid="stitch-manuscript-insert-notice-ok"
                  style={{ ...btnS('ghost'), fontSize: 11 }}>OK</button>
              </div>
            </InfoBox>
          </div>
        )}
        {(continuous || !isTitle) && (
          <div
            data-testid="stitch-manuscript-toolbar-dock"
            data-sticky={continuous && barH > 0 ? 'true' : undefined}
            style={continuous && barH > 0 ? {
              position: 'sticky', top: barH, zIndex: 19,
              // Opaque, or the prose scrolls visibly through the pinned bar.
              background: C.bg, paddingTop: 6, marginTop: -6,
            } : undefined}
          >
            <RichToolbar getApi={getApi} citeRefs={citeRefs} refLabel={refLabel} disabled={toolsLocked}
              /* 117.md §9 — Insert → Cross-reference, at the caret, with search. */
              crossRefs={crossRefItems} onInsertCrossRef={insertAssetRef}
              /* 117.md §34/§35 — Insert → Citation, searchable + multi-select. */
              onInsertCitation={insertCitation}
              /* 120.md §5 — bookmark the caret before either picker opens; clear it
                 when one closes without inserting. */
              onInsertSessionStart={beginInsertSession}
              onInsertSessionEnd={endInsertSession}
              /* 121.md §1 — Insert → Symbol, through the same session. */
              onInsertSymbol={insertSymbol}
              /* 119.md §5 — Insert → Picture. Opens the ONE hidden file input; the
                 upload, the validation and the marker insertion are the same path
                 paste and drag-and-drop take. */
              onInsertPicture={m.uploadFigures ? (() => {
                setFigureTargetSection({ sectionId: sel });
                if (figureFileRef.current) { figureFileRef.current.value = ''; figureFileRef.current.click(); }
              }) : null} />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {/* 118.md §11/§14 — ONE page. Continuous View fills it with the whole
              document; Section View with the selected section. position:relative
              anchors the 116.md §61 floating table controls and every chip popover,
              which is why they stay siblings of the content in BOTH views. */}
          <div ref={pageRef} className="ms-paper" data-testid="stitch-manuscript-page"
            style={{ width: '100%', maxWidth: 760, padding: '44px 52px 56px', minHeight: 480, boxSizing: 'border-box', position: 'relative' }}>
            {continuous ? (
              <ContinuousView
                m={m}
                editorProps={editorProps}
                abstractProps={abstractProps}
                renderWhy={renderWhy}
                onActiveSection={setSel}
                suppressRef={suppressActiveRef}
                onRegenerate={(id) => doGenerate([id])}
                onToggleLock={(id, next) => m.setSectionLocked && m.setSectionLocked(id, next)}
                onOpenReferences={() => onNavigate && onNavigate('references')}
                stickyOffset={barH}
              />
            ) : isTitle ? (
              /* r3 — the SAME TitleBlock the continuous document renders. This
                 branch used to be a second hand-written copy in literal hex; the
                 shared component (INK canonical — the page is white in both themes)
                 is now the only place the title/keywords UI exists. State stays
                 here: `titleBuf` has Section View's own remount rule. */
              <TitleBlock
                value={titleBuf}
                keywords={kw}
                locked={locked}
                onTitle={onTitleType}
                onKeywords={(raw, list) => { setKw(raw); m.setMetaDebounced({ keywords: list }); }} />
            ) : isAbstract ? (
              <AbstractEditor {...abstractProps()} />
            ) : (
              <RichSectionEditor key={mainEditor.mountKey} ref={mainEditor.apiRef} {...mainEditor} />
            )}
            {/* 116.md §61/§62 — floating row/col/table ops while the caret is in a table */}
            {tableCtx && (continuous || (!isTitle && !isAbstract && !locked)) && (
              <TableContextBar ctx={tableCtx} pageEl={pageRef.current}
                getApi={() => apiFor(tableCtx.sectionId) || getApi()}
                onDeleteTable={askDeleteTable} />
            )}
            {/* 119.md §5 — the same floating pattern for an uploaded figure. */}
            {figureCtx && (continuous || (!isTitle && !isAbstract && !locked)) && (
              <FigureContextBar ctx={figureCtx} pageEl={pageRef.current}
                getApi={() => apiFor(figureCtx.sectionId) || getApi()}
                onReplace={askReplaceFigure}
                onResize={(ctx, w) => m.queueAssetPatch(`figure:${ctx.figKey}`, { displayWidth: w })}
                onAlign={(ctx, a) => m.queueAssetPatch(`figure:${ctx.figKey}`, { align: a })}
                onRemove={askRemoveFigure} />
            )}
            {/* 117.md §10 — hover preview, suppressed while the action menu is open */}
            {(continuous || !isTitle) && !chipMenu && chipHover && (
              <AssetRefHoverCard info={chipHover} asset={hoverAsset} pageEl={pageRef.current} />
            )}
            {/* 117.md §38 — citation hover preview + action menu, same rules */}
            {(continuous || !isTitle) && !citeMenu && citeHover && (
              <CiteHoverCard info={citeHover} refs={refsOf(citeHover)} pageEl={pageRef.current}
                yearSuffixes={m.citationYearSuffixes} />
            )}
            {(continuous || !isTitle) && citeMenu && (
              <CiteRefMenu info={citeMenu} refs={refsOf(citeMenu)} pageEl={pageRef.current}
                yearSuffixes={m.citationYearSuffixes}
                onView={(id) => { closeCiteMenu(); onOpenReference && onOpenReference(id, 'view'); }}
                onEdit={(id) => { closeCiteMenu(); onOpenReference && onOpenReference(id, 'edit'); }}
                onOpenPdf={(id) => { closeCiteMenu(); onOpenReference && onOpenReference(id, 'pdf'); }}
                onGoToReferences={() => { closeCiteMenu(); onOpenReference && onOpenReference(null, 'list'); }}
                onRemove={removeCitation}
                onClose={closeCiteMenu} />
            )}
            {/* 117.md §10/§11 — the chip action menu (and its relink picker) */}
            {(continuous || !isTitle) && chipMenu && (
              <AssetRefMenu info={chipMenu} asset={chipAsset} pageEl={pageRef.current}
                relinking={relinking} relinkItems={crossRefItems}
                onGo={() => { const id = chipMenu.id; closeChipMenu(); goToAsset(id); }}
                onEdit={() => { const id = chipMenu.id; closeChipMenu(); editAsset(id); }}
                onStartRelink={() => setRelinking(true)}
                onRelink={relinkChipRef}
                onRemove={removeChipRef}
                onClose={closeChipMenu} />
            )}
          </div>
        </div>
      </div>

      {/* ── right: tools (collapsible; stacks below on narrow screens via wrap) ── */}
      {toolsOpen && (
        <div data-testid="stitch-manuscript-tools" style={{ width: 264, minWidth: 220, flex: '0 1 264px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 118.md §44 — the "Save status" card that used to open this column is
              GONE. The state now lives in the sticky manuscript toolbar, which is on
              screen at every scroll position of every destination; keeping a second
              copy here duplicated the test id, competed for the same glance and gave
              the tools column a header that was not a tool. Same pill, one home. */}

          {/* 101.md §6/§34 — Show Changes lives with the tools, not in the page
              chrome, so a researcher who never turns it on never sees it. The
              toggle is view-only state; the manuscript content does not move. */}
          <ChangeTrackingPanel
            groups={m.changeGroups}
            showChanges={m.showChanges}
            onToggle={m.setShowChanges}
            // A change identifies a FACT, not a section — the same fact can appear
            // in several sections. Jump to the first section that states it.
            onNavigate={(change) => {
              const id = change && sectionStatingFact(liveDraft, change.key);
              if (id) goToSection(id);
            }}
          />

          <ToolsGroup id="generate" title="Generate" defaultOpen>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => doGenerate([sel])} disabled={locked}
                title={locked ? 'This section is locked — unlock it to regenerate.' : 'Generate this section from project data'}
                style={{ ...btnS('ghost'), justifyContent: 'center', opacity: locked ? 0.5 : 1, cursor: locked ? 'not-allowed' : undefined }}>
                <Icon name="refresh" size={12} /> Generate {continuous ? sectionLabelOf(sel) : 'this section'}
              </button>
              <button onClick={() => doGenerate(null)} data-testid="stitch-manuscript-generate" style={{ ...btnS('primary'), justifyContent: 'center' }}>
                <Icon name="sigma" size={13} /> Generate all sections
              </button>
              <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>Sections you edited are preserved — you are asked before anything is overwritten. Locked sections are always skipped.</div>
            </div>
          </ToolsGroup>

          <ToolsGroup id="insert" title="Insert">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* 117.md §34/§35 — the Tools entry point to the SAME searchable,
                  multi-select picker the toolbar uses. It replaces the old bare
                  <select>, which could not search and could not express a
                  multi-reference citation. */}
              {/* r2 — the caret's own section gates these, not the scroll position. */}
              <CiteRefPicker items={citeItems} disabled={(!continuous && isTitle) || toolsLocked} block
                testIdPrefix="stitch-manuscript-tools-cite"
                /* 120.md §5 — the Tools entry point runs the same picker session as
                   the toolbar one: same bookmark, same honest refusal. */
                onSessionStart={beginInsertSession} onSessionEnd={endInsertSession}
                label="+ Insert citation…" onInsert={insertCitation} />
              {citeRefs.length === 0 && (
                <div style={{ fontSize: 10.5, color: C.muted }}>References appear here once your project has included studies.</div>
              )}
              <button onClick={insertPrisma} disabled={(!continuous && isTitle) || toolsLocked}
                aria-label="Insert PRISMA study-selection summary at the cursor"
                title="Insert the PRISMA study-selection paragraph (from your live counts) as editable text"
                data-testid="stitch-manuscript-insert-prisma"
                style={{ ...btnS('ghost'), justifyContent: 'center', opacity: ((!continuous && isTitle) || toolsLocked) ? 0.5 : 1 }}>
                <Icon name="flow" size={12} /> Insert PRISMA summary
              </button>
              {/* 117.md §9 — the Tools entry point to the SAME picker the toolbar
                  uses (search + number + origin, inserted at the caret). It
                  replaces the old bare <select>, which had no search, could not
                  show a number, and spliced a block into the sentence. */}
              {availableAssets.length > 0 && (
                <CrossRefPicker items={crossRefItems} disabled={(!continuous && isTitle) || toolsLocked} block
                  testIdPrefix="stitch-manuscript-tools-crossref"
                  label="⧉ Reference a table/figure…"
                  /* 120.md §5 — same picker session as the toolbar control. */
                  onSessionStart={beginInsertSession} onSessionEnd={endInsertSession}
                  onPick={insertAssetRef} />
              )}
            </div>
          </ToolsGroup>

          {m.insights && m.insights.length > 0 && (
            <Card style={{ padding: 12 }}>
              <ToolsLabel>Smart insights</ToolsLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {m.insights.slice(0, 3).map((ins) => (
                  <div key={ins.key} style={{ fontSize: 11, color: C.txt2, lineHeight: 1.5, display: 'flex', gap: 6 }}>
                    <span style={{ color: ins.severity === 'warning' ? C.yel : C.acc, fontWeight: 700, flexShrink: 0 }}>
                      {ins.severity === 'warning' ? 'Check' : 'Note'}
                    </span>
                    <span>{ins.message}</span>
                  </div>
                ))}
                {m.insights.length > 3 && (
                  <div style={{ fontSize: 10.5, color: C.muted }}>+{m.insights.length - 3} more in Overview</div>
                )}
              </div>
            </Card>
          )}

          {exporters && (
            <ToolsGroup id="export" title="Export">
              <ExportButtons exporters={exporters} />
              {/* 121.md §3 — an UNANNOUNCED echo. The announced, focused and
                  scrolled-to copy is the workspace's ExportFeedbackRegion; this one keeps
                  the message beside the button that was pressed and carries no role and no
                  aria-live, so a screen reader hears the failure exactly once. */}
              {exporters.exportError && <InfoBox color={C.red}>{exporters.exportError}</InfoBox>}
            </ToolsGroup>
          )}
        </div>
      )}
    </div>
  );
}

function ToolsLabel({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>
      {children}
    </div>
  );
}

/* 84.md — per-section "Why does this say this?" detail: the live sources it was
   generated from, what it still needs, when it was generated, and the project
   facts it depends on (a change to any of them surfaces in the Updates tab). */
function WhySectionPanel({ section, sectionId }) {
  const sources = Array.isArray(section.sources) ? section.sources : [];
  const missing = Array.isArray(section.missing) ? section.missing : [];
  const storedKeys = (section.depState && typeof section.depState === 'object')
    ? Object.keys(section.depState) : (SECTION_DEPENDENCIES[sectionId] || []);
  const deps = explainKeys(storedKeys);
  return (
    <Card data-testid="stitch-manuscript-why" style={{ padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <ToolsLabel>Generated from</ToolsLabel>
          {sources.length ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {sources.map((s) => <span key={s.key} style={tagS('blue')}>{s.label}</span>)}
            </div>
          ) : <span style={{ fontSize: 11, color: C.muted }}>Not generated yet — write it, or generate it from your project data.</span>}
        </div>
        <div>
          <ToolsLabel>Depends on</ToolsLabel>
          {deps.length ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {deps.map((d) => <span key={d.key} style={tagS(CATEGORY_TONE[d.category] || 'gray')}>{d.label}</span>)}
            </div>
          ) : <span style={{ fontSize: 11, color: C.muted }}>No tracked dependencies.</span>}
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
            A change to any of these can flag this section for review in the Updates tab.
          </div>
        </div>
        {missing.length > 0 && (
          <div>
            <ToolsLabel>Still missing</ToolsLabel>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
              {missing.map((mi, i) => <li key={mi.field || i}>{mi.hint || mi.field}</li>)}
            </ul>
          </div>
        )}
        <div style={{ fontSize: 10.5, color: C.muted }}>Last generated: {fmtTime(section.lastGeneratedAt)}</div>
      </div>
    </Card>
  );
}

/* 84.md Part 6 — manuscript version snapshots: named restore points of the whole
   draft. Frozen snapshots are protected from deletion; Restore first takes an
   automatic safety snapshot (engine side) so it is undoable. */
function SnapshotsBlock({ m }) {
  const [label, setLabel] = useState('');
  const [frozen, setFrozen] = useState(false);
  const snaps = m.snapshots || [];
  const create = () => { if (m.createSnapshotNow) m.createSnapshotNow({ label: label.trim(), frozen }); setLabel(''); setFrozen(false); };
  const restore = (s) => {
    if (typeof window === 'undefined' || window.confirm('Restore this snapshot? The current draft text will be replaced. A safety snapshot of the current state is taken automatically first, so this can be undone.')) {
      if (m.restoreSnapshotById) m.restoreSnapshotById(s.id);
    }
  };
  const del = (s) => {
    if (s.frozen) return;
    if (typeof window === 'undefined' || window.confirm('Delete this snapshot? This cannot be undone.')) {
      if (m.removeSnapshotById) m.removeSnapshotById(s.id);
    }
  };
  return (
    <Card data-testid="stitch-manuscript-snapshots">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: snaps.length ? 14 : 0 }}>
        <Labeled label="Snapshot label" style={{ flex: '1 1 200px' }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Before reviewer revisions" aria-label="Snapshot label"
            data-testid="stitch-manuscript-snapshot-label" style={inp} />
        </Labeled>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.txt2, cursor: 'pointer', paddingBottom: 8 }}>
          <input type="checkbox" checked={frozen} onChange={(e) => setFrozen(e.target.checked)}
            aria-label="Freeze snapshot to protect it from deletion" />
          Freeze (protect from deletion)
        </label>
        <button onClick={create} data-testid="stitch-manuscript-snapshot-create" style={{ ...btnS('primary'), fontSize: 11 }}>
          <Icon name="plus" size={12} /> Create snapshot
        </button>
      </div>
      {snaps.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }} data-testid="stitch-manuscript-snapshot-list">
          {snaps.map((s, i) => (
            <div key={s.id} data-testid={`stitch-manuscript-snapshot-${s.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.brd}` }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt, flex: '1 1 160px' }}>{s.label || 'Untitled snapshot'}</span>
              {s.frozen && <span style={tagS('purple')}><Icon name="lock" size={9} /> Frozen</span>}
              <span style={{ fontSize: 10.5, color: C.muted }}>{fmtTime(s.createdAt || s.at)}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => restore(s)} aria-label={`Restore snapshot ${s.label || ''}`}
                  data-testid={`stitch-manuscript-snapshot-restore-${s.id}`}
                  style={{ ...btnS('ghost'), fontSize: 10.5, padding: '3px 10px' }}>Restore</button>
                <button onClick={() => del(s)} disabled={!!s.frozen}
                  aria-label={`Delete snapshot ${s.label || ''}`}
                  title={s.frozen ? 'Frozen snapshots are protected from deletion' : 'Delete this snapshot'}
                  data-testid={`stitch-manuscript-snapshot-delete-${s.id}`}
                  style={{ ...btnS('ghost'), fontSize: 10.5, padding: '3px 10px', opacity: s.frozen ? 0.5 : 1, cursor: s.frozen ? 'not-allowed' : undefined }}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      ) : <div style={{ fontSize: 11.5, color: C.muted }}>No snapshots yet. Create one to save a named restore point for the whole manuscript.</div>}
    </Card>
  );
}

/* 73.md Part 9 — progressive disclosure for the tools column. A native
   <details>/<summary> pair: keyboard-operable and screen-reader friendly out of
   the box, and the (hidden) content stays in the DOM so nothing inside is
   unmounted when collapsed. Generate is the only group open by default. */
function ToolsGroup({ id, title, defaultOpen = false, children }) {
  return (
    <Card style={{ padding: 12 }}>
      <details open={defaultOpen} data-testid={`stitch-manuscript-toolgroup-${id}`}>
        <summary style={{
          cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 8,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>{title}</span>
          <span aria-hidden="true" style={{ fontSize: 9, color: C.muted }}>▾</span>
        </summary>
        <div style={{ marginTop: 8 }}>{children}</div>
      </details>
    </Card>
  );
}

/**
 * UX-6: honest save pill — 'error' shows the failure and offers a retry.
 *
 * 117.md §J.13 — 'conflict' is the fourth state, and it arrives from the SHELL: the
 * autosave compare-and-set refused this client's write because another tab or a
 * collaborator saved first. Deliberately NO Retry — re-sending the divergent copy
 * would 409 again (Stitch) or clobber the newer server copy (legacy). The action is
 * to load the latest, which is what the shell's own banner/badge offers, so the pill
 * says which way to go instead of growing a second, competing affordance.
 */
/* 118.md §44 — the pill now lives in the sticky manuscript toolbar, so it is read at
   a glance rather than hunted for: a status DOT carries the state pre-attentively and
   the word confirms it. The four states, their wording, their test id and the
   "conflict never offers Retry" rule are all UNCHANGED — this is a re-skin of an
   honest indicator, not a new save channel. `role=status` + `aria-live=polite` is the
   §42 half of the same idea (the transition is announced, never trapped). */
const savePillBase = {
  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
  padding: '3px 11px 3px 9px', borderRadius: 99, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.2,
};

function SaveDot({ color, pulse }) {
  return (
    <span aria-hidden="true" style={{
      width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: color,
      boxShadow: pulse ? `0 0 0 3px ${alpha(color, '22')}` : 'none',
    }} />
  );
}

/* 120.md §2 — the pill's ON-PURPLE skin. The toolbar it lives in is now the solid
   Pecan purple, where the legacy status chips measured 1.8:1 (green), 2.1:1 (amber)
   and 2.8:1 (red) — unreadable. `onDark` swaps the three tones for values that read
   on that surface (mint #a7f3d0 = 6.46:1, amber #ffdca0 = 6.31:1, rose #ffc9c0 =
   5.66:1 on the pill's own well), keeps the DOT + word pairing so the state is never
   colour-only, and changes no wording, no test id and no save behaviour. The default
   (light) skin is untouched, because this component is also rendered on light cards
   by the unit tests and by any future host. */
const ON_DARK_SAVE_TONES = {
  green: '#a7f3d0',
  yellow: '#ffdca0',
  red: '#ffc9c0',
};
const savePillSkin = (tone, onDark) => (onDark
  ? {
    background: 'rgba(0,0,0,0.14)',
    border: `1px solid ${ON_DARK_SAVE_TONES[tone]}59`,
    color: ON_DARK_SAVE_TONES[tone],
  }
  : tagS(tone));
const saveDotColor = (tone, onDark) => (onDark
  ? ON_DARK_SAVE_TONES[tone]
  : ({ green: C.grn, yellow: C.yel, red: C.red })[tone]);

export function SaveStatusPill({ saveState, lastError, onRetry, onDark = false }) {
  if (saveState === 'conflict') {
    return (
      <span
        data-testid="stitch-manuscript-save-status"
        role="status"
        aria-live="polite"
        title="Another tab or collaborator saved first, so this change was refused. Load the latest version before editing further."
        style={{ ...savePillSkin('red', onDark), ...savePillBase }}
      >
        <SaveDot color={saveDotColor('red', onDark)} />
        Updated elsewhere — not saved
      </span>
    );
  }
  if (saveState === 'error') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexWrap: 'nowrap' }}>
        <span data-testid="stitch-manuscript-save-status" role="status" aria-live="polite"
          title={lastError || 'Could not save changes.'} style={{ ...savePillSkin('red', onDark), ...savePillBase }}>
          <SaveDot color={saveDotColor('red', onDark)} />
          Save failed
        </span>
        {onRetry && (
          <button type="button" onClick={onRetry} aria-label="Retry saving"
            className={onDark ? 'ms-tb-dark' : undefined}
            style={onDark
              ? {
                ...btnS('ghost'), fontSize: 10.5, padding: '3px 10px',
                color: ON_DARK_SAVE_TONES.red, borderColor: `${ON_DARK_SAVE_TONES.red}80`,
                background: 'rgba(0,0,0,0.14)',
              }
              : { ...btnS('danger'), fontSize: 10.5, padding: '3px 10px' }}>
            Retry
          </button>
        )}
      </span>
    );
  }
  const saving = saveState === 'saving';
  const tone = saving ? 'yellow' : 'green';
  return (
    <span data-testid="stitch-manuscript-save-status" role="status" aria-live="polite"
      style={{ ...savePillSkin(tone, onDark), ...savePillBase }}>
      <SaveDot color={saveDotColor(tone, onDark)} pulse={saving} />
      {saving ? 'Saving…' : 'Saved'}
    </span>
  );
}

/* ════════════ 3+4. TABLES & FIGURES — the Assets panels (85.md B2) ════════════
   Both sub-tabs are driven by the SAME derived asset registry the export uses
   (m.assets — computeManuscriptAssets), so what you see (numbers, inclusion,
   availability, staleness) is exactly what the .docx will do. */
function fmtTime(iso) { try { return iso ? new Date(iso).toLocaleString() : 'Not refreshed'; } catch { return 'Not refreshed'; } }

const assetTestSlug = (id) => String(id).replace(/:/g, '-');

/** Live number chip text — gated on sourcesSettled so numbers never flicker.
    117.md §8 — the visible label comes from the caption formatter seam, so the
    panel, the editor chip and the Word caption can never word a number differently. */
export function assetNumberLabel(m, asset) {
  const word = assetKindLabel(asset.kind);
  if (m.sourcesSettled === false) return `${word} …`;
  const byId = (m.assetNumbering && m.assetNumbering.byId) || {};
  const n = byId[asset.id];
  if (n == null) return 'Not in export';
  return formatAssetLabel(asset.kind, n, { templateId: (m.activeDraft && m.activeDraft.templateId) || null });
}

/**
 * 118.md §65 — where this object actually IS in the manuscript, or null.
 *
 * "This should not create duplicate objects": a MANUAL table's body is prose, so
 * its place is the section that holds it; a GENERATED object has no prose body, so
 * its place is the first sentence that cross-references it. Nothing is created —
 * the answer is derived from the live text, and it is honestly absent when the
 * object is not in the manuscript yet (§69: no control that cannot do anything).
 */
export function assetManuscriptTarget(m, asset) {
  if (!m || !asset) return null;
  if (asset.origin === 'manual' && asset.sectionId && asset.manualId) {
    return { sectionId: asset.sectionId, manualId: asset.manualId, assetId: asset.id };
  }
  const ids = new Set([asset.id, ...((asset.aliasIds) || [])]);
  for (const sec of orderedSections(m.liveDraft || m.activeDraft)) {
    for (const tk of findAssetTokens(sec.content)) {
      if (ids.has(tk.id)) return { sectionId: sec.id, assetId: tk.id };
    }
  }
  return null;
}

/** One asset's controls: number, editable title/caption(/legend), include toggle,
    honest badges, Insert-reference. Text edits are BUFFERED per panel and land
    as per-asset patches through queueAssetPatch (merge-at-flush). */
function AssetControls({ m, asset, buf, commit, onInsertNotice, onOpenAsset }) {
  const slug = assetTestSlug(asset.id);
  const ov = (buf && buf[asset.id]) || {};
  const numbering = m.assetNumbering || {};
  // 117.md §4 — a MANUAL table is prose. It cannot be "excluded" (that would mean
  // deleting text), and its title is not an override — see the Title field below.
  // 119.md §5 — a PLACED uploaded figure is prose in exactly the same sense: its
  // title is the caption line in the page, and "excluding" it would mean deleting
  // the block. An UNPLACED upload is neither — it is a file waiting for a place.
  const isUpload = asset.origin === 'upload';
  const isManual = asset.origin === 'manual' || (isUpload && asset.placed);
  const unplaced = isUpload && !asset.placed;
  const mentioned = !!(numbering.mentioned && numbering.mentioned.has && numbering.mentioned.has(asset.id));
  const autoIncluded = !!(numbering.autoIncluded && numbering.autoIncluded.has && numbering.autoIncluded.has(asset.id));
  // Optimistic: the buffered override wins so the toggle responds instantly
  // (persistence is debounced; prepareExport flushes it before validating).
  const includedNow = typeof ov.included === 'boolean' ? ov.included : (!!asset.included || autoIncluded);
  const patch = (p) => commit(asset.id, p);
  const numLabel = assetNumberLabel(m, asset);
  // 118.md §65 — null when this object is not in the manuscript text yet.
  const target = onOpenAsset ? assetManuscriptTarget(m, asset) : null;
  const onInsert = () => {
    const ok = m.insertAssetReference && m.insertAssetReference(asset.id);
    if (onInsertNotice) {
      onInsertNotice(ok
        ? 'Reference added to the end of Results — open the Editor to move it where it belongs.'
        : 'Results is locked — unlock it in the Editor before inserting a reference.');
    }
  };
  return (
    <div data-testid={`stitch-manuscript-asset-${slug}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Icon name={asset.kind === 'figure' ? 'barChart' : 'table'} size={13} />
        <span data-testid={`stitch-manuscript-asset-number-${slug}`}
          style={tagS(numLabel.startsWith('Not') ? 'gray' : 'blue')}>{numLabel}</span>
        <span style={tagS(asset.available ? 'green' : 'gray')}>{asset.available ? 'Available' : 'No data'}</span>
        {isManual && <span style={tagS('purple')} title="Typed in the manuscript, not generated from project data">In the text</span>}
        {/* 119.md §5 — honest status for a picture that has been uploaded but has
            no place in the argument yet (§69: never imply it is in the document). */}
        {unplaced && <span style={tagS('gray')} data-testid={`stitch-manuscript-asset-unplaced-${slug}`}
          title="Uploaded, but not yet placed in the manuscript">Not placed</span>}
        {asset.stale && <span style={tagS('yellow')}>Stale</span>}
        {mentioned
          ? <span style={tagS('purple')} title={autoIncluded ? 'Included because the text references it' : 'Referenced in the text'}>Referenced in text</span>
          : <span style={{ fontSize: 10.5, color: C.muted }}>Not referenced in the text</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.txt2, cursor: (asset.available && !isManual) ? 'pointer' : 'not-allowed' }}
            title={isManual ? (asset.kind === 'figure'
              ? 'This figure is placed in the manuscript text — remove it in the Editor to take it out'
              : 'This table is part of the manuscript text — delete it in the Editor to remove it')
              : unplaced ? 'Place it in the manuscript to include it in the export'
                : !asset.available ? 'No data yet — nothing to include'
                  : mentioned ? 'Referenced in the text — remove the reference to exclude it' : 'Include this in the Word export'}>
            <input type="checkbox" checked={includedNow}
              disabled={!asset.available || mentioned || isManual || unplaced}
              data-testid={`stitch-manuscript-asset-include-${slug}`}
              onChange={(e) => patch({ included: e.target.checked })}
              aria-label={`Include ${asset.title || asset.id} in the export`} />
            Include
          </label>
          <button onClick={onInsert} disabled={!asset.available}
            data-testid={`stitch-manuscript-asset-insert-${slug}`}
            title="Insert a live reference to this item into the manuscript text"
            style={{ ...btnS('ghost'), fontSize: 10.5, padding: '3px 10px', opacity: asset.available ? 1 : 0.5 }}>
            Insert reference
          </button>
          {/* 118.md §65 — jump to this object where it really lives. Rendered only
              when there IS somewhere to jump to; the specialized manager and the
              inline representation are the same entity, never two. */}
          {target && (
            <button onClick={() => onOpenAsset(target)}
              data-testid={`stitch-manuscript-asset-view-${slug}`}
              title={`Show this ${assetKindLabel(asset.id).toLowerCase()} in the manuscript`}
              style={{ ...btnS('ghost'), fontSize: 10.5, padding: '3px 10px' }}>
              View in manuscript
            </button>
          )}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {/* Title = the "{Table|Figure} N. Title" caption line; Caption = its own
            paragraph exported UNDER that line (it is never merged into the title). */}
        {isManual ? (
          // 117.md §4 — a manual table's title IS its caption line in the page, and
          // the page is the source of truth. Offering a second title field here
          // would create two answers to one question, so this states where the
          // title lives instead of quietly shadowing it.
          <Labeled label="Title" style={{ flex: '1 1 220px' }}>
            <div data-testid={`stitch-manuscript-asset-title-prose-${slug}`}
              style={{ fontSize: 11.5, color: C.txt2, lineHeight: 1.5 }}>
              {asset.title || <span style={{ color: C.muted }}>Untitled</span>}
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                Edit this {asset.kind === 'figure' ? 'figure' : 'table'}&rsquo;s title in its caption, in the Editor.
              </div>
            </div>
          </Labeled>
        ) : (
          <Labeled label="Title" style={{ flex: '1 1 220px' }}>
            <input value={ov.title || ''} placeholder={asset.title || 'Title…'}
              onChange={(e) => patch({ title: e.target.value })}
              aria-label={`${asset.title || asset.id} title override`}
              data-testid={`stitch-manuscript-asset-title-${slug}`} style={inp} />
          </Labeled>
        )}
        <Labeled label="Caption" style={{ flex: '2 1 260px' }}>
          <textarea value={ov.caption || ''}
            placeholder={`Optional caption exported under the “${asset.kind === 'figure' ? 'Figure' : 'Table'} N. Title” line…`}
            onChange={(e) => patch({ caption: e.target.value })}
            rows={1} aria-label={`${asset.title || asset.id} caption`}
            style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
        </Labeled>
        {asset.kind === 'figure' && (
          <Labeled label="Legend" style={{ flex: '2 1 260px' }}>
            <textarea value={ov.legend || ''} placeholder="Optional legend under the figure…"
              onChange={(e) => patch({ legend: e.target.value })}
              rows={1} aria-label={`${asset.title || asset.id} legend`}
              style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
          </Labeled>
        )}
      </div>
    </div>
  );
}

/** Buffered draft.assets edits shared by both panels. The buffer is DISPLAY
    state only: commits queue per-asset FIELD patches (m.queueAssetPatch) that
    merge over the CURRENT draft.assets at flush time — never a wholesale
    replacement from a mount-time snapshot, which silently reverted overrides
    written by the other panel (or a collaborator) after this panel mounted.
    It re-seeds from the draft whenever the overrides change while nothing is
    in flight, so other writers' values surface instead of going stale. */
function useAssetOverridesBuffer(m) {
  const draftAssets = (m.activeDraft && m.activeDraft.assets) || null;
  const [buf, setBuf] = useState(() => ({ ...(draftAssets || {}) }));
  useEffect(() => { setBuf({ ...((m.activeDraft && m.activeDraft.assets) || {}) }); }, [m.activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // saveState 'saved' ⇔ no queued/in-flight edit — re-seeding then can never
    // clobber typing, and after our own flush it echoes the merged result back.
    if (m.saveState === 'saved') setBuf({ ...(draftAssets || {}) });
  }, [draftAssets, m.saveState]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (assetId, patch) => {
    setBuf((prev) => ({ ...prev, [assetId]: { ...(prev[assetId] || {}), ...patch } }));
    m.queueAssetPatch(assetId, patch);
  };
  return [buf, commit];
}

/* ══════ 119.md §6 — the study-characteristics table, edited from HERE ══════
 *
 * §6: a value changed in the Manuscript Editor "must update the same structured source
 * model, not create a disconnected copy", and the editor "must clearly indicate that the
 * underlying extracted project data will change".
 *
 * So an editable cell here is NOT a manuscript field. Clicking one resolves the cell to
 * the extraction value behind it (`m.demographicsCell`) and shows exactly which study,
 * which field and which arm is about to change; saving routes through
 * `m.editDemographicsCell` -> the extraction write path (per-value provenance, autosave,
 * 108.md undo, collaborator preconditions). Cells the builder derives itself (Study,
 * Design, Outcome...) are not editable from here — they are edited where they live.
 */
export const DEMO_UPSTREAM_NOTICE = 'This changes the extracted project data, not just this table.';
export const DEMO_SAVED_NOTICE = 'Saved to Extraction — the study record now holds this value. Ctrl+Z undoes it.';
const demoSlug = (x) => String(x || '').replace(/[^a-zA-Z0-9]+/g, '-');

function DemographicsCellEditor({ m, columnKey, studyId, onClose }) {
  const ref = m.demographicsCell ? m.demographicsCell(columnKey, studyId) : null;
  const [draft, setDraft] = useState(() => (ref ? { ...ref.cell.values } : {}));
  const [state, setState] = useState(() => (ref ? ref.cell.state : ''));
  const [err, setErr] = useState('');
  if (!ref) return null;
  const t = statType(ref.cell.type) || statType(DEFAULT_STAT_TYPE);
  const slots = ref.isStat ? t.slots : ['value'];
  const who = `${ref.study.author || ref.study.title || 'this study'}${ref.study.year ? ` ${ref.study.year}` : ''}`;
  const save = () => {
    const values = {};
    for (const slot of slots) values[slot] = draft[slot] == null ? '' : draft[slot];
    const r = m.editDemographicsCell(columnKey, studyId, state ? { state } : { values, state: '' });
    if (!r || !r.ok) { setErr((r && r.detail) || 'That value could not be saved.'); return; }
    onClose(DEMO_SAVED_NOTICE);
  };
  return (
    <div data-testid="stitch-manuscript-demo-editor"
      style={{ border: `1px solid ${C.acc}`, borderRadius: 8, padding: 10, marginTop: 8, background: C.card }}>
      <div data-testid="stitch-manuscript-demo-upstream" style={{ fontSize: 11.5, color: C.txt, lineHeight: 1.6, marginBottom: 8 }}>
        <strong style={{ color: C.acc }}>{DEMO_UPSTREAM_NOTICE}</strong>{' '}
        Editing <strong>{ref.label}</strong>{ref.armLabel ? ` (${ref.armLabel})` : ''} for <strong>{who}</strong>
        {ref.isCase ? ' — an individual case row, not the publication.' : '.'}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {slots.map((slot) => (
          <label key={slot} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.muted }}>
            {ref.isStat ? t.slotLabels[slot] : ref.label}
            <input data-testid={`stitch-manuscript-demo-input-${slot}`} value={draft[slot] == null ? '' : String(draft[slot])}
              disabled={!!state} aria-label={`${ref.isStat ? t.slotLabels[slot] : ref.label} for ${who}`}
              onChange={(e) => setDraft((d) => ({ ...d, [slot]: e.target.value }))}
              style={{ ...inp, fontSize: 12, width: ref.isStat ? 84 : 200, padding: '3px 6px' }} />
          </label>
        ))}
        <select data-testid="stitch-manuscript-demo-state" value={state} aria-label="Value state"
          onChange={(e) => setState(e.target.value)} style={{ ...inp, fontSize: 11, width: 'auto', padding: '3px 6px' }}>
          <option value="">Value…</option>
          {DEMOGRAPHIC_VALUE_STATES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <button data-testid="stitch-manuscript-demo-save" onClick={save} style={{ ...btnS('primary'), fontSize: 11 }}>Save to extraction</button>
        <button onClick={() => onClose('')} style={{ ...btnS('ghost'), fontSize: 11 }}>Cancel</button>
      </div>
      {err && <div data-testid="stitch-manuscript-demo-error" style={{ fontSize: 11, color: C.red, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

/** The study-characteristics table with its demographics cells editable in place. */
export function DemographicsDataTable({ m, table, onNotice }) {
  const [open, setOpen] = useState(null);         // { columnKey, studyId }
  if (!table) return null;
  if (!table.available) return <InfoBox color={C.muted}>{table.note || 'Not enough data to build this table yet.'}</InfoBox>;
  const refs = table.rowRefs || [];
  const editable = !!m.editDemographicsCell;
  return (
    <div>
      <div style={{ overflowX: 'auto', border: `1px solid ${C.brd}`, borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>{table.columns.map((c) => <th key={c.key} style={cellTh}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {(table.rows || []).map((row, i) => (
              <tr key={i}>
                {table.columns.map((c) => {
                  const v = row[c.key];
                  const studyId = (refs[i] || {}).studyId || '';
                  const canEdit = editable && c.editable && studyId;
                  const isOpen = open && open.columnKey === c.key && open.studyId === studyId;
                  return (
                    <td key={c.key} style={{ ...cellTd, ...(canEdit ? { cursor: 'pointer' } : null), ...(isOpen ? { outline: `1px solid ${C.acc}` } : null) }}>
                      {canEdit ? (
                        <button data-testid={`stitch-manuscript-demo-cell-${demoSlug(studyId)}-${demoSlug(c.key)}`}
                          onClick={() => setOpen(isOpen ? null : { columnKey: c.key, studyId })}
                          title={`${c.label} — edit the extracted value`}
                          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted' }}>
                          {v == null || v === '' ? '—' : String(v)}
                        </button>
                      ) : (v == null || v === '' ? '—' : String(v))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        /* KEYED PER CELL: the editor seeds its draft from the cell it opens on, so moving
           to another cell must give it a fresh instance — without this React reuses the
           mounted one and the previous cell's draft (and its "not reported" state, which
           disables the inputs) leaks onto the new one. */
        <DemographicsCellEditor key={`${open.columnKey}:${open.studyId}`} m={m}
          columnKey={open.columnKey} studyId={open.studyId}
          onClose={(msg) => { setOpen(null); if (msg && onNotice) onNotice(msg); }} />
      )}
      {editable && table.columns.some((c) => c.editable) && (
        <div style={{ fontSize: 10.5, color: C.dim, marginTop: 6, lineHeight: 1.6 }}>
          Underlined cells are project extraction data — changing one here changes the study record itself.
        </div>
      )}
      {table.columns.filter((c) => c.note).map((c) => (
        <div key={c.key} style={{ fontSize: 10.5, color: C.muted, marginTop: 4 }}>{c.label}: {c.note}</div>
      ))}
    </div>
  );
}

export function TablesPanel({ m, onOpenAsset }) {
  const [buf, commit] = useAssetOverridesBuffer(m);
  const [notice, setNotice] = useState('');
  const tableAssets = (m.assets || []).filter((a) => a.kind === 'table');
  return (
    <div data-testid="stitch-manuscript-assets-tables">
      <InfoBox color={C.acc}>Numbers below are live — they follow where each table is first referenced in the text. Unreferenced tables are placed at the end of the exported document.</InfoBox>
      {notice && <InfoBox color={C.acc}>{notice}</InfoBox>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button onClick={m.refreshAllBlocks} data-testid="stitch-manuscript-refresh-all" style={btnS('ghost')}>
          <Icon name="refresh" size={13} /> Refresh all
        </button>
      </div>
      {tableAssets.map((asset) => {
        const isManual = asset.origin === 'manual';
        const t = isManual ? null : m.tables[asset.builderId];
        const st = (t && m.staleness[t.id]) || {};
        return (
          <Card key={asset.id} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.txt }}>
                {asset.title || (t && t.title) || 'Untitled table'}
              </h3>
              {t && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 10.5, color: C.muted }}>Last refreshed: {fmtTime(st.lastRefreshedAt)}</span>
                  <button onClick={() => m.refreshBlock(t.id)} style={{ ...btnS('ghost'), fontSize: 11 }}>
                    <Icon name="refresh" size={12} /> Refresh
                  </button>
                </div>
              )}
            </div>
            <AssetControls m={m} asset={asset} buf={buf} commit={commit} onInsertNotice={setNotice} onOpenAsset={onOpenAsset} />
            <div style={{ marginTop: 10 }}>
              {/* 117.md §4 — a manual table's CONTENT lives in the manuscript text.
                  Rendering a second, editable copy here would create a second place
                  to change it; this panel owns its metadata, the Editor owns it. */}
              {isManual ? (
                <div data-testid={`stitch-manuscript-asset-manual-${assetTestSlug(asset.id)}`}
                  style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
                  Typed in the {draftSectionLabel(m.activeDraft, asset.sectionId) || 'manuscript'} section —
                  edit its rows and its title there. It is numbered with the generated tables and exports with a caption.
                </div>
              ) : (t && t.id === 'study_characteristics_table'
                ? <DemographicsDataTable m={m} table={t} onNotice={setNotice} />
                : <DataTable table={t} />)}
            </div>
            {((t && t.warnings) || []).map((w, i) => <InfoBox key={i} color={C.yel}>{w}</InfoBox>)}
          </Card>
        );
      })}
    </div>
  );
}

/**
 * 119.md §5 — the metadata block for ONE uploaded figure.
 *
 * Everything here is a property of the FILE (§5's "Source/provenance", "Creator or
 * uploader", "Upload date", "Original filename and file type", "Dimensions and
 * resolution", "Version/replacement history"), so it is written to the
 * ManuscriptFigure row through the authenticated route — NOT into the draft. The
 * display overrides (caption, legend, width, alignment) stay on the draft, where
 * every other figure's already are. Two stores, one rule: facts about the file
 * live with the file, decisions about the manuscript live with the manuscript.
 */
export function UploadedFigureDetails({ m, asset, onNotice }) {
  const [alt, setAlt] = useState(asset.altText || '');
  const [src, setSrc] = useState(asset.sourceNote || '');
  const fileRef = useRef(null);
  useEffect(() => { setAlt(asset.altText || ''); setSrc(asset.sourceNote || ''); }, [asset.figureId, asset.altText, asset.sourceNote]);
  const slug = assetTestSlug(asset.id);
  const dims = asset.width && asset.height ? `${asset.width} × ${asset.height} px` : 'dimensions unknown';
  const size = asset.fileSize ? `${Math.max(1, Math.round(asset.fileSize / 1024))} KB` : '';
  const remove = async () => {
    const r = await m.deleteFigure(asset.figureId);
    if (r && r.blocked) {
      const u = r.usage || {};
      onNotice(`This figure is still used in the manuscript (${u.placements || 0} placement${u.placements === 1 ? '' : 's'}, ${u.references || 0} cross-reference${u.references === 1 ? '' : 's'}). Remove it from the document first — Ctrl+Z can bring it back until you delete the file here.`);
      return;
    }
    // 119.md §5 (r2) — honest copy: the figure leaves the manuscript at once, but
    // its file is retained briefly so an undo (or an autosave still in flight) has
    // real bytes behind it. Saying "the file was deleted" would be a lie for a day.
    if (r && r.deleted) onNotice('The figure was removed from this project. Its image file is kept for a short while so an undo can still bring it back, then deleted automatically.');
  };
  return (
    <div data-testid={`stitch-manuscript-figure-details-${slug}`} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {asset.available && asset.figureId ? (
          <img src={m.figureRawUrl(asset.figureId)} alt={asset.altText || asset.title || 'Uploaded figure'}
            data-testid={`stitch-manuscript-figure-preview-${slug}`}
            style={{ maxWidth: 240, maxHeight: 180, borderRadius: 4, border: `1px solid ${C.brd}`, background: '#f4f6f9' }} />
        ) : (
          <InfoBox color={C.red}>This figure&rsquo;s image file is missing. Replace it, or remove the figure from the manuscript.</InfoBox>
        )}
        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.7, minWidth: 200 }}>
          <div data-testid={`stitch-manuscript-figure-file-${slug}`}>{asset.fileName || 'file'} · {dims}{size ? ` · ${size}` : ''}</div>
          <div>Uploaded by {asset.uploadedByName || 'a project member'}{asset.uploadedAt ? ` on ${fmtTime(asset.uploadedAt)}` : ''}</div>
          {asset.replacedCount > 0 && (
            <div data-testid={`stitch-manuscript-figure-version-${slug}`}>
              Version {asset.replacedCount + 1} — replaced {fmtTime(asset.replacedAt)}
            </div>
          )}
          {asset.figureOrigin === 'analysis' && <div>Saved from an analysis figure.</div>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Labeled label="Alt text (accessibility)" style={{ flex: '2 1 260px' }}>
          <textarea value={alt} rows={1}
            placeholder="Describe what the picture shows, for readers using a screen reader…"
            onChange={(e) => setAlt(e.target.value)}
            onBlur={() => { if (alt !== (asset.altText || '')) m.updateFigureMeta(asset.figureId, { altText: alt }); }}
            aria-label={`${asset.title || asset.id} alt text`}
            data-testid={`stitch-manuscript-figure-alt-${slug}`}
            style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
        </Labeled>
        <Labeled label="Source / provenance" style={{ flex: '2 1 260px' }}>
          <input value={src} placeholder="e.g. Adapted from Smith et al. 2020 with permission"
            onChange={(e) => setSrc(e.target.value)}
            onBlur={() => { if (src !== (asset.sourceNote || '')) m.updateFigureMeta(asset.figureId, { sourceNote: src }); }}
            aria-label={`${asset.title || asset.id} source`}
            data-testid={`stitch-manuscript-figure-source-${slug}`} style={inp} />
        </Labeled>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: 'none' }}
          data-testid={`stitch-manuscript-figure-replace-file-${slug}`}
          onChange={async (e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!f) return;
            const r = await m.replaceFigureFile(asset.figureId, f);
            if (r) onNotice('The image was replaced. The figure keeps its number and every cross-reference to it.');
          }} />
        <button onClick={() => fileRef.current && fileRef.current.click()}
          data-testid={`stitch-manuscript-figure-replace-${slug}`}
          title="Replace the image without changing this figure's number or cross-references"
          style={{ ...btnS('ghost'), fontSize: 10.5, padding: '3px 10px' }}>Replace image</button>
        {asset.figureId && (
          <a href={m.figureDownloadUrl(asset.figureId)} download
            data-testid={`stitch-manuscript-figure-download-${slug}`}
            style={{ ...btnS('ghost'), fontSize: 10.5, padding: '3px 10px', textDecoration: 'none' }}>
            Download original
          </a>
        )}
        <button onClick={remove} data-testid={`stitch-manuscript-figure-delete-${slug}`}
          title={asset.placed
            ? 'Take it out of the manuscript first — deleting the file is permanent'
            : 'Permanently delete this image file'}
          style={{ ...btnS('ghost'), fontSize: 10.5, padding: '3px 10px', color: C.red }}>
          Delete file
        </button>
      </div>
    </div>
  );
}

export function FiguresPanel({ m, onOpenAsset }) {
  const [buf, commit] = useAssetOverridesBuffer(m);
  const [notice, setNotice] = useState('');
  const svgs = useFigureSvgs(m, { forest: true, prisma: true });
  const uploadRef = useRef(null);
  const figureAssets = (m.assets || []).filter((a) => a.kind === 'figure');
  const preview = (asset) => {
    // 119.md §5 — an UPLOADED figure previews itself (the picture is the content).
    if (asset.origin === 'upload') return <UploadedFigureDetails m={m} asset={asset} onNotice={setNotice} />;
    if (asset.id === 'figure:prisma') {
      return svgs.loading ? <div style={{ color: C.muted, fontSize: 12 }}>Rendering…</div>
        : svgs.error ? <InfoBox color={C.red}>{svgs.error}</InfoBox>
          : svgs.prisma ? <SvgBox svg={svgs.prisma} />
            : <InfoBox color={C.muted}>No PRISMA counts available yet — enter them in the PRISMA tab.</InfoBox>;
    }
    // The primary pair's forest is pair-keyed ('figure:forest:<slug>') with the
    // legacy role id kept as an alias — detect it by either.
    const isPrimaryForest = asset.id === 'figure:forest-primary'
      || (asset.aliasIds || []).includes('figure:forest-primary');
    if (isPrimaryForest) {
      return !asset.available ? <InfoBox color={C.muted}>No meta-analysis result yet. Add studies with effect sizes and run an analysis to see a forest plot.</InfoBox>
        : svgs.loading ? <div style={{ color: C.muted, fontSize: 12 }}>Rendering…</div>
          : svgs.error ? <InfoBox color={C.red}>{svgs.error}</InfoBox>
            : svgs.forest ? <SvgBox svg={svgs.forest} />
              : <InfoBox color={C.muted}>The forest plot could not be rendered from the current analysis.</InfoBox>;
    }
    return (
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
        {asset.available
          ? 'Rendered at export time — verify the underlying data in the Analysis / Risk of bias tabs.'
          : 'No data yet — this figure becomes available once its source data exists.'}
      </div>
    );
  };
  return (
    <div data-testid="stitch-manuscript-assets-figures">
      <InfoBox color={C.acc}>Included figures are embedded in the Word export with captions, alt text and live numbering. Reference one from the text and it moves next to its first mention.</InfoBox>
      {/* 119.md §5 — uploaded pictures ARE figures: one menu, one numbering
          sequence, one set of controls. This is the file-picker entry point; paste
          and drag-and-drop reach the same upload path from inside the editor. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input ref={uploadRef} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: 'none' }} data-testid="stitch-manuscript-figures-upload-file"
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            if (!files.length) return;
            const created = await m.uploadFigures(files);
            if (created.length) {
              setNotice(created.length === 1
                ? 'Picture uploaded. Open the Editor and use Insert → Picture, or paste it, to place it in the manuscript.'
                : `${created.length} pictures uploaded. Place each one in the manuscript from the Editor.`);
            }
          }} />
        <button onClick={() => uploadRef.current && uploadRef.current.click()}
          disabled={!!m.figureBusy}
          data-testid="stitch-manuscript-figures-upload"
          style={{ ...btnS('primary'), fontSize: 11.5, opacity: m.figureBusy ? 0.6 : 1 }}>
          {m.figureBusy ? 'Uploading…' : 'Upload picture'}
        </button>
        <span style={{ fontSize: 10.5, color: C.muted }}>
          PNG, JPEG, GIF or WebP. Uploaded pictures are numbered with the generated figures.
        </span>
      </div>
      {m.figureError && (
        <InfoBox color={C.red}><span data-testid="stitch-manuscript-figures-error">{m.figureError}</span></InfoBox>
      )}
      {notice && <InfoBox color={C.acc}>{notice}</InfoBox>}
      {figureAssets.map((asset) => (
        <Card key={asset.id} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.txt }}>{asset.title}</h3>
          </div>
          <AssetControls m={m} asset={asset} buf={buf} commit={commit} onInsertNotice={setNotice} onOpenAsset={onOpenAsset} />
          <div style={{ marginTop: 10 }}>{preview(asset)}</div>
        </Card>
      ))}
    </div>
  );
}

/* ════════════ 5. REFERENCES — 117.md §26-§33 the library manager ════════════ */

/**
 * §28/§29 — Add / Edit Reference.
 *
 * One dialog for both, because "add a reference by hand" and "correct a reference"
 * are the same form over the same fields; the only difference is what it starts
 * from and what the save button says. The TYPE selector drives which fields exist
 * (§28), so a Book never asks for a journal volume and a Website always asks for an
 * accessed date.
 *
 * Smart lookup (§29) fills the form and stops — the researcher confirms. Fields the
 * researcher has typed are marked and a later lookup leaves them alone, which is
 * where "do not overwrite user-corrected metadata unexpectedly" is enforced in the
 * UI; the engine enforces it again on the write path.
 */
export const LOOKUP_KINDS = [
  { id: 'doi', label: 'DOI', placeholder: '10.1056/NEJMoa2035389' },
  { id: 'pmid', label: 'PMID', placeholder: '33301246' },
  { id: 'pmcid', label: 'PMCID', placeholder: 'PMC7745181' },
  { id: 'title', label: 'Title', placeholder: 'Safety and efficacy of…' },
];

export const LOOKUP_UNVERIFIED_NOTE = 'Looked-up metadata comes from CrossRef / PubMed — check it against the article before saving.';

export function AddReferenceDialog({ initial, onSave, onCancel, onLookup, saveLabel = 'Add reference' }) {
  const [type, setType] = useState((initial && initial.type) || DEFAULT_REFERENCE_TYPE);
  const [values, setValues] = useState(() => {
    const v = {};
    for (const f of fieldsForType((initial && initial.type) || DEFAULT_REFERENCE_TYPE)) {
      const raw = initial ? initial[f.key] : '';
      v[f.key] = Array.isArray(raw) ? raw.join('; ') : (raw == null ? '' : String(raw));
    }
    if (initial && initial.authorsRaw && !v.authors) v.authors = initial.authorsRaw;
    return v;
  });
  // Fields the researcher edited BY HAND in this dialog — a lookup never touches them.
  const [touched, setTouched] = useState(() => new Set((initial && initial.corrected) || []));
  const [lookupKind, setLookupKind] = useState('doi');
  const [lookupValue, setLookupValue] = useState('');
  const [lookupState, setLookupState] = useState(null); // null | 'loading' | 'error'
  const [lookupError, setLookupError] = useState('');
  const [candidates, setCandidates] = useState(null);   // title search → choose one
  const [filled, setFilled] = useState(false);

  const fields = fieldsForType(type);
  const set = (key, val) => {
    setValues((v) => ({ ...v, [key]: val }));
    setTouched((t) => { const n = new Set(t); n.add(key); return n; });
  };

  /** Apply a looked-up record WITHOUT overwriting anything typed by hand (§29). */
  const applyLookup = (rec) => {
    if (!rec) return;
    if (rec.referenceType) setType(rec.referenceType);
    const next = { ...values };
    const target = fieldsForType(rec.referenceType || type);
    for (const f of target) {
      if (touched.has(f.key)) continue;
      const incoming = f.key === 'authors' ? rec.authors : rec[f.key];
      if (incoming != null && String(incoming).trim()) next[f.key] = String(incoming).trim();
    }
    setValues(next);
    setCandidates(null);
    setFilled(true);
  };

  const runLookup = async () => {
    if (!onLookup || !lookupValue.trim()) return;
    setLookupState('loading');
    setLookupError('');
    setCandidates(null);
    try {
      const res = await onLookup(lookupKind, lookupValue.trim());
      setLookupState(null);
      if (Array.isArray(res)) {
        if (!res.length) { setLookupState('error'); setLookupError('No matching record was found.'); return; }
        if (res.length === 1) { applyLookup(res[0]); return; }
        setCandidates(res);
        return;
      }
      applyLookup(res);
    } catch (e) {
      setLookupState('error');
      setLookupError((e && e.message) || 'Lookup failed.');
    }
  };

  const submit = () => {
    const out = { type };
    for (const f of fields) {
      const v = values[f.key];
      if (v != null && String(v).trim()) out[f.key] = String(v).trim();
    }
    out.corrected = [...touched].filter((k) => k === 'type' || fields.some((f) => f.key === k));
    if (onSave) onSave(out);
  };

  const label = { fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' };

  return (
    <div role="dialog" aria-modal="true" aria-label={saveLabel}
      data-testid="stitch-manuscript-add-reference"
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(15,23,42,0.35)', padding: 16,
      }}>
      <div style={{
        background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 18,
        maxWidth: 620, width: '100%', maxHeight: '86vh', overflowY: 'auto',
      }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: C.txt }}>{saveLabel}</h3>

        {/* §29 — smart lookup. It FILLS the form; the user confirms. */}
        {onLookup && (
          <div style={{ border: `1px solid ${C.brd}`, borderRadius: 9, padding: 10, marginBottom: 14 }}>
            <div style={{ ...label, marginBottom: 6 }}>Look up by identifier</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Select value={lookupKind} onChange={(e) => { setLookupKind(e.target.value); setCandidates(null); }}
                data-testid="stitch-manuscript-lookup-kind">
                {LOOKUP_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </Select>
              <input value={lookupValue} onChange={(e) => setLookupValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runLookup(); } }}
                placeholder={(LOOKUP_KINDS.find((k) => k.id === lookupKind) || {}).placeholder}
                aria-label="Identifier to look up"
                data-testid="stitch-manuscript-lookup-value"
                style={{ ...inp, flex: '1 1 220px', fontSize: 11.5 }} />
              <button type="button" onClick={runLookup} disabled={lookupState === 'loading' || !lookupValue.trim()}
                data-testid="stitch-manuscript-lookup-run"
                style={{ ...btnS('ghost'), fontSize: 11.5, opacity: (lookupState === 'loading' || !lookupValue.trim()) ? 0.5 : 1 }}>
                {lookupState === 'loading' ? 'Looking up…' : 'Look up'}
              </button>
            </div>
            {lookupState === 'error' && (
              <div data-testid="stitch-manuscript-lookup-error" style={{ marginTop: 6, fontSize: 11, color: C.red }}>
                {lookupError}
              </div>
            )}
            {filled && !candidates && (
              <div data-testid="stitch-manuscript-lookup-filled" style={{ marginTop: 6, fontSize: 11, color: C.txt2, lineHeight: 1.5 }}>
                {LOOKUP_UNVERIFIED_NOTE}
              </div>
            )}
            {candidates && (
              <div data-testid="stitch-manuscript-lookup-candidates" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 11, color: C.txt2 }}>Choose the right record:</div>
                {candidates.map((c, i) => (
                  <button key={c.doi || i} type="button" onClick={() => applyLookup(c)}
                    data-testid={`stitch-manuscript-lookup-candidate-${i}`}
                    style={{
                      ...btnS('ghost'), justifyContent: 'flex-start', textAlign: 'left',
                      fontSize: 11.5, lineHeight: 1.45, whiteSpace: 'normal', height: 'auto', padding: '6px 8px',
                    }}>
                    <span>
                      <strong style={{ color: C.txt }}>{c.title}</strong>
                      <span style={{ color: C.muted }}>{` — ${[c.journal, c.year].filter(Boolean).join(', ')}`}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div style={{ ...label, marginBottom: 4 }}>Reference type</div>
          <Select value={type} data-testid="stitch-manuscript-reference-type"
            onChange={(e) => { setType(e.target.value); setTouched((t) => { const n = new Set(t); n.add('type'); return n; }); }}>
            {REFERENCE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {fields.map((f) => (
            <label key={f.key}
              style={{ display: 'flex', flexDirection: 'column', gap: 3, gridColumn: (f.kind === 'textarea' || f.key === 'title') ? '1 / -1' : undefined }}>
              <span style={label}>{f.label}</span>
              {f.kind === 'textarea' ? (
                <textarea value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)}
                  aria-label={f.label} rows={3}
                  data-testid={`stitch-manuscript-reffield-${f.key}`}
                  style={{ ...inp, fontSize: 11.5, resize: 'vertical', fontFamily: 'inherit' }} />
              ) : (
                <input value={values[f.key] || ''} onChange={(e) => set(f.key, e.target.value)}
                  aria-label={f.label} placeholder={f.hint || ''}
                  data-testid={`stitch-manuscript-reffield-${f.key}`}
                  style={{ ...inp, fontSize: 11.5 }} />
              )}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} data-testid="stitch-manuscript-reference-cancel"
            style={{ ...btnS('ghost'), fontSize: 11.5 }}>Cancel</button>
          <button onClick={submit} data-testid="stitch-manuscript-reference-save"
            style={{ ...btnS('primary'), fontSize: 11.5 }}>{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * §30 — the import dialog: paste or drop a RIS / BibTeX / EndNote XML / NBIB / CSV
 * export, see a DEDUP PREVIEW against the references already in the library, and
 * land only what is genuinely new. The parsing is the EXISTING screening importer
 * (parsers.js) — one format vocabulary for the whole app.
 */
export const IMPORT_HINT = 'Paste RIS, BibTeX, EndNote XML, PubMed nbib or CSV, or choose a file. Records that already exist are matched and skipped by default.';

export function ImportReferencesDialog({ onImport, onCancel }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null); // { format, rows:[{record,match,verdict}] }
  const [skip, setSkip] = useState(() => new Set());
  const [err, setErr] = useState('');

  const parse = async () => {
    setErr('');
    try {
      const [{ detectAndParse }, { previewReferenceImport }] = await Promise.all([
        import('../../research-engine/import-export/parsers.js'),
        import('../../research-engine/manuscript/referenceLibrary.js'),
      ]);
      const { records, format } = detectAndParse(text, fileName);
      if (!records.length) { setErr('No references could be read from that text.'); setPreview(null); return; }
      const rows = previewReferenceImport(records, (onImport && onImport.existing) || []);
      setPreview({ format, rows });
      setSkip(new Set(rows.filter((r) => r.match).map((r) => r.index)));
    } catch (e) { setErr((e && e.message) || 'Could not read that file.'); }
  };

  const readFile = async (file) => {
    if (!file) return;
    setFileName(file.name || '');
    try { setText(await file.text()); } catch { setErr('Could not read that file.'); }
  };

  const confirm = () => {
    if (!preview) return;
    const keep = preview.rows.filter((r) => !skip.has(r.index)).map((r) => r.record);
    if (onImport && onImport.run) onImport.run(keep);
  };

  const dupCount = preview ? preview.rows.filter((r) => r.match).length : 0;
  const keepCount = preview ? preview.rows.length - skip.size : 0;

  return (
    <div role="dialog" aria-modal="true" aria-label="Import references"
      data-testid="stitch-manuscript-import-references"
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(15,23,42,0.35)', padding: 16,
      }}>
      <div style={{
        background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 18,
        maxWidth: 640, width: '100%', maxHeight: '86vh', overflowY: 'auto',
      }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: C.txt }}>Import references</h3>
        <p style={{ margin: '0 0 12px', fontSize: 11.5, color: C.txt2, lineHeight: 1.55 }}>{IMPORT_HINT}</p>

        <input type="file" accept=".ris,.bib,.nbib,.xml,.csv,.tsv,.txt,.ciw"
          aria-label="Reference file"
          data-testid="stitch-manuscript-import-file"
          onChange={(e) => readFile(e.target.files && e.target.files[0])}
          style={{ fontSize: 11.5, marginBottom: 8 }} />
        <textarea value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }}
          aria-label="Reference text" rows={7}
          data-testid="stitch-manuscript-import-text"
          style={{ ...inp, width: '100%', fontSize: 11.5, fontFamily: "'IBM Plex Mono',monospace", resize: 'vertical' }} />

        {err && <InfoBox color={C.red}>{err}</InfoBox>}

        {preview && (
          <div data-testid="stitch-manuscript-import-preview" style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11.5, color: C.txt2, marginBottom: 6 }}>
              Read <strong style={{ color: C.txt }}>{preview.rows.length}</strong> {preview.format} record{preview.rows.length === 1 ? '' : 's'};
              {' '}<strong style={{ color: C.txt }}>{dupCount}</strong> already look like references you have.
            </div>
            <div style={{ maxHeight: 210, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {preview.rows.map((row) => (
                <label key={row.index}
                  style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, color: C.txt2, lineHeight: 1.45 }}>
                  <input type="checkbox" checked={!skip.has(row.index)}
                    data-testid={`stitch-manuscript-import-keep-${row.index}`}
                    onChange={() => setSkip((s) => {
                      const n = new Set(s);
                      if (n.has(row.index)) n.delete(row.index); else n.add(row.index);
                      return n;
                    })}
                    style={{ marginTop: 2 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: C.txt }}>{row.record.title || '(untitled)'}</span>
                    {row.match && (
                      <span style={{ ...tagS('yellow'), marginLeft: 6 }}>
                        Duplicate of “{(row.match.title || row.match.id).slice(0, 40)}”
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onCancel} data-testid="stitch-manuscript-import-cancel"
            style={{ ...btnS('ghost'), fontSize: 11.5 }}>Cancel</button>
          {!preview ? (
            <button onClick={parse} disabled={!text.trim()}
              data-testid="stitch-manuscript-import-parse"
              style={{ ...btnS('primary'), fontSize: 11.5, opacity: text.trim() ? 1 : 0.5 }}>Read references</button>
          ) : (
            <button onClick={confirm} disabled={!keepCount}
              data-testid="stitch-manuscript-import-confirm"
              style={{ ...btnS('primary'), fontSize: 11.5, opacity: keepCount ? 1 : 0.5 }}>
              Add {keepCount} reference{keepCount === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** §33 — the row rendered per reference. Split out so the list can be windowed. */
function ReferenceRow({ row, onEdit, onSuppress, onDelete, onInsert, onMergeWith, highlight }) {
  const r = row.ref || {};
  return (
    <li value={row.index} data-testid={`stitch-manuscript-reference-${row.id}`}
      data-reference-current={highlight ? 'true' : undefined}
      style={{
        fontSize: 12.5, color: C.txt2, lineHeight: 1.6, marginBottom: 8,
        ...(highlight ? { background: alpha(C.acc, '12'), borderRadius: 6, padding: '4px 6px' } : {}),
      }}>
      <div>{row.text}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 3 }}>
        {row.cited
          ? <span style={tagS('green')}>Cited</span>
          : <span style={tagS('yellow')} data-testid={`stitch-manuscript-reference-uncited-${row.id}`}>Not cited</span>}
        <span style={tagS('blue')}>{referenceTypeLabel(r.type || DEFAULT_REFERENCE_TYPE)}</span>
        {r.origin === 'study' && <span style={tagS('purple')}>From included study</span>}
        {(r.tags || []).map((t) => <span key={t} style={tagS('blue')}>{t}</span>)}
        <span style={{ flex: 1 }} />
        <button onClick={() => onInsert && onInsert(row.id)} style={{ ...btnS('ghost'), fontSize: 10.5 }}
          data-testid={`stitch-manuscript-reference-cite-${row.id}`}>Cite</button>
        <button onClick={() => onEdit && onEdit(row.id)} style={{ ...btnS('ghost'), fontSize: 10.5 }}
          data-testid={`stitch-manuscript-reference-edit-${row.id}`}>Edit</button>
        {onMergeWith && (
          <button onClick={() => onMergeWith(row.id)} style={{ ...btnS('ghost'), fontSize: 10.5 }}
            data-testid={`stitch-manuscript-reference-merge-${row.id}`}>Merge…</button>
        )}
        {r.origin === 'library' ? (
          <button onClick={() => onDelete && onDelete(row.id)} style={{ ...btnS('ghost'), fontSize: 10.5, color: C.red }}
            data-testid={`stitch-manuscript-reference-delete-${row.id}`}>Delete</button>
        ) : (
          <button onClick={() => onSuppress && onSuppress(row.id)} style={{ ...btnS('ghost'), fontSize: 10.5 }}
            data-testid={`stitch-manuscript-reference-hide-${row.id}`}>Hide</button>
        )}
      </div>
    </li>
  );
}

/** §33 — above this many rows the list windows (renders a slice) to stay fast. */
export const REFERENCE_WINDOW_SIZE = 200;

/** §J.3 — the notice shown when a reference has no PDF this workspace can reach. */
export const REFERENCE_PDF_MISSING_NOTE =
  'Open the linked PDF from the Files tab — reference attachments are managed there.';

/**
 * 117.md §38/§J.3 — the in-app PDF for a citation.
 *
 * It REUSES the screening `<PdfViewer>` — the same wrapper the Title & Abstract,
 * Second Review, Conflicts and RoB surfaces all reach the PDF through, addressed the
 * same way (screening project + record). There is no manuscript-specific viewer, no
 * new route and no second attachment model; a PDF opened here is byte-for-byte the
 * one the reviewer annotated during screening, annotations included.
 *
 * Loaded with a DYNAMIC import so pdf.js and the annotation layer stay out of the
 * manuscript chunk until a researcher actually asks for a PDF, and read-only
 * (`canManage={false}`): attaching and replacing belong to the surfaces that own the
 * record, not to the bibliography.
 */
export function ReferencePdfDialog({ target, onClose }) {
  const [Viewer, setViewer] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!target) return undefined;
    let alive = true;
    setErr('');
    import('../../frontend/screening/components/PdfViewer.jsx')
      .then((mod) => { if (alive) setViewer(() => mod.default); })
      .catch(() => { if (alive) setErr('Could not load the PDF viewer.'); });
    return () => { alive = false; };
  }, [target]);
  if (!target) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Reference PDF"
      data-testid="stitch-manuscript-reference-pdf"
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'rgba(15,23,42,0.35)', padding: 16,
      }}>
      <div style={{
        background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 14,
        maxWidth: 980, width: '100%', height: '88vh', display: 'flex', flexDirection: 'column', minHeight: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.txt, flex: 1, minWidth: 0 }}>
            {target.title || 'Reference PDF'}
          </h3>
          <button onClick={onClose} style={btnS('ghost')}
            data-testid="stitch-manuscript-reference-pdf-close">Close</button>
        </div>
        {err ? <InfoBox color={C.red}>{err}</InfoBox> : null}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {Viewer ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <Viewer pid={target.screenProjectId} recordId={target.recordId} canManage={false} defaultOpen flush />
            </div>
          ) : (!err && (
            <div style={{ fontSize: 11.5, color: C.muted, padding: 12 }}>Opening the PDF…</div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ReferencesPanel({ m, onInsertCitation, focusReference }) {
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [mergeFrom, setMergeFrom] = useState(null);
  const [shown, setShown] = useState(REFERENCE_WINDOW_SIZE);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ cited: 'all', type: '', year: '', journal: '', tag: '' });
  const [sort, setSort] = useState('order');

  const refs = m.references || [];
  const missing = refs.filter((r) => !(r.ref && (r.ref.doi || r.ref.pmid))).length;
  const suppressed = m.suppressedReferences || [];
  // 117.md §J.16 — which suppressed rows are suppressed BY A MERGE.
  const mergedAway = m.mergedReferences || {};
  const dupes = (m.duplicateReferences && m.duplicateReferences.pairs) || [];
  /* 117.md §J.3 — the reference whose PDF is open in the in-app viewer. */
  const [pdfTarget, setPdfTarget] = useState(null);

  // §33 — the filter vocabularies come from the data, so a filter can never offer a
  // value that matches nothing.
  const years = useMemo(() => [...new Set(refs.map((r) => (r.ref || {}).year).filter(Boolean))].sort().reverse(), [refs]);
  const journals = useMemo(() => [...new Set(refs.map((r) => (r.ref || {}).journal).filter(Boolean))].sort(), [refs]);
  const types = useMemo(() => [...new Set(refs.map((r) => (r.ref || {}).type || DEFAULT_REFERENCE_TYPE))], [refs]);
  const tags = useMemo(() => collectReferenceTags(refs.map((r) => r.ref)), [refs]);

  const visible = useMemo(
    () => sortReferences(filterReferenceRows(refs, { ...filters, q }), sort),
    [refs, filters, q, sort],
  );
  useEffect(() => { setShown(REFERENCE_WINDOW_SIZE); }, [q, filters, sort]);

  /* 117.md §38 — a citation chip asked for a specific reference. "Edit" opens the
     dialog straight away; "View" clears the filters so the reference is definitely
     on screen and highlights it. `at` changes on every request, so repeating the
     same action from the chip re-triggers it. */
  const [highlightId, setHighlightId] = useState(null);
  useEffect(() => {
    if (!focusReference || !focusReference.id) return;
    setQ('');
    setFilters({ cited: 'all', type: '', year: '', journal: '', tag: '' });
    setHighlightId(focusReference.id);
    if (focusReference.action === 'edit') setEditingId(focusReference.id);
    /* 117.md §J.3 — "Open PDF" now OPENS one. The chip menu only offers the action
       once the lazy resolver found an attachment, so this is normally a direct hit;
       it still re-resolves (cached, so free) and soft-fails to the Files-tab notice,
       which is the honest answer when this workspace cannot reach a PDF at all. */
    if (focusReference.action === 'pdf') {
      const open = () => {
        const target = m.referencePdfTarget && m.referencePdfTarget(focusReference.id);
        if (target) { setNotice(''); setPdfTarget(target); return true; }
        return false;
      };
      if (!open()) {
        Promise.resolve(m.resolveReferencePdfs ? m.resolveReferencePdfs([focusReference.id]) : null)
          .then(() => { if (!open()) setNotice(REFERENCE_PDF_MISSING_NOTE); })
          .catch(() => setNotice(REFERENCE_PDF_MISSING_NOTE));
      }
    }
  }, [focusReference]); // eslint-disable-line react-hooks/exhaustive-deps

  const editing = editingId ? (refs.find((r) => r.id === editingId) || {}).ref : null;

  const onCopy = async () => {
    setErr('');
    try {
      const text = refs.map((r) => `${r.index}. ${r.text}`).join('\n');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { setErr('Could not copy to clipboard.'); }
  };
  const onExport = async (kind) => {
    setErr('');
    try {
      const { toBibTeX, toRIS } = await import('../../research-engine/manuscript/index.js');
      const { downloadText } = await import('../../frontend/components/exportCore.js');
      const underlying = refs.map((r) => r.ref);
      if (kind === 'bib') downloadText(toBibTeX(underlying), 'references.bib', 'application/x-bibtex;charset=utf-8');
      else downloadText(toRIS(underlying), 'references.ris', 'application/x-research-info-systems;charset=utf-8');
    } catch (e) { setErr((e && e.message) || 'Export failed.'); }
  };

  /** §29 — the smart lookup, routed through the same-origin proxy (CSP: no direct fetch). */
  const doLookup = async (kind, value) => {
    const svc = await import('../../frontend/services/aiService.js');
    if (kind === 'doi') return svc.fetchByDOI(value);
    if (kind === 'pmid') return svc.fetchByPMID(value);
    if (kind === 'pmcid') return svc.fetchByPMCID(value);
    return svc.searchCitationsByTitle(value);
  };

  const saveNew = (entry) => {
    const id = m.addReference && m.addReference(entry);
    setAdding(false);
    if (id) setNotice('Reference added to the library.');
  };
  const saveEdit = (patch) => {
    if (editingId && m.editReference) m.editReference(editingId, patch);
    setEditingId(null);
    setNotice('Reference updated — your corrections are kept when the project data refreshes.');
  };

  return (
    <div>
      {adding && (
        <AddReferenceDialog onSave={saveNew} onCancel={() => setAdding(false)} onLookup={doLookup} />
      )}
      {editing && (
        <AddReferenceDialog initial={editing} saveLabel="Save reference"
          onSave={saveEdit} onCancel={() => setEditingId(null)} onLookup={doLookup} />
      )}
      {importing && (
        <ImportReferencesDialog
          onCancel={() => setImporting(false)}
          onImport={{
            existing: refs.map((r) => r.ref),
            run: (records) => {
              const n = m.importReferences ? m.importReferences(records) : 0;
              setImporting(false);
              setNotice(`${n} reference${n === 1 ? '' : 's'} imported.`);
            },
          }} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: C.txt2 }}><strong style={{ color: C.txt }}>{refs.length}</strong> reference{refs.length === 1 ? '' : 's'}</span>
          <Labeled label="Style">
            <Select value={m.activeDraft.citationStyle} onChange={(e) => m.setMeta({ citationStyle: e.target.value })}>
              {CITATION_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Labeled>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setAdding(true)} style={btnS('primary')}
            data-testid="stitch-manuscript-add-reference-open"><Icon name="plus" size={12} /> Add reference</button>
          <button onClick={() => setImporting(true)} style={btnS('ghost')}
            data-testid="stitch-manuscript-import-open"><Icon name="upload" size={12} /> Import</button>
          <button onClick={onCopy} style={btnS('ghost')}><Icon name="copy" size={12} /> {copied ? 'Copied' : 'Copy reference list'}</button>
          <button onClick={() => onExport('bib')} style={btnS('ghost')}><Icon name="download" size={12} /> BibTeX</button>
          <button onClick={() => onExport('ris')} style={btnS('ghost')}><Icon name="download" size={12} /> RIS</button>
        </div>
      </div>

      {/* §31 — say out loud that included studies are already here. */}
      <InfoBox color={C.acc}>
        <span data-testid="stitch-manuscript-references-derived-note">
          Every included study is already a reference — they appear here automatically and stay in step with your extracted data.
          Add anything else (guidelines, methods papers, books) with Add reference or Import.
        </span>
      </InfoBox>

      {notice && <InfoBox color={C.grn}>{notice}</InfoBox>}
      {err && <InfoBox color={C.red}>{err}</InfoBox>}
      {missing > 0 && <InfoBox color={C.yel}>{missing} reference{missing === 1 ? '' : 's'} lack a DOI or PMID — verify these citations before submission.</InfoBox>}

      {/* §32 — probable duplicates, offered as merges. A merge keeps every citation. */}
      {dupes.length > 0 && (
        <Card style={{ marginBottom: 12 }} data-testid="stitch-manuscript-reference-duplicates">
          <div style={{ fontSize: 11, fontWeight: 700, color: C.txt, marginBottom: 6 }}>
            {dupes.length} possible duplicate{dupes.length === 1 ? '' : 's'}
          </div>
          {dupes.slice(0, 5).map((p) => (
            <div key={`${p.a.id}|${p.b.id}`}
              style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, color: C.txt2, marginBottom: 5 }}>
              <span style={{ flex: 1, minWidth: 200 }}>
                “{p.a.title || p.a.id}” and “{p.b.title || p.b.id}” — {p.verdict.reasons.slice(0, 2).join(', ')}
              </span>
              <button onClick={() => m.mergeReferences && m.mergeReferences(p.a.id, p.b.id)}
                data-testid={`stitch-manuscript-merge-${p.a.id}-${p.b.id}`}
                style={{ ...btnS('ghost'), fontSize: 10.5 }}>Merge into the first</button>
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
            Merging keeps every citation you have already written: the merged reference’s id stays valid and points at the survivor.
          </div>
        </Card>
      )}

      {/* §33 — search, filters, sort. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search author, title, DOI, PMID, journal, year, keyword…"
          aria-label="Search references"
          data-testid="stitch-manuscript-reference-search"
          style={{ ...inp, flex: '1 1 240px', fontSize: 11.5 }} />
        <Labeled label="Cited">
          <Select value={filters.cited} data-testid="stitch-manuscript-reference-filter-cited"
            onChange={(e) => setFilters((f) => ({ ...f, cited: e.target.value }))}>
            <option value="all">All</option>
            <option value="cited">Cited</option>
            <option value="uncited">Not cited</option>
          </Select>
        </Labeled>
        <Labeled label="Type">
          <Select value={filters.type} data-testid="stitch-manuscript-reference-filter-type"
            onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
            <option value="">All</option>
            {types.map((t) => <option key={t} value={t}>{referenceTypeLabel(t)}</option>)}
          </Select>
        </Labeled>
        <Labeled label="Year">
          <Select value={filters.year} data-testid="stitch-manuscript-reference-filter-year"
            onChange={(e) => setFilters((f) => ({ ...f, year: e.target.value }))}>
            <option value="">All</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </Labeled>
        <Labeled label="Journal">
          <Select value={filters.journal} data-testid="stitch-manuscript-reference-filter-journal"
            onChange={(e) => setFilters((f) => ({ ...f, journal: e.target.value }))}>
            <option value="">All</option>
            {journals.map((j) => <option key={j} value={j}>{j}</option>)}
          </Select>
        </Labeled>
        {tags.length > 0 && (
          <Labeled label="Tag">
            <Select value={filters.tag} data-testid="stitch-manuscript-reference-filter-tag"
              onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))}>
              <option value="">All</option>
              {tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Labeled>
        )}
        <Labeled label="Sort">
          <Select value={sort} data-testid="stitch-manuscript-reference-sort"
            onChange={(e) => setSort(e.target.value)}>
            {REFERENCE_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </Labeled>
      </div>

      {refs.length ? (
        <Card>
          <ol style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column' }}>
            {visible.slice(0, shown).map((r) => (
              <ReferenceRow key={r.id || r.index} row={r}
                highlight={highlightId === r.id}
                onEdit={setEditingId}
                onInsert={(id) => (onInsertCitation ? onInsertCitation(id) : null)}
                onMergeWith={mergeFrom
                  ? ((id) => { if (id !== mergeFrom) { m.mergeReferences && m.mergeReferences(id, mergeFrom); setNotice('References merged — every citation still resolves.'); } setMergeFrom(null); })
                  : ((id) => { setMergeFrom(id); setNotice('Now choose the reference to merge INTO this one.'); })}
                onSuppress={(id) => m.suppressReference && m.suppressReference(id)}
                onDelete={(id) => m.deleteReference && m.deleteReference(id)} />
            ))}
          </ol>
          {visible.length > shown && (
            <button onClick={() => setShown((n) => n + REFERENCE_WINDOW_SIZE)}
              data-testid="stitch-manuscript-reference-more"
              style={{ ...btnS('ghost'), fontSize: 11, marginTop: 8 }}>
              Show {Math.min(REFERENCE_WINDOW_SIZE, visible.length - shown)} more of {visible.length}
            </button>
          )}
          {!visible.length && (
            <div data-testid="stitch-manuscript-reference-nomatch" style={{ fontSize: 11.5, color: C.muted }}>
              No reference matches these filters.
            </div>
          )}
        </Card>
      ) : <InfoBox color={C.muted}>No references yet. References are collected from your included studies and imported records.</InfoBox>}

      {/* §31 — suppressed derived entries stay restorable, never silently gone.
          §J.16 — but a reference suppressed BY A MERGE is not one of them: putting its
          id back makes the alias stop applying and the merged-away copy reappears
          beside its survivor. Those rows say what happened to them and offer the only
          honest way back — Unmerge, which takes the alias, the suppression and the
          survivor's blank-fill with it. */}
      {suppressed.length > 0 && (
        <Card style={{ marginTop: 12 }} data-testid="stitch-manuscript-reference-hidden">
          <div style={{ fontSize: 11, fontWeight: 700, color: C.txt, marginBottom: 6 }}>
            {suppressed.length} hidden reference{suppressed.length === 1 ? '' : 's'}
          </div>
          {suppressed.map((r) => {
            const merged = mergedAway[r.id] || null;
            return (
              <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, color: C.txt2, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 0 }}>{r.title || r.id}</span>
                {merged ? (
                  <>
                    <span data-testid={`stitch-manuscript-reference-mergedinto-${r.id}`}
                      style={{ fontSize: 10.5, color: C.muted }}>
                      Merged into {merged.survivor ? authorYearLabel(merged.survivor) : 'another reference'}
                    </span>
                    <button onClick={() => m.unmergeReference && m.unmergeReference(r.id)}
                      data-testid={`stitch-manuscript-reference-unmerge-${r.id}`}
                      style={{ ...btnS('ghost'), fontSize: 10.5 }}>Unmerge</button>
                  </>
                ) : (
                  <button onClick={() => m.restoreReference && m.restoreReference(r.id)}
                    data-testid={`stitch-manuscript-reference-restore-${r.id}`}
                    style={{ ...btnS('ghost'), fontSize: 10.5 }}>Restore</button>
                )}
              </div>
            );
          })}
          {Object.keys(mergedAway).length > 0 && (
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
              A merged reference cannot be restored on its own — it would come back beside the reference it was merged into. Unmerge separates them again and puts back the details the merge filled in.
            </div>
          )}
        </Card>
      )}

      {/* §J.3 — the in-app PDF, opened through the SAME screening viewer every other
          surface uses (never a second viewer, never a new route). */}
      <ReferencePdfDialog target={pdfTarget} onClose={() => setPdfTarget(null)} />
    </div>
  );
}

/* ════════════ 6. PRISMA ════════════ */
const PROV_TAG = {
  manual: 'blue', override: 'purple', computed: 'green', derived: 'green',
  // 103.md — a count that IS a record set. Visually distinct from a typed number.
  records: 'green', 'not-performed': 'yellow', missing: 'red',
};

/**
 * 117.md §18 — the reconciliation banner. Compact and NON-INTRUSIVE by design: it
 * renders nothing at all while the flow reconciles (the green "✓ Flow reconciles"
 * confirmation belongs to the Screening tab, where a researcher is actively working
 * on the records), and appears only when the structural self-audit found something.
 * The count comes first because that is the actionable part; the first two messages
 * follow so the researcher can tell whether it affects publication output.
 */
export function PrismaReconciliationBanner({ reconciliation }) {
  const rec = reconciliation;
  if (!rec) return null;
  const issues = (rec.issues || []).filter((i) => i && i.severity !== 'info');
  if (rec.ok !== false && !issues.length) return null;
  const errs = issues.filter((i) => i.severity === 'error');
  const bad = rec.ok === false || errs.length > 0;
  const n = issues.length;
  return (
    <div data-testid="manuscript-prisma-reconciliation" role={bad ? 'alert' : undefined}
      style={{
        fontSize: 11.5, lineHeight: 1.6, borderRadius: 8, padding: '8px 11px', marginBottom: 10,
        color: bad ? C.red : C.yel,
        border: `1px solid ${alpha(bad ? C.red : C.yel, '55')}`,
        background: alpha(bad ? C.red : C.yel, '12'),
      }}>
      <strong>
        {bad ? 'This PRISMA flow does not reconcile' : 'PRISMA flow — worth checking before submission'}
        {` (${n} issue${n === 1 ? '' : 's'})`}
      </strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {issues.slice(0, 2).map((i, k) => <li key={i.id || k}>{i.message}</li>)}
      </ul>
      {n > 2 && <div style={{ marginTop: 4, color: C.muted }}>{`+${n - 2} more — open the PRISMA Flow tab to inspect the records behind each count.`}</div>}
    </div>
  );
}

/**
 * 117.md §21 — ONE overridable PRISMA count.
 *
 * "Do not silently replace real project data": the automated value and the manual
 * one are shown TOGETHER whenever they differ, with a per-field revert control. The
 * input is buffered and commits on blur/Enter rather than on every keystroke,
 * because each commit is a real structural write with an audit entry (§22) — a
 * keystroke-level write would produce a log of half-typed numbers.
 */
export function PrismaOverrideField({ field, label, auto, value, onApply, onRevert }) {
  const [buf, setBuf] = useState(value == null ? '' : String(value));
  useEffect(() => { setBuf(value == null ? '' : String(value)); }, [value]);
  const reset = () => setBuf(value == null ? '' : String(value));
  const commit = () => {
    const raw = String(buf).trim();
    if (raw === '') { if (value != null) onRevert(field); else reset(); return; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) { reset(); return; }
    if (value != null && n === value) return;
    onApply(field, n);
  };
  const autoText = auto == null ? 'not recorded' : String(auto);
  return (
    <div data-testid={`prisma-override-${field}`}>
      <Labeled label={label}>
        <input type="number" min="0" value={buf}
          aria-label={`${label} — manual override`}
          onChange={(e) => setBuf(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') reset(); }}
          placeholder={auto == null ? 'automatic' : `automatic (${autoText})`}
          style={inp} />
      </Labeled>
      {value != null ? (
        <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.6, color: C.muted }}>
          <div>
            {'Automated value: '}<strong style={{ color: C.txt2 }}>{autoText}</strong>
            {' → Manual override: '}<strong style={{ color: C.purp }}>{String(value)}</strong>
          </div>
          <button type="button" onClick={() => onRevert(field)}
            style={{ ...btnS('ghost'), fontSize: 10.5, padding: '3px 8px', marginTop: 4 }}>
            Revert to automatic
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 5, fontSize: 11, color: C.dim }}>
          {`Automated value: ${autoText}`}
        </div>
      )}
    </div>
  );
}

export function PrismaPanel({ m, exporters }) {
  const pc = m.prismaCounts;
  const pt = m.tables.prisma;
  const overrides = (m.activeDraft && m.activeDraft.prismaOverrides) || {};
  const ovInfo = (pc && pc.overrides) || {};
  const svgs = useFigureSvgs(m, { prisma: true });

  // 117.md §12 — the canonical record-derived flow. Its presence is what unlocks the
  // retrieval-stage rows/fields (§15) and the reconciliation banner (§18); a project
  // with no linked screening records keeps the legacy counter surface exactly.
  const hasFlow = !!(pc && pc.flow);
  const fields = PRISMA_OVERRIDE_FIELDS.filter((f) => hasFlow || !f.flowOnly);

  // 117.md §21/§22 — structural, audited writes (see useManuscript.writePrismaOverride).
  const applyOverride = (field, n) => m.setPrismaOverride(field, n);
  const revertOverride = (field) => m.revertPrismaOverride(field);

  const provRows = (pt && pt.rowsWithProvenance) || [];
  const log = (m.prismaOverrideLog || []).slice().reverse();

  // 117.md §18 — on the canonical path the reconciliation issues ALREADY ride the
  // warnings channel (adaptFlow maps them there so every legacy consumer sees them).
  // The banner is now the dedicated surface for exactly those, so listing them again
  // underneath would say the same thing twice; everything else still shows.
  const bannerMessages = new Set((((pc && pc.reconciliation) || {}).issues || []).map((i) => i && i.message));
  const otherWarnings = ((pc && pc.warnings) || []).filter((w) => !bannerMessages.has(w));

  return (
    <div>
      <Block title="PRISMA 2020 counts"
        desc={hasFlow
          ? 'Derived from this project’s screening records — the same numbers the PRISMA Flow tab draws. A manual override is labelled below and never replaces the derived value.'
          : 'Computed from your project data; manual overrides take precedence (and are labelled below).'}>
        <PrismaReconciliationBanner reconciliation={pc && pc.reconciliation} />
        {pt && pt.available ? (
          <div style={{ overflowX: 'auto', border: `1px solid ${C.brd}`, borderRadius: 10 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={cellTh}>Stage</th>
                  <th style={cellTh}>n</th>
                  <th style={cellTh}>Source</th>
                </tr>
              </thead>
              <tbody>
                {provRows.map((row, i) => (
                  <tr key={i}>
                    <td style={cellTd}>{row.stage}</td>
                    <td style={cellTd}>{row.n == null || row.n === '' ? '—' : String(row.n)}</td>
                    <td style={cellTd}>{row.source ? <span style={tagS(PROV_TAG[row.source] || 'gray')}>{row.source}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <InfoBox color={C.muted}>{(pt && pt.note) || 'No PRISMA counts available yet.'}</InfoBox>}
        {otherWarnings.map((w, i) => <InfoBox key={i} color={C.yel}>{w}</InfoBox>)}
      </Block>

      <Block title="PRISMA 2020 flow diagram"
        desc={hasFlow ? 'The same diagram Screening draws, from the same records.' : undefined}>
        {svgs.loading ? <div style={{ color: C.muted, fontSize: 12 }}>Rendering…</div>
          : svgs.error ? <InfoBox color={C.red}>{svgs.error}</InfoBox>
            : svgs.prisma ? <SvgBox svg={svgs.prisma} />
              : <InfoBox color={C.muted}>Enter counts below to see the flow diagram.</InfoBox>}
      </Block>

      <Block title="Manual overrides" desc="Enter a number to override the value for that PRISMA box, or leave it blank to track the project automatically. Overrides are recorded and can be undone.">
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 14 }}>
            {fields.map((f) => (
              <PrismaOverrideField key={f.key} field={f.key} label={f.label}
                auto={ovInfo[f.key] ? ovInfo[f.key].auto : ((pc && pc.counts && pc.counts[f.key]) ?? null)}
                value={overrides[f.key] == null || overrides[f.key] === '' ? null : Number(overrides[f.key])}
                onApply={applyOverride} onRevert={revertOverride} />
            ))}
          </div>
          <InfoBox color={C.purp}>
            A value entered here is a <strong>manual override</strong>: it is labelled in the counts table, carried into the narrative and the export, and recorded below.
            {hasFlow ? ' The flow diagram continues to show the record-derived figures, so the underlying records stay inspectable.' : ''}
          </InfoBox>
        </Card>
      </Block>

      {log.length > 0 && (
        <Block title="Override history" desc="Every manual change to a PRISMA count, most recent first.">
          <div data-testid="prisma-override-log" style={{ overflowX: 'auto', border: `1px solid ${C.brd}`, borderRadius: 10 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={cellTh}>When</th>
                  {/* 117.md §22 (r2) — the mandated actor column; '—' for entries
                      written before an authenticated session was available. */}
                  <th style={cellTh}>By</th>
                  <th style={cellTh}>Field</th>
                  <th style={cellTh}>Automated</th>
                  <th style={cellTh}>Change</th>
                </tr>
              </thead>
              <tbody>
                {log.map((e, i) => (
                  <tr key={i}>
                    <td style={cellTd}>{fmtLogTime(e.at)}</td>
                    <td style={cellTd}>{e.by || '—'}</td>
                    <td style={cellTd}>{prismaOverrideLabel(e.field)}</td>
                    <td style={cellTd}>{e.auto == null ? '—' : String(e.auto)}</td>
                    <td style={cellTd}>
                      {`${e.from == null ? 'automatic' : e.from} → ${e.to == null ? 'automatic' : e.to}`}
                      {e.via ? <span style={{ ...tagS('gray'), marginLeft: 6 }}>{e.via}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      )}

      <Block title="Checklists">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={exporters.onPrismaChecklist} disabled={!!exporters.exporting} style={{ ...btnS('ghost'), opacity: exporters.exporting ? 0.6 : 1 }}>
            <Icon name="checkSquare" size={13} /> {exporters.exporting === 'prisma' ? 'Generating…' : 'PRISMA checklist'}
          </button>
          <button onClick={exporters.onPrismaSChecklist} disabled={!!exporters.exporting} style={{ ...btnS('ghost'), opacity: exporters.exporting ? 0.6 : 1 }}>
            <Icon name="checkSquare" size={13} /> {exporters.exporting === 'prismaS' ? 'Generating…' : 'PRISMA-S checklist'}
          </button>
        </div>
        {/* 121.md §3 — an UNANNOUNCED echo of the workspace's ExportFeedbackRegion
            (no role, no aria-live): one announcement, several places to see it. */}
        {exporters.exportError && <InfoBox color={C.red}>{exporters.exportError}</InfoBox>}
      </Block>
    </div>
  );
}

/** Audit timestamps render locally; an unparseable/absent stamp is honestly blank. */
function fmtLogTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  } catch { return '—'; }
}

/* ════════════ 119.md §7 — reporting structure (the FIRST of three dimensions) ════════════
 *
 * The block that owns "Customize the resulting structure": the section list of the
 * draft, in order, each row renameable and movable. It writes through the pure
 * engine writers (`renameDraftSection` / `moveDraftSection` via the hook), so a
 * customization is exactly as byte-stable as a template switch and normalizes
 * through the same `normalizeStructure`.
 *
 * Reordering deliberately excludes the front sections: the title block leads the
 * document in both views and in the .docx, and it is not a body section.
 */
function StructureBlock({ m, onOpenStructure }) {
  const draft = m.activeDraft || {};
  const structure = draftStructure(draft);
  const rows = draftSectionTypes(draft);
  const [editing, setEditing] = useState(null);   // { id, value }

  const commitRename = () => {
    if (!editing) return;
    const v = String(editing.value || '').trim();
    if (v && m.renameSection) m.renameSection(editing.id, v);
    setEditing(null);
  };

  const bodyRows = rows.filter((s) => s.group !== 'front');

  return (
    <Block title="Reporting structure"
      desc="Which sections this manuscript has, and in what order. Based on a published reporting guideline — it is a writing aid, not a compliance check.">
      <Card data-testid="stitch-manuscript-structure-block">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.txt }} data-testid="stitch-manuscript-structure-name">
              {structure.label}
            </div>
            <div style={{ marginTop: 4 }}>
              <StructureProvenance structure={structure} />
            </div>
          </div>
          <button type="button" onClick={() => onOpenStructure && onOpenStructure()}
            data-testid="stitch-manuscript-structure-change"
            disabled={!onOpenStructure}
            style={{ ...btnS('ghost'), fontSize: 11.5, flexShrink: 0 }}>
            Change structure…
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((s, i) => {
            const isEditing = editing && editing.id === s.id;
            const bodyIndex = bodyRows.findIndex((b) => b.id === s.id);
            return (
              <div key={s.id} data-testid={`stitch-manuscript-structure-section-${s.id}`}
                data-retained={s.retained ? 'true' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                  padding: '6px 0', borderTop: i > 0 ? `1px solid ${C.brd}` : 'none',
                }}>
                {isEditing ? (
                  <input autoFocus value={editing.value}
                    aria-label={`Rename ${s.label}`}
                    data-testid={`stitch-manuscript-structure-rename-input-${s.id}`}
                    onChange={(e) => setEditing({ id: s.id, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                      if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                    }}
                    onBlur={commitRename}
                    style={{ ...inp, flex: '1 1 160px', fontSize: 12 }} />
                ) : (
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt, flex: '1 1 160px', minWidth: 0 }}>
                    {s.label}
                    {s.retained && (
                      <span data-testid={`stitch-manuscript-structure-kept-${s.id}`}
                        style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: C.yel }}>
                        Kept from a previous structure
                      </span>
                    )}
                  </span>
                )}
                <span style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                  <button type="button" onClick={() => setEditing({ id: s.id, value: s.label })}
                    data-testid={`stitch-manuscript-structure-rename-${s.id}`}
                    aria-label={`Rename ${s.label}`}
                    style={{ ...btnS('ghost'), fontSize: 11, padding: '3px 8px' }}>Rename</button>
                  <button type="button" onClick={() => m.moveSection && m.moveSection(s.id, -1)}
                    disabled={s.group === 'front' || bodyIndex <= 0}
                    data-testid={`stitch-manuscript-structure-up-${s.id}`}
                    aria-label={`Move ${s.label} up`}
                    style={{ ...btnS('ghost'), fontSize: 11, padding: '3px 8px', opacity: (s.group === 'front' || bodyIndex <= 0) ? 0.4 : 1 }}>↑</button>
                  <button type="button" onClick={() => m.moveSection && m.moveSection(s.id, 1)}
                    disabled={s.group === 'front' || bodyIndex < 0 || bodyIndex >= bodyRows.length - 1}
                    data-testid={`stitch-manuscript-structure-down-${s.id}`}
                    aria-label={`Move ${s.label} down`}
                    style={{ ...btnS('ghost'), fontSize: 11, padding: '3px 8px', opacity: (s.group === 'front' || bodyIndex < 0 || bodyIndex >= bodyRows.length - 1) ? 0.4 : 1 }}>↓</button>
                </span>
              </div>
            );
          })}
        </div>
        <InfoBox color={C.muted}>{NO_COMPLIANCE_NOTE}</InfoBox>
      </Card>
    </Block>
  );
}

/* ════════════ 7. EXPORT ════════════ */
export function ExportPanel({ m, exporters, onOpenStructure }) {
  const tpl = JOURNAL_TEMPLATES.find((t) => t.id === m.activeDraft.templateId);
  const draftSections = draftSectionTypes(m.activeDraft);
  const sectionsDone = draftSections.filter((s) => sectionStatus((m.activeDraft.sections && m.activeDraft.sections[s.id]) || {}) !== 'empty').length;
  const items = [
    { icon: 'fileText', title: 'Word manuscript (.docx)', desc: 'Title page, structured abstract, IMRAD body, declarations, numbered references, data tables, and embedded PRISMA + forest figures.' },
    { icon: 'download', title: 'Reproducibility package (.zip)', desc: 'Manuscript, PRISMA diagram + checklists, datasets, analysis settings, methods text, and a manifest — everything a reviewer needs to reproduce the review.' },
    { icon: 'checkSquare', title: 'PRISMA 2020 checklist (.csv)', desc: 'Pre-filled reporting checklist for the systematic review.' },
    { icon: 'checkSquare', title: 'PRISMA-S checklist (.csv)', desc: 'Pre-filled search-reporting extension checklist.' },
  ];
  return (
    <div>
      <Block title="Summary">
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 14 }}>
            <Stat label="Sections drafted" value={`${sectionsDone}/${draftSections.length}`} />
            <Stat label="References" value={(m.references || []).length} />
            <Stat label="Studies included" value={(m.prismaCounts.counts && m.prismaCounts.counts.included != null) ? m.prismaCounts.counts.included : '—'} />
            <Stat label="Readiness" value={m.readiness ? `${m.readiness.score.pct}%` : '—'} />
            <Stat label="Status" value={cap(m.activeDraft.status)} />
            <Stat label="Citation style" value={(CITATION_STYLES.find((s) => s.id === m.activeDraft.citationStyle) || {}).label || '—'} />
          </div>
        </Card>
      </Block>

      <Block title="Version snapshots" desc="Save a named restore point of the whole manuscript before big changes. Freeze one to protect it; Restore takes an automatic safety snapshot first.">
        <SnapshotsBlock m={m} />
      </Block>

      {/* 119.md §7 — THREE dimensions, three blocks, in the order they matter.
          Reporting structure decides which sections exist; the journal profile
          decides how the manuscript is formatted for one journal; the citation
          style decides how a citation reads. Changing one never changes another —
          in particular, a citation-style change can never rewrite the structure. */}
      <StructureBlock m={m} onOpenStructure={onOpenStructure} />

      <Block title="Journal profile" desc="A journal's house formatting: abstract shape, word limits and required declarations. Separate from the manuscript structure — switching profiles never changes your sections.">
        <Labeled label="Template">
          <Select value={m.activeDraft.templateId} onChange={(e) => m.setMeta({ templateId: e.target.value })}>
            {JOURNAL_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </Labeled>
        {tpl && tpl.note && <div style={{ marginTop: 8, fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>{tpl.note}</div>}
        <div style={{ marginTop: 8 }}><JournalProfileNotes templateId={m.activeDraft.templateId} /></div>
        <InfoBox color={C.yel}>Journal profiles are formatting aids. They do not check or guarantee submission compliance — always verify against the journal's current author instructions before submission.</InfoBox>
      </Block>

      <Block title="Citation style" desc="How an in-text citation and its reference-list entry read. Changing it re-renders every citation — it never adds, removes or reorders a section.">
        <Labeled label="Citation style">
          <Select value={m.activeDraft.citationStyle} data-testid="stitch-manuscript-export-citation-select"
            onChange={(e) => m.setMeta({ citationStyle: e.target.value })}>
            {CITATION_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </Labeled>
      </Block>

      <Block title="Declarations" desc="Short statements included verbatim in the Word export. Required statements depend on the journal template.">
        <StatementsEditor m={m} required={(tpl && tpl.requiredStatements) || []} />
      </Block>

      <Block title="Downloads">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((it) => (
            <div key={it.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: alpha(C.acc, '14'), color: C.acc, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name={it.icon} size={14} />
              </div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: C.txt }}>{it.title}</div>
                <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>{it.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <ExportButtons exporters={exporters} />
        </div>
        {/* 121.md §3 — an UNANNOUNCED echo of the workspace's ExportFeedbackRegion
            (no role, no aria-live): one announcement, several places to see it. */}
        {exporters.exportError && <InfoBox color={C.red}>{exporters.exportError}</InfoBox>}
      </Block>
    </div>
  );
}

function StatementsEditor({ m, required }) {
  const stmts = m.activeDraft.statements || {};
  const [buf, setBuf] = useState(() => ({ ...stmts }));
  useEffect(() => { setBuf({ ...(m.activeDraft.statements || {}) }); }, [m.activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const onType = (id, val) => { setBuf((b) => ({ ...b, [id]: val })); m.setStatement(id, val); };
  const reqSet = new Set(required || []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {STATEMENT_TYPES.map((st) => {
        const isReq = reqSet.has(st.id);
        const empty = !String(buf[st.id] || '').trim();
        return (
          <Labeled key={st.id} label={(
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              {st.label}
              {isReq && <span style={tagS(empty ? 'red' : 'green')}>{empty ? 'required' : 'provided'}</span>}
            </span>
          )}>
            <input value={buf[st.id] || ''} onChange={(e) => onType(st.id, e.target.value)}
              placeholder={isReq ? 'Required by this template…' : 'Optional…'} style={inp} />
          </Labeled>
        );
      })}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.txt }}>{value}</div>
    </div>
  );
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'; }
