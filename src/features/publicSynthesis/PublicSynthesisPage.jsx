/**
 * features/publicSynthesis/PublicSynthesisPage.jsx — 68.md (P8). The PUBLIC page.
 * Also serves the embed (?embed=1 / /embed/synthesis/:token) and the in-app preview
 * modal (given a `payload` prop instead of a token).
 *
 * Fully self-contained: a public visitor has NO auth/theme context, so every style
 * is plain and inline (white background, dark text, PecanRev purple accent). It does
 * not import any workspace component. When a `payload` prop is supplied (preview /
 * test), it renders that object DIRECTLY and never touches the network; otherwise it
 * fetches GET /api/public/synthesis/:token once on mount.
 *
 * Everything it shows comes from the frozen, server-sanitized version payload — the
 * server already stripped every private field at the publish boundary.
 */
import { useEffect, useState, useMemo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import InteractiveForest from './InteractiveForest.jsx';
import { fetchPublicSynthesis, publicUrls } from './publicSynthesisApi.js';

const ACCENT = '#6d28d9';
const ACCENT_DK = '#4c1d95';
const INK = '#1a1e2e';
const MUTE = '#5b6178';
const LINE = '#e2e4ee';
const BG = '#ffffff';
const SOFT = '#f7f7fb';

const page = {
  fontFamily: 'Inter, -apple-system, "Segoe UI", Roboto, system-ui, sans-serif',
  color: INK, background: BG, minHeight: '100vh',
  WebkitFontSmoothing: 'antialiased',
};
const wrap = { maxWidth: 880, margin: '0 auto', padding: '32px 24px 64px' };
const card = { border: `1px solid ${LINE}`, borderRadius: 12, padding: 18, background: BG, marginBottom: 18 };
const h2 = { fontSize: 17, fontWeight: 700, margin: '0 0 12px', color: INK, letterSpacing: '-0.01em' };
const sectionLabel = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: ACCENT, marginBottom: 8 };

/* Print CSS: white bg, hide interactive chrome. */
const PRINT_CSS = `
@media print {
  html, body { background: #fff !important; }
  .ps-noprint { display: none !important; }
  .ps-card { break-inside: avoid; box-shadow: none !important; }
  a[href]:after { content: ""; }
}
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
`;

function useEmbed() {
  const location = useLocation();
  return useMemo(() => {
    try {
      const q = new URLSearchParams(location.search);
      return q.get('embed') === '1';
    } catch { return false; }
  }, [location.search]);
}

