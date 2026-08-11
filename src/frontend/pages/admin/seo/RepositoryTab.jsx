/**
 * seo/RepositoryTab.jsx — 113.md item 8, PANEL A.
 *
 * Everything here is computed server-side, at request time, from two sources
 * that exist on this machine: the public-page registry (src/frontend/website/
 * publicPages.js — code) and the build output in dist/. Nothing on this tab is
 * an estimate, a projection or an external observation, which is exactly why it
 * is a separate tab from the live check.
 *
 * The build-artefact rows deliberately say what they DO NOT prove: a green
 * "prerender present" means the files were generated, not that a crawler ever
 * receives them. That distinction is the whole reason this console exists.
 */
import { C, MONO } from '../../../theme/tokens.js';
import {
  Badge, Chip, NoticeBox, SectionCard, Table, fmtDateTime,
} from '../research/primitives.jsx';
import { CHECK_STATUS_LABEL } from './fields.js';

const STATUS_COLOR = { pass: C.grn, fail: C.red, unknown: C.muted };

function CheckRow({ check, last }) {
  const color = STATUS_COLOR[check.status] || C.muted;
  return (
    <div
      data-testid={`seo-check-${check.id}`}
      style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 18, padding: '12px 18px', borderBottom: last ? 'none' : `1px solid ${C.brd}`,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: C.txt, fontWeight: 600 }}>{check.label}</div>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, lineHeight: 1.6, maxWidth: 680 }}>{check.detail}</div>
        {Array.isArray(check.offenders) && check.offenders.length > 0 && (
          <ul style={{ margin: '6px 0 0', padding: '0 0 0 16px', fontFamily: MONO, fontSize: 10.5, color: C.red, lineHeight: 1.7 }}>
            {check.offenders.map((o) => <li key={o}>{o}</li>)}
          </ul>
        )}
      </div>
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        <Badge text={CHECK_STATUS_LABEL[check.status] || check.status} color={color} testId={`seo-check-badge-${check.id}`} />
      </div>
    </div>
  );
}

