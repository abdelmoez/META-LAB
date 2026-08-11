/**
 * seo/SeoSection.jsx — 113.md item 8 — the Ops › SEO section shell.
 *
 * THE POINT OF THIS SECTION: in the 111 round the repository was correct and
 * production was broken, and nothing in the product could tell the difference.
 * dist/__prerender/ held a fully rendered document for every public page; nginx
 * served the app shell for every URL; crawlers saw an empty <div id="root"> on
 * the homepage and on every feature page, with the homepage's title on all of
 * them. So the section is built around one rule:
 *
 *   REPOSITORY VALIDATION and EXTERNALLY OBSERVED are separate tabs, and no
 *   number ever crosses between them. Tab 1 is a measurement of this machine
 *   and can be trusted. Tab 2 is a measurement of the internet, is taken only
 *   when an operator asks for it, is never cached as truth, and reports its own
 *   failures verbatim.
 *
 * Tab 3 (Landing analytics) is the only stored data, and it is first-party and
 * coarse by construction: one counter per (UTC day, path, referrer class).
 *
 * Extracted package (the research/ + email/ precedent): AdminConsole.jsx mounts
 * exactly this default export for the `seo` section id, and the package is
 * SSR-testable in isolation. LEGACY DESIGN ONLY — /ops never renders Stitch.
 *
 * KEEP IN LOCKSTEP (tests/unit/opsSectionSync.test.js): the `seo` id lives in
 * server getConsole, NAV_SECTIONS, AdminConsole's sections map and
 * OpsPage.OPS_SECTION_IDS. The <h2> below is what OpsPage.HEADINGS matches.
 */
import { useCallback, useEffect, useState } from 'react';
import { C } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';
import { adminApi } from '../adminApiClient.js';
import { ErrorBox, SubTabs, ghostBtn } from '../research/primitives.jsx';
import { SEO_TABS } from './fields.js';
import RepositoryTab from './RepositoryTab.jsx';
import LiveCheckTab from './LiveCheckTab.jsx';
import AnalyticsTab from './AnalyticsTab.jsx';

export { SEO_TABS };

/**
 * @param {object} props
 * @param {object} [props.initialStatus]  pre-resolved status payload (SSR tests)
 */
export default function SeoSection({ initialStatus = null }) {
  const [tab, setTab] = useState('repository');
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(!initialStatus);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    adminApi.seo.status()
      .then((d) => setStatus(d || null))
      .catch((e) => { setStatus(null); setError(e?.message || 'Could not load the SEO repository status.'); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (!initialStatus) load(); }, [initialStatus, load]);

  const panels = {
    repository: <RepositoryTab status={status} loading={loading} onReload={load} />,
    live: <LiveCheckTab status={status} />,
    analytics: <AnalyticsTab />,
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: C.txt, margin: 0, letterSpacing: '-0.02em' }}>SEO</h2>
          <p style={{ fontSize: 13, color: C.txt2, marginTop: 6, marginBottom: 0, maxWidth: 880, lineHeight: 1.6 }}>
            Discoverability of the public website, read-only. <strong>Repository validation</strong> is computed here from
            the public-page registry and the build output — it says whether what we built is correct.{' '}
            <strong>Externally observed</strong> fetches the live origin on demand and says whether that build is actually
            being served. The two are never combined, and nothing on this page reports a ranking, an impression or an index
            status: we hold no Search Console credentials and will not invent the numbers.
          </p>
        </div>
        <button data-testid="seo-reload" onClick={load} style={ghostBtn}>
          <Icon name="refresh" size={12} /> Refresh
        </button>
      </div>

      <ErrorBox msg={error} />

      <SubTabs tabs={SEO_TABS} active={tab} onSelect={setTab} testIdPrefix="seo-tab" />
      {panels[tab]}
    </div>
  );
}
