/**
 * features/logbook/LogbookPage.jsx — 119.md §8. The project Logbook: a complete,
 * readable history of meaningful activity by project members and system processes.
 *
 * OWNER/LEADER ONLY. This component is the NAVIGATION/ROUTE half of §8's
 * enforcement list: it resolves the SAME `viewLogbook` capability the server
 * enforces (features/logbook/logbookAccess.js) and renders an honest AccessDenied
 * card — never a request — for anyone else. It is defence in depth, not the
 * defence: server/logbook/logbookAccess.js refuses a hand-typed URL or a raw
 * fetch() regardless of what this component does.
 *
 * STYLING: LEGACY tokens only (C/btnS/inp/tagS + var(--t-*)) — the Logbook mounts
 * as a stage in the Stitch project workspace AND as a legacy Workspace tab, and
 * legacyRemap harmonises these tokens under Stitch (the ARCH-118 rule for any view
 * that renders in both shells). Restrained: rows and dividers, not a card wall.
 *
 * PERFORMANCE (§8 "must remain fast in large, long-running projects"): pages of 50
 * pulled through the server's OPAQUE cursor, appended on demand. There is no
 * unbounded fetch and no client-side full scan — filtering, sorting and searching
 * all round-trip so the answer is over the whole Logbook, not over what happens to
 * be loaded.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, btnS, tagS } from '../../frontend/workspace/ui/styles.js';
import { Icon } from '../../frontend/components/icons.jsx';
// 120.md §1 — the Back destination is built by the SAME route builder every other
// project link uses (logbookFormat's resourceLink already does), so the button can
// never invent a URL shape the router does not serve.
import { projectStageHref } from '../../frontend/stitch/nav/navConfig.js';
import AccessDeniedState from '../../frontend/components/access/AccessDeniedState.jsx';
import { canExportLogbook, logbookViewDecision } from './logbookAccess.js';
import { fetchLogbookEvents, fetchLogbookFacets, logbookExportHref, PAGE_SIZE } from './logbookApi.js';
import {
  completenessState, countActiveFilters, emptyStateCopy, focusBanner, groupByDay,
  scanIncompleteCopy, timeZoneLabel,
} from './logbookFormat.js';
import LogbookFilters from './LogbookFilters.jsx';
import LogbookEventRow from './LogbookEvent.jsx';
import LogbookTable from './LogbookTable.jsx';

const EMPTY_FILTERS = Object.freeze({
  q: '', engines: [], actions: [], members: [], roles: [], resourceTypes: [],
  statuses: [], actorTypes: [], from: '', to: '', sort: 'desc',
});

/** The filter fields that must round-trip to the server when they change. */
const QUERY_KEYS = ['q', 'engines', 'actions', 'members', 'roles', 'resourceTypes', 'statuses', 'actorTypes', 'from', 'to', 'sort'];
const querySignature = (f) => JSON.stringify(QUERY_KEYS.map((k) => f[k]));

/**
 * 120.md §1 — Project Control FOR THIS PROJECT.
 *
 * The whole point of the requirement ("Preserve the active project ID · prevent
 * accidental navigation to Project Control for a different project") is that the
 * destination is DERIVED from the project the Logbook is currently showing, never
 * from history. Exported so the URL construction is unit-testable on its own.
 */
export function projectControlHref(projectId) {
  return projectStageHref('control', { projectId: projectId || '' });
}

/**
 * 120.md §1 — the header's Back control.
 *
 * A real <button>, for three reasons the requirement states directly: Enter AND
 * Space activate it for free, the app-wide `button:focus-visible` ring applies
 * (tokens.js buildThemeCss) with no bespoke focus styling, and it matches the
 * established PecanRev Back-button shape (Workspace's "Back to Projects",
 * RobWorkspace's back link) — an icon plus its words, not an icon alone.
 *
 * `onBack` is the navigation seam: BOTH shells pass one (Stitch → goStage('control'),
 * legacy → setTab('control')), so the real navigation is always client-side and never
 * a reload. The fallback exists only for a host that forgot to wire it — it is a
 * direct link to the SAME project's Project Control, never window.history.back(),
 * because the Logbook is routinely opened from a bookmark, a notification or a
 * refreshed page where "back" is somewhere else entirely.
 */
