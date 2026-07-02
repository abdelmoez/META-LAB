/**
 * SearchVersionsPanel.jsx — 69.md. Collapsible "Versions" panel for the Build step. It
 * lists the saved search-strategy versions (name, vN, date, author, final badge) and,
 * for writers, exposes Save version / Restore / Mark final / Compare. Read-only users
 * see the list without the write buttons.
 *
 * Data comes from the soft searchVersionsApi (quiet when the searchEngine flag is off or
 * the backend is not yet deployed → a small "unavailable" note rather than a crash).
 * Writes THROW on failure and surface an inline error. All fetching happens in effects,
 * so under SSR/tests the panel renders its collapsed shell and the pure VersionList /
 * DiffView leaves are unit-tested directly from props.
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, alpha } from '../../frontend/theme/tokens.js';
import { searchVersionsApi } from './searchVersionsApi.js';
import { formatVersionDiff } from './versionDiff.js';

/** Pure leaf: the version list. Exported for unit tests. */
export function VersionList({ versions, readOnly, onRestore, onFinal, busyId }) {
  const list = Array.isArray(versions) ? versions : [];
  if (!list.length) return <div style={{ fontSize: 11.5, color: C.muted, padding: '6px 2px' }}>No saved versions yet.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {list.map((v) => (
        <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.acc, fontFamily: 'IBM Plex Mono, monospace', flexShrink: 0 }}>v{v.version}</span>
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', flex: 1 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name || `Version ${v.version}`}</span>
            <span style={{ fontSize: 10.5, color: C.muted }}>
              {v.createdByName ? `${v.createdByName} · ` : ''}{formatWhen(v.createdAt)}{v.note ? ` · ${v.note}` : ''}
            </span>
          </span>
          {v.isFinal && (
            <span style={{ fontSize: 10, fontWeight: 700, color: C.grn, background: alpha(C.grn, '18'), border: `1px solid ${alpha(C.grn, '55')}`, borderRadius: 6, padding: '2px 7px', flexShrink: 0 }}>FINAL</span>
          )}
          {!readOnly && (
            <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button type="button" onClick={() => onRestore && onRestore(v)} disabled={busyId === v.id} style={miniBtn()}>Restore</button>
              {!v.isFinal && <button type="button" onClick={() => onFinal && onFinal(v)} disabled={busyId === v.id} style={miniBtn()}>Mark final</button>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Pure leaf: render a readable version diff. Exported for unit tests. */
export function DiffView({ diff }) {
  const groups = formatVersionDiff(diff);
  if (!groups.length) return <div style={{ fontSize: 11.5, color: C.muted }}>No differences, or the comparison is unavailable.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
      {groups.map((g) => (
        <div key={g.title}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>{g.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {g.items.map((it, i) => (
              <div key={i} style={{ fontSize: 12, color: it.kind === 'added' ? C.grn : it.kind === 'removed' ? C.red : C.txt2 }}>
                <span style={{ fontWeight: 700, marginRight: 6 }}>{it.kind === 'added' ? '+' : it.kind === 'removed' ? '−' : '~'}</span>{it.text}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatWhen(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return String(iso); }
}

export default function SearchVersionsPanel({ projectId, readOnly, onAfterRestore }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState('idle'); // idle|loading|ready|unavailable
  const [versions, setVersions] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');
  // Compare + save UI
  const [cmp, setCmp] = useState({ a: '', b: '', diff: null, loading: false, err: '' });
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setState('loading'); setErr('');
    const out = await searchVersionsApi.list(projectId);
    setVersions(out.versions);
    setState(out.available ? 'ready' : 'unavailable');
  }, [projectId]);

  useEffect(() => { if (open && state === 'idle') refresh(); }, [open, state, refresh]);

  const doSave = useCallback(async () => {
    const name = (typeof window !== 'undefined' && window.prompt) ? window.prompt('Name this version') : '';
    if (name == null) return; // cancelled
    const note = (typeof window !== 'undefined' && window.prompt) ? (window.prompt('Optional note') || '') : '';
    setSaving(true); setErr('');
    try { await searchVersionsApi.save(projectId, { name: name || 'Untitled version', note }); await refresh(); }
    catch (e) { setErr(`Could not save version: ${(e && e.message) || 'error'}`); }
    finally { setSaving(false); }
  }, [projectId, refresh]);

  const doRestore = useCallback(async (v) => {
    if (typeof window !== 'undefined' && window.confirm && !window.confirm(`Restore v${v.version} “${v.name || ''}”? This overwrites the current draft.`)) return;
    setBusyId(v.id); setErr('');
    try { await searchVersionsApi.restore(projectId, v.id); onAfterRestore && onAfterRestore(); await refresh(); }
    catch (e) { setErr(`Could not restore: ${(e && e.message) || 'error'}`); }
    finally { setBusyId(null); }
  }, [projectId, refresh, onAfterRestore]);

  const doFinal = useCallback(async (v) => {
    setBusyId(v.id); setErr('');
    try { await searchVersionsApi.markFinal(projectId, v.id); await refresh(); }
    catch (e) { setErr(`Could not mark final: ${(e && e.message) || 'error'}`); }
    finally { setBusyId(null); }
  }, [projectId, refresh]);

  const doCompare = useCallback(async () => {
    if (!cmp.a || !cmp.b) return;
    setCmp((c) => ({ ...c, loading: true, err: '', diff: null }));
    const out = await searchVersionsApi.compare(projectId, cmp.a, cmp.b);
    setCmp((c) => ({ ...c, loading: false, diff: out.diff, err: out.available ? '' : 'Comparison unavailable.' }));
  }, [projectId, cmp.a, cmp.b]);

  return (
    <div style={{ marginTop: 12, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: FONT, color: C.txt }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Versions</span>
        {versions.length > 0 && <span style={{ fontSize: 10.5, color: C.muted }}>({versions.length})</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.muted, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>▸</span>
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          {state === 'loading' && <div style={{ fontSize: 11.5, color: C.muted }}>Loading versions…</div>}
          {state === 'unavailable' && (
            <div style={{ fontSize: 11.5, color: C.muted, background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, padding: '9px 11px' }}>
              Version history isn’t available — it needs the <strong style={{ color: C.txt2 }}>Search Builder Engine</strong> enabled in Ops.
            </div>
          )}
          {state === 'ready' && (
            <>
              <VersionList versions={versions} readOnly={readOnly} onRestore={doRestore} onFinal={doFinal} busyId={busyId} />
              {err && <div style={{ marginTop: 8, fontSize: 11.5, color: C.red }}>{err}</div>}

              {!readOnly && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button type="button" onClick={doSave} disabled={saving} style={btn()}>{saving ? 'Saving…' : 'Save version'}</button>
                </div>
              )}

              {versions.length >= 2 && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.brd}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>Compare</span>
                    <select value={cmp.a} onChange={(e) => setCmp((c) => ({ ...c, a: e.target.value }))} style={sel()}>
                      <option value="">version A…</option>
                      {versions.map((v) => <option key={v.id} value={v.id}>v{v.version} {v.name || ''}</option>)}
                    </select>
                    <span style={{ fontSize: 11, color: C.muted }}>vs</span>
                    <select value={cmp.b} onChange={(e) => setCmp((c) => ({ ...c, b: e.target.value }))} style={sel()}>
                      <option value="">version B…</option>
                      {versions.map((v) => <option key={v.id} value={v.id}>v{v.version} {v.name || ''}</option>)}
                    </select>
                    <button type="button" onClick={doCompare} disabled={!cmp.a || !cmp.b || cmp.loading} style={btn()}>{cmp.loading ? 'Comparing…' : 'Compare'}</button>
                  </div>
                  {cmp.err && <div style={{ marginTop: 8, fontSize: 11.5, color: C.muted }}>{cmp.err}</div>}
                  {cmp.diff && <DiffView diff={cmp.diff} />}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function btn() {
  return { padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.brd2}`, background: 'transparent', color: C.txt2, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
}
function miniBtn() {
  return { padding: '4px 9px', borderRadius: 7, border: `1px solid ${C.brd2}`, background: 'transparent', color: C.txt2, fontSize: 10.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
}
function sel() {
  return { padding: '5px 8px', borderRadius: 7, border: `1px solid ${C.brd2}`, background: C.surf, color: C.txt, fontSize: 11, fontFamily: FONT };
}
