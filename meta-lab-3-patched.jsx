import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { createPortal } from "react-dom";
import { METHODS_CONTENT, NOT_IMPLEMENTED } from "./src/research-engine/docs/methods-content.js";
import { screeningApi } from "./src/frontend/screening/api-client/screeningApi.js";
import SiftProject from "./src/frontend/screening/pages/SiftProject.jsx";
import { PERMISSION_PRESETS, ASSIGNABLE_PRESETS } from "./src/research-engine/screening/permissionPresets.js";
import { useRealtime } from "./src/frontend/hooks/useRealtime.js";
import { useProjectPresence, useFieldLock } from "./src/frontend/screening/hooks/usePresence.js";
import PresenceIndicator from "./src/frontend/screening/components/PresenceIndicator.jsx";
import { useAuth } from "./src/frontend/context/AuthContext.jsx";
import { flushStorage, hasPendingSave } from "./src/frontend/storage/serverStorage.js";
import { alpha as themeAlpha } from "./src/frontend/theme/tokens.js";
import { useTheme } from "./src/frontend/theme/ThemeContext.jsx";
import { Icon } from "./src/frontend/components/icons.jsx";
import Tooltip from "./src/frontend/components/Tooltip.jsx";
import MetaLabChatLauncher from "./src/frontend/components/chat/MetaLabChatLauncher.jsx";
import NotificationsBell from "./src/frontend/components/NotificationsBell.jsx";
import UserMenu from "./src/frontend/components/UserMenu.jsx";
import ProjectMembersPanel from "./src/frontend/screening/tabs/ProjectMembersPanel.jsx";
import ExportDialog from "./src/frontend/components/ExportDialog.jsx";
import { rasterizeSvg, downloadBlob, downloadText, zipFiles } from "./src/frontend/components/exportCore.js";
// prompt42 Task 8 — one-click journal-submission ZIP (pure helpers + methods text).
import { getOutcomePairs as jsOutcomePairs, filterStudiesForOutcome as jsFilterStudies, buildStudyTableCSV as jsStudyTableCSV, buildReadmeMarkdown as jsReadme, buildManifest as jsManifest, buildWarningsText as jsWarnings, safeName as jsSafeName } from "./src/research-engine/import-export/journalSubmission.js";
// prompt44 — reference-import parsers extracted to a pure module (verbatim).
import { mkRecord, normTitle, parseRIS, parseNBIB, parseBibTeX, parseEndNoteXML, parseReferences, dedupeRecords, isNonPrimary } from "./src/research-engine/import-export/referenceParsers.js";
// prompt44 — pure domain constants extracted verbatim (no C/Icon/JSX).
import { SOURCE_OPTIONS, DATA_NATURE, ADJUST_OPTIONS, EXTRACT_FLAGS, DATA_NATURE_LABEL, ADJUST_LABEL, FLAG_LABEL, SOURCE_LABEL, ES_TYPES, ROB2, NOS, PRISMA_CL, MESH_DBS, PROSP_FIELDS, GRADE_DOMAINS } from "./src/research-engine/project-model/monolithConstants.js";
import { buildMethodsMarkdown as jsMethodsMarkdown } from "./src/research-engine/docs/methodsText.js";
// prompt44 item 2 — R validation engine (pure metafor-script generator; no execution).
import { buildMetaValidationR } from "./src/research-engine/r-validation/rValidation.js";
import { fmtNum, fmtES, fmtCI, fmtEstCI, fmtP, fmtPct, fmtI2, fmtWeight, fmtInt, normalizePrecision, DECIMAL_OPTIONS } from "./src/research-engine/format/precision.js";
import { orderStudies, EXTRACTION_SORTS, DEFAULT_EXTRACTION_SORT } from "./src/frontend/pages/extractionOrder.js";
// prompt28 Part 2 — the standalone RoB 2 engine, embedded natively into the
// "Risk of Bias" workspace tab when the rob_engine_v2 flag is on.
import ProjectRobPanel from "./src/frontend/rob/ProjectRobPanel.jsx";
import { robFlagEnabled, robApi } from "./src/frontend/rob/robApi.js";
import { normalizeRobTool } from "./src/research-engine/rob/tools.js";
// prompt34 Task 10 — completed RoB 2 assessments auto-suggest the GRADE Risk-of-Bias domain.
import { summariseRobForGrade, ROB_GRADE_SOURCE } from "./src/research-engine/rob/gradeSync.js";
import { api } from "./src/frontend/api-client/apiClient.js"; // prompt32 Task 10 — owner project delete from Project Control
// prompt38 — Protocol/PICO extracted into a feature module (strangler-fig) +
// server-backed per-module state. TIMEFRAME_OPTIONS / timeframeComplete now live
// in the feature module (re-imported here so the legacy PICOTab keeps working);
// the PICO tab delegates to ProtocolModulePanel when the serverBackedWorkflowState
// flag is ON, else it renders the legacy in-blob PICOTab below.
import { ProtocolModulePanel, TIMEFRAME_OPTIONS, timeframeComplete, STUDY_DESIGNS } from "./src/features/protocol/index.js";
import { workflowStateFlagEnabled } from "./src/services/workflowState/api.js";
import { makeWorkflowMenuRules } from "./src/frontend/pages/workflowMenu.js"; // prompt39 Task 6
// SearchEngine — separated concept→multi-database Search Builder. The Search tab
// delegates to SearchBuilderTab when the `searchEngine` flag is ON, else the
// legacy in-blob SearchTab below.
import { SearchBuilderTab, searchBuilderApi, loadSearch as sbLoad, saveSearch as sbSave, searchEngineFlagEnabled } from "./src/features/searchBuilder/index.js";

/* ════════════ UTILS ════════════ */
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ════════════ EXPORT DIALOG PLUMBING (prompt9 Task 6) ════════════
   ONE ExportDialog instance lives at the app root (MetaLab); deep components
   open it via this module-level trampoline instead of prop-drilling through
   every tab. MetaLab registers its setExpItem here on mount. */
let _openExportDialog = null;
const openExportDialog = (item) => { if (_openExportDialog) _openExportDialog(item); };

/* SVG_XML_HEADER, presetTag, liveSvgToString + the string builders
   buildPrismaSVG / buildPubForestSVG extracted VERBATIM to
   src/frontend/workspace/charts/svgBuilders.js (prompt46 Phase 4) and imported
   here. ForestPlot / FunnelPlot live in the sibling charts.jsx. */
import { SVG_XML_HEADER, presetTag, liveSvgToString, buildPrismaSVG, buildPubForestSVG } from "./src/frontend/workspace/charts/svgBuilders.js";
import { ForestPlot, FunnelPlot } from "./src/frontend/workspace/charts/charts.jsx";

/* ════════════ STATISTICS / VALIDATION (extracted prompt46 Phase 2 — verbatim, monolith-own copies) ════════════ */
import { Z975, normalCDF, runMeta, eggersTest, leaveOneOut, trimFill, influenceDiagnostics, subgroupAnalysis, gammp, chiSquareCDF, betacf, lgamma, ibeta, tCDF, tCrit, invNormAbs, calcES, analysisTypeWarnings, invNorm, CONVERSIONS, validateStudy, findDuplicates, checkPoolability } from "./src/research-engine/statistics/monolithStats.js";

/* ════════════ SHARED PROJECT HELPERS / CONFIG (extracted prompt46 Phase 6a — verbatim) ════════════ */
import { mkProject, mkStudy, interpretResult, GRADE_OPTIONS, gradeSuggestions, TABS, PHASES, READING_TABS, PHASE_ICON, readinessCheck, stepStatus, auditProject, projectPerms, linkedSiftId, CTRL_STATUS_OPTIONS } from "./src/frontend/workspace/projectHelpers.js";

/* ════════════ OVERVIEW / HEADER / CONTROL TABS (extracted prompt46 Phase 6b — verbatim) ════════════ */
import { AuditPanel, ProjectTitle, ProjectHeaderBar, ScreeningWorkspaceFrame, EmbeddedScreening, OverviewTab, ControlTab } from "./src/frontend/workspace/tabs/overviewTabs.jsx";

/* ════════════ DEFAULTS ════════════
   mkProject / mkStudy now live in src/frontend/workspace/projectHelpers.js
   (imported above). */


/* ════════════ REFERENCE IMPORT (RIS / BibTeX / EndNote XML / nbib) ════════════ */
/* Pure parsers (mkRecord, normTitle, parseRIS/NBIB/BibTeX/EndNoteXML,
   parseReferences, dedupeRecords) + isNonPrimary now live in
   src/research-engine/import-export/referenceParsers.js (imported above). */


/* ════════════ THEME ════════════ */
/* Theme tokens (C) + style helpers (btnS/inp/lbl/th/tagS) extracted VERBATIM to
   src/frontend/workspace/ui/styles.js (prompt46 Phase 3). The monolith keeps its
   OWN copy (distinct from src/frontend/theme/tokens.js's C) — imported back here.
   Alpha tints MUST go through themeAlpha(C.x,'NN') — `${C.x}NN` concatenation
   breaks on var() strings. */
import { C, btnS, inp, lbl, th, tagS } from "./src/frontend/workspace/ui/styles.js";

/* ════════════ SHARED COMPONENTS ════════════ */
/* SwitchToggle / SectionHeader / InfoBox / HelpTip / AIButton / ProgressBar
   extracted VERBATIM to src/frontend/workspace/ui/primitives.jsx (prompt46
   Phase 3) and imported back. (CriteriaList, Frac + MATH_FONT also live there.)
   NOTE: the monolith keeps its OWN copies — NOT merged with the look-alikes in
   src/features/protocol/picoUi.jsx (behaviour parity). */
import { SwitchToggle, SectionHeader, InfoBox, HelpTip, AIButton, ProgressBar, CriteriaList, Frac, MATH_FONT } from "./src/frontend/workspace/ui/primitives.jsx";

/* ════════════ FOREST + FUNNEL PLOTS ════════════ */
/* ForestPlot / FunnelPlot extracted VERBATIM to
   src/frontend/workspace/charts/charts.jsx (prompt46 Phase 4) and imported at
   the top of this file. */

/* ════════════ AI / CITATION SERVICES (extracted prompt46 Phase 5 — verbatim; all behind AI_FEATURES_ENABLED=false) ════════════ */
import { AI_FEATURES_ENABLED, CLAUDE_MODELS, callClaude, callClaudeWeb, fetchCitationAI, fileToBase64, fetchByDOI, fetchByPMID, testClaudeConnection, safeParseJSON, parseSections, parseBullets, parseTermReasons, parseConceptBlocks, parseFilters } from "./src/frontend/services/aiService.js";


/* ════════════ TAB: PICO ════════════ */
function PICOTab({project,updNested,upd,lockCtx}){
  const{pico}=project;
  const ch=(k,v)=>updNested("pico",k,v);
  const[busy,setBusy]=useState("");
  const hasCore=pico.P||pico.I||pico.O;

  // prompt23 Task 5 (L1 follow-up) — collaborative field locks on the shared PICO
  // fields. One useFieldLock per field (fixed count → safe hook order); fail-open
  // when no screening workspace is linked (lockCtx.pid null → editing never blocked).
  const lc = lockCtx || {};
  const lockP = useFieldLock({ pid: lc.pid, field: "pico.P", myUserId: lc.myUserId, locks: lc.locks, enabled: !!lc.pid });
  const lockI = useFieldLock({ pid: lc.pid, field: "pico.I", myUserId: lc.myUserId, locks: lc.locks, enabled: !!lc.pid });
  const lockC = useFieldLock({ pid: lc.pid, field: "pico.C", myUserId: lc.myUserId, locks: lc.locks, enabled: !!lc.pid });
  const lockO = useFieldLock({ pid: lc.pid, field: "pico.O", myUserId: lc.myUserId, locks: lc.locks, enabled: !!lc.pid });
  const fieldLocks = { P: lockP, I: lockI, C: lockC, O: lockO };

  // AI: refine the research question into a focused, answerable SR question
  const refineQuestion=async()=>{
    if(!pico.question&&!hasCore){return;}
    setBusy("question");
    const ctx=[pico.question&&`Current question: ${pico.question}`,pico.P&&`Population: ${pico.P}`,
      pico.I&&`Intervention: ${pico.I}`,pico.C&&`Comparator: ${pico.C}`,pico.O&&`Outcome: ${pico.O}`].filter(Boolean).join("\n");
    const prompt=`You are a systematic review methodologist. Rewrite the researcher's topic into ONE focused, answerable systematic-review question in proper PICO form. Keep it to 1-2 sentences. Output ONLY the refined question text, no preamble, no quotes.\n\n${ctx}`;
    try{const t=await callClaude(prompt,300);ch("question",t.trim());}catch(e){console.error(e);}
    setBusy("");
  };

  // AI: derive PICO components from the research question
  const derivePICO=async()=>{
    if(!pico.question){return;}
    setBusy("pico");
    const prompt=`You are a systematic review methodologist. Given this review question, extract the four PICO components. Be specific and concrete.\n\nQuestion: ${pico.question}\n\nRespond in EXACTLY this JSON format and nothing else:\n{"P":"population/problem","I":"intervention/exposure","C":"comparator/control","O":"outcome(s)"}`;
    try{
      const t=await callClaude(prompt,500);
      // try JSON first (most reliable)
      let filled=0;
      try{
        const clean=t.replace(/```json|```/g,"").trim();
        const j=JSON.parse(clean);
        ["P","I","C","O"].forEach(k=>{ if(j[k]&&String(j[k]).trim()){ch(k,String(j[k]).trim());filled++;} });
      }catch(_){
        // fallback: line-by-line parsing, strip markdown bold/asterisks
        const stripped=t.replace(/\*\*/g,"").replace(/\*/g,"");
        stripped.split("\n").forEach(line=>{
          const m=line.match(/^\s*\**\s*([PICO])\s*\**\s*[:.\-]\s*\**\s*(.+)/i);
          if(m){const key=m[1].toUpperCase();const val=m[2].replace(/\*\*/g,"").trim();if(val){ch(key,val);filled++;}}
        });
      }
      if(!filled) setBusy("error");
      else setBusy("");
    }catch(e){console.error("derivePICO:",e);setBusy("error");}
  };

  // AI: suggest eligibility criteria from PICO
  const suggestEligibility=async()=>{
    if(!hasCore){return;}
    setBusy("elig");
    const ctx=[pico.P&&`Population: ${pico.P}`,pico.I&&`Intervention: ${pico.I}`,pico.C&&`Comparator: ${pico.C}`,
      pico.O&&`Outcome: ${pico.O}`,pico.studyDesign&&`Study design: ${pico.studyDesign}`,pico.timeframe&&`Time frame: ${pico.timeframe}`].filter(Boolean).join("\n");
    const prompt=`You are a systematic review methodologist. Based on this PICO, write clear inclusion and exclusion criteria as concise bullet lists. Cover population, intervention, comparator, outcomes, study design, timeframe, language, and publication type.\n\n${ctx}\n\nRespond in EXACTLY this format:\n## INCLUSION\n- criterion\n- criterion\n## EXCLUSION\n- criterion\n- criterion`;
    try{
      const t=await callClaude(prompt,900);
      const secs=parseSections(t);
      if(secs.inclusion) ch("incl",parseBullets(secs.inclusion).map(x=>"• "+x).join("\n"));
      if(secs.exclusion) ch("excl",parseBullets(secs.exclusion).map(x=>"• "+x).join("\n"));
    }catch(e){console.error(e);}
    setBusy("");
  };

  const requiredFields=[
    {key:"P",label:"Population"},
    {key:"I",label:"Intervention"},
    {key:"C",label:"Comparator"},
    {key:"O",label:"Outcome"},
  ];
  const reqFilled=requiredFields.filter(f=>!!(pico[f.key]&&pico[f.key].trim())).length;
  const reqTotal=requiredFields.length;

  return(<div>
    <SectionHeader icon="target" title="Research Question & PICO" desc="Start here. Refine your question, structure it as PICO, and define who's in and who's out. Everything downstream builds on this."/>

    {/* Required fields completion indicator */}
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:12}}>
      <div style={{flex:1}}>
        <div style={{fontSize:11,fontWeight:700,color:reqFilled===reqTotal?C.grn:C.yel,marginBottom:4}}>
          {reqFilled===reqTotal?"✓ All required PICO fields complete":
           `${reqFilled}/${reqTotal} required fields filled — P, I, C, and O are mandatory`}
        </div>
        <div style={{height:4,background:C.brd,borderRadius:2}}>
          <div style={{height:4,background:reqFilled===reqTotal?C.grn:C.yel,borderRadius:2,width:`${(reqFilled/reqTotal)*100}%`,transition:"width 0.3s"}}/>
        </div>
      </div>
    </div>

    {/* Research question */}
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:14,borderLeft:`3px solid ${C.acc}`}}>
      <div style={{display:"flex",alignItems:"center",marginBottom:8}}>
        <label style={{...lbl,marginBottom:0}}>① Research Question</label>
        <HelpTip text="A good SR question is focused and answerable. Example: 'In adults with type 2 diabetes, does metformin compared with placebo reduce HbA1c?'"/>
        <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
          <AIButton onClick={refineQuestion} loading={busy==="question"} label="Refine question" disabled={!pico.question&&!hasCore}/>
          {pico.question&&<AIButton onClick={derivePICO} loading={busy==="pico"} label="Split into PICO"/>}
          {busy==="error"&&<span style={{fontSize:11,color:C.red}}>AI call failed — check console</span>}
        </div>
      </div>
      <textarea value={pico.question||""} onChange={e=>ch("question",e.target.value)}
        placeholder="e.g. In adults with type 2 diabetes, does adding an SGLT2 inhibitor to metformin, compared with metformin alone, reduce cardiovascular events?"
        style={{...inp,height:60,resize:"vertical",fontSize:13,lineHeight:1.55}}/>
    </div>

    {/* PICO grid */}
    <div style={{display:"flex",alignItems:"center",marginBottom:8}}>
      <span style={{...lbl,marginBottom:0}}>② PICO Components</span>
      <HelpTip text="Break your question into its parts. Population, Intervention/Exposure, Comparator/Control, and Outcome are all required."/>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
      {[{k:"P",label:"Population / Problem",ph:"e.g. Adults ≥18 with Type 2 diabetes, diagnosed ≥1 year",color:C.acc,req:true},
        {k:"I",label:"Intervention / Exposure",ph:"e.g. SGLT2 inhibitor added to metformin",color:C.grn,req:true},
        {k:"C",label:"Comparator / Control",ph:"e.g. Metformin alone, placebo, or standard care",color:C.yel,req:true},
        {k:"O",label:"Outcome(s)",ph:"e.g. MACE; HbA1c reduction (%); all-cause mortality",color:C.purp,req:true},
      ].map(({k,label,ph,color,req})=>{
        const fl=fieldLocks[k]||{};
        const lockedBy=fl.lockedByOther;
        return(
        <div key={k} style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:14,borderLeft:`3px solid ${color}`}}>
          <label style={{...lbl,color}}>{k} — {label} {req&&<span style={{color:C.red}}>*</span>}</label>
          <textarea value={pico[k]||""} onChange={e=>ch(k,e.target.value)} placeholder={ph}
            disabled={!!lockedBy}
            onFocus={()=>fl.acquire&&fl.acquire()}
            onBlur={()=>fl.release&&fl.release()}
            style={{...inp,height:68,resize:"vertical",fontSize:12,lineHeight:1.5,opacity:lockedBy?0.6:1,cursor:lockedBy?"not-allowed":"text"}}/>
          {lockedBy&&<div style={{fontSize:10.5,color:C.yel,marginTop:4,display:"inline-flex",alignItems:"center",gap:4}}><span>🔒</span>{lockedBy.name} is editing</div>}
        </div>
      );})}
    </div>

    {/* Study design / timeframe / prospero */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
      <div><label style={lbl}>Primary Study Design <HelpTip text="RCTs give the strongest evidence for interventions. Use cohort/case-control for exposures or harms, cross-sectional for prevalence."/></label>
        <select value={pico.studyDesign||"RCT"} onChange={e=>ch("studyDesign",e.target.value)} style={inp}>
          {STUDY_DESIGNS.map(d=><option key={d}>{d}</option>)}
        </select></div>
      <div><label style={lbl}>Time Frame <span style={{color:C.red}}>*</span></label>
        <select value={pico.timeframeMode||""} onChange={e=>ch("timeframeMode",e.target.value)} style={inp}>
          <option value="">Select…</option>
          {TIMEFRAME_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {pico.timeframeMode==="custom"&&(()=>{
          const s=parseInt(pico.tfStart,10), e=pico.tfEnd?parseInt(pico.tfEnd,10):null;
          const bad=(pico.tfStart&&!Number.isFinite(s))||(Number.isFinite(e)&&Number.isFinite(s)&&e<s);
          return(<div style={{marginTop:8}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <input type="number" min="1900" max="2100" value={pico.tfStart||""} onChange={ev=>ch("tfStart",ev.target.value)} placeholder="Start year" style={inp}/>
              <input type="number" min="1900" max="2100" value={pico.tfEnd||""} onChange={ev=>ch("tfEnd",ev.target.value)} placeholder="End year (optional)" style={inp}/>
            </div>
            {bad&&<div style={{fontSize:11,color:C.red,marginTop:4}}>Enter a valid start year; end year must be ≥ start.</div>}
          </div>);
        })()}</div>
      <div><label style={lbl}>PROSPERO ID <HelpTip text="Register your protocol on PROSPERO before screening. Paste your CRD number here once registered."/></label>
        <input value={pico.prosperoId||""} onChange={e=>ch("prosperoId",e.target.value)} placeholder="CRD42024…" style={inp}/></div>
    </div>

    {/* Structured eligibility */}
    <div style={{display:"flex",alignItems:"center",marginBottom:8}}>
      <span style={{...lbl,marginBottom:0}}>③ Eligibility Criteria</span>
      <HelpTip text={"Explicit inclusion/exclusion criteria are a PRISMA requirement and prevent arbitrary screening decisions."+(AI_FEATURES_ENABLED?" Generate a first draft from your PICO, then edit.":"")}/>
      <div style={{marginLeft:"auto"}}>
        <AIButton onClick={suggestEligibility} loading={busy==="elig"} label="Suggest criteria from PICO" disabled={!hasCore}/>
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
      <div style={{background:C.card,border:`1px solid ${themeAlpha(C.grn,'33')}`,borderRadius:8,padding:14,borderLeft:`3px solid ${C.grn}`}}>
        <label style={{...lbl,color:C.grn}}>✓ Inclusion Criteria</label>
        <CriteriaList value={pico.incl} onChange={v=>ch("incl",v)} accent={C.grn}
          placeholders={["Adults ≥18 with confirmed T2DM","RCTs with ≥12 weeks follow-up","Reports HbA1c or MACE"]}/>
      </div>
      <div style={{background:C.card,border:`1px solid ${themeAlpha(C.red,'33')}`,borderRadius:8,padding:14,borderLeft:`3px solid ${C.red}`}}>
        <label style={{...lbl,color:C.red}}>✗ Exclusion Criteria</label>
        <CriteriaList value={pico.excl} onChange={v=>ch("excl",v)} accent={C.red}
          placeholders={["Type 1 diabetes or gestational diabetes","Animal or in-vitro studies","Conference abstracts without full data"]}/>
      </div>
    </div>

    {/* Keywords */}
    <div style={{marginBottom:14}}>
      <label style={lbl}>Key Terms & Synonyms <HelpTip text={AI_FEATURES_ENABLED?"List the main concepts and their synonyms. The AI Search Builder will turn these into database-specific queries.":"List the main concepts and their synonyms — they become the building blocks of your database-specific queries."}/></label>
      <textarea value={pico.keywords||""} onChange={e=>ch("keywords",e.target.value)}
        placeholder='type 2 diabetes, T2DM, NIDDM | SGLT2 inhibitor, dapagliflozin, empagliflozin | cardiovascular, MACE'
        style={{...inp,height:56,resize:"vertical",fontFamily:"'IBM Plex Mono',monospace",fontSize:11}}/>
    </div>
    {/* prompt44 item 1 — "Additional Protocol Notes" removed from the editor UI to
        declutter (the `notes` data field is KEPT in the model for back-compat). */}

    <InfoBox>💡 <strong style={{color:C.txt}}>Next step:</strong> Once your PICO and eligibility are set, register your protocol on <a href="https://www.crd.york.ac.uk/prospero/" target="_blank" rel="noreferrer" style={{color:C.acc}}>PROSPERO</a>{AI_FEATURES_ENABLED?" (use the Protocol tab to auto-draft all fields)":" (use the Protocol tab to organise every field)"}, then move to Search Strategy. Required fields are marked <span style={{color:C.red}}>*</span>.</InfoBox>
  </div>);
}

/* prompt38 — dispatcher. When the serverBackedWorkflowState flag is ON, the PICO
   tab IS the new server-backed Protocol module (per-module state + revision +
   conflict detection + legacy blob→module migration). When OFF (default), the
   original in-blob PICOTab is preserved unchanged so nothing breaks. The module
   is the conflict-authority; onMirror keeps project.pico in sync so other (not-
   yet-migrated) tabs that read pico stay consistent during the transition. */
function PICODispatcher({project,updNested,upd,lockCtx,activeId}){
  const[flag,setFlag]=useState(null); // null=checking
  useEffect(()=>{let dead=false;
    (async()=>{
      // Persist any pending whole-project autosave first so the server-backed
      // module migration seeds from the LATEST protocol fields.
      try{ await flushStorage(); }catch{ /* best-effort */ }
      let v=false; try{ v=await workflowStateFlagEnabled(); }catch{ v=false; }
      if(!dead) setFlag(!!v);
    })();
    return()=>{dead=true;};
  },[]);
  if(flag===null) return <div style={{padding:40,textAlign:"center",color:C.muted,fontSize:13}}>Loading Protocol…</div>;
  if(!flag) return <PICOTab project={project} updNested={updNested} upd={upd} lockCtx={lockCtx}/>;
  return <ProtocolModulePanel projectId={activeId} project={project} lockCtx={lockCtx}
    onMirror={(patch)=>Object.entries(patch).forEach(([k,v])=>updNested("pico",k,v))}/>;
}

/* SearchEngine — dispatcher. When the searchEngine flag is ON, the Search tab IS
   the new separated Search Builder engine (NLM-backed MeSH lookup + live PubMed
   counts, persisted per project via /api/search-builder). When OFF (default), the
   legacy in-blob SearchTab below is preserved unchanged so nothing breaks. */
function SearchDispatcher({project,activeId,updNested,upd}){
  const[flag,setFlag]=useState(null); // null=checking
  useEffect(()=>{let dead=false;
    (async()=>{ let v=false; try{ v=await searchEngineFlagEnabled(); }catch{ v=false; } if(!dead) setFlag(!!v); })();
    return()=>{dead=true;};
  },[]);
  if(flag===null) return <div style={{padding:40,textAlign:"center",color:C.muted,fontSize:13}}>Loading Search…</div>;
  if(!flag) return <SearchTab project={project} updNested={updNested} upd={upd}/>;
  return <SearchBuilderTab projectId={activeId} pico={project.pico} api={searchBuilderApi} loadSearch={sbLoad} saveSearch={sbSave}/>;
}

/* ════════════ TAB: SEARCH ════════════ */
function SearchTab({project,updNested,upd}){
  const{search,pico}=project;
  const ch=(k,v)=>updNested("search",k,v);
  const chDb=(db,v)=>ch("dbs",{...search.dbs,[db]:v});
  const selected=Object.values(search.dbs).filter(Boolean).length;
  const[copied,setCopied]=useState("");
  const[saveNotification,setSaveNotification]=useState("");

  // Reliable copy with clipboard API + execCommand fallback
  const copy=(text,id)=>{
    if(navigator.clipboard&&window.isSecureContext){
      navigator.clipboard.writeText(text).then(()=>{
        setCopied(id);setTimeout(()=>setCopied(""),2000);
      }).catch(()=>{
        const el=document.createElement('textarea');
        el.value=text;el.style.position='fixed';el.style.opacity='0';
        document.body.appendChild(el);el.focus();el.select();
        document.execCommand('copy');document.body.removeChild(el);
        setCopied(id);setTimeout(()=>setCopied(""),2000);
      });
    }
  };

  const showSaveNotification=(msg)=>{
    setSaveNotification(msg);
    setTimeout(()=>setSaveNotification(""),2500);
  };

  // ── AI Search Builder state (persisted in project.mesh) ──────────────
  const persisted=project.mesh||{};
  const selectedDBs=persisted.selectedDBs||["pubmed","embase","cochrane","wos","scopus"];
  const extra=persisted.extra||"";
  const aiResults=persisted.results||null;
  const sourceKey=persisted.sourceKey||"";
  const[loading,setLoading]=useState(false);
  const[progress,setProgress]=useState({done:0,total:0});
  const[aiError,setAiError]=useState("");
  const[activeDB,setActiveDB]=useState(persisted.activeDB||"pubmed");
  const[testResult,setTestResult]=useState("");
  const[showRaw,setShowRaw]=useState(false);
  // Local edits to generated broad_query text per DB (keyed by db.id)
  const[localEdits,setLocalEdits]=useState({});

  const hasPICO=pico.P||pico.I||pico.C||pico.O;
  const currentSourceKey=[pico.P,pico.I,pico.C,pico.O,pico.studyDesign,pico.keywords,extra,selectedDBs.join(",")].join("|");
  const picoChangedSinceGen=sourceKey&&sourceKey!==currentSourceKey&&aiResults;

  const saveMesh=(patch)=>upd("mesh",{...persisted,...patch});
  const setSelectedDBs=(newDBs)=>saveMesh({selectedDBs:newDBs});
  const setExtra=(v)=>saveMesh({extra:v});
  const setActiveDBPersist=(v)=>{setActiveDB(v);saveMesh({activeDB:v});};
  const toggleDB=id=>setSelectedDBs(selectedDBs.includes(id)?selectedDBs.filter(x=>x!==id):[...selectedDBs,id]);

  const rawResponse=persisted.rawResponse||"";

  const generate=async()=>{
    if(!hasPICO){setAiError("Fill in at least one PICO field first.");return;}
    setLoading(true);setAiError("");saveMesh({results:null,rawResponse:""});setLocalEdits({});
    setProgress({done:0,total:selectedDBs.length});
    const picoText=[pico.P&&`Population: ${pico.P}`,pico.I&&`Intervention: ${pico.I}`,pico.C&&`Comparator: ${pico.C}`,
      pico.O&&`Outcome: ${pico.O}`,pico.studyDesign&&`Study design: ${pico.studyDesign}`,
      pico.keywords&&`Known key terms: ${pico.keywords}`,extra&&`Additional context: ${extra}`].filter(Boolean).join("\n");

    const buildDBPrompt=(db)=>{
      const key=db.id.toUpperCase();
      const designNote=pico.studyDesign?`The review targets ${pico.studyDesign} studies — build the D block accordingly.`:`No study design specified — keep any design filter minimal to protect sensitivity.`;
      const compNote=pico.C?`A comparator is specified; include a C block only if it genuinely improves precision.`:`No comparator specified — do NOT invent a C block.`;
      return `You are an expert medical librarian and systematic review search strategist. Build a HIGH-SENSITIVITY ${db.label} search. ${designNote} ${compNote}

=== ${db.label.toUpperCase()} SYNTAX ===
Native syntax: ${db.syntax}
Controlled vocabulary: ${db.controlled}
Free-text fields: ${db.freeText}
Database-specific guidance: ${db.guidance}

=== SYSTEMATIC REVIEW PICO ===
${picoText}

Output ONLY the sections below. Each starts with ## on its own line. Plain text — NO JSON, NO code fences.

## ${key}_BROAD
[Complete copy-paste-ready high-sensitivity ${db.label} query]

## ${key}_NARROW
[More specific/precise version.]

## ${key}_CONCEPT_BLOCKS
P | [clause for Population]
I | [clause for Intervention]
C | [clause for Comparator — omit if not applicable]
O | [clause for Outcome — omit if intentionally not searched]
D | [study-design filter clause]

## ${key}_CONTROLLED_TERMS
- exact field-tagged ${db.controlled} term
- ...

## ${key}_FREE_TEXT_TERMS
- field-tagged free-text term
- ...

## ${key}_FILTERS
- FILTER_NAME | clause | when to apply

## ${key}_TERMS_TO_AVOID
- TERM | why it hurts retrieval

## ${key}_VALIDATION
[2-4 seminal papers this search SHOULD retrieve]

## ${key}_TRADEOFF
[2-3 sentences on sensitivity vs precision]

## ${key}_IMPROVEMENTS
[Key design decisions and database-specific notes]

## ${key}_SECONDARY_SEARCHES
- citation chasing and grey-literature sources`;
    };

    const parseDB=(text,id)=>{
      const key=id.toLowerCase();
      const sections=parseSections(text);
      return{
        broad_query:sections[key+"_broad"]||"",
        narrow_query:sections[key+"_narrow"]||"",
        concept_blocks:parseConceptBlocks(sections[key+"_concept_blocks"]),
        controlled_terms:parseBullets(sections[key+"_controlled_terms"]),
        free_text_terms:parseBullets(sections[key+"_free_text_terms"]),
        filters:parseFilters(sections[key+"_filters"]),
        terms_to_avoid:parseTermReasons(sections[key+"_terms_to_avoid"]),
        validation:sections[key+"_validation"]||"",
        tradeoff:sections[key+"_tradeoff"]||"",
        improvements:sections[key+"_improvements"]||"",
        secondary_searches:parseBullets(sections[key+"_secondary_searches"]),
      };
    };

    try{
      const out={};const rawParts=[];let done=0;
      const ids=[...selectedDBs];const failedReasons=[];
      const runOne=async(id)=>{
        const db=MESH_DBS.find(d=>d.id===id);
        try{
          const text=await callClaude(buildDBPrompt(db),2500);
          rawParts.push(`===== ${db.label} =====\n`+text);
          out[id]=parseDB(text,id);
        }catch(e){failedReasons.push(e?.message||String(e));}
        done++;setProgress({done,total:selectedDBs.length});
      };
      for(let qi=0;qi<ids.length;qi++){
        await runOne(ids[qi]);
        if(qi<ids.length-1) await new Promise(res=>setTimeout(res,2000));
      }
      let totalContent=0;
      Object.keys(out).forEach(k=>{if(out[k].broad_query||out[k].narrow_query)totalContent++;});
      if(totalContent===0){
        const reason=failedReasons.length?failedReasons[0]:"no recognisable sections returned";
        throw new Error("No database returned a usable strategy ("+reason+").");
      }
      const failedCount=selectedDBs.length-Object.keys(out).filter(k=>out[k].broad_query||out[k].narrow_query).length;
      if(failedCount>0) setAiError(`${failedCount} of ${selectedDBs.length} databases didn't return a usable strategy. Click Regenerate to retry.`);
      saveMesh({results:out,sourceKey:currentSourceKey,rawResponse:rawParts.join("\n\n"),activeDB:"__combined__",generatedAt:new Date().toISOString()});
      setActiveDB("__combined__");
    }catch(e){
      console.error("[SearchTab AI] Error:",e);
      setAiError(`${e.name||"Error"}: ${e.message||String(e)}`);
    }
    setLoading(false);setProgress({done:0,total:0});
  };

  // Get current text for a DB (local edit overrides generated)
  const getEditText=(id)=>localEdits[id]!==undefined?localEdits[id]:(aiResults&&aiResults[id]?aiResults[id].broad_query||"":"");

  const saveToStrategy=(id)=>{
    const text=getEditText(id);
    if(!text) return;
    const db=MESH_DBS.find(d=>d.id===id);
    const dbLabel=db?db.label:id;
    const existing=search.string||"";
    ch("string",existing?`${existing}\n\n— ${dbLabel} —\n${text}`:`— ${dbLabel} —\n${text}`);
    showSaveNotification("Search strategy saved successfully.");
  };

  return(<div>
    <SectionHeader icon="search" title="Search Builder" desc={AI_FEATURES_ENABLED?"Document your search strategy and generate expert AI search strings for every major database — all in one place.":"Document your search strategy — databases searched, search date, and the full query string — all in one place."}/>

    {/* ── Database selection + date ── */}
    <div style={{display:"grid",gridTemplateColumns:"248px 1fr",gap:16,marginBottom:16}}>
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:14,alignSelf:"start"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <span style={{fontSize:12,fontWeight:700}}>Databases Searched <HelpTip text="Select every database you actually searched. Cochrane reviews require MEDLINE, Embase, and CENTRAL at minimum."/></span>
        </div>
        <div style={{marginBottom:8}}><span style={tagS(selected>=5?"green":selected>=3?"yellow":"red")}>{selected} selected</span></div>
        {Object.keys(search.dbs).map(db=>(
          <label key={db} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7,cursor:"pointer"}}>
            <input type="checkbox" checked={!!search.dbs[db]} onChange={e=>chDb(db,e.target.checked)} style={{accentColor:C.acc,width:14,height:14}}/>
            <span style={{fontSize:12,color:search.dbs[db]?C.txt:C.muted}}>{db}</span>
          </label>
        ))}
        {selected<3&&<InfoBox color={C.yel}>⚠️ Most journals require ≥3 major databases.</InfoBox>}
      </div>
      <div>
        <div style={{marginBottom:14}}>
          <label style={lbl}>Date Last Searched <HelpTip text="PRISMA item 7 requires the date each source was last searched. Update this if you re-run the search before publication."/></label>
          <input type="date" value={search.date||""} onChange={e=>ch("date",e.target.value)} style={inp}/>
        </div>
        <div><label style={lbl}>Grey Literature & Hand-Searching <HelpTip text="Trials registers (ClinicalTrials.gov, WHO ICTRP), conference proceedings, reference lists of included studies, and contacting authors all reduce publication bias."/></label>
          <textarea value={search.notes||""} onChange={e=>ch("notes",e.target.value)}
            placeholder="Trials registers searched · reference lists screened · conference abstracts · authors contacted…"
            style={{...inp,height:60,resize:"vertical"}}/></div>
      </div>
    </div>

    {/* ── Primary Search String ── */}
    <div style={{display:"flex",alignItems:"center",marginBottom:8}}>
      <label style={{...lbl,marginBottom:0}}>Primary Search String (documented strategy)</label>
      <HelpTip text="Paste or build your complete primary-database query here. PRISMA requires the full search strategy for at least one database to be published."/>
    </div>
    {saveNotification&&(
      <div style={{background:"var(--t-grn-bg)",border:`1px solid ${C.grn}`,borderRadius:6,padding:"10px 14px",marginBottom:12,fontSize:13,color:C.grn,display:"flex",alignItems:"center",gap:10}}>
        ✓ {saveNotification}
      </div>
    )}
    <textarea value={search.string||""} onChange={e=>ch("string",e.target.value)}
      placeholder={'Paste your full primary search here, e.g.:\n("type 2 diabetes"[MeSH Terms] OR "T2DM"[TIAB])\nAND ("sodium-glucose transporter 2 inhibitors"[MeSH Terms] OR "SGLT2"[TIAB])\nAND ("randomized controlled trial"[Publication Type])'}
      style={{...inp,height:130,resize:"vertical",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,lineHeight:1.7,marginBottom:20}}/>

    {/* ══ AI SEARCH GENERATOR ══ hidden while AI features are disabled (prompt6 Task 16) */}
    {AI_FEATURES_ENABLED&&(
    <div style={{borderTop:`1px solid ${C.brd}`,paddingTop:20,marginTop:4}}>
      <div style={{fontSize:13,fontWeight:700,color:C.acc,marginBottom:4,letterSpacing:0.3}}>✦ AI Search String Generator</div>
      <div style={{fontSize:12,color:C.muted,marginBottom:16}}>Generate expert high-sensitivity strategies for any combination of databases from your PICO. Results are editable and can be saved directly to your strategy above.</div>

      {/* DB selector */}
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:14,marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:0.8,marginBottom:10}}>SELECT DATABASES FOR AI GENERATION</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {MESH_DBS.map(db=>{const on=selectedDBs.includes(db.id);return(
            <button key={db.id} onClick={()=>toggleDB(db.id)} style={{padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,
              fontFamily:"'IBM Plex Sans',sans-serif",border:`1px solid ${on?db.color:C.brd}`,
              background:on?`${db.color}20`:"transparent",color:on?db.color:C.muted,transition:"all 0.15s"}}>
              {on?"✓ ":""}{db.label}
              {on&&<span style={{fontSize:9,marginLeft:6,background:db.color,color:"#fff",padding:"1px 5px",borderRadius:3}}>EXPERT</span>}
              <span style={{fontSize:10,opacity:0.7,marginLeft:4}}>{db.syntax}</span>
            </button>);})}
        </div>
      </div>

      {/* PICO context */}
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:14,marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:0.8,marginBottom:8}}>PICO CONTEXT</div>
        {!hasPICO?<div style={{fontSize:12,color:C.red}}>⚠ No PICO entered yet — fill in the PICO & Question tab first.</div>:(
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {[["P",C.acc],["I",C.grn],["C",C.yel],["O",C.purp]].map(([k,color])=>pico[k]?(
              <div key={k} style={{display:"flex",gap:10,fontSize:12}}>
                <span style={{fontWeight:800,color,minWidth:16}}>{k}</span>
                <span style={{color:C.muted}}>{pico[k]}</span>
              </div>
            ):null)}
          </div>
        )}
        <div style={{marginTop:10}}><label style={lbl}>Additional context or constraints</label>
          <input value={extra} onChange={e=>setExtra(e.target.value)}
            placeholder="e.g. Exclude paediatric; must include HbA1c; add insulin resistance terms; 2000–present"
            style={{...inp,fontSize:12}}/></div>
      </div>

      {picoChangedSinceGen&&(
        <div style={{background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'55')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
          <span style={{fontSize:13}}>🔄</span>
          <div style={{flex:1}}>
            <div style={{fontSize:12,fontWeight:700,color:C.yel}}>PICO or settings changed since last generation</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>The saved search strategies were built with different inputs. Click sync to regenerate.</div>
          </div>
          <button onClick={generate} disabled={loading} style={{...btnS("ghost"),fontSize:11,color:C.yel,borderColor:themeAlpha(C.yel,'55'),opacity:loading?0.5:1}}>
            {loading?"⟳ Syncing…":"↻ Sync now"}
          </button>
        </div>
      )}

      {/* Generate button row */}
      <div style={{display:"flex",gap:12,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
        <button onClick={generate} disabled={loading||!hasPICO||selectedDBs.length===0}
          style={{...btnS("primary"),padding:"10px 24px",fontSize:13,opacity:(loading||!hasPICO||selectedDBs.length===0)?0.5:1}}>
          {loading?`⟳ Generating ${progress.done}/${progress.total||selectedDBs.length}…`:aiResults?`↻ Regenerate (${selectedDBs.length} DBs)`:`✦ Generate for ${selectedDBs.length} database${selectedDBs.length!==1?"s":""}`}
        </button>
        <button onClick={async()=>{
          setAiError("");setTestResult("Testing…");
          const r=await testClaudeConnection();
          setTestResult(r.ok?`✓ Connection OK · Response: "${r.message.slice(0,40)}"`:`✗ ${r.name}: ${r.message}`);
        }} style={{...btnS("ghost"),fontSize:11}}>🔌 Test API</button>
        {loading&&<span style={{fontSize:11,color:C.muted}}>{progress.total?`Building — ${progress.done} of ${progress.total} databases done…`:"Building search strategy…"}</span>}
        <span style={{fontSize:11,fontFamily:"'IBM Plex Mono',monospace",background:persisted.generatedAt?`${themeAlpha(C.grn,'15')}`:C.card,
          color:persisted.generatedAt?C.grn:C.dim,border:`1px solid ${persisted.generatedAt?themeAlpha(C.grn,'44'):C.brd}`,
          borderRadius:4,padding:"3px 8px",whiteSpace:"nowrap"}}>
          🕐 {persisted.generatedAt?`Last generated: ${fmtDate(persisted.generatedAt)} ${new Date(persisted.generatedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:"Not yet generated"}
        </span>
        {rawResponse&&!loading&&<button onClick={()=>setShowRaw(!showRaw)} style={{...btnS("ghost"),fontSize:11,marginLeft:"auto"}}>{showRaw?"Hide":"Show"} raw response</button>}
      </div>

      {testResult&&(<div style={{marginBottom:14,padding:"10px 14px",borderRadius:6,background:testResult.startsWith("✓")?"var(--t-grn-bg)":(testResult.startsWith("✗")?"var(--t-red-bg)":C.card),border:`1px solid ${testResult.startsWith("✓")?C.grn:(testResult.startsWith("✗")?C.red:C.brd)}`,fontSize:12,fontFamily:"'IBM Plex Mono',monospace",color:testResult.startsWith("✓")?C.grn:(testResult.startsWith("✗")?C.red:C.muted),wordBreak:"break-word"}}>{testResult}</div>)}
      {aiError&&(<div style={{background:"var(--t-red-bg)",border:`1px solid ${C.red}`,borderLeft:`4px solid ${C.red}`,borderRadius:6,padding:"12px 16px",marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:700,color:C.red,marginBottom:4}}>⚠ Generation Error</div>
        <div style={{fontSize:12,color:C.txt}}>{aiError}</div>
      </div>)}
      {showRaw&&rawResponse&&(<div style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:12,marginBottom:14,maxHeight:300,overflowY:"auto"}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,marginBottom:6,letterSpacing:0.8}}>RAW API RESPONSE</div>
        <pre style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,lineHeight:1.6,color:C.muted,whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0}}>{rawResponse}</pre>
      </div>)}

      {/* Results — per-database editable cards */}
      {aiResults?(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{fontSize:12,color:C.muted}}>
            {Object.keys(aiResults).filter(id=>aiResults[id].broad_query).length} database{Object.keys(aiResults).filter(id=>aiResults[id].broad_query).length!==1?"s":""} generated. Edit any query below, then copy or save to strategy.
          </div>
          {selectedDBs.filter(id=>aiResults[id]).map(id=>{
            const db=MESH_DBS.find(d=>d.id===id);
            const r=aiResults[id];
            const editText=getEditText(id);
            const copyId="ai_broad_"+id;
            return(
              <div key={id} style={{background:C.card,border:`1px solid ${C.brd}`,borderLeft:`4px solid ${db.color}`,borderRadius:8,padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:10,flexWrap:"wrap"}}>
                  <div>
                    <span style={{fontSize:13,fontWeight:700,color:db.color}}>{db.label}</span>
                    <span style={{fontSize:10,color:C.dim,marginLeft:10,fontFamily:"'IBM Plex Mono',monospace"}}>{db.syntax}</span>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>copy(editText,copyId)} disabled={!editText} style={{...btnS("ghost"),fontSize:11,opacity:editText?1:0.4}}>
                      {copied===copyId?"✓ Copied":"📋 Copy"}
                    </button>
                    <button onClick={()=>saveToStrategy(id)} disabled={!editText} style={{...btnS(),fontSize:11,opacity:editText?1:0.4}}>
                      → Save to strategy
                    </button>
                  </div>
                </div>
                <textarea
                  value={editText}
                  onChange={e=>setLocalEdits(prev=>({...prev,[id]:e.target.value}))}
                  style={{...inp,height:140,resize:"vertical",fontFamily:"'IBM Plex Mono',monospace",fontSize:11,lineHeight:1.7,marginBottom:10}}
                />
                <details style={{marginTop:4}}>
                  <summary style={{fontSize:11,color:C.muted,cursor:"pointer",userSelect:"none",listStyle:"none",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:10}}>▶</span> More details (narrow query, concept blocks, filters, vocabulary, validation…)
                  </summary>
                  <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:10}}>
                    {r.narrow_query&&(
                      <div style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:12}}>
                        <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6,letterSpacing:0.6}}>NARROW / PRECISE QUERY</div>
                        <pre style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,lineHeight:1.7,color:C.txt,whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0}}>{r.narrow_query}</pre>
                      </div>
                    )}
                    {(r.concept_blocks||[]).length>0&&(
                      <div style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:12}}>
                        <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:8,letterSpacing:0.6}}>CONCEPT BLOCKS</div>
                        {(r.concept_blocks||[]).map((cb,i)=>(
                          <div key={i} style={{display:"flex",gap:10,marginBottom:6,fontSize:11}}>
                            <span style={{fontWeight:800,color:cb.color,minWidth:18,fontFamily:"'IBM Plex Mono',monospace"}}>{cb.code}</span>
                            <span style={{color:C.muted,minWidth:90}}>{cb.label}</span>
                            <span style={{fontFamily:"'IBM Plex Mono',monospace",color:C.txt,wordBreak:"break-word"}}>{cb.clause}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {((r.controlled_terms||[]).length>0||(r.free_text_terms||[]).length>0)&&(
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        <div style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:12}}>
                          <div style={{fontSize:11,fontWeight:700,color:db.color,marginBottom:6,letterSpacing:0.5}}>{db.controlled.toUpperCase()}</div>
                          {(r.controlled_terms||[]).map((t,i)=><div key={i} style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:C.txt,lineHeight:1.6}}>▸ {t}</div>)}
                        </div>
                        <div style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:12}}>
                          <div style={{fontSize:11,fontWeight:700,color:C.grn,marginBottom:6,letterSpacing:0.5}}>FREE TEXT</div>
                          {(r.free_text_terms||[]).map((t,i)=><div key={i} style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:C.txt,lineHeight:1.6}}>▸ {t}</div>)}
                        </div>
                      </div>
                    )}
                    {(r.filters||[]).length>0&&(
                      <div style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:12}}>
                        <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:8,letterSpacing:0.6}}>RECOMMENDED FILTERS</div>
                        {(r.filters||[]).map((f,i)=>(
                          <div key={i} style={{marginBottom:8}}>
                            <span style={{fontSize:11,fontWeight:700,color:db.color}}>{f.name}: </span>
                            <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,color:C.txt}}>{f.clause}</span>
                            {f.when&&<div style={{fontSize:10,color:C.muted,fontStyle:"italic",marginTop:2}}>When: {f.when}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                    {r.validation&&(
                      <div style={{background:C.bg,border:`1px solid ${themeAlpha(C.grn,'33')}`,borderLeft:`3px solid ${C.grn}`,borderRadius:6,padding:12}}>
                        <div style={{fontSize:11,fontWeight:700,color:C.grn,marginBottom:6}}>✅ SANITY CHECK PAPERS</div>
                        <div style={{fontSize:12,color:C.txt,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{r.validation}</div>
                      </div>
                    )}
                    {r.tradeoff&&(
                      <div style={{background:C.bg,border:`1px solid ${themeAlpha(C.yel,'33')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:12}}>
                        <div style={{fontSize:11,fontWeight:700,color:C.yel,marginBottom:6}}>⚖️ TRADEOFF</div>
                        <div style={{fontSize:12,color:C.txt,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{r.tradeoff}</div>
                      </div>
                    )}
                    {r.improvements&&(
                      <div style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:12}}>
                        <div style={{fontSize:11,fontWeight:700,color:db.color,marginBottom:6}}>💡 DESIGN NOTES</div>
                        <div style={{fontSize:12,color:C.txt,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{r.improvements}</div>
                      </div>
                    )}
                    {(r.secondary_searches||[]).length>0&&(
                      <div style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:12}}>
                        <div style={{fontSize:11,fontWeight:700,color:C.purp,marginBottom:6}}>🔗 SECONDARY SEARCHES</div>
                        {(r.secondary_searches||[]).map((s,i)=><div key={i} style={{fontSize:11,color:C.txt,lineHeight:1.6,marginBottom:3}}>• {s}</div>)}
                      </div>
                    )}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      ):(
        !loading&&<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:32,textAlign:"center",color:C.muted}}>
          <div style={{fontSize:32,marginBottom:10}}>✦</div>
          <div style={{fontSize:13,marginBottom:6}}>Ready to generate</div>
          <div style={{fontSize:12}}>Fill in your PICO, select databases above, and click Generate</div>
        </div>
      )}
    </div>
    )}
  </div>);
}

