/**
 * AdminConsole.jsx — META·LAB Ops internal control panel.
 *
 * Accessible only via /ops route, guarded by AdminRoute.
 * No link to this page exists anywhere in the public/user UI.
 *
 * Layout:
 *   Fixed top bar (52px)  +  Fixed left sidebar (220px)  +  Scrollable main area
 */

import { useState, useEffect, useCallback, useRef } from 'react';
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
};
const FONT = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', monospace";

const SIDEBAR_W = 220;
const TOPBAR_H  = 52;

/* ─── Navigation sections ────────────────────────────────────────────── */
const SECTIONS = [
  { id: 'overview',  icon: '⊞', label: 'Overview'  },
  { id: 'users',     icon: '◈', label: 'Users'     },
  { id: 'projects',  icon: '⬡', label: 'Projects'  },
  { id: 'content',   icon: '✦', label: 'Content'   },
  { id: 'settings',  icon: '⚙', label: 'Settings'  },
  { id: 'flags',     icon: '◉', label: 'Flags'     },
  { id: 'messages',  icon: '✉', label: 'Messages'  },
  { id: 'security',  icon: '◬', label: 'Security'  },
  { id: 'health',    icon: '▣', label: 'Health'    },
];

/* ════════════════════════════════════════════════════════════════════════
   SHARED UI PRIMITIVES
   ════════════════════════════════════════════════════════════════════════ */

/** Spinning loader */
function Spinner({ size = 14, color = C.acc }) {
  return (
    <span style={{
      display:      'inline-block',
      width:        size,
      height:       size,
      border:       `2px solid ${color}30`,
      borderTop:    `2px solid ${color}`,
      borderRadius: '50%',
      animation:    'spin 0.7s linear infinite',
    }} />
  );
}

/** Save button with status feedback */
function SaveButton({ onClick, status, label = 'Save Changes', disabled = false }) {
  // status: 'idle' | 'saving' | 'saved' | 'error'
  const map = {
    idle:   { bg: C.acc2,      text: label,         icon: null },
    saving: { bg: C.muted,     text: 'Saving…',     icon: <Spinner size={12} color="#fff" /> },
    saved:  { bg: '#166534',   text: 'Saved',        icon: '✓' },
    error:  { bg: '#7f1d1d',   text: 'Error',        icon: '✕' },
  };
  const s = map[status] || map.idle;
  return (
    <button
      onClick={onClick}
      disabled={disabled || status === 'saving'}
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          6,
        padding:      '8px 18px',
        background:   s.bg,
        border:       'none',
        borderRadius: 7,
        color:        '#fff',
        fontSize:     13,
        fontWeight:   600,
        cursor:       disabled || status === 'saving' ? 'not-allowed' : 'pointer',
        fontFamily:   FONT,
        opacity:      disabled ? 0.6 : 1,
        transition:   'background 0.2s',
      }}
    >
      {s.icon && <span>{s.icon}</span>}
      {s.text}
    </button>
  );
}

