/**
 * features/manuscript/writingAssistant/waHighlights.js — 120.md §6, Wave 4b
 * "Visual presentation".
 *
 * THE ONE RULE THIS MODULE EXISTS TO HOLD: nothing is ever inserted into the editor
 * DOM. Not a `<span>`, not an attribute, not a text node. The manuscript IS the DOM
 * here — RichSectionEditor serializes the editor root's own markup through htmlToMd
 * on every input — so a `<span class="wa-spelling">` around a misspelled word would
 * end up in the autosave, in the Word export and in the researcher's submitted paper.
 *
 * The CSS Custom Highlight API is the only decoration mechanism that satisfies that.
 * `new Highlight(...ranges)` + `CSS.highlights.set(name, hl)` paints ranges from a
 * SIDE REGISTRY the DOM knows nothing about; `::highlight(wa-spelling)` styles them.
 * Verified available in all three installed Playwright engines (Chromium 149,
 * Firefox 151, WebKit 26.5). Where it is absent the feature DEGRADES: the issue list,
 * the counts, next/previous navigation and every correction still work — only the
 * underlines are missing. `highlightsSupported()` is the single feature detect.
 *
 * ── HOW AN ISSUE OFFSET BECOMES A DOM RANGE ────────────────────────────────────
 * The engine reports (blockIndex, start, end) in MARKDOWN space, over the block's
 * same-length `checkText` mask (engine/blocks.js). The DOM is what mdToHtml made of
 * that markdown, and the two do not share an offset space: `[[cite:s1]]` is 11
 * markdown characters and a contenteditable=false chip in the DOM, `**bold**` is 8
 * characters and 4, a `## ` heading prefix is 3 characters and none at all.
 *
 * So resolution is two steps, and the second one is what makes it safe:
 *   1. PROJECT the markdown block to the plain text mdToHtml would have produced
 *      (`projectBlock`), giving an approximate index for the issue.
 *   2. SEARCH the block element's own text for `issue.original` and take the
 *      occurrence nearest that index, then VERIFY the resolved range stringifies to
 *      exactly `issue.original`. A range that does not verify is discarded — the
 *      issue keeps its place in the list and its navigation entry, and simply gets
 *      no underline.
 * The verification is why an imperfect projection is harmless: the worst case is
 * underlining a DIFFERENT occurrence of the identical misspelling in the same block,
 * which corrects to the identical text.
 *
 * PRIVACY (§6): pure DOM/geometry work. No network, no storage, no logging of text.
 */

import { BLOCK_KIND } from './engine/blocks.js';
import { DECORATION_GROUPS } from './engine/issueModel.js';

/* ── the four highlight registrations (engine/issueModel.js DECORATION_GROUPS) ── */

export const WA_HIGHLIGHT_NAME = Object.freeze({
  spelling: 'wa-spelling',
  grammar: 'wa-grammar',
  terminology: 'wa-terminology',
  style: 'wa-style',
});

export const WA_HIGHLIGHT_NAMES = Object.freeze(
  DECORATION_GROUPS.map((g) => WA_HIGHLIGHT_NAME[g]),
);

/**
 * 120.md §6 "Use distinct color and/or underline patterns for categories. Do not rely
 * on color alone." Every group therefore gets a distinct DECORATION STYLE as well as
 * a distinct hue — wavy · dotted · dashed · solid — so the four are told apart in
 * greyscale, at low contrast and by a colour-blind reader. The accessible NAME of the
 * issue is carried by the suggestion card and the issue list, not by the pixels.
 *
 * The colours are literals rather than theme tokens for the same reason
 * RICH_EDITOR_CSS's ink is: `.ms-paper` is a LITERAL white page in both themes, so a
 * token that flips with the theme would be unreadable in one of them. Contrast on
 * #ffffff: #c62828 5.68:1 · #1d4ed8 6.94:1 · #6b21a8 8.13:1 · #a16207 4.52:1.
 *
 * `text-decoration-skip-ink:none` keeps the wave continuous under descenders, and
 * `text-underline-offset` lifts it off the baseline so it never reads as a strike.
 */
