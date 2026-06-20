/* ════════════ RISK-OF-BIAS TABS (extracted prompt46 Phase 6f — verbatim) ════════════
   Moved VERBATIM from meta-lab-3-patched.jsx: RoBTab, LegacyRoBTab. No logic
   changes — only import wiring.

   RoBTab is the dispatcher: when the rob_engine_v2 flag is ON it renders the
   standalone RoB 2 engine (ProjectRobPanel) scoped to the open project; when OFF
   it falls back to the legacy per-study table (LegacyRoBTab).

   Keeps using the monolith-derived shared modules (C/btnS/th/tagS from
   ui/styles.js; SectionHeader from ui/primitives.jsx; ROB2/NOS from
   monolithConstants; projectPerms from projectHelpers) and the same rob/ engine
   modules + flushStorage the monolith uses. */
import { useState, useEffect, useCallback } from "react";
import { flushStorage } from "../../storage/serverStorage.js";
import { C, btnS, th, tagS } from "../ui/styles.js";
import { SectionHeader } from "../ui/primitives.jsx";
import { ROB2, NOS } from "../../../research-engine/project-model/monolithConstants.js";
import { projectPerms } from "../projectHelpers.js";
import ProjectRobPanel from "../../rob/ProjectRobPanel.jsx";
import { robFlagEnabled } from "../../rob/robApi.js";
import { normalizeRobTool } from "../../../research-engine/rob/tools.js";

/* ════════════ TAB: RISK OF BIAS ════════════ */
/* prompt28 Part 2 — dispatcher. When the rob_engine_v2 flag is ON, the project's
   Risk of Bias tab IS the new standalone RoB 2 engine, scoped to the currently
   open project (no project selector, no leaving the workspace). When the flag is
   OFF, the original lightweight per-study table (LegacyRoBTab) is preserved so
   nothing breaks for projects/orgs that have not enabled the engine. */
export function RoBTab({project,updateProject,activeId,setTab,onWorkspaceChange}){
  const[flag,setFlag]=useState(null); // null=checking
  // prompt39 Task 3 — hide the overview intro header while a per-study assessment
  // workspace is open, so the user focuses on the assessment tool itself.
  const[inWorkspace,setInWorkspace]=useState(false);
  // prompt42 Task 7 — also lift the workspace-open signal to the monolith shell so it
  // can drop page-level scroll (the assessment then owns all scrolling internally).
  const handleWorkspaceChange=useCallback((v)=>{ setInWorkspace(v); onWorkspaceChange&&onWorkspaceChange(v); },[onWorkspaceChange]);
  useEffect(()=>{let dead=false;
    (async()=>{
      // Persist any pending autosave first so the owner-scoped RoB engine reads
      // the LATEST studies/criteria for this project (a study just added in Data
      // Extraction is server-validated on assess, so it must be saved by then).
      try{ await flushStorage(); }catch{ /* best-effort */ }
      let v=false; try{ v=await robFlagEnabled(); }catch{ v=false; }
      if(!dead) setFlag(!!v);
    })();
    return()=>{dead=true;};
  },[]);
  if(flag===null) return <div style={{padding:40,textAlign:"center",color:C.muted,fontSize:13}}>Loading Risk of Bias…</div>;
  if(!flag) return <LegacyRoBTab project={project} updateProject={updateProject} activeId={activeId}/>;
  const perms=projectPerms(project);
  // prompt41 Task 5 — a member granted canAssessRiskOfBias can EDIT RoB even without
  // broad canEditMetaLab; read-only members stay view-only. Owner always edits.
  const canEdit=(!!perms.canEdit||!!perms.canAssessRiskOfBias)&&!project._readOnly;
  // prompt42 Task 7 — when the per-study workspace is open, this wrapper must give the
  // RobWorkspace flex chain a bounded height to fill (no page scroll); the RoB overview
  // list keeps its normal in-flow height + page scroll.
  return(<div style={inWorkspace?{height:"100%",display:"flex",flexDirection:"column",minHeight:0}:undefined}>
    {!inWorkspace&&<SectionHeader icon="scale" title="Risk of Bias" desc="Outcome-level RoB 2 for this project — the engine proposes a judgement; you decide."/>}
    <ProjectRobPanel
      projectId={activeId}
      embedded
      canEdit={canEdit}
      onWorkspaceChange={handleWorkspaceChange}
      robTool={normalizeRobTool(project.robTool)}
      onSelectTool={id=>updateProject(activeId,p=>({...p,robTool:normalizeRobTool(id)}))}
      onContinue={setTab?(t=>setTab(t||"grade")):undefined}
    />
  </div>);
}

