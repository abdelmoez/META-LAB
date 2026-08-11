/**
 * RobExportButton.jsx — the project-wide RoB export (115.md decision 11 / §27,
 * dossier §9: "No project-wide RoB bulk export exists").
 *
 * One button, one call: `GET /api/rob/projects/:id/assessments/export?format=csv`
 * returns `{ filename, mime, content }` and the client writes the file — the same
 * shape and the same download path the per-assessment export already uses
 * (RobWorkspace.exportAs), so there is one export convention in the RoB surface,
 * not two.
 *
 * TIER GATE: project exports are entitlement-gated (Free blocked, permitted tiers
 * consume one unit of the monthly allowance, refunded server-side if the file is
 * never produced). A blocked call returns 403 with the structured
 * `{ error: 'TIER_LIMIT_EXCEEDED', message }` body, whose HUMAN message is the one
 * worth showing — `err.message` alone would print the enum key. `tierErrorMessage`
 * is the shared helper every other blocked action in the app uses for exactly this
 * (see ProjectLanding.jsx), so this button mirrors it rather than re-deriving it.
 *
 * The button is presentational + self-contained: it owns only its busy/error
 * state, and takes `onExport` / `download` injections so it is testable without a
 * network or a DOM.
 */
import { useState } from 'react';
import { C, FONT, MONO } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import { downloadText } from '../components/exportCore.js';
import { tierErrorMessage } from '../entitlements/index.js';
import { robReviewApi } from './robReviewApi.js';

/**
 * Turn a failed export into the sentence a reviewer should read. Exported so the
 * message contract is unit-testable without rendering.
 */
export function exportErrorMessage(err) {
  if (!err) return '';
  const tier = tierErrorMessage(err);
  if (tier) return tier;
  if (err.status === 404) return 'Risk of Bias export is not available for this project.';
  if (err.status === 403) return err.message || 'You do not have permission to export this project’s assessments.';
  return err.message || 'The export could not be produced.';
}

export default function RobExportButton({
  projectId,
  assessmentCount = 0,
  disabled = false,
  compact = false,
  onExport,                       // (projectId) => Promise<{ filename, mime, content }>
  download = downloadText,        // (text, filename, mime) => void
  onError,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const empty = !assessmentCount;
  const off = disabled || busy || empty;

  async function run() {
    setBusy(true);
    setError('');
    try {
      const fetcher = onExport || ((id) => robReviewApi.exportProject(id, 'csv'));
      const res = await fetcher(projectId);
      const content = res && res.content;
      if (typeof content !== 'string' || !content) {
        throw new Error('The export returned no content.');
      }
      download(content, (res && res.filename) || `rob-assessments_${projectId}.csv`, (res && res.mime) || 'text/csv');
    } catch (e) {
      const msg = exportErrorMessage(e);
      setError(msg);
      if (typeof onError === 'function') onError(e, msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
      <button
        type="button"
        onClick={run}
        disabled={off}
        aria-busy={busy ? 'true' : 'false'}
        title={empty
          ? 'There are no assessments to export yet.'
          : 'Download every assessment in this project as one CSV, with a separate section per tool.'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: compact ? '5px 11px' : '7px 14px',
          background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 8,
          color: off ? C.muted : C.txt2, fontFamily: FONT, fontSize: compact ? 12 : 12.5, fontWeight: 600,
          cursor: off ? 'not-allowed' : 'pointer',
        }}
      >
        <Icon name="download" size={13} />
        {busy ? 'Preparing…' : 'Export all assessments (CSV)'}
      </button>
      {!error && !empty && (
        <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted }}>
          One section per tool — assessments are never merged across instruments.
        </span>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 11.5, color: C.red, maxWidth: 380, lineHeight: 1.45 }}>
          {error}
        </span>
      )}
    </div>
  );
}
