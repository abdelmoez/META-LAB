/**
 * research/useResearchGovernance.js — the single loader/writer the Research
 * Governance sub-tabs share for the typed `researchGovernanceSettings` block.
 *
 * Design notes:
 *  - PER-SETTING writes. The server PUT is a read-merge-write keyed by catalogue
 *    key, so sending one key at a time means two admins editing different sub-tabs
 *    cannot clobber each other the way the whole-blob appSettings PUT does
 *    (AdminConsole's SettingsSection carries that hazard; this does not).
 *  - WIPE SAFETY. If the initial GET fails, `loadFailed` is set and every write is
 *    refused — copying SettingsSection's guard, so a failed load can never push
 *    client defaults over stored values.
 *  - The server re-coerces everything against the same catalogue and returns the
 *    stored result, so state is always replaced with what was actually persisted
 *    (a clamped number visibly snaps back).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi } from '../adminApiClient.js';
import {
  RESEARCH_GOVERNANCE_KEY, defaultsForDomain, mergeDomainDefaults,
} from '../../../../shared/opsSettingsCatalog.js';

/** Catalogue defaults, used until the GET answers (and if it never does). */
const CATALOG_DEFAULTS = defaultsForDomain(RESEARCH_GOVERNANCE_KEY);

/**
 * This entry's row in a writer `rejected:[{key,error}]` list, if it has one. The
 * server may key a rejection by catalogue key or by stored path, so both are matched
 * (same rule on the success and the 400 path — exported for the unit test).
 */
export function rejectedFor(rejected, entry) {
  if (!Array.isArray(rejected) || !entry) return null;
  return rejected.find((r) => r && typeof r.error === 'string' && (r.key === entry.key || r.key === entry.path)) || null;
}

export function useResearchGovernance() {
  const [settings, setSettings] = useState(null);   // null = not loaded yet
  const [defaults, setDefaults] = useState(CATALOG_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState('');   // catalogue key currently in flight
  const [lastSaved, setLastSaved] = useState('');   // catalogue key of the last success
  const alive = useRef(true);

  // Re-arm on mount, not just on unmount: StrictMode double-invokes effects in dev,
  // so a cleanup-only guard would leave `alive` false forever after the first
  // teardown and silently swallow every subsequent state update.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await adminApi.researchGovernance.get();
      if (!alive.current) return;
      setSettings(mergeDomainDefaults(RESEARCH_GOVERNANCE_KEY, d?.settings));
      setDefaults({ ...CATALOG_DEFAULTS, ...(d?.defaults || {}) });
      setLoadFailed(false);
    } catch (e) {
      if (!alive.current) return;
      setLoadFailed(true);
      setError(e?.message || 'Could not load the research governance settings.');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Persist ONE catalogue entry. Returns true on success. `reason` is optional and
   * lands in AdminAuditLog.reason next to the per-setting from→to diff.
   */
  const saveEntry = useCallback(async (entry, value, reason) => {
    if (!entry || loadFailed) return false;
    setSavingKey(entry.key);
    setError('');
    try {
      const res = await adminApi.researchGovernance.save({
        [entry.key]: value,
        ...(reason ? { reason } : {}),
      });
      if (!alive.current) return true;
      setSettings(mergeDomainDefaults(RESEARCH_GOVERNANCE_KEY, res?.settings));
      if (res?.defaults) setDefaults({ ...CATALOG_DEFAULTS, ...res.defaults });
      const mine = rejectedFor(res?.rejected, entry);
      if (mine) { setError(`${entry.label}: ${mine.error}`); return false; }
      setLastSaved(entry.key);
      return true;
    } catch (e) {
      // 109 r2 review fix — SURFACE THE WRITER'S PER-SETTING REASON. saveEntry sends
      // exactly one catalogue key, so a coercion failure means `rejected.length > 0`
      // AND `changed.length === 0`, which the server answers with 400 — adminApi
      // throws and the success-path `rejected` check above can never run. The admin
      // saw only "No valid settings provided" while the catalogue's real message
      // ("Expected one of: …", "Expected a number") sat unread in the error body,
      // which adminApiClient's req() already attaches as `err.body`.
      const mine = rejectedFor(e?.body?.rejected, entry);
      if (alive.current) setError(mine ? `${entry.label}: ${mine.error}` : (e?.message || 'Save failed.'));
      return false;
    } finally {
      if (alive.current) setSavingKey('');
    }
  }, [loadFailed]);

  /** 109.md §43 — what WOULD change, without writing. → [{key,label,from,to,...}] */
  const resetPreview = useCallback(async () => {
    const res = await adminApi.researchGovernance.reset({ preview: true });
    return Array.isArray(res?.changes) ? res.changes : [];
  }, []);

  /** Commit the reset. Configuration only — never touches research data. */
  const resetCommit = useCallback(async (reason) => {
    const res = await adminApi.researchGovernance.reset(reason ? { reason } : {});
    if (!alive.current) return;
    setSettings(mergeDomainDefaults(RESEARCH_GOVERNANCE_KEY, res?.settings));
    if (res?.defaults) setDefaults({ ...CATALOG_DEFAULTS, ...res.defaults });
  }, []);

  /** Effective value for an entry (falls back to the catalogue default pre-load). */
  const valueOf = useCallback((entry) => {
    if (!entry || !entry.path) return undefined;
    const src = settings || CATALOG_DEFAULTS;
    return src[entry.path];
  }, [settings]);

  const defaultOf = useCallback((entry) => (entry && entry.path ? defaults[entry.path] : undefined), [defaults]);

  return {
    settings, defaults, loading, loadFailed, error, setError,
    savingKey, lastSaved, load, saveEntry, resetPreview, resetCommit,
    valueOf, defaultOf,
    /** True once the server payload has arrived — controls render disabled until then. */
    ready: settings !== null,
  };
}

export default useResearchGovernance;
