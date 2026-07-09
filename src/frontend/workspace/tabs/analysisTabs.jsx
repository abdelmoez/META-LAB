/* ════════════ ANALYSIS / FOREST / SENSITIVITY / SUBGROUP TABS ════════════
   Extracted VERBATIM from meta-lab-3-patched.jsx (prompt46 Phase 6g). Holds:
   AnalysisTab, DataBehindAnalysis, ResearchExport, ResultsWriteup, ForestTab,
   SensitivityTab, SubgroupTab. No logic changes — only the imports below were
   added so the moved code resolves identically.

   Keeps using the monolith-derived shared modules: C/btnS/inp/th/tagS from
   ui/styles.js; SectionHeader/InfoBox/HelpTip from ui/primitives.jsx; the
   monolith-own stats copies from monolithStats.js; ES_TYPES + label maps from
   monolithConstants.js; isNonPrimary from referenceParsers.js; interpretResult
   from projectHelpers.js; the precision formatters; ForestPlot/FunnelPlot from
   charts.jsx; the SVG string builders from svgBuilders.js; exportCore +
   exportDialogBridge for the download/export plumbing. */
import { useState, useEffect, useMemo } from "react";
import { alpha as themeAlpha } from "../../theme/tokens.js";
import { useTheme } from "../../theme/ThemeContext.jsx";
import { rasterizeSvg, downloadBlob, downloadText } from "../../components/exportCore.js";
import { fmtNum, fmtES, fmtP, fmtPct, fmtI2, fmtWeight, normalizePrecision, DECIMAL_OPTIONS } from "../../../research-engine/format/precision.js";
import { isNonPrimary } from "../../../research-engine/import-export/referenceParsers.js";
import { ES_TYPES, DATA_NATURE_LABEL, ADJUST_LABEL, SOURCE_LABEL } from "../../../research-engine/project-model/monolithConstants.js";
import { normalCDF, runMeta, eggersTest, leaveOneOut, trimFill, influenceDiagnostics, subgroupAnalysis, analysisTypeWarnings, CONVERSIONS, checkPoolability, TAU2_METHODS, TAU2_LABELS } from "../../../research-engine/statistics/monolithStats.js";
// P13 — the meta-regression engine ships in the SAME barrel as subgroupAnalysis
// above, but lands CONCURRENTLY. A namespace import keeps `npm run build` green
// whether or not `metaRegression` is present yet (a missing NAMED export would
// break the bundle); MetaRegression reads it off the namespace at runtime and
// degrades gracefully until the engine is wired in. Once landed it "just works".
import * as MonolithStats from "../../../research-engine/statistics/monolithStats.js";
import { openExportDialog } from "../exportDialogBridge.js";
import { SVG_XML_HEADER, presetTag, liveSvgToString, buildPubForestSVG } from "../charts/svgBuilders.js";
import { ForestPlot, FunnelPlot } from "../charts/charts.jsx";
import { BubblePlot, buildBubbleSVG } from "../BubblePlot.jsx";
import { C, btnS, inp, th, tagS } from "../ui/styles.js";
import { SectionHeader, InfoBox, HelpTip } from "../ui/primitives.jsx";
import { interpretResult } from "../projectHelpers.js";

