/**
 * ImportProvenance.jsx — 96.md Phase 5D (article-level provenance): the
 * collapsible "Import provenance" section in the screening workbench's record
 * detail (ScreeningTab MiddleColumn).
 *
 * Answers, for ONE article: which search introduced it, which other searches or
 * files also found it, which databases it appeared in, and which metadata
 * fields later imports filled or changed ("abstract added by <run> on <date>").
 *
 * Backend contract (implemented by the parallel server workstream):
 *   GET /api/screening/projects/:pid/records/:rid/provenance
 *     → { sources:[{ runId, runName, origin, provider, providerRecordId,
 *          outcome, importedAt, batchId, filename, rolledBackAt }],
 *         changes:[{ field, fromValue, toValue, runId, provider, createdAt }] }
 *   sources arrive sorted importedAt ASC (first = the search that introduced
 *   the article); we re-sort defensively so the "first found" line never lies.
 *
 * Lazy + soft-failing: nothing is fetched until the user expands the section,
 * and a 404 (endpoint not deployed / no provenance rows for a legacy record)
 * hides the section entirely instead of showing a broken panel.
 *
 * The pure pieces (normalizeProvenance / describeChange / ProvenanceContent)
 * are exported for the renderToStaticMarkup test suite.
 */
import { useState } from 'react';
import { C, FONT, MONO } from '../ui/theme.js';
import { Spinner } from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import { providerLabel } from '../../../research-engine/search/runProgress.js';

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; }
}
const str = (v) => (typeof v === 'string' ? v : '');

/** Human label for a provenance outcome (unknown values pass through as-is). */
const OUTCOME_LABEL = {
  new: 'introduced the article',
  already_present: 'found it again',
  updated: 'updated its metadata',
  merged_duplicate: 'matched it as a duplicate',
  exact_duplicate: 'matched it as an exact duplicate',
  probable_duplicate: 'matched it as a probable duplicate',
};

/** The display name of a provenance source: run name, else filename, else origin. */
export function sourceName(s) {
  return (s && (str(s.runName).trim() || str(s.filename).trim()))
    || (s && s.origin === 'living' ? 'Living review run' : 'Import');
}

/** Tolerant read model for the provenance payload. */
export function normalizeProvenance(p) {
  const raw = p || {};
  const sources = (Array.isArray(raw.sources) ? raw.sources : [])
    .filter((s) => s && typeof s === 'object')
    .map((s, i) => ({
      runId: str(s.runId), runName: str(s.runName), origin: str(s.origin),
      provider: str(s.provider), providerRecordId: str(s.providerRecordId),
      outcome: str(s.outcome), importedAt: s.importedAt || null,
      batchId: str(s.batchId), filename: str(s.filename),
      rolledBackAt: s.rolledBackAt || null,
      _i: i, // stable tiebreaker: keep the server's (contract-sorted) order
    }));
  sources.sort((a, b) => {
    const ta = Date.parse(a.importedAt || '');
    const tb = Date.parse(b.importedAt || '');
    if (Number.isNaN(ta) || Number.isNaN(tb) || ta === tb) return a._i - b._i;
    return ta - tb;
  });
  const changes = (Array.isArray(raw.changes) ? raw.changes : [])
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({
      field: str(c.field), fromValue: str(c.fromValue), toValue: str(c.toValue),
      runId: str(c.runId), provider: str(c.provider), createdAt: c.createdAt || null,
    }));
  // Which run made each change: join changes.runId → sources.runName.
  const runNameById = {};
  for (const s of sources) if (s.runId && !runNameById[s.runId]) runNameById[s.runId] = sourceName(s);
  return {
    sources,
    changes,
    first: sources[0] || null,
    others: sources.slice(1),
    databases: [...new Set(sources.map((s) => s.provider).filter(Boolean))],
    runNameById,
  };
}

const clip = (v, max = 90) => (v.length > max ? `${v.slice(0, max)}…` : v);

/**
 * One metadata change, compacted: "abstract added by <run> on <date>" for a
 * blank→value fill; "title updated … (from → to)" when a value was replaced.
 */
export function describeChange(ch, runNameById = {}) {
  const by = runNameById[ch.runId] || (ch.provider ? providerLabel(ch.provider) : 'an import');
  const when = ch.createdAt ? ` on ${fmtDate(ch.createdAt)}` : '';
  const verb = ch.fromValue ? 'updated' : 'added';
  return {
    summary: `${ch.field || 'field'} ${verb} by ${by}${when}`,
    detail: ch.fromValue ? `${clip(ch.fromValue)} → ${clip(ch.toValue)}` : (ch.toValue ? clip(ch.toValue) : ''),
  };
}

