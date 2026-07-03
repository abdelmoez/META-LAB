/**
 * ReferenceReview.jsx — the parsed reference list for one seed review: raw entry +
 * parsed fields (authors / title / journal / year / DOI / PMID) + an honest parse
 * confidence, a "Resolve references" action (canonicalises each to a DOI/PMID/
 * OpenAlex record), and a "Check against project" dedupe preview that badges each
 * reference as New / Duplicate / Already in project. Selected RESOLVED references
 * are handed to the citation chase as seeds (the landed backend imports chase-
 * produced candidates into screening — see CitationChasePanel — so this stage
 * resolves + de-duplicates references and feeds the chase).
 *
 * Provenance is explicit: every reference shows the seed review it came from
 * (via the parent's selection). No user-facing "AI" wording.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { C, FONT, MONO, alpha } from '../../frontend/screening/ui/theme.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { Card, Btn, Note, StatTile } from '../pecanSearch/components/parts.jsx';
import { citationMiningApi } from './citationMiningApi.js';

const RES_TONE = {
  resolved: { c: () => C.grn, label: 'Resolved' },
  not_found: { c: () => C.muted, label: 'Not found' },
  error: { c: () => C.red, label: 'Error' },
  pending: { c: () => C.gold, label: 'Unresolved' },
};
const DEDUP_TONE = {
  new: { c: () => C.grn, label: 'New' },
  exact_dup: { c: () => C.red, label: 'Duplicate' },
  fuzzy_dup: { c: () => C.gold, label: 'Likely duplicate' },
  existing_match: { c: () => C.teal, label: 'Already in project' },
};

function Badge({ tone, label }) {
  const col = tone ? tone.c() : C.muted;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.02em', padding: '2px 7px', borderRadius: 20, color: col, background: alpha(col, 0.14), border: `1px solid ${alpha(col, 0.4)}`, whiteSpace: 'nowrap' }}>
      {label || (tone && tone.label)}
    </span>
  );
}

function Confidence({ value }) {
  const pct = Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
  const col = pct >= 70 ? C.grn : pct >= 40 ? C.gold : C.red;
  return (
    <span title={`Parse confidence ${pct}%`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 34, height: 5, borderRadius: 4, background: alpha(C.muted, 0.15), overflow: 'hidden', display: 'inline-block' }}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: col, borderRadius: 4 }} />
      </span>
      <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted }}>{pct}%</span>
    </span>
  );
}

export default function ReferenceReview({ pid, seedId, readOnly, onChaseSeeds }) {
  const [seed, setSeed] = useState(null);
  const [refs, setRefs] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [summary, setSummary] = useState(null);       // last resolve summary
  const [dedup, setDedup] = useState(null);           // { [refId]: dedupStatus }
  const [sel, setSel] = useState(() => new Set());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const load = useCallback(async () => {
    if (!seedId) return;
    setRefs(null); setSeed(null); setError(''); setDedup(null); setSel(new Set());
    try {
      const [d, r] = await Promise.all([
        citationMiningApi.getSeedReview(seedId),
        citationMiningApi.listReferences(seedId),
      ]);
      setSeed((d && d.seedReview) || null);
      setRefs((r && r.references) || []);
    } catch (e) { setError(e.message || 'Could not load references.'); setRefs([]); }
  }, [seedId]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const list = refs || [];
    return {
      total: list.length,
      resolved: list.filter((x) => x.resolutionStatus === 'resolved').length,
      pending: list.filter((x) => x.resolutionStatus === 'pending' || !x.resolutionStatus).length,
    };
  }, [refs]);

  const resolve = useCallback(async () => {
    setResolving(true); setError('');
    try {
      const d = await citationMiningApi.resolveSeed(seedId, { onlyPending: true });
      setSummary((d && d.summary) || null);
      const r = await citationMiningApi.listReferences(seedId);
      setRefs((r && r.references) || []);
    } catch (e) { setError(e.status === 503 ? 'The citation-mining engine is not available.' : (e.message || 'Resolve failed.')); }
    finally { setResolving(false); }
  }, [seedId]);

  const checkProject = useCallback(async () => {
    setChecking(true); setError('');
    try {
      // Preview-only (persist:false) — references are not candidates, so nothing is
      // written; we just badge each against the project's existing records.
      const payload = (refs || []).map((r) => ({ id: r.id, title: r.title, doi: r.doi || r.resolvedDoi, pmid: r.pmid || r.resolvedPmid, year: r.year, authors: r.authors, journal: r.journal }));
      const d = await citationMiningApi.dedupePreview(pid, { refs: payload, persist: false });
      const map = {};
      for (const row of (d && d.results) || []) map[row.id] = row.dedupStatus;
      setDedup(map);
    } catch (e) { setError(e.status === 503 ? 'The citation-mining engine is not available.' : (e.message || 'Check failed.')); }
    finally { setChecking(false); }
  }, [pid, refs]);

  // Import this seed review's RESOLVED references directly into screening. Resolving
  // a reference creates a source:'reference' citation candidate server-side, so we
  // land those through the same import path as chase candidates.
  const importResolved = useCallback(async () => {
    setImporting(true); setError(''); setImportResult(null);
    try {
      const d = await citationMiningApi.listCandidates(pid, { seedReviewId: seedId, imported: false });
      const ids = ((d && d.candidates) || []).filter((c) => c.source === 'reference').map((c) => c.id);
      if (!ids.length) { setError('No resolved references to import yet — resolve references first.'); return; }
      const out = await citationMiningApi.importCandidates(pid, ids);
      setImportResult(out);
    } catch (e) { setError(e.status === 503 ? 'The citation-mining engine is not available.' : (e.message || 'Import failed.')); }
    finally { setImporting(false); }
  }, [pid, seedId]);

  const resolvedSelectable = useMemo(() => (refs || []).filter((r) => r.resolutionStatus === 'resolved'), [refs]);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selCount = sel.size;

  if (!seedId) {
    return <Card title="References" icon="table"><Note tone="info">Select a seed review to view its parsed references.</Note></Card>;
  }

  return (
    <Card title={seed ? (seed.title || seed.filename || 'References') : 'References'} icon="table"
      desc={seed ? `Parsed bibliography · ${counts.total} reference${counts.total === 1 ? '' : 's'}` : 'Loading…'}
      right={!readOnly ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn variant="secondary" busy={checking} onClick={checkProject} disabled={!refs || !refs.length}>
            <Icon name="copy" size={13} /> Check against project
          </Btn>
          <Btn variant="primary" busy={resolving} onClick={resolve} disabled={!counts.pending}>
            <Icon name="refresh" size={13} /> Resolve references{counts.pending ? ` (${counts.pending})` : ''}
          </Btn>
          <Btn variant="secondary" busy={importing} onClick={importResolved} disabled={!counts.resolved}>
            <Icon name="download" size={13} /> Import resolved → screening{counts.resolved ? ` (${counts.resolved})` : ''}
          </Btn>
        </div>
      ) : null}>

      {error ? <Note tone="error">{error}</Note> : null}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatTile label="References" value={counts.total} />
        <StatTile label="Resolved" value={counts.resolved} tone={counts.resolved ? 'green' : undefined} />
        <StatTile label="Unresolved" value={counts.pending} tone={counts.pending ? 'yellow' : undefined} />
      </div>

      {summary ? (
        <Note tone={summary.error ? 'warn' : 'success'}>
          Resolved {summary.resolved} of {summary.total} · {summary.notFound} not found · {summary.error} error{summary.error === 1 ? '' : 's'}.
        </Note>
      ) : null}

      {importResult ? (
        <Note tone="success">
          Imported {importResult.imported} into screening · {importResult.skippedDuplicates} duplicate{importResult.skippedDuplicates === 1 ? '' : 's'} skipped{importResult.rejected ? ` · ${importResult.rejected} rejected` : ''}.
        </Note>
      ) : null}

      {refs === null ? (
        <div style={{ padding: '18px 0', color: C.muted, fontSize: 12.5, fontFamily: FONT }}>Loading references…</div>
      ) : refs.length === 0 ? (
        <Note tone="warn">No references were parsed from this seed review. The bibliography may not have been detected — try a text-based PDF.</Note>
      ) : (
        <>
          {/* Chase-seed selection bar */}
          {!readOnly && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 12px', borderRadius: 10, background: C.card2, border: `1px solid ${C.brd}`, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: C.txt2 }}>
                {selCount ? <><strong style={{ color: C.txt }}>{selCount}</strong> selected</> : 'Select resolved references to chase their citations'}
              </span>
              <span style={{ flex: 1 }} />
              <Btn variant="secondary" onClick={() => setSel(new Set(resolvedSelectable.map((r) => r.id)))} disabled={!resolvedSelectable.length}>Select resolved</Btn>
              <Btn variant="primary" onClick={() => onChaseSeeds && onChaseSeeds([...sel])} disabled={!selCount || !onChaseSeeds}>
                <Icon name="link" size={13} /> Chase from selected
              </Btn>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {refs.map((r, i) => {
              const rt = RES_TONE[r.resolutionStatus] || RES_TONE.pending;
              const dt = dedup ? DEDUP_TONE[dedup[r.id]] : null;
              const canSeed = r.resolutionStatus === 'resolved';
              const checked = sel.has(r.id);
              return (
                <div key={r.id} style={{ border: `1px solid ${checked ? alpha(C.acc, 0.5) : C.brd}`, borderRadius: 10, padding: '10px 12px', background: checked ? alpha(C.acc, 0.06) : C.card, display: 'flex', gap: 10 }}>
                  {!readOnly && (
                    <input type="checkbox" checked={checked} disabled={!canSeed} onChange={() => toggle(r.id)}
                      title={canSeed ? 'Use as a chase seed' : 'Resolve this reference first to chase it'}
                      style={{ marginTop: 3, cursor: canSeed ? 'pointer' : 'not-allowed', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted }}>{r.orderIndex ?? i + 1}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.txt, flex: 1, minWidth: 120 }}>{r.title || <em style={{ color: C.muted, fontWeight: 400 }}>Untitled — no title parsed</em>}</span>
                      <Badge tone={rt} />
                      {dt ? <Badge tone={dt} /> : null}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.txt2, marginTop: 3 }}>
                      {[r.authors, r.journal, r.year].filter(Boolean).join(' · ') || <span style={{ color: C.muted }}>No author / journal parsed</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                      <Confidence value={r.parseConfidence} />
                      {(r.doi || r.resolvedDoi) ? <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.teal }}>DOI {r.resolvedDoi || r.doi}</span> : null}
                      {(r.pmid || r.resolvedPmid) ? <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted }}>PMID {r.resolvedPmid || r.pmid}</span> : null}
                    </div>
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ fontSize: 10.5, color: C.muted, cursor: 'pointer' }}>Raw entry</summary>
                      <div style={{ fontSize: 11, color: C.txt2, marginTop: 4, lineHeight: 1.5, fontFamily: MONO, wordBreak: 'break-word' }}>{r.raw}</div>
                    </details>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
