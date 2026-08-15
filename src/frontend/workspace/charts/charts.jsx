/* ════════════ FOREST + FUNNEL PLOTS ════════════
   React SVG chart components extracted VERBATIM from meta-lab-3-patched.jsx
   (prompt46 Phase 4). The LIVE on-screen plots follow the app theme tokens (C);
   the white publication export is a separate string builder (svgBuilders.js). */
import { alpha as themeAlpha } from "../../theme/tokens.js";
import { C } from "../ui/styles.js";
import { runMeta } from "../../../research-engine/statistics/monolithStats.js";
import { ES_TYPES } from "../../../research-engine/project-model/monolithConstants.js";
// WS4 (prompt 50): the INTERACTIVE on-screen plots format every visible number
// through the chart-display formatter (chartFormat.js), which is bounded and
// edge-case safe and NEVER honours `full` precision — so the chart can never
// render unreadable noise like "0.00000000000000000". The PUBLICATION export
// (svgBuilders.js) and CSV/report export keep their own user-configurable
// precision; chart ≠ export by construction.
import { chartNum, chartES, chartI2, chartWeight, chartP, chartAxisTick } from "../../../research-engine/format/chartFormat.js";
// 117.md §24 — a figure may carry its OWN decimal precision, overriding the
// project setting for this plot only. normalizePrecision is the single interpreter
// of the stored object (116.md §29), so the override merges into it, never beside it.
import { normalizePrecision } from "../../../research-engine/format/precision.js";
// 116.md §22-§25 (D15) — ALL forest geometry now comes from ONE pure module that
// the publication builder (svgBuilders.js) shares. This component is a SKIN: it
// decides colours and fonts, never coordinates. See forestLayout.js's header for
// the contract and the invariants it guarantees (null always inside the domain,
// measure-aware ticks, explicit out-of-scale arrows, de-collided labels).
import { computeForestLayout } from "../../../research-engine/charts/forestLayout.js";

/**
 * 117.md §23-§25 — every presentation prop below comes from ONE persisted record
 * (`resolveForestFigure`), spread by the caller. This component decides colours
 * and fonts; it never decides WHAT is shown and it never touches a value: the
 * effect sizes, CIs and weights are rendered straight off `result` (116.md §124).
 */
