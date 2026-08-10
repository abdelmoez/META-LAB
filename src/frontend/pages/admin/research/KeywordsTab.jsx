/**
 * research/KeywordsTab.jsx — 109.md §§11-13 (suggestion governance + the generic
 * stop list) and §§22-24 (the keyword audit trail).
 *
 * Two halves:
 *  1. Catalogue-driven governance settings — what the suggestion engine is allowed
 *     to propose. Nothing here edits a project's keywords; §11 is explicit that Ops
 *     controls system behaviour, not a review's science.
 *  2. The keyword audit feed. Keyword mutations had ZERO audit coverage before this
 *     round; the project ledger now records add / remove / move / accept / reject /
 *     clear-decision, plus separate UNDO and REDO action classes so "keyword
 *     deletion undone" (§22) is a NEW immutable record rather than a mutation of the
 *     deletion record (§50). The feed is paginated + filtered server-side — §24
 *     forbids pulling a whole history into the browser.
 */
import { useCallback, useEffect, useState } from 'react';
import { C, MONO } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';
import { adminApi } from '../adminApiClient.js';
import { OPS_SETTINGS } from '../../../../shared/opsSettingsCatalog.js';
import {
  Badge, ErrorBox, FilterRow, LabelledField, NoticeBox, Pager, SectionCard, Table,
  fmtDateTime, ghostBtn, inputStyle, selectStyle,
} from './primitives.jsx';
import { GovernanceSettings } from './SettingRows.jsx';

const KEYWORD_ENTRIES = OPS_SETTINGS.filter((e) => e.category === 'keywords');

/**
 * The ScreenAuditLog action strings keywordOps writes (mirror of
 * server/screening/keywordAudit.js KEYWORD_AUDIT_ACTIONS + its undo/redo classes).
 * Listed explicitly so the filter names exactly what the server can emit.
 */
const KEYWORD_ACTIONS = [
  { value: 'KEYWORD_ADDED', label: 'Added' },
  { value: 'KEYWORD_REMOVED', label: 'Removed' },
  { value: 'KEYWORD_MOVED', label: 'Moved between lists' },
  { value: 'KEYWORD_SUGGESTION_ACCEPTED', label: 'Suggestion accepted' },
  { value: 'KEYWORD_SUGGESTION_REJECTED', label: 'Suggestion rejected' },
  { value: 'KEYWORD_DECISION_CLEARED', label: 'Suggestion decision cleared' },
  { value: 'KEYWORD_UNDO', label: 'Undone (replayed by history)' },
  { value: 'KEYWORD_REDO', label: 'Redone (replayed by history)' },
];
const KEYWORD_ACTION_SET = new Set(KEYWORD_ACTIONS.map((a) => a.value));

const ACTION_TONE = (a) => {
  if (a === 'KEYWORD_REMOVED' || a === 'KEYWORD_SUGGESTION_REJECTED') return C.red;
  if (a === 'KEYWORD_UNDO' || a === 'KEYWORD_REDO') return C.purp;
  if (a === 'KEYWORD_MOVED' || a === 'KEYWORD_DECISION_CLEARED') return C.ylw;
  return C.grn;
};

const PER_PAGE = 25;

function detailBits(details) {
  let d = details;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return details; } }
  if (!d || typeof d !== 'object') return '—';
  const bits = [];
  if (d.op && d.op !== d.action) bits.push(d.op);
  if (d.term) bits.push(`“${d.term}”`);
  if (d.list) bits.push(d.toList ? `${d.list} → ${d.toList}` : d.list);
  if (d.origin) bits.push(`origin ${d.origin}`);
  if (d.via && d.via !== 'user') bits.push(`via ${d.via}`);
  if (d.reason) bits.push(d.reason);
  return bits.length ? bits.join(' · ') : '—';
}