/* ════════════ TAB: ANALYSIS ════════════ */
export function AnalysisTab({project,updateProject,onApplyPrecisionToAll}){
  const studies=Array.isArray(project&&project.studies)?project.studies:[];
  const[method,setMethod]=useState("random");
  // RoadMap/2.md — opt-in τ² estimator (DerSimonian–Laird default keeps existing results).
  // PERSISTED to the project so every pooled view (forest diamond, sensitivity, subgroup,
  // write-up) uses the SAME estimator — otherwise tabs would show contradicting CIs.
  const[localTau2,setLocalTau2]=useState("DL");
  const tau2Method=(project&&project.analysisSettings&&project.analysisSettings.tau2Method)||localTau2;
  const setTau2Method=(v)=>{ setLocalTau2(v); if(updateProject) updateProject(ap=>({...ap,analysisSettings:{...(ap.analysisSettings||{}),tau2Method:v}})); };
  const[showAudit,setShowAudit]=useState(false);
  const[forceShow,setForceShow]=useState(false);
  const[selectedKey,setSelectedKey]=useState("");

  // ── Outcome / time-point selector ─────────────────────────────────────────
  const outcomePairs=useMemo(()=>{
    const seen=new Set(), pairs=[];
    studies.filter(s=>s.es!==""&&!isNaN(+s.es)).forEach(s=>{
      const oc=(s.outcome||"").trim(), tp=(s.timepoint||"").trim();
      const key=`${oc}|||${tp}`;
      if(!seen.has(key)){ seen.add(key); pairs.push({outcome:oc,timepoint:tp,esType:(s.esType||"").trim(),key}); }
    });
    // prompt32 Task 9 — outcomes are organised by NAME. Append the timepoint, and
    // the effect MEASURE only to disambiguate when the same name appears twice, so
    // duplicate-named outcomes never read as one entry.
    const nameCount={};
    pairs.forEach(p=>{const n=(p.outcome||"(unnamed)").toLowerCase();nameCount[n]=(nameCount[n]||0)+1;});
    pairs.forEach(p=>{
      const base=p.outcome||"(unnamed)";
      const dup=nameCount[base.toLowerCase()]>1;
      p.label=base+(p.timepoint?` @ ${p.timepoint}`:"")+(dup&&p.esType?` · ${p.esType}`:"");
    });
    return pairs;
  },[studies]);

  // Derive effective key: auto-use the only outcome when there's exactly one,
  // regardless of whether setSelectedKey has fired yet. This avoids the
  // async-storage race where useState init runs before studies are loaded.
  const effectiveKey = outcomePairs.length===1 ? outcomePairs[0].key : selectedKey;

  // Keep selectedKey in sync when outcome list changes
  useEffect(()=>{
    if(outcomePairs.length===1) setSelectedKey(outcomePairs[0].key);
    else if(outcomePairs.length>1&&selectedKey&&!outcomePairs.find(p=>p.key===selectedKey)) setSelectedKey("");
    else if(outcomePairs.length===0) setSelectedKey("");
  },[outcomePairs.length]);

  const activeOutcome=outcomePairs.find(p=>p.key===effectiveKey)||null;

  const filteredStudies=useMemo(()=>{
    if(!activeOutcome) return [];
    return studies.filter(s=>{
      const oc=(s.outcome||"").trim(), tp=(s.timepoint||"").trim();
      return oc===activeOutcome.outcome && tp===activeOutcome.timepoint && s.es!==""&&!isNaN(+s.es);
    });
  },[studies,activeOutcome]);

  const pool=useMemo(()=>checkPoolability(filteredStudies),[filteredStudies]);
  const result=useMemo(()=>runMeta(filteredStudies,method,{tau2Method}),[filteredStudies,method,tau2Method]);
  const valid=filteredStudies;
  const esType=useMemo(()=>{
    const types=valid.map(s=>s.esType).filter(Boolean);
    return types.length?types.sort((a,b)=>types.filter(t=>t===b).length-types.filter(t=>t===a).length)[0]:"";
  },[valid]);
  const prec = project?.analysisPrecision;
  const interp=useMemo(()=>interpretResult(result,esType,filteredStudies,prec),[result,esType,filteredStudies,prec]);
  const typeWarn=useMemo(()=>analysisTypeWarnings(filteredStudies),[filteredStudies]);
  // The estimator actually used (may differ from the request if it fell back to DL).
  const usedTau2=result?.tau2Method||tau2Method;
  const tauName=TAU2_LABELS[usedTau2]||"DerSimonian–Laird";
  const methodLabel=method==="random"?`Random-effects (${tauName})`:"Fixed-effect (inverse-variance)";

  return(<div>
    <SectionHeader icon="sigma" title="Meta-Analysis" desc="Pool effect sizes by outcome. Select an outcome below — each outcome is analysed separately." badge={valid.length>0?`k = ${valid.length}`:undefined}/>

    {/* ── OUTCOME SELECTOR ── */}
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:14,marginBottom:16}}>
      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:0.5,whiteSpace:"nowrap"}}>ANALYSE OUTCOME</span>
        {outcomePairs.length===0?(
          <span style={{fontSize:12,color:C.dim}}>No studies with an effect size yet — add them in Data Extraction.</span>
        ):outcomePairs.length===1?(
          <span style={{fontSize:12,color:C.grn}}>✓ {activeOutcome?.label||activeOutcome?.outcome||"(unnamed)"}</span>
        ):(
          <select value={selectedKey} onChange={e=>setSelectedKey(e.target.value)}
            style={{...inp,width:"auto",fontSize:12,padding:"5px 10px",flex:1,maxWidth:400}}>
            <option value="">— select an outcome to analyse —</option>
            {outcomePairs.map(p=>(
              <option key={p.key} value={p.key}>
                {p.label||p.outcome||"(unnamed)"}
              </option>
            ))}
          </select>
        )}
        {outcomePairs.length>1&&<span style={{fontSize:11,color:C.muted}}>{outcomePairs.length} outcomes detected</span>}
      </div>
      {outcomePairs.length>1&&!effectiveKey&&(
        <div style={{marginTop:10,background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'44')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"9px 12px",fontSize:12,color:C.txt,lineHeight:1.6}}>
          <strong style={{color:C.yel}}>⚠ Multiple outcomes found across your studies.</strong> Select one outcome above before running the analysis. Pooling different outcomes together (e.g. mortality + readmission) in a single meta-analysis is not methodologically valid.
        </div>
      )}
      {outcomePairs.length>1&&effectiveKey&&(
        <div style={{marginTop:8,fontSize:11,color:C.muted}}>
          Showing {filteredStudies.length} of {studies.filter(s=>s.es!==""&&!isNaN(+s.es)).length} studies with an ES. The others belong to different outcomes and are excluded from this pool.
        </div>
      )}
      {(()=>{
        // Same-cohort (unit-of-analysis) detection within the selected outcome
        const seen={}, dups=[];
        filteredStudies.forEach(s=>{
          const key=((s.author||"").trim().toLowerCase()+"|"+(s.year||"")).replace(/\s+/g," ");
          if(!key||key==="|") return;
          seen[key]=(seen[key]||0)+1;
          if(seen[key]===2) dups.push((s.author||"?")+(s.year?" "+s.year:""));
        });
        return dups.length?(
          <div style={{marginTop:10,background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'44')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"9px 12px",fontSize:12,color:C.txt,lineHeight:1.6}}>
            <strong style={{color:C.yel}}>⚠ Possible unit-of-analysis issue.</strong> {dups.join(", ")} appear{dups.length===1?"s":""} more than once for this outcome. If these are multiple arms or time-points from the <em>same cohort</em>, pooling them as independent studies double-counts participants. Combine arms, pick one time-point, or use a single estimate per cohort.
          </div>
        ):null;
      })()}
    </div>

    {/* SUMMARY OF FINDINGS (all outcomes — only shown when >1 outcome) */}
    {outcomePairs.length>1&&(()=>{
      try{
        const rows=outcomePairs.map(pr=>{
          const subset=studies.filter(s=>(s.outcome||"").trim()===pr.outcome&&(s.timepoint||"").trim()===pr.timepoint&&s.es!==""&&!isNaN(+s.es));
          const r=runMeta(subset,method,{tau2Method});
          const et=subset.map(s=>s.esType).filter(Boolean)[0]||"";
          const tt=ES_TYPES[et]||{};const isLog=!!tt.log,isProp=et==="PROP";
          const bt=x=>isLog?Math.exp(x):isProp?(()=>{const e=Math.exp(x);return e/(1+e);})():x;
          const dv=x=>x==null?"—":isProp?(bt(x)*100).toFixed(normalizePrecision(prec).decimals)+"%":isLog?fmtES(bt(x),prec):fmtES(+x,prec);
          return {pr,r,et,dv,k:subset.length};
        });
        return(
          <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:C.acc,letterSpacing:1,marginBottom:6}}>SUMMARY OF FINDINGS — ALL OUTCOMES</div>
            <div style={{fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.5}}>Each outcome pooled separately ({method==="random"?"random effects":"fixed effect"}). Click a row to switch to that outcome.</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr>
                {["Outcome","Measure","k","Pooled","95% CI","I²"].map((h,i)=>(
                  <th key={h} style={{...th,textAlign:i<2?"left":"right"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map(({pr,r,et,dv,k})=>(
                  <tr key={pr.key} style={{borderBottom:`1px solid ${C.brd}`,cursor:"pointer",background:pr.key===effectiveKey?`${themeAlpha(C.acc,'10')}`:"transparent"}} onClick={()=>setSelectedKey(pr.key)}>
                    <td style={{padding:"6px 10px",fontWeight:pr.key===effectiveKey?700:400}}>{pr.label||pr.outcome||"(unnamed)"}</td>
                    <td style={{padding:"6px 10px",color:C.muted}}>{et?ES_TYPES[et].scale:"—"}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace"}}>{k}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,color:r?C.grn:C.dim}}>{r?dv(r.pES):"—"}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.muted}}>{r?`${dv(r.lo95)} to ${dv(r.hi95)}`:"need ≥2"}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:r&&r.I2>50?C.yel:C.muted}}>{r?r.I2+"%":"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }catch(e){ return null; }
    })()}

    {/* ANALYSIS-TYPE SAFETY CHECK */}
    {typeWarn.length>0&&(
      <div style={{marginBottom:16}}>
        {typeWarn.map((w,i)=>(
          <div key={i} style={{background:w.sev==="error"?"var(--t-red-bg)":"var(--t-yel-bg)",border:`1px solid ${themeAlpha((w.sev==="error"?C.red:C.yel),'66')}`,borderLeft:`4px solid ${w.sev==="error"?C.red:C.yel}`,borderRadius:8,padding:"11px 16px",marginBottom:8}}>
            <div style={{fontSize:12,color:C.txt,lineHeight:1.6}}>
              <strong style={{color:w.sev==="error"?C.red:C.yel}}>{w.sev==="error"?"⛔ Data/measure mismatch: ":"⚠ Check the measure: "}</strong>{w.msg}
            </div>
          </div>
        ))}
      </div>
    )}

    <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
      {[["random","Random Effects"],["fixed","Fixed Effect"]].map(([m,label])=>(
        <button key={m} onClick={()=>setMethod(m)} style={btnS(method===m?"primary":"ghost")}>{label}</button>
      ))}
      <HelpTip text="Random-effects assumes the true effect varies across studies and is the safer default when studies differ. Fixed-effect assumes one common true effect — only justified when studies are very similar."/>
      {/* RoadMap/2.md — τ² estimator selector (random-effects only; DL is the default). */}
      {method==="random"&&(
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:11,color:C.muted,whiteSpace:"nowrap"}}>τ² estimator:</span>
          <select value={tau2Method} onChange={e=>setTau2Method(e.target.value)} style={{...inp,width:"auto",fontSize:11,padding:"3px 6px"}}>
            {TAU2_METHODS.map(m=><option key={m} value={m}>{TAU2_LABELS[m]}</option>)}
          </select>
          <HelpTip text="How the between-study variance τ² is estimated. DerSimonian–Laird is the default (and what existing results use). REML and Paule–Mandel are common alternatives; small-k or non-converging estimators fall back to DL. Verify key results in R/metafor for regulatory use."/>
          {result&&result.tau2Fallback==="DL"&&<span style={{fontSize:10.5,color:C.yel}}>fell back to DL</span>}
        </span>
      )}
      <span style={{marginLeft:"auto",fontSize:11,color:C.muted}}>{valid.length} of {studies.length} studies usable</span>
      {updateProject&&(()=>{const np=normalizePrecision(prec);return(<div style={{display:"flex",alignItems:"center",gap:8,marginLeft:8,paddingLeft:8,borderLeft:`1px solid ${themeAlpha(C.brd,'88')}`}}>
        <span style={{fontSize:11,color:C.muted,whiteSpace:"nowrap"}}>Decimal places:</span>
        <select value={np.decimals} onChange={e=>updateProject(ap=>({...ap,analysisPrecision:{...np,decimals:Number(e.target.value)}}))} style={{...inp,width:"auto",fontSize:11,padding:"3px 6px"}}>
          {DECIMAL_OPTIONS.map(d=><option key={d} value={d}>{d}</option>)}
        </select>
        <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:C.muted,cursor:"pointer",whiteSpace:"nowrap"}}>
          <input type="checkbox" checked={np.trailingZeros} onChange={e=>updateProject(ap=>({...ap,analysisPrecision:{...np,trailingZeros:e.target.checked}}))} style={{accentColor:C.acc}}/>trailing zeros
        </label>
        {onApplyPrecisionToAll&&<button onClick={()=>onApplyPrecisionToAll({decimals:np.decimals,trailingZeros:np.trailingZeros})} title="Apply this decimal-places setting to every project you can edit" style={{...btnS("ghost"),fontSize:10,padding:"3px 8px",whiteSpace:"nowrap"}}>Apply to all</button>}
      </div>);})()}
    </div>

    {/* POOLABILITY GATE */}
    {(pool.blockers.length>0||pool.warnings.length>0)&&(
      <div style={{marginBottom:16}}>
        {pool.blockers.map((b,i)=>(
          <div key={i} style={{background:"var(--t-red-bg)",border:`1px solid ${C.red}`,borderLeft:`4px solid ${C.red}`,borderRadius:8,padding:"12px 16px",marginBottom:8}}>
            <div style={{fontSize:12,fontWeight:700,color:C.red,marginBottom:4}}>⛔ Pooling may not be valid</div>
            <div style={{fontSize:12,color:C.txt,lineHeight:1.6}}>{b}</div>
          </div>
        ))}
        {pool.warnings.map((w,i)=>(
          <div key={i} style={{background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'55')}`,borderLeft:`4px solid ${C.yel}`,borderRadius:8,padding:"11px 16px",marginBottom:8}}>
            <div style={{fontSize:12,color:C.txt,lineHeight:1.6}}><strong style={{color:C.yel}}>⚠ Check before trusting this result: </strong>{w}</div>
          </div>
        ))}
        {pool.blockers.length>0&&!forceShow&&(
          <button onClick={()=>setForceShow(true)} style={{...btnS("ghost"),fontSize:11,color:C.red,borderColor:themeAlpha(C.red,'55')}}>
            I understand the limitation — show the pooled result anyway
          </button>
        )}
      </div>
    )}

    {!result&&!effectiveKey&&outcomePairs.length>1?(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
      <div style={{fontSize:36,marginBottom:10}}>📊</div>
      <div style={{fontSize:14,marginBottom:6,color:C.txt}}>Select an outcome above to run the analysis</div>
      <div style={{fontSize:12}}>Each outcome must be analysed separately. Choose one from the dropdown.</div>
    </div>):!result?(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
      <div style={{fontSize:36,marginBottom:10}}>📊</div>Enter an effect size and 95% CI for at least 2 studies (Data Extraction tab)
    </div>):(pool.blockers.length>0&&!forceShow)?(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:32,textAlign:"center",color:C.muted}}>
        <div style={{fontSize:32,marginBottom:10}}>🛑</div>
        <div style={{fontSize:14,marginBottom:4,color:C.txt}}>Result hidden until you confirm</div>
        <div style={{fontSize:12,maxWidth:480,margin:"0 auto",lineHeight:1.6}}>The studies appear incompatible to pool (see above). Forcing a pooled number here could be misleading. Fix the data, or click the button above to override.</div>
      </div>
    ):(<div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Headline + heterogeneity */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div style={{background:C.card,border:`2px solid ${themeAlpha(C.grn,'44')}`,borderRadius:8,padding:18}}>
          <div style={{fontSize:10,fontWeight:700,color:C.grn,letterSpacing:1,marginBottom:14,display:"flex",justifyContent:"space-between"}}>
            <span>POOLED EFFECT ({method==="random"?"RE":"FE"})</span>
            {esType&&<span style={{color:C.muted}}>{ES_TYPES[esType]?.scale}</span>}
          </div>
          <div style={{fontSize:40,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.grn,marginBottom:4}}>{fmtES(result.pES,prec)}</div>
          <div style={{fontSize:13,color:C.muted,fontFamily:"'IBM Plex Mono',monospace"}}>95% CI [{fmtES(result.lo95,prec)}, {fmtES(result.hi95,prec)}]</div>
          {interp&&(interp.isRatio||interp.isProp)&&(
            <div style={{fontSize:12,color:C.acc,marginTop:6}}>
              = {interp.isProp?`${fmtPct(interp.pe,prec)}% [${fmtPct(interp.lo,prec)}%, ${fmtPct(interp.hi,prec)}%]`:`${ES_TYPES[esType]?.scale.replace('ln','')} ${fmtES(interp.pe,prec)} [${fmtES(interp.lo,prec)}, ${fmtES(interp.hi,prec)}]`} (back-transformed)
            </div>
          )}
          <div style={{marginTop:10,fontSize:12,color:C.muted}}>z = {fmtNum(result.z,prec)} · SE = {fmtNum(result.pSE,prec)} · k = {result.k}</div>
          <div style={{marginTop:6,padding:"6px 10px",borderRadius:4,background:interp&&!interp.crossesNull?"var(--t-grn-bg)":"var(--t-yel-bg)",display:"inline-block"}}>
            <span style={{fontSize:12,fontWeight:600,color:interp&&!interp.crossesNull?C.grn:C.yel}}>
              p = {fmtP(result.pval,prec)} · {interp&&!interp.crossesNull?"CI excludes no-effect":"CI includes no-effect (inconclusive)"}
            </span>
          </div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:18}}>
          <div style={{fontSize:10,fontWeight:700,color:C.acc,letterSpacing:1,marginBottom:14}}>HETEROGENEITY</div>
          {[{label:"I²",value:`${result.I2}%`,color:result.I2<25?C.grn:result.I2<50?C.yel:C.red,note:result.I2desc+" — variation across studies"},
            {label:"Q (Cochran)",value:fmtNum(result.Q,prec),color:C.txt,note:`df = ${result.k-1} · p ${fmtP(result.Qpval,prec)}`},
            {label:"τ² (tau²)",value:fmtNum(result.tau2,prec),color:C.txt,note:"between-study variance"},
            {label:"τ (tau)",value:fmtNum(result.tau!=null?result.tau:Math.sqrt(result.tau2),prec),color:C.txt,note:"between-study SD (same scale as the effect)"},
          ].map(({label,value,color,note})=>(
            <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`1px solid ${C.brd}`}}>
              <div><span style={{fontSize:12,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace"}}>{label}</span>
                <div style={{fontSize:10,color:C.muted}}>{note}</div></div>
              <span style={{fontSize:18,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color}}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* BOTH POOLED MODELS side-by-side */}
      {result.fixed&&result.random&&(()=>{
        const t=ES_TYPES[esType]||{};const isLog=!!t.log,isProp=esType==="PROP";
        const bt=x=>isLog?Math.exp(x):isProp?(()=>{const e=Math.exp(x);return e/(1+e);})():x;
        const dv=x=>isProp?(bt(x)*100).toFixed(normalizePrecision(prec).decimals)+"%":isLog?fmtES(bt(x),prec):fmtES(+x,prec);
        const Cell=({title,o,active})=>(
          <div style={{flex:1,minWidth:200,background:active?`${themeAlpha(C.grn,'0d')}`:C.bg,border:`1px solid ${active?themeAlpha(C.grn,'55'):C.brd}`,borderRadius:8,padding:"12px 14px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <span style={{fontSize:10,fontWeight:700,letterSpacing:0.5,color:active?C.grn:C.muted}}>{title}</span>
              {active&&<span style={tagS("green")}>shown above</span>}
            </div>
            <div style={{fontSize:20,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:active?C.grn:C.txt}}>{dv(o.es)}</div>
            <div style={{fontSize:11,color:C.muted,fontFamily:"'IBM Plex Mono',monospace"}}>95% CI [{dv(o.lo)}, {dv(o.hi)}]</div>
          </div>);
        return(<div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
          <Cell title="COMMON / FIXED EFFECT" o={result.fixed} active={method==="fixed"}/>
          <Cell title={`RANDOM EFFECTS (${tauName})`} o={result.random} active={method==="random"}/>
          <div style={{flex:1,minWidth:200,display:"flex",alignItems:"center",fontSize:11,color:C.muted,lineHeight:1.5,padding:"0 4px"}}>
            {Math.abs(result.fixed.es-result.random.es)<1e-3
              ? "Both models agree closely — heterogeneity has little impact here."
              : "The two models differ; with notable heterogeneity, prefer the random-effects estimate and report both."}
          </div>
        </div>);
      })()}

      {/* ROBUST ESTIMATES: HKSJ + PREDICTION INTERVAL */}
      {(result.hksj||result.predInt)&&(()=>{
        const t=ES_TYPES[esType]||{};const isLog=!!t.log,isProp=esType==="PROP";
        const bt=x=>isLog?Math.exp(x):isProp?(()=>{const e=Math.exp(x);return e/(1+e);})():x;
        const dv=x=>isProp?(bt(x)*100).toFixed(normalizePrecision(prec).decimals)+"%":isLog?fmtES(bt(x),prec):fmtES(+x,prec);
        const nullV=isLog?1:0; // on display scale
        const hk=result.hksj, pi=result.predInt;
        const hkSig=hk&&((isLog?bt(hk.lo)>1||bt(hk.hi)<1:hk.lo>0||hk.hi<0));
        const dlSig=interp&&!interp.crossesNull;
        const flips=hk&&(hkSig!==dlSig);
        return(<div style={{background:C.card,border:`1px solid ${themeAlpha(C.purp,'44')}`,borderLeft:`3px solid ${C.purp}`,borderRadius:8,padding:16}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <span style={{fontSize:11,fontWeight:700,color:C.purp,letterSpacing:1}}>🛡️ ROBUST ESTIMATES</span>
            <HelpTip text="HKSJ widens the random-effects CI using a t-distribution and is the recommended default when the number of studies is small. The prediction interval shows where the true effect of a future study would likely fall — it reflects heterogeneity, not just uncertainty in the mean."/>
          </div>
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            {hk&&<div style={{flex:1,minWidth:230,background:C.bg,border:`1px solid ${C.brd}`,borderRadius:8,padding:"12px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:0.5,color:C.purp,marginBottom:4}}>HARTUNG–KNAPP–SIDIK–JONKMAN</div>
              <div style={{fontSize:20,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.txt}}>{dv(hk.es)}</div>
              <div style={{fontSize:11,color:C.muted,fontFamily:"'IBM Plex Mono',monospace"}}>95% CI [{dv(hk.lo)}, {dv(hk.hi)}]</div>
              <div style={{fontSize:10,color:C.dim,marginTop:6}}>t({hk.df}) = {fmtNum(hk.t,prec)} · p {fmtP(hk.pval,prec)} · t* = {fmtNum(hk.tcrit,prec)}</div>
            </div>}
            {pi&&<div style={{flex:1,minWidth:230,background:C.bg,border:`1px solid ${C.brd}`,borderRadius:8,padding:"12px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:0.5,color:C.purp,marginBottom:4}}>95% PREDICTION INTERVAL</div>
              <div style={{fontSize:20,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.txt}}>[{dv(pi.lo)}, {dv(pi.hi)}]</div>
              <div style={{fontSize:11,color:C.muted}}>likely range of a future study's true effect</div>
              <div style={{fontSize:10,color:C.dim,marginTop:6}}>t({pi.df}) based · widens with heterogeneity (τ = {fmtNum(result.tau!=null?result.tau:Math.sqrt(result.tau2),prec)})</div>
            </div>}
          </div>
          {flips&&<div style={{marginTop:10,background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'44')}`,borderRadius:6,padding:"8px 12px",fontSize:11,color:C.txt,lineHeight:1.5}}>
            <strong style={{color:C.yel}}>⚠ The HKSJ interval changes the conclusion.</strong> The standard random-effects CI {dlSig?"excludes":"includes"} the null, but the more conservative HKSJ interval {hkSig?"excludes":"includes"} it. With few studies, HKSJ is the more trustworthy result — report it as primary.
          </div>}
          {pi&&result.k>=3&&(()=>{
            const piCrosses=isLog?(bt(pi.lo)<1&&bt(pi.hi)>1):(pi.lo<0&&pi.hi>0);
            return piCrosses&&!interp.crossesNull?(
              <div style={{marginTop:10,fontSize:11,color:C.muted,lineHeight:1.5}}>
                Note: although the pooled CI excludes the null, the <strong style={{color:C.txt}}>prediction interval includes it</strong> — in some future settings the effect could be null or reversed. State this when heterogeneity is present.
              </div>):null;
          })()}
        </div>);
      })()}
        <div style={{background:C.card,border:`1px solid ${themeAlpha(C.acc,'44')}`,borderLeft:`3px solid ${C.acc}`,borderRadius:8,padding:18}}>
          <div style={{fontSize:11,fontWeight:700,color:C.acc,letterSpacing:1,marginBottom:12}}>📖 PLAIN-LANGUAGE INTERPRETATION</div>
          <div style={{fontSize:13,color:C.txt,lineHeight:1.7}}>
            Pooling <strong>{result.k}</strong> studies with a <strong>{methodLabel.toLowerCase()}</strong> model gives {interp.direction} ({interp.ciText}).{interp.magnitude}
            {" "}Heterogeneity is {interp.hetText}.
            {" "}{interp.crossesNull
              ? "Because the confidence interval includes the no-effect value, this analysis does not provide clear evidence of an effect."
              : "The confidence interval excludes the no-effect value, suggesting a statistically detectable effect — though statistical significance is not the same as clinical importance."}
          </div>
          {interp.flags.length>0&&(
            <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.brd}`}}>
              <div style={{fontSize:10,fontWeight:700,color:C.yel,letterSpacing:0.5,marginBottom:8}}>⚠ LIMITATIONS TO STATE</div>
              {interp.flags.map((f,i)=>(
                <div key={i} style={{display:"flex",gap:8,fontSize:12,color:C.muted,marginBottom:5,lineHeight:1.55}}>
                  <span style={{color:C.yel,flexShrink:0}}>•</span><span>{f}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{marginTop:10,fontSize:11,color:C.dim,fontStyle:"italic"}}>This interpretation is generated mechanically from your numbers. It deliberately avoids strong causal language — the final wording is your responsibility.</div>
        </div>
      )}

      {/* HOW WAS THIS CALCULATED — audit trail */}
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,overflow:"hidden"}}>
        <button onClick={()=>setShowAudit(!showAudit)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",background:"transparent",border:"none",cursor:"pointer",color:C.txt}}>
          <span style={{fontSize:12,fontWeight:700}}>🔬 How was this calculated?</span>
          <span style={{color:C.dim,fontSize:13}}>{showAudit?"▲ Hide":"▼ Show audit trail"}</span>
        </button>
        {showAudit&&(<div style={{padding:"0 16px 16px",borderTop:`1px solid ${C.brd}`,fontSize:12,color:C.muted,lineHeight:1.7}}>
          <div style={{marginTop:12,display:"grid",gridTemplateColumns:"140px 1fr",gap:"8px 14px"}}>
            <div style={{fontWeight:700,color:C.txt}}>Data used</div><div>{result.k} studies with a non-missing effect size and 95% CI{valid.length>result.k?` (${valid.length-result.k} more had an ES but no CI and were excluded from weighting)`:""}.</div>
            <div style={{fontWeight:700,color:C.txt}}>Effect measure</div><div>{esType?`${ES_TYPES[esType]?.label} — analysed on the ${ES_TYPES[esType]?.scale} scale.`:"Not explicitly set; values are pooled as raw effect sizes. Set an effect-measure type per study for safer pooling."}</div>
            <div style={{fontWeight:700,color:C.txt}}>Model</div><div>{methodLabel}.</div>
            <div style={{fontWeight:700,color:C.txt}}>Weighting</div><div>{method==="random"?`Inverse-variance weights with τ² (${tauName}) added to each study's variance.`:"Inverse-variance weights (1/SE²)."} SE derived from each 95% CI as (upper − lower) / (2 × 1.96).</div>
            <div style={{fontWeight:700,color:C.txt}}>Heterogeneity</div><div>Cochran's Q = Σwᵢ(yᵢ − ȳ)²; I² = max(0, (Q − df)/Q) × 100; τ² = max(0, (Q − df)/(ΣW − ΣW²/ΣW)).</div>
            <div style={{fontWeight:700,color:C.txt}}>Significance</div><div>z = pooled ES / SE; two-sided p from the standard normal distribution.</div>
            <div style={{fontWeight:700,color:C.txt}}>Transforms</div><div>{esType&&ES_TYPES[esType]?.log?"Ratio measures are pooled on the natural-log scale and back-transformed for display.":esType==="PROP"?"Proportions are pooled on the logit scale and back-transformed.":esType==="COR"?"Correlations are pooled as Fisher's z.":"No transform applied to the stored effect sizes."}</div>
            <div style={{fontWeight:700,color:C.txt}}>Excluded</div><div>{studies.length-result.k} of {studies.length} studies not in this pool ({studies.filter(s=>s.es==="").length} without an effect size{valid.length>result.k?", plus those missing a CI":""}).</div>
          </div>
          <InfoBox color={C.dim}>Computation runs locally in your browser. For a regulatory submission, confirm key results in established software (R <em>metafor</em>, RevMan, or Stata). Random-effects τ² estimators can underestimate uncertainty when k is small — consider this a planning/checking tool.</InfoBox>
        </div>)}
      </div>

      {/* INDIVIDUAL STUDY CONTRIBUTIONS */}
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,overflowX:"auto"}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1,marginBottom:14}}>INDIVIDUAL STUDY CONTRIBUTIONS</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr>{["Study","n","Effect Size","95% CI Lo","95% CI Hi","Weight %","z","p"].map((h,i)=>(
            <th key={h} style={{...th,textAlign:i===0?"left":"right"}}>{h}</th>
          ))}</tr></thead>
          <tbody>{result.studies.map(s=>{
            const z2=s._es/s._se,pv=2*(1-normalCDF(Math.abs(z2)));
            return(<tr key={s.id} style={{borderBottom:`1px solid ${C.brd}`}}>
              <td style={{padding:"6px 10px",fontWeight:500}}>{s.author||"Study"}{s.year?` ${s.year}`:""}</td>
              <td style={{padding:"6px 10px",textAlign:"right",color:C.muted}}>{s.n||"—"}</td>
              <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700}}>{fmtES(s._es,prec)}</td>
              <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.muted}}>{fmtES(s._lo,prec)}</td>
              <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.muted}}>{fmtES(s._hi,prec)}</td>
              <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6}}>
                  <div style={{width:40,height:4,background:C.brd,borderRadius:2,overflow:"hidden"}}>
                    <div style={{width:`${s._pct||0}%`,height:"100%",background:C.acc,borderRadius:2}}/>
                  </div>{fmtWeight(s._pct||0,prec)}%
                </div>
              </td>
              <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.muted}}>{fmtNum(z2,prec)}</td>
              <td style={{padding:"6px 10px",textAlign:"right",color:pv<0.05?C.grn:C.muted}}>{fmtP(pv,prec)}</td>
            </tr>);
          })}
          <tr style={{borderTop:`2px solid ${themeAlpha(C.grn,'55')}`}}>
            <td style={{padding:"8px 10px",color:C.grn,fontWeight:700}}>Pooled ({method==="random"?"RE":"FE"})</td>
            <td style={{padding:"8px 10px",textAlign:"right",color:C.grn}}>—</td>
            <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:800,color:C.grn}}>{fmtES(result.pES,prec)}</td>
            <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{fmtES(result.lo95,prec)}</td>
            <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{fmtES(result.hi95,prec)}</td>
            <td style={{padding:"8px 10px",textAlign:"right",color:C.grn}}>100%</td>
            <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{fmtNum(result.z,prec)}</td>
            <td style={{padding:"8px 10px",textAlign:"right",color:result.pval<0.05?C.grn:C.red,fontWeight:700}}>{fmtP(result.pval,prec)}</td>
          </tr></tbody>
        </table>
      </div>

      {/* DATA BEHIND THIS ANALYSIS */}
      <DataBehindAnalysis result={result} studies={filteredStudies} esType={esType} prec={prec}/>

      {/* RESEARCH-READY EXPORT */}
      <ResearchExport result={result} esType={esType} method={method} studies={filteredStudies} prec={prec}/>

      {/* COPYABLE STRUCTURED OUTPUTS */}
      <ResultsWriteup result={result} interp={interp} esType={esType} method={method} methodLabel={methodLabel} studies={filteredStudies} prec={prec}/>

      {result.I2>50&&<InfoBox color={C.yel}>⚠️ Substantial heterogeneity (I² = {result.I2}%). Explore it on the Subgroup and Sensitivity tabs before relying on the pooled estimate.</InfoBox>}
    </div>)}
  </div>);
}

