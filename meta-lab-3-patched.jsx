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
import { rasterizeSvg, downloadBlob, downloadText } from "./src/frontend/components/exportCore.js";
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

const SVG_XML_HEADER = `<?xml version="1.0" encoding="UTF-8"?>\n`;

/* Filename suffix for PNG presets — DPI is encoded by pixel width, so the
   journal presets advertise it in the name (e.g. _journal-1col_@300dpi). */
const presetTag = (choice) => {
  if (!choice || choice.format !== "png" || !choice.presetId) return "";
  const dpi = (choice.presetId === "journal-1col" || choice.presetId === "journal-2col") ? "_@300dpi" : "";
  const tag = choice.presetId === "custom" ? `custom${choice.widthPx || ""}px` : choice.presetId;
  return `_${tag}${dpi}`;
};

/* Serialize a LIVE on-screen SVG (theme-token colored JSX) into a standalone
   string with every fill/stroke resolved to literal computed colors —
   var(--t-*) custom properties never rasterize (the canvas <img> has no access
   to the document's variables) and must not leak into exported artifacts.
   opts.background:  '#hex'  → insert an opaque full-bleed rect under the figure
                     'auto'  → use the element's resolved CSS background color
                     null    → no rect inserted (caller paints via rasterizeSvg)
   opts.stripBgRect: remove an existing full-bleed leading <rect> (for
                     transparent PNG of figures that bake their own background).
   Returns { svg, W, H, bg } — bg is the element's resolved background color. */
function liveSvgToString(svgId, { background = null, stripBgRect = false } = {}) {
  const el = document.getElementById(svgId);
  if (!el) throw new Error("The figure is not on screen — open the tab that shows it, then export again.");
  const W = +el.getAttribute("width") || (el.viewBox && el.viewBox.baseVal && el.viewBox.baseVal.width) || 800;
  const H = +el.getAttribute("height") || (el.viewBox && el.viewBox.baseVal && el.viewBox.baseVal.height) || 600;
  const clone = el.cloneNode(true);
  // Inline computed fill/stroke from the live nodes onto the clone (1:1 order).
  const srcAll = [el, ...el.querySelectorAll("*")];
  const cloneAll = [clone, ...clone.querySelectorAll("*")];
  srcAll.forEach((node, i) => {
    const c = cloneAll[i];
    if (!c || node.nodeType !== 1 || c.nodeType !== 1) return;
    let cs; try { cs = window.getComputedStyle(node); } catch (_) { return; }
    if (!cs) return;
    const f = cs.fill, st = cs.stroke;
    if (f && f !== "none") c.setAttribute("fill", f);
    if (st && st !== "none") c.setAttribute("stroke", st);
  });
  let bg = null;
  try {
    const b = window.getComputedStyle(el).backgroundColor;
    if (b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") bg = b;
  } catch (_) {}
  clone.removeAttribute("id");
  if (clone.style) { clone.style.background = ""; clone.style.backgroundColor = ""; clone.style.borderRadius = ""; }
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${W} ${H}`);
  if (stripBgRect) {
    const first = clone.firstElementChild;
    if (first && first.tagName && first.tagName.toLowerCase() === "rect"
      && (+first.getAttribute("x") || 0) === 0 && (+first.getAttribute("y") || 0) === 0) first.remove();
  }
  let resolvedBg = background === "auto" ? (bg || "#ffffff") : background;
  if (resolvedBg) {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", "0"); r.setAttribute("y", "0");
    r.setAttribute("width", String(W)); r.setAttribute("height", String(H));
    r.setAttribute("fill", resolvedBg);
    clone.insertBefore(r, clone.firstChild);
  }
  return { svg: new XMLSerializer().serializeToString(clone), W, H, bg };
}

/* ════════════ STATISTICS ════════════ */
const Z975 = 1.959963984540054; // qnorm(0.975), exact
function normalCDF(z) {
  const a=[0.254829592,-0.284496736,1.421413741,-1.453152027,1.061405429], p=0.3275911;
  const sign=z<0?-1:1, za=Math.abs(z)/Math.SQRT2;
  const t=1/(1+p*za); let poly=0;
  for(let i=4;i>=0;i--) poly=a[i]+t*poly;
  return 0.5*(1+sign*(1-poly*t*Math.exp(-za*za)));
}
function runMeta(studies, method="random") {
  const valid=studies.filter(s=>s.es!==""&&s.lo!==""&&s.hi!==""&&!isNaN(+s.es)&&!isNaN(+s.lo)&&!isNaN(+s.hi));
  if(valid.length<2) return null;
  const d=valid.map(s=>{
    const es=+s.es,lo=+s.lo,hi=+s.hi,se=(hi-lo)/(2*Z975),w=1/(se*se);
    return {...s,_es:es,_lo:lo,_hi:hi,_se:se,_w:w,_pct:0};
  });
  const W=d.reduce((a,x)=>a+x._w,0),W2=d.reduce((a,x)=>a+x._w**2,0);
  const fixES=d.reduce((a,x)=>a+x._w*x._es,0)/W;
  const Q=d.reduce((a,x)=>a+x._w*(x._es-fixES)**2,0),k=d.length;
  const I2=k>1?Math.max(0,((Q-(k-1))/Q)*100):0;
  // τ² (DerSimonian–Laird) — always computed so both models can be reported
  const tau2all=Math.max(0,(Q-(k-1))/(W-W2/W));
  // random-effects weights (always available for side-by-side reporting)
  const rwAll=d.map(x=>1/(x._se**2+tau2all)),rWall=rwAll.reduce((a,w)=>a+w,0);
  // expose both fixed and random weight percentages on every study
  d.forEach((x,i)=>{
    x._wFixed=x._w; x._wRandom=rwAll[i];
    x._wFixedPct=(x._w/W)*100;
    x._wRandomPct=(rwAll[i]/rWall)*100;
  });
  let pES,pSE,tau2=0;
  if(method==="fixed"){
    pES=fixES;pSE=Math.sqrt(1/W);d.forEach(x=>{x._pct=x._wFixedPct;});
  } else {
    tau2=tau2all;
    pES=rwAll.reduce((a,w,i)=>a+w*d[i]._es,0)/rWall;pSE=Math.sqrt(1/rWall);
    d.forEach((x,i)=>{x._rw=rwAll[i];x._pct=x._wRandomPct;});
  }
  const z=pES/pSE,pval=2*(1-normalCDF(Math.abs(z)));
  // Q-test p-value for heterogeneity (chi-square, df=k-1)
  const Qpval=k>1?(1-chiSquareCDF(Q,k-1)):1;
  // H index and a rough 95% CI for I² (Higgins & Thompson)
  const I2desc=I2<25?"low":I2<50?"moderate":I2<75?"substantial":"considerable";
  // also expose the fixed AND random pooled estimates together (for research-ready output)
  const fixSE=Math.sqrt(1/W);
  const ranSE=Math.sqrt(1/rWall),ranES=rwAll.reduce((a,w,i)=>a+w*d[i]._es,0)/rWall;

  // ── Hartung–Knapp–Sidik–Jonkman (HKSJ) adjustment (random-effects) ──
  // q = (1/(k-1)) Σ w*_i (y_i − μ*)²  with random-effects weights; SE_hksj = sqrt(q) * sqrt(1/Σw*)
  let hksj=null;
  if(k>=2){
    const qHK=rwAll.reduce((a,w,i)=>a+w*(d[i]._es-ranES)**2,0)/(k-1);
    const seHK=Math.sqrt(Math.max(qHK,1e-12))*Math.sqrt(1/rWall);
    const tc=tCrit(0.95,k-1);
    const tStat=ranES/seHK, pHK=2*(1-tCDF(Math.abs(tStat),k-1));
    // Full precision — rounding happens only at the display/export edge (prompt15).
    hksj={es:ranES,se:seHK,lo:ranES-tc*seHK,hi:ranES+tc*seHK,t:tStat,df:k-1,tcrit:tc,pval:pHK};
  }

  // ── Prediction interval (where a future study's true effect would likely fall) ──
  // PI = μ ± t(k-2) * sqrt(τ² + SE_μ²) ; needs k≥3
  let predInt=null;
  if(k>=3){
    const tcP=tCrit(0.95,k-2);
    const sePred=Math.sqrt(tau2all+ranSE*ranSE);
    predInt={lo:ranES-tcP*sePred,hi:ranES+tcP*sePred,df:k-2,sePred:sePred};
  }

  // Full precision returned; display/export rounding via src/research-engine/format/precision.js.
  return {studies:d,k,Q,Qpval,I2,I2desc,tau2,
    pES,pSE,lo95:pES-Z975*pSE,
    hi95:pES+Z975*pSE,pval,z,
    method,W,tau:Math.sqrt(tau2all),
    fixed:{es:fixES,se:fixSE,lo:fixES-Z975*fixSE,hi:fixES+Z975*fixSE},
    random:{es:ranES,se:ranSE,lo:ranES-Z975*ranSE,hi:ranES+Z975*ranSE,tau2:tau2all},
    hksj, predInt};
}

/* Egger's regression test for funnel-plot asymmetry / small-study effects.
   Canonical Egger (1997): UNWEIGHTED ordinary least squares of the standard
   normal deviate (y = ES/SE) on precision (x = 1/SE). The intercept is Egger's
   bias coefficient. Matches metafor::regtest(..., model="lm").
   (Previously used inverse-variance weights w = 1/SE², which double-count
   precision and did NOT match Egger 1997 / metafor — now fixed to OLS.)
   Ref: Egger M, Davey Smith G, Schneider M, Minder C. BMJ. 1997;315:629-634. */
function eggersTest(studies) {
  var valid = studies.filter(function(s){ return s.es!==""&&s.lo!==""&&s.hi!==""&&!isNaN(+s.es)&&!isNaN(+s.lo)&&!isNaN(+s.hi); });
  if (valid.length < 3) return null;
  var pts=[];
  for (var i=0;i<valid.length;i++){
    var s=valid[i], es=+s.es, se=(+s.hi-+s.lo)/(2*Z975);
    if (!(se>0)) return null;            // degenerate SE — cannot regress
    pts.push({ y: es/se, x: 1/se });
  }
  // Unweighted OLS of y on x: y = intercept + slope*x  (all weights = 1)
  var k=pts.length;
  var Sx=0,Sy=0,Sxx=0,Sxy=0;
  pts.forEach(function(p){ Sx+=p.x; Sy+=p.y; Sxx+=p.x*p.x; Sxy+=p.x*p.y; });
  var denom=k*Sxx-Sx*Sx;
  if (denom===0) return null;
  var slope=(k*Sxy-Sx*Sy)/denom;
  var intercept=(Sy-slope*Sx)/k;          // Egger's bias coefficient
  var dof=k-2;
  if (dof<1) return null;
  // Residual variance and SE of intercept (standard OLS results)
  var sse=0;
  pts.forEach(function(p){ var e=p.y-(intercept+slope*p.x); sse+=e*e; });
  var s2=sse/dof;
  var seInt=Math.sqrt(s2*Sxx/denom);
  var t=intercept/seInt;
  // Two-tailed p from Student-t with df = k-2 (matches metafor's regtest)
  var p = 2*(1-tCDF(Math.abs(t), dof));
  return { intercept:intercept, seInt:seInt, t:t, pval:p, dof:dof, k:k };  // full precision
}

/* Leave-one-out sensitivity analysis */
function leaveOneOut(studies, method) {
  var valid = studies.filter(function(s){ return s.es!==""&&s.lo!==""&&s.hi!==""&&!isNaN(+s.es)&&!isNaN(+s.lo)&&!isNaN(+s.hi); });
  if (valid.length < 3) return [];
  return valid.map(function(omitted, idx){
    var subset = valid.filter(function(_,i){ return i!==idx; });
    var res = runMeta(subset, method||"random");
    return {
      omitted: (omitted.author||"Study")+(omitted.year?" "+omitted.year:""),
      omittedId: omitted.id,
      pES: res ? res.pES : null,
      lo95: res ? res.lo95 : null,
      hi95: res ? res.hi95 : null,
      I2: res ? res.I2 : null,
      pval: res ? res.pval : null
    };
  });
}

/* Trim-and-fill (Duval & Tweedie L0 estimator) for publication-bias adjustment.
   The centre driving the L0 iteration (and the final mirror point) is the pooled
   estimate of the currently trimmed set under the SELECTED model — fixed-effect
   inverse-variance, or DerSimonian–Laird random-effects with τ² re-estimated each
   iteration; Tn and L0 are computed over the FULL k studies. Reproduces
   metafor::trimfill(res) under the same model for clearly asymmetric funnels; the
   over-represented side is chosen by a signed-rank rule (metafor uses a regression
   slope, so results can differ on near-symmetric funnels). (The earlier version
   always centred on the fixed-effect mean and ranked over the trimmed subset, so
   random-effects over-imputed — now fixed.)
   Ref: Duval S, Tweedie R. Biometrics 2000;56:455-463. */
function trimFill(studies, method){
  var valid = studies.filter(function(s){ return s.es!==""&&s.lo!==""&&s.hi!==""&&!isNaN(+s.es)&&!isNaN(+s.lo)&&!isNaN(+s.hi); });
  if (valid.length < 3) return null;
  var mdl = method||"random";
  var base = runMeta(valid, mdl);
  if (!base) return null;
  // Z975 keeps the SE→CI round-trip exact with runMeta.
  var obs = valid.map(function(s){ var es=+s.es, se=(+s.hi-+s.lo)/(2*Z975); return {es:es, se:se}; });
  var k = obs.length;

  // Pooled estimate of an {es,se} set under the selected model (FE inverse-variance,
  // or DerSimonian–Laird random-effects with τ² re-estimated for this subset).
  function pooled(arr){
    var wf=arr.map(function(x){ return 1/(x.se*x.se); });
    var Wf=wf.reduce(function(a,b){ return a+b; },0);
    var muF=arr.reduce(function(a,x,i){ return a+wf[i]*x.es; },0)/Wf;
    if(mdl==="fixed"||arr.length<2) return muF;
    var Q=arr.reduce(function(a,x,i){ return a+wf[i]*(x.es-muF)*(x.es-muF); },0);
    var W2=wf.reduce(function(a,w){ return a+w*w; },0);
    var C=Wf-W2/Wf;
    var tau2=C>0 ? Math.max(0,(Q-(arr.length-1))/C) : 0;
    var wr=arr.map(function(x){ return 1/(x.se*x.se+tau2); });
    var Wr=wr.reduce(function(a,b){ return a+b; },0);
    return arr.reduce(function(a,x,i){ return a+wr[i]*x.es; },0)/Wr;
  }
  // Ranks of |yi - mu| over the FULL set; rank sums split by side of mu.
  function rankSums(mu){
    var dev=obs.map(function(x){ return x.es-mu; });
    var order=dev.map(function(_,i){ return i; }).sort(function(a,b){ return Math.abs(dev[a])-Math.abs(dev[b]); });
    var rank=new Array(k);
    order.forEach(function(id,r){ rank[id]=r+1; });
    var Tr=0, Tl=0;
    dev.forEach(function(dv,i){ if(dv>0)Tr+=rank[i]; else if(dv<0)Tl+=rank[i]; });
    return {Tr:Tr, Tl:Tl};
  }
  // Fix the heavy/over-represented side once from the full-data estimate.
  var beta0=pooled(obs);
  var t0=rankSums(beta0);
  var heavyRight = t0.Tr >= t0.Tl;        // right tail over-represented -> impute left
  var side = heavyRight ? "left" : "right";
  var asc=obs.slice().sort(function(a,b){ return a.es-b.es; });

  var k0=0, prevK0=-1, iter=0, mu=beta0;
  while(k0!==prevK0 && iter<100){
    prevK0=k0; iter++;
    var trimmed = heavyRight ? asc.slice(0, k-k0) : asc.slice(k0);
    mu = pooled(trimmed);
    var t = rankSums(mu);
    var Tn = heavyRight ? t.Tr : t.Tl;
    var L0 = (4*Tn - k*(k+1))/(2*k-1);
    k0 = Math.max(0, Math.min(k-1, Math.round(L0)));
  }
  if(k0<=0){
    return {k0:0, adjusted:base, imputed:[], side:null, base:base};
  }
  // Mirror the k0 most extreme studies on the heavy side about the final centre.
  var extreme = heavyRight ? asc.slice(k-k0) : asc.slice(0,k0);
  var imputed = extreme.map(function(x){ var mir=2*mu-x.es; return {es:mir, se:x.se, lo:mir-Z975*x.se, hi:mir+Z975*x.se, imputed:true}; });
  var augmented = valid.concat(imputed.map(function(x){ return {es:x.es, lo:x.lo, hi:x.hi}; }));
  var adjusted = runMeta(augmented, mdl);
  return {k0:k0, adjusted:adjusted, imputed:imputed, side:side, base:base};
}

/* Influence diagnostics: per-study leave-one-out tau², I², and a standardised
   influence score (how many pooled-SE units the estimate moves when omitted). */
function influenceDiagnostics(studies, method){
  var valid = studies.filter(function(s){ return s.es!==""&&s.lo!==""&&s.hi!==""&&!isNaN(+s.es)&&!isNaN(+s.lo)&&!isNaN(+s.hi); });
  if (valid.length < 3) return [];
  var full = runMeta(valid, method||"random");
  if(!full) return [];
  return valid.map(function(omit, idx){
    var subset = valid.filter(function(_,i){ return i!==idx; });
    var r = runMeta(subset, method||"random");
    if(!r) return null;
    var dffit = (full.pES - r.pES) / (full.pSE||1); // standardised shift
    return {
      id: omit.id,
      label: (omit.author||"Study")+(omit.year?" "+omit.year:""),
      pES: r.pES, tau2: r.tau2, I2: r.I2,
      dffit: dffit,
      tau2Drop: full.tau2 - r.tau2,   // how much heterogeneity this study adds
      i2Drop: full.I2 - r.I2,
      influential: Math.abs(dffit) > 1 || Math.abs(full.I2 - r.I2) > 25
    };
  }).filter(Boolean);
}

/* Subgroup meta-analysis */
function subgroupAnalysis(studies, groupKey, method) {
  var groups = {};
  studies.forEach(function(s){
    var k = (s[groupKey]||"Unspecified").toString().trim() || "Unspecified";
    if (!groups[k]) groups[k] = [];
    groups[k].push(s);
  });
  var results = [];
  Object.keys(groups).forEach(function(k){
    var r = runMeta(groups[k], method||"random");
    if (r) results.push({ group:k, n:groups[k].length, ...r });
  });
  // Test for subgroup differences (Q-between)
  if (results.length < 2) return { groups: results, Qbetween: null, pBetween: null };
  var overall = runMeta(studies, method||"random");
  if (!overall) return { groups: results, Qbetween: null, pBetween: null };
  var Qw = 0;
  results.forEach(function(r){ Qw += r.Q; });
  var Qb = Math.max(0, overall.Q - Qw);
  var df = results.length - 1;
  // approximate chi-square p
  var p = df>0 ? 1 - chiSquareCDF(Qb, df) : null;
  return { groups: results, Qbetween:Qb, df:df, pBetween: p };  // full precision
}

/* Exact chi-square CDF via the regularised lower incomplete gamma P(df/2, x/2).
   (Numerical Recipes gammp: series for x<a+1, continued fraction otherwise.) */
function gammp(a, x){
  if (x <= 0) return 0;
  if (x < a + 1){ // series
    var ap=a, sum=1/a, del=sum;
    for(var n=1;n<=300;n++){ ap++; del*=x/ap; sum+=del; if(Math.abs(del)<Math.abs(sum)*1e-12) break; }
    return sum*Math.exp(-x + a*Math.log(x) - lgamma(a));
  } else { // continued fraction for the upper incomplete gamma Q, then 1-Q
    var fpmin=1e-300, b=x+1-a, c=1/fpmin, d=1/b, h=d;
    for(var i=1;i<=300;i++){
      var an=-i*(i-a); b+=2;
      d=an*d+b; if(Math.abs(d)<fpmin)d=fpmin;
      c=b+an/c; if(Math.abs(c)<fpmin)c=fpmin;
      d=1/d; var del2=d*c; h*=del2;
      if(Math.abs(del2-1)<1e-12) break;
    }
    var Q=Math.exp(-x + a*Math.log(x) - lgamma(a))*h;
    return 1-Q;
  }
}
function chiSquareCDF(x, df) {
  if (x <= 0) return 0;
  return gammp(df/2, x/2);
}

/* Regularised incomplete beta (continued fraction) — used for the Student-t CDF */
function betacf(x, a, b) {
  var fpmin=1e-30, qab=a+b, qap=a+1, qam=a-1;
  var c=1, d=1-qab*x/qap;
  if (Math.abs(d)<fpmin) d=fpmin;
  d=1/d; var h=d;
  for (var m=1; m<=200; m++){
    var m2=2*m;
    var aa=m*(b-m)*x/((qam+m2)*(a+m2));
    d=1+aa*d; if(Math.abs(d)<fpmin)d=fpmin;
    c=1+aa/c; if(Math.abs(c)<fpmin)c=fpmin;
    d=1/d; h*=d*c;
    aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));
    d=1+aa*d; if(Math.abs(d)<fpmin)d=fpmin;
    c=1+aa/c; if(Math.abs(c)<fpmin)c=fpmin;
    d=1/d; var del=d*c; h*=del;
    if(Math.abs(del-1)<3e-7) break;
  }
  return h;
}
function lgamma(z){
  var g=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];
  var x=z, y=z, tmp=x+5.5; tmp-=(x+0.5)*Math.log(tmp); var ser=1.000000000190015;
  for(var j=0;j<6;j++){ y++; ser+=g[j]/y; }
  return -tmp+Math.log(2.5066282746310005*ser/x);
}
function ibeta(x, a, b){
  if(x<=0) return 0; if(x>=1) return 1;
  var bt=Math.exp(lgamma(a+b)-lgamma(a)-lgamma(b)+a*Math.log(x)+b*Math.log(1-x));
  if(x<(a+1)/(a+b+2)) return bt*betacf(x,a,b)/a;
  return 1-bt*betacf(1-x,b,a)/b;
}
/* Student-t two-sided CDF P(T<=t) for df>0 */
function tCDF(t, df){
  var x=df/(df+t*t);
  var ib=0.5*ibeta(x, df/2, 0.5);
  return t>0 ? 1-ib : ib;
}
/* Inverse Student-t: critical value t* such that P(-t*<T<t*)=conf (two-sided). */
function tCrit(conf, df){
  if(!isFinite(df)||df<=0) return invNormAbs((1+conf)/2);
  var target=(1+conf)/2; // upper-tail prob point
  // bisection on the CDF
  var lo=0, hi=200, mid;
  for(var i=0;i<100;i++){
    mid=(lo+hi)/2;
    var p=tCDF(mid, df);
    if(p<target) lo=mid; else hi=mid;
  }
  return mid;
}
/* |z| for a two-sided confidence level (normal fallback) */
function invNormAbs(p){ // p is the upper cumulative point e.g. 0.975
  // reuse Acklam invNorm defined later via a small inline rational approx
  // accurate enough for 0.5<p<0.9999
  if(p===0.975) return 1.959963985;
  if(p===0.95) return 1.644853627;
  // generic: invert normalCDF by bisection
  var lo=0,hi=10,mid;
  for(var i=0;i<100;i++){ mid=(lo+hi)/2; if(normalCDF(mid)<p) lo=mid; else hi=mid; }
  return mid;
}

function calcES(type,p) {
  try {
    if(type==="SMD"||type==="MD"){
      const n1=+p.n1,n2=+p.n2,sd1=+p.sd1,sd2=+p.sd2,m1=+p.m1,m2=+p.m2;
      if([n1,n2,sd1,sd2,m1,m2].some(isNaN)||n1<2||n2<2) return null;
      if(type==="MD"){const es=m1-m2,se=Math.sqrt(sd1**2/n1+sd2**2/n2);return{es:es,se:se,lo:es-1.96*se,hi:es+1.96*se};}
      const poolSD=Math.sqrt(((n1-1)*sd1**2+(n2-1)*sd2**2)/(n1+n2-2));
      const d=(m1-m2)/poolSD,se=Math.sqrt((n1+n2)/(n1*n2)+d**2/(2*(n1+n2)));
      return{es:d,se:se,lo:d-1.96*se,hi:d+1.96*se};
    }
    if(type==="OR"||type==="RR"||type==="RD"){
      // 2×2 counts a/b/c/d. A real zero count is valid; only missing/negative/
      // non-integer values are invalid. Detect missing before coercion (+""===0).
      const raw=[p.a,p.b,p.c,p.d];
      if(raw.some(v=>v===""||v===null||v===undefined)) return null;   // missing
      const a=+p.a,b=+p.b,c=+p.c,d2=+p.d;
      const cells=[a,b,c,d2];
      if(cells.some(v=>isNaN(v)||!isFinite(v)||v<0||!Number.isInteger(v))) return null;
      if(type==="RD"){
        // Risk difference (absolute scale): zeros natural, no continuity correction.
        const n1=a+b,n2=c+d2;
        if(n1<1||n2<1) return null;
        const r1=a/n1,r2=c/n2,rd=r1-r2;
        const se=Math.sqrt(r1*(1-r1)/n1+r2*(1-r2)/n2);
        if(!(se>0)) return null;   // degenerate (0 events both arms) → not poolable
        return{es:rd,se:se,lo:rd-1.96*se,hi:rd+1.96*se,
          display:`RD=${rd.toFixed(4)} [${(rd-1.96*se).toFixed(4)}, ${(rd+1.96*se).toFixed(4)}]`};
      }
      // OR/RR: double-zero-event table (a=0 AND c=0) is not estimable → use RD.
      if(a===0&&c===0) return null;
      // Haldane–Anscombe continuity correction: +0.5 to all cells when any cell is 0.
      const corrected=cells.some(v=>v===0);
      let A=a,B=b,Cc=c,D=d2;
      if(corrected){ A+=0.5;B+=0.5;Cc+=0.5;D+=0.5; }
      const lnE=type==="OR"?Math.log((A*D)/(B*Cc)):Math.log((A/(A+B))/(Cc/(Cc+D)));
      const se=type==="OR"?Math.sqrt(1/A+1/B+1/Cc+1/D):Math.sqrt(1/A-1/(A+B)+1/Cc-1/(Cc+D));
      const out={es:lnE,se:se,lo:lnE-1.96*se,hi:lnE+1.96*se,
        display:`${type}=${Math.exp(lnE).toFixed(3)} [${Math.exp(lnE-1.96*se).toFixed(3)}, ${Math.exp(lnE+1.96*se).toFixed(3)}]`};
      if(corrected){ out.continuityCorrectionApplied=true; out.continuityCorrectionValue=0.5; out.correctionMethod="Haldane-Anscombe";
        out.note=`Zero cell detected — 0.5 added to all four cells (Haldane–Anscombe) for log ${type}.`; }
      return out;
    }
    if(type==="HR"){
      const hr=+p.hr,lo=+p.lo,hi=+p.hi;
      if([hr,lo,hi].some(isNaN)||hr<=0||lo<=0||hi<=0) return null;
      const lnHR=Math.log(hr),se=(Math.log(hi)-Math.log(lo))/(2*1.96);
      return{es:lnHR,se:se,lo:lnHR-1.96*se,hi:lnHR+1.96*se,
        display:`HR=${hr} [${lo}, ${hi}]`};
    }
    if(type==="COR"){
      const r=+p.r,n=+p.n;
      if(isNaN(r)||isNaN(n)||Math.abs(r)>=1||n<4) return null;
      const z=0.5*Math.log((1+r)/(1-r)),se=1/Math.sqrt(n-3);
      return{es:z,se:se,lo:z-1.96*se,hi:z+1.96*se,
        display:`r=${r}, z=${z.toFixed(3)} [${(z-1.96*se).toFixed(3)}, ${(z+1.96*se).toFixed(3)}]`};
    }
    if(type==="PROP"){
      // single-arm proportion on the logit scale (with 0.5 continuity correction at extremes)
      let ev=+p.events,tot=+p.total;
      if(isNaN(ev)||isNaN(tot)||tot<1||ev<0||ev>tot) return null;
      let pr=ev/tot;
      if(ev===0||ev===tot){ ev+=0.5; tot+=1; pr=ev/tot; } // correction
      const logit=Math.log(pr/(1-pr)),se=Math.sqrt(1/(tot*pr*(1-pr)));
      const back=x=>{const e=Math.exp(x);return e/(1+e);};
      return{es:logit,se:se,lo:logit-1.96*se,hi:logit+1.96*se,
        display:`proportion=${(ev/tot).toFixed(3)} (logit ${logit.toFixed(3)}) → ${(100*back(logit-1.96*se)).toFixed(1)}%–${(100*back(logit+1.96*se)).toFixed(1)}%`};
    }
    if(type==="DIAG"){
      // diagnostic odds ratio on log scale from TP/FP/FN/TN (Haldane correction if any zero)
      let tp=+p.tp,fp=+p.fp,fn=+p.fn,tn=+p.tn;
      if([tp,fp,fn,tn].some(isNaN)||[tp,fp,fn,tn].some(v=>v<0)) return null;
      if([tp,fp,fn,tn].some(v=>v===0)){ tp+=0.5;fp+=0.5;fn+=0.5;tn+=0.5; }
      const lnDOR=Math.log((tp*tn)/(fp*fn)),se=Math.sqrt(1/tp+1/fp+1/fn+1/tn);
      const sens=tp/(tp+fn),spec=tn/(tn+fp);
      return{es:lnDOR,se:se,lo:lnDOR-1.96*se,hi:lnDOR+1.96*se,
        display:`Sens=${(sens*100).toFixed(1)}% Spec=${(spec*100).toFixed(1)}% · DOR=${Math.exp(lnDOR).toFixed(2)} [${Math.exp(lnDOR-1.96*se).toFixed(2)}, ${Math.exp(lnDOR+1.96*se).toFixed(2)}]`};
    }
  } catch(_){}
  return null;
}

/* Safety: detect when a study's raw data doesn't match its selected effect measure.
   The classic trap is two-arm data (events in each group) analysed as a single-arm
   proportion. Returns an array of {sev,msg,id,author} for the analysis-side gate. */
function analysisTypeWarnings(studies){
  const num=v=>v!==""&&v!=null&&!isNaN(+v);
  const out=[];
  studies.forEach(s=>{
    if(s.es==="") return; // only studies that will actually be pooled
    const who=(s.author||"a study")+(s.year?` ${s.year}`:"");
    const has2x2=["a","b","c","d"].some(k=>num(s[k]));
    const hasFull2x2=["a","b","c","d"].every(k=>num(s[k]));
    const hasProp=num(s.events)&&num(s.total);
    const hasCont=num(s.meanExp)||num(s.meanCtrl)||num(s.sdExp)||num(s.sdCtrl);
    const hasDiag=["tp","fp","fn","tn"].some(k=>num(s[k]));
    const t=s.esType;
    // two-arm counts present but analysed as single-arm proportion
    if(t==="PROP"&&has2x2)
      out.push({sev:"error",id:s.id,author:who,msg:`${who} has two-arm event counts (a/b/c/d) but is set as a single-arm Proportion. A two-arm outcome like mortality should be Odds Ratio or Risk Ratio, not a proportion. Change the measure, or clear the 2×2 cells if you truly want a single-arm rate.`});
    // proportion data but analysed as a comparative ratio
    if((t==="OR"||t==="RR")&&!hasFull2x2&&hasProp&&!has2x2)
      out.push({sev:"warn",id:s.id,author:who,msg:`${who} is set as ${t} but only single-arm events/total are filled. ${t} needs both groups (a, b, c, d).`});
    // continuous data but analysed as a ratio/proportion
    if((t==="OR"||t==="RR"||t==="PROP")&&hasCont)
      out.push({sev:"warn",id:s.id,author:who,msg:`${who} has continuous data (means/SDs) but is set as ${t}. Continuous outcomes are usually MD or SMD.`});
    // 2x2 present but measure is a continuous one
    if((t==="SMD"||t==="MD")&&hasFull2x2&&!hasCont)
      out.push({sev:"warn",id:s.id,author:who,msg:`${who} has a 2×2 event table but is set as ${t} (a continuous measure). Dichotomous outcomes are usually OR or RR.`});
    // diagnostic cells present but not a diagnostic measure
    if(hasDiag&&t&&t!=="DIAG")
      out.push({sev:"warn",id:s.id,author:who,msg:`${who} has TP/FP/FN/TN cells but is set as ${t}. Diagnostic data should use the Diagnostic (DOR) measure.`});
  });
  return out;
}

/* ════════════ DATA CONVERSION ENGINE ════════════ */
/* Inverse normal CDF (Acklam's algorithm) — used by median/IQR → SD conversions */
function invNorm(p){
  if(p<=0||p>=1) return NaN;
  const a=[-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00];
  const b=[-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,6.680131188771972e+01,-1.328068155288572e+01];
  const c=[-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,-2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00];
  const d=[7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,3.754408661907416e+00];
  const pl=0.02425;let q,r;
  if(p<pl){q=Math.sqrt(-2*Math.log(p));return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
  if(p<=1-pl){q=p-0.5;r=q*q;return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);}
  q=Math.sqrt(-2*Math.log(1-p));return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

/* Conversion catalogue. Each returns {ok, value|values, formula, method, detail} or {ok:false,error} */
const CONVERSIONS=[
  {id:"median_iqr", group:"Continuous → Mean/SD", label:"Median + IQR → Mean & SD",
   inputs:[["q1","Q1 (25th pct)"],["med","Median (Q2)"],["q3","Q3 (75th pct)"],["n","Sample size n"]],
   method:"Wan et al. (2014), Box-Cox method", run:p=>{
     const q1=+p.q1,med=+p.med,q3=+p.q3,n=+p.n;
     if([q1,med,q3,n].some(isNaN)||n<2||q3<q1) return {ok:false,error:"Need Q1 ≤ Q3 and n ≥ 2."};
     const mean=(q1+med+q3)/3;
     const denom=2*invNorm((0.75*n-0.125)/(n+0.25));
     const sd=(q3-q1)/denom;
     return {ok:true,values:{mean:+mean.toFixed(4),sd:+sd.toFixed(4)},
       formula:"mean ≈ (Q1+median+Q3)/3 ;  SD ≈ (Q3−Q1) / [2·Φ⁻¹((0.75n−0.125)/(n+0.25))]",
       detail:`mean = ${mean.toFixed(3)}, SD = ${sd.toFixed(3)}`};
   }},
  {id:"median_range", group:"Continuous → Mean/SD", label:"Median + Range (min–max) → Mean & SD",
   inputs:[["min","Minimum"],["med","Median"],["max","Maximum"],["n","Sample size n"]],
   method:"Wan et al. (2014) / Hozo et al. (2005)", run:p=>{
     const min=+p.min,med=+p.med,max=+p.max,n=+p.n;
     if([min,med,max,n].some(isNaN)||n<2||max<min) return {ok:false,error:"Need min ≤ max and n ≥ 2."};
     const mean=(min+2*med+max)/4;
     const denom=2*invNorm((n-0.375)/(n+0.25));
     const sd=(max-min)/denom;
     return {ok:true,values:{mean:+mean.toFixed(4),sd:+sd.toFixed(4)},
       formula:"mean ≈ (min+2·median+max)/4 ;  SD ≈ (max−min) / [2·Φ⁻¹((n−0.375)/(n+0.25))]",
       detail:`mean = ${mean.toFixed(3)}, SD = ${sd.toFixed(3)}`};
   }},
  {id:"se_sd", group:"Spread → SD", label:"Standard Error (SE) → SD",
   inputs:[["se","SE"],["n","Group n"]],
   method:"SD = SE × √n", run:p=>{
     const se=+p.se,n=+p.n;
     if([se,n].some(isNaN)||n<1||se<0) return {ok:false,error:"Need SE ≥ 0 and n ≥ 1."};
     const sd=se*Math.sqrt(n);
     return {ok:true,values:{sd:+sd.toFixed(4)},formula:"SD = SE × √n",detail:`SD = ${sd.toFixed(3)}`};
   }},
  {id:"ci_sd", group:"Spread → SD", label:"95% CI of a mean → SD",
   inputs:[["lo","CI lower"],["hi","CI upper"],["n","Group n"]],
   method:"SD = √n × (upper − lower) / (2 × 1.96)", run:p=>{
     const lo=+p.lo,hi=+p.hi,n=+p.n;
     if([lo,hi,n].some(isNaN)||n<1||hi<lo) return {ok:false,error:"Need lower ≤ upper and n ≥ 1."};
     const t=n<60?1.96+ (2.0-1.96)*Math.max(0,(60-n)/60):1.96; // mild small-n nudge toward t
     const sd=Math.sqrt(n)*(hi-lo)/(2*1.96);
     return {ok:true,values:{sd:+sd.toFixed(4)},formula:"SD = √n × (upper − lower) / (2 × 1.96)",
       detail:`SD = ${sd.toFixed(3)} (uses z=1.96; for small n the true t-value is slightly larger)`};
   }},
  {id:"pval_se", group:"Spread → SD", label:"P-value + effect → SE",
   inputs:[["effect","Effect estimate (e.g. mean diff or log ratio)"],["p","Two-sided P-value"]],
   method:"z from P, then SE = |effect| / z", run:p=>{
     const eff=+p.effect,pv=+p.p;
     if([eff,pv].some(isNaN)||pv<=0||pv>=1) return {ok:false,error:"Need 0 < P < 1 and a numeric effect."};
     const z=Math.abs(invNorm(pv/2));
     if(z===0) return {ok:false,error:"P too close to 1 to recover SE."};
     const se=Math.abs(eff)/z;
     return {ok:true,values:{se:+se.toFixed(4)},formula:"z = Φ⁻¹(1 − P/2) ;  SE = |effect| / z",
       detail:`z = ${z.toFixed(3)}, SE = ${se.toFixed(4)}`};
   }},
  {id:"pct_events", group:"Counts ↔ Percent", label:"Percentage → Event count",
   inputs:[["pct","Percentage (%)"],["n","Group total n"]],
   method:"events = round(% / 100 × n)", run:p=>{
     const pct=+p.pct,n=+p.n;
     if([pct,n].some(isNaN)||n<1||pct<0||pct>100) return {ok:false,error:"Need 0 ≤ % ≤ 100 and n ≥ 1."};
     const ev=Math.round(pct/100*n);
     return {ok:true,values:{events:ev,total:n},formula:"events = round(% / 100 × n)",
       detail:`events = ${ev} of ${n}`};
   }},
  {id:"events_pct", group:"Counts ↔ Percent", label:"Event count → Percentage",
   inputs:[["events","Events"],["n","Group total n"]],
   method:"% = events / n × 100", run:p=>{
     const ev=+p.events,n=+p.n;
     if([ev,n].some(isNaN)||n<1||ev<0||ev>n) return {ok:false,error:"Need 0 ≤ events ≤ n."};
     const pct=ev/n*100;
     return {ok:true,values:{pct:+pct.toFixed(2)},formula:"% = events / n × 100",detail:`${pct.toFixed(2)}%`};
   }},
  {id:"ratio_log", group:"Ratio measures", label:"OR / RR / HR → log + SE from CI",
   inputs:[["est","Point estimate (OR/RR/HR)"],["lo","95% CI lower"],["hi","95% CI upper"]],
   method:"ln(estimate); SE = (ln(upper) − ln(lower)) / (2 × 1.96)", run:p=>{
     const est=+p.est,lo=+p.lo,hi=+p.hi;
     if([est,lo,hi].some(isNaN)||est<=0||lo<=0||hi<=0||hi<lo) return {ok:false,error:"Need positive estimate with lower ≤ upper."};
     const lnE=Math.log(est),se=(Math.log(hi)-Math.log(lo))/(2*1.96);
     return {ok:true,values:{es:+lnE.toFixed(4),lo:+Math.log(lo).toFixed(4),hi:+Math.log(hi).toFixed(4),se:+se.toFixed(4)},
       formula:"ES = ln(estimate) ;  CI on log scale = ln(lower), ln(upper) ;  SE = (ln(upper) − ln(lower)) / (2×1.96)",
       detail:`lnES = ${lnE.toFixed(4)}, log-CI [${Math.log(lo).toFixed(4)}, ${Math.log(hi).toFixed(4)}], SE = ${se.toFixed(4)}`};
   }},
  {id:"unit_scale", group:"Other", label:"Unit conversion (linear scale factor)",
   inputs:[["val","Reported value"],["factor","Multiply by factor"]],
   method:"value × factor (e.g. mg→g use 0.001)", run:p=>{
     const v=+p.val,f=+p.factor;
     if([v,f].some(isNaN)) return {ok:false,error:"Need numeric value and factor."};
     return {ok:true,values:{value:+(v*f).toFixed(6)},formula:"converted = value × factor",detail:`${v} × ${f} = ${(v*f)}`};
   }},
];

/* ════════════ DATA QUALITY VALIDATION ════════════ */
/* Per-study checks: returns array of {sev:"error"|"warn", field, msg} */
function validateStudy(s){
  const out=[];
  const num=v=>v!==""&&v!==null&&v!==undefined&&!isNaN(+v);
  const add=(sev,field,msg)=>out.push({sev,field,msg});

  if(!s.author) add("warn","author","No author/study label.");
  if(!s.year) add("warn","year","No publication year.");
  if(!s.outcome) add("warn","outcome","Outcome not named — needed to keep outcomes consistent across studies.");

  // group sizes vs total n
  if(num(s.n)&&num(s.nExp)&&num(s.nCtrl)){
    if(Math.abs((+s.nExp+ +s.nCtrl)-+s.n)>0.5)
      add("error","n",`Group sizes (${+s.nExp}+${+s.nCtrl}=${+s.nExp+ +s.nCtrl}) don't match total n (${+s.n}).`);
  }
  // negative / impossible
  ["sdExp","sdCtrl"].forEach(k=>{ if(num(s[k])&&+s[k]<0) add("error",k,"SD cannot be negative."); });
  ["nExp","nCtrl","n","a","b","c","d","events","total","tp","fp","fn","tn"].forEach(k=>{
    if(num(s[k])&&+s[k]<0) add("error",k,`${k} cannot be negative.`);
  });
  // 2x2 sanity
  if(["OR","RR"].includes(s.esType)){
    const cells=["a","b","c","d"];
    const filled=cells.filter(k=>num(s[k]));
    if(filled.length>0&&filled.length<4) add("warn","a","2×2 table is partly filled — enter all of a, b, c, d.");
    if(filled.length===4&&(+s.a+ +s.b===0|| +s.c+ +s.d===0)) add("error","a","A 2×2 group total is zero.");
  }
  // single-arm proportion
  if(s.esType==="PROP"&&num(s.events)&&num(s.total)&&+s.events>+s.total)
    add("error","events","Events exceed total in single-arm proportion.");
  // diagnostic
  if(num(s.tp)||num(s.fp)||num(s.fn)||num(s.tn)){
    const dcells=["tp","fp","fn","tn"].filter(k=>num(s[k]));
    if(dcells.length>0&&dcells.length<4) add("warn","tp","Diagnostic 2×2 partly filled — enter TP, FP, FN, TN.");
  }
  // effect size + CI coherence
  if(num(s.es)&&num(s.lo)&&num(s.hi)){
    if(+s.lo>+s.hi) add("error","lo","95% CI lower bound is greater than upper bound.");
    else if(+s.es< +s.lo-1e-6 || +s.es> +s.hi+1e-6) add("error","es","Effect size lies outside its 95% CI.");
  }
  if(num(s.es)&&!num(s.lo)&&!num(s.hi)) add("warn","lo","Effect size has no confidence interval — it can't be weighted in the meta-analysis.");
  if(!num(s.es)&&(num(s.lo)||num(s.hi))) add("warn","es","CI entered but effect size is missing.");
  // effect-measure type
  if(num(s.es)&&!s.esType) add("warn","esType","No effect-measure type set — required to confirm studies are on the same scale.");
  // ratio measures should be entered on the log scale; flag if value looks like a raw ratio
  if(["OR","RR","HR"].includes(s.esType)&&num(s.es)&&+s.es>0&&num(s.lo)&&+s.lo>0){
    // crude heuristic: raw ratios are usually >0 with lower CI >0; log values are typically small and can be negative
    if(+s.es>1.6&&+s.lo>0.3) add("warn","es","For OR/RR/HR the meta-analysis expects the LOG of the ratio. Use the calculator or the OR/RR/HR conversion so the value and CI are log-transformed correctly.");
  }
  // continuous outcome missing a measure of spread
  if((s.esType==="SMD"||s.esType==="MD")&&(num(s.meanExp)||num(s.meanCtrl))&&!(num(s.sdExp)&&num(s.sdCtrl))&&!num(s.es))
    add("warn","sdExp","Means entered without both SDs. Use the conversion panel (SE→SD, CI→SD, median/IQR→SD) to recover the SD.");
  // flag-driven reminders
  const flags=s.flags||[];
  if(flags.includes("noconfirm")) add("warn","flags",'Marked "do not pool unless confirmed" — resolve before including in a pooled analysis.');
  if(flags.includes("highrisk")) add("warn","flags","Flagged high risk of extraction error — verify against the source.");
  if((flags.includes("conv")||s.converted)&&!s.source) add("warn","source","Value was converted but its data source isn't labelled.");
  if(flags.includes("figure")&&s.source!=="figure") add("warn","source","Flagged as figure-derived but data source isn't set to figure.");
  // converted value should keep a record
  if(s.converted&&(!s.conversions||s.conversions.length===0)) add("warn","converted","Marked converted but no conversion record is stored — re-run via the conversion panel for a full audit trail.");
  return out;
}

