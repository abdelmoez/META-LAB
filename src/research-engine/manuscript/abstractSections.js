/**
 * manuscript/abstractSections.js — 65.md (MS-5). Pure helpers for STRUCTURED
 * abstracts. The draft generator (draft.js) emits template-driven abstracts as
 * blank-line-separated blocks of the form `**Label.** text`; this module parses
 * that pattern into labelled subsections for the rich abstract editor and
 * serializes them back to the SAME single markdown string (the persisted shape
 * in Project.data.manuscripts[].sections.abstract is unchanged).
 *
 * Free-form abstracts that don't match the pattern parse as { matched:false } —
 * the UI falls back to one rich editor, never losing content.
 */

import { JOURNAL_TEMPLATES } from './model.js';
import { CITATION_TOKEN_RE } from './citations.js';

/** Expected subsection labels per abstractFormat (mirrors generateAbstract). */
export const ABSTRACT_FORMAT_SECTIONS = {
  structured: ['Background', 'Objectives', 'Methods', 'Results', 'Conclusions'],
  jama: ['Importance', 'Objective', 'Data Sources', 'Study Selection', 'Data Extraction and Synthesis', 'Main Outcomes and Measures', 'Results', 'Conclusions and Relevance'],
  lancet: ['Background', 'Methods', 'Findings', 'Interpretation', 'Funding'],
};

/** Template's abstract format, expected labels and word limit (null = none). */
export function abstractTemplateInfo(templateId) {
  const tpl = JOURNAL_TEMPLATES.find((t) => t.id === templateId) || JOURNAL_TEMPLATES[0];
  const format = tpl.abstractFormat || 'structured';
  return {
    format,
    labels: ABSTRACT_FORMAT_SECTIONS[format] || ABSTRACT_FORMAT_SECTIONS.structured,
    wordLimit: tpl.abstractWordLimit || null,
  };
}

// Lazy label match so `**Background.** We searched **all** databases` keeps the
// bold inside the text (label stops at the first closing `**`).
const SUB_RE = /^\*\*([^*]+?)\.?\*\*\s*([\s\S]*)$/;

/**
 * Parse `**Label.** text` blocks. matched:true only when EVERY blank-line block
 * carries a label — otherwise the abstract is treated as free-form. Pure.
 */
export function parseAbstractSubsections(md) {
  const s = String(md == null ? '' : md).trim();
  if (!s) return { matched: false, subsections: [] };
  const blocks = s.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const subsections = [];
  for (const b of blocks) {
    const m = b.match(SUB_RE);
    if (!m) return { matched: false, subsections: [] };
    subsections.push({ label: m[1].trim(), text: m[2].trim() });
  }
  return { matched: subsections.length > 0, subsections };
}

/**
 * Serialize labelled subsections back to the single markdown string. Blank lines
 * INSIDE a subsection would split it into an unlabelled block on the next parse,
 * so they are collapsed to single newlines (round-trip stability). Pure.
 */
export function serializeAbstractSubsections(subsections) {
  return (subsections || [])
    .map((sub) => {
      const label = String((sub && sub.label) || '').trim();
      const text = String((sub && sub.text) || '').trim().replace(/\n{2,}/g, '\n');
      return `**${label}.**${text ? ` ${text}` : ''}`;
    })
    .join('\n\n');
}

/** Word count over the visible prose (markdown marks + cite tokens excluded). Pure. */
export function abstractWordCount(md) {
  const t = String(md == null ? '' : md)
    .replace(new RegExp(CITATION_TOKEN_RE.source, 'g'), ' ')
    .replace(/[*`#|]/g, ' ');
  const m = t.match(/\S+/g);
  return m ? m.length : 0;
}

/** True when a subsection is still just a bracketed generator placeholder. Pure. */
export function isPlaceholderText(text) {
  const t = String(text == null ? '' : text).trim();
  return !t || /^\[[^\]]*\]\.?$/.test(t);
}

export default {
  ABSTRACT_FORMAT_SECTIONS,
  abstractTemplateInfo,
  parseAbstractSubsections,
  serializeAbstractSubsections,
  abstractWordCount,
  isPlaceholderText,
};
