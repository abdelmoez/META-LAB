/* ════════════ REPORTING / GRADE / MANUSCRIPT / METHODS TABS ════════════
   Extracted VERBATIM from meta-lab-3-patched.jsx (prompt46 Phase 6h). Holds:
   ReportTab (PRISMA 2020 reporting checklist), GRADETab (certainty of evidence
   + RoB-driven Risk-of-Bias suggestion), ManuscriptTab (AI/manual manuscript
   drafter) and MethodsTab (methods & equations catalogue). No logic changes —
   only the imports below were added so the moved code resolves identically.

   Keeps using the monolith-derived shared modules: C/btnS/inp/tagS from
   ui/styles.js; SectionHeader/InfoBox/ProgressBar/MATH_FONT from ui/primitives.jsx
   (NOT the look-alikes in src/features/protocol/picoUi.jsx); the monolith-own
   stats copies (runMeta/eggersTest) from monolithStats.js; PRISMA_CL +
   GRADE_DOMAINS from monolithConstants.js; GRADE_OPTIONS + gradeSuggestions from
   projectHelpers.js; the RoB→GRADE sync helpers from gradeSync.js + the RoB API;
   the AI service (callClaude, behind AI_FEATURES_ENABLED=false); the precision
   formatter fmtES; the engine-owned METHODS_CONTENT catalogue. `fmtDate` is a
   verbatim copy of the monolith module-local helper (same as the sibling tab
   files keep their own copy). */
import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { alpha as themeAlpha } from "../../theme/tokens.js";
import { manuscriptEditorFlagEnabled } from "../../../features/manuscript/flag.js";
import { Icon } from "../../components/icons.jsx";
import { METHODS_CONTENT, NOT_IMPLEMENTED } from "../../../research-engine/docs/methods-content.js";
import { fmtES } from "../../../research-engine/format/precision.js";
import { PRISMA_CL, GRADE_DOMAINS } from "../../../research-engine/project-model/monolithConstants.js";
import { runMeta, eggersTest } from "../../../research-engine/statistics/monolithStats.js";
import { robFlagEnabled, robApi } from "../../rob/robApi.js";
import { summariseRobForGrade, ROB_GRADE_SOURCE } from "../../../research-engine/rob/gradeSync.js";
import { AI_FEATURES_ENABLED, callClaude } from "../../services/aiService.js";
import { C, btnS, inp, tagS } from "../ui/styles.js";
import { SectionHeader, InfoBox, ProgressBar, MATH_FONT } from "../ui/primitives.jsx";
import { GRADE_OPTIONS, gradeSuggestions } from "../projectHelpers.js";

/* fmtDate — verbatim copy of the monolith module-local helper (the monolith
   keeps its own; this copy keeps the moved code self-contained). */
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";

/* ════════════ TAB: REPORTING CHECKLIST ════════════ */
export function ReportTab({project,upd}){
  const checked=project.reportChecked||{};
  const toggle=id=>upd("reportChecked",{...checked,[id]:!checked[id]});
  const done=Object.values(checked).filter(Boolean).length,total=PRISMA_CL.length,pct=Math.round((done/total)*100);
  const sections=[...new Set(PRISMA_CL.map(x=>x.sec))];
  return(<div>
    <SectionHeader icon="checkSquare" title="PRISMA 2020 Reporting Checklist" desc="Track completeness of your manuscript. Check items as you complete each section."/>
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <span style={{fontSize:12,fontWeight:600}}>Manuscript Completeness</span>
        <span style={{fontSize:14,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:pct===100?C.grn:C.acc}}>{pct}%</span>
      </div>
      <ProgressBar done={done} total={total}/>
    </div>
    {sections.map(sec=>{
      const items=PRISMA_CL.filter(x=>x.sec===sec),secDone=items.filter(x=>checked[x.id]).length;
      return(<div key={sec} style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:14,marginBottom:10}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <span style={{fontSize:13,fontWeight:700,color:C.acc}}>{sec}</span>
          <span style={tagS(secDone===items.length?"green":"yellow")}>{secDone}/{items.length}</span>
        </div>
        {items.map(item=>(
          <label key={item.id} onClick={()=>toggle(item.id)} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"8px 0",borderBottom:`1px solid ${C.brd}`,cursor:"pointer"}}>
            <div style={{width:18,height:18,borderRadius:4,border:`2px solid ${checked[item.id]?C.grn:C.brd}`,background:checked[item.id]?C.grn:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1,transition:"all 0.15s"}}>
              {checked[item.id]&&<span style={{color:C.accText,fontSize:12,fontWeight:800}}>✓</span>}
            </div>
            <div>
              <div style={{fontSize:12,fontWeight:600,color:checked[item.id]?C.grn:C.txt,textDecoration:checked[item.id]?"line-through":"none"}}>{item.item}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.5}}>{item.desc}</div>
            </div>
          </label>
        ))}
      </div>);
    })}
  </div>);
}

