/**
 * features/manuscript/showChanges.js — 101.md §6/§7/§8/§35. The visual language of
 * the Show-Changes overlay, and nothing else.
 *
 * The whole design rests on one asymmetry that 101.md §6 and §39 demand:
 *
 *   Show Changes OFF → the manuscript is a manuscript. Not "almost clean", not
 *                      "clean apart from a faint dotted thing". Clean.
 *   Show Changes ON  → the SAME DOM acquires provenance paint.
 *
 * That is why every rule in `SHOW_CHANGES_CSS` that paints anything is scoped under
 * `[data-show-changes="true"]`. The fact chips themselves (richEditor/mdDom.js) are
 * atomic `contenteditable="false"` islands so the caret cannot land inside a
 * project-derived value — but they carry NO styling of their own, so flipping the
 * toggle off removes every visual trace without touching a single character of the
 * document (§6 "The underlying manuscript content should be identical in both modes").
 *
 * §7 asks for a restrained system, explicitly "not a rainbow". So:
 *   - the resting state of an engine-derived fact is a tinted UNDERLINE, not a
 *     background fill;
 *   - only a fact that ACTUALLY CHANGED gets the stronger treatment (left-edge bar
 *     plus a ~9%-alpha wash), because that is the state §8 is about;
 *   - colour is never load-bearing (§7, §35): every engine also carries a distinct
 *     GLYPH (rendered as CSS generated content, so it never enters the document
 *     text) and a short LABEL used in the chip tooltip, the legend and the panel.
 *
 * Theming: the manuscript page is LITERAL white in both themes (see RICH_EDITOR_CSS),
 * so the on-paper inks are fixed hex values — theme-switching them would only make
 * them wrong. Chrome OUTSIDE the page (legend, panel, provenance card) reads the
 * `--ms-eng-*` custom properties, which DO switch on `[data-theme="night"]`. Every
 * consumer uses `var(--ms-eng-x, <ink>)` so an un-injected stylesheet degrades to the
 * light ink rather than to `unset`.
 *
 * Pure — no DOM, no React, no network, no Date.now(). Strings in, strings out.
 */

import { FACT_ENGINES, FACT_ENGINE_IDS, formatFactDate } from '../../research-engine/manuscript/factTokens.js';

/* ════════════ the palette ════════════ */

/**
 * Per-engine paint. Inks are chosen to clear WCAG AA (≥4.5:1) as text on the white
 * manuscript page; `dark` is the lighter twin used on dark app surfaces. Hues are
 * spread around the Okabe–Ito axes so they stay separable under the common colour
 * vision deficiencies — but the glyph, not the hue, is the primary signal (§35).
 */
const PAINT = {
  search:     { ink: '#0072b2', dark: '#7fb9e8', glyph: '◇' },
  screening:  { ink: '#b64f00', dark: '#f0a06a', glyph: '◑' },
  prisma:     { ink: '#0f6b4a', dark: '#5fd3a0', glyph: '⇣' },
  extraction: { ink: '#6d28d9', dark: '#b79bf5', glyph: '▤' },
  rob:        { ink: '#9a5b00', dark: '#e0b05c', glyph: '▲' },
  analysis:   { ink: '#9c2d6f', dark: '#e493c6', glyph: '∑' },
  protocol:   { ink: '#475569', dark: '#a9b6c9', glyph: '§' },
};

const FALLBACK_PAINT = { ink: '#475569', dark: '#a9b6c9', glyph: '•' };

function makeStyle(id, label, short, paint) {
  const p = paint || FALLBACK_PAINT;
  return Object.freeze({
    id,
    label,
    short,
    glyph: p.glyph,
    ink: p.ink,
    dark: p.dark,
    varName: `--ms-eng-${id}`,
    /** Use this in inline styles — it falls back to the light ink if the CSS is absent. */
    cssVar: `var(--ms-eng-${id}, ${p.ink})`,
  });
}

/**
 * ENGINE_STYLE — one entry per FACT_ENGINES id, PLUS the two origins 101.md §7 names
 * that are not fact engines: a manual manuscript edit and an unattributed change.
 * Built by walking FACT_ENGINE_IDS rather than by hand, so adding an engine to the
 * registry can never leave the overlay with an unpainted origin.
 */
export const ENGINE_STYLE = Object.freeze(FACT_ENGINE_IDS.reduce((acc, id) => {
  const meta = FACT_ENGINES[id] || {};
  acc[id] = makeStyle(id, meta.label || id, meta.short || meta.label || id, PAINT[id]);
  return acc;
}, {
  // §7 lists "Manual manuscript edit" alongside the engines — the researcher's own
  // typing is an origin too, and the overlay must be able to say so.
  manual: makeStyle('manual', 'Manual manuscript edit', 'Manual', { ink: '#64748b', dark: '#94a3b8', glyph: '✎' }),
  // §38 — an older project may carry history whose origin was never recorded. Say
  // "unattributed" rather than inventing an engine for it.
  other: makeStyle('other', 'Unattributed change', 'Unattributed', FALLBACK_PAINT),
}));

/** Legend/paint order: the research workflow order, then the non-engine origins. */
export const ENGINE_ORDER = Object.freeze([...FACT_ENGINE_IDS, 'manual', 'other']);

/** Every painted origin, in legend order. Also the data a legend UI renders. */
export const LEGEND_ITEMS = Object.freeze(ENGINE_ORDER.map((id) => ENGINE_STYLE[id]));

/** Paint for an engine id; an unknown/absent id is honestly 'Unattributed'. Pure. */
export function engineStyle(id) {
  const key = String(id == null ? '' : id);
  return Object.prototype.hasOwnProperty.call(ENGINE_STYLE, key) ? ENGINE_STYLE[key] : ENGINE_STYLE.other;
}

/* ════════════ change helpers (§8) ════════════ */

/**
 * Normalize whatever the caller has into `Map(factKey → change|null)`.
 * Accepts a flat change log (the common case — `draft.factLog`), an already-keyed
 * object/Map, or a bare Set/array of keys. Later entries win, so a log in
 * chronological order yields the MOST RECENT change per fact. Pure.
 */
export function indexFactChanges(changes) {
  const out = new Map();
  if (!changes) return out;
  if (changes instanceof Set) {
    for (const k of changes) out.set(String(k), null);
    return out;
  }
  if (Array.isArray(changes)) {
    for (const c of changes) {
      if (!c) continue;
      if (typeof c === 'string') { out.set(c, null); continue; }
      if (c.key) out.set(String(c.key), c);
    }
    return out;
  }
  if (typeof changes.forEach === 'function' && typeof changes.get === 'function') {
    changes.forEach((v, k) => out.set(String(k), v && typeof v === 'object' ? v : null));
    return out;
  }
  for (const k of Object.keys(changes)) {
    const v = changes[k];
    out.set(k, v && typeof v === 'object' ? v : null);
  }
  return out;
}

/** "three → four" — the §8 one-liner. '' when there is nothing to compare. Pure. */
export function changeSummary(change) {
  const c = change || {};
  const from = c.from == null ? '' : String(c.from);
  const to = c.to == null ? '' : String(c.to);
  if (!from && !to) return '';
  if (!from) return to;
  if (!to) return from;
  return `${from} → ${to}`;
}

/** "August 6, 2026" (UTC — a search date must not drift across timezones). Pure. */
export function formatChangeDate(iso) {
  return formatFactDate(iso);
}

