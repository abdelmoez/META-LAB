/**
 * SiftImport.jsx — META·SIFT Beta reference import page
 * Route: /sift-beta/projects/:pid/import
 */

import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { screeningApi } from '../api-client/screeningApi.js';

import { C, FONT, MONO, alpha } from '../ui/theme.js';

function BetaBadge() {
  return (
    <span style={{
      fontSize: 9, fontFamily: MONO, fontWeight: 700,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      background: alpha(C.teal, '18'), border: `1px solid ${alpha(C.teal, '50')}`,
      color: C.teal, borderRadius: 4, padding: '2px 7px',
    }}>BETA</span>
  );
}

// 65.md SCR-10 — the preview runs SERVER-side through the real parser registry
// (POST …/import/preview). Only this much text is sent (the server parses at most
// the same amount); enough for detection + a 5-record sample.
const PREVIEW_MAX_CHARS = 256 * 1024;

// ── Count entries roughly ──────────────────────────────────────────────────
function countEntries(format, text) {
  if (!text.trim()) return 0;
  if (format === 'ris')    return (text.match(/^ER\s*-/mg) || []).length;
  if (format === 'bibtex') return (text.match(/@\w+\{/g) || []).length;
  if (format === 'nbib')   return (text.match(/^PMID-/mg) || []).length || text.split(/\n\n+/).filter(e => e.includes('TI  -')).length;
  return 0;
}

export default function SiftImport({ embedded = false, embeddedPid = null, onDone, onBack } = {}) {
  const routeParams = useParams();
  const pid = embedded ? embeddedPid : routeParams.pid;
  const { user }  = useAuth();
  const navigate  = useNavigate();
  // After a successful import, send the user to Step 2 (Duplicates). Detection is
  // ENQUEUED first (92.md — a durable background job; the POST returns 202 with the
  // job immediately, it no longer blocks on the whole sweep), so the Duplicates page
  // opens onto the live progress panel via its detect/status reconnect. Best-effort —
  // if the user lacks permission or the enqueue fails, we still navigate; the
  // Duplicates page can detect on demand.
  const [preparing, setPreparing] = useState(false);
  const goToDuplicates = async () => {
    setPreparing(true);
    try { await screeningApi.detectDuplicates(pid); } catch { /* non-fatal — page handles empty/detect */ }
    setPreparing(false);
    if (embedded) { (onDone || onBack || (() => {}))(); }
    else navigate(`/sift-beta/projects/${pid}?tab=duplicates`);
  };

  const [format,     setFormat]     = useState('auto');
  const [content,    setContent]    = useState('');
  const [filename,   setFilename]   = useState('');
  // 65.md SCR-10 — server-parsed preview: { detectedFormat, sample, counts, decisionColumnDetected, truncated }
  const [preview,    setPreview]    = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewDone,setPreviewDone]= useState(false);
  const [importing,  setImporting]  = useState(false);
  const [result,     setResult]     = useState(null);  // { imported, duplicateRecords, rejectedRecords, ... }
  const [error,      setError]      = useState(null);
  const [duplicate,  setDuplicate]  = useState(null);  // 409 duplicate_import → batch info (Task 19)
  const [dragOver,   setDragOver]   = useState(false);
  // prompt50 WS2 — durable async import progress (staged: validating → parsing →
  // deduplicating → saving → finalizing → completed). Polled from the job row.
  const [progress,   setProgress]   = useState(null);  // { status, stage, progress, importedRecords, ... }

  const estimated = countEntries(format, content);

  function handleContentChange(val) {
    setContent(val);
    setPreviewDone(false);
    setResult(null);
    setError(null);
    setDuplicate(null);
    setPreview(null);
  }

  // 65.md SCR-10 — the preview uses the REAL server parser registry (the same code
  // path the import runs), so what you preview is what will import.
  async function handlePreview() {
    if (previewing || !content.trim()) return;
    setPreviewing(true);
    setError(null);
    try {
      const p = await screeningApi.previewImport(pid, {
        format,
        content: content.slice(0, PREVIEW_MAX_CHARS),
        filename: filename || undefined,
      });
      setPreview(p);
      setPreviewDone(true);
    } catch (e) {
      setPreview(null);
      setPreviewDone(true);
      setError(e.message || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }

  // Map a file extension to a format HINT. The server still content-detects, so
  // an ambiguous extension (.txt) is left on 'auto' rather than mis-forced.
  const EXT_FORMAT = { ris: 'ris', bib: 'bibtex', nbib: 'nbib', ciw: 'ciw', xml: 'endnote', csv: 'csv', tsv: 'tsv' };
  function handleFileRead(file) {
    if (!file) return;
    setFilename(file.name);
    const ext = file.name.split('.').pop().toLowerCase();
    setFormat(EXT_FORMAT[ext] || 'auto');
    const reader = new FileReader();
    reader.onload = e => handleContentChange(e.target.result || '');
    reader.readAsText(file);  // UTF-8 by default; the server strips any BOM
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileRead(file);
  }

  // prompt50 WS2 — durable async import. We POST the file once, then POLL the job
  // row for staged progress until it reaches a terminal state. The browser can be
  // closed mid-import without losing the job (the server worker finishes it).
  // force=true is the "Import anyway" override after a duplicate-file warning.
  async function handleImport(force = false) {
    if (!content.trim()) return;
    setImporting(true);
    setError(null);
    setResult(null);
    setDuplicate(null);
    setProgress({ status: 'queued', stage: 'validating', progress: 0 });
    try {
      const started = await screeningApi.startImport(pid, {
        format,
        content,
        filename: filename || undefined,
      }, { force });
      const jobId = started.jobId;

      // Poll until terminal. ~1s cadence; the server is authoritative.
      let job = null;
      for (let i = 0; i < 1800; i++) {           // up to ~30 min ceiling
        job = await screeningApi.getImportJob(pid, jobId);
        setProgress(job);
        if (job.status === 'completed' || job.status === 'completed_with_warnings' || job.status === 'failed') break;
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!job) throw new Error('Import did not start. Please try again.');
      if (job.status === 'failed') {
        setError(job.error || 'Import failed');
      } else {
        // Normalise to the legacy success shape the UI already renders.
        setResult({
          imported: job.importedRecords,
          skippedDuplicates: job.duplicateRecords,
          rejected: job.rejectedRecords,
          total: job.totalRecords,
          batchId: job.batchId,
          format: job.detectedFormat,
          withWarnings: job.status === 'completed_with_warnings',
          // 65.md SCR-3 — per-row reject/invalid-decision reasons (capped server-side).
          errorReport: Array.isArray(job.errorReport) ? job.errorReport : [],
        });
      }
    } catch (e) {
      // 409 duplicate_import — same file fingerprint already imported.
      if (e.status === 409 && e.data?.error === 'duplicate_import') {
        setDuplicate(e.data.batch || {});
      } else {
        setError(e.message || 'Import failed');
      }
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  // Human label for the current import stage (durable-job progress UI).
  const STAGE_LABEL = {
    queued: 'Queued', validating: 'Validating', detecting: 'Detecting format',
    parsing: 'Parsing records', deduplicating: 'Checking duplicates',
    saving: 'Saving studies', finalizing: 'Finalizing', done: 'Completed', failed: 'Failed',
  };

  // prompt50 WS2 — the server auto-detects the real format from content (a .txt
  // file with RIS/PubMed/WoS markers is parsed correctly), so "Auto-detect" is the
  // recommended default. Explicit formats remain available for forcing.
  const formatOptions = [
    { val: 'auto',    label: 'Auto-detect',    ext: 'any',    desc: 'Detect the format from the file content (recommended) — RIS, PubMed, Web of Science, BibTeX, CSV, …' },
    { val: 'ris',     label: 'RIS',            ext: '.ris',   desc: 'Reference manager format (PubMed, Scopus, Embase, Cochrane, Zotero)' },
    { val: 'nbib',    label: 'PubMed / MEDLINE',ext: '.nbib', desc: 'NCBI/PubMed tagged export (also valid as .txt)' },
    { val: 'ciw',     label: 'Web of Science', ext: '.ciw',   desc: 'Clarivate/WoS tagged export (FN/VR header; also .txt)' },
    { val: 'bibtex',  label: 'BibTeX',         ext: '.bib',   desc: 'LaTeX bibliography (Mendeley, Zotero, Google Scholar)' },
    { val: 'csv',     label: 'CSV / TSV',      ext: '.csv',   desc: 'Delimited table with a title/doi header row' },
    { val: 'endnote', label: 'EndNote XML',    ext: '.xml',   desc: 'EndNote XML export' },
    { val: 'txt',     label: 'Plain text',     ext: '.txt',   desc: 'One title per line, or a delimited table' },
  ];

  return (
    <div style={embedded
      ? { background: 'transparent', fontFamily: FONT, color: C.txt }
      : { minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
      `}</style>

      {/* Header — standalone only; the embedded Screening stage supplies its own
          sub-navigation, so we skip the sticky page header there. */}
      {!embedded && (
        <div style={{
          background: C.surf, borderBottom: `1px solid ${C.brd}`,
          padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 12,
          position: 'sticky', top: 0, zIndex: 100,
        }}>
          <button
            onClick={() => navigate(`/sift-beta/projects/${pid}`)}
            style={{ background: 'none', border: 'none', color: C.txt2, cursor: 'pointer', fontSize: 12, fontFamily: FONT }}
            onMouseEnter={e => e.currentTarget.style.color = C.txt}
            onMouseLeave={e => e.currentTarget.style.color = C.txt2}
          >
            ← Workbench
          </button>
          <span style={{ color: C.brd2 }}>|</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>Import References</span>
          <BetaBadge />
        </div>
      )}

      <div style={{ maxWidth: 760, margin: '0 auto', padding: embedded ? '4px 0 8px' : '32px 24px' }}>

        {/* Format selector */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', marginBottom: 10, fontFamily: MONO, textTransform: 'uppercase' }}>
            Reference Format
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {formatOptions.map(opt => (
              <button
                key={opt.val}
                onClick={() => { setFormat(opt.val); handleContentChange(content); }}
                style={{
                  background: format === opt.val ? alpha(C.acc2, '30') : C.card,
                  border: `1px solid ${format === opt.val ? C.acc2 : C.brd}`,
                  color: format === opt.val ? C.acc : C.txt2,
                  fontSize: 12, fontFamily: FONT, padding: '8px 16px', borderRadius: 7,
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{opt.label} <span style={{ fontFamily: MONO, fontSize: 10, opacity: 0.7 }}>{opt.ext}</span></div>
                <div style={{ fontSize: 10, color: format === opt.val ? C.txt2 : C.muted, lineHeight: 1.3 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${dragOver ? C.acc : C.brd}`,
            borderRadius: 8, padding: '16px 20px', marginBottom: 14,
            background: dragOver ? alpha(C.acc, '08') : C.card,
            transition: 'all 0.15s', cursor: 'default',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.txt2 }}>
              Drag & drop a file here, or{' '}
              <label style={{ color: C.acc, cursor: 'pointer', textDecoration: 'underline' }}>
                browse
                <input
                  type="file"
                  accept=".ris,.bib,.nbib,.txt,.ciw,.csv,.tsv,.xml,.nbi,text/plain"
                  style={{ display: 'none' }}
                  onChange={e => handleFileRead(e.target.files?.[0])}
                />
              </label>
            </div>
            {filename && <span title={filename} style={{ fontSize: 10, fontFamily: MONO, color: C.muted, minWidth: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{filename}</span>}
          </div>

          <textarea
            value={content}
            onChange={e => handleContentChange(e.target.value)}
            placeholder={`Paste your ${format.toUpperCase()} content here…\n\nExample (RIS):\nTY  - JOUR\nTI  - Artificial intelligence in clinical care\nAU  - Smith, John\nPY  - 2023\nAB  - Background: ...\nER  -`}
            rows={14}
            style={{
              width: '100%', background: C.surf, border: `1px solid ${C.brd2}`,
              borderRadius: 6, padding: '10px 12px', color: C.txt, fontSize: 12,
              fontFamily: MONO, outline: 'none', resize: 'vertical', lineHeight: 1.5,
            }}
          />
        </div>

        {/* Info row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
          {content.trim() && (
            <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
              ~{estimated} {estimated === 1 ? 'entry' : 'entries'} detected
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            {content.trim() && (
              <button
                onClick={handlePreview}
                disabled={previewing}
                style={{
                  background: 'transparent', border: `1px solid ${C.brd2}`,
                  color: C.txt2, fontSize: 12, fontFamily: FONT,
                  padding: '7px 16px', borderRadius: 6, cursor: previewing ? 'wait' : 'pointer',
                  opacity: previewing ? 0.6 : 1,
                }}
              >
                {previewing ? 'Previewing…' : 'Preview first 5'}
              </button>
            )}
            <button
              onClick={() => handleImport()}
              disabled={importing || !content.trim()}
              style={{
                background: importing || !content.trim() ? C.brd : C.acc2,
                border: 'none', color: importing || !content.trim() ? C.muted : C.accText,
                fontSize: 13, fontWeight: 600, fontFamily: FONT,
                padding: '8px 24px', borderRadius: 7, cursor: importing || !content.trim() ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (!importing && content.trim()) e.currentTarget.style.background = C.acc; }}
              onMouseLeave={e => { if (!importing && content.trim()) e.currentTarget.style.background = C.acc2; }}
            >
              {importing ? 'Importing…' : `Import ${estimated > 0 ? estimated + ' ' : ''}References`}
            </button>
          </div>
        </div>

        {/* Preview table — server-parsed via the real parser registry (65.md SCR-10) */}
        {previewDone && (
          <div style={{
            background: C.card, border: `1px solid ${C.brd}`,
            borderRadius: 8, padding: '16px 18px', marginBottom: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', fontFamily: MONO, textTransform: 'uppercase' }}>
                Preview — First {preview?.sample?.length || 0} records
              </span>
              {preview?.detectedFormat && (
                <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.teal }}>
                  detected: {preview.detectedFormat}
                </span>
              )}
              {preview?.counts && (
                <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted }}>
                  {preview.counts.parsed} parsed{preview.counts.rejected > 0 ? ` · ${preview.counts.rejected} unusable` : ''}{preview.truncated ? ' · first 256KB' : ''}
                </span>
              )}
              {preview?.decisionColumnDetected && (
                <span title="A screening-decision column was found — labelled records will import already screened."
                  style={{ fontSize: 10.5, fontFamily: MONO, color: C.grn }}>
                  decision column detected
                </span>
              )}
            </div>
            {!preview || (preview.sample || []).length === 0 ? (
              <div style={{ fontSize: 12, color: C.muted }}>
                Could not parse preview. Check that the format matches the selected type and the content is valid.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {['#', 'Title', 'Author', 'Year'].map(h => (
                      <th key={h} style={{ textAlign: 'left', color: C.muted, fontWeight: 600, padding: '4px 8px', borderBottom: `1px solid ${C.brd}`, fontSize: 10, fontFamily: MONO, letterSpacing: '0.05em' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((rec, i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px 8px', color: C.muted, fontFamily: MONO, fontSize: 10 }}>{i + 1}</td>
                      <td title={rec.title || undefined} style={{ padding: '6px 8px', color: C.txt2, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rec.title || <span style={{ fontStyle: 'italic', color: C.muted }}>No title</span>}
                      </td>
                      <td title={rec.authors || undefined} style={{ padding: '6px 8px', color: C.muted, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rec.authors || '—'}
                      </td>
                      <td style={{ padding: '6px 8px', color: C.muted, fontFamily: MONO }}>{rec.year || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Duplicate file warning (Task 19) — same fingerprint already imported */}
        {duplicate && (
          <div style={{
            background: C.yelBg, border: `1px solid ${alpha(C.yel, '50')}`,
            borderRadius: 8, padding: '14px 18px', marginBottom: 16,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.ylw, marginBottom: 6 }}>
              ⚠ File already imported
            </div>
            <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6, marginBottom: 12 }}>
              This file appears to have already been imported
              {duplicate.importedAt && <> on <strong>{new Date(duplicate.importedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</strong></>}
              {duplicate.importedByName && <> by <strong>{duplicate.importedByName}</strong></>}
              {duplicate.recordCount != null && <> ({duplicate.recordCount} {duplicate.recordCount === 1 ? 'record' : 'records'})</>}
              . Records were not imported to prevent duplication.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => handleImport(true)}
                disabled={importing}
                style={{
                  background: C.ylw, border: 'none', color: C.bg,
                  fontSize: 12, fontWeight: 700, fontFamily: FONT,
                  padding: '7px 16px', borderRadius: 6,
                  cursor: importing ? 'not-allowed' : 'pointer', opacity: importing ? 0.6 : 1,
                }}
              >
                {importing ? 'Importing…' : 'Import anyway'}
              </button>
              <button
                onClick={() => setDuplicate(null)}
                disabled={importing}
                style={{
                  background: 'transparent', border: `1px solid ${alpha(C.yel, '50')}`,
                  color: C.ylw, fontSize: 12, fontFamily: FONT,
                  padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Durable-import progress (prompt50 WS2) — staged, responsive, leaveable */}
        {importing && progress && (
          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '16px 20px', marginBottom: 16 }} role="status" aria-live="polite">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>
                {STAGE_LABEL[progress.stage] || 'Importing'}…
              </div>
              <div style={{ fontSize: 11, fontFamily: MONO, color: C.muted }}>
                {progress.totalRecords ? `${progress.importedRecords || 0} / ${progress.totalRecords}` : ''}
              </div>
            </div>
            <div role="progressbar" aria-valuenow={progress.progress || 0} aria-valuemin={0} aria-valuemax={100}
              style={{ height: 8, background: C.bg, borderRadius: 99, overflow: 'hidden', border: `1px solid ${C.brd2}` }}>
              <div style={{ height: '100%', width: `${Math.max(4, progress.progress || 0)}%`, background: C.acc2, transition: 'width 0.3s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
              Processing on the server — you can leave this page and the import will finish.
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            background: C.redBg, border: `1px solid ${alpha(C.red, '50')}`,
            borderRadius: 8, padding: '12px 16px', color: C.red, fontSize: 13, marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        {/* Success */}
        {result && (
          <div style={{
            background: C.grnBg, border: `1px solid ${alpha(C.grn, '60')}`,
            borderRadius: 8, padding: '16px 20px', marginBottom: 16,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.grn, marginBottom: 6 }}>
              {result.withWarnings ? 'Import completed with warnings' : 'Import successful'}
            </div>
            <div style={{ fontSize: 13, color: C.txt2, marginBottom: 14 }}>
              {result.imported} new records imported
              {(() => {
                // Server reports skippedDuplicates explicitly (Task 19); fall back
                // to the old total−imported math for older payloads.
                const skipped = result.skippedDuplicates ?? (result.total > result.imported ? result.total - result.imported : 0);
                const parts = [];
                if (skipped > 0) parts.push(`${skipped} skipped as duplicates`);
                if (result.rejected > 0) parts.push(`${result.rejected} rejected (no usable title/DOI/PMID)`);
                if (result.format) parts.push(`detected as ${result.format}`);
                return parts.length ? ` (${parts.join(' · ')})` : '';
              })()}.
            </div>
            {/* 65.md SCR-3 — readable per-row issue list (rejects + invalid decisions) */}
            {result.errorReport?.length > 0 && (
              <details style={{ marginBottom: 14 }}>
                <summary style={{ fontSize: 12, color: C.ylw, cursor: 'pointer', userSelect: 'none' }}>
                  {result.errorReport.length} row issue{result.errorReport.length === 1 ? '' : 's'} — view details
                </summary>
                <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', border: `1px solid ${C.brd}`, borderRadius: 6, background: C.surf }}>
                  {result.errorReport.map((e, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 10px', fontSize: 11.5, color: C.txt2, borderBottom: i < result.errorReport.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
                      <span style={{ fontFamily: MONO, color: C.muted, flexShrink: 0 }}>#{e.index}</span>
                      <span title={e.title || undefined} style={{ minWidth: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.txt }}>
                        {e.title || <span style={{ fontStyle: 'italic', color: C.muted }}>(untitled)</span>}
                      </span>
                      <span style={{ color: C.muted }}>{e.reason}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                onClick={goToDuplicates}
                disabled={preparing}
                style={{
                  background: C.grn, border: 'none', color: C.bg,
                  fontSize: 12, fontWeight: 700, fontFamily: FONT,
                  padding: '7px 18px', borderRadius: 6, cursor: preparing ? 'wait' : 'pointer',
                  opacity: preparing ? 0.75 : 1,
                }}
              >
                {preparing ? 'Preparing duplicate review…' : 'Continue to Duplicates →'}
              </button>
              <button
                onClick={() => { setContent(''); setResult(null); setPreview(null); setPreviewDone(false); setFilename(''); }}
                style={{
                  background: 'transparent', border: `1px solid ${alpha(C.grn, '50')}`,
                  color: C.grn, fontSize: 12, fontFamily: FONT,
                  padding: '6px 16px', borderRadius: 6, cursor: 'pointer',
                }}
              >
                Import more
              </button>
            </div>
          </div>
        )}

        {/* Format help */}
        <details style={{ marginTop: 24 }}>
          <summary style={{ fontSize: 12, color: C.muted, cursor: 'pointer', userSelect: 'none' }}>
            Format examples & help
          </summary>
          <div style={{
            marginTop: 12, background: C.card, border: `1px solid ${C.brd}`,
            borderRadius: 8, padding: '14px 16px', fontSize: 11, color: C.txt2, lineHeight: 1.7,
          }}>
            <div style={{ marginBottom: 12 }}>
              <strong style={{ color: C.txt }}>RIS format</strong> — Used by PubMed, Scopus, Web of Science, Embase, Zotero, Mendeley.<br />
              Each record starts with TY (type) and ends with ER (end of reference).
            </div>
            <div style={{ marginBottom: 12 }}>
              <strong style={{ color: C.txt }}>BibTeX format</strong> — Used in LaTeX workflows, Google Scholar, and Zotero.<br />
              Each record starts with <code style={{ fontFamily: MONO, color: C.acc }}>@article{"{"}</code> or similar.
            </div>
            <div>
              <strong style={{ color: C.txt }}>NBIB format</strong> — NCBI PubMed native export format.<br />
              Export directly from PubMed: Save → Format: PubMed → Create file.
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
