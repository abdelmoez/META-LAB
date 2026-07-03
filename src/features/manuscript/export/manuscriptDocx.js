/**
 * features/manuscript/export/manuscriptDocx.js — 64.md (P3). One-click, REAL .docx
 * manuscript export (Office Open XML via the `docx` library — NOT HTML renamed).
 * Runs entirely CLIENT-side (Packer.toBlob) so it never loads the server.
 *
 * Produces a PRISMA-2020-structured academic manuscript: title page, abstract,
 * IMRAD body (native Word headings), declarations, numbered reference list, data
 * tables (study characteristics / SOF / PRISMA counts / RoB / search), embedded
 * PRISMA 2020 diagram + forest plot, captions, page breaks, and a PRISMA statement.
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
  referencesFromProject,
  orderReferencesForManuscript,
  collectCitationOrder,
  draftSectionTexts,
  renderInlineMarkers,
  primaryAnalysis,
} from '../../../research-engine/manuscript/index.js';
import { SECTION_TYPES, STATEMENT_TYPES } from '../../../research-engine/manuscript/model.js';
import { parsePipeTable } from '../richEditor/mdDom.js';
import { forestPng, prismaPng } from './figures.js';

const AI_DISCLAIMER = 'AI draft — verify all content, numbers, and citations against your extracted data before submission.';

/** Numbering reference for markdown ordered lists (defined once on the Document). */
export const MD_OL_REF = 'md-ordered-list';

async function blobToU8(blob) {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/* ── markdown (WYSIWYG subset, 65.md MS-4) → docx runs/paragraphs — kept
      symmetric with richEditor/mdDom.js so the editor and the export can never
      disagree on what a construct means. ─────────────────────────────────── */
function parseInline(text, D, base = {}) {
  const { TextRun, ExternalHyperlink } = D;
  const runs = [];
  const plain = (t, extra = {}) => { if (t) runs.push(new TextRun({ text: t, ...base, ...extra })); };
  const re = /(\*\*\*[^*]+\*\*\*|\*\*(?:[^*]|\*(?!\*))+?\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]*\]\((?:https?:\/\/|mailto:)[^)\s]+\))/g;
  let last = 0;
  let m;
  const s = String(text == null ? '' : text);
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) plain(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('***')) plain(tok.slice(3, -3), { bold: true, italics: true });
    else if (tok.startsWith('**')) {
      // bold segment may contain *italic* runs: **a *b* c**
      const inner = tok.slice(2, -2);
      const ire = /\*([^*]+)\*/g;
      let il = 0;
      let im;
      while ((im = ire.exec(inner)) !== null) {
        if (im.index > il) plain(inner.slice(il, im.index), { bold: true });
        plain(im[1], { bold: true, italics: true });
        il = ire.lastIndex;
      }
      if (il < inner.length) plain(inner.slice(il), { bold: true });
    } else if (tok.startsWith('`')) plain(tok.slice(1, -1), { font: 'Consolas' });
    else if (tok.startsWith('[')) {
      const lm = tok.match(/^\[([^\]]*)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)$/);
      if (lm && ExternalHyperlink) {
        runs.push(new ExternalHyperlink({
          link: lm[2],
          children: [new TextRun({ text: lm[1] || lm[2], ...base, color: '0563C1', underline: {} })],
        }));
      } else if (lm) plain(`${lm[1] || lm[2]} (${lm[2]})`);
      else plain(tok);
    } else plain(tok.slice(1, -1), { italics: true });
    last = re.lastIndex;
  }
  if (last < s.length) plain(s.slice(last));
  if (!runs.length) runs.push(new TextRun({ text: '', ...base }));
  return runs;
}

/** Pipe-table markdown → a real docx Table (same look as the data tables). */
function mdTableToDocx(lines, D) {
  const { Table, TableRow, TableCell, Paragraph, WidthType, BorderStyle, AlignmentType } = D;
  const { header, rows } = parsePipeTable(lines);
  const width = Math.max(header ? header.length : 0, ...rows.map((r) => r.length), 1);
  const pad = (cells) => { const c = cells.slice(); while (c.length < width) c.push(''); return c; };
  const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
  const cell = (text, bold) => new TableCell({
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({ children: parseInline(text === '' ? '—' : text, D, { bold, size: 18 }) })],
  });
  const trs = [];
  if (header) trs.push(new TableRow({ tableHeader: true, children: pad(header).map((h) => cell(h, true)) }));
  for (const r of rows) trs.push(new TableRow({ children: pad(r).map((v) => cell(v, false)) }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders, rows: trs, alignment: AlignmentType.CENTER });
}

/**
 * Markdown subset → docx blocks. `ctx.listInstance` is SHARED across every call
 * for one document so each ordered list gets a fresh numbering instance (restarts
 * at 1). Heading mapping mirrors mdDom: # → H2, ## → H3, ### → H4 (sections
 * themselves are H1). Exported for the MS-4 parity tests.
 */
