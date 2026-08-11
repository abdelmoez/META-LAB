/**
 * seo/AnalyticsTab.jsx — 113.md item 8, PANEL C.
 *
 * The only stored data in this section: a first-party counter per (UTC day,
 * public path, referrer class). No cookies, no localStorage, no session, no
 * visitor id, no user agent, no IP, no query strings — the beacon posts a path
 * and the raw referrer, the server allowlists the path against the public-page
 * registry, classifies the referrer into one of five labels and throws the raw
 * value away.
 *
 * That coarseness is the design, not a limitation to apologise for: it answers
 * "is anything landing on the new guides, and roughly from where", which is the
 * question a content round actually needs, without holding a profile of anyone.
 *
 * EMPTY STATE IS HONEST. Zero rows means zero recorded views since the beacon
 * shipped — never "no data available", which reads like a broken integration.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { C, MONO } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';
import { adminApi } from '../adminApiClient.js';
import {
  Chip, ErrorBox, LabelledField, NoticeBox, SectionCard, Table, ghostBtn, selectStyle,
} from '../research/primitives.jsx';
import { REFERRER_CLASSES, REFERRER_CLASS_LABELS, REFERRER_CLASS_NOTES, sharePct } from './fields.js';

const WINDOW_OPTIONS = [7, 14, 30, 90];

const CLASS_COLOR = {
  search: C.grn,
  ai: C.purp,
  referral: C.acc,
  internal: C.teal,
  direct: C.muted,
};

/**
 * @param {object} props
 * @param {object} [props.initialData]  pre-resolved analytics payload (SSR tests)
 */
export default function AnalyticsTab({ initialData = null }) {
  const [days, setDays] = useState(initialData?.days || 14);
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminApi.seo.analytics(days)
      .then((d) => setData(d || null))
      .catch((e) => { setData(null); setError(e?.message || 'Could not load landing analytics.'); })
      .finally(() => setLoading(false));
  }, [days]);

  // A pre-resolved payload (SSR pins) suppresses only the FIRST fetch; changing
  // the window still reloads, so the control is never a dead input.
  const seeded = useRef(Boolean(initialData));
  useEffect(() => {
    if (seeded.current) { seeded.current = false; return; }
    load();
  }, [load]);

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const totals = data?.totals || null;
  const grandTotal = data?.grandTotal || 0;

  const columns = [
    {
      key: 'path',
      label: 'Landing path',
      render: (r) => <span style={{ fontFamily: MONO, fontSize: 11, color: C.txt }}>{r.path}</span>,
    },
    ...REFERRER_CLASSES.map((cls) => ({
      key: cls,
      label: REFERRER_CLASS_LABELS[cls],
      render: (r) => <span style={{ fontFamily: MONO, color: (r.classes?.[cls] || 0) > 0 ? C.txt2 : C.muted }}>{r.classes?.[cls] || 0}</span>,
    })),
    {
      key: 'total',
      label: 'Total',
      render: (r) => <span style={{ fontFamily: MONO, fontWeight: 700, color: C.txt }}>{r.total}</span>,
    },
  ];

  // The totals row is appended as real markup below the table rather than faked
  // as a data row — a "TOTAL" path in a path column would be a lie in a cell.
  return (
    <div>
      <NoticeBox tone={C.teal} testId="seo-analytics-scope">
        <strong>First-party aggregate counters.</strong> One row per UTC day, public path and referrer class. No cookies, no
        localStorage, no visitor or session identifier, no IP, no user agent, no query strings, and the raw referrer is
        classified server-side and discarded. Only paths in the public-page registry are counted; anything else is dropped.
      </NoticeBox>

      <SectionCard
        testId="seo-analytics"
        title="Landing page views"
        subtitle={data?.from ? `${data.from} → ${data.to} (UTC days, inclusive).` : 'Recent public page views by landing path.'}
        action={<button data-testid="seo-analytics-reload" onClick={load} style={ghostBtn}><Icon name="refresh" size={12} /> Refresh</button>}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, padding: '12px 18px', borderBottom: `1px solid ${C.brd}` }}>
          <LabelledField label="Window">
            <select
              data-testid="seo-analytics-window"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              style={{ ...selectStyle, width: 150 }}
            >
              {WINDOW_OPTIONS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
            </select>
          </LabelledField>
        </div>

        {totals && (
          <div data-testid="seo-analytics-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '14px 18px 4px' }}>
            {REFERRER_CLASSES.map((cls) => (
              <Chip
                key={cls}
                label={`${REFERRER_CLASS_LABELS[cls]} · ${sharePct(totals[cls], grandTotal)}`}
                value={totals[cls] || 0}
                color={CLASS_COLOR[cls]}
                testId={`seo-analytics-total-${cls}`}
              />
            ))}
            <Chip label="all views" value={grandTotal} color={C.acc} testId="seo-analytics-grand-total" />
          </div>
        )}

        {error && <div style={{ padding: '14px 18px 0' }}><ErrorBox msg={error} /></div>}
        {data && data.available === false && (
          <div style={{ padding: '14px 18px 0' }}>
            <ErrorBox msg={`The counter table could not be read: ${data.error || 'query failed'}`} />
          </div>
        )}

        <Table
          testId="seo-analytics-table"
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(r) => r.path}
          emptyMessage="No data yet — the beacon has only been live since this deploy, and nothing has been recorded in this window."
        />

        {rows.length > 0 && totals && (
          <div data-testid="seo-analytics-totals-row" style={{ display: 'flex', gap: 18, padding: '11px 18px', borderTop: `1px solid ${C.brd}`, fontFamily: MONO, fontSize: 11, color: C.txt2, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: C.txt }}>All paths</span>
            {REFERRER_CLASSES.map((cls) => (
              <span key={cls}>{REFERRER_CLASS_LABELS[cls]} {totals[cls] || 0}</span>
            ))}
            <span style={{ fontWeight: 700, color: C.txt }}>Total {grandTotal}</span>
          </div>
        )}
      </SectionCard>

      <SectionCard testId="seo-analytics-legend" title="What the classes mean">
        <div style={{ padding: '12px 18px', fontSize: 11.5, color: C.muted, lineHeight: 1.8 }}>
          {REFERRER_CLASSES.map((cls) => (
            <div key={cls}>
              <span style={{ color: CLASS_COLOR[cls], fontFamily: MONO, fontWeight: 700 }}>{REFERRER_CLASS_LABELS[cls]}</span>
              {' — '}{REFERRER_CLASS_NOTES[cls]}
            </div>
          ))}
          <div style={{ marginTop: 10, color: C.txt2 }}>
            Coverage note: the beacon fires from the shared public page frame, which every content page uses. Pages that
            render their own frame — the landing page, the legal page, and the sign-in and registration screens — are not
            counted, so their rows stay empty rather than showing an undercount.
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