/* ════════════ TAB: PRISMA ════════════ */
/* ════════════ PRISMA 2020 FLOW DIAGRAM (exportable figure) ════════════ */
/* buildPrismaSVG extracted VERBATIM to
   src/frontend/workspace/charts/svgBuilders.js (prompt46 Phase 4) and imported
   at the top of this file. */
/* PRISMA figure downloads now route through the shared ExportDialog
   (PrismaFigureExport below) — the old fixed-scale helpers are gone. */

/* ════════════ SCREENING MODULE (import + dual-reviewer triage) ════════════ */
function ScreeningModule({project,updateProject,activeId,updNested}){
  const records=project.records||[];
  const fileRef=useRef(null);
  const[importMsg,setImportMsg]=useState("");
  const[filter,setFilter]=useState("all");
  const[q,setQ]=useState("");
  const[reviewer,setReviewer]=useState(1);
  const[showImport,setShowImport]=useState(records.length===0);

  const setRecords=(next)=>updateProject(activeId,p=>({...p,records:typeof next==="function"?next(p.records||[]):next}));

  const onFile=async(e)=>{
    const files=Array.from(e.target.files||[]);
    if(!files.length) return;
    let allNew=[],fmts=[];
    for(const f of files){
      const text=await f.text();
      const {records:parsed,format}=parseReferences(text,f.name);
      if(parsed.length){ allNew=allNew.concat(parsed); fmts.push(`${f.name}: ${parsed.length} (${format})`); }
      else fmts.push(`${f.name}: 0 — unrecognised format`);
    }
    if(allNew.length){
      const {merged,dupCount,added}=dedupeRecords(records,allNew);
      setRecords(merged);
      setImportMsg(`Imported ${added} record${added!==1?"s":""} · ${dupCount} flagged as duplicate${dupCount!==1?"s":""}. ${fmts.join(" · ")}`);
      setShowImport(false);
    } else {
      setImportMsg(`No records parsed. ${fmts.join(" · ")}`);
    }
    if(fileRef.current) fileRef.current.value="";
  };

  const setDecision=(id,field,val)=>setRecords(rs=>rs.map(r=>r.id===id?{...r,[field]:r[field]===val?"":val}:r));
  const delRecord=(id)=>setRecords(rs=>rs.filter(r=>r.id!==id&&r.dupOf!==id));
  const clearAll=()=>{ setRecords([]); setImportMsg(""); setShowImport(true); };

  const consensus=(r)=>{
    const a=r.decision, b=r.reviewer2;
    if(r.dupOf) return "dup";
    if(!a&&!b) return "pending";
    if(a&&b){ if(a===b) return a; return "conflict"; }
    return a||b||"pending";
  };
  const counts=useMemo(()=>{
    const c={total:records.length,pending:0,include:0,exclude:0,maybe:0,conflict:0,dup:0};
    records.forEach(r=>{ const d=consensus(r); if(c[d]!==undefined)c[d]++; });
    return c;
  },[records]);

  const visible=records.filter(r=>{
    const d=consensus(r);
    if(filter!=="all"&&d!==filter) return false;
    if(q){ const hay=(r.title+" "+r.authors+" "+r.journal+" "+r.year+" "+r.abstract).toLowerCase(); if(!hay.includes(q.toLowerCase())) return false; }
    return true;
  });

  const syncToPrisma=()=>{
    const dups=records.filter(r=>r.dupOf).length;
    const afterDup=records.filter(r=>!r.dupOf);
    const excluded=afterDup.filter(r=>consensus(r)==="exclude").length;
    const included=afterDup.filter(r=>consensus(r)==="include").length;
    updateProject(activeId,p=>({...p,prisma:{...p.prisma,
      dbs:String(records.length),
      dedupe:String(dups),
      excTA:String(excluded),
      included:String(included),
    }}));
    setImportMsg(`PRISMA numbers updated: ${records.length} identified, ${dups} duplicates, ${excluded} excluded at screening, ${included} included.`);
  };

  const decBtn=(r,field,val,label,color)=>{
    const on=r[field]===val;
    return <button onClick={()=>setDecision(r.id,field,val)} style={{
      padding:"3px 9px",borderRadius:4,cursor:"pointer",fontSize:10,fontWeight:700,
      border:`1px solid ${on?color:C.brd}`,background:on?`${themeAlpha(color,'25')}`:"transparent",color:on?color:C.muted
    }}>{label}</button>;
  };
  const conColor={include:C.grn,exclude:C.red,maybe:C.yel,conflict:C.purp,pending:C.dim,dup:C.dim};

  return(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:20}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:12}}>
      <div style={{fontSize:12,fontWeight:800,color:C.acc,letterSpacing:0.5}}>📥 TITLE / ABSTRACT SCREENING</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button onClick={()=>setShowImport(s=>!s)} style={{...btnS("ghost"),fontSize:11}}>{showImport?"▲ Hide import":"＋ Import references"}</button>
        {records.length>0&&<button onClick={syncToPrisma} style={{...btnS("primary"),fontSize:11}}>↻ Update PRISMA counts</button>}
        {records.length>0&&<button onClick={clearAll} style={{...btnS("danger"),fontSize:11}}>Clear all</button>}
      </div>
    </div>

    {showImport&&(
      <div style={{background:C.bg,border:`1px dashed ${C.brd}`,borderRadius:8,padding:16,marginBottom:14,textAlign:"center"}}>
        <input ref={fileRef} type="file" multiple accept=".ris,.nbib,.bib,.txt,.xml" onChange={onFile} style={{display:"none"}}/>
        <div style={{fontSize:13,color:C.txt,marginBottom:6}}>Import your search results to screen them here</div>
        <div style={{fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.6}}>
          Export from each database as <strong style={{color:C.txt}}>RIS</strong>, <strong style={{color:C.txt}}>PubMed .nbib</strong>, <strong style={{color:C.txt}}>BibTeX</strong>, or <strong style={{color:C.txt}}>EndNote XML</strong>.<br/>Duplicates across files are detected automatically by DOI, PMID, then title+year.
        </div>
        <button onClick={()=>fileRef.current&&fileRef.current.click()} style={btnS("primary")}>Choose file(s)…</button>
      </div>
    )}
    {importMsg&&<div style={{fontSize:11,color:C.grn,marginBottom:12,lineHeight:1.5}}>{importMsg}</div>}

    {records.length===0?(
      <div style={{fontSize:12,color:C.muted,padding:"8px 0"}}>No references imported yet. You can still enter PRISMA numbers manually below.</div>
    ):(<>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
        {[["all","All",C.txt],["pending","Pending",C.dim],["include","Include",C.grn],["maybe","Maybe",C.yel],["exclude","Exclude",C.red],["conflict","Conflicts",C.purp],["dup","Duplicates",C.dim]].map(([f,label,color])=>(
          <button key={f} onClick={()=>setFilter(f)} style={{
            padding:"4px 10px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,
            border:`1px solid ${filter===f?color:C.brd}`,background:filter===f?`${themeAlpha(color,'22')}`:"transparent",color:filter===f?color:C.muted
          }}>{label} {f==="all"?counts.total:counts[f]||0}</button>
        ))}
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search titles/abstracts…" style={{...inp,width:200,fontSize:11,marginLeft:"auto"}}/>
      </div>
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10,fontSize:11,color:C.muted}}>
        <span>Acting as:</span>
        {[1,2].map(n=><button key={n} onClick={()=>setReviewer(n)} style={{...btnS(reviewer===n?"primary":"ghost"),fontSize:10,padding:"3px 10px"}}>Reviewer {n}</button>)}
        <HelpTip text="Screen as Reviewer 1, then switch to Reviewer 2 to screen independently. Disagreements appear as Conflicts to resolve — the dual-reviewer standard for systematic reviews."/>
      </div>

      <div style={{maxHeight:520,overflowY:"auto",display:"flex",flexDirection:"column",gap:8}}>
        {visible.length===0?<div style={{fontSize:12,color:C.dim,padding:16,textAlign:"center"}}>No records in this view.</div>:
        visible.map(r=>{
          const dec=consensus(r);
          const dupTitle=r.dupOf?(records.find(x=>x.id===r.dupOf)||{}).title:"";
          return(
          <div key={r.id} style={{border:`1px solid ${r.dupOf?C.dim:themeAlpha(conColor[dec],"55")}`,borderLeft:`3px solid ${conColor[dec]}`,borderRadius:6,padding:"10px 12px",background:C.bg,opacity:r.dupOf?0.6:1}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:C.txt,lineHeight:1.4}}>{r.title||"(untitled record)"}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{r.authors||"—"}{r.year?` · ${r.year}`:""}{r.journal?` · ${r.journal}`:""}</div>
                {r.doi&&<div style={{fontSize:10,color:C.dim,marginTop:1,fontFamily:"'IBM Plex Mono',monospace"}}>doi:{r.doi}{r.pmid?` · PMID:${r.pmid}`:""}</div>}
                {r.abstract&&<details style={{marginTop:5}}><summary style={{fontSize:10,color:C.acc,cursor:"pointer"}}>Abstract</summary><div style={{fontSize:11,color:C.muted,marginTop:4,lineHeight:1.55}}>{r.abstract}</div></details>}
                {r.dupOf&&<div style={{fontSize:10,color:C.red,marginTop:4}}>⚠ Duplicate of: {dupTitle?dupTitle.slice(0,60):"another record"}</div>}
              </div>
              <div style={{flexShrink:0,textAlign:"right"}}>
                {!r.dupOf&&<>
                  <div style={{display:"flex",gap:4,marginBottom:5,justifyContent:"flex-end"}}>
                    {decBtn(r,reviewer===1?"decision":"reviewer2","include","✓ Incl",C.grn)}
                    {decBtn(r,reviewer===1?"decision":"reviewer2","maybe","? Maybe",C.yel)}
                    {decBtn(r,reviewer===1?"decision":"reviewer2","exclude","✗ Excl",C.red)}
                  </div>
                  <div style={{fontSize:9,color:C.dim}}>
                    R1: <span style={{color:conColor[r.decision]||C.dim}}>{r.decision||"—"}</span> · R2: <span style={{color:conColor[r.reviewer2]||C.dim}}>{r.reviewer2||"—"}</span>
                  </div>
                  {dec==="conflict"&&<div style={{fontSize:10,color:C.purp,fontWeight:700,marginTop:3}}>⚑ Conflict</div>}
                </>}
                <button onClick={()=>delRecord(r.id)} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:14,marginTop:4}}>×</button>
              </div>
            </div>
            {dec==="conflict"&&!r.dupOf&&(
              <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.brd}`,display:"flex",gap:6,alignItems:"center"}}>
                <span style={{fontSize:10,color:C.purp,fontWeight:700}}>Resolve to:</span>
                <button onClick={()=>setRecords(rs=>rs.map(x=>x.id===r.id?{...x,decision:"include",reviewer2:"include"}:x))} style={{...btnS("ghost"),fontSize:10,padding:"2px 8px",color:C.grn,borderColor:themeAlpha(C.grn,'55')}}>Include</button>
                <button onClick={()=>setRecords(rs=>rs.map(x=>x.id===r.id?{...x,decision:"exclude",reviewer2:"exclude"}:x))} style={{...btnS("ghost"),fontSize:10,padding:"2px 8px",color:C.red,borderColor:themeAlpha(C.red,'55')}}>Exclude</button>
              </div>
            )}
          </div>);
        })}
      </div>
      <div style={{marginTop:12,fontSize:11,color:C.muted,lineHeight:1.6,background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:"8px 12px"}}>
        <strong style={{color:C.txt}}>{counts.include}</strong> include · <strong style={{color:C.txt}}>{counts.maybe}</strong> maybe · <strong style={{color:C.txt}}>{counts.exclude}</strong> exclude · <strong style={{color:C.purp}}>{counts.conflict}</strong> conflicts · <strong style={{color:C.dim}}>{counts.dup}</strong> duplicates · <strong style={{color:C.dim}}>{counts.pending}</strong> pending. Click <em>Update PRISMA counts</em> to push these into the flow diagram.
      </div>
    </>)}
  </div>);
}

/* META·SIFT link — auto-fills the PRISMA flow from the linked screening project (Part 12).
   The manual ScreeningModule above is preserved in source but no longer rendered:
   title/abstract screening is now owned by META·SIFT. project.records is never deleted. */
function MetaSiftPrismaSync({project,updateProject,activeId,setTab}){
  const[st,setSt]=useState({loading:true});
  const[creating,setCreating]=useState(false);
  const apply=(summary)=>{
    const p=summary.prisma;
    const accepted=Array.isArray(summary.acceptedStudies)?summary.acceptedStudies:[];
    updateProject(activeId,proj=>{
      const cur=proj.prisma||{};
      const next={...cur,
        dbs:String(p.identified), reg:"0", other:"0",
        dedupe:String(p.duplicatesRemoved),
        excTA:String(p.excludedTitleAbstract),
        excFull:String(p.fullTextExcluded),
        included:String(p.included),
      };
      const samePrisma=["dbs","reg","other","dedupe","excTA","excFull","included"].every(k=>String(cur[k]||"")===String(next[k]||""));
      // Pull-merge accepted second-review studies into Data Extraction (BUG 5).
      // Idempotent: match by screeningRecordId / DOI / PMID / normalized title so
      // re-syncing never creates duplicates, and a stale-state autosave can't drop them.
      const existing=Array.isArray(proj.studies)?proj.studies:[];
      const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
      const dup=(st)=>existing.some(e=>
        (st.screeningRecordId&&e.screeningRecordId===st.screeningRecordId)||
        (st.doi&&e.doi&&String(e.doi).toLowerCase().trim()===String(st.doi).toLowerCase().trim())||
        (st.pmid&&e.pmid&&String(e.pmid).trim()===String(st.pmid).trim())||
        (norm(st.title)&&norm(e.title)===norm(st.title))
      );
      const toAdd=accepted.filter(st=>!dup(st));
      if(samePrisma&&toAdd.length===0) return proj;
      return {...proj,
        prisma:samePrisma?cur:next,
        studies:toAdd.length?[...existing,...toAdd]:existing,
      };
    });
  };
  const load=useCallback(async(doApply)=>{
    setSt(s=>({...s,loading:true,error:null}));
    try{
      const r=await fetch(`/api/screening/metalab/${project.id}/summary`,{credentials:"include"});
      if(!r.ok){ setSt({loading:false,error:r.status===503?"Screening is currently disabled by the administrator.":"Couldn't reach the screening service."}); return; }
      const data=await r.json();
      setSt({loading:false,...data});
      if(doApply&&data.linked) apply(data);
    }catch(e){ setSt({loading:false,error:"Couldn't reach the screening service."}); }
  },[project.id]);
  useEffect(()=>{ load(true); },[load]);

  const wrap={background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:20};
  if(st.loading) return <div style={wrap}><div style={{fontSize:12,color:C.muted}}>Checking screening…</div></div>;
  if(st.error) return <div style={{...wrap,borderColor:themeAlpha(C.yel,'55')}}>
    <div style={{fontSize:12,fontWeight:800,color:C.yel,letterSpacing:0.5,marginBottom:6}}>⬡ Screening</div>
    <div style={{fontSize:12,color:C.muted,marginBottom:10}}>{st.error} You can still enter PRISMA numbers manually below.</div>
    <button onClick={()=>load(true)} style={{...btnS("ghost"),fontSize:11}}>↻ Retry</button>
  </div>;
  const createLinked=async()=>{
    setCreating(true);
    try{
      const r=await fetch("/api/screening/projects",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({title:project.name||"Screening project",linkedMetaLabProjectId:project.id})});
      if(r.ok){ const sp=await r.json(); window.location.href=`/sift-beta/projects/${sp.id}`; }
      else { setCreating(false); load(true); }
    }catch{ setCreating(false); }
  };
  if(!st.linked) return <div style={{...wrap,borderColor:themeAlpha(C.acc,'40'),background:C.bg}}>
    <div style={{fontSize:12,fontWeight:800,color:C.acc,letterSpacing:0.5,marginBottom:6}}>⬡ PRISMA fills in from Screening</div>
    <div style={{fontSize:12,color:C.muted,lineHeight:1.6,marginBottom:12}}>
      Screen your references in the <strong style={{color:C.txt}}>Screening</strong> stage — import, de-duplicate, screen titles &amp; abstracts with your team, resolve conflicts, and assess full text. As you go, these PRISMA counts fill in automatically and accepted studies flow into Data Extraction.
    </div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      {setTab&&<button onClick={()=>setTab("screening")} style={btnS("primary")}>Go to Screening →</button>}
      <button onClick={()=>load(true)} style={btnS("ghost")}>↻ Sync now</button>
    </div>
  </div>;
  const p=st.prisma;
  return <div style={{...wrap,borderColor:themeAlpha(C.grn,'55')}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:8}}>
      <div style={{fontSize:12,fontWeight:800,color:C.grn,letterSpacing:0.5,minWidth:0,flex:"1 1 auto"}}>⬡ PRISMA — auto-filled from Screening</div>
      <div style={{display:"flex",gap:8,minWidth:0}}>
        <button onClick={()=>load(true)} style={{...btnS("ghost"),fontSize:11}}>↻ Sync now</button>
        {setTab&&<button onClick={()=>setTab("screening")} style={{...btnS("primary"),fontSize:11}}>Open Screening →</button>}
      </div>
    </div>
    <div style={{fontSize:11,color:C.muted,lineHeight:1.7}}>
      <strong style={{color:C.txt}}>{p.identified}</strong> identified · <strong style={{color:C.txt}}>{p.duplicatesRemoved}</strong> duplicates removed · <strong style={{color:C.txt}}>{p.screened}</strong> screened · <strong style={{color:C.red}}>{p.excludedTitleAbstract}</strong> excluded (title/abstract) · <strong style={{color:C.txt}}>{p.fullTextAssessed}</strong> full-text assessed · <strong style={{color:C.red}}>{p.fullTextExcluded}</strong> full-text excluded · <strong style={{color:C.grn}}>{p.included}</strong> included → Data Extraction.
    </div>
    <div style={{fontSize:10,color:C.dim,marginTop:8}}>These numbers update automatically from the Screening stage. You can still fine-tune the fields below; “Sync now” re-pulls the latest.</div>
  </div>;
}

function PRISMATab({project,updNested,updateProject,activeId,setTab}){
  const{prisma}=project;
  const ch=(k,v)=>updNested("prisma",k,v);
  const addR=()=>ch("reasons",[...prisma.reasons,{id:uid(),r:"",n:""}]);
  const updR=(id,k,v)=>ch("reasons",prisma.reasons.map(r=>r.id===id?{...r,[k]:v}:r));
  const delR=id=>ch("reasons",prisma.reasons.filter(r=>r.id!==id));
  const dbs=+prisma.dbs||0,reg=+prisma.reg||0,other=+prisma.other||0,total=dbs+reg+other;
  const dedupe=+prisma.dedupe||0,screened=total-dedupe,excTA=+prisma.excTA||0,ftRet=screened-excTA,excFull=+prisma.excFull||0,included=ftRet-excFull;
  const FlowBox=({label,n,color=C.acc,small=false})=>(
    <div style={{background:C.card,border:`2px solid ${themeAlpha(color,'55')}`,borderRadius:8,padding:small?"8px 14px":"12px 18px",textAlign:"center",minWidth:140}}>
      <div style={{fontSize:small?18:26,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color}}>{n||"?"}</div>
      <div style={{fontSize:11,color:C.muted,marginTop:2}}>{label}</div>
    </div>);
  const Arrow=()=><div style={{textAlign:"center",color:C.dim,fontSize:16,margin:"4px 0"}}>↓</div>;
  return(<div>
    <SectionHeader icon="flow" title="PRISMA Flow" desc="Title/abstract screening happens in the Screening stage (two independent reviewers, with duplicates & conflicts). As you screen, the PRISMA 2020 flow diagram below fills in automatically."/>
    {updateProject&&<MetaSiftPrismaSync project={project} updateProject={updateProject} activeId={activeId} setTab={setTab}/>}
    <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:20}}>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {[{title:"IDENTIFICATION",fields:[["dbs","Records from databases"],["reg","Records from registers"],["other","Records from other sources"],["dedupe","Duplicates removed"]]},
          {title:"SCREENING",fields:[["excTA","Excluded after title/abstract"],["excFull","Excluded after full text"]]},
          {title:"INCLUDED",fields:[["included","Studies included (override)"],["qual","In qualitative synthesis"],["quant","In meta-analysis"]]}
        ].map(({title,fields})=>(
          <div key={title} style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:14}}>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1,marginBottom:10}}>{title}</div>
            {fields.map(([k,label])=>(
              <div key={k} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <label style={{fontSize:12,flex:1,color:C.muted}}>{label}</label>
                <input type="number" min="0" value={prisma[k]||""} onChange={e=>ch(k,e.target.value)}
                  style={{...inp,width:80,textAlign:"right",fontFamily:"'IBM Plex Mono',monospace"}}/>
              </div>
            ))}
            {title==="SCREENING"&&(<div style={{marginTop:8}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,marginBottom:6}}>
                <span>Exclusion reasons (full text)</span>
                <button onClick={addR} style={{...btnS("ghost"),padding:"1px 8px",fontSize:10}}>+ Add</button>
              </div>
              {prisma.reasons.map(r=>(
                <div key={r.id} style={{display:"flex",gap:6,marginBottom:5}}>
                  <input value={r.r} onChange={e=>updR(r.id,"r",e.target.value)} placeholder="Reason" style={{...inp,flex:3,fontSize:11}}/>
                  <input type="number" value={r.n} onChange={e=>updR(r.id,"n",e.target.value)} placeholder="n" style={{...inp,width:55,fontSize:11,textAlign:"right",fontFamily:"'IBM Plex Mono',monospace"}}/>
                  <button onClick={()=>delR(r.id)} style={{...btnS("ghost"),padding:"2px 8px",fontSize:13,color:C.dim}}>×</button>
                </div>
              ))}
            </div>)}
          </div>
        ))}
      </div>
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:20,display:"flex",flexDirection:"column",alignItems:"center"}}>
        <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:1,marginBottom:16}}>LIVE FLOW DIAGRAM</div>
        <FlowBox label={`Identified (DB:${dbs} Reg:${reg} Other:${other})`} n={total||0}/>
        <Arrow/><FlowBox label="After duplicates removed" n={screened}/>
        <Arrow/>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <FlowBox label="Screened" n={screened} small/>
          <span style={{color:C.dim}}>→</span>
          <FlowBox label={`Excluded (n=${excTA})`} n={excTA} color={C.red} small/>
        </div>
        <Arrow/>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <FlowBox label="Full texts assessed" n={ftRet} small/>
          <span style={{color:C.dim}}>→</span>
          <div style={{background:C.card,border:`2px solid ${themeAlpha(C.red,'55')}`,borderRadius:8,padding:"8px 14px",minWidth:140}}>
            <div style={{fontSize:18,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.red,textAlign:"center"}}>{excFull||"?"}</div>
            <div style={{fontSize:11,color:C.muted,textAlign:"center",marginTop:2}}>Excluded</div>
            {prisma.reasons.filter(r=>r.r&&r.n).map(r=><div key={r.id} style={{fontSize:10,color:C.dim,marginTop:2,textAlign:"center"}}>{r.r}: {r.n}</div>)}
          </div>
        </div>
        <Arrow/><FlowBox label="Studies included" n={included} color={C.grn}/>
        {(prisma.qual||prisma.quant)&&(<><Arrow/><div style={{display:"flex",gap:10}}>
          {prisma.qual&&<FlowBox label="Qualitative synthesis" n={prisma.qual} small color={C.purp}/>}
          {prisma.quant&&<FlowBox label="Meta-analysis" n={prisma.quant} small color={C.grn}/>}
        </div></>)}
      </div>
    </div>

    {/* PUBLICATION-STYLE PRISMA FIGURE EXPORT */}
    <PrismaFigureExport project={project} prisma={prisma}/>
  </div>);
}

/* White-background PRISMA figure with preview + PNG/SVG export (via ExportDialog) */
function PrismaFigureExport({project,prisma}){
  const[show,setShow]=useState(false);
  const opts={title:project.name||""};
  const safe=(project.name||"prisma").replace(/[^a-z0-9]/gi,"_");
  const openExport=()=>openExportDialog({
    id:"prisma-figure",
    title:`PRISMA flow diagram — ${project.name||"project"}`,
    formats:[{id:"png",label:"PNG (raster)"},{id:"svg",label:"SVG (vector)"}],
    sizing:true,
    defaults:{format:"png",presetId:"journal-1col"},
    run:async(choice)=>{
      if(choice.format==="svg"){
        const built=buildPrismaSVG(prisma,opts);
        downloadText(SVG_XML_HEADER+built.svg,`${safe}_prisma.svg`,"image/svg+xml;charset=utf-8");
        return;
      }
      const built=buildPrismaSVG(prisma,{...opts,noBg:!!choice.transparent});
      const blob=await rasterizeSvg(built.svg,built.W,built.H,
        {targetWidthPx:choice.widthPx,transparent:choice.transparent,background:"#ffffff"});
      downloadBlob(blob,`${safe}_prisma${presetTag(choice)}.png`);
    },
  });
  return(<div style={{marginTop:18,background:C.card,border:`1px solid ${themeAlpha(C.grn,'55')}`,borderRadius:8,padding:14}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:4}}>
      <div style={{fontSize:12,fontWeight:800,color:C.grn,letterSpacing:0.5}}>📄 PRISMA 2020 FLOW DIAGRAM (publication figure)</div>
      <span style={{fontSize:11,color:C.muted}}>white background · journal style</span>
    </div>
    <div style={{fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.5}}>
      A clean black-on-white box-and-arrow PRISMA 2020 diagram built from the numbers above — identification, de-duplication, screening, exclusions (with reasons), and inclusion. Drop it straight into your manuscript.
    </div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
      <button onClick={openExport} style={btnS("success")}>⬇ Export figure…</button>
      <button onClick={()=>setShow(s=>!s)} style={{...btnS("ghost"),fontSize:12}}>{show?"▲ Hide preview":"👁 Preview"}</button>
    </div>
    {show&&(()=>{const built=buildPrismaSVG(prisma,opts);return(
      <div style={{marginTop:12,background:"#fff",borderRadius:6,padding:10,overflowX:"auto",border:`1px solid ${C.brd}`}}>
        <div style={{minWidth:built.W,maxWidth:"100%"}} dangerouslySetInnerHTML={{__html:built.svg}}/>
      </div>);})()}
  </div>);
}

/* ════════════ ES CALCULATOR ════════════ */
function ESCalcInline({s,ch}){
  // Pre-seed the calculator type from the study's saved esType
  const[type,setType]=useState(s.esType||"SMD");
  const[res,setRes]=useState(null);
  const[err,setErr]=useState("");
  const[note,setNote]=useState("");
  // Read raw values straight from the study object so they persist & are auditable
  const sp=(k,v)=>ch(k,v);
  const fi=(k,ph,hint)=>(<div><div style={{fontSize:9,color:C.dim,marginBottom:2}} title={hint||""}>{ph}</div>
    <input value={s[k]||""} onChange={e=>sp(k,e.target.value)} placeholder={ph}
      style={{...inp,fontSize:11,fontFamily:"'IBM Plex Mono',monospace",padding:"4px 6px"}}/></div>);

  const calc=()=>{
    setErr("");setNote("");
    // Map study fields to the names calcES expects
    const p={
      m1:s.meanExp,sd1:s.sdExp,n1:s.nExp,m2:s.meanCtrl,sd2:s.sdCtrl,n2:s.nCtrl,
      a:s.a,b:s.b,c:s.c,d:s.d,
      hr:s.es!==""?s.es:s.hr,lo:s.lo,hi:s.hi,
      r:s.r,n:s.n,
      events:s.events,total:s.total,
      tp:s.tp,fp:s.fp,fn:s.fn,tn:s.tn,
    };
    // For HR the calculator reads hr/lo/hi from dedicated temp fields
    if(type==="HR"){ p.hr=s._hrVal; p.lo=s._hrLo; p.hi=s._hrHi; }
    // Honest, specific validation for the dichotomous 2×2 measures. A zero count
    // is valid clinical data and must never be rejected merely for being zero.
    if(type==="OR"||type==="RR"||type==="RD"){
      const raw=[p.a,p.b,p.c,p.d];
      if(raw.some(v=>v===""||v==null)){ setRes(null); setErr("Enter all four 2×2 cells (a, b, c, d)."); return; }
      const nums=raw.map(Number);
      if(nums.some(v=>isNaN(v)||!isFinite(v))){ setRes(null); setErr("Counts must be numbers."); return; }
      if(nums.some(v=>v<0||!Number.isInteger(v))){ setRes(null); setErr("Counts must be non-negative integers."); return; }
      if((type==="OR"||type==="RR")&&nums[0]===0&&nums[2]===0){
        setRes(null);
        setErr(`Both event cells are zero — a double-zero study is not estimable as ${type} (no information about a relative effect). Use Risk Difference (RD), which can include zero-event studies.`);
        return;
      }
    }
    const r=calcES(type,p);
    setRes(r);
    if(r){
      ch("es",String(+Number(r.es).toFixed(6)));ch("lo",String(+Number(r.lo).toFixed(6)));ch("hi",String(+Number(r.hi).toFixed(6)));
      ch("esType",type);
      ch("source","calculated");
      if(r.continuityCorrectionApplied)
        setNote(`Zero event cell detected — a 0.5 continuity correction (Haldane–Anscombe) was applied for log ${type}.`);
    } else {
      setErr("Check inputs — values may be missing or out of range for this measure.");
    }
  };

  return(<div style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:12,marginTop:10}}>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6,flexWrap:"wrap"}}>
      <span style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:0.8}}>CALCULATE EFFECT SIZE FROM RAW DATA</span>
      <select value={type} onChange={e=>{setType(e.target.value);setRes(null);setErr("");setNote("");}} style={{...inp,width:"auto",fontSize:11}}>
        <option value="SMD">Continuous → SMD (Cohen's d)</option>
        <option value="MD">Continuous → Mean Difference</option>
        <option value="OR">Dichotomous → Odds Ratio</option>
        <option value="RR">Dichotomous → Risk Ratio</option>
        <option value="RD">Dichotomous → Risk Difference</option>
        <option value="HR">Time-to-event → Hazard Ratio</option>
        <option value="COR">Correlation → Fisher's z</option>
        <option value="PROP">Single-arm → Proportion</option>
        <option value="DIAG">Diagnostic → DOR (TP/FP/FN/TN)</option>
      </select>
    </div>
    <div style={{fontSize:10,color:C.dim,marginBottom:8,lineHeight:1.5}}>
      {type==="SMD"&&"Standardized mean difference — pool when studies use different scales for the same construct."}
      {type==="MD"&&"Raw mean difference — only when every study reports the same units."}
      {(type==="OR"||type==="RR"||type==="RD")&&"2×2 counts. a = events in intervention, b = non-events intervention, c = events control, d = non-events control. Zero cells are valid clinical data — OR/RR apply a Haldane–Anscombe 0.5 correction when any cell is 0; RD needs none."}
      {type==="HR"&&"Enter the reported hazard ratio and its 95% CI — they are log-transformed for pooling."}
      {type==="COR"&&"Pearson r and sample size → Fisher's z transform."}
      {type==="PROP"&&"Single group: number of events and group total → logit proportion."}
      {type==="DIAG"&&"Diagnostic 2×2: true/false positives and negatives → log diagnostic odds ratio."}
    </div>
    {(type==="SMD"||type==="MD")&&<div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:8}}>
      {fi("meanExp","Mean Exp")}{fi("sdExp","SD Exp")}{fi("nExp","n Exp")}{fi("meanCtrl","Mean Ctrl")}{fi("sdCtrl","SD Ctrl")}{fi("nCtrl","n Ctrl")}
    </div>}
    {(type==="OR"||type==="RR"||type==="RD")&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:8}}>{fi("a","a (event/Exp)")}{fi("b","b (no event/Exp)")}{fi("c","c (event/Ctrl)")}{fi("d","d (no event/Ctrl)")}</div>}
    {type==="HR"&&<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
      <div><div style={{fontSize:9,color:C.dim,marginBottom:2}}>HR</div><input value={s._hrVal||""} onChange={e=>sp("_hrVal",e.target.value)} placeholder="HR" style={{...inp,fontSize:11,fontFamily:"'IBM Plex Mono',monospace",padding:"4px 6px"}}/></div>
      <div><div style={{fontSize:9,color:C.dim,marginBottom:2}}>95% CI Lower</div><input value={s._hrLo||""} onChange={e=>sp("_hrLo",e.target.value)} placeholder="lower" style={{...inp,fontSize:11,fontFamily:"'IBM Plex Mono',monospace",padding:"4px 6px"}}/></div>
      <div><div style={{fontSize:9,color:C.dim,marginBottom:2}}>95% CI Upper</div><input value={s._hrHi||""} onChange={e=>sp("_hrHi",e.target.value)} placeholder="upper" style={{...inp,fontSize:11,fontFamily:"'IBM Plex Mono',monospace",padding:"4px 6px"}}/></div>
    </div>}
    {type==="COR"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>{fi("r","r (Pearson)")}{fi("n","n (sample size)")}</div>}
    {type==="PROP"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>{fi("events","events")}{fi("total","group total")}</div>}
    {type==="DIAG"&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:8}}>{fi("tp","TP")}{fi("fp","FP")}{fi("fn","FN")}{fi("tn","TN")}</div>}
    <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <button onClick={calc} style={btnS("primary")}>Calculate & Apply →</button>
      {res&&<span style={{fontSize:11,fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{res.display||`ES=${res.es} [${res.lo}, ${res.hi}]`}</span>}
      {err&&<span style={{fontSize:11,color:C.red}}>{err}</span>}
    </div>
    {note&&<div style={{fontSize:10.5,color:C.yel,marginTop:6,lineHeight:1.5}}>⚠ {note}</div>}
    {res&&["OR","RR","HR","PROP","DIAG"].includes(type)&&<div style={{fontSize:10,color:C.dim,marginTop:6}}>✓ Stored on the analysis scale ({ES_TYPES[type]?.scale}). The forest plot and pooling use this transformed value; the readable value is shown above.</div>}
  </div>);
}

/* ════════════ CONVERSION PANEL ════════════ */
function ConversionPanel({s,ch,onClose}){
  const[convId,setConvId]=useState(CONVERSIONS[0].id);
  const[inp_,setInp_]=useState({});
  const[reason,setReason]=useState("");
  const[res,setRes]=useState(null);
  const[err,setErr]=useState("");
  const conv=CONVERSIONS.find(c=>c.id===convId);
  const groups=[...new Set(CONVERSIONS.map(c=>c.group))];
  const sp=(k,v)=>setInp_(prev=>({...prev,[k]:v}));

  const run=()=>{
    setErr("");
    const r=conv.run(inp_);
    if(!r.ok){setRes(null);setErr(r.error||"Check inputs.");return;}
    setRes(r);
  };

  // Map a conversion result onto study fields, preserving the original via a conversion record
  const apply=(target)=>{
    if(!res) return;
    const stamp=new Date().toISOString();
    const record={id:uid(),type:conv.id,method:conv.method,reason:reason||"",
      inputs:{...inp_},result:res.values,at:stamp,target};
    const patch={};
    const v=res.values;
    if(target==="continuous_exp"){ if(v.mean!=null)patch.meanExp=String(v.mean); if(v.sd!=null)patch.sdExp=String(v.sd); }
    else if(target==="continuous_ctrl"){ if(v.mean!=null)patch.meanCtrl=String(v.mean); if(v.sd!=null)patch.sdCtrl=String(v.sd); }
    else if(target==="sd_exp"){ if(v.sd!=null)patch.sdExp=String(v.sd); }
    else if(target==="sd_ctrl"){ if(v.sd!=null)patch.sdCtrl=String(v.sd); }
    else if(target==="se_field"){ /* SE only — store as note, used for ratio/log entry */ }
    else if(target==="counts"){ if(v.events!=null)patch.events=String(v.events); if(v.total!=null)patch.total=String(v.total); }
    else if(target==="es"){ if(v.es!=null)patch.es=String(v.es); if(v.lo!=null)patch.lo=String(v.lo); if(v.hi!=null)patch.hi=String(v.hi); }

    // write fields + audit
    Object.keys(patch).forEach(k=>ch(k,patch[k]));
    ch("converted",true);
    ch("source","converted");
    ch("conversions",[...(s.conversions||[]),record]);
    const flags=s.flags||[]; if(!flags.includes("conv")) ch("flags",[...flags,"conv"]);
    const note=`Converted (${conv.label}): ${res.detail}${reason?` — ${reason}`:""}.`;
    ch("notes",s.notes?`${s.notes} | ${note}`:note);
    onClose();
  };

  // which apply-targets make sense for this conversion's outputs
  const v=res?res.values:{};
  const targets=[];
  if(res){
    if(v.mean!=null&&v.sd!=null){targets.push(["continuous_exp","→ Intervention mean & SD"]);targets.push(["continuous_ctrl","→ Control mean & SD"]);}
    else if(v.sd!=null){targets.push(["sd_exp","→ Intervention SD"]);targets.push(["sd_ctrl","→ Control SD"]);}
    if(v.events!=null){targets.push(["counts","→ Events / total"]);}
    if(v.es!=null){targets.push(["es","→ Effect size + 95% CI"]);}
  }

  return(<div style={{position:"fixed",inset:0,background:"#00000099",zIndex:998,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{background:C.surf,border:`1px solid ${C.brd}`,borderRadius:10,padding:22,width:"100%",maxWidth:640,maxHeight:"90vh",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,gap:14}}>
        <div>
          <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>🔄 Data Conversion</div>
          <div style={{fontSize:12,color:C.muted}}>The original reported value is preserved. The converted value is labelled and logged with its formula.</div>
        </div>
        <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:22,cursor:"pointer",padding:0,lineHeight:1}}>×</button>
      </div>
      <label style={lbl}>Conversion</label>
      <select value={convId} onChange={e=>{setConvId(e.target.value);setRes(null);setErr("");setInp_({});}} style={{...inp,marginBottom:12}}>
        {groups.map(g=>(<optgroup key={g} label={g}>
          {CONVERSIONS.filter(c=>c.group===g).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
        </optgroup>))}
      </select>

      <div style={{background:C.bg,border:`1px solid ${themeAlpha(C.acc,'33')}`,borderLeft:`3px solid ${C.acc}`,borderRadius:6,padding:"9px 12px",marginBottom:12,fontSize:11,color:C.muted,lineHeight:1.6}}>
        <strong style={{color:C.acc}}>Method:</strong> {conv.method}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:12}}>
        {conv.inputs.map(([k,label])=>(
          <div key={k}><label style={lbl}>{label}</label>
            <input value={inp_[k]||""} onChange={e=>sp(k,e.target.value)} placeholder={label}
              style={{...inp,fontSize:12,fontFamily:"'IBM Plex Mono',monospace"}}/></div>
        ))}
      </div>
      <div style={{marginBottom:12}}><label style={lbl}>Reason / assumption (optional)</label>
        <input value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. SD not reported; recovered from reported 95% CI" style={{...inp,fontSize:12}}/></div>

      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12}}>
        <button onClick={run} style={btnS("primary")}>Compute →</button>
        {err&&<span style={{fontSize:12,color:C.red}}>{err}</span>}
      </div>

      {res&&(<div style={{background:C.bg,border:`1px solid ${themeAlpha(C.grn,'44')}`,borderRadius:8,padding:14}}>
        <div style={{fontSize:10,fontWeight:700,color:C.grn,letterSpacing:0.5,marginBottom:8}}>RESULT</div>
        <div style={{fontSize:14,fontFamily:"'IBM Plex Mono',monospace",color:C.grn,marginBottom:8}}>{res.detail}</div>
        <div style={{fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.6}}><strong style={{color:C.txt}}>Formula:</strong> {res.formula}</div>
        {targets.length>0?(<>
          <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Apply the converted value to:</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {targets.map(([t,label])=>(
              <button key={t} onClick={()=>apply(t)} style={{...btnS(),fontSize:11}}>{label}</button>
            ))}
          </div>
        </>):(
          <div style={{fontSize:11,color:C.muted}}>This result is informational (e.g. SE or a percentage). Copy it into the relevant field, or use it as an input to another conversion. The value: <strong style={{color:C.txt,fontFamily:"'IBM Plex Mono',monospace"}}>{JSON.stringify(res.values)}</strong></div>
        )}
        <InfoBox color={C.yel}>The original reported numbers stay in your notes and the conversion log. Converted values are tagged so the analysis can flag reliance on indirect data.</InfoBox>
      </div>)}
    </div>
  </div>);
}

/* ════════════ ADD-STUDY MODAL (PMID / DOI / Title / Manual) ════════════ */
function AddStudyModal({onClose,onAdd}){
  const[mode,setMode]=useState("pmid");
  const[val,setVal]=useState("");
  const[loading,setLoading]=useState(false);
  const[status,setStatus]=useState("");
  const[err,setErr]=useState("");
  const[preview,setPreview]=useState(null);

  const lookup=async()=>{
    setErr("");setPreview(null);
    if(!val.trim()){setErr("Enter a value first.");return;}
    setLoading(true);
    // Title can only be resolved by web search; DOI/PMID try the direct API first, then fall back.
    if(mode!=="title"){
      try{
        setStatus(mode==="doi"?"Trying CrossRef…":"Trying PubMed…");
        const cite = mode==="doi" ? await fetchByDOI(val) : await fetchByPMID(val);
        setPreview(cite);setStatus("");setLoading(false);return;
      }catch(e){
        // direct fetch blocked in-sandbox → fall through to AI (when enabled)
        if(!AI_FEATURES_ENABLED){
          setErr((e.message||"Lookup failed")+" — you can still add the study manually below.");
          setStatus("");setLoading(false);return;
        }
      }
    }
    try{
      setStatus("Searching the web via Claude…");
      const cite = await fetchCitationAI(mode==="title"?"title":mode, val);
      setPreview(cite);setStatus("");
    }catch(e){
      setErr((e.message||"Lookup failed")+" — you can still add the study manually below.");
      setStatus("");
    }
    setLoading(false);
  };

  const addManual=()=>{
    const base={...mkStudy()};
    if(mode==="title") base.title=val.trim();
    if(mode==="doi") base.doi=val.trim();
    if(mode==="pmid") base.pmid=val.trim().replace(/[^0-9]/g,"");
    onAdd(base);onClose();
  };
  const addFromPreview=()=>{
    const base={...mkStudy(),...preview,needsReview:true};
    onAdd(base);onClose();
  };

  // Title lookup is resolved entirely by a Claude web search → hidden while AI is off.
  const modes=[["pmid","PubMed ID"],["doi","DOI"],...(AI_FEATURES_ENABLED?[["title","Title"]]:[]),["manual","Manual"]];
  return(<div style={{position:"fixed",inset:0,background:"#00000099",zIndex:998,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{background:C.surf,border:`1px solid ${C.brd}`,borderRadius:10,padding:22,width:"100%",maxWidth:620,maxHeight:"90vh",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,gap:14}}>
        <div>
          <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>＋ Add Study</div>
          <div style={{fontSize:12,color:C.muted}}>{AI_FEATURES_ENABLED?"Look up a citation by ID, DOI, or title (uses a Claude web search), or add it manually. Everything stays editable afterwards.":"Look up a citation by PubMed ID or DOI, or add it manually. Everything stays editable afterwards."}</div>
        </div>
        <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:22,cursor:"pointer",padding:0,lineHeight:1}}>×</button>
      </div>

      <div style={{display:"flex",border:`1px solid ${C.brd}`,borderRadius:6,overflow:"hidden",marginBottom:14,width:"fit-content"}}>
        {modes.map(([m,label])=>(
          <button key={m} onClick={()=>{setMode(m);setErr("");setPreview(null);setVal("");}} style={{padding:"7px 14px",border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
            background:mode===m?C.acc:"transparent",color:mode===m?C.accText:C.muted}}>{label}</button>
        ))}
      </div>

      {mode==="manual"?(
        <div>
          <div style={{fontSize:12,color:C.muted,marginBottom:14,lineHeight:1.6}}>Add a blank study and fill in everything yourself in the study card.</div>
          <button onClick={addManual} style={btnS("primary")}>＋ Add blank study</button>
        </div>
      ):(
        <div>
          <label style={lbl}>{mode==="pmid"?"PubMed ID (PMID)":mode==="doi"?"DOI":"Article title"}</label>
          <div style={{display:"flex",gap:8,marginBottom:6}}>
            <input autoFocus value={val} onChange={e=>setVal(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")lookup();}}
              placeholder={mode==="pmid"?"e.g. 29562534":mode==="doi"?"e.g. 10.1056/NEJMoa1800256":"Paste the full article title"}
              style={{...inp,fontSize:13,fontFamily:mode==="title"?"inherit":"'IBM Plex Mono',monospace"}}/>
            <button onClick={lookup} disabled={loading} style={{...btnS("primary"),whiteSpace:"nowrap",opacity:loading?0.5:1}}>{loading?"⟳ Looking up…":"🔎 Look up"}</button>
          </div>
          {loading&&status&&<div style={{fontSize:11,color:C.acc,marginBottom:10}}>⟳ {status}</div>}
          {!loading&&mode==="pmid"&&<div style={{fontSize:11,color:C.dim,marginBottom:10}}>{AI_FEATURES_ENABLED?"Tries PubMed directly, then falls back to a Claude web search if the browser can't reach it.":"Fetched directly from PubMed."}</div>}
          {!loading&&mode==="doi"&&<div style={{fontSize:11,color:C.dim,marginBottom:10}}>{AI_FEATURES_ENABLED?"Tries CrossRef directly, then falls back to a Claude web search if the browser can't reach it.":"Fetched directly from CrossRef."}</div>}
          {!loading&&mode==="title"&&<div style={{fontSize:11,color:C.dim,marginBottom:10}}>Resolved by a Claude web search. Confirm the match is the exact paper before adding.</div>}

          {err&&<div style={{fontSize:12,color:C.red,marginBottom:12,lineHeight:1.5}}>{err}</div>}

          {preview&&(<div style={{background:C.bg,border:`1px solid ${themeAlpha(C.grn,'44')}`,borderRadius:8,padding:14,marginBottom:12}}>
            <div style={{fontSize:10,fontWeight:700,color:C.grn,letterSpacing:0.5,marginBottom:8}}>FOUND — VERIFY, THEN ADD (please confirm against the source)</div>
            {preview.title&&<div style={{fontSize:13,fontWeight:600,marginBottom:6,lineHeight:1.4}}>{preview.title}</div>}
            <div style={{fontSize:12,color:C.muted,lineHeight:1.7}}>
              {preview.authors&&<div><strong style={{color:C.txt}}>Authors:</strong> {preview.authors.slice(0,160)}{preview.authors.length>160?"…":""}</div>}
              {preview.journal&&<div><strong style={{color:C.txt}}>Journal:</strong> {preview.journal}{preview.year?` (${preview.year})`:""}</div>}
              {preview.doi&&<div><strong style={{color:C.txt}}>DOI:</strong> {preview.doi}</div>}
              {preview.pmid&&<div><strong style={{color:C.txt}}>PMID:</strong> {preview.pmid}</div>}
            </div>
          </div>)}

          <div style={{display:"flex",gap:8}}>
            {preview&&<button onClick={addFromPreview} style={btnS("success")}>✓ Add this study</button>}
            <button onClick={addManual} style={btnS(preview?"ghost":"primary")}>{preview?"Add manually instead":"Add anyway (manual)"}</button>
          </div>
        </div>
      )}
    </div>
  </div>);
}

/* ════════════ TAB: EXTRACTION ════════════ */
function StudyCard({s,idx,updStudy,delStudy,dup,onClone}){
  const[open,setOpen]=useState(false);
  const[showMeta,setShowMeta]=useState(false);
  const[showConv,setShowConv]=useState(false);
  const ch=(k,v)=>updStudy(s.id,k,v);
  const toggleFlag=(f)=>{const cur=s.flags||[];ch("flags",cur.includes(f)?cur.filter(x=>x!==f):[...cur,f]);};
  const issues=validateStudy(s);
  const errors=issues.filter(i=>i.sev==="error");
  const warns=issues.filter(i=>i.sev==="warn");
  const esTypeLabel=s.esType?ES_TYPES[s.esType]?.scale||s.esType:null;
  const nonPrimary=isNonPrimary(s);
  return(<div style={{background:C.card,border:`1px solid ${dup?themeAlpha(C.red,'66'):errors.length?themeAlpha(C.red,'44'):C.brd}`,borderRadius:8,overflow:"hidden"}}>
    {showConv&&<ConversionPanel s={s} ch={ch} onClose={()=>setShowConv(false)}/>}
    <div onClick={()=>setOpen(!open)} style={{display:"flex",alignItems:"center",padding:"10px 16px",cursor:"pointer",gap:10,userSelect:"none",flexWrap:"wrap"}}>
      <span style={{color:C.dim,fontSize:11,fontFamily:"'IBM Plex Mono',monospace",minWidth:22}}>#{idx+1}</span>
      <div style={{flex:1,minWidth:120}}>
        <span style={{fontSize:13,fontWeight:600}}>{s.author||"New Study"}{s.year?` (${s.year})`:""}</span>
        {s.n&&<span style={{fontSize:11,color:C.muted,marginLeft:8}}>n={s.n}</span>}
        {s.outcome&&<span style={{fontSize:11,color:C.muted,marginLeft:8}}>· {s.outcome}</span>}
        {s.timepoint&&<span style={{fontSize:11,color:C.dim,marginLeft:6}}>@ {s.timepoint}</span>}
      </div>
      {s.siftOrigin&&<span style={tagS("blue")} title="Added from Screening (full-text accept)">⬡ Screening</span>}
      {dup&&<span style={tagS("red")} title="Possible duplicate (same author+year or identical ES+n)">⚠ Dup?</span>}
      {s.converted&&<span style={tagS("purple")} title="Contains converted values">⇄ Converted</span>}
      {nonPrimary&&!s.converted&&<span style={tagS("yellow")} title="Not directly-reported primary data">◆ Non-primary</span>}
      {s.needsReview&&<span style={tagS("yellow")} title="Flagged for second-reviewer confirmation">👁 Review</span>}
      {errors.length>0&&<span style={tagS("red")}>{errors.length} error{errors.length>1?"s":""}</span>}
      {errors.length===0&&warns.length>0&&<span style={tagS("yellow")}>{warns.length} warning{warns.length>1?"s":""}</span>}
      {errors.length===0&&warns.length===0&&s.es!==""&&<span style={tagS("green")}>✓ Complete</span>}
      {s.es!==""&&<span style={tagS("blue")}>{esTypeLabel?`${esTypeLabel}: `:"ES: "}{fmtES(+s.es)}</span>}
      <span style={{fontSize:11,color:C.dim,background:C.bg,padding:"2px 8px",borderRadius:4,border:`1px solid ${C.brd}`}}>{s.design}</span>
      <span style={{color:C.dim,fontSize:14}}>{open?"▲":"▼"}</span>
    </div>
    {open&&(<div style={{padding:"0 16px 16px",borderTop:`1px solid ${C.brd}`}}>
      {/* Study identity */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,margin:"14px 0 12px"}}>
        {[["author","First Author","Smith J"],["year","Year","2024"],["country","Country / Region","USA"],["n","Total N","120"]].map(([k,label,ph])=>(
          <div key={k}><label style={lbl}>{label}</label><input value={s[k]||""} onChange={e=>ch(k,e.target.value)} placeholder={ph} style={{...inp,fontSize:12}}/></div>
        ))}
      </div>

      {/* Citation + study metadata (collapsible) */}
      <div style={{border:`1px solid ${C.brd}`,borderRadius:6,marginBottom:12,overflow:"hidden"}}>
        <button onClick={()=>setShowMeta(!showMeta)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",background:"transparent",border:"none",cursor:"pointer",color:C.txt}}>
          <span style={{fontSize:11,fontWeight:700,letterSpacing:0.5}}>📑 Citation & Study Metadata{(s.title||s.doi||s.pmid)?<span style={{color:C.grn,marginLeft:8,fontWeight:400}}>● populated</span>:<span style={{color:C.dim,marginLeft:8,fontWeight:400}}>optional</span>}</span>
          <span style={{color:C.dim,fontSize:12}}>{showMeta?"▲":"▼"}</span>
        </button>
        {showMeta&&(<div style={{padding:"0 12px 12px",borderTop:`1px solid ${C.brd}`}}>
          <div style={{marginTop:12,marginBottom:10}}>
            <label style={lbl}>Full Title</label>
            <input value={s.title||""} onChange={e=>ch("title",e.target.value)} placeholder="Article title" style={{...inp,fontSize:12}}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10,marginBottom:10}}>
            <div><label style={lbl}>Authors</label><input value={s.authors||""} onChange={e=>ch("authors",e.target.value)} placeholder="Smith J; Doe A; …" style={{...inp,fontSize:12}}/></div>
            <div><label style={lbl}>DOI</label><input value={s.doi||""} onChange={e=>ch("doi",e.target.value)} placeholder="10.xxxx/…" style={{...inp,fontSize:12,fontFamily:"'IBM Plex Mono',monospace"}}/></div>
            <div><label style={lbl}>PMID</label><input value={s.pmid||""} onChange={e=>ch("pmid",e.target.value)} placeholder="PubMed ID" style={{...inp,fontSize:12,fontFamily:"'IBM Plex Mono',monospace"}}/></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10,marginBottom:10}}>
            <div><label style={lbl}>Journal</label><input value={s.journal||""} onChange={e=>ch("journal",e.target.value)} placeholder="Journal name" style={{...inp,fontSize:12}}/></div>
            <div><label style={lbl}>Data Source</label><input value={s.dataSource||""} onChange={e=>ch("dataSource",e.target.value)} placeholder="e.g. trial, registry" style={{...inp,fontSize:12}}/></div>
            <div><label style={lbl}>Enrollment Period</label><input value={s.enrollPeriod||""} onChange={e=>ch("enrollPeriod",e.target.value)} placeholder="e.g. 2015–2018" style={{...inp,fontSize:12}}/></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <div><label style={lbl}>Follow-up Duration</label><input value={s.followup||""} onChange={e=>ch("followup",e.target.value)} placeholder="e.g. 24 months" style={{...inp,fontSize:12}}/></div>
            <div><label style={lbl}>Funding / Conflicts</label><input value={s.funding||""} onChange={e=>ch("funding",e.target.value)} placeholder="e.g. industry-funded" style={{...inp,fontSize:12}}/></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <div><label style={lbl}>Population Definition</label><textarea value={s.populationDef||""} onChange={e=>ch("populationDef",e.target.value)} placeholder="Eligibility, key baseline characteristics…" style={{...inp,height:48,resize:"vertical",fontSize:12}}/></div>
            <div><label style={lbl}>Intervention / Exposure</label><textarea value={s.interventionDef||""} onChange={e=>ch("interventionDef",e.target.value)} placeholder="Dose, regimen, definition…" style={{...inp,height:48,resize:"vertical",fontSize:12}}/></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <div><label style={lbl}>Comparator / Control</label><textarea value={s.comparatorDef||""} onChange={e=>ch("comparatorDef",e.target.value)} placeholder="Placebo, usual care, active comparator…" style={{...inp,height:48,resize:"vertical",fontSize:12}}/></div>
            <div><label style={lbl}>Secondary Outcomes</label><textarea value={s.secondaryOutcomes||""} onChange={e=>ch("secondaryOutcomes",e.target.value)} placeholder="List secondary outcomes…" style={{...inp,height:48,resize:"vertical",fontSize:12}}/></div>
          </div>
          {s.abstract&&<div><label style={lbl}>Abstract (imported)</label>
            <textarea value={s.abstract} onChange={e=>ch("abstract",e.target.value)} style={{...inp,height:80,resize:"vertical",fontSize:11,lineHeight:1.5}}/></div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10}}>
            <div><label style={lbl}>Extracted by (initials)</label><input value={s.extractedBy||""} onChange={e=>ch("extractedBy",e.target.value)} placeholder="e.g. AB" style={{...inp,fontSize:12}}/></div>
            <div style={{display:"flex",alignItems:"flex-end",paddingBottom:4}}>
              <button onClick={()=>ch("extractedAt",new Date().toISOString())} style={{...btnS("ghost"),fontSize:11}}>
                {s.extractedAt?`Extracted ${fmtDate(s.extractedAt)} ✓`:"Stamp extraction date"}
              </button>
            </div>
          </div>
        </div>)}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:12}}>
        <div><label style={lbl}>Study Design</label>
          <select value={s.design||"RCT"} onChange={e=>ch("design",e.target.value)} style={inp}>
            {["RCT","Quasi-RCT","Cohort","Case-Control","Cross-Sectional","Case Series","Diagnostic"].map(d=><option key={d}>{d}</option>)}
          </select></div>
        <div><label style={lbl}>Outcome <HelpTip text="Name the exact outcome (e.g. 'HbA1c change'). Studies must measure the same construct to be pooled."/></label><input value={s.outcome||""} onChange={e=>ch("outcome",e.target.value)} placeholder="e.g. HbA1c reduction" style={{...inp,fontSize:12}}/></div>
        <div><label style={lbl}>Time Point <HelpTip text="The follow-up at which this outcome was measured (e.g. '12 weeks'). Don't pool different time points together."/></label><input value={s.timepoint||""} onChange={e=>ch("timepoint",e.target.value)} placeholder="e.g. 12 weeks" style={{...inp,fontSize:12}}/></div>
        <div><label style={lbl}>Adjustment <HelpTip text="How the estimate was adjusted. Don't silently mix unadjusted with adjusted/multivariable/propensity/IPTW estimates."/></label>
          <select value={s.adjusted||"unadjusted"} onChange={e=>ch("adjusted",e.target.value)} style={inp}>
            {ADJUST_OPTIONS.map(([k,l])=><option key={k} value={k}>{l}</option>)}
          </select></div>
      </div>

      {/* Data provenance row */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div><label style={lbl}>Data Role <HelpTip text="Whether this is the primary directly-reported outcome or a secondary/subgroup/post-hoc/sensitivity estimate. Non-primary data is flagged before pooling."/></label>
          <select value={s.dataNature||"primary"} onChange={e=>ch("dataNature",e.target.value)} style={inp}>
            {DATA_NATURE.map(([k,l])=><option key={k} value={k}>{l}</option>)}
          </select></div>
        <div><label style={lbl}>Data Source <HelpTip text="Where the number physically came from in the paper."/></label>
          <select value={s.source||""} onChange={e=>ch("source",e.target.value)} style={inp}>
            {SOURCE_OPTIONS.map(([k,l])=><option key={k} value={k}>{l}</option>)}
          </select></div>
      </div>

      {/* Effect size block */}
      <div style={{border:`1px solid ${C.brd}`,borderRadius:6,padding:12}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div style={{fontSize:10,fontWeight:700,color:C.acc,letterSpacing:0.8}}>EFFECT SIZE & 95% CI (analysis scale)</div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={()=>setShowConv(true)} style={{...btnS("ghost"),fontSize:11,color:C.purp,borderColor:themeAlpha(C.purp,'55')}}>🔄 Convert data</button>
            <label style={{...lbl,marginBottom:0}}>Measure</label>
            <select value={s.esType||""} onChange={e=>ch("esType",e.target.value)} style={{...inp,width:"auto",fontSize:11,padding:"3px 6px"}}>
              <option value="">— set —</option>
              {Object.keys(ES_TYPES).map(t=><option key={t} value={t}>{ES_TYPES[t].scale}</option>)}
            </select>
            <HelpTip text="For OR/RR/HR enter the LOG of the ratio (the calculator/conversion does this). SMD/MD/Fisher-z/logit are entered directly."/>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
          {[["es","Effect Size (ES)","0.450"],["lo","95% CI Lower","0.120"],["hi","95% CI Upper","0.780"]].map(([k,label,ph])=>(
            <div key={k}><label style={lbl}>{label}</label>
              <input value={s[k]||""} onChange={e=>ch(k,e.target.value)} placeholder={ph} style={{...inp,fontSize:12,fontFamily:"'IBM Plex Mono',monospace"}}/></div>
          ))}
        </div>
        <ESCalcInline s={s} ch={ch}/>
      </div>

      {/* Reliability flags */}
      <div style={{marginTop:12}}>
        <label style={lbl}>Reliability Flags <HelpTip text="Tag anything a co-reviewer should know. 'Do not pool unless confirmed' blocks the value from analysis until resolved."/></label>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {EXTRACT_FLAGS.map(([f,label])=>{
            const on=(s.flags||[]).includes(f);
            const danger=f==="noconfirm"||f==="highrisk";
            return(<button key={f} onClick={()=>toggleFlag(f)} style={{padding:"4px 10px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,
              border:`1px solid ${on?(danger?C.red:C.acc):C.brd}`,background:on?(danger?themeAlpha(C.red,'22'):themeAlpha(C.acc,'22')):"transparent",
              color:on?(danger?C.red:C.acc):C.muted}}>{on?"✓ ":""}{label}</button>);
          })}
        </div>
      </div>

      {/* Conversion log */}
      {(s.conversions||[]).length>0&&(<div style={{marginTop:12,background:`${themeAlpha(C.purp,'0d')}`,border:`1px solid ${themeAlpha(C.purp,'44')}`,borderRadius:6,padding:"10px 12px"}}>
        <div style={{fontSize:10,fontWeight:700,color:C.purp,letterSpacing:0.5,marginBottom:8}}>⇄ CONVERSION AUDIT TRAIL ({s.conversions.length})</div>
        {s.conversions.map((cv,i)=>{
          const def=CONVERSIONS.find(x=>x.id===cv.type);
          return(<div key={cv.id||i} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:11,color:C.muted,padding:"5px 0",borderBottom:i<s.conversions.length-1?`1px solid ${C.brd}`:"none"}}>
            <div style={{flex:1}}>
              <div style={{color:C.txt,fontWeight:600}}>{def?def.label:cv.type}</div>
              <div style={{fontSize:10}}>method: {cv.method}{cv.reason?` · ${cv.reason}`:""}</div>
              <div style={{fontSize:10,fontFamily:"'IBM Plex Mono',monospace"}}>in: {JSON.stringify(cv.inputs)} → {JSON.stringify(cv.result)}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
              <span style={{fontSize:9,color:C.dim}}>{cv.at?fmtDate(cv.at):""}</span>
              <button onClick={()=>{ch("conversions",s.conversions.filter((_,j)=>j!==i));}} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:13}}>×</button>
            </div>
          </div>);
        })}
      </div>)}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:12}}>
        <div style={{display:"flex",alignItems:"flex-end",paddingBottom:4}}>
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
            <input type="checkbox" checked={!!s.needsReview} onChange={e=>ch("needsReview",e.target.checked)} style={{accentColor:C.yel,width:15,height:15}}/>
            <span style={{fontSize:12,color:s.needsReview?C.yel:C.muted,fontWeight:600}}>👁 Needs second-reviewer confirmation</span>
          </label>
        </div>
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"flex-end",paddingBottom:2}}>
          {onClone&&<button onClick={()=>onClone(s)} style={{...btnS("ghost"),fontSize:11}}>＋ Add another outcome / time point</button>}
        </div>
      </div>

      <div style={{marginTop:12}}><label style={lbl}>Notes — assumptions, conversions, unclear data</label>
        <textarea value={s.notes||""} onChange={e=>ch("notes",e.target.value)} placeholder="e.g. SD imputed from SE; median/IQR converted to mean/SD via Wan 2014; adjusted for age & sex…" style={{...inp,height:52,resize:"vertical",fontSize:12}}/></div>

      {/* Inline validation list */}
      {issues.length>0&&(<div style={{marginTop:12,background:C.bg,border:`1px solid ${themeAlpha((errors.length?C.red:C.yel),'44')}`,borderRadius:6,padding:"10px 12px"}}>
        <div style={{fontSize:10,fontWeight:700,color:errors.length?C.red:C.yel,letterSpacing:0.5,marginBottom:6}}>DATA CHECKS FOR THIS STUDY</div>
        {issues.map((it,i)=>(
          <div key={i} style={{display:"flex",gap:8,fontSize:11,color:C.muted,marginBottom:4,lineHeight:1.5}}>
            <span style={{color:it.sev==="error"?C.red:C.yel,flexShrink:0}}>{it.sev==="error"?"✗":"⚠"}</span>
            <span>{it.msg}</span>
          </div>
        ))}
      </div>)}

      <div style={{marginTop:12,display:"flex",justifyContent:"flex-end"}}>
        <button onClick={()=>delStudy(s.id)} style={btnS("danger")}>Remove Study</button>
      </div>
    </div>)}
  </div>);
}
function ExtractionTab({project,updateProject,activeId}){
  const{studies}=project;
  // prompt6 Task 5 — read-only viewers: hide the affirmative edit controls.
  // (updateProject already no-ops every write for read-only projects; this is polish.)
  const readOnly=!!((project._permissions&&project._permissions.readOnly)||project._readOnly);
  const addStudy=()=>updateProject(activeId,p=>({...p,studies:[...p.studies,mkStudy()]}));
  const addStudyObj=(st)=>updateProject(activeId,p=>({...p,studies:[...p.studies,st]}));
  const updStudy=(id,k,v)=>updateProject(activeId,p=>({...p,studies:p.studies.map(s=>s.id===id?{...s,[k]:v,updatedAt:new Date().toISOString()}:s)}));
  const delStudy=id=>updateProject(activeId,p=>({...p,studies:p.studies.filter(s=>s.id!==id)}));
  // Clone study-level metadata into a new row for another outcome / time point / arm
  const cloneForOutcome=(s)=>{
    const META=["author","year","country","design","title","authors","journal","doi","pmid","abstract",
      "dataSource","enrollPeriod","populationDef","interventionDef","comparatorDef","funding","extractedBy"];
    const fresh=mkStudy();
    META.forEach(k=>{fresh[k]=s[k];});
    fresh.outcome="";fresh.timepoint="";fresh.notes=`Same cohort as ${s.author||"study"} ${s.year||""} — additional outcome/time point.`;
    updateProject(activeId,p=>({...p,studies:[...p.studies,fresh]}));
  };
  const moveStudy=(id,dir)=>{
    if(readOnly) return;
    updateProject(activeId,p=>{
      const arr=[...p.studies];
      const idx=arr.findIndex(s=>s.id===id);
      if(idx<0) return p;
      const to=idx+dir;
      if(to<0||to>=arr.length) return p;
      [arr[idx],arr[to]]=[arr[to],arr[idx]];
      return {...p,studies:arr};
    });
  };
  const[showAdd,setShowAdd]=useState(false);
  const[showAI,setShowAI]=useState(false);
  const[aiMode,setAiMode]=useState("pdf");   // pdf | text
  const[paperText,setPaperText]=useState("");
  const[pdfFile,setPdfFile]=useState(null);  // {name,size,data(base64)}
  const[focusNote,setFocusNote]=useState("");
  const[extracting,setExtracting]=useState(false);
  const[aiError,setAIError]=useState("");
  const[view,setView]=useState("cards");   // cards | table
  const[showQC,setShowQC]=useState(false);
  // Filters
  const[fOutcome,setFOutcome]=useState("");
  const[fTime,setFTime]=useState("");
  const[fNature,setFNature]=useState("");
  const[fStatus,setFStatus]=useState("");
  const sortKey = project.extractionSort || DEFAULT_EXTRACTION_SORT;
  const setSortKey = (key) => updateProject(activeId, p=>({...p, extractionSort:key}));

  const dup=useMemo(()=>findDuplicates(studies),[studies]);
  const withES=studies.filter(s=>s.es!=="").length;

  // distinct values for filter dropdowns
  const outcomeOpts=useMemo(()=>[...new Set(studies.map(s=>(s.outcome||"").trim()).filter(Boolean))],[studies]);
  const timeOpts=useMemo(()=>[...new Set(studies.map(s=>(s.timepoint||"").trim()).filter(Boolean))],[studies]);

  const statusOf=(s)=>{
    const iss=validateStudy(s);
    if(iss.some(i=>i.sev==="error")) return "error";
    if(s.needsReview) return "review";
    if(s.es==="") return "incomplete";
    if(iss.some(i=>i.sev==="warn")) return "warn";
    return "complete";
  };
  const filtered=useMemo(()=>{
    const ordered=orderStudies(studies,sortKey);
    return ordered.filter(s=>{
      if(fOutcome&&(s.outcome||"").trim()!==fOutcome) return false;
      if(fTime&&(s.timepoint||"").trim()!==fTime) return false;
      if(fNature&&(s.dataNature||"primary")!==fNature) return false;
      if(fStatus&&statusOf(s)!==fStatus) return false;
      return true;
    });
  },[studies,sortKey,fOutcome,fTime,fNature,fStatus]);
  const filterActive=fOutcome||fTime||fNature||fStatus;

  // primary-data composition
  const comp=useMemo(()=>{
    const vv=studies.filter(s=>s.es!=="");
    const nonPrim=vv.filter(isNonPrimary).length;
    const conv=vv.filter(s=>s.converted).length;
    return {total:vv.length,nonPrim,conv,prim:vv.length-nonPrim};
  },[studies]);

  // Aggregate quality report
  const qc=useMemo(()=>{
    const rows=studies.map(s=>({s,issues:validateStudy(s)}));
    const errs=rows.filter(r=>r.issues.some(i=>i.sev==="error"));
    const warns=rows.filter(r=>r.issues.some(i=>i.sev==="warn")&&!r.issues.some(i=>i.sev==="error"));
    const dupIds=Object.keys(dup);
    const pool=checkPoolability(studies);
    return{rows,errs,warns,dupIds,pool};
  },[studies,dup]);

  const resetAI=()=>{setShowAI(false);setPaperText("");setPdfFile(null);setFocusNote("");setAIError("");};

  const onPickPDF=async(file)=>{
    if(!file) return;
    setAIError("");
    if(file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name)){setAIError("Please choose a PDF file.");return;}
    // Anthropic PDF limit is 32MB / 100 pages; guard generously
    if(file.size>30*1024*1024){setAIError("PDF is larger than 30 MB — too big to send. Try the text-paste option instead.");return;}
    try{
      const data=await fileToBase64(file);
      setPdfFile({name:file.name,size:file.size,data});
    }catch(e){setAIError(e.message||"Could not read the PDF.");}
  };

  // Shared extraction instruction (same JSON contract for both modes)
  const buildExtractInstruction=()=>{
    const focus=focusNote.trim()?`\n\nFOCUS — the researcher wants you to prioritise this:\n${focusNote.trim()}\nExtract the data for the outcome / comparison described above. If the document reports several outcomes or time points, pick the one that matches this focus.`:"";
    return `You are an expert systematic review data extractor. Extract study-level data into JSON. If a field is not stated, output an empty string. For "esType" choose one of SMD, MD, OR, RR, HR, COR, PROP, DIAG, or "" if unclear. For "source" choose text, table, figure, supplement, or "". For continuous outcomes fill meanExp/sdExp/nExp/meanCtrl/sdCtrl/nCtrl; for dichotomous fill the 2×2 (a,b,c,d); for time-to-event give es/lo/hi as the reported HR and its CI; only fill fields you can actually find.${focus}

Return ONLY valid JSON, no markdown, no preamble:
{"author":"","year":"","country":"","design":"","n":"","outcome":"","timepoint":"","adjusted":"unadjusted","esType":"","nExp":"","nCtrl":"","meanExp":"","sdExp":"","meanCtrl":"","sdCtrl":"","a":"","b":"","c":"","d":"","events":"","total":"","tp":"","fp":"","fn":"","tn":"","es":"","lo":"","hi":"","source":"","notes":""}`;
  };

  const applyExtracted=(text)=>{
    const parsed=safeParseJSON(text);
    const newStudy={...mkStudy(),needsReview:true,extractedAt:new Date().toISOString()};  // AI-extracted → flag + timestamp
    Object.keys(parsed).forEach(k=>{if(parsed[k]!==undefined && parsed[k]!==null && k in newStudy)newStudy[k]=typeof newStudy[k]==="boolean"?newStudy[k]:String(parsed[k]);});
    if(focusNote.trim()){const fn=`Focus: ${focusNote.trim()}`;newStudy.notes=newStudy.notes?`${newStudy.notes} | ${fn}`:fn;}
    updateProject(activeId,p=>({...p,studies:[...p.studies,newStudy]}));
  };

  const extractFromPDF=async()=>{
    if(!pdfFile){setAIError("Choose a PDF first.");return;}
    setExtracting(true);setAIError("");
    const content=[
      {type:"document",source:{type:"base64",media_type:"application/pdf",data:pdfFile.data}},
      {type:"text",text:buildExtractInstruction()},
    ];
    try{
      const text=await callClaude(content,2500);
      applyExtracted(text);
      resetAI();
    }catch(e){
      const m=e.message||String(e);
      // Common: model without PDF support, or payload too large
      setAIError(/document|pdf|media|base64/i.test(m)?`The selected model couldn't read this PDF (${m}). Try the text-paste option.`:`Error: ${m}`);
    }
    setExtracting(false);
  };

  const extractFromText=async()=>{
    if(!paperText.trim()){setAIError("Paste the paper abstract or methods+results section first.");return;}
    setExtracting(true);setAIError("");
    const prompt=`${buildExtractInstruction()}

STUDY TEXT:
${paperText.slice(0,15000)}`;
    try {
      const text=await callClaude(prompt,2500);
      applyExtracted(text);
      resetAI();
    } catch(e){setAIError(`Error: ${e.message}`);}
    setExtracting(false);
  };

  // CSV export (Excel-compatible) — includes metadata, provenance, conversion audit.
  // Routed through the shared ExportDialog (CSV only, BOM preserved for Excel).
  const buildExtractionCSV=()=>{
    const cols=["author","year","title","authors","journal","doi","pmid","country","design","dataSource",
      "enrollPeriod","followup","populationDef","interventionDef","comparatorDef","funding",
      "outcome","primaryOutcome","secondaryOutcomes","timepoint","dataNature","adjusted","source","converted","flags",
      "esType","n","nExp","nCtrl","meanExp","sdExp","meanCtrl","sdCtrl","a","b","c","d","events","total","tp","fp","fn","tn",
      "es","lo","hi","needsReview","extractedBy","extractedAt","conversions","notes"];
    const esc=v=>{let t;if(Array.isArray(v))t=v.join("; ");else if(v&&typeof v==="object")t=JSON.stringify(v);else t=String(v==null?"":v);
      t=t.replace(/"/g,'""');return /[",\n]/.test(t)?`"${t}"`:t;};
    const header=cols.join(",");
    const rows=studies.map(s=>cols.map(c=>esc(s[c])).join(","));
    return [header,...rows].join("\n");
  };
  const openExtractionExport=()=>{
    const filename=`${(project.name||"extraction").replace(/[^a-z0-9]/gi,"_")}_extraction.csv`;
    openExportDialog({
      id:"extraction-csv",
      title:`Data extraction \u2014 ${filename}`,
      formats:[{id:"csv",label:"CSV (Excel-compatible, UTF-8 BOM)"}],
      sizing:false,
      run:async()=>{
        downloadBlob(new Blob(["\ufeff"+buildExtractionCSV()],{type:"text/csv;charset=utf-8;"}),filename);
      },
    });
  };

  // compact table cell editor
  const TC=(s,k,w,ph)=>(<td style={{padding:"3px 4px",borderBottom:`1px solid ${C.brd}`}}>
    <input value={s[k]||""} onChange={e=>updStudy(s.id,k,e.target.value)} placeholder={ph||""}
      style={{...inp,fontSize:11,padding:"3px 5px",width:w||"100%",fontFamily:["es","lo","hi","n","nExp","nCtrl"].includes(k)?"'IBM Plex Mono',monospace":"inherit"}}/></td>);

  return(<div>
    <SectionHeader icon="table" title="Data Extraction" desc="Capture study-level data with the right template for your outcome type. Validation runs as you type; raw inputs are saved so every number is auditable." badge={`${studies.length} studies`}/>

    {AI_FEATURES_ENABLED && showAI && (
      <div style={{position:"fixed",inset:0,background:"#00000099",zIndex:998,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div style={{background:C.surf,border:`1px solid ${C.brd}`,borderRadius:10,padding:24,width:"100%",maxWidth:720,maxHeight:"90vh",overflowY:"auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,gap:14}}>
            <div>
              <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>✦ AI Study Extractor</div>
              <div style={{fontSize:12,color:C.muted}}>Upload the study PDF (best for tables &amp; figures) or paste text. The extracted study is auto-flagged for second-reviewer confirmation.</div>
            </div>
            <button onClick={resetAI} style={{background:"none",border:"none",color:C.muted,fontSize:22,cursor:"pointer",padding:0,lineHeight:1}}>×</button>
          </div>

          {/* Mode toggle */}
          <div style={{display:"flex",border:`1px solid ${C.brd}`,borderRadius:6,overflow:"hidden",marginBottom:14,width:"fit-content"}}>
            {[["pdf","📄 Upload PDF"],["text","📋 Paste text"]].map(([m,label])=>(
              <button key={m} onClick={()=>{setAiMode(m);setAIError("");}} style={{padding:"7px 16px",border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
                background:aiMode===m?C.acc:"transparent",color:aiMode===m?C.accText:C.muted}}>{label}</button>
            ))}
          </div>

          {/* PDF mode */}
          {aiMode==="pdf"&&(<div style={{marginBottom:12}}>
            {!pdfFile?(
              <label style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,
                border:`2px dashed ${C.brd}`,borderRadius:8,padding:"32px 20px",cursor:"pointer",background:C.bg,textAlign:"center"}}>
                <input type="file" accept="application/pdf,.pdf" style={{display:"none"}}
                  onChange={e=>{onPickPDF(e.target.files&&e.target.files[0]);e.target.value="";}}/>
                <div style={{fontSize:30}}>📄</div>
                <div style={{fontSize:13,color:C.txt,fontWeight:600}}>Click to choose a PDF</div>
                <div style={{fontSize:11,color:C.dim}}>The full text, tables, and figures are read directly · up to 30 MB / ~100 pages</div>
              </label>
            ):(
              <div style={{display:"flex",alignItems:"center",gap:12,border:`1px solid ${themeAlpha(C.grn,'55')}`,background:`${themeAlpha(C.grn,'0d')}`,borderRadius:8,padding:"12px 14px"}}>
                <span style={{fontSize:22}}>📄</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{pdfFile.name}</div>
                  <div style={{fontSize:11,color:C.muted}}>{(pdfFile.size/1024/1024).toFixed(2)} MB · ready to extract</div>
                </div>
                <button onClick={()=>setPdfFile(null)} style={{...btnS("ghost"),fontSize:11,padding:"4px 10px"}}>Remove</button>
              </div>
            )}
          </div>)}

          {/* Text mode */}
          {aiMode==="text"&&(
            <textarea autoFocus value={paperText} onChange={e=>setPaperText(e.target.value)}
              placeholder="Paste abstract, or methods + results section, or full text…"
              rows={11} style={{...inp,fontSize:12,lineHeight:1.55,resize:"vertical",marginBottom:12,fontFamily:"'IBM Plex Mono',monospace"}}/>
          )}

          {/* Optional focus note (both modes) */}
          <div style={{marginBottom:12}}>
            <label style={lbl}>Focus note <span style={{color:C.dim,fontWeight:400,textTransform:"none",letterSpacing:0}}>— optional</span> <HelpTip text="Tell the extractor which outcome, comparison, time point, or table to prioritise. Useful when a paper reports many outcomes but you only need one."/></label>
            <input value={focusNote} onChange={e=>setFocusNote(e.target.value)}
              placeholder="e.g. Extract the 12-month HbA1c result for the metformin vs placebo arm (Table 2), adjusted model"
              style={{...inp,fontSize:12}}/>
          </div>

          {aiError && <div style={{fontSize:12,color:C.red,marginBottom:10}}>{aiError}</div>}
          <div style={{display:"flex",gap:10,justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:11,color:C.dim,fontFamily:"'IBM Plex Mono',monospace"}}>
              {aiMode==="pdf"?(pdfFile?"PDF attached":"No PDF chosen"):`${paperText.length} chars`}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={resetAI} style={btnS("ghost")}>Cancel</button>
              {aiMode==="pdf"?(
                <button onClick={extractFromPDF} disabled={extracting||!pdfFile} style={{...btnS("primary"),padding:"8px 20px",opacity:(extracting||!pdfFile)?0.5:1}}>
                  {extracting?"⟳ Reading PDF…":"✦ Extract & Add Study"}
                </button>
              ):(
                <button onClick={extractFromText} disabled={extracting||!paperText.trim()} style={{...btnS("primary"),padding:"8px 20px",opacity:(extracting||!paperText.trim())?0.5:1}}>
                  {extracting?"⟳ Extracting…":"✦ Extract & Add Study"}
                </button>
              )}
            </div>
          </div>
          <InfoBox color={C.yel}>⚠️ AI extraction can misread tables and figures. Always verify every value against the source before including it.</InfoBox>
        </div>
      </div>
    )}

    {showAdd && <AddStudyModal onClose={()=>setShowAdd(false)} onAdd={addStudyObj}/>}

    {/* Toolbar */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:10,flexWrap:"wrap"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <div style={{fontSize:12,color:C.muted}}>{withES} of {studies.length} studies have an effect size</div>
        {studies.length>0&&(()=>{const e=qc.errs.length,w=qc.warns.length,d=qc.dupIds.length;
          return(<div style={{display:"flex",gap:6}}>
            {e>0&&<span style={tagS("red")}>{e} with errors</span>}
            {w>0&&<span style={tagS("yellow")}>{w} with warnings</span>}
            {d>0&&<span style={tagS("red")}>{d} possible duplicates</span>}
            {e===0&&w===0&&d===0&&<span style={tagS("green")}>✓ All checks pass</span>}
          </div>);})()}
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <div style={{display:"flex",border:`1px solid ${C.brd}`,borderRadius:6,overflow:"hidden"}}>
          {[["cards","▦ Cards"],["table","▤ Table"]].map(([v,label])=>(
            <button key={v} onClick={()=>setView(v)} style={{padding:"6px 12px",border:"none",cursor:"pointer",fontSize:11,fontWeight:600,
              background:view===v?C.acc:"transparent",color:view===v?C.accText:C.muted}}>{label}</button>
          ))}
        </div>
        {studies.length>0&&<button onClick={()=>setShowQC(!showQC)} style={{...btnS(showQC?"primary":"ghost"),fontSize:12}}>🔍 Data Quality Check</button>}
        {studies.length>0&&<button onClick={openExtractionExport} style={{...btnS("ghost"),fontSize:12}}>⤓ Export CSV</button>}
        {AI_FEATURES_ENABLED&&!readOnly&&<button onClick={()=>setShowAI(true)} style={{...btnS(),color:C.purp,borderColor:themeAlpha(C.purp,'55'),fontSize:12}}>✦ AI Extract</button>}
        {!readOnly&&<button onClick={()=>setShowAdd(true)} style={{...btnS("primary"),fontSize:12}}>+ Add Study</button>}
      </div>
    </div>

    {/* Primary-data composition bar */}
    {comp.total>0&&(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
        <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:0.5}}>DATA COMPOSITION</span>
        <div style={{flex:1,minWidth:160,display:"flex",height:8,borderRadius:4,overflow:"hidden",border:`1px solid ${C.brd}`}}>
          <div style={{width:`${comp.prim/comp.total*100}%`,background:C.grn}} title={`${comp.prim} primary`}/>
          <div style={{width:`${comp.nonPrim/comp.total*100}%`,background:C.yel}} title={`${comp.nonPrim} non-primary`}/>
        </div>
        <div style={{display:"flex",gap:12,fontSize:11}}>
          <span style={{color:C.grn}}>● {comp.prim} primary</span>
          <span style={{color:C.yel}}>● {comp.nonPrim} non-primary</span>
          {comp.conv>0&&<span style={{color:C.purp}}>⇄ {comp.conv} converted</span>}
        </div>
        {comp.nonPrim/comp.total>=0.5&&<span style={tagS("yellow")}>⚠ majority non-primary</span>}
      </div>
    )}

    {/* Filters */}
    {studies.length>1&&(
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontSize:11,color:C.muted,fontWeight:600}}>Filter:</span>
        <select value={fOutcome} onChange={e=>setFOutcome(e.target.value)} style={{...inp,width:"auto",fontSize:11,padding:"4px 8px"}}>
          <option value="">All outcomes</option>{outcomeOpts.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
        <select value={fTime} onChange={e=>setFTime(e.target.value)} style={{...inp,width:"auto",fontSize:11,padding:"4px 8px"}}>
          <option value="">All time points</option>{timeOpts.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
        <select value={fNature} onChange={e=>setFNature(e.target.value)} style={{...inp,width:"auto",fontSize:11,padding:"4px 8px"}}>
          <option value="">All data roles</option>{DATA_NATURE.map(([k,l])=><option key={k} value={k}>{l}</option>)}
        </select>
        <select value={fStatus} onChange={e=>setFStatus(e.target.value)} style={{...inp,width:"auto",fontSize:11,padding:"4px 8px"}}>
          <option value="">Any status</option>
          <option value="complete">✓ Complete</option><option value="warn">⚠ Warnings</option>
          <option value="error">✗ Errors</option><option value="review">👁 Needs review</option>
          <option value="incomplete">○ No effect size</option>
        </select>
        {filterActive&&<button onClick={()=>{setFOutcome("");setFTime("");setFNature("");setFStatus("");}} style={{...btnS("ghost"),fontSize:11,padding:"4px 10px"}}>Clear</button>}
        {filterActive&&<span style={{fontSize:11,color:C.muted}}>{filtered.length} of {studies.length}</span>}
        <select value={sortKey} onChange={e=>setSortKey(e.target.value)} style={{...inp,width:"auto",fontSize:11,padding:"4px 8px"}}>
          {EXTRACTION_SORTS.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
    )}

    {/* Data Quality Check panel */}
    {showQC&&studies.length>0&&(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700}}>🔍 Data Quality Report</div>
          <button onClick={()=>setShowQC(false)} style={{background:"none",border:"none",color:C.muted,fontSize:18,cursor:"pointer"}}>×</button>
        </div>
        {/* Poolability */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:0.5,marginBottom:8}}>CAN THESE STUDIES BE POOLED?</div>
          {qc.pool.blockers.length===0&&qc.pool.warnings.length===0&&qc.pool.ok&&
            <div style={{...tagS("green"),display:"inline-flex"}}>✓ No blocking compatibility problems detected</div>}
          {qc.pool.blockers.map((b,i)=>(
            <div key={i} style={{background:"var(--t-red-bg)",border:`1px solid ${themeAlpha(C.red,'44')}`,borderLeft:`3px solid ${C.red}`,borderRadius:6,padding:"9px 12px",marginBottom:6,fontSize:12,color:C.txt,lineHeight:1.5}}>
              <strong style={{color:C.red}}>✗ Do not pool: </strong>{b}</div>
          ))}
          {qc.pool.warnings.map((w,i)=>(
            <div key={i} style={{background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'44')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"9px 12px",marginBottom:6,fontSize:12,color:C.txt,lineHeight:1.5}}>
              <strong style={{color:C.yel}}>⚠ Caution: </strong>{w}</div>
          ))}
        </div>
        {/* Per-study issues */}
        <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:0.5,marginBottom:8}}>PER-STUDY ISSUES</div>
        {qc.rows.filter(r=>r.issues.length>0||qc.dupIds.includes(r.s.id)).length===0?
          <div style={{...tagS("green"),display:"inline-flex"}}>✓ Every study passes its field checks</div>:
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {qc.rows.map(({s,issues})=>{
              const isDup=qc.dupIds.includes(s.id);
              if(issues.length===0&&!isDup) return null;
              return(<div key={s.id} style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:"9px 12px"}}>
                <div style={{fontSize:12,fontWeight:600,marginBottom:5}}>{s.author||"Untitled"}{s.year?` (${s.year})`:""}</div>
                {isDup&&<div style={{display:"flex",gap:8,fontSize:11,color:C.muted,marginBottom:3}}><span style={{color:C.red}}>✗</span><span>Possible duplicate of another study (same author+year or identical ES & n).</span></div>}
                {issues.map((it,i)=>(<div key={i} style={{display:"flex",gap:8,fontSize:11,color:C.muted,marginBottom:3,lineHeight:1.5}}>
                  <span style={{color:it.sev==="error"?C.red:C.yel,flexShrink:0}}>{it.sev==="error"?"✗":"⚠"}</span><span>{it.msg}</span>
                </div>))}
              </div>);
            })}
          </div>}
        <InfoBox>💡 Errors (✗) are likely data-entry mistakes that will corrupt the pooled result. Warnings (⚠) are things to confirm. Fix errors before running the analysis.</InfoBox>
      </div>
    )}

    {/* Empty state */}
    {studies.length===0?(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
      <div style={{fontSize:36,marginBottom:10}}>📑</div>
      <div style={{fontSize:14,marginBottom:6}}>No studies yet</div>
      <div style={{fontSize:12,marginBottom:16}}>{AI_FEATURES_ENABLED?"Add a study by PubMed ID, DOI, or manually — or paste text / upload a PDF and let AI pre-fill a study for you to verify.":"Add a study by PubMed ID, DOI, or manually — every field stays editable and auditable."}</div>
      {!readOnly&&(
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          {AI_FEATURES_ENABLED&&<button onClick={()=>setShowAI(true)} style={{...btnS(),color:C.purp,borderColor:themeAlpha(C.purp,'55')}}>✦ AI Extract</button>}
          <button onClick={()=>setShowAdd(true)} style={btnS("primary")}>+ Add First Study</button>
        </div>
      )}
    </div>):filtered.length===0?(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:30,textAlign:"center",color:C.muted}}>
        <div style={{fontSize:13}}>No studies match the current filters.</div>
        <button onClick={()=>{setFOutcome("");setFTime("");setFNature("");setFStatus("");}} style={{...btnS("ghost"),fontSize:11,marginTop:10}}>Clear filters</button>
      </div>
    ):view==="cards"?(
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filtered.map((s,idx)=>(
          <div key={s.id} style={{display:"flex",gap:6,alignItems:"flex-start"}}>
            {sortKey==="manual"&&!readOnly&&(
              <div style={{display:"flex",flexDirection:"column",gap:2,paddingTop:8,flexShrink:0}}>
                <button onClick={()=>moveStudy(s.id,-1)} disabled={idx===0} title="Move up" style={{...btnS("ghost"),padding:"2px 6px",fontSize:11,opacity:idx===0?0.3:1}}>▲</button>
                <button onClick={()=>moveStudy(s.id,1)} disabled={idx===filtered.length-1} title="Move down" style={{...btnS("ghost"),padding:"2px 6px",fontSize:11,opacity:idx===filtered.length-1?0.3:1}}>▼</button>
              </div>
            )}
            <div style={{flex:1}}>
              <StudyCard s={s} idx={studies.indexOf(s)} updStudy={updStudy} delStudy={delStudy} dup={dup[s.id]} onClone={cloneForOutcome}/>
            </div>
          </div>
        ))}
      </div>
    ):(
      /* TABLE VIEW — quick compare & edit common fields */
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:12,overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:1240}}>
          <thead><tr>
            {[["#",30],["Author",100],["Year",50],["Design",86],["Outcome",110],["Time pt",64],["Role",92],["Adj.",90],["Source",110],["Type",58],["N",46],["ES",60],["CI Lo",60],["CI Hi",60],["Flags",96],[""]].map(([h,w],i)=>(
              <th key={i} style={{...th,textAlign:"left",minWidth:w,padding:"6px 4px"}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>{filtered.map((s)=>{
            const idx=studies.indexOf(s);
            const iss=validateStudy(s);const e=iss.filter(x=>x.sev==="error").length;const w=iss.filter(x=>x.sev==="warn").length;
            return(<tr key={s.id} style={{background:dup[s.id]?themeAlpha("var(--t-red-bg)","22"):"transparent"}}>
              <td style={{padding:"3px 4px",color:C.dim,fontFamily:"'IBM Plex Mono',monospace",borderBottom:`1px solid ${C.brd}`}}>{idx+1}</td>
              {TC(s,"author",100,"Smith J")}{TC(s,"year",50,"2024")}
              <td style={{padding:"3px 4px",borderBottom:`1px solid ${C.brd}`}}>
                <select value={s.design||"RCT"} onChange={e=>updStudy(s.id,"design",e.target.value)} style={{...inp,fontSize:11,padding:"3px 4px"}}>
                  {["RCT","Quasi-RCT","Cohort","Case-Control","Cross-Sectional","Case Series","Diagnostic"].map(d=><option key={d}>{d}</option>)}
                </select></td>
              {TC(s,"outcome",110,"HbA1c")}{TC(s,"timepoint",64,"12 wk")}
              <td style={{padding:"3px 4px",borderBottom:`1px solid ${C.brd}`}}>
                <select value={s.dataNature||"primary"} onChange={e=>updStudy(s.id,"dataNature",e.target.value)} style={{...inp,fontSize:11,padding:"3px 4px"}}>
                  {DATA_NATURE.map(([k,l])=><option key={k} value={k}>{l.split(" ")[0]}</option>)}
                </select></td>
              <td style={{padding:"3px 4px",borderBottom:`1px solid ${C.brd}`}}>
                <select value={s.adjusted||"unadjusted"} onChange={e=>updStudy(s.id,"adjusted",e.target.value)} style={{...inp,fontSize:11,padding:"3px 4px"}}>
                  {ADJUST_OPTIONS.map(([k,l])=><option key={k} value={k}>{l.split(" ")[0]}</option>)}
                </select></td>
              <td style={{padding:"3px 4px",borderBottom:`1px solid ${C.brd}`}}>
                <select value={s.source||""} onChange={e=>updStudy(s.id,"source",e.target.value)} style={{...inp,fontSize:11,padding:"3px 4px"}}>
                  {SOURCE_OPTIONS.map(([k,l])=><option key={k} value={k}>{k?l.split(" ").slice(0,2).join(" "):"—"}</option>)}
                </select></td>
              <td style={{padding:"3px 4px",borderBottom:`1px solid ${C.brd}`}}>
                <select value={s.esType||""} onChange={e=>updStudy(s.id,"esType",e.target.value)} style={{...inp,fontSize:11,padding:"3px 4px"}}>
                  <option value="">—</option>{Object.keys(ES_TYPES).map(t=><option key={t} value={t}>{ES_TYPES[t].scale}</option>)}
                </select></td>
              {TC(s,"n",46,"")}{TC(s,"es",60,"")}{TC(s,"lo",60,"")}{TC(s,"hi",60,"")}
              <td style={{padding:"3px 4px",borderBottom:`1px solid ${C.brd}`,whiteSpace:"nowrap"}}>
                {dup[s.id]&&<span title="Possible duplicate" style={{color:C.red,marginRight:3}}>⎘</span>}
                {s.converted&&<span title="Converted value" style={{color:C.purp,marginRight:3}}>⇄</span>}
                {isNonPrimary(s)&&!s.converted&&<span title="Non-primary data" style={{color:C.yel,marginRight:3}}>◆</span>}
                {s.needsReview&&<span title="Needs review" style={{color:C.yel,marginRight:3}}>👁</span>}
                {e>0?<span style={{color:C.red,fontWeight:700}}>✗{e}</span>:w>0?<span style={{color:C.yel}}>⚠{w}</span>:s.es!==""?<span style={{color:C.grn}}>✓</span>:<span style={{color:C.dim}}>–</span>}
              </td>
              <td style={{padding:"3px 4px",borderBottom:`1px solid ${C.brd}`,textAlign:"right"}}>
                <button onClick={()=>delStudy(s.id)} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:14}}>×</button>
              </td>
            </tr>);
          })}</tbody>
        </table>
        <div style={{marginTop:10,fontSize:11,color:C.muted}}>Editing here updates the same studies as the card view. For raw 2×2 / mean-SD entry, the effect-size calculator, conversions, reliability flags, and citation metadata, switch to <strong>Cards</strong> and expand a study.</div>
      </div>
    )}
  </div>);
}

