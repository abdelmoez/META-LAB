/**
 * features/extraction/ValidationReportModal.jsx — 66.md (P5.9). Shows the AI-accuracy
 * report (GET /validation-report): how AI suggestions compared to human consensus
 * (the gold standard). Rates are shown as %, with a per-study table. When no study
 * has both AI suggestions and consensus yet the server returns a `note`, which we
 * render as the empty state.
 */
import { useEffect, useState } from 'react';
import { C, btnS, themeAlpha, Skeleton } from './parts.jsx';
import { extractionApi } from './extractionApi.js';

const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—');

function Metric({ label, value }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', minWidth: 120 }}>
      <div style={{ fontSize: 10, color: C.muted, letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.acc }}>{pct(value)}</div>
    </div>
  );
}

export default function ValidationReportModal({ mlpid, onClose }) {
  const [state, setState] = useState('loading'); // loading | ready | error
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await extractionApi.getValidationReport(mlpid);
        if (!dead) { setReport(r); setState('ready'); }
      } catch (e) {
        if (!dead) { setError(e.message || 'Could not load the report'); setState('error'); }
      }
    })();
    return () => { dead = true; };
  }, [mlpid]);

  const empty = report && (report.studiesCompared === 0 || report.note);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#00000099', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 20, width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.txt }}>Accuracy report</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>How suggestions compared to the human consensus (gold standard) in this project.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {state === 'loading' && <><Skeleton w="60%" mb={12} /><Skeleton h={60} mb={10} /><Skeleton h={120} /></>}
        {state === 'error' && <div style={{ fontSize: 12, color: C.red, lineHeight: 1.5 }}>{error}</div>}

        {state === 'ready' && empty && (
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, padding: '8px 2px' }}>
            {report.note || 'No studies have both suggestions and human consensus values yet — the report needs a human gold standard first.'}
          </div>
        )}

        {state === 'ready' && !empty && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              <Metric label="Exact match" value={report.exactMatchRate} />
              <Metric label="Within tolerance" value={report.withinTolRate} />
              <Metric label="Precision" value={report.fieldPrecision} />
              <Metric label="Recall" value={report.fieldRecall} />
              <Metric label="Missingness" value={report.missingnessAccuracy} />
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Compared across {report.studiesCompared} stud{report.studiesCompared === 1 ? 'y' : 'ies'}.</div>
            <div style={{ overflowX: 'auto', border: `1px solid ${C.brd}`, borderRadius: 8 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
                <thead>
                  <tr>
                    {['Study', 'Fields', 'Exact', 'Within tol', 'Precision', 'Recall'].map((h) => (
                      <th key={h} style={{ background: C.bg, color: C.muted, fontWeight: 700, fontSize: 10, textAlign: 'left', padding: '6px 9px', borderBottom: `1px solid ${C.brd}`, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(report.perStudy || []).map((s) => (
                    <tr key={s.studyId}>
                      <td style={{ padding: '5px 9px', borderBottom: `1px solid ${C.brd}`, color: C.txt2, fontFamily: "'IBM Plex Mono',monospace" }}>{s.studyId.slice(0, 8)}</td>
                      <td style={{ padding: '5px 9px', borderBottom: `1px solid ${C.brd}`, color: C.txt2 }}>{s.n}</td>
                      <td style={{ padding: '5px 9px', borderBottom: `1px solid ${C.brd}`, color: C.txt2 }}>{pct(s.exactMatchRate)}</td>
                      <td style={{ padding: '5px 9px', borderBottom: `1px solid ${C.brd}`, color: C.txt2 }}>{pct(s.withinTolRate)}</td>
                      <td style={{ padding: '5px 9px', borderBottom: `1px solid ${C.brd}`, color: C.txt2 }}>{pct(s.fieldPrecision)}</td>
                      <td style={{ padding: '5px 9px', borderBottom: `1px solid ${C.brd}`, color: C.txt2 }}>{pct(s.fieldRecall)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 10.5, color: C.dim, marginTop: 10, lineHeight: 1.5, background: themeAlpha(C.yel, '0d'), borderRadius: 6, padding: '8px 10px' }}>
              These rates describe the assistant's agreement with human decisions — they are a quality signal, not a licence to skip review. Every suggestion still requires human acceptance.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
