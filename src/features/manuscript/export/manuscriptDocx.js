/**
 * features/manuscript/export/manuscriptDocx.js — 64.md (P3), rewritten for 85.md
 * Objective 2 (B2). One-click, REAL .docx manuscript export (Office Open XML via
 * the `docx` library — NOT HTML renamed). Runs entirely CLIENT-side
 * (Packer.toBlob) so it never loads the server.
 *
 * 85.md placement-aware assembly:
 *   - Tables/figures are ASSETS (research-engine/manuscript/assets.js). Structured
 *     `[[table:…]]` / `[[figure:…]]` tokens in the prose resolve to live numbers
 *     ("Table 2") rendered as InternalHyperlinks to a Bookmark on the asset's
 *     caption; the asset object itself is spliced AFTER the block containing its
 *     first body mention (computePlacements — whole lists/pipe tables are never
 *     split, so Word list numbering instances stay intact).
 *   - Assets never referenced in the text keep the legacy end-of-document
 *     "Tables"/"Figures" sections with the SAME caption/bookmark treatment, so a
 *     token-less legacy draft exports ≈ byte-comparable to before, plus captions,
 *     alt text and honest numbering.
 *   - Figures are RASTER-ONLY (PNG) in v1: Word's SVG renderer handles our
 *     <marker>/glyph constructs unreliably (critique #5), so we rasterize at
 *     ≥300 dpi effective (2200px forest/funnel, 1800px PRISMA/RoB source width at
 *     600/560px display width) and attach altText instead.
 *
 * The `docx` import is dynamic so the library is code-split out of the main bundle
 * (the whole manuscript editor is behind the OFF-by-default `manuscriptEditor` flag).
 */
import {
  computePrismaCounts,
  buildStudyCharacteristicsTable,
  buildSummaryOfFindingsTable,
  buildPrismaCountsTable,
  buildRobTable,
  buildSearchStrategyTable,
  generateReferenceList,
  orderReferencesForManuscript,
  collectCitationOrder,
  draftSectionTexts,
  renderInlineMarkers,
  primaryAnalysis,
  allAnalyses,
  computeManuscriptAssets,
  resolveNumbering,
  computePlacements,
  sectionBlocks,
} from '../../../research-engine/manuscript/index.js';
import { SECTION_TYPES, STATEMENT_TYPES } from '../../../research-engine/manuscript/model.js';
// 117.md §69 — the kind set, the caption grammar and the caption FORMATTER all come
// from the one registry, so the Word file and the editor can never disagree about
// what a construct is or how a caption reads.
import {
  ASSET_KIND_ALTERNATION, TABLE_CAPTION_LINE_RE, TABLE_CAPTION_TOKEN_RE,
  formatAssetLabel, formatAssetCaption,
} from '../../../research-engine/manuscript/refTokens.js';
// 117.md §26/§32 — the ONE reference resolver seam (see its module header).
import { resolveReferenceLibrary } from '../../../research-engine/manuscript/referenceLibrary.js';
import { parsePipeTable } from '../richEditor/mdDom.js';
import { forestPng, prismaPng, funnelPng, robPng } from './figures.js';

const AI_DISCLAIMER = 'Auto-draft — verify all content, numbers, and citations against your extracted data before submission.';

/** Numbering reference for markdown ordered lists (defined once on the Document). */
export const MD_OL_REF = 'md-ordered-list';

/** Usable portrait content width (Letter/A4, 1in margins) in DXA. */
const TOTAL_TABLE_DXA = 9360;

