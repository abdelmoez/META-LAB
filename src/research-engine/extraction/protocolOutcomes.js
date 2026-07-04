/**
 * extraction/protocolOutcomes.js — P (protocol-outcomes). Pure, dependency-free
 * reader for a review's PRE-SPECIFIED primary/secondary outcomes, pulled from the
 * project blob. No I/O, no React, no DOM, no Date — safe to import from the server,
 * the client, and unit tests.
 *
 * WHERE THE OUTCOMES LIVE
 *   1. project.prospero.fields.primary_outcomes  (free text, one item per line/…)
 *   2. project.prospero.fields.secondary_outcomes (free text)
 *   If BOTH are empty, we fall back to the PICO outcome field:
 *   3. project.pico.O — every item is treated as a `primary` outcome, source 'pico'.
 *   If nothing is present at all → { source:'none', outcomes:[] }.
 *
 * ITEM SPLITTING (see splitItems)
 *   Free text is split on newlines, semicolons, numbered prefixes (1. / 1) / (1))
 *   and bullets (- / * / •). Leading markers are stripped. Trailing periods are
 *   removed. Items whose normalized form is shorter than 3 chars are dropped. Each
 *   level is capped at 20 items.
 *
 * OUTCOME SHAPE
 *   { id, level, index, name, canonical, aliases, timepointHint }
 *     id            'p1','p2' for primary / 's1','s2' for secondary (1-based/level)
 *     level         'primary' | 'secondary'
 *     index         1-based position WITHIN its level (post-filter)
 *     name          verbatim item text, trimmed, trailing periods stripped
 *     canonical     normalizeOutcome(name)
 *     aliases       normalized alternates from parenthetical / measurement phrases
 *     timepointHint readable timepoint string (e.g. "12 weeks") or '' if none
 *
 * DETERMINISM
 *   Pure function of `project`. Malformed / missing input is coerced, never thrown
 *   on: a non-object project yields { source:'none', outcomes:[] }.
 */

import { normalizeOutcome } from './outcomeMatch.js';

const MAX_PER_LEVEL = 20;
const TIME_UNIT = '(?:day|days|week|weeks|month|months|year|years|hour|hours)';

/**
 * protocolOutcomes(project) — read pre-specified outcomes from the project blob.
 * @param {object} project
 * @returns {{ source:'prospero'|'pico'|'none', outcomes:Array }}
 */
export function protocolOutcomes(project) {
  const p = project && typeof project === 'object' ? project : {};

  const fields =
    p.prospero && typeof p.prospero === 'object' && p.prospero.fields && typeof p.prospero.fields === 'object'
      ? p.prospero.fields
      : {};
  const primaryRaw = typeof fields.primary_outcomes === 'string' ? fields.primary_outcomes : '';
  const secondaryRaw = typeof fields.secondary_outcomes === 'string' ? fields.secondary_outcomes : '';

  const primaryItems = splitItems(primaryRaw);
  const secondaryItems = splitItems(secondaryRaw);

  if (primaryItems.length || secondaryItems.length) {
    const primary = buildLevel(primaryItems, 'primary');
    const secondary = buildLevel(secondaryItems, 'secondary');
    const outcomes = primary.concat(secondary);
    if (outcomes.length) return { source: 'prospero', outcomes };
    // Both fields present but nothing survived filtering → fall through to PICO.
  }

  const picoO = p.pico && typeof p.pico === 'object' && typeof p.pico.O === 'string' ? p.pico.O : '';
  const picoItems = splitItems(picoO);
  if (picoItems.length) {
    const outcomes = buildLevel(picoItems, 'primary');
    if (outcomes.length) return { source: 'pico', outcomes };
  }

  return { source: 'none', outcomes: [] };
}

/**
 * splitItems(text) — split a free-text outcome blob into item strings.
 * Splits on newlines, semicolons, numbered markers (1. / 1) / (1)) and bullets
 * (- / * / •); leading markers are stripped from each item.
 */
export function splitItems(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  let t = text.replace(/\r\n?/g, '\n');
  // Break BEFORE an inline numbered marker or bullet that follows some content.
  // A numbered marker is 1–3 digits then . or ) then whitespace, or (n); a decimal
  // like "0.5" is safe because a marker requires whitespace after the delimiter.
  t = t.replace(/([^\n])[ \t]+(?=(?:\(\d{1,3}\)|\d{1,3}[.)])[ \t])/g, '$1\n');
  const chunks = t.split(/[\n;]+/);
  const items = [];
  for (const chunk of chunks) {
    let s = chunk.trim();
    if (!s) continue;
    s = s.replace(/^\s*(?:\(\d{1,3}\)|\d{1,3}[.)]|[-*•])\s*/, '').trim();
    if (!s) continue;
    items.push(s);
  }
  return items;
}

