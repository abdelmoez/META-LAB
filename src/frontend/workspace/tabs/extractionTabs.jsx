/* ════════════ DATA-EXTRACTION TAB + STUDY EDITORS ════════════
   Extracted VERBATIM from meta-lab-3-patched.jsx (prompt46 Phase 6e). Holds:
   ESCalcInline, ConversionPanel, AddStudyModal, StudyCard, ExtractionTab.
   No logic changes — only the imports below were added so the moved code
   resolves identically. `uid` and `fmtDate` are verbatim copies of the
   monolith module-local helpers (the monolith keeps its own copies for its
   other consumers; projectHelpers.js does NOT export `uid`). */
import { useState, useMemo, useEffect, lazy, Suspense } from "react";
import { alpha as themeAlpha } from "../../theme/tokens.js";
// 66.md (P5) — structured-extraction workspace behind the `extractionAssist` flag.
// Flag helper is eager (tiny); the heavy workspace chunk is lazy so it is only
// fetched when a user actually opens the structured mode.
import { extractionAssistFlagEnabled } from "../../../features/extraction/flag.js";
const ExtractionWorkspace = lazy(() => import("../../../features/extraction/ExtractionWorkspace.jsx"));
// RoadMap/1.md — the unified assisted-extraction workspace (inline PDF + four methods).
// Heavy (pdf.js + digitizer) so it is lazy-loaded only when a reviewer opens it.
const AssistedExtractionPanel = lazy(() => import("../../../features/extraction/unified/AssistedExtractionPanel.jsx"));
import DraftReviewList from "../../../features/extraction/unified/DraftReviewList.jsx";
import { protocolOutcomes } from "../../../research-engine/extraction/protocolOutcomes.js";
import { confirmDraft as confirmDraftPure, parkRecord as parkRecordPure, unparkToDraft as unparkPure } from "../../../research-engine/extraction/records.js";
import { reconcileDrafts, identityOf } from "../../../research-engine/extraction/draftReconcile.js";
import { downloadBlob } from "../../components/exportCore.js";
import { fmtES } from "../../../research-engine/format/precision.js";
import { orderStudies, EXTRACTION_SORTS, DEFAULT_EXTRACTION_SORT } from "../../pages/extractionOrder.js";
import { isNonPrimary } from "../../../research-engine/import-export/referenceParsers.js";
import { SOURCE_OPTIONS, DATA_NATURE, ADJUST_OPTIONS, EXTRACT_FLAGS, ES_TYPES } from "../../../research-engine/project-model/monolithConstants.js";
import { calcES, CONVERSIONS, validateStudy, findDuplicates, checkPoolability } from "../../../research-engine/statistics/monolithStats.js";
import { AI_FEATURES_ENABLED, callClaude, fetchCitationAI, fileToBase64, fetchByDOI, fetchByPMID, safeParseJSON } from "../../services/aiService.js";
import { openExportDialog } from "../exportDialogBridge.js";
import { C, btnS, inp, lbl, th, tagS } from "../ui/styles.js";
import { SectionHeader, InfoBox, HelpTip } from "../ui/primitives.jsx";
import { mkStudy } from "../projectHelpers.js";

