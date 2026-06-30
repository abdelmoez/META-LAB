/**
 * features/manuscript/useManuscript.js — 64.md (P3). React hook that binds the
 * structured manuscript drafts to the project blob (via the existing `upd` autosave
 * path — no new server route), enforces the "don't overwrite user edits" rule, and
 * exposes engine-derived data (prisma counts, tables, references, readiness,
 * insights, staleness) to the panels.
 *
 * Parity: the SAME runMeta the Analysis/Forest tabs use (monolithStats) is threaded
 * into every engine call, so manuscript numbers can never drift from the figures.
 */
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { runMeta } from '../../research-engine/statistics/monolithStats.js';
import {
  readManuscripts,
  computePrismaCounts,
  buildStudyCharacteristicsTable, buildSummaryOfFindingsTable, buildPrismaCountsTable,
  buildRobTable, buildSearchStrategyTable,
  generateReferenceList, referencesFromProject,
  computeReadiness, smartInsights,
  evaluateStaleness, primaryAnalysis,
} from '../../research-engine/manuscript/index.js';
import { generateDraft } from '../../research-engine/manuscript/draft.js';
import * as MS from './manuscriptState.js';

export function useManuscript(project, upd) {
  const drafts = useMemo(() => readManuscripts(project), [project]);
  const [activeId, setActiveId] = useState(null);
  const [saveState, setSaveState] = useState('saved'); // 'saved' | 'saving'
  const saveTimer = useRef(null);
  const pendingDraft = useRef(null);

  // Ensure ≥1 draft (seed from legacy on first use); keep activeId valid.
  useEffect(() => {
    if (!drafts.length) {
      const { drafts: seeded } = MS.ensureDrafts(project);
      upd('manuscripts', seeded);
      setActiveId(seeded[0].id);
    } else if (!activeId || !drafts.find((d) => d.id === activeId)) {
      setActiveId(drafts[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts.length]);

  const activeDraft = useMemo(
    () => drafts.find((d) => d.id === activeId) || drafts[0] || null,
    [drafts, activeId],
  );

  const persistNow = useCallback((nextDraft) => {
    const arr = MS.upsertDraft(readManuscripts(project), nextDraft);
    upd('manuscripts', arr);
    setSaveState('saved');
  }, [project, upd]);

  // Debounced persist for high-frequency edits (typing). Structural changes use persistNow.
  const persistDebounced = useCallback((nextDraft) => {
    pendingDraft.current = nextDraft;
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (pendingDraft.current) persistNow(pendingDraft.current);
      pendingDraft.current = null;
    }, 600);
  }, [persistNow]);

  // Flush pending edits on unmount.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (pendingDraft.current) persistNow(pendingDraft.current);
  }, [persistNow]);

  const genOpts = useMemo(() => ({ runMeta, prec: project && project.analysisPrecision }), [project]);

  /* ── derived engine data for the panels ── */
  const prismaCounts = useMemo(
    () => computePrismaCounts(project, { overrides: activeDraft && activeDraft.prismaOverrides }),
    [project, activeDraft],
  );
  const primary = useMemo(() => primaryAnalysis(project, genOpts), [project, genOpts]);
  const tables = useMemo(() => ({
    study: buildStudyCharacteristicsTable(project, {}),
    sof: buildSummaryOfFindingsTable(project, genOpts),
    prisma: buildPrismaCountsTable(prismaCounts),
    rob: buildRobTable(project, {}),
    search: buildSearchStrategyTable(project, {}),
  }), [project, genOpts, prismaCounts]);
  const references = useMemo(() => {
    const refs = (activeDraft && activeDraft.references && activeDraft.references.length)
      ? activeDraft.references : referencesFromProject(project);
    return generateReferenceList(refs, (activeDraft && activeDraft.citationStyle) || 'vancouver');
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

  /* ── mutations ── */
  const updateSection = useCallback((id, content) => {
    if (!activeDraft) return;
    persistDebounced(MS.setSection(activeDraft, id, content));
  }, [activeDraft, persistDebounced]);

  const generate = useCallback((opts = {}) => {
    if (!activeDraft) return { skipped: [] };
    const generated = generateDraft(project, { ...genOpts, prismaCounts, primary });
    const { draft, skipped } = MS.applyGeneratedSections(activeDraft, generated, opts);
    persistNow(draft);
    return { skipped };
  }, [activeDraft, project, genOpts, prismaCounts, primary, persistNow]);

  const refreshBlock = useCallback((blockId) => {
    if (!activeDraft) return;
    persistNow(MS.markBlockRefreshed(activeDraft, blockId, project));
  }, [activeDraft, project, persistNow]);

  const refreshAllBlocks = useCallback(() => {
    if (!activeDraft) return;
    persistNow(MS.markAllBlocksRefreshed(activeDraft, project));
  }, [activeDraft, project, persistNow]);

  const setMeta = useCallback((patch) => { if (activeDraft) persistNow(MS.setMeta(activeDraft, patch)); }, [activeDraft, persistNow]);
  const setStatement = useCallback((id, val) => { if (activeDraft) persistDebounced(MS.setStatement(activeDraft, id, val)); }, [activeDraft, persistDebounced]);
  const updateDraft = useCallback((nextDraft) => persistNow(nextDraft), [persistNow]);

  const addDraft = useCallback((opts = {}) => {
    const d = MS.newDraft(project, opts);
    const arr = MS.upsertDraft(readManuscripts(project), d);
    upd('manuscripts', arr);
    setActiveId(d.id);
    return d;
  }, [project, upd]);

  const removeDraft = useCallback((id) => {
    const arr = readManuscripts(project).filter((d) => d.id !== id);
    upd('manuscripts', arr);
    if (id === activeId) setActiveId(arr[0] ? arr[0].id : null);
  }, [project, upd, activeId]);

  return {
    drafts, activeDraft, activeId, setActiveId,
    saveState,
    runMeta,
    prismaCounts, primary, tables, references, readiness, insights, staleness,
    updateSection, generate, refreshBlock, refreshAllBlocks,
    setMeta, setStatement, updateDraft, addDraft, removeDraft,
  };
}

export default useManuscript;
