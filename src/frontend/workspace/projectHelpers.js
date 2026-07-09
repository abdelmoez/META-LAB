/* ════════════ SHARED PROJECT HELPERS / CONFIG ════════════
   Extracted VERBATIM from meta-lab-3-patched.jsx (prompt46 Phase 6a).

   These are the project-level helpers, workflow config, and the GRADE bits
   that are not React tab components: mkProject / mkStudy / TABS / PHASES /
   READING_TABS / PHASE_ICON / readinessCheck / stepStatus / auditProject /
   projectPerms / linkedSiftId / CTRL_STATUS_OPTIONS / GRADE_OPTIONS /
   gradeSuggestions / interpretResult. Moved with NO logic changes; the
   monolith imports them back. The actual TAB COMPONENTS stay in the monolith
   for later batches.

   `uid` / `now` are the monolith's OWN inline utils (verbatim copies kept here
   so this module resolves identically without re-pointing to defaults.js). */
import { C } from "./ui/styles.js";
import { ES_TYPES, ROB2, PRISMA_CL } from "../../research-engine/project-model/monolithConstants.js";
import { runMeta, eggersTest, validateStudy, findDuplicates, checkPoolability } from "../../research-engine/statistics/monolithStats.js";
import { fmtNum, fmtES, fmtPct } from "../../research-engine/format/precision.js";
import { timeframeComplete } from "../../features/protocol/index.js";

/* monolith-local utils (verbatim from meta-lab-3-patched.jsx) */
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

/* ════════════ DEFAULTS ════════════ */
export const mkProject = name => ({
  id:uid(),name,created:now(),modified:now(),
  pico:{question:"",P:"",I:"",C:"",O:"",studyDesign:"RCT",timeframe:"",prosperoId:"",keywords:"",
    incl:"",excl:"",notes:""},
  search:{dbs:{PubMed:false,Embase:false,"Cochrane CENTRAL":false,"Web of Science":false,Scopus:false,CINAHL:false,PsycINFO:false,LILACS:false,"Google Scholar":false,"ClinicalTrials.gov":false,"WHO ICTRP":false,OpenAlex:false},date:"",string:"",notes:""},
  prisma:{dbs:"",reg:"",other:"",dedupe:"",screened:"",excTA:"",excFull:"",reasons:[{id:uid(),r:"",n:""}],included:"",qual:"",quant:""},
  records:[],   // imported citations for screening: {id,title,authors,year,journal,doi,abstract,source,decision,reviewer2,notes,dupOf}
  studies:[],robMethod:"RoB2",reportChecked:{},
  // Display/export precision (prompt15 Task 1) — calculations stay full precision;
  // this only controls rounding at the UI/export edge. Legacy projects default to 3 dp.
  analysisPrecision:{decimals:3,trailingZeros:true},
});
export const mkStudy = () => ({id:uid(),author:"",year:"",country:"",design:"RCT",n:"",outcome:"",
  // citation metadata (auto-fillable from PMID/DOI)
  title:"",authors:"",journal:"",doi:"",pmid:"",abstract:"",
  // study-level descriptive metadata
  dataSource:"",        // e.g. registry, RCT, claims database
  enrollPeriod:"",      // enrollment / recruitment dates
  populationDef:"",interventionDef:"",comparatorDef:"",
  primaryOutcome:"",secondaryOutcomes:"",funding:"",
  esType:"",            // SMD | MD | OR | RR | HR | COR | PROP | "" (effect measure on the ES scale)
  timepoint:"",         // e.g. "12 weeks" — distinguishes multiple follow-ups of same outcome
  followup:"",
  adjusted:"unadjusted",// adjustment status (expanded options) — never silently mix
  dataNature:"primary", // methodological role of the estimate (see DATA_NATURE)
  flags:[],             // reliability flags (see EXTRACT_FLAGS)
  // raw continuous
  nExp:"",nCtrl:"",meanExp:"",sdExp:"",meanCtrl:"",sdCtrl:"",
  // raw dichotomous 2x2 (a=event/exp b=noevent/exp c=event/ctrl d=noevent/ctrl)
  a:"",b:"",c:"",d:"",
  // raw single-arm proportion
  events:"",total:"",
  // raw diagnostic accuracy
  tp:"",fp:"",fn:"",tn:"",
  // final effect-size + CI on analysis scale (log scale for OR/RR/HR, z for COR)
  es:"",lo:"",hi:"",
  source:"",            // physical location: text | table | figure | supplement | calculated | author
  // conversion audit trail — original is NEVER overwritten
  converted:false,      // true if any value here was derived via a conversion
  conversions:[],       // [{id,target,type,method,reason,original,result,at}]
  needsReview:false,    // needs second-reviewer confirmation
  extractedBy:"",extractedAt:"",  // reviewer initials + ISO timestamp
  addedAt:"",updatedAt:"",        // prompt15 Task 3 — optional timestamps for "recently added/modified" sorts
  rob:{},notes:""});

