/**
 * extraction/heuristicExtract.js — P5. Deterministic, regex-based extraction
 * ASSISTANT. This is the honest self-hosted default: NOT an LLM. It scans the
 * title/abstract/full-text for a small set of conservative patterns and proposes
 * candidate values, each anchored to the sentence it came from so a human can
 * verify. It NEVER invents a value — if no pattern matches, it reports notFound.
 *
 * OUTPUT (one item per element):
 *   Found:
 *     { elementId, armKey:'', value, confidence:'low'|'medium',
 *       provenance:{ type:'sentence', excerpt, location:{ field, start, end } },
 *       notFound:false, [ambiguity:string] }
 *   Not found:
 *     { elementId, notFound:true }
 *
 * CONFIDENCE
 *   - 'medium' only when exactly ONE unambiguous match exists for the element.
 *   - 'low' when multiple candidate matches exist (best is proposed, and an
 *     `ambiguity` note is attached).
 *
 * DETERMINISM
 *   Pure function of its inputs. Fields are scanned in a fixed order
 *   (title → abstract → fullText); the FIRST field that yields matches wins, and
 *   within a field candidates are ordered by their position in the text. Same input
 *   → byte-identical output.
 */

import { valueKey } from './model.js';

const FIELD_ORDER = ['title', 'abstract', 'fullText'];

/**
 * suggestFromText(doc, elements) — propose values for each element.
 * @param {{title?:string, abstract?:string, fullText?:string}} doc
 * @param {Array} elements
 * @returns {Array} one suggestion per element (see file header for shape)
 */
export function suggestFromText(doc = {}, elements = []) {
  const fields = {
    title: typeof doc.title === 'string' ? doc.title : '',
    abstract: typeof doc.abstract === 'string' ? doc.abstract : '',
    fullText: typeof doc.fullText === 'string' ? doc.fullText : '',
  };
  // Pre-split each field into sentences once (with indices) for reuse.
  const sentencesByField = {
    title: splitSentences(fields.title),
    abstract: splitSentences(fields.abstract),
    fullText: splitSentences(fields.fullText),
  };

  const out = [];
  for (const el of elements) {
    const kind = classifyElement(el);
    if (!kind) {
      out.push({ elementId: el.id, notFound: true });
      continue;
    }
    const candidates = gatherCandidates(kind, fields, sentencesByField);
    if (!candidates.length) {
      out.push({ elementId: el.id, notFound: true });
      continue;
    }
    const best = candidates[0];
    const ambiguous = candidates.length > 1;
    const suggestion = {
      elementId: el.id,
      armKey: '',
      value: best.value,
      confidence: ambiguous ? 'low' : 'medium',
      provenance: {
        type: 'sentence',
        excerpt: best.excerpt,
        location: { field: best.field, start: best.start, end: best.end },
      },
      notFound: false,
    };
    if (ambiguous) {
      suggestion.ambiguity = `${candidates.length} candidate matches found; proposing the first. Others: ${candidates
        .slice(1, 4)
        .map((c) => describeCandidate(kind, c))
        .join('; ')}`;
    }
    out.push(suggestion);
  }
  return out;
}

/** Convenience: return suggestions keyed by `${elementId}::` for direct map merge. */
export function suggestionsToValueMap(suggestions) {
  const map = {};
  for (const s of suggestions) {
    if (!s.notFound) map[valueKey(s.elementId, s.armKey || '')] = s.value;
  }
  return map;
}

/**
 * classifyElement(el) — decide which pattern family an element wants, by type +
 * name keywords. Returns a kind string or null (unsupported → notFound).
 */
export function classifyElement(el) {
  const name = String(el.name || '').toLowerCase();
  const type = el.type;

  if (type === 'dichotomous_outcome') return 'events_total';
  if (type === 'continuous_outcome') return 'mean_sd';
  if (type === 'timepoint') return 'followup';

  if (type === 'numeric' || type === 'baseline') {
    if (/\b(n|sample|total|enroll|random|participants|patients|subjects)\b/.test(name)) return 'sample_size';
    if (/%|percent|proportion|rate/.test(name)) return 'percentage';
    if (/mean|sd|average/.test(name)) return 'mean_sd';
    return 'number';
  }
  // Follow-up / duration expressed as text
  if (/follow|duration|timepoint/.test(name)) return 'followup';
  return null;
}