/* ════════════ TAB: GRADE ════════════ */
/* GRADE_OPTIONS + gradeSuggestions live in projectHelpers.js (imported above). */
export function GRADETab({project,upd}){
  const grade=project.grade||{};
  const prec=project?.analysisPrecision;
  const robSync=grade.robSync||null;
  // prompt34 Task 10 — pull completed RoB 2 assessments to auto-suggest the GRADE
  // Risk-of-Bias domain. Owner-scoped + flag-gated: a 404 / flag-off / error simply
  // leaves robList null and GRADE falls back to the legacy data-based suggestion.
  const[robList,setRobList]=useState(null);
  useEffect(()=>{let dead=false;(async()=>{
    try{ if(!(await robFlagEnabled())){ if(!dead)setRobList(null); return; }
      const r=await robApi.listAssessments(project.id);
      if(!dead) setRobList(Array.isArray(r?.assessments)?r.assessments:[]);
    }catch{ if(!dead) setRobList(null); }
  })();return()=>{dead=true;};},[project.id]);
  const robSummary=useMemo(()=>robList?summariseRobForGrade(robList):null,[robList]);
  const robReady=!!(robSummary&&robSummary.assessed>0);
  // "Stale" = RoB assessments changed since GRADE's Risk-of-Bias judgement was last
  // reviewed/synced (protects a manual override from being silently overwritten).
  const robStale=!!(robReady&&robSync&&robSync.signature&&robSync.signature!==robSummary.signature);

  // setRating: a manual click on the Risk-of-Bias domain records it as a manual
  // choice (so later RoB changes are flagged stale, not auto-applied). Others as-is.
  const setRating=(domain,val)=>{
    if(domain==="rob"){
      upd("grade",{...grade,rob:val,robSync:{source:ROB_GRADE_SOURCE.MANUAL,signature:robSummary?robSummary.signature:(robSync?.signature||""),syncedAt:new Date().toISOString(),rating:val}});
    } else upd("grade",{...grade,[domain]:val});
  };
  // Accept the RoB-derived suggestion for the Risk-of-Bias domain (auditable).
  const acceptRobSuggestion=()=>{
    if(!robReady||!robSummary.suggestedRating)return;
    upd("grade",{...grade,rob:robSummary.suggestedRating,robSync:{source:ROB_GRADE_SOURCE.AUTO,signature:robSummary.signature,syncedAt:new Date().toISOString(),rating:robSummary.suggestedRating,counts:robSummary.counts,concern:robSummary.concern,completed:robSummary.completed}});
  };
  // Acknowledge a stale RoB change while KEEPING the current manual rating.
  const dismissRobStale=()=>{
    if(!robSummary)return;
    upd("grade",{...grade,robSync:{...(robSync||{source:ROB_GRADE_SOURCE.MANUAL,rating:grade.rob||""}),signature:robSummary.signature,syncedAt:new Date().toISOString()}});
  };
  const suggestions=useMemo(()=>gradeSuggestions(project),[project.studies,project.robMethod]);
  const applyAll=()=>{
    const next={...grade};
    Object.keys(suggestions).forEach(id=>{ if(id!=="rob"&&suggestions[id].suggest) next[id]=suggestions[id].suggest; });
    // Prefer the RoB-assessment suggestion for Risk of Bias when present (auditable).
    if(robReady&&robSummary.suggestedRating){
      next.rob=robSummary.suggestedRating;
      next.robSync={source:ROB_GRADE_SOURCE.AUTO,signature:robSummary.signature,syncedAt:new Date().toISOString(),rating:robSummary.suggestedRating,counts:robSummary.counts,concern:robSummary.concern,completed:robSummary.completed};
    } else if(suggestions.rob&&suggestions.rob.suggest){ next.rob=suggestions.rob.suggest; }
    upd("grade",next);
  };
  const anySuggest=Object.values(suggestions).some(s=>s.suggest)||(robReady&&!!robSummary.suggestedRating);

  // Compute certainty: start at "High" for RCTs, downgrade by serious/very serious
  const totalModifier=GRADE_DOMAINS.reduce((sum,d)=>{
    const opt=GRADE_OPTIONS.find(o=>o.v===grade[d.id]);
    return sum+(opt?opt.modifier:0);
  },0);
  const startLevel=project.pico?.studyDesign==="RCT"||project.pico?.studyDesign==="Quasi-RCT"?4:2;
  const finalLevel=Math.max(1,Math.min(4,startLevel+totalModifier));
  const levels=["Very low","Low","Moderate","High"];
  const levelColors=[C.red,C.red,C.yel,C.grn];
  const levelEmoji=["⊕○○○","⊕⊕○○","⊕⊕⊕○","⊕⊕⊕⊕"];

  const result=useMemo(()=>runMeta(project.studies,"random"),[project.studies]);

  return(<div>
    <SectionHeader icon="award" title="GRADE Certainty of Evidence" desc="Grade the body of evidence for your primary outcome. Required by most journals and Cochrane."/>

    <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16,marginBottom:16}}>
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:10,flexWrap:"wrap"}}>
          <div style={{fontSize:11,fontWeight:700,color:C.acc,letterSpacing:1}}>RATE EACH DOMAIN</div>
          {anySuggest&&<button onClick={applyAll} style={{...btnS("primary"),fontSize:11,padding:"5px 12px"}}>✨ Apply all data-based suggestions</button>}
        </div>
        <div style={{fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.5,background:`${themeAlpha(C.acc,'0a')}`,border:`1px solid ${themeAlpha(C.acc,'22')}`,borderRadius:6,padding:"8px 11px"}}>
          💡 Suggestions below are computed from your actual data — risk-of-bias ratings, I², the pooled CI, study count, and Egger's test. They're a starting point; the final judgement is yours.
        </div>
        {GRADE_DOMAINS.map(d=>{
          const sg=suggestions[d.id];
          const sgOpt=sg&&sg.suggest?GRADE_OPTIONS.find(o=>o.v===sg.suggest):null;
          const matches=sg&&sg.suggest&&grade[d.id]===sg.suggest;
          return(
          <div key={d.id} style={{padding:"10px 0",borderBottom:`1px solid ${C.brd}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div>
                <div style={{fontSize:13,fontWeight:600}}>{d.label}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{d.hint}</div>
              </div>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {GRADE_OPTIONS.map(o=>{
                const on=grade[d.id]===o.v;
                return(<button key={o.v} onClick={()=>setRating(d.id,on?"":o.v)} style={{
                  padding:"5px 11px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,
                  border:`1px solid ${on?o.color:C.brd}`,background:on?`${themeAlpha(o.color,'25')}`:"transparent",
                  color:on?o.color:C.muted,fontFamily:"'IBM Plex Sans',sans-serif"
                }}>{o.label} {o.modifier!==0?`(${o.modifier})`:""}</button>);
              })}
            </div>
            {/* prompt34 Task 10 — the Risk-of-Bias domain is auto-suggested from the
                completed RoB 2 assessments (auditable: accept / manual override /
                stale re-sync). Falls back to the legacy data-based suggestion when
                the RoB engine is off or unavailable. */}
            {d.id==="rob"&&robReady?(()=>{
              const robSuggOpt=GRADE_OPTIONS.find(o=>o.v===robSummary.suggestedRating);
              const robMatches=grade.rob===robSummary.suggestedRating;
              return(<div style={{marginTop:7,display:"grid",gap:6}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:11,lineHeight:1.5,flexWrap:"wrap"}}>
                  <span style={{flexShrink:0,color:robSuggOpt?robSuggOpt.color:C.dim,fontWeight:700}}>From RoB: {robSuggOpt?robSuggOpt.label:"—"}</span>
                  <span style={{flex:1,minWidth:160,color:C.muted}}>Suggested from {robSummary.completed} finalised RoB assessment{robSummary.completed===1?"":"s"} ({robSummary.counts.low} low · {robSummary.counts.some} some · {robSummary.counts.high} high).{robSummary.pending>0?` ${robSummary.pending} not finalised.`:""}</span>
                  {robMatches
                    ?<span style={{...tagS("green"),flexShrink:0}}>{robSync?.source===ROB_GRADE_SOURCE.AUTO?"auto-synced":"applied"}</span>
                    :<button onClick={acceptRobSuggestion} style={{...btnS("ghost"),fontSize:10,padding:"2px 8px",flexShrink:0}}>Use RoB suggestion</button>}
                </div>
                {robSync?.source===ROB_GRADE_SOURCE.MANUAL&&!robStale&&grade.rob&&!robMatches&&<div style={{fontSize:10.5,color:C.dim}}>Manually set — kept even though it differs from the RoB suggestion.</div>}
                {robStale&&(
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",fontSize:11,color:C.yel,background:themeAlpha(C.yel,'12'),border:`1px solid ${themeAlpha(C.yel,'40')}`,borderRadius:6,padding:"6px 10px"}}>
                    <span style={{flex:1,minWidth:160}}>⚠ Risk of Bias assessments changed since this GRADE judgement was last reviewed.</span>
                    <button onClick={acceptRobSuggestion} style={{...btnS("ghost"),fontSize:10,padding:"2px 8px"}}>Re-sync</button>
                    <button onClick={dismissRobStale} style={{...btnS("ghost"),fontSize:10,padding:"2px 8px"}}>Keep mine</button>
                  </div>
                )}
              </div>);
            })():d.id==="rob"&&robList?(
              <div style={{marginTop:7,fontSize:11,color:C.muted,lineHeight:1.5}}><Icon name="info" size={11}/> {robSummary?robSummary.reason:"No finalised RoB assessments yet."}</div>
            ):sg&&(
              <div style={{marginTop:7,display:"flex",alignItems:"flex-start",gap:8,fontSize:11,color:C.muted,lineHeight:1.5}}>
                <span style={{flexShrink:0,color:sgOpt?sgOpt.color:C.dim,fontWeight:700}}>
                  {sgOpt?`Suggest: ${sgOpt.label}`:"Your call"}
                </span>
                <span style={{flex:1}}>{sg.reason}</span>
                {sgOpt&&!matches&&<button onClick={()=>setRating(d.id,sg.suggest)} style={{...btnS("ghost"),fontSize:10,padding:"2px 8px",flexShrink:0}}>Apply</button>}
                {matches&&<span style={{...tagS("green"),flexShrink:0}}>applied</span>}
              </div>
            )}
          </div>
        );})}
      </div>

      <div style={{background:C.card,border:`2px solid ${themeAlpha(levelColors[finalLevel-1],'55')}`,borderRadius:8,padding:18}}>
        <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:1,marginBottom:10}}>OVERALL CERTAINTY</div>
        <div style={{fontSize:36,fontWeight:800,color:levelColors[finalLevel-1],marginBottom:4}}>{levels[finalLevel-1]}</div>
        <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:18,color:levelColors[finalLevel-1],marginBottom:14}}>{levelEmoji[finalLevel-1]}</div>
        <div style={{fontSize:11,color:C.muted,lineHeight:1.6}}>
          Started at <strong style={{color:C.txt}}>{levels[startLevel-1]}</strong> ({project.pico?.studyDesign||"unknown design"})<br/>
          {totalModifier!==0?<>Downgraded by <strong style={{color:C.red}}>{Math.abs(totalModifier)}</strong> level{Math.abs(totalModifier)!==1?"s":""}</>:<>No downgrades applied</>}
        </div>
        {result && (
          <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.brd}`}}>
            <div style={{fontSize:10,color:C.muted,marginBottom:6}}>EVIDENCE BASE</div>
            <div style={{fontSize:12,color:C.muted}}>k = <strong style={{color:C.txt}}>{result.k}</strong> studies</div>
            <div style={{fontSize:12,color:C.muted}}>Pooled ES = <strong style={{color:C.txt,fontFamily:"'IBM Plex Mono',monospace"}}>{fmtES(result.pES,prec)}</strong></div>
            <div style={{fontSize:12,color:C.muted}}>I² = <strong style={{color:result.I2>50?C.yel:C.txt}}>{result.I2}%</strong></div>
          </div>
        )}
      </div>
    </div>

    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:14}}>
      <div style={{fontSize:11,fontWeight:700,color:C.acc,letterSpacing:1,marginBottom:10}}>HOW GRADE WORKS</div>
      <div style={{fontSize:12,color:C.muted,lineHeight:1.7}}>
        Start: <span style={{color:C.grn}}>High</span> (RCTs) or <span style={{color:C.yel}}>Low</span> (observational). Downgrade for each serious concern. Upgrade rare for observational studies (large effects, dose-response).
        <br/><br/>
        <strong style={{color:C.txt}}>Final ratings:</strong> <span style={{color:C.grn}}>High</span> (further research very unlikely to change confidence) · <span style={{color:C.yel}}>Moderate</span> (likely to have important impact) · <span style={{color:C.red}}>Low</span> (very likely impact) · <span style={{color:C.red}}>Very low</span> (any estimate is very uncertain).
      </div>
    </div>
  </div>);
}

