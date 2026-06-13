/**
 * AppWorkspace.jsx
 *
 * Wraps the META·LAB monolith with:
 *  - The shared account UserMenu fixed at top-right (same component META·SIFT uses)
 *  - An autosave status indicator (bottom-right, non-interactive)
 */

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
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

  // Subscribe to autosave events from serverStorage
  useEffect(() => subscribeToSaveStatus(setSaveStatus), []);

  return (
    <>
      <MetaLab initialProjectId={projectId || null} />

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
