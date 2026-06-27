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
      const out = await aiApi.run(pid, stage);
      explCache.current.clear();
      await Promise.all([loadStatus(), loadScores()]);
      return out;
    } catch (e) {
      if (mounted.current) setError(e.message || 'Scoring failed');
      throw e;
    } finally {
      if (mounted.current) setRunning(false);
    }
  }, [pid, stage, loadStatus, loadScores]);

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
    const id = setInterval(async () => {
      if (!live || ++n > 20) { clearInterval(id); return; }
      const js = await loadJobStatus();
      if (js && js.state === 'idle') clearInterval(id);
    }, 3500);
    return () => { live = false; clearInterval(id); };
  }, [enabled, jobStatus.state, loadJobStatus]);

  return {
    enabled, ready, status, scores, running, error,
    gate, override, setOverride, // 58.md §8 — score-visibility threshold + admin override
    run, getExplanation, refreshExplanation, sendFeedback, updateSettings, getValidation,
    getVersions, rollback,
    refresh: loadScores,
    jobStatus, loadJobStatus, onScoresUpdated, rankingsAvailable, clearRankingsAvailable,
  };
}
