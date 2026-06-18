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
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import PdfViewer from '../screening/components/PdfViewer.jsx';

export default function RobPdfPanel({ loading, error, screenProjectId, recordId, canManage, onClose, onRetry, previewHeight, showHeader = true }) {
  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 14, background: C.card, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {showHeader && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${C.brd}` }}>
        <Icon name="fileText" size={15} />
        <span style={{ fontWeight: 800, fontSize: 13.5 }}>Study PDF</span>
        <div style={{ flex: 1 }} />
        {onClose && (
          <button onClick={onClose} title="Hide PDF panel" aria-label="Hide PDF panel"
            style={{ background: 'none', border: 'none', color: C.txt2, cursor: 'pointer', display: 'inline-flex', padding: 4 }}>
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
      )}

      <div style={{ padding: 14, flex: 1, minHeight: 0 }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12.5, fontFamily: MONO }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: '12px 14px', background: alpha(C.red, '12'), border: `1px solid ${alpha(C.red, '40')}`, borderRadius: 8, color: C.red, fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span>{error}</span>
            {onRetry && <button onClick={onRetry} style={ghost}><Icon name="refresh" size={13} /> Retry</button>}
          </div>
        ) : recordId && screenProjectId ? (
          <PdfViewer pid={screenProjectId} recordId={recordId} canManage={!!canManage} defaultOpen previewHeight={previewHeight} />
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
    </div>
  );
}

const ghost = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT };
