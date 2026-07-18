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
import { bestPdfMatch, normalizeDoi } from '../../src/research-engine/screening/pdfMatching.js';
import { pmidToDoi } from '../services/pmidToDoi.js';
import { DOWNLOAD_TIMEOUT_MS, timeoutSignal, describeFetchError, readBodyCapped } from '../utils/fetchTimeout.js';

const MAX_PER_CALL = 25;   // bound request time (no job queue); client paginates
const MAX_MATCH = 200;
// 93.md Phase 10 — hard wall-clock bound on a single OA PDF download. Without
// it a wedged CDN socket pinned the request handler indefinitely.
const PDF_DOWNLOAD_TIMEOUT_MS = Number(process.env.OA_DOWNLOAD_TIMEOUT_MS) || DOWNLOAD_TIMEOUT_MS;

// One shared resolver → its TTL cache + rate-limiter persist across requests
// (a per-request resolver would never hit the cache). The DOI→OA-URL result does
// not depend on the email (just a polite-pool identifier), so cross-user caching
// is correct. The per-request flag + the user's email are passed to resolve().
const resolver = createOaResolver(loadOaConfig());

// 93.md Phase 10 — timeout-bounded, size-capped-DURING-streaming download.
// Previously this buffered the entire body (arrayBuffer) and only THEN checked
// maxBytes, so an oversized/hostile host could push arbitrary bytes into memory;
// and the bare fetch had no timeout. Error semantics are unchanged: always
// returns { ok:false, error } (never throws) so both call sites keep working.
async function fetchOaPdf(url, fetchFn, maxBytes) {
  let res;
  try { res = await fetchFn(url, { redirect: 'follow', signal: timeoutSignal(PDF_DOWNLOAD_TIMEOUT_MS) }); }
  catch (e) { return { ok: false, error: `fetch failed: ${describeFetchError(e, PDF_DOWNLOAD_TIMEOUT_MS)}` }; }
  if (!res || !res.ok) return { ok: false, error: `HTTP ${res ? res.status : 'no-response'}` };
  const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
  // Fast reject when the host declares an oversized body up front.
  const declared = Number(res.headers && res.headers.get && res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, error: 'PDF exceeds size limit' };
  const read = await readBodyCapped(res, maxBytes);
  if (!read.ok) return { ok: false, error: read.error };
  const buf = read.buffer;
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
    // The OA provider (Unpaywall) requires an email; we send the REQUESTING
    // user's account email as the polite-pool identifier — the user's own
    // account is what is "linked" to the lookup service. Env email is a fallback.
    const userEmail = (req.user && req.user.email) || cfg.unpaywallEmail || '';
    if (!userEmail) {
      return res.status(400).json({ error: 'Your account has no email on file, which the open-access provider requires. Add an email to your account and try again.' });
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

    const fetchFn = globalThis.fetch;
    const results = [];
    let attached = 0, notFound = 0, skipped = 0, failed = 0;

    for (const rec of records) {
      if (hasManual.has(rec.id)) { skipped++; results.push({ recordId: rec.id, status: 'skipped_manual' }); continue; }
      const r = await resolver.resolve(rec.doi, { email: userEmail, enabled: true });
      if (r.status !== OA_STATUS.FOUND) {
        if (r.status === OA_STATUS.NOT_FOUND) notFound++; else skipped++;
        results.push({ recordId: rec.id, status: r.status });
        continue;
      }
      const dl = await fetchOaPdf(r.url, fetchFn, MAX_PDF_BYTES);
      // prompt29 Part 3 — a link WAS found but the bytes could not be downloaded
      // (paywalled CDN, hotlink protection, non-PDF, too large…). Surface the
      // found source URL + provider so the UI can offer "open the source link"
      // and a retry. NOTE: no attachment is created here — nothing is marked
      // attached on a failed download.
      if (!dl.ok) { failed++; results.push({ recordId: rec.id, status: 'failed', error: dl.error, sourceUrl: r.url || null, provider: r.provider || null }); continue; }

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

/**
 * POST /projects/:pid/records/:rid/oa-retrieve — single-record OA retrieval for
 * the extraction workspace. Same flag / rate-limit / email / auth as the bulk
 * path; resolves the one record's DOI (falling back to PMID→DOI when only a PMID
 * exists), reuses the shared resolver + fetchOaPdf + savePdf, persists a
 * ScreenPdfAttachment with source 'oa_<provider>' + provenance, and NEVER
 * overwrites a manual upload.
 *
 * body: { bypassCache?: boolean }  — bypassCache forces a fresh provider lookup
 *   so a user-initiated retry is not stuck behind the resolver's 24h NOT_FOUND
 *   cache entry.
 * returns: { status, provider?, attachmentId?, sourceUrl?, error? }
 */
export async function oaRetrieveOne(req, res) {
  try {
    const access = await getProjectAccess(req.params.pid, req.user);
    if (!access) return res.status(404).json({ error: 'Project not found' });
    if (!access.canScreen && !access.isLeader) {
      return res.status(403).json({ error: 'You do not have permission to attach files in this project' });
    }
    const settings = await getMetaSiftSettings();
    const cfg = loadOaConfig(process.env, settings);
    if (!cfg.enabled) {
      return res.status(403).json({ error: 'Open-access PDF retrieval is disabled by the administrator', status: OA_STATUS.SKIPPED_FEATURE_DISABLED });
    }
    // Same polite-pool identifier rule as the bulk path: the requesting user's
    // account email, env fallback.
    const userEmail = (req.user && req.user.email) || cfg.unpaywallEmail || '';
    if (!userEmail) {
      return res.status(400).json({ error: 'Your account has no email on file, which the open-access provider requires. Add an email to your account and try again.' });
    }

    const projectId = access.project.id;
    const rec = await prisma.screenRecord.findFirst({
      where: { id: req.params.rid, projectId },
      select: { id: true, doi: true, pmid: true },
    });
    if (!rec) return res.status(404).json({ error: 'Record not found' });

    // Never overwrite a manually-uploaded PDF (mirrors the bulk skip rule).
    const manual = await prisma.screenPdfAttachment.findFirst({
      where: { projectId, recordId: rec.id, source: 'manual_upload' }, select: { id: true },
    });
    if (manual) return res.json({ status: 'skipped_manual' });

    // Resolve the DOI: prefer the record's own DOI, else convert its PMID.
    let doi = normalizeDoi(rec.doi);
    if (!doi && rec.pmid) {
      const fromPmid = await pmidToDoi(rec.pmid, { fetch: globalThis.fetch });
      if (fromPmid) doi = normalizeDoi(fromPmid);
    }
    if (!doi) return res.json({ status: OA_STATUS.SKIPPED_NO_DOI });

    // Cache-bypass: drop any cached result for this DOI so a retry re-hits the
    // providers instead of replaying a stale NOT_FOUND for up to 24h.
    if (req.body && req.body.bypassCache && resolver._cache && typeof resolver._cache.delete === 'function') {
      resolver._cache.delete(doi);
    }

    const r = await resolver.resolve(doi, { email: userEmail, enabled: true });
    if (r.status !== OA_STATUS.FOUND) {
      return res.json({ status: r.status });
    }

    const dl = await fetchOaPdf(r.url, globalThis.fetch, MAX_PDF_BYTES);
    if (!dl.ok) {
      return res.json({ status: 'failed', error: dl.error, sourceUrl: r.url || null, provider: r.provider || null });
    }

    // Replace any prior OA attachment for this record (manual was skipped above).
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
    await writeAudit(projectId, req.user, 'PDF_OA_ATTACHED', { entityType: 'record', entityId: rec.id, details: { provider: r.provider, doi: r.doi, single: true } });

    return res.json({ status: 'attached', provider: r.provider, attachmentId: att.id, sourceUrl: r.url });
  } catch (err) {
    console.error('[screening] oaRetrieveOne:', err.message);
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
      const best = bestPdfMatch({ filename: p.filename, doi: p.doi, pmid: p.pmid, title: p.title, year: p.year, pdfText: p.pdfText }, records);
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
