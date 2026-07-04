/**
 * usePdfSource.js — RoadMap/1.md. Resolves the PDF a study's extraction workspace
 * should show, and extracts per-page text for the deterministic auto-extractor.
 *
 * PDF resolution reuses the EXISTING screening attachment pipeline (the same one RoB
 * uses via robFullText) — no new PDF store, no new endpoint:
 *   1. If the study carries screeningProjectId + screeningRecordId (set on handoff),
 *      use them directly.
 *   2. Else ask the server to resolve the study → screening record
 *      (screeningApi.metalabStudyRecord).
 *   3. Else allow a SESSION-LOCAL upload (an object URL kept only in memory) so a
 *      manually-added study can still be worked from its PDF.
 *
 * Text extraction lazy-loads the same pdfjs-dist/legacy build AppPdfViewer bundles.
 * Pure-ish: the hook holds only local state; all timestamps are caller-supplied.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { screeningApi } from '../../../frontend/screening/api-client/screeningApi.js';
import { normalizeItems } from '../../../research-engine/extraction/pdfTextGrid.js';

const MAX_PAGES = 120;
const MAX_OCR_PAGES = 15;          // cap the (slow) text-recognition fallback per run
const OCR_MIN_CHARS = 12;          // a page with less real text than this is treated as scanned

// A page's text-layer output is "garbled/empty" when it is near-empty or dominated by
// the Unicode replacement character (a classic bad-embedded-font symptom).
function looksGarbled(text) {
  const t = (text || '').trim();
  if (t.length < OCR_MIN_CHARS) return true;
  const bad = (t.match(/�/g) || []).length;
  return bad / t.length > 0.1;
}

function isPdfBytes(buf) {
  try {
    const a = new Uint8Array(buf.slice(0, 5));
    return a[0] === 0x25 && a[1] === 0x50 && a[2] === 0x44 && a[3] === 0x46 && a[4] === 0x2d;
  } catch { return false; }
}

/**
 * usePdfSource(study) -> {
 *   url, source: 'screening'|'local'|null, resolving, error,
 *   screenProjectId, recordId, setLocalFile(file), clearLocal(),
 *   extractPages(): Promise<{pages:[{page,text}], count}>
 * }
 */
