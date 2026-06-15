/**
 * ProjectMembersPanel.jsx — the canonical name for the shared, grouped project
 * "Members & permissions" panel (prompt24 Task 6). The implementation lives in
 * MembersTab.jsx (its original home, the Screening Settings tab); this re-export
 * gives the shared component the descriptive name the rest of the app uses when
 * embedding it outside Screening (e.g. the META·LAB Project Control tab), so the
 * single source of truth is obvious at every call site.
 *
 * Props: { pid, project?, access?, presence?, refreshProject?, leaveRedirect? }
 *   - pid           linked ScreenProject id (the workspace = source of truth)
 *   - presence      { users, locks } for live activity/location (optional)
 *   - leaveRedirect where "Leave project" navigates (default '/sift-beta';
 *                   Project Control passes '/app')
 */
export { default } from './MembersTab.jsx';
