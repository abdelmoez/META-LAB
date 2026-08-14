/* ════════════ SVG STRING BUILDERS ════════════
   Extracted VERBATIM from meta-lab-3-patched.jsx (prompt46 Phase 4).

   Pure functions that emit standalone SVG strings (PRISMA diagram, publication
   forest plot) plus the helpers that serialize a live on-screen SVG and tag
   PNG-preset filenames. No React / JSX here. */
import { ES_TYPES } from "../../../research-engine/project-model/monolithConstants.js";
import { fmtNum, fmtES, fmtPct, fmtI2, fmtWeight, fmtP } from "../../../research-engine/format/precision.js";
// 116.md §22-§25 (D15) — the SHARED forest geometry. buildPubForestSVG and the
// live React ForestPlot are now two skins over this one layout module, so the
// preview and every export agree on ticks, the null position, truncation, the
// out-of-scale arrows and the favours anchoring (116.md §32).
import { computeForestLayout, esMeasureName as layoutMeasureName } from "../../../research-engine/charts/forestLayout.js";

export const SVG_XML_HEADER = `<?xml version="1.0" encoding="UTF-8"?>\n`;

/* Filename suffix for PNG presets — DPI is encoded by pixel width, so the
   journal presets advertise it in the name (e.g. _journal-1col_@300dpi). */
export const presetTag = (choice) => {
  if (!choice || choice.format !== "png" || !choice.presetId) return "";
  const dpi = (choice.presetId === "journal-1col" || choice.presetId === "journal-2col") ? "_@300dpi" : "";
  const tag = choice.presetId === "custom" ? `custom${choice.widthPx || ""}px` : choice.presetId;
  return `_${tag}${dpi}`;
};

/* Serialize a LIVE on-screen SVG (theme-token colored JSX) into a standalone
   string with every fill/stroke resolved to literal computed colors —
   var(--t-*) custom properties never rasterize (the canvas <img> has no access
   to the document's variables) and must not leak into exported artifacts.
   opts.background:  '#hex'  → insert an opaque full-bleed rect under the figure
                     'auto'  → use the element's resolved CSS background color
                     null    → no rect inserted (caller paints via rasterizeSvg)
   opts.stripBgRect: remove an existing full-bleed leading <rect> (for
                     transparent PNG of figures that bake their own background).
   Returns { svg, W, H, bg } — bg is the element's resolved background color. */
