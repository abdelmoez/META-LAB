/**
 * pdf.ts — 116.md §71-§104. The PDF-attachment seed helper the e2e suite was missing.
 *
 * WHY THIS EXISTS. Every loaded-PDF spec in `e2e/files/files-pdf.spec.ts` was skipped
 * behind `PDF_FIXTURE_AVAILABLE = false` with the note "no PDF-attachment fixture/helper
 * in this pass". Checking a binary fixture into the repo is the usual answer and a bad
 * one: it is opaque in review, it drifts, and a PDF from the internet carries whatever
 * fonts and metadata it happened to have. So this helper GENERATES the bytes.
 *
 * WHAT IT GENERATES. A minimal but fully valid PDF 1.4: a real catalogue, a real page
 * tree, `/MediaBox [0 0 612 792]` (US Letter), and per page a content stream that draws
 * WinAnsi Helvetica text. That last part is the load-bearing one for 116: pdf.js builds
 * a real TEXT LAYER from it, so a Playwright drag-select produces a genuine
 * `window.getSelection()` range with client rects — which is exactly what the annotation
 * capture path consumes. A scanned/image-only PDF would not, and §96 is explicit that
 * the product must fail gracefully there rather than pretend text exists; `makePdfBytes`
 * therefore also offers `{ textLayer: false }` so a spec can assert that degrade.
 *
 * NO DEPENDENCIES. Everything below is string concatenation plus a correctly computed
 * cross-reference table (each entry exactly 20 bytes, `startxref` at the real offset).
 * Verified against the same `pdfjs-dist` build the app bundles: 3 pages in, 3 pages out,
 * with the expected `getTextContent()` items.
 */
import { APIRequestContext, expect } from '@playwright/test';

const PAGE_W = 612;
const PAGE_H = 792;

/** The default text. Line 0 is the big heading; the rest is body copy to select. */
export const FIXTURE_HEADING = 'PECANREV E2E FIXTURE';
export const FIXTURE_LINES = [
  FIXTURE_HEADING,
  'The primary outcome was all-cause mortality at twelve months.',
  'Participants were randomised in a one to one ratio.',
  'Adverse events were recorded throughout the follow-up period.',
];

/** A sentence that appears on every page — handy for search / selection specs. */
export const FIXTURE_SELECTABLE = FIXTURE_LINES[1];

/** PDF string-literal escaping: backslash and both parentheses. */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function latin1Length(s: string): number {
  return Buffer.byteLength(s, 'latin1');
}

export interface MakePdfOptions {
  /** Page count (1-50). Use 1 / 20 / 100-ish shapes for the §96 size matrix. */
  pages?: number;
  /** Body lines drawn on every page. */
  lines?: string[];
  /**
   * false ⇒ emit pages with NO text operators at all: a valid PDF that pdf.js renders
   * but whose text layer is empty, i.e. the "scanned document" case of §96.
   */
  textLayer?: boolean;
}

/**
 * makePdfBytes(opts) → Buffer of a valid, text-bearing PDF.
 *
 * Object layout: 1 = catalogue, 2 = page tree, 3 = Helvetica, then (content, page)
 * pairs. Offsets are collected as the body is built, so the xref cannot drift from the
 * bytes — which is what makes the output loadable by a strict parser.
 */