/** Confirmation modal */
function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div style={{
      position:       'fixed',
      inset:          0,
      background:     'rgba(0,0,0,0.65)',
      zIndex:         9999,
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background:   C.card,
        border:       `1px solid ${C.brd2}`,
        borderRadius: 12,
        padding:      '28px 32px',
        maxWidth:     420,
        width:        '90%',
        boxShadow:    '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 12 }}>{title}</div>
        <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.65, marginBottom: 24 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 13, cursor: 'pointer', fontFamily: FONT }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{ padding: '8px 16px', background: danger ? C.red : C.acc2, border: 'none', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Generic data table */
function DataTable({ columns, rows, loading, emptyMessage = 'No data.' }) {
  const thStyle = {
    padding:       '9px 14px',
    textAlign:     'left',
    fontSize:      10,
    fontFamily:    MONO,
    color:         C.muted,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    borderBottom:  `1px solid ${C.brd}`,
    fontWeight:    600,
    whiteSpace:    'nowrap',
  };
  const tdStyle = {
    padding:      '10px 14px',
    fontSize:     12,
    color:        C.txt2,
    borderBottom: `1px solid ${C.brd}`,
    verticalAlign: 'middle',
  };

  if (loading) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center' }}>
        <Spinner size={20} />
        <div style={{ fontSize: 12, color: C.muted, marginTop: 12 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{ ...thStyle, width: c.width || 'auto' }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ ...tdStyle, textAlign: 'center', color: C.muted, padding: '32px 14px' }}>
                {emptyMessage}
              </td>
            </tr>
          ) : rows.map((row, i) => (
            <tr
              key={i}
              style={{ transition: 'background 0.1s' }}
              onMouseEnter={e => e.currentTarget.style.background = C.surf}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {columns.map(c => (
                <td key={c.key} style={tdStyle}>
                  {c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Toggle switch */
function Toggle({ checked, onChange, disabled = false }) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width:        40,
        height:       22,
        borderRadius: 11,
        background:   checked ? C.acc2 : C.brd2,
        position:     'relative',
        cursor:       disabled ? 'not-allowed' : 'pointer',
        transition:   'background 0.2s',
        flexShrink:   0,
        opacity:      disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        position:     'absolute',
        top:          3,
        left:         checked ? 21 : 3,
        width:        16,
        height:       16,
        borderRadius: '50%',
        background:   '#fff',
        transition:   'left 0.2s',
        boxShadow:    '0 1px 4px rgba(0,0,0,0.3)',
      }} />
    </div>
  );
}

/** Pill/badge */
function Badge({ text, color = C.acc, bg }) {
  return (
    <span style={{
      display:      'inline-block',
      padding:      '2px 9px',
      borderRadius: 12,
      fontSize:     10,
      fontWeight:   700,
      fontFamily:   MONO,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color,
      background:   bg || `${color}20`,
      border:       `1px solid ${color}40`,
    }}>
      {text}
    </span>
  );
}

/** Pagination controls */
function Pagination({ page, total, perPage, onPage }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', justifyContent: 'flex-end' }}>
      <span style={{ fontSize: 11, color: C.muted }}>
        Page {page} of {totalPages} ({total} total)
      </span>
      <button
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        style={{ padding: '4px 10px', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 5, color: C.txt2, fontSize: 12, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1, fontFamily: FONT }}
      >
        ‹
      </button>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        style={{ padding: '4px 10px', background: C.card, border: `1px solid ${C.brd2}`, borderRadius: 5, color: C.txt2, fontSize: 12, cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.4 : 1, fontFamily: FONT }}
      >
        ›
      </button>
    </div>
  );
}

/** Section card wrapper */
function SectionCard({ title, children, action }) {
  return (
    <div style={{
      background:   C.card,
      border:       `1px solid ${C.brd}`,
      borderRadius: 10,
      overflow:     'hidden',
      marginBottom: 20,
    }}>
      {title && (
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '14px 18px',
          borderBottom:   `1px solid ${C.brd}`,
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.txt, letterSpacing: '0.01em' }}>{title}</span>
          {action}
        </div>
      )}
      <div style={{ padding: title ? 0 : 0 }}>
        {children}
      </div>
    </div>
  );
}

/** Form field wrapper */
function Field({ label, children, note }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{
        display:       'block',
        fontSize:      11,
        fontFamily:    MONO,
        color:         C.muted,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        marginBottom:  7,
      }}>{label}</label>
      {children}
      {note && <div style={{ fontSize: 11, color: C.muted, marginTop: 5 }}>{note}</div>}
    </div>
  );
}

const inputStyle = {
  width:        '100%',
  background:   C.surf,
  border:       `1px solid ${C.brd2}`,
  borderRadius: 7,
  padding:      '9px 12px',
  color:        C.txt,
  fontFamily:   FONT,
  fontSize:     13,
  outline:      'none',
  boxSizing:    'border-box',
};

/* ════════════════════════════════════════════════════════════════════════
   SECTION: OVERVIEW
   ════════════════════════════════════════════════════════════════════════ */

function MetricCard({ label, value, sub, loading }) {
  return (
    <div style={{
      background:   C.card,
      border:       `1px solid ${C.brd}`,
      borderRadius: 9,
      padding:      '18px 20px',
    }}>
      {loading ? (
        <div style={{ height: 40, display: 'flex', alignItems: 'center' }}><Spinner /></div>
      ) : (
        <div style={{ fontSize: 28, fontWeight: 800, color: C.txt, fontFamily: MONO, letterSpacing: '-1px', lineHeight: 1 }}>
          {value ?? '—'}
        </div>
      )}
      <div style={{ fontSize: 11, color: C.muted, marginTop: 8, fontFamily: MONO, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{sub}</div>
      )}
    </div>
  );
}