function KeywordAuditFeed() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PER_PAGE, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ action: '', projectId: '', actorId: '', from: '', to: '' });
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminApi.screening.getAudit({ ...filters, entityType: 'keyword', page, limit: PER_PAGE })
      .then((d) => {
        setRows(Array.isArray(d?.entries) ? d.entries : []);
        setMeta({ total: d?.total || 0, page: d?.page || 1, limit: d?.limit || PER_PAGE, hasMore: !!d?.hasMore });
      })
      .catch((e) => { setRows([]); setError(e?.message || 'Could not load the keyword audit feed.'); })
      .finally(() => setLoading(false));
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (k, v) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };

  const columns = [
    { key: 'createdAt', label: 'When', render: (r) => <span style={{ fontFamily: MONO, fontSize: 10.5 }}>{fmtDateTime(r.createdAt)}</span> },
    { key: 'projectTitle', label: 'Project', render: (r) => <span>{r.projectTitle || <span style={{ fontFamily: MONO, color: C.muted }}>{String(r.projectId || '').slice(0, 8)}</span>}</span> },
    { key: 'actorName', label: 'Actor', render: (r) => <span>{r.actorName || '—'}</span> },
    {
      key: 'action',
      label: 'Action',
      render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
          <Badge text={(KEYWORD_ACTIONS.find((a) => a.value === r.action) || {}).label || r.action} color={ACTION_TONE(r.action)} />
          {!KEYWORD_ACTION_SET.has(r.action) && <span style={{ fontFamily: MONO, fontSize: 10, color: C.muted }}>{r.action}</span>}
        </div>
      ),
    },
    { key: 'entityId', label: 'Keyword', render: (r) => <span style={{ fontFamily: MONO, fontSize: 11 }}>{r.entityId || '—'}</span> },
    { key: 'details', label: 'Details', render: (r) => <span style={{ fontSize: 11 }}>{detailBits(r.details)}</span> },
  ];

  return (
    <SectionCard
      testId="rg-keyword-audit"
      title="Keyword audit trail"
      subtitle="Every keyword mutation recorded in the project ledger. Undo and redo append their own records — the original deletion entry is never removed."
      action={<button data-testid="rg-keyword-audit-reload" onClick={load} style={ghostBtn}><Icon name="refresh" size={12} /> Refresh</button>}
    >
      <FilterRow>
        <LabelledField label="Action">
          <select data-testid="rg-keyword-filter-action" value={filters.action} onChange={(e) => setFilter('action', e.target.value)} style={{ ...selectStyle, width: 250 }}>
            <option value="">All keyword actions</option>
            {KEYWORD_ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </LabelledField>
        <LabelledField label="Project id">
          <input data-testid="rg-keyword-filter-project" value={filters.projectId} placeholder="screening project id" onChange={(e) => setFilter('projectId', e.target.value)} style={{ ...inputStyle, width: 210 }} />
        </LabelledField>
        <LabelledField label="Actor id">
          <input data-testid="rg-keyword-filter-actor" value={filters.actorId} placeholder="user id" onChange={(e) => setFilter('actorId', e.target.value)} style={{ ...inputStyle, width: 180 }} />
        </LabelledField>
        <LabelledField label="From">
          <input data-testid="rg-keyword-filter-from" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} style={{ ...inputStyle, width: 145 }} />
        </LabelledField>
        <LabelledField label="To">
          <input data-testid="rg-keyword-filter-to" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} style={{ ...inputStyle, width: 145 }} />
        </LabelledField>
      </FilterRow>
      {error && <div style={{ padding: '14px 18px 0' }}><ErrorBox msg={error} /></div>}
      <Table
        testId="rg-keyword-audit-table"
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(r) => r.id}
        emptyMessage="No keyword audit entries match these filters."
      />
      <Pager testId="rg-keyword-pager" page={meta.page} limit={meta.limit} total={meta.total} hasMore={meta.hasMore} onPage={setPage} />
    </SectionCard>
  );
}

export default function KeywordsTab({ gov }) {
  return (
    <div>
      <NoticeBox tone={C.acc} testId="rg-keyword-scope-note">
        These settings govern what the suggestion engine may PROPOSE. A generated suggestion is never a keyword until a
        reviewer accepts it, and nothing here reads, writes or deletes a project&rsquo;s keyword lists.
      </NoticeBox>
      <GovernanceSettings
        testId="rg-keyword-settings"
        title="Suggestion behaviour & generic stop list"
        subtitle="Conservative defaults: phrases are preferred over isolated words, ambiguous single words are suppressed, and a concept appearing in both lists is flagged for review rather than silently activated."
        entries={KEYWORD_ENTRIES}
        gov={gov}
      />
      <KeywordAuditFeed />
    </div>
  );
}
