/* ════════════ EXPORT DIALOG PLUMBING (prompt9 Task 6) ════════════
   ONE ExportDialog instance lives at the app root (MetaLab); deep components
   open it via this module-level trampoline instead of prop-drilling through
   every tab. MetaLab registers its setExpItem here on mount.

   Extracted VERBATIM from meta-lab-3-patched.jsx (prompt46 Phase 6d) so that
   tab components moved out of the monolith share the SAME singleton trampoline
   as the still-inline components and the MetaLab registration. */
let _openExportDialog = null;

export const openExportDialog = (item) => { if (_openExportDialog) _openExportDialog(item); };

/* MetaLab calls this on mount to register its setExpItem; the returned cleanup
   nulls the opener only if it is still the one we registered (verbatim parity
   with the monolith's original effect). */
export const registerExportDialog = (fn) => {
  _openExportDialog = fn;
  return () => { if (_openExportDialog === fn) _openExportDialog = null; };
};
