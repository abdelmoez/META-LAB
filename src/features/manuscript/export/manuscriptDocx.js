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
import { forestPng, prismaPng } from './figures.js';

const AI_DISCLAIMER = 'AI draft — verify all content, numbers, and citations against your extracted data before submission.';

async function blobToU8(blob) {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/* ── markdown (limited subset) → docx paragraphs ────────────────────────────── */
function parseInline(text, D) {
  const { TextRun } = D;
  const runs = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m;
  const s = String(text == null ? '' : text);
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) runs.push(new TextRun({ text: s.slice(last, m.index) }));
    const tok = m[0];
    if (tok.startsWith('**')) runs.push(new TextRun({ text: tok.slice(2, -2), bold: true }));
    else if (tok.startsWith('`')) runs.push(new TextRun({ text: tok.slice(1, -1), font: 'Consolas' }));
    else runs.push(new TextRun({ text: tok.slice(1, -1), italics: true }));
    last = re.lastIndex;
  }
  if (last < s.length) runs.push(new TextRun({ text: s.slice(last) }));
  if (!runs.length) runs.push(new TextRun({ text: '' }));
  return runs;
}

function markdownToParagraphs(md, D) {
  const { Paragraph, HeadingLevel } = D;
  const out = [];
  const lines = String(md == null ? '' : md).split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { continue; }
    if (/^###\s+/.test(line)) { out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: parseInline(line.replace(/^###\s+/, ''), D), spacing: { before: 120, after: 60 } })); continue; }
    if (/^##\s+/.test(line)) { out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: parseInline(line.replace(/^##\s+/, ''), D), spacing: { before: 160, after: 80 } })); continue; }
    if (/^#\s+/.test(line)) { out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: parseInline(line.replace(/^#\s+/, ''), D), spacing: { before: 160, after: 80 } })); continue; }
    if (/^[-*]\s+/.test(line)) { out.push(new Paragraph({ bullet: { level: 0 }, children: parseInline(line.replace(/^[-*]\s+/, ''), D) })); continue; }
    if (/^\d+\.\s+/.test(line)) { out.push(new Paragraph({ children: parseInline(line, D) })); continue; }
    out.push(new Paragraph({ children: parseInline(line, D), spacing: { after: 120 }, alignment: D.AlignmentType.JUSTIFIED }));
  }
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
 * @param {object} [opts]    { runMeta, prec, software, appVersion, includeFigures, tables, references, prismaResult, primary }
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
    sof: buildSummaryOfFindingsTable(project, { runMeta: opts.runMeta, prec }),
    prisma: buildPrismaCountsTable(prismaResult),
    rob: buildRobTable(project, opts.robOpts || {}),
    search: buildSearchStrategyTable(project, opts.searchOpts || {}),
  };
  const baseRefs = (draft.references && draft.references.length) ? draft.references : referencesFromProject(project);
  const refList = opts.references || generateReferenceList(orderReferencesForManuscript(draft, baseRefs), draft.citationStyle);

  // Inline-citation numbering: map [[cite:id]] tokens → [n] by order of appearance.
  const { orderMap } = collectCitationOrder(draftSectionTexts(draft));
  const secMd = (id) => renderInlineMarkers((draft.sections[id] && draft.sections[id].content) || '', orderMap, draft.citationStyle);

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
  children.push(...markdownToParagraphs(secMd('abstract'), D));
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
    if (content) children.push(...markdownToParagraphs(secMd(id), D));
    else children.push(note(`[${meta ? meta.label : id} not yet drafted]`, D));
  }

  /* Declarations */
  const filledStatements = STATEMENT_TYPES.filter((st) => draft.statements && draft.statements[st.id] && draft.statements[st.id].trim());
  if (filledStatements.length) {
    children.push(h1('Declarations', D));
    for (const st of filledStatements) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: st.label, spacing: { before: 120, after: 40 } }));
      children.push(...markdownToParagraphs(draft.statements[st.id], D));
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
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children,
    }],
  });

  return Packer.toBlob(doc);
}

export default { buildManuscriptDocx };