export function markdownToParagraphs(md, D, ctx) {
  const { Paragraph, HeadingLevel } = D;
  const c = ctx || { listInstance: 0 };
  const out = [];
  const lines = String(md == null ? '' : md).split('\n');
  let tableBuf = null;
  let inOl = false;
  const flushTable = () => { if (tableBuf) { out.push(mdTableToDocx(tableBuf, D)); tableBuf = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const isTable = /^\s*\|/.test(line);
    if (tableBuf && !isTable) flushTable();
    if (isTable) { inOl = false; if (!tableBuf) tableBuf = []; tableBuf.push(line); continue; }
    if (!line.trim()) { inOl = false; continue; }
    if (/^###\s+/.test(line)) { inOl = false; out.push(new Paragraph({ heading: HeadingLevel.HEADING_4, children: parseInline(line.replace(/^###\s+/, ''), D), spacing: { before: 120, after: 60 } })); continue; }
    if (/^##\s+/.test(line)) { inOl = false; out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: parseInline(line.replace(/^##\s+/, ''), D), spacing: { before: 140, after: 70 } })); continue; }
    if (/^#\s+/.test(line)) { inOl = false; out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: parseInline(line.replace(/^#\s+/, ''), D), spacing: { before: 160, after: 80 } })); continue; }
    if (/^[-*]\s+/.test(line)) { inOl = false; out.push(new Paragraph({ bullet: { level: 0 }, children: parseInline(line.replace(/^[-*]\s+/, ''), D) })); continue; }
    if (/^\d+\.\s+/.test(line)) {
      if (!inOl) { c.listInstance = (c.listInstance || 0) + 1; inOl = true; }
      out.push(new Paragraph({
        numbering: { reference: MD_OL_REF, level: 0, instance: c.listInstance },
        children: parseInline(line.replace(/^\d+\.\s+/, ''), D),
      }));
      continue;
    }
    inOl = false;
    out.push(new Paragraph({ children: parseInline(line, D), spacing: { after: 120 }, alignment: D.AlignmentType.JUSTIFIED }));
  }
  flushTable();
  if (!out.length) out.push(new Paragraph({ children: parseInline('', D) }));
  return out;
}

/* ── data table → docx Table ────────────────────────────────────────────────── */
function tableToDocx(tbl, D) {
  const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, BorderStyle, AlignmentType } = D;
  const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
  const cell = (text, { bold = false } = {}) => new TableCell({
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({ children: [new TextRun({ text: String(text == null || text === '' ? '—' : text), bold, size: 18 })] })],
  });
  const headRow = new TableRow({
    tableHeader: true,
    children: tbl.columns.map((c) => cell(c.label, { bold: true })),
  });
  const bodyRows = tbl.rows.map((r) => new TableRow({ children: tbl.columns.map((c) => cell(r[c.key])) }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: [headRow, ...bodyRows],
    alignment: AlignmentType.CENTER,
  });
}

function caption(label, D) {
  const { Paragraph, TextRun } = D;
  return new Paragraph({ spacing: { before: 80, after: 80 }, children: [new TextRun({ text: label, bold: true, size: 18 })] });
}
function note(text, D) {
  const { Paragraph, TextRun } = D;
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, italics: true, size: 16, color: '666666' })] });
}
function h1(text, D, opts = {}) {
  const { Paragraph, HeadingLevel } = D;
  return new Paragraph({ heading: HeadingLevel.HEADING_1, text, pageBreakBefore: !!opts.pageBreak, spacing: { before: 240, after: 100 } });
}

/**
 * Build the manuscript .docx Blob.
 * @param {object} project   Project.data blob
 * @param {object} draft     normalized manuscript draft
 * @param {object} [opts]    { runMeta, prec, software, appVersion, includeFigures, tables, references, prismaResult, primary, gradeByOutcome }
 * @returns {Promise<Blob>}
 */