export function LegacyRoBTab({project,updateProject,activeId}){
  const{studies,robMethod}=project;
  const setMethod=m=>updateProject(activeId,p=>({...p,robMethod:m}));
  const updRob=(sid,domain,val)=>updateProject(activeId,p=>({...p,studies:p.studies.map(s=>s.id===sid?{...s,rob:{...s.rob,[domain]:val}}:s)}));
  const domains=robMethod==="RoB2"?ROB2:NOS;
  const robColor=v=>{if(!v)return C.dim;if(robMethod==="RoB2")return v==="Low"?C.grn:v==="High"?C.red:C.yel;return v==="★"?C.yel:C.dim;};
  const getOverall=s=>{const vals=ROB2.map(d=>s.rob?.[d.id]);if(vals.some(v=>v==="High"))return"High";if(vals.some(v=>v==="Some concerns"))return"Some concerns";if(vals.every(v=>v==="Low"))return"Low";return null;};
  return(<div>
    <SectionHeader icon="scale" title="Risk of Bias Assessment" desc="Evaluate methodological quality of each included study."/>
    <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
      {[["RoB2","RoB 2 (RCTs)"],["NOS","Newcastle-Ottawa (Observational)"]].map(([m,label])=>(
        <button key={m} onClick={()=>setMethod(m)} style={btnS(robMethod===m?"primary":"ghost")}>{label}</button>
      ))}
      <a href={robMethod==="RoB2"?"https://www.riskofbias.info/":"https://www.ohri.ca/programs/clinical_epidemiology/oxford.asp"}
        target="_blank" rel="noreferrer" style={{marginLeft:"auto",fontSize:11,color:C.acc}}>Official tool guide ↗</a>
    </div>
    {studies.length===0?(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>Add studies in Data Extraction first</div>):(
      <><div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr>
            <th style={{...th,textAlign:"left",minWidth:150}}>Study</th>
            {domains.map(d=><th key={d.id} style={{...th,minWidth:robMethod==="RoB2"?130:110}}>
              {robMethod==="NOS"&&<div style={{fontSize:9,color:C.dim,marginBottom:2}}>{d.g}</div>}
              <div style={{fontSize:10,lineHeight:1.3}}>{d.label}</div>
            </th>)}
            <th style={{...th,minWidth:robMethod==="RoB2"?100:60}}>{robMethod==="RoB2"?"Overall":"Score /9"}</th>
          </tr></thead>
          <tbody>{studies.map(s=>{
            const nosScore=robMethod==="NOS"?Object.values(s.rob||{}).filter(v=>v==="★").length:0;
            const overall=robMethod==="RoB2"?getOverall(s):null;
            return(<tr key={s.id} style={{borderBottom:`1px solid ${C.brd}`}}>
              <td style={{padding:"8px 10px",fontWeight:500}}>{s.author||"?"}{s.year?` ${s.year}`:""}</td>
              {domains.map(d=><td key={d.id} style={{padding:"6px 8px",textAlign:"center"}}>
                {robMethod==="RoB2"?(
                  <select value={s.rob?.[d.id]||""} onChange={e=>updRob(s.id,d.id,e.target.value)}
                    style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:4,padding:"3px 5px",color:robColor(s.rob?.[d.id]),fontSize:11,cursor:"pointer"}}>
                    <option value="">–</option><option value="Low">✓ Low</option><option value="Some concerns">⚠ Some concerns</option><option value="High">✗ High</option>
                  </select>
                ):(
                  <button onClick={()=>updRob(s.id,d.id,s.rob?.[d.id]==="★"?"":"★")}
                    style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:s.rob?.[d.id]==="★"?C.yel:C.dim,padding:0}}>★</button>
                )}
              </td>)}
              <td style={{padding:"6px 8px",textAlign:"center"}}>
                {robMethod==="RoB2"&&overall&&<span style={tagS(overall==="Low"?"green":overall==="High"?"red":"yellow")}>{overall}</span>}
                {robMethod==="NOS"&&<span style={{fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,color:nosScore>=7?C.grn:nosScore>=4?C.yel:C.red}}>{nosScore}/9</span>}
              </td>
            </tr>);
          })}</tbody>
        </table>
      </div>
      {robMethod==="RoB2"&&(<div style={{marginTop:14,background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:14}}>
        <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:10}}>OVERALL SUMMARY</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {["Low","Some concerns","High"].map(v=><span key={v} style={tagS(v==="Low"?"green":v==="High"?"red":"yellow")}>{studies.filter(s=>getOverall(s)===v).length} — {v}</span>)}
        </div>
      </div>)}</>
    )}
  </div>);
}