/* Duplicate detection across studies (same author+year, or identical es+n) */
function findDuplicates(studies){
  const dup={};
  for(let i=0;i<studies.length;i++){
    for(let j=i+1;j<studies.length;j++){
      const a=studies[i],b=studies[j];
      const sameAY=a.author&&b.author&&a.year&&b.year&&
        a.author.trim().toLowerCase()===b.author.trim().toLowerCase()&&String(a.year).trim()===String(b.year).trim();
      const sameES=a.es!==""&&a.es===b.es&&a.n!==""&&a.n===b.n;
      if(sameAY||sameES){ dup[a.id]=true; dup[b.id]=true; }
    }
  }
  return dup;
}

/* Project-level poolability gate: should these studies be pooled at all? */
function checkPoolability(studies){
  const valid=studies.filter(s=>s.es!==""&&s.lo!==""&&s.hi!==""&&!isNaN(+s.es)&&!isNaN(+s.lo)&&!isNaN(+s.hi));
  const blockers=[],warnings=[];
  if(valid.length<2){ blockers.push("Fewer than 2 studies have a usable effect size + 95% CI."); return {ok:false,blockers,warnings,valid}; }

  // mixed effect measures
  const types=[...new Set(valid.map(s=>s.esType).filter(Boolean))];
  if(types.length>1){
    // ratio measures (OR/RR/HR) are all on a log scale but are NOT interchangeable
    blockers.push(`Mixed effect measures: ${types.join(", ")}. Pooling different measures (e.g. OR with SMD, or OR with RR) is not valid — split into separate analyses.`);
  }
  const untyped=valid.filter(s=>!s.esType).length;
  if(untyped>0&&types.length>=1) warnings.push(`${untyped} stud${untyped===1?"y has":"ies have"} no effect-measure type set — confirm they are the same measure as the rest.`);

  // mixed designs
  const designs=[...new Set(valid.map(s=>s.design).filter(Boolean))];
  if(designs.length>1) warnings.push(`Mixed study designs: ${designs.join(", ")}. Pooling RCTs with observational studies is usually inappropriate — consider separate syntheses or subgrouping by design.`);

  // mixed time points for the same outcome
  const tps=[...new Set(valid.map(s=>(s.timepoint||"").trim()).filter(Boolean))];
  if(tps.length>1) warnings.push(`Multiple time points present (${tps.join(", ")}). Pool only comparable follow-up windows for the same outcome.`);

  // mixed adjusted/unadjusted (now across expanded adjustment categories)
  const adj=[...new Set(valid.map(s=>s.adjusted||"unadjusted"))];
  const hasUnadj=adj.includes("unadjusted");
  const hasAdj=adj.some(a=>a&&a!=="unadjusted");
  if(hasUnadj&&hasAdj) warnings.push(`Mix of unadjusted and adjusted estimates (${adj.map(a=>ADJUST_LABEL[a]||a).join(", ")}). Don't combine them without a clear plan — prefer one type, or analyse separately.`);
  else if(adj.length>1) warnings.push(`Multiple adjustment methods present (${adj.map(a=>ADJUST_LABEL[a]||a).join(", ")}). Confirm they are comparable before pooling.`);

  // mixed outcomes (loose check by outcome text)
  const outs=[...new Set(valid.map(s=>(s.outcome||"").trim().toLowerCase()).filter(Boolean))];
  if(outs.length>1) warnings.push(`Studies name ${outs.length} different outcomes. Confirm they measure the same construct before pooling.`);

  // primary vs non-primary data composition
  const nonPrimary=valid.filter(isNonPrimary);
  const converted=valid.filter(s=>s.converted||(s.flags||[]).includes("conv"));
  const natures=[...new Set(valid.map(s=>s.dataNature||"primary"))];
  if(natures.length>1) warnings.push(`Mix of data roles: ${natures.map(n=>DATA_NATURE_LABEL[n]||n).join(", ")}. Pooling secondary/subgroup/post-hoc estimates with primary-outcome data can bias the result.`);
  if(nonPrimary.length>0 && nonPrimary.length/valid.length>=0.5)
    warnings.push(`${nonPrimary.length} of ${valid.length} pooled values are non-primary, converted, figure-derived, or adjusted. The pooled estimate depends heavily on indirect data — interpret with caution and consider a sensitivity analysis limited to directly-reported primary data.`);
  if(converted.length>0 && converted.length<valid.length){
    const labelled=converted.every(s=>s.source==="converted"||s.source==="calculated"||(s.conversions||[]).length>0);
    if(!labelled) warnings.push("Converted and non-converted values are mixed but not all conversions are labelled. Label each converted value's source and method.");
  }

  // hard stop: values explicitly marked do-not-pool
  const noconfirm=valid.filter(s=>(s.flags||[]).includes("noconfirm"));
  if(noconfirm.length>0) blockers.push(`${noconfirm.length} value${noconfirm.length===1?" is":"s are"} marked "do not pool unless confirmed". Resolve or unflag before pooling.`);

  return {ok:blockers.length===0, blockers, warnings, valid, types, designs,
    composition:{total:valid.length,nonPrimary:nonPrimary.length,converted:converted.length,
      primary:valid.length-nonPrimary.length,natures,adj}};
}

