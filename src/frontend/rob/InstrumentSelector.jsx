/**
 * InstrumentSelector.jsx — the redesigned "Assess" tool selector (115.md §6-§8,
 * §32, §37-§39).
 *
 * ── WHAT IT REPLACED ────────────────────────────────────────────────────────
 * `CreateForm` in ProjectRobPanel.jsx offered a two-entry constant
 * (`INSTRUMENT_CHOICES = [RoB 2, ROBINS-I]`), rendered ONLY when the
 * `guidedRobAppraisal` flag was on, and — when that flag was off — dropped the
 * chosen instrument from the request so every assessment silently became RoB 2.
 * That is the architectural bug 115.md exists to kill: which instruments a
 * reviewer may choose is a REGISTRY question, never a feature-flag question.
 *
 * Everything rendered here comes from the server catalogue that travels with
 * `GET /api/rob/projects/:id/studies` and that endpoint's per-study
 * `recommendation` block. Adding an instrument to the registry makes it appear
 * here with no change to this file.
 *
 * ── THE THREE RULES ─────────────────────────────────────────────────────────
 *  1. RECOMMEND, NEVER RESTRICT (§37). The recommended tools get their own
 *     section at the top; every other registered tool is one click away, grouped
 *     under a design filter and a search box (§8). Nothing is hidden or disabled.
 *  2. WARN, NEVER BLOCK (§38). Choosing a tool the study's recorded design does
 *     not point to shows an inline caution naming both designs and the better
 *     fit; the reviewer continues with an explicit click. An UNKNOWN design
 *     produces no recommendation section and no warning at all.
 *  3. NEVER DESTROY EARLIER WORK (§39). Assessments that already exist for this
 *     study — under ANY instrument — are listed with an open affordance, so
 *     "starting the right tool" is never mistaken for "replacing the wrong one".
 *     Starting a different instrument creates a separate row; deletion remains
 *     the existing explicit soft-delete flow on the assessment itself.
 *
 * The pure half (filtering, splitting, warning + notice sentences) lives in
 * ./instrumentCatalog.js so it is unit-testable without a DOM.
 */
import { useState, useMemo } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import {
  filterInstruments, splitByRecommendation, designLabelsFor,
  mismatchWarningFor, existingToolNotice, assessmentsForTool, designsInCatalogue,
} from './instrumentCatalog.js';

/* ── one tool card ─────────────────────────────────────────────────────────── */

export function ToolCard({ tool, selected, recommended, onSelect, existingCount = 0 }) {
  const designs = designLabelsFor(tool);
  return (
    <button
      type="button"
      data-testid={`rob-tool-card-${tool.id}`}
      onClick={() => onSelect && onSelect(tool.id)}
      aria-pressed={selected}
      title={tool.description || tool.label}
      style={{
        textAlign: 'left', width: '100%', display: 'block', padding: '10px 12px', borderRadius: 10,
        cursor: 'pointer', fontFamily: FONT,
        background: selected ? alpha(C.acc, '14') : C.surf,
        border: `1px solid ${selected ? alpha(C.acc, '60') : C.brd2}`,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: selected ? C.acc : C.txt }}>{tool.label || tool.name}</span>
        {tool.abbreviation && tool.abbreviation !== tool.label && (
          <span style={{ fontSize: 9.5, fontFamily: MONO, color: C.muted }}>{tool.abbreviation}</span>
        )}
        {recommended && (
          <span style={{ fontSize: 8.5, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: C.grn, background: alpha(C.grn, '16'), border: `1px solid ${alpha(C.grn, '40')}`, borderRadius: 5, padding: '1px 5px' }}>Recommended</span>
        )}
        {existingCount > 0 && (
          <span title={`${existingCount} assessment${existingCount === 1 ? '' : 's'} already recorded with this tool`}
            style={{ fontSize: 8.5, fontFamily: MONO, fontWeight: 700, color: C.purp, background: alpha(C.purp, '14'), border: `1px solid ${alpha(C.purp, '40')}`, borderRadius: 5, padding: '1px 5px' }}>
            {existingCount} existing
          </span>
        )}
        {selected && <Icon name="check" size={12} />}
      </span>
      {/* Design fit — the one line that says what the tool is FOR (§7). */}
      <span style={{ display: 'block', fontSize: 11, color: C.txt2, marginTop: 3 }}>
        {designs.join(' · ') || tool.sublabel || 'Study design not declared'}
      </span>
      {/* One-line description, trimmed so the card never becomes a wall of text. */}
      {tool.description && (
        <span className="t-truncate" style={{ display: 'block', fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.45 }}>
          {firstSentence(tool.description)}
        </span>
      )}
    </button>
  );
}