function gatherCandidates(kind, fields, sentencesByField) {
  for (const field of FIELD_ORDER) {
    const text = fields[field];
    if (!text) continue;
    const sentences = sentencesByField[field];
    const found = matchKind(kind, text, field, sentences);
    if (found.length) return found;
  }
  return [];
}

/**
 * matchKind — run the patterns for a kind over one field's text. Returns an ordered
 * list of { value, excerpt, field, start, end, raw } candidates.
 */
function matchKind(kind, text, field, sentences) {
  switch (kind) {
    case 'sample_size':
      return matchSampleSize(text, field, sentences);
    case 'events_total':
      return matchEventsTotal(text, field, sentences);
    case 'mean_sd':
      return matchMeanSd(text, field, sentences);
    case 'percentage':
      return matchPercentage(text, field, sentences);
    case 'followup':
      return matchFollowup(text, field, sentences);
    case 'number':
      return matchBareNumber(text, field, sentences);
    default:
      return [];
  }
}

/* ── Pattern matchers ─────────────────────────────────────────────────────── */

// "n = 123", "N=123", "123 patients/participants/subjects were randomized/enrolled/included"
function matchSampleSize(text, field, sentences) {
  const out = [];
  const seen = new Set();
  const reNEq = /\b[nN]\s*=\s*([0-9][0-9,]*)/g;
  pushMatches(reNEq, text, (m) => {
    const num = toInt(m[1]);
    if (num == null) return null;
    return { value: { value: num }, start: m.index, end: m.index + m[0].length };
  }, out, seen, field, sentences);

  const rePhrase = /\b([0-9][0-9,]{1,})\s+(?:patients|participants|subjects|individuals|people|women|men|adults|children)\b[^.?!]*?\b(?:were|was)?\s*(?:randomi[sz]ed|enrolled|included|recruited|analy[sz]ed)/gi;
  pushMatches(rePhrase, text, (m) => {
    const num = toInt(m[1]);
    if (num == null) return null;
    return { value: { value: num }, start: m.index, end: m.index + m[0].length };
  }, out, seen, field, sentences);

  return dedupeByValue(out);
}

// "12/45", "12 of 45"
function matchEventsTotal(text, field, sentences) {
  const out = [];
  const seen = new Set();
  const reSlash = /\b([0-9][0-9,]*)\s*\/\s*([0-9][0-9,]*)\b/g;
  pushMatches(reSlash, text, (m) => {
    const ev = toInt(m[1]);
    const tot = toInt(m[2]);
    if (ev == null || tot == null || tot === 0 || ev > tot) return null;
    return { value: { events: ev, total: tot }, start: m.index, end: m.index + m[0].length };
  }, out, seen, field, sentences);

  const reOf = /\b([0-9][0-9,]*)\s+of\s+([0-9][0-9,]*)\b/gi;
  pushMatches(reOf, text, (m) => {
    const ev = toInt(m[1]);
    const tot = toInt(m[2]);
    if (ev == null || tot == null || tot === 0 || ev > tot) return null;
    return { value: { events: ev, total: tot }, start: m.index, end: m.index + m[0].length };
  }, out, seen, field, sentences);

  return dedupeByValue(out);
}

// "12.3 ± 4.5" and "12.3 (SD 4.5)" / "12.3 (SD: 4.5)"
function matchMeanSd(text, field, sentences) {
  const out = [];
  const seen = new Set();
  const rePlusMinus = /(-?[0-9]+(?:\.[0-9]+)?)\s*(?:±|\+\/-)\s*([0-9]+(?:\.[0-9]+)?)/g;
  pushMatches(rePlusMinus, text, (m) => {
    const mean = toNum(m[1]);
    const sd = toNum(m[2]);
    if (mean == null || sd == null) return null;
    return { value: { mean, sd }, start: m.index, end: m.index + m[0].length };
  }, out, seen, field, sentences);

  const reParen = /(-?[0-9]+(?:\.[0-9]+)?)\s*\(\s*SD:?\s*([0-9]+(?:\.[0-9]+)?)\s*\)/gi;
  pushMatches(reParen, text, (m) => {
    const mean = toNum(m[1]);
    const sd = toNum(m[2]);
    if (mean == null || sd == null) return null;
    return { value: { mean, sd }, start: m.index, end: m.index + m[0].length };
  }, out, seen, field, sentences);

  return dedupeByValue(out);
}

