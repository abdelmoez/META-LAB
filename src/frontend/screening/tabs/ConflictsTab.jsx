/**
 * ConflictsTab.jsx — resolve reviewer disagreements (records where reviewers chose differently).
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { Loading, ErrorBanner, Button, Badge, DecisionChip, Card, EmptyState } from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import { useRealtime } from '../../hooks/useRealtime.js';

function parseDecisions(json) {
  try {
    const m = JSON.parse(json || '{}');
    return Object.entries(m).map(([reviewerId, decision]) => ({ reviewerId, decision }));
  } catch { return []; }
}

export default function ConflictsTab({ pid, project, access, refreshProject }) {
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [showResolved, setShowResolved] = useState(false);
  const [forms, setForms]       = useState({});  // cid -> { finalDecision, notes }
  const [busy, setBusy]         = useState(null);
  const [flash, setFlash]       = useState('');

  const canResolve = access.isLeader || access.canResolveConflicts;

  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(''), 4200); return () => clearTimeout(t); }, [flash]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await screeningApi.listConflicts(pid);
      setConflicts(data.conflicts || []);
    } catch (e) { setError(e.message || 'Failed to load conflicts'); }
    finally { setLoading(false); }
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  // prompt50 WS3 — refetch when ANY reviewer decision changes or a conflict is
  // resolved elsewhere, so a conflict appears the moment it is created and
  // disappears the moment it is resolved, without a manual reload. Server-side
  // syncConflicts is the single source of truth; this only re-reads it.
  useRealtime({
    'decision.saved':    (ev) => { if (!ev || ev.projectId === pid || ev.projectId === undefined) load(); },
    'conflict.changed':  (ev) => { if (!ev || ev.projectId === pid || ev.projectId === undefined) load(); },
  });

  async function resolve(cid) {
    const f = forms[cid] || {};
    if (!f.finalDecision) return;
    setBusy(cid);
    try {
      const resp = await screeningApi.resolveConflict(pid, cid, { finalDecision: f.finalDecision, notes: f.notes || '' });
      setFlash(resp?.promoted
        ? 'Resolved as include — moved to Final Review.'
        : `Conflict resolved as ${f.finalDecision}.`);
      await load();
      // prompt23 Task 4 — the resolver is excluded from their own realtime event, so
      // refresh the project here to update the workflow stepper, overview counts, and
      // (on tab switch) the Title & Abstract list for this user immediately.
      refreshProject?.();
    } catch (e) { setError(e.message || 'Failed to resolve'); }
    finally { setBusy(null); }
  }

  if (loading) return <Loading label="Loading conflicts…" />;

  const unresolved = conflicts.filter(c => !c.resolvedAt);
  const resolved   = conflicts.filter(c => c.resolvedAt);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Conflict Resolution</h2>
        <span style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>{unresolved.length} unresolved · {resolved.length} resolved</span>
      </div>
      {error && <ErrorBanner onRetry={load}>{error}</ErrorBanner>}
      {flash && (
        <div style={{ background: C.grnBg, border: `1px solid ${alpha(C.grn, '55')}`, borderLeft: `3px solid ${C.grn}`, borderRadius: 8, padding: '10px 14px', color: C.grn, fontSize: 12.5, marginBottom: 14 }}>
          {flash}
        </div>
      )}

      <p style={{ fontSize: 13, color: C.txt2, marginBottom: 18, lineHeight: 1.6 }}>
        A conflict appears when two or more reviewers record different decisions on the same article.
        {canResolve ? ' As leader you can set the final decision.' : ' Only the project leader can resolve conflicts.'}
      </p>

      {unresolved.length === 0 && resolved.length === 0 && (
        <EmptyState icon="✓" title="No conflicts found">Reviewer decisions are in agreement, or screening hasn't produced disagreements yet.</EmptyState>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {unresolved.map(c => {
          const decs = parseDecisions(c.reviewerDecisions);
          const f = forms[c.id] || {};
          return (
            <Card key={c.id}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.txt, marginBottom: 4, minWidth: 0, overflowWrap: 'anywhere' }}>{c.record?.title || 'Untitled record'}</div>
              <div style={{ fontSize: 12, color: C.txt2, marginBottom: 12, minWidth: 0, overflowWrap: 'anywhere' }}>
                {!project.blindMode && c.record?.authors} {c.record?.year && `· ${c.record.year}`}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                {decs.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: C.muted }}>{project.blindMode ? `Reviewer ${i + 1}` : 'Reviewer'}</span>
                    <DecisionChip decision={d.decision} />
                  </div>
                ))}
              </div>
              {canResolve ? (
                <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Final decision</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    {['include', 'exclude', 'maybe'].map(d => (
                      <button key={d} onClick={() => setForms(s => ({ ...s, [c.id]: { ...f, finalDecision: d } }))}
                        style={{ flex: 1, cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600, padding: '7px 0', borderRadius: 6,
                          textTransform: 'capitalize', background: f.finalDecision === d ? C.acc2 : C.card, color: f.finalDecision === d ? C.accText : C.txt2,
                          border: `1px solid ${f.finalDecision === d ? C.acc2 : C.brd2}` }}>{d}</button>
                    ))}
                  </div>
                  <input value={f.notes || ''} onChange={e => setForms(s => ({ ...s, [c.id]: { ...f, notes: e.target.value } }))}
                    placeholder="Resolution note (optional)"
                    style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd2}`, borderRadius: 6, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: FONT, outline: 'none', marginBottom: 10 }} />
                  <Button onClick={() => resolve(c.id)} disabled={!f.finalDecision || busy === c.id}>
                    {busy === c.id ? 'Resolving…' : 'Resolve Conflict'}
                  </Button>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>Awaiting leader resolution.</div>
              )}
            </Card>
          );
        })}
      </div>

      {resolved.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button onClick={() => setShowResolved(v => !v)}
            style={{ background: 'none', border: 'none', color: C.txt2, cursor: 'pointer', fontSize: 13, fontFamily: FONT, padding: 0, marginBottom: 12 }}>
            {showResolved ? '▾' : '▸'} Resolved ({resolved.length})
          </button>
          {showResolved && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {resolved.map(c => (
                <Card key={c.id} style={{ opacity: 0.75 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ fontSize: 13, color: C.txt, minWidth: 0, overflowWrap: 'anywhere' }}>{c.record?.title || 'Untitled'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <DecisionChip decision={c.finalDecision} />
                      <Badge color={c.resolvedBy === 'auto' ? C.teal : C.grn}>{c.resolvedBy === 'auto' ? 'AUTO' : 'RESOLVED'}</Badge>
                    </div>
                  </div>
                  {c.notes && <div style={{ fontSize: 12, color: C.txt2, marginTop: 6, minWidth: 0, overflowWrap: 'anywhere' }}>{c.notes}</div>}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