/* ════════════ RESULT INTERPRETATION ════════════ */
export function interpretResult(result,esType,studies,prec){
  if(!result) return null;
  const t=ES_TYPES[esType]||{};
  const isRatio=t.log;
  const isProp=esType==="PROP";
  // back-transform pooled estimate for display
  const disp=(x)=>{
    if(isRatio) return Math.exp(x);
    if(isProp){const e=Math.exp(x);return e/(1+e);}
    return x;
  };
  // No-effect value. Ratio → 1 (display) / 0 (log analysis scale). Proportion → none.
  // Other additive measures default to 0, but honour a measure-specific null (e.g. AUC
  // has no-discrimination at 0.5) so "crosses null" / significance are judged correctly.
  const analysisNull = isRatio ? 0 : (isProp ? null : (t.nullVal != null ? t.nullVal : 0));
  const nullV=isRatio?1:(isProp?null:(t.nullVal!=null?t.nullVal:0));
  const pe=disp(result.pES),lo=disp(result.lo95),hi=disp(result.hi95);
  const sigByCI = isRatio ? (result.lo95>0||result.hi95<0)
    : (analysisNull==null ? (result.lo95>0||result.hi95<0)
       : (result.lo95>analysisNull||result.hi95<analysisNull));
  const scaleName=t.scale||esType||"effect size";
  // direction
  let direction;
  if(isProp){direction=`a pooled proportion of ${fmtPct(pe,prec)}%`;}
  else if(isRatio){
    direction = result.pES>0?`an increase (${scaleName.replace('ln','')} ${fmtES(pe,prec)} > 1)`:result.pES<0?`a reduction (${scaleName.replace('ln','')} ${fmtES(pe,prec)} < 1)`:"no difference";
  } else {
    direction = result.pES>0?"a positive effect (favouring the higher value)":result.pES<0?"a negative effect (favouring the lower value)":"no difference";
  }
  // magnitude (SMD only — Cohen benchmarks)
  let magnitude="";
  if(esType==="SMD"){const a=Math.abs(result.pES);magnitude=a<0.2?"negligible":a<0.5?"small":a<0.8?"moderate":"large";magnitude=` The standardized effect is ${magnitude} by Cohen's benchmarks.`;}
  // CI text
  const ciText=isProp
    ? `95% CI ${fmtPct(lo,prec)}%–${fmtPct(hi,prec)}%`
    : isRatio
      ? `${scaleName.replace('ln','')} ${fmtES(pe,prec)}, 95% CI ${fmtES(lo,prec)}–${fmtES(hi,prec)}`
      : `${fmtES(pe,prec)}, 95% CI ${fmtES(lo,prec)} to ${fmtES(hi,prec)}`;
  const crossesNull = nullV!==null && !sigByCI;
  // heterogeneity
  const hetText=`I² = ${result.I2}% (${result.I2desc} heterogeneity), Q p ${result.Qpval<0.001?"< 0.001":"= "+fmtNum(result.Qpval,prec)}`;
  // reliability flags
  const flags=[];
  if(result.k<5) flags.push(`Only ${result.k} studies were pooled — the estimate is imprecise and small-study effects can't be assessed.`);
  if(result.I2>=75) flags.push("Heterogeneity is considerable; the pooled point estimate may not represent any single setting well.");
  else if(result.I2>=50) flags.push("Substantial heterogeneity means the true effect likely varies across studies — interpret the summary cautiously.");
  if(crossesNull) flags.push("The confidence interval crosses the no-effect line, so the result is statistically inconclusive.");
  const robMissing=studies.filter(s=>s.es!==""&&Object.keys(s.rob||{}).length===0).length;
  if(robMissing>0) flags.push(`${robMissing} included stud${robMissing===1?"y has":"ies have"} no risk-of-bias assessment — judge credibility before trusting this estimate.`);

  return {pe,lo,hi,ciText,direction,magnitude,hetText,crossesNull,sigByCI,flags,isRatio,isProp,nullV,scaleName};
}

