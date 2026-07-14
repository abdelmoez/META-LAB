/**
 * features/provenance/ProjectHistoryPanel.jsx — 88.md Part IV. The Project History /
 * Research Provenance interface: a filterable, paginated view of the append-only
 * event ledger with scientific-significance + manuscript-impact badges, before→after
 * values, reasons (fill-in for missing ones), superseded/review markers, and a
 * milestone summary header. Reads /api/provenance; degrades gracefully when the
 * ledger table has not been migrated yet (available:false).
 */
import { useCallback, useEffect, useState } from 'react';
import { S, salpha, StitchBadge, StitchButton, StitchLoadingState, StitchErrorState } from '../../frontend/stitch/primitives';
import { fetchEvents, fetchSummary, addReason as apiAddReason } from './api.js';
import { eventTitle, significanceBadge, manuscriptImpact, beforeAfter, originLabel } from './format.js';

const FILTERS = [
  { key: '', label: 'All activity' },
  { key: 'scientific', label: 'Scientific changes' },
  { key: 'manuscript', label: 'Manuscript impact' },
  { key: 'deviations', label: 'Protocol deviations' },
  { key: 'search', label: 'Search' },
  { key: 'screening', label: 'Screening' },
  { key: 'extraction', label: 'Extraction' },
  { key: 'rob', label: 'Risk of bias' },
  { key: 'analysis', label: 'Analysis' },
];

const fmtTime = (v) => { try { return v ? new Date(v).toLocaleString() : ''; } catch { return ''; } };

function Chip({ active, children, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        border: `1px solid ${active ? S.brand : salpha(S.outlineVariant, 0.6)}`,
        background: active ? S.brandSoft : 'transparent',
        color: active ? S.onBrandSoft : S.textSecondary,
        borderRadius: 999, padding: '5px 12px', fontSize: 12.5, fontWeight: active ? 700 : 500,
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}>{children}</button>
  );
}

function ReasonEditor({ projectId, event, canAmend, onSaved }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  if (event.reason) return <div style={{ fontSize: 12.5, color: S.textSecondary }}><strong>Reason:</strong> {event.reason}</div>;
  if (!canAmend) return null; // read-only users get no add-reason affordance (server would 403)
  if (!open) return <button type="button" onClick={() => setOpen(true)} style={{ background: 'none', border: 'none', color: S.brand, fontSize: 12, cursor: 'pointer', padding: 0 }}>+ Add reason</button>;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 4 }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Why was this change made?"
        style={{ flex: 1, fontSize: 12.5, padding: 6, border: `1px solid ${salpha(S.outlineVariant, 0.6)}`, borderRadius: 8, resize: 'vertical' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <StitchButton size="sm" disabled={busy || !text.trim()} onClick={async () => {
          setBusy(true); setErr(null);
          try { await apiAddReason(projectId, event.id, text.trim()); onSaved(event.id, text.trim()); }
          catch (e) { setErr(e.message); } finally { setBusy(false); }
        }}>Save</StitchButton>
        <button type="button" onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: S.textSecondary, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
      </div>
      {err && <span style={{ color: S.danger, fontSize: 11 }}>{err}</span>}
    </div>
  );
}

