/**
 * features/manuscript/richEditor/mdDom.js — 65.md (MS-CORE). Pure, dependency-free
 * markdown-subset ⇄ HTML converters for the WYSIWYG manuscript editor. No DOM, no
 * React — both directions work on strings so they are unit-testable in Node and
 * shared by the contentEditable editor, its paste sanitizer, and the export paths.
 *
 * Supported subset (everything else is stripped to plain text — never raw-leaked):
 *   #/##/###  → h2/h3/h4        - item      → ul>li        1. item → ol>li
 *   **bold**  → strong          *italic*    → em           `code`  → code
 *   [text](https://…)           | pipe | tables | (with `| --- |` header separator;
 *                                 116.md §59-§66: `:---:` alignment colons and the
 *                                 `\|` literal-pipe escape are part of the grammar)
 *   [[cite:id]]                 → atomic chip <span class="ms-cite" data-cite=…
 *                                 contenteditable="false">[n]</span> (n from orderMap)
 *   [[table:id]]/[[figure:id]]  → atomic chip <span class="ms-asset" data-asset=…
 *                                 contenteditable="false">Table 2</span> (85.md B1;
 *                                 number from opts.assetNumbers, unknown → 'Table ?')
 *   [[fact:key]]                → atomic chip <span class="ms-fact" data-fact=…
 *                                 contenteditable="false">four</span> (101.md §5/§6;
 *                                 value from opts.facts, unknown → its placeholder)
 *
 * 101.md §6 — the fact chip is a chip STRUCTURALLY and prose VISUALLY. It exists as
 * an element only so the resolved value stays atomic and caret-safe; it carries no
 * styling of its own, so with Show Changes off the manuscript is genuinely clean
 * rather than approximately clean. All of its paint lives in showChanges.js, scoped
 * under `[data-show-changes="true"]`.
 *
 * Security: escape FIRST (same rule as the old mdToHtml) — user text is never
 * injected unescaped, link hrefs are scheme-whitelisted (http/https/mailto).
 *
 * Round-trip contract: htmlToMd(mdToHtml(md)) is IDEMPOTENT — canonical markdown
 * (blocks separated by blank lines, `- `/`1. ` markers, `---` separators) survives
 * a round trip byte-for-byte; non-canonical input converges after one pass. The
 * fact chip obeys it too: the TOKEN is what persists, never the resolved text (§5).
 */

import { CITATION_TOKEN_RE } from '../../../research-engine/manuscript/citations.js';
import { ASSET_TOKEN_RE } from '../../../research-engine/manuscript/refTokens.js';
import { FACT_TOKEN_RE, factPlaceholder } from '../../../research-engine/manuscript/factTokens.js';
// 102.md — one classifier for the whole feature: the editor decorates exactly the
// spans the pure detector counts, so the badge can never disagree with the page.
import { classifyPlaceholder } from '../../../research-engine/manuscript/placeholders.js';
import { indexFactChanges, factChipTitle } from '../showChanges.js';

export const CITE_CHIP_CLASS = 'ms-cite';
export const ASSET_CHIP_CLASS = 'ms-asset';
export const FACT_CHIP_CLASS = 'ms-fact';
/** 102.md — a manual-input placeholder, e.g. `[State the review objective]`. */
export const INPUT_CHIP_CLASS = 'ms-input';

/** The `[[fact:key]]` key grammar, mirrored for the reverse (HTML → md) direction. */
const FACT_KEY_RE = /^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*$/;

/* ════════════ escaping ════════════ */

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/** Minimal entity decode for text we produced/received via innerHTML. &amp; LAST. */
function unescapeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/* ════════════ markdown → HTML ════════════ */

/** The atomic, non-editable citation chip. `id` raw; `n` 1-based or null → [?]. */
export function citeChipHtml(id, n) {
  return `<span class="${CITE_CHIP_CLASS}" data-cite="${escapeAttr(id)}" contenteditable="false">[${n == null ? '?' : n}]</span>`;
}

/** The atomic, non-editable asset chip (85.md B1). `id` = full 'table:study';
    label = 'Table 2' / 'Table ?' when unnumbered. */
export function assetChipHtml(id, label) {
  return `<span class="${ASSET_CHIP_CLASS}" data-asset="${escapeAttr(id)}" contenteditable="false">${escapeHtml(label)}</span>`;
}