async function blobToU8(blob) {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/* ── asset bookmark anchors ────────────────────────────────────────────────────
   Word bookmark names: start with a letter, no spaces, ≤40 chars. Asset ids are
   [a-z0-9:-]; slug + dedupe so truncation can never alias two assets. */
export function buildAnchors(assets) {
  const anchors = {};
  const used = new Set();
  for (const a of (assets || [])) {
    const base = `ref_${String(a.id).replace(/[^a-zA-Z0-9]+/g, '_')}`.slice(0, 38);
    let name = base;
    let i = 2;
    while (used.has(name)) name = `${base.slice(0, 35)}_${i++}`;
    used.add(name);
    anchors[a.id] = name;
    // Alias ids (e.g. 'figure:forest-primary') hyperlink to the SAME bookmark.
    for (const al of (a.aliasIds || [])) if (!anchors[al]) anchors[al] = name;
  }
  return anchors;
}

/* ── markdown (WYSIWYG subset, 65.md MS-4) → docx runs/paragraphs — kept
      symmetric with richEditor/mdDom.js so the editor and the export can never
      disagree on what a construct means. `ictx` (optional inline context) carries
      the asset numbering + bookmark registry: { numbers, anchors }. ──────────── */
function parseInline(text, D, base = {}, ictx = null) {
  const { TextRun, ExternalHyperlink, InternalHyperlink } = D;
  const runs = [];
  const plain = (t, extra = {}) => { if (t) runs.push(new TextRun({ text: t, ...base, ...extra })); };
  // One asset-token cross-reference run: "Table 2" as an InternalHyperlink to the
  // asset's caption bookmark; unresolved/unnumbered → plain "Table ?" (never a
  // raw token leak). `extra` carries the surrounding format (bold/italic/code) so
  // a token inside emphasis renders formatted, not as literal [[…]] text.
  // Cross-reference text stays visually plain — Word's own cross-refs are
  // unstyled, and a blue underline would read as a web link.
  const assetRef = (kind, suffix, extra = {}) => {
    const id = `${kind}:${suffix}`;
    const n = ictx && ictx.numbers ? ictx.numbers[id] : null;
    const label = formatAssetLabel(kind, n, { templateId: ictx && ictx.templateId });
    const anchor = (n != null && ictx && ictx.anchors) ? ictx.anchors[id] : null;
    if (anchor && InternalHyperlink) {
      runs.push(new InternalHyperlink({ anchor, children: [new TextRun({ text: label, ...base, ...extra })] }));
    } else plain(label, extra);
  };
  // Formatted-segment emitter: pre-split on asset tokens so a token inside
  // **bold** / *italic* / `code` still resolves (the outer alternation consumes
  // the whole emphasis span before the token alternative can match).
  const emit = (t, extra = {}) => {
    // A caption marker is a BLOCK grammar (markdownToParagraphs owns it); one that
    // reaches an inline run is malformed, so it drops rather than leaking `[[…]]`.
    const str = String(t == null ? '' : t).replace(new RegExp(TABLE_CAPTION_TOKEN_RE.source, 'g'), '');
    const tre = new RegExp(`\\[\\[(${ASSET_KIND_ALTERNATION}):([a-z0-9:-]+)\\]\\]`, 'g');
    let l = 0;
    let tm;
    while ((tm = tre.exec(str)) !== null) {
      if (tm.index > l) plain(str.slice(l, tm.index), extra);
      assetRef(tm[1], tm[2], extra);
      l = tre.lastIndex;
    }
    if (l < str.length) plain(str.slice(l), extra);
  };
  // Asset tokens FIRST in the alternation so they can never be re-parsed as links.
  const re = new RegExp(`(\\[\\[(?:${ASSET_KIND_ALTERNATION}):[a-z0-9:-]+\\]\\]`
    + '|\\*\\*\\*[^*]+\\*\\*\\*|\\*\\*(?:[^*]|\\*(?!\\*))+?\\*\\*|\\*[^*]+\\*|`[^`]+`'
    + '|\\[[^\\]]*\\]\\((?:https?:\\/\\/|mailto:)[^)\\s]+\\))', 'g');
  let last = 0;
  let m;
  const s = String(text == null ? '' : text).replace(new RegExp(TABLE_CAPTION_TOKEN_RE.source, 'g'), '');
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) plain(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('[[')) {
      const am = tok.match(new RegExp(`^\\[\\[(${ASSET_KIND_ALTERNATION}):([a-z0-9:-]+)\\]\\]$`));
      assetRef(am[1], am[2]);
    } else if (tok.startsWith('***')) emit(tok.slice(3, -3), { bold: true, italics: true });
    else if (tok.startsWith('**')) {
      // bold segment may contain *italic* runs: **a *b* c**
      const inner = tok.slice(2, -2);
      const ire = /\*([^*]+)\*/g;
      let il = 0;
      let im;
      while ((im = ire.exec(inner)) !== null) {
        if (im.index > il) emit(inner.slice(il, im.index), { bold: true });
        emit(im[1], { bold: true, italics: true });
        il = ire.lastIndex;
      }
      if (il < inner.length) emit(inner.slice(il), { bold: true });
    } else if (tok.startsWith('`')) emit(tok.slice(1, -1), { font: 'Consolas' });
    else if (tok.startsWith('[')) {
      const lm = tok.match(/^\[([^\]]*)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)$/);
      if (lm && ExternalHyperlink) {
        runs.push(new ExternalHyperlink({
          link: lm[2],
          children: [new TextRun({ text: lm[1] || lm[2], ...base, color: '0563C1', underline: {} })],
        }));
      } else if (lm) plain(`${lm[1] || lm[2]} (${lm[2]})`);
      else plain(tok);
    } else emit(tok.slice(1, -1), { italics: true });
    last = re.lastIndex;
  }
  if (last < s.length) plain(s.slice(last));
  if (!runs.length) runs.push(new TextRun({ text: '', ...base }));
  return runs;
}

/** Pipe-table markdown → a real docx Table (same look as the data tables).
    116.md §65 — parsePipeTable is SHARED with the editor, so the `\|` literal-
    pipe escape and the `:---:` alignment colons behave identically on screen and
    in Word: alignment maps to the cell paragraph's w:jc, escaped pipes arrive as
    literal '|' cell text. */