export const WA_HIGHLIGHT_CSS = `
::highlight(wa-spelling){text-decoration:underline wavy #c62828;text-decoration-thickness:1.5px;
  text-underline-offset:2px;text-decoration-skip-ink:none;}
::highlight(wa-grammar){text-decoration:underline dotted #1d4ed8;text-decoration-thickness:2px;
  text-underline-offset:2px;text-decoration-skip-ink:none;}
::highlight(wa-terminology){text-decoration:underline dashed #6b21a8;text-decoration-thickness:1.5px;
  text-underline-offset:2px;text-decoration-skip-ink:none;}
::highlight(wa-style){text-decoration:underline solid #a16207;text-decoration-thickness:1.5px;
  text-underline-offset:3px;text-decoration-skip-ink:none;}
`;

/** 120.md §6 — the feature detect. Absent → no underlines, everything else works. */
export function highlightsSupported() {
  return typeof CSS !== 'undefined'
    && !!CSS.highlights
    && typeof Highlight !== 'undefined';
}

/* ── markdown → plain-text projection (pure) ──────────────────────────────────── */

const HEADING_PREFIX_RE = /^(#{1,6}\s+)/;
const BULLET_PREFIX_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)/;
const TOKEN_RE = /\[\[[^\]\n]*\]\]/g;
const CODE_RE = /`([^`\n]*)`/g;
const LINK_RE = /\[([^\]\n]*)\]\((?:https?:\/\/|mailto:)[^)\s]*(?:\s+"[^"]*")?\)/gi;
const STRONG_EM_RE = /\*\*\*([^*]+)\*\*\*/g;
const STRONG_RE = /\*\*((?:[^*]|\*(?!\*))+?)\*\*/g;
const EM_RE = /\*([^*\n]+)\*/g;

/**
 * The plain text mdToHtml would render for one block line, with an index map back to
 * markdown offsets. Mirrors inlineHtml's transformations in the same order:
 * `[[token]]` chips vanish (they become contenteditable=false islands the DOM walk
 * skips), code fences lose their backticks, a markdown link keeps only its label, and
 * emphasis markers disappear.
 *
 * @param {string} text  the block's raw markdown line
 * @param {string} kind  engine/blocks.js BLOCK_KIND
 * @returns {{plain:string, map:number[]}} `map[i]` is the markdown offset of plain[i]
 */
export function projectBlock(text, kind) {
  const src = String(text ?? '');
  // Start with an identity projection, then delete spans from it. Deleting keeps the
  // surviving characters' original offsets, which is the whole point of the map.
  let chars = [...src].map((ch, i) => ({ ch, at: i }));

  const dropRanges = (ranges) => {
    if (!ranges.length) return;
    const drop = new Set();
    for (const [s, e] of ranges) for (let i = s; i < e; i += 1) drop.add(i);
    chars = chars.filter((c) => !drop.has(c.at));
  };

  const scan = (re, pick) => {
    const ranges = [];
    re.lastIndex = 0;
    let m = re.exec(src);
    while (m) {
      ranges.push(...pick(m));
      m = re.exec(src);
    }
    dropRanges(ranges);
  };

  // Block-level prefixes: `## `, `- `, `1. ` are grammar, not prose.
  if (kind === BLOCK_KIND.HEADING) {
    const m = HEADING_PREFIX_RE.exec(src);
    if (m) dropRanges([[0, m[1].length]]);
  } else if (kind === BLOCK_KIND.LIST_ITEM) {
    const m = BULLET_PREFIX_RE.exec(src);
    if (m) dropRanges([[0, m[1].length]]);
  }

  // `[[cite:…]]`, `[[table:…]]`, `[[fact:…]]`, `[[tblcap:…]]`, `[[figcap:…]]` — every
  // one renders as an island the DOM walk skips, so both sides contribute nothing.
  scan(TOKEN_RE, (m) => [[m.index, m.index + m[0].length]]);
  // `` `x` `` → x
  scan(CODE_RE, (m) => [[m.index, m.index + 1], [m.index + m[0].length - 1, m.index + m[0].length]]);
  // `[label](https://…)` → label
  scan(LINK_RE, (m) => [
    [m.index, m.index + 1],
    [m.index + 1 + m[1].length, m.index + m[0].length],
  ]);
  scan(STRONG_EM_RE, (m) => [[m.index, m.index + 3], [m.index + m[0].length - 3, m.index + m[0].length]]);
  scan(STRONG_RE, (m) => [[m.index, m.index + 2], [m.index + m[0].length - 2, m.index + m[0].length]]);
  scan(EM_RE, (m) => [[m.index, m.index + 1], [m.index + m[0].length - 1, m.index + m[0].length]]);

  return { plain: chars.map((c) => c.ch).join(''), map: chars.map((c) => c.at) };
}