function EventRow({ projectId, event, canAmend, onReasonSaved }) {
  const sig = significanceBadge(event.significance);
  const ba = beforeAfter(event);
  const impact = manuscriptImpact(event);
  return (
    <li style={{ listStyle: 'none', padding: '12px 14px', borderBottom: `1px solid ${salpha(S.outlineVariant, 0.35)}`, opacity: event.invalidated ? 0.55 : 1 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <StitchBadge tone={sig.tone}>{sig.label}</StitchBadge>
        <strong style={{ fontSize: 13.5, color: S.textPrimary }}>{eventTitle(event)}</strong>
        {event.entityId && <span style={{ fontSize: 12, color: S.textSecondary }}>· {event.entityType}: {event.entityId}</span>}
        {event.reconstructed && <StitchBadge tone="neutral">reconstructed</StitchBadge>}
        {event.requiresReview && <StitchBadge tone="warn">needs review</StitchBadge>}
        {event.resultImpact === 'changed' && <StitchBadge tone="danger">results changed</StitchBadge>}
        {event.invalidated && <StitchBadge tone="neutral">invalidated</StitchBadge>}
      </div>
      {ba && (
        <div style={{ fontSize: 12.5, color: S.textSecondary, marginTop: 4, fontFamily: 'monospace' }}>
          <span>{ba.prev}</span> <span style={{ color: S.brand }}>→</span> <span>{ba.next}</span>
        </div>
      )}
      {impact && <div style={{ fontSize: 12, color: S.info, marginTop: 4 }}>📄 {impact}</div>}
      <div style={{ marginTop: 6 }}>
        <ReasonEditor projectId={projectId} event={event} canAmend={canAmend} onSaved={onReasonSaved} />
      </div>
      <div style={{ fontSize: 11.5, color: S.textTertiary || S.textSecondary, marginTop: 6 }}>
        {originLabel(event.origin)} · {event.actorName || 'system'} · {fmtTime(event.at)}
        {event.correlationId ? ' · grouped' : ''}
      </div>
    </li>
  );
}

export default function ProjectHistoryPanel({ project, projectId }) {
  const pid = projectId || (project && project.id);
  const [filter, setFilter] = useState('');
  const [events, setEvents] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [summary, setSummary] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | error | unavailable
  const [error, setError] = useState(null);
  const [canAmend, setCanAmend] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (f) => {
    if (!pid) return;
    setState('loading'); setError(null);
    try {
      const [ev, sm] = await Promise.all([fetchEvents(pid, { filter: f, limit: 40 }), fetchSummary(pid).catch(() => null)]);
      if (ev.available === false) { setState('unavailable'); return; }
      setEvents(ev.events || []);
      setCursor(ev.nextCursor || null);
      setCanAmend(!!ev.canAmend);
      setSummary(sm && sm.available !== false ? sm : null);
      setState('ready');
    } catch (e) { setError(e.message); setState('error'); }
  }, [pid]);

  useEffect(() => { load(filter); }, [load, filter]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const ev = await fetchEvents(pid, { filter, cursor, limit: 40 });
      setEvents((prev) => [...prev, ...(ev.events || [])]);
      setCursor(ev.nextCursor || null);
    } catch (e) { setError(e.message); } finally { setLoadingMore(false); }
  };

  const onReasonSaved = (id, reason) => setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, reason } : e)));

  const wrap = { maxWidth: 920, margin: '0 auto', padding: '20px 16px 60px' };

  if (state === 'error') return <div style={wrap}><StitchErrorState title="Could not load project history" desc={error} onRetry={() => load(filter)} /></div>;

  return (
    <div style={wrap}>
      <header style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: S.textPrimary, margin: '0 0 4px' }}>Research Provenance</h1>
        <p style={{ fontSize: 13, color: S.textSecondary, margin: 0 }}>
          The complete, append-only history of every meaningful change to this study — search, screening, extraction, risk of bias, analysis and manuscript. Scientific significance and manuscript impact are classified automatically; the raw history is permanent.
        </p>
      </header>

      {state === 'unavailable' && (
        <div style={{ padding: 20, background: S.card, border: `1px solid ${salpha(S.outlineVariant, 0.5)}`, borderRadius: 14, fontSize: 13, color: S.textSecondary }}>
          The provenance ledger is enabled but its database table has not been created yet. Run <code>prisma db push</code> (or the deploy migration) to activate event capture. Once active, this project will receive an honest baseline and every subsequent change will be recorded here.
        </div>
      )}

      {state !== 'unavailable' && (
        <>
          {summary && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <Stat label="Recorded events" value={summary.total} />
              <Stat label="Manuscript-impacting" value={summary.manuscriptImpacting} />
              <Stat label="Potential deviations" value={(summary.potentialDeviations || []).length} tone={(summary.potentialDeviations || []).length ? 'warn' : 'neutral'} />
              {summary.lastEventAt && <Stat label="Last change" value={fmtTime(summary.lastEventAt)} />}
            </div>
          )}

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
            {FILTERS.map((f) => <Chip key={f.key || 'all'} active={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</Chip>)}
          </div>

          {state === 'loading' && <StitchLoadingState label="Loading project history…" />}

          {state === 'ready' && (
            events.length === 0 ? (
              <div style={{ padding: 28, textAlign: 'center', color: S.textSecondary, fontSize: 13 }}>
                No {filter ? `${(FILTERS.find((x) => x.key === filter) || {}).label?.toLowerCase()} ` : ''}events recorded yet. Changes you make to the project will appear here.
              </div>
            ) : (
              <ul style={{ margin: 0, padding: 0, background: S.card, border: `1px solid ${salpha(S.outlineVariant, 0.4)}`, borderRadius: 14, overflow: 'hidden' }}>
                {events.map((e) => <EventRow key={e.id} projectId={pid} event={e} canAmend={canAmend} onReasonSaved={onReasonSaved} />)}
              </ul>
            )
          )}

          {state === 'ready' && cursor && (
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <StitchButton variant="ghost" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading…' : 'Load older changes'}</StitchButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div style={{ flex: '1 1 140px', minWidth: 120, padding: '10px 14px', background: S.card, border: `1px solid ${salpha(tone === 'warn' ? S.warn : S.outlineVariant, tone === 'warn' ? 0.5 : 0.4)}`, borderRadius: 12 }}>
      <div style={{ fontSize: 11, color: S.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: tone === 'warn' ? S.warn : S.textPrimary, marginTop: 2 }}>{value}</div>
    </div>
  );
}