const rowStyle = { fontSize: 12, color: C.txt2, lineHeight: 1.65, minWidth: 0, overflowWrap: 'anywhere' };
const subLabel = { fontSize: 9.5, color: C.muted, fontFamily: MONO, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '12px 0 4px' };
const chip = { fontSize: 10.5, background: C.surf, border: `1px solid ${C.brd}`, color: C.txt2, borderRadius: 10, padding: '2px 9px' };

/** Pure expanded body — renders identically under SSR (exported for tests). */
export function ProvenanceContent({ data }) {
  if (!data || !data.first) {
    return <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic' }}>No import provenance is recorded for this record.</div>;
  }
  const { first, others, databases, changes, runNameById } = data;
  return (
    <div style={{ fontFamily: FONT }}>
      {/* 5D — the search that introduced the article. */}
      <div style={rowStyle}>
        First found by <strong style={{ color: C.txt }}>{sourceName(first)}</strong>
        {first.provider ? ` (${providerLabel(first.provider)})` : ''}
        {first.importedAt ? ` on ${fmtDate(first.importedAt)}` : ''}.
        {first.rolledBackAt ? <span style={{ color: C.muted }}> That import was later rolled back.</span> : null}
      </div>

      {others.length > 0 && (
        <>
          <div style={subLabel}>Also found by</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {others.map((s, i) => (
              <li key={`${s.runId || s.batchId || 'src'}:${s.provider}:${i}`} style={rowStyle}>
                {sourceName(s)}{s.provider ? ` (${providerLabel(s.provider)})` : ''}
                {' — '}{OUTCOME_LABEL[s.outcome] || s.outcome || 'found it'}
                {s.importedAt ? ` on ${fmtDate(s.importedAt)}` : ''}
                {s.rolledBackAt ? <span style={{ color: C.muted }}> · rolled back</span> : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {databases.length > 0 && (
        <>
          <div style={subLabel}>Databases where it appeared</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {databases.map((db) => <span key={db} style={chip}>{providerLabel(db)}</span>)}
          </div>
        </>
      )}

      {changes.length > 0 && (
        <>
          <div style={subLabel}>Metadata changes</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {changes.map((ch, i) => {
              const d = describeChange(ch, runNameById);
              return (
                <li key={`${ch.field}:${ch.runId}:${i}`} style={rowStyle}>
                  {d.summary}
                  {d.detail && <span style={{ color: C.muted, fontFamily: MONO, fontSize: 11 }}> ({d.detail})</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {changes.length === 0 && (
        <div style={{ ...rowStyle, color: C.muted, marginTop: 10 }}>No metadata was changed by later imports.</div>
      )}
    </div>
  );
}

/**
 * Stateful collapsible section. Fetches ONCE on first expand; a 404 hides the
 * whole section (legacy record / endpoint not deployed — soft-fail, 96.md).
 * Mount with key={recordId} so switching records resets the state.
 */
export default function ImportProvenance({ pid, recordId }) {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState({ status: 'idle', data: null, error: '' }); // idle|loading|ready|error|hidden

  const fetchOnce = async () => {
    setSt({ status: 'loading', data: null, error: '' });
    try {
      const r = await screeningApi.getRecordProvenance(pid, recordId);
      setSt({ status: 'ready', data: normalizeProvenance(r), error: '' });
    } catch (e) {
      if (e && e.status === 404) setSt({ status: 'hidden', data: null, error: '' });
      else setSt({ status: 'error', data: null, error: e?.message || 'Could not load the import provenance.' });
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && st.status === 'idle') fetchOnce();
  };

  if (st.status === 'hidden') return null;

  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 8, background: C.card, padding: '10px 14px' }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title={open ? 'Hide where this article came from' : 'Show which searches and files this article came from'}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'transparent',
          border: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, textAlign: 'left',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 10, color: C.muted, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
        <span style={{ fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted }}>
          Import provenance
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {st.status === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.txt2 }}>
              <Spinner size={13} /> Loading provenance…
            </div>
          )}
          {st.status === 'error' && (
            <div style={{ fontSize: 12, color: C.red }}>
              {st.error}{' '}
              <button type="button" onClick={fetchOnce} style={{ background: 'none', border: 'none', color: C.acc, cursor: 'pointer', fontSize: 12, padding: 0, fontFamily: FONT, textDecoration: 'underline' }}>
                Retry
              </button>
            </div>
          )}
          {st.status === 'ready' && <ProvenanceContent data={st.data} />}
        </div>
      )}
    </div>
  );
}
