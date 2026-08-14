/**
 * RecordArticleCard.jsx — 116.md §67-68 (D14). The ONE article-context surface:
 * full title, blind-aware authors · journal · year, DOI/PMID links, sourceDb /
 * Duplicate badges, and the complete (never truncated) abstract rendered through
 * the SAME renderAbstract/segmentAbstract pipeline the Title & Abstract workbench
 * uses (107.md §4 heading bolding + PICO keyword highlighting), plus the record's
 * keyword chips.
 *
 * EXTRACTED from ScreeningTab.jsx's MiddleColumn — the JSX below is a verbatim
 * move, not a fork: MiddleColumn now renders this component, so the T&A output
 * stays byte-identical (SSR pins in decisionNavUi.test.jsx + the containment pin
 * in conflictsTabUi116.test.jsx). Reused by ConflictsTab so the conflict workflow
 * never deprives reviewers of information they had during normal screening (§67).
 *
 * Props:
 *   record       — a shaped screening record (listRecords / listConflicts shape)
 *   blindMode    — display gate for authors/journal (the SERVER already blanks
 *                  them on the wire for blinded non-leaders — 81.md convention;
 *                  this prop only keeps leader-view toggles honest)
 *   inclusion / exclusion / showInclusion / showExclusion — highlight terms
 *   abstractRef  — optional ref to the abstract <p> (107.md §3 selection shortcuts)
 *   collapsible / expanded / onToggle — 116.md §68: a list surface (Conflicts)
 *                  renders several articles at once, so it may fold the abstract
 *                  away. The fold is ALL-OR-NOTHING — the abstract is never
 *                  clamped mid-sentence — and OFF by default, so the Title &
 *                  Abstract workbench keeps rendering exactly what it always did.
 */
import { useMemo } from 'react';
import { C, MONO, alpha } from '../ui/theme.js';
import { Card, SectionLabel, Badge } from '../ui/components.jsx';
import { renderAbstract } from '../ui/highlightRender.jsx';
import { segmentAbstract } from '../../../research-engine/screening/abstractSegments.js';

export default function RecordArticleCard({
  record, blindMode,
  inclusion = [], exclusion = [], showInclusion = true, showExclusion = true,
  abstractRef = null,
  collapsible = false, expanded = true, onToggle = null,
}) {
  // 107.md §4 — segment once per record; highlighting still recomputes per render.
  // Declared before the early return so hook order stays stable.
  const abstractSegs = useMemo(() => segmentAbstract(record?.abstract || ''), [record?.abstract]);
  if (!record) return null;
  // Default (T&A) path: collapsible=false ⇒ showBody is always true and the
  // SectionLabel gets no `right` slot ⇒ byte-identical markup.
  const showBody = !collapsible || expanded;

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 17, fontWeight: 700, color: C.txt, lineHeight: 1.42, margin: '0 0 10px', letterSpacing: '-0.01em', minWidth: 0, overflowWrap: 'anywhere' }}>
        {record.title || <span style={{ color: C.muted, fontStyle: 'italic' }}>Untitled record</span>}
      </h2>

      {!blindMode && (record.authors || record.journal || record.year) && (
        <div style={{ fontSize: 12.5, color: C.txt2, marginBottom: 10, lineHeight: 1.5, minWidth: 0, overflowWrap: 'anywhere' }}>
          {record.authors && <span>{record.authors}</span>}
          {record.journal && <span style={{ fontStyle: 'italic', color: C.muted }}>{record.authors ? ' · ' : ''}{record.journal}</span>}
          {record.year && <span style={{ color: C.muted }}>{(record.authors || record.journal) ? ' · ' : ''}{record.year}</span>}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        {record.doi && (
          <a href={`https://doi.org/${record.doi}`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none', minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-all' }}>DOI: {record.doi}</a>
        )}
        {record.pmid && (
          <a href={`https://pubmed.ncbi.nlm.nih.gov/${record.pmid}`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: C.acc, fontFamily: MONO, textDecoration: 'none' }}>PMID: {record.pmid}</a>
        )}
        {record.sourceDb && <Badge color={C.txt2}>{record.sourceDb}</Badge>}
        {record.isDuplicate && <Badge color={C.gold}>Duplicate</Badge>}
      </div>

      {/* ── Abstract (with PICO highlighting) ──────────────────────────── */}
      <Card style={{ marginBottom: 18, padding: '18px 20px' }}>
        <SectionLabel right={collapsible ? (
          <button type="button" onClick={onToggle} data-testid="article-abstract-toggle"
            aria-expanded={expanded ? 'true' : 'false'}
            style={{ background: 'none', border: 'none', color: C.acc, fontSize: 11.5, fontFamily: MONO, cursor: 'pointer', padding: 0 }}>
            {expanded ? '▲ Hide abstract' : '▼ Show full abstract'}
          </button>
        ) : undefined}>Abstract</SectionLabel>
        {!showBody ? (
          /* 116.md §68 — folded, not truncated: nothing is cut mid-sentence, the
             whole abstract comes back with one click. */
          <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
            Abstract hidden — show it to read the complete text.
          </p>
        ) : record.abstract ? (
          /* 107.md §3 — the ref proves a selection belongs to THIS abstract before
             Cmd/Ctrl+I / Cmd/Ctrl+E may add it as a keyword.
             107.md §4 — structured headings render <strong>; keyword <mark>s are
             produced per text segment, so the two can never overlap. */
          <p ref={abstractRef} data-testid="screening-abstract"
            style={{ fontSize: 14, color: C.txt, lineHeight: 1.75, margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
            {renderAbstract(record.abstract, { inclusion, exclusion, showInclusion, showExclusion, segments: abstractSegs })}
          </p>
        ) : (
          <p style={{ fontSize: 13.5, color: C.muted, fontStyle: 'italic', margin: 0 }}>No abstract available for this record.</p>
        )}

        {showBody && record.keywords && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.brd}` }}>
            <span style={{ fontSize: 9.5, color: C.muted, fontFamily: MONO, alignSelf: 'center', letterSpacing: '0.08em' }}>KEYWORDS</span>
            {record.keywords.split(/[;,]/).map((kw, i) => kw.trim() && (
              <span key={i} style={{ fontSize: 10.5, background: alpha(C.brd, '70'), border: `1px solid ${C.brd}`, color: C.txt2, borderRadius: 10, padding: '2px 9px' }}>{kw.trim()}</span>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