/* ════════════ TAB: RISK OF BIAS ════════════ */
/* prompt28 Part 2 — dispatcher. When the rob_engine_v2 flag is ON, the project's
   Risk of Bias tab IS the new standalone RoB 2 engine, scoped to the currently
   open project (no project selector, no leaving the workspace). When the flag is
   OFF, the original lightweight per-study table (LegacyRoBTab) is preserved so
   nothing breaks for projects/orgs that have not enabled the engine. */
function RoBTab({project,updateProject,activeId,setTab,onWorkspaceChange}){
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

function LegacyRoBTab({project,updateProject,activeId}){
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

/* ════════════ TAB: ANALYSIS ════════════ */
/* Build a researcher-facing interpretation of a pooled result */
/* interpretResult extracted VERBATIM to src/frontend/workspace/projectHelpers.js
   (prompt46 Phase 6a) and imported at the top of this file. */

function AnalysisTab({project,updateProject,onApplyPrecisionToAll}){
  const{studies}=project;
  const[method,setMethod]=useState("random");
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
  const result=useMemo(()=>runMeta(filteredStudies,method),[filteredStudies,method]);
  const valid=filteredStudies;
  const esType=useMemo(()=>{
    const types=valid.map(s=>s.esType).filter(Boolean);
    return types.length?types.sort((a,b)=>types.filter(t=>t===b).length-types.filter(t=>t===a).length)[0]:"";
  },[valid]);
  const prec = project?.analysisPrecision;
  const interp=useMemo(()=>interpretResult(result,esType,filteredStudies,prec),[result,esType,filteredStudies,prec]);
  const typeWarn=useMemo(()=>analysisTypeWarnings(filteredStudies),[filteredStudies]);
  const methodLabel=method==="random"?"Random-effects (DerSimonian–Laird)":"Fixed-effect (inverse-variance)";

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
          const r=runMeta(subset,method);
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
          <Cell title="RANDOM EFFECTS (DerSimonian–Laird)" o={result.random} active={method==="random"}/>
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
            <div style={{fontWeight:700,color:C.txt}}>Weighting</div><div>{method==="random"?"Inverse-variance weights with τ² (DerSimonian–Laird method-of-moments) added to each study's variance.":"Inverse-variance weights (1/SE²)."} SE derived from each 95% CI as (upper − lower) / (2 × 1.96).</div>
            <div style={{fontWeight:700,color:C.txt}}>Heterogeneity</div><div>Cochran's Q = Σwᵢ(yᵢ − ȳ)²; I² = max(0, (Q − df)/Q) × 100; τ² = max(0, (Q − df)/(ΣW − ΣW²/ΣW)).</div>
            <div style={{fontWeight:700,color:C.txt}}>Significance</div><div>z = pooled ES / SE; two-sided p from the standard normal distribution.</div>
            <div style={{fontWeight:700,color:C.txt}}>Transforms</div><div>{esType&&ES_TYPES[esType]?.log?"Ratio measures are pooled on the natural-log scale and back-transformed for display.":esType==="PROP"?"Proportions are pooled on the logit scale and back-transformed.":esType==="COR"?"Correlations are pooled as Fisher's z.":"No transform applied to the stored effect sizes."}</div>
            <div style={{fontWeight:700,color:C.txt}}>Excluded</div><div>{studies.length-result.k} of {studies.length} studies not in this pool ({studies.filter(s=>s.es==="").length} without an effect size{valid.length>result.k?", plus those missing a CI":""}).</div>
          </div>
          <InfoBox color={C.dim}>Computation runs locally in your browser. For a regulatory submission, confirm key results in established software (R <em>metafor</em>, RevMan, or Stata). The DerSimonian–Laird estimator can underestimate uncertainty when k is small — consider this a planning/checking tool.</InfoBox>
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
function DataBehindAnalysis({result,studies,esType,prec}){
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
function ResearchExport({result,esType,method,studies,prec}){
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
    `${esc("Model reported")},${esc(method==="fixed"?"Fixed/common effect":"Random effects (DerSimonian-Laird)")}`,
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
  const csv="\ufeff"+[csvHead.join(","),...csvRows].join("\n")+"\n"+meta;

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
        <strong style={{color:C.txt}}>Model:</strong> {method==="fixed"?"Fixed/common effect":"Random effects (DerSimonian–Laird)"} · <strong style={{color:C.txt}}>Transformation:</strong> {transform}<br/>
        <strong style={{color:C.txt}}>Heterogeneity:</strong> I² = {result.I2}% · τ² = {result.tau2} · Q = {result.Q} (df = {result.k-1}, p {result.Qpval<0.001?"< 0.001":"= "+result.Qpval}) · overall p {result.pval<0.001?"< 0.001":"= "+result.pval}
      </div>
    </div>)}
    <InfoBox color={C.dim}>Both the common (fixed) and random-effects pooled estimates are included so reviewers can see model sensitivity. The CSV also stores analysis-scale (e.g. log) values for full reproducibility.</InfoBox>
  </div>);
}

/* Copyable manuscript-ready text blocks derived from the analysis */
function ResultsWriteup({result,interp,esType,method,methodLabel,studies,prec}){
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

  const methods=`A ${method==="random"?"random-effects":"fixed-effect"} meta-analysis was performed using the ${method==="random"?"DerSimonian and Laird method":"inverse-variance method"}. Effect sizes were expressed as the ${measureName.toLowerCase()}${ES_TYPES[esType]?.log?", pooled on the natural-logarithmic scale and back-transformed for presentation":""}. Standard errors were derived from reported 95% confidence intervals. Statistical heterogeneity was quantified with the I² statistic and Cochran's Q test, with τ² estimating between-study variance.${result.hksj?" Confidence intervals for the random-effects estimate were additionally calculated using the Hartung-Knapp-Sidik-Jonkman (HKSJ) method, which is recommended when the number of studies is small.":""}${result.predInt?" A 95% prediction interval was calculated to describe the likely range of the true effect in a future study.":""} A two-sided P < 0.05 was considered statistically significant. [State software here — e.g. analyses were verified in R using the metafor package.]`;

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
          <div style={{fontSize:12.5,color:C.txt,lineHeight:1.7,fontFamily:"Georgia,serif"}}>{b.text}</div>
        </div>
      ))}
    </div>
  </div>);
}