/** "14:32" from an ISO timestamp, or '' when it carries no time. Pure. */
export function formatChangeTime(iso) {
  const m = String(iso == null ? '' : iso).match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

/** "August 6, 2026 · 14:32" for the panel's timestamp column. Pure. */
export function formatChangeStamp(iso) {
  const d = formatChangeDate(iso);
  if (!d) return '';
  const t = formatChangeTime(iso);
  return t ? `${d} · ${t}` : d;
}

/**
 * The chip's `title` (and the string a screen reader gets) — 101.md §7 requires a
 * label/tooltip so colour is never the only channel, and §9 wants the useful
 * metadata one hover away. Deliberately researcher-facing: no ids, no event types.
 * Pure.
 */
export function factChipTitle(key, fact, change) {
  const f = fact || null;
  const style = engineStyle(f ? f.engine : (change && change.engine));
  const field = (f && f.label) || (change && change.label) || String(key || '');
  const parts = [`${field} — ${style.label}`];
  if (f && f.missing) {
    parts.push(`Not yet available. ${f.hint || ''}`.trim());
  } else if (change && (change.from != null || change.to != null)) {
    const when = formatChangeDate(change.at);
    parts.push(`Updated${when ? ` ${when}` : ''}: ${changeSummary(change)}`);
    if (change.reason) parts.push(change.reason);
  } else {
    parts.push('Kept up to date from your project data.');
  }
  return parts.filter(Boolean).join(' · ');
}

/* ════════════ CSS ════════════ */

/** '#0072b2' → 'rgba(0,114,178,0.09)'. Pure; non-hex input passes through. */
function hexA(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const varBlock = (pick) => LEGEND_ITEMS.map((e) => `${e.varName}:${e[pick]};`).join('');

/** Per-engine on-paper rules. Generated from ENGINE_STYLE so nothing can drift. */
function engineRules() {
  return LEGEND_ITEMS.map((e) => [
    /* resting state: a tinted underline. No fill, no border, no chip. */
    `[data-show-changes="true"] span.ms-fact[data-engine="${e.id}"]{text-decoration-color:${e.ink};}`,
    /* the non-colour channel (§7/§35) — generated content, so it is NOT document text
       and can never reach htmlToMd() or an export. */
    `[data-show-changes="true"] span.ms-fact[data-engine="${e.id}"]::after{content:"${e.glyph}";color:${e.ink};}`,
    /* §8 — a value that actually moved earns the left-edge bar and a faint wash. */
    `[data-show-changes="true"] span.ms-fact[data-engine="${e.id}"][data-changed="true"]{`
      + `background:${hexA(e.ink, 0.09)};box-shadow:inset 2px 0 0 0 ${e.ink};}`,
  ].join('\n')).join('\n');
}

/**
 * The overlay stylesheet. EVERY painting rule is scoped under
 * `[data-show-changes="true"]`, which RichSectionEditor puts on its root — so the
 * toggle is a pure CSS switch over an unchanged DOM (§6).
 *
 * Concatenated into RICH_EDITOR_CSS (RichSectionEditor.jsx) so the page always has
 * it; components that render outside the page inject it themselves. Injecting it
 * twice is harmless — the rules are idempotent.
 */
export const SHOW_CHANGES_CSS = `
/* ── engine ink tokens ─────────────────────────────────────────────────────
   For chrome OUTSIDE the manuscript page (legend, change panel, provenance card),
   which sits on themed surfaces. The page itself is literal white in both themes,
   so its rules below use the fixed light inks directly. */
:root{${varBlock('ink')}}
:root[data-theme="night"]{${varBlock('dark')}}

/* ── Show Changes ON (§6) ──────────────────────────────────────────────────
   Nothing here applies unless an ancestor carries data-show-changes="true".
   No transitions or animations anywhere in this file, so the overlay is
   reduced-motion-safe by construction (§35). */
[data-show-changes="true"] span.ms-fact{
  text-decoration:underline;
  text-decoration-color:${FALLBACK_PAINT.ink};
  text-decoration-thickness:1.5px;
  text-underline-offset:2.5px;
  text-decoration-skip-ink:none;
  border-radius:2px;
  cursor:help;
}
[data-show-changes="true"] span.ms-fact::after{
  content:"${FALLBACK_PAINT.glyph}";
  font:600 8.5px/1 'IBM Plex Sans',sans-serif;
  vertical-align:super;
  margin-left:1px;
  letter-spacing:0;
  text-decoration:none;
  color:${FALLBACK_PAINT.ink};
}
[data-show-changes="true"] span.ms-fact[data-changed="true"]{
  text-decoration-thickness:2px;
  padding:0 2px 0 3px;
  margin:0 -1px;
}
/* A fact the project cannot answer yet (§17) reads as unfinished, not as wrong. */
[data-show-changes="true"] span.ms-fact[data-missing="true"]{
  text-decoration-style:dotted;
  text-decoration-thickness:1.5px;
  opacity:0.85;
}
${engineRules()}
`;

export default {
  ENGINE_STYLE,
  ENGINE_ORDER,
  LEGEND_ITEMS,
  SHOW_CHANGES_CSS,
  engineStyle,
  indexFactChanges,
  changeSummary,
  factChipTitle,
  formatChangeDate,
  formatChangeTime,
  formatChangeStamp,
};
