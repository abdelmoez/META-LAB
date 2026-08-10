/**
 * parseMarkdown.js — minimal, safe Markdown subset parser for website content.
 *
 * 111.md §35 — the repo ships no markdown dependency and rule 9 of the shared
 * engineering context forbids dangerouslySetInnerHTML. This module therefore
 * parses a deliberately small subset into a plain-object AST; the React
 * renderer (MarkdownContent.jsx) turns that AST into elements, so no author
 * string is ever interpreted as HTML.
 *
 * Supported block syntax:
 *   ## / ### / #### headings   (h1 is owned by the page shell, never by content)
 *   paragraphs (blank-line separated)
 *   - / * unordered lists, 1. ordered lists
 *   > blockquote
 *   --- horizontal rule
 *   ``` fenced code
 *
 * Supported inline syntax:
 *   **strong**, *em*, `code`, [text](href)
 *
 * Everything else — including any raw HTML — is carried through as literal
 * text and escaped by React at render time.
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Schemes a content link is allowed to use. Anything else renders as text. */
const SAFE_ABSOLUTE_RE = /^(https?:\/\/|mailto:)/i;

/**
 * True when the string contains an ASCII control character. Written as a
 * codepoint scan rather than a regex so the source file stays plain ASCII.
 */
function hasControlChar(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Returns the href if it is safe to emit, otherwise null.
 * Relative site paths ("/features/screening", "#faq") and http(s)/mailto are
 * allowed. javascript:, data:, vbscript:, protocol-relative "//evil.example"
 * and anything with a control character are rejected.
 */
export function sanitizeHref(raw) {
  if (typeof raw !== 'string') return null;
  const href = raw.trim();
  if (!href) return null;
  // Control characters are the classic "java<TAB>script:" bypass.
  if (hasControlChar(href)) return null;
  if (href.startsWith('//')) return null;
  if (href.startsWith('/') || href.startsWith('#')) return href;
  if (SAFE_ABSOLUTE_RE.test(href)) return href;
  return null;
}

/** Splits `---`-delimited YAML-ish frontmatter off the top of a document. */
export function parseFrontmatter(source) {
  const text = typeof source === 'string' ? source : '';
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { data: {}, body: text };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return { data, body: text.slice(match[0].length) };
}

function pushText(nodes, value) {
  if (!value) return;
  const last = nodes[nodes.length - 1];
  if (last && last.type === 'text') last.value += value;
  else nodes.push({ type: 'text', value });
}

/**
 * Parses inline markup into an inline-node array.
 * Unclosed markers degrade to literal text rather than swallowing the rest of
 * the line — a malformed article must never eat the page.
 */
export function parseInline(source) {
  const text = typeof source === 'string' ? source : '';
  const nodes = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '\\' && i + 1 < text.length) {
      pushText(nodes, text[i + 1]);
      i += 2;
      continue;
    }

    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        nodes.push({ type: 'code', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i + 1) {
        nodes.push({ type: 'strong', children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (ch === '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i + 1) {
        nodes.push({ type: 'em', children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '[') {
      const close = text.indexOf('](', i);
      if (close > i) {
        const paren = text.indexOf(')', close + 2);
        if (paren > close) {
          const label = text.slice(i + 1, close);
          const href = sanitizeHref(text.slice(close + 2, paren));
          if (href) {
            nodes.push({ type: 'link', href, children: parseInline(label) });
          } else {
            // Unsafe or empty target: keep the words, drop the link.
            for (const node of parseInline(label)) nodes.push(node);
          }
          i = paren + 1;
          continue;
        }
      }
    }

    pushText(nodes, ch);
    i += 1;
  }
  return nodes;
}

function flushParagraph(blocks, buffer) {
  if (!buffer.length) return;
  blocks.push({ type: 'paragraph', children: parseInline(buffer.join(' ')) });
  buffer.length = 0;
}

function flushList(blocks, list) {
  if (!list.items.length) return;
  blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
  list.items = [];
}

/** Parses a markdown body (frontmatter already stripped) into block nodes. */
export function parseBlocks(source) {
  const lines = String(source == null ? '' : source).split(/\r?\n/);
  const blocks = [];
  const para = [];
  const list = { ordered: false, items: [] };
  let fence = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');

    if (fence !== null) {
      if (/^\s*```/.test(line)) {
        blocks.push({ type: 'code', value: fence.join('\n') });
        fence = null;
      } else {
        fence.push(rawLine);
      }
      continue;
    }

    if (/^\s*```/.test(line)) {
      flushParagraph(blocks, para);
      flushList(blocks, list);
      fence = [];
      continue;
    }

    if (!line.trim()) {
      flushParagraph(blocks, para);
      flushList(blocks, list);
      continue;
    }

    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(blocks, para);
      flushList(blocks, list);
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2].trim()),
      });
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushParagraph(blocks, para);
      flushList(blocks, list);
      blocks.push({ type: 'hr' });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph(blocks, para);
      flushList(blocks, list);
      blocks.push({ type: 'quote', children: parseInline(quote[1]) });
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph(blocks, para);
      const ordered = Boolean(numbered);
      if (list.items.length && list.ordered !== ordered) flushList(blocks, list);
      list.ordered = ordered;
      list.items.push((bullet || numbered)[1]);
      continue;
    }

    flushList(blocks, list);
    para.push(line.trim());
  }

  if (fence !== null) blocks.push({ type: 'code', value: fence.join('\n') });
  flushParagraph(blocks, para);
  flushList(blocks, list);
  return blocks;
}

/** Full parse: frontmatter + block AST. */
export function parseMarkdown(source) {
  const { data, body } = parseFrontmatter(source);
  return { frontmatter: data, blocks: parseBlocks(body) };
}

/**
 * Collects the h2/h3 headings of a parsed document as plain strings.
 * Used to build on-page tables of contents and to assert content shape in
 * tests without re-parsing rendered markup.
 */
export function headingOutline(blocks) {
  const out = [];
  for (const block of blocks || []) {
    if (block.type !== 'heading') continue;
    out.push({ level: block.level, text: inlineText(block.children) });
  }
  return out;
}

/** Flattens inline nodes back to their visible text. */
export function inlineText(nodes) {
  let out = '';
  for (const node of nodes || []) {
    if (node.type === 'text') out += node.value;
    else if (node.type === 'code') out += node.value;
    else if (node.children) out += inlineText(node.children);
  }
  return out;
}

/** Stable slug for heading anchors (deterministic — safe during prerender). */
export function slugify(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

export default parseMarkdown;
