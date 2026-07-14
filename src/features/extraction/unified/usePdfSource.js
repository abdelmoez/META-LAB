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
import { studyDocApi } from './studyDocApi.js';
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
 * usePdfSource(study, projectId, { onDocumentPersisted, publication }) -> {
 *   url, source: 'screening'|'study-doc'|'oa'|'local'|null, resolving, error,
 *   screenProjectId, recordId, setLocalFile(file), clearLocal(),
 *   extractPages(): Promise<{pages:[{page,text}], count}>
 * }
 *
 * `publication` (83.md §2, optional) scopes the PDF to the PAPER instead of the single
 * study row: pass `publicationSourceFor(studies, study.id)` and the hook resolves via
 * the citation group's carrier row (screening link or study document from ANY sibling
 * outcome). Because the effect is keyed on the publication identity — not the row id —
 * switching outcomes of the same paper neither clears nor re-resolves the PDF, so the
 * viewer keeps its page/zoom/scroll. Callers that omit it keep per-row behaviour.
 */
export function usePdfSource(study, projectId, { onDocumentPersisted, publication = null } = {}) {
  // `fileKey` identifies the exact FILE shown (attachment id / stored blob name; null
  // for a session-local upload). Stored with click-to-pick provenance so a jump can
  // detect "these coordinates were captured on a different file" (83.md §3/§5).
  const [resolved, setResolved] = useState({ url: null, source: null, screenProjectId: null, recordId: null, fileKey: null });
  const [resolving, setResolving] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const localUrlRef = useRef(null);
  const supersedeRef = useRef(0);   // bumped when a local file is chosen, so an in-flight resolve can bail
  const studyId = study && study.id;
  const studyIdRef = useRef(studyId);
  studyIdRef.current = studyId;     // always the currently-selected study (upload targets)
  const doi = (study && study.doi) || '';
  const pmid = (study && study.pmid) || '';

  // The PAPER identity this hook is resolving for — the stable anchor row id, NOT the
  // citation-key string (which churns per keystroke while a citation field is edited).
  // In-flight guards compare against it (not the open row id) so finishing a persist/OA
  // retrieval is still valid after the reviewer switches to a sibling OUTCOME.
  const pubKey = (publication && (publication.anchorId || publication.key)) || studyId || null;
  const pubKeyRef = useRef(pubKey);
  pubKeyRef.current = pubKey;

  // Clean up an object URL when the local file changes or the component unmounts.
  const revokeLocal = useCallback(() => {
    if (localUrlRef.current) { try { URL.revokeObjectURL(localUrlRef.current); } catch { /* noop */ } localUrlRef.current = null; }
  }, []);
  useEffect(() => () => revokeLocal(), [revokeLocal]);

  // Only the publication IDENTITY + its PDF linkage affect which PDF resolves —
  // NOT extraction values. Depending on the whole `study` object would re-resolve
  // (and revoke a session-local upload / reload the screening PDF) on every field
  // edit, e.g. each click-assign. Depend on these primitives instead.
  const directSp = (publication && publication.screeningProjectId) || (study && study.screeningProjectId) || null;
  const directRid = (publication && publication.screeningRecordId) || (study && study.screeningRecordId) || null;
  // The blob-anchored study document (77.md §5) — the persistent PDF for a study that
  // isn't screening-linked. With a publication, the carrier row may be a SIBLING
  // outcome; its id keys the download route. Depend on primitives, not objects.
  const docStored = (publication && publication.docStoredName) || (study && study.document && study.document.storedName) || null;
  // docSid only matters when a study-document EXISTS; gating on docStored keeps it
  // null — and stable — for screening-linked papers, so a sibling-outcome switch
  // (which changes studyId but nothing else) cannot re-run the resolve effect
  // (adversarial-review finding: the churn re-fired listPdf per switch and a
  // transient failure could blank the shared viewer mid-extraction).
  const docSid = docStored ? (((publication && publication.docStoredName) ? publication.docStudyId : studyId) || null) : null;
  // Candidate row ids for the server study→screening-record handoff lookup. Read via a
  // ref so the sibling SET growing (e.g. "+ Add outcome") never re-runs the resolve.
  const lookupIdsRef = useRef([]);
  lookupIdsRef.current = (publication && publication.lookupStudyIds && publication.lookupStudyIds.length)
    ? publication.lookupStudyIds : (studyId ? [studyId] : []);

  // Resolve the paper's PDF whenever its identity (or persisted-doc pointer) changes.
  // Priority: screening attachment (canonical for screened studies) → blob study document
  // → nothing. Both survive refresh/relogin and are served through authenticated routes.
  const prevPubKeyRef = useRef(undefined);
  useEffect(() => {
    let dead = false;
    // Same paper (a linkage primitive changed, e.g. a persist finished stamping the
    // pointer) → keep the current PDF on screen while re-resolving; an equal URL then
    // lands as a no-op for the viewer. A different paper clears immediately so the old
    // paper's PDF can never linger over the new one.
    const samePaper = prevPubKeyRef.current === pubKey;
    prevPubKeyRef.current = pubKey;
    if (!samePaper) {
      revokeLocal();
      setResolved({ url: null, source: null, screenProjectId: null, recordId: null, fileKey: null });
    }
    setError('');
    if (!studyId) return undefined;

    const token = supersedeRef.current;   // if a local upload happens mid-resolve, bail
    const superseded = () => dead || supersedeRef.current !== token;
    (async () => {
      setResolving(true);
      try {
        let sp = directSp, rid = directRid;
        if (!sp || !rid) {
          // No direct link on any group row — ask the server to resolve the handoff.
          // Only originally handed-off rows carry a ScreenRecord.handoffStudyId, so try
          // each candidate (target row first, then siblings) until one resolves.
          for (const sid of lookupIdsRef.current) {
            const r = await screeningApi.metalabStudyRecord(projectId, sid).catch(() => null);
            if (superseded()) return;
            if (r && r.recordId && r.screenProjectId) { sp = r.screenProjectId; rid = r.recordId; break; }
          }
        }
        if (superseded()) return;
        if (sp && rid) {
          // Distinguish "no attachment" from "couldn't check" — a transient list failure
          // must NOT masquerade as a clean upload state, or an upload could replace an
          // existing (just-unlisted) PDF (review finding).
          let listing = null, listFailed = false;
          try { listing = await screeningApi.listPdf(sp, rid); } catch { listFailed = true; }
          const att = (listing && listing.attachments && listing.attachments[0]) || null;
          if (superseded()) return;
          if (att) {
            setResolved({ url: screeningApi.pdfDownloadUrl(sp, rid, att.id), source: 'screening', screenProjectId: sp, recordId: rid, fileKey: `att:${att.id}` });
          } else if (docStored && docSid) {
            setResolved({ url: studyDocApi.downloadUrl(projectId, docSid), source: 'study-doc', screenProjectId: sp, recordId: rid, fileKey: `doc:${docStored}` });
          } else {
            setResolved({ url: null, source: null, screenProjectId: sp, recordId: rid, fileKey: null });
            if (listFailed) setError('Could not check for this study’s saved PDF just now — refresh before uploading so you don’t replace an existing file.');
          }
        } else if (docStored && docSid) {
          // Manual study with a persisted document — resolve it straight from the blob pointer.
          setResolved({ url: studyDocApi.downloadUrl(projectId, docSid), source: 'study-doc', screenProjectId: null, recordId: null, fileKey: `doc:${docStored}` });
        } else if (samePaper) {
          // Re-resolve of the same paper found nothing (e.g. the linkage was removed) —
          // clear the kept-on-screen URL now that we know it no longer applies.
          revokeLocal();
          setResolved({ url: null, source: null, screenProjectId: null, recordId: null, fileKey: null });
        }
      } catch (e) {
        if (!superseded()) setError(e.message || 'Could not resolve a PDF for this study.');
      } finally {
        if (!superseded()) setResolving(false);
      }
    })();
    return () => { dead = true; };
  }, [pubKey, projectId, directSp, directRid, docStored, docSid, revokeLocal]); // eslint-disable-line react-hooks/exhaustive-deps

  // A PDF uploaded here can be PERSISTED so it survives refresh/relogin and is available
  // across engines (77.md §5): screening-linked studies → the canonical ScreenPdfAttachment
  // (also visible in Screening + RoB); any other study → the blob-anchored study document
  // (visible in Extraction + RoB). Effectively any study with a project + id can persist.
  const canPersistUpload = !!(((resolved.screenProjectId || directSp) && (resolved.recordId || directRid)) || (projectId && studyId));

  const localFallback = useCallback((file) => {
    supersedeRef.current += 1;   // supersede any in-flight screening resolve so it can't clobber this
    revokeLocal();
    const u = URL.createObjectURL(file);
    localUrlRef.current = u;
    setResolved((prev) => ({ url: u, source: 'local', screenProjectId: prev.screenProjectId, recordId: prev.recordId, fileKey: null }));
    setResolving(false);
  }, [revokeLocal]);

  // setLocalFile(file, { persist }) — persistence is OPT-IN. Only callers that intend a
  // canonical, project-wide upload (the engine's empty-state upload, which targets a study
  // with no existing PDF) pass persist:true; the classic panel's "replace PDF" keeps the
  // safe session-local behaviour so it can never silently overwrite a stored attachment.
  const setLocalFile = useCallback(async (file, opts = {}) => {
    if (!file) return;
    const sp = resolved.screenProjectId || directSp;
    const rid = resolved.recordId || directRid;
    if (opts.persist && sp && rid) {
      setUploading(true); setError('');
      // Guard on the PAPER, not the row: switching to a sibling outcome of the same
      // publication mid-upload must not orphan the persist (83.md §2).
      const startPub = pubKeyRef.current;
      try {
        await screeningApi.uploadPdf(sp, rid, file);
        const listing = await screeningApi.listPdf(sp, rid).catch(() => null);
        if (pubKeyRef.current !== startPub) { setUploading(false); return; }   // paper switched mid-upload
        const att = (listing && listing.attachments && listing.attachments[0]) || null;
        if (att) {
          supersedeRef.current += 1; revokeLocal();
          setResolved({ url: screeningApi.pdfDownloadUrl(sp, rid, att.id), source: 'screening', screenProjectId: sp, recordId: rid, fileKey: `att:${att.id}` });
          setUploading(false);
          return;
        }
      } catch (e) {
        // Guard the async failure the same way as the success path: if the reviewer switched
        // paper mid-upload, do NOT fall through to a local URL for the wrong study.
        if (pubKeyRef.current !== startPub) { setUploading(false); return; }
        // Persisting failed (permissions, size, network) — keep the reviewer working with a
        // session-local copy, but tell them it was not saved to the project.
        setError((e && e.message ? `${e.message} ` : '') + 'Showing this PDF locally for this session only — it was not saved to the project.');
      }
      setUploading(false);
    } else if (opts.persist && projectId && studyId) {
      // Not screening-linked → persist to the blob-anchored study document store, keyed to
      // the row that was OPEN when the upload started. The server writes study.document
      // durably; we also stamp it into the client blob (onDocumentPersisted) so a
      // whole-blob autosave can't clobber the pointer. Sibling outcomes of the same paper
      // resolve it through the publication carrier scan.
      setUploading(true); setError('');
      const startPub = pubKeyRef.current;
      const startStudy = studyIdRef.current;
      try {
        const r = await studyDocApi.upload(projectId, startStudy, file);
        if (pubKeyRef.current !== startPub) { setUploading(false); return; }
        if (r && r.document && r.document.storedName) {
          supersedeRef.current += 1; revokeLocal();
          setResolved({ url: studyDocApi.downloadUrl(projectId, startStudy), source: 'study-doc', screenProjectId: null, recordId: null, fileKey: `doc:${r.document.storedName}` });
          if (onDocumentPersisted) onDocumentPersisted(startStudy, r.document);
          setUploading(false);
          return;
        }
      } catch (e) {
        if (pubKeyRef.current !== startPub) { setUploading(false); return; }
        setError((e && e.message ? `${e.message} ` : '') + 'Showing this PDF locally for this session only — it was not saved to the project.');
      }
      setUploading(false);
    }
    localFallback(file);
  }, [resolved.screenProjectId, resolved.recordId, directSp, directRid, projectId, studyId, revokeLocal, localFallback, onDocumentPersisted]);

  const clearLocal = useCallback(() => {
    revokeLocal();
    setResolved({ url: null, source: null, screenProjectId: null, recordId: null, fileKey: null });
  }, [revokeLocal]);

  // Third sourcing mode: auto-retrieve an open-access PDF by DOI/PMID and persist it as a
  // screening attachment. Only available for screening-linked studies (the endpoint writes
  // a ScreenPdfAttachment) with a DOI or PMID. Never fires automatically.
  const canRetrieveOa = !!(resolved.screenProjectId && resolved.recordId && (doi || pmid));
  const retrieveOa = useCallback(async () => {
    const sp = resolved.screenProjectId, rid = resolved.recordId;
    if (!sp || !rid) { setError('This study is not linked to a screening record, so its PDF cannot be auto-retrieved. Upload it instead.'); return; }
    // Guard the multi-second round-trip: if the reviewer switches PAPER (or uploads a local
    // PDF) while OA retrieval is in flight, its late result must NOT clobber the new study's
    // view with the wrong document. A sibling-outcome switch keeps the retrieval valid.
    const startPub = pubKeyRef.current;
    const startToken = supersedeRef.current;
    const stale = () => pubKeyRef.current !== startPub || supersedeRef.current !== startToken;
    setRetrieving(true); setError('');
    try {
      // Preserve the server's structured status through the API's throw-on-non-2xx (403 for a
      // disabled feature) so the tailored messages below aren't collapsed to "Access denied.".
      const r = await screeningApi.oaRetrieveOne(sp, rid, { bypassCache: true }).catch((e) => ({ status: (e && e.data && e.data.status) || 'failed', error: (e && e.message) || 'Retrieval failed.' }));
      if (stale()) return;
      if (r && (r.status === 'attached' || r.attachmentId)) {
        const listing = await screeningApi.listPdf(sp, rid).catch(() => null);
        if (stale()) return;
        const att = (listing && listing.attachments && listing.attachments[0]) || null;
        if (att) { supersedeRef.current += 1; revokeLocal(); setResolved({ url: screeningApi.pdfDownloadUrl(sp, rid, att.id), source: 'oa', screenProjectId: sp, recordId: rid, fileKey: `att:${att.id}` }); }
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
    url: resolved.url, source: resolved.source, fileKey: resolved.fileKey || null,
    screenProjectId: resolved.screenProjectId, recordId: resolved.recordId,
    resolving, retrieving, uploading, error, canRetrieveOa, retrieveOa, canPersistUpload,
    setLocalFile, clearLocal, extractPages,
  }), [resolved, resolving, retrieving, uploading, error, canRetrieveOa, retrieveOa, canPersistUpload, setLocalFile, clearLocal, extractPages]);
}

export default usePdfSource;
