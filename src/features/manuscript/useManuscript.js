/**
 * features/manuscript/useManuscript.js — 64.md (P3). React hook that binds the
 * structured manuscript drafts to the project blob (via the existing `upd` autosave
 * path — no new server route), enforces the "don't overwrite user edits" rule, and
 * exposes engine-derived data (prisma counts, tables, references, readiness,
 * insights, staleness) to the panels.
 *
 * Persistence correctness (P3 review round 2): `upd(field, value)` does a WHOLESALE
 * replace of `project.data[field]` from a value precomputed by the caller. To avoid
 * lost updates and a re-render flush loop we:
 *   - read the FRESHEST committed project via a ref (projectRef) at mutation time,
 *     not a stale render closure, and merge by draft id (upsertDraft);
 *   - debounce high-frequency edits as FIELD PATCHES (not whole-draft snapshots),
 *     so a pending edit can never clobber a concurrently-generated/refreshed draft;
 *   - flush pending patches BEFORE any structural mutation (generate/refresh/meta)
 *     so the never-overwrite-user-edits rule sees the in-flight typing;
 *   - flush exactly once on real unmount (empty-deps effect + ref), nulling timers.
 *
 * Parity: the SAME runMeta the Analysis/Forest tabs use (monolithStats) is threaded
 * into every engine call, so manuscript numbers can never drift from the figures.
 *
 * 73.md Part 8 — live data wiring: on project open the hook fetches (parallel,
 * soft-fail, cached per project) the linked screening PRISMA rollup, the
 * search-builder methods text, RoB v2 assessments and the latest Pecan run's
 * per-source counts (manuscriptData.js), threads them into EVERY engine call
 * (genOpts / prismaCounts / tables), and exposes an honest availability map
 * (`dataStatus`) plus per-section provenance/outdated/lock state for the UI.
 */
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { runMeta } from '../../research-engine/statistics/monolithStats.js';
import {
  readManuscripts,
  computePrismaCounts,
  buildStudyCharacteristicsTable, buildSummaryOfFindingsTable, buildPrismaCountsTable,
  buildRobTable, buildSearchStrategyTable,
  generateReferenceList, orderReferencesForManuscript,
  collectCitationOrder, draftSectionTexts, citationToken, CITATION_TOKEN_RE,
  computeReadiness, smartInsights,
  evaluateStaleness, primaryAnalysis, allAnalyses,
  computeSectionInputsHashes, checkConsistency,
  // 84.md — live manuscript sync: dependency graph, sync plan, contradictions,
  // missing-info, freshness rollup and version snapshots (all pure engine).
  computeDependencyState, buildSyncPlan, applySyncDecision,
  detectContradictions, collectMissingInfo, computeFreshness,
  createSnapshot, restoreSnapshot, removeSnapshot,
  // 85.md B1/B2 — asset registry, token numbering/placement + pre-export validation.
  computeManuscriptAssets, resolveNumbering, computePlacements, validateExport,
  assetToken,
  // 117.md §5 — the canonical section id list, for the live structural signature
  // that decides when the derived object registry must be rebuilt.
  SECTION_IDS,
  // 101.md §4/§5/§8/§9/§10 — the live fact layer: resolve project-derived facts
  // at render time, notice when one changes, and let a researcher pin a previous
  // wording without falsifying the project record.
  resolveFacts, findFactTokens, renderFacts,
  reconcileFacts, groupChanges, overrideFact, clearFactOverride,
  factDiscrepancies, markChangeReverted,
  // 108.md §6 — pure capture/apply/compare for the two undoable structured
  // mutations (section lock, fact pin). See manuscript/historyOps.js.
  sectionLockOf, sectionLockMatches, captureFactPin, applyFactPin, factPinMatches,
  // 117.md §21/§22 — the audited PRISMA data-override model (registry + pure
  // write/compare primitives). See manuscript/prismaCounts.js.
  setPrismaOverride, prismaOverrideOf, prismaOverrideMatches, prismaOverrideLabel,
  // 102.md — manual-input placeholder detection, counts, grouping and navigation.
  collectPlaceholders, placeholderCounts, groupPlaceholders, stepPlaceholder,
  // 117.md §32/§35/§36 — the alias-aware citation usage scan that the References
  // panel, the chip renumbering and the §39 integrity checks all read.
  collectCitationUsage,
} from '../../research-engine/manuscript/index.js';
/* 117.md §26-§33 — THE reference resolver seam + its pure overlay writers. Imported
   directly rather than through the manuscript barrel: the library is a PROJECT-level
   concern (it outlives any one draft), and the direct path keeps that visible. */
import {
  resolveReferenceLibrary, materializeReferenceLibrary, readReferenceLibrary,
  libraryAddEntry, libraryEditReference, librarySuppress, libraryRestore,
  libraryDeleteEntry, libraryMerge, recordToReferenceEntry, usedReferenceIds,
  suggestReferenceDuplicates,
  // 117.md §88 (r3) — "reference merges must be auditable and undoable". ONE history
  // kind for the whole overlay, with pure entry/precondition/label/note builders.
  REFERENCE_LIBRARY_KIND, referenceLibraryEntry, referenceLibraryUndoStep,
  referenceLibraryNote,
} from '../../research-engine/manuscript/referenceLibrary.js';
import { generateDraft } from '../../research-engine/manuscript/draft.js';
import { gradeCertaintyEnabled, sofCertaintyMap } from '../../frontend/workspace/gradeApi.js';
// 108.md §§2/§6 — the project-wide history. Inert outside a provider (the hook
// returns a no-op shape), so the manuscript keeps working in any shell that has not
// mounted one yet.
import { useProjectHistory } from '../../frontend/history/HistoryContext.jsx';
// 108.md §17 / 117.md §88 — the shared undo-feedback queue (the bottom-left snackbar
// with an entry-targeted Undo button). Inert outside a provider, exactly like
// useProjectHistory, so a shell that has not mounted one simply gets no toast.
import { useUndoFeedback } from '../../frontend/history/useUndoFeedback.jsx';
// 117.md §13 — the SSE poke channel. The manuscript is a downstream reader of the
// screening record set, so it subscribes to the SAME pokes the PRISMA diagram does
// and re-fetches through the authorized endpoints (events are never trusted as data).
import { useRealtime } from '../../frontend/hooks/useRealtime.js';
// 117.md §22 (r2) — audit actors come from the signed-in user, not a phantom
// `project._me` key nothing ever wrote. Optional: SSR tests have no provider.
import { useOptionalAuth } from '../../frontend/context/AuthContext.jsx';
import { shouldReloadForRecordPoke } from '../prisma/inspectorModel.js';
import * as MS from './manuscriptState.js';
import {
  emptyManuscriptSources, fetchManuscriptSources, linkedScreenProjectId, composeGenOpts,
  sourceAvailability,
} from './manuscriptData.js';

/**
 * 117.md §13 — the floor between two "the tab became visible again" refreshes of the
 * live sources. Long enough that alt-tabbing costs nothing, short enough that coming
 * back from a screening session always shows current numbers.
 */
export const VISIBILITY_REFRESH_THROTTLE_MS = 20000;