/** Build up to MAX_PER_LEVEL outcomes for one level from raw item strings. */
function buildLevel(items, level) {
  const valid = [];
  for (const raw of items) {
    const name = String(raw).trim().replace(/\.+$/, '').trim();
    if (!name) continue;
    const canonical = normalizeOutcome(name);
    if (canonical.length < 3) continue;
    valid.push({ name, canonical });
    if (valid.length >= MAX_PER_LEVEL) break;
  }
  const prefix = level === 'primary' ? 'p' : 's';
  return valid.map((o, i) => {
    const index = i + 1;
    return {
      id: prefix + index,
      level,
      index,
      name: o.name,
      canonical: o.canonical,
      aliases: extractAliases(o.name),
      timepointHint: findTimepoint(o.name),
    };
  });
}

/* ── Alias + timepoint extraction ──────────────────────────────────────────── */

// Leading measurement lead-in inside a parenthetical, e.g. "(measured by HbA1c)".
const LEADIN_RE =
  /^(?:(?:as\s+)?(?:measured|assessed|evaluated|quantified|determined|reported|defined|scored|graded|calculated|expressed)\s+(?:by|with|as|using|via|on|per|from)|by|via|using|per)\s+/i;

// Measurement phrase OUTSIDE parentheses, e.g. "... measured by HbA1c".
const MEAS_RE =
  /\b(?:measured|assessed|evaluated|quantified|determined|scored|graded)\s+(?:by|with|using|via|on|as)\s+([a-z0-9][^,;()]*)/gi;

/**
 * extractAliases(name) — derive normalized alias strings from a verbatim outcome
 * name: parenthetical content (minus a measurement lead-in) and inline
 * "measured by X" phrases. Pure timepoint parentheticals are ignored here.
 */
function extractAliases(name) {
  const aliases = [];
  const push = (raw) => {
    const a = normalizeOutcome(raw);
    if (a && a.length >= 2 && !aliases.includes(a)) aliases.push(a);
  };

  const reParen = /\(([^)]*)\)/g;
  let m;
  while ((m = reParen.exec(name)) !== null) {
    const inner = (m[1] || '').trim();
    if (!inner || isPureTimepoint(inner)) continue;
    push(inner.replace(LEADIN_RE, '').trim());
  }

  MEAS_RE.lastIndex = 0;
  while ((m = MEAS_RE.exec(name)) !== null) {
    let phrase = (m[1] || '').trim();
    // Drop a trailing timepoint clause ("... at 12 weeks").
    phrase = phrase.replace(new RegExp('\\b(?:at|after|over|by|within|during|for)\\s+\\d+.*$', 'i'), '').trim();
    if (phrase) push(phrase);
  }

  return aliases;
}

/**
 * findTimepoint(text) — first timepoint phrase as a readable string ("12 weeks"),
 * or '' if none. Recognizes "at/after/over/… 12 weeks", "12-week", "week 12".
 */
function findTimepoint(text) {
  const s = typeof text === 'string' ? text : '';
  let m = s.match(new RegExp('\\b(?:at|after|over|by|within|during|for|around|to)\\s+(\\d+(?:\\.\\d+)?)\\s*-?\\s*(' + TIME_UNIT + ')\\b', 'i'));
  if (m) return `${m[1]} ${m[2].toLowerCase()}`;
  m = s.match(new RegExp('\\b(\\d+(?:\\.\\d+)?)\\s*-\\s*(' + TIME_UNIT + ')\\b', 'i'));
  if (m) return `${m[1]} ${m[2].toLowerCase()}`;
  m = s.match(/\b(week|month|day|year|hour)s?\s+(\d+)\b/i);
  if (m) return `${m[2]} ${m[1].toLowerCase()}s`;
  return '';
}

/** isPureTimepoint(inner) — true when a parenthetical is only a timepoint clause. */
function isPureTimepoint(inner) {
  if (!findTimepoint(inner)) return false;
  const residue = inner
    .toLowerCase()
    .replace(/\b(?:at|after|over|by|within|during|for|around|to|of|week|weeks|month|months|day|days|year|years|hour|hours|follow|followup|follow-up|up)\b/g, ' ')
    .replace(/[0-9.\-]/g, ' ')
    .replace(/[^a-z]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return residue === '';
}
