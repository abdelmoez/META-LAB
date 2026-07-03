/* ════════════ META-REGRESSION BUBBLE PLOT ════════════
   P13 — the continuous companion to the forest/funnel charts. Renders the
   meta-regression `bubble` payload the pure engine returns:
       bubble = { points:[{x,y,weight,label,studyId}],
                  line:{slope,intercept,x0,x1}|null,
                  band:[{x,lo,hi}]|null }
   x = covariate, y = effect estimate (on the ANALYSIS scale — log for ratio
   measures), bubble radius ∝ study weight, plus the fitted regression line and
   its 95% confidence band. Matches the app chart aesthetic (funnel/forest): the
   LIVE on-screen plot follows the theme tokens (C); a separate hex-palette string
   builder (buildBubbleSVG) produces a self-contained artifact for SVG/PNG export
   (theme var() custom-properties don't resolve inside an exported/ rasterized
   file, exactly like the forest publication builder).

   Categorical moderators: the engine returns points with jittered x and a null
   line/band → we draw the scatter without a fitted line (the results table is the
   primary output in that case; the caller documents this). */
import { alpha as themeAlpha } from "../theme/tokens.js";
import { C } from "./ui/styles.js";
import { ES_TYPES } from "../../research-engine/project-model/monolithConstants.js";
import { chartNum, chartES } from "../../research-engine/format/chartFormat.js";

const TICK = { decimals: 2 };

/* Pure geometry — turns the engine `bubble` payload into draw-ready primitives
   (numbers + label strings). Shared by the live React plot AND the export string
   builder so both are pixel-identical; only the palette differs. */
export function computeBubbleGeometry(bubble, { isLog = false } = {}) {
  const pts = (bubble && Array.isArray(bubble.points) ? bubble.points : [])
    .filter((p) => p && isFinite(Number(p.x)) && isFinite(Number(p.y)))
    .map((p) => ({ x: Number(p.x), y: Number(p.y), weight: Number(p.weight) || 0, label: p.label || "Study", studyId: p.studyId }));
  const line = bubble && bubble.line && isFinite(Number(bubble.line.slope)) ? bubble.line : null;
  const band = bubble && Array.isArray(bubble.band)
    ? bubble.band.filter((b) => b && isFinite(Number(b.x)) && isFinite(Number(b.lo)) && isFinite(Number(b.hi))) : [];

  const xs = [], ys = [];
  pts.forEach((p) => { xs.push(p.x); ys.push(p.y); });
  band.forEach((b) => { xs.push(Number(b.x)); ys.push(Number(b.lo)); ys.push(Number(b.hi)); });
  if (line) {
    const y0 = line.intercept + line.slope * line.x0, y1 = line.intercept + line.slope * line.x1;
    xs.push(Number(line.x0), Number(line.x1)); ys.push(y0, y1);
  }

  let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  if (!isFinite(minX) || !isFinite(maxX)) { minX = 0; maxX = 1; }
  if (!isFinite(minY) || !isFinite(maxY)) { minY = 0; maxY = 1; }
  if (minX === maxX) { minX -= 0.5; maxX += 0.5; }
  if (minY === maxY) { minY -= 0.5; maxY += 0.5; }
  const padX = (maxX - minX) * 0.06 || 0.5, padY = (maxY - minY) * 0.12 || 0.5;
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;

  const W = 640, H = 430, ML = 68, MR = 22, MT = 22, MB = 62;
  const plotW = W - ML - MR, plotH = H - MT - MB;
  const xS = (x) => ML + ((x - minX) / (maxX - minX)) * plotW;
  const yS = (y) => MT + ((maxY - y) / (maxY - minY)) * plotH;

  const maxW = Math.max(1, ...pts.map((p) => p.weight));
  const rOf = (w) => 4 + Math.sqrt(Math.max(0, w) / maxW) * 13;

  const points = pts.map((p) => ({
    cx: xS(p.x), cy: yS(p.y), r: rOf(p.weight), label: p.label, studyId: p.studyId,
    tip: `${p.label} · ${chartNum(p.x, TICK)} → ${isLog ? chartES(Math.exp(p.y), TICK) : chartES(p.y, TICK)}${isLog ? " (back-transformed)" : ""}`,
  }));

  let linePts = null;
  if (line) {
    const y0 = line.intercept + line.slope * line.x0, y1 = line.intercept + line.slope * line.x1;
    linePts = { x1: xS(line.x0), y1: yS(y0), x2: xS(line.x1), y2: yS(y1) };
  }

  let bandPath = null;
  if (band.length >= 2) {
    const sorted = band.slice().sort((a, b) => Number(a.x) - Number(b.x));
    const up = sorted.map((b, i) => `${i === 0 ? "M" : "L"}${xS(Number(b.x)).toFixed(1)},${yS(Number(b.hi)).toFixed(1)}`).join(" ");
    const down = sorted.slice().reverse().map((b) => `L${xS(Number(b.x)).toFixed(1)},${yS(Number(b.lo)).toFixed(1)}`).join(" ");
    bandPath = `${up} ${down} Z`;
  }

  const nTicks = 6;
  const xTicks = [];
  for (let i = 0; i <= nTicks; i++) { const v = minX + (i / nTicks) * (maxX - minX); xTicks.push({ px: xS(v), label: chartNum(v, TICK) }); }
  const yTicks = [];
  for (let i = 0; i <= 5; i++) { const v = minY + (i / 5) * (maxY - minY); yTicks.push({ py: yS(v), label: isLog ? chartES(Math.exp(v), TICK) : chartNum(v, TICK) }); }
  const nullY = (0 >= minY && 0 <= maxY) ? yS(0) : null;

  return { W, H, ML, MR, MT, MB, plotW, plotH, points, linePts, bandPath, xTicks, yTicks, nullY };
}