/** The first sentence of a description — enough to understand, never a paragraph. */
export function firstSentence(text) {
  const s = String(text || '').trim();
  const m = s.match(/^(.{0,180}?[.!?])(\s|$)/);
  return m ? m[1] : (s.length > 180 ? `${s.slice(0, 177)}…` : s);
}

/* ── the tool's methodological identity (§32) ──────────────────────────────── */

export function ToolProvenance({ tool }) {
  if (!tool) return null;
  return (
    <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 9, background: C.surf, border: `1px solid ${C.brd}` }}>
      <div style={{ display: 'flex', gap: '4px 16px', flexWrap: 'wrap', fontSize: 11, color: C.txt2 }}>
        {tool.instrumentVersion && <span><span style={provLabel}>Version</span> {tool.instrumentVersion}</span>}
        {tool.organization && <span><span style={provLabel}>Source</span> {tool.organization}</span>}
        {tool.domainCount ? <span><span style={provLabel}>Domains</span> {tool.domainCount}</span> : null}
        {/* 115.md decision 5 — say out loud when a tool defines no score, so nobody
            reads an answered-item count as a rating. */}
        <span><span style={provLabel}>Scoring</span> {tool.scoringAllowed ? 'Additive score defined by the instrument' : 'No score — judgements only'}</span>
      </div>
      {tool.citation && (
        <p style={{ fontSize: 11, color: C.muted, margin: '8px 0 0', lineHeight: 1.55 }}>{tool.citation}</p>
      )}
      {tool.guidanceUrl && (
        <a href={tool.guidanceUrl} target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 7, fontSize: 11.5, color: C.acc, textDecoration: 'none', fontFamily: FONT }}>
          <Icon name="externalLink" size={12} /> Official guidance
        </a>
      )}
      {tool.license && (
        <p style={{ fontSize: 10.5, color: C.muted, margin: '7px 0 0', lineHeight: 1.5, fontStyle: 'italic' }}>{tool.license}</p>
      )}
    </div>
  );
}
const provLabel = { fontFamily: MONO, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.muted, marginRight: 4 };

/* ── the selector ──────────────────────────────────────────────────────────── */

