/**
 * features/prisma/usePrismaFlow.js — 103.md §10/§15, 116.md §8/§11.
 *
 * Fetches the canonical, record-derived PRISMA flow for a project's linked
 * screening workspace. One hook, so every surface that shows PRISMA numbers reads
 * the SAME derivation rather than recomputing its own.
 *
 * 116.md §11 — the /prisma payload is now SLIM (per-box counts + breakdown rows,
 * no id arrays, no record list): a 50k-record project used to ship megabytes of
 * UUIDs on every visit. The record lists behind each box are paginated on demand
 * through GET /prisma/box/:boxId/records (the inspector's endpoint), so `records`
 * no longer exists here.
 *
 * Soft-fail by design: no linked workspace, no records, a disabled feature or a
 * network error all leave `flow` null, and the caller falls back to whatever it did
 * before. An unavailable flow must never blank out a working screen.
 */
import { useState, useEffect, useCallback } from 'react';

/**
 * @param {string|null} screenProjectId  the linked ScreenProject id
 * @returns {{ flow, reconciliation, loading, error, empty, refetch }}
 */
export function usePrismaFlow(screenProjectId) {
  const [state, setState] = useState({
    flow: null, reconciliation: null, loading: false, error: null, empty: false,
  });
  // 116.md §9.8 — bumping this refetches after an inspector edit, so the counts
  // a researcher just changed are the counts on screen.
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!screenProjectId) {
      setState({ flow: null, reconciliation: null, loading: false, error: null, empty: false });
      return undefined;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const res = await fetch(`/api/screening/projects/${encodeURIComponent(screenProjectId)}/prisma`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        if (!alive) return;
        setState({
          flow: d && d.flow ? d.flow : null,
          reconciliation: (d && d.reconciliation) || (d && d.flow && d.flow.reconciliation) || null,
          loading: false,
          error: null,
          empty: !!(d && d.empty),
        });
      } catch (e) {
        if (!alive) return;
        // The flow is evidence, not enrichment — absent means "we do not know",
        // and the caller keeps its previous behaviour.
        setState({
          flow: null, reconciliation: null, loading: false,
          error: (e && e.message) || 'Could not load the PRISMA flow', empty: false,
        });
      }
    })();

    return () => { alive = false; };
  }, [screenProjectId, reloadKey]);

  return { ...state, refetch };
}

export default usePrismaFlow;
