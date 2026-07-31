/**
 * ResetImportedRecordsModal.jsx — 96.md Phase 6A–6C (plan D11): the guarded
 * "Delete All Imported Search Records" confirmation flow.
 *
 * A strong, typed-confirm destructive dialog in the spirit of the existing
 * dataset-delete modal (ImportHistory.jsx) and the META·LAB project DeleteModal
 * (ProjectLanding.jsx): consequences listed up front from a server-computed
 * preview, scope made explicit, danger button disabled until the user types the
 * exact project name, and the server re-validates that confirmation (the typed
 * text is part of the API contract, never just UI).
 *
 * Backend contract (built against plan D11 — the endpoints are implemented by
 * the parallel server workstream; every read below is shape-tolerant):
 *   GET  /api/screening/projects/:pid/imported-records/reset-preview?scope=search|all
 *        → { projectName?, confirmToken (the exact string to type: project name,
 *            or 'DELETE' when the title is blank), blockedBy (string reason while
 *            a project job is active, else null), counts:{ records, decisions,
 *            notes, conflicts, pdfs, runsAffected, manualRecordsKept, batches,
 *            handedOff } }
 *   POST /api/screening/projects/:pid/imported-records/reset
 *        body { scope, confirm } → result counts (rolled-back runs = runsMarked).
 *        409 while an import/duplicate job is running; 403 when the caller is
 *        not the owner or a site admin.
 *
 * The pure `ResetModalContent` is exported so the SSR test suite can assert
 * every state (preview counts, disabled-until-typed-match, scope options,
 * 409/403 copy, success view) with renderToStaticMarkup — the default export
 * only adds fetching/state and the focus-trapped Modal shell.
 */
