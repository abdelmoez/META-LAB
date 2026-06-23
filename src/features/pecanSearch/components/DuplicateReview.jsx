/**
 * DuplicateReview.jsx — the ambiguous-duplicate review surface (§6.7). For each
 * pending candidate the engine returns an EXPLAINABLE breakdown (score, matchType,
 * reasons, conflicts, per-signal components). We render incoming vs existing
 * side-by-side, surface every matching signal (DOI / PMID / title similarity /
 * author overlap / year / journal), and let the reviewer Confirm merge / Keep
 * separate / Defer. The score/threshold/confidence + which canonical values stay
 * are shown so a human can defend the decision.
 *
 * All numbers come straight from /duplicates; we never recompute a score here.
 */
import { useState } from 'react';
import { C } from '../../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../../frontend/theme/tokens.js';
import { Card, Btn, ScoreBar, Note, EmptyState, Skeleton } from './parts.jsx';

/** Field labels for the side-by-side record comparison. */
const RECORD_FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'authors', label: 'Authors' },
  { key: 'year', label: 'Year' },
  { key: 'journal', label: 'Journal' },
  { key: 'doi', label: 'DOI' },
  { key: 'pmid', label: 'PMID' },
  { key: 'sourceDb', label: 'Source' },
];

function RecordColumn({ title, record, accent }) {
  return (
    <div style={{ flex: '1 1 0%', minWidth: 0, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: accent, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      {!record ? <div style={{ fontSize: 12, color: C.dim }}>Record unavailable.</div> : (
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px' }}>
          {RECORD_FIELDS.map((f) => {
            const v = record[f.key];
            return (
              <div key={f.key} style={{ display: 'contents' }}>
                <dt style={{ fontSize: 10.5, color: C.muted, fontWeight: 700 }}>{f.label}</dt>
                <dd style={{ margin: 0, fontSize: 12, color: v ? C.txt : C.dim, wordBreak: 'break-word', lineHeight: 1.5 }}>{v || '—'}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}

/** A reasons/conflicts/signals breakdown rendered from the explainable shape. */
function SignalBreakdown({ candidate }) {
  const reasons = Array.isArray(candidate.reasons) ? candidate.reasons : [];
  const conflicts = Array.isArray(candidate.conflicts) ? candidate.conflicts : [];
  const components = candidate.components && typeof candidate.components === 'object' ? candidate.components : {};
  const compEntries = Object.entries(components);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, marginTop: 12 }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.grn, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Why these may match</div>
        {reasons.length ? (
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: C.txt2, lineHeight: 1.7 }}>
            {reasons.map((r, i) => <li key={i}>{typeof r === 'string' ? r : (r.label || r.reason || JSON.stringify(r))}</li>)}
          </ul>
        ) : <div style={{ fontSize: 11.5, color: C.dim }}>No explicit reasons recorded.</div>}
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.yel, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Conflicting fields</div>
        {conflicts.length ? (
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: C.txt2, lineHeight: 1.7 }}>
            {conflicts.map((r, i) => <li key={i}>{typeof r === 'string' ? r : (r.label || r.field || JSON.stringify(r))}</li>)}
          </ul>
        ) : <div style={{ fontSize: 11.5, color: C.dim }}>None.</div>}
      </div>
      {compEntries.length > 0 && (
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Signal scores</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {compEntries.map(([k, v]) => (
              <span key={k} style={{ fontSize: 11, fontFamily: "'IBM Plex Mono',monospace", color: C.txt2, background: C.card2, border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 8px' }}>
                {humanizeSignal(k)}: {formatSignal(v)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function humanizeSignal(k) {
  return ({ doi: 'DOI', pmid: 'PMID', title: 'Title sim', titleSim: 'Title sim', author: 'Author overlap', authorOverlap: 'Author overlap', year: 'Year', journal: 'Journal' })[k] || k;
}
function formatSignal(v) {
  if (typeof v === 'number') return v <= 1 && v >= 0 ? v.toFixed(2) : String(v);
  if (typeof v === 'boolean') return v ? 'match' : 'no';
  return String(v);
}

function CandidateCard({ candidate, onResolve, busy }) {
  const [acting, setActing] = useState('');
  const act = async (action) => {
    setActing(action);
    try { await onResolve(candidate.id, action); } finally { setActing(''); }
  };
  const disabled = !!busy || !!acting;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 260 }}>
          <ScoreBar score={candidate.score} threshold={candidate.threshold} />
        </div>
        <div style={{ flex: '0 0 auto', fontSize: 11, color: C.muted }}>
          {candidate.matchType && <span style={{ marginRight: 10 }}>Type: <strong style={{ color: C.txt2 }}>{candidate.matchType}</strong></span>}
          {candidate.confidence != null && <span style={{ marginRight: 10 }}>Confidence: <strong style={{ color: C.txt2 }}>{Math.round(Number(candidate.confidence) * 100)}%</strong></span>}
          {candidate.ruleVersion && <span>Rules: <code style={{ color: C.dim }}>{candidate.ruleVersion}</code></span>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
        <RecordColumn title="Incoming (new)" record={candidate.incoming} accent={C.acc} />
        <RecordColumn title="Existing (in project)" record={candidate.existing} accent={C.purp} />
      </div>

      <SignalBreakdown candidate={candidate} />

      <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: themeAlpha(C.acc, '08'), border: `1px solid ${themeAlpha(C.acc, '20')}`, fontSize: 11.5, color: C.txt2, lineHeight: 1.6 }}>
        <strong style={{ color: C.txt }}>If merged:</strong> the existing record stays canonical; the incoming record is grouped under it as a duplicate (it stays visible in screening, marked not-primary). Merging never deletes data.
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }} role="group" aria-label="Resolve this duplicate">
        <Btn variant="primary" busy={acting === 'merge'} disabled={disabled} onClick={() => act('merge')}>Confirm merge</Btn>
        <Btn variant="ghost" busy={acting === 'keep_separate'} disabled={disabled} onClick={() => act('keep_separate')}>Keep separate</Btn>
        <Btn variant="ghost" busy={acting === 'defer'} disabled={disabled} onClick={() => act('defer')}>Defer</Btn>
      </div>
    </div>
  );
}

export default function DuplicateReview({ candidates, total, loading, error, onResolve, onReload, resolving }) {
  if (loading) {
    return (
      <Card title="Duplicate review" icon="copy" desc="Ambiguous matches the engine could not auto-resolve.">
        {[0, 1].map((i) => <div key={i} style={{ marginBottom: 14 }}><Skeleton height={120} radius={12} /></div>)}
      </Card>
    );
  }
  return (
    <Card
      title="Duplicate review"
      icon="copy"
      desc="Ambiguous matches the engine landed as distinct records but flagged for a human. Resolve each before moving to screening."
      right={onReload && <Btn variant="ghost" onClick={onReload} style={{ fontSize: 11 }}>Refresh</Btn>}
    >
      {error && <div style={{ marginBottom: 12 }}><Note tone="error" role="alert">Could not load duplicates: {error}</Note></div>}
      {!error && (!candidates || candidates.length === 0) ? (
        <EmptyState icon="check" title="No duplicates need review">
          The engine found no ambiguous duplicate pairs for this run, or every pair has already been resolved.
        </EmptyState>
      ) : (
        <>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
            {total != null ? `${total} pending pair${total === 1 ? '' : 's'}` : `${candidates.length} pending`} awaiting review.
          </div>
          {candidates.map((c) => (
            <CandidateCard key={c.id} candidate={c} onResolve={onResolve} busy={resolving} />
          ))}
        </>
      )}
    </Card>
  );
}