export async function buildManuscriptDocx(project, draft, opts = {}) {
  const D = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak, ImageRun } = D;

  const prec = opts.prec;
  const prismaResult = opts.prismaResult || computePrismaCounts(project, { overrides: draft.prismaOverrides });
  const primary = opts.primary || primaryAnalysis(project, { runMeta: opts.runMeta });
  const tables = opts.tables || {
    study: buildStudyCharacteristicsTable(project, { robByStudyId: opts.robByStudyId }),
    // P12 — thread the per-outcome GRADE certainty map so the SoF gains its Certainty
    // (GRADE) column. Undefined when the gradeCertainty flag is off → column stays blank.
    sof: buildSummaryOfFindingsTable(project, { runMeta: opts.runMeta, prec, gradeByOutcome: opts.gradeByOutcome }),
    prisma: buildPrismaCountsTable(prismaResult),
    rob: buildRobTable(project, opts.robOpts || {}),
    search: buildSearchStrategyTable(project, opts.searchOpts || {}),
  };
  const baseRefs = (draft.references && draft.references.length) ? draft.references : referencesFromProject(project);
  const refList = opts.references || generateReferenceList(orderReferencesForManuscript(draft, baseRefs), draft.citationStyle);

  // Inline-citation numbering: map [[cite:id]] tokens → [n] by order of appearance.
  const { orderMap } = collectCitationOrder(draftSectionTexts(draft));
  const secMd = (id) => renderInlineMarkers((draft.sections[id] && draft.sections[id].content) || '', orderMap, draft.citationStyle);
  // One shared markdown context per document → every ordered list gets a unique
  // numbering instance (each restarts at 1 in Word).
  const mdCtx = { listInstance: 0 };

  const children = [];

  /* Title page */
  const title = (draft.sections.title && draft.sections.title.content.trim()) || draft.title || project.name || 'Untitled manuscript';
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: parseInline(title, D) }));
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

  /* Abstract + keywords */
  children.push(h1('Abstract', D));
  children.push(...markdownToParagraphs(secMd('abstract'), D, mdCtx));
  if (draft.keywords && draft.keywords.length) {
    children.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: 'Keywords: ', bold: true }), new TextRun({ text: draft.keywords.join(', ') })] }));
  }

  /* IMRAD body */
  const bodyOrder = ['introduction', 'methods', 'results', 'discussion', 'limitations', 'conclusion'];
  for (const id of bodyOrder) {
    const meta = SECTION_TYPES.find((s) => s.id === id);
    const sect = draft.sections[id];
    children.push(h1(meta ? meta.label : id, D));
    const content = sect && sect.content.trim();
    if (content) children.push(...markdownToParagraphs(secMd(id), D, mdCtx));
    else children.push(note(`[${meta ? meta.label : id} not yet drafted]`, D));
  }

  /* Declarations */
  const filledStatements = STATEMENT_TYPES.filter((st) => draft.statements && draft.statements[st.id] && draft.statements[st.id].trim());
  if (filledStatements.length) {
    children.push(h1('Declarations', D));
    for (const st of filledStatements) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: st.label, spacing: { before: 120, after: 40 } }));
      children.push(...markdownToParagraphs(draft.statements[st.id], D, mdCtx));
    }
  }

  /* References */
  children.push(h1('References', D, { pageBreak: true }));
  if (refList.length) {
    for (const r of refList) {
      const runs = [new TextRun({ text: `${r.index}. `, bold: true })];
      const segs = (r.segments && r.segments.length) ? r.segments : [{ text: r.text }];
      for (const seg of segs) runs.push(new TextRun({ text: seg.text, italics: !!seg.italics }));
      children.push(new Paragraph({ spacing: { after: 60 }, children: runs }));
    }
  } else {
    children.push(note('[No references — add included studies or import citation metadata]', D));
  }

  /* Tables */
  children.push(h1('Tables', D, { pageBreak: true }));
  let tableNo = 0;
  const orderedTables = [
    ['Characteristics of included studies', tables.study],
    ['Summary of findings', tables.sof],
    ['PRISMA 2020 flow counts', tables.prisma],
    ['Risk of bias summary', tables.rob],
    ['Search strategy', tables.search],
  ];
  for (const [label, tbl] of orderedTables) {
    if (!tbl || !tbl.available) continue;
    tableNo += 1;
    children.push(caption(`Table ${tableNo}. ${label}`, D));
    children.push(tableToDocx(tbl, D));
    if (tbl.note) children.push(note(tbl.note, D));
  }
  if (tableNo === 0) children.push(note('[No data tables available yet]', D));

  /* Figures */
  let figNo = 0;
  const figParas = [];
  if (opts.includeFigures !== false) {
    // PRISMA 2020 diagram. ImageRun REQUIRES `type` in docx v9 — omitting it writes
    // a media part with an undefined content type → a corrupt .docx that Word must
    // "repair". On failure we leave an honest in-document note rather than silently
    // dropping the figure.
    try {
      const pr = await prismaPng(prismaResult, { title: '' });
      if (pr && pr.blob) {
        figNo += 1;
        figParas.push(caption(`Figure ${figNo}. PRISMA 2020 flow diagram`, D));
        figParas.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: await blobToU8(pr.blob), transformation: { width: 560, height: Math.round((pr.height / pr.width) * 560) } })] }));
      }
    } catch {
      figParas.push(note('[PRISMA 2020 diagram could not be generated for this export — open the Figures tab to verify, then re-export.]', D));
    }
    try {
      if (primary && primary.result) {
        const fp = await forestPng(primary.result, { esType: primary.pair.esType, title: primary.pair.label || '', prec });
        if (fp && fp.blob) {
          figNo += 1;
          figParas.push(caption(`Figure ${figNo}. Forest plot — ${primary.pair.label || 'primary outcome'}`, D));
          figParas.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: await blobToU8(fp.blob), transformation: { width: 600, height: Math.round((fp.height / fp.width) * 600) } })] }));
        }
      }
    } catch {
      figParas.push(note('[Forest plot could not be generated for this export — verify in the Figures tab, then re-export.]', D));
    }
  }
  if (figParas.length) {
    children.push(h1('Figures', D, { pageBreak: true }));
    children.push(...figParas);
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
