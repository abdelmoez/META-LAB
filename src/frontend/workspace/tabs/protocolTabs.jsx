/* ════════════ PROTOCOL / SEARCH / MeSH / PROSPERO TABS ════════════
   Extracted VERBATIM from meta-lab-3-patched.jsx (prompt46 Phase 6c). Holds:
   PICOTab, PICODispatcher, SearchWizardDispatcher, SearchTab (+ CombinedDBView,
   ExpertDBResult), MeSHTab, PROSPEROTab. (prompt60 — the unified SearchWizardDispatcher
   replaced the former SearchDispatcher + DiscoveryDispatcher two-tab flow.)

   NOTE: SearchWizardDispatcher / PICODispatcher delegate to the separately-owned
   search-wizard/search-builder (src/features/searchWizard, src/features/searchBuilder)
   and protocol (src/features/protocol) feature modules. */
import { useState, useEffect } from "react";
import { flushStorage } from "../../storage/serverStorage.js";
import { alpha as themeAlpha } from "../../theme/tokens.js";
import { useFieldLock } from "../../screening/hooks/usePresence.js";
import { C, btnS, inp, lbl, th, tagS } from "../ui/styles.js";
import { SectionHeader, InfoBox, HelpTip, AIButton, ProgressBar, CriteriaList } from "../ui/primitives.jsx";
import { MESH_DBS, PROSP_FIELDS } from "../../../research-engine/project-model/monolithConstants.js";
import { AI_FEATURES_ENABLED, callClaude, testClaudeConnection, parseSections, parseBullets, parseTermReasons, parseConceptBlocks, parseFilters } from "../../services/aiService.js";
import { ProtocolModulePanel, TIMEFRAME_OPTIONS, STUDY_DESIGNS } from "../../../features/protocol/index.js";
import { workflowStateFlagEnabled } from "../../../services/workflowState/api.js";
import { searchEngineFlagEnabled } from "../../../features/searchBuilder/index.js";
import { pecanSearchFlagEnabled } from "../../../features/pecanSearch/index.js";
import { SearchWizard } from "../../../features/searchWizard/index.js";

/* fmtDate — verbatim copy of the monolith module-local helper (the monolith
   keeps its own copy for its other consumers). */
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";

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

/* prompt60 — the UNIFIED Search stage. Replaces the former SearchDispatcher +
   DiscoveryDispatcher (removed in this change — the two-tab flow is gone) with one
   3-step wizard (Define → Build → Run), mounted for the single `search` tab in both
   shells. Flag reconciliation:
     · searchEngine OFF                       → legacy in-blob SearchTab (unchanged).
     · searchEngine ON, pecanSearch OFF/dep   → wizard Steps 1–2 work; the Run step shows
                                                a clear "enable Search & Discovery in Ops"
                                                note instead of a silent 404.
     · both ON                                → full wizard incl. the live run + import.
   pecanSearchFlagEnabled() already enforces the pecanSearch→searchEngine co-dependency,
   so `pecan` here is true only when the run can actually execute. */
function SearchWizardDispatcher({project,activeId,updNested,upd,readOnly}){
  const[flags,setFlags]=useState(null); // null=checking; {searchEngine,pecan}
  useEffect(()=>{let dead=false;
    (async()=>{
      let se=false,ps=false;
      try{ se=await searchEngineFlagEnabled(); }catch{ se=false; }
      try{ ps=await pecanSearchFlagEnabled(); }catch{ ps=false; }
      if(!dead) setFlags({searchEngine:!!se,pecan:!!ps});
    })();
    return()=>{dead=true;};
  },[]);
  if(flags===null) return <div style={{padding:40,textAlign:"center",color:C.muted,fontSize:13}}>Loading Search…</div>;
  if(!flags.searchEngine) return <SearchTab project={project} updNested={updNested} upd={upd}/>;
  return <SearchWizard projectId={activeId} pico={project.pico} readOnly={readOnly} pecanEnabled={flags.pecan}/>;
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

export { PICOTab, PICODispatcher, SearchWizardDispatcher, SearchTab, MeSHTab, PROSPEROTab };