/* ════════════ GRADE ════════════ */
export const GRADE_OPTIONS=[
  {v:"not_serious",label:"Not serious",color:C.grn,modifier:0},
  {v:"serious",label:"Serious",color:C.yel,modifier:-1},
  {v:"very_serious",label:"Very serious",color:C.red,modifier:-2},
];

/* Evidence-linked GRADE suggestions derived from the actual analysis.
   Returns { domainId: {suggest, reason} } so the user can one-click apply or override. */
export function gradeSuggestions(project){
  const studies=(project.studies||[]).filter(s=>s.es!==""&&!isNaN(+s.es));
  const robMethod=project.robMethod||"RoB2";
  const result=runMeta(studies,"random");
  const egger=eggersTest(studies);
  const out={};

  // ── Risk of Bias: from per-study RoB judgements ──
  if(studies.length){
    let high=0, some=0, low=0, none=0;
    studies.forEach(s=>{
      const rob=s.rob||{};
      if(robMethod==="RoB2"){
        const vals=ROB2.map(d=>rob[d.id]);
        if(!vals.some(Boolean)){ none++; return; }
        if(vals.some(v=>v==="High")) high++;
        else if(vals.some(v=>v==="Some concerns")) some++;
        else if(vals.every(v=>v==="Low")) low++;
        else none++;
      } else {
        const stars=Object.values(rob).filter(v=>v==="★").length;
        if(!Object.keys(rob).length){ none++; return; }
        if(stars>=7) low++; else if(stars>=4) some++; else high++;
      }
    });
    const assessed=high+some+low;
    if(assessed===0){
      out.rob={suggest:null,reason:`No studies have a risk-of-bias assessment yet. Complete the Risk of Bias tab — GRADE can then suggest this domain automatically.`};
    } else {
      const highFrac=high/assessed, someFrac=some/assessed;
      let sug="not_serious", why=`Most assessed studies are at low risk (${low}/${assessed} low, ${some} some-concerns, ${high} high).`;
      if(highFrac>=0.5){ sug="very_serious"; why=`${high}/${assessed} studies are at high risk of bias — a major limitation.`; }
      else if(highFrac>0||someFrac>=0.5){ sug="serious"; why=`${high} high-risk and ${some} some-concern studies of ${assessed} assessed suggest serious limitations.`; }
      if(none>0) why+=` (${none} not yet assessed.)`;
      out.rob={suggest:sug,reason:why};
    }
  }

  // ── Inconsistency: from I² + whether CIs overlap ──
  if(result){
    let sug="not_serious", why=`I² = ${result.I2}% (${result.I2desc}) indicates consistent results.`;
    if(result.I2>=75){ sug="very_serious"; why=`I² = ${result.I2}% (considerable heterogeneity) — results are highly inconsistent across studies.`; }
    else if(result.I2>=50){ sug="serious"; why=`I² = ${result.I2}% (substantial heterogeneity) with Q-test p ${result.Qpval<0.05?"< 0.05":"= "+result.Qpval.toFixed(2)}.`; }
    out.inconsistency={suggest:sug,reason:why};
  }

  // ── Imprecision: from k, total N, and whether CI crosses the null ──
  if(result){
    const esType=(studies.map(s=>s.esType).filter(Boolean)[0])||"";
    const isLog=ES_TYPES[esType]?.log;
    const crosses=isLog?(Math.exp(result.lo95)<1&&Math.exp(result.hi95)>1):(result.lo95<0&&result.hi95>0);
    let sug="not_serious", why=`The 95% CI is reasonably narrow and ${crosses?"":"excludes the null"}.`;
    if(crosses&&result.k<5){ sug="very_serious"; why=`Few studies (k=${result.k}) and the CI crosses the null — the estimate is very imprecise.`; }
    else if(crosses||result.k<5){ sug="serious"; why=crosses?`The 95% CI crosses the no-effect line, so the result is consistent with both benefit and harm.`:`Only ${result.k} studies pooled — limited precision.`; }
    out.imprecision={suggest:sug,reason:why};
  }

  // ── Publication bias: from k and Egger's / funnel asymmetry ──
  if(result){
    let sug="not_serious", why="No strong signal of small-study effects.";
    if(result.k<10){ sug="serious"; why=`With only ${result.k} studies (<10), publication bias cannot be reliably assessed or excluded.`; }
    if(egger&&egger.pval<0.05){ sug="serious"; why=`Egger's test is significant (p = ${egger.pval<0.001?"<0.001":egger.pval.toFixed(3)}), indicating funnel asymmetry / possible small-study effects.`; }
    out.publicationBias={suggest:sug,reason:why};
  }

  // Indirectness can't be inferred from data — leave to the reviewer
  out.indirectness={suggest:null,reason:`Indirectness reflects how well the studies' PICO matches your question — a judgement only you can make. Consider population, intervention, comparator, and outcome directness.`};

  return out;
}