/* "Data Behind This Analysis" — full provenance of what fed the pooled result */
export function DataBehindAnalysis({result,studies,esType,prec}){
  const[open,setOpen]=useState(false);
  if(!result) return null;
  const usedIds=new Set(result.studies.map(s=>s.id));
  const used=studies.filter(s=>usedIds.has(s.id));
  // excluded = has data intent but not in the pool
  const excluded=studies.filter(s=>!usedIds.has(s.id)).map(s=>{
    let why;
    if(s.es==="") why="No effect size entered";
    else if(s.lo===""||s.hi==="") why="Missing 95% CI (can't be weighted)";
    else if(isNaN(+s.es)||isNaN(+s.lo)||isNaN(+s.hi)) why="Non-numeric effect size or CI";
    else why="Excluded from this pool";
    return {s,why};
  });
  // conversion methods used
  const convMethods=[...new Set(used.flatMap(s=>(s.conversions||[]).map(c=>{
    const d=CONVERSIONS.find(x=>x.id===c.type);return d?d.label:c.type;
  })))];
  const tag=(s)=>{
    if(s.converted) return {t:"Converted",c:"purple"};
    if((s.dataNature||"primary")!=="primary") return {t:DATA_NATURE_LABEL[s.dataNature]||"Non-primary",c:"yellow"};
    if(s.source==="figure") return {t:"Figure-derived",c:"yellow"};
    if((s.adjusted||"unadjusted")!=="unadjusted") return {t:ADJUST_LABEL[s.adjusted]||"Adjusted",c:"blue"};
    if(s.source==="calculated") return {t:"Calculated",c:"yellow"};
    return {t:"Original primary",c:"green"};
  };
  return(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,overflow:"hidden"}}>
    <button onClick={()=>setOpen(!open)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",background:"transparent",border:"none",cursor:"pointer",color:C.txt}}>
      <span style={{fontSize:12,fontWeight:700}}>🗂️ Data Behind This Analysis</span>
      <span style={{color:C.dim,fontSize:13}}>{open?"▲ Hide":`▼ ${used.length} included · ${excluded.length} excluded`}</span>
    </button>
    {open&&(<div style={{padding:"0 16px 16px",borderTop:`1px solid ${C.brd}`}}>
      <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:0.5,margin:"12px 0 8px"}}>VALUES USED IN THE POOL</div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead><tr>{["Study","Outcome","Time","ES","Data nature","Source","Adjustment"].map((h,i)=>(
            <th key={h} style={{...th,textAlign:i===0?"left":"left",padding:"6px 8px"}}>{h}</th>))}</tr></thead>
          <tbody>{used.map(s=>{const tg=tag(s);return(
            <tr key={s.id} style={{borderBottom:`1px solid ${C.brd}`}}>
              <td style={{padding:"6px 8px",fontWeight:500}}>{s.author||"Study"}{s.year?` ${s.year}`:""}{s.needsReview&&<span title="Needs review" style={{color:C.yel,marginLeft:4}}>👁</span>}</td>
              <td style={{padding:"6px 8px",color:C.muted}}>{s.outcome||"—"}</td>
              <td style={{padding:"6px 8px",color:C.muted}}>{s.timepoint||"—"}</td>
              <td style={{padding:"6px 8px",fontFamily:"'IBM Plex Mono',monospace"}}>{fmtES(+s.es,prec)}</td>
              <td style={{padding:"6px 8px"}}><span style={tagS(tg.c)}>{tg.t}</span></td>
              <td style={{padding:"6px 8px",color:C.muted}}>{SOURCE_LABEL[s.source]||"—"}</td>
              <td style={{padding:"6px 8px",color:C.muted}}>{ADJUST_LABEL[s.adjusted]||"Unadjusted"}</td>
            </tr>);})}</tbody>
        </table>
      </div>

      {convMethods.length>0&&(<div style={{marginTop:14}}>
        <div style={{fontSize:11,fontWeight:700,color:C.purp,letterSpacing:0.5,marginBottom:6}}>⇄ CONVERSION METHODS USED</div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {convMethods.map((m,i)=><div key={i} style={{fontSize:12,color:C.muted}}>• {m}</div>)}
        </div>
      </div>)}

      {excluded.length>0&&(<div style={{marginTop:14}}>
        <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:0.5,marginBottom:6}}>EXCLUDED FROM THIS POOL</div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {excluded.map(({s,why})=>(
            <div key={s.id} style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.muted,padding:"4px 0",borderBottom:`1px solid ${C.brd}`}}>
              <span>{s.author||"Untitled study"}{s.year?` (${s.year})`:""}</span>
              <span style={{color:C.dim}}>{why}</span>
            </div>
          ))}
        </div>
      </div>)}

      {(()=>{
        const nonPrim=used.filter(isNonPrimary).length;
        const warns=[];
        if(nonPrim>0) warns.push(`${nonPrim} of ${used.length} pooled values are non-primary, converted, figure-derived, or adjusted.`);
        const needRev=used.filter(s=>s.needsReview).length;
        if(needRev>0) warns.push(`${needRev} pooled value${needRev===1?" is":"s are"} still flagged for second-reviewer confirmation.`);
        const noRob=used.filter(s=>Object.keys(s.rob||{}).length===0).length;
        if(noRob>0) warns.push(`${noRob} pooled stud${noRob===1?"y has":"ies have"} no risk-of-bias assessment.`);
        return warns.length>0?(
          <div style={{marginTop:14,background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'44')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"10px 12px"}}>
            <div style={{fontSize:10,fontWeight:700,color:C.yel,letterSpacing:0.5,marginBottom:6}}>⚠ WARNINGS AFFECTING INTERPRETATION</div>
            {warns.map((w,i)=><div key={i} style={{fontSize:12,color:C.muted,marginBottom:3,lineHeight:1.5}}>• {w}</div>)}
          </div>
        ):(
          <div style={{marginTop:14,fontSize:12,color:C.grn}}>✓ All pooled values are directly-reported primary data with risk-of-bias assessed.</div>
        );
      })()}
    </div>)}
  </div>);
}

