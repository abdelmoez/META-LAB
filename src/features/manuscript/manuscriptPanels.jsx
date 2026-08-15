/**
 * features/manuscript/manuscriptPanels.jsx — 64.md (P3). Presentational panels for
 * the Manuscript workspace sub-tabs (Overview / Editor / Tables / Figures /
 * References / PRISMA / Export). PURE UI: every datum comes from the already-tested
 * `useManuscript` hook + pure engine; this file owns ZERO business logic. Styled with
 * the legacy token system only (Stitch auto-remaps --t-*), so it renders in both shells.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { C, btnS, inp, tagS } from '../../frontend/workspace/ui/styles.js';
import { InfoBox, ProgressBar } from '../../frontend/workspace/ui/primitives.jsx';
import { Icon } from '../../frontend/components/icons.jsx';
import { alpha } from '../../frontend/theme/tokens.js';
// 108.md §23 — the ONE keyboard router. Replaces this file's ad-hoc window keydown
// listener (which also had no dependency array — see the binding below).
import { useShortcut, TIER } from '../../frontend/shortcuts/ShortcutProvider.jsx';
import {
  SECTION_TYPES, SECTION_IDS, STATEMENT_TYPES, CITATION_STYLES, JOURNAL_TEMPLATES, sectionStatus,
  collectCitationOrder, draftSectionTexts, studySelectionParagraph,
  explainKeys, SECTION_DEPENDENCIES,
  // 85.md B2 — structured asset references (tokens ↔ live numbering).
  assetToken,
  // 117.md §4-§11 — cross-reference counting + the ONE caption/label formatter.
  countAssetMentions, formatAssetLabel, assetKindLabel,
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
// 117.md §J.3 — decorate references with the PDF attachment the lazy resolver found,
// so "Open PDF" appears exactly when a PDF really is reachable.
import { withResolvedPdfIds } from './referencePdfLinks.js';
import {
  RichSectionEditor, RichToolbar, RICH_EDITOR_CSS, CrossRefPicker, CrossRefList,
  CiteRefPicker, citeItemOf,
} from './richEditor/RichSectionEditor.jsx';
// 101.md §34 — the optional "recent manuscript updates" panel paired with Show Changes.
import { ChangeTrackingPanel } from './ChangeTrackingPanel.jsx';
// 102.md §2/§5 — the manual-field counter, prev/next controls and section list.
import { ManualFieldsPanel } from './ManualFieldsPanel.jsx';
import { AbstractEditor } from './richEditor/AbstractEditor.jsx';
import { extractOutline, mdToHtml } from './richEditor/mdDom.js';
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
  for (const s of SECTION_TYPES) {
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

/**
 * Pre-export validation review (85.md B2). Shown ONLY when validateExport found
 * something: errors BLOCK the export (each with an action hint); warnings offer
 * "Export anyway" / "Fix first". A clean report never mounts this — the export
 * stays one-click.
 */
export function ExportValidationDialog({ review, onExportAnyway, onClose, exporting }) {
  if (!review || !review.validation) return null;
  const v = review.validation;
  const errors = v.errors || [];
  const warnings = v.warnings || [];
  const info = v.info || [];
  const blocked = errors.length > 0;
  const fetched = fmtFetched(review.fetchedAt);
  const row = (e, tone, i, prefix) => (
    <div key={`${prefix}-${e.code}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', padding: '6px 0' }}>
      <span style={{ ...tagS(tone), flexShrink: 0 }}>{tone === 'red' ? 'Blocks export' : tone === 'yellow' ? 'Check' : 'Note'}</span>
      <span style={{ flex: '1 1 280px', minWidth: 0, fontSize: 12, color: C.txt2, lineHeight: 1.6 }}>
        {e.message}
        {e.action && <span style={{ display: 'block', fontSize: 11, color: C.muted }}>{e.action}</span>}
      </span>
    </div>
  );
  return (
    <Card data-testid="stitch-manuscript-export-validation" role="alertdialog"
      aria-label="Export check results"
      style={{ marginBottom: 18, borderColor: blocked ? C.red : C.yel, borderLeft: `3px solid ${blocked ? C.red : C.yel}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.txt }}>
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

function UpdateCard({ entry, m }) {
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

export function UpdatesPanel({ m }) {
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
          {shown.map((e) => <UpdateCard key={e.sectionId} entry={e} m={m} />)}
        </Block>
      ) : nothing ? (
        <InfoBox color={C.grn}>Fully synchronized with the project.</InfoBox>
      ) : null}
    </div>
  );
}

/* ════════════ 1. OVERVIEW ════════════ */

/** Row status for the section grid / editor chips: Locked > Outdated > content state. */
export function sectionRowStatus(section, isOutdated) {
  if (section && section.locked) return 'locked';
  if (isOutdated) return 'outdated';
  return sectionStatus(section || {});
}

const STATUS_CHIP = {
  empty: { label: 'Empty', tone: 'gray' },
  'ai-draft': { label: 'Auto-draft', tone: 'yellow' },
  edited: { label: 'Edited', tone: 'green' },
  locked: { label: 'Locked', tone: 'purple' },
  outdated: { label: 'Outdated', tone: 'yellow' },
};

function StatusChip({ status }) {
  const c = STATUS_CHIP[status] || STATUS_CHIP.empty;
  return (
    <span style={tagS(c.tone)}
      title={status === 'outdated' ? 'Project data changed since this was generated' : undefined}>
      {status === 'locked' && <Icon name="lock" size={9} />} {c.label}
    </span>
  );
}

/* ── Data-sources card copy (honest availability from m.dataStatus) ── */
function dataSourceRows(m) {
  const ds = m.dataStatus || {};
  const robCount = m.robAssessments ? Object.keys(m.robAssessments).length : 0;
  const gradeCount = m.gradeByOutcome ? Object.keys(m.gradeByOutcome).length : 0;
  const pecanCount = m.perSource ? Object.keys(m.perSource).length : 0;
  const plural = (n, s) => `${n} ${s}${n === 1 ? '' : 's'}`;
  return [
    {
      key: 'screening', label: 'Screening', state: ds.screening || 'unlinked',
      detail: ds.screening === 'ok'
        ? 'Linked — live PRISMA counts feed the flow diagram and narrative.'
        : ds.screening === 'error'
          ? 'Could not reach the screening workspace — counts fall back to manual PRISMA entries.'
          : 'Not linked — counts fall back to manual PRISMA entries.',
    },
    {
      key: 'search', label: 'Search strategy', state: ds.search || 'off',
      detail: ds.search === 'ok'
        ? (m.searchMethodsText ? 'Methods text available from the search builder.' : 'Connected — no saved methods text yet.')
        : ds.search === 'error'
          ? 'Could not reach the search builder — Methods uses the generic search sentence.'
          : 'Not enabled — the search table uses the Search tab entries.',
    },
    {
      key: 'rob', label: 'Risk of bias', state: ds.rob || 'off',
      detail: ds.rob === 'ok'
        ? (robCount ? `${plural(robCount, 'assessment')} loaded from the Risk of Bias workspace.` : 'Connected — no assessments recorded yet.')
        : ds.rob === 'error'
          ? 'Could not load assessments — using per-study judgements from extraction.'
          : 'Using per-study judgements from extraction.',
    },
    {
      key: 'grade', label: 'GRADE certainty', state: ds.grade || 'off',
      detail: ds.grade === 'ok'
        ? (gradeCount ? `${plural(gradeCount, 'outcome rating')} fill the certainty column.` : 'Connected — no certainty ratings yet.')
        : 'Not enabled — the certainty column stays blank.',
    },
    {
      key: 'pecan', label: 'Search runs', state: ds.pecan || 'off',
      detail: ds.pecan === 'ok'
        ? (pecanCount ? `Per-database record counts from the latest completed run (${plural(pecanCount, 'source')}).` : 'No completed search run yet.')
        : ds.pecan === 'error'
          ? 'Could not load search runs.'
          : 'Not enabled.',
    },
  ];
}