/* ════════════ WORKFLOW CONFIG ════════════ */
export const TABS=[
  // group:"project" ⇒ project meta-tabs (prompt6 Tasks 15/4) — rendered in their
  // own "Project" sidebar group ABOVE Workflow; phase:null keeps them out of the
  // workflow map, the progress denominator, and the "Next step" walker.
  {id:"overview",   icon:"grid",        label:"Overview",             phase:null,  group:"project"},
  {id:"control",    icon:"sliders",     label:"Project Control",      phase:null,  group:"project"},
  {id:"pico",       icon:"target",      label:"PICO & Question",      phase:"Plan",    num:1},
  {id:"prospero",   icon:"clipboard",   label:"Protocol",             phase:"Plan",    num:2},
  // prompt60 — the former two search tabs (Search Builder + Search & Discovery) are
  // unified into ONE "Search" stage: a 3-step wizard (Define → Build → Run). The run
  // engine (flag `pecanSearch`) is the wizard's Run step. Old deep links to the removed
  // `discovery` stage redirect to `search` (navConfig.activeProjectStage), so nothing 404s.
  {id:"search",     icon:"search",      label:"Search",               phase:"Search",  num:3},
  // 66.md P6 — Living Review dashboard (flag `livingReview`). phase:null keeps it
  // OUT of the numbered workflow map / progress denominator / "Next step" walker
  // (the feature is flag-gated OFF by default — a permanently-empty mandatory step
  // would misread as unfinished work). navConfig appends it to the SEARCH category's
  // white submenu (same pattern as PRISMA Flow inside Screen), so it IS visible,
  // navigable project navigation at ?tab=living, and categoryForStage('living')
  // highlights the Search rail category.
  {id:"living",     icon:"refresh",     label:"Living Review",        phase:null,  group:"living"},
  // P15 Bibliomine — Citation Mining (flag `citationMining`, default OFF). Like Living
  // Review it is phase:null + group-tagged so it stays OUT of the numbered workflow map,
  // the progress denominator and the "Next step" walker. It is surfaced ONLY when the
  // flag is ON: navConfig appends it to the SEARCH category's white submenu (behind
  // ctx.citationMiningEnabled) and categoryForStage('citation') highlights Search. The
  // legacy sidebar (workflow + reference groups) never renders it — matching Living Review.
  {id:"citation",   icon:"link",        label:"Citation Mining",      phase:null,  group:"citation"},
  // prompt18 — Screening is now ONE in-project stage that embeds the full
  // META·SIFT engine (import → duplicates → title/abstract → conflicts → full
  // text). The old "Screening & PRISMA" tab is demoted to the PRISMA flow only.
  {id:"screening",  icon:"filter",      label:"Screening",            phase:"Screen",  num:4},
  {id:"prisma",     icon:"flow",        label:"PRISMA Flow",          phase:"Screen",  num:5},
  {id:"extraction", icon:"table",       label:"Data Extraction",      phase:"Extract", num:6},
  {id:"rob",        icon:"scale",       label:"Risk of Bias",         phase:"Extract", num:7},
  {id:"analysis",   icon:"sigma",       label:"Meta-Analysis",        phase:"Analyze", num:8},
  {id:"forest",     icon:"forest",      label:"Forest Plot",          phase:"Analyze", num:9},
  {id:"sensitivity",icon:"activity",    label:"Sensitivity & Bias",   phase:"Analyze", num:10},
  {id:"subgroup",   icon:"layers",      label:"Subgroup Analysis",    phase:"Analyze", num:11},
  // P2 — Network Meta-Analysis: compare 3+ treatments via direct + indirect evidence
  // (flag `networkMetaAnalysis`, default OFF; the tab renders a disabled-note when the
  // flag is off). Backed by the separate NMA engine.
  {id:"nma",        icon:"sigma",       label:"Network Meta-Analysis",phase:"Analyze", num:12},
  {id:"grade",      icon:"award",       label:"GRADE Certainty",      phase:"Report",  num:13},
  {id:"report",     icon:"checkSquare", label:"PRISMA Checklist",     phase:"Report",  num:14},
  {id:"manuscript", icon:"pencil",      label:"Manuscript Draft",     phase:"Report",  num:15},
  // phase:null ⇒ reference page, NOT a workflow step — excluded from the
  // workflow map, progress denominator and "Next step" walker (all filter on t.phase).
  {id:"methods",    icon:"bookOpen",    label:"Methods & Equations",  phase:null,  group:"reference"},
];
export const PHASES=["Plan","Search","Screen","Extract","Analyze","Report"];
// prompt31 Part 7 — ultra-wide judgement: reading/form tabs keep a comfortable
// centred max-width; data/workspace tabs (extraction, analysis, forest, RoB,
// PRISMA…) use the full width. Screening renders its own full-bleed frame.
export const READING_TABS=new Set(["overview","pico","prospero","control","grade","manuscript","methods","report"]);
/* Icon names (src/frontend/components/icons.jsx) — render via <Icon name={…}/> */
export const PHASE_ICON={Plan:"target",Search:"search",Screen:"filter",Extract:"table",Analyze:"sigma",Report:"fileText"};
/* prompt46 #1 — display labels for phases. The PHASES strings stay the stable
   grouping KEYS (t.phase, phaseTab, PHASE_ICON are all keyed by them); this map is
   render-only, so "Plan" groups the PICO + Protocol tabs but shows "Plan & Protocol". */