function mdTableToDocx(lines, D, ictx) {
  const { Table, TableRow, TableCell, Paragraph, WidthType, BorderStyle, AlignmentType } = D;
  const { header, rows, align } = parsePipeTable(lines);
  const width = Math.max(header ? header.length : 0, ...rows.map((r) => r.length), 1);
  const pad = (cells) => { const c = cells.slice(); while (c.length < width) c.push(''); return c; };
  const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
  const alignFor = (i) => {
    const a = align && align[i];
    if (a === 'center') return AlignmentType.CENTER;
    if (a === 'right') return AlignmentType.RIGHT;
    if (a === 'left') return AlignmentType.LEFT;
    return undefined; // unmarked column → Word's default (left)
  };
  const cell = (text, bold, ci) => new TableCell({
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({ alignment: alignFor(ci), children: parseInline(text === '' ? '—' : text, D, { bold, size: 18 }, ictx) })],
  });
  const trs = [];
  if (header) trs.push(new TableRow({ tableHeader: true, children: pad(header).map((h, i) => cell(h, true, i)) }));
  for (const r of rows) trs.push(new TableRow({ children: pad(r).map((v, i) => cell(v, false, i)) }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders, rows: trs, alignment: AlignmentType.CENTER });
}

/**
 * Markdown subset → docx blocks. `ctx.listInstance` is SHARED across every call
 * for one document so each ordered list gets a fresh numbering instance (restarts
 * at 1). B2: `ctx.inline` (optional) threads the asset numbering/anchors into
 * parseInline so `[[table:…]]` tokens resolve; placement calls this PER BLOCK
 * (placement.sectionBlocks mirrors this grouping exactly — a whole list is one
 * block, so per-block calls with the shared ctx keep instances correct).
 * Heading mapping mirrors mdDom: # → H2, ## → H3, ### → H4 (sections themselves
 * are H1). Exported for the MS-4 parity tests.
 */
