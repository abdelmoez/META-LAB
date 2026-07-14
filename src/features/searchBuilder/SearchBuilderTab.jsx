import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { C, FONT, MONO, alpha, CB_SERIES } from "../../frontend/theme/tokens.js";  // SearchEngine: adapt to app theme (day/night + brand)
import { localMeshSuggestions, meshConfidence } from "../../research-engine/searchBuilder/meshSuggest.js"; // prompt42 Task 3 + SB5 vocab safety
import { serializeSearchState, pickPersisted, remoteAdoptDecision, syncSearchBuilderFromPico,
  findFieldConcept, fieldHasTerm, conceptStatus, CONCEPT_STATUS_LABELS, PICO_FIELD_DEFS } from "../../research-engine/searchBuilder/searchState.js"; // SE1 + SE2 + SB3
import { tokenizeForSelection } from "../../research-engine/searchBuilder/keywordSelection.js"; // SB3 Tab 1
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
  recordRemoveTerm, recordRemoveConcept, recordDisable, recordBulkAccept, undoLast, clear as clearUndo,
} from "../../research-engine/searchBuilder/undoStack.js";
// 85.md A2 — extracted presentational leaves (SSR-contract-tested in searchBuilderUi.test.jsx).
import ConceptCards from "./components/ConceptCards.jsx";
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
   │ 1. PICO source      — props.pico  (read the app's existing PICO)          │
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

/* 73.md P4 — which internal step panels an EMBEDDED phase shows. Three-way split:
   'concepts' (step 1 + compact concept summary), 'terms' (step 2 full detail + limits),
   'build' (steps 3+4). The legacy value 'define' stays a byte-identical alias for the
   old combined concepts+terms view so the original SearchWizard is unchanged.
   Returns null for a non-embedded phase value. Pure + exported for tests. */
export function embeddedShowsStep(phase,n){
  if(phase==="define") return n===1||n===2;   // legacy wizard alias — UNCHANGED
  if(phase==="concepts") return n===1;
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

const DBS=[
  {id:"pubmed",label:"PubMed",color:"#3b82f6",live:true},
  {id:"embase",label:"Embase",color:"#8b5cf6",live:false},
  {id:"cochrane",label:"Cochrane CENTRAL",color:"#ec4899",live:false},
];

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
  const live=concept.terms.filter(t=>(t.text||"").trim());
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
  const parts=concept.terms.filter(t=>t.text.trim()).map(plainTerm);
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

/* ---- breadth signal (no fabricated numbers anywhere) ---- */
function termBreadth(term){
  if(term.type==="controlled") return term.noExplode?2:4;
  let b=3;
  if(term.field==="ti") b-=1; if(term.field==="all") b+=1;
  if(term.truncate&&!term.text.includes(" ")) b+=1;
  if((term.text||"").includes(" ")||term.phrase) b-=1;
  return Math.max(1,Math.min(5,b));
}
function searchStats(concepts){
  let controlled=0,free=0;
  concepts.forEach(c=>c.terms.forEach(t=>{ if(t.text.trim()){ t.type==="controlled"?controlled++:free++; }}));
  return {concepts:concepts.filter(c=>c.terms.some(t=>t.text.trim())).length,controlled,free};
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
function Lbl({plain,jargon}){
  return(<span style={{display:"inline-flex",alignItems:"baseline",gap:5}}>
    <span>{plain}</span>{jargon&&<span style={{fontFamily:MONO,fontSize:9,color:C.dim,opacity:.8}}>{jargon}</span>}
  </span>);
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
function BreadthDots({term}){
  const b=termBreadth(term);
  return(<span title={`Relative breadth: ${["narrowest","narrow","medium","broad","broadest"][b-1]}`}
    style={{display:"inline-flex",alignItems:"center",gap:2}}>
    {[1,2,3,4,5].map(i=><span key={i} style={{width:4,height:4,borderRadius:"50%",background:i<=b?C.acc:C.brd2}}/>)}
  </span>);
}

/* MeSH detail panel (entry terms + narrower terms + scope) */
function MeSHDetail({vocab,term,pinned,onClose}){
  if(!vocab) return null;
  return(
    <div style={{background:C.card,border:`1px solid ${alpha(C.acc,"55")}`,borderRadius:10,padding:13,width:320,boxShadow:"0 16px 48px var(--t-shadow)",fontSize:11,lineHeight:1.55}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
        <span style={{fontWeight:700,fontSize:12,color:C.acc,fontFamily:MONO}}>{vocab.mesh}</span>
        {pinned&&<button onClick={onClose} style={{marginLeft:"auto",background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:14}}>×</button>}
      </div>
      {vocab.scope&&<div style={{color:C.muted,marginBottom:9,fontStyle:"italic"}}>{vocab.scope}</div>}
      <div style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:.6,textTransform:"uppercase",marginBottom:4}}>
        Free-text covered (entry terms){vocab.synonyms?` · ${vocab.synonyms.length}`:""}
      </div>
      <div style={{marginBottom:9}}>
        {(vocab.synonyms||[]).map((s,i)=>(
          <span key={i} style={{display:"inline-block",background:C.surf,border:`1px solid ${C.brd2}`,borderRadius:5,padding:"1px 7px",margin:"0 4px 4px 0",fontFamily:MONO,fontSize:10,color:C.txt2}}>{s}</span>
        ))}
      </div>
      <div style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:.6,textTransform:"uppercase",marginBottom:4}}>
        {term?.noExplode?"Narrower terms (NOT included — explode off)":"Narrower terms added by explode"}
      </div>
      {vocab.children&&vocab.children.length?(
        <div style={{opacity:term?.noExplode?0.45:1}}>
          {vocab.children.map((c,i)=>(
            <div key={i} style={{display:"flex",gap:6,padding:"1px 0",color:C.txt2}}>
              <span style={{color:term?.noExplode?C.dim:C.grn}}>{term?.noExplode?"✕":"└"}</span>
              <span style={{fontFamily:MONO,fontSize:10}}>{c}</span>
            </div>
          ))}
        </div>
      ):<div style={{color:C.dim,fontStyle:"italic"}}>No narrower terms.</div>}
      <div style={{marginTop:9,paddingTop:8,borderTop:`1px solid ${C.brd}`,fontSize:9.5,color:C.dim,display:"flex",justifyContent:"space-between"}}>
        <span>Tree: {vocab.tree||"—"} · UI: {vocab.meshUI||"—"}</span>
        <span style={{color:vocab.source==="live"||vocab.source==="live-nlm"?C.grn:C.yel}}>
          {vocab.source==="live"||vocab.source==="live-nlm"?"● live NLM":"● core (limited)"}
        </span>
      </div>
    </div>
  );
}

/* term chip */
function TermChip({term,dbId,color,onEdit,onRemove,onMove,moveTargets,isDuplicate}){
  const rendered=renderTerm(term,dbId);
  const isControlled=term.type==="controlled";
  const matched=isControlled&&term.vocab;
  const [hover,setHover]=useState(false);
  const [pinned,setPinned]=useState(false);
  const [moveOpen,setMoveOpen]=useState(false);
  const showPanel=(hover||pinned)&&matched;
  const live=DBS.find(d=>d.id===dbId)?.live;
  const canMove=onMove&&Array.isArray(moveTargets)&&moveTargets.length>0;
  const chipStyle=isControlled
    ? {background:matched?`${alpha(color,"1a")}`:`${alpha(C.yel,"14")}`,border:`1px solid ${matched?alpha(color,"88"):alpha(C.yel,"66")}`}
    : {background:"transparent",border:`1px dashed ${C.brd2}`};
  return(
    <span style={{position:"relative",display:"inline-block",marginRight:6,marginBottom:6}}
      onMouseEnter={()=>matched&&setHover(true)} onMouseLeave={()=>setHover(false)}>
      <span style={{display:"inline-flex",alignItems:"center",gap:6,borderRadius:7,padding:"4px 8px",cursor:matched?"pointer":"default",...chipStyle}}
        onClick={()=>matched&&setPinned(p=>!p)}>
        {isControlled
          ? <span style={{width:8,height:8,borderRadius:2,background:matched?color:C.yel,flexShrink:0}}/>
          : <span style={{width:8,height:8,borderRadius:"50%",border:`1.5px solid ${C.muted}`,flexShrink:0}}/>}
        <span style={{fontFamily:MONO,fontSize:11,color:isControlled?C.txt:C.txt2}}>{rendered||term.text}</span>
        {isControlled&&<span style={{fontSize:8,fontWeight:700,letterSpacing:.5,color:matched?color:C.yel,textTransform:"uppercase",opacity:.85}}>{matched?"MeSH":"MeSH?"}</span>}
        {!isControlled&&<span style={{fontSize:8,fontWeight:700,letterSpacing:.5,color:C.muted,textTransform:"uppercase",opacity:.7}}>text</span>}
        {/* prompt40 Task 4 — provenance badge: auto-suggested vs manually added vs synonym. */}
        {term.source&&(()=>{
          const m={pico_auto:["auto",C.muted],user_added:["added",C.grn],synonym:["syn",C.acc2||C.acc]}[term.source];
          return m?<span title={m[0]==="auto"?"Auto-suggested from PICO":m[0]==="added"?"Added by you":"Synonym"} style={{fontSize:8,fontWeight:700,letterSpacing:.4,color:m[1],textTransform:"uppercase",opacity:.85}}>{m[0]}</span>:null;
        })()}
        {/* SB4 — appears in more than one AND-ed concept (over-narrows the search). */}
        {isDuplicate&&<span title="This term appears in more than one concept. Since concepts are joined with AND, repeating it may make the search too narrow — move it to the single best concept." style={{fontSize:8,fontWeight:700,letterSpacing:.4,color:C.yel,textTransform:"uppercase",background:`${alpha(C.yel,"1a")}`,border:`1px solid ${alpha(C.yel,"66")}`,borderRadius:4,padding:"0 4px"}}>dup</span>}
        <BreadthDots term={term}/>
        {canMove&&<button onClick={e=>{e.stopPropagation();setMoveOpen(o=>!o);}} title="Move to another concept" aria-label="Move to another concept" style={{background:"none",border:"none",color:isDuplicate?C.yel:C.muted,cursor:"pointer",fontSize:12,padding:0}}>⇄</button>}
        <button onClick={e=>{e.stopPropagation();onEdit();}} title="Edit term" aria-label="Edit term" style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11,padding:0}}>✎</button>
        <button onClick={e=>{e.stopPropagation();onRemove();}} title="Remove term" aria-label="Remove term" style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:13,padding:0,lineHeight:1}}>×</button>
      </span>
      {canMove&&moveOpen&&(
        <span style={{position:"absolute",zIndex:75,top:"100%",left:0,marginTop:4,background:C.card,border:`1px solid ${C.brd2}`,borderRadius:8,boxShadow:"0 14px 40px var(--t-shadow)",overflow:"hidden",minWidth:180}}>
          <span style={{display:"block",fontSize:9,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",padding:"6px 10px 2px"}}>Move to concept</span>
          {moveTargets.map(t=>(
            <button key={t.id} onClick={e=>{e.stopPropagation();onMove(t.id);setMoveOpen(false);}}
              style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",color:C.txt2,cursor:"pointer",fontSize:11.5,padding:"6px 10px",fontFamily:SANS}}>{t.label}</button>
          ))}
        </span>
      )}
      {showPanel&&(
        <span style={{position:"absolute",zIndex:60,top:"100%",left:0,paddingTop:4}}>
          <MeSHDetail vocab={term.vocab} term={term} pinned={pinned} onClose={()=>{setPinned(false);setHover(false);}}/>
        </span>
      )}
    </span>
  );
}

