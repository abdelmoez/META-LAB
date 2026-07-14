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
  generateReferenceList, referencesFromProject, orderReferencesForManuscript,
  computeReadiness, smartInsights,
  evaluateStaleness, primaryAnalysis,
  computeSectionInputsHashes, checkConsistency,
  // 84.md — live manuscript sync: dependency graph, sync plan, contradictions,
  // missing-info, freshness rollup and version snapshots (all pure engine).
  computeDependencyState, buildSyncPlan, applySyncDecision,
  detectContradictions, collectMissingInfo, computeFreshness,
  createSnapshot, restoreSnapshot, removeSnapshot,
} from '../../research-engine/manuscript/index.js';
import { generateDraft } from '../../research-engine/manuscript/draft.js';
import { gradeCertaintyEnabled, sofCertaintyMap } from '../../frontend/workspace/gradeApi.js';
import * as MS from './manuscriptState.js';
import {
  emptyManuscriptSources, fetchManuscriptSources, linkedScreenProjectId, composeGenOpts,
  sourceAvailability,
} from './manuscriptData.js';

export function useManuscript(project, upd) {
  const drafts = useMemo(() => readManuscripts(project), [project]);
  const [activeId, setActiveId] = useState(null);
  const [localSeed, setLocalSeed] = useState(null); // read-only fallback (upd is a no-op)
  const [saveState, setSaveState] = useState('saved'); // 'saved' | 'saving' | 'error' (UX-6)
  const [lastError, setLastError] = useState(null);

  // Refs to the freshest committed values (avoid stale-closure writes).
  const projectRef = useRef(project);
  const activeIdRef = useRef(activeId);
  useEffect(() => { projectRef.current = project; });
  useEffect(() => { activeIdRef.current = activeId; });

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
    pending.current.fields.set(`${kind}:${key}`, value);
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
  const screenPid = linkedScreenProjectId(project);
  useEffect(() => {
    let alive = true;
    setSources(emptyManuscriptSources());
    setSourcesSettled(false);
    if (!pid) { setSourcesSettled(true); return undefined; }
    fetchManuscriptSources({ projectId: pid, screenProjectId: screenPid })
      .then((r) => { if (alive) { if (r) setSources(r); setSourcesSettled(true); } })
      .catch(() => { if (alive) setSourcesSettled(true); /* orchestrator is soft-fail; belt-and-braces */ });
    return () => { alive = false; };
  }, [pid, screenPid]);
  const availability = useMemo(() => sourceAvailability(sources), [sources]);

  const genOpts = useMemo(
    () => composeGenOpts({ project, runMeta, gradeByOutcome, sources }),
    [project, gradeByOutcome, sources],
  );

  /* ── derived engine data for the panels ── */
  const prismaCounts = useMemo(
    () => computePrismaCounts(project, {
      overrides: activeDraft && activeDraft.prismaOverrides,
      ...(sources.screening ? { screening: sources.screening } : {}),
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
  const references = useMemo(() => {
    const refs = (activeDraft && activeDraft.references && activeDraft.references.length)
      ? activeDraft.references : referencesFromProject(project);
    const style = (activeDraft && activeDraft.citationStyle) || 'vancouver';
    // order by inline-citation appearance when the draft uses inline citations
    const ordered = activeDraft ? orderReferencesForManuscript(activeDraft, refs) : refs;
    return generateReferenceList(ordered, style);
  }, [project, activeDraft]);
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
      return computeSectionInputsHashes(project, { ...genOpts, prismaCounts, templateId: activeDraft.templateId });
    } catch { return {}; }
  }, [project, genOpts, prismaCounts, activeDraft, sourcesSettled]);
  const outdated = useMemo(
    () => (fetchDegraded ? {} : MS.computeOutdatedSections(activeDraft, freshHashes, availability)),
    [activeDraft, freshHashes, availability, fetchDegraded],
  );

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
  // by blockId → { stale, lastRefreshedAt }).
  const staleBlocks = useMemo(
    () => Object.keys(staleness || {}).filter((k) => staleness[k] && staleness[k].stale),
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
        ...genOpts, prismaCounts, primary, templateId: activeDraft.templateId,
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
      label: label || '', frozen: !!frozen, author: (project && project._me && project._me.name) || null,
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
    queueEdit(activeDraft.id, 'section', id, content);
  }, [activeDraft, queueEdit]);

  // 73.md Part 9 — per-section lock toggle (persisted through the same path).
  const setSectionLocked = useCallback((id, locked) => {
    mutateActive((d) => MS.setSectionLocked(d, id, locked));
  }, [mutateActive]);

  const setStatement = useCallback((id, val) => {
    if (activeDraft) queueEdit(activeDraft.id, 'statement', id, val);
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
      const generated = generateDraft(project, {
        ...genOpts, prismaCounts, primary, templateId: active.templateId,
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

  const updateDraft = useCallback((nextDraft) => {
    flushPending();
    const list = readManuscripts(projectRef.current);
    persist(MS.upsertDraft(list, nextDraft));
  }, [flushPending, persist]);

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

  return {
    drafts: effectiveDrafts, activeDraft, activeId, setActiveId,
    saveState, lastError, retry,
    runMeta,
    gradeByOutcome,
    prismaCounts, primary, tables, references, readiness, insights, staleness,
    // 73.md Parts 8/9 — live data wiring + provenance/outdated/lock surface.
    genOpts,
    sourcesSettled,
    dataStatus: sources.dataStatus,
    screening: sources.screening,
    screeningWorkflow: sources.screeningWorkflow,
    searchMethodsText: sources.searchMethodsText,
    robAssessments: sources.robAssessments,
    robByStudyId: sources.robByStudyId,
    perSource: sources.perSource,
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