/**
 * The atomic, non-editable fact chip (101.md §5/§6/§7). `text` is the RESOLVED value
 * — the thing the reader sees — while `data-fact` keeps the stable key so htmlToMd()
 * can put the token back. `data-engine`/`data-changed`/`data-missing` are inert
 * hooks: they carry no pixels of their own, they only let the Show-Changes
 * stylesheet paint the chip when (and only when) the toggle is on.
 *
 * `title` is emitted ONLY in Show-Changes mode. With the toggle off there is nothing
 * to explain, and a tooltip on every project-derived date would be exactly the kind
 * of lingering provenance marker §6 rules out.
 */
export function factChipHtml(key, text, meta = {}) {
  const attr = (name, val) => (val ? ` ${name}="${escapeAttr(val)}"` : '');
  return `<span class="${FACT_CHIP_CLASS}" data-fact="${escapeAttr(key)}"`
    + attr('data-engine', meta.engine)
    + (meta.changed ? ' data-changed="true"' : '')
    + (meta.missing ? ' data-missing="true"' : '')
    + attr('title', meta.title)
    + ` contenteditable="false">${escapeHtml(text)}</span>`;
}

/**
 * 102.md §3/§4 — the atomic, non-editable manual-input chip.
 *
 * Atomic on purpose: §32 wants a click anywhere inside to select the ENTIRE
 * placeholder including both brackets, so the researcher can type straight over it.
 * An atomic node gives exactly that, and it is the same mechanism the cite/asset/
 * fact chips already use, so undo, copy/paste and autosave (§9) behave identically.
 *
 * The label keeps its brackets in the visible text. They are the signal a reader
 * already understands from a draft manuscript, and keeping them means the markdown,
 * the export and the clipboard all agree.
 */
export function inputChipHtml(label, kind) {
  const k = kind === 'pending' ? 'pending' : 'manual';
  const title = k === 'pending'
    ? 'Awaiting project data — complete this step in the project, not by typing'
    : 'Manual input required';
  return `<span class="${INPUT_CHIP_CLASS}" data-input="${escapeAttr(label)}"`
    + ` data-input-kind="${k}" title="${escapeAttr(title)}" role="button" tabindex="0"`
    + ` aria-label="${escapeAttr(`${title}: ${label}`)}"`
    + ` contenteditable="false">[${escapeHtml(label)}]</span>`;
}

/**
 * Wrap every recognised manual-input placeholder. Operates on ALREADY-ESCAPED text,
 * so the label is unescaped before classification (the classifier reasons about
 * words, not entities) and re-escaped on the way out.
 */
function replaceInputPlaceholders(escText) {
  const s = String(escText);
  let out = '';
  let last = 0;
  const re = /\[([^[\]]+)\]/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    // Skip `[[token]]` grammars and markdown link text — same guards the pure
    // detector applies, kept in lockstep with placeholders.js.
    if (s.charAt(start - 1) === '[' || s.charAt(end) === ']' || s.charAt(end) === '(') continue;
    const label = unescapeEntities(m[1]).trim();
    const kind = classifyPlaceholder(label);
    if (!kind) continue;
    out += s.slice(last, start) + inputChipHtml(label, kind);
    last = end;
  }
  return last === 0 ? s : out + s.slice(last);
}

/** Look a number up in a Map OR plain-object numbering map (resolveNumbering.byId). */
function assetNumberOf(assetNumbers, id) {
  if (!assetNumbers) return null;
  const n = typeof assetNumbers.get === 'function' ? assetNumbers.get(id) : assetNumbers[id];
  return n == null ? null : n;
}

/** Look a resolved fact up in a Map OR plain object (resolveFacts output). */
export function factOf(facts, key) {
  if (!facts) return null;
  const f = typeof facts.get === 'function' ? facts.get(key) : facts[key];
  return f || null;
}

/**
 * The text a fact chip shows. Precedence mirrors renderFacts() exactly so the
 * editor, the clean render and the export can never disagree about one word:
 *   1. a §10 pinned override ("Restore previous wording"),
 *   2. the live resolved value,
 *   3. the honest placeholder — an unknown or unanswerable key NEVER leaks raw
 *      `[[fact:…]]` syntax into the page or an export (§17).
 * Pure.
 */
export function factChipText(key, facts, overrides) {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
    const ov = overrides[key];
    if (ov != null && String(ov) !== '') return String(ov);
  }
  const f = factOf(facts, key);
  if (f && f.value != null && f.value !== '') return String(f.value);
  return factPlaceholder(key);
}

/** Inline transforms over ALREADY-ESCAPED text. Chips first so a chip's [n] can
    never be re-parsed as a link; code before links/emphasis (verbatim spans). */