/* ════════════ RESEARCH-READY EXPORT ════════════ */
/* Builds study-level + pooled + heterogeneity tables and offers copy / CSV / Excel(.xls) / publication table */
export function ResearchExport({result,esType,method,studies,prec}){
  const[copied,setCopied]=useState("");
  const[showTable,setShowTable]=useState(false);
  if(!result) return null;
  const t=ES_TYPES[esType]||{};
  const isLog=!!t.log, isProp=esType==="PROP";
  const measureName=t.label||"Effect size";
  const scale=t.scale||"ES";
  const ratioName=scale.replace("ln","");        // OR / RR / HR
  const transform=isLog?"natural-log, back-transformed for display":isProp?"logit, back-transformed to %":esType==="COR"?"Fisher's z":"none";
  const bt=x=>isLog?Math.exp(x):isProp?(()=>{const e=Math.exp(x);return e/(1+e);})():x;
  const dispVal=x=>isProp?(bt(x)*100).toFixed(normalizePrecision(prec).decimals)+"%":isLog?fmtES(bt(x),prec):fmtES(+x,prec);

  // build per-study rows
  const expTot=s=>(s.a!==""&&s.a!=null)?`${s.a}/${(+s.a)+(+s.b||0)||s.nExp||"?"}`:(s.events!==""&&s.events!=null?`${s.events}/${s.total||"?"}`:"");
  const ctrlTot=s=>(s.c!==""&&s.c!=null)?`${s.c}/${(+s.c)+(+s.d||0)||s.nCtrl||"?"}`:"";
  const rows=result.studies.map(s=>({
    study:(s.author||"Study")+(s.year?` ${s.year}`:""),
    exp:expTot(s), ctrl:ctrlTot(s),
    es:dispVal(s._es),
    ci:`${dispVal(s._lo)} to ${dispVal(s._hi)}`,
    raw_es:s._es.toFixed(4), raw_lo:s._lo.toFixed(4), raw_hi:s._hi.toFixed(4),
    wF:fmtWeight(s._wFixedPct||0,prec), wR:fmtWeight(s._wRandomPct||0,prec),
  }));
  const anyCounts=rows.some(r=>r.exp||r.ctrl);
  const fx=result.fixed, rnd=result.random;
  const poolLine=(label,o)=>`${label}: ${dispVal(o.es)} (95% CI ${dispVal(o.lo)} to ${dispVal(o.hi)})`;

  // ---- TSV for clipboard / Excel paste ----
  const head=["Study",...(anyCounts?["Experimental (n/N)","Control (n/N)"]:[]),
    isLog||isProp?`${isProp?"Proportion":ratioName}`:"Effect size","95% CI lower","95% CI upper","Weight common (%)","Weight random (%)"];
  const tsvRows=rows.map(r=>[r.study,...(anyCounts?[r.exp,r.ctrl]:[]),
    r.es, dispVal(+r.raw_lo), dispVal(+r.raw_hi), r.wF, r.wR].join("\t"));
  const tsv=[head.join("\t"),...tsvRows,
    "",
    [`Pooled (common/fixed)`,...(anyCounts?["",""]:[]),dispVal(fx.es),dispVal(fx.lo),dispVal(fx.hi),"100",""].join("\t"),
    [`Pooled (random)`,...(anyCounts?["",""]:[]),dispVal(rnd.es),dispVal(rnd.lo),dispVal(rnd.hi),"","100"].join("\t"),
  ].join("\n");

  // ---- CSV ----
  const esc=v=>{const x=String(v==null?"":v).replace(/"/g,'""');return /[",\n]/.test(x)?`"${x}"`:x;};
  const csvHead=["Study",...(anyCounts?["Experimental_n_N","Control_n_N"]:[]),
    "EffectSize_display","CI_lower_display","CI_upper_display","ES_analysisScale","CIlo_analysisScale","CIhi_analysisScale","Weight_common_pct","Weight_random_pct"];
  const csvRows=rows.map(r=>[r.study,...(anyCounts?[r.exp,r.ctrl]:[]),r.es,dispVal(+r.raw_lo),dispVal(+r.raw_hi),r.raw_es,r.raw_lo,r.raw_hi,r.wF,r.wR].map(esc).join(","));
  const meta=[
    "",
    esc("Meta-analysis summary"),
    `${esc("Effect measure")},${esc(measureName)}`,
    `${esc("Model reported")},${esc(method==="fixed"?"Fixed/common effect":`Random effects (${TAU2_LABELS[result.tau2Method||"DL"]})`)}`,
    `${esc("Transformation")},${esc(transform)}`,
    `${esc("Studies (k)")},${result.k}`,
    `${esc("Pooled common/fixed")},${esc(dispVal(fx.es))},${esc(dispVal(fx.lo))},${esc(dispVal(fx.hi))}`,
    `${esc("Pooled random")},${esc(dispVal(rnd.es))},${esc(dispVal(rnd.lo))},${esc(dispVal(rnd.hi))}`,
    result.hksj?`${esc("Pooled random HKSJ (t-based)")},${esc(dispVal(result.hksj.es))},${esc(dispVal(result.hksj.lo))},${esc(dispVal(result.hksj.hi))}`:null,
    result.hksj?`${esc("HKSJ t / df / p")},${result.hksj.t},${result.hksj.df},${result.hksj.pval}`:null,
    result.predInt?`${esc("95% Prediction interval")},,${esc(dispVal(result.predInt.lo))},${esc(dispVal(result.predInt.hi))}`:null,
    `${esc("I-squared (%)")},${result.I2}`,
    `${esc("tau-squared")},${result.tau2}`,
    `${esc("tau")},${result.tau!=null?result.tau:Math.sqrt(result.tau2)}`,
    `${esc("Cochran Q")},${result.Q}`,
    `${esc("Q df")},${result.k-1}`,
    `${esc("Q p-value")},${result.Qpval}`,
    `${esc("Overall p-value")},${result.pval}`,
  ].filter(Boolean).join("\n");
  const csv="﻿"+[csvHead.join(","),...csvRows].join("\n")+"\n"+meta;

  const copy=(txt,id)=>navigator.clipboard.writeText(txt).then(()=>{setCopied(id);setTimeout(()=>setCopied(""),1800);});

  // ---- Excel-compatible (.xls via HTML table) ----
  const xlsTable=`<table border="1"><thead><tr>${csvHead.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>`+
    rows.map(r=>`<tr><td>${r.study}</td>${anyCounts?`<td>${r.exp}</td><td>${r.ctrl}</td>`:""}<td>${r.es}</td><td>${dispVal(+r.raw_lo)}</td><td>${dispVal(+r.raw_hi)}</td><td>${r.raw_es}</td><td>${r.raw_lo}</td><td>${r.raw_hi}</td><td>${r.wF}</td><td>${r.wR}</td></tr>`).join("")+
    `</tbody></table><br/><table border="1"><tr><td>Effect measure</td><td>${measureName}</td></tr><tr><td>Model</td><td>${method==="fixed"?"Fixed/common":"Random effects"}</td></tr><tr><td>Transformation</td><td>${transform}</td></tr><tr><td>Pooled common</td><td>${dispVal(fx.es)} (${dispVal(fx.lo)} to ${dispVal(fx.hi)})</td></tr><tr><td>Pooled random</td><td>${dispVal(rnd.es)} (${dispVal(rnd.lo)} to ${dispVal(rnd.hi)})</td></tr>${result.hksj?`<tr><td>Pooled random (HKSJ, t-based)</td><td>${dispVal(result.hksj.es)} (${dispVal(result.hksj.lo)} to ${dispVal(result.hksj.hi)}); t(${result.hksj.df})=${result.hksj.t}, p=${result.hksj.pval}</td></tr>`:""}${result.predInt?`<tr><td>95% Prediction interval</td><td>${dispVal(result.predInt.lo)} to ${dispVal(result.predInt.hi)}</td></tr>`:""}<tr><td>I²</td><td>${result.I2}%</td></tr><tr><td>tau²</td><td>${result.tau2}</td></tr><tr><td>tau</td><td>${result.tau!=null?result.tau:Math.sqrt(result.tau2).toFixed(4)}</td></tr><tr><td>Q (df=${result.k-1})</td><td>${result.Q}, p=${result.Qpval}</td></tr></table>`;
  const xlsDoc=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>${xlsTable}</body></html>`;

  return(<div style={{background:C.card,border:`1px solid ${themeAlpha(C.acc,'55')}`,borderRadius:8,padding:16}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:6}}>
      <div style={{fontSize:12,fontWeight:800,color:C.acc,letterSpacing:0.5}}>📤 EXTRACT RESEARCH-READY RESULTS</div>
      <span style={{fontSize:11,color:C.muted}}>{result.k} studies · {measureName}</span>
    </div>
    <div style={{fontSize:11,color:C.muted,marginBottom:14,lineHeight:1.5}}>
      A complete results package — study-level effects with events/totals, 95% CIs, common &amp; random weights, both pooled estimates, heterogeneity, model, measure, and transformation. Copy it straight into a manuscript, abstract, or poster.
    </div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
      <button onClick={()=>copy(tsv,"clip")} style={btnS("primary")}>{copied==="clip"?"✓ Copied table":"📋 Copy table"}</button>
      <button onClick={()=>openExportDialog({
        id:"meta-results",
        title:"Meta-analysis results — meta-analysis_results",
        formats:[{id:"csv",label:"CSV"},{id:"xls",label:"Excel (.xls, HTML-based)"}],
        sizing:false,
        defaults:{format:"csv"},
        run:async(choice)=>{
          if(choice.format==="xls") downloadBlob(new Blob([xlsDoc],{type:"application/vnd.ms-excel"}),"meta-analysis_results.xls");
          else downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8;"}),"meta-analysis_results.csv");
        },
      })} style={btnS("ghost")}>⬇ Export results…</button>
      <button onClick={()=>copy(xlsTable.replace(/<[^>]+>/g,m=>m),"pub")} style={btnS("ghost")}>{copied==="pub"?"✓ Copied HTML":"📋 Copy HTML table"}</button>
      <button onClick={()=>{
        const pubOpts={esType,esLabel:(t.scale||"Effect size")+(isLog?" (back-transformed)":isProp?" (%)":""),nullLine:0,showCounts:anyCounts,showWeights:true,title:"",prec};
        openExportDialog({
          id:"analysis-forest",
          title:"Forest plot (publication, white background)",
          formats:[{id:"png",label:"PNG (raster)"},{id:"svg",label:"SVG (vector)"}],
          sizing:true,
          defaults:{format:"png",presetId:"journal-1col"},
          run:async(choice)=>{
            // prompt32 Task 8 — the export dialog's decimal selector (choice.precision)
            // must drive the exported figure, not the render-time project precision.
            const ep=choice.precision||prec;
            if(choice.format==="svg"){
              const built=buildPubForestSVG(result,{...pubOpts,prec:ep});
              if(!built) throw new Error("Not enough studies to draw the figure.");
              downloadText(SVG_XML_HEADER+built.svg,"forest_publication.svg","image/svg+xml;charset=utf-8");
              return;
            }
            const built=buildPubForestSVG(result,{...pubOpts,prec:ep,noBg:!!choice.transparent});
            if(!built) throw new Error("Not enough studies to draw the figure.");
            const blob=await rasterizeSvg(built.svg,built.W,built.H,
              {targetWidthPx:choice.widthPx,transparent:choice.transparent,background:"#ffffff"});
            downloadBlob(blob,`forest_publication${presetTag(choice)}.png`);
          },
        });
      }} style={btnS("success")}>🖼️ Export forest figure…</button>
      <button onClick={()=>setShowTable(!showTable)} style={btnS("ghost")}>{showTable?"▲ Hide preview":"▼ Preview table"}</button>
    </div>

    {showTable&&(<div style={{overflowX:"auto",border:`1px solid ${C.brd}`,borderRadius:6,marginBottom:6}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
        <thead><tr>
          {["Study",...(anyCounts?["Exp (n/N)","Ctrl (n/N)"]:[]),(isProp?"Proportion":isLog?ratioName:"ES"),"95% CI","Wt common","Wt random"].map((h,i)=>(
            <th key={i} style={{...th,textAlign:i===0?"left":"right",padding:"6px 8px"}}>{h}</th>))}
        </tr></thead>
        <tbody>
          {rows.map((r,i)=>(<tr key={i} style={{borderBottom:`1px solid ${C.brd}`}}>
            <td style={{padding:"5px 8px"}}>{r.study}</td>
            {anyCounts&&<td style={{padding:"5px 8px",textAlign:"right",color:C.muted}}>{r.exp||"—"}</td>}
            {anyCounts&&<td style={{padding:"5px 8px",textAlign:"right",color:C.muted}}>{r.ctrl||"—"}</td>}
            <td style={{padding:"5px 8px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace"}}>{r.es}</td>
            <td style={{padding:"5px 8px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.muted}}>{r.ci}</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:C.dim}}>{r.wF}%</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:C.dim}}>{r.wR}%</td>
          </tr>))}
          <tr style={{borderTop:`2px solid ${themeAlpha(C.grn,'55')}`}}>
            <td style={{padding:"6px 8px",color:C.grn,fontWeight:700}}>Pooled (common)</td>
            {anyCounts&&<td/>}{anyCounts&&<td/>}
            <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn,fontWeight:700}}>{dispVal(fx.es)}</td>
            <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{dispVal(fx.lo)} to {dispVal(fx.hi)}</td>
            <td style={{padding:"6px 8px",textAlign:"right",color:C.grn}}>100%</td><td/>
          </tr>
          <tr>
            <td style={{padding:"6px 8px",color:C.grn,fontWeight:700}}>Pooled (random)</td>
            {anyCounts&&<td/>}{anyCounts&&<td/>}
            <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn,fontWeight:700}}>{dispVal(rnd.es)}</td>
            <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{dispVal(rnd.lo)} to {dispVal(rnd.hi)}</td>
            <td/><td style={{padding:"6px 8px",textAlign:"right",color:C.grn}}>100%</td>
          </tr>
        </tbody>
      </table>
      <div style={{padding:"8px 10px",fontSize:11,color:C.muted,lineHeight:1.6,borderTop:`1px solid ${C.brd}`}}>
        <strong style={{color:C.txt}}>Model:</strong> {method==="fixed"?"Fixed/common effect":`Random effects (${TAU2_LABELS[result.tau2Method||"DL"]})`} · <strong style={{color:C.txt}}>Transformation:</strong> {transform}<br/>
        <strong style={{color:C.txt}}>Heterogeneity:</strong> I² = {result.I2}% · τ² = {result.tau2} · Q = {result.Q} (df = {result.k-1}, p {result.Qpval<0.001?"< 0.001":"= "+result.Qpval}) · overall p {result.pval<0.001?"< 0.001":"= "+result.pval}
      </div>
    </div>)}
    <InfoBox color={C.dim}>Both the common (fixed) and random-effects pooled estimates are included so reviewers can see model sensitivity. The CSV also stores analysis-scale (e.g. log) values for full reproducibility.</InfoBox>
  </div>);
}

/* Copyable manuscript-ready text blocks derived from the analysis */
export function ResultsWriteup({result,interp,esType,method,methodLabel,studies,prec}){
  const[copied,setCopied]=useState("");
  const copy=(t,id)=>navigator.clipboard.writeText(t).then(()=>{setCopied(id);setTimeout(()=>setCopied(""),1800);});
  if(!result||!interp) return null;
  const scale=ES_TYPES[esType]?.scale||"effect size";
  const measureName=ES_TYPES[esType]?.label||"effect size";
  // local display-scale formatter (back-transform log/logit measures)
  const _isLog=!!ES_TYPES[esType]?.log, _isProp=esType==="PROP";
  const _bt=x=>_isLog?Math.exp(x):_isProp?(()=>{const e=Math.exp(x);return e/(1+e);})():x;
  const dispVal=x=>x==null?"—":_isProp?fmtPct(_bt(x),prec)+"%":_isLog?fmtES(_bt(x),prec):fmtES(+x,prec);
  const ciStr=interp.isProp?`${fmtPct(interp.pe,prec)}% (95% CI ${fmtPct(interp.lo,prec)}–${fmtPct(interp.hi,prec)})`
    :interp.isRatio?`${scale.replace('ln','')} ${fmtES(interp.pe,prec)} (95% CI ${fmtES(interp.lo,prec)}–${fmtES(interp.hi,prec)})`
    :`${fmtES(interp.pe,prec)} (95% CI ${fmtES(interp.lo,prec)} to ${fmtES(interp.hi,prec)})`;
  const pStr=result.pval<0.001?"P < 0.001":`P = ${fmtNum(result.pval,prec)}`;

  const methods=`A ${method==="random"?"random-effects":"fixed-effect"} meta-analysis was performed using the ${method==="random"?`${TAU2_LABELS[result.tau2Method||"DL"]} estimator for the between-study variance`:"inverse-variance method"}. Effect sizes were expressed as the ${measureName.toLowerCase()}${ES_TYPES[esType]?.log?", pooled on the natural-logarithmic scale and back-transformed for presentation":""}. Standard errors were derived from reported 95% confidence intervals. Statistical heterogeneity was quantified with the I² statistic and Cochran's Q test, with τ² estimating between-study variance.${result.hksj?" Confidence intervals for the random-effects estimate were additionally calculated using the Hartung-Knapp-Sidik-Jonkman (HKSJ) method, which is recommended when the number of studies is small.":""}${result.predInt?" A 95% prediction interval was calculated to describe the likely range of the true effect in a future study.":""} A two-sided P < 0.05 was considered statistically significant. [State software here — e.g. analyses were verified in R using the metafor package.]`;

  const hkStr=result.hksj?`; HKSJ-adjusted 95% CI ${dispVal(result.hksj.lo)} to ${dispVal(result.hksj.hi)}, t(${result.hksj.df}) = ${fmtNum(result.hksj.t,prec)}, P ${result.hksj.pval<0.001?"< 0.001":"= "+fmtNum(result.hksj.pval,prec)}`:"";
  const piStr=result.predInt?` The 95% prediction interval was ${dispVal(result.predInt.lo)} to ${dispVal(result.predInt.hi)}.`:"";
  const results=`${result.k} studies were pooled. The summary ${scale.replace('ln','')} was ${ciStr}, ${pStr}${hkStr}. Between-study heterogeneity was I² = ${result.I2}% (${result.I2desc}), Cochran's Q ${result.Qpval<0.001?"P < 0.001":"P = "+fmtNum(result.Qpval,prec)}, τ² = ${fmtNum(result.tau2,prec)}.${piStr} ${interp.crossesNull?"The confidence interval included the null value, indicating no statistically significant pooled effect.":"The confidence interval excluded the null value."}`;

  const limitations=`Interpretation is limited by ${[
    result.k<10?`the small number of pooled studies (k = ${result.k})`:null,
    result.I2>=50?`substantial statistical heterogeneity (I² = ${result.I2}%)`:null,
    studies.filter(s=>s.es!==""&&Object.keys(s.rob||{}).length===0).length>0?"incomplete risk-of-bias assessment":null,
    result.k<10?"limited power to assess publication bias":null,
  ].filter(Boolean).join(", ")||"the usual constraints of aggregate-data meta-analysis"}. ${result.I2>=50?"Given the heterogeneity, the pooled estimate should be interpreted as an average across differing study conditions rather than a single common effect.":""}${result.predInt&&(ES_TYPES[esType]?.log?(Math.exp(result.predInt.lo)<1&&Math.exp(result.predInt.hi)>1):(result.predInt.lo<0&&result.predInt.hi>0))?" Notably, the prediction interval crossed the null value, indicating that in some settings the true effect may be absent or reversed.":""}`;

  const forestNote=`Forest plot: each square is a study effect size (square size ∝ weight = ${method==="random"?"1/(SE²+τ²)":"1/SE²"}); horizontal lines are 95% CIs; the diamond is the pooled ${scale.replace('ln','')} (${ciStr})${result.predInt?"; the dashed bar is the 95% prediction interval":""}. Vertical line at the no-effect value (${interp.isRatio?"1 on the ratio scale, 0 on the log scale":"0"}).`;

  const blocks=[
    {id:"results",label:"Results paragraph",icon:"📊",text:results},
    {id:"methods",label:"Statistical methods",icon:"🔬",text:methods},
    {id:"forest",label:"Forest plot caption",icon:"🌲",text:forestNote},
    {id:"limits",label:"Analysis limitations",icon:"⚠️",text:limitations},
  ];
  return(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16}}>
    <div style={{fontSize:11,fontWeight:700,color:C.purp,letterSpacing:1,marginBottom:6}}>✍️ MANUSCRIPT-READY TEXT</div>
    <div style={{fontSize:11,color:C.muted,marginBottom:14,lineHeight:1.5}}>Generated from your current numbers. Copy into your draft and adjust wording — the underlying data never changes when you edit the text.</div>
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {blocks.map(b=>(
        <div key={b.id} style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:"12px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{fontSize:12,fontWeight:700}}>{b.icon} {b.label}</span>
            <button onClick={()=>copy(b.text,b.id)} style={{...btnS("ghost"),fontSize:10,padding:"3px 10px"}}>{copied===b.id?"✓ Copied":"📋 Copy"}</button>
          </div>
          <div style={{fontSize:12.5,color:C.txt,lineHeight:1.7}}>{b.text}</div>
        </div>
      ))}
    </div>
  </div>);
}