/** Where the issue's markdown span lands in the projected plain text. */
export function projectOffset(projection, mdOffset) {
  const { map } = projection;
  for (let i = 0; i < map.length; i += 1) if (map[i] >= mdOffset) return i;
  return map.length;
}

/**
 * The cells of a pipe-table row, as markdown spans, matching mdDom's parsePipeTable
 * (leading/trailing border pipes dropped, `\|` is a literal, cells trimmed).
 * A table-row issue is resolved inside ONE cell's `<td>`/`<th>`, because the row
 * element's own text is the cells concatenated with no delimiter.
 */
export function cellSpans(line) {
  const src = String(line ?? '');
  const trimmedStart = src.length - src.trimStart().length;
  let s = src.trim();
  let base = trimmedStart;
  if (s.startsWith('|')) { s = s.slice(1); base += 1; }
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const spans = [];
  let cellStart = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\' && s[i + 1] === '|') { i += 1; continue; }
    if (s[i] !== '|') continue;
    spans.push([base + cellStart, base + i]);
    cellStart = i + 1;
  }
  spans.push([base + cellStart, base + s.length]);
  // Trim each cell the way parsePipeTable does, so the span covers exactly the text
  // the DOM cell holds.
  return spans.map(([a, b]) => {
    const raw = src.slice(a, b);
    const lead = raw.length - raw.trimStart().length;
    const tail = raw.length - raw.trimEnd().length;
    return [a + lead, b - tail];
  });
}

/* ── block index → DOM nodes (pure over a duck-typed tree) ───────────────────── */

/**
 * The tags htmlToMd treats as BLOCK boundaries (mdDom.js BLOCK_TAGS, verbatim).
 * Everything else — a text node, `<strong>`, `<code>`, `<a>`, `<br>`, a chip span —
 * is INLINE and joins the run around it. Mirroring this exactly is what makes the
 * plan below agree with the markdown splitBlocks() was given, which is the whole
 * problem: the editor's live DOM is not mdToHtml's output any more the moment
 * somebody presses Enter (Chromium inserts `<div>`, WebKit and Firefox differ again).
 */
const BLOCK_TAGS = new Set([
  'html', 'body', 'main', 'aside', 'nav', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'figure',
  'figcaption', 'hr', 'form', 'fieldset',
]);

const DROP_TAGS = new Set(['script', 'style', 'noscript', 'template']);

const isElement = (n) => !!n && n.nodeType === 1;
const isText = (n) => !!n && n.nodeType === 3;
const tagOf = (n) => (isElement(n) ? String(n.tagName || '').toLowerCase() : '');
const classOf = (n) => String((n && n.className) || '');
const kidsOf = (n) => Array.from((n && n.childNodes) || []);
const elementKids = (n) => kidsOf(n).filter(isElement);
const textOf = (n) => String((n && n.textContent) || '');
const attrOf = (n, name) => (isElement(n) && n.getAttribute ? n.getAttribute(name) : null);
/** Does this element itself contain a block child? (mdDom's hasBlockChild). */
const hasBlockChild = (n) => elementKids(n).some((c) => BLOCK_TAGS.has(tagOf(c)));

const findByClass = (parent, cls) => elementKids(parent).find((c) => new RegExp(`\\b${cls}\\b`).test(classOf(c)));

/**
 * Pair each block of the committed markdown with the DOM NODES that render it.
 *
 * A target is a LIST of nodes, not a single element, because htmlToMd's own grammar
 * groups a RUN of inline nodes into one block: `hello <strong>there</strong>` sitting
 * directly under the editor root is one markdown line made of three sibling nodes.
 *
 * The walk mirrors htmlToMd's `walkBlocks`/`emitBlock` step for step, so the block a
 * target claims is the block that text actually serializes into.
 *
 * Deliberately CONSERVATIVE: the moment the DOM's shape disagrees with the blocks it
 * would consume, the walk stops and returns what it resolved so far. A partial plan
 * means some issues get no underline; a WRONG plan would underline the wrong words,
 * which is worse than none.
 *
 * @returns {Array<{blockIndex:number, nodes:Node[], cell:number|null}>}
 */