export function liveSvgToString(svgId, { background = null, stripBgRect = false } = {}) {
  const el = document.getElementById(svgId);
  if (!el) throw new Error("The figure is not on screen — open the tab that shows it, then export again.");
  const W = +el.getAttribute("width") || (el.viewBox && el.viewBox.baseVal && el.viewBox.baseVal.width) || 800;
  const H = +el.getAttribute("height") || (el.viewBox && el.viewBox.baseVal && el.viewBox.baseVal.height) || 600;
  const clone = el.cloneNode(true);
  // Inline computed fill/stroke from the live nodes onto the clone (1:1 order).
  const srcAll = [el, ...el.querySelectorAll("*")];
  const cloneAll = [clone, ...clone.querySelectorAll("*")];
  srcAll.forEach((node, i) => {
    const c = cloneAll[i];
    if (!c || node.nodeType !== 1 || c.nodeType !== 1) return;
    let cs; try { cs = window.getComputedStyle(node); } catch (_) { return; }
    if (!cs) return;
    const f = cs.fill, st = cs.stroke;
    if (f && f !== "none") c.setAttribute("fill", f);
    if (st && st !== "none") c.setAttribute("stroke", st);
  });
  let bg = null;
  try {
    const b = window.getComputedStyle(el).backgroundColor;
    if (b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") bg = b;
  } catch (_) {}
  clone.removeAttribute("id");
  if (clone.style) { clone.style.background = ""; clone.style.backgroundColor = ""; clone.style.borderRadius = ""; }
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${W} ${H}`);
  if (stripBgRect) {
    const first = clone.firstElementChild;
    if (first && first.tagName && first.tagName.toLowerCase() === "rect"
      && (+first.getAttribute("x") || 0) === 0 && (+first.getAttribute("y") || 0) === 0) first.remove();
  }
  let resolvedBg = background === "auto" ? (bg || "#ffffff") : background;
  if (resolvedBg) {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", "0"); r.setAttribute("y", "0");
    r.setAttribute("width", String(W)); r.setAttribute("height", String(H));
    r.setAttribute("fill", resolvedBg);
    clone.insertBefore(r, clone.firstChild);
  }
  return { svg: new XMLSerializer().serializeToString(clone), W, H, bg };
}

export function buildPrismaSVG(prisma,opts){
  const o=opts||{};
  const n=k=>{const v=+prisma[k];return isNaN(v)?0:v;};
  // opts.resolved (optional) lets a caller supply already-resolved flow counts
  // (e.g. the manuscript engine, which applies manual overrides) so the diagram
  // matches the table/narrative. Absent → recompute by subtraction as before
  // (backward-compatible: the PRISMA tab / journal export pass no `resolved`).
  const r=o.resolved||{};
  const rn=(k,fallback)=>{const v=r[k];return (v!=null && Number.isFinite(+v))?+v:fallback;};
  const dbs=n("dbs"),reg=n("reg"),other=n("other");
  const total=rn("identified",dbs+reg+other);
  const dedupe=n("dedupe"),screened=rn("screened",total-dedupe),excTA=n("excTA"),ftRet=rn("reportsAssessed",screened-excTA),excFull=n("excFull"),included=rn("included",ftRet-excFull);
  const reasons=(prisma.reasons||[]).filter(r=>r.r&&r.n);
  const W=720, colL=40, colMain=250, boxW=300, sideW=250, sideX=colL+boxW+60;
  const INK="#111", GREY="#555", LINE="#333", FF="Georgia,'Times New Roman',serif";
  const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  let y=30; const rowsSvg=[]; const sidesSvg=[]; const arrows=[];
  const box=(x,yy,w,h,lines,opts2)=>{
    const op=opts2||{};
    let s=`<rect x="${x}" y="${yy}" width="${w}" height="${h}" fill="${op.fill||"#ffffff"}" stroke="${op.stroke||LINE}" stroke-width="1.2" rx="3"/>`;
    lines.forEach((ln,i)=>{ s+=`<text x="${x+12}" y="${yy+20+i*15}" font-family="${FF}" font-size="${op.size||11}" font-weight="${op.bold&&i===0?"700":"400"}" fill="${INK}">${esc(ln)}</text>`; });
    return s;
  };
  const vArrow=(x,y1,y2)=>`<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${GREY}" stroke-width="1.3" marker-end="url(#ah)"/>`;
  const hArrow=(x1,x2,yy)=>`<line x1="${x1}" y1="${yy}" x2="${x2}" y2="${yy}" stroke="${GREY}" stroke-width="1.3" marker-end="url(#ah)"/>`;

  const cx=colL+boxW/2;
  // noBg → skip the full-bleed white rect so transparent PNG export works
  let svg=o.noBg?"":`<rect x="0" y="0" width="${W}" height="100%" fill="#ffffff"/>`;
  if(o.title) { svg+=`<text x="${W/2}" y="24" text-anchor="middle" font-family="${FF}" font-size="14" font-weight="700" fill="${INK}">${esc(o.title)}</text>`; y=46; }

  // Identification
  const idLines=["Records identified (n = "+total+"):","   Databases (n = "+dbs+")","   Registers (n = "+reg+")"+(other?", Other (n = "+other+")":"")];
  svg+=box(colL,y,boxW,58,idLines,{bold:true});
  // duplicates side box
  svg+=box(sideX,y,sideW,40,["Records removed before screening:","   Duplicates (n = "+dedupe+")"],{});
  svg+=hArrow(colL+boxW,sideX,y+20);
  const yId=y; y+=58+26;

  // Screened
  svg+=box(colL,y,boxW,30,["Records screened (n = "+screened+")"],{bold:true});
  svg+=box(sideX,y,sideW,30,["Records excluded (n = "+excTA+")"],{});
  svg+=hArrow(colL+boxW,sideX,y+15);
  svg+=vArrow(cx,yId+58,y); y+=30+26;

  // Full text
  svg+=box(colL,y,boxW,30,["Reports assessed for eligibility (n = "+ftRet+")"],{bold:true});
  const exLines=["Reports excluded (n = "+excFull+"):"].concat(reasons.length?reasons.map(r=>"   "+r.r+" (n = "+r.n+")"):["   reasons not specified"]);
  const exH=Math.max(30,14+exLines.length*15);
  svg+=box(sideX,y,sideW,exH,exLines,{});
  svg+=hArrow(colL+boxW,sideX,y+15);
  const yFt=y; y+=30+26;

  // Included
  svg+=box(colL,y,boxW,46,["Studies included in review (n = "+included+")",(prisma.quant?"   In meta-analysis (n = "+prisma.quant+")":"")].filter(Boolean),{bold:true,fill:"#f3f7f3",stroke:"#2e7d32"});
  svg+=vArrow(cx,yFt+30,y);
  y+=46+20;

  // phase labels (left rail)
  const railLabels=[["Identification",yId+29],["Screening",(yId+84+30)/1+0],["Eligibility",yFt+15],["Included",y-46-10]];
  // simpler: draw rotated phase labels at approximate band centers
  const bands=[["Identification",yId,yId+58],["Screening",yId+84,yId+84+30],["Eligibility",yFt,yFt+30],["Included",y-66,y-20]];
  let rail="";
  // (skip rotated rail to keep it clean & robust)

  const H=y+10;
  const defs=`<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${GREY}"/></marker></defs>`;
  return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}${svg}</svg>`,W,H};
}

/* Journal-clean measure name for the effect axis — the forest and funnel
   builders MUST share this (both figures land in the same exported document;
   divergent axis labels present one pooled estimate as two different things). */
export const esMeasureName = layoutMeasureName;

/**
 * buildPubForestSVG(result, opts) — the white "Light (publication)" figure.
 *
 * 116.md §22-§25 / D15: this is now a SKIN over research-engine/charts/forestLayout.js.
 * It owns Georgia, absolute hex ink and the export precision formatters; it owns no
 * coordinates. Everything geometric — domain (always containing the measure's null),
 * measure-aware ticks, out-of-scale arrows, column bands, favours anchoring, name
 * truncation, canvas height — comes from the shared layout, which the live on-screen
 * plot consumes too.
 *
 * opts: { esType, esLabel, title, favLow, favHigh, showCounts, showWeights, showPI,
 *         nullLine (linear measures only), logScale, prec, noBg }
 */
export function buildPubForestSVG(result,opts){
  if(!result) return null;
  const o=opts||{};
  const esType=o.esType||"";
  const method=result.method||"random";
  const t=ES_TYPES[esType]||{};
  const isLog=!!t.log, isProp=esType==="PROP";
  const logOut=!!o.logScale;        // user opt-in to show the log scale instead of the ratio scale
  const ratioScale = isLog && !logOut;   // show actual ratio axis for OR/RR/HR
  const ratioAbbr = esType==="OR"?"OR":esType==="RR"?"RR":esType==="HR"?"HR":"";
  // back-transform a stored (log/logit) value to display units
  const bt=x=>{ if(isLog)return Math.exp(x); if(isProp){const e=Math.exp(x);return e/(1+e);} return x; };
  const prec=o.prec;
  // value formatting for the right-hand ES column
  const fmt=x=>{
    if(isProp) return fmtPct(bt(x),prec);
    if(isLog&&!logOut) return fmtES(bt(x),prec);
    if(isLog&&logOut) return fmtES(+x,prec);
    return fmtES(+x,prec);
  };
  const fmtCI=(lo,hi)=>`[${fmt(lo)}, ${fmt(hi)}]`;

  // ---- footer text (handed to the layout so it wraps + sizes the canvas) ----
  // 116.md §31 — p-values ALWAYS through fmtP: "< 0.001" floor, never "= 0.00".
  const pPhrase=(x)=>{const s=fmtP(x,prec);return s.startsWith("<")?`< ${s.slice(1)}`:`= ${s}`;};
  const het=`Heterogeneity: I² = ${fmtI2(result.I2,prec)}%,  τ² = ${fmtNum(result.tau2,prec)},  Q = ${fmtNum(result.Q,prec)} (df = ${result.k-1}),  p ${pPhrase(result.Qpval)}`;
  let line2=`Test for overall effect: p ${pPhrase(result.pval)}  ·  Filled diamond: ${method==="random"?"random effects":"common / fixed effect"}`;
  if(result.hksj) line2+=`  ·  HKSJ 95% CI: ${fmt(result.hksj.lo)} to ${fmt(result.hksj.hi)} (t-based)`;

  const L=computeForestLayout(result,{
    variant:"pub",
    esType,
    showCounts:o.showCounts!==false,
    showWeights:o.showWeights!==false,
    showPI:o.showPI!==false,
    title:o.title||"",
    // 116.md §26/§32 — the reviewer's edited axis label reaches EVERY export. It
    // used to be built, threaded and then silently dropped here.
    esLabel:o.esLabel||"",
    favLow:o.favLow||"",
    favHigh:o.favHigh||"",
    nullLine:o.nullLine,
    logScale:logOut,
    footerTexts:[het,line2],
  });
  if(!L) return null;
  const{columns:CO,rowsGeom:RG,ticks,rows,diamonds,pi,favours,axisLabel,footerLines}=L;
  const W=L.W,H=L.H;
  const showWeights=L.showWeights, colCounts=L.showCounts;
  const xName=CO.xName,xExp=CO.xExp,cExp=CO.cExp,xCtrl=CO.xCtrl,cCtrl=CO.cCtrl;
  const xPlot=CO.xPlot,plotW=CO.plotW,xPlotEnd=CO.xPlotEnd,xEff=CO.xEff,cEff=CO.cEff;
  const xW=CO.xW,cW=CO.cW,xW2=CO.xW2,cW2=CO.cW2;
  const MLEFT=L.metrics.marginL, MRIGHT=L.metrics.marginR;

  // ---- palette ----
  const INK="#111111", GREY="#555555", LINE="#000000", FAINT="#cccccc", BOX="#333333";
  const FF="Georgia, 'Times New Roman', serif";

  const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const txt=(x,y,s,size,opt)=>{const a=(opt&&opt.anchor)||"start";const fill=(opt&&opt.fill)||INK;const fw=(opt&&opt.bold)?"700":"400";const it=(opt&&opt.italic)?"italic":"normal";
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FF}" font-size="${size}" font-style="${it}" font-weight="${fw}" fill="${fill}" text-anchor="${a}">${esc(s)}</text>`;};
  const line=(x1,y1,x2,y2,stroke,sw,dash)=>`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${sw||1}"${dash?` stroke-dasharray="${dash}"`:""}/>`;
  /* 116.md §22 (c) — a CI end beyond the visible domain gets the conventional
     truncation arrow instead of a fake end cap sitting on the frame. */
  const endCap=(p,cy,stroke,sw)=>p.clamped
    ? `<path d="M${p.x.toFixed(1)},${cy.toFixed(1)} L${(p.x-p.clamped*7).toFixed(1)},${(cy-3.6).toFixed(1)} L${(p.x-p.clamped*7).toFixed(1)},${(cy+3.6).toFixed(1)} Z" fill="${stroke}"/>`
    : line(p.x,cy-3,p.x,cy+3,stroke,sw);

  let svg="";
  // noBg → skip the full-bleed white rect so transparent PNG export works
  if(!o.noBg) svg+=`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;

  // ---- title (wrapped / shrunk, centered, never clipped) ----
  L.title.lines.forEach((ln,i)=>{ svg+=txt(W/2, L.title.y+i*L.title.lead, ln, L.title.size, {anchor:"middle",bold:true}); });

  // ---- header row ----
  const headBottom=RG.headBottom, hMid=headBottom-6;
  svg+=txt(xName,hMid,"Study",11.5,{bold:true});
  if(colCounts){
    svg+=txt(xExp+cExp/2,headBottom-18,"Experimental",10,{anchor:"middle",bold:true,fill:GREY});
    svg+=txt(xExp+cExp/2,headBottom-6,"Events / Total",9.5,{anchor:"middle",fill:GREY});
    svg+=txt(xCtrl+cCtrl/2,headBottom-18,"Control",10,{anchor:"middle",bold:true,fill:GREY});
    svg+=txt(xCtrl+cCtrl/2,headBottom-6,"Events / Total",9.5,{anchor:"middle",fill:GREY});
  }
  svg+=txt(xPlot+plotW/2,headBottom-6,"",10,{anchor:"middle"}); // plot header intentionally empty
  svg+=txt(xEff+cEff,hMid,(ratioScale?`${ratioAbbr} [95% CI]`:isProp?"% [95% CI]":isLog&&logOut?`log ${ratioAbbr} [95% CI]`:"Effect [95% CI]"),10.5,{anchor:"end",bold:true});
  if(showWeights){
    svg+=txt(xW+cW-4,headBottom-18,"Weight",9.5,{anchor:"end",bold:true,fill:GREY});
    svg+=txt(xW+cW-4,headBottom-6,"common",9.5,{anchor:"end",fill:GREY});
    svg+=txt(xW2+cW2-4,headBottom-18,"Weight",9.5,{anchor:"end",bold:true,fill:GREY});
    svg+=txt(xW2+cW2-4,headBottom-6,"random",9.5,{anchor:"end",fill:GREY});
  }
  svg+=line(MLEFT,headBottom,W-MRIGHT,headBottom,LINE,1);

  // ---- vertical grid + null line ----
  ticks.forEach(tk=>{ svg+=line(tk.x,RG.rowsTop,tk.x,RG.bandBottom,FAINT,0.5,"2,3"); });
  // 116.md §24 — PROP has no no-effect value (ES_TYPES.PROP.nullVal === null), so
  // no null line is drawn for it; every other measure's null is inside the domain
  // by construction and can never be clamped onto an edge.
  if(L.nullLine.show) svg+=line(L.nullLine.x,RG.rowsTop,L.nullLine.x,RG.yPI+8,GREY,1);

  // ---- study rows ----
  rows.forEach((r)=>{
    const y=r.y;
    svg+=txt(xName,y,r.name,10.5,{});
    if(colCounts){
      svg+=txt(xExp+cExp/2, y, r.counts.exp, 10, {anchor:"middle"});
      svg+=txt(xCtrl+cCtrl/2, y, r.counts.ctrl, 10, {anchor:"middle"});
    }
    const cy=r.markerY, sq=r.size;
    svg+=line(r.lo.x,cy,r.hi.x,cy,INK,1.1);
    svg+=endCap(r.lo,cy,INK,1.1);
    svg+=endCap(r.hi,cy,INK,1.1);
    if(r.es.clamped){
      svg+=`<path d="M${r.es.x.toFixed(1)},${cy.toFixed(1)} L${(r.es.x-r.es.clamped*sq).toFixed(1)},${(cy-sq/2).toFixed(1)} L${(r.es.x-r.es.clamped*sq).toFixed(1)},${(cy+sq/2).toFixed(1)} Z" fill="${BOX}"/>`;
    } else {
      svg+=`<rect x="${(r.es.x-sq/2).toFixed(1)}" y="${(cy-sq/2).toFixed(1)}" width="${sq.toFixed(1)}" height="${sq.toFixed(1)}" fill="${BOX}"/>`;
    }
    svg+=txt(xEff+cEff, y, `${fmt(r.study._es)} ${fmtCI(r.study._lo,r.study._hi)}`, 10, {anchor:"end"});
    if(showWeights){
      svg+=txt(xW+cW-4, y, fmtWeight(r.weightFixedPct,prec)+"%", 9.5, {anchor:"end",fill:GREY});
      svg+=txt(xW2+cW2-4, y, fmtWeight(r.weightRandomPct,prec)+"%", 9.5, {anchor:"end",fill:GREY});
    }
  });

  svg+=line(MLEFT,RG.ySep,W-MRIGHT,RG.ySep,LINE,0.8);

  // ---- pooled diamonds ----
  diamonds.forEach(d=>{
    svg+=txt(xName,d.y,d.label,10.5,{bold:true});
    svg+=`<polygon points="${d.es.x.toFixed(1)},${(d.markerY-d.height).toFixed(1)} ${d.hi.x.toFixed(1)},${d.markerY.toFixed(1)} ${d.es.x.toFixed(1)},${(d.markerY+d.height).toFixed(1)} ${d.lo.x.toFixed(1)},${d.markerY.toFixed(1)}" fill="${d.strong?"#000000":"#ffffff"}" stroke="#000000" stroke-width="1.1"/>`;
    svg+=txt(xEff+cEff,d.y,`${fmt(d.value.es)} ${fmtCI(d.value.lo,d.value.hi)}`,10,{anchor:"end",bold:d.strong});
    if(showWeights){ svg+=txt((d.key==="fixed"?xW+cW:xW2+cW2)-4,d.y,"100%",9.5,{anchor:"end",fill:GREY}); }
  });

  // ---- prediction interval (dashed bar, journal-standard) ----
  if(pi){
    svg+=txt(xName,pi.y,pi.label,9.5,{italic:true,fill:GREY});
    svg+=line(pi.lo.x,pi.markerY,pi.hi.x,pi.markerY,GREY,1.4,"4,2");
    svg+=endCap(pi.lo,pi.markerY,GREY,1.4);
    svg+=endCap(pi.hi,pi.markerY,GREY,1.4);
    svg+=`<rect x="${(pi.centre.x-3).toFixed(1)}" y="${(pi.markerY-3).toFixed(1)}" width="6" height="6" fill="none" stroke="${GREY}" stroke-width="1"/>`;
    svg+=txt(xEff+cEff,pi.y,`${fmt(pi.value.lo)} to ${fmt(pi.value.hi)}`,9.5,{anchor:"end",italic:true,fill:GREY});
  }

  // ---- x-axis ----
  svg+=line(xPlot,RG.axisY,xPlotEnd,RG.axisY,INK,1);
  ticks.forEach(tk=>{
    svg+=line(tk.x,RG.axisY,tk.x,RG.axisY+4,INK,0.9);
    svg+=txt(tk.x,RG.tickLabelY,tk.label,9.5,{anchor:"middle"});
  });

  // ---- favours labels (own line, anchored to plot edges → no overlap) ----
  // 116.md §25 — the defaults state DIRECTION only ("favours lower/higher"); the
  // clinical reading ("Favours intervention") is never inferred from PICO (a harm
  // outcome inverts it) and comes only from the persisted per-figure configuration.
  // Arrowheads are explicit <path> triangles, NOT the ◄/► glyphs — Georgia has no
  // glyph for those codepoints, so Word's SVG renderer (and some canvas font
  // fallbacks) drew tofu boxes.
  if(favours.show){
    const favTri=(f)=>`<path d="M${(f.arrowX+f.dir*6).toFixed(1)},${(favours.y-6.5).toFixed(1)} L${f.arrowX.toFixed(1)},${(favours.y-3).toFixed(1)} L${(f.arrowX+f.dir*6).toFixed(1)},${(favours.y+0.5).toFixed(1)} Z" fill="${GREY}"/>`;
    svg+=favTri(favours.low);
    svg+=txt(favours.low.x, favours.y, favours.low.text, 9, {anchor:favours.low.anchor,fill:GREY,italic:true});
    svg+=favTri(favours.high);
    svg+=txt(favours.high.x, favours.y, favours.high.text, 9, {anchor:favours.high.anchor,fill:GREY,italic:true});
  }

  // ---- axis label (configured label, else the clean measure name) ----
  svg+=txt((xPlot+xPlotEnd)/2, RG.axisLabelY, axisLabel, 11, {anchor:"middle",bold:true});

  // ---- heterogeneity + model line (wrapped by the layout, well spaced) ----
  footerLines.forEach((ln,i)=>{ svg+=txt(MLEFT,ln.y,ln.text,i===0?9.5:9,{italic:i===0,fill:i===0?INK:GREY}); });

  const full=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`;
  return {svg:full,W,H};
}

/* ════════════ FUNNEL PLOT BUILDER (85.md Objective 2 / B1) ════════════
   Pure, off-screen funnel plot so the manuscript Word export can embed the
   figure without the Analysis tab being open (the live FunnelPlot in charts.jsx
   is a themed React SVG and stays untouched). Conventions mirror
   buildPubForestSVG: points are laid out on the STORED analysis scale (ln for
   ratio measures, logit for proportions), tick labels are back-transformed for
   readability, colors are ABSOLUTE hex (export-safe) and the font is Georgia.
   Input is a runMeta result ({studies:[{_es,_se,…}], pES, …}). Returns
   { svg, W, H } or null when fewer than 3 usable studies. Deterministic. */
export function buildFunnelSVG(result, opts){
  if(!result || !Array.isArray(result.studies)) return null;
  const o=opts||{};
  const esType=o.esType||"";
  const t=ES_TYPES[esType]||{};
  const isLog=!!t.log, isProp=esType==="PROP";
  const prec=o.prec;
  const bt=x=>{ if(isLog)return Math.exp(x); if(isProp){const e=Math.exp(x);return e/(1+e);} return x; };
  // Display units mirror buildPubForestSVG: proportions read as PERCENT (the
  // forest ticks/axis and the narrative all say %), ratios as ratio units — the
  // same pooled estimate must never appear as "0.25" here and "25%" next door.
  const fmtTick=x=>(isProp?fmtPct(bt(x)*100,prec):fmtES(bt(x),prec));
  const pts=result.studies.map(s=>{
    const es=+s._es;
    const se=(s._se!=null && Number.isFinite(+s._se) && +s._se>0) ? +s._se
      : ((Number.isFinite(+s._hi)&&Number.isFinite(+s._lo)) ? (+s._hi-+s._lo)/(2*1.96) : NaN);
    return { es, se, label:(s.author||"Study")+(s.year?` ${s.year}`:"") };
  }).filter(p=>Number.isFinite(p.es)&&Number.isFinite(p.se)&&p.se>0);
  if(pts.length<3) return null;   // same ≥3-study guard the Analysis tab uses

  const centre=Number.isFinite(+result.pES)?+result.pES:pts.reduce((a,p)=>a+p.es,0)/pts.length;
  const maxSE=Math.max(...pts.map(p=>p.se))*1.15;
  const dataMin=Math.min(...pts.map(p=>p.es));
  const dataMax=Math.max(...pts.map(p=>p.es));
  const halfRange=Math.max(centre-dataMin,dataMax-centre,1.96*maxSE)*1.1;
  const minX=centre-halfRange, maxX=centre+halfRange;

  const title=(o.title||"").trim();
  const titleH=title?28:0;
  const W=620, H=440+titleH, ML=64, MR=20, MT=24+titleH, MB=56;
  const plotW=W-ML-MR, plotH=H-MT-MB;
  const xS=x=>ML+((x-minX)/(maxX-minX))*plotW;
  const yS=se=>MT+(se/maxSE)*plotH;   // SE increases DOWNWARD (0 at top)

  // palette — absolute hex only (rasterizeSvg cannot resolve CSS variables)
  const INK="#111111", GREY="#555555", AXIS="#333333", CONE_FILL="#f2f2f2", CONE_LINE="#bbbbbb", POOL="#2e7d32", DOT="#333333";
  const FF="Georgia, 'Times New Roman', serif";
  const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const txt=(x,y,s,size,opt)=>{const a=(opt&&opt.anchor)||"start";const fill=(opt&&opt.fill)||INK;const fw=(opt&&opt.bold)?"700":"400";const it=(opt&&opt.italic)?"italic":"normal";const tr=(opt&&opt.transform)?` transform="${opt.transform}"`:"";
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FF}" font-size="${size}" font-style="${it}" font-weight="${fw}" fill="${fill}" text-anchor="${a}"${tr}>${esc(s)}</text>`;};
  const line=(x1,y1,x2,y2,stroke,sw,dash)=>`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${sw||1}"${dash?` stroke-dasharray="${dash}"`:""}/>`;

  let svg="";
  if(!o.noBg) svg+=`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;
  if(title) svg+=txt(W/2, 20, title, 14, {anchor:"middle",bold:true});

  // pseudo 95% CI cone from the pooled effect (dashed outline, faint fill)
  const steps=30;
  let dLeft="", dRight="";
  for(let i=0;i<=steps;i++){
    const se=(i/steps)*maxSE;
    dLeft+=(i===0?"M":"L")+xS(centre-1.96*se).toFixed(1)+","+yS(se).toFixed(1)+" ";
  }
  for(let i=steps;i>=0;i--){
    const se=(i/steps)*maxSE;
    dRight+="L"+xS(centre+1.96*se).toFixed(1)+","+yS(se).toFixed(1)+" ";
  }
  svg+=`<path d="${dLeft}${dRight}Z" fill="${CONE_FILL}" stroke="${CONE_LINE}" stroke-width="1" stroke-dasharray="4,4"/>`;

  // pooled-effect vertical line
  svg+=line(xS(centre),MT,xS(centre),MT+plotH,POOL,1.5,"3,3");

  // axes
  svg+=line(ML,MT,ML,MT+plotH,AXIS,1);
  svg+=line(ML,MT+plotH,ML+plotW,MT+plotH,AXIS,1);

  // SE ticks (y, 0 at top)
  for(let i=0;i<=4;i++){
    const se=maxSE*i/4;
    svg+=line(ML-4,yS(se),ML,yS(se),AXIS,1);
    svg+=txt(ML-8,yS(se)+3.5,fmtNum(se,prec),9.5,{anchor:"end",fill:GREY});
  }
  // ES ticks (x) — labelled in display units (back-transformed for ln/logit scales)
  for(let i=0;i<=6;i++){
    const v=minX+(i*(maxX-minX))/6;
    svg+=line(xS(v),MT+plotH,xS(v),MT+plotH+4,AXIS,1);
    svg+=txt(xS(v),MT+plotH+16,fmtTick(v),9.5,{anchor:"middle",fill:GREY});
  }

  // axis labels — measure-named x axis, matching the forest plot's conventions
  svg+=txt(ML+plotW/2,H-14,esMeasureName(esType),11,{anchor:"middle",bold:true});
  svg+=txt(16,MT+plotH/2,"Standard error",11,{anchor:"middle",bold:true,transform:`rotate(-90,16,${(MT+plotH/2).toFixed(1)})`});

  // study points
  pts.forEach(p=>{
    svg+=`<circle cx="${xS(p.es).toFixed(1)}" cy="${yS(p.se).toFixed(1)}" r="4.5" fill="${DOT}" stroke="#ffffff" stroke-width="1.2"/>`;
  });

  // pooled annotation (top-right, mirrors the live plot; % carries its unit)
  svg+=txt(ML+plotW-4,MT+12,`Pooled: ${fmtTick(centre)}${isProp?"%":""}`,9.5,{anchor:"end",fill:GREY,italic:true});

  const full=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`;
  return {svg:full,W,H};
}
