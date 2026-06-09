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
import { C, FONT, MONO } from '../ui/theme.js';
import { screeningApi } from '../api-client/screeningApi.js';

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function PdfViewer({ pid, recordId, canManage, defaultOpen = false }) {
  const [attachment, setAttachment] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen]         = useState(defaultOpen);
  const [err, setErr]           = useState('');
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
  useEffect(() => { setOpen(defaultOpen); setFrameErr(false); load(); }, [load, defaultOpen]);

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
      setFrameErr(false);
      await load();
      setOpen(true);
    } catch (e2) {
      setErr(e2.status === 403 ? 'You do not have permission to attach a PDF here.'
        : e2.status === 413 || /limit/i.test(e2.message || '') ? (e2.message || 'PDF is too large.')
        : (e2.message || 'Upload failed.'));
    } finally { setUploading(false); }
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

  const previewUrl = attachment ? screeningApi.pdfDownloadUrl(pid, recordId, attachment.id) : null;

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
            <TbBtn onClick={() => { setFrameErr(false); setOpen(o => !o); }}>{open ? 'Hide preview' : 'Preview'}</TbBtn>
            <TbLink href={previewUrl}>Open in new tab</TbLink>
            {canManage && (
              <label style={{ cursor: uploading ? 'default' : 'pointer' }}>
                <TbSpan>{uploading ? 'Replacing…' : 'Replace'}</TbSpan>
                <input ref={fileRef} type="file" accept="application/pdf" onChange={onPick} disabled={uploading} style={{ display: 'none' }} />
              </label>
            )}
            {canManage && <TbBtn danger onClick={onRemove}>Remove</TbBtn>}
          </>
        ) : canManage ? (
          <>
            <label style={{ cursor: uploading ? 'default' : 'pointer' }}>
              <span style={{ fontSize: 12, color: C.acc, border: `1px dashed ${C.acc}55`, borderRadius: 7, padding: '6px 12px', background: C.acc + '12' }}>
                {uploading ? 'Uploading…' : '⬆ Upload PDF'}
              </span>
              <input ref={fileRef} type="file" accept="application/pdf" onChange={onPick} disabled={uploading} style={{ display: 'none' }} />
            </label>
            <span style={{ fontSize: 11, color: C.muted }}>Attach the full manuscript to preview it here.</span>
          </>
        ) : (
          <span style={{ fontSize: 11.5, color: C.muted, fontStyle: 'italic' }}>No PDF attached.</span>
        )}
      </div>

      {err && <div style={{ padding: '0 14px 10px', fontSize: 11.5, color: C.red }}>{err}</div>}

      {/* Inline preview */}
      {attachment && open && (
        <div style={{ borderTop: `1px solid ${C.brd}`, background: '#0c1220' }}>
          {frameErr ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12.5, color: C.txt2 }}>
              Preview unavailable in this browser.{' '}
              <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.acc }}>Open the PDF in a new tab →</a>
            </div>
          ) : (
            <iframe
              title="PDF preview"
              src={previewUrl}
              onError={() => setFrameErr(true)}
              style={{ width: '100%', height: 520, border: 'none', display: 'block', background: '#1a1f2e' }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TbBtn({ children, onClick, danger }) {
  return (
    <button onClick={onClick} style={{
      background: 'none', border: `1px solid ${danger ? '#f8717155' : C.brd2}`, color: danger ? C.red : C.txt2,
      fontSize: 11.5, fontFamily: FONT, padding: '5px 11px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
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
