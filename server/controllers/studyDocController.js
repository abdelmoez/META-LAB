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
import { touchProjectActivity, mutateProjectBlob } from '../store.js';
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

/**
 * True if any OTHER reference in the blob still points at this storedName (dedupe
 * safety). Scans BOTH stores: the primary `study.document` pointer and every entry
 * of the additive multi-file `study.documents[]` (83.md-limitation fix), except the
 * one being removed (identified by studyId and, for a documents[] entry, its docId).
 */
function referencedElsewhere(studies, storedName, exceptStudyId, exceptDocId = null) {
  return studies.some((s) => {
    if (!s) return false;
    const primaryHit = s.document && s.document.storedName === storedName
      && !(s.id === exceptStudyId && exceptDocId == null);
    if (primaryHit) return true;
    const docs = Array.isArray(s.documents) ? s.documents : [];
    return docs.some((d) => d && d.storedName === storedName
      && !(s.id === exceptStudyId && exceptDocId != null && d.id === exceptDocId));
  });
}

/** 83.md-limitation fix — additional publication files (supplement/protocol/…). */
const DOC_LABELS = ['supplement', 'protocol', 'secondary', 'abstract', 'other'];
const MAX_EXTRA_DOCS = 12;

function shapeExtraDoc(d) {
  if (!d || !d.storedName) return null;
  return { ...shapeDoc(d), id: d.id || null, label: DOC_LABELS.includes(d.label) ? d.label : 'other' };
}

