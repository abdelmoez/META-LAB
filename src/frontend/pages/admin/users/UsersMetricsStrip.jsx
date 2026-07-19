/**
 * users/UsersMetricsStrip.jsx — 95.md Phase 8 — a compact, single-row metrics
 * strip above the user table. Small numbers + labels, no charts. Shows a subtle
 * "(filtered)" tag when the counts reflect the active filters, and folds the
 * live online head-count in (preserving the pre-95 presence summary capability).
 */
import { C, MONO, alpha } from '../../../theme/tokens.js';
import { LivePulseDot } from './misc.jsx';

function Item({ label, value, color = C.txt, loading, live }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, padding: '0 14px', borderLeft: `1px solid ${C.brd}` }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 18, fontWeight: 800, fontFamily: MONO, color, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
        {live && <LivePulseDot live />}
        {loading ? '—' : (value ?? 0).toLocaleString()}
      </span>
      <span style={{ fontSize: 9.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

export default function UsersMetricsStrip({ metrics, filtered, presence, loading }) {
  const m = metrics || {};
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '12px 4px', marginBottom: 14, display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 12, overflowX: 'auto' }}>
      {/* first item has no divider */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, padding: '0 14px' }}>
        <span style={{ fontSize: 18, fontWeight: 800, fontFamily: MONO, color: C.txt, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
          {loading ? '—' : (m.total ?? 0).toLocaleString()}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 9.5, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          {filtered ? 'Matching' : 'Total users'}
          {filtered && <span style={{ color: C.acc, background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '35')}`, borderRadius: 5, padding: '0 5px', fontSize: 8.5, letterSpacing: '0.04em' }}>filtered</span>}
        </span>
      </div>
      {presence && <Item label="Online now" value={presence.online} color={C.grn} loading={loading} live />}
      <Item label="Active" value={m.active} color={C.grn} loading={loading} />
      <Item label="New · 7d" value={m.newThisWeek} color={C.acc} loading={loading} />
      <Item label="Pending verify" value={m.pendingVerification} color={(m.pendingVerification || 0) > 0 ? C.yel : C.txt} loading={loading} />
      <Item label="Suspended" value={m.suspended} color={(m.suspended || 0) > 0 ? C.red : C.txt} loading={loading} />
      <Item label="Never logged in" value={m.neverLoggedIn} color={C.muted} loading={loading} />
      <Item label="Google reg." value={m.googleRegistered} color={C.teal} loading={loading} />
      <Item label="Email reg." value={m.emailRegistered} color={C.txt2} loading={loading} />
      <Item label="Both methods" value={m.bothLoginMethods} color={C.purp} loading={loading} />
    </div>
  );
}
