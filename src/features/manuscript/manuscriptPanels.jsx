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
import {
  SECTION_TYPES, SECTION_IDS, STATEMENT_TYPES, CITATION_STYLES, JOURNAL_TEMPLATES, sectionStatus,
  collectCitationOrder, draftSectionTexts, studySelectionParagraph,
} from '../../research-engine/manuscript/index.js';
import { RichSectionEditor, RichToolbar, RICH_EDITOR_CSS } from './richEditor/RichSectionEditor.jsx';
import { AbstractEditor } from './richEditor/AbstractEditor.jsx';
import { extractOutline } from './richEditor/mdDom.js';
// 67.md — Word (.docx) export is a Plus-plan feature (server-enforced). This is
// UX-only, fail-open: only disable the button once we KNOW the plan lacks it.
import { useEntitlements } from '../../frontend/entitlements';

const WORD_EXPORT_LOCKED_MSG = 'Word export is available on the Plus plan and above.';

/* ════════════ shared bits ════════════ */

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
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    (async () => {
      try {
        const fig = await import('./export/figures.js');
        const next = { forest: null, prisma: null, loading: false, error: '' };
        if (prisma) next.prisma = fig.prismaSvg(m.prismaCounts);
        if (forest && primaryResult) next.forest = fig.forestSvg(primaryResult, { esType });
        if (alive) setState(next);
      } catch (e) {
        if (alive) setState({ forest: null, prisma: null, loading: false, error: (e && e.message) || 'Could not render figures.' });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forest, prisma, primaryResult, esType, m.prismaCounts]);
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
  const { onExportWord, onExportRepro, onPrismaChecklist, onPrismaSChecklist, exporting } = exporters;
  const ent = useEntitlements();
  const wordLocked = !ent.loading && !ent.has('manuscript.wordExport');
  const busy = (k) => exporting === k;
  const lbl = (k, base) => (busy(k) ? 'Generating…' : base);
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
      <button onClick={() => m.generate({})}
        data-testid="stitch-manuscript-hero-generate"
        style={{ ...btnS('primary'), fontSize: 12.5, padding: '9px 22px' }}>
        <Icon name="sigma" size={14} /> Generate your first draft
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

export function EditorPanel({ m, exporters, sectionRequest }) {
  const [sel, setSel] = useState('title');
  const [genNotice, setGenNotice] = useState(null); // { only:null|[id], skipped:[...], skippedLocked:[...] }
  const [toolsOpen, setToolsOpen] = useState(true);

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

  const citeRefs = m.references || [];
  const refLabel = (r) => {
    const a = r.ref && r.ref.authorsList && r.ref.authorsList[0];
    const fam = a ? (a.family || a.raw) : ((r.ref && r.ref.title) || 'ref');
    return `${fam}${r.ref && r.ref.year ? ` ${r.ref.year}` : ''}`;
  };
  // inline-citation numbering (includes the unsaved buffer)
  const orderMap = useMemo(() => {
    const texts = draftSectionTexts(m.activeDraft).map((t, i) => (SECTION_IDS[i] === sel ? buf : t));
    return collectCitationOrder(texts).orderMap;
  }, [m.activeDraft, sel, buf]);

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

  const insertCitation = (refId) => { if (locked) return; const api = getApi(); if (api && refId) api.insertCitation(refId); };
  // MS-8: insert the generated study-selection paragraph as normal editable text
  const insertPrisma = () => { if (locked) return; const api = getApi(); if (api) api.insertMarkdown(studySelectionParagraph(m.prismaCounts)); };

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

        {!isTitle && <RichToolbar getApi={getApi} citeRefs={citeRefs} refLabel={refLabel} disabled={locked} />}

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div ref={pageRef} className="ms-paper" data-testid="stitch-manuscript-page"
            style={{ width: '100%', maxWidth: 760, padding: '44px 52px 56px', minHeight: 480, boxSizing: 'border-box' }}>
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
                    style={{
                      width: '100%', border: 'none', outline: 'none', background: 'transparent',
                      color: '#1c2330', fontFamily: "Georgia,'Times New Roman',serif", fontSize: 14, boxSizing: 'border-box',
                    }} />
                </div>
              </div>
            ) : isAbstract ? (
              <AbstractEditor value={pageValue} templateId={m.activeDraft.templateId} orderMap={orderMap}
                resetKey={resetKey} onChange={onType} onActivate={setActive} readOnly={locked} />
            ) : (
              <RichSectionEditor key={resetKey} ref={mainApi} value={pageValue} orderMap={orderMap}
                onChange={onType} onActivate={setActive} readOnly={locked}
                ariaLabel={(SECTION_TYPES.find((s) => s.id === sel) || {}).label || 'Section'}
                placeholder="Write this section here, or generate it from your project data. Use the toolbar for headings, lists and citations." />
            )}
          </div>
        </div>
      </div>

      {/* ── right: tools (collapsible; stacks below on narrow screens via wrap) ── */}
      {toolsOpen && (
        <div data-testid="stitch-manuscript-tools" style={{ width: 264, minWidth: 220, flex: '0 1 264px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card style={{ padding: 12 }}>
            <ToolsLabel>Save status</ToolsLabel>
            <SaveStatusPill saveState={m.saveState} lastError={m.lastError} onRetry={m.retry} />
          </Card>

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
              {citeRefs.length > 0 ? (
                <select value="" disabled={isTitle || locked}
                  aria-label="Insert citation" title="Insert a numbered citation at the cursor"
                  data-testid="stitch-manuscript-tools-cite"
                  onChange={(e) => { insertCitation(e.target.value); e.target.value = ''; }}
                  style={{ ...inp, cursor: (isTitle || locked) ? 'default' : 'pointer', fontSize: 11, paddingRight: 22, opacity: (isTitle || locked) ? 0.5 : 1 }}>
                  <option value="">+ Insert citation…</option>
                  {citeRefs.map((r) => <option key={r.id} value={r.id}>{refLabel(r)}</option>)}
                </select>
              ) : (
                <div style={{ fontSize: 10.5, color: C.muted }}>References appear here once your project has included studies.</div>
              )}
              <button onClick={insertPrisma} disabled={isTitle || locked}
                aria-label="Insert PRISMA study-selection summary at the cursor"
                title="Insert the PRISMA study-selection paragraph (from your live counts) as editable text"
                data-testid="stitch-manuscript-insert-prisma"
                style={{ ...btnS('ghost'), justifyContent: 'center', opacity: (isTitle || locked) ? 0.5 : 1 }}>
                <Icon name="flow" size={12} /> Insert PRISMA summary
              </button>
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

/** UX-6: honest save pill — 'error' shows the failure and offers a retry. */
export function SaveStatusPill({ saveState, lastError, onRetry }) {
  if (saveState === 'error') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span data-testid="stitch-manuscript-save-status" title={lastError || 'Could not save changes.'} style={tagS('red')}>
          Save failed
        </span>
        {onRetry && (
          <button onClick={onRetry} aria-label="Retry saving" style={{ ...btnS('danger'), fontSize: 10.5, padding: '3px 10px' }}>
            Retry
          </button>
        )}
      </span>
    );
  }
  return (
    <span data-testid="stitch-manuscript-save-status" style={tagS(saveState === 'saving' ? 'yellow' : 'green')}>
      {saveState === 'saving' ? 'Saving…' : 'Saved'}
    </span>
  );
}

/* ════════════ 3. TABLES ════════════ */
function fmtTime(iso) { try { return iso ? new Date(iso).toLocaleString() : 'Not refreshed'; } catch { return 'Not refreshed'; } }

export function TablesPanel({ m }) {
  const order = ['study', 'sof', 'prisma', 'rob', 'search'];
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button onClick={m.refreshAllBlocks} data-testid="stitch-manuscript-refresh-all" style={btnS('ghost')}>
          <Icon name="refresh" size={13} /> Refresh all
        </button>
      </div>
      {order.map((key) => {
        const t = m.tables[key];
        if (!t) return null;
        const st = m.staleness[t.id] || {};
        return (
          <Card key={key} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.txt }}>{t.title}</h3>
                {st.stale && <span style={tagS('yellow')}>Stale</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 10.5, color: C.muted }}>Last refreshed: {fmtTime(st.lastRefreshedAt)}</span>
                <button onClick={() => m.refreshBlock(t.id)} style={{ ...btnS('ghost'), fontSize: 11 }}>
                  <Icon name="refresh" size={12} /> Refresh
                </button>
              </div>
            </div>
            <DataTable table={t} />
            {(t.warnings || []).map((w, i) => <InfoBox key={i} color={C.yel}>{w}</InfoBox>)}
          </Card>
        );
      })}
    </div>
  );
}