export function usePdfSource(study, projectId) {
  const [resolved, setResolved] = useState({ url: null, source: null, screenProjectId: null, recordId: null });
  const [resolving, setResolving] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  const [error, setError] = useState('');
  const localUrlRef = useRef(null);
  const supersedeRef = useRef(0);   // bumped when a local file is chosen, so an in-flight resolve can bail
  const studyId = study && study.id;
  const doi = (study && study.doi) || '';
  const pmid = (study && study.pmid) || '';

  // Clean up an object URL when the local file changes or the component unmounts.
  const revokeLocal = useCallback(() => {
    if (localUrlRef.current) { try { URL.revokeObjectURL(localUrlRef.current); } catch { /* noop */ } localUrlRef.current = null; }
  }, []);
  useEffect(() => () => revokeLocal(), [revokeLocal]);

  // Only the study IDENTITY + its screening-record link affect which PDF resolves —
  // NOT its extraction values. Depending on the whole `study` object would re-resolve
  // (and revoke a session-local upload / reload the screening PDF) on every field
  // edit, e.g. each click-assign. Depend on these primitives instead.
  const directSp = (study && study.screeningProjectId) || null;
  const directRid = (study && study.screeningRecordId) || null;

  // Resolve the screening-attached PDF whenever the selected study (identity) changes.
  useEffect(() => {
    let dead = false;
    revokeLocal();
    setResolved({ url: null, source: null, screenProjectId: null, recordId: null });
    setError('');
    if (!studyId) return undefined;

    const token = supersedeRef.current;   // if a local upload happens mid-resolve, bail
    const superseded = () => dead || supersedeRef.current !== token;
    (async () => {
      setResolving(true);
      try {
        let sp = directSp, rid = directRid;
        if (!sp || !rid) {
          const r = await screeningApi.metalabStudyRecord(projectId, studyId).catch(() => null);
          if (r && r.recordId && r.screenProjectId) { sp = r.screenProjectId; rid = r.recordId; }
        }
        if (superseded()) return;
        if (sp && rid) {
          const listing = await screeningApi.listPdf(sp, rid).catch(() => null);
          const att = (listing && listing.attachments && listing.attachments[0]) || null;
          if (superseded()) return;
          if (att) {
            setResolved({ url: screeningApi.pdfDownloadUrl(sp, rid, att.id), source: 'screening', screenProjectId: sp, recordId: rid });
          } else {
            setResolved({ url: null, source: null, screenProjectId: sp, recordId: rid });
          }
        }
      } catch (e) {
        if (!superseded()) setError(e.message || 'Could not resolve a PDF for this study.');
      } finally {
        if (!superseded()) setResolving(false);
      }
    })();
    return () => { dead = true; };
  }, [studyId, projectId, directSp, directRid, revokeLocal]);

  const setLocalFile = useCallback((file) => {
    if (!file) return;
    supersedeRef.current += 1;   // supersede any in-flight screening resolve so it can't clobber this
    revokeLocal();
    const u = URL.createObjectURL(file);
    localUrlRef.current = u;
    setResolved((prev) => ({ url: u, source: 'local', screenProjectId: prev.screenProjectId, recordId: prev.recordId }));
    setResolving(false);
    setError('');
  }, [revokeLocal]);

  const clearLocal = useCallback(() => {
    revokeLocal();
    setResolved({ url: null, source: null, screenProjectId: null, recordId: null });
  }, [revokeLocal]);

  // Third sourcing mode: auto-retrieve an open-access PDF by DOI/PMID and persist it as a
  // screening attachment. Only available for screening-linked studies (the endpoint writes
  // a ScreenPdfAttachment) with a DOI or PMID. Never fires automatically.
  const canRetrieveOa = !!(resolved.screenProjectId && resolved.recordId && (doi || pmid));
  const retrieveOa = useCallback(async () => {
    const sp = resolved.screenProjectId, rid = resolved.recordId;
    if (!sp || !rid) { setError('This study is not linked to a screening record, so its PDF cannot be auto-retrieved. Upload it instead.'); return; }
    setRetrieving(true); setError('');
    try {
      const r = await screeningApi.oaRetrieveOne(sp, rid, { bypassCache: true }).catch((e) => ({ status: 'failed', error: e.message }));
      if (r && (r.status === 'attached' || r.attachmentId)) {
        const listing = await screeningApi.listPdf(sp, rid).catch(() => null);
        const att = (listing && listing.attachments && listing.attachments[0]) || null;
        if (att) { supersedeRef.current += 1; revokeLocal(); setResolved({ url: screeningApi.pdfDownloadUrl(sp, rid, att.id), source: 'oa', screenProjectId: sp, recordId: rid }); }
      } else {
        const why = r && (r.status === 'not_found' ? 'No open-access copy was found for this DOI/PMID.'
          : r.status === 'skipped_feature_disabled' ? 'Automatic PDF retrieval is turned off by your administrator.'
          : r.status === 'skipped_manual' ? 'A manually-uploaded PDF is already attached.'
          : r.error || `Retrieval ${r && r.status || 'failed'}.`);
        setError(why || 'Could not retrieve an open-access PDF.');
      }
    } catch (e) {
      setError(e.message || 'Could not retrieve an open-access PDF.');
    } finally {
      setRetrieving(false);
    }
  }, [resolved.screenProjectId, resolved.recordId, revokeLocal]);

  // Extract per-page text (and normalized text items) from the currently-resolved PDF for
  // auto-extract. Pages whose text layer is empty/garbled fall back to LOCAL text
  // recognition (Tesseract.js) so auto-generate works on scanned PDFs too. onProgress is an
  // optional (phase, page, total) reporter for the UI.
  const extractPages = useCallback(async (onProgress) => {
    const url = resolved.url;
    if (!url) return { pages: [], count: 0, ocrPages: 0 };
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Could not download the PDF (HTTP ${res.status}).`);
    const buf = await res.arrayBuffer();
    if (!isPdfBytes(buf)) throw new Error('The file is not a readable PDF.');
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
    const task = pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false });
    const doc = await task.promise;
    const total = Math.min(doc.numPages || 0, MAX_PAGES);
    const pages = [];
    const scanned = [];   // pages whose text layer failed → OCR candidates
    for (let p = 1; p <= total; p++) {
      try {
        onProgress && onProgress('text', p, total);
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const items = normalizeItems(content.items || []);
        const text = (content.items || []).map((it) => (it && it.str) || '').join(' ').replace(/[ \t]+/g, ' ').trim();
        if (text && !looksGarbled(text)) pages.push({ page: p, text, items });
        else scanned.push(p);
      } catch { /* skip unreadable page */ }
    }
    // Text-recognition fallback (deterministic, local, NOT AI) for scanned pages.
    let ocrPages = 0;
    if (scanned.length) {
      try {
        const { recognizeImage } = await import('../../../frontend/services/ocr.js');
        for (const p of scanned.slice(0, MAX_OCR_PAGES)) {
          try {
            onProgress && onProgress('ocr', p, total);
            const page = await doc.getPage(p);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
            const ctx = canvas.getContext('2d', { alpha: false });
            await page.render({ canvasContext: ctx, viewport }).promise;
            const { text } = await recognizeImage(canvas);
            const clean = (text || '').replace(/[ \t]+/g, ' ').trim();
            if (clean) { pages.push({ page: p, text: clean, ocr: true }); ocrPages++; }
          } catch { /* OCR of this page failed — skip */ }
        }
      } catch { /* OCR unavailable (assets not staged) — carry on with text-layer pages */ }
    }
    pages.sort((a, b) => a.page - b.page);
    try { await doc.cleanup?.(); doc.destroy?.(); } catch { /* noop */ }
    return { pages, count: total, ocrPages, scannedPages: scanned.length };
  }, [resolved.url]);

  return useMemo(() => ({
    url: resolved.url, source: resolved.source,
    screenProjectId: resolved.screenProjectId, recordId: resolved.recordId,
    resolving, retrieving, error, canRetrieveOa, retrieveOa,
    setLocalFile, clearLocal, extractPages,
  }), [resolved, resolving, retrieving, error, canRetrieveOa, retrieveOa, setLocalFile, clearLocal, extractPages]);
}

export default usePdfSource;