export const PHASE_LABEL={Plan:"Plan & Protocol"};
export const phaseLabel=(p)=>PHASE_LABEL[p]||p;

/* Green-light readiness check — returns { ok, missing[] } */
export function readinessCheck(project) {
  const missing = [];
  const pico = project.pico || {};
  const search = project.search || {};
  if (!pico.P) missing.push("Population (P) is required in PICO");
  if (!pico.I) missing.push("Intervention (I) is required in PICO");
  // Comparator/Control is now mandatory (prompt23 Task 8B).
  if (!pico.C) missing.push("Comparator / Control (C) is required in PICO");
  if (!pico.O) missing.push("Outcome (O) is required in PICO");
  if (!timeframeComplete(pico)) missing.push("Time Frame must be selected (and a valid range when custom)");
  const dbCount = Object.values(search.dbs||{}).filter(Boolean).length;
  if (dbCount < 3) missing.push(`At least 3 databases required (${dbCount} selected)`);
  if (!search.string) missing.push("Search strategy not saved yet");
  return { ok: missing.length === 0, missing };
}

/* Compute completion status for each workflow step (for sidebar progress dots).
   75.md — the CANONICAL cross-surface model is computeProjectProgress()
   (src/research-engine/progress/projectProgress.js), delivered as the server's
   transient `_progress` annotation. This legacy per-step map stays as the client's
   in-place fallback; the reconciliations below (nma rule, reachable subgroup, real
   PRISMA-checklist size, manuscripts[] evidence) exist so the existing Overview/rail
   stop disagreeing with themselves until wave 2 wires `_progress` in directly.
   75.md recs (Finding 5) — `nma` now always reports its REAL evidence-based status
   (never a flag-forced "done"); the flag-gated denominator exclusion lives ONLY in the
   canonical computeProjectProgress, which the surfaces overlay onto this map. `opts` is
   kept for call-site compatibility but no longer changes any status. */
