/**
 * usePdfAnnotations.js — 116.md §71-104 (D7/D8/D9). The client state machine for
 * collaborative PDF annotations: fetch, optimistic mutation, realtime reconcile
 * and undo/redo registration.
 *
 * The hook is INERT unless it is given both a resolvable scope and a document
 * content hash. Every surface that cannot produce one (a session-local blob, a
 * legacy attachment whose bytes vanished from disk) simply gets `enabled:false`
 * back and renders no annotation UI at all — the documented §74 degrade, never a
 * guessed identity.
 *
 * ── OPTIMISTIC UI (§89) ──────────────────────────────────────────────────────
 * A new highlight appears instantly with a client-generated `clientId`, is POSTed
 * asynchronously, and is reconciled from the server's canonical row. A retry
 * (double-click, flaky network, reconnect replay) hits the same idempotency key
 * and returns the SAME row — it can never duplicate a highlight. A failed save is
 * marked failed and dropped from the page with a message; it is never left looking
 * saved.
 *
 * ── REALTIME (§87/§91, D8) ───────────────────────────────────────────────────
 * `annotation.changed` is a POKE — `{type, projectId|metaLabProjectId, docHash}`
 * and nothing else. On a matching poke (and on every SSE unhealthy→healthy
 * transition, which is the reconnect reconcile §91 asks for) the hook fetches the
 * `?since=` DELTA, which includes tombstones so deletions propagate. Merging is
 * idempotent, so duplicate events cannot duplicate highlights. Scroll position,
 * zoom and the PDF bytes are untouched: only this small JSON list changes (§87).
 *
 * ── UNDO (§86, D9) ───────────────────────────────────────────────────────────
 * Entries are recorded into the dedicated `pdf` history scope with semantic
 * inverse ops (create↔delete, recolor, comment edit). Executors re-validate
 * against the CURRENT list and refuse politely when a collaborator moved first —
 * they never roll back local state, they replay through the same API path.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRealtime } from '../hooks/useRealtime.js';
import { useProjectHistory } from '../history/HistoryContext.jsx';
import { SCOPE_PDF } from '../../research-engine/interaction/projectScopes.js';
import { pdfAnnotationApi, annotationBase, ANNOTATION_SCOPE } from './pdfAnnotationApi.js';
import {
  colorFor, indexByPage, mergeServerList, pendingAnnotation,
  upsertByClientId, dropByClientId, markFailed, MAX_COMMENT, createMountGate,
} from './pdfAnnotationModel.js';

/** The history entry kind — one kind, many ops, so one executor covers §86. */
export const PDF_ANNOTATION_KIND = 'pdf.annotation';

const REFUSED = (detail) => ({ ok: false, reason: 'refused', detail });

function newClientId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `an-${crypto.randomUUID()}`;
  } catch { /* fall through */ }
  return `an-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {object} args
 * @param {object|null} args.target  { scope, screenProjectId?, metaLabProjectId? }
 * @param {string} args.docHash      sha256 of the rendered PDF (§73). '' ⇒ inert.
 * @param {string} [args.recordId]   context ref stored with new annotations (§72)
 * @param {string} [args.studyId]    context ref stored with new annotations (§72)
 * @param {string} args.userId       the viewer (drives §81 own-vs-others + §83)
 * @param {string} [args.userName]
 * @param {boolean} [args.enabled=true]
 */
export function usePdfAnnotations({
  target = null, docHash = '', recordId = null, studyId = null,
  userId = '', userName = '', enabled = true,
} = {}) {
  const base = annotationBase(target);
  const active = !!(enabled && base && docHash);

  const [list, setList] = useState([]);
  const [caps, setCaps] = useState({ canCreate: false, canModerate: false });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  /**
   * §81 — who "you" are. Taken from the LIST RESPONSE rather than an auth context:
   * `useAuth()` throws outside its provider, and the viewer is mounted on five
   * surfaces (three of which are SSR-pinned in unit tests). The server already knows
   * the caller, so it answers with the caller's own id — never anyone else's account
   * data (§80). An explicit `userId` prop still wins when a host has one.
   */
  const [viewer, setViewer] = useState({ id: '', name: '' });
  const effUserId = userId || viewer.id;
  const effUserName = userName || viewer.name;

  const listRef = useRef(list); listRef.current = list;
  const sinceRef = useRef('');           // serverTime of the last successful sync
  const chainRef = useRef(Promise.resolve());   // serialize mutations per viewer
  // 116.md §89 — the mount gate every async continuation below checks before it
  // touches state. It MUST be re-armed on mount, not merely closed on unmount:
  // React 18 StrictMode runs mount → cleanup → mount in development, so a
  // close-only gate stays shut for the rest of the session and every server
  // answer (capabilities, the annotation list, an optimistic reconcile) is thrown
  // away — the whole subsystem renders but never loads. See createMountGate.
  const gateRef = useRef(null);
  if (!gateRef.current) gateRef.current = createMountGate();
  const mountGate = gateRef.current;
  useEffect(() => mountGate.arm(), [mountGate]);
  /**
   * clientId → server id. Soft-delete keeps the row id stable, so this is what
   * lets a §86 undo-of-delete (and redo-of-create) restore the RIGHT tombstone
   * after the row has left the local list. Populated from every server answer.
   */
  const idByClientRef = useRef(new Map());
  const rememberIds = useCallback((rows) => {
    for (const r of (Array.isArray(rows) ? rows : [])) {
      if (r && r.clientId && r.id) idByClientRef.current.set(r.clientId, r.id);
    }
  }, []);

  const targetRef = useRef(target); targetRef.current = target;
  const docHashRef = useRef(docHash); docHashRef.current = docHash;
  const activeRef = useRef(active); activeRef.current = active;

  const history = useProjectHistory();

  /* ── Fetching ───────────────────────────────────────────────────────────── */

  const fetchFull = useCallback(async () => {
    if (!activeRef.current) return;
    try {
      const res = await pdfAnnotationApi.list(targetRef.current, { docHash: docHashRef.current });
      if (!mountGate.isAlive() || docHashRef.current !== (res.docHash || docHashRef.current)) return;
      rememberIds(res.annotations);
      sinceRef.current = res.serverTime || '';
      setViewer((cur) => (cur.id === (res.viewerId || '') && cur.name === (res.viewerName || '')
        ? cur : { id: res.viewerId || '', name: res.viewerName || '' }));
      setCaps(res.capabilities || { canCreate: false, canModerate: false });
      setList((cur) => mergeServerList(cur, res.annotations || [], { full: true }));
      setError('');
      setReady(true);
    } catch (e) {
      if (!mountGate.isAlive()) return;
      // 404 here means "this document is not one of yours" — degrade to no
      // annotations rather than showing a scary error over a working PDF.
      setReady(true);
      setError(e && e.status === 404 ? '' : (e && e.message) || 'Could not load annotations.');
    }
  }, [rememberIds]);

  const fetchDelta = useCallback(async () => {
    if (!activeRef.current) return;
    if (!sinceRef.current) { await fetchFull(); return; }
    try {
      const res = await pdfAnnotationApi.list(targetRef.current, { docHash: docHashRef.current, since: sinceRef.current });
      if (!mountGate.isAlive()) return;
      rememberIds(res.annotations);
      sinceRef.current = res.serverTime || sinceRef.current;
      if (res.capabilities) setCaps(res.capabilities);
      setList((cur) => mergeServerList(cur, res.annotations || []));
    } catch { /* the next poke or the full refresh converges — never surface a delta failure */ }
  }, [fetchFull, rememberIds]);

  // Full refresh whenever the DOCUMENT identity or the scope changes. The clientId→id
  // map is cleared with it: it describes rows of the PREVIOUS document, and a stale
  // entry could aim an undo-restore at an annotation on a different file (§74).
  useEffect(() => {
    sinceRef.current = '';
    idByClientRef.current = new Map();
    setError('');
    if (!active) { setList([]); setCaps({ canCreate: false, canModerate: false }); setReady(false); return; }
    setReady(false);
    setList([]);
    fetchFull();
  }, [base, docHash, active, fetchFull]);

  /* ── Realtime (§87/§91) ─────────────────────────────────────────────────── */

  const healthyRef = useRef(false);
  const { healthy } = useRealtime({
    'annotation.changed': (ev) => {
      if (!activeRef.current || !ev) return;
      const t = targetRef.current || {};
      const scoped = t.scope === ANNOTATION_SCOPE.SCREENING
        ? ev.projectId === t.screenProjectId
        : ev.metaLabProjectId === t.metaLabProjectId;
      if (!scoped) return;
      if (ev.docHash && ev.docHash !== docHashRef.current) return;
      fetchDelta();
    },
  });
  useEffect(() => {
    // §91 — an unhealthy→healthy transition means events may have been missed
    // (the SSE channel has no Last-Event-ID / replay). Reconcile with a delta.
    if (healthy && !healthyRef.current && activeRef.current) fetchDelta();
    healthyRef.current = healthy;
  }, [healthy, fetchDelta]);

  /* ── Raw write primitives (shared by the UI and the undo executors) ─────── */

  const serialize = useCallback((fn) => {
    const next = chainRef.current.then(fn, fn);
    chainRef.current = next.catch(() => {});
    return next;
  }, []);

  const findByClientId = useCallback((clientId) => (
    listRef.current.find((a) => a && a.clientId === clientId) || null
  ), []);

  /**
   * serverIdFor(clientId) — THE id-bookkeeping rule (§89 + §86).
   *
   * The live list is the first source, but it is only as fresh as the last RENDER:
   * `listRef.current` is assigned during render, so a create that has just been
   * acknowledged is not in it yet. `idByClientRef` is stamped SYNCHRONOUSLY from every
   * server answer, so it is the one thing an undo running microseconds after the POST
   * resolved can trust. Preferring the list keeps the common path honest (a row the
   * user can see); falling back to the map is what makes "highlight, then Ctrl+Z"
   * work at any speed instead of refusing with "no longer here".
   */
  const serverIdFor = useCallback((clientId) => {
    const cur = findByClientId(clientId);
    if (cur && !cur.pending && cur.id) return cur.id;
    return idByClientRef.current.get(clientId) || '';
  }, [findByClientId]);

  /** POST a highlight (idempotent on clientId) and reconcile the optimistic row. */
  const persistCreate = useCallback(async (draft) => {
    const res = await pdfAnnotationApi.create(targetRef.current, {
      clientId: draft.clientId,
      docHash: draft.docHash,
      page: draft.page,
      rects: draft.rects,
      selectedText: draft.selectedText,
      color: draft.color,
      comment: draft.comment,
      recordId: draft.recordId,
      studyId: draft.studyId,
    });
    const row = res && res.annotation;
    if (row) {
      rememberIds([row]);
      // §89 idempotency can legitimately answer with a TOMBSTONE (the same clientId was
      // created and then deleted). Re-adding it would resurrect a highlight the team
      // removed, so the optimistic row is dropped instead — the row id is still
      // remembered, which is exactly what an undo-of-delete needs.
      if (row.deleted) setList((cur) => dropByClientId(cur, draft.clientId));
      else setList((cur) => upsertByClientId(cur, { ...row, pending: false, failed: false }));
    }
    return row;
  }, [rememberIds]);

  /**
   * PATCH one annotation. `baseRevision` is the §90 compare-and-set baseline; it is
   * resolved from the live row unless the caller knows better (an undo executor that
   * just resolved the id out of the map, when the row is not in the rendered list yet).
   */
  const applyUpdate = useCallback(async (id, patch, baseRevision) => {
    const cur = listRef.current.find((a) => a && a.id === id);
    const base = baseRevision !== undefined ? baseRevision : (cur ? cur.revision : undefined);
    const body = { ...patch };
    if (base !== undefined && base !== null) body.baseRevision = base;
    const res = await pdfAnnotationApi.update(targetRef.current, id, body);
    const row = res && res.annotation;
    if (row) {
      rememberIds([row]);
      setList((prev) => upsertByClientId(prev, { ...row, pending: false, failed: false }));
    }
    return row;
  }, [rememberIds]);

  const applyDelete = useCallback(async (id) => {
    const res = await pdfAnnotationApi.remove(targetRef.current, id);
    const row = res && res.annotation;
    if (row) {
      rememberIds([row]);   // keep the id so undo can restore this exact tombstone
      setList((prev) => dropByClientId(prev, row.clientId));
    }
    return row;
  }, [rememberIds]);

  const applyRestore = useCallback(async (id) => {
    const res = await pdfAnnotationApi.update(targetRef.current, id, { restore: true });
    const row = res && res.annotation;
    if (row && !row.deleted) {
      rememberIds([row]);
      setList((prev) => upsertByClientId(prev, { ...row, pending: false, failed: false }));
    }
    return row;
  }, [rememberIds]);

  /* ── Undo/redo executor (§86, D9) ───────────────────────────────────────── */

  useEffect(() => history.registerExecutor(PDF_ANNOTATION_KIND, async (op) => {
    if (!activeRef.current) return REFUSED('Open the PDF again to undo this highlight.');
    if (!op || typeof op !== 'object') return false;
    // §86 + §89 — run the inverse THROUGH THE SAME serialized chain as the forward
    // write. Ctrl+Z pressed while the create POST is still in flight therefore QUEUES
    // behind it and finds a real server id, instead of racing it and refusing (or,
    // worse, deleting a row the server has not heard of yet). This is also the 108.md
    // §14 rule — the executor is the tail of the forward write path, not a shortcut
    // around it.
    return serialize(async () => {
      try {
        if (op.type === 'delete') {
          const id = serverIdFor(op.clientId);
          if (!id) return REFUSED('That highlight is no longer here.');
          await applyDelete(id);
          return true;
        }
        if (op.type === 'restore') {
          // Soft delete keeps the row id, so a restore targets the exact tombstone.
          // `op.id` is null for the redo of a create (recorded before the POST
          // returned); the id map — stamped by every server answer — supplies it.
          const id = op.id || serverIdFor(op.clientId);
          if (!id) return REFUSED('That highlight can no longer be restored.');
          const row = await applyRestore(id);
          if (!row || row.deleted) return REFUSED('That highlight can no longer be restored.');
          return true;
        }
        if (op.type === 'update') {
          const cur = findByClientId(op.clientId);
          const id = serverIdFor(op.clientId);
          if (!cur || !id) return REFUSED('That highlight was deleted by someone else.');
          // Precondition against CURRENT state, not the state at record time.
          if (op.expect && Object.keys(op.expect).some((k) => cur[k] !== op.expect[k])) {
            return REFUSED('Another member changed this highlight, so it was left as it is.');
          }
          await applyUpdate(id, op.patch || {}, cur.pending ? null : cur.revision);
          return true;
        }
        return false;
      } catch (e) {
        if (e && e.status === 409) { fetchDelta(); return REFUSED('Another member changed this highlight, so it was left as it is.'); }
        if (e && e.status === 403) return REFUSED('You can no longer change this highlight.');
        if (e && e.status === 404) return REFUSED('That highlight no longer exists.');
        throw e;   // a genuine persistence failure — the provider reports it
      }
    });
  }), [history.registerExecutor, applyDelete, applyRestore, applyUpdate, findByClientId, serverIdFor, fetchDelta, serialize]);

  /* ── Public mutations ───────────────────────────────────────────────────── */

  /**
   * createHighlight({ page, rects, selectedText, color }) — §75/§89.
   * Renders immediately, persists asynchronously, records an undoable entry.
   */
  const createHighlight = useCallback((draftIn) => {
    if (!activeRef.current || !caps.canCreate) return null;
    const clientId = newClientId();
    const draft = pendingAnnotation({
      clientId,
      docHash: docHashRef.current,
      page: draftIn.page,
      rects: draftIn.rects,
      selectedText: draftIn.selectedText,
      color: colorFor(draftIn.color).key,
      comment: '',
      recordId, studyId, authorId: effUserId, authorName: effUserName,
    });
    setList((cur) => [...cur, draft]);
    // Record BEFORE the round-trip so Ctrl+Z immediately after the gesture works
    // (§86); the executor re-validates and refuses if the save never landed.
    history.record({
      kind: PDF_ANNOTATION_KIND,
      scope: SCOPE_PDF,
      label: 'Highlight',
      entityKey: clientId,
      undoOp: { type: 'delete', clientId },
      redoOp: { type: 'restore', clientId, id: null },
    });
    serialize(async () => {
      try {
        await persistCreate(draft);   // stamps idByClientRef for the redo/restore path
      } catch (e) {
        if (!mountGate.isAlive()) return;
        setList((cur) => markFailed(cur, clientId));
        setError((e && e.message) || 'That highlight could not be saved.');
        // §89 — never pretend it persisted: drop the failed row shortly after the
        // message so the page cannot be mistaken for a saved state.
        setTimeout(() => { if (mountGate.isAlive()) setList((cur) => dropByClientId(cur, clientId)); }, 2500);
      }
    });
    return draft;
  }, [caps.canCreate, history, persistCreate, recordId, serialize, studyId, effUserId, effUserName]);

  /**
   * Recolour (§77) — undoable, precondition-guarded.
   *
   * A highlight created moments ago is accepted: the id is resolved INSIDE the
   * serialized task (i.e. after the create POST it is queued behind has landed), so a
   * reviewer who highlights and immediately recolours is not told to wait. Only a
   * highlight whose save actually FAILED is refused.
   */
  const setColor = useCallback((annotation, color) => {
    if (!annotation || annotation.failed) return;
    const next = colorFor(color).key;
    const prev = colorFor(annotation.color).key;
    if (next === prev) return;
    setList((cur) => upsertByClientId(cur, { ...annotation, color: next }));
    history.record({
      kind: PDF_ANNOTATION_KIND,
      scope: SCOPE_PDF,
      label: 'Highlight colour',
      entityKey: annotation.clientId,
      undoOp: { type: 'update', clientId: annotation.clientId, patch: { color: prev }, expect: { color: next } },
      redoOp: { type: 'update', clientId: annotation.clientId, patch: { color: next }, expect: { color: prev } },
    });
    serialize(async () => {
      try {
        const id = serverIdFor(annotation.clientId);
        if (!id) throw Object.assign(new Error('That highlight is no longer here.'), { status: 404 });
        await applyUpdate(id, { color: next });
      } catch (e) {
        if (!mountGate.isAlive()) return;
        setList((cur) => upsertByClientId(cur, { ...annotation, color: prev }));
        setError((e && e.message) || 'That colour change could not be saved.');
        if (e && e.status === 409) fetchDelta();
      }
    });
  }, [applyUpdate, fetchDelta, history, serialize, serverIdFor]);

  /** Add/edit a comment (§79) — undoable as one discrete edit on commit. */
  const setComment = useCallback((annotation, comment) => {
    if (!annotation || annotation.failed) return;
    const next = String(comment || '').slice(0, MAX_COMMENT);
    const prev = String(annotation.comment || '');
    if (next === prev) return;
    setList((cur) => upsertByClientId(cur, { ...annotation, comment: next }));
    history.record({
      kind: PDF_ANNOTATION_KIND,
      scope: SCOPE_PDF,
      label: 'Highlight comment',
      entityKey: annotation.clientId,
      undoOp: { type: 'update', clientId: annotation.clientId, patch: { comment: prev }, expect: { comment: next } },
      redoOp: { type: 'update', clientId: annotation.clientId, patch: { comment: next }, expect: { comment: prev } },
    });
    serialize(async () => {
      try {
        const id = serverIdFor(annotation.clientId);
        if (!id) throw Object.assign(new Error('That highlight is no longer here.'), { status: 404 });
        await applyUpdate(id, { comment: next });
      } catch (e) {
        if (!mountGate.isAlive()) return;
        setList((cur) => upsertByClientId(cur, { ...annotation, comment: prev }));
        setError((e && e.message) || 'That comment could not be saved.');
        if (e && e.status === 409) fetchDelta();
      }
    });
  }, [applyUpdate, fetchDelta, history, serialize, serverIdFor]);

  /** Delete (§83 author-or-leader; the server re-decides) — undoable via restore. */
  const deleteAnnotation = useCallback((annotation) => {
    if (!annotation || annotation.failed) return;
    const snapshot = { ...annotation };
    setList((cur) => dropByClientId(cur, annotation.clientId));
    history.record({
      kind: PDF_ANNOTATION_KIND,
      scope: SCOPE_PDF,
      label: 'Highlight',
      entityKey: annotation.clientId,
      // `id: null` for a still-pending row — the undo executor resolves the real id
      // from the same map the delete below stamps, so an undo of "highlight, delete"
      // restores the RIGHT tombstone even when both happened inside one round-trip.
      undoOp: { type: 'restore', clientId: annotation.clientId, id: annotation.pending ? null : annotation.id },
      redoOp: { type: 'delete', clientId: annotation.clientId },
    });
    serialize(async () => {
      try {
        const id = serverIdFor(annotation.clientId);
        if (!id) throw Object.assign(new Error('That highlight is no longer here.'), { status: 404 });
        await applyDelete(id);
      } catch (e) {
        if (!mountGate.isAlive()) return;
        setList((cur) => upsertByClientId(cur, snapshot));
        setError((e && e.message) || 'That highlight could not be removed.');
      }
    });
  }, [applyDelete, history, serialize, serverIdFor]);

  /** §85 — 'mine' (any member) or 'all' (leader/owner). Never touches the PDF. */
  const clearAnnotations = useCallback(async (mode) => {
    if (!activeRef.current) return { cleared: 0 };
    try {
      const res = await pdfAnnotationApi.clear(targetRef.current, { docHash: docHashRef.current, mode });
      // A bulk clear is deliberately NOT undoable: it is a confirmed, destructive
      // team action, and replaying dozens of restores from one Ctrl+Z would be a
      // worse surprise than re-highlighting. The rows are tombstones, so an
      // operator can still recover them.
      history.clearScope(SCOPE_PDF);
      await fetchFull();
      return res;
    } catch (e) {
      setError((e && e.message) || 'Those annotations could not be cleared.');
      throw e;
    }
  }, [fetchFull, history]);

  /* ── Derived ────────────────────────────────────────────────────────────── */

  // §93/§94 — ONE index rebuild per annotation-list change, and the per-page arrays
  // KEEP THEIR IDENTITY when their contents did not change. That is what makes
  // "adding an annotation on page 25 does not rerender all 300 pages" structural:
  // every page layer is React.memo'd on its slice, so only page 25's slice is a new
  // array and only page 25's overlay re-renders. Without this identity carry-over,
  // rebuilding the index would hand every page a fresh array and defeat the memo.
  const byPageRef = useRef(new Map());
  const byPage = useMemo(() => {
    const next = indexByPage(list);
    const prev = byPageRef.current;
    for (const [p, arr] of next) {
      const old = prev.get(p);
      if (old && old.length === arr.length && old.every((a, i) => a === arr[i])) next.set(p, old);
    }
    byPageRef.current = next;
    return next;
  }, [list]);

  return useMemo(() => ({
    enabled: active,
    annotations: list,
    byPage,
    ready,
    error,
    dismissError: () => setError(''),
    capabilities: caps,
    // §81/§83 — who "you" are, for own-vs-others rendering and the client permission
    // mirror. Empty until the first list lands, which is exactly when nothing renders.
    userId: effUserId,
    userName: effUserName,
    createHighlight,
    setColor,
    setComment,
    deleteAnnotation,
    clearAnnotations,
    refresh: fetchFull,
  }), [active, list, byPage, ready, error, caps, effUserId, effUserName, createHighlight, setColor, setComment, deleteAnnotation, clearAnnotations, fetchFull]);
}

export default usePdfAnnotations;
