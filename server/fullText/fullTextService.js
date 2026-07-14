/**
 * server/fullText/fullTextService.js — settings gate, coverage, download+attach
 * for automated OA full-text retrieval (68.md P9).
 *
 * Fetched PDFs land in the EXISTING ScreenPdfAttachment store via the shared
 * pdfStorage helpers (savePdf) — this feature does NOT invent a parallel store.
 * Provenance is written into ScreenPdfAttachment's existing 1.4 columns
 * (source/oaStatus/sourceUrl/resolvedDoi/matchedBy/matchConfidence/…).
 */
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import { featureAccess } from '../services/featureAccess.js';
import { savePdf, isPdfBuffer } from '../screening/pdfStorage.js';

export const FT_SETTINGS_KEY = 'fullTextSettings';
export const FT_FLAG = 'fullTextRetrieval';

/** Admin-tunable settings defaults (SiteSetting 'fullTextSettings'). */
export const FT_DEFAULTS = {
  enabled: true,                    // module master switch (separate from the feature flag)
  providerOrder: ['unpaywall', 'europepmc', 'openalex', 'clinicaltrials'],
  maxPdfMb: 25,
  maxBulkUploadPdfs: 50,
  autoParseOnArrival: false,        // reserved: parse PDF→text on arrival (off by default)
};

const KNOWN_PROVIDERS = new Set(['unpaywall', 'europepmc', 'openalex', 'clinicaltrials']);

function safeParse(s, fallback) {
  try { const v = JSON.parse(s ?? ''); return v && typeof v === 'object' ? v : fallback; }
  catch { return fallback; }
}

/**
 * Whether the `fullTextRetrieval` feature flag is on (fail-closed).
 * 75.md Phase 7 — routed through the central seam. A gate passes `req.user` so
 * admins keep the feature usable while it is globally OFF; no user = plain flag state.
 */
export async function fullTextRetrievalEnabled(user = null) {
  return (await featureAccess(FT_FLAG, user)).allowed;
}

/** Effective full-text settings (defaults ← stored row). Never throws. */
export async function getFullTextSettings() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: FT_SETTINGS_KEY } });
    if (!row) return { ...FT_DEFAULTS };
    return { ...FT_DEFAULTS, ...safeParse(row.value, {}) };
  } catch {
    return { ...FT_DEFAULTS };
  }
}

/**
 * Whitelist-coerce a full-text settings patch (Ops PUT). Exported for unit tests.
 * Unknown keys are dropped; each field is bounds-checked. providerOrder keeps only
 * known providers, in the caller's order, deduped; an empty result falls back to
 * the default order so retrieval is never left with no providers.
 */
export function coerceFullTextSettings(patch, current) {
  const out = { ...FT_DEFAULTS, ...current };
  const p = patch && typeof patch === 'object' ? patch : {};
  if (typeof p.enabled === 'boolean') out.enabled = p.enabled;
  if (typeof p.autoParseOnArrival === 'boolean') out.autoParseOnArrival = p.autoParseOnArrival;
  if (Number.isFinite(p.maxPdfMb)) out.maxPdfMb = Math.min(100, Math.max(1, Math.round(p.maxPdfMb)));
  if (Number.isFinite(p.maxBulkUploadPdfs)) out.maxBulkUploadPdfs = Math.min(500, Math.max(1, Math.round(p.maxBulkUploadPdfs)));
  if (Array.isArray(p.providerOrder)) {
    const seen = new Set();
    const legal = [];
    for (const id of p.providerOrder) {
      if (KNOWN_PROVIDERS.has(id) && !seen.has(id)) { seen.add(id); legal.push(id); }
    }
    out.providerOrder = legal.length ? legal : [...FT_DEFAULTS.providerOrder];
  }
  return out;
}

/** Cap on how many bytes we ever buffer for a candidate PDF, from settings. */
export function maxPdfBytes(settings) {
  const mb = Number.isFinite(settings?.maxPdfMb) ? settings.maxPdfMb : FT_DEFAULTS.maxPdfMb;
  return Math.min(100, Math.max(1, mb)) * 1024 * 1024;
}

