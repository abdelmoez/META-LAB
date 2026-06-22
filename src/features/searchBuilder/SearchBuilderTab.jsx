import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { C, FONT, MONO, alpha } from "../../frontend/theme/tokens.js";  // SearchEngine: adapt to app theme (day/night + brand)
import { picoToConcepts } from "../../research-engine/searchBuilder/conceptExtraction.js"; // prompt40 Task 3
import { localMeshSuggestions } from "../../research-engine/searchBuilder/meshSuggest.js"; // prompt42 Task 3
import { serializeSearchState, pickPersisted, remoteAdoptDecision, syncSearchBuilderFromPico,
  findFieldConcept, fieldHasTerm, conceptStatus, CONCEPT_STATUS_LABELS, PICO_FIELD_DEFS } from "../../research-engine/searchBuilder/searchState.js"; // SE1 + SE2 + SB3
import { tokenizeForSelection } from "../../research-engine/searchBuilder/keywordSelection.js"; // SB3 Tab 1
import { databaseGroups, defaultSelectedDatabases, getDatabase, ACCESS_TIERS, ACCESS_TOOLTIP } from "../../research-engine/searchBuilder/databases.js"; // SB3 Tab 3
import { detectCrossConceptDuplicates, searchQualityCheck, sensitivitySignal, termEquivalenceKey } from "../../research-engine/searchBuilder/crossConcept.js"; // SB4 Parts 4/8/9
import { useRealtime } from "../../frontend/hooks/useRealtime.js"; // SE1 Task 5 — live collaborator sync (shared SSE poke channel)

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
const CONCEPT_COLORS=["#2dd4bf","#818cf8","#f0abfc","#5eead4","#c4b5fd","#67e8f9","#a5b4fc","#6ee7b7"];
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
  if(dbId==="pubmed"){ const d=v?.mesh||t; return `"${d}"[Mesh${term.noExplode?":NoExp":""}]`; }
  if(dbId==="cochrane"){ const d=v?.mesh||t; return `[mh ${term.noExplode?"^":""}"${d}"]`; }
  if(dbId==="embase"){ const d=v?.emtree||t.toLowerCase(); return `'${d}'/${term.noExplode?"de":"exp"}`; }
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
function renderTerm(term,dbId){
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
          boxShadow:"0 14px 40px #000a",fontWeight:400,whiteSpace:"normal"}}>
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
    <div style={{background:C.card,border:`1px solid ${alpha(C.acc,"55")}`,borderRadius:10,padding:13,width:320,boxShadow:"0 16px 48px #000a",fontSize:11,lineHeight:1.55}}>
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
        <span style={{position:"absolute",zIndex:75,top:"100%",left:0,marginTop:4,background:C.card,border:`1px solid ${C.brd2}`,borderRadius:8,boxShadow:"0 14px 40px #000a",overflow:"hidden",minWidth:180}}>
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
    <div style={{position:"absolute",zIndex:70,marginTop:6,background:C.card,border:`1px solid ${C.brd2}`,borderRadius:10,padding:14,width:360,boxShadow:"0 16px 48px #000a"}}>
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
        const mapped=(Array.isArray(recs)?recs:[]).map(r=>({label:r.mesh,type:"mesh",mesh:r.mesh,vocab:r,source:"remote"})).filter(x=>x.label);
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
        <div role="listbox" style={{position:"absolute",zIndex:90,top:"calc(100% + 3px)",left:0,minWidth:240,maxWidth:340,background:C.card,border:`1px solid ${alpha(C.acc,"55")}`,borderRadius:8,boxShadow:"0 14px 40px #000a",overflow:"hidden"}}>
          {items.map((s,i)=>{
            const badge=SUGG_BADGE[s.type]||SUGG_BADGE.keyword;
            return(
              <div key={`${s.type}:${s.label}`} role="option" aria-selected={i===hi}
                onMouseDown={e=>{e.preventDefault();pick(s);}} onMouseEnter={()=>setHi(i)}
                style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",cursor:"pointer",background:i===hi?alpha(C.acc,"1a"):"transparent"}}>
                <span style={{flex:1,fontFamily:s.type==="mesh"?MONO:SANS,fontSize:11.5,color:C.txt2,wordBreak:"break-word"}}>{s.label}</span>
                <span style={{fontSize:8,fontWeight:700,letterSpacing:.4,color:badge[1],textTransform:"uppercase",opacity:.85,flexShrink:0,border:`1px solid ${alpha(badge[1],"55")}`,borderRadius:4,padding:"0 4px"}}>{badge[0]}</span>
              </div>
            );
          })}
        </div>
      )}
    </span>
  );
}

