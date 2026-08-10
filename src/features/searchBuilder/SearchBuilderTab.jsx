import { useState, useMemo, useEffect, useRef, useCallback, useId } from "react";
// 99.md — the board expand/collapse morph renders synchronously inside a View
// Transition callback (the only flushSync in the feature; see animateBoardChange).
import { flushSync } from "react-dom";
import { C, FONT, MONO, alpha, CB_SERIES } from "../../frontend/theme/tokens.js";  // SearchEngine: adapt to app theme (day/night + brand)
import { localMeshSuggestions, meshConfidence } from "../../research-engine/searchBuilder/meshSuggest.js"; // prompt42 Task 3 + SB5 vocab safety
import { serializeSearchState, pickPersisted, remoteAdoptDecision,
  conceptStatus, CONCEPT_STATUS_LABELS,
  // 96.md — question-based concept groups (PICO removed from the Search Engine):
  seedStateFromQuestion, createConceptFromPhrase, findConceptForPhrase,
  conceptOnlyHoldsOriginTerm, conceptDrift, setConceptSourcePhrase,
  reorderConcept as reorderConceptState, reorderTerm as reorderTermState,
  mergeConcepts as mergeConceptsState,
  // 97.md Phase 15 — one-shot neutral-label conversion for legacy PICO groups.
  migrateLegacyGroupLabels,
  splitConcept as splitConceptState } from "../../research-engine/searchBuilder/searchState.js"; // SE1 + SB3 + 96.md + 97.md
import { tokenizeForSelection, spanPhrase } from "../../research-engine/searchBuilder/keywordSelection.js"; // SB3 Tab 1 + 96.md QA M5
import { databaseGroups, defaultSelectedDatabases, getDatabase, ACCESS_TIERS, ACCESS_TOOLTIP, openUrlFor, homeUrlFor } from "../../research-engine/searchBuilder/databases.js"; // SB3 Tab 3 + 73.md P6
import { compileStrategy, compileAll, capabilitiesFor } from "../../research-engine/searchBuilder/compilers/index.js"; // 73.md P6 — per-database strategy compiler (read-only consumer)
import { searchQualityCheck } from "../../research-engine/searchBuilder/crossConcept.js"; // SB4 (97.md: the family key now lives only in dupSignals' SOFT "possible variant" hint)
import { useRealtime } from "../../frontend/hooks/useRealtime.js"; // SE1 Task 5 — live collaborator sync (shared SSE poke channel)
// 98.md §5 — the ONE engine-wide Beginner Mode (provider lives in SearchWorkspace;
// direct module import — not the feature index — so no import cycle forms).
import { useBeginnerMode } from "../searchWorkspace/beginnerMode.jsx";
// 85.md A1 — pure engine modules for the redesigned Concepts / Terms & Vocabulary UI.
import { liveTermsOf } from "../../research-engine/searchBuilder/termLiveness.js";
import { setTermDisabled } from "../../research-engine/searchBuilder/searchState.js";
import { splitTermInput, addTypedTerms } from "../../research-engine/searchBuilder/termEntry.js";
import { pendingSuggestions, suggestionCount, rejectionKey, resetSuggestionMemory } from "../../research-engine/searchBuilder/suggestionReview.js";
import { computeStageStatuses } from "../../research-engine/searchBuilder/stageStatus.js";
import {
  recordRemoveTerm, recordRemoveConcept, recordDisable, recordBulkAccept,
  recordReorderConcept, recordReorderTerm, recordMergeConcepts, recordSplitConcept,
  // 97.md (workstream B — plan §11): new undo kinds + the pure global-undo guard.
  recordMoveTerm, recordCopyTerm, recordCombineTokens, recordSplitPhrase, recordRegenerate,
  // 108.md §23 — `shouldHandleGlobalUndo` is no longer imported here: the typing
  // guard moved into the router's context (ctx.editableTarget), which is computed
  // by the same canonical predicate this module re-exports.
  recordRenameConcept, recordAddConcept, recordDupOverride,
  // 97 QA — per-editing-session term-edit undo (M13) + in-session restore undo (M11).
  recordEditTerm, recordRestore,
  undoLast, clear as clearUndo,
} from "../../research-engine/searchBuilder/undoStack.js";
// 108.md §23 — the central shortcut router replaces this file's document-level
// Ctrl/Cmd+Z listener (see the binding below for why the migration is mandatory).
import { useShortcut, TIER } from "../../frontend/shortcuts/ShortcutProvider.jsx";
import { isUndoChord, historyShortcutAllowed } from "../../research-engine/interaction/undoChords.js";
import { SCOPE_SEARCH } from "../../research-engine/interaction/projectScopes.js";
// 108 review §25 — this tab owns its own undo stack, so it must TELL the shared
// history provider that the 'search' scope is undoable (see the delegate below).
import { useProjectHistory } from "../../frontend/history/HistoryContext.jsx";
/* ── 97.md — pure state helpers from workstream B (plan §§8-13, ownership §22):
   the conservative exact-duplicate engine + dupOverride machinery, the term
   move/copy/combine/split ops (each returning ready-made undo info), and the
   Regenerate engine with the spec's exact confirmation copy. */
import {
  findExactDuplicateInConcept, termDuplicateKey,
  applyDupOverride as applyDupOverrideState, clearDupOverride as clearDupOverrideState,
} from "../../research-engine/searchBuilder/exactDuplicate.js";
import { moveTermToConcept, copyTerm as copyTermState, combineTokens as combineTokensState, splitPhrase as splitPhraseState, componentsMatchText } from "../../research-engine/searchBuilder/termOps.js";
import { buildRegenerateState, REGENERATE_CONFIRM_COPY, REGENERATE_DONE_MESSAGE, PRE_REGENERATE_SNAPSHOT_NAME } from "../../research-engine/searchBuilder/regenerate.js";
// 97 QA M4/M5/M28/M31 — the snapshot-then-regenerate transition, extracted so its
// ordering (flush → snapshot → apply; abort on failure) is functionally tested.
import { performRegenerate } from "./regenerateFlow.js";
// 97 QA H3 — the shared per-tab revision channel: single-key saves (searchMode,
// readyForScreening) ack through the same module and fast-forward our baseRevision.
import { onSearchSaved } from "./searchBuilderApi.js";
import { stampManualMeta } from "../../research-engine/searchBuilder/searchState.js";
// 97.md — U-owned pure presentation model (per-term duplicate signals) + the
// shared pointer-drag hook and its pure hit-testing helpers (unit-tested directly).
import { buildDupModel } from "./dupSignals.js";
import useChipDrag from "./dnd/useChipDrag.js";
import { combineSpanFromTokens, normalizeReorderIndex } from "./dnd/dndModel.js";
// 97.md Phase 4 — the pre-regeneration snapshot rides the existing version registry.
import { searchVersionsApi } from "../searchWizard/searchVersionsApi.js";
// 85.md A2 — extracted presentational leaves (SSR-contract-tested in searchBuilderUi.test.jsx).
// 98.md §9 — ConceptNavigator (master-detail pills) is RETIRED: the horizontal
// concept board renders every group as a card; cards are the drop surface now.
import ActiveConceptPanel from "./components/ActiveConceptPanel.jsx";
import TermChipRow from "./components/TermChipRow.jsx";
import TermEditorPopover from "./components/TermEditorPopover.jsx";
import AddTermBox from "./components/AddTermBox.jsx";
import SuggestionsDisclosure from "./components/SuggestionsDisclosure.jsx";
// 100.md §§6-11 — the read-only plain-language reading of the live strategy; it
// replaces StrategyPreviewPanel (retired) and the always-on database previews.
import SearchMeaningPanel from "./components/SearchMeaningPanel.jsx";
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

/* 100.md §11 — the one line under the "Exact database queries" disclosure. It names
   the two places a per-database query can actually be EDITED, so the read-only copy on
   the building screen never looks like a dead end. Mode-agnostic on purpose: the
   Database Strategies stage exists in manual mode, the run surface in automated. */
const TECHNICAL_HINT = "Read-only here. To edit one database's query, open Database Strategies (manual search) or the Automated Search run surface — an edited query stops syncing with your concepts until you revert it.";

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

/* ---- 98.md §12 — the LEGACY in-file syntax renderer is DELETED. It had drifted
   from the real compilers (Embase ':ab,ti' vs ':ti,ab'; per-field free-text
   grouping vs one clause per term), so the term-editor preview and the compiled
   panels could show DIFFERENT strings for the same term. Every preview now goes
   through compileStrategy — the ONE code path the compiled strategies use. ---- */

/* The term-editor syntax preview: a one-term strategy through the REAL compiler.
   Exported so the preview seam stays unit-pinned. */
