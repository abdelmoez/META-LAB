/**
 * studyDocController.js — 77.md §5 follow-up: persistent, cross-engine PDFs for
 * META·LAB studies that are NOT screening-linked (manually-added extraction studies).
 *
 * Canonical model (no schema migration): the PDF bytes live on disk (studyDocStorage),
 * and the authoritative pointer rides in the study blob as `study.document`
 * ({ storedName, fileName, fileHash, fileSize, mimeType, uploadedBy, uploadedByName,
 *    uploadedAt }). The server writes it durably into Project.data (so it survives an
 * immediate reload) AND returns it so the client stamps its in-memory blob (so a
 * whole-blob autosave can't clobber it — same merge pattern the extraction engine uses
 * for completion state). One PDF location per study: a screening-linked study uses its
 * ScreenPdfAttachment; a manual study uses this store — never both.
 *
 * Access mirrors the extraction engine: owner or linked-workspace member; canView to
 * read/download, canEdit to upload/replace/delete. PDFs are streamed through this
 * authenticated route (Range-aware), never a public URL; uploads are magic-byte +
 * size validated.
 */
import multer from 'multer';
import fs from 'fs';
import { prisma } from '../db/client.js';
import { resolveExtractionAccess } from '../extraction/access.js';
import { touchProjectActivity } from '../store.js';
import { setInlinePdfFramingHeaders } from '../screening/pdfFraming.js';
import {
  STUDY_DOC_ROOT, MAX_STUDY_DOC_BYTES, isPdfBuffer, sha256, studyDocPath, saveStudyDoc, deleteStudyDocFile, isSafeStoredName,
} from '../studyDocs/studyDocStorage.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_STUDY_DOC_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf' || !/\.pdf$/i.test(file.originalname)) {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  },
});

