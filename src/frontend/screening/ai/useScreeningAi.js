// useScreeningAi.js — React hook wrapping the AI screening engine for one project.
//
// Self-detecting: it calls /ai/status once; a 404 means the `aiScreening` feature
// flag is off, so the hook reports { enabled:false } and renders nothing (no UI
// edits needed elsewhere to gate on the flag). All network calls are best-effort
// and never throw into the render tree — failures degrade to "AI unavailable".
import { useState, useEffect, useCallback, useRef } from 'react';
import { aiApi } from './aiApi.js';

export function useScreeningAi(pid, stage = 'title_abstract') {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);     // first status probe finished
  const [status, setStatus] = useState(null);
  const [scores, setScores] = useState({});       // recordId → score summary
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  // 58.md §8 — AI-score visibility gate. Below the threshold the server withholds
  // scores; `gate` drives the "X/50 screened" placeholder + the admin override.
  const [gate, setGate] = useState({ scoresHidden: false, screenedCount: 0, threshold: 50, belowThreshold: false, canOverride: false, overrideApplied: false });
  const [override, setOverrideState] = useState(false);
  const overrideRef = useRef(false);
  const explCache = useRef(new Map());
  // Guard against setState after the screening tab unmounts mid-request (a slow
  // scoring run resolving after navigate-away). React 18 silently drops these,
  // but the guard keeps it explicit and avoids wasted renders.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const loadStatus = useCallback(async () => {
    try {
      const s = await aiApi.status(pid, stage);
      if (mounted.current) { setStatus(s); setEnabled(!!s.enabled); }
      return s;
    } catch (e) {
      // 404 → feature flag off (silent). Other errors → disabled too, but note.
      if (mounted.current) {
        setEnabled(false);
        if (e.status && e.status !== 404) setError(e.message || 'AI unavailable');
      }
      return null;
    } finally {
      if (mounted.current) setReady(true);
    }
  }, [pid, stage]);

  const loadScores = useCallback(async () => {
    try {
      const s = await aiApi.scores(pid, stage, overrideRef.current);
      if (mounted.current) {
        setScores(s.scores || {});
        setGate({
          scoresHidden: !!s.scoresHidden, screenedCount: s.screenedCount || 0,
          threshold: s.threshold || 50, belowThreshold: !!s.belowThreshold,
          canOverride: !!s.canOverride, overrideApplied: !!s.overrideApplied,
        });
      }
      return s;
    } catch { return null; }
  }, [pid, stage]);

  // Admin testing-override: flip and re-fetch (server re-checks the admin role).
  const setOverride = useCallback(async (on) => {
    overrideRef.current = !!on; setOverrideState(!!on);
    await loadScores();
  }, [loadScores]);

  useEffect(() => {
    let live = true;
    (async () => {
      const s = await loadStatus();
      if (live && s && s.enabled) await loadScores();
    })();
    return () => { live = false; };
  }, [loadStatus, loadScores]);

  const run = useCallback(async () => {
    setRunning(true); setError('');
    try {
      // 62.md — scoring no longer blocks: this ENQUEUES a job and returns { jobId }.
      const out = await aiApi.run(pid, stage);
      explCache.current.clear();
      // Kick the progress poller (job status flips to queued/updating); scores refresh
      // when the background job completes — via realtime ai.updated or the poller's
      // idle-transition below. The user can keep working meanwhile.
      try { const js = await aiApi.jobStatus(pid, stage); if (mounted.current) setJobStatus(js); } catch { /* ignore */ }
      return out;
    } catch (e) {
      if (mounted.current) setError(e.message || 'Failed to start scoring');
      throw e;
    } finally {
      if (mounted.current) setRunning(false);
    }
  }, [pid, stage]);

  const getExplanation = useCallback(async (rid) => {
    if (explCache.current.has(rid)) return explCache.current.get(rid);
    try {
      const e = await aiApi.explanation(pid, rid, stage);
      explCache.current.set(rid, e);
      return e;
    } catch { return null; }
  }, [pid, stage]);

  const refreshExplanation = useCallback((rid) => { explCache.current.delete(rid); }, []);

  const sendFeedback = useCallback(async (rid, body) => {
    try { return await aiApi.feedback(pid, rid, body); } catch { return null; }
  }, [pid]);

  const updateSettings = useCallback(async (body) => {
    const out = await aiApi.updateSettings(pid, body);
    await loadStatus();
    return out;
  }, [pid, loadStatus]);

  const getValidation = useCallback(() => aiApi.validation(pid, stage).catch(() => null), [pid, stage]);

  // 66.md P4.3 — citation-graph enrichment. Status is best-effort; the fetch job is
  // leader-gated server-side. `citationEnriching` keeps the button busy between the
  // 202 and the next status refresh so it can't be double-triggered.
  const [citationEnriching, setCitationEnriching] = useState(false);
  const getCitationStatus = useCallback(() => aiApi.citationStatus(pid, stage).catch(() => null), [pid, stage]);
  const startCitationEnrichment = useCallback(async () => {
    setCitationEnriching(true);
    try { return await aiApi.startCitationEnrichment(pid, stage); }
    catch (e) { if (mounted.current) setCitationEnriching(false); throw e; }
  }, [pid, stage]);

  // 66.md P4.6 — representative validation sample (seeded random). Creation is
  // leader-gated server-side; both calls fail silently so the panel still renders.
  const getValidationSample = useCallback(() => aiApi.validationSample(pid, stage).catch(() => null), [pid, stage]);
  const createValidationSample = useCallback((body) => aiApi.createValidationSample(pid, { stage, ...(body || {}) }), [pid, stage]);

  // se2.md §11 — model version history + rollback.
  const getVersions = useCallback(() => aiApi.versions(pid, stage).catch(() => null), [pid, stage]);
  const rollback = useCallback(async (runId) => {
    setRunning(true); setError('');
    try {
      const out = await aiApi.rollback(pid, runId, stage);
      explCache.current.clear();
      await Promise.all([loadStatus(), loadScores()]);
      return out;
    } catch (e) {
      if (mounted.current) setError(e.message || 'Rollback failed');
      throw e;
    } finally {
      if (mounted.current) setRunning(false);
    }
  }, [pid, stage, loadStatus, loadScores]);

  // se2.md §6 — live rescoring state. jobStatus drives the "Scores updating" UI;
  // rankingsAvailable prompts a (position-preserving) queue refresh.
  const [jobStatus, setJobStatus] = useState({ state: 'idle', running: false, queued: false, pending: 0 });
  const [rankingsAvailable, setRankingsAvailable] = useState(false);

  const loadJobStatus = useCallback(async () => {
    try { const js = await aiApi.jobStatus(pid, stage); if (mounted.current) setJobStatus(js); return js; }
    catch { return null; }
  }, [pid, stage]);

  // Called by the screening tab on a realtime `ai.updated` event (rescore done):
  // refresh scores + status, and flag that fresher rankings are available so the
  // reviewer can refresh the queue order WITHOUT being yanked off the current record.
  const onScoresUpdated = useCallback(async () => {
    explCache.current.clear();
    await Promise.all([loadScores(), loadStatus(), loadJobStatus()]);
    if (mounted.current) setRankingsAvailable(true);
  }, [loadScores, loadStatus, loadJobStatus]);
  const clearRankingsAvailable = useCallback(() => setRankingsAvailable(false), []);

  // Bounded poll while a rescore is in flight (efficient: stops at idle). Realtime
  // `ai.updated` is the primary completion signal; this just keeps the indicator live.
  useEffect(() => {
    if (!enabled) return;
    if (jobStatus.state === 'idle') return;
    let n = 0; let live = true;
    // 62.md — cap covers a multi-minute large run as a FALLBACK; realtime ai.updated is
    // still the primary completion signal.
    const finish = async () => {
      // Refresh scores/status when the run leaves flight — even without a realtime event
      // (tab reopened, SSE dropped). Position-preserving — the queue isn't yanked.
      explCache.current.clear();
      await Promise.all([loadScores(), loadStatus()]);
      if (mounted.current) setRankingsAvailable(true);
    };
    const id = setInterval(async () => {
      // 62.md rec round: on hitting the fallback cap, still do a final refresh so a run that
      // outlived the poller (or whose realtime event was missed) isn't stuck "updating…".
      if (!live || ++n > 120) { clearInterval(id); if (live) await finish(); return; }
      const js = await loadJobStatus();
      if (js && js.state === 'idle') { clearInterval(id); await finish(); }
    }, 2500);
    return () => { live = false; clearInterval(id); };
  }, [enabled, jobStatus.state, loadJobStatus, loadScores, loadStatus]);

  return {
    enabled, ready, status, scores, running, error,
    gate, override, setOverride, // 58.md §8 — score-visibility threshold + admin override
    run, getExplanation, refreshExplanation, sendFeedback, updateSettings, getValidation,
    getVersions, rollback,
    // 66.md P4.3/P4.6 — citation enrichment + representative validation sample.
    getCitationStatus, startCitationEnrichment, citationEnriching,
    getValidationSample, createValidationSample,
    refresh: loadScores,
    jobStatus, loadJobStatus, onScoresUpdated, rankingsAvailable, clearRankingsAvailable,
  };
}
