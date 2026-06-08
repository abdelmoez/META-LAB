/**
 * SiftDuplicates.jsx — META·SIFT Beta duplicate management
 * Route: /sift-beta/projects/:pid/duplicates
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

export default function SiftDuplicates() {
  const { pid }  = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [groups,       setGroups]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [detecting,    setDetecting]    = useState(false);
  const [detectResult, setDetectResult] = useState(null);
  const [error,        setError]        = useState(null);
  const [resolving,    setResolving]    = useState({});  // { [gid]: bool }
  const [primarySel,   setPrimarySel]   = useState({});  // { [gid]: recordId }
  const [resolveMsg,   setResolveMsg]   = useState({});  // { [gid]: string }
  const [showResolved, setShowResolved] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await screeningApi.listDuplicates(pid);
      setGroups(data.groups || []);
      // Init primary selection to current primary
      const init = {};
      (data.groups || []).forEach(g => {
        const primary = g.records?.find(r => r.isPrimary);
        if (primary) init[g.id] = primary.id;
        else if (g.records?.length > 0) init[g.id] = g.records[0].id;
      });
      setPrimarySel(init);
    } catch (e) {
      setError(e.message || 'Failed to load duplicates');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  async function handleDetect() {
    setDetecting(true);
    setError(null);
    setDetectResult(null);
    try {
      const data = await screeningApi.detectDuplicates(pid);
      setDetectResult(data);
      await loadGroups();
    } catch (e) {
      setError(e.message || 'Detection failed');
    } finally {
      setDetecting(false);
    }
  }

  async function handleResolve(gid) {
    const primaryId = primarySel[gid];
    if (!primaryId) return;
    setResolving(prev => ({ ...prev, [gid]: true }));
    setResolveMsg(prev => ({ ...prev, [gid]: '' }));
    try {
      await screeningApi.resolveDuplicateGroup(pid, gid, { primaryId });
      setResolveMsg(prev => ({ ...prev, [gid]: 'resolved' }));
      // Refresh groups
      await loadGroups();
    } catch (e) {
      setResolveMsg(prev => ({ ...prev, [gid]: 'error: ' + (e.message || 'failed') }));
    } finally {
      setResolving(prev => ({ ...prev, [gid]: false }));
    }
  }

  const unresolvedGroups = groups.filter(g => !g.resolved);
  const resolvedGroups   = groups.filter(g => g.resolved);

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
        <span style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>Duplicate Management</span>
        <BetaBadge />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 11, fontFamily: MONO, color: C.muted }}>
            {unresolvedGroups.length} unresolved · {resolvedGroups.length} resolved
          </div>
          <button
            onClick={handleDetect}
            disabled={detecting}
            style={{
              background: detecting ? C.brd : C.acc2, border: 'none',
              color: detecting ? C.muted : '#fff',
              fontSize: 12, fontWeight: 600, fontFamily: FONT,
              padding: '7px 18px', borderRadius: 7, cursor: detecting ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!detecting) e.currentTarget.style.background = C.acc; }}
            onMouseLeave={e => { if (!detecting) e.currentTarget.style.background = C.acc2; }}
          >
            {detecting && <Spinner size={14} />}
            {detecting ? 'Detecting…' : '⟳ Detect Duplicates'}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '28px 24px' }}>

        {/* Detection result banner */}
        {detectResult && (
          <div style={{
            background: '#14532d', border: '1px solid #4ade8060',
            borderRadius: 8, padding: '12px 18px', marginBottom: 20,
            fontSize: 13, color: C.grn,
          }}>
            Detection complete: {detectResult.found} duplicate groups found
            {detectResult.created > 0 && `, ${detectResult.created} new groups created`}.
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            background: '#450a0a', border: '1px solid #f8717150',
            borderRadius: 8, padding: '12px 16px', color: C.red, fontSize: 13, marginBottom: 20,
          }}>
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: C.txt2, padding: '40px 0' }}>
            <Spinner />
            <span style={{ fontSize: 13 }}>Loading duplicate groups…</span>
          </div>
        )}

        {/* Empty */}
        {!loading && groups.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '56px 24px',
            border: `1px dashed ${C.brd}`, borderRadius: 12,
          }}>
            <div style={{ fontSize: 32, marginBottom: 14 }}>🔍</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.txt, marginBottom: 8 }}>
              No duplicate groups detected
            </div>
            <div style={{ fontSize: 13, color: C.txt2, marginBottom: 22, maxWidth: 380, margin: '0 auto 22px' }}>
              Run duplicate detection to find records that may refer to the same publication.
            </div>
            <button
              onClick={handleDetect}
              disabled={detecting}
              style={{
                background: C.acc2, border: 'none', color: '#fff',
                fontSize: 13, fontWeight: 600, fontFamily: FONT,
                padding: '9px 22px', borderRadius: 7, cursor: 'pointer',
              }}
            >
              {detecting ? 'Detecting…' : 'Run Duplicate Detection'}
            </button>
          </div>
        )}

        {/* Unresolved groups */}
        {!loading && unresolvedGroups.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.08em',
              marginBottom: 14, fontFamily: MONO, textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              Unresolved Groups
              <span style={{
                background: C.ylw + '20', border: `1px solid ${C.ylw}40`,
                color: C.ylw, fontSize: 10, borderRadius: 10, padding: '1px 8px',
              }}>{unresolvedGroups.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {unresolvedGroups.map(group => (
                <DuplicateGroup
                  key={group.id}
                  group={group}
                  primaryId={primarySel[group.id]}
                  onSelectPrimary={id => setPrimarySel(prev => ({ ...prev, [group.id]: id }))}
                  onResolve={() => handleResolve(group.id)}
                  resolving={resolving[group.id]}
                  resolveMsg={resolveMsg[group.id]}
                />
              ))}
            </div>
          </div>
        )}

        {/* Toggle resolved */}
        {!loading && resolvedGroups.length > 0 && (
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
              Resolved Groups ({resolvedGroups.length})
            </button>

            {showResolved && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {resolvedGroups.map(group => (
                  <DuplicateGroup
                    key={group.id}
                    group={group}
                    primaryId={primarySel[group.id]}
                    onSelectPrimary={id => setPrimarySel(prev => ({ ...prev, [group.id]: id }))}
                    onResolve={() => handleResolve(group.id)}
                    resolving={resolving[group.id]}
                    resolveMsg={resolveMsg[group.id]}
                    resolved
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

// ── DuplicateGroup ─────────────────────────────────────────────────────────

function DuplicateGroup({ group, primaryId, onSelectPrimary, onResolve, resolving, resolveMsg, resolved }) {
  const records = group.records || [];

  return (
    <div style={{
      background: C.card, border: `1px solid ${resolved ? C.brd : C.brd2}`,
      borderRadius: 10, padding: '16px 18px',
      opacity: resolved ? 0.7 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted }}>Group #{group.id?.slice(-6) || '?'}</span>
          {group.similarity !== undefined && (
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.teal }}>
              {Math.round(group.similarity * 100)}% similar
            </span>
          )}
          {resolved && (
            <span style={{
              fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.1em',
              background: C.grn + '20', border: `1px solid ${C.grn}40`, color: C.grn,
              borderRadius: 4, padding: '1px 6px',
            }}>RESOLVED</span>
          )}
        </div>
        {!resolved && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {resolveMsg && (
              <span style={{
                fontSize: 11, fontFamily: MONO,
                color: resolveMsg === 'resolved' ? C.grn : C.red,
              }}>{resolveMsg}</span>
            )}
            <button
              onClick={onResolve}
              disabled={resolving || !primaryId}
              style={{
                background: resolving || !primaryId ? C.brd : '#14532d',
                border: `1px solid ${resolving || !primaryId ? C.brd2 : '#4ade8060'}`,
                color: resolving || !primaryId ? C.muted : C.grn,
                fontSize: 12, fontWeight: 600, fontFamily: FONT,
                padding: '6px 16px', borderRadius: 6, cursor: resolving || !primaryId ? 'not-allowed' : 'pointer',
              }}
            >
              {resolving ? 'Resolving…' : 'Keep Selected →'}
            </button>
          </div>
        )}
      </div>

      {/* Records side by side */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(records.length, 3)}, 1fr)`,
        gap: 10,
      }}>
        {records.map(record => {
          const isSelected = record.id === primaryId;
          return (
            <div
              key={record.id}
              onClick={() => !resolved && onSelectPrimary(record.id)}
              style={{
                background: isSelected ? '#0e2a1a' : C.surf,
                border: `1px solid ${isSelected ? '#4ade8060' : C.brd}`,
                borderRadius: 8, padding: '12px 14px',
                cursor: resolved ? 'default' : 'pointer',
                transition: 'all 0.15s',
                position: 'relative',
              }}
            >
              {isSelected && (
                <div style={{
                  position: 'absolute', top: 8, right: 10,
                  fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.08em',
                  color: C.grn, background: '#14532d', border: '1px solid #4ade8040',
                  borderRadius: 4, padding: '1px 6px',
                }}>PRIMARY</div>
              )}
              {record.isPrimary && !isSelected && (
                <div style={{
                  position: 'absolute', top: 8, right: 10,
                  fontSize: 9, fontFamily: MONO, color: C.muted,
                }}>was primary</div>
              )}

              <div style={{
                fontSize: 12, fontWeight: isSelected ? 600 : 400,
                color: isSelected ? C.txt : C.txt2,
                lineHeight: 1.4, marginBottom: 8,
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {record.title || <span style={{ fontStyle: 'italic', color: C.muted }}>No title</span>}
              </div>

              <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.4 }}>
                {record.authors && <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.authors}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 3, fontFamily: MONO }}>
                  {record.year && <span>{record.year}</span>}
                  {record.sourceDb && <span style={{ color: C.brd2 }}>· {record.sourceDb}</span>}
                </div>
                {record.doi && <div style={{ color: C.acc, fontSize: 9, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>DOI: {record.doi}</div>}
              </div>

              {!resolved && (
                <div style={{ marginTop: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name={`primary-${group.id}`}
                      checked={isSelected}
                      onChange={() => onSelectPrimary(record.id)}
                      style={{ accentColor: C.grn }}
                    />
                    <span style={{ fontSize: 11, color: C.muted }}>Keep this record</span>
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
