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
import { getEffectiveFeatureFlags } from '../controllers/settingsController.js';
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

/** Whether the `fullTextRetrieval` feature flag is on (fail-closed). */
export async function fullTextRetrievalEnabled() {
  try {
    const flags = await getEffectiveFeatureFlags();
    return flags[FT_FLAG] === true;
  } catch { return false; }
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

  let res;
  try {
    res = await fetchFn(pdfUrl, { redirect: 'follow' });
  } catch (e) {
    return { ok: false, reason: `fetch failed: ${String((e && e.message) || e).slice(0, 200)}` };
  }
  if (!res || !res.ok) return { ok: false, reason: `HTTP ${res ? res.status : 'no-response'}` };

  const ct = String((res.headers && res.headers.get && res.headers.get('content-type')) || '').toLowerCase();
  let buf;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { ok: false, reason: `read failed: ${String((e && e.message) || e).slice(0, 200)}` };
  }
  if (buf.length > maxBytes) return { ok: false, reason: `PDF exceeds ${settings.maxPdfMb}MB cap` };
  // content-type must look like a PDF AND the magic bytes must confirm it — a
  // publisher paywall page (text/html) or an error body is rejected, never stored.
  if (!ct.includes('pdf') && ct) return { ok: false, reason: `not a PDF (content-type ${ct})` };
  if (!isPdfBuffer(buf)) return { ok: false, reason: 'response is not a valid PDF' };

  const hash = sha256(buf);

  // Dedupe: the ScreenPdfAttachment model has no content-hash column, so we skip
  // re-storing when this record already has an attachment fetched from the SAME
  // source URL (a re-run of the same candidate). This is the cheap, race-safe
  // guard that avoids duplicating the identical OA PDF on a repeated retrieval.
  const existing = await prisma.screenPdfAttachment.findMany({
    where: { projectId, recordId: record.id },
    select: { id: true, sourceUrl: true },
  });
  const dupe = existing.find(a => a.sourceUrl && a.sourceUrl === pdfUrl);
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
