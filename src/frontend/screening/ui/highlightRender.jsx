/**
 * highlightRender.jsx — render abstract/title text with PICO inclusion (green)
 * and exclusion (red) term highlighting, using the research-engine matcher.
 */
import { computeHighlightRanges } from '../../../research-engine/screening/highlight.js';
import { HILITE } from './theme.js';

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