// 86.md P1.19 — hard wall-clock cap on a single PDF download (vs the 15s metadata
// timeout; a real PDF can legitimately take longer than a JSON call). Overridable.
export const FT_DOWNLOAD_TIMEOUT_MS = Number(process.env.FT_DOWNLOAD_TIMEOUT_MS) || 60000;

/**
 * Read a fetch Response body into a Buffer, aborting as soon as cumulative bytes
 * exceed `maxBytes` so a misbehaving/huge OA host can never be fully buffered in
 * RAM (86.md P1.19). Streams via the web ReadableStream reader when available;
 * falls back to arrayBuffer() (still post-checked by the caller) for exotic fetch
 * implementations that don't expose a readable body.
 * @throws {Error} with code 'TOO_LARGE' when the cap is exceeded.
 */
export async function readBodyCapped(res, maxBytes, controller) {
  const body = res && res.body;
  const reader = body && typeof body.getReader === 'function' ? body.getReader() : null;
  if (!reader) {
    // No streamable body — fall back to arrayBuffer (bounded by the caller's check).
    return Buffer.from(await res.arrayBuffer());
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length) {
      total += value.length;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* best effort */ }
        if (controller) { try { controller.abort(); } catch { /* best effort */ } }
        const err = new Error('response exceeds size cap');
        err.code = 'TOO_LARGE';
        throw err;
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks, total);
}

/**
 * coverage(projectId) — honest full-text coverage counts for the status card.
 *   included         — records with finalStatus 'accepted'
 *   withPdf          — DISTINCT records (any stage) that have ≥1 PDF attachment
 *   includedWithPdf  — accepted records that have a PDF
 *   candidatesFound  — records with ≥1 FullTextCandidate row of status 'found'
 *   requested        — records with an open FullTextRequest (status 'requested')
 *   received         — records marked FullTextRequest status 'received'
 *   noOa             — records whose every candidate is no_oa/not_found and none found
 */
export async function coverage(projectId) {
  const records = await prisma.screenRecord.findMany({
    where: { projectId },
    select: { id: true, finalStatus: true },
  });
  const total = records.length;
  const acceptedIds = new Set(records.filter(r => r.finalStatus === 'accepted').map(r => r.id));

  const [atts, candidates, requests] = await Promise.all([
    prisma.screenPdfAttachment.findMany({ where: { projectId }, select: { recordId: true } }),
    prisma.fullTextCandidate.findMany({ where: { projectId }, select: { recordId: true, status: true } }),
    prisma.fullTextRequest.findMany({ where: { projectId }, select: { recordId: true, status: true } }),
  ]);

  const withPdf = new Set(atts.map(a => a.recordId));
  const foundRecords = new Set(candidates.filter(c => c.status === 'found').map(c => c.recordId));
  const consideredRecords = new Set(candidates.map(c => c.recordId));
  const noOa = new Set([...consideredRecords].filter(id => !foundRecords.has(id) && !withPdf.has(id)));

  let requested = 0, received = 0;
  for (const r of requests) {
    if (r.status === 'requested') requested++;
    else if (r.status === 'received') received++;
  }

  const includedWithPdf = [...acceptedIds].filter(id => withPdf.has(id)).length;

  return {
    totalRecords: total,
    included: acceptedIds.size,
    withPdf: withPdf.size,
    includedWithPdf,
    includedMissing: acceptedIds.size - includedWithPdf,
    candidatesFound: foundRecords.size,
    requested,
    received,
    noOa: noOa.size,
  };
}

/** SHA-256 hex of a buffer (attachment-level dedupe key). */
export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * downloadAndAttach(record, candidate, opts) — fetch the candidate's pdfUrl,
 * validate it is a real OA PDF within the size cap, dedupe by content hash, and
 * create a ScreenPdfAttachment via the shared storage path.
 *
 * Returns one of:
 *   { ok:true, attachmentId, alreadyHad?:true, hash }
 *   { ok:false, reason }
 *
 * NEVER throws (the worker relies on that). Only attaches when the bytes are a
 * genuine PDF (magic-byte check) delivered under the size cap — a failed download
 * or a paywalled non-PDF response attaches nothing.
 */
