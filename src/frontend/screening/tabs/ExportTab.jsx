/**
 * ExportTab.jsx — export screening decisions (CSV / JSON / RIS).
 *
 * prompt9 Task 6: the export routes through the shared ExportDialog (the
 * dialog is the format chooser); the SERVER still generates the file — run()
 * keeps the anchor-click on screeningApi.exportUrl exactly as before.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { C, MONO } from '../ui/theme.js';
import { Loading, ErrorBanner, Button, StatTile, Card } from '../ui/components.jsx';
import { screeningApi } from '../api-client/screeningApi.js';
import ExportDialog from '../../components/ExportDialog.jsx';
import { downloadBlob } from '../../components/exportCore.js';

const FILTERS = [
  { key: 'all',      label: 'All records',  desc: 'Every record in the project' },
  { key: 'include',  label: 'Included',     desc: 'Records you marked include' },
  { key: 'exclude',  label: 'Excluded',     desc: 'Records you marked exclude' },
  { key: 'maybe',    label: 'Maybe',        desc: 'Records you marked maybe' },
];

// Only the formats the server's export endpoint accepts for decisions.
const FORMATS = [
  { id: 'csv',  label: 'CSV' },
  { id: 'json', label: 'JSON' },
  { id: 'ris',  label: 'RIS' },
];

export default function ExportTab({ pid }) {
  const [stats, setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [filter, setFilter] = useState('all');
  const [note, setNote]     = useState('');
  const [expItem, setExpItem] = useState(null);
  // 62.md rec round: stop the async-export poll loop if the tab unmounts (navigating away
  // shouldn't leave a 12-minute background polling loop running).
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    setError(null);
    try { setStats(await screeningApi.getStats(pid)); }
    catch (e) { setError(e.message || 'Failed to load stats'); }
    finally { setLoading(false); }
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  const countFor = (k) => !stats ? 0 : k === 'all' ? stats.total : k === 'include' ? stats.included : k === 'exclude' ? stats.excluded : stats.maybe;

  function openExport() {
    const chosenFilter = filter; // freeze the filter the dialog exports with
    setExpItem({
      id: 'sift-decisions',
      title: 'Screening decisions',
      formats: FORMATS,
      sizing: false,
      defaults: { format: 'csv' },
      run: async ({ format }, onProgress) => {
        // 62.md — try the fast synchronous path (instant for typical projects). If the
        // project is too large the server answers 413; we then switch to a durable async
        // export job, show progress, and download the finished file — so a big project
        // never 504s or freezes the browser.
        let res;
        try { res = await fetch(screeningApi.exportUrl(pid, { format, filter: chosenFilter }), { credentials: 'include' }); }
        catch { throw new Error('Network error while exporting. Please try again.'); }

        if (res.ok) {
          downloadBlob(await res.blob(), `sift-export-${String(pid).slice(0, 8)}.${format}`);
          setNote('Download started.'); setTimeout(() => setNote(''), 3000);
          return;
        }
        if (res.status !== 413) {
          let msg = `Export failed (${res.status}).`;
          try { const d = await res.json(); if (d?.error) msg = d.error; } catch { /* keep default */ }
          throw new Error(msg);
        }

        // Large project → async export job (start → poll → download).
        onProgress?.('Preparing export…');
        const started = await screeningApi.startExport(pid, { format, filter: chosenFilter });
        const jobId = started.jobId;
        for (let i = 0; i < 600; i++) { // ~12 min ceiling at 1.2s/poll
          if (!mountedRef.current) return; // tab unmounted → stop polling (job continues server-side)
          const st = await screeningApi.getExportJob(pid, jobId);
          if (st.status === 'failed') throw new Error(st.error || 'Export failed.');
          if (st.ready) {
            // The file exists + the download route re-checks permission; a same-origin
            // anchor streams it natively (no blob in memory).
            const a = document.createElement('a');
            a.href = screeningApi.exportDownloadUrl(pid, jobId);
            a.download = st.filename || '';
            document.body.appendChild(a); a.click(); a.remove();
            setNote('Download started.'); setTimeout(() => setNote(''), 3000);
            return;
          }
          onProgress?.(`Preparing export…${st.progress != null ? ` (${st.progress}%)` : ''}`);
          await new Promise(r => setTimeout(r, 1200));
        }
        throw new Error('Export is taking longer than expected; please check back shortly.');
      },
    });
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Button onClick={openExport} disabled={countFor(filter) === 0}>↓ Export…</Button>
        <span style={{ fontSize: 12, color: C.muted }}>{countFor(filter)} records selected · choose CSV, JSON or RIS</span>
        {note && <span style={{ fontSize: 12, color: C.grn }}>{note}</span>}
      </div>

      <ExportDialog open={!!expItem} onClose={() => setExpItem(null)} item={expItem} />
    </div>
  );
}