import { useCallback, useEffect, useState } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { Button, Modal, Spinner, Field, ErrorBanner } from '../ui/components.jsx';
import { screeningImportHistoryApi } from '../../../features/pecanSearch/pecanSearchApi.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (...vals) => {
  for (const v of vals) if (v != null && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const fmt = (v) => { const x = num(v); return x >= 1000 ? x.toLocaleString('en-US') : String(x); };
const plural = (v, one, many) => (num(v) === 1 ? one : many);

/** Tolerant preview normalizer — accepts { counts:{…} } or a flat counts object.
 *  Carries the two non-count contract fields the dialog acts on: `confirmToken`
 *  (the exact string the user must type — the server's word, not the client's
 *  guess) and `blockedBy` (a human reason while a project job blocks the reset). */
export function normalizeResetPreview(p) {
  const c = (p && typeof p === 'object' && p.counts && typeof p.counts === 'object') ? p.counts : (p || {});
  return {
    projectName: (p && typeof p.projectName === 'string') ? p.projectName : '',
    confirmToken: (p && typeof p.confirmToken === 'string') ? p.confirmToken : '',
    blockedBy: (p && typeof p.blockedBy === 'string' && p.blockedBy.trim()) ? p.blockedBy : null,
    records: num(c.records),
    decisions: num(c.decisions),
    notes: num(c.notes),
    conflicts: num(c.conflicts),
    pdfs: num(c.pdfs),
    runsAffected: num(c.runsAffected),
    manualRecordsKept: num(c.manualRecordsKept),
    batches: num(c.batches),
    handedOff: num(c.handedOff),
  };
}

/** Tolerant success-result normalizer — every field optional (null = unknown).
 *  The contract key for the rolled-back run count is `runsMarked`; the older
 *  runsAffected/runsRolledBack aliases stay accepted. */
export function normalizeResetResult(r) {
  const c = (r && typeof r === 'object' && r.counts && typeof r.counts === 'object') ? r.counts : (r || {});
  return {
    records: numOrNull(c.records, c.recordsRemoved, c.deletedRecords),
    decisions: numOrNull(c.decisions, c.decisionsRemoved),
    runsAffected: numOrNull(c.runsMarked, c.runsAffected, c.runsRolledBack),
    batches: numOrNull(c.batches, c.batchesRemoved),
    pdfs: numOrNull(c.pdfs, c.pdfsRemoved),
  };
}

/**
 * Map a thrown API error to user-facing copy. 409 = another project job is in
 * flight (the reset is fenced server-side — plan invariant 8); 403 = permission.
 */
export function resetErrorView(err) {
  const status = err && err.status;
  if (status === 409) {
    return {
      tone: 'warn',
      message: 'Another operation is currently running for this project — a search import or '
        + 'duplicate-detection job. Wait for it to finish (or cancel it from its progress panel), then try again. '
        + 'Nothing was deleted.',
    };
  }
  if (status === 403) {
    return {
      tone: 'error',
      message: 'You do not have permission to delete imported records. Only the project owner '
        + '(or a site administrator) can perform this reset.',
    };
  }
  return { tone: 'error', message: (err && err.message) || 'The reset failed. Nothing was deleted.' };
}

const bulletList = { margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: C.txt2, lineHeight: 1.7 };
const strongNum = { fontFamily: MONO, fontWeight: 700, color: C.txt };
const warnBanner = {
  background: alpha(C.ylw, '12'), border: `1px solid ${alpha(C.ylw, '50')}`, borderRadius: 8,
  padding: '10px 13px', fontSize: 12.5, color: C.ylw, lineHeight: 1.55,
};

/**
 * Pure modal body. All state is passed in so it renders identically under SSR.
 * `error` is the raw thrown API error (status-aware copy via resetErrorView).
 */
export function ResetModalContent({
  scope = 'search',
  onScopeChange,
  preview = null,
  previewLoading = false,
  previewError = '',
  onRetryPreview,
  projectName = '',
  confirmText = '',
  onConfirmChange,
  busy = false,
  error = null,
  result = null,
  onSubmit,
  onDone,
  onClose,
}) {
  // ── Success view — exact result counts + what survives ─────────────────────
  if (result) {
    const rows = [
      result.records != null && `${fmt(result.records)} imported ${plural(result.records, 'article', 'articles')} removed`,
      result.decisions != null && `${fmt(result.decisions)} screening ${plural(result.decisions, 'decision', 'decisions')} removed`,
      result.runsAffected != null && `${fmt(result.runsAffected)} search ${plural(result.runsAffected, 'run', 'runs')} marked as rolled back`,
      result.batches != null && `${fmt(result.batches)} import ${plural(result.batches, 'batch', 'batches')} removed`,
      result.pdfs != null && `${fmt(result.pdfs)} PDF ${plural(result.pdfs, 'attachment', 'attachments')} removed`,
    ].filter(Boolean);
    return (
      <div style={{ fontFamily: FONT, color: C.txt }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Imported records deleted</div>
        {rows.length > 0 ? (
          <ul style={bulletList}>{rows.map((r) => <li key={r}>{r}</li>)}</ul>
        ) : (
          <div style={{ fontSize: 12.5, color: C.txt2 }}>The selected records were deleted.</div>
        )}
        <div style={{ fontSize: 12, color: C.txt2, lineHeight: 1.6, marginTop: 12 }}>
          Your search strategy and search-run history were kept — affected runs are marked
          <em> rolled back</em> in the import history. Screening and PRISMA counts have been recalculated.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="primary" onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  const all = scope === 'all';
  // The typed-confirm string is the SERVER's confirmToken (L14: the project name,
  // or the literal 'DELETE' when the title is blank). Older previews without the
  // field fall back to the project name, then 'DELETE' — never a vacuous match.
  const effectiveToken = String(
    (preview && preview.confirmToken) || (preview && preview.projectName) || projectName || '',
  ).trim() || 'DELETE';
  const confirmMatch = confirmText.trim() === effectiveToken;
  const blockedBy = (preview && preview.blockedBy) || null;
  const ev = error ? resetErrorView(error) : null;

  return (
    <div style={{ fontFamily: FONT, color: C.txt }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Delete All Imported Search Records</div>
      <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6, marginBottom: 14 }}>
        This removes records that were imported into Screening by Search Engine runs for this project.
        Your search strategy and search history are <strong style={{ color: C.txt }}>not</strong> deleted —
        affected runs stay in the history, marked as rolled back.
      </div>

      {/* Scope — explicit, radio-selected (spec 6C: two options, no ambiguity). */}
      <fieldset style={{ border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 13px', margin: '0 0 14px' }}>
        <legend style={{ fontSize: 10, fontFamily: MONO, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.muted, padding: '0 6px' }}>
          What should be deleted?
        </legend>
        {[
          {
            value: 'search',
            label: 'Delete all Search Engine–imported records',
            hint: 'Only records added by automated search runs. Manually added and file-imported records are kept.',
          },
          {
            value: 'all',
            label: 'Delete ALL screening records and restart',
            hint: 'Every record — including manually added and file-imported ones — and all screening work.',
            danger: true,
          },
        ].map((opt) => (
          <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '6px 2px', cursor: busy ? 'default' : 'pointer' }}>
            <input
              type="radio"
              name="reset-scope"
              value={opt.value}
              checked={scope === opt.value}
              disabled={busy}
              onChange={() => { if (onScopeChange) onScopeChange(opt.value); }}
              style={{ marginTop: 2, accentColor: C.red }}
            />
            <span style={{ minWidth: 0 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: opt.danger ? C.red : C.txt, display: 'block' }}>{opt.label}</span>
              <span style={{ fontSize: 11, color: C.muted, display: 'block', marginTop: 1, lineHeight: 1.5 }}>{opt.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {/* Server-computed impact preview (spec 6B: exact numbers before confirming). */}
      {previewLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '12px 13px', marginBottom: 14 }}>
          <Spinner size={14} />
          <span style={{ fontSize: 12, color: C.txt2 }}>Calculating exactly what will be removed…</span>
        </div>
      ) : previewError ? (
        <ErrorBanner onRetry={onRetryPreview}>{previewError}</ErrorBanner>
      ) : preview ? (
        <div style={{ background: C.surf, border: `1px solid ${alpha(C.red, '35')}`, borderRadius: 8, padding: '11px 13px', marginBottom: 14 }}>
          <div style={{ fontSize: 10.5, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.red, marginBottom: 4 }}>
            This will permanently remove
          </div>
          <ul style={bulletList}>
            <li><span style={strongNum}>{fmt(preview.records)}</span> imported {plural(preview.records, 'article', 'articles')}</li>
            <li><span style={strongNum}>{fmt(preview.decisions)}</span> screening {plural(preview.decisions, 'decision', 'decisions')}</li>
            <li>
              <span style={strongNum}>{fmt(preview.notes)}</span> {plural(preview.notes, 'note', 'notes')} ·{' '}
              <span style={strongNum}>{fmt(preview.conflicts)}</span> conflict {plural(preview.conflicts, 'resolution', 'resolutions')} ·{' '}
              <span style={strongNum}>{fmt(preview.pdfs)}</span> PDF {plural(preview.pdfs, 'attachment', 'attachments')}
            </li>
            <li><span style={strongNum}>{fmt(preview.runsAffected)}</span> search {plural(preview.runsAffected, 'run', 'runs')} will be marked as rolled back (the run history itself is kept)</li>
          </ul>
          <div style={{ fontSize: 12, color: C.txt2, lineHeight: 1.6, marginTop: 8 }}>
            {all ? (
              <span style={{ color: C.red }}>Manually added and file-imported records are deleted too — nothing is kept.</span>
            ) : (
              <>
                <span style={strongNum}>{fmt(preview.manualRecordsKept)}</span> manually added or file-imported{' '}
                {plural(preview.manualRecordsKept, 'record', 'records')} will be <strong style={{ color: C.grn }}>kept</strong>.
              </>
            )}
            {' '}Your search strategy and search history remain.
          </div>
          {preview.handedOff > 0 && (
            <div style={{ fontSize: 11.5, color: C.ylw, lineHeight: 1.55, marginTop: 8 }}>
              {fmt(preview.handedOff)} {plural(preview.handedOff, 'record has', 'records have')} already been handed off to
              Data Extraction — the extraction studies are <strong>not</strong> removed by this reset.
            </div>
          )}
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.red, marginTop: 10 }}>This cannot be undone.</div>
        </div>
      ) : null}

      {/* Extra warning for the full restart (spec 6C: explicit second option). */}
      {all && (
        <div style={warnBanner} role="alert">
          You are about to delete <strong>every</strong> screening record in this project and restart
          Screening from zero. All reviewers&rsquo; screening work is removed. Make sure your team agrees before proceeding.
        </div>
      )}

      {/* M15 / 96.md 6F — a project job blocks the reset: say so UP FRONT (before
          the user types the whole confirmation) and keep the danger button off
          until a preview refresh comes back clear. The post-submit 409 copy stays
          as the authoritative backstop. */}
      {blockedBy && (
        <div style={{ ...warnBanner, marginTop: all ? 14 : 0 }} role="alert">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 260px', minWidth: 0 }}>
              An operation is currently running for this project ({blockedBy}). The reset is
              blocked until it finishes — wait for it (or cancel it from its progress panel), then check again.
            </span>
            {onRetryPreview && (
              <Button variant="ghost" onClick={onRetryPreview} disabled={busy || previewLoading}
                style={{ padding: '4px 12px', fontSize: 11.5, flexShrink: 0 }}
                title="Re-check whether the operation has finished">
                Check again
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Typed confirmation — the server's confirmToken (project name, or the
          literal DELETE for an untitled project); server re-validates (400 on mismatch). */}
      <div style={{ marginTop: (all || blockedBy) ? 14 : 0 }}>
        <Field label={<>
          Type {effectiveToken === 'DELETE' ? '' : 'the project name '}
          <span style={{ fontFamily: MONO, color: C.txt, textTransform: 'none' }}>{effectiveToken}</span> to confirm
        </>}>
          <input
            value={confirmText}
            onChange={(e) => { if (onConfirmChange) onConfirmChange(e.target.value); }}
            autoFocus
            disabled={busy}
            placeholder={effectiveToken}
            aria-label="Type the exact confirmation text to confirm deletion"
            style={{
              width: '100%', boxSizing: 'border-box', background: C.bg,
              border: `1px solid ${confirmMatch ? alpha(C.red, '70') : C.brd2}`,
              borderRadius: 7, padding: '9px 11px', color: C.txt, fontFamily: FONT, fontSize: 13, outline: 'none',
            }}
          />
        </Field>
      </div>

      {ev && (
        <div style={{ marginTop: 12 }}>
          {ev.tone === 'warn'
            ? <div style={warnBanner} role="alert">{ev.message}</div>
            : <ErrorBanner>{ev.message}</ErrorBanner>}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="danger"
          onClick={onSubmit}
          disabled={busy || previewLoading || !!previewError || !!blockedBy || !confirmMatch}
          title={blockedBy
            ? 'Blocked while another operation is running for this project'
            : confirmMatch
              ? (all ? 'Delete every screening record in this project' : 'Delete all search-imported records')
              : 'Type the exact confirmation text to enable'}
        >
          {busy ? 'Deleting…' : (all ? 'Delete ALL screening records' : 'Delete imported search records')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Stateful wrapper: loads the reset preview (per scope), submits the reset, and
 * hosts everything in the shared focus-trapped screening Modal.
 *
 * Props: pid, projectName (fallback when the server preview omits it),
 * onClose(), onDone(result) — called from the success view so the parent can
 * refresh lists / PRISMA-fed panels.
 */
export default function ResetImportedRecordsModal({ pid, projectName = '', onClose, onDone }) {
  const [scope, setScope] = useState('search');
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const loadPreview = useCallback(async (s) => {
    setPreviewLoading(true); setPreviewError(''); setError(null);
    try {
      const r = await screeningImportHistoryApi.getResetPreview(pid, s);
      setPreview(normalizeResetPreview(r));
    } catch (e) {
      setPreview(null);
      setPreviewError(e && e.status === 403
        ? resetErrorView(e).message
        : (e && e.message) || 'Could not load the deletion preview.');
    } finally {
      setPreviewLoading(false);
    }
  }, [pid]);

  useEffect(() => { loadPreview(scope); }, [loadPreview, scope]);

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await screeningImportHistoryApi.resetImportedRecords(pid, { scope, confirm: confirmText.trim() });
      setResult(normalizeResetResult(r));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, [busy, pid, scope, confirmText]);

  const close = useCallback(() => { if (!busy) onClose?.(); }, [busy, onClose]);
  const done = useCallback(async () => { onClose?.(); if (onDone) await onDone(result); }, [onClose, onDone, result]);

  return (
    <Modal onClose={close} width={560} label="Delete all imported search records">
      <ResetModalContent
        scope={scope}
        onScopeChange={(s) => { if (!busy) setScope(s); }}
        preview={preview}
        previewLoading={previewLoading}
        previewError={previewError}
        onRetryPreview={() => loadPreview(scope)}
        projectName={projectName}
        confirmText={confirmText}
        onConfirmChange={setConfirmText}
        busy={busy}
        error={error}
        result={result}
        onSubmit={submit}
        onDone={done}
        onClose={close}
      />
    </Modal>
  );
}
