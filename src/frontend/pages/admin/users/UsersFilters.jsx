/**
 * users/UsersFilters.jsx — 95.md Phases 3/4 — server-side search, quick-filter
 * chips, and an admin-only advanced-filter panel (collapsed by default). Every
 * control maps to a GET /api/admin/users query param; filters are independent so
 * they combine freely. No client-side row filtering and no per-row enrichment —
 * the old N+1 advanced panel is gone.
 */
import { useState } from 'react';
import { C, FONT, MONO, alpha } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';
import { inputStyle, selectStyle, ghostBtn } from './primitives.jsx';
import {
  USER_LIST_REG_FILTERS, USER_LIST_AUTH_FILTERS, USER_LIST_CREATED_WINDOWS,
  USER_LIST_ACTIVE_WINDOWS, REGISTRATION_METHOD_LABELS,
} from '../../../../shared/adminUsers.js';

/* The keys the advanced panel + chips own, so "All" / advCount know the scope. */
const FILTER_KEYS = ['status', 'verified', 'authMethod', 'regMethod', 'role', 'tier', 'createdWithin', 'lastActiveWithin'];

// Quick chips → the exact server params they set. `admin` chips are hidden from
// mods (matching the pre-95 viewer gating, where auth-method slicing was an
// admin-analytics concern). Each chip toggles its own keys only.
const CHIPS = [
  { id: 'all',        label: 'All',             patch: {} },
  { id: 'active',     label: 'Active',          patch: { status: 'active' } },
  { id: 'suspended',  label: 'Suspended',       patch: { status: 'suspended' } },
  { id: 'new',        label: 'New · 7d',        patch: { createdWithin: 'week' } },
  { id: 'unverified', label: 'Unverified',      patch: { verified: 'false' } },
  { id: 'never',      label: 'Never logged in', patch: { status: 'never_logged_in' } },
  { id: 'google',     label: 'Google',          patch: { authMethod: 'google_only' }, admin: true },
  { id: 'emailonly',  label: 'Email only',      patch: { authMethod: 'email_only' }, admin: true },
];

const AUTH_LABELS = { google_only: 'Google only', email_only: 'Email only', both: 'Google + Email', none: 'No login method' };
const CREATED_LABELS = { today: 'Today', week: 'This week', month: 'This month', quarter: 'This quarter', year: 'This year' };
const ACTIVE_LABELS = { day: 'Last 24h', week: 'Last 7 days', month: 'Last 30 days' };

function chipActive(chip, params) {
  if (chip.id === 'all') return !FILTER_KEYS.some((k) => params[k]);
  return Object.entries(chip.patch).every(([k, v]) => params[k] === v);
}

export default function UsersFilters({ search, onSearch, params, onPatch, isAdmin, tiers = [], onExport, exporting }) {
  const [advOpen, setAdvOpen] = useState(false);
  const advCount = FILTER_KEYS.filter((k) => params[k]).length;
  const chips = CHIPS.filter((c) => isAdmin || !c.admin);

  const toggleChip = (chip) => {
    if (chip.id === 'all') { onPatch(Object.fromEntries(FILTER_KEYS.map((k) => [k, '']))); return; }
    if (chipActive(chip, params)) onPatch(Object.fromEntries(Object.keys(chip.patch).map((k) => [k, '']))); // toggle off
    else onPatch(chip.patch);
  };

  const sel = (key, label, options, labelsMap) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
      <select value={params[key] || ''} onChange={(e) => onPatch({ [key]: e.target.value })} style={{ ...selectStyle, padding: '7px 10px', fontSize: 12 }}>
        <option value="">Any</option>
        {options.map((o) => <option key={o} value={o}>{(labelsMap && labelsMap[o]) || o}</option>)}
      </select>
    </label>
  );

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Search + quick chips + advanced toggle + export */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ position: 'relative', flex: '0 0 auto' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted, display: 'inline-flex' }}><Icon name="search" size={14} /></span>
          <input
            type="search"
            aria-label="Search users by name, email, institution, or user number"
            placeholder="Search name, email, institution, #number…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            style={{ ...inputStyle, width: 300, paddingLeft: 32 }}
          />
        </div>
        <div role="group" aria-label="Quick filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {chips.map((chip) => {
            const on = chipActive(chip, params);
            return (
              <button key={chip.id} type="button" aria-pressed={on} onClick={() => toggleChip(chip)} style={{
                padding: '6px 12px', background: on ? C.acc2 : 'transparent',
                border: `1px solid ${on ? C.acc2 : C.brd2}`, borderRadius: 999,
                color: on ? C.accText : C.txt2, fontSize: 12, cursor: 'pointer', fontFamily: FONT, fontWeight: on ? 700 : 500,
              }}>{chip.label}</button>
            );
          })}
        </div>
        <span style={{ flex: 1 }} />
        {isAdmin && (
          <button type="button" onClick={() => setAdvOpen((o) => !o)} aria-expanded={advOpen} style={{
            ...ghostBtn,
            background: advCount > 0 ? alpha(C.acc, '14') : 'transparent',
            borderColor: advCount > 0 ? alpha(C.acc, '45') : C.brd2,
            color: advCount > 0 ? C.acc : C.txt2,
          }}>
            <Icon name="filter" size={13} /><span>Filters</span>
            {advCount > 0 && <span style={{ background: alpha(C.acc, '22'), borderRadius: 8, padding: '1px 6px', fontSize: 10, fontFamily: MONO, color: C.acc }}>{advCount}</span>}
            <Icon name={advOpen ? 'chevronDown' : 'chevronRight'} size={12} />
          </button>
        )}
        {isAdmin && (
          <button type="button" onClick={onExport} disabled={exporting} title="Download the currently filtered users as CSV" style={{ ...ghostBtn, color: C.acc, borderColor: alpha(C.acc, '45'), opacity: exporting ? 0.6 : 1 }}>
            <Icon name="download" size={13} />{exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        )}
      </div>

      {/* Advanced filter panel (admin only, collapsed by default) */}
      {isAdmin && advOpen && (
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {sel('role', 'Role', ['user', 'mod', 'admin'])}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
              <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Tier</span>
              <select value={params.tier || ''} onChange={(e) => onPatch({ tier: e.target.value })} style={{ ...selectStyle, padding: '7px 10px', fontSize: 12 }}>
                <option value="">Any</option>
                <option value="default">Default (site tier)</option>
                {tiers.map((t) => <option key={t.id} value={t.id}>{t.displayName || t.id}</option>)}
              </select>
            </label>
            {sel('regMethod', 'Registration method', USER_LIST_REG_FILTERS, { ...REGISTRATION_METHOD_LABELS, invited: 'Invited' })}
            {sel('authMethod', 'Sign-in method', USER_LIST_AUTH_FILTERS, AUTH_LABELS)}
            {sel('createdWithin', 'Registered within', USER_LIST_CREATED_WINDOWS, CREATED_LABELS)}
            {sel('lastActiveWithin', 'Active within', USER_LIST_ACTIVE_WINDOWS, ACTIVE_LABELS)}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
              <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Email verified</span>
              <select value={params.verified || ''} onChange={(e) => onPatch({ verified: e.target.value })} style={{ ...selectStyle, padding: '7px 10px', fontSize: 12 }}>
                <option value="">Any</option>
                <option value="true">Verified</option>
                <option value="false">Unverified</option>
              </select>
            </label>
          </div>
          {advCount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" onClick={() => onPatch(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])))} style={ghostBtn}>Clear advanced filters</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
