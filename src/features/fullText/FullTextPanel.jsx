/**
 * FullTextPanel.jsx — 68.md P9 automated OA full-text retrieval, in-workspace panel.
 *
 * A collapsible panel embedded near the top of Final Review. It shows honest OA
 * full-text coverage for the project's records, lets a leader / importer trigger a
 * background retrieval job (polling its terminal counts), lists per-record retrieval
 * state with publisher / PubMed / Scholar link-outs and a request workflow for
 * no-OA records, and accepts a bulk PDF drop that auto-attaches only high-confidence
 * matches (the server's honest default — unmatched files are reported, never stored).
 *
 * The heavy leaf views (CoverageHeader, RecordRow, BulkUpload) are exported so the
 * SSR-safe unit tests can render them directly without waiting on effects. Flag OFF
 * → the panel renders null (mounted lazily so the off path costs nothing).
 *
 * Props: { pid } — the ScreenProject id.
 * House style: inline styles with var(--t-*) tokens (mirrors pecanSearch components).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { C, FONT, MONO, alpha } from '../../frontend/screening/ui/theme.js';
import { fullTextApi } from './fullTextApi.js';
import { fullTextRetrievalFlagEnabled } from './flag.js';

const POLL_MS = 2500;
const TERMINAL = new Set(['completed', 'failed', 'canceled', 'cancelled', 'error', 'done']);

// ── Small style helpers (token-driven; mirror pecanSearch look) ───────────────
const card = {
  background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12,
  fontFamily: FONT, color: C.txt,
};
const chip = (color) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 10.5,
  fontWeight: 700, letterSpacing: '0.02em', padding: '2px 8px', borderRadius: 20,
  background: alpha(color, 0.14), color, border: `1px solid ${alpha(color, 0.4)}`,
});
const btn = (variant = 'ghost', disabled = false) => {
  const base = {
    fontFamily: FONT, fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
    display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
  };
  if (variant === 'primary') return { ...base, background: C.acc, color: '#fff', border: `1px solid ${C.acc}` };
  return { ...base, background: 'transparent', color: C.txt2, border: `1px solid ${C.brd2}` };
};

// ── Record status → chip descriptor ───────────────────────────────────────────
export function recordStatus(rec) {
  if (rec.attachmentCount > 0) return { color: C.grn, label: 'PDF attached' };
  const cand = rec.bestCandidate;
  if (cand && cand.status === 'found' && cand.pdfUrl) return { color: C.teal, label: 'OA found' };
  if (cand && (cand.status === 'error' || cand.status === 'failed')) return { color: C.red, label: 'Failed' };
  return { color: C.gold, label: 'No OA — request' };
}

// ── Coverage header (exported leaf; SSR-safe) ─────────────────────────────────
export function CoverageHeader({ coverage }) {
  const cov = coverage || {};
  const included = Number(cov.included || 0);
  const withPdf = Number(cov.includedWithPdf || 0);
  const pct = included > 0 ? Math.round((withPdf / included) * 100) : 0;
  const stat = (label, value, color) => (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
      <strong style={{ fontFamily: MONO, fontSize: 13, color: color || C.txt }}>{value}</strong>
      <span style={{ fontSize: 11, color: C.muted }}>{label}</span>
    </span>
  );
  return (
    <div>
      <div style={{ fontSize: 13, color: C.txt2, marginBottom: 8 }}>
        <strong style={{ color: C.txt }}>{withPdf}</strong> of <strong style={{ color: C.txt }}>{included}</strong>{' '}
        included records have full text
      </div>
      <div style={{ height: 8, borderRadius: 6, background: C.card2, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: C.grn, borderRadius: 6, transition: 'width 0.3s' }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {stat('OA found', Number(cov.candidatesFound || 0), C.teal)}
        {stat('requested', Number(cov.requested || 0), C.gold)}
        {stat('received', Number(cov.received || 0), C.grn)}
        {stat('no OA', Number(cov.noOa || 0), C.muted)}
      </div>
    </div>
  );
}

// ── Job counts breakdown (exported leaf; SSR-safe) ────────────────────────────
export function JobResult({ job }) {
  if (!job) return null;
  const c = job.counts || {};
  const terminal = TERMINAL.has(String(job.status || '').toLowerCase());
  const rows = [
    ['fetched', c.fetched, C.grn],
    ['already had', c.alreadyHad, C.txt2],
    ['no OA', c.noOa, C.muted],
    ['link-out only', c.linkOut, C.gold],
    ['failed', c.failed, C.red],
  ].filter(([, v]) => v != null);
  return (
    <div style={{
      marginTop: 10, padding: '10px 12px', borderRadius: 8,
      background: C.card2, border: `1px solid ${C.brd}`, fontSize: 12,
    }}>
      <div style={{ fontSize: 11, fontFamily: MONO, color: C.muted, marginBottom: 6 }}>
        {terminal ? 'Last retrieval' : `Retrieving… ${job.processed || 0}/${job.total || 0}`}
        {job.scope ? ` · scope: ${job.scope}` : ''}
      </div>
      {job.status === 'failed' && job.error ? (
        <div style={{ color: C.red }}>{job.error}</div>
      ) : rows.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {rows.map(([label, v, color]) => (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
              <strong style={{ fontFamily: MONO, fontSize: 12.5, color }}>{v}</strong>
              <span style={{ fontSize: 11, color: C.muted }}>{label}</span>
            </span>
          ))}
        </div>
      ) : (
        <div style={{ color: C.muted }}>No counts yet.</div>
      )}
    </div>
  );
}

// ── Per-record row (exported leaf; SSR-safe) ──────────────────────────────────
export function RecordRow({ rec, canTrigger, onRequest, busy }) {
  const [note, setNote] = useState(rec.requestNote || '');
  const st = recordStatus(rec);
  const cand = rec.bestCandidate;
  const noOa = rec.attachmentCount === 0;
  const publisherUrl = rec.doi ? `https://doi.org/${rec.doi}` : (cand && cand.landingUrl) || '';
  const pubmedUrl = rec.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${rec.pmid}/` : '';
  const scholarUrl = rec.title ? `https://scholar.google.com/scholar?q=${encodeURIComponent(rec.title)}` : '';

  const linkBtn = (href, label) => href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ ...btn('ghost'), textDecoration: 'none', fontSize: 12 }}>
      {label} ↗
    </a>
  ) : null;

  return (
    <div style={{ padding: '12px 14px', borderTop: `1px solid ${C.brd}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: C.txt, lineHeight: 1.4,
            overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>
            {rec.title || <span style={{ fontStyle: 'italic', color: C.muted }}>Untitled record</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 5 }}>
            {rec.doi && <span style={chip(C.acc)}>DOI {rec.doi}</span>}
            {rec.pmid && <span style={chip(C.teal)}>PMID {rec.pmid}</span>}
            {rec.included && <span style={chip(C.grn)}>included</span>}
          </div>
        </div>
        <span style={{ ...chip(st.color), flexShrink: 0 }}>{st.label}</span>
      </div>

      {noOa && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${C.brd}` }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: canTrigger ? 8 : 0 }}>
            {linkBtn(publisherUrl, 'Publisher')}
            {linkBtn(pubmedUrl, 'PubMed')}
            {linkBtn(scholarUrl, 'Google Scholar')}
          </div>
          {canTrigger && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Request note (optional)"
                style={{
                  flex: '1 1 200px', minWidth: 140, background: C.surf, border: `1px solid ${C.brd2}`,
                  borderRadius: 7, padding: '6px 10px', color: C.txt, fontSize: 12.5, fontFamily: FONT, outline: 'none',
                }}
              />
              <button type="button" disabled={busy} style={btn('ghost', busy)}
                onClick={() => onRequest(rec, 'requested', note)}>Mark requested</button>
              <button type="button" disabled={busy} style={btn('ghost', busy)}
                onClick={() => onRequest(rec, 'received', note)}>Mark received</button>
              {rec.requestStatus && rec.requestStatus !== 'none' && (
                <span style={{ ...chip(rec.requestStatus === 'received' ? C.grn : C.gold) }}>
                  {rec.requestStatus}
                </span>
              )}
            </div>
          )}
          {!canTrigger && rec.requestStatus && rec.requestStatus !== 'none' && (
            <span style={{ ...chip(rec.requestStatus === 'received' ? C.grn : C.gold), marginTop: 6 }}>
              {rec.requestStatus}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Bulk-upload results table (exported leaf; SSR-safe) ───────────────────────
export function BulkResults({ result }) {
  if (!result) return null;
  const rows = Array.isArray(result.results) ? result.results : [];
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12.5, color: C.txt2, marginBottom: 8 }}>
        <strong style={{ color: C.grn }}>{result.matched || 0}</strong> of {result.total || 0} file
        {result.total === 1 ? '' : 's'} auto-attached.
      </div>
      <div style={{ border: `1px solid ${C.brd}`, borderRadius: 8, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            padding: '7px 12px', fontSize: 12, borderTop: i ? `1px solid ${C.brd}` : 'none',
          }}>
            <span style={{ fontFamily: MONO, color: C.txt, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.filename}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {r.confidence != null && (
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{Math.round(r.confidence * 100)}%</span>
              )}
              <span style={chip(r.matched ? C.grn : C.gold)}>{r.matched ? 'attached' : (r.reason || 'no match')}</span>
            </span>
          </div>
        ))}
      </div>
      {result.note && (
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>{result.note}</div>
      )}
    </div>
  );
}

// ── Disabled / null leaf ──────────────────────────────────────────────────────
export function DisabledNote() { return null; }

// ── Main panel ────────────────────────────────────────────────────────────────
export default function FullTextPanel({ pid }) {
  const [enabled, setEnabled] = useState(null); // null = flag not resolved yet
  const [open, setOpen] = useState(false);

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [scope, setScope] = useState('included');
  const [job, setJob] = useState(null);
  const [running, setRunning] = useState(false);
  const pollRef = useRef(null);

  const [filter, setFilter] = useState('missing');
  const [records, setRecords] = useState(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [requestBusy, setRequestBusy] = useState({});

  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  // Resolve the flag once.
  useEffect(() => {
    let live = true;
    fullTextRetrievalFlagEnabled().then((on) => { if (live) setEnabled(on); });
    return () => { live = false; };
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await fullTextApi.getStatus(pid);
      setStatus(d);
      if (d && d.lastJob) setJob(d.lastJob);
    } catch (e) {
      setError(e?.message || 'Failed to load full-text status.');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  const loadRecords = useCallback(async (f) => {
    setRecordsLoading(true);
    try {
      const d = await fullTextApi.getRecords(pid, f);
      setRecords(d);
    } catch (e) {
      setError(e?.message || 'Failed to load records.');
    } finally {
      setRecordsLoading(false);
    }
  }, [pid]);

  // Lazy-load status + records the first time the panel is opened.
  useEffect(() => {
    if (open && enabled && !status && !loading) loadStatus();
  }, [open, enabled, status, loading, loadStatus]);
  useEffect(() => {
    if (open && enabled) loadRecords(filter);
  }, [open, enabled, filter, loadRecords]);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  const pollJob = useCallback((jobId) => {
    const tick = async () => {
      try {
        const d = await fullTextApi.getJob(pid, jobId);
        const j = d && d.job;
        setJob(j);
        if (j && !TERMINAL.has(String(j.status || '').toLowerCase())) {
          pollRef.current = setTimeout(tick, POLL_MS);
        } else {
          setRunning(false);
          loadStatus();
          loadRecords(filter);
        }
      } catch (e) {
        setRunning(false);
        setError(e?.message || 'Lost track of the retrieval job.');
      }
    };
    pollRef.current = setTimeout(tick, POLL_MS);
  }, [pid, filter, loadStatus, loadRecords]);

  const startRetrieve = useCallback(async () => {
    if (running) return;
    setRunning(true); setError(null);
    try {
      const d = await fullTextApi.retrieve(pid, scope);
      const j = d && d.job;
      setJob(j);
      if (j && TERMINAL.has(String(j.status || '').toLowerCase())) {
        setRunning(false);
        loadStatus(); loadRecords(filter);
      } else if (j) {
        pollJob(j.id);
      } else {
        setRunning(false);
      }
    } catch (e) {
      setRunning(false);
      setError(e?.message || 'Failed to start retrieval.');
    }
  }, [pid, scope, running, pollJob, loadStatus, loadRecords, filter]);

  const doRequest = useCallback(async (rec, reqStatus, note) => {
    setRequestBusy((p) => ({ ...p, [rec.recordId]: true }));
    try {
      await fullTextApi.upsertRequest(pid, rec.recordId, { status: reqStatus, note });
      await loadRecords(filter);
      await loadStatus();
    } catch (e) {
      setError(e?.message || 'Failed to update request.');
    } finally {
      setRequestBusy((p) => { const n = { ...p }; delete n[rec.recordId]; return n; });
    }
  }, [pid, filter, loadRecords, loadStatus]);

  const doUpload = useCallback(async (files) => {
    const list = Array.from(files || []).filter((f) => /\.pdf$/i.test(f.name));
    if (!list.length) return;
    setUploading(true); setUploadResult(null); setError(null);
    try {
      const d = await fullTextApi.bulkUpload(pid, list);
      setUploadResult(d);
      await loadRecords(filter);
      await loadStatus();
    } catch (e) {
      setError(e?.message || 'Bulk upload failed.');
    } finally {
      setUploading(false);
    }
  }, [pid, filter, loadRecords, loadStatus]);

  // Flag off (or still resolving) → render nothing.
  if (!enabled) return null;

  const canTrigger = !!(status && status.canTrigger);
  const rows = (records && Array.isArray(records.records)) ? records.records : [];

  const FILTERS = [
    { key: 'missing', label: 'Missing PDF' },
    { key: 'linkout', label: 'Link-out' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div style={{ ...card, marginBottom: 18, overflow: 'hidden' }}>
      {/* Collapsible header */}
      <button type="button" onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '13px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
          fontFamily: FONT, color: C.txt, textAlign: 'left',
        }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{ fontSize: 16 }}>📥</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Full-text retrieval</span>
          {status && status.coverage && (
            <span style={{ fontSize: 12, color: C.muted }}>
              {status.coverage.includedWithPdf}/{status.coverage.included} included have full text
            </span>
          )}
        </span>
        <span aria-hidden style={{ fontSize: 12, color: C.muted, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▶</span>
      </button>

      {open && (
        <div style={{ padding: '4px 16px 16px' }}>
          {error && (
            <div style={{
              fontSize: 12.5, color: C.red, background: C.redBg, border: `1px solid ${alpha(C.red, 0.35)}`,
              borderRadius: 8, padding: '8px 12px', marginBottom: 12,
            }}>{error}</div>
          )}

          {loading && !status ? (
            <div style={{ fontSize: 12.5, color: C.muted, padding: '12px 0' }}>Loading full-text status…</div>
          ) : status ? (
            <>
              <CoverageHeader coverage={status.coverage} />

              {/* Retrieve controls */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 14 }}>
                {canTrigger ? (
                  <>
                    <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={running}
                      style={{
                        fontFamily: FONT, fontSize: 12.5, padding: '7px 10px', borderRadius: 8,
                        background: C.surf, color: C.txt, border: `1px solid ${C.brd2}`, cursor: running ? 'not-allowed' : 'pointer',
                      }}>
                      <option value="included">Included records</option>
                      <option value="missing">Records missing a PDF</option>
                    </select>
                    <button type="button" onClick={startRetrieve} disabled={running} style={btn('primary', running)}>
                      {running && <span aria-hidden style={{ width: 12, height: 12, border: `2px solid ${alpha('#fff', 0.4)}`, borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />}
                      {running ? 'Retrieving…' : 'Retrieve available full texts'}
                    </button>
                  </>
                ) : (
                  <span style={{ fontSize: 12, color: C.muted }}>
                    You can view retrieval status; a project leader triggers retrieval.
                  </span>
                )}
              </div>

              <JobResult job={job} />

              {/* Records list */}
              <div style={{ marginTop: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>
                    Records
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {FILTERS.map((f) => {
                      const on = filter === f.key;
                      return (
                        <button key={f.key} type="button" onClick={() => setFilter(f.key)}
                          style={{
                            fontFamily: FONT, fontSize: 11.5, fontWeight: on ? 700 : 500, padding: '4px 10px', borderRadius: 7,
                            cursor: 'pointer', background: on ? alpha(C.acc, 0.14) : 'transparent',
                            color: on ? C.acc : C.txt2, border: `1px solid ${on ? alpha(C.acc, 0.4) : C.brd2}`,
                          }}>{f.label}</button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ border: `1px solid ${C.brd}`, borderRadius: 10, overflow: 'hidden' }}>
                  {recordsLoading && !records ? (
                    <div style={{ fontSize: 12.5, color: C.muted, padding: '14px' }}>Loading records…</div>
                  ) : rows.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: C.muted, padding: '14px' }}>
                      {filter === 'missing' ? 'Every record has a PDF attached.' : 'No records match this filter.'}
                    </div>
                  ) : (
                    <>
                      {rows.map((rec, i) => (
                        <div key={rec.recordId} style={i === 0 ? { borderTop: 'none' } : undefined}>
                          <RecordRow rec={rec} canTrigger={canTrigger}
                            onRequest={doRequest} busy={!!requestBusy[rec.recordId]} />
                        </div>
                      ))}
                    </>
                  )}
                </div>
                {records && records.capped && (
                  <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
                    Showing the first {rows.length} of {records.total} records.
                  </div>
                )}
              </div>

              {/* Bulk upload */}
              {canTrigger && (
                <div style={{ marginTop: 18 }}>
                  <span style={{ fontSize: 11, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>
                    Bulk upload PDFs
                  </span>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); doUpload(e.dataTransfer.files); }}
                    style={{
                      marginTop: 8, padding: '18px 16px', borderRadius: 10, textAlign: 'center',
                      border: `1.5px dashed ${dragOver ? C.acc : C.brd2}`,
                      background: dragOver ? alpha(C.acc, 0.06) : C.surf,
                    }}>
                    <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: 'none' }}
                      onChange={(e) => { doUpload(e.target.files); e.target.value = ''; }} />
                    <div style={{ fontSize: 12.5, color: C.txt2, marginBottom: 8 }}>
                      Drop PDFs here, or
                    </div>
                    <button type="button" disabled={uploading} style={btn('ghost', uploading)}
                      onClick={() => fileRef.current && fileRef.current.click()}>
                      {uploading ? 'Matching…' : 'Choose PDF files'}
                    </button>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
                      Only high-confidence matches are attached automatically. Unmatched files are reported, never stored.
                    </div>
                  </div>
                  <BulkResults result={uploadResult} />
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
