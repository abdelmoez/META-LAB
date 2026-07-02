/**
 * LivingReviewTab.jsx — the Living Review dashboard (66.md P6, flag `livingReview`).
 *
 * A living systematic review keeps a completed review current: it re-runs the saved
 * search on a cadence, pre-scores anything new with the project's own AI model, takes
 * reproducible snapshots of the whole review, and — cautiously — flags when the pooled
 * evidence has moved enough to warrant a human re-read. This tab is the researcher's
 * cockpit for all of that. It NEVER draws a conclusion on its own: every automated
 * signal is framed as "review recommended", never "the evidence has changed".
 *
 * It drives the /api/living contract (livingApi.js) and reuses the SAME Search
 * Builder strategy (loadCanonicalQuery) and Pecan providers (pecanSearchApi) the
 * one-off search uses, so a saved search stores the EXACT query the review was built
 * on. When the flag is off it renders a quiet disabled note (mirroring NMA / Pecan),
 * never a broken UI. Read-only members can browse; managing actions are gated on the
 * server's `canManage` and disabled (with an explanation) client-side.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { C } from '../../frontend/workspace/ui/styles.js';
import { alpha as themeAlpha } from '../../frontend/theme/tokens.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { livingApi } from './livingApi.js';
import { pecanSearchApi, loadCanonicalQuery } from '../pecanSearch/pecanSearchApi.js';
import {
  Card, StatTile, StatusPill, Note, EmptyState, Btn, Toggle, formatWhen,
} from '../pecanSearch/components/parts.jsx';
// 67.md — product-tier gate. Living reviews are a Pro-plan feature; the server
// enforces access, so this is UX-only (fail-open) locked-state messaging.
import { useEntitlements, LockedFeatureCard } from '../../frontend/entitlements';
import { requiredTierFor } from '../../shared/entitlements.js';

const CADENCE_LABEL = {
  manual: 'Manual', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
};
const SEVERITY_TONE = { major: 'error', notable: 'warn', info: 'info' };

/* Count concepts/terms in a canonical query for the read-only creation summary. */
function summarizeQuery(canonical) {
  if (!canonical || !Array.isArray(canonical.concepts)) return { concepts: 0, terms: 0 };
  const concepts = canonical.concepts.length;
  const terms = canonical.concepts.reduce((n, c) => n + (Array.isArray(c.terms) ? c.terms.length : 0), 0);
  return { concepts, terms };
}

/* A flat one-line plain-text render of a canonical query for the stored snapshot. */
function renderPlain(canonical) {
  if (!canonical || !Array.isArray(canonical.concepts)) return '';
  return canonical.concepts
    .map((c) => {
      const terms = (c.terms || []).map((t) => (t && t.text) || '').filter(Boolean);
      return terms.length ? `(${terms.join(' OR ')})` : '';
    })
    .filter(Boolean)
    .join(' AND ');
}

export default function LivingReviewTab({ projectId }) {
  const [flagOn, setFlagOn] = useState(null); // null = loading
  const ent = useEntitlements();
  useEffect(() => {
    let alive = true;
    fetch('/api/settings/public', { credentials: 'include' })
      .then((r) => r.json())
      .then((s) => { if (alive) setFlagOn(!!(s && s.featureFlags && s.featureFlags.livingReview)); })
      .catch(() => { if (alive) setFlagOn(false); });
    return () => { alive = false; };
  }, []);

  if (flagOn === null) return <div style={{ padding: 24, color: C.muted }}>Loading…</div>;
  if (!flagOn) return <DisabledNote />;
  // 67.md — flag ON but the plan doesn't include living reviews: show the honest
  // locked-feature card instead of the dashboard. Fail-open while entitlements load.
  if (!ent.loading && !ent.has('livingReview.enabled')) {
    return (
      <div style={{ padding: 8 }}>
        <LockedFeatureCard title="Living Reviews" requiredTier={requiredTierFor('livingReview.enabled')} />
      </div>
    );
  }
  return <Dashboard projectId={projectId} />;
}

/* ─────────────────────────── disabled state ─────────────────────────── */
export function DisabledNote() {
  return (
    <div style={{ padding: 28, border: `1px dashed ${C.brd}`, borderRadius: 12, background: C.surf, color: C.muted, maxWidth: 760 }}>
      <div style={{ fontWeight: 700, color: C.txt, fontSize: 16, marginBottom: 8 }}>Living Review</div>
      <p style={{ margin: 0, lineHeight: 1.6 }}>
        Keep a completed review current — re-run your saved search on a cadence, pre-score new
        records with this project's AI model, take reproducible snapshots, and get cautious alerts
        when the pooled evidence may have shifted enough to warrant a re-read.
      </p>
      <p style={{ margin: '12px 0 0', lineHeight: 1.6 }}>
        This feature is currently <strong>disabled</strong>. An administrator can enable it in
        <em> Ops Console › Feature Flags › Living Review</em>.
      </p>
    </div>
  );
}

