/**
 * fullTextController.js — automated OA full-text retrieval API (68.md P9).
 *
 * Every handler:
 *   1. flag-gates on `fullTextRetrieval` (404 when off — no existence leak),
 *   2. resolves screening-project access via getProjectAccess (member view),
 *   3. for the retrieval trigger + request mutation additionally requires
 *      isLeader || perms.canImportRecords.
 *
 * PDFs land in the EXISTING ScreenPdfAttachment store; provider details never
 * reach the client (only normalized statuses/urls the OA APIs published).
 */
import multer from 'multer';
import { prisma } from '../db/client.js';
import { getProjectAccess, writeAudit } from '../screening/access.js';
import { fullTextRetrievalEnabled, getFullTextSettings, coverage, maxPdfBytes } from '../fullText/fullTextService.js';
import { enqueueFullTextJob } from '../fullText/fullTextWorker.js';
import { savePdf } from '../screening/pdfStorage.js';
import { bestPdfMatch, AUTO_ATTACH_THRESHOLD } from '../../src/research-engine/screening/pdfMatching.js';

const MAX_RECORDS_PAGE = 500;

/**
 * Flag-gate + access resolve in one step. Returns the access context, or null
 * after having already written the 404 response (caller returns immediately).
 */
async function gate(req, res) {
  if (!(await fullTextRetrievalEnabled())) { res.status(404).json({ error: 'Not found' }); return null; }
  const access = await getProjectAccess(req.params.pid, req.user);
  if (!access) { res.status(404).json({ error: 'Project not found' }); return null; }
  return access;
}

/** Retrieval + request mutations need leader or the import-records permission. */
function canTrigger(access) {
  return !!(access.isLeader || (access.perms && access.perms.canImportRecords) || access.member?.canImportRecords);
}

/** Public-safe shape of a candidate row (provider status only; no internals). */
function shapeCandidate(c) {
  return {
    provider: c.provider,
    status: c.status,
    oaStatus: c.oaStatus || null,
    license: c.license || null,
    pdfUrl: c.pdfUrl || null,
    landingUrl: c.landingUrl || null,
    version: c.version || null,
    fetchedAt: c.fetchedAt,
  };
}