/* term editor */
function TermEditor({term,onChange,onClose,onConvert,onLookup}){
  const lk=term.vocab;
  const baseBreadth=termBreadth(term);
  const Lever=({label,sub,active,onClick,nextTerm})=>{
    let dir=null;
    if(nextTerm&&!active){
      const nb=termBreadth(nextTerm);
      dir=nb>baseBreadth?"broader":nb<baseBreadth?"narrower":"similar";
    }
    return(
      <button onClick={onClick} style={{...btn(active?"primary":"ghost"),fontSize:10,flex:1,flexDirection:"column",alignItems:"center",gap:1,padding:"6px 4px"}}>
        <span style={{display:"inline-flex",alignItems:"baseline",gap:3}}>{label}{sub&&<span style={{fontFamily:MONO,fontSize:8,opacity:.6}}>{sub}</span>}</span>
        {dir&&<span style={{fontSize:8,opacity:.85,color:dir==="broader"?C.grn:dir==="narrower"?C.yel:C.muted}}>{dir==="broader"?"↑ broader":dir==="narrower"?"↓ narrower":"≈ similar"}</span>}
        {active&&<span style={{fontSize:8,opacity:.6,color:C.acc}}>current</span>}
      </button>
    );
  };
  return(
    <div style={{position:"absolute",zIndex:70,marginTop:6,background:C.card,border:`1px solid ${C.brd2}`,borderRadius:10,padding:14,width:360,boxShadow:"0 16px 48px var(--t-shadow)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase"}}>Edit term</span>
        <BreadthDots term={term}/>
      </div>
      <input autoFocus value={term.text}
        onChange={e=>onChange({...term,text:e.target.value})}
        onBlur={e=>onLookup&&onLookup(e.target.value)}
        style={{...inputStyle,marginBottom:10}} placeholder="term or phrase"/>
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        <button onClick={()=>onChange({...term,type:"freetext"})} style={{...btn(term.type==="freetext"?"primary":"ghost"),fontSize:11,flex:1}}><Lbl plain="Plain words" jargon="free-text"/></button>
        <button onClick={()=>onLookup&&onLookup(term.text,true)} style={{...btn(term.type==="controlled"?"primary":"ghost"),fontSize:11,flex:1}}><Lbl plain="Subject term" jargon="MeSH"/></button>
        <Help text="Two ways to search the same idea. “Subject term” (MeSH) finds articles a librarian tagged with this topic — precise, but misses very recent papers. “Plain words” finds your exact wording — catches new papers and author phrasing. Good searches use both."/>
      </div>
      {term.type==="controlled"&&(lk?(
        <div style={{background:C.surf,border:`1px solid ${C.brd}`,borderRadius:7,padding:10,marginBottom:10,fontSize:11}}>
          <div style={{color:C.grn,fontWeight:600,marginBottom:4}}>✓ Matched subject: {lk.mesh}</div>
          <div style={{display:"flex",alignItems:"center",gap:6,margin:"6px 0 4px"}}>
            <span style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase"}}>Include narrower topics?</span>
            <span style={{fontFamily:MONO,fontSize:9,color:C.dim}}>explode</span>
            <Help text="A subject term sits in a tree with more specific topics beneath it. “Include narrower” (explode) also searches everything underneath — broader. “Just this topic” searches only the exact term — narrower."/>
          </div>
          <div style={{display:"flex",gap:6}}>
            <Lever label="Include narrower" active={!term.noExplode} onClick={()=>onChange({...term,noExplode:false})} nextTerm={{...term,noExplode:false}}/>
            <Lever label="Just this topic" active={!!term.noExplode} onClick={()=>onChange({...term,noExplode:true})} nextTerm={{...term,noExplode:true}}/>
          </div>
          <div style={{fontSize:10,color:C.muted,marginTop:7,lineHeight:1.5}}>
            {term.noExplode?`Searches only "${lk.mesh}" — excludes ${(lk.children||[]).length} narrower topic(s).`:`Also includes ${(lk.children||[]).length} narrower topic(s).`}
          </div>
        </div>
      ):(
        <div style={{background:C.surf,border:`1px solid ${C.brd}`,borderRadius:7,padding:10,marginBottom:10,fontSize:11,color:C.yel}}>
          No matching subject term found. It will search as plain words until a match is found.
        </div>
      ))}
      {term.type==="freetext"&&(
        <div style={{background:C.surf,border:`1px solid ${C.brd}`,borderRadius:7,padding:10,marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
            <span style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase"}}>Where to look</span>
            <Help text="Where in each article to search. “Title only” is strictest, “Title & abstract” is the usual choice, “Everywhere” is broadest and noisiest."/>
          </div>
          <div style={{display:"flex",gap:6,marginBottom:9}}>
            <Lever label="Title" sub="ti" active={term.field==="ti"} onClick={()=>onChange({...term,field:"ti"})} nextTerm={{...term,field:"ti"}}/>
            <Lever label="Title & abstract" sub="tiab" active={!term.field||term.field==="tiab"} onClick={()=>onChange({...term,field:"tiab"})} nextTerm={{...term,field:"tiab"}}/>
            <Lever label="Everywhere" sub="all" active={term.field==="all"} onClick={()=>onChange({...term,field:"all"})} nextTerm={{...term,field:"all"}}/>
          </div>
          {!term.text.includes(" ")&&(<>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
              <span style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase"}}>Word endings</span>
              <Help text="“Match endings” (truncation) catches different endings from one stem — diabet* finds diabetes, diabetic, diabetics. Broadens the search."/>
            </div>
            <div style={{display:"flex",gap:6}}>
              <Lever label="Exact word" active={!term.truncate} onClick={()=>onChange({...term,truncate:false})} nextTerm={{...term,truncate:false}}/>
              <Lever label={`Match endings (${term.text.replace(/\*+$/,"")}*)`} active={!!term.truncate} onClick={()=>onChange({...term,truncate:true})} nextTerm={{...term,truncate:true}}/>
            </div>
          </>)}
          {term.text.includes(" ")&&(
            <label style={{display:"flex",alignItems:"center",gap:7,marginTop:4,cursor:"pointer",color:C.txt2,fontSize:11}}>
              <input type="checkbox" checked={term.phrase!==false} onChange={e=>onChange({...term,phrase:e.target.checked})}/>
              Search as exact phrase (recommended for multi-word terms)
            </label>
          )}
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        {lk&&term.type==="freetext"&&<button onClick={onConvert} style={{...btn("ghost"),fontSize:10,color:C.acc}}>+ add {(lk.synonyms||[]).length} synonyms</button>}
        <button onClick={onClose} style={{...btn("primary"),fontSize:11,marginLeft:"auto"}}>Done</button>
      </div>
    </div>
  );
}

/* prompt42 Task 3 — as-you-type MeSH/keyword/synonym suggestion box.
   Merges the instant local seed (localMeshSuggestions) with a debounced (>=300ms)
   remote lookup (api.meshSuggest). Remote failure → local-only (try/catch). The
   typed term is always addable on Enter (existing behavior preserved); ArrowUp/Down
   move the highlight, Enter adds the highlighted suggestion (or the typed term when
   none highlighted), Escape closes. Suggestions carry a MeSH/keyword/synonym badge. */
const SUGG_BADGE={
  mesh:["MeSH",C.acc],
  keyword:["text",C.muted],
  synonym:["syn",C.acc2||C.acc],
};
function mergeSuggestions(local,remote){
  const out=[]; const seen=new Set();
  const push=(s)=>{ const k=`${s.type}:${(s.label||"").toLowerCase()}`; if(!s.label||seen.has(k)) return; seen.add(k); out.push(s); };
  // Remote MeSH headings first (authoritative), then local seed fills the rest.
  remote.forEach(push); local.forEach(push);
  return out.slice(0,8);
}
function SuggestBox({api,value,onChange,onPick,onCommitTyped,onEscape,onBlur,placeholder,style,inputStyle:istyle,autoFocus}){
  const picking=useRef(false); // set during a suggestion click so blur doesn't double-commit
  const [remote,setRemote]=useState([]);
  const [open,setOpen]=useState(false);
  const [hi,setHi]=useState(-1);
  const timer=useRef(null);
  const boxRef=useRef(null);
  const local=useMemo(()=>localMeshSuggestions(value),[value]);

  // Debounced remote lookup (>=300ms). Failure → local-only. Stale results dropped:
  // a `live` token gates the commit so an in-flight request whose `value` has since
  // changed (and clearTimeout can't cancel) never overwrites the newer suggestions.
  useEffect(()=>{
    let live=true;
    const q=(value||"").trim();
    clearTimeout(timer.current);
    if(q.length<2){ setRemote([]); return ()=>{ live=false; }; }
    timer.current=setTimeout(async()=>{
      if(!api||typeof api.meshSuggest!=="function"){ if(live) setRemote([]); return; }
      try{
        const recs=await api.meshSuggest(q);
        // SB5 vocab safety — score each remote heading's confidence vs the typed term;
        // 'review' headings are labelled in the dropdown and never auto-added.
        const mapped=(Array.isArray(recs)?recs:[]).map(r=>({label:r.mesh,type:"mesh",mesh:r.mesh,vocab:r,source:"remote",confidence:meshConfidence(q,r.mesh)})).filter(x=>x.label);
        if(live) setRemote(mapped);
      }catch{ if(live) setRemote([]); } // graceful — keep local-only
    },320);
    return ()=>{ live=false; clearTimeout(timer.current); };
  },[value,api]);

  const items=useMemo(()=>mergeSuggestions(local,remote),[local,remote]);
  useEffect(()=>{ setOpen(items.length>0); setHi(-1); },[items.length,value]);

  const pick=(s)=>{ picking.current=true; onPick&&onPick(s); setOpen(false); setHi(-1); };
  const onKey=(e)=>{
    if(e.key==="ArrowDown"){ if(open&&items.length){ e.preventDefault(); setHi(h=>(h+1)%items.length); } }
    else if(e.key==="ArrowUp"){ if(open&&items.length){ e.preventDefault(); setHi(h=>(h<=0?items.length-1:h-1)); } }
    else if(e.key==="Enter"){
      if(open&&hi>=0&&items[hi]){ e.preventDefault(); pick(items[hi]); }
      else { onCommitTyped&&onCommitTyped(); }    // preserve Enter-to-add-typed-term
    }
    else if(e.key==="Escape"){ if(open){ e.preventDefault(); setOpen(false); setHi(-1); } else { onEscape&&onEscape(); } }
  };
  return(
    <span ref={boxRef} style={{position:"relative",display:"inline-block",...style}}>
      <input autoFocus={autoFocus} value={value}
        onChange={e=>onChange&&onChange(e.target.value)}
        onKeyDown={onKey}
        onFocus={()=>setOpen(items.length>0)}
        onBlur={()=>{ setTimeout(()=>{ setOpen(false); if(picking.current){ picking.current=false; } else { onBlur&&onBlur(); } },140); }}  // allow click on a suggestion; commit typed term only on a real blur
        placeholder={placeholder} style={istyle}
        role="combobox" aria-expanded={open} aria-autocomplete="list"/>
      {open&&items.length>0&&(
        <div role="listbox" style={{position:"absolute",zIndex:90,top:"calc(100% + 3px)",left:0,minWidth:240,maxWidth:340,background:C.card,border:`1px solid ${alpha(C.acc,"55")}`,borderRadius:8,boxShadow:"0 14px 40px var(--t-shadow)",overflow:"hidden"}}>
          {items.map((s,i)=>{
            const badge=SUGG_BADGE[s.type]||SUGG_BADGE.keyword;
            return(
              <div key={`${s.type}:${s.label}`} role="option" aria-selected={i===hi}
                onMouseDown={e=>{e.preventDefault();pick(s);}} onMouseEnter={()=>setHi(i)}
                style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",cursor:"pointer",background:i===hi?alpha(C.acc,"1a"):"transparent"}}>
                <span style={{flex:1,fontFamily:s.type==="mesh"?MONO:SANS,fontSize:11.5,color:C.txt2,wordBreak:"break-word"}}>{s.label}</span>
                {/* SB5 vocab safety — flag a low-confidence remote heading so the user verifies it before adding. */}
                {s.type==="mesh"&&s.confidence==="review"&&(
                  <span title="Low-confidence match — check this subject heading fits your topic before adding. PecanRev never adds it automatically." style={{fontSize:8,fontWeight:700,letterSpacing:.4,color:C.yel,textTransform:"uppercase",flexShrink:0,border:`1px solid ${alpha(C.yel,"66")}`,borderRadius:4,padding:"0 4px"}}>review</span>
                )}
                <span style={{fontSize:8,fontWeight:700,letterSpacing:.4,color:badge[1],textTransform:"uppercase",opacity:.85,flexShrink:0,border:`1px solid ${alpha(badge[1],"55")}`,borderRadius:4,padding:"0 4px"}}>{badge[0]}</span>
              </div>
            );
          })}
        </div>
      )}
    </span>
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
const STEPS=[
  {n:1,key:"keywords",label:"Select Keywords",hint:"Click the important ideas in your question."},
  {n:2,key:"concepts",label:"Organize Concepts",hint:"Group your keywords; add synonyms & subject headings."},
  {n:3,key:"databases",label:"Choose Databases",hint:"Pick where to search."},
  {n:4,key:"strategy",label:"Build Strategy",hint:"See your keywords become a search."},
  {n:5,key:"check",label:"Check & Export",hint:"Review, then export or send to screening."},
];

/* Horizontal, clickable step nav. Current step highlighted; done steps get a check. */
function StepNav({step,setStep}){
  return(
    <div style={{display:"flex",alignItems:"stretch",gap:0,marginBottom:14,background:C.card,border:`1px solid ${C.brd}`,borderRadius:12,padding:6,overflowX:"auto"}}>
      {STEPS.map((s,i)=>{
        const active=s.n===step, done=s.n<step;
        return(
          <button key={s.key} onClick={()=>setStep(s.n)} title={s.hint}
            style={{flex:"1 1 0",minWidth:128,display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,cursor:"pointer",
              border:active?`1px solid ${alpha(C.acc,"66")}`:"1px solid transparent",
              background:active?`${alpha(C.acc,"14")}`:"transparent",fontFamily:SANS,textAlign:"left"}}>
            <span style={{width:22,height:22,borderRadius:"50%",flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",
              fontSize:11,fontWeight:700,background:active?C.acc:done?alpha(C.grn,"22"):C.card2,
              color:active?C.accText:done?C.grn:C.muted,border:done?`1px solid ${alpha(C.grn,"55")}`:"none"}}>{done?"✓":s.n}</span>
            <span style={{display:"flex",flexDirection:"column",lineHeight:1.2,minWidth:0}}>
              <span style={{fontSize:11.5,fontWeight:700,color:active?C.txt:C.txt2,whiteSpace:"nowrap"}}>{s.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const STATUS_COLOR={empty:C.dim,"needs-review":C.yel,"mesh-suggested":C.acc,ready:C.grn};
// SB4 — Search Quality Check severity + sensitivity-signal colour maps.
const QC_COLOR={critical:C.red,warning:C.yel,info:C.acc};
const SENS_COLOR={"very-broad":C.red,broad:C.yel,balanced:C.grn,narrow:C.yel,"very-narrow":C.red};
function StatusChip({status}){
  const label=CONCEPT_STATUS_LABELS[status]||status; const col=STATUS_COLOR[status]||C.muted;
  return <span title="Concept readiness" style={{fontSize:8.5,fontWeight:700,letterSpacing:.4,color:col,textTransform:"uppercase",background:`${alpha(col,"14")}`,border:`1px solid ${alpha(col,"44")}`,borderRadius:5,padding:"1px 7px"}}>{label}</span>;
}

/* One PICO field as readable text with click-to-select word/phrase tokens. Filler
   words are dimmed + non-clickable; the manual box can still force any text in. */
function KeywordField({fieldKey,label,hint,text,accent,isSelected,onToggle,onAddManual}){
  const [manual,setManual]=useState("");
  const tokens=useMemo(()=>tokenizeForSelection(text||""),[text]);
  const addManual=()=>{ const v=manual.trim(); if(v){ onAddManual(fieldKey,v); setManual(""); } };
  return(
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderLeft:`3px solid ${accent}`,borderRadius:10,padding:"11px 13px",marginBottom:10}}>
      <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:6}}>
        <span style={{fontSize:12,fontWeight:700,color:C.txt}}>{label}</span>
        <span style={{fontSize:10.5,color:C.muted}}>{hint}</span>
      </div>
      {String(text||"").trim()?(
        <div style={{lineHeight:2.1}}>
          {tokens.map((tok,i)=>{
            if(tok.kind==="filler") return <span key={i} style={{color:C.muted,fontSize:12.5,margin:"0 1px"}}>{tok.text} </span>;
            const sel=isSelected(tok.text);
            return(
              <span key={i}> <button onClick={()=>onToggle(fieldKey,tok.text)} title={sel?"Click to unselect":"Click to select as a keyword"}
                aria-pressed={sel} className="sbkw-token"
                style={{cursor:"pointer",fontFamily:SANS,fontSize:12.5,padding:"2px 8px",borderRadius:7,margin:"0 1px",
                  border:sel?`1px solid ${accent}`:`1px ${tok.suggested?"solid":"dashed"} ${tok.suggested?alpha(accent,"66"):C.brd2}`,
                  background:sel?`${alpha(accent,"22")}`:tok.suggested?`${alpha(accent,"0c")}`:"transparent",
                  color:sel?C.txt:C.txt2,fontWeight:sel?600:400}}>
                {sel?"✓ ":""}{tok.text}{tok.kind==="phrase"&&!sel?<span style={{fontSize:8,opacity:.7,marginLeft:4}}>phrase</span>:null}
              </button> </span>
            );
          })}
        </div>
      ):(
        <div style={{fontSize:11.5,color:C.muted,fontStyle:"italic"}}>Empty — fill this in Protocol → PICO, then your keywords appear here to click.</div>
      )}
      <div style={{display:"flex",gap:6,marginTop:9}}>
        <input value={manual} onChange={e=>setManual(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addManual();}}}
          placeholder={`Add a keyword to ${label}…`} style={{...inputStyle,flex:1,fontSize:11.5}}/>
        <button onClick={addManual} style={{...btn("ghost"),fontSize:11}}>+ Add</button>
      </div>
    </div>
  );
}

/* Visual concept blocks joined by AND/OR — the beginner's mental model before any
   Boolean string. Read-only summary used at the top of Build Strategy. */
function ConceptBlocksBar({concepts}){
  const blocks=concepts.map(c=>({label:c.label,n:c.terms.filter(t=>(t.text||"").trim()).length,op:c.op||"AND",pico:!!c.picoField})).filter(b=>b.n>0);
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
function DatabaseCatalogView({selected,onToggle}){
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
                <label key={db.id} style={{display:"flex",alignItems:"flex-start",gap:9,background:on?`${alpha(C.acc,"0e")}`:C.card,border:`1px solid ${on?alpha(C.acc,"55"):C.brd}`,borderRadius:9,padding:"9px 11px",cursor:"pointer"}}>
                  <input type="checkbox" checked={on} onChange={()=>onToggle(db.id)} style={{marginTop:2}}/>
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

/* 73.md P6 — the final query string for one database, now via the strategy compiler
   for EVERY catalogue database (honouring a saved override). The old generic pseudo-
   string is gone: the compiler emits real per-database syntax + explicit diagnostics. */
function strategyForDb(concepts,overrides,dbId,filters){
  return compileStrategy({concepts,overrides,filters},dbId).query;
}

/* Plain, copy-able strategy table (concept → terms). */
function strategyTableText(concepts){
  const rows=concepts.filter(c=>c.terms.some(t=>(t.text||"").trim()))
    .map((c,i)=>`${i+1}\t${c.label}\t${c.terms.filter(t=>(t.text||"").trim()).map(t=>t.text).join(" OR ")}`);
  return ["#\tConcept\tTerms",...rows].join("\n");
}

/* Beginner-readable health check for Tab 5 (no fabricated numbers). */
function buildWarnings(concepts,hitState){
  const w=[];
  const withTerms=concepts.filter(c=>c.terms.some(t=>(t.text||"").trim()));
  if(!withTerms.length){ w.push({level:"error",msg:"No search terms yet. Go to Select Keywords and click the important ideas in your question."}); return w; }
  for(const k of ["P","I","O"]){
    const def=PICO_FIELD_DEFS.find(d=>d.key===k);
    const c=concepts.find(x=>x.picoField===k);
    if(def&&c&&!c.terms.some(t=>(t.text||"").trim())) w.push({level:"warn",msg:`No terms for ${def.label}. Your search may miss this concept.`});
  }
  if(hitState&&hitState.status==="updated"&&hitState.hitCount!=null){
    if(hitState.hitCount===0) w.push({level:"warn",msg:"PubMed returns 0 results — the search may be too narrow, or a term may have a typo."});
    else if(hitState.hitCount>100000) w.push({level:"warn",msg:`PubMed returns ${fmtCount(hitState.hitCount)} results — quite broad. Consider adding a concept or narrowing terms.`});
  }
  if(!w.length) w.push({level:"ok",msg:"Looks good — your search has multiple concepts with terms. Export it below or send it to screening."});
  return w;
}

/* prompt60 — compact "Limits" panel (the Search Wizard's Define step). Edits the
   AST `filters` block { dateFrom, dateTo, languages[], pubTypes[] } that the Pecan
   Search engine already applies per provider (unsupported limits are warned, never
   silently dropped, in the run step). Languages are ISO 639-1 codes (DOAJ uses them;
   PubMed maps them to the full English name). Pub types are PubMed Publication Type
   strings. Pure presentational — the parent owns `filters` state + persistence. */
const LIMIT_LANGS = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['pt', 'Portuguese'], ['it', 'Italian'], ['ru', 'Russian'], ['ar', 'Arabic']];
const LIMIT_PUBTYPES = ['Randomized Controlled Trial', 'Clinical Trial', 'Systematic Review', 'Meta-Analysis', 'Review', 'Observational Study', 'Comparative Study', 'Case Reports'];
function LimitsPanel({ filters, setFilters }) {
  const f = filters || { dateFrom: '', dateTo: '', languages: [], pubTypes: [] };
  const set = (patch) => setFilters({ ...f, ...patch });
  const toggleIn = (key, val) => { const cur = Array.isArray(f[key]) ? f[key] : []; set({ [key]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] }); };
  const yr = (v) => String(v || '').replace(/[^0-9]/g, '').slice(0, 4);
  const active = !!(f.dateFrom || f.dateTo || (f.languages || []).length || (f.pubTypes || []).length);
  const chip = (on) => ({ ...btn(on ? 'primary' : 'ghost'), fontSize: 10.5, padding: '4px 10px' });
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
          <input value={f.dateFrom || ''} onChange={(e) => set({ dateFrom: yr(e.target.value) })} placeholder="e.g. 2010" inputMode="numeric" style={{ ...inputStyle, width: 120 }} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, color: C.muted }}>to (year)
          <input value={f.dateTo || ''} onChange={(e) => set({ dateTo: yr(e.target.value) })} placeholder="e.g. 2025" inputMode="numeric" style={{ ...inputStyle, width: 120 }} /></label>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 5 }}>Languages</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {LIMIT_LANGS.map(([code, label]) => { const on = (f.languages || []).includes(code); return (
            <button key={code} onClick={() => toggleIn('languages', code)} style={chip(on)}>{on ? '✓ ' : ''}{label}</button>); })}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 5 }}>Publication types</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {LIMIT_PUBTYPES.map((pt) => { const on = (f.pubTypes || []).includes(pt); return (
            <button key={pt} onClick={() => toggleIn('pubTypes', pt)} style={chip(on)}>{on ? '✓ ' : ''}{pt}</button>); })}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MAIN EXPORT — SearchBuilderTab
   PROPS (all optional except where noted; see INTEGRATION_README.md):
     projectId   string   — INTEGRATION: which project this search belongs to
     pico        object   — INTEGRATION: app's existing PICO {P,I,C,O}
     api         object   — INTEGRATION: { meshLookup(text), pubmedCount(query) }
     loadSearch  func     — INTEGRATION: async (projectId) => savedState|null
     saveSearch  func     — INTEGRATION: async (projectId, state) => void
   ════════════════════════════════════════════════════════════════════════════ */
export default function SearchBuilderTab({projectId,pico,api,loadSearch,saveSearch,phase,onLiveQuery,onHitState,onRegisterHitRefresh,onGoToStage,onStats}){
  const A=api||defaultApi;
  // prompt60 — embedded mode: the Search Wizard renders this builder as its Define
  // (phase='define': keywords + concepts + Limits) and Build (phase='build') steps,
  // supplying its own chrome + step header. 73.md P4 adds the finer-grained
  // 'concepts' / 'terms' phases the staged Search Workspace uses (see
  // embeddedShowsStep); 'define' stays the legacy combined alias. When `phase` is
  // undefined the builder keeps its standalone 5-step flow unchanged.
  const embedded = phase === 'define' || phase === 'build' || phase === 'concepts' || phase === 'terms';
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
  const [step,setStep]=useState(1);
  const [selectedDbs,setSelectedDbs]=useState([]);
  const [readyForScreening,setReadyForScreening]=useState(false);
  const [dismissedWarnings,setDismissedWarnings]=useState([]); // SB4 — Search-Quality warnings the user kept anyway
  const [exportMsg,setExportMsg]=useState(""); // transient copy/export feedback
  const [showPlainMirror,setShowPlainMirror]=useState(false); // 73.md P6 — strategy-level plain-English mirror toggle
  const [editing,setEditing]=useState(null);
  const [adding,setAdding]=useState(null);
  const [draft,setDraft]=useState("");
  const [loaded,setLoaded]=useState(false);
  const [limitedMode,setLimitedMode]=useState(false); // backend/NLM unreachable
  const [showHidden,setShowHidden]=useState(false);   // prompt42 Task 2 — "Hidden PICO terms" panel
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
  const announce=(msg)=>setAnnounceMsg(String(msg||''));

  /* ── SE2: PICO key + refs (used by mount, autosave guard, and auto-sync) ───
     The key includes the Time Frame fields so a Time-Frame edit also re-syncs. */
  const picoKey=[pico?.P,pico?.I,pico?.C,pico?.O,pico?.timeframe,pico?.timeframeMode,pico?.tfStart,pico?.tfEnd].join("|");
  const picoSnapshot=useRef(picoKey);
  const conceptsRef=useRef(concepts); conceptsRef.current=concepts;
  const ignoredRef=useRef(ignored); ignoredRef.current=ignored;
  const lookedRef=useRef(new Set()); // texts already MeSH-looked-up (dedupe lookups)

  /* SE2 core — idempotent PICO → five-group sync. Guarantees the five PICO concept
     groups (Population, Intervention/Exposure, Comparator/Control, Outcomes, Time
     Frame) always exist and mirror their PICO field, while preserving manual
     concepts/terms, hidden terms, and MeSH conversions. Assigns render ids to any
     new concept/term, then fetches per-field MeSH. Safe to call repeatedly. */
  function syncFromPico(baseConcepts,ignoredList){
    const synced=syncSearchBuilderFromPico(pico,baseConcepts,ignoredList)
      .map(c=>({...c,id:c.id||uid(),terms:c.terms.map(t=>({...t,id:t.id||uid()}))}));
    setConcepts(synced); lookupAuto(synced); return synced;
  }
  // Run MeSH lookup for auto terms lacking vocab (once per text). MeSH lands under the
  // term's own PICO field group (SE2 Task 4). tryLookup is defined below (hoist-safe).
  function lookupAuto(cs){
    cs.forEach(c=>(c.terms||[]).forEach(t=>{
      if(t.source!=="pico_auto"||t.type==="controlled"||t.vocab) return;
      const n=cnorm(t.text); if(!n||lookedRef.current.has(n)) return;
      lookedRef.current.add(n); tryLookup(c.id,t.id,t.text);
    }));
  }

  /* ── INTEGRATION: load saved search, then ENSURE the five PICO groups exist ──
     Root-cause fix (SE2): never adopt a blank/legacy saved state as-is — always run
     the idempotent sync so the five field groups are present and populated. */
  useEffect(()=>{(async()=>{
    let saved=null;
    if(loadSearch&&projectId){ try{ saved=await loadSearch(projectId); }catch(e){ console.error("loadSearch failed",e); } }
    const base=saved&&Array.isArray(saved.concepts)?saved.concepts:[];
    const ig=saved&&Array.isArray(saved.ignored)?saved.ignored:[];
    const ov=saved&&saved.overrides&&typeof saved.overrides==="object"?saved.overrides:{};
    setOverrides(ov); setIgnored(ig);
    // prompt60 — load persisted search-scope limits (default empty for older saves).
    setFilters(saved&&saved.filters&&typeof saved.filters==="object"
      ?{dateFrom:String(saved.filters.dateFrom||""),dateTo:String(saved.filters.dateTo||""),
        languages:Array.isArray(saved.filters.languages)?saved.filters.languages.filter(s=>typeof s==="string"):[],
        pubTypes:Array.isArray(saved.filters.pubTypes)?saved.filters.pubTypes.filter(s=>typeof s==="string"):[]}
      :{dateFrom:"",dateTo:"",languages:[],pubTypes:[]});
    // SB3 — selected databases + handoff marker ([] / false when absent in older saves).
    setSelectedDbs(saved&&Array.isArray(saved.databases)?saved.databases.filter(s=>typeof s==="string"):[]);
    setReadyForScreening(!!(saved&&saved.readyForScreening));
    setDismissedWarnings(saved&&Array.isArray(saved.dismissedWarnings)?saved.dismissedWarnings.filter(s=>typeof s==="string"):[]);
    // 85.md A1/A2 — persisted vocabulary-suggestion rejections (absent on old saves).
    setRejectedSuggestions(saved&&Array.isArray(saved.rejectedSuggestions)?saved.rejectedSuggestions.filter(s=>typeof s==="string"&&s.trim()):[]);
    // Record what the server actually holds BEFORE syncing, so autosave persists the
    // synced structure once when it differs (legacy/blank) and is a no-op when stable.
    lastSavedRef.current=saved&&saved.concepts?serializeSearchState(saved):"";
    revisionRef.current=saved&&typeof saved.revision==="number"?saved.revision:0;
    picoSnapshot.current=picoKey;
    syncFromPico(base,ig);
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
    const sig=serializeSearchState({concepts,overrides,ignored,databases:selectedDbs,readyForScreening,dismissedWarnings,filters,rejectedSuggestions});
    if(sig===lastSavedRef.current){ pendingSaveRef.current=null; return; } // unchanged vs the server → no PUT, no ping-pong
    setRemoteUpdatedBy(null); // this user is now editing → drop the "updated by collaborator" attribution
    const payload={concepts,overrides,ignored,databases:selectedDbs,dismissedWarnings,filters,rejectedSuggestions};
    pendingSaveRef.current={sig,payload};
    setSaveState('saving'); saveStateRef.current='saving';
    clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>doSave(sig,payload),800);
    return ()=>clearTimeout(saveTimer.current);
  },[concepts,overrides,ignored,selectedDbs,readyForScreening,dismissedWarnings,filters,rejectedSuggestions,loaded]); // eslint-disable-line
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

  /* ── SE2: auto-sync the five groups whenever PICO changes — no manual button.
     Updates the editor's UI immediately; collaborators converge via the realtime
     poke below (their monolith refetches the project → their `pico` prop changes →
     this same effect runs for them). Idempotent, so concurrent syncs agree. */
  useEffect(()=>{
    if(!loaded||picoKey===picoSnapshot.current) return;
    picoSnapshot.current=picoKey;
    syncFromPico(conceptsRef.current,ignoredRef.current);
  },[picoKey,loaded]); // eslint-disable-line

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
  const anyDraft=Object.values(drafts).some(v=>v&&String(v).trim());
  const busyEditing=!!(editing||adding||(draft&&draft.trim())||anyDraft||pendingSplit);
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
  },[editing,adding,draft,drafts,pendingSplit]); // eslint-disable-line

  /* Restore hidden terms — forget every deleted auto term and re-run the idempotent
     sync. Manual concepts and manual terms are preserved; the five PICO groups are
     repopulated from PICO. (This is the "restore action" SE2 requires before a hidden
     term may reappear.) */
  function resetSuggestions(){
    lookedRef.current=new Set();
    // 85.md A1 — "Restore all" clears BOTH "user said no" lists together (hidden
    // terms AND rejected suggestions), so no rejection is ever hidden-unrecoverable.
    const cleared=resetSuggestionMemory({});
    setIgnored(cleared.ignored);
    setRejectedSuggestions(cleared.rejectedSuggestions);
    syncFromPico(conceptsRef.current,[]);
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
  const commitAdd=cid=>{
    if(!draft.trim()){setAdding(null);return;}
    const tid=uid();
    setConcepts(cs=>cs.map(c=>c.id===cid?{...c,terms:[...c.terms,{id:tid,text:draft.trim(),type:"freetext",field:"tiab",source:"user_added"}]}:c));
    tryLookup(cid,tid,draft.trim());
    setDraft("");
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
    if(msg){ setAddStatus(s=>({...s,[cid]:msg})); announce(msg); }
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
    const created=[];
    const newTerms=pend.map(s=>{const tid=uid();created.push(tid);return {id:tid,text:s.text,type:'controlled',field:'tiab',source:'user_added',vocab:s.vocab||null};});
    setConcepts(cs=>cs.map(x=>x.id===cid?{...x,terms:[...x.terms,...newTerms]}:x));
    setUndoStack(st=>recordBulkAccept(st,{concept:c,termIds:created,label:`${pend.length} headings`}));
    setUndoMsg(`Accepted ${pend.length} subject headings`);
    announce(`Accepted ${pend.length} subject headings into ${c.label}`);
  };
  /* Rejection keys scoped to one concept, for the "Show dismissed" restore list. */
  const rejectedEntriesFor=(c)=>{
    if(!c) return [];
    const prefix=rejectionKey(c,'');
    return rejectedSuggestions.filter(k=>k.startsWith(prefix))
      .map(k=>({key:k,label:k.slice(prefix.length).replace(/^fam:/,'')}));
  };

  const stats=searchStats(concepts);

  /* ── SB3: keyword select/deselect (Tab 1) + database selection (Tab 3) ───── */
  const effectiveDbs=useMemo(()=>selectedDbs.length?selectedDbs:defaultSelectedDatabases(),[selectedDbs]);
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
    concepts,pico,filters,overrides,databases:selectedDbs,
    rejected:rejectedSuggestions,dismissedWarnings,hitState,
  }),[concepts,pico,filters,overrides,selectedDbs,rejectedSuggestions,dismissedWarnings,hitState]);
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
  // "Edit terms →" from the Concepts stage: activate the concept, then navigate to
  // the Terms stage via the host seam; without a seam (legacy define co-mounts the
  // organize panel) fall back to scrolling/focusing it — never a dead button.
  const editTermsFor=(cid)=>{
    setActiveConceptId(cid);
    if(typeof onGoToStage==='function'){ onGoToStage('terms'); return; }
    try{
      const el=typeof document!=='undefined'?document.querySelector('[data-testid="sb-active-concept"], [data-testid="sb-step-organize-concepts"]'):null;
      if(el){ if(typeof el.scrollIntoView==='function') el.scrollIntoView({behavior:'smooth',block:'start'}); if(typeof el.focus==='function') el.focus(); }
    }catch{/* best-effort */}
  };
  /* Duplicate info for one term chip: the OTHER concept's name + resolution ids. */
  const dupInfoForTerm=(cid,t)=>{
    const key=termEquivalenceKey(t.text);
    const d=duplicates.find(x=>x.equivKey===key);
    if(!d) return null;
    const other=(d.occurrences||[]).find(o=>o.conceptId!==cid);
    if(!other) return null;
    return {otherLabel:other.conceptLabel||'another concept',otherConceptId:other.conceptId};
  };
  // Which PICO group a keyword clicked in the Research Question belongs to: the first
  // PICO field whose text contains it (so question clicks usually land correctly),
  // else Population as a sensible default. 'Q' is the Research-Question pseudo-field.
  const fieldKeyForQuestionToken=(text)=>{
    const n=cnorm(text);
    for(const k of ["P","I","C","O"]){ if(n&&cnorm(pico?.[k]||"").includes(n)) return k; }
    return "P";
  };
  const resolveKey=(fieldKey,text)=> fieldKey==="Q"?fieldKeyForQuestionToken(text):fieldKey;
  const addKeyword=(fieldKey,text)=>{
    const clean=String(text||"").trim(); if(!clean) return;
    const c=findFieldConcept(conceptsRef.current,fieldKey); if(!c) return;
    if(c.terms.some(t=>cnorm(t.text)===cnorm(clean))) return; // dedupe / already selected
    const tid=uid();
    setConcepts(cs=>cs.map(x=>x.id===c.id?{...x,terms:[...x.terms,{id:tid,text:clean,type:"freetext",field:"tiab",source:"user_added"}]}:x));
    tryLookup(c.id,tid,clean);
  };
  const removeKeyword=(fieldKey,text)=>{
    const c=findFieldConcept(conceptsRef.current,fieldKey); if(!c) return;
    const t=c.terms.find(x=>cnorm(x.text)===cnorm(text)); if(!t) return;
    removeTerm(c.id,t.id); // reuses the auto→ignored bookkeeping
  };
  // 85.md A2 — token clicks are announced politely ("Added 'X' to Population"),
  // reusing the workspace's mode-change announcer pattern (audit M4: silent routing).
  const fieldLabelFor=(k)=>{ const d=PICO_FIELD_DEFS.find(x=>x.key===k); return d?d.label:k; };
  const toggleKeyword=(fieldKey,text)=>{
    const k=resolveKey(fieldKey,text);
    if(fieldHasTerm(conceptsRef.current,k,text)){ removeKeyword(k,text); announce(`Removed '${text}' from ${fieldLabelFor(k)}`); }
    else { addKeyword(k,text); announce(`Added '${text}' to ${fieldLabelFor(k)}`); }
  };
  const isKeywordSelected=(fieldKey,text)=>{ const k=resolveKey(fieldKey,text); return fieldHasTerm(concepts,k,text); };
  const addManualKeyword=(fieldKey,text)=>{
    const k=fieldKey==="Q"?"P":fieldKey;
    addKeyword(k,text);
    announce(`Added '${text}' to ${fieldLabelFor(k)}`);
  };
  const copyOut=(text,label)=>{ try{navigator.clipboard?.writeText(text);}catch{/* clipboard unavailable */} setExportMsg(label||"Copied"); setTimeout(()=>setExportMsg(""),1800); };

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

  // prompt60 + 73.md P4 — which of the 5 internal step panels render. Standalone:
  // exactly the active step. Embedded: see embeddedShowsStep ('define' = legacy
  // combined alias; 'concepts'/'terms' split; 'build' = 3+4). The standalone Check
  // & Export step (5) never shows in embedded mode.
  const show = (n) => (embedded ? !!embeddedShowsStep(phase, n) : step === n);

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

      {/* header row — hidden in embedded (wizard) mode; the wizard supplies chrome */}
      {!embedded&&(
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:14}}>
        <div>
          <div style={{fontWeight:800,fontSize:16,letterSpacing:-.3}}>Strategy Builder — Pecan Search Engine</div>
          <div style={{fontSize:11,color:C.muted}}>Build once · render for PubMed, Embase &amp; Cochrane</div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:14}}>
          {/* 85.md A2 — honest save state in the standalone header too. */}
          <SaveStatusIndicator state={saveState} onRetry={saveNow}/>
          {/* SE2 — PICO concepts auto-sync; no manual "+N suggestions" button needed. */}
          <button onClick={toggleBeginner} role="switch" aria-checked={beginner} aria-label="Beginner mode" style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",borderRadius:20,cursor:"pointer",border:`1px solid ${beginner?C.grn:C.brd2}`,background:beginner?`${alpha(C.grn,"18")}`:"transparent",fontFamily:SANS}}>
            <span style={{width:30,height:16,borderRadius:10,background:beginner?C.grn:C.brd2,position:"relative",flexShrink:0}}>
              <span style={{position:"absolute",top:2,left:beginner?16:2,width:12,height:12,borderRadius:"50%",background:"#fff",transition:"all .15s"}}/>
            </span>
            <span style={{fontSize:11,fontWeight:600,color:beginner?C.grn:C.muted}}>Beginner mode</span>
          </button>
          <div style={{display:"flex",alignItems:"center",gap:14,fontSize:11,color:C.muted,fontFamily:MONO}}>
            {/* SE1 Task 5 — live-sync status: green dot = collaborators see changes instantly. */}
            <span title={rtHealthy?"Live — collaborators see your changes without refreshing":"Reconnecting — your changes still save and will sync"}
              style={{display:"inline-flex",alignItems:"center",gap:4,color:rtHealthy?C.grn:C.muted}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:rtHealthy?C.grn:C.yel}}/>{rtHealthy?"live":"sync"}
            </span>
            {/* SE1 Task 5 — attribute the most recent live update to the collaborator who made it. */}
            {remoteUpdatedBy&&(
              <span title={`This search was just updated by ${remoteUpdatedBy}`} style={{display:"inline-flex",alignItems:"center",gap:4,color:C.acc}}>↻ {remoteUpdatedBy}</span>
            )}
            <span>{stats.concepts} concepts</span><span style={{color:C.acc}}>{stats.controlled} MeSH</span><span style={{color:C.grn}}>{stats.free} free-text</span>
          </div>
        </div>
      </div>
      )}

      {limitedMode&&(
        <div style={{background:`${alpha(C.yel,"10")}`,border:`1px solid ${alpha(C.yel,"44")}`,borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:C.txt2}}>
          <strong style={{color:C.yel}}>Limited mode.</strong> Live subject-term lookup and PubMed counts are temporarily unavailable, so the builder is using a small offline vocabulary and hit counts are hidden. Your query syntax is still correct and fully usable.
        </div>
      )}

      {/* SE1 Task 5 — a collaborator's update arrived while this user was mid-edit. */}
      {remotePending&&(
        <div style={{background:`${alpha(C.acc,"10")}`,border:`1px solid ${alpha(C.acc,"44")}`,borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:C.txt2,display:"flex",alignItems:"center",gap:10}}>
          <span style={{flex:1}}><strong style={{color:C.acc}}>A collaborator updated this search.</strong> Your view will refresh automatically when you finish your current edit.</span>
          <button onClick={()=>{setEditing(null);setAdding(null);setDraft("");setDrafts({});setPendingSplit(null);if(pendingRemoteRef.current)applyRemote(pendingRemoteRef.current);}} style={{...btn("solid"),fontSize:10}}>Apply now</button>
        </div>
      )}

      {beginner&&!embedded&&(
        <div style={{background:`${alpha(C.grn,"0e")}`,border:`1px solid ${alpha(C.grn,"33")}`,borderRadius:8,padding:"10px 12px",marginBottom:12,fontSize:12,color:C.txt2,lineHeight:1.6}}>
          <strong style={{color:C.grn}}>Beginner mode is on.</strong> For each idea in your question, list the different ways authors might phrase it. The tool turns that into a correct search for each database. You don't need to know the technical terms — the defaults are already the recommended choice.
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

      {/* ── SB3: guided 5-step workflow (the wizard supplies the step nav in embedded mode) ── */}
      {!embedded&&<StepNav step={step} setStep={setStep}/>}
      {!embedded&&<div style={{fontSize:11.5,color:C.muted,marginBottom:12}}>{STEPS[step-1].hint}</div>}

      {/* 85.md A2 — dismissible mental-model intro for the Concepts stage (audit M2). */}
      {phase==="concepts"&&<ConceptsIntroStrip/>}

      {/* ─────────── STEP 1 — Select Keywords ─────────── */}
      {show(1)&&(
        <div data-testid="sb-step-select-keywords">
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:.6,textTransform:"uppercase"}}>Highlight the key ideas in your question</span>
            <Help text="Click the key words and phrases in your question — PecanRev turns the ones you pick into a search. Grey words (and, with, of…) aren't useful on their own; highlighted words are suggestions. Use the box under each field to add anything that isn't shown."/>
          </div>
          {/* 73.md P2 — selection legend: state is never colour-only (✓ prefix + border style). */}
          <div style={{display:"flex",flexWrap:"wrap",gap:14,alignItems:"center",marginBottom:10,fontSize:10.5,color:C.muted}}>
            <span style={{display:"inline-flex",alignItems:"center",gap:5}}><span aria-hidden="true" style={{fontWeight:700,color:C.acc}}>✓</span> selected</span>
            <span style={{display:"inline-flex",alignItems:"center",gap:5}}><span aria-hidden="true" style={{width:16,height:10,border:`1px dashed ${C.brd2}`,borderRadius:4,display:"inline-block"}}/> dashed = suggested</span>
            <span>type in the box under a field to add your own</span>
          </div>
          {pico?.question&&(
            <KeywordField fieldKey="Q" label="Research Question" hint="click the key ideas" text={pico.question} accent={C.acc}
              isSelected={(t)=>isKeywordSelected("Q",t)} onToggle={toggleKeyword} onAddManual={addManualKeyword}/>
          )}
          {[["P","Population","who or what is studied?"],["I","Intervention / Exposure","the treatment, exposure, or test"],["C","Comparator / Control","what it is compared against"],["O","Outcomes","what is measured"]].map(([k,label,hint],i)=>(
            <KeywordField key={k} fieldKey={k} label={label} hint={hint} text={pico?.[k]||""} accent={CONCEPT_COLORS[i%CONCEPT_COLORS.length]}
              isSelected={(t)=>isKeywordSelected(k,t)} onToggle={toggleKeyword} onAddManual={addManualKeyword}/>
          ))}
          {/* Selected-keywords tray — shows each keyword and the PICO field it came from. */}
          <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:10,padding:12,marginTop:4}}>
            <div style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>Selected keywords</div>
            {concepts.filter(c=>c.picoField&&c.picoField!=="T"&&c.terms.some(t=>(t.text||"").trim())).length===0
              ? <div style={{fontSize:11.5,color:C.muted,fontStyle:"italic"}}>Nothing selected yet — click the highlighted words above.</div>
              : concepts.filter(c=>c.picoField&&c.picoField!=="T").map(c=>{
                  const live=c.terms.filter(t=>(t.text||"").trim()); if(!live.length) return null;
                  return(
                    <div key={c.id} style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:7,flexWrap:"wrap"}}>
                      <span style={{fontSize:10,fontWeight:700,color:C.muted,minWidth:150}}>{c.label}</span>
                      <span style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {live.map(t=>(
                          <span key={t.id} style={{display:"inline-flex",alignItems:"center",gap:5,background:C.surf,border:`1px solid ${C.brd2}`,borderRadius:6,padding:"2px 8px",fontSize:11,color:C.txt2}}>
                            {t.text}
                            <button onClick={()=>removeTerm(c.id,t.id)} title="Remove keyword" aria-label={`Remove ${t.text}`} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:12,padding:0,lineHeight:1}}>×</button>
                          </span>
                        ))}
                      </span>
                    </div>
                  );
                })}
          </div>
        </div>
      )}

      {/* ─────────── 85.md A2 — phase 'concepts': concept CARDS (replace the compact
          summary). Name, role, live-term count, readiness, suggestion badge, ONE
          primary "Edit terms →" action; deletion confirms + is undoable. */}
      {phase==="concepts"&&(
        <ConceptCards
          concepts={concepts}
          beginner={beginner}
          statusFor={(c)=>conceptStatus(c,{rejected:rejectedSuggestions})}
          suggestionCounts={suggCounts.perConcept}
          onRename={(id,label)=>updateConcept(id,{label})}
          onToggleOp={(id)=>updateConcept(id,{op:(concepts.find(c=>c.id===id)?.op)==="OR"?"AND":"OR"})}
          onAddConcept={addConcept}
          onRemoveConcept={removeConcept}
          onEditTerms={editTermsFor}
        />
      )}

      {/* ─────────── 85.md A2 — phase 'terms': MASTER-DETAIL (navigator → active
          concept panel → strategy preview). The legacy grid below stays for the
          old SearchWizard ('define') and the standalone stepper, unchanged. */}
      {show(2)&&phase==="terms"&&(()=>{
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
                {dismissedWarnings.length>0&&<button onClick={restoreWarnings} title="Show dismissed checks again" style={{...btn("ghost"),fontSize:9.5,padding:"2px 8px",marginLeft:warningsOnly.length===0?"auto":0}}>restore dismissed ({dismissedWarnings.length})</button>}
              </div>
              {warningsOnly.map(w=>(
                <div key={w.id} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"6px 0",borderTop:`1px solid ${C.brd}`}}>
                  <span style={{color:QC_COLOR[w.severity]||C.muted,fontWeight:700,fontSize:12}}>{w.severity==="critical"?"✕":w.severity==="warning"?"⚠":"ℹ"}</span>
                  <span style={{flex:1,fontSize:11.5,color:C.txt2,lineHeight:1.5}}>
                    <span>{w.message}</span>
                    {w.action&&<span style={{display:"block",color:C.muted,fontSize:10.5,marginTop:2}}>→ {w.action}</span>}
                  </span>
                  <button onClick={()=>dismissWarning(w.id)} title="Keep anyway / dismiss this check" style={{...btn("ghost"),fontSize:9.5,padding:"2px 8px"}}>Dismiss</button>
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
              <ActiveConceptPanel concept={c} conceptIndex={cIdx} status={cStatus} onRename={(label)=>updateConcept(c.id,{label})}>
                {isTimeFrame?(
                  <div style={{fontSize:11.5,color:c.note?C.txt2:C.muted}}>
                    {c.note
                      ?<span><span style={{color:C.muted}}>⏱ Time restriction: </span><span style={{fontWeight:600}}>{c.note}</span></span>
                      :<span style={{fontStyle:"italic"}}>No time restriction set — choose one in Protocol → PICO → Time Frame.</span>}
                  </div>
                ):(
                  <>
                    {limitedMode&&(
                      <div style={{background:`${alpha(C.yel,"10")}`,border:`1px solid ${alpha(C.yel,"44")}`,borderRadius:8,padding:"7px 10px",marginBottom:8,fontSize:11,color:C.txt2}}>
                        <strong style={{color:C.yel}}>Limited mode.</strong> Live subject-heading lookup is temporarily unavailable — terms still work; headings attach when the service returns.
                      </div>
                    )}
                    <AddTermBox
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
                    />
                    {!hasAnyText?(
                      <div data-testid="sb-empty-concept" style={{background:C.surf,border:`1px dashed ${C.brd2}`,borderRadius:8,padding:"14px 16px",marginTop:10,fontSize:12,color:C.muted,lineHeight:1.6}}>
                        No terms yet — type a word above, or pick from your question on the <strong>Concepts</strong> stage.
                      </div>
                    ):(
                      <div style={{marginTop:10}}>
                        <TermChipRow
                          concept={c}
                          beginner={beginner}
                          dupInfoFor={(t)=>dupInfoForTerm(c.id,t)}
                          editingTermId={editing&&editing.conceptId===c.id?editing.termId:null}
                          onOpenEditor={(tid)=>setEditing(editing&&editing.termId===tid?null:{conceptId:c.id,termId:tid})}
                          onRemove={(tid)=>removeTerm(c.id,tid)}
                          renderEditor={(t)=>{
                            const dup=dupInfoForTerm(c.id,t);
                            return(
                              <TermEditorPopover
                                term={t}
                                beginner={beginner}
                                moveTargets={moveTargetsFor(c.id)}
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
                        onAccept={(s)=>acceptSuggestion(c.id,s)}
                        onDismiss={dismissSuggestion}
                        onAcceptAllHeadings={()=>acceptAllHeadings(c.id)}
                        rejectedEntries={rejectedEntriesFor(c)}
                        showDismissed={showDismissedSuggs}
                        onToggleShowDismissed={()=>setShowDismissedSuggs(v=>!v)}
                        onUnreject={unrejectSuggestion}
                        ignoredGroups={pico?ignoredByField:[]}
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
                            return <span>Combined with <strong>{next.label}</strong> using <strong style={{color:(c.op||"AND")==="OR"?C.yel:C.acc}}>{c.op||"AND"}</strong>{beginner?" — switch to expert mode to change how concepts combine (in the preview below).":" — toggle it in the strategy preview below, where both concepts are visible."}</span>;
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

            <button onClick={addConcept} style={{...btn("ghost"),width:"100%",justifyContent:"center",borderStyle:"dashed",marginTop:12}}>+ Add concept</button>

            <div style={{marginTop:12}}>
              <StrategyPreviewPanel
                concepts={concepts}
                activeId={c?c.id:null}
                beginner={beginner}
                hitState={hitState}
                onRetryHits={refreshHitsNow}
                onToggleOp={(cid)=>updateConcept(cid,{op:(concepts.find(x=>x.id===cid)?.op)==="OR"?"AND":"OR"})}
                pubmedQuery={pubmedQuery}
                onSelectConcept={(id)=>setActiveConceptId(id)}
              />
            </div>
          </div>
        );
      })()}

      {/* ─────────── STEP 2 — Organize Concepts (legacy concept editor: 'define' +
          standalone; the workspace 'terms' stage uses the master-detail above) ─── */}
      {show(2)&&phase!=="terms"&&(
        <div data-testid="sb-step-organize-concepts">
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:.6,textTransform:"uppercase"}}>Your concepts</span>
            <Help text="A concept is one idea in your question (a disease, a treatment). Under each concept, list the ways authors might phrase it. Concepts join with AND (all must appear); terms inside a concept join with OR (any one counts)."/>
            {pico&&ignored.length>0&&(
              <button onClick={()=>setShowHidden(s=>!s)} aria-expanded={showHidden} title="Show terms you removed from the suggestions, grouped by field, to restore them"
                style={{marginLeft:"auto",background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:10.5,fontFamily:MONO,textDecoration:"underline"}}>{showHidden?"▾":"▸"} Hidden terms ({ignored.length})</button>
            )}
          </div>

          {/* SB4 — Search Quality Check + total PubMed hits / sensitivity (reuses the
              live count; no extra calls). Non-blocking; the user can dismiss a check. */}
          {(qualityWarnings.length>0||dismissedWarnings.length>0||(hitState&&hitState.status==="updated"&&hitState.hitCount!=null))&&(
            <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:10,padding:12,marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:qualityWarnings.length?8:0}}>
                <span style={{fontSize:10.5,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase"}}>Search Quality Check</span>
                <Help text="Quick, non-blocking checks: duplicates across AND-ed concepts, empty concepts, missing controlled vocabulary, and terms that may make the search too narrow. Guidance only — you stay in control."/>
                {hitState&&hitState.status==="updated"&&hitState.hitCount!=null&&(
                  <span style={{marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:8,fontSize:11,fontFamily:MONO}}>
                    <span style={{color:C.acc,fontWeight:700}}>{fmtCount(hitState.hitCount)} PubMed hits</span>
                    {sensitivity&&<span title="Rough breadth of the current strategy" style={{fontSize:9,fontWeight:700,letterSpacing:.4,textTransform:"uppercase",color:SENS_COLOR[sensitivity.key]||C.muted,border:`1px solid ${alpha(SENS_COLOR[sensitivity.key]||C.muted,"66")}`,borderRadius:4,padding:"0 5px"}}>{sensitivity.label}</span>}
                  </span>
                )}
                {hitState&&(hitState.status==="updating"||hitState.status==="stale")&&<span style={{marginLeft:"auto",fontSize:10.5,color:C.muted,fontFamily:MONO}}>updating hits…</span>}
                {dismissedWarnings.length>0&&<button onClick={restoreWarnings} title="Show dismissed checks again" style={{...btn("ghost"),fontSize:9.5,padding:"2px 8px"}}>restore dismissed ({dismissedWarnings.length})</button>}
              </div>
              {qualityWarnings.length===0
                ? <div style={{fontSize:11,color:C.grn}}>✓ No issues detected.</div>
                : qualityWarnings.map(w=>(
                    <div key={w.id} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"6px 0",borderTop:`1px solid ${C.brd}`}}>
                      <span style={{color:QC_COLOR[w.severity]||C.muted,fontWeight:700,fontSize:12}}>{w.severity==="critical"?"✕":w.severity==="warning"?"⚠":"ℹ"}</span>
                      <span style={{flex:1,fontSize:11.5,color:C.txt2,lineHeight:1.5}}>
                        <span>{w.message}</span>
                        {w.action&&<span style={{display:"block",color:C.muted,fontSize:10.5,marginTop:2}}>→ {w.action}</span>}
                      </span>
                      <button onClick={()=>dismissWarning(w.id)} title="Keep anyway / dismiss this check" style={{...btn("ghost"),fontSize:9.5,padding:"2px 8px"}}>Dismiss</button>
                    </div>
                  ))}
            </div>
          )}

          {/* prompt42 Task 2 — Hidden PICO terms (unchanged): per-term restore + per-field + restore-all. */}
          {pico&&ignored.length>0&&showHidden&&(
            <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:10,padding:12,marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{fontSize:10.5,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase"}}>Hidden terms</span>
                <span style={{fontSize:10,color:C.dim}}>removed suggestions — won't return on re-sync until restored</span>
                <button onClick={resetSuggestions} title={`Restore all ${ignored.length} removed suggestion${ignored.length===1?"":"s"} and re-seed from PICO`}
                  style={{marginLeft:"auto",...btn("ghost"),fontSize:10,padding:"3px 9px"}}>↺ Restore all ({ignored.length})</button>
              </div>
              {ignoredByField.map((grp,gi)=>(
                <div key={gi} style={{marginBottom:gi<ignoredByField.length-1?8:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                    <span style={{fontSize:9.5,fontWeight:700,color:C.dim,letterSpacing:.5,textTransform:"uppercase"}}>{grp.field||grp.label||"Other"}</span>
                    <button onClick={()=>restoreField(grp.field)} title={`Restore all from ${grp.field||"this field"}`}
                      style={{background:"none",border:"none",color:C.acc,cursor:"pointer",fontSize:9.5,fontFamily:MONO,textDecoration:"underline"}}>restore all from {grp.field||"field"} ({grp.items.length})</button>
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                    {grp.items.map((e,ei)=>(
                      <span key={ei} style={{display:"inline-flex",alignItems:"center",gap:5,background:C.surf,border:`1px dashed ${C.brd2}`,borderRadius:6,padding:"2px 7px"}}>
                        <span style={{fontFamily:MONO,fontSize:10.5,color:C.txt2}}>{e.text}</span>
                        <button onClick={()=>restoreTerm(e)} title={`Restore "${e.text}"`} aria-label={`Restore ${e.text}`}
                          style={{background:"none",border:"none",color:C.acc,cursor:"pointer",fontSize:11,padding:0,lineHeight:1}}>↩</button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 73.md P2 — responsive concept-card grid (the old maxWidth:720 cap is gone).
              The AND/OR join renders as a chip on each non-last card's header showing
              how it combines with the NEXT concept (click to toggle). */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(360px, 1fr))",gap:14}}>
          {concepts.map((c,ci)=>{
            const color=CONCEPT_COLORS[ci%CONCEPT_COLORS.length];
            const meshN=c.terms.filter(t=>t.type==="controlled").length, freeN=c.terms.filter(t=>t.type==="freetext").length;
            return(
              <div key={c.id}>
                <div style={{background:C.card,border:`1px solid ${C.brd}`,borderLeft:`3px solid ${color}`,borderRadius:10,padding:12,height:"100%",boxSizing:"border-box"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                    <span style={{width:9,height:9,borderRadius:3,background:color}}/>
                    <input value={c.label} onChange={e=>updateConcept(c.id,{label:e.target.value})}
                      style={{...inputStyle,fontWeight:600,width:"auto",flex:1,background:"transparent",border:"none",padding:"2px 0",fontSize:13}}/>
                    {/* SB3 — beginner-readable readiness status. */}
                    <StatusChip status={conceptStatus(c)}/>
                    {/* SE2 — mark the five PICO-derived groups (vs user-added manual concepts). */}
                    {c.picoField&&(
                      <span title="Auto-generated from your PICO — updates when PICO changes" style={{fontSize:8.5,fontWeight:700,letterSpacing:.4,color:C.acc,textTransform:"uppercase",background:`${alpha(C.acc,"14")}`,border:`1px solid ${alpha(C.acc,"44")}`,borderRadius:5,padding:"1px 6px"}}>PICO</span>
                    )}
                    <span style={{fontSize:9.5,color:C.dim,fontFamily:MONO}}>{meshN} mesh · {freeN} text</span>
                    {/* SB4 Part 6 — controlled-vocabulary coverage indicator (MeSH/Emtree). */}
                    {c.picoField!=="T"&&c.terms.some(t=>(t.text||"").trim())&&(
                      <span title={meshN>0?"This concept includes a controlled-vocabulary (MeSH) term":"No MeSH/Emtree term yet — add one for better recall (click a term → Subject term)"} style={{fontSize:8,fontWeight:700,letterSpacing:.4,textTransform:"uppercase",borderRadius:4,padding:"0 5px",color:meshN>0?C.grn:C.muted,border:`1px solid ${alpha(meshN>0?C.grn:C.muted,"55")}`}}>{meshN>0?"MeSH found":"no MeSH yet"}</span>
                    )}
                    {/* SE2 — the five PICO groups always exist (not deletable); only manual concepts can be removed. */}
                    {!c.picoField&&<button onClick={()=>removeConcept(c.id)} title="Remove this concept" style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:15}}>×</button>}
                    {/* 73.md P2 — join-to-next chip (replaces the old between-cards pill in the grid). */}
                    {ci<concepts.length-1&&(
                      <button onClick={()=>updateConcept(c.id,{op:c.op==="AND"?"OR":"AND"})}
                        title="How this concept combines with the NEXT one — click to switch AND/OR"
                        aria-label={`Joined to the next concept with ${c.op||"AND"} — click to switch`}
                        style={{...btn("solid"),fontSize:9,padding:"1px 9px",fontFamily:MONO,letterSpacing:.8,flexShrink:0,color:c.op==="AND"?C.acc:C.yel,borderColor:alpha(c.op==="AND"?C.acc:C.yel,"55")}}>
                        {c.op||"AND"} <span style={{opacity:.7,letterSpacing:0}}>next</span>
                      </button>
                    )}
                  </div>
                  {/* SE2 — Time Frame group shows the selected restriction (no keyword search term). */}
                  {c.picoField==="T"&&(
                    <div style={{marginBottom:8,fontSize:11.5,color:c.note?C.txt2:C.dim}}>
                      {c.note?<span><span style={{color:C.muted}}>⏱ Time restriction: </span><span style={{fontWeight:600}}>{c.note}</span></span>
                        :<span style={{fontStyle:"italic"}}>No time restriction set — choose one in Protocol → PICO → Time Frame.</span>}
                    </div>
                  )}
                  <div style={{position:"relative"}}>
                    {c.terms.map(t=>(
                      <span key={t.id} style={{position:"relative",display:"inline-block"}}>
                        <TermChip term={t} dbId={activeDB} color={color}
                          onEdit={()=>setEditing(editing?.termId===t.id?null:{conceptId:c.id,termId:t.id})}
                          onRemove={()=>removeTerm(c.id,t.id)}
                          onMove={(toCid)=>moveTerm(c.id,t.id,toCid)} moveTargets={moveTargetsFor(c.id)} isDuplicate={isDupTerm(t)}/>
                        {editing?.termId===t.id&&(
                          <TermEditor term={t}
                            onChange={patch=>updateTerm(c.id,t.id,patch)}
                            onClose={()=>setEditing(null)}
                            onConvert={()=>{addSynonyms(c.id,t.id);setEditing(null);}}
                            onLookup={(text,forceControlled)=>tryLookup(c.id,t.id,text,forceControlled)}/>
                        )}
                      </span>
                    ))}
                    {adding===c.id?(
                      <SuggestBox api={A} value={draft} autoFocus
                        onChange={setDraft}
                        onPick={s=>{ addSuggestion(c.id,s); setDraft(""); }}     // add picked suggestion; stay open to add more
                        onCommitTyped={()=>commitAdd(c.id)}
                        onEscape={()=>{ setAdding(null); setDraft(""); }}
                        onBlur={()=>{ commitAdd(c.id); setAdding(null); }}
                        placeholder="type a term — suggestions appear"
                        style={{verticalAlign:"top"}}
                        inputStyle={{...inputStyle,width:220,display:"inline-block",fontSize:11,fontFamily:MONO}}/>
                    ):(
                      <button onClick={()=>setAdding(c.id)} style={{...btn("ghost"),fontSize:11,padding:"4px 10px"}}>+ term</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
          <button onClick={addConcept} style={{...btn("ghost"),width:"100%",justifyContent:"center",borderStyle:"dashed",marginTop:12}}>+ Add concept</button>

          {/* 73.md P2 — richer chip legend: heading state, term source, never colour-only. */}
          <div style={{display:"flex",flexWrap:"wrap",gap:14,marginTop:14,fontSize:10.5,color:C.muted}}>
            <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span aria-hidden="true" style={{width:9,height:9,borderRadius:2,background:CONCEPT_COLORS[0]}}/> filled square = subject heading (MeSH)</span>
            <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span aria-hidden="true" style={{fontSize:9,fontWeight:700,color:C.yel,border:`1px solid ${alpha(C.yel,"66")}`,borderRadius:4,padding:"0 4px",textTransform:"uppercase"}}>MeSH?</span> yellow = heading needs confirmation</span>
            <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span aria-hidden="true" style={{width:16,height:10,border:`1px dashed ${C.brd2}`,borderRadius:4,display:"inline-block"}}/> dashed = free-text words</span>
            <span style={{display:"inline-flex",alignItems:"center",gap:6}}>badges: <span style={{color:C.muted,fontWeight:700,fontSize:9,textTransform:"uppercase"}}>auto</span> from PICO · <span style={{color:C.grn,fontWeight:700,fontSize:9,textTransform:"uppercase"}}>added</span> by you · <span style={{color:C.acc,fontWeight:700,fontSize:9,textTransform:"uppercase"}}>syn</span> synonym</span>
          </div>
        </div>
      )}

      {/* prompt60 — Limits panel completes the wizard's Define step (date/language/pubtype).
          73.md P4 — the split 'terms' phase carries it too (limits ride with vocabulary). */}
      {(phase==='define'||phase==='terms')&&<LimitsPanel filters={filters} setFilters={setFilters}/>}

      {/* ─────────── STEP 3 — Choose Databases ─────────── */}
      {show(3)&&(
        <DatabaseCatalogView selected={new Set(effectiveDbs)} onToggle={toggleDb}/>
      )}

      {/* ─────────── STEP 4 — Database Strategy Workspace (73.md P6) ───────────
          Compiled, paste-ready syntax for EVERY selected catalogue database via the
          strategy compiler — with per-database overrides, warnings, unsupported
          features, vocabulary status, paste/run guidance, and open/export actions.
          compileAll runs on the live in-memory strategy, so panels are always
          current (an override shows "manually edited — not synced"). */}
      {show(4)&&(()=>{
        const compiled=compileAll({concepts,overrides,filters},effectiveDbs);
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
                setOverride={val=>setOverrides(o=>{const n={...o}; if(val==null) delete n[res.dbId]; else n[res.dbId]=val; return n;})}
                hitState={res.dbId==="pubmed"?hitState:null}/>
            ))}
          </div>
        );
      })()}

      {/* ─────────── STEP 5 — Check & Export (standalone only; the wizard's Run step replaces it) ─────────── */}
      {show(5)&&(()=>{
        const warnings=buildWarnings(concepts,hitState);
        const wcol={error:C.red,warn:C.yel,ok:C.grn};
        const allStrategies=effectiveDbs.map(id=>{const db=getDatabase(id);return db?`### ${db.label}\n${strategyForDb(concepts,overrides,id,filters)||"(no terms)"}`:"";}).filter(Boolean).join("\n\n");
        return(
          <div style={{maxWidth:760}}>
            {/* warnings / health check */}
            <div style={{marginBottom:12}}>
              {warnings.map((w,i)=>(
                <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",background:`${alpha(wcol[w.level],"10")}`,border:`1px solid ${alpha(wcol[w.level],"44")}`,borderRadius:8,padding:"8px 12px",marginBottom:6,fontSize:12,color:C.txt2}}>
                  <span style={{color:wcol[w.level],fontWeight:700}}>{w.level==="error"?"✕":w.level==="ok"?"✓":"⚠"}</span>
                  <span>{w.msg}</span>
                </div>
              ))}
            </div>
            {/* final strategy per selected database */}
            <div style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>Final strategy per database</div>
            {effectiveDbs.map(id=>{
              const db=getDatabase(id); if(!db) return null;
              const str=strategyForDb(concepts,overrides,id,filters);
              return(
                <div key={id} style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:10,padding:"11px 13px",marginBottom:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <span style={{fontSize:12,fontWeight:700,color:C.txt}}>{db.label}</span>
                    {db.syntaxLevel==="approximate"&&<span title="Approximate — this database's search is simplified and cannot express the full strategy" style={{fontSize:8,fontWeight:700,letterSpacing:.4,color:C.yel,textTransform:"uppercase",border:`1px solid ${alpha(C.yel,"55")}`,borderRadius:4,padding:"0 4px"}}>approximate</span>}
                    <span style={{fontSize:10,color:C.muted}}>{ACCESS_TIERS[db.tier]}</span>
                    {id==="pubmed"&&hitState&&hitState.status==="updated"&&hitState.hitCount!=null&&(
                      <span style={{fontSize:10.5,color:C.acc,fontFamily:MONO}}>{fmtCount(hitState.hitCount)} hits · updated {relativeTime(hitState.lastUpdatedAt)}</span>
                    )}
                    <button onClick={()=>copyOut(str,`Copied ${db.label} strategy`)} style={{marginLeft:"auto",...btn("ghost"),fontSize:10,padding:"3px 9px"}}>Copy</button>
                  </div>
                  <pre style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:8,padding:10,fontFamily:MONO,fontSize:10.5,lineHeight:1.6,color:C.txt2,whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0,maxHeight:160,overflowY:"auto"}}>{str||"(add terms first)"}</pre>
                  {id!=="pubmed"&&<div style={{fontSize:10,color:C.dim,marginTop:5}}>Hit counts are not available for this database yet.</div>}
                </div>
              );
            })}
            {/* export actions */}
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:12,alignItems:"center"}}>
              <button onClick={()=>copyOut(allStrategies,"Copied all strategies")} style={{...btn("primary"),fontSize:11}}>Copy all strategies</button>
              <button onClick={()=>copyOut(strategyTableText(concepts),"Copied strategy table")} style={{...btn("solid"),fontSize:11}}>Copy strategy table</button>
              <button onClick={async()=>{
                // single-key save (74.md recs round) — never rides the bulk autosave,
                // so it can't clobber (or be clobbered by) the other writer's value.
                const next=!readyForScreening;
                setReadyForScreening(next);
                if(saveSearch&&projectId){ try{ const ok=await saveSearch(projectId,{readyForScreening:next}); if(!ok) throw new Error("save failed"); }catch{ setReadyForScreening(!next); } }
              }} style={{...btn(readyForScreening?"primary":"ghost"),fontSize:11}}>
                {readyForScreening?"✓ Ready for Screening Import":"Mark ready for Screening Import"}
              </button>
              {exportMsg&&<span style={{fontSize:11,color:C.grn,fontWeight:600}}>{exportMsg}</span>}
            </div>
            {readyForScreening&&(
              <div style={{marginTop:10,background:`${alpha(C.grn,"0e")}`,border:`1px solid ${alpha(C.grn,"33")}`,borderRadius:8,padding:"9px 12px",fontSize:11.5,color:C.txt2}}>
                This search is marked ready. Run each database strategy, export the results, and import them in the <strong>Screening</strong> stage.
              </div>
            )}
          </div>
        );
      })()}

      {/* step footer — Back / Next (standalone only; the wizard owns step navigation) */}
      {!embedded&&(
      <div style={{display:"flex",alignItems:"center",gap:10,marginTop:18,paddingTop:14,borderTop:`1px solid ${C.brd}`}}>
        <button onClick={()=>setStep(s=>Math.max(1,s-1))} disabled={step===1}
          style={{...btn("ghost"),fontSize:12,opacity:step===1?0.4:1,cursor:step===1?"default":"pointer"}}>← Back</button>
        <span style={{fontSize:11,color:C.dim,marginLeft:"auto"}}>Step {step} of {STEPS.length}</span>
        <button onClick={()=>setStep(s=>Math.min(STEPS.length,s+1))} disabled={step===STEPS.length}
          style={{...btn("primary"),fontSize:12,opacity:step===STEPS.length?0.4:1,cursor:step===STEPS.length?"default":"pointer"}}>
          {step===STEPS.length?"Done":`Next: ${STEPS[step].label} →`}
        </button>
      </div>
      )}
    </div>
  );
}
