/**
 * features/prisma/usePrismaFlow.js — 103.md §10/§15.
 *
 * Fetches the canonical, record-derived PRISMA flow for a project's linked
 * screening workspace. One hook, so every surface that shows PRISMA numbers reads
 * the SAME derivation rather than recomputing its own.
 *
 * Soft-fail by design: no linked workspace, no records, a disabled feature or a
 * network error all leave `flow` null, and the caller falls back to whatever it did
 * before. An unavailable flow must never blank out a working screen.
 */
import { useState, useEffect } from 'react';

/**
 * @param {string|null} screenProjectId  the linked ScreenProject id
 * @returns {{ flow, reconciliation, records, loading, error, empty }}
 */
export function usePrismaFlow(screenProjectId) {
  const [state, setState] = useState({
    flow: null, reconciliation: null, records: null, loading: false, error: null, empty: false,
  });

  useEffect(() => {
    if (!screenProjectId) {
      setState({ flow: null, reconciliation: null, records: null, loading: false, error: null, empty: false });
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
          records: (d && d.records) || null,
          loading: false,
          error: null,
          empty: !!(d && d.empty),
        });
      } catch (e) {
        if (!alive) return;
        // The flow is evidence, not enrichment — absent means "we do not know",
        // and the caller keeps its previous behaviour.
        setState({
          flow: null, reconciliation: null, records: null, loading: false,
          error: (e && e.message) || 'Could not load the PRISMA flow', empty: false,
        });
      }
    })();

    return () => { alive = false; };
  }, [screenProjectId]);

  return state;
}

export default usePrismaFlow;