export function markdownToParagraphs(md, D, ctx) {
  const { Paragraph, HeadingLevel } = D;
  const c = ctx || { listInstance: 0 };
  const ictx = c.inline || null;
  const out = [];
  const lines = String(md == null ? '' : md).split('\n');
  let tableBuf = null;
  let inOl = false;
  const flushTable = () => {
    if (!tableBuf) return;
    out.push(mdTableToDocx(tableBuf, D, ictx));
    tableBuf = null;
    // 117.md §4 — the manual table's notes belong UNDER its table, but the caption
    // (which carries them) is emitted before it — and, on the placement path, in a
    // different call. The pending note therefore rides the SHARED document context.
    if (c.pendingTableNote) { out.push(note(c.pendingTableNote, D)); c.pendingTableNote = null; }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const isTable = /^\s*\|/.test(line);
    if (tableBuf && !isTable) flushTable();
    if (isTable) { inOl = false; if (!tableBuf) tableBuf = []; tableBuf.push(line); continue; }
    // 117.md §4/§92 — a MANUAL table's caption: the same treatment a registry asset
    // gets (numbered caption paragraph + Bookmark anchor + optional caption body),
    // emitted in place because the table itself is already inline prose.
    const cap = line.match(TABLE_CAPTION_LINE_RE);
    if (cap) {
      inOl = false;
      const capId = `table:${cap[1]}`;
      const capAsset = (ictx && ictx.manualById && ictx.manualById[capId]) || null;
      const capNum = (ictx && ictx.numbers) ? ictx.numbers[capId] : null;
      const capTitle = (capAsset && (capAsset.title || capAsset.defaultCaption)) || cap[2].trim();
      out.push(caption(
        formatAssetCaption('table', capNum, capTitle, { templateId: ictx && ictx.templateId }),
        D,
        { bookmark: (ictx && ictx.anchors) ? ictx.anchors[capId] : null, keepNext: true },
      ));
      if (capAsset && capAsset.caption) out.push(captionBody(capAsset.caption, D, { keepNext: true }));
      c.pendingTableNote = (capAsset && capAsset.note) ? capAsset.note : null;
      continue;
    }
    if (!line.trim()) { inOl = false; continue; }
    // Any other content between a caption and a table breaks the pairing, so the
    // note must not drift onto an unrelated table further down.
    c.pendingTableNote = null;
    if (/^###\s+/.test(line)) { inOl = false; out.push(new Paragraph({ heading: HeadingLevel.HEADING_4, children: parseInline(line.replace(/^###\s+/, ''), D, {}, ictx), spacing: { before: 120, after: 60 } })); continue; }
    if (/^##\s+/.test(line)) { inOl = false; out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: parseInline(line.replace(/^##\s+/, ''), D, {}, ictx), spacing: { before: 140, after: 70 } })); continue; }
    if (/^#\s+/.test(line)) { inOl = false; out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: parseInline(line.replace(/^#\s+/, ''), D, {}, ictx), spacing: { before: 160, after: 80 } })); continue; }
    if (/^[-*]\s+/.test(line)) { inOl = false; out.push(new Paragraph({ bullet: { level: 0 }, children: parseInline(line.replace(/^[-*]\s+/, ''), D, {}, ictx) })); continue; }
    if (/^\d+\.\s+/.test(line)) {
      if (!inOl) { c.listInstance = (c.listInstance || 0) + 1; inOl = true; }
      out.push(new Paragraph({
        numbering: { reference: MD_OL_REF, level: 0, instance: c.listInstance },
        children: parseInline(line.replace(/^\d+\.\s+/, ''), D, {}, ictx),
      }));
      continue;
    }
    inOl = false;
    out.push(new Paragraph({ children: parseInline(line, D, {}, ictx), spacing: { after: 120 }, alignment: D.AlignmentType.JUSTIFIED }));
  }
  flushTable();
  if (!out.length) out.push(new Paragraph({ children: parseInline('', D, {}, ictx) }));
  return out;
}

/* ── data table → docx Table ────────────────────────────────────────────────── */

/* Text-heavy ("label") columns get 2× the width of numeric ones. Derived from
   the engine builders' column keys (tables.js). */
const WIDE_COLUMN_KEYS = new Set([
  'study', 'label', 'stage', 'database', 'population', 'intervention', 'comparator',
  'outcome', 'design', 'followup', 'funding', 'string', 'query', 'notes', 'filters',
  'title', 'reason',
]);

/**
 * Engine table → native Word table. 85.md C: FIXED layout with weighted column
 * widths (portrait ~9360 DXA), >8-column font step-down to 8pt (reported via
 * opts.onInfo), and keep-together ONLY for small tables (≤10 rows, no cell
 * >300 chars): row cantSplit + keepNext on every cell paragraph of every row but
 * the last. A row taller than a page with cantSplit would CLIP, so verbose
 * tables never get it.
 */
function tableToDocx(tbl, D, opts = {}) {
  const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, BorderStyle, AlignmentType, TableLayoutType } = D;
  const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
  const cols = tbl.columns || [];
  const wide = cols.length > 8;
  const fontSize = wide ? 16 : 18; // half-points: 8pt / 9pt
  if (wide && typeof opts.onInfo === 'function') {
    opts.onInfo('wide-table', `"${tbl.title || tbl.id}" has ${cols.length} columns — exported at 8pt with fixed column widths; consider trimming columns for print.`);
  }
  const weights = cols.map((c) => (WIDE_COLUMN_KEYS.has(String(c.key)) ? 2 : 1));
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const columnWidths = weights.map((w) => Math.floor((TOTAL_TABLE_DXA * w) / weightSum));

  const rows = tbl.rows || [];
  const small = rows.length <= 10
    && rows.every((r) => cols.every((c) => String(r[c.key] == null ? '' : r[c.key]).length <= 300));

  const cell = (text, { bold = false, keepNext = false } = {}) => new TableCell({
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({
      keepNext: keepNext || undefined,
      children: [new TextRun({ text: String(text == null || text === '' ? '—' : text), bold, size: fontSize })],
    })],
  });
  const totalRows = rows.length + 1; // + header
  const headRow = new TableRow({
    tableHeader: true,
    cantSplit: small || undefined,
    children: cols.map((c) => cell(c.label, { bold: true, keepNext: small && totalRows > 1 })),
  });
  const bodyRows = rows.map((r, i) => new TableRow({
    cantSplit: small || undefined,
    children: cols.map((c) => cell(r[c.key], { keepNext: small && i < rows.length - 1 })),
  }));
  return new Table({
    width: { size: TOTAL_TABLE_DXA, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths,
    borders,
    rows: [headRow, ...bodyRows],
    alignment: AlignmentType.CENTER,
  });
}

/** Caption paragraph; optionally bookmarked (cross-ref target) + keepNext. */
function caption(label, D, opts = {}) {
  const { Paragraph, TextRun, Bookmark } = D;
  const runs = [new TextRun({ text: label, bold: true, size: 18 })];
  const children = (opts.bookmark && Bookmark)
    ? [new Bookmark({ id: opts.bookmark, children: runs })]
    : runs;
  return new Paragraph({ spacing: { before: 80, after: 80 }, keepNext: opts.keepNext || undefined, children });
}
function note(text, D) {
  const { Paragraph, TextRun } = D;
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, italics: true, size: 16, color: '666666' })] });
}
/** User caption text — its own 9pt paragraph under the "Table N. Title" line. */
function captionBody(text, D, opts = {}) {
  const { Paragraph, TextRun } = D;
  return new Paragraph({
    spacing: { after: 80 },
    keepNext: opts.keepNext || undefined,
    children: [new TextRun({ text, size: 18 })],
  });
}
function h1(text, D, opts = {}) {
  const { Paragraph, HeadingLevel } = D;
  return new Paragraph({ heading: HeadingLevel.HEADING_1, text, pageBreakBefore: !!opts.pageBreak, spacing: { before: 240, after: 100 } });
}