/* ════════════ 4. FIGURES ════════════ */
export function FiguresPanel({ m }) {
  const svgs = useFigureSvgs(m, { forest: true, prisma: true });
  const hasForest = m.primary && m.primary.result;
  return (
    <div>
      <InfoBox color={C.acc}>The forest plot and PRISMA 2020 flow diagram below are embedded automatically in the Word export and the reproducibility package.</InfoBox>

      <Block title="PRISMA 2020 flow diagram">
        {svgs.loading ? <div style={{ color: C.muted, fontSize: 12 }}>Rendering…</div>
          : svgs.error ? <InfoBox color={C.red}>{svgs.error}</InfoBox>
            : svgs.prisma ? <SvgBox svg={svgs.prisma} />
              : <InfoBox color={C.muted}>No PRISMA counts available yet — enter them in the PRISMA tab.</InfoBox>}
      </Block>

      <Block title="Forest plot">
        {!hasForest ? <InfoBox color={C.muted}>No meta-analysis result yet. Add studies with effect sizes and run an analysis to see a forest plot.</InfoBox>
          : svgs.loading ? <div style={{ color: C.muted, fontSize: 12 }}>Rendering…</div>
            : svgs.error ? <InfoBox color={C.red}>{svgs.error}</InfoBox>
              : svgs.forest ? <SvgBox svg={svgs.forest} />
                : <InfoBox color={C.muted}>The forest plot could not be rendered from the current analysis.</InfoBox>}
      </Block>
    </div>
  );
}