export function planBlockTargets(root, blocks) {
  const out = [];
  const list = blocks || [];
  let bi = 0;
  let bailed = false;

  const peek = () => list[bi];
  /** Take the next block if it is one of `kinds`; otherwise bail out of the walk. */
  const take = (kinds) => {
    const b = peek();
    if (!b || !kinds.includes(b.kind)) { bailed = true; return null; }
    bi += 1;
    return b;
  };

  const emit = (el) => {
    if (bailed) return;
    const tag = tagOf(el);
    if (DROP_TAGS.has(tag) || tag === 'hr') return;

    // The caption islands: one block, and only the TITLE span is editable prose.
    if (attrOf(el, 'data-tblcap') != null || attrOf(el, 'data-figcap') != null) {
      const b = take([BLOCK_KIND.CAPTION_TITLE]);
      if (!b) return;
      const cap = tag === 'figure'
        ? elementKids(el).find((c) => tagOf(c) === 'figcaption')
        : el;
      const title = cap && (findByClass(cap, 'ms-tblcap-t') || findByClass(cap, 'ms-figcap-t'));
      if (title) out.push({ blockIndex: b.index, nodes: [title], cell: null });
      return;
    }

    if (/^h[1-6]$/.test(tag)) {
      if (!textOf(el).trim()) return;               // htmlToMd emits nothing for it
      const b = take([BLOCK_KIND.HEADING]);
      if (!b) return;
      out.push({ blockIndex: b.index, nodes: [el], cell: null });
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      for (const li of elementKids(el)) {
        if (tagOf(li) !== 'li' || !textOf(li).trim()) continue;
        const b = take([BLOCK_KIND.LIST_ITEM]);
        if (!b) return;
        out.push({ blockIndex: b.index, nodes: [li], cell: null });
      }
      return;
    }

    if (tag === 'li') {
      if (!textOf(el).trim()) return;
      const b = take([BLOCK_KIND.LIST_ITEM]);
      if (!b) return;
      out.push({ blockIndex: b.index, nodes: [el], cell: null });
      return;
    }

    if (tag === 'table') {
      const rows = [];
      for (const part of elementKids(el)) {
        if (tagOf(part) === 'tr') rows.push(part);
        else for (const tr of elementKids(part)) if (tagOf(tr) === 'tr') rows.push(tr);
      }
      for (let r = 0; r < rows.length; r += 1) {
        const b = take([BLOCK_KIND.TABLE_ROW]);
        if (!b) return;
        const cells = elementKids(rows[r]).filter((c) => tagOf(c) === 'td' || tagOf(c) === 'th');
        cells.forEach((cellEl, ci) => out.push({ blockIndex: b.index, nodes: [cellEl], cell: ci }));
        // The `| --- |` line follows the HEADER row and renders as nothing.
        if (r === 0 && peek() && peek().kind === BLOCK_KIND.SEPARATOR) bi += 1;
      }
      return;
    }

    if (tag === 'pre' || tag === 'blockquote') {
      if (!textOf(el).trim()) return;
      const b = take([BLOCK_KIND.PARAGRAPH, BLOCK_KIND.CODE, BLOCK_KIND.REFERENCE_ENTRY]);
      if (!b) return;
      out.push({ blockIndex: b.index, nodes: [el], cell: null });
      return;
    }

    // A container (`<div>`, `<section>`, the editor root's own wrappers) whose
    // children are themselves blocks contributes nothing of its own.
    if (hasBlockChild(el)) { walk(el); return; }

    if (!textOf(el).trim()) return;                 // `<p><br></p>` — no block at all
    const b = take([BLOCK_KIND.PARAGRAPH, BLOCK_KIND.REFERENCE_ENTRY, BLOCK_KIND.CAPTION_TITLE, BLOCK_KIND.HEADING, BLOCK_KIND.LIST_ITEM, BLOCK_KIND.TABLE_ROW]);
    if (!b) return;
    out.push({ blockIndex: b.index, nodes: [el], cell: null });
  };

  function walk(parent) {
    if (bailed) return;
    let run = [];
    const flush = () => {
      const nodes = run;
      run = [];
      if (bailed || !nodes.length) return;
      if (!nodes.map(textOf).join('').trim()) return;   // whitespace-only run → no block
      const b = take([BLOCK_KIND.PARAGRAPH, BLOCK_KIND.REFERENCE_ENTRY, BLOCK_KIND.HEADING, BLOCK_KIND.LIST_ITEM, BLOCK_KIND.TABLE_ROW, BLOCK_KIND.CAPTION_TITLE]);
      if (!b) return;
      out.push({ blockIndex: b.index, nodes, cell: null });
    };
    for (const n of kidsOf(parent)) {
      if (bailed) return;
      if (isText(n) || !BLOCK_TAGS.has(tagOf(n))) { run.push(n); continue; }
      flush();
      emit(n);
    }
    flush();
  }

  if (!root) return out;
  walk(root);
  return out;
}