/* ════════════ TAB: FOREST PLOT ════════════ */
/* Build a STANDALONE, publication-style forest plot SVG string (white bg, black text,
   serif type, full columns). Independent of the dark on-screen plot — this is what gets
   exported for manuscripts/posters. */
/* buildPubForestSVG extracted VERBATIM to
   src/frontend/workspace/charts/svgBuilders.js (prompt46 Phase 4) and imported
   at the top of this file. */

/* Forest-plot downloads (publication white + live dark) now route through the
   shared ExportDialog — see the export panel in ForestTab and ResearchExport.
   The dark variant serializes the live #forestplot-svg via liveSvgToString. */

function ForestTab({project}){
  const{studies}=project;
  const{theme}=useTheme(); // prompt19 — live forest plot follows day/night
  const[method,setMethod]=useState("random");
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
  const result=useMemo(()=>runMeta(filteredStudies,method),[filteredStudies,method]);
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

/* ════════════ TAB: REPORTING CHECKLIST ════════════ */
function ReportTab({project,upd}){
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

/* ════════════ TAB: MeSH GENERATOR ════════════ */
function CombinedDBView({results,selectedDBs,onCopy,copied,onSave}){
  const[view,setView]=useState("queries");
  const views=[
    {id:"queries",label:"Side-by-side Queries",icon:"📋"},
    {id:"export",label:"Export All",icon:"📥"},
    {id:"matrix",label:"Coverage Matrix",icon:"📊"},
  ];
  // Build combined export text
  const exportAll=()=>{
    const blocks=selectedDBs.map(function(id){
      const db=MESH_DBS.find(function(d){return d.id===id;});
      const r=results[id];
      return [
        "═══════════════════════════════════════════════════════",
        `${db.label.toUpperCase()} — ${db.syntax}`,
        "═══════════════════════════════════════════════════════",
        "",
        "▸ BROAD QUERY:",
        r.broad_query||"(none)",
        "",
        "▸ NARROW QUERY:",
        r.narrow_query||"(none)",
        "",
        r.filters&&r.filters.length>0?"▸ RECOMMENDED FILTERS:":"",
        r.filters?r.filters.map(function(f){return "  • "+f.name+": "+f.clause;}).join("\n"):"",
        ""
      ].filter(function(l){return l!==null&&l!==undefined;}).join("\n");
    }).join("\n\n");
    return blocks;
  };
  const fullExport=exportAll();
  return(<div>
    <div style={{display:"flex",borderBottom:`1px solid ${C.brd}`,overflowX:"auto"}}>
      {views.map(v=>{const on=view===v.id;return(
        <button key={v.id} onClick={()=>setView(v.id)} style={{padding:"9px 14px",border:"none",cursor:"pointer",fontSize:11,
          fontFamily:"'IBM Plex Sans',sans-serif",whiteSpace:"nowrap",background:on?C.bg:"transparent",fontWeight:on?700:400,
          color:on?C.acc:C.muted,borderBottom:on?`2px solid ${C.acc}`:"2px solid transparent",transition:"all 0.1s"}}>
          {v.icon} {v.label}
        </button>);})}
    </div>
    <div style={{padding:18}}>
      {view==="queries"&&(<div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{fontSize:12,color:C.muted,lineHeight:1.6}}>
          All {selectedDBs.length} database broad queries side by side. Quickly compare, copy any, or save to your Search Strategy log.
        </div>
        {selectedDBs.map(function(id){
          const db=MESH_DBS.find(function(d){return d.id===id;});
          const r=results[id];
          const str=r.broad_query||"";
          return(<div key={id} style={{background:C.bg,border:`1px solid ${C.brd}`,borderLeft:`4px solid ${db.color}`,borderRadius:6,padding:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:10,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:db.color}}>{db.label}</div>
                <div style={{fontSize:10,color:C.dim,marginTop:2,fontFamily:"'IBM Plex Mono',monospace"}}>{db.syntax} · {str?str.trim().split(/\s+/).length+" words":"empty"}</div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>onCopy(str,"combined_"+id)} disabled={!str} style={{...btnS("ghost"),fontSize:10,padding:"3px 10px",opacity:str?1:0.4}}>{copied===("combined_"+id)?"✓ Copied":"📋 Copy"}</button>
                <button onClick={()=>onSave(str)} disabled={!str} style={{...btnS(),fontSize:10,padding:"3px 10px",opacity:str?1:0.4}}>→ Save</button>
              </div>
            </div>
            <pre style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,lineHeight:1.7,color:C.txt,whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0,padding:"8px 10px",background:C.surf,borderRadius:4,maxHeight:200,overflowY:"auto",border:`1px solid ${C.brd}`}}>{str||"(no query generated)"}</pre>
          </div>);
        })}
      </div>)}
      {view==="export"&&(<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:10,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:C.acc,marginBottom:3}}>Complete Multi-Database Export</div>
            <div style={{fontSize:11,color:C.muted}}>All {selectedDBs.length} databases formatted for documentation, supplementary material, or your protocol.</div>
          </div>
          <button onClick={()=>onCopy(fullExport,"export_all")} style={{...btnS("primary"),fontSize:11}}>
            {copied==="export_all"?"✓ Copied all":"📋 Copy Everything"}
          </button>
        </div>
        <pre style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:16,fontFamily:"'IBM Plex Mono',monospace",
          fontSize:11,lineHeight:1.7,color:C.txt,whiteSpace:"pre-wrap",wordBreak:"break-word",maxHeight:520,overflowY:"auto",margin:0}}>{fullExport}</pre>
      </>)}
      {view==="matrix"&&(<>
        <div style={{fontSize:12,color:C.muted,marginBottom:14,lineHeight:1.6}}>
          What does each database give you? At a glance, see which sections were generated and how rich each strategy is.
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead>
              <tr>
                <th style={{...th,textAlign:"left",minWidth:140}}>Database</th>
                {["Broad","Narrow","Concepts","Controlled","Free-Text","Filters","To Avoid","Validation","Tradeoff","Notes","Secondary"].map(function(h){
                  return <th key={h} style={{...th,minWidth:64}}>{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {selectedDBs.map(function(id){
                const db=MESH_DBS.find(function(d){return d.id===id;});
                const r=results[id];
                const cells=[
                  r.broad_query?"yes":"",
                  r.narrow_query?"yes":"",
                  (r.concept_blocks||[]).length||"",
                  (r.controlled_terms||r.mesh_terms||[]).length||"",
                  (r.free_text_terms||r.tiab_terms||[]).length||"",
                  (r.filters||[]).length||"",
                  (r.terms_to_avoid||[]).length||"",
                  r.validation?"yes":"",
                  r.tradeoff?"yes":"",
                  r.improvements?"yes":"",
                  (r.secondary_searches||[]).length||"",
                ];
                return(<tr key={id} style={{borderBottom:`1px solid ${C.brd}`}}>
                  <td style={{padding:"8px 10px",fontWeight:600,color:db.color}}>{db.label}</td>
                  {cells.map(function(c,i){
                    const present = c==="yes" || (typeof c==="number" && c>0);
                    return(<td key={i} style={{padding:"8px 6px",textAlign:"center",fontFamily:"'IBM Plex Mono',monospace",color:present?C.grn:C.dim,fontWeight:present?700:400}}>
                      {c==="yes"?"✓":(c===""?"—":c)}
                    </td>);
                  })}
                </tr>);
              })}
            </tbody>
          </table>
        </div>
      </>)}
    </div>
  </div>);
}

function ExpertDBResult({db,r,copied,onCopy,onSave}){
  const[section,setSection]=useState("broad");
  // Backward compatibility
  const ctrlTerms = r.controlled_terms || r.mesh_terms || [];
  const freeTerms = r.free_text_terms || r.tiab_terms || [];
  const concepts = r.concept_blocks || [];
  const filters = r.filters || [];

  const sections=[
    {id:"broad",label:"Broad",icon:"🔍"},
    {id:"narrow",label:"Narrow",icon:"🎯"},
    {id:"concepts",label:"Concept Blocks",icon:"🧩",count:concepts.length},
    {id:"terms",label:"Vocabulary",icon:"🏷️",count:ctrlTerms.length+freeTerms.length},
    {id:"filters",label:"Filters",icon:"🎚️",count:filters.length},
    {id:"avoid",label:"Avoid",icon:"⚠️",count:(r.terms_to_avoid||[]).length},
    {id:"validation",label:"Validation",icon:"✅"},
    {id:"tradeoff",label:"Tradeoff",icon:"⚖️"},
    {id:"improvements",label:"Notes",icon:"💡"},
    {id:"secondary",label:"Secondary",icon:"🔗",count:(r.secondary_searches||[]).length},
  ];

  // helper: copy a single term/clause to clipboard with a unique key
  const copyTerm = (text, key) => onCopy(text, key);

  return(<div>
    <div style={{display:"flex",borderBottom:`1px solid ${C.brd}`,overflowX:"auto",marginBottom:0}}>
      {sections.map(s=>{const on=section===s.id;return(
        <button key={s.id} onClick={()=>setSection(s.id)} style={{padding:"9px 12px",border:"none",cursor:"pointer",fontSize:11,
          fontFamily:"'IBM Plex Sans',sans-serif",whiteSpace:"nowrap",background:on?C.bg:"transparent",fontWeight:on?700:400,
          color:on?db.color:C.muted,borderBottom:on?`2px solid ${db.color}`:"2px solid transparent",transition:"all 0.1s",display:"flex",alignItems:"center",gap:5}}>
          <span>{s.icon}</span><span>{s.label}</span>
          {s.count>0&&<span style={{fontSize:9,background:on?db.color+"30":C.brd,color:on?db.color:C.dim,padding:"1px 6px",borderRadius:8,fontWeight:700}}>{s.count}</span>}
        </button>);})}
    </div>
    <div style={{padding:18}}>
      {/* BROAD / NARROW */}
      {(section==="broad"||section==="narrow")&&(()=>{
        const key=section==="broad"?"broad_query":"narrow_query";
        const str=r[key]||"";
        const wc = str ? str.trim().split(/\s+/).length : 0;
        return(<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,gap:14,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:200}}>
              <div style={{fontSize:14,fontWeight:700,color:db.color,marginBottom:3}}>
                {section==="broad"?`High-Sensitivity Broad Query`:`Narrow / Specific Query`}
              </div>
              <div style={{fontSize:11,color:C.muted,lineHeight:1.5}}>
                {section==="broad"?`Primary search — maximises recall.`:`For validation or higher precision.`} Native syntax: <span style={{fontFamily:"'IBM Plex Mono',monospace",color:C.txt}}>{db.syntax}</span>
              </div>
              {str&&<div style={{fontSize:10,color:C.dim,marginTop:5,fontFamily:"'IBM Plex Mono',monospace"}}>{wc} words · {str.length} chars</div>}
            </div>
            <div style={{display:"flex",gap:8,flexShrink:0}}>
              <button onClick={()=>copyTerm(str,key+"_"+db.id)} disabled={!str} style={{...btnS("ghost"),fontSize:11,opacity:str?1:0.4}}>{copied===(key+"_"+db.id)?"✓ Copied":"📋 Copy"}</button>
              <button onClick={()=>onSave(str)} disabled={!str} style={{...btnS(),fontSize:11,opacity:str?1:0.4}}>→ Save to Search Strategy</button>
            </div>
          </div>
          <pre style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:16,fontFamily:"'IBM Plex Mono',monospace",
            fontSize:11.5,lineHeight:1.85,color:C.txt,whiteSpace:"pre-wrap",wordBreak:"break-word",maxHeight:440,overflowY:"auto",margin:0}}>{str||"(no query generated)"}</pre>
        </>);
      })()}

      {/* CONCEPT BLOCKS */}
      {section==="concepts"&&(<>
        <div style={{fontSize:12,color:C.muted,marginBottom:14,lineHeight:1.6}}>
          The broad query decomposed into PICO + Design concept blocks. Each block can be edited or removed independently when refining your strategy.
        </div>
        {concepts.length===0?<div style={{fontSize:12,color:C.dim,padding:30,textAlign:"center"}}>No concept breakdown generated</div>:
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {concepts.map((cb,i)=>(
            <div key={i} style={{background:C.bg,border:`1px solid ${C.brd}`,borderLeft:`4px solid ${cb.color}`,borderRadius:6,padding:"12px 14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6,gap:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:18,fontWeight:800,color:cb.color,fontFamily:"'IBM Plex Mono',monospace",width:22,textAlign:"center"}}>{cb.code}</span>
                  <span style={{fontSize:12,fontWeight:700,color:cb.color}}>{cb.label}</span>
                </div>
                <button onClick={()=>copyTerm(cb.clause,"concept_"+i+"_"+db.id)} style={{...btnS("ghost"),fontSize:10,padding:"2px 8px"}}>{copied===("concept_"+i+"_"+db.id)?"✓":"Copy"}</button>
              </div>
              <pre style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,lineHeight:1.7,color:C.txt,whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0}}>{cb.clause}</pre>
            </div>
          ))}
        </div>}
      </>)}

      {/* VOCABULARY (controlled + free text side by side) */}
      {section==="terms"&&(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:db.color,letterSpacing:0.6}}>{db.controlled.toUpperCase()}</div>
            <span style={{fontSize:10,color:C.dim,fontFamily:"'IBM Plex Mono',monospace"}}>{ctrlTerms.length}</span>
          </div>
          {ctrlTerms.length===0?<div style={{fontSize:11,color:C.dim}}>None specified</div>:
          ctrlTerms.map((t,i)=>(
            <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"5px 0",borderBottom:i<ctrlTerms.length-1?`1px solid ${C.brd}`:"none"}}>
              <span style={{color:db.color,fontSize:11,marginTop:1,flexShrink:0}}>▸</span>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:C.txt,lineHeight:1.5,flex:1,wordBreak:"break-word"}}>{t}</span>
              <button onClick={()=>copyTerm(t,"ctrl_"+i+"_"+db.id)} style={{background:"none",border:"none",cursor:"pointer",color:C.dim,fontSize:10,padding:"0 2px"}}>{copied===("ctrl_"+i+"_"+db.id)?"✓":"⧉"}</button>
            </div>
          ))}
        </div>
        <div style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:C.grn,letterSpacing:0.6}}>{db.freeText.toUpperCase()}</div>
            <span style={{fontSize:10,color:C.dim,fontFamily:"'IBM Plex Mono',monospace"}}>{freeTerms.length}</span>
          </div>
          {freeTerms.length===0?<div style={{fontSize:11,color:C.dim}}>None specified</div>:
          freeTerms.map((t,i)=>(
            <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"5px 0",borderBottom:i<freeTerms.length-1?`1px solid ${C.brd}`:"none"}}>
              <span style={{color:C.grn,fontSize:11,marginTop:1,flexShrink:0}}>▸</span>
              <span style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:C.txt,lineHeight:1.5,flex:1,wordBreak:"break-word"}}>{t}</span>
              <button onClick={()=>copyTerm(t,"free_"+i+"_"+db.id)} style={{background:"none",border:"none",cursor:"pointer",color:C.dim,fontSize:10,padding:"0 2px"}}>{copied===("free_"+i+"_"+db.id)?"✓":"⧉"}</button>
            </div>
          ))}
        </div>
      </div>)}

      {/* FILTERS */}
      {section==="filters"&&(<>
        <div style={{fontSize:12,color:C.muted,marginBottom:14,lineHeight:1.6}}>
          Recommended filters to apply on top of the broad query. Each filter shows the native-syntax clause and when it's appropriate.
        </div>
        {filters.length===0?<div style={{fontSize:12,color:C.dim,padding:30,textAlign:"center"}}>No filters generated</div>:
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {filters.map((f,i)=>(
            <div key={i} style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:"12px 14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:6}}>
                <div style={{fontSize:12,fontWeight:700,color:db.color}}>{f.name}</div>
                <button onClick={()=>copyTerm(f.clause,"filter_"+i+"_"+db.id)} style={{...btnS("ghost"),fontSize:10,padding:"2px 8px"}}>{copied===("filter_"+i+"_"+db.id)?"✓":"Copy"}</button>
              </div>
              <pre style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:11,lineHeight:1.6,color:C.txt,whiteSpace:"pre-wrap",wordBreak:"break-word",margin:"4px 0 8px",padding:"6px 10px",background:C.surf,borderRadius:4,border:`1px solid ${C.brd}`}}>{f.clause}</pre>
              {f.when&&<div style={{fontSize:11,color:C.muted,lineHeight:1.5,fontStyle:"italic"}}>When to use: {f.when}</div>}
            </div>
          ))}
        </div>}
      </>)}

      {/* TERMS TO AVOID */}
      {section==="avoid"&&(<div style={{display:"flex",flexDirection:"column",gap:8}}>
        <div style={{fontSize:12,color:C.muted,marginBottom:4}}>Problematic terms, abbreviations, or constructs that hurt retrieval in {db.label}:</div>
        {(r.terms_to_avoid||[]).map((t,i)=>(
          <div key={i} style={{background:C.bg,border:`1px solid ${themeAlpha(C.red,'33')}`,borderLeft:`3px solid ${C.red}`,borderRadius:6,padding:"10px 14px"}}>
            <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:12,color:C.red,fontWeight:700,marginBottom:4}}>{t.term}</div>
            <div style={{fontSize:12,color:C.muted,lineHeight:1.5}}>{t.reason}</div>
          </div>
        ))}
        {(!r.terms_to_avoid||r.terms_to_avoid.length===0)&&<div style={{fontSize:12,color:C.dim,padding:20,textAlign:"center"}}>No problematic terms identified</div>}
      </div>)}

      {/* VALIDATION */}
      {section==="validation"&&(<>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <span style={{fontSize:14}}>✅</span>
          <div style={{fontSize:13,fontWeight:700,color:C.grn}}>Sanity-Check Papers</div>
        </div>
        <div style={{fontSize:12,color:C.muted,marginBottom:12,lineHeight:1.6}}>
          Papers your search SHOULD retrieve. After running the broad query, verify these appear in the results. If any are missing, refine the search.
        </div>
        <div style={{background:C.bg,border:`1px solid ${C.brd}`,borderLeft:`3px solid ${C.grn}`,borderRadius:6,padding:"14px 16px",lineHeight:1.7,fontSize:13,color:C.txt,whiteSpace:"pre-wrap"}}>{r.validation||"No validation papers suggested."}</div>
      </>)}

      {/* TRADEOFF */}
      {section==="tradeoff"&&(<>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <span style={{fontSize:14}}>⚖️</span>
          <div style={{fontSize:13,fontWeight:700,color:C.yel}}>Sensitivity vs Precision</div>
        </div>
        <div style={{background:C.bg,border:`1px solid ${C.brd}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"14px 16px",lineHeight:1.7,fontSize:13,color:C.txt,whiteSpace:"pre-wrap"}}>{r.tradeoff||"No tradeoff analysis provided."}</div>
      </>)}

      {/* IMPROVEMENTS */}
      {section==="improvements"&&(<>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <span style={{fontSize:14}}>💡</span>
          <div style={{fontSize:13,fontWeight:700,color:db.color}}>Design Decisions & Notes</div>
        </div>
        <div style={{background:C.bg,border:`1px solid ${C.brd}`,borderLeft:`3px solid ${db.color}`,borderRadius:6,padding:"14px 16px",lineHeight:1.75,fontSize:13,color:C.txt,whiteSpace:"pre-wrap"}}>{r.improvements||"No improvements noted."}</div>
      </>)}

      {/* SECONDARY */}
      {section==="secondary"&&(<div style={{display:"flex",flexDirection:"column",gap:8}}>
        <div style={{fontSize:12,color:C.muted,marginBottom:4}}>Citation chasing, supplementary searches, and grey literature for {db.label}:</div>
        {(r.secondary_searches||[]).map((s,i)=>(
          <div key={i} style={{background:C.bg,border:`1px solid ${C.brd}`,borderLeft:`3px solid ${C.purp}`,borderRadius:6,padding:"10px 14px"}}>
            <div style={{fontSize:12,color:C.txt,lineHeight:1.6}}>{s}</div>
          </div>
        ))}
        {(!r.secondary_searches||r.secondary_searches.length===0)&&<div style={{fontSize:12,color:C.dim,padding:20,textAlign:"center"}}>No secondary strategies generated</div>}
      </div>)}
    </div>
  </div>);
}
function MeSHTab({project,updNested,upd}){
  const{pico,search}=project;
  const persisted = project.mesh || {};
  // Persistent state (survives tab switches)
  const selectedDBs = persisted.selectedDBs || ["pubmed","embase","cochrane","wos","scopus"];
  const extra = persisted.extra || "";
  const results = persisted.results || null;
  const sourceKey = persisted.sourceKey || "";
  // Transient UI state (lost on tab switch — fine, it's just toggles)
  const[loading,setLoading]=useState(false);
  const[progress,setProgress]=useState({done:0,total:0});
  const[error,setError]=useState("");
  const[activeDB,setActiveDB]=useState(persisted.activeDB||"pubmed");
  const[copied,setCopied]=useState("");

  const hasPICO=pico.P||pico.I||pico.C||pico.O;
  // Detect if PICO changed since last generation
  const currentSourceKey = [pico.P,pico.I,pico.C,pico.O,pico.studyDesign,pico.keywords,extra,selectedDBs.join(",")].join("|");
  const picoChangedSinceGen = sourceKey && sourceKey !== currentSourceKey && results;

  // Save to project (debounced via the global save())
  const saveMesh = (patch) => upd("mesh", {...persisted, ...patch});
  const setSelectedDBs = (newDBs) => saveMesh({selectedDBs: newDBs});
  const setExtra = (v) => saveMesh({extra: v});
  const setResults = (v) => saveMesh({results: v});
  const setActiveDBPersist = (v) => { setActiveDB(v); saveMesh({activeDB: v}); };
  const toggleDB = id => setSelectedDBs(selectedDBs.includes(id)?selectedDBs.filter(x=>x!==id):[...selectedDBs,id]);

  const rawResponse = persisted.rawResponse || "";
  const setRawResponse = (v) => saveMesh({rawResponse: v});
  const [showRaw, setShowRaw] = useState(false);
  const [testResult, setTestResult] = useState("");

  const generate=async()=>{
    if(!hasPICO){setError("Fill in at least one PICO field first.");return;}
    setLoading(true);setError("");setResults(null);setRawResponse("");
    setProgress({done:0,total:selectedDBs.length});
    const picoText=[pico.P&&`Population: ${pico.P}`,pico.I&&`Intervention: ${pico.I}`,pico.C&&`Comparator: ${pico.C}`,
      pico.O&&`Outcome: ${pico.O}`,pico.studyDesign&&`Study design: ${pico.studyDesign}`,
      pico.keywords&&`Known key terms: ${pico.keywords}`,extra&&`Additional context: ${extra}`].filter(Boolean).join("\n");

    // Build a FOCUSED prompt for a SINGLE database (smaller, higher-quality, parallelisable)
    const buildDBPrompt=(db)=>{
      const key=db.id.toUpperCase();
      const designNote=pico.studyDesign?`The review targets ${pico.studyDesign} studies — build the D block accordingly (e.g. an RCT filter for RCTs; for observational designs use an appropriate cohort/case-control filter or omit a restrictive design filter to protect sensitivity).`:`No study design specified — keep any design filter minimal to protect sensitivity.`;
      const compNote=pico.C?`A comparator is specified; include a C block only if it genuinely improves precision (often the C concept is better left unsearched in high-sensitivity strategies).`:`No comparator specified — do NOT invent a C block.`;
      return `You are an expert medical librarian and systematic review search strategist. Build a HIGH-SENSITIVITY ${db.label} search optimised for real-world retrieval, not theoretical Boolean perfection. Favour recall; do not over-restrict with AND blocks or force controlled vocabulary onto recent (un-indexed) papers. ${designNote} ${compNote}

=== ${db.label.toUpperCase()} SYNTAX ===
Native syntax: ${db.syntax}
Controlled vocabulary: ${db.controlled}
Free-text fields: ${db.freeText}
Database-specific guidance: ${db.guidance}

=== SYSTEMATIC REVIEW PICO ===
${picoText}

Output ONLY the sections below. Each starts with ## on its own line. Plain text — NO JSON, NO code fences, NO surrounding quotes. Write real ${db.label} native-syntax clauses, not descriptions. Combine concept blocks with AND, synonyms within a block with OR.

## ${key}_BROAD
[Complete copy-paste-ready high-sensitivity ${db.label} query using ${db.syntax}. Multi-line OK.]

## ${key}_NARROW
[More specific/precise version. End with one sentence stating the trade-off made.]

## ${key}_CONCEPT_BLOCKS
P | [native-syntax clause for Population]
I | [native-syntax clause for Intervention]
C | [clause for Comparator — omit line if not applicable]
O | [clause for Outcome — omit if intentionally not searched]
D | [study-design / publication-type filter clause]

## ${key}_CONTROLLED_TERMS
- exact field-tagged ${db.controlled} term (e.g., "diabetes mellitus, type 2"[MeSH Terms])
- ...

## ${key}_FREE_TEXT_TERMS
- field-tagged free-text term incl. synonyms, US/UK spellings, abbreviations, plurals/wildcards
- ...

## ${key}_FILTERS
- FILTER_NAME | clause | when to apply
[3-6 filters, pipe-separated.]

## ${key}_TERMS_TO_AVOID
- TERM | why it hurts retrieval in ${db.label}
[Database-specific pitfalls; ambiguous abbreviations.]

## ${key}_VALIDATION
[2-4 seminal papers this search SHOULD retrieve as a sanity check, author/year if known. If unknown, describe the must-retrieve paper characteristics.]

## ${key}_TRADEOFF
[2-3 sentences: sensitivity-vs-precision for THIS search; qualitative hit volume (hundreds/thousands/tens of thousands) and expected screening load.]

## ${key}_IMPROVEMENTS
[Key ${db.label}-specific design decisions: controlled-vocab choices, field tags, broad-vs-narrow, quirks, ambiguous abbreviations.]

## ${key}_SECONDARY_SEARCHES
- citation chasing using ${db.label} features
- forward/backward citation if supported
- hand-search journals / contact experts
- relevant grey-literature sources`;
    };

    const parseDB=(text,id)=>{
      const key=id.toLowerCase();
      const sections=parseSections(text);
      return {
        broad_query: sections[key+"_broad"]||"",
        narrow_query: sections[key+"_narrow"]||"",
        concept_blocks: parseConceptBlocks(sections[key+"_concept_blocks"]),
        controlled_terms: parseBullets(sections[key+"_controlled_terms"]),
        free_text_terms: parseBullets(sections[key+"_free_text_terms"]),
        filters: parseFilters(sections[key+"_filters"]),
        terms_to_avoid: parseTermReasons(sections[key+"_terms_to_avoid"]),
        validation: sections[key+"_validation"]||"",
        tradeoff: sections[key+"_tradeoff"]||"",
        improvements: sections[key+"_improvements"]||"",
        secondary_searches: parseBullets(sections[key+"_secondary_searches"]),
      };
    };

    try {
      const out={};
      const rawParts=[];
      let done=0;
      // Fan out with a concurrency cap (avoid sandbox rate limits with many DBs).
      // Each call is small and focused → complete, accurate sections instead of truncation.
      const ids=[...selectedDBs];
      const failedReasons=[];
      const runOne=async(id)=>{
        const db=MESH_DBS.find(d=>d.id===id);
        try{
          const text=await callClaude(buildDBPrompt(db),2500);
          rawParts.push(`===== ${db.label} =====\n`+text);
          out[id]=parseDB(text,id);
        }catch(e){ failedReasons.push(e?.message||String(e)); }
        done++; setProgress({done,total:selectedDBs.length});
      };
      // Sequential with a gap between calls — avoids rate-limit 429s that happen
      // when multiple large requests fire simultaneously.
      for(let qi=0; qi<ids.length; qi++){
        await runOne(ids[qi]);
        if(qi<ids.length-1) await new Promise(res=>setTimeout(res,2000));
      }

      // Verify we got content for at least one DB
      let totalContent=0;
      Object.keys(out).forEach(k=>{ if(out[k].broad_query||out[k].narrow_query) totalContent++; });
      if(totalContent===0){
        const reason=failedReasons.length?failedReasons[0]:"no recognisable sections returned";
        throw new Error("No database returned a usable strategy ("+reason+"). Click 'Show raw response' to inspect.");
      }
      setRawResponse(rawParts.join("\n\n"));
      const failedCount=selectedDBs.length-Object.keys(out).filter(k=>out[k].broad_query||out[k].narrow_query).length;
      if(failedCount>0) setError(`${failedCount} of ${selectedDBs.length} databases didn't return a usable strategy; showing the rest. Click Regenerate to retry.`);
      saveMesh({results: out, sourceKey: currentSourceKey, rawResponse: rawParts.join("\n\n"), activeDB: "__combined__", generatedAt: new Date().toISOString()});
      setActiveDB("__combined__");
    } catch(e){
      console.error("[MeSH] Full error:", e, "name:", e.name);
      setError(`${e.name||"Error"}: ${e.message||String(e)}`);
    }
    setLoading(false);
    setProgress({done:0,total:0});
  };

  const copy=(text,id)=>navigator.clipboard.writeText(text).then(()=>{setCopied(id);setTimeout(()=>setCopied(""),2000);});
  const saveToSearch=(str)=>{
    if(!str) return;
    const existing=search.string||"",dbLabel=MESH_DBS.find(d=>d.id===activeDB)?.label||activeDB;
    updNested("search","string",existing?`${existing}\n\n— ${dbLabel} —\n${str}`:`— ${dbLabel} —\n${str}`);
  };

  return(<div>
    <SectionHeader icon="flask" title="AI Search String Generator"
      desc="Expert-level search strategy with MeSH analysis, sensitivity optimization, and multi-database support."/>
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:16}}>
      <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:0.8,marginBottom:12}}>SELECT DATABASES</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {MESH_DBS.map(db=>{const on=selectedDBs.includes(db.id);return(
          <button key={db.id} onClick={()=>toggleDB(db.id)} style={{padding:"6px 12px",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,
            fontFamily:"'IBM Plex Sans',sans-serif",border:`1px solid ${on?db.color:C.brd}`,
            background:on?`${db.color}20`:"transparent",color:on?db.color:C.muted,transition:"all 0.15s"}}>
            {on?"✓ ":""}{db.label}
            {on&&<span style={{fontSize:9,marginLeft:6,background:db.color,color:"#fff",padding:"1px 5px",borderRadius:3}}>EXPERT</span>}
            <span style={{fontSize:10,opacity:0.7,marginLeft:4}}>{db.syntax}</span>
          </button>);
        })}
      </div>
      {selectedDBs.length>0&&(
        <div style={{marginTop:10,background:`${themeAlpha(C.acc,'0a')}`,border:`1px solid ${themeAlpha(C.acc,'33')}`,borderRadius:6,padding:"8px 12px",fontSize:11,color:C.muted}}>
          ✦ All selected databases use the <strong style={{color:C.acc}}>Expert High-Sensitivity strategy</strong> — broad query, narrow query, controlled vocabulary analysis, free-text terms, terms to avoid, design improvements, and secondary search strategies, all in each database's native syntax.
        </div>
      )}
    </div>
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:16}}>
      <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:0.8,marginBottom:10}}>PICO CONTEXT</div>
      {!hasPICO?<div style={{fontSize:12,color:C.red}}>⚠ No PICO entered yet — fill in the PICO & Protocol tab first.</div>:(
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {[["P",C.acc],["I",C.grn],["C",C.yel],["O",C.purp]].map(([k,color])=>pico[k]?(
            <div key={k} style={{display:"flex",gap:10,fontSize:12}}>
              <span style={{fontWeight:800,color,minWidth:16}}>{k}</span>
              <span style={{color:C.muted}}>{pico[k]}</span>
            </div>
          ):null)}
        </div>
      )}
      <div style={{marginTop:12}}><label style={lbl}>Additional context, constraints, or specific terms</label>
        <input value={extra} onChange={e=>setExtra(e.target.value)}
          placeholder="e.g. Exclude paediatric; must include HbA1c; add insulin resistance terms; 2000–present"
          style={{...inp,fontSize:12}}/></div>
    </div>
    {picoChangedSinceGen && (
      <div style={{background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'55')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
        <span style={{fontSize:13}}>🔄</span>
        <div style={{flex:1}}>
          <div style={{fontSize:12,fontWeight:700,color:C.yel}}>PICO or settings changed since last generation</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>The saved search strategies were built with different inputs. Click sync to regenerate.</div>
        </div>
        <button onClick={generate} disabled={loading} style={{...btnS("ghost"),fontSize:11,color:C.yel,borderColor:themeAlpha(C.yel,'55'),opacity:loading?0.5:1}}>
          {loading?"⟳ Syncing…":"↻ Sync now"}
        </button>
      </div>
    )}
    <div style={{display:"flex",gap:12,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
      <button onClick={generate} disabled={loading||!hasPICO||selectedDBs.length===0}
        style={{...btnS("primary"),padding:"10px 24px",fontSize:13,opacity:(loading||!hasPICO||selectedDBs.length===0)?0.5:1}}>
        {loading?`⟳ Generating ${progress.done}/${progress.total||selectedDBs.length}…`:results?`↻ Regenerate (${selectedDBs.length} DBs)`:`✦ Generate for ${selectedDBs.length} database${selectedDBs.length!==1?"s":""}`}
      </button>
      <button onClick={async()=>{
        setError("");setTestResult("Testing…");
        const r=await testClaudeConnection();
        setTestResult(r.ok?`✓ Connection OK · Response: "${r.message.slice(0,40)}"`:`✗ ${r.name}: ${r.message}`);
      }} style={{...btnS("ghost"),fontSize:11}}>🔌 Test API Connection</button>
      {loading&&<span style={{fontSize:11,color:C.muted}}>{progress.total?`Building search strategy — ${progress.done} of ${progress.total} databases done…`:"Building search strategy…"}</span>}
      <span style={{
        fontSize:11,fontFamily:"'IBM Plex Mono',monospace",
        background:persisted.generatedAt?`${themeAlpha(C.grn,'15')}`:C.card,
        color:persisted.generatedAt?C.grn:C.dim,
        border:`1px solid ${persisted.generatedAt?themeAlpha(C.grn,'44'):C.brd}`,
        borderRadius:4,padding:"3px 8px",whiteSpace:"nowrap"
      }}>
        🕐 {persisted.generatedAt
          ? `Last generated: ${fmtDate(persisted.generatedAt)} ${new Date(persisted.generatedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`
          : "Not yet generated"}
      </span>
      {rawResponse&&!loading&&!error&&<button onClick={()=>setShowRaw(!showRaw)} style={{...btnS("ghost"),fontSize:11,marginLeft:"auto"}}>{showRaw?"Hide":"Show"} raw response</button>}
    </div>
    {testResult&&(<div style={{marginBottom:14,padding:"10px 14px",borderRadius:6,background:testResult.startsWith("✓")?"var(--t-grn-bg)":(testResult.startsWith("✗")?"var(--t-red-bg)":C.card),border:`1px solid ${testResult.startsWith("✓")?C.grn:(testResult.startsWith("✗")?C.red:C.brd)}`,fontSize:12,fontFamily:"'IBM Plex Mono',monospace",color:testResult.startsWith("✓")?C.grn:(testResult.startsWith("✗")?C.red:C.muted),wordBreak:"break-word"}}>{testResult}</div>)}
    {error&&(<div style={{background:"var(--t-red-bg)",border:`1px solid ${C.red}`,borderLeft:`4px solid ${C.red}`,borderRadius:6,padding:"12px 16px",marginBottom:14}}>
      <div style={{fontSize:12,fontWeight:700,color:C.red,marginBottom:4}}>⚠ Generation Error</div>
      <div style={{fontSize:12,color:C.txt,marginBottom:8}}>{error}</div>
      {rawResponse && <button onClick={()=>setShowRaw(!showRaw)} style={{...btnS("ghost"),fontSize:11,color:C.red,borderColor:themeAlpha(C.red,'55')}}>{showRaw?"Hide":"Show"} raw response ({rawResponse.length} chars)</button>}
    </div>)}
    {showRaw && rawResponse && (<div style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:12,marginBottom:14,maxHeight:320,overflowY:"auto"}}>
      <div style={{fontSize:10,fontWeight:700,color:C.muted,marginBottom:6,letterSpacing:0.8}}>RAW API RESPONSE</div>
      <pre style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,lineHeight:1.6,color:C.muted,whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0}}>{rawResponse}</pre>
    </div>)}
    {results?(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,overflow:"hidden"}}>
        <div style={{display:"flex",borderBottom:`1px solid ${C.brd}`,overflowX:"auto"}}>
          {/* Combined view tab first */}
          <button onClick={()=>setActiveDBPersist("__combined__")} style={{padding:"10px 16px",border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
            fontFamily:"'IBM Plex Sans',sans-serif",whiteSpace:"nowrap",background:activeDB==="__combined__"?C.bg:"transparent",
            color:activeDB==="__combined__"?C.acc:C.muted,borderBottom:activeDB==="__combined__"?`2px solid ${C.acc}`:"2px solid transparent",transition:"all 0.15s"}}>
            🗂️ All Databases<span style={{fontSize:9,marginLeft:6,opacity:0.7,background:activeDB==="__combined__"?themeAlpha(C.acc,'30'):C.brd,padding:"1px 6px",borderRadius:8}}>{selectedDBs.filter(id=>results[id]).length}</span>
          </button>
          {selectedDBs.filter(id=>results[id]).map(id=>{const db=MESH_DBS.find(d=>d.id===id),on=activeDB===id;return(
            <button key={id} onClick={()=>setActiveDBPersist(id)} style={{padding:"10px 16px",border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
              fontFamily:"'IBM Plex Sans',sans-serif",whiteSpace:"nowrap",background:on?C.bg:"transparent",
              color:on?db.color:C.muted,borderBottom:on?`2px solid ${db.color}`:"2px solid transparent",transition:"all 0.15s"}}>
              {db.label}<span style={{fontSize:9,marginLeft:6,opacity:0.7}}>EXPERT</span>
            </button>);})}
        </div>
        {activeDB==="__combined__"?(
          <CombinedDBView results={results} selectedDBs={selectedDBs.filter(id=>results[id])} onCopy={copy} copied={copied} onSave={saveToSearch}/>
        ):results[activeDB]?(()=>{
          const db=MESH_DBS.find(d=>d.id===activeDB),r=results[activeDB];
          return <ExpertDBResult db={db} r={r} copied={copied} onCopy={copy} onSave={saveToSearch}/>;
        })():null}
      </div>
    ):(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
        <div style={{fontSize:36,marginBottom:10}}>🧲</div>
        <div style={{fontSize:14,marginBottom:6}}>Ready to generate</div>
        <div style={{fontSize:12}}>Fill in your PICO, select databases, and click Generate</div>
      </div>
    )}
    <InfoBox>💡 <strong style={{color:C.txt}}>Workflow tip:</strong> Start with the <strong>Broad</strong> query, check hit counts against the <strong>Validation</strong> sanity-check papers, then refine using the <strong>Filters</strong> tab. The <strong>Concept Blocks</strong> view lets you edit individual PICO components without rebuilding the whole query. Use the <strong>All Databases</strong> tab to copy/export everything for your supplementary material. Always verify controlled-vocabulary terms in each database's native browser (e.g. <a href="https://meshb.nlm.nih.gov/" target="_blank" rel="noreferrer" style={{color:C.acc}}>NLM MeSH Browser</a>) before running — vocabularies update annually.</InfoBox>
  </div>);
}