/* ════════════ DEFAULTS ════════════ */
const mkProject = name => ({
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
const mkStudy = () => ({id:uid(),author:"",year:"",country:"",design:"RCT",n:"",outcome:"",
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

/* Physical location of an extracted value (WHERE in the paper) */
const SOURCE_OPTIONS=[
  ["","— where from? —"],["text","Reported in text"],["table","From a table"],
  ["figure","Figure / Kaplan–Meier curve"],["supplement","Supplementary material"],
  ["calculated","Calculated from reported data"],["converted","Converted from another format"],
  ["author","Obtained from authors"],["unclear","Unclear / needs verification"],
];
/* Methodological role of the estimate (WHAT KIND) */
const DATA_NATURE=[
  ["primary","Primary outcome (directly reported)",false],
  ["secondary","Secondary outcome",true],
  ["subgroup","Subgroup analysis",true],
  ["posthoc","Post-hoc analysis",true],
  ["sensitivity","Sensitivity analysis",true],
];
/* Adjustment status (expanded) */
const ADJUST_OPTIONS=[
  ["unadjusted","Unadjusted"],["adjusted","Adjusted (covariates)"],
  ["multivariable","Multivariable-adjusted"],["propensity","Propensity-matched"],
  ["iptw","IPTW-adjusted"],
];
/* Reliability flags (multi-select) */
const EXTRACT_FLAGS=[
  ["calc","Requires calculation"],["conv","Requires conversion"],
  ["figure","Estimated from figure"],["notprimary","Not primary data"],
  ["highrisk","High risk of extraction error"],["noconfirm","Do not pool unless confirmed"],
];
const DATA_NATURE_LABEL=Object.fromEntries(DATA_NATURE.map(([k,l])=>[k,l]));
const ADJUST_LABEL=Object.fromEntries(ADJUST_OPTIONS.map(([k,l])=>[k,l]));
const FLAG_LABEL=Object.fromEntries(EXTRACT_FLAGS.map(([k,l])=>[k,l]));
const SOURCE_LABEL=Object.fromEntries(SOURCE_OPTIONS.map(([k,l])=>[k,l]));
const isNonPrimary=s=>{
  const nat=s.dataNature&&s.dataNature!=="primary";
  const flg=(s.flags||[]).some(f=>["notprimary","figure","conv","calc","noconfirm","highrisk"].includes(f));
  const src=["figure","converted","calculated","author","unclear"].includes(s.source);
  return nat||flg||src||s.converted;
}

/* ════════════ REFERENCE IMPORT (RIS / BibTeX / EndNote XML / nbib) ════════════ */
function mkRecord(r){
  return {id:uid(),title:r.title||"",authors:r.authors||"",year:r.year||"",journal:r.journal||"",
    doi:(r.doi||"").replace(/^https?:\/\/(dx\.)?doi\.org\//i,"").trim(),
    pmid:r.pmid||"",abstract:r.abstract||"",source:r.source||"",
    decision:"",reviewer2:"",notes:"",dupOf:null};
}
function normTitle(t){ return String(t||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," "); }

/* RIS: tag-based "TY  - JOUR" ... "ER  -" */
function parseRIS(text){
  const recs=[]; let cur=null;
  text.split(/\r?\n/).forEach(line=>{
    const m=line.match(/^([A-Z][A-Z0-9])\s{0,2}-\s?(.*)$/);
    if(!m){ if(cur&&cur._last&&line.trim()){ cur[cur._last]+=" "+line.trim(); } return; }
    const tag=m[1], val=(m[2]||"").trim();
    if(tag==="TY"){ cur={authors:[],_last:null}; recs.push(cur); return; }
    if(!cur) { cur={authors:[],_last:null}; recs.push(cur); }
    if(tag==="ER"){ cur=null; return; }
    if(tag==="AU"||tag==="A1"||tag==="A2"){ cur.authors.push(val); cur._last=null; }
    else if(tag==="TI"||tag==="T1"){ cur.title=(cur.title?cur.title+" ":"")+val; cur._last="title"; }
    else if(tag==="JO"||tag==="JF"||tag==="T2"||tag==="JA"){ if(!cur.journal)cur.journal=val; cur._last="journal"; }
    else if(tag==="PY"||tag==="Y1"){ const y=(val.match(/\d{4}/)||[])[0]; if(y)cur.year=y; cur._last=null; }
    else if(tag==="DO"){ cur.doi=val; cur._last=null; }
    else if(tag==="AB"||tag==="N2"){ cur.abstract=(cur.abstract?cur.abstract+" ":"")+val; cur._last="abstract"; }
    else if(tag==="AN"&&/^\d+$/.test(val)){ if(!cur.pmid)cur.pmid=val; cur._last=null; }
    else if(tag==="ID"&&/^\d+$/.test(val)){ if(!cur.pmid)cur.pmid=val; cur._last=null; }
    else { cur._last=null; }
  });
  return recs.filter(r=>r.title||r.authors.length).map(r=>mkRecord({...r,authors:r.authors.join("; "),source:"RIS"}));
}

/* PubMed .nbib (MEDLINE format): "PMID- ", "TI  - ", "AU  - ", "DP  - ", "JT  - ", "AB  - ", "LID/AID doi" */
function parseNBIB(text){
  const recs=[]; let cur=null,last=null;
  text.split(/\r?\n/).forEach(line=>{
    if(/^\s{6}/.test(line)&&cur&&last){ cur[last]+=" "+line.trim(); return; }
    const m=line.match(/^([A-Z]{2,4})\s*-\s?(.*)$/);
    if(!m) return;
    const tag=m[1], val=(m[2]||"").trim();
    if(tag==="PMID"){ cur={authors:[]}; recs.push(cur); cur.pmid=val; last=null; return; }
    if(!cur){ cur={authors:[]}; recs.push(cur); }
    if(tag==="TI"){ cur.title=val; last="title"; }
    else if(tag==="AU"){ cur.authors.push(val); last=null; }
    else if(tag==="DP"){ const y=(val.match(/\d{4}/)||[])[0]; if(y)cur.year=y; last=null; }
    else if(tag==="JT"||tag==="TA"){ if(!cur.journal)cur.journal=val; last="journal"; }
    else if(tag==="AB"){ cur.abstract=val; last="abstract"; }
    else if(tag==="LID"||tag==="AID"){ const d=val.match(/(10\.\d{4,9}\/[^\s]+)\s*\[doi\]/i); if(d&&!cur.doi)cur.doi=d[1]; last=null; }
    else last=null;
  });
  return recs.filter(r=>r.title||r.pmid).map(r=>mkRecord({...r,authors:r.authors.join("; "),source:"PubMed"}));
}

/* BibTeX: @article{key, title={...}, author={...}, year={...}, journal={...}, doi={...}, abstract={...} } */
function parseBibTeX(text){
  const recs=[]; const entries=text.split(/@\w+\s*\{/).slice(1);
  entries.forEach(block=>{
    const rec={};
    const grab=(field)=>{
      // field = {value} or field = "value"
      const re=new RegExp(field+"\\s*=\\s*[{\"]","i");
      const m=re.exec(block); if(!m) return "";
      let i=m.index+m[0].length, depth=1, out="", open=block[i-1];
      for(;i<block.length;i++){ const ch=block[i];
        if(open==="{"){ if(ch==="{")depth++; else if(ch==="}"){depth--; if(depth===0)break;} }
        else { if(ch==="\"")break; }
        out+=ch;
      }
      return out.replace(/[{}]/g,"").replace(/\s+/g," ").trim();
    };
    rec.title=grab("title"); rec.year=(grab("year").match(/\d{4}/)||[])[0]||"";
    rec.journal=grab("journal")||grab("booktitle"); rec.doi=grab("doi"); rec.abstract=grab("abstract");
    const auth=grab("author"); rec.authors=auth?auth.split(/\s+and\s+/).join("; "):"";
    if(rec.title||rec.authors) recs.push(mkRecord({...rec,source:"BibTeX"}));
  });
  return recs;
}

/* EndNote XML (<records><record>...</record></records>) — uses DOMParser */
function parseEndNoteXML(text){
  const recs=[];
  try{
    const doc=new DOMParser().parseFromString(text,"text/xml");
    const records=doc.getElementsByTagName("record");
    for(let i=0;i<records.length;i++){
      const rec=records[i];
      const txt=sel=>{const el=rec.querySelector(sel);return el?el.textContent.replace(/\s+/g," ").trim():"";};
      const authorsNodes=rec.querySelectorAll("contributors authors author");
      const authors=Array.from(authorsNodes).map(a=>a.textContent.replace(/\s+/g," ").trim()).filter(Boolean).join("; ");
      recs.push(mkRecord({
        title:txt("titles title"),
        authors:authors,
        year:txt("dates year"),
        journal:txt("periodical full-title")||txt("titles secondary-title"),
        doi:txt("electronic-resource-num"),
        abstract:txt("abstract"),
        source:"EndNote"
      }));
    }
  }catch(e){ /* malformed XML */ }
  return recs.filter(r=>r.title||r.authors);
}

/* Auto-detect format from content and parse */
function parseReferences(text,filename){
  const fn=(filename||"").toLowerCase();
  const head=text.slice(0,3000);
  if(fn.endsWith(".xml")||/<xml|<records>|<record>/i.test(head)) return {records:parseEndNoteXML(text),format:"EndNote XML"};
  if(fn.endsWith(".bib")||/^@\w+\s*\{/m.test(head)) return {records:parseBibTeX(text),format:"BibTeX"};
  if(fn.endsWith(".nbib")||/^PMID\s*-/m.test(head)) return {records:parseNBIB(text),format:"PubMed nbib"};
  if(fn.endsWith(".ris")||/^TY\s{0,2}-/m.test(head)) return {records:parseRIS(text),format:"RIS"};
  // fallback: try RIS then BibTeX then nbib
  let r=parseRIS(text); if(r.length) return {records:r,format:"RIS"};
  r=parseBibTeX(text); if(r.length) return {records:r,format:"BibTeX"};
  r=parseNBIB(text); if(r.length) return {records:r,format:"MEDLINE"};
  return {records:[],format:"unknown"};
}

/* Mark duplicates within a record list (by DOI, PMID, or normalised title+year).
   Returns {unique:[...], dupCount, merged:[...]} — merged keeps all but tags dupOf. */
function dedupeRecords(existing, incoming){
  const all=[...existing];
  const seenDOI=new Map(), seenPMID=new Map(), seenTitle=new Map();
  existing.forEach(r=>{
    if(r.doi) seenDOI.set(r.doi.toLowerCase(),r.id);
    if(r.pmid) seenPMID.set(r.pmid,r.id);
    const k=normTitle(r.title)+"|"+(r.year||""); if(r.title) seenTitle.set(k,r.id);
  });
  let dupCount=0;
  incoming.forEach(r=>{
    let dupOf=null;
    if(r.doi&&seenDOI.has(r.doi.toLowerCase())) dupOf=seenDOI.get(r.doi.toLowerCase());
    else if(r.pmid&&seenPMID.has(r.pmid)) dupOf=seenPMID.get(r.pmid);
    else { const k=normTitle(r.title)+"|"+(r.year||""); if(r.title&&seenTitle.has(k)) dupOf=seenTitle.get(k); }
    if(dupOf){ dupCount++; r.dupOf=dupOf; }
    else {
      if(r.doi) seenDOI.set(r.doi.toLowerCase(),r.id);
      if(r.pmid) seenPMID.set(r.pmid,r.id);
      const k=normTitle(r.title)+"|"+(r.year||""); if(r.title) seenTitle.set(k,r.id);
    }
    all.push(r);
  });
  return {merged:all, dupCount, added:incoming.length};
}

/* Effect-measure metadata: which measures share a scale, null value, whether log-scale */
const ES_TYPES={
  SMD:{label:"SMD (standardized mean diff)",family:"continuous",log:false,nullVal:0,scale:"SMD"},
  MD:{label:"Mean Difference (raw units)",family:"continuous-raw",log:false,nullVal:0,scale:"MD"},
  OR:{label:"Odds Ratio (log scale)",family:"ratio",log:true,nullVal:0,scale:"lnOR"},
  RR:{label:"Risk Ratio (log scale)",family:"ratio",log:true,nullVal:0,scale:"lnRR"},
  RD:{label:"Risk Difference (raw)",family:"ratio",log:false,nullVal:0,scale:"RD"},
  HR:{label:"Hazard Ratio (log scale)",family:"ratio",log:true,nullVal:0,scale:"lnHR"},
  COR:{label:"Correlation (Fisher z)",family:"correlation",log:false,nullVal:0,scale:"z"},
  PROP:{label:"Single-arm proportion (logit)",family:"proportion",log:false,nullVal:null,scale:"logit"},
};

/* ════════════ CONSTANTS ════════════ */
const ROB2=[{id:"D1",label:"Randomisation process"},{id:"D2",label:"Deviations from intended interventions"},
  {id:"D3",label:"Missing outcome data"},{id:"D4",label:"Measurement of the outcome"},{id:"D5",label:"Selection of the reported result"}];
const NOS=[{id:"SC1",g:"Selection",label:"Representativeness of exposed cohort"},{id:"SC2",g:"Selection",label:"Selection of non-exposed cohort"},
  {id:"SC3",g:"Selection",label:"Ascertainment of exposure"},{id:"SC4",g:"Selection",label:"Absence of outcome at start"},
  {id:"CO1",g:"Comparability",label:"Comparability (most important factor)"},{id:"CO2",g:"Comparability",label:"Comparability (additional factor)"},
  {id:"OC1",g:"Outcome",label:"Assessment of outcome"},{id:"OC2",g:"Outcome",label:"Adequate follow-up length"},{id:"OC3",g:"Outcome",label:"Adequate follow-up rate"}];
const PRISMA_CL=[
  {id:"T1",sec:"Title",item:"Title",desc:"Identify the report as a systematic review"},
  {id:"A1",sec:"Abstract",item:"Abstract",desc:"Structured summary: background, objectives, eligibility, sources, methods, results, conclusions"},
  {id:"I1",sec:"Introduction",item:"Rationale",desc:"Describe the rationale in context of existing knowledge"},
  {id:"I2",sec:"Introduction",item:"Objectives",desc:"Explicit statement of objectives with PICO components"},
  {id:"M1",sec:"Methods",item:"Eligibility criteria",desc:"Specify inclusion/exclusion criteria and rationale"},
  {id:"M2",sec:"Methods",item:"Information sources",desc:"All databases, registers, websites, grey literature with dates"},
  {id:"M3",sec:"Methods",item:"Search strategy",desc:"Full search strategies for at least one database including filters"},
  {id:"M4",sec:"Methods",item:"Selection process",desc:"Who screened, how many reviewers, any automation used"},
  {id:"M5",sec:"Methods",item:"Data collection",desc:"Methods for collecting data (forms, dual extraction, reconciliation)"},
  {id:"M6",sec:"Methods",item:"Data items",desc:"List all outcomes and variables sought; assumptions and simplifications"},
  {id:"M7",sec:"Methods",item:"Risk of bias",desc:"Specify methods to assess risk of bias of included studies"},
  {id:"M8",sec:"Methods",item:"Effect measures",desc:"Specify the effect measure used (RR, OR, MD, SMD, HR)"},
  {id:"M9",sec:"Methods",item:"Synthesis methods",desc:"Meta-analysis model, heterogeneity tests (Q, I², τ²), software"},
  {id:"M10",sec:"Methods",item:"Reporting bias",desc:"Methods to assess reporting bias: funnel plot, Egger's/Begg's test"},
  {id:"M11",sec:"Methods",item:"Certainty (GRADE)",desc:"Methods used to assess certainty/confidence in evidence body"},
  {id:"R1",sec:"Results",item:"Study selection",desc:"Describe search results and selection; include PRISMA flow diagram"},
  {id:"R2",sec:"Results",item:"Study characteristics",desc:"Cite included studies with characteristics and interventions"},
  {id:"R3",sec:"Results",item:"Risk of bias",desc:"Present risk of bias assessments for each included study"},
  {id:"R4",sec:"Results",item:"Individual results",desc:"Present all results for each study for all outcomes"},
  {id:"R5",sec:"Results",item:"Synthesis results",desc:"Summarise synthesis results with heterogeneity measures"},
  {id:"R6",sec:"Results",item:"Reporting bias",desc:"Present assessments of risk of bias due to missing results"},
  {id:"R7",sec:"Results",item:"Certainty of evidence",desc:"Present GRADE assessments for each outcome"},
  {id:"D1r",sec:"Discussion",item:"Discussion",desc:"Interpretation in context; discuss limitations and implications"},
  {id:"O1r",sec:"Other",item:"Registration & protocol",desc:"Provide registration information (PROSPERO ID, DOI of protocol)"},
  {id:"O2r",sec:"Other",item:"Funding",desc:"Declare all sources of financial and non-financial support"},
  {id:"O3r",sec:"Other",item:"Competing interests",desc:"Declare competing interests of all review authors"},
];
const MESH_DBS=[
  {id:"pubmed",label:"PubMed",syntax:"MeSH + [TIAB]",color:"#3b82f6",
    controlled:"MeSH Terms",freeText:"[TIAB] Free-Text",
    guidance:"Use [MeSH Terms] (with subheadings where helpful) and [TIAB] for free text. Use [pt] for publication types (e.g., randomized controlled trial[pt]). Watch ambiguous abbreviations (HAS, MAPS, ARRA). Avoid forcing MeSH on very recent papers (not yet indexed)."},
  {id:"embase",label:"Embase",syntax:"Emtree /exp + .ti,ab.",color:"#8b5cf6",
    controlled:"Emtree Subject Headings",freeText:".ti,ab. Free-Text",
    guidance:"Use exp Emtree/ for explosion or /de for direct term only. Use .ti,ab. for title+abstract. Use .kw. for author keywords. Apply Cochrane RCT filter or Embase-specific filters (e.g., randomized controlled trial/ OR controlled clinical trial/)."},
  {id:"cochrane",label:"Cochrane CENTRAL",syntax:"MeSH + :ti,ab,kw",color:"#ec4899",
    controlled:"MeSH Terms",freeText:":ti,ab,kw Free-Text",
    guidance:"Use [mh \"...\"] for MeSH and :ti,ab,kw for free-text. CENTRAL is already filtered to trials — no need for RCT filter. Use NEAR/n for proximity searching."},
  {id:"wos",label:"Web of Science",syntax:"TS= topic field",color:"#f59e0b",
    controlled:"Topic Phrases",freeText:"TS= Keywords",
    guidance:"WoS has no controlled vocabulary — relies entirely on TS= (title/abstract/keyword) search. Use NEAR/n (default 15) for proximity. Use $ for variable suffix. Apply WC= for category filters and DT= for document types."},
  {id:"scopus",label:"Scopus",syntax:"TITLE-ABS-KEY()",color:"#10b981",
    controlled:"Indexed Keywords",freeText:"TITLE-ABS-KEY",
    guidance:"Use TITLE-ABS-KEY() for the main search. Use INDEXTERMS() for Scopus-indexed thesaurus terms (less reliable than PubMed MeSH). Use W/n and PRE/n for proximity. Apply LIMIT-TO(DOCTYPE,\"ar\") for articles."},
  {id:"cinahl",label:"CINAHL",syntax:"MH + TI/AB",color:"#ef4444",
    controlled:"CINAHL Headings (MH)",freeText:"TI/AB Free-Text",
    guidance:"Use MH \"...\" for major subject headings. Use MH \"...+\" to explode. Use TI/AB for free-text. Apply (MH \"Clinical Trials+\") OR PT clinical trial for trial filter. CINAHL specialises in nursing/allied health."},
  {id:"psycinfo",label:"PsycINFO",syntax:"DE Thesaurus + TI/AB",color:"#6366f1",
    controlled:"APA Thesaurus (DE)",freeText:"TI/AB Free-Text",
    guidance:"Use DE \"...\" for descriptors (APA Thesaurus). Use $exp for explosion. Use TI/AB for free-text. PsycINFO specialises in psychology/behavioral science — use psychology-specific terms."},
  {id:"lilacs",label:"LILACS/BVS",syntax:"DeCS + multilingual free text",color:"#14b8a6",
    controlled:"DeCS Descriptors",freeText:"Multilingual Free-Text",
    guidance:"DeCS is multilingual (English/Spanish/Portuguese). Use mh:\"...\" for descriptors. Always include terms in EN, ES, PT for free text. Use tw: for words anywhere. BVS portal aggregates LILACS + MEDLINE + others."},
];
const PROSP_FIELDS=[
  {id:"title",sec:"Identification",label:"Review Title",maxLen:300,rows:2,hint:"[Intervention] for [condition] in [population]: a systematic review and meta-analysis"},
  {id:"question",sec:"Identification",label:"Review Question",maxLen:1000,rows:3,hint:"Specific PICO-framed question(s). Number them if multiple."},
  {id:"condition",sec:"Background",label:"Condition or Domain",maxLen:200,rows:2,hint:"The disease or health topic (e.g. Type 2 diabetes mellitus). Keep brief."},
  {id:"population",sec:"Background",label:"Population",maxLen:800,rows:3,hint:"Who will be studied — age, sex, diagnostic criteria, clinical setting. 2–4 sentences."},
  {id:"intervention",sec:"Background",label:"Intervention(s)/Exposure(s)",maxLen:800,rows:3,hint:"The intervention(s) — include dose/frequency/route if relevant. 2–4 sentences."},
  {id:"comparator",sec:"Background",label:"Comparator(s)/Control",maxLen:800,rows:3,hint:"Comparison conditions (placebo, active comparator, usual care). 1–3 sentences."},
  {id:"context",sec:"Background",label:"Context",maxLen:800,rows:3,hint:"Clinical setting, geographic scope, healthcare system. 1–3 sentences."},
  {id:"primary_outcomes",sec:"Outcomes",label:"Primary Outcome(s)",maxLen:1000,rows:4,hint:"List primary outcomes with measurement method and time points. 3–5 outcomes max."},
  {id:"secondary_outcomes",sec:"Outcomes",label:"Secondary Outcome(s)",maxLen:1000,rows:4,hint:"Secondary outcomes with measurement methods and time points. 4–8 outcomes."},
  {id:"study_types",sec:"Methods",label:"Types of Study to be Included",maxLen:800,rows:3,hint:"e.g. RCTs only; include fallback if primary design data insufficient."},
  {id:"searches",sec:"Methods",label:"Searches",maxLen:2000,rows:5,hint:"Databases, date ranges, grey literature, trial registers, language limits."},
  {id:"data_extraction",sec:"Methods",label:"Data Extraction/Selection",maxLen:800,rows:3,hint:"Dual independent extraction, consensus/third reviewer for disagreements. 3–4 sentences."},
  {id:"risk_of_bias",sec:"Methods",label:"Risk of Bias Assessment",maxLen:800,rows:3,hint:"Tool (RoB 2 / ROBINS-I / NOS), who assesses, how disagreements resolved."},
  {id:"synthesis",sec:"Methods",label:"Strategy for Data Synthesis",maxLen:1000,rows:4,hint:"Model, effect measure, heterogeneity tests, software. Narrative plan if MA not feasible."},
  {id:"subgroups",sec:"Methods",label:"Subgroup or Subset Analyses",maxLen:800,rows:3,hint:"Pre-specified only. List 2–4 maximum."},
  {id:"certainty",sec:"Methods",label:"Assessment of Certainty/Confidence",maxLen:400,rows:2,hint:"State whether GRADE will be used. 1–2 sentences."},
  {id:"language",sec:"Scope",label:"Language",maxLen:200,rows:2,hint:"State any language restrictions. 1 sentence."},
  {id:"country",sec:"Scope",label:"Country",maxLen:100,rows:1,hint:"Country where the review team is based."},
  {id:"funding",sec:"Administrative",label:"Funding Sources/Sponsors",maxLen:400,rows:2,hint:"All funding sources. 'No external funding' if self-funded."},
  {id:"conflicts",sec:"Administrative",label:"Conflicts of Interest",maxLen:400,rows:2,hint:"'None declared' if no conflicts."},
];

/* ════════════ THEME ════════════ */
/* Theme tokens — CSS custom properties defined in src/frontend/theme/tokens.js
   ([data-theme] on <html> switches night/day). Alpha tints MUST go through
   themeAlpha(C.x,'NN') — `${C.x}NN` concatenation breaks on var() strings. */
const C={
  bg:"var(--t-bg)",        // deep background
  surf:"var(--t-surf)",    // sidebar / elevated surface
  card:"var(--t-card)",    // card background
  card2:"var(--t-card2)",  // slightly lighter card for nesting
  brd:"var(--t-brd)",      // border
  brd2:"var(--t-brd2)",    // slightly lighter border
  acc:"var(--t-acc)",      // accent
  acc2:"var(--t-acc2)",    // deeper accent for hover/active
  accText:"var(--t-acc-text)", // text on accent/saturated fills (theme-aware)
  grn:"var(--t-grn)",      // green
  grn2:"var(--t-grn2)",    // deeper green
  yel:"var(--t-yel)",      // amber
  red:"var(--t-red)",      // red
  purp:"var(--t-purp)",    // purple
  txt:"var(--t-txt)",      // primary text
  txt2:"var(--t-txt2)",    // secondary text
  muted:"var(--t-muted)",  // muted text
  dim:"var(--t-dim)",      // very dim
};
const btnS=(v="primary")=>({
  padding:"7px 16px",borderRadius:8,border:"none",cursor:"pointer",
  fontSize:12,fontFamily:"'IBM Plex Sans',sans-serif",fontWeight:600,
  transition:"transform 0.12s cubic-bezier(0.23,1,0.32,1),box-shadow 0.18s ease,filter 0.15s ease,background 0.18s ease,border-color 0.15s ease,opacity 0.15s ease",
  letterSpacing:0.2,display:"inline-flex",alignItems:"center",gap:5,whiteSpace:"nowrap",
  ...(v==="primary"?{
    background:`linear-gradient(145deg,${C.acc},${C.acc2})`,
    color:"var(--t-acc-text)",boxShadow:`0 1px 0 0 rgba(255,255,255,0.12) inset, 0 2px 12px ${themeAlpha(C.acc2,'40')}`}:
  v==="ghost"?{
    background:"transparent",color:C.txt2,
    border:`1px solid ${C.brd2}`}:
  v==="danger"?{
    background:`${themeAlpha(C.red,'10')}`,color:C.red,
    border:`1px solid ${themeAlpha(C.red,'30')}`}:
  v==="success"?{
    background:`linear-gradient(145deg,${C.grn},${C.grn2})`,
    color:"var(--t-acc-text)",boxShadow:`0 2px 10px ${themeAlpha(C.grn,'30')}`}:
  {background:C.card2,color:C.txt,border:`1px solid ${C.brd2}`})
});
const inp={
  background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,
  padding:"8px 12px",color:C.txt,fontFamily:"'IBM Plex Sans',sans-serif",
  fontSize:12.5,outline:"none",width:"100%",boxSizing:"border-box",
  transition:"border-color 0.15s,box-shadow 0.15s",
};
const lbl={
  fontSize:10,fontWeight:700,color:C.muted,display:"block",
  marginBottom:5,letterSpacing:0.8,textTransform:"uppercase",
};
const th={
  padding:"9px 14px",background:C.bg,color:C.muted,fontWeight:700,
  fontSize:10,letterSpacing:0.7,textTransform:"uppercase",textAlign:"right",
  borderBottom:`1px solid ${C.brd}`,whiteSpace:"nowrap",
};
const tagS=(c)=>({
  display:"inline-flex",alignItems:"center",padding:"2px 10px",borderRadius:99,
  fontSize:10,fontWeight:600,letterSpacing:0.3,whiteSpace:"nowrap",
  ...(c==="green"?{background:`${themeAlpha(C.grn,'14')}`,color:C.grn,border:`1px solid ${themeAlpha(C.grn,'30')}`}:
    c==="red"?{background:`${themeAlpha(C.red,'14')}`,color:C.red,border:`1px solid ${themeAlpha(C.red,'30')}`}:
    c==="yellow"?{background:`${themeAlpha(C.yel,'14')}`,color:C.yel,border:`1px solid ${themeAlpha(C.yel,'30')}`}:
    c==="blue"?{background:`${themeAlpha(C.acc,'14')}`,color:C.acc,border:`1px solid ${themeAlpha(C.acc,'30')}`}:
    c==="purple"?{background:`${themeAlpha(C.purp,'14')}`,color:C.purp,border:`1px solid ${themeAlpha(C.purp,'30')}`}:
    {background:C.card2,color:C.muted,border:`1px solid ${C.brd}`})
});

/* ════════════ SHARED COMPONENTS ════════════ */
/* prompt36 Task 5 — the app-standard on/off SWITCH (sliding pill + knob), matching
   the screening Toggle. Used for Project Control's Blind mode / Restrict chat so
   they read as real switches, not ambiguous text pills. Accessible (role="switch",
   aria-checked, real <button> ⇒ keyboard-activatable); the knob/track transitions
   are disabled under prefers-reduced-motion via the .ml-switch-knob CSS rule. */
function SwitchToggle({on,busy,onClick,onLabel="On",offLabel="Off",ariaLabel}){
  return(
    <button type="button" role="switch" aria-checked={!!on} aria-label={ariaLabel} disabled={busy} onClick={onClick}
      style={{display:"inline-flex",alignItems:"center",gap:10,background:"none",border:"none",padding:0,cursor:busy?"default":"pointer",opacity:busy?0.6:1,fontFamily:"inherit"}}>
      <span aria-hidden="true" style={{width:38,height:22,borderRadius:11,position:"relative",flexShrink:0,boxSizing:"border-box",background:on?C.acc2:C.dim,border:`1px solid ${on?C.acc2:C.brd2}`,transition:"background 0.2s ease,border-color 0.2s ease"}}>
        <span className="ml-switch-knob" style={{position:"absolute",top:1,left:on?17:1,width:18,height:18,borderRadius:"50%",background:"#fff",boxShadow:"0 1px 3px rgba(0,0,0,0.35)",transition:"left 0.2s var(--ease-out)"}}/>
      </span>
      <span style={{fontSize:12,fontWeight:700,color:on?C.acc:C.muted,minWidth:62,textAlign:"left"}}>{on?onLabel:offLabel}</span>
    </button>
  );
}
function SectionHeader({icon,title,desc,badge}){
  return(<div style={{marginBottom:28}}>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:7}}>
      <div style={{
        width:34,height:34,borderRadius:10,
        background:`${themeAlpha(C.acc,'18')}`,
        border:`1px solid ${themeAlpha(C.acc,'28')}`,
        display:"flex",alignItems:"center",justifyContent:"center",
        color:C.acc,flexShrink:0,
      }}>{/* <Icon> renders nothing for unknown names, so stray emoji props show nothing */}
        <Icon name={icon} size={15}/></div>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <h2 style={{margin:0,fontSize:18,fontWeight:700,letterSpacing:-0.4,color:C.txt,lineHeight:1.2}}>{title}</h2>
        {badge&&<span style={{...tagS("blue")}}>{badge}</span>}
      </div>
    </div>
    {desc&&<p style={{margin:0,fontSize:12.5,color:C.muted,lineHeight:1.7,paddingLeft:46}}>{desc}</p>}
  </div>);
}
function InfoBox({children,color}){
  const col=color||C.acc;
  return(<div style={{
    background:`${themeAlpha(col,'0c')}`,border:`1px solid ${themeAlpha(col,'22')}`,borderLeft:`3px solid ${themeAlpha(col,'80')}`,
    borderRadius:10,padding:"12px 16px",marginTop:14,fontSize:12.5,color:C.txt2,lineHeight:1.7,
  }}>{children}</div>);
}
/* Hover tooltip with a help "?" trigger — for beginner guidance. prompt24
   follow-up: the bubble is PORTALED to <body> so it can never be clipped by an
   overflow-hidden table/card or a transformed ancestor (the old position:absolute
   z-300 bubble was getting trapped — e.g. the "?" beside Measure / Convert data in
   Data Extraction). It floats above everything at z 10000, flips below the "?"
   when there's no room above, and is clamped into the viewport. */
function HelpTip({text}){
  const[show,setShow]=useState(false);
  const[pos,setPos]=useState(null);
  const ref=useRef(null);
  const place=useCallback(()=>{
    const el=ref.current; if(!el) return;
    const r=el.getBoundingClientRect();
    const W=260, margin=8;
    let left=r.left+r.width/2-W/2;
    left=Math.max(margin,Math.min(left,window.innerWidth-W-margin));
    const above=r.top>150; // room above the trigger?
    setPos(above
      ?{left,bottom:window.innerHeight-r.top+8,top:"auto"}
      :{left,top:r.bottom+8,bottom:"auto"});
  },[]);
  const open=useCallback(()=>{place();setShow(true);},[place]);
  useEffect(()=>{
    if(!show) return undefined;
    const onMove=()=>place();
    window.addEventListener("scroll",onMove,true);
    window.addEventListener("resize",onMove);
    return ()=>{window.removeEventListener("scroll",onMove,true);window.removeEventListener("resize",onMove);};
  },[show,place]);
  return(<span ref={ref} style={{position:"relative",display:"inline-flex",marginLeft:6}}
    onMouseEnter={open} onMouseLeave={()=>setShow(false)}>
    <span style={{
      width:16,height:16,borderRadius:"50%",
      border:`1px solid ${C.brd2}`,color:C.muted,background:C.card2,
      fontSize:9,fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center",cursor:"help",
      transition:"border-color 0.15s",
    }}>?</span>
    {show&&pos&&createPortal(<span style={{
      position:"fixed",top:pos.top,bottom:pos.bottom,left:pos.left,
      background:C.surf,color:C.txt2,fontSize:11,fontWeight:400,lineHeight:1.6,
      padding:"9px 13px",borderRadius:8,width:260,maxWidth:"92vw",zIndex:10000,
      border:`1px solid ${C.brd2}`,boxShadow:"0 12px 40px var(--t-shadow)",
      textTransform:"none",letterSpacing:0,pointerEvents:"none",
    }}>{text}</span>,document.body)}
  </span>);
}
/* Small AI button used for refine actions.
   Renders nothing while AI features are hidden (prompt6 Task 16). */
function AIButton({onClick,loading,label,disabled}){
  if(!AI_FEATURES_ENABLED) return null; // AI features hidden pending future implementation
  return(<button onClick={onClick} disabled={loading||disabled}
    style={{
      ...btnS("ghost"),fontSize:11,color:C.purp,borderColor:themeAlpha(C.purp,'44'),
      opacity:(loading||disabled)?0.5:1,
      background:loading?`${themeAlpha(C.purp,'0a')}`:"transparent",
    }}>
    {loading?<><span className="spin-ico">⟳</span> Working…</>:<>✦ {label}</>}
  </button>);
}
function ProgressBar({done,total,color}){
  const col=color||C.acc;
  const pct=total?Math.round((done/total)*100):0;
  const barColor=pct===100?C.grn:col;
  return(<div style={{display:"flex",alignItems:"center",gap:10}}>
    <div style={{flex:1,background:C.brd,borderRadius:99,height:5,overflow:"hidden"}}>
      <div style={{width:`${pct}%`,height:"100%",background:barColor,borderRadius:99,transition:"width 0.45s cubic-bezier(0.23,1,0.32,1)"}}/>
    </div>
    <span style={{fontSize:11,fontFamily:"'IBM Plex Mono',monospace",color:pct===100?C.grn:C.muted,minWidth:50,textAlign:"right"}}>{done}/{total}</span>
  </div>);
}

/* ════════════ FOREST PLOT ════════════ */
function ForestPlot({result,esLabel="Effect Size",nullLine=0,esType="",showCounts=true,showWeights=true,svgId="forestplot-svg",prec,live=false,theme="night"}){
  if(!result) return(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
    <div style={{fontSize:32,marginBottom:8}}>🌲</div>Enter effect sizes for at least 2 studies to generate a forest plot
  </div>);
  const{studies,pES,lo95,hi95,I2,Q,Qpval,tau2,k,pval}=result;
  // prompt19 — the LIVE on-screen plot follows the app theme (day=light, night=dark)
  // and scales to its container; the EXPORT render (live=false) keeps the absolute
  // dark hex so the downloaded "Dark (screen)" artifact never changes. The white
  // "Light (publication)" export is a separate builder and is untouched.
  const DARK={txt:"#eaecf6",dim:"#253050",brd:"#1f2640",muted:"#536080",acc:"#818cf8",grn:"#34d399"};
  const LIGHT={txt:"#0f172a",dim:"#64748b",brd:"#e2e8f0",muted:"#64748b",acc:"#4f46e5",grn:"#059669"};
  const dayLive=live&&theme==="day";
  const FC=dayLive?LIGHT:DARK;
  const BG=dayLive?"#ffffff":"#0e1420";
  const isLog=esType&&ES_TYPES[esType]&&ES_TYPES[esType].log;
  const isProp=esType==="PROP";
  const bt=x=>{ if(isLog)return Math.exp(x); if(isProp){const e=Math.exp(x);return e/(1+e);} return x; };
  const fmtV=(x,pr)=>isProp?(bt(x)*100).toFixed(normalizePrecision(pr||prec).decimals)+"%":(isLog?fmtES(bt(x),pr||prec):fmtES(x,pr||prec));
  // does any study actually have count data to show?
  const anyExp=studies.some(s=>s.a!==""&&s.a!=null), anyCtrl=studies.some(s=>s.c!==""&&s.c!=null);
  const colCounts=showCounts&&(anyExp||anyCtrl);
  // ---- layout ----
  const padL=12, nameW=150;
  const cExp=colCounts?70:0, cCtrl=colCounts?70:0;
  const LM=padL+nameW+cExp+cCtrl;            // left block width before the plot
  const plotW=300;
  const cEff=128;                             // "ES [95% CI]" text column
  const cWf=showWeights?54:0, cWr=showWeights?54:0;
  const RM=cEff+cWf+cWr+16;
  const W=LM+plotW+RM;
  const TOP=46, ROW=24, BOT=58, H=TOP+(k+2.6)*ROW+BOT;
  const allVals=[...studies.flatMap(s=>[s._lo,s._hi]),lo95,hi95];
  const minV=Math.min(...allVals)-0.2,maxV=Math.max(...allVals)+0.2,range=(maxV-minV)||1;
  const xS=v=>LM+((Math.max(minV,Math.min(maxV,v))-minV)/range)*plotW,yP=i=>TOP+(i+0.5)*ROW;
  const gridVals=[];
  for(let v=Math.ceil(minV*2)/2;v<=maxV;v+=0.5) gridVals.push(+v.toFixed(1));
  const xPlotEnd=LM+plotW;
  const colEffX=xPlotEnd+10, colWfX=colEffX+cEff, colWrX=colWfX+cWf;
  // prompt20 Task 4 — stack the x-axis annotations on SEPARATE rows so the
  // centered effect-measure label (e.g. "SMD") never overlaps the "← favours /
  // favours →" labels that flank the null line (they previously shared one y).
  const yAxisTicks=TOP+(k+1.5)*ROW;   // back-transformed tick numbers
  const yFavours=yAxisTicks+16;        // favours arrows, flanking the null line
  const yEsLabel=yFavours+17;          // effect-measure label, centered, own row
  const yHetero=yEsLabel+20;           // heterogeneity summary, below everything
  return(<div style={{overflowX:"auto",width:"100%"}}>
    <svg id={svgId} width={live?"100%":W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      style={{fontFamily:"'IBM Plex Mono',monospace",background:BG,borderRadius:8,display:"block",
        // prompt39 Task 4 — the live plot caps at its natural width; margin-inline
        // auto CENTERS that capped block in the (wider) container instead of
        // left-aligning it. Export render (live=false) is unaffected.
        ...(live?{width:"100%",height:"auto",maxWidth:Math.round(W*1.5),margin:"0 auto",border:`1px solid ${dayLive?"#e2e8f0":"#1f2640"}`}:{})}}>
      <rect x={0} y={0} width={W} height={H} fill={BG}/>
      {/* Header row */}
      <text x={padL} y={26} fontSize={11} fill={FC.txt} fontWeight={700}>Study</text>
      {colCounts&&<text x={padL+nameW} y={20} fontSize={9} fill={FC.dim} fontWeight={700}>Experimental</text>}
      {colCounts&&<text x={padL+nameW} y={32} fontSize={9} fill={FC.dim}>events / total</text>}
      {colCounts&&<text x={padL+nameW+cExp} y={20} fontSize={9} fill={FC.dim} fontWeight={700}>Control</text>}
      {colCounts&&<text x={padL+nameW+cExp} y={32} fontSize={9} fill={FC.dim}>events / total</text>}
      <text x={colEffX} y={26} fontSize={10} fill={FC.dim} fontWeight={700}>{isLog||isProp?"Effect [95% CI]":"ES [95% CI]"}</text>
      {showWeights&&<text x={colWfX} y={20} fontSize={9} fill={FC.dim} fontWeight={700}>Weight</text>}
      {showWeights&&<text x={colWfX} y={32} fontSize={9} fill={FC.dim}>(common)</text>}
      {showWeights&&<text x={colWrX} y={20} fontSize={9} fill={FC.dim} fontWeight={700}>Weight</text>}
      {showWeights&&<text x={colWrX} y={32} fontSize={9} fill={FC.dim}>(random)</text>}
      <line x1={padL} y1={TOP-4} x2={W-6} y2={TOP-4} stroke={FC.brd}/>
      {/* grid + null line */}
      {gridVals.map(v=><line key={v} x1={xS(v)} y1={TOP} x2={xS(v)} y2={TOP+k*ROW} stroke={v===nullLine?"#38bdf855":FC.brd} strokeWidth={v===nullLine?1.5:0.5} strokeDasharray={v===nullLine?"none":"3,3"}/>)}
      <line x1={xS(nullLine)} y1={TOP-4} x2={xS(nullLine)} y2={TOP+k*ROW+6} stroke={FC.muted} strokeWidth={1}/>
      {studies.map((s,i)=>{
        const cy=yP(i),x1=xS(s._lo),x2=xS(s._hi),xc=xS(s._es),sq=Math.max(4,Math.min(12,(s._wFixedPct||10)/4+3));
        const expStr=(s.a!==""&&s.a!=null)?`${s.a} / ${(+s.a)+(+s.b||0)||s.nExp||"?"}`:(s.events!==""&&s.events!=null?`${s.events} / ${s.total||"?"}`:"—");
        const ctrlStr=(s.c!==""&&s.c!=null)?`${s.c} / ${(+s.c)+(+s.d||0)||s.nCtrl||"?"}`:"—";
        return(<g key={s.id||i}>
          <text x={padL} y={cy+4} fontSize={11} fill={FC.txt}>{(s.author||"Study").slice(0,20)}{s.year?` ${s.year}`:""}</text>
          {colCounts&&<text x={padL+nameW} y={cy+4} fontSize={10} fill={FC.muted}>{expStr}</text>}
          {colCounts&&<text x={padL+nameW+cExp} y={cy+4} fontSize={10} fill={FC.muted}>{ctrlStr}</text>}
          <line x1={x1} y1={cy} x2={x2} y2={cy} stroke={FC.acc} strokeWidth={1.5}/>
          <line x1={x1} y1={cy-4} x2={x1} y2={cy+4} stroke={FC.acc} strokeWidth={1.5}/>
          <line x1={x2} y1={cy-4} x2={x2} y2={cy+4} stroke={FC.acc} strokeWidth={1.5}/>
          <rect x={xc-sq/2} y={cy-sq/2} width={sq} height={sq} fill={FC.acc} rx={1}/>
          <text x={colEffX} y={cy+4} fontSize={10} fill={FC.muted}>{fmtV(s._es,prec)} [{fmtV(s._lo,prec)}, {fmtV(s._hi,prec)}]</text>
          {showWeights&&<text x={colWfX} y={cy+4} fontSize={10} fill={FC.dim}>{fmtWeight(s._wFixedPct||0,prec)}%</text>}
          {showWeights&&<text x={colWrX} y={cy+4} fontSize={10} fill={FC.dim}>{fmtWeight(s._wRandomPct||0,prec)}%</text>}
        </g>);
      })}
      <line x1={padL} y1={TOP+k*ROW+6} x2={W-6} y2={TOP+k*ROW+6} stroke={FC.brd}/>
      {/* Pooled diamond (selected model) */}
      {(()=>{
        const cy=yP(k+0.4),x1=xS(lo95),x2=xS(hi95),xc=xS(pES),dh=8;
        return(<g>
          <text x={padL} y={cy+4} fontSize={11} fill={FC.grn} fontWeight={700}>{result.method==="fixed"?"Pooled (common)":"Pooled (random)"}</text>
          <polygon points={`${xc},${cy-dh} ${x2},${cy} ${xc},${cy+dh} ${x1},${cy}`} fill={FC.grn} opacity={0.9}/>
          <text x={colEffX} y={cy+4} fontSize={10} fill={FC.grn} fontWeight={700}>{fmtV(pES,prec)} [{fmtV(lo95,prec)}, {fmtV(hi95,prec)}]</text>
          {showWeights&&<text x={colWfX} y={cy+4} fontSize={10} fill={FC.grn}>100%</text>}
          {showWeights&&<text x={colWrX} y={cy+4} fontSize={10} fill={FC.grn}>100%</text>}
        </g>);
      })()}
      {/* axis ticks (back-transformed labels for log/prop) */}
      {gridVals.map(v=><text key={v} x={xS(v)} y={yAxisTicks} textAnchor="middle" fontSize={10} fill={FC.muted}>{isLog?bt(v).toFixed(2):(isProp?(bt(v)*100).toFixed(0)+"%":v)}</text>)}
      {/* favours labels — flank the null line, one row below the ticks */}
      <text x={xS(nullLine)-6} y={yFavours} textAnchor="end" fontSize={9} fill={FC.dim}>← favours</text>
      <text x={xS(nullLine)+6} y={yFavours} textAnchor="start" fontSize={9} fill={FC.dim}>favours →</text>
      {/* effect-measure label — centered under the plot, on its own row */}
      <text x={LM+plotW/2} y={yEsLabel} textAnchor="middle" fontSize={11} fill={FC.txt}>{esLabel}</text>
      {/* heterogeneity line — prompt32 Task 8: route every number through the
          precision helpers so the LIVE plot matches the exported figure (export
          path uses the same fmtI2/fmtNum). I²/weights stay 1dp by convention. */}
      <text x={padL} y={yHetero} fontSize={10} fill={FC.dim}>
        Heterogeneity: I² = {fmtI2(I2,prec)}%  ·  τ² = {fmtNum(tau2,prec)}  ·  Q = {fmtNum(Q,prec)} (p {Qpval<0.001?"< 0.001":"= "+fmtNum(Qpval,prec)})  ·  overall p {pval<0.001?"< 0.001":"= "+fmtNum(pval,prec)}
      </text>
    </svg>
  </div>);
}


/* ════════════ FUNNEL PLOT ════════════ */
function FunnelPlot({studies}){
  var valid = studies.filter(function(s){ return s.es!==""&&s.lo!==""&&s.hi!==""&&!isNaN(+s.es)&&!isNaN(+s.lo)&&!isNaN(+s.hi); });
  if (valid.length < 3) return (<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
    <div style={{fontSize:32,marginBottom:8}}>📉</div>Funnel plot requires at least 3 studies with effect sizes
  </div>);
  var pts = valid.map(function(s){
    var es=+s.es, se=(+s.hi-+s.lo)/(2*1.96);
    return { es:es, se:se, label:(s.author||"Study")+(s.year?" "+s.year:"") };
  });
  // Pooled estimate for the centre line
  var pooled = runMeta(studies, "random");
  var centre = pooled ? pooled.pES : pts.reduce(function(a,p){return a+p.es;},0)/pts.length;
  var maxSE = Math.max.apply(null, pts.map(function(p){return p.se;}))*1.15;
  var allES = pts.map(function(p){return p.es;});
  var dataMin = Math.min.apply(null, allES);
  var dataMax = Math.max.apply(null, allES);
  var halfRange = Math.max(centre-dataMin, dataMax-centre, 1.96*maxSE) * 1.1;
  var minX = centre - halfRange;
  var maxX = centre + halfRange;
  var W=620, H=440, ML=64, MR=20, MT=24, MB=56;
  var plotW=W-ML-MR, plotH=H-MT-MB;
  var xS = function(x){ return ML + ((x-minX)/(maxX-minX))*plotW; };
  var yS = function(se){ return MT + (se/maxSE)*plotH; }; // SE increases downward
  // 95% CI funnel boundaries
  var funnelPts = [];
  var steps = 30;
  for (var i=0; i<=steps; i++){
    var se = (i/steps)*maxSE;
    funnelPts.push({ se:se, lo:centre-1.96*se, hi:centre+1.96*se });
  }
  var leftPath = funnelPts.map(function(p,i){ return (i===0?"M":"L")+xS(p.lo)+","+yS(p.se); }).join(" ");
  var rightPath = funnelPts.slice().reverse().map(function(p){ return "L"+xS(p.hi)+","+yS(p.se); }).join(" ");
  var funnelPath = leftPath + " " + rightPath + " Z";
  // SE ticks
  var seTicks = [];
  for (var t=0; t<=4; t++){ seTicks.push((maxSE*t/4)); }
  // ES ticks
  var esTicks = [];
  var esStep = (maxX-minX)/6;
  for (var et=0; et<=6; et++){ esTicks.push(minX + et*esStep); }
  return (<div style={{overflowX:"auto"}}>
    <svg id="funnelplot-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{fontFamily:"'IBM Plex Mono',monospace",background:C.card,borderRadius:8,display:"block"}}>
      {/* funnel region (shaded 95% CI) */}
      <path d={funnelPath} fill={themeAlpha(C.acc,'15')} stroke={themeAlpha(C.acc,'55')} strokeWidth={1} strokeDasharray="4,4"/>
      {/* centre line */}
      <line x1={xS(centre)} y1={MT} x2={xS(centre)} y2={MT+plotH} stroke={C.grn} strokeWidth={1.5} strokeDasharray="3,3"/>
      {/* axis lines */}
      <line x1={ML} y1={MT} x2={ML} y2={MT+plotH} stroke={C.brd}/>
      <line x1={ML} y1={MT+plotH} x2={ML+plotW} y2={MT+plotH} stroke={C.brd}/>
      {/* SE ticks (y) */}
      {seTicks.map(function(t,i){ return (<g key={i}>
        <line x1={ML-4} y1={yS(t)} x2={ML} y2={yS(t)} stroke={C.brd}/>
        <text x={ML-8} y={yS(t)+4} textAnchor="end" fontSize={10} fill={C.muted}>{t.toFixed(3)}</text>
      </g>); })}
      {/* ES ticks (x) */}
      {esTicks.map(function(t,i){ return (<g key={i}>
        <line x1={xS(t)} y1={MT+plotH} x2={xS(t)} y2={MT+plotH+4} stroke={C.brd}/>
        <text x={xS(t)} y={MT+plotH+18} textAnchor="middle" fontSize={10} fill={C.muted}>{t.toFixed(2)}</text>
      </g>); })}
      {/* axis labels */}
      <text x={ML+plotW/2} y={H-12} textAnchor="middle" fontSize={11} fill={C.muted}>Effect Size</text>
      <text x={14} y={MT+plotH/2} textAnchor="middle" fontSize={11} fill={C.muted} transform={"rotate(-90,14,"+(MT+plotH/2)+")"}>Standard Error</text>
      {/* points */}
      {pts.map(function(p,i){ return (<g key={i}>
        <circle cx={xS(p.es)} cy={yS(p.se)} r={5} fill={C.acc} stroke={C.bg} strokeWidth={1.5}/>
        <title>{`${p.label} · ES=${p.es.toFixed(3)}, SE=${p.se.toFixed(3)}`}</title>
      </g>); })}
      <text x={ML+plotW-4} y={MT+12} textAnchor="end" fontSize={10} fill={C.dim}>Pooled: {centre.toFixed(3)}</text>
    </svg>
  </div>);
}

/* ════════════ AI FEATURE VISIBILITY (prompt6 Task 16) ════════════ */
// AI features hidden pending future implementation.
// Single visibility flag — flip to true to restore every AI surface (AIButton,
// the Search-string generator panel, the AI Study Extractor, the Claude citation
// fallback in Add Study, the PROSPERO generator, the Manuscript drafter, and the
// AI marketing copy). The callClaude infrastructure below stays fully intact.
const AI_FEATURES_ENABLED = false;

/* ════════════ AI CALL HELPER ════════════ */
// Try models in order — most current first
const CLAUDE_MODELS = ["claude-sonnet-4-6","claude-sonnet-4-5-20250514","claude-3-5-sonnet-20241022"];

async function callClaude(prompt, maxTokens=2000) {
  // `prompt` may be a plain string OR an array of content blocks (text/document/image)
  var content = (typeof prompt === "string") ? prompt : prompt;
  var lastErr = null;
  for (var mi = 0; mi < CLAUDE_MODELS.length; mi++) {
    var model = CLAUDE_MODELS[mi];
    try {
      var body = JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        messages: [{role: "user", content: content}]
      });
      var resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: body,
      });
      var rawText = await resp.text();
      var data;
      try { data = JSON.parse(rawText); }
      catch (parseErr) {
        lastErr = new Error("Response not JSON (HTTP " + resp.status + "): " + rawText.slice(0, 200));
        continue;
      }
      if (!resp.ok) {
        var msg = (data && data.error && data.error.message) || ("HTTP " + resp.status);
        lastErr = new Error("[" + model + "] " + msg);
        // Rate-limited: wait and retry the same model (up to 2 retries)
        if (resp.status === 429) {
          var retryAfter = parseInt(resp.headers.get("retry-after") || "8", 10);
          var wait = Math.max(retryAfter, 8) * 1000;
          for (var ri = 0; ri < 2; ri++) {
            await new Promise(res => setTimeout(res, wait));
            var r2 = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers:{"Content-Type":"application/json"}, body:body });
            var rt = await r2.text();
            var d2; try{ d2=JSON.parse(rt); }catch(_){ break; }
            if (r2.ok) {
              var t2 = d2.content ? d2.content.map(function(b){return b.text||"";}).join("").trim() : "";
              if (t2) return t2;
            }
            if (r2.status !== 429) break;
            wait = wait * 2;
          }
          continue; // try next model
        }
        // If it's a model-specific error, try the next one
        if (msg.toLowerCase().indexOf("model") !== -1 || resp.status === 404) continue;
        throw lastErr;
      }
      var text = "";
      if (data && data.content && data.content.map) {
        text = data.content.map(function(b){ return b.text || ""; }).join("").trim();
      }
      if (!text) {
        lastErr = new Error("Empty response from " + model);
        continue;
      }
      return text;
    } catch (e) {
      lastErr = e;
      // Network / DOMException — try next model
      if (e.name === "TypeError" || e.name === "AbortError") continue;
      // Otherwise propagate immediately
      if (mi === CLAUDE_MODELS.length - 1) throw e;
    }
  }
  throw lastErr || new Error("All model attempts failed");
}

