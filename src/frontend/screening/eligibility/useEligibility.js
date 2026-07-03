// useEligibility.js — React hook wrapping the Criteria Screener (P10) for one project.
//
// Self-detecting: it calls GET .../eligibility once; a 404 means the
// `eligibilityScreening` feature flag is off, so the hook reports { enabled:false }
// and every eligibility surface renders nothing (behaviour identical to today — no
// gating edits needed elsewhere). All network calls are best-effort and never throw
// into the render tree; failures degrade to "unavailable". Mirrors useScreeningAi.
import { useState, useEffect, useCallback, useRef } from 'react';
import { eligibilityApi } from './eligibilityApi.js';

export function useEligibility(pid) {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);       // first status probe finished
  const [criteria, setCriteria] = useState([]);
  const [criteriaVersion, setCriteriaVersion] = useState(0);
  const [settings, setSettings] = useState(null);
  const [summary, setSummary] = useState(null);     // { assessed, autoApplied, pendingReview }
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [jobStatus, setJobStatus] = useState({ status: 'idle', processed: 0, total: 0, nAssessed: 0, nAutoApplied: 0 });

  const assessCache = useRef(new Map());            // recordId → assessment
  // Guard against setState after the tab unmounts mid-request.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const d = await eligibilityApi.get(pid);
      if (mounted.current) {
        // A 200 means the `eligibilityScreening` flag is ON (the endpoint 404s when
        // it is off) — that IS the self-detect signal, exactly like useScreeningAi.
        // Per-project on/off lives in settings and gates runs server-side; it must
        // not hide the criteria builder, or a leader could never author criteria.
        setEnabled(true);
        setCriteria(Array.isArray(d.criteria) ? d.criteria : []);
        setCriteriaVersion(d.criteriaVersion || 0);
        setSettings(d.settings || null);
        setSummary(d.summary || null);
      }
      return d;
    } catch (e) {
      // 404 → feature flag off (silent). Other errors → disabled too, but noted.
      if (mounted.current) {
        setEnabled(false);
        if (e.status && e.status !== 404) setError(e.message || 'Eligibility unavailable');
      }
      return null;
    } finally {
      if (mounted.current) setReady(true);
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  const saveCriteria = useCallback(async (next) => {
    const out = await eligibilityApi.saveCriteria(pid, next);
    assessCache.current.clear();
    await load();
    return out;
  }, [pid, load]);

  const loadJobStatus = useCallback(async (jobId) => {
    try { const js = await eligibilityApi.jobStatus(pid, jobId); if (mounted.current) setJobStatus(js); return js; }
    catch { return null; }
  }, [pid]);

  // Run the Criteria Screener over a scope. Inline result → 200 {assessments};
  // large scope → 202 {jobId} which we poll. Best-effort; sets `running` for the
  // button-busy state and refreshes the summary + per-record cache when done.
  const evaluate = useCallback(async (scope = 'undecided') => {
    setRunning(true); setError('');
    try {
      const out = await eligibilityApi.evaluate(pid, scope);
      assessCache.current.clear();
      if (out && out.jobId) {
        // Poll bounded — the job finishes in the background; stop at a terminal state.
        const jobId = out.jobId;
        let n = 0;
        const poll = async () => {
          const js = await loadJobStatus(jobId);
          const done = !js || js.status === 'done' || js.status === 'completed' || js.status === 'failed' || js.status === 'error';
          if (done || ++n > 120) { await load(); if (mounted.current) setRunning(false); return; }
          setTimeout(poll, 2000);
        };
        setTimeout(poll, 1200);
      } else {
        await load();
        if (mounted.current) setRunning(false);
      }
      return out;
    } catch (e) {
      if (mounted.current) { setError(e.message || 'Could not run the Criteria Screener'); setRunning(false); }
      throw e;
    }
  }, [pid, load, loadJobStatus]);

  const getRecordAssessment = useCallback(async (rid) => {
    if (!rid) return null;
    if (assessCache.current.has(rid)) return assessCache.current.get(rid);
    try {
      const a = await eligibilityApi.recordAssessment(rid);
      assessCache.current.set(rid, a);
      return a;
    } catch { return null; }
  }, []);
  const refreshRecordAssessment = useCallback((rid) => { assessCache.current.delete(rid); }, []);

  const adjudicate = useCallback(async (rid, body) => {
    const out = await eligibilityApi.adjudicate(rid, body);
    assessCache.current.delete(rid);
    load();
    return out;
  }, [load]);

  const undo = useCallback(async (rid) => {
    const out = await eligibilityApi.undo(rid);
    assessCache.current.delete(rid);
    load();
    return out;
  }, [load]);

  const updateSettings = useCallback(async (body) => {
    const out = await eligibilityApi.updateSettings(pid, body);
    await load();
    return out;
  }, [pid, load]);

  const getValidation = useCallback(() => eligibilityApi.validation(pid).catch(() => null), [pid]);
  const validationCsvUrl = eligibilityApi.validationCsvUrl(pid);

  return {
    enabled, ready, criteria, criteriaVersion, settings, summary, error,
    running, jobStatus,
    saveCriteria, evaluate, loadJobStatus,
    getRecordAssessment, refreshRecordAssessment,
    adjudicate, undo, updateSettings,
    getValidation, validationCsvUrl,
    refresh: load,
  };
}