export default function PublicSynthesisPage({ payload: payloadProp = null, embed: embedProp = false }) {
  const params = useParams();
  const token = params && params.token;
  const embedFromUrl = useEmbed();
  const embed = embedProp || embedFromUrl;

  // Preview / test mode: render the provided payload synchronously (no network).
  const preview = payloadProp != null;
  const [state, setState] = useState(
    preview
      ? { loading: false, error: null, data: { payload: payloadProp, version: payloadProp.version, publishedAt: null, settings: { showBranding: true, allowDownload: false, embedEnabled: false } } }
      : { loading: true, error: null, data: null },
  );

  useEffect(() => {
    if (preview || !token) return;
    let alive = true;
    const ctrl = new AbortController();
    (async () => {
      try {
        const data = await fetchPublicSynthesis(token, { signal: ctrl.signal });
        if (alive) setState({ loading: false, error: null, data });
      } catch (e) {
        if (alive && e.name !== 'AbortError') setState({ loading: false, error: e, data: null });
      }
    })();
    return () => { alive = false; ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, preview]);

  if (state.loading) {
    return (
      <div style={page}><div style={wrap}>
        <div style={{ color: MUTE, fontSize: 14 }}>Loading published synthesis…</div>
      </div></div>
    );
  }
  if (state.error || !state.data) {
    return (
      <div style={page}><div style={{ ...wrap, textAlign: 'center', paddingTop: 80 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🔒</div>
        <h1 style={{ fontSize: 22, margin: '0 0 8px', color: INK }}>This synthesis is not available</h1>
        <p style={{ color: MUTE, fontSize: 14 }}>The link may have been unpublished or replaced.</p>
      </div></div>
    );
  }

  const { payload, version, publishedAt, settings } = state.data;
  const sec = (payload && payload.sections) || {};
  const showBranding = settings ? settings.showBranding !== false : true;
  const allowDownload = settings ? settings.allowDownload === true : false;
  const cards = (payload.dashboard && Array.isArray(payload.dashboard.cards)) ? payload.dashboard.cards : [];

  return (
    <div style={page}>
      <style>{PRINT_CSS}</style>
      <div style={embed ? { ...wrap, padding: '18px 16px 32px', maxWidth: '100%' } : wrap}>

        {/* Header */}
        <header style={{ marginBottom: 22, borderBottom: `2px solid ${LINE}`, paddingBottom: 16 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: INK, letterSpacing: '-0.02em' }}>
            {payload.title || 'Systematic review'}
          </h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 8, fontSize: 12.5, color: MUTE }}>
            {showBranding && (
              <span>
                Published from{' '}
                <a href="https://pecanrev.com" style={{ color: ACCENT, fontWeight: 700, textDecoration: 'none' }}
                  target="_blank" rel="noopener noreferrer">PecanRev</a>
              </span>
            )}
            {version != null && <span>· Version {version}</span>}
            {publishedAt && <span>· Published {fmtDate(publishedAt)}</span>}
          </div>
        </header>

        {/* Summary */}
        {payload.summary && (
          <div className="ps-card" style={card}>
            <div style={sectionLabel}>Summary</div>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: INK, whiteSpace: 'pre-wrap' }}>{payload.summary}</p>
          </div>
        )}

        {/* Dashboard-composed extra text cards (summaryText / keyFindings / note) first,
            respecting the composer order when present. */}
        {cards.filter((c) => ['summaryText', 'keyFindings', 'note'].includes(c.type) && c.title).map((c) => (
          <div key={c.id} className="ps-card" style={card}>
            <div style={sectionLabel}>{c.type === 'keyFindings' ? 'Key findings' : (c.type === 'note' ? 'Note' : 'Summary')}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{c.title}</div>
          </div>
        ))}

        {/* Methods / PICO */}
        {payload.pico && sec.methods !== false && (
          <div className="ps-card" style={card}>
            <h2 style={h2}>Review question &amp; methods</h2>
            {payload.pico.question && (
              <p style={{ margin: '0 0 12px', fontSize: 14.5, lineHeight: 1.6, color: INK }}>{payload.pico.question}</p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: 6, columnGap: 14, fontSize: 13.5 }}>
              {[['Population', payload.pico.population], ['Intervention', payload.pico.intervention],
                ['Comparator', payload.pico.comparator], ['Outcome', payload.pico.outcome]]
                .filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <span style={{ color: MUTE, fontWeight: 600 }}>{k}</span>
                    <span style={{ color: INK }}>{v}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* PRISMA counts row */}
        {payload.prisma && (
          <div className="ps-card" style={card}>
            <h2 style={h2}>PRISMA flow</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {[
                ['Records identified', payload.prisma.identified],
                ['Duplicates removed', payload.prisma.duplicatesRemoved],
                ['Screened', payload.prisma.screened],
                ['Full-text assessed', payload.prisma.fullTextAssessed],
                ['Studies included', payload.prisma.included],
              ].filter(([, v]) => v != null).map(([k, v]) => (
                <div key={k} style={{
                  flex: '1 1 120px', minWidth: 110, background: SOFT, border: `1px solid ${LINE}`,
                  borderRadius: 10, padding: '12px 14px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: ACCENT_DK, fontFamily: 'ui-monospace, monospace' }}>{v}</div>
                  <div style={{ fontSize: 11.5, color: MUTE, marginTop: 3 }}>{k}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Forest plots — one per pooled outcome */}
        {Array.isArray(payload.ma) && payload.ma.length > 0 && (
          <div className="ps-card" style={card}>
            <h2 style={h2}>Meta-analysis</h2>
            {payload.ma.map((outcome, i) => (
              <div key={i} style={{ marginBottom: i < payload.ma.length - 1 ? 26 : 0, paddingBottom: i < payload.ma.length - 1 ? 20 : 0, borderBottom: i < payload.ma.length - 1 ? `1px solid ${LINE}` : 'none' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 4 }}>
                  {outcome.outcome || 'Primary outcome'}
                  {outcome.timepoint ? <span style={{ color: MUTE, fontWeight: 500 }}> · {outcome.timepoint}</span> : null}
                </div>
                <InteractiveForest outcome={outcome} />
              </div>
            ))}
          </div>
        )}

        {/* Included studies (sortable by year) */}
        {Array.isArray(payload.includedStudies) && payload.includedStudies.length > 0 && (
          <IncludedStudiesTable studies={payload.includedStudies} />
        )}

        {/* RoB distribution */}
        {payload.rob && <RobBar rob={payload.rob} />}

        {/* Year histogram */}
        {Array.isArray(payload.yearHistogram) && payload.yearHistogram.length > 0 && (
          <YearHistogram data={payload.yearHistogram} />
        )}

        {/* Downloads */}
        {allowDownload && token && (
          <div className="ps-card ps-noprint" style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: MUTE, fontWeight: 600 }}>Download data:</span>
            <a href={publicUrls.exportJson(token)} style={dlBtn}>JSON</a>
            <a href={publicUrls.exportCsv(token)} style={dlBtn}>CSV</a>
          </div>
        )}

        {/* Footer */}
        <footer style={{ marginTop: 26, paddingTop: 14, borderTop: `1px solid ${LINE}`, fontSize: 12, color: MUTE, textAlign: 'center' }}>
          This is a read-only published snapshot{version != null ? ` — version ${version}` : ''}.
        </footer>
      </div>
    </div>
  );
}

const dlBtn = {
  display: 'inline-block', padding: '6px 14px', borderRadius: 8,
  border: `1px solid ${ACCENT}`, color: ACCENT, fontSize: 13, fontWeight: 600,
  textDecoration: 'none', background: '#fff',
};

/* ── Included studies table (sortable by year) ────────────────────────────── */
function IncludedStudiesTable({ studies }) {
  const [asc, setAsc] = useState(true);
  const sorted = useMemo(() => {
    const arr = studies.slice();
    arr.sort((a, b) => {
      const ya = Number.isFinite(a.year) ? a.year : (asc ? Infinity : -Infinity);
      const yb = Number.isFinite(b.year) ? b.year : (asc ? Infinity : -Infinity);
      return asc ? ya - yb : yb - ya;
    });
    return arr;
  }, [studies, asc]);
  return (
    <div className="ps-card" style={card}>
      <h2 style={h2}>Included studies ({studies.length})</h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Study</th>
              <th style={{ ...th, cursor: 'pointer', userSelect: 'none' }} className="ps-noprint"
                onClick={() => setAsc((v) => !v)} title="Sort by year">
                Year {asc ? '▲' : '▼'}
              </th>
              <th style={th}>Journal</th>
              <th style={th}>DOI</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                <td style={td}>{s.author || '—'}{s.title ? <div style={{ color: MUTE, fontSize: 12, marginTop: 2 }}>{s.title}</div> : null}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>{Number.isFinite(s.year) ? s.year : '—'}</td>
                <td style={td}>{s.journal || '—'}</td>
                <td style={td}>{s.doi
                  ? <a href={`https://doi.org/${s.doi}`} style={{ color: ACCENT, textDecoration: 'none' }} target="_blank" rel="noopener noreferrer">{s.doi}</a>
                  : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, color: MUTE, letterSpacing: '0.03em', textTransform: 'uppercase' };
const td = { padding: '8px 10px', color: INK, verticalAlign: 'top' };

/* ── RoB distribution stacked bar ─────────────────────────────────────────── */
function RobBar({ rob }) {
  const total = rob.total || (rob.low + rob.some + rob.high) || 1;
  const segs = [
    { key: 'low', label: 'Low', n: rob.low || 0, color: '#16a34a' },
    { key: 'some', label: 'Some concerns', n: rob.some || 0, color: '#d97706' },
    { key: 'high', label: 'High', n: rob.high || 0, color: '#dc2626' },
  ];
  return (
    <div className="ps-card" style={card}>
      <h2 style={h2}>Risk of bias</h2>
      <div style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', border: `1px solid ${LINE}` }}>
        {segs.filter((s) => s.n > 0).map((s) => (
          <div key={s.key} title={`${s.label}: ${s.n}`}
            style={{ width: `${(s.n / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 10, fontSize: 12.5, color: MUTE }}>
        {segs.map((s) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 11, height: 11, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            {s.label}: <strong style={{ color: INK }}>{s.n}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Year histogram bar chart with tooltips ───────────────────────────────── */
function YearHistogram({ data }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.count || 0));
  return (
    <div className="ps-card" style={card}>
      <h2 style={h2}>Publication years</h2>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120, position: 'relative' }}>
        {data.map((d, i) => (
          <div key={i}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            title={`${d.year}: ${d.count} stud${d.count === 1 ? 'y' : 'ies'}`}
            style={{ flex: 1, minWidth: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', cursor: 'default' }}>
            <div style={{
              width: '100%', height: `${((d.count || 0) / max) * 100}%`, minHeight: 2,
              background: hover === i ? ACCENT_DK : ACCENT, borderRadius: '3px 3px 0 0', transition: 'background 0.12s',
            }} />
            <div style={{ fontSize: 9.5, color: MUTE, marginTop: 4, transform: 'rotate(-45deg)', transformOrigin: 'center', whiteSpace: 'nowrap' }}>{d.year}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return ''; }
}
