import { useState, useMemo, useEffect, useRef, useCallback, useId } from "react";
import { C, FONT, MONO, alpha, CB_SERIES } from "../../frontend/theme/tokens.js";  // SearchEngine: adapt to app theme (day/night + brand)
import { localMeshSuggestions, meshConfidence } from "../../research-engine/searchBuilder/meshSuggest.js"; // prompt42 Task 3 + SB5 vocab safety
import { serializeSearchState, pickPersisted, remoteAdoptDecision,
  conceptStatus, CONCEPT_STATUS_LABELS,
  // 96.md — question-based concept groups (PICO removed from the Search Engine):
  seedStateFromQuestion, createConceptFromPhrase, findConceptForPhrase,
  conceptOnlyHoldsOriginTerm, conceptDrift, setConceptSourcePhrase,
  reorderConcept as reorderConceptState, reorderTerm as reorderTermState,
  mergeConcepts as mergeConceptsState,
  splitConcept as splitConceptState } from "../../research-engine/searchBuilder/searchState.js"; // SE1 + SB3 + 96.md
import { tokenizeForSelection, spanPhrase } from "../../research-engine/searchBuilder/keywordSelection.js"; // SB3 Tab 1 + 96.md QA M5
import { databaseGroups, defaultSelectedDatabases, getDatabase, ACCESS_TIERS, ACCESS_TOOLTIP, openUrlFor, homeUrlFor } from "../../research-engine/searchBuilder/databases.js"; // SB3 Tab 3 + 73.md P6
import { compileStrategy, compileAll, capabilitiesFor } from "../../research-engine/searchBuilder/compilers/index.js"; // 73.md P6 — per-database strategy compiler (read-only consumer)
import { detectCrossConceptDuplicates, searchQualityCheck, sensitivitySignal, termEquivalenceKey } from "../../research-engine/searchBuilder/crossConcept.js"; // SB4 Parts 4/8/9
import { useRealtime } from "../../frontend/hooks/useRealtime.js"; // SE1 Task 5 — live collaborator sync (shared SSE poke channel)
// 85.md A1 — pure engine modules for the redesigned Concepts / Terms & Vocabulary UI.
import { liveTermsOf } from "../../research-engine/searchBuilder/termLiveness.js";
import { setTermDisabled } from "../../research-engine/searchBuilder/searchState.js";
import { splitTermInput, addTypedTerms } from "../../research-engine/searchBuilder/termEntry.js";
import { pendingSuggestions, suggestionCount, rejectionKey, resetSuggestionMemory } from "../../research-engine/searchBuilder/suggestionReview.js";
import { computeStageStatuses } from "../../research-engine/searchBuilder/stageStatus.js";
import {
  recordRemoveTerm, recordRemoveConcept, recordDisable, recordBulkAccept,
  recordReorderConcept, recordReorderTerm, recordMergeConcepts, recordSplitConcept,
  undoLast, clear as clearUndo,
} from "../../research-engine/searchBuilder/undoStack.js";
// 85.md A2 — extracted presentational leaves (SSR-contract-tested in searchBuilderUi.test.jsx).
import ConceptNavigator from "./components/ConceptNavigator.jsx";
import ActiveConceptPanel from "./components/ActiveConceptPanel.jsx";
import TermChipRow from "./components/TermChipRow.jsx";
import TermEditorPopover from "./components/TermEditorPopover.jsx";
import AddTermBox from "./components/AddTermBox.jsx";
import SuggestionsDisclosure from "./components/SuggestionsDisclosure.jsx";
import StrategyPreviewPanel from "./components/StrategyPreviewPanel.jsx";
import SaveStatusIndicator from "./components/SaveStatusIndicator.jsx";
import UndoSnackbar from "./components/UndoSnackbar.jsx";
import { Disclosure } from "../pecanSearch/components/parts.jsx"; // native-<details> pattern

/* ════════════════════════════════════════════════════════════════════════════
   SEARCH BUILDER TAB  ·  production component for the META·LAB SaaS app
   ----------------------------------------------------------------------------
   This is the deterministic concept → multi-database query engine as a single
   embeddable tab. It is designed to be dropped into the app and wired to a
   backend by another developer/agent.

   ┌─ INTEGRATION POINTS (search this file for "INTEGRATION:") ────────────────┐
   │ 1. Question source  — props.question (96.md; pico.question legacy seam)   │
   │ 2. Backend API      — props.api   (mesh lookup, pubmed count)            │
   │ 3. Persistence      — props.loadSearch / props.saveSearch (per project)   │
   │ 4. Project identity — props.projectId                                     │
   └──────────────────────────────────────────────────────────────────────────┘

   Everything below the ENGINE banner is pure logic with no app dependencies.
   See BACKEND_CONTRACT.md for the exact API shapes and INTEGRATION_README.md
   for wiring steps. Nothing here calls NLM directly — all network goes through
   props.api so the API key stays server-side.
   ════════════════════════════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════════════════════
   THEME  (matches META·LAB; safe to replace with the app's design tokens)
   ════════════════════════════════════════════════════════════════════════════ */