/** Express middleware: run multer for the single 'file' field, mapping errors to 4xx. */
export function studyDocUploadMiddleware(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'PDF exceeds the 25MB limit' : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

function parseData(project) {
  try { const d = JSON.parse(project.data || '{}'); return d && typeof d === 'object' ? d : {}; }
  catch { return {}; }
}

function shapeDoc(d) {
  if (!d || !d.storedName) return null;
  return {
    storedName: d.storedName, fileName: d.fileName || 'document.pdf', fileHash: d.fileHash || null,
    fileSize: d.fileSize || 0, mimeType: d.mimeType || 'application/pdf',
    uploadedBy: d.uploadedBy || null, uploadedByName: d.uploadedByName || '', uploadedAt: d.uploadedAt || null,
  };
}

/** True if any OTHER study in the blob still references this storedName (dedupe safety). */
function referencedElsewhere(studies, storedName, exceptStudyId) {
  return studies.some((s) => s && s.id !== exceptStudyId && s.document && s.document.storedName === storedName);
}

/** POST /api/projects/:id/studies/:studyId/document — upload/replace this study's PDF. */
export async function uploadStudyDoc(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You do not have permission to attach files in this project' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });
    const buf = req.file.buffer;
    if (!isPdfBuffer(buf)) return res.status(400).json({ error: 'File is not a valid PDF' });

    // Load the freshest blob and locate the study.
    const ml = await prisma.project.findFirst({ where: { id: access.project.id, deletedAt: null } });
    if (!ml) return res.status(404).json({ error: 'Project not found' });
    const data = parseData(ml);
    if (!Array.isArray(data.studies)) data.studies = [];
    const idx = data.studies.findIndex((s) => s && s.id === req.params.studyId);
    if (idx < 0) return res.status(404).json({ error: 'Study not found' });

    const hash = sha256(buf);
    // Content-dedupe within the project: reuse an identical file already stored, so
    // re-uploading the same PDF never writes a second binary.
    let storedName = null, fileSize = buf.length;
    // Only reuse a twin whose storedName is a trusted server-generated name (a crafted blob
    // storedName must never be adopted).
    const twin = data.studies.find((s) => s && s.document && s.document.fileHash === hash && isSafeStoredName(s.document.storedName));
    if (twin) { storedName = twin.document.storedName; fileSize = twin.document.fileSize || buf.length; }
    else { const saved = saveStudyDoc(access.project.id, buf); storedName = saved.storedName; fileSize = saved.fileSize; }

    // Replace: if this study already had a DIFFERENT stored file that nothing else uses, remove it.
    const prev = data.studies[idx].document;
    if (prev && isSafeStoredName(prev.storedName) && prev.storedName !== storedName && !referencedElsewhere(data.studies, prev.storedName, req.params.studyId)) {
      deleteStudyDocFile(access.project.id, prev.storedName);
    }

    const document = {
      storedName, fileName: String(req.file.originalname || 'document.pdf').slice(0, 255), fileHash: hash,
      fileSize, mimeType: 'application/pdf',
      uploadedBy: access.userId, uploadedByName: access.userName || '', uploadedAt: new Date().toISOString(),
    };
    data.studies[idx] = { ...data.studies[idx], document };
    await prisma.project.update({ where: { id: ml.id }, data: { data: JSON.stringify(data), lastSavedAt: new Date() } });
    try { await touchProjectActivity(ml.id); } catch { /* best-effort */ }
    res.status(201).json({ document: shapeDoc(document) });
  } catch (err) {
    console.error('[study-doc] uploadStudyDoc:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/projects/:id/studies/:studyId/document — metadata only. */
export async function getStudyDoc(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    const ml = await prisma.project.findFirst({ where: { id: access.project.id, deletedAt: null } });
    if (!ml) return res.status(404).json({ error: 'Project not found' });
    const data = parseData(ml);
    const study = (data.studies || []).find((s) => s && s.id === req.params.studyId);
    if (!study) return res.status(404).json({ error: 'Study not found' });
    res.json({ document: shapeDoc(study.document) });
  } catch (err) {
    console.error('[study-doc] getStudyDoc:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/projects/:id/studies/:studyId/document/download — stream inline (Range-aware). */
export async function downloadStudyDoc(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    const ml = await prisma.project.findFirst({ where: { id: access.project.id, deletedAt: null } });
    if (!ml) return res.status(404).json({ error: 'Project not found' });
    const data = parseData(ml);
    const study = (data.studies || []).find((s) => s && s.id === req.params.studyId);
    const doc = study && study.document;
    if (!doc || !doc.storedName) return res.status(404).json({ error: 'No document for this study' });
    if (!isSafeStoredName(doc.storedName)) return res.status(404).json({ error: 'No document for this study' });

    // storedName is validated to a server-generated uuid — resolve within the project dir.
    const filePath = studyDocPath(access.project.id, doc.storedName);
    let stat;
    try { stat = fs.statSync(filePath); } catch { return res.status(404).json({ error: 'File missing on disk' }); }
    const total = stat.size;
    const safeName = String(doc.fileName || 'document.pdf').replace(/["\\\r\n]/g, '');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    setInlinePdfFramingHeaders(res);

    const onErr = () => { if (!res.headersSent) res.status(500); try { res.end(); } catch { /* noop */ } };
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] === '' ? 0 : parseInt(m[1], 10);
        const end = m[2] === '' ? total - 1 : parseInt(m[2], 10);
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
    console.error('[study-doc] downloadStudyDoc:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/projects/:id/studies/:studyId/document — remove the association + file. */
export async function deleteStudyDoc(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You do not have permission to remove files in this project' });
    const ml = await prisma.project.findFirst({ where: { id: access.project.id, deletedAt: null } });
    if (!ml) return res.status(404).json({ error: 'Project not found' });
    const data = parseData(ml);
    if (!Array.isArray(data.studies)) data.studies = [];
    const idx = data.studies.findIndex((s) => s && s.id === req.params.studyId);
    if (idx < 0) return res.status(404).json({ error: 'Study not found' });
    const doc = data.studies[idx].document;
    if (!doc || !doc.storedName) return res.status(404).json({ error: 'No document for this study' });

    const { document, ...rest } = data.studies[idx]; // eslint-disable-line no-unused-vars
    data.studies[idx] = rest;
    // Only unlink a trusted server-generated file, and only when nothing else references it.
    if (isSafeStoredName(doc.storedName) && !referencedElsewhere(data.studies, doc.storedName, req.params.studyId)) {
      deleteStudyDocFile(access.project.id, doc.storedName);
    }
    await prisma.project.update({ where: { id: ml.id }, data: { data: JSON.stringify(data), lastSavedAt: new Date() } });
    try { await touchProjectActivity(ml.id); } catch { /* best-effort */ }
    res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('[study-doc] deleteStudyDoc:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export { STUDY_DOC_ROOT };
