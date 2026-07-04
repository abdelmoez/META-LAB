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

const MAX_PAGES = 120;

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
  const [error, setError] = useState('');
  const localUrlRef = useRef(null);
  const studyId = study && study.id;

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

    (async () => {
      setResolving(true);
      try {
        let sp = directSp, rid = directRid;
        if (!sp || !rid) {
          const r = await screeningApi.metalabStudyRecord(projectId, studyId).catch(() => null);
          if (r && r.recordId && r.screenProjectId) { sp = r.screenProjectId; rid = r.recordId; }
        }
        if (dead) return;
        if (sp && rid) {
          const listing = await screeningApi.listPdf(sp, rid).catch(() => null);
          const att = (listing && listing.attachments && listing.attachments[0]) || null;
          if (dead) return;
          if (att) {
            setResolved({ url: screeningApi.pdfDownloadUrl(sp, rid, att.id), source: 'screening', screenProjectId: sp, recordId: rid });
          } else {
            setResolved({ url: null, source: null, screenProjectId: sp, recordId: rid });
          }
        }
      } catch (e) {
        if (!dead) setError(e.message || 'Could not resolve a PDF for this study.');
      } finally {
        if (!dead) setResolving(false);
      }
    })();
    return () => { dead = true; };
  }, [studyId, projectId, directSp, directRid, revokeLocal]);

  const setLocalFile = useCallback((file) => {
    if (!file) return;
    revokeLocal();
    const u = URL.createObjectURL(file);
    localUrlRef.current = u;
    setResolved({ url: u, source: 'local', screenProjectId: null, recordId: null });
    setError('');
  }, [revokeLocal]);

  const clearLocal = useCallback(() => {
    revokeLocal();
    setResolved({ url: null, source: null, screenProjectId: null, recordId: null });
  }, [revokeLocal]);

  // Extract per-page text from the currently-resolved PDF (for auto-extract).
  const extractPages = useCallback(async () => {
    const url = resolved.url;
    if (!url) return { pages: [], count: 0 };
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Could not download the PDF (HTTP ${res.status}).`);
    const buf = await res.arrayBuffer();
    if (!isPdfBytes(buf)) throw new Error('The file is not a readable PDF.');
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
    const task = pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false });
    const doc = await task.promise;
    const total = Math.min(doc.numPages || 0, MAX_PAGES);
    const pages = [];
    for (let p = 1; p <= total; p++) {
      try {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const text = (content.items || []).map((it) => (it && it.str) || '').join(' ').replace(/[ \t]+/g, ' ').trim();
        if (text) pages.push({ page: p, text });
      } catch { /* skip unreadable page */ }
    }
    try { await doc.cleanup?.(); doc.destroy?.(); } catch { /* noop */ }
    return { pages, count: total };
  }, [resolved.url]);

  return useMemo(() => ({
    url: resolved.url, source: resolved.source,
    screenProjectId: resolved.screenProjectId, recordId: resolved.recordId,
    resolving, error, setLocalFile, clearLocal, extractPages,
  }), [resolved, resolving, error, setLocalFile, clearLocal, extractPages]);
}

export default usePdfSource;