/* Like callClaude but enables the server-side web_search tool and concatenates all
   text blocks across the (possibly multi-step) response. Used for citation lookup,
   which can't reach CrossRef/PubMed directly from the sandboxed browser. */
async function callClaudeWeb(prompt, maxTokens=1500) {
  var lastErr = null;
  for (var mi = 0; mi < CLAUDE_MODELS.length; mi++) {
    var model = CLAUDE_MODELS[mi];
    try {
      var body = JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        messages: [{role:"user", content: prompt}],
        tools: [{type:"web_search_20250305", name:"web_search", max_uses:3}],
      });
      var resp = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"}, body: body,
      });
      var rawText = await resp.text();
      var data; try { data = JSON.parse(rawText); }
      catch(e){ lastErr=new Error("Response not JSON (HTTP "+resp.status+")"); continue; }
      if(!resp.ok){
        var msg=(data&&data.error&&data.error.message)||("HTTP "+resp.status);
        lastErr=new Error("["+model+"] "+msg);
        if(msg.toLowerCase().indexOf("model")!==-1||resp.status===404) continue;
        // tool not supported on this model → try next
        if(msg.toLowerCase().indexOf("tool")!==-1) continue;
        throw lastErr;
      }
      var text="";
      if(data&&data.content&&data.content.map){
        text=data.content.map(function(b){return b.type==="text"?(b.text||""):"";}).join("").trim();
      }
      if(!text){ lastErr=new Error("Empty response from "+model); continue; }
      return text;
    } catch(e){
      lastErr=e;
      if(e.name==="TypeError"||e.name==="AbortError") continue;
      if(mi===CLAUDE_MODELS.length-1) throw e;
    }
  }
  throw lastErr || new Error("All model attempts failed");
}

