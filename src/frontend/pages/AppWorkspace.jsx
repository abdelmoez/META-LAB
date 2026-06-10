/**
 * AppWorkspace.jsx
 *
 * Wraps the META·LAB monolith with:
 *  - The shared account UserMenu fixed at top-right (same component META·SIFT uses)
 *  - An autosave status indicator (bottom-right, non-interactive)
 */

import { useState, useEffect } from 'react';
import { subscribeToSaveStatus, flushStorage } from '../storage/serverStorage.js';
import UserMenu from '../components/UserMenu.jsx';
import NotificationsBell from '../components/NotificationsBell.jsx';
import MetaLab from '../../../meta-lab-3-patched.jsx';

const SAVE_LABEL = { saving: 'Saving…', saved: 'Saved', failed: 'Save failed', idle: '' };
const SAVE_COLOR = { saving: '#536080', saved: '#34d399', failed: '#f87171', idle: 'transparent' };

export default function AppWorkspace() {
  const [saveStatus, setSaveStatus] = useState('idle');

  // Subscribe to autosave events from serverStorage
  useEffect(() => subscribeToSaveStatus(setSaveStatus), []);

  return (
    <>
      <MetaLab />

      {/* ── Autosave status (bottom-right, non-interactive) ─────────── */}
      <div
        style={{
          position:      'fixed',
          bottom:        14,
          right:         16,
          zIndex:        9999,
          fontSize:      11,
          color:         SAVE_COLOR[saveStatus],
          fontFamily:    "'IBM Plex Mono', monospace",
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