/* ════════════ TAB: PROSPERO GENERATOR ════════════ */
function PROSPEROTab({project,updNested,upd}){
  const{pico,search}=project;
  const emptyFields=()=>{const s={};PROSP_FIELDS.forEach(f=>{s[f.id]="";});return s;};
  const persistedP = project.prospero || {};
  // Fields persisted across tab switches
  const fields = persistedP.fields || emptyFields();
  const persistedSnapshot = persistedP.picoSnapshot || null;
  const saveProspero = (patch) => upd("prospero", {...persistedP, ...patch});
  const setFields = (updater) => {
    const newFields = typeof updater === "function" ? updater(fields) : updater;
    saveProspero({fields: newFields, generatedAt: new Date().toISOString()});
  };
  const[generating,setGenerating]=useState(false),[generatingField,setGeneratingField]=useState(null);
  const[copied,setCopied]=useState(""),[activeSection,setActiveSection]=useState("All");
  const[progress,setProgress]=useState(0),[picoSnapshot,setPicoSnapshot]=useState(null);
  const[syncingFields,setSyncingFields]=useState([]);
  const sections=["All",...new Set(PROSP_FIELDS.map(f=>f.sec))];
  const hasPICO=pico.P||pico.I||pico.C||pico.O;
  const filled=PROSP_FIELDS.filter(f=>fields[f.id]?.trim()).length;
  const currentPicoKey=[pico.P,pico.I,pico.C,pico.O,pico.studyDesign,pico.timeframe].join("|");
  const picoChanged=picoSnapshot!==null&&picoSnapshot!==currentPicoKey;

  const buildCtx=()=>[pico.P&&`Population: ${pico.P}`,pico.I&&`Intervention: ${pico.I}`,pico.C&&`Comparator: ${pico.C}`,
    pico.O&&`Outcome(s): ${pico.O}`,pico.studyDesign&&`Study design: ${pico.studyDesign}`,pico.timeframe&&`Time frame: ${pico.timeframe}`,
    pico.keywords&&`Key terms: ${pico.keywords}`,pico.notes&&`Eligibility notes: ${pico.notes}`,
    Object.keys(search.dbs||{}).filter(k=>search.dbs[k]).length>0&&`Databases: ${Object.keys(search.dbs).filter(k=>search.dbs[k]).join(", ")}`,
  ].filter(Boolean).join("\n");

  const[genError,setGenError]=useState("");
  const[rawGenResp,setRawGenResp]=useState("");
  const[showGenRaw,setShowGenRaw]=useState(false);

  const generateAll=async()=>{
    if(!hasPICO) return;
    setGenerating(true);setProgress(0);setGenError("");setRawGenResp("");
    const ctx=buildCtx();

    // Build the markdown-section prompt — each field gets its own ## header
    const fieldHeaders = PROSP_FIELDS.map(function(f){
      return `## ${f.id.toUpperCase()}\n[${f.label} — under ${f.maxLen} chars. ${f.hint}]`;
    }).join("\n\n");

    const prompt=`You are an expert systematic review methodologist helping register a review on PROSPERO. Generate concise professional text for each field below.

PICO:
${ctx}

CRITICAL OUTPUT FORMAT — use markdown sections, NOT JSON:
Each field starts with ## FIELDNAME on its own line, then the content underneath.
Do NOT use JSON. Do NOT use code fences. Do NOT add commentary.

CHARACTER LIMITS (stay under, shorter is better):
title:300, question:1000, condition:200, population:800, intervention:800, comparator:800, context:800,
primary_outcomes:1000, secondary_outcomes:1000, study_types:800, searches:2000, data_extraction:800,
risk_of_bias:800, synthesis:1000, subgroups:800, certainty:400, language:200, country:100, funding:400, conflicts:400

Field guidance:
- TITLE: "[Intervention] for [condition] in [population]: a systematic review and meta-analysis"
- QUESTION: PICO-framed question(s), numbered if multiple
- SEARCHES: bullet list of databases + grey literature + trial registers + date range
- STUDY_TYPES: match the study design; mention fallback if primary insufficient
- DATA_EXTRACTION: dual independent extraction, consensus/third reviewer for disagreements
- RISK_OF_BIAS: RoB 2 for RCTs; ROBINS-I for non-randomised; Newcastle-Ottawa for observational
- SYNTHESIS: random-effects DerSimonian-Laird; state effect measure (MD/SMD/OR/RR/HR); I² and Q; narrative if MA not feasible
- CERTAINTY: GRADE per primary outcome; one sentence
- SUBGROUPS: 2-3 pre-specified only
- FUNDING: "No external funding" unless otherwise known
- CONFLICTS: "None declared"

Write third person, present tense, formal academic prose. No padding.

Now produce ALL these sections in this exact format (replace bracketed instructions with real content):

${fieldHeaders}

Begin now with ## TITLE.`;

    try {
      const text=await callClaude(prompt,5000);
      setRawGenResp(text);
      setProgress(60);
      const sections = parseSections(text);
      const limited={};
      var count = 0;
      PROSP_FIELDS.forEach(function(f){
        var key = f.id.toLowerCase();
        if (sections[key]) {
          limited[f.id] = String(sections[key]).slice(0, f.maxLen);
          count++;
        }
      });
      if (count === 0) {
        throw new Error("No fields were parsed from the response. Click 'Show raw response' to see what was returned.");
      }
      setFields(prev=>({...prev,...limited}));
      setProgress(100);
      setPicoSnapshot(currentPicoKey);
    } catch(e){
      console.error("[PROSPERO] Full error:", e, "name:", e.name, "stack:", e.stack);
      setGenError((e.name||"Error") + ": " + (e.message || String(e)));
      setProgress(0);
    }
    setGenerating(false);
  };

  const generateField=async(fieldId)=>{
    setGeneratingField(fieldId);
    const ctx=buildCtx(),field=PROSP_FIELDS.find(f=>f.id===fieldId);
    const others=Object.entries(fields).filter(([k,v])=>v&&k!==fieldId).map(([k,v])=>`${k}: ${v}`).join("\n").slice(0,600);
    const prompt=`You are an expert systematic review methodologist. Write ONE PROSPERO field.

PICO:
${ctx}
${others?`\nOther fields for context:\n${others}`:""} 

Field: "${field.label}"
Guidance: ${field.hint}
CRITICAL: Stay under ${field.maxLen} characters. Concise formal academic prose, third person present tense.
Output ONLY the field text — no labels, no quotes, no preamble.`;
    try {
      const text=await callClaude(prompt,600);
      const stamp=new Date().toISOString();
      setFields(prev=>({...prev,[fieldId]:text.slice(0,field.maxLen)}));
      saveProspero({fields:{...fields,[fieldId]:text.slice(0,field.maxLen)}, generatedAt: stamp});
    } catch(e){console.error("generateField:",e);}
    setGeneratingField(null);
  };

  const syncFromPICO=async(fieldIds)=>{
    if(!hasPICO) return;
    setSyncingFields(fieldIds);
    const ctx=buildCtx();
    const snapshotFields={...fields};
    // Run field updates sequentially to avoid rate-limit 429s
    const results=[];
    for(const fieldId of fieldIds){
      const field=PROSP_FIELDS.find(f=>f.id===fieldId);if(!field){results.push(null);continue;}
      const others=Object.entries(snapshotFields).filter(([k,v])=>v&&k!==fieldId).map(([k,v])=>`${k}: ${v}`).join("\n").slice(0,600);
      const prompt=`Update this PROSPERO field based on the UPDATED PICO below.

UPDATED PICO:
${ctx}
${others?`\nOther fields for context:\n${others}`:""}

Field: "${field.label}"
Guidance: ${field.hint}
CRITICAL: Stay under ${field.maxLen} characters. Third person, present tense. Output ONLY the field text.`;
      try {
        const text=await callClaude(prompt,600);
        results.push({id:fieldId, text:text.slice(0,field.maxLen)});
      } catch(e){console.error("syncFromPICO:",e);results.push(null);}
    }
    const updatedFields={...fields};
    results.forEach(r=>{ if(r) updatedFields[r.id]=r.text; });
    setFields(()=>updatedFields);
    setSyncingFields([]);
    setPicoSnapshot(currentPicoKey);
    saveProspero({fields: updatedFields, generatedAt: new Date().toISOString()});
  };

  const copy=(text,id)=>navigator.clipboard.writeText(text).then(()=>{setCopied(id);setTimeout(()=>setCopied(""),1800);});
  const copyAll=()=>{
    const all=PROSP_FIELDS.filter(f=>fields[f.id]).map(f=>`=== ${f.label.toUpperCase()} ===\n${fields[f.id]}`).join("\n\n");
    navigator.clipboard.writeText(all).then(()=>{setCopied("all");setTimeout(()=>setCopied(""),2000);});
  };
  const visibleFields=activeSection==="All"?PROSP_FIELDS:PROSP_FIELDS.filter(f=>f.sec===activeSection);

  return(<div>
    <SectionHeader icon="clipboard" title={AI_FEATURES_ENABLED?"PROSPERO Protocol Generator":"PROSPERO Protocol"} desc={AI_FEATURES_ENABLED?"AI-assisted completion of all PROSPERO registration fields — generated from your PICO. Edit any field before copying.":"Complete every PROSPERO registration field with live character limits, then copy each one into the registration form."}/>

    {/* Top bar */}
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:16}}>
      <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
        <div style={{flex:1}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontSize:12,fontWeight:600}}>{filled}/{PROSP_FIELDS.length} fields filled</span>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              {AI_FEATURES_ENABLED&&<span style={{
                fontSize:11,fontFamily:"'IBM Plex Mono',monospace",
                background:persistedP.generatedAt?`${themeAlpha(C.grn,'15')}`:C.card,
                color:persistedP.generatedAt?C.grn:C.dim,
                border:`1px solid ${persistedP.generatedAt?themeAlpha(C.grn,'44'):C.brd}`,
                borderRadius:4,padding:"3px 8px",whiteSpace:"nowrap"
              }}>
                🕐 {persistedP.generatedAt
                  ? `Last generated: ${fmtDate(persistedP.generatedAt)} ${new Date(persistedP.generatedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`
                  : "Not yet generated"}
              </span>}
              {filled>0&&<span style={{fontSize:11,color:C.muted}}>{Math.round(filled/PROSP_FIELDS.length*100)}% complete</span>}
            </div>
          </div>
          <ProgressBar done={filled} total={PROSP_FIELDS.length}/>
        </div>
        <div style={{display:"flex",gap:8,flexShrink:0}}>
          {filled>0&&<button onClick={copyAll} style={{...btnS("ghost"),fontSize:11}}>{copied==="all"?"✓ Copied all!":"📋 Copy All"}</button>}
          {AI_FEATURES_ENABLED&&<button onClick={generateAll} disabled={generating||!hasPICO}
            style={{...btnS("primary"),padding:"8px 20px",opacity:(generating||!hasPICO)?0.5:1}}>
            {generating?"⟳ Generating…":"✦ Generate All Fields"}
          </button>}
        </div>
      </div>
      {AI_FEATURES_ENABLED&&!hasPICO&&<div style={{marginTop:10,fontSize:12,color:C.yel}}>⚠ Fill in your PICO & Protocol tab first for best results</div>}
      {generating&&(<div style={{marginTop:10}}>
        <div style={{fontSize:11,color:C.muted,marginBottom:4}}>Building all {PROSP_FIELDS.length} PROSPERO fields… (30–60s)</div>
        <div style={{background:C.brd,borderRadius:4,height:4,overflow:"hidden"}}>
          <div style={{width:`${progress}%`,height:"100%",background:C.acc,transition:"width 1s ease",borderRadius:4}}/>
        </div>
      </div>)}
      {genError&&(<div style={{marginTop:12,background:"var(--t-red-bg)",border:`1px solid ${C.red}`,borderLeft:`4px solid ${C.red}`,borderRadius:6,padding:"12px 16px"}}>
        <div style={{fontSize:12,fontWeight:700,color:C.red,marginBottom:4}}>⚠ Generation Error</div>
        <div style={{fontSize:12,color:C.txt,marginBottom:8}}>{genError}</div>
        {rawGenResp&&<button onClick={()=>setShowGenRaw(!showGenRaw)} style={{...btnS("ghost"),fontSize:11,color:C.red,borderColor:themeAlpha(C.red,'55')}}>{showGenRaw?"Hide":"Show"} raw response ({rawGenResp.length} chars)</button>}
      </div>)}
      {showGenRaw&&rawGenResp&&(<div style={{marginTop:10,background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:12,maxHeight:320,overflowY:"auto"}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,marginBottom:6,letterSpacing:0.8}}>RAW API RESPONSE</div>
        <pre style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10,lineHeight:1.6,color:C.muted,whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0}}>{rawGenResp}</pre>
      </div>)}

      {/* PICO changed banner — regeneration sync is an AI feature */}
      {AI_FEATURES_ENABLED&&picoChanged&&!generating&&filled>0&&(
        <div style={{marginTop:12,background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'55')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"10px 14px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
          <span style={{fontSize:13}}>🔄</span>
          <div style={{flex:1}}>
            <div style={{fontSize:12,fontWeight:700,color:C.yel}}>PICO has been updated</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>Your PICO fields changed since the last generation. Sync to update.</div>
          </div>
          <div style={{display:"flex",gap:8,flexShrink:0}}>
            <button onClick={()=>syncFromPICO(PROSP_FIELDS.filter(f=>fields[f.id]?.trim()).map(f=>f.id))}
              disabled={syncingFields.length>0}
              style={{...btnS("ghost"),fontSize:11,color:C.yel,borderColor:themeAlpha(C.yel,'55'),opacity:syncingFields.length>0?0.5:1}}>
              {syncingFields.length>0?`⟳ Syncing ${syncingFields.length} fields…`:"↻ Sync filled fields"}
            </button>
            <button onClick={generateAll} disabled={generating} style={{...btnS("ghost"),fontSize:11,color:C.acc,borderColor:themeAlpha(C.acc,'55')}}>✦ Regenerate all</button>
          </div>
        </div>
      )}
    </div>

    {/* Section filter */}
    <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
      {sections.map(s=><button key={s} onClick={()=>setActiveSection(s)} style={{...btnS(activeSection===s?"primary":"ghost"),fontSize:11,padding:"4px 12px"}}>{s}</button>)}
      <a href="https://www.crd.york.ac.uk/PROSPERO/#registerpage" target="_blank" rel="noreferrer"
        style={{marginLeft:"auto",fontSize:11,color:C.acc}}>Open PROSPERO ↗</a>
    </div>

    {/* Fields */}
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {visibleFields.map(field=>{
        const val=fields[field.id]||"",isGen=generatingField===field.id||syncingFields.includes(field.id);
        const over=val.length>field.maxLen,remaining=field.maxLen-val.length;
        const charColor=over?C.red:remaining<field.maxLen*0.1?C.yel:C.dim;
        return(<div key={field.id} style={{background:C.card,border:`1px solid ${over?themeAlpha(C.red,'66'):C.brd}`,
          borderLeft:`3px solid ${over?C.red:val?C.grn:C.brd}`,borderRadius:8,padding:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:10}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span style={{fontSize:13,fontWeight:700}}>{field.label}</span>
                <span style={tagS(field.sec==="Methods"?"blue":field.sec==="Outcomes"?"purple":field.sec==="Background"?"green":"")}>{field.sec}</span>
                <span style={{fontSize:10,fontFamily:"'IBM Plex Mono',monospace",color:charColor,marginLeft:"auto"}}>
                  {over?`⚠ ${Math.abs(remaining)} over`:val?`${remaining} left`:`0 / ${field.maxLen}`}
                </span>
              </div>
              <div style={{fontSize:11,color:C.dim,marginTop:3,lineHeight:1.4}}>{field.hint}</div>
            </div>
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              {over&&<button onClick={()=>setFields(prev=>({...prev,[field.id]:val.slice(0,field.maxLen)}))}
                style={{...btnS("danger"),fontSize:10,padding:"3px 10px"}}>✂ Trim</button>}
              {val&&!over&&<button onClick={()=>copy(val,field.id)} style={{...btnS("ghost"),fontSize:10,padding:"3px 10px"}}>{copied===field.id?"✓":"Copy"}</button>}
              {AI_FEATURES_ENABLED&&<button onClick={()=>generateField(field.id)} disabled={isGen||!hasPICO}
                style={{...btnS("ghost"),fontSize:10,padding:"3px 10px",color:C.acc,borderColor:themeAlpha(C.acc,'55'),opacity:!hasPICO?0.4:1}}>
                {isGen?"⟳":val?"↻ Regen":"✦ Generate"}
              </button>}
            </div>
          </div>
          <div style={{background:C.brd,borderRadius:2,height:3,marginBottom:8,overflow:"hidden"}}>
            <div style={{width:`${Math.min(100,val.length/field.maxLen*100)}%`,height:"100%",borderRadius:2,
              background:over?C.red:remaining<field.maxLen*0.1?C.yel:C.grn,transition:"width 0.2s,background 0.2s"}}/>
          </div>
          <textarea value={val} onChange={e=>setFields(prev=>({...prev,[field.id]:e.target.value}))}
            placeholder={isGen?"Generating…":AI_FEATURES_ENABLED?"Click ✦ Generate or type directly…":"Type this field directly…"}
            rows={field.rows} style={{...inp,resize:"vertical",lineHeight:1.6,fontSize:12,opacity:isGen?0.6:1,borderColor:over?themeAlpha(C.red,'88'):C.brd}}/>
          {over&&<div style={{fontSize:11,color:C.red,marginTop:5}}>⚠ {Math.abs(remaining)} characters over the PROSPERO limit of {field.maxLen}. Click ✂ Trim or edit manually.</div>}
        </div>);
      })}
    </div>
    <InfoBox>💡 Review and personalise each field — especially team members, affiliations, start/end dates, and funding. PROSPERO requires your institutional email. Once registered, save your CRD number in the PICO tab.</InfoBox>
  </div>);
}