export function ForestPlot({result,esLabel="",nullLine=null,esType="",showCounts=true,showWeights=true,showPI=true,svgId="forestplot-svg",prec,decimals=null,metrics=null,live=false,theme="night",title="",subtitle="",note="",favLow="",favHigh=""}){
  if(!result) return(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
    <div style={{fontSize:32,marginBottom:8}}>🌲</div>Enter effect sizes for at least 2 studies to generate a forest plot
  </div>);
  const{I2,Q,Qpval,tau2,k,pval}=result;
  // 117.md §24 — the per-figure decimal override, resolved once. `null` ⇒ the
  // project setting is used unchanged, so an unconfigured figure is untouched.
  const P=decimals==null?prec:{...normalizePrecision(prec),decimals};
  // prompt19 / 56.md §10 — the LIVE on-screen plot follows the app theme TOKENS (C),
  // so it harmonizes with the legacy day/night themes AND the Stitch light/dark
  // themes (incl. a custom admin brand) exactly like the funnel plot — no fixed
  // indigo palette. The EXPORT render (live=false) keeps the absolute dark hex so
  // the downloaded "Dark (screen)" artifact never changes; the white "Light
  // (publication)" export is a separate builder (svgBuilders.js) and is untouched.
  const DARK={txt:"#eaecf6",dim:"#253050",brd:"#1f2640",muted:"#536080",acc:"#818cf8",grn:"#34d399"};
  const LIVE={txt:C.txt,dim:C.dim,brd:C.brd,muted:C.muted,acc:C.acc,grn:C.grn};
  const FC=live?LIVE:DARK;
  const BG=live?C.card:"#0e1420";
  const nullGrid=live?themeAlpha(C.acc,'40'):"#38bdf855";
  const liveBorder=live?C.brd:"#1f2640";
  const isLog=esType&&ES_TYPES[esType]&&ES_TYPES[esType].log;
  const isProp=esType==="PROP";
  const bt=x=>{ if(isLog)return Math.exp(x); if(isProp){const e=Math.exp(x);return e/(1+e);} return x; };
  const fmtV=(x,pr)=>isProp?chartES(bt(x)*100,pr||P)+"%":(isLog?chartES(bt(x),pr||P):chartES(x,pr||P));
  // 116.md §22 — the heterogeneity/model footer is handed to the layout engine as
  // TEXT so it can wrap it to the content width and size the canvas around it
  // (an unwrapped single line used to run past the right edge on a narrow plot).
  const hetLine=`Heterogeneity: I² = ${chartI2(I2)}%  ·  τ² = ${chartNum(tau2,P)}  ·  Q = ${chartNum(Q,P)} (df = ${k-1}, p ${Qpval<0.001?"< 0.001":"= "+chartNum(Qpval,P)})  ·  overall p ${pval<0.001?"< 0.001":"= "+chartNum(pval,P)}`;
  const modelLine=`Filled diamond: ${result.method==="fixed"?"common / fixed effect":"random effects"}${result.hksj?`  ·  HKSJ 95% CI: ${fmtV(result.hksj.lo,P)} to ${fmtV(result.hksj.hi,P)} (t-based)`:""}`;
  const L=computeForestLayout(result,{
    variant:"live",esType,showCounts,showWeights,showPI,title,subtitle,esLabel,favLow,favHigh,nullLine,metrics,
    // 116.md §22 — the layout builds the "ES [95% CI]" cells with THIS formatter, so
    // the string it measures (and sizes the effect column around) is the string drawn
    // below. A raw-unit mean difference no longer lands on top of the weight columns.
    formatValue:v=>fmtV(v,P),
    // 117.md §24 — the reviewer's figure note is a THIRD footer line, wrapped and
    // canvas-sized by the same engine (empty entries are dropped by the layout).
    footerTexts:[hetLine,modelLine,note],
  });
  if(!L) return(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
    <div style={{fontSize:32,marginBottom:8}}>🌲</div>Enter effect sizes for at least 2 studies to generate a forest plot
  </div>);
  const{columns:CO,rowsGeom:RG,ticks,rows,diamonds,pi,favours,axisLabel,footerLines}=L;
  const W=L.W,H=L.H;
  const colCounts=L.showCounts;
  /* 117.md §24 — font scaling. The skin owns the ink sizes, so it multiplies its
     OWN literals by the layout's resolved scale; the layout has already scaled the
     same metrics for measurement, so the string it measured is still the string
     printed here. At scale 1 every expression below evaluates to its historical
     literal (fs(11) === 11), so an unconfigured figure renders byte-identically. */
  const FS=Number(L.metrics.fontScale)||1;
  const fs=(n)=>+(n*FS).toFixed(2);
  const tickText=v=>isLog?chartAxisTick(bt(v),{isLog:true}):(isProp?chartAxisTick(bt(v),{isProp:true}):chartAxisTick(v));
  /* 116.md §22 (c) — an interval end outside the visible domain gets an explicit
     truncation arrow (the journal convention); it is NEVER silently clamped onto
     the frame as if the CI stopped there. */
  const endCap=(p,cy,color,key)=>p.clamped
    ? <polygon key={key} points={p.clamped<0?`${p.x},${cy} ${p.x+7},${cy-4} ${p.x+7},${cy+4}`:`${p.x},${cy} ${p.x-7},${cy-4} ${p.x-7},${cy+4}`} fill={color}/>
    : <line key={key} x1={p.x} y1={cy-4} x2={p.x} y2={cy+4} stroke={color} strokeWidth={1.5}/>;
  const favTri=(f,color)=>(<polygon points={`${f.arrowX},${favours.y-3} ${f.arrowX+f.dir*6},${favours.y-6.5} ${f.arrowX+f.dir*6},${favours.y+0.5}`} fill={color}/>);
  return(<div style={{overflowX:"auto",width:"100%"}}>
    <svg id={svgId} width={live?"100%":W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      style={{fontFamily:"'IBM Plex Mono',monospace",background:BG,borderRadius:8,display:"block",
        // prompt39 Task 4 — the live plot caps at its natural width; margin-inline
        // auto CENTERS that capped block in the (wider) container instead of
        // left-aligning it. Export render (live=false) is unaffected.
        ...(live?{width:"100%",height:"auto",maxWidth:Math.round(W*1.5),margin:"0 auto",border:`1px solid ${liveBorder}`}:{})}}>
      <rect x={0} y={0} width={W} height={H} fill={BG}/>
      {/* Figure title — 116.md §26/§32: the on-screen plot shows the same title the
          export prints, so the preview and the download are the same figure. */}
      {L.title.lines.map((ln,i)=>(
        <text key={"t"+i} x={W/2} y={L.title.y+i*L.title.lead} textAnchor="middle" fontSize={L.title.size} fill={FC.txt} fontWeight={700}>{ln}</text>
      ))}
      {/* 117.md §24 — the optional subtitle, its own smaller centred block. */}
      {L.subtitle.lines.map((ln,i)=>(
        <text key={"st"+i} x={W/2} y={L.subtitle.y+i*L.subtitle.lead} textAnchor="middle" fontSize={L.subtitle.size} fill={FC.muted}>{ln}</text>
      ))}
      {/* Header row */}
      <text x={CO.xName} y={RG.headBottom-6} fontSize={fs(11)} fill={FC.txt} fontWeight={700}>Study</text>
      {colCounts&&<text x={CO.xExp} y={RG.headBottom-18} fontSize={fs(9)} fill={FC.dim} fontWeight={700}>Experimental</text>}
      {colCounts&&<text x={CO.xExp} y={RG.headBottom-6} fontSize={fs(9)} fill={FC.dim}>events / total</text>}
      {colCounts&&<text x={CO.xCtrl} y={RG.headBottom-18} fontSize={fs(9)} fill={FC.dim} fontWeight={700}>Control</text>}
      {colCounts&&<text x={CO.xCtrl} y={RG.headBottom-6} fontSize={fs(9)} fill={FC.dim}>events / total</text>}
      <text x={CO.xEff} y={RG.headBottom-6} fontSize={fs(10)} fill={FC.dim} fontWeight={700}>{isLog||isProp?"Effect [95% CI]":"ES [95% CI]"}</text>
      {showWeights&&<text x={CO.xW} y={RG.headBottom-18} fontSize={fs(9)} fill={FC.dim} fontWeight={700}>Weight</text>}
      {showWeights&&<text x={CO.xW} y={RG.headBottom-6} fontSize={fs(9)} fill={FC.dim}>(common)</text>}
      {showWeights&&<text x={CO.xW2} y={RG.headBottom-18} fontSize={fs(9)} fill={FC.dim} fontWeight={700}>Weight</text>}
      {showWeights&&<text x={CO.xW2} y={RG.headBottom-6} fontSize={fs(9)} fill={FC.dim}>(random)</text>}
      <line x1={CO.xName} y1={RG.headBottom} x2={W-6} y2={RG.headBottom} stroke={FC.brd}/>
      {/* grid + null line (the layout engine guarantees the null is INSIDE the domain) */}
      {ticks.map(t=><line key={"g"+t.v} x1={t.x} y1={RG.rowsTop} x2={t.x} y2={RG.bandBottom} stroke={t.isNull?nullGrid:FC.brd} strokeWidth={t.isNull?1.5:0.5} strokeDasharray={t.isNull?"none":"3,3"}/>)}
      {L.nullLine.show&&<line x1={L.nullLine.x} y1={RG.rowsTop} x2={L.nullLine.x} y2={RG.yPI+8} stroke={FC.muted} strokeWidth={1}/>}
      {rows.map((r)=>{
        const cy=r.markerY,sq=r.size;
        return(<g key={r.id}>
          <text x={CO.xName} y={r.y} fontSize={fs(11)} fill={FC.txt}>{r.name}</text>
          {colCounts&&<text x={CO.xExp} y={r.y} fontSize={fs(10)} fill={FC.muted}>{r.counts.exp}</text>}
          {colCounts&&<text x={CO.xCtrl} y={r.y} fontSize={fs(10)} fill={FC.muted}>{r.counts.ctrl}</text>}
          <line x1={r.lo.x} y1={cy} x2={r.hi.x} y2={cy} stroke={FC.acc} strokeWidth={1.5}/>
          {endCap(r.lo,cy,FC.acc,"lo")}
          {endCap(r.hi,cy,FC.acc,"hi")}
          {r.es.clamped
            ? <polygon points={r.es.clamped<0?`${r.es.x},${cy} ${r.es.x+sq},${cy-sq/2} ${r.es.x+sq},${cy+sq/2}`:`${r.es.x},${cy} ${r.es.x-sq},${cy-sq/2} ${r.es.x-sq},${cy+sq/2}`} fill={FC.acc}/>
            : <rect x={r.es.x-sq/2} y={cy-sq/2} width={sq} height={sq} fill={FC.acc} rx={1}/>}
          <text x={CO.xEff} y={r.y} fontSize={fs(10)} fill={FC.muted}>{r.esText}</text>
          {showWeights&&<text x={CO.xW} y={r.y} fontSize={fs(10)} fill={FC.dim}>{chartWeight(r.weightFixedPct)}%</text>}
          {showWeights&&<text x={CO.xW2} y={r.y} fontSize={fs(10)} fill={FC.dim}>{chartWeight(r.weightRandomPct)}%</text>}
        </g>);
      })}
      <line x1={CO.xName} y1={RG.ySep} x2={W-6} y2={RG.ySep} stroke={FC.brd}/>
      {/* 116.md §32 — BOTH pooled diamonds, exactly like the publication figure;
          the selected model is the filled one. A reviewer can now see on screen
          what the exported file will contain. */}
      {diamonds.map(d=>(
        <g key={d.key}>
          <text x={CO.xName} y={d.y} fontSize={fs(11)} fill={d.strong?FC.grn:FC.muted} fontWeight={d.strong?700:400}>{d.label}</text>
          <polygon points={`${d.es.x},${d.markerY-d.height} ${d.hi.x},${d.markerY} ${d.es.x},${d.markerY+d.height} ${d.lo.x},${d.markerY}`}
            fill={d.strong?FC.grn:"none"} stroke={FC.grn} strokeWidth={1.1} opacity={d.strong?0.9:1}/>
          <text x={CO.xEff} y={d.y} fontSize={fs(10)} fill={d.strong?FC.grn:FC.muted} fontWeight={d.strong?700:400}>{d.esText}</text>
          {showWeights&&<text x={d.key==="fixed"?CO.xW:CO.xW2} y={d.y} fontSize={fs(10)} fill={d.strong?FC.grn:FC.dim}>100%</text>}
        </g>
      ))}
      {/* 116.md §22 (c) — the prediction interval is an interval like any other: the
          layout deliberately keeps it OUT of the domain anchors (at small k it is an
          order of magnitude wider than the data), so running past the frame is its
          NORMAL case and it gets the same truncation arrows the study rows and the
          publication builder use. Drawing it flush to the edge with a plain dashed
          line is exactly the silent clamping this stage removed. */}
      {pi&&(<g>
        <text x={CO.xName} y={pi.y} fontSize={fs(9.5)} fill={FC.dim} fontStyle="italic">{pi.label}</text>
        <line x1={pi.lo.x} y1={pi.markerY} x2={pi.hi.x} y2={pi.markerY} stroke={FC.dim} strokeWidth={1.4} strokeDasharray="4,2"/>
        {endCap(pi.lo,pi.markerY,FC.dim,"pilo")}
        {endCap(pi.hi,pi.markerY,FC.dim,"pihi")}
        <text x={CO.xEff} y={pi.y} fontSize={fs(9.5)} fill={FC.dim} fontStyle="italic">{pi.esText}</text>
      </g>)}
      {/* x-axis: its own line below the diamond band, then de-collided ticks */}
      <line x1={CO.xPlot} y1={RG.axisY} x2={CO.xPlotEnd} y2={RG.axisY} stroke={FC.muted} strokeWidth={1}/>
      {ticks.map(t=>(<g key={"tk"+t.v}>
        <line x1={t.x} y1={RG.axisY} x2={t.x} y2={RG.axisY+4} stroke={FC.muted} strokeWidth={0.9}/>
        <text x={t.x} y={RG.tickLabelY} textAnchor="middle" fontSize={fs(10)} fill={FC.muted}>{tickText(t.v)}</text>
      </g>))}
      {/* favours labels — 116.md §25: edge-anchored under the two axis halves, on
          their own row, ellipsised so they can never meet or leave the plot band. */}
      {favours.show&&(<g>
        {favTri(favours.low,FC.dim)}
        <text x={favours.low.x} y={favours.y} textAnchor={favours.low.anchor} fontSize={fs(9)} fill={FC.dim}>{favours.low.text}</text>
        {favTri(favours.high,FC.dim)}
        <text x={favours.high.x} y={favours.y} textAnchor={favours.high.anchor} fontSize={fs(9)} fill={FC.dim}>{favours.high.text}</text>
      </g>)}
      {/* effect-measure label — centered under the plot, on its own row */}
      <text x={CO.xPlot+CO.plotW/2} y={RG.axisLabelY} textAnchor="middle" fontSize={fs(11)} fill={FC.txt} fontWeight={700}>{axisLabel}</text>
      {/* heterogeneity / model footer — prompt50 WS4: every number goes through the
          CHART formatter (bounded, edge-case safe, never `full`). */}
      {footerLines.map((ln,i)=>(
        <text key={"f"+i} x={CO.xName} y={ln.y} fontSize={fs(10)} fill={FC.dim}>{ln.text}</text>
      ))}
    </svg>
  </div>);
}


/* ════════════ FUNNEL PLOT ════════════ */
export function FunnelPlot({studies}){
  var valid = studies.filter(function(s){ return s.es!==""&&s.lo!==""&&s.hi!==""&&!isNaN(+s.es)&&!isNaN(+s.lo)&&!isNaN(+s.hi); });
  if (valid.length < 3) return (<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
    <div style={{fontSize:32,marginBottom:8}}>📉</div>Funnel plot requires at least 3 studies with effect sizes
  </div>);
  var pts = valid.map(function(s){
    var es=+s.es, se=(+s.hi-+s.lo)/(2*1.96);
    return { es:es, se:se, label:(s.author||"Study")+(s.year?" "+s.year:"") };
  });
  // Pooled estimate for the centre line
  var pooled = runMeta(studies, "random");
  var centre = pooled ? pooled.pES : pts.reduce(function(a,p){return a+p.es;},0)/pts.length;
  var maxSE = Math.max.apply(null, pts.map(function(p){return p.se;}))*1.15;
  var allES = pts.map(function(p){return p.es;});
  var dataMin = Math.min.apply(null, allES);
  var dataMax = Math.max.apply(null, allES);
  var halfRange = Math.max(centre-dataMin, dataMax-centre, 1.96*maxSE) * 1.1;
  var minX = centre - halfRange;
  var maxX = centre + halfRange;
  var W=620, H=440, ML=64, MR=20, MT=24, MB=56;
  var plotW=W-ML-MR, plotH=H-MT-MB;
  var xS = function(x){ return ML + ((x-minX)/(maxX-minX))*plotW; };
  var yS = function(se){ return MT + (se/maxSE)*plotH; }; // SE increases downward
  // 95% CI funnel boundaries
  var funnelPts = [];
  var steps = 30;
  for (var i=0; i<=steps; i++){
    var se = (i/steps)*maxSE;
    funnelPts.push({ se:se, lo:centre-1.96*se, hi:centre+1.96*se });
  }
  var leftPath = funnelPts.map(function(p,i){ return (i===0?"M":"L")+xS(p.lo)+","+yS(p.se); }).join(" ");
  var rightPath = funnelPts.slice().reverse().map(function(p){ return "L"+xS(p.hi)+","+yS(p.se); }).join(" ");
  var funnelPath = leftPath + " " + rightPath + " Z";
  // SE ticks
  var seTicks = [];
  for (var t=0; t<=4; t++){ seTicks.push((maxSE*t/4)); }
  // ES ticks
  var esTicks = [];
  var esStep = (maxX-minX)/6;
  for (var et=0; et<=6; et++){ esTicks.push(minX + et*esStep); }
  return (<div style={{overflowX:"auto"}}>
    <svg id="funnelplot-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{fontFamily:"'IBM Plex Mono',monospace",background:C.card,borderRadius:8,display:"block"}}>
      {/* funnel region (shaded 95% CI) */}
      <path d={funnelPath} fill={themeAlpha(C.acc,'15')} stroke={themeAlpha(C.acc,'55')} strokeWidth={1} strokeDasharray="4,4"/>
      {/* centre line */}
      <line x1={xS(centre)} y1={MT} x2={xS(centre)} y2={MT+plotH} stroke={C.grn} strokeWidth={1.5} strokeDasharray="3,3"/>
      {/* axis lines */}
      <line x1={ML} y1={MT} x2={ML} y2={MT+plotH} stroke={C.brd}/>
      <line x1={ML} y1={MT+plotH} x2={ML+plotW} y2={MT+plotH} stroke={C.brd}/>
      {/* SE ticks (y) */}
      {seTicks.map(function(t,i){ return (<g key={i}>
        <line x1={ML-4} y1={yS(t)} x2={ML} y2={yS(t)} stroke={C.brd}/>
        <text x={ML-8} y={yS(t)+4} textAnchor="end" fontSize={10} fill={C.muted}>{chartNum(t,{decimals:3})}</text>
      </g>); })}
      {/* ES ticks (x) */}
      {esTicks.map(function(t,i){ return (<g key={i}>
        <line x1={xS(t)} y1={MT+plotH} x2={xS(t)} y2={MT+plotH+4} stroke={C.brd}/>
        <text x={xS(t)} y={MT+plotH+18} textAnchor="middle" fontSize={10} fill={C.muted}>{chartNum(t,{decimals:2})}</text>
      </g>); })}
      {/* axis labels */}
      <text x={ML+plotW/2} y={H-12} textAnchor="middle" fontSize={11} fill={C.muted}>Effect Size</text>
      <text x={14} y={MT+plotH/2} textAnchor="middle" fontSize={11} fill={C.muted} transform={"rotate(-90,14,"+(MT+plotH/2)+")"}>Standard Error</text>
      {/* points */}
      {pts.map(function(p,i){ return (<g key={i}>
        <circle cx={xS(p.es)} cy={yS(p.se)} r={5} fill={C.acc} stroke={C.bg} strokeWidth={1.5}/>
        <title>{`${p.label} · ES=${chartNum(p.es,{decimals:3})}, SE=${chartNum(p.se,{decimals:3})}`}</title>
      </g>); })}
      <text x={ML+plotW-4} y={MT+12} textAnchor="end" fontSize={10} fill={C.dim}>Pooled: {chartNum(centre,{decimals:3})}</text>
    </svg>
  </div>);
}