// "45.2%"
function matchPercentage(text, field, sentences) {
  const out = [];
  const seen = new Set();
  const re = /(-?[0-9]+(?:\.[0-9]+)?)\s*%/g;
  pushMatches(re, text, (m) => {
    const num = toNum(m[1]);
    if (num == null) return null;
    return { value: { value: num, unit: '%' }, start: m.index, end: m.index + m[0].length };
  }, out, seen, field, sentences);
  return dedupeByValue(out);
}

// "followed for 12 months/weeks/years", "12-month follow-up", "median follow-up of 3 years"
function matchFollowup(text, field, sentences) {
  const out = [];
  const seen = new Set();
  const re1 = /follow(?:ed|-?up)?[^.?!]{0,40}?\b([0-9]+(?:\.[0-9]+)?)\s*(day|days|week|weeks|month|months|year|years)\b/gi;
  pushMatches(re1, text, (m) => {
    const num = toNum(m[1]);
    if (num == null) return null;
    return { value: { value: `${m[1]} ${m[2].toLowerCase()}` }, start: m.index, end: m.index + m[0].length };
  }, out, seen, field, sentences);

  const re2 = /\b([0-9]+(?:\.[0-9]+)?)[-\s]*(day|days|week|weeks|month|months|year|years)\s+follow(?:-?up)?/gi;
  pushMatches(re2, text, (m) => {
    const num = toNum(m[1]);
    if (num == null) return null;
    return { value: { value: `${m[1]} ${m[2].toLowerCase()}` }, start: m.index, end: m.index + m[0].length };
  }, out, seen, field, sentences);

  return dedupeByValue(out);
}

// Bare number fallback (only for a plain 'number' kind): first integer/decimal token.
function matchBareNumber(text, field, sentences) {
  const out = [];
  const seen = new Set();
  const re = /\b(-?[0-9]+(?:\.[0-9]+)?)\b/g;
  pushMatches(re, text, (m) => {
    const num = toNum(m[1]);
    if (num == null) return null;
    return { value: { value: num }, start: m.index, end: m.index + m[0].length };
  }, out, seen, field, sentences);
  return dedupeByValue(out);
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function pushMatches(re, text, build, out, seen, field, sentences) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
    const built = build(m);
    if (!built) continue;
    const sig = `${built.start}:${built.end}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const sent = sentenceAt(sentences, built.start);
    out.push({
      value: built.value,
      excerpt: sent ? sent.text : text.slice(built.start, built.end),
      field,
      start: built.start,
      end: built.end,
    });
  }
}

/** dedupeByValue — collapse candidates that carry an identical value payload,
 *  keeping the earliest occurrence. Ordered by position in the text. */
function dedupeByValue(candidates) {
  const seen = new Set();
  const kept = [];
  for (const c of candidates.slice().sort((a, b) => a.start - b.start)) {
    const key = JSON.stringify(c.value);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(c);
  }
  return kept;
}

function describeCandidate(kind, c) {
  const v = c.value;
  if (kind === 'events_total') return `${v.events}/${v.total}`;
  if (kind === 'mean_sd') return `${v.mean}±${v.sd}`;
  if (v && typeof v === 'object' && 'value' in v) return String(v.value);
  return JSON.stringify(v);
}

/**
 * splitSentences(text) — split on [.!?] followed by whitespace + a capital letter or
 * digit, preserving character indices. Returns [{ text, start, end }].
 * A conservative splitter (won't perfectly handle "e.g."/"i.e." but keeps indices
 * exact, which is what provenance needs).
 */
export function splitSentences(text) {
  const src = typeof text === 'string' ? text : '';
  if (!src.trim()) return [];
  const out = [];
  const re = /[.!?]+(?=\s+[A-Z0-9"'(])/g;
  let start = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    const end = m.index + m[0].length;
    const chunk = src.slice(start, end);
    if (chunk.trim()) out.push({ text: chunk.trim(), start, end });
    start = end;
  }
  const tail = src.slice(start);
  if (tail.trim()) out.push({ text: tail.trim(), start, end: src.length });
  return out;
}

/** sentenceAt(sentences, pos) — the sentence span containing character `pos`. */
function sentenceAt(sentences, pos) {
  for (const s of sentences) {
    if (pos >= s.start && pos < s.end) return s;
  }
  return sentences.length ? sentences[sentences.length - 1] : null;
}

function toInt(s) {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isInteger(n) ? n : null;
}
function toNum(s) {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