function effectAxisLabel(measure, isLog) {
  const rawScale = (measure && ES_TYPES[measure] && ES_TYPES[measure].scale) || "Effect size";
  return isLog ? `ln(${rawScale.replace("ln", "")})` : rawScale;
}

/* Live, theme-aware on-screen bubble plot. */
export function BubblePlot({ bubble, measure = "", covariateLabel = "Covariate", svgId = "bubbleplot-svg" }) {
  const isLog = !!(measure && ES_TYPES[measure] && ES_TYPES[measure].log);
  const g = computeBubbleGeometry(bubble, { isLog });
  const effLabel = effectAxisLabel(measure, isLog);
  if (!g.points.length) {
    return (<div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 40, textAlign: "center", color: C.muted }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>🫧</div>Not enough covariate data to draw a bubble plot.
    </div>);
  }
  const { W, H, ML, MT, plotW, plotH } = g;
  return (<div style={{ overflowX: "auto", width: "100%" }}>
    <svg id={svgId} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
      style={{ fontFamily: "'IBM Plex Mono',monospace", background: C.card, borderRadius: 8, display: "block", maxWidth: "100%" }}>
      {/* 95% confidence band */}
      {g.bandPath && <path d={g.bandPath} fill={themeAlpha(C.acc, "18")} stroke="none" />}
      {/* no-effect reference line */}
      {g.nullY != null && <line x1={ML} y1={g.nullY} x2={ML + plotW} y2={g.nullY} stroke={themeAlpha(C.grn, "88")} strokeWidth={1} strokeDasharray="4,4" />}
      {/* axes */}
      <line x1={ML} y1={MT} x2={ML} y2={MT + plotH} stroke={C.brd} />
      <line x1={ML} y1={MT + plotH} x2={ML + plotW} y2={MT + plotH} stroke={C.brd} />
      {/* y ticks */}
      {g.yTicks.map((t, i) => (<g key={`y${i}`}>
        <line x1={ML - 4} y1={t.py} x2={ML} y2={t.py} stroke={C.brd} />
        <text x={ML - 8} y={t.py + 4} textAnchor="end" fontSize={10} fill={C.muted}>{t.label}</text>
      </g>))}
      {/* x ticks */}
      {g.xTicks.map((t, i) => (<g key={`x${i}`}>
        <line x1={t.px} y1={MT + plotH} x2={t.px} y2={MT + plotH + 4} stroke={C.brd} />
        <text x={t.px} y={MT + plotH + 18} textAnchor="middle" fontSize={10} fill={C.muted}>{t.label}</text>
      </g>))}
      {/* regression line */}
      {g.linePts && <line x1={g.linePts.x1} y1={g.linePts.y1} x2={g.linePts.x2} y2={g.linePts.y2} stroke={C.grn} strokeWidth={2} />}
      {/* bubbles */}
      {g.points.map((p, i) => (<g key={p.studyId || i}>
        <circle cx={p.cx} cy={p.cy} r={p.r} fill={themeAlpha(C.acc, "55")} stroke={C.acc} strokeWidth={1.25} />
        <title>{p.tip}</title>
      </g>))}
      {/* axis labels */}
      <text x={ML + plotW / 2} y={H - 12} textAnchor="middle" fontSize={11} fill={C.txt}>{covariateLabel}</text>
      <text x={16} y={MT + plotH / 2} textAnchor="middle" fontSize={11} fill={C.txt} transform={`rotate(-90,16,${MT + plotH / 2})`}>{effLabel}</text>
    </svg>
  </div>);
}