/* monolith-local utils (verbatim copies — projectHelpers.js does not export them) */
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";

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
    if(type==="OR"||type==="RR"||type==="RD"||type==="PETO"){
      const raw=[p.a,p.b,p.c,p.d];
      if(raw.some(v=>v===""||v==null)){ setRes(null); setErr("Enter all four 2×2 cells (a, b, c, d)."); return; }
      const nums=raw.map(Number);
      if(nums.some(v=>isNaN(v)||!isFinite(v))){ setRes(null); setErr("Counts must be numbers."); return; }
      if(nums.some(v=>v<0||!Number.isInteger(v))){ setRes(null); setErr("Counts must be non-negative integers."); return; }
      if((type==="OR"||type==="RR"||type==="PETO")&&nums[0]===0&&nums[2]===0){
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
        <option value="PETO">Dichotomous → Peto Odds Ratio</option>
        <option value="HR">Time-to-event → Hazard Ratio</option>
        <option value="COR">Correlation → Fisher's z</option>
        <option value="PROP">Single-arm → Proportion</option>
        <option value="DIAG">Diagnostic → DOR (TP/FP/FN/TN)</option>
      </select>
    </div>
    <div style={{fontSize:10,color:C.dim,marginBottom:8,lineHeight:1.5}}>
      {type==="SMD"&&"Standardized mean difference — pool when studies use different scales for the same construct."}
      {type==="MD"&&"Raw mean difference — only when every study reports the same units."}
      {(type==="OR"||type==="RR"||type==="RD"||type==="PETO")&&"2×2 counts. a = events in intervention, b = non-events intervention, c = events control, d = non-events control. Zero cells are valid clinical data — OR/RR apply a Haldane–Anscombe 0.5 correction when any cell is 0; RD needs none; Peto (best for rare, balanced events) needs none."}
      {type==="HR"&&"Enter the reported hazard ratio and its 95% CI — they are log-transformed for pooling."}
      {type==="COR"&&"Pearson r and sample size → Fisher's z transform."}
      {type==="PROP"&&"Single group: number of events and group total → logit proportion."}
      {type==="DIAG"&&"Diagnostic 2×2: true/false positives and negatives → log diagnostic odds ratio."}
    </div>
    {(type==="SMD"||type==="MD")&&<div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:8}}>
      {fi("meanExp","Mean Exp")}{fi("sdExp","SD Exp")}{fi("nExp","n Exp")}{fi("meanCtrl","Mean Ctrl")}{fi("sdCtrl","SD Ctrl")}{fi("nCtrl","n Ctrl")}
    </div>}
    {(type==="OR"||type==="RR"||type==="RD"||type==="PETO")&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:8}}>{fi("a","a (event/Exp)")}{fi("b","b (no event/Exp)")}{fi("c","c (event/Ctrl)")}{fi("d","d (no event/Ctrl)")}</div>}
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
    {res&&["OR","RR","HR","PROP","DIAG","PETO","IRR","GENERIC_LOG"].includes(type)&&<div style={{fontSize:10,color:C.dim,marginTop:6}}>✓ Stored on the analysis scale ({ES_TYPES[type]?.scale}). The forest plot and pooling use this transformed value; the readable value is shown above.</div>}
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
function ExtractionTab({project,updateProject,activeId,setTab}){
  const{studies}=project;
  // prompt6 Task 5 — read-only viewers: hide the affirmative edit controls.
  // (updateProject already no-ops every write for read-only projects; this is polish.)
  const readOnly=!!((project._permissions&&project._permissions.readOnly)||project._readOnly);
  // e1.md — the split-screen assisted workspace IS the main extraction interface; the
  // old "Classic table / Structured (beta)" mode toggle is retired. The 66.md
  // structured dual-review workspace (server-backed elements/consensus) is preserved but
  // demoted to a discreet, flag-gated "advanced" surface so its data + the only
  // inter-reviewer reconciliation path survive.
  const[extractionAssistOn,setExtractionAssistOn]=useState(false);
  const[showStructured,setShowStructured]=useState(false);   // advanced dual-review workspace (flag-gated)
  useEffect(()=>{let dead=false;extractionAssistFlagEnabled().then(on=>{if(!dead)setExtractionAssistOn(on);});return()=>{dead=true;};},[]);
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
  // ── Assisted-workspace draft handling (RoadMap/1.md + 4.md §4.4/§10.5/§19.10) ──
  // Drafts/parked live additively on the project blob; never overwrite a human value.
  // Adds are RECONCILED by stable source identity so re-running a machine pass over
  // unchanged source is idempotent (no duplicate drafts) and a previously-dismissed
  // finding is not resurrected (extractionDismissed holds dismissed source identities).
  const addDrafts=(recs)=>{ if(!recs||!recs.length) return; updateProject(activeId,p=>{
    const { drafts }=reconcileDrafts(p.extractionDrafts||[],recs,{dismissedIdentities:p.extractionDismissed||[]});
    return {...p,extractionDrafts:drafts};
  }); };
  const addParked=(recs)=>{ if(!recs||!recs.length) return; updateProject(activeId,p=>{
    const { drafts }=reconcileDrafts(p.extractionParked||[],recs,{dismissedIdentities:p.extractionDismissed||[]});
    return {...p,extractionParked:drafts};
  }); };
  // Dismiss removes the record by id from whichever list holds it (drafts or parked) and
  // records its source identity so a later rerun does not bring the same finding back.
  const dismissDraft=(id)=>updateProject(activeId,p=>{
    const rec=(p.extractionDrafts||[]).find(d=>d.id===id)||(p.extractionParked||[]).find(d=>d.id===id)||null;
    const sid=rec?identityOf(rec):"";
    const dismissed=p.extractionDismissed||[];
    return {...p,
      extractionDrafts:(p.extractionDrafts||[]).filter(d=>d.id!==id),
      extractionParked:(p.extractionParked||[]).filter(d=>d.id!==id),
      extractionDismissed:(sid&&!dismissed.includes(sid))?[...dismissed,sid]:dismissed};
  });
  const editDraftField=(id,key,value)=>updateProject(activeId,p=>({...p,extractionDrafts:(p.extractionDrafts||[]).map(d=>{
    if(d.id!==id) return d;
    if(key==="scope"){
      const scope={level:value.level,outcomeId:value.outcomeId,canonical:value.canonical};
      if(value.canonicalName!=null) scope.canonicalName=value.canonicalName;
      // Only replace the outcome NAME when a real (non-empty) one is supplied. Passing
      // name:'' (e.g. "unassigned") must NOT erase the outcome text auto-extract captured.
      const outcome=(typeof value.name==="string"&&value.name.trim())?value.name:d.outcome;
      return {...d,scope,outcome};
    }
    return {...d,[key]:value};
  })}));
  // Confirming a draft APPENDS a new per-outcome study row that inherits the source
  // study's citation metadata — it never overwrites another outcome's data. (Each
  // study×outcome×timepoint is its own row, matching the Analysis pooling model.)
  const confirmDraftById=(id)=>updateProject(activeId,p=>{
    const at=new Date().toISOString();
    // Prefer the draft's own origin study (captured at creation) over whatever study
    // happens to be selected now, so a confirmed draft never inherits the wrong
    // citation metadata if the reviewer switched studies between generating and confirming.
    const d=(p.extractionDrafts||[]).find(x=>x.id===id);
    const citationBaseId=(d&&d.sourceStudyId)||selectedStudyId||null;
    const res=confirmDraftPure({studies:p.studies||[],drafts:p.extractionDrafts||[]},id,{at,citationBaseId});
    if(!res.ok) return p;
    return {...p,studies:res.studies,extractionDrafts:res.drafts};
  });
  const parkDraft=(id)=>updateProject(activeId,p=>{
    const res=parkRecordPure({drafts:p.extractionDrafts||[],parked:p.extractionParked||[]},id,{at:new Date().toISOString()});
    if(!res.ok) return p;
    return {...p,extractionDrafts:res.drafts,extractionParked:res.parked};
  });
  const unparkRecord=(id,scope)=>updateProject(activeId,p=>{
    const res=unparkPure({parked:p.extractionParked||[],drafts:p.extractionDrafts||[]},id,{scope});
    if(!res.ok) return p;
    return {...p,extractionParked:res.parked,extractionDrafts:res.drafts};
  });
  // Click-assign: patch several fields of one study at once (fast manual aid).
  const patchStudy=(id,patch)=>updateProject(activeId,p=>({...p,studies:p.studies.map(s=>s.id===id?{...s,...patch,updatedAt:new Date().toISOString()}:s)}));
  const addBlankAndSelect=()=>updateProject(activeId,p=>{const fresh=mkStudy();setTimeout(()=>setSelectedStudyId(fresh.id),0);return {...p,studies:[...p.studies,fresh]};});

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
  // RoadMap/1.md — the unified assisted workspace + protocol-scoped drafts.
  const[selectedStudyId,setSelectedStudyId]=useState("");
  const drafts=project.extractionDrafts||[];
  const parked=project.extractionParked||[];
  const protocol=useMemo(()=>protocolOutcomes(project),[project.prospero,project.pico]);
  const protocolOuts=protocol.outcomes;
  // Keep a study selected for the assisted workspace (default: first study).
  useEffect(()=>{ if(!selectedStudyId&&studies.length) setSelectedStudyId(studies[0].id); },[studies,selectedStudyId]);
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
      title:`Data extraction — ${filename}`,
      formats:[{id:"csv",label:"CSV (Excel-compatible, UTF-8 BOM)"}],
      sizing:false,
      run:async()=>{
        downloadBlob(new Blob(["﻿"+buildExtractionCSV()],{type:"text/csv;charset=utf-8;"}),filename);
      },
    });
  };

  // compact table cell editor
  const TC=(s,k,w,ph)=>(<td style={{padding:"3px 4px",borderBottom:`1px solid ${C.brd}`}}>
    <input value={s[k]||""} onChange={e=>updStudy(s.id,k,e.target.value)} placeholder={ph||""}
      style={{...inp,fontSize:11,padding:"3px 5px",width:w||"100%",fontFamily:["es","lo","hi","n","nExp","nCtrl"].includes(k)?"'IBM Plex Mono',monospace":"inherit"}}/></td>);

  // e1.md — the Classic/Structured mode toggle is retired. The 66.md structured
  // dual-review workspace stays reachable behind a discreet, flag-gated "advanced"
  // button (its server data + the only inter-reviewer reconciliation path are preserved),
  // but it no longer competes with the split-screen for the primary surface.
  const advancedStructuredBtn = extractionAssistOn ? (
    <button onClick={()=>setShowStructured(v=>!v)} style={{...btnS(showStructured?"primary":"ghost"),fontSize:12}}
      title="Blinded dual extraction + adjudication (advanced)">
      {showStructured?"← Back to extraction":"⚖ Dual-review workspace"}
    </button>
  ) : null;

  if(extractionAssistOn && showStructured){
    return(<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:12}}>
        <div style={{fontSize:13,fontWeight:700,color:C.txt}}>⚖ Dual-review extraction (advanced)</div>
        {advancedStructuredBtn}
      </div>
      <Suspense fallback={<div style={{padding:24,color:C.muted,fontSize:12}}>Loading the structured extraction workspace…</div>}>
        <ExtractionWorkspace projectId={project.id}/>
      </Suspense>
    </div>);
  }

  return(<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
      <div style={{flex:1,minWidth:0}}>
        <SectionHeader icon="table" title="Data Extraction" desc="Read the article on the left and capture its data on the right. Auto-generate, pick a table/figure, click a number, or type it — every value is protocol-scoped, provenance-tracked and editable." badge={`${studies.length} studies`}/>
      </div>
      {advancedStructuredBtn}
    </div>

    {/* e1.md — the split-screen assisted workspace IS the main extraction interface
        (PDF left, methods/form right, sticky). It renders once at least one study exists;
        the classic records table below is where the data accumulates and is edited by hand. */}
    {studies.length>0&&!readOnly&&(
      <Suspense fallback={<div style={{padding:20,color:C.muted,fontSize:12,border:`1px solid ${C.brd}`,borderRadius:10,marginBottom:14}}>Loading the extraction workspace…</div>}>
        <AssistedExtractionPanel
          projectId={project.id}
          studies={studies}
          outcomes={protocolOuts}
          protocol={protocol}
          selectedStudyId={selectedStudyId}
          onSelectStudy={setSelectedStudyId}
          onAddBlankStudy={addBlankAndSelect}
          onAddDrafts={addDrafts}
          onAddParked={addParked}
          onPatchStudy={patchStudy}
          drafts={drafts}
          parked={parked}
          onConfirmDraft={confirmDraftById}
          onDismissDraft={dismissDraft}
          onParkDraft={parkDraft}
          onUnparkRecord={unparkRecord}
          onEditDraftField={editDraftField}
          onNextStudy={()=>{const ordered=orderStudies(studies,sortKey);if(!ordered.length)return;const i=ordered.findIndex(s=>s.id===selectedStudyId);const next=ordered[(i+1)%ordered.length];if(next)setSelectedStudyId(next.id);}}
          onViewRecords={()=>{setView("cards");if(typeof document!=="undefined"){setTimeout(()=>{const el=document.getElementById("extraction-records");if(el)el.scrollIntoView({behavior:"smooth",block:"start"});},0);}}}
          onContinueToRob={setTab?()=>setTab("rob"):null}
          readOnly={readOnly}
        />
      </Suspense>
    )}

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

    {/* Toolbar — top of the extracted-records area (scroll target for "View records"). */}
    <div id="extraction-records" style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:10,flexWrap:"wrap",scrollMarginTop:12}}>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        {studies.length>0&&<div style={{fontSize:12,fontWeight:700,color:C.txt}}>Extracted records</div>}
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

    {/* Drafts to review + "Also reported (not in this review)" parked list. When the
        assisted workspace is on screen it owns the draft list inside its sticky panel;
        this standalone copy only renders when the panel is hidden (read-only viewers, or
        before any study exists) so drafts stay visible everywhere. */}
    {(readOnly||studies.length===0)&&(drafts.length>0||parked.length>0)&&(
      <DraftReviewList
        drafts={drafts}
        parked={parked}
        outcomes={protocolOuts}
        readOnly={readOnly}
        onConfirm={confirmDraftById}
        onDismiss={dismissDraft}
        onPark={parkDraft}
        onUnpark={unparkRecord}
        onEditField={editDraftField}
      />
    )}

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

export { ESCalcInline, ConversionPanel, AddStudyModal, StudyCard, ExtractionTab };
