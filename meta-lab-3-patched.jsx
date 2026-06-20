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
   open it via the module-level trampoline instead of prop-drilling through
   every tab. The trampoline + MetaLab's registration helper were extracted
   VERBATIM to src/frontend/workspace/exportDialogBridge.js (prompt46 Phase 6d)
   so tab components moved out of the monolith share the SAME singleton. */
import { openExportDialog, registerExportDialog } from "./src/frontend/workspace/exportDialogBridge.js";

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

/* ════════════ PROTOCOL / SEARCH / MeSH / PROSPERO TABS (extracted prompt46 Phase 6c — verbatim) ════════════ */
import { PICOTab, PICODispatcher, SearchDispatcher, SearchTab, MeSHTab, PROSPEROTab } from "./src/frontend/workspace/tabs/protocolTabs.jsx";

/* ════════════ DATA-EXTRACTION TAB + STUDY EDITORS (extracted prompt46 Phase 6e — verbatim) ════════════ */
import { ESCalcInline, ConversionPanel, AddStudyModal, StudyCard, ExtractionTab } from "./src/frontend/workspace/tabs/extractionTabs.jsx";

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


/* ════════════ TAB: PICO / SEARCH ════════════ */
/* PICOTab, PICODispatcher, SearchDispatcher, SearchTab extracted VERBATIM to
   src/frontend/workspace/tabs/protocolTabs.jsx (prompt46 Phase 6c) and imported
   at the top of this file. */

/* ════════════ TAB: PRISMA ════════════ */
/* ════════════ PRISMA 2020 FLOW DIAGRAM (exportable figure) ════════════ */
/* buildPrismaSVG extracted VERBATIM to
   src/frontend/workspace/charts/svgBuilders.js (prompt46 Phase 4) and imported
   at the top of this file. */
/* PRISMA figure downloads now route through the shared ExportDialog
   (PrismaFigureExport below) — the old fixed-scale helpers are gone. */

/* ════════════ TABS: SCREENING / PRISMA ════════════ */
/* ScreeningModule, MetaSiftPrismaSync, PRISMATab, PrismaFigureExport extracted
   VERBATIM to src/frontend/workspace/tabs/screeningTabs.jsx (prompt46 Phase 6d)
   and imported below. */
import { ScreeningModule, MetaSiftPrismaSync, PRISMATab, PrismaFigureExport } from "./src/frontend/workspace/tabs/screeningTabs.jsx";

/* ════════════ TAB: RISK OF BIAS ════════════ */
/* RoBTab, LegacyRoBTab extracted VERBATIM to
   src/frontend/workspace/tabs/robTabs.jsx (prompt46 Phase 6f) and imported
   below. */
import { RoBTab, LegacyRoBTab } from "./src/frontend/workspace/tabs/robTabs.jsx";

/* ════════════ TABS: ANALYSIS / FOREST / SENSITIVITY / SUBGROUP (extracted prompt46 Phase 6g — verbatim) ════════════
   AnalysisTab, DataBehindAnalysis, ResearchExport, ResultsWriteup, ForestTab,
   SensitivityTab, SubgroupTab moved VERBATIM to
   src/frontend/workspace/tabs/analysisTabs.jsx and imported below.
   interpretResult (used by AnalysisTab) was extracted earlier to
   projectHelpers.js (prompt46 Phase 6a). */
import { AnalysisTab, DataBehindAnalysis, ResearchExport, ResultsWriteup, ForestTab, SensitivityTab, SubgroupTab } from "./src/frontend/workspace/tabs/analysisTabs.jsx";

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

/* ════════════ TAB: MeSH GENERATOR / PROSPERO ════════════ */
/* CombinedDBView, ExpertDBResult, MeSHTab, PROSPEROTab extracted VERBATIM to
   src/frontend/workspace/tabs/protocolTabs.jsx (prompt46 Phase 6c) and imported
   at the top of this file. */


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
  useEffect(()=>registerExportDialog(setExpItem),[]);

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
