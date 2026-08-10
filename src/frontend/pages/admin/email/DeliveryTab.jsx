/**
 * email/DeliveryTab.jsx — 112.md follow-up — the EmailOutbox delivery history:
 * a paginated, filterable table plus per-status chips.
 *
 * HONESTY RULES the server enforces and this UI must not undermine: email BODIES
 * are never stored (only the rendered subject after a render), and the variables
 * blob is never returned to the browser — it can carry live reset/invite links.
 * This is delivery METADATA, not an email archive.
 */
import { useCallback, useEffect, useState } from 'react';
import { C, MONO } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';
import { adminApi } from '../adminApiClient.js';
import {
  Badge, Chip, ErrorBox, FilterRow, LabelledField, NoticeBox, Pager,
  SectionCard, Table, fmtAgo, fmtDateTime, ghostBtn, inputStyle, selectStyle,
} from '../research/primitives.jsx';
import { DELIVERY_STATUSES, deliveryStatusLabel } from './fields.js';

const PER_PAGE = 25;

const STATUS_COLOR = {
  pending: C.ylw,
  sending: C.acc,
  sent: C.grn,
  failed: C.red,
  skipped_disabled: C.muted,
  skipped_unconfigured: C.teal,
};

export default function DeliveryTab() {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState(null);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PER_PAGE, hasMore: false });
  const [templateKeys, setTemplateKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: '', templateKey: '', from: '', to: '' });
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminApi.email.delivery({ ...filters, page, limit: PER_PAGE })
      .then((d) => {
        setRows(Array.isArray(d?.deliveries) ? d.deliveries : []);
        setCounts(d?.counts || null);
        setMeta({ total: d?.total || 0, page: d?.page || 1, limit: d?.limit || PER_PAGE, hasMore: !!d?.hasMore });
      })
      .catch((e) => { setRows([]); setError(e?.message || 'Could not load the delivery history.'); })
      .finally(() => setLoading(false));
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  // Registry keys for the template filter (read-only; cheap).
  useEffect(() => {
    adminApi.email.templates()
      .then((d) => setTemplateKeys((Array.isArray(d?.templates) ? d.templates : []).map((t) => t.key)))
      .catch(() => {});
  }, []);

  const setFilter = (k, v) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  const columns = [
    { key: 'createdAt', label: 'Queued', render: (r) => <span title={fmtDateTime(r.createdAt)} style={{ fontFamily: MONO, fontSize: 10.5 }}>{fmtAgo(r.createdAt)}</span> },
    { key: 'templateKey', label: 'Template', render: (r) => <span style={{ fontFamily: MONO, fontSize: 11 }}>{r.templateKey}</span> },
    { key: 'recipient', label: 'Recipient', render: (r) => <span style={{ display: 'block', maxWidth: 220, overflowWrap: 'anywhere' }}>{r.recipient}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge text={deliveryStatusLabel(r.status)} color={STATUS_COLOR[r.status] || C.muted} /> },
    { key: 'renderedSubject', label: 'Subject', render: (r) => <span style={{ display: 'block', maxWidth: 320, color: C.txt }}>{r.renderedSubject || '—'}</span> },
    { key: 'attempts', label: 'Attempts', render: (r) => <span style={{ fontFamily: MONO }}>{r.attempts ?? 0}</span> },
    { key: 'lastError', label: 'Last error', render: (r) => <span style={{ display: 'block', maxWidth: 260, fontSize: 11, color: r.lastError ? C.red : C.muted, overflowWrap: 'anywhere' }}>{r.lastError || '—'}</span> },
    { key: 'sentAt', label: 'Sent', render: (r) => (r.sentAt ? <span title={fmtDateTime(r.sentAt)} style={{ fontSize: 11 }}>{fmtAgo(r.sentAt)}</span> : <span style={{ color: C.muted }}>—</span>) },
  ];

  return (
    <div>
      <NoticeBox tone={C.acc} testId="em-delivery-scope">
        <strong>Delivery metadata only.</strong> Email bodies are never stored — each row keeps the rendered subject,
        status and error text. Variable payloads (which can carry live reset or invite links) are never returned to
        the browser.
      </NoticeBox>

      <SectionCard
        testId="em-delivery"
        title="Email delivery history"
        subtitle="Every EmailOutbox row, newest first. Skips are explicit: a disabled template or missing SMTP is recorded, never silently dropped."
        action={<button data-testid="em-delivery-reload" onClick={load} style={ghostBtn}><Icon name="refresh" size={12} /> Refresh</button>}
      >
        {counts && (
          <div data-testid="em-delivery-counts" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '14px 18px 4px' }}>
            {DELIVERY_STATUSES.map((s) => (
              <Chip key={s} label={deliveryStatusLabel(s)} value={counts[s] ?? 0} color={STATUS_COLOR[s]} testId={`em-delivery-count-${s}`} />
            ))}
          </div>
        )}
        <FilterRow>
          <LabelledField label="Status">
            <select
              data-testid="em-delivery-filter-status"
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value)}
              style={{ ...selectStyle, width: 180 }}
            >
              <option value="">All statuses</option>
              {DELIVERY_STATUSES.map((s) => <option key={s} value={s}>{deliveryStatusLabel(s)}</option>)}
            </select>
          </LabelledField>
          <LabelledField label="Template">
            <select
              data-testid="em-delivery-filter-template"
              value={filters.templateKey}
              onChange={(e) => setFilter('templateKey', e.target.value)}
              style={{ ...selectStyle, width: 200 }}
            >
              <option value="">All templates</option>
              {templateKeys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </LabelledField>
          <LabelledField label="From">
            <input data-testid="em-delivery-filter-from" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} style={{ ...inputStyle, width: 150 }} />
          </LabelledField>
          <LabelledField label="To">
            <input data-testid="em-delivery-filter-to" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} style={{ ...inputStyle, width: 150 }} />
          </LabelledField>
        </FilterRow>
        {error && <div style={{ padding: '14px 18px 0' }}><ErrorBox msg={error} /></div>}
        <Table
          testId="em-delivery-table"
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(r) => r.id}
          emptyMessage="No outbox rows match these filters."
        />
        <Pager testId="em-delivery-pager" page={meta.page} limit={meta.limit} total={meta.total} hasMore={meta.hasMore} onPage={setPage} />
      </SectionCard>
    </div>
  );
}