export function stepStatus(project, screeningComplete, opts={}){ // eslint-disable-line no-unused-vars
  if(!project) return {};
  const p=project, pico=p.pico||{}, search=p.search||{}, prisma=p.prisma||{};
  const dbCount=Object.values(search.dbs||{}).filter(Boolean).length;
  const withES=p.studies.filter(s=>s.es!=="").length;
  const robDone=p.studies.filter(s=>Object.keys(s.rob||{}).length>0).length;
  const reportDone=Object.values(p.reportChecked||{}).filter(Boolean).length;
  const meta=runMeta(p.studies,"random");
  const gradeDone=Object.keys(p.grade||{}).length;
  // Manuscript "done" evidence spans BOTH stores: the 64.md editor's
  // data.manuscripts[] (draft.sections[id].content) and the legacy
  // data.manuscript.drafts{} — count the most-complete draft either way.
  const msDrafts=Array.isArray(p.manuscripts)?p.manuscripts:[];
  let msFilled=0;
  for(const d of msDrafts){const sec=d&&d.sections;if(sec&&typeof sec==="object"){const f=Object.values(sec).filter(x=>x&&typeof x.content==="string"&&x.content.trim()!=="").length;if(f>msFilled)msFilled=f;}}
  const msLegacy=(p.manuscript&&p.manuscript.drafts&&typeof p.manuscript.drafts==="object")?Object.values(p.manuscript.drafts).filter(v=>v&&String(v).trim()!=="").length:0;
  const msBest=Math.max(msFilled,msLegacy);
  return {
    pico: (pico.P&&pico.I&&pico.C&&pico.O&&timeframeComplete(pico))?"done":(pico.P||pico.I||pico.C||pico.O||pico.question)?"partial":"empty",
    prospero: (p.prospero&&p.prospero.fields&&Object.values(p.prospero.fields).filter(v=>v&&v.trim()).length>=15)?"done":(p.prospero&&p.prospero.fields&&Object.values(p.prospero.fields).filter(v=>v&&v.trim()).length>0)?"partial":"empty",
    search: (dbCount>=3&&search.string||(p.mesh&&p.mesh.results))?"done":(dbCount>0||search.string)?"partial":"empty",
    // prompt29 Part 9 — Screening is "done" ONLY when the linked workspace reports
    // every substep complete (dedup, title/abstract to quorum, conflicts resolved,
    // final review decided, included studies handed off). `screeningComplete` is
    // the server's roll-up (GET /metalab/:id/summary). Until then it is at most
    // "partial" while there are records / included studies in progress. (Old rule
    // flipped to done as soon as any study was included — too early.)
    screening: (()=>{ const lm=p._linkedMetaSift; const recs=(lm&&lm.recordCount)||0; const inc=prisma.included||0; if(screeningComplete) return "done"; return (inc||recs)?"partial":"empty"; })(),
    prisma: prisma.included?"done":(prisma.dbs||prisma.dedupe)?"partial":"empty",
    extraction: (()=>{
      if(p.studies.length===0) return "empty";
      const anyErr=p.studies.some(s=>validateStudy(s).some(i=>i.sev==="error"));
      if(anyErr) return "partial";
      return (withES===p.studies.length&&withES>0)?"done":"partial";
    })(),
    rob: (p.studies.length>0&&robDone===p.studies.length)?"done":robDone>0?"partial":"empty",
    analysis: (()=>{
      if(!meta) return "empty";
      const pool=checkPoolability(p.studies);
      return pool.blockers.length>0?"partial":"done";
    })(),
    forest: meta?"done":"empty",
    sensitivity: (meta&&meta.k>=3)?"done":"empty",
    // 75.md — subgroup can now REACH "done" (sibling-consistent with forest/
    // sensitivity, which auto-complete from the pooled data): ≥4 pooled studies is
    // enough to have meaningfully explored subgroups. Previously it maxed at
    // "partial", which (with nma always empty) made 100% unreachable.
    subgroup: (meta&&meta.k>=4)?"done":(meta||p.studies.length>=4)?"partial":"empty",
    // 75.md recs (Finding 5) — nma reports its REAL, evidence-based status regardless
    // of the flag (a network-feasibility proxy: no NMA result is persisted in the blob).
    // Forcing "done" when the flag was off painted a false "Complete" on brand-new empty
    // projects. 100% stays reachable because the CANONICAL model (computeProjectProgress)
    // excludes nma from the denominator via `required:false` when the flag is off — the
    // consuming surfaces overlay that model's steps onto this map, so an honest "empty"
    // here never blocks 100% while the flag is off, and never lies about completion.
    nma: (meta&&meta.k>=3)?"done":meta?"partial":"empty",
    grade: gradeDone>=5?"done":gradeDone>0?"partial":"empty",
    // 75.md — the "done" threshold is the REAL PRISMA-checklist size (PRISMA_CL,
    // the same list ReportTab renders), reconciling the old 20-vs-27 disagreement.
    report: reportDone>=PRISMA_CL.length?"done":reportDone>0?"partial":"empty",
    manuscript: msBest>=3?"done":msBest>=1?"partial":"empty",
  };
}