/* ════════════ TAB: AI MANUSCRIPT DRAFTER ════════════ */
function LegacyManuscriptTab({project,upd}){
  const{pico,search,prisma,studies}=project;
  const persistedM = project.manuscript || {};
  const drafts = persistedM.drafts || {};
  const sourceKeys = persistedM.sourceKeys || {};
  const[section,setSection]=useState(persistedM.lastSection||"methods");
  const[loading,setLoading]=useState(null);
  const[copied,setCopied]=useState("");
  const[error,setError]=useState("");

  const saveManuscript = (patch) => upd("manuscript", {...persistedM, ...patch});
  const setDrafts = (updater) => {
    const newDrafts = typeof updater === "function" ? updater(drafts) : updater;
    saveManuscript({drafts: newDrafts});
  };
  const setSectionPersist = (sid) => { setSection(sid); saveManuscript({lastSection: sid}); };

  // Source data fingerprint — used to detect when underlying data changed
  const currentDataKey = [
    pico.P, pico.I, pico.C, pico.O, pico.studyDesign,
    studies.length,
    studies.map(s => s.es).join(","),
    prisma.dbs, prisma.included, prisma.quant
  ].join("|");

  const result=useMemo(()=>runMeta(studies,"random"),[studies]);
  const egger=useMemo(()=>eggersTest(studies),[studies]);

  const sections=[
    {id:"methods",label:"Methods",icon:"🔬",desc:"Search strategy, eligibility, extraction, synthesis methods"},
    {id:"results",label:"Results",icon:"📊",desc:"Study selection, characteristics, synthesis, heterogeneity"},
    {id:"discussion",label:"Discussion",icon:"💭",desc:"Interpretation, comparison with literature, limitations"},
    {id:"abstract",label:"Abstract",icon:"📄",desc:"Structured abstract: Background, Methods, Results, Conclusions"},
  ];

  const generate=async(secId)=>{
    setLoading(secId);setError("");
    const ctx=[
      pico.P&&`Population: ${pico.P}`,
      pico.I&&`Intervention: ${pico.I}`,
      pico.C&&`Comparator: ${pico.C}`,
      pico.O&&`Outcome(s): ${pico.O}`,
      pico.studyDesign&&`Study design: ${pico.studyDesign}`,
      pico.prosperoId&&`PROSPERO: ${pico.prosperoId}`,
      Object.keys(search.dbs||{}).filter(k=>search.dbs[k]).length>0 && `Databases: ${Object.keys(search.dbs).filter(k=>search.dbs[k]).join(", ")}`,
      search.date && `Search date: ${search.date}`,
      prisma.dbs && `Records identified: ${prisma.dbs}`,
      prisma.dedupe && `Duplicates removed: ${prisma.dedupe}`,
      prisma.included && `Studies included: ${prisma.included}`,
      studies.length && `Studies extracted: ${studies.length}`,
      result && `Meta-analysis: k=${result.k}, pooled ES=${result.pES} [${result.lo95}, ${result.hi95}], I²=${result.I2}%, p=${result.pval<0.001?"<0.001":result.pval}`,
      egger && `Egger's test: intercept=${egger.intercept}, p=${egger.pval}`,
    ].filter(Boolean).join("\n");

    const studyList=studies.slice(0,15).map(s=>{
      return `- ${s.author||"Anon"} ${s.year||""} (${s.design}, n=${s.n||"?"}, ${s.country||"?"}): ES=${s.es||"—"}`;
    }).join("\n");

    const guidance={
      methods: `Write the METHODS section of a systematic review and meta-analysis manuscript. Cover: (1) protocol registration; (2) eligibility criteria (PICO); (3) information sources & search strategy; (4) selection process; (5) data extraction; (6) risk of bias assessment; (7) effect measures; (8) synthesis methods (random-effects DerSimonian-Laird, I² for heterogeneity); (9) certainty of evidence (GRADE if applicable). Use third person, past tense. ~400-500 words. Reference PRISMA 2020.`,
      results: `Write the RESULTS section. Cover: (1) study selection (cite the PRISMA flow); (2) study characteristics summary; (3) risk of bias overview; (4) main meta-analysis result with pooled ES, 95% CI, p-value, k studies; (5) heterogeneity (I², Q, τ²); (6) sensitivity analyses if applicable; (7) publication bias assessment. Use third person, past tense. ~400-500 words. Include the actual numbers from the data provided.`,
      discussion: `Write the DISCUSSION section. Cover: (1) summary of main findings; (2) interpretation and comparison with previous literature; (3) strengths of the review; (4) limitations (including heterogeneity, publication bias, certainty of evidence); (5) implications for practice; (6) implications for future research. Use third person, present/past tense. ~500-600 words. Be balanced and avoid overstating.`,
      abstract: `Write a STRUCTURED ABSTRACT (~250 words) with these sections: Background (2-3 sentences on rationale), Objective (the review question), Methods (databases, eligibility, synthesis approach), Results (k studies, pooled estimate with CI, heterogeneity, key finding), Conclusions (1-2 sentences). Use past tense.`,
    };

    const prompt=`You are a medical writer drafting a systematic review manuscript. Use the data provided to write the requested section. Be accurate, professional, and avoid hallucinating numbers — only use values present in the context.

CONTEXT:
${ctx}

INCLUDED STUDIES (sample):
${studyList}

TASK: ${guidance[secId]}

Output ONLY the section text — no labels, no preamble, no markdown headers. Use prose paragraphs.`;

    try {
      const text=await callClaude(prompt,2500);
      const newDrafts = {...drafts, [secId]: text};
      const newKeys = {...sourceKeys, [secId]: currentDataKey};
      saveManuscript({drafts: newDrafts, sourceKeys: newKeys, generatedAt: new Date().toISOString()});
    } catch(e){setError(`Error: ${e.message}`);}
    setLoading(null);
  };

  const copy=(text,id)=>navigator.clipboard.writeText(text).then(()=>{setCopied(id);setTimeout(()=>setCopied(""),2000);});

  const wordCount=(t)=>t?t.trim().split(/\s+/).length:0;

  return(<div>
    <SectionHeader icon="pencil" title={AI_FEATURES_ENABLED?"AI Manuscript Drafter":"Manuscript Draft"} desc={AI_FEATURES_ENABLED?"Generate publication-ready draft sections from your project data. Edit and refine before submitting.":"Write your manuscript sections — Methods, Results, Discussion, Abstract — alongside your project data. Drafts save with the project."}/>

    <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
      {sections.map(s=>(
        <button key={s.id} onClick={()=>setSectionPersist(s.id)} style={btnS(section===s.id?"primary":"ghost")}>
          {s.icon} {s.label}{drafts[s.id]?(AI_FEATURES_ENABLED&&sourceKeys[s.id]&&sourceKeys[s.id]!==currentDataKey?" ⚠":" ✓"):""}
        </button>
      ))}
    </div>

    {(()=>{const sec=sections.find(s=>s.id===section); const stale = AI_FEATURES_ENABLED && drafts[section] && sourceKeys[section] && sourceKeys[section] !== currentDataKey; return(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:18}}>
        {stale && (
          <div style={{background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'55')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:14}}>
            <span style={{fontSize:13}}>🔄</span>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:700,color:C.yel}}>Source data changed since this section was drafted</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>PICO, studies, or analysis results have been updated. Click sync to regenerate with the latest data.</div>
            </div>
            <button onClick={()=>generate(section)} disabled={loading===section} style={{...btnS("ghost"),fontSize:11,color:C.yel,borderColor:themeAlpha(C.yel,'55'),opacity:loading===section?0.5:1}}>
              {loading===section?"⟳ Syncing…":"↻ Sync this section"}
            </button>
          </div>
        )}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,gap:14}}>
          <div>
            <div style={{fontSize:14,fontWeight:700,marginBottom:3}}>{sec.icon} {sec.label}</div>
            <div style={{fontSize:11,color:C.muted}}>{sec.desc}</div>
            {drafts[section] && <div style={{fontSize:10,color:C.dim,marginTop:4,fontFamily:"'IBM Plex Mono',monospace"}}>{wordCount(drafts[section])} words · {drafts[section].length} chars{AI_FEATURES_ENABLED?(stale?" · ⚠ stale":" · ✓ in sync"):""}</div>}
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0}}>
            <div style={{display:"flex",gap:8}}>
              {drafts[section] && <button onClick={()=>copy(drafts[section],section)} style={{...btnS("ghost"),fontSize:11}}>{copied===section?"✓ Copied":"📋 Copy"}</button>}
              {AI_FEATURES_ENABLED&&<button onClick={()=>generate(section)} disabled={loading===section} style={{...btnS("primary"),fontSize:12,padding:"7px 18px",opacity:loading===section?0.5:1}}>
                {loading===section?"⟳ Drafting…":drafts[section]?"↻ Regenerate":"✦ Generate Draft"}
              </button>}
            </div>
            {AI_FEATURES_ENABLED&&<span style={{
              fontSize:11,fontFamily:"'IBM Plex Mono',monospace",
              background:persistedM.generatedAt?`${themeAlpha(C.grn,'15')}`:C.card,
              color:persistedM.generatedAt?C.grn:C.dim,
              border:`1px solid ${persistedM.generatedAt?themeAlpha(C.grn,'44'):C.brd}`,
              borderRadius:4,padding:"3px 8px",whiteSpace:"nowrap"
            }}>
              🕐 {persistedM.generatedAt
                ? `Last generated: ${fmtDate(persistedM.generatedAt)} ${new Date(persistedM.generatedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`
                : "Not yet generated"}
            </span>}
          </div>
        </div>
        {error && <div style={{fontSize:12,color:C.red,marginBottom:10}}>{error}</div>}
        <textarea value={drafts[section]||""} onChange={e=>setDrafts(prev=>({...prev,[section]:e.target.value}))}
          placeholder={AI_FEATURES_ENABLED?"Click ✦ Generate Draft to produce this section from your project data, or type directly here.":"Type this section here — it saves with your project."}
          rows={18}
          style={{...inp,fontSize:13,lineHeight:1.75,resize:"vertical",fontFamily:"'IBM Plex Sans',sans-serif"}}/>
      </div>
    );})()}

    <InfoBox>💡 {AI_FEATURES_ENABLED?"The drafter pulls from your PICO, search strategy, PRISMA numbers, study data, and analysis results. Always verify numbers, citations, and claims before submitting. Generate sections in order (Methods → Results → Discussion → Abstract) for best coherence.":"Draft sections in order (Methods → Results → Discussion → Abstract) for best coherence, and verify every number, citation, and claim against your analysis before submitting."}</InfoBox>
  </div>);
}