export default function RepositoryTab({ status, loading }) {
  const counts = status?.counts || null;
  const checks = Array.isArray(status?.checks) ? status.checks : [];
  const artifacts = status?.artifacts || null;
  const inventory = Array.isArray(status?.inventory) ? status.inventory : [];

  const columns = [
    {
      key: 'path',
      label: 'Path',
      render: (r) => <span style={{ fontFamily: MONO, fontSize: 11, color: C.txt }}>{r.path}</span>,
    },
    {
      key: 'title',
      label: 'Title',
      render: (r) => <span style={{ display: 'block', maxWidth: 330 }}>{r.title}</span>,
    },
    {
      key: 'descriptionLength',
      label: 'Desc',
      render: (r) => (
        <span style={{ fontFamily: MONO, color: r.descriptionLength >= 110 && r.descriptionLength <= 165 ? C.txt2 : C.red }}>
          {r.descriptionLength}
        </span>
      ),
    },
    {
      key: 'indexable',
      label: 'Indexable',
      render: (r) => <Badge text={r.indexable ? 'index' : 'noindex'} color={r.indexable ? C.grn : C.muted} />,
    },
    {
      key: 'inSitemap',
      label: 'Sitemap',
      render: (r) => <Badge text={r.inSitemap ? 'listed' : 'excluded'} color={r.inSitemap ? C.acc : C.ylw} />,
    },
    {
      key: 'hasJsonLd',
      label: 'JSON-LD',
      render: (r) => <span style={{ fontFamily: MONO, color: r.hasJsonLd ? C.grn : C.muted }}>{r.hasJsonLd ? 'yes' : 'no'}</span>,
    },
    {
      key: 'component',
      label: 'Component',
      render: (r) => (
        <span style={{ fontFamily: MONO, fontSize: 10, color: r.componentExists === false ? C.red : C.muted, display: 'block', maxWidth: 300, overflowWrap: 'anywhere' }}>
          {r.component}{r.componentExists === false ? ' (missing)' : ''}
        </span>
      ),
    },
  ];

  return (
    <div>
      <NoticeBox tone={C.acc} testId="seo-repository-scope">
        <strong>Repository validation.</strong> Computed on this server from the public-page registry and the files in{' '}
        <code>dist/</code> at the moment you loaded this page. It proves what was BUILT — not what the web server hands to a
        crawler. For that, use the Externally observed tab.
      </NoticeBox>

      <SectionCard
        testId="seo-counts"
        title="Public route inventory"
        subtitle={status?.generatedAt ? `Computed ${fmtDateTime(status.generatedAt)} · canonical origin ${status.origin}` : 'Loading…'}
      >
        {counts && (
          <div data-testid="seo-count-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '14px 18px' }}>
            <Chip label="public pages" value={counts.total} color={C.acc} testId="seo-count-total" />
            <Chip label="indexable" value={counts.indexable} color={C.grn} testId="seo-count-indexable" />
            <Chip label="noindex" value={counts.noindex} color={C.muted} testId="seo-count-noindex" />
            <Chip label="in sitemap" value={counts.inSitemap} color={C.teal} testId="seo-count-sitemap" />
            <Chip label="sitemap-excluded" value={counts.sitemapExcluded} color={C.ylw} testId="seo-count-excluded" />
            <Chip label="with JSON-LD" value={counts.withJsonLd} color={C.purp} testId="seo-count-jsonld" />
          </div>
        )}
      </SectionCard>

      <SectionCard
        testId="seo-checks"
        title="Checks"
        subtitle="Registry invariants and build artefacts. Every one of these is also enforced by the test suite; this view exists so an operator can confirm the deployed build without running it."
      >
        {loading && <div style={{ padding: '20px 18px', fontSize: 12, color: C.muted }}>Loading checks…</div>}
        {!loading && checks.length === 0 && (
          <div style={{ padding: '20px 18px', fontSize: 12, color: C.muted }}>No checks were returned.</div>
        )}
        {checks.map((c, i) => <CheckRow key={c.id} check={c} last={i === checks.length - 1} />)}
      </SectionCard>

      {artifacts && (
        <SectionCard
          testId="seo-artifacts"
          title="Build artefacts on disk"
          subtitle="The files a crawler reads before it reads a page, plus the prerendered documents. Presence here says the build ran — it says nothing about how the web server routes URLs."
        >
          <div style={{ padding: '14px 18px', fontSize: 12, color: C.txt2, lineHeight: 1.9, fontFamily: MONO }}>
            <div data-testid="seo-artifact-prerender">
              dist/__prerender: {artifacts.prerender.present ? `${artifacts.prerender.pageCount} page(s)` : 'absent'}
              {artifacts.prerender.generatedAt ? ` · last generated ${fmtDateTime(artifacts.prerender.generatedAt)}` : ''}
            </div>
            <div data-testid="seo-artifact-sitemap">
              dist/sitemap.xml: {artifacts.sitemap.present ? `${artifacts.sitemap.urlCount} URL(s)` : 'absent'}
            </div>
            <div data-testid="seo-artifact-robots">
              dist/robots.txt: {artifacts.robots.present ? (artifacts.robots.hasSitemapLine ? 'present · Sitemap: line found' : 'present · no Sitemap: line') : 'absent'}
            </div>
            <div data-testid="seo-artifact-llms">
              dist/llms.txt: {artifacts.llms.present ? `${artifacts.llms.pageLinkCount} page link(s)` : 'absent'}
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard
        testId="seo-inventory"
        title="Every public route"
        subtitle="One row per registry entry. Description length is bounded 110–165 characters so the SERP snippet is never truncated."
      >
        <Table
          testId="seo-inventory-table"
          columns={columns}
          rows={inventory}
          loading={loading}
          rowKey={(r) => r.path}
          emptyMessage="The registry returned no entries."
        />
      </SectionCard>
    </div>
  );
}