/* ════════════ PROJECT AUDIT (What is Missing) ════════════ */
export function auditProject(p){
  const items=[];
  const pico=p.pico||{}, search=p.search||{}, prisma=p.prisma||{};
  const dbCount=Object.values(search.dbs||{}).filter(Boolean).length;
  const withES=p.studies.filter(s=>s.es!=="").length;
  const robDone=p.studies.filter(s=>Object.keys(s.rob||{}).length>0).length;
  const meta=runMeta(p.studies,"random");
  const egg=eggersTest(p.studies);
  const reportDone=Object.values(p.reportChecked||{}).filter(Boolean).length;
  const gradeDone=Object.keys(p.grade||{}).length;
  const add=(sev,phase,msg)=>items.push({sev,phase,msg});

  // PLAN
  if(!(pico.P&&pico.I&&pico.C&&pico.O)) add("high","Plan","PICO is incomplete — Population, Intervention, Comparator, and Outcome are all required.");
  if(!timeframeComplete(pico)) add("high","Plan","Time Frame is not specified — choose a time-frame option (or a valid custom range).");
  if(!pico.question) add("med","Plan","No research question stated. A focused question keeps screening decisions consistent.");
  if(!pico.incl||!pico.excl) add("high","Plan","Eligibility criteria are not fully defined (inclusion + exclusion). PRISMA requires explicit criteria.");
  if(!pico.prosperoId) add("med","Plan","No PROSPERO registration ID. Register the protocol before screening to reduce bias and meet journal requirements.");

  // SEARCH
  if(dbCount<3) add("high","Search",`Only ${dbCount} database${dbCount===1?"":"s"} selected. Most journals expect ≥3 (e.g. MEDLINE, Embase, CENTRAL).`);
  if(!search.string) add("med","Search","No search string documented. Save at least your primary database query for reproducibility.");
  if(!search.date) add("low","Search","Search date not recorded. PRISMA requires the date each source was last searched.");
  if(!search.notes) add("low","Search","No screening or grey-literature note. Document how duplicates were removed and titles screened.");

  // SCREEN
  if(!prisma.dbs&&!prisma.included) add("med","Screen","PRISMA flow numbers are empty. Track records identified → screened → included.");
  if(prisma.dbs&&!prisma.dedupe) add("low","Screen","Records identified but no duplicates removed recorded.");

  // EXTRACT
  if(p.studies.length===0) add("high","Extract","No studies extracted yet.");
  else{
    if(withES<p.studies.length) add("high","Extract",`${p.studies.length-withES} of ${p.studies.length} studies have no effect size entered.`);
    if(robDone<p.studies.length) add("high","Extract",`Risk of bias not assessed for ${p.studies.length-robDone} of ${p.studies.length} studies.`);
    const errStudies=p.studies.filter(s=>validateStudy(s).some(i=>i.sev==="error")).length;
    if(errStudies>0) add("high","Extract",`${errStudies} stud${errStudies===1?"y has":"ies have"} data-validation errors (e.g. CI/ES mismatch, group sizes ≠ total). Run the Data Quality Check.`);
    const dupCount=Object.keys(findDuplicates(p.studies)).length;
    if(dupCount>0) add("med","Extract",`${dupCount} possible duplicate record${dupCount===1?"":"s"} detected — confirm each is a distinct study.`);
    const noType=p.studies.filter(s=>s.es!==""&&!s.esType).length;
    if(noType>0) add("med","Extract",`${noType} stud${noType===1?"y has":"ies have"} an effect size but no effect-measure type set — needed to confirm a common scale.`);
    const needReview=p.studies.filter(s=>s.needsReview).length;
    if(needReview>0) add("low","Extract",`${needReview} stud${needReview===1?"y is":"ies are"} flagged for second-reviewer confirmation.`);
  }

  // ANALYZE
  const poolc=checkPoolability(p.studies);
  if(poolc.blockers.length>0) add("high","Analyze","Studies may not be poolable: "+poolc.blockers[0]);
  poolc.warnings.slice(0,2).forEach(w=>add("med","Analyze",w));
  if(!meta) add("med","Analyze","Meta-analysis needs ≥2 studies with effect sizes and CIs.");
  else{
    if(meta.I2>50) add("med","Analyze",`Substantial heterogeneity (I²=${meta.I2}%). Plan subgroup or sensitivity analyses and justify the random-effects model.`);
    if(meta.k>=10&&!egg) add("low","Analyze","With ≥10 studies, assess publication bias (funnel plot + Egger's test) on the Sensitivity tab.");
    if(meta.k<10) add("low","Analyze","Fewer than 10 studies — publication-bias tests are underpowered; interpret the funnel visually.");
  }
  if(gradeDone<5) add("med","Analyze","GRADE certainty not fully rated. Grade all 5 domains for your primary outcome.");

  // REPORT
  // 75.md — align to the REAL checklist size (PRISMA_CL, the list ReportTab renders,
  // currently 26) so stepStatus.report and this audit stop disagreeing (was 20 vs 27).
  if(reportDone<PRISMA_CL.length) add("med","Report",`PRISMA checklist ${reportDone}/${PRISMA_CL.length} complete. Finish before submission.`);
  if(!(p.manuscript&&p.manuscript.drafts&&Object.keys(p.manuscript.drafts).length>0)) add("low","Report","No manuscript sections drafted yet.");

  return items;
}

