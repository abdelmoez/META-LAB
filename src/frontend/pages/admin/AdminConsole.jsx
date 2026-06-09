/**
 * AdminConsole.jsx — META·LAB Ops internal control panel.
 * v2.2 — inbox messages, user+projects panel, redesigned overview, full content editor
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { adminApi } from './adminApiClient.js';

/* ─── Design tokens ──────────────────────────────────────────────────── */
const C = {
  bg:    '#0b0d13',
  surf:  '#0f1220',
  card:  '#141826',
  brd:   '#1f2640',
  brd2:  '#283050',
  acc:   '#818cf8',
  acc2:  '#6366f1',
  txt:   '#eaecf6',
  txt2:  '#9ba6c4',
  muted: '#536080',
  grn:   '#34d399',
  red:   '#f87171',
  ylw:   '#fbbf24',
  teal:  '#2dd4bf',
};
const FONT = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', monospace";
const SIDEBAR_W = 220;
const TOPBAR_H  = 52;

/* ─── Helpers ────────────────────────────────────────────────────────── */
function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : '—'; }
function fmtDateTime(d) { return d ? new Date(d).toLocaleString() : '—'; }
function fmtAgo(d) {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(d);
}

/* ════════════════════════════════════════════════════════════════════════
   SHARED UI PRIMITIVES
   ════════════════════════════════════════════════════════════════════════ */

function Spinner({ size = 14, color = C.acc }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      border: `2px solid ${color}30`, borderTop: `2px solid ${color}`,
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
    }} />
  );
}

function SaveButton({ onClick, status, label = 'Save Changes', disabled = false }) {
  const map = {
    idle:   { bg: C.acc2,    text: label,     icon: null },
    saving: { bg: C.muted,   text: 'Saving…', icon: <Spinner size={12} color="#fff" /> },
    saved:  { bg: '#166534', text: 'Saved',   icon: '✓' },
    error:  { bg: '#7f1d1d', text: 'Error',   icon: '✕' },
  };
  const s = map[status] || map.idle;
  return (
    <button onClick={onClick} disabled={disabled || status === 'saving'} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '8px 18px', background: s.bg, border: 'none',
      borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 600,
      cursor: disabled || status === 'saving' ? 'not-allowed' : 'pointer',
      fontFamily: FONT, opacity: disabled ? 0.6 : 1, transition: 'background 0.2s',
    }}>
      {s.icon && <span>{s.icon}</span>}
      {s.text}
    </button>
  );
}