/* ════════════ TAB: SENSITIVITY ANALYSIS ════════════ */
function SensitivityTab({project}){
  const{studies}=project;
  const prec = project?.analysisPrecision;
  const[method,setMethod]=useState("random");
  const result=useMemo(()=>runMeta(studies,method),[studies,method]);
  const loo=useMemo(()=>leaveOneOut(studies,method),[studies,method]);
  const egger=useMemo(()=>eggersTest(studies),[studies]);
  const tf=useMemo(()=>trimFill(studies,method),[studies,method]);
  const influence=useMemo(()=>influenceDiagnostics(studies,method),[studies,method]);
  const esType=useMemo(()=>{const t=studies.map(s=>s.esType).filter(Boolean);return t.length?t[0]:"";},[studies]);
  // Primary-data-only re-run (exclude converted / non-primary studies)
  const primaryStudies=useMemo(()=>studies.filter(s=>s.es!==""&&!isNaN(+s.es)&&!isNonPrimary(s)),[studies]);
  const nonPrimaryCount=useMemo(()=>studies.filter(s=>s.es!==""&&!isNaN(+s.es)&&isNonPrimary(s)).length,[studies]);
  const primaryResult=useMemo(()=>runMeta(primaryStudies,method),[primaryStudies,method]);

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
function SubgroupTab({project}){
  const{studies}=project;
  const prec = project?.analysisPrecision;
  const[groupKey,setGroupKey]=useState("design");
  const[method,setMethod]=useState("random");
  const result=useMemo(()=>subgroupAnalysis(studies,groupKey,method),[studies,groupKey,method]);
  const overall=useMemo(()=>runMeta(studies,method),[studies,method]);

  const keys=[
    {id:"design",label:"Study Design"},
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
  </div>);
}

/* ════════════ TAB: GRADE ════════════ */
/* GRADE_OPTIONS + gradeSuggestions extracted VERBATIM to
   src/frontend/workspace/projectHelpers.js (prompt46 Phase 6a) and imported at
   the top of this file. */

function GRADETab({project,upd}){
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
function ManuscriptTab({project,upd}){
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

/* ════════════ METHODS & EQUATIONS TAB (prompt6 Task 13) ════════════ */
/* Replaces the removed Templates downloads. Renders the engine-owned
   METHODS_CONTENT catalogue (src/research-engine/docs/methods-content.js):
   every statistical method actually implemented in the app — equation as
   computed, plain-English meaning, UI surface, implementation pointer,
   verified references and limitations. verified:false ⇒ amber badge. */
/* MATH_FONT + Frac extracted VERBATIM to src/frontend/workspace/ui/primitives.jsx
   (prompt46 Phase 3) and imported at the top of this file. */
function MethodsTab(){
  return(<div>
    <SectionHeader icon="bookOpen" title="Methods & Equations"
      desc="Every statistical method implemented in META·LAB, documented as computed: the equation, what it means in plain English, where it runs in the app, and verified references. Methods not listed here are not implemented."/>
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
      <strong style={{color:C.txt}}>Not implemented:</strong> {NOT_IMPLEMENTED.join(" · ")}. This catalogue documents only methods that actually run in the app — if a method is not listed above, META·LAB does not compute it.
    </InfoBox>
  </div>);
}

/* ════════════ TABS CONFIG ════════════ */
/* TABS / PHASES / READING_TABS / PHASE_ICON extracted VERBATIM to
   src/frontend/workspace/projectHelpers.js (prompt46 Phase 6a) and imported at
   the top of this file. */
// prompt36 Task 3 — the MAIN workflow steps are every tab WITH a phase (Overview &
// Project Control have phase:null). Navigating TO one of these auto-collapses the
// left workflow menu into focus mode; Overview / Project Control never collapse.
// prompt39 Task 6 — CENTRALIZED workflow-menu collapse rules live in the pure,
// unit-tested helper module; the monolith just binds them to its TABS config.
const { workflowTabIds: WORKFLOW_TAB_IDS, shouldAutoCollapseWorkflowMenu } = makeWorkflowMenuRules(TABS);

/* PICO Time Frame — TIMEFRAME_OPTIONS + timeframeComplete were EXTRACTED to
   src/features/protocol/constants.js (prompt38, strangler-fig) and re-imported at
   the top of this file, so the legacy PICOTab + the new ProtocolModulePanel share
   one source of truth. Behaviour is unchanged. */

/* CriteriaList — structured inclusion/exclusion editor (prompt23 Task 8C)
   extracted VERBATIM to src/frontend/workspace/ui/primitives.jsx (prompt46
   Phase 3) and imported at the top of this file. */

/* readinessCheck / stepStatus / auditProject extracted VERBATIM to
   src/frontend/workspace/projectHelpers.js (prompt46 Phase 6a) and imported at
   the top of this file. */

/* AuditPanel, ProjectTitle, ProjectHeaderBar, ScreeningWorkspaceFrame,
   EmbeddedScreening, OverviewTab, ControlTab extracted VERBATIM to
   src/frontend/workspace/tabs/overviewTabs.jsx (prompt46 Phase 6b) and
   imported at the top of this file. */

/* ════════════ MAIN APP ════════════ */

let _versionCache=null; // module-level so remounts don't refetch (same pattern as UserMenu.jsx)

export default function MetaLab({ initialProjectId = null, initialTab = null, onProjectChange = null, onTabChange = null, onBackToProjects = null } = {}){
  const[projects,setProjects]=useState([]);
  const[activeId,setActiveId]=useState(null);
  const[tab,setTab]=useState(initialTab||"overview"); // Overview is the landing tab (prompt6 Task 15); a ?tab= deep-link (e.g. screening) overrides on first open
  // prompt34 Task 8 — ONE unified workflow-menu collapse for EVERY project tab
  // (Overview … Project Control AND Screening). The universal header's ☰ toggles
  // it; the sidebar slides away and the workspace gains the full width. The choice
  // persists across sessions + tabs (per browser) so it never resets when moving
  // between tabs — this replaces the old split screeningFocus/navCollapsed pair so
  // the collapse stays consistent across the whole app (prompt19's Screening-only
  // focus mode is now just this shared collapse). Screening's full-bleed CONTENT
  // layout is still driven separately by `inScreening` (padding/overflow).
  const[navCollapsed,setNavCollapsed]=useState(()=>{try{return localStorage.getItem("metalab.navCollapsed")==="1";}catch(_){return false;}});
  useEffect(()=>{try{localStorage.setItem("metalab.navCollapsed",navCollapsed?"1":"0");}catch(_){/* best-effort */}},[navCollapsed]);
  const[loading,setLoading]=useState(true);
  const[newName,setNewName]=useState("");
  const[withSift,setWithSift]=useState(true);          // Task 2 — default ON
  const[creatingProject,setCreatingProject]=useState(false);
  const[createWarning,setCreateWarning]=useState("");   // Task 2 — non-fatal SIFT-create warning
  const[deepLinkMiss,setDeepLinkMiss]=useState(null);   // Task 3 — ?project= id we couldn't open
  // prompt42 Task 7 — lifted from RoBTab: true while the per-study RoB assessment
  // workspace is open, so the shell drops page-level scroll (the assessment's PDF +
  // questions panels own all scrolling, mirroring the Screening full-bleed layout).
  const[robInWorkspace,setRobInWorkspace]=useState(false);
  // prompt42 Task 7 (review fix) — the no-page-scroll full-bleed applies ONLY on wide
  // (>=900px) screens. Below that RobWorkspace stacks the PDF + assessment and lays out
  // TALLER than the viewport, relying on page scroll; forcing overflow:hidden there would
  // clip the assessment + the Finalise/Continue footer (matches RobWorkspace STACK_BELOW).
  const[robNarrow,setRobNarrow]=useState(()=>{try{return window.innerWidth<900;}catch(_){return false;}});
  useEffect(()=>{let raf=0;const onR=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{try{setRobNarrow(window.innerWidth<900);}catch(_){/* ignore */}});};window.addEventListener("resize",onR);return()=>{cancelAnimationFrame(raf);window.removeEventListener("resize",onR);};},[]);
  const[showModal,setShowModal]=useState(false);
  const[confirmDel,setConfirmDel]=useState(null);
  const[delName,setDelName]=useState("");          // typed-name confirmation (prompt9 Task 7)
  const[delErr,setDelErr]=useState("");
  const[delBusy,setDelBusy]=useState(false);
  const[showAudit,setShowAudit]=useState(false);
  const[appVersion,setAppVersion]=useState(_versionCache);
  // ONE shared ExportDialog instance for every monolith download (prompt9 Task 6).
  // Deep components open it via the module-level openExportDialog() trampoline.
  const[expItem,setExpItem]=useState(null);
  useEffect(()=>{
    _openExportDialog=setExpItem;
    return()=>{if(_openExportDialog===setExpItem)_openExportDialog=null;};
  },[]);

  // prompt29 Part 9 — true Screening completeness for the workflow stepper. The
  // linked-workspace roll-up (GET /metalab/:id/summary) reports whether every
  // screening substep is finished; the stepper turns the Screening step green
  // only when this is true. Fetched on project open and refreshed live on
  // screening realtime pokes (decisions / conflicts / handoff) so the stepper is
  // accurate without refetching on every tab change.
  const[screeningComplete,setScreeningComplete]=useState(false);
  const refreshScreeningComplete=useCallback(()=>{
    if(!activeId)return;
    fetch(`/api/screening/metalab/${activeId}/summary`,{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(d=>setScreeningComplete(!!(d&&d.linked&&d.screeningComplete)))
      .catch(()=>{});
  },[activeId]);
  useEffect(()=>{
    if(!activeId){setScreeningComplete(false);return undefined;}
    refreshScreeningComplete();
    return undefined;
  },[activeId,refreshScreeningComplete]);
  useRealtime({
    "decision.saved": refreshScreeningComplete,
    "status.changed": refreshScreeningComplete,
    "handoff.updated": refreshScreeningComplete,
  });

  // Sidebar footer version from the shared GET /api/version (prompt6) —
  // silent fallback: on any error the footer just shows the static label.
  useEffect(()=>{
    if(_versionCache)return;
    fetch("/api/version",{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(v=>{if(v?.version){_versionCache=v.version;setAppVersion(v.version);}})
      .catch(()=>{});
  },[]);

  useEffect(()=>{(async()=>{
    // Project receiver. Priority: the route param (prompt11 — /app/project/:id,
    // passed as initialProjectId; survives refresh, fixes the stale-activeId bug)
    // → the legacy ?project= deep-link → first project. The ?project= param is
    // consumed in the SAME effect that loads the project list, so it can never
    // race the fetch.
    let want=null, fromQuery=false;
    if(initialProjectId){ want=initialProjectId; }
    else { try{want=new URLSearchParams(window.location.search).get("project"); fromQuery=!!want;}catch(_){} }
    let pjs=[];
    try{const res=await window.storage.get("meta:projects");
      if(res?.value){pjs=JSON.parse(res.value);setProjects(pjs);}
    }catch(_){}
    if(want){
      if(pjs.some(p=>p.id===want)){setActiveId(want);setTab(initialTab||"overview");}
      // NEVER silently fall back to the first project — show the explicit
      // no-access panel instead (rendered in the main content area).
      else setDeepLinkMiss(want);
      // Drop a legacy ?project= query once consumed so refresh / switching doesn't
      // snap back. Route-param opens keep the URL (it IS the durable address).
      if(fromQuery){ try{window.history.replaceState({},"",window.location.pathname);}catch(_){} }
    } else if(pjs.length){setActiveId(pjs[0].id);}
    setLoading(false);
  })();},[]);

  // prompt11 (route-sync): when the active project changes via the in-app sidebar
  // switcher, push it into the URL (/app/project/:id) so a refresh stays on the
  // project the user was actually in. One-way (activeId → URL); the initial seed
  // from initialProjectId is skipped so we never fight our own first render.
  const _syncedFirst=useRef(false);
  useEffect(()=>{
    if(!_syncedFirst.current){ _syncedFirst.current=true; return; }
    if(activeId && typeof onProjectChange==="function") onProjectChange(activeId);
  },[activeId,onProjectChange]);

  // prompt20 Task 1 (stage route-sync): reflect the active stage into the host
  // URL (?tab=) so a refresh reopens the SAME stage — including the Screening
  // workspace — and so deep-links round-trip. One-way (tab → URL); the first
  // render is skipped so we never fight the initialTab seed. AppWorkspace owns
  // the actual write (the monolith is not router-aware) and clears the embedded
  // ?screen= sub-tab when leaving Screening.
  const _syncedTabFirst=useRef(false);
  useEffect(()=>{
    if(!_syncedTabFirst.current){ _syncedTabFirst.current=true; return; }
    if(typeof onTabChange==="function") onTabChange(tab);
  },[tab,onTabChange]);

  // prompt20 follow-up — let the active stage FOLLOW the host URL after mount, so
  // browser back/forward and external deep-links move between stages (not just at
  // first load). Functional update → no stale read, no-ops when already in sync,
  // so it never fights the one-way tab→URL sync above (which uses replace, so
  // in-app stage switches stay out of history — no back-button spam).
  useEffect(()=>{
    if(initialTab) setTab(t=> initialTab!==t ? initialTab : t);
  },[initialTab]);

  // Debouncing is handled inside window.storage.set (serverStorage.js).
  // Calling set() directly here lets flushStorage() drain any pending save
  // before logout without needing access to an internal React timer.
  const save=useCallback(pjs=>{
    window.storage.set("meta:projects",JSON.stringify(pjs)).catch(()=>{});
  },[]);

  const updateProject=useCallback((id,updater)=>{
    setProjects(prev=>{
      // prompt6 Task 5 — viewer read-only gate. This is the single client-side
      // write choke point (upd / updNested / every tab handler funnel through
      // here): silently no-op any mutation of a read-only shared project. The
      // server independently no-ops their autosaves (defense-in-depth).
      const target=prev.find(p=>p.id===id);
      if(target&&((target._permissions&&target._permissions.readOnly)||target._readOnly)) return prev;
      const next=prev.map(p=>p.id===id?{...updater(p),modified:now()}:p);save(next);return next;});
  },[save]);

  // Merge transient (underscore) annotations into local state WITHOUT triggering
  // an autosave — used after "Create & link META·SIFT" so the link shows instantly.
  const patchAnnotations=useCallback((id,patch)=>{
    setProjects(prev=>prev.map(p=>p.id===id?{...p,...patch}:p));
  },[]);

  // prompt6 Task 18 — rename goes through the REAL PUT /api/projects/:id (never
  // the autosave blob path) so the server's sync-if-in-sync rename of the linked
  // META·SIFT title fires. Owner → 200 bare project; member with canEdit → 200
  // annotated; member without canEdit → 403 (surfaced inline, never thrown).
  const renameProject=useCallback(async(id,newNameRaw)=>{
    const name=String(newNameRaw||"").trim();
    const proj=projects.find(p=>p.id===id);
    if(!proj) return {ok:false,error:"Project not found."};
    if(!name) return {ok:false,error:"Name cannot be empty."};
    if(name===proj.name) return {ok:true};
    try{
      const r=await fetch(`/api/projects/${id}`,{method:"PUT",credentials:"include",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});
      if(!r.ok){
        const d=await r.json().catch(()=>({}));
        return {ok:false,error:d.error||(r.status===403
          ?"Read-only access — you do not have permission to rename this project."
          :`Rename failed (${r.status}).`)};
      }
      setProjects(prev=>prev.map(p=>{
        if(p.id!==id) return p;
        const next={...p,name,modified:now()};
        // Mirror the server's sync-if-in-sync so the linked title stays fresh locally.
        if(next._linkedMetaSift&&next._linkedMetaSift.title===proj.name)
          next._linkedMetaSift={...next._linkedMetaSift,title:name};
        return next;
      }));
      return {ok:true};
    }catch(_){ return {ok:false,error:"Could not reach the server."}; }
  },[projects]);

  // ── Realtime collaboration pokes (prompt6 Task 7) ──────────────────────────
  // META·LAB persistence is a whole-blob autosave (last-write-wins), so a remote
  // refetch is NEVER applied while local edits are unsaved or in flight
  // (hasPendingSave) — that would clobber them. Dirty → "updated by a
  // collaborator" banner; clean → silent refetch. Events are thin pokes with no
  // content; all data still loads through the normal authorized endpoints.
  const projectsRef=useRef(projects);projectsRef.current=projects;
  const activeIdRef=useRef(activeId);activeIdRef.current=activeId;
  const[remoteUpdate,setRemoteUpdate]=useState(false);
  const refetchProjects=useCallback(async()=>{
    try{
      const res=await window.storage.get("meta:projects");
      if(!res?.value)return false;
      if(hasPendingSave())return false; // edits began during the fetch — keep local state
      setProjects(JSON.parse(res.value));
      return true;
    }catch(_){return false;}
  },[]);
  // Banner action: persist local edits FIRST (last-write-wins, by design), then pull.
  const applyRemoteUpdate=useCallback(async()=>{
    try{await flushStorage();}catch(_){/* best-effort */}
    if(await refetchProjects())setRemoteUpdate(false);
  },[refetchProjects]);
  useRealtime({
    "project.updated":(ev)=>{
      const mlId=ev&&ev.metaLabProjectId;
      if(!mlId||!projectsRef.current.some(p=>p.id===mlId))return;
      if(hasPendingSave()){if(mlId===activeIdRef.current)setRemoteUpdate(true);return;}
      refetchProjects().then(ok=>{if(ok&&mlId===activeIdRef.current)setRemoteUpdate(false);});
    },
    // List-level pokes — refresh _role/_readOnly/_linkedMetaSift annotations,
    // but only when clean (annotations otherwise refresh on the next load).
    "members.changed":()=>{if(!hasPendingSave())refetchProjects();},
    "permissions.changed":()=>{if(!hasPendingSave())refetchProjects();},
  });

  const project=useMemo(()=>projects.find(p=>p.id===activeId)||null,[projects,activeId]);
  // prompt30 Part 5 — compact header status (requirements-missing + high-severity
  // audit items), memoised so auditProject() isn't recomputed on every header
  // re-render (presence pings, autosave ticks). Recomputes only when the project
  // object changes (i.e. on a real edit).
  const headerStatus=useMemo(()=>{
    if(!project) return {reqMissing:0,reqMissingList:[],missingItems:0};
    const r=readinessCheck(project);
    return {
      reqMissing:r.ok?0:r.missing.length,
      reqMissingList:r.ok?[]:r.missing,
      missingItems:auditProject(project).filter(i=>i.sev==="high").length,
    };
  },[project]);

  // prompt23 Tasks 13/14/15 · prompt24 Tasks 2/8/9 — project presence across ALL
  // monolith stages (PICO, Data Extraction, Analysis, …) AND the Screening stage,
  // surfaced by the ONE PresenceIndicator in the universal header. Scoped to the
  // linked screening project id so monolith and screening users share ONE room.
  // On the Screening tab the header runs LISTEN-ONLY (heartbeat:false) so the
  // embedded SiftProject keeps owning the fine-grained "Screening · …" location
  // without a double heartbeat; everywhere else the header heartbeats the tab.
  const { user: authUser, setUser } = useAuth();
  // prompt39 Task 5 — per-user workflow-menu mode (server-backed, cross-device,
  // mirrors themePreference). prompt44 item 3 — the workflow menu is now PINNED by
  // DEFAULT: only an explicit "auto" choice opts into auto-collapse, so new users
  // (null) and everyone who hasn't toggled it keep the menu fixed/open. Unpinning
  // (the pin control) sets "auto" and persists it.
  const workflowMenuMode = authUser?.workflowMenuMode === "auto" ? "auto" : "pinned";
  // prompt39 Task 5 — when the saved mode is "pinned" (incl. after async auth load),
  // keep the menu open. "auto" respects the user's manual collapse choice. Placed
  // here (above any conditional return) to keep hook order stable.
  useEffect(()=>{ if(workflowMenuMode==="pinned") setNavCollapsed(false); },[workflowMenuMode]);
  const linkedSp = linkedSiftId(project);
  // prompt24 follow-up (limitation #1) — presence is scoped to the linked
  // ScreenProject. A project that has none yet would show NO presence anywhere
  // until Screening is first opened. For the OWNER we lazily resolve/create the
  // workspace (the same getWorkspace path Screening uses) so presence works
  // project-wide immediately. Best-effort + owner-only: a member never has a
  // missing link (membership implies a workspace), and any error leaves presence
  // simply off rather than breaking the page.
  const[resolvedSpId,setResolvedSpId]=useState(null);
  useEffect(()=>{
    let dead=false;
    setResolvedSpId(null);
    if(!project||linkedSp||project._shared) return undefined;
    screeningApi.getWorkspace(project.id)
      .then(r=>{ if(!dead&&r&&r.screenProjectId) setResolvedSpId(r.screenProjectId); })
      .catch(()=>{ /* no workspace / no access → presence stays off */ });
    return ()=>{dead=true;};
  },[project?.id,linkedSp,project?._shared]);
  const spId = linkedSp || resolvedSpId;
  const monolithLocation = (TABS.find(t=>t.id===tab)?.label) || "Project";
  const { users: presenceUsers, locks: presenceLocks } = useProjectPresence(
    spId, monolithLocation, { enabled: !!spId, heartbeat: tab !== "screening" }
  );
  const upd=useCallback((field,val)=>{if(activeId)updateProject(activeId,p=>({...p,[field]:val}));},[activeId,updateProject]);
  const updNested=useCallback((field,key,val)=>{if(activeId)updateProject(activeId,p=>({...p,[field]:{...p[field],[key]:val}}));},[activeId,updateProject]);

  // prompt6 Task 2 — create on the server so the linked META·SIFT project can be
  // created atomically server-side. Handles BOTH response shapes:
  //   checked   → POST {name, createLinkedSift:true} → {project, linkedScreenProject, warning?}
  //   unchecked → POST {name}                        → bare project (legacy shape)
  // Network/server failure falls back to the legacy local create (autosave upserts it).
  const confirmAdd=async()=>{
    const name=newName.trim();if(!name||creatingProject)return;
    setCreatingProject(true);
    let proj=null,warning="";
    try{
      const r=await fetch("/api/projects",{method:"POST",credentials:"include",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(withSift?{name,createLinkedSift:true}:{name})});
      if(r.ok){
        const data=await r.json();
        proj=data&&data.project?data.project:data; // {project, linkedScreenProject} vs bare
        if(data&&data.warning)warning=data.warning;
      }
    }catch(_){/* offline / proxy error → local fallback below */}
    if(!proj||!proj.id){
      proj=mkProject(name);
      if(withSift)warning="Project created — its screening workspace could not be set up just now. It will be created automatically the next time you open Screening.";
    }
    const next=[proj,...projects];
    setProjects(next);setActiveId(proj.id);setTab("overview");save(next);
    setCreatingProject(false);setShowModal(false);setNewName("");setCreateWarning(warning);
  };
  // prompt9 Task 7 — typed-name delete via the explicit endpoint
  // POST /api/projects/:id/delete {confirmName, cascadeLinked:true}.
  // The row is deleted SERVER-SIDE here, so local removal must NOT ride the
  // autosave array-diff sweep (it would fire a duplicate DELETE): we
  // (1) flush any pending debounced save first (its array still contains the
  //     project — harmless, and it settles the sweep baseline),
  // (2) call the delete endpoint,
  // (3) re-baseline via window.storage.get() — the load path resets the
  //     sweep's knownServerIds from the server, where the row is already gone,
  //     so the next doSave() diff can never produce this id again.
  const confirmDelete=async()=>{
    const id=confirmDel;
    const proj=projects.find(p=>p.id===id);
    if(!proj){setConfirmDel(null);return;}
    if(delBusy)return;
    setDelBusy(true);setDelErr("");
    try{
      try{await flushStorage();}catch(_){/* best-effort */}
      const r=await fetch(`/api/projects/${id}/delete`,{method:"POST",credentials:"include",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({confirmName:delName.trim(),cascadeLinked:true})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok){
        setDelErr(d.error||(r.status===400
          ?"The name you typed does not match the project name."
          :`Delete failed (${r.status}). Please try again.`));
        setDelBusy(false);
        return;
      }
      // Re-baseline the delete sweep + refresh local state from the server.
      let fresh=null;
      try{
        const res=await window.storage.get("meta:projects");
        if(res?.value)fresh=JSON.parse(res.value);
      }catch(_){/* degraded: local filter below; a stray sweep DELETE would 404 and is swallowed */}
      const next=Array.isArray(fresh)?fresh:projects.filter(p=>p.id!==id);
      setProjects(next);
      if(activeId===id)setActiveId(next[0]?.id||null);
      setConfirmDel(null);setDelName("");setDelErr("");
    }catch(_){
      setDelErr("Could not reach the server. Please try again.");
    }
    setDelBusy(false);
  };

  const importRef=useRef(null);
  // Export the active project (or all) as a portable JSON file
  const exportProject=(all)=>{
    const payload=all
      ? {type:"metalab-backup",version:1,exported:now(),projects}
      : {type:"metalab-project",version:1,exported:now(),project};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const u=URL.createObjectURL(blob);const a=document.createElement("a");
    a.href=u;a.download=(all?"metalab_backup":(project?.name||"project").replace(/[^a-z0-9]/gi,"_"))+".json";
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u);
  };
  const onImport=async(e)=>{
    const f=(e.target.files||[])[0];if(!f)return;
    try{
      const data=JSON.parse(await f.text());
      let incoming=[];
      if(data.type==="metalab-backup"&&Array.isArray(data.projects)) incoming=data.projects;
      else if(data.type==="metalab-project"&&data.project) incoming=[data.project];
      else if(Array.isArray(data)) incoming=data;
      else if(data.id&&data.name) incoming=[data];
      else throw new Error("Unrecognised file");
      // assign fresh ids to avoid collisions, prefix imported names
      const remapped=incoming.map(p=>({...p,id:uid(),name:(p.name||"Imported")+(projects.some(x=>x.name===p.name)?" (imported)":""),modified:now()}));
      const next=[...remapped,...projects];
      setProjects(next);setActiveId(remapped[0].id);save(next);
    }catch(err){ alert&&alert("Import failed: "+err.message); }
    if(importRef.current)importRef.current.value="";
  };

  // Self-contained report HTML (print CSS + embedded figures). The export
  // dialog offers PDF (print window) or HTML file — user chooses explicitly.
  const buildReportHTML=(precOverride)=>{
    if(!project) return null;
    const p=project, pico=p.pico||{}, pr=p.prisma||{};
    const res=runMeta(p.studies||[],"random");
    const esType=(p.studies||[]).map(s=>s.esType).filter(Boolean)[0]||"";
    const t=ES_TYPES[esType]||{}; const isLog=!!t.log, isProp=esType==="PROP";
    const bt=x=>isLog?Math.exp(x):isProp?(()=>{const e=Math.exp(x);return e/(1+e);})():x;
    const prec=precOverride||p.analysisPrecision; // prompt32 Task 8 — honor export-dialog precision
    const dv=x=>x==null?"—":isProp?fmtPct(bt(x),prec)+"%":isLog?fmtES(bt(x),prec):fmtES(+x,prec);
    const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const forest=res?buildPubForestSVG(res,{esType,esLabel:t.scale||"Effect",nullLine:0,showCounts:true,showWeights:true,title:"",prec}):null;
    const prismaFig=buildPrismaSVG(pr,{title:""});
    const grade=p.grade||{};
    const gradeRows=GRADE_DOMAINS.map(d=>{const o=GRADE_OPTIONS.find(x=>x.v===grade[d.id]);return `<tr><td>${esc(d.label)}</td><td>${o?esc(o.label):"—"}</td></tr>`;}).join("");
    const studyRows=(p.studies||[]).filter(s=>s.es!=="").map(s=>`<tr><td>${esc((s.author||"")+(s.year?" "+s.year:""))}</td><td>${esc(s.outcome||"")}</td><td style="text-align:right">${dv(+s.es)}</td><td style="text-align:right">${dv(+s.lo)} to ${dv(+s.hi)}</td></tr>`).join("");
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.name)} — Report</title>
    <style>
      @page{margin:18mm;} body{font-family:Georgia,'Times New Roman',serif;color:#111;line-height:1.5;max-width:760px;margin:0 auto;padding:20px;}
      h1{font-size:20px;border-bottom:2px solid #111;padding-bottom:6px;} h2{font-size:15px;margin-top:24px;border-bottom:1px solid #999;padding-bottom:3px;}
      table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0;} th,td{border:1px solid #bbb;padding:4px 8px;text-align:left;} th{background:#f0f0f0;}
      .muted{color:#555;font-size:12px;} svg{max-width:100%;height:auto;} .pico div{margin:3px 0;font-size:13px;}
      .toolbar{position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #ddd;margin-bottom:14px;}
      .toolbar button{padding:8px 16px;font-size:13px;cursor:pointer;border:1px solid #888;border-radius:6px;background:#f5f5f5;}
      @media print{.toolbar{display:none;}}
    </style></head><body>
    <div class="toolbar"><button onclick="window.print()">🖨 Print / Save as PDF</button></div>
    <h1>${esc(p.name)}</h1>
    <div class="muted">Systematic review &amp; meta-analysis report · generated ${new Date().toLocaleDateString()} · META·LAB</div>

    <h2>Review question (PICO)</h2>
    <div class="pico">
      ${pico.question?`<div><strong>Question:</strong> ${esc(pico.question)}</div>`:""}
      <div><strong>Population:</strong> ${esc(pico.P||"—")}</div>
      <div><strong>Intervention:</strong> ${esc(pico.I||"—")}</div>
      <div><strong>Comparator:</strong> ${esc(pico.C||"—")}</div>
      <div><strong>Outcome:</strong> ${esc(pico.O||"—")}</div>
      ${pico.prosperoId?`<div><strong>PROSPERO:</strong> ${esc(pico.prosperoId)}</div>`:""}
    </div>

    <h2>PRISMA 2020 flow</h2>
    ${prismaFig.svg}

    <h2>Included studies (with effect sizes)</h2>
    <table><thead><tr><th>Study</th><th>Outcome</th><th>Effect</th><th>95% CI</th></tr></thead><tbody>${studyRows||'<tr><td colspan="4">No studies with effect sizes.</td></tr>'}</tbody></table>

    ${res?`<h2>Meta-analysis</h2>
    <table>
      <tr><th>Model</th><th>Estimate</th><th>95% CI</th></tr>
      <tr><td>Common / fixed effect</td><td>${dv(res.fixed.es)}</td><td>${dv(res.fixed.lo)} to ${dv(res.fixed.hi)}</td></tr>
      <tr><td>Random effects (DL)</td><td>${dv(res.random.es)}</td><td>${dv(res.random.lo)} to ${dv(res.random.hi)}</td></tr>
      ${res.hksj?`<tr><td>Random effects (HKSJ)</td><td>${dv(res.hksj.es)}</td><td>${dv(res.hksj.lo)} to ${dv(res.hksj.hi)}</td></tr>`:""}
      ${res.predInt?`<tr><td>95% prediction interval</td><td>—</td><td>${dv(res.predInt.lo)} to ${dv(res.predInt.hi)}</td></tr>`:""}
    </table>
    <div class="muted">Heterogeneity: I² = ${res.I2}%, τ² = ${fmtNum(res.tau2,prec)}, Q = ${fmtNum(res.Q,prec)} (df ${res.k-1}, p ${res.Qpval<0.001?"&lt; 0.001":"= "+fmtNum(res.Qpval,prec)}). k = ${res.k} studies.</div>
    <h2>Forest plot</h2>${forest?forest.svg:""}`:"<h2>Meta-analysis</h2><div class='muted'>Not enough studies with effect sizes to pool.</div>"}

    <h2>GRADE certainty of evidence</h2>
    <table><thead><tr><th>Domain</th><th>Rating</th></tr></thead><tbody>${gradeRows}</tbody></table>

    <div class="muted" style="margin-top:30px;border-top:1px solid #ccc;padding-top:8px;">Generated by META·LAB. Verify all numbers against your primary analysis before submission. Statistical methods: inverse-variance fixed effect and DerSimonian–Laird random effects${res&&res.hksj?", with Hartung–Knapp–Sidik–Jonkman adjustment":""}.</div>
    </body></html>`;
    return html;
  };

  // prompt42 Task 8 — assemble the one-click journal-submission ZIP. Orchestrates
  // the EXISTING pure builders (PRISMA + per-outcome forest SVGs, study table CSV,
  // methods text, full report HTML) into a single ZIP, never re-implementing them.
  // Server authorizes + audits first (export permission); figures are client-rendered
  // (they are live SVGs), so the ZIP is assembled in the browser. Missing pieces become
  // warnings, never a hard failure. `onProgress` feeds the dialog's step text.
  const buildJournalSubmissionZip=async(choice,onProgress)=>{
    if(!project) throw new Error("No project selected.");
    const report=(m)=>{ try{ onProgress&&onProgress(m); }catch(_){/* ignore */} };
    const prec=choice?.precision;
    const widthPx=choice?.widthPx||1063;
    const transparent=!!choice?.transparent;
    const studies=Array.isArray(project.studies)?project.studies:[];
    const pr=project.prisma||{};
    const warnings=[]; const files=[]; const entries=[];

    // 0) Server authorize + audit (enforces export permission; supplies manifest meta).
    report("Authorizing…");
    let authInfo={ appVersion:"", generatedAt:new Date().toISOString(), projectTitle:project.name||"" };
    {
      let r;
      try{ r=await fetch(`/api/export/journal-submission/${activeId}`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:"{}"}); }
      catch(_){ throw new Error("Could not reach the server to authorize the export. Check your connection and retry."); }
      if(r.status===403) throw new Error("You do not have permission to export this project.");
      if(r.status===404) throw new Error("Project not found, or export is unavailable.");
      if(!r.ok) throw new Error(`Export could not be authorized (HTTP ${r.status}).`);
      try{ const d=await r.json(); if(d&&d.ok) authInfo={...authInfo,...d}; }catch(_){/* keep defaults */}
    }

    // 1) PRISMA diagram — SVG + high-res PNG.
    report("Preparing PRISMA diagram…");
    try{
      const built=buildPrismaSVG(pr,{title:""});
      if(built&&built.svg){
        entries.push({name:"figures/prisma-diagram.svg",text:SVG_XML_HEADER+built.svg});
        files.push({name:"figures/prisma-diagram.svg",note:"PRISMA 2020 flow (vector)"});
        try{
          const png=await rasterizeSvg(built.svg,built.W,built.H,{targetWidthPx:widthPx,transparent,background:"#ffffff"});
          entries.push({name:"figures/prisma-diagram.png",blob:png});
          files.push({name:"figures/prisma-diagram.png",note:"PRISMA 2020 flow (raster)"});
        }catch(_){ warnings.push("PRISMA PNG could not be rasterized — the SVG is included."); }
      } else warnings.push("PRISMA diagram could not be generated.");
    }catch(_){ warnings.push("PRISMA diagram could not be generated."); }

    // 2) Forest plots — one per outcome (same enumeration as ForestTab).
    report("Preparing forest plots…");
    const pairs=jsOutcomePairs(studies);
    if(!pairs.length) warnings.push("No outcomes with effect sizes — no forest plots were generated.");
    let forestN=0;
    const usedForestSlugs=new Set(); // guard duplicate ZIP entry names (distinct labels can slugify the same)
    for(const pair of pairs){
      const fs=jsFilterStudies(studies,pair);
      const result=runMeta(fs,"random");
      if(!result){ warnings.push(`Forest plot for "${pair.label}" skipped (not enough data).`); continue; }
      const esType=(fs.map(s=>s.esType).filter(Boolean)[0])||pair.esType||"";
      const t=ES_TYPES[esType]||{};
      const esLabel=(t.scale||"Effect size")+(t.log?" (back-transformed)":esType==="PROP"?" (%)":"");
      const built=buildPubForestSVG(result,{esType,esLabel,nullLine:0,showCounts:true,showWeights:true,title:pair.label||"",prec,noBg:transparent});
      if(!built){ warnings.push(`Forest plot for "${pair.label}" skipped (not enough studies to draw).`); continue; }
      let slug=jsSafeName(pair.label,`outcome-${forestN+1}`);
      if(usedForestSlugs.has(slug)) slug=`${slug}-${forestN+1}`; // distinct labels can slugify identically → keep unique
      usedForestSlugs.add(slug);
      const base=`figures/forest-plot-${slug}`;
      entries.push({name:`${base}.svg`,text:SVG_XML_HEADER+built.svg});
      files.push({name:`${base}.svg`,note:`Forest plot — ${pair.label}`});
      try{
        const png=await rasterizeSvg(built.svg,built.W,built.H,{targetWidthPx:widthPx,transparent,background:"#ffffff"});
        entries.push({name:`${base}.png`,blob:png});
        files.push({name:`${base}.png`,note:`Forest plot (raster) — ${pair.label}`});
      }catch(_){ warnings.push(`Forest PNG for "${pair.label}" could not be rasterized — the SVG is included.`); }
      forestN++;
    }

    // 3) Methods text (markdown) — drafted from the project's actual settings + primary result.
    report("Preparing methods text…");
    try{
      const primary=pairs.length?runMeta(jsFilterStudies(studies,pairs[0]),"random"):null;
      const esType0=pairs.length?((jsFilterStudies(studies,pairs[0]).map(s=>s.esType).filter(Boolean)[0])||pairs[0].esType||""):"";
      const idTotal=(+pr.dbs||0)+(+pr.reg||0)+(+pr.other||0);
      const md=jsMethodsMarkdown({
        projectName:project.name,
        generatedAt:new Date(authInfo.generatedAt).toLocaleDateString(),
        software:authInfo.appVersion?`META·LAB ${authInfo.appVersion}`:"META·LAB",
        pico:project.pico||{},
        registration:(project.pico&&project.pico.prosperoId)||"",
        prisma:{identified:idTotal||null,deduped:(+pr.dedupe||null),included:(+pr.included||null)},
        screening:{},
        measure:(ES_TYPES[esType0]&&ES_TYPES[esType0].label)||"",
        model:"random",
        hksj:!!(primary&&primary.hksj),
        k:primary?primary.k:undefined,
        heterogeneity:primary?{I2:primary.I2,tau2:fmtNum(primary.tau2,prec),Q:fmtNum(primary.Q,prec),Qdf:primary.k-1,Qp:primary.Qpval}:{},
        predInterval:!!(primary&&primary.predInt),
        outcomes:pairs.map(p=>p.label),
        robTool:"Cochrane RoB 2 (effect of assignment)",
        grade:!!(project.grade&&Object.keys(project.grade).length),
      });
      entries.push({name:"methods-text.md",text:md});
      files.push({name:"methods-text.md",note:"Auto-drafted Methods section (review before use)"});
    }catch(_){ warnings.push("Methods text could not be generated."); }

    // 4) Study table (CSV) + full report (HTML).
    report("Preparing study table…");
    // Best-effort RoB summary per study for the table's "Risk of bias" column — owner-
    // scoped + flag-gated, so it degrades to blank when unavailable. When a study has
    // several outcome-level assessments, the WORST judgement is shown (conservative).
    let robByStudy={};
    try{
      const rr=await fetch(`/api/rob/projects/${activeId}/assessments`,{credentials:"include",headers:{Accept:"application/json"}});
      if(rr.ok){
        const rd=await rr.json(); const rank={low:1,some:2,high:3}; const lbl={low:"Low",some:"Some concerns",high:"High"}; const tmp={};
        for(const a of ((rd&&rd.assessments)||[])){ const r=rank[a&&a.overall]; if(!a||!a.studyId||!r) continue; if(!tmp[a.studyId]||r>tmp[a.studyId].r) tmp[a.studyId]={r,label:lbl[a.overall]}; }
        for(const k in tmp) robByStudy[k]=tmp[k].label;
      }
    }catch(_){ /* RoB unavailable / not owner / flag off — leave the column blank */ }
    try{
      entries.push({name:"study-table.csv",text:jsStudyTableCSV(studies,robByStudy)});
      files.push({name:"study-table.csv",note:"Included-studies characteristics table"});
      if(!studies.length) warnings.push("No studies in the project — the study table is empty.");
    }catch(_){ warnings.push("Study table could not be generated."); }
    report("Preparing report…");
    try{
      const html=buildReportHTML(prec);
      if(html){ entries.push({name:"report.html",text:html}); files.push({name:"report.html",note:"Full self-contained report (open in a browser)"}); }
    }catch(_){ warnings.push("Report HTML could not be generated."); }

    // 5) README / manifest / warnings, then ZIP + download.
    report("Creating ZIP…");
    const readme=jsReadme({projectName:project.name,generatedAt:new Date(authInfo.generatedAt).toLocaleString(),appVersion:authInfo.appVersion,files,warnings});
    entries.push({name:"README.md",text:readme});
    entries.push({name:"manifest.json",text:JSON.stringify(jsManifest({projectId:activeId,projectTitle:project.name,generatedAt:authInfo.generatedAt,generatedBy:(authUser&&(authUser.email||authUser.name))||"",appVersion:authInfo.appVersion,includedFiles:files,warnings}),null,2)});
    entries.push({name:"warnings.txt",text:jsWarnings(warnings)});

    const zipBlob=await zipFiles(entries);
    const datePart=new Date(authInfo.generatedAt).toISOString().slice(0,10);
    downloadBlob(zipBlob,`${jsSafeName(project.name,"project")}-journal-submission-${datePart}.zip`);
  };
  const openJournalSubmissionExport=()=>{
    if(!project)return;
    setExpItem({
      id:"journal-submission",
      title:`Journal submission package — ${project.name||"project"}`,
      formats:[{id:"zip",label:"ZIP package — PRISMA · forest plots · methods · study table · report"}],
      sizing:true,
      defaults:{format:"zip",presetId:"journal-1col"},
      run:async(choice,onProgress)=>{ await buildJournalSubmissionZip(choice,onProgress); },
    });
  };

  // prompt44 item 2 — generate + download an R (metafor) validation script for every
  // poolable outcome, so the pooled estimate / CI / heterogeneity / prediction interval
  // can be INDEPENDENTLY reproduced in R/RStudio. Pure generator + a text download; no
  // in-app execution and no extra permission (it only re-states data the user can see).
  const downloadRValidationScript=()=>{
    if(!project) return;
    const studies=Array.isArray(project.studies)?project.studies:[];
    const pairs=jsOutcomePairs(studies);
    const outcomes=[];
    for(const pair of pairs){
      const fs=jsFilterStudies(studies,pair);
      const result=runMeta(fs,"random");
      if(!result) continue;
      const esType=(fs.map(s=>s.esType).filter(Boolean)[0])||pair.esType||"";
      const t=ES_TYPES[esType]||{};
      outcomes.push({
        label:pair.label||"Outcome",
        esType, esTypeLabel:t.label||esType, isLog:!!t.log,
        // The app's HEADLINE pooled CI (lo95/hi95) is the normal-theory (Z-based) DL CI,
        // NOT the Hartung–Knapp variant, so the validation script must reproduce THAT —
        // rma(method="DL") without test="knha" — for an apples-to-apples comparison.
        model:"random", hksj:false,
        studies:fs.map((s,i)=>({label:(s.author||s.study||s.name||s.label||`Study ${i+1}`),es:s.es,lo:s.lo,hi:s.hi})),
        app:{ k:result.k, pooled:result.pES, lo:result.lo95, hi:result.hi95, I2:result.I2, tau2:result.tau2, Q:result.Q, Qp:result.Qpval, predLo:result.predInt&&result.predInt.lo, predHi:result.predInt&&result.predInt.hi },
      });
    }
    const script=buildMetaValidationR({ projectName:project.name, generatedAt:new Date().toISOString(), outcomes });
    downloadText(script,`${jsSafeName(project.name,"project")}-r-validation.R`,"text/plain;charset=utf-8");
  };

  // prompt9 Task 6 — report + project-JSON exports open the shared dialog.
  const openReportExport=()=>{
    if(!project)return;
    const htmlName=(project.name||"report").replace(/[^a-z0-9]/gi,"_")+"_report.html";
    setExpItem({
      id:"project-report",
      title:`Report — ${project.name||"project"}`,
      formats:[{id:"pdf",label:"PDF (print dialog)"},{id:"html",label:"HTML file"}],
      sizing:false,
      defaults:{format:"pdf"},
      run:async(choice)=>{
        const html=buildReportHTML(choice.precision);
        if(!html) throw new Error("No project selected.");
        if(choice.format==="pdf"){
          // Existing print-window path; if pop-ups are blocked the user can
          // pick "HTML file" instead (the inline error tells them so).
          let opened=null;
          try{ opened=window.open("","_blank"); }catch(_){ opened=null; }
          if(!(opened&&opened.document))
            throw new Error("Pop-up blocked — allow pop-ups for this site, or choose 'HTML file' instead.");
          opened.document.write(html); opened.document.close();
        } else {
          downloadBlob(new Blob([html],{type:"text/html"}),htmlName);
        }
      },
    });
  };
  const openProjectExport=()=>{
    if(!project)return;
    const jsonName=(project?.name||"project").replace(/[^a-z0-9]/gi,"_")+".json";
    setExpItem({
      id:"project-json",
      title:`Project backup — ${jsonName}`,
      formats:[{id:"json",label:"JSON (portable project file)"}],
      sizing:false,
      run:async()=>{exportProject(false);},   // existing payload shape, unchanged
    });
  };

  if(loading) return(
    <div style={{background:C.bg,color:C.txt,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'IBM Plex Sans',sans-serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{
          width:56,height:56,borderRadius:14,
          background:`linear-gradient(135deg,${themeAlpha(C.acc,'30')},${themeAlpha(C.acc,'10')})`,
          border:`1px solid ${themeAlpha(C.acc,'40')}`,
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:28,margin:"0 auto 16px",
        }} className="pulse-soft"><Icon name="flask" size={26} style={{color:C.acc}}/></div>
        <div style={{fontSize:15,fontWeight:700,color:C.txt,marginBottom:6}}>META·LAB</div>
        <div style={{color:C.muted,fontSize:12}}>Loading your workspace…</div>
      </div>
    </div>
  );

  // prompt19 — Screening workspace gets a full-bleed, focus layout (escapes the
  // 960px content clamp + the project header). `focus` also slides the sidebar away.
  const inScreening=!!project&&tab==="screening";
  // prompt42 Task 7 — the OPEN RoB assessment workspace is full-bleed + no page scroll
  // (gated strictly on the per-study workspace being open, so the RoB OVERVIEW list
  // still scrolls normally). noPageScroll drives the body container's overflow/padding.
  const robFullbleed=!!project&&tab==="rob"&&robInWorkspace&&!robNarrow;
  const noPageScroll=inScreening||robFullbleed;
  // prompt34 Task 8 — one shared collapse across every tab (no Screening-only
  // special case); the ☰ button in the universal header toggles it everywhere.
  const focus=navCollapsed;
  const toggleNav=()=>setNavCollapsed(c=>!c);
  // prompt36/39 — navigating TO a main workflow step (via a left-menu workflow item
  // or the "Next" button) auto-collapses the menu into focus mode, but ONLY when the
  // user's menu mode is "auto" (not pinned). Overview / Project Control never
  // collapse. The rule is centralized in shouldAutoCollapseWorkflowMenu (Task 6).
  const goTab=(id)=>{ setTab(id); if(shouldAutoCollapseWorkflowMenu({toId:id,mode:workflowMenuMode})) setNavCollapsed(true); };
  // prompt39 Task 5 — pin/auto toggle. Persists per-user (best-effort) and updates
  // the cached auth user so the choice survives refresh/relogin cross-device.
  // Pinning also expands the menu immediately ("stays open").
  const setWorkflowMenuMode=(mode)=>{
    const next=mode==="pinned"?"pinned":"auto";
    if(typeof setUser==="function") setUser(u=>u?{...u,workflowMenuMode:next}:u);
    if(next==="pinned") setNavCollapsed(false);
    try{ api.profile.update({workflowMenuMode:next}); }catch{ /* best-effort persist */ }
  };
  return(<div style={{display:"flex",minHeight:"100vh",background:C.bg,fontFamily:"'IBM Plex Sans',sans-serif",color:C.txt}}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;700&display=swap');

      :root{
        --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
        --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
        --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
        --sidebar-w: 256px;
      }

      *{box-sizing:border-box;margin:0;padding:0;}
      html{scroll-behavior:smooth;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}
      body{background:${C.bg};color:${C.txt};}

      /* prompt36 Tasks 3/4/5 — honour the user's reduced-motion preference: the
         workflow-menu slide, the collapse-arrow rotation and the settings switch
         knob all snap instantly instead of animating. */
      @media (prefers-reduced-motion: reduce){
        .ml-sidebar,.ml-main,.ml-menu-arrow,.ml-switch-knob{transition:none!important;}
      }

      /* Scrollbars */
      ::-webkit-scrollbar{width:3px;height:3px;}
      ::-webkit-scrollbar-track{background:transparent;}
      ::-webkit-scrollbar-thumb{background:${C.brd};border-radius:99px;transition:background 0.2s ease;}
      ::-webkit-scrollbar-thumb:hover{background:${C.muted};}

      /* Inputs */
      input,textarea,select{transition:border-color 0.15s ease,box-shadow 0.15s ease;}
      input:focus,textarea:focus,select:focus{
        outline:none!important;
        border-color:${themeAlpha(C.acc,'80')}!important;
        box-shadow:0 0 0 3px ${themeAlpha(C.acc,'14')}!important;
      }
      /* Keyboard-only focus ring */
      button:focus-visible,[role="button"]:focus-visible,.nav-item:focus-visible{
        outline:none;box-shadow:0 0 0 2px ${themeAlpha(C.acc,'50')};border-radius:8px;
      }

      /* Buttons — specific properties (never transition:all), instant press feedback */
      button{transition:transform 0.13s var(--ease-out),box-shadow 0.18s ease,filter 0.15s ease,background 0.18s ease,border-color 0.15s ease,opacity 0.15s ease;}
      button:active:not(:disabled){transform:scale(0.97);}

      /* Links */
      a{text-decoration:none;color:${C.acc};transition:opacity 0.12s ease;}

      /* Sidebar nav items */
      .nav-item{transition:background 0.14s ease,border-color 0.14s ease,transform 0.14s var(--ease-out);}

      /* Smooth tab content — fast (switched often), entrance only */
      .tab-content{animation:tabIn 0.2s var(--ease-out) both;}
      @keyframes tabIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      /* prompt24 — the utility cluster moved INTO the universal header (no longer
         floats over content), so the old right-padding reservation is gone. The
         header's "Project overview"/"Projects" labels collapse to icons on narrow
         widths so the cluster never gets crowded. */
      @media (max-width:900px){ .uh-navlabel{ display:none; } }
      @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}

      /* Staggered entrance for grids/lists (first-load delight) */
      .stagger-grid>*{opacity:0;animation:staggerIn 0.42s var(--ease-out) forwards;}
      .stagger-grid>*:nth-child(1){animation-delay:40ms}
      .stagger-grid>*:nth-child(2){animation-delay:90ms}
      .stagger-grid>*:nth-child(3){animation-delay:140ms}
      .stagger-grid>*:nth-child(4){animation-delay:190ms}
      .stagger-grid>*:nth-child(5){animation-delay:240ms}
      .stagger-grid>*:nth-child(6){animation-delay:290ms}
      .stagger-grid>*:nth-child(n+7){animation-delay:320ms}
      @keyframes staggerIn{from{opacity:0;transform:translateY(10px) scale(0.985)}to{opacity:1;transform:translateY(0) scale(1)}}

      /* Card hover lift */
      .hover-lift{transition:box-shadow 0.2s ease,transform 0.2s var(--ease-out),border-color 0.2s ease;}

      /* Stat numbers */
      .stat-num{font-variant-numeric:tabular-nums;}

      /* Overview alignment grids (prompt7 Task 2) */
      .ov-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:stretch;}
      .ov-grid2>*{min-width:0;}
      .ov-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}
      .ov-grid4>*{min-width:0;}
      @media (max-width:1100px){
        .ov-grid2{grid-template-columns:1fr;}
        .ov-grid4{grid-template-columns:repeat(2,1fr);}
      }

      /* Subtle glow on active accent elements */
      .glow-acc{box-shadow:0 0 20px ${themeAlpha(C.acc,'22')};}

      /* Progress bar transitions */
      .prog-bar{transition:width 0.4s var(--ease-out),background 0.3s ease;}

      /* Spinner — fast spin makes loading feel faster */
      .spin-ico{display:inline-block;animation:spin 0.7s linear infinite;}
      @keyframes spin{to{transform:rotate(360deg)}}

      /* Soft pulse for the loading splash logo */
      .pulse-soft{animation:pulseSoft 1.8s var(--ease-in-out) infinite;}
      @keyframes pulseSoft{0%,100%{transform:scale(1);box-shadow:0 0 0 0 ${themeAlpha(C.acc,'22')}}50%{transform:scale(1.04);box-shadow:0 0 22px 2px ${themeAlpha(C.acc,'22')}}}

      /* Tooltip */
      [title]{cursor:help;}

      /* details/summary */
      details>summary{cursor:pointer;user-select:none;list-style:none;}
      details>summary::-webkit-details-marker{display:none;}

      /* Modals — fade backdrop, scale panel in from centre */
      .modal-bg{backdrop-filter:blur(4px);animation:modalBgIn 0.2s ease-out both;}
      @keyframes modalBgIn{from{opacity:0}to{opacity:1}}
      .modal-bg>div{animation:modalIn 0.24s var(--ease-out) both;transform-origin:center;}
      @keyframes modalIn{from{opacity:0;transform:scale(0.96) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}

      /* Hover effects gated to real pointers so touch taps don't get stuck hover */
      @media (hover:hover) and (pointer:fine){
        button:hover:not(:disabled){filter:brightness(1.1);}
        a:hover{opacity:0.75;}
        .nav-item:hover{background:${C.card}!important;}
        .hover-lift:hover{box-shadow:0 8px 32px var(--t-shadow),0 2px 8px var(--t-shadow);transform:translateY(-2px);border-color:${C.brd2}!important;}
      }

      /* Respect reduced-motion: keep fades, drop movement & continuous spin slows */
      @media (prefers-reduced-motion:reduce){
        html{scroll-behavior:auto;}
        .tab-content,.modal-bg>div,.stagger-grid>*{animation:rmFade 0.16s ease both;}
        .pulse-soft{animation:none;}
        button:active:not(:disabled){transform:none;}
        .nav-item:hover{transform:none;}
        .hover-lift:hover{transform:none;}
      }
      @keyframes rmFade{from{opacity:0}to{opacity:1}}
    `}</style>

    {/* New project modal */}
    {showModal&&(<div className="modal-bg" style={{position:"fixed",inset:0,background:"#00000099",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{
        background:C.surf,border:`1px solid ${C.brd2}`,borderRadius:14,padding:28,width:400,
        boxShadow:"0 24px 80px var(--t-shadow)",
      }}>
        <div style={{fontSize:16,fontWeight:800,marginBottom:6,color:C.txt}}>New Project</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:18,lineHeight:1.5}}>Give your systematic review a descriptive name — you can change it later.</div>
        <input autoFocus value={newName} onChange={e=>setNewName(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter")confirmAdd();if(e.key==="Escape")setShowModal(false);}}
          placeholder="e.g. Metformin in T2DM — systematic review 2025"
          style={{...inp,marginBottom:14,fontSize:13}}/>
        {/* prompt6 Task 2 — linked META·SIFT screening project, default ON */}
        <label style={{display:"flex",alignItems:"flex-start",gap:9,cursor:"pointer",marginBottom:18,userSelect:"none"}}>
          <input type="checkbox" checked={withSift} onChange={e=>setWithSift(e.target.checked)}
            style={{accentColor:C.acc,width:15,height:15,marginTop:1,flexShrink:0}}/>
          <span style={{fontSize:12,color:C.txt2,lineHeight:1.5}}>
            Set up <strong style={{color:"var(--t-teal)"}}>Screening</strong> for this project
            <span style={{display:"block",fontSize:10.5,color:C.muted,marginTop:2}}>
              Same owner and title — screening decisions, PRISMA numbers, and accepted studies sync into this review.
            </span>
          </span>
        </label>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={()=>setShowModal(false)} disabled={creatingProject} style={btnS("ghost")}>Cancel</button>
          <button onClick={confirmAdd} disabled={!newName.trim()||creatingProject} style={{...btnS("primary"),opacity:(newName.trim()&&!creatingProject)?1:0.45}}>
            {creatingProject?"Creating…":"Create Project"}
          </button>
        </div>
      </div>
    </div>)}

    {/* Typed-name confirm delete modal (prompt9 Task 7) */}
    {confirmDel&&(()=>{
      const delProj=projects.find(p=>p.id===confirmDel);
      if(!delProj)return null;
      const linkedTitle=delProj._linkedMetaSift&&delProj._linkedMetaSift.id
        ?(delProj._linkedMetaSift.title||"linked META·SIFT workspace"):null;
      const nameOk=delName.trim()===(delProj.name||"");
      const closeDel=()=>{if(delBusy)return;setConfirmDel(null);setDelName("");setDelErr("");};
      return(<div className="modal-bg" style={{position:"fixed",inset:0,background:"#00000099",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
        <div style={{
          background:C.surf,border:`1px solid ${themeAlpha(C.red,'55')}`,borderRadius:14,padding:28,width:460,maxWidth:"94vw",
          maxHeight:"90vh",overflowY:"auto",boxShadow:"0 24px 80px var(--t-shadow)",
        }}>
          <div style={{fontSize:16,fontWeight:800,marginBottom:8,color:C.red}}>⚠ Delete project — this cannot be undone</div>
          <div style={{fontSize:12.5,color:C.txt2,marginBottom:10,lineHeight:1.55}}>
            You are about to <strong style={{color:C.red}}>permanently delete</strong> <strong style={{color:C.txt}} className="t-wrap">{delProj.name}</strong>. This removes:
          </div>
          <ul style={{margin:"0 0 16px 18px",padding:0,fontSize:12,color:C.muted,lineHeight:1.75}}>
            <li>The META·LAB project — studies, extraction data, analyses, and figures</li>
            {linkedTitle&&<li>Its screening workspace <strong style={{color:C.txt2}}>{linkedTitle}</strong></li>}
            <li>All screening records and screening decisions</li>
            <li>Project chats and messages</li>
            <li>Uploaded PDFs and attachments</li>
            <li>Exports and audit history</li>
          </ul>
          <div style={{fontSize:11.5,color:C.txt2,marginBottom:6}}>
            Type the project name <strong style={{color:C.txt,fontFamily:"'IBM Plex Mono',monospace"}}>{delProj.name}</strong> to confirm:
          </div>
          <input autoFocus value={delName} disabled={delBusy}
            onChange={e=>{setDelName(e.target.value);setDelErr("");}}
            onKeyDown={e=>{
              if(e.key==="Enter"&&nameOk&&!delBusy)confirmDelete();
              if(e.key==="Escape")closeDel();
            }}
            placeholder={delProj.name}
            style={{...inp,marginBottom:10,fontSize:13}}/>
          {delErr&&(
            <div style={{marginBottom:10,padding:"7px 11px",background:"var(--t-red-bg)",
              border:`1px solid ${themeAlpha(C.red,'44')}`,borderRadius:6,color:C.red,fontSize:11.5,lineHeight:1.5}}>
              {delErr}
            </div>
          )}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={closeDel} disabled={delBusy} style={{...btnS("ghost"),opacity:delBusy?0.5:1}}>Cancel</button>
            <button onClick={confirmDelete} disabled={!nameOk||delBusy}
              style={{...btnS("danger"),opacity:(!nameOk||delBusy)?0.5:1,cursor:(!nameOk||delBusy)?"not-allowed":"pointer"}}>
              {delBusy?"Deleting…":"Delete permanently"}
            </button>
          </div>
        </div>
      </div>);
    })()}

    {/* Sidebar — slides away when the workflow menu is collapsed (prompt19/34/36)
        so the workbench gets the full viewport width. Toggled by the arrow button
        in the universal header, and auto-collapsed when entering a workflow step. */}
    <div className="ml-sidebar" style={{
      width:256,background:C.surf,
      borderRight:`1px solid ${C.brd}`,
      display:"flex",flexDirection:"column",
      position:"fixed",top:0,left:0,bottom:0,zIndex:100,
      boxShadow:"1px 0 0 0 "+C.brd,
      transform:focus?"translateX(-100%)":"none",
      transition:"transform 0.25s ease",
    }}>
      {/* Branding */}
      <div style={{padding:"18px 16px 14px",borderBottom:`1px solid ${C.brd}`}}>
        <div style={{display:"flex",alignItems:"center",gap:9}}>
          <div style={{
            width:28,height:28,borderRadius:8,
            background:`linear-gradient(135deg,${themeAlpha(C.acc,'40')},${themeAlpha(C.acc2,'28')})`,
            display:"flex",alignItems:"center",justifyContent:"center",color:C.acc,flexShrink:0,
          }}><Icon name="hexagon" size={14}/></div>
          <div>
            <div style={{fontSize:14,fontWeight:800,color:C.txt,letterSpacing:-0.2,lineHeight:1}}>META·LAB</div>
            <div style={{fontSize:9.5,color:C.muted,letterSpacing:0.6,marginTop:2,textTransform:"uppercase"}}>Systematic Review</div>
          </div>
        </div>
      </div>

      {/* Back to the META·LAB project landing (prompt12 Task 1). Sidebar is fixed
         on every tab, so this is reachable from overview/extraction/PRISMA/analysis/
         methods/control alike. Wired via AppWorkspace (the monolith isn't router-aware). */}
      {onBackToProjects&&(
        <button onClick={onBackToProjects} title="Back to all projects" style={{
          display:"flex",alignItems:"center",gap:8,width:"100%",
          padding:"10px 16px",background:"none",border:"none",
          borderBottom:`1px solid ${C.brd}`,color:C.muted,cursor:"pointer",
          fontSize:11.5,fontWeight:600,fontFamily:"inherit",textAlign:"left",letterSpacing:0.2,
          transition:"color 0.15s ease,background 0.15s ease",
        }}
          onMouseEnter={e=>{e.currentTarget.style.color=C.txt;e.currentTarget.style.background=themeAlpha(C.acc,'0c');}}
          onMouseLeave={e=>{e.currentTarget.style.color=C.muted;e.currentTarget.style.background="none";}}
        ><Icon name="arrowLeft" size={13}/>Back to Projects</button>
      )}

      {/* prompt23 Task 1 — the redundant "Projects" switcher was removed from the
          workspace sidebar (it duplicated the project dashboard at /app and cluttered
          the panel). Use "Back to Projects" above to reach the dashboard, which owns
          project listing, creation, import, and deletion. */}

      {/* Project — meta tabs (Overview, Project Control); phase:null keeps them
          out of the workflow map, progress math, and the "Next step" walker */}
      {project&&(
        <div style={{padding:"8px 8px 6px",borderBottom:`1px solid ${C.brd}`}}>
          <div style={{fontSize:9,fontWeight:700,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:6,padding:"0 10px"}}>Project</div>
          {TABS.filter(t=>t.group==="project").map(t=>{
            const on=tab===t.id;
            return(<div key={t.id} onClick={()=>setTab(t.id)} className="nav-item"
              style={{display:"flex",alignItems:"center",gap:9,padding:"6px 10px",borderRadius:7,cursor:"pointer",marginBottom:1,
                background:on?`${themeAlpha(C.acc,'1a')}`:"transparent"}}>
              <Icon name={t.icon} size={14} style={{flexShrink:0,opacity:0.85}}/>
              <span style={{fontSize:12,color:on?C.acc:C.txt2,fontWeight:on?600:400,flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.label}</span>
            </div>);
          })}
        </div>
      )}

      {/* Workflow steps */}
      {project&&(()=>{
        const status=stepStatus(project, screeningComplete); // prompt29 Part 9
        const wfTabs=TABS.filter(t=>t.phase); // workflow steps only — phase:null reference tabs stay out of progress math
        const doneCount=Object.values(status).filter(s=>s==="done").length;
        return(<div style={{padding:"8px 8px",flex:1,overflowY:"auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"2px 8px",marginBottom:8}}>
            <span style={{fontSize:9,fontWeight:700,color:C.muted,letterSpacing:0.8,textTransform:"uppercase"}}>Workflow</span>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              {/* prompt39 Tasks 5/7 — pin/auto-collapse toggle. SEPARATE from the
                  header arrow (which collapses/expands NOW): pinned keeps the menu
                  open during workflow navigation; auto lets it collapse. Saved
                  per-user automatically. */}
              <Tooltip content={workflowMenuMode==="pinned"?"Allow auto-collapse during workflow":"Pin workflow menu open"} wrapStyle={{display:"inline-flex"}}>
                <button onClick={()=>setWorkflowMenuMode(workflowMenuMode==="pinned"?"auto":"pinned")}
                  aria-label={workflowMenuMode==="pinned"?"Allow auto-collapse during workflow navigation":"Pin workflow menu open"}
                  aria-pressed={workflowMenuMode==="pinned"}
                  style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:21,height:21,borderRadius:5,
                    background:workflowMenuMode==="pinned"?themeAlpha(C.acc,'1a'):"none",
                    border:`1px solid ${workflowMenuMode==="pinned"?themeAlpha(C.acc,'45'):"transparent"}`,
                    color:workflowMenuMode==="pinned"?C.acc:C.muted,cursor:"pointer",padding:0,
                    transform:workflowMenuMode==="pinned"?"none":"rotate(45deg)",transition:"color 0.15s ease,background 0.15s ease"}}>
                  <Icon name="pin" size={12}/>
                </button>
              </Tooltip>
              <span style={{
                fontSize:9,fontWeight:600,fontFamily:"'IBM Plex Mono',monospace",
                color:doneCount===wfTabs.length?C.grn:C.muted,
              }}>{doneCount}/{wfTabs.length}</span>
            </div>
          </div>
          {PHASES.map((phase,pi)=>{
            const steps=TABS.filter(t=>t.phase===phase);
            const phaseDone=steps.filter(t=>status[t.id]==="done").length;
            const phaseActive=steps.some(t=>t.id===tab);
            // prompt31 Part 8 — ONE continuous line: the phase header carries the
            // gutter line connecting the previous phase's last step to this one.
            const firstGi=wfTabs.findIndex(x=>x.id===steps[0]?.id);
            const phaseLineGreen=firstGi>0&&status[wfTabs[firstGi-1].id]==="done";
            return(<div key={phase} style={{marginBottom:2}}>
              <div style={{display:"flex",alignItems:"stretch",gap:8}}>
                <div style={{position:"relative",width:20,flexShrink:0}}>
                  {pi>0&&<span style={{position:"absolute",top:0,bottom:0,left:"50%",transform:"translateX(-50%)",width:2,background:phaseLineGreen?C.grn:C.brd2}}/>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,flex:1,padding:"5px 6px 3px 0"}}>
                  <span style={{
                    fontSize:9,fontWeight:700,letterSpacing:0.7,textTransform:"uppercase",flex:1,
                    color:phaseActive?C.txt2:C.dim,
                  }}>{phase}</span>
                  <span style={{
                    fontSize:8,fontFamily:"'IBM Plex Mono',monospace",
                    color:phaseDone===steps.length?C.grn:C.dim,
                  }}>{phaseDone}/{steps.length}</span>
                </div>
              </div>
              <div style={{marginBottom:4}}>
                {/* prompt29 Part 10 — vertical stepper (pip + connector line) in
                    place of the old 5px dots; status drives the pip + line colour. */}
                {steps.map((t)=>{
                  const st=status[t.id];
                  const on=tab===t.id;
                  // Global position across ALL workflow steps → one connected line.
                  const gi=wfTabs.findIndex(x=>x.id===t.id);
                  const isGFirst=gi===0;
                  const isGLast=gi===wfTabs.length-1;
                  const prevDone=gi>0&&status[wfTabs[gi-1].id]==="done";
                  const pip=st==="done"?{ring:C.grn,fg:C.grn,bg:themeAlpha(C.grn,'22'),glyph:"check"}
                    :on?{ring:C.acc,fg:C.acc,bg:themeAlpha(C.acc,'22'),glyph:null}
                    :st==="partial"?{ring:C.yel,fg:C.yel,bg:themeAlpha(C.yel,'22'),glyph:null}
                    :{ring:C.brd2,fg:C.muted,bg:"transparent",glyph:null};
                  const statusWord=st==="done"?"Complete":on?"Current step":st==="partial"?"In progress":"Not started";
                  return(<div key={t.id} onClick={()=>goTab(t.id)} className="nav-item"
                    style={{
                      display:"flex",alignItems:"stretch",gap:8,
                      borderRadius:7,cursor:"pointer",marginBottom:1,
                      background:on?`${themeAlpha(C.acc,'1a')}`:"transparent",
                    }}>
                    {/* Stepper gutter: connector segments + status pip */}
                    <div style={{position:"relative",width:20,flexShrink:0,alignSelf:"stretch"}}>
                      {!isGFirst&&<span style={{position:"absolute",top:0,height:"50%",left:"50%",transform:"translateX(-50%)",width:2,background:prevDone?C.grn:C.brd2}}/>}
                      {!isGLast&&<span style={{position:"absolute",top:"50%",bottom:0,left:"50%",transform:"translateX(-50%)",width:2,background:st==="done"?C.grn:C.brd2}}/>}
                      <Tooltip content={`${t.label} — ${statusWord}`} wrapStyle={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",zIndex:1}}>
                        <span style={{width:16,height:16,borderRadius:"50%",border:`1.5px solid ${pip.ring}`,background:pip.bg,color:pip.fg,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:8.5,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",lineHeight:1}}>
                          {pip.glyph==="check"?<Icon name="check" size={9}/>:t.num}
                        </span>
                      </Tooltip>
                    </div>
                    <span style={{
                      padding:"7px 10px 7px 0",fontSize:12,
                      color:on?C.acc:st==="empty"?C.muted:C.txt2,
                      fontWeight:on?600:400,
                      flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,
                    }}>{t.label}</span>
                  </div>);
                })}
              </div>
            </div>);
          })}
        </div>);
      })()}

      {/* Reference — phase:null tabs (Methods & Equations), outside the PRISMA workflow */}
      {project&&(
        <div style={{padding:"8px 8px 6px",borderTop:`1px solid ${C.brd}`}}>
          <div style={{fontSize:9,fontWeight:700,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:6,padding:"0 10px"}}>Reference</div>
          {TABS.filter(t=>t.group==="reference").map(t=>{
            const on=tab===t.id;
            return(<div key={t.id} onClick={()=>setTab(t.id)} className="nav-item"
              style={{display:"flex",alignItems:"center",gap:9,padding:"6px 10px",borderRadius:7,cursor:"pointer",marginBottom:1,
                background:on?`${themeAlpha(C.acc,'1a')}`:"transparent"}}>
              <Icon name={t.icon} size={14} style={{flexShrink:0,opacity:0.85}}/>
              <span style={{fontSize:12,color:on?C.acc:C.txt2,fontWeight:on?600:400,flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.label}</span>
            </div>);
          })}
        </div>
      )}

      {/* Footer */}
      <div style={{
        padding:"8px 14px",borderTop:`1px solid ${C.brd}`,
        display:"flex",alignItems:"center",justifyContent:"space-between",
      }}>
        <div style={{fontSize:9,color:C.dim,fontFamily:"'IBM Plex Mono',monospace"}}>{appVersion?`v${appVersion} · `:""}PRISMA 2020</div>
        {project&&<button onClick={openProjectExport} title="Export project as JSON" style={{
          background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:10,
          padding:"2px 4px",borderRadius:4,transition:"color 0.15s",
        }}
          onMouseEnter={e=>e.currentTarget.style.color=C.txt2}
          onMouseLeave={e=>e.currentTarget.style.color=C.muted}
        >Export ↓</button>}
      </div>
    </div>

    {/* Main content — universal project header (prompt24) on top, scrolling body
        below. The header is shown on every project page; the body fills the rest
        and scrolls internally (full-bleed + hidden for the Screening workspace). */}
    <div className="ml-main" style={{marginLeft:focus?0:256,flex:1,display:"flex",flexDirection:"column",height:"100vh",minHeight:0,overflow:"hidden",transition:"margin-left 0.25s ease"}}>
      {project&&!deepLinkMiss&&(
        <ProjectHeaderBar project={project} tab={tab} inScreening={inScreening} focus={focus} onToggleFocus={toggleNav} setTab={setTab} onBackToProjects={onBackToProjects} presenceUsers={presenceUsers} presenceLocks={presenceLocks} totalMembers={project?._memberCount} myUserId={authUser?.id} spId={spId}
          reqMissing={headerStatus.reqMissing}
          reqMissingList={headerStatus.reqMissingList}
          missingItems={headerStatus.missingItems}
          onShowAudit={()=>setShowAudit(true)}
          onReport={openReportExport} onExport={openProjectExport} onJournalZip={openJournalSubmissionExport} onImport={()=>importRef.current&&importRef.current.click()}/>
      )}
      {/* prompt32 Task 5 — responsive global workspace gutter. The horizontal pad
          scales 20px → 5vw → 88px (≈5–10% on wide screens) so content never glues
          to the borders nor wastes space on ultra-wide; vertical pad unchanged.
          Screening keeps its full-bleed 0 escape hatch. Reading tabs still centre
          at maxWidth:1100 below; data tabs (extraction/rob/analysis/forest) fill
          the now responsively-padded column. */}
      {/* prompt45 — the RoB full-bleed workspace gets a small inset so it doesn't glue to
          the viewport edges (the purple-arrow padding fix), WITHOUT adding page scroll:
          box-sizing is border-box so the inner content area shrinks, and the workspace's
          useFillViewportHeight (24px bottom gap > the 14px bottom pad) re-fits inside it.
          Screening keeps its own full-bleed 0 escape hatch. */}
      <div style={{flex:1,minHeight:0,overflowY:noPageScroll?"hidden":"auto",padding:robFullbleed?"14px clamp(12px, 2vw, 26px)":(noPageScroll?0:"28px clamp(20px, 5vw, 88px) 56px")}}>
      {/* Hidden project-import input — always mounted so Import works from the
          compact header on every tab AND from the welcome screen (prompt30 Part 5). */}
      <input ref={importRef} type="file" accept=".json" onChange={onImport} style={{display:"none"}}/>
      {/* Non-fatal create warning (prompt6 Task 2) — e.g. linked SIFT creation failed */}
      {createWarning&&(
        <div style={{maxWidth:960,margin:"0 auto 18px",padding:"10px 14px",borderRadius:8,fontSize:12.5,display:"flex",alignItems:"flex-start",gap:9,
          background:themeAlpha(C.yel,'14'),border:`1px solid ${themeAlpha(C.yel,'40')}`}}>
          <span style={{fontSize:14,flexShrink:0}}>⚠</span>
          <span style={{color:C.txt2,lineHeight:1.5,flex:1}}>{createWarning}</span>
          <button onClick={()=>setCreateWarning("")} style={{background:"none",border:"none",color:C.muted,fontSize:16,cursor:"pointer",padding:0,lineHeight:1,flexShrink:0}}>×</button>
        </div>
      )}
      {remoteUpdate&&(
        /* Realtime conflict banner (prompt6 Task 7): a collaborator changed this
           project while local edits were unsaved — never auto-apply over them. */
        <div style={{maxWidth:960,margin:"0 auto 18px",padding:"10px 14px",borderRadius:8,fontSize:12.5,display:"flex",alignItems:"center",gap:9,
          background:themeAlpha(C.acc,'14'),border:`1px solid ${themeAlpha(C.acc,'40')}`}}>
          <span style={{fontSize:14,flexShrink:0}}>↻</span>
          <span style={{color:C.txt2,lineHeight:1.5,flex:1}}>Updated by a collaborator — refresh to see changes.</span>
          <button onClick={applyRemoteUpdate} style={{...btnS("primary"),fontSize:11,padding:"5px 12px",flexShrink:0}}>Refresh</button>
          <button onClick={()=>setRemoteUpdate(false)} title="Dismiss" style={{background:"none",border:"none",color:C.muted,fontSize:16,cursor:"pointer",padding:0,lineHeight:1,flexShrink:0}}>×</button>
        </div>
      )}
      {deepLinkMiss?(
        /* Deep-link target not accessible (prompt6 Task 3) — explicit panel,
           never a silent fallback to the first project. */
        <div style={{maxWidth:560,margin:"96px auto",textAlign:"center"}}>
          <div style={{width:56,height:56,borderRadius:16,margin:"0 auto 20px",
            background:`${themeAlpha(C.yel,'14')}`,border:`1px solid ${themeAlpha(C.yel,'40')}`,
            display:"flex",alignItems:"center",justifyContent:"center",color:C.yel}}><Icon name="lock" size={22}/></div>
          <h1 style={{fontSize:20,fontWeight:800,marginBottom:10,color:C.txt,letterSpacing:-0.4}}>Project unavailable</h1>
          <p style={{fontSize:13,color:C.txt2,lineHeight:1.7,marginBottom:8}}>
            You do not have access to this project, or the link is broken.
          </p>
          <p style={{fontSize:12,color:C.muted,lineHeight:1.7,marginBottom:24}}>
            Ask the project owner to add you to the linked workspace, then open the link again.
          </p>
          <button onClick={()=>{setDeepLinkMiss(null);if(projects.length){setActiveId(projects[0].id);setTab("overview");}}}
            style={{...btnS("primary"),padding:"10px 24px",fontSize:13}}>← Back to my projects</button>
        </div>
      ):!project?(
        <div style={{maxWidth:680,margin:"64px auto",textAlign:"center"}}>
          {/* prompt24 — no project open ⇒ no universal header; keep notifications +
              account reachable in the top-right of the welcome screen. */}
          <div style={{position:"fixed",top:12,right:16,zIndex:9999,display:"flex",alignItems:"center",gap:10}}>
            <NotificationsBell/>
            <UserMenu context="metalab" onBeforeLogout={async()=>{try{await flushStorage();}catch(_){/* best-effort */}}}/>
          </div>
          {/* Logo mark */}
          <div style={{
            width:56,height:56,borderRadius:16,margin:"0 auto 24px",
            background:`linear-gradient(145deg,${themeAlpha(C.acc,'30')},${themeAlpha(C.acc2,'18')})`,
            border:`1px solid ${themeAlpha(C.acc,'28')}`,
            display:"flex",alignItems:"center",justifyContent:"center",color:C.acc,
          }}><Icon name="hexagon" size={26}/></div>

          <h1 style={{fontSize:32,fontWeight:800,marginBottom:14,letterSpacing:-1,color:C.txt,lineHeight:1.1}}>
            Welcome to META·LAB
          </h1>
          <p style={{fontSize:14,color:C.txt2,lineHeight:1.8,maxWidth:480,margin:"0 auto 8px"}}>
            A complete workspace for systematic reviews and meta-analyses — from protocol registration through screening, analysis, and manuscript.
          </p>
          <p style={{fontSize:12,color:C.muted,marginBottom:36}}>Everything saves automatically in your browser.</p>

          <div style={{display:"flex",gap:10,justifyContent:"center",marginBottom:48}}>
            <button onClick={()=>setShowModal(true)} style={{...btnS("primary"),padding:"10px 24px",fontSize:13,borderRadius:10}}>
              Create project
            </button>
            <button onClick={()=>importRef.current&&importRef.current.click()} style={{...btnS("ghost"),padding:"10px 20px",fontSize:13,borderRadius:10}}>
              Import
            </button>
          </div>

          <div className="stagger-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,textAlign:"left"}}>
            {[
              {ph:"Plan",icon:"target",steps:"PICO framework, PROSPERO registration, eligibility criteria"},
              {ph:"Search",icon:"search",steps:AI_FEATURES_ENABLED?"AI search builder for 8 databases, MeSH terms, syntax-native":"Search builder for 8 databases, MeSH terms, full strategy documentation"},
              {ph:"Screen",icon:"filter",steps:"Import RIS/BibTeX, dual-reviewer triage, PRISMA 2020 flow"},
              {ph:"Extract",icon:"table",steps:AI_FEATURES_ENABLED?"AI-assisted extraction, DOI/PMID lookup, effect-size calculator":"Structured extraction, DOI/PMID lookup, effect-size calculator"},
              {ph:"Analyze",icon:"sigma",steps:"Meta-analysis with HKSJ, prediction intervals, forest plots"},
              {ph:"Report",icon:"fileText",steps:AI_FEATURES_ENABLED?"PRISMA checklist, GRADE certainty, AI manuscript drafter":"PRISMA checklist, GRADE certainty, manuscript workspace"},
            ].map(c=>(
              <div key={c.ph} className="hover-lift" style={{
                background:C.card,border:`1px solid ${C.brd}`,borderRadius:12,padding:18,cursor:"default",
              }}>
                <div style={{marginBottom:10,color:C.acc}}><Icon name={c.icon} size={18}/></div>
                <div style={{fontSize:12,fontWeight:700,marginBottom:5,color:C.txt,letterSpacing:-0.2}}>{c.ph}</div>
                <div style={{fontSize:11,color:C.muted,lineHeight:1.65}}>{c.steps}</div>
              </div>
            ))}
          </div>
        </div>
      ):(
        <>
        {/* prompt24 — the universal header (ProjectHeaderBar) now owns the single
            [presence][chat][notifications][account] cluster, so the old floating
            fixed chips are gone (no more duplicate/clipped presence indicator). */}
        {tab==="screening"?(
          <ScreeningWorkspaceFrame project={project} setTab={setTab}/>
        ):(
        // prompt30/31 — workspace tabs go full width; reading/form tabs keep a
        // comfortable centred max-width so prose/forms don't stretch on ultra-wide.
        <div style={{maxWidth:READING_TABS.has(tab)?1100:"none",margin:READING_TABS.has(tab)?"0 auto":0,...(robFullbleed?{height:"100%",display:"flex",flexDirection:"column",minHeight:0}:null)}} className="tab-content">
          {/* prompt30 Part 5 — the DETAILED project status header lives ONLY on the
              Overview tab now. Other tabs show compact badges + Report/Export/Import
              in the universal ProjectHeaderBar (near the title). */}
          {tab==="overview"&&(
          <div style={{marginBottom:32,paddingBottom:22,borderBottom:`1px solid ${C.brd}`}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
              <div style={{minWidth:0}}>
                {/* Rename (prompt6 Task 18) — owner or member with canEdit; real PUT, never autosave */}
                <ProjectTitle project={project} canRename={projectPerms(project).canEdit} onRename={renameProject}/>
                <div style={{fontSize:11.5,color:C.muted}}>
                  Created {fmtDate(project.created||project.createdAt)} · Modified {fmtDate(project.modified||project.updatedAt)} · {project.studies.length} stud{project.studies.length===1?"y":"ies"}
                </div>
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end",alignItems:"center"}}>
                {/* Persistent read-only pill (prompt6 Task 5) */}
                {projectPerms(project).readOnly&&<span style={tagS("yellow")} title="You can view this shared project, but your changes will not be saved."><Icon name="lock" size={11}/> Read-only access</span>}
                {project.pico?.prosperoId&&<span style={tagS("blue")}>PROSPERO: {project.pico.prosperoId}</span>}
                {project.pico?.studyDesign&&<span style={tagS()}>{project.pico.studyDesign}</span>}
                {(()=>{const r=runMeta(project.studies,"random");return r?<span style={tagS("green")}>k={r.k} · I²={r.I2}%</span>:null;})()}
                {(()=>{
                  const r=readinessCheck(project);
                  return r.ok
                    ?<span style={tagS("green")}>✓ Ready to Proceed</span>
                    :<span
                        style={{...tagS("yellow"),cursor:"pointer"}}
                        title={r.missing.join("\n")}
                        onClick={()=>setShowAudit(true)}
                      >⚠ {r.missing.length} requirement{r.missing.length!==1?"s":""} missing</span>;
                })()}
                <button onClick={openReportExport} style={{...btnS("ghost"),fontSize:11,borderRadius:7}} title="Export a full report — PDF (print dialog) or self-contained HTML file"><Icon name="fileText" size={12}/>Report</button>
                <button onClick={openProjectExport} style={{...btnS("ghost"),fontSize:11,borderRadius:7}} title="Export project as JSON"><Icon name="download" size={12}/>Export</button>
                <button onClick={()=>importRef.current&&importRef.current.click()} style={{...btnS("ghost"),fontSize:11,borderRadius:7}} title="Import project JSON"><Icon name="upload" size={12}/>Import</button>
                {(()=>{const n=auditProject(project).filter(i=>i.sev==="high").length;
                  return(<button onClick={()=>setShowAudit(true)} style={{
                    ...btnS("ghost"),fontSize:11,borderRadius:7,
                    color:n>0?C.red:C.grn,
                    borderColor:themeAlpha((n>0?C.red:C.grn),'55'),
                    display:"inline-flex",alignItems:"center",gap:5,
                  }}>
                    {n>0?<><span style={{width:6,height:6,borderRadius:"50%",background:C.red,display:"inline-block",flexShrink:0}}/>Missing ({n})</>:<>✓ Audit</>}
                  </button>);})()}
              </div>
            </div>
          </div>
          )}
          {/* Shared (linked Review Workspace) project banner — owner + read-only state (prompt5 Task 1/4) */}
          {project._shared&&(
            <div style={{marginBottom:22,padding:"10px 14px",borderRadius:8,fontSize:12.5,display:"flex",alignItems:"center",gap:9,
              background:project._readOnly?"var(--t-yel-bg)":themeAlpha(C.acc,'14'),border:`1px solid ${project._readOnly?C.yel:themeAlpha(C.acc,'40')}`}}>
              <Icon name={project._readOnly?"lock":"link"} size={14} style={{flexShrink:0}}/>
              <span style={{color:C.txt2,lineHeight:1.5}}>
                {project._readOnly
                  ?<>This is a <b style={{color:C.txt}}>shared, read-only</b> project owned by {project._owner?.name||project._owner?.email||"another user"}. You can view it, but your changes won’t be saved.</>
                  :<>You’re collaborating on a <b style={{color:C.txt}}>shared</b> project (your role: {project._role||"member"}) owned by {project._owner?.name||project._owner?.email||"another user"}.</>}
              </span>
            </div>
          )}
          {tab==="overview"&&<OverviewTab project={project} setTab={setTab} onJournalZip={openJournalSubmissionExport} onRValidate={downloadRValidationScript}/>}
          {tab==="control"&&<ControlTab project={project} onAnnotate={patchAnnotations} setTab={setTab} presence={{users:presenceUsers,locks:presenceLocks}}
            onDeleted={(delId)=>{setProjects(prev=>prev.filter(p=>p.id!==delId));if(onBackToProjects)onBackToProjects();else setActiveId(null);}}/>}
          {tab==="pico"&&<PICODispatcher project={project} activeId={activeId} updNested={updNested} upd={upd} lockCtx={{pid:spId,myUserId:authUser?.id,locks:presenceLocks}}/>}
          {tab==="prospero"&&<PROSPEROTab project={project} updNested={updNested} upd={upd}/>}
          {tab==="search"&&<SearchDispatcher project={project} activeId={activeId} updNested={updNested} upd={upd}/>}
          {tab==="prisma"&&<PRISMATab project={project} updNested={updNested} updateProject={updateProject} activeId={activeId} setTab={setTab}/>}
          {tab==="extraction"&&<ExtractionTab project={project} updateProject={updateProject} activeId={activeId}/>}
          {tab==="rob"&&<RoBTab project={project} updateProject={updateProject} activeId={activeId} setTab={setTab} onWorkspaceChange={setRobInWorkspace}/>}
          {tab==="analysis"&&<AnalysisTab project={project} updateProject={fn=>updateProject(activeId,fn)} onApplyPrecisionToAll={prec=>projects.forEach(p=>updateProject(p.id,x=>({...x,analysisPrecision:prec})))}/>}
          {tab==="forest"&&<ForestTab project={project}/>}
          {tab==="sensitivity"&&<SensitivityTab project={project}/>}
          {tab==="subgroup"&&<SubgroupTab project={project}/>}
          {tab==="grade"&&<GRADETab project={project} upd={upd}/>}
          {tab==="manuscript"&&<ManuscriptTab project={project} upd={upd}/>}
          {tab==="report"&&<ReportTab project={project} upd={upd}/>}
          {tab==="methods"&&<MethodsTab/>}
          {/* Next step button — walks workflow tabs only (phase:null reference tabs excluded) */}
          {(()=>{
            const wfTabs=TABS.filter(t=>t.phase);
            const idx=wfTabs.findIndex(t=>t.id===tab);
            if(idx<0) return null; // current tab is a reference page, not a workflow step
            const next=wfTabs[idx+1];
            if(!next) return null;
            return(
              <div style={{marginTop:32,paddingTop:20,borderTop:`1px solid ${C.brd}`,display:"flex",justifyContent:"flex-end"}}>
                <button
                  onClick={()=>goTab(next.id)}
                  style={{...btnS("primary"),padding:"10px 24px",fontSize:13,display:"flex",alignItems:"center",gap:8}}
                >
                  <Icon name={next.icon} size={14}/>{next.label} <span style={{fontSize:16}}>→</span>
                </button>
              </div>
            );
          })()}
        </div>
        )}
        </>
      )}
      </div>
    </div>
    {showAudit&&project&&<AuditPanel project={project} onClose={()=>setShowAudit(false)} onJump={(t)=>setTab(t)}/>}
    {/* Shared export dialog (prompt9 Task 6) — single instance for every
        monolith download trigger; portals itself to document.body, so the
        transformed .tab-content ancestor can't hijack its position:fixed. */}
    <ExportDialog open={!!expItem} onClose={()=>setExpItem(null)} item={expItem} precision={(project&&project.analysisPrecision)||undefined}/>
  </div>);
}
