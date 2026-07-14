/**
 * termEntry.js — 85.md A1. Pure helpers for TYPED term entry in the Search Builder:
 * multi-term paste splitting, quote normalization, and deduped batch add.
 *
 * DESIGN RULES:
 *  - Split ONLY on newline / semicolon — NEVER on comma. MeSH descriptors and
 *    chemical names legitimately contain commas ("Diabetes Mellitus, Type 2",
 *    "1,25-dihydroxyvitamin D"); comma-splitting would silently corrupt a pasted
 *    heading into garbage terms, the exact trust-destroying transformation 85.md
 *    forbids.
 *  - A user typing "heart attack" (with quotes) means an exact phrase — strip ONE
 *    symmetric outer quote pair and carry phrase:true instead of storing the quote
 *    characters (which the compilers would re-quote into ""heart attack""[tiab]).
 *  - Everything here is pure and id-less: the caller assigns term ids (mirrors the
 *    addManualTermToField contract in searchState.js).
 */
import { norm } from './conceptExtraction.js';

/* Symmetric quote pairs we recognise as "the user quoted the whole term". */
const QUOTE_PAIRS = [
  ['"', '"'],
  ['“', '”'], // “ ”
  ['‘', '’'], // ‘ ’
  ["'", "'"],
];

/**
 * splitTermInput(text) → { terms: string[], usedSeparator: 'newline'|'semicolon'|null }
 * Splits pasted/typed input into candidate terms on newlines and semicolons only.
 * Pieces are trimmed, empties dropped, and deduped by normalized text (first
 * occurrence wins, original spelling kept). `usedSeparator` reports the dominant
 * separator actually present ('newline' wins when both appear) so the UI can say
 * what happened; null = single-term input (no split occurred). Pure.
 */
export function splitTermInput(text) {
  const raw = String(text == null ? '' : text);
  const hasNewline = /[\r\n]/.test(raw);
  const hasSemicolon = raw.includes(';');
  const pieces = raw.split(/[\r\n;]+/);
  const terms = [];
  const seen = new Set();
  for (const p of pieces) {
    const t = p.trim();
    if (!t) continue;
    const n = norm(t);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    terms.push(t);
  }
  const usedSeparator = hasNewline ? 'newline' : (hasSemicolon ? 'semicolon' : null);
  return { terms, usedSeparator };
}

/**
 * normalizeTypedTerm(text) → { text, phrase }
 * Strips ONE symmetric outer quote pair ("heart attack" → heart attack) and flags
 * the result phrase:true so the compilers quote it exactly once (fixes the
 * double-quoting bug where freeTextToken emitted ""heart attack""[tiab]).
 * CONSERVATIVE: strips only when the first/last characters are a matching pair AND
 * the inner text contains no further quote of the same kind — `"a" and "b"` is NOT
 * one quoted phrase and is left untouched. Unquoted input passes through with
 * phrase:false (the compilers' own multi-word heuristic still applies). Pure.
 */
export function normalizeTypedTerm(text) {
  const t = String(text == null ? '' : text).trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (t.length >= 2 && t.startsWith(open) && t.endsWith(close)) {
      const inner = t.slice(open.length, t.length - close.length).trim();
      if (inner && !inner.includes(open) && !inner.includes(close)) {
        return { text: inner, phrase: true };
      }
    }
  }
  return { text: t, phrase: false };
}

/**
 * addTypedTerms(concepts, conceptId, rawInput) → { concepts, added, duplicates }
 * The one commit path for typed/pasted term entry. Splits rawInput (newline /
 * semicolon only), normalizes quotes, and appends each NEW term to the target
 * concept as { text, type:'freetext', field:'tiab', source:'user_added'[, phrase] }.
 * Dedupe is case/punctuation-insensitive (norm) against the concept's existing
 * terms AND within the batch — the skipped spellings are returned in `duplicates`
 * so the UI can say what was skipped instead of silently dropping input (fixes the
 * commitAdd no-dedupe bug in the opposite direction: no silent duplicates, no
 * silent drops). Terms are id-less; the caller assigns ids (mirrors
 * addManualTermToField). Returns the SAME concepts array when nothing was added. Pure.
 */
export function addTypedTerms(concepts, conceptId, rawInput) {
  const list = Array.isArray(concepts) ? concepts : [];
  const idx = list.findIndex((c) => c && c.id === conceptId);
  const { terms: pieces } = splitTermInput(rawInput);
  if (idx < 0 || !pieces.length) return { concepts: list, added: [], duplicates: [] };

  const target = list[idx];
  const have = new Set(((target && target.terms) || []).map((t) => norm(t && t.text)).filter(Boolean));
  const added = [];
  const duplicates = [];
  const newTerms = [];
  for (const piece of pieces) {
    const { text, phrase } = normalizeTypedTerm(piece);
    const n = norm(text);
    if (!n || !text) continue;
    if (have.has(n)) { duplicates.push(text); continue; }
    have.add(n);
    added.push(text);
    const term = { text, type: 'freetext', field: 'tiab', source: 'user_added' };
    if (phrase) term.phrase = true;
    newTerms.push(term);
  }
  if (!newTerms.length) return { concepts: list, added: [], duplicates };
  const next = list.map((c, i) => (i === idx ? { ...c, terms: [...(c.terms || []), ...newTerms] } : c));
  return { concepts: next, added, duplicates };
}