/* ════════════ TAB: FOREST PLOT ════════════ */
export function ForestTab({project}){
  const studies=Array.isArray(project&&project.studies)?project.studies:[];
  const{theme}=useTheme(); // prompt19 — live forest plot follows day/night
  const[method,setMethod]=useState("random");
  // RoadMap/2.md recs — use the project-wide τ² estimator so the exported forest
  // diamond matches the Meta-Analysis headline (they must never disagree).
  const tau2Method=(project&&project.analysisSettings&&project.analysisSettings.tau2Method)||"DL";
  const[showCounts,setShowCounts]=useState(true);
  const[showWeights,setShowWeights]=useState(true);
  const[showPubPreview,setShowPubPreview]=useState(false);

  // ── Outcome / time-point selector (same logic as AnalysisTab) ─────────────
  const outcomePairs=useMemo(()=>{
    const seen=new Set(), pairs=[];
    studies.filter(s=>s.es!==""&&!isNaN(+s.es)).forEach(s=>{
      const oc=(s.outcome||"").trim(), tp=(s.timepoint||"").trim();
      const key=`${oc}|||${tp}`;
      if(!seen.has(key)){ seen.add(key); pairs.push({outcome:oc,timepoint:tp,esType:(s.esType||"").trim(),key}); }
    });
    // prompt32 Task 9 — label by outcome NAME; disambiguate by measure on collision.
    const nameCount={};
    pairs.forEach(p=>{const n=(p.outcome||"(unnamed)").toLowerCase();nameCount[n]=(nameCount[n]||0)+1;});
    pairs.forEach(p=>{
      const base=p.outcome||"(unnamed)";
      const dup=nameCount[base.toLowerCase()]>1;
      p.label=base+(p.timepoint?` @ ${p.timepoint}`:"")+(dup&&p.esType?` · ${p.esType}`:"");
    });
    return pairs;
  },[studies]);
  const[selectedKey,setSelectedKey]=useState("");
  useEffect(()=>{
    if(outcomePairs.length===1) setSelectedKey(outcomePairs[0].key);
    else if(outcomePairs.length>1&&!outcomePairs.find(p=>p.key===selectedKey)) setSelectedKey("");
  },[outcomePairs.length]);
  const effectiveKey=outcomePairs.length===1?outcomePairs[0].key:selectedKey;
  const activeOutcome=outcomePairs.find(p=>p.key===effectiveKey)||null;
  const filteredStudies=useMemo(()=>{
    if(!activeOutcome) return [];
    return studies.filter(s=>{
      const oc=(s.outcome||"").trim(), tp=(s.timepoint||"").trim();
      return oc===activeOutcome.outcome && tp===activeOutcome.timepoint && s.es!==""&&!isNaN(+s.es);
    });
  },[studies,activeOutcome]);

  const valid=filteredStudies;
  // auto-detect dominant effect measure from filtered studies
  const esType=useMemo(()=>{const t=valid.map(s=>s.esType).filter(Boolean);return t.length?t.sort((a,b)=>t.filter(x=>x===b).length-t.filter(x=>x===a).length)[0]:"";},[valid]);
  const autoLabel=esType?`${ES_TYPES[esType]?.scale} (effect size)`:"Effect Size";
  const[esLabel,setEsLabel]=useState(autoLabel);
  const[nullLine,setNullLine]=useState(0);
  const[touched,setTouched]=useState(false);
  useEffect(()=>{if(!touched)setEsLabel(autoLabel);},[autoLabel,touched]);
  const result=useMemo(()=>runMeta(filteredStudies,method,{tau2Method}),[filteredStudies,method,tau2Method]);
  const isLog=esType&&ES_TYPES[esType]?.log;
  const safeName=(project.name||"forest").replace(/[^a-z0-9]/gi,"_");
  const outcomeSafeName=(activeOutcome?.outcome||"outcome").replace(/[^a-z0-9]/gi,"_");
  const prec = project?.analysisPrecision;

  return(<div>
    <SectionHeader icon="forest" title="Forest Plot" desc="One forest plot per outcome. Select the outcome to visualise below."/>

    {/* ── OUTCOME SELECTOR ── */}
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:12,marginBottom:14,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:0.5,whiteSpace:"nowrap"}}>OUTCOME</span>
      {outcomePairs.length===0?(
        <span style={{fontSize:12,color:C.dim}}>No studies with an effect size yet.</span>
      ):outcomePairs.length===1?(
        <span style={{fontSize:12,color:C.grn}}>✓ {activeOutcome?.label||activeOutcome?.outcome||"(unnamed)"}</span>
      ):(
        <select value={selectedKey} onChange={e=>setSelectedKey(e.target.value)}
          style={{...inp,width:"auto",fontSize:12,padding:"5px 10px",flex:1,maxWidth:420}}>
          <option value="">— select an outcome —</option>
          {outcomePairs.map(p=>(
            <option key={p.key} value={p.key}>
              {p.label||p.outcome||"(unnamed)"}
            </option>
          ))}
        </select>
      )}
      {filteredStudies.length>0&&<span style={{fontSize:11,color:C.muted,marginLeft:"auto"}}>{filteredStudies.length} studies</span>}
    </div>

    {/* no outcome selected yet */}
    {outcomePairs.length>1&&!effectiveKey&&(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
        <div style={{fontSize:32,marginBottom:10}}>🌲</div>
        <div style={{fontSize:14,marginBottom:6,color:C.txt}}>Select an outcome to draw the forest plot</div>
        <div style={{fontSize:12}}>Each outcome gets its own separate forest plot.</div>
      </div>
    )}
    {/* controls + plot — only when an outcome is selected */}
    {(outcomePairs.length===1||effectiveKey)&&(<>
    <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
      {[["random","Random Effects"],["fixed","Fixed / Common Effect"]].map(([m,label])=>(
        <button key={m} onClick={()=>setMethod(m)} style={btnS(method===m?"primary":"ghost")}>{label}</button>
      ))}
      <div style={{display:"flex",gap:8,marginLeft:"auto",alignItems:"center",flexWrap:"wrap"}}>
        <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.muted,cursor:"pointer"}}>
          <input type="checkbox" checked={showCounts} onChange={e=>setShowCounts(e.target.checked)} style={{accentColor:C.acc}}/>events/total</label>
        <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.muted,cursor:"pointer"}}>
          <input type="checkbox" checked={showWeights} onChange={e=>setShowWeights(e.target.checked)} style={{accentColor:C.acc}}/>weights</label>
        <input value={esLabel} onChange={e=>{setEsLabel(e.target.value);setTouched(true);}} placeholder="X-axis label" style={{...inp,width:170,fontSize:11}}/>
        <label style={{fontSize:11,color:C.muted,whiteSpace:"nowrap"}}>Null:</label>
        <input type="number" value={nullLine} onChange={e=>setNullLine(+e.target.value)} style={{...inp,width:56,textAlign:"center"}}/>
      </div>
    </div>
    {esType&&<div style={{marginBottom:12,fontSize:11,color:C.muted}}>
      Detected measure: <strong style={{color:C.acc}}>{ES_TYPES[esType]?.label}</strong>. {isLog?"Pooled on the log scale; axis ticks and the ES column show back-transformed values. Keep the null line at 0.":esType==="PROP"?"Pooled on the logit scale; shown as percentages.":"Null line at 0 represents no effect."}
    </div>}
    {/* prompt19 — LIVE plot follows the theme + scales to the column width. */}
    <ForestPlot result={result} esLabel={esLabel} nullLine={nullLine} esType={esType} showCounts={showCounts} showWeights={showWeights} svgId="forestplot-live" prec={prec} live theme={theme}/>
    {/* Hidden dark render kept in the DOM as the "Dark (screen)" PNG export source
        (serialized by id) — so the live theme switch never changes that download. */}
    <div aria-hidden="true" style={{position:"absolute",width:0,height:0,overflow:"hidden",left:-99999,top:0,pointerEvents:"none"}}>
      <ForestPlot result={result} esLabel={esLabel} nullLine={nullLine} esType={esType} showCounts={showCounts} showWeights={showWeights} svgId="forestplot-svg" prec={prec}/>
    </div>
    {result&&(()=>{
      const outTitle=`${project.name||""}${activeOutcome?.outcome?` — ${activeOutcome.outcome}`:""}${activeOutcome?.timepoint?` (${activeOutcome.timepoint})`:""}`.trim();
      const pubOpts={esType,esLabel,nullLine,showCounts,showWeights,title:outTitle,prec};
      const exportName=`${safeName}_${outcomeSafeName}_forest_publication`;
      return(<div style={{marginTop:14,background:C.card,border:`1px solid ${themeAlpha(C.grn,'55')}`,borderRadius:8,padding:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:4}}>
          <div style={{fontSize:12,fontWeight:800,color:C.grn,letterSpacing:0.5}}>📄 PUBLICATION-STYLE FIGURE (white background)</div>
          <span style={{fontSize:11,color:C.muted}}>Clean academic style — not a dark-mode screenshot</span>
        </div>
        <div style={{fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.5}}>
          A standalone black-on-white figure: study names, events/totals, the forest plot, effect &amp; 95% CI, both weight columns, common and random pooled diamonds, the heterogeneity line, and a proper axis label. Suitable for manuscripts and posters.
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <button onClick={()=>openExportDialog({
            id:"forest-pub",
            title:`Forest plot — ${(activeOutcome?.outcome||project.name||"figure")}`,
            formats:[{id:"png",label:"PNG (raster)"},{id:"svg",label:"SVG (vector)"}],
            sizing:true,
            variants:[{id:"light",label:"Light (publication)"},{id:"dark",label:"Dark (screen)"}],
            defaults:{format:"png",presetId:"journal-1col",variantId:"light"},
            run:async(choice)=>{
              if(choice.variantId==="dark"){
                // Serialize the LIVE dark plot with computed colors inlined —
                // var(--t-*) must never reach the exported artifact.
                const darkName=`${safeName}_${outcomeSafeName}_forest_dark`;
                if(choice.format==="svg"){
                  const out=liveSvgToString("forestplot-svg",{});
                  downloadText(SVG_XML_HEADER+out.svg,darkName+".svg","image/svg+xml;charset=utf-8");
                  return;
                }
                const out=liveSvgToString("forestplot-svg",{stripBgRect:!!choice.transparent});
                const blob=await rasterizeSvg(out.svg,out.W,out.H,
                  {targetWidthPx:choice.widthPx,transparent:choice.transparent,background:"#0e1420"});
                downloadBlob(blob,`${darkName}${presetTag(choice)}.png`);
                return;
              }
              // prompt32 Task 8 — honor the dialog's decimal selector for the export.
              const ep=choice.precision||prec;
              if(choice.format==="svg"){
                const built=buildPubForestSVG(result,{...pubOpts,prec:ep});
                if(!built) throw new Error("Not enough studies to draw the figure.");
                downloadText(SVG_XML_HEADER+built.svg,exportName+".svg","image/svg+xml;charset=utf-8");
                return;
              }
              const built=buildPubForestSVG(result,{...pubOpts,prec:ep,noBg:!!choice.transparent});
              if(!built) throw new Error("Not enough studies to draw the figure.");
              const blob=await rasterizeSvg(built.svg,built.W,built.H,
                {targetWidthPx:choice.widthPx,transparent:choice.transparent,background:"#ffffff"});
              downloadBlob(blob,`${exportName}${presetTag(choice)}.png`);
            },
          })} style={btnS("success")}>⬇ Export figure…</button>
          <button onClick={()=>setShowPubPreview(v=>!v)} style={{...btnS("ghost"),fontSize:12}}>{showPubPreview?"▲ Hide preview":"👁 Preview"}</button>
        </div>
        {showPubPreview&&(()=>{
          const built=buildPubForestSVG(result,pubOpts);
          return built?(<div style={{marginTop:12,background:"#fff",borderRadius:6,padding:10,overflowX:"auto",border:`1px solid ${C.brd}`}}>
            <div style={{minWidth:built.W,maxWidth:"100%"}} dangerouslySetInnerHTML={{__html:built.svg}}/>
          </div>):null;
        })()}
      </div>);
    })()}
    {/* Dark (screen) version is now a variant inside the export dialog above. */}
    {isLog
      ? <InfoBox>💡 This is a ratio measure shown on the log scale. A study left of the null line favours fewer events; right favours more. The ES column shows the back-transformed ratio.</InfoBox>
      : <InfoBox>💡 Squares left of the null line ({nullLine}) indicate effects in one direction, right of it the other. Set the effect-measure type per study (Data Extraction) so the axis labels itself correctly.</InfoBox>}
    </>)}
  </div>);
}

