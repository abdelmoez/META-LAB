/**
 * screeningPdfController.js — per-article PDF attachments (Part 7).
 *
 * Storage: local filesystem at server/storage/screening-pdfs/<projectId>/<uuid>.pdf
 * (metadata in ScreenPdfAttachment). Future-ready for S3/Supabase: swap the
 * read/write helpers below — handlers only touch metadata + these two helpers.
 *
 * Security: members only; validates PDF mime + extension + %PDF magic bytes;
 * size-capped (25MB) so executables / oversized files are rejected. PDFs are
 * streamed through an authenticated route — never exposed as a public URL.
 */
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { prisma } from '../db/client.js';
import { getProjectAccess, writeAudit } from '../screening/access.js';
import { getMetaSiftSettings } from '../screening/settings.js';
import { extractDoiFromPdfBuffer, sha256, hashStoredPdf } from '../screening/pdfStorage.js';
import { setInlinePdfFramingHeaders } from '../screening/pdfFraming.js';
// 119.md §8 — project Logbook: PDF READS (uploads/removals already had audit rows).
import { recordSessionEvent, logbookActor } from '../logbook/logbookService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_ROOT = path.join(__dirname, '..', 'storage', 'screening-pdfs');
const MAX_BYTES = 25 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf' || !/\.pdf$/i.test(file.originalname)) {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  },
});

/** Express middleware: enforce the admin PDF toggle, run multer, clean up errors. */
export function pdfUploadMiddleware(req, res, next) {
  getMetaSiftSettings().then(settings => {
    if (settings.allowPdfUpload === false) {
      return res.status(403).json({ error: 'PDF upload is currently disabled by the administrator' });
    }
    upload.single('file')(req, res, err => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'PDF exceeds the 25MB limit' : (err.message || 'Upload failed');
        return res.status(400).json({ error: msg });
      }
      next();
    });
  }).catch(() => next());
}

function shape(a) {
  return {
    id: a.id, recordId: a.recordId, fileName: a.fileName,
    fileSize: a.fileSize, mimeType: a.mimeType, uploadedBy: a.uploadedBy, createdAt: a.createdAt,
    // 116.md §73 — the CONTENT identity of this PDF. The viewer needs it to ask for
    // the document's annotations (the attachment id is destroyed by every replace,
    // so it can never be the annotation key). Null on a legacy row whose bytes could
    // not be hashed — the client then degrades to "no annotations on this document".
    fileHash: a.fileHash || null,
  };
}

/**
 * 116.md §73 — make sure an attachment carries its content hash.
 *
 * Only the 68.md OA retrieval path ever wrote `fileHash`, so every manually
 * uploaded PDF predating 116 has null. Backfilling lazily (one disk read, then
 * persisted) is cheap and keeps the migration additive: nothing is rewritten at
 * load time, and a file missing from disk simply stays null instead of inventing
 * an identity. Never throws.
 */
async function ensureAttachmentHash(att) {
  if (!att) return null;
  if (att.fileHash) return att;
  const h = hashStoredPdf(att.projectId, att.storedName);
  if (!h) return att;
  try {
    await prisma.screenPdfAttachment.update({ where: { id: att.id }, data: { fileHash: h } });
  } catch { /* best-effort: a lost race just re-hashes on the next request */ }
  return { ...att, fileHash: h };
}