// Theme adapted to the app design tokens (C/FONT/MONO/alpha imported above) so
// the Search Builder follows day/night + the global brand color.
const SANS=FONT;
// 85.md A2 — concept identity accents are now the CVD-safe Okabe–Ito series
// (tokens.js CB_SERIES) and are used ONLY as a secondary accent (border-left /
// legend), never as the sole carrier of meaning. The old 8 pastels included two
// near-identical teals/indigos and were not colour-blind-vetted.
const CONCEPT_COLORS=CB_SERIES;
const uid=()=>Math.random().toString(36).slice(2,9);
// prompt40 Task 3 — multi-concept extraction from PICO (deterministic, no network).
const cnorm=(s)=>String(s||"").toLowerCase().replace(/[“”"'’.()[\]{}:!?]/g," ").replace(/\s+/g," ").trim();

/* prompt42 Task 1 — short, stable FNV-1a/djb2-style hash of a strategy string, so
   we can tell when the PubMed query actually changed (drives the hit lifecycle:
   stale → updating → updated/failed). Pure + exported for tests. */
export function strategyHash(str){
  const s=String(str||"");
  let h=2166136261; // FNV-1a 32-bit
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
  return (h>>>0).toString(36);
}

/* prompt42 Task 1 — pure, deterministic "x ago" formatter for the hit timestamp.
   Buckets: just now / Ns ago / Nm ago / Nh ago / Nd ago. Exported for tests.
   nowMs is injectable so tests are deterministic. */
export function relativeTime(ts,nowMs){
  if(ts==null) return "";
  const now=typeof nowMs==="number"?nowMs:Date.now();
  const sec=Math.max(0,Math.floor((now-ts)/1000));
  if(sec<5) return "just now";
  if(sec<60) return `${sec}s ago`;
  const min=Math.floor(sec/60);
  if(min<60) return `${min}m ago`;
  const hr=Math.floor(min/60);
  if(hr<24) return `${hr}h ago`;
  return `${Math.floor(hr/24)}d ago`;
}

/* prompt42 Task 2 — normalize one persisted `ignored` entry into the rich object
   form {text, field, label}. Accepts the legacy string form (→ field/label '') OR
   an object. Returns null when there's no usable text. Pure + exported for tests. */
export function normalizeIgnoredEntry(e){
  if(typeof e==="string"){ const text=e.trim(); return text?{text,field:"",label:""}:null; }
  if(e&&typeof e==="object"&&typeof e.text==="string"){
    const text=e.text.trim();
    if(!text) return null;
    return {text,field:typeof e.field==="string"?e.field:"",label:typeof e.label==="string"?e.label:""};
  }
  return null;
}
/* Normalize a whole persisted `ignored` array (string[] legacy OR object[]) → object[]. */
export function normalizeIgnored(list){
  return (Array.isArray(list)?list:[]).map(normalizeIgnoredEntry).filter(Boolean);
}

/* 73.md P4 — which internal step panels an EMBEDDED phase shows. 96.md — the
   retired SearchWizard's 'define' alias and the retired Concepts stage's
   'concepts' phase are GONE: the staged workspace passes only 'terms' (the central
   Terms & Vocabulary workspace = phrase selection + concept groups + vocabulary +
   strategy section) and 'build' (Database Strategies, manual mode). Returns null
   for a non-embedded phase value. Pure + exported for tests. */
export function embeddedShowsStep(phase,n){
  if(phase==="terms") return n===2;
  if(phase==="build") return n===3||n===4;
  return null;
}

/* 73.md P6 — one .txt with every selected database's compiled strategy (label +
   syntax level + query + warnings). Pure + exported for tests. */
export function allStrategiesExportText(results){
  const blocks=(Array.isArray(results)?results:[]).map(r=>{
    const lines=[`### ${r.label} (${r.syntaxLevel}${r.overridden?", manually edited":""})`];
    lines.push(r.query||"(no terms)");
    for(const w of (r.warnings||[])) lines.push(`! ${w.message}`);
    for(const u of (r.unsupported||[])) lines.push(`- not supported: ${u.feature} — ${u.detail}`);
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}


/* ════════════════════════════════════════════════════════════════════════════
   ENGINE — pure functions, no app/network dependencies
   ════════════════════════════════════════════════════════════════════════════ */

/* ---- offline fallback vocabulary (used only if the backend/NLM is down) ----
   This is intentionally small. The live MeSH data comes from the backend
   (props.api.meshLookup). When the backend is unreachable we degrade to this
   so the tab keeps working in "limited mode" instead of dying. */
const CORE_VOCAB={
  "type 2 diabetes":{mesh:"Diabetes Mellitus, Type 2",meshUI:"D003924",tree:"C18.452.394.750.149, C19.246.300",
    emtree:"non insulin dependent diabetes mellitus",
    synonyms:["NIDDM","Type 2 Diabetes Mellitus","T2DM","Diabetes Mellitus, Noninsulin-Dependent","Maturity-Onset Diabetes","MODY"],
    scope:"A subclass of diabetes mellitus not insulin-responsive or dependent (NIDDM).",children:["Diabetes Mellitus, Lipoatrophic","Prediabetic State"]},
  "sglt2 inhibitors":{mesh:"Sodium-Glucose Transporter 2 Inhibitors",meshUI:"D000077203",tree:"D27.505.519.389.745",
    emtree:"sodium glucose cotransporter 2 inhibitor",
    synonyms:["SGLT2 inhibitor","gliflozin","empagliflozin","dapagliflozin","canagliflozin"],
    scope:"Compounds that inhibit sodium-glucose transporter 2.",children:[]},
  "heart failure":{mesh:"Heart Failure",meshUI:"D006333",tree:"C14.280.434",emtree:"heart failure",
    synonyms:["cardiac failure","congestive heart failure","CHF","HFrEF","HFpEF"],
    scope:"Inability of the heart to pump enough blood to meet metabolic needs.",children:["Heart Failure, Systolic","Heart Failure, Diastolic"]},
  "hypertension":{mesh:"Hypertension",meshUI:"D006973",tree:"C14.907.489",emtree:"hypertension",
    synonyms:["high blood pressure","HTN"],scope:"Persistently high systemic arterial blood pressure.",children:["Hypertension, Malignant","Hypertension, Renal"]},
  "stroke":{mesh:"Stroke",meshUI:"D020521",tree:"C10.228.140.300.775",emtree:"cerebrovascular accident",
    synonyms:["cerebrovascular accident","CVA","brain attack"],scope:"Sudden neurological deficit from ischemia or hemorrhage.",children:["Ischemic Stroke","Hemorrhagic Stroke"]},
  "mortality":{mesh:"Mortality",meshUI:"D009026",tree:"E05.318.308.985.550.475",emtree:"mortality",
    synonyms:["death","survival","all-cause mortality"],scope:"All deaths in a given population.",children:["Hospital Mortality","Infant Mortality"]},
};

/* ---- syntax renderers (verified against library guides; see BACKEND_CONTRACT) ---- */
function renderControlled(term,dbId){
  const v=term.vocab, t=(term.text||"").trim();
  // 85.md A2 — a controlled term with NO matched vocabulary must fall back to a
  // free-text token: `"nonexistent heading"[Mesh]` is a heading that doesn't exist
  // and would match nothing, while the editor copy has always promised "it will
  // search as plain words until a match is found". Behaviour now matches the copy.
  if(!v){
    if(dbId==="pubmed") return pubmedFree(term);
    const {token,field}=freeTextToken(term);
    return `${token}${fieldSuffix(dbId,field)}`;
  }
  if(dbId==="pubmed"){ const d=v.mesh||t; return `"${d}"[Mesh${term.noExplode?":NoExp":""}]`; }
  if(dbId==="cochrane"){ const d=v.mesh||t; return `[mh ${term.noExplode?"^":""}"${d}"]`; }
  if(dbId==="embase"){ const d=v.emtree||t.toLowerCase(); return `'${d}'/${term.noExplode?"de":"exp"}`; }
  return t;
}
function freeTextToken(term){
  let t=(term.text||"").trim();
  const trunc=term.truncate&&!t.includes(" ");
  if(trunc) t=t.replace(/\*+$/,"")+"*";
  const phrase=(t.includes(" ")||term.phrase)&&!trunc;
  return { token: phrase?`"${t}"`:t, field: term.field||"tiab" };
}
function pubmedFree(term){
  const {token,field}=freeTextToken(term);
  const f=field==="ti"?"[ti]":field==="all"?"[all]":"[tiab]";
  return `${token}${f}`;
}
function fieldSuffix(dbId,field){
  if(dbId==="cochrane") return field==="ti"?":ti":":ti,ab,kw";
  if(dbId==="embase")   return field==="ti"?":ti":field==="all"?":ab,ti,kw":":ab,ti";
  return "";
}
/* 85.md A2 — exported so the unmatched-heading fallback above is unit-pinned. */
export function renderTerm(term,dbId){
  if(!((term.text||"").trim())) return "";
  if(term.type==="controlled") return renderControlled(term,dbId);
  if(dbId==="pubmed") return pubmedFree(term);
  const {token,field}=freeTextToken(term);
  return `${token}${fieldSuffix(dbId,field)}`;
}
function renderConcept(concept,dbId){
  // review-round #4 — a switched-off term must not appear in any query rendering
  // (the compilers already skip it; this legacy renderer must agree).
  const live=liveTermsOf(concept);
  if(!live.length) return "";
  if(dbId==="pubmed"){
    const parts=live.map(t=>t.type==="controlled"?renderControlled(t,dbId):pubmedFree(t));
    return parts.length===1?parts[0]:"("+parts.join(" OR ")+")";
  }
  const controlled=live.filter(t=>t.type==="controlled").map(t=>renderControlled(t,dbId));
  const freeByField={};
  live.filter(t=>t.type==="freetext").forEach(t=>{
    const {token,field}=freeTextToken(t);
    (freeByField[field]=freeByField[field]||[]).push(token);
  });
  const freeGroups=Object.entries(freeByField).map(([field,tokens])=>{
    const inner=tokens.length===1?tokens[0]:"("+tokens.join(" OR ")+")";
    return `${inner}${fieldSuffix(dbId,field)}`;
  });
  const all=[...controlled,...freeGroups];
  return all.length===1?all[0]:"("+all.join(" OR ")+")";
}
function renderSearch(concepts,dbId){
  const blocks=concepts.map(c=>({label:c.label,q:renderConcept(c,dbId),op:c.op||"AND"})).filter(b=>b.q);
  if(!blocks.length) return {full:"",lines:[]};
  const lines=blocks.map((b,i)=>({n:i+1,label:b.label,q:b.q,op:i<blocks.length-1?b.op:null}));
  let full="";
  blocks.forEach((b,i)=>{ full+=(i>0?` ${blocks[i-1].op||"AND"} `:"")+b.q; });
  return {full,lines};
}

/* ---- plain-English mirror ---- */
function plainTerm(term){
  const t=(term.text||"").trim(); if(!t) return "";
  if(term.type==="controlled"){
    const exp=term.noExplode?"":" (and narrower topics under it)";
    return `articles officially tagged with the subject “${term.vocab?.mesh||t}”${exp}`;
  }
  const where=term.field==="ti"?"the title":term.field==="all"?"anywhere in the record":"the title or abstract";
  const how=term.truncate&&!t.includes(" ")?`words starting with “${t.replace(/\*+$/,"")}”`:`“${t}”`;
  return `articles mentioning ${how} in ${where}`;
}
function plainConcept(concept){
  // review-round #4 — the plain-English mirror describes what RUNS: skip disabled.
  const parts=liveTermsOf(concept).map(plainTerm);
  if(!parts.length) return "";
  return parts.length===1?parts[0]:parts.join(", OR ");
}
function plainSearch(concepts){
  const blocks=concepts.map(c=>({label:c.label,p:plainConcept(c),op:c.op||"AND"})).filter(b=>b.p);
  if(!blocks.length) return "";
  return blocks.map((b,i)=>{
    const joiner=i===0?"":(blocks[i-1].op==="OR"?"OR — ":"AND also — ");
    return `${joiner}${b.label?b.label+": ":""}${b.p}`;
  }).join("\n");
}

function fmtCount(n){
  if(n==null) return "—";
  if(n>=1000000) return (n/1000000).toFixed(1)+"M";
  if(n>=1000) return (n/1000).toFixed(n>=100000?0:1)+"k";
  return String(n);
}


/* ════════════════════════════════════════════════════════════════════════════
   DEFAULT API ADAPTER
   INTEGRATION: the app passes a real `api` prop. This default is a safe stub
   that (a) uses the offline CORE_VOCAB for mesh lookup, and (b) returns null
   for counts (so the UI shows "—"). Replace by passing props.api — see
   BACKEND_CONTRACT.md. Do NOT call NLM from here; the real adapter calls the
   app's backend, which proxies NLM with the server-side API key.
   ════════════════════════════════════════════════════════════════════════════ */
const defaultApi={
  // returns { mesh, meshUI, tree, emtree, synonyms[], scope, children[], source } | null
  async meshLookup(text){
    const key=(text||"").trim().toLowerCase();
    if(CORE_VOCAB[key]) return {...CORE_VOCAB[key],source:"core"};
    for(const k of Object.keys(CORE_VOCAB)){
      if(k.includes(key)||key.includes(k)) return {...CORE_VOCAB[k],source:"core"};
      if(CORE_VOCAB[k].synonyms.some(s=>s.toLowerCase()===key)) return {...CORE_VOCAB[k],source:"core"};
    }
    return null;
  },
  // returns an integer count, or null if counts are unavailable (offline mode)
  async pubmedCount(_queryString){ return null; },
};


/* ════════════════════════════════════════════════════════════════════════════
   SMALL UI
   ════════════════════════════════════════════════════════════════════════════ */
function btn(variant="ghost"){
  const base={padding:"7px 14px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:SANS,transition:"all .15s",display:"inline-flex",alignItems:"center",gap:6};
  if(variant==="primary") return {...base,background:`linear-gradient(135deg,${C.acc},${C.acc2})`,color:C.accText};
  if(variant==="danger") return {...base,background:"transparent",color:C.red,border:`1px solid ${alpha(C.red,"44")}`};
  if(variant==="solid") return {...base,background:C.card2,color:C.txt,border:`1px solid ${C.brd2}`};
  return {...base,background:"transparent",color:C.muted,border:`1px solid ${C.brd2}`};
}
const inputStyle={background:C.surf,border:`1px solid ${C.brd}`,borderRadius:7,padding:"7px 10px",color:C.txt,fontFamily:SANS,fontSize:12,outline:"none",width:"100%",boxSizing:"border-box"};

function Help({text}){
  const [open,setOpen]=useState(false);
  return(
    <span style={{position:"relative",display:"inline-block"}}>
      <button onClick={()=>setOpen(o=>!o)} title="What's this?"
        style={{width:16,height:16,borderRadius:"50%",border:`1px solid ${C.brd2}`,background:open?C.acc:"transparent",
          color:open?C.accText:C.muted,fontSize:10,fontWeight:700,cursor:"pointer",lineHeight:1,padding:0}}>?</button>
      {open&&(
        <span style={{position:"absolute",zIndex:80,top:"calc(100% + 6px)",left:0,width:280,background:C.card,
          border:`1px solid ${alpha(C.acc,"55")}`,borderRadius:9,padding:"10px 12px",fontSize:11,lineHeight:1.55,color:C.txt2,
          boxShadow:"0 14px 40px var(--t-shadow)",fontWeight:400,whiteSpace:"normal"}}>
          {text}
          <button onClick={()=>setOpen(false)} style={{display:"block",marginTop:8,...btn("ghost"),fontSize:10,padding:"2px 8px"}}>Got it</button>
        </span>
      )}
    </span>
  );
}
/* 85.md A2 — dismissible 3-line mental-model intro for the Concepts stage
   (localStorage 'sb-intro-dismissed'; InfoBox/Note callout recipe — no paragraph
   walls). Fixes audit M2: novices arrive expecting to "create concepts" and meet
   pre-made groups with no framing. */
function ConceptsIntroStrip(){
  const [dismissed,setDismissed]=useState(()=>{ try{ return localStorage.getItem('sb-intro-dismissed')==='1'; }catch{ return false; } });
  if(dismissed) return null;
  const dismiss=()=>{ setDismissed(true); try{ localStorage.setItem('sb-intro-dismissed','1'); }catch{/* private mode */} };
  const line={display:"flex",gap:8,alignItems:"flex-start",fontSize:12,color:C.txt2,lineHeight:1.6};
  return(
    <div data-testid="sb-intro-strip" style={{background:`${alpha(C.acc,"10")}`,border:`1px solid ${alpha(C.acc,"33")}`,borderLeft:`3px solid ${alpha(C.acc,"80")}`,borderRadius:8,padding:"10px 12px",marginBottom:12}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
        <div style={{flex:1,display:"flex",flexDirection:"column",gap:3}}>
          <span style={line}><span aria-hidden="true" style={{color:C.acc}}>·</span><span>Your review question splits into <strong>concepts</strong> (a condition, a treatment…).</span></span>
          <span style={line}><span aria-hidden="true" style={{color:C.acc}}>·</span><span>Inside a concept you collect <strong>different words for the same idea</strong> — any one counts.</span></span>
          <span style={line}><span aria-hidden="true" style={{color:C.acc}}>·</span><span>Concepts then <strong>combine to narrow</strong> the search — all must appear.</span></span>
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss introduction"
          style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:15,lineHeight:1,padding:"2px 6px",minWidth:24,minHeight:24}}>×</button>
      </div>
    </div>
  );
}
/* 73.md P6 — client-side .txt download (single strategy or the full export). */
function downloadText(filename,text){
  try{
    const blob=new Blob([String(text||"")],{type:"text/plain;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch{/* download unavailable (non-browser env) */}
}

/* 73.md P6 — ONE database's compiled strategy panel. Replaces the legacy 3-tab
   QueryOutput: every selected catalogue database gets real compiled syntax from the
   strategy compiler (never a "generic" pseudo-string), plus structured diagnostics.
   Overrides reuse the SAME persisted overrides map (overrides[dbId] now works for
   every database). Presentational + exported for direct SSR tests. */
export function DbStrategyPanel({res,cap,setOverride,hitState}){
  // prompt42 Task 1 — keep the "updated Xm ago" stamp fresh on a slow tick.
  const [,setTick]=useState(0);
  useEffect(()=>{
    if(!hitState||hitState.status!=="updated"||hitState.lastUpdatedAt==null) return;
    const id=setInterval(()=>setTick(t=>t+1),15000);
    return ()=>clearInterval(id);
  },[hitState&&hitState.status,hitState&&hitState.lastUpdatedAt]);
  const [copied,setCopied]=useState(false);
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState("");
  const dbId=res.dbId;
  const edited=!!res.overridden;
  const shown=res.query;
  const isNative=res.syntaxLevel==="native";
  const openUrl=shown?openUrlFor(dbId,shown):null;
  const homeUrl=homeUrlFor(dbId);
  const copy=()=>{ try{navigator.clipboard?.writeText(shown);}catch{/* clipboard unavailable */} setCopied(true); setTimeout(()=>setCopied(false),1500); };
  const startEdit=()=>{ setDraft(shown); setEditing(true); };
  const saveEdit=()=>{
    // recs round — saving the editor without actually changing the compiled query
    // must NOT freeze the strategy as a manual override (it would silently stop
    // syncing with concept changes). Unchanged text on a non-overridden panel is a
    // no-op close; emptied text always clears the override.
    if(setOverride){
      const t=draft.trim();
      if(!t) setOverride(null);
      else if(!(res&&res.overridden) && t===(shown||"").trim()) { /* unchanged — keep live sync */ }
      else setOverride(draft);
    }
    setEditing(false);
  };
  const revert=()=>{ if(setOverride) setOverride(null); setEditing(false); };
  const vocabLine=res.vocab&&res.vocab.system!=="none"&&(res.vocab.mapped||res.vocab.unmapped)
    ?`Subject headings (${res.vocab.system}): ${res.vocab.mapped} mapped${res.vocab.unmapped?`, ${res.vocab.unmapped} unmapped`:""}${res.vocab.approximate?" (approximate)":""}`
    :null;
  const guidance=[...new Set([...(res.notes||[]),...((cap&&cap.notes)||[])])];
  return(
    <div data-testid={`sb-db-strategy-${dbId}`} style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:10,padding:"12px 14px",marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8}}>
        <span style={{fontWeight:700,fontSize:13,color:C.txt}}>{res.label}</span>
        <span title={isNative?"Real, runnable syntax for this database — paste and run as-is":"Approximate — this database's search is simplified and cannot express the full strategy"}
          style={{fontSize:9,fontWeight:700,letterSpacing:.4,textTransform:"uppercase",borderRadius:5,padding:"1px 6px",
            color:isNative?C.grn:C.yel,background:alpha(isNative?C.grn:C.yel,"14"),border:`1px solid ${alpha(isNative?C.grn:C.yel,"55")}`}}>
          {res.syntaxLevel}
        </span>
        {dbId==="pubmed"&&<span style={{fontSize:9,fontWeight:700,letterSpacing:.4,color:C.grn,background:`${alpha(C.grn,"18")}`,border:`1px solid ${alpha(C.grn,"55")}`,borderRadius:5,padding:"1px 6px"}}>● LIVE</span>}
        {edited
          ? <span style={{fontSize:9.5,fontWeight:700,letterSpacing:.4,color:C.yel,background:`${alpha(C.yel,"1a")}`,border:`1px solid ${alpha(C.yel,"55")}`,borderRadius:5,padding:"1px 7px"}} title="Manually edited — not synced to concept changes">✎ EDITED</span>
          : <span style={{fontSize:9.5,color:C.grn}} title="Generated from the live concept builder — always current">● in sync</span>}
        <span style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          {/* prompt42 Task 1 — live hit lifecycle (PubMed only). */}
          {!edited&&dbId==="pubmed"&&hitState&&(()=>{
            const st=hitState.status;
            if(st==="updating"||st==="stale") return <span style={{fontFamily:MONO,fontSize:11,color:C.muted}} title="Refreshing PubMed hit count">Updating hits…</span>;
            if(st==="failed") return <span style={{fontFamily:MONO,fontSize:10.5,color:C.yel,maxWidth:200,whiteSpace:"normal",lineHeight:1.3}} title={hitState.errorMessage||"Hit count unavailable"}>⚠ hits unavailable</span>;
            if(st==="updated"&&hitState.hitCount!=null) return (
              <span style={{display:"inline-flex",alignItems:"baseline",gap:6}}>
                <span style={{fontFamily:MONO,fontSize:12,color:C.acc,fontWeight:700}}>{fmtCount(hitState.hitCount)} <span style={{color:C.muted,fontWeight:400,fontSize:10}}>hits</span></span>
                {hitState.lastUpdatedAt!=null&&<span style={{fontSize:9,color:C.dim}} title={new Date(hitState.lastUpdatedAt).toLocaleString()}>updated {relativeTime(hitState.lastUpdatedAt)}</span>}
              </span>
            );
            return null;
          })()}
          {!editing&&setOverride&&shown&&<button onClick={startEdit} style={{...btn("ghost"),fontSize:10,padding:"3px 9px"}}>✎ Edit query</button>}
          {shown&&<button onClick={copy} style={{...btn("ghost"),fontSize:10,padding:"3px 9px"}}>{copied?"✓ Copied":"Copy"}</button>}
          {shown&&<button onClick={()=>downloadText(`${dbId}-strategy.txt`,allStrategiesExportText([res]))} title="Download this strategy as a .txt file" style={{...btn("ghost"),fontSize:10,padding:"3px 9px"}}>⤓ .txt</button>}
          {(openUrl||homeUrl)&&(
            <a href={openUrl||homeUrl} target="_blank" rel="noopener noreferrer"
              title={openUrl?`Open ${res.label} with this strategy prefilled`:"Opens the database — paste your copied strategy"}
              style={{...btn("ghost"),fontSize:10,padding:"3px 9px",textDecoration:"none"}}>Open {res.label} ↗</a>
          )}
        </span>
      </div>

      {edited&&!editing&&(
        <div style={{background:`${alpha(C.yel,"10")}`,border:`1px solid ${alpha(C.yel,"40")}`,borderRadius:7,padding:"7px 10px",marginBottom:8,fontSize:11,color:C.txt2,display:"flex",alignItems:"center",gap:10}}>
          <span style={{flex:1}}>Manually edited — not synced to concept changes. Concept edits won&apos;t appear here until you revert.</span>
          <button onClick={()=>{setDraft(shown);setEditing(true);}} style={{...btn("ghost"),fontSize:10}}>Re-edit</button>
          <button onClick={revert} style={{...btn("solid"),fontSize:10}}>↺ Revert</button>
        </div>
      )}

      {editing?(
        <div>
          <textarea autoFocus value={draft} onChange={e=>setDraft(e.target.value)} aria-label={`Edit the ${res.label} query`}
            style={{width:"100%",minHeight:120,background:C.bg,border:`1px solid ${alpha(C.acc,"66")}`,borderRadius:8,padding:12,fontFamily:MONO,fontSize:11,lineHeight:1.7,color:C.txt,boxSizing:"border-box",outline:"none",resize:"vertical"}}/>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <button onClick={saveEdit} style={{...btn("primary"),fontSize:11}}>Save edited query</button>
            <button onClick={()=>setEditing(false)} style={{...btn("ghost"),fontSize:11}}>Cancel</button>
            <button onClick={revert} style={{...btn("ghost"),fontSize:11,marginLeft:"auto"}}>Reset to generated</button>
          </div>
        </div>
      ):shown?(
        <pre style={{background:C.bg,border:`1px solid ${edited?alpha(C.yel,"44"):C.brd}`,borderRadius:8,padding:12,fontFamily:MONO,fontSize:11,lineHeight:1.7,color:C.txt,whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0,maxHeight:280,overflowY:"auto"}}>{shown}</pre>
      ):(
        <div style={{color:C.dim,fontSize:12,padding:"8px 0",fontStyle:"italic"}}>Add terms to see the {res.label} strategy…</div>
      )}

      {!openUrl&&homeUrl&&shown&&(
        <div style={{fontSize:10,color:C.dim,marginTop:5}}>“Open” goes to the database&apos;s search page — paste your copied strategy there.</div>
      )}

      {(res.warnings||[]).length>0&&(
        <div style={{marginTop:8}}>
          {res.warnings.map((w,i)=>(
            <div key={i} style={{display:"flex",gap:7,alignItems:"flex-start",fontSize:11,color:C.txt2,lineHeight:1.5,padding:"2px 0"}}>
              <span aria-hidden="true" style={{color:C.yel,fontWeight:700}}>⚠</span><span>{w.message}</span>
            </div>
          ))}
        </div>
      )}
      {(res.unsupported||[]).length>0&&(
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
          {res.unsupported.map((u,i)=>(
            <span key={i} title={u.detail} style={{fontSize:9.5,fontWeight:600,color:C.muted,background:C.card2,border:`1px dashed ${C.brd2}`,borderRadius:5,padding:"1px 7px"}}>not supported: {u.feature}</span>
          ))}
        </div>
      )}
      {vocabLine&&<div style={{fontSize:10.5,color:C.muted,marginTop:8,fontFamily:MONO}}>{vocabLine}</div>}
      {guidance.length>0&&(
        <div style={{marginTop:8,borderTop:`1px solid ${C.brd}`,paddingTop:7}}>
          {guidance.map((n,i)=>(
            <div key={i} style={{fontSize:10.5,color:C.muted,lineHeight:1.55,padding:"1px 0"}}>· {n}</div>
          ))}
        </div>
      )}
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════════════════
   SB3 — GUIDED WORKFLOW UI (presentational; the engine + state stay in the main
   component). A light 5-step stepper replaces the old single dense two-column view.
   ════════════════════════════════════════════════════════════════════════════ */
// SB4 — Search Quality Check severity + sensitivity-signal colour maps.
const QC_COLOR={critical:C.red,warning:C.yel,info:C.acc};
const SENS_COLOR={"very-broad":C.red,broad:C.yel,balanced:C.grn,narrow:C.yel,"very-narrow":C.red};

/* 96.md D13.1/2 (+ QA M5) — the RESEARCH QUESTION card at the top of Terms &
   Vocabulary: readable question text with click-to-select word/phrase tokens.
   Clicking a token CREATES a concept group (the parent owns the create/dequeue/
   focus logic); `isSelected` = a group is already backed by that phrase.
   QA M5 — arbitrary CONTIGUOUS SPAN selection: a plain click also anchors the
   span; SHIFT-clicking a second token selects the literal question substring
   between the anchor and it (inclusive — spanPhrase) and creates ONE group from
   that exact phrase (so "sodium-glucose cotransporter 2 inhibitors" is selectable
   even though no curated phrase matches it). Filler/noise words are DIMMED but
   still real buttons (clickable-on-intent — the spec's own example selects
   "adults"). Keyboard: tokens are buttons (Enter selects; Shift+Enter extends
   from the anchor); a visible instruction line is wired via aria-describedby.
   Every token button carries aria-label = its exact text (the e2e + SSR-pinned
   accessible-name contract) and the .sbkw-token focus ring. */
export function QuestionPhraseCard({question,accent,isSelected,onTogglePhrase,onAddManual,onEditQuestion,readOnly}){
  const [manual,setManual]=useState("");
  const [anchorIdx,setAnchorIdx]=useState(null); // last plain-clicked token — the span anchor
  const tokens=useMemo(()=>tokenizeForSelection(question||""),[question]);
  const hintId=useId();
  // A stale anchor must never span across a DIFFERENT question's tokens.
  useEffect(()=>{ setAnchorIdx(null); },[question]);
  const addManual=()=>{ const v=manual.trim(); if(v){ onAddManual(v); setManual(""); } };
  const clickToken=(i,shiftKey)=>{
    if(shiftKey&&anchorIdx!=null&&anchorIdx!==i){
      const span=spanPhrase(tokens,anchorIdx,i);
      if(span) onTogglePhrase(span);
      setAnchorIdx(null); // the span consumed the anchor
      return;
    }
    setAnchorIdx(i);
    onTogglePhrase(tokens[i].text);
  };
  return(
    <div data-testid="sb-question-card" style={{background:C.card,border:`1px solid ${C.brd}`,borderLeft:`3px solid ${accent}`,borderRadius:10,padding:"11px 13px",marginBottom:10}}>
      <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:6}}>
        <span style={{fontSize:12,fontWeight:700,color:C.txt}}>Research question</span>
        <span style={{fontSize:10.5,color:C.muted}}>click the key ideas to create concept groups</span>
        {onEditQuestion&&(
          <button type="button" onClick={onEditQuestion}
            style={{marginLeft:"auto",background:"none",border:"none",color:C.acc,cursor:"pointer",fontSize:11,fontFamily:SANS,textDecoration:"underline",padding:0}}>
            Edit question
          </button>
        )}
      </div>
      {String(question||"").trim()?(
        <>
        <div style={{lineHeight:2.1}}>
          {tokens.map((tok,i)=>{
            const sel=isSelected(tok.text);
            const filler=tok.kind==="filler";
            return(
              <span key={i}> <button type="button" onClick={(e)=>clickToken(i,!!(e&&e.shiftKey))}
                onKeyDown={(e)=>{ if(e.key==="Enter"&&e.shiftKey){ e.preventDefault(); clickToken(i,true); } }}
                disabled={readOnly}
                title={sel?"Already a concept group — click to open it (or remove it while unchanged)"
                  :filler?"Common word — click if you really want a concept group from it; Shift-click selects the whole phrase up to here"
                  :"Click to create a concept group from this phrase; Shift-click a second word to select the phrase between them"}
                aria-label={tok.text} aria-pressed={sel} aria-describedby={hintId} className="sbkw-token"
                style={{cursor:readOnly?"default":"pointer",fontFamily:SANS,fontSize:12.5,padding:"2px 8px",borderRadius:7,margin:"0 1px",
                  border:sel?`1px solid ${accent}`:filler?"1px dashed transparent":`1px ${tok.suggested?"solid":"dashed"} ${tok.suggested?alpha(accent,"66"):C.brd2}`,
                  background:sel?`${alpha(accent,"22")}`:tok.suggested?`${alpha(accent,"0c")}`:"transparent",
                  color:sel?C.txt:C.txt2,fontWeight:sel?600:400,fontStyle:filler&&!sel?"italic":"normal"}}>
                {sel?"✓ ":""}{tok.text}{tok.kind==="phrase"&&!sel?<span style={{fontSize:8,opacity:.7,marginLeft:4}}>phrase</span>:null}
              </button> </span>
            );
          })}
        </div>
        <div id={hintId} data-testid="sb-span-hint" style={{fontSize:10,color:C.muted,marginTop:6}}>
          Click a word to create a concept group. Shift-click another word to select the whole phrase between them.
        </div>
        </>
      ):(
        <div style={{fontSize:11.5,color:C.muted,fontStyle:"italic"}}>
          No research question yet — add it in the <strong>Research Question</strong> stage, then click its key ideas here to build your search.
        </div>
      )}
      {!readOnly&&(
        <div style={{display:"flex",gap:6,marginTop:9}}>
          <input value={manual} onChange={e=>setManual(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addManual();}}}
            aria-label="Add a concept group manually"
            placeholder="Add a concept the question doesn't mention…" style={{...inputStyle,flex:1,fontSize:11.5}}/>
          <button onClick={addManual} style={{...btn("ghost"),fontSize:11}}>+ Add concept</button>
        </div>
      )}
    </div>
  );
}

/* 96.md D2 (+ QA M4) — the "question changed" drift banner. Shown when the current
   research question no longer matches the persisted questionSnapshot AND some
   concept groups' source phrases no longer appear in it. NEVER auto-deletes
   anything: each drifted row offers keep (banner-level, updates the snapshot),
   Edit (open the group), UPDATE PHRASE (QA M4 — an inline editor that rewrites the
   group's originating `sourcePhrase`; once the new phrase occurs in the question
   the group stops re-drifting on every later edit), and Remove (undoable). */
export function QuestionDriftBanner({drifted,onKeepAll,onEditConcept,onUpdatePhrase,onRemoveConcept,readOnly}){
  const [editingId,setEditingId]=useState(null);
  const [phraseDraft,setPhraseDraft]=useState("");
  if(!drifted.length) return null;
  const startPhraseEdit=(d)=>{ setEditingId(d.id); setPhraseDraft(d.sourcePhrase||""); };
  const savePhrase=(d)=>{
    const v=phraseDraft.trim();
    if(v&&onUpdatePhrase) onUpdatePhrase(d.id,v);
    setEditingId(null); setPhraseDraft("");
  };
  return(
    <div data-testid="sb-drift-banner" role="status"
      style={{background:`${alpha(C.yel,"10")}`,border:`1px solid ${alpha(C.yel,"44")}`,borderRadius:8,padding:"10px 12px",marginBottom:10,fontSize:12,color:C.txt2}}>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:6}}>
        <span style={{flex:1,minWidth:220}}>
          <strong style={{color:C.yel}}>Your research question changed.</strong>{" "}
          {drifted.length===1?"One concept group is":`${drifted.length} concept groups are`} no longer found in the question — keep, edit or remove them (nothing is deleted automatically).
        </span>
        {!readOnly&&(
          <button type="button" onClick={onKeepAll} style={{...btn("solid"),fontSize:10.5}}>
            Keep concepts — mark as up to date
          </button>
        )}
      </div>
      {drifted.map(d=>(
        <div key={d.id} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",padding:"4px 0",borderTop:`1px solid ${alpha(C.yel,"33")}`}}>
          <span style={{fontWeight:600,color:C.txt}}>{d.label}</span>
          <span style={{fontSize:10.5,color:C.muted}}>from “{d.sourcePhrase}”</span>
          {!readOnly&&editingId!==d.id&&(
            <span style={{marginLeft:"auto",display:"inline-flex",gap:6}}>
              <button type="button" onClick={()=>onEditConcept(d.id)} aria-label={`Edit concept ${d.label}`} style={{...btn("ghost"),fontSize:10,padding:"2px 9px"}}>Edit</button>
              {onUpdatePhrase&&(
                <button type="button" onClick={()=>startPhraseEdit(d)} aria-label={`Update the phrase for ${d.label}`}
                  title="Change which question phrase this group traces back to, so it stops being flagged"
                  style={{...btn("ghost"),fontSize:10,padding:"2px 9px"}}>Update phrase</button>
              )}
              <button type="button" onClick={()=>onRemoveConcept(d.id)} aria-label={`Remove concept ${d.label}`} style={{...btn("danger"),fontSize:10,padding:"2px 9px"}}>Remove</button>
            </span>
          )}
          {!readOnly&&editingId===d.id&&(
            <span data-testid="sb-drift-phrase-edit" style={{marginLeft:"auto",display:"inline-flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
              <input value={phraseDraft} onChange={e=>setPhraseDraft(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); savePhrase(d); } if(e.key==="Escape"){ setEditingId(null); } }}
                aria-label={`New phrase for ${d.label}`} placeholder="phrase from the question…"
                style={{...inputStyle,width:220,fontSize:11}} autoFocus/>
              <button type="button" onClick={()=>savePhrase(d)} disabled={!phraseDraft.trim()}
                style={{...btn("primary"),fontSize:10,padding:"2px 9px",opacity:phraseDraft.trim()?1:0.5}}>Save phrase</button>
              <button type="button" onClick={()=>setEditingId(null)} style={{...btn("ghost"),fontSize:10,padding:"2px 9px"}}>Cancel</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/* Visual concept blocks joined by AND/OR — the beginner's mental model before any
   Boolean string. Read-only summary used at the top of Build Strategy. */
function ConceptBlocksBar({concepts}){
  const blocks=concepts.map(c=>({label:c.label,n:liveTermsOf(c).length,op:c.op||"AND",pico:!!c.picoField})).filter(b=>b.n>0);
  if(!blocks.length) return <div style={{color:C.muted,fontSize:12,fontStyle:"italic",padding:"6px 0"}}>No concepts with terms yet — add keywords first.</div>;
  return(
    <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:8}}>
      {blocks.map((b,i)=>{
        const color=CONCEPT_COLORS[i%CONCEPT_COLORS.length];
        return(
          <span key={i} style={{display:"inline-flex",alignItems:"center",gap:8}}>
            <span style={{display:"inline-flex",alignItems:"center",gap:7,background:`${alpha(color,"12")}`,border:`1px solid ${alpha(color,"55")}`,borderRadius:9,padding:"6px 11px"}}>
              <span style={{width:8,height:8,borderRadius:2,background:color}}/>
              <span style={{fontSize:11.5,fontWeight:700,color:C.txt}}>{b.label}</span>
              <span style={{fontSize:9.5,color:C.muted,fontFamily:MONO}}>{b.n} term{b.n===1?"":"s"}</span>
            </span>
            {i<blocks.length-1&&<span style={{fontSize:10.5,fontWeight:700,fontFamily:MONO,letterSpacing:1,color:b.op==="OR"?C.yel:C.acc}}>{b.op}</span>}
          </span>
        );
      })}
    </div>
  );
}

const TIER_COLOR={free:"#22c55e",freeFulltext:"#22c55e",freeRegistry:"#22c55e",freeLimited:"#84cc16",subscription:"#f59e0b",mixed:"#eab308"};
/* Database catalogue with access notes (SB3 Tab 3). `selected` is a Set of ids. */
function DatabaseCatalogView({selected,onToggle,readOnly}){
  // QA M8 — selection persists with the strategy; viewers get disabled checkboxes.
  const roTitle=readOnly?"Read-only access — ask a project editor to change the database selection":undefined;
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,fontSize:11.5,color:C.txt2}}>
        <span>Pick the databases you plan to search.</span>
        <Help text={ACCESS_TOOLTIP}/>
        <span style={{marginLeft:"auto",fontSize:10.5,color:C.muted,fontFamily:MONO}}>{selected.size} selected</span>
      </div>
      {databaseGroups().map(({group,databases})=>(
        <div key={group} style={{marginBottom:12}}>
          <div style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:.6,textTransform:"uppercase",marginBottom:6}}>{group}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:8}}>
            {databases.map(db=>{
              const on=selected.has(db.id); const tcol=TIER_COLOR[db.tier]||C.muted;
              return(
                <label key={db.id} title={roTitle} style={{display:"flex",alignItems:"flex-start",gap:9,background:on?`${alpha(C.acc,"0e")}`:C.card,border:`1px solid ${on?alpha(C.acc,"55"):C.brd}`,borderRadius:9,padding:"9px 11px",cursor:readOnly?"not-allowed":"pointer",opacity:readOnly?0.7:1}}>
                  <input type="checkbox" checked={on} disabled={!!readOnly} aria-disabled={readOnly||undefined} onChange={()=>{ if(!readOnly) onToggle(db.id); }} style={{marginTop:2}}/>
                  <span style={{display:"flex",flexDirection:"column",gap:3,minWidth:0}}>
                    <span style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:12,fontWeight:600,color:C.txt}}>{db.label}</span>
                      {/* recs round — every catalogue database now has a compiler; badge by
                          syntax fidelity instead of the legacy 3-db nativeSyntax flag. */}
                      {db.syntaxLevel==="approximate"
                        ?<span title="The builder generates a simplified strategy for this database — review its notes before running" style={{fontSize:8,fontWeight:700,letterSpacing:.4,color:C.yel,textTransform:"uppercase",border:`1px solid ${alpha(C.yel,"55")}`,borderRadius:4,padding:"0 4px"}}>auto syntax·approx</span>
                        :<span title="The builder generates this database's exact search format" style={{fontSize:8,fontWeight:700,letterSpacing:.4,color:C.grn,textTransform:"uppercase",border:`1px solid ${alpha(C.grn,"55")}`,borderRadius:4,padding:"0 4px"}}>auto syntax</span>}
                    </span>
                    <span style={{fontSize:10.5,color:tcol}}>{ACCESS_TIERS[db.tier]}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* prompt60 — compact "Limits" panel (the Search Wizard's Define step). Edits the
   AST `filters` block { dateFrom, dateTo, languages[], pubTypes[] } that the Pecan
   Search engine already applies per provider (unsupported limits are warned, never
   silently dropped, in the run step). Languages are ISO 639-1 codes (DOAJ uses them;
   PubMed maps them to the full English name). Pub types are PubMed Publication Type
   strings. Pure presentational — the parent owns `filters` state + persistence. */
const LIMIT_LANGS = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['pt', 'Portuguese'], ['it', 'Italian'], ['ru', 'Russian'], ['ar', 'Arabic']];
const LIMIT_PUBTYPES = ['Randomized Controlled Trial', 'Clinical Trial', 'Systematic Review', 'Meta-Analysis', 'Review', 'Observational Study', 'Comparative Study', 'Case Reports'];
function LimitsPanel({ filters, setFilters, readOnly }) {
  const f = filters || { dateFrom: '', dateTo: '', languages: [], pubTypes: [] };
  // QA M8 — read-only viewers see the limits (they explain the strategy) but every
  // control is disabled with an access explanation; a viewer edit would only PUT
  // and be rejected server-side.
  const ROTITLE = 'Read-only access — ask a project editor to change the search limits';
  const set = (patch) => { if (readOnly) return; setFilters({ ...f, ...patch }); };
  const toggleIn = (key, val) => { const cur = Array.isArray(f[key]) ? f[key] : []; set({ [key]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] }); };
  const yr = (v) => String(v || '').replace(/[^0-9]/g, '').slice(0, 4);
  const active = !!(f.dateFrom || f.dateTo || (f.languages || []).length || (f.pubTypes || []).length);
  const chip = (on) => ({ ...btn(on ? 'primary' : 'ghost'), fontSize: 10.5, padding: '4px 10px', ...(readOnly ? { cursor: 'not-allowed', opacity: 0.6 } : {}) });
  return (
    <div data-testid="sb-limits-panel" style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 14, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase' }}>Limits</span>
        <Help text="Optional scope limits applied to every database that supports them: publication date range, language, and publication type. A database that can't apply a limit says so in the run step — the limit is never silently dropped." />
        {active
          ? <span style={{ marginLeft: 'auto', fontSize: 10, color: C.acc, fontFamily: MONO }}>active</span>
          : <span style={{ marginLeft: 'auto', fontSize: 10, color: C.muted }}>none — all years &amp; languages</span>}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: C.muted }}>Published from (year)
          <input value={f.dateFrom || ''} onChange={(e) => set({ dateFrom: yr(e.target.value) })} placeholder="e.g. 2010" inputMode="numeric"
            disabled={!!readOnly} title={readOnly ? ROTITLE : undefined} style={{ ...inputStyle, width: 120, ...(readOnly ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: C.muted }}>to (year)
          <input value={f.dateTo || ''} onChange={(e) => set({ dateTo: yr(e.target.value) })} placeholder="e.g. 2025" inputMode="numeric"
            disabled={!!readOnly} title={readOnly ? ROTITLE : undefined} style={{ ...inputStyle, width: 120, ...(readOnly ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }} /></label>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 5 }}>Languages</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {LIMIT_LANGS.map(([code, label]) => { const on = (f.languages || []).includes(code); return (
            <button key={code} onClick={() => toggleIn('languages', code)} disabled={!!readOnly} aria-disabled={readOnly || undefined}
              title={readOnly ? ROTITLE : undefined} style={chip(on)}>{on ? '✓ ' : ''}{label}</button>); })}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 5 }}>Publication types</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {LIMIT_PUBTYPES.map((pt) => { const on = (f.pubTypes || []).includes(pt); return (
            <button key={pt} onClick={() => toggleIn('pubTypes', pt)} disabled={!!readOnly} aria-disabled={readOnly || undefined}
              title={readOnly ? ROTITLE : undefined} style={chip(on)}>{on ? '✓ ' : ''}{pt}</button>); })}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MAIN EXPORT — SearchBuilderTab
   PROPS (all optional except where noted; see INTEGRATION_README.md):
     projectId   string   — INTEGRATION: which project this search belongs to
     question    string   — 96.md: the research question (authoritative input)
     pico        object   — LEGACY seam: only `pico.question` is read (fallback
                            when `question` is absent). No P/I/C/O dependency.
     api         object   — INTEGRATION: { meshLookup(text), pubmedCount(query) }
     loadSearch  func     — INTEGRATION: async (projectId) => savedState|null
     saveSearch  func     — INTEGRATION: async (projectId, state) => void
   ════════════════════════════════════════════════════════════════════════════ */
export default function SearchBuilderTab({projectId,question:questionProp,pico,api,loadSearch,saveSearch,phase,onLiveQuery,onHitState,onRegisterHitRefresh,onGoToStage,onStats,readOnly,visible=true}){
  const A=api||defaultApi;
  // 96.md — the research question is the ONE upstream text the builder reads
  // (`pico.question` stays a fallback seam so legacy mounts keep working; the
  // P/I/C/O fields are never read again).
  const question=typeof questionProp==="string"?questionProp:String((pico&&pico.question)||"");
  // prompt60/96.md — embedded mode: the staged Search Workspace renders this
  // builder as its Terms & Vocabulary ('terms' — the central workspace) and
  // Database Strategies ('build') stages, supplying its own chrome. The retired
  // 'define'/'concepts' phases are gone (see embeddedShowsStep). When `phase` is
  // undefined the builder keeps its standalone 5-step flow.
  const embedded = phase === 'build' || phase === 'terms';
  const [concepts,setConcepts]=useState([]);
  const [overrides,setOverrides]=useState({});
  // prompt60 — search-scope limits { dateFrom, dateTo, languages[], pubTypes[] }; the
  // Pecan Search AST already applies this block, the Limits panel edits it, and it is
  // persisted alongside the rest of the strategy (and surfaced to the run step).
  const [filters,setFilters]=useState({dateFrom:'',dateTo:'',languages:[],pubTypes:[]});
  const [activeDB,setActiveDB]=useState("pubmed");
  // SB3 + 85.md A2 — beginner mode is the default; the choice persists per browser
  // (localStorage 'sb-beginner') and the toggle is now exposed in the EMBEDDED
  // workspace toolbar too (audit M9: workspace novices could never reach it).
  const [beginner,setBeginner]=useState(()=>{ try{ return localStorage.getItem('sb-beginner')!=='0'; }catch{ return true; } });
  const toggleBeginner=()=>setBeginner(b=>{ const next=!b; try{ localStorage.setItem('sb-beginner',next?'1':'0'); }catch{/* private mode */} return next; });
  // SB3 — guided stepper position (1..5) and the selected databases / handoff marker.
  // selectedDbs [] means "use the catalogue defaults"; it is only written once the
  // user changes the selection, so existing projects don't trigger a spurious save.
  const [selectedDbs,setSelectedDbs]=useState([]);
  const [readyForScreening,setReadyForScreening]=useState(false);
  const [dismissedWarnings,setDismissedWarnings]=useState([]); // SB4 — Search-Quality warnings the user kept anyway
  const [exportMsg,setExportMsg]=useState(""); // transient copy/export feedback
  const [showPlainMirror,setShowPlainMirror]=useState(false); // 73.md P6 — strategy-level plain-English mirror toggle
  const [editing,setEditing]=useState(null);
  const [loaded,setLoaded]=useState(false);
  const [limitedMode,setLimitedMode]=useState(false); // backend/NLM unreachable
  const [counts,setCounts]=useState({});              // {dbId: number|null}
  const [countState,setCountState]=useState("idle");  // idle|loading
  // prompt42 Task 1 — PubMed hit lifecycle (the only LIVE db; embase/cochrane are
  // manual). { strategyHash, hitCount, status, lastUpdatedAt, errorMessage }.
  // status: idle | stale | updating | updated | failed.
  const [hitState,setHitState]=useState({strategyHash:null,hitCount:null,status:"idle",lastUpdatedAt:null,errorMessage:null});
  // prompt40 Task 2/5 + prompt42 Task 2 — auto-suggested terms the user deleted,
  // each as {text, field, label} (field/label = the PICO field the term came from,
  // so restore is granular per-field). Persisted so a PICO re-sync never re-adds
  // them (until restored). Legacy persisted string[] is normalized on load.
  const [ignored,setIgnored]=useState([]);
  // SE1 Task 5 — live collaborator sync. lastSavedRef holds the signature of the
  // state the server currently has (or we last sent); it makes BOTH autosave and
  // remote-apply idempotent (no redundant PUTs, no save↔poke ping-pong). revisionRef
  // tracks the server revision so we only adopt genuinely-newer remote documents.
  // pendingRemoteRef parks a remote update that arrived while the user was mid-edit.
  const lastSavedRef=useRef("");
  const revisionRef=useRef(0);
  const pendingRemoteRef=useRef(null);
  const [remotePending,setRemotePending]=useState(false);
  // Name of the collaborator whose live update we last applied (cleared once this
  // user makes their own edit). Drives the "updated by …" attribution chip.
  const [remoteUpdatedBy,setRemoteUpdatedBy]=useState(null);

  /* ── 85.md A2 — redesigned Concepts / Terms & Vocabulary state ────────────── */
  // Persisted rejection memory for vocabulary suggestions (A1 suggestionReview keys).
  const [rejectedSuggestions,setRejectedSuggestions]=useState([]);
  // Honest save-state machine: 'saved' | 'saving' | 'error' (audit C2 — silent failure).
  const [saveState,setSaveState]=useState('saved');
  // Feature-local undo stack (A1 undoStack) + the snackbar's latest action message.
  const [undoStack,setUndoStack]=useState([]);
  const [undoMsg,setUndoMsg]=useState(null);
  // Master-detail: the concept whose terms are being edited on the Terms stage.
  const [activeConceptId,setActiveConceptId]=useState(null);
  // 96.md D13.3 — group-management UI state (terms phase): inline delete confirm,
  // the merge-target picker, and the split panel's draft {cid, selected:{tid:true}, label}.
  const [confirmDeleteId,setConfirmDeleteId]=useState(null);
  const [mergeOpen,setMergeOpen]=useState(false);
  const [splitDraft,setSplitDraft]=useState(null);
  // Group UI state follows the active concept (stale pickers never linger).
  useEffect(()=>{ setConfirmDeleteId(null); setMergeOpen(false); setSplitDraft(null); },[activeConceptId]);
  // review-round #8 — switching the active concept closes any popover/add box that
  // belongs to another concept: an INVISIBLE editor (master-detail hides non-active
  // concepts) silently kept `busyEditing` true, deferring remote updates that then
  // "reappeared" much later.
  useEffect(()=>{
    if(!activeConceptId) return;
    setEditing(e=>(e&&e.conceptId&&e.conceptId!==activeConceptId?null:e));
  },[activeConceptId]);
  // Per-concept add-box drafts (keyed by concept id) — blur RETAINS them; switching
  // concepts round-trips them (critique #4: no navigation may lose typed work).
  const [drafts,setDrafts]=useState({});
  // A multi-term paste awaiting explicit confirmation: { cid, raw, terms } | null.
  const [pendingSplit,setPendingSplit]=useState(null);
  // Inline add-outcome message ("2 added · 1 already present") per concept id.
  const [addStatus,setAddStatus]=useState({});
  // Polite live-region announcement (keyword picker clicks, undo, bulk accepts).
  const [announceMsg,setAnnounceMsg]=useState('');
  // "Show dismissed" toggle inside the suggestions disclosure.
  const [showDismissedSuggs,setShowDismissedSuggs]=useState(false);
  // review-round #11 — clear-then-set: aria-live only fires on CONTENT CHANGE, so
  // two identical consecutive messages ("Added 'x'" twice) were silent the second
  // time. Blanking first guarantees a change; the timer also self-clears the region
  // so stale text is not re-read when the user tabs back into the live region.
  const announceTimer=useRef(null);
  const announce=(msg)=>{
    clearTimeout(announceTimer.current);
    setAnnounceMsg('');
    announceTimer.current=setTimeout(()=>setAnnounceMsg(String(msg||'')),30);
  };
  useEffect(()=>()=>clearTimeout(announceTimer.current),[]);

  /* ── refs (used by mount, autosave guard, and the group/undo mutators) ─── */
  const conceptsRef=useRef(concepts); conceptsRef.current=concepts;
  const ignoredRef=useRef(ignored); ignoredRef.current=ignored;
  const lookedRef=useRef(new Set()); // texts already MeSH-looked-up (dedupe lookups)

  /* ── 96.md D2 — the persisted question snapshot the strategy was built from.
     Set on seed / first phrase selection / drift-banner "keep"; NEVER auto-synced
     from mere question edits while groups have drifted (the banner owns that). ── */
  const [questionSnapshot,setQuestionSnapshot]=useState("");
  const questionSnapshotRef=useRef(questionSnapshot); questionSnapshotRef.current=questionSnapshot;

  /* ── INTEGRATION: load the saved search — 96.md: adopt it AS-IS. The PICO
     five-group auto-sync (syncSearchBuilderFromPico) is retired: saved concept
     groups (including legacy picoField/pico_auto shapes) load unchanged forever,
     with their client-generated ids NEVER regenerated (id-less legacy entries get
     one stamped exactly once). A never-saved project (GET null) seeds EMPTY from
     the research question (seedStateFromQuestion) — no scaffold groups. ── */
  useEffect(()=>{(async()=>{
    let saved=null;
    if(loadSearch&&projectId){ try{ saved=await loadSearch(projectId); }catch(e){ console.error("loadSearch failed",e); } }
    if(saved&&Array.isArray(saved.concepts)){
      const base=saved.concepts.map(c=>({...c,id:c.id||uid(),terms:(c.terms||[]).map(t=>({...t,id:t.id||uid()}))}));
      setConcepts(base);
      setOverrides(saved.overrides&&typeof saved.overrides==="object"?saved.overrides:{});
      setIgnored(Array.isArray(saved.ignored)?saved.ignored:[]);
      // prompt60 — load persisted search-scope limits (default empty for older saves).
      setFilters(saved.filters&&typeof saved.filters==="object"
        ?{dateFrom:String(saved.filters.dateFrom||""),dateTo:String(saved.filters.dateTo||""),
          languages:Array.isArray(saved.filters.languages)?saved.filters.languages.filter(s=>typeof s==="string"):[],
          pubTypes:Array.isArray(saved.filters.pubTypes)?saved.filters.pubTypes.filter(s=>typeof s==="string"):[]}
        :{dateFrom:"",dateTo:"",languages:[],pubTypes:[]});
      // SB3 — selected databases + handoff marker ([] / false when absent in older saves).
      setSelectedDbs(Array.isArray(saved.databases)?saved.databases.filter(s=>typeof s==="string"):[]);
      setReadyForScreening(!!saved.readyForScreening);
      setDismissedWarnings(Array.isArray(saved.dismissedWarnings)?saved.dismissedWarnings.filter(s=>typeof s==="string"):[]);
      // 85.md A1/A2 — persisted vocabulary-suggestion rejections (absent on old saves).
      setRejectedSuggestions(Array.isArray(saved.rejectedSuggestions)?saved.rejectedSuggestions.filter(s=>typeof s==="string"&&s.trim()):[]);
      // 96.md — the question snapshot ('' on pre-96 saves → no drift banner until
      // the user builds from the question and the snapshot is stamped).
      setQuestionSnapshot(typeof saved.questionSnapshot==="string"?saved.questionSnapshot:"");
      // Record what the server actually holds so autosave is a no-op until a real edit.
      lastSavedRef.current=serializeSearchState(saved);
      revisionRef.current=typeof saved.revision==="number"?saved.revision:0;
    } else {
      // GET null (revision 0) → seed EMPTY from the question (96.md D2). The first
      // autosave persists the seed (questionSnapshot rides along, omit-when-empty).
      const seeded=seedStateFromQuestion(question);
      setConcepts([]);
      setQuestionSnapshot(seeded.questionSnapshot);
      lastSavedRef.current="";
      revisionRef.current=0;
    }
    setLoaded(true);
  })();},[projectId]); // eslint-disable-line

  /* ── INTEGRATION: autosave whenever the search changes (debounced) ────────
     74.md recs round — readyForScreening stays in the SIGNATURE (change detection +
     no phantom PUT on load, since serializeSearchState always coerces the key) but
     is deliberately NOT in the PUT payload: it is an advisory marker with a second
     writer (the workspace's Send-to-Screening toggle saves it single-key), and
     re-emitting this component's mount-time copy from the bulk autosave silently
     reverted that toggle. The step-5 button below persists it single-key instead;
     the server keeps whichever writer acted last. */
  const saveTimer=useRef(null);
  // 85.md A2 — the pending payload+signature, held in a ref so an unmount can FLUSH
  // the debounced save immediately (the old 800ms window silently lost the last edit
  // when the user navigated away mid-debounce) and so saveNow (the Retry button) can
  // re-fire the exact same write.
  const pendingSaveRef=useRef(null);
  const saveStateRef=useRef('saved'); // mirror for the unmount flush (no stale closure)
  const doSave=useCallback(async(sig,payload)=>{
    if(!saveSearch||!projectId) return;
    setSaveState('saving'); saveStateRef.current='saving';
    try{
      const res=await saveSearch(projectId,payload);
      if(!res) throw new Error('save rejected');
      lastSavedRef.current=sig;
      if(res&&typeof res.revision==="number") revisionRef.current=res.revision;
      if(pendingSaveRef.current&&pendingSaveRef.current.sig===sig) pendingSaveRef.current=null;
      setSaveState('saved'); saveStateRef.current='saved';
    }catch(e){
      console.error("saveSearch failed",e);
      setSaveState('error'); saveStateRef.current='error'; // pendingSaveRef keeps the payload for Retry
    }
  },[saveSearch,projectId]); // eslint-disable-line
  // Immediate save (Retry button / unmount flush) — bypasses the 800ms debounce.
  const saveNow=useCallback(()=>{
    clearTimeout(saveTimer.current);
    const p=pendingSaveRef.current;
    if(p) doSave(p.sig,p.payload);
  },[doSave]);
  useEffect(()=>{
    if(!loaded||!saveSearch||!projectId) return;
    const sig=serializeSearchState({concepts,overrides,ignored,databases:selectedDbs,readyForScreening,dismissedWarnings,filters,rejectedSuggestions,questionSnapshot});
    if(sig===lastSavedRef.current){
      pendingSaveRef.current=null; // unchanged vs the server → no PUT, no ping-pong
      // review-round #7 — an edit REVERTED inside the 800ms window (snackbar Undo,
      // re-typing the old value) cancels the pending PUT; the indicator must not
      // stay "Saving…" forever for a save that will never fire.
      if(saveStateRef.current==='saving'){ setSaveState('saved'); saveStateRef.current='saved'; }
      return;
    }
    setRemoteUpdatedBy(null); // this user is now editing → drop the "updated by collaborator" attribution
    const payload={concepts,overrides,ignored,databases:selectedDbs,dismissedWarnings,filters,rejectedSuggestions,questionSnapshot};
    pendingSaveRef.current={sig,payload};
    setSaveState('saving'); saveStateRef.current='saving';
    clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>doSave(sig,payload),800);
    return ()=>clearTimeout(saveTimer.current);
  },[concepts,overrides,ignored,selectedDbs,readyForScreening,dismissedWarnings,filters,rejectedSuggestions,questionSnapshot,loaded]); // eslint-disable-line
  // Unmount flush — if a debounced save is still pending, fire it immediately so
  // leaving the Search tab inside the 800ms window can never lose the last edit.
  useEffect(()=>()=>{
    clearTimeout(saveTimer.current);
    const p=pendingSaveRef.current;
    if(p&&p.sig!==lastSavedRef.current&&saveStateRef.current!=='error'){
      // fire-and-forget: the component is gone; the server ack just lands.
      doSave(p.sig,p.payload);
    }
  },[doSave]);

  /* (96.md — the SE2 "auto-sync the five groups whenever PICO changes" effect is
     RETIRED with the PICO scaffold. Question edits never mutate concept groups;
     drift detection below flags groups whose source phrase left the question, and
     the user decides — keep / edit / remove. Nothing is auto-deleted.) */

  /* ── SE1 Task 5: live collaborator sync over the shared SSE poke channel ──
     A peer's save emits a thin `search.updated` poke; we refetch the authorized
     document and adopt it ONLY when it is genuinely newer AND the user is not
     mid-edit (so an open editor / unsaved chip is never clobbered). The acting
     user already sees their own change locally — the poke excludes them. */
  function applyRemote(saved){
    const persisted=pickPersisted(saved);
    lastSavedRef.current=serializeSearchState(saved); // set BEFORE state writes so autosave sees no diff (no echo PUT)
    if(typeof saved.revision==="number") revisionRef.current=saved.revision;
    setConcepts(persisted.concepts); setOverrides(persisted.overrides); setIgnored(persisted.ignored);
    setSelectedDbs(persisted.databases); setReadyForScreening(persisted.readyForScreening); // SB3
    setDismissedWarnings(persisted.dismissedWarnings); // SB4
    setFilters(persisted.filters||{dateFrom:"",dateTo:"",languages:[],pubTypes:[]}); // prompt60
    setRejectedSuggestions(persisted.rejectedSuggestions||[]); // 85.md A1
    setQuestionSnapshot(persisted.questionSnapshot||""); // 96.md D2
    // 85.md A1 — the undo stack is only valid against the document it was recorded
    // on; undoing across a collaborator's update would resurrect stale state and
    // clobber their work via the last-write-wins PUT.
    setUndoStack(clearUndo()); setUndoMsg(null);
    pendingSaveRef.current=null; setSaveState('saved'); saveStateRef.current='saved';
    setRemoteUpdatedBy(saved.updatedBy&&saved.updatedBy.name?saved.updatedBy.name:"a collaborator");
    pendingRemoteRef.current=null; setRemotePending(false);
  }
  // 85.md A2 — busy now also covers the new edit surfaces: an open term-editor
  // popover, a non-empty per-concept add draft, and a pending multi-term paste.
  // review-round #6 — only drafts belonging to a concept that still EXISTS count
  // (an orphaned entry — e.g. adopted remote state deleted the concept — must not
  // block remote adoption forever).
  const anyDraft=Object.entries(drafts).some(([cid,v])=>v&&String(v).trim()&&concepts.some(c=>c.id===cid));
  const busyEditing=!!(editing||anyDraft||pendingSplit);
  async function pullRemote(){
    if(!loadSearch||!projectId) return;
    let saved; try{ saved=await loadSearch(projectId); }catch{ return; }
    if(!saved||!saved.concepts) return;
    const decision=remoteAdoptDecision({
      remoteSig:serializeSearchState(saved), lastSavedSig:lastSavedRef.current,
      remoteRevision:saved.revision, knownRevision:revisionRef.current,
      busy:busyEditing,
    });
    if(decision==="skip") return;
    if(decision==="defer"){ pendingRemoteRef.current=saved; setRemotePending(true); return; }
    applyRemote(saved);
  }
  // ONE shared EventSource per browser tab (module-level manager). The handler reads
  // fresh state through the hook's internal ref, so this closure always sees the
  // latest editing/draft. `healthy` false ⇒ pokes aren't flowing; load-on-mount +
  // autosave remain the correctness fallback.
  const { healthy:rtHealthy }=useRealtime({
    "search.updated":(ev)=>{ if(ev&&ev.metaLabProjectId===projectId) pullRemote(); },
  });
  // When the user finishes editing, flush any remote update parked during the edit.
  useEffect(()=>{
    if(!busyEditing&&pendingRemoteRef.current) applyRemote(pendingRemoteRef.current);
  },[editing,drafts,pendingSplit]); // eslint-disable-line

  /* Restore-all for the "user said no" memory. 96.md — with the PICO auto-sync
     retired there is nothing to re-extract: clearing `ignored` simply stops
     remembering old removals (per-entry restore below re-adds specific terms), and
     clearing `rejectedSuggestions` lets every dismissed vocabulary suggestion
     resurface (85.md A1 — no rejection is ever hidden-unrecoverable). */
  function resetSuggestions(){
    lookedRef.current=new Set();
    const cleared=resetSuggestionMemory({});
    setIgnored(cleared.ignored);
    setRejectedSuggestions(cleared.rejectedSuggestions);
  }

  /* prompt42 Task 2 — re-add ONE removed PICO term as source:'pico_auto' into the
     concept that owns it (matched by field+label, else label, else recreated) and
     remove it from `ignored`. Returns the {cid,tid} so the caller can lookup. */
  function restoreTermInto(cs,entry){
    const wantField=entry.field||"", wantLabel=cnorm(entry.label);
    let target=cs.find(c=>(c.field||"")===wantField&&cnorm(c.label)===wantLabel&&wantLabel);
    if(!target) target=cs.find(c=>cnorm(c.label)===wantLabel&&wantLabel);
    const tid=uid();
    const newTerm={id:tid,text:entry.text,type:"freetext",field:"tiab",source:"pico_auto"};
    let cid;
    let next;
    if(target){
      cid=target.id;
      // no-op if a term with this text already lives in the concept (dedupe)
      if(target.terms.some(t=>cnorm(t.text)===cnorm(entry.text))) return {cs,cid:null,tid:null};
      next=cs.map(c=>c.id===cid?{...c,terms:[...c.terms,newTerm]}:c);
    } else {
      cid=uid();
      next=[...cs,{id:cid,label:entry.label||entry.text,field:wantField,source:"pico_auto",op:"AND",terms:[newTerm]}];
    }
    return {cs:next,cid,tid};
  }

  /* Restore a single hidden term (↩ on one entry). */
  function restoreTerm(entry){
    let res;
    setConcepts(cs=>{ res=restoreTermInto(cs,entry); return res.cs; });
    setIgnored(ig=>ig.filter(e=>cnorm(e.text)!==cnorm(entry.text)));
    if(res&&res.cid) tryLookup(res.cid,res.tid,entry.text);
  }

  /* Restore every hidden term from one PICO field ("Restore all from <field>"). */
  function restoreField(field){
    const entries=ignored.filter(e=>(e.field||"")===(field||""));
    if(!entries.length) return;
    const looked=[];
    setConcepts(cs=>{
      let cur=cs;
      for(const e of entries){ const r=restoreTermInto(cur,e); cur=r.cs; if(r.cid) looked.push([r.cid,r.tid,e.text]); }
      return cur;
    });
    const drop=new Set(entries.map(e=>cnorm(e.text)));
    setIgnored(ig=>ig.filter(e=>!drop.has(cnorm(e.text))));
    looked.forEach(([cid,tid,text])=>tryLookup(cid,tid,text));
  }

  /* Hidden terms grouped by PICO field for the "Hidden PICO terms" UI block. */
  const ignoredByField=useMemo(()=>{
    const m=new Map();
    for(const e of ignored){ const k=e.field||""; if(!m.has(k)) m.set(k,[]); m.get(k).push(e); }
    return [...m.entries()].map(([field,items])=>({field,label:items.find(i=>i.label)?.label||"",items}));
  },[ignored]);

  /* 85.md A2 — the dead newSuggestionCount/presentPrimaries/picoDirty trio is gone
     (it was never wired and would have thrown on first use); the real suggestion
     counts come from the pure A1 suggestionReview module below. */

  /* ── MeSH lookup via API with offline fallback ─────────────────────────── */
  const tryLookup=useCallback(async (cid,tid,text,forceControlled)=>{
    try{
      const v=await A.meshLookup(text);
      if(v){
        if(v.source!=="live"&&v.source!=="live-nlm") setLimitedMode(true);
        setConcepts(cs=>cs.map(c=>c.id===cid?{...c,terms:c.terms.map(t=>t.id===tid?{...t,vocab:v,type:forceControlled?"controlled":(t.type==="controlled"?"controlled":t.type)}:t)}:c));
      } else if(forceControlled){
        setConcepts(cs=>cs.map(c=>c.id===cid?{...c,terms:c.terms.map(t=>t.id===tid?{...t,type:"controlled",vocab:null}:t)}:c));
      }
    }catch(e){
      setLimitedMode(true);
      // fall back to offline core
      const v=await defaultApi.meshLookup(text);
      if(v) setConcepts(cs=>cs.map(c=>c.id===cid?{...c,terms:c.terms.map(t=>t.id===tid?{...t,vocab:v}:t)}:c));
    }
  },[A]);

  /* ── live PubMed HIT lifecycle (prompt42 Task 1) ──────────────────────────
     The PubMed query drives a status machine: any change to the strategy hash
     immediately marks the hits 'stale', then a single debounced (600ms) refresh
     runs 'updating' → 'updated' (count + timestamp) or 'failed' (errorMessage).
     Cached queries resolve instantly to 'updated'. A race guard discards any
     result whose hash no longer matches the current strategy. Drives the hash off
     `pubmedQuery`, which already prefers a user-edited override over the generated
     query, so hand-edited strategies stay safe. */
  const countCache=useRef({});        // query string -> { n: count|null, at: fetchedAtMs } (M5: honest timestamps)
  const countTimer=useRef(null);
  const pubmedQuery=useMemo(()=>{
    const o=overrides.pubmed;
    if(o!=null) return o;
    // recs round — count the SAME string the compiled PubMed panel displays
    // (including embedded Limits), so the pulse/hit chip and the strategy
    // workspace can never disagree about what "≈ N records" refers to. Falls
    // back to the raw renderer (byte-identical when no filters are set).
    try{ return compileStrategy({concepts,filters},"pubmed",{applyOverride:false}).query; }
    catch{ return renderSearch(concepts,"pubmed").full; }
  },[concepts,overrides,filters]);
  const pubHash=useMemo(()=>strategyHash(pubmedQuery),[pubmedQuery]);

  useEffect(()=>{
    // No query → reset to idle (nothing to count).
    if(!pubmedQuery){
      setHitState({strategyHash:pubHash,hitCount:null,status:"idle",lastUpdatedAt:null,errorMessage:null});
      setCounts(c=>({...c,pubmed:null})); setCountState("idle");
      return;
    }
    // Cached → resolve immediately to 'updated' (no fetch, no flicker). 85.md A2
    // (audit M5): the timestamp shown is the time the count was actually FETCHED
    // (stored alongside the cache entry) — a cache hit must never stamp a fresh
    // "updated just now" on a 40-minute-old number.
    if(countCache.current[pubmedQuery]!==undefined){
      const cached=countCache.current[pubmedQuery];
      setHitState({strategyHash:pubHash,hitCount:cached.n,status:"updated",
        lastUpdatedAt:cached.at,errorMessage:null});
      setCounts(c=>({...c,pubmed:cached.n})); setCountState("idle");
      return;
    }
    // New strategy → mark stale right away, then debounce a single refresh.
    setHitState(s=>({...s,strategyHash:pubHash,status:"stale",errorMessage:null}));
    setCountState("loading");
    clearTimeout(countTimer.current);
    countTimer.current=setTimeout(async()=>{
      setHitState(s=>s.strategyHash===pubHash?{...s,status:"updating"}:s);
      try{
        const n=await A.pubmedCount(pubmedQuery);
        countCache.current[pubmedQuery]={n,at:Date.now()}; // fetch time rides with the count (M5)
        setCounts(c=>({...c,pubmed:n}));
        // Race guard: only commit if this is still the current strategy.
        setHitState(s=>s.strategyHash===pubHash
          ?{strategyHash:pubHash,hitCount:n,status:"updated",lastUpdatedAt:Date.now(),errorMessage:null}:s);
      }catch(e){
        setCounts(c=>({...c,pubmed:null})); setLimitedMode(true);
        setHitState(s=>s.strategyHash===pubHash
          ?{...s,strategyHash:pubHash,status:"failed",errorMessage:(e&&e.message)||"Hit count unavailable"}:s);
      }
      setCountState("idle");
    },600); // INTEGRATION: debounce window — see BACKEND_CONTRACT for tradeoffs
    return ()=>clearTimeout(countTimer.current);
  },[pubHash,pubmedQuery,A]); // eslint-disable-line

  /* ── 73.md P3 — persistent-pulse seams for the staged Search Workspace ──────
     onHitState: report every hit-state transition upward as a small snapshot.
     onRegisterHitRefresh: hand the parent a stable "refresh now" trigger that
     bypasses the 600ms debounce (Retry button). Both are ref-wrapped so a parent
     passing fresh callbacks per render never re-fires effects, and the FNV hash
     guard stays authoritative: results are committed ONLY while the strategy hash
     still matches, so a forced refresh racing the debounced one can never publish
     a stale count. */
  const onHitStateRef=useRef(onHitState); onHitStateRef.current=onHitState;
  useEffect(()=>{
    if(typeof onHitStateRef.current!=="function") return;
    onHitStateRef.current({
      status:hitState.status, count:hitState.hitCount, updatedAt:hitState.lastUpdatedAt,
      strategyHash:hitState.strategyHash, error:hitState.errorMessage,
    });
  },[hitState]);
  const pubmedQueryRef=useRef(pubmedQuery); pubmedQueryRef.current=pubmedQuery;
  const pubHashRef=useRef(pubHash); pubHashRef.current=pubHash;
  const refreshHitsNow=useCallback(async()=>{
    const q=pubmedQueryRef.current, h=pubHashRef.current;
    if(!q) return;
    clearTimeout(countTimer.current);          // cancel any pending debounced fetch (no double-fetch)
    delete countCache.current[q];              // force a genuinely fresh count
    setHitState(s=>s.strategyHash===h?{...s,status:"updating",errorMessage:null}:s);
    try{
      const n=await A.pubmedCount(q);
      countCache.current[q]={n,at:Date.now()}; // fetch time rides with the count (M5)
      setCounts(c=>({...c,pubmed:n}));
      setHitState(s=>s.strategyHash===h
        ?{strategyHash:h,hitCount:n,status:"updated",lastUpdatedAt:Date.now(),errorMessage:null}:s);
    }catch(e){
      setHitState(s=>s.strategyHash===h
        ?{...s,strategyHash:h,status:"failed",errorMessage:(e&&e.message)||"Hit count unavailable"}:s);
    }
    setCountState("idle");
  },[A]);
  const registerRefreshRef=useRef(onRegisterHitRefresh); registerRefreshRef.current=onRegisterHitRefresh;
  useEffect(()=>{
    if(typeof registerRefreshRef.current==="function") registerRefreshRef.current(refreshHitsNow);
  },[refreshHitsNow]);

  /* ── concept/term mutators ─────────────────────────────────────────────── */
  const updateConcept=(id,patch)=>setConcepts(cs=>cs.map(c=>c.id===id?{...c,...patch}:c));
  const updateTerm=(cid,tid,patch)=>setConcepts(cs=>cs.map(c=>c.id===cid?{...c,terms:c.terms.map(t=>t.id===tid?{...t,...patch}:t)}:c));
  // prompt42 Task 2 — add an ignored entry only when its text isn't already there.
  const addIgnored=(entry)=>setIgnored(ig=>ig.some(e=>cnorm(e.text)===cnorm(entry.text))?ig:[...ig,entry]);
  // prompt40 Task 5 + prompt42 Task 2 — deleting an AUTO-suggested term records it
  // (with the owning concept's PICO field + label) as ignored so a PICO re-sync
  // won't re-add it, and so it can be restored back into the right field. User-added
  // terms are simply removed (nothing to remember).
  const removeTerm=(cid,tid)=>{
    const c=concepts.find(x=>x.id===cid);
    const t=c?.terms.find(x=>x.id===tid);
    // 85.md A2 — record the inverse (incl. the ignored entry the removal adds) so
    // the snackbar's Undo restores term AND bookkeeping together (critique #7).
    if(c&&t){
      const willIgnore=t.source==="pico_auto"&&!ignored.some(e=>cnorm(e.text)===cnorm(t.text));
      const entry=willIgnore?{text:t.text,field:c.field||"",label:c.label||""}:null;
      setUndoStack(st=>recordRemoveTerm(st,{concept:c,term:t,ignoredEntryAdded:entry}));
      setUndoMsg(`Removed "${t.text}"`);
    }
    if(t&&t.source==="pico_auto"){ addIgnored({text:t.text,field:c?.field||"",label:c?.label||""}); }
    setConcepts(cs=>cs.map(c2=>c2.id===cid?{...c2,terms:c2.terms.filter(t2=>t2.id!==tid)}:c2));
    if(editing&&editing.termId===tid) setEditing(null);
  };
  const addConcept=()=>setConcepts(cs=>[...cs,{id:uid(),label:`Concept ${cs.length+1}`,op:"AND",source:"user_added",terms:[]}]);
  const removeConcept=id=>{
    const c=concepts.find(x=>x.id===id);
    const idx=concepts.findIndex(x=>x.id===id);
    const auto=(c?.terms||[]).filter(t=>t.source==="pico_auto").map(t=>({text:t.text,field:c?.field||"",label:c?.label||""}));
    const have=new Set(ignored.map(e=>cnorm(e.text)));
    const actuallyAdded=auto.filter(e=>!have.has(cnorm(e.text)));
    if(c){
      setUndoStack(st=>recordRemoveConcept(st,{concept:c,index:idx,ignoredEntriesAdded:actuallyAdded}));
      setUndoMsg(`Deleted concept "${c.label}"`);
    }
    if(auto.length) setIgnored(ig=>{
      const haveNow=new Set(ig.map(e=>cnorm(e.text)));
      return [...ig,...auto.filter(e=>!haveNow.has(cnorm(e.text)))];
    });
    setConcepts(cs=>cs.filter(c2=>c2.id!==id));
    setActiveConceptId(a=>a===id?null:a);
    // review-round #6 — a deleted concept's retained add-draft / pending paste /
    // inline status must not linger: an orphaned draft kept `busyEditing` true
    // FOREVER, permanently deferring remote adoption for this session.
    setDrafts(d=>{ if(!(id in d)) return d; const {[id]:_gone,...rest}=d; return rest; });
    setAddStatus(s=>{ if(!(id in s)) return s; const {[id]:_gone,...rest}=s; return rest; });
    setPendingSplit(p=>(p&&p.cid===id?null:p));
    if(editing&&editing.conceptId===id) setEditing(null);
  };
  /* 85.md A2 — disable-without-delete (A1 setTermDisabled) + undo. */
  const toggleTermDisabled=(cid,tid)=>{
    const c=concepts.find(x=>x.id===cid);
    const t=c?.terms.find(x=>x.id===tid);
    if(!c||!t) return;
    const disabling=t.disabled!==true;
    if(disabling){
      setUndoStack(st=>recordDisable(st,{concept:c,term:t}));
      setUndoMsg(`Switched off "${t.text}"`);
    }
    setConcepts(cs=>setTermDisabled(cs,cid,tid,disabling));
  };
  /* 85.md A2 — the snackbar's Undo: apply the inverse of the latest recorded action. */
  const undoLastAction=()=>{
    const r=undoLast(undoStack,{concepts:conceptsRef.current,ignored:ignoredRef.current});
    if(!r) return;
    setConcepts(r.state.concepts);
    setIgnored(r.state.ignored);
    setUndoStack(r.stack);
    setUndoMsg(null);
    announce(r.description||'Undone');
  };
  /* prompt42 Task 3 — add a picked suggestion as a term. MeSH → controlled (with a
     lookup to attach the descriptor); keyword/synonym → freetext. Deduped against
     the concept's existing terms (mirrors addSynonyms). Triggers a hit refresh. */
  const addSuggestion=(cid,sugg)=>{
    const c=concepts.find(x=>x.id===cid); if(!c||!sugg) return;
    const text=String(sugg.label||"").trim(); if(!text) return;
    if(c.terms.some(t=>t.text.toLowerCase()===text.toLowerCase())) return; // dedupe
    const tid=uid();
    const isMesh=sugg.type==="mesh";
    const newTerm=isMesh
      ? {id:tid,text:(sugg.mesh||text),type:"controlled",field:"tiab",source:"user_added",vocab:sugg.vocab||null}
      : {id:tid,text,type:"freetext",field:"tiab",source:sugg.type==="synonym"?"synonym":"user_added"};
    setConcepts(cs=>cs.map(x=>x.id===cid?{...x,terms:[...x.terms,newTerm]}:x));
    // Attach/confirm the descriptor: force controlled for MeSH, best-effort otherwise.
    tryLookup(cid,tid,newTerm.text,isMesh);
  };
  const addSynonyms=(cid,tid)=>{
    const c=concepts.find(x=>x.id===cid),t=c?.terms.find(x=>x.id===tid);
    if(!t?.vocab) return;
    const existing=new Set(c.terms.map(x=>x.text.toLowerCase()));
    const newTerms=(t.vocab.synonyms||[]).filter(s=>!existing.has(s.toLowerCase())).map(s=>({id:uid(),text:s,type:"freetext",field:"tiab",source:"synonym"}));
    setConcepts(cs=>cs.map(x=>x.id===cid?{...x,terms:[...x.terms,...newTerms]}:x));
  };

  /* ── 85.md A2 — typed/pasted term entry through the ONE pure commit path ────
     addTypedTerms splits (newline/semicolon ONLY — never comma), normalizes outer
     quotes to phrase:true, dedupes, and reports what was skipped so nothing is
     silently dropped OR silently duplicated (audit H1/C3/M7). */
  const applyTypedAdd=(cid,raw)=>{
    const base=conceptsRef.current;
    const res=addTypedTerms(base,cid,raw);
    const target=base.find(x=>x.id===cid);
    const label=target?target.label:'this concept';
    if(res.concepts!==base){
      // assign ids to the new (id-less) terms, then trigger vocab lookups for them
      const looks=[];
      const withIds=res.concepts.map(c=>{
        if(c.id!==cid) return c;
        return {...c,terms:c.terms.map(t=>{
          if(t.id) return t;
          const tid=uid(); looks.push([tid,t.text]);
          return {...t,id:tid};
        })};
      });
      setConcepts(withIds);
      looks.forEach(([tid,text])=>tryLookup(cid,tid,text));
    }
    const msg=res.added.length&&res.duplicates.length
      ? `${res.added.length} added · ${res.duplicates.length} already present`
      : res.added.length
        ? (res.added.length===1?`Added "${res.added[0]}" to ${label}`:`${res.added.length} terms added to ${label}`)
        : res.duplicates.length
          ? `"${res.duplicates[0]}" is already in ${label}`
          : '';
    setDrafts(d=>({...d,[cid]:''}));
    setPendingSplit(null);
    if(msg){
      setAddStatus(s=>({...s,[cid]:msg})); announce(msg);
      // review-round #11 — the inline status is transient feedback, not permanent
      // chrome: clear it after a beat (unless a newer message replaced it).
      setTimeout(()=>setAddStatus(s=>(s[cid]===msg?(({[cid]:_gone,...rest})=>rest)(s):s)),8000);
    }
  };
  /* Commit the draft: multi-term input pauses on an explicit "Add N terms?" preview. */
  const commitTypedDraft=(cid)=>{
    const raw=String(drafts[cid]||'');
    const {terms}=splitTermInput(raw);
    if(!terms.length) return;
    if(terms.length>1){ setPendingSplit({cid,raw,terms}); return; }
    applyTypedAdd(cid,raw);
  };
  /* A multi-line paste lands directly in the confirm row (inputs strip newlines). */
  const handleMultiPaste=(cid,rawText)=>{
    const {terms}=splitTermInput(rawText);
    if(terms.length>1) setPendingSplit({cid,raw:rawText,terms});
  };

  /* ── 85.md A2 — vocabulary-suggestion review (pure A1 suggestionReview) ───── */
  const suggCounts=useMemo(()=>suggestionCount(concepts,rejectedSuggestions),[concepts,rejectedSuggestions]);
  const acceptSuggestion=(cid,s)=>{
    const c=conceptsRef.current.find(x=>x.id===cid); if(!c||!s) return;
    const created=[];
    if(s.kind==='mesh'){
      const tid=uid(); created.push(tid);
      const newTerm={id:tid,text:s.text,type:'controlled',field:'tiab',source:'user_added',vocab:s.vocab||null};
      setConcepts(cs=>cs.map(x=>x.id===cid?{...x,terms:[...x.terms,newTerm]}:x));
      if(!s.vocab) tryLookup(cid,tid,s.text,true);
      announce(`Added subject heading "${s.text}" to ${c.label}`);
    } else if(s.kind==='synonyms'){
      const existing=new Set((c.terms||[]).map(x=>cnorm(x.text)));
      const newTerms=(s.synonyms||[]).filter(x=>!existing.has(cnorm(x))).map(x=>{const tid=uid();created.push(tid);return {id:tid,text:x,type:'freetext',field:'tiab',source:'synonym'};});
      if(!newTerms.length) return;
      setConcepts(cs=>cs.map(x=>x.id===cid?{...x,terms:[...x.terms,...newTerms]}:x));
      announce(`Added ${newTerms.length} synonym${newTerms.length===1?'':'s'} to ${c.label}`);
    }
    if(created.length){
      setUndoStack(st=>recordBulkAccept(st,{concept:c,termIds:created,label:s.text}));
      setUndoMsg(`Accepted "${s.text}"`);
    }
  };
  const dismissSuggestion=(s)=>{
    if(!s||!s.key) return;
    setRejectedSuggestions(r=>r.includes(s.key)?r:[...r,s.key]);
    announce(`Dismissed suggestion "${s.text}"`);
  };
  const unrejectSuggestion=(key)=>setRejectedSuggestions(r=>r.filter(k=>k!==key));
  const acceptAllHeadings=(cid)=>{
    const c=conceptsRef.current.find(x=>x.id===cid); if(!c) return;
    const pend=pendingSuggestions(c,rejectedSuggestions).filter(s=>s.kind==='mesh');
    if(!pend.length) return;
    // review-round #9 — several freetext terms can map to ONE heading ("t2dm" and
    // "type 2 diabetes" → "Diabetes Mellitus, Type 2"): accept each descriptor once,
    // and skip descriptors the concept already carries as a controlled term.
    const have=new Set(c.terms.filter(t=>t.type==='controlled').map(t=>cnorm(t.text)));
    const batch=[];
    for(const s of pend){ const k=cnorm(s.text); if(!k||have.has(k)) continue; have.add(k); batch.push(s); }
    if(!batch.length) return;
    const created=[];
    const newTerms=batch.map(s=>{const tid=uid();created.push(tid);return {id:tid,text:s.text,type:'controlled',field:'tiab',source:'user_added',vocab:s.vocab||null};});
    setConcepts(cs=>cs.map(x=>x.id===cid?{...x,terms:[...x.terms,...newTerms]}:x));
    setUndoStack(st=>recordBulkAccept(st,{concept:c,termIds:created,label:`${batch.length} headings`}));
    setUndoMsg(`Accepted ${batch.length} subject heading${batch.length===1?'':'s'}`);
    announce(`Accepted ${batch.length} subject heading${batch.length===1?'':'s'} into ${c.label}`);
  };
  /* Rejection keys scoped to one concept, for the "Show dismissed" restore list. */
  const rejectedEntriesFor=(c)=>{
    if(!c) return [];
    const prefix=rejectionKey(c,'');
    return rejectedSuggestions.filter(k=>k.startsWith(prefix))
      .map(k=>({key:k,label:k.slice(prefix.length).replace(/^fam:/,'')}));
  };

  /* ── SB3: keyword select/deselect (Tab 1) + database selection (Tab 3) ───── */
  const effectiveDbs=useMemo(()=>selectedDbs.length?selectedDbs:defaultSelectedDatabases(),[selectedDbs]);
  // QA L28 — ONE memoized compileAll shared by the terms-phase Database previews
  // and the build-phase strategy workspace. The builder stays mounted (hidden) on
  // every workspace stage, so an unmemoized call re-compiled all concepts × all
  // selected databases on EVERY parent re-render (e.g. per question-editor commit);
  // now it recomputes only when the strategy inputs actually change.
  const compiledAll=useMemo(()=>compileAll({concepts,overrides,filters},effectiveDbs),[concepts,overrides,filters,effectiveDbs]);
  const toggleDb=(id)=>setSelectedDbs(prev=>{
    const base=prev.length?prev:defaultSelectedDatabases();
    return base.includes(id)?base.filter(x=>x!==id):[...base,id];
  });
  // prompt60 — report the live in-memory query up to the Search Wizard so its Run step
  // pre-fills without a reload. Ref-wrapped so a parent passing a fresh callback each
  // render never re-fires the effect. We report the RAW `selectedDbs` (empty = the user
  // hasn't explicitly chosen, so the run defaults to all providers for full recall) —
  // NOT the resolved effectiveDbs, which would force the catalogue defaults.
  const liveQueryRef=useRef(onLiveQuery); liveQueryRef.current=onLiveQuery;
  useEffect(()=>{
    if(!loaded||!liveQueryRef.current) return;
    liveQueryRef.current({concepts,filters,overrides,databases:selectedDbs});
  },[loaded,concepts,filters,overrides,selectedDbs]);

  /* ── 85.md A2 — honest per-stage statuses + live-term count, reported upward ──
     The workspace overlays the two keys this layer cannot know (mode chosen,
     ready-for-screening) and feeds its rail + the white side-menu stepper + the
     PubMed pulse's real "add terms" empty branch. Ref-wrapped like the other seams. */
  const liveTermCount=useMemo(()=>concepts.reduce((n,c)=>n+liveTermsOf(c).length,0),[concepts]);
  const stageStatuses=useMemo(()=>computeStageStatuses({
    concepts,question,filters,overrides,databases:selectedDbs,
    rejected:rejectedSuggestions,dismissedWarnings,hitState,
  }),[concepts,question,filters,overrides,selectedDbs,rejectedSuggestions,dismissedWarnings,hitState]);
  const onStatsRef=useRef(onStats); onStatsRef.current=onStats;
  useEffect(()=>{
    if(!loaded||typeof onStatsRef.current!=="function") return;
    onStatsRef.current({liveTermCount,stageStatuses});
  },[loaded,liveTermCount,stageStatuses]);

  /* ── 85.md A2 — master-detail active concept (Terms & Vocabulary) ─────────── */
  const conceptIndexById=useMemo(()=>{const m={};concepts.forEach((c,i)=>{m[c.id]=i;});return m;},[concepts]);
  const activeConcept=useMemo(()=>{
    if(!concepts.length) return null;
    return concepts.find(c=>c.id===activeConceptId)||concepts[0];
  },[concepts,activeConceptId]);
  /* (96.md — the Concepts-stage "Edit terms →" card action is gone with the stage;
     the ConceptNavigator + question-card clicks own concept activation now.) */
  /* Duplicate info for one term chip: the OTHER concept's name + resolution ids. */
  const dupInfoForTerm=(cid,t)=>{
    const key=termEquivalenceKey(t.text);
    const d=duplicates.find(x=>x.equivKey===key);
    if(!d) return null;
    const other=(d.occurrences||[]).find(o=>o.conceptId!==cid);
    if(!other) return null;
    return {otherLabel:other.conceptLabel||'another concept',otherConceptId:other.conceptId};
  };
  /* ── 96.md D13.2 — phrase selection on the RESEARCH QUESTION creates groups ──
     Clicking a token/phrase CREATES a concept group (label = phrase, sourcePhrase
     recorded, first term = the phrase as tiab freetext). Duplicate-phrase clicks
     never create a second group: an existing group is FOCUSED instead — unless it
     still holds nothing beyond its origin term, in which case the click de-selects
     (removes the group, undoably via removeConcept's recorded inverse). */
  const stampSnapshotIfEmpty=()=>{
    if(!(questionSnapshotRef.current||"").trim()&&String(question||"").trim()){
      setQuestionSnapshot(String(question).slice(0,2000).trim());
    }
  };
  const addPhraseConcept=(text)=>{
    const fresh=createConceptFromPhrase(text);
    if(!fresh) return null;
    const cid=uid();
    const withIds={...fresh,id:cid,terms:fresh.terms.map(t=>({...t,id:uid()}))};
    setConcepts(cs=>[...cs,withIds]);
    stampSnapshotIfEmpty();
    setActiveConceptId(cid);
    tryLookup(cid,withIds.terms[0].id,withIds.terms[0].text);
    return withIds;
  };
  const togglePhrase=(text)=>{
    const clean=String(text||"").trim(); if(!clean) return;
    const existing=findConceptForPhrase(conceptsRef.current,clean);
    if(existing){
      if(conceptOnlyHoldsOriginTerm(existing)){
        removeConcept(existing.id); // records the undo inverse + snackbar
        announce(`Removed concept "${existing.label||clean}"`);
      } else {
        setActiveConceptId(existing.id);
        announce(`"${existing.label||clean}" already has terms — opened it instead`);
      }
      return;
    }
    if(addPhraseConcept(clean)) announce(`Created concept "${clean}"`);
  };
  const isPhraseSelected=(text)=>!!findConceptForPhrase(concepts,text);
  const addManualConcept=(text)=>{
    const clean=String(text||"").trim(); if(!clean) return;
    const existing=findConceptForPhrase(conceptsRef.current,clean);
    if(existing){ setActiveConceptId(existing.id); announce(`"${existing.label||clean}" already exists — opened it`); return; }
    if(addPhraseConcept(clean)) announce(`Created concept "${clean}"`);
  };

  /* ── 96.md D2 — concept drift vs the persisted question snapshot ──────────── */
  const drifted=useMemo(()=>conceptDrift(question,concepts),[question,concepts]);
  const questionChanged=loaded
    &&!!(questionSnapshot||"").trim()
    &&String(question||"").trim()!==String(questionSnapshot||"").trim();
  // A changed question with NOTHING drifted needs no ceremony: silently refresh the
  // snapshot so the banner can never appear later for a long-resolved edit.
  // QA L28 — gated on `visible`: the builder stays MOUNTED (display:none) on every
  // workspace stage, so without the gate each question-editor commit rewrote the
  // snapshot → dirtied the autosave signature → fired a search-state PUT + a
  // collaborator poke per typing pause. Hidden builder = no snapshot churn; the
  // refresh happens once, when the user actually opens a builder stage.
  useEffect(()=>{
    if(visible&&questionChanged&&drifted.length===0){
      setQuestionSnapshot(String(question||"").slice(0,2000).trim());
    }
  },[visible,questionChanged,drifted.length,question]); // eslint-disable-line
  const keepDriftedConcepts=()=>{
    setQuestionSnapshot(String(question||"").slice(0,2000).trim());
    announce("Concepts kept — question snapshot updated");
  };

  /* ── 96.md D13.3 — group management: reorder / merge / split (all undoable) ── */
  const moveConceptBy=(cid,delta)=>{
    const list=conceptsRef.current;
    const from=list.findIndex(c=>c&&c.id===cid);
    const next=reorderConceptState(list,cid,delta);
    if(next===list) return; // no-op (edge or unknown id)
    const label=(list[from]&&list[from].label)||"Concept";
    setConcepts(next);
    setUndoStack(st=>recordReorderConcept(st,{conceptId:cid,fromIndex:from,toIndex:from+(delta<0?-1:1),label}));
    setUndoMsg(`Moved "${label}" ${delta<0?"up":"down"}`);
    announce(`Moved "${label}" ${delta<0?"up":"down"}`);
  };
  const mergeConceptInto=(fromId,intoId)=>{
    const res=mergeConceptsState(conceptsRef.current,fromId,intoId);
    if(!res) return;
    const target=conceptsRef.current.find(c=>c&&c.id===intoId);
    setConcepts(res.concepts);
    setUndoStack(st=>recordMergeConcepts(st,res.undo));
    setUndoMsg(`Merged "${res.undo.fromConcept.label||"concept"}" into "${(target&&target.label)||"group"}"`);
    setActiveConceptId(intoId);
    announce(`Merged "${res.undo.fromConcept.label||"concept"}" into "${(target&&target.label)||"group"}"`);
  };
  const splitConceptTerms=(cid,termIds,newLabel)=>{
    const res=splitConceptState(conceptsRef.current,cid,termIds,newLabel);
    if(!res) return;
    const nid=uid();
    const withId=res.concepts.map((c,i)=>i===res.newIndex?{...c,id:nid}:c);
    const label=withId[res.newIndex].label;
    setConcepts(withId);
    setUndoStack(st=>recordSplitConcept(st,{fromConceptId:cid,newConceptId:nid,termIds,label}));
    setUndoMsg(`Split ${termIds.length} term${termIds.length===1?"":"s"} into "${label}"`);
    setActiveConceptId(nid);
    announce(`Split ${termIds.length} term${termIds.length===1?"":"s"} into "${label}"`);
  };
  /* 96.md §3B (QA M3) — reorder a TERM within its group (the rendered OR chain).
     Same undo contract as the group move: exact inverse via recordReorderTerm. */
  const moveTermBy=(cid,tid,delta)=>{
    const list=conceptsRef.current;
    const c=list.find(x=>x&&x.id===cid);
    const from=c?(c.terms||[]).findIndex(t=>t&&t.id===tid):-1;
    const next=reorderTermState(list,cid,tid,delta);
    if(next===list) return; // no-op (edge or unknown id)
    const text=(c.terms[from]&&c.terms[from].text)||"term";
    setConcepts(next);
    setUndoStack(st=>recordReorderTerm(st,{conceptId:cid,termId:tid,fromIndex:from,toIndex:from+(delta<0?-1:1),text}));
    setUndoMsg(`Moved "${text}" ${delta<0?"earlier":"later"}`);
    announce(`Moved "${text}" ${delta<0?"earlier":"later"} in ${c.label||"the group"}`);
  };
  /* 96.md §3A/§3B (QA M4) — rewrite a group's originating phrase (sourcePhrase).
     Once the new phrase occurs in the question, conceptDrift stops flagging the
     group; when every drifted group resolves, the silent snapshot refresh above
     clears the banner for good. Persisted inside the concept object (no new key). */
  const updateSourcePhrase=(cid,phrase)=>{
    const list=conceptsRef.current;
    const next=setConceptSourcePhrase(list,cid,phrase);
    if(next===list) return; // no-op — nothing changed
    const c=list.find(x=>x&&x.id===cid);
    setConcepts(next);
    announce(`Updated the phrase for "${(c&&c.label)||"the group"}"`);
  };

  /* ── SB4: Organize Concepts hygiene (move term between concepts; dismiss a
     warning) + derived duplicate/quality/sensitivity signals. Moving marks the term
     user-controlled so a PICO re-sync respects it; user terms are never auto-removed. */
  const moveTerm=(fromCid,tid,toCid)=>{
    if(fromCid===toCid) return;
    setConcepts(cs=>{
      const from=cs.find(c=>c.id===fromCid); const t=from?.terms.find(x=>x.id===tid);
      const to=cs.find(c=>c.id===toCid); if(!t||!to) return cs;
      const dup=to.terms.some(x=>cnorm(x.text)===cnorm(t.text));
      const moved={...t,source:"user_added"};
      return cs.map(c=>{
        if(c.id===fromCid) return {...c,terms:c.terms.filter(x=>x.id!==tid)};
        if(c.id===toCid&&!dup) return {...c,terms:[...c.terms,moved]};
        return c;
      });
    });
  };
  const dismissWarning=(id)=>setDismissedWarnings(d=>d.includes(id)?d:[...d,id]);
  const restoreWarnings=()=>setDismissedWarnings([]);
  const duplicates=useMemo(()=>detectCrossConceptDuplicates(concepts),[concepts]);
  const dupKeys=useMemo(()=>new Set(duplicates.map(d=>d.equivKey)),[duplicates]);
  const qualityWarnings=useMemo(()=>searchQualityCheck(concepts,{dismissed:dismissedWarnings}),[concepts,dismissedWarnings]);
  const sensitivity=useMemo(()=>(hitState&&hitState.status==="updated")?sensitivitySignal(hitState.hitCount):null,[hitState]);
  const moveTargetsFor=(cid)=>concepts.filter(c=>c.id!==cid&&c.picoField!=="T").map(c=>({id:c.id,label:c.label}));
  const isDupTerm=(t)=>dupKeys.has(termEquivalenceKey(t.text));

  // prompt60 + 73.md P4 (96.md QA L2) — which internal step panels render, purely
  // from the embedded phase: 'terms' → 2 (the central Terms & Vocabulary
  // workspace), 'build' → 3+4 (databases + strategy workspace). The retired
  // STANDALONE 5-step stepper (StepNav, phrase step 1, the legacy concept-card
  // grid, Check & Export step 5) is DELETED: the only production mounts are the
  // staged SearchWorkspace's 'terms'/'build' phases (verified — Workspace.jsx and
  // StitchProjectWorkspace both render SearchWizardDispatcher → SearchWorkspace),
  // so a phase-less mount now intentionally renders no step surface.
  const show = (n) => !!embeddedShowsStep(phase, n);

  if(!loaded) return <div style={{padding:40,color:C.muted,fontFamily:SANS,background:C.bg,minHeight:"100%"}}>Loading search…</div>;

  return(
    <div style={{background:C.bg,color:C.txt,fontFamily:SANS,padding:"4px 2px"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;700&display=swap');
.sbkw-token:focus-visible{outline:2px solid ${C.acc};outline-offset:2px;}`}</style>

      {/* 85.md A2 — ONE polite announcer for structural changes the eye may miss
          (keyword routing, add outcomes, bulk accepts, undo) — the workspace
          mode-change announcer pattern. */}
      <span role="status" aria-live="polite" data-testid="sb-announcer"
        style={{position:"absolute",width:1,height:1,padding:0,margin:-1,overflow:"hidden",clip:"rect(0 0 0 0)",whiteSpace:"nowrap",border:0}}>
        {announceMsg}
      </span>

      {/* 85.md A2 — feature-local undo snackbar for destructive actions. */}
      <UndoSnackbar message={undoMsg} onUndo={undoLastAction} onDismiss={()=>setUndoMsg(null)}/>

      {limitedMode&&(
        <div style={{background:`${alpha(C.yel,"10")}`,border:`1px solid ${alpha(C.yel,"44")}`,borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:C.txt2}}>
          <strong style={{color:C.yel}}>Limited mode.</strong> Live subject-term lookup and PubMed counts are temporarily unavailable, so the builder is using a small offline vocabulary and hit counts are hidden. Your query syntax is still correct and fully usable.
        </div>
      )}

      {/* SE1 Task 5 — a collaborator's update arrived while this user was mid-edit. */}
      {remotePending&&(
        <div style={{background:`${alpha(C.acc,"10")}`,border:`1px solid ${alpha(C.acc,"44")}`,borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:C.txt2,display:"flex",alignItems:"center",gap:10}}>
          <span style={{flex:1}}><strong style={{color:C.acc}}>A collaborator updated this search.</strong> Your view will refresh automatically when you finish your current edit.</span>
          <button onClick={()=>{setEditing(null);setDrafts({});setPendingSplit(null);if(pendingRemoteRef.current)applyRemote(pendingRemoteRef.current);}} style={{...btn("solid"),fontSize:10}}>Apply now</button>
        </div>
      )}

      {/* 85.md A2 — embedded stage toolbar: honest save state (audit C2) + the
          beginner/expert toggle, previously unreachable in the workspace (M9). */}
      {embedded&&(
        <div data-testid="sb-stage-toolbar" style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:12}}>
          <SaveStatusIndicator state={saveState} onRetry={saveNow}/>
          <span style={{marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:10}}>
            {remoteUpdatedBy&&(
              <span title={`This search was just updated by ${remoteUpdatedBy}`} style={{display:"inline-flex",alignItems:"center",gap:4,color:C.acc,fontSize:11,fontFamily:MONO}}>↻ {remoteUpdatedBy}</span>
            )}
            <button onClick={toggleBeginner} role="switch" aria-checked={beginner} aria-label="Beginner mode"
              style={{display:"flex",alignItems:"center",gap:8,padding:"4px 10px",borderRadius:20,cursor:"pointer",border:`1px solid ${beginner?C.grn:C.brd2}`,background:beginner?`${alpha(C.grn,"14")}`:"transparent",fontFamily:SANS}}>
              <span aria-hidden="true" style={{width:26,height:14,borderRadius:9,background:beginner?C.grn:C.brd2,position:"relative",flexShrink:0}}>
                <span style={{position:"absolute",top:2,left:beginner?14:2,width:10,height:10,borderRadius:"50%",background:"#fff",transition:"all .15s"}}/>
              </span>
              <span style={{fontSize:10.5,fontWeight:600,color:beginner?C.grn:C.muted}}>Beginner mode</span>
            </button>
          </span>
        </div>
      )}

      {/* 85.md A2 — dismissible mental-model intro, now atop Terms & Vocabulary
          (the retired Concepts stage's framing rides with the merged workspace). */}
      {phase==="terms"&&<ConceptsIntroStrip/>}

      {/* ─────────── 85.md A2 — phase 'terms': MASTER-DETAIL (navigator → active
          concept panel → strategy preview). 96.md QA L2 — the legacy standalone
          concept-card grid that used to follow is DELETED (unreachable). */}
      {show(2)&&(()=>{
        const c=activeConcept;
        const cIdx=c?(conceptIndexById[c.id]||0):0;
        const rejectedSet=rejectedSuggestions;
        const cStatus=c?conceptStatus(c,{rejected:rejectedSet}):"empty";
        const pending=c?pendingSuggestions(c,rejectedSet):[];
        const hasAnyText=c?(c.terms||[]).some(t=>(t.text||"").trim()):false;
        const isTimeFrame=c&&c.picoField==="T";
        const warningsOnly=qualityWarnings;
        return(
          <div data-testid="sb-step-organize-concepts">
            {/* 96.md D13.1 — the research question leads the workspace: prominent
                text with click-to-select phrase tokens (each click creates a concept
                group below) + an Edit link back to the Research Question stage. */}
            <QuestionPhraseCard question={question} accent={C.acc}
              isSelected={isPhraseSelected} onTogglePhrase={togglePhrase} onAddManual={addManualConcept}
              onEditQuestion={typeof onGoToStage==='function'?()=>onGoToStage('question'):null} readOnly={readOnly}/>

            {/* 96.md D2 — "question changed" drift banner (never auto-deletes).
                QA M4 — rows also offer an inline "Update phrase" editor. */}
            {questionChanged&&(
              <QuestionDriftBanner drifted={drifted} readOnly={readOnly}
                onKeepAll={keepDriftedConcepts}
                onEditConcept={(id)=>setActiveConceptId(id)}
                onUpdatePhrase={(id,phrase)=>updateSourcePhrase(id,phrase)}
                onRemoveConcept={(id)=>removeConcept(id)}/>
            )}

            {/* Search Quality Check — stage-level; a one-line summary chip when clean. */}
            <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:10,padding:warningsOnly.length?12:"8px 12px",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:warningsOnly.length?8:0}}>
                {warningsOnly.length===0
                  ? <span style={{fontSize:11,color:C.grn,fontWeight:600}}>✓ Search quality check — no issues</span>
                  : <>
                      <span style={{fontSize:10.5,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase"}}>Search Quality Check</span>
                      <Help text="Quick, non-blocking checks: duplicates across AND-ed concepts, empty concepts, missing controlled vocabulary, and terms that may make the search too narrow. Guidance only — you stay in control."/>
                    </>}
                {hitState&&hitState.status==="updated"&&hitState.hitCount!=null&&(
                  <span style={{marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:8,fontSize:11,fontFamily:MONO}}>
                    <span style={{color:C.acc,fontWeight:700}}>{fmtCount(hitState.hitCount)} PubMed hits</span>
                    {sensitivity&&<span title="Rough breadth of the current strategy" style={{fontSize:9,fontWeight:700,letterSpacing:.4,textTransform:"uppercase",color:SENS_COLOR[sensitivity.key]||C.muted,border:`1px solid ${alpha(SENS_COLOR[sensitivity.key]||C.muted,"66")}`,borderRadius:4,padding:"0 5px"}}>{sensitivity.label}</span>}
                  </span>
                )}
                {/* QA M8 — dismissals persist; read-only viewers get no mutating control. */}
                {!readOnly&&dismissedWarnings.length>0&&<button onClick={restoreWarnings} title="Show dismissed checks again" style={{...btn("ghost"),fontSize:9.5,padding:"2px 8px",marginLeft:warningsOnly.length===0?"auto":0}}>restore dismissed ({dismissedWarnings.length})</button>}
              </div>
              {warningsOnly.map(w=>(
                <div key={w.id} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"6px 0",borderTop:`1px solid ${C.brd}`}}>
                  <span style={{color:QC_COLOR[w.severity]||C.muted,fontWeight:700,fontSize:12}}>{w.severity==="critical"?"✕":w.severity==="warning"?"⚠":"ℹ"}</span>
                  <span style={{flex:1,fontSize:11.5,color:C.txt2,lineHeight:1.5}}>
                    <span>{w.message}</span>
                    {w.action&&<span style={{display:"block",color:C.muted,fontSize:10.5,marginTop:2}}>→ {w.action}</span>}
                  </span>
                  {!readOnly&&<button onClick={()=>dismissWarning(w.id)} title="Keep anyway / dismiss this check" style={{...btn("ghost"),fontSize:9.5,padding:"2px 8px"}}>Dismiss</button>}
                </div>
              ))}
            </div>

            {/* Concept navigator — one tab stop, arrow keys, fixed-height row. */}
            <ConceptNavigator
              concepts={concepts}
              activeId={c?c.id:null}
              onSelect={(id)=>setActiveConceptId(id)}
              statusFor={(x)=>conceptStatus(x,{rejected:rejectedSet})}
              suggestionCounts={suggCounts.perConcept}
            />

            {c&&(
              <ActiveConceptPanel concept={c} conceptIndex={cIdx} status={cStatus}
                readOnly={readOnly}
                onRename={readOnly?null:(label)=>updateConcept(c.id,{label})}
                onUpdateSourcePhrase={readOnly?null:(phrase)=>updateSourcePhrase(c.id,phrase)}
                onRequestSplit={readOnly||((c.terms||[]).filter(t=>(t.text||"").trim()).length<2)?null
                  :()=>{setSplitDraft({cid:c.id,selected:{},label:""});setMergeOpen(false);setConfirmDeleteId(null);}}>
                {/* 96.md D13.3 — group management for ANY group (legacy PICO groups
                    included — the picoField delete-guard is retired): reorder up/down,
                    merge into another group, split terms out, delete with an inline
                    confirm. Every operation is undoable via the snackbar. */}
                {!readOnly&&(
                  <div data-testid="sb-group-actions" style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:10}}>
                    <span style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginRight:2}}>Group</span>
                    <button type="button" onClick={()=>moveConceptBy(c.id,-1)} disabled={cIdx===0} aria-label={`Move ${c.label} up`} title="Move this group earlier in the search" style={{...btn("ghost"),fontSize:10,padding:"3px 9px",opacity:cIdx===0?0.45:1}}>↑ Move up</button>
                    <button type="button" onClick={()=>moveConceptBy(c.id,1)} disabled={cIdx>=concepts.length-1} aria-label={`Move ${c.label} down`} title="Move this group later in the search" style={{...btn("ghost"),fontSize:10,padding:"3px 9px",opacity:cIdx>=concepts.length-1?0.45:1}}>↓ Move down</button>
                    <span style={{position:"relative",display:"inline-block"}}>
                      <button type="button" onClick={()=>{setMergeOpen(o=>!o);setSplitDraft(null);setConfirmDeleteId(null);}} aria-expanded={mergeOpen} aria-label={`Merge ${c.label} into another group`} disabled={concepts.length<2} style={{...btn("ghost"),fontSize:10,padding:"3px 9px",opacity:concepts.length<2?0.45:1}}>⇄ Merge into…</button>
                      {mergeOpen&&(
                        <span style={{position:"absolute",zIndex:75,top:"100%",left:0,marginTop:4,background:C.card,border:`1px solid ${C.brd2}`,borderRadius:8,boxShadow:"0 14px 40px var(--t-shadow)",overflow:"hidden",minWidth:200}}>
                          <span style={{display:"block",fontSize:9,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",padding:"6px 10px 2px"}}>Merge “{c.label}” into</span>
                          {concepts.filter(x=>x.id!==c.id).map(x=>(
                            <button key={x.id} type="button" onClick={()=>{setMergeOpen(false);mergeConceptInto(c.id,x.id);}}
                              style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",color:C.txt2,cursor:"pointer",fontSize:11.5,padding:"6px 10px",fontFamily:SANS}}>{x.label}</button>
                          ))}
                        </span>
                      )}
                    </span>
                    <button type="button" onClick={()=>{setSplitDraft(s=>s&&s.cid===c.id?null:{cid:c.id,selected:{},label:""});setMergeOpen(false);setConfirmDeleteId(null);}}
                      aria-expanded={!!(splitDraft&&splitDraft.cid===c.id)} aria-label={`Split terms out of ${c.label}`}
                      disabled={(c.terms||[]).filter(t=>(t.text||"").trim()).length<2}
                      style={{...btn("ghost"),fontSize:10,padding:"3px 9px",opacity:(c.terms||[]).filter(t=>(t.text||"").trim()).length<2?0.45:1}}>✂ Split…</button>
                    {confirmDeleteId===c.id?(
                      <span style={{display:"inline-flex",alignItems:"center",gap:6,marginLeft:"auto"}}>
                        <span style={{fontSize:10.5,color:C.yel}}>
                          Delete “{c.label}”{(()=>{const n=(c.terms||[]).filter(t=>(t.text||"").trim()).length;return n?` and its ${n} term${n===1?"":"s"}`:"";})()}?
                        </span>
                        <button type="button" onClick={()=>{setConfirmDeleteId(null);removeConcept(c.id);}} aria-label={`Confirm delete ${c.label}`} style={{...btn("danger"),fontSize:10,padding:"3px 9px"}}>Delete</button>
                        <button type="button" onClick={()=>setConfirmDeleteId(null)} style={{...btn("ghost"),fontSize:10,padding:"3px 9px"}}>Cancel</button>
                      </span>
                    ):(
                      <button type="button" onClick={()=>{setConfirmDeleteId(c.id);setMergeOpen(false);setSplitDraft(null);}} aria-label={`Delete group ${c.label}`} title="Delete this group (undoable)" style={{...btn("danger"),fontSize:10,padding:"3px 9px",marginLeft:"auto"}}>× Delete group</button>
                    )}
                  </div>
                )}
                {splitDraft&&splitDraft.cid===c.id&&(
                  <div data-testid="sb-split-panel" style={{background:C.surf,border:`1px solid ${C.brd2}`,borderRadius:8,padding:"9px 11px",marginBottom:10}}>
                    <div style={{fontSize:10.5,fontWeight:700,color:C.muted,letterSpacing:.4,textTransform:"uppercase",marginBottom:6}}>Move selected terms to a new group</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                      {(c.terms||[]).filter(t=>(t.text||"").trim()).map(t=>{
                        const on=!!splitDraft.selected[t.id];
                        return(
                          <label key={t.id} style={{display:"inline-flex",alignItems:"center",gap:5,background:on?alpha(C.acc,"14"):C.card,border:`1px solid ${on?alpha(C.acc,"66"):C.brd2}`,borderRadius:6,padding:"3px 8px",fontSize:11,color:C.txt2,cursor:"pointer"}}>
                            <input type="checkbox" checked={on} onChange={()=>setSplitDraft(s=>({...s,selected:{...s.selected,[t.id]:!s.selected[t.id]}}))} aria-label={`Select ${t.text} for the new group`}/>
                            {t.text}
                          </label>
                        );
                      })}
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                      <input value={splitDraft.label} onChange={e=>setSplitDraft(s=>({...s,label:e.target.value}))} placeholder="New group name…" aria-label="New group name" style={{...inputStyle,flex:1,minWidth:160,fontSize:11.5}}/>
                      {(()=>{ const ids=Object.keys(splitDraft.selected).filter(k=>splitDraft.selected[k]); return (
                        <button type="button" disabled={!ids.length} onClick={()=>{setSplitDraft(null);splitConceptTerms(c.id,ids,splitDraft.label);}} style={{...btn("primary"),fontSize:10.5,opacity:ids.length?1:0.5}}>Split {ids.length||""} term{ids.length===1?"":"s"}</button>
                      );})()}
                      <button type="button" onClick={()=>setSplitDraft(null)} style={{...btn("ghost"),fontSize:10.5}}>Cancel</button>
                    </div>
                  </div>
                )}
                {isTimeFrame?(
                  <div style={{fontSize:11.5,color:c.note?C.txt2:C.muted}}>
                    {c.note
                      ?<span><span style={{color:C.muted}}>⏱ Time restriction: </span><span style={{fontWeight:600}}>{c.note}</span></span>
                      :<span style={{fontStyle:"italic"}}>No time restriction set — use the Limits panel (publication years) instead; this legacy group can be deleted.</span>}
                  </div>
                ):(
                  <>
                    {limitedMode&&(
                      <div style={{background:`${alpha(C.yel,"10")}`,border:`1px solid ${alpha(C.yel,"44")}`,borderRadius:8,padding:"7px 10px",marginBottom:8,fontSize:11,color:C.txt2}}>
                        <strong style={{color:C.yel}}>Limited mode.</strong> Live subject-heading lookup is temporarily unavailable — terms still work; headings attach when the service returns.
                      </div>
                    )}
                    {/* QA M8 — the add box is a mutating surface: hidden for
                        read-only viewers (the same pattern that hides the manual
                        add-concept box and the group actions). */}
                    {!readOnly&&<AddTermBox
                      api={A}
                      conceptLabel={c.label}
                      value={drafts[c.id]||""}
                      onChange={(v)=>setDrafts(d=>({...d,[c.id]:v}))}
                      onCommitTyped={()=>commitTypedDraft(c.id)}
                      onPickSuggestion={(s)=>{ addSuggestion(c.id,s); setDrafts(d=>({...d,[c.id]:""})); announce(`Added "${s.label}" to ${c.label}`); }}
                      onClear={()=>setDrafts(d=>({...d,[c.id]:""}))}
                      statusText={addStatus[c.id]||""}
                      pendingSplit={pendingSplit&&pendingSplit.cid===c.id?pendingSplit:null}
                      onConfirmSplit={()=>pendingSplit&&applyTypedAdd(pendingSplit.cid,pendingSplit.raw)}
                      onCancelSplit={()=>setPendingSplit(null)}
                      onMultiPaste={(raw)=>handleMultiPaste(c.id,raw)}
                    />}
                    {!hasAnyText?(
                      <div data-testid="sb-empty-concept" style={{background:C.surf,border:`1px dashed ${C.brd2}`,borderRadius:8,padding:"14px 16px",marginTop:10,fontSize:12,color:C.muted,lineHeight:1.6}}>
                        {readOnly?"No terms yet.":"No terms yet — type a word above, or click a phrase in your research question at the top."}
                      </div>
                    ):(
                      <div style={{marginTop:10}}>
                        <TermChipRow
                          concept={c}
                          beginner={beginner}
                          readOnly={readOnly}
                          dupInfoFor={(t)=>dupInfoForTerm(c.id,t)}
                          editingTermId={editing&&editing.conceptId===c.id?editing.termId:null}
                          onOpenEditor={(tid)=>setEditing(editing&&editing.termId===tid?null:{conceptId:c.id,termId:tid})}
                          onRemove={(tid)=>removeTerm(c.id,tid)}
                          renderEditor={(t)=>{
                            const dup=dupInfoForTerm(c.id,t);
                            const tIdx=(c.terms||[]).findIndex(x=>x&&x.id===t.id);
                            return(
                              <TermEditorPopover
                                term={t}
                                beginner={beginner}
                                moveTargets={moveTargetsFor(c.id)}
                                onReorder={(delta)=>moveTermBy(c.id,t.id,delta)}
                                canMoveEarlier={tIdx>0}
                                canMoveLater={tIdx>=0&&tIdx<(c.terms||[]).length-1}
                                dupInfo={dup?{
                                  otherLabel:dup.otherLabel,
                                  onKeepHere:()=>{
                                    const other=conceptsRef.current.find(x=>x.id===dup.otherConceptId);
                                    const ot=other&&(other.terms||[]).find(x=>termEquivalenceKey(x.text)===termEquivalenceKey(t.text));
                                    if(other&&ot) removeTerm(other.id,ot.id);
                                    setEditing(null);
                                  },
                                  onMoveThere:()=>{ removeTerm(c.id,t.id); setEditing(null); },
                                }:null}
                                preview={renderTerm(t,activeDB)}
                                onChange={(patch)=>updateTerm(c.id,t.id,patch)}
                                onClose={()=>setEditing(null)}
                                onLookup={(text,force)=>tryLookup(c.id,t.id,text,force)}
                                onConvertSynonyms={()=>{ addSynonyms(c.id,t.id); setEditing(null); }}
                                onToggleDisabled={()=>toggleTermDisabled(c.id,t.id)}
                                onMove={(toCid)=>{ moveTerm(c.id,t.id,toCid); setEditing(null); announce(`Moved "${t.text}"`); }}
                                onRemove={()=>removeTerm(c.id,t.id)}
                              />
                            );
                          }}
                        />
                      </div>
                    )}
                    <div style={{marginTop:10}}>
                      <SuggestionsDisclosure
                        suggestions={pending}
                        readOnly={readOnly}
                        onAccept={(s)=>acceptSuggestion(c.id,s)}
                        onDismiss={dismissSuggestion}
                        onAcceptAllHeadings={()=>acceptAllHeadings(c.id)}
                        rejectedEntries={rejectedEntriesFor(c)}
                        showDismissed={showDismissedSuggs}
                        onToggleShowDismissed={()=>setShowDismissedSuggs(v=>!v)}
                        onUnreject={unrejectSuggestion}
                        ignoredGroups={ignoredByField}
                        onRestoreTerm={restoreTerm}
                        onRestoreField={restoreField}
                        onRestoreAll={resetSuggestions}
                      />
                      <Disclosure summary="Advanced">
                        <div style={{fontSize:11.5,color:C.txt2,lineHeight:1.6,marginBottom:6}}>
                          {(()=>{
                            const idx=conceptIndexById[c.id];
                            const next=concepts[idx+1];
                            if(!next) return <span>This is the last concept — nothing is combined after it.</span>;
                            return <span>Combined with <strong>{next.label}</strong> using <strong style={{color:(c.op||"AND")==="OR"?C.yel:C.acc}}>{c.op||"AND"}</strong> — toggle it in the strategy preview below, where both concepts are visible.</span>;
                          })()}
                        </div>
                        <div style={{fontSize:10.5,color:C.muted,fontFamily:MONO,wordBreak:"break-word"}}>
                          This concept compiles to: {renderConcept(c,activeDB)||"(nothing yet)"}
                        </div>
                      </Disclosure>
                    </div>
                  </>
                )}
              </ActiveConceptPanel>
            )}

            {/* QA M8 — '+ Add concept' is a mutating control: hidden for viewers. */}
            {!readOnly&&<button onClick={addConcept} style={{...btn("ghost"),width:"100%",justifyContent:"center",borderStyle:"dashed",marginTop:12}}>+ Add concept</button>}

            <div style={{marginTop:12}}>
              <StrategyPreviewPanel
                concepts={concepts}
                activeId={c?c.id:null}
                beginner={beginner}
                readOnly={readOnly}
                hitState={hitState}
                onRetryHits={refreshHitsNow}
                onToggleOp={(cid)=>updateConcept(cid,{op:(concepts.find(x=>x.id===cid)?.op)==="OR"?"AND":"OR"})}
                pubmedQuery={pubmedQuery}
                onSelectConcept={(id)=>setActiveConceptId(id)}
              />
            </div>

            {/* 96.md D13.6 — per-database previews live IN the central workspace:
                the same compiled DbStrategyPanel cards the Database Strategies stage
                uses (syntax level, vocab mapped/unmapped, EDITED override badge with
                edit/revert), always current via the memoized compileAll (QA L28). */}
            {liveTermCount>0&&(()=>{
              const compiled=compiledAll;
              return(
                <div data-testid="sb-db-previews" style={{marginTop:12}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                    <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:.6,textTransform:"uppercase"}}>Database previews</span>
                    <span style={{fontSize:10.5,color:C.dim,fontFamily:MONO}}>{compiled.length} database{compiled.length===1?"":"s"}</span>
                    <Help text="The exact query each database will receive, compiled live from your concept groups. A MeSH term is translated to the database's own controlled vocabulary where one exists, otherwise to free text — the vocabulary line under each preview says which. Edit a query manually when you need to; edited queries stop syncing until you revert."/>
                  </div>
                  {compiled.map(res=>(
                    <DbStrategyPanel key={res.dbId} res={res} cap={capabilitiesFor(res.dbId)}
                      setOverride={readOnly?null:(val=>setOverrides(o=>{const n={...o}; if(val==null) delete n[res.dbId]; else n[res.dbId]=val; return n;}))}
                      hitState={res.dbId==="pubmed"?hitState:null}/>
                  ))}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* prompt60/96.md — Limits ride with the Terms & Vocabulary workspace
          (date/language/pubtype — the shared `filters` block). QA M8 — read-only
          viewers see the limits disabled with an access explanation. */}
      {phase==='terms'&&<LimitsPanel filters={filters} setFilters={setFilters} readOnly={readOnly}/>}

      {/* ─────────── STEP 3 — Choose Databases ─────────── */}
      {show(3)&&(
        <DatabaseCatalogView selected={new Set(effectiveDbs)} onToggle={toggleDb} readOnly={readOnly}/>
      )}

      {/* ─────────── STEP 4 — Database Strategy Workspace (73.md P6) ───────────
          Compiled, paste-ready syntax for EVERY selected catalogue database via the
          strategy compiler — with per-database overrides, warnings, unsupported
          features, vocabulary status, paste/run guidance, and open/export actions.
          compileAll runs on the live in-memory strategy, so panels are always
          current (an override shows "manually edited — not synced"). */}
      {show(4)&&(()=>{
        const compiled=compiledAll; // QA L28 — shared memo (see above)
        const plain=plainSearch(concepts);
        return(
          <div data-testid="sb-strategy-workspace">
            <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:10,padding:14,marginBottom:12}}>
              <div style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>How your search fits together</div>
              <ConceptBlocksBar concepts={concepts}/>
              <div style={{fontSize:11,color:C.muted,marginTop:10,lineHeight:1.55}}>
                Similar terms inside one concept are joined with <strong style={{color:C.yel}}>OR</strong> (any one counts); different concepts are joined with <strong style={{color:C.acc}}>AND</strong> (all must appear).
              </div>
              {plain&&(
                <div style={{marginTop:8}}>
                  {!beginner&&<button onClick={()=>setShowPlainMirror(s=>!s)} aria-expanded={beginner||showPlainMirror} style={{...btn("ghost"),fontSize:10,padding:"3px 9px"}}>{showPlainMirror?"Hide plain English":"Show in plain English"}</button>}
                  {(beginner||showPlainMirror)&&(
                    <div style={{marginTop:6,background:`${alpha(C.grn,"0c")}`,border:`1px solid ${alpha(C.grn,"33")}`,borderRadius:8,padding:"10px 12px"}}>
                      <div style={{fontSize:9.5,fontWeight:700,color:C.grn,letterSpacing:.5,textTransform:"uppercase",marginBottom:6}}>In plain English, this finds:</div>
                      {plain.split("\n").map((line,i)=><div key={i} style={{fontSize:11.5,color:C.txt2,lineHeight:1.6,padding:"1px 0"}}>{line}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:10}}>
              <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:.6,textTransform:"uppercase"}}>Database strategies</span>
              <span style={{fontSize:10.5,color:C.dim,fontFamily:MONO}}>{compiled.length} database{compiled.length===1?"":"s"}</span>
              <button onClick={()=>{downloadText("search-strategies.txt",allStrategiesExportText(compiled));setExportMsg("Exported all strategies");setTimeout(()=>setExportMsg(""),1800);}}
                style={{...btn("solid"),fontSize:10.5,marginLeft:"auto"}}>⤓ Export all strategies (.txt)</button>
              {exportMsg&&<span role="status" style={{fontSize:11,color:C.grn,fontWeight:600}}>{exportMsg}</span>}
            </div>
            {compiled.map(res=>(
              <DbStrategyPanel key={res.dbId} res={res} cap={capabilitiesFor(res.dbId)}
                setOverride={readOnly?null:(val=>setOverrides(o=>{const n={...o}; if(val==null) delete n[res.dbId]; else n[res.dbId]=val; return n;}))}
                hitState={res.dbId==="pubmed"?hitState:null}/>
            ))}
          </div>
        );
      })()}

    </div>
  );
}
