/**
 * RobPdfPanel.jsx — the study PDF panel shown beside the RoB questions
 * (prompt29 Part 2). It does NOT introduce a second PDF system: it shows the
 * screening RECORD a META·LAB study was handed off from by REUSING the existing
 * screening <PdfViewer> (upload · in-browser preview · open-access finder ·
 * replace · remove). Same paper → same stored file. View-only users cannot
 * upload/replace (PdfViewer hides those when canManage is false; the screening
 * API also enforces it server-side).
 *
 * prompt32 — the study-record resolution (one network call) is now owned by
 * RobWorkspace so the persistent article header + Article Information tab share
 * the SAME fetch even when the PDF tab is hidden. This panel is a pure renderer:
 * it receives { loading, error, screenProjectId, recordId } and an onRetry.
 *
 * Studies that were NOT created from a screening hand-off (e.g. added manually in
 * Data Extraction) have no screening record to attach to, so a clean empty state
 * is shown instead — no duplicate, study-keyed attachment table is created.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import PdfViewer from '../screening/components/PdfViewer.jsx';
import AppPdfViewer from '../components/AppPdfViewer.jsx';
// 116.md §71-104 — the screening-linked branch inherits annotations from the shared
// <PdfViewer>; this file only has to wire the STUDY-DOCUMENT branch (a manually-added
// study with no screening record), which renders a bare AppPdfViewer.
import { usePdfAnnotations } from '../components/usePdfAnnotations.js';
import { ANNOTATION_SCOPE } from '../components/pdfAnnotationApi.js';
import { pinPdfBytesVersion } from '../components/pdfBytesCache.js';

export default function RobPdfPanel({
  loading, error, screenProjectId, recordId, studyDocUrl, canManage, onRetry, previewHeight,
  // 116.md §73 — OPTIONAL. Without a hash the study-document viewer degrades silently
  // to no annotations (§74): the PDF renders, there is just no highlight affordance.
  studyDocHash = '', metaLabProjectId = null, studyId = null,
}) {
  // 116.md §74/§95 (r3) — a study-document URL is STABLE across a replace, so the
  // session byte cache would serve another member's superseded file on the next mount
  // while `studyDocHash` (re-resolved from the server) already names the NEW document.
  // Pinning the hash the panel was just handed drops those bytes. Done in the RENDER
  // phase on purpose: child effects run before parent effects, so an effect here would
  // fire only after <AppPdfViewer> had already asked the cache for bytes. `useMemo`
  // makes it once per (url, hash) pair, and the pin itself is idempotent.
  useMemo(() => { pinPdfBytesVersion(studyDocUrl, studyDocHash); }, [studyDocUrl, studyDocHash]);
  const annTarget = useMemo(
    () => ((studyDocHash && metaLabProjectId) ? { scope: ANNOTATION_SCOPE.METALAB, metaLabProjectId } : null),
    [studyDocHash, metaLabProjectId],
  );
  const ann = usePdfAnnotations({
    target: annTarget, docHash: studyDocHash, studyId, enabled: !!studyDocUrl,
  });
  const [annSelected, setAnnSelected] = useState(null);
  useEffect(() => { setAnnSelected(null); }, [studyDocUrl]);
  const onAnnSelect = useCallback((a) => setAnnSelected(a ? (a.id || null) : null), []);
  const annotationProps = useMemo(() => (ann.enabled ? {
    enabled: true,
    byPage: ann.byPage,
    capabilities: ann.capabilities,
    userId: ann.userId,
    selectedId: annSelected,
    onSelect: onAnnSelect,
    onCreate: ann.createHighlight,
    onRecolor: ann.setColor,
    onComment: ann.setComment,
    onDelete: ann.deleteAnnotation,
  } : null), [ann.enabled, ann.byPage, ann.capabilities, ann.userId, ann.createHighlight,
    ann.setColor, ann.setComment, ann.deleteAnnotation, annSelected, onAnnSelect]);

  // The "Study PDF" label + the back affordance live in RobWorkspace's tab bar /
  // top-level header (prompt32), so this panel is header-less — a pure renderer.
  // prompt36 Task 2 — when a real PDF is shown, the embedded viewer runs in `flush`
  // mode and fills this rounded, bordered card edge-to-edge (no inner padding gap);
  // the transient loading / error / empty states keep comfortable padding.
  const showViewer = recordId && screenProjectId;
  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 14, background: C.card, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {showViewer ? (
        <PdfViewer pid={screenProjectId} recordId={recordId} canManage={!!canManage} defaultOpen previewHeight={previewHeight} flush />
      ) : studyDocUrl ? (
        // 77.md §5 — a manually-added study with a persisted study document (no screening
        // record) still shows its PDF here, read-only, via the shared viewer.
        <AppPdfViewer key={studyDocUrl} url={studyDocUrl} flush annotation={annotationProps} />
      ) : (
        <div style={{ padding: 14, flex: 1, minHeight: 0 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12.5, fontFamily: MONO }}>Loading…</div>
          ) : error ? (
            <div style={{ padding: '12px 14px', background: alpha(C.red, '12'), border: `1px solid ${alpha(C.red, '40')}`, borderRadius: 8, color: C.red, fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span>{error}</span>
              {onRetry && <button onClick={onRetry} style={ghost}><Icon name="refresh" size={13} /> Retry</button>}
            </div>
          ) : (
            <div style={{ padding: '22px 16px', textAlign: 'center', color: C.txt2, fontSize: 12.5, lineHeight: 1.6 }}>
              <div style={{ display: 'inline-flex', padding: 12, borderRadius: '50%', background: alpha(C.acc, '12'), marginBottom: 12 }}><Icon name="fileText" size={20} /></div>
              <div style={{ fontWeight: 700, color: C.txt, marginBottom: 4 }}>No PDF for this study yet</div>
              <p style={{ margin: 0 }}>
                PDF upload &amp; open-access lookup are available for studies brought in through <strong>Screening</strong>. This study isn&apos;t linked to a screening record — attach its full text from the Screening workspace, or it may have been added manually.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ghost = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT };
