/**
 * RobTrafficLight.jsx — robvis-grade traffic-light plot (rob.md §7).
 *
 * Rows = results/studies, columns = D1–D5 + Overall, cells = judgement colour +
 * REDUNDANT symbol (+ / ! / × / ?) so it is readable without colour. Built from
 * the engine's summaryMatrix shape. The SVG uses ABSOLUTE hex (Okabe–Ito) so it
 * exports faithfully (PNG via rasterizeSvg, SVG/CSV via downloadText) — no CSS
 * vars, which the canvas rasteriser cannot resolve.
 */
import { useMemo, useState } from 'react';
import { C, FONT, MONO } from '../theme/tokens.js';
import { rasterizeSvg, downloadBlob, downloadText } from '../components/exportCore.js';
import { judgmentStyle, JUDGMENT_LEGEND } from './judgmentStyle.js';

const SYMBOL = { low: '+', some: '!', high: '×', na: '?' }; // + ! × ?

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build the traffic-light plot as a standalone SVG string (absolute hex).
 * @param {{domains:Array<{id,shortLabel}>, rows:Array<{label,cells:Array<{domainId,judgment}>,overall}>}} matrix
 * @returns {{ svg:string, width:number, height:number }}
 */
export function buildTrafficLightSVG(matrix, { title = 'Risk of bias (RoB 2)' } = {}) {
  const domains = matrix?.domains || [];
  const rows = matrix?.rows || [];
  const cols = [...domains.map(d => ({ id: d.id, label: d.id })), { id: '__overall', label: 'Overall' }];

  // ── Geometry ────────────────────────────────────────────────────────────────
  // Left padding adapts to the longest (truncated) row label so study names are
  // not clipped, within sensible bounds; long labels keep a hover <title>.
  const TRUNC = 44;
  const CHARW = 6.6;          // ~px per char at the 12.5px label font
  const labelOf = r => String(r.label == null ? '' : r.label);
  const longest = rows.reduce((m, r) => Math.max(m, Math.min(TRUNC, labelOf(r).length)), 0);
  const padL = Math.round(Math.max(180, Math.min(320, 64 + longest * CHARW)));
  const padT = 58, cell = 46, rowH = 40, padR = 24, padB = 70;
  const cx0 = padL + cell / 2;
  const plotRight = padL + cols.length * cell + padR;

  // The legend is laid out left→right from padL; pre-measure its extent so the
  // canvas is ALWAYS wide enough to contain it (the historic clipping bug).
  let legendExtent = padL;
  JUDGMENT_LEGEND.forEach(l => { legendExtent += 40 + l.label.length * CHARW; });
  legendExtent += padR;
  // Title at 15px bold sits at x=padL; keep it on-canvas too.
  const titleExtent = padL + title.length * 8.2 + padR;

  const width = Math.ceil(Math.max(plotRight, legendExtent, titleExtent));
  const height = padT + Math.max(1, rows.length) * rowH + padB;

  const parts = [];
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(`<text x="${padL}" y="26" font-family="${FONT}" font-size="15" font-weight="700" fill="#1a1a1a">${esc(title)}</text>`);

  // Column headers (D1..D5, Overall)
  cols.forEach((c, i) => {
    const x = cx0 + i * cell;
    parts.push(`<text x="${x}" y="${padT - 14}" font-family="${MONO}" font-size="12" font-weight="700" fill="#444" text-anchor="middle">${esc(c.label)}</text>`);
  });

  rows.forEach((r, ri) => {
    const y = padT + ri * rowH + rowH / 2;
    const full = labelOf(r);
    const shown = full.length > TRUNC ? `${full.slice(0, TRUNC - 1)}…` : full;
    // Full label is preserved as a hover <title> so truncation never hides it.
    parts.push(`<text x="${padL - 14}" y="${y + 4}" font-family="${FONT}" font-size="12.5" fill="#222" text-anchor="end"><title>${esc(full)}</title>${esc(shown)}</text>`);
    const byDomain = {};
    for (const cl of (r.cells || [])) byDomain[cl.domainId] = cl.judgment;
    cols.forEach((c, ci) => {
      const j = c.id === '__overall' ? r.overall : byDomain[c.id];
      const st = judgmentStyle(j);
      const x = cx0 + ci * cell;
      parts.push(`<circle cx="${x}" cy="${y}" r="14" fill="${st.hex}" stroke="#ffffff" stroke-width="2"/>`);
      parts.push(`<text x="${x}" y="${y + 5}" font-family="${FONT}" font-size="15" font-weight="800" fill="#ffffff" text-anchor="middle">${esc(SYMBOL[j] || SYMBOL.na)}</text>`);
    });
  });

  // Legend
  const ly = padT + rows.length * rowH + 28;
  let lx = padL;
  JUDGMENT_LEGEND.forEach(l => {
    parts.push(`<circle cx="${lx + 8}" cy="${ly - 4}" r="8" fill="${l.hex}"/>`);
    parts.push(`<text x="${lx + 8}" y="${ly - 0.5}" font-family="${FONT}" font-size="11" font-weight="800" fill="#fff" text-anchor="middle">${esc(SYMBOL[l.key])}</text>`);
    parts.push(`<text x="${lx + 22}" y="${ly}" font-family="${FONT}" font-size="11.5" fill="#333">${esc(l.label)}</text>`);
    lx += 40 + l.label.length * CHARW;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
  return { svg, width, height };
}

export default function RobTrafficLight({ matrix, title }) {
  const [busy, setBusy] = useState(false);
  const { svg, width, height } = useMemo(() => buildTrafficLightSVG(matrix, { title }), [matrix, title]);
  const empty = !matrix || !(matrix.rows || []).length;
  // DISPLAY copy: make the SVG scale down on small screens and centre it, WITHOUT
  // touching the export string (the rasteriser needs the fixed width/height). The
  // viewBox lets `max-width:100%;height:auto` shrink it while preserving the plot.
  const displaySvg = useMemo(
    () => svg.replace('<svg ', '<svg style="max-width:100%;height:auto;display:block;margin:0 auto" '),
    [svg],
  );

  async function exportPng() {
    setBusy(true);
    try {
      const blob = await rasterizeSvg(svg, width, height, { targetWidthPx: Math.max(1200, width * 2), background: '#ffffff' });
      downloadBlob(blob, 'rob2-traffic-light.png');
    } finally { setBusy(false); }
  }
  function exportSvg() { downloadText(svg, 'rob2-traffic-light.svg', 'image/svg+xml'); }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
        <button onClick={exportSvg} disabled={empty} style={btn(empty)}>Export SVG</button>
        <button onClick={exportPng} disabled={empty || busy} style={btn(empty || busy)}>{busy ? 'Rendering…' : 'Export PNG'}</button>
      </div>
      {empty ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: C.muted, fontSize: 13, fontFamily: FONT }}>
          No assessments yet — the traffic-light plot appears once a result is assessed.
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center', overflowX: 'auto', background: '#fff', borderRadius: 10, border: `1px solid ${C.brd}`, padding: 12 }}>
          {/* The plot is intentionally rendered on a white canvas (journal-ready);
              dangerouslySetInnerHTML is safe — every value is escaped in
              buildTrafficLightSVG. The display copy scales/centres responsively. */}
          <div style={{ width: '100%', maxWidth: width, minWidth: 0 }}
            dangerouslySetInnerHTML={{ __html: displaySvg }}
          />
        </div>
      )}
    </div>
  );
}

function btn(disabled) {
  return {
    padding: '6px 13px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 7,
    color: disabled ? C.muted : C.txt2, fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: FONT,
  };
}
