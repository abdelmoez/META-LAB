/**
 * features/manuscript/richEditor/mdDom.js — 65.md (MS-CORE). Pure, dependency-free
 * markdown-subset ⇄ HTML converters for the WYSIWYG manuscript editor. No DOM, no
 * React — both directions work on strings so they are unit-testable in Node and
 * shared by the contentEditable editor, its paste sanitizer, and the export paths.
 *
 * Supported subset (everything else is stripped to plain text — never raw-leaked):
 *   #/##/###  → h2/h3/h4        - item      → ul>li        1. item → ol>li
 *   **bold**  → strong          *italic*    → em           `code`  → code
 *   [text](https://…)           | pipe | tables | (with `| --- |` header separator)
 *   [[cite:id]]                 → atomic chip <span class="ms-cite" data-cite=…
 *                                 contenteditable="false">[n]</span> (n from orderMap)
 *   [[table:id]]/[[figure:id]]  → atomic chip <span class="ms-asset" data-asset=…
 *                                 contenteditable="false">Table 2</span> (85.md B1;
 *                                 number from opts.assetNumbers, unknown → 'Table ?')
 *
 * Security: escape FIRST (same rule as the old mdToHtml) — user text is never
 * injected unescaped, link hrefs are scheme-whitelisted (http/https/mailto).
 *
 * Round-trip contract: htmlToMd(mdToHtml(md)) is IDEMPOTENT — canonical markdown
 * (blocks separated by blank lines, `- `/`1. ` markers, `---` separators) survives
 * a round trip byte-for-byte; non-canonical input converges after one pass.
 */

import { CITATION_TOKEN_RE } from '../../../research-engine/manuscript/citations.js';
import { ASSET_TOKEN_RE } from '../../../research-engine/manuscript/refTokens.js';

export const CITE_CHIP_CLASS = 'ms-cite';
export const ASSET_CHIP_CLASS = 'ms-asset';

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

/** Look a number up in a Map OR plain-object numbering map (resolveNumbering.byId). */
function assetNumberOf(assetNumbers, id) {
  if (!assetNumbers) return null;
  const n = typeof assetNumbers.get === 'function' ? assetNumbers.get(id) : assetNumbers[id];
  return n == null ? null : n;
}

/** Inline transforms over ALREADY-ESCAPED text. Chips first so a chip's [n] can
    never be re-parsed as a link; code before links/emphasis (verbatim spans). */
function inlineHtml(escText, orderMap, assetNumbers) {
  let t = escText;
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

/** Parse consecutive `| … |` lines into { header:[cells]|null, rows:[[cells]] }.
    Shared with the docx converter (works on raw OR escaped lines — `|` survives). */
export function parsePipeTable(lines) {
  const parseRow = (line) => {
    let s = String(line).trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  };
  const isSeparator = (cells) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
  const all = (lines || []).map(parseRow);
  if (all.length >= 2 && isSeparator(all[1])) return { header: all[0], rows: all.slice(2) };
  return { header: null, rows: all };
}

function tableHtml(escLines, orderMap, assetNumbers) {
  const { header, rows } = parsePipeTable(escLines);
  const cell = (tag, c) => `<${tag}>${inlineHtml(c, orderMap, assetNumbers)}</${tag}>`;
  const tr = (cells, tag) => `<tr>${cells.map((c) => cell(tag, c)).join('')}</tr>`;
  const parts = ['<table>'];
  if (header) parts.push(`<thead>${tr(header, 'th')}</thead>`);
  parts.push(`<tbody>${rows.map((r) => tr(r, 'td')).join('')}</tbody>`);
  parts.push('</table>');
  return parts.join('');
}

/**
 * Render the markdown subset to HTML. opts.orderMap: Map(citeId → 1-based n) for
 * cite-chip numbering (missing/absent → [?]). opts.assetNumbers: Map or plain
 * object (resolveNumbering.byId) for asset-chip labels (missing → 'Table ?').
 */
export function mdToHtml(md, opts = {}) {
  const orderMap = opts.orderMap || null;
  const assetNumbers = opts.assetNumbers || null;
  const esc = escapeHtml(md);
  if (!esc.trim()) return '';
  const lines = esc.split(/\r?\n/);
  const out = [];
  let list = null; // 'ul' | 'ol' | null
  let tableBuf = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushTable = () => { if (tableBuf) { out.push(tableHtml(tableBuf, orderMap, assetNumbers)); tableBuf = null; } };
  const inline = (s) => inlineHtml(s, orderMap, assetNumbers);
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
    if (n.attrs && n.attrs['data-cite']) { out += `[[cite:${String(n.attrs['data-cite']).replace(/[\]\s]/g, '')}]]`; continue; }
    if (n.attrs && n.attrs['data-asset'] != null) {
      // Asset chip → its stable token. Only a grammar-valid id round-trips; a
      // foreign/corrupt data-asset span degrades to its text content below.
      const id = String(n.attrs['data-asset']).replace(/[[\]\s]/g, '');
      if (/^(table|figure):[a-z0-9:-]+$/.test(id)) { out += `[[${id}]]`; continue; }
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

function tableRowsOf(node) {
  const rows = [];
  const walk = (n, inHead) => {
    for (const c of n.children || []) {
      if (c.text != null) continue;
      if (c.tag === 'tr') {
        const cells = [];
        let allTh = true;
        let any = false;
        for (const cell of c.children || []) {
          if (cell.text != null) continue;
          if (cell.tag === 'td' || cell.tag === 'th') {
            any = true;
            if (cell.tag !== 'th') allTh = false;
            // literal | inside a cell would break the pipe grammar → substitute
            cells.push(inlineOf(cell.children, { oneLine: true }).trim().replace(/\|/g, '/'));
          }
        }
        if (any) rows.push({ cells, header: inHead || allTh });
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
  const fmt = (cells) => `| ${cells.join(' | ')} |`;
  const lines = [];
  let body = rows;
  if (rows[0].header) {
    lines.push(fmt(rows[0].cells));
    lines.push(`| ${rows[0].cells.map(() => '---').join(' | ')} |`);
    body = rows.slice(1);
  }
  for (const r of body) lines.push(fmt(r.cells));
  blocks.push(lines.join('\n'));
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

export default { escapeHtml, mdToHtml, htmlToMd, citeChipHtml, assetChipHtml, parsePipeTable, extractOutline, stripInlineMd, CITE_CHIP_CLASS, ASSET_CHIP_CLASS };
