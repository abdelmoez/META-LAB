/**
 * abstractSegments.js — structured-abstract heading segmentation (107.md §4).
 *
 * Pure functions, no DOM, no React, no side effects.
 *
 * PubMed/RIS importers flatten a structured abstract into ONE string, joining the
 * sections as "Label: text" with single spaces (server/pecanSearch/connectors/
 * pubmedXml.js), so by render time "BACKGROUND: … METHODS: …" is a single
 * paragraph. This module finds the surviving heading labels so the renderer can
 * bold them, WITHOUT touching the text itself.
 *
 * A heading is a known heading phrase immediately followed by `:` at one of three
 * positions:
 *   (a) the very start of the string,
 *   (b) directly after a line break,
 *   (c) after sentence-terminal punctuation (`.` `!` `?`) plus whitespace.
 * Prose occurrences ("The methods used in previous studies differed…", "These
 * results demonstrate improvement.") therefore never match: they either have no
 * colon or sit mid-sentence.
 *
 * INVARIANT (pinned by tests): concatenating every segment's `text` in order
 * reproduces the input byte-identically — nothing is dropped, nothing is added, so
 * selection, copying and keyword highlighting all keep working on the same text.
 */

/**
 * Heading vocabulary used by real structured abstracts (PubMed, JAMA, Lancet,
 * BMJ, Cochrane). Matching is case-insensitive; the ORIGINAL casing and
 * punctuation are preserved in the emitted segment.
 */
export const ABSTRACT_HEADINGS = Object.freeze([
  // Framing
  'Background', 'Backgrounds', 'Introduction', 'Context', 'Importance',
  'Rationale', 'Objective', 'Objectives', 'Aim', 'Aims', 'Purpose',
  'Hypothesis', 'Question',
  // Methods
  'Materials and Methods', 'Patients and Methods', 'Subjects and Methods',
  'Methods and Results', 'Methods', 'Method', 'Methodology',
  'Study Design', 'Design', 'Design, Setting, and Participants',
  'Setting', 'Settings', 'Participants', 'Patients', 'Population',
  'Data Sources', 'Study Selection', 'Data Extraction', 'Data Synthesis',
  'Intervention', 'Interventions', 'Exposure', 'Exposures',
  'Main Outcomes and Measures', 'Main Outcome Measures', 'Main Outcome Measure',
  'Outcome Measures', 'Outcomes', 'Measurements', 'Measures',
  'Statistical Analysis', 'Analysis',
  // Findings
  'Results', 'Result', 'Findings', 'Main Findings', 'Key Results',
  // Wrap-up
  'Discussion', 'Limitations', 'Conclusion', 'Conclusions',
  'Conclusions and Relevance', 'Conclusion and Relevance',
  'Interpretation', 'Implications', 'Significance', 'Relevance',
  // Administrative
  'Funding', 'Registration', 'Trial Registration', 'Clinical Trial Registration',
  'Systematic Review Registration', 'Protocol Registration',
]);

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Longest first so "Materials and Methods" beats "Methods" at the same position.
const HEADING_RE = new RegExp(
  `\\b(?:${[...ABSTRACT_HEADINGS]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|')})[ \\t]*:`,
  'gi',
);

/**
 * A heading may only start the string, follow a line break, or follow
 * sentence-terminal punctuation + whitespace.
 */
function atHeadingBoundary(text, idx) {
  if (idx === 0) return true;
  let i = idx - 1;
  let sawSpace = false;
  while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) { i -= 1; sawSpace = true; }
  if (i < 0) return true;                       // only leading whitespace
  const ch = text[i];
  if (ch === '\n' || ch === '\r') return true;  // (b) after a line break
  // (c) after "." / "!" / "?" (optionally through a closing quote/bracket) + space
  if (sawSpace) {
    let j = i;
    while (j >= 0 && (text[j] === '"' || text[j] === "'" || text[j] === ')' || text[j] === ']' || text[j] === '”' || text[j] === '’')) j -= 1;
    if (j >= 0 && (text[j] === '.' || text[j] === '!' || text[j] === '?')) return true;
  }
  return false;
}

/**
 * segmentAbstract — split a (possibly flattened) abstract into heading and text
 * segments.
 *
 * @param {string} text
 * @returns {Array<{ type:'heading'|'text', text:string }>}
 */
export function segmentAbstract(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const out = [];
  let cursor = 0;
  HEADING_RE.lastIndex = 0;
  let m;
  while ((m = HEADING_RE.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (m[0].length === 0) { HEADING_RE.lastIndex += 1; continue; }
    if (!atHeadingBoundary(text, start)) continue;
    if (start > cursor) out.push({ type: 'text', text: text.slice(cursor, start) });
    out.push({ type: 'heading', text: text.slice(start, end) });
    cursor = end;
  }
  if (cursor < text.length) out.push({ type: 'text', text: text.slice(cursor) });
  return out;
}

/** True when the text contains at least one structural heading. */
export function hasAbstractHeadings(text) {
  return segmentAbstract(text).some(s => s.type === 'heading');
}