/** Content-dedupe: find a trusted stored twin of `hash` anywhere in the blob. */
function findTwinStoredName(studies, hash) {
  for (const s of studies) {
    if (!s) continue;
    if (s.document && s.document.fileHash === hash && isSafeStoredName(s.document.storedName)) {
      return { storedName: s.document.storedName, fileSize: s.document.fileSize || 0 };
    }
    for (const d of (Array.isArray(s.documents) ? s.documents : [])) {
      if (d && d.fileHash === hash && isSafeStoredName(d.storedName)) {
        return { storedName: d.storedName, fileSize: d.fileSize || 0 };
      }
    }
  }
  return null;
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
    // re-uploading the same PDF never writes a second binary. Only a twin whose
    // storedName is a trusted server-generated name is adopted; scans document +
    // documents[] stores.
    let storedName = null, fileSize = buf.length;
    const twin = findTwinStoredName(data.studies, hash);
    if (twin) { storedName = twin.storedName; fileSize = twin.fileSize || buf.length; }
    else { const saved = saveStudyDoc(access.project.id, buf); storedName = saved.storedName; fileSize = saved.fileSize; }

    const document = {
      storedName, fileName: String(req.file.originalname || 'document.pdf').slice(0, 255), fileHash: hash,
      fileSize, mimeType: 'application/pdf',
      uploadedBy: access.userId, uploadedByName: access.userName || '', uploadedAt: new Date().toISOString(),
    };
    // 86.md P1.15/P1.16/P2.88 — the pointer write goes through the CAS helper so a
    // concurrent studies autosave can't clobber it (or be clobbered by it), and the
    // rev bump makes a stale client autosave 409. Disk I/O stays OUT of the (retryable)
    // mutate; the replaced file is unlinked AFTER the commit (was before — a failed
    // write left the file gone but the pointer intact).
    const outcome = await mutateProjectBlob(access.project.id, (d) => {
      if (!Array.isArray(d.studies)) d.studies = [];
      const i = d.studies.findIndex((s) => s && s.id === req.params.studyId);
      if (i < 0) return { result: { status: 404, prev: null }, commit: false };
      const prev = d.studies[i].document || null;
      d.studies[i] = { ...d.studies[i], document };
      return { result: { status: 201, prev } };
    });
    if (!outcome) return res.status(404).json({ error: 'Project not found' });
    if (outcome.result.status === 404) return res.status(404).json({ error: 'Study not found' });
    const prev = outcome.result.prev;
    if (prev && isSafeStoredName(prev.storedName) && prev.storedName !== storedName &&
        !referencedElsewhere(outcome.project.studies, prev.storedName, req.params.studyId)) {
      deleteStudyDocFile(access.project.id, prev.storedName);
    }
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

    // 86.md P1.15/P1.16/P2.88 — remove the pointer through the CAS helper; unlink the
    // file only AFTER the commit and only when the committed blob no longer references it.
    const outcome = await mutateProjectBlob(access.project.id, (d) => {
      if (!Array.isArray(d.studies)) d.studies = [];
      const i = d.studies.findIndex((s) => s && s.id === req.params.studyId);
      if (i < 0) return { result: { status: 404 }, commit: false };
      const cur = d.studies[i].document;
      if (!cur || !cur.storedName) return { result: { status: 404, gone: true }, commit: false };
      const { document, ...rest } = d.studies[i]; // eslint-disable-line no-unused-vars
      d.studies[i] = rest;
      return { result: { status: 200, removedStoredName: cur.storedName } };
    });
    if (!outcome) return res.status(404).json({ error: 'Project not found' });
    if (outcome.result.status === 404) return res.status(404).json({ error: outcome.result.gone ? 'No document for this study' : 'Study not found' });
    const removedName = outcome.result.removedStoredName;
    if (removedName && isSafeStoredName(removedName) && !referencedElsewhere(outcome.project.studies, removedName, req.params.studyId)) {
      deleteStudyDocFile(access.project.id, removedName);
    }
    res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('[study-doc] deleteStudyDoc:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/* ── 83.md-limitation fix — MULTIPLE publication files per study ──────────────
   A study may carry a main article (`study.document`) PLUS supplements, protocols,
   secondary publications… stored additively in `study.documents[]` (same on-disk
   store, content-deduped by hash, reference-counted deletes). Every outcome of the
   paper can read any of them; adding an outcome never requires re-uploading. */

/** GET /api/projects/:id/studies/:studyId/documents — { primary, documents } */
export async function listStudyDocs(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    const ml = await prisma.project.findFirst({ where: { id: access.project.id, deletedAt: null } });
    if (!ml) return res.status(404).json({ error: 'Project not found' });
    const data = parseData(ml);
    const study = (data.studies || []).find((s) => s && s.id === req.params.studyId);
    if (!study) return res.status(404).json({ error: 'Study not found' });
    const docs = (Array.isArray(study.documents) ? study.documents : []).map(shapeExtraDoc).filter(Boolean);
    res.json({ primary: shapeDoc(study.document), documents: docs });
  } catch (err) {
    console.error('[study-doc] listStudyDocs:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/projects/:id/studies/:studyId/documents (multipart file + label) → { document } */
export async function uploadExtraStudyDoc(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You do not have permission to attach files in this project' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });
    const buf = req.file.buffer;
    if (!isPdfBuffer(buf)) return res.status(400).json({ error: 'File is not a valid PDF' });
    const label = DOC_LABELS.includes(req.body && req.body.label) ? req.body.label : 'other';

    const ml = await prisma.project.findFirst({ where: { id: access.project.id, deletedAt: null } });
    if (!ml) return res.status(404).json({ error: 'Project not found' });
    const data = parseData(ml);
    if (!Array.isArray(data.studies)) data.studies = [];
    const idx = data.studies.findIndex((s) => s && s.id === req.params.studyId);
    if (idx < 0) return res.status(404).json({ error: 'Study not found' });
    const existingDocs = Array.isArray(data.studies[idx].documents) ? data.studies[idx].documents : [];
    if (existingDocs.length >= MAX_EXTRA_DOCS) {
      return res.status(400).json({ error: `A study can carry at most ${MAX_EXTRA_DOCS} additional files` });
    }

    const hash = sha256(buf);
    let storedName = null, fileSize = buf.length;
    const twin = findTwinStoredName(data.studies, hash);
    if (twin) { storedName = twin.storedName; fileSize = twin.fileSize || buf.length; }
    else { const saved = saveStudyDoc(access.project.id, buf); storedName = saved.storedName; fileSize = saved.fileSize; }

    const document = {
      id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      storedName, fileName: String(req.file.originalname || 'document.pdf').slice(0, 255), fileHash: hash,
      fileSize, mimeType: 'application/pdf',
      uploadedBy: access.userId, uploadedByName: access.userName || '', uploadedAt: new Date().toISOString(),
    };
    // 86.md P1.15/P1.16/P2.88 — CAS-protected append of the extra-document entry.
    const outcome = await mutateProjectBlob(access.project.id, (d) => {
      if (!Array.isArray(d.studies)) d.studies = [];
      const i = d.studies.findIndex((s) => s && s.id === req.params.studyId);
      if (i < 0) return { result: { status: 404 }, commit: false };
      const cur = Array.isArray(d.studies[i].documents) ? d.studies[i].documents : [];
      if (cur.length >= MAX_EXTRA_DOCS) return { result: { status: 400 }, commit: false };
      d.studies[i] = { ...d.studies[i], documents: [...cur, document] };
      return { result: { status: 201 } };
    });
    if (!outcome) return res.status(404).json({ error: 'Project not found' });
    if (outcome.result.status === 404) return res.status(404).json({ error: 'Study not found' });
    if (outcome.result.status === 400) return res.status(400).json({ error: `A study can carry at most ${MAX_EXTRA_DOCS} additional files` });
    res.status(201).json({ document: shapeExtraDoc(document) });
  } catch (err) {
    console.error('[study-doc] uploadExtraStudyDoc:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/projects/:id/studies/:studyId/documents/:docId/download — stream inline. */
export async function downloadExtraStudyDoc(req, res) {
  try {
    const access = await resolveExtractionAccess(req.params.id, req.user);
    if (!access || !access.canView) return res.status(404).json({ error: 'Project not found' });
    const ml = await prisma.project.findFirst({ where: { id: access.project.id, deletedAt: null } });
    if (!ml) return res.status(404).json({ error: 'Project not found' });
    const data = parseData(ml);
    const study = (data.studies || []).find((s) => s && s.id === req.params.studyId);
    const doc = study && (Array.isArray(study.documents) ? study.documents : []).find((d) => d && d.id === req.params.docId);
    if (!doc || !doc.storedName || !isSafeStoredName(doc.storedName)) return res.status(404).json({ error: 'No such file for this study' });

    const filePath = studyDocPath(access.project.id, doc.storedName);
    let stat;
    try { stat = fs.statSync(filePath); } catch { return res.status(404).json({ error: 'File missing on disk' }); }
    const safeName = String(doc.fileName || 'document.pdf').replace(/["\\\r\n]/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    setInlinePdfFramingHeaders(res);
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { if (!res.headersSent) res.status(500); try { res.end(); } catch { /* noop */ } });
    stream.pipe(res);
  } catch (err) {
    console.error('[study-doc] downloadExtraStudyDoc:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
}

/** DELETE /api/projects/:id/studies/:studyId/documents/:docId — remove one file entry. */
export async function deleteExtraStudyDoc(req, res) {
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
    const docs = Array.isArray(data.studies[idx].documents) ? data.studies[idx].documents : [];
    const doc = docs.find((d) => d && d.id === req.params.docId);
    if (!doc) return res.status(404).json({ error: 'No such file for this study' });

    // 86.md P1.15/P1.16/P2.88 — CAS-protected removal; unlink after commit.
    const outcome = await mutateProjectBlob(access.project.id, (d) => {
      if (!Array.isArray(d.studies)) d.studies = [];
      const i = d.studies.findIndex((s) => s && s.id === req.params.studyId);
      if (i < 0) return { result: { status: 404 }, commit: false };
      const curDocs = Array.isArray(d.studies[i].documents) ? d.studies[i].documents : [];
      const target = curDocs.find((x) => x && x.id === req.params.docId);
      if (!target) return { result: { status: 404, gone: true }, commit: false };
      d.studies[i] = { ...d.studies[i], documents: curDocs.filter((x) => x && x.id !== req.params.docId) };
      return { result: { status: 200, removedStoredName: target.storedName } };
    });
    if (!outcome) return res.status(404).json({ error: 'Project not found' });
    if (outcome.result.status === 404) return res.status(404).json({ error: outcome.result.gone ? 'No such file for this study' : 'Study not found' });
    const removedName = outcome.result.removedStoredName;
    if (removedName && isSafeStoredName(removedName) && !referencedElsewhere(outcome.project.studies, removedName, req.params.studyId, req.params.docId)) {
      deleteStudyDocFile(access.project.id, removedName);
    }
    res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('[study-doc] deleteExtraStudyDoc:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export { STUDY_DOC_ROOT };