/** GET /:pid/status — coverage + settings-lite + last job. */
export async function getStatus(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const projectId = access.project.id;
    const [cov, settings, lastJob] = await Promise.all([
      coverage(projectId),
      getFullTextSettings(),
      prisma.fullTextRetrievalJob.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } }),
    ]);
    res.json({
      coverage: cov,
      settings: {
        enabled: settings.enabled,
        providerOrder: settings.providerOrder,
        maxPdfMb: settings.maxPdfMb,
        maxBulkUploadPdfs: settings.maxBulkUploadPdfs,
      },
      canTrigger: canTrigger(access),
      lastJob: lastJob ? shapeJob(lastJob) : null,
    });
  } catch (err) {
    console.error('[fulltext] getStatus:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Public-safe job shape (counts parsed). */
function shapeJob(j) {
  let counts = {};
  try { counts = JSON.parse(j.counts || '{}'); } catch { counts = {}; }
  return {
    id: j.id, scope: j.scope, status: j.status, stage: j.stage,
    processed: j.processed, total: j.total, counts,
    error: j.error || null,
    createdByName: j.createdByName || '',
    startedAt: j.startedAt, completedAt: j.completedAt, createdAt: j.createdAt,
  };
}

/** POST /:pid/retrieve { scope, recordIds? } → 202 job (reuses queued/running). */
export async function retrieve(req, res) {
  const access = await gate(req, res); if (!access) return;
  if (!canTrigger(access)) {
    return res.status(403).json({ error: 'You do not have permission to retrieve full texts in this project' });
  }
  try {
    const settings = await getFullTextSettings();
    if (settings.enabled === false) {
      return res.status(403).json({ error: 'Full-text retrieval is disabled by the administrator' });
    }
    const scope = ['included', 'selected', 'missing'].includes(req.body?.scope) ? req.body.scope : 'included';
    const recordIds = Array.isArray(req.body?.recordIds) ? req.body.recordIds.map(String).slice(0, 2000) : [];
    if (scope === 'selected' && !recordIds.length) {
      return res.status(400).json({ error: 'scope "selected" requires a non-empty recordIds array' });
    }
    const job = await enqueueFullTextJob(access.project.id, {
      scope, recordIds,
      createdById: req.user.id, createdByName: req.user.name || req.user.email || '',
    });
    await writeAudit(access.project.id, req.user, 'FULLTEXT_RETRIEVE', { entityType: 'project', entityId: access.project.id, details: { scope, jobId: job.id } });
    res.status(202).json({ job: shapeJob(job) });
  } catch (err) {
    console.error('[fulltext] retrieve:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /:pid/jobs/:jobId — one job's status. */
export async function getJob(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const job = await prisma.fullTextRetrievalJob.findFirst({
      where: { id: req.params.jobId, projectId: access.project.id },
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job: shapeJob(job) });
  } catch (err) {
    console.error('[fulltext] getJob:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /:pid/records?filter=missing|linkout|all — per-record retrieval state.
 * Each row: identifiers, attachment count, best candidate, request status.
 * Capped at 500 rows.
 */
export async function getRecords(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const projectId = access.project.id;
    const filter = ['missing', 'linkout', 'all'].includes(req.query.filter) ? req.query.filter : 'all';

    const records = await prisma.screenRecord.findMany({
      where: { projectId },
      select: { id: true, title: true, doi: true, pmid: true, year: true, finalStatus: true },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    const ids = records.map(r => r.id);
    const [atts, candidates, requests] = await Promise.all([
      prisma.screenPdfAttachment.findMany({ where: { projectId, recordId: { in: ids.length ? ids : ['__none__'] } }, select: { recordId: true } }),
      prisma.fullTextCandidate.findMany({ where: { projectId, recordId: { in: ids.length ? ids : ['__none__'] } }, orderBy: { fetchedAt: 'desc' } }),
      prisma.fullTextRequest.findMany({ where: { projectId, recordId: { in: ids.length ? ids : ['__none__'] } } }),
    ]);

    const attCount = new Map();
    for (const a of atts) attCount.set(a.recordId, (attCount.get(a.recordId) || 0) + 1);
    const bestCand = new Map();
    for (const c of candidates) {
      // First 'found' wins (candidates are newest-first); else keep the first seen.
      const cur = bestCand.get(c.recordId);
      if (!cur || (c.status === 'found' && cur.status !== 'found')) bestCand.set(c.recordId, c);
    }
    const reqByRecord = new Map(requests.map(r => [r.recordId, r]));

    let rows = records.map(r => {
      const cand = bestCand.get(r.id) || null;
      const count = attCount.get(r.id) || 0;
      const request = reqByRecord.get(r.id) || null;
      return {
        recordId: r.id,
        title: r.title,
        doi: r.doi || '',
        pmid: r.pmid || '',
        year: r.year || '',
        included: r.finalStatus === 'accepted',
        attachmentCount: count,
        bestCandidate: cand ? shapeCandidate(cand) : null,
        requestStatus: request ? request.status : 'none',
        requestNote: request ? (request.note || '') : '',
      };
    });

    if (filter === 'missing') rows = rows.filter(r => r.attachmentCount === 0);
    else if (filter === 'linkout') {
      rows = rows.filter(r => r.attachmentCount === 0 && r.bestCandidate && (r.bestCandidate.landingUrl || r.bestCandidate.pdfUrl));
    }

    const capped = rows.slice(0, MAX_RECORDS_PAGE);
    res.json({ records: capped, total: rows.length, capped: rows.length > MAX_RECORDS_PAGE });
  } catch (err) {
    console.error('[fulltext] getRecords:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /:pid/records/:rid/candidates — full candidate history for one record. */
export async function getCandidates(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const rec = await prisma.screenRecord.findFirst({ where: { id: req.params.rid, projectId: access.project.id }, select: { id: true } });
    if (!rec) return res.status(404).json({ error: 'Record not found' });
    const candidates = await prisma.fullTextCandidate.findMany({
      where: { projectId: access.project.id, recordId: req.params.rid },
      orderBy: { fetchedAt: 'desc' },
    });
    res.json({ candidates: candidates.map(shapeCandidate) });
  } catch (err) {
    console.error('[fulltext] getCandidates:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /:pid/records/:rid/request { status, note } — upsert the link-out / request
 * workflow row for a record with no OA copy. status ∈ requested|received|none.
 */
export async function upsertRequest(req, res) {
  const access = await gate(req, res); if (!access) return;
  if (!canTrigger(access)) {
    return res.status(403).json({ error: 'You do not have permission to update requests in this project' });
  }
  try {
    const status = ['requested', 'received', 'none'].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: 'status must be requested, received, or none' });
    const rec = await prisma.screenRecord.findFirst({ where: { id: req.params.rid, projectId: access.project.id }, select: { id: true } });
    if (!rec) return res.status(404).json({ error: 'Record not found' });
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 1000) : '';
    const row = await prisma.fullTextRequest.upsert({
      where: { projectId_recordId: { projectId: access.project.id, recordId: req.params.rid } },
      create: { projectId: access.project.id, recordId: req.params.rid, status, note, updatedById: req.user.id, updatedByName: req.user.name || req.user.email || '' },
      update: { status, note, updatedById: req.user.id, updatedByName: req.user.name || req.user.email || '' },
    });
    res.json({ request: { recordId: row.recordId, status: row.status, note: row.note || '' } });
  } catch (err) {
    console.error('[fulltext] upsertRequest:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/* ── Bulk PDF upload → match against records → auto-attach high-confidence ──── */

const bulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 500 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf' || !/\.pdf$/i.test(file.originalname)) {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  },
});

/**
 * Express middleware: runs multer for the 'files' array. The per-file count/size
 * caps come from admin settings (checked again in the handler; multer's static
 * caps are the hard ceiling). Cleans up multer errors into 400s.
 */
export function bulkUploadMiddleware(req, res, next) {
  bulkUpload.array('files', 500)(req, res, err => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'A PDF exceeds the size limit'
        : err.code === 'LIMIT_FILE_COUNT' ? 'Too many files'
        : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

/**
 * POST /:pid/bulk-upload — multipart 'files'. For each PDF, run the pure matching
 * engine against the project's records; auto-attach ONLY high-confidence matches
 * (confidence ≥ AUTO_ATTACH_THRESHOLD, and only when the record has no PDF yet).
 * Low-confidence / unmatched files are NOT persisted — the response tells the user
 * to attach them manually per record. This is the honest, safe default (a wrong
 * attachment is worse than none, and we never orphan a stored file).
 */
export async function bulkUpload_(req, res) {
  const access = await gate(req, res); if (!access) return;
  if (!canTrigger(access)) {
    return res.status(403).json({ error: 'You do not have permission to upload full texts in this project' });
  }
  try {
    const settings = await getFullTextSettings();
    if (settings.enabled === false) {
      return res.status(403).json({ error: 'Full-text retrieval is disabled by the administrator' });
    }
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded (field name must be "files")' });
    if (files.length > settings.maxBulkUploadPdfs) {
      return res.status(400).json({ error: `Too many files (max ${settings.maxBulkUploadPdfs} per upload)` });
    }
    const capBytes = maxPdfBytes(settings);

    const projectId = access.project.id;
    const records = await prisma.screenRecord.findMany({
      where: { projectId },
      select: { id: true, doi: true, pmid: true, title: true, year: true },
    });
    // Records that already have a PDF are never auto-overwritten.
    const atts = await prisma.screenPdfAttachment.findMany({ where: { projectId }, select: { recordId: true } });
    const hasPdf = new Set(atts.map(a => a.recordId));

    const results = [];
    let matched = 0;
    for (const file of files) {
      const buf = file.buffer;
      const filename = file.originalname || 'upload.pdf';
      if (!buf || buf.length < 5 || buf.slice(0, 5).toString('latin1') !== '%PDF-') {
        results.push({ filename, matched: false, reason: 'not a valid PDF' });
        continue;
      }
      if (buf.length > capBytes) {
        results.push({ filename, matched: false, reason: `exceeds ${settings.maxPdfMb}MB cap` });
        continue;
      }
      const best = bestPdfMatch({ filename, pdfText: buf.subarray(0, 200000).toString('latin1') }, records);
      if (!best || best.confidence < AUTO_ATTACH_THRESHOLD || best.disposition !== 'auto') {
        results.push({
          filename, matched: false,
          confidence: best ? Number(best.confidence.toFixed(2)) : 0,
          recordId: best ? best.recordId : null,
          reason: best ? 'confidence below auto-attach threshold — attach manually per record' : 'no matching record found',
        });
        continue;
      }
      if (hasPdf.has(best.recordId)) {
        results.push({ filename, matched: false, recordId: best.recordId, confidence: Number(best.confidence.toFixed(2)), reason: 'record already has a PDF' });
        continue;
      }
      const { storedName, fileSize } = savePdf(projectId, buf);
      const att = await prisma.screenPdfAttachment.create({
        data: {
          projectId, recordId: best.recordId,
          fileName: filename.slice(0, 255), storedName, fileSize, mimeType: 'application/pdf',
          uploadedBy: req.user.id,
          source: 'uploaded_matched', matchedBy: best.matchedBy, matchConfidence: best.confidence,
        },
      });
      hasPdf.add(best.recordId);
      matched++;
      results.push({ filename, matched: true, recordId: best.recordId, confidence: Number(best.confidence.toFixed(2)), matchedBy: best.matchedBy, attachmentId: att.id });
    }

    await writeAudit(projectId, req.user, 'FULLTEXT_BULK_UPLOAD', { entityType: 'project', entityId: projectId, details: { files: files.length, matched } });
    res.json({
      matched, total: files.length, results,
      note: 'Only high-confidence matches were attached automatically. Unmatched or low-confidence PDFs were NOT stored — attach them from each record\'s page.',
    });
  } catch (err) {
    console.error('[fulltext] bulkUpload:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