/* ════════════ 5. REFERENCES ════════════ */
export function ReferencesPanel({ m }) {
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const refs = m.references || [];
  const missing = refs.filter((r) => !(r.ref && (r.ref.doi || r.ref.pmid))).length;

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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: C.txt2 }}><strong style={{ color: C.txt }}>{refs.length}</strong> reference{refs.length === 1 ? '' : 's'}</span>
          <Labeled label="Style">
            <Select value={m.activeDraft.citationStyle} onChange={(e) => m.setMeta({ citationStyle: e.target.value })}>
              {CITATION_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Labeled>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={onCopy} style={btnS('ghost')}><Icon name="copy" size={12} /> {copied ? 'Copied' : 'Copy reference list'}</button>
          <button onClick={() => onExport('bib')} style={btnS('ghost')}><Icon name="download" size={12} /> BibTeX</button>
          <button onClick={() => onExport('ris')} style={btnS('ghost')}><Icon name="download" size={12} /> RIS</button>
        </div>
      </div>

      {err && <InfoBox color={C.red}>{err}</InfoBox>}
      {missing > 0 && <InfoBox color={C.yel}>{missing} reference{missing === 1 ? '' : 's'} lack a DOI or PMID — verify these citations before submission.</InfoBox>}

      {refs.length ? (
        <Card>
          <ol style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {refs.map((r) => (
              <li key={r.id || r.index} value={r.index} style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6 }}>{r.text}</li>
            ))}
          </ol>
        </Card>
      ) : <InfoBox color={C.muted}>No references yet. References are collected from your included studies and imported records.</InfoBox>}
    </div>
  );
}

/* ════════════ 6. PRISMA ════════════ */
const PROV_TAG = { manual: 'blue', override: 'purple', computed: 'green', derived: 'green', missing: 'red' };
const OVERRIDE_FIELDS = [
  { k: 'identified', label: 'Records identified' },
  { k: 'dedupe', label: 'Duplicates removed' },
  { k: 'screened', label: 'Records screened' },
  { k: 'excludedScreen', label: 'Excluded at screening' },
  { k: 'reportsExcluded', label: 'Reports excluded (full text)' },
  { k: 'included', label: 'Studies included' },
  { k: 'includedQuant', label: 'Included in meta-analysis' },
];

export function PrismaPanel({ m, exporters }) {
  const pc = m.prismaCounts;
  const pt = m.tables.prisma;
  const overrides = m.activeDraft.prismaOverrides || {};
  const svgs = useFigureSvgs(m, { prisma: true });

  const setOverride = (k, raw) => {
    const next = { ...overrides };
    if (raw === '' || raw == null) delete next[k];
    else { const n = Number(raw); if (Number.isFinite(n)) next[k] = n; }
    m.setMetaDebounced({ prismaOverrides: next });
  };

  const provRows = (pt && pt.rowsWithProvenance) || [];

  return (
    <div>
      <Block title="PRISMA 2020 counts" desc="Computed from your project data; manual overrides take precedence (and are labelled below).">
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
        {(pc.warnings || []).map((w, i) => <InfoBox key={i} color={C.yel}>{w}</InfoBox>)}
      </Block>

      <Block title="PRISMA 2020 flow diagram">
        {svgs.loading ? <div style={{ color: C.muted, fontSize: 12 }}>Rendering…</div>
          : svgs.error ? <InfoBox color={C.red}>{svgs.error}</InfoBox>
            : svgs.prisma ? <SvgBox svg={svgs.prisma} />
              : <InfoBox color={C.muted}>Enter counts below to see the flow diagram.</InfoBox>}
      </Block>

      <Block title="Manual overrides" desc="Enter a number to override the computed value for that PRISMA box. Leave blank to use the computed value.">
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
            {OVERRIDE_FIELDS.map((f) => (
              <Labeled key={f.k} label={f.label}>
                <input type="number" min="0" value={overrides[f.k] == null ? '' : overrides[f.k]}
                  onChange={(e) => setOverride(f.k, e.target.value)}
                  placeholder="computed" style={inp} />
              </Labeled>
            ))}
          </div>
          <InfoBox color={C.purp}>Any value entered here is treated as a <strong>manual override</strong> and is labelled accordingly in the counts table and the PRISMA flow diagram.</InfoBox>
        </Card>
      </Block>

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
