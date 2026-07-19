/**
 * users/UsersBulkBar.jsx — 95.md Phase 7 (ADMIN ONLY) — floating bulk-action bar.
 * Shows the selection count and the safe batch actions, confirms with the stated
 * consequence (+ optional reason, + tier picker for assign_tier), then surfaces a
 * results modal summarising succeeded / failed / skipped with per-user codes.
 * The contract accepts ids only (≤200) — cross-page "select all" is not offered.
 */
import { useState } from 'react';
import { C, MONO, alpha } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';
import { ConfirmDialog, ghostBtn, inputStyle, selectStyle } from './primitives.jsx';
import { BULK_SKIP_CODES } from '../../../../shared/adminUsers.js';

const MAX_BULK = 200;

const ACTIONS = [
  { id: 'assign_tier',        label: 'Assign tier',        icon: 'award',
    consequence: 'Assign the selected tier to the chosen users. Admin accounts bypass tiers and are skipped.' },
  { id: 'suspend',            label: 'Suspend',            icon: 'lock', danger: true,
    consequence: 'Suspend the chosen users. Suspending revokes their active sessions. Admins and your own account are skipped.' },
  { id: 'restore',            label: 'Restore',            icon: 'refresh',
    consequence: 'Restore the chosen users. Users who are not currently suspended are skipped.' },
  { id: 'revoke_sessions',    label: 'Revoke sessions',    icon: 'logout', danger: true,
    consequence: 'Sign the chosen users out of every device. Admins and your own account are skipped.' },
  { id: 'resend_verification', label: 'Resend verification', icon: 'mail',
    consequence: 'Resend the verification email to the chosen users. Already-verified users are skipped.' },
];

function ResultRow({ label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 11px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8 }}>
      <span style={{ fontSize: 12.5, color: C.txt2 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO, color }}>{value}</span>
    </div>
  );
}

export default function UsersBulkBar({ ids, tiers = [], runBulk, onClear }) {
  const [pending, setPending] = useState(null); // action id awaiting confirm
  const [reason, setReason] = useState('');
  const [tierId, setTierId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const count = ids.length;
  if (count === 0 && !result) return null;

  const action = ACTIONS.find((a) => a.id === pending);
  const overLimit = count > MAX_BULK;

  const openConfirm = (id) => { setPending(id); setReason(''); setTierId(''); setErr(''); };

  const doRun = async () => {
    setBusy(true); setErr('');
    try {
      const body = { action: pending, ids };
      if (pending === 'assign_tier') body.tierId = tierId || null;
      if (reason.trim()) body.reason = reason.trim();
      const res = await runBulk(body);
      setResult(res);
      setPending(null);
    } catch (e) {
      setErr(e.status === 413 ? 'Too many users selected — narrow the selection and try again.' : (e.message || 'Bulk action failed.'));
    } finally { setBusy(false); }
  };

  // Group per-user results by code for the summary breakdown.
  const breakdown = (() => {
    if (!result?.results) return [];
    const map = new Map();
    for (const r of result.results) {
      if (r.ok) continue;
      const code = r.code || 'FAILED';
      map.set(code, (map.get(code) || 0) + 1);
    }
    return [...map.entries()].map(([code, n]) => ({ code, n, label: BULK_SKIP_CODES[code] || 'Could not be processed.' }));
  })();

  return (
    <>
      {count > 0 && (
        <div role="region" aria-label="Bulk user actions" style={{
          position: 'sticky', bottom: 16, zIndex: 50, margin: '12px 0 0',
          background: C.card, border: `1px solid ${alpha(C.acc, '50')}`, borderRadius: 12,
          boxShadow: `0 12px 40px ${C.shadow}`, padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>{count} selected</span>
          {overLimit && <span style={{ fontSize: 11.5, color: C.red }}>Max {MAX_BULK} per action — deselect {count - MAX_BULK}.</span>}
          <span style={{ width: 1, height: 20, background: C.brd2 }} />
          {ACTIONS.map((a) => (
            <button key={a.id} type="button" onClick={() => openConfirm(a.id)} disabled={overLimit} style={{
              ...ghostBtn, opacity: overLimit ? 0.5 : 1,
              color: a.danger ? C.red : C.txt2, borderColor: a.danger ? alpha(C.red, '40') : C.brd2,
            }}>
              <Icon name={a.icon} size={13} />{a.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClear} style={ghostBtn}>Clear</button>
        </div>
      )}

      {/* Confirm (with optional reason + tier picker) */}
      <ConfirmDialog
        open={!!pending}
        title={action ? `${action.label} · ${count} user${count === 1 ? '' : 's'}` : ''}
        message={action?.consequence}
        confirmLabel={busy ? 'Working…' : (action?.label || 'Confirm')}
        danger={action?.danger}
        busy={busy}
        onConfirm={doRun}
        onCancel={() => !busy && setPending(null)}
      >
        {pending === 'assign_tier' && (
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Tier</span>
            <select value={tierId} onChange={(e) => setTierId(e.target.value)} style={selectStyle}>
              <option value="">Default (site tier)</option>
              {tiers.map((t) => <option key={t.id} value={t.id}>{t.displayName || t.id}</option>)}
            </select>
          </label>
        )}
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Reason (optional, recorded in the audit log)</span>
          <input type="text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. spam cleanup" style={inputStyle} />
        </label>
        {err && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: C.red }}>{err}</div>}
      </ConfirmDialog>

      {/* Results summary */}
      {result && (
        <ConfirmDialog
          open
          title="Bulk action complete"
          message={result.bulkOperationId ? `Operation ${result.bulkOperationId}` : undefined}
          confirmLabel="Done"
          onConfirm={() => setResult(null)}
          onCancel={() => setResult(null)}
        >
          {(() => {
            const s = result.summary || {};
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  <ResultRow label="Succeeded" value={s.succeeded ?? 0} color={C.grn} />
                  <ResultRow label="Skipped" value={s.skipped ?? 0} color={C.muted} />
                  <ResultRow label="Failed" value={s.failed ?? 0} color={(s.failed || 0) > 0 ? C.red : C.muted} />
                  <ResultRow label="Requested" value={s.requested ?? 0} color={C.txt} />
                </div>
                {breakdown.length > 0 && (
                  <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {breakdown.map((b) => (
                      <div key={b.code} style={{ fontSize: 12, color: C.txt2, display: 'flex', gap: 8, lineHeight: 1.5 }}>
                        <span style={{ fontFamily: MONO, fontWeight: 700, color: C.muted, minWidth: 22, textAlign: 'right' }}>{b.n}</span>
                        <span>{b.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </ConfirmDialog>
      )}
    </>
  );
}
