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
  citationToken, collectCitationOrder, draftSectionTexts, renderInlineMarkers,
} from '../../research-engine/manuscript/index.js';

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

function Card({ children, style }) {
  return <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 16, ...style }}>{children}</div>;
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

/* ── safe, tiny markdown → HTML (escape FIRST, then format a small subset) ── */
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function mdToHtml(md) {
  const esc = escapeHtml(md);
  const inline = (t) => t
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = esc.split(/\r?\n/);
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const line of lines) {
    if (/^###\s+/.test(line)) { closeList(); out.push(`<h4>${inline(line.replace(/^###\s+/, ''))}</h4>`); continue; }
    if (/^##\s+/.test(line)) { closeList(); out.push(`<h3>${inline(line.replace(/^##\s+/, ''))}</h3>`); continue; }
    if (/^#\s+/.test(line)) { closeList(); out.push(`<h2>${inline(line.replace(/^#\s+/, ''))}</h2>`); continue; }
    if (/^\s*-\s+/.test(line)) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(line.replace(/^\s*-\s+/, ''))}</li>`); continue; }
    if (!line.trim()) { closeList(); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

export function MdPreview({ markdown, orderMap, style }) {
  const rendered = orderMap ? renderInlineMarkers(markdown, orderMap, style) : markdown;
  const html = useMemo(() => mdToHtml(rendered), [rendered]);
  if (!String(markdown || '').trim()) {
    return <div style={{ color: C.muted, fontSize: 12.5, fontStyle: 'italic' }}>Nothing to preview yet.</div>;
  }
  return (
    <div className="ms-md-preview"
      style={{ fontSize: 13, color: C.txt2, lineHeight: 1.7, wordBreak: 'break-word' }}
      dangerouslySetInnerHTML={{ __html: html }} />
  );
}

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

      <Block title="Export" desc="Generate a submission-ready Word manuscript, a reproducibility bundle, or reporting checklists.">
        <ExportButtons exporters={exporters} canonical />
        {exporters.exportError && <InfoBox color={C.red}>{exporters.exportError}</InfoBox>}
      </Block>
    </div>
  );
}

/* ════════════ 2. EDITOR ════════════ */
const dotColor = (st) => (st === 'edited' ? C.grn : st === 'ai-draft' ? C.yel : C.dim);

export function EditorPanel({ m }) {
  const [sel, setSel] = useState('title');
  const [showPreview, setShowPreview] = useState(false);
  const [genNotice, setGenNotice] = useState(null); // { only:null|[id], skipped:[...] }

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

  const taRef = useRef(null);
  const style = m.activeDraft.citationStyle || 'vancouver';
  const citeRefs = m.references || [];
  const refLabel = (r) => {
    const a = r.ref && r.ref.authorsList && r.ref.authorsList[0];
    const fam = a ? (a.family || a.raw) : ((r.ref && r.ref.title) || 'ref');
    return `${fam}${r.ref && r.ref.year ? ` ${r.ref.year}` : ''}`;
  };
  // inline-citation numbering for the live preview (includes the unsaved buffer)
  const orderMap = useMemo(() => {
    const texts = draftSectionTexts(m.activeDraft).map((t, i) => (SECTION_IDS[i] === sel ? buf : t));
    return collectCitationOrder(texts).orderMap;
  }, [m.activeDraft, sel, buf]);
  const insertCitation = (refId) => {
    if (!refId) return;
    const token = citationToken(refId);
    const ta = taRef.current;
    let next;
    if (ta && typeof ta.selectionStart === 'number') {
      next = `${buf.slice(0, ta.selectionStart)}${token}${buf.slice(ta.selectionEnd)}`;
    } else { next = `${buf}${token}`; }
    setBuf(next);
    m.updateSection(sel, next);
  };
  // flush any pending debounced edit before changing section so resync reads fresh content
  const switchTo = (id) => { if (m.flush) m.flush(); setSel(id); };

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

  const status = sectionStatus(section);
  const isTitle = sel === 'title';

  return (
    <div data-testid="stitch-manuscript-editor" style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* section list */}
      <div style={{ width: 210, flexShrink: 0, minWidth: 180 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SECTION_TYPES.map((s) => {
            const st = sectionStatus((m.activeDraft.sections && m.activeDraft.sections[s.id]) || {});
            const active = s.id === sel;
            return (
              <button key={s.id} onClick={() => switchTo(s.id)}
                data-testid={`stitch-manuscript-section-${s.id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', cursor: 'pointer',
                  padding: '8px 10px', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit',
                  border: `1px solid ${active ? alpha(C.acc, '40') : 'transparent'}`,
                  background: active ? alpha(C.acc, '12') : 'transparent',
                  color: active ? C.txt : C.txt2, fontWeight: active ? 600 : 500,
                }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor(st), flexShrink: 0, border: st === 'empty' ? `1px solid ${C.brd2}` : 'none' }} />
                {s.label}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 12 }}>
          <button onClick={() => doGenerate(null)} data-testid="stitch-manuscript-generate" style={{ ...btnS('primary'), width: '100%', justifyContent: 'center' }}>
            <Icon name="sigma" size={13} /> Generate all sections
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 10.5, color: C.muted, lineHeight: 1.6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: C.grn }} /> Edited</span>{'  '}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 8 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: C.yel }} /> AI draft</span>{'  '}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 8 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: C.dim, border: `1px solid ${C.brd2}` }} /> Empty</span>
        </div>
      </div>

      {/* editor area */}
      <div style={{ flex: 1, minWidth: 280 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.txt }}>{(SECTION_TYPES.find((s) => s.id === sel) || {}).label}</h3>
            {status === 'ai-draft' && <span style={tagS('yellow')}>AI draft — verify</span>}
            {status === 'edited' && <span style={tagS('green')}>Edited</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!isTitle && citeRefs.length > 0 && (
              <select value="" onChange={(e) => { insertCitation(e.target.value); e.target.value = ''; }}
                title="Insert a numbered citation at the cursor"
                data-testid="stitch-manuscript-insert-citation"
                style={{ ...inp, width: 'auto', cursor: 'pointer', fontSize: 11, paddingRight: 22 }}>
                <option value="">+ Cite…</option>
                {citeRefs.map((r) => <option key={r.id} value={r.id}>{refLabel(r)}</option>)}
              </select>
            )}
            <button onClick={() => setShowPreview((v) => !v)} style={{ ...btnS('ghost'), fontSize: 11 }}>
              <Icon name="eye" size={12} /> {showPreview ? 'Hide preview' : 'Preview'}
            </button>
            <button onClick={() => doGenerate([sel])} style={{ ...btnS('ghost'), fontSize: 11 }}>
              <Icon name="refresh" size={12} /> Generate this section
            </button>
          </div>
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

        {isTitle ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Labeled label="Manuscript title">
              <input value={buf} onChange={(e) => onType(e.target.value)} placeholder="Full manuscript title…"
                style={{ ...inp, fontSize: 14 }} />
            </Labeled>
            <Labeled label="Keywords (comma-separated)">
              <input value={kw}
                onChange={(e) => { setKw(e.target.value); m.setMetaDebounced({ keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }); }}
                placeholder="e.g. systematic review, meta-analysis, …"
                style={inp} />
            </Labeled>
          </div>
        ) : showPreview ? (
          <div style={{ border: `1px solid ${C.brd}`, borderRadius: 10, padding: 16, background: C.card, minHeight: 380 }}>
            <MdPreview markdown={buf} orderMap={orderMap} style={style} />
          </div>
        ) : (
          <textarea ref={taRef} value={buf} onChange={(e) => onType(e.target.value)}
            placeholder="Write or generate this section. Markdown supported (#, ##, **bold**, *italic*, - bullets). Use “+ Cite…” to insert a numbered citation."
            style={{ ...inp, minHeight: 380, fontFamily: 'IBM Plex Mono, monospace', fontSize: 12.5, whiteSpace: 'pre', lineHeight: 1.6, resize: 'vertical' }} />
        )}
      </div>
    </div>
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