/* ─────────────────────────── dashboard shell ─────────────────────────── */
function Dashboard({ projectId }) {
  const [state, setState] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [data, setData] = useState(null); // the overview payload

  const load = useCallback(async () => {
    try {
      const d = await livingApi.overview(projectId);
      setData(d); setState('ready'); setError('');
    } catch (e) {
      setError(e.status === 404 ? 'Living Review is not available for this project.' : (e.message || 'Failed to load the Living Review dashboard.'));
      setState('error');
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (state === 'loading') return <div style={{ padding: 24, color: C.muted }}>Loading Living Review…</div>;
  if (state === 'error') {
    return (
      <div style={{ maxWidth: 640 }}>
        <Note tone="error" role="alert">{error}</Note>
        <div style={{ marginTop: 12 }}><Btn variant="ghost" onClick={load}>Retry</Btn></div>
      </div>
    );
  }
  return <LivingDashboardView projectId={projectId} data={data} onChanged={load} />;
}

/**
 * The dashboard body as a PURE function of its loaded `data` (no data-loading
 * effects here), so it renders deterministically — every section shows from the
 * overview payload. Exported for unit tests (the loading/fetch lives in Dashboard).
 */
export function LivingDashboardView({ projectId, data, onChanged = () => {} }) {
  const canManage = !!data.canManage;
  const pecanOn = !!data.pecanSearchEnabled;
  const settings = data.settings || {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <IntroHeader />
      {Array.isArray(data.alerts) && data.alerts.length > 0 && (
        <AlertsBanner alerts={data.alerts} canManage={canManage} projectId={projectId} onChanged={onChanged} />
      )}
      <SavedSearches
        projectId={projectId}
        searches={data.searches || []}
        settings={settings}
        canManage={canManage}
        pecanOn={pecanOn}
        onChanged={onChanged}
      />
      <UpdateQueue projectId={projectId} queue={data.queue || { records: [], runs: [] }} />
      <Snapshots projectId={projectId} snapshots={data.snapshots || []} canManage={canManage} onChanged={onChanged} />
      <PrismaPanel projectId={projectId} searches={data.searches || []} />
    </div>
  );
}

function IntroHeader() {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 9, color: C.acc, background: themeAlpha(C.acc, '16'), border: `1px solid ${themeAlpha(C.acc, '28')}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="refresh" size={16} />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.txt, letterSpacing: '-0.02em' }}>Living Review</h2>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
            Keep this review current with scheduled searches, AI pre-scoring, reproducible snapshots and cautious evidence-shift alerts.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════ 1. Alerts banner ═══════════════════════════ */
function AlertsBanner({ alerts, canManage, projectId, onChanged }) {
  const [ackingId, setAckingId] = useState(null);
  const ack = async (id) => {
    setAckingId(id);
    try { await livingApi.ackAlert(projectId, id); await onChanged(); }
    catch { /* keep the alert visible on failure */ }
    finally { setAckingId(null); }
  };
  // Worst severity drives the banner tone.
  const worst = alerts.some((a) => a.severity === 'major') ? 'major'
    : alerts.some((a) => a.severity === 'notable') ? 'notable' : 'info';
  const col = worst === 'major' ? C.red : worst === 'notable' ? C.yel : C.acc;

  return (
    <section role="alert" style={{ background: themeAlpha(col, '0e'), border: `1px solid ${themeAlpha(col, '2a')}`, borderLeft: `4px solid ${themeAlpha(col, '90')}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span aria-hidden="true" style={{ color: col, display: 'inline-flex' }}><Icon name="alert" size={16} /></span>
        <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: C.txt }}>Potential evidence shift detected</h3>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 12.5, color: C.txt2, lineHeight: 1.6 }}>
        A living-review update changed one or more synthesised results since the last snapshot.
        <strong> Review recommended — this is not an automatic conclusion.</strong>
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {alerts.map((a) => (
          <div key={a.id} style={{ border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12, background: C.card }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusPill state={a.severity === 'major' ? 'failed' : a.severity === 'notable' ? 'partial' : 'queued'}>
                  {a.severity === 'major' ? 'Major' : a.severity === 'notable' ? 'Notable' : 'Info'}
                </StatusPill>
                <span style={{ fontSize: 11, color: C.muted }}>{formatWhen(a.createdAt)}</span>
              </div>
              {canManage && (
                <Btn variant="ghost" busy={ackingId === a.id} onClick={() => ack(a.id)}>Acknowledge</Btn>
              )}
            </div>
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {(a.shifts || []).map((s, i) => (
                <li key={i} style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.55 }}>{s.message}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════ 2. Saved searches ═══════════════════════════ */
function SavedSearches({ projectId, searches, settings, canManage, pecanOn, onChanged }) {
  const [modal, setModal] = useState(null); // { mode:'create'|'edit', search? }
  const [runningId, setRunningId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [rowError, setRowError] = useState({}); // { [id]: msg }

  const runNow = async (s) => {
    setRunningId(s.id); setRowError((e) => ({ ...e, [s.id]: '' }));
    try { await livingApi.runSearch(projectId, s.id); await onChanged(); }
    catch (e) { setRowError((er) => ({ ...er, [s.id]: e.message || 'Failed to start the run.' })); }
    finally { setRunningId(null); }
  };
  const toggleEnabled = async (s) => {
    setTogglingId(s.id);
    try { await livingApi.updateSearch(projectId, s.id, { enabled: !s.enabled }); await onChanged(); }
    catch { /* revert visually by reloading */ await onChanged(); }
    finally { setTogglingId(null); }
  };
  const remove = async (s) => {
    if (!window.confirm(`Delete the saved search "${s.name}"? Its snapshots and history stay, but it will no longer re-run.`)) return;
    try { await livingApi.deleteSearch(projectId, s.id); await onChanged(); } catch { /* ignore */ }
  };

  return (
    <Card title="Saved searches" icon="search"
      desc="Each saved search stores the exact query strategy this review was built on and re-runs it on a cadence."
      right={canManage ? <Btn onClick={() => setModal({ mode: 'create' })}>+ New saved search</Btn> : null}>
      {searches.length === 0 ? (
        <EmptyState icon="refresh" title="No saved searches yet">
          A living review re-runs your search over time so newly published studies surface automatically.
          Save the search strategy this review was built on to start keeping it current.
        </EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {searches.map((s) => (
            <SearchCard key={s.id} s={s} canManage={canManage} pecanOn={pecanOn}
              running={runningId === s.id} toggling={togglingId === s.id} error={rowError[s.id]}
              onRun={() => runNow(s)} onToggle={() => toggleEnabled(s)}
              onEdit={() => setModal({ mode: 'edit', search: s })} onDelete={() => remove(s)} />
          ))}
        </div>
      )}
      {modal && (
        <SearchModal projectId={projectId} settings={settings} mode={modal.mode} search={modal.search}
          onClose={() => setModal(null)} onSaved={async () => { setModal(null); await onChanged(); }} />
      )}
    </Card>
  );
}

function SearchCard({ s, canManage, pecanOn, running, toggling, error, onRun, onToggle, onEdit, onDelete }) {
  const state = s.lastRunState || null;
  const runDisabled = !canManage || running || !pecanOn;
  const runTitle = !pecanOn
    ? 'Enable Pecan Search (Ops → Flags) for automated re-runs'
    : !canManage ? 'You do not have permission to run searches' : '';
  return (
    <div style={{ border: `1px solid ${C.brd}`, borderRadius: 10, padding: 14, background: C.bg }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>{s.name}</span>
            <span style={{ ...pill(C.acc) }}>{CADENCE_LABEL[s.cadence] || s.cadence}</span>
            {!s.enabled && <span style={{ ...pill(C.muted) }}>Paused</span>}
          </div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>
            {(s.providerIds || []).length} source{(s.providerIds || []).length === 1 ? '' : 's'}
            {s.createdByName ? ` · saved by ${s.createdByName}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.muted }}>
            <Toggle on={!!s.enabled} onChange={onToggle} ariaLabel="Enabled for automatic updates" disabled={!canManage || toggling} />
            Auto-update
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 11.5, color: C.muted }}>
        {state ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <StatusPill state={state} />
            {s.lastRunAt ? <span>{formatWhen(s.lastRunAt)}</span> : null}
            {s.lastNewCount != null ? <span style={{ color: C.txt2 }}>· {s.lastNewCount} new record{s.lastNewCount === 1 ? '' : 's'}</span> : null}
          </span>
        ) : <span>Never run</span>}
        {s.cadence !== 'manual' && s.nextRunAt ? <span>Next: {formatWhen(s.nextRunAt)}</span> : null}
      </div>

      {s.lastError ? <div style={{ marginTop: 8, fontSize: 12, color: C.red }}>Last run error: {s.lastError}</div> : null}
      {error ? <div style={{ marginTop: 8, fontSize: 12, color: C.red }}>{error}</div> : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <span title={runTitle}><Btn onClick={onRun} busy={running} disabled={runDisabled}>Run now</Btn></span>
        <Btn variant="ghost" onClick={onEdit} disabled={!canManage}>Edit</Btn>
        <Btn variant="danger" onClick={onDelete} disabled={!canManage}>Delete</Btn>
      </div>
      {!pecanOn && (
        <div style={{ marginTop: 8, fontSize: 11, color: C.muted }}>
          Automated re-runs need the Pecan Search engine — an administrator can enable it in Ops → Flags.
        </div>
      )}
    </div>
  );
}

function SearchModal({ projectId, settings, mode, search, onClose, onSaved }) {
  const isEdit = mode === 'edit';
  const [name, setName] = useState(search?.name || 'Living search');
  const [cadence, setCadence] = useState(search?.cadence || 'weekly');
  const [notes, setNotes] = useState(search?.notes || '');
  const [providerIds, setProviderIds] = useState(search?.providerIds || []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Providers + the current strategy are only needed for CREATE (edit keeps the
  // stored query snapshot untouched — you edit metadata + cadence, not the query).
  const [providers, setProviders] = useState(null);
  const [query, setQuery] = useState(undefined); // undefined = loading; null = no saved strategy
  const [loadErr, setLoadErr] = useState('');

  useEffect(() => {
    if (isEdit) return; // no strategy/provider load for edits
    let alive = true;
    (async () => {
      try {
        const [pv, q] = await Promise.all([
          pecanSearchApi.getProviders().catch(() => null),
          loadCanonicalQuery(projectId).catch((e) => { throw e; }),
        ]);
        if (!alive) return;
        const list = (pv && pv.providers ? pv.providers : []).filter((p) => p.implemented && p.available);
        setProviders(list);
        setQuery(q);
        // default-select the runnable providers so a create is never an empty run
        setProviderIds(list.filter((p) => p.selectable !== false).map((p) => p.id));
      } catch (e) {
        if (alive) { setLoadErr(e.status === 404 ? 'No search strategy is saved for this project yet.' : 'Could not load the search strategy.'); setQuery(null); setProviders([]); }
      }
    })();
    return () => { alive = false; };
  }, [isEdit, projectId]);

  const allowedCadences = Array.isArray(settings.allowedCadences) && settings.allowedCadences.length
    ? settings.allowedCadences : ['manual', 'daily', 'weekly', 'monthly'];

  const toggleProvider = (id) => setProviderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const summary = useMemo(() => summarizeQuery(query), [query]);
  const noStrategy = !isEdit && query === null;

  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (isEdit) {
        await livingApi.updateSearch(projectId, search.id, { name: name.trim(), cadence, notes });
      } else {
        await livingApi.createSearch(projectId, {
          name: name.trim(),
          cadence,
          providerIds,
          canonicalQuery: { concepts: query.concepts || [], filters: query.filters || {} },
          canonicalText: renderPlain(query),
          notes,
        });
      }
      await onSaved();
    } catch (e) {
      setErr(e.message || 'Failed to save the search.');
      setSaving(false);
    }
  };

  const canSave = !saving && name.trim() && (isEdit || (!noStrategy && providerIds.length > 0 && query !== undefined));

  return (
    <ModalShell title={isEdit ? 'Edit saved search' : 'New saved search'} onClose={onClose}>
      {noStrategy ? (
        <Note tone="warn">
          Build a search strategy first — the Search stage (Define → Build → Run) is where you compose the
          query a living review re-runs. Once a strategy is saved, come back here to schedule it.
        </Note>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} maxLength={200} />
          </Field>
          <Field label="Cadence">
            <select value={cadence} onChange={(e) => setCadence(e.target.value)} style={inputStyle}>
              {allowedCadences.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c] || c}</option>)}
            </select>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
              {cadence === 'manual' ? 'Runs only when you click "Run now".' : `Automatically re-runs ${(CADENCE_LABEL[cadence] || cadence).toLowerCase()}.`}
            </div>
          </Field>

          {!isEdit && (
            <>
              <Field label="Search sources">
                {providers === null ? (
                  <div style={{ fontSize: 12, color: C.muted }}>Loading sources…</div>
                ) : providers.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.muted }}>No runnable sources are configured.</div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {providers.map((p) => {
                      const on = providerIds.includes(p.id);
                      return (
                        <button key={p.id} type="button" onClick={() => toggleProvider(p.id)}
                          style={{ ...pill(on ? C.acc : C.muted), cursor: 'pointer', border: `1px solid ${on ? themeAlpha(C.acc, '40') : C.brd}`, background: on ? themeAlpha(C.acc, '14') : 'transparent', padding: '4px 12px' }}>
                          {p.label || p.id}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>

              <Field label="Query snapshot (stored exactly as built)">
                <div style={{ border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', background: C.card, fontSize: 12, color: C.txt2 }}>
                  {query === undefined ? 'Loading strategy…' : (
                    <>
                      <div>{summary.concepts} concept{summary.concepts === 1 ? '' : 's'} · {summary.terms} term{summary.terms === 1 ? '' : 's'}</div>
                      {renderPlain(query) ? (
                        <div style={{ marginTop: 6, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: C.muted, wordBreak: 'break-word' }}>{renderPlain(query)}</div>
                      ) : null}
                      <div style={{ marginTop: 6, fontSize: 10.5, color: C.dim }}>
                        The saved search stores this exact query, so every update runs the same strategy the review was built on.
                      </div>
                    </>
                  )}
                </div>
              </Field>
            </>
          )}

          <Field label="Notes (optional)">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} maxLength={2000} />
          </Field>

          {err ? <Note tone="error" role="alert">{err}</Note> : (loadErr ? <Note tone="warn">{loadErr}</Note> : null)}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        {!noStrategy && <Btn onClick={save} busy={saving} disabled={!canSave}>{isEdit ? 'Save changes' : 'Create saved search'}</Btn>}
      </div>
    </ModalShell>
  );
}

/* ═══════════════════════ 3. New-since-last-update queue ═══════════════════════ */
function UpdateQueue({ projectId, queue }) {
  const records = Array.isArray(queue.records) ? queue.records : [];
  const total = queue.totalPending != null ? queue.totalPending : records.length;
  const screenHref = `/app/project/${encodeURIComponent(projectId)}?tab=screening`;
  return (
    <Card title="New since last update" icon="filter"
      desc="Records found by living-review runs that no reviewer has decided yet, ordered by AI priority.">
      {records.length === 0 ? (
        <EmptyState icon="filter" title="No unscreened update records.">
          When a scheduled search finds new studies, they appear here — pre-scored by this project's model —
          ready to screen.
        </EmptyState>
      ) : (
        <>
          <div style={{ fontSize: 13, color: C.txt2, marginBottom: 10 }}>
            <strong>{total.toLocaleString()}</strong> record{total === 1 ? '' : 's'} waiting to be screened.
            <span style={{ color: C.muted }}> Pre-scored by the current project model — update-run predictions.</span>
          </div>
          <div style={{ overflowX: 'auto', border: `1px solid ${C.brd}`, borderRadius: 10 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={qTh}>Study</th>
                  <th style={{ ...qTh, textAlign: 'center', width: 120 }}>AI score</th>
                  <th style={{ ...qTh, textAlign: 'center', width: 120 }}>Prediction</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.recordId} style={{ borderTop: `1px solid ${C.brd}` }}>
                    <td style={qTd}>
                      <div style={{ color: C.txt, fontWeight: 600 }}>{r.title || 'Untitled record'}</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                        {[r.year, r.journal].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </td>
                    <td style={{ ...qTd, textAlign: 'center' }}><AiScoreBadge ai={r.ai} /></td>
                    <td style={{ ...qTd, textAlign: 'center' }}><PredictionChip ai={r.ai} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <a href={screenHref} style={{ ...btnLinkStyle }}>Screen these records</a>
          </div>
        </>
      )}
    </Card>
  );
}

function AiScoreBadge({ ai }) {
  if (!ai) return <span style={{ fontSize: 11, color: C.dim }}>—</span>;
  const pct = ai.calibratedProba != null ? Math.round(ai.calibratedProba * 100)
    : ai.score != null ? Math.round(ai.score * 100) : null;
  const tone = pct == null ? C.muted : pct >= 66 ? C.grn : pct >= 33 ? C.yel : C.red;
  return (
    <span style={{ ...pill(tone), background: themeAlpha(tone, '14'), border: `1px solid ${themeAlpha(tone, '30')}`, fontFamily: "'IBM Plex Mono',monospace" }}>
      {pct == null ? '—' : `${pct}%`}
    </span>
  );
}

function PredictionChip({ ai }) {
  if (!ai || !ai.prediction) return <span style={{ fontSize: 11, color: C.dim }}>Unscored</span>;
  const p = String(ai.prediction).toLowerCase();
  const tone = p.includes('include') ? C.grn : p.includes('exclude') ? C.red : C.yel;
  return <span style={{ ...pill(tone), background: themeAlpha(tone, '14'), border: `1px solid ${themeAlpha(tone, '30')}` }}>{ai.prediction}</span>;
}

/* ═══════════════════════════ 4. Snapshots ═══════════════════════════ */
function Snapshots({ projectId, snapshots, canManage, onChanged }) {
  const [view, setView] = useState(null);      // snapshot detail modal payload
  const [creating, setCreating] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [selA, setSelA] = useState('');
  const [selB, setSelB] = useState('');
  const [compare, setCompare] = useState(null); // { a, b, diff }
  const [compareErr, setCompareErr] = useState('');
  const [label, setLabel] = useState('');
  const [showLabel, setShowLabel] = useState(false);

  const createSnapshot = async () => {
    setCreating(true);
    try { await livingApi.createSnapshot(projectId, { label: label.trim() || undefined }); setLabel(''); setShowLabel(false); await onChanged(); }
    catch { /* ignore */ }
    finally { setCreating(false); }
  };

  const openSnapshot = async (id) => {
    try { const d = await livingApi.getSnapshot(projectId, id); setView(d); } catch { /* ignore */ }
  };

  const runCompare = async () => {
    setCompareErr('');
    if (!selA || !selB || selA === selB) { setCompareErr('Pick two different snapshots to compare.'); return; }
    // The API expects a = older; order by createdAt using the list.
    const idx = Object.fromEntries(snapshots.map((s, i) => [s.id, i]));
    const [older, newer] = idx[selA] > idx[selB] ? [selA, selB] : [selB, selA]; // list is newest-first
    try { const d = await livingApi.compareSnapshots(projectId, older, newer); setCompare(d); }
    catch (e) { setCompareErr(e.message || 'Comparison failed.'); }
  };

  return (
    <Card title="Snapshots" icon="clock"
      desc="Reproducible summaries of the whole review at a point in time — PRISMA counts, screening progress, meta-analysis results, and the model version. Compare two to see what changed."
      right={(
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={() => { setCompareMode((v) => !v); setCompare(null); setCompareErr(''); }} disabled={snapshots.length < 2}>
            {compareMode ? 'Close compare' : 'Compare'}
          </Btn>
          {canManage && (showLabel
            ? <Btn onClick={createSnapshot} busy={creating}>Save snapshot</Btn>
            : <Btn onClick={() => setShowLabel(true)}>Create snapshot</Btn>)}
        </div>
      )}>
      {showLabel && canManage && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Optional label (e.g. 2026 Q3 update)" style={{ ...inputStyle, maxWidth: 320 }} maxLength={200} />
          <Btn variant="ghost" onClick={() => { setShowLabel(false); setLabel(''); }}>Cancel</Btn>
        </div>
      )}

      {compareMode && (
        <div style={{ border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12, marginBottom: 14, background: C.bg }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={selA} onChange={(e) => setSelA(e.target.value)} style={{ ...inputStyle, maxWidth: 260 }}>
              <option value="">Snapshot A…</option>
              {snapshots.map((s) => <option key={s.id} value={s.id}>{snapshotLabel(s)}</option>)}
            </select>
            <span style={{ color: C.muted }}>vs</span>
            <select value={selB} onChange={(e) => setSelB(e.target.value)} style={{ ...inputStyle, maxWidth: 260 }}>
              <option value="">Snapshot B…</option>
              {snapshots.map((s) => <option key={s.id} value={s.id}>{snapshotLabel(s)}</option>)}
            </select>
            <Btn onClick={runCompare} disabled={!selA || !selB || selA === selB}>Compare</Btn>
          </div>
          {compareErr ? <div style={{ marginTop: 8 }}><Note tone="error">{compareErr}</Note></div> : null}
          {compare ? <CompareResult compare={compare} /> : null}
        </div>
      )}

      {snapshots.length === 0 ? (
        <EmptyState icon="clock" title="No snapshots yet">
          Snapshots capture the state of the review so you can prove what it looked like at any update.
          One is taken automatically after each update run; you can also create one manually.
        </EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {snapshots.map((s) => (
            <button key={s.id} type="button" onClick={() => openSnapshot(s.id)}
              style={{ textAlign: 'left', border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 14px', background: C.bg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ ...pill(s.kind === 'update' ? C.acc : C.muted) }}>{s.kind === 'update' ? 'Update' : 'Manual'}</span>
                <span style={{ fontSize: 13, color: C.txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.label || 'Snapshot'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, fontSize: 11, color: C.muted }}>
                <span>{formatWhen(s.createdAt)}</span>
                {s.createdByName ? <span>· {s.createdByName}</span> : null}
                {s.appVersion ? <span>· v{s.appVersion}</span> : null}
                <span aria-hidden="true" style={{ color: C.dim }}><Icon name="chevronRight" size={14} /></span>
              </div>
            </button>
          ))}
        </div>
      )}

      {view && <SnapshotDetailModal snapshot={view} onClose={() => setView(null)} />}
    </Card>
  );
}

function snapshotLabel(s) {
  return `${s.kind === 'update' ? 'Update' : 'Manual'} · ${s.label || 'Snapshot'} · ${formatWhen(s.createdAt)}`;
}

function SnapshotDetailModal({ snapshot, onClose }) {
  const sm = snapshot.summary || {};
  const pr = sm.prisma || {};
  const sc = sm.screening || {};
  const ma = Array.isArray(sm.ma) ? sm.ma : [];
  return (
    <ModalShell title={snapshot.label || 'Snapshot'} onClose={onClose} wide>
      <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 12 }}>
        {snapshot.kind === 'update' ? 'Automatic update snapshot' : 'Manual snapshot'} · {formatWhen(snapshot.createdAt)}
        {snapshot.createdByName ? ` · ${snapshot.createdByName}` : ''}{snapshot.appVersion ? ` · app v${snapshot.appVersion}` : ''}
      </div>

      <SectionLabel>PRISMA counts</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 16 }}>
        <StatTile label="Identified" value={numOrDash(pr.identified)} />
        <StatTile label="Duplicates removed" value={numOrDash(pr.duplicatesRemoved)} />
        <StatTile label="Screened" value={numOrDash(pr.screened)} />
        <StatTile label="Full-text" value={numOrDash(pr.fullTextAssessed)} />
        <StatTile label="Included" value={numOrDash(pr.included)} tone="green" />
      </div>

      <SectionLabel>Screening</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 16 }}>
        <StatTile label="Total records" value={numOrDash(sc.total)} />
        <StatTile label="Decided" value={numOrDash(sc.decided)} />
        <StatTile label="Included (k)" value={numOrDash(sc.includedK)} tone="accent" />
      </div>

      <SectionLabel>Meta-analysis results</SectionLabel>
      {ma.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 12 }}>No pooled outcomes in this snapshot.</div>
      ) : (
        <div style={{ overflowX: 'auto', border: `1px solid ${C.brd}`, borderRadius: 10, marginBottom: 8 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={qTh}>Outcome</th>
                <th style={{ ...qTh, textAlign: 'center' }}>k</th>
                <th style={{ ...qTh, textAlign: 'center' }}>Effect (95% CI)</th>
                <th style={{ ...qTh, textAlign: 'center' }}>I²</th>
                <th style={{ ...qTh, textAlign: 'center' }}>Method</th>
              </tr>
            </thead>
            <tbody>
              {ma.map((m, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${C.brd}` }}>
                  <td style={qTd}>{m.outcome || 'Primary'}{m.timepoint ? ` · ${m.timepoint}` : ''}</td>
                  <td style={{ ...qTd, textAlign: 'center' }}>{m.k}</td>
                  <td style={{ ...qTd, textAlign: 'center', fontFamily: "'IBM Plex Mono',monospace" }}>
                    {fmt3(m.es)} ({fmt3(m.lo)}, {fmt3(m.hi)})
                  </td>
                  <td style={{ ...qTd, textAlign: 'center' }}>{m.i2 != null ? `${Math.round(m.i2)}%` : '—'}</td>
                  <td style={{ ...qTd, textAlign: 'center' }}>{m.method || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 10.5, color: C.dim, marginBottom: 14 }}>
        Effect sizes are shown on the analysis scale (3 decimal places). Ratio measures are on the log scale.
      </div>

      <SectionLabel>Provenance</SectionLabel>
      <div style={{ fontSize: 12, color: C.txt2, lineHeight: 1.7 }}>
        Model config: <strong>{(sm.model && (sm.model.engineConfigVersion || sm.model.runId)) || 'n/a'}</strong>
        {sm.searches && sm.searches.length ? (
          <div style={{ marginTop: 6 }}>
            Searches at this snapshot: {sm.searches.map((s) => s.name).join(', ')}
          </div>
        ) : null}
      </div>
    </ModalShell>
  );
}

function CompareResult({ compare }) {
  const diff = compare.diff || {};
  const prismaEntries = Object.entries(diff.prisma || {});
  const maShifts = Array.isArray(diff.maShifts) ? diff.maShifts : [];
  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${C.brd}`, paddingTop: 12 }}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
        {formatWhen(compare.a?.createdAt)} → {formatWhen(compare.b?.createdAt)}
      </div>
      {diff.summaryText ? <Note tone="info">{diff.summaryText}</Note> : null}

      {prismaEntries.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <SectionLabel>Changed PRISMA counts</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {prismaEntries.map(([k, v]) => (
              <div key={k} style={{ fontSize: 12.5, color: C.txt2 }}>
                <span style={{ color: C.txt, fontWeight: 600, textTransform: 'capitalize' }}>{k.replace(/([A-Z])/g, ' $1')}</span>: {v.prev} → {v.curr}
                <span style={{ color: v.delta > 0 ? C.grn : C.red, marginLeft: 6 }}>({v.delta > 0 ? '+' : ''}{v.delta})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {maShifts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <SectionLabel>Meta-analysis shifts</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {maShifts.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <StatusPill state={s.severity === 'major' ? 'failed' : s.severity === 'notable' ? 'partial' : 'queued'}>
                  {s.severity === 'major' ? 'Major' : s.severity === 'notable' ? 'Notable' : 'Info'}
                </StatusPill>
                <span style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.5 }}>{s.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {diff.modelChanged && (
        <div style={{ marginTop: 12 }}>
          <Note tone="warn">The scoring model version changed between these snapshots — differences may partly reflect the model, not new evidence.</Note>
        </div>
      )}

      {prismaEntries.length === 0 && maShifts.length === 0 && !diff.modelChanged && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: C.muted }}>No material changes between these snapshots.</div>
      )}
    </div>
  );
}

/* ═══════════════════════════ 5. PRISMA panel ═══════════════════════════ */
function PrismaPanel({ projectId, searches }) {
  const [summary, setSummary] = useState(undefined); // undefined = loading; null = error
  useEffect(() => {
    let alive = true;
    livingApi.preview(projectId)
      .then((d) => { if (alive) setSummary(d && d.summary ? d.summary : null); })
      .catch(() => { if (alive) setSummary(null); });
    return () => { alive = false; };
  }, [projectId]);

  const pr = (summary && summary.prisma) || {};
  const updateRows = (searches || []).filter((s) => s.lastRunAt);

  return (
    <Card title="PRISMA — cumulative counts" icon="flow"
      desc="Original review vs updates: cumulative counts from live screening data.">
      {summary === undefined ? (
        <div style={{ fontSize: 12.5, color: C.muted }}>Loading counts…</div>
      ) : summary === null ? (
        <Note tone="warn">Cumulative counts are unavailable right now.</Note>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 16 }}>
            <StatTile label="Identified" value={numOrDash(pr.identified)} />
            <StatTile label="Duplicates removed" value={numOrDash(pr.duplicatesRemoved)} />
            <StatTile label="Screened" value={numOrDash(pr.screened)} />
            <StatTile label="Full-text" value={numOrDash(pr.fullTextAssessed)} />
            <StatTile label="Included" value={numOrDash(pr.included)} tone="green" />
          </div>
          <SectionLabel>Update runs</SectionLabel>
          {updateRows.length === 0 ? (
            <div style={{ fontSize: 12.5, color: C.muted }}>No update runs yet — cumulative counts reflect the original review.</div>
          ) : (
            <div style={{ overflowX: 'auto', border: `1px solid ${C.brd}`, borderRadius: 10 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={qTh}>Search</th>
                    <th style={{ ...qTh, textAlign: 'center' }}>Retrieved</th>
                    <th style={{ ...qTh, textAlign: 'center' }}>New</th>
                    <th style={{ ...qTh, textAlign: 'center' }}>Run</th>
                  </tr>
                </thead>
                <tbody>
                  {updateRows.map((s) => (
                    <tr key={s.id} style={{ borderTop: `1px solid ${C.brd}` }}>
                      <td style={qTd}>{s.name}</td>
                      <td style={{ ...qTd, textAlign: 'center' }}>{numOrDash(s.lastResultCount)}</td>
                      <td style={{ ...qTd, textAlign: 'center' }}>{numOrDash(s.lastNewCount)}</td>
                      <td style={{ ...qTd, textAlign: 'center' }}>{formatWhen(s.lastRunAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ─────────────────────────── shared small pieces ─────────────────────────── */
function ModalShell({ title, children, onClose, wide }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', zIndex: 1000, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 14, padding: 22, width: '100%', maxWidth: wide ? 720 : 520, boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: C.txt }}>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.muted, display: 'inline-flex', padding: 4 }}>
            <Icon name="x" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>{label}</span>
      {children}
    </label>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase', margin: '0 0 8px' }}>{children}</div>;
}

const pill = (color) => ({
  display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: 99,
  fontSize: 10, fontWeight: 700, letterSpacing: 0.3, whiteSpace: 'nowrap',
  color, background: themeAlpha(color, '14'), border: `1px solid ${themeAlpha(color, '30')}`,
});

const inputStyle = {
  background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8,
  padding: '8px 12px', color: C.txt, fontSize: 12.5, outline: 'none', width: '100%', boxSizing: 'border-box',
  fontFamily: "'IBM Plex Sans',sans-serif",
};

const btnLinkStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none',
  padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
  background: `linear-gradient(145deg,${C.acc},${C.acc2})`, color: 'var(--t-acc-text)',
};

const qTh = { padding: '9px 14px', background: C.bg, color: C.muted, fontWeight: 700, fontSize: 10, letterSpacing: 0.7, textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' };
const qTd = { padding: '9px 14px', color: C.txt2, verticalAlign: 'top' };

function numOrDash(v) { return v == null ? '—' : Number(v).toLocaleString(); }
function fmt3(v) { return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : '—'; }