function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 12, padding: '28px 32px', maxWidth: 420, width: '90%', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 12 }}>{title}</div>
        <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.65, marginBottom: 24 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onCancel} style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 13, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
          <button onClick={onConfirm} style={{ padding: '8px 16px', background: danger ? C.red : C.acc2, border: 'none', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function DataTable({ columns, rows, loading, emptyMessage = 'No data.', onRowClick, selectedId }) {
  const thStyle = { padding: '9px 14px', textAlign: 'left', fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: `1px solid ${C.brd}`, fontWeight: 600, whiteSpace: 'nowrap' };
  const tdStyle = { padding: '10px 14px', fontSize: 12, color: C.txt2, borderBottom: `1px solid ${C.brd}`, verticalAlign: 'middle' };

  if (loading) return (
    <div style={{ padding: '40px 0', textAlign: 'center' }}>
      <Spinner size={20} />
      <div style={{ fontSize: 12, color: C.muted, marginTop: 12 }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{columns.map(c => <th key={c.key} style={{ ...thStyle, width: c.width || 'auto' }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} style={{ ...tdStyle, textAlign: 'center', color: C.muted, padding: '32px 14px' }}>{emptyMessage}</td></tr>
          ) : rows.map((row, i) => (
            <tr
              key={i}
              onClick={() => onRowClick && onRowClick(row)}
              style={{ transition: 'background 0.1s', cursor: onRowClick ? 'pointer' : 'default', background: selectedId && row.id === selectedId ? `${C.acc}0e` : 'transparent', borderLeft: selectedId && row.id === selectedId ? `3px solid ${C.acc}` : '3px solid transparent' }}
              onMouseEnter={e => { if (!selectedId || row.id !== selectedId) e.currentTarget.style.background = C.surf; }}
              onMouseLeave={e => { e.currentTarget.style.background = selectedId && row.id === selectedId ? `${C.acc}0e` : 'transparent'; }}
            >
              {columns.map(c => <td key={c.key} style={tdStyle}>{c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Toggle({ checked, onChange, disabled = false }) {
  return (
    <div onClick={() => !disabled && onChange(!checked)} style={{ width: 40, height: 22, borderRadius: 11, background: checked ? C.acc2 : C.brd2, position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background 0.2s', flexShrink: 0, opacity: disabled ? 0.5 : 1 }}>
      <div style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
    </div>
  );
}

function Badge({ text, color = C.acc, bg }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 12, fontSize: 10, fontWeight: 700, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase', color, background: bg || `${color}20`, border: `1px solid ${color}40` }}>
      {text}
    </span>
  );
}

function Pagination({ page, total, perPage, onPage }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', justifyContent: 'flex-end' }}>
      <span style={{ fontSize: 11, color: C.muted }}>Page {page} of {totalPages} ({total} total)</span>
      <button onClick={() => onPage(page - 1)} disabled={page <= 1} style={{ padding: '4px 10px', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 5, color: C.txt2, fontSize: 12, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1, fontFamily: FONT }}>‹</button>
      <button onClick={() => onPage(page + 1)} disabled={page >= totalPages} style={{ padding: '4px 10px', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 5, color: C.txt2, fontSize: 12, cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, fontFamily: FONT }}>›</button>
    </div>
  );
}

function SectionCard({ title, children, action }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${C.brd}` }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.txt, letterSpacing: '0.01em' }}>{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function Field({ label, children, note }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontSize: 11, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>{label}</label>
      {children}
      {note && <div style={{ fontSize: 11, color: C.muted, marginTop: 5 }}>{note}</div>}
    </div>
  );
}

const inputStyle = {
  width: '100%', background: C.surf, border: `1px solid ${C.brd2}`,
  borderRadius: 7, padding: '9px 12px', color: C.txt,
  fontFamily: FONT, fontSize: 13, outline: 'none', boxSizing: 'border-box',
};

function ErrorBox({ msg }) {
  return (
    <div style={{ padding: '10px 14px', background: `${C.red}12`, border: `1px solid ${C.red}30`, borderRadius: 7, color: C.red, fontSize: 12, marginBottom: 16 }}>
      {msg}
    </div>
  );
}

function FilterBar({ filters, active, onSelect }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {filters.map(f => (
        <button key={f.id} onClick={() => onSelect(f.id)} style={{
          padding: '6px 13px', background: active === f.id ? C.acc2 : 'transparent',
          border: `1px solid ${active === f.id ? C.acc2 : C.brd2}`, borderRadius: 6,
          color: active === f.id ? '#fff' : C.txt2, fontSize: 12, cursor: 'pointer',
          fontFamily: FONT, textTransform: 'capitalize',
        }}>
          {f.label}
          {f.count != null && f.count > 0 && (
            <span style={{ marginLeft: 5, background: active === f.id ? 'rgba(255,255,255,0.2)' : `${C.acc}22`, borderRadius: 8, padding: '1px 6px', fontSize: 10, fontFamily: MONO, color: active === f.id ? '#fff' : C.acc }}>{f.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: OVERVIEW (redesigned)
   ════════════════════════════════════════════════════════════════════════ */

function PrimaryMetric({ label, value, sub, loading, color = C.acc, onClick }) {
  return (
    <div onClick={onClick} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '20px 22px', cursor: onClick ? 'pointer' : 'default', transition: 'border-color 0.15s' }}
      onMouseEnter={e => onClick && (e.currentTarget.style.borderColor = color)}
      onMouseLeave={e => onClick && (e.currentTarget.style.borderColor = C.brd)}
    >
      {loading ? <div style={{ height: 40, display: 'flex', alignItems: 'center' }}><Spinner /></div> : (
        <div style={{ fontSize: 32, fontWeight: 800, color, fontFamily: MONO, letterSpacing: '-1.5px', lineHeight: 1 }}>{value ?? '—'}</div>
      )}
      <div style={{ fontSize: 11, color: C.muted, marginTop: 8, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SmallMetric({ label, value, loading }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '12px 14px' }}>
      {loading ? <Spinner size={12} /> : <div style={{ fontSize: 18, fontWeight: 700, color: C.txt, fontFamily: MONO }}>{value ?? '—'}</div>}
      <div style={{ fontSize: 10, color: C.muted, marginTop: 5, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

function OverviewSection({ onNavigate }) {
  const [metrics, setMetrics] = useState(null);
  const [health,  setHealth]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [m, h] = await Promise.all([adminApi.metrics(), adminApi.health().catch(() => null)]);
      setMetrics(m); setHealth(h);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const m = metrics || {};
  const unread  = m.contactMessages?.unread ?? 0;
  const failed7 = m.securityEvents?.failedLogins7d ?? 0;
  const suspended = m.users?.suspended ?? 0;
  const dbOk = health?.db === 'ok' || health?.database === 'ok';

  const attention = [
    unread > 0    && { icon: '✉', color: C.ylw, msg: `${unread} unread message${unread !== 1 ? 's' : ''}`,               go: 'messages' },
    suspended > 0 && { icon: '◈', color: C.red,  msg: `${suspended} suspended user${suspended !== 1 ? 's' : ''}`,         go: 'users' },
    failed7 > 10  && { icon: '◬', color: C.red,  msg: `${failed7} failed login attempts in the last 7 days`,              go: 'security' },
    health && !dbOk && { icon: '▣', color: C.red,  msg: 'Database health check failed',                                    go: 'health' },
  ].filter(Boolean);

  const secondary = [
    { label: 'New Today',    value: m.users?.today },
    { label: 'New This Week', value: m.users?.thisWeek },
    { label: 'Active (not suspended)', value: (m.users?.total ?? 0) - (m.users?.suspended ?? 0) },
    { label: 'Projects Today', value: m.projects?.today },
    { label: 'Projects / Week', value: m.projects?.thisWeek },
    { label: 'Total Studies', value: m.studies },
    { label: 'Total Records', value: m.records },
    { label: 'Total Messages', value: m.contactMessages?.total },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: 0 }}>Platform Overview</h2>
        <button onClick={load} style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>↻ Refresh</button>
      </div>

      {error && <ErrorBox msg={error} />}

      {/* Primary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        <PrimaryMetric label="Total Users" value={m.users?.total} sub={`+${m.users?.thisMonth ?? 0} this month`} loading={loading} color={C.acc} onClick={() => onNavigate('users')} />
        <PrimaryMetric label="Total Projects" value={m.projects?.total} sub={`+${m.projects?.thisMonth ?? 0} this month`} loading={loading} color={C.grn} onClick={() => onNavigate('projects')} />
        <PrimaryMetric label="Unread Messages" value={unread} loading={loading} color={unread > 0 ? C.ylw : C.muted} onClick={() => onNavigate('messages')} />
        <PrimaryMetric label="Failed Logins (7d)" value={failed7} loading={loading} color={failed7 > 10 ? C.red : C.muted} onClick={() => onNavigate('security')} />
      </div>

      {/* Secondary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
        {secondary.map(s => <SmallMetric key={s.label} label={s.label} value={s.value} loading={loading} />)}
      </div>

      {/* Needs Attention + Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <SectionCard title="Needs Attention">
          <div style={{ padding: '8px 0' }}>
            {attention.length === 0 ? (
              <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: C.grn, fontSize: 14 }}>✓</span>
                <span style={{ fontSize: 12, color: C.txt2 }}>Everything looks good.</span>
              </div>
            ) : attention.map((a, i) => (
              <button key={i} onClick={() => onNavigate(a.go)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 20px', background: 'transparent', border: 'none', borderBottom: i < attention.length - 1 ? `1px solid ${C.brd}` : 'none', cursor: 'pointer', textAlign: 'left', fontFamily: FONT }}>
                <span style={{ color: a.color, fontSize: 14, flexShrink: 0 }}>{a.icon}</span>
                <span style={{ fontSize: 12, color: C.txt2, flex: 1 }}>{a.msg}</span>
                <span style={{ fontSize: 10, color: C.muted }}>→</span>
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Quick Actions">
          <div style={{ padding: '8px 0' }}>
            {[
              { icon: '◈', label: 'Manage Users',     sub: `${m.users?.total ?? '—'} total`,       go: 'users' },
              { icon: '⬡', label: 'Manage Projects',  sub: `${m.projects?.total ?? '—'} total`,    go: 'projects' },
              { icon: '✉', label: 'View Messages',    sub: `${unread} unread`,                     go: 'messages' },
              { icon: '✦', label: 'Edit Website',     sub: 'landing page content',                 go: 'content' },
            ].map((a, i, arr) => (
              <button key={a.go} onClick={() => onNavigate(a.go)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '11px 20px', background: 'transparent', border: 'none', borderBottom: i < arr.length - 1 ? `1px solid ${C.brd}` : 'none', cursor: 'pointer', textAlign: 'left', fontFamily: FONT }}
                onMouseEnter={e => e.currentTarget.style.background = `${C.acc}08`}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ color: C.acc, fontSize: 14, width: 20, textAlign: 'center' }}>{a.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.txt }}>{a.label}</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{a.sub}</div>
                </div>
                <span style={{ fontSize: 10, color: C.muted }}>→</span>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* System health row */}
      <SectionCard title="System Status">
        <div style={{ display: 'flex', gap: 0 }}>
          {[
            { label: 'Backend',     value: health ? <Badge text="OK" color={C.grn} /> : <Badge text="Unknown" color={C.muted} /> },
            { label: 'Database',    value: health ? (dbOk ? <Badge text="OK" color={C.grn} /> : <Badge text="Error" color={C.red} />) : <Badge text="Unknown" color={C.muted} /> },
            { label: 'Environment', value: <Badge text={health?.env || 'unknown'} color={health?.env === 'production' ? C.ylw : C.grn} /> },
            { label: 'Version',     value: <span style={{ fontFamily: MONO, fontSize: 12, color: C.txt2 }}>{health?.version || '—'}</span> },
            { label: 'Uptime',      value: health?.uptime != null ? <span style={{ fontFamily: MONO, fontSize: 12, color: C.txt2 }}>{Math.floor(health.uptime / 3600)}h {Math.floor((health.uptime % 3600) / 60)}m</span> : <span style={{ color: C.muted }}>—</span> },
          ].map((row, i, arr) => (
            <div key={row.label} style={{ flex: 1, padding: '14px 18px', borderRight: i < arr.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
              <div style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{row.label}</div>
              {loading ? <Spinner size={12} /> : row.value}
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: MESSAGES (inbox redesign)
   ════════════════════════════════════════════════════════════════════════ */

function InboxItem({ msg, selected, onClick }) {
  const isUnread = !msg.read && !msg.archived;
  return (
    <div onClick={onClick} style={{
      padding: '11px 14px', borderBottom: `1px solid ${C.brd}`,
      background: selected ? `${C.acc}10` : 'transparent',
      borderLeft: `3px solid ${selected ? C.acc : isUnread ? C.ylw : 'transparent'}`,
      cursor: 'pointer', transition: 'background 0.1s',
    }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = `${C.acc}07`; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
        <span style={{ fontSize: 12, fontWeight: isUnread ? 700 : 500, color: isUnread ? C.txt : C.txt2, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>
          {msg.name || msg.email}
        </span>
        <span style={{ fontSize: 10, color: C.muted, fontFamily: MONO, flexShrink: 0 }}>{fmtAgo(msg.createdAt)}</span>
      </div>
      <div style={{ fontSize: 11, color: isUnread ? C.txt2 : C.muted, fontWeight: isUnread ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
        {msg.subject || '(no subject)'}
      </div>
      <div style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {msg.message ? msg.message.slice(0, 70) + (msg.message.length > 70 ? '…' : '') : ''}
      </div>
    </div>
  );
}

function MessageDetail({ msg, onMarkRead, onArchive, onDelete }) {
  const isUnread = !msg.read && !msg.archived;
  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 6 }}>{msg.subject || '(no subject)'}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {msg.archived
                ? <Badge text="archived" color={C.muted} />
                : isUnread
                  ? <Badge text="unread" color={C.ylw} />
                  : <Badge text="read" color={C.grn} />}
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
            {fmtDateTime(msg.createdAt)}
          </div>
        </div>
        <div style={{ padding: '12px 16px', background: C.surf, borderRadius: 8, border: `1px solid ${C.brd}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.txt, marginBottom: 3 }}>{msg.name}</div>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{msg.email}</div>
        </div>
      </div>

      <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.85, whiteSpace: 'pre-wrap', padding: 18, background: C.surf, borderRadius: 8, border: `1px solid ${C.brd}`, marginBottom: 22, minHeight: 100 }}>
        {msg.message}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {isUnread ? (
          <button onClick={() => onMarkRead(msg.id, true)} style={{ padding: '7px 14px', background: `${C.grn}15`, border: `1px solid ${C.grn}30`, borderRadius: 6, color: C.grn, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Mark as Read</button>
        ) : !msg.archived ? (
          <button onClick={() => onMarkRead(msg.id, false)} style={{ padding: '7px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Mark as Unread</button>
        ) : null}
        {!msg.archived && (
          <button onClick={() => onArchive(msg.id)} style={{ padding: '7px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Archive</button>
        )}
        <button onClick={() => onDelete(msg)} style={{ padding: '7px 14px', background: `${C.red}12`, border: `1px solid ${C.red}30`, borderRadius: 6, color: C.red, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>Delete</button>
      </div>
    </div>
  );
}

function MessagesSection({ onUnreadChange }) {
  const [messages, setMessages] = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all');
  const [sort,     setSort]     = useState('newest');
  const [page,     setPage]     = useState(1);
  const [selected, setSelected] = useState(null);
  const [confirm,  setConfirm]  = useState(null);
  const searchTimer = useRef(null);
  const PER_PAGE = 30;

  const load = useCallback(async (f, s, so, p) => {
    setLoading(true); setError('');
    try {
      const params = { page: p, limit: PER_PAGE, sort: so };
      if (f === 'unread')   params.read = false;
      else if (f === 'read')     params.read = true;
      else if (f === 'archived') params.archived = true;
      if (s) params.search = s;
      const data = await adminApi.messages.list(params);
      const msgs = (data.messages || []).map(m => ({
        ...m,
        status: m.archived ? 'archived' : m.read ? 'read' : 'unread',
      }));
      setMessages(msgs);
      setTotal(data.total || msgs.length);
    } catch (e) { setMessages([]); setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(filter, search, sort, 1); }, []);

  function handleSearch(val) {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); load(filter, val, sort, 1); }, 280);
  }

  async function selectMsg(msg) {
    setSelected(msg);
    if (!msg.read && !msg.archived) {
      try {
        await adminApi.messages.update(msg.id, { read: true });
        setMessages(ms => ms.map(m => m.id === msg.id ? { ...m, read: true, status: 'read' } : m));
        setSelected(m => m ? { ...m, read: true, status: 'read' } : m);
        setUnread(c => Math.max(0, c - 1));
        onUnreadChange?.(prev => Math.max(0, prev - 1));
      } catch { /* silent */ }
    }
  }

  async function markRead(id, isRead) {
    try {
      await adminApi.messages.update(id, { read: isRead });
      const next = ms => ms.map(m => m.id === id ? { ...m, read: isRead, status: m.archived ? 'archived' : isRead ? 'read' : 'unread' } : m);
      setMessages(next);
      setSelected(m => m && m.id === id ? { ...m, read: isRead, status: m.archived ? 'archived' : isRead ? 'read' : 'unread' } : m);
      if (isRead === true) {
        onUnreadChange?.(prev => Math.max(0, prev - 1));
      } else if (isRead === false) {
        onUnreadChange?.(prev => prev + 1);
      }
    } catch { /* silent */ }
  }

  async function archiveMsg(id) {
    try {
      await adminApi.messages.update(id, { archived: true });
      const wasUnread = messages.find(m => m.id === id && !m.read && !m.archived);
      if (wasUnread) onUnreadChange?.(prev => Math.max(0, prev - 1));
      load(filter, search, sort, page);
      setSelected(m => m && m.id === id ? null : m);
    } catch { /* silent */ }
  }

  async function doDelete() {
    if (!confirm) return;
    try {
      await adminApi.messages.delete(confirm.id);
      const wasUnread = messages.find(m => m.id === confirm?.id && !m.read && !m.archived);
      if (wasUnread) onUnreadChange?.(prev => Math.max(0, prev - 1));
      load(filter, search, sort, page);
      setSelected(m => m && m.id === confirm.id ? null : m);
    } catch { /* silent */ }
    setConfirm(null);
  }

  const unreadCount = messages.filter(m => !m.read && !m.archived).length;

  const filterDefs = [
    { id: 'all',      label: 'All' },
    { id: 'unread',   label: 'Unread', count: unreadCount },
    { id: 'read',     label: 'Read' },
    { id: 'archived', label: 'Archived' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: 0 }}>Contact Messages</h2>
        {unreadCount > 0 && <Badge text={`${unreadCount} unread`} color={C.ylw} />}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: C.muted }}>Sort:</span>
          <select value={sort} onChange={e => { setSort(e.target.value); setPage(1); load(filter, search, e.target.value, 1); }}
            style={{ ...inputStyle, width: 'auto', padding: '5px 8px', fontSize: 12 }}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>

      {error && <ErrorBox msg={error} />}

      <div style={{ display: 'flex', height: 620, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, overflow: 'hidden' }}>
        {/* Left panel — list */}
        <div style={{ width: 340, flexShrink: 0, borderRight: `1px solid ${C.brd}`, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 10px 6px' }}>
            <input type="text" placeholder="Search messages…" value={search} onChange={e => handleSearch(e.target.value)}
              style={{ ...inputStyle, fontSize: 12 }} />
          </div>
          <div style={{ padding: '0 10px 8px', display: 'flex', gap: 3 }}>
            {filterDefs.map(f => (
              <button key={f.id} onClick={() => { setFilter(f.id); setPage(1); load(f.id, search, sort, 1); }} style={{
                flex: 1, padding: '4px 2px', background: filter === f.id ? C.acc2 : 'transparent',
                border: `1px solid ${filter === f.id ? C.acc2 : C.brd2}`, borderRadius: 5,
                color: filter === f.id ? '#fff' : C.txt2, fontSize: 10, cursor: 'pointer', fontFamily: FONT,
              }}>
                {f.label}{f.count > 0 ? ` (${f.count})` : ''}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center' }}><Spinner /></div>
            ) : messages.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}>No messages found.</div>
            ) : messages.map(msg => (
              <InboxItem key={msg.id} msg={msg} selected={selected?.id === msg.id} onClick={() => selectMsg(msg)} />
            ))}
          </div>
          <div style={{ padding: '4px 10px', borderTop: `1px solid ${C.brd}` }}>
            <Pagination page={page} total={total} perPage={PER_PAGE} onPage={p => { setPage(p); load(filter, search, sort, p); }} />
          </div>
        </div>

        {/* Right panel — detail */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {selected ? (
            <MessageDetail msg={selected} onMarkRead={markRead} onArchive={archiveMsg} onDelete={setConfirm} />
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <span style={{ fontSize: 28, color: C.brd2 }}>✉</span>
              <span style={{ fontSize: 13, color: C.muted }}>Select a message to read it</span>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal open={!!confirm} title="Delete Message"
        message={`Permanently delete message from ${confirm?.name}? This cannot be undone.`}
        confirmLabel="Delete" danger onConfirm={doDelete} onCancel={() => setConfirm(null)} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: USERS (redesigned — table + detail side panel with projects)
   ════════════════════════════════════════════════════════════════════════ */

function UserProjectItem({ project }) {
  return (
    <div style={{ margin: '0 12px 8px', padding: '10px 12px', background: C.surf, borderRadius: 7, border: `1px solid ${C.brd}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.txt, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>{project.name}</span>
        {project.status === 'archived' && <Badge text="archived" color={C.ylw} />}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: C.muted, fontFamily: MONO, marginBottom: 3 }}>
        <span>{project.studyCount} studies</span>
        <span>{project.recordCount} records</span>
        {project.metaRuns > 0 && <span>{project.metaRuns} meta-runs</span>}
      </div>
      <div style={{ fontSize: 10, color: C.muted, fontFamily: MONO }}>Updated {fmtAgo(project.updatedAt)}</div>
    </div>
  );
}

function UserDetailPanel({ user, onClose, onStatusChange }) {
  const [projects,    setProjects]    = useState([]);
  const [projLoading, setProjLoading] = useState(true);
  const [confirm,     setConfirm]     = useState(null);

  useEffect(() => {
    setProjLoading(true);
    adminApi.users.getProjects(user.id)
      .then(d => setProjects(d.projects || []))
      .catch(() => setProjects([]))
      .finally(() => setProjLoading(false));
  }, [user.id]);

  async function doStatus() {
    if (!confirm) return;
    try {
      await adminApi.users.updateStatus(user.id, { suspended: confirm === 'suspend' });
      onStatusChange();
      onClose();
    } catch { /* silent */ }
    setConfirm(null);
  }

  return (
    <div style={{ width: 300, flexShrink: 0, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start', position: 'sticky', top: TOPBAR_H + 28, maxHeight: `calc(100vh - ${TOPBAR_H + 60}px)`, overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.brd}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.txt }}>User Detail</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
      </div>

      {/* Profile */}
      <div style={{ padding: '16px 16px 12px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 2 }}>{user.name || '—'}</div>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, marginBottom: 10 }}>{user.email}</div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
          {user.role === 'admin' ? <Badge text="admin" color={C.acc} /> : <Badge text="user" color={C.muted} />}
          {user.suspended ? <Badge text="suspended" color={C.red} /> : <Badge text="active" color={C.grn} />}
        </div>
        {[
          { label: 'Joined',      value: fmtDate(user.createdAt) },
          { label: 'Last Active', value: user.lastActive ? fmtAgo(user.lastActive) : 'Never' },
          { label: 'Projects',    value: user.projectCount ?? 0 },
        ].map(r => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.brd}` }}>
            <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{r.label}</span>
            <span style={{ fontSize: 11, color: C.txt2, fontFamily: MONO }}>{r.value}</span>
          </div>
        ))}
      </div>

      {/* Projects */}
      <div style={{ borderTop: `1px solid ${C.brd}` }}>
        <div style={{ padding: '10px 16px 6px', fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Projects ({projects.length})
        </div>
        {projLoading ? (
          <div style={{ padding: 16, textAlign: 'center' }}><Spinner /></div>
        ) : projects.length === 0 ? (
          <div style={{ padding: '10px 16px', color: C.muted, fontSize: 12 }}>No projects.</div>
        ) : (
          <div style={{ paddingBottom: 8 }}>
            {projects.map(p => <UserProjectItem key={p.id} project={p} />)}
          </div>
        )}
      </div>

      {/* Actions */}
      {user.role !== 'admin' && (
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.brd}` }}>
          {user.suspended ? (
            <button onClick={() => setConfirm('reactivate')} style={{ width: '100%', padding: '8px', background: `${C.grn}15`, border: `1px solid ${C.grn}30`, borderRadius: 6, color: C.grn, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
              Reactivate Account
            </button>
          ) : (
            <button onClick={() => setConfirm('suspend')} style={{ width: '100%', padding: '8px', background: `${C.red}10`, border: `1px solid ${C.red}30`, borderRadius: 6, color: C.red, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
              Suspend Account
            </button>
          )}
        </div>
      )}

      <ConfirmModal open={!!confirm}
        title={confirm === 'suspend' ? 'Suspend User' : 'Reactivate User'}
        message={confirm === 'suspend' ? `Suspend ${user.email}? They will not be able to log in.` : `Reactivate ${user.email}? They will regain full access.`}
        confirmLabel={confirm === 'suspend' ? 'Suspend' : 'Reactivate'}
        danger={confirm === 'suspend'} onConfirm={doStatus} onCancel={() => setConfirm(null)} />
    </div>
  );
}

function UsersSection() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('all');
  const [page,    setPage]    = useState(1);
  const [selectedUser, setSelectedUser] = useState(null);
  const searchTimer = useRef(null);
  const PER_PAGE = 25;

  const load = useCallback(async (s, f, p) => {
    setLoading(true); setError('');
    try {
      const params = { page: p, limit: PER_PAGE };
      if (s) params.search = s;
      if (f === 'suspended') params.suspended = true;
      if (f === 'active')    params.suspended = false;
      if (f === 'admins')    params.role = 'admin';
      const data = await adminApi.users.list(params);
      setRows((data.users || []).map(u => ({ ...u, status: u.suspended ? 'suspended' : 'active' })));
      setTotal(data.total || 0);
    } catch (e) { setRows([]); setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(search, filter, page); }, [page, filter]);

  function handleSearch(val) {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); load(val, filter, 1); }, 280);
  }

  const columns = [
    { key: 'name',         label: 'Name',         render: (v, row) => <span style={{ color: C.txt, fontWeight: 600 }}>{v || <span style={{ color: C.muted }}>—</span>}</span> },
    { key: 'email',        label: 'Email',         render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v}</span> },
    { key: 'role',         label: 'Role',          render: v => v === 'admin' ? <Badge text="admin" color={C.acc} /> : <Badge text="user" color={C.muted} /> },
    { key: 'status',       label: 'Status',        render: v => v === 'active' ? <Badge text="active" color={C.grn} /> : <Badge text="suspended" color={C.red} /> },
    { key: 'projectCount', label: 'Projects',      render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'createdAt',    label: 'Joined',        render: v => fmtDate(v) },
    { key: 'lastActive',   label: 'Last Active',   render: v => v ? fmtAgo(v) : <span style={{ color: C.muted }}>Never</span> },
  ];

  const filterDefs = [
    { id: 'all',       label: 'All' },
    { id: 'active',    label: 'Active' },
    { id: 'suspended', label: 'Suspended' },
    { id: 'admins',    label: 'Admins' },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>User Management</h2>
      {error && <ErrorBox msg={error} />}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="Search name or email…" value={search} onChange={e => handleSearch(e.target.value)}
          style={{ ...inputStyle, width: 260, flex: 'none' }} />
        <FilterBar filters={filterDefs} active={filter} onSelect={f => { setFilter(f); setPage(1); load(search, f, 1); }} />
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionCard>
            <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No users found."
              onRowClick={u => setSelectedUser(prev => prev?.id === u.id ? null : u)}
              selectedId={selectedUser?.id} />
            <div style={{ padding: '0 14px' }}>
              <Pagination page={page} total={total} perPage={PER_PAGE} onPage={setPage} />
            </div>
          </SectionCard>
          {!selectedUser && (
            <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: -10, marginBottom: 8 }}>
              Click a row to view user details and projects
            </div>
          )}
        </div>

        {selectedUser && (
          <UserDetailPanel
            user={selectedUser}
            onClose={() => setSelectedUser(null)}
            onStatusChange={() => load(search, filter, page)}
          />
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: PROJECTS (redesigned — search + detail drawer)
   ════════════════════════════════════════════════════════════════════════ */

function ProjectDetailPanel({ project, onClose, onAction }) {
  const [confirm, setConfirm] = useState(null);

  async function doAction() {
    if (!confirm) return;
    try {
      if (confirm === 'archive') await adminApi.projects.archive(project.id);
      else await adminApi.projects.restore(project.id);
      onAction();
      onClose();
    } catch { /* silent */ }
    setConfirm(null);
  }

  const isArchived = !!project.deletedAt;

  return (
    <div style={{ width: 280, flexShrink: 0, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start', position: 'sticky', top: TOPBAR_H + 28 }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.brd}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.txt }}>Project Detail</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>

      <div style={{ padding: '16px 16px 12px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 4 }}>{project.name}</div>
        <div style={{ display: 'flex', gap: 5, marginBottom: 12 }}>
          {isArchived ? <Badge text="archived" color={C.ylw} /> : <Badge text="active" color={C.grn} />}
        </div>
        {[
          { label: 'Owner',    value: <span style={{ fontFamily: MONO, fontSize: 11 }}>{project.ownerEmail || project.userEmail || '—'}</span> },
          { label: 'Created',  value: fmtDate(project.createdAt) },
          { label: 'Updated',  value: fmtAgo(project.updatedAt) },
          { label: 'Studies',  value: project.studyCount ?? 0 },
          { label: 'Records',  value: project.recordCount ?? 0 },
        ].map(r => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.brd}` }}>
            <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{r.label}</span>
            <span style={{ fontSize: 11, color: C.txt2 }}>{r.value}</span>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.brd}` }}>
        {isArchived ? (
          <button onClick={() => setConfirm('restore')} style={{ width: '100%', padding: '8px', background: `${C.grn}15`, border: `1px solid ${C.grn}30`, borderRadius: 6, color: C.grn, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
            Restore Project
          </button>
        ) : (
          <button onClick={() => setConfirm('archive')} style={{ width: '100%', padding: '8px', background: `${C.ylw}10`, border: `1px solid ${C.ylw}30`, borderRadius: 6, color: C.ylw, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
            Archive Project
          </button>
        )}
      </div>

      <ConfirmModal open={!!confirm}
        title={confirm === 'archive' ? 'Archive Project' : 'Restore Project'}
        message={confirm === 'archive' ? `Archive "${project.name}"? It will be hidden from the owner.` : `Restore "${project.name}"?`}
        confirmLabel={confirm === 'archive' ? 'Archive' : 'Restore'}
        danger={confirm === 'archive'} onConfirm={doAction} onCancel={() => setConfirm(null)} />
    </div>
  );
}

function ProjectsSection() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('all');
  const [page,    setPage]    = useState(1);
  const [selectedProject, setSelectedProject] = useState(null);
  const searchTimer = useRef(null);
  const PER_PAGE = 25;

  const load = useCallback(async (s, f, p) => {
    setLoading(true); setError('');
    try {
      const params = { page: p, limit: PER_PAGE };
      if (s) params.search = s;
      if (f !== 'all') params.status = f;
      const data = await adminApi.projects.list(params);
      setRows((data.projects || []).map(p => ({ ...p, ownerEmail: p.userEmail || p.ownerEmail })));
      setTotal(data.total || 0);
    } catch (e) { setRows([]); setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(search, filter, page); }, [page]);

  function handleSearch(val) {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); load(val, filter, 1); }, 280);
  }

  const columns = [
    { key: 'name',       label: 'Name',    render: v => <span style={{ color: C.txt, fontWeight: 600 }}>{v}</span> },
    { key: 'ownerEmail', label: 'Owner',   render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v || '—'}</span> },
    { key: 'createdAt',  label: 'Created', render: v => fmtDate(v) },
    { key: 'updatedAt',  label: 'Updated', render: v => fmtAgo(v) },
    { key: 'studyCount', label: 'Studies', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'recordCount',label: 'Records', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'deletedAt',  label: 'Status',  render: v => v ? <Badge text="archived" color={C.ylw} /> : <Badge text="active" color={C.grn} /> },
  ];

  const filterDefs = [
    { id: 'all',      label: 'All' },
    { id: 'active',   label: 'Active' },
    { id: 'archived', label: 'Archived' },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>Projects</h2>
      {error && <ErrorBox msg={error} />}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="Search by project name…" value={search} onChange={e => handleSearch(e.target.value)}
          style={{ ...inputStyle, width: 260, flex: 'none' }} />
        <FilterBar filters={filterDefs} active={filter} onSelect={f => { setFilter(f); setPage(1); load(search, f, 1); }} />
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionCard>
            <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No projects found."
              onRowClick={p => setSelectedProject(prev => prev?.id === p.id ? null : p)}
              selectedId={selectedProject?.id} />
            <div style={{ padding: '0 14px' }}>
              <Pagination page={page} total={total} perPage={PER_PAGE} onPage={setPage} />
            </div>
          </SectionCard>
        </div>

        {selectedProject && (
          <ProjectDetailPanel
            project={selectedProject}
            onClose={() => setSelectedProject(null)}
            onAction={() => load(search, filter, page)}
          />
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: CONTENT (expanded — full website editor)
   ════════════════════════════════════════════════════════════════════════ */

const DEFAULT_CONTENT = {
  logoText: 'META·LAB',
  navLinks: [
    { label: 'Features', href: '#features' },
    { label: 'Workflow', href: '#workflow' },
    { label: 'About',    href: '#about' },
  ],
  heroHeadline:      'A serious workspace for\nsystematic reviews.',
  heroSubtitle:      'Organize evidence, extract data, run pooled analyses, and export research-ready reports — from one secure platform.',
  ctaText:           'Start Your Review →',
  ctaSecondaryText:  'Sign in',
  featureTitle:      'Everything a rigorous review needs',
  featureCards: [
    { icon: '◈', label: 'Protocol-first',   desc: 'Start with PICO and PROSPERO registration before touching a single record.' },
    { icon: '⊞', label: 'Reproducible',     desc: 'Every search string, screening decision, and diagram is logged and exportable.' },
    { icon: '◉', label: 'Analysis-ready',   desc: "Built-in forest plots, heterogeneity stats, Egger's test, and GRADE ratings." },
    { icon: '⬡', label: 'Single workspace', desc: 'From research question to manuscript draft — all in one structured tool.' },
  ],
  workflowTitle:    '14 steps from question to manuscript',
  workflowSubtitle: 'Every systematic review follows the same evidence-based process. META·LAB walks you through each stage without letting you skip ahead.',
  whyTitle:  'For researchers who care about rigor',
  whyBody1:  'Systematic reviews demand a level of methodological transparency that general research tools cannot provide.',
  whyBody2:  'META·LAB enforces a structured workflow aligned with Cochrane Handbook principles and international reporting standards.',
  whyBody3:  'Every decision — from inclusion criteria to subgroup definitions — is documented in a tamper-evident audit trail, so peer reviewers and editors can retrace your entire process.',
  whyStandards: [
    'PRISMA 2020 — flow diagram generation',
    'Cochrane RoB 2.0 & ROBINS-I',
    'GRADE certainty-of-evidence framework',
    'Full audit trail — every decision timestamped',
  ],
  aboutHeadline: 'What is META·LAB?',
  aboutText1: 'META·LAB is a structured, multi-user platform for conducting systematic reviews and meta-analyses. It covers the complete research cycle — from PICO definition and search strategy through screening, data extraction, statistical analysis, and manuscript preparation.',
  aboutText2: 'Built for academic researchers, clinical teams, and evidence synthesis groups who need a single, auditable workspace rather than a collection of disconnected tools.',
  contactTitle:    'Get in touch',
  contactSubtitle: 'Questions about META·LAB, research collaborations, or institutional access.',
  footerText:  `© ${new Date().getFullYear()} META·LAB · Systematic review platform`,
  footerLinks: [
    { label: 'Register', path: '/register' },
    { label: 'Sign In',  path: '/login' },
  ],
  announcementBanner: '',
  maintenanceBanner:  '',
  seoTitle:       'META·LAB — Systematic Review Platform',
  seoDescription: 'A structured, multi-user platform for conducting systematic reviews and meta-analyses.',
};

const CONTENT_TABS = [
  { id: 'hero',    label: 'Hero & CTA' },
  { id: 'nav',     label: 'Navbar & Logo' },
  { id: 'features',label: 'Features' },
  { id: 'workflow',label: 'Workflow' },
  { id: 'about',   label: 'About & Why' },
  { id: 'contact', label: 'Contact & Footer' },
  { id: 'seo',     label: 'SEO & Banners' },
];

function ContentSection() {
  const [content, setContent]   = useState(DEFAULT_CONTENT);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState('hero');
  const [statuses, setStatuses]  = useState({}); // { [tabId]: 'idle'|'saving'|'saved'|'error' }

  useEffect(() => {
    adminApi.landingContent.get()
      .then(d => { if (d && typeof d === 'object') setContent(c => ({ ...DEFAULT_CONTENT, ...c, ...d })); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function setStatus(tabId, s) {
    setStatuses(prev => ({ ...prev, [tabId]: s }));
    if (s === 'saved' || s === 'error') setTimeout(() => setStatuses(prev => ({ ...prev, [tabId]: 'idle' })), 3000);
  }

  async function saveAll() {
    setStatus(activeTab, 'saving');
    try {
      await adminApi.landingContent.save(content);
      setStatus(activeTab, 'saved');
    } catch {
      setStatus(activeTab, 'error');
    }
  }

  function upd(key, value) { setContent(c => ({ ...c, [key]: value })); }
  function updCard(i, key, value) {
    const cards = [...(content.featureCards || [])];
    cards[i] = { ...cards[i], [key]: value };
    upd('featureCards', cards);
  }
  function addCard() {
    upd('featureCards', [...(content.featureCards || []), { icon: '◈', label: 'New Feature', desc: '' }]);
  }
  function removeCard(i) {
    upd('featureCards', (content.featureCards || []).filter((_, idx) => idx !== i));
  }
  function updNavLink(i, key, value) {
    const links = [...(content.navLinks || [])];
    links[i] = { ...links[i], [key]: value };
    upd('navLinks', links);
  }
  function addNavLink() { upd('navLinks', [...(content.navLinks || []), { label: 'New', href: '#' }]); }
  function removeNavLink(i) { upd('navLinks', (content.navLinks || []).filter((_, idx) => idx !== i)); }
  function updStandard(i, val) {
    const s = [...(content.whyStandards || [])];
    s[i] = val;
    upd('whyStandards', s);
  }
  function addStandard() { upd('whyStandards', [...(content.whyStandards || []), '']); }
  function removeStandard(i) { upd('whyStandards', (content.whyStandards || []).filter((_, idx) => idx !== i)); }
  function updFooterLink(i, key, value) {
    const links = [...(content.footerLinks || [])];
    links[i] = { ...links[i], [key]: value };
    upd('footerLinks', links);
  }
  function addFooterLink() { upd('footerLinks', [...(content.footerLinks || []), { label: '', path: '/' }]); }
  function removeFooterLink(i) { upd('footerLinks', (content.footerLinks || []).filter((_, idx) => idx !== i)); }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  const ta = { ...inputStyle, resize: 'vertical', minHeight: 88, lineHeight: 1.65 };
  const tabStatus = statuses[activeTab] || 'idle';

  const ListEditor = ({ items, onUpdate, onAdd, onRemove, fields, addLabel }) => (
    <div>
      {(items || []).map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
          {fields.map(f => (
            <input key={f.key} type="text" value={item[f.key] || ''} onChange={e => onUpdate(i, f.key, e.target.value)}
              placeholder={f.placeholder} style={{ ...inputStyle, flex: f.flex || 1 }} />
          ))}
          <button onClick={() => onRemove(i)} style={{ padding: '9px 10px', background: `${C.red}10`, border: `1px solid ${C.red}30`, borderRadius: 6, color: C.red, cursor: 'pointer', fontSize: 12 }}>✕</button>
        </div>
      ))}
      <button onClick={onAdd} style={{ padding: '7px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
        + {addLabel}
      </button>
    </div>
  );

  const renderTab = () => {
    switch (activeTab) {
      case 'hero': return (
        <div>
          <SectionCard title="Hero">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Hero Headline">
                <textarea value={content.heroHeadline || ''} onChange={e => upd('heroHeadline', e.target.value)} style={{ ...ta, minHeight: 64 }} placeholder="Main headline text" />
              </Field>
              <Field label="Hero Subtitle / Description">
                <textarea value={content.heroSubtitle || ''} onChange={e => upd('heroSubtitle', e.target.value)} style={ta} />
              </Field>
              <Field label="Primary CTA Button Text">
                <input type="text" value={content.ctaText || ''} onChange={e => upd('ctaText', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Secondary CTA Button Text">
                <input type="text" value={content.ctaSecondaryText || ''} onChange={e => upd('ctaSecondaryText', e.target.value)} style={inputStyle} placeholder="e.g. Sign in" />
              </Field>
            </div>
          </SectionCard>
        </div>
      );
      case 'nav': return (
        <div>
          <SectionCard title="Logo">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Logo Text">
                <input type="text" value={content.logoText || ''} onChange={e => upd('logoText', e.target.value)} style={{ ...inputStyle, maxWidth: 300 }} />
              </Field>
            </div>
          </SectionCard>
          <SectionCard title="Navbar Links">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Navigation Links" note="Label and anchor href (e.g. #features)">
                <ListEditor items={content.navLinks} onUpdate={updNavLink} onAdd={addNavLink} onRemove={removeNavLink}
                  fields={[{ key: 'label', placeholder: 'Label', flex: 1 }, { key: 'href', placeholder: '#anchor', flex: 1 }]} addLabel="Add Link" />
              </Field>
            </div>
          </SectionCard>
        </div>
      );
      case 'features': return (
        <div>
          <SectionCard title="Features Section">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Section Title">
                <input type="text" value={content.featureTitle || ''} onChange={e => upd('featureTitle', e.target.value)} style={inputStyle} />
              </Field>
            </div>
          </SectionCard>
          <SectionCard title="Feature Cards">
            <div style={{ padding: '18px 20px' }}>
              {(content.featureCards || []).map((card, i) => (
                <div key={i} style={{ background: C.surf, borderRadius: 8, border: `1px solid ${C.brd}`, padding: '14px 16px', marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Card {i + 1}</span>
                    <button onClick={() => removeCard(i)} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 12, fontFamily: FONT }}>Remove</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, marginBottom: 8 }}>
                    <input type="text" value={card.icon || ''} onChange={e => updCard(i, 'icon', e.target.value)} placeholder="Icon" style={{ ...inputStyle, textAlign: 'center', fontSize: 18 }} />
                    <input type="text" value={card.label || ''} onChange={e => updCard(i, 'label', e.target.value)} placeholder="Card title" style={inputStyle} />
                  </div>
                  <textarea value={card.desc || ''} onChange={e => updCard(i, 'desc', e.target.value)} placeholder="Description" style={{ ...ta, minHeight: 60 }} />
                </div>
              ))}
              <button onClick={addCard} style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
                + Add Feature Card
              </button>
            </div>
          </SectionCard>
        </div>
      );
      case 'workflow': return (
        <div>
          <SectionCard title="Workflow Section">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Section Title">
                <input type="text" value={content.workflowTitle || ''} onChange={e => upd('workflowTitle', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Section Subtitle">
                <textarea value={content.workflowSubtitle || ''} onChange={e => upd('workflowSubtitle', e.target.value)} style={ta} />
              </Field>
            </div>
          </SectionCard>
          <div style={{ padding: '10px 0 4px', fontSize: 11, color: C.muted, fontFamily: MONO }}>
            Workflow steps are managed in code. Contact your developer to add/remove steps.
          </div>
        </div>
      );
      case 'about': return (
        <div>
          <SectionCard title="About Section">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Section Headline">
                <input type="text" value={content.aboutHeadline || ''} onChange={e => upd('aboutHeadline', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Paragraph 1">
                <textarea value={content.aboutText1 || ''} onChange={e => upd('aboutText1', e.target.value)} style={{ ...ta, minHeight: 110 }} />
              </Field>
              <Field label="Paragraph 2">
                <textarea value={content.aboutText2 || ''} onChange={e => upd('aboutText2', e.target.value)} style={{ ...ta, minHeight: 110 }} />
              </Field>
            </div>
          </SectionCard>
          <SectionCard title="Why It's Different">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Section Title">
                <input type="text" value={content.whyTitle || ''} onChange={e => upd('whyTitle', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Body Paragraph 1">
                <textarea value={content.whyBody1 || ''} onChange={e => upd('whyBody1', e.target.value)} style={ta} />
              </Field>
              <Field label="Body Paragraph 2">
                <textarea value={content.whyBody2 || ''} onChange={e => upd('whyBody2', e.target.value)} style={ta} />
              </Field>
              <Field label="Body Paragraph 3">
                <textarea value={content.whyBody3 || ''} onChange={e => upd('whyBody3', e.target.value)} style={ta} />
              </Field>
              <Field label="Standards List">
                {(content.whyStandards || []).map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input type="text" value={s} onChange={e => updStandard(i, e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                    <button onClick={() => removeStandard(i)} style={{ padding: '9px 10px', background: `${C.red}10`, border: `1px solid ${C.red}30`, borderRadius: 6, color: C.red, cursor: 'pointer', fontSize: 12 }}>✕</button>
                  </div>
                ))}
                <button onClick={addStandard} style={{ padding: '7px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>
                  + Add Standard
                </button>
              </Field>
            </div>
          </SectionCard>
        </div>
      );
      case 'contact': return (
        <div>
          <SectionCard title="Contact Section">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Section Title">
                <input type="text" value={content.contactTitle || ''} onChange={e => upd('contactTitle', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Section Subtitle">
                <textarea value={content.contactSubtitle || ''} onChange={e => upd('contactSubtitle', e.target.value)} style={ta} />
              </Field>
            </div>
          </SectionCard>
          <SectionCard title="Footer">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Footer Text" note="Copyright line shown in the footer.">
                <input type="text" value={content.footerText || ''} onChange={e => upd('footerText', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Footer Links">
                <ListEditor items={content.footerLinks} onUpdate={updFooterLink} onAdd={addFooterLink} onRemove={removeFooterLink}
                  fields={[{ key: 'label', placeholder: 'Label', flex: 1 }, { key: 'path', placeholder: '/path', flex: 1 }]} addLabel="Add Footer Link" />
              </Field>
            </div>
          </SectionCard>
        </div>
      );
      case 'seo': return (
        <div>
          <SectionCard title="SEO">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Page Title" note="Used in <title> and social previews.">
                <input type="text" value={content.seoTitle || ''} onChange={e => upd('seoTitle', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Meta Description" note="Used by search engines and social cards.">
                <textarea value={content.seoDescription || ''} onChange={e => upd('seoDescription', e.target.value)} style={{ ...ta, minHeight: 72 }} />
              </Field>
            </div>
          </SectionCard>
          <SectionCard title="Banners">
            <div style={{ padding: '18px 20px 4px' }}>
              <Field label="Announcement Banner" note="Shown as a slim dismissable bar at the top. Leave blank to hide.">
                <input type="text" value={content.announcementBanner || ''} onChange={e => upd('announcementBanner', e.target.value)} style={inputStyle} placeholder="Optional announcement…" />
              </Field>
              <Field label="Maintenance Banner" note="Shown prominently if set. Leave blank to hide.">
                <input type="text" value={content.maintenanceBanner || ''} onChange={e => upd('maintenanceBanner', e.target.value)} style={inputStyle} placeholder="Optional maintenance message…" />
              </Field>
            </div>
          </SectionCard>
        </div>
      );
      default: return null;
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>Website Content Editor</h2>

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: `1px solid ${C.brd}`, paddingBottom: 0 }}>
        {CONTENT_TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '8px 16px', background: 'transparent', border: 'none',
            borderBottom: activeTab === tab.id ? `2px solid ${C.acc}` : '2px solid transparent',
            color: activeTab === tab.id ? C.acc : C.txt2, fontSize: 12,
            fontWeight: activeTab === tab.id ? 700 : 400, cursor: 'pointer',
            fontFamily: FONT, marginBottom: -1,
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {renderTab()}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <SaveButton onClick={saveAll} status={tabStatus} label="Save Changes" />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: SETTINGS (unchanged logic, same as before)
   ════════════════════════════════════════════════════════════════════════ */

function SettingsSection() {
  const [form, setForm] = useState({
    appName: 'META·LAB', registrationOpen: true, maintenanceMode: false,
    contactFormEnabled: true, projectCreationEnabled: true, exportEnabled: true,
    maxProjectsPerUser: '', maxStudiesPerProject: '',
  });
  const [loading, setLoading] = useState(true);
  const [status,  setStatus]  = useState('idle');

  useEffect(() => {
    adminApi.settings.get().then(d => setForm(f => ({ ...f, ...d }))).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function save() {
    setStatus('saving');
    try { await adminApi.settings.save(form); setStatus('saved'); setTimeout(() => setStatus('idle'), 3000); }
    catch { setStatus('error'); setTimeout(() => setStatus('idle'), 3000); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  const Row = ({ label, note, children }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${C.brd}`, gap: 20 }}>
      <div>
        <div style={{ fontSize: 13, color: C.txt, fontWeight: 500 }}>{label}</div>
        {note && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{note}</div>}
      </div>
      {children}
    </div>
  );

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>App Settings</h2>
      <SectionCard title="General">
        <div style={{ padding: '14px 20px 10px', borderBottom: `1px solid ${C.brd}` }}>
          <Field label="App Name"><input type="text" value={form.appName} onChange={e => setForm(f => ({ ...f, appName: e.target.value }))} style={{ ...inputStyle, maxWidth: 320 }} /></Field>
        </div>
        <Row label="Registration Open" note="Allow new users to register."><Toggle checked={!!form.registrationOpen} onChange={v => setForm(f => ({ ...f, registrationOpen: v }))} /></Row>
        <Row label="Maintenance Mode" note={form.maintenanceMode ? '⚠ Users cannot log in.' : 'Put the site in maintenance mode.'}><Toggle checked={!!form.maintenanceMode} onChange={v => setForm(f => ({ ...f, maintenanceMode: v }))} /></Row>
        <Row label="Contact Form Enabled"><Toggle checked={!!form.contactFormEnabled} onChange={v => setForm(f => ({ ...f, contactFormEnabled: v }))} /></Row>
        <Row label="Project Creation Enabled"><Toggle checked={!!form.projectCreationEnabled} onChange={v => setForm(f => ({ ...f, projectCreationEnabled: v }))} /></Row>
        <Row label="Export Enabled"><Toggle checked={!!form.exportEnabled} onChange={v => setForm(f => ({ ...f, exportEnabled: v }))} /></Row>
      </SectionCard>
      <SectionCard title="Limits">
        <div style={{ padding: '14px 20px 4px' }}>
          <Field label="Max Projects Per User" note="Leave blank for unlimited.">
            <input type="number" min="0" value={form.maxProjectsPerUser} onChange={e => setForm(f => ({ ...f, maxProjectsPerUser: e.target.value }))} style={{ ...inputStyle, maxWidth: 160 }} placeholder="Unlimited" />
          </Field>
          <Field label="Max Studies Per Project" note="Leave blank for unlimited.">
            <input type="number" min="0" value={form.maxStudiesPerProject} onChange={e => setForm(f => ({ ...f, maxStudiesPerProject: e.target.value }))} style={{ ...inputStyle, maxWidth: 160 }} placeholder="Unlimited" />
          </Field>
        </div>
      </SectionCard>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}><SaveButton onClick={save} status={status} /></div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: FEATURE FLAGS (unchanged)
   ════════════════════════════════════════════════════════════════════════ */

const FLAG_META = [
  { key: 'autosave',             label: 'Autosave',              desc: 'Automatically save project changes as the user types.' },
  { key: 'contactForm',          label: 'Contact Form',          desc: 'Show the public contact form on the landing page.' },
  { key: 'projectDuplication',   label: 'Project Duplication',   desc: 'Allow users to clone existing projects.' },
  { key: 'advancedMetaAnalysis', label: 'Advanced Meta-Analysis',desc: "Enable trim-and-fill, Egger's test, and influence diagnostics." },
  { key: 'exportTools',          label: 'Export Tools',          desc: 'Allow project and data exports in various formats.' },
];

function FlagsSection() {
  const [flags,   setFlags]   = useState({});
  const [loading, setLoading] = useState(true);
  const [status,  setStatus]  = useState('idle');

  useEffect(() => { adminApi.featureFlags.get().then(d => setFlags(d)).catch(() => {}).finally(() => setLoading(false)); }, []);

  async function save() {
    setStatus('saving');
    try { await adminApi.featureFlags.save(flags); setStatus('saved'); setTimeout(() => setStatus('idle'), 3000); }
    catch { setStatus('error'); setTimeout(() => setStatus('idle'), 3000); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>Feature Flags</h2>
      <SectionCard>
        {FLAG_META.map((f, i) => (
          <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: i < FLAG_META.length - 1 ? `1px solid ${C.brd}` : 'none', gap: 20 }}>
            <div>
              <div style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>{f.label}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{f.desc}</div>
            </div>
            <Toggle checked={!!flags[f.key]} onChange={v => setFlags(fl => ({ ...fl, [f.key]: v }))} />
          </div>
        ))}
      </SectionCard>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}><SaveButton onClick={save} status={status} /></div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: SECURITY (unchanged)
   ════════════════════════════════════════════════════════════════════════ */

function SecuritySection() {
  const [tab,        setTab]        = useState('audit');
  const [auditRows,  setAuditRows]  = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage,  setAuditPage]  = useState(1);
  const [secRows,    setSecRows]    = useState([]);
  const [secTotal,   setSecTotal]   = useState(0);
  const [secPage,    setSecPage]    = useState(1);
  const [loading,    setLoading]    = useState(false);
  const PER_PAGE = 25;

  const loadAudit = useCallback(async p => {
    setLoading(true);
    try { const d = await adminApi.auditLog({ page: p, limit: PER_PAGE }); setAuditRows(d.logs || []); setAuditTotal(d.total || 0); }
    catch { setAuditRows([]); } finally { setLoading(false); }
  }, []);

  const loadSec = useCallback(async p => {
    setLoading(true);
    try { const d = await adminApi.securityEvents({ page: p, limit: PER_PAGE }); setSecRows(d.events || []); setSecTotal(d.total || 0); }
    catch { setSecRows([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { tab === 'audit' ? loadAudit(auditPage) : loadSec(secPage); }, [tab]);
  useEffect(() => { if (tab === 'audit') loadAudit(auditPage); }, [auditPage]);
  useEffect(() => { if (tab === 'security') loadSec(secPage); }, [secPage]);

  const typeColor = t => ({ FAILED_LOGIN: C.red, ADMIN_ACCESS_DENIED: C.ylw, RATE_LIMITED: C.acc }[t] || C.muted);

  const auditCols = [
    { key: 'createdAt', label: 'Time',    render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{fmtDateTime(v)}</span> },
    { key: 'admin',     label: 'Admin',   render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v?.email || v}</span> },
    { key: 'action',    label: 'Action',  render: v => <span style={{ color: C.txt, fontWeight: 600 }}>{v}</span> },
    { key: 'entityType',label: 'Entity',  render: v => v || '—' },
    { key: 'details',   label: 'Details', render: v => <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted, display: 'block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={typeof v === 'object' ? JSON.stringify(v) : v}>{typeof v === 'object' ? JSON.stringify(v) : (v || '—')}</span> },
  ];

  const secCols = [
    { key: 'createdAt', label: 'Time',    render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{fmtDateTime(v)}</span> },
    { key: 'type',      label: 'Type',    render: v => <Badge text={v} color={typeColor(v)} /> },
    { key: 'email',     label: 'Email',   render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v || '—'}</span> },
    { key: 'ip',        label: 'IP',      render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v || '—'}</span> },
    { key: 'details',   label: 'Details', render: v => <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted, display: 'block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{typeof v === 'object' ? JSON.stringify(v) : (v || '—')}</span> },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>Security</h2>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.brd}` }}>
        {[['audit', 'Audit Log'], ['security', 'Security Events']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: '8px 18px', background: 'transparent', border: 'none', borderBottom: tab === id ? `2px solid ${C.acc}` : '2px solid transparent', color: tab === id ? C.acc : C.txt2, fontSize: 13, fontWeight: tab === id ? 700 : 400, cursor: 'pointer', fontFamily: FONT, marginBottom: -1 }}>{label}</button>
        ))}
      </div>
      {tab === 'audit' ? (
        <SectionCard>
          <DataTable columns={auditCols} rows={auditRows} loading={loading} emptyMessage="No audit log entries." />
          <div style={{ padding: '0 14px' }}><Pagination page={auditPage} total={auditTotal} perPage={PER_PAGE} onPage={setAuditPage} /></div>
        </SectionCard>
      ) : (
        <SectionCard>
          <DataTable columns={secCols} rows={secRows} loading={loading} emptyMessage="No security events." />
          <div style={{ padding: '0 14px' }}><Pagination page={secPage} total={secTotal} perPage={PER_PAGE} onPage={setSecPage} /></div>
        </SectionCard>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: HEALTH (unchanged)
   ════════════════════════════════════════════════════════════════════════ */

function HealthSection() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const timer = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await adminApi.health()); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); timer.current = setInterval(load, 30_000); return () => clearInterval(timer.current); }, [load]);

  const statusBadge = ok => ok ? <Badge text="OK" color={C.grn} /> : <Badge text="ERROR" color={C.red} />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: 0 }}>System Health</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: C.muted }}>Auto-refreshes every 30s</span>
          <button onClick={load} style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>↻ Refresh</button>
        </div>
      </div>
      {error && <ErrorBox msg={error} />}
      {loading && !data ? <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div> : data ? (
        <SectionCard>
          {[
            { label: 'Backend',     value: statusBadge(data.status === 'ok') },
            { label: 'Database',    value: statusBadge(data.db === 'ok') },
            { label: 'Environment', value: <Badge text={data.env || 'unknown'} color={data.env === 'production' ? C.ylw : C.grn} /> },
            { label: 'Version',     value: <span style={{ fontFamily: MONO, fontSize: 12 }}>{data.version || '—'}</span> },
            { label: 'Uptime',      value: <span style={{ fontFamily: MONO, fontSize: 12 }}>{data.uptime != null ? `${Math.floor(data.uptime/3600)}h ${Math.floor((data.uptime%3600)/60)}m ${Math.floor(data.uptime%60)}s` : '—'}</span> },
            { label: 'Timestamp',   value: <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{fmtDateTime(data.timestamp)}</span> },
          ].map((row, i, arr) => (
            <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: i < arr.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
              <span style={{ fontSize: 13, color: C.txt2, fontWeight: 500 }}>{row.label}</span>
              {row.value}
            </div>
          ))}
        </SectionCard>
      ) : null}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   META·SIFT ADMIN SECTION
   ════════════════════════════════════════════════════════════════════════ */

const SIFT_DEFAULTS = {
  enabled: true,
  badgeText: 'BETA',
  allowNewProjects: true,
  allowImport: true,
  allowExport: true,
  allowPdfUpload: true,
  allowDuplicateDetection: true,
  allowConflictResolution: true,
  allowChat: true,
  allowSecondReview: true,
  requireTwoReviewers: true,
  minIncludeQuorum: 2,
  defaultBlindMode: false,
  maxPdfSizeMb: 25,
  maxRecordsPerProject: 10000,
  maintenanceMessage: 'META·SIFT Beta is currently undergoing maintenance. Please try again later.',
};

const SIFT_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'projects', label: 'Projects' },
  { id: 'members',  label: 'Members'  },
  { id: 'settings', label: 'Settings' },
  { id: 'handoff',  label: 'Handoff'  },
  { id: 'audit',    label: 'Audit'    },
];

const siftMiniBtn = (color) => ({
  padding: '3px 8px', background: `${color}18`, border: `1px solid ${color}40`,
  borderRadius: 5, color, fontSize: 10, fontFamily: MONO, cursor: 'pointer',
  letterSpacing: '0.05em', fontWeight: 600,
});

function siftHandoffColor(status) {
  return ({ sent: C.grn, failed: C.red, already_exists: C.teal, pending: C.ylw }[status] || C.muted);
}

/* ── (A) Overview panel ── */
function SiftOverview() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setMetrics(await adminApi.screening.getMetrics()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const m = metrics || {};
  const primary = [
    { label: 'Total Projects',  value: m.totalProjects,    color: C.acc },
    { label: 'Active',          value: m.activeProjects,   color: C.grn },
    { label: 'Archived',        value: m.archivedProjects, color: C.muted },
    { label: 'Disabled',        value: m.disabledProjects, color: C.red },
  ];
  const cards = [
    { label: 'In Progress',     value: m.inProgressProjects, color: C.teal },
    { label: 'Done',            value: m.doneProjects,       color: C.grn },
    { label: 'Records',         value: m.totalRecords,       color: C.txt2 },
    { label: 'Screened',        value: m.screened,           color: C.acc },
    { label: 'Included',        value: m.included,           color: C.grn },
    { label: 'Excluded',        value: m.excluded,           color: C.red },
    { label: 'Maybe',           value: m.maybe,              color: C.ylw },
    { label: 'Undecided',       value: m.undecided,          color: C.muted },
    { label: '2nd Review',      value: m.eligibleSecondReview, color: C.teal },
    { label: 'To Extraction',   value: m.sentToExtraction,   color: C.grn },
    { label: 'Handoffs Sent',   value: m.handoffSent,        color: C.grn },
    { label: 'Disputes',        value: m.totalDisputes,      color: '#dba96a' },
    { label: 'Resolved Conf.',  value: m.resolvedConflicts,  color: C.muted },
    { label: 'Dup Groups',      value: m.totalDuplicateGroups, color: C.muted },
    { label: 'Active Members',  value: m.activeMembers,      color: C.acc },
    { label: 'PDFs',            value: m.totalPdfs,          color: C.muted },
    { label: 'Chat Msgs',      value: m.totalChatMessages,  color: C.muted },
    { label: 'New This Week',   value: m.projectsThisWeek,   color: C.teal },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>Module Overview</span>
        <button onClick={load} style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>↻ Refresh</button>
      </div>
      {error && <ErrorBox msg={error} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        {primary.map(p => (
          <div key={p.label} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '18px 20px' }}>
            {loading ? <div style={{ height: 32, display: 'flex', alignItems: 'center' }}><Spinner /></div>
              : <div style={{ fontSize: 28, fontWeight: 800, fontFamily: MONO, color: p.color, letterSpacing: '-1px', lineHeight: 1 }}>{p.value ?? 0}</div>}
            <div style={{ fontSize: 10, color: C.muted, marginTop: 8, letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: MONO }}>{p.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
        {cards.map(c => (
          <div key={c.label} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '12px 14px' }}>
            {loading ? <Spinner size={12} /> : <div style={{ fontSize: 18, fontWeight: 700, fontFamily: MONO, color: c.color }}>{c.value ?? 0}</div>}
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: MONO }}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── (B) Projects panel ── */
function SiftProjects() {
  const [projects, setProjects] = useState([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const PER_PAGE = 25;

  const load = useCallback(async (p = 1) => {
    setLoading(true); setError('');
    try {
      const d = await adminApi.screening.listProjects({ page: p, limit: PER_PAGE });
      setProjects(d.projects || []); setTotal(d.total || 0); setPage(p);
    } catch (e) { setError(e.message); setProjects([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(1); }, [load]);

  async function act(id, flags) {
    try { await adminApi.screening.setFlags(id, flags); load(page); }
    catch (e) { setError('Failed to update: ' + e.message); }
  }

  const cols = [
    { key: 'title',  label: 'Title', width: '18%', render: v => <span style={{ color: C.txt, fontWeight: 600 }}>{v || '—'}</span> },
    { key: 'linkedMetaLabProjectTitle', label: 'Linked META·LAB', width: '15%',
      render: (v, row) => v
        ? <span style={{ fontSize: 11 }}>{v}</span>
        : <span style={{ fontSize: 11, color: C.muted }}>{row.linkedMetaLabProjectId ? '(linked, untitled)' : '— not linked'}</span> },
    { key: 'owner',  label: 'Owner', width: '13%', render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v?.email || '—'}</span> },
    { key: 'recordCount', label: 'Articles', width: '7%', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'memberCount', label: 'Members', width: '7%', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'secondReviewCount', label: '2nd Rev', width: '6%', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'handoffSentCount',  label: 'Handoff', width: '6%', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: '_status', label: 'Status', width: '11%', render: (_, row) => (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <Badge text={row.disabled ? 'disabled' : 'active'} color={row.disabled ? C.red : C.grn} />
        {row.archived && <Badge text="archived" color={C.muted} />}
        {row.progressStatus && row.progressStatus !== 'not_started' &&
          <Badge text={row.progressStatus.replace('_', ' ')} color={row.progressStatus === 'done' ? C.grn : C.teal} />}
      </div>
    )},
    { key: 'updatedAt', label: 'Updated', width: '8%', render: v => <span style={{ fontSize: 11 }}>{fmtAgo(v)}</span> },
    { key: '_actions', label: 'Actions', width: '15%', render: (_, row) => (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {row.disabled
          ? <button onClick={() => act(row.id, { disabled: false })} style={siftMiniBtn(C.grn)}>Enable</button>
          : <button onClick={() => act(row.id, { disabled: true })}  style={siftMiniBtn(C.red)}>Disable</button>}
        {row.archived
          ? <button onClick={() => act(row.id, { archived: false })} style={siftMiniBtn(C.grn)}>Unarchive</button>
          : <button onClick={() => act(row.id, { archived: true })}  style={siftMiniBtn(C.muted)}>Archive</button>}
      </div>
    )},
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>Screening Projects ({total})</span>
        <button onClick={() => load(page)} style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>↻ Refresh</button>
      </div>
      {error && <ErrorBox msg={error} />}
      <SectionCard>
        <DataTable columns={cols} rows={projects} loading={loading} emptyMessage="No screening projects yet." />
        <div style={{ padding: '0 14px' }}>
          <Pagination page={page} total={total} perPage={PER_PAGE} onPage={load} />
        </div>
      </SectionCard>
    </div>
  );
}

/* ── (C) Members panel ── */
function SiftMembers() {
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState('');
  const [members,  setMembers]  = useState([]);
  const [loadingP, setLoadingP] = useState(true);
  const [loadingM, setLoadingM] = useState(false);
  const [error,    setError]    = useState('');

  useEffect(() => {
    setLoadingP(true);
    adminApi.screening.listProjects({ page: 1, limit: 100 })
      .then(d => setProjects(d.projects || []))
      .catch(e => setError(e.message))
      .finally(() => setLoadingP(false));
  }, []);

  function pick(id) {
    setSelected(id);
    if (!id) { setMembers([]); return; }
    setLoadingM(true); setError('');
    adminApi.screening.getMembers(id)
      .then(d => setMembers(d.members || []))
      .catch(e => { setError(e.message); setMembers([]); })
      .finally(() => setLoadingM(false));
  }

  const cols = [
    { key: 'name',  label: 'Name',  render: v => <span style={{ color: C.txt, fontWeight: 600 }}>{v || '—'}</span> },
    { key: 'email', label: 'Email', render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v || '—'}</span> },
    { key: 'role',  label: 'Role',  render: v => <Badge text={v || 'reviewer'} color={v === 'leader' ? C.acc : v === 'viewer' ? C.muted : C.teal} /> },
    { key: 'status', label: 'Status', render: v => <Badge text={v || 'active'} color={v === 'active' ? C.grn : v === 'pending' ? C.ylw : C.muted} /> },
    { key: 'canScreen', label: 'Screen', render: v => v ? <span style={{ color: C.grn }}>✓</span> : <span style={{ color: C.muted }}>—</span> },
    { key: 'canChat', label: 'Chat', render: v => v ? <span style={{ color: C.grn }}>✓</span> : <span style={{ color: C.muted }}>—</span> },
    { key: 'canResolveConflicts', label: 'Resolve', render: v => v ? <span style={{ color: C.grn }}>✓</span> : <span style={{ color: C.muted }}>—</span> },
    { key: 'screenedCount', label: 'Screened', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>Project Members</span>
        <select value={selected} onChange={e => pick(e.target.value)} disabled={loadingP}
          style={{ ...inputStyle, width: 'auto', minWidth: 280, padding: '7px 10px', fontSize: 12 }}>
          <option value="">{loadingP ? 'Loading projects…' : '— Select a project —'}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.title} ({p.memberCount ?? 0} members)</option>)}
        </select>
      </div>
      {error && <ErrorBox msg={error} />}
      {!selected ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>
          Select a project to view its members.
        </div>
      ) : (
        <SectionCard>
          <DataTable columns={cols} rows={members} loading={loadingM} emptyMessage="No members in this project." />
        </SectionCard>
      )}
    </div>
  );
}

/* ── (D) Settings panel ── */
function SiftSettings() {
  const [settings, setSettings] = useState(SIFT_DEFAULTS);
  const [loading,  setLoading]  = useState(true);
  const [status,   setStatus]   = useState('idle');
  const [error,    setError]    = useState('');

  useEffect(() => {
    adminApi.screening.getSettings()
      .then(s => setSettings({ ...SIFT_DEFAULTS, ...s }))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setStatus('saving'); setError('');
    try { const s = await adminApi.screening.saveSettings(settings); setSettings({ ...SIFT_DEFAULTS, ...s }); setStatus('saved'); }
    catch (e) { setStatus('error'); setError(e.message); }
    finally { setTimeout(() => setStatus('idle'), 2500); }
  }

  const upd = (k, v) => setSettings(s => ({ ...s, [k]: v }));

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  const toggles = [
    { key: 'enabled',                 label: 'META·SIFT Enabled',        note: 'Disabling shows maintenance page and blocks /sift-beta' },
    { key: 'allowNewProjects',        label: 'New Project Creation',     note: 'Allow users to create new screening projects' },
    { key: 'allowImport',             label: 'Import (RIS/BibTeX/NBIB)', note: 'Allow reference imports' },
    { key: 'allowExport',             label: 'Export (CSV/JSON)',        note: 'Allow record exports' },
    { key: 'allowPdfUpload',          label: 'PDF Upload',               note: 'Allow full-text PDF attachments' },
    { key: 'allowChat',               label: 'Team Chat',                note: 'Allow in-project chat between members' },
    { key: 'allowDuplicateDetection', label: 'Duplicate Detection',      note: 'Run dedup algorithms' },
    { key: 'allowConflictResolution', label: 'Conflict Resolution',      note: 'Show and resolve reviewer conflicts' },
    { key: 'allowSecondReview',       label: 'Second (Full-Text) Review',note: 'Enable the two-stage full-text review' },
    { key: 'requireTwoReviewers',     label: 'Require Two Reviewers',    note: 'A single include never promotes on its own' },
    { key: 'defaultBlindMode',        label: 'Default Blind Mode',       note: 'Applied to newly created projects' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>Module Settings</span>
        <SaveButton onClick={save} status={status} />
      </div>
      {error && status === 'error' && <ErrorBox msg={error} />}

      <SectionCard title="Feature Toggles">
        <div style={{ padding: '8px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
          {toggles.map(({ key, label, note }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderBottom: `1px solid ${C.brd}` }}>
              <div>
                <div style={{ fontSize: 12, color: C.txt, fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{note}</div>
              </div>
              <Toggle checked={!!settings[key]} onChange={v => upd(key, v)} />
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Policy & Limits">
        <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 24px' }}>
          <Field label="Min Include Quorum" note="Distinct includes required to reach 2nd review">
            <input type="number" min="1" value={settings.minIncludeQuorum ?? 2}
              onChange={e => upd('minIncludeQuorum', Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 140 }} />
          </Field>
          <Field label="Max PDF Size (MB)" note="1–200 MB per attachment">
            <input type="number" min="1" max="200" value={settings.maxPdfSizeMb ?? 25}
              onChange={e => upd('maxPdfSizeMb', Math.min(200, Math.max(1, parseInt(e.target.value) || 1)))}
              style={{ ...inputStyle, width: 140 }} />
          </Field>
          <Field label="Max Records / Project">
            <input type="number" min="1" value={settings.maxRecordsPerProject ?? 10000}
              onChange={e => upd('maxRecordsPerProject', Math.max(1, parseInt(e.target.value) || 1))}
              style={{ ...inputStyle, width: 140 }} />
          </Field>
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Badge Text" note="Shown next to META·SIFT in the nav (e.g. BETA, PREVIEW, GA)">
              <input value={settings.badgeText || ''} onChange={e => upd('badgeText', e.target.value)}
                style={{ ...inputStyle, width: 200 }} />
            </Field>
            <Field label="Maintenance Message" note="Shown to users when META·SIFT is disabled">
              <textarea value={settings.maintenanceMessage || ''} onChange={e => upd('maintenanceMessage', e.target.value)}
                rows={2} style={{ ...inputStyle, resize: 'vertical', width: '100%' }} />
            </Field>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

/* ── (E) Handoff panel ── */
function SiftHandoff() {
  const [data,    setData]    = useState({ handoffs: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await adminApi.screening.getHandoffs()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = data.counts || {};
  const summary = [
    { label: 'Sent',           value: counts.sent,           color: C.grn },
    { label: 'Failed',         value: counts.failed,         color: C.red },
    { label: 'Already Exists', value: counts.already_exists, color: C.teal },
    { label: 'Pending',        value: counts.pending,        color: C.ylw },
  ];

  const cols = [
    { key: 'recordTitle',  label: 'Record', width: '28%', render: v => <span style={{ color: C.txt }}>{v || '(untitled)'}</span> },
    { key: 'projectTitle', label: 'Project', width: '18%', render: v => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
    { key: 'handoffStatus', label: 'Status', width: '12%', render: v => <Badge text={v || '—'} color={siftHandoffColor(v)} /> },
    { key: 'handoffAt',    label: 'Handoff At', width: '14%', render: (v, row) => <span style={{ fontSize: 11 }}>{fmtAgo(v || row.acceptedAt)}</span> },
    { key: 'handoffError', label: 'Error', width: '18%', render: v => v ? <span style={{ fontSize: 11, color: C.red }} title={v}>{v.slice(0, 40)}</span> : <span style={{ color: C.muted }}>—</span> },
    { key: 'finalStatus',  label: 'Final', width: '10%', render: v => v ? <Badge text={v} color={v === 'accepted' ? C.grn : C.red} /> : <span style={{ color: C.muted }}>—</span> },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>Extraction Handoff Log</span>
        <button onClick={load} style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>↻ Refresh</button>
      </div>
      {error && <ErrorBox msg={error} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {summary.map(s => (
          <div key={s.label} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '12px 14px' }}>
            {loading ? <Spinner size={12} /> : <div style={{ fontSize: 20, fontWeight: 700, fontFamily: MONO, color: s.color }}>{s.value ?? 0}</div>}
            <div style={{ fontSize: 10, color: C.muted, marginTop: 4, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: MONO }}>{s.label}</div>
          </div>
        ))}
      </div>
      <SectionCard>
        <DataTable columns={cols} rows={data.handoffs || []} loading={loading} emptyMessage="No handoff events yet." />
      </SectionCard>
    </div>
  );
}

/* ── (F) Audit panel ── */
function SiftAudit() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const d = await adminApi.screening.getAudit(); setEntries(d.entries || []); }
    catch (e) { setError(e.message); setEntries([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const actionColor = a => {
    if (/ACCEPTED|ADDED|ON|RESOLVED|UPLOADED/.test(a || '')) return C.grn;
    if (/REJECTED|REMOVED|OFF/.test(a || '')) return C.red;
    return C.acc;
  };

  const cols = [
    { key: 'createdAt',    label: 'Time',    width: '15%', render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{fmtDateTime(v)}</span> },
    { key: 'projectTitle', label: 'Project', width: '15%', render: v => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
    { key: 'actorName',    label: 'Actor',   width: '15%', render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v || '—'}</span> },
    { key: 'action',       label: 'Action',  width: '15%', render: v => <Badge text={v} color={actionColor(v)} /> },
    { key: 'entityType',   label: 'Entity',  width: '10%', render: v => v || '—' },
    { key: 'details',      label: 'Details', width: '30%', render: v => <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted, display: 'block', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={typeof v === 'string' ? v : JSON.stringify(v)}>{typeof v === 'string' ? v : JSON.stringify(v || {})}</span> },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>Audit Log ({entries.length})</span>
        <button onClick={load} style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}>↻ Refresh</button>
      </div>
      {error && <ErrorBox msg={error} />}
      <SectionCard>
        <DataTable columns={cols} rows={entries} loading={loading} emptyMessage="No audit entries yet." />
      </SectionCard>
    </div>
  );
}

function SiftAdminSection() {
  const [tab, setTab] = useState('overview');

  const panels = {
    overview: <SiftOverview />,
    projects: <SiftProjects />,
    members:  <SiftMembers />,
    settings: <SiftSettings />,
    handoff:  <SiftHandoff />,
    audit:    <SiftAudit />,
  };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: C.txt, margin: 0, letterSpacing: '-0.02em' }}>
          META·SIFT Beta
          <span style={{ fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', background: '#2dd4bf18', border: '1px solid #2dd4bf50', color: '#2dd4bf', borderRadius: 4, padding: '2px 7px', marginLeft: 10 }}>BETA</span>
        </h2>
        <p style={{ fontSize: 13, color: C.txt2, marginTop: 6, marginBottom: 0 }}>
          Manage the screening module, control feature access, and monitor usage.
        </p>
      </div>

      {/* Sub-navigation */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: `1px solid ${C.brd}` }}>
        {SIFT_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 16px', background: 'transparent', border: 'none',
            borderBottom: tab === t.id ? `2px solid ${C.acc}` : '2px solid transparent',
            color: tab === t.id ? C.acc : C.txt2, fontSize: 12,
            fontWeight: tab === t.id ? 700 : 400, cursor: 'pointer',
            fontFamily: FONT, marginBottom: -1,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {panels[tab]}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   ROOT COMPONENT
   ════════════════════════════════════════════════════════════════════════ */

const NAV_SECTIONS = [
  { id: 'overview', icon: '⊞', label: 'Overview'  },
  { id: 'users',    icon: '◈', label: 'Users'     },
  { id: 'projects', icon: '⬡', label: 'Projects'  },
  { id: 'sift',     icon: '◧', label: 'META·SIFT' },
  { id: 'content',  icon: '✦', label: 'Content'   },
  { id: 'settings', icon: '⚙', label: 'Settings'  },
  { id: 'flags',    icon: '◉', label: 'Flags'     },
  { id: 'messages', icon: '✉', label: 'Messages'  },
  { id: 'security', icon: '◬', label: 'Security'  },
  { id: 'health',   icon: '▣', label: 'Health'    },
];

export default function AdminConsole() {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  const [active,   setActive]      = useState('overview');
  const [unread,   setUnread]      = useState(0);

  useEffect(() => {
    adminApi.metrics().then(m => setUnread(m?.contactMessages?.unread || 0)).catch(() => {});
  }, []);

  const sections = {
    overview: <OverviewSection onNavigate={setActive} />,
    users:    <UsersSection />,
    projects: <ProjectsSection />,
    sift:     <SiftAdminSection />,
    content:  <ContentSection />,
    settings: <SettingsSection />,
    flags:    <FlagsSection />,
    messages: <MessagesSection onUnreadChange={setUnread} />,
    security: <SecuritySection />,
    health:   <HealthSection />,
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.brd2}; border-radius: 3px; }
        select { appearance: none; }
      `}</style>

      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: TOPBAR_H, background: C.surf, borderBottom: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px 0 16px', zIndex: 300 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, color: C.acc }}>⬡</span>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: C.txt }}>META·LAB</span>
          <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, background: `${C.acc}14`, border: `1px solid ${C.acc}28`, borderRadius: 4, padding: '2px 7px', letterSpacing: '0.08em', textTransform: 'uppercase', marginLeft: 2 }}>OPS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Return to app button */}
          <button
            onClick={() => navigate('/app')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: `${C.acc}14`, border: `1px solid ${C.acc}28`, borderRadius: 7, color: C.acc, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = `${C.acc}22`}
            onMouseLeave={e => e.currentTarget.style.background = `${C.acc}14`}
          >
            <span>⬡</span>
            <span>Open App</span>
          </button>
          <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{user?.email}</span>
          <Badge text="admin" color={C.acc} />
        </div>
      </div>

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <div style={{ position: 'fixed', top: TOPBAR_H, left: 0, width: SIDEBAR_W, bottom: 0, background: C.surf, borderRight: `1px solid ${C.brd}`, overflowY: 'auto', zIndex: 200, paddingTop: 12 }}>
        {NAV_SECTIONS.map(sec => {
          const isActive = active === sec.id;
          const badge = sec.id === 'messages' && unread > 0 ? unread : null;
          return (
            <button key={sec.id} onClick={() => setActive(sec.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 16px', background: isActive ? `${C.acc}14` : 'transparent', border: 'none', borderLeft: `3px solid ${isActive ? C.acc : 'transparent'}`, cursor: 'pointer', fontFamily: FONT, fontSize: 13, color: isActive ? C.acc : C.txt2, fontWeight: isActive ? 600 : 400, textAlign: 'left', transition: 'all 0.15s' }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = `${C.acc}08`; e.currentTarget.style.color = C.txt; } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.txt2; } }}
            >
              <span style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0 }}>{sec.icon}</span>
              <span style={{ flex: 1 }}>{sec.label}</span>
              {badge && (
                <span style={{ background: C.ylw, color: C.bg, borderRadius: 8, padding: '1px 6px', fontSize: 10, fontFamily: MONO, fontWeight: 700 }}>{badge}</span>
              )}
            </button>
          );
        })}

        {/* Sidebar footer — back to dashboard link */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 16px', borderTop: `1px solid ${C.brd}`, background: C.surf }}>
          <button onClick={() => navigate('/app')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT, transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.acc; e.currentTarget.style.color = C.acc; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.brd2; e.currentTarget.style.color = C.txt2; }}
          >
            <span style={{ fontSize: 12 }}>←</span>
            <span>Back to Dashboard</span>
          </button>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div style={{ marginLeft: SIDEBAR_W, paddingTop: TOPBAR_H, minHeight: '100vh' }}>
        <div style={{ padding: '28px 32px', maxWidth: 1200 }}>
          {sections[active]}
        </div>
      </div>
    </div>
  );
}
