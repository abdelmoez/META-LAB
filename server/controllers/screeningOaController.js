/**
 * screeningOaController.js — OA PDF retrieval + uploaded-PDF matching (1.4).
 *
 * - oaRetrieve: for records with a DOI, resolve a legitimately open-access PDF
 *   (Unpaywall→OpenAlex→CrossRef), download it (size + %PDF magic checks), and
 *   attach via the shared storage path with full provenance. Flag-gated
 *   (autoPdfRetrieval, default OFF) → inert in production until an admin enables
 *   it. Never overwrites a manually-uploaded PDF. Bounded per call.
 * - matchPdfs: suggest the best record for each uploaded-PDF descriptor using
 *   the pure matching engine (no side effects; for the review queue).
 *
 * SAFETY: only OA PDFs are fetched; OA failure never throws and never blocks.
 */
import { prisma } from '../db/client.js';
import { getProjectAccess, writeAudit } from '../screening/access.js';
import { getMetaSiftSettings } from '../screening/settings.js';
import { createOaResolver, loadOaConfig, OA_STATUS } from '../services/oaPdfResolver.js';
import { savePdf, deletePdfFile, isPdfBuffer, MAX_PDF_BYTES } from '../screening/pdfStorage.js';
import { bestPdfMatch } from '../../src/research-engine/screening/pdfMatching.js';

const MAX_PER_CALL = 25;   // bound request time (no job queue); client paginates
const MAX_MATCH = 200;

async function fetchOaPdf(url, fetchFn, maxBytes) {
  let res;
  try { res = await fetchFn(url, { redirect: 'follow' }); }
  catch (e) { return { ok: false, error: `fetch failed: ${e.message}` }; }
  if (!res || !res.ok) return { ok: false, error: `HTTP ${res ? res.status : 'no-response'}` };
  const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) return { ok: false, error: 'PDF exceeds size limit' };
  if (!isPdfBuffer(buf)) return { ok: false, error: `not a PDF (content-type ${ct || 'unknown'})` };
  return { ok: true, buffer: buf };
}

/** POST /projects/:pid/oa-retrieve — body: { recordIds?: string[] } */
export async function oaRetrieve(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.canScreen && !access.isLeader) {
      return res.status(403).json({ error: 'You do not have permission to attach files in this project' });
    }
    const settings = await getMetaSiftSettings();
    const cfg = loadOaConfig(process.env, settings);
    if (!cfg.enabled) {
      return res.status(403).json({ error: 'Open-access PDF retrieval is disabled by the administrator', oaStatus: OA_STATUS.SKIPPED_FEATURE_DISABLED });
    }

    const projectId = access.project.id;
    const ids = Array.isArray(req.body?.recordIds) ? req.body.recordIds.slice(0, MAX_PER_CALL) : null;
    const where = { projectId, doi: { not: '' } };
    if (ids) where.id = { in: ids };
    const records = await prisma.screenRecord.findMany({
      where, select: { id: true, doi: true }, take: ids ? MAX_PER_CALL : MAX_PER_CALL,
    });

    const existing = await prisma.screenPdfAttachment.findMany({
      where: { projectId, recordId: { in: records.map(r => r.id) } },
      select: { recordId: true, source: true },
    });
    const hasManual = new Set(existing.filter(a => a.source === 'manual_upload').map(a => a.recordId));

    const resolver = createOaResolver(cfg);
    const fetchFn = globalThis.fetch;
    const results = [];
    let attached = 0, notFound = 0, skipped = 0, failed = 0;

    for (const rec of records) {
      if (hasManual.has(rec.id)) { skipped++; results.push({ recordId: rec.id, status: 'skipped_manual' }); continue; }
      const r = await resolver.resolve(rec.doi);
      if (r.status !== OA_STATUS.FOUND) {
        if (r.status === OA_STATUS.NOT_FOUND) notFound++; else skipped++;
        results.push({ recordId: rec.id, status: r.status });
        continue;
      }
      const dl = await fetchOaPdf(r.url, fetchFn, MAX_PDF_BYTES);
      if (!dl.ok) { failed++; results.push({ recordId: rec.id, status: 'failed', error: dl.error }); continue; }

      // Replace any prior OA attachment for this record (manual ones were skipped above).
      const prev = await prisma.screenPdfAttachment.findMany({ where: { recordId: rec.id } });
      for (const old of prev) deletePdfFile(projectId, old.storedName);
      await prisma.screenPdfAttachment.deleteMany({ where: { recordId: rec.id } });

      const { storedName, fileSize } = savePdf(projectId, dl.buffer);
      const att = await prisma.screenPdfAttachment.create({
        data: {
          projectId, recordId: rec.id,
          fileName: `${String(r.doi || 'oa').replace(/[^\w.-]/g, '_')}.pdf`.slice(0, 255),
          storedName, fileSize, mimeType: 'application/pdf', uploadedBy: req.user.id,
          source: `oa_${r.provider}`, oaStatus: OA_STATUS.FOUND, sourceUrl: r.url,
          resolvedDoi: r.doi, matchedBy: 'doi', matchConfidence: 0.99, retrievalAttemptedAt: new Date(),
        },
      });
      await writeAudit(projectId, req.user, 'PDF_OA_ATTACHED', { entityType: 'record', entityId: rec.id, details: { provider: r.provider, doi: r.doi } });
      attached++;
      results.push({ recordId: rec.id, status: 'attached', provider: r.provider, attachmentId: att.id });
    }

    res.json({ attached, notFound, skipped, failed, processed: records.length, results });
  } catch (err) {
    console.error('[screening] oaRetrieve:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /projects/:pid/match-pdfs — body: { pdfs: [{ filename?, doi?, pmid?, title?, year? }] } */
export async function matchPdfs(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    const pdfs = Array.isArray(req.body?.pdfs) ? req.body.pdfs.slice(0, MAX_MATCH) : [];
    const records = await prisma.screenRecord.findMany({
      where: { projectId: access.project.id },
      select: { id: true, doi: true, pmid: true, title: true, year: true },
    });
    const suggestions = pdfs.map(p => {
      const best = bestPdfMatch({ filename: p.filename, doi: p.doi, pmid: p.pmid, title: p.title, year: p.year }, records);
      return {
        filename: p.filename || null,
        match: best ? { recordId: best.recordId, confidence: best.confidence, matchedBy: best.matchedBy, disposition: best.disposition } : null,
        candidates: best ? best.candidates : [],
      };
    });
    res.json({ suggestions });
  } catch (err) {
    console.error('[screening] matchPdfs:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