/* Self-contained export SVG (absolute hex colors — no theme var()). Mirrors the
   forest publication builder: an artifact that renders identically outside the
   app and rasterizes cleanly via exportCore.rasterizeSvg. */
export function buildBubbleSVG(bubble, { measure = "", covariateLabel = "Covariate", title = "" } = {}) {
  const isLog = !!(measure && ES_TYPES[measure] && ES_TYPES[measure].log);
  const g = computeBubbleGeometry(bubble, { isLog });
  if (!g.points.length) return null;
  const effLabel = effectAxisLabel(measure, isLog);
  const P = { bg: "#0e1420", txt: "#eaecf6", muted: "#8791b0", brd: "#1f2640", acc: "#818cf8", accFill: "#818cf855", band: "#818cf828", grn: "#34d399" };
  const { W, H, ML, MT, MR, plotW, plotH } = g;
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const el = [];
  el.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${P.bg}"/>`);
  if (title) el.push(`<text x="${ML}" y="16" font-size="12" font-weight="700" fill="${P.txt}">${esc(title)}</text>`);
  if (g.bandPath) el.push(`<path d="${g.bandPath}" fill="${P.band}" stroke="none"/>`);
  if (g.nullY != null) el.push(`<line x1="${ML}" y1="${g.nullY}" x2="${ML + plotW}" y2="${g.nullY}" stroke="${P.grn}" stroke-width="1" stroke-dasharray="4,4"/>`);
  el.push(`<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + plotH}" stroke="${P.brd}"/>`);
  el.push(`<line x1="${ML}" y1="${MT + plotH}" x2="${ML + plotW}" y2="${MT + plotH}" stroke="${P.brd}"/>`);
  g.yTicks.forEach((t) => { el.push(`<line x1="${ML - 4}" y1="${t.py}" x2="${ML}" y2="${t.py}" stroke="${P.brd}"/><text x="${ML - 8}" y="${t.py + 4}" text-anchor="end" font-size="10" fill="${P.muted}">${esc(t.label)}</text>`); });
  g.xTicks.forEach((t) => { el.push(`<line x1="${t.px}" y1="${MT + plotH}" x2="${t.px}" y2="${MT + plotH + 4}" stroke="${P.brd}"/><text x="${t.px}" y="${MT + plotH + 18}" text-anchor="middle" font-size="10" fill="${P.muted}">${esc(t.label)}</text>`); });
  if (g.linePts) el.push(`<line x1="${g.linePts.x1}" y1="${g.linePts.y1}" x2="${g.linePts.x2}" y2="${g.linePts.y2}" stroke="${P.grn}" stroke-width="2"/>`);
  g.points.forEach((p) => { el.push(`<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${p.r.toFixed(1)}" fill="${P.accFill}" stroke="${P.acc}" stroke-width="1.25"/>`); });
  el.push(`<text x="${ML + plotW / 2}" y="${H - 12}" text-anchor="middle" font-size="11" fill="${P.txt}">${esc(covariateLabel)}</text>`);
  el.push(`<text x="16" y="${MT + plotH / 2}" text-anchor="middle" font-size="11" fill="${P.txt}" transform="rotate(-90,16,${MT + plotH / 2})">${esc(effLabel)}</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'IBM Plex Mono',monospace">${el.join("")}</svg>`;
  return { svg, W, H };
}

export default BubblePlot;
