/**
 * SeedReviewUpload.jsx — upload one or more seed-review PDFs (or .txt reference
 * lists), extract their text CLIENT-side (pdfTextClient → the shared pdf.js
 * pipeline) and POST { title, filename, text } to the citation-mining backend,
 * which parses the reference list with the pure engine. Shows the uploaded seed
 * reviews with their reference counts; clicking one opens its parsed references
 * (parent-owned selection). Clean empty / loading / per-file progress states.
 *
 * No raw PDF ever leaves the browser — only the extracted text is sent. No
 * user-facing "AI" wording: this is reference mining from a known review.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { C, FONT, MONO, alpha } from '../../frontend/screening/ui/theme.js';
import { Icon } from '../../frontend/components/icons.jsx';
import { Card, Btn, EmptyState, Note, formatWhen } from '../pecanSearch/components/parts.jsx';
import { citationMiningApi } from './citationMiningApi.js';
import { extractTextFromFile } from './pdfTextClient.js';

export default function SeedReviewUpload({ pid, onSelectSeed, selectedSeedId, readOnly }) {
  const [seeds, setSeeds] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [queue, setQueue] = useState([]);   // [{ name, phase, pct, note }]
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await citationMiningApi.listSeedReviews(pid);
      setSeeds((d && d.seedReviews) || []);
      setError('');
    } catch (e) { setError(e.message || 'Could not load seed reviews.'); setSeeds([]); }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  const onFiles = useCallback(async (files) => {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length || readOnly) return;
    setBusy(true); setError('');
    setQueue(list.map((f) => ({ name: f.name, phase: 'reading', pct: 0, note: '' })));

    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const patch = (p) => setQueue((q) => q.map((row, j) => (j === i ? { ...row, ...p } : row)));
      const extracted = await extractTextFromFile(f, { onProgress: (done, total) => patch({ pct: total ? Math.round((done / total) * 90) : 0 }) });
      if (!extracted.text) {
        patch({ phase: 'error', note: extracted.reason === 'not-pdf' ? 'Not a readable PDF' : 'No text could be extracted' });
        continue;
      }
      patch({ phase: 'uploading', pct: 95 });
      try {
        const res = await citationMiningApi.uploadSeedReview(pid, {
          title: (f.name || 'Seed review').replace(/\.(pdf|txt)$/i, ''),
          filename: f.name || '',
          text: extracted.text,
        });
        const count = (res && (res.referenceCount ?? (res.seed && res.seed.referenceCount))) || 0;
        patch({ phase: 'done', pct: 100, note: `${count} reference${count === 1 ? '' : 's'} parsed` });
        if (res && res.seed && res.seed.id && i === list.length - 1 && onSelectSeed) onSelectSeed(res.seed.id);
      } catch (e) {
        patch({ phase: 'error', note: e.status === 403 ? 'Read-only access' : (e.message || 'Upload failed') });
      }
    }
    setBusy(false);
    await load();
    // Clear the finished queue shortly after so the list is the resting state.
    setTimeout(() => setQueue((q) => (q.some((r) => r.phase !== 'done' && r.phase !== 'error') ? q : [])), 2500);
    if (fileRef.current) fileRef.current.value = '';
  }, [pid, readOnly, onSelectSeed, load]);

  return (
    <Card title="Seed reviews" icon="upload"
      desc="Upload a systematic review's PDF (or a .txt reference list). Its bibliography is mined into candidate studies you can resolve, de-duplicate against this project, and import into screening."
      right={!readOnly ? (
        <Btn variant="primary" busy={busy} onClick={() => fileRef.current && fileRef.current.click()}>
          <Icon name="upload" size={13} /> Upload seed review
        </Btn>
      ) : null}>
      <input ref={fileRef} type="file" accept=".pdf,.txt,application/pdf,text/plain" multiple
        style={{ display: 'none' }} onChange={(e) => onFiles(e.target.files)} />

      {error ? <Note tone="error">{error}</Note> : null}

      {/* Per-file extraction / upload progress */}
      {queue.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: seeds && seeds.length ? 14 : 0 }}>
          {queue.map((row, i) => (
            <div key={i} style={{ border: `1px solid ${C.brd}`, borderRadius: 10, padding: '9px 12px', background: C.card2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: C.txt }}>
                <Icon name={row.phase === 'error' ? 'alert' : row.phase === 'done' ? 'check' : 'fileText'} size={13}
                  style={{ color: row.phase === 'error' ? C.red : row.phase === 'done' ? C.grn : C.muted, flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: row.phase === 'error' ? C.red : C.muted }}>
                  {row.phase === 'reading' ? 'Extracting…' : row.phase === 'uploading' ? 'Uploading…' : row.note}
                </span>
              </div>
              {row.phase !== 'error' && (
                <div style={{ height: 5, borderRadius: 4, background: alpha(C.muted, 0.15), overflow: 'hidden', marginTop: 7 }}>
                  <div style={{ height: '100%', width: `${row.pct}%`, background: row.phase === 'done' ? C.grn : C.acc, borderRadius: 4, transition: 'width 0.25s' }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Uploaded seed reviews */}
      {seeds === null ? (
        <div style={{ padding: '18px 0', color: C.muted, fontSize: 12.5, fontFamily: FONT }}>Loading seed reviews…</div>
      ) : seeds.length === 0 ? (
        queue.length === 0 ? (
          <EmptyState icon="upload" title="No seed reviews yet">
            Upload a review PDF to mine its reference list into candidate studies.
          </EmptyState>
        ) : null
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {seeds.map((s) => {
            const on = s.id === selectedSeedId;
            return (
              <button key={s.id} type="button" onClick={() => onSelectSeed && onSelectSeed(s.id)}
                style={{
                  textAlign: 'left', cursor: 'pointer', fontFamily: FONT,
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10,
                  background: on ? alpha(C.acc, 0.1) : C.card,
                  border: `1px solid ${on ? alpha(C.acc, 0.5) : C.brd}`,
                }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.acc, background: alpha(C.acc, 0.14) }}>
                  <Icon name="bookOpen" size={14} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || s.filename || 'Seed review'}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    {s.uploadedByName ? `${s.uploadedByName} · ` : ''}{formatWhen(s.createdAt)}
                  </div>
                </div>
                <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: C.txt2, whiteSpace: 'nowrap' }}>
                  {s.referenceCount} ref{s.referenceCount === 1 ? '' : 's'}
                </span>
                <Icon name="chevronRight" size={14} style={{ color: on ? C.acc : C.muted, flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