/* ── DOM text walking (needs a real DOM; kept tiny and dependency-injected) ───── */

const NBSP_RE = / /g;

/**
 * The text nodes of `node` that carry EDITABLE PROSE, in document order, skipping
 * `contenteditable="false"` islands (citation / cross-reference / fact / input
 * chips). The markdown projection deletes those islands' `[[token]]` source, so both
 * sides agree that an island contributes zero characters.
 */
export function proseTextNodes(node) {
  if (!node) return [];
  if (isText(node)) return [node];
  const doc = node.ownerDocument;
  if (!doc || typeof doc.createTreeWalker !== 'function') return [];
  const walker = doc.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */, {
    acceptNode(candidate) {
      let p = candidate.parentNode;
      while (p && p !== node) {
        if (p.nodeType === 1 && p.getAttribute && p.getAttribute('contenteditable') === 'false') {
          return 2; // NodeFilter.FILTER_REJECT
        }
        p = p.parentNode;
      }
      return 1; // NodeFilter.FILTER_ACCEPT
    },
  });
  const out = [];
  let n = walker.nextNode();
  while (n) { out.push(n); n = walker.nextNode(); }
  return out;
}

/** The concatenated prose text of a target's nodes, plus the index to slice it by. */
function proseText(nodes) {
  let text = '';
  const spans = [];
  for (const owner of nodes || []) {
    // An island at the TOP of a run (a chip typed at the start of a line) is skipped
    // here for the same reason it is skipped inside an element.
    if (isElement(owner) && owner.getAttribute && owner.getAttribute('contenteditable') === 'false') continue;
    for (const tn of proseTextNodes(owner)) {
      const t = String(tn.nodeValue || '').replace(NBSP_RE, ' ');
      spans.push({ node: tn, start: text.length, end: text.length + t.length });
      text += t;
    }
  }
  return { text, spans };
}

/** Turn a [start,end) offset in that concatenated text into a live Range. */
function rangeAt(doc, spans, start, end) {
  let s = null;
  let e = null;
  for (const span of spans) {
    if (s === null && start >= span.start && start < span.end) s = { node: span.node, offset: start - span.start };
    if (end > span.start && end <= span.end) { e = { node: span.node, offset: end - span.start }; break; }
  }
  if (!s || !e) return null;
  const range = doc.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  return range;
}

/** All indices of `needle` in `hay`. */
function occurrences(hay, needle) {
  const hits = [];
  if (!needle) return hits;
  let at = hay.indexOf(needle);
  while (at >= 0) { hits.push(at); at = hay.indexOf(needle, at + 1); }
  return hits;
}

/**
 * Resolve one issue to a live DOM Range inside its target.
 *
 * The nearest-occurrence search plus the exact-string verification is what makes this
 * safe in the presence of an imperfect markdown projection: the returned range ALWAYS
 * stringifies to `issue.original`, or the function returns null and the issue simply
 * goes undecorated (it keeps its place in the list and its navigation entry).
 */
export function resolveIssueRange(target, block, issue) {
  if (!target || !target.nodes || !target.nodes.length || !block || !issue) return null;
  const first = target.nodes[0];
  const doc = first && first.ownerDocument;
  if (!doc || typeof doc.createRange !== 'function') return null;

  // A table-row issue belongs to exactly one cell; anything outside this cell's span
  // is another cell's problem.
  let mdText = block.text;
  let mdStart = issue.start;
  if (block.kind === BLOCK_KIND.TABLE_ROW && target.cell != null) {
    const span = cellSpans(block.text)[target.cell];
    if (!span) return null;
    if (issue.start < span[0] || issue.end > span[1]) return null;
    mdText = block.text.slice(span[0], span[1]);
    mdStart = issue.start - span[0];
  } else if (block.kind === BLOCK_KIND.CAPTION_TITLE) {
    // The caption ISLAND holds `[[tblcap:id]] Title`; the editable span holds only
    // the title, so the marker and the space after it are not in the DOM at all.
    const marker = /^\s*\[\[[^\]\n]*\]\]\s*/.exec(block.text);
    const skip = marker ? marker[0].length : 0;
    if (issue.start < skip) return null;
    mdText = block.text.slice(skip);
    mdStart = issue.start - skip;
  }

  const projection = projectBlock(
    mdText,
    block.kind === BLOCK_KIND.TABLE_ROW ? BLOCK_KIND.PARAGRAPH : block.kind,
  );
  const approx = projectOffset(projection, mdStart);
  const { text, spans } = proseText(target.nodes);
  const original = String(issue.original || '').replace(NBSP_RE, ' ');
  if (!original) return null;

  const hits = occurrences(text, original);
  if (!hits.length) return null;
  let best = hits[0];
  for (const hit of hits) if (Math.abs(hit - approx) < Math.abs(best - approx)) best = hit;

  const range = rangeAt(doc, spans, best, best + original.length);
  if (!range) return null;
  // THE GUARANTEE. A range that does not read back as the issue's own text is thrown
  // away — 120.md §6 "Verify that the original text still matches".
  if (String(range.toString()).replace(NBSP_RE, ' ') !== original) return null;
  return range;
}