/** POST /projects/:pid/records/:rid/pdf — upload (replaces any existing PDF for the record). */
export async function uploadPdf(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.canScreen && !access.isLeader) {
      return res.status(403).json({ error: 'You do not have permission to attach files in this project' });
    }
    const rec = await prisma.screenRecord.findFirst({ where: { id: req.params.rid, projectId: access.project.id } });
    if (!rec) return res.status(404).json({ error: 'Record not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });

    // Defence-in-depth: verify the PDF magic bytes, not just the declared mime.
    const buf = req.file.buffer;
    if (!buf || buf.length < 5 || buf.slice(0, 5).toString('latin1') !== '%PDF-') {
      return res.status(400).json({ error: 'File is not a valid PDF' });
    }

    // Replace existing attachment(s) for this record (one current PDF per article).
    const existing = await prisma.screenPdfAttachment.findMany({ where: { recordId: rec.id } });
    for (const old of existing) {
      try { fs.unlinkSync(path.join(STORAGE_ROOT, old.projectId, old.storedName)); } catch {}
    }
    await prisma.screenPdfAttachment.deleteMany({ where: { recordId: rec.id } });

    const dir = path.join(STORAGE_ROOT, access.project.id);
    fs.mkdirSync(dir, { recursive: true });
    const storedName = `${randomUUID()}.pdf`;
    fs.writeFileSync(path.join(dir, storedName), buf);

    // Best-effort provenance: recover the DOI from the PDF bytes (no dependency).
    let resolvedDoi = null;
    try { resolvedDoi = extractDoiFromPdfBuffer(buf) || null; } catch { /* non-fatal */ }

    const att = await prisma.screenPdfAttachment.create({
      data: {
        projectId: access.project.id, recordId: rec.id,
        fileName: req.file.originalname.slice(0, 255),
        storedName, fileSize: buf.length, mimeType: 'application/pdf',
        uploadedBy: req.user.id,
        source: 'manual_upload', resolvedDoi, matchedBy: 'manual',
        // 116.md §73/D7 — compute the content hash for EVERY upload, not just the
        // OA path. This is the stable document identity annotations key on, and the
        // ETag the §95 caching path serves. Re-uploading identical bytes therefore
        // restores that document's annotations (§74).
        fileHash: sha256(buf),
      },
    });
    await writeAudit(access.project.id, req.user, 'PDF_UPLOADED', { entityType: 'record', entityId: rec.id, details: { fileName: att.fileName, fileSize: att.fileSize } });
    res.status(201).json({ attachment: shape(att) });
  } catch (err) {
    console.error('[screening] uploadPdf:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /projects/:pid/records/:rid/pdf — metadata for the record's attachment. */
export async function listPdf(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const atts = await prisma.screenPdfAttachment.findMany({ where: { projectId: access.project.id, recordId: req.params.rid } });
    // 116.md §73 — hand back a content hash for each attachment (backfilled lazily
    // for pre-116 rows) so the viewer can address this document's annotations.
    const hashed = [];
    for (const a of atts) hashed.push(await ensureAttachmentHash(a));
    res.json({ attachments: hashed.map(shape) });
  } catch (err) {
    console.error('[screening] listPdf:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /projects/:pid/records/:rid/pdf/:aid/download — stream the PDF inline to
 * project members only.
 *
 * Range-aware (BUG 3): browser PDF viewers (Chrome especially) issue Range
 * requests; a server that ignores them and returns a full chunked 200 triggers
 * "ERR_CONNECTION_RESET" in the embedded viewer. We advertise Accept-Ranges,
 * set Content-Length, and answer Range with 206 Partial Content + a bounded
 * createReadStream (so large PDFs are never buffered fully into memory).
 */
export async function downloadPdf(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    let att = await prisma.screenPdfAttachment.findFirst({
      where: { id: req.params.aid, projectId: access.project.id, recordId: req.params.rid },
    });
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    att = await ensureAttachmentHash(att);

    const filePath = path.join(STORAGE_ROOT, att.projectId, att.storedName);
    let stat;
    try { stat = fs.statSync(filePath); } catch { return res.status(404).json({ error: 'File missing on disk' }); }
    const total = stat.size;
    const safeName = String(att.fileName || 'document.pdf').replace(/["\\\r\n]/g, '');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    // 116.md §95 — validated caching. The bytes behind an attachment id are
    // immutable (a replace mints a NEW id), so a strong ETag over the content hash
    // lets a revisit revalidate with an empty 304 instead of re-downloading a
    // 12 MB file when the reviewer moves Screening → Conflict → Extraction.
    // `private` keeps it out of shared caches; `must-revalidate` keeps every hit
    // authenticated — this is never an insecure persistent cache (§95).
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    const etag = att.fileHash ? `"${att.fileHash}"` : '';
    if (etag) {
      res.setHeader('ETag', etag);
      const inm = String(req.headers['if-none-match'] || '');
      if (inm && inm.split(',').some((t) => t.trim() === etag || t.trim() === `W/${etag}`)) {
        setInlinePdfFramingHeaders(res);
        return res.status(304).end();
      }
    }
    // Allow the same-origin SPA to embed this PDF inline (see INLINE_PDF_CSP).
    setInlinePdfFramingHeaders(res);

    /* 119.md §8 "PDF upload, replacement, association, download, or removal" —
     * uploads/removals were audited, DOWNLOADS were not, so a leader could not
     * see who had read which full text. Recorded via the COALESCING writer on
     * purpose: a browser PDF viewer issues dozens of Range requests for one
     * document, and 40 rows for one reader opening one paper would be noise, not
     * a record. One session row per reader per document per 5 minutes, with the
     * request count in its metadata. Fire-and-forget; a 304 revalidation returns
     * above this point and is deliberately NOT logged as a fresh read. */
    void recordSessionEvent({
      action: 'FILE_DOWNLOADED',
      summary: `Opened the PDF "${att.fileName || 'document.pdf'}"`,
      resourceType: 'pdfAttachment', resourceId: att.id, resourceLabel: att.fileName || '',
      metadata: { recordId: req.params.rid, bytes: total, ranged: !!req.headers.range },
    }, logbookActor(req, access, { projectId: access.project.id, metaLabProjectId: access.project.linkedMetaLabProjectId || '' }));

    const onErr = () => { if (!res.headersSent) res.status(500); try { res.end(); } catch {} };

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] === '' ? 0 : parseInt(m[1], 10);
        const end   = m[2] === '' ? total - 1 : parseInt(m[2], 10);
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= total) {
          res.status(416).setHeader('Content-Range', `bytes */${total}`);
          return res.end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', end - start + 1);
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', onErr);
        return stream.pipe(res);
      }
    }

    res.setHeader('Content-Length', total);
    const stream = fs.createReadStream(filePath);
    stream.on('error', onErr);
    stream.pipe(res);
  } catch (err) {
    console.error('[screening] downloadPdf:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /projects/:pid/records/:rid/pdf/:aid — uploader or leader. */
export async function deletePdf(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const att = await prisma.screenPdfAttachment.findFirst({
      where: { id: req.params.aid, projectId: access.project.id, recordId: req.params.rid },
    });
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    if (att.uploadedBy !== req.user.id && !access.isLeader) {
      return res.status(403).json({ error: 'You cannot remove this attachment' });
    }
    try { fs.unlinkSync(path.join(STORAGE_ROOT, att.projectId, att.storedName)); } catch {}
    await prisma.screenPdfAttachment.delete({ where: { id: att.id } });
    await writeAudit(access.project.id, req.user, 'PDF_REMOVED', { entityType: 'record', entityId: req.params.rid });
    res.status(204).send();
  } catch (err) {
    console.error('[screening] deletePdf:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