const SOURCE_STATE_WORD = { ok: 'Live', error: 'Error', off: 'Off', unlinked: 'Not linked' };

function DataSourcesCard({ m }) {
  const rows = dataSourceRows(m);
  return (
    <Card data-testid="stitch-manuscript-data-sources">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => (
          <div key={r.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}
            data-testid={`stitch-manuscript-datasource-${r.key}`}>
            <span aria-hidden="true" style={{ flexShrink: 0, marginTop: 1, color: r.state === 'ok' ? C.grn : r.state === 'error' ? C.red : C.muted }}>
              <Icon name={r.state === 'ok' ? 'circleCheck' : r.state === 'error' ? 'alertTriangle' : 'info'} size={13} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt }}>{r.label}</span>
                <span style={tagS(r.state === 'ok' ? 'green' : r.state === 'error' ? 'red' : 'gray')}>
                  {SOURCE_STATE_WORD[r.state] || r.state}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>{r.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Consistency card (checkConsistency results + jump-to-section) ── */
function ConsistencyCard({ m, onOpenSection }) {
  const items = m.consistency || [];
  if (!items.length) {
    return <InfoBox color={C.grn}>No inconsistencies detected between the draft and your project data.</InfoBox>;
  }
  return (
    <Card data-testid="stitch-manuscript-consistency">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <span style={{ ...tagS(c.severity === 'warn' ? 'yellow' : 'blue'), flexShrink: 0 }}>
              {c.severity === 'warn' ? 'Check' : 'Note'}
            </span>
            <span style={{ fontSize: 12, color: C.txt2, lineHeight: 1.6, flex: '1 1 260px' }}>{c.message}</span>
            {c.section && onOpenSection && (
              <button onClick={() => onOpenSection(c.section)}
                aria-label={`Open the ${c.section} section`}
                data-testid={`stitch-manuscript-consistency-open-${c.id}`}
                style={{ ...btnS('ghost'), fontSize: 10.5, padding: '3px 10px' }}>
                Open
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── First-time empty state: no section has any content yet ── */
function FirstDraftHero({ m }) {
  const bullets = [
    'Grounded in your project’s actual data — counts, effects and criteria are never invented.',
    'Sections you edit are never silently overwritten.',
    'Regenerate any section as your review evolves.',
  ];
  return (
    <Card data-testid="stitch-manuscript-hero" style={{ textAlign: 'center', padding: '38px 26px', marginBottom: 22 }}>
      <div style={{ display: 'inline-flex', width: 44, height: 44, borderRadius: 12, background: alpha(C.acc, '14'), color: C.acc, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <Icon name="pencil" size={20} />
      </div>
      <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: C.txt }}>Generate your first draft</h3>
      <p style={{ margin: '0 auto 16px', fontSize: 12.5, color: C.muted, lineHeight: 1.6, maxWidth: 460 }}>
        Draft every section — title to conclusions — from what this project already knows.
      </p>
      {/* recs round — generation waits for the live-source fetches to settle so a
          first draft is never built from empty pre-fetch data. */}
      <button onClick={() => m.generate({})}
        data-testid="stitch-manuscript-hero-generate"
        disabled={m.sourcesSettled === false}
        style={{ ...btnS('primary'), fontSize: 12.5, padding: '9px 22px', opacity: m.sourcesSettled === false ? 0.6 : 1 }}>
        <Icon name="sigma" size={14} /> {m.sourcesSettled === false ? 'Loading project data…' : 'Generate your first draft'}
      </button>
      <ul style={{ listStyle: 'none', margin: '18px auto 0', padding: 0, maxWidth: 440, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bullets.map((b) => (
          <li key={b} style={{ display: 'flex', gap: 8, fontSize: 11.5, color: C.txt2, lineHeight: 1.55 }}>
            <span aria-hidden="true" style={{ color: C.grn, flexShrink: 0 }}>✓</span>{b}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Per-section status grid (8 sections × status chip + Open/Generate) ── */
function SectionGrid({ m, onOpenSection }) {
  const [notice, setNotice] = useState(null); // { only:[id], skipped:[...] }
  const sections = (m.activeDraft && m.activeDraft.sections) || {};
  const outdatedMap = m.outdated || {};
  const rowGenerate = (id) => {
    // recs round — never generate from pre-fetch (empty) live sources.
    if (m.sourcesSettled === false) return;
    const res = m.generate({ only: [id] });
    if (res && res.skipped && res.skipped.length) setNotice({ only: [id], skipped: res.skipped });
    else setNotice(null);
  };
  const overwrite = () => {
    if (notice) m.generate({ only: notice.only, overwriteEdited: true });
    setNotice(null);
  };
  return (
    <Card data-testid="stitch-manuscript-section-grid" style={{ padding: '6px 16px' }}>
      {notice && (
        <div style={{ margin: '10px 0 4px' }}>
          <InfoBox color={C.yel}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span>You edited this section — it was preserved and not overwritten.</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button onClick={overwrite} style={{ ...btnS('danger'), fontSize: 11 }}>Overwrite anyway</button>
                <button onClick={() => setNotice(null)} style={{ ...btnS('ghost'), fontSize: 11 }}>Keep edits</button>
              </span>
            </div>
          </InfoBox>
        </div>
      )}
      {SECTION_TYPES.map((s, i) => {
        const sect = sections[s.id] || {};
        const status = sectionRowStatus(sect, !!outdatedMap[s.id]);
        const locked = status === 'locked';
        return (
          <div key={s.id} data-testid={`stitch-manuscript-secrow-${s.id}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 0',
              borderTop: i === 0 ? 'none' : `1px solid ${C.brd}`,
            }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt, flex: '1 1 120px' }}>{s.label}</span>
            <StatusChip status={status} />
            <span style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => onOpenSection && onOpenSection(s.id)}
                aria-label={`Open ${s.label} in the editor`}
                data-testid={`stitch-manuscript-secrow-open-${s.id}`}
                style={{ ...btnS('ghost'), fontSize: 10.5, padding: '3px 10px' }}>
                Open
              </button>
              <button onClick={() => rowGenerate(s.id)} disabled={locked}
                aria-label={`Generate ${s.label} from project data`}
                title={locked ? 'This section is locked — unlock it in the editor to regenerate.' : `Generate ${s.label} from project data`}
                data-testid={`stitch-manuscript-secrow-generate-${s.id}`}
                style={{ ...btnS('ghost'), fontSize: 10.5, padding: '3px 10px', opacity: locked ? 0.5 : 1, cursor: locked ? 'not-allowed' : undefined }}>
                <Icon name="refresh" size={10} /> Generate
              </button>
            </span>
          </div>
        );
      })}
    </Card>
  );
}

export function OverviewPanel({ m, exporters, onOpenSection }) {
  const r = m.readiness;
  const tpl = JOURNAL_TEMPLATES.find((t) => t.id === m.activeDraft.templateId);
  const sections = m.activeDraft.sections || {};
  const allEmpty = SECTION_TYPES.every((s) => sectionStatus(sections[s.id] || {}) === 'empty');
  return (
    <div>
      {/* 84.md — at-a-glance sync status against the live project data */}
      {!allEmpty && m.freshness && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <FreshnessPill freshness={m.freshness} />
          <span style={{ fontSize: 11.5, color: C.muted }}>
            Manages how closely the draft matches your project — see the Updates tab to review and apply changes.
          </span>
        </div>
      )}
      {allEmpty ? (
        <FirstDraftHero m={m} />
      ) : (
        <Block title="Sections" desc="Where each section stands — open it in the editor or regenerate it from project data.">
          <SectionGrid m={m} onOpenSection={onOpenSection} />
        </Block>
      )}

      <Block title="Readiness" desc="A quick checklist of what a submission-ready systematic review needs.">
        {r ? (
          <Card>
            <div style={{ marginBottom: 12 }}>
              <ProgressBar done={r.score.done} total={r.score.total} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 4 }}>
              {r.items.map((it) => (
                <div key={it.key} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '6px 0' }}>
                  <span style={{ color: it.complete ? C.grn : C.muted, fontWeight: 700, fontSize: 13, lineHeight: '18px', flexShrink: 0 }}>{it.complete ? '✓' : '○'}</span>
                  <div>
                    <div style={{ fontSize: 12.5, color: it.complete ? C.txt : C.txt2 }}>{it.label}</div>
                    {it.detail && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{it.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : <InfoBox color={C.muted}>Readiness will appear once the draft is ready.</InfoBox>}
      </Block>

      <Block title="Data sources" desc="Where the generated draft pulls live numbers from — and what falls back to manual entries.">
        <DataSourcesCard m={m} />
      </Block>

      <Block title="Consistency" desc="Cross-checks between the manuscript text and your live project data.">
        <ConsistencyCard m={m} onOpenSection={onOpenSection} />
      </Block>

      <Block title="Smart insights" desc="Automatic checks against your project data — verify each before submission.">
        {m.insights && m.insights.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {m.insights.map((ins) => (
              <InfoBox key={ins.key} color={ins.severity === 'warning' ? C.yel : C.acc}>
                <span style={{ fontWeight: 700, marginRight: 6, color: ins.severity === 'warning' ? C.yel : C.acc }}>
                  {ins.severity === 'warning' ? 'Check' : 'Note'}
                </span>{ins.message}
              </InfoBox>
            ))}
          </div>
        ) : <InfoBox color={C.grn}>No issues detected in the current draft.</InfoBox>}
      </Block>

      <Block title="Submission setup">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Labeled label="Journal template">
            <Select value={m.activeDraft.templateId} onChange={(e) => m.setMeta({ templateId: e.target.value })}>
              {JOURNAL_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Labeled>
          <Labeled label="Citation style">
            <Select value={m.activeDraft.citationStyle} onChange={(e) => m.setMeta({ citationStyle: e.target.value })}>
              {CITATION_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Labeled>
          <Labeled label="Status">
            <Select value={m.activeDraft.status} onChange={(e) => m.setMeta({ status: e.target.value })}>
              <option value="draft">Draft</option>
              <option value="reviewing">Reviewing</option>
              <option value="ready">Ready</option>
            </Select>
          </Labeled>
        </div>
        {tpl && tpl.note && <InfoBox color={C.acc}>{tpl.note}</InfoBox>}
      </Block>

      <Block title="Authors & affiliations" desc="Appears on the exported title page. Corresponding author is marked in the Word export.">
        <AuthorshipCard m={m} />
      </Block>

      <Block title="Export" desc="Generate a submission-ready Word manuscript, a reproducibility bundle, or reporting checklists.">
        <ExportButtons exporters={exporters} canonical />
        {exporters.exportError && <InfoBox color={C.red}>{exporters.exportError}</InfoBox>}
      </Block>
    </div>
  );
}

/* ── MS-6: authorship editor (persists to draft.authorship via setMetaDebounced;
      the docx title page already consumes authors/affiliations/corresponding). ── */
function normalizeAuthorship(a) {
  return {
    authors: Array.isArray(a && a.authors) ? a.authors.map((x) => ({
      name: (x && x.name) || '',
      affiliation: (x && x.affiliation) || '',
      email: (x && x.email) || '',
      corresponding: !!(x && x.corresponding),
    })) : [],
    affiliations: Array.isArray(a && a.affiliations) ? a.affiliations.slice() : [],
    correspondingNote: (a && a.correspondingNote) || '',
  };
}

function AuthorshipCard({ m }) {
  const [buf, setBuf] = useState(() => normalizeAuthorship(m.activeDraft.authorship));
  useEffect(() => { setBuf(normalizeAuthorship(m.activeDraft && m.activeDraft.authorship)); }, [m.activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next) => { setBuf(next); m.setMetaDebounced({ authorship: next }); };
  const setAuthor = (i, patch) => commit({ ...buf, authors: buf.authors.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const removeAuthor = (i) => commit({ ...buf, authors: buf.authors.filter((_a, j) => j !== i) });
  const addAuthor = () => commit({ ...buf, authors: [...buf.authors, { name: '', affiliation: '', email: '', corresponding: buf.authors.length === 0 }] });

  return (
    <Card data-testid="stitch-manuscript-authorship">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="stitch-manuscript-authorship-list">
        {buf.authors.length === 0 && (
          <div style={{ fontSize: 11.5, color: C.muted }}>No authors yet — add the author list for the title page.</div>
        )}
        {buf.authors.map((au, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={au.name} onChange={(e) => setAuthor(i, { name: e.target.value })}
              placeholder="Full name" aria-label={`Author ${i + 1} name`}
              style={{ ...inp, flex: '2 1 150px', width: 'auto' }} />
            <input value={au.affiliation} onChange={(e) => setAuthor(i, { affiliation: e.target.value })}
              placeholder="Affiliation №(s)" aria-label={`Author ${i + 1} affiliation`}
              title="Affiliation number(s) from the list below, or free text"
              style={{ ...inp, flex: '1 1 100px', width: 'auto' }} />
            <input value={au.email} onChange={(e) => setAuthor(i, { email: e.target.value })}
              placeholder="Email" aria-label={`Author ${i + 1} email`}
              style={{ ...inp, flex: '1 1 130px', width: 'auto' }} />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.txt2, whiteSpace: 'nowrap', cursor: 'pointer' }}>
              <input type="checkbox" checked={au.corresponding}
                onChange={(e) => setAuthor(i, { corresponding: e.target.checked })}
                aria-label={`Author ${i + 1} is corresponding author`} />
              Corresponding
            </label>
            <button onClick={() => removeAuthor(i)} aria-label={`Remove author ${i + 1}`} title="Remove author"
              style={{ ...btnS('ghost'), padding: '4px 9px', fontSize: 12 }}>
              ×
            </button>
          </div>
        ))}
        <div>
          <button onClick={addAuthor} data-testid="stitch-manuscript-add-author" style={{ ...btnS('ghost'), fontSize: 11 }}>
            <Icon name="plus" size={12} /> Add author
          </button>
        </div>
        <Labeled label="Affiliations (one per line, numbered in order)">
          <textarea value={buf.affiliations.join('\n')}
            onChange={(e) => commit({ ...buf, affiliations: e.target.value.split('\n') })}
            onBlur={() => commit({ ...buf, affiliations: buf.affiliations.map((s) => s.trim()).filter(Boolean) })}
            placeholder={'1. Department of …, University of …\n2. …'}
            rows={3} aria-label="Affiliations"
            style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} />
        </Labeled>
        <Labeled label="Corresponding-author note (optional)">
          <input value={buf.correspondingNote}
            onChange={(e) => commit({ ...buf, correspondingNote: e.target.value })}
            placeholder="e.g. These authors contributed equally…"
            style={inp} />
        </Labeled>
      </div>
    </Card>
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
          <button onClick={onCancel} data-testid="stitch-manuscript-table-delete-cancel"
            style={{ ...btnS('ghost'), fontSize: 11.5 }}>Keep table</button>
          <button onClick={onConfirm} data-testid="stitch-manuscript-table-delete-confirm-btn"
            style={{ ...btnS('danger'), fontSize: 11.5 }}>Delete anyway</button>
        </div>
      </div>
    </div>
  );
}

export function EditorPanel({ m, exporters, sectionRequest, onOpenAssetPanel, onOpenReference }) {
  const [sel, setSel] = useState('title');
  const [genNotice, setGenNotice] = useState(null); // { only:null|[id], skipped:[...], skippedLocked:[...] }
  const [toolsOpen, setToolsOpen] = useState(true);
  const [whyOpen, setWhyOpen] = useState(false); // 84.md — "Why does this say this?"

  const section = (m.activeDraft.sections && m.activeDraft.sections[sel]) || {};
  const lastGen = section.lastGeneratedAt || null;
  // 73.md Part 9 — per-section lock + outdated state.
  const locked = !!section.locked;
  const outdatedMap = m.outdated || {};
  const isOutdated = !!outdatedMap[sel];
  const [buf, setBuf] = useState(section.content || '');
  // resync local buffer only when the active section changes OR that section is (re)generated —
  // typing never touches lastGeneratedAt, so this never fights the cursor.
  useEffect(() => {
    setBuf(((m.activeDraft.sections && m.activeDraft.sections[sel]) || {}).content || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, m.activeId, lastGen]);

  // keywords buffer (comma-separated)
  const [kw, setKw] = useState((m.activeDraft.keywords || []).join(', '));
  useEffect(() => { setKw((m.activeDraft.keywords || []).join(', ')); }, [m.activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onType = (val) => { if (locked) return; setBuf(val); m.updateSection(sel, val); };

  // The rich editor that last held the caret (main section field OR one of the
  // abstract subsection fields) — the shared toolbar/tools act on it.
  const mainApi = useRef(null);
  const activeApi = useRef(null);
  const setActive = (api) => { activeApi.current = api; };
  const getApi = () => activeApi.current || mainApi.current;

  const pageRef = useRef(null);
  const pendingScroll = useRef(null);

  // 116.md §61/§62 — the caret's table context (null outside tables), reported
  // by the main rich editor; drives the floating table controls. Cleared on
  // section switch / regeneration because the editor remounts and the old rect
  // is meaningless.
  const [tableCtx, setTableCtx] = useState(null);
  useEffect(() => { setTableCtx(null); }, [sel, m.activeId, lastGen]); // eslint-disable-line react-hooks/exhaustive-deps

  const citeRefs = m.references || [];
  const refLabel = (r) => {
    const a = r.ref && r.ref.authorsList && r.ref.authorsList[0];
    const fam = a ? (a.family || a.raw) : ((r.ref && r.ref.title) || 'ref');
    return `${fam}${r.ref && r.ref.year ? ` ${r.ref.year}` : ''}`;
  };
  // inline-citation numbering (includes the unsaved buffer)
  // 117.md §32/§36 — alias-resolved, so a citation of a merged-away reference numbers
  // as its survivor rather than falling out of the sequence.
  const citeAliases = m.referenceAliases || null;
  // 117.md §39 — an unresolvable citation takes no number, so the chips stay in step
  // with the bibliography instead of shifting after a typo.
  const citeKnownIds = m.referenceKnownIds || null;
  const orderMap = useMemo(() => {
    const texts = draftSectionTexts(m.activeDraft).map((t, i) => (SECTION_IDS[i] === sel ? buf : t));
    return collectCitationOrder(texts, { aliases: citeAliases, knownIds: citeKnownIds }).orderMap;
  }, [m.activeDraft, sel, buf, citeAliases, citeKnownIds]);
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

  const [chipMenu, setChipMenu] = useState(null);   // {id,label,broken,rect}
  const [chipHover, setChipHover] = useState(null);
  const [relinking, setRelinking] = useState(false);
  const [tableDelete, setTableDelete] = useState(null); // {tableId,label,count}
  // 117.md §38 — the citation chip's own popovers ({ids,label,broken,rect}).
  const [citeMenu, setCiteMenu] = useState(null);
  const [citeHover, setCiteHover] = useState(null);
  // A section switch invalidates every anchored popover (the rects are gone).
  useEffect(() => {
    setChipMenu(null); setChipHover(null); setRelinking(false); setTableDelete(null);
    setCiteMenu(null); setCiteHover(null);
  }, [sel, m.activeId, lastGen]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeChipMenu = () => {
    const api = getApi();
    if (api && api.clearActiveCrossRef) api.clearActiveCrossRef();
    setChipMenu(null);
    setRelinking(false);
  };

  const closeCiteMenu = () => {
    const api = getApi();
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
  const outline = useMemo(() => {
    const map = {};
    for (const s of SECTION_TYPES) {
      if (s.id === 'title') continue;
      const md = s.id === sel ? buf : (((m.activeDraft.sections || {})[s.id] || {}).content || '');
      const entries = extractOutline(md).filter((h) => h.level <= 2);
      if (entries.length) map[s.id] = entries;
    }
    return map;
  }, [m.activeDraft, buf, sel]);

  // flush any pending debounced edit before changing section so resync reads fresh content
  const switchTo = (id) => { if (m.flush) m.flush(); activeApi.current = null; setSel(id); };

  /* ══════════ 102.md §2 — navigation across the WHOLE manuscript ══════════
   *
   * The editor shows one section at a time, so "next field" often means: switch
   * section, wait for that editor to mount, then reveal the field inside it.
   * `pendingRevealRef` carries the target across the remount; the effect below
   * fires once the new editor's imperative handle exists.
   *
   * Placeholders are addressed by their ORDINAL within a section rather than by a
   * DOM id, because the chips are re-rendered from markdown on every mount and any
   * id we stamped would not survive.
   */
  const pendingRevealRef = useRef(null);
  // 117.md §10 — the same across-remount carrier for "Go to table" / "Edit table"
  // when the target lives in another section.
  const pendingTableRevealRef = useRef(null);
  useEffect(() => {
    const t = pendingTableRevealRef.current;
    if (!t || t.sectionId !== sel) return undefined;
    let tries = 0;
    let timer = null;
    const attempt = () => {
      if (pendingTableRevealRef.current !== t) return;
      const api = mainApi.current;
      const done = api && (t.edit
        ? (api.editManualTable && api.editManualTable(t.id))
        : (api.focusManualTable && api.focusManualTable(t.id)));
      if (done) { pendingTableRevealRef.current = null; return; }
      tries += 1;
      if (tries < 10) timer = setTimeout(attempt, 24);
      else pendingTableRevealRef.current = null; // give up quietly
    };
    timer = setTimeout(attempt, 0);
    return () => { if (timer) clearTimeout(timer); };
  }, [sel]);

  const revealInCurrentSection = (p) => {
    const api = mainApi.current;
    if (!api || typeof api.focusPlaceholder !== 'function') return false;
    return api.focusPlaceholder(p.ordinal);
  };

  const goToPlaceholder = (p) => {
    if (!p) return;
    m.setCurrentPlaceholderId && m.setCurrentPlaceholderId(p.id);
    // A statement field lives in the Statements editor, not a section page; send
    // the researcher there rather than failing silently.
    if (p.group === 'statement') { pendingRevealRef.current = null; setSel('statements'); return; }
    if (p.sectionId === sel) { revealInCurrentSection(p); return; }
    pendingRevealRef.current = p;
    switchTo(p.sectionId);
  };

  useEffect(() => {
    const p = pendingRevealRef.current;
    if (!p || p.sectionId !== sel) return undefined;
    // The editor remounts when the section changes, so its imperative handle is
    // not attached yet on this tick. Retry across a few frames rather than
    // assuming a single timeout is enough on a slow render.
    let tries = 0;
    let timer = null;
    const attempt = () => {
      if (pendingRevealRef.current !== p) return;
      if (revealInCurrentSection(p)) { pendingRevealRef.current = null; return; }
      tries += 1;
      if (tries < 10) timer = setTimeout(attempt, 24);
      else pendingRevealRef.current = null; // give up quietly; never loop forever
    };
    timer = setTimeout(attempt, 0);
    return () => { if (timer) clearTimeout(timer); };
  }, [sel]);

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

  // 73.md Part 9 — the Overview grid / Consistency card can request a section
  // ({ id, at }); honour every request (`at` changes even for the same id).
  useEffect(() => {
    if (sectionRequest && sectionRequest.id && SECTION_IDS.includes(sectionRequest.id)) {
      switchTo(sectionRequest.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionRequest]);

  const scrollToHeading = (idx) => {
    const el = pageRef.current;
    if (!el || typeof el.querySelectorAll !== 'function') return;
    const h = el.querySelectorAll('h2,h3,h4')[idx];
    if (h && h.scrollIntoView) h.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const jumpTo = (secId, headingIndex) => {
    if (secId === sel) { scrollToHeading(headingIndex); return; }
    pendingScroll.current = headingIndex;
    switchTo(secId);
  };
  useEffect(() => {
    if (pendingScroll.current == null) return;
    const idx = pendingScroll.current;
    pendingScroll.current = null;
    scrollToHeading(idx);
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

  // 117.md §34/§35 — one or MANY ids; the editor turns them into ONE chip.
  const insertCitation = (refIds) => {
    if (locked) return;
    const api = getApi();
    const ids = Array.isArray(refIds) ? refIds : [refIds];
    if (api && ids.filter(Boolean).length) api.insertCitation(ids.filter(Boolean));
  };

  /** 117.md §38 — remove one id from the active chip (null → the whole chip). */
  const removeCitation = (refId) => {
    const api = getApi();
    if (api && api.removeCitation) api.removeCitation(refId);
    setCiteMenu(null);
  };
  // MS-8: insert the generated study-selection paragraph as normal editable text.
  // 85.md B2 — token variant ONLY when the draft already uses structured tokens
  // (no silent mixed mode; a legacy draft keeps the legacy "(Figure 1)" text and
  // validation warns if modes ever mix).
  const insertPrisma = () => {
    if (locked) return;
    const api = getApi();
    if (api) api.insertMarkdown(studySelectionParagraph(m.prismaCounts, { assetRefs: !!m.draftUsesTokens }));
  };
  // 85.md B2 / 117.md §9 — insert a live [[table:…]]/[[figure:…]] reference AT THE
  // CARET as an inline chip (insertMarkdown would splice a block and split the
  // sentence being written).
  const insertAssetRef = (assetId) => {
    if (locked || !assetId) return;
    const api = getApi();
    if (!api) return;
    if (api.insertAssetRef) api.insertAssetRef(assetId);
    else api.insertMarkdown(assetToken(assetId)); // abstract subfields, older handles
  };

  /* ── 117.md §10/§11 — chip menu actions ── */
  const chipAsset = chipMenu ? (assetById.get(chipMenu.id) || null) : null;
  const hoverAsset = chipHover ? (assetById.get(chipHover.id) || null) : null;

  const goToAsset = (assetId) => {
    const a = assetById.get(assetId) || null;
    if (a && a.origin === 'manual') {
      const api = mainApi.current;
      // Same section → scroll + highlight. Different section → switch, then the
      // effect below retries once the new editor's handle exists.
      if (api && api.focusManualTable && api.focusManualTable(a.manualId)) return;
      if (a.sectionId && a.sectionId !== sel) { pendingTableRevealRef.current = { id: a.manualId, sectionId: a.sectionId, edit: false }; switchTo(a.sectionId); }
      return;
    }
    // A generated object has no place in the prose — its panel IS the object.
    if (onOpenAssetPanel) onOpenAssetPanel(a && a.kind === 'figure' ? 'figures' : 'tables');
  };

  const editAsset = (assetId) => {
    const a = assetById.get(assetId) || null;
    if (a && a.origin === 'manual') {
      const api = mainApi.current;
      if (api && api.editManualTable && api.editManualTable(a.manualId)) return;
      if (a.sectionId && a.sectionId !== sel) { pendingTableRevealRef.current = { id: a.manualId, sectionId: a.sectionId, edit: true }; switchTo(a.sectionId); }
      return;
    }
    if (onOpenAssetPanel) onOpenAssetPanel(a && a.kind === 'figure' ? 'figures' : 'tables');
  };

  const removeChipRef = () => {
    const api = getApi();
    if (api && api.removeCrossRef) api.removeCrossRef();
    setChipMenu(null);
    setRelinking(false);
  };

  const relinkChipRef = (assetId) => {
    const api = getApi();
    if (api && api.relinkCrossRef) api.relinkCrossRef(assetId);
    setChipMenu(null);
    setRelinking(false);
  };

  /* ── 117.md §11 — delete a table that other sentences point at ── */
  const askDeleteTable = (ctx) => {
    const tableId = ctx && ctx.tableId;
    const api = getApi();
    if (!tableId) { if (api && api.tableOp) api.tableOp('deleteTable'); return; }
    const count = countAssetMentions(m.activeDraft, `table:${tableId}`);
    if (!count) { if (api && api.tableOp) api.tableOp('deleteTable'); return; }
    const a = assetById.get(`table:${tableId}`) || null;
    setTableDelete({ tableId, count, label: a ? assetNumberLabel(m, a) : 'this table' });
  };

  const confirmDeleteTable = () => {
    const api = getApi();
    if (api && api.tableOp) api.tableOp('deleteTable');
    // The prose is the source of truth: the caption goes with the table, so the
    // side-metadata entry must go too (undo restores the prose; a stale stamp for
    // a table that no longer exists would just be noise).
    if (tableDelete && m.setTableMeta) m.setTableMeta(tableDelete.tableId, { createdAt: null, updatedAt: null, origin: null });
    setTableDelete(null);
  };

  const status = sectionStatus(section);
  const isTitle = sel === 'title';
  const isAbstract = sel === 'abstract';
  // remount (→ re-render from props) ONLY when the section identity changes or it
  // is (re)generated — typing never remounts, so the caret is never fought.
  const resetKey = `${m.activeId}:${sel}:${lastGen || ''}`;
  // MOUNT value for the one-time-render editors. This must be the DRAFT content
  // (fresh in the same render as a section switch or a generate), NOT `buf`: the
  // buf-resync effect runs AFTER the keyed remount, so an editor mounted from buf
  // would show the PREVIOUS section's (or pre-generation) text forever. `buf`
  // keeps serving the live views (orderMap, outline, title input).
  const pageValue = ((m.activeDraft.sections || {})[sel] || {}).content || '';

  return (
    <div data-testid="stitch-manuscript-editor" style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <style>{RICH_EDITOR_CSS}</style>
      {/* 117.md §11 — deleting a cited table warns first, then allows it. */}
      <TableDeleteDialog info={tableDelete} onConfirm={confirmDeleteTable} onCancel={() => setTableDelete(null)} />

      {/* ── left: outline ── */}
      <div style={{ width: 216, flexShrink: 0, minWidth: 180, flex: '0 1 216px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SECTION_TYPES.map((s) => {
            const sec = (m.activeDraft.sections && m.activeDraft.sections[s.id]) || {};
            const st = sectionStatus(sec);
            const active = s.id === sel;
            const subs = outline[s.id] || [];
            return (
              <div key={s.id}>
                <button onClick={() => switchTo(s.id)}
                  data-testid={`stitch-manuscript-section-${s.id}`}
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
                  {(m.outdated || {})[s.id] && (
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
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.txt }}>{(SECTION_TYPES.find((s) => s.id === sel) || {}).label}</h3>
            {locked && (
              <span style={tagS('purple')} data-testid="stitch-manuscript-locked-badge">
                <Icon name="lock" size={9} /> Locked
              </span>
            )}
            {status === 'ai-draft' && <span style={tagS('yellow')}>Auto-draft — verify</span>}
            {status === 'edited' && <span style={tagS('green')}>Edited</span>}
            {isOutdated && (
              <span style={tagS('yellow')} data-testid="stitch-manuscript-outdated-badge"
                title="Project data changed since this was generated">
                Outdated
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {isOutdated && !locked && (
              <button onClick={() => doGenerate([sel])}
                title="Regenerate this section from the latest project data"
                data-testid="stitch-manuscript-regenerate"
                style={{ ...btnS('ghost'), fontSize: 11 }}>
                <Icon name="refresh" size={12} /> Regenerate
              </button>
            )}
            <button onClick={() => m.setSectionLocked && m.setSectionLocked(sel, !locked)}
              aria-pressed={locked}
              aria-label={locked ? `Unlock ${(SECTION_TYPES.find((s) => s.id === sel) || {}).label || 'section'}` : `Lock ${(SECTION_TYPES.find((s) => s.id === sel) || {}).label || 'section'}`}
              title={locked ? 'Unlock this section — editing and regeneration become available again' : 'Lock this section — read-only, and generation always skips it'}
              data-testid="stitch-manuscript-lock-toggle"
              style={{ ...btnS(locked ? 'primary' : 'ghost'), fontSize: 11 }}>
              <Icon name="lock" size={12} /> {locked ? 'Unlock' : 'Lock'}
            </button>
            <button onClick={() => setWhyOpen((v) => !v)} aria-expanded={whyOpen}
              aria-label="Why does this section say this?"
              title="Show what this section was generated from and what it depends on"
              data-testid="stitch-manuscript-why-toggle"
              style={{ ...btnS(whyOpen ? 'primary' : 'ghost'), fontSize: 11 }}>
              <Icon name="info" size={12} /> Why?
            </button>
            <button onClick={() => setToolsOpen((v) => !v)} aria-label={toolsOpen ? 'Hide tools panel' : 'Show tools panel'}
              title={toolsOpen ? 'Hide tools panel' : 'Show tools panel'}
              data-testid="stitch-manuscript-tools-toggle"
              style={{ ...btnS('ghost'), fontSize: 11 }}>
              <Icon name="layers" size={12} /> {toolsOpen ? 'Hide tools' : 'Tools'}
            </button>
          </div>
        </div>

        {/* 73.md Part 9 — per-section provenance (stamped at generation time) */}
        {Array.isArray(section.sources) && section.sources.length > 0 && (
          <div data-testid="stitch-manuscript-sources"
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>Generated from</span>
            {section.sources.map((s) => <span key={s.key} style={tagS('blue')}>{s.label}</span>)}
          </div>
        )}
        {Array.isArray(section.missing) && section.missing.length > 0 && (
          <div data-testid="stitch-manuscript-missing" style={{ fontSize: 11, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>
            Missing: {section.missing.slice(0, 2).map((x) => x.hint).join(' · ')}
          </div>
        )}

        {/* 84.md — "Why does this say this?" provenance detail (sources / missing /
            last generated / declared dependencies). Compact; keyboard-toggled. */}
        {whyOpen && (
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
        {!isTitle && (
          <RichToolbar getApi={getApi} citeRefs={citeRefs} refLabel={refLabel} disabled={locked}
            /* 117.md §9 — Insert → Cross-reference, at the caret, with search. */
            crossRefs={crossRefItems} onInsertCrossRef={insertAssetRef}
            /* 117.md §34/§35 — Insert → Citation, searchable + multi-select. */
            onInsertCitation={insertCitation} />
        )}

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {/* position:relative anchors the 116.md §61 floating table controls */}
          <div ref={pageRef} className="ms-paper" data-testid="stitch-manuscript-page"
            style={{ width: '100%', maxWidth: 760, padding: '44px 52px 56px', minHeight: 480, boxSizing: 'border-box', position: 'relative' }}>
            {isTitle ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <input value={buf} onChange={(e) => onType(e.target.value)} placeholder="Full manuscript title…"
                  disabled={locked} aria-label="Manuscript title" data-testid="stitch-manuscript-title-input"
                  style={{
                    width: '100%', border: 'none', outline: 'none', background: 'transparent',
                    color: '#1c2330', fontFamily: "Georgia,'Times New Roman',serif",
                    fontSize: 22, fontWeight: 700, lineHeight: 1.45, textAlign: 'center', boxSizing: 'border-box',
                  }} />
                <div style={{ borderTop: '1px solid #e2e6ee', paddingTop: 18 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#98a1b3', letterSpacing: 0.6, textTransform: 'uppercase', fontFamily: "'IBM Plex Sans',sans-serif", marginBottom: 6 }}>
                    Keywords (comma-separated)
                  </div>
                  <input value={kw}
                    onChange={(e) => { setKw(e.target.value); m.setMetaDebounced({ keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }); }}
                    placeholder="e.g. systematic review, meta-analysis, …"
                    aria-label="Keywords"
                    disabled={locked}
                    style={{
                      width: '100%', border: 'none', outline: 'none', background: 'transparent',
                      color: '#1c2330', fontFamily: "Georgia,'Times New Roman',serif", fontSize: 14, boxSizing: 'border-box',
                    }} />
                </div>
              </div>
            ) : isAbstract ? (
              <AbstractEditor value={pageValue} templateId={m.activeDraft.templateId} orderMap={orderMap}
                assetNumbers={assetNumbers}
                // 117.md §8/§11 — same registry + caption template as the body sections.
                knownAssetIds={knownAssetIds} captionTemplateId={m.activeDraft.templateId}
                resetKey={resetKey} onChange={onType} onActivate={setActive} readOnly={locked} />
            ) : (
              <RichSectionEditor key={resetKey} ref={mainApi} value={pageValue} orderMap={orderMap}
                assetNumbers={assetNumbers}
                // 101.md §4/§5/§6 — the live fact layer. `facts` makes project
                // values resolve at render (so no refresh action exists), and
                // `showChanges` toggles ONLY the overlay: the markdown behind the
                // editor is byte-identical in both modes.
                facts={m.resolvedFacts}
                factOverrides={m.factOverrides}
                factChanges={(m.activeDraft && m.activeDraft.factLog) || null}
                showChanges={m.showChanges}
                // 102.md §3 — keep the panel's "current field" marker in step when
                // the researcher reaches a placeholder by clicking rather than by
                // pressing Next.
                onPlaceholderFocus={(label) => {
                  const hit = (m.placeholders || []).find(
                    (x) => x.sectionId === sel && x.label === label,
                  );
                  if (hit) m.setCurrentPlaceholderId && m.setCurrentPlaceholderId(hit.id);
                }}
                onChange={onType} onActivate={setActive} readOnly={locked}
                // 116.md §61 — report the caret's table context for the floating
                // table controls (never while locked: no edits are possible).
                onTableFocus={locked ? null : setTableCtx}
                // 117.md §4/§8/§10/§11 — the manuscript-object layer.
                knownAssetIds={knownAssetIds}
                templateId={m.activeDraft.templateId}
                existingTableIds={existingTableIds}
                onAssetChipMenu={(info) => { setChipHover(null); setRelinking(false); setChipMenu(info); }}
                onAssetChipHover={setChipHover}
                onTableMeta={m.setTableMeta}
                // 117.md §37/§38/§39 — the citation layer: style-aware chip labels,
                // the reference metadata behind them, and the two chip callbacks.
                citationStyle={m.activeDraft.citationStyle}
                refsById={m.refsById}
                yearSuffixes={m.citationYearSuffixes}
                onCiteChipMenu={openCiteMenu}
                onCiteChipHover={setCiteHover}
                ariaLabel={(SECTION_TYPES.find((s) => s.id === sel) || {}).label || 'Section'}
                placeholder="Write this section here, or generate it from your project data. Use the toolbar for headings, lists and citations." />
            )}
            {/* 116.md §61/§62 — floating row/col/table ops while the caret is in a table */}
            {!isTitle && !isAbstract && !locked && tableCtx && (
              <TableContextBar ctx={tableCtx} pageEl={pageRef.current} getApi={getApi}
                onDeleteTable={askDeleteTable} />
            )}
            {/* 117.md §10 — hover preview, suppressed while the action menu is open */}
            {!isTitle && !chipMenu && chipHover && (
              <AssetRefHoverCard info={chipHover} asset={hoverAsset} pageEl={pageRef.current} />
            )}
            {/* 117.md §38 — citation hover preview + action menu, same rules */}
            {!isTitle && !citeMenu && citeHover && (
              <CiteHoverCard info={citeHover} refs={refsOf(citeHover)} pageEl={pageRef.current}
                yearSuffixes={m.citationYearSuffixes} />
            )}
            {!isTitle && citeMenu && (
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
            {!isTitle && chipMenu && (
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
              const id = change && sectionStatingFact(m.activeDraft, change.key);
              if (id) switchTo(id);
            }}
          />

          <ToolsGroup id="generate" title="Generate" defaultOpen>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => doGenerate([sel])} disabled={locked}
                title={locked ? 'This section is locked — unlock it to regenerate.' : 'Generate this section from project data'}
                style={{ ...btnS('ghost'), justifyContent: 'center', opacity: locked ? 0.5 : 1, cursor: locked ? 'not-allowed' : undefined }}>
                <Icon name="refresh" size={12} /> Generate this section
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
              <CiteRefPicker items={citeItems} disabled={isTitle || locked} block
                testIdPrefix="stitch-manuscript-tools-cite"
                label="+ Insert citation…" onInsert={insertCitation} />
              {citeRefs.length === 0 && (
                <div style={{ fontSize: 10.5, color: C.muted }}>References appear here once your project has included studies.</div>
              )}
              <button onClick={insertPrisma} disabled={isTitle || locked}
                aria-label="Insert PRISMA study-selection summary at the cursor"
                title="Insert the PRISMA study-selection paragraph (from your live counts) as editable text"
                data-testid="stitch-manuscript-insert-prisma"
                style={{ ...btnS('ghost'), justifyContent: 'center', opacity: (isTitle || locked) ? 0.5 : 1 }}>
                <Icon name="flow" size={12} /> Insert PRISMA summary
              </button>
              {/* 117.md §9 — the Tools entry point to the SAME picker the toolbar
                  uses (search + number + origin, inserted at the caret). It
                  replaces the old bare <select>, which had no search, could not
                  show a number, and spliced a block into the sentence. */}
              {availableAssets.length > 0 && (
                <CrossRefPicker items={crossRefItems} disabled={isTitle || locked} block
                  testIdPrefix="stitch-manuscript-tools-crossref"
                  label="⧉ Reference a table/figure…"
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

export function SaveStatusPill({ saveState, lastError, onRetry }) {
  if (saveState === 'conflict') {
    return (
      <span
        data-testid="stitch-manuscript-save-status"
        role="status"
        aria-live="polite"
        title="Another tab or collaborator saved first, so this change was refused. Load the latest version before editing further."
        style={{ ...tagS('red'), ...savePillBase }}
      >
        <SaveDot color={C.red} />
        Updated elsewhere — not saved
      </span>
    );
  }
  if (saveState === 'error') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexWrap: 'nowrap' }}>
        <span data-testid="stitch-manuscript-save-status" role="status" aria-live="polite"
          title={lastError || 'Could not save changes.'} style={{ ...tagS('red'), ...savePillBase }}>
          <SaveDot color={C.red} />
          Save failed
        </span>
        {onRetry && (
          <button type="button" onClick={onRetry} aria-label="Retry saving"
            style={{ ...btnS('danger'), fontSize: 10.5, padding: '3px 10px' }}>
            Retry
          </button>
        )}
      </span>
    );
  }
  const saving = saveState === 'saving';
  return (
    <span data-testid="stitch-manuscript-save-status" role="status" aria-live="polite"
      style={{ ...tagS(saving ? 'yellow' : 'green'), ...savePillBase }}>
      <SaveDot color={saving ? C.yel : C.grn} pulse={saving} />
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

/** One asset's controls: number, editable title/caption(/legend), include toggle,
    honest badges, Insert-reference. Text edits are BUFFERED per panel and land
    as per-asset patches through queueAssetPatch (merge-at-flush). */
function AssetControls({ m, asset, buf, commit, onInsertNotice }) {
  const slug = assetTestSlug(asset.id);
  const ov = (buf && buf[asset.id]) || {};
  const numbering = m.assetNumbering || {};
  // 117.md §4 — a MANUAL table is prose. It cannot be "excluded" (that would mean
  // deleting text), and its title is not an override — see the Title field below.
  const isManual = asset.origin === 'manual';
  const mentioned = !!(numbering.mentioned && numbering.mentioned.has && numbering.mentioned.has(asset.id));
  const autoIncluded = !!(numbering.autoIncluded && numbering.autoIncluded.has && numbering.autoIncluded.has(asset.id));
  // Optimistic: the buffered override wins so the toggle responds instantly
  // (persistence is debounced; prepareExport flushes it before validating).
  const includedNow = typeof ov.included === 'boolean' ? ov.included : (!!asset.included || autoIncluded);
  const patch = (p) => commit(asset.id, p);
  const numLabel = assetNumberLabel(m, asset);
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
        {asset.stale && <span style={tagS('yellow')}>Stale</span>}
        {mentioned
          ? <span style={tagS('purple')} title={autoIncluded ? 'Included because the text references it' : 'Referenced in the text'}>Referenced in text</span>
          : <span style={{ fontSize: 10.5, color: C.muted }}>Not referenced in the text</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.txt2, cursor: (asset.available && !isManual) ? 'pointer' : 'not-allowed' }}
            title={isManual ? 'This table is part of the manuscript text — delete it in the Editor to remove it'
              : !asset.available ? 'No data yet — nothing to include'
                : mentioned ? 'Referenced in the text — remove the reference to exclude it' : 'Include this in the Word export'}>
            <input type="checkbox" checked={includedNow}
              disabled={!asset.available || mentioned || isManual}
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
                Edit this table&rsquo;s title in its caption, in the Editor.
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

export function TablesPanel({ m }) {
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
            <AssetControls m={m} asset={asset} buf={buf} commit={commit} onInsertNotice={setNotice} />
            <div style={{ marginTop: 10 }}>
              {/* 117.md §4 — a manual table's CONTENT lives in the manuscript text.
                  Rendering a second, editable copy here would create a second place
                  to change it; this panel owns its metadata, the Editor owns it. */}
              {isManual ? (
                <div data-testid={`stitch-manuscript-asset-manual-${assetTestSlug(asset.id)}`}
                  style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
                  Typed in the {(SECTION_TYPES.find((s) => s.id === asset.sectionId) || {}).label || 'manuscript'} section —
                  edit its rows and its title there. It is numbered with the generated tables and exports with a caption.
                </div>
              ) : <DataTable table={t} />}
            </div>
            {((t && t.warnings) || []).map((w, i) => <InfoBox key={i} color={C.yel}>{w}</InfoBox>)}
          </Card>
        );
      })}
    </div>
  );
}

export function FiguresPanel({ m }) {
  const [buf, commit] = useAssetOverridesBuffer(m);
  const [notice, setNotice] = useState('');
  const svgs = useFigureSvgs(m, { forest: true, prisma: true });
  const figureAssets = (m.assets || []).filter((a) => a.kind === 'figure');
  const preview = (asset) => {
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
      {notice && <InfoBox color={C.acc}>{notice}</InfoBox>}
      {figureAssets.map((asset) => (
        <Card key={asset.id} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.txt }}>{asset.title}</h3>
          </div>
          <AssetControls m={m} asset={asset} buf={buf} commit={commit} onInsertNotice={setNotice} />
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

/* ════════════ 7. EXPORT ════════════ */
export function ExportPanel({ m, exporters }) {
  const tpl = JOURNAL_TEMPLATES.find((t) => t.id === m.activeDraft.templateId);
  const sectionsDone = SECTION_TYPES.filter((s) => sectionStatus((m.activeDraft.sections && m.activeDraft.sections[s.id]) || {}) !== 'empty').length;
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
            <Stat label="Sections drafted" value={`${sectionsDone}/${SECTION_TYPES.length}`} />
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

      <Block title="Journal template">
        <Labeled label="Template">
          <Select value={m.activeDraft.templateId} onChange={(e) => m.setMeta({ templateId: e.target.value })}>
            {JOURNAL_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </Labeled>
        {tpl && tpl.note && <div style={{ marginTop: 8, fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>{tpl.note}</div>}
        <InfoBox color={C.yel}>Journal templates are formatting aids. Always verify against the journal's current author instructions before submission.</InfoBox>
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
