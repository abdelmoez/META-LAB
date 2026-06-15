/**
 * AppWorkspace.jsx
 *
 * Wraps the META·LAB monolith with:
 *  - The shared account UserMenu fixed at top-right (same component META·SIFT uses)
 *  - An autosave status indicator (bottom-right, non-interactive)
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { subscribeToSaveStatus, flushStorage } from '../storage/serverStorage.js';
import UserMenu from '../components/UserMenu.jsx';
import NotificationsBell from '../components/NotificationsBell.jsx';
import MetaLab from '../../../meta-lab-3-patched.jsx';
import { C, MONO } from '../theme/tokens.js';

const SAVE_LABEL = { saving: 'Saving…', saved: 'Saved', failed: 'Save failed', idle: '' };
const SAVE_COLOR = { saving: C.muted, saved: C.grn, failed: C.red, idle: 'transparent' };

export default function AppWorkspace() {
  const [saveStatus, setSaveStatus] = useState('idle');
  // prompt11 — /app/project/:projectId opens that exact project. The monolith
  // seeds its activeId from this prop (durable across refresh; no projects[0] snap-back).
  const { projectId } = useParams();
  const navigate = useNavigate();
  // prompt18 — /app/project/:id?tab=screening deep-links straight into a stage
  // (e.g. the "Screening" action on the project landing). Read once for the seed.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || null;

  // prompt20 Task 1 — reflect the monolith's active stage into ?tab= so a refresh
  // reopens the same stage (incl. the Screening workspace) and deep-links survive.
  // Leaving Screening drops the embedded ?screen= sub-tab so the URL stays clean.
  const onTabChange = useCallback((tabId) => {
    setSearchParams(prev => {
      const n = new URLSearchParams(prev);
      if (tabId) n.set('tab', tabId); else n.delete('tab');
      if (tabId !== 'screening') n.delete('screen');
      return n;
    }, { replace: true });
  }, [setSearchParams]);

  // prompt11 (route-sync): keep the URL in step with the project the monolith
  // has open, so a refresh reopens the project the user actually switched to
  // (replace → no history spam from in-app switching).
  const onProjectChange = useCallback((id) => {
    if (id && id !== projectId) navigate(`/app/project/${encodeURIComponent(id)}`, { replace: true });
  }, [projectId, navigate]);

  // prompt12 Task 1: a clear "Back to Projects" affordance inside a project returns
  // to the landing/selector at /app (the monolith renders the button; it isn't
  // router-aware, so navigation is delegated here).
  const onBackToProjects = useCallback(() => navigate('/app'), [navigate]);

  // Subscribe to autosave events from serverStorage
  useEffect(() => subscribeToSaveStatus(setSaveStatus), []);

  return (
    <>
      <MetaLab initialProjectId={projectId || null} initialTab={initialTab} onProjectChange={onProjectChange} onTabChange={onTabChange} onBackToProjects={onBackToProjects} />

      {/* ── Autosave status (bottom-right, non-interactive) ─────────── */}
      <div
        style={{
          position:      'fixed',
          bottom:        14,
          right:         16,
          zIndex:        9999,
          fontSize:      11,
          color:         SAVE_COLOR[saveStatus],
          fontFamily:    MONO,
          letterSpacing: '0.04em',
          pointerEvents: 'none',
          transition:    'color 0.3s, opacity 0.3s',
          opacity:       saveStatus === 'idle' ? 0 : 1,
        }}
      >
        {SAVE_LABEL[saveStatus]}
      </div>

      {/* ── Notifications bell (top-right, left of the account avatar) ── */}
      <NotificationsBell fixed right={56} />

      {/* ── Shared account menu (top-right) ─────────────────────────── */}
      <UserMenu
        context="metalab"
        fixed
        onBeforeLogout={async () => { try { await flushStorage(); } catch { /* best-effort */ } }}
      />
    </>
  );
}