/**
 * Anchor every issue of one section into its editor root.
 *
 * @returns {{byGroup:Object<string,Range[]>, byIssue:Map<string,Range>, resolved:number, missed:number}}
 */
export function anchorSection(root, blocks, issues) {
  const byGroup = {};
  for (const g of DECORATION_GROUPS) byGroup[g] = [];
  const byIssue = new Map();
  let missed = 0;
  if (!root || !blocks || !issues || !issues.length) {
    return { byGroup, byIssue, resolved: 0, missed: 0 };
  }
  const targets = planBlockTargets(root, blocks);
  const byBlock = new Map();
  for (const t of targets) {
    if (!byBlock.has(t.blockIndex)) byBlock.set(t.blockIndex, []);
    byBlock.get(t.blockIndex).push(t);
  }
  const blockByIndex = new Map(blocks.map((b) => [b.index, b]));

  for (const issue of issues) {
    const block = blockByIndex.get(issue.blockIndex);
    const candidates = byBlock.get(issue.blockIndex) || [];
    let range = null;
    for (const target of candidates) {
      range = resolveIssueRange(target, block, issue);
      if (range) break;
    }
    if (!range) { missed += 1; continue; }
    byIssue.set(issue.id, range);
    (byGroup[issue.group] || byGroup.style).push(range);
  }
  return { byGroup, byIssue, resolved: byIssue.size, missed };
}

/* ── the registry (imperative, one per app) ───────────────────────────────────── */

/**
 * One highlight registration per GROUP, unioned across every mounted editor.
 *
 * Continuous View mounts one editor per section; `CSS.highlights` is a single global
 * registry, so the controller keeps ranges per section and rebuilds the four
 * Highlight objects whenever any section changes. Cheap: the objects are rebuilt from
 * arrays that already exist, and the whole flush is O(total issues).
 */
export function createHighlightController() {
  const sections = new Map(); // sectionId → { byGroup, byIssue }
  let installed = false;

  const flush = () => {
    if (!highlightsSupported()) return;
    const union = {};
    for (const g of DECORATION_GROUPS) union[g] = [];
    for (const entry of sections.values()) {
      for (const g of DECORATION_GROUPS) union[g].push(...(entry.byGroup[g] || []));
    }
    for (const g of DECORATION_GROUPS) {
      const name = WA_HIGHLIGHT_NAME[g];
      if (!union[g].length) { CSS.highlights.delete(name); continue; }
      // eslint-disable-next-line no-undef
      CSS.highlights.set(name, new Highlight(...union[g]));
      installed = true;
    }
    if (!Object.values(union).some((r) => r.length) && installed) installed = false;
  };

  return {
    /** Replace one section's decorations. `anchored` comes from anchorSection(). */
    set(sectionId, anchored) {
      sections.set(sectionId, anchored);
      flush();
    },
    clear(sectionId) {
      if (sections.delete(sectionId)) flush();
    },
    /** Remove every registration this feature owns — used when the user turns it off. */
    dispose() {
      sections.clear();
      if (!highlightsSupported()) return;
      for (const name of WA_HIGHLIGHT_NAMES) CSS.highlights.delete(name);
      installed = false;
    },
    rangeFor(sectionId, issueId) {
      const entry = sections.get(sectionId);
      return (entry && entry.byIssue.get(issueId)) || null;
    },
    /** Diagnostics for the e2e spec and the performance report. */
    stats() {
      let resolved = 0;
      let missed = 0;
      for (const e of sections.values()) { resolved += e.resolved; missed += e.missed; }
      return { sections: sections.size, resolved, missed };
    },
  };
}
