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
      const s = await aiApi.scores(pid, stage);
      if (mounted.current) setScores(s.scores || {});
      return s;
    } catch { return null; }
  }, [pid, stage]);

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

  const sendFeedback = useCallback(async (rid, body) => {
    try { return await aiApi.feedback(pid, rid, body); } catch { return null; }
  }, [pid]);

  const updateSettings = useCallback(async (body) => {
    const out = await aiApi.updateSettings(pid, body);
    await loadStatus();
    return out;
  }, [pid, loadStatus]);

  const getValidation = useCallback(() => aiApi.validation(pid, stage).catch(() => null), [pid, stage]);

  return {
    enabled, ready, status, scores, running, error,
    run, getExplanation, sendFeedback, updateSettings, getValidation,
    refresh: loadScores,
  };
}
