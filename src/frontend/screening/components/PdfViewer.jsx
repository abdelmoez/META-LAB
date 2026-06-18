/**
 * PdfViewer.jsx — per-record PDF attachment: upload · in-browser preview ·
 * open/download · replace · remove (prompt2 Task 1).
 *
 * Preview works because the backend serves the PDF inline (Content-Type
 * application/pdf, Content-Disposition: inline) through an AUTHENTICATED route.
 * The dev frontend talks to the API through the same-origin vite proxy (/api),
 * so the session cookie rides along on the <iframe> request and the PDF renders.
 * No public/unauthenticated URL is ever exposed. If the browser can't render the
 * PDF inline, the toolbar's "Open in new tab" / "Download" still work.
 *
 * Used by ScreeningTab (middle column) and SecondReviewTab.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { screeningApi } from '../api-client/screeningApi.js';

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function PdfViewer({ pid, recordId, canManage, defaultOpen = false, previewHeight = 520 }) {
  const [attachment, setAttachment] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [finding, setFinding]   = useState(false);
  const [open, setOpen]         = useState(defaultOpen);
  const [err, setErr]           = useState('');
  // prompt34 Task 3 — the action toolbar (Open / Replace / Remove …) can be hidden
  // to give the PDF more room; the preference is remembered per browser. A small
  // toggle always stays visible so the bar can be brought back. Hiding only the
  // ACTIONS keeps the "Full-text PDF" label + filename + the toggle visible.
  const [toolsHidden, setToolsHidden] = useState(() => { try { return localStorage.getItem('metalab.pdfToolsHidden') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('metalab.pdfToolsHidden', toolsHidden ? '1' : '0'); } catch { /* best-effort */ } }, [toolsHidden]);
  // prompt29 Part 3 — structured "found a link but download failed" state so we
  // can offer retry / open-source-link / manual-upload instead of a dead message.
  const [oaFail, setOaFail]     = useState(null); // { sourceUrl } | null
  const [frameErr, setFrameErr] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const data = await screeningApi.listPdf(pid, recordId);
      setAttachment((data.attachments || [])[0] || null);
    } catch (e) { setErr(e.message || 'Could not load attachment'); }
    finally { setLoading(false); }
  }, [pid, recordId]);

  // Reset + reload whenever the selected record changes.
  useEffect(() => { setOpen(defaultOpen); setFrameErr(false); setOaFail(null); load(); }, [load, defaultOpen]);

  async function onPick(e) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setErr('Only PDF files are accepted.'); return;
    }
    setUploading(true); setErr('');
    try {
      await screeningApi.uploadPdf(pid, recordId, file);
      setFrameErr(false); setOaFail(null);
      await load();
      setOpen(true);
    } catch (e2) {
      setErr(e2.status === 403 ? 'You do not have permission to attach a PDF here.'
        : e2.status === 413 || /limit/i.test(e2.message || '') ? (e2.message || 'PDF is too large.')
        : (e2.message || 'Upload failed.'));
    } finally { setUploading(false); }
  }

  // Auto-find a legitimately open-access PDF for this record (roadmap 1.4). The
  // server uses the signed-in user's account email as the OA provider identifier.
  async function onFindOa() {
    setFinding(true); setErr(''); setOaFail(null);
    try {
      const res = await screeningApi.oaRetrieve(pid, [recordId]);
      const r = (res.results || [])[0];
      if (r && r.status === 'attached') { setFrameErr(false); await load(); setOpen(true); }
      else if (r?.status === 'failed') {
        // A link was found but the file could not be downloaded automatically.
        // Offer next actions instead of a dead-end message; no attachment was made.
        setOaFail({ sourceUrl: r.sourceUrl || null });
      } else {
        setErr(
          r?.status === 'skipped_no_doi' ? 'This record has no DOI, so no open-access lookup is possible.' :
          r?.status === 'rate_limited'   ? 'Too many lookups right now — please try again shortly.' :
          'No open-access PDF was found for this record.');
      }
    } catch (e) {
      setErr(e.status === 403 ? (e.message || 'Open-access retrieval is disabled by the administrator.')
        : e.status === 400 ? (e.message || 'Your account needs an email to use open-access lookup.')
        : (e.message || 'Open-access lookup failed.'));
    } finally { setFinding(false); }
  }

  async function onRemove() {
    if (!attachment) return;
    setErr('');
    try {
      await screeningApi.deletePdf(pid, recordId, attachment.id);
      setAttachment(null); setOpen(false);
    } catch (e) {
      setErr(e.status === 403 ? 'You cannot remove this attachment.' : (e.message || 'Could not remove the PDF.'));
    }
  }

  // prompt34 Task 1 — default the in-browser viewer to "fit width": the native
  // PDF renderer reads the URL fragment, so #zoom=page-width scales each page to
  // the iframe width on load. The iframe is width:100%, so it re-fits when the
  // container resizes; a manual zoom by the user persists for that session (we
  // never remount on resize). The "Open in new tab" link stays plain.
  const previewUrl = attachment ? screeningApi.pdfDownloadUrl(pid, recordId, attachment.id) : null;
  const fitUrl = previewUrl ? `${previewUrl}#zoom=page-width&view=FitH` : null;

  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 10, background: C.card, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted }}>
          Full-text PDF
        </span>

        {loading ? (
          <span style={{ fontSize: 11.5, color: C.muted, fontFamily: MONO }}>Checking…</span>
        ) : attachment ? (
          <>
            <span style={{ fontSize: 12, color: C.txt, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
              📄 {attachment.fileName || 'document.pdf'}
            </span>
            {attachment.fileSize ? <span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>{fmtSize(attachment.fileSize)}</span> : null}
            <div style={{ flex: 1 }} />
            {!toolsHidden && <>
              <TbBtn onClick={() => { setFrameErr(false); setOpen(o => !o); }}>{open ? 'Hide preview' : 'Preview'}</TbBtn>
              <TbLink href={previewUrl}>Open in new tab</TbLink>
              {canManage && (
                <label style={{ cursor: uploading ? 'default' : 'pointer' }}>
                  <TbSpan>{uploading ? 'Replacing…' : 'Replace'}</TbSpan>
                  <input ref={fileRef} type="file" accept="application/pdf" onChange={onPick} disabled={uploading} style={{ display: 'none' }} />
                </label>
              )}
              {canManage && <TbBtn danger onClick={onRemove}>Remove</TbBtn>}
            </>}
            <button onClick={() => setToolsHidden(h => !h)} title={toolsHidden ? 'Show PDF tools' : 'Hide PDF tools'}
              aria-label={toolsHidden ? 'Show PDF tools' : 'Hide PDF tools'} aria-pressed={!toolsHidden}
              style={{ background: 'none', border: `1px solid ${C.brd2}`, color: C.muted, fontSize: 12, fontFamily: FONT, lineHeight: 1, padding: '5px 9px', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }}>
              {toolsHidden ? '⋯' : '✕'}
            </button>
          </>
        ) : canManage ? (
          <>
            <label style={{ cursor: uploading ? 'default' : 'pointer' }}>
              <span style={{ fontSize: 12, color: C.acc, border: `1px dashed ${alpha(C.acc, '55')}`, borderRadius: 7, padding: '6px 12px', background: alpha(C.acc, '12') }}>
                {uploading ? 'Uploading…' : '⬆ Upload PDF'}
              </span>
              <input ref={fileRef} type="file" accept="application/pdf" onChange={onPick} disabled={uploading} style={{ display: 'none' }} />
            </label>
            <button onClick={onFindOa} disabled={finding || uploading} style={{
              fontSize: 12, color: C.teal, border: `1px dashed ${alpha(C.teal, '55')}`, borderRadius: 7,
              padding: '6px 12px', background: alpha(C.teal, '12'), fontFamily: FONT,
              cursor: finding || uploading ? 'default' : 'pointer', whiteSpace: 'nowrap',
            }}>{finding ? 'Searching…' : '🔍 Find open-access PDF'}</button>
            <span style={{ fontSize: 11, color: C.muted }}>Attach the manuscript, or auto-find a free open-access copy.</span>
          </>
        ) : (
          <span style={{ fontSize: 11.5, color: C.muted, fontStyle: 'italic' }}>No PDF attached.</span>
        )}
      </div>

      {err && <div style={{ padding: '0 14px 10px', fontSize: 11.5, color: C.red }}>{err}</div>}

      {/* prompt29 Part 3 — "found a link but couldn't download" actionable state */}
      {oaFail && (
        <div style={{ margin: '0 14px 12px', padding: '10px 12px', background: alpha(C.gold, '12'), border: `1px solid ${alpha(C.gold, '45')}`, borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: C.txt2, lineHeight: 1.5, marginBottom: 8 }}>
            We found a possible open-access PDF link, but the file could not be downloaded automatically. Some open-access hosts block automated downloads. You can retry, open the source link, or upload the PDF manually.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canManage && <TbBtn onClick={() => { setOaFail(null); onFindOa(); }} disabled={finding}>{finding ? 'Retrying…' : 'Retry'}</TbBtn>}
            {oaFail.sourceUrl && <TbLink href={oaFail.sourceUrl}>Open source link ↗</TbLink>}
            {canManage && (
              <label style={{ cursor: uploading ? 'default' : 'pointer' }}>
                <TbSpan>{uploading ? 'Uploading…' : 'Upload PDF manually'}</TbSpan>
                <input ref={fileRef} type="file" accept="application/pdf" onChange={onPick} disabled={uploading} style={{ display: 'none' }} />
              </label>
            )}
            <TbBtn onClick={() => setOaFail(null)}>Dismiss</TbBtn>
          </div>
        </div>
      )}

      {/* Inline preview */}
      {attachment && open && (
        <div style={{ borderTop: `1px solid ${C.brd}`, background: C.surf }}>
          {frameErr ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12.5, color: C.txt2 }}>
              Preview unavailable in this browser.{' '}
              <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.acc }}>Open the PDF in a new tab →</a>
            </div>
          ) : (
            <iframe
              title="PDF preview"
              src={fitUrl}
              onError={() => setFrameErr(true)}
              style={{ width: '100%', height: previewHeight, border: 'none', display: 'block', background: C.card2 }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TbBtn({ children, onClick, danger, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: 'none', border: `1px solid ${danger ? alpha(C.red, '55') : C.brd2}`, color: danger ? C.red : C.txt2,
      fontSize: 11.5, fontFamily: FONT, padding: '5px 11px', borderRadius: 6,
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}
function TbSpan({ children }) {
  return (
    <span style={{ display: 'inline-block', background: 'none', border: `1px solid ${C.brd2}`, color: C.txt2, fontSize: 11.5, fontFamily: FONT, padding: '5px 11px', borderRadius: 6, whiteSpace: 'nowrap' }}>{children}</span>
  );
}
function TbLink({ children, href }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{
      border: `1px solid ${C.brd2}`, color: C.acc, fontSize: 11.5, fontFamily: FONT,
      padding: '5px 11px', borderRadius: 6, textDecoration: 'none', whiteSpace: 'nowrap',
    }}>{children}</a>
  );
}