export function useManuscript(project, upd) {
  const drafts = useMemo(() => readManuscripts(project), [project]);
  const [activeId, setActiveId] = useState(null);
  const [localSeed, setLocalSeed] = useState(null); // read-only fallback (upd is a no-op)
  const [saveState, setSaveState] = useState('saved'); // 'saved' | 'saving' | 'error' (UX-6)
  const [lastError, setLastError] = useState(null);
  const saveStateRef = useRef(saveState);
  useEffect(() => { saveStateRef.current = saveState; });

  // Refs to the freshest committed values (avoid stale-closure writes).
  const projectRef = useRef(project);
  const activeIdRef = useRef(activeId);
  useEffect(() => { projectRef.current = project; });
  useEffect(() => { activeIdRef.current = activeId; });

  // 117.md §22 (r2) — the signed-in user IS the audit actor. The old read
  // (`project._me`) was a dead seam: nothing anywhere sets `_me` on a project,
  // so snapshot authors and override-log actors were silently null forever.
  // The auth context is the one honest source; absent (SSR tests, no provider)
  // the entries simply carry no actor, which normalize/materialize rules allow.
  const auth = useOptionalAuth();
  const actorNameRef = useRef(null);
  actorNameRef.current = (() => {
    const u = auth && auth.user;
    if (!u || typeof u !== 'object') return null;
    const n = String(u.name || u.displayName || u.fullName || u.email || '').trim();
    return n || null;
  })();

  // 108.md §§2/§6 — the page-scoped history. Read through a render-assigned ref so
  // the mutation callbacks below stay referentially stable (they are dependencies of
  // half the panels). Outside a provider this is the inert no-op shape, so nothing
  // here changes behaviour in a shell that has not mounted one.
  const history = useProjectHistory();
  const historyRef = useRef(history);
  historyRef.current = history;

  // 117.md §88 — the same render-assigned ref for the feedback queue. The manuscript
  // is mounted inside ProjectInteractionProvider (StitchProjectWorkspace / the legacy
  // Workspace), so this resolves to the real snackbar queue there and to the inert
  // no-op shape in a shell-less test.
  const feedback = useUndoFeedback();
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;

  // Pending debounced field patches for ONE draft at a time: { draftId, fields:Map }.
  const pending = useRef(null);
  const timer = useRef(null);
  const flushRef = useRef(() => {});
  // The last manuscripts list a persist attempt FAILED on (for retry()).
  const lastFailed = useRef(null);

  // UX-6 honesty: every write goes through here so a throwing/rejecting upd shows
  // 'Save failed' + Retry instead of a lying 'Saved'. NOTE: the autosave path
  // behind upd (useStitchProjectDoc/store) may swallow network errors internally —
  // those cannot be observed from here (seam noted in 65.md report).
  const persist = useCallback((list) => {
    try {
      const r = upd('manuscripts', list);
      if (r && typeof r.then === 'function') {
        r.then(() => { lastFailed.current = null; setSaveState('saved'); setLastError(null); })
          .catch((e) => {
            lastFailed.current = list;
            setSaveState('error');
            setLastError((e && e.message) || 'Could not save changes.');
          });
        return;
      }
      lastFailed.current = null;
      setSaveState('saved');
      setLastError(null);
    } catch (e) {
      lastFailed.current = list;
      setSaveState('error');
      setLastError((e && e.message) || 'Could not save changes.');
    }
  }, [upd]);

  const retry = useCallback(() => {
    const list = lastFailed.current;
    if (!list) { setSaveState('saved'); setLastError(null); return; }
    setSaveState('saving');
    persist(list);
  }, [persist]);

  const applyPatches = useCallback((draft, fields) => {
    let d = draft;
    for (const [k, v] of fields) {
      const idx = k.indexOf(':');
      const kind = k.slice(0, idx);
      const key = k.slice(idx + 1);
      if (kind === 'section') d = MS.setSection(d, key, v);
      else if (kind === 'statement') d = MS.setStatement(d, key, v);
      else if (kind === 'meta') d = MS.setMeta(d, { [key]: v });
      else if (kind === 'assetPatch') {
        // Per-asset override patch merged over the FLUSH-TIME draft.assets — a
        // panel's mount-time snapshot must never wholesale-replace the map
        // (that silently reverted overrides written by another panel/writer).
        const cur = (d.assets && typeof d.assets === 'object') ? d.assets : {};
        d = MS.setMeta(d, { assets: { ...cur, [key]: { ...(cur[key] || {}), ...v } } });
      }
    }
    return d;
  }, []);

  // recs round — returns the just-persisted manuscripts list (or null when there
  // was nothing to flush) so a structural mutation that follows synchronously can
  // build on the flushed content: `projectRef.current` only catches up on the next
  // render, and reading it right after a flush silently dropped the last ≤600ms of
  // typing when e.g. locking a section or changing the template mid-edit.
  const flushPending = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = pending.current;
    pending.current = null;
    if (!p) return null;
    const list = readManuscripts(projectRef.current);
    const base = list.find((d) => d.id === p.draftId);
    if (!base) { setSaveState('saved'); return null; }
    const next = applyPatches(base, p.fields);
    const merged = MS.upsertDraft(list, next);
    persist(merged);
    return merged;
  }, [applyPatches, persist]);
  flushRef.current = flushPending;

  // Flush exactly once on real unmount.
  useEffect(() => () => { flushRef.current(); }, []);

  const queueEdit = useCallback((draftId, kind, key, value) => {
    if (!draftId) return;
    if (pending.current && pending.current.draftId !== draftId) flushPending();
    if (!pending.current) pending.current = { draftId, fields: new Map() };
    // assetPatch values are PARTIAL field objects: queuing caption then legend for
    // the same asset must accumulate, not replace (last-set-wins is only right for
    // whole-value kinds like section/statement/meta).
    const mapKey = `${kind}:${key}`;
    const prev = kind === 'assetPatch' ? pending.current.fields.get(mapKey) : undefined;
    pending.current.fields.set(mapKey, prev ? { ...prev, ...value } : value);
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushPending(), 600);
  }, [flushPending]);

  // Structural (immediate) mutation against the FRESHEST active draft, after
  // flushing any pending typing so user edits are never lost. recs round — the
  // flushed list (when any) IS the freshest state; projectRef lags one render.
  const mutateActive = useCallback((mutator) => {
    const flushed = flushPending();
    const list = flushed || readManuscripts(projectRef.current);
    const active = list.find((d) => d.id === activeIdRef.current) || list[0];
    if (!active) return null;
    const next = mutator(active, list);
    if (!next) return null;
    persist(MS.upsertDraft(list, next));
    return next;
  }, [flushPending, persist]);

  /** The freshest committed draft a history entry/executor should act on. */
  const freshestDraft = useCallback(() => {
    const list = readManuscripts(projectRef.current);
    return list.find((d) => d && d.id === activeIdRef.current) || list[0] || null;
  }, []);

  /* ── 108.md §§6/§8/§14 — undo/redo executors for the two structured mutations.
     Both go through `mutateActive`, i.e. the SAME write path as the forward action
     (§8: never a local-state rollback) — which also means both flush pending typing
     first, so an undo can never resurrect text the debounce had not committed.
     Both RE-VALIDATE against the freshest committed draft rather than the state at
     record time, and refuse when it moved (§14/§15); the provider then puts the
     entry back on its stack and says "changed by a collaborator".

     Honest limitation: `persist` reports failure asynchronously through `saveState`
     and the autosave layer behind `upd` can swallow a network error entirely (see
     this file's header), so a refusal here is a PRECONDITION failure, not a
     persistence one. The persistence safety net is the shell's blob-conflict
     handler, which clears every blob-backed scope on an autosave 409. */
  const registerExecutor = history.registerExecutor;
  useEffect(() => {
    const offLock = registerExecutor('manuscript.sectionLock', (op) => {
      const d = freshestDraft();
      if (!d || d.id !== op.draftId) return { ok: false, reason: 'refused' };
      if (!sectionLockMatches(d, op.sectionId, op.expect)) return { ok: false, reason: 'refused' };
      const applied = mutateActive((cur) => (
        cur && cur.id === op.draftId ? MS.setSectionLocked(cur, op.sectionId, op.locked) : null
      ));
      return applied ? true : { ok: false, reason: 'refused' };
    });
    const offFact = registerExecutor('manuscript.factPin', (op) => {
      const d = freshestDraft();
      if (!d || d.id !== op.draftId) return { ok: false, reason: 'refused' };
      if (!factPinMatches(d, op.expect)) return { ok: false, reason: 'refused' };
      const applied = mutateActive((cur) => (
        cur && cur.id === op.draftId ? applyFactPin(cur, op.snapshot) : null
      ));
      return applied ? true : { ok: false, reason: 'refused' };
    });
    // 117.md §22 "Allow undo" — a PRISMA data override is a discrete, audited,
    // exactly-invertible mutation, so it joins the two above under the same contract:
    // re-validate the field's CURRENT stored value against `expect` (a collaborator,
    // or this user in another tab, may have moved it) and write through mutateActive.
    // 108.md — the undo APPENDS an audit row marked via:'undo'; it never rewrites the
    // forward entry, so the §22 log stays a history rather than a current state.
    const offPrisma = registerExecutor('manuscript.prismaOverride', (op, ctx) => {
      const d = freshestDraft();
      if (!d || d.id !== op.draftId) return { ok: false, reason: 'refused' };
      if (!prismaOverrideMatches(d, op.field, op.expect)) {
        return {
          ok: false,
          reason: 'refused',
          detail: `The “${prismaOverrideLabel(op.field)}” override changed since — reload before undoing.`,
        };
      }
      const applied = mutateActive((cur) => (
        cur && cur.id === op.draftId
          ? setPrismaOverride(cur, op.field, op.value, {
            auto: op.auto,
            // 117.md §22 (r2 integration) — undo/redo rows name their actor too.
            by: actorNameRef.current || undefined,
            nowIso: new Date().toISOString(),
            via: (ctx && ctx.direction) === 'redo' ? 'redo' : 'undo',
          })
          : null
      ));
      return applied ? true : { ok: false, reason: 'refused' };
    });
    return () => { offLock(); offFact(); offPrisma(); };
  }, [registerExecutor, mutateActive, freshestDraft]);

  // Ensure ≥1 draft (seed from legacy on first use); keep activeId valid. Holds a
  // local seed for read-only projects where upd is a no-op so viewers still see it.
  useEffect(() => {
    if (!drafts.length) {
      if (!localSeed) {
        const { drafts: seeded } = MS.ensureDrafts(project);
        setLocalSeed(seeded[0]);
        setActiveId(seeded[0].id);
        upd('manuscripts', seeded);
      }
    } else {
      if (localSeed) setLocalSeed(null);
      if (!activeId || !drafts.find((d) => d.id === activeId)) setActiveId(drafts[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts.length]);

  const effectiveDrafts = drafts.length ? drafts : (localSeed ? [localSeed] : []);
  const activeDraft = useMemo(
    () => effectiveDrafts.find((d) => d.id === activeId) || effectiveDrafts[0] || null,
    [effectiveDrafts, activeId],
  );

  // P12 — GRADE Summary-of-Findings certainty per outcome. When the `gradeCertainty`
  // flag is ON we fetch the SoF once and flatten it to a plain { [pair.key]: certainty }
  // map that the SoF table builder reads (opts.gradeByOutcome). When the flag is OFF the
  // endpoint 404s / we never fetch, so `gradeByOutcome` stays null and the certainty
  // column is left blank — identical to the pre-P12 behaviour.
  const [gradeByOutcome, setGradeByOutcome] = useState(null);
  const pid = project && project.id;
  useEffect(() => {
    let alive = true;
    if (!pid) { setGradeByOutcome(null); return undefined; }
    (async () => {
      try {
        if (!(await gradeCertaintyEnabled())) { if (alive) setGradeByOutcome(null); return; }
        const { map } = await sofCertaintyMap(pid);
        if (alive) setGradeByOutcome(map && Object.keys(map).length ? map : null);
      } catch { if (alive) setGradeByOutcome(null); }
    })();
    return () => { alive = false; };
  }, [pid]);

  // 73.md Part 8 — live data sources (screening / search / RoB / pecan), fetched
  // in parallel once per project open, soft-fail (a missing flag / 404 / network
  // error can never block generation — legacy inputs remain the fallback).
  const [sources, setSources] = useState(() => emptyManuscriptSources());
  // recs round — 'settled' = the parallel source fetches have RESOLVED (they never
  // reject). Until then, generation would see empty sources and OUTDATED detection
  // would compare hashes against unlike inputs — both are gated on this flag.
  const [sourcesSettled, setSourcesSettled] = useState(false);
  // 85.md B2 — when the sources were last (re)fetched (shown in the export dialog).
  const [sourcesFetchedAt, setSourcesFetchedAt] = useState(null);
  const sourcesRef = useRef(sources);
  useEffect(() => { sourcesRef.current = sources; });
  const screenPid = linkedScreenProjectId(project);
  // review-round #21 — one generation per (pid, screenPid) target: an in-flight
  // refreshSources() resolving AFTER the target changed must not re-install the
  // old project's sources over the new fetch.
  const sourcesGenRef = useRef(0);
  useEffect(() => {
    let alive = true;
    sourcesGenRef.current += 1;
    setSources(emptyManuscriptSources());
    setSourcesSettled(false);
    setSourcesFetchedAt(null);
    if (!pid) { setSourcesSettled(true); return undefined; }
    fetchManuscriptSources({ projectId: pid, screenProjectId: screenPid })
      .then((r) => { if (alive) { if (r) setSources(r); setSourcesSettled(true); setSourcesFetchedAt(new Date().toISOString()); } })
      .catch(() => { if (alive) setSourcesSettled(true); /* orchestrator is soft-fail; belt-and-braces */ });
    return () => { alive = false; };
  }, [pid, screenPid]);
  const availability = useMemo(() => sourceAvailability(sources), [sources]);

  // 85.md B2 — export-freshness seam: re-run the soft-fail source fetch on demand
  // (the export path calls this so a .docx never embeds sources from project-open
  // time). Resolves with the FRESH sources so the caller can compute on them
  // immediately — state catches up on the next render.
  const refreshSources = useCallback(async () => {
    if (!pid) return { sources: sourcesRef.current, fetchedAt: null };
    const gen = sourcesGenRef.current;
    try {
      const r = await fetchManuscriptSources({ projectId: pid, screenProjectId: screenPid });
      // Stale resolution (project/screening link changed mid-flight) → discard;
      // the mount effect for the new target owns the state now.
      if (r && gen === sourcesGenRef.current) {
        const at = new Date().toISOString();
        setSources(r);
        setSourcesSettled(true);
        setSourcesFetchedAt(at);
        return { sources: r, fetchedAt: at };
      }
    } catch { /* soft-fail — fall through to the last known sources */ }
    return { sources: sourcesRef.current, fetchedAt: null };
  }, [pid, screenPid]);

  /* ══════════ 117.md §13 — automatic propagation, no refresh button ══════════
   *
   * "Changes anywhere affecting PRISMA must automatically propagate… No refresh
   * button should be required for ordinary synchronization."
   *
   * Until now the manuscript's live sources were fetched ONCE per project open (plus
   * on export), so a screening decision, a second-reviewer finalization or a fresh
   * import left the editor showing project-open numbers until the researcher
   * navigated away and back. The PRISMA diagram already solved this by subscribing to
   * the SSE poke channel; the manuscript is a downstream reader of the SAME record
   * set, so it subscribes to the same three pokes and re-runs the SAME soft-fail
   * fetch. Pokes carry ids only (global invariant 8) — nothing here trusts the event
   * as data.
   *
   * Debounced ~2s because one research action lands several pokes (a decision save
   * pokes decision.saved, a finalize pokes handoff.updated, a bulk import pokes once
   * at completion): one burst must cost ONE refetch, not one per event. The refetch
   * itself is guarded by `sourcesGenRef`, so a poke arriving as the project changes
   * can never install the old project's sources.
   */
  const pokeTimer = useRef(null);
  const refreshSourcesRef = useRef(refreshSources);
  refreshSourcesRef.current = refreshSources;
  const onPrismaPoke = useCallback((ev) => {
    if (!shouldReloadForRecordPoke(ev, screenPid)) return;
    if (pokeTimer.current) clearTimeout(pokeTimer.current);
    pokeTimer.current = setTimeout(() => {
      pokeTimer.current = null;
      refreshSourcesRef.current();
    }, 2000);
  }, [screenPid]);
  useEffect(() => () => { if (pokeTimer.current) clearTimeout(pokeTimer.current); }, []);
  useRealtime({
    // A metadata edit can move a record between the database and other-methods arms.
    'record.updated': onPrismaPoke,
    // Title/abstract decisions and conflict resolutions.
    'decision.saved': onPrismaPoke,
    // Second-review finalize / revert (the included + reports boxes).
    'handoff.updated': onPrismaPoke,
  });

  /* 117.md §13 — THE SAME-USER, SECOND-TAB CASE.
   *
   * The pokes above cover collaborators, but the bus deliberately EXCLUDES the
   * acting user from decision/finalize events (their own UI already reflects the
   * change — in the surface that made it). A researcher screening in one tab with
   * the manuscript open in another is therefore invisible to the SSE path, and it
   * is a completely ordinary way to work.
   *
   * Returning to the tab is the moment those numbers are about to be read, so that
   * is when they are refreshed. Throttled so flicking between tabs cannot turn into
   * a fetch storm, and only on the hidden→visible transition, never on every focus
   * event. No new state and no refresh button: the same soft-fail fetch as always.
   */
  const lastVisibleRefreshRef = useRef(0);
  useEffect(() => {
    if (typeof document === 'undefined' || !pid) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastVisibleRefreshRef.current < VISIBILITY_REFRESH_THROTTLE_MS) return;
      lastVisibleRefreshRef.current = now;
      refreshSourcesRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [pid, screenPid]);

  const genOpts = useMemo(
    () => composeGenOpts({ project, runMeta, gradeByOutcome, sources }),
    [project, gradeByOutcome, sources],
  );

  /* ── derived engine data for the panels ── */
  /* 117.md §12/§14/§57 — THE ROOT CAUSE OF THE OUT-OF-SYNC MANUSCRIPT PRISMA.
   *
   * 103.md built the bridge: computePrismaCounts short-circuits into `adaptFlow`
   * whenever `opts.flow` is present, so the manuscript reads the same record-derived
   * numbers Screening draws. `fetchManuscriptSources` has fetched that flow since
   * 103.md and `composeGenOpts` has forwarded it as `genOpts.flow` — but THIS memo
   * (and prepareExport below) never passed it, so the bridge never fired for the two
   * call sites that actually feed the editor. The manuscript therefore resolved every
   * box through the legacy counter chain, whose highest live tier is the stale
   * `project.prisma` blob MetaSiftPrismaSync stamps in — which is exactly the
   * "different counts / stale counts / missing branches" §14 forbids.
   *
   * One line each. Everything downstream (tables, diagram, narrative, fact tokens,
   * dependency fingerprints, snapshots, export) reads THIS object, so threading it
   * here is what makes §14 structurally true rather than maintained by hand.
   */
  const prismaCounts = useMemo(
    () => computePrismaCounts(project, {
      overrides: activeDraft && activeDraft.prismaOverrides,
      ...(sources.screening ? { screening: sources.screening } : {}),
      ...(sources.prismaFlow ? { flow: sources.prismaFlow } : {}),
    }),
    [project, activeDraft, sources],
  );
  const primary = useMemo(() => primaryAnalysis(project, genOpts), [project, genOpts]);
  const tables = useMemo(() => ({
    study: buildStudyCharacteristicsTable(project, sources.robByStudyId ? { robByStudyId: sources.robByStudyId } : {}),
    sof: buildSummaryOfFindingsTable(project, genOpts),
    prisma: buildPrismaCountsTable(prismaCounts),
    rob: buildRobTable(project, sources.robAssessments ? { assessments: sources.robAssessments } : {}),
    search: buildSearchStrategyTable(project, sources.perSource ? { perSource: sources.perSource } : {}),
  }), [project, genOpts, prismaCounts, sources]);
  /* 117.md §26-§33 — the reference library is derived below, after `liveDraft`
     exists: "which references are cited" and "in what order" are properties of the
     text the researcher can SEE, not of the last autosaved copy. */
  const readiness = useMemo(
    () => (activeDraft ? computeReadiness(project, activeDraft, { ...genOpts, prismaCounts, primary }) : null),
    [project, activeDraft, genOpts, prismaCounts, primary],
  );
  const insights = useMemo(
    () => (activeDraft ? smartInsights(project, activeDraft, { ...genOpts, prismaCounts, primary }) : []),
    [project, activeDraft, genOpts, prismaCounts, primary],
  );
  const staleness = useMemo(
    () => (activeDraft ? evaluateStaleness(activeDraft, project) : {}),
    [project, activeDraft],
  );

  /* ══════════ 102.md — the live (pre-autosave) view of the draft ══════════
   *
   * §58 wants counters to update "immediately without requiring refresh". The
   * stored draft only catches up after the 600 ms autosave debounce plus the
   * project round trip, so the text the researcher is typing RIGHT NOW is held
   * here and overlaid on top of the draft.
   *
   * Re-rendering on every keystroke is safe precisely because the editor is
   * uncontrolled: RichSectionEditor renders its HTML once per mount key and React
   * sees an identical string afterwards, so a parent re-render never touches the
   * live DOM or the caret.
   *
   * 117.md §5 — this now also feeds the asset registry. "Create a fourth table →
   * it becomes Table 4" has to be true the instant the table exists, not 600 ms
   * later, and the numbering is derived, so the only way to get that is to derive
   * it from what is on screen.
   */
  const [liveSections, setLiveSections] = useState(null);
  const [liveStatements, setLiveStatements] = useState(null);

  /** The draft as the researcher currently sees it, pending edits included. */
  const liveDraft = useMemo(() => {
    if (!activeDraft) return null;
    if (!liveSections && !liveStatements) return activeDraft;
    const out = { ...activeDraft };
    if (liveSections) {
      const sections = { ...activeDraft.sections };
      for (const id of Object.keys(liveSections)) {
        sections[id] = { ...(sections[id] || {}), content: liveSections[id] };
      }
      out.sections = sections;
    }
    if (liveStatements) out.statements = { ...activeDraft.statements, ...liveStatements };
    return out;
  }, [activeDraft, liveSections, liveStatements]);

  /**
   * 117.md §5-§7 — the STRUCTURAL signature of the live draft: every caption marker
   * and every cross-reference token, in order. Ordinary typing does not change it,
   * so the registry (and therefore every chip and caption in the page) is rebuilt
   * only when the set or ORDER of manuscript objects actually moves — one cheap
   * regex pass per keystroke instead of a full re-derivation, and no per-character
   * churn through the editor's in-place renumbering effect.
   */
  /* ══════════ 117.md §26-§33 — THE reference library ══════════
   *
   * ONE resolver seam. `resolveReferenceLibrary` derives the included studies (§31),
   * applies the project-level overlay (manual/imported entries, per-field
   * corrections, merges, suppressions) and hands back an alias map that EVERY
   * citation path resolves through — so a `[[cite:oldId]]` written before a merge or
   * a dedupe still points at the right reference (§32).
   *
   * `activeDraft.references` is LEGACY-ONLY: when a pre-117 blob actually carries a
   * frozen list it still wins (behaviour unchanged), and nothing here ever writes it.
   */
  const refLibrary = useMemo(() => resolveReferenceLibrary(project), [project]);

  const legacyDraftRefs = !!(activeDraft && activeDraft.references && activeDraft.references.length);

  /** The resolved reference objects, before ordering/formatting. */
  const libraryRefs = useMemo(
    () => (legacyDraftRefs ? activeDraft.references : refLibrary.refs),
    [legacyDraftRefs, activeDraft, refLibrary],
  );

  /** Alias map (empty for a legacy draft, which has no library to alias into). */
  const refAliases = useMemo(
    () => (legacyDraftRefs ? {} : refLibrary.aliases),
    [legacyDraftRefs, refLibrary],
  );

  /**
   * 117.md §37/§38/§39 — reference metadata by id, ALIAS KEYS INCLUDED. The editor
   * needs it for author-year chip labels and to tell a live citation from a broken
   * one; the panel needs it to render the §38 preview.
   */
  const refsById = useMemo(() => {
    if (!legacyDraftRefs) return refLibrary.byId;
    return new Map((activeDraft.references || []).map((r) => [r.id, r]));
  }, [legacyDraftRefs, activeDraft, refLibrary]);

  /**
   * 117.md §33/§36/§40 — the CITATION signature of the live draft: every
   * `[[cite:…]]` token, in order. Exactly the `refSignature` pattern used below for
   * manuscript objects, and for the same reason: §40 wants the bibliography to
   * update "immediately as citations are added, removed, or reordered", but §33
   * wants a review with a thousand references to stay fast. Typing a word does not
   * change this string, so the bibliography (which formats every reference in the
   * chosen style) is rebuilt only when the citation SET or ORDER actually moves —
   * one cheap regex pass per keystroke instead of a full re-format.
   */
  const citeSignature = useMemo(() => {
    if (!liveDraft) return '';
    const re = new RegExp(CITATION_TOKEN_RE.source, 'g');
    let sig = '';
    for (const s of SECTION_IDS) {
      const c = (liveDraft.sections && liveDraft.sections[s] && liveDraft.sections[s].content) || '';
      if (c.indexOf('[[cite:') === -1) continue;
      sig += `${s}:${(c.match(re) || []).join(',')};`;
    }
    const st = (liveDraft.statements && typeof liveDraft.statements === 'object') ? liveDraft.statements : {};
    for (const k of Object.keys(st)) {
      const c = String(st[k] || '');
      if (c.indexOf('[[cite:') === -1) continue;
      sig += `@${k}:${(c.match(re) || []).join(',')};`;
    }
    return sig;
  }, [liveDraft]);

  /** The draft the citation layer reads: the LIVE one, re-taken only when the
      citation structure changes (or the stored draft commits). */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const citationDraft = useMemo(() => liveDraft, [citeSignature, activeDraft]);

  /** 117.md §36/§40 — every citation token, alias-resolved, over the live text. */
  const citationUsage = useMemo(
    () => collectCitationUsage(citationDraft, { aliases: refAliases }),
    [citationDraft, refAliases],
  );

  /**
   * 117.md §36/§39 — numbering by first appearance, alias-resolved, never stored.
   * `knownIds` is the library itself: a citation that resolves to nothing takes NO
   * number, so a typo shows as "[?]" instead of silently shifting every later
   * marker out of step with the bibliography.
   */
  const citationKnownIds = useMemo(
    () => new Set(libraryRefs.map((r) => r.id)),
    [libraryRefs],
  );
  const citationOrder = useMemo(
    () => collectCitationOrder(draftSectionTexts(citationDraft), { aliases: refAliases, knownIds: citationKnownIds }),
    [citationDraft, refAliases, citationKnownIds],
  );

  const references = useMemo(() => {
    const style = (activeDraft && activeDraft.citationStyle) || 'vancouver';
    const ordered = citationDraft
      ? orderReferencesForManuscript(citationDraft, libraryRefs, { aliases: refAliases })
      : libraryRefs;
    const list = generateReferenceList(ordered, style);
    // §33/§39 — "cited" is a property of the MANUSCRIPT, not of the reference, so it
    // is attached here from the one usage scan rather than recomputed per consumer.
    return list.map((row) => ({ ...row, cited: citationUsage.cited.has(row.id) }));
  }, [activeDraft, citationDraft, libraryRefs, refAliases, citationUsage]);

  /** §32 — probable-duplicate pairs the panel offers to merge (bounded scan). */
  const duplicateReferences = useMemo(
    () => suggestReferenceDuplicates(libraryRefs),
    [libraryRefs],
  );

  const refSignature = useMemo(() => {
    if (!liveDraft) return '';
    const re = /\[\[(?:tblcap|table|figure):[a-z0-9:-]+\]\]/g;
    let sig = '';
    for (const s of SECTION_IDS) {
      const c = (liveDraft.sections && liveDraft.sections[s] && liveDraft.sections[s].content) || '';
      if (c.indexOf('[[') === -1) continue;
      sig += `${s}:${(c.match(re) || []).join(',')};`;
    }
    return sig;
  }, [liveDraft]);

  // The draft the registry derives from: the LIVE one, re-taken only when the
  // object structure changes or the stored draft commits (which is when titles,
  // overrides and metadata catch up).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const registryDraft = useMemo(() => liveDraft, [refSignature, activeDraft]);

  /* ── 85.md B2 — asset registry + live numbering/placement for editor + export ── */
  // Per-outcome analyses (primary first) — the SAME list the export renders
  // per-outcome forest figures from, so editor chips and the .docx agree.
  const analyses = useMemo(() => {
    try { return allAnalyses(project, genOpts); } catch { return []; }
  }, [project, genOpts]);

  // Data-block staleness → per-asset stale flags. Mirrors the readiness rule:
  // only blocks that WERE refreshed and have since diverged count (a never-
  // refreshed block on a fresh draft is not "stale data", it is just unpinned).
  const staleAssets = useMemo(() => {
    const link = {
      study_characteristics_table: 'table:study',
      summary_of_findings_table: 'table:sof',
      prisma_counts_table: 'table:prisma',
      risk_of_bias_table: 'table:rob',
      search_strategy_table: 'table:search',
      prisma_flow: 'figure:prisma',
      forest_plot: 'figure:forest-primary',
    };
    const map = {};
    for (const k of Object.keys(staleness || {})) {
      const st = staleness[k];
      if (st && st.stale && st.lastRefreshedAt && link[k]) map[link[k]] = true;
    }
    return map;
  }, [staleness]);

  const assets = useMemo(() => {
    if (!registryDraft) return [];
    try {
      return computeManuscriptAssets(project, registryDraft, {
        tables, prismaCounts, analyses, primary,
        robByStudyId: sources.robByStudyId || undefined,
        robAssessments: sources.robAssessments || undefined,
        staleAssets,
      });
    } catch { return []; }
  }, [project, registryDraft, tables, prismaCounts, analyses, primary, sources, staleAssets]);

  const assetNumbering = useMemo(
    () => resolveNumbering({ sections: registryDraft || [], assets }),
    [registryDraft, assets],
  );
  const assetPlacements = useMemo(
    () => computePlacements({ sections: registryDraft || [], numbering: assetNumbering, assets }),
    [registryDraft, assetNumbering, assets],
  );
  // 117.md §11 — every id a cross-reference may legitimately point at (canonical
  // ids + legacy aliases). The editor renders a token OUTSIDE this set as a broken
  // chip, so deleting a table turns its references visibly broken on the next
  // render instead of leaving them silently pointing at nothing.
  const knownAssetIds = useMemo(() => {
    const s = new Set();
    for (const a of assets) {
      s.add(a.id);
      for (const al of (a.aliasIds || [])) s.add(al);
    }
    return s;
  }, [assets]);

  /** 117.md §4 — the manual (in-prose) subset of the registry, in document order. */
  const manualTables = useMemo(() => assets.filter((a) => a && a.origin === 'manual'), [assets]);

  // True when the draft carries ANY structured asset token (known or not) — the
  // Insert-PRISMA button uses this to avoid silently mixing reference modes.
  const draftUsesTokens = useMemo(
    () => !!((assetNumbering.mentioned && assetNumbering.mentioned.size)
      || (assetNumbering.unresolved || []).length),
    [assetNumbering],
  );

  // 73.md Part 9 — per-section OUTDATED detection: fresh input hashes computed
  // with the SAME opts generation uses (incl. the active draft's templateId +
  // prisma overrides), compared against the hash stamped at generation time.
  // recs round — no fresh hashes until the source fetches settle (comparing a hash
  // computed WITH live data against one computed from empty pre-fetch sources
  // false-flagged Abstract/Methods/Results as outdated on every open), and no
  // OUTDATED verdicts at all while any live source is in an error state (a network
  // blip must read as "unknown", never as "your text is stale — regenerate").
  const fetchDegraded = ['screening', 'search', 'rob', 'pecan']
    .some((k) => sources.dataStatus && sources.dataStatus[k] === 'error');
  const freshHashes = useMemo(() => {
    if (!activeDraft || !sourcesSettled) return {};
    try {
      return computeSectionInputsHashes(project, {
        ...genOpts, prismaCounts,
        templateId: activeDraft.templateId, citationStyle: activeDraft.citationStyle,
        overrides: activeDraft.prismaOverrides,
      });
    } catch { return {}; }
  }, [project, genOpts, prismaCounts, activeDraft, sourcesSettled]);
  const outdated = useMemo(() => {
    const all = MS.computeOutdatedSections(activeDraft, freshHashes, availability);
    if (!fetchDegraded) return all;
    // 84.md refinement — a degraded source fetch must not blanket-suppress honest
    // staleness: sections that RECORDED the availability they were generated under
    // were already compared like-for-like by the per-section guard (a source that
    // was in the same state both times yields comparable hashes). Only sections
    // WITHOUT that stamp (pre-availability drafts) stay "unknown" while degraded.
    const out = {};
    for (const id of Object.keys(all)) {
      const s = activeDraft && activeDraft.sections && activeDraft.sections[id];
      if (s && s.sourceAvailability) out[id] = true;
    }
    return out;
  }, [activeDraft, freshHashes, availability, fetchDegraded]);

  // 73.md Part 9 — cross-artefact consistency checks (also folded into
  // smartInsights by the engine; the raw list powers the Overview card + jumps).
  const consistency = useMemo(() => {
    if (!activeDraft) return [];
    try { return checkConsistency(project, activeDraft, { ...genOpts, prismaCounts }); } catch { return []; }
  }, [project, activeDraft, genOpts, prismaCounts]);

  /* ── 84.md — live manuscript sync ── */
  // Coarse per-key dependency fingerprint (same opts generation uses). Only
  // computed once the live-source fetches settle, so a change to search.date can
  // mark Methods outdated with a NAMED reason — never a fetch-blip false positive.
  const freshDepState = useMemo(() => {
    if (!activeDraft || !sourcesSettled) return {};
    try {
      return computeDependencyState(project, {
        ...genOpts, prismaCounts, primary,
        overrides: activeDraft.prismaOverrides,
        templateId: activeDraft.templateId, citationStyle: activeDraft.citationStyle,
      });
    } catch { return {}; }
  }, [project, genOpts, prismaCounts, primary, activeDraft, sourcesSettled]);

  const contradictions = useMemo(() => {
    if (!activeDraft) return [];
    try { return detectContradictions(project, activeDraft, { ...genOpts, prismaCounts, primary }); } catch { return []; }
  }, [project, activeDraft, genOpts, prismaCounts, primary]);

  const missingInfo = useMemo(() => {
    if (!activeDraft) return [];
    try { return collectMissingInfo(project, activeDraft, { ...genOpts, prismaCounts, primary }); } catch { return []; }
  }, [project, activeDraft, genOpts, prismaCounts, primary]);

  // Which refreshable data blocks are currently stale (evaluateStaleness is keyed
  // by blockId → { stale, lastRefreshedAt }). 85.md B2 — mirror the readiness
  // rule: a NEVER-refreshed block is unpinned, not stale ("8 updates available"
  // on every fresh draft — and a pre-export warning on every export — was noise,
  // not honesty; genuine divergence after a refresh still counts).
  const staleBlocks = useMemo(
    () => Object.keys(staleness || {})
      .filter((k) => staleness[k] && staleness[k].stale && staleness[k].lastRefreshedAt),
    [staleness],
  );

  const freshness = useMemo(() => {
    try {
      return computeFreshness({
        outdated, contradictions, missing: missingInfo,
        staleBlocks, availabilityKnown: sourcesSettled,
      });
    } catch {
      return { status: 'unknown', label: 'Sync status unavailable', counts: {} };
    }
  }, [outdated, contradictions, missingInfo, staleBlocks, sourcesSettled]);

  // Eager, LIGHT count for the tab badge (no draft generation).
  const outdatedCount = useMemo(() => Object.keys(outdated || {}).length, [outdated]);

  /* ── 85.md B2 — pre-export preparation: flush → REFRESH sources → recompute the
        whole export model (tables/assets/numbering/placements) on the FRESH state
        → validate. Everything the .docx builder needs is returned so the export
        renders exactly what was validated (state memos catch up next render). ── */
  const prepareExport = useCallback(async () => {
    const flushed = flushPending();
    const list = flushed || readManuscripts(projectRef.current);
    const draft = list.find((d) => d.id === activeIdRef.current) || list[0] || activeDraft;
    if (!draft) return null;
    const { sources: fresh, fetchedAt } = await refreshSources();
    const proj = projectRef.current;
    const gOpts = composeGenOpts({ project: proj, runMeta, gradeByOutcome, sources: fresh });
    // 117.md §12/§57 — same canonical bridge as the display memo above (see its
    // comment). Without `flow` here the exported .docx/.zip re-derived the legacy
    // chain and could embed a DIFFERENT PRISMA than the editor had just validated.
    const pc = computePrismaCounts(proj, {
      overrides: draft.prismaOverrides,
      ...(fresh.screening ? { screening: fresh.screening } : {}),
      ...(fresh.prismaFlow ? { flow: fresh.prismaFlow } : {}),
    });

    /* 101.md §36 — the export is a CLEAN manuscript.
     *
     * Fact tokens are resolved HERE, once, against the freshly-refetched sources,
     * so (a) no export path can forget and leak raw `[[fact:…]]` syntax into a
     * submitted document, and (b) the exported numbers are the same ones the
     * editor was showing. Pinned wordings (§10) are honoured, because the export
     * must say what the manuscript says.
     *
     * Only fact tokens are substituted: `[[cite:…]]` and `[[table:…]]`/`[[figure:…]]`
     * deliberately SURVIVE, because asset numbering, placement and the exporter's
     * own renderInlineMarkers run downstream and still need them.
     *
     * Change-tracking provenance is never consulted on this path at all — a normal
     * export cannot carry an overlay because the overlay does not exist outside the
     * editor's view state.
     */
    const exportFacts = (() => {
      try { return resolveFacts(proj, { ...gOpts, prismaCounts: pc }); } catch { return {}; }
    })();
    const exportOverrides = (() => {
      const src = draft.factOverrides || {};
      const out = {};
      for (const k of Object.keys(src)) if (src[k] && src[k].value != null) out[k] = src[k].value;
      return out;
    })();
    const renderForExport = (md) => renderFacts(md, exportFacts, { overrides: exportOverrides });
    const exportDraft = (() => {
      const sections = {};
      for (const id of Object.keys(draft.sections || {})) {
        const s = draft.sections[id];
        sections[id] = { ...s, content: renderForExport(s && s.content) };
      }
      const statements = {};
      for (const id of Object.keys(draft.statements || {})) {
        statements[id] = renderForExport(draft.statements[id]);
      }
      return { ...draft, sections, statements };
    })();
    const tbls = {
      study: buildStudyCharacteristicsTable(proj, fresh.robByStudyId ? { robByStudyId: fresh.robByStudyId } : {}),
      sof: buildSummaryOfFindingsTable(proj, gOpts),
      prisma: buildPrismaCountsTable(pc),
      rob: buildRobTable(proj, fresh.robAssessments ? { assessments: fresh.robAssessments } : {}),
      search: buildSearchStrategyTable(proj, fresh.perSource ? { perSource: fresh.perSource } : {}),
    };
    const anals = allAnalyses(proj, gOpts);
    const prim = anals[0] || null;
    // Everything downstream reads the fact-resolved draft, so the exported
    // document, its validation and its asset numbering all describe the SAME text.
    const asts = computeManuscriptAssets(proj, exportDraft, {
      tables: tbls, prismaCounts: pc, analyses: anals, primary: prim,
      robByStudyId: fresh.robByStudyId || undefined,
      robAssessments: fresh.robAssessments || undefined,
      staleAssets,
    });
    const numb = resolveNumbering({ sections: exportDraft, assets: asts });
    const plc = computePlacements({ sections: exportDraft, numbering: numb, assets: asts });
    /* 117.md §39/§41 — the reference library is resolved on the SAME fresh project
       the rest of this model was built from, so the validation, the bibliography and
       the exported .docx all describe one library. */
    const lib = resolveReferenceLibrary(proj);
    const legacyRefs = (exportDraft.references && exportDraft.references.length) ? exportDraft.references : null;
    const refObjs = legacyRefs || lib.refs;
    const refAls = legacyRefs ? {} : lib.aliases;
    const refList = generateReferenceList(
      orderReferencesForManuscript(exportDraft, refObjs, { aliases: refAls }),
      exportDraft.citationStyle,
    );
    const validation = validateExport({
      project: proj, draft: exportDraft, assets: asts, numbering: numb, placements: plc,
      saveState: saveStateRef.current, sourcesSettled: true,
      freshness, dataStatus: fresh.dataStatus,
      references: refObjs, aliases: refAls, removedIds: legacyRefs ? new Set() : lib.removedIds,
    });
    return {
      draft: exportDraft, fetchedAt,
      genOpts: gOpts, prismaCounts: pc, tables: tbls, analyses: anals, primary: prim,
      assets: asts, numbering: numb, placements: plc, validation,
      robAssessments: fresh.robAssessments, robByStudyId: fresh.robByStudyId,
      screening: fresh.screening,
      // 117.md §41 — the docx builder takes the resolved list + aliases so it never
      // re-derives a DIFFERENT bibliography than the one just validated.
      references: refList, referenceAliases: refAls,
    };
  }, [flushPending, refreshSources, gradeByOutcome, staleAssets, freshness, activeDraft]);

  // LAZY sync plan: generating the draft to diff CURRENT vs PROPOSED is heavy, so
  // it runs on demand only (tab open / after a decision). The `generated` bundle
  // the current plan diffs against is kept in a ref so applySyncDecision applies
  // EXACTLY the proposed text the user saw.
  const [syncPlan, setSyncPlan] = useState(null);
  const generatedRef = useRef(null);
  const planShownRef = useRef(false);

  const refreshSyncPlan = useCallback(() => {
    planShownRef.current = true;
    if (!activeDraft) { generatedRef.current = null; setSyncPlan(null); return null; }
    try {
      const generated = generateDraft(project, {
        // SAME opts domain as freshDepState — a narrower set here would stamp
        // depState hashes that read as phantom "changed" reasons (review fix 4).
        // 85.md B2 — assetRefs matches generate(): proposals carry the same
        // structured tokens accepting them would otherwise strip.
        // 101.md §4/§5 — factTokens rides alongside assetRefs for the same reason:
        // the app generates LIVE manuscripts, so methodology and counts arrive as
        // [[fact:…]] tokens that re-resolve from project data on every render and
        // never need a refresh action. The engine default stays FALSE so the pure
        // generator's legacy output (and its golden tests) is byte-identical.
        ...genOpts, prismaCounts, primary, assetRefs: true, factTokens: true,
        overrides: activeDraft.prismaOverrides,
        templateId: activeDraft.templateId, citationStyle: activeDraft.citationStyle,
      });
      generatedRef.current = generated;
      const plan = buildSyncPlan({
        project, draft: activeDraft, generated, freshDepState, freshHashes, outdated,
      });
      setSyncPlan(plan);
      return plan;
    } catch (e) {
      // 84.md Part 22 — a synchronization failure must never corrupt the manuscript
      // and must be DISPLAYED, not swallowed: surface an error plan the panel renders
      // with a retry, and keep the last generated ref cleared so no stale proposal
      // can be applied.
      generatedRef.current = null;
      setSyncPlan({ error: (e && e.message) || 'Synchronization failed', entries: [], counts: { outdated: 0, conflicts: 0, critical: 0 } });
      return null;
    }
  }, [project, genOpts, prismaCounts, primary, activeDraft, freshDepState, freshHashes, outdated]);

  // Once the panel has been opened, keep the plan current after edits / decisions /
  // AND whenever any plan input changes — refreshSyncPlan's identity tracks project /
  // draft / fresh hashes / dep state, so a tab opened BEFORE the live sources settled
  // recomputes the moment they do (otherwise the plan would freeze on empty inputs).
  // Never runs before first open, so it can't add fetch-blip noise to an unvisited tab.
  useEffect(() => {
    if (planShownRef.current) refreshSyncPlan();
  }, [refreshSyncPlan]);

  // Unwrap an engine {draft, …} result (or a bare draft) to the next draft. Null
  // when the decision did not produce one (mutateActive then no-ops).
  const draftOf = (res) => (res && (res.draft || (res.sections ? res : null))) || null;

  const decide = useCallback((sectionId, decision) => {
    const generated = generatedRef.current;
    mutateActive((draft) => draftOf(applySyncDecision(draft, sectionId, decision, {
      generated,
      sectionMeta: generated && generated.sectionMeta,
      freshDepState, availability, nowIso: new Date().toISOString(),
    })));
    refreshSyncPlan();
  }, [mutateActive, freshDepState, availability, refreshSyncPlan]);

  // Accept every auto-applicable update in ONE mutation (looping decide() would
  // clobber, since projectRef only catches up on the next render).
  const acceptAllSafe = useCallback(() => {
    const plan = syncPlan;
    const generated = generatedRef.current;
    if (!plan || !generated) return;
    const ids = (plan.entries || []).filter((e) => e.canAutoApply).map((e) => e.sectionId);
    if (!ids.length) return;
    mutateActive((draft) => {
      let d = draft;
      for (const id of ids) {
        const next = draftOf(applySyncDecision(d, id, 'accept', {
          generated, sectionMeta: generated.sectionMeta,
          freshDepState, availability, nowIso: new Date().toISOString(),
        }));
        if (next) d = next;
      }
      return d;
    });
    refreshSyncPlan();
  }, [syncPlan, mutateActive, freshDepState, availability, refreshSyncPlan]);

  /* 84.md Part 6 — version snapshots (stored on the draft). */
  const createSnapshotNow = useCallback(({ label, frozen } = {}) => {
    mutateActive((draft) => draftOf(createSnapshot(draft, project, {
      // 117.md §22 (r2) — `project._me` was never set by anything; the auth
      // context is the real seam, so snapshot authors stop being silently null.
      label: label || '', frozen: !!frozen, author: actorNameRef.current,
      appVersion: (typeof window !== 'undefined' && window.__APP_VERSION__) || null,
      nowIso: new Date().toISOString(), genOpts: { ...genOpts, prismaCounts, primary },
    })));
  }, [mutateActive, project, genOpts, prismaCounts, primary]);

  const restoreSnapshotById = useCallback((id) => {
    mutateActive((draft) => draftOf(restoreSnapshot(draft, id, { nowIso: new Date().toISOString() })));
    refreshSyncPlan();
  }, [mutateActive, refreshSyncPlan]);

  const removeSnapshotById = useCallback((id, opts = {}) => {
    mutateActive((draft) => draftOf(removeSnapshot(draft, id, { force: !!opts.force })));
  }, [mutateActive]);

  /* ── mutations ── */
  const updateSection = useCallback((id, content) => {
    if (!activeDraft) return;
    const s = activeDraft.sections && activeDraft.sections[id];
    if (s && s.locked) return; // locked sections are read-only (UI-enforced)
    // 102.md §6 — record what was just typed so the placeholder count drops the
    // moment a field is filled, instead of waiting out the autosave debounce.
    setLiveSections((prev) => ({ ...(prev || {}), [id]: content }));
    queueEdit(activeDraft.id, 'section', id, content);
  }, [activeDraft, queueEdit]);

  // 73.md Part 9 — per-section lock toggle (persisted through the same path).
  // 108.md §6 — recorded as a history entry: the prior boolean IS the exact inverse,
  // captured from the freshest committed draft BEFORE the write (the lock flag is
  // untouched by pending typing, which only queues section/statement/meta patches).
  const setSectionLocked = useCallback((id, locked) => {
    const before = freshestDraft();
    const draftId = before ? before.id : null;
    const prev = sectionLockOf(before, id);
    const next = mutateActive((d) => MS.setSectionLocked(d, id, locked));
    if (!next || !draftId || prev === !!locked) return;
    historyRef.current.record({
      kind: 'manuscript.sectionLock',
      label: locked ? 'Section lock' : 'Section unlock',
      entityKey: `${draftId}:${id}`,
      undoOp: { draftId, sectionId: id, locked: prev, expect: !!locked },
      redoOp: { draftId, sectionId: id, locked: !!locked, expect: prev },
    });
  }, [mutateActive, freshestDraft]);

  /* ══════════ 117.md §21/§22 — applying and reverting a PRISMA data override ══
   *
   * A STRUCTURAL mutation, not a debounced meta patch: the old panel wrote the whole
   * `prismaOverrides` object through `setMetaDebounced` from a render-time snapshot,
   * so two fields edited inside one debounce window could lose each other, no audit
   * line existed at all, and there was nothing to undo. Now each field goes through
   * the pure `setPrismaOverride` writer (which appends the capped §22 audit entry and
   * deletes the key on revert) via `mutateActive` — the same serialized path every
   * other structured manuscript mutation uses.
   *
   * `auto` is read off the CURRENT resolved counts, i.e. the automated value the
   * override displaces, and stored on the audit line so it can be read later without
   * re-deriving anything.
   */
  const prismaCountsRef = useRef(prismaCounts);
  prismaCountsRef.current = prismaCounts;

  const writePrismaOverride = useCallback((field, value, meta = {}) => {
    if (!field) return null;
    const before = freshestDraft();
    const draftId = before ? before.id : null;
    const prev = prismaOverrideOf(before, field);
    const pc = prismaCountsRef.current;
    const ovInfo = (pc && pc.overrides && pc.overrides[field]) || null;
    // The automated value: the one the overlay displaced when an override is already
    // in force, else the currently resolved (un-overridden) count.
    const auto = ovInfo ? ovInfo.auto : ((pc && pc.counts && pc.counts[field]) ?? null);
    const next = mutateActive((d) => {
      if (!d || d.id !== draftId) return null;
      // 117.md §22 (r2 integration) — the audit entry names its actor from the
      // auth context; absent identity degrades to an entry without `by`.
      const by = actorNameRef.current || undefined;
      const out = setPrismaOverride(d, field, value, { auto, by, nowIso: new Date().toISOString(), ...meta });
      // A no-op returns the SAME draft: skip the write entirely rather than
      // autosaving an identical blob (and never record an entry for nothing).
      if (out === d) return null;
      // Bump the draft's own updatedAt through the shared meta helper, exactly like
      // every other structural mutation (MS.setSectionLocked / MS.setMeta).
      return MS.setMeta(out, {});
    });
    if (!next || !draftId) return null;
    const to = prismaOverrideOf(next, field);
    if (prev === to) return null;                       // nothing moved → no entry
    if (!meta.via || meta.via === 'user') {
      historyRef.current.record({
        kind: 'manuscript.prismaOverride',
        label: to == null ? 'Revert PRISMA override' : 'PRISMA override',
        entityKey: `${draftId}:${field}`,
        undoOp: { draftId, field, value: prev, auto, expect: to },
        redoOp: { draftId, field, value: to, auto, expect: prev },
      });
    }
    return next;
  }, [mutateActive, freshestDraft]);

  /** §21 "apply override" — record a manual value for one PRISMA box. */
  const setPrismaOverrideField = useCallback(
    (field, value) => writePrismaOverride(field, value),
    [writePrismaOverride],
  );

  /** §21/§22 "revert to automatic" — the field tracks live project data again. */
  const revertPrismaOverride = useCallback(
    (field) => writePrismaOverride(field, null),
    [writePrismaOverride],
  );

  // 85.md B2 — per-asset override (draft.assets[id]): include toggle is an
  // IMMEDIATE structural write; title/caption/legend text edits go through the
  // panels' buffered queueAssetPatch path instead.
  const setAssetOverride = useCallback((assetId, patch) => {
    if (!assetId || !patch) return;
    mutateActive((d) => {
      const cur = (d.assets && typeof d.assets === 'object') ? d.assets : {};
      const prev = (cur[assetId] && typeof cur[assetId] === 'object') ? cur[assetId] : {};
      return MS.setMeta(d, { assets: { ...cur, [assetId]: { ...prev, ...patch } } });
    });
  }, [mutateActive]);

  // review-round #20 — debounced per-asset FIELD patch (title/caption/legend typing):
  // rides queueEdit's 'assetPatch' kind, which merges over the FLUSH-TIME
  // draft.assets — never a wholesale replacement from a panel's mount-time snapshot.
  const queueAssetPatch = useCallback((assetId, patch) => {
    if (!activeDraft || !assetId || !patch) return;
    queueEdit(activeDraft.id, 'assetPatch', assetId, patch);
  }, [activeDraft, queueEdit]);

  /**
   * 117.md §4 — the manual-table side-metadata map (`draft.tableMeta[<id>]`).
   *
   * Identity and title live in the PROSE (that is what makes one Ctrl+Z restore a
   * table together with its id); everything that is not prose — created/modified
   * stamps, an extra caption paragraph, notes, a source note — lives here. Written
   * only on real events (creation, a structural table op, a panel edit), never per
   * keystroke: this map exists to answer "when was this last changed?", not to
   * shadow the prose.
   *
   * Additive and self-cleaning: an entry whose fields are all empty is deleted, and
   * the container disappears with the last entry, so a draft that never had a
   * manual table normalizes byte-identically to before this feature existed.
   */
  const setTableMeta = useCallback((tableId, patch) => {
    if (!tableId || !patch) return;
    mutateActive((d) => {
      const cur = (d.tableMeta && typeof d.tableMeta === 'object') ? d.tableMeta : {};
      const prev = (cur[tableId] && typeof cur[tableId] === 'object') ? cur[tableId] : {};
      const next = { ...prev };
      for (const k of Object.keys(patch)) {
        const v = patch[k];
        if (v == null || v === '') delete next[k];
        else next[k] = v;
      }
      const map = { ...cur };
      if (Object.keys(next).length) map[tableId] = next; else delete map[tableId];
      // No-op guard: never autosave an identical blob.
      const same = Object.keys(map).length === Object.keys(cur).length
        && Object.keys(map).every((k) => JSON.stringify(map[k]) === JSON.stringify(cur[k]));
      if (same) return null;
      const out = MS.setMeta(d, {});
      if (Object.keys(map).length) out.tableMeta = map; else delete out.tableMeta;
      return out;
    });
  }, [mutateActive]);

  /* ══════════ 117.md §28-§32 — the reference-library write path ══════════
   *
   * The overlay lives at PROJECT level, so it goes through `upd('referenceLibrary')`
   * rather than the manuscript's per-draft queue — a reference belongs to the
   * review, not to one draft of its write-up.
   *
   * Every writer is the same three steps, which is why they share `writeLibrary`:
   *   1. read the FRESHEST committed overlay (projectRef, never a render closure);
   *   2. run the PURE writer from referenceLibrary.js (returns null on a no-op);
   *   3. materialize — which strips empty containers and returns `undefined` for an
   *      empty library, so a project that never used the feature keeps a blob with
   *      no `referenceLibrary` key at all (the byte-stability rule).
   *
   * 117.md §88 (r3) — and step 4: record the mutation in the project history. Every
   * writer below passes its OP ID, which is what turns "the library changed" into a
   * named, undoable action ("Merge references", "Delete reference", …). The op id is
   * null on the undo/redo path — an executor must never record what it is replaying.
   */

  /**
   * 117.md §88 — one history entry per library action, plus the undo-carrying
   * snackbar for the three destructive-feeling ops (merge / delete / import).
   *
   * `prev`/`next` are the COMPLETE overlays the write moved between, so undo and
   * redo are the same wholesale write in opposite directions and there is no inverse
   * of `libraryMerge` to maintain (see referenceLibrary.js §88 for why that matters).
   * The note's button is ENTRY-TARGETED (`undoEntry`, never a bare `undo()`): notes
   * queue for 8 s, during which newer actions land on the same stack.
   */
  const recordLibraryOp = useCallback((op, prev, next) => {
    const entry = referenceLibraryEntry(op, prev, next);
    if (!entry) return null;                       // nothing moved → no history cost
    const stamped = historyRef.current.record(entry);
    if (!stamped) return null;                     // `projectUndoRedo` off (109.md §5)
    // Only `import` reads the count; deriving it from the two snapshots keeps the
    // sentence honest even when some records were skipped as no-ops.
    const added = Math.max(0, (next.entries || []).length - (prev.entries || []).length);
    const message = referenceLibraryNote(op, added);
    if (message) {
      feedbackRef.current.notify({
        scope: historyRef.current.scope || '',
        message,
        entryId: stamped.id,
        undo: () => { historyRef.current.undoEntry(stamped.id); },
      });
    }
    return stamped;
  }, []);

  const writeLibrary = useCallback((mutator, op = null) => {
    const cur = readReferenceLibrary(projectRef.current);
    const next = mutator(cur);
    if (!next) return false;
    setSaveState('saving');
    try {
      const r = upd('referenceLibrary', materializeReferenceLibrary(next));
      if (r && typeof r.then === 'function') {
        r.then(() => { setSaveState('saved'); setLastError(null); })
          .catch((e) => { setSaveState('error'); setLastError((e && e.message) || 'Could not save the reference library.'); });
      } else { setSaveState('saved'); setLastError(null); }
    } catch (e) {
      setSaveState('error');
      setLastError((e && e.message) || 'Could not save the reference library.');
      return false;
    }
    if (op) recordLibraryOp(op, cur, next);
    return true;
  }, [upd, recordLibraryOp]);

  /** §28/§29 — add a reference (manual entry or a confirmed smart lookup). */
  const addReference = useCallback((entry) => {
    let newId = null;
    const ok = writeLibrary((lib) => {
      const used = usedReferenceIds(projectRef.current, lib);
      const next = libraryAddEntry(lib, entry, { usedIds: used, nowIso: new Date().toISOString() });
      if (next) newId = next.entries[next.entries.length - 1].id;
      return next;
    }, 'add');
    return ok ? newId : null;
  }, [writeLibrary]);

  /**
   * §29 — edit a reference. A DERIVED (included-study) reference records a patch, so
   * the study record is untouched and a refresh can never win over the correction;
   * an added reference is rewritten in place. Both mark the touched fields
   * user-corrected, which is what stops a later lookup clobbering them.
   */
  const editReference = useCallback((id, patch, opts = {}) => writeLibrary(
    (lib) => libraryEditReference(lib, id, patch, { ...opts, nowIso: new Date().toISOString() }),
    'edit',
  ), [writeLibrary]);

  /** §31 — hide a derived reference from the bibliography (restorable). */
  const suppressReference = useCallback((id) => writeLibrary((lib) => librarySuppress(lib, id), 'suppress'), [writeLibrary]);
  const restoreReference = useCallback((id) => writeLibrary((lib) => libraryRestore(lib, id), 'restore'), [writeLibrary]);
  /** Delete an ADDED reference outright (a derived one can only be suppressed). */
  const deleteReference = useCallback((id) => writeLibrary((lib) => libraryDeleteEntry(lib, id), 'delete'), [writeLibrary]);

  /**
   * §32 — merge two references. The losing id becomes an ALIAS of the survivor, so
   * every citation already written keeps resolving; metadata fills blanks only and
   * notes/tags/PDF/screening links are preserved.
   */
  const mergeReferences = useCallback((survivorId, mergedId) => writeLibrary(
    (lib) => libraryMerge(lib, {
      survivorId,
      mergedId,
      refs: resolveReferenceLibrary(projectRef.current, { library: lib }).refs,
      nowIso: new Date().toISOString(),
    }),
    'merge',
  ), [writeLibrary]);

  /**
   * §30 — land imported records in the LIBRARY. The caller has already shown the
   * dedup preview and decided what to keep, so this is a plain append; records that
   * matched an existing reference simply are not passed in.
   */
  const importReferences = useCallback((records) => {
    const list = Array.isArray(records) ? records.filter(Boolean) : [];
    if (!list.length) return 0;
    let added = 0;
    writeLibrary((lib) => {
      let next = lib;
      const used = usedReferenceIds(projectRef.current, lib);
      const nowIso = new Date().toISOString();
      for (const rec of list) {
        const entry = recordToReferenceEntry(rec, { linkRecordId: true });
        const step = libraryAddEntry(next, entry, { usedIds: used, nowIso });
        if (!step) continue;
        next = step;
        used.add(step.entries[step.entries.length - 1].id);
        added += 1;
      }
      return added ? next : null;
    }, 'import');
    return added;
  }, [writeLibrary]);

  /* ── 117.md §88 (r3) — the reference-library undo/redo executor ──────────────
   *
   * ONE executor for ONE kind, mirroring `manuscript.prismaOverride` above: it
   * re-validates against the LIVE overlay (never the state at record time), refuses
   * politely and BY NAME when a collaborator — or this user in another tab — moved
   * the library since, and otherwise writes the recorded snapshot back through the
   * SAME `writeLibrary` path the forward action used (108.md §8 — never a local-state
   * rollback). `op` is omitted on that call, so replaying an entry never records one.
   *
   * Byte-stability: undoing the FIRST library op writes back the normalized EMPTY
   * overlay, which `materializeReferenceLibrary` turns into `undefined` — the
   * `referenceLibrary` key leaves the blob entirely instead of lingering as `{}`.
   *
   * Registered in its own effect (rather than alongside the three above) because it
   * depends on `writeLibrary`, which is declared here — the library is a PROJECT-level
   * concern and its whole write path lives in this block.
   *
   * Same honest limitation as the draft executors: `upd` reports persistence failure
   * asynchronously through `saveState`, so a refusal here is a PRECONDITION failure,
   * not a persistence one. The persistence net is the shell's blob-conflict handler,
   * which clears every blob-backed scope on an autosave 409.
   */
  useEffect(() => registerExecutor(REFERENCE_LIBRARY_KIND, (op) => {
    const step = referenceLibraryUndoStep(readReferenceLibrary(projectRef.current), op);
    if (!step.ok) return { ok: false, reason: 'refused', detail: step.detail };
    const applied = writeLibrary(() => step.library);
    return applied ? true : { ok: false, reason: 'failed' };
  }), [registerExecutor, writeLibrary]);

  // 85.md B2 — "Insert reference" from the Tables/Figures panels: no editor is
  // mounted there, so the token is appended to the END of Results (the caller
  // tells the researcher so). Returns false when Results is locked.
  const insertAssetReference = useCallback((assetId) => {
    if (!assetId) return false;
    let ok = false;
    mutateActive((d) => {
      const sec = (d.sections && d.sections.results) || {};
      if (sec.locked) return null;
      const cur = String(sec.content || '');
      ok = true;
      return MS.setSection(d, 'results', `${cur.replace(/\s+$/, '')}${cur.trim() ? '\n\n' : ''}${assetToken(assetId)}`);
    });
    return ok;
  }, [mutateActive]);

  /**
   * 117.md §34 — "Cite" from the References panel. No editor is mounted there, so
   * the token is appended to the END of Results and the caller sends the researcher
   * to the editor. Mirrors insertAssetReference exactly (same rule, same failure
   * mode: false when Results is locked).
   */
  const insertCitationReference = useCallback((refId) => {
    if (!refId) return false;
    let ok = false;
    mutateActive((d) => {
      const sec = (d.sections && d.sections.results) || {};
      if (sec.locked) return null;
      const cur = String(sec.content || '');
      ok = true;
      return MS.setSection(d, 'results', `${cur.replace(/\s+$/, '')}${cur.trim() ? ' ' : ''}${citationToken(refId)}`);
    });
    return ok;
  }, [mutateActive]);

  const setStatement = useCallback((id, val) => {
    if (!activeDraft) return;
    // 102.md §6 — statements carry placeholders too (the funding line is exactly
    // the field that gets forgotten), so they get the same live overlay as sections
    // and the counter drops as soon as one is filled.
    setLiveStatements((prev) => ({ ...(prev || {}), [id]: val }));
    queueEdit(activeDraft.id, 'statement', id, val);
  }, [activeDraft, queueEdit]);

  // Debounced meta edits (free-text/number fields: keywords, prismaOverrides).
  const setMetaDebounced = useCallback((patch) => {
    if (!activeDraft) return;
    for (const k of Object.keys(patch)) queueEdit(activeDraft.id, 'meta', k, patch[k]);
  }, [activeDraft, queueEdit]);

  // Immediate meta edits (dropdowns: template/citationStyle/status). Changing the
  // journal template also adopts that template's default citation style.
  const setMeta = useCallback((patch) => {
    mutateActive((d) => {
      let p = patch;
      if (patch.templateId && patch.citationStyle === undefined) {
        const tpl = MS.templateById(patch.templateId);
        if (tpl && tpl.citationStyle) p = { ...patch, citationStyle: tpl.citationStyle };
      }
      return MS.setMeta(d, p);
    });
  }, [mutateActive]);

  const generate = useCallback((opts = {}) => {
    let skipped = [];
    let skippedLocked = [];
    mutateActive((active) => {
      // 85.md B2 — assetRefs:true at every generation call site: new drafts get
      // structured [[table:…]]/[[figure:…]] tokens; regenerating a section of a
      // token-era draft keeps them. Engine default stays FALSE (legacy pins).
      const generated = generateDraft(project, {
        // 101.md §4/§5 — factTokens rides alongside assetRefs for the same reason:
        // the app generates LIVE manuscripts, so methodology and counts arrive as
        // [[fact:…]] tokens that re-resolve from project data on every render and
        // never need a refresh action. The engine default stays FALSE so the pure
        // generator's legacy output (and its golden tests) is byte-identical.
        ...genOpts, prismaCounts, primary, assetRefs: true, factTokens: true,
        templateId: active.templateId, citationStyle: active.citationStyle,
        overrides: active.prismaOverrides,
      });
      // applyGeneratedSections stamps generated.sectionMeta (sources/missing/
      // inputsHash) onto every written section, always skips locked sections,
      // and seeds generated.statements into EMPTY statements on a full generate.
      // recs round — also stamp WHICH live sources this generation saw, so
      // OUTDATED detection only ever compares hashes of like inputs.
      const res = MS.applyGeneratedSections(active, generated, { ...opts, availability });
      skipped = res.skipped;
      skippedLocked = res.skippedLocked || [];
      return res.draft;
    });
    return { skipped, skippedLocked };
  }, [mutateActive, project, genOpts, prismaCounts, primary, availability]);

  const refreshBlock = useCallback((blockId) => {
    mutateActive((d) => MS.markBlockRefreshed(d, blockId, projectRef.current));
  }, [mutateActive]);

  const refreshAllBlocks = useCallback(() => {
    mutateActive((d) => MS.markAllBlocksRefreshed(d, projectRef.current));
  }, [mutateActive]);

  /* ══════════ 101.md §4/§5 — continuous fact synchronization ══════════
   *
   * There is deliberately NO refresh/regenerate/sync action here. Facts are
   * RESOLVED AT RENDER from the live project, so a project change is reflected
   * the moment the data arrives, and the researcher's prose is never rewritten —
   * only the inside of a [[fact:…]] span can ever differ.
   */

  // Every fact the manuscript actually states, across all sections of the active
  // draft. Only these are tracked or reported (§30 — a project change nobody
  // wrote about is not a manuscript change).
  const usedFactKeys = useMemo(() => {
    const secs = (activeDraft && activeDraft.sections) || {};
    const keys = new Set();
    for (const id of Object.keys(secs)) {
      for (const t of findFactTokens(secs[id] && secs[id].content)) keys.add(t.key);
    }
    return Array.from(keys);
  }, [activeDraft]);

  // ONE resolution per project snapshot — this is what makes §16 hold: Methods,
  // Results, the Abstract and the PRISMA table cannot disagree because they all
  // read the same object.
  const resolvedFacts = useMemo(() => {
    if (!activeDraft) return {};
    try {
      return resolveFacts(project, { ...genOpts, prismaCounts, primary });
    } catch { return {}; }
  }, [project, genOpts, prismaCounts, primary, activeDraft]);

  // §10 — pinned wordings, flattened for renderFacts.
  const factOverrides = useMemo(() => {
    const src = (activeDraft && activeDraft.factOverrides) || {};
    const out = {};
    for (const k of Object.keys(src)) if (src[k] && src[k].value != null) out[k] = src[k].value;
    return out;
  }, [activeDraft]);

  /** Render a section's markdown with its facts resolved (the CLEAN text, §6). */
  const renderSection = useCallback(
    (md) => renderFacts(md, resolvedFacts, { overrides: factOverrides }),
    [resolvedFacts, factOverrides],
  );

  // §10 — where a pinned wording now disagrees with the project.
  const discrepancies = useMemo(
    () => factDiscrepancies(activeDraft, resolvedFacts),
    [activeDraft, resolvedFacts],
  );

  // §8/§12 — the reconciliation pass. Runs only once the live sources have
  // SETTLED: reconciling against half-loaded data would record a "change" from a
  // real value to a placeholder and back, which is noise, not provenance.
  //
  // §31 — this is a cheap string comparison over the handful of facts the
  // manuscript uses, not a regeneration; it is safe on every project change.
  const reconcileRef = useRef(null);
  reconcileRef.current = { usedFactKeys, resolvedFacts, activeDraft };
  useEffect(() => {
    if (!sourcesSettled) return undefined;
    const { usedFactKeys: keys, resolvedFacts: facts, activeDraft: draft } = reconcileRef.current;
    if (!draft || !keys.length) return undefined;
    // Coalesce bursts (a search import lands several updates in a row) so one
    // research action produces ONE grouped entry (§14) instead of a stream.
    const t = setTimeout(() => {
      const d = (readManuscripts(projectRef.current) || []).find((x) => x.id === draft.id);
      if (!d) return;
      const { draft: next, changes } = reconcileFacts(d, facts, {
        usedKeys: keys,
        nowIso: new Date().toISOString(),
      });
      // Nothing moved → no write at all. This is what keeps §31 true: the common
      // case costs one comparison and zero I/O.
      if (!changes.length && !d.factState) return;
      if (!changes.length && d.factState) {
        // First-observation bookkeeping only — still worth persisting once so the
        // NEXT real change has a baseline to diff against (§38).
        if (JSON.stringify(d.factState) === JSON.stringify(next.factState)) return;
      }
      updateDraftRef.current(next);
    }, 400);
    return () => clearTimeout(t);
  }, [sourcesSettled, resolvedFacts, usedFactKeys]);

  // Once the stored draft catches up with what was typed, drop the overlay so the
  // two can never drift apart.
  useEffect(() => {
    if (!liveSections || !activeDraft) return;
    const secs = activeDraft.sections || {};
    const stillAhead = Object.keys(liveSections).some(
      (id) => (secs[id] && secs[id].content) !== liveSections[id],
    );
    if (!stillAhead) setLiveSections(null);
  }, [activeDraft, liveSections]);

  useEffect(() => {
    if (!liveStatements || !activeDraft) return;
    const st = activeDraft.statements || {};
    const stillAhead = Object.keys(liveStatements).some((id) => st[id] !== liveStatements[id]);
    if (!stillAhead) setLiveStatements(null);
  }, [activeDraft, liveStatements]);

  /** Every unresolved placeholder, in manuscript order (§1, §2). */
  const placeholders = useMemo(() => collectPlaceholders(liveDraft), [liveDraft]);
  const placeholderStats = useMemo(() => placeholderCounts(placeholders), [placeholders]);
  const placeholderGroups = useMemo(() => groupPlaceholders(placeholders), [placeholders]);

  // §2 — the field the researcher is currently on. Held as a LABEL+section rather
  // than an index so it survives edits elsewhere in the manuscript that would
  // otherwise silently renumber it.
  const [currentPlaceholderId, setCurrentPlaceholderId] = useState(null);

  // §6 — when a placeholder is resolved (or the manuscript regenerates) the marker
  // must not point at a field that no longer exists.
  useEffect(() => {
    if (!currentPlaceholderId) return;
    if (!placeholders.some((p) => p.id === currentPlaceholderId)) setCurrentPlaceholderId(null);
  }, [placeholders, currentPlaceholderId]);

  /**
   * The next/previous MANUAL field, wrapping around. 'pending' fields are skipped
   * on purpose: stepping a researcher into a field they must not type in (because
   * the project supplies it) would be a dead end — the panel lists those instead.
   */
  const nextPlaceholder = useCallback(
    (direction = 1) => stepPlaceholder(placeholders, currentPlaceholderId, direction, 'manual'),
    [placeholders, currentPlaceholderId],
  );

  const updateDraft = useCallback((nextDraft) => {
    flushPending();
    const list = readManuscripts(projectRef.current);
    persist(MS.upsertDraft(list, nextDraft));
  }, [flushPending, persist]);

  // Stable handle so the reconcile effect above does not need updateDraft in its
  // dependency list (which would re-run it on every autosave tick).
  const updateDraftRef = useRef(updateDraft);
  useEffect(() => { updateDraftRef.current = updateDraft; });

  const addDraft = useCallback((opts = {}) => {
    flushPending();
    const d = MS.newDraft(project, opts);
    persist(MS.upsertDraft(readManuscripts(projectRef.current), d));
    setActiveId(d.id);
    return d;
  }, [flushPending, project, persist]);

  const removeDraft = useCallback((id) => {
    flushPending();
    const arr = readManuscripts(projectRef.current).filter((d) => d.id !== id);
    persist(arr);
    if (id === activeIdRef.current) setActiveId(arr[0] ? arr[0].id : null);
  }, [flushPending, persist]);

  /* ══════════ 101.md §10 — reverting an automatic manuscript change ══════════
   *
   * These act on the MANUSCRIPT ONLY. Reverting the underlying research event is
   * a different act with different consequences and belongs to the project
   * history mechanism, exactly as §10 and §11 require. Pinning a wording that
   * disagrees with the project surfaces in `discrepancies` so the divergence is
   * communicated rather than hidden.
   */

  /**
   * recordFactPin — 108.md §6. Both fact actions are the same undoable thing: "the
   * pin on this fact moved". The entry carries the COMPLETE pre- and post-image
   * snapshots (pin + the originating change's revert flags), because `revertFact`
   * writes both halves and only restoring both is a true inverse — see
   * research-engine/manuscript/historyOps.js.
   */
  const recordFactPin = useCallback((draftId, key, changeId, before, nextDraft) => {
    if (!draftId || !nextDraft) return;
    const after = captureFactPin(nextDraft, key, changeId);
    const pinSame = (!before.override && !after.override)
      || (!!before.override && !!after.override
        && String(before.override.value) === String(after.override.value));
    const flagSame = (!before.change === !after.change)
      && (!before.change || before.change.reverted === after.change.reverted);
    if (pinSame && flagSame) return;                 // nothing actually moved
    historyRef.current.record({
      kind: 'manuscript.factPin',
      label: 'Manuscript wording',
      entityKey: `${draftId}:${key}`,
      undoOp: { draftId, snapshot: before, expect: after },
      redoOp: { draftId, snapshot: after, expect: before },
    });
  }, []);

  /** Restore the previous wording of one fact (§10 "Restore previous wording"). */
  const revertFact = useCallback((key, change, opts = {}) => {
    if (!key) return;
    const beforeDraft = freshestDraft();
    const draftId = beforeDraft ? beforeDraft.id : null;
    const changeId = (change && change.id) ? change.id : null;
    const before = captureFactPin(beforeDraft, key, changeId);
    const nextDraft = mutateActive((d) => {
      const projectValue = resolvedFacts[key] ? resolvedFacts[key].raw : null;
      const value = opts.value != null ? opts.value : (change && change.from);
      if (value == null) return d;
      const { draft } = overrideFact(d, key, value, {
        nowIso: new Date().toISOString(),
        by: opts.by || '',
        reason: opts.reason || '',
        projectValue,
      });
      // §12 — the change is MARKED reverted, never removed. Provenance that can
      // simply disappear is not provenance.
      if (change && change.id) {
        const { draft: marked } = markChangeReverted(draft, change.id, {
          nowIso: new Date().toISOString(), by: opts.by || '',
        });
        return marked;
      }
      return draft;
    });
    recordFactPin(draftId, key, changeId, before, nextDraft);
  }, [mutateActive, resolvedFacts, freshestDraft, recordFactPin]);

  /** Drop a pin so the fact tracks project data again (§10 "Keep current wording"). */
  const keepCurrentFact = useCallback((key) => {
    if (!key) return;
    const beforeDraft = freshestDraft();
    const draftId = beforeDraft ? beforeDraft.id : null;
    const before = captureFactPin(beforeDraft, key, null);
    const nextDraft = mutateActive((d) => clearFactOverride(d, key).draft);
    recordFactPin(draftId, key, null, before, nextDraft);
  }, [mutateActive, freshestDraft, recordFactPin]);

  /* ══════════ 101.md §6/§34 — Show Changes ══════════
   *
   * Purely a VIEW state. It never alters stored content, which is what makes
   * §6's "the underlying manuscript content should be identical in both modes"
   * true by construction rather than by discipline. Persisted per browser like
   * the other editor preferences.
   */
  const [showChanges, setShowChangesState] = useState(() => {
    try { return window.localStorage.getItem('ms-show-changes') === '1'; } catch { return false; }
  });
  const setShowChanges = useCallback((next) => {
    setShowChangesState(!!next);
    try { window.localStorage.setItem('ms-show-changes', next ? '1' : '0'); } catch { /* private mode */ }
  }, []);

  /** Grouped recent updates for the Change Tracking panel (§34). Newest first. */
  const changeGroups = useMemo(
    () => groupChanges((activeDraft && activeDraft.factLog) || []),
    [activeDraft],
  );

  return {
    drafts: effectiveDrafts, activeDraft, activeId, setActiveId,
    saveState, lastError, retry,
    runMeta,
    gradeByOutcome,
    prismaCounts, primary, tables, references, readiness, insights, staleness,
    /* 117.md §26-§39 — the reference-library surface. `references` above is the
       ORDERED, formatted bibliography (each row carrying `cited`); everything here
       is what the library manager, the citation picker and the chip menu need. */
    referenceLibrary: refLibrary,
    referenceAliases: refAliases,
    referenceKnownIds: citationKnownIds,
    refsById,
    citationUsage,
    citationOrderMap: citationOrder.orderMap,
    duplicateReferences,
    suppressedReferences: refLibrary.suppressed,
    referencesAreLegacy: legacyDraftRefs,
    addReference, editReference, mergeReferences,
    suppressReference, restoreReference, deleteReference, importReferences,
    insertCitationReference,
    // 73.md Parts 8/9 — live data wiring + provenance/outdated/lock surface.
    genOpts,
    sourcesSettled,
    sourcesFetchedAt,
    refreshSources,
    // 85.md B2 — asset registry + numbering/placement + export preparation.
    analyses, assets, assetNumbering, assetPlacements, draftUsesTokens,
    setAssetOverride, queueAssetPatch, insertAssetReference, prepareExport,
    // 117.md §4-§11 — the manual-table object surface: the live registry id set the
    // editor needs to tell a working cross-reference from a broken one, the
    // manual-table subset, and the side-metadata writer.
    knownAssetIds, manualTables, setTableMeta,
    dataStatus: sources.dataStatus,
    screening: sources.screening,
    // 117.md §12 — the canonical record-derived flow itself, so the export paths can
    // hand it to the figure builders (and a panel can show the §18 reconciliation)
    // without re-fetching or re-deriving it.
    prismaFlow: sources.prismaFlow,
    // 117.md §21/§22 — apply / revert one audited PRISMA data override, plus the
    // capped in-draft audit trail behind them.
    setPrismaOverride: setPrismaOverrideField,
    revertPrismaOverride,
    prismaOverrideLog: (activeDraft && activeDraft.prismaOverrideLog) || [],
    screeningWorkflow: sources.screeningWorkflow,
    searchMethodsText: sources.searchMethodsText,
    robAssessments: sources.robAssessments,
    robByStudyId: sources.robByStudyId,
    robUsage: sources.robUsage,
    searchProvenance: sources.searchProvenance,
    perSource: sources.perSource,
    // 101.md §4-§10 — the live fact surface: resolved values, the clean renderer,
    // grouped provenance, Show Changes state, and the manuscript-only reverts.
    resolvedFacts, usedFactKeys, renderSection, factOverrides, discrepancies,
    changeGroups, revertFact, keepCurrentFact,
    showChanges, setShowChanges,
    // 102.md §1/§2/§5 — the manual-field surface: what is unresolved, how many,
    // where each one lives, and which the researcher is currently on.
    placeholders, placeholderStats, placeholderGroups,
    currentPlaceholderId, setCurrentPlaceholderId, nextPlaceholder,
    outdated, consistency, setSectionLocked,
    // 84.md — live manuscript sync surface for the Updates panel + freshness pills.
    freshDepState, contradictions, missingInfo, freshness, outdatedCount,
    syncPlan, refreshSyncPlan, decide, acceptAllSafe,
    snapshots: (activeDraft && activeDraft.snapshots) || [],
    createSnapshotNow, restoreSnapshotById, removeSnapshotById,
    updateSection, generate, refreshBlock, refreshAllBlocks,
    setMeta, setMetaDebounced, setStatement, updateDraft, addDraft, removeDraft,
    flush: flushPending,
  };
}

export default useManuscript;
