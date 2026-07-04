/* ════════════ STATISTICS / VALIDATION ENGINE (extracted from meta-lab-3-patched.jsx) ════════════
   prompt46 Phase 2 — these statistics/validation functions and their constants were
   moved VERBATIM out of the monolith into this single module (they are inter-dependent,
   so they stay together to keep internal call order/references intact).

   IMPORTANT: these are the MONOLITH's OWN copies. They are intentionally NOT merged with
   the pre-existing `src/research-engine/statistics/*` or `project-model/constants.js`
   modules — those are separate duplicates and re-pointing could drift behavior. */
import { ADJUST_LABEL, DATA_NATURE_LABEL } from "../project-model/monolithConstants.js";
import { isNonPrimary } from "../import-export/referenceParsers.js";
// RoadMap/2.md — opt-in τ² estimators (DL stays the default; existing results unchanged).
import { estimateTau2, TAU2_METHODS } from "./tau2.js";
export { estimateTau2, TAU2_METHODS, TAU2_LABELS } from "./tau2.js";

/* P13 — meta-regression + bubble plots. Re-exported from the pure engine so the
   UI (and server export) import it from the same barrel as runMeta/subgroupAnalysis.
   The engine itself lives in ./metaRegression.js (pure, deterministic, no deps
   beyond nma/linalg + math-helpers). */
export { metaRegression, ENGINE_VERSION as META_REGRESSION_ENGINE_VERSION } from "./metaRegression.js";