export function makePdfBytes(opts: MakePdfOptions = {}): Buffer {
  const pages = Math.max(1, Math.min(50, opts.pages ?? 1));
  const lines = opts.lines ?? FIXTURE_LINES;
  const withText = opts.textLayer !== false;

  const objects: string[] = [];
  const push = (body: string): number => { objects.push(body); return objects.length; };

  const catalogId = push('');   // 1 — back-patched once the page tree id is known
  const pagesId = push('');     // 2 — back-patched with the kids list
  const fontId = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  const kids: string[] = [];
  for (let p = 1; p <= pages; p++) {
    const ops = withText
      ? [
        `BT /F1 18 Tf 72 720 Td (${esc(`${lines[0]} - page ${p}`)}) Tj ET`,
        ...lines.slice(1).map((l, i) => `BT /F1 12 Tf 72 ${684 - i * 24} Td (${esc(l)}) Tj ET`),
      ].join('\n')
      // No text operators: a drawn rectangle only, so the page renders but the text
      // layer is empty — the §96 scanned-PDF degrade.
      : '0.85 0.85 0.85 rg 72 600 468 120 re f';
    const contentId = push(`<< /Length ${latin1Length(ops)} >>\nstream\n${ops}\nendstream`);
    const pageId = push(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] `
      + `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    kids.push(`${pageId} 0 R`);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;

  // Header + a binary comment line, so naive "is this text?" sniffers treat it as binary.
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(latin1Length(out));
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const startxref = latin1Length(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/* ─── Seeding a record with a real attachment ──────────────────────────────── */

export interface ScreeningRecordRef { id: string; title?: string }

/** GET /api/screening/projects/:siftPid/records — the seeded records, first page. */
export async function listScreeningRecords(
  request: APIRequestContext, siftPid: string,
): Promise<ScreeningRecordRef[]> {
  const res = await request.get(`/api/screening/projects/${encodeURIComponent(siftPid)}/records`);
  expect(res.ok(), `listScreeningRecords failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return (body.records || body.items || []) as ScreeningRecordRef[];
}

export interface AttachedPdf {
  recordId: string;
  attachmentId: string;
  /** 116.md §73 — the sha256 the annotation API addresses this document by. */
  fileHash: string;
  fileName: string;
  bytes: Buffer;
}

/**
 * attachPdfToRecord — upload generated bytes to a screening record through the REAL
 * endpoint (multipart, field name `file`, exactly what PdfViewer.jsx posts), then read
 * the attachment back so the caller has the §73 content hash.
 *
 * Seeding through the API rather than the UI is the suite's established convention:
 * the upload interaction itself is covered by files-pdf.spec.ts's own upload specs.
 */
export async function attachPdfToRecord(
  request: APIRequestContext,
  siftPid: string,
  recordId: string,
  opts: MakePdfOptions & { fileName?: string } = {},
): Promise<AttachedPdf> {
  const bytes = makePdfBytes(opts);
  const fileName = opts.fileName || 'e2e-fixture.pdf';
  const up = await request.post(
    `/api/screening/projects/${encodeURIComponent(siftPid)}/records/${encodeURIComponent(recordId)}/pdf`,
    { multipart: { file: { name: fileName, mimeType: 'application/pdf', buffer: bytes } } },
  );
  expect(up.ok(), `attachPdfToRecord failed: ${up.status()} ${await up.text().catch(() => '')}`).toBeTruthy();

  const list = await request.get(
    `/api/screening/projects/${encodeURIComponent(siftPid)}/records/${encodeURIComponent(recordId)}/pdf`,
  );
  expect(list.ok(), `listPdf failed: ${list.status()}`).toBeTruthy();
  const att = ((await list.json()).attachments || [])[0];
  expect(att, 'no attachment came back after upload').toBeTruthy();
  return {
    recordId,
    attachmentId: att.id,
    fileHash: att.fileHash || '',
    fileName: att.fileName || fileName,
    bytes,
  };
}

/** Convenience: attach to the FIRST seeded record of a screening workspace. */
export async function attachPdfToFirstRecord(
  request: APIRequestContext,
  siftPid: string,
  opts: MakePdfOptions & { fileName?: string } = {},
): Promise<AttachedPdf> {
  const records = await listScreeningRecords(request, siftPid);
  expect(records.length, 'the screening fixture seeded no records').toBeGreaterThan(0);
  return attachPdfToRecord(request, siftPid, records[0].id, opts);
}

/* ─── Annotation API (used to seed a collaborator's highlight) ──────────────── */

export interface SeedAnnotation {
  id: string;
  clientId: string;
  color: string;
  comment: string;
  authorName: string;
}

/**
 * createAnnotation — POST one highlight through the real annotation endpoint.
 * `rects` are PDF user-space rectangles at scale 1, y-up (116.md §76): the default
 * covers the second text line of the fixture page, i.e. FIXTURE_SELECTABLE.
 */
export async function createAnnotation(
  request: APIRequestContext,
  siftPid: string,
  body: {
    docHash: string; page?: number; clientId?: string; color?: string; comment?: string;
    selectedText?: string; recordId?: string;
    rects?: Array<{ x0: number; y0: number; x1: number; y1: number }>;
  },
): Promise<SeedAnnotation> {
  const res = await request.post(`/api/screening/projects/${encodeURIComponent(siftPid)}/pdf-annotations`, {
    data: {
      page: 1,
      clientId: `an-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      color: 'yellow',
      selectedText: FIXTURE_SELECTABLE,
      rects: [{ x0: 72, y0: 678, x1: 420, y1: 692 }],
      ...body,
    },
  });
  expect(res.ok(), `createAnnotation failed: ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  return (await res.json()).annotation as SeedAnnotation;
}

/** GET the live annotation list for a document (tombstones excluded). */
export async function listAnnotations(
  request: APIRequestContext, siftPid: string, docHash: string,
): Promise<SeedAnnotation[]> {
  const res = await request.get(
    `/api/screening/projects/${encodeURIComponent(siftPid)}/pdf-annotations?docHash=${encodeURIComponent(docHash)}`,
  );
  expect(res.ok(), `listAnnotations failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).annotations as SeedAnnotation[];
}