/* ════════════ TAB: SENSITIVITY ANALYSIS ════════════ */
export function SensitivityTab({project}){
  const studies=Array.isArray(project&&project.studies)?project.studies:[];
  const prec = project?.analysisPrecision;
  const[method,setMethod]=useState("random");
  // RoadMap/2.md recs — sensitivity analyses use the project-wide τ² estimator too.
  const tau2Method=(project&&project.analysisSettings&&project.analysisSettings.tau2Method)||"DL";
  const result=useMemo(()=>runMeta(studies,method,{tau2Method}),[studies,method,tau2Method]);
  const loo=useMemo(()=>leaveOneOut(studies,method,{tau2Method}),[studies,method,tau2Method]);
  const egger=useMemo(()=>eggersTest(studies),[studies]);
  const tf=useMemo(()=>trimFill(studies,method,{tau2Method}),[studies,method,tau2Method]);
  const influence=useMemo(()=>influenceDiagnostics(studies,method,{tau2Method}),[studies,method,tau2Method]);
  const esType=useMemo(()=>{const t=studies.map(s=>s.esType).filter(Boolean);return t.length?t[0]:"";},[studies]);
  // Primary-data-only re-run (exclude converted / non-primary studies)
  const primaryStudies=useMemo(()=>studies.filter(s=>s.es!==""&&!isNaN(+s.es)&&!isNonPrimary(s)),[studies]);
  const nonPrimaryCount=useMemo(()=>studies.filter(s=>s.es!==""&&!isNaN(+s.es)&&isNonPrimary(s)).length,[studies]);
  const primaryResult=useMemo(()=>runMeta(primaryStudies,method,{tau2Method}),[primaryStudies,method,tau2Method]);

  if(!result) return (<div>
    <SectionHeader icon="activity" title="Sensitivity & Publication Bias" desc="Assess robustness and small-study effects. Needs ≥3 studies with effect sizes."/>
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
      <div style={{fontSize:36,marginBottom:10}}>🎯</div>Add at least 3 studies with effect sizes
    </div>
  </div>);

  // Determine influential studies (CI excludes original pooled, or shifts >10%)
  const isInfluential=(s)=>{
    if(s.pES===null) return false;
    const shift=Math.abs(s.pES-result.pES)/Math.abs(result.pES||1);
    return shift>0.10 || (s.lo95>result.pES) || (s.hi95<result.pES);
  };

  return(<div>
    <SectionHeader icon="activity" title="Sensitivity & Publication Bias" desc="Robustness checks: leave-one-out, funnel plot, Egger's test." badge={`k = ${result.k}`}/>
    {result.k<10&&(
      <div style={{background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'44')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"10px 14px",marginBottom:14,fontSize:12,color:C.muted,lineHeight:1.6}}>
        <strong style={{color:C.yel}}>⚠ Only {result.k} studies.</strong> Cochrane and most guidance recommend assessing publication bias (funnel plot, Egger's test) <strong>only when ≥10 studies</strong> are pooled. With fewer, these tests have low power and the funnel is hard to read — interpret the results below with caution and don't over-rely on them.
      </div>
    )}
    <div style={{display:"flex",gap:8,marginBottom:20,alignItems:"center"}}>
      {[["random","Random Effects"],["fixed","Fixed Effects"]].map(([m,label])=>(
        <button key={m} onClick={()=>setMethod(m)} style={btnS(method===m?"primary":"ghost")}>{label}</button>
      ))}
    </div>

    {/* === Leave-One-Out === */}
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:16}}>
      <div style={{fontSize:11,fontWeight:700,color:C.acc,letterSpacing:1,marginBottom:12}}>LEAVE-ONE-OUT ANALYSIS</div>
      <div style={{fontSize:12,color:C.muted,marginBottom:12}}>Pooled estimate when each study is removed. Highlighted rows indicate influential studies (shift &gt;10% or CI excludes original).</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr>
          {["Study Omitted","Pooled ES","95% CI Lo","95% CI Hi","I²","p","Δ from original"].map((h,i)=>(
            <th key={h} style={{...th,textAlign:i===0?"left":"right"}}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {loo.map(s=>{
            const inf=isInfluential(s);
            const delta=s.pES!==null?((s.pES-result.pES)/Math.abs(result.pES||1)*100):null;
            return(<tr key={s.omittedId} style={{borderBottom:`1px solid ${C.brd}`,background:inf?themeAlpha("var(--t-red-bg)","22"):"transparent"}}>
              <td style={{padding:"6px 10px",fontWeight:inf?700:400,color:inf?C.yel:C.txt}}>{inf?"⚠ ":""}{s.omitted}</td>
              <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700}}>{s.pES!==null?fmtES(s.pES,prec):"—"}</td>
              <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.muted}}>{s.lo95!==null?fmtES(s.lo95,prec):"—"}</td>
              <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.muted}}>{s.hi95!==null?fmtES(s.hi95,prec):"—"}</td>
              <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace"}}>{s.I2!==null?s.I2+"%":"—"}</td>
              <td style={{padding:"6px 10px",textAlign:"right",color:s.pval<0.05?C.grn:C.muted}}>{s.pval!==null?fmtP(s.pval,prec):"—"}</td>
              <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:Math.abs(delta||0)>10?C.yel:C.dim}}>{delta!==null?(delta>0?"+":"")+delta.toFixed(1)+"%":"—"}</td>
            </tr>);
          })}
          <tr style={{borderTop:`2px solid ${themeAlpha(C.grn,'55')}`}}>
            <td style={{padding:"8px 10px",color:C.grn,fontWeight:700}}>Original (all studies)</td>
            <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:800,color:C.grn}}>{fmtES(result.pES,prec)}</td>
            <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{fmtES(result.lo95,prec)}</td>
            <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{fmtES(result.hi95,prec)}</td>
            <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{result.I2}%</td>
            <td style={{padding:"8px 10px",textAlign:"right",color:result.pval<0.05?C.grn:C.red,fontWeight:700}}>{fmtP(result.pval,prec)}</td>
            <td style={{padding:"8px 10px",textAlign:"right",color:C.grn}}>—</td>
          </tr>
        </tbody>
      </table>
    </div>

    {/* === Funnel Plot + Egger's === */}
    <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16,marginBottom:16}}>
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:C.acc,letterSpacing:1}}>FUNNEL PLOT</div>
          <button onClick={()=>{
            const funnelSafe=(project.name||"funnel").replace(/[^a-z0-9]/gi,"_");
            openExportDialog({
              id:"funnel-plot",
              title:`Funnel plot — ${project.name||"project"}`,
              formats:[{id:"png",label:"PNG (raster)"},{id:"svg",label:"SVG (vector)"}],
              sizing:true,
              variants:[{id:"light",label:"Light (publication)"},{id:"dark",label:"Dark (screen)"}],
              defaults:{format:"png",presetId:"journal-1col",variantId:"light"},
              run:async(choice)=>{
                // Clone the live theme-colored funnel SVG and inline computed
                // colors to literals — var(--t-*) won't rasterize or export.
                const light=choice.variantId!=="dark";
                const name=`${funnelSafe}_funnel_${light?"light":"dark"}`;
                if(choice.format==="svg"){
                  const out=liveSvgToString("funnelplot-svg",{background:light?"#ffffff":"auto"});
                  downloadText(SVG_XML_HEADER+out.svg,name+".svg","image/svg+xml;charset=utf-8");
                  return;
                }
                const out=liveSvgToString("funnelplot-svg",{background:null});
                const blob=await rasterizeSvg(out.svg,out.W,out.H,
                  {targetWidthPx:choice.widthPx,transparent:choice.transparent,
                   background:light?"#ffffff":(out.bg||"#0e1420")});
                downloadBlob(blob,`${name}${presetTag(choice)}.png`);
              },
            });
          }} style={{...btnS("ghost"),fontSize:11}}>⬇ Export…</button>
        </div>
        <div style={{fontSize:12,color:C.muted,marginBottom:12}}>Asymmetry suggests publication bias or small-study effects. Dashed funnel = 95% pseudo-confidence interval around pooled estimate.</div>
        <FunnelPlot studies={studies}/>
      </div>
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16}}>
        <div style={{fontSize:11,fontWeight:700,color:C.acc,letterSpacing:1,marginBottom:12}}>EGGER'S REGRESSION TEST</div>
        {egger?(<>
          <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Tests funnel-plot asymmetry. Significant intercept (p&lt;0.05) suggests small-study effects.</div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.brd}`}}>
            <span style={{fontSize:12,color:C.muted}}>Intercept</span>
            <span style={{fontFamily:"'IBM Plex Mono',monospace",fontWeight:700}}>{egger.intercept}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.brd}`}}>
            <span style={{fontSize:12,color:C.muted}}>SE of intercept</span>
            <span style={{fontFamily:"'IBM Plex Mono',monospace",color:C.muted}}>{egger.seInt}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.brd}`}}>
            <span style={{fontSize:12,color:C.muted}}>t-statistic</span>
            <span style={{fontFamily:"'IBM Plex Mono',monospace"}}>{egger.t}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.brd}`}}>
            <span style={{fontSize:12,color:C.muted}}>df</span>
            <span style={{fontFamily:"'IBM Plex Mono',monospace",color:C.muted}}>{egger.dof}</span>
          </div>
          <div style={{marginTop:10,padding:"10px 12px",borderRadius:6,background:egger.pval<0.05?"var(--t-red-bg)":"var(--t-grn-bg)"}}>
            <div style={{fontSize:10,color:C.muted,marginBottom:4}}>p-value (two-tailed)</div>
            <div style={{fontSize:22,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:egger.pval<0.05?C.red:C.grn}}>{fmtP(egger.pval,prec)}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:4}}>{egger.pval<0.05?"⚠ Evidence of asymmetry":"✓ No significant asymmetry"}</div>
          </div>
        </>):<div style={{fontSize:12,color:C.muted,padding:12}}>Needs ≥3 studies</div>}
      </div>
    </div>

    <InfoBox color={C.yel}>⚠️ Interpret Egger's test cautiously with k&lt;10 studies (low power). Consider trim-and-fill or Begg's test as complementary methods, and inspect the funnel visually for asymmetry.</InfoBox>

    {/* === TRIM-AND-FILL === */}
    {(()=>{
      const t=ES_TYPES[esType]||{};const isLog=!!t.log,isProp=esType==="PROP";
      const bt=x=>isLog?Math.exp(x):isProp?(()=>{const e=Math.exp(x);return e/(1+e);})():x;
      const dv=x=>isProp?(bt(x)*100).toFixed(normalizePrecision(prec).decimals)+"%":isLog?fmtES(bt(x),prec):fmtES(+x,prec);
      return(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:700,color:C.acc,letterSpacing:1,marginBottom:6}}>TRIM-AND-FILL (Duval &amp; Tweedie)</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:12,lineHeight:1.5}}>Estimates how many studies may be "missing" due to publication bias, imputes their mirror images, and re-pools. A large shift between observed and adjusted estimates signals the conclusion is sensitive to small-study effects.</div>
        {!tf?(<div style={{fontSize:12,color:C.muted,padding:12}}>Needs ≥3 studies.</div>):(
          <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:180,background:C.bg,border:`1px solid ${C.brd}`,borderRadius:8,padding:"12px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:0.5,marginBottom:4}}>OBSERVED ({result.k} studies)</div>
              <div style={{fontSize:20,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{dv(tf.base.pES)}</div>
              <div style={{fontSize:11,color:C.muted,fontFamily:"'IBM Plex Mono',monospace"}}>[{dv(tf.base.lo95)}, {dv(tf.base.hi95)}]</div>
            </div>
            <div style={{flex:1,minWidth:180,background:C.bg,border:`1px solid ${tf.k0>0?themeAlpha(C.yel,'55'):C.brd}`,borderRadius:8,padding:"12px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,color:tf.k0>0?C.yel:C.muted,letterSpacing:0.5,marginBottom:4}}>ADJUSTED (+{tf.k0} imputed)</div>
              <div style={{fontSize:20,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:tf.k0>0?C.yel:C.grn}}>{dv(tf.adjusted.pES)}</div>
              <div style={{fontSize:11,color:C.muted,fontFamily:"'IBM Plex Mono',monospace"}}>[{dv(tf.adjusted.lo95)}, {dv(tf.adjusted.hi95)}]</div>
            </div>
            <div style={{flex:1.4,minWidth:200,display:"flex",alignItems:"center",fontSize:12,color:C.muted,lineHeight:1.55}}>
              {tf.k0===0
                ? "✓ No missing studies were estimated — the funnel is reasonably symmetric and the pooled estimate appears robust to this form of publication bias."
                : `⚠ ${tf.k0} potentially missing stud${tf.k0===1?"y":"ies"} on the ${tf.side} side. After imputing ${tf.k0===1?"it":"them"}, the estimate moves from ${dv(tf.base.pES)} to ${dv(tf.adjusted.pES)}. ${Math.abs(tf.adjusted.pES-tf.base.pES)/Math.abs(tf.base.pES||1)>0.10?"This is a meaningful shift — interpret the pooled result with caution.":"The shift is small, suggesting the conclusion is fairly robust."}`}
            </div>
          </div>
        )}
      </div>);
    })()}

    {/* === INFLUENCE DIAGNOSTICS === */}
    {influence.length>0&&(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:700,color:C.acc,letterSpacing:1,marginBottom:6}}>INFLUENCE DIAGNOSTICS</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:12,lineHeight:1.5}}>Beyond leave-one-out: how much each study moves the pooled estimate (DFFITS, in pooled-SE units) and how much heterogeneity it contributes (drop in I² when removed). |DFFITS| &gt; 1 or an I² drop &gt; 25% flags an influential study.</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr>
            {["Study","DFFITS","Δ I² if removed","Δ τ² if removed","Flag"].map((h,i)=>(
              <th key={h} style={{...th,textAlign:i===0?"left":"right"}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {influence.map(d=>(
              <tr key={d.id} style={{borderBottom:`1px solid ${C.brd}`,background:d.influential?themeAlpha("var(--t-yel-bg)","22"):"transparent"}}>
                <td style={{padding:"6px 10px",fontWeight:d.influential?700:400,color:d.influential?C.yel:C.txt}}>{d.influential?"⚠ ":""}{d.label}</td>
                <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,color:Math.abs(d.dffit)>1?C.yel:C.txt}}>{d.dffit>0?"+":""}{fmtNum(d.dffit,prec)}</td>
                <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:Math.abs(d.i2Drop)>25?C.yel:C.muted}}>{d.i2Drop>0?"−":"+"}{fmtI2(Math.abs(d.i2Drop),prec)}%</td>
                <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.muted}}>{d.tau2Drop>0?"−":"+"}{fmtNum(Math.abs(d.tau2Drop),prec)}</td>
                <td style={{padding:"6px 10px",textAlign:"right"}}>{d.influential?<span style={tagS("yellow")}>influential</span>:<span style={{color:C.dim}}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{fontSize:11,color:C.dim,marginTop:8,lineHeight:1.5}}>Δ I² shows how much heterogeneity a study adds: a large positive drop (I² falls when removed) means that study is a major source of inconsistency.</div>
      </div>
    )}

    {/* === PRIMARY-DATA-ONLY SENSITIVITY === */}
    {(()=>{
      const t=ES_TYPES[esType]||{};const isLog=!!t.log,isProp=esType==="PROP";
      const bt=x=>isLog?Math.exp(x):isProp?(()=>{const e=Math.exp(x);return e/(1+e);})():x;
      const dv=x=>isProp?(bt(x)*100).toFixed(normalizePrecision(prec).decimals)+"%":isLog?fmtES(bt(x),prec):fmtES(+x,prec);
      return(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:700,color:C.acc,letterSpacing:1,marginBottom:6}}>PRIMARY-DATA-ONLY RE-ANALYSIS</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:12,lineHeight:1.5}}>Re-pools using only studies with directly-reported primary data, excluding any flagged as converted, calculated, digitised from a figure, or otherwise indirect. If the conclusion holds, it doesn't hinge on derived numbers.</div>
        {nonPrimaryCount===0?(
          <div style={{fontSize:12,color:C.grn,padding:"8px 0"}}>✓ All {result.k} pooled studies use directly-reported primary data — no indirect/converted values to exclude.</div>
        ):!primaryResult?(
          <div style={{fontSize:12,color:C.yel,padding:"8px 0"}}>⚠ Excluding {nonPrimaryCount} non-primary stud{nonPrimaryCount===1?"y":"ies"} leaves fewer than 2 studies — not enough to re-pool. The analysis depends heavily on indirect data.</div>
        ):(
          <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:180,background:C.bg,border:`1px solid ${C.brd}`,borderRadius:8,padding:"12px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:0.5,marginBottom:4}}>ALL DATA ({result.k} studies)</div>
              <div style={{fontSize:20,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{dv(result.pES)}</div>
              <div style={{fontSize:11,color:C.muted,fontFamily:"'IBM Plex Mono',monospace"}}>[{dv(result.lo95)}, {dv(result.hi95)}] · I²={result.I2}%</div>
            </div>
            <div style={{flex:1,minWidth:180,background:C.bg,border:`1px solid ${C.brd}`,borderRadius:8,padding:"12px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:0.5,marginBottom:4}}>PRIMARY ONLY ({primaryResult.k} studies)</div>
              <div style={{fontSize:20,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.acc}}>{dv(primaryResult.pES)}</div>
              <div style={{fontSize:11,color:C.muted,fontFamily:"'IBM Plex Mono',monospace"}}>[{dv(primaryResult.lo95)}, {dv(primaryResult.hi95)}] · I²={primaryResult.I2}%</div>
            </div>
            <div style={{flex:1.4,minWidth:200,display:"flex",alignItems:"center",fontSize:12,color:C.muted,lineHeight:1.55}}>
              {Math.abs(primaryResult.pES-result.pES)/Math.abs(result.pES||1)>0.10
                ? `⚠ Excluding ${nonPrimaryCount} indirect stud${nonPrimaryCount===1?"y":"ies"} shifts the estimate by more than 10% (${dv(result.pES)} → ${dv(primaryResult.pES)}). The pooled result depends partly on converted/derived data — state this as a limitation.`
                : `✓ The estimate is stable when restricted to primary data (${dv(result.pES)} → ${dv(primaryResult.pES)}), so the conclusion doesn't rest on the ${nonPrimaryCount} converted/indirect stud${nonPrimaryCount===1?"y":"ies"}.`}
            </div>
          </div>
        )}
      </div>);
    })()}
  </div>);
}