/* ════════════ PROJECT META HELPERS (prompt6 Tasks 4/15/18) ════════════ */
/* Effective caller permissions for a project — prefers the server's _permissions
   annotation; falls back to the prompt5 _shared/_role/_canEdit/_readOnly keys. */
export function projectPerms(project){
  if(project&&project._permissions) return project._permissions;
  if(project&&project._shared) return {
    role:project._role||"member",isOwner:false,
    canView:true,canEdit:!!project._canEdit,
    // 78.md #2 — default-permissive when the server annotation is absent (an older
    // payload): the Analysis gate only ever restricts when _permissions explicitly
    // says canRunAnalysis===false, so a missing value never locks anyone out.
    readOnly:!!project._readOnly,canExport:true,canRunAnalysis:true,
  };
  return {role:"owner",isOwner:true,canView:true,canEdit:true,readOnly:false,canExport:true,canRunAnalysis:true};
}
/* Linked META·SIFT ScreenProject id for a project (workspace = source of truth). */
export function linkedSiftId(project){
  return (project&&project._linkedMetaSift&&project._linkedMetaSift.id)||(project&&project._screenProjectId)||null;
}

/* ════════════ PROJECT CONTROL ════════════ */
export const CTRL_STATUS_OPTIONS=[
  {value:"not_started",label:"Not started"},
  {value:"in_progress",label:"In progress"},
  {value:"done",label:"Done"},
];