export async function downloadAndAttach(record, candidate, opts = {}) {
  const fetchFn = opts.fetchFn || globalThis.fetch;
  const settings = opts.settings || (await getFullTextSettings());
  const maxBytes = maxPdfBytes(settings);
  const projectId = record.projectId;
  const pdfUrl = candidate && candidate.pdfUrl;
  if (!pdfUrl) return { ok: false, reason: 'no PDF URL' };
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'fetch unavailable' };

  // 86.md P1.19 — the PDF fetch previously had NO timeout and buffered the ENTIRE
  // body via arrayBuffer() BEFORE the size check, so one hung or multi-GB OA host
  // could wedge the whole full-text worker (draining flag stuck) or exhaust memory.
  // Bound it with an AbortController hard timeout AND stream the body, aborting the
  // moment cumulative bytes exceed the cap.
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FT_DOWNLOAD_TIMEOUT_MS) : null;
  let res;
  try {
    res = await fetchFn(pdfUrl, controller ? { redirect: 'follow', signal: controller.signal } : { redirect: 'follow' });
  } catch (e) {
    if (timer) clearTimeout(timer);
    const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')));
    return { ok: false, reason: aborted ? `download timed out after ${FT_DOWNLOAD_TIMEOUT_MS}ms` : `fetch failed: ${String((e && e.message) || e).slice(0, 200)}` };
  }
  if (!res || !res.ok) { if (timer) clearTimeout(timer); return { ok: false, reason: `HTTP ${res ? res.status : 'no-response'}` }; }

  const ct = String((res.headers && res.headers.get && res.headers.get('content-type')) || '').toLowerCase();
  let buf;
  try {
    buf = await readBodyCapped(res, maxBytes, controller);
  } catch (e) {
    if (timer) clearTimeout(timer);
    if (e && e.code === 'TOO_LARGE') return { ok: false, reason: `PDF exceeds ${settings.maxPdfMb}MB cap` };
    const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')));
    return { ok: false, reason: aborted ? `download timed out after ${FT_DOWNLOAD_TIMEOUT_MS}ms` : `read failed: ${String((e && e.message) || e).slice(0, 200)}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (buf.length > maxBytes) return { ok: false, reason: `PDF exceeds ${settings.maxPdfMb}MB cap` };
  // content-type must look like a PDF AND the magic bytes must confirm it — a
  // publisher paywall page (text/html) or an error body is rejected, never stored.
  if (!ct.includes('pdf') && ct) return { ok: false, reason: `not a PDF (content-type ${ct})` };
  if (!isPdfBuffer(buf)) return { ok: false, reason: 'response is not a valid PDF' };

  const hash = sha256(buf);

  // Dedupe (round 2): CONTENT-level first — ScreenPdfAttachment.fileHash stores the
  // sha256 of the bytes, so the identical PDF is never stored twice for a record
  // even when two providers hand out different URLs for the same file. Legacy rows
  // have a null hash, so the sourceUrl match stays as the fallback guard.
  const existing = await prisma.screenPdfAttachment.findMany({
    where: { projectId, recordId: record.id },
    select: { id: true, sourceUrl: true, fileHash: true },
  });
  const dupe = existing.find(a => (a.fileHash && a.fileHash === hash) || (a.sourceUrl && a.sourceUrl === pdfUrl));
  if (dupe) return { ok: true, alreadyHad: true, attachmentId: dupe.id, hash };

  const { storedName, fileSize } = savePdf(projectId, buf);
  const fileName = buildFileName(record, candidate);
  const att = await prisma.screenPdfAttachment.create({
    data: {
      projectId,
      recordId: record.id,
      fileName,
      storedName,
      fileSize,
      mimeType: 'application/pdf',
      uploadedBy: opts.userId || 'system',
      source: 'oa-auto',
      oaStatus: candidate.oaStatus || null,
      sourceUrl: pdfUrl,
      resolvedDoi: (record.doi || '').toLowerCase() || null,
      matchedBy: 'oa-retrieval',
      matchConfidence: 1,
      retrievalAttemptedAt: new Date(),
      fileHash: hash,
    },
  });
  return { ok: true, attachmentId: att.id, hash };
}

/** Build a safe download filename from the record + candidate provenance. */
function buildFileName(record, candidate) {
  const base = String(record.doi || record.pmid || (candidate && candidate.provider) || 'fulltext')
    .replace(/[^\w.-]/g, '_')
    .slice(0, 200);
  return `${base}.pdf`.slice(0, 255);
}