/* ════════════ TAB: SUBGROUP ANALYSIS ════════════ */
export function SubgroupTab({project}){
  const studies=Array.isArray(project&&project.studies)?project.studies:[];
  const prec = project?.analysisPrecision;
  const[groupKey,setGroupKey]=useState("design");
  const[method,setMethod]=useState("random");
  // RoadMap/2.md recs — subgroup pools use the project-wide τ² estimator too.
  const tau2Method=(project&&project.analysisSettings&&project.analysisSettings.tau2Method)||"DL";
  const result=useMemo(()=>subgroupAnalysis(studies,groupKey,method,{tau2Method}),[studies,groupKey,method,tau2Method]);
  const overall=useMemo(()=>runMeta(studies,method,{tau2Method}),[studies,method,tau2Method]);

  const keys=[
    {id:"design",label:"Study Design"},
    {id:"drugClass",label:"Drug Class"},
    {id:"country",label:"Country/Region"},
    {id:"timepoint",label:"Time Point"},
    {id:"adjusted",label:"Adjusted vs Unadjusted"},
    {id:"outcome",label:"Outcome Measured"},
  ];

  return(<div>
    <SectionHeader icon="layers" title="Subgroup Analysis" desc="Explore heterogeneity by stratifying studies. The Q-between test asks whether subgroups differ more than chance."/>
    <div style={{background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'44')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"10px 14px",marginBottom:14,fontSize:12,color:C.muted,lineHeight:1.6}}>
      <strong style={{color:C.yel}}>⚠ Use subgroups responsibly.</strong> Subgroup analyses should be <strong>pre-specified in your protocol</strong>, not chosen after seeing the data. Treat post-hoc subgroups as exploratory only, and be cautious when any subgroup has fewer than ~5 studies — differences can easily arise by chance.
    </div>
    <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{fontSize:12,color:C.muted}}>Group by:</span>
      {keys.map(k=>(
        <button key={k.id} onClick={()=>setGroupKey(k.id)} style={btnS(groupKey===k.id?"primary":"ghost")}>{k.label}</button>
      ))}
      <span style={{marginLeft:"auto",fontSize:11,color:C.muted}}>·</span>
      {[["random","Random"],["fixed","Fixed"]].map(([m,label])=>(
        <button key={m} onClick={()=>setMethod(m)} style={{...btnS(method===m?"primary":"ghost"),fontSize:11,padding:"4px 10px"}}>{label}</button>
      ))}
    </div>

    {!result || result.groups.length===0?(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
      <div style={{fontSize:36,marginBottom:10}}>🔬</div>Need at least 2 studies per subgroup
    </div>):(<>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:14,marginBottom:16}}>
        {result.groups.map(g=>(
          <div key={g.group} style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,borderLeft:`3px solid ${C.acc}`}}>
            <div style={{fontSize:12,fontWeight:700,marginBottom:4}}>{g.group}</div>
            <div style={{fontSize:10,color:C.muted,marginBottom:10}}>k = {g.k} studies</div>
            <div style={{fontSize:24,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{fmtES(g.pES,prec)}</div>
            <div style={{fontSize:11,color:C.muted,fontFamily:"'IBM Plex Mono',monospace"}}>95% CI [{fmtES(g.lo95,prec)}, {fmtES(g.hi95,prec)}]</div>
            <div style={{marginTop:10,display:"flex",gap:10,fontSize:11,color:C.muted}}>
              <span>I² = <strong style={{color:g.I2>50?C.yel:C.txt}}>{g.I2}%</strong></span>
              <span>p = <strong style={{color:g.pval<0.05?C.grn:C.muted}}>{fmtP(g.pval,prec)}</strong></span>
            </div>
          </div>
        ))}
      </div>

      {result.Qbetween!==null && (
        <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:700,color:C.acc,letterSpacing:1,marginBottom:12}}>TEST FOR SUBGROUP DIFFERENCES</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14}}>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Q-between</div>
              <div style={{fontSize:22,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace"}}>{result.Qbetween}</div>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Degrees of freedom</div>
              <div style={{fontSize:22,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.muted}}>{result.df}</div>
            </div>
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:4}}>p-value</div>
              <div style={{fontSize:22,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:result.pBetween<0.05?C.grn:C.muted}}>{result.pBetween!==null?fmtP(result.pBetween,prec):"—"}</div>
            </div>
          </div>
          <div style={{marginTop:12,fontSize:12,color:C.muted}}>
            {result.pBetween<0.05?"✓ Subgroups differ significantly — heterogeneity may be explained by this variable.":"✗ No significant differences between subgroups — this variable does not explain heterogeneity."}
          </div>
        </div>
      )}
    </>)}
    <InfoBox>💡 Pre-specify subgroups in your protocol. Post-hoc subgroup analyses should be labelled as exploratory. Subgroups with k&lt;5 studies are statistically unreliable.</InfoBox>
    {/* P13 — CONTINUOUS sibling of subgroup analysis. Additive + self-gating: it
        renders nothing unless the `metaRegression` flag is ON, so this tab is
        byte-for-byte unchanged when the flag is off. */}
    <MetaRegression project={project}/>
  </div>);
}

/* ════════════ TAB SECTION: META-REGRESSION (P13) ════════════
   Explores heterogeneity with a study-level covariate — the continuous
   complement to SubgroupTab. Additive + flag-gated (`metaRegression`); renders
   null when the flag is off so SubgroupTab is unchanged. Engine is the SAME
   `metaRegression` in the monolithStats barrel (read via the MonolithStats
   namespace so the bundle builds even before the engine lands). */

// Effect/variance/count/identity columns that must NEVER be offered as a
// covariate (they ARE the outcome or its raw inputs, or are free-text labels).
// Everything else is judged data-drivenly below, so free-text fields with many
// distinct values (title/abstract/notes/author) drop out automatically.
const MR_BLOCK = new Set([
  "id", "es", "lo", "hi", "estype", "se", "ci", "cilo", "cihi", "pval", "z", "weight",
  "a", "b", "c", "d", "events", "total", "nexp", "nctrl", "meanexp", "sdexp", "meanctrl", "sdctrl",
  "tp", "fp", "fn", "tn", "source", "converted", "conversions", "flags", "datanature", "adjustednote",
  "needsreview", "rob", "snapshot", "title", "authors", "author", "journal", "doi", "pmid", "pmcid",
  "abstract", "outcome", "primaryoutcome", "secondaryoutcomes", "populationdef", "interventiondef",
  "comparatordef", "funding", "enrollperiod", "notes", "note", "url", "fulltext", "tags", "decision",
]);

const MR_FIELD_LABEL = {
  year: "Year", n: "Sample size", country: "Country/Region", design: "Study design",
  drugClass: "Drug class", followup: "Follow-up", timepoint: "Time point", adjusted: "Adjustment",
  dataSource: "Data source", meanAge: "Mean age", dose: "Dose", baselineRisk: "Baseline risk",
  region: "Region",
};

