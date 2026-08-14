/**
 * features/prisma/PrismaInspector.jsx — 116.md §8-§12. The interactive inspection
 * layer below the PRISMA diagram.
 *
 * Clicking a box shows: what the count REPRESENTS (§9.3), the aggregate breakdown
 * the flow already carries (§12), and a PAGINATED record list served by
 * GET /prisma/box/:boxId/records (§11 — the client never receives, filters or
 * renders a 50k-row set; search + facet filters are applied server-side).
 *
 * Metadata edits (§10) go through PATCH /records/:rid — the screening domain
 * endpoint with validation + audit — and refresh the flow so the counts on screen
 * are the counts after the edit. Decision-state changes are NEVER inline edits:
 * the existing finalize / revert-final-review domain actions are surfaced as
 * intentional, confirmed buttons.
 *
 * Undo: each metadata edit registers with the project HistoryContext under the
 * 'prisma.recordEdit' executor (108.md contract — refuse when stale rather than
 * clobber; the executor is the tail of the same PATCH path). 116.md §10 (r2): the
 * staleness check is the SERVER's compare-and-set, because a client cannot honestly
 * make it — this panel writes its own patch into `rows` optimistically, so
 * re-validating the entry against `rows` compared the client's guess with itself and
 * always passed. `expect` now travels with the PATCH and a collaborator's newer edit
 * comes back as 409 → an honest refusal with a note. The `record.updated` poke keeps
 * the loaded rows live, so the refusal is rare rather than routine.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { C, btnS, inp } from '../../frontend/workspace/ui/styles.js';
import { boxMeta, DISPOSITION_LABELS } from '../../research-engine/prisma/index.js';
import { useProjectHistory } from '../../frontend/history/HistoryContext.jsx';
import {
  BOX_EXPLANATIONS, facetsForBox, FACET_LABELS,
  identificationSourceOptions, validateRecordPatch, buildBoxRecordsQuery,
  acceptBoxResponse, affectsBoxMembership, canRevertFinal,
} from './inspectorModel.js';

const PAGE_LIMIT = 50;

const api = (screenProjectId, path, opts = {}) => fetch(
  `/api/screening/projects/${encodeURIComponent(screenProjectId)}${path}`,
  {
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  },
);

/* ── the §12 aggregate breakdown (kept from the 103 inspector) ─────────────── */
export function boxBreakdown(flow, boxId) {
  if (!flow) return [];
  if (boxId === 'removed_before_screening') return (flow.removedBreakdown && flow.removedBreakdown.byStage) || [];
  if (boxId === 'excluded_full_text_db') return (flow.exclusionReasonsByArm && flow.exclusionReasonsByArm.db) || [];
  if (boxId === 'excluded_full_text_other') return (flow.exclusionReasonsByArm && flow.exclusionReasonsByArm.other) || [];
  if (boxId === 'not_retrieved_db' || boxId === 'not_retrieved_other') return flow.notRetrievedReasons || [];
  if (boxId === 'identified_db') return (flow.sources && flow.sources.db) || [];
  if (boxId === 'identified_other') {
    // 116.md §13 (r2) — PRISMA 2020 gives this column no removal box and no
    // screening box, so the removals and title/abstract decisions its records went
    // through cannot be DRAWN. They are real work, they are in the project totals,
    // and this is where a researcher who clicks the number can see them.
    const oa = flow.otherArm || null;
    const rows = ((flow.sources && flow.sources.other) || []).slice();
    if (!oa) return rows;
    const add = (key, label, n) => { if (n > 0) rows.push({ key, label, n }); };
    add('other_removed', 'Removed before screening (no box in this column)', (oa.removed || {}).n || 0);
    add('other_excluded', 'Excluded at title/abstract (no box in this column)', (oa.excludedScreening || {}).n || 0);
    add('other_awaiting', 'Awaiting title/abstract screening', (oa.awaitingScreening || {}).n || 0);
    return rows;
  }
  return [];
}

/* ── one record row: metadata line + editor + domain actions ───────────────── */
function RecordRow({ row, ctx, onSave, onFinalize, onRevert }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  // 116.md §10 (r2) — the finalize/revert buttons render only when NOT editing, and
  // `err` is rendered inside the editor block, so a failed domain action previously
  // had literally nowhere to appear: the click did nothing, said nothing, and the
  // reviewer reasonably concluded it had not registered. This is that missing slot.
  const [actionErr, setActionErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const { blind, canEdit, canFinalize } = ctx;
  const isRejected = row.finalStatus === 'rejected';
  const isFinalized = row.finalStatus === 'accepted' || row.finalStatus === 'rejected';
  const canDecide = canFinalize && row.currentStage === 'full_text' && !isFinalized;
  // Only an ACCEPTED record can be reverted — the server says so, and rendering the
  // button on a rejected one guaranteed a 400 (116.md §10 r2).
  const showRevert = canRevertFinal(row, canFinalize);

  const runAction = async (fn) => {
    setBusy(true);
    setActionErr(null);
    const message = await fn();
    setBusy(false);
    if (message) setActionErr(message);
  };

  const startEdit = () => {
    setDraft({
      title: row.title || '', authors: row.authors || '', year: row.year || '',
      journal: row.journal || '', doi: row.doi || '', pmid: row.pmid || '',
      sourceDb: row.sourceDb || '',
      identificationSource: row.identificationSource || '',
      sourceDetail: row.sourceDetail || '',
      ...(isRejected ? { rejectedReason: row.rejectedReason || '' } : {}),
    });
    setErr(null);
    setEditing(true);
  };

  const save = async () => {
    // Only send what actually changed — the audit trail then names real edits.
    const patch = {};
    for (const [k, v] of Object.entries(draft)) {
      if (String(v) !== String(row[k] == null ? '' : row[k])) patch[k] = v;
    }
    if (!Object.keys(patch).length) { setEditing(false); return; }
    const check = validateRecordPatch(patch);
    if (!check.ok) { setErr(Object.values(check.errors)[0]); return; }
    setSaving(true);
    setErr(null);
    // 116.md §10 (r2) — the server's own message ("year must be a 4-digit year",
    // "Another member changed this record…") reaches the user instead of a generic
    // permissions line that is usually wrong about the cause.
    const problem = await onSave(row, check.clean);
    setSaving(false);
    if (!problem) setEditing(false);
    else setErr(problem);
  };

  const metaLine = [
    row.authors, row.year, blind ? null : row.journal,
    row.effectiveSource || row.sourceDb,
    row.doi ? `DOI ${row.doi}` : null,
    row.pmid ? `PMID ${row.pmid}` : null,
  ].filter(Boolean).join(' · ');
  const statusLine = [
    row.importBatch ? `Imported: ${row.importBatch.filename || row.importBatch.format || 'batch'}` : null,
    row.importedAt ? String(row.importedAt).slice(0, 10) : null,
    row.isDuplicate ? (row.isPrimary ? 'Duplicate group (kept copy)' : 'Duplicate (removed)') : null,
    row.dispositionLabel || (row.disposition ? DISPOSITION_LABELS[row.disposition] : null),
    row.notRetrievedReason ? `Not retrieved: ${row.notRetrievedReason}` : null,
    row.exclusionReason ? `Reason: ${row.exclusionReason}` : null,
    row.sourceDetail ? `Detail: ${row.sourceDetail}` : null,
  ].filter(Boolean).join(' · ');

  const field = (label, key, width = '100%') => (
    <label style={{ fontSize: 10.5, color: C.muted, display: 'block' }}>
      {label}
      <input
        value={draft[key] == null ? '' : draft[key]}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        data-testid={`stitch-prisma-edit-${key}`}
        style={{ ...inp, width, fontSize: 11.5, marginTop: 2 }}
      />
    </label>
  );

  return (
    <div data-testid="stitch-prisma-record-row" style={{
      fontSize: 11.5, padding: '7px 0', borderBottom: `1px solid ${C.brd}`, color: C.txt,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{row.title || row.id}</div>
          {metaLine && <div style={{ color: C.muted, fontSize: 10.5, marginTop: 1 }}>{metaLine}</div>}
          {statusLine && <div style={{ color: C.dim, fontSize: 10, marginTop: 1 }}>{statusLine}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {canEdit && !editing && (
            <button type="button" onClick={startEdit} data-testid="stitch-prisma-record-edit"
              style={{ ...btnS('ghost'), padding: '2px 8px', fontSize: 10.5 }}>
              Edit
            </button>
          )}
        </div>
      </div>

      {editing && draft && (
        <div data-testid="stitch-prisma-record-editor" style={{
          marginTop: 6, padding: 8, border: `1px solid ${C.brd}`, borderRadius: 8,
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: C.bg,
        }}>
          <div style={{ gridColumn: '1 / -1' }}>{field('Title', 'title')}</div>
          {/* Blind mode hides author/journal info from non-leaders — no editing
              what you cannot see (the server refuses these fields too). */}
          {!blind && field('Authors', 'authors')}
          {field('Year', 'year')}
          {!blind && field('Journal', 'journal')}
          {field('DOI', 'doi')}
          {field('PMID', 'pmid')}
          {field('Source database', 'sourceDb')}
          <label style={{ fontSize: 10.5, color: C.muted, display: 'block' }}>
            Identified via (PRISMA)
            <select
              value={draft.identificationSource || ''}
              onChange={(e) => setDraft((d) => ({ ...d, identificationSource: e.target.value }))}
              data-testid="stitch-prisma-edit-identificationSource"
              style={{ ...inp, width: '100%', fontSize: 11.5, marginTop: 2 }}
            >
              {identificationSourceOptions().map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          {field('Source detail (free text)', 'sourceDetail')}
          {isRejected && <div style={{ gridColumn: '1 / -1' }}>{field('Exclusion reason', 'rejectedReason')}</div>}
          {err && (
            <div style={{ gridColumn: '1 / -1', color: '#8a1c1c', fontSize: 11 }}>{err}</div>
          )}
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
            <button type="button" onClick={save} disabled={saving}
              data-testid="stitch-prisma-record-save"
              style={{ ...btnS('primary'), padding: '3px 12px', fontSize: 11 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(false)}
              style={{ ...btnS('ghost'), padding: '3px 10px', fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* §10 — decision-state changes are DOMAIN ACTIONS, never inline edits. */}
      {(canDecide || showRevert) && !editing && (
        <div style={{ marginTop: 5, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {canDecide && !rejecting && (
            <>
              <button type="button" data-testid="stitch-prisma-finalize-accept" disabled={busy}
                onClick={() => runAction(() => onFinalize(row, 'accept', ''))}
                style={{ ...btnS('ghost'), padding: '2px 8px', fontSize: 10.5, color: C.grn }}>
                Finalize: include
              </button>
              <button type="button" data-testid="stitch-prisma-finalize-reject" disabled={busy}
                onClick={() => setRejecting(true)}
                style={{ ...btnS('ghost'), padding: '2px 8px', fontSize: 10.5, color: C.red }}>
                Finalize: exclude…
              </button>
            </>
          )}
          {canDecide && rejecting && (
            <>
              <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Exclusion reason"
                data-testid="stitch-prisma-reject-reason"
                style={{ ...inp, fontSize: 11, width: 220 }} />
              <button type="button" disabled={busy}
                onClick={() => { setRejecting(false); runAction(() => onFinalize(row, 'reject', rejectReason)); }}
                style={{ ...btnS('primary'), padding: '2px 10px', fontSize: 10.5 }}>
                Confirm exclusion
              </button>
              <button type="button" onClick={() => setRejecting(false)}
                style={{ ...btnS('ghost'), padding: '2px 8px', fontSize: 10.5 }}>
                Cancel
              </button>
            </>
          )}
          {showRevert && (
            <button type="button" data-testid="stitch-prisma-revert-final" disabled={busy}
              onClick={() => runAction(() => onRevert(row))}
              style={{ ...btnS('ghost'), padding: '2px 8px', fontSize: 10.5 }}>
              Revert final decision…
            </button>
          )}
        </div>
      )}
      {/* Outside the editor block on purpose — this is where a failed finalize /
          revert can actually be seen (116.md §10 r2). */}
      {actionErr && !editing && (
        <div data-testid="stitch-prisma-action-error"
          style={{ marginTop: 4, color: '#8a1c1c', fontSize: 11 }}>{actionErr}</div>
      )}
    </div>
  );
}

/* ════════════ the inspector panel ════════════ */

/**
 * @param {string} boxId            the selected PRISMA box
 * @param {object} flow             slim derivePrismaFlow output (counts + breakdowns)
 * @param {string} screenProjectId  the ScreenProject id (record lists + edits)
 * @param {function} onClose
 * @param {function} onChanged      called after any mutation → caller refetches the flow
 */
export function PrismaInspector({ boxId, flow, screenProjectId, onClose, onChanged, syncKey }) {
  const meta = boxMeta(boxId);
  const box = flow && flow.boxes && flow.boxes[boxId];

  const [rows, setRows] = useState([]);
  const [page, setPage] = useState({ total: 0, uninspectable: 0, nextCursor: null, facets: null, canEdit: false, canFinalize: false, blindMode: false, isLeader: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState({ q: '', source: '', status: '', reason: '', retrieval: '' });

  const rowsRef = useRef(rows); rowsRef.current = rows;
  const onChangedRef = useRef(onChanged); onChangedRef.current = onChanged;

  const history = useProjectHistory();
  const historyRef = useRef(history); historyRef.current = history;
  const registerExecutor = history.registerExecutor;

  /**
   * PATCH one record → { record } on success, or { error, conflict } on failure.
   *
   * 116.md §10 (r2) — two changes, both load-bearing:
   *  - `expect` is sent, so the SERVER compares the pre-image it actually holds and
   *    answers 409 when a collaborator got there first. A client-side precondition
   *    can never be sound here: `saveEdit` writes its own patch into `rows` before
   *    recording the undo entry, so `row[k] === expect[k]` by construction and the
   *    check the 108.md contract relies on was vacuous.
   *  - the server's message is returned rather than discarded, so validation text
   *    reaches the user instead of a generic "check your permissions".
   */
  const patchRecord = useCallback(async (recordId, patch, expect) => {
    if (!screenProjectId) return { error: 'No screening project is linked.' };
    try {
      const body = expect && Object.keys(expect).length ? { ...patch, expect } : patch;
      const res = await api(screenProjectId, `/records/${encodeURIComponent(recordId)}`, {
        method: 'PATCH', body,
      });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (res.ok) return { record: (data && data.record) || null };
      if (res.status === 409) {
        return {
          conflict: true,
          record: (data && data.record) || null,
          error: (data && data.message)
            || 'Another member changed this record — reload to see their edit.',
        };
      }
      return { error: (data && (data.error || data.message)) || 'Could not save — check your permissions and try again.' };
    } catch {
      return { error: 'Could not reach the server — your edit was not saved.' };
    }
  }, [screenProjectId]);

  const applyLocal = useCallback((recordId, patch) => {
    setRows((rs) => rs.map((r) => (r.id === recordId ? { ...r, ...patch } : r)));
  }, []);

  /** Merge the SERVER's normalized record back into the row, not the client's guess. */
  const applyServer = useCallback((recordId, record) => {
    if (!record) return;
    setRows((rs) => rs.map((r) => (r.id === recordId ? { ...r, ...record } : r)));
  }, []);

  /* ── undo/redo (108.md executor contract; scope 'prisma' is relational) ──── */
  const reloadRef = useRef(null);
  useEffect(() => registerExecutor('prisma.recordEdit', async (op) => {
    // 116.md §10 (r2) — the precondition is the SERVER's. `op.expect` travels with
    // the request and the write is refused when the stored pre-image differs, so "a
    // collaborator changed it since" is detected where the truth lives rather than
    // against this client's own optimistic copy (which equalled `expect` by
    // construction and therefore always passed).
    //
    // Note this no longer requires the row to still be on screen: an edit to
    // `identificationSource` moves the record out of the listed box, and refusing to
    // undo the very edit that did so would be a worse contract than the one the
    // compare-and-set now guarantees.
    const res = await patchRecord(op.recordId, op.patch, op.expect);
    if (res.conflict) {
      applyServer(op.recordId, res.record);
      return {
        ok: false,
        reason: 'refused',
        detail: 'A collaborator changed this record — its current values are shown; undo was not applied.',
      };
    }
    if (res.error) return { ok: false, reason: 'failed', detail: res.error };
    if (affectsBoxMembership(op.patch) && reloadRef.current) {
      reloadRef.current();
    } else {
      // Reconcile with what the server actually stored (normalized DOI, capped
      // text…), so the next undo/redo validates against reality.
      if (res.record) applyServer(op.recordId, res.record);
      else applyLocal(op.recordId, op.patch);
      if (onChangedRef.current) onChangedRef.current();
    }
    return true;
  }), [registerExecutor, patchRecord, applyLocal, applyServer]);

  /* ── record list loading ───────────────────────────────────────────────────
   *
   * 116.md §11 (r2) — REQUEST GENERATION GUARD. `load` is fired by three different
   * paths (box change, facet/search change, Load more) and used to write its result
   * unconditionally, so whichever response resolved LAST won. Switching from a large
   * box to a small one therefore painted the large box's records, cursor, facets and
   * permissions under the small box's header — and the header is rendered from the
   * `boxId`/`flow` props, so it stayed correct while the list beneath it did not.
   * The panel's whole contract ("this count IS this set") failed silently, and
   * "Load more" then appended the wrong box's next page.
   *
   * One counter covers all three paths: a response is discarded unless it belongs to
   * the newest request. The payload's own `boxId` is checked too, belt and braces.
   */
  const reqRef = useRef(0);
  const load = useCallback(async (filters, cursor) => {
    if (!screenProjectId || !boxId) return;
    const seq = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const qs = buildBoxRecordsQuery({ ...filters, cursor, limit: PAGE_LIMIT });
      const res = await api(screenProjectId, `/prisma/box/${encodeURIComponent(boxId)}/records${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (!acceptBoxResponse({ seq, currentSeq: reqRef.current, payloadBoxId: d.boxId, boxId })) return;
      setRows((prev) => (cursor ? prev.concat(d.records || []) : (d.records || [])));
      setPage((p) => ({
        total: d.total ?? 0,
        uninspectable: d.uninspectable ?? 0,
        nextCursor: d.nextCursor ?? null,
        facets: d.facets || (cursor ? p.facets : null),
        canEdit: !!d.canEdit,
        canFinalize: !!d.canFinalize,
        blindMode: !!d.blindMode,
        isLeader: !!d.isLeader,
      }));
    } catch (e) {
      if (seq !== reqRef.current) return;
      setError((e && e.message) || 'Could not load the records behind this box.');
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [screenProjectId, boxId]);

  useEffect(() => {
    setRows([]);
    setQ('');
    const fresh = { q: '', source: '', status: '', reason: '', retrieval: '' };
    setApplied(fresh);
    load(fresh, '');
  }, [load]);

  const applyFilters = (patch) => {
    const next = { ...applied, ...patch };
    setApplied(next);
    setRows([]);
    load(next, '');
  };

  const reload = useCallback(() => {
    setRows([]);
    load(applied, '');
    if (onChangedRef.current) onChangedRef.current();
  }, [load, applied]);
  reloadRef.current = reload;

  /* 116.md §10 (r2) — a collaborator's `record.updated` poke (ids only, no content)
   * refreshes this panel through the authorized endpoint. Without it `rowsRef` never
   * saw anyone else's edit, which is half of why the undo precondition was vacuous;
   * the server's own comment ("open PRISMA tabs refetch the flow") described
   * behaviour nothing implemented. The parent owns the subscription and bumps
   * `syncKey`, so one listener serves the diagram and the open box together. */
  const appliedRef = useRef(applied); appliedRef.current = applied;
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    if (!syncKey) return;
    setRows([]);
    loadRef.current(appliedRef.current, '');
  }, [syncKey]);

  /* ── mutations ───────────────────────────────────────────────────────────── */
  /** @returns {string} '' on success, else the message to show the user. */
  const saveEdit = useCallback(async (row, patch) => {
    const before = {};
    for (const k of Object.keys(patch)) before[k] = row[k] == null ? '' : row[k];
    // The forward save carries its own pre-image, so two people editing the same
    // field at once produce a refusal rather than a silent overwrite.
    const res = await patchRecord(row.id, patch, before);
    if (res.conflict) {
      applyServer(row.id, res.record);
      return res.error;
    }
    if (res.error) return res.error;
    // One semantic history entry per save (never a snapshot) — the inverse goes
    // through the SAME PATCH endpoint (108.md: executors are the tail of the
    // forward write path).
    historyRef.current.record({
      kind: 'prisma.recordEdit',
      label: `Edit record — ${(row.title || row.id).slice(0, 60)}`,
      entityKey: `prisma:record:${row.id}`,
      undoOp: { recordId: row.id, patch: before, expect: patch },
      redoOp: { recordId: row.id, patch, expect: before },
    });
    // 116.md §10 (r2) — an edit to `identificationSource`/`sourceDb` can move the
    // record OUT of this box, which renumbers every later candidate and makes the
    // held offset cursor skip a record on the next "Load more". Re-load in that
    // case, exactly as finalize/revert already do; keep the in-place fast path for
    // bibliographic fields, which cannot change membership.
    if (affectsBoxMembership(patch)) {
      reload();
    } else {
      if (res.record) applyServer(row.id, res.record); else applyLocal(row.id, patch);
      if (onChangedRef.current) onChangedRef.current();
    }
    return '';
  }, [patchRecord, applyLocal, applyServer, reload]);

  /** Domain actions return '' on success, else the server's own message (§10 r2). */
  const domainAction = useCallback(async (row, path, body) => {
    try {
      const res = await api(screenProjectId, `/records/${encodeURIComponent(row.id)}${path}`, {
        method: 'POST', body,
      });
      if (res.ok) { reload(); return ''; }
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      return (data && (data.error || data.message)) || `The server refused this action (HTTP ${res.status}).`;
    } catch {
      return 'Could not reach the server — nothing was changed.';
    }
  }, [screenProjectId, reload]);

  const finalize = useCallback(async (row, decision, reason) => {
    if (decision === 'accept'
      && !window.confirm('Finalize this report as INCLUDED? It will be handed to Data Extraction.')) return '';
    return domainAction(row, '/finalize', { decision, reason: reason || '' });
  }, [domainAction]);

  const revert = useCallback(async (row) => {
    if (!window.confirm('Revert this final decision? The record returns to full-text review; an accepted study is withdrawn from Data Extraction.')) return '';
    return domainAction(row, '/final-review/revert', {});
  }, [domainAction]);

  if (!box) return null;

  const breakdown = boxBreakdown(flow, boxId);
  const facets = facetsForBox(boxId);
  const facetOptions = page.facets || {};
  const ctx = { blind: page.blindMode && !page.isLeader, canEdit: page.canEdit, canFinalize: page.canFinalize };

  const select = (facetKey) => {
    const opts = facetOptions[facetKey] || [];
    if (!opts.length) return null;
    return (
      <select
        key={facetKey}
        value={applied[facetKey]}
        onChange={(e) => applyFilters({ [facetKey]: e.target.value })}
        aria-label={FACET_LABELS[facetKey]}
        data-testid={`stitch-prisma-facet-${facetKey}`}
        style={{ ...inp, fontSize: 11, width: 'auto', maxWidth: 190 }}
      >
        <option value="">{FACET_LABELS[facetKey]}: all</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label} ({o.n})</option>
        ))}
      </select>
    );
  };

  return (
    <div
      data-testid="stitch-prisma-inspector"
      role="dialog"
      aria-label={`Records behind ${meta ? meta.label : boxId}`}
      style={{
        border: `1px solid ${C.brd}`, borderRadius: 12, background: C.card,
        padding: 14, marginTop: 12, fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.txt }}>
            {meta ? meta.label.replace(/[*:]+$/, '') : boxId}
            <span style={{ marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace", color: C.txt2 }}>
              n = {box.n}
            </span>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {meta ? `Counts ${meta.unit}. ` : ''}
            {BOX_EXPLANATIONS[boxId] || 'Every number here is the size of a record set — this is that set.'}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close"
          data-testid="stitch-prisma-inspector-close"
          style={{ ...btnS('ghost'), padding: '3px 9px', fontSize: 11, border: `1px solid ${C.brd}` }}>
          Close
        </button>
      </div>

      {breakdown.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{
            fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
            color: C.muted, fontWeight: 700, marginBottom: 4,
          }}>
            Breakdown
          </div>
          {breakdown.map((r) => (
            <div key={r.key} style={{
              display: 'flex', justifyContent: 'space-between', gap: 10,
              fontSize: 12, padding: '3px 0', borderBottom: `1px solid ${C.brd}`,
            }}>
              <span style={{ color: C.txt2, minWidth: 0 }}>{r.label}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.txt }}>{r.n}</span>
            </div>
          ))}
        </div>
      )}

      {page.uninspectable > 0 && (
        <div style={{
          fontSize: 11, color: C.txt2, background: 'rgba(214,158,46,0.10)',
          border: '1px solid rgba(214,158,46,0.4)', borderRadius: 8, padding: '7px 9px', marginBottom: 10,
        }}>
          {page.uninspectable} of these were discarded during import before being stored as
          records, so they are counted but cannot be listed individually.
        </div>
      )}

      {/* §12 — search + per-box facet filters. Server-side, so a 50k box stays fast. */}
      <form
        onSubmit={(e) => { e.preventDefault(); applyFilters({ q }); }}
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title / DOI / PMID"
          aria-label="Search records"
          data-testid="stitch-prisma-search"
          style={{ ...inp, fontSize: 11.5, flex: '1 1 180px', minWidth: 140 }}
        />
        <button type="submit" style={{ ...btnS('ghost'), padding: '3px 10px', fontSize: 11 }}>
          Search
        </button>
        {facets.map(select)}
      </form>

      <div style={{ maxHeight: 380, overflowY: 'auto' }} data-testid="stitch-prisma-record-list">
        {error && (
          <div style={{ fontSize: 12, color: '#8a1c1c' }}>{error}</div>
        )}
        {!error && rows.length === 0 && !loading && (
          <div style={{ fontSize: 12, color: C.muted }}>
            {page.total === 0 && page.uninspectable > 0
              ? 'No individual records to list for this box.'
              : 'No records match the current filters.'}
          </div>
        )}
        {rows.map((r) => (
          <RecordRow
            key={r.id}
            row={r}
            ctx={ctx}
            onSave={saveEdit}
            onFinalize={finalize}
            onRevert={revert}
          />
        ))}
        {loading && (
          <div style={{ fontSize: 11.5, color: C.muted, padding: '6px 0' }}>Loading records…</div>
        )}
        {!loading && page.nextCursor && (
          <button
            type="button"
            onClick={() => load(applied, page.nextCursor)}
            data-testid="stitch-prisma-load-more"
            style={{ ...btnS('ghost'), marginTop: 8, padding: '4px 12px', fontSize: 11 }}
          >
            Load more ({rows.length} shown)
          </button>
        )}
      </div>
    </div>
  );
}

export default PrismaInspector;
