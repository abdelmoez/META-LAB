/**
 * SiftConflicts.jsx — META·SIFT Beta conflict resolution
 * Route: /sift-beta/projects/:pid/conflicts
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { screeningApi } from '../api-client/screeningApi.js';

const C = {
  bg:    '#080c15', surf:  '#0c1322', card:  '#101929',
  brd:   '#1a2b42', brd2:  '#213452',
  acc:   '#5b9cf6', acc2:  '#3b7ef4',
  gold:  '#dba96a', teal:  '#2dd4bf',
  txt:   '#ecf0fb', txt2:  '#8b9ec6',
  muted: '#4a5e82',
  grn:   '#4ade80', red:   '#f87171', ylw:   '#fbbf24',
};
const FONT = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', monospace";

const DECISION_COLORS = {
  include:   { bg: '#14532d', border: '#4ade80', txt: '#4ade80' },
  exclude:   { bg: '#450a0a', border: '#f87171', txt: '#f87171' },
  maybe:     { bg: '#451a03', border: '#fbbf24', txt: '#fbbf24' },
  undecided: { bg: '#1a2235', border: '#1a2b42', txt: '#4a5e82' },
};

function BetaBadge() {
  return (
    <span style={{
      fontSize: 9, fontFamily: MONO, fontWeight: 700,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      background: '#2dd4bf18', border: '1px solid #2dd4bf50',
      color: '#2dd4bf', borderRadius: 4, padding: '2px 7px',
    }}>BETA</span>
  );
}

function Spinner({ size = 18 }) {
  return (
    <div style={{
      display: 'inline-block', width: size, height: size,
      border: `2px solid ${C.brd2}`, borderTopColor: C.acc,
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
    }} />
  );
}

function DecisionChip({ decision }) {
  if (!decision) return <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO }}>—</span>;
  const dc = DECISION_COLORS[decision] || DECISION_COLORS.undecided;
  const labels = { include: '✓ Include', exclude: '✗ Exclude', maybe: '? Maybe', undecided: '· Undecided' };
  return (
    <span style={{
      fontSize: 10, fontFamily: MONO, fontWeight: 700,
      color: dc.txt, background: dc.bg + 'dd',
      border: `1px solid ${dc.border}50`,
      borderRadius: 4, padding: '2px 8px',
    }}>{labels[decision] || decision}</span>
  );
}

export default function SiftConflicts() {
  const { pid }  = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [conflicts,    setConflicts]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [resolving,    setResolving]    = useState({});   // { [cid]: bool }
  const [resolveForm,  setResolveForm]  = useState({});   // { [cid]: { finalDecision, notes } }
  const [resolveMsg,   setResolveMsg]   = useState({});   // { [cid]: string }
  const [showResolved, setShowResolved] = useState(false);

  const loadConflicts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await screeningApi.listConflicts(pid);
      setConflicts(data.conflicts || []);
      // Init resolve forms
      const init = {};
      (data.conflicts || []).forEach(c => {
        init[c.id] = { finalDecision: c.finalDecision || '', notes: c.notes || '' };
      });
      setResolveForm(init);
    } catch (e) {
      setError(e.message || 'Failed to load conflicts');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { loadConflicts(); }, [loadConflicts]);

  function updateForm(cid, field, value) {
    setResolveForm(prev => ({
      ...prev,
      [cid]: { ...(prev[cid] || {}), [field]: value },
    }));
  }

  async function handleResolve(cid) {
    const form = resolveForm[cid] || {};
    if (!form.finalDecision) return;
    setResolving(prev => ({ ...prev, [cid]: true }));
    setResolveMsg(prev => ({ ...prev, [cid]: '' }));
    try {
      await screeningApi.resolveConflict(pid, cid, {
        finalDecision: form.finalDecision,
        notes: form.notes || undefined,
      });
      setResolveMsg(prev => ({ ...prev, [cid]: 'resolved' }));
      await loadConflicts();
    } catch (e) {
      setResolveMsg(prev => ({ ...prev, [cid]: 'error: ' + (e.message || 'failed') }));
    } finally {
      setResolving(prev => ({ ...prev, [cid]: false }));
    }
  }

  const unresolved = conflicts.filter(c => !c.resolved);
  const resolved   = conflicts.filter(c => c.resolved);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
      `}</style>

      {/* Header */}
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
        <span style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>Conflict Resolution</span>
        <BetaBadge />
        <div style={{ marginLeft: 'auto', fontSize: 11, fontFamily: MONO, color: C.muted }}>
          {unresolved.length} unresolved · {resolved.length} resolved
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px' }}>

        {/* Error */}
        {error && (
          <div style={{
            background: '#450a0a', border: '1px solid #f8717150',
            borderRadius: 8, padding: '12px 16px', color: C.red, fontSize: 13, marginBottom: 20,
          }}>
            {error}
            <button
              onClick={loadConflicts}
              style={{ marginLeft: 12, background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 12 }}
            >Retry</button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: C.txt2, padding: '40px 0' }}>
            <Spinner />
            <span style={{ fontSize: 13 }}>Loading conflicts…</span>
          </div>
        )}

        {/* Empty */}
        {!loading && conflicts.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '56px 24px',
            border: `1px dashed ${C.brd}`, borderRadius: 12,
          }}>
            <div style={{ fontSize: 32, marginBottom: 14 }}>✓</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.txt, marginBottom: 8 }}>
              No conflicts found
            </div>
            <div style={{ fontSize: 13, color: C.txt2, maxWidth: 360, margin: '0 auto' }}>
              Conflicts occur when multiple reviewers disagree on a record's screening decision.
              They will appear here once detected.
            </div>
          </div>
        )}

        {/* Explanation */}
        {!loading && conflicts.length > 0 && (
          <div style={{
            background: C.card, border: `1px solid ${C.brd}`,
            borderRadius: 8, padding: '12px 16px', marginBottom: 24, fontSize: 12, color: C.txt2, lineHeight: 1.6,
          }}>
            Conflicts occur when two or more reviewers assign different decisions to the same record.
            Select a final decision for each conflict below. Notes are optional.
          </div>
        )}

        {/* Unresolved conflicts */}
        {!loading && unresolved.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.08em',
              marginBottom: 14, fontFamily: MONO, textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              Unresolved Conflicts
              <span style={{
                background: C.gold + '20', border: `1px solid ${C.gold}40`,
                color: C.gold, fontSize: 10, borderRadius: 10, padding: '1px 8px',
              }}>{unresolved.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {unresolved.map(conflict => (
                <ConflictCard
                  key={conflict.id}
                  conflict={conflict}
                  form={resolveForm[conflict.id] || { finalDecision: '', notes: '' }}
                  onFormChange={(field, val) => updateForm(conflict.id, field, val)}
                  onResolve={() => handleResolve(conflict.id)}
                  resolving={resolving[conflict.id]}
                  resolveMsg={resolveMsg[conflict.id]}
                />
              ))}
            </div>
          </div>
        )}

        {/* Resolved toggle */}
        {!loading && resolved.length > 0 && (
          <div>
            <button
              onClick={() => setShowResolved(v => !v)}
              style={{
                background: 'none', border: 'none', color: C.txt2,
                fontSize: 12, fontFamily: FONT, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12,
              }}
            >
              <span style={{ transform: showResolved ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▶</span>
              Resolved Conflicts ({resolved.length})
            </button>
            {showResolved && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {resolved.map(conflict => (
                  <ConflictCard
                    key={conflict.id}
                    conflict={conflict}
                    form={resolveForm[conflict.id] || { finalDecision: conflict.finalDecision || '', notes: conflict.notes || '' }}
                    onFormChange={(field, val) => updateForm(conflict.id, field, val)}
                    onResolve={() => handleResolve(conflict.id)}
                    resolving={resolving[conflict.id]}
                    resolveMsg={resolveMsg[conflict.id]}
                    isResolved
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ConflictCard ───────────────────────────────────────────────────────────

function ConflictCard({ conflict, form, onFormChange, onResolve, resolving, resolveMsg, isResolved }) {
  const record    = conflict.record || {};
  const decisions = conflict.decisions || [];

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${isResolved ? C.brd : C.brd2}`,
      borderRadius: 10, padding: '18px 20px',
      opacity: isResolved ? 0.75 : 1,
    }}>
      {/* Record info */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.txt, lineHeight: 1.4, flex: 1 }}>
            {record.title || <span style={{ fontStyle: 'italic', color: C.muted }}>No title</span>}
          </div>
          {isResolved && (
            <span style={{
              fontSize: 9, fontFamily: MONO, fontWeight: 700, flexShrink: 0,
              background: C.grn + '20', border: `1px solid ${C.grn}40`, color: C.grn,
              borderRadius: 4, padding: '2px 8px', letterSpacing: '0.1em',
            }}>RESOLVED</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: C.muted }}>
          {[record.authors?.split(',')[0] + (record.authors?.includes(',') ? ' et al.' : ''), record.year, record.journal].filter(Boolean).join(' · ')}
        </div>
        {record.doi && (
          <a href={`https://doi.org/${record.doi}`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 10, color: C.acc, fontFamily: MONO, textDecoration: 'none' }}>
            DOI: {record.doi}
          </a>
        )}
      </div>

      {/* Reviewer decisions */}
      {decisions.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', marginBottom: 8, fontFamily: MONO, textTransform: 'uppercase' }}>
            Reviewer Decisions
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {decisions.map((d, i) => (
              <div key={i} style={{
                background: C.surf, border: `1px solid ${C.brd}`,
                borderRadius: 6, padding: '8px 12px', fontSize: 11,
              }}>
                <div style={{ color: C.muted, marginBottom: 4, fontSize: 10 }}>
                  {d.reviewer?.name || d.reviewer?.email || `Reviewer ${i + 1}`}
                </div>
                <DecisionChip decision={d.decision} />
                {d.exclusionReason && (
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
                    Reason: {d.exclusionReason}
                  </div>
                )}
                {d.notes && (
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2, fontStyle: 'italic' }}>
                    "{d.notes}"
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Final decision form */}
      {isResolved ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>Final decision:</span>
          <DecisionChip decision={conflict.finalDecision} />
          {conflict.notes && (
            <span style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>· "{conflict.notes}"</span>
          )}
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', marginBottom: 10, fontFamily: MONO, textTransform: 'uppercase' }}>
            Final Decision
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {[
              { val: 'include', label: '✓ Include', dc: DECISION_COLORS.include },
              { val: 'exclude', label: '✗ Exclude', dc: DECISION_COLORS.exclude },
              { val: 'maybe',   label: '? Maybe',   dc: DECISION_COLORS.maybe   },
            ].map(opt => {
              const active = form.finalDecision === opt.val;
              return (
                <button
                  key={opt.val}
                  onClick={() => onFormChange('finalDecision', active ? '' : opt.val)}
                  style={{
                    background: active ? opt.dc.bg : 'transparent',
                    border: `1px solid ${active ? opt.dc.border : C.brd}`,
                    color: active ? opt.dc.txt : C.txt2,
                    fontSize: 12, fontWeight: active ? 600 : 400, fontFamily: FONT,
                    padding: '7px 16px', borderRadius: 6, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    if (!active) {
                      e.currentTarget.style.borderColor = opt.dc.border + '80';
                      e.currentTarget.style.color = opt.dc.txt;
                    }
                  }}
                  onMouseLeave={e => {
                    if (!active) {
                      e.currentTarget.style.borderColor = C.brd;
                      e.currentTarget.style.color = C.txt2;
                    }
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <textarea
            value={form.notes || ''}
            onChange={e => onFormChange('notes', e.target.value)}
            placeholder="Optional resolution notes…"
            rows={2}
            style={{
              width: '100%', background: C.surf, border: `1px solid ${C.brd2}`,
              borderRadius: 6, padding: '7px 10px', color: C.txt, fontSize: 12,
              fontFamily: FONT, outline: 'none', resize: 'vertical', marginBottom: 12,
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={onResolve}
              disabled={resolving || !form.finalDecision}
              style={{
                background: resolving || !form.finalDecision ? C.brd : C.acc2,
                border: 'none',
                color: resolving || !form.finalDecision ? C.muted : '#fff',
                fontSize: 12, fontWeight: 600, fontFamily: FONT,
                padding: '7px 20px', borderRadius: 6,
                cursor: resolving || !form.finalDecision ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (!resolving && form.finalDecision) e.currentTarget.style.background = C.acc; }}
              onMouseLeave={e => { if (!resolving && form.finalDecision) e.currentTarget.style.background = C.acc2; }}
            >
              {resolving ? 'Resolving…' : 'Resolve Conflict'}
            </button>
            {resolveMsg && (
              <span style={{
                fontSize: 11, fontFamily: MONO,
                color: resolveMsg === 'resolved' ? C.grn : C.red,
              }}>{resolveMsg}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