/* query output with live count (PubMed only) + edit override + plain English */
function QueryOutput({dbId,concepts,override,setOverride,beginner,liveCount,countState,hitState}){
  // prompt42 Task 1 — re-render the relative timestamp ("updated 2m ago") on a slow
  // tick so it stays fresh without a fetch. Tick only matters once we have a time.
  const [,setTick]=useState(0);
  useEffect(()=>{
    if(!hitState||hitState.status!=="updated"||hitState.lastUpdatedAt==null) return;
    const id=setInterval(()=>setTick(t=>t+1),15000);
    return ()=>clearInterval(id);
  },[hitState&&hitState.status,hitState&&hitState.lastUpdatedAt]);
  const db=DBS.find(d=>d.id===dbId);
  const {full,lines}=useMemo(()=>renderSearch(concepts,dbId),[concepts,dbId]);
  const plain=useMemo(()=>plainSearch(concepts),[concepts]);
  const [copied,setCopied]=useState(false);
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState("");
  const [showPlain,setShowPlain]=useState(false);

  const edited=override!=null&&override!==full;
  const shown=override!=null?override:full;
  const copy=()=>{navigator.clipboard?.writeText(shown);setCopied(true);setTimeout(()=>setCopied(false),1500);};
  const startEdit=()=>{setDraft(shown);setEditing(true);};
  const saveEdit=()=>{setOverride&&setOverride(draft===full?null:draft);setEditing(false);};
  const revert=()=>{setOverride&&setOverride(null);setEditing(false);};

  if(!full) return <div style={{color:C.dim,fontSize:12,padding:14,fontStyle:"italic"}}>Add terms to see the {db.label} query…</div>;
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <span style={{width:9,height:9,borderRadius:3,background:db.color}}/>
        <span style={{fontWeight:700,fontSize:13,color:C.txt}}>{db.label}</span>
        {db.live
          ? <span style={{fontSize:9,fontWeight:700,letterSpacing:.4,color:C.grn,background:`${alpha(C.grn,"18")}`,border:`1px solid ${alpha(C.grn,"55")}`,borderRadius:5,padding:"1px 6px"}}>● LIVE</span>
          : <span style={{fontSize:9,fontWeight:700,letterSpacing:.4,color:C.muted,background:C.card2,border:`1px solid ${C.brd2}`,borderRadius:5,padding:"1px 6px"}}>MANUAL</span>}
        {edited&&<span style={{fontSize:9.5,fontWeight:700,letterSpacing:.4,color:C.yel,background:`${alpha(C.yel,"1a")}`,border:`1px solid ${alpha(C.yel,"55")}`,borderRadius:5,padding:"1px 7px"}} title="Manually edited — no longer matches the concept builder">✎ EDITED</span>}
        <span style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          {/* prompt42 Task 1 — live hit status lifecycle (PubMed). Non-blocking;
              a failure shows a small inline message and never throws. */}
          {!edited&&db.live&&hitState&&(()=>{
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
          {/* Fallback for any future live db without a hitState (keeps old behavior). */}
          {!edited&&db.live&&!hitState&&(
            countState==="loading"
              ? <span style={{fontFamily:MONO,fontSize:11,color:C.muted}}>counting…</span>
              : liveCount!=null
                ? <span style={{fontFamily:MONO,fontSize:12,color:C.acc,fontWeight:700}}>{fmtCount(liveCount)} <span style={{color:C.muted,fontWeight:400,fontSize:10}}>hits</span></span>
                : null
          )}
          {!editing&&setOverride&&<button onClick={startEdit} style={{...btn("ghost"),fontSize:10,padding:"3px 9px"}}>✎ Edit query</button>}
          <button onClick={copy} style={{...btn("ghost"),fontSize:10,padding:"3px 9px"}}>{copied?"✓ Copied":"Copy"}</button>
        </span>
      </div>

      {edited&&!editing&&(
        <div style={{background:`${alpha(C.yel,"10")}`,border:`1px solid ${alpha(C.yel,"40")}`,borderRadius:7,padding:"7px 10px",marginBottom:8,fontSize:11,color:C.txt2,display:"flex",alignItems:"center",gap:10}}>
          <span style={{flex:1}}>This query was hand-edited and no longer reflects the concept builder. Concept changes won't appear here until you revert.</span>
          <button onClick={()=>{setDraft(shown);setEditing(true);}} style={{...btn("ghost"),fontSize:10}}>Re-edit</button>
          <button onClick={revert} style={{...btn("solid"),fontSize:10}}>↺ Revert</button>
        </div>
      )}

      {!editing&&!edited&&(
        <div style={{marginBottom:8}}>
          {lines.map(l=>(
            <div key={l.n} style={{display:"flex",gap:8,fontFamily:MONO,fontSize:11,lineHeight:1.7,color:C.txt2,padding:"2px 0"}}>
              <span style={{color:C.dim,minWidth:24}}>#{l.n}</span>
              <span style={{flex:1,wordBreak:"break-word"}}>{l.q}{l.op&&<span style={{color:C.acc,fontWeight:700}}>  {l.op}</span>}</span>
            </div>
          ))}
        </div>
      )}

      {editing?(
        <div>
          <textarea autoFocus value={draft} onChange={e=>setDraft(e.target.value)}
            style={{width:"100%",minHeight:120,background:C.bg,border:`1px solid ${alpha(C.acc,"66")}`,borderRadius:8,padding:12,fontFamily:MONO,fontSize:11,lineHeight:1.7,color:C.txt,boxSizing:"border-box",outline:"none",resize:"vertical"}}/>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <button onClick={saveEdit} style={{...btn("primary"),fontSize:11}}>Save edited query</button>
            <button onClick={()=>setEditing(false)} style={{...btn("ghost"),fontSize:11}}>Cancel</button>
            <button onClick={()=>setDraft(full)} style={{...btn("ghost"),fontSize:11,marginLeft:"auto"}}>Reset to generated</button>
          </div>
        </div>
      ):(
        <pre style={{background:C.bg,border:`1px solid ${edited?alpha(C.yel,"44"):C.brd}`,borderRadius:8,padding:12,fontFamily:MONO,fontSize:11,lineHeight:1.7,color:C.txt,whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0,maxHeight:280,overflowY:"auto"}}>{shown}</pre>
      )}

      {!editing&&!edited&&plain&&(
        <div style={{marginTop:8}}>
          {!beginner&&<button onClick={()=>setShowPlain(s=>!s)} style={{...btn("ghost"),fontSize:10,padding:"3px 9px"}}>{showPlain?"Hide plain English":"Show in plain English"}</button>}
          {(beginner||showPlain)&&(
            <div style={{marginTop:6,background:`${alpha(C.grn,"0c")}`,border:`1px solid ${alpha(C.grn,"33")}`,borderRadius:8,padding:"10px 12px"}}>
              <div style={{fontSize:9.5,fontWeight:700,color:C.grn,letterSpacing:.5,textTransform:"uppercase",marginBottom:6}}>In plain English, this finds:</div>
              {plain.split("\n").map((line,i)=><div key={i} style={{fontSize:11.5,color:C.txt2,lineHeight:1.6,padding:"1px 0"}}>{line}</div>)}
            </div>
          )}
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
            if(tok.kind==="filler") return <span key={i} style={{color:C.dim,fontSize:12.5,margin:"0 1px"}}>{tok.text} </span>;
            const sel=isSelected(tok.text);
            return(
              <span key={i}> <button onClick={()=>onToggle(fieldKey,tok.text)} title={sel?"Click to unselect":"Click to select as a keyword"}
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
        <div style={{fontSize:11.5,color:C.dim,fontStyle:"italic"}}>Empty — fill this in Protocol → PICO, then your keywords appear here to click.</div>
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
  if(!blocks.length) return <div style={{color:C.dim,fontSize:12,fontStyle:"italic",padding:"6px 0"}}>No concepts with terms yet — add keywords first.</div>;
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
                      {db.nativeSyntax&&<span title="The builder generates this database's exact search format" style={{fontSize:8,fontWeight:700,letterSpacing:.4,color:C.grn,textTransform:"uppercase",border:`1px solid ${alpha(C.grn,"55")}`,borderRadius:4,padding:"0 4px"}}>auto syntax</span>}
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

/* Generic (database-agnostic) keyword strategy — used for selected databases that
   don't have a verified native-syntax renderer. No field tags, no fabricated syntax. */
function genericStrategyString(concepts){ return renderSearch(concepts,"__generic__").full; }

/* The final query string for one database: the verified native syntax (honouring a
   user override) for PubMed/Embase/Cochrane, else the generic keyword strategy. */
function strategyForDb(concepts,overrides,dbId){
  const db=getDatabase(dbId);
  if(db&&db.nativeSyntax){ const o=overrides&&overrides[dbId]; return o!=null?o:renderSearch(concepts,dbId).full; }
  return genericStrategyString(concepts);
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

/* ════════════════════════════════════════════════════════════════════════════
   MAIN EXPORT — SearchBuilderTab
   PROPS (all optional except where noted; see INTEGRATION_README.md):
     projectId   string   — INTEGRATION: which project this search belongs to
     pico        object   — INTEGRATION: app's existing PICO {P,I,C,O}
     api         object   — INTEGRATION: { meshLookup(text), pubmedCount(query) }
     loadSearch  func     — INTEGRATION: async (projectId) => savedState|null
     saveSearch  func     — INTEGRATION: async (projectId, state) => void
   ════════════════════════════════════════════════════════════════════════════ */
export default function SearchBuilderTab({projectId,pico,api,loadSearch,saveSearch}){
  const A=api||defaultApi;
  const [concepts,setConcepts]=useState([]);
  const [overrides,setOverrides]=useState({});
  const [activeDB,setActiveDB]=useState("pubmed");
  const [beginner,setBeginner]=useState(true); // SB3 — beginner mode is the default
  // SB3 — guided stepper position (1..5) and the selected databases / handoff marker.
  // selectedDbs [] means "use the catalogue defaults"; it is only written once the
  // user changes the selection, so existing projects don't trigger a spurious save.
  const [step,setStep]=useState(1);
  const [selectedDbs,setSelectedDbs]=useState([]);
  const [readyForScreening,setReadyForScreening]=useState(false);
  const [dismissedWarnings,setDismissedWarnings]=useState([]); // SB4 — Search-Quality warnings the user kept anyway
  const [exportMsg,setExportMsg]=useState(""); // transient copy/export feedback
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
  const [picoDirty,setPicoDirty]=useState(false);
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
    // SB3 — selected databases + handoff marker ([] / false when absent in older saves).
    setSelectedDbs(saved&&Array.isArray(saved.databases)?saved.databases.filter(s=>typeof s==="string"):[]);
    setReadyForScreening(!!(saved&&saved.readyForScreening));
    setDismissedWarnings(saved&&Array.isArray(saved.dismissedWarnings)?saved.dismissedWarnings.filter(s=>typeof s==="string"):[]);
    // Record what the server actually holds BEFORE syncing, so autosave persists the
    // synced structure once when it differs (legacy/blank) and is a no-op when stable.
    lastSavedRef.current=saved&&saved.concepts?serializeSearchState(saved):"";
    revisionRef.current=saved&&typeof saved.revision==="number"?saved.revision:0;
    picoSnapshot.current=picoKey;
    syncFromPico(base,ig);
    setLoaded(true);
  })();},[projectId]); // eslint-disable-line

  /* ── INTEGRATION: autosave whenever the search changes (debounced) ──────── */
  const saveTimer=useRef(null);
  useEffect(()=>{
    if(!loaded||!saveSearch||!projectId) return;
    const sig=serializeSearchState({concepts,overrides,ignored,databases:selectedDbs,readyForScreening,dismissedWarnings});
    if(sig===lastSavedRef.current) return; // unchanged vs the server (e.g. just loaded/applied) → no PUT, no ping-pong
    setRemoteUpdatedBy(null); // this user is now editing → drop the "updated by collaborator" attribution
    clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(async()=>{
      try{
        const res=await saveSearch(projectId,{concepts,overrides,ignored,databases:selectedDbs,readyForScreening,dismissedWarnings});
        lastSavedRef.current=sig;
        if(res&&typeof res.revision==="number") revisionRef.current=res.revision;
      }catch(e){ console.error("saveSearch failed",e); }
    },800);
    return ()=>clearTimeout(saveTimer.current);
  },[concepts,overrides,ignored,selectedDbs,readyForScreening,dismissedWarnings,loaded]); // eslint-disable-line

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
    setRemoteUpdatedBy(saved.updatedBy&&saved.updatedBy.name?saved.updatedBy.name:"a collaborator");
    pendingRemoteRef.current=null; setRemotePending(false);
  }
  async function pullRemote(){
    if(!loadSearch||!projectId) return;
    let saved; try{ saved=await loadSearch(projectId); }catch{ return; }
    if(!saved||!saved.concepts) return;
    const decision=remoteAdoptDecision({
      remoteSig:serializeSearchState(saved), lastSavedSig:lastSavedRef.current,
      remoteRevision:saved.revision, knownRevision:revisionRef.current,
      busy:!!(editing||adding||(draft&&draft.trim())),
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
    if(!editing&&!adding&&!(draft&&draft.trim())&&pendingRemoteRef.current) applyRemote(pendingRemoteRef.current);
  },[editing,adding,draft]); // eslint-disable-line

  /* Restore hidden terms — forget every deleted auto term and re-run the idempotent
     sync. Manual concepts and manual terms are preserved; the five PICO groups are
     repopulated from PICO. (This is the "restore action" SE2 requires before a hidden
     term may reappear.) */
  function resetSuggestions(){
    lookedRef.current=new Set();
    setIgnored([]);
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

  /* How many genuinely-new PICO suggestions are available (drives the banner). */
  const newSuggestionCount=useMemo(()=>{
    if(!picoDirty) return 0;
    const have=presentPrimaries(concepts);
    const ig=new Set(ignored.map(e=>cnorm(e&&e.text)));
    return picoToConcepts(pico).filter(c=>{ const p=cnorm(c.terms[0]?.text); return p&&!have.has(p)&&!ig.has(p); }).length;
  },[picoDirty,concepts,ignored,pico]); // eslint-disable-line

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
  const countCache=useRef({});        // query string -> count (number|null)
  const countTimer=useRef(null);
  const pubmedQuery=useMemo(()=>{
    const o=overrides.pubmed; const gen=renderSearch(concepts,"pubmed").full;
    return o!=null?o:gen;
  },[concepts,overrides]);
  const pubHash=useMemo(()=>strategyHash(pubmedQuery),[pubmedQuery]);

  useEffect(()=>{
    // No query → reset to idle (nothing to count).
    if(!pubmedQuery){
      setHitState({strategyHash:pubHash,hitCount:null,status:"idle",lastUpdatedAt:null,errorMessage:null});
      setCounts(c=>({...c,pubmed:null})); setCountState("idle");
      return;
    }
    // Cached → resolve immediately to 'updated' (no fetch, no flicker). Keep the
    // existing timestamp if this is still the same strategy; stamp fresh when the
    // strategy changed (the cached count is newly shown for this strategy).
    if(countCache.current[pubmedQuery]!==undefined){
      const n=countCache.current[pubmedQuery];
      setHitState(s=>({strategyHash:pubHash,hitCount:n,status:"updated",
        lastUpdatedAt:(s.strategyHash===pubHash&&s.lastUpdatedAt)?s.lastUpdatedAt:Date.now(),errorMessage:null}));
      setCounts(c=>({...c,pubmed:n})); setCountState("idle");
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
        countCache.current[pubmedQuery]=n;
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
    if(t&&t.source==="pico_auto"){ addIgnored({text:t.text,field:c?.field||"",label:c?.label||""}); }
    setConcepts(cs=>cs.map(c2=>c2.id===cid?{...c2,terms:c2.terms.filter(t2=>t2.id!==tid)}:c2));
  };
  const addConcept=()=>setConcepts(cs=>[...cs,{id:uid(),label:`Concept ${cs.length+1}`,op:"AND",source:"user_added",terms:[]}]);
  const removeConcept=id=>{
    const c=concepts.find(x=>x.id===id);
    const auto=(c?.terms||[]).filter(t=>t.source==="pico_auto").map(t=>({text:t.text,field:c?.field||"",label:c?.label||""}));
    if(auto.length) setIgnored(ig=>{
      const have=new Set(ig.map(e=>cnorm(e.text)));
      return [...ig,...auto.filter(e=>!have.has(cnorm(e.text)))];
    });
    setConcepts(cs=>cs.filter(c2=>c2.id!==id));
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

  const stats=searchStats(concepts);

  /* ── SB3: keyword select/deselect (Tab 1) + database selection (Tab 3) ───── */
  const effectiveDbs=useMemo(()=>selectedDbs.length?selectedDbs:defaultSelectedDatabases(),[selectedDbs]);
  const toggleDb=(id)=>setSelectedDbs(prev=>{
    const base=prev.length?prev:defaultSelectedDatabases();
    return base.includes(id)?base.filter(x=>x!==id):[...base,id];
  });
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
  const toggleKeyword=(fieldKey,text)=>{ const k=resolveKey(fieldKey,text); return fieldHasTerm(conceptsRef.current,k,text)?removeKeyword(k,text):addKeyword(k,text); };
  const isKeywordSelected=(fieldKey,text)=>{ const k=resolveKey(fieldKey,text); return fieldHasTerm(concepts,k,text); };
  const addManualKeyword=(fieldKey,text)=>addKeyword(fieldKey==="Q"?"P":fieldKey,text);
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

  if(!loaded) return <div style={{padding:40,color:C.muted,fontFamily:SANS,background:C.bg,minHeight:"100%"}}>Loading search…</div>;

  return(
    <div style={{background:C.bg,color:C.txt,fontFamily:SANS,minHeight:"100%",padding:"4px 2px"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;700&display=swap');`}</style>

      {/* header row */}
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:14}}>
        <div>
          <div style={{fontWeight:800,fontSize:16,letterSpacing:-.3}}>Search Builder</div>
          <div style={{fontSize:11,color:C.muted}}>Build once · render for PubMed, Embase &amp; Cochrane</div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:14}}>
          {/* SE2 — PICO concepts auto-sync; no manual "+N suggestions" button needed. */}
          <button onClick={()=>setBeginner(b=>!b)} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",borderRadius:20,cursor:"pointer",border:`1px solid ${beginner?C.grn:C.brd2}`,background:beginner?`${alpha(C.grn,"18")}`:"transparent",fontFamily:SANS}}>
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

      {limitedMode&&(
        <div style={{background:`${alpha(C.yel,"10")}`,border:`1px solid ${alpha(C.yel,"44")}`,borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:C.txt2}}>
          <strong style={{color:C.yel}}>Limited mode.</strong> Live subject-term lookup and PubMed counts are temporarily unavailable, so the builder is using a small offline vocabulary and hit counts are hidden. Your query syntax is still correct and fully usable.
        </div>
      )}

      {/* SE1 Task 5 — a collaborator's update arrived while this user was mid-edit. */}
      {remotePending&&(
        <div style={{background:`${alpha(C.acc,"10")}`,border:`1px solid ${alpha(C.acc,"44")}`,borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:C.txt2,display:"flex",alignItems:"center",gap:10}}>
          <span style={{flex:1}}><strong style={{color:C.acc}}>A collaborator updated this search.</strong> Your view will refresh automatically when you finish your current edit.</span>
          <button onClick={()=>{setEditing(null);setAdding(null);setDraft("");if(pendingRemoteRef.current)applyRemote(pendingRemoteRef.current);}} style={{...btn("solid"),fontSize:10}}>Apply now</button>
        </div>
      )}

      {beginner&&(
        <div style={{background:`${alpha(C.grn,"0e")}`,border:`1px solid ${alpha(C.grn,"33")}`,borderRadius:8,padding:"10px 12px",marginBottom:12,fontSize:12,color:C.txt2,lineHeight:1.6}}>
          <strong style={{color:C.grn}}>Beginner mode is on.</strong> For each idea in your question, list the different ways authors might phrase it. The tool turns that into a correct search for each database. You don't need to know the technical terms — the defaults are already the recommended choice.
        </div>
      )}

      {/* ── SB3: guided 5-step workflow ─────────────────────────────────────── */}
      <StepNav step={step} setStep={setStep}/>
      <div style={{fontSize:11.5,color:C.muted,marginBottom:12}}>{STEPS[step-1].hint}</div>

      {/* ─────────── STEP 1 — Select Keywords ─────────── */}
      {step===1&&(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:.6,textTransform:"uppercase"}}>Click the important ideas in your question</span>
            <Help text="Click the key words and phrases in your question — PecanRev turns the ones you pick into a search. Grey words (and, with, of…) aren't useful on their own; highlighted words are suggestions. Use the box under each field to add anything that isn't shown."/>
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
              ? <div style={{fontSize:11.5,color:C.dim,fontStyle:"italic"}}>Nothing selected yet — click the highlighted words above.</div>
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

      {/* ─────────── STEP 2 — Organize Concepts (existing concept editor) ─────────── */}
      {step===2&&(
        <div style={{maxWidth:720}}>
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

          {concepts.map((c,ci)=>{
            const color=CONCEPT_COLORS[ci%CONCEPT_COLORS.length];
            const meshN=c.terms.filter(t=>t.type==="controlled").length, freeN=c.terms.filter(t=>t.type==="freetext").length;
            return(
              <div key={c.id} style={{marginBottom:10}}>
                <div style={{background:C.card,border:`1px solid ${C.brd}`,borderLeft:`3px solid ${color}`,borderRadius:10,padding:12}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
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
                {ci<concepts.length-1&&(
                  <div style={{display:"flex",justifyContent:"center",margin:"4px 0"}}>
                    <button onClick={()=>updateConcept(c.id,{op:c.op==="AND"?"OR":"AND"})}
                      style={{...btn("solid"),fontSize:10,padding:"2px 14px",fontFamily:MONO,letterSpacing:1,color:c.op==="AND"?C.acc:C.yel,borderColor:alpha(c.op==="AND"?C.acc:C.yel,"55")}}>{c.op||"AND"}</button>
                  </div>
                )}
              </div>
            );
          })}
          <button onClick={addConcept} style={{...btn("ghost"),width:"100%",justifyContent:"center",borderStyle:"dashed",marginTop:4}}>+ Add concept</button>

          <div style={{display:"flex",gap:16,marginTop:14,fontSize:10.5,color:C.muted}}>
            <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:9,height:9,borderRadius:2,background:CONCEPT_COLORS[0]}}/> filled square = subject heading (MeSH)</span>
            <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:9,height:9,borderRadius:"50%",border:`1.5px solid ${C.muted}`}}/> hollow circle = plain words</span>
          </div>
        </div>
      )}

      {/* ─────────── STEP 3 — Choose Databases ─────────── */}
      {step===3&&(
        <DatabaseCatalogView selected={new Set(effectiveDbs)} onToggle={toggleDb}/>
      )}

      {/* ─────────── STEP 4 — Build Strategy ─────────── */}
      {step===4&&(()=>{
        const nativeSelected=DBS.filter(d=>effectiveDbs.includes(d.id));
        const showDb=nativeSelected.find(d=>d.id===activeDB)?activeDB:(nativeSelected[0]?nativeSelected[0].id:"pubmed");
        const genericDbs=effectiveDbs.filter(id=>{const db=getDatabase(id);return db&&!db.nativeSyntax;});
        return(
          <div>
            <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:10,padding:14,marginBottom:12}}>
              <div style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>How your search fits together</div>
              <ConceptBlocksBar concepts={concepts}/>
              <div style={{fontSize:11,color:C.muted,marginTop:10,lineHeight:1.55}}>
                Similar terms inside one concept are joined with <strong style={{color:C.yel}}>OR</strong> (any one counts); different concepts are joined with <strong style={{color:C.acc}}>AND</strong> (all must appear).
              </div>
            </div>
            {nativeSelected.length>0?(
              <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:10,padding:14,marginBottom:12}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:.6,textTransform:"uppercase"}}>Database search format</span>
                  <div style={{display:"flex",gap:4,marginLeft:"auto"}}>
                    {nativeSelected.map(d=>(
                      <button key={d.id} onClick={()=>setActiveDB(d.id)}
                        style={{...btn(showDb===d.id?"solid":"ghost"),fontSize:10,padding:"3px 9px",borderColor:showDb===d.id?d.color:C.brd2,color:showDb===d.id?d.color:C.muted}}>
                        {d.label}{overrides[d.id]!=null?" ✎":""}
                      </button>
                    ))}
                  </div>
                </div>
                <QueryOutput dbId={showDb} concepts={concepts} beginner={beginner}
                  override={overrides[showDb]??null}
                  setOverride={val=>setOverrides(o=>({...o,[showDb]:val}))}
                  liveCount={counts[showDb]} countState={showDb==="pubmed"?countState:"idle"}
                  hitState={showDb==="pubmed"?hitState:null}/>
              </div>
            ):(
              <div style={{background:`${alpha(C.yel,"10")}`,border:`1px solid ${alpha(C.yel,"44")}`,borderRadius:8,padding:"10px 12px",marginBottom:12,fontSize:12,color:C.txt2}}>
                None of your selected databases have an auto-generated search format. Select PubMed, Embase, or Cochrane in <button onClick={()=>setStep(3)} style={{...btn("ghost"),fontSize:11,padding:"1px 8px"}}>Choose Databases</button> to see ready-to-paste syntax, or use the generic strategy below.
              </div>
            )}
            {genericDbs.length>0&&(
              <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:10,padding:14}}>
                <div style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>Generic strategy for: {genericDbs.map(id=>getDatabase(id)?.label).filter(Boolean).join(", ")}</div>
                <div style={{fontSize:11,color:C.dim,marginBottom:8,lineHeight:1.5}}>PecanRev doesn't generate the exact native syntax for these databases yet. This keyword strategy is a starting point — adapt it to each database's own search format.</div>
                <pre style={{background:C.bg,border:`1px solid ${C.brd}`,borderRadius:8,padding:12,fontFamily:MONO,fontSize:11,lineHeight:1.7,color:C.txt,whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0,maxHeight:240,overflowY:"auto"}}>{genericStrategyString(concepts)||"Add terms to see the strategy…"}</pre>
              </div>
            )}
          </div>
        );
      })()}

      {/* ─────────── STEP 5 — Check & Export ─────────── */}
      {step===5&&(()=>{
        const warnings=buildWarnings(concepts,hitState);
        const wcol={error:C.red,warn:C.yel,ok:C.grn};
        const allStrategies=effectiveDbs.map(id=>{const db=getDatabase(id);return db?`### ${db.label}\n${strategyForDb(concepts,overrides,id)||"(no terms)"}`:"";}).filter(Boolean).join("\n\n");
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
              const str=strategyForDb(concepts,overrides,id);
              return(
                <div key={id} style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:10,padding:"11px 13px",marginBottom:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <span style={{fontSize:12,fontWeight:700,color:C.txt}}>{db.label}</span>
                    {!db.nativeSyntax&&<span title="Generic keyword strategy — adapt to this database's own format" style={{fontSize:8,fontWeight:700,letterSpacing:.4,color:C.yel,textTransform:"uppercase",border:`1px solid ${alpha(C.yel,"55")}`,borderRadius:4,padding:"0 4px"}}>generic</span>}
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
              <button onClick={()=>setReadyForScreening(r=>!r)} style={{...btn(readyForScreening?"primary":"ghost"),fontSize:11}}>
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

      {/* step footer — Back / Next */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginTop:18,paddingTop:14,borderTop:`1px solid ${C.brd}`}}>
        <button onClick={()=>setStep(s=>Math.max(1,s-1))} disabled={step===1}
          style={{...btn("ghost"),fontSize:12,opacity:step===1?0.4:1,cursor:step===1?"default":"pointer"}}>← Back</button>
        <span style={{fontSize:11,color:C.dim,marginLeft:"auto"}}>Step {step} of {STEPS.length}</span>
        <button onClick={()=>setStep(s=>Math.min(STEPS.length,s+1))} disabled={step===STEPS.length}
          style={{...btn("primary"),fontSize:12,opacity:step===STEPS.length?0.4:1,cursor:step===STEPS.length?"default":"pointer"}}>
          {step===STEPS.length?"Done":`Next: ${STEPS[step].label} →`}
        </button>
      </div>
    </div>
  );
}