function LogbookBackButton({ projectId, onBack }) {
  const href = projectControlHref(projectId);
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      data-testid="logbook-back"
      aria-label="Back to Project Control"
      title="Back to Project Control"
      onClick={() => {
        if (typeof onBack === 'function') { onBack(); return; }
        if (typeof window !== 'undefined' && window.location) window.location.assign(href);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onBlur={() => setPressed(false)}
      style={{
        ...btnS('ghost'),
        fontSize: 11.5,
        // ≥28px tall and comfortably wide: a real pointer/touch target at every
        // supported width (§1 "Make the click target sufficiently large").
        padding: '7px 13px',
        minHeight: 30,
        color: hover || pressed ? C.txt : C.txt2,
        borderColor: hover || pressed ? C.acc : C.brd2,
        background: pressed ? 'var(--t-card2)' : 'transparent',
      }}
    >
      <Icon name="arrowLeft" size={13} />
      Back to Project Control
    </button>
  );
}

export default function LogbookPage({ project, projectId, perms, onBack }) {
  const pid = projectId || (project && project.id) || '';
  const decision = logbookViewDecision(perms);
  const mayExport = canExportLogbook(perms);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [mode, setMode] = useState('timeline'); // timeline | table
  const [events, setEvents] = useState([]);
  const [cursor, setCursor] = useState(null);
  // 119.md §8 — the server's honest "this page stopped short of the end of the
  // history" signal. It is NOT the same as having a cursor: a cursor can mean
  // "more matching entries are waiting", this means "we have not looked yet".
  const [scanIncomplete, setScanIncomplete] = useState(false);
  const [facets, setFacets] = useState({ engines: [], actions: [], statuses: [], actors: [], roles: [] });
  const [state, setState] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [available, setAvailable] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const reqRef = useRef(0);

  const signature = querySignature(filters);
  const allowed = !!decision.allowed;

  // ── first page (and every filter change) ────────────────────────────────────
  // 119.md §8 — a filter change is a NEW query from the top, never a client-side
  // narrowing of the loaded page: the answer must be over the whole Logbook.
  useEffect(() => {
    if (!pid || !allowed) return undefined;
    let cancelled = false;
    const seq = ++reqRef.current;
    setState('loading'); setError(null);
    fetchLogbookEvents(pid, filters, null)
      .then((page) => {
        if (cancelled || seq !== reqRef.current) return;
        setEvents(page.events || []);
        setCursor(page.nextCursor || null);
        setScanIncomplete(!!page.scanIncomplete);
        setAvailable(page.available !== false);
        setExpandedId(null);
        setState('ready');
      })
      .catch((e) => {
        if (cancelled || seq !== reqRef.current) return;
        setError(e.message || 'The Logbook could not be loaded.');
        setState('error');
      });
    return () => { cancelled = true; };
    // `signature` collapses the filter object into a stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, allowed, signature, reloadNonce]);

  // Facets are the filter option lists — one call per mount, independent of filters.
  useEffect(() => {
    if (!pid || !allowed) return;
    fetchLogbookFacets(pid).then((r) => setFacets(r.facets || facets)).catch(() => { /* filters degrade to what is loaded */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, allowed]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchLogbookEvents(pid, filters, cursor);
      setEvents((prev) => [...prev, ...(page.events || [])]);
      setCursor(page.nextCursor || null);
      setScanIncomplete(!!page.scanIncomplete);
    } catch (e) {
      setError(e.message || 'More events could not be loaded.');
    } finally { setLoadingMore(false); }
  }, [cursor, loadingMore, pid, filters]);

  // Resource types are not a server facet; offer the ones present in what is loaded
  // (plus whatever is already selected) rather than inventing a closed list.
  const resourceOptions = useMemo(() => {
    const seen = new Map();
    for (const e of events) if (e.resourceType) seen.set(e.resourceType, (seen.get(e.resourceType) || 0) + 1);
    for (const r of filters.resourceTypes || []) if (!seen.has(r)) seen.set(r, 0);
    return Array.from(seen.entries()).map(([value, n]) => ({ value, label: value, n }));
  }, [events, filters.resourceTypes]);

  const activeCount = countActiveFilters(filters);
  const focus = focusBanner(filters, facets);
  const days = useMemo(() => groupByDay(events), [events]);
  const tz = timeZoneLabel();
  const completeness = completenessState({ loaded: events.length, cursor, scanIncomplete });
  const scanCopy = scanIncompleteCopy();

  if (!allowed) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px 60px' }} data-testid="logbook-denied">
        <AccessDeniedState decision={decision} variant="page" />
      </div>
    );
  }

  const wrap = { maxWidth: 1040, margin: '0 auto', padding: '20px 16px 60px' };
  const setFocusMember = (actorId) => setFilters((f) => ({ ...f, members: [actorId], engines: [] }));
  const setFocusEngine = (engine) => setFilters((f) => ({ ...f, engines: [engine], members: [] }));

  return (
    <div style={wrap} data-testid="logbook-page">
      <header style={{ marginBottom: 14 }}>
        {/* 120.md §1 — the expected upper-LEFT position: its own row above the
            title, so it never competes with the heading for the same line and stays
            visible (and wrap-free) at every supported width. */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <LogbookBackButton projectId={pid} onBack={onBack} />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.txt, margin: 0 }}>Logbook</h1>
          <span style={tagS('blue')}>Owner and leaders only</span>
        </div>
        <p style={{ fontSize: 13, color: C.txt2, margin: '6px 0 0', maxWidth: 760 }}>
          Every meaningful action in this project — by members and by the system — in the order it happened. Entries are permanent: they cannot be edited or deleted from here.
        </p>
        <p style={{ fontSize: 11.5, color: C.muted, margin: '6px 0 0' }} data-testid="logbook-timezone">
          Times are shown in your timezone, {tz}. Exports use UTC.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
        <div role="group" aria-label="View mode" style={{ display: 'flex', gap: 6 }}>
          <button type="button" data-testid="logbook-mode-timeline" aria-pressed={mode === 'timeline' ? 'true' : 'false'}
            onClick={() => setMode('timeline')} style={{ ...btnS(mode === 'timeline' ? 'primary' : 'ghost'), fontSize: 11.5, padding: '6px 13px' }}>
            Timeline
          </button>
          <button type="button" data-testid="logbook-mode-table" aria-pressed={mode === 'table' ? 'true' : 'false'}
            onClick={() => setMode('table')} style={{ ...btnS(mode === 'table' ? 'primary' : 'ghost'), fontSize: 11.5, padding: '6px 13px' }}>
            Table
          </button>
        </div>
        <span style={{ flex: 1 }} />
        {/* The Logbook is a live record; new events arrive while it is open. A plain
            re-query from the top is the honest refresh — there is no client-side
            cache to reconcile. */}
        <button type="button" data-testid="logbook-refresh" onClick={() => setReloadNonce((n) => n + 1)}
          style={{ ...btnS('ghost'), fontSize: 11.5, padding: '6px 13px' }}>
          Refresh
        </button>
        {mayExport && (
          <>
            <a href={logbookExportHref(pid, filters, 'csv')} data-testid="logbook-export-csv" download
              style={{ ...btnS('ghost'), fontSize: 11.5, padding: '6px 13px', textDecoration: 'none' }}>
              Export CSV
            </a>
            <a href={logbookExportHref(pid, filters, 'json')} data-testid="logbook-export-json" download
              style={{ ...btnS('ghost'), fontSize: 11.5, padding: '6px 13px', textDecoration: 'none' }}>
              Export JSON
            </a>
          </>
        )}
      </div>

      <LogbookFilters
        filters={filters}
        facets={facets}
        resourceOptions={resourceOptions}
        activeCount={activeCount}
        onChange={setFilters}
        onClear={() => setFilters(EMPTY_FILTERS)}
      />

      {focus && (
        <div data-testid="logbook-focus-banner"
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: `1px solid ${C.brd}`, borderRadius: 8, background: C.card, marginBottom: 12 }}>
          <span style={{ fontSize: 12.5, color: C.txt, fontWeight: 600 }}>{focus.label}</span>
          <span style={{ flex: 1 }} />
          <button type="button" data-testid="logbook-focus-clear"
            onClick={() => setFilters((f) => ({ ...f, members: [], engines: [] }))}
            style={{ background: 'none', border: 'none', color: C.acc, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
            Show the whole project
          </button>
        </div>
      )}

      {!available && (
        <div data-testid="logbook-partial-notice"
          style={{ padding: '10px 12px', border: `1px solid ${C.brd}`, borderRadius: 8, background: C.card, fontSize: 12, color: C.txt2, marginBottom: 12 }}>
          The Logbook table has not been created in this database yet, so only history recorded by the earlier audit logs is shown. Run the database migration to start recording new events.
        </div>
      )}

      {state === 'error' && (
        <div data-testid="logbook-error"
          style={{ padding: '14px 16px', border: `1px solid ${C.brd}`, borderRadius: 8, background: C.card }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.txt, marginBottom: 4 }}>The Logbook could not be loaded</div>
          <div style={{ fontSize: 12.5, color: C.txt2, marginBottom: 10 }}>{error}</div>
          <button type="button" data-testid="logbook-retry" onClick={() => setReloadNonce((n) => n + 1)} style={{ ...btnS('ghost'), fontSize: 11.5 }}>Try again</button>
        </div>
      )}

      {state === 'loading' && (
        <div data-testid="logbook-loading" style={{ padding: '28px 0', textAlign: 'center', fontSize: 12.5, color: C.muted }}>
          Loading the Logbook…
        </div>
      )}

      {/* "Nothing matched" is only honest once the server has actually reached the
          end of the history. While it is still searching, say THAT instead. */}
      {state === 'ready' && events.length === 0 && completeness !== 'searching' && (
        <div data-testid="logbook-empty" style={{ padding: '32px 16px', textAlign: 'center', border: `1px solid ${C.brd}`, borderRadius: 8, background: C.card }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.txt, marginBottom: 6 }}>{emptyStateCopy(filters).title}</div>
          <div style={{ fontSize: 12.5, color: C.txt2, maxWidth: 520, margin: '0 auto' }}>{emptyStateCopy(filters).body}</div>
        </div>
      )}

      {state === 'ready' && completeness === 'searching' && (
        <div data-testid="logbook-scan-incomplete" style={{ padding: '32px 16px', textAlign: 'center', border: `1px solid ${C.brd}`, borderRadius: 8, background: C.card }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.txt, marginBottom: 6 }}>{scanCopy.title}</div>
          <div style={{ fontSize: 12.5, color: C.txt2, maxWidth: 520, margin: '0 auto' }}>{scanCopy.body}</div>
        </div>
      )}

      {state === 'ready' && events.length > 0 && mode === 'timeline' && (
        <div data-testid="logbook-timeline">
          {days.map((d) => (
            <section key={d.key} style={{ marginBottom: 6 }}>
              <h2 style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: 0.8, textTransform: 'uppercase', margin: '14px 0 2px' }}>{d.label}</h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: `1px solid ${C.brd}` }}>
                {d.events.map((e) => (
                  <LogbookEventRow key={e.id} event={e} projectId={pid}
                    expanded={expandedId === e.id}
                    onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
                    onFocusMember={setFocusMember} onFocusEngine={setFocusEngine} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {state === 'ready' && events.length > 0 && mode === 'table' && (
        <LogbookTable events={events} projectId={pid} expandedId={expandedId}
          onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
          onFocusMember={setFocusMember} onFocusEngine={setFocusEngine} />
      )}

      {state === 'ready' && (events.length > 0 || cursor) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          {events.length > 0 && (
            <span style={{ fontSize: 11.5, color: C.muted }} data-testid="logbook-count">
              Showing {events.length} event{events.length === 1 ? '' : 's'}{cursor ? ' so far' : ''}
            </span>
          )}
          {completeness === 'partial' && (
            <span style={{ fontSize: 11.5, color: C.muted }} data-testid="logbook-scan-notice">{scanCopy.notice}</span>
          )}
          <span style={{ flex: 1 }} />
          {/* Honest label: only a page the server confirmed has more matching
              entries can promise a number — the other states are a search. */}
          {cursor && (
            <button type="button" data-testid="logbook-load-more" disabled={loadingMore} onClick={loadMore}
              style={{ ...btnS('ghost'), fontSize: 11.5 }}>
              {loadingMore ? 'Loading…' : (completeness === 'more' ? `Load ${PAGE_SIZE} more` : 'Keep looking')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