function inlineHtml(escText, orderMap, assetNumbers, factOpts) {
  let t = escText;
  // 102.md — placeholders run FIRST, while the text is still literal markdown.
  // After the chip passes below, the HTML contains chip labels like "[1]" and
  // "Table 2"; scanning for brackets then would claim a citation chip's own marker
  // as a manual field. The classifier's deny rules stay the second line of defence.
  t = replaceInputPlaceholders(t);
  t = t.replace(new RegExp(CITATION_TOKEN_RE.source, 'g'), (_m, idEsc) => {
    const id = unescapeEntities(idEsc);
    const n = orderMap && typeof orderMap.get === 'function' ? orderMap.get(id) : null;
    return citeChipHtml(id, n);
  });
  t = t.replace(new RegExp(ASSET_TOKEN_RE.source, 'g'), (_m, kind, suffix) => {
    const id = `${kind}:${suffix}`;
    const n = assetNumberOf(assetNumbers, id);
    return assetChipHtml(id, `${kind === 'figure' ? 'Figure' : 'Table'} ${n == null ? '?' : n}`);
  });
  t = t.replace(new RegExp(FACT_TOKEN_RE.source, 'g'), (_m, keyEsc) => {
    const key = unescapeEntities(keyEsc);
    const o = factOpts || EMPTY_FACT_OPTS;
    const f = factOf(o.facts, key);
    const change = o.changes.get(key);
    return factChipHtml(key, factChipText(key, o.facts, o.overrides), {
      engine: f ? f.engine : '',
      // `changes` may hold a bare key (a Set) with no change object — that is still
      // "this value moved", so treat presence, not truthiness, as the signal.
      changed: o.changes.has(key),
      missing: !!(f && f.missing),
      title: o.showChanges ? factChipTitle(key, f, change) : '',
    });
  });
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (m, txt, urlEsc) => {
    const url = unescapeEntities(urlEsc);
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return m; // unknown scheme → stays literal text
    // '*' must be %-encoded in the attribute or the later emphasis passes could
    // pair stars ACROSS the href boundary and corrupt the markup
    return `<a href="${escapeAttr(url).replace(/\*/g, '%2A')}">${txt || escapeHtml(url)}</a>`;
  });
  t = t.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  // bold may contain single-star italic runs: **a *b* c**
  t = t.replace(/\*\*((?:[^*]|\*(?!\*))+?)\*\*/g, (_m, inner) =>
    `<strong>${inner.replace(/\*([^*]+)\*/g, '<em>$1</em>')}</strong>`);
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return t;
}

/** 116.md §63 — escape literal pipes so cell text survives the pipe grammar
    ('|' used to be silently corrupted to '/'; '\|' round-trips instead). */
export function escapePipeCell(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|');
}

/**
 * Parse consecutive `| … |` lines into { header:[cells]|null, rows:[[cells]],
 * align:[per-column 'left'|'center'|'right'|null]|null }.
 * Shared with the docx converter (works on raw OR escaped lines — `|` survives),
 * so the editor render and the Word export follow the same grammar (116.md §65).
 * Returned cells are UNESCAPED: `\|` comes back as a literal `|` (116.md §63).
 * Alignment comes from the `:---:` colons on the separator row and therefore
 * only exists on tables WITH a header.
 */