/* 64.md (P3) — Manuscript tab dispatcher. Both shells (legacy Workspace.jsx and
   Stitch StitchProjectWorkspace.jsx) import THIS ManuscriptTab, so gating here is
   the single rollout switch. When the `manuscriptEditor` flag is ON, render the
   full structured manuscript workspace (editor + data-linked tables + citations +
   inline PRISMA 2020 + .docx/.zip export); otherwise fall back to the legacy
   textarea drafter so the flag-OFF path is 100% unchanged. The heavy workspace
   (and the docx library it pulls) is lazy-loaded so it never enters the main
   bundle while the flag is off. */
const ManuscriptWorkspaceLazy = lazy(() =>
  import("../../../features/manuscript/ManuscriptWorkspace.jsx").then((m) => ({ default: m.ManuscriptWorkspace })));

export function ManuscriptTab(props){
  const [flag, setFlag] = useState(null);
  useEffect(() => {
    let alive = true;
    manuscriptEditorFlagEnabled().then((v) => { if (alive) setFlag(v); }).catch(() => { if (alive) setFlag(false); });
    return () => { alive = false; };
  }, []);
  if (flag === null) return <div style={{padding:24,color:C.muted,fontSize:13}}>Loading manuscript…</div>;
  if (flag) {
    return (
      <Suspense fallback={<div style={{padding:24,color:C.muted,fontSize:13}}>Loading manuscript editor…</div>}>
        <ManuscriptWorkspaceLazy {...props}/>
      </Suspense>
    );
  }
  return <LegacyManuscriptTab {...props}/>;
}

