/* ════════════ SVG STRING BUILDERS ════════════
   Extracted VERBATIM from meta-lab-3-patched.jsx (prompt46 Phase 4).

   Pure functions that emit standalone SVG strings (PRISMA diagram, publication
   forest plot) plus the helpers that serialize a live on-screen SVG and tag
   PNG-preset filenames. No React / JSX here. */
import { ES_TYPES } from "../../../research-engine/project-model/monolithConstants.js";
import { fmtNum, fmtES, fmtPct, fmtI2, fmtWeight } from "../../../research-engine/format/precision.js";

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
export function esMeasureName(esType){
  return esType==="OR"?"Odds Ratio" : esType==="RR"?"Risk Ratio" : esType==="HR"?"Hazard Ratio"
    : esType==="SMD"?"Standardised Mean Difference" : esType==="MD"?"Mean Difference"
    : esType==="COR"?"Correlation (Fisher z)" : esType==="PROP"?"Proportion (%)" : "Effect size";
}

export function buildPubForestSVG(result,opts){
  if(!result) return null;
  const o=opts||{};
  const esType=o.esType||"";
  const showCounts=o.showCounts!==false;
  const showWeights=o.showWeights!==false;
  const method=result.method||"random";
  const title=(o.title||"").trim();
  const t=ES_TYPES[esType]||{};
  const isLog=!!t.log, isProp=esType==="PROP";
  const logOut=!!o.logScale;        // user opt-in to show the log scale instead of the ratio scale
  // Pretty measure name for the axis
  const measureFull = esMeasureName(esType);
  const ratioAbbr = esType==="OR"?"OR":esType==="RR"?"RR":esType==="HR"?"HR":"";
  const ratioScale = isLog && !logOut;   // show actual ratio axis for OR/RR/HR
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
  const studies=result.studies;
  const k=studies.length;
  const anyExp=studies.some(s=>s.a!==""&&s.a!=null), anyCtrl=studies.some(s=>s.c!==""&&s.c!=null);
  const colCounts=showCounts&&(anyExp||anyCtrl);

  // ---- palette ----
  const INK="#111111", GREY="#555555", LINE="#000000", FAINT="#cccccc", BOX="#333333";
  const FF="Georgia, 'Times New Roman', serif";

  // ---- margins & column widths (balanced; not excessively wide) ----
  const MTOP=20, MBOT=20, MLEFT=28, MRIGHT=28;
  const nameW=160;
  const cExp=colCounts?92:0, cCtrl=colCounts?92:0;
  const plotGap=20;
  const plotW=Math.max(280, Math.min(360, 300));   // balanced fixed-ish plot area
  const cEff=160;                                    // "0.72 [0.55, 0.94]"
  const cW=showWeights?62:0, cW2=showWeights?62:0;

  // title wrapping (wrap to <=2 lines, shrink font if needed)
  let titleLines=[], titleSize=15;
  const contentW = nameW+cExp+cCtrl+plotGap+plotW+plotGap+cEff+cW+cW2;
  if(title){
    const approxCharW=s=>s*0.52; // rough serif char width factor
    const maxW=contentW;
    const fitsOne=approxCharW(titleSize)*title.length<=maxW;
    if(fitsOne){ titleLines=[title]; }
    else {
      // try to wrap into 2 lines at a space near the middle
      const words=title.split(/\s+/); let l1="",l2="";
      for(const w of words){ if(approxCharW(titleSize)*(l1+" "+w).length<=maxW||!l1){ l1=l1?l1+" "+w:w; } else { l2=l2?l2+" "+w:w; } }
      if(l2 && approxCharW(titleSize)*l2.length>maxW){ titleSize=13; } // still long → shrink
      titleLines=l2?[l1,l2]:[l1];
    }
  }
  const titleBlockH = titleLines.length?(titleLines.length*(titleSize+5)+10):0;

  // ---- x positions ----
  const xName=MLEFT;
  const xExp=xName+nameW;
  const xCtrl=xExp+cExp;
  const xPlot=xCtrl+cCtrl+plotGap;
  const xPlotEnd=xPlot+plotW;
  const xEff=xPlotEnd+plotGap;
  const xW=xEff+cEff;
  const xW2=xW+cW;
  const W=xW2+cW2+MRIGHT;

  // ---- y layout ----
  const headTop=MTOP+titleBlockH;
  const headH=colCounts||showWeights?34:20;          // two-line headers need height
  const headBottom=headTop+headH;                    // header underline
  const ROW=25;
  const rowsTop=headBottom+10;
  const yStudy=i=>rowsTop+ROW*0.7+i*ROW;             // text baseline
  const bandBottom=rowsTop+k*ROW+2;
  const ySep=bandBottom+6;
  const yFixed=ySep+ROW*0.9;
  const yRandom=yFixed+ROW;
  const showPI=!!(result.predInt&&o.showPI!==false);
  const yPI=showPI?yRandom+ROW*0.85:yRandom;
  const axisY=yPI+ROW*0.7;
  const tickLabelY=axisY+15;
  const favY=tickLabelY+16;                          // favours row (its own line → no overlap)
  const axisLabelY=favY+18;
  const hetY=axisLabelY+24;
  const H=hetY+18+MBOT;

  // ---- x-scale ----
  // For ratio measures we lay out on the log axis (so CIs are symmetric) but LABEL in ratio units.
  const nullStored = ratioScale ? 0 : (isProp?0:(o.nullLine!=null?o.nullLine:0)); // log(1)=0
  const allVals=[...studies.flatMap(s=>[s._lo,s._hi]),result.fixed.lo,result.fixed.hi,result.random.lo,result.random.hi,nullStored];
  let minV=Math.min(...allVals), maxV=Math.max(...allVals);
  const span=(maxV-minV)||1; minV-=span*0.10; maxV+=span*0.10;
  // ensure null line is inside the frame
  minV=Math.min(minV,nullStored-0.05); maxV=Math.max(maxV,nullStored+0.05);
  const range=(maxV-minV)||1;
  const xS=v=>xPlot+((Math.max(minV,Math.min(maxV,v))-minV)/range)*plotW;

  // ---- tick generation ----
  let ticks=[]; // [{x, label}]
  if(ratioScale){
    // clinically standard ratio ticks; keep those within the (back-transformed) visible range
    const cand=[0.05,0.1,0.2,0.25,0.5,0.75,1,1.5,2,3,5,10,20,50,100];
    const loR=Math.exp(minV), hiR=Math.exp(maxV);
    cand.forEach(r=>{ if(r>=loR*0.97&&r<=hiR*1.03){ const lv=Math.log(r); ticks.push({x:xS(lv),v:lv,label:(r<1?String(r):String(r))}); } });
    if(ticks.length<3){ // fallback: ensure at least null + a couple
      [Math.exp(minV),1,Math.exp(maxV)].forEach(r=>{const lv=Math.log(r);ticks.push({x:xS(lv),v:lv,label:r.toFixed(2)});});
    }
  } else if(isProp){
    for(let pct=0;pct<=100;pct+=20){ const pr=Math.min(0.999,Math.max(0.001,pct/100)); const lv=Math.log(pr/(1-pr)); if(lv>=minV-1e-9&&lv<=maxV+1e-9) ticks.push({x:xS(lv),v:lv,label:String(pct)}); }
    if(ticks.length<2){[minV,maxV].forEach(lv=>ticks.push({x:xS(lv),v:lv,label:((Math.exp(lv)/(1+Math.exp(lv)))*100).toFixed(0)}));}
  } else {
    const raw=range/5, mag=Math.pow(10,Math.floor(Math.log10(raw))), n=raw/mag;
    const step=(n<1.5?1:n<3?2:n<7?5:10)*mag;
    for(let v=Math.ceil(minV/step)*step; v<=maxV+1e-9; v+=step){ ticks.push({x:xS(v),v,label:(+v.toFixed(2)).toString()}); }
  }

  const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const txt=(x,y,s,size,opt)=>{const a=(opt&&opt.anchor)||"start";const fill=(opt&&opt.fill)||INK;const fw=(opt&&opt.bold)?"700":"400";const it=(opt&&opt.italic)?"italic":"normal";
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FF}" font-size="${size}" font-style="${it}" font-weight="${fw}" fill="${fill}" text-anchor="${a}">${esc(s)}</text>`;};
  const line=(x1,y1,x2,y2,stroke,sw,dash)=>`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${sw||1}"${dash?` stroke-dasharray="${dash}"`:""}/>`;

  let svg="";
  // noBg → skip the full-bleed white rect so transparent PNG export works
  if(!o.noBg) svg+=`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;

  // ---- title (wrapped / shrunk, centered, never clipped) ----
  titleLines.forEach((ln,i)=>{ svg+=txt(W/2, MTOP+titleSize+i*(titleSize+5), ln, titleSize, {anchor:"middle",bold:true}); });

  // ---- header row ----
  const hMid=headBottom-6;
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
  ticks.forEach(tk=>{ svg+=line(tk.x,rowsTop,tk.x,bandBottom,FAINT,0.5,"2,3"); });
  svg+=line(xS(nullStored),rowsTop,xS(nullStored),yPI+8,GREY,1);

  // ---- study rows ----
  studies.forEach((s,i)=>{
    const y=yStudy(i);
    const name=(s.author||"Study")+(s.year?` ${s.year}`:"");
    svg+=txt(xName,y,name.length>26?name.slice(0,25)+"…":name,10.5,{});
    if(colCounts){
      const eN=(s.a!==""&&s.a!=null)?s.a:(s.events!==""&&s.events!=null?s.events:"");
      const eT=(s.a!==""&&s.a!=null)?((+s.a)+(+s.b||0)||s.nExp||""):(s.total!==""&&s.total!=null?s.total:"");
      const cN=(s.c!==""&&s.c!=null)?s.c:"";
      const cT=(s.c!==""&&s.c!=null)?((+s.c)+(+s.d||0)||s.nCtrl||""):"";
      svg+=txt(xExp+cExp/2, y, (eN===""?"—":`${eN} / ${eT||"?"}`), 10, {anchor:"middle"});
      svg+=txt(xCtrl+cCtrl/2, y, (cN===""?"—":`${cN} / ${cT||"?"}`), 10, {anchor:"middle"});
    }
    const cy=y-3.5;
    const x1=xS(s._lo),x2=xS(s._hi),xc=xS(s._es);
    // marker proportional to weight but capped modestly
    const sq=Math.max(5,Math.min(13,Math.sqrt((s._wFixedPct||5))*2.2));
    svg+=line(x1,cy,x2,cy,INK,1.1);
    svg+=line(x1,cy-3,x1,cy+3,INK,1.1);
    svg+=line(x2,cy-3,x2,cy+3,INK,1.1);
    svg+=`<rect x="${(xc-sq/2).toFixed(1)}" y="${(cy-sq/2).toFixed(1)}" width="${sq.toFixed(1)}" height="${sq.toFixed(1)}" fill="${BOX}"/>`;
    svg+=txt(xEff+cEff, y, `${fmt(s._es)} ${fmtCI(s._lo,s._hi)}`, 10, {anchor:"end"});
    if(showWeights){
      svg+=txt(xW+cW-4, y, fmtWeight(s._wFixedPct||0,prec)+"%", 9.5, {anchor:"end",fill:GREY});
      svg+=txt(xW2+cW2-4, y, fmtWeight(s._wRandomPct||0,prec)+"%", 9.5, {anchor:"end",fill:GREY});
    }
  });

  svg+=line(MLEFT,ySep,W-MRIGHT,ySep,LINE,0.8);

  // ---- pooled diamonds ----
  const diamond=(yc,obj,label,strong,whichW)=>{
    const x1=xS(obj.lo),x2=xS(obj.hi),xc=xS(obj.es),dh=6.5;
    let g="";
    g+=txt(xName,yc,label,10.5,{bold:true});
    g+=`<polygon points="${xc.toFixed(1)},${(yc-3.5-dh).toFixed(1)} ${x2.toFixed(1)},${(yc-3.5).toFixed(1)} ${xc.toFixed(1)},${(yc-3.5+dh).toFixed(1)} ${x1.toFixed(1)},${(yc-3.5).toFixed(1)}" fill="${strong?"#000000":"#ffffff"}" stroke="#000000" stroke-width="1.1"/>`;
    g+=txt(xEff+cEff,yc,`${fmt(obj.es)} ${fmtCI(obj.lo,obj.hi)}`,10,{anchor:"end",bold:strong});
    if(showWeights){ g+=txt((whichW==="common"?xW+cW:xW2+cW2)-4,yc,"100%",9.5,{anchor:"end",fill:GREY}); }
    return g;
  };
  svg+=diamond(yFixed,result.fixed,"Common (fixed) effect",method==="fixed","common");
  svg+=diamond(yRandom,result.random,"Random effects",method==="random","random");

  // ---- prediction interval (dashed bar, journal-standard) ----
  if(showPI){
    const pi=result.predInt;
    const x1=xS(pi.lo),x2=xS(pi.hi),xc=xS(result.random.es),cy=yPI-3.5;
    svg+=txt(xName,yPI,"Prediction interval",9.5,{italic:true,fill:GREY});
    svg+=line(x1,cy,x2,cy,GREY,1.4,"4,2");
    svg+=line(x1,cy-3,x1,cy+3,GREY,1.4);
    svg+=line(x2,cy-3,x2,cy+3,GREY,1.4);
    svg+=`<rect x="${(xc-3).toFixed(1)}" y="${(cy-3).toFixed(1)}" width="6" height="6" fill="none" stroke="${GREY}" stroke-width="1"/>`;
    svg+=txt(xEff+cEff,yPI,`${fmt(pi.lo)} to ${fmt(pi.hi)}`,9.5,{anchor:"end",italic:true,fill:GREY});
  }

  // ---- x-axis ----
  svg+=line(xPlot,axisY,xPlotEnd,axisY,INK,1);
  ticks.forEach(tk=>{
    svg+=line(tk.x,axisY,tk.x,axisY+4,INK,0.9);
    svg+=txt(tk.x,tickLabelY,tk.label,9.5,{anchor:"middle"});
  });

  // ---- favours labels (own line, anchored to plot edges → no overlap) ----
  const favLow = (isLog||isProp)?(o.favLow||"favours experimental"):"favours lower";
  const favHigh= (isLog||isProp)?(o.favHigh||"favours control"):"favours higher";
  // For ratio measures: <1 (left) usually favours treatment; keep it configurable but sensible.
  // Arrowheads are explicit <path> triangles, NOT the ◄/► glyphs — Georgia has no
  // glyph for those codepoints, so Word's SVG renderer (and some canvas font
  // fallbacks) drew tofu boxes. Same size/position/color as the old glyphs.
  const favTri=(x,dir)=>`<path d="M${(x+dir*6).toFixed(1)},${(favY-6.5).toFixed(1)} L${x.toFixed(1)},${(favY-3).toFixed(1)} L${(x+dir*6).toFixed(1)},${(favY+0.5).toFixed(1)} Z" fill="${GREY}"/>`;
  svg+=favTri(xPlot+2,1);
  svg+=txt(xPlot+11, favY, favLow, 9, {anchor:"start",fill:GREY,italic:true});
  svg+=favTri(xPlotEnd-2,-1);
  svg+=txt(xPlotEnd-11, favY, favHigh, 9, {anchor:"end",fill:GREY,italic:true});

  // ---- axis label (clean measure name) ----
  const axisName = ratioScale ? measureFull : isProp?"Proportion (%)" : isLog&&logOut?("log "+measureFull) : measureFull;
  svg+=txt((xPlot+xPlotEnd)/2, axisLabelY, axisName, 11, {anchor:"middle",bold:true});

  // ---- heterogeneity + model line (well spaced) ----
  const Qp=result.Qpval<0.001?"< 0.001":"= "+fmtNum(result.Qpval,prec);
  const op=result.pval<0.001?"< 0.001":"= "+fmtNum(result.pval,prec);
  const het=`Heterogeneity: I² = ${fmtI2(result.I2,prec)}%,  τ² = ${fmtNum(result.tau2,prec)},  Q = ${fmtNum(result.Q,prec)} (df = ${result.k-1}),  p ${Qp}`;
  svg+=txt(MLEFT,hetY,het,9.5,{italic:true});
  let line2=`Test for overall effect: p ${op}  ·  Filled diamond: ${method==="random"?"random effects":"common / fixed effect"}`;
  if(result.hksj) line2+=`  ·  HKSJ 95% CI: ${fmt(result.hksj.lo)} to ${fmt(result.hksj.hi)} (t-based)`;
  svg+=txt(MLEFT,hetY+13,line2,9,{fill:GREY});

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
