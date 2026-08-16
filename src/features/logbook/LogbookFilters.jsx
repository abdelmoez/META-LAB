/**
 * features/logbook/LogbookFilters.jsx — 119.md §8 "Logbook interface": search,
 * date-range, member, role, engine, action, resource, status and
 * human-vs-system filters, plus the sort order.
 *
 * STYLING: LEGACY tokens only (C/btnS/inp/lbl + var(--t-*)) — the Logbook mounts in
 * BOTH shells (the Stitch project workspace stage and the legacy Workspace tab), and
 * legacyRemap harmonises these tokens under Stitch. No Stitch S-token primitives.
 *
 * Restrained by design: one toolbar row and one filter row of plain labelled
 * controls with dividers — not a wall of cards. Every control is a real <label> +
 * <select>/<input> so it is keyboard- and screen-reader-navigable without extra
 * ARIA scaffolding.
 */
import { C, inp, lbl } from '../../frontend/workspace/ui/styles.js';
import { ACTIVITY_FILTERS, engineLabel } from './logbookFormat.js';

const ROW = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' };
const FIELD = { minWidth: 150, flex: '1 1 150px' };
const SELECT = { ...inp, padding: '7px 10px', fontSize: 12 };

/** One labelled single-choice filter writing a 0-or-1-length array (the API takes a list). */
function PickOne({ id, label, value, options, onChange, emptyLabel }) {
  return (
    <div style={FIELD}>
      <label htmlFor={id} style={lbl}>{label}</label>
      <select
        id={id}
        data-testid={`logbook-filter-${id}`}
        value={value || ''}
        onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
        style={SELECT}
      >
        <option value="">{emptyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.n ? `${o.label} (${o.n})` : o.label}</option>
        ))}
      </select>
    </div>
  );
}

export default function LogbookFilters({ filters, facets, resourceOptions, onChange, onClear, activeCount }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const one = (key) => ((filters[key] || [])[0] || '');

  const engineOptions = (facets.engines || []).map((e) => ({ ...e, label: engineLabel(e.value) }));
  const actorTypeValue = (filters.actorTypes || []).join(',');

  return (
    <div style={{ borderTop: `1px solid ${C.brd}`, borderBottom: `1px solid ${C.brd}`, padding: '14px 0', marginBottom: 14 }}>
      <div style={{ ...ROW, marginBottom: 12 }}>
        <div style={{ ...FIELD, flex: '2 1 260px' }}>
          <label htmlFor="logbook-search" style={lbl}>Search</label>
          <input
            id="logbook-search"
            data-testid="logbook-search"
            type="search"
            value={filters.q || ''}
            placeholder="Search summaries, actions, people…"
            onChange={(e) => set({ q: e.target.value })}
            style={{ ...inp, fontSize: 12.5 }}
          />
        </div>
        <div style={FIELD}>
          <label htmlFor="logbook-from" style={lbl}>From date</label>
          <input id="logbook-from" data-testid="logbook-filter-from" type="date" value={filters.from || ''}
            onChange={(e) => set({ from: e.target.value })} style={SELECT} />
        </div>
        <div style={FIELD}>
          <label htmlFor="logbook-to" style={lbl}>To date</label>
          <input id="logbook-to" data-testid="logbook-filter-to" type="date" value={filters.to || ''}
            onChange={(e) => set({ to: e.target.value })} style={SELECT} />
        </div>
        <div style={FIELD}>
          <label htmlFor="logbook-sort" style={lbl}>Order</label>
          <select id="logbook-sort" data-testid="logbook-sort" value={filters.sort || 'desc'}
            onChange={(e) => set({ sort: e.target.value })} style={SELECT}>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </div>
      </div>

      <div style={ROW}>
        <PickOne id="member" label="Member" value={one('members')} options={facets.actors || []}
          onChange={(v) => set({ members: v })} emptyLabel="Everyone" />
        <PickOne id="role" label="Role at the time" value={one('roles')} options={facets.roles || []}
          onChange={(v) => set({ roles: v })} emptyLabel="Any role" />
        <PickOne id="engine" label="Engine" value={one('engines')} options={engineOptions}
          onChange={(v) => set({ engines: v })} emptyLabel="All engines" />
        <PickOne id="action" label="Action" value={one('actions')} options={facets.actions || []}
          onChange={(v) => set({ actions: v })} emptyLabel="All actions" />
        <PickOne id="resource" label="Resource" value={one('resourceTypes')} options={resourceOptions || []}
          onChange={(v) => set({ resourceTypes: v })} emptyLabel="All resources" />
        <PickOne id="status" label="Outcome" value={one('statuses')} options={facets.statuses || []}
          onChange={(v) => set({ statuses: v })} emptyLabel="Any outcome" />
        <div style={FIELD}>
          <label htmlFor="logbook-activity" style={lbl}>Activity</label>
          <select id="logbook-activity" data-testid="logbook-filter-actorType" value={actorTypeValue}
            onChange={(e) => set({ actorTypes: e.target.value ? e.target.value.split(',') : [] })} style={SELECT}>
            {ACTIVITY_FILTERS.map((a) => <option key={a.value || 'all'} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        {activeCount > 0 && (
          <button type="button" data-testid="logbook-clear-filters" onClick={onClear}
            style={{ background: 'none', border: 'none', color: C.acc, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '8px 0' }}>
            Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </div>
  );
}
