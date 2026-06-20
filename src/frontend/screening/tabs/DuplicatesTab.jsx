/**
 * DuplicatesTab.jsx — META·SIFT duplicate management (vertical layout).
 *
 * Replaces the old horizontal side-by-side duplicate view with a VERTICAL
 * one: each group's candidate records are stacked one per row, making
 * field-by-field comparison easy to scan. Every group carries a visible,
 * explainable similarity score (e.g. "92% similar" + "Exact DOI match").
 *
 * Props:
 *   pid            — screening project id
 *   project        — current project object (from the shell)
 *   access         — { isLeader, myRole, canScreen, ... }
 *   refreshProject — () => Promise, re-fetches the shell's project after a mutation
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { Loading, ErrorBanner, Button, Badge, Card, EmptyState } from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Clamp a possibly-fractional/odd similarity into an int 0-100. */
function pctOf(similarity) {
  let v = Number(similarity);
  if (!Number.isFinite(v)) return 0;
  if (v > 0 && v <= 1) v = v * 100; // tolerate a 0-1 fraction defensively
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Score → palette. ≥90 red-ish, 70-89 gold, <70 muted. */
function scoreColor(pct) {
  if (pct >= 90) return C.red;
  if (pct >= 70) return C.gold;
  return C.muted;
}

const shortId = (id) => (id == null ? '?' : String(id).slice(-6));

// Small uppercase MONO field label, used to align fields across stacked records.
function FieldLabel({ children }) {
  return (
    <span style={{
      fontSize: 9, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em',
      textTransform: 'uppercase', color: C.muted, flexShrink: 0,
    }}>
      {children}
    </span>
  );
}

// ── Component ────────────────────────────────────────────────────────────────
export default function DuplicatesTab({ pid, project, access = {}, refreshProject }) {
  const [groups, setGroups]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const [detecting, setDetecting]       = useState(false);
  const [detectResult, setDetectResult] = useState(null);

  const [primarySel, setPrimarySel] = useState({}); // { [gid]: recordId }
  const [resolving, setResolving]   = useState({}); // { [gid]: bool }
  const [resolveErr, setResolveErr] = useState({}); // { [gid]: string }
  const [showResolved, setShowResolved] = useState(false);

  const isLeader = !!access.isLeader;

  // Seed the primary radio for a set of groups: prefer isPrimary, else first.
  const seedPrimaries = useCallback((gs) => {
    const init = {};
    (gs || []).forEach(g => {
      const recs = g.records || [];
      const primary = recs.find(r => r.isPrimary);
      if (primary) init[g.id] = primary.id;
      else if (recs.length) init[g.id] = recs[0].id;
    });
    setPrimarySel(init);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await screeningApi.listDuplicates(pid);
      const gs = Array.isArray(data?.groups) ? data.groups : [];
      setGroups(gs);
      seedPrimaries(gs);
    } catch (e) {
      setError(e?.message || 'Failed to load duplicate groups.');
    } finally {
      setLoading(false);
    }
  }, [pid, seedPrimaries]);

  useEffect(() => { load(); }, [load]);

  const handleDetect = useCallback(async () => {
    if (detecting) return;
    setDetecting(true);
    setError(null);
    setDetectResult(null);
    try {
      const res = await screeningApi.detectDuplicates(pid);
      setDetectResult({
        found:   Number(res?.found ?? res?.groups ?? 0) || 0,
        created: Number(res?.created ?? res?.new ?? 0) || 0,
      });
      await load();
      if (refreshProject) await refreshProject();
    } catch (e) {
      setError(e?.message || 'Duplicate detection failed.');
    } finally {
      setDetecting(false);
    }
  }, [pid, detecting, load, refreshProject]);

  const handleResolve = useCallback(async (gid) => {
    const primaryId = primarySel[gid];
    if (!primaryId || resolving[gid]) return;
    setResolving(prev => ({ ...prev, [gid]: true }));
    setResolveErr(prev => ({ ...prev, [gid]: '' }));
    try {
      await screeningApi.resolveDuplicateGroup(pid, gid, { primaryId });
      await load();
      if (refreshProject) await refreshProject();
    } catch (e) {
      setResolveErr(prev => ({ ...prev, [gid]: e?.message || 'Failed to resolve this group.' }));
    } finally {
      setResolving(prev => ({ ...prev, [gid]: false }));
    }
  }, [pid, primarySel, resolving, load, refreshProject]);

  // prompt23 Task 10 — "Not duplicates": the suggestion is a false positive; keep
  // every record active and resolve the group without merging.
  const handleKeepAll = useCallback(async (gid) => {
    if (resolving[gid]) return;
    setResolving(prev => ({ ...prev, [gid]: true }));
    setResolveErr(prev => ({ ...prev, [gid]: '' }));
    try {
      await screeningApi.resolveDuplicateGroup(pid, gid, { keepAll: true });
      await load();
      if (refreshProject) await refreshProject();
    } catch (e) {
      setResolveErr(prev => ({ ...prev, [gid]: e?.message || 'Failed to update this group.' }));
    } finally {
      setResolving(prev => ({ ...prev, [gid]: false }));
    }
  }, [pid, resolving, load, refreshProject]);

  const unresolved = groups.filter(g => !g.resolved);
  const resolved   = groups.filter(g => g.resolved);

  // ── Loading / error (first paint) ──
  if (loading && groups.length === 0) {
    return (
      <div style={{ animation: 'sift-fade 0.3s ease' }}>
        <Loading label="Loading duplicate groups…" />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, color: C.txt, animation: 'sift-fade 0.3s ease', maxWidth: 1400 }}>

      {/* ───────── Header ───────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap', marginBottom: 18,
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: C.txt, margin: '0 0 6px', letterSpacing: '-0.01em' }}>
            Duplicate Management
          </h1>
          <div style={{ fontSize: 12.5, color: C.txt2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span><strong style={{ fontFamily: MONO, color: unresolved.length > 0 ? C.ylw : C.txt2 }}>{unresolved.length}</strong> unresolved</span>
            <span style={{ color: C.brd2 }}>·</span>
            <span><strong style={{ fontFamily: MONO, color: C.grn }}>{resolved.length}</strong> resolved</span>
          </div>
        </div>

        {isLeader && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
            <Button variant="primary" onClick={handleDetect} disabled={detecting}>
              {detecting ? 'Detecting…' : '⟳ Detect Duplicates'}
            </Button>
            {detectResult && (
              <div style={{ fontSize: 11.5, fontFamily: MONO, color: C.grn }}>
                {detectResult.found} group{detectResult.found === 1 ? '' : 's'} / {detectResult.created} new
              </div>
            )}
          </div>
        )}
      </div>

      {/* ───────── Error ───────── */}
      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner onRetry={load}>{error}</ErrorBanner>
        </div>
      )}

      {/* ───────── Empty ───────── */}
      {groups.length === 0 ? (
        <EmptyState
          icon="🧬"
          title="No duplicate groups"
          action={isLeader ? (
            <Button variant="primary" onClick={handleDetect} disabled={detecting}>
              {detecting ? 'Detecting…' : '⟳ Detect Duplicates'}
            </Button>
          ) : null}
        >
          Run detection to find duplicates by DOI, PMID, and fuzzy title match.
        </EmptyState>
      ) : (
        <>
          {/* ───────── Unresolved ───────── */}
          {unresolved.length > 0 && (
            <section style={{ marginBottom: 28 }}>
              <SectionHeader label="Unresolved Groups" count={unresolved.length} countColor={C.ylw} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {unresolved.map(group => (
                  <DuplicateGroup
                    key={group.id}
                    group={group}
                    isLeader={isLeader}
                    selectedId={primarySel[group.id]}
                    onSelect={(rid) => setPrimarySel(prev => ({ ...prev, [group.id]: rid }))}
                    onResolve={() => handleResolve(group.id)}
                    onKeepAll={() => handleKeepAll(group.id)}
                    resolving={!!resolving[group.id]}
                    resolveError={resolveErr[group.id]}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ───────── Resolved (collapsible) ───────── */}
          {resolved.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowResolved(v => !v)}
                style={{
                  background: 'none', border: 'none', color: C.txt2, cursor: 'pointer',
                  fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.12em',
                  textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8,
                  marginBottom: 12, padding: 0,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = C.txt; }}
                onMouseLeave={e => { e.currentTarget.style.color = C.txt2; }}
              >
                <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: showResolved ? 'rotate(90deg)' : 'none' }}>▶</span>
                Resolved Groups
                <span style={{
                  background: alpha(C.grn, '20'), border: `1px solid ${alpha(C.grn, '40')}`, color: C.grn,
                  borderRadius: 10, padding: '0 7px', fontSize: 10, letterSpacing: 0,
                }}>{resolved.length}</span>
              </button>

              {showResolved && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'sift-fade 0.25s ease' }}>
                  {resolved.map(group => (
                    <DuplicateGroup
                      key={group.id}
                      group={group}
                      isLeader={isLeader}
                      selectedId={primarySel[group.id]}
                      onSelect={() => {}}
                      onResolve={() => {}}
                      resolving={false}
                      resolveError={null}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ label, count, countColor = C.muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <span style={{
        fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: C.muted,
      }}>
        {label}
      </span>
      <span style={{
        background: alpha(countColor, '20'), border: `1px solid ${alpha(countColor, '40')}`, color: countColor,
        borderRadius: 10, padding: '0 8px', fontSize: 10, fontFamily: MONO, fontWeight: 600,
      }}>
        {count}
      </span>
    </div>
  );
}

// ── DuplicateGroup ───────────────────────────────────────────────────────────
function DuplicateGroup({ group, isLeader, selectedId, onSelect, onResolve, onKeepAll, resolving, resolveError }) {
  const records  = group.records || [];
  const resolved = !!group.resolved;
  const pct      = pctOf(group.similarity);
  const simColor = scoreColor(pct);
  const editable = isLeader && !resolved;

  return (
    <Card style={{ padding: '16px 18px', opacity: resolved ? 0.82 : 1, borderColor: resolved ? C.brd : C.brd2 }}>

      {/* ── Group header: similarity + reason + status ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>Group</span>
            <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted }}>#{shortId(group.id)}</span>

            {/* Prominent similarity badge — colored by score. */}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 12, fontWeight: 700, fontFamily: MONO,
              background: alpha(simColor, '1f'), border: `1px solid ${alpha(simColor, '55')}`, color: simColor,
              borderRadius: 6, padding: '3px 10px', letterSpacing: '0.02em',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: simColor, flexShrink: 0 }} />
              {pct}% similar
            </span>

            {resolved && <Badge color={C.grn}>Resolved</Badge>}
          </div>

          {group.similarityReason && (
            <div style={{ fontSize: 11.5, fontStyle: 'italic', color: C.txt2, marginTop: 7, lineHeight: 1.4 }}>
              {group.similarityReason}
            </div>
          )}
        </div>

        <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted, flexShrink: 0, whiteSpace: 'nowrap' }}>
          {records.length} record{records.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* ── Records stacked VERTICALLY (one per row) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {records.map(record => (
          <RecordRow
            key={record.id}
            record={record}
            groupId={group.id}
            isSelected={record.id === selectedId}
            editable={editable}
            onSelect={() => editable && onSelect(record.id)}
          />
        ))}
      </div>

      {/* ── Resolve action (unresolved + leader only) ── */}
      {editable && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: C.muted }}>
            Keep the selected record and mark the rest as duplicates — or keep them all if these aren&rsquo;t duplicates.
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
            {resolveError && (
              <span style={{ fontSize: 11, color: C.red, fontFamily: MONO }}>{resolveError}</span>
            )}
            <Button
              variant="ghost"
              onClick={onKeepAll}
              disabled={resolving}
              title="These are not duplicates — keep every record as a separate study"
            >
              {resolving ? '…' : 'Not duplicates — keep all'}
            </Button>
            <Button
              variant="primary"
              onClick={onResolve}
              disabled={resolving || !selectedId}
              title={selectedId ? 'Mark the selected record as primary' : 'Select a record to keep first'}
            >
              {resolving ? 'Resolving…' : 'Keep selected & mark others duplicate'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── RecordRow — a single stacked record sub-card ─────────────────────────────
function RecordRow({ record, groupId, isSelected, editable, onSelect }) {
  const title    = record.title || 'Untitled record';
  const metaBits = [record.authors, record.year, record.journal].filter(Boolean);
  const [showFull, setShowFull] = useState(false);
  const abstract = record.abstract || '';
  const isLong = abstract.length > 240; // worth a "Show more" toggle

  return (
    <div
      onClick={onSelect}
      style={{
        position: 'relative',
        background: isSelected ? C.grnBg : C.surf,
        border: `1px solid ${isSelected ? alpha(C.grn, '66') : C.brd}`,
        borderRadius: 8, padding: '12px 14px',
        cursor: editable ? 'pointer' : 'default',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {/* Top line: radio + title + PRIMARY badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {editable ? (
          <input
            type="radio"
            name={`primary-${groupId}`}
            checked={isSelected}
            onChange={onSelect}
            onClick={(e) => e.stopPropagation()}
            aria-label="Keep this as primary"
            style={{ accentColor: C.grn, marginTop: 3, cursor: 'pointer', flexShrink: 0 }}
          />
        ) : (
          <span style={{
            width: 14, height: 14, borderRadius: '50%', flexShrink: 0, marginTop: 3,
            border: `2px solid ${isSelected ? C.grn : C.brd2}`,
            background: isSelected ? C.grn : 'transparent', boxSizing: 'border-box',
          }} />
        )}

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{
              fontSize: 13, fontWeight: 600, color: isSelected ? C.txt : C.txt,
              lineHeight: 1.4, minWidth: 0, wordBreak: 'break-word', overflowWrap: 'anywhere',
            }}>
              {title}
            </div>
            {isSelected && <Badge color={C.grn}>Primary</Badge>}
          </div>

          {/* Authors · Year · Journal */}
          {metaBits.length > 0 && (
            <div style={{ fontSize: 11.5, color: C.txt2, marginTop: 5, lineHeight: 1.45, minWidth: 0, overflowWrap: 'anywhere' }}>
              {metaBits.map((b, i) => (
                <span key={i}>
                  {i > 0 && <span style={{ color: C.brd2, margin: '0 6px' }}>·</span>}
                  {b}
                </span>
              ))}
            </div>
          )}

          {/* Identifier fields — aligned, subtly labeled */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 9 }}>
            <IdField label="DOI">
              {record.doi ? (
                <a
                  href={`https://doi.org/${record.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: C.acc, textDecoration: 'none', fontFamily: MONO, fontSize: 11 }}
                  onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
                  onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
                >
                  {record.doi}
                </a>
              ) : <Dash />}
            </IdField>

            <IdField label="PMID">
              {record.pmid
                ? <span style={{ fontFamily: MONO, fontSize: 11, color: C.txt2 }}>{record.pmid}</span>
                : <Dash />}
            </IdField>

            <IdField label="Source">
              {record.sourceDb
                ? <span style={{ fontFamily: MONO, fontSize: 11, color: C.txt2 }}>{record.sourceDb}</span>
                : <Dash />}
            </IdField>
          </div>

          {/* Abstract preview — 3-line clamp by default, expandable (prompt23 Task 10) */}
          {abstract && (
            <div style={{ marginTop: 10 }}>
              <FieldLabel>Abstract</FieldLabel>
              <div style={{
                fontSize: 11.5, color: C.txt2, lineHeight: 1.5, marginTop: 3,
                whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                ...(showFull ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
              }}>
                {abstract}
              </div>
              {isLong && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowFull(v => !v); }}
                  style={{ marginTop: 4, background: 'none', border: 'none', color: C.acc, fontSize: 11, fontFamily: FONT, fontWeight: 600, cursor: 'pointer', padding: 0 }}
                >
                  {showFull ? '▲ Show less' : '▼ Show more'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Small field helpers ──────────────────────────────────────────────────────
function IdField({ label, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
      <FieldLabel>{label}</FieldLabel>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320, overflowWrap: 'anywhere', wordBreak: 'break-all' }}>{children}</span>
    </span>
  );
}

function Dash() {
  return <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>—</span>;
}