/* AI-assisted citation lookup via web search — works inside the sandbox.
   kind: "doi" | "pmid" | "title". Returns the same shape as fetchByDOI/fetchByPMID. */
async function fetchCitationAI(kind, value){
  const v=String(value).trim();
  const what = kind==="doi" ? `the article with DOI "${v}"`
             : kind==="pmid" ? `the PubMed article with PMID ${v}`
             : `the article titled "${v}"`;
  const prompt=`Find ${what} and return its bibliographic details. Search the web (PubMed, CrossRef, or the publisher) to confirm.

Respond with ONLY a JSON object, no markdown, no commentary:
{"title":"","authors":"semicolon-separated Family Initials","journal":"","year":"YYYY","doi":"","pmid":"","abstract":"short abstract if available"}

If you cannot find a real match, return {"notfound":true}. Do not invent details.`;
  const text=await callClaudeWeb(prompt,1800);
  const parsed=safeParseJSON(text);
  if(!parsed||parsed.notfound) throw new Error("No reliable match found online.");
  const authors=String(parsed.authors||"").trim();
  const first=authors?authors.split(/[;,]/)[0].trim():"";
  return {
    title:parsed.title||"",
    authors,
    author:first?(first.split(" ")[0]+(authors.split(/;/).length>1?" et al.":"")):"",
    journal:parsed.journal||"",
    year:parsed.year?String(parsed.year).match(/\d{4}/)?.[0]||"":"",
    doi:(parsed.doi||"").replace(/^https?:\/\/(dx\.)?doi\.org\//i,""),
    pmid:parsed.pmid?String(parsed.pmid).replace(/[^0-9]/g,""):(kind==="pmid"?v.replace(/[^0-9]/g,""):""),
    abstract:(parsed.abstract||"").replace(/\s+/g," ").trim().slice(0,4000),
  };
}

/* Read a File as base64 (strips the data: prefix) */
function fileToBase64(file){
  return new Promise(function(resolve,reject){
    var r=new FileReader();
    r.onload=function(){ var res=String(r.result); var comma=res.indexOf(","); resolve(comma>=0?res.slice(comma+1):res); };
    r.onerror=function(){ reject(new Error("Could not read the file.")); };
    r.readAsDataURL(file);
  });
}

/* ════════════ CITATION LOOKUP (browser fetch; graceful fallback to manual) ════════════ */
/* DOI → CrossRef (CORS-enabled public API) */
async function fetchByDOI(doi){
  const clean=String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i,"");
  const resp=await fetch("https://api.crossref.org/works/"+encodeURIComponent(clean),{headers:{Accept:"application/json"}});
  if(!resp.ok) throw new Error("CrossRef returned HTTP "+resp.status+" for that DOI.");
  const data=await resp.json();
  const m=data.message||{};
  const auth=(m.author||[]).map(a=>[a.family,a.given].filter(Boolean).join(" ")).filter(Boolean);
  const yr=(m.issued&&m.issued["date-parts"]&&m.issued["date-parts"][0]&&m.issued["date-parts"][0][0])||
    (m["published-print"]&&m["published-print"]["date-parts"]&&m["published-print"]["date-parts"][0][0])||"";
  return {
    title:(m.title&&m.title[0])||"",
    authors:auth.join("; "),
    author:auth.length?(auth[0].split(" ").slice(-1)[0]+(auth.length>1?" et al.":"")):"",
    journal:(m["container-title"]&&m["container-title"][0])||"",
    year:yr?String(yr):"",
    doi:clean,
    abstract:(m.abstract||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(),
  };
}
/* PMID → NCBI E-utilities (esummary for citation, efetch for abstract). CORS-enabled. */
async function fetchByPMID(pmid){
  const id=String(pmid).trim().replace(/[^0-9]/g,"");
  if(!id) throw new Error("Enter a numeric PubMed ID.");
  const sumResp=await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${id}&retmode=json`);
  if(!sumResp.ok) throw new Error("PubMed returned HTTP "+sumResp.status+".");
  const sum=await sumResp.json();
  const rec=sum.result&&sum.result[id];
  if(!rec||rec.error) throw new Error("No PubMed record found for PMID "+id+".");
  const auth=(rec.authors||[]).map(a=>a.name).filter(Boolean);
  const yr=(rec.pubdate||"").match(/\d{4}/);
  let abstract="";
  try{
    const abResp=await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${id}&rettype=abstract&retmode=text`);
    if(abResp.ok){ abstract=(await abResp.text()).replace(/\s+/g," ").trim().slice(0,4000); }
  }catch(_){}
  return {
    title:rec.title||"",
    authors:auth.join("; "),
    author:auth.length?(auth[0].split(" ")[0]+(auth.length>1?" et al.":"")):"",
    journal:rec.fulljournalname||rec.source||"",
    year:yr?yr[0]:"",
    doi:(rec.elocationid||"").replace(/^doi:\s*/i,""),
    pmid:id,
    abstract,
  };
}

async function testClaudeConnection() {
  try {
    var result = await callClaude("Say only the word: OK", 20);
    return { ok: true, message: result };
  } catch (e) {
    return { ok: false, message: e.message, name: e.name || "Error" };
  }
}

/* Robust JSON extractor — handles unterminated strings, stray newlines, truncation */
function safeParseJSON(raw) {
  var s = String(raw).trim();
  // Strip markdown fences using charCode (no regex with newlines)
  var BT = String.fromCharCode(96);
  if (s.charCodeAt(0)===96 && s.charCodeAt(1)===96 && s.charCodeAt(2)===96) {
    var nl = -1;
    for (var k=0; k<s.length; k++){ if(s.charCodeAt(k)===10){ nl=k; break; } }
    if (nl !== -1) s = s.slice(nl + 1);
    var fence = s.lastIndexOf(BT+BT+BT);
    if (fence !== -1) s = s.slice(0, fence);
    s = s.trim();
  }
  var start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found');
  s = s.slice(start, end + 1);
  try { return JSON.parse(s); } catch(e1) {}
  // Sanitise: escape literal LF/CR/TAB inside strings
  var out = '', inStr = false, i = 0;
  while (i < s.length) {
    var code = s.charCodeAt(i);
    if (inStr) {
      if (code === 92) { out += s[i]; i++; if(i<s.length){out+=s[i];i++;} continue; }
      if (code === 34) { inStr = false; out += s[i]; }
      else if (code === 10) { out += String.fromCharCode(92) + 'n'; }
      else if (code === 13) { out += String.fromCharCode(92) + 'r'; }
      else if (code === 9)  { out += String.fromCharCode(92) + 't'; }
      else { out += s[i]; }
    } else {
      if (code === 34) inStr = true;
      out += s[i];
    }
    i++;
  }
  try { return JSON.parse(out); } catch(e2) {}
  if (inStr) out += String.fromCharCode(34);
  var depth = 0;
  for (var ci=0; ci<out.length; ci++) {
    if (out[ci] === '{') depth++;
    else if (out[ci] === '}') depth--;
  }
  while (depth > 0) { out += '}'; depth--; }
  return JSON.parse(out);
}

/* Parse a markdown-section format response — bulletproof, no JSON escaping needed.
   Format expected:
     ## SECTION_NAME
     content here
     can span lines
     ## NEXT_SECTION
     ...
   Returns: { section_name: "content", ... } with keys lowercased. */