export function renderTerm(term,dbId){
  if(!term||!String(term.text||"").trim()) return "";
  try{
    const res=compileStrategy({concepts:[{id:"preview",label:"",op:"AND",terms:[{...term,id:term.id||"preview",disabled:false}]}]},dbId);
    return (res&&res.query)||"";
  }catch{ return ""; }
}
/* The whole-concept preview (beginner "compiles to" hint) — same single source. */
function renderConcept(concept,dbId){
  if(!concept) return "";
  try{
    const res=compileStrategy({concepts:[{...concept,op:"AND"}]},dbId);
    return (res&&res.query)||"";
  }catch{ return ""; }
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
/* 85.md A2 — dismissible 3-line mental-model intro for the keyword workspace
   (localStorage 'sb-intro-dismissed'; InfoBox/Note callout recipe — no paragraph
   walls). 98.md §5 — Beginner-Mode content now: the parent renders it only when
   Beginner Mode is ON; the per-user dismiss stays as a collapse within that mode
   (turning Beginner Mode off and on again is the recovery path). */
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
  /* 100.md §3 — the vocabulary line now reports the TRANSLATION, not a mapped/unmapped
     tally against a thesaurus we may not even reach. Three honest cases:
       · this database indexes your vocabulary → "N searched as <system> subject headings"
       · it does not                           → "N searched as free text (no verified
                                                  <system> equivalent)" / "(no subject
                                                  headings in this database)"
     `approximate` is no longer ever set, so it is not spoken about. */
  const vocabLine=(()=>{
    const v=res.vocab;
    if(!v||!(v.mapped||v.fallback)) return null;
    const parts=[];
    if(v.mapped) parts.push(`${v.mapped} searched as ${v.system} subject heading${v.mapped===1?"":"s"}`);
    if(v.fallback) parts.push(`${v.fallback} searched as free text (${v.system==="none"?"no subject headings in this database":`no verified ${v.system} equivalent`})`);
    return `Subject terms: ${parts.join(" · ")}`;
  })();
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
/* (97.md Phase 7 — the visible "Search Quality Check" card, its severity glyphs and
   the sensitivity badge are REMOVED. Exact-duplicate detection moved onto the term
   chips (dupSignals); the useful non-blocking hints — empty group, literal Boolean
   operator — survive as quiet inline notices below.) */

/* 97.md Phase 4 — the Regenerate confirmation dialog (exact spec copy). Pure
   presentational + exported for SSR contract tests. Cancel leaves ALL state
   unchanged; Regenerate proceeds only after the pre-regeneration snapshot saved. */
export function RegenerateDialog({open,busy,error,onCancel,onConfirm}){
  if(!open) return null;
  return(
    <div data-testid="sb-regenerate-dialog" role="dialog" aria-modal="true" aria-label="Regenerate search strategy?"
      style={{position:"fixed",inset:0,zIndex:120,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.45)"}}>
      <div style={{background:C.card,border:`1px solid ${C.brd2}`,borderRadius:12,padding:"18px 20px",maxWidth:440,width:"calc(100vw - 48px)",boxShadow:"0 24px 64px var(--t-shadow)",fontFamily:SANS}}>
        {/* Exact spec copy — ONE source of truth (regenerate.REGENERATE_CONFIRM_COPY). */}
        <h3 style={{margin:"0 0 10px",fontSize:15,fontWeight:700,color:C.txt}}>{REGENERATE_CONFIRM_COPY.title}</h3>
        <p style={{margin:"0 0 10px",fontSize:12.5,color:C.txt2,lineHeight:1.6}}>
          {REGENERATE_CONFIRM_COPY.body}
        </p>
        <p style={{margin:"0 0 12px",fontSize:11,color:C.muted,lineHeight:1.55}}>
          A snapshot of your current workspace is saved to Versions first, so you can restore it at any time.
        </p>
        {error&&(
          <div role="alert" style={{background:`${alpha(C.red,"10")}`,border:`1px solid ${alpha(C.red,"55")}`,borderRadius:8,padding:"8px 10px",marginBottom:12,fontSize:11.5,color:C.red}}>
            {error}
          </div>
        )}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button type="button" autoFocus onClick={onCancel} disabled={!!busy} style={{...btn("ghost"),fontSize:12}}>{REGENERATE_CONFIRM_COPY.cancel}</button>
          <button type="button" onClick={onConfirm} disabled={!!busy} style={{...btn("primary"),fontSize:12,opacity:busy?0.7:1}}>
            {busy?"Regenerating…":REGENERATE_CONFIRM_COPY.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

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
export function QuestionPhraseCard({question,accent,isSelected,onTogglePhrase,onCombineSpan,onAddManual,onEditQuestion,readOnly,beginner}){
  const [manual,setManual]=useState("");
  const [anchorIdx,setAnchorIdx]=useState(null); // last plain-clicked token — the span anchor
  const tokens=useMemo(()=>tokenizeForSelection(question||""),[question]);
  const tokensRef=useRef(tokens); tokensRef.current=tokens;
  const hintId=useId();
  const tokenEls=useRef({});
  // A stale anchor must never span across a DIFFERENT question's tokens.
  useEffect(()=>{ setAnchorIdx(null); },[question]);
  /* 97.md Phase 6 — drag a token ONTO another token to combine the contiguous span
     between them into one phrase ("sodium-glucose cotransporter 2"). The merge
     target shows a DISTINCT ring and arms only after the hover threshold; Esc
     cancels. Shift-click span selection stays the keyboard alternative.
     QA M15 — the source sentence's word order is FIXED, so this tray is
     `mergeOnly`: the drag model never resolves an insert/reorder target here (no
     insertion line, no silent no-op drop) — the ONLY droppable target is another
     token (combine), and the whole token acts as its merge zone. Documented
     variation from the generic token-tray contract; term reorder lives on the
     group chips. */
  const drag=useChipDrag({
    disabled:!!readOnly,
    mergeOnly:true,
    getGeometry:()=>({
      chips:tokensRef.current.map((tok,i)=>{
        const el=tokenEls.current[i];
        if(!el||typeof el.getBoundingClientRect!=="function") return null;
        const r=el.getBoundingClientRect();
        return {id:i,groupId:"question",index:i,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom}};
      }).filter(Boolean),
      groups:[],newGroup:null,
    }),
    onDrop:(info,target)=>{
      if(target.kind==="merge"&&onCombineSpan) onCombineSpan(info.dragId,target.targetId);
    },
  });
  const dragTarget=drag.state&&drag.state.target;
  const addManual=()=>{ const v=manual.trim(); if(v){ onAddManual(v); setManual(""); } };
  const clickToken=(i,shiftKey)=>{
    if(drag.wasDragClick&&drag.wasDragClick()) return; // a drag just ended — not a click
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
    <div data-testid="sb-question-card" data-sb-collapse-exempt="true" style={{background:C.card,border:`1px solid ${C.brd}`,borderLeft:`3px solid ${accent}`,borderRadius:10,padding:"11px 13px",marginBottom:10}}>
      <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:6}}>
        <span style={{fontSize:12,fontWeight:700,color:C.txt}}>Research question</span>
        {beginner&&<span style={{fontSize:10.5,color:C.muted}}>click or drag the key ideas to build concept groups</span>}
        {onEditQuestion&&(
          /* 98.md §4 — opens the INLINE editor above this card (never navigates away). */
          <button type="button" onClick={onEditQuestion} data-testid="sb-edit-question"
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
            const isMergeTarget=!!(dragTarget&&dragTarget.kind==="merge"&&dragTarget.targetId===i);
            const isDragged=!!(drag.state&&drag.state.dragId===i);
            const handle=!readOnly?drag.handleFor(i):null;
            return(
              <span key={i} style={{position:"relative",display:"inline-block"}}> <button type="button" onClick={(e)=>clickToken(i,!!(e&&e.shiftKey))}
                onKeyDown={(e)=>{ if(e.key==="Enter"&&e.shiftKey){ e.preventDefault(); clickToken(i,true); } }}
                disabled={readOnly}
                ref={(el)=>{ tokenEls.current[i]=el; }}
                {...(handle||{})}
                title={sel?"Already a concept group — click to open it (or remove it while unchanged)"
                  :filler?"Common word — click if you really want a concept group from it; Shift-click selects the whole phrase up to here"
                  :"Click to create a concept group from this phrase; Shift-click (or drag onto) another word to combine the phrase between them"}
                aria-label={tok.text} aria-pressed={sel} aria-describedby={hintId} className="sbkw-token"
                style={{cursor:readOnly?"default":"pointer",fontFamily:SANS,fontSize:12.5,padding:"2px 8px",borderRadius:7,margin:"0 1px",
                  border:sel?`1px solid ${accent}`:filler?"1px dashed transparent":`1px ${tok.suggested?"solid":"dashed"} ${tok.suggested?alpha(accent,"66"):C.brd2}`,
                  background:sel?`${alpha(accent,"22")}`:tok.suggested?`${alpha(accent,"0c")}`:"transparent",
                  color:sel?C.txt:C.txt2,fontWeight:sel?600:400,fontStyle:filler&&!sel?"italic":"normal",
                  opacity:isDragged?0.45:1,
                  ...(isMergeTarget?{outline:`3px ${drag.state.armed?"solid":"dashed"} ${accent}`,outlineOffset:2}:{}),
                  ...((handle&&handle.style)||{})}}>
                {sel?"✓ ":""}{tok.text}{tok.kind==="phrase"&&!sel?<span style={{fontSize:8,opacity:.7,marginLeft:4}}>phrase</span>:null}
              </button>
              {isMergeTarget&&(()=>{
                const span=combineSpanFromTokens(tokens,drag.state.dragId,i);
                return(
                  <span data-testid="sb-token-merge-hint" aria-hidden="true" style={{position:"absolute",top:"calc(100% + 4px)",left:0,zIndex:60,whiteSpace:"nowrap",fontSize:9.5,fontWeight:700,color:C.accText,background:C.acc,borderRadius:5,padding:"2px 8px"}}>
                    {drag.state.armed?`Release to combine into “${span?span.text:tok.text}”`:"Hold to combine…"}
                  </span>
                );
              })()}
              {" "}</span>
            );
          })}
        </div>
        {/* 98.md §5 — the hint is beginner guidance visually, but stays in the DOM
            (visually hidden otherwise) so aria-describedby keeps working for SR users. */}
        <div id={hintId} data-testid="sb-span-hint" style={beginner?{fontSize:10,color:C.muted,marginTop:6}
          :{position:"absolute",width:1,height:1,padding:0,margin:-1,overflow:"hidden",clip:"rect(0 0 0 0)",whiteSpace:"nowrap",border:0}}>
          Click a word to create a concept group. Shift-click another word — or drag one word onto another — to combine the whole phrase between them.
        </div>
        </>
      ):(
        <div style={{fontSize:11.5,color:C.muted,fontStyle:"italic",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          {/* 98.md §3/§4 — the standalone question stage is gone; the inline editor is the home. */}
          <span>No research question yet.</span>
          {onEditQuestion&&!readOnly&&(
            <button type="button" onClick={onEditQuestion} data-testid="sb-add-question"
              style={{...btn("primary"),fontSize:11,fontStyle:"normal"}}>Write your research question</button>
          )}
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

/* 97.md Phase 5 (QA M9) — read-only SOURCE sections for the protocol's PICO text.
   Shown below the research-question card whenever the project carries structured
   P/I/C/O text, so users can see which text came from Population / Intervention /
   Comparator / Outcomes. Tokens are clickable exactly like question tokens (each
   click creates/opens a search group), but these sections are pure SOURCE
   reference — they never control the workspace's organization (Phase 8: no forced
   PICO cards) and PICO edits never mutate groups. Absent/blank PICO (every new
   project) renders nothing. Presentational + exported for SSR contract tests. */
export const PICO_SOURCE_ROWS = [
  ["P", "Population"], ["I", "Intervention"], ["C", "Comparator"], ["O", "Outcomes"],
];
export function PicoSourceSections({ pico, accent, isSelected, onTogglePhrase, readOnly }) {
  const rows = PICO_SOURCE_ROWS
    .map(([key, label]) => ({ key, label, text: String((pico && pico[key]) || "").trim() }))
    .filter((r) => r.text);
  if (!rows.length) return null;
  return (
    // 99.md review — collapse-exempt for the same reason as the question card: these
    // tokens run the SAME togglePhrase handler, so they create/open/remove concepts.
    // Without it, removing a phrase-only concept via a PICO token collapsed the whole
    // board while the identical research-question token left it alone.
    <div data-testid="sb-pico-sources" data-sb-collapse-exempt="true" style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: "10px 13px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.txt }}>Protocol PICO — source text</span>
        <span style={{ fontSize: 10, color: C.muted }}>
          reference only — click an idea to add a concept group; these fields never reorganize your concepts
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.key} data-testid={`sb-pico-source-${r.key}`} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "3px 0" }}>
          <span style={{ flexShrink: 0, width: 86, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: C.muted }}>{r.label}</span>
          <span style={{ lineHeight: 1.9, minWidth: 0 }}>
            {tokenizeForSelection(r.text).map((tok, i) => {
              const sel = isSelected ? isSelected(tok.text) : false;
              const filler = tok.kind === "filler";
              return (
                <button key={i} type="button" disabled={!!readOnly}
                  onClick={() => { if (!readOnly && onTogglePhrase) onTogglePhrase(tok.text); }}
                  aria-label={tok.text} aria-pressed={sel} className="sbkw-token"
                  title={sel ? "Already a concept group — click to open it (or remove it while unchanged)"
                    : `Click to create a concept group from this ${r.label} phrase`}
                  style={{ cursor: readOnly ? "default" : "pointer", fontFamily: SANS, fontSize: 11.5, padding: "1px 7px", borderRadius: 6, margin: "0 1px",
                    border: sel ? `1px solid ${accent}` : "1px dashed transparent",
                    background: sel ? `${alpha(accent, "22")}` : "transparent",
                    color: sel ? C.txt : C.txt2, fontWeight: sel ? 600 : 400, fontStyle: filler && !sel ? "italic" : "normal" }}>
                  {sel ? "✓ " : ""}{tok.text}
                </button>
              );
            })}
          </span>
        </div>
      ))}
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
    <div data-testid="sb-drift-banner" data-sb-collapse-exempt="true" role="status"
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
     pico        object   — `pico.question` is a fallback when `question` is
                            absent; 97 QA M9: the structured P/I/C/O text is
                            additionally DISPLAYED as read-only source sections
                            (PicoSourceSections) — it is never read as a
                            generation/organization input.
     api         object   — INTEGRATION: { meshLookup(text), pubmedCount(query) }
     loadSearch  func     — INTEGRATION: async (projectId) => savedState|null
     saveSearch  func     — INTEGRATION: async (projectId, state) => void
   ════════════════════════════════════════════════════════════════════════════ */
export default function SearchBuilderTab({projectId,question:questionProp,pico,api,loadSearch,saveSearch,phase,onLiveQuery,onHitState,onRegisterHitRefresh,onGoToStage,onStats,onVersionsChanged,onRegisterAfterRestore,readOnly,visible=true,questionEditing=false,onEditQuestion=null}){
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
  // 98.md §5 — Beginner Mode is ENGINE-WIDE now: the value comes from the shared
  // provider mounted by SearchWorkspace (header toggle), same localStorage key
  // 'sb-beginner'. Standalone/test mounts degrade to a local toggle (same hook).
  // The default flipped OFF per 98.md §5 — the default experience is the focused
  // professional tool; explanations reveal when Beginner Mode is turned on.
  const { beginner }=useBeginnerMode();
  // SB3 — guided stepper position (1..5) and the selected databases / handoff marker.
  // selectedDbs [] means "use the catalogue defaults"; it is only written once the
  // user changes the selection, so existing projects don't trigger a spurious save.
  const [selectedDbs,setSelectedDbs]=useState([]);
  const [readyForScreening,setReadyForScreening]=useState(false);
  const [dismissedWarnings,setDismissedWarnings]=useState([]); // SB4 — Search-Quality warnings the user kept anyway
  const [exportMsg,setExportMsg]=useState(""); // transient copy/export feedback
  const [showPlainMirror,setShowPlainMirror]=useState(false); // 73.md P6 — strategy-level plain-English mirror toggle
  const [suggOpen,setSuggOpen]=useState({}); // 98.md §11 — per-concept "Show suggestions" visibility (session-scoped; hidden by default)
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
  /* 99.md — EXPLICIT board collapse, deliberately a SEPARATE atom from
     activeConceptId: a null id means "no explicit choice" and falls back to
     concepts[0] (the 98.md H14 keyboard contract plus every legacy flow — load,
     remote adoption, version restore, undo — depends on that fallback), while
     boardCollapsed=true means the USER collapsed the expanded card (outside
     click / Escape / chevron) and every card renders compact until the next
     explicit activation. Session-only UI state: never persisted, reset when the
     project switches or the user leaves the terms phase. */
  const [boardCollapsed,setBoardCollapsed]=useState(false);
  /* ── 97.md additions ─────────────────────────────────────────────────────── */
  // Plan §8 — the ONE new top-level persisted key: generation/modification metadata
  // { generatedAt, generatedBy, sourceQuestion, manuallyModifiedAt, manuallyModifiedBy }.
  // Omit-when-empty: null here ⇒ the key is omitted from the PUT payload entirely.
  const [meta,setMeta]=useState(null);
  const metaRef=useRef(meta); metaRef.current=meta;
  // Stamp "manually modified" alongside every manual mutation (the same code paths
  // that push undo entries — plus, QA M6: term-edit commits, manual database-
  // strategy overrides, hidden-term restores and content undos). The client is
  // identity-free: `manuallyModifiedBy` IS stamped server-side from the session
  // (putSearch stampMetaIdentity, QA M3) and echoed back into local state on ack.
  const touchMeta=useCallback(()=>{
    setMeta(m=>stampManualMeta(m,undefined,new Date().toISOString())||null);
  },[]);
  // Phase 12 — blocked-duplicate notice { text, cid, tid } (+ Find existing term).
  const [blockedNotice,setBlockedNotice]=useState(null);
  // "Find other duplicate" / "Find existing term" — imperative chip focus request.
  const [focusTerm,setFocusTerm]=useState(null); // { cid, tid }
  // Phase 16 — a stale write was rejected and the fresher server doc was adopted.
  const [conflictNotice,setConflictNotice]=useState(false);
  // Phase 4 — Regenerate dialog state.
  const [regenOpen,setRegenOpen]=useState(false);
  const [regenBusy,setRegenBusy]=useState(false);
  const [regenError,setRegenError]=useState('');
  // 96.md D13.3 — group-management UI state (terms phase): inline delete confirm,
  // the merge-target picker, and the split panel's draft {cid, selected:{tid:true}, label}.
  const [confirmDeleteId,setConfirmDeleteId]=useState(null);
  // 99.md review (a11y) — one-shot guard so the delete-confirm's Cancel button
  // takes focus when the row OPENS without stealing it on every re-render.
  const confirmFocusRef=useRef(null);
  // …and back to "× Delete concept" when the confirm is cancelled (it is unmounted
  // by the swap, so focus would otherwise fall to <body>).
  const restoreDeleteFocusRef=useRef(false);
  const [mergeOpen,setMergeOpen]=useState(false);
  const [splitDraft,setSplitDraft]=useState(null);
  // Group UI state follows the active concept (stale pickers never linger).
  useEffect(()=>{ setConfirmDeleteId(null); setMergeOpen(false); setSplitDraft(null); },[activeConceptId]);
  // Re-arm the confirm's one-shot focus each time the row closes.
  useEffect(()=>{ if(!confirmDeleteId) confirmFocusRef.current=null; },[confirmDeleteId]);
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
      // 97.md Phase 15 — convert legacy PICO scaffold labels to neutral
      // "Search Group N" names ONCE (idempotent: the per-concept labelMigrated
      // marker makes re-loads a no-op; user-renamed labels are preserved and
      // `picoField` is RETAINED for the drift/QC/timeframe exemptions).
      // lastSavedRef below is computed from the RAW server doc, so a conversion
      // dirties the persisted signature exactly once and the autosave persists it.
      setConcepts(migrateLegacyGroupLabels(base));
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
      // 97.md plan §8 — generation/modification metadata (absent on pre-97 saves).
      setMeta(saved.meta&&typeof saved.meta==="object"?saved.meta:null);
      // Record what the server actually holds so autosave is a no-op until a real edit.
      lastSavedRef.current=serializeSearchState(saved);
      revisionRef.current=typeof saved.revision==="number"?saved.revision:0;
    } else {
      // GET null (revision 0) → seed EMPTY from the question (96.md D2).
      // 98.md §6 — LAZY seed: no database record is created before the user acts.
      // lastSavedRef is primed with the seeded state's signature, so the autosave
      // sees NO diff on bare open (the pre-98 `lastSavedRef=''` fired a PUT ~800ms
      // after first open, flipping project-overview Search to 'partial' with zero
      // user action). The questionSnapshot needs no early persist either —
      // stampSnapshotIfEmpty re-stamps it on the first real interaction, and the
      // first genuine edit changes the signature and saves everything together.
      const seeded=seedStateFromQuestion(question);
      setConcepts([]);
      setQuestionSnapshot(seeded.questionSnapshot);
      setMeta(null);
      lastSavedRef.current=serializeSearchState({
        concepts:[],overrides:{},ignored:[],databases:[],readyForScreening:false,
        dismissedWarnings:[],filters:{dateFrom:"",dateTo:"",languages:[],pubTypes:[]},
        rejectedSuggestions:[],questionSnapshot:seeded.questionSnapshot,
      });
      // 98.md review (H1) — a CONCEPTS-LESS module row can legitimately exist: the
      // workspace's single-key {searchMode}/{readyForScreening} PUTs create the row
      // before the builder ever saves concepts (reachable since the lazy seed —
      // pre-98 the seed-save always created concepts:[] first). Hardcoding
      // revision 0 here made every later full-state save stamp baseRevision:0
      // against server revision ≥1 → a permanent CAS-409 dead-loop that lost the
      // whole session's strategy. Adopt the server revision so the first real
      // save passes CAS and shallow-merges concepts into the existing row.
      revisionRef.current=(saved&&typeof saved.revision==="number")?saved.revision:0;
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
  // 97 QA H1/H3/M27 — ref mirrors for the async save machinery (no stale closures).
  const readOnlyRef=useRef(readOnly); readOnlyRef.current=readOnly;
  const readyRef=useRef(readyForScreening); readyRef.current=readyForScreening;
  const busyEditingRef=useRef(false); // assigned below where busyEditing is derived
  // 97 QA H1 — saves are SERIALIZED through one promise chain: a second doSave can
  // never race the first one's ack (the +800ms duplicate timer used to replay a
  // FROZEN baseRevision and self-inflict a 409 right after Regenerate).
  const saveChainRef=useRef(Promise.resolve());
  const doSave=useCallback((sig,payload)=>{
    const run=async()=>{
      if(!saveSearch||!projectId||readOnlyRef.current) return false; // M27 — viewers never PUT
      // H1 — dedupe: an identical save already ACKED (e.g. the debounced timer
      // firing after saveImmediate landed the same content) is a clean no-op.
      if(sig===lastSavedRef.current){
        if(pendingSaveRef.current&&pendingSaveRef.current.sig===sig) pendingSaveRef.current=null;
        if(saveStateRef.current!=='saved'){ setSaveState('saved'); saveStateRef.current='saved'; }
        return true;
      }
      setSaveState('saving'); saveStateRef.current='saving';
      for(let attempt=0;attempt<2;attempt++){
        try{
          // H1/H3 — baseRevision is read AT SEND TIME, never frozen at schedule:
          // revisionRef advances on every ack — our own saves, the workspace's
          // single-key saves (shared onSearchSaved channel) and restore adoption.
          const res=await saveSearch(projectId,{...payload,baseRevision:revisionRef.current});
          if(!res) throw new Error('save rejected');
          lastSavedRef.current=sig;
          if(typeof res.revision==="number") revisionRef.current=res.revision;
          // QA M3 — adopt the server's identity-stamped meta echo (generatedBy /
          // manuallyModifiedBy are stamped from the session server-side), so the
          // local doc + signature stay byte-identical to the stored one. Skipped
          // when meta moved again mid-flight — the next save carries it.
          if(res&&Object.prototype.hasOwnProperty.call(res,'meta')
            &&metaRef.current===(Object.prototype.hasOwnProperty.call(payload,'meta')?payload.meta:null)){
            const echoed=res.meta&&typeof res.meta==='object'&&Object.keys(res.meta).length?res.meta:null;
            lastSavedRef.current=serializeSearchState({...payload,readyForScreening:readyRef.current,meta:echoed||undefined});
            setMeta(echoed);
          }
          if(pendingSaveRef.current&&pendingSaveRef.current.sig===sig) pendingSaveRef.current=null;
          setSaveState('saved'); saveStateRef.current='saved';
          return true;
        }catch(e){
          console.error("saveSearch failed",e);
          // 97.md Phase 16 — a rejected write may be a STALE revision (server-side
          // CAS on baseRevision). Reconcile instead of a dead Retry loop:
          let fresh=null;
          try{ if(loadSearch&&projectId) fresh=await loadSearch(projectId); }
          catch{/* reconcile is best-effort */}
          // 98.md review (H1) — a CONCEPTS-LESS doc means the newer revision came
          // from a single-key writer (searchMode / readyForScreening): by
          // construction it changed NO strategy content, so it is always the H3
          // envelope-bump case — fast-forward and resend, never adopt (coercing it
          // to concepts:[] would wipe the user's in-flight strategy as a phantom
          // "collaborator update").
          if(fresh&&typeof fresh.revision==="number"&&fresh.revision>revisionRef.current&&!Array.isArray(fresh.concepts)){
            revisionRef.current=fresh.revision;
            continue;
          }
          if(fresh&&Array.isArray(fresh.concepts)&&typeof fresh.revision==="number"&&fresh.revision>revisionRef.current){
            if(serializeSearchState(fresh)===lastSavedRef.current){
              // H3 — the newer revision holds EXACTLY the content we last knew:
              // another writer in this tab (search-mode / ready toggle) only
              // bumped the envelope. Fast-forward and resend the pending edit —
              // nothing is dropped, no false "collaborator" notice.
              revisionRef.current=fresh.revision;
              continue;
            }
            // Genuinely newer content. M7/H3 — honor the SAME defer-while-editing
            // rule pullRemote applies: never adopt over an open editor/draft. The
            // conflict notice still arms so the user learns (once the parked doc
            // is adopted) that their unsaved change needs re-applying.
            if(busyEditingRef.current){
              pendingRemoteRef.current=fresh; setRemotePending(true);
              setConflictNotice(true);
              setSaveState('error'); saveStateRef.current='error'; // pending payload kept for an explicit Retry
              return false;
            }
            applyRemote(fresh);
            setConflictNotice(true);
            return false;
          }
          setSaveState('error'); saveStateRef.current='error'; // pendingSaveRef keeps the payload for Retry
          return false;
        }
      }
      setSaveState('error'); saveStateRef.current='error';
      return false;
    };
    const p=saveChainRef.current.then(run,run);
    saveChainRef.current=p.then(()=>{},()=>{});
    return p;
  },[saveSearch,projectId,loadSearch]); // eslint-disable-line
  // Immediate save (Retry button / unmount flush) — bypasses the 800ms debounce.
  // Returns the save promise (false when nothing was pending needs no save).
  const saveNow=useCallback(()=>{
    clearTimeout(saveTimer.current);
    const p=pendingSaveRef.current;
    return p?doSave(p.sig,p.payload):Promise.resolve(true);
  },[doSave]);
  // 97 QA H3 — fast-forward our known revision whenever ANY writer in this tab
  // (the workspace's single-key searchMode / readyForScreening saves included)
  // receives a save ack for this project. The poke channel excludes the acting
  // user, so without this the builder's next full save 409'd against the user's
  // own single-key write and discarded their edit.
  useEffect(()=>{
    if(!projectId) return undefined;
    return onSearchSaved(({projectId:pid,revision})=>{
      if(pid===projectId&&typeof revision==="number"&&revision>revisionRef.current){
        revisionRef.current=revision;
      }
    });
  },[projectId]);
  useEffect(()=>{
    if(!loaded||!saveSearch||!projectId) return;
    if(readOnly) return; // 97 QA M27 — read-only viewers never autosave (the label
    // migration stays an IN-MEMORY display conversion for them; a PUT would 403
    // forever and pin a spurious failed-save indicator).
    // 97.md — `meta` rides the signature + payload (omit-when-empty: null ⇒ absent).
    const sig=serializeSearchState({concepts,overrides,ignored,databases:selectedDbs,readyForScreening,dismissedWarnings,filters,rejectedSuggestions,questionSnapshot,...(meta?{meta}:{})});
    if(sig===lastSavedRef.current){
      pendingSaveRef.current=null; // unchanged vs the server → no PUT, no ping-pong
      // review-round #7 — an edit REVERTED inside the 800ms window (snackbar Undo,
      // re-typing the old value) cancels the pending PUT; the indicator must not
      // stay "Saving…" forever for a save that will never fire.
      if(saveStateRef.current==='saving'){ setSaveState('saved'); saveStateRef.current='saved'; }
      return;
    }
    setRemoteUpdatedBy(null); // this user is now editing → drop the "updated by collaborator" attribution
    // 97.md Phase 16 — full-state PUTs carry `baseRevision` as an ENVELOPE key so
    // the server rejects stale writes instead of LWW-clobbering; QA H1 — it is
    // stamped inside doSave AT SEND TIME (a frozen schedule-time copy self-409'd).
    const payload={concepts,overrides,ignored,databases:selectedDbs,dismissedWarnings,filters,rejectedSuggestions,questionSnapshot,...(meta?{meta}:{})};
    pendingSaveRef.current={sig,payload};
    setSaveState('saving'); saveStateRef.current='saving';
    clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>doSave(sig,payload),800);
    return ()=>clearTimeout(saveTimer.current);
  },[concepts,overrides,ignored,selectedDbs,readyForScreening,dismissedWarnings,filters,rejectedSuggestions,questionSnapshot,meta,loaded,readOnly]); // eslint-disable-line
  // Unmount flush — if a debounced save is still pending, fire it immediately so
  // leaving the Search tab inside the 800ms window can never lose the last edit.
  useEffect(()=>()=>{
    clearTimeout(saveTimer.current);
    const p=pendingSaveRef.current;
    if(p&&p.sig!==lastSavedRef.current&&saveStateRef.current!=='error'&&!readOnlyRef.current){
      // fire-and-forget: the component is gone; the server ack just lands.
      doSave(p.sig,p.payload);
    }
  },[doSave]);
  // 98.md §15 — TAB-CLOSE flush: SPA unmount never fires on window close, and
  // Safari has no reliable beforeunload, so a close inside the 800ms debounce
  // silently dropped the last edit in every browser. pagehide (the event Safari
  // DOES fire reliably on close/navigate — deliberately NOT visibilitychange,
  // which also fires on every tab switch and would bypass the CAS envelope for
  // no reason) sends the pending PUT with fetch keepalive so it survives page
  // teardown. baseRevision is deliberately NOT stamped here — doSave's CAS
  // envelope needs its ack round-trip; the teardown write goes through
  // saveSearch directly (last-writer-wins is correct for the same user's own
  // final keystrokes at window close).
  useEffect(()=>{
    if(typeof window==='undefined'||readOnly) return undefined;
    const flushKeepalive=()=>{
      const p=pendingSaveRef.current;
      if(!p||p.sig===lastSavedRef.current||saveStateRef.current==='error'||readOnlyRef.current) return;
      clearTimeout(saveTimer.current);
      // 98.md review (M2) — the teardown write carries the SAME CAS envelope as
      // doSave: without baseRevision the server treats it as deliberate
      // last-writer-wins and a closing tab's full STALE document could silently
      // erase a collaborator's just-landed revision. With the stamp, a stale
      // teardown write 409s and is simply dropped — worst case loses the closing
      // user's final debounce window (the pre-98 status quo), never someone
      // else's landed work.
      try{ saveSearch(projectId,{...p.payload,baseRevision:revisionRef.current},{keepalive:true}); }catch{/* teardown best-effort */}
    };
    // 98.md review (M3/L21) — bfcache RESTORE: pagehide fired (possibly flushing
    // via keepalive) but the page came back. Re-arm the pending save through the
    // normal doSave chain: if the keepalive PUT landed, its ack already published
    // through onSearchSaved (fast-forwarding revisionRef) and the resend is a
    // CAS-safe no-op-diff; if it never landed, this recovers the edit instead of
    // leaving the indicator stuck on "Saving…" forever. Never optimistically mark
    // 'saved' at flush time — a failed keepalive would then silently drop the edit.
    const onPageShow=(ev)=>{
      if(!ev||!ev.persisted) return;
      const p=pendingSaveRef.current;
      if(!p||readOnlyRef.current) return;
      clearTimeout(saveTimer.current);
      saveTimer.current=setTimeout(()=>doSave(p.sig,p.payload),0);
    };
    window.addEventListener('pagehide',flushKeepalive);
    window.addEventListener('pageshow',onPageShow);
    return ()=>{ window.removeEventListener('pagehide',flushKeepalive); window.removeEventListener('pageshow',onPageShow); };
  },[projectId,readOnly,saveSearch,doSave]);

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
    setMeta((persisted.meta&&typeof persisted.meta==="object")?persisted.meta:(saved.meta&&typeof saved.meta==="object"?saved.meta:null)); // 97.md plan §8
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
  busyEditingRef.current=busyEditing; // QA H3/M7 — the 409 reconcile honors the same defer rule
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

  /* ── 97 QA M7/M11 — version restore, for the ACTING user. The server's realtime
     poke deliberately excludes the actor, so their mounted builder kept rendering
     the PRE-restore workspace and the next edit self-409'd into a false
     "collaborator updated" notice. The workspace threads the versions panel's
     onAfterRestore here: refetch + adopt the restored document immediately AND
     record a whole-state `restore` undo entry against the pre-restore state, so
     the restore itself is undoable in-session (Phase 6 "Restore"). The stack is
     cleared first (older entries reference the pre-restore document — the
     standard cross-document rule); the restore entry alone rides on top. ── */
  const handleAfterRestore=useCallback(async()=>{
    if(!loadSearch||!projectId) return;
    let saved=null;
    try{ saved=await loadSearch(projectId); }catch{ return; }
    if(!saved||!Array.isArray(saved.concepts)) return;
    const prev={concepts:conceptsRef.current,meta:metaRef.current,questionSnapshot:questionSnapshotRef.current};
    applyRemote(saved); // adopts + fast-forwards revisionRef (no self-409 later)
    setUndoStack(recordRestore(clearUndo(),{prev}));
    setUndoMsg('Version restored.');
    announce('Version restored — the workspace now shows the restored strategy. Undo brings back what you had before.');
  },[projectId,loadSearch]); // eslint-disable-line
  useEffect(()=>{
    if(typeof onRegisterAfterRestore==="function") onRegisterAfterRestore(handleAfterRestore);
  },[onRegisterAfterRestore,handleAfterRestore]);

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
    touchMeta(); // QA M6 — re-adding a hidden term is a manual modification
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
    touchMeta(); // QA M6 — restoring hidden terms is a manual modification
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
    // 98.md §19 — STALE-RESPONSE GUARD: the lookup was fired for the term's text
    // AT CALL TIME; if the user edits the term again before the response lands,
    // attaching the old text's vocab would silently make the chip search the
    // WRONG heading. Every apply below re-checks the term still carries the
    // looked-up text (same race-guard pattern as the pubHash count machine).
    const askedText=String(text||"").trim().toLowerCase();
    const stillCurrent=()=>{
      const c=conceptsRef.current.find(x=>x&&x.id===cid);
      const t=c&&(c.terms||[]).find(x=>x&&x.id===tid);
      return !!t&&String(t.text||"").trim().toLowerCase()===askedText;
    };
    try{
      const v=await A.meshLookup(text);
      if(!stillCurrent()) return; // superseded by a newer edit — drop silently
      if(v){
        if(v.source!=="live"&&v.source!=="live-nlm") setLimitedMode(true);
        setConcepts(cs=>cs.map(c=>c.id===cid?{...c,terms:c.terms.map(t=>t.id===tid?{...t,vocab:v,type:forceControlled?"controlled":(t.type==="controlled"?"controlled":t.type)}:t)}:c));
      } else if(forceControlled){
        setConcepts(cs=>cs.map(c=>c.id===cid?{...c,terms:c.terms.map(t=>t.id===tid?{...t,type:"controlled",vocab:null}:t)}:c));
      } else {
        // 97 QA M12/M24 — an edited MeSH label that no longer matches ANY heading
        // must not silently keep the stale descriptor (the chip and every compiled
        // query would keep searching the OLD heading while the visible text
        // differs). Clear the vocab so the term enters the explicit UNMATCHED
        // state: the chip drops its [MeSH] form, shows "no MeSH match — will not
        // match", compiles as plain free text, and the editor offers the one-click
        // "Convert to free text" action. Freetext terms are untouched (a best-
        // effort lookup miss must not strip an existing informational vocab).
        setConcepts(cs=>cs.map(c=>c.id===cid?{...c,terms:c.terms.map(t=>(t.id===tid&&t.type==="controlled"&&t.vocab)?{...t,vocab:null}:t)}:c));
      }
    }catch(e){
      setLimitedMode(true);
      // fall back to offline core
      const v=await defaultApi.meshLookup(text);
      if(!stillCurrent()) return; // 98.md §19 — same guard on the fallback path
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
    // workspace can never disagree about what "≈ N records" refers to.
    // 98.md §12 — the renderSearch catch-fallback is gone with the legacy
    // renderer (compileStrategy never throws — compilers/index.js contract).
    return compileStrategy({concepts,filters},"pubmed",{applyOverride:false}).query;
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
    touchMeta();
    if(editing&&editing.termId===tid) setEditing(null);
  };
  // 97.md Phase 8 — new groups get NEUTRAL default names ("Search Group N").
  // QA M10 — "Create group" is a required Phase-6 undo action: record the entry
  // (the empty group vanishes on undo; terms added later keep it alive).
  const addConcept=()=>{
    const cid=uid();
    const label=`Concept ${conceptsRef.current.length+1}`;
    touchMeta();
    setConcepts(cs=>[...cs,{id:cid,label,op:"AND",source:"user_added",terms:[]}]);
    // 98.md review (H14) — the new concept opens as the ACTIVE card immediately
    // (matching every other creation path): its add-term box is focusable, so a
    // keyboard user is never stranded on an empty compact card with no
    // activatable control. (99.md — activatePlain also clears an explicit
    // collapse: creating a concept always opens it.)
    activatePlain(cid);
    setUndoStack(st=>recordAddConcept(st,{conceptId:cid,label}));
    setUndoMsg(`Created concept “${label}”`);
  };
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
    touchMeta();
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
    touchMeta();
  };
  /* 85.md A2 + 97.md — the Undo entry point (snackbar button AND the global
     Ctrl/Cmd+Z below). Reads through refs so the document-level key handler never
     sees a stale stack. 97.md whole-state kinds (regenerate/restore) also restore
     `meta` + `questionSnapshot` when the entry carries them. */
  const undoStackRef=useRef(undoStack); undoStackRef.current=undoStack;
  const undoLastAction=useCallback(()=>{
    const r=undoLast(undoStackRef.current,{
      concepts:conceptsRef.current,ignored:ignoredRef.current,
      meta:metaRef.current,questionSnapshot:questionSnapshotRef.current,
    });
    if(!r) return;
    const metaRestored='meta' in r.state&&r.state.meta!==metaRef.current;
    setConcepts(r.state.concepts);
    setIgnored(r.state.ignored);
    if(metaRestored) setMeta(r.state.meta||null);
    if(typeof r.state.questionSnapshot==="string"&&r.state.questionSnapshot!==questionSnapshotRef.current) setQuestionSnapshot(r.state.questionSnapshot);
    setUndoStack(r.stack);
    // 97 QA M6 — undoing an action IS a manual modification (Phase 3 list); the
    // whole-state kinds (regenerate/restore) set meta themselves, and a no-op
    // undo (vanished target — empty description) must not dirty the signature.
    if(!metaRestored&&r.description) touchMeta();
    // 97 QA M16 — a VISIBLE toast describes what was undone (plain: no Undo
    // button — redo does not exist), alongside the aria-live announcement.
    setUndoMsg(r.description?{text:r.description,plain:true}:null);
    announce(r.description||'Undone');
  },[]); // eslint-disable-line

  /* ── 97.md Phase 6 · 108.md §23 — keyboard undo: Ctrl+Z / Cmd+Z.
     MIGRATED from a bare `document.addEventListener("keydown")` into the central
     router (frontend/shortcuts/ShortcutProvider). That migration is mandatory, not
     cosmetic: document-BUBBLE runs before window-bubble, so the old listener would
     have permanently shadowed the router's global undo on every search page.

     Same semantics, now declared instead of hand-rolled:
       · mount gate  → `when`: embedded && visible && !readOnly, plus the page scope
                       (the router keys history per page — 108.md §3);
       · typing guard→ ctx.editableTarget, computed by the SAME predicate
                       `shouldHandleGlobalUndo` delegates to (interaction/
                       editableTarget.js), read through frontend/shortcuts/
                       domTarget.js so the role still comes from getAttribute('role');
       · chord       → isUndoChord rejects Shift and Alt exactly as before;
       · preventDefault → the adapter calls it only on a truthy `run()` return, so a
                       press with an empty stack leaves the browser alone (§26).

     REDO IS NOT OFFERED HERE (undoChords.SEARCH_SCOPE_REDO): undoStack.js records
     inverse patches only and never the forward patch, so there is nothing to
     replay. No redo binding is registered for this scope, the global one finds an
     empty redo stack and declines, and Ctrl/Cmd+Shift+Z stays with the browser. */
  const undoAvailable=undoStack.length>0;
  useShortcut({
    id:'searchBuilder.undo',
    tier:TIER.ENGINE,
    // 109.md §15 — descriptive metadata for the read-only Ops shortcut inventory.
    chord:'Ctrl/Cmd + Z', label:'Undo the last strategy change', scopeLabel:'Search Builder',
    match:isUndoChord,
    when:(ctx)=>embedded&&visible&&!readOnly&&undoAvailable
      &&(!ctx.scope||ctx.scope===SCOPE_SEARCH)&&historyShortcutAllowed(ctx),
    run:()=>{ undoLastAction(); return true; },
  },[]);

  /* 108 review §25 — …and the SAME availability, published to the shared history
     provider so the header's Undo/Redo pair is not the one visible control that
     lies. Nothing is ever recorded into the provider's 'search' stack (this stack
     is the source of truth), so `counts()` said canUndo:false and the button sat
     permanently greyed out while Ctrl+Z worked — 108.md §25 forbids exactly that
     ("do not make important functionality exclusively dependent on keyboard").

     The delegate is a VALUE: re-registered whenever the gate flips, which is what
     re-renders the header. It carries no `redo` on purpose — undoStack.js records
     inverse patches only, so there is nothing to replay (see the note above), and
     the header's Redo stays honestly disabled. The keyboard path is unchanged: the
     ENGINE binding above outranks the provider's GLOBAL one, so Ctrl+Z still lands
     here directly and never round-trips through the delegate. */
  const searchUndoDelegate=embedded&&visible&&!readOnly&&undoAvailable;
  const registerScopeDelegate=useProjectHistory().registerScopeDelegate;
  useEffect(()=>registerScopeDelegate(SCOPE_SEARCH,{
    canUndo:searchUndoDelegate,
    undo:()=>{ undoLastAction(); },
  }),[registerScopeDelegate,searchUndoDelegate,undoLastAction]);

  /* ── 97 QA M13 — TERM-EDIT undo: ONE entry per editing session (the rename
     pattern). The pre-edit term object is snapshotted when the editor popover
     opens; when the session ends (close / switch to another chip) a CHANGED term
     records one `editTerm` inverse and stamps the manual-modification meta
     (QA M6 — "Editing a term" is a Phase-3 manual action). Fields managed by
     their own undoable actions (disabled, dupOverride) are excluded from the
     diff so those actions never double-record. ── */
  const editSessionRef=useRef(null); // { cid, tid, term } | null
  const commitTermEditSession=useCallback(()=>{
    const base=editSessionRef.current;
    if(!base) return;
    editSessionRef.current=null;
    const c=conceptsRef.current.find(x=>x&&x.id===base.cid);
    const now=c&&(c.terms||[]).find(x=>x&&x.id===base.tid);
    if(!now) return; // removed / combined / split — those paths record their own undo
    const KEYS=['text','type','field','truncate','noExplode','phrase','vocab'];
    const changed=KEYS.some(k=>{
      if(base.term[k]===now[k]) return false;
      try{ return JSON.stringify(base.term[k]??null)!==JSON.stringify(now[k]??null); }catch{ return true; }
    });
    if(!changed) return;
    touchMeta();
    setUndoStack(st=>recordEditTerm(st,{conceptId:base.cid,term:base.term}));
    setUndoMsg(`Edited “${String(now.text||base.term.text||'term')}”`);
  },[touchMeta]);
  useEffect(()=>{
    const cur=editing&&editing.conceptId&&editing.termId?{cid:editing.conceptId,tid:editing.termId}:null;
    const prev=editSessionRef.current;
    if(prev&&(!cur||cur.tid!==prev.tid||cur.cid!==prev.cid)) commitTermEditSession();
    if(cur&&!editSessionRef.current){
      const c=conceptsRef.current.find(x=>x&&x.id===cur.cid);
      const t=c&&(c.terms||[]).find(x=>x&&x.id===cur.tid);
      editSessionRef.current=t?{cid:cur.cid,tid:cur.tid,term:t}:null;
    }
  },[editing,commitTermEditSession]);
  /* prompt42 Task 3 — add a picked suggestion as a term. MeSH → controlled (with a
     lookup to attach the descriptor); keyword/synonym → freetext. Deduped against
     the concept's existing terms (mirrors addSynonyms). Triggers a hit refresh. */
  const addSuggestion=(cid,sugg)=>{
    const c=concepts.find(x=>x.id===cid); if(!c||!sugg) return;
    const text=String(sugg.label||"").trim(); if(!text) return;
    const isMesh=sugg.type==="mesh";
    // 97.md Phase 12 — same-group exact-dup prevention WITH the find-existing
    // affordance. QA M18 — checked against the term ACTUALLY inserted (the MeSH
    // descriptor for mesh picks, type-aware), so a free-text pick never collides
    // with a same-label MeSH copy and vice versa.
    const insertText=isMesh?(sugg.mesh||text):text;
    const existing=findExactDuplicateInConcept(c,insertText,undefined,
      isMesh?{type:'controlled',vocab:sugg.vocab||null}:undefined);
    if(existing){
      setBlockedNotice({text:`This exact term is already in ${c.label||'this concept'}.`,cid,tid:existing.id});
      announce(`“${text}” is already in ${c.label||'this concept'}`);
      return;
    }
    const tid=uid();
    const newTerm=isMesh
      ? {id:tid,text:insertText,type:"controlled",field:"tiab",source:"user_added",vocab:sugg.vocab||null}
      : {id:tid,text,type:"freetext",field:"tiab",source:sugg.type==="synonym"?"synonym":"user_added"};
    setConcepts(cs=>cs.map(x=>x.id===cid?{...x,terms:[...x.terms,newTerm]}:x));
    touchMeta();
    // 97 QA M10 — a suggestion pick is an Add: undoable like every other add path.
    setUndoStack(st=>recordBulkAccept(st,{concept:c,termIds:[tid],label:newTerm.text}));
    setUndoMsg(`Added “${newTerm.text}”`);
    // Attach/confirm the descriptor: force controlled for MeSH, best-effort otherwise.
    tryLookup(cid,tid,newTerm.text,isMesh);
  };
  /* 97.md Phase 13 — add ONE entry term / related free-text term through an
     EXPLICIT per-term action (MeSH popover rows + the suggestions area). Replaces
     the retired bulk `addSynonyms` — nothing is ever bulk-inserted. */
  const addEntryTerm=(cid,text)=>{
    const c=conceptsRef.current.find(x=>x&&x.id===cid); if(!c) return;
    const clean=String(text||"").trim(); if(!clean) return;
    const existing=findExactDuplicateInConcept(c,clean);
    if(existing){
      setBlockedNotice({text:`“${clean}” is already in ${c.label||'this concept'}.`,cid,tid:existing.id});
      announce(`“${clean}” is already in ${c.label||'this concept'}`);
      return;
    }
    const tid=uid();
    setConcepts(cs=>cs.map(x=>x.id===cid?{...x,terms:[...x.terms,{id:tid,text:clean,type:"freetext",field:"tiab",source:"synonym"}]}:x));
    touchMeta();
    setUndoStack(st=>recordBulkAccept(st,{concept:c,termIds:[tid],label:clean}));
    setUndoMsg(`Added “${clean}”`);
    announce(`Added “${clean}” to ${c.label||'the concept'}`);
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
      touchMeta();
      // 97 QA M10 — a typed/pasted add is undoable: ONE entry removes exactly the
      // created terms (Phase 6 "Add" is a required undo action).
      if(looks.length&&target){
        const label=looks.length===1?looks[0][1]:`${looks.length} terms`;
        setUndoStack(st=>recordBulkAccept(st,{concept:target,termIds:looks.map(([tid])=>tid),label}));
        setUndoMsg(looks.length===1?`Added “${looks[0][1]}”`:`Added ${looks.length} terms`);
      }
      looks.forEach(([tid,text])=>tryLookup(cid,tid,text));
    }
    // 97.md Phase 12 — a rejected exact duplicate gets the find-existing affordance.
    if(res.duplicates.length){
      const existing=findExactDuplicateInConcept(target,res.duplicates[0]);
      if(existing) setBlockedNotice({text:`This exact term is already in ${label}.`,cid,tid:existing.id});
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
  /* 97.md Phase 13 — accepting a MeSH suggestion adds ONLY that controlled term
     (entry terms / synonyms are NEVER inserted with it). The old `synonyms`
     bulk-accept branch and the "Accept all N subject headings" button are GONE:
     entry terms render as individual rows with per-term "Add this term"
     (addEntryTerm above). */
  const acceptSuggestion=(cid,s)=>{
    const c=conceptsRef.current.find(x=>x.id===cid); if(!c||!s) return;
    if(s.kind!=='mesh') return; // entry terms go through addEntryTerm, one at a time
    const tid=uid();
    const newTerm={id:tid,text:s.text,type:'controlled',field:'tiab',source:'user_added',vocab:s.vocab||null};
    setConcepts(cs=>cs.map(x=>x.id===cid?{...x,terms:[...x.terms,newTerm]}:x));
    touchMeta();
    if(!s.vocab) tryLookup(cid,tid,s.text,true);
    announce(`Added MeSH term "${s.text}" to ${c.label}`);
    setUndoStack(st=>recordBulkAccept(st,{concept:c,termIds:[tid],label:s.text}));
    setUndoMsg(`Added "${s.text}"`);
  };
  /* 98.md §11 (round 2) — carefully designed BULK selection: explicit checkbox
     multi-select + ONE "Add N selected" action. This is NOT the 97-banned
     indiscriminate bundle: nothing is preselected, low-confidence MeSH rows are
     excluded from select-all (component side), duplicates are skipped and
     REPORTED, and the whole batch is ONE undo entry. items:
     [{kind:'mesh',sugg}|{kind:'entry',text}]. */
  const acceptSuggestionsBulk=(cid,items)=>{
    const base=conceptsRef.current.find(x=>x&&x.id===cid); if(!base||!Array.isArray(items)||!items.length) return;
    const newTerms=[]; const looks=[]; const skipped=[];
    let working={...base,terms:[...base.terms]};
    for(const it of items){
      if(it&&it.kind==='mesh'&&it.sugg){
        const s=it.sugg;
        const text=String(s.text||'').trim(); if(!text) continue;
        if(findExactDuplicateInConcept(working,text,undefined,{type:'controlled',vocab:s.vocab||null})){ skipped.push(text); continue; }
        const tid=uid();
        const t={id:tid,text,type:'controlled',field:'tiab',source:'user_added',vocab:s.vocab||null};
        working={...working,terms:[...working.terms,t]}; newTerms.push(t);
        if(!s.vocab) looks.push([tid,text]);
      } else if(it&&it.kind==='entry'&&it.text){
        const clean=String(it.text).trim(); if(!clean) continue;
        if(findExactDuplicateInConcept(working,clean)){ skipped.push(clean); continue; }
        const tid=uid();
        working={...working,terms:[...working.terms,{id:tid,text:clean,type:'freetext',field:'tiab',source:'synonym'}]};
        newTerms.push(working.terms[working.terms.length-1]);
      }
    }
    if(!newTerms.length){ announce('Nothing added — the selected terms are already in this concept.'); return; }
    setConcepts(cs=>cs.map(x=>x.id===cid?{...x,terms:[...x.terms,...newTerms]}:x));
    touchMeta();
    setUndoStack(st=>recordBulkAccept(st,{concept:base,termIds:newTerms.map(t=>t.id),label:`${newTerms.length} suggested terms`}));
    setUndoMsg(`Added ${newTerms.length} suggested term${newTerms.length===1?'':'s'}${skipped.length?` — ${skipped.length} already present`:''}`);
    announce(`Added ${newTerms.length} suggested term${newTerms.length===1?'':'s'} to ${base.label||'the concept'}${skipped.length?`; ${skipped.length} skipped as already present`:''}`);
    looks.forEach(([tid,text])=>tryLookup(cid,tid,text,true));
  };
  const dismissSuggestion=(s)=>{
    if(!s||!s.key) return;
    setRejectedSuggestions(r=>r.includes(s.key)?r:[...r,s.key]);
    announce(`Dismissed suggestion "${s.text}"`);
  };
  const unrejectSuggestion=(key)=>setRejectedSuggestions(r=>r.filter(k=>k!==key));
  /* Rejection keys scoped to one concept, for the "Show dismissed" restore list. */
  const rejectedEntriesFor=(c)=>{
    if(!c) return [];
    const prefix=rejectionKey(c,'');
    return rejectedSuggestions.filter(k=>k.startsWith(prefix))
      .map(k=>({key:k,label:k.slice(prefix.length).replace(/^fam:/,'')}));
  };

  /* ── SB3: keyword select/deselect (Tab 1) + database selection (Tab 3) ───── */
  const effectiveDbs=useMemo(()=>selectedDbs.length?selectedDbs:defaultSelectedDatabases(),[selectedDbs]);
  // QA L28 — ONE memoized compileAll shared by the terms-phase meaning panel's
  // "Exact database queries" disclosure (100.md §11; it replaced the Database previews)
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
    // 99.md — an explicit user collapse renders EVERY card compact; a null id
    // still falls back to concepts[0] (the load-time keyboard contract, H14).
    if(boardCollapsed) return null;
    return concepts.find(c=>c.id===activeConceptId)||concepts[0];
  },[concepts,activeConceptId,boardCollapsed]);
  /* (96.md — the Concepts-stage "Edit terms →" card action is gone with the stage;
     the ConceptNavigator + question-card clicks own concept activation now.) */
  /* ── 97.md Phase 12 — the chip-integrated duplicate model (dupSignals.js).
     EXACT duplicates (conservative exactDuplicateKey) drive the dark-red state;
     the old family equivalence is demoted to the soft "Possible variant" hint.
     dupOverride/dismissals are configuration-scoped and auto-reevaluate. */
  const dupModel=useMemo(
    ()=>buildDupModel({concepts,dismissed:dismissedWarnings}),
    [concepts,dismissedWarnings]);
  const dupSignalFor=(t)=>(t&&t.id?dupModel.byTermId[t.id]||null:null);
  /* Focus a specific chip ("Find other duplicate" / "Find existing term").
     99.md — routed through selectConcept so a collapsed board expands (with the
     morph) before the chip receives focus. */
  const requestFocusTerm=(cid,tid)=>{ selectConcept(cid,()=>{ setEditing(null); setFocusTerm({cid,tid}); }); };
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
    touchMeta();
    stampSnapshotIfEmpty();
    activatePlain(cid); // 99.md — a freshly created concept always opens
    tryLookup(cid,withIds.terms[0].id,withIds.terms[0].text);
    // 97 QA M10/H2 — Select (token click) / manual group add is undoable: the
    // entry records the group's ORIGIN term ids, so undo removes the group even
    // though it is born with its phrase term (work added later still protects it).
    setUndoStack(st=>recordAddConcept(st,{conceptId:cid,label:withIds.label||text,originTermIds:withIds.terms.map(t=>t.id)}));
    setUndoMsg(`Created concept “${withIds.label||text}”`);
    return withIds;
  };
  /* 97.md Phase 6 — question-card drag-onto-token combine: create ONE search group
     from the contiguous span between the two tokens (order preserved, whitespace
     normalized, hyphens kept) and record the individual token texts as the
     phrase's `components` so a later split is lossless. */
  const combineQuestionSpan=(fromIdx,toIdx)=>{
    const tokens=tokenizeForSelection(question||"");
    const span=combineSpanFromTokens(tokens,fromIdx,toIdx);
    if(!span) return;
    const existing=findConceptForPhrase(conceptsRef.current,span.text);
    if(existing){ selectConcept(existing.id); announce(`"${existing.label||span.text}" already exists — opened it`); return; }
    const fresh=createConceptFromPhrase(span.text);
    if(!fresh) return;
    const cid=uid();
    const withIds={...fresh,id:cid,terms:fresh.terms.map(t=>({...t,id:uid(),components:span.components}))};
    setConcepts(cs=>[...cs,withIds]);
    touchMeta();
    stampSnapshotIfEmpty();
    activatePlain(cid); // 99.md — a freshly created concept always opens
    tryLookup(cid,withIds.terms[0].id,withIds.terms[0].text);
    // 97 QA H2 — the entry carries the origin phrase term's id, so the toast's
    // Undo genuinely removes the group the combine just created (the old entry
    // only removed EMPTY groups and provably did nothing here).
    setUndoStack(st=>recordAddConcept(st,{conceptId:cid,label:span.text,originTermIds:withIds.terms.map(t=>t.id)}));
    setUndoMsg(`Combined into “${span.text}”`);
    announce(`Combined into “${span.text}”`);
  };
  const togglePhrase=(text)=>{
    const clean=String(text||"").trim(); if(!clean) return;
    const existing=findConceptForPhrase(conceptsRef.current,clean);
    if(existing){
      if(conceptOnlyHoldsOriginTerm(existing)){
        removeConcept(existing.id); // records the undo inverse + snackbar
        announce(`Removed concept "${existing.label||clean}"`);
      } else {
        selectConcept(existing.id);
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
    if(existing){ selectConcept(existing.id); announce(`"${existing.label||clean}" already exists — opened it`); return; }
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
  // 98.md §4 — also gated on `!questionEditing`: with the INLINE editor the builder
  // is visible while the user types, and each 500ms commit would otherwise stamp
  // the snapshot (autosave churn) or flash the drift banner mid-sentence. Drift
  // settles once, when the editing session ends (Done/blur/unmount).
  useEffect(()=>{
    if(visible&&!questionEditing&&questionChanged&&drifted.length===0){
      setQuestionSnapshot(String(question||"").slice(0,2000).trim());
    }
  },[visible,questionEditing,questionChanged,drifted.length,question]); // eslint-disable-line
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
    touchMeta();
    setUndoStack(st=>recordReorderConcept(st,{conceptId:cid,fromIndex:from,toIndex:from+(delta<0?-1:1),label}));
    setUndoMsg(`Moved "${label}" ${delta<0?"up":"down"}`);
    announce(`Moved "${label}" ${delta<0?"up":"down"}`);
  };
  /* 97.md Phase 10 — drag a group pill to an arbitrary position (insertion line).
     Implemented as repeated pure ±1 reorders; ONE undo entry restores the origin. */
  const reorderConceptToIndex=(cid,targetIndex)=>{
    const list=conceptsRef.current;
    const from=list.findIndex(c=>c&&c.id===cid);
    if(from<0) return;
    const to=normalizeReorderIndex(from,targetIndex);
    if(to==null) return;
    let next=list;
    const step=to>from?1:-1;
    for(let i=from;i!==to;i+=step) next=reorderConceptState(next,cid,step);
    if(next===list) return;
    const label=(list[from]&&list[from].label)||"Concept";
    setConcepts(next);
    touchMeta();
    setUndoStack(st=>recordReorderConcept(st,{conceptId:cid,fromIndex:from,toIndex:to,label}));
    setUndoMsg(`Moved "${label}"`);
    announce(`Moved "${label}" to position ${to+1}`);
  };
  const mergeConceptInto=(fromId,intoId)=>{
    const target=conceptsRef.current.find(c=>c&&c.id===intoId);
    // 97 QA M21 — legacy Time-frame note groups render no term chips: terms merged
    // into one would become invisible and uneditable. Never a merge target (the
    // menu + pill-drag geometry filter them too; this is the last line of defense).
    if(target&&target.picoField==="T"){
      announce(`"${target.label||'Time frame'}" is a legacy time-frame note — it cannot receive merged terms.`);
      return;
    }
    const res=mergeConceptsState(conceptsRef.current,fromId,intoId);
    if(!res) return;
    setConcepts(res.concepts);
    touchMeta();
    setUndoStack(st=>recordMergeConcepts(st,res.undo));
    // 97 QA M20 — duplicates left behind are NEVER silent: the toast counts them
    // (they are recoverable via this merge's Undo entry).
    const skippedN=Array.isArray(res.skipped)?res.skipped.length:0;
    const skippedNote=skippedN?` · ${skippedN} duplicate term${skippedN===1?'':'s'} already present ${skippedN===1?'was':'were'} not moved`:'';
    setUndoMsg(`Merged "${res.undo.fromConcept.label||"concept"}" into "${(target&&target.label)||"concept"}"${skippedNote}`);
    activatePlain(intoId); // 99.md — the merge target opens even from a collapsed board (drag-merge)
    announce(`Merged "${res.undo.fromConcept.label||"concept"}" into "${(target&&target.label)||"concept"}"${skippedNote}`);
  };
  const splitConceptTerms=(cid,termIds,newLabel)=>{
    const res=splitConceptState(conceptsRef.current,cid,termIds,newLabel);
    if(!res) return;
    const nid=uid();
    const withId=res.concepts.map((c,i)=>i===res.newIndex?{...c,id:nid}:c);
    const label=withId[res.newIndex].label;
    setConcepts(withId);
    touchMeta();
    setUndoStack(st=>recordSplitConcept(st,{fromConceptId:cid,newConceptId:nid,termIds,label}));
    setUndoMsg(`Split ${termIds.length} term${termIds.length===1?"":"s"} into "${label}"`);
    activatePlain(nid);
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
    touchMeta();
    setUndoStack(st=>recordReorderTerm(st,{conceptId:cid,termId:tid,fromIndex:from,toIndex:from+(delta<0?-1:1),text}));
    setUndoMsg(`Moved "${text}" ${delta<0?"earlier":"later"}`);
    announce(`Moved "${text}" ${delta<0?"earlier":"later"} in ${c.label||"the concept"}`);
  };
  /* 97.md Phase 6/11 — drag-reorder a term to an ARBITRARY position (insertion
     line). Repeated pure ±1 moves; ONE undo entry restores the original index. */
  const reorderTermToIndex=(cid,tid,targetIndex)=>{
    const list=conceptsRef.current;
    const c=list.find(x=>x&&x.id===cid);
    if(!c) return;
    const from=(c.terms||[]).findIndex(t=>t&&t.id===tid);
    if(from<0) return;
    const to=normalizeReorderIndex(from,targetIndex);
    if(to==null) return;
    let next=list;
    const step=to>from?1:-1;
    for(let i=from;i!==to;i+=step) next=reorderTermState(next,cid,tid,step);
    if(next===list) return;
    const text=(c.terms[from]&&c.terms[from].text)||"term";
    setConcepts(next);
    touchMeta();
    setUndoStack(st=>recordReorderTerm(st,{conceptId:cid,termId:tid,fromIndex:from,toIndex:to,text}));
    setUndoMsg(`Moved "${text}"`);
    announce(`Moved "${text}" to position ${to+1} in ${c.label||"the concept"}`);
  };
  /* 97.md Phase 10 — rename undo: ONE entry per editing session (recorded on blur,
     not per keystroke). renameBaseRef holds the label the session started from. */
  const renameBaseRef=useRef(null);
  const beginRenameTracking=(cid)=>{
    const c=conceptsRef.current.find(x=>x&&x.id===cid);
    renameBaseRef.current=c?{cid:c.id,label:c.label||''}:null;
  };
  const commitRename=()=>{
    const base=renameBaseRef.current;
    if(!base) return;
    const c=conceptsRef.current.find(x=>x&&x.id===base.cid);
    if(!c) return;
    const now=c.label||'';
    if(now===base.label) return;
    touchMeta();
    setUndoStack(st=>recordRenameConcept(st,{conceptId:c.id,prevLabel:base.label,nextLabel:now}));
    setUndoMsg(`Renamed concept to “${now||'Untitled'}”`);
    announce(`Renamed the concept to “${now||'Untitled'}”`);
    renameBaseRef.current={cid:c.id,label:now};
  };
  // A new active group starts a fresh rename-tracking session.
  useEffect(()=>{
    const cid=activeConceptId||(conceptsRef.current[0]&&conceptsRef.current[0].id);
    if(cid) beginRenameTracking(cid);
  },[activeConceptId,loaded]); // eslint-disable-line
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
    touchMeta();
    announce(`Updated the phrase for "${(c&&c.label)||"the concept"}"`);
  };

  /* ── 97.md Phase 11 — cross-group term movement via the pure moveTermToConcept
     (workstream B). This REPLACES the legacy moveTerm and fixes its three defects:
     an exact duplicate at the target now BLOCKS the move (with "Find existing
     term") instead of silently deleting the term; the move records an undo entry;
     and the term's source/id/type/vocab/components metadata are preserved. */
  const doMoveTerm=(fromCid,tid,toCid,index)=>{
    if(fromCid===toCid&&index==null) return;
    const list=conceptsRef.current;
    const from=list.find(c=>c&&c.id===fromCid);
    const t=from&&(from.terms||[]).find(x=>x&&x.id===tid);
    const to=list.find(c=>c&&c.id===toCid);
    if(!t||!to) return;
    const res=moveTermToConcept(list,tid,fromCid,toCid,index);
    if(!res) return;
    if(res.blocked){
      setBlockedNotice({text:`This exact term is already in ${to.label||'that concept'}.`,cid:toCid,tid:res.existingTermId});
      announce(`This exact term is already in ${to.label||'that concept'} — nothing was moved.`);
      return;
    }
    setConcepts(res.concepts);
    touchMeta();
    setUndoStack(st=>recordMoveTerm(st,res.undo));
    setUndoMsg(`Moved “${t.text}” to ${to.label||'the other concept'}`);
    announce(`Moved “${t.text}” to ${to.label||'the other concept'}`);
    setEditing(null);
  };
  /* Move a term into a brand-NEW group — reuses the pure splitConcept op (already
     undoable as one entry: undo moves the term back AND removes the empty group). */
  const moveTermToNewGroup=(fromCid,tid)=>{
    splitConceptTerms(fromCid,[tid],`Concept ${conceptsRef.current.length+1}`);
  };
  /* 97.md Phases 9/11 — EXPLICIT copy (default drag always MOVES, never clones). */
  const doCopyTerm=(fromCid,tid,toCid /* null → new group */)=>{
    const list=conceptsRef.current;
    const src=list.find(c=>c&&c.id===fromCid);
    const t=src&&(src.terms||[]).find(x=>x&&x.id===tid);
    if(!t) return;
    let base=list, targetId=toCid, targetLabel='';
    if(toCid==null){
      targetId=uid();
      targetLabel=`Concept ${list.length+1}`;
      base=[...list,{id:targetId,label:targetLabel,op:"AND",source:"user_added",terms:[]}];
    } else {
      const to=list.find(c=>c&&c.id===toCid);
      if(!to) return;
      targetLabel=to.label||'the concept';
    }
    const res=copyTermState(base,tid,fromCid,targetId);
    if(!res) return;
    if(res.blocked){
      setBlockedNotice({text:`This exact term is already in ${targetLabel}.`,cid:targetId,tid:res.existingTermId});
      announce(`This exact term is already in ${targetLabel} — nothing was copied.`);
      return;
    }
    setConcepts(res.concepts);
    touchMeta();
    setUndoStack(st=>recordCopyTerm(st,{conceptId:targetId,termId:res.newTermId,text:t.text}));
    setUndoMsg(`Copied “${t.text}” to ${targetLabel}`);
    announce(`Copied “${t.text}” to ${targetLabel}`);
    activatePlain(targetId);
    setEditing(null);
  };
  /* 97.md Phase 6 — combine terms into ONE phrase (drag-onto-chip or the popover
     menu). Group order decides the phrase order; `components` are recorded so the
     phrase splits losslessly later. */
  const doCombineTerms=(cid,termIds)=>{
    const res=combineTokensState(conceptsRef.current,cid,termIds);
    if(!res) return;
    if(res.blocked){
      // 97 QA M19 — the combined phrase would exactly duplicate a surviving term
      // of this group: blocked with the standard find-existing affordance
      // (mirrors every other same-group insertion path).
      const c=conceptsRef.current.find(x=>x&&x.id===cid);
      setBlockedNotice({text:`This exact term is already in ${(c&&c.label)||'this concept'}.`,cid,tid:res.existingTermId});
      announce(`“${res.text}” is already in ${(c&&c.label)||'this concept'} — nothing was combined.`);
      return;
    }
    setConcepts(res.concepts);
    touchMeta();
    setUndoStack(st=>recordCombineTokens(st,res.undo));
    const text=(res.term&&res.term.text)||'the phrase';
    setUndoMsg(`Combined into “${text}”`);
    announce(`Combined into “${text}”`);
    setEditing(null);
  };
  /* 97.md Phase 6 — split a phrase. Component history (term.components) restores
     the original parts; an EDITED phrase goes through the popover's safe manual
     split (explicit `parts`) — never a destructive guess. */
  const doSplitPhrase=(cid,tid,parts)=>{
    const res=splitPhraseState(conceptsRef.current,cid,tid,parts);
    if(!res) return;
    setConcepts(res.concepts);
    touchMeta();
    setUndoStack(st=>recordSplitPhrase(st,res.undo));
    const n=(Array.isArray(res.terms)?res.terms.length:0)||(Array.isArray(parts)?parts.length:2);
    setUndoMsg(`Split into ${n} terms`);
    announce(`Split the phrase into ${n} terms`);
    setEditing(null);
  };
  /* 97.md Phase 12 — intentional-duplicate override (term-level dupOverride on
     EVERY copy; auto-invalidates when the term/edit/group configuration changes). */
  const keepBothIntentionally=(t)=>{
    const key=termDuplicateKey(t); // QA M18 — type-aware key (freetext keys unchanged)
    if(!key) return;
    const res=applyDupOverrideState(conceptsRef.current,key);
    if(!res.changed.length) return;
    setConcepts(res.concepts);
    touchMeta();
    setUndoStack(st=>recordDupOverride(st,{key,label:t.text,changed:res.changed}));
    setUndoMsg(`Kept “${t.text}” intentionally`);
    announce(`Kept “${t.text}” in both concepts intentionally — the warning stays off until the term or concepts change.`);
    setEditing(null);
  };
  const unkeepDup=(t)=>{
    const key=termDuplicateKey(t); // QA M18 — matches the key keepBothIntentionally stamps
    if(!key) return;
    const res=clearDupOverrideState(conceptsRef.current,key);
    if(!res.changed.length) return;
    setConcepts(res.concepts);
    touchMeta();
    setUndoStack(st=>recordDupOverride(st,{key,label:t.text,changed:res.changed}));
    setUndoMsg(`“${t.text}” is no longer an intentional duplicate`);
    announce(`“${t.text}” is no longer marked as an intentional duplicate.`);
    setEditing(null);
  };
  /* 97 QA M17 — the duplicate-resolution "Move to <other group>" action. The
     other group BY DEFINITION already holds this exact copy, so a literal move is
     always blocked ("nothing was moved" forever — a guaranteed dead-end).
     Consolidation is what the action means: remove THIS copy (undoable via
     removeTerm's recorded inverse) and focus the surviving copy over there. */
  const consolidateDupCopy=(cid,tid,other)=>{
    const c=conceptsRef.current.find(x=>x&&x.id===cid);
    const t=c&&(c.terms||[]).find(x=>x&&x.id===tid);
    if(!c||!t||!other) return;
    removeTerm(cid,tid);
    setEditing(null);
    requestFocusTerm(other.conceptId,other.termId);
    setUndoMsg(`Kept “${t.text}” in ${other.conceptLabel||'the other concept'} — removed this copy`);
    announce(`“${t.text}” now lives only in ${other.conceptLabel||'the other concept'}; the copy here was removed (undoable).`);
  };
  const dismissWarning=(id)=>setDismissedWarnings(d=>d.includes(id)?d:[...d,id]);
  const restoreWarnings=()=>setDismissedWarnings([]);
  /* 97.md Phase 7 — the "Search Quality Check" card is GONE. The two genuinely
     useful non-blocking checks survive as QUIET inline notices (no branding, no
     severity glyphs, no scores): empty group in the AND chain + literal Boolean
     operator inside a term. Duplicates live on the chips (dupModel above). */
  const quietHints=useMemo(
    ()=>searchQualityCheck(concepts,{dismissed:dismissedWarnings}).filter(w=>String(w.id||'').startsWith('empty:')||String(w.id||'').startsWith('boolop:')),
    [concepts,dismissedWarnings]);
  const moveTargetsFor=(cid)=>concepts.filter(c=>c.id!==cid&&c.picoField!=="T").map(c=>({id:c.id,label:c.label}));

  /* ── 97.md Phases 6/10/11 — the pointer-drag surfaces (Decision D1). Geometry is
     measured from live element refs at drag time and resolved by the PURE
     dndModel.resolveDropTarget; menus/buttons remain the primary path. ── */
  const chipEls=useRef({});
  const pillEls=useRef({});
  const newGroupEl=useRef(null);
  const rectOf=(el)=>{ const r=el.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}; };
  // Term chips: reorder (insertion line) / combine (merge ring, hover-armed) /
  // move to another group (navigator pill) / move to a NEW group.
  const chipDrag=useChipDrag({
    disabled:!!readOnly,
    getGeometry:({meta:m})=>{
      const cid=m&&m.conceptId;
      const c=conceptsRef.current.find(x=>x&&x.id===cid);
      const chips=[];
      ((c&&c.terms)||[]).forEach((t,index)=>{
        if(!t||!String(t.text||'').trim()) return;
        const el=chipEls.current[t.id];
        if(el&&typeof el.getBoundingClientRect==="function") chips.push({id:t.id,groupId:cid,index,rect:rectOf(el)});
      });
      const groups=conceptsRef.current
        .filter(x=>x&&x.id!==cid&&x.picoField!=="T")
        .map(x=>{ const el=pillEls.current[x.id]; return (el&&typeof el.getBoundingClientRect==="function")?{id:x.id,rect:rectOf(el)}:null; })
        .filter(Boolean);
      const ng=(newGroupEl.current&&typeof newGroupEl.current.getBoundingClientRect==="function")?{rect:rectOf(newGroupEl.current)}:null;
      // 98.md review (L7) — bound the nearest-gap reorder band to the SOURCE
      // card's rect: on the horizontal board, neighbouring cards/connectors/gaps
      // share the chips' vertical band, and a drop there must cancel, not reorder.
      const srcCardEl=pillEls.current[cid];
      const rowBounds=(srcCardEl&&typeof srcCardEl.getBoundingClientRect==="function")?rectOf(srcCardEl):null;
      return {chips,groups,newGroup:ng,rowBounds};
    },
    onDrop:(info,target)=>{
      const cid=info.meta&&info.meta.conceptId;
      const tid=info.dragId;
      if(!cid||!tid||!target) return;
      if(target.kind==='insert'&&target.groupId===cid) reorderTermToIndex(cid,tid,target.index);
      else if(target.kind==='merge'&&target.groupId===cid) doCombineTerms(cid,[target.targetId,tid]);
      else if(target.kind==='group') doMoveTerm(cid,tid,target.groupId); // default drag MOVES, never clones
      else if(target.kind==='new-group') moveTermToNewGroup(cid,tid);
    },
  });
  // Group pills: drag to reorder the AND chain (insertion line) or onto another
  // pill's centre (armed merge ring) to merge the two groups.
  const pillDrag=useChipDrag({
    disabled:!!readOnly,
    getGeometry:()=>({
      chips:conceptsRef.current.map((x,i)=>{
        const el=x&&pillEls.current[x.id];
        return (el&&typeof el.getBoundingClientRect==="function")?{id:x.id,groupId:'__pills',index:i,rect:rectOf(el)}:null;
      }).filter(Boolean),
      groups:[],newGroup:null,
    }),
    onDrop:(info,target)=>{
      if(!target) return;
      if(target.kind==='insert') reorderConceptToIndex(info.dragId,target.index);
      else if(target.kind==='merge') mergeConceptInto(info.dragId,target.targetId);
    },
  });
  const chipDropGroupId=chipDrag.state&&chipDrag.state.target&&chipDrag.state.target.kind==='group'?chipDrag.state.target.groupId:null;
  // QA M21 — a legacy Time-frame note group is never a merge target: no confident
  // ring is shown for it (mergeConceptInto refuses the drop as well).
  const pillMergeTargetId=(()=>{
    const t=pillDrag.state&&pillDrag.state.target;
    if(!t||t.kind!=='merge') return null;
    const tc=concepts.find(c=>c&&c.id===t.targetId);
    return tc&&tc.picoField==='T'?null:t.targetId;
  })();
  const pillInsertIndex=pillDrag.state&&pillDrag.state.target&&pillDrag.state.target.kind==='insert'?pillDrag.state.target.index:null;

  /* ── 99.md — DYNAMIC EXPAND/COLLAPSE of the concept board ───────────────────
     One helper family owns every activation/collapse so the motion policy lives
     in exactly one place:
       · animateBoardChange — wraps a board-layout mutation in a View Transition
         (the platform morph: old/new snapshots cross-fade while each named card
         travels to its new box). Falls back to an instant flushSync when the API
         is missing (jsdom, older engines), when prefers-reduced-motion is set,
         or while a pointer drag is live (a morph mid-drag would fight the drag's
         own geometry). CSS durations/easing live in the tab <style> block.
       · selectConcept — the ONE expansion path (compact-card click/keyboard,
         chevron, preview rows, drift banner, "Find existing term"). Clears the
         explicit collapse, activates, and optionally runs companion state
         updates INSIDE the same synchronous commit (an editing target set in a
         separate commit would be closed by the stale-editor effect).
       · collapseBoard — the ONE collapse path (outside click, Escape, chevron).
         Closes per-card transient UI (editor popover, merge/split/delete
         pickers) but deliberately RETAINS add-box drafts and suggestion-panel
         open state: collapse is a view action, never a data action. */
  const dragGestureLiveRef=useRef(null);
  dragGestureLiveRef.current=()=>!!(
    (chipDrag.state&&chipDrag.state.active)||(pillDrag.state&&pillDrag.state.active)
    ||(chipDrag.wasDragClick&&chipDrag.wasDragClick())||(pillDrag.wasDragClick&&pillDrag.wasDragClick()));
  const prefersReducedMotion=()=>{
    try{ return typeof window!=="undefined"&&!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch{ return false; }
  };
  /* THE COALESCING BOARD SCHEDULER. Board mutations from the same gesture arrive
     through SEVERAL dispatch layers (the document-capture outside-click listener,
     then the React handler on the actual target — e.g. collapse-then-reactivate
     when a question token or preview row is clicked). A naive per-call
     startViewTransition defers each mutation into its own async callback, so a
     later call still reads pre-collapse state (its "already active" guard then
     eats the re-activation) and commits land out of order. Instead every change
     MERGES into one pending intent (guards read the intent, never render-scope
     state) and exactly one commit applies it — inside a single View Transition
     when morphing is possible, instantly otherwise. */
  // True only while a board morph is in flight (drives the transient card names).
  const [morphing,setMorphing]=useState(false);
  const boardStateRef=useRef({collapsed:false,activeId:null});
  boardStateRef.current={collapsed:boardCollapsed,activeId:activeConceptId};
  const boardPendingRef=useRef(null);
  const currentBoardIntent=()=>boardPendingRef.current||boardStateRef.current;
  /* What the intent renders as the working card — replicates the activeConcept
     memo's concepts[0] fallback so guards agree with what the user SEES. */
  const intentActiveId=(intent)=>{
    if(intent.collapsed) return null;
    const list=conceptsRef.current||[];
    if(!list.length) return null;
    return list.some(x=>x&&x.id===intent.activeId)?intent.activeId:(list[0]&&list[0].id)||null;
  };
  const scheduleBoardChange=(patch)=>{
    const pending=boardPendingRef.current;
    const base=pending||{...boardStateRef.current,extras:[],afters:[],morph:true};
    boardPendingRef.current={
      collapsed:patch.collapsed!==undefined?patch.collapsed:base.collapsed,
      activeId:patch.activeId!==undefined?patch.activeId:base.activeId,
      extras:[...base.extras,...(patch.extras?[patch.extras]:[])],
      afters:[...base.afters,...(patch.after?[patch.after]:[])],
      morph:base.morph&&patch.morph!==false,
    };
    if(pending) return; // merged into the already-scheduled commit
    const commit=()=>{
      const fin=boardPendingRef.current;
      boardPendingRef.current=null;
      if(!fin) return;
      flushSync(()=>{
        setBoardCollapsed(fin.collapsed);
        setActiveConceptId(fin.activeId);
        fin.extras.forEach(f=>f());
      });
      fin.afters.forEach(f=>f());
    };
    const morph=!prefersReducedMotion()
      &&!(dragGestureLiveRef.current&&dragGestureLiveRef.current())
      &&typeof document!=="undefined"&&typeof document.startViewTransition==="function"
      &&boardPendingRef.current.morph;
    if(morph){
      /* 99.md review (regressions) — view-transition-name is applied ONLY for the
         duration of the morph. A permanent name makes every card wrapper a stacking
         context, and the popovers that overflow a card (term editor, MeSH details)
         then paint UNDER the following cards. The name must exist before the OLD
         snapshot is taken, so it is flushed synchronously first and removed once the
         transition settles. */
      flushSync(()=>setMorphing(true));
      const vt=document.startViewTransition(commit);
      const done=()=>setMorphing(false);
      if(vt&&vt.finished&&typeof vt.finished.then==="function") vt.finished.then(done,done);
      else done();
    }else commit();
  };
  /* The ONE expansion path (compact-card click/keyboard, chevron, preview rows,
     drift banner, "Find existing term"). Companion updates (e.g. an editing
     target) ride the same commit — a separate commit would be closed by the
     stale-editor effect. */
  const selectConcept=(cid,extras,opts)=>{
    if(!cid) return;
    if(intentActiveId(currentBoardIntent())===cid){ if(extras) extras(); return; } // already the working card — intentional no-op
    scheduleBoardChange({collapsed:false,activeId:cid,extras,
      after:opts&&opts.scroll?()=>{
        const el=pillEls.current[cid];
        if(el&&typeof el.scrollIntoView==="function") el.scrollIntoView({block:"nearest",behavior:prefersReducedMotion()?"auto":"smooth"});
      }:undefined});
  };
  /* No-morph activation for DATA flows (merge/split/copy/create): their concepts
     mutation commits in the surrounding event batch, so a morph would snapshot a
     half-applied board. flushSync folds any such pending data update into the
     same commit — the card change lands instantly, as it did before 99.md. */
  const activatePlain=(cid)=>{ if(cid) scheduleBoardChange({collapsed:false,activeId:cid,morph:false}); };
  const collapseBoard=(opts)=>{
    const cur=currentBoardIntent();
    if(cur.collapsed) return;
    const prevId=intentActiveId(cur);
    if(!prevId) return; // nothing is expanded (empty board)
    // Keyboard collapse keeps the user anchored — but ONLY when their focus
    // lived inside the collapsing card (its working surfaces unmount, so the
    // browser would otherwise drop focus to <body>). Focus already elsewhere
    // (another card, the page) is never stolen. Pointer collapse never refocuses.
    const prevEl=pillEls.current[prevId]||null;
    const focused=(typeof document!=="undefined"&&document.activeElement)||null;
    const hadFocusInside=!!(prevEl&&typeof prevEl.contains==="function"&&focused&&prevEl.contains(focused));
    scheduleBoardChange({collapsed:true,
      extras:()=>{ setEditing(null); setMergeOpen(false); setSplitDraft(null); setConfirmDeleteId(null); },
      /* 99.md review (a11y) — only rescue focus that the collapse actually DESTROYED.
         Controls that survive it (the chevron the user just pressed, the rename input)
         keep focus; moving it to the card section there would silently demote the user
         from the button they are operating. */
      after:(opts&&opts.refocus&&hadFocusInside)?()=>{
        if(focused&&focused.isConnected) return;
        if(prevEl&&typeof prevEl.focus==="function") prevEl.focus();
      }:undefined});
  };
  const collapseBoardRef=useRef(null); collapseBoardRef.current=collapseBoard;
  /* Outside-click collapse — a GESTURE-scoped document listener pair: the
     pointerdown AND the resulting click must both land outside the board (and
     outside the exempt layers) before the board collapses. Requiring the DOWN
     to be outside means a text-selection drag that starts inside a card and
     releases on the page never collapses it; requiring the CLICK target too
     means a down-outside/up-inside gesture stays inert. Exempt layers: any
     dialog (term editor, MeSH popover, Regenerate), the undo snackbar, and the
     question-drift banner (its buttons act ON concepts). The trailing
     compatibility click after a chip/pill drag is guarded like every other
     click surface (98.md L8). Listeners ride capture phase so an inner
     stopPropagation can never strand the board expanded. */
  const outsideDownRef=useRef(false);
  useEffect(()=>{
    if(phase!=="terms") return undefined;
    /* Exempt = surfaces whose clicks ACT ON the concept workflow rather than
       leave it: the board itself, transient layers (dialogs, the undo snackbar)
       and every strategy control panel carrying data-sb-collapse-exempt (the
       question source card — its tokens create/focus concepts, the terms
       toolbar with Regenerate, the drift banner, duplicate notices). Clicks on
       genuinely neutral page surface (preview panels, limits, headings, page
       background) still collapse. */
    const exempt=(el)=>!!(el&&typeof el.closest==="function"&&el.closest(
      '[data-testid="sb-concept-board"],[role="dialog"],[data-testid="sb-undo"],[data-sb-collapse-exempt]'));
    const onDown=(e)=>{ outsideDownRef.current=!exempt(e.target); };
    const onClick=(e)=>{
      /* 99.md review — a KEYBOARD-activated control synthesises a click with
         detail===0 and no preceding pointerdown, so the flag would still be carrying
         a verdict from whatever the user last clicked: activating a button by Enter
         could collapse the board (or not) depending on unrelated history. Pointer
         gestures only; keyboard collapse is Escape's job. The flag is consumed here
         so it can never outlive its own gesture. */
      const pointerGesture=outsideDownRef.current&&e.detail!==0;
      outsideDownRef.current=false;
      if(!pointerGesture||exempt(e.target)) return;
      if(dragGestureLiveRef.current&&dragGestureLiveRef.current()) return;
      if(collapseBoardRef.current) collapseBoardRef.current({refocus:false});
    };
    document.addEventListener("pointerdown",onDown,true);
    document.addEventListener("click",onClick,true);
    return ()=>{
      document.removeEventListener("pointerdown",onDown,true);
      document.removeEventListener("click",onClick,true);
    };
  },[phase]);
  /* Collapse is per-visit UI state: leaving the terms workspace or switching
     projects restores the default working layout (first/last-active card open).
     CRITICAL — the reset must also CANCEL any pending board commit. A View
     Transition callback runs a frame later than the click that scheduled it, so
     clicking a stage pip ran: outside-click schedules collapse → React changes
     the stage → this effect resets → the deferred commit lands LAST and
     re-collapses. Because SearchBuilderTab stays mounted across stages, the
     board then stayed collapsed on return, breaking the H14 contract (verified
     by e2e). Dropping the pending intent makes that late commit a no-op — see
     the `if(!fin) return` guard in scheduleBoardChange's commit. */
  const resetBoardCollapsed=useCallback(()=>{ boardPendingRef.current=null; setBoardCollapsed(false); },[]);
  useEffect(()=>{ if(phase!=="terms") resetBoardCollapsed(); },[phase,resetBoardCollapsed]);
  useEffect(()=>{ resetBoardCollapsed(); },[projectId,resetBoardCollapsed]);
  // A commit that would land after unmount must not touch state either.
  useEffect(()=>()=>{ boardPendingRef.current=null; },[]);

  /* ── 97.md Phase 4 — explicit Regeneration ────────────────────────────────────
     Snapshot-FIRST via the version registry ("Before regeneration"); on snapshot
     failure the whole action ABORTS with an error and no state change. On success:
     replace the groups from the research question (buildRegenerateState — B),
     stamp questionSnapshot + meta.generatedAt/sourceQuestion, push a whole-state
     `regenerate` undo entry, save IMMEDIATELY (auditAction:'regenerated' +
     baseRevision ride the PUT envelope) and toast "Search strategy regenerated.
     Undo". Overrides / filters / dismissals are NOT cleared (plan §9). */
  const saveImmediate=useCallback((nextState,envelope)=>{
    if(!saveSearch||!projectId) return;
    clearTimeout(saveTimer.current);
    const sig=serializeSearchState({...nextState,readyForScreening});
    // QA H1 — baseRevision is NOT frozen here: doSave stamps it at send time.
    const payload={...nextState,...(envelope||{})};
    pendingSaveRef.current={sig,payload};
    doSave(sig,payload);
  },[doSave,saveSearch,projectId,readyForScreening]);
  const confirmRegenerate=async()=>{
    if(regenBusy) return;
    setRegenBusy(true); setRegenError('');
    // 97 QA M4/M5/M28/M31 — the protective ordering lives in the extracted,
    // functionally-tested performRegenerate: (1) FLUSH the pending debounced save
    // so the server-side snapshot includes edits from inside the 800ms window;
    // (2) snapshot — skipped on a never-saved workspace (revision 0: there is no
    // saved work to protect and the server would answer `no_strategy` 400);
    // (3) apply only after every protective step succeeded. Any failure ABORTS
    // with NO state change.
    const res=await performRegenerate({
      flushPendingSave:()=>saveNow(),
      hasSavedStrategy:()=>revisionRef.current>0,
      saveSnapshot:()=>searchVersionsApi.save(projectId,{name:PRE_REGENERATE_SNAPSHOT_NAME,note:'Automatic snapshot saved before Regenerate'}),
      applyRegenerated:({snapshotted})=>{
        if(snapshotted&&typeof onVersionsChanged==="function") onVersionsChanged();
        const prev={
          concepts:conceptsRef.current,
          meta:metaRef.current,
          questionSnapshot:questionSnapshotRef.current,
        };
        const out=buildRegenerateState({question,at:new Date().toISOString()});
        const withIds=out.concepts.map(c=>({...c,id:c.id||uid(),terms:(c.terms||[]).map(t=>({...t,id:t.id||uid()}))}));
        setConcepts(withIds);
        setQuestionSnapshot(out.questionSnapshot);
        setMeta(out.meta||null);
        setActiveConceptId(withIds.length?withIds[0].id:null);
        resetBoardCollapsed(); // 99.md — a regenerated board always lands in the working layout
        setEditing(null); setDrafts({}); setPendingSplit(null); setBlockedNotice(null);
        setUndoStack(st=>recordRegenerate(st,{prev}));
        setUndoMsg(REGENERATE_DONE_MESSAGE); // + the snackbar's Undo button ⇒ "Search strategy regenerated. Undo"
        announce(snapshotted
          ?'Search strategy regenerated. The previous workspace was snapshotted to Versions and can be restored.'
          :'Search strategy regenerated. The workspace had never been saved, so no backup snapshot was needed.');
        saveImmediate(
          {concepts:withIds,overrides,ignored,databases:selectedDbs,dismissedWarnings,filters,rejectedSuggestions,questionSnapshot:out.questionSnapshot,...(out.meta?{meta:out.meta}:{})},
          {auditAction:'regenerated'});
        withIds.forEach(c=>(c.terms||[]).forEach(t=>{ if(t&&t.text) tryLookup(c.id,t.id,t.text); }));
      },
    });
    if(!res.ok){
      setRegenBusy(false);
      setRegenError(res.error);
      announce('Regeneration cancelled — nothing was changed. '+res.error);
      return;
    }
    setRegenBusy(false);
    setRegenOpen(false);
  };

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
.sbkw-token:focus-visible{outline:2px solid ${C.acc};outline-offset:2px;}
.sb-chip:focus-visible{outline:2px solid ${C.acc};outline-offset:2px;border-radius:6px;}
/* 99.md §3/§4 — concept-card affordances. Hover lifts via box-shadow + transform
   (the base border stays inline, so the "glow" ring rides the shadow instead);
   the chevron rotates; the active card's working surfaces fade-slide in (a soft
   landing wherever the View Transition morph is unavailable). All motion is
   removed under prefers-reduced-motion, matching the pv-* house pattern. */
.sb-card-shell{transition:box-shadow .18s var(--ease-out,cubic-bezier(.22,.61,.36,1)),transform .18s var(--ease-out,cubic-bezier(.22,.61,.36,1));}
.sb-card-shell[data-compact="true"]:hover{box-shadow:0 0 0 1px ${alpha(C.acc,'66')},0 6px 16px var(--t-shadow);transform:translateY(-1px);}
.sb-card-shell[data-compact="true"]:focus-visible{outline:2px solid ${C.acc};outline-offset:2px;}
.sb-card-chevron{transition:transform .18s var(--ease-out,cubic-bezier(.22,.61,.36,1));}
.sb-card-chevron[data-open="true"]{transform:rotate(180deg);}
.sb-card-body-enter{animation:sbCardBodyIn .2s var(--ease-out,cubic-bezier(.22,.61,.36,1));}
@keyframes sbCardBodyIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
/* The board morph (only this tab starts view transitions): calm, quick, no bounce.
   old/new are retimed WITH the group — leaving them at the UA's 250ms default made
   the cross-fade outlast the movement. The root is SNAPPED rather than cross-faded:
   everything outside the board is unchanged by an expand/collapse, so animating the
   default root group only ghosted the whole page under the cards (99.md review). */
::view-transition-group(*){animation-duration:.22s;animation-timing-function:var(--ease-out,cubic-bezier(.22,.61,.36,1));}
::view-transition-old(*),::view-transition-new(*){animation-duration:.22s;animation-timing-function:var(--ease-out,cubic-bezier(.22,.61,.36,1));}
::view-transition-old(root){animation:none;opacity:0;}
::view-transition-new(root){animation:none;opacity:1;}
@media (prefers-reduced-motion: reduce){
  .sb-card-shell,.sb-card-chevron{transition:none!important;}
  .sb-card-shell[data-compact="true"]:hover{transform:none;}
  .sb-card-body-enter{animation:none!important;}
  ::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important;}
}`}</style>

      {/* 97.md Phase 4 — the Regenerate confirmation dialog (exact spec copy). */}
      <RegenerateDialog open={regenOpen} busy={regenBusy} error={regenError}
        onCancel={()=>{ if(!regenBusy){ setRegenOpen(false); setRegenError(''); } }}
        onConfirm={confirmRegenerate}/>

      {/* 85.md A2 — ONE polite announcer for structural changes the eye may miss
          (keyword routing, add outcomes, bulk accepts, undo) — the workspace
          mode-change announcer pattern. */}
      <span role="status" aria-live="polite" data-testid="sb-announcer"
        style={{position:"absolute",width:1,height:1,padding:0,margin:-1,overflow:"hidden",clip:"rect(0 0 0 0)",whiteSpace:"nowrap",border:0}}>
        {announceMsg}
      </span>

      {/* 85.md A2 — feature-local undo snackbar for destructive actions. 97 QA M16
          — after an undo the same surface shows a PLAIN toast describing what was
          undone (no Undo button: there is no redo). */}
      <UndoSnackbar
        message={typeof undoMsg==='string'?undoMsg:(undoMsg&&undoMsg.text)||null}
        onUndo={undoMsg&&typeof undoMsg==='object'&&undoMsg.plain?null:undoLastAction}
        onDismiss={()=>setUndoMsg(null)}/>

      {limitedMode&&(
        <div style={{background:`${alpha(C.yel,"10")}`,border:`1px solid ${alpha(C.yel,"44")}`,borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:C.txt2}}>
          <strong style={{color:C.yel}}>Limited mode.</strong> Live MeSH lookup and PubMed counts are temporarily unavailable, so the builder is using a small offline vocabulary and hit counts are hidden. Your query syntax is still correct and fully usable.
        </div>
      )}

      {/* 97.md Phase 16 — a stale write was rejected; the fresher document was
          adopted. QA M7 — the copy no longer asserts "a collaborator": the newer
          revision can also be this user's own action in another view (restore /
          second tab), so it names the situation honestly. */}
      {conflictNotice&&(
        <div data-testid="sb-conflict-notice" role="status" style={{background:`${alpha(C.yel,"10")}`,border:`1px solid ${alpha(C.yel,"44")}`,borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:C.txt2,display:"flex",alignItems:"center",gap:10}}>
          <span style={{flex:1}}><strong style={{color:C.yel}}>This strategy was updated elsewhere</strong> (a collaborator, or your own action in another view) — your view was refreshed with the newer version. Please re-apply your last change if it is still needed.</span>
          <button onClick={()=>setConflictNotice(false)} aria-label="Dismiss update notice" style={{...btn("ghost"),fontSize:10}}>Got it</button>
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
        <div data-testid="sb-stage-toolbar" data-sb-collapse-exempt="true" style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:12}}>
          <SaveStatusIndicator state={saveState} onRetry={saveNow}/>
          {/* 97.md Phase 4 — regeneration happens ONLY through this explicit button. */}
          {phase==="terms"&&!readOnly&&(
            <button type="button" data-testid="sb-regenerate-btn" onClick={()=>{ setRegenError(''); setRegenOpen(true); }}
              title="Rebuild terms and groups from the current research question and PICO. Asks for confirmation and snapshots your current workspace first."
              style={{...btn("ghost"),fontSize:11}}>
              ↻ Regenerate
            </button>
          )}
          <span style={{marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:10}}>
            {remoteUpdatedBy&&(
              <span title={`This search was just updated by ${remoteUpdatedBy}`} style={{display:"inline-flex",alignItems:"center",gap:4,color:C.acc,fontSize:11,fontFamily:MONO}}>↻ {remoteUpdatedBy}</span>
            )}
            {/* 98.md §5 — the Beginner Mode toggle moved to the SearchWorkspace
                header so it is reachable on EVERY stage (it was builder-only). */}
          </span>
        </div>
      )}

      {/* 85.md A2 — dismissible mental-model intro, now atop the keyword workspace.
          98.md §5 — Beginner-Mode content: hidden in the default experience. */}
      {phase==="terms"&&beginner&&<ConceptsIntroStrip/>}

      {/* ─────────── 98.md §9 — phase 'terms': the HORIZONTAL CONCEPT BOARD.
          Every concept renders as its own bounded card, side by side with visible
          AND/OR connectors between cards (flex-wrap keeps the reading order when
          rows wrap; the connector leads its card so a wrapped row reads
          "AND [card]"). The ACTIVE card carries the working surfaces (add box,
          suggestions, group actions); inactive cards render compact chips and
          activate on click. Replaces the 85.md master-detail navigator+panel
          (96.md QA L2 already deleted the legacy standalone grid). */}
      {show(2)&&(()=>{
        const c=activeConcept;
        const rejectedSet=rejectedSuggestions;
        return(
          <div data-testid="sb-step-organize-concepts">
            {/* 96.md D13.1 + 97.md Phase 5 — the research question SOURCE section
                leads the workspace: click-to-select tokens, Shift-click spans and
                drag-onto-token combine, each creating a search group below. */}
            <QuestionPhraseCard question={question} accent={C.acc}
              isSelected={isPhraseSelected} onTogglePhrase={togglePhrase}
              onCombineSpan={combineQuestionSpan} onAddManual={addManualConcept}
              onEditQuestion={onEditQuestion} readOnly={readOnly} beginner={beginner}/>{/* 98.md §4 — inline editor, never a navigation */}

            {/* 97.md Phase 5 (QA M9) — the protocol's P/I/C/O text as read-only,
                clearly-labeled SOURCE sections (tokens clickable like question
                tokens). Reference only: these fields never control workspace
                organization, and projects without PICO text render nothing. */}
            <PicoSourceSections pico={pico} accent={C.acc}
              isSelected={isPhraseSelected} onTogglePhrase={togglePhrase} readOnly={readOnly}/>

            {/* 96.md D2 — "question changed" drift banner (never auto-deletes).
                QA M4 — rows also offer an inline "Update phrase" editor.
                98.md §4 — deferred while the inline editor session is open, so a
                mid-sentence deletion never flashes the banner. */}
            {questionChanged&&!questionEditing&&(
              <QuestionDriftBanner drifted={drifted} readOnly={readOnly}
                onKeepAll={keepDriftedConcepts}
                onEditConcept={(id)=>selectConcept(id,null,{scroll:true})}
                onUpdatePhrase={(id,phrase)=>updateSourcePhrase(id,phrase)}
                onRemoveConcept={(id)=>removeConcept(id)}/>
            )}

            {/* 97.md Phase 7 — the "Search Quality Check" card is REMOVED (no branding,
                no scores, no severity judgments). Duplicate detection lives ON the
                chips; only two quiet, non-blocking hints remain. */}
            {/* QA M22 — the "restore dismissed" affordance renders whenever ANY
                dismissal is persisted (duplicate warnings included), independent
                of whether quiet hints happen to exist: a dismissed dark-red
                duplicate warning must never become un-restorable. */}
            {(quietHints.length>0||(!readOnly&&dismissedWarnings.length>0))&&(
              <div data-testid="sb-inline-hints" data-sb-collapse-exempt="true" style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:10,padding:"8px 12px",marginBottom:10}}>
                {quietHints.map(w=>(
                  <div key={w.id} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"3px 0",fontSize:11,color:C.muted,lineHeight:1.5}}>
                    <span aria-hidden="true">·</span>
                    <span style={{flex:1}}>{w.message}</span>
                    {!readOnly&&<button onClick={()=>dismissWarning(w.id)} title="Hide this note" style={{...btn("ghost"),fontSize:9.5,padding:"1px 8px"}}>Dismiss</button>}
                  </div>
                ))}
                {!readOnly&&dismissedWarnings.length>0&&(
                  <button onClick={restoreWarnings} title="Show dismissed notes and duplicate warnings again" style={{...btn("ghost"),fontSize:9.5,padding:"1px 8px"}}>restore dismissed ({dismissedWarnings.length})</button>
                )}
              </div>
            )}

            {/* 97.md Phase 12 — same-group duplicate prevention / blocked-move notice
                with the "Find existing term" affordance. */}
            {blockedNotice&&(
              <div data-testid="sb-dup-blocked" data-sb-collapse-exempt="true" role="status" style={{background:`${alpha(C.yel,"10")}`,border:`1px solid ${alpha(C.yel,"44")}`,borderRadius:8,padding:"7px 10px",marginBottom:10,fontSize:11.5,color:C.txt2,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{flex:1,minWidth:200}}>{blockedNotice.text}</span>
                {blockedNotice.tid&&(
                  <button type="button" onClick={()=>{ requestFocusTerm(blockedNotice.cid,blockedNotice.tid); setBlockedNotice(null); }}
                    style={{...btn("solid"),fontSize:10.5}}>Find existing term</button>
                )}
                <button type="button" onClick={()=>setBlockedNotice(null)} aria-label="Dismiss duplicate notice" style={{...btn("ghost"),fontSize:10.5}}>Dismiss</button>
              </div>
            )}

            {/* ── 98.md §9 — THE HORIZONTAL CONCEPT BOARD ──────────────────────
                One bounded card per concept, side by side (flex-wrap), joined by
                visible AND/OR connectors. Each card is the cross-group DROP
                surface (was: navigator pills) and carries the group-reorder/
                merge drag handle in its header. The connector LEADS its card so
                a wrapped row reads "AND [card]" — connectors never strand at a
                row end. Semantics ride the accessible names, never colour alone. */}
            {/* a11y — role="group" (NOT "list"): the board also hosts non-concept
                children (the §6 empty block, the "+ Add concept" ghost card, the
                drag-time "New concept" drop zone), which a list role forbids
                (axe aria-required-children, critical). The group label carries
                the AND semantics; each card is its own labelled <section>. */}
            {/* 99.md §3 — beginner-gated one-liner naming the interaction (the design
                itself — chevron, hover lift, pointer cursor — carries it for everyone). */}
            {beginner&&concepts.length>0&&(
              <p data-testid="sb-board-hint" style={{margin:'0 0 8px',fontSize:11.5,color:C.muted,lineHeight:1.6}}>
                Click a concept to open it for editing — press Escape or click anywhere else to close it.
              </p>
            )}
            <div data-testid="sb-concept-board" role="group" aria-label="Concept groups"
              /* 99.md §8 — Escape collapses the working card from anywhere inside the
                 board that did not already consume it (popovers stopPropagation their
                 own Escape; the add box preventDefaults while its layers dismiss). */
              onKeyDown={(e)=>{ if(e.key==="Escape"&&!e.defaultPrevented&&activeConcept){ e.preventDefault(); collapseBoard({refocus:true}); } }}
              style={{display:'flex',flexWrap:'wrap',alignItems:'stretch',gap:10,marginBottom:4}}>
              {concepts.map((c,cIdx)=>{
                const active=!!(activeConcept&&activeConcept.id===c.id);
                const cStatus=conceptStatus(c,{rejected:rejectedSet});
                // 97.md — MeSH suggestion rows carry a confidence marker where reliable
                // (low-confidence is flagged, NEVER auto-added) and exact MeSH wording.
                const pending=(active?pendingSuggestions(c,rejectedSet):[])
                  .map(s=>s.kind==='mesh'
                    ?{...s,confidence:meshConfidence(s.sourceText,s.text),why:`Standard MeSH term for "${s.sourceText}"`}
                    :s);
                const hasAnyText=(c.terms||[]).some(t=>(t.text||"").trim());
                const isTimeFrame=c.picoField==="T";
                // 98.md review (M5) — the connector must show the operator the
                // compilers will ACTUALLY use: composeConcepts joins surviving
                // blocks with the previous SURVIVING block's op. When the previous
                // card is empty or a Time-frame note (never compiles), the live
                // operator comes from the nearest preceding LIVE concept — and when
                // either side doesn't compile at all, the connector is inert (a
                // muted glyph, no toggle promise the compiled query won't keep).
                const isLiveConcept=(x)=>!!x&&x.picoField!=="T"&&liveTermsOf(x).length>0;
                const prevC=cIdx>0?concepts[cIdx-1]:null;
                let prevLive=null;
                for(let k=cIdx-1;k>=0;k--){ if(isLiveConcept(concepts[k])){ prevLive=concepts[k]; break; } }
                const connectorTarget=(prevC&&isLiveConcept(prevC))?prevC:((isLiveConcept(c)&&prevLive)?prevLive:null);
                const prevOp=connectorTarget?(connectorTarget.op||"AND"):"AND";
                const insertLineEl=(
                  <span data-testid="sb-pill-insert-line" aria-hidden="true"
                    style={{display:'inline-block',width:3,alignSelf:'stretch',minHeight:40,borderRadius:2,background:C.acc,boxShadow:`0 0 0 1px ${alpha(C.acc,'66')}`,flexShrink:0}}/>
                );
                return(
                  <div key={c.id||cIdx}
                    style={{display:'flex',alignItems:'stretch',gap:10,boxSizing:'border-box',maxWidth:'100%',
                      // 98.md §9 — the active (working) card takes the full row for its
                      // editing surfaces; inactive cards sit side by side and wrap
                      // naturally by viewport width (no horizontal-scroll-only path).
                      flex:active?'1 1 100%':'1 1 300px',
                      minWidth:active?undefined:260,
                      // 99.md §4 — during a morph each card owns a stable
                      // view-transition name, so the transition tracks THIS card's box
                      // across the reflow (uid() is [0-9a-z]*; the prefix keeps the
                      // custom-ident valid). Applied ONLY while morphing — a permanent
                      // name would leave every card a stacking context and paint
                      // card-overflowing popovers under the following cards.
                      ...(morphing?{viewTransitionName:`sb-card-${String(c.id||cIdx).replace(/[^a-zA-Z0-9_-]/g,'')}`}:null)}}>
                    {pillInsertIndex===cIdx&&insertLineEl}
                    {cIdx>0&&(
                      /* 98.md §9 — the polished AND connector: clearly not a term chip,
                         semantic text in the accessible name, and (96.md D13.4) still
                         the between-group operator TOGGLE for editors. Review (M5) —
                         a connector adjacent to a non-compiling card renders INERT. */
                      <span style={{display:'flex',alignItems:'center',flexShrink:0}}>
                        {connectorTarget?(
                          <button type="button" data-testid="sb-and-connector"
                            disabled={!!readOnly}
                            onClick={readOnly?undefined:()=>updateConcept(connectorTarget.id,{op:prevOp==="OR"?"AND":"OR"})}
                            aria-label={`${connectorTarget.label||'The previous concept'} is combined with ${c.label||`Concept ${cIdx+1}`} using ${prevOp}${readOnly?'':` — activate to switch to ${prevOp==="OR"?"AND":"OR"}`}`}
                            title={readOnly?undefined:`Records must match ${prevOp==="OR"?"either concept":"both concepts"}. Click to switch to ${prevOp==="OR"?"AND":"OR"}.`}
                            style={{fontFamily:MONO,fontSize:10.5,fontWeight:800,letterSpacing:0.8,color:prevOp==="OR"?C.yel:C.acc,
                              background:alpha(prevOp==="OR"?C.yel:C.acc,'0e'),border:`1.5px solid ${alpha(prevOp==="OR"?C.yel:C.acc,'55')}`,
                              borderRadius:7,padding:'5px 8px',cursor:readOnly?'default':'pointer',flexShrink:0}}>
                            {prevOp}
                          </button>
                        ):(
                          <span data-testid="sb-and-connector-inert" aria-hidden="true"
                            title="Takes effect once both neighbouring concepts have terms"
                            style={{fontFamily:MONO,fontSize:10.5,fontWeight:800,letterSpacing:0.8,color:C.dim,
                              border:`1.5px dashed ${C.brd2}`,borderRadius:7,padding:'5px 8px',flexShrink:0}}>
                            AND
                          </span>
                        )}
                      </span>
                    )}
                    <ActiveConceptPanel concept={c} conceptIndex={cIdx} status={cStatus}
                      readOnly={readOnly}
                      active={active} compact={!active} beginner={beginner}
                      testId={active?'sb-active-concept':'sb-concept-card'}
                      onActivate={active?null:()=>{ /* 98.md review (L8) — the trailing click after EITHER drag kind must not activate */ if((pillDrag.wasDragClick&&pillDrag.wasDragClick())||(chipDrag.wasDragClick&&chipDrag.wasDragClick())) return; selectConcept(c.id); }}
                      onCollapse={active?()=>collapseBoard({refocus:true}):null} /* 99.md — the chevron collapses the working card */
                      dragHandle={readOnly?null:pillDrag.handleFor(c.id,{})}
                      registerEl={(el)=>{ pillEls.current[c.id]=el; }}
                      isDropTarget={(chipDropGroupId||pillMergeTargetId)===c.id}
                      suggestionCount={suggCounts.perConcept[c.id]||0}
                      onRename={readOnly?null:(label)=>updateConcept(c.id,{label})}
                      onRenameCommit={readOnly?null:commitRename}
                      onRenameBegin={readOnly?null:()=>beginRenameTracking(c.id)} /* 98.md review (M4) — compact-card renames get their own undo session */
                      onUpdateSourcePhrase={readOnly?null:(phrase)=>updateSourcePhrase(c.id,phrase)}
                      onRequestSplit={readOnly||((c.terms||[]).filter(t=>(t.text||"").trim()).length<2)?null
                        :()=>{setSplitDraft({cid:c.id,selected:{},label:""});setMergeOpen(false);setConfirmDeleteId(null);}}>
                      {!active?(
                        /* Compact card — the concept's chips at a glance; any
                           interaction activates the card (editing surfaces open there). */
                        isTimeFrame?(
                          <div style={{fontSize:11,color:c.note?C.txt2:C.muted}}>
                            {c.note?<span><span style={{color:C.muted}}>⏱ </span><span style={{fontWeight:600}}>{c.note}</span></span>
                              :<span style={{fontStyle:"italic"}}>No time restriction set</span>}
                          </div>
                        ):hasAnyText?(
                          <TermChipRow
                            concept={c}
                            beginner={beginner}
                            syntaxDbs={effectiveDbs}
                            readOnly={readOnly}
                            dupSignalFor={dupSignalFor}
                            editingTermId={null}
                            onOpenEditor={(tid)=>{ if(chipDrag.wasDragClick&&chipDrag.wasDragClick()) return; /* 99.md — the editing target rides the SAME commit as the activation (a later commit would be closed by the stale-editor effect) */ selectConcept(c.id,()=>setEditing({conceptId:c.id,termId:tid})); }}
                            onRemove={(tid)=>removeTerm(c.id,tid)}
                            dragState={chipDrag.state}
                            dragHandleFor={readOnly?null:(tid)=>chipDrag.handleFor(tid,{conceptId:c.id})}
                            registerChipEl={(tid,el)=>{ chipEls.current[tid]=el; }}
                            focusTermId={focusTerm&&focusTerm.cid===c.id?focusTerm.tid:null}
                            onFocusedTerm={()=>setFocusTerm(null)}
                            onAddEntryTerm={readOnly?null:(_tid,text)=>addEntryTerm(c.id,text)}
                          />
                        ):(
                          readOnly?(
                            <div style={{fontSize:11,color:C.muted,fontStyle:'italic'}}>No terms yet.</div>
                          ):(
                            /* 98.md review (H14) — a real button, so an emptied
                               compact card stays keyboard-reachable. */
                            <button type="button" onClick={()=>selectConcept(c.id)}
                              style={{background:'none',border:'none',padding:0,fontSize:11,color:C.acc,fontStyle:'italic',cursor:'pointer',fontFamily:SANS,textDecoration:'underline'}}>
                              No terms yet — select the card to add some.
                            </button>
                          )
                        )
                      ):(<>{/* Active card — the full working surfaces follow. */}
                {/* 96.md D13.3 — group management for ANY group (legacy PICO groups
                    included — the picoField delete-guard is retired): reorder up/down,
                    merge into another group, split terms out, delete with an inline
                    confirm. Every operation is undoable via the snackbar. */}
                {!readOnly&&(
                  <div data-testid="sb-group-actions" style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:10}}>
                    <span style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginRight:2}}>Concept</span>
                    <button type="button" onClick={()=>moveConceptBy(c.id,-1)} disabled={cIdx===0} aria-label={`Move ${c.label} up`} title="Move this concept earlier in the search" style={{...btn("ghost"),fontSize:10,padding:"3px 9px",opacity:cIdx===0?0.45:1}}>↑ Move up</button>
                    <button type="button" onClick={()=>moveConceptBy(c.id,1)} disabled={cIdx>=concepts.length-1} aria-label={`Move ${c.label} down`} title="Move this concept later in the search" style={{...btn("ghost"),fontSize:10,padding:"3px 9px",opacity:cIdx>=concepts.length-1?0.45:1}}>↓ Move down</button>
                    <span style={{position:"relative",display:"inline-block"}}
                      onKeyDown={(e)=>{ if(e.key==="Escape"&&mergeOpen){ e.stopPropagation(); setMergeOpen(false); } /* 99.md — layered dismissal */ }}>
                      <button type="button" onClick={()=>{setMergeOpen(o=>!o);setSplitDraft(null);setConfirmDeleteId(null);}} aria-expanded={mergeOpen} aria-label={`Merge ${c.label} into another concept`} disabled={concepts.length<2} style={{...btn("ghost"),fontSize:10,padding:"3px 9px",opacity:concepts.length<2?0.45:1}}>⇄ Merge into…</button>
                      {mergeOpen&&(
                        <span style={{position:"absolute",zIndex:75,top:"100%",left:0,marginTop:4,background:C.card,border:`1px solid ${C.brd2}`,borderRadius:8,boxShadow:"0 14px 40px var(--t-shadow)",overflow:"hidden",minWidth:200}}>
                          <span style={{display:"block",fontSize:9,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",padding:"6px 10px 2px"}}>Merge “{c.label}” into</span>
                          {/* QA M21 — Time-frame note groups render no term chips, so terms
                              merged into one would be stranded invisible: never a target. */}
                          {concepts.filter(x=>x.id!==c.id&&x.picoField!=="T").map(x=>(
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
                      /* 99.md review (a11y) — the destructive confirm is a transient
                         layer like the merge/split pickers: Escape CANCELS it and is
                         consumed there (without this the keydown reached the board and
                         collapsed the whole card), and focus lands on Cancel when the
                         row opens — the "× Delete concept" button that had focus is
                         unmounted by this very swap, which otherwise drops focus to
                         <body> and strands the keyboard user (WCAG 2.4.3). */
                      <span style={{display:"inline-flex",alignItems:"center",gap:6,marginLeft:"auto"}}
                        onKeyDown={(e)=>{ if(e.key==="Escape"){ e.stopPropagation(); restoreDeleteFocusRef.current=true; setConfirmDeleteId(null); } }}>
                        <span style={{fontSize:10.5,color:C.yel}}>
                          Delete “{c.label}”{(()=>{const n=(c.terms||[]).filter(t=>(t.text||"").trim()).length;return n?` and its ${n} term${n===1?"":"s"}`:"";})()}?
                        </span>
                        <button type="button" onClick={()=>{setConfirmDeleteId(null);removeConcept(c.id);}} aria-label={`Confirm delete ${c.label}`} style={{...btn("danger"),fontSize:10,padding:"3px 9px"}}>Delete</button>
                        <button type="button" ref={(el)=>{ if(el&&confirmFocusRef.current!==c.id){ confirmFocusRef.current=c.id; try{ el.focus(); }catch{ /* best-effort */ } } }}
                          onClick={()=>{ restoreDeleteFocusRef.current=true; setConfirmDeleteId(null); }} style={{...btn("ghost"),fontSize:10,padding:"3px 9px"}}>Cancel</button>
                      </span>
                    ):(
                      /* 99.md review (a11y) — cancelling the confirm unmounts the button
                         that had focus, so focus returns HERE (one-shot, and only when
                         the confirm was actually cancelled — a collapse must not pull
                         focus back into a card it just closed). */
                      <button type="button" ref={(el)=>{ if(el&&restoreDeleteFocusRef.current){ restoreDeleteFocusRef.current=false; try{ el.focus(); }catch{ /* best-effort */ } } }}
                        onClick={()=>{setConfirmDeleteId(c.id);setMergeOpen(false);setSplitDraft(null);}} aria-label={`Delete concept ${c.label}`} title="Delete this concept (undoable)" style={{...btn("danger"),fontSize:10,padding:"3px 9px",marginLeft:"auto"}}>× Delete concept</button>
                    )}
                  </div>
                )}
                {splitDraft&&splitDraft.cid===c.id&&(
                  <div data-testid="sb-split-panel"
                    onKeyDown={(e)=>{ if(e.key==="Escape"){ e.stopPropagation(); setSplitDraft(null); } /* 99.md — layered dismissal */ }}
                    style={{background:C.surf,border:`1px solid ${C.brd2}`,borderRadius:8,padding:"9px 11px",marginBottom:10}}>
                    <div style={{fontSize:10.5,fontWeight:700,color:C.muted,letterSpacing:.4,textTransform:"uppercase",marginBottom:6}}>Move selected terms to a new concept</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                      {(c.terms||[]).filter(t=>(t.text||"").trim()).map(t=>{
                        const on=!!splitDraft.selected[t.id];
                        return(
                          <label key={t.id} style={{display:"inline-flex",alignItems:"center",gap:5,background:on?alpha(C.acc,"14"):C.card,border:`1px solid ${on?alpha(C.acc,"66"):C.brd2}`,borderRadius:6,padding:"3px 8px",fontSize:11,color:C.txt2,cursor:"pointer"}}>
                            <input type="checkbox" checked={on} onChange={()=>setSplitDraft(s=>({...s,selected:{...s.selected,[t.id]:!s.selected[t.id]}}))} aria-label={`Select ${t.text} for the new concept`}/>
                            {t.text}
                          </label>
                        );
                      })}
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                      <input value={splitDraft.label} onChange={e=>setSplitDraft(s=>({...s,label:e.target.value}))} placeholder="New concept name…" aria-label="New concept name" style={{...inputStyle,flex:1,minWidth:160,fontSize:11.5}}/>
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
                        <strong style={{color:C.yel}}>Limited mode.</strong> Live MeSH lookup is temporarily unavailable — terms still work; MeSH records attach when the service returns.
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
                          syntaxDbs={effectiveDbs}
                          readOnly={readOnly}
                          dupSignalFor={dupSignalFor}
                          editingTermId={editing&&editing.conceptId===c.id?editing.termId:null}
                          onOpenEditor={(tid)=>{ if(chipDrag.wasDragClick&&chipDrag.wasDragClick()) return; setEditing(editing&&editing.termId===tid?null:{conceptId:c.id,termId:tid}); }}
                          onRemove={(tid)=>removeTerm(c.id,tid)}
                          dragState={chipDrag.state}
                          dragHandleFor={readOnly?null:(tid)=>chipDrag.handleFor(tid,{conceptId:c.id})}
                          registerChipEl={(tid,el)=>{ chipEls.current[tid]=el; }}
                          focusTermId={focusTerm&&focusTerm.cid===c.id?focusTerm.tid:null}
                          onFocusedTerm={()=>setFocusTerm(null)}
                          onAddEntryTerm={readOnly?null:(_tid,text)=>addEntryTerm(c.id,text)}
                          renderEditor={(t)=>{
                            const sig=dupSignalFor(t);
                            const other=sig&&sig.others&&sig.others.find(o=>o.conceptId!==c.id);
                            const tIdx=(c.terms||[]).findIndex(x=>x&&x.id===t.id);
                            const combinable=(c.terms||[]).filter(x=>x&&x.id!==t.id&&String(x.text||'').trim()).map(x=>({id:x.id,text:x.text}));
                            return(
                              <TermEditorPopover
                                term={t}
                                beginner={beginner}
                                moveTargets={moveTargetsFor(c.id)}
                                onReorder={(delta)=>moveTermBy(c.id,t.id,delta)}
                                canMoveEarlier={tIdx>0}
                                canMoveLater={tIdx>=0&&tIdx<(c.terms||[]).length-1}
                                dupInfo={sig?{
                                  kind:sig.kind,
                                  intentional:sig.intentional,
                                  otherLabel:(other&&other.conceptLabel)||(sig.others&&sig.others[0]&&sig.others[0].conceptLabel)||'another group',
                                  onFindOther:sig.others&&sig.others.length?()=>{
                                    const target=other||sig.others[0];
                                    requestFocusTerm(target.conceptId,target.termId);
                                  }:null,
                                  onMoveThere:other?()=>consolidateDupCopy(c.id,t.id,other):null, // QA M17 — consolidates (a literal move is always blocked by the copy already there)
                                  onRemoveCopy:()=>{ removeTerm(c.id,t.id); setEditing(null); },
                                  onKeepBoth:sig.kind==='exact-cross'?()=>keepBothIntentionally(t):null,
                                  onUnkeep:sig.intentional?()=>unkeepDup(t):null,
                                  onDismiss:sig.kind==='exact-cross'?()=>{ dismissWarning(sig.id); setEditing(null); }:null,
                                }:null}
                                preview={renderTerm(t,activeDB)}
                                onChange={(patch)=>updateTerm(c.id,t.id,patch)}
                                onClose={()=>setEditing(null)}
                                onLookup={(text,force)=>tryLookup(c.id,t.id,text,force)}
                                onToggleDisabled={()=>toggleTermDisabled(c.id,t.id)}
                                onMove={(toCid)=>doMoveTerm(c.id,t.id,toCid)}
                                onMoveToNewGroup={()=>{ moveTermToNewGroup(c.id,t.id); setEditing(null); }}
                                onCopyTo={(toCid)=>doCopyTerm(c.id,t.id,toCid)}
                                combineTargets={combinable}
                                onCombineWith={(otherId)=>doCombineTerms(c.id,[t.id,otherId])}
                                onSplitPhrase={Array.isArray(t.components)&&t.components.length>1&&componentsMatchText(t)?()=>doSplitPhrase(c.id,t.id):null} /* QA M14 — an EDITED combined phrase never auto-splits from stale components; the safe manual split applies */
                                onManualSplit={(parts)=>doSplitPhrase(c.id,t.id,parts)}
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
                        open={!!suggOpen[c.id]} /* 98.md §11 — hidden by default; per-concept session state */
                        onToggleOpen={()=>setSuggOpen(o=>({...o,[c.id]:!o[c.id]}))}
                        onAccept={(s)=>acceptSuggestion(c.id,s)}
                        onAcceptMany={(items)=>acceptSuggestionsBulk(c.id,items)} /* 98.md §11 round 2 — checkbox bulk add */
                        onDismiss={dismissSuggestion}
                        onAcceptEntryTerm={(_s,syn)=>addEntryTerm(c.id,syn)}
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
                            /* 100.md §1 — the strategy preview that used to host this
                               toggle is retired; the live control is the AND/OR chip
                               between the two cards on the board. */
                            return <span>Combined with <strong>{next.label}</strong> using <strong style={{color:(c.op||"AND")==="OR"?C.yel:C.acc}}>{c.op||"AND"}</strong> — switch it with the <strong>{c.op||"AND"}</strong> chip between the two concept cards.</span>;
                          })()}
                        </div>
                        <div style={{fontSize:10.5,color:C.muted,fontFamily:MONO,wordBreak:"break-word"}}>
                          This concept compiles to: {renderConcept(c,activeDB)||"(nothing yet)"}
                        </div>
                      </Disclosure>
                    </div>
                  </>
                )}
              </>)}
                    </ActiveConceptPanel>
                  </div>
                );
              })}
              {/* Insertion line after the LAST card (drop a reordered concept at the end). */}
              {pillInsertIndex===concepts.length&&(
                <span data-testid="sb-pill-insert-line" aria-hidden="true"
                  style={{display:'inline-block',width:3,alignSelf:'stretch',minHeight:40,borderRadius:2,background:C.acc,boxShadow:`0 0 0 1px ${alpha(C.acc,'66')}`,flexShrink:0}}/>
              )}
              {/* 97.md Phase 11 — during a chip drag, a "New concept" drop zone appears
                  so a term can be dragged straight into a brand-new concept group. */}
              {!!(chipDrag.state&&chipDrag.state.active)&&(
                <span
                  data-testid="sb-new-group-target"
                  ref={(el)=>{ newGroupEl.current=el; }}
                  style={{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,flexShrink:0,fontSize:11.5,fontWeight:700,
                    color:C.acc,background:alpha(C.acc,'0c'),border:`2px dashed ${C.acc}`,borderRadius:10,padding:'14px 18px',minWidth:140}}>
                  ＋ New concept
                </span>
              )}
              {/* 98.md §6 — the INTENTIONALLY EMPTY start: no auto-created concepts, one
                  clean primary action. QA M8 — mutating controls hidden for viewers. */}
              {concepts.length===0?(
                readOnly?(
                  <div data-testid="sb-empty-board" style={{flex:'1 1 100%',background:C.surf,border:`1px dashed ${C.brd2}`,borderRadius:10,padding:'18px 20px',fontSize:12,color:C.muted}}>
                    No concept groups yet.
                  </div>
                ):(
                  <div data-testid="sb-empty-board" style={{flex:'1 1 100%',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',background:C.surf,border:`1px dashed ${C.brd2}`,borderRadius:10,padding:'18px 20px'}}>
                    <button type="button" data-testid="sb-create-first-concept" onClick={addConcept}
                      style={{...btn("primary"),fontSize:12.5,padding:'9px 18px'}}>
                      Create first concept
                    </button>
                    <span style={{fontSize:11.5,color:C.muted,lineHeight:1.6,flex:1,minWidth:200}}>
                      …or click a phrase in your research question above — each key idea becomes a concept.
                    </span>
                  </div>
                )
              ):(
                /* '+ Add concept' — a slim ghost card at the end of the AND chain. */
                !readOnly&&!(chipDrag.state&&chipDrag.state.active)&&(
                  <button onClick={addConcept} data-testid="sb-add-concept-card"
                    style={{...btn("ghost"),borderStyle:"dashed",borderRadius:10,minWidth:130,alignSelf:'stretch',justifyContent:"center",flexShrink:0}}>
                    + Add concept
                  </button>
                )
              )}
            </div>

            {/* ─── 100.md §§1-2/6-11 — ONE panel replaces TWO ───────────────────
                RETIRED here:
                 · "Your search so far" (StrategyPreviewPanel). Every capability it
                   carried already lives somewhere better: the PubMed count chip +
                   retry is the sticky PubMedPulse header (SearchWorkspace.jsx), the
                   between-concept AND/OR toggle is `sb-and-connector` ON the board
                   (where both operands are visible, and where it correctly renders
                   inert next to a concept that does not compile), click-to-select and
                   the "editing" state are the board cards themselves, and the raw
                   PubMed string is in the disclosure below. It was a second, weaker
                   copy of the board — 100.md §1: do not keep UI just because it exists.
                 · "Database previews" (sb-db-previews) — 16 always-expanded compiled
                   syntax panels between the board and the limits. 100.md §2: the
                   search-building screen is for concepts, terms, vocabulary and
                   MEANING; the technical strings live one click away here and, fully
                   editable, on the Database Strategies stage / the run surface.
                The compiler system itself is untouched — `compiledAll` still feeds
                both surfaces from the same memo. */}
            <div style={{marginTop:12}}>
              <SearchMeaningPanel
                concepts={concepts}
                filters={filters}
                compiled={liveTermCount>0?compiledAll:null}
                technicalHint={TECHNICAL_HINT}
              />
            </div>
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
              {/* 98.md §5 — the repeated AND/OR explainer is Beginner-Mode content. */}
              {beginner&&<div style={{fontSize:11,color:C.muted,marginTop:10,lineHeight:1.55}}>
                Similar terms inside one concept are joined with <strong style={{color:C.yel}}>OR</strong> (any one counts); different concepts are joined with <strong style={{color:C.acc}}>AND</strong> (all must appear).
              </div>}
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
                setOverride={readOnly?null:(val=>{ touchMeta(); /* QA M6 — a manual db-strategy override edit is a manual modification */ setOverrides(o=>{const n={...o}; if(val==null) delete n[res.dbId]; else n[res.dbId]=val; return n;}); })}
                hitState={res.dbId==="pubmed"?hitState:null}/>
            ))}
          </div>
        );
      })()}

    </div>
  );
}
