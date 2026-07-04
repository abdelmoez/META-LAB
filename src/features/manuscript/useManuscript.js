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
} from '../../research-engine/manuscript/index.js';
import { generateDraft } from '../../research-engine/manuscript/draft.js';
import { gradeCertaintyEnabled, sofCertaintyMap } from '../../frontend/workspace/gradeApi.js';
import * as MS from './manuscriptState.js';
import {
  emptyManuscriptSources, fetchManuscriptSources, linkedScreenProjectId, composeGenOpts,
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

  const flushPending = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    const list = readManuscripts(projectRef.current);
    const base = list.find((d) => d.id === p.draftId);
    if (!base) { setSaveState('saved'); return; }
    const next = applyPatches(base, p.fields);
    persist(MS.upsertDraft(list, next));
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
  // flushing any pending typing so user edits are never lost.
  const mutateActive = useCallback((mutator) => {
    flushPending();
    const list = readManuscripts(projectRef.current);
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
  const screenPid = linkedScreenProjectId(project);
  useEffect(() => {
    let alive = true;
    setSources(emptyManuscriptSources());
    if (!pid) return undefined;
    fetchManuscriptSources({ projectId: pid, screenProjectId: screenPid })
      .then((r) => { if (alive && r) setSources(r); })
      .catch(() => { /* orchestrator is soft-fail; belt-and-braces */ });
    return () => { alive = false; };
  }, [pid, screenPid]);

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
  const freshHashes = useMemo(() => {
    if (!activeDraft) return {};
    try {
      return computeSectionInputsHashes(project, { ...genOpts, prismaCounts, templateId: activeDraft.templateId });
    } catch { return {}; }
  }, [project, genOpts, prismaCounts, activeDraft]);
  const outdated = useMemo(
    () => MS.computeOutdatedSections(activeDraft, freshHashes),
    [activeDraft, freshHashes],
  );

  // 73.md Part 9 — cross-artefact consistency checks (also folded into
  // smartInsights by the engine; the raw list powers the Overview card + jumps).
  const consistency = useMemo(() => {
    if (!activeDraft) return [];
    try { return checkConsistency(project, activeDraft, { ...genOpts, prismaCounts }); } catch { return []; }
  }, [project, activeDraft, genOpts, prismaCounts]);

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
      const res = MS.applyGeneratedSections(active, generated, opts);
      skipped = res.skipped;
      skippedLocked = res.skippedLocked || [];
      return res.draft;
    });
    return { skipped, skippedLocked };
  }, [mutateActive, project, genOpts, prismaCounts, primary]);

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
    dataStatus: sources.dataStatus,
    screening: sources.screening,
    screeningWorkflow: sources.screeningWorkflow,
    searchMethodsText: sources.searchMethodsText,
    robAssessments: sources.robAssessments,
    robByStudyId: sources.robByStudyId,
    perSource: sources.perSource,
    outdated, consistency, setSectionLocked,
    updateSection, generate, refreshBlock, refreshAllBlocks,
    setMeta, setMetaDebounced, setStatement, updateDraft, addDraft, removeDraft,
    flush: flushPending,
  };
}

export default useManuscript;
