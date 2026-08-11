/**
 * seo/LiveCheckTab.jsx — 113.md item 8, PANEL B.
 *
 * THE FAILURE THIS TAB EXISTS TO CATCH. The 111 round built a correct
 * prerendered document for every public page and production served the bare
 * app shell for every URL: same title on every route, no meta description, no
 * body text, no JSON-LD, no <h1>. The repository looked perfect the whole time.
 * So on request — never on a timer, never cached — the server fetches the real
 * public origin and reports three signals per page: does the served <title>
 * match the registry title for THAT path, is there an <h1>, and is there a
 * JSON-LD "@type" marker. All three present means the prerendered document was
 * served. None present means a crawler is getting an empty shell.
 *
 * HONESTY RULES:
 *   - This is an OBSERVATION, stamped with the moment it was taken. It is never
 *     merged into the repository panel and never persisted as a status.
 *   - A failed fetch prints the error text. It does not become "unknown", and it
 *     certainly does not become a pass.
 *   - Search Console / Bing Webmaster state is NOT fetched, because we hold no
 *     credentials for either. The only thing a repository can honestly report is
 *     whether a verification token is committed to it.
 */
import { useState } from 'react';
import { C, MONO } from '../../../theme/tokens.js';
import Icon from '../../../components/icons.jsx';
import { adminApi } from '../adminApiClient.js';
import {
  Badge, ErrorBox, NoticeBox, SectionCard, Spinner, accentBtn,
} from '../research/primitives.jsx';
import {
  LIVE_TARGET_LABEL, SERVING_VERDICT_LABEL, VERIFICATION_STATE_LABEL, servingVerdict, servingNote,
} from './fields.js';

const VERDICT_COLOR = {
  prerendered: C.grn,
  partial: C.ylw,
  shell: C.red,
  'http-error': C.red,
  unreachable: C.muted,
};

const signal = (label, ok) => (
  <span style={{ fontFamily: MONO, fontSize: 10.5, color: ok ? C.grn : C.red, marginRight: 12 }}>
    {ok ? '✓' : '✗'} {label}
  </span>
);

function PageResult({ result }) {
  const verdict = servingVerdict(result);
  const note = servingNote(result);
  return (
    <div data-testid={`seo-live-${result.id}`} style={{ padding: '13px 18px', borderBottom: `1px solid ${C.brd}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.txt }}>
          {LIVE_TARGET_LABEL[result.id] || result.id} · {result.path}
        </div>
        <Badge
          text={SERVING_VERDICT_LABEL[verdict]}
          color={VERDICT_COLOR[verdict] || C.muted}
          testId={`seo-live-verdict-${result.id}`}
        />
      </div>

      {result.ok === false ? (
        <div style={{ fontSize: 11.5, color: C.red, marginTop: 7, fontFamily: MONO, overflowWrap: 'anywhere' }}>
          {result.error}
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 6 }}>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, marginRight: 12 }}>HTTP {result.status}</span>
            {signal('page title matches registry', result.titleMatches)}
            {signal('<h1> present', result.h1Present)}
            {signal('JSON-LD present', result.jsonLdPresent)}
          </div>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.65, overflowWrap: 'anywhere' }}>
            <div>served &lt;title&gt;: <span style={{ fontFamily: MONO, color: C.txt2 }}>{result.servedTitle || '(none)'}</span></div>
            <div>expected: <span style={{ fontFamily: MONO, color: C.txt2 }}>{result.expectedTitle || '(none)'}</span></div>
          </div>
          {note && (
            <div
              data-testid={`seo-live-note-${result.id}`}
              style={{ marginTop: 7, fontSize: 11, color: C.ylw, lineHeight: 1.65, maxWidth: 720 }}
            >
              {note}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileResult({ result }) {
  return (
    <div data-testid={`seo-live-${result.id}`} style={{ padding: '13px 18px', borderBottom: `1px solid ${C.brd}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.txt }}>
          {LIVE_TARGET_LABEL[result.id] || result.id} · {result.path}
        </div>
        {result.ok === false
          ? <Badge text="Unreachable" color={C.muted} testId={`seo-live-verdict-${result.id}`} />
          : <Badge text={`HTTP ${result.status}`} color={result.status >= 400 ? C.red : C.grn} testId={`seo-live-verdict-${result.id}`} />}
      </div>
      {result.ok === false ? (
        <div style={{ fontSize: 11.5, color: C.red, marginTop: 7, fontFamily: MONO, overflowWrap: 'anywhere' }}>{result.error}</div>
      ) : (
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, marginTop: 7 }}>
          {result.kind === 'sitemap'
            ? `${result.urlCount} <loc> URL(s) served`
            : `${result.hasUserAgentLine ? '✓' : '✗'} User-agent line · ${result.hasSitemapLine ? '✓' : '✗'} Sitemap line`}
        </div>
      )}
    </div>
  );
}

