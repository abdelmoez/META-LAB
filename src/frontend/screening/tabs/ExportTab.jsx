/**
 * ExportTab.jsx — export screening decisions as CSV or JSON.
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO } from '../ui/theme.js';
import { Loading, ErrorBanner, Button, StatTile, Card } from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';

const FILTERS = [
  { key: 'all',      label: 'All records',  desc: 'Every record in the project' },
  { key: 'include',  label: 'Included',     desc: 'Records you marked include' },
  { key: 'exclude',  label: 'Excluded',     desc: 'Records you marked exclude' },
  { key: 'maybe',    label: 'Maybe',        desc: 'Records you marked maybe' },
];

export default function ExportTab({ pid }) {
  const [stats, setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [filter, setFilter] = useState('all');
  const [format, setFormat] = useState('csv');
  const [note, setNote]     = useState('');

  const load = useCallback(async () => {
    setError(null);
    try { setStats(await screeningApi.getStats(pid)); }
    catch (e) { setError(e.message || 'Failed to load stats'); }
    finally { setLoading(false); }
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  const countFor = (k) => !stats ? 0 : k === 'all' ? stats.total : k === 'include' ? stats.included : k === 'exclude' ? stats.excluded : stats.maybe;

  function handleExport() {
    const url = screeningApi.exportUrl(pid, { format, filter });
    const a = document.createElement('a');
    a.href = url; a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
    setNote('Download started.');
    setTimeout(() => setNote(''), 3000);
  }

  if (loading) return <Loading label="Loading export…" />;

  return (
    <div style={{ maxWidth: 680 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>Export Data</h2>
      {error && <ErrorBanner onRetry={load}>{error}</ErrorBanner>}

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 22 }}>
          <StatTile label="Total"     value={stats.total}     color={C.txt2} />
          <StatTile label="Included"  value={stats.included}  color={C.grn} />
          <StatTile label="Excluded"  value={stats.excluded}  color={C.red} />
          <StatTile label="Maybe"     value={stats.maybe}     color={C.ylw} />
          <StatTile label="Undecided" value={stats.undecided} color={C.muted} />
        </div>
      )}

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Filter</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FILTERS.map(f => (
            <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 10px', borderRadius: 7, border: `1px solid ${filter === f.key ? C.acc2 : C.brd}`, background: filter === f.key ? C.accBg : 'transparent' }}>
              <input type="radio" checked={filter === f.key} onChange={() => setFilter(f.key)} style={{ accentColor: C.acc }} />
              <span style={{ flex: 1 }}>
                <span style={{ fontSize: 13, color: C.txt }}>{f.label}</span>
                <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>{f.desc}</span>
              </span>
              <span style={{ fontSize: 12, fontFamily: MONO, color: C.txt2 }}>{countFor(f.key)}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Format</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {['csv', 'json'].map(fmt => (
            <button key={fmt} onClick={() => setFormat(fmt)}
              style={{ flex: 1, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 600, padding: '10px 0', borderRadius: 7, textTransform: 'uppercase',
                background: format === fmt ? C.acc2 : C.card, color: format === fmt ? C.accText : C.txt2, border: `1px solid ${format === fmt ? C.acc2 : C.brd2}` }}>{fmt}</button>
          ))}
        </div>
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Button onClick={handleExport} disabled={countFor(filter) === 0}>↓ Download {format.toUpperCase()}</Button>
        <span style={{ fontSize: 12, color: C.muted }}>{countFor(filter)} records · {format.toUpperCase()}</span>
        {note && <span style={{ fontSize: 12, color: C.grn }}>{note}</span>}
      </div>
    </div>
  );
}