function mrPretty(field) {
  if (!field) return "Covariate";
  if (MR_FIELD_LABEL[field]) return MR_FIELD_LABEL[field];
  const spaced = String(field).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
function mrTypeLabel(t) {
  return { continuous: "Continuous", binary: "Binary", categorical: "Categorical", ordinal: "Ordinal" }[t] || t;
}
function mrIsNum(v) { return v !== "" && v != null && isFinite(Number(v)); }
function mrPctish(v, prec) {
  if (v == null || !isFinite(Number(v))) return "—";
  const n = Number(v);
  const pct = Math.abs(n) <= 1.0000001 ? n * 100 : n;
  return `${fmtNum(pct, prec)}%`;
}

/* Auto-detect candidate covariates from the study rows: numeric → continuous
   (binary if only 2 distinct), few distinct strings → categorical/binary, free
   text → dropped. Users can override the detected type. */
export function detectCovariates(studies) {
  if (!Array.isArray(studies) || !studies.length) return [];
  const keys = new Set();
  studies.forEach((s) => { if (s && typeof s === "object") Object.keys(s).forEach((k) => keys.add(k)); });
  const out = [];
  keys.forEach((k) => {
    if (k.startsWith("_") || MR_BLOCK.has(String(k).toLowerCase())) return;
    const values = studies
      .map((s) => (s ? s[k] : undefined))
      .filter((v) => v !== "" && v != null && typeof v !== "object");
    if (values.length < 3) return; // too sparse to regress on
    const numeric = values.filter(mrIsNum).length;
    const numFrac = numeric / values.length;
    const distinct = new Set(values.map((v) => String(v).trim().toLowerCase())).size;
    let type;
    if (numFrac >= 0.8) {
      if (distinct === 2) type = "binary";
      else if (distinct >= 3) type = "continuous";
      else return; // constant
    } else if (distinct === 2) type = "binary";
    else if (distinct >= 2 && distinct <= 12) type = "categorical";
    else return; // free text
    out.push({ field: k, type, coverage: values.length, distinct, numeric: numFrac >= 0.8 });
  });
  const order = { continuous: 0, ordinal: 1, binary: 2, categorical: 3 };
  out.sort((a, b) => (order[a.type] - order[b.type]) || (b.coverage - a.coverage) || a.field.localeCompare(b.field));
  return out;
}

/* Dominant effect-measure across studies with a numeric ES (mirrors AnalysisTab). */
export function detectRegressionMeasure(studies) {
  if (!Array.isArray(studies)) return "";
  const types = studies.filter((s) => s && s.es !== "" && !isNaN(+s.es)).map((s) => s.esType).filter(Boolean);
  if (!types.length) return "";
  return types.slice().sort((a, b) => types.filter((t) => t === b).length - types.filter((t) => t === a).length)[0];
}

/* Manuscript-ready text (association-only wording — never causal, never "AI"). */
export function buildMetaRegNarrative({ result, measure, covLabel, type, method, prec }) {
  const isLog = !!(measure && ES_TYPES[measure] && ES_TYPES[measure].log);
  const measureName = (ES_TYPES[measure] && ES_TYPES[measure].label) || "effect size";
  const ratioName = ((ES_TYPES[measure] && ES_TYPES[measure].scale) || "effect size").replace("ln", "");
  const est = method === "REML" ? "restricted maximum likelihood (REML)" : "method-of-moments";
  const mods = Array.isArray(result.moderators) ? result.moderators : [];
  const primary = mods.length === 1 ? mods[0] : null;
  const perUnit = type === "continuous" || type === "ordinal";
  const resid = result.residual || {};
  const qeStr = resid.QE != null
    ? `Q_E = ${fmtNum(resid.QE, prec)}, df = ${resid.df}, ${resid.QEp < 0.001 ? "P < 0.001" : "P = " + fmtNum(resid.QEp, prec)}`
    : "not available";
  const coefSentence = primary
    ? `The regression coefficient ${perUnit ? `for each one-unit increase in ${covLabel}` : `for ${primary.name || covLabel}`} was ${fmtNum(primary.coef, prec)} (95% CI ${fmtNum(primary.ciLo, prec)} to ${fmtNum(primary.ciHi, prec)}), ${primary.pval < 0.001 ? "P < 0.001" : "P = " + fmtNum(primary.pval, prec)}${isLog ? ` (a ${ratioName} ratio of ${fmtES(Math.exp(primary.coef), prec)} per unit)` : ""}. ${(primary.pval != null && primary.pval < 0.05) ? "" : "The confidence interval included the null, so this covariate did not explain a statistically detectable amount of heterogeneity. "}`
    : "Coefficients for each moderator level are reported in the results table. ";
  const results = `A ${est} random-effects meta-regression related the ${measureName.toLowerCase()}${isLog ? " (natural-log scale)" : ""} to ${covLabel} across ${result.k} studies${result.kDropped ? ` (${result.kDropped} excluded for missing ${covLabel})` : ""}. ${coefSentence}The covariate explained ${mrPctish(result.R2, prec)} of the between-study variance (τ² ${fmtNum(result.tau2Before, prec)} → ${fmtNum(result.tau2, prec)}); residual heterogeneity was I² = ${mrPctish(result.I2resid, prec)} (${qeStr}). Because meta-regression is observational, this describes an association across studies and does not establish that ${covLabel} causes the difference in effect.`;
  const methods = `Between-study heterogeneity was explored using ${est} random-effects meta-regression, with ${covLabel} entered as a ${type} moderator of the ${measureName.toLowerCase()}${isLog ? ", modelled on the natural-log scale" : ""}. Regression coefficients with 95% confidence intervals, the residual-heterogeneity test (Q_E), and the proportion of between-study variance explained (R²) are reported. Meta-regression associations are study-level and observational and were interpreted as hypothesis-generating rather than causal; approximately ten studies per covariate are recommended, so results based on fewer studies were treated with caution. [State software here — e.g. analyses were verified in R using the metafor package.]`;
  const manuscript = `${results} These meta-regression findings are exploratory: with ${result.k} studies power is limited, aggregate (study-level) covariates are susceptible to ecological bias, and evaluating multiple covariates inflates the false-positive rate.`;
  return { results, methods, manuscript };
}

/* Presentational results block (exported for SSR tests). Given a non-null engine
   result it renders guardrail warnings, the coefficient table, the heterogeneity
   summary, the bubble plot, and the export/copy actions. ok:false → warnings only,
   never a chart. */
export function MetaRegressionResults({ result, measure, covLabel, type, method, prec }) {
  const [copied, setCopied] = useState("");
  const copy = (t, id) => { try { navigator.clipboard.writeText(t).then(() => { setCopied(id); setTimeout(() => setCopied(""), 1600); }); } catch { /* clipboard unavailable */ } };
  if (!result) return null;

  const isLog = !!(measure && ES_TYPES[measure] && ES_TYPES[measure].log);
  const rawScale = (ES_TYPES[measure] && ES_TYPES[measure].scale) || "Effect size";
  const measureName = (ES_TYPES[measure] && ES_TYPES[measure].label) || "effect size";

  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const Warnings = () => (warnings.length > 0 ? (
    <div style={{ marginBottom: 16 }}>
      {warnings.map((w, i) => {
        const err = w && (w.type === "error" || w.severity === "error");
        return (<div key={i} style={{ background: err ? "var(--t-red-bg)" : "var(--t-yel-bg)", border: `1px solid ${themeAlpha(err ? C.red : C.yel, "55")}`, borderLeft: `4px solid ${err ? C.red : C.yel}`, borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: C.txt, lineHeight: 1.6 }}>
            <strong style={{ color: err ? C.red : C.yel }}>{err ? "⛔ " : "⚠ "}</strong>{(w && (w.message || w.msg)) || "Check this analysis before relying on it."}
          </div>
        </div>);
      })}
    </div>
  ) : null);

  if (!result.ok) {
    return (<div>
      <Warnings />
      <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 28, textAlign: "center", color: C.muted }}>
        <div style={{ fontSize: 30, marginBottom: 8 }}>📈</div>
        Meta-regression could not be computed for this covariate{warnings.length ? " — see the notes above." : ". Add more studies with the covariate recorded."}
      </div>
    </div>);
  }

  const terms = [
    { name: "Intercept", ...(result.intercept || {}) },
    ...((result.moderators || []).map((m) => ({ name: (m.name || covLabel) + (m.level ? `: ${m.level}` : ""), ...m }))),
  ];
  const cols = isLog ? ["Term", "Coef (ln)", "exp(coef)", "SE", "95% CI (ln)", "z", "p"] : ["Term", "Coefficient", "SE", "95% CI", "z", "p"];

  const bubble = result.bubble;
  const hasBubble = bubble && Array.isArray(bubble.points) && bubble.points.filter((p) => p && isFinite(Number(p.x)) && isFinite(Number(p.y))).length >= 1;
  const isCategoricalView = type === "categorical" && !(bubble && bubble.line);

  // ---- exports ----
  const esc = (v) => { const x = String(v == null ? "" : v).replace(/"/g, '""'); return /[",\n]/.test(x) ? `"${x}"` : x; };
  const csvBody = terms.map((t) => [t.name, t.coef, t.se, t.ciLo, t.ciHi, t.z, t.pval].map(esc).join(","));
  const resid = result.residual || {};
  const meta = [
    "",
    ["Model", method === "REML" ? "REML random-effects meta-regression" : "Method-of-moments random-effects meta-regression"].map(esc).join(","),
    ["Effect measure", measureName + (isLog ? " (natural-log scale)" : "")].map(esc).join(","),
    ["Covariate", covLabel + ` (${mrTypeLabel(type)})`].map(esc).join(","),
    ["Studies included (k)", result.k].map(esc).join(","),
    ["Studies dropped (missing covariate)", result.kDropped].map(esc).join(","),
    ["tau2 before", result.tau2Before].map(esc).join(","),
    ["tau2 after", result.tau2].map(esc).join(","),
    ["tau2 reduction", result.tau2Reduction].map(esc).join(","),
    ["R2 (variance explained)", result.R2].map(esc).join(","),
    ["Residual I2", result.I2resid].map(esc).join(","),
    ["Residual QE", resid.QE].map(esc).join(","),
    ["Residual QE df", resid.df].map(esc).join(","),
    ["Residual QE p", resid.QEp].map(esc).join(","),
  ].join("\n");
  const csv = "﻿" + [["Term", "Coefficient", "SE", "CI_lower", "CI_upper", "z", "p_value"].join(","), ...csvBody].join("\n") + "\n" + meta;
  const tsv = [["Term", "Coefficient", "SE", "95% CI", "z", "p"].join("\t"), ...terms.map((t) => [t.name, fmtNum(t.coef, prec), fmtNum(t.se, prec), `${fmtNum(t.ciLo, prec)} to ${fmtNum(t.ciHi, prec)}`, fmtNum(t.z, prec), fmtP(t.pval, prec)].join("\t"))].join("\n");
  const narr = buildMetaRegNarrative({ result, measure, covLabel, type, method, prec });
  const blocks = [
    { id: "results", label: "Results paragraph", icon: "📊", text: narr.results },
    { id: "methods", label: "Statistical methods", icon: "🔬", text: narr.methods },
    { id: "manuscript", label: "Manuscript paragraph (with caveats)", icon: "✍️", text: narr.manuscript },
  ];
  const svgTitle = `Meta-regression: ${isLog ? "ln(" + rawScale.replace("ln", "") + ")" : rawScale} vs ${covLabel}`;
  const doSvg = () => { const b = buildBubbleSVG(bubble, { measure, covariateLabel: covLabel, title: svgTitle }); if (b) downloadText(SVG_XML_HEADER + b.svg, "meta-regression_bubble.svg", "image/svg+xml;charset=utf-8"); };
  const doPng = async () => { const b = buildBubbleSVG(bubble, { measure, covariateLabel: covLabel, title: svgTitle }); if (!b) return; const blob = await rasterizeSvg(b.svg, b.W, b.H, { targetWidthPx: 1280, background: "#0e1420" }); downloadBlob(blob, "meta-regression_bubble.png"); };

  return (<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    <Warnings />

    {/* COEFFICIENT TABLE */}
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 16, overflowX: "auto" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 1, marginBottom: 12 }}>REGRESSION COEFFICIENTS{isLog ? " — ON THE LOG SCALE" : ""}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr>{cols.map((h, i) => (<th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>))}</tr></thead>
        <tbody>
          {terms.map((t, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.brd}` }}>
              <td style={{ padding: "6px 10px", fontWeight: i === 0 ? 700 : 500, color: i === 0 ? C.muted : C.txt }}>{t.name}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700 }}>{fmtNum(t.coef, prec)}</td>
              {isLog && <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", color: C.muted }}>{t.coef == null ? "—" : fmtES(Math.exp(t.coef), prec)}</td>}
              <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", color: C.muted }}>{fmtNum(t.se, prec)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", color: C.muted }}>[{fmtNum(t.ciLo, prec)}, {fmtNum(t.ciHi, prec)}]</td>
              <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", color: C.muted }}>{fmtNum(t.z, prec)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", color: (t.pval != null && t.pval < 0.05) ? C.grn : C.muted, fontWeight: (t.pval != null && t.pval < 0.05) ? 700 : 400 }}>{fmtP(t.pval, prec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isLog && <div style={{ fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>Coefficients are on the natural-log scale; exp(coef) is the multiplicative change in the {rawScale.replace("ln", "")} per one-unit change in {covLabel}.</div>}
    </div>

    {/* HETEROGENEITY SUMMARY */}
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.acc, letterSpacing: 1, marginBottom: 12 }}>HETEROGENEITY EXPLAINED</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14 }}>
        {[
          { label: "R² (variance explained)", value: mrPctish(result.R2, prec), note: "share of τ² the covariate accounts for", color: C.grn },
          { label: "τ² before → after", value: `${fmtNum(result.tau2Before, prec)} → ${fmtNum(result.tau2, prec)}`, note: `reduction ${mrPctish(result.tau2Reduction, prec)}`, color: C.txt },
          { label: "Residual I²", value: mrPctish(result.I2resid, prec), note: "heterogeneity left unexplained", color: (Number(result.I2resid) > (Number(result.I2resid) <= 1 ? 0.5 : 50)) ? C.yel : C.txt },
          { label: "Residual Q_E", value: resid.QE != null ? fmtNum(resid.QE, prec) : "—", note: resid.QE != null ? `df = ${resid.df} · p ${resid.QEp < 0.001 ? "< 0.001" : "= " + fmtNum(resid.QEp, prec)}` : "", color: C.txt },
          { label: "Studies (k)", value: `${result.k}`, note: result.kDropped ? `${result.kDropped} dropped (missing covariate)` : "all with covariate", color: (result.k < 10) ? C.yel : C.txt },
        ].map((m) => (
          <div key={m.label} style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{m.label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", color: m.color }}>{m.value}</div>
            {m.note && <div style={{ fontSize: 10, color: C.dim, marginTop: 3 }}>{m.note}</div>}
          </div>
        ))}
      </div>
      {result.k < 10 && <div style={{ marginTop: 12, fontSize: 11, color: C.yel, lineHeight: 1.5 }}>⚠ Fewer than ~10 studies per covariate — the coefficient and R² are unstable. Treat this as exploratory.</div>}
    </div>

    {/* BUBBLE PLOT */}
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 1 }}>BUBBLE PLOT</div>
        {hasBubble && <div style={{ display: "flex", gap: 8 }}>
          <button onClick={doSvg} style={{ ...btnS("ghost"), fontSize: 11, padding: "5px 10px" }}>⬇ SVG</button>
          <button onClick={doPng} style={{ ...btnS("ghost"), fontSize: 11, padding: "5px 10px" }}>⬇ PNG</button>
        </div>}
      </div>
      {hasBubble ? (<>
        <BubblePlot bubble={bubble} measure={measure} covariateLabel={covLabel} />
        <div style={{ fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>
          Each bubble is a study (radius ∝ weight); x = {covLabel}, y = effect estimate{isLog ? " on the log scale (axis ticks back-transformed)" : ""}.{(bubble && bubble.line) ? " The line is the fitted regression with its 95% confidence band." : isCategoricalView ? " Points are grouped by level; for categorical moderators the coefficient table above is the primary output." : ""}
        </div>
      </>) : (
        <div style={{ fontSize: 12, color: C.muted, padding: "8px 0" }}>No bubble plot for this covariate — the coefficient table above is the primary output.</div>
      )}
    </div>

    {/* EXPORTS */}
    <div style={{ background: C.card, border: `1px solid ${themeAlpha(C.acc, "55")}`, borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.acc, letterSpacing: 0.5, marginBottom: 10 }}>📤 EXPORT META-REGRESSION</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={() => copy(tsv, "clip")} style={btnS("primary")}>{copied === "clip" ? "✓ Copied table" : "📋 Copy table"}</button>
        <button onClick={() => downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "meta-regression_results.csv")} style={btnS("ghost")}>⬇ Download CSV</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {blocks.map((b) => (
          <div key={b.id} style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 6, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{b.icon} {b.label}</span>
              <button onClick={() => copy(b.text, b.id)} style={{ ...btnS("ghost"), fontSize: 10, padding: "3px 10px" }}>{copied === b.id ? "✓ Copied" : "📋 Copy"}</button>
            </div>
            <div style={{ fontSize: 12.5, color: C.txt, lineHeight: 1.7 }}>{b.text}</div>
          </div>
        ))}
      </div>
    </div>
  </div>);
}

export function MetaRegression({ project }) {
  const studies = (project && Array.isArray(project.studies)) ? project.studies : [];
  const prec = project && project.analysisPrecision;
  const [flagOn, setFlagOn] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/settings/public", { credentials: "include" })
      .then((r) => r.json())
      .then((s) => { if (alive) setFlagOn(!!(s && s.featureFlags && s.featureFlags.metaRegression)); })
      .catch(() => { if (alive) setFlagOn(false); });
    return () => { alive = false; };
  }, []);

  const candidates = useMemo(() => detectCovariates(studies), [studies]);
  const [covariate, setCovariate] = useState("");
  const [typeOverride, setTypeOverride] = useState("");
  const [method, setMethod] = useState("MM");
  // Pick a sensible default covariate once candidates are known (prefer year,
  // then any continuous field, then the first candidate).
  useEffect(() => {
    if (candidates.length && (!covariate || !candidates.find((c) => c.field === covariate))) {
      const pick = candidates.find((c) => c.field === "year") || candidates.find((c) => c.type === "continuous") || candidates[0];
      setCovariate(pick.field); setTypeOverride("");
    }
  }, [candidates, covariate]);

  const active = candidates.find((c) => c.field === covariate) || null;
  const type = typeOverride || (active && active.type) || "continuous";
  const measure = useMemo(() => detectRegressionMeasure(studies), [studies]);
  const covLabel = mrPretty(covariate);
  const engineFn = MonolithStats.metaRegression;
  const engineReady = typeof engineFn === "function";

  const result = useMemo(() => {
    if (!engineReady || !covariate) return null;
    try { return engineFn(studies, { covariate, type, method, measure }); }
    catch (e) { return { ok: false, warnings: [{ type: "error", message: "Meta-regression could not run: " + ((e && e.message) || e) }] }; }
  }, [engineReady, engineFn, studies, covariate, type, method, measure]);

  if (flagOn !== true) return null; // additive no-op: flag off or still loading

  return (<div style={{ marginTop: 32, paddingTop: 26, borderTop: `1px solid ${C.brd}` }}>
    <SectionHeader icon="activity" title="Meta-Regression" desc="Test whether a study-level covariate explains heterogeneity by regressing each study's effect on that covariate — the continuous complement to subgroup analysis." badge={result && result.ok ? `k = ${result.k}` : undefined} />

    <div style={{ background: "var(--t-yel-bg)", border: `1px solid ${themeAlpha(C.yel, "44")}`, borderLeft: `3px solid ${C.yel}`, borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
      <strong style={{ color: C.yel }}>⚠ Use meta-regression responsibly.</strong> Aim for at least ~10 studies per covariate; with fewer, estimates are unstable. Covariates should be <strong>pre-specified</strong>. Associations here are <strong>observational and study-level</strong> — they can be confounded and are prone to ecological bias, so do not read them as causal, and remember that testing several covariates inflates false positives.
    </div>

    {candidates.length === 0 ? (
      <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 32, textAlign: "center", color: C.muted }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📈</div>No usable covariate found. Add study-level fields (e.g. year, sample size, mean age, region) in Data Extraction to run a meta-regression.
      </div>
    ) : (<>
      <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 14, marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6 }}>COVARIATE</span>
          <select value={covariate} onChange={(e) => { setCovariate(e.target.value); setTypeOverride(""); }} style={{ ...inp, width: "auto", minWidth: 200, fontSize: 12, padding: "6px 10px" }}>
            {candidates.map((c) => (<option key={c.field} value={c.field}>{mrPretty(c.field)} · {mrTypeLabel(c.type)} (k={c.coverage})</option>))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6, display: "inline-flex", alignItems: "center" }}>TREAT AS<HelpTip text="Auto-detected from the data (numeric → continuous, a few repeated labels → categorical). Override if the field means something different — e.g. a numeric dose you want treated as ordered categories." /></span>
          <select value={type} onChange={(e) => setTypeOverride(e.target.value)} style={{ ...inp, width: "auto", fontSize: 12, padding: "6px 10px" }}>
            {["continuous", "binary", "categorical", "ordinal"].map((t) => (<option key={t} value={t}>{mrTypeLabel(t)}{active && active.type === t ? " (auto)" : ""}</option>))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6 }}>ESTIMATOR</span>
          <div style={{ display: "flex", gap: 6 }}>
            {[["MM", "Method of moments"], ["REML", "REML"]].map(([m, label]) => (
              <button key={m} onClick={() => setMethod(m)} style={{ ...btnS(method === m ? "primary" : "ghost"), fontSize: 11, padding: "6px 12px" }}>{label}</button>
            ))}
          </div>
        </div>
        {measure && (
          <div style={{ marginLeft: "auto", fontSize: 11, color: C.muted, alignSelf: "center", lineHeight: 1.5, maxWidth: 240 }}>
            Measure: <strong style={{ color: C.txt }}>{(ES_TYPES[measure] && ES_TYPES[measure].label) || measure}</strong>{(ES_TYPES[measure] && ES_TYPES[measure].log) ? ` — modelled on the log scale; the y-axis and coefficients are on ln(${((ES_TYPES[measure] && ES_TYPES[measure].scale) || "").replace("ln", "")}).` : "."}
          </div>
        )}
      </div>

      {!engineReady ? (
        <InfoBox color={C.muted}>The meta-regression engine is not available in this build yet. The covariate picker and settings above are ready; results will appear here once the engine is enabled.</InfoBox>
      ) : !result ? (
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 28, textAlign: "center", color: C.muted }}>Select a covariate above to run the regression.</div>
      ) : (
        <MetaRegressionResults result={result} measure={measure} covLabel={covLabel} type={type} method={method} prec={prec} />
      )}
    </>)}
  </div>);
}