/**
 * Build the manuscript .docx Blob.
 * @param {object} project   Project.data blob
 * @param {object} draft     normalized manuscript draft
 * @param {object} [opts]    {
 *   runMeta, prec, software, appVersion, includeFigures, tables, references,
 *   prismaResult, primary, gradeByOutcome, robByStudyId, robOpts, robAssessments,
 *   searchOpts, screening, analysis,
 *   prismaFlow,    // 117.md §12 — canonical derivePrismaFlow output; only read when
 *                  // `prismaResult` is absent (it already carries the flow)
 *   // 85.md B2 — placement-aware assembly (all optional; defaults derive them):
 *   assets,        // computeManuscriptAssets output
 *   numbering,     // resolveNumbering output
 *   placements,    // computePlacements output
 *   analyses,      // allAnalyses output (per-outcome forest figures)
 *   validation,    // validateExport output (informational; export never re-blocks)
 *   onProgress,    // (step, total, label) — figure rasterization progress
 *   onInfo,        // (code, message) — export-time notices (wide tables, defaults)
 * }
 * @returns {Promise<Blob>}
 */
export async function buildManuscriptDocx(project, draft, opts = {}) {
  const D = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak, ImageRun } = D;

  const prec = opts.prec;
  const onInfo = typeof opts.onInfo === 'function' ? opts.onInfo : null;
  // 117.md §12/§57 — the CANONICAL flow wins when the caller has it. `prismaResult`
  // (the normal path: useManuscript.prepareExport) already carries it, so this
  // fallback only matters for a direct/legacy invocation — but it must not silently
  // drop the flow and export a different PRISMA figure than the editor showed.
  const prismaResult = opts.prismaResult || computePrismaCounts(project, {
    overrides: draft.prismaOverrides,
    screening: opts.screening,
    ...(opts.prismaFlow ? { flow: opts.prismaFlow } : {}),
  });
  const primary = opts.primary || primaryAnalysis(project, { runMeta: opts.runMeta, analysis: opts.analysis });
  if (!opts.tables && onInfo && !opts.robByStudyId && !opts.screening) {
    // Default table building without live sources yields weaker tables (no RoB
    // column, no screening-grounded PRISMA) — surfaced honestly, never a throw.
    onInfo('no-live-sources', 'Export invoked without live sources (screening/RoB) — tables were built from project data only.');
  }
  const tables = opts.tables || {
    study: buildStudyCharacteristicsTable(project, { robByStudyId: opts.robByStudyId }),
    // P12 — thread the per-outcome GRADE certainty map so the SoF gains its Certainty
    // (GRADE) column. Undefined when the gradeCertainty flag is off → column stays blank.
    sof: buildSummaryOfFindingsTable(project, { runMeta: opts.runMeta, prec, gradeByOutcome: opts.gradeByOutcome, analysis: opts.analysis }),
    prisma: buildPrismaCountsTable(prismaResult),
    rob: buildRobTable(project, opts.robOpts || {}),
    search: buildSearchStrategyTable(project, opts.searchOpts || {}),
  };
  const robAssessments = opts.robAssessments || (opts.robOpts && opts.robOpts.assessments) || null;
  const analyses = opts.analyses
    || allAnalyses(project, { runMeta: opts.runMeta, analysis: opts.analysis });

  /* ── 85.md asset registry + numbering + placement (defaults derive from the
        same inputs the tables above were built with, so numbers can't drift) ── */
  const assets = opts.assets || computeManuscriptAssets(project, draft, {
    tables, prismaCounts: prismaResult, analyses, primary,
    robByStudyId: opts.robByStudyId, robAssessments: robAssessments || undefined,
    screening: opts.screening,
  });
  const numbering = opts.numbering || resolveNumbering({ sections: draft, assets });
  const placements = opts.placements || computePlacements({ sections: draft, numbering, assets });
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const anchors = buildAnchors(assets);
  const includeFigures = opts.includeFigures !== false;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const figTotal = includeFigures ? (numbering.orderFigures || []).length : 0;
  let figStep = 0;

  /* 117.md §26/§32/§41 — the bibliography comes from the ONE resolver seam. The
     caller (useManuscript.prepareExport) normally passes the already-resolved,
     already-validated list; this fallback is for a direct/legacy invocation and
     must resolve the SAME way, aliases included, or the exported document would
     disagree with the editor about what it cites. `draft.references` stays the
     legacy override it always was. */
  const legacyRefs = (draft.references && draft.references.length) ? draft.references : null;
  const resolvedLib = legacyRefs ? null : resolveReferenceLibrary(project);
  const refAliases = opts.referenceAliases || (resolvedLib ? resolvedLib.aliases : {});
  const baseRefs = legacyRefs || (resolvedLib ? resolvedLib.refs : []);
  const refList = opts.references
    || generateReferenceList(orderReferencesForManuscript(draft, baseRefs, { aliases: refAliases }), draft.citationStyle);
  // 117.md §37 — author-year styles need the reference objects at marker time.
  const refsById = new Map();
  for (const r of refList) {
    refsById.set(r.id, r.ref);
    if (r.ref && r.ref.id && r.ref.id !== r.id) refsById.set(r.ref.id, r.ref);
  }
  for (const from of Object.keys(refAliases || {})) {
    const target = refsById.get(refAliases[from]);
    if (target && !refsById.has(from)) refsById.set(from, target);
  }

  // Inline-citation numbering: map [[cite:id]] tokens → [n] by order of appearance.
  // 117.md §32/§35 — alias-resolved and multi-cite aware: `[[cite:a,b,c]]` renders
  // one marker ("[1,2,5]", collapsing runs of 3+ to a range), and a citation of a
  // merged-away id numbers as its survivor.
  // Asset tokens SURVIVE renderInlineMarkers (verified: CITATION_TOKEN_RE only
  // matches [[cite:…]]) and are resolved inside parseInline via mdCtx.inline.
  // 117.md §39 — the reference list is the known-id set, so an unresolvable citation
  // exports as "[?]" rather than taking a number the bibliography does not have.
  const citeKnownIds = new Set(refList.map((r) => r.id));
  const { orderMap } = collectCitationOrder(draftSectionTexts(draft), { aliases: refAliases, knownIds: citeKnownIds });
  const citeOpts = { aliases: refAliases, refsById };
  const secMd = (id) => renderInlineMarkers((draft.sections[id] && draft.sections[id].content) || '', orderMap, draft.citationStyle, citeOpts);
  // 117.md §4 — manual tables are emitted INLINE by markdownToParagraphs (they are
  // prose blocks), so the inline context carries their registry entries: caption
  // text, extra caption paragraph and notes all come from the same derived asset
  // the editor and the validation see.
  const manualById = {};
  for (const a of assets) if (a && a.origin === 'manual') manualById[a.id] = a;
  // One shared markdown context per document → every ordered list gets a unique
  // numbering instance (each restarts at 1 in Word).
  const mdCtx = {
    listInstance: 0,
    pendingTableNote: null,
    inline: { numbers: numbering.byId, anchors, manualById, templateId: draft.templateId },
  };

  /* ── asset emitters ── */
  const assetTitle = (a) => (a.title || a.defaultCaption || a.id);

  const emitTableAsset = (a, out) => {
    const n = numbering.byId[a.id];
    const tbl = tables[a.builderId];
    out.push(caption(formatAssetCaption('table', n, assetTitle(a), { templateId: draft.templateId }), D,
      { bookmark: anchors[a.id], keepNext: true }));
    // User caption override — its OWN paragraph under the title line (it used to
    // be silently dropped: assetTitle only read it when the title was empty,
    // which builder titles never are).
    if (a.caption) out.push(captionBody(a.caption, D, { keepNext: true }));
    if (tbl && tbl.available) {
      out.push(tableToDocx(tbl, D, { onInfo }));
      // Builder warnings were previously dropped from the export — now honest
      // italic notes under the table (85.md C).
      for (const w of (tbl.warnings || [])) out.push(note(String(w), D));
    } else {
      out.push(note('[Table data was unavailable at export time — verify it in the Tables tab, then re-export.]', D));
    }
    if (a.note) out.push(note(a.note, D));
    if (a.legend && a.legend !== a.note) out.push(note(a.legend, D));
  };

  // RASTER-ONLY v1 (documented decision, header comment). ImageRun REQUIRES
  // `type` in docx v9 — omitting it writes a media part with an undefined content
  // type → a corrupt .docx that Word must "repair".
  const renderFigurePng = async (a) => {
    if (a.builderId === 'prisma') return prismaPng(prismaResult, { title: '', targetWidthPx: 1800 });
    if (a.builderId === 'forest') {
      // Every forest is pair-keyed; the legacy role id ('figure:forest-primary',
      // now also an alias) falls back to the current primary analysis.
      const match = (a.pairKey && analyses.find((x) => x && x.pair && x.pair.key === a.pairKey))
        || ((a.id === 'figure:forest-primary' || (a.aliasIds || []).includes('figure:forest-primary')) ? primary : null);
      if (!match || !match.result) return null;
      // 116.md §26/§32 — the reviewer's persisted axis name and favours texts reach the
      // Word file (the artifact that is actually submitted). They used to stop at the
      // journal ZIP, so a figure captioned "Favours intervention / Favours control" on
      // screen shipped as "favours lower / favours higher" in the manuscript. The TITLE
      // is deliberately still empty: Word numbers and captions the figure itself.
      return forestPng(match.result, {
        esType: match.pair.esType, ...(match.figure || {}), title: '', prec, targetWidthPx: 2200,
      });
    }
    if (a.builderId === 'rob') return robPng(robAssessments, { studies: project.studies, targetWidthPx: 1800 });
    if (a.builderId === 'funnel') {
      // The funnel plots the pair it is keyed to (the primary pair at registry
      // time); pairKey lookup keeps it bound across a later primary flip.
      const fp = (a.pairKey && analyses.find((x) => x && x.pair && x.pair.key === a.pairKey)) || primary;
      if (!fp || !fp.result) return null;
      return funnelPng(fp.result, { esType: fp.pair && fp.pair.esType, prec, targetWidthPx: 2200 });
    }
    return null;
  };

  const emitFigureAsset = async (a, out) => {
    const n = numbering.byId[a.id];
    const title = assetTitle(a);
    figStep += 1;
    if (onProgress) onProgress(figStep, figTotal, title);
    // Caption first (carries the bookmark) so cross-reference hyperlinks stay
    // valid even when rasterization fails and we fall back to an honest note.
    out.push(caption(formatAssetCaption('figure', n, title, { templateId: draft.templateId }), D,
      { bookmark: anchors[a.id], keepNext: true }));
    // User caption override — its own paragraph under the title line.
    if (a.caption) out.push(captionBody(a.caption, D, { keepNext: true }));
    try {
      const png = await renderFigurePng(a);
      if (png && png.blob) {
        const dispW = (a.builderId === 'forest' || a.builderId === 'funnel') ? 600 : 560;
        out.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: 'png',
            data: await blobToU8(png.blob),
            transformation: { width: dispW, height: Math.round((png.height / png.width) * dispW) },
            altText: { title: `Figure ${n}`, description: `Figure ${n}. ${title}`, name: anchors[a.id] },
          })],
        }));
      } else {
        out.push(note(`[${title} could not be generated for this export — open the Figures tab to verify, then re-export.]`, D));
      }
    } catch {
      out.push(note(`[${title} could not be generated for this export — open the Figures tab to verify, then re-export.]`, D));
    }
    if (a.legend) out.push(note(a.legend, D));
    if (a.note && a.note !== a.legend) out.push(note(a.note, D));
    // Yield to the event loop between figures so the progress label can paint.
    await new Promise((r) => setTimeout(r, 0));
  };

  const emitAsset = async (assetId, out) => {
    const a = assetById.get(assetId);
    if (!a || numbering.byId[assetId] == null) return;
    // 117.md §4 — a manual table is ALREADY in the prose stream; emitting it here
    // would duplicate it. computePlacements never yields one, this is the guard.
    if (a.origin === 'manual') return;
    if (a.kind === 'table') emitTableAsset(a, out);
    else if (a.kind === 'figure' && includeFigures) await emitFigureAsset(a, out);
  };

  const children = [];

  /* Title page */
  const title = (draft.sections.title && draft.sections.title.content.trim()) || draft.title || project.name || 'Untitled manuscript';
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: parseInline(title, D, {}, mdCtx.inline) }));
  if (draft.runningTitle) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Running title: ${draft.runningTitle}`, italics: true, size: 20 })] }));
  const authors = (draft.authorship && draft.authorship.authors) || [];
  if (authors.length) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 }, children: [new TextRun({ text: authors.map((a) => a.name).filter(Boolean).join(', '), size: 22 })] }));
    const affs = (draft.authorship.affiliations || []).filter(Boolean);
    for (const aff of affs) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: aff, size: 18 })] }));
    const corr = authors.find((a) => a.corresponding) || null;
    if (corr) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80 }, children: [new TextRun({ text: `Corresponding author: ${corr.name}${corr.email ? ` (${corr.email})` : ''}`, size: 18 })] }));
  }
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [new TextRun({ text: AI_DISCLAIMER, italics: true, size: 16, color: '999999' })] }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  /* Abstract + keywords (non-placement zone — tokens resolve to text only) */
  children.push(h1('Abstract', D));
  children.push(...markdownToParagraphs(secMd('abstract'), D, mdCtx));
  if (draft.keywords && draft.keywords.length) {
    children.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: 'Keywords: ', bold: true }), new TextRun({ text: draft.keywords.join(', ') })] }));
  }

  /* IMRAD body — placement-aware: each section is decomposed into the SAME block
     groups markdownToParagraphs emits (sectionBlocks mirrors it), and emitted
     assets are spliced AFTER the block holding their first mention. Sections
     without placements go through the identical whole-section conversion. */
  const bodyOrder = ['introduction', 'methods', 'results', 'discussion', 'limitations', 'conclusion'];
  for (const id of bodyOrder) {
    const meta = SECTION_TYPES.find((s) => s.id === id);
    const sect = draft.sections[id];
    children.push(h1(meta ? meta.label : id, D));
    const content = sect && sect.content.trim();
    if (!content) { children.push(note(`[${meta ? meta.label : id} not yet drafted]`, D)); continue; }
    const md = secMd(id);
    const inserts = (placements.bySection && placements.bySection[id]) || [];
    if (!inserts.length) {
      children.push(...markdownToParagraphs(md, D, mdCtx));
      continue;
    }
    // renderInlineMarkers never changes line structure, so block indices computed
    // on the raw draft content (placements) match blocks of the cite-rendered md.
    const blocks = sectionBlocks(md);
    for (let bi = 0; bi < blocks.length; bi += 1) {
      children.push(...markdownToParagraphs(blocks[bi].text, D, mdCtx));
      for (const ins of inserts) {
        if (ins.afterBlockIndex === bi) await emitAsset(ins.assetId, children);
      }
    }
    // Safety net: an insert past the last block (should be impossible) still emits.
    for (const ins of inserts) {
      if (ins.afterBlockIndex >= blocks.length) await emitAsset(ins.assetId, children);
    }
  }

  /* Declarations — cite AND asset tokens render (85.md fix: statements previously
     bypassed renderInlineMarkers, leaking [[cite:…]] literally). */
  const filledStatements = STATEMENT_TYPES.filter((st) => draft.statements && draft.statements[st.id] && draft.statements[st.id].trim());
  if (filledStatements.length) {
    children.push(h1('Declarations', D));
    for (const st of filledStatements) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: st.label, spacing: { before: 120, after: 40 } }));
      children.push(...markdownToParagraphs(renderInlineMarkers(draft.statements[st.id], orderMap, draft.citationStyle, citeOpts), D, mdCtx));
    }
  }

  /* References */
  children.push(h1('References', D, { pageBreak: true }));
  if (refList.length) {
    for (const r of refList) {
      const runs = [new TextRun({ text: `${r.index}. `, bold: true })];
      const segs = (r.segments && r.segments.length) ? r.segments : [{ text: r.text }];
      // 117.md §37/§41 — a segment may now be BOLD as well as italic (Nature bolds
      // the volume). Unknown flags are simply absent for every other style, so the
      // four original styles produce identical runs.
      for (const seg of segs) runs.push(new TextRun({ text: seg.text, italics: !!seg.italics, bold: !!seg.bold }));
      children.push(new Paragraph({ spacing: { after: 60 }, children: runs }));
    }
  } else {
    children.push(note('[No references — add included studies or import citation metadata]', D));
  }

  /* Fallback end-of-document sections: emitted assets never mentioned in a body
     section keep the legacy "Tables"/"Figures" layout (numbering order). */
  const fallbackIds = placements.fallback || [];
  const fallbackTables = fallbackIds.filter((fid) => { const a = assetById.get(fid); return a && a.kind === 'table'; });
  const fallbackFigures = fallbackIds.filter((fid) => { const a = assetById.get(fid); return a && a.kind === 'figure'; });

  if (fallbackTables.length || !(numbering.orderTables || []).length) {
    children.push(h1('Tables', D, { pageBreak: true }));
    for (const fid of fallbackTables) await emitAsset(fid, children);
    if (!(numbering.orderTables || []).length) children.push(note('[No data tables available yet]', D));
  }

  if (includeFigures && fallbackFigures.length) {
    const figParas = [];
    for (const fid of fallbackFigures) await emitAsset(fid, figParas);
    if (figParas.length) {
      children.push(h1('Figures', D, { pageBreak: true }));
      children.push(...figParas);
    }
  }

  /* PRISMA statement */
  children.push(h1('PRISMA 2020 statement', D));
  children.push(note('This systematic review is reported in accordance with the Preferred Reporting Items for Systematic Reviews and Meta-Analyses (PRISMA) 2020 statement. A completed PRISMA 2020 checklist is provided as a supplementary file.', D));

  const doc = new Document({
    creator: 'PecanRev',
    title,
    description: 'Systematic review manuscript generated by PecanRev (P3 Manuscript engine).',
    // No custom 'Title' paragraph style — `HeadingLevel.TITLE` already emits docx's
    // built-in Title style; redefining the same styleId produced a duplicate w:styleId.
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
    },
    // Real ordered lists for the markdown subset (65.md MS-4): one abstract
    // numbering definition; each list block instantiates it (restart at 1).
    numbering: {
      config: [{
        reference: MD_OL_REF,
        levels: [{
          level: 0,
          format: D.LevelFormat.DECIMAL,
          text: '%1.',
          alignment: D.AlignmentType.START,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      }],
    },
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children,
    }],
  });

  return Packer.toBlob(doc);
}

export default { buildManuscriptDocx };