function parseSections(raw) {
  var lines = String(raw).split(String.fromCharCode(10));
  var out = {};
  var current = null;
  var buf = [];
  function commit() {
    if (current !== null) {
      out[current] = buf.join(String.fromCharCode(10)).trim();
    }
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m = line.match(/^##+\s+([A-Z0-9_]+)\s*$/);
    if (m) {
      commit();
      current = m[1].toLowerCase();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  commit();
  return out;
}

/* Parse a bullet list ("- item" or "* item" lines) into an array */
function parseBullets(text) {
  if (!text) return [];
  return String(text).split(String.fromCharCode(10))
    .map(function(l){ return l.replace(/^\s*[-*]\s+/, '').trim(); })
    .filter(function(l){ return l.length > 0 && !l.startsWith('##'); });
}

/* Parse "TERM | reason" lines into objects */
function parseTermReasons(text) {
  if (!text) return [];
  return parseBullets(text).map(function(line){
    var parts = line.split('|');
    return { term: (parts[0]||'').trim(), reason: (parts.slice(1).join('|')||'').trim() };
  }).filter(function(o){ return o.term; });
}

/* Parse PICO/Design concept blocks: "P | clause" or "I | clause" etc */
function parseConceptBlocks(text) {
  if (!text) return [];
  var out = [];
  var labelMap = { P: "Population", I: "Intervention", C: "Comparator", O: "Outcome", D: "Study Design" };
  var colorMap = { P: "#38bdf8", I: "#34d399", C: "#fbbf24", O: "#c084fc", D: "#f87171" };
  String(text).split(String.fromCharCode(10)).forEach(function(line){
    var trimmed = line.replace(/^\s*[-*]\s*/, '').trim();
    if (!trimmed) return;
    var parts = trimmed.split('|');
    if (parts.length < 2) return;
    var code = parts[0].trim().toUpperCase().charAt(0);
    if (!labelMap[code]) return;
    out.push({
      code: code,
      label: labelMap[code],
      color: colorMap[code],
      clause: parts.slice(1).join('|').trim()
    });
  });
  return out;
}

/* Parse filter lines: "FILTER_NAME | clause | when to apply" */
function parseFilters(text) {
  if (!text) return [];
  return parseBullets(text).map(function(line){
    var parts = line.split('|');
    return {
      name: (parts[0]||'').trim(),
      clause: (parts[1]||'').trim(),
      when: (parts[2]||'').trim()
    };
  }).filter(function(o){ return o.name && o.clause; });
}


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
    <div style={{marginBottom:14}}><label style={lbl}>Additional Protocol Notes</label>
      <textarea value={pico.notes||""} onChange={e=>ch("notes",e.target.value)}
        placeholder="Pre-specified subgroups, sensitivity analyses planned, funding, anything else for your protocol…"
        style={{...inp,height:56,resize:"vertical"}}/></div>

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
function buildPrismaSVG(prisma,opts){
  const o=opts||{};
  const n=k=>{const v=+prisma[k];return isNaN(v)?0:v;};
  const dbs=n("dbs"),reg=n("reg"),other=n("other"),total=dbs+reg+other;
  const dedupe=n("dedupe"),screened=total-dedupe,excTA=n("excTA"),ftRet=screened-excTA,excFull=n("excFull"),included=ftRet-excFull;
  const reasons=(prisma.reasons||[]).filter(r=>r.r&&r.n);
  const W=720, colL=40, colMain=250, boxW=300, sideW=250, sideX=colL+boxW+60;
  const INK="#111", GREY="#555", LINE="#333", FF="Georgia,'Times New Roman',serif";
  const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  let y=30; const rowsSvg=[]; const sidesSvg=[]; const arrows=[];
  const box=(x,yy,w,h,lines,opts2)=>{
    const op=opts2||{};
    let s=`<rect x="${x}" y="${yy}" width="${w}" height="${h}" fill="${op.fill||"#ffffff"}" stroke="${op.stroke||LINE}" stroke-width="1.2" rx="3"/>`;
    lines.forEach((ln,i)=>{ s+=`<text x="${x+12}" y="${yy+20+i*15}" font-family="${FF}" font-size="${op.size||11}" font-weight="${op.bold&&i===0?"700":"400"}" fill="${INK}">${esc(ln)}</text>`; });
    return s;
  };
  const vArrow=(x,y1,y2)=>`<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${GREY}" stroke-width="1.3" marker-end="url(#ah)"/>`;
  const hArrow=(x1,x2,yy)=>`<line x1="${x1}" y1="${yy}" x2="${x2}" y2="${yy}" stroke="${GREY}" stroke-width="1.3" marker-end="url(#ah)"/>`;

  const cx=colL+boxW/2;
  // noBg → skip the full-bleed white rect so transparent PNG export works
  let svg=o.noBg?"":`<rect x="0" y="0" width="${W}" height="100%" fill="#ffffff"/>`;
  if(o.title) { svg+=`<text x="${W/2}" y="24" text-anchor="middle" font-family="${FF}" font-size="14" font-weight="700" fill="${INK}">${esc(o.title)}</text>`; y=46; }

  // Identification
  const idLines=["Records identified (n = "+total+"):","   Databases (n = "+dbs+")","   Registers (n = "+reg+")"+(other?", Other (n = "+other+")":"")];
  svg+=box(colL,y,boxW,58,idLines,{bold:true}); 
  // duplicates side box
  svg+=box(sideX,y,sideW,40,["Records removed before screening:","   Duplicates (n = "+dedupe+")"],{});
  svg+=hArrow(colL+boxW,sideX,y+20);
  const yId=y; y+=58+26;

  // Screened
  svg+=box(colL,y,boxW,30,["Records screened (n = "+screened+")"],{bold:true});
  svg+=box(sideX,y,sideW,30,["Records excluded (n = "+excTA+")"],{});
  svg+=hArrow(colL+boxW,sideX,y+15);
  svg+=vArrow(cx,yId+58,y); y+=30+26;

  // Full text
  svg+=box(colL,y,boxW,30,["Reports assessed for eligibility (n = "+ftRet+")"],{bold:true});
  const exLines=["Reports excluded (n = "+excFull+"):"].concat(reasons.length?reasons.map(r=>"   "+r.r+" (n = "+r.n+")"):["   reasons not specified"]);
  const exH=Math.max(30,14+exLines.length*15);
  svg+=box(sideX,y,sideW,exH,exLines,{});
  svg+=hArrow(colL+boxW,sideX,y+15);
  const yFt=y; y+=30+26;

  // Included
  svg+=box(colL,y,boxW,46,["Studies included in review (n = "+included+")",(prisma.quant?"   In meta-analysis (n = "+prisma.quant+")":"")].filter(Boolean),{bold:true,fill:"#f3f7f3",stroke:"#2e7d32"});
  svg+=vArrow(cx,yFt+30,y);
  y+=46+20;

  // phase labels (left rail)
  const railLabels=[["Identification",yId+29],["Screening",(yId+84+30)/1+0],["Eligibility",yFt+15],["Included",y-46-10]];
  // simpler: draw rotated phase labels at approximate band centers
  const bands=[["Identification",yId,yId+58],["Screening",yId+84,yId+84+30],["Eligibility",yFt,yFt+30],["Included",y-66,y-20]];
  let rail="";
  // (skip rotated rail to keep it clean & robust)

  const H=y+10;
  const defs=`<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${GREY}"/></marker></defs>`;
  return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}${svg}</svg>`,W,H};
}
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
function RoBTab({project,updateProject,activeId,setTab}){
  const[flag,setFlag]=useState(null); // null=checking
  // prompt39 Task 3 — hide the overview intro header while a per-study assessment
  // workspace is open, so the user focuses on the assessment tool itself.
  const[inWorkspace,setInWorkspace]=useState(false);
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
  return(<div>
    {!inWorkspace&&<SectionHeader icon="scale" title="Risk of Bias" desc="Outcome-level RoB 2 for this project — the engine proposes a judgement; you decide."/>}
    <ProjectRobPanel
      projectId={activeId}
      embedded
      canEdit={canEdit}
      onWorkspaceChange={setInWorkspace}
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
function interpretResult(result,esType,studies,prec){
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
  const nullV=isRatio?1:(isProp?null:0);
  const pe=disp(result.pES),lo=disp(result.lo95),hi=disp(result.hi95);
  const sigByCI = isRatio ? (result.lo95>0||result.hi95<0) : (result.lo95>0||result.hi95<0);
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
function buildPubForestSVG(result,opts){
  if(!result) return null;
  const o=opts||{};
  const esType=o.esType||"";
  const showCounts=o.showCounts!==false;
  const showWeights=o.showWeights!==false;
  const method=result.method||"random";
  const title=(o.title||"").trim();
  const t=ES_TYPES[esType]||{};
  const isLog=!!t.log, isProp=esType==="PROP";
  const logOut=!!o.logScale;        // user opt-in to show the log scale instead of the ratio scale
  // Pretty measure name for the axis
  const measureFull = esType==="OR"?"Odds Ratio" : esType==="RR"?"Risk Ratio" : esType==="HR"?"Hazard Ratio"
    : esType==="SMD"?"Standardised Mean Difference" : esType==="MD"?"Mean Difference"
    : esType==="COR"?"Correlation (Fisher z)" : esType==="PROP"?"Proportion (%)" : "Effect size";
  const ratioAbbr = esType==="OR"?"OR":esType==="RR"?"RR":esType==="HR"?"HR":"";
  const ratioScale = isLog && !logOut;   // show actual ratio axis for OR/RR/HR
  // back-transform a stored (log/logit) value to display units
  const bt=x=>{ if(isLog)return Math.exp(x); if(isProp){const e=Math.exp(x);return e/(1+e);} return x; };
  const prec=o.prec;
  // value formatting for the right-hand ES column
  const fmt=x=>{
    if(isProp) return fmtPct(bt(x),prec);
    if(isLog&&!logOut) return fmtES(bt(x),prec);
    if(isLog&&logOut) return fmtES(+x,prec);
    return fmtES(+x,prec);
  };
  const fmtCI=(lo,hi)=>`[${fmt(lo)}, ${fmt(hi)}]`;
  const studies=result.studies;
  const k=studies.length;
  const anyExp=studies.some(s=>s.a!==""&&s.a!=null), anyCtrl=studies.some(s=>s.c!==""&&s.c!=null);
  const colCounts=showCounts&&(anyExp||anyCtrl);

  // ---- palette ----
  const INK="#111111", GREY="#555555", LINE="#000000", FAINT="#cccccc", BOX="#333333";
  const FF="Georgia, 'Times New Roman', serif";

  // ---- margins & column widths (balanced; not excessively wide) ----
  const MTOP=20, MBOT=20, MLEFT=28, MRIGHT=28;
  const nameW=160;
  const cExp=colCounts?92:0, cCtrl=colCounts?92:0;
  const plotGap=20;
  const plotW=Math.max(280, Math.min(360, 300));   // balanced fixed-ish plot area
  const cEff=160;                                    // "0.72 [0.55, 0.94]"
  const cW=showWeights?62:0, cW2=showWeights?62:0;

  // title wrapping (wrap to <=2 lines, shrink font if needed)
  let titleLines=[], titleSize=15;
  const contentW = nameW+cExp+cCtrl+plotGap+plotW+plotGap+cEff+cW+cW2;
  if(title){
    const approxCharW=s=>s*0.52; // rough serif char width factor
    const maxW=contentW;
    const fitsOne=approxCharW(titleSize)*title.length<=maxW;
    if(fitsOne){ titleLines=[title]; }
    else {
      // try to wrap into 2 lines at a space near the middle
      const words=title.split(/\s+/); let l1="",l2="";
      for(const w of words){ if(approxCharW(titleSize)*(l1+" "+w).length<=maxW||!l1){ l1=l1?l1+" "+w:w; } else { l2=l2?l2+" "+w:w; } }
      if(l2 && approxCharW(titleSize)*l2.length>maxW){ titleSize=13; } // still long → shrink
      titleLines=l2?[l1,l2]:[l1];
    }
  }
  const titleBlockH = titleLines.length?(titleLines.length*(titleSize+5)+10):0;

  // ---- x positions ----
  const xName=MLEFT;
  const xExp=xName+nameW;
  const xCtrl=xExp+cExp;
  const xPlot=xCtrl+cCtrl+plotGap;
  const xPlotEnd=xPlot+plotW;
  const xEff=xPlotEnd+plotGap;
  const xW=xEff+cEff;
  const xW2=xW+cW;
  const W=xW2+cW2+MRIGHT;

  // ---- y layout ----
  const headTop=MTOP+titleBlockH;
  const headH=colCounts||showWeights?34:20;          // two-line headers need height
  const headBottom=headTop+headH;                    // header underline
  const ROW=25;
  const rowsTop=headBottom+10;
  const yStudy=i=>rowsTop+ROW*0.7+i*ROW;             // text baseline
  const bandBottom=rowsTop+k*ROW+2;
  const ySep=bandBottom+6;
  const yFixed=ySep+ROW*0.9;
  const yRandom=yFixed+ROW;
  const showPI=!!(result.predInt&&o.showPI!==false);
  const yPI=showPI?yRandom+ROW*0.85:yRandom;
  const axisY=yPI+ROW*0.7;
  const tickLabelY=axisY+15;
  const favY=tickLabelY+16;                          // favours row (its own line → no overlap)
  const axisLabelY=favY+18;
  const hetY=axisLabelY+24;
  const H=hetY+18+MBOT;

  // ---- x-scale ----
  // For ratio measures we lay out on the log axis (so CIs are symmetric) but LABEL in ratio units.
  const nullStored = ratioScale ? 0 : (isProp?0:(o.nullLine!=null?o.nullLine:0)); // log(1)=0
  const allVals=[...studies.flatMap(s=>[s._lo,s._hi]),result.fixed.lo,result.fixed.hi,result.random.lo,result.random.hi,nullStored];
  let minV=Math.min(...allVals), maxV=Math.max(...allVals);
  const span=(maxV-minV)||1; minV-=span*0.10; maxV+=span*0.10;
  // ensure null line is inside the frame
  minV=Math.min(minV,nullStored-0.05); maxV=Math.max(maxV,nullStored+0.05);
  const range=(maxV-minV)||1;
  const xS=v=>xPlot+((Math.max(minV,Math.min(maxV,v))-minV)/range)*plotW;

  // ---- tick generation ----
  let ticks=[]; // [{x, label}]
  if(ratioScale){
    // clinically standard ratio ticks; keep those within the (back-transformed) visible range
    const cand=[0.05,0.1,0.2,0.25,0.5,0.75,1,1.5,2,3,5,10,20,50,100];
    const loR=Math.exp(minV), hiR=Math.exp(maxV);
    cand.forEach(r=>{ if(r>=loR*0.97&&r<=hiR*1.03){ const lv=Math.log(r); ticks.push({x:xS(lv),v:lv,label:(r<1?String(r):String(r))}); } });
    if(ticks.length<3){ // fallback: ensure at least null + a couple
      [Math.exp(minV),1,Math.exp(maxV)].forEach(r=>{const lv=Math.log(r);ticks.push({x:xS(lv),v:lv,label:r.toFixed(2)});});
    }
  } else if(isProp){
    for(let pct=0;pct<=100;pct+=20){ const pr=Math.min(0.999,Math.max(0.001,pct/100)); const lv=Math.log(pr/(1-pr)); if(lv>=minV-1e-9&&lv<=maxV+1e-9) ticks.push({x:xS(lv),v:lv,label:String(pct)}); }
    if(ticks.length<2){[minV,maxV].forEach(lv=>ticks.push({x:xS(lv),v:lv,label:((Math.exp(lv)/(1+Math.exp(lv)))*100).toFixed(0)}));}
  } else {
    const raw=range/5, mag=Math.pow(10,Math.floor(Math.log10(raw))), n=raw/mag;
    const step=(n<1.5?1:n<3?2:n<7?5:10)*mag;
    for(let v=Math.ceil(minV/step)*step; v<=maxV+1e-9; v+=step){ ticks.push({x:xS(v),v,label:(+v.toFixed(2)).toString()}); }
  }

  const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const txt=(x,y,s,size,opt)=>{const a=(opt&&opt.anchor)||"start";const fill=(opt&&opt.fill)||INK;const fw=(opt&&opt.bold)?"700":"400";const it=(opt&&opt.italic)?"italic":"normal";
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FF}" font-size="${size}" font-style="${it}" font-weight="${fw}" fill="${fill}" text-anchor="${a}">${esc(s)}</text>`;};
  const line=(x1,y1,x2,y2,stroke,sw,dash)=>`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${sw||1}"${dash?` stroke-dasharray="${dash}"`:""}/>`;

  let svg="";
  // noBg → skip the full-bleed white rect so transparent PNG export works
  if(!o.noBg) svg+=`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;

  // ---- title (wrapped / shrunk, centered, never clipped) ----
  titleLines.forEach((ln,i)=>{ svg+=txt(W/2, MTOP+titleSize+i*(titleSize+5), ln, titleSize, {anchor:"middle",bold:true}); });

  // ---- header row ----
  const hMid=headBottom-6;
  svg+=txt(xName,hMid,"Study",11.5,{bold:true});
  if(colCounts){
    svg+=txt(xExp+cExp/2,headBottom-18,"Experimental",10,{anchor:"middle",bold:true,fill:GREY});
    svg+=txt(xExp+cExp/2,headBottom-6,"Events / Total",9.5,{anchor:"middle",fill:GREY});
    svg+=txt(xCtrl+cCtrl/2,headBottom-18,"Control",10,{anchor:"middle",bold:true,fill:GREY});
    svg+=txt(xCtrl+cCtrl/2,headBottom-6,"Events / Total",9.5,{anchor:"middle",fill:GREY});
  }
  svg+=txt(xPlot+plotW/2,headBottom-6,"",10,{anchor:"middle"}); // plot header intentionally empty
  svg+=txt(xEff+cEff,hMid,(ratioScale?`${ratioAbbr} [95% CI]`:isProp?"% [95% CI]":isLog&&logOut?`log ${ratioAbbr} [95% CI]`:"Effect [95% CI]"),10.5,{anchor:"end",bold:true});
  if(showWeights){
    svg+=txt(xW+cW-4,headBottom-18,"Weight",9.5,{anchor:"end",bold:true,fill:GREY});
    svg+=txt(xW+cW-4,headBottom-6,"common",9.5,{anchor:"end",fill:GREY});
    svg+=txt(xW2+cW2-4,headBottom-18,"Weight",9.5,{anchor:"end",bold:true,fill:GREY});
    svg+=txt(xW2+cW2-4,headBottom-6,"random",9.5,{anchor:"end",fill:GREY});
  }
  svg+=line(MLEFT,headBottom,W-MRIGHT,headBottom,LINE,1);

  // ---- vertical grid + null line ----
  ticks.forEach(tk=>{ svg+=line(tk.x,rowsTop,tk.x,bandBottom,FAINT,0.5,"2,3"); });
  svg+=line(xS(nullStored),rowsTop,xS(nullStored),yPI+8,GREY,1);

  // ---- study rows ----
  studies.forEach((s,i)=>{
    const y=yStudy(i);
    const name=(s.author||"Study")+(s.year?` ${s.year}`:"");
    svg+=txt(xName,y,name.length>26?name.slice(0,25)+"…":name,10.5,{});
    if(colCounts){
      const eN=(s.a!==""&&s.a!=null)?s.a:(s.events!==""&&s.events!=null?s.events:"");
      const eT=(s.a!==""&&s.a!=null)?((+s.a)+(+s.b||0)||s.nExp||""):(s.total!==""&&s.total!=null?s.total:"");
      const cN=(s.c!==""&&s.c!=null)?s.c:"";
      const cT=(s.c!==""&&s.c!=null)?((+s.c)+(+s.d||0)||s.nCtrl||""):"";
      svg+=txt(xExp+cExp/2, y, (eN===""?"—":`${eN} / ${eT||"?"}`), 10, {anchor:"middle"});
      svg+=txt(xCtrl+cCtrl/2, y, (cN===""?"—":`${cN} / ${cT||"?"}`), 10, {anchor:"middle"});
    }
    const cy=y-3.5;
    const x1=xS(s._lo),x2=xS(s._hi),xc=xS(s._es);
    // marker proportional to weight but capped modestly
    const sq=Math.max(5,Math.min(13,Math.sqrt((s._wFixedPct||5))*2.2));
    svg+=line(x1,cy,x2,cy,INK,1.1);
    svg+=line(x1,cy-3,x1,cy+3,INK,1.1);
    svg+=line(x2,cy-3,x2,cy+3,INK,1.1);
    svg+=`<rect x="${(xc-sq/2).toFixed(1)}" y="${(cy-sq/2).toFixed(1)}" width="${sq.toFixed(1)}" height="${sq.toFixed(1)}" fill="${BOX}"/>`;
    svg+=txt(xEff+cEff, y, `${fmt(s._es)} ${fmtCI(s._lo,s._hi)}`, 10, {anchor:"end"});
    if(showWeights){
      svg+=txt(xW+cW-4, y, fmtWeight(s._wFixedPct||0,prec)+"%", 9.5, {anchor:"end",fill:GREY});
      svg+=txt(xW2+cW2-4, y, fmtWeight(s._wRandomPct||0,prec)+"%", 9.5, {anchor:"end",fill:GREY});
    }
  });

  svg+=line(MLEFT,ySep,W-MRIGHT,ySep,LINE,0.8);

  // ---- pooled diamonds ----
  const diamond=(yc,obj,label,strong,whichW)=>{
    const x1=xS(obj.lo),x2=xS(obj.hi),xc=xS(obj.es),dh=6.5;
    let g="";
    g+=txt(xName,yc,label,10.5,{bold:true});
    g+=`<polygon points="${xc.toFixed(1)},${(yc-3.5-dh).toFixed(1)} ${x2.toFixed(1)},${(yc-3.5).toFixed(1)} ${xc.toFixed(1)},${(yc-3.5+dh).toFixed(1)} ${x1.toFixed(1)},${(yc-3.5).toFixed(1)}" fill="${strong?"#000000":"#ffffff"}" stroke="#000000" stroke-width="1.1"/>`;
    g+=txt(xEff+cEff,yc,`${fmt(obj.es)} ${fmtCI(obj.lo,obj.hi)}`,10,{anchor:"end",bold:strong});
    if(showWeights){ g+=txt((whichW==="common"?xW+cW:xW2+cW2)-4,yc,"100%",9.5,{anchor:"end",fill:GREY}); }
    return g;
  };
  svg+=diamond(yFixed,result.fixed,"Common (fixed) effect",method==="fixed","common");
  svg+=diamond(yRandom,result.random,"Random effects",method==="random","random");

  // ---- prediction interval (dashed bar, journal-standard) ----
  if(showPI){
    const pi=result.predInt;
    const x1=xS(pi.lo),x2=xS(pi.hi),xc=xS(result.random.es),cy=yPI-3.5;
    svg+=txt(xName,yPI,"Prediction interval",9.5,{italic:true,fill:GREY});
    svg+=line(x1,cy,x2,cy,GREY,1.4,"4,2");
    svg+=line(x1,cy-3,x1,cy+3,GREY,1.4);
    svg+=line(x2,cy-3,x2,cy+3,GREY,1.4);
    svg+=`<rect x="${(xc-3).toFixed(1)}" y="${(cy-3).toFixed(1)}" width="6" height="6" fill="none" stroke="${GREY}" stroke-width="1"/>`;
    svg+=txt(xEff+cEff,yPI,`${fmt(pi.lo)} to ${fmt(pi.hi)}`,9.5,{anchor:"end",italic:true,fill:GREY});
  }

  // ---- x-axis ----
  svg+=line(xPlot,axisY,xPlotEnd,axisY,INK,1);
  ticks.forEach(tk=>{
    svg+=line(tk.x,axisY,tk.x,axisY+4,INK,0.9);
    svg+=txt(tk.x,tickLabelY,tk.label,9.5,{anchor:"middle"});
  });

  // ---- favours labels (own line, anchored to plot edges → no overlap) ----
  const favLow = (isLog||isProp)?(o.favLow||"favours experimental"):"favours lower";
  const favHigh= (isLog||isProp)?(o.favHigh||"favours control"):"favours higher";
  // For ratio measures: <1 (left) usually favours treatment; keep it configurable but sensible.
  svg+=txt(xPlot+2, favY, "◄ "+( (isLog||isProp)?(o.favLow||"favours experimental"):"favours lower"), 9, {anchor:"start",fill:GREY,italic:true});
  svg+=txt(xPlotEnd-2, favY, ((isLog||isProp)?(o.favHigh||"favours control"):"favours higher")+" ►", 9, {anchor:"end",fill:GREY,italic:true});

  // ---- axis label (clean measure name) ----
  const axisName = ratioScale ? measureFull : isProp?"Proportion (%)" : isLog&&logOut?("log "+measureFull) : measureFull;
  svg+=txt((xPlot+xPlotEnd)/2, axisLabelY, axisName, 11, {anchor:"middle",bold:true});

  // ---- heterogeneity + model line (well spaced) ----
  const Qp=result.Qpval<0.001?"< 0.001":"= "+fmtNum(result.Qpval,prec);
  const op=result.pval<0.001?"< 0.001":"= "+fmtNum(result.pval,prec);
  const het=`Heterogeneity: I² = ${fmtI2(result.I2,prec)}%,  τ² = ${fmtNum(result.tau2,prec)},  Q = ${fmtNum(result.Q,prec)} (df = ${result.k-1}),  p ${Qp}`;
  svg+=txt(MLEFT,hetY,het,9.5,{italic:true});
  let line2=`Test for overall effect: p ${op}  ·  Filled diamond: ${method==="random"?"random effects":"common / fixed effect"}`;
  if(result.hksj) line2+=`  ·  HKSJ 95% CI: ${fmt(result.hksj.lo)} to ${fmt(result.hksj.hi)} (t-based)`;
  svg+=txt(MLEFT,hetY+13,line2,9,{fill:GREY});

  const full=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>`;
  return {svg:full,W,H};
}

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
const GRADE_DOMAINS=[
  {id:"rob",label:"Risk of Bias",hint:"Are most studies at low risk?"},
  {id:"inconsistency",label:"Inconsistency",hint:"Are results consistent (low I²)?"},
  {id:"indirectness",label:"Indirectness",hint:"Do studies match the PICO well?"},
  {id:"imprecision",label:"Imprecision",hint:"Are CIs narrow enough to act on?"},
  {id:"publicationBias",label:"Publication Bias",hint:"Is funnel symmetric / Egger's p>0.05?"},
];
const GRADE_OPTIONS=[
  {v:"not_serious",label:"Not serious",color:C.grn,modifier:0},
  {v:"serious",label:"Serious",color:C.yel,modifier:-1},
  {v:"very_serious",label:"Very serious",color:C.red,modifier:-2},
];

/* Evidence-linked GRADE suggestions derived from the actual analysis.
   Returns { domainId: {suggest, reason} } so the user can one-click apply or override. */
function gradeSuggestions(project){
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
const MATH_FONT="'STIX Two Math','Cambria Math','Times New Roman',Georgia,serif";
/* Tiny stacked-fraction helper for equation display (no TeX dependency) */
function Frac({num,den}){
  return(<span style={{display:"inline-flex",flexDirection:"column",alignItems:"center",verticalAlign:"middle",margin:"0 3px",lineHeight:1.3}}>
    <span style={{borderBottom:`1px solid ${C.txt2}`,padding:"0 5px"}}>{num}</span>
    <span style={{padding:"0 5px"}}>{den}</span>
  </span>);
}
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
const TABS=[
  // group:"project" ⇒ project meta-tabs (prompt6 Tasks 15/4) — rendered in their
  // own "Project" sidebar group ABOVE Workflow; phase:null keeps them out of the
  // workflow map, the progress denominator, and the "Next step" walker.
  {id:"overview",   icon:"grid",        label:"Overview",             phase:null,  group:"project"},
  {id:"control",    icon:"sliders",     label:"Project Control",      phase:null,  group:"project"},
  {id:"pico",       icon:"target",      label:"PICO & Question",      phase:"Plan",    num:1},
  {id:"prospero",   icon:"clipboard",   label:"Protocol",             phase:"Plan",    num:2},
  {id:"search",     icon:"search",      label:"Search Builder",       phase:"Search",  num:3},
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
  {id:"grade",      icon:"award",       label:"GRADE Certainty",      phase:"Report",  num:12},
  {id:"report",     icon:"checkSquare", label:"PRISMA Checklist",     phase:"Report",  num:13},
  {id:"manuscript", icon:"pencil",      label:"Manuscript Draft",     phase:"Report",  num:14},
  // phase:null ⇒ reference page, NOT a workflow step — excluded from the
  // workflow map, progress denominator and "Next step" walker (all filter on t.phase).
  {id:"methods",    icon:"bookOpen",    label:"Methods & Equations",  phase:null,  group:"reference"},
];
const PHASES=["Plan","Search","Screen","Extract","Analyze","Report"];
// prompt36 Task 3 — the MAIN workflow steps are every tab WITH a phase (Overview &
// Project Control have phase:null). Navigating TO one of these auto-collapses the
// left workflow menu into focus mode; Overview / Project Control never collapse.
// prompt39 Task 6 — CENTRALIZED workflow-menu collapse rules live in the pure,
// unit-tested helper module; the monolith just binds them to its TABS config.
const { workflowTabIds: WORKFLOW_TAB_IDS, shouldAutoCollapseWorkflowMenu } = makeWorkflowMenuRules(TABS);
// prompt31 Part 7 — ultra-wide judgement: reading/form tabs keep a comfortable
// centred max-width; data/workspace tabs (extraction, analysis, forest, RoB,
// PRISMA…) use the full width. Screening renders its own full-bleed frame.
const READING_TABS=new Set(["overview","pico","prospero","control","grade","manuscript","methods","report"]);
/* Icon names (src/frontend/components/icons.jsx) — render via <Icon name={…}/> */
const PHASE_ICON={Plan:"target",Search:"search",Screen:"filter",Extract:"table",Analyze:"sigma",Report:"fileText"};

/* PICO Time Frame — TIMEFRAME_OPTIONS + timeframeComplete were EXTRACTED to
   src/features/protocol/constants.js (prompt38, strangler-fig) and re-imported at
   the top of this file, so the legacy PICOTab + the new ProtocolModulePanel share
   one source of truth. Behaviour is unchanged. */

/* CriteriaList — structured inclusion/exclusion editor (prompt23 Task 8C). Each
   criterion is its own add/removable row instead of one opaque blob, but it
   serialises back to the SAME "• item\n• item" string stored in pico.incl /
   pico.excl — so screening keyword extraction, export, and older projects keep
   working unchanged. */
function CriteriaList({ value, onChange, accent, placeholders }) {
  const rows = String(value || "").split("\n").map(l => l.replace(/^\s*[•\-*]\s?/, ""));
  const eff = rows.length ? rows : [""];
  const commit = (next) => onChange(next.map(r => "• " + r).join("\n"));
  const upd = (i, v) => { const n = [...eff]; n[i] = v; commit(n); };
  const add = () => commit([...eff, ""]);
  const remove = (i) => { const n = eff.filter((_, j) => j !== i); commit(n.length ? n : [""]); };
  const ph = placeholders || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      {eff.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input value={r} onChange={e => upd(i, e.target.value)}
            placeholder={ph[i] || ph[ph.length - 1] || "Add a criterion…"}
            style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 6, padding: "7px 10px", color: C.txt, fontSize: 12, fontFamily: "inherit" }} />
          <button type="button" onClick={() => remove(i)} title="Remove criterion" aria-label="Remove criterion"
            style={{ background: "none", border: `1px solid ${C.brd}`, color: C.muted, cursor: "pointer", borderRadius: 6, width: 28, height: 28, flexShrink: 0, lineHeight: 1, fontSize: 15 }}>×</button>
        </div>
      ))}
      <button type="button" onClick={add}
        style={{ alignSelf: "flex-start", background: themeAlpha(accent, '14'), border: `1px dashed ${themeAlpha(accent, '55')}`, color: accent, cursor: "pointer", borderRadius: 6, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", marginTop: 2 }}>
        + Add criterion
      </button>
    </div>
  );
}

/* Green-light readiness check — returns { ok, missing[] } */
function readinessCheck(project) {
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

/* Compute completion status for each workflow step (for sidebar progress dots) */
function stepStatus(project, screeningComplete){
  if(!project) return {};
  const p=project, pico=p.pico||{}, search=p.search||{}, prisma=p.prisma||{};
  const dbCount=Object.values(search.dbs||{}).filter(Boolean).length;
  const withES=p.studies.filter(s=>s.es!=="").length;
  const robDone=p.studies.filter(s=>Object.keys(s.rob||{}).length>0).length;
  const reportDone=Object.values(p.reportChecked||{}).filter(Boolean).length;
  const meta=runMeta(p.studies,"random");
  const gradeDone=Object.keys(p.grade||{}).length;
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
    subgroup: (p.studies.length>=4)?"partial":"empty",
    grade: gradeDone>=5?"done":gradeDone>0?"partial":"empty",
    report: reportDone>=20?"done":reportDone>0?"partial":"empty",
    manuscript: (p.manuscript&&p.manuscript.drafts&&Object.keys(p.manuscript.drafts).length>=3)?"done":(p.manuscript&&p.manuscript.drafts&&Object.keys(p.manuscript.drafts).length>0)?"partial":"empty",
  };
}

/* ════════════ PROJECT AUDIT (What is Missing) ════════════ */
function auditProject(p){
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
  if(reportDone<27) add("med","Report",`PRISMA checklist ${reportDone}/27 complete. Finish before submission.`);
  if(!(p.manuscript&&p.manuscript.drafts&&Object.keys(p.manuscript.drafts).length>0)) add("low","Report","No manuscript sections drafted yet.");

  return items;
}

function AuditPanel({project,onClose,onJump}){
  const items=useMemo(()=>auditProject(project),[project]);
  const high=items.filter(i=>i.sev==="high"),med=items.filter(i=>i.sev==="med"),low=items.filter(i=>i.sev==="low");
  const sevMeta={high:{c:C.red,label:"Must fix",bg:"var(--t-red-bg)"},med:{c:C.yel,label:"Should address",bg:"var(--t-yel-bg)"},low:{c:C.acc,label:"Consider",bg:"var(--t-acc-bg)"}};
  const phaseTab={Plan:"pico",Search:"search",Screen:"prisma",Extract:"extraction",Analyze:"analysis",Report:"report"};
  return(<div style={{position:"fixed",inset:0,background:"#00000099",zIndex:997,display:"flex",justifyContent:"flex-end"}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{width:420,maxWidth:"92vw",background:C.surf,borderLeft:`1px solid ${C.brd}`,height:"100%",overflowY:"auto",boxShadow:"-12px 0 40px var(--t-shadow)"}}>
      <div style={{position:"sticky",top:0,background:C.surf,borderBottom:`1px solid ${C.brd}`,padding:"16px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",zIndex:1}}>
        <div>
          <div style={{fontSize:15,fontWeight:800}}>Project Audit</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>{items.length===0?"Everything looks complete":`${items.length} item${items.length===1?"":"s"} to review`}</div>
        </div>
        <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:22,cursor:"pointer",padding:0,lineHeight:1}}>×</button>
      </div>
      <div style={{padding:18}}>
        {items.length===0?(
          <div style={{textAlign:"center",padding:"40px 20px",color:C.muted}}>
            <div style={{marginBottom:12,color:C.grn}}><Icon name="checkSquare" size={36}/></div>
            <div style={{fontSize:14,color:C.grn,fontWeight:600,marginBottom:6}}>No gaps detected</div>
            <div style={{fontSize:12,lineHeight:1.6}}>Your project meets the key methodological checkpoints. Keep your documentation up to date as you finish.</div>
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:18}}>
            {[["high",high],["med",med],["low",low]].map(([sev,list])=>list.length>0&&(
              <div key={sev}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:sevMeta[sev].c}}/>
                  <span style={{fontSize:11,fontWeight:800,color:sevMeta[sev].c,letterSpacing:0.5,textTransform:"uppercase"}}>{sevMeta[sev].label}</span>
                  <span style={{fontSize:10,color:C.dim,fontFamily:"'IBM Plex Mono',monospace"}}>{list.length}</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {list.map((it,i)=>(
                    <div key={i} onClick={()=>{onJump(phaseTab[it.phase]||"pico");onClose();}}
                      style={{background:sevMeta[it.sev].bg,border:`1px solid ${themeAlpha(sevMeta[it.sev].c,'44')}`,borderLeft:`3px solid ${sevMeta[it.sev].c}`,
                        borderRadius:6,padding:"10px 12px",cursor:"pointer",transition:"all 0.12s"}}
                      onMouseEnter={e=>e.currentTarget.style.transform="translateX(-3px)"}
                      onMouseLeave={e=>e.currentTarget.style.transform="translateX(0)"}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <span style={{fontSize:9,fontWeight:700,color:sevMeta[it.sev].c,letterSpacing:0.5,textTransform:"uppercase"}}>{it.phase}</span>
                        <span style={{fontSize:10,color:C.dim}}>Go →</span>
                      </div>
                      <div style={{fontSize:12,color:C.txt,lineHeight:1.55}}>{it.msg}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>);
}

/* ════════════ PROJECT META HELPERS (prompt6 Tasks 4/15/18) ════════════ */
/* Effective caller permissions for a project — prefers the server's _permissions
   annotation; falls back to the prompt5 _shared/_role/_canEdit/_readOnly keys. */
function projectPerms(project){
  if(project&&project._permissions) return project._permissions;
  if(project&&project._shared) return {
    role:project._role||"member",isOwner:false,
    canView:true,canEdit:!!project._canEdit,
    readOnly:!!project._readOnly,canExport:true,
  };
  return {role:"owner",isOwner:true,canView:true,canEdit:true,readOnly:false,canExport:true};
}
/* Linked META·SIFT ScreenProject id for a project (workspace = source of truth). */
function linkedSiftId(project){
  return (project&&project._linkedMetaSift&&project._linkedMetaSift.id)||(project&&project._screenProjectId)||null;
}

/* Editable project title (prompt6 Task 18) — rename goes through the REAL
   PUT /api/projects/:id (via onRename), never the autosave blob path, so the
   server-side sync-if-in-sync rename of the linked META·SIFT title fires. */
function ProjectTitle({project,canRename,onRename}){
  const[editing,setEditing]=useState(false);
  const[draft,setDraft]=useState(project.name);
  const[busy,setBusy]=useState(false);
  const[err,setErr]=useState("");
  useEffect(()=>{if(!editing){setDraft(project.name);setErr("");}},[project.id,project.name,editing]);
  const submit=async()=>{
    if(busy)return;
    const name=draft.trim();
    if(!name||name===project.name){setEditing(false);setErr("");return;}
    setBusy(true);
    const r=await onRename(project.id,name);
    setBusy(false);
    if(r.ok){setEditing(false);setErr("");}
    else if(r.error)setErr(r.error);
  };
  if(!editing) return(
    <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0,marginBottom:5}}>
      <h1 title={project.name} style={{fontSize:22,fontWeight:700,letterSpacing:-0.5,margin:0,color:C.txt,lineHeight:1.2,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{project.name}</h1>
      {canRename&&(
        <button onClick={()=>setEditing(true)} title="Rename project"
          style={{background:"none",border:`1px solid ${C.brd2}`,color:C.muted,cursor:"pointer",fontSize:11,borderRadius:6,padding:"2px 8px",lineHeight:1.5,flexShrink:0}}>✎</button>
      )}
    </div>
  );
  return(
    <div style={{minWidth:0,marginBottom:5}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <input autoFocus value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter")submit();if(e.key==="Escape"){setEditing(false);setErr("");}}}
          style={{...inp,width:340,maxWidth:"70vw",fontSize:15,fontWeight:600,padding:"6px 10px"}}/>
        <button onClick={submit} disabled={busy||!draft.trim()} style={{...btnS("primary"),fontSize:11,opacity:(busy||!draft.trim())?0.5:1}}>{busy?"Saving…":"Save"}</button>
        <button onClick={()=>{setEditing(false);setErr("");}} disabled={busy} style={{...btnS("ghost"),fontSize:11}}>Cancel</button>
      </div>
      {err&&<div style={{fontSize:11,color:C.red,marginTop:5}}>{err}</div>}
    </div>
  );
}

/* prompt24 Tasks 2/3/4/7/8/9 — UNIVERSAL PROJECT HEADER. One sticky bar shown on
   EVERY project page (Overview, PICO, Screening, Extraction, Analysis, PRISMA,
   Report, Project Control). It owns the project context (☰ menu toggle · project
   title · ▸ current-section breadcrumb · Project overview / Projects nav) and the
   single right-side utility cluster ([presence][chat][notifications][account]).
   Flex layout with min-width:0 on the title region (truncates with ellipsis) and a
   non-shrinking right cluster, so the buttons are never overlapped (Task 4). The
   one PresenceIndicator here replaces the old floating chip + the screening-only
   one (Task 8); its popover is portaled so it can't be clipped (Task 3). */
function ProjectHeaderBar({project,tab,inScreening,focus,onToggleFocus,setTab,onBackToProjects,presenceUsers,presenceLocks,totalMembers,myUserId,spId,reqMissing=0,reqMissingList,missingItems=0,onShowAudit,onReport,onExport,onImport}){
  const sectionLabel=(TABS.find(t=>t.id===tab)?.label)||"Overview";
  // prompt30 Part 5 — compact status badges + actions shown near the title on
  // every NON-overview page (the full detailed header now lives on Overview only).
  const compact=tab!=="overview";
  const badgeBtn=(color)=>({display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:11,fontSize:11,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer",background:themeAlpha(color,'18'),border:`1px solid ${themeAlpha(color,'55')}`,color,lineHeight:1.4,flexShrink:0});
  const hdrIconBtn={...btnS("ghost"),padding:"5px 8px",borderRadius:7,display:"inline-flex",alignItems:"center"};
  return(
    <div style={{
      display:"flex",alignItems:"center",gap:10,
      padding:"8px 16px",borderBottom:`1px solid ${C.brd}`,background:C.surf,
      flexShrink:0,minHeight:50,
    }}>
      {/* Left — prompt36 Task 4: directional ARROW toggle (left=collapse when open,
          right=expand when collapsed) + tooltip + state-aware aria-label, replacing
          the old ☰ hamburger. The chevron rotates 180° to swap direction smoothly
          (disabled under prefers-reduced-motion). Then the truncating breadcrumb. */}
      <Tooltip content={focus?"Expand workflow menu":"Collapse workflow menu"} wrapStyle={{flexShrink:0}}>
        <button onClick={onToggleFocus}
          aria-label={focus?"Expand workflow menu":"Collapse workflow menu"} aria-expanded={!focus}
          style={{background:focus?themeAlpha(C.acc,'14'):"none",border:`1px solid ${focus?themeAlpha(C.acc,'40'):C.brd2}`,color:focus?C.acc:C.txt2,cursor:"pointer",borderRadius:7,padding:"5px 9px",lineHeight:1,flexShrink:0,display:"inline-flex",alignItems:"center"}}>
          <span className="ml-menu-arrow" style={{display:"inline-flex",transition:"transform 0.2s var(--ease-out)",transform:focus?"rotate(180deg)":"none"}}><Icon name="chevronLeft" size={16}/></span>
        </button>
      </Tooltip>
      <div style={{display:"flex",alignItems:"center",gap:7,fontSize:12.5,minWidth:0,flex:"1 1 auto"}}>
        <button onClick={()=>setTab("overview")} title={project?.name||""}
          style={{background:"none",border:"none",color:C.txt,fontWeight:600,cursor:"pointer",fontFamily:"inherit",fontSize:13,padding:0,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{project?.name||"Project"}</button>
        <span style={{color:C.dim,flexShrink:0}}>▸</span>
        <span style={{fontWeight:700,color:C.txt2,flexShrink:0,whiteSpace:"nowrap"}}>{sectionLabel}</span>
        {/* Compact status badges near the title (non-overview only) */}
        {compact&&reqMissing>0&&(
          <Tooltip title="Requirements missing" description={(reqMissingList&&reqMissingList.length)?reqMissingList.slice(0,6).join(' · '):`${reqMissing} requirement${reqMissing===1?'':'s'} still needed before proceeding`}>
            <button onClick={onShowAudit} aria-label={`${reqMissing} requirement${reqMissing===1?'':'s'} missing — open audit`} style={badgeBtn(C.yel)}><Icon name="alertTriangle" size={11}/>{reqMissing}</button>
          </Tooltip>
        )}
        {compact&&missingItems>0&&(
          <Tooltip title="Missing items" description={`${missingItems} item${missingItems===1?'':'s'} need attention — open the audit to review`}>
            <button onClick={onShowAudit} aria-label={`${missingItems} missing item${missingItems===1?'':'s'} — open audit`} style={badgeBtn(C.red)}><span style={{width:6,height:6,borderRadius:"50%",background:C.red,display:"inline-block",flexShrink:0}}/>{missingItems}</button>
          </Tooltip>
        )}
      </div>
      {/* Middle — section nav + compact actions (report/export/import on non-overview) */}
      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        {compact&&onReport&&<>
          <Tooltip content="Export a full report (PDF / HTML)"><button onClick={onReport} aria-label="Export report" style={hdrIconBtn}><Icon name="fileText" size={13}/></button></Tooltip>
          <Tooltip content="Export project as JSON"><button onClick={onExport} aria-label="Export project" style={hdrIconBtn}><Icon name="download" size={13}/></button></Tooltip>
          <Tooltip content="Import project JSON"><button onClick={onImport} aria-label="Import project" style={hdrIconBtn}><Icon name="upload" size={13}/></button></Tooltip>
        </>}
        {tab!=="overview"&&<button onClick={()=>setTab("overview")} title="Project overview" style={{...btnS("ghost"),fontSize:11.5,display:"inline-flex",alignItems:"center",gap:5}}><Icon name="arrowLeft" size={12}/><span className="uh-navlabel">Project overview</span></button>}
        {onBackToProjects&&<button onClick={onBackToProjects} title="Back to all projects" style={{...btnS("ghost"),fontSize:11.5,display:"inline-flex",alignItems:"center",gap:5}}><Icon name="grid" size={12}/><span className="uh-navlabel">Projects</span></button>}
      </div>
      {/* Right — single utility cluster: [presence][chat][notifications][account] */}
      <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        {spId&&<PresenceIndicator users={presenceUsers} locks={presenceLocks} totalMembers={totalMembers} myUserId={myUserId}/>}
        {project&&<MetaLabChatLauncher metaLabProjectId={project.id} projectName={project.name}/>}
        <NotificationsBell/>
        <UserMenu context="metalab" onBeforeLogout={async()=>{try{await flushStorage();}catch(_){/* best-effort */}}}/>
      </div>
    </div>
  );
}

/* prompt19/24 — full-bleed Screening workspace frame. The universal header now
   owns the breadcrumb + nav + ☰ toggle, so the frame is just the embedded engine
   filling the available height. */
function ScreeningWorkspaceFrame({project,setTab}){
  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      {/* prompt22 Task 5 — Final Review's "Continue to Data Extraction" jumps to
          the SAME project's Data Extraction stage (no separate-project handoff). */}
      <div style={{flex:1,minHeight:0}}><EmbeddedScreening project={project} onGoToExtraction={()=>setTab("extraction")}/></div>
    </div>
  );
}

/* ════════════ TAB: SCREENING (prompt18 — embedded META·SIFT engine) ════════════ */
/* The Screening stage. META·SIFT stays a separate backend engine, but here it is
   shown as ONE in-project stage: resolve (and, for the owner, silently create)
   the linked screening module, then render its full workbench inline. The user
   never "links a META·SIFT project" — it is created/repaired automatically. */
function EmbeddedScreening({project,onGoToExtraction}){
  const lid=linkedSiftId(project);
  const pid=project&&project.id;
  const[spId,setSpId]=useState(lid||null);
  const[state,setState]=useState(lid?"ready":"loading"); // loading|ready|error|disabled
  const[msg,setMsg]=useState("");
  useEffect(()=>{
    let dead=false;
    if(lid){setSpId(lid);setState("ready");return undefined;}
    if(!pid){setState("error");setMsg("Open a project to start screening.");return undefined;}
    setState("loading");
    screeningApi.getWorkspace(pid)
      .then(r=>{ if(dead)return;
        if(r&&r.screenProjectId){setSpId(r.screenProjectId);setState("ready");}
        else {setState("error");setMsg("Couldn't open the screening workspace.");} })
      .catch(e=>{ if(dead)return;
        if(e&&e.status===503){setState("disabled");setMsg(e.message||"Screening is temporarily unavailable.");}
        else if(e&&e.status===404){setState("error");setMsg("Screening is available to the project owner and its members.");}
        else {setState("error");setMsg((e&&e.message)||"Couldn't open the screening workspace.");} });
    return()=>{dead=true;};
  },[lid,pid]);

  if(state==="ready"&&spId) return <div style={{height:"100%"}}><SiftProject embedded embeddedPid={spId} onGoToExtraction={onGoToExtraction}/></div>;

  const box={maxWidth:560,margin:"48px auto",textAlign:"center",border:`1px solid ${C.brd}`,borderRadius:12,background:C.card,padding:"32px 28px"};
  if(state==="loading") return <div style={box}><div style={{fontSize:13,color:C.muted}}>Opening screening…</div></div>;
  if(state==="disabled") return <div style={{...box,borderColor:themeAlpha(C.gold,'40'),background:themeAlpha(C.gold,'08')}}><div style={{fontSize:30,marginBottom:12}}>🔧</div><div style={{fontSize:15,fontWeight:600,color:C.gold,marginBottom:8}}>Screening is temporarily unavailable</div><div style={{fontSize:13,color:C.txt2}}>{msg}</div></div>;
  return <div style={box}><div style={{fontSize:30,marginBottom:12}}>📭</div><div style={{fontSize:14,fontWeight:600,color:C.txt,marginBottom:8}}>Screening unavailable</div><div style={{fontSize:13,color:C.txt2}}>{msg}</div></div>;
}

/* ════════════ TAB: OVERVIEW (prompt6 Task 15) ════════════ */
/* Project landing page — every project-enter path lands here: identity, team,
   linked screening workspace, PICO, progress, readiness, and the next step. */
function OverviewTab({project,setTab}){
  const lid=linkedSiftId(project);
  const linkedTitle=(project._linkedMetaSift&&project._linkedMetaSift.title)||"";
  const perms=projectPerms(project);
  // Members + leaders from the linked Review Workspace (graceful when unlinked).
  const[mem,setMem]=useState({loading:!!lid,members:null,error:null});
  useEffect(()=>{
    let dead=false;
    if(!lid){setMem({loading:false,members:null,error:null});return undefined;}
    setMem({loading:true,members:null,error:null});
    screeningApi.listMembers(lid)
      .then(d=>{if(!dead)setMem({loading:false,members:d.members||[],error:null});})
      .catch(e=>{if(!dead)setMem({loading:false,members:null,error:e.message||"Couldn't load members."});});
    return()=>{dead=true;};
  },[lid]);

  // prompt19 — live Screening progress for the overview card (PRISMA-shaped roll-up).
  // prompt21 follow-up — refetch on realtime screening pokes (accept / revert /
  // decisions / status) keyed on the linked screen project (lid), so this card
  // never shows stale numbers after a Final Review change made elsewhere.
  const[scr,setScr]=useState({loading:!!project?.id,data:null});
  const loadScr=useCallback(()=>{
    if(!project?.id)return;
    fetch(`/api/screening/metalab/${project.id}/summary`,{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(d=>setScr({loading:false,data:(d&&d.linked)?d:null}))
      .catch(()=>setScr({loading:false,data:null}));
  },[project?.id]);
  useEffect(()=>{
    if(!project?.id){setScr({loading:false,data:null});return undefined;}
    setScr(s=>({loading:true,data:s.data}));
    loadScr();
    return undefined;
  },[project?.id,loadScr]);
  useRealtime({
    "handoff.updated":ev=>{if(ev?.projectId===lid)loadScr();},
    "decision.saved": ev=>{if(ev?.projectId===lid)loadScr();},
    "status.changed": ev=>{if(ev?.projectId===lid)loadScr();},
  });

  const studies=project.studies||[];
  const withES=studies.filter(s=>s.es!=="").length;
  const status=stepStatus(project, !!scr.data?.screeningComplete); // prompt29 Part 9
  const wfTabs=TABS.filter(t=>t.phase); // workflow steps only
  const doneCount=wfTabs.filter(t=>status[t.id]==="done").length;
  const nextStep=wfTabs.find(t=>status[t.id]!=="done")||null;
  const ready=readinessCheck(project);
  const meta=runMeta(studies,"random");
  const pico=project.pico||{},prisma=project.prisma||{};
  const owner=project._owner?(project._owner.name||project._owner.email):"You";
  const leaders=(mem.members||[]).filter(m=>m.role==="leader"||m.role==="owner");

  const card={background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16};
  const secLbl={fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:9};
  const kv=(k,v)=>(<div key={k} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:12,padding:"4px 0",minWidth:0}}>
    <span style={{color:C.muted,flexShrink:0}}>{k}</span>
    <span title={String(v)} style={{color:C.txt2,textAlign:"right",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v}</span>
  </div>);

  return(<div>
    <SectionHeader icon="grid" title="Overview" desc="Where this review stands right now — team, linked screening workspace, progress, and what to do next."/>

    {/* Stat row */}
    <div className="ov-grid4" style={{marginBottom:14}}>
      {[
        {n:studies.length,l:"Studies in extraction"},
        {n:withES,l:"With effect size"},
        {n:prisma.included||"0",l:"PRISMA included"},
        {n:mem.members?mem.members.length:mem.loading?"…":"—",l:"Workspace members"},
      ].map(s=>(
        <div key={s.l} style={{...card,padding:"12px 14px",textAlign:"center"}}>
          <div className="stat-num" style={{fontSize:22,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.txt}}>{s.n}</div>
          <div style={{fontSize:10,color:C.muted,marginTop:3}}>{s.l}</div>
        </div>
      ))}
    </div>

    <div className="ov-grid2" style={{marginBottom:14}}>
      {/* Project identity */}
      <div style={card}>
        <div style={secLbl}>Project</div>
        {kv("Title",project.name)}
        {kv("Owner",owner)}
        <div style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:12,padding:"4px 0",alignItems:"center"}}>
          <span style={{color:C.muted}}>Your role</span>
          <span style={tagS(perms.isOwner?"green":perms.readOnly?"yellow":"blue")}>
            {perms.readOnly?`${perms.role} · read-only`:perms.role}
          </span>
        </div>
        {kv("Created",fmtDate(project.created||project.createdAt))}
        {kv("Last modified",fmtDate(project.modified||project.updatedAt))}
      </div>

      {/* Screening Progress (prompt19) — live PRISMA-shaped numbers from the
          Screening stage + the next recommended action. NOT general project status. */}
      <div style={{...card,borderColor:themeAlpha("var(--t-teal)","40")}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:9}}>
          <div style={{...secLbl,color:"var(--t-teal)",marginBottom:0}}>Screening Progress</div>
          {scr.loading&&<span style={{fontSize:10,color:C.muted,fontFamily:"'IBM Plex Mono',monospace"}}>…</span>}
        </div>
        {scr.data&&scr.data.prisma?(()=>{
          const p=scr.data.prisma;
          const stat=(n,l)=>(<div key={l} style={{textAlign:"center",minWidth:0}}>
            <div style={{fontSize:18,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.txt,lineHeight:1}}>{n??0}</div>
            <div style={{fontSize:9.5,color:C.muted,marginTop:3}}>{l}</div>
          </div>);
          const nextAction=(p.identified||0)===0?"Import references":((p.included||0)===0?"Screen titles & abstracts":((p.fullTextAssessed||0)>((p.fullTextExcluded||0)+(p.included||0))?"Review full text":"Send included studies to extraction"));
          return(<>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:12}}>
              {stat(p.identified,"Imported")}
              {stat(p.duplicatesRemoved,"Duplicates")}
              {stat(p.screened,"Screened")}
              {stat(p.fullTextAssessed,"Full text")}
              {stat(p.included,"Included")}
            </div>
            <div style={{fontSize:11,color:C.muted,marginBottom:11}}>Next: <strong style={{color:C.txt2}}>{nextAction}</strong></div>
          </>);
        })():(
          <div style={{fontSize:12,color:C.muted,lineHeight:1.6,marginBottom:11}}>
            Import references, remove duplicates, screen titles &amp; abstracts with your team, resolve conflicts, and assess full text — all in the Screening stage. Accepted studies flow into Data Extraction and the PRISMA numbers fill in automatically.
          </div>
        )}
        <button onClick={()=>setTab("screening")}
          style={{background:"var(--t-teal)",border:"none",color:"var(--t-acc-text)",fontSize:11.5,fontWeight:700,fontFamily:"'IBM Plex Sans',sans-serif",padding:"7px 16px",borderRadius:7,cursor:"pointer"}}>
          {((scr.data&&scr.data.prisma&&(scr.data.prisma.identified||scr.data.prisma.included))||(project._linkedMetaSift&&project._linkedMetaSift.recordCount))?"Continue screening →":"Start screening →"}
        </button>
      </div>
    </div>

    <div className="ov-grid2" style={{marginBottom:14}}>
      {/* Team */}
      <div style={card}>
        <div style={secLbl}>Team</div>
        {!lid?<div style={{fontSize:12,color:C.muted,lineHeight:1.6}}>Open the Screening stage once to set up this project's workspace, then invite collaborators here.</div>
        :mem.loading?<div style={{fontSize:12,color:C.muted}}>Loading members…</div>
        :mem.error?<div style={{fontSize:12,color:C.yel}}>⚠ {mem.error}</div>
        :(<>
          {kv("Members",String(mem.members.length))}
          {kv("Leaders",leaders.length?leaders.map(m=>m.name||m.email).join(", "):"—")}
          <div style={{marginTop:8}}>
            <button onClick={()=>setTab("control")} style={{...btnS("ghost"),fontSize:11}}>Manage members →</button>
          </div>
        </>)}
      </div>

      {/* PICO summary */}
      <div style={card}>
        <div style={secLbl}>PICO</div>
        {pico.question&&<div style={{fontSize:12,color:C.txt2,lineHeight:1.6,marginBottom:8,fontStyle:"italic"}}>“{pico.question}”</div>}
        {(pico.P||pico.I||pico.C||pico.O)
          ?[["P",pico.P],["I",pico.I],["C",pico.C],["O",pico.O]].map(([k,v])=>v?(
            <div key={k} style={{display:"flex",gap:8,fontSize:11.5,padding:"2px 0"}}>
              <span style={{fontWeight:800,color:C.acc,minWidth:14,flexShrink:0}}>{k}</span>
              <span style={{color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v}</span>
            </div>):null)
          :(!pico.question&&<div style={{fontSize:12,color:C.muted}}>No PICO yet — start in the PICO &amp; Question tab.</div>)}
      </div>
    </div>

    {/* Progress */}
    <div style={{...card,marginBottom:14}}>
      <div style={secLbl}>Progress</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
        <div>
          <div style={{fontSize:11,color:C.muted,marginBottom:5}}>Workflow steps complete</div>
          <ProgressBar done={doneCount} total={wfTabs.length}/>
        </div>
        <div>
          <div style={{fontSize:11,color:C.muted,marginBottom:5}}>Extraction — studies with an effect size</div>
          <ProgressBar done={withES} total={studies.length}/>
        </div>
      </div>
      <div style={{fontSize:11,color:C.muted,marginTop:12,lineHeight:1.7}}>
        PRISMA: <strong style={{color:C.txt}}>{prisma.dbs||"0"}</strong> identified · <strong style={{color:C.txt}}>{prisma.dedupe||"0"}</strong> duplicates removed · <strong style={{color:C.red}}>{prisma.excTA||"0"}</strong> excluded (title/abstract) · <strong style={{color:C.red}}>{prisma.excFull||"0"}</strong> full-text excluded · <strong style={{color:C.grn}}>{prisma.included||"0"}</strong> included
        {meta&&<> · pooled: <strong style={{color:C.grn}}>k={meta.k}, I²={meta.I2}%</strong></>}
      </div>
    </div>

    <div className="ov-grid2">
      {/* Meta-analysis readiness */}
      <div style={{...card,borderColor:themeAlpha((ready.ok?C.grn:C.yel),'44')}}>
        <div style={{...secLbl,color:ready.ok?C.grn:C.yel}}>Meta-analysis readiness</div>
        {ready.ok
          ?<div style={{fontSize:12.5,color:C.grn,lineHeight:1.6}}>✓ All prerequisites met — PICO, databases, and search strategy are in place.</div>
          :(<div>
            <div style={{fontSize:12,color:C.muted,marginBottom:6}}>{ready.missing.length} requirement{ready.missing.length===1?"":"s"} missing:</div>
            {ready.missing.map((m,i)=>(
              <div key={i} style={{display:"flex",gap:7,fontSize:11.5,color:C.txt2,padding:"2px 0",lineHeight:1.5}}>
                <span style={{color:C.yel,flexShrink:0}}>⚠</span><span>{m}</span>
              </div>))}
          </div>)}
      </div>

      {/* Next suggested step */}
      <div style={{...card,borderColor:themeAlpha(C.acc,'40')}}>
        <div style={{...secLbl,color:C.acc}}>Next suggested step</div>
        {nextStep?(<>
          <div style={{fontSize:13,fontWeight:700,color:C.txt,marginBottom:4,display:"flex",alignItems:"center",gap:6}}><Icon name={nextStep.icon} size={14}/>{nextStep.label}</div>
          <div style={{fontSize:11.5,color:C.muted,lineHeight:1.6,marginBottom:10}}>
            {status[nextStep.id]==="partial"?"Started but not finished — pick up where you left off.":"The first incomplete step in the PRISMA workflow."}
          </div>
          <button onClick={()=>setTab(nextStep.id)} style={{...btnS("primary"),fontSize:12}}>Go to {nextStep.label} →</button>
        </>):(
          <div style={{fontSize:12.5,color:C.grn,lineHeight:1.6}}>✓ Every workflow step is complete — run the audit, export your report, and submit.</div>
        )}
      </div>
    </div>
  </div>);
}

/* ════════════ TAB: PROJECT CONTROL (prompt6 Task 4) ════════════ */
/* META·LAB-side port of META·SIFT's ProjectControlTab + MembersTab. ALL member
   and status operations go through screeningApi against the LINKED ScreenProject
   — the shared Review Workspace is the single source of truth. Permissions:
   owner everything; leaders manage members except the owner and cannot assign
   the Leader preset (server-enforced; mirrored here); members/viewers get a
   read-only rendering. Unlinked → project info + "Create & link" card. */
const CTRL_STATUS_OPTIONS=[
  {value:"not_started",label:"Not started"},
  {value:"in_progress",label:"In progress"},
  {value:"done",label:"Done"},
];
function ControlTab({project,onAnnotate,setTab,presence,onDeleted}){
  const lid=linkedSiftId(project);
  const perms=projectPerms(project);
  const amProjectOwner=!project._shared;
  // prompt32 Task 10 — owner-only Danger Zone (archive / delete) state.
  const[archiveBusy,setArchiveBusy]=useState(false);
  const[archiveErr,setArchiveErr]=useState("");
  const[delOpen,setDelOpen]=useState(false);
  const[delConfirm,setDelConfirm]=useState("");
  const[delBusy,setDelBusy]=useState(false);
  const[delErr,setDelErr]=useState("");
  const isArchived=!!project._archived;
  const toggleArchive=async()=>{
    setArchiveBusy(true);setArchiveErr("");
    try{
      if(isArchived) await api.projects.unarchive(project.id);
      else await api.projects.archive(project.id);
      onAnnotate(project.id,{_archived:!isArchived,_archivedAt:isArchived?null:new Date().toISOString()});
    }catch(e){setArchiveErr(e.message||"Could not change the archive state.");}
    setArchiveBusy(false);
  };
  const doDelete=async()=>{
    if(delConfirm.trim()!==String(project.name||"").trim()){setDelErr("The name you typed does not match.");return;}
    setDelBusy(true);setDelErr("");
    try{
      // Owner-confirmed soft delete: server enforces owner-only, writes an audit
      // row, and (cascadeLinked) soft-deletes the linked screening workspace + its
      // RoB assessments. Then leave the workspace and let the dashboard reload.
      await api.projects.confirmDelete(project.id,{confirmName:delConfirm.trim(),cascadeLinked:true});
      if(onDeleted) onDeleted(project.id);
    }catch(e){setDelErr(e.message||"Could not delete the project.");setDelBusy(false);}
  };
  // Workspace membership payload — also resolves OUR authority in the workspace.
  const[data,setData]=useState({loading:!!lid,members:[],isOwner:false,isLeader:false,canManageMembers:false,myRole:null,error:null});
  const[sp,setSp]=useState(null);   // linked ScreenProject row (status, flags)
  const[spErr,setSpErr]=useState("");
  const[statusBusy,setStatusBusy]=useState(false);
  const[statusFlash,setStatusFlash]=useState(false);
  // prompt34 Task 9 — Screening & collaboration settings (blind mode / restrict
  // chat / required reviewers) edited here against the linked ScreenProject, which
  // is the SINGLE source of truth (Screening Settings shows the same values).
  const[spBusy,setSpBusy]=useState(false);
  const[spFlash,setSpFlash]=useState(false);
  const[linkBusy,setLinkBusy]=useState(false);
  const[linkErr,setLinkErr]=useState("");

  const loadMembers=useCallback(async()=>{
    if(!lid){setData(d=>({...d,loading:false}));return;}
    setData(d=>({...d,loading:true,error:null}));
    try{
      const d=await screeningApi.listMembers(lid);
      setData({loading:false,members:d.members||[],isOwner:!!d.isOwner,isLeader:!!d.isLeader,
        canManageMembers:!!d.canManageMembers,myRole:d.myRole||null,error:null});
    }catch(e){
      setData({loading:false,members:[],isOwner:false,isLeader:false,canManageMembers:false,myRole:null,
        error:e.message||"Couldn't load the workspace members."});
    }
  },[lid]);
  const loadSp=useCallback(async()=>{
    if(!lid){setSp(null);return;}
    try{setSp(await screeningApi.getProject(lid));setSpErr("");}
    catch(e){setSpErr(e.message||"Couldn't load the linked workspace.");}
  },[lid]);
  useEffect(()=>{loadMembers();loadSp();},[loadMembers,loadSp]);

  // prompt24 — member add/edit/remove now lives entirely inside the shared
  // MembersTab; ControlTab only needs `data` for the Project-info owner row and to
  // hand MembersTab our workspace authority hint.
  const canManageStatus=!!(sp&&(sp.canManageSettings||sp.isLeader||sp.isOwner));
  const ownerRow=data.members.find(m=>m.isOwner||m.role==="owner")||null;

  // Project status lives on the ScreenProject (the workspace) — optimistic + revert.
  const setStatus=async(v)=>{
    if(!sp)return;
    const prev=sp.progressStatus;
    setStatusBusy(true);setSpErr("");
    setSp(s=>({...s,progressStatus:v}));
    try{
      await screeningApi.updateProject(lid,{progressStatus:v});
      setStatusFlash(true);setTimeout(()=>setStatusFlash(false),1400);
    }catch(e){
      setSp(s=>({...s,progressStatus:prev}));
      setSpErr(e.message||"Could not change the project status.");
    }
    setStatusBusy(false);
  };
  // prompt34 Task 9 — optimistic save of a Screening setting onto the linked
  // ScreenProject (blindMode / chatRestricted / requiredScreeningReviewers). The
  // server re-validates owner/leader authority; we revert on failure.
  const saveSpSetting=async(patch)=>{
    if(!lid||!sp)return;
    const prev=sp;
    setSpBusy(true);setSpErr("");
    setSp(s=>({...s,...patch}));
    try{
      await screeningApi.updateProject(lid,patch);
      setSpFlash(true);setTimeout(()=>setSpFlash(false),1400);
    }catch(e){
      setSp(prev);
      setSpErr(e.message||"Could not save the setting.");
    }
    setSpBusy(false);
  };
  // "Create & link META·SIFT" (owner only — the server validates ownership).
  const createLink=async()=>{
    setLinkBusy(true);setLinkErr("");
    try{
      const created=await screeningApi.createProject({title:project.name||"Screening project",linkedMetaLabProjectId:project.id});
      // Refresh the local annotations so the whole app sees the link instantly.
      onAnnotate(project.id,{_linkedMetaSift:{id:created.id,title:created.title}});
    }catch(e){setLinkErr(e.message||"Could not create the screening project.");}
    setLinkBusy(false);
  };

  const card={background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:14};
  const secLbl={fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:9};
  const spStatus=(sp&&sp.progressStatus)||"not_started";
  const statusMeta=CTRL_STATUS_OPTIONS.find(o=>o.value===spStatus);

  return(<div>
    <SectionHeader icon="sliders" title="Project Control"
      desc="Manage this review project — status, members, roles, and permissions — all in one place."
      badge={`Your role · ${perms.role}`}/>

    {perms.readOnly&&(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:C.txt2,display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:14}}>🔒</span>
        Read-only access — you can view project information here, but only the owner or a leader can change settings.
      </div>
    )}

    {/* Project info */}
    <div style={card}>
      <div style={secLbl}>Project info</div>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",columnGap:24,rowGap:2}}>
        {[["Name",project.name],
          // prompt25 Task 5 — prefer the LIVE owner (project._owner, resolved fresh
          // from the User row server-side) so a rename shows immediately; members
          // list (now also live) is only a fallback.
          ["Owner",project._owner?(project._owner.name||project._owner.email):(ownerRow?(ownerRow.name||ownerRow.email):"You")],
          ["Created",fmtDate(project.created||project.createdAt)],
          ["Last modified",fmtDate(project.modified||project.updatedAt)],
          ["Studies in extraction",String((project.studies||[]).length)],
          ["Screening",lid?((project._linkedMetaSift&&project._linkedMetaSift.title)||(sp&&sp.title)||"Set up"):"Set up on open"],
        ].map(([k,v])=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:12,padding:"4px 0",minWidth:0}}>
            <span style={{color:C.muted,flexShrink:0}}>{k}</span>
            <span title={String(v)} style={{color:C.txt2,textAlign:"right",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v}</span>
          </div>
        ))}
      </div>
    </div>

    {/* Status + linked workspace */}
    {lid?(
      <div style={card}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={secLbl}>Project status{statusFlash&&<span style={{marginLeft:8,color:C.grn,textTransform:"none",letterSpacing:0,fontFamily:"'IBM Plex Mono',monospace"}}>✓ saved</span>}</div>
        </div>
        {spErr&&<div style={{fontSize:11.5,color:C.red,marginBottom:8}}>{spErr}</div>}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:12}}>
          <div>
            <div style={{fontSize:12.5,color:C.txt,fontWeight:600}}>Status</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>Where this review stands — shared across the whole project team.</div>
          </div>
          {canManageStatus?(
            <select value={spStatus} disabled={statusBusy}
              onChange={e=>setStatus(e.target.value)}
              style={{...inp,width:"auto",fontSize:12,padding:"6px 10px",opacity:statusBusy?0.6:1}}>
              {CTRL_STATUS_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ):(
            <span style={tagS(spStatus==="done"?"green":spStatus==="in_progress"?"blue":"")}>{statusMeta?statusMeta.label:spStatus}</span>
          )}
        </div>
        <div style={{borderTop:`1px solid ${C.brd}`,paddingTop:12,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          {setTab&&<button onClick={()=>setTab("screening")} style={{...btnS("ghost"),fontSize:11}}><Icon name="filter" size={11}/> Open Screening →</button>}
          <span style={{fontSize:10.5,color:C.muted}}>Accepted full-text studies hand off to Data Extraction; PRISMA numbers fill in from screening.</span>
        </div>
      </div>
    ):(
      <div style={{...card,borderColor:themeAlpha("var(--t-teal)","40"),background:C.bg}}>
        <div style={{...secLbl,color:"var(--t-teal)"}}>Screening</div>
        <div style={{fontSize:12,color:C.muted,lineHeight:1.6,marginBottom:12}}>
          Open the <strong style={{color:C.txt}}>Screening</strong> stage to import references and screen with your team. The screening
          workspace — including its members and permissions — is set up automatically the first time the owner opens it. No manual linking needed.
        </div>
        {setTab&&<button onClick={()=>setTab("screening")} style={btnS("primary")}>Go to Screening →</button>}
      </div>
    )}

    {/* prompt34 Task 9 — Screening & collaboration settings (blind mode, restrict
        chat, required reviewers) live HERE in Project Control as the main place to
        edit them; they write to the linked ScreenProject (single source of truth),
        so the Screening "Settings" tab shows the same synchronized values. */}
    {lid&&(
      <div style={card}>
        <div style={secLbl}>Screening &amp; collaboration{spFlash&&<span style={{marginLeft:8,color:C.grn,textTransform:"none",letterSpacing:0,fontFamily:"'IBM Plex Mono',monospace"}}>✓ saved</span>}</div>
        {!canManageStatus&&<div style={{fontSize:11.5,color:C.muted,marginBottom:10,lineHeight:1.5}}>You can view these settings. Only the owner or a leader can change them.</div>}
        {spErr&&<div style={{fontSize:11.5,color:C.red,marginBottom:8}}>{spErr}</div>}
        {/* Blind mode */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:12.5,color:C.txt,fontWeight:600}}>Blind mode</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.45}}>Hide author / journal info from reviewers during screening.</div>
          </div>
          {canManageStatus
            ? <SwitchToggle on={!!sp?.blindMode} busy={spBusy} onClick={()=>saveSpSetting({blindMode:!sp?.blindMode})} ariaLabel={`Blind mode — currently ${sp?.blindMode?"on":"off"}`} onLabel="On" offLabel="Off"/>
            : <span style={tagS(sp?.blindMode?"gold":"")}>{sp?.blindMode?"On":"Off"}</span>}
        </div>
        {/* Restrict chat */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",borderTop:`1px solid ${C.brd}`,marginTop:12,paddingTop:12}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:12.5,color:C.txt,fontWeight:600}}>Restrict chat</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.45}}>When on, only members with the Chat permission can post.</div>
          </div>
          {canManageStatus
            ? <SwitchToggle on={!!sp?.chatRestricted} busy={spBusy} onClick={()=>saveSpSetting({chatRestricted:!sp?.chatRestricted})} ariaLabel={`Restrict chat — currently ${sp?.chatRestricted?"on":"off"}`} onLabel="Restricted" offLabel="Open"/>
            : <span style={tagS(sp?.chatRestricted?"gold":"")}>{sp?.chatRestricted?"Restricted":"Open"}</span>}
        </div>
        {/* Required reviewers */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",borderTop:`1px solid ${C.brd}`,marginTop:12,paddingTop:12}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:12.5,color:C.txt,fontWeight:600}}>Required reviewers</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.45}}>Independent title &amp; abstract decisions needed before a record can advance to Final Review. The research standard is 2; only the owner or a leader can change it.</div>
          </div>
          {canManageStatus
            ? <select value={sp?.requiredScreeningReviewers??2} disabled={spBusy} aria-label="Required reviewers"
                onChange={e=>saveSpSetting({requiredScreeningReviewers:parseInt(e.target.value,10)})}
                style={{...inp,width:"auto",fontSize:12,padding:"6px 10px",opacity:spBusy?0.6:1}}>
                {[2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n} reviewers</option>)}
              </select>
            : <span style={tagS("blue")}>{sp?.requiredScreeningReviewers??2} reviewers</span>}
        </div>
      </div>
    )}

    {/* Members & permissions (prompt24 Task 6) — reuses the SAME polished, grouped
        MembersTab as Screening Settings (Owner ▸ Leaders ▸ Members ▸ Viewers, role
        badges, presets, live presence/location) so the two never drift. The linked
        workspace (ScreenProject) is the single source of truth. */}
    <div style={card}>
      <div style={secLbl}>Members &amp; permissions</div>
      {!lid?(
        <div style={{fontSize:12,color:C.muted,lineHeight:1.6}}>
          Open the <strong style={{color:C.txt}}>Screening</strong> stage once to set up this project's workspace, then invite collaborators here —
          everyone you add participates across the whole project according to their permissions.
        </div>
      ):(
        <ProjectMembersPanel
          pid={lid}
          project={sp||project}
          access={{isLeader:data.isLeader,myRole:data.myRole}}
          presence={presence}
          refreshProject={()=>{loadMembers();loadSp();}}
          leaveRedirect="/app"
        />
      )}
    </div>

    <InfoBox>💡 This is the project's shared team — the source of truth for owner, leaders, members, roles, and permissions. Changes here apply across the whole project immediately. Leaders can manage members but cannot edit the owner or assign the Leader preset.</InfoBox>

    {/* prompt32 Task 10 — Danger Zone (OWNER ONLY). Archive is reversible; Delete
        is an owner-confirmed soft delete (server-enforced owner-only + audit log)
        that also removes the linked screening workspace and its RoB assessments. */}
    {amProjectOwner&&(
      <div style={{...card,border:`1px solid ${themeAlpha(C.red,'50')}`,background:themeAlpha(C.red,'08')}}>
        <div style={{...secLbl,color:C.red}}>Danger zone</div>
        {/* Archive / Unarchive */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",paddingBottom:12,borderBottom:`1px solid ${C.brd}`}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:12.5,color:C.txt,fontWeight:600}}>{isArchived?"Unarchive project":"Archive project"}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>{isArchived?"Restore this project to your active dashboard.":"Hide this project from the active dashboard. Reversible — nothing is deleted."}</div>
          </div>
          <button onClick={toggleArchive} disabled={archiveBusy} style={{...btnS("ghost"),fontSize:11.5,opacity:archiveBusy?0.6:1}}>
            <Icon name="folder" size={12}/> {archiveBusy?"Working…":(isArchived?"Unarchive":"Archive")}
          </button>
        </div>
        {archiveErr&&<div style={{fontSize:11.5,color:C.red,marginTop:8}}>{archiveErr}</div>}
        {/* Delete */}
        <div style={{paddingTop:12}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:12.5,color:C.txt,fontWeight:600}}>Delete project</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.5}}>
                Permanently remove this project from your dashboard, including its Data Extraction studies, linked Screening records, and Risk-of-Bias assessments. This cannot be undone from here.
              </div>
            </div>
            {!delOpen&&<button onClick={()=>{setDelOpen(true);setDelErr("");setDelConfirm("");}} style={{...btnS("ghost"),fontSize:11.5,color:C.red,borderColor:themeAlpha(C.red,'50')}}><Icon name="trash" size={12}/> Delete project</button>}
          </div>
          {delOpen&&(
            <div style={{marginTop:12,padding:12,borderRadius:8,background:C.bg,border:`1px solid ${themeAlpha(C.red,'40')}`}}>
              <div style={{fontSize:12,color:C.txt2,marginBottom:8,lineHeight:1.5}}>
                Type the project name <b style={{color:C.txt}}>{project.name}</b> to confirm deletion.
              </div>
              <input value={delConfirm} onChange={e=>setDelConfirm(e.target.value)} placeholder={project.name||"Project name"} disabled={delBusy}
                style={{...inp,width:"100%",marginBottom:10}}/>
              {delErr&&<div style={{fontSize:11.5,color:C.red,marginBottom:8}}>{delErr}</div>}
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button onClick={doDelete} disabled={delBusy||delConfirm.trim()!==String(project.name||"").trim()}
                  style={{...btnS("primary"),fontSize:11.5,background:C.red,borderColor:C.red,opacity:(delBusy||delConfirm.trim()!==String(project.name||"").trim())?0.5:1}}>
                  {delBusy?"Deleting…":"Permanently delete"}
                </button>
                <button onClick={()=>{setDelOpen(false);setDelErr("");setDelConfirm("");}} disabled={delBusy} style={{...btnS("ghost"),fontSize:11.5}}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}
  </div>);
}

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
  // mirrors themePreference). null/anything-else ⇒ "auto" (current default).
  const workflowMenuMode = authUser?.workflowMenuMode === "pinned" ? "pinned" : "auto";
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
          onReport={openReportExport} onExport={openProjectExport} onImport={()=>importRef.current&&importRef.current.click()}/>
      )}
      {/* prompt32 Task 5 — responsive global workspace gutter. The horizontal pad
          scales 20px → 5vw → 88px (≈5–10% on wide screens) so content never glues
          to the borders nor wastes space on ultra-wide; vertical pad unchanged.
          Screening keeps its full-bleed 0 escape hatch. Reading tabs still centre
          at maxWidth:1100 below; data tabs (extraction/rob/analysis/forest) fill
          the now responsively-padded column. */}
      <div style={{flex:1,minHeight:0,overflowY:inScreening?"hidden":"auto",padding:inScreening?0:"28px clamp(20px, 5vw, 88px) 56px"}}>
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
        <div style={{maxWidth:READING_TABS.has(tab)?1100:"none",margin:READING_TABS.has(tab)?"0 auto":0}} className="tab-content">
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
          {tab==="overview"&&<OverviewTab project={project} setTab={setTab}/>}
          {tab==="control"&&<ControlTab project={project} onAnnotate={patchAnnotations} setTab={setTab} presence={{users:presenceUsers,locks:presenceLocks}}
            onDeleted={(delId)=>{setProjects(prev=>prev.filter(p=>p.id!==delId));if(onBackToProjects)onBackToProjects();else setActiveId(null);}}/>}
          {tab==="pico"&&<PICODispatcher project={project} activeId={activeId} updNested={updNested} upd={upd} lockCtx={{pid:spId,myUserId:authUser?.id,locks:presenceLocks}}/>}
          {tab==="prospero"&&<PROSPEROTab project={project} updNested={updNested} upd={upd}/>}
          {tab==="search"&&<SearchDispatcher project={project} activeId={activeId} updNested={updNested} upd={upd}/>}
          {tab==="prisma"&&<PRISMATab project={project} updNested={updNested} updateProject={updateProject} activeId={activeId} setTab={setTab}/>}
          {tab==="extraction"&&<ExtractionTab project={project} updateProject={updateProject} activeId={activeId}/>}
          {tab==="rob"&&<RoBTab project={project} updateProject={updateProject} activeId={activeId} setTab={setTab}/>}
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
