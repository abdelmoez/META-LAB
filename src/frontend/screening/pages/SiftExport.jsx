/**
 * SiftExport.jsx — META·SIFT Beta export page
 * Route: /sift-beta/projects/:pid/export
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { screeningApi } from '../api-client/screeningApi.js';

const C = {
  bg:    '#080c15', surf:  '#0c1322', card:  '#101929',
  brd:   '#1a2b42', brd2:  '#213452',
  acc:   '#5b9cf6', acc2:  '#3b7ef4',
  teal:  '#2dd4bf', gold:  '#dba96a',
  txt:   '#ecf0fb', txt2:  '#8b9ec6',
  muted: '#4a5e82',
  grn:   '#4ade80', red:   '#f87171', ylw:   '#fbbf24',
};
const FONT = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', monospace";

function BetaBadge() {
  return (
    <span style={{
      fontSize: 9, fontFamily: MONO, fontWeight: 700,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      background: '#2dd4bf18', border: '1px solid #2dd4bf50',
      color: '#2dd4bf', borderRadius: 4, padding: '2px 7px',
    }}>BETA</span>
  );
}

function Spinner({ size = 18 }) {
  return (
    <div style={{
      display: 'inline-block', width: size, height: size,
      border: `2px solid ${C.brd2}`, borderTopColor: C.acc,
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
    }} />
  );
}

const FILTER_OPTIONS = [
  { val: 'all',      label: 'All Records',   desc: 'Every record in the project',         statsKey: 'total',    color: C.txt2 },
  { val: 'included', label: 'Included',       desc: 'Records marked for inclusion',        statsKey: 'included', color: C.grn  },
  { val: 'excluded', label: 'Excluded',       desc: 'Records marked for exclusion',        statsKey: 'excluded', color: C.red  },
  { val: 'maybe',    label: 'Maybe',          desc: 'Records marked as maybe/unsure',      statsKey: 'maybe',    color: C.ylw  },
];

const FORMAT_OPTIONS = [
  { val: 'csv',  label: 'CSV',  desc: 'Spreadsheet-compatible (Excel, Google Sheets, R, Python)' },
  { val: 'json', label: 'JSON', desc: 'Full structured data for programmatic use' },
];

export default function SiftExport() {
  const { pid }  = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [stats,      setStats]      = useState({});
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [filter,     setFilter]     = useState('all');
  const [format,     setFormat]     = useState('csv');
  const [exporting,  setExporting]  = useState(false);
  const [exportDone, setExportDone] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await screeningApi.getStats(pid);
      setStats(data || {});
    } catch (e) {
      setError(e.message || 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { loadStats(); }, [loadStats]);

  function handleExport() {
    setExporting(true);
    setExportDone(false);
    const url = screeningApi.exportUrl(pid, { format, filter });
    // Trigger browser download
    const link = document.createElement('a');
    link.href = url;
    link.download = `sift-export-${filter}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      setExporting(false);
      setExportDone(true);
      setTimeout(() => setExportDone(false), 4000);
    }, 600);
  }

  const selectedFilterOpt = FILTER_OPTIONS.find(f => f.val === filter);
  const exportCount = filter === 'all'
    ? (stats.total || 0)
    : (stats[filter] || 0);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT, color: C.txt }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
      `}</style>

      {/* Header */}
      <div style={{
        background: C.surf, borderBottom: `1px solid ${C.brd}`,
        padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <button
          onClick={() => navigate(`/sift-beta/projects/${pid}`)}
          style={{ background: 'none', border: 'none', color: C.txt2, cursor: 'pointer', fontSize: 12, fontFamily: FONT }}
          onMouseEnter={e => e.currentTarget.style.color = C.txt}
          onMouseLeave={e => e.currentTarget.style.color = C.txt2}
        >
          ← Workbench
        </button>
        <span style={{ color: C.brd2 }}>|</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>Export Data</span>
        <BetaBadge />
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '36px 24px' }}>

        {/* Error */}
        {error && (
          <div style={{
            background: '#450a0a', border: '1px solid #f8717150',
            borderRadius: 8, padding: '12px 16px', color: C.red, fontSize: 13, marginBottom: 20,
          }}>
            {error}
          </div>
        )}

        {/* Stats overview */}
        {!loading && (
          <div style={{
            background: C.card, border: `1px solid ${C.brd}`,
            borderRadius: 10, padding: '18px 20px', marginBottom: 28,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.08em',
              marginBottom: 14, fontFamily: MONO, textTransform: 'uppercase',
            }}>
              Project Statistics
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 12 }}>
              {[
                { label: 'Total',     val: stats.total     || 0, color: C.txt2 },
                { label: 'Included',  val: stats.included  || 0, color: C.grn  },
                { label: 'Excluded',  val: stats.excluded  || 0, color: C.red  },
                { label: 'Maybe',     val: stats.maybe     || 0, color: C.ylw  },
                { label: 'Undecided', val: stats.undecided || 0, color: C.muted },
                { label: 'Conflicts', val: stats.conflicts || 0, color: C.gold  },
              ].map(item => (
                <div key={item.label} style={{
                  background: C.surf, border: `1px solid ${C.brd}`,
                  borderRadius: 7, padding: '10px 12px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: item.color, fontFamily: MONO, lineHeight: 1.2 }}>
                    {item.val}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
                    {item.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            {(stats.total || 0) > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: C.muted }}>Screening progress</span>
                  <span style={{ fontSize: 10, color: C.txt2, fontFamily: MONO }}>
                    {Math.round(((stats.screened || 0) / stats.total) * 100)}%
                  </span>
                </div>
                <div style={{ height: 4, background: C.brd, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, Math.round(((stats.screened || 0) / stats.total) * 100))}%`,
                    height: '100%', background: C.acc, borderRadius: 2, transition: 'width 0.3s',
                  }} />
                </div>
              </div>
            )}
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.txt2, marginBottom: 28 }}>
            <Spinner />
            <span style={{ fontSize: 13 }}>Loading stats…</span>
          </div>
        )}

        {/* Filter selector */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', marginBottom: 12, fontFamily: MONO, textTransform: 'uppercase' }}>
            Export Filter
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FILTER_OPTIONS.map(opt => {
              const count = opt.val === 'all' ? (stats.total || 0) : (stats[opt.statsKey] || 0);
              const active = filter === opt.val;
              return (
                <label
                  key={opt.val}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    background: active ? C.card : 'transparent',
                    border: `1px solid ${active ? C.brd2 : 'transparent'}`,
                    borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <input
                    type="radio"
                    name="exportFilter"
                    checked={active}
                    onChange={() => setFilter(opt.val)}
                    style={{ accentColor: opt.color, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? C.txt : C.txt2 }}>
                        {opt.label}
                      </span>
                      <span style={{
                        fontSize: 11, fontFamily: MONO, fontWeight: 700,
                        color: opt.color,
                      }}>{count}</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{opt.desc}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Format selector */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', marginBottom: 12, fontFamily: MONO, textTransform: 'uppercase' }}>
            Export Format
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {FORMAT_OPTIONS.map(opt => {
              const active = format === opt.val;
              return (
                <button
                  key={opt.val}
                  onClick={() => setFormat(opt.val)}
                  style={{
                    flex: 1, background: active ? C.acc2 + '20' : C.card,
                    border: `1px solid ${active ? C.acc2 : C.brd}`,
                    color: active ? C.acc : C.txt2, fontSize: 13,
                    fontFamily: FONT, padding: '12px 16px', borderRadius: 8,
                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 3, fontFamily: MONO, letterSpacing: '0.05em' }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 11, color: active ? C.txt2 : C.muted, lineHeight: 1.3 }}>
                    {opt.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Export button */}
        <div style={{
          background: C.card, border: `1px solid ${C.brd}`,
          borderRadius: 10, padding: '20px 22px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.txt, marginBottom: 3 }}>
              Export {selectedFilterOpt?.label}
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              {exportCount} records · {format.toUpperCase()} format
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting || exportCount === 0}
            style={{
              background: exporting || exportCount === 0 ? C.brd : C.acc2,
              border: 'none',
              color: exporting || exportCount === 0 ? C.muted : '#fff',
              fontSize: 13, fontWeight: 700, fontFamily: FONT,
              padding: '10px 28px', borderRadius: 7,
              cursor: exporting || exportCount === 0 ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'background 0.15s', whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { if (!exporting && exportCount > 0) e.currentTarget.style.background = C.acc; }}
            onMouseLeave={e => { if (!exporting && exportCount > 0) e.currentTarget.style.background = C.acc2; }}
          >
            {exporting && <Spinner size={14} />}
            {exporting ? 'Preparing…' : `↓ Download ${format.toUpperCase()}`}
          </button>
        </div>

        {/* Success feedback */}
        {exportDone && (
          <div style={{
            marginTop: 12, background: '#14532d', border: '1px solid #4ade8060',
            borderRadius: 8, padding: '10px 16px', fontSize: 12, color: C.grn,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            ✓ Export file download started.
          </div>
        )}

        {/* Notes */}
        <div style={{
          marginTop: 24, fontSize: 11, color: C.muted, lineHeight: 1.7,
          background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '12px 16px',
        }}>
          <strong style={{ color: C.txt2 }}>CSV fields:</strong> id, title, authors, year, journal, doi, pmid, abstract, keywords, sourceDb, decision, exclusionReason, notes, rating, labels, createdAt<br />
          <strong style={{ color: C.txt2 }}>JSON format:</strong> Full record objects with nested decision and metadata fields.
        </div>
      </div>
    </div>
  );
}
