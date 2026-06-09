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
  };
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

    const att = await prisma.screenPdfAttachment.create({
      data: {
        projectId: access.project.id, recordId: rec.id,
        fileName: req.file.originalname.slice(0, 255),
        storedName, fileSize: buf.length, mimeType: 'application/pdf',
        uploadedBy: req.user.id,
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
    res.json({ attachments: atts.map(shape) });
  } catch (err) {
    console.error('[screening] listPdf:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /projects/:pid/records/:rid/pdf/:aid/download — stream the file to members only. */
export async function downloadPdf(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const att = await prisma.screenPdfAttachment.findFirst({
      where: { id: req.params.aid, projectId: access.project.id, recordId: req.params.rid },
    });
    if (!att) return res.status(404).json({ error: 'Attachment not found' });
    const filePath = path.join(STORAGE_ROOT, att.projectId, att.storedName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${att.fileName.replace(/"/g, '')}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('[screening] downloadPdf:', err.message);
    res.status(500).json({ error: 'Internal server error' });
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
