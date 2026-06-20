/* ════════════ FOREST + FUNNEL PLOTS ════════════
   React SVG chart components extracted VERBATIM from meta-lab-3-patched.jsx
   (prompt46 Phase 4). The LIVE on-screen plots follow the app theme tokens (C);
   the white publication export is a separate string builder (svgBuilders.js). */
import { alpha as themeAlpha } from "../../theme/tokens.js";
import { C } from "../ui/styles.js";
import { runMeta } from "../../../research-engine/statistics/monolithStats.js";
import { ES_TYPES } from "../../../research-engine/project-model/monolithConstants.js";
import { fmtNum, fmtES, fmtI2, fmtWeight, normalizePrecision } from "../../../research-engine/format/precision.js";

export function ForestPlot({result,esLabel="Effect Size",nullLine=0,esType="",showCounts=true,showWeights=true,svgId="forestplot-svg",prec,live=false,theme="night"}){
  if(!result) return(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
    <div style={{fontSize:32,marginBottom:8}}>🌲</div>Enter effect sizes for at least 2 studies to generate a forest plot
  </div>);
  const{studies,pES,lo95,hi95,I2,Q,Qpval,tau2,k,pval}=result;
  // prompt19 — the LIVE on-screen plot follows the app theme (day=light, night=dark)
  // and scales to its container; the EXPORT render (live=false) keeps the absolute
  // dark hex so the downloaded "Dark (screen)" artifact never changes. The white
  // "Light (publication)" export is a separate builder and is untouched.
  const DARK={txt:"#eaecf6",dim:"#253050",brd:"#1f2640",muted:"#536080",acc:"#818cf8",grn:"#34d399"};
  const LIGHT={txt:"#0f172a",dim:"#64748b",brd:"#e2e8f0",muted:"#64748b",acc:"#4f46e5",grn:"#059669"};
  const dayLive=live&&theme==="day";
  const FC=dayLive?LIGHT:DARK;
  const BG=dayLive?"#ffffff":"#0e1420";
  const isLog=esType&&ES_TYPES[esType]&&ES_TYPES[esType].log;
  const isProp=esType==="PROP";
  const bt=x=>{ if(isLog)return Math.exp(x); if(isProp){const e=Math.exp(x);return e/(1+e);} return x; };
  const fmtV=(x,pr)=>isProp?(bt(x)*100).toFixed(normalizePrecision(pr||prec).decimals)+"%":(isLog?fmtES(bt(x),pr||prec):fmtES(x,pr||prec));
  // does any study actually have count data to show?
  const anyExp=studies.some(s=>s.a!==""&&s.a!=null), anyCtrl=studies.some(s=>s.c!==""&&s.c!=null);
  const colCounts=showCounts&&(anyExp||anyCtrl);
  // ---- layout ----
  const padL=12, nameW=150;
  const cExp=colCounts?70:0, cCtrl=colCounts?70:0;
  const LM=padL+nameW+cExp+cCtrl;            // left block width before the plot
  const plotW=300;
  const cEff=128;                             // "ES [95% CI]" text column
  const cWf=showWeights?54:0, cWr=showWeights?54:0;
  const RM=cEff+cWf+cWr+16;
  const W=LM+plotW+RM;
  const TOP=46, ROW=24, BOT=58, H=TOP+(k+2.6)*ROW+BOT;
  const allVals=[...studies.flatMap(s=>[s._lo,s._hi]),lo95,hi95];
  const minV=Math.min(...allVals)-0.2,maxV=Math.max(...allVals)+0.2,range=(maxV-minV)||1;
  const xS=v=>LM+((Math.max(minV,Math.min(maxV,v))-minV)/range)*plotW,yP=i=>TOP+(i+0.5)*ROW;
  const gridVals=[];
  for(let v=Math.ceil(minV*2)/2;v<=maxV;v+=0.5) gridVals.push(+v.toFixed(1));
  const xPlotEnd=LM+plotW;
  const colEffX=xPlotEnd+10, colWfX=colEffX+cEff, colWrX=colWfX+cWf;
  // prompt20 Task 4 — stack the x-axis annotations on SEPARATE rows so the
  // centered effect-measure label (e.g. "SMD") never overlaps the "← favours /
  // favours →" labels that flank the null line (they previously shared one y).
  const yAxisTicks=TOP+(k+1.5)*ROW;   // back-transformed tick numbers
  const yFavours=yAxisTicks+16;        // favours arrows, flanking the null line
  const yEsLabel=yFavours+17;          // effect-measure label, centered, own row
  const yHetero=yEsLabel+20;           // heterogeneity summary, below everything
  return(<div style={{overflowX:"auto",width:"100%"}}>
    <svg id={svgId} width={live?"100%":W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      style={{fontFamily:"'IBM Plex Mono',monospace",background:BG,borderRadius:8,display:"block",
        // prompt39 Task 4 — the live plot caps at its natural width; margin-inline
        // auto CENTERS that capped block in the (wider) container instead of
        // left-aligning it. Export render (live=false) is unaffected.
        ...(live?{width:"100%",height:"auto",maxWidth:Math.round(W*1.5),margin:"0 auto",border:`1px solid ${dayLive?"#e2e8f0":"#1f2640"}`}:{})}}>
      <rect x={0} y={0} width={W} height={H} fill={BG}/>
      {/* Header row */}
      <text x={padL} y={26} fontSize={11} fill={FC.txt} fontWeight={700}>Study</text>
      {colCounts&&<text x={padL+nameW} y={20} fontSize={9} fill={FC.dim} fontWeight={700}>Experimental</text>}
      {colCounts&&<text x={padL+nameW} y={32} fontSize={9} fill={FC.dim}>events / total</text>}
      {colCounts&&<text x={padL+nameW+cExp} y={20} fontSize={9} fill={FC.dim} fontWeight={700}>Control</text>}
      {colCounts&&<text x={padL+nameW+cExp} y={32} fontSize={9} fill={FC.dim}>events / total</text>}
      <text x={colEffX} y={26} fontSize={10} fill={FC.dim} fontWeight={700}>{isLog||isProp?"Effect [95% CI]":"ES [95% CI]"}</text>
      {showWeights&&<text x={colWfX} y={20} fontSize={9} fill={FC.dim} fontWeight={700}>Weight</text>}
      {showWeights&&<text x={colWfX} y={32} fontSize={9} fill={FC.dim}>(common)</text>}
      {showWeights&&<text x={colWrX} y={20} fontSize={9} fill={FC.dim} fontWeight={700}>Weight</text>}
      {showWeights&&<text x={colWrX} y={32} fontSize={9} fill={FC.dim}>(random)</text>}
      <line x1={padL} y1={TOP-4} x2={W-6} y2={TOP-4} stroke={FC.brd}/>
      {/* grid + null line */}
      {gridVals.map(v=><line key={v} x1={xS(v)} y1={TOP} x2={xS(v)} y2={TOP+k*ROW} stroke={v===nullLine?"#38bdf855":FC.brd} strokeWidth={v===nullLine?1.5:0.5} strokeDasharray={v===nullLine?"none":"3,3"}/>)}
      <line x1={xS(nullLine)} y1={TOP-4} x2={xS(nullLine)} y2={TOP+k*ROW+6} stroke={FC.muted} strokeWidth={1}/>
      {studies.map((s,i)=>{
        const cy=yP(i),x1=xS(s._lo),x2=xS(s._hi),xc=xS(s._es),sq=Math.max(4,Math.min(12,(s._wFixedPct||10)/4+3));
        const expStr=(s.a!==""&&s.a!=null)?`${s.a} / ${(+s.a)+(+s.b||0)||s.nExp||"?"}`:(s.events!==""&&s.events!=null?`${s.events} / ${s.total||"?"}`:"—");
        const ctrlStr=(s.c!==""&&s.c!=null)?`${s.c} / ${(+s.c)+(+s.d||0)||s.nCtrl||"?"}`:"—";
        return(<g key={s.id||i}>
          <text x={padL} y={cy+4} fontSize={11} fill={FC.txt}>{(s.author||"Study").slice(0,20)}{s.year?` ${s.year}`:""}</text>
          {colCounts&&<text x={padL+nameW} y={cy+4} fontSize={10} fill={FC.muted}>{expStr}</text>}
          {colCounts&&<text x={padL+nameW+cExp} y={cy+4} fontSize={10} fill={FC.muted}>{ctrlStr}</text>}
          <line x1={x1} y1={cy} x2={x2} y2={cy} stroke={FC.acc} strokeWidth={1.5}/>
          <line x1={x1} y1={cy-4} x2={x1} y2={cy+4} stroke={FC.acc} strokeWidth={1.5}/>
          <line x1={x2} y1={cy-4} x2={x2} y2={cy+4} stroke={FC.acc} strokeWidth={1.5}/>
          <rect x={xc-sq/2} y={cy-sq/2} width={sq} height={sq} fill={FC.acc} rx={1}/>
          <text x={colEffX} y={cy+4} fontSize={10} fill={FC.muted}>{fmtV(s._es,prec)} [{fmtV(s._lo,prec)}, {fmtV(s._hi,prec)}]</text>
          {showWeights&&<text x={colWfX} y={cy+4} fontSize={10} fill={FC.dim}>{fmtWeight(s._wFixedPct||0,prec)}%</text>}
          {showWeights&&<text x={colWrX} y={cy+4} fontSize={10} fill={FC.dim}>{fmtWeight(s._wRandomPct||0,prec)}%</text>}
        </g>);
      })}
      <line x1={padL} y1={TOP+k*ROW+6} x2={W-6} y2={TOP+k*ROW+6} stroke={FC.brd}/>
      {/* Pooled diamond (selected model) */}
      {(()=>{
        const cy=yP(k+0.4),x1=xS(lo95),x2=xS(hi95),xc=xS(pES),dh=8;
        return(<g>
          <text x={padL} y={cy+4} fontSize={11} fill={FC.grn} fontWeight={700}>{result.method==="fixed"?"Pooled (common)":"Pooled (random)"}</text>
          <polygon points={`${xc},${cy-dh} ${x2},${cy} ${xc},${cy+dh} ${x1},${cy}`} fill={FC.grn} opacity={0.9}/>
          <text x={colEffX} y={cy+4} fontSize={10} fill={FC.grn} fontWeight={700}>{fmtV(pES,prec)} [{fmtV(lo95,prec)}, {fmtV(hi95,prec)}]</text>
          {showWeights&&<text x={colWfX} y={cy+4} fontSize={10} fill={FC.grn}>100%</text>}
          {showWeights&&<text x={colWrX} y={cy+4} fontSize={10} fill={FC.grn}>100%</text>}
        </g>);
      })()}
      {/* axis ticks (back-transformed labels for log/prop) */}
      {gridVals.map(v=><text key={v} x={xS(v)} y={yAxisTicks} textAnchor="middle" fontSize={10} fill={FC.muted}>{isLog?bt(v).toFixed(2):(isProp?(bt(v)*100).toFixed(0)+"%":v)}</text>)}
      {/* favours labels — flank the null line, one row below the ticks */}
      <text x={xS(nullLine)-6} y={yFavours} textAnchor="end" fontSize={9} fill={FC.dim}>← favours</text>
      <text x={xS(nullLine)+6} y={yFavours} textAnchor="start" fontSize={9} fill={FC.dim}>favours →</text>
      {/* effect-measure label — centered under the plot, on its own row */}
      <text x={LM+plotW/2} y={yEsLabel} textAnchor="middle" fontSize={11} fill={FC.txt}>{esLabel}</text>
      {/* heterogeneity line — prompt32 Task 8: route every number through the
          precision helpers so the LIVE plot matches the exported figure (export
          path uses the same fmtI2/fmtNum). I²/weights stay 1dp by convention. */}
      <text x={padL} y={yHetero} fontSize={10} fill={FC.dim}>
        Heterogeneity: I² = {fmtI2(I2,prec)}%  ·  τ² = {fmtNum(tau2,prec)}  ·  Q = {fmtNum(Q,prec)} (p {Qpval<0.001?"< 0.001":"= "+fmtNum(Qpval,prec)})  ·  overall p {pval<0.001?"< 0.001":"= "+fmtNum(pval,prec)}
      </text>
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
        <text x={ML-8} y={yS(t)+4} textAnchor="end" fontSize={10} fill={C.muted}>{t.toFixed(3)}</text>
      </g>); })}
      {/* ES ticks (x) */}
      {esTicks.map(function(t,i){ return (<g key={i}>
        <line x1={xS(t)} y1={MT+plotH} x2={xS(t)} y2={MT+plotH+4} stroke={C.brd}/>
        <text x={xS(t)} y={MT+plotH+18} textAnchor="middle" fontSize={10} fill={C.muted}>{t.toFixed(2)}</text>
      </g>); })}
      {/* axis labels */}
      <text x={ML+plotW/2} y={H-12} textAnchor="middle" fontSize={11} fill={C.muted}>Effect Size</text>
      <text x={14} y={MT+plotH/2} textAnchor="middle" fontSize={11} fill={C.muted} transform={"rotate(-90,14,"+(MT+plotH/2)+")"}>Standard Error</text>
      {/* points */}
      {pts.map(function(p,i){ return (<g key={i}>
        <circle cx={xS(p.es)} cy={yS(p.se)} r={5} fill={C.acc} stroke={C.bg} strokeWidth={1.5}/>
        <title>{`${p.label} · ES=${p.es.toFixed(3)}, SE=${p.se.toFixed(3)}`}</title>
      </g>); })}
      <text x={ML+plotW-4} y={MT+12} textAnchor="end" fontSize={10} fill={C.dim}>Pooled: {centre.toFixed(3)}</text>
    </svg>
  </div>);
}