export function parsePipeTable(lines) {
  const parseRow = (line) => {
    let s = String(line).trim();
    if (s.startsWith('|')) s = s.slice(1);
    // the trailing border pipe — never strip an escaped `\|` that ends a cell
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    // manual split so `\|` stays inside its cell (116.md §63)
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      if (ch === '\\' && s[i + 1] === '|') { cur += '\\|'; i += 1; continue; }
      if (ch === '|') { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells.map((c) => c.trim().replace(/\\\|/g, '|'));
  };
  const isSeparator = (cells) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
  const alignOf = (c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    if (l && r) return 'center';
    if (r) return 'right';
    if (l) return 'left';
    return null;
  };
  const all = (lines || []).map(parseRow);
  if (all.length >= 2 && isSeparator(all[1])) {
    return { header: all[0], rows: all.slice(2), align: all[1].map(alignOf) };
  }
  return { header: null, rows: all, align: null };
}

/**
 * 116.md §59-§66 — canonical pipe-table serializer, the exact inverse of
 * parsePipeTable. Cells are RAW text (a literal '|' is emitted as '\|'); rows are
 * rectangularized to the widest row so columns can never shift; alignment needs
 * the separator row, so it only survives on tables WITH a header. Shared by
 * htmlToMd's table emitter and the pure tableOps module so structural edits and
 * ordinary typing serialize byte-identically.
 */
export function serializePipeTable({ header, rows, align }) {
  const body = rows || [];
  const width = Math.max(header ? header.length : 0, ...body.map((r) => r.length), 1);
  const pad = (cells) => {
    const c = cells.map((x) => escapePipeCell(String(x == null ? '' : x).trim()));
    while (c.length < width) c.push('');
    return c;
  };
  const fmt = (cells) => `| ${cells.join(' | ')} |`;
  const sepCell = (a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---');
  const lines = [];
  if (header) {
    lines.push(fmt(pad(header)));
    lines.push(fmt(Array.from({ length: width }, (_, i) => sepCell(align ? align[i] : null))));
  }
  for (const r of body) lines.push(fmt(pad(r)));
  return lines.join('\n');
}

function tableHtml(escLines, orderMap, assetNumbers, factOpts) {
  const { header, rows, align } = parsePipeTable(escLines);
  // 116.md §61/§66 — rectangularize so short rows (hand-typed markdown) can never
  // shift columns under their header. This is END-padding, so it is the fix for a
  // row that is short at its TAIL only; a row shortened in the MIDDLE by a vertical
  // merge is padded positionally on the way in, by tableRowsOf (§66 r3).
  const width = Math.max(header ? header.length : 0, ...rows.map((r) => r.length), 1);
  const alignAttr = (i) => {
    const a = align && align[i];
    return a ? ` style="text-align:${a}"` : '';
  };
  // An EMPTY cell gets a <br> placeholder: a td with no text node is a flaky
  // caret target across engines (116.md §60); inlineOf turns the <br> back into
  // '' so the round trip stays clean.
  const cell = (tag, c, i) => {
    const inner = inlineHtml(c, orderMap, assetNumbers, factOpts);
    return `<${tag}${alignAttr(i)}>${inner || '<br>'}</${tag}>`;
  };
  const tr = (cells, tag) => {
    const c = cells.slice();
    while (c.length < width) c.push('');
    return `<tr>${c.map((x, i) => cell(tag, x, i)).join('')}</tr>`;
  };
  const parts = ['<table>'];
  if (header) parts.push(`<thead>${tr(header, 'th')}</thead>`);
  parts.push(`<tbody>${rows.map((r) => tr(r, 'td')).join('')}</tbody>`);
  parts.push('</table>');
  return parts.join('');
}

/** Neutral fact options — used whenever a caller passes none (exports, previews). */
const EMPTY_FACT_OPTS = { facts: null, overrides: null, changes: new Map(), showChanges: false };

/** Normalize the fact-related slice of opts once per render (101.md §16 — every
    token in one render resolves from ONE snapshot). */
function factOptsOf(opts) {
  if (!opts || (!opts.facts && !opts.factOverrides && !opts.factChanges && !opts.showChanges)) return EMPTY_FACT_OPTS;
  return {
    facts: opts.facts || null,
    overrides: opts.factOverrides || null,
    changes: indexFactChanges(opts.factChanges),
    showChanges: !!opts.showChanges,
  };
}

/**
 * Render the markdown subset to HTML. opts.orderMap: Map(citeId → 1-based n) for
 * cite-chip numbering (missing/absent → [?]). opts.assetNumbers: Map or plain
 * object (resolveNumbering.byId) for asset-chip labels (missing → 'Table ?').
 * opts.facts: resolveFacts() output (Map or plain object) for fact-chip values;
 * opts.factOverrides: §10 pinned wordings; opts.factChanges: the change log / key
 * set that marks a chip as recently updated; opts.showChanges: emit chip tooltips.
 */
export function mdToHtml(md, opts = {}) {
  const orderMap = opts.orderMap || null;
  const assetNumbers = opts.assetNumbers || null;
  const factOpts = factOptsOf(opts);
  const esc = escapeHtml(md);
  if (!esc.trim()) return '';
  const lines = esc.split(/\r?\n/);
  const out = [];
  let list = null; // 'ul' | 'ol' | null
  let tableBuf = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushTable = () => { if (tableBuf) { out.push(tableHtml(tableBuf, orderMap, assetNumbers, factOpts)); tableBuf = null; } };
  const inline = (s) => inlineHtml(s, orderMap, assetNumbers, factOpts);
  for (const line of lines) {
    const isTable = /^\s*\|/.test(line);
    if (tableBuf && !isTable) flushTable();
    if (isTable) { closeList(); if (!tableBuf) tableBuf = []; tableBuf.push(line); continue; }
    if (/^###\s+/.test(line)) { closeList(); out.push(`<h4>${inline(line.replace(/^###\s+/, ''))}</h4>`); continue; }
    if (/^##\s+/.test(line)) { closeList(); out.push(`<h3>${inline(line.replace(/^##\s+/, ''))}</h3>`); continue; }
    if (/^#\s+/.test(line)) { closeList(); out.push(`<h2>${inline(line.replace(/^#\s+/, ''))}</h2>`); continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`);
      continue;
    }
    if (!line.trim()) { closeList(); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  flushTable();
  return out.join('\n');
}

/* ════════════ HTML → markdown ════════════ */

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
// Content of these is DROPPED entirely (Word/Docs paste ships <style>/<script> blocks).
const DROP_TAGS = new Set(['style', 'script', 'head', 'title', 'template', 'iframe', 'object', 'noscript', 'svg', 'math']);
const BLOCK_TAGS = new Set(['html', 'body', 'main', 'aside', 'nav', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'hr', 'form', 'fieldset']);

function parseAttrs(tagTok) {
  const attrs = {};
  const body = tagTok.replace(/^<[a-zA-Z][a-zA-Z0-9]*/, '').replace(/\/?>$/, '');
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    attrs[m[1].toLowerCase()] = unescapeEntities(m[2] != null ? m[2] : (m[3] != null ? m[3] : (m[4] != null ? m[4] : '')));
  }
  return attrs;
}

/** Tolerant tag-soup parser → { tag:'#root', children } tree. Good enough for
    innerHTML serializations and clipboard HTML; stray `<` chars are dropped. */
function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let m;
  while ((m = re.exec(String(html == null ? '' : html))) !== null) {
    const tok = m[0];
    if (tok.startsWith('<!')) continue;
    if (tok[0] !== '<') { stack[stack.length - 1].children.push({ text: tok }); continue; }
    if (tok[1] === '/') {
      const cm = tok.match(/^<\/\s*([a-zA-Z][a-zA-Z0-9]*)/);
      if (!cm) continue;
      const tag = cm[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const om = tok.match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
    if (!om) continue;
    const tag = om[1].toLowerCase();
    const node = { tag, attrs: parseAttrs(tok), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!VOID_TAGS.has(tag) && !/\/>$/.test(tok)) stack.push(node);
  }
  return root;
}

function textOf(node) {
  if (node.text != null) return unescapeEntities(node.text);
  if (DROP_TAGS.has(node.tag)) return '';
  return (node.children || []).map(textOf).join('');
}

/** Serialize an inline node run to markdown. oneLine: <br> → space (list items,
    headings, table cells — a newline there would break the block grammar). */
function inlineOf(nodes, opts = {}) {
  let out = '';
  for (const n of nodes || []) {
    if (n.text != null) { out += unescapeEntities(n.text).replace(/\r?\n/g, ' '); continue; }
    const tag = n.tag;
    if (DROP_TAGS.has(tag)) continue;
    if (tag === 'br') { out += opts.oneLine ? ' ' : '\n'; continue; }
    if (VOID_TAGS.has(tag)) continue;
    // 102.md — a manual-input chip round-trips to its literal bracketed text, so
    // the markdown, the export and the clipboard all carry the same draft prose.
    // A corrupt/foreign data-input span falls through to its text content below,
    // which is the same string anyway.
    if (n.attrs && n.attrs['data-input'] != null) {
      const label = String(n.attrs['data-input']).replace(/[[\]]/g, '').trim();
      if (label) { out += `[${label}]`; continue; }
    }
    if (n.attrs && n.attrs['data-cite']) { out += `[[cite:${String(n.attrs['data-cite']).replace(/[\]\s]/g, '')}]]`; continue; }
    if (n.attrs && n.attrs['data-asset'] != null) {
      // Asset chip → its stable token. Only a grammar-valid id round-trips; a
      // foreign/corrupt data-asset span degrades to its text content below.
      const id = String(n.attrs['data-asset']).replace(/[[\]\s]/g, '');
      if (/^(table|figure):[a-z0-9:-]+$/.test(id)) { out += `[[${id}]]`; continue; }
    }
    if (n.attrs && n.attrs['data-fact'] != null) {
      // 101.md §5 — the fact chip reverses to its TOKEN, never to the resolved text.
      // That is the whole guarantee: what persists is a pointer at project data, so
      // a later search cannot be prevented from updating this sentence, and a
      // researcher's surrounding prose cannot be rewritten to make it happen.
      // Same grammar guard as the asset branch: a foreign/corrupt data-fact span
      // degrades to its text content below rather than emitting a broken token.
      const key = String(n.attrs['data-fact']).replace(/[[\]\s]/g, '');
      if (FACT_KEY_RE.test(key)) { out += `[[fact:${key}]]`; continue; }
    }
    if (tag === 'code') { const t = textOf(n).replace(/`/g, '').trim(); if (t) out += `\`${t}\``; continue; }
    if (tag === 'a' && n.attrs && /^(https?:\/\/|mailto:)/i.test(n.attrs.href || '')) {
      // ) and whitespace would break the md link grammar → percent-encode them
      const href = n.attrs.href.replace(/\)/g, '%29').replace(/\s/g, '%20');
      const t = inlineOf(n.children, { ...opts, oneLine: true }).replace(/[[\]]/g, '').trim() || href;
      out += `[${t}](${href})`;
      continue;
    }
    const style = String((n.attrs && n.attrs.style) || '').toLowerCase();
    const bold = tag === 'b' || tag === 'strong' || /font-weight\s*:\s*(bold|[6-9]00)/.test(style);
    const italic = tag === 'i' || tag === 'em' || /font-style\s*:\s*italic/.test(style);
    const inner = inlineOf(n.children, opts);
    if (!inner.trim()) { out += inner; continue; }
    // 116.md §66 (r3) — a BLOCK child inside an inline run is a real content
    // boundary, so it may never be unwrapped to NOTHING. Word and Google Docs wrap
    // every line of a table cell (and of a list item) in its own <p>, and gluing
    // those together silently rewrote data: `<td><p>3.2</p><p>(1.1)</p></td>` became
    // the cell `3.2(1.1)`, and `<p>12.4</p><p>8.1</p>` became the single number
    // `12.48.1`. The corrupted text is a fixed point of the round trip, so nothing
    // downstream could ever detect or repair it — it just autosaved and exported.
    // The pipe grammar has no intra-cell newline, so the boundary degrades to
    // exactly the separator a <br> already degrades to (line 468: a space in
    // oneLine mode, a newline otherwise) — visibly two values, never one token.
    if (BLOCK_TAGS.has(tag) && out && !/\s$/.test(out) && !/^\s/.test(inner)) {
      out += opts.oneLine ? ' ' : '\n';
    }
    if (bold || italic) {
      const lead = inner.match(/^\s*/)[0];
      const trail = inner.match(/\s*$/)[0];
      let core = inner.trim();
      // A trailing '*' (nested italic at the END of a bold run) would merge with
      // the closing marker into an unparseable '***' — pad with a space instead.
      const pad = (c) => (/\*$/.test(c) ? `${c} ` : c);
      const wholeEm = core.match(/^\*([^*]+)\*$/);       // <b><i>x</i></b>
      const wholeStrong = core.match(/^\*\*([^*]+)\*\*$/); // <i><b>x</b></i>
      if (bold && italic) core = `***${core}***`;
      else if (bold) core = wholeEm ? `***${wholeEm[1]}***` : `**${pad(core)}**`;
      else core = wholeStrong ? `***${wholeStrong[1]}***` : `*${pad(core)}*`;
      out += lead + core + trail;
      continue;
    }
    out += inner; // unknown/plain inline wrapper (span, u, font, p-in-li …) → unwrap
  }
  return out;
}

function hasBlockChild(node) {
  return (node.children || []).some((c) => c.tag && BLOCK_TAGS.has(c.tag));
}

function collectListItems(node, out) {
  for (const c of node.children || []) {
    if (c.text != null) continue;
    if (c.tag === 'li') {
      const nested = [];
      const own = [];
      for (const k of c.children || []) {
        if (k.tag === 'ul' || k.tag === 'ol') nested.push(k);
        else own.push(k);
      }
      const t = inlineOf(own, { oneLine: true }).trim();
      if (t) out.push(t);
      for (const nn of nested) collectListItems(nn, out); // subset lists are flat
    } else if (c.tag === 'ul' || c.tag === 'ol') collectListItems(c, out);
  }
}

function emitList(node, blocks) {
  const items = [];
  collectListItems(node, items);
  if (!items.length) return;
  const lines = node.tag === 'ol'
    ? items.map((t, i) => `${i + 1}. ${t}`) // canonical renumber from 1
    : items.map((t) => `- ${t}`);
  blocks.push(lines.join('\n'));
}

/** 116.md §65 — per-cell alignment from the cell's own style/align attrs or its
    first block child (Word puts text-align on the inner <p>, not the td). */
function cellAlignOf(cell) {
  const pick = (attrs) => {
    if (!attrs) return null;
    const m = String(attrs.style || '').toLowerCase().match(/text-align\s*:\s*(left|center|right)/);
    if (m) return m[1];
    const al = String(attrs.align || '').toLowerCase();
    return (al === 'left' || al === 'center' || al === 'right') ? al : null;
  };
  const own = pick(cell.attrs);
  if (own) return own;
  for (const k of cell.children || []) {
    if (k.tag === 'p' || k.tag === 'div') { const a = pick(k.attrs); if (a) return a; }
  }
  return null;
}

function tableRowsOf(node) {
  const rows = [];
  // 116.md §66 (r3) — BOTH merge directions are flattened POSITIONALLY, against one
  // occupancy grid. `carry[col]` is how many further rows that column is still
  // covered by a vertical merge, so a covered row gets an EMPTY placeholder cell IN
  // PLACE — the same honest degradation colspan already gets — instead of letting
  // the row's next real cell slide left into its neighbour's column.
  //
  // End-padding is NOT positional padding: the serializer's rectangularization
  // appends at the END of a short row, so `<td rowspan="2">Arm A</td>` used to file
  // the following row's "MI" under Group and its "12" under Outcome, leaving N
  // blank — a silent column shift that autosaved and exported to Word as data.
  // A merge is still lossy (the value is not repeated into the rows it spans;
  // inventing it would be worse), but the loss is now a VISIBLE blank cell.
  const carry = [];
  const walk = (n, inHead) => {
    for (const c of n.children || []) {
      if (c.text != null) continue;
      if (c.tag === 'tr') {
        const cells = [];
        const aligns = [];
        let allTh = true;
        let any = false;
        let col = 0;
        const place = (text, align) => { cells[col] = text; aligns[col] = align; col += 1; };
        // Walk past (and consume one row of) every column a merge already covers.
        const skipCovered = () => { while (carry[col] > 0) { carry[col] -= 1; place('', null); } };
        for (const cell of c.children || []) {
          if (cell.text != null) continue;
          if (cell.tag === 'td' || cell.tag === 'th') {
            any = true;
            if (cell.tag !== 'th') allTh = false;
            skipCovered();
            const span = (name) => Math.max(1, parseInt((cell.attrs && cell.attrs[name]) || '1', 10) || 1);
            const colspan = span('colspan');
            const rowspan = span('rowspan');
            const start = col;
            // RAW cell text — a literal '|' is escaped later by serializePipeTable
            // (116.md §63; it used to be corrupted to '/').
            place(inlineOf(cell.children, { oneLine: true }).trim(), cellAlignOf(cell));
            // A colspan'd (merged) Word cell is flattened honestly: pad with empty
            // cells so the following columns stay aligned instead of shifting left.
            for (let i = 1; i < colspan; i += 1) place('', null);
            // …and a rowspan reserves the SAME columns in the rows below it.
            if (rowspan > 1) for (let i = start; i < col; i += 1) carry[i] = rowspan - 1;
          }
        }
        // Columns still covered PAST this row's last real cell (a merge in the
        // trailing columns) get their placeholders too, so the grid stays square.
        let lastCovered = -1;
        for (let i = col; i < carry.length; i += 1) if (carry[i] > 0) lastCovered = i;
        while (col <= lastCovered) { if (carry[col] > 0) carry[col] -= 1; place('', null); }
        if (any) rows.push({ cells, aligns, header: inHead || allTh });
      } else if (c.tag === 'thead') walk(c, true);
      else if (c.tag === 'tbody' || c.tag === 'tfoot') walk(c, false);
      else if (c.tag) walk(c, inHead);
    }
  };
  walk(node, false);
  return rows;
}

function emitTable(node, blocks) {
  const rows = tableRowsOf(node);
  if (!rows.length) return;
  const hasHeader = rows[0].header;
  const header = hasHeader ? rows[0].cells : null;
  const body = (hasHeader ? rows.slice(1) : rows).map((r) => r.cells);
  // 116.md §65 — per-COLUMN alignment for the separator row: the header cell
  // decides; a column whose header carries none falls back to the first aligned
  // body cell (Word paste often styles only body paragraphs). Headerless tables
  // have no separator row, so alignment cannot be represented and drops.
  let align = null;
  if (hasHeader) {
    const width = Math.max(...rows.map((r) => r.cells.length), 1);
    align = [];
    for (let i = 0; i < width; i += 1) {
      let a = rows[0].aligns[i] || null;
      if (!a) {
        for (const r of rows.slice(1)) { if (r.aligns[i]) { a = r.aligns[i]; break; } }
      }
      align.push(a);
    }
  }
  blocks.push(serializePipeTable({ header, rows: body, align }));
}

function emitBlock(node, blocks) {
  const tag = node.tag;
  if (DROP_TAGS.has(tag)) return;
  if (tag === 'h1' || tag === 'h2') { const t = inlineOf(node.children, { oneLine: true }).trim(); if (t) blocks.push(`# ${t}`); return; }
  if (tag === 'h3') { const t = inlineOf(node.children, { oneLine: true }).trim(); if (t) blocks.push(`## ${t}`); return; }
  if (tag === 'h4' || tag === 'h5' || tag === 'h6') { const t = inlineOf(node.children, { oneLine: true }).trim(); if (t) blocks.push(`### ${t}`); return; }
  if (tag === 'ul' || tag === 'ol') { emitList(node, blocks); return; }
  if (tag === 'li') { emitList({ tag: 'ul', attrs: {}, children: [node] }, blocks); return; }
  if (tag === 'table') { emitTable(node, blocks); return; }
  if (tag === 'hr') return;
  if (tag === 'pre' || tag === 'blockquote') {
    const t = textOf(node).trim();
    if (t) blocks.push(t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n'));
    return;
  }
  if (hasBlockChild(node)) { walkBlocks(node.children, blocks); return; }
  const t = inlineOf(node.children).replace(/ /g, ' ').trim();
  if (t) blocks.push(t);
}

function walkBlocks(nodes, blocks) {
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const t = inlineOf(run).replace(/ /g, ' ').trim();
    run = [];
    if (t) blocks.push(t);
  };
  for (const n of nodes || []) {
    if (n.text != null || !BLOCK_TAGS.has(n.tag)) { run.push(n); continue; }
    flush();
    emitBlock(n, blocks);
  }
  flush();
}

/**
 * Convert (possibly messy) HTML — the editor's innerHTML or clipboard HTML from
 * Word/Docs — down to the markdown subset. Everything outside the subset is
 * reduced to its text content; scripts/styles are dropped entirely.
 */
export function htmlToMd(html) {
  const blocks = [];
  walkBlocks(parseHtml(html).children, blocks);
  return blocks.join('\n\n');
}

/* ════════════ outline (MS-11) ════════════ */

/** Strip inline markdown for display labels (outline entries). Asset tokens
    become their label-ish text ('Table ?') so raw tokens never leak. */
export function stripInlineMd(s) {
  return String(s == null ? '' : s)
    .replace(new RegExp(CITATION_TOKEN_RE.source, 'g'), '')
    .replace(new RegExp(ASSET_TOKEN_RE.source, 'g'), (_m, kind) => (kind === 'figure' ? 'Figure ?' : 'Table ?'))
    // 101.md §6 — an outline label has no project snapshot to resolve against, so a
    // fact token drops out entirely rather than leaking its raw syntax into the UI.
    .replace(new RegExp(FACT_TOKEN_RE.source, 'g'), '')
    .replace(/\[([^\]]*)\]\([^)\s]+\)/g, '$1')
    .replace(/\*\*\*|\*\*|\*|`/g, '')
    .trim();
}

/**
 * Derive the heading outline of a markdown section at render time (no model
 * change). headingIndex counts ALL headings in document order — it matches the
 * index of the corresponding element in querySelectorAll('h2,h3,h4') on the
 * rendered page, so the outline can scroll to it.
 */
export function extractOutline(md) {
  const out = [];
  let idx = 0;
  for (const line of String(md == null ? '' : md).split(/\r?\n/)) {
    const m = line.match(/^(#{1,3})\s+(.*)$/);
    if (!m) continue;
    out.push({ level: m[1].length, text: stripInlineMd(m[2]), headingIndex: idx });
    idx += 1;
  }
  return out;
}

export default {
  escapeHtml, mdToHtml, htmlToMd, citeChipHtml, assetChipHtml, factChipHtml,
  factChipText, factOf, parsePipeTable, serializePipeTable, escapePipeCell,
  extractOutline, stripInlineMd,
  CITE_CHIP_CLASS, ASSET_CHIP_CLASS, FACT_CHIP_CLASS, INPUT_CHIP_CLASS,
};
