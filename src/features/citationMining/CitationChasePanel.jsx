/**
 * CitationChasePanel.jsx — backward / forward citation chasing over selected seed
 * references. The user picks direction, depth (≤ 3) and a candidate limit (≤ 2000),
 * starts a durable job, watches its progress (polling), and can cancel. The
 * resulting candidates are listed with year / type / source filters, de-duplicated
 * against the project (New / Duplicate / Already-in-project badges) and imported
 * into screening (the shared import path → PRISMA accounting stays honest).
 *
 * Chasing runs on the SERVER as a bounded, cancellable, crash-resumable job — the
 * panel makes the "queued, may take a while" nature explicit and never blocks. No
 * user-facing "AI" wording: this is citation mining, Resolve / Map / Import.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, FONT, MONO, alpha } from '../../frontend/screening/ui/theme.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { Card, Btn, Note, StatTile, EmptyState, StatusPill, formatWhen } from '../pecanSearch/components/parts.jsx';
import { citationMiningApi } from './citationMiningApi.js';

const POLL_MS = 2500;
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'canceled']);
const DEDUP_TONE = {
  new: { c: () => C.grn, label: 'New' },
  exact_dup: { c: () => C.red, label: 'Duplicate' },
  fuzzy_dup: { c: () => C.gold, label: 'Likely dup' },
  existing_match: { c: () => C.teal, label: 'In project' },
};

function Badge({ col, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, color: col, background: alpha(col, 0.14), border: `1px solid ${alpha(col, 0.4)}`, whiteSpace: 'nowrap' }}>{label}</span>
  );
}

export default function CitationChasePanel({ pid, seedIds = [], readOnly, onImported }) {
  const [direction, setDirection] = useState('backward');
  const [depth, setDepth] = useState(1);
  const [maxCandidates, setMax] = useState(300);
  const [job, setJob] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const [cands, setCands] = useState(null); // null = not loaded
  const [sel, setSel] = useState(() => new Set());
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // filters
  const [yearFrom, setYearFrom] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [hideImported, setHideImported] = useState(false);

  const pollRef = useRef(null);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; if (pollRef.current) clearTimeout(pollRef.current); }, []);

  const loadCandidates = useCallback(async (jobId) => {
    try {
      const d = await citationMiningApi.listCandidates(pid, jobId ? { chaseJobId: jobId, take: 500 } : { take: 500 });
      if (aliveRef.current) setCands((d && d.candidates) || []);
    } catch (e) { if (aliveRef.current) setError(e.message || 'Could not load candidates.'); }
  }, [pid]);

  // Poll a running job to terminal, then load its candidates.
  const poll = useCallback((jobId) => {
    if (pollRef.current) clearTimeout(pollRef.current);
    const tick = async () => {
      try {
        const d = await citationMiningApi.getChase(pid, jobId);
        const j = d && d.job;
        if (!aliveRef.current) return;
        if (j) setJob(j);
        if (j && TERMINAL.has(j.status)) { loadCandidates(jobId); return; }
      } catch { /* transient — keep polling */ }
      if (aliveRef.current) pollRef.current = setTimeout(tick, POLL_MS);
    };
    pollRef.current = setTimeout(tick, POLL_MS);
  }, [pid, loadCandidates]);

  const start = useCallback(async () => {
    if (!seedIds.length) { setError('Select one or more resolved references first (in the References step).'); return; }
    setStarting(true); setError(''); setImportResult(null); setCands(null); setSel(new Set());
    try {
      const d = await citationMiningApi.startChase(pid, { seedIds, direction, depth, maxCandidates });
      const j = d && d.job;
      setJob(j || null);
      if (j && j.id && !TERMINAL.has(j.status)) poll(j.id);
      else if (j && j.id) loadCandidates(j.id);
    } catch (e) {
      setError(e.status === 503 ? 'The citation-mining engine is not available.' : e.status === 403 ? 'Read-only access — you cannot start a chase.' : (e.message || 'Could not start the chase.'));
    } finally { setStarting(false); }
  }, [pid, seedIds, direction, depth, maxCandidates, poll, loadCandidates]);

  const cancel = useCallback(async () => {
    if (!job || !job.id) return;
    try { const d = await citationMiningApi.cancelChase(pid, job.id); if (d && d.job) setJob(d.job); }
    catch (e) { setError(e.message || 'Cancel failed.'); }
  }, [pid, job]);

  const running = !!job && !TERMINAL.has(job.status);

  const checkDuplicates = useCallback(async () => {
    if (!cands || !cands.length) return;
    setChecking(true); setError('');
    try {
      const ids = cands.filter((c) => !c.imported).map((c) => c.id);
      await citationMiningApi.dedupePreview(pid, { candidateIds: ids, persist: true });
      await loadCandidates(job && job.id);
    } catch (e) { setError(e.message || 'Duplicate check failed.'); }
    finally { setChecking(false); }
  }, [pid, cands, job, loadCandidates]);

  const importSel = useCallback(async () => {
    const ids = [...sel];
    if (!ids.length) return;
    setImporting(true); setError('');
    try {
      const d = await citationMiningApi.importCandidates(pid, ids);
      setImportResult(d);
      setSel(new Set());
      await loadCandidates(job && job.id);
      if (onImported) onImported(d);
    } catch (e) { setError(e.status === 403 ? 'Read-only access — you cannot import.' : (e.message || 'Import failed.')); }
    finally { setImporting(false); }
  }, [pid, sel, job, loadCandidates, onImported]);

  const types = useMemo(() => {
    const s = new Set();
    for (const c of cands || []) if (c.publicationType) s.add(c.publicationType);
    return [...s].sort();
  }, [cands]);

  const filtered = useMemo(() => {
    let list = cands || [];
    if (yearFrom) { const y = parseInt(yearFrom, 10); if (Number.isFinite(y)) list = list.filter((c) => (parseInt(c.year, 10) || 0) >= y); }
    if (typeFilter !== 'all') list = list.filter((c) => (c.publicationType || '') === typeFilter);
    if (hideImported) list = list.filter((c) => !c.imported);
    return list;
  }, [cands, yearFrom, typeFilter, hideImported]);

  const selectableIds = useMemo(() => filtered.filter((c) => !c.imported).map((c) => c.id), [filtered]);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <Card title="Citation chase" icon="link"
      desc="Follow references backward (works this study cites) or forward (works that cite it) from the selected seed references. Runs as a queued background job — depth and a candidate limit keep it bounded."
      right={running ? (
        <Btn variant="danger" onClick={cancel}><Icon name="x" size={13} /> Cancel</Btn>
      ) : (
        <Btn variant="primary" busy={starting} onClick={start} disabled={readOnly || !seedIds.length}>
          <Icon name="link" size={13} /> Start chase{seedIds.length ? ` · ${seedIds.length} seed${seedIds.length === 1 ? '' : 's'}` : ''}
        </Btn>
      )}>

      {error ? <Note tone="error">{error}</Note> : null}
      {!seedIds.length && !running ? (
        <Note tone="info">No seeds selected yet. In the <strong>References</strong> step, resolve references and choose "Chase from selected".</Note>
      ) : null}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14, opacity: running ? 0.5 : 1, pointerEvents: running ? 'none' : 'auto' }}>
        <Ctl label="Direction">
          <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.brd2}` }}>
            {['backward', 'forward'].map((d) => (
              <button key={d} type="button" onClick={() => setDirection(d)} disabled={readOnly}
                style={{ padding: '7px 14px', fontFamily: FONT, fontSize: 12.5, fontWeight: direction === d ? 700 : 500, cursor: readOnly ? 'not-allowed' : 'pointer', border: 'none', background: direction === d ? alpha(C.acc, 0.16) : 'transparent', color: direction === d ? C.acc : C.txt2 }}>
                {d === 'backward' ? 'Backward (cited by)' : 'Forward (citing)'}
              </button>
            ))}
          </div>
        </Ctl>
        <Ctl label="Depth (≤ 3)">
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value))} disabled={readOnly} style={selStyle}>
            <option value={1}>1 — direct citations</option>
            <option value={2}>2 — one hop out</option>
            <option value={3}>3 — two hops out</option>
          </select>
        </Ctl>
        <Ctl label="Max candidates (≤ 2000)">
          <select value={maxCandidates} onChange={(e) => setMax(Number(e.target.value))} disabled={readOnly} style={selStyle}>
            {[100, 300, 500, 1000, 2000].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Ctl>
      </div>

      {/* Job progress */}
      {job ? (
        <div style={{ border: `1px solid ${C.brd}`, borderRadius: 10, padding: '12px 14px', background: C.card2, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <StatusPill state={job.status === 'processing' ? 'running' : job.status} />
            <span style={{ fontSize: 12, color: C.txt2 }}>
              {job.direction === 'forward' ? 'Forward' : 'Backward'} · depth {job.depth} · up to {job.maxCandidates}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: MONO, fontSize: 12, color: C.txt }}>{job.nFound || 0} found</span>
          </div>
          {running ? (
            <>
              <div style={{ height: 6, borderRadius: 4, background: alpha(C.muted, 0.15), overflow: 'hidden', marginTop: 10 }}>
                <div style={{ height: '100%', width: `${Math.max(3, job.progress || 0)}%`, background: C.acc, borderRadius: 4, transition: 'width 0.4s' }} />
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 7 }}>
                Queued and running in the background — this may take a while for large or deep chases. You can keep working; results appear here when it finishes.
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11.5, color: job.status === 'failed' ? C.red : C.muted, marginTop: 7 }}>
              {job.status === 'completed' ? `Completed · ${job.nFound || 0} candidate${job.nFound === 1 ? '' : 's'} found.`
                : job.status === 'cancelled' || job.status === 'canceled' ? 'Cancelled.'
                  : job.status === 'failed' ? `Failed${job.error ? ` — ${job.error}` : ''}.` : ''}
              {job.createdAt ? ` · ${formatWhen(job.createdAt)}` : ''}
            </div>
          )}
        </div>
      ) : null}

      {importResult ? (
        <Note tone="success">
          Imported {importResult.imported} into screening
          {importResult.skippedDuplicates ? ` · ${importResult.skippedDuplicates} duplicate${importResult.skippedDuplicates === 1 ? '' : 's'} skipped` : ''}
          {importResult.rejected ? ` · ${importResult.rejected} rejected` : ''}.
        </Note>
      ) : null}

      {/* Candidate list */}
      {cands === null ? null : cands.length === 0 ? (
        job && TERMINAL.has(job.status) ? <EmptyState icon="search" title="No new candidates">This chase produced no candidate studies. Try the other direction or a greater depth.</EmptyState> : null
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <StatTile label="Candidates" value={cands.length} />
            <StatTile label="New" value={cands.filter((c) => (c.dedupStatus || 'new') === 'new' && !c.imported).length} tone="green" />
            <StatTile label="Imported" value={cands.filter((c) => c.imported).length} tone="accent" />
          </div>

          {/* Filters + bulk actions */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '9px 12px', borderRadius: 10, background: C.card2, border: `1px solid ${C.brd}`, marginBottom: 10 }}>
            <label style={{ fontSize: 11.5, color: C.muted, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Year ≥ <input value={yearFrom} onChange={(e) => setYearFrom(e.target.value.replace(/[^0-9]/g, ''))} placeholder="any" inputMode="numeric" style={{ ...inpStyle, width: 64 }} />
            </label>
            {types.length ? (
              <label style={{ fontSize: 11.5, color: C.muted, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                Type <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={inpStyle}>
                  <option value="all">All</option>
                  {types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            ) : null}
            <label style={{ fontSize: 11.5, color: C.muted, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={hideImported} onChange={(e) => setHideImported(e.target.checked)} /> Hide imported
            </label>
            <span style={{ flex: 1 }} />
            {!readOnly && (
              <>
                <Btn variant="secondary" busy={checking} onClick={checkDuplicates}><Icon name="copy" size={13} /> Check duplicates</Btn>
                <Btn variant="secondary" onClick={() => setSel(new Set(selectableIds))} disabled={!selectableIds.length}>Select all ({selectableIds.length})</Btn>
                <Btn variant="primary" busy={importing} onClick={importSel} disabled={!sel.size}><Icon name="download" size={13} /> Import selected ({sel.size})</Btn>
              </>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map((c) => {
              const dt = DEDUP_TONE[c.dedupStatus] || null;
              const checked = sel.has(c.id);
              return (
                <div key={c.id} style={{ border: `1px solid ${checked ? alpha(C.acc, 0.5) : C.brd}`, borderRadius: 10, padding: '10px 12px', background: c.imported ? alpha(C.grn, 0.05) : checked ? alpha(C.acc, 0.06) : C.card, display: 'flex', gap: 10 }}>
                  {!readOnly && (
                    <input type="checkbox" checked={checked} disabled={c.imported} onChange={() => toggle(c.id)}
                      title={c.imported ? 'Already imported' : 'Select to import'} style={{ marginTop: 3, cursor: c.imported ? 'not-allowed' : 'pointer', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.txt, flex: 1, minWidth: 120 }}>{c.title || <em style={{ color: C.muted, fontWeight: 400 }}>Untitled candidate</em>}</span>
                      <Badge col={c.source === 'forward' ? C.teal : C.acc} label={c.source === 'forward' ? 'Citing' : 'Cited'} />
                      {dt ? <Badge col={dt.c()} label={dt.label} /> : null}
                      {c.imported ? <Badge col={C.grn} label="Imported" /> : null}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.txt2, marginTop: 3 }}>
                      {[Array.isArray(c.authors) ? c.authors.slice(0, 3).join(', ') : c.authors, c.journal, c.year].filter(Boolean).join(' · ') || <span style={{ color: C.muted }}>No metadata</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 5, flexWrap: 'wrap' }}>
                      {c.doi ? <a href={`https://doi.org/${c.doi}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: MONO, fontSize: 10.5, color: C.teal, textDecoration: 'none' }}>DOI {c.doi}</a> : null}
                      {c.pmid ? <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted }}>PMID {c.pmid}</span> : null}
                      {c.publicationType ? <span style={{ fontSize: 10.5, color: C.muted }}>{c.publicationType}</span> : null}
                    </div>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 ? <div style={{ padding: '14px 0', textAlign: 'center', color: C.muted, fontSize: 12 }}>No candidates match the current filters.</div> : null}
          </div>
        </>
      )}
    </Card>
  );
}

const selStyle = { padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.brd2}`, background: C.bg, color: C.txt, fontSize: 12.5, fontFamily: FONT };
const inpStyle = { padding: '5px 8px', borderRadius: 7, border: `1px solid ${C.brd2}`, background: C.bg, color: C.txt, fontSize: 12, fontFamily: FONT };

function Ctl({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</span>
      {children}
    </label>
  );
}
