/**
 * highlightRender.jsx — render abstract/title text with PICO inclusion (green)
 * and exclusion (red) term highlighting, using the research-engine matcher.
 *
 * 107.md §4 adds `renderAbstract`, a composable two-stage pipeline: the abstract is
 * first split into heading / text segments, then each TEXT segment runs through the
 * existing highlight path. Because headings and marks are produced in separate
 * passes over disjoint slices they can never overlap, and the rendered text content
 * is byte-identical to the input (selection + copying are unaffected).
 */
import { Fragment } from 'react';
import { computeHighlightRanges } from '../../../research-engine/screening/highlight.js';
import { segmentAbstract } from '../../../research-engine/screening/abstractSegments.js';
import { C, HILITE } from './theme.js';

/**
 * Returns React children for `text` with inclusion/exclusion terms wrapped in
 * <mark>. Non-overlapping, word-boundary, case-insensitive (handled by the
 * engine). Toggles let the workbench show/hide each colour or all highlights.
 */
export function renderHighlighted(text, { inclusion = [], exclusion = [], showInclusion = true, showExclusion = true } = {}) {
  if (!text) return null;
  const terms = {
    inclusion: showInclusion ? inclusion : [],
    exclusion: showExclusion ? exclusion : [],
  };
  let ranges = [];
  try { ranges = computeHighlightRanges(text, terms); } catch { ranges = []; }
  if (!ranges.length) return text;

  const out = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) out.push(text.slice(cursor, r.start));
    const tint = HILITE[r.type] || HILITE.inclusion;
    out.push(
      <mark key={i} title={r.type === 'inclusion' ? 'Inclusion term' : 'Exclusion term'} style={{
        background: tint.bg, color: tint.txt, borderBottom: `1px solid ${tint.border}`,
        borderRadius: 2, padding: '0 1px',
      }}>{text.slice(r.start, r.end)}</mark>
    );
    cursor = r.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

// Structured-abstract heading style (107.md §4). Inline (never `display:block` and
// never an injected <br>) so the copied/selected text is exactly the source text.
const HEADING_STYLE = { fontWeight: 700, color: C.txt, letterSpacing: '0.01em' };

/**
 * renderAbstract — React children for a (possibly structured) abstract: known
 * section headings bolded, inclusion/exclusion terms highlighted.
 *
 * @param {string} text
 * @param {object} opts
 * @param {string[]} [opts.inclusion]
 * @param {string[]} [opts.exclusion]
 * @param {boolean}  [opts.showInclusion]
 * @param {boolean}  [opts.showExclusion]
 * @param {Array}    [opts.segments] — precomputed segmentAbstract(text) output
 *                                     (the workbench memoizes it per record)
 */
export function renderAbstract(text, {
  inclusion = [], exclusion = [], showInclusion = true, showExclusion = true, segments,
} = {}) {
  if (!text) return null;
  const hl = { inclusion, exclusion, showInclusion, showExclusion };
  let segs = Array.isArray(segments) ? segments : null;
  if (!segs) {
    try { segs = segmentAbstract(text); } catch { segs = null; }
  }
  // No headings → identical output to the pre-107 renderer.
  if (!segs || !segs.length || !segs.some(s => s.type === 'heading')) {
    return renderHighlighted(text, hl);
  }
  return segs.map((s, i) => (
    s.type === 'heading'
      ? <strong key={`h${i}`} style={HEADING_STYLE}>{s.text}</strong>
      : <Fragment key={`t${i}`}>{renderHighlighted(s.text, hl)}</Fragment>
  ));
}