function OverviewSection() {
  const [metrics, setMetrics]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await adminApi.metrics();
      setMetrics(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const m = metrics || {};

  const cards = [
    { label: 'Total Users',         value: m.totalUsers },
    { label: 'New Today',           value: m.newUsersToday },
    { label: 'New This Week',       value: m.newUsersWeek },
    { label: 'Total Projects',      value: m.totalProjects },
    { label: 'Created Today',       value: m.projectsToday },
    { label: 'Created This Week',   value: m.projectsWeek },
    { label: 'Total Studies',       value: m.totalStudies },
    { label: 'Total Records',       value: m.totalRecords },
    { label: 'Unread Messages',     value: m.unreadMessages },
    { label: 'Total Messages',      value: m.totalMessages },
    { label: 'Failed Logins (7d)',  value: m.failedLogins7d },
    { label: 'Suspended Users',     value: m.suspendedUsers },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: 0 }}>Platform Overview</h2>
        <button
          onClick={load}
          style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}
        >
          ↻ Refresh
        </button>
      </div>
      {error && (
        <div style={{ padding: '10px 14px', background: `${C.red}12`, border: `1px solid ${C.red}30`, borderRadius: 7, color: C.red, fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap:                 12,
      }}>
        {cards.map(c => (
          <MetricCard key={c.label} label={c.label} value={c.value} loading={loading} />
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: USERS
   ════════════════════════════════════════════════════════════════════════ */

function UsersSection() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('all');
  const [page,    setPage]    = useState(1);
  const [confirm, setConfirm] = useState(null); // { user, action: 'suspend'|'reactivate' }
  const searchTimer = useRef(null);
  const PER_PAGE = 25;

  const load = useCallback(async (s, f, p) => {
    setLoading(true);
    try {
      const params = { page: p, limit: PER_PAGE };
      if (s) params.search = s;
      if (f !== 'all') params.filter = f;
      const data = await adminApi.users.list(params);
      setRows(data.users || data || []);
      setTotal(data.total || (data.users || data || []).length);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(search, filter, page); }, [page, filter]);

  function handleSearch(val) {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); load(val, filter, 1); }, 300);
  }

  async function doStatusUpdate() {
    if (!confirm) return;
    const newStatus = confirm.action === 'suspend' ? 'suspended' : 'active';
    try {
      await adminApi.users.updateStatus(confirm.user.id, { status: newStatus });
      load(search, filter, page);
    } catch { /* silent */ }
    setConfirm(null);
  }

  const columns = [
    { key: 'name',       label: 'Name',        render: v => <span style={{ color: C.txt, fontWeight: 600 }}>{v || '—'}</span> },
    { key: 'email',      label: 'Email',       render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v}</span> },
    { key: 'role',       label: 'Role',        render: v => v === 'admin'
      ? <Badge text="admin" color={C.acc} />
      : <Badge text="user"  color={C.muted} /> },
    { key: 'status',     label: 'Status',      render: v => v === 'active'
      ? <Badge text="active"    color={C.grn} />
      : <Badge text="suspended" color={C.red} /> },
    { key: 'projectCount', label: 'Projects',  render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'createdAt',  label: 'Joined',      render: v => v ? new Date(v).toLocaleDateString() : '—' },
    { key: 'lastLogin',  label: 'Last Active', render: v => v ? new Date(v).toLocaleDateString() : '—' },
    {
      key: '_actions', label: 'Actions',
      render: (_, row) => row.role === 'admin' ? (
        <span style={{ fontSize: 11, color: C.muted }}>admin</span>
      ) : row.status === 'active' ? (
        <button
          onClick={() => setConfirm({ user: row, action: 'suspend' })}
          style={{ padding: '4px 10px', background: `${C.red}15`, border: `1px solid ${C.red}30`, borderRadius: 5, color: C.red, fontSize: 11, cursor: 'pointer', fontFamily: FONT }}
        >
          Suspend
        </button>
      ) : (
        <button
          onClick={() => setConfirm({ user: row, action: 'reactivate' })}
          style={{ padding: '4px 10px', background: `${C.grn}15`, border: `1px solid ${C.grn}30`, borderRadius: 5, color: C.grn, fontSize: 11, cursor: 'pointer', fontFamily: FONT }}
        >
          Reactivate
        </button>
      ),
    },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>User Management</h2>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search name or email…"
          value={search}
          onChange={e => handleSearch(e.target.value)}
          style={{ ...inputStyle, width: 260, flex: 'none' }}
        />
        {['all', 'active', 'suspended', 'admins'].map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f); setPage(1); load(search, f, 1); }}
            style={{
              padding:    '7px 14px',
              background: filter === f ? C.acc2 : 'transparent',
              border:     `1px solid ${filter === f ? C.acc2 : C.brd2}`,
              borderRadius: 7,
              color:      filter === f ? '#fff' : C.txt2,
              fontSize:   12,
              cursor:     'pointer',
              fontFamily: FONT,
              textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      <SectionCard>
        <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No users found." />
        <div style={{ padding: '0 14px' }}>
          <Pagination page={page} total={total} perPage={PER_PAGE} onPage={setPage} />
        </div>
      </SectionCard>

      <ConfirmModal
        open={!!confirm}
        title={confirm?.action === 'suspend' ? 'Suspend User' : 'Reactivate User'}
        message={confirm?.action === 'suspend'
          ? `Suspend ${confirm?.user?.email}? They will not be able to log in.`
          : `Reactivate ${confirm?.user?.email}? They will regain full access.`}
        confirmLabel={confirm?.action === 'suspend' ? 'Suspend' : 'Reactivate'}
        danger={confirm?.action === 'suspend'}
        onConfirm={doStatusUpdate}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: PROJECTS
   ════════════════════════════════════════════════════════════════════════ */

function ProjectsSection() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all');
  const [page,    setPage]    = useState(1);
  const [confirm, setConfirm] = useState(null);
  const PER_PAGE = 25;

  const load = useCallback(async (f, p) => {
    setLoading(true);
    try {
      const params = { page: p, limit: PER_PAGE };
      if (f !== 'all') params.status = f;
      const data = await adminApi.projects.list(params);
      setRows(data.projects || data || []);
      setTotal(data.total || (data.projects || data || []).length);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(filter, page); }, [page]);

  async function doAction() {
    if (!confirm) return;
    try {
      if (confirm.action === 'archive') await adminApi.projects.archive(confirm.project.id);
      else await adminApi.projects.restore(confirm.project.id);
      load(filter, page);
    } catch { /* silent */ }
    setConfirm(null);
  }

  const columns = [
    { key: 'name',      label: 'Name',    render: v => <span style={{ color: C.txt, fontWeight: 600 }}>{v}</span> },
    { key: 'ownerEmail',label: 'Owner',   render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v}</span> },
    { key: 'createdAt', label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : '—' },
    { key: 'updatedAt', label: 'Updated', render: v => v ? new Date(v).toLocaleDateString() : '—' },
    { key: 'studyCount',   label: 'Studies', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'recordCount',  label: 'Records', render: v => <span style={{ fontFamily: MONO }}>{v ?? 0}</span> },
    { key: 'status',    label: 'Status',  render: v => v === 'archived'
      ? <Badge text="archived" color={C.ylw} />
      : <Badge text="active"   color={C.grn} /> },
    {
      key: '_actions', label: 'Actions',
      render: (_, row) => row.status === 'archived' ? (
        <button
          onClick={() => setConfirm({ project: row, action: 'restore' })}
          style={{ padding: '4px 10px', background: `${C.grn}15`, border: `1px solid ${C.grn}30`, borderRadius: 5, color: C.grn, fontSize: 11, cursor: 'pointer', fontFamily: FONT }}
        >
          Restore
        </button>
      ) : (
        <button
          onClick={() => setConfirm({ project: row, action: 'archive' })}
          style={{ padding: '4px 10px', background: `${C.ylw}15`, border: `1px solid ${C.ylw}30`, borderRadius: 5, color: C.ylw, fontSize: 11, cursor: 'pointer', fontFamily: FONT }}
        >
          Archive
        </button>
      ),
    },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>Projects</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['all', 'active', 'archived'].map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f); setPage(1); load(f, 1); }}
            style={{
              padding:    '7px 14px',
              background: filter === f ? C.acc2 : 'transparent',
              border:     `1px solid ${filter === f ? C.acc2 : C.brd2}`,
              borderRadius: 7,
              color:      filter === f ? '#fff' : C.txt2,
              fontSize:   12,
              cursor:     'pointer',
              fontFamily: FONT,
              textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
      </div>
      <SectionCard>
        <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No projects found." />
        <div style={{ padding: '0 14px' }}>
          <Pagination page={page} total={total} perPage={PER_PAGE} onPage={setPage} />
        </div>
      </SectionCard>
      <ConfirmModal
        open={!!confirm}
        title={confirm?.action === 'archive' ? 'Archive Project' : 'Restore Project'}
        message={confirm?.action === 'archive'
          ? `Archive "${confirm?.project?.name}"? It will be hidden from the owner.`
          : `Restore "${confirm?.project?.name}"? It will be visible to the owner again.`}
        confirmLabel={confirm?.action === 'archive' ? 'Archive' : 'Restore'}
        danger={confirm?.action === 'archive'}
        onConfirm={doAction}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: CONTENT (Landing Page Content Editor)
   ════════════════════════════════════════════════════════════════════════ */

function ContentSection() {
  const [form,   setForm]   = useState({
    heroHeadline:        '',
    heroSubtitle:        '',
    ctaText:             '',
    aboutText:           '',
    footerText:          '',
    announcementBanner:  '',
    maintenanceBanner:   '',
  });
  const [loading, setLoading] = useState(true);
  const [status,  setStatus]  = useState('idle');

  useEffect(() => {
    adminApi.landingContent.get()
      .then(d => { setForm(f => ({ ...f, ...d })); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setStatus('saving');
    try {
      await adminApi.landingContent.save(form);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 3000);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  const ta = { ...inputStyle, resize: 'vertical', minHeight: 90, lineHeight: 1.6 };

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>Landing Page Content</h2>
      <SectionCard title="Hero">
        <div style={{ padding: '20px 20px 4px' }}>
          <Field label="Hero Headline">
            <input type="text" value={form.heroHeadline} onChange={e => setForm(f => ({ ...f, heroHeadline: e.target.value }))} style={inputStyle} placeholder="e.g. Evidence synthesis, end to end." />
          </Field>
          <Field label="Hero Subtitle">
            <textarea value={form.heroSubtitle} onChange={e => setForm(f => ({ ...f, heroSubtitle: e.target.value }))} style={ta} placeholder="Short description shown below headline." />
          </Field>
          <Field label="CTA Button Text">
            <input type="text" value={form.ctaText} onChange={e => setForm(f => ({ ...f, ctaText: e.target.value }))} style={inputStyle} placeholder="e.g. Start Your Review →" />
          </Field>
        </div>
      </SectionCard>
      <SectionCard title="About &amp; Footer">
        <div style={{ padding: '20px 20px 4px' }}>
          <Field label="About Text">
            <textarea value={form.aboutText} onChange={e => setForm(f => ({ ...f, aboutText: e.target.value }))} style={{ ...ta, minHeight: 120 }} placeholder="Platform description paragraph." />
          </Field>
          <Field label="Footer Text">
            <input type="text" value={form.footerText} onChange={e => setForm(f => ({ ...f, footerText: e.target.value }))} style={inputStyle} placeholder="e.g. © 2025 META·LAB · Systematic review platform" />
          </Field>
        </div>
      </SectionCard>
      <SectionCard title="Banners">
        <div style={{ padding: '20px 20px 4px' }}>
          <Field label="Announcement Banner" note="Shown as a slim dismissable bar at the very top of the landing page. Leave blank to hide.">
            <input type="text" value={form.announcementBanner} onChange={e => setForm(f => ({ ...f, announcementBanner: e.target.value }))} style={inputStyle} placeholder="Optional announcement text…" />
          </Field>
          <Field label="Maintenance Banner" note="Shown prominently if set. Leave blank to hide.">
            <input type="text" value={form.maintenanceBanner} onChange={e => setForm(f => ({ ...f, maintenanceBanner: e.target.value }))} style={inputStyle} placeholder="Optional maintenance message…" />
          </Field>
        </div>
      </SectionCard>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <SaveButton onClick={save} status={status} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: SETTINGS
   ════════════════════════════════════════════════════════════════════════ */

function SettingsSection() {
  const [form,    setForm]    = useState({
    appName:                  'META·LAB',
    registrationOpen:         true,
    maintenanceMode:          false,
    contactFormEnabled:       true,
    projectCreationEnabled:   true,
    exportEnabled:            true,
    maxProjectsPerUser:       '',
    maxStudiesPerProject:     '',
  });
  const [loading, setLoading] = useState(true);
  const [status,  setStatus]  = useState('idle');

  useEffect(() => {
    adminApi.settings.get()
      .then(d => setForm(f => ({ ...f, ...d })))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setStatus('saving');
    try {
      await adminApi.settings.save(form);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 3000);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  const Row = ({ label, note, children }) => (
    <div style={{
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      padding:        '14px 20px',
      borderBottom:   `1px solid ${C.brd}`,
      gap:            20,
    }}>
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
          <Field label="App Name">
            <input type="text" value={form.appName} onChange={e => setForm(f => ({ ...f, appName: e.target.value }))} style={{ ...inputStyle, maxWidth: 320 }} />
          </Field>
        </div>
        <Row label="Registration Open" note="Allow new users to register.">
          <Toggle checked={!!form.registrationOpen} onChange={v => setForm(f => ({ ...f, registrationOpen: v }))} />
        </Row>
        <Row
          label="Maintenance Mode"
          note={form.maintenanceMode ? '⚠ WARNING: Site is currently in maintenance mode. Users cannot log in.' : 'Put the site in maintenance mode.'}
        >
          <Toggle checked={!!form.maintenanceMode} onChange={v => setForm(f => ({ ...f, maintenanceMode: v }))} />
        </Row>
        <Row label="Contact Form Enabled" note="Allow public contact form submissions.">
          <Toggle checked={!!form.contactFormEnabled} onChange={v => setForm(f => ({ ...f, contactFormEnabled: v }))} />
        </Row>
        <Row label="Project Creation Enabled" note="Allow users to create new projects.">
          <Toggle checked={!!form.projectCreationEnabled} onChange={v => setForm(f => ({ ...f, projectCreationEnabled: v }))} />
        </Row>
        <Row label="Export Enabled" note="Allow data exports.">
          <Toggle checked={!!form.exportEnabled} onChange={v => setForm(f => ({ ...f, exportEnabled: v }))} />
        </Row>
      </SectionCard>
      <SectionCard title="Limits">
        <div style={{ padding: '14px 20px 4px' }}>
          <Field label="Max Projects Per User" note="Leave blank for unlimited.">
            <input
              type="number"
              min="0"
              value={form.maxProjectsPerUser}
              onChange={e => setForm(f => ({ ...f, maxProjectsPerUser: e.target.value }))}
              style={{ ...inputStyle, maxWidth: 160 }}
              placeholder="Unlimited"
            />
          </Field>
          <Field label="Max Studies Per Project" note="Leave blank for unlimited.">
            <input
              type="number"
              min="0"
              value={form.maxStudiesPerProject}
              onChange={e => setForm(f => ({ ...f, maxStudiesPerProject: e.target.value }))}
              style={{ ...inputStyle, maxWidth: 160 }}
              placeholder="Unlimited"
            />
          </Field>
        </div>
      </SectionCard>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <SaveButton onClick={save} status={status} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: FEATURE FLAGS
   ════════════════════════════════════════════════════════════════════════ */

const FLAG_META = [
  { key: 'autosave',           label: 'Autosave',              desc: 'Automatically save project changes as the user types.' },
  { key: 'contactForm',        label: 'Contact Form',          desc: 'Show the public contact form on the landing page.' },
  { key: 'projectDuplication', label: 'Project Duplication',   desc: 'Allow users to clone existing projects.' },
  { key: 'advancedMetaAnalysis', label: 'Advanced Meta-Analysis', desc: 'Enable trim-and-fill, Egger\'s test, and influence diagnostics.' },
  { key: 'exportTools',        label: 'Export Tools',          desc: 'Allow project and data exports in various formats.' },
];

function FlagsSection() {
  const [flags,   setFlags]   = useState({});
  const [loading, setLoading] = useState(true);
  const [status,  setStatus]  = useState('idle');

  useEffect(() => {
    adminApi.featureFlags.get()
      .then(d => setFlags(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setStatus('saving');
    try {
      await adminApi.featureFlags.save(flags);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 3000);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>;

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>Feature Flags</h2>
      <SectionCard>
        {FLAG_META.map((f, i) => (
          <div
            key={f.key}
            style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'space-between',
              padding:        '16px 20px',
              borderBottom:   i < FLAG_META.length - 1 ? `1px solid ${C.brd}` : 'none',
              gap:            20,
            }}
          >
            <div>
              <div style={{ fontSize: 13, color: C.txt, fontWeight: 600 }}>{f.label}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{f.desc}</div>
            </div>
            <Toggle
              checked={!!flags[f.key]}
              onChange={v => setFlags(fl => ({ ...fl, [f.key]: v }))}
            />
          </div>
        ))}
      </SectionCard>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <SaveButton onClick={save} status={status} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: MESSAGES
   ════════════════════════════════════════════════════════════════════════ */

function MessagesSection() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all');
  const [page,    setPage]    = useState(1);
  const [expanded, setExpanded] = useState(null);
  const [confirm,  setConfirm]  = useState(null);
  const PER_PAGE = 25;

  const load = useCallback(async (f, p) => {
    setLoading(true);
    try {
      const params = { page: p, limit: PER_PAGE };
      if (f !== 'all') params.status = f;
      const data = await adminApi.messages.list(params);
      setRows(data.messages || data || []);
      setTotal(data.total || (data.messages || data || []).length);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(filter, page); }, [page]);

  async function markRead(id, isRead) {
    try {
      await adminApi.messages.update(id, { status: isRead ? 'read' : 'unread' });
      load(filter, page);
    } catch { /* silent */ }
  }

  async function archive(id) {
    try {
      await adminApi.messages.update(id, { status: 'archived' });
      load(filter, page);
    } catch { /* silent */ }
  }

  async function doDelete() {
    if (!confirm) return;
    try {
      await adminApi.messages.delete(confirm.id);
      load(filter, page);
    } catch { /* silent */ }
    setConfirm(null);
  }

  const columns = [
    { key: 'name',      label: 'From',    render: (v, row) => (
      <div>
        <div style={{ color: C.txt, fontWeight: 600, fontSize: 12 }}>{v}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.muted }}>{row.email}</div>
      </div>
    )},
    { key: 'subject',   label: 'Subject', render: v => <span style={{ color: C.txt2 }}>{v || '(no subject)'}</span> },
    { key: 'createdAt', label: 'Date',    render: v => v ? new Date(v).toLocaleString() : '—' },
    { key: 'status',    label: 'Status',  render: v => v === 'unread'
      ? <Badge text="unread"   color={C.acc} />
      : v === 'archived'
      ? <Badge text="archived" color={C.muted} />
      : <Badge text="read"     color={C.grn} /> },
    {
      key: '_actions', label: 'Actions',
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setExpanded(expanded?.id === row.id ? null : row)}
            style={{ padding: '3px 8px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 5, color: C.txt2, fontSize: 10, cursor: 'pointer', fontFamily: FONT }}
          >
            {expanded?.id === row.id ? 'Close' : 'View'}
          </button>
          {row.status !== 'read' && (
            <button onClick={() => markRead(row.id, true)}
              style={{ padding: '3px 8px', background: 'transparent', border: `1px solid ${C.grn}40`, borderRadius: 5, color: C.grn, fontSize: 10, cursor: 'pointer', fontFamily: FONT }}>
              Mark Read
            </button>
          )}
          {row.status === 'read' && (
            <button onClick={() => markRead(row.id, false)}
              style={{ padding: '3px 8px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 5, color: C.txt2, fontSize: 10, cursor: 'pointer', fontFamily: FONT }}>
              Unread
            </button>
          )}
          {row.status !== 'archived' && (
            <button onClick={() => archive(row.id)}
              style={{ padding: '3px 8px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 5, color: C.muted, fontSize: 10, cursor: 'pointer', fontFamily: FONT }}>
              Archive
            </button>
          )}
          <button onClick={() => setConfirm(row)}
            style={{ padding: '3px 8px', background: 'transparent', border: `1px solid ${C.red}40`, borderRadius: 5, color: C.red, fontSize: 10, cursor: 'pointer', fontFamily: FONT }}>
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>Contact Messages</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['all', 'unread', 'archived'].map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f); setPage(1); load(f, 1); }}
            style={{
              padding:    '7px 14px',
              background: filter === f ? C.acc2 : 'transparent',
              border:     `1px solid ${filter === f ? C.acc2 : C.brd2}`,
              borderRadius: 7,
              color:      filter === f ? '#fff' : C.txt2,
              fontSize:   12,
              cursor:     'pointer',
              fontFamily: FONT,
              textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
      </div>
      <SectionCard>
        <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No messages found." />
        {expanded && (
          <div style={{
            margin:       '0 0 0',
            padding:      '20px',
            background:   C.surf,
            borderTop:    `1px solid ${C.brd}`,
          }}>
            <div style={{ fontSize: 11, fontFamily: MONO, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Message from {expanded.name} &lt;{expanded.email}&gt; · {expanded.createdAt ? new Date(expanded.createdAt).toLocaleString() : ''}
            </div>
            <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {expanded.message}
            </div>
          </div>
        )}
        <div style={{ padding: '0 14px' }}>
          <Pagination page={page} total={total} perPage={PER_PAGE} onPage={setPage} />
        </div>
      </SectionCard>
      <ConfirmModal
        open={!!confirm}
        title="Delete Message"
        message={`Permanently delete message from ${confirm?.name}? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={doDelete}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: SECURITY
   ════════════════════════════════════════════════════════════════════════ */

function SecuritySection() {
  const [tab,     setTab]     = useState('audit');
  const [auditRows,  setAuditRows]  = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage,  setAuditPage]  = useState(1);
  const [secRows,    setSecRows]    = useState([]);
  const [secTotal,   setSecTotal]   = useState(0);
  const [secPage,    setSecPage]    = useState(1);
  const [loading,    setLoading]    = useState(false);
  const PER_PAGE = 25;

  const loadAudit = useCallback(async (p) => {
    setLoading(true);
    try {
      const data = await adminApi.auditLog({ page: p, limit: PER_PAGE });
      setAuditRows(data.logs || data || []);
      setAuditTotal(data.total || (data.logs || data || []).length);
    } catch { setAuditRows([]); }
    finally { setLoading(false); }
  }, []);

  const loadSec = useCallback(async (p) => {
    setLoading(true);
    try {
      const data = await adminApi.securityEvents({ page: p, limit: PER_PAGE });
      setSecRows(data.events || data || []);
      setSecTotal(data.total || (data.events || data || []).length);
    } catch { setSecRows([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === 'audit') loadAudit(auditPage);
    else loadSec(secPage);
  }, [tab]);

  useEffect(() => { if (tab === 'audit') loadAudit(auditPage); }, [auditPage]);
  useEffect(() => { if (tab === 'security') loadSec(secPage); }, [secPage]);

  const typeColor = t => ({
    FAILED_LOGIN:         C.red,
    ADMIN_ACCESS_DENIED:  C.ylw,
    RATE_LIMITED:         C.acc,
  }[t] || C.muted);

  const auditCols = [
    { key: 'timestamp', label: 'Time',    render: v => v ? new Date(v).toLocaleString() : '—' },
    { key: 'admin',     label: 'Admin',   render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v}</span> },
    { key: 'action',    label: 'Action',  render: v => <span style={{ color: C.txt, fontWeight: 600 }}>{v}</span> },
    { key: 'entity',    label: 'Entity',  render: v => v || '—' },
    { key: 'details',   label: 'Details', render: v => (
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted, display: 'block', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={typeof v === 'object' ? JSON.stringify(v) : v}>
        {typeof v === 'object' ? JSON.stringify(v) : (v || '—')}
      </span>
    )},
  ];

  const secCols = [
    { key: 'timestamp', label: 'Time',    render: v => v ? new Date(v).toLocaleString() : '—' },
    { key: 'type',      label: 'Type',    render: v => <Badge text={v} color={typeColor(v)} /> },
    { key: 'email',     label: 'Email',   render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v}</span> },
    { key: 'ip',        label: 'IP',      render: v => <span style={{ fontFamily: MONO, fontSize: 11 }}>{v}</span> },
    { key: 'details',   label: 'Details', render: v => (
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted, display: 'block', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={typeof v === 'object' ? JSON.stringify(v) : v}>
        {typeof v === 'object' ? JSON.stringify(v) : (v || '—')}
      </span>
    )},
  ];

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: '0 0 20px' }}>Security</h2>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.brd}`, paddingBottom: 0 }}>
        {[['audit', 'Audit Log'], ['security', 'Security Events']].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding:      '8px 18px',
              background:   'transparent',
              border:       'none',
              borderBottom: tab === id ? `2px solid ${C.acc}` : '2px solid transparent',
              color:        tab === id ? C.acc : C.txt2,
              fontSize:     13,
              fontWeight:   tab === id ? 700 : 400,
              cursor:       'pointer',
              fontFamily:   FONT,
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'audit' ? (
        <SectionCard>
          <DataTable columns={auditCols} rows={auditRows} loading={loading} emptyMessage="No audit log entries." />
          <div style={{ padding: '0 14px' }}>
            <Pagination page={auditPage} total={auditTotal} perPage={PER_PAGE} onPage={setAuditPage} />
          </div>
        </SectionCard>
      ) : (
        <SectionCard>
          <DataTable columns={secCols} rows={secRows} loading={loading} emptyMessage="No security events." />
          <div style={{ padding: '0 14px' }}>
            <Pagination page={secPage} total={secTotal} perPage={PER_PAGE} onPage={setSecPage} />
          </div>
        </SectionCard>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SECTION: HEALTH
   ════════════════════════════════════════════════════════════════════════ */

function HealthSection() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const timer = useRef(null);

  function formatUptime(seconds) {
    if (!seconds && seconds !== 0) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await adminApi.health();
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 30_000);
    return () => clearInterval(timer.current);
  }, [load]);

  const statusBadge = (ok) => ok
    ? <Badge text="OK" color={C.grn} />
    : <Badge text="ERROR" color={C.red} />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: C.txt, margin: 0 }}>System Health</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: C.muted }}>Auto-refreshes every 30s</span>
          <button
            onClick={load}
            style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7, color: C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>
      {error && (
        <div style={{ padding: '10px 14px', background: `${C.red}12`, border: `1px solid ${C.red}30`, borderRadius: 7, color: C.red, fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}
      {loading && !data ? (
        <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>
      ) : data ? (
        <SectionCard>
          {[
            { label: 'Backend',     value: statusBadge(data.status === 'ok' || data.backend === 'ok') },
            { label: 'Database',    value: statusBadge(data.database === 'ok' || data.db === 'ok') },
            { label: 'Environment', value: <Badge text={data.env || data.environment || 'unknown'} color={data.env === 'production' ? C.ylw : C.grn} /> },
            { label: 'Version',     value: <span style={{ fontFamily: MONO, fontSize: 12 }}>{data.version || '—'}</span> },
            { label: 'Uptime',      value: <span style={{ fontFamily: MONO, fontSize: 12 }}>{formatUptime(data.uptime)}</span> },
            { label: 'Timestamp',   value: <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{data.timestamp ? new Date(data.timestamp).toLocaleString() : '—'}</span> },
          ].map((row, i, arr) => (
            <div
              key={row.label}
              style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'space-between',
                padding:        '14px 20px',
                borderBottom:   i < arr.length - 1 ? `1px solid ${C.brd}` : 'none',
              }}
            >
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
   ROOT COMPONENT
   ════════════════════════════════════════════════════════════════════════ */

export default function AdminConsole() {
  const { user } = useAuth();
  const [active, setActive] = useState('overview');

  const sections = {
    overview: <OverviewSection />,
    users:    <UsersSection />,
    projects: <ProjectsSection />,
    content:  <ContentSection />,
    settings: <SettingsSection />,
    flags:    <FlagsSection />,
    messages: <MessagesSection />,
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
      `}</style>

      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div style={{
        position:       'fixed',
        top:            0,
        left:           0,
        right:          0,
        height:         TOPBAR_H,
        background:     C.surf,
        borderBottom:   `1px solid ${C.brd}`,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '0 24px 0 16px',
        zIndex:         300,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, color: C.acc }}>⬡</span>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: C.txt }}>META·LAB</span>
          <span style={{
            fontSize:     10,
            fontFamily:   MONO,
            color:        C.muted,
            background:   `${C.acc}14`,
            border:       `1px solid ${C.acc}28`,
            borderRadius: 4,
            padding:      '2px 7px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginLeft:   2,
          }}>
            OPS
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>
            {user?.email}
          </span>
          <Badge text="admin" color={C.acc} />
        </div>
      </div>

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <div style={{
        position:    'fixed',
        top:         TOPBAR_H,
        left:        0,
        width:       SIDEBAR_W,
        bottom:      0,
        background:  C.surf,
        borderRight: `1px solid ${C.brd}`,
        overflowY:   'auto',
        zIndex:      200,
        paddingTop:  12,
      }}>
        {SECTIONS.map(sec => {
          const isActive = active === sec.id;
          return (
            <button
              key={sec.id}
              onClick={() => setActive(sec.id)}
              style={{
                display:    'flex',
                alignItems: 'center',
                gap:        10,
                width:      '100%',
                padding:    '9px 16px',
                background: isActive ? `${C.acc}14` : 'transparent',
                border:     'none',
                borderLeft: `3px solid ${isActive ? C.acc : 'transparent'}`,
                cursor:     'pointer',
                fontFamily: FONT,
                fontSize:   13,
                color:      isActive ? C.acc : C.txt2,
                fontWeight: isActive ? 600 : 400,
                textAlign:  'left',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = `${C.acc}08`; e.currentTarget.style.color = C.txt; } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.txt2; } }}
            >
              <span style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0 }}>{sec.icon}</span>
              <span>{sec.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <div style={{
        marginLeft: SIDEBAR_W,
        paddingTop: TOPBAR_H,
        minHeight:  '100vh',
      }}>
        <div style={{ padding: '28px 32px', maxWidth: 1100 }}>
          {sections[active]}
        </div>
      </div>
    </div>
  );
}
