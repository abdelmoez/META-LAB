/**
 * ImportHistory.jsx — 58.md §5 Import History / dataset management.
 *
 * Lists the project's import batches (datasets) and lets an owner/admin delete an
 * entire dataset + all its studies. Backend: screeningApi.listImportBatches /
 * deleteImportBatch (DELETE /projects/:pid/import-batches[/:batchId]) — owner/admin
 * only, type-to-confirm the dataset name; PRISMA / analytics recompute live.
 *
 * Styled with the screening `C` tokens, so it harmonises automatically in both the
 * legacy theme and the Stitch theme (the --t-* remap).
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../ui/theme.js';
import { Card, Button, Badge, SectionLabel, Spinner, Modal, Field, ErrorBanner } from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';

const n = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);
const fmt = (v) => { const x = n(v); return x >= 1000 ? x.toLocaleString('en-US') : String(x); };
const SOURCE_LABEL = { 'pecan-search': 'Pecan Search', file: 'File upload', api: 'API' };
function fmtDate(d) { try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } }

export default function ImportHistory({ pid, onChanged }) {
  const [state, setState] = useState({ loading: true, error: null, batches: [], canDelete: false });
  const [target, setTarget] = useState(null);   // batch pending deletion
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [delErr, setDelErr] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await screeningApi.listImportBatches(pid);
      setState({ loading: false, error: null, batches: Array.isArray(r?.batches) ? r.batches : [], canDelete: !!r?.canDelete });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Could not load import history.', batches: [], canDelete: false });
    }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  const openDelete = (b) => { setTarget(b); setConfirm(''); setDelErr(null); };
  const closeDelete = () => { if (!busy) { setTarget(null); setConfirm(''); setDelErr(null); } };

  const doDelete = useCallback(async () => {
    if (!target || busy) return;
    setBusy(true); setDelErr(null);
    try {
      const r = await screeningApi.deleteImportBatch(pid, target.id, confirm.trim());
      setTarget(null); setConfirm('');
      await load();
      if (onChanged) await onChanged(r);
    } catch (e) {
      setDelErr(e?.message || 'Delete failed.');
    } finally { setBusy(false); }
  }, [target, busy, pid, confirm, load, onChanged]);

  // Hidden entirely when there is nothing to show (no empty section — 58.md).
  if (state.loading && !state.batches.length) {
    return (
      <section style={{ marginBottom: 20 }}>
        <SectionLabel>Import History</SectionLabel>
        <Card style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 10 }}><Spinner size={16} /><span style={{ fontSize: 12.5, color: C.txt2 }}>Loading datasets…</span></Card>
      </section>
    );
  }
  if (state.error) {
    return (
      <section style={{ marginBottom: 20 }}>
        <SectionLabel>Import History</SectionLabel>
        <ErrorBanner onRetry={load}>{state.error}</ErrorBanner>
      </section>
    );
  }
  if (!state.batches.length) return null;

  const confirmMatch = target && confirm.trim() === String(target.filename || '').trim();

  return (
    <section style={{ marginBottom: 20 }}>
      <SectionLabel right={<span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>{state.batches.length} dataset{state.batches.length === 1 ? '' : 's'}</span>}>
        Import History
      </SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {state.batches.map((b) => (
          <Card key={b.id} style={{ padding: '13px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span title={b.filename} style={{ fontSize: 13.5, fontWeight: 600, color: C.txt, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
                    {b.filename || '(unnamed dataset)'}
                  </span>
                  <Badge color={C.teal} title={`Source: ${SOURCE_LABEL[b.source] || b.source}`}>{SOURCE_LABEL[b.source] || b.source}</Badge>
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                  {b.importedByName ? `by ${b.importedByName} · ` : ''}{fmtDate(b.createdAt)}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                <Stat label="Identified" value={fmt(b.preDedupCount || b.recordCount)} />
                <Stat label="Duplicates" value={fmt(b.duplicateCount)} color={n(b.duplicateCount) > 0 ? C.gold : C.txt2} />
                <Stat label="Imported" value={fmt(b.recordCount)} color={C.grn} />
                <Stat label="Remaining" value={fmt(b.remainingCount)} color={C.txt2} />
                {state.canDelete && (
                  <Button variant="danger" onClick={() => openDelete(b)} title="Delete this dataset and all its studies">Delete</Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {target && (
        <Modal onClose={closeDelete} width={500}>
          <div style={{ fontFamily: FONT, color: C.txt }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Delete dataset?</div>
            <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.6, marginBottom: 12 }}>
              This permanently removes the dataset <strong style={{ color: C.txt }}>{target.filename || '(unnamed)'}</strong> and all
              of its studies. Their screening decisions, conflicts, duplicate-group memberships and AI scores are deleted too. PRISMA
              counts and screening analytics will be recalculated. <strong style={{ color: C.red }}>This cannot be undone.</strong>
            </div>
            <div style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 13px', marginBottom: 14, fontSize: 12, color: C.txt2 }}>
              <span style={{ fontFamily: MONO, fontWeight: 700, color: C.txt }}>{fmt(target.remainingCount)}</span> records will be removed
              {n(target.recordCount) !== n(target.remainingCount) ? ` (of ${fmt(target.recordCount)} originally imported)` : ''}.
            </div>
            <Field label={<>Type the dataset name <span style={{ fontFamily: MONO, color: C.txt }}>{target.filename}</span> to confirm</>}>
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus
                placeholder={target.filename}
                style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${confirmMatch ? alpha(C.red, '70') : C.brd2}`, borderRadius: 7, padding: '9px 11px', color: C.txt, fontFamily: FONT, fontSize: 13, outline: 'none' }} />
            </Field>
            {delErr && <div style={{ marginTop: 10 }}><ErrorBanner>{delErr}</ErrorBanner></div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <Button variant="ghost" onClick={closeDelete} disabled={busy}>Cancel</Button>
              <Button variant="danger" onClick={doDelete} disabled={busy || !confirmMatch} title={confirmMatch ? 'Delete this dataset' : 'Type the exact dataset name to enable'}>
                {busy ? 'Deleting…' : 'Delete dataset'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function Stat({ label, value, color = C.txt }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 56 }}>
      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 3 }}>{label}</div>
    </div>
  );
}
