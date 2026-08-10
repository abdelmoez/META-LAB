/**
 * research/ClientErrorsTab.jsx — 109.md §§46-47.
 *
 * The browser-side error feed. This is CAPTURE, not a metrics dashboard: the
 * beacon persists a bounded, deduplicated row per distinct (kind, message,
 * context) fingerprint, and repeats increment a counter instead of adding rows.
 *
 * Privacy rules the server already enforces and this UI must not undermine:
 * no stack traces, no payloads, no query strings — `context` carries only route,
 * engine, release, browser and correlation id, each truncated. The feed is
 * paginated server-side; nothing loads the whole table.
 */
import { useCallback, useEffect, useState } from 'react';
import { C, MONO } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';
import { adminApi } from '../adminApiClient.js';
import {
  Badge, Chip, ErrorBox, FilterRow, LabelledField, NoticeBox, Pager, SectionCard,
  Table, fmtAgo, fmtDateTime, ghostBtn, inputStyle,
} from './primitives.jsx';

const PER_PAGE = 25;

export default function ClientErrorsTab() {
  const [rows, setRows] = useState([]);
  const [capture, setCapture] = useState(null);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PER_PAGE, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ kind: '', from: '', to: '' });
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminApi.research.clientErrors({ ...filters, page, limit: PER_PAGE })
      .then((d) => {
        setRows(Array.isArray(d?.errors) ? d.errors : []);
        setCapture(d?.capture || null);
        setMeta({ total: d?.total || 0, page: d?.page || 1, limit: d?.limit || PER_PAGE, hasMore: !!d?.hasMore });
      })
      .catch((e) => { setRows([]); setError(e?.message || 'Could not load the client error feed.'); })
      .finally(() => setLoading(false));
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (k, v) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  const columns = [
    { key: 'lastSeenAt', label: 'Last seen', render: (r) => <span title={fmtDateTime(r.lastSeenAt)} style={{ fontFamily: MONO, fontSize: 10.5 }}>{fmtAgo(r.lastSeenAt)}</span> },
    { key: 'kind', label: 'Kind', render: (r) => <Badge text={r.kind || 'error'} color={C.red} /> },
    { key: 'message', label: 'Message', render: (r) => <span style={{ display: 'block', maxWidth: 420, color: C.txt }}>{r.message || '—'}</span> },
    { key: 'context', label: 'Context', render: (r) => <span style={{ fontFamily: MONO, fontSize: 10.5, display: 'block', maxWidth: 340, overflowWrap: 'anywhere' }}>{r.context || '—'}</span> },
    { key: 'count', label: 'Count', render: (r) => <span style={{ fontFamily: MONO }}>{r.count ?? 1}</span> },
    { key: 'firstSeenAt', label: 'First seen', render: (r) => <span style={{ fontSize: 11 }} title={fmtDateTime(r.firstSeenAt)}>{fmtAgo(r.firstSeenAt)}</span> },
  ];

  return (
    <div>
      <NoticeBox tone={C.acc} testId="rg-client-errors-scope">
        <strong>Crash-beacon capture only.</strong> These are errors the browser reported. There is no autosave success-rate,
        undo/redo or import telemetry behind this feed — 109 §46 forbids showing a metric with no data source, so those cards
        are absent rather than estimated. Stack traces and payloads are never stored.
      </NoticeBox>

      <SectionCard
        testId="rg-client-errors"
        title="Recent client errors"
        subtitle="One row per distinct error fingerprint; repeats increment the count instead of adding rows."
        action={<button data-testid="rg-client-errors-reload" onClick={load} style={ghostBtn}><Icon name="refresh" size={12} /> Refresh</button>}
      >
        {capture && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '14px 18px 4px' }}>
            <Chip label="distinct rows" value={capture.distinctRows ?? 0} color={C.acc} testId="rg-client-errors-distinct" />
            <Chip label="row cap" value={capture.maxRows ?? 0} color={C.muted} />
            <Chip label="matching filter" value={meta.total} color={C.ylw} />
          </div>
        )}
        {capture && (
          <div style={{ padding: '6px 18px 12px', fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
            Bounded capture: at most {capture.maxRows} distinct fingerprints are stored (over the cap, new fingerprints are
            dropped and existing ones keep counting). Message and context are truncated to{' '}
            {capture.limits?.message ?? 500} and {capture.limits?.context ?? 500} characters.
          </div>
        )}
        <FilterRow>
          <LabelledField label="Kind">
            <input data-testid="rg-error-filter-kind" value={filters.kind} placeholder="e.g. TypeError" onChange={(e) => setFilter('kind', e.target.value)} style={{ ...inputStyle, width: 200 }} />
          </LabelledField>
          <LabelledField label="From">
            <input data-testid="rg-error-filter-from" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} style={{ ...inputStyle, width: 150 }} />
          </LabelledField>
          <LabelledField label="To">
            <input data-testid="rg-error-filter-to" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} style={{ ...inputStyle, width: 150 }} />
          </LabelledField>
        </FilterRow>
        {error && <div style={{ padding: '14px 18px 0' }}><ErrorBox msg={error} /></div>}
        <Table
          testId="rg-client-errors-table"
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(r) => r.id}
          emptyMessage="No client errors captured for these filters."
        />
        <Pager testId="rg-client-errors-pager" page={meta.page} limit={meta.limit} total={meta.total} hasMore={meta.hasMore} onPage={setPage} />
      </SectionCard>
    </div>
  );
}
