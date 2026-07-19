/**
 * users/UsersDirectory.jsx — 95.md Phases 2-8 — the redesigned Ops user
 * directory container. Everything is SERVER-SIDE: search, filters, sort, and
 * pagination all map to GET /api/admin/users params, and the metrics strip comes
 * from GET /api/admin/users/metrics — there is no client-side row filtering and
 * no per-row enrichment (the old N+1 advanced panel is gone). Admins additionally
 * get the metrics strip, advanced filters, CSV export, row/bulk actions, and the
 * live presence head-count; mods get the table, quick filters, and the drawer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { C, MONO, alpha } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { adminApi } from '../adminApiClient.js';
import { ghostBtn, ConfirmDialog } from './primitives.jsx';
import UsersMetricsStrip from './UsersMetricsStrip.jsx';
import UsersFilters from './UsersFilters.jsx';
import UsersTable from './UsersTable.jsx';
import UsersBulkBar from './UsersBulkBar.jsx';
import UserDrawer from './UserDrawer.jsx';

const PER_PAGE = 25;
const SEARCH_DEBOUNCE = 280;

export default function UsersDirectory({ isAdmin = false }) {
  const { user: viewer } = useAuth();

  const [search, setSearch] = useState('');
  const [debSearch, setDebSearch] = useState('');
  const [filters, setFilters] = useState({}); // status/verified/authMethod/regMethod/role/tier/createdWithin/lastActiveWithin
  const [sort, setSort] = useState('created');
  const [order, setOrder] = useState('desc');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [metrics, setMetrics] = useState(null);
  const [filtered, setFiltered] = useState(false);
  const [presence, setPresence] = useState(null);
  const [tiers, setTiers] = useState([]);

  const [selected, setSelected] = useState(() => new Set());
  const [drawerUser, setDrawerUser] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Row-menu quick actions.
  const [rowConfirm, setRowConfirm] = useState(null); // { type, user }
  const [rowBusy, setRowBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [toastErr, setToastErr] = useState('');
  const searchTimer = useRef(null);

  const tierNameOf = useCallback((id) => (id ? (tiers.find((t) => t.id === id)?.displayName || null) : null), [tiers]);

  // Non-page params, shared by list / metrics / export so they never disagree.
  const filterParams = useMemo(() => {
    const p = {};
    if (debSearch.trim()) p.search = debSearch.trim();
    for (const [k, v] of Object.entries(filters)) if (v) p[k] = v;
    return p;
  }, [debSearch, filters]);

  const listParams = useMemo(() => ({ ...filterParams, sort, order, page, limit: PER_PAGE }), [filterParams, sort, order, page]);

  const loadList = useCallback(() => {
    setLoading(true); setError('');
    adminApi.users.list(listParams)
      .then((d) => { setRows(d.users || []); setTotal(d.total || 0); setPages(d.pages || 1); })
      .catch((e) => { setRows([]); setError(e.message || 'Could not load users.'); })
      .finally(() => setLoading(false));
  }, [listParams]);

  const loadMetrics = useCallback(() => {
    if (!isAdmin) return;
    adminApi.users.metrics(filterParams)
      .then((d) => { setMetrics(d.metrics || null); setFiltered(!!d.filtered); })
      .catch(() => { /* metrics are best-effort — the table still works */ });
  }, [isAdmin, filterParams]);

  // Load list on any param change; clear a stale selection on the same beat.
  useEffect(() => { loadList(); setSelected(new Set()); }, [loadList]);
  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  // One-time admin fetches: tier options + live presence head-count.
  useEffect(() => {
    if (!isAdmin) return;
    adminApi.tiers.get().then((d) => setTiers((d.tiers || []).map((t) => ({ id: t.id, displayName: t.displayName })))).catch(() => {});
  }, [isAdmin]);
  const loadPresence = useCallback(() => { if (isAdmin) adminApi.users.activitySummary().then(setPresence).catch(() => setPresence(null)); }, [isAdmin]);
  useEffect(() => { loadPresence(); }, [loadPresence, page, filterParams]);

  // Debounced server search.
  const onSearch = (v) => {
    setSearch(v);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setDebSearch(v); setPage(1); }, SEARCH_DEBOUNCE);
  };
  const onPatch = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const onSort = (col) => {
    if (sort === col) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setSort(col); setOrder(col === 'name' ? 'asc' : 'desc'); }
    setPage(1);
  };

  // Selection.
  const allPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));
  const toggleRow = (u) => setSelected((prev) => { const n = new Set(prev); if (n.has(u.id)) n.delete(u.id); else n.add(u.id); return n; });
  const toggleAll = () => setSelected((prev) => {
    const n = new Set(prev);
    if (allPageSelected) rows.forEach((r) => n.delete(r.id)); else rows.forEach((r) => n.add(r.id));
    return n;
  });

  const reloadAll = () => { loadList(); loadMetrics(); loadPresence(); };

  const runBulk = async (body) => {
    const res = await adminApi.users.bulk(body);
    reloadAll(); setSelected(new Set());
    return res;
  };

  const doExport = async () => {
    setExporting(true); setToastErr('');
    try {
      const blob = await adminApi.users.exportCsv(filterParams);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href; a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(href);
    } catch (e) { setToastErr(`Export failed: ${e.message || e.status}`); }
    finally { setExporting(false); }
  };

  // ── Row-menu quick actions ──────────────────────────────────────────────
  const flash = (m) => { setToast(m); setToastErr(''); setTimeout(() => setToast(''), 4000); };
  const quickReset = async (u) => {
    try { const r = await adminApi.users.sendPasswordReset(u.id); flash(r.sent ? `Reset link emailed to ${u.email}.` : `Reset link generated for ${u.email} (email not sent).`); }
    catch (e) { setToastErr(e.message || 'Could not send reset.'); }
  };
  const quickVerify = async (u) => {
    try { const r = await adminApi.users.resendVerification(u.id); flash(r.sent ? `Verification email sent to ${u.email}.` : `Verification link generated for ${u.email}.`); }
    catch (e) { setToastErr(e.code === 'ALREADY_VERIFIED' ? `${u.email} is already verified.` : (e.message || 'Could not resend verification.')); }
  };
  const runRowConfirm = async () => {
    if (!rowConfirm) return;
    const { type, user: u } = rowConfirm;
    setRowBusy(true); setToastErr('');
    try {
      if (type === 'suspend') { await adminApi.users.updateStatus(u.id, { suspended: true }); flash(`${u.email} suspended — sessions revoked.`); }
      else if (type === 'restore') { await adminApi.users.updateStatus(u.id, { suspended: false }); flash(`${u.email} reactivated.`); }
      else if (type === 'revoke') { await adminApi.users.revokeSessions(u.id); flash(`${u.email} signed out everywhere.`); }
      setRowConfirm(null); reloadAll();
    } catch (e) { setToastErr(e.message || 'Action failed.'); }
    finally { setRowBusy(false); }
  };

  const buildRowMenu = (u) => {
    const items = [{ key: 'view', label: 'View details', icon: 'eye', onClick: () => setDrawerUser(u) }];
    if (!isAdmin) return items; // mods act through the drawer (server 403s privileged mutations)
    const suspended = u.status === 'suspended' || u.suspended;
    if (suspended) items.push({ key: 'restore', label: 'Restore account', icon: 'refresh', onClick: () => setRowConfirm({ type: 'restore', user: u }) });
    else if (u.role !== 'admin') items.push({ key: 'suspend', label: 'Suspend account', icon: 'lock', danger: true, onClick: () => setRowConfirm({ type: 'suspend', user: u }) });
    items.push({ key: 'reset', label: 'Send password reset', icon: 'send', onClick: () => quickReset(u) });
    if (!u.emailVerifiedAt) items.push({ key: 'verify', label: 'Resend verification', icon: 'mail', onClick: () => quickVerify(u) });
    items.push({ key: 'revoke', label: 'Revoke sessions', icon: 'logout', danger: true, onClick: () => setRowConfirm({ type: 'revoke', user: u }) });
    return items;
  };

  const rc = rowConfirm;
  return (
    <div data-testid="users-directory">
      {toast && <div role="status" style={{ marginBottom: 12, padding: '8px 12px', background: alpha(C.grn, '12'), border: `1px solid ${alpha(C.grn, '40')}`, borderRadius: 8, color: C.grn, fontSize: 12.5 }}>{toast}</div>}
      {toastErr && <div role="alert" style={{ marginBottom: 12, padding: '8px 12px', background: alpha(C.red, '12'), border: `1px solid ${alpha(C.red, '40')}`, borderRadius: 8, color: C.red, fontSize: 12.5 }}>{toastErr}</div>}

      {isAdmin && <UsersMetricsStrip metrics={metrics} filtered={filtered} presence={presence} loading={loading && !metrics} />}

      <UsersFilters
        search={search} onSearch={onSearch}
        params={filters} onPatch={onPatch}
        isAdmin={isAdmin} tiers={tiers}
        onExport={doExport} exporting={exporting}
      />

      {error && <div role="alert" style={{ padding: '10px 14px', background: alpha(C.red, '12'), border: `1px solid ${alpha(C.red, '30')}`, borderRadius: 8, color: C.red, fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

      <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, overflow: 'hidden' }}>
        <UsersTable
          rows={rows} loading={loading}
          sort={sort} order={order} onSort={onSort}
          selectable={isAdmin} selected={selected} onToggleRow={toggleRow} onToggleAll={toggleAll}
          allPageSelected={allPageSelected} someSelected={someSelected}
          tierNameOf={tierNameOf} onRowClick={setDrawerUser} buildRowMenu={buildRowMenu}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: `1px solid ${C.brd}`, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>{total.toLocaleString()} user{total === 1 ? '' : 's'}{total > 0 ? ` · page ${page} of ${pages}` : ''}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => page > 1 && setPage(page - 1)} disabled={page <= 1 || loading} style={{ ...ghostBtn, opacity: page <= 1 ? 0.5 : 1 }}><Icon name="chevronLeft" size={13} />Prev</button>
            <button type="button" onClick={() => page < pages && setPage(page + 1)} disabled={page >= pages || loading} style={{ ...ghostBtn, opacity: page >= pages ? 0.5 : 1 }}>Next<Icon name="chevronRight" size={13} /></button>
          </span>
        </div>
      </div>

      {isAdmin && (
        <UsersBulkBar ids={[...selected]} tiers={tiers} runBulk={runBulk} onClear={() => setSelected(new Set())} />
      )}

      {drawerUser && (
        <UserDrawer
          key={drawerUser.id}
          userId={drawerUser.id} initialUser={drawerUser}
          isAdmin={isAdmin} viewer={viewer} tiers={tiers} tierNameOf={tierNameOf}
          onClose={() => setDrawerUser(null)}
          onChanged={reloadAll}
        />
      )}

      <ConfirmDialog
        open={!!rc}
        title={rc?.type === 'suspend' ? 'Suspend user' : rc?.type === 'restore' ? 'Reactivate user' : 'Revoke sessions'}
        message={rc && (rc.type === 'suspend' ? `Suspend ${rc.user.email}? This signs them out everywhere and blocks sign-in until reactivated.`
          : rc.type === 'restore' ? `Reactivate ${rc.user.email}? They regain full access.`
          : `Sign ${rc.user.email} out of every device?`)}
        confirmLabel={rc?.type === 'restore' ? 'Reactivate' : rc?.type === 'suspend' ? 'Suspend' : 'Revoke sessions'}
        danger={rc?.type !== 'restore'} busy={rowBusy}
        onConfirm={runRowConfirm} onCancel={() => !rowBusy && setRowConfirm(null)}
      />
    </div>
  );
}