/* ════════════ METHODS & EQUATIONS TAB (prompt6 Task 13) ════════════ */
/* Replaces the removed Templates downloads. Renders the engine-owned
   METHODS_CONTENT catalogue (src/research-engine/docs/methods-content.js):
   every statistical method actually implemented in the app — equation as
   computed, plain-English meaning, UI surface, implementation pointer,
   verified references and limitations. verified:false ⇒ amber badge. */
/* MATH_FONT + Frac live in src/frontend/workspace/ui/primitives.jsx (imported
   above). */
export function MethodsTab(){
  return(<div>
    <SectionHeader icon="bookOpen" title="Methods & Equations"
      desc="Every statistical method implemented in PecanRev, documented as computed: the equation, what it means in plain English, where it runs in the app, and verified references. Methods not listed here are not implemented."/>
    {METHODS_CONTENT.map(m=>(
      <div key={m.id} style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"16px 18px",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:10}}>
          <h3 style={{margin:0,fontSize:14.5,fontWeight:700,letterSpacing:-0.2,color:C.txt,lineHeight:1.3}}>{m.title}</h3>
          {m.verified===false&&<span style={tagS("yellow")} title="In-house heuristic or citation not yet verified against a formula-specific source">⚠ needs verification</span>}
        </div>
        {/* Equations — plain Unicode math in a serif math font */}
        <div style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:8,padding:"10px 14px",marginBottom:12}}>
          {m.equations.map((eq,i)=>(
            <div key={i} style={{display:"flex",alignItems:"baseline",gap:14,flexWrap:"wrap",padding:"5px 0",borderBottom:i<m.equations.length-1?`1px solid ${C.brd}`:"none"}}>
              <span style={{fontSize:10,fontWeight:600,color:C.muted,letterSpacing:0.3,minWidth:220,flexShrink:0}}>{eq.label}</span>
              <span style={{fontFamily:MATH_FONT,fontSize:14,color:C.txt,lineHeight:1.6}}>{eq.text}</span>
            </div>
          ))}
        </div>
        <p style={{margin:"0 0 12px",fontSize:12.5,color:C.txt2,lineHeight:1.7}}>{m.plainEnglish}</p>
        <div style={{display:"grid",gridTemplateColumns:"110px 1fr",rowGap:6,columnGap:12,fontSize:11.5,lineHeight:1.6}}>
          <span style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:0.7,textTransform:"uppercase",paddingTop:1}}>Used in</span>
          <span style={{color:C.txt2}}>{m.usedIn}</span>
          <span style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:0.7,textTransform:"uppercase",paddingTop:1}}>Implemented in</span>
          <span style={{color:C.txt2,fontFamily:"'IBM Plex Mono',monospace",fontSize:10.5}}>{m.implementedIn}</span>
          <span style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:0.7,textTransform:"uppercase",paddingTop:1}}>References</span>
          <span>
            {m.references.map((r,i)=>(
              <span key={i} style={{display:"block",color:C.txt2}}>{r}</span>
            ))}
          </span>
          <span style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:0.7,textTransform:"uppercase",paddingTop:1}}>Limitations</span>
          <span style={{color:C.muted}}>{m.limitations}</span>
        </div>
      </div>
    ))}
    <InfoBox color={C.yel}>
      <strong style={{color:C.txt}}>Not implemented:</strong> {NOT_IMPLEMENTED.join(" · ")}. This catalogue documents only methods that actually run in the app — if a method is not listed above, PecanRev does not compute it.
    </InfoBox>
  </div>);
}