export default function InstrumentSelector({
  catalogue = [],
  recommendation = null,
  existingAssessments = [],
  defaultToolId = '',
  onStart,
  onCancel,
  onOpenExisting,
  initialToolId = '',
  initialQuery = '',
  initialDesignId = '',
  initialShowAll = false,
}) {
  const { recommended, others } = useMemo(
    () => splitByRecommendation(catalogue, recommendation),
    [catalogue, recommendation],
  );
  // Pre-select, in order: an explicitly requested tool (used when the selector is
  // re-opened on a specific instrument), the single recommended tool, then the
  // project's default. A recommendation is a STARTING POINT the reviewer can see
  // and change, never a silent assignment (§37).
  const [toolId, setToolId] = useState(() => {
    if (initialToolId && catalogue.some(t => t.id === initialToolId)) return initialToolId;
    if (recommended.length === 1) return recommended[0].id;
    if (defaultToolId && catalogue.some(t => t.id === defaultToolId)) return defaultToolId;
    return recommended[0]?.id || catalogue[0]?.id || '';
  });
  const [label, setLabel] = useState('');
  const [query, setQuery] = useState(initialQuery);
  const [designId, setDesignId] = useState(initialDesignId);
  const [showAll, setShowAll] = useState(initialShowAll || recommended.length === 0);
  const [acknowledged, setAcknowledged] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const tool = catalogue.find(t => t.id === toolId) || null;
  const warning = mismatchWarningFor(toolId, catalogue, recommendation);
  const notice = existingToolNotice(existingAssessments, toolId);
  const sameToolRows = assessmentsForTool(existingAssessments, toolId);
  const designs = useMemo(() => designsInCatalogue(catalogue), [catalogue]);
  const filtered = useMemo(
    () => filterInstruments(others, { query, designId }),
    [others, query, designId],
  );
  const blocked = !!warning && !acknowledged;

  const pick = (id) => { setToolId(id); setAcknowledged(false); };
  const start = () => { if (!blocked && toolId && onStart) onStart({ instrumentId: toolId, resultLabel: label }); };

  return (
    <div data-testid="rob-tool-selector" style={{ marginTop: 12, padding: '14px 15px', borderRadius: 12, background: C.card, border: `1px solid ${C.brd}` }}>
      {/* ── Recommended for this study (§6/§37) ── */}
      {recommended.length > 0 && (
        <section data-testid="rob-recommended-tools" style={{ marginBottom: 14 }}>
          <SectionLabel icon="target">Recommended for this study</SectionLabel>
          {recommendation?.design && (
            <p style={{ fontSize: 11.5, color: C.txt2, margin: '0 0 8px', lineHeight: 1.5 }}>
              Recorded study design: <strong style={{ color: C.txt }}>{recommendation.design}</strong>. This is a
              suggestion from the study&apos;s metadata — choose any instrument you judge appropriate.
            </p>
          )}
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
            {recommended.map(t => (
              <ToolCard key={t.id} tool={t} recommended selected={toolId === t.id} onSelect={pick}
                existingCount={assessmentsForTool(existingAssessments, t.id).length} />
            ))}
          </div>
        </section>
      )}

      {/* ── Other assessment tools (§7/§8) ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <SectionLabel icon="layers">{recommended.length ? 'Other assessment tools' : 'Assessment tools'}</SectionLabel>
          <span aria-hidden style={{ flex: 1 }} />
          {recommended.length > 0 && (
            <button type="button" data-testid="rob-tool-show-all" onClick={() => setShowAll(s => !s)} aria-expanded={showAll} style={linkBtn}>
              <Icon name={showAll ? 'chevronDown' : 'chevronRight'} size={12} />
              {showAll ? 'Hide' : `Show all ${others.length}`}
            </button>
          )}
        </div>

        {showAll && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 9 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 200px', minWidth: 160, padding: '6px 10px', borderRadius: 8, background: C.surf, border: `1px solid ${C.brd2}` }}>
                <Icon name="search" size={13} />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tools"
                  data-testid="rob-tool-search" aria-label="Search assessment tools"
                  style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: C.txt, fontSize: 12.5, fontFamily: FONT }} />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Study design</span>
                <select value={designId} onChange={e => setDesignId(e.target.value)} data-testid="rob-tool-design-filter" aria-label="Filter by study design"
                  style={{ padding: '6px 9px', borderRadius: 8, background: C.surf, border: `1px solid ${C.brd2}`, color: C.txt, fontSize: 12.5, fontFamily: FONT }}>
                  <option value="">All designs</option>
                  {designs.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </label>
            </div>
            {filtered.length === 0 ? (
              <p style={{ fontSize: 12, color: C.muted, margin: '0 0 8px' }}>No assessment tool matches that filter.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', maxHeight: 320, overflowY: 'auto', paddingRight: 2 }}>
                {filtered.map(t => (
                  <ToolCard key={t.id} tool={t} selected={toolId === t.id} onSelect={pick}
                    existingCount={assessmentsForTool(existingAssessments, t.id).length} />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── §38 mismatch caution — explicit continue, never a block ── */}
      {warning && (
        <div role="note" data-testid="rob-mismatch-warning" style={{ marginTop: 12, padding: '10px 12px', borderRadius: 9, background: alpha(C.yel, '12'), border: `1px solid ${alpha(C.yel, '45')}` }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Icon name="alertTriangle" size={14} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 12.5, color: C.txt2, lineHeight: 1.55 }}>{warning}</p>
              {!acknowledged && (
                <button type="button" data-testid="rob-mismatch-continue" onClick={() => setAcknowledged(true)}
                  style={{ ...ghost, marginTop: 8, borderColor: alpha(C.yel, '55'), color: C.txt }}>
                  Use {tool?.label || toolId} anyway
                </button>
              )}
              {acknowledged && (
                <p style={{ margin: '6px 0 0', fontSize: 11.5, color: C.muted, fontFamily: MONO }}>
                  ✓ Continuing with {tool?.label || toolId} deliberately.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── §39 tool-change safety: work that already exists for this study ── */}
      {notice && (
        <div role="note" data-testid="rob-existing-assessments" style={{ marginTop: 12, padding: '10px 12px', borderRadius: 9, background: alpha(C.purp, '10'), border: `1px solid ${alpha(C.purp, '38')}` }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Icon name="info" size={14} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 12.5, color: C.txt2, lineHeight: 1.55 }}>{notice}</p>
              <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
                {existingAssessments.filter(a => a.instrumentId !== toolId).map(a => (
                  <ExistingRow key={a.id} a={a} onOpen={onOpenExisting} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {sameToolRows.length > 0 && (
        <div style={{ marginTop: 10, display: 'grid', gap: 5 }}>
          <span style={{ fontSize: 11, color: C.muted }}>
            This study already has {sameToolRows.length} {tool?.label || toolId} assessment{sameToolRows.length === 1 ? '' : 's'} — a new one is an
            additional, independent record (a second reviewer, or another result).
          </span>
          {sameToolRows.map(a => <ExistingRow key={a.id} a={a} onOpen={onOpenExisting} />)}
        </div>
      )}

      {/* ── the selected tool's methodological identity (§32) ── */}
      {tool && (
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={() => setDetailOpen(o => !o)} aria-expanded={detailOpen} style={linkBtn}>
            <Icon name="info" size={12} /> {detailOpen ? 'Hide' : 'About'} {tool.label || tool.id}
          </button>
          {detailOpen && <ToolProvenance tool={tool} />}
        </div>
      )}

      {/* ── result label + start ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
        <input autoFocus value={label} onChange={e => setLabel(e.target.value)}
          placeholder="Result / outcome being assessed (e.g. Mortality at 6 months)"
          onKeyDown={e => { if (e.key === 'Enter') start(); if (e.key === 'Escape' && onCancel) onCancel(); }}
          style={{ flex: 1, minWidth: 240, padding: '8px 11px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt, fontSize: 13, fontFamily: FONT }} />
        <button type="button" data-testid="rob-start-assessment" onClick={start} disabled={blocked || !toolId}
          title={blocked ? 'Confirm the design mismatch above first' : `Start a ${tool?.label || 'risk-of-bias'} assessment`}
          style={{ ...ghost, background: (blocked || !toolId) ? C.surf : C.acc, color: (blocked || !toolId) ? C.muted : C.accText, border: `1px solid ${(blocked || !toolId) ? C.brd2 : C.acc}`, cursor: (blocked || !toolId) ? 'not-allowed' : 'pointer' }}>
          Start {tool?.label || ''} assessment
        </button>
        <button type="button" onClick={onCancel} style={ghost}>Cancel</button>
      </div>
    </div>
  );
}

function ExistingRow({ a, onOpen }) {
  const state = a.isConsensus ? 'consensus' : a.status === 'complete' ? 'finalised' : 'draft';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', borderRadius: 7, background: C.surf, border: `1px solid ${C.brd}`, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 9.5, fontFamily: MONO, fontWeight: 700, color: C.acc, background: alpha(C.acc, '12'), border: `1px solid ${alpha(C.acc, '30')}`, borderRadius: 6, padding: '1px 6px' }}>
        {a.instrumentLabel || a.instrumentId}
      </span>
      <span style={{ fontSize: 11.5, color: C.txt2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {a.resultLabel || 'Result'} · {state}{a.reviewerName ? ` · ${a.reviewerName}` : ''}
      </span>
      <span aria-hidden style={{ flex: 1 }} />
      {onOpen && <button type="button" data-testid={`rob-open-existing-${a.id}`} onClick={() => onOpen(a)} style={miniBtn}>Open</button>}
    </div>
  );
}

function SectionLabel({ icon, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      <Icon name={icon} size={12} /> {children}
    </span>
  );
}

const ghost = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt2, fontSize: 12.5, cursor: 'pointer', fontFamily: FONT };
const miniBtn = { padding: '4px 10px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 11.5, cursor: 'pointer', fontFamily: FONT };
const linkBtn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 6px', background: 'transparent', border: 'none', color: C.acc, fontSize: 11.5, cursor: 'pointer', fontFamily: FONT };