/* ════════════ STATISTICS ════════════ */
export const Z975 = 1.959963984540054; // qnorm(0.975), exact
export function normalCDF(z) {
  const a=[0.254829592,-0.284496736,1.421413741,-1.453152027,1.061405429], p=0.3275911;
  const sign=z<0?-1:1, za=Math.abs(z)/Math.SQRT2;
  const t=1/(1+p*za); let poly=0;
  for(let i=4;i>=0;i--) poly=a[i]+t*poly;
  return 0.5*(1+sign*(1-poly*t*Math.exp(-za*za)));
}
export function runMeta(studies, method="random", opts={}) {
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
  // τ² (DerSimonian–Laird) — the DEFAULT, always computed so both models can be reported.
  const tau2dl=Math.max(0,(Q-(k-1))/(W-W2/W));
  // RoadMap/2.md — an OPT-IN τ² estimator overrides only the random-effects τ² (DL stays
  // default so every existing call is byte-for-byte unchanged; HKSJ + PI use whatever τ²
  // is chosen). Falls back to DL for small k / non-convergence (flagged in the result).
  const reqTau2Method=(opts&&TAU2_METHODS.includes(opts.tau2Method))?opts.tau2Method:"DL";
  let tau2all=tau2dl, tau2Method="DL", tau2Fallback=null, tau2Converged=true;
  if(reqTau2Method!=="DL"){
    const est=estimateTau2(d.map(x=>x._es),d.map(x=>x._se*x._se),{method:reqTau2Method});
    tau2all=est.tau2; tau2Method=reqTau2Method; tau2Fallback=est.fallback; tau2Converged=est.converged;
  }
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
    tau2Method,tau2Fallback,tau2Converged,
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
export function eggersTest(studies) {
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
export function leaveOneOut(studies, method) {
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
export function trimFill(studies, method){
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
export function influenceDiagnostics(studies, method){
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
export function subgroupAnalysis(studies, groupKey, method) {
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
export function gammp(a, x){
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
export function chiSquareCDF(x, df) {
  if (x <= 0) return 0;
  return gammp(df/2, x/2);
}

/* Regularised incomplete beta (continued fraction) — used for the Student-t CDF */
export function betacf(x, a, b) {
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
export function lgamma(z){
  var g=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];
  var x=z, y=z, tmp=x+5.5; tmp-=(x+0.5)*Math.log(tmp); var ser=1.000000000190015;
  for(var j=0;j<6;j++){ y++; ser+=g[j]/y; }
  return -tmp+Math.log(2.5066282746310005*ser/x);
}
export function ibeta(x, a, b){
  if(x<=0) return 0; if(x>=1) return 1;
  var bt=Math.exp(lgamma(a+b)-lgamma(a)-lgamma(b)+a*Math.log(x)+b*Math.log(1-x));
  if(x<(a+1)/(a+b+2)) return bt*betacf(x,a,b)/a;
  return 1-bt*betacf(1-x,b,a)/b;
}
/* Student-t two-sided CDF P(T<=t) for df>0 */
export function tCDF(t, df){
  var x=df/(df+t*t);
  var ib=0.5*ibeta(x, df/2, 0.5);
  return t>0 ? 1-ib : ib;
}
/* Inverse Student-t: critical value t* such that P(-t*<T<t*)=conf (two-sided). */
export function tCrit(conf, df){
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
export function invNormAbs(p){ // p is the upper cumulative point e.g. 0.975
  // reuse Acklam invNorm defined later via a small inline rational approx
  // accurate enough for 0.5<p<0.9999
  if(p===0.975) return 1.959963985;
  if(p===0.95) return 1.644853627;
  // generic: invert normalCDF by bisection
  var lo=0,hi=10,mid;
  for(var i=0;i<100;i++){ mid=(lo+hi)/2; if(normalCDF(mid)<p) lo=mid; else hi=mid; }
  return mid;
}

export function calcES(type,p) {
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
    if(type==="PETO"){
      // Peto one-step odds ratio (log scale) from a 2×2. a=event/exp, b=noevent/exp,
      // c=event/ctrl, d=noevent/ctrl. Best for rare events / balanced arms; no
      // continuity correction is needed (handles single zero cells). Yusuf/Peto 1985.
      const raw=[p.a,p.b,p.c,p.d];
      if(raw.some(v=>v===""||v==null)) return null;
      const a=+p.a,b=+p.b,c=+p.c,d2=+p.d;
      if([a,b,c,d2].some(v=>isNaN(v)||!isFinite(v)||v<0||!Number.isInteger(v))) return null;
      const n1=a+b,n2=c+d2,N=n1+n2,ev=a+c;
      if(N<2||n1<1||n2<1) return null;
      if(ev===0||ev===N) return null;               // no events, or all events → not estimable
      const O=a,E=n1*ev/N;
      const V=(n1*n2*ev*(N-ev))/(N*N*(N-1));
      if(!(V>0)) return null;                        // degenerate variance
      const lnPeto=(O-E)/V,se=Math.sqrt(1/V);
      return{es:lnPeto,se:se,lo:lnPeto-1.96*se,hi:lnPeto+1.96*se,
        display:`Peto OR=${Math.exp(lnPeto).toFixed(3)} [${Math.exp(lnPeto-1.96*se).toFixed(3)}, ${Math.exp(lnPeto+1.96*se).toFixed(3)}]`};
    }
    if(type==="IRR"){
      // Incidence rate ratio (log scale): (e1/t1)/(e2/t2); SE = sqrt(1/e1 + 1/e2).
      const e1=+p.e1,t1=+p.t1,e2=+p.e2,t2=+p.t2;
      if([e1,t1,e2,t2].some(isNaN))return null;
      if(e1<=0||e2<=0||t1<=0||t2<=0) return null;    // person-time model needs events>0 both arms
      const lnIRR=Math.log((e1/t1)/(e2/t2)),se=Math.sqrt(1/e1+1/e2);
      return{es:lnIRR,se:se,lo:lnIRR-1.96*se,hi:lnIRR+1.96*se,
        display:`IRR=${Math.exp(lnIRR).toFixed(3)} [${Math.exp(lnIRR-1.96*se).toFixed(3)}, ${Math.exp(lnIRR+1.96*se).toFixed(3)}]`};
    }
    if(type==="AUC"){
      // AUC / C-statistic on the RAW 0–1 scale. Accept an SE, or derive it from a 95% CI.
      const auc=+p.auc;
      if(isNaN(auc)||auc<=0||auc>=1) return null;
      let se=+p.se;
      if(isNaN(se)&&p.lo!==""&&p.lo!=null&&p.hi!==""&&p.hi!=null){ const lo=+p.lo,hi=+p.hi; if(!isNaN(lo)&&!isNaN(hi)&&hi>lo) se=(hi-lo)/(2*1.96); }
      if(isNaN(se)||!(se>0)) return null;
      return{es:auc,se:se,lo:auc-1.96*se,hi:auc+1.96*se,
        display:`AUC=${auc.toFixed(3)} [${(auc-1.96*se).toFixed(3)}, ${(auc+1.96*se).toFixed(3)}]`};
    }
    if(type==="BETA"){
      // Regression coefficient on its native additive scale. SE, or from a 95% CI.
      const beta=+p.beta;
      if(isNaN(beta)) return null;
      let se=+p.se;
      if(isNaN(se)&&p.lo!==""&&p.lo!=null&&p.hi!==""&&p.hi!=null){ const lo=+p.lo,hi=+p.hi; if(!isNaN(lo)&&!isNaN(hi)&&hi>lo) se=(hi-lo)/(2*1.96); }
      if(isNaN(se)||!(se>0)) return null;
      return{es:beta,se:se,lo:beta-1.96*se,hi:beta+1.96*se,
        display:`β=${beta} [${(beta-1.96*se).toFixed(4)}, ${(beta+1.96*se).toFixed(4)}]`};
    }
    if(type==="GENERIC"||type==="GENERIC_LOG"){
      // Pre-computed effect + 95% CI, used verbatim. GENERIC_LOG log-transforms a ratio.
      const est=+p.est,lo=+p.lo,hi=+p.hi;
      if([est,lo,hi].some(isNaN)||hi<lo) return null;
      if(type==="GENERIC_LOG"){
        if(est<=0||lo<=0||hi<=0) return null;
        const lnE=Math.log(est),se=(Math.log(hi)-Math.log(lo))/(2*1.96);
        return{es:lnE,se:se,lo:Math.log(lo),hi:Math.log(hi),
          display:`${est} [${lo}, ${hi}] (ln scale)`};
      }
      const se=(hi-lo)/(2*1.96);
      return{es:est,se:se,lo:lo,hi:hi,display:`${est} [${lo}, ${hi}]`};
    }
  } catch(_){}
  return null;
}

/* Safety: detect when a study's raw data doesn't match its selected effect measure.
   The classic trap is two-arm data (events in each group) analysed as a single-arm
   proportion. Returns an array of {sev,msg,id,author} for the analysis-side gate. */
export function analysisTypeWarnings(studies){
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
export function invNorm(p){
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
export const CONVERSIONS=[
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
export function validateStudy(s){
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
export function findDuplicates(studies){
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
export function checkPoolability(studies){
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
