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
  const busy = (k) => exporting === k;
  const lbl = (k, base) => (busy(k) ? 'Generating…' : base);
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <button onClick={onExportWord} disabled={!!exporting}
        data-testid={canonical ? 'stitch-manuscript-export-word' : undefined}
        style={{ ...btnS('primary'), opacity: exporting ? 0.6 : 1 }}>
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
export function OverviewPanel({ m, exporters }) {
  const r = m.readiness;
  const tpl = JOURNAL_TEMPLATES.find((t) => t.id === m.activeDraft.templateId);
  return (
    <div>
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

export function EditorPanel({ m, exporters }) {
  const [sel, setSel] = useState('title');
  const [genNotice, setGenNotice] = useState(null); // { only:null|[id], skipped:[...] }
  const [toolsOpen, setToolsOpen] = useState(true);

  const section = (m.activeDraft.sections && m.activeDraft.sections[sel]) || {};
  const lastGen = section.lastGeneratedAt || null;
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

  const onType = (val) => { setBuf(val); m.updateSection(sel, val); };

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
    if (res && res.skipped && res.skipped.length) setGenNotice({ only: only || null, skipped: res.skipped });
    else setGenNotice(null);
  };
  const doOverwrite = () => {
    const opts = { overwriteEdited: true };
    if (genNotice && genNotice.only) opts.only = genNotice.only;
    m.generate(opts);
    setGenNotice(null);
  };

  const insertCitation = (refId) => { const api = getApi(); if (api && refId) api.insertCitation(refId); };
  // MS-8: insert the generated study-selection paragraph as normal editable text
  const insertPrisma = () => { const api = getApi(); if (api) api.insertMarkdown(studySelectionParagraph(m.prismaCounts)); };

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
            const st = sectionStatus((m.activeDraft.sections && m.activeDraft.sections[s.id]) || {});
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
                  {s.label}
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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 8 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: C.yel }} /> AI draft</span>{'  '}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 8 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: C.dim, border: `1px solid ${C.brd2}` }} /> Empty</span>
        </div>
      </div>

      {/* ── center: paper page ── */}
      <div style={{ flex: '1 1 460px', minWidth: 300 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.txt }}>{(SECTION_TYPES.find((s) => s.id === sel) || {}).label}</h3>
            {status === 'ai-draft' && <span style={tagS('yellow')}>AI draft — verify</span>}
            {status === 'edited' && <span style={tagS('green')}>Edited</span>}
          </div>
          <button onClick={() => setToolsOpen((v) => !v)} aria-label={toolsOpen ? 'Hide tools panel' : 'Show tools panel'}
            title={toolsOpen ? 'Hide tools panel' : 'Show tools panel'}
            data-testid="stitch-manuscript-tools-toggle"
            style={{ ...btnS('ghost'), fontSize: 11 }}>
            <Icon name="layers" size={12} /> {toolsOpen ? 'Hide tools' : 'Tools'}
          </button>
        </div>

        {genNotice && (
          <div style={{ marginBottom: 12 }}>
            <InfoBox color={C.yel}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span>{genNotice.skipped.length} section(s) you edited were preserved and not overwritten.</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button onClick={doOverwrite} style={{ ...btnS('danger'), fontSize: 11 }}>Overwrite anyway</button>
                  <button onClick={() => setGenNotice(null)} style={{ ...btnS('ghost'), fontSize: 11 }}>Keep edits</button>
                </span>
              </div>
            </InfoBox>
          </div>
        )}

        {!isTitle && <RichToolbar getApi={getApi} citeRefs={citeRefs} refLabel={refLabel} />}

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div ref={pageRef} className="ms-paper" data-testid="stitch-manuscript-page"
            style={{ width: '100%', maxWidth: 760, padding: '44px 52px 56px', minHeight: 480, boxSizing: 'border-box' }}>
            {isTitle ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <input value={buf} onChange={(e) => onType(e.target.value)} placeholder="Full manuscript title…"
                  aria-label="Manuscript title" data-testid="stitch-manuscript-title-input"
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
                resetKey={resetKey} onChange={onType} onActivate={setActive} />
            ) : (
              <RichSectionEditor key={resetKey} ref={mainApi} value={pageValue} orderMap={orderMap}
                onChange={onType} onActivate={setActive}
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

          <Card style={{ padding: 12 }}>
            <ToolsLabel>Generate</ToolsLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => doGenerate([sel])} style={{ ...btnS('ghost'), justifyContent: 'center' }}>
                <Icon name="refresh" size={12} /> Generate this section
              </button>
              <button onClick={() => doGenerate(null)} data-testid="stitch-manuscript-generate" style={{ ...btnS('primary'), justifyContent: 'center' }}>
                <Icon name="sigma" size={13} /> Generate all sections
              </button>
              <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>Sections you edited are preserved — you are asked before anything is overwritten.</div>
            </div>
          </Card>

          <Card style={{ padding: 12 }}>
            <ToolsLabel>Insert</ToolsLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {citeRefs.length > 0 ? (
                <select value="" disabled={isTitle}
                  aria-label="Insert citation" title="Insert a numbered citation at the cursor"
                  data-testid="stitch-manuscript-tools-cite"
                  onChange={(e) => { insertCitation(e.target.value); e.target.value = ''; }}
                  style={{ ...inp, cursor: isTitle ? 'default' : 'pointer', fontSize: 11, paddingRight: 22, opacity: isTitle ? 0.5 : 1 }}>
                  <option value="">+ Insert citation…</option>
                  {citeRefs.map((r) => <option key={r.id} value={r.id}>{refLabel(r)}</option>)}
                </select>
              ) : (
                <div style={{ fontSize: 10.5, color: C.muted }}>References appear here once your project has included studies.</div>
              )}
              <button onClick={insertPrisma} disabled={isTitle}
                aria-label="Insert PRISMA study-selection summary at the cursor"
                title="Insert the PRISMA study-selection paragraph (from your live counts) as editable text"
                data-testid="stitch-manuscript-insert-prisma"
                style={{ ...btnS('ghost'), justifyContent: 'center', opacity: isTitle ? 0.5 : 1 }}>
                <Icon name="flow" size={12} /> Insert PRISMA summary
              </button>
            </div>
          </Card>

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
            <Card style={{ padding: 12 }}>
              <ToolsLabel>Export</ToolsLabel>
              <ExportButtons exporters={exporters} />
              {exporters.exportError && <InfoBox color={C.red}>{exporters.exportError}</InfoBox>}
            </Card>
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