export default function LiveCheckTab({ status }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const verification = status?.verification || null;
  const baseUrl = report?.baseUrl || status?.baseUrl || null;

  function run() {
    setBusy(true);
    setError('');
    adminApi.seo.liveCheck()
      .then((d) => setReport(d || null))
      .catch((e) => { setReport(null); setError(e?.message || 'The live check could not be run.'); })
      .finally(() => setBusy(false));
  }

  const results = Array.isArray(report?.results) ? report.results : [];

  return (
    <div>
      <NoticeBox tone={C.ylw} testId="seo-live-scope">
        <strong>Externally observed — not repository truth.</strong> This fetches the live public origin over the network
        and reports exactly what came back at that moment. Nothing here is stored or cached, and a failure is printed as the
        error it was. Its one job is to detect the failure the repository cannot see: prerendered HTML that exists in the
        build but is never served, so every crawler receives an empty application shell.
      </NoticeBox>

      <SectionCard
        testId="seo-live"
        title="Live serving self-check"
        subtitle={baseUrl ? `Target origin ${baseUrl} (PUBLIC_BASE_URL). Homepage, one feature page, sitemap.xml and robots.txt, 8s per request.` : 'Target origin comes from PUBLIC_BASE_URL.'}
        action={(
          <button data-testid="seo-live-run" onClick={run} disabled={busy} style={{ ...accentBtn, opacity: busy ? 0.6 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? <Spinner size={12} color={C.accText} /> : <Icon name="globe" size={12} />}
            {busy ? 'Checking…' : 'Run live check'}
          </button>
        )}
      >
        {error && <div style={{ padding: '14px 18px 0' }}><ErrorBox msg={error} /></div>}

        {!report && !busy && !error && (
          <div data-testid="seo-live-idle" style={{ padding: '22px 18px', fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
            No check has been run in this session. Nothing is shown until you ask for it — a stale observation of a live site
            is worse than none.
          </div>
        )}

        {report && (
          <div data-testid="seo-live-results">
            <div style={{ padding: '10px 18px', fontSize: 11, color: C.muted, fontFamily: MONO, borderBottom: `1px solid ${C.brd}` }}>
              Observed {new Date(report.checkedAt).toLocaleString()} · {report.baseUrl}
            </div>
            {results.map((r) => (r.kind === 'page'
              ? <PageResult key={r.id} result={r} />
              : <FileResult key={r.id} result={r} />))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        testId="seo-verification"
        title="Search Console & Bing Webmaster"
        subtitle="Ownership verification and coverage data live in accounts we hold no API credentials for."
      >
        <div style={{ padding: '14px 18px', fontSize: 12, color: C.txt2, lineHeight: 1.8 }}>
          <div data-testid="seo-verification-google" style={{ fontFamily: MONO, fontSize: 11.5 }}>
            Google Search Console: {VERIFICATION_STATE_LABEL[verification?.google?.state] || 'Not configured'}
            {verification?.google?.via ? ` (${verification.google.via})` : ''}
          </div>
          <div data-testid="seo-verification-bing" style={{ fontFamily: MONO, fontSize: 11.5 }}>
            Bing Webmaster Tools: {VERIFICATION_STATE_LABEL[verification?.bing?.state] || 'Not configured'}
            {verification?.bing?.via ? ` (${verification.bing.via})` : ''}
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: C.muted, maxWidth: 700 }}>
            {verification?.note
              || 'PecanRev holds no Search Console or Bing Webmaster API credentials, so coverage, impressions and index '
                + 'status cannot be shown here. This reports only whether a verification token exists in the repository.'}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
