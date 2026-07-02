/**
 * features/extraction/TablesPanel.jsx — 66.md (P5). RIGHT-panel "Tables" tab. Paste
 * CSV/TSV/HTML, "Parse table" (POST /tables), and browse the parsed tables for this
 * study (name, quality %, source) with a scrollable preview grid (first 12 rows) and
 * delete. Parsing/quality scoring is entirely server-side; this panel only drives it.
 */
import { useState } from 'react';
import { C, btnS, inp, lbl, themeAlpha, Chip, Skeleton } from './parts.jsx';

function qualityTone(q) {
  if (q >= 0.8) return 'green';
  if (q >= 0.5) return 'amber';
  return 'red';
}

function PreviewGrid({ rows }) {
  const head = rows[0] || [];
  const body = rows.slice(1, 12);
  return (
    <div style={{ overflow: 'auto', maxHeight: 220, border: `1px solid ${C.brd}`, borderRadius: 6 }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
        <thead>
          <tr>
            {head.map((c, i) => (
              <th key={i} style={{
                position: 'sticky', top: 0, background: C.bg, color: C.muted, fontWeight: 700,
                fontSize: 10, letterSpacing: 0.4, textAlign: 'left', padding: '5px 8px',
                borderBottom: `1px solid ${C.brd}`, whiteSpace: 'nowrap',
              }}>{String(c ?? '')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri}>
              {(r || []).map((c, ci) => (
                <td key={ci} style={{ padding: '4px 8px', borderBottom: `1px solid ${C.brd}`, color: C.txt2, whiteSpace: 'nowrap' }}>
                  {String(c ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TablesPanel({
  tables, loading, error, parsing, tableParsingEnabled, disabled,
  onParse, onDelete,
}) {
  const [content, setContent] = useState('');
  const [name, setName] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      {!tableParsingEnabled && (
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>Table parsing is disabled by the administrator.</div>
      )}

      {tableParsingEnabled && (
        <div>
          <label style={lbl}>Paste a table (CSV, TSV, or HTML)</label>
          <textarea
            value={content} onChange={(e) => setContent(e.target.value)}
            placeholder={'Group,Events,Total\nIntervention,42,210\nComparator,58,205'}
            style={{ ...inp, height: 96, resize: 'vertical', fontSize: 11.5, fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1.5, marginBottom: 8 }}
            disabled={disabled || parsing}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Table name (optional)"
              style={{ ...inp, fontSize: 12, flex: 1 }}
              disabled={disabled || parsing}
            />
            <button
              onClick={() => { onParse(content, name); }}
              disabled={disabled || parsing || !content.trim()}
              style={{ ...btnS('primary'), fontSize: 12, whiteSpace: 'nowrap', opacity: (disabled || parsing || !content.trim()) ? 0.6 : 1 }}
            >{parsing ? 'Parsing…' : 'Parse table'}</button>
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 11.5, color: C.red, lineHeight: 1.5 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <><Skeleton w="60%" /><Skeleton w="100%" h={40} /></>
        ) : tables.length === 0 ? (
          <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.5 }}>No parsed tables for this study yet.</div>
        ) : (
          tables.map((t) => (
            <div key={t.id} style={{ border: `1px solid ${C.brd}`, borderRadius: 8, padding: 10, background: C.card }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.txt }}>{t.name}</span>
                  <Chip tone="muted">{t.source}</Chip>
                  <Chip tone={qualityTone(t.quality)}>quality {Math.round((t.quality || 0) * 100)}%</Chip>
                </div>
                {!disabled && (
                  <button onClick={() => onDelete(t.id)} title="Delete this table"
                    style={{ ...btnS('ghost'), fontSize: 11, padding: '4px 9px', color: C.red, borderColor: themeAlpha(C.red, '40') }}>Delete</button>
                )}
              </div>
              {Array.isArray(t.rows) && t.rows.length > 0 && <PreviewGrid rows={t.rows} />}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
