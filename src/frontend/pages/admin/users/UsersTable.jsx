/**
 * users/UsersTable.jsx — 95.md Phase 2 — the dense user table. Columns: User
 * (avatar + name + email + institution), Sign-in (auth badge, never from the
 * email domain), Status (suspended strongest; "Never logged in" as subtext),
 * Role, Tier, Joined, Last active ("Active now" < 5 min), Projects, Actions.
 * Name/Joined/Last active/Projects are server-sortable. Admin gets row + header
 * select-all checkboxes and a kebab action menu per row.
 */
import { C, MONO, alpha } from '../../../theme/tokens.js';
import { Avatar, Spinner } from './primitives.jsx';
import { StatusBadge, AuthBadge, RoleBadge, TierBadge } from './badges.jsx';
import RowMenu from './RowMenu.jsx';
import { fmtDate, lastActiveLabel } from './fmt.js';

const th = { padding: '9px 10px', textAlign: 'left', fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: `1px solid ${C.brd}`, fontWeight: 600, whiteSpace: 'nowrap', background: C.card2 };
const td = { padding: '9px 10px', fontSize: 12, color: C.txt2, borderBottom: `1px solid ${C.brd}`, verticalAlign: 'middle' };

function SortHead({ col, sort, order, onSort, children, align = 'left', width }) {
  const on = sort === col;
  return (
    <th style={{ ...th, textAlign: align, width, cursor: 'pointer', userSelect: 'none' }}
      aria-sort={on ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(col)} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {children}
        <span aria-hidden="true" style={{ color: on ? C.acc : C.dim, fontSize: 9 }}>{on ? (order === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

export default function UsersTable({
  rows, loading, sort, order, onSort,
  selectable, selected, onToggleRow, onToggleAll, allPageSelected, someSelected,
  tierNameOf, onRowClick, buildRowMenu,
}) {
  const colSpan = selectable ? 10 : 9;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: selectable ? 940 : 900 }}>
        <thead>
          <tr>
            {selectable && (
              <th style={{ ...th, width: 34, textAlign: 'center', padding: '9px 4px 9px 12px' }}>
                <input type="checkbox" aria-label="Select all users on this page"
                  ref={(el) => { if (el) el.indeterminate = !allPageSelected && someSelected; }}
                  checked={allPageSelected} onChange={onToggleAll}
                  disabled={rows.length === 0}
                  style={{ accentColor: C.acc, width: 15, height: 15, cursor: rows.length === 0 ? 'not-allowed' : 'pointer' }} />
              </th>
            )}
            <SortHead col="name" sort={sort} order={order} onSort={onSort}>User</SortHead>
            <th style={th}>Sign-in</th>
            <th style={th}>Status</th>
            <th style={th}>Role</th>
            <th style={th}>Tier</th>
            <SortHead col="created" sort={sort} order={order} onSort={onSort} width={110}>Joined</SortHead>
            <SortHead col="lastActive" sort={sort} order={order} onSort={onSort} width={120}>Last active</SortHead>
            <SortHead col="projects" sort={sort} order={order} onSort={onSort} align="right" width={80}>Projects</SortHead>
            <th style={{ ...th, width: 44 }} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={colSpan} style={{ padding: 44, textAlign: 'center' }}><Spinner size={20} /><div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>Loading users…</div></td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={colSpan} style={{ padding: '48px 16px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No users match these filters.</td></tr>
          ) : rows.map((u) => {
            const isSel = selectable && selected.has(u.id);
            const menu = buildRowMenu ? buildRowMenu(u) : null;
            return (
              <tr key={u.id} tabIndex={0}
                aria-label={`View ${u.name || u.email}`}
                onClick={() => onRowClick(u)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onRowClick(u); } }}
                style={{ cursor: 'pointer', background: isSel ? alpha(C.acc, '10') : 'transparent', transition: 'background 0.1s' }}
                onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = C.card2; }}
                onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}
                onFocus={(e) => { e.currentTarget.style.outline = `2px solid ${C.acc}`; e.currentTarget.style.outlineOffset = '-2px'; }}
                onBlur={(e) => { e.currentTarget.style.outline = 'none'; }}>
                {selectable && (
                  <td style={{ ...td, textAlign: 'center', padding: '9px 4px 9px 12px' }} onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${u.name || u.email}`}
                      checked={isSel} onChange={() => onToggleRow(u)}
                      style={{ accentColor: C.acc, width: 15, height: 15, cursor: 'pointer' }} />
                  </td>
                )}
                {/* User */}
                <td style={{ ...td, minWidth: 220 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <Avatar name={u.name} email={u.email} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', color: C.txt, fontWeight: 600, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }} title={u.name || undefined}>{u.name || <span style={{ color: C.muted, fontWeight: 400 }}>Unnamed</span>}</span>
                      <span style={{ display: 'block', color: C.muted, fontFamily: MONO, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }} title={u.email}>{u.email}</span>
                      {u.institution && <span style={{ display: 'block', color: C.dim, fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }} title={u.institution}>{u.institution}</span>}
                    </span>
                  </span>
                </td>
                {/* Sign-in */}
                <td style={td}><AuthBadge hasPassword={u.hasPassword} authProviders={u.authProviders} invited={u.invitedViaInvitation} /></td>
                {/* Status */}
                <td style={td}>
                  <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                    <StatusBadge status={u.status} />
                    {u.neverLoggedIn && u.status !== 'suspended' && <span style={{ fontSize: 9.5, color: C.muted, fontFamily: MONO }}>Never logged in</span>}
                  </span>
                </td>
                {/* Role */}
                <td style={td}><RoleBadge role={u.role} /></td>
                {/* Tier */}
                <td style={td}><TierBadge tierId={u.tierId} tierName={tierNameOf?.(u.tierId)} /></td>
                {/* Joined */}
                <td style={{ ...td, fontFamily: MONO, fontSize: 11.5, whiteSpace: 'nowrap' }}>{fmtDate(u.createdAt)}</td>
                {/* Last active */}
                <td style={{ ...td, fontFamily: MONO, fontSize: 11.5, whiteSpace: 'nowrap', color: u.isOnline ? C.grn : C.txt2 }}>{lastActiveLabel(u.lastActive, u.isOnline)}</td>
                {/* Projects */}
                <td style={{ ...td, textAlign: 'right', fontFamily: MONO, fontSize: 12, color: (u.projectCount || 0) > 0 ? C.txt : C.muted }}>{u.projectCount || 0}</td>
                {/* Actions */}
                <td style={{ ...td, textAlign: 'right', padding: '9px 8px' }} onClick={(e) => e.stopPropagation()}>
                  {menu && menu.length > 0 && <RowMenu items={menu} label={`Actions for ${u.name || u.email}`} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
