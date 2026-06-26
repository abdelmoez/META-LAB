/**
 * useStitchProjectDoc.js — the per-page project loader + blob-autosave bridge for
 * native Stitch deep-tool pages (design3.md).
 *
 * A native Stitch page is NOT inside the legacy monolith, so it has no `upd` /
 * `updNested` / `window.storage` plumbing. This hook is the standalone equivalent:
 * it loads ONE project (`api.projects.get`) and exposes the SAME `upd(field,val)` /
 * `updNested(field,key,val)` write surface the legacy tool components expect — but
 * persisted via `api.projects.autosave(id, fullBlob)` (the exact endpoint the
 * monolith's debounced autosave uses), so there is ZERO data duplication and the
 * source of truth stays the one `Project.data` blob.
 *
 * Read-only is gated client-side (the server also no-ops read-only writers). Writes
 * are debounced (800ms, matching serverStorage) and flushed on unmount so nothing
 * is lost on navigation. Tools backed by their OWN server module (PICO/Protocol
 * when the flag is on, Search Builder, Discovery) ignore this and persist
 * independently — the bridge is only for blob fields.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api-client/apiClient.js';

const DEBOUNCE_MS = 800;

export function useStitchProjectDoc(projectId) {
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const projectRef = useRef(null);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = await api.projects.get(projectId);
      projectRef.current = p;
      setProject(p);
    } catch (e) {
      setError(e?.message || 'Could not load this project.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const readOnly = !!(project && (project._readOnly || (project._permissions && project._permissions.readOnly)));

  const persist = useCallback(async (blob) => {
    setSaveStatus('saving');
    try { await api.projects.autosave(projectId, blob); setSaveStatus('saved'); }
    catch { setSaveStatus('error'); }
  }, [projectId]);

  const scheduleSave = useCallback((blob) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; persist(blob); }, DEBOUNCE_MS);
  }, [persist]);

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (projectRef.current) persist(projectRef.current);
  }, [persist]);

  // Flush any pending write on unmount so navigation never drops an edit.
  useEffect(() => () => { if (timerRef.current) { clearTimeout(timerRef.current); if (projectRef.current) api.projects.autosave(projectId, projectRef.current).catch(() => {}); } }, [projectId]);

  // The canonical write choke point — the native equivalent of the legacy
  // workspace's `updateProject(id, updater)` (Workspace.jsx). The monolith tab
  // components (Extraction / PRISMA / RoB / Analysis) call this with the full
  // updater function; `upd`/`updNested` are thin wrappers over it. `id` is accepted
  // for signature parity with the legacy multi-project updater but this hook owns a
  // SINGLE project, so the loaded project is always the target. Read-only is gated
  // here (the server independently no-ops read-only autosaves — defense in depth).
  const updateProject = useCallback((id, updater) => {
    if (readOnly) return;
    setProject((prev) => {
      if (!prev) return prev;
      const base = typeof updater === 'function' ? updater(prev) : (updater || prev);
      const next = { ...base, modified: new Date().toISOString() };
      projectRef.current = next;
      scheduleSave(next);
      return next;
    });
  }, [readOnly, scheduleSave]);

  const upd = useCallback((field, val) => {
    updateProject(projectId, (p) => ({ ...p, [field]: val }));
  }, [updateProject, projectId]);

  const updNested = useCallback((field, key, val) => {
    updateProject(projectId, (p) => ({ ...p, [field]: { ...(p[field] || {}), [key]: val } }));
  }, [updateProject, projectId]);

  return { project, loading, error, reload: load, readOnly, upd, updNested, updateProject, saveStatus, flush };
}
