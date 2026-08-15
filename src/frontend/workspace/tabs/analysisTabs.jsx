/* ════════════ ANALYSIS / FOREST / SENSITIVITY / SUBGROUP TABS ════════════
   Extracted VERBATIM from meta-lab-3-patched.jsx (prompt46 Phase 6g). Holds:
   AnalysisTab, DataBehindAnalysis, ResearchExport, ResultsWriteup, ForestTab,
   SensitivityTab, SubgroupTab. No logic changes — only the imports below were
   added so the moved code resolves identically.

   Keeps using the monolith-derived shared modules: C/btnS/inp/th/tagS from
   ui/styles.js; SectionHeader/InfoBox/HelpTip from ui/primitives.jsx; the
   monolith-own stats copies from monolithStats.js; ES_TYPES + label maps from
   monolithConstants.js; isNonPrimary from referenceParsers.js; interpretResult
   from projectHelpers.js; the precision formatters; ForestPlot/FunnelPlot from
   charts.jsx; the SVG string builders from svgBuilders.js; exportCore +
   exportDialogBridge for the download/export plumbing. */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { alpha as themeAlpha } from "../../theme/tokens.js";
// 108.md §6 — the page-scoped Undo/Redo history. Inert outside a provider, so the
// analysis builder behaves identically in any shell that has not mounted one.
import { useProjectHistory } from "../../history/HistoryContext.jsx";
// 109.md §§30-32 — the Ops compatibility-override policy (the guard itself has no
// off switch; only the documented-override affordance is governable).
import { useOpsGovernance } from "../../featureAccess/opsGovernance.js";
import { useTheme } from "../../theme/ThemeContext.jsx";
import { rasterizeSvg, downloadBlob, downloadText } from "../../components/exportCore.js";
import { fmtNum, fmtES, fmtP, fmtPExpr, fmtPct, fmtI2, fmtWeight, fmtScaled, makeScaledFormatter, normalizePrecision, DECIMAL_OPTIONS } from "../../../research-engine/format/precision.js";
// 116.md §27 (D4) — the ONE outcome-rename path (studies[].outcome + every
// name-keyed analysisSettings map, migrated atomically). Never rewrite an
// outcome string anywhere else.
import { renameOutcome, outcomePairKey } from "../../../research-engine/project-model/renameOutcome.js";
import { isNonPrimary } from "../../../research-engine/import-export/referenceParsers.js";
import { ES_TYPES, DATA_NATURE_LABEL, ADJUST_LABEL, SOURCE_LABEL } from "../../../research-engine/project-model/monolithConstants.js";
import { normalCDF, runMeta, eggersTest, leaveOneOut, trimFill, influenceDiagnostics, subgroupAnalysis, analysisTypeWarnings, CONVERSIONS, checkPoolability, TAU2_METHODS, TAU2_LABELS, poolableStudyView, withPoolableViews, hasUsableEffect } from "../../../research-engine/statistics/monolithStats.js";
// 116.md §47/§50 — the itemized "why is this analysis unavailable" detector. Shared and
// pure; this file only renders its reasons where the blank result panel used to be.
import { pairEligibility, blockedByCompatibilityReasons } from "../../../research-engine/statistics/analysisEligibility.js";
// 86.md P1.17 — studies a reviewer excluded ("exclude from analysis") or archived
// must not pool. Shared predicate so Analysis, GRADE, living-review and public
// synthesis all agree on what is analyzable.
import { isExcludedFromAnalysis } from "../../../research-engine/statistics/studyFilter.js";
// P13 — the meta-regression engine ships in the SAME barrel as subgroupAnalysis
// above, but lands CONCURRENTLY. A namespace import keeps `npm run build` green
// whether or not `metaRegression` is present yet (a missing NAMED export would
// break the bundle); MetaRegression reads it off the namespace at runtime and
// degrades gracefully until the engine is wired in. Once landed it "just works".
import * as MonolithStats from "../../../research-engine/statistics/monolithStats.js";
import { openExportDialog } from "../exportDialogBridge.js";
import { SVG_XML_HEADER, presetTag, liveSvgToString, buildPubForestSVG, esMeasureName } from "../charts/svgBuilders.js";
// 116.md §26/§32 — ONE resolver for every forest surface's text + no-effect authority.
// 117.md §23-§25/§81 — the same resolver now returns the whole PRESENTATION record
// (subtitle/note/column visibility/decimals/bounded geometry), and owns the ONE bounds
// table those geometry overrides are clamped through, at write AND at resolve.
import {
  resolveForestFigure, EMPTY_FOREST_FIGURE, normalizeFigurePresentation,
  clampForestMetric, FOREST_PRESENTATION_BOUNDS, FOREST_METRIC_NAMES, FIGURE_PRESENTATION_KEYS,
} from "../../../research-engine/charts/forestFigureConfig.js";
import { ForestPlot, FunnelPlot } from "../charts/charts.jsx";
import { BubblePlot, buildBubbleSVG } from "../BubblePlot.jsx";
import { C, btnS, inp, th, tagS } from "../ui/styles.js";
import { SectionHeader, InfoBox, HelpTip } from "../ui/primitives.jsx";
import { interpretResult } from "../projectHelpers.js";
import { isCaseRow, publicationIdOf } from "../../../research-engine/extraction/caseSeries.js";
// 107.md §11/§12 — the pre-analysis compatibility check for single-arm proportions and
// its persisted resolutions. The RULE lives in the pure engine; this file only renders
// it and writes the reviewer's choice through the existing updateProject choke point.
import {
  checkProportionCompatibility, applyProportionFilters, activeProportionFilters,
  proportionOverrideStale, buildProportionOverride, describeOverrideCategories,
  overrideDateText, proportionFilterLabel, subgroupGroupLabel,
  proportionExportFields, proportionExportMetaRows,
  UNCLASSIFIED_GROUP_LABEL, UNCLASSIFIED_FILTER, ALL_UNCLASSIFIED_NOTE, PROPORTION_FIELD_LABEL,
} from "../../../research-engine/statistics/proportionCompatibility.js";
import {
  denominatorPopulationLabel, actionStatusLabel, exportedDenominatorCustom,
} from "../../../research-engine/extraction/proportionMeta.js";
// 116.md §52/§53 — the Individual Study Contributions "Columns" menu is driven by the
// SAME registry the extraction field library uses. There is no second catalog here: the
// options are the project's configured extraction fields plus the catalog entries that
// alias a built-in row key (listContributionFields is the ONE seam).
import {
  listContributionFields, contributionFieldsByCategory, resolveContributionColumns,
  contributionCellText, MISSING_VALUE_TEXT, NOT_EXTRACTED_LABEL,
} from "../../../research-engine/extraction/fieldRegistry.js";

/* ════════════ SHARED: OUTCOME-PAIR SCOPING ════════════
   The (outcome|||timepoint) enumeration + its row filter, hoisted out of AnalysisTab
   so every tab that pools pools the SAME rows. SubgroupTab/SensitivityTab used to run
   on the RAW `project.studies` — every outcome at once, with no `isExcludedFromAnalysis`
   — which is the 86.md P1.6 defect `summaryPool.poolPrimaryOutcome` was created to fix
   for the summary views but which was never applied here. 107.md §10 makes it load-
   bearing: grouping proportions by denominator ACROSS different outcomes would compare
   quantities that were never comparable in the first place. */
export function enumerateOutcomePairs(studies){
  const list=Array.isArray(studies)?studies:[];
  const seen=new Set(), pairs=[];
  // 116.md §41/§46 — `hasUsableEffect` extends the old `es!==""&&!isNaN(+es)` predicate
  // to the poolable VIEW, so a PROP row with valid raw events/total (and no manual
  // es/lo/hi backfill) makes its outcome visible to Analysis. Kept in lockstep with
  // runMeta's own row selection (both go through poolableStudyView).
  list.filter(s=>s&&hasUsableEffect(s)&&!isExcludedFromAnalysis(s)).forEach(s=>{
    const oc=(s.outcome||"").trim(), tp=(s.timepoint||"").trim();
    const key=`${oc}|||${tp}`;
    if(!seen.has(key)){ seen.add(key); pairs.push({outcome:oc,timepoint:tp,esType:(s.esType||"").trim(),key}); }
  });
  // prompt32 Task 9 — outcomes are organised by NAME. Append the timepoint, and the
  // effect MEASURE only to disambiguate when the same name appears twice, so
  // duplicate-named outcomes never read as one entry.
  const nameCount={};
  pairs.forEach(p=>{const n=(p.outcome||"(unnamed)").toLowerCase();nameCount[n]=(nameCount[n]||0)+1;});
  pairs.forEach(p=>{
    const base=p.outcome||"(unnamed)";
    const dup=nameCount[base.toLowerCase()]>1;
    p.label=base+(p.timepoint?` @ ${p.timepoint}`:"")+(dup&&p.esType?` · ${p.esType}`:"");
  });
  return pairs;
}

/**
 * 116.md §50 (r2) — EVERY outcome group present in the extraction, including the ones
 * `enumerateOutcomePairs` cannot enumerate because not one of their rows carries (or
 * derives) an effect size. Such an outcome used to vanish from Analysis completely
 * whenever ANOTHER outcome was analysable: no pair, no dropdown entry, no row in the
 * Summary of Findings, and `pairEligibility` was never called for it — the silent
 * disappearance §50 exists to end. Deliberately NOT folded into `enumerateOutcomePairs`:
 * journalSubmission, buildOutcomeSummaryRows and Forest/Sensitivity/Subgroup all depend
 * on that function's "poolable pairs only" contract. Pure + exported for SSR pinning.
 */
export function enumerateAllOutcomeGroups(studies){
  const list=Array.isArray(studies)?studies:[];
  const seen=new Set(), groups=[];
  list.filter(s=>s&&!isExcludedFromAnalysis(s)).forEach(s=>{
    const oc=(s.outcome||"").trim(), tp=(s.timepoint||"").trim();
    const key=`${oc}|||${tp}`;
    if(!seen.has(key)){ seen.add(key); groups.push({outcome:oc,timepoint:tp,key,label:(oc||"(unnamed)")+(tp?` @ ${tp}`:"")}); }
  });
  return groups;
}

export function studiesForPair(studies,pair){
  if(!pair) return [];
  // 116.md §41/§46 — same predicate as enumerateOutcomePairs, and the returned rows are
  // the poolable VIEWS (derived es/lo/hi for raw-data PROP rows), so every consumer —
  // runMeta, the compatibility gate, the contributions/data tables, the exporters —
  // sees one consistent row set. Views are computed, never written back (rows with a
  // stored es come back as the SAME object reference).
  return withPoolableViews((Array.isArray(studies)?studies:[]).filter(s=>{
    if(!s) return false;
    const oc=(s.outcome||"").trim(), tp=(s.timepoint||"").trim();
    return oc===pair.outcome && tp===pair.timepoint && hasUsableEffect(s)&&!isExcludedFromAnalysis(s);
  }));
}

/** 116.md §50 — ALL of a pair's rows (exclusions applied, but NO effect-size predicate):
 *  the eligibility detector must see the very rows whose problems it explains. */
export function allRowsForPair(studies,pair){
  if(!pair) return [];
  return (Array.isArray(studies)?studies:[]).filter(s=>{
    if(!s) return false;
    const oc=(s.outcome||"").trim(), tp=(s.timepoint||"").trim();
    return oc===pair.outcome && tp===pair.timepoint && !isExcludedFromAnalysis(s);
  });
}

/** The persisted proportion filter for one outcome pair (107.md §12 resolution 1). */
export function pairProportionFilter(project,pair){
  const m=project&&project.analysisSettings&&project.analysisSettings.proportionFilters;
  return (pair&&m&&m[pair.key])||null;
}
/** The persisted compatibility override for one outcome pair (107.md §12 resolution 5). */
export function pairProportionOverride(project,pair){
  const m=project&&project.analysisSettings&&project.analysisSettings.proportionOverrides;
  return (pair&&m&&m[pair.key])||null;
}
/** 116.md §26 — the persisted FIGURE-LOCAL labels for one outcome pair
 *  (analysisSettings.figureLabels[pairKey] = {title?, subtitle?, favLow?, favHigh?,
 *  esLabel?, note?} — the 117.md §24 presentation keys share the same entry and are
 *  read through `resolveForestFigure`, never from here).
 *  Absent ⇒ `{}` ⇒ every label falls back to its measure-derived default. These are
 *  figure text ONLY: renaming an outcome is a PROJECT edit (renameOutcome, D4). */
export function pairFigureLabels(project,pair){
  const m=project&&project.analysisSettings&&project.analysisSettings.figureLabels;
  return (pair&&m&&m[pair.key])||EMPTY_FIGURE_LABELS;
}
const EMPTY_FIGURE_LABELS=Object.freeze({});
/** Resolved-figure default for surfaces rendered without a project (tests, storybooks).
 *  117.md §24 — ONE shape, produced by the resolver itself, so a default-prop figure and
 *  a resolved one can never carry different keys. */
const EMPTY_FIGURE_CONFIG=EMPTY_FOREST_FIGURE;
const EMPTY_COLUMNS=Object.freeze([]);
/** 116.md §54 — the OPTIONAL contributions columns chosen for one outcome pair
 *  (analysisSettings.contributionColumns[pairKey] = ['country','xf_ab12cd34']). Scope is
 *  PER PAIR deliberately: two outcomes of one review routinely need different context
 *  (a proportion pair wants Denominator population; a continuous pair wants Mean age).
 *  Absent ⇒ `[]` ⇒ the default table, unchanged. Ids are STORAGE KEYS, never labels. */
export function outcomeContributionColumns(project,outcomeKey){
  const m=project&&project.analysisSettings&&project.analysisSettings.contributionColumns;
  const v=outcomeKey&&m&&m[outcomeKey];
  return Array.isArray(v)?v:EMPTY_COLUMNS;
}
/** The same read, addressed by an outcome PAIR (the shape every tab already holds). */
export function pairContributionColumns(project,pair){
  return outcomeContributionColumns(project,pair&&pair.key);
}
/** 116.md §124 — the persisted synthesis model. ABSENT ⇒ 'random' (byte-compat: a
 *  project that never touched the toggle keeps a blob without the key). */
export function projectModel(project){
  const m=project&&project.analysisSettings&&project.analysisSettings.model;
  return m==="fixed"?"fixed":"random";
}

/** True when this pair is a single-arm proportion analysis — every 107.md §11 gate is
 *  conditioned on it so no other measure changes behaviour. */
export function pairIsProportion(pair,dominantEsType){
  return String((pair&&pair.esType)||dominantEsType||"").trim().toUpperCase()==="PROP";
}

/** The most frequent effect measure across a row set. `enumerateOutcomePairs` copies
 *  `esType` from the FIRST eligible row, which is blank for an imported/converted PROP
 *  outcome whose first row never had the measure set — every §11 gate therefore needs
 *  this fallback, not just AnalysisTab's. Pure + exported so all tabs share one answer. */
export function dominantEsType(rows){
  const types=(Array.isArray(rows)?rows:[]).map(s=>s&&s.esType).filter(Boolean);
  if(!types.length) return "";
  return types.slice().sort((a,b)=>types.filter(t=>t===b).length-types.filter(t=>t===a).length)[0];
}

const NO_PROP_CHECK=Object.freeze({applicable:false,blocking:false,warning:false,infoOnly:false,issues:[],warnings:[],unclassifiedFields:[],propCount:0});

/**
 * 116.md §49 (r2) — an override ONLY ever gates a BLOCKING check, so "stale" splits in
 * two. When something still blocks, the record is genuinely OUT OF DATE: it describes a
 * different estimate set and the reviewer must re-record it (the form is right there).
 * When nothing blocks any more, it is OBSOLETE: there is nothing left to override, the
 * pooled result does not depend on it, and no re-record form renders at all — so the
 * "the estimates have changed … record a new override" copy pointed at a control that
 * does not exist. §116's tier change (category+unclassified: block → warn) drops every
 * pre-116 proportion project straight into this state on upgrade. ONE formula, used by
 * the gate and by the panel, so all four tabs word it identically.
 */
export function proportionOverrideMoot(check,override,stale){
  return !!override&&!!stale&&!(check&&check.blocking);
}

/**
 * 107.md §11/§12 — THE pooling gate, in one place.
 *
 * AnalysisTab owned this derivation privately, so ForestTab and SensitivityTab pooled,
 * drew and EXPORTED exactly the estimate set AnalysisTab refuses to pool. It is pure, so
 * every tab (and the all-outcomes summary table) now derives it from the same function
 * and can never disagree about whether a pool is blocked.
 *
 * `rows` must already be pair-scoped, exclusion-filtered and proportion-filtered; the
 * compatibility check narrows further to the rows runMeta would actually pool.
 */
export function proportionGate(project,pair,rows,domEsType){
  const dom=domEsType===undefined?dominantEsType(rows):domEsType;
  const isPropPair=pairIsProportion(pair,dom);
  const check=isPropPair?checkProportionCompatibility(rows):NO_PROP_CHECK;
  const override=isPropPair?pairProportionOverride(project,pair):null;
  const stale=proportionOverrideStale(override,check);
  const honored=!!override&&!stale;
  const moot=proportionOverrideMoot(check,override,stale);
  return {isPropPair,check,override,stale,honored,moot,
    // Unresolved blocking incompatibility gates the pooled result exactly like a
    // checkPoolability blocker does — 107.md §12 "Do not silently proceed."
    blocked:isPropPair&&check.blocking&&!honored,esType:dom};
}

/**
 * The rows of AnalysisTab's "Summary of findings — all outcomes" table.
 *
 * It used to build its own subset straight from project.studies — no
 * `isExcludedFromAnalysis`, no persisted filter, no compatibility check — so it printed a
 * pooled proportion + CI + I² for an outcome the gate below refuses to pool, and a k that
 * contradicted the tab's own headline. Same helpers, same gate, one place. Pure + exported.
 */
export function buildOutcomeSummaryRows(project,studies,outcomePairs,method,opts){
  return (Array.isArray(outcomePairs)?outcomePairs:[]).map(pr=>{
    const subset=applyProportionFilters(studiesForPair(studies,pr),pairProportionFilter(project,pr));
    const g=proportionGate(project,pr,subset);
    return {pr,k:subset.length,et:g.esType||"",blocked:g.blocked,
      r:g.blocked?null:runMeta(subset,method,opts)};
  });
}

/**
 * 107.md §10/§12 — the rows SubgroupTab hands to `subgroupAnalysis`. For the two new
 * keys the bucket key becomes the DISPLAY label, so a legacy/'' value (→ "Not classified
 * (legacy)") and any unknown hand-edited value can never open a bucket that reads like a
 * real category, and `actionStatus:'unclear'` — which means the ARTICLE said so — stays a
 * bucket of its own. Every other grouping key is passed through untouched (same array
 * reference), so the existing six variables behave exactly as before.
 * Pure + exported: this is the interactive behaviour SSR cannot exercise.
 */
export function groupRowsForSubgroup(studies,groupKey){
  const rows=Array.isArray(studies)?studies:[];
  if(groupKey!=="denominatorPopulation"&&groupKey!=="actionStatus") return rows;
  return rows.map(s=>({...s,[groupKey]:subgroupGroupLabel(groupKey,s&&s[groupKey])}));
}

/**
 * The two grouping keys that are CONSTANT inside an outcome pair, and so became dead
 * buttons when SubgroupTab was pair-scoped (107.md §10): `timepoint` and `outcome`.
 * Grouping by either is the classic, methodologically standard comparison — mortality
 * @30d vs @90d, or one outcome against another — so instead of removing the buttons the
 * two keys deliberately step OUTSIDE the pair:
 *   • timepoint → every sibling pair sharing the selected outcome NAME (all its time points)
 *   • outcome   → every outcome pair in the project
 * `isExcludedFromAnalysis` still applies. The pair's proportion filter does NOT: it is
 * keyed to one pair and would silently drop whole arms of the comparison.
 *
 * @returns {Array<object>|null} null for every other key (stay pair-scoped).
 * Pure + exported: this is the interactive behaviour SSR cannot exercise.
 */
export function crossPairRowsForGrouping(allStudies,pair,groupKey){
  if(!pair||(groupKey!=="timepoint"&&groupKey!=="outcome")) return null;
  // 116.md §41 — same view-aware predicate + views as studiesForPair.
  const base=withPoolableViews((Array.isArray(allStudies)?allStudies:[])
    .filter(s=>s&&hasUsableEffect(s)&&!isExcludedFromAnalysis(s)));
  if(groupKey==="outcome") return base;
  const name=(pair.outcome||"").trim();
  return base.filter(s=>(s.outcome||"").trim()===name);
}

/** Lead of the note that must accompany any cross-pair comparison. */
export const CROSS_PAIR_SCOPE_HEADLINE="This comparison spans outcome pairs.";
/** The rest of that note. Pure + exported so SSR can pin it without a click. */
export function crossPairScopeNote(groupKey,pair,rowCount,pairCount){
  const pairs=`${rowCount} estimates across ${pairCount} outcome pair${pairCount===1?"":"s"}`;
  const what=groupKey==="timepoint"?"time points":"outcomes";
  const lead=groupKey==="timepoint"
    ? `Every time point recorded for “${(pair&&pair.outcome)||"(unnamed)"}” is grouped together — ${pairs} — so the subgroups can actually differ.`
    : `Every outcome in the project is grouped together — ${pairs}. Only compare outcomes measured on the same scale.`;
  return `${lead} The selected pair's proportion filter does not apply here, and pooling different ${what} within a subgroup is your responsibility to justify.`;
}

/* ── pure blob writers for the two persisted resolutions ──────────────────────────
   Pure and idFn-free by construction (no ids, no timestamps generated inside): the
   override's `at` is seeded at the click handler and passed in, because StrictMode
   double-invokes updaters and blob CAS retries re-run them. Empty containers are
   deleted so a project that never used the feature keeps a byte-identical blob. */
export function writeProportionFilter(project,outcomeKey,field,value){
  const as={...((project&&project.analysisSettings)||{})};
  const pf={...(as.proportionFilters||{})};
  const cur={...(pf[outcomeKey]||{})};
  if(value==null||value==="") delete cur[field]; else cur[field]=value;
  if(Object.keys(cur).length) pf[outcomeKey]=cur; else delete pf[outcomeKey];
  if(Object.keys(pf).length) as.proportionFilters=pf; else delete as.proportionFilters;
  return {...project,analysisSettings:as};
}
export function writeProportionOverride(project,outcomeKey,record){
  const as={...((project&&project.analysisSettings)||{})};
  const po={...(as.proportionOverrides||{})};
  if(record) po[outcomeKey]=record; else delete po[outcomeKey];
  if(Object.keys(po).length) as.proportionOverrides=po; else delete as.proportionOverrides;
  return {...project,analysisSettings:as};
}
/**
 * 116.md §26 — write (or clear) the FIGURE-LOCAL labels for one outcome pair.
 * Same shape/discipline as the two writers above: pure, no ids or timestamps
 * generated inside, and an emptied field/entry/container is DELETED so a project
 * that never customised a figure keeps a byte-identical blob.
 * `patch` fields set to '' or null are removed (= "back to the auto default").
 */
export function writeFigureLabels(project,outcomeKey,patch){
  const as={...((project&&project.analysisSettings)||{})};
  const fl={...(as.figureLabels||{})};
  const cur={...(fl[outcomeKey]||{})};
  Object.keys(patch||{}).forEach(f=>{
    const v=patch[f];
    if(v==null||String(v).trim()==="") delete cur[f]; else cur[f]=String(v).trim();
  });
  if(Object.keys(cur).length) fl[outcomeKey]=cur; else delete fl[outcomeKey];
  if(Object.keys(fl).length) as.figureLabels=fl; else delete as.figureLabels;
  const out={...project};
  if(Object.keys(as).length) out.analysisSettings=as; else delete out.analysisSettings;
  return out;
}

/**
 * 117.md §23/§24/§81 — write (or clear) the PRESENTATION half of one figure's record:
 * column visibility, per-figure decimals and the bounded geometry overrides. It shares
 * the `figureLabels[pairKey]` entry with the text labels above deliberately — a figure
 * has ONE configuration record, which is what `renameOutcome` migrates and what
 * `resolveForestFigure` reads — but the two writers touch disjoint key sets, so editing
 * a label can never disturb a column toggle and vice versa.
 *
 * `record` is the WHOLE presentation (one undo step per user action, and
 * "Reset to defaults" is simply `null`). Everything is clamped and defaulted by
 * `normalizeFigurePresentation`, the same function the resolver reads through, so a
 * value can never be stored that the resolver would then refuse. Booleans are stored
 * only when FALSE and out-of-range metrics are dropped, so a project that never opened
 * the panel — or one that reset it — serialises byte-identically to a pre-117 blob.
 *
 * 117.md §25 — there is no branch here that can write an effect size, a confidence
 * limit or a weight. Those stay engine-derived; this record cannot reach them.
 */
export function writeFigurePresentation(project,outcomeKey,record){
  const as={...((project&&project.analysisSettings)||{})};
  const fl={...(as.figureLabels||{})};
  const cur={...(fl[outcomeKey]||{})};
  FIGURE_PRESENTATION_KEYS.forEach(k=>{ delete cur[k]; });
  const rec=normalizeFigurePresentation(record);
  if(rec) FIGURE_PRESENTATION_KEYS.forEach(k=>{ if(rec[k]!==undefined) cur[k]=rec[k]; });
  if(Object.keys(cur).length) fl[outcomeKey]=cur; else delete fl[outcomeKey];
  if(Object.keys(fl).length) as.figureLabels=fl; else delete as.figureLabels;
  const out={...project};
  if(Object.keys(as).length) out.analysisSettings=as; else delete out.analysisSettings;
  return out;
}

/**
 * 116.md §54/§55 — write (or clear) the optional contributions columns of one outcome
 * pair. Same discipline as writeFigureLabels: pure, no ids/timestamps minted inside, and
 * an emptied selection/entry/container is DELETED, so "Restore defaults" leaves a
 * project that never customised the table byte-identical to a pre-116 blob.
 */
export function writeContributionColumns(project,outcomeKey,list){
  const as={...((project&&project.analysisSettings)||{})};
  const cc={...(as.contributionColumns||{})};
  const next=(Array.isArray(list)?list:[]).map(v=>String(v==null?"":v).trim()).filter(Boolean);
  const seen=new Set(); const clean=[];
  for(const id of next){ if(!seen.has(id)){ seen.add(id); clean.push(id); } }
  if(clean.length) cc[outcomeKey]=clean; else delete cc[outcomeKey];
  if(Object.keys(cc).length) as.contributionColumns=cc; else delete as.contributionColumns;
  const out={...project};
  if(Object.keys(as).length) out.analysisSettings=as; else delete out.analysisSettings;
  return out;
}

/**
 * 116.md §124 — persist the synthesis model so AnalysisTab, ForestTab, the
 * exports and the manuscript stop disagreeing. 'random' is stored as ABSENCE:
 * every reader already defaults to random, so a project that never picks 'fixed'
 * (or switches back) serialises byte-identically to a pre-116 blob.
 */
export function writeAnalysisModel(project,value){
  const as={...((project&&project.analysisSettings)||{})};
  if(value==="fixed") as.model="fixed"; else delete as.model;
  const out={...project};
  if(Object.keys(as).length) out.analysisSettings=as; else delete out.analysisSettings;
  return out;
}

/** Display name recorded on an override — null when the shell has no signed-in user. */
export function overrideActorName(user){
  if(!user||typeof user!=="object") return null;
  const n=String(user.name||user.displayName||user.fullName||user.email||"").trim();
  return n||null;
}

/* ── 108.md §6 — the analysis-builder history ops ─────────────────────────────
   Four configuration writes participate in the project-wide Undo/Redo. Each one is
   already a pure function of the current project (the values are trivially
   available at the call site), so the entry carries the PRIOR value rather than a
   snapshot of anything — 108.md §§9-10.

   `readAnalysisConfig` / `applyAnalysisConfig` / `analysisConfigMatches` are pure
   and exported so the executor's whole decision surface is unit-testable without a
   DOM. `applyAnalysisConfig` restores ABSENCE as absence (deleting the key, and the
   container when it empties) so undoing a setting on a project that never used it
   leaves a byte-identical blob.

   EXCLUDED, deliberately: `onApplyPrecisionToAll`. It fans one value out to EVERY
   project the user can edit through N separate blob writes (Workspace.jsx /
   StitchProjectWorkspace), so one entry cannot describe it and one undo cannot
   reverse it. 108.md §6 says not to make an action undoable without understanding
   it; this is that case. */

export const ANALYSIS_CONFIG_TARGETS=Object.freeze({
  TAU2:"tau2Method",
  PRECISION:"analysisPrecision",
  PROP_FILTER:"proportionFilter",
  PROP_OVERRIDE:"proportionOverride",
  // 116.md §26/§124 — two more undoable configuration writes on the same rails.
  FIGURE_LABELS:"figureLabels",
  // 117.md §24/§81 — the figure's PRESENTATION record (column visibility, decimals,
  // bounded geometry). A separate target from FIGURE_LABELS because its value is the
  // whole record rather than one field: a slider drag or a "Reset to defaults" is then
  // ONE undo step, not N.
  FIGURE_PRESENTATION:"figurePresentation",
  MODEL:"model",
  // 116.md §54/§55 — the per-pair optional contributions columns, same rails again.
  CONTRIB_COLUMNS:"contributionColumns",
});

/** Write (or delete) analysisSettings.tau2Method, dropping an emptied container. */
function writeTau2Method(project,value){
  const as={...((project&&project.analysisSettings)||{})};
  if(value==null||value==="") delete as.tau2Method; else as.tau2Method=value;
  const out={...project};
  if(Object.keys(as).length) out.analysisSettings=as; else delete out.analysisSettings;
  return out;
}

/** Write (or delete) the whole analysisPrecision object. */
function writeAnalysisPrecision(project,value){
  const out={...project};
  if(value==null) delete out.analysisPrecision; else out.analysisPrecision={...value};
  return out;
}

/** The value an op currently addresses — `null` means "not set". */
export function readAnalysisConfig(project,op){
  const as=(project&&project.analysisSettings)||{};
  const t=op&&op.target;
  if(t===ANALYSIS_CONFIG_TARGETS.TAU2) return as.tau2Method==null?null:as.tau2Method;
  if(t===ANALYSIS_CONFIG_TARGETS.PRECISION) return (project&&project.analysisPrecision)||null;
  if(t===ANALYSIS_CONFIG_TARGETS.PROP_FILTER){
    const cur=(as.proportionFilters||{})[op.outcomeKey]||{};
    const v=cur[op.field];
    return v==null||v===""?null:v;
  }
  if(t===ANALYSIS_CONFIG_TARGETS.PROP_OVERRIDE) return (as.proportionOverrides||{})[op.outcomeKey]||null;
  // 116.md §26 — one FIELD of one pair's figure labels ('' / missing ⇒ null = "auto").
  if(t===ANALYSIS_CONFIG_TARGETS.FIGURE_LABELS){
    const cur=(as.figureLabels||{})[op.outcomeKey]||{};
    const v=cur[op.field];
    return v==null||v===""?null:v;
  }
  // 117.md §24 — the whole presentation record for one pair, normalized so an
  // all-default figure reads as null (= "nothing persisted") no matter how the entry
  // got there (hand-edited blob, older build, a field left at its default).
  if(t===ANALYSIS_CONFIG_TARGETS.FIGURE_PRESENTATION){
    return normalizeFigurePresentation((as.figureLabels||{})[op.outcomeKey]||null);
  }
  if(t===ANALYSIS_CONFIG_TARGETS.MODEL) return as.model==="fixed"?"fixed":null;
  // 116.md §54 — the whole ordered id list for one pair ('' / missing ⇒ null = defaults).
  if(t===ANALYSIS_CONFIG_TARGETS.CONTRIB_COLUMNS){
    const v=(as.contributionColumns||{})[op.outcomeKey];
    return Array.isArray(v)&&v.length?v:null;
  }
  return null;
}

/** Apply one op to a project. Pure; the SAME writers the forward actions use. */
export function applyAnalysisConfig(project,op){
  const t=op&&op.target;
  if(t===ANALYSIS_CONFIG_TARGETS.TAU2) return writeTau2Method(project,op.value);
  if(t===ANALYSIS_CONFIG_TARGETS.PRECISION) return writeAnalysisPrecision(project,op.value);
  if(t===ANALYSIS_CONFIG_TARGETS.PROP_FILTER) return writeProportionFilter(project,op.outcomeKey,op.field,op.value);
  // 107.md §12 / 108.md §6 — a redo re-instates the SAME consent record, including
  // its ORIGINAL `at` and `by`. That is deliberate: redo restores the state the user
  // just undid, it does not manufacture a fresh act of consent with a new timestamp.
  // The stale-signature logic (proportionOverrideStale) still governs whether that
  // restored record is honoured, so a redo can never silently re-bless data that
  // changed underneath it.
  if(t===ANALYSIS_CONFIG_TARGETS.PROP_OVERRIDE) return writeProportionOverride(project,op.outcomeKey,op.record||null);
  if(t===ANALYSIS_CONFIG_TARGETS.FIGURE_LABELS) return writeFigureLabels(project,op.outcomeKey,{[op.field]:op.value});
  if(t===ANALYSIS_CONFIG_TARGETS.FIGURE_PRESENTATION) return writeFigurePresentation(project,op.outcomeKey,op.value||null);
  if(t===ANALYSIS_CONFIG_TARGETS.MODEL) return writeAnalysisModel(project,op.value);
  if(t===ANALYSIS_CONFIG_TARGETS.CONTRIB_COLUMNS) return writeContributionColumns(project,op.outcomeKey,op.value||[]);
  return project;
}

/** Stable comparison for the §14 precondition (values are strings or plain data). */
function sameConfigValue(a,b){
  if(a===b) return true;
  if(a==null||b==null) return a==null&&b==null;
  try{ return JSON.stringify(a)===JSON.stringify(b); }catch{ return false; }
}

/**
 * analysisConfigMatches(project, op) — 108.md §14/§15. True when the setting still
 * holds the value the entry expects, i.e. nobody (a collaborator, another tab, a
 * server-side module writer) moved it since the action was recorded. The executor
 * refuses otherwise instead of clobbering.
 */
export function analysisConfigMatches(project,op){
  if(!op||!op.target) return false;
  return sameConfigValue(readAnalysisConfig(project,op),op.expect===undefined?null:op.expect);
}

/** Feedback label (108.md §17) — reads as "<label> undone" / "<label> redone". */
export function analysisConfigLabel(op){
  const t=op&&op.target;
  if(t===ANALYSIS_CONFIG_TARGETS.TAU2) return "τ² estimator change";
  if(t===ANALYSIS_CONFIG_TARGETS.PRECISION) return "Decimal places change";
  if(t===ANALYSIS_CONFIG_TARGETS.PROP_FILTER) return "Proportion filter change";
  if(t===ANALYSIS_CONFIG_TARGETS.PROP_OVERRIDE) return "Compatibility override change";
  if(t===ANALYSIS_CONFIG_TARGETS.FIGURE_LABELS) return FIGURE_LABEL_FIELDS[op.field]?`${FIGURE_LABEL_FIELDS[op.field]} change`:"Figure label change";
  if(t===ANALYSIS_CONFIG_TARGETS.FIGURE_PRESENTATION) return FIGURE_PRESENTATION_LABELS[op&&op.field]||"Plot options change";
  if(t===ANALYSIS_CONFIG_TARGETS.MODEL) return "Synthesis model change";
  if(t===ANALYSIS_CONFIG_TARGETS.CONTRIB_COLUMNS) return "Contributions columns change";
  return "Analysis setting change";
}

/** 116.md §26 + 117.md §24 — the editable figure-local TEXT and their human names.
 *  `note` is the figure's footer line (§24 "notes"/"footnotes"); `subtitle` is the
 *  second, smaller line under the title. Both are figure-local like the rest: editing
 *  them never renames the outcome (renameOutcome is the only path that does). */
export const FIGURE_LABEL_FIELDS=Object.freeze({
  title:"Figure title",
  subtitle:"Figure subtitle",
  esLabel:"X-axis label",
  favLow:"Left favours label",
  favHigh:"Right favours label",
  note:"Figure note",
});

/** 117.md §24/§81 — undo-snackbar wording for each Plot-options control. The `field`
 *  on a FIGURE_PRESENTATION op is carried for THIS purpose only: the op's value is
 *  always the whole record, so the label is what tells a reviewer what they undid. */
export const FIGURE_PRESENTATION_LABELS=Object.freeze({
  showCounts:"Events/total column change",
  showWeights:"Weight columns change",
  showPI:"Prediction interval change",
  decimals:"Figure decimals change",
  plotW:"Plot width change",
  nameW:"Study column width change",
  rowGap:"Row spacing change",
  diamondH:"Diamond size change",
  fontScale:"Font scale change",
  reset:"Plot options reset",
});

/* ── 116.md §30 — the shared analysis-config plumbing ─────────────────────────
   AnalysisTab grew this in 108.md. §30 requires the decimal control on EVERY
   Analysis page writing the SAME project setting, and §26 adds two more undoable
   writes, so the executor + recorder live here once instead of in four copies.
   Everything the (asynchronous) executor reads goes through render-assigned refs:
   `project`/`updateProject` are recreated by both shells on every render and a
   closure over either would be stale by the time an undo runs — the §14 hazard. */
export function useAnalysisConfigOps(project,updateProject,opts={}){
  const history=useProjectHistory();
  const historyRef=useRef(history); historyRef.current=history;
  const projectRef=useRef(project); projectRef.current=project;
  const updateProjectRef=useRef(updateProject); updateProjectRef.current=updateProject;
  const onExecuted=useRef(opts.onExecuted); onExecuted.current=opts.onExecuted;
  const registerExecutor=history.registerExecutor;
  useEffect(()=>registerExecutor("analysis.config",(op)=>{
    const cur=projectRef.current;
    const write=updateProjectRef.current;
    if(!cur||typeof write!=="function") return {ok:false,reason:"refused"};
    // Re-validate against the CURRENT project, never the one at record time.
    if(!analysisConfigMatches(cur,op)) return {ok:false,reason:"refused"};
    write(ap=>applyAnalysisConfig(ap,op));
    if(typeof onExecuted.current==="function") onExecuted.current(op);
    return true;
  }),[registerExecutor]);
  const recordConfig=useCallback((undoOp,redoOp)=>{
    historyRef.current.record({
      kind:"analysis.config",
      label:analysisConfigLabel(redoOp),
      entityKey:analysisConfigKey(redoOp),
      undoOp,redoOp,
    });
  },[]);
  /** One `value`-shaped setting: write through the SAME pure writer the executor
   *  uses, then record the prior value as the inverse. No-ops when unchanged. */
  const setConfigValue=useCallback((addr,next)=>{
    const write=updateProjectRef.current;
    if(typeof write!=="function") return false;
    const prev=readAnalysisConfig(projectRef.current,addr);
    if(sameConfigValue(prev,next===undefined?null:next)) return false;
    write(ap=>applyAnalysisConfig(ap,{...addr,value:next}));
    recordConfig({...addr,value:prev,expect:next},{...addr,value:next,expect:prev});
    return true;
  },[recordConfig]);
  const setAnalysisPrecision=useCallback((next)=>
    setConfigValue({target:ANALYSIS_CONFIG_TARGETS.PRECISION},next),[setConfigValue]);
  const setAnalysisModel=useCallback((next)=>
    setConfigValue({target:ANALYSIS_CONFIG_TARGETS.MODEL},next==="fixed"?"fixed":null),[setConfigValue]);
  /* 116.md §27 (D4) — the PROJECT-level outcome rename, on the same undo rails but
     its own executor kind: it rewrites studies[].outcome AND migrates every
     name-keyed analysisSettings map in one atomic pure operation. This is the ONLY
     rename path; a figure-title edit (setFigureLabel above) can never reach it. */
  useEffect(()=>registerExecutor("analysis.outcomeRename",(op)=>{
    const cur=projectRef.current;
    const write=updateProjectRef.current;
    if(!cur||typeof write!=="function") return {ok:false,reason:"refused"};
    const probe=renameOutcome(cur,op.from,op.to,op.timepoint==null?{}:{timepoint:op.timepoint});
    if(!probe.changed) return {ok:false,reason:"refused"};   // someone already moved it
    write(ap=>renameOutcome(ap,op.from,op.to,op.timepoint==null?{}:{timepoint:op.timepoint}).project);
    return true;
  }),[registerExecutor]);
  const renameProjectOutcome=useCallback((from,to,timepoint)=>{
    const write=updateProjectRef.current;
    if(typeof write!=="function") return null;
    const res=renameOutcome(projectRef.current,from,to,timepoint==null?{}:{timepoint});
    if(!res.changed) return res;
    write(ap=>renameOutcome(ap,from,to,timepoint==null?{}:{timepoint}).project);
    historyRef.current.record({
      kind:"analysis.outcomeRename",
      label:"Outcome rename",
      entityKey:`outcomeRename:${outcomePairKey(res.rename.to,timepoint||"")}`,
      undoOp:{from:res.rename.to,to:res.rename.from,timepoint:timepoint==null?null:timepoint},
      redoOp:{from:res.rename.from,to:res.rename.to,timepoint:timepoint==null?null:timepoint},
    });
    return res;
  },[]);
  const setFigureLabel=useCallback((outcomeKey,field,value)=>{
    if(!outcomeKey||!FIGURE_LABEL_FIELDS[field]) return false;
    const v=value==null||String(value).trim()===""?null:String(value).trim();
    return setConfigValue({target:ANALYSIS_CONFIG_TARGETS.FIGURE_LABELS,outcomeKey,field},v);
  },[setConfigValue]);
  /* 116.md §54/§55 — show / hide / reorder / restore-defaults for one pair's optional
     contributions columns. ONE op per user action: the whole ordered list is the value,
     so a reorder is a single undo step rather than N add/remove pairs. An empty list is
     stored as ABSENCE (= the default table), which is what "Restore defaults" writes. */
  const setContributionColumns=useCallback((outcomeKey,list)=>{
    if(!outcomeKey) return false;
    const next=(Array.isArray(list)?list:[]).map(v=>String(v==null?"":v).trim()).filter(Boolean);
    return setConfigValue({target:ANALYSIS_CONFIG_TARGETS.CONTRIB_COLUMNS,outcomeKey},next.length?next:null);
  },[setConfigValue]);
  /* 117.md §24/§81 — one Plot-options change. `patch` is merged into the CURRENT record
     (read off the live ref, never a closure) and the merged whole becomes the op value,
     so a toggle, a slider and "Reset to defaults" (patch === null) are all one undo step
     each. `field` names the control for the snackbar only. A patch value of null/'' for
     a metric clears that single override — normalizeFigurePresentation drops it. */
  const setFigurePresentation=useCallback((outcomeKey,patch,field)=>{
    if(!outcomeKey) return false;
    const addr={target:ANALYSIS_CONFIG_TARGETS.FIGURE_PRESENTATION,outcomeKey,field:field||""};
    let next=null;
    if(patch){
      const cur=readAnalysisConfig(projectRef.current,addr)||{};
      const metrics=patch.metrics?{...(cur.metrics||{}),...patch.metrics}:cur.metrics;
      next=normalizeFigurePresentation({...cur,...patch,metrics});
    }
    return setConfigValue(addr,next);
  },[setConfigValue]);
  return {history,projectRef,recordConfig,setConfigValue,setAnalysisPrecision,setAnalysisModel,setFigureLabel,setFigurePresentation,setContributionColumns,renameProjectOutcome};
}

/** 116.md §29/§30 — the decimal-precision control. ONE component, rendered on every
 *  Analysis page, reading/writing the single project-level `analysisPrecision`. */
export function PrecisionControl({prec,onChange,onApplyAll}){
  if(typeof onChange!=="function") return null;
  const np=normalizePrecision(prec);
  return(<div style={{display:"flex",alignItems:"center",gap:8,marginLeft:8,paddingLeft:8,borderLeft:`1px solid ${themeAlpha(C.brd,'88')}`}}>
    <span style={{fontSize:11,color:C.muted,whiteSpace:"nowrap"}}>Decimal places:</span>
    <select value={np.decimals} onChange={e=>onChange({...np,decimals:Number(e.target.value)})} style={{...inp,width:"auto",fontSize:11,padding:"3px 6px"}}>
      {DECIMAL_OPTIONS.map(d=><option key={d} value={d}>{d}</option>)}
    </select>
    <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:C.muted,cursor:"pointer",whiteSpace:"nowrap"}}>
      <input type="checkbox" checked={np.trailingZeros} onChange={e=>onChange({...np,trailingZeros:e.target.checked})} style={{accentColor:C.acc}}/>trailing zeros
    </label>
    {/* 108.md §6 — "Apply to all" is deliberately NOT recorded: it fans out to
        every project the user can edit, so one entry cannot describe it and one
        undo cannot reverse it (see applyAnalysisConfig's header). */}
    {onApplyAll&&<button onClick={()=>onApplyAll({decimals:np.decimals,trailingZeros:np.trailingZeros})} title="Apply this decimal-places setting to every project you can edit" style={{...btnS("ghost"),fontSize:10,padding:"3px 8px",whiteSpace:"nowrap"}}>Apply to all</button>}
  </div>);
}

/* ── 116.md §26/§28 — the compact inline label editor ─────────────────────────
   Hover/▸click a pencil → a small input in place; Enter commits, Escape cancels,
   blur commits, and the commit goes straight through the persisted-config writer
   so it autosaves, rerenders immediately and lands in Undo. The plot itself keeps
   NO editing chrome and no SVG text node is ever contentEditable (§26). */
export function InlineLabelEdit({label,value,placeholder,onCommit,width=190,hint}){
  const[editing,setEditing]=useState(false);
  const[draft,setDraft]=useState("");
  const start=()=>{ setDraft(value||""); setEditing(true); };
  const commit=()=>{ setEditing(false); if(typeof onCommit==="function") onCommit(draft); };
  const cancel=()=>{ setEditing(false); setDraft(""); };
  return(<div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.muted}}>
    <span style={{whiteSpace:"nowrap"}}>{label}</span>
    {editing?(
      <input autoFocus value={draft} placeholder={placeholder||""} onChange={e=>setDraft(e.target.value)}
        onKeyDown={e=>{ if(e.key==="Enter"){e.preventDefault();commit();} else if(e.key==="Escape"){e.preventDefault();cancel();} }}
        onBlur={commit} aria-label={label}
        style={{...inp,width,fontSize:11,padding:"3px 6px"}}/>
    ):(
      <button onClick={start} title={hint||`Edit ${label}`}
        style={{...btnS("ghost"),fontSize:11,padding:"3px 8px",maxWidth:width+24,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
        {value?value:<span style={{color:C.dim}}>{placeholder||"auto"}</span>} <span aria-hidden="true">✎</span>
      </button>
    )}
    {!editing&&value&&<button onClick={()=>onCommit&&onCommit("")} title="Reset to the automatic label" style={{...btnS("ghost"),fontSize:10,padding:"2px 6px"}}>reset</button>}
  </div>);
}

/* ════════════ 117.md §23-§25 / §81 — FOREST PRESENTATION CONTROLS ════════════
   §23 is explicit that "analysis values" and "visual presentation overrides" must be
   separate, because "the user should not accidentally alter a meta-analysis result
   merely because they moved a label". Everything in this panel is presentation: it
   changes what the figure SHOWS and how big it is, and there is deliberately no
   control here — and no field in the persisted record — that could move an effect
   size, a confidence limit or a weight (§25: statistical data stays engine-linked).

   §24 lists more candidates than a usable panel can carry. The ones that are ALREADY
   derived correctly and would regress if handed to a slider (x-axis range, tick
   spacing, effect-column width, subgroup/summary placement) stay with the engine; see
   FOREST_PRESENTATION_BOUNDS' header for that reasoning. */

/**
 * One bounded numeric control. Holds a DRAFT while typing and commits on blur/Enter,
 * so a five-keystroke edit is one persisted write and one undo entry, not five.
 * Escape reverts. An emptied field clears that single override (back to the default).
 */
export function PlotSizeInput({name,value,onCommit}){
  const b=FOREST_PRESENTATION_BOUNDS[name];
  const[draft,setDraft]=useState(null);
  if(!b) return null;
  const shown=draft==null?(value==null?"":String(value)):draft;
  const commit=()=>{
    const raw=draft;
    setDraft(null);
    if(raw==null) return;
    const trimmed=String(raw).trim();
    const next=trimmed===""?null:clampForestMetric(name,trimmed);
    if(next===value) return;
    onCommit(name,next);
  };
  return(<label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.muted}}>
    <span style={{whiteSpace:"nowrap",minWidth:118}}>{b.label}</span>
    <input type="number" value={shown} min={b.min} max={b.max} step={b.step}
      placeholder={String(b.defaultLive)} aria-label={`${b.label} (${b.min}–${b.max} ${b.unit})`}
      onChange={e=>setDraft(e.target.value)}
      onKeyDown={e=>{ if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur();} else if(e.key==="Escape"){e.preventDefault();setDraft(null);} }}
      onBlur={commit}
      style={{...inp,width:76,fontSize:11,padding:"3px 6px"}}/>
    <span style={{color:C.dim,whiteSpace:"nowrap"}}>{b.min}–{b.max} {b.unit}</span>
  </label>);
}

/** Header for one group of controls inside the panel. */
function PlotOptionsGroup({title,children}){
  return(<div style={{display:"flex",flexDirection:"column",gap:8}}>
    <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1}}>{title}</div>
    <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>{children}</div>
  </div>);
}

/**
 * The "Plot options" disclosure. `figure` is the RESOLVED presentation record and
 * `onChange(patch, field)` merges a patch into it through the undo rails — so this
 * component holds no state of its own beyond in-flight keystrokes, and what it shows
 * is always what the plot beside it is drawing.
 */
export function PlotOptionsPanel({figure,onChange}){
  const fig=figure||EMPTY_FIGURE_CONFIG;
  const metricValue=(name)=>{
    const v=fig.metrics&&fig.metrics[FOREST_PRESENTATION_BOUNDS[name].metric];
    return v==null?null:v;
  };
  const anyOverride=FIGURE_PRESENTATION_KEYS.some(k=>k==="metrics"
    ? Object.keys(fig.metrics||{}).length>0
    : (k==="decimals"?fig.decimals!=null:fig[k]===false));
  const toggle=(field,label)=>(
    <label key={field} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.muted,cursor:"pointer"}}>
      <input type="checkbox" checked={fig[field]!==false} onChange={e=>onChange({[field]:e.target.checked},field)} style={{accentColor:C.acc}}/>{label}
    </label>
  );
  return(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"12px 14px",marginBottom:14,display:"flex",flexDirection:"column",gap:12}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
      <div style={{fontSize:11,fontWeight:700,color:C.acc,letterSpacing:1}}>PLOT OPTIONS — THIS FIGURE ONLY</div>
      <button onClick={()=>onChange(null,"reset")} disabled={!anyOverride}
        title="Clear every plot option on this figure and go back to the defaults"
        style={{...btnS("ghost"),fontSize:10,padding:"3px 8px",opacity:anyOverride?1:0.5}}>Reset to defaults</button>
    </div>
    <PlotOptionsGroup title="COLUMNS">
      {toggle("showCounts","events/total")}
      {toggle("showWeights","weights")}
      {toggle("showPI","prediction interval")}
    </PlotOptionsGroup>
    <PlotOptionsGroup title="PRECISION">
      <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.muted}}>
        <span style={{whiteSpace:"nowrap",minWidth:118}}>Decimal places</span>
        <select value={fig.decimals==null?"":String(fig.decimals)} aria-label="Decimal places for this figure"
          onChange={e=>onChange({decimals:e.target.value===""?null:Number(e.target.value)},"decimals")}
          style={{...inp,width:"auto",fontSize:11,padding:"3px 6px"}}>
          <option value="">Project default</option>
          {DECIMAL_OPTIONS.map(d=><option key={d} value={d}>{d}</option>)}
        </select>
      </label>
    </PlotOptionsGroup>
    <PlotOptionsGroup title="SIZE">
      {FOREST_METRIC_NAMES.map(name=>(
        <PlotSizeInput key={name} name={name} value={metricValue(name)}
          onCommit={(n,v)=>onChange({metrics:{[n]:v}},n)}/>
      ))}
    </PlotOptionsGroup>
    <div style={{fontSize:10.5,color:C.dim,lineHeight:1.5}}>
      These options are saved with the figure and apply to the plot on screen and to every export of it — the publication figure, the report, the journal ZIP and the manuscript. They change presentation only: the pooled estimate, the confidence intervals and the weights stay linked to the analysis engine and are never edited here.
    </div>
  </div>);
}

/* ── 116.md §52-§56 — the configurable Individual Study Contributions table ─────
   §54 is emphatic that the DEFAULT table stays exactly as it is; everything below is
   opt-in. The optional columns come from ONE seam — `listContributionFields(project)`
   in the extraction field registry — so the menu can never drift from what Extraction
   actually records, and there is no second hard-coded catalog anywhere in this file. */

/** The default columns, in order. Exported so a test can pin that §54 is honoured. */
export const CONTRIBUTION_DEFAULT_COLUMNS=Object.freeze(
  ["Study","n","Effect Size","95% CI Lo","95% CI Hi","Weight %","z","p"]);
export const CONTRIBUTIONS_TITLE="INDIVIDUAL STUDY CONTRIBUTIONS";
export const CONTRIBUTIONS_COLUMNS_LABEL="Columns";
/** §Part XIX — a selected column whose field was archived/removed is reported, not crashed on. */
export function unavailableColumnsNote(n){
  return `${n} selected column${n===1?"":"s"} ${n===1?"is":"are"} no longer in this project's extraction schema and ${n===1?"is":"are"} not shown. Un-archive the field to bring ${n===1?"it":"them"} back.`;
}

/**
 * ContributionColumnsControl — the §52 `Columns` / `Add variable` menu.
 * Show / hide (checkbox per field, grouped by the §36 categories), reorder (▲▼ on the
 * chosen list) and restore defaults (§55). Deliberately NOT an Excel clone: no widths,
 * no sorting, no formulas — the purpose is analytical context.
 * `onChange(nextIdList)` is the ONE write; it rides the persisted-config + undo rails.
 */
export function ContributionColumnsControl({project,selected,onChange,open:openProp=false}){
  const[open,setOpen]=useState(!!openProp);
  const groups=useMemo(()=>contributionFieldsByCategory(project),[project]);
  const byId=useMemo(()=>new Map(listContributionFields(project).map(f=>[f.id,f])),[project]);
  const chosen=Array.isArray(selected)?selected:[];
  if(typeof onChange!=="function") return null;
  const toggle=(id)=>onChange(chosen.includes(id)?chosen.filter(x=>x!==id):[...chosen,id]);
  const move=(id,dir)=>{
    const i=chosen.indexOf(id); if(i<0) return;
    const j=i+(dir<0?-1:1); if(j<0||j>=chosen.length) return;
    const next=chosen.slice(); [next[i],next[j]]=[next[j],next[i]]; onChange(next);
  };
  return(<div data-testid="contrib-columns" style={{position:"relative"}}>
    <button data-testid="contrib-columns-toggle" onClick={()=>setOpen(o=>!o)}
      title="Add project extraction fields as extra columns in this table"
      style={{...btnS(open?"primary":"ghost"),fontSize:11,padding:"3px 10px"}}>
      ⊞ {CONTRIBUTIONS_COLUMNS_LABEL}{chosen.length?` (${chosen.length})`:""}
    </button>
    {open&&(<div data-testid="contrib-columns-menu" style={{marginTop:8,border:`1px solid ${themeAlpha(C.acc,'55')}`,background:C.bg,borderRadius:8,padding:12,maxHeight:340,overflowY:"auto"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
        <strong style={{fontSize:11.5,color:C.txt}}>Extra columns for this outcome</strong>
        <span style={{fontSize:11,color:C.muted}}>from the project's extraction fields</span>
        <div style={{flex:1}}/>
        <button data-testid="contrib-columns-reset" onClick={()=>onChange([])} disabled={!chosen.length}
          style={{...btnS("ghost"),fontSize:11}}>Restore defaults</button>
      </div>
      {chosen.length>0&&(<div style={{marginBottom:10}}>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:0.3,color:C.dim,marginBottom:5}}>SHOWN, IN ORDER</div>
        {chosen.map((id,i)=>{
          const f=byId.get(id);
          return(<div key={id} style={{display:"flex",alignItems:"center",gap:6,fontSize:11.5,color:f?C.txt:C.dim,marginBottom:3}}>
            <span style={{flex:1}}>{f?f.label:`${id} (unavailable)`}</span>
            <button onClick={()=>move(id,-1)} disabled={i===0} title="Move left" style={{...btnS("ghost"),fontSize:10,padding:"1px 6px"}}>▲</button>
            <button onClick={()=>move(id,1)} disabled={i===chosen.length-1} title="Move right" style={{...btnS("ghost"),fontSize:10,padding:"1px 6px"}}>▼</button>
            <button onClick={()=>toggle(id)} title="Remove this column" style={{...btnS("ghost"),fontSize:10,padding:"1px 6px",color:C.red}}>✕</button>
          </div>);
        })}
      </div>)}
      {groups.length===0&&<div style={{fontSize:11.5,color:C.muted}}>This project has no extra extraction fields yet — add them in Data Extraction.</div>}
      {groups.map(g=>(
        <div key={g.id} style={{marginBottom:8}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:0.3,color:C.dim,textTransform:"uppercase",marginBottom:4}}>{g.label}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {g.fields.map(f=>{
              const on=chosen.includes(f.id);
              return(<button key={f.id} data-testid={`contrib-col-${f.id}`} onClick={()=>toggle(f.id)}
                style={{...btnS("ghost"),fontSize:11,padding:"3px 9px",borderColor:on?themeAlpha(C.grn,'66'):C.brd,color:on?C.grn:C.txt2}}>
                {on?"✓ ":"＋ "}{f.label}
              </button>);
            })}
          </div>
        </div>
      ))}
    </div>)}
  </div>);
}

/**
 * IndividualContributions — the §52-§56 table. The eight default columns are rendered
 * exactly as before; optional columns are inserted directly after `Study` so the
 * numeric block stays contiguous, and every missing value prints the intentional §56
 * state (`—`, titled "Not extracted") — never `undefined`, `null` or an empty cell.
 * Pure presentation + exported so SSR can pin it without a click.
 */
export function IndividualContributions({result,project,outcomeKey,prec,method,onSetColumns}){
  const selected=useMemo(()=>outcomeContributionColumns(project,outcomeKey),[project,outcomeKey]);
  const{columns,unavailable}=useMemo(()=>resolveContributionColumns(project,selected),[project,selected]);
  if(!result) return null;
  const canEdit=typeof onSetColumns==="function"&&!!outcomeKey;
  return(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,overflowX:"auto"}}>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
      <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1}}>{CONTRIBUTIONS_TITLE}</div>
      <div style={{flex:1}}/>
      {canEdit&&<ContributionColumnsControl project={project} selected={selected} onChange={(next)=>onSetColumns(next)}/>}
    </div>
    {unavailable.length>0&&(
      <div data-testid="contrib-unavailable" style={{fontSize:11,color:C.yel,marginBottom:10,lineHeight:1.5}}>
        ⚠ {unavailableColumnsNote(unavailable.length)}
      </div>
    )}
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
      <thead><tr>
        <th style={{...th,textAlign:"left"}}>Study</th>
        {columns.map(f=><th key={f.id} data-testid={`contrib-th-${f.id}`} style={{...th,textAlign:"left"}}>{f.label}</th>)}
        {CONTRIBUTION_DEFAULT_COLUMNS.slice(1).map(h=><th key={h} style={{...th,textAlign:"right"}}>{h}</th>)}
      </tr></thead>
      <tbody>{result.studies.map(s=>{
        const z2=s._es/s._se,pv=2*(1-normalCDF(Math.abs(z2)));
        return(<tr key={s.id} style={{borderBottom:`1px solid ${C.brd}`}}>
          <td style={{padding:"6px 10px",fontWeight:500}}>{s.author||"Study"}{s.year?` ${s.year}`:""}</td>
          {columns.map(f=>{
            const text=contributionCellText(f,s);
            const missing=text===MISSING_VALUE_TEXT;
            return(<td key={f.id} title={missing?NOT_EXTRACTED_LABEL:undefined}
              style={{padding:"6px 10px",color:missing?C.dim:C.txt2}}>{text}</td>);
          })}
          <td style={{padding:"6px 10px",textAlign:"right",color:C.muted}}>{s.n||MISSING_VALUE_TEXT}</td>
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
        {columns.map(f=><td key={f.id} style={{padding:"8px 10px",color:C.grn}}>{MISSING_VALUE_TEXT}</td>)}
        <td style={{padding:"8px 10px",textAlign:"right",color:C.grn}}>{MISSING_VALUE_TEXT}</td>
        <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:800,color:C.grn}}>{fmtES(result.pES,prec)}</td>
        <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{fmtES(result.lo95,prec)}</td>
        <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{fmtES(result.hi95,prec)}</td>
        <td style={{padding:"8px 10px",textAlign:"right",color:C.grn}}>100%</td>
        <td style={{padding:"8px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{fmtNum(result.z,prec)}</td>
        <td style={{padding:"8px 10px",textAlign:"right",color:result.pval<0.05?C.grn:C.red,fontWeight:700}}>{fmtP(result.pval,prec)}</td>
      </tr></tbody>
    </table>
  </div>);
}

/** Coalescing/diagnostic key — one logical setting per outcome. */
export function analysisConfigKey(op){
  const t=(op&&op.target)||"";
  const k=(op&&op.outcomeKey)||"";
  const f=(op&&op.field)||"";
  return [t,k,f].filter(Boolean).join(":");
}

/* ════════════ PROPORTION COMPATIBILITY PANEL (107.md §11/§12) ════════════
   Renders, in this order: the active filter chips (always, so a filter set in an
   earlier session can always be cleared), a stale-override notice, an honoured
   override banner, the blocking warning card(s) with their per-category filter
   buttons, the four other resolution paths, the override form, and — for a wholly
   legacy outcome — the small non-blocking note that keeps §21 projects working.
   Presentational + exported so the SSR tests can pin the strings. */
const ISSUE_HEADLINE={
  denominatorPopulation:{
    "mixed-categories":"The selected estimates use multiple denominator populations:",
    "category-and-unclassified":"The selected estimates mix a classified denominator population with unclassified legacy records:",
  },
  actionStatus:{
    "mixed-categories":"The selected estimates use multiple action statuses:",
    "category-and-unclassified":"The selected estimates mix a classified action status with unclassified legacy records:",
  },
  denominatorCustom:{
    "mixed-custom-definitions":"The selected estimates describe their custom denominator differently:",
    // 116.md §49 — the warning-tier sibling: one description + undescribed rows.
    "category-and-unclassified":"Some Other/custom estimates have no denominator description yet:",
  },
};
const STUDY_LIST_CAP=6;

/** The active persisted proportion filter as read-only chips, for the outcome bar of
 *  every tab that pools — an exported figure or table must never silently omit estimates.
 *  Renders nothing (and adds no wrapper) when no filter is set. */
export function ProportionFilterChips({filters}){
  const entries=activeProportionFilters(filters);
  if(!entries.length) return null;
  return(<>{entries.map(([field,value])=>(
    <span key={field} style={tagS("blue")}>
      {PROPORTION_FIELD_LABEL[field]}: {proportionFilterLabel(field,value)}
    </span>
  ))}</>);
}

/** Where a reviewer resolves a block they cannot resolve on the tab they are looking at. */
export const PROP_RESOLVE_HINT="Resolve this on the Meta-Analysis tab — filter to one category, stratify on the Subgroup tab, correct the extraction metadata, exclude the estimates, or record an explicit override there.";

/** 116.md §49 (r2) — where an obsolete override record is removed, for the compact
 *  mounts that render the banner but are passed no `onClearOverride`. */
export const PROP_OVERRIDE_CLEAR_HINT="Remove the obsolete override record on the Meta-Analysis tab.";

/** `compact` is the read-only variant ForestTab/SensitivityTab render: the warning and the
 *  honoured/stale banners, but no filter chips (their outcome bar already shows them), no
 *  per-category filter buttons and no override form — those live on the Meta-Analysis tab. */
export function ProportionCompatibilityPanel({check,filters,override,stale,moot:mootProp,onSetFilter,onClearFilter,onRecordOverride,onClearOverride,compact}){
  const[note,setNote]=useState("");
  /* 109.md §§30-32 — the two Ops override-policy knobs. Both resolve to the shipped
     defaults on the first render and under renderToStaticMarkup, so the panel is
     byte-identical at defaults.
       allowCompatibilityOverride OFF → the override FORM disappears for NEW analyses.
         An override already recorded on this outcome is still honoured and still
         clearable ("analyses that already carry an override are never retroactively
         altered"), and the warning itself never goes away — the guard has no off
         switch (§31, catalogue rationale).
       requireOverrideRationale ON   → the rationale stops being optional. Enforced
         here in the UI; the stored record shape is unchanged. */
  const opsGov=useOpsGovernance();
  const overrideAllowed=opsGov.allowCompatibilityOverride!==false;
  const rationaleRequired=opsGov.requireOverrideRationale===true;
  const rationaleMissing=rationaleRequired&&!note.trim();
  const c=check||{applicable:false,blocking:false,infoOnly:false,issues:[]};
  const filterEntries=compact?[]:activeProportionFilters(filters);
  const honored=!!override&&!stale;
  /* 116.md §49 (r2) — the two tiers are per-FIELD, so an outcome can carry a blocking
     issue on one field and a warning on another at the same time. While the blocking
     issue hides the result, the warning card must not claim the pool proceeded. */
  const poolBlocked=!!c.blocking&&!honored;
  /* 116.md §49 (r2) — the gate passes this in; recomputed from the SAME pure formula
     when a caller does not, so the panel and `proportionGate` can never disagree. */
  const moot=mootProp===undefined?proportionOverrideMoot(c,override,stale):!!mootProp;
  if(!c.applicable&&!filterEntries.length&&!override) return null;

  return(<div style={{marginBottom:16,display:"flex",flexDirection:"column",gap:8}}>

    {/* ── ACTIVE FILTERS (resolution 1) — visible whenever set, incl. after reopen ── */}
    {filterEntries.length>0&&(
      <div style={{background:C.card,border:`1px solid ${themeAlpha(C.acc,'44')}`,borderLeft:`3px solid ${C.acc}`,borderRadius:8,padding:"9px 14px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={{fontSize:10,fontWeight:700,color:C.acc,letterSpacing:0.8}}>ESTIMATES FILTERED</span>
        {filterEntries.map(([field,value])=>(
          <span key={field} style={{...tagS("blue"),gap:6}}>
            {PROPORTION_FIELD_LABEL[field]}: {proportionFilterLabel(field,value)}
            {onClearFilter&&(
              <button onClick={()=>onClearFilter(field)} title={`Clear the ${PROPORTION_FIELD_LABEL[field]} filter`}
                aria-label={`Clear the ${PROPORTION_FIELD_LABEL[field]} filter`}
                style={{background:"transparent",border:"none",color:"inherit",cursor:"pointer",fontSize:12,lineHeight:1,padding:0}}>×</button>
            )}
          </span>
        ))}
        <span style={{fontSize:11,color:C.muted}}>Only the matching estimates are pooled below.</span>
      </div>
    )}

    {/* ── STALE OVERRIDE — never silently honoured, never silently deleted ──
        116.md §49 (r2) — split on whether the check STILL BLOCKS. A moot record must
        not claim "the estimates have changed" (in the upgrade case only the tier policy
        changed) nor point at an override form that does not render when !c.blocking. */}
    {override&&stale&&(
      <div style={{background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'66')}`,borderLeft:`4px solid ${C.yel}`,borderRadius:8,padding:"11px 16px"}}>
        {moot?(
          <div style={{fontSize:12,color:C.txt,lineHeight:1.6}}>
            <strong style={{color:C.yel}}>⚠ Recorded override no longer applies. </strong>
            A compatibility override was recorded {overrideDateText(override.at)||"earlier"}
            {describeOverrideCategories(override)?` (${describeOverrideCategories(override)})`:""}. This outcome no longer has a
            blocking incompatibility, so there is nothing to override — the result below does <strong>not</strong> depend on this record.
          </div>
        ):(
          <div style={{fontSize:12,color:C.txt,lineHeight:1.6}}>
            <strong style={{color:C.yel}}>⚠ Recorded override is out of date. </strong>
            A compatibility override was recorded {overrideDateText(override.at)||"earlier"} for a different set of estimates
            {describeOverrideCategories(override)?` (${describeOverrideCategories(override)})`:""}. The estimates have changed since,
            so it is <strong>not</strong> being applied — review the warning below and record a new override if you still intend to pool.
          </div>
        )}
        {onClearOverride&&(
          <button onClick={onClearOverride} style={{...btnS("ghost"),fontSize:11,marginTop:8}}>{moot?"Remove the obsolete override record":"Clear the stale override"}</button>
        )}
        {/* The compact mounts (Forest/Sensitivity) carry no clear affordance, so a moot
            record would otherwise leave the reader a banner and zero actions. */}
        {!onClearOverride&&moot&&(
          <div style={{marginTop:6,fontSize:11,color:C.muted,lineHeight:1.6}}>{PROP_OVERRIDE_CLEAR_HINT}</div>
        )}
      </div>
    )}

    {/* ── HONOURED OVERRIDE — persistent, survives refresh (it is in the blob) ── */}
    {honored&&(
      <div style={{background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'66')}`,borderLeft:`4px solid ${C.yel}`,borderRadius:8,padding:"11px 16px"}}>
        <div style={{fontSize:12,color:C.txt,lineHeight:1.6}}>
          <strong style={{color:C.yel}}>⚠ Compatibility warning overridden{override.at?` ${overrideDateText(override.at)}`:""}: </strong>
          {describeOverrideCategories(override)}. These estimates may not measure the same quantity — state the override in your methods.
          {override.by?<span style={{color:C.muted}}> Recorded by {override.by}.</span>:null}
        </div>
        {override.note&&(
          <div style={{marginTop:6,fontSize:12,color:C.muted,fontStyle:"italic",lineHeight:1.6}}>Rationale: {override.note}</div>
        )}
        {onClearOverride&&(
          <button onClick={onClearOverride} style={{...btnS("ghost"),fontSize:11,marginTop:8}}>Clear override</button>
        )}
      </div>
    )}

    {/* ── BLOCKING WARNING CARDS ── */}
    {!honored&&c.issues.map((issue)=>{
      const headline=(ISSUE_HEADLINE[issue.field]&&ISSUE_HEADLINE[issue.field][issue.kind])
        ||`The selected estimates disagree on ${issue.fieldLabel.toLowerCase()}:`;
      return(
        <div key={issue.field} style={{background:"var(--t-red-bg)",border:`1px solid ${C.red}`,borderLeft:`4px solid ${C.red}`,borderRadius:8,padding:"12px 16px"}}>
          <div style={{fontSize:12,fontWeight:700,color:C.red,marginBottom:6}}>⛔ Incompatible {issue.fieldLabel.toLowerCase()}</div>
          <div style={{fontSize:12,color:C.txt,lineHeight:1.6}}>{headline}</div>
          <ul style={{margin:"8px 0 6px",paddingLeft:20,fontSize:12,color:C.txt,lineHeight:1.7}}>
            {issue.values.map((v)=>(
              <li key={v.value||"__unclassified__"}>
                <strong>{v.label}</strong>: {v.count} estimate{v.count===1?"":"s"}
                {v.studies.length?(<span style={{color:C.muted}}> — {v.studies.slice(0,STUDY_LIST_CAP).join(", ")}{v.studies.length>STUDY_LIST_CAP?`, +${v.studies.length-STUDY_LIST_CAP} more`:""}</span>):null}
              </li>
            ))}
          </ul>
          <div style={{fontSize:11,color:C.muted,lineHeight:1.6}}>
            {issue.totalAffected} estimate{issue.totalAffected===1?"":"s"} affected. These proportions may not estimate the same quantity.
          </div>
          {onSetFilter&&(
            <div style={{marginTop:10,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:11,color:C.muted}}>Filter to one:</span>
              {issue.values.filter((v)=>!(issue.field==="denominatorCustom"&&!v.value)).map((v)=>(
                <button key={v.value||"__unclassified__"} onClick={()=>onSetFilter(issue.field,v.value||UNCLASSIFIED_FILTER)}
                  style={{...btnS("ghost"),fontSize:11,padding:"4px 10px"}}>Only {v.label}</button>
              ))}
            </div>
          )}
        </div>
      );
    })}

    {/* ── 116.md §49 — WARNING CARDS (mid-classification). ONE real category mixed with
        unclassified rows no longer blocks: the pool PROCEEDS, and this advisory names
        the unclassified count. The unclassified rows keep their OWN line — they are
        never merged into (or counted as) a category. ── */}
    {(c.warnings||[]).map((issue)=>{
      const headline=(ISSUE_HEADLINE[issue.field]&&ISSUE_HEADLINE[issue.field][issue.kind])
        ||`Some selected estimates are not classified for ${issue.fieldLabel.toLowerCase()}:`;
      return(
        <div key={`warn-${issue.field}`} data-testid={`prop-warning-${issue.field}`}
          style={{background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'66')}`,borderLeft:`4px solid ${C.yel}`,borderRadius:8,padding:"12px 16px"}}>
          <div style={{fontSize:12,fontWeight:700,color:C.yel,marginBottom:6}}>{poolBlocked?"⚠ Unclassified estimates":"⚠ Pooled with unclassified estimates"}</div>
          <div style={{fontSize:12,color:C.txt,lineHeight:1.6}}>{headline}</div>
          <ul style={{margin:"8px 0 6px",paddingLeft:20,fontSize:12,color:C.txt,lineHeight:1.7}}>
            {issue.values.map((v)=>(
              <li key={v.value||"__unclassified__"}>
                <strong>{v.label}</strong>: {v.count} estimate{v.count===1?"":"s"}
                {v.studies.length?(<span style={{color:C.muted}}> — {v.studies.slice(0,STUDY_LIST_CAP).join(", ")}{v.studies.length>STUDY_LIST_CAP?`, +${v.studies.length-STUDY_LIST_CAP} more`:""}</span>):null}
              </li>
            ))}
          </ul>
          <div style={{fontSize:11,color:C.muted,lineHeight:1.6}}>
            {issue.unclassifiedCount} of {issue.totalAffected} {poolBlocked?"eligible":"pooled"} estimate{issue.totalAffected===1?"":"s"} {issue.unclassifiedCount===1?"is":"are"} not classified —
            {poolBlocked
              ?" they will pool once the incompatibility above is resolved, so confirm they estimate the same quantity."
              :" the pool proceeds, but confirm they estimate the same quantity."} Classify them in Data Extraction, or filter to one group.
          </div>
          {onSetFilter&&(
            <div style={{marginTop:10,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:11,color:C.muted}}>Filter to one:</span>
              {issue.values.filter((v)=>!(issue.field==="denominatorCustom"&&!v.value)).map((v)=>(
                <button key={v.value||"__unclassified__"} onClick={()=>onSetFilter(issue.field,v.value||UNCLASSIFIED_FILTER)}
                  style={{...btnS("ghost"),fontSize:11,padding:"4px 10px"}}>Only {v.label}</button>
              ))}
            </div>
          )}
        </div>
      );
    })}

    {/* ── COMPACT: point at the tab that owns the resolutions ── */}
    {compact&&!honored&&c.blocking&&(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"10px 14px",fontSize:11,color:C.muted,lineHeight:1.6}}>
        {PROP_RESOLVE_HINT}
      </div>
    )}

    {/* ── THE OTHER RESOLUTION PATHS (107.md §12) ── */}
    {!compact&&!honored&&c.blocking&&(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"12px 16px"}}>
        <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:0.8,marginBottom:8}}>OTHER WAYS TO RESOLVE THIS</div>
        <ul style={{margin:0,paddingLeft:20,fontSize:12,color:C.muted,lineHeight:1.8}}>
          <li><strong style={{color:C.txt}}>Group by the variable instead</strong> — the Subgroup tab can stratify by denominator population or action status and report the between-group test.</li>
          <li><strong style={{color:C.txt}}>Correct the extraction metadata</strong> — open the estimate in Data Extraction and set its denominator population / action status if it was recorded wrongly or never classified.</li>
          <li><strong style={{color:C.txt}}>Exclude the problematic estimates</strong> — untick “include in analysis” on those rows in Data Extraction; they stay extracted but leave every pool.</li>
        </ul>
        {onRecordOverride&&overrideAllowed&&(
          <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.brd}`}}>
            <div style={{fontSize:11,fontWeight:700,color:C.yel,letterSpacing:0.8,marginBottom:6}}>OR RECORD AN EXPLICIT OVERRIDE</div>
            <div style={{fontSize:11,color:C.muted,marginBottom:8,lineHeight:1.6}}>
              Only if combining them is scientifically intended. The override is stored with the analysis, shown every time this outcome is opened, and exported with the reproducibility configuration.
            </div>
            <textarea value={note} onChange={(e)=>setNote(e.target.value)} rows={2}
              placeholder={rationaleRequired?"Rationale (required) — why these estimates measure the same quantity":"Rationale (optional) — why these estimates measure the same quantity"}
              aria-label="Override rationale" aria-required={rationaleRequired?"true":undefined}
              style={{...inp,fontSize:12,resize:"vertical",marginBottom:8}}/>
            <button onClick={()=>{if(rationaleMissing) return;onRecordOverride(note);setNote("");}}
              disabled={rationaleMissing} data-testid="proportion-override-record"
              title={rationaleMissing?"A written rationale is required for a compatibility override":undefined}
              style={{...btnS("ghost"),fontSize:11,color:C.red,borderColor:themeAlpha(C.red,'55'),opacity:rationaleMissing?0.5:1,cursor:rationaleMissing?"not-allowed":"pointer"}}>
              Pool anyway (record override)
            </button>
          </div>
        )}
        {/* 109.md §32 — policy OFF. Say so plainly rather than leaving a warning with
            no visible way forward; the other three resolutions above still apply. */}
        {onRecordOverride&&!overrideAllowed&&(
          <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.brd}`,fontSize:11,color:C.muted,lineHeight:1.6}}
            data-testid="proportion-override-disabled">
            Recording a compatibility override is disabled for this installation. Resolve the incompatibility using one of the options above.
          </div>
        )}
      </div>
    )}

    {/* ── ALL-LEGACY NOTE — non-blocking, the 107.md §21 regression guard ── */}
    {c.infoOnly&&(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderLeft:`3px solid ${C.dim}`,borderRadius:6,padding:"8px 12px",fontSize:11,color:C.muted,lineHeight:1.6}}>
        <strong style={{color:C.txt}}>{UNCLASSIFIED_GROUP_LABEL}.</strong> {ALL_UNCLASSIFIED_NOTE}
      </div>
    )}
  </div>);
}

/**
 * 116.md §50 — the itemized "why is this analysis unavailable" list. Replaces the blank
 * result panel's single generic line with specific, counted reasons ("3 studies are
 * missing total sample size."). Presentational + exported so SSR tests pin the strings;
 * the reasons themselves come from the pure analysisEligibility module.
 */
export function AnalysisEligibilityNotice({reasons,title}){
  const list=(Array.isArray(reasons)?reasons:[]).filter(Boolean);
  if(!list.length) return null;
  return(
    <div data-testid="analysis-eligibility" style={{marginTop:14,textAlign:"left",display:"inline-block",background:C.bg,border:`1px solid ${C.brd}`,borderRadius:8,padding:"12px 16px"}}>
      <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:0.8,marginBottom:6}}>{title||"WHY THIS ANALYSIS IS UNAVAILABLE"}</div>
      <ul style={{margin:0,paddingLeft:18,fontSize:12,color:C.txt,lineHeight:1.8}}>
        {list.map((r,i)=><li key={`${r.code}-${i}`}>{r.message}</li>)}
      </ul>
    </div>
  );
}

/* ════════════ TAB: ANALYSIS ════════════ */
export function AnalysisTab({project,updateProject,onApplyPrecisionToAll,currentUser}){
  const studies=Array.isArray(project&&project.studies)?project.studies:[];
  // 116.md §124 — the model is PERSISTED (absent ⇒ 'random'), so ForestTab, the
  // exports and the manuscript can no longer show three different models at once.
  const method=projectModel(project);
  // RoadMap/2.md — opt-in τ² estimator (DerSimonian–Laird default keeps existing results).
  // PERSISTED to the project so every pooled view (forest diamond, sensitivity, subgroup,
  // write-up) uses the SAME estimator — otherwise tabs would show contradicting CIs.
  const[localTau2,setLocalTau2]=useState("DL");
  const tau2Method=(project&&project.analysisSettings&&project.analysisSettings.tau2Method)||localTau2;

  /* ── 108.md §6 / 116.md §30 — the shared history plumbing (useAnalysisConfigOps). */
  const cfg=useAnalysisConfigOps(project,updateProject,{onExecuted:(op)=>{
    // The τ² select prefers the persisted value and falls back to this local mirror,
    // so restoring an ABSENT persisted value without restoring the mirror would leave
    // the control showing the post-action estimator.
    if(op.target===ANALYSIS_CONFIG_TARGETS.TAU2&&typeof op.localTau2==="string") setLocalTau2(op.localTau2);
  }});
  const{projectRef,recordConfig,setAnalysisPrecision,setAnalysisModel,setContributionColumns}=cfg;
  const setMethod=(m)=>{ setAnalysisModel(m); };

  const setTau2Method=(v)=>{
    const prev=readAnalysisConfig(projectRef.current,{target:ANALYSIS_CONFIG_TARGETS.TAU2});
    const prevLocal=localTau2;
    setLocalTau2(v);
    if(!updateProject) return;
    updateProject(ap=>({...ap,analysisSettings:{...(ap.analysisSettings||{}),tau2Method:v}}));
    if(prev===v) return;
    recordConfig(
      {target:ANALYSIS_CONFIG_TARGETS.TAU2,value:prev,localTau2:prevLocal,expect:v},
      {target:ANALYSIS_CONFIG_TARGETS.TAU2,value:v,localTau2:v,expect:prev},
    );
  };
  const[showAudit,setShowAudit]=useState(false);
  const[forceShow,setForceShow]=useState(false);
  const[selectedKey,setSelectedKey]=useState("");

  // ── Outcome / time-point selector ─────────────────────────────────────────
  const outcomePairs=useMemo(()=>enumerateOutcomePairs(studies),[studies]);

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

  // 107.md §12 resolution 1 — the persisted per-pair proportion filter is applied HERE,
  // before poolability, the compatibility check and runMeta, so every number on the tab
  // describes the same estimate set. No filter → applyProportionFilters returns the very
  // same array, so a project that never used the feature is unchanged.
  const proportionFilters=pairProportionFilter(project,activeOutcome);
  const filteredStudies=useMemo(
    ()=>applyProportionFilters(studiesForPair(studies,activeOutcome),proportionFilters),
    [studies,activeOutcome,proportionFilters]);

  const pool=useMemo(()=>checkPoolability(filteredStudies),[filteredStudies]);
  const result=useMemo(()=>runMeta(filteredStudies,method,{tau2Method}),[filteredStudies,method,tau2Method]);
  const valid=filteredStudies;
  const esType=useMemo(()=>dominantEsType(valid),[valid]);
  const prec = project?.analysisPrecision;
  const interp=useMemo(()=>interpretResult(result,esType,filteredStudies,prec),[result,esType,filteredStudies,prec]);
  const typeWarn=useMemo(()=>analysisTypeWarnings(filteredStudies),[filteredStudies]);
  // The estimator actually used (may differ from the request if it fell back to DL).
  const usedTau2=result?.tau2Method||tau2Method;
  const tauName=TAU2_LABELS[usedTau2]||"DerSimonian–Laird";
  const methodLabel=method==="random"?`Random-effects (${tauName})`:"Fixed-effect (inverse-variance)";

  // ── 107.md §11/§12 — proportion compatibility ─────────────────────────────
  // Gated on the PAIR's measure (not the filtered set's) so a filter that empties the
  // pool cannot hide the chip that clears it. Nothing below fires for any other measure.
  // Derived by the SHARED gate so Forest/Sensitivity/the summary table cannot disagree.
  const gate=useMemo(()=>proportionGate(project,activeOutcome,filteredStudies,esType),
    [project,activeOutcome,filteredStudies,esType]);
  const{isPropPair,check:propCheck,override:propOverride,stale:propStale,moot:propMoot,honored:propHonored,blocked:propBlocked}=gate;

  // 116.md §50 — the itemized eligibility verdict for the CURRENT scope: the selected
  // pair's rows (no effect-size predicate — the problem rows must be visible to it), or
  // every non-archived row when no outcome is enumerable at all.
  const eligibility=useMemo(()=>{
    if(activeOutcome) return pairEligibility(allRowsForPair(studies,activeOutcome));
    if(outcomePairs.length===0) return pairEligibility(studies);
    return null;
  },[studies,activeOutcome,outcomePairs.length]);

  // 116.md §50 (r2) — outcomes with ZERO usable rows never reach `outcomePairs`, so the
  // selector, the Summary of Findings table and the verdict above all skipped them: as
  // soon as one other outcome was analysable they left no trace on this tab at all.
  // Name each one with its own itemized reasons. When NOTHING enumerates, the
  // whole-project verdict above already covers every row, so this stays empty.
  const unanalyzableGroups=useMemo(()=>{
    if(!outcomePairs.length) return [];
    const keys=new Set(outcomePairs.map(p=>p.key));
    return enumerateAllOutcomeGroups(studies)
      .filter(g=>!keys.has(g.key))
      .map(g=>({...g,eligibility:pairEligibility(allRowsForPair(studies,g))}));
  },[studies,outcomePairs]);

  const outcomeKey=activeOutcome?activeOutcome.key:"";
  const setProportionFilter=(field,value)=>{
    if(!updateProject||!outcomeKey) return;
    const addr={target:ANALYSIS_CONFIG_TARGETS.PROP_FILTER,outcomeKey,field};
    const prev=readAnalysisConfig(projectRef.current,addr);
    const next=(value==null||value==="")?null:value;   // writeProportionFilter deletes these
    updateProject(ap=>writeProportionFilter(ap,outcomeKey,field,value));
    if(prev===next) return;
    recordConfig({...addr,value:prev,expect:next},{...addr,value:next,expect:prev});
  };
  const recordProportionOverride=(note)=>{
    if(!updateProject||!outcomeKey) return;
    // The timestamp is seeded HERE, at the event-handler call site — never inside the
    // updater, which StrictMode double-invokes and the blob CAS retries re-run.
    const rec=buildProportionOverride(propCheck,{at:new Date().toISOString(),by:overrideActorName(currentUser),note});
    const addr={target:ANALYSIS_CONFIG_TARGETS.PROP_OVERRIDE,outcomeKey};
    const prev=readAnalysisConfig(projectRef.current,addr);
    updateProject(ap=>writeProportionOverride(ap,outcomeKey,rec));
    recordConfig({...addr,record:prev,expect:rec},{...addr,record:rec,expect:prev});
  };
  const clearProportionOverride=()=>{
    if(!updateProject||!outcomeKey) return;
    const addr={target:ANALYSIS_CONFIG_TARGETS.PROP_OVERRIDE,outcomeKey};
    const prev=readAnalysisConfig(projectRef.current,addr);
    updateProject(ap=>writeProportionOverride(ap,outcomeKey,null));
    if(!prev) return;                                  // nothing was documented
    recordConfig({...addr,record:prev,expect:null},{...addr,record:null,expect:prev});
  };

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
          {/* 116.md §41 — count usable effects through the derived view too. */}
          Showing {filteredStudies.length} of {studies.filter(s=>hasUsableEffect(s)).length} studies with an ES. The others belong to different outcomes and are excluded from this pool.
        </div>
      )}
      {(()=>{
        // Same-cohort (unit-of-analysis) detection within the selected outcome.
        // 106.md — CASES of one publication are deliberately several rows sharing an
        // author+year, and for a patient-level review pooling them IS the design. They
        // are reported separately, and only as a clustering caveat: seven patients from
        // one report are not seven independent studies, but nor are they a duplicate.
        const seen={}, dups=[], caseSeriesPubs=new Set();
        filteredStudies.forEach(s=>{
          if(isCaseRow(s)){ caseSeriesPubs.add(publicationIdOf(s)); return; }
          const key=((s.author||"").trim().toLowerCase()+"|"+(s.year||"")).replace(/\s+/g," ");
          if(!key||key==="|") return;
          seen[key]=(seen[key]||0)+1;
          if(seen[key]===2) dups.push((s.author||"?")+(s.year?" "+s.year:""));
        });
        const nCases=filteredStudies.filter(isCaseRow).length;
        if(!dups.length&&!nCases) return null;
        return (
          <div style={{marginTop:10,background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'44')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"9px 12px",fontSize:12,color:C.txt,lineHeight:1.6}}>
            {dups.length?(<>
              <strong style={{color:C.yel}}>⚠ Possible unit-of-analysis issue.</strong> {dups.join(", ")} appear{dups.length===1?"s":""} more than once for this outcome. If these are multiple arms or time-points from the <em>same cohort</em>, pooling them as independent studies double-counts participants. Combine arms, pick one time-point, or use a single estimate per cohort.
            </>):null}
            {nCases?(<div style={dups.length?{marginTop:6}:undefined}>
              <strong style={{color:C.yel}}>⚠ Clustered observations.</strong> {nCases} of these {nCases===1?"is an individual case":"are individual cases"} from {caseSeriesPubs.size} case-series publication{caseSeriesPubs.size===1?"":"s"}. Cases from one report share a centre, protocol and reporting bias, so pooling them as fully independent observations understates uncertainty — report the publication and case counts separately, and prefer a clustered or multilevel model.
            </div>):null}
          </div>
        );
      })()}
    </div>

    {/* 116.md §50 (r2) — OUTCOMES THAT CANNOT BE ANALYSED AT ALL. Not selectable (they
        have no poolable row to select), so they are reported here by name with the same
        itemized reasons the selected outcome would get. Nothing renders when every
        outcome enumerates, so an ordinary project's markup is unchanged. */}
    {unanalyzableGroups.length>0&&(
      <div data-testid="unanalyzable-outcomes" style={{marginBottom:16,display:"flex",flexDirection:"column",gap:8,alignItems:"flex-start"}}>
        {unanalyzableGroups.map(g=>(
          <AnalysisEligibilityNotice key={g.key} title={`WHY “${g.label}” CANNOT BE ANALYSED`} reasons={g.eligibility.reasons}/>
        ))}
      </div>
    )}

    {/* SUMMARY OF FINDINGS (all outcomes — only shown when >1 outcome) */}
    {outcomePairs.length>1&&(()=>{
      try{
        // 107.md §10/§11/§12 — built by the shared helper + the shared gate.
        const rows=buildOutcomeSummaryRows(project,studies,outcomePairs,method,{tau2Method}).map(row=>{
          const tt=ES_TYPES[row.et]||{};const isLog=!!tt.log,isProp=row.et==="PROP";
          const bt=x=>isLog?Math.exp(x):isProp?(()=>{const e=Math.exp(x);return e/(1+e);})():x;
          const dv=makeScaledFormatter({isLog,isProp},prec);   // 116.md §31 — centralized, honours trailingZeros
          return {...row,dv};
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
                {rows.map(({pr,r,et,dv,k,blocked})=>(
                  <tr key={pr.key} style={{borderBottom:`1px solid ${C.brd}`,cursor:"pointer",background:pr.key===effectiveKey?`${themeAlpha(C.acc,'10')}`:"transparent"}} onClick={()=>setSelectedKey(pr.key)}>
                    <td style={{padding:"6px 10px",fontWeight:pr.key===effectiveKey?700:400}}>{pr.label||pr.outcome||"(unnamed)"}</td>
                    <td style={{padding:"6px 10px",color:C.muted}}>{et?ES_TYPES[et].scale:"—"}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace"}}>{k}</td>
                    {blocked?(
                      <td colSpan={3} style={{padding:"6px 10px",textAlign:"right",color:C.red,fontSize:11}}>
                        ⛔ blocked — incompatible estimates
                      </td>
                    ):(<>
                      <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",fontWeight:700,color:r?C.grn:C.dim}}>{r?dv(r.pES):"—"}</td>
                      <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.muted}}>{r?`${dv(r.lo95)} to ${dv(r.hi95)}`:"need ≥2"}</td>
                      <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:r&&r.I2>50?C.yel:C.muted}}>{r?r.I2+"%":"—"}</td>
                    </>)}
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
      {/* RoadMap/2.md — τ² estimator selector (random-effects only; DL is the default). */}
      {method==="random"&&(
        <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:11,color:C.muted,whiteSpace:"nowrap"}}>τ² estimator:</span>
          <select value={tau2Method} onChange={e=>setTau2Method(e.target.value)} style={{...inp,width:"auto",fontSize:11,padding:"3px 6px"}}>
            {TAU2_METHODS.map(m=><option key={m} value={m}>{TAU2_LABELS[m]}</option>)}
          </select>
          <HelpTip text="How the between-study variance τ² is estimated. DerSimonian–Laird is the default (and what existing results use). REML and Paule–Mandel are common alternatives; small-k or non-converging estimators fall back to DL. Verify key results in R/metafor for regulatory use."/>
          {result&&result.tau2Fallback==="DL"&&<span style={{fontSize:10.5,color:C.yel}}>fell back to DL</span>}
        </span>
      )}
      <span style={{marginLeft:"auto",fontSize:11,color:C.muted}}>{valid.length} of {studies.length} studies usable</span>
      <PrecisionControl prec={prec} onChange={updateProject?setAnalysisPrecision:undefined} onApplyAll={onApplyPrecisionToAll}/>
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

    {/* 107.md §11/§12 — PROPORTION COMPATIBILITY (PROP outcomes only) */}
    {isPropPair&&(
      <ProportionCompatibilityPanel
        check={propCheck} filters={proportionFilters} override={propOverride} stale={propStale} moot={propMoot}
        onSetFilter={updateProject?setProportionFilter:undefined}
        onClearFilter={updateProject?(f)=>setProportionFilter(f,null):undefined}
        onRecordOverride={updateProject?recordProportionOverride:undefined}
        onClearOverride={updateProject?clearProportionOverride:undefined}/>
    )}

    {!result&&!effectiveKey&&outcomePairs.length>1?(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
      <div style={{fontSize:36,marginBottom:10}}>📊</div>
      <div style={{fontSize:14,marginBottom:6,color:C.txt}}>Select an outcome above to run the analysis</div>
      <div style={{fontSize:12}}>Each outcome must be analysed separately. Choose one from the dropdown.</div>
    </div>):!result?(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
      <div style={{fontSize:36,marginBottom:10}}>📊</div>{proportionFilters?"No pooled result for the current filter — at least 2 estimates with an effect size and 95% CI must match it.":"Enter an effect size and 95% CI for at least 2 studies (Data Extraction tab)"}
      {/* 116.md §50 — never a blank panel: name the specific problems, with counts. */}
      {eligibility&&!eligibility.ok&&<div><AnalysisEligibilityNotice reasons={eligibility.reasons}/></div>}
    </div>):((pool.blockers.length>0&&!forceShow)||propBlocked)?(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:32,textAlign:"center",color:C.muted}}>
        <div style={{fontSize:32,marginBottom:10}}>🛑</div>
        <div style={{fontSize:14,marginBottom:4,color:C.txt}}>Result hidden until you confirm</div>
        <div style={{fontSize:12,maxWidth:480,margin:"0 auto",lineHeight:1.6}}>{propBlocked&&!(pool.blockers.length>0&&!forceShow)
          ?"These estimates do not all measure the same quantity (see above). Filter to one category, stratify on the Subgroup tab, correct the extraction metadata, exclude the estimates — or record an explicit override."
          :"The studies appear incompatible to pool (see above). Forcing a pooled number here could be misleading. Fix the data, or click the button above to override."}</div>
        {/* 116.md §50 — the blocked state states its reason with counts too. */}
        {propBlocked&&<div><AnalysisEligibilityNotice title="WHY THIS RESULT IS HIDDEN" reasons={blockedByCompatibilityReasons(propCheck)}/></div>}
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
        const dv=makeScaledFormatter({isLog,isProp},prec);   // 116.md §31 — centralized, honours trailingZeros
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
          <Cell title={`RANDOM EFFECTS (${tauName})`} o={result.random} active={method==="random"}/>
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
        const dv=makeScaledFormatter({isLog,isProp},prec);   // 116.md §31 — centralized, honours trailingZeros
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

      {/* 116.md §57 — the conditional opener was missing, so its closing `)}` fell
          through to the renderer as literal JSX text and printed ")}" under this
          card. Restored (rather than deleting the brace) because `interpretResult`
          returns null without a result, which this card dereferences. */}
      {interp&&(
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
            <div style={{fontWeight:700,color:C.txt}}>Weighting</div><div>{method==="random"?`Inverse-variance weights with τ² (${tauName}) added to each study's variance.`:"Inverse-variance weights (1/SE²)."} SE derived from each 95% CI as (upper − lower) / (2 × 1.96).</div>
            <div style={{fontWeight:700,color:C.txt}}>Heterogeneity</div><div>Cochran's Q = Σwᵢ(yᵢ − ȳ)²; I² = max(0, (Q − df)/Q) × 100; τ² = max(0, (Q − df)/(ΣW − ΣW²/ΣW)).</div>
            <div style={{fontWeight:700,color:C.txt}}>Significance</div><div>z = pooled ES / SE; two-sided p from the standard normal distribution.</div>
            <div style={{fontWeight:700,color:C.txt}}>Transforms</div><div>{esType&&ES_TYPES[esType]?.log?"Ratio measures are pooled on the natural-log scale and back-transformed for display.":esType==="PROP"?"Proportions are pooled on the logit scale and back-transformed.":esType==="COR"?"Correlations are pooled as Fisher's z.":"No transform applied to the stored effect sizes."}</div>
            <div style={{fontWeight:700,color:C.txt}}>Excluded</div><div>{studies.length-result.k} of {studies.length} studies not in this pool ({studies.filter(s=>!hasUsableEffect(s)).length} without an effect size{valid.length>result.k?", plus those missing a CI":""}).</div>
          </div>
          <InfoBox color={C.dim}>Computation runs locally in your browser. For a regulatory submission, confirm key results in established software (R <em>metafor</em>, RevMan, or Stata). Random-effects τ² estimators can underestimate uncertainty when k is small — consider this a planning/checking tool.</InfoBox>
        </div>)}
      </div>

      {/* INDIVIDUAL STUDY CONTRIBUTIONS — 116.md §52-§56. The eight default columns are
          unchanged (§54); the `Columns` control adds project extraction fields from the
          SAME registry Extraction uses, persisted per outcome pair. */}
      <IndividualContributions result={result} project={project} outcomeKey={outcomeKey}
        prec={prec} method={method}
        onSetColumns={updateProject?(next)=>setContributionColumns(outcomeKey,next):undefined}/>

      {/* DATA BEHIND THIS ANALYSIS */}
      <DataBehindAnalysis result={result} studies={filteredStudies} esType={esType} prec={prec}/>

      {/* RESEARCH-READY EXPORT — 107.md §13: the classification columns and metadata
          lines appear ONLY when a filter/override was actually used. */}
      <ResearchExport result={result} esType={esType} method={method} studies={filteredStudies} prec={prec}
        proportionFilters={proportionFilters} proportionOverride={propHonored?propOverride:null}
        figure={resolveForestFigure(project,activeOutcome)}/>

      {/* COPYABLE STRUCTURED OUTPUTS */}
      <ResultsWriteup result={result} interp={interp} esType={esType} method={method} methodLabel={methodLabel} studies={filteredStudies} prec={prec}/>

      {result.I2>50&&<InfoBox color={C.yel}>⚠️ Substantial heterogeneity (I² = {result.I2}%). Explore it on the Subgroup and Sensitivity tabs before relying on the pooled estimate.</InfoBox>}
    </div>)}
  </div>);
}

/* "Data Behind This Analysis" — full provenance of what fed the pooled result */
export function DataBehindAnalysis({result,studies,esType,prec}){
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

/**
 * One classification cell of the research-ready export (TSV / CSV / .xls / preview).
 *
 * Label-resolved, and deliberately EMPTY (never "Not classified") for a legacy row — an
 * empty cell is honest, a label in a data column would read like a category.
 * `denominatorCustom` goes through `exportedDenominatorCustom`, NOT the raw text: a row
 * whose population was switched away from Other/custom keeps the old description on the
 * blob (no load-path normalizer strips it, 107.md §15) and the input that would reveal it
 * is hidden — this is the FOURTH exporter of that field. Pure + exported.
 */
export function proportionClassCell(study,field){
  if(field==="denominatorPopulation") return denominatorPopulationLabel(study);
  if(field==="actionStatus") return actionStatusLabel(study);
  if(field==="denominatorCustom") return exportedDenominatorCustom(study);
  return "";
}

/* ════════════ RESEARCH-READY EXPORT ════════════ */
/* Builds study-level + pooled + heterogeneity tables and offers copy / CSV / Excel(.xls) / publication table */
/** 116.md §26/§32 + 117.md §24 — `figure` is the RESOLVED per-figure configuration
 *  (resolveForestFigure): title/subtitle/note, axis-name and favours text as the reviewer
 *  persisted them (empty meaning "auto"), plus column visibility, the per-figure decimal
 *  override and the bounded geometry. It carries NO no-effect override — the registry
 *  owns that — and NO statistical value (117.md §25). */
export function ResearchExport({result,esType,method,studies,prec,proportionFilters,proportionOverride,figure=EMPTY_FIGURE_CONFIG}){
  const[copied,setCopied]=useState("");
  const[showTable,setShowTable]=useState(false);
  if(!result) return null;
  // 107.md §13 — the classification only reaches the export when the reviewer actually
  // filtered or overrode on it. Neither used → both lists are empty and every string
  // below is byte-identical to the pre-107 output.
  const propOverride=proportionOverride||null;
  const classFields=proportionExportFields(proportionFilters,propOverride);
  const propMetaRows=proportionExportMetaRows(proportionFilters,propOverride);
  const classCell=proportionClassCell;
  const classCsvKey={denominatorPopulation:"Denominator_population",actionStatus:"Action_status",denominatorCustom:"Custom_denominator_definition"};
  const t=ES_TYPES[esType]||{};
  const isLog=!!t.log, isProp=esType==="PROP";
  const measureName=t.label||"Effect size";
  const scale=t.scale||"ES";
  const ratioName=scale.replace("ln","");        // OR / RR / HR
  const transform=isLog?"natural-log, back-transformed for display":isProp?"logit, back-transformed to %":esType==="COR"?"Fisher's z":"none";
  const bt=x=>isLog?Math.exp(x):isProp?(()=>{const e=Math.exp(x);return e/(1+e);})():x;
  const dispVal=makeScaledFormatter({isLog,isProp},prec);   // 116.md §31 — centralized, honours trailingZeros

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
    cls:classFields.map(f=>classCell(s,f)),
  }));
  const anyCounts=rows.some(r=>r.exp||r.ctrl);
  const fx=result.fixed, rnd=result.random;
  const poolLine=(label,o)=>`${label}: ${dispVal(o.es)} (95% CI ${dispVal(o.lo)} to ${dispVal(o.hi)})`;

  // ---- TSV for clipboard / Excel paste ----
  const head=["Study",...classFields.map(f=>PROPORTION_FIELD_LABEL[f]),...(anyCounts?["Experimental (n/N)","Control (n/N)"]:[]),
    isLog||isProp?`${isProp?"Proportion":ratioName}`:"Effect size","95% CI lower","95% CI upper","Weight common (%)","Weight random (%)"];
  const tsvRows=rows.map(r=>[r.study,...r.cls,...(anyCounts?[r.exp,r.ctrl]:[]),
    r.es, dispVal(+r.raw_lo), dispVal(+r.raw_hi), r.wF, r.wR].join("\t"));
  const blanks=classFields.map(()=>"");
  const tsv=[head.join("\t"),...tsvRows,
    "",
    [`Pooled (common/fixed)`,...blanks,...(anyCounts?["",""]:[]),dispVal(fx.es),dispVal(fx.lo),dispVal(fx.hi),"100",""].join("\t"),
    [`Pooled (random)`,...blanks,...(anyCounts?["",""]:[]),dispVal(rnd.es),dispVal(rnd.lo),dispVal(rnd.hi),"","100"].join("\t"),
  ].join("\n");

  // ---- CSV ----
  const esc=v=>{const x=String(v==null?"":v).replace(/"/g,'""');return /[",\n]/.test(x)?`"${x}"`:x;};
  const csvHead=["Study",...classFields.map(f=>classCsvKey[f]||f),...(anyCounts?["Experimental_n_N","Control_n_N"]:[]),
    "EffectSize_display","CI_lower_display","CI_upper_display","ES_analysisScale","CIlo_analysisScale","CIhi_analysisScale","Weight_common_pct","Weight_random_pct"];
  const csvRows=rows.map(r=>[r.study,...r.cls,...(anyCounts?[r.exp,r.ctrl]:[]),r.es,dispVal(+r.raw_lo),dispVal(+r.raw_hi),r.raw_es,r.raw_lo,r.raw_hi,r.wF,r.wR].map(esc).join(","));
  const meta=[
    "",
    esc("Meta-analysis summary"),
    `${esc("Effect measure")},${esc(measureName)}`,
    // 107.md §13 — the estimate SELECTION is part of the result. The builder returns an
    // EMPTY list when no filter/override is in force, so an untouched export is
    // byte-identical to the pre-107 output.
    ...propMetaRows.map(([k,v])=>`${esc(k)},${esc(v)}`),
    `${esc("Model reported")},${esc(method==="fixed"?"Fixed/common effect":`Random effects (${TAU2_LABELS[result.tau2Method||"DL"]})`)}`,
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
  const csv="﻿"+[csvHead.join(","),...csvRows].join("\n")+"\n"+meta;

  const copy=(txt,id)=>navigator.clipboard.writeText(txt).then(()=>{setCopied(id);setTimeout(()=>setCopied(""),1800);});

  // ---- Excel-compatible (.xls via HTML table) ----
  const xlsTable=`<table border="1"><thead><tr>${csvHead.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>`+
    rows.map(r=>`<tr><td>${r.study}</td>${r.cls.map(v=>`<td>${v}</td>`).join("")}${anyCounts?`<td>${r.exp}</td><td>${r.ctrl}</td>`:""}<td>${r.es}</td><td>${dispVal(+r.raw_lo)}</td><td>${dispVal(+r.raw_hi)}</td><td>${r.raw_es}</td><td>${r.raw_lo}</td><td>${r.raw_hi}</td><td>${r.wF}</td><td>${r.wR}</td></tr>`).join("")+
    `</tbody></table><br/><table border="1"><tr><td>Effect measure</td><td>${measureName}</td></tr><tr><td>Model</td><td>${method==="fixed"?"Fixed/common":"Random effects"}</td></tr><tr><td>Transformation</td><td>${transform}</td></tr>${propMetaRows.map(([k,v])=>`<tr><td>${k}</td><td>${v}</td></tr>`).join("")}<tr><td>Pooled common</td><td>${dispVal(fx.es)} (${dispVal(fx.lo)} to ${dispVal(fx.hi)})</td></tr><tr><td>Pooled random</td><td>${dispVal(rnd.es)} (${dispVal(rnd.lo)} to ${dispVal(rnd.hi)})</td></tr>${result.hksj?`<tr><td>Pooled random (HKSJ, t-based)</td><td>${dispVal(result.hksj.es)} (${dispVal(result.hksj.lo)} to ${dispVal(result.hksj.hi)}); t(${result.hksj.df})=${result.hksj.t}, p=${result.hksj.pval}</td></tr>`:""}${result.predInt?`<tr><td>95% Prediction interval</td><td>${dispVal(result.predInt.lo)} to ${dispVal(result.predInt.hi)}</td></tr>`:""}<tr><td>I²</td><td>${result.I2}%</td></tr><tr><td>tau²</td><td>${result.tau2}</td></tr><tr><td>tau</td><td>${result.tau!=null?result.tau:Math.sqrt(result.tau2).toFixed(4)}</td></tr><tr><td>Q (df=${result.k-1})</td><td>${result.Q}, p=${result.Qpval}</td></tr></table>`;
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
        /* 116.md §26/§32/§124 — the SAME resolved figure configuration the Forest tab
           renders on screen. Two things were wrong here and are now impossible:
             • `nullLine:0` overrode the registry's no-effect value. It is a no-op for
               every measure whose nullVal is already 0, and a silent corruption for
               AUC (nullVal 0.5): the exported figure drew "no effect" at AUC = 0 and
               stretched the axis to −0.09…1.03 while the screen showed 0.45…0.98.
               ES_TYPES is the only source of that value now.
             • the axis was named from `ES_TYPES[esType].scale`, the STORED-scale name,
               so a back-transformed ratio axis read "lnOR (back-transformed)" and a
               percent axis "logit (%)" — while the same figure on screen said
               "Odds Ratio" / "Proportion (%)". An empty esLabel means "auto" and the
               layout derives ONE name for every surface. */
        /* 117.md §81 — the reviewer's persisted column choices apply HERE too. The two
           hard-coded flags this line used to carry made the Meta-Analysis-tab download a
           different figure from the Forest tab's; `showCounts:anyCounts` was also
           redundant, because the layout already suppresses the counts columns when no
           row carries events/totals (forestLayout: `showCounts && (anyExp || anyCtrl)`). */
        const pubOpts={esType,...figure,prec};
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
          {["Study",...classFields.map(f=>PROPORTION_FIELD_LABEL[f]),...(anyCounts?["Exp (n/N)","Ctrl (n/N)"]:[]),(isProp?"Proportion":isLog?ratioName:"ES"),"95% CI","Wt common","Wt random"].map((h,i)=>(
            <th key={i} style={{...th,textAlign:i===0?"left":"right",padding:"6px 8px"}}>{h}</th>))}
        </tr></thead>
        <tbody>
          {rows.map((r,i)=>(<tr key={i} style={{borderBottom:`1px solid ${C.brd}`}}>
            <td style={{padding:"5px 8px"}}>{r.study}</td>
            {r.cls.map((v,j)=>(<td key={j} style={{padding:"5px 8px",color:C.muted}}>{v||"—"}</td>))}
            {anyCounts&&<td style={{padding:"5px 8px",textAlign:"right",color:C.muted}}>{r.exp||"—"}</td>}
            {anyCounts&&<td style={{padding:"5px 8px",textAlign:"right",color:C.muted}}>{r.ctrl||"—"}</td>}
            <td style={{padding:"5px 8px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace"}}>{r.es}</td>
            <td style={{padding:"5px 8px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.muted}}>{r.ci}</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:C.dim}}>{r.wF}%</td>
            <td style={{padding:"5px 8px",textAlign:"right",color:C.dim}}>{r.wR}%</td>
          </tr>))}
          <tr style={{borderTop:`2px solid ${themeAlpha(C.grn,'55')}`}}>
            <td style={{padding:"6px 8px",color:C.grn,fontWeight:700}}>Pooled (common)</td>
            {classFields.map((f)=><td key={f}/>)}
            {anyCounts&&<td/>}{anyCounts&&<td/>}
            <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn,fontWeight:700}}>{dispVal(fx.es)}</td>
            <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{dispVal(fx.lo)} to {dispVal(fx.hi)}</td>
            <td style={{padding:"6px 8px",textAlign:"right",color:C.grn}}>100%</td><td/>
          </tr>
          <tr>
            <td style={{padding:"6px 8px",color:C.grn,fontWeight:700}}>Pooled (random)</td>
            {classFields.map((f)=><td key={f}/>)}
            {anyCounts&&<td/>}{anyCounts&&<td/>}
            <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn,fontWeight:700}}>{dispVal(rnd.es)}</td>
            <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"'IBM Plex Mono',monospace",color:C.grn}}>{dispVal(rnd.lo)} to {dispVal(rnd.hi)}</td>
            <td/><td style={{padding:"6px 8px",textAlign:"right",color:C.grn}}>100%</td>
          </tr>
        </tbody>
      </table>
      <div style={{padding:"8px 10px",fontSize:11,color:C.muted,lineHeight:1.6,borderTop:`1px solid ${C.brd}`}}>
        <strong style={{color:C.txt}}>Model:</strong> {method==="fixed"?"Fixed/common effect":`Random effects (${TAU2_LABELS[result.tau2Method||"DL"]})`} · <strong style={{color:C.txt}}>Transformation:</strong> {transform}<br/>
        <strong style={{color:C.txt}}>Heterogeneity:</strong> I² = {result.I2}% · τ² = {result.tau2} · Q = {result.Q} (df = {result.k-1}, p {result.Qpval<0.001?"< 0.001":"= "+result.Qpval}) · overall p {result.pval<0.001?"< 0.001":"= "+result.pval}
      </div>
    </div>)}
    <InfoBox color={C.dim}>Both the common (fixed) and random-effects pooled estimates are included so reviewers can see model sensitivity. The CSV also stores analysis-scale (e.g. log) values for full reproducibility.</InfoBox>
  </div>);
}

/* Copyable manuscript-ready text blocks derived from the analysis */
export function ResultsWriteup({result,interp,esType,method,methodLabel,studies,prec}){
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

  const methods=`A ${method==="random"?"random-effects":"fixed-effect"} meta-analysis was performed using the ${method==="random"?`${TAU2_LABELS[result.tau2Method||"DL"]} estimator for the between-study variance`:"inverse-variance method"}. Effect sizes were expressed as the ${measureName.toLowerCase()}${ES_TYPES[esType]?.log?", pooled on the natural-logarithmic scale and back-transformed for presentation":""}. Standard errors were derived from reported 95% confidence intervals. Statistical heterogeneity was quantified with the I² statistic and Cochran's Q test, with τ² estimating between-study variance.${result.hksj?" Confidence intervals for the random-effects estimate were additionally calculated using the Hartung-Knapp-Sidik-Jonkman (HKSJ) method, which is recommended when the number of studies is small.":""}${result.predInt?" A 95% prediction interval was calculated to describe the likely range of the true effect in a future study.":""} A two-sided P < 0.05 was considered statistically significant. [State software here — e.g. analyses were verified in R using the metafor package.]`;

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
          <div style={{fontSize:12.5,color:C.txt,lineHeight:1.7}}>{b.text}</div>
        </div>
      ))}
    </div>
  </div>);
}

/* ════════════ TAB: FOREST PLOT ════════════ */
export function ForestTab({project,updateProject,onApplyPrecisionToAll}){
  const studies=Array.isArray(project&&project.studies)?project.studies:[];
  const{theme}=useTheme(); // prompt19 — live forest plot follows day/night
  // 116.md §26/§29/§30/§124 — the persisted analysis config lives on the shared
  // rails: model, decimals and the per-figure labels are all undoable writes
  // through the ONE updateProject choke point (which this tab never had before).
  const cfg=useAnalysisConfigOps(project,updateProject);
  const{setAnalysisPrecision,setAnalysisModel,setFigureLabel,setFigurePresentation,renameProjectOutcome}=cfg;
  const method=projectModel(project);
  const setMethod=(m)=>setAnalysisModel(m);
  // RoadMap/2.md recs — use the project-wide τ² estimator so the exported forest
  // diamond matches the Meta-Analysis headline (they must never disagree).
  const tau2Method=(project&&project.analysisSettings&&project.analysisSettings.tau2Method)||"DL";
  /* 117.md §81 — the two column toggles used to be `useState`, so a reviewer who hid
     the weight columns got them back on every reload and the exports never knew. They
     are now read from the persisted figure record like everything else; the ONLY local
     state left on this tab is which disclosure panel is open. */
  const[showPubPreview,setShowPubPreview]=useState(false);
  const[showLabelEditor,setShowLabelEditor]=useState(false);
  const[showPlotOptions,setShowPlotOptions]=useState(false);

  // ── Outcome / time-point selector (shared helper — same rows as AnalysisTab) ──
  const outcomePairs=useMemo(()=>enumerateOutcomePairs(studies),[studies]);
  const[selectedKey,setSelectedKey]=useState("");
  useEffect(()=>{
    if(outcomePairs.length===1) setSelectedKey(outcomePairs[0].key);
    else if(outcomePairs.length>1&&!outcomePairs.find(p=>p.key===selectedKey)) setSelectedKey("");
  },[outcomePairs.length]);
  const effectiveKey=outcomePairs.length===1?outcomePairs[0].key:selectedKey;
  const activeOutcome=outcomePairs.find(p=>p.key===effectiveKey)||null;
  // 107.md §12 — the persisted proportion filter applies here too: the forest diamond
  // and the Meta-Analysis headline must never disagree about which estimates were pooled.
  const proportionFilters=pairProportionFilter(project,activeOutcome);
  const filteredStudies=useMemo(
    ()=>applyProportionFilters(studiesForPair(studies,activeOutcome),proportionFilters),
    [studies,activeOutcome,proportionFilters]);

  const valid=filteredStudies;
  // auto-detect dominant effect measure from filtered studies
  const esType=useMemo(()=>dominantEsType(valid),[valid]);
  // 107.md §11/§12 — the SAME gate AnalysisTab applies. Without it this tab drew and
  // exported a publication-ready diamond over exactly the estimates AnalysisTab refuses
  // to pool, with nothing on screen saying so.
  const gate=useMemo(()=>proportionGate(project,activeOutcome,filteredStudies,esType),
    [project,activeOutcome,filteredStudies,esType]);
  /* 116.md §26/§27 — FIGURE-LOCAL text, persisted per outcome pair. An empty value
     means "auto": the layout engine derives the axis name from the measure and the
     title from the project + outcome. Editing any of these NEVER renames anything
     project-level; the outcome rename below is a separate, explicitly labelled act. */
  const labels=pairFigureLabels(project,activeOutcome);
  const autoTitle=`${project.name||""}${activeOutcome?.outcome?` — ${activeOutcome.outcome}`:""}${activeOutcome?.timepoint?` (${activeOutcome.timepoint})`:""}`.trim();
  /* 117.md §23/§24/§81 — ONE resolved presentation record. Every forest surface on this
     tab spreads THIS object: the live plot, the hidden dark render that the "Dark
     (screen)" download serializes, the publication preview and both export paths. That
     is the D15 drift class closed structurally — a control added to the resolver reaches
     all of them without a call-site edit, and none of them can hold a different opinion. */
  const figure=useMemo(()=>resolveForestFigure(project,activeOutcome,{defaultTitle:autoTitle}),
    [project,activeOutcome,autoTitle]);
  const figTitle=figure.title;
  const outcomeKey=activeOutcome?activeOutcome.key:"";
  const result=useMemo(()=>runMeta(filteredStudies,method,{tau2Method}),[filteredStudies,method,tau2Method]);
  const isLog=esType&&ES_TYPES[esType]?.log;
  const measureNull=esType&&ES_TYPES[esType]?ES_TYPES[esType].nullVal:0;
  const safeName=(project.name||"forest").replace(/[^a-z0-9]/gi,"_");
  const outcomeSafeName=(activeOutcome?.outcome||"outcome").replace(/[^a-z0-9]/gi,"_");
  const prec = project?.analysisPrecision;
  /* 116.md §27 — renaming the outcome is a PROJECT edit. It is offered here because
     the forest plot is where a reviewer notices a bad outcome name, but it goes
     through the one shared renameOutcome writer (studies[] + every name-keyed map)
     and propagates to Extraction, every selector and the manuscript. */
  const otherOutcomeNames=useMemo(()=>new Set(outcomePairs
    .filter(p=>p.key!==outcomeKey).map(p=>(p.outcome||"").trim().toLowerCase())),[outcomePairs,outcomeKey]);
  const commitOutcomeRename=(next)=>{
    const to=String(next||"").trim();
    if(!activeOutcome||!to||to===activeOutcome.outcome) return;
    renameProjectOutcome(activeOutcome.outcome,to,null);
    setSelectedKey(outcomePairKey(to,activeOutcome.timepoint));
  };

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
      {/* 107.md §12 — an active persisted filter silently dropped estimates from the
          exported figure with nothing on screen saying so. Same chip as SubgroupTab. */}
      <ProportionFilterChips filters={proportionFilters}/>
    </div>

    {/* no outcome selected yet */}
    {outcomePairs.length>1&&!effectiveKey&&(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
        <div style={{fontSize:32,marginBottom:10}}>🌲</div>
        <div style={{fontSize:14,marginBottom:6,color:C.txt}}>Select an outcome to draw the forest plot</div>
        <div style={{fontSize:12}}>Each outcome gets its own separate forest plot.</div>
      </div>
    )}

    {/* 107.md §11/§12 — THE gate, read-only: the resolutions live on the Meta-Analysis tab. */}
    {(outcomePairs.length===1||effectiveKey)&&gate.isPropPair&&(
      <ProportionCompatibilityPanel compact check={gate.check} override={gate.override} stale={gate.stale} moot={gate.moot}/>
    )}
    {(outcomePairs.length===1||effectiveKey)&&gate.blocked&&(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:32,textAlign:"center",color:C.muted}}>
        <div style={{fontSize:32,marginBottom:10}}>🛑</div>
        <div style={{fontSize:14,marginBottom:4,color:C.txt}}>Forest plot hidden until you confirm</div>
        <div style={{fontSize:12,maxWidth:480,margin:"0 auto",lineHeight:1.6}}>These estimates do not all measure the same quantity (see above), so neither the pooled diamond nor its publication export is available for them.</div>
      </div>
    )}

    {/* controls + plot — only when an outcome is selected AND the pool is not blocked */}
    {(outcomePairs.length===1||effectiveKey)&&!gate.blocked&&(<>
    <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
      {[["random","Random Effects"],["fixed","Fixed / Common Effect"]].map(([m,label])=>(
        <button key={m} onClick={()=>setMethod(m)} style={btnS(method===m?"primary":"ghost")}>{label}</button>
      ))}
      <div style={{display:"flex",gap:8,marginLeft:"auto",alignItems:"center",flexWrap:"wrap"}}>
        {/* 116.md §28 / 117.md §24 — two compact affordances; the plot itself still
            carries no editing chrome. The column toggles moved INTO Plot options, where
            they sit with everything else that is saved with the figure (117.md §81). */}
        {updateProject&&outcomeKey&&<button onClick={()=>setShowLabelEditor(v=>!v)} style={{...btnS("ghost"),fontSize:11}}>{showLabelEditor?"▲ Done editing labels":"✎ Edit labels"}</button>}
        {updateProject&&outcomeKey&&<button onClick={()=>setShowPlotOptions(v=>!v)} style={{...btnS("ghost"),fontSize:11}}>{showPlotOptions?"▲ Done with plot options":"⚙ Plot options"}</button>}
        {/* 116.md §29/§30 — the SAME project-level decimal setting, on this page too. */}
        <PrecisionControl prec={prec} onChange={updateProject?setAnalysisPrecision:undefined} onApplyAll={onApplyPrecisionToAll}/>
      </div>
    </div>
    {/* ── 117.md §23-§25/§81 — presentation controls, persisted per figure ── */}
    {showPlotOptions&&updateProject&&outcomeKey&&(
      <PlotOptionsPanel figure={figure} onChange={(patch,field)=>setFigurePresentation(outcomeKey,patch,field)}/>
    )}
    {/* ── 116.md §26-§28 — figure-local labels + the project-level outcome rename ── */}
    {showLabelEditor&&updateProject&&outcomeKey&&(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"12px 14px",marginBottom:14,display:"flex",flexDirection:"column",gap:10}}>
        <div style={{fontSize:11,fontWeight:700,color:C.acc,letterSpacing:1}}>FIGURE LABELS — THIS PLOT ONLY</div>
        <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
          <InlineLabelEdit label="Title" value={labels.title||""} placeholder={autoTitle||"auto"} width={260}
            onCommit={v=>setFigureLabel(outcomeKey,"title",v)} hint="Figure title — editing it never renames the outcome"/>
          <InlineLabelEdit label="X-axis label" value={labels.esLabel||""} placeholder={ES_TYPES[esType]?esMeasureName(esType):"auto"} width={200}
            onCommit={v=>setFigureLabel(outcomeKey,"esLabel",v)}/>
        </div>
        <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
          <InlineLabelEdit label="Left favours" value={labels.favLow||""} placeholder="favours lower" width={190}
            onCommit={v=>setFigureLabel(outcomeKey,"favLow",v)} hint="e.g. Favours intervention — state the direction yourself; it is never inferred"/>
          <InlineLabelEdit label="Right favours" value={labels.favHigh||""} placeholder="favours higher" width={190}
            onCommit={v=>setFigureLabel(outcomeKey,"favHigh",v)} hint="e.g. Favours control — for a harm outcome the clinical direction inverts"/>
        </div>
        {/* 117.md §24 — subtitle + footer note: figure-local TEXT, same writer, same undo. */}
        <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
          <InlineLabelEdit label="Subtitle" value={labels.subtitle||""} placeholder="none" width={260}
            onCommit={v=>setFigureLabel(outcomeKey,"subtitle",v)} hint="A second, smaller line under the title — e.g. the population or the model"/>
          <InlineLabelEdit label="Note" value={labels.note||""} placeholder="none" width={260}
            onCommit={v=>setFigureLabel(outcomeKey,"note",v)} hint="Printed under the heterogeneity line, in the figure itself and in every export"/>
        </div>
        <div style={{fontSize:10.5,color:C.dim,lineHeight:1.5}}>
          These labels belong to this figure and are saved with the project. The default favours text states the axis direction only — PecanLab never infers which side is clinically better, because a harm outcome reverses it.
        </div>
        <div style={{borderTop:`1px solid ${C.brd}`,paddingTop:10,display:"flex",flexDirection:"column",gap:6}}>
          <div style={{fontSize:11,fontWeight:700,color:C.yel,letterSpacing:1}}>OUTCOME NAME — WHOLE PROJECT</div>
          <InlineLabelEdit label="Outcome" value={activeOutcome?.outcome||""} placeholder="(unnamed)" width={260}
            onCommit={commitOutcomeRename} hint="Renames this outcome everywhere: Extraction, Analysis, every forest plot, selectors and the manuscript"/>
          <div style={{fontSize:10.5,color:C.dim,lineHeight:1.5}}>
            Renaming updates every study row with this outcome and carries its saved analysis settings across.
            {otherOutcomeNames.size?" Renaming it to a name another outcome already uses merges the two.":""}
          </div>
        </div>
      </div>
    )}
    {esType&&<div style={{marginBottom:12,fontSize:11,color:C.muted}}>
      Detected measure: <strong style={{color:C.acc}}>{ES_TYPES[esType]?.label}</strong>. {isLog?"Pooled on the log scale; the no-effect line sits at 1 on the ratio axis, and ticks and the ES column show back-transformed values.":esType==="PROP"?"Pooled on the logit scale and shown as percentages. A single-arm proportion has no no-effect value, so no null line or favours labels are drawn.":measureNull==null?"This measure has no no-effect value, so no null line is drawn.":`No-effect line at ${measureNull}.`}
    </div>}
    {/* prompt19 — LIVE plot follows the theme + scales to the column width.
        117.md §81 — {...figure} is the WHOLE persisted presentation. */}
    <ForestPlot result={result} {...figure} esType={esType} svgId="forestplot-live" prec={prec} live theme={theme}/>
    {/* Hidden dark render kept in the DOM as the "Dark (screen)" PNG export source
        (serialized by id) — so the live theme switch never changes that download.
        It gets the SAME record: a hidden render that quietly ignored a control would
        make the dark download a different figure from the one on screen. */}
    <div aria-hidden="true" style={{position:"absolute",width:0,height:0,overflow:"hidden",left:-99999,top:0,pointerEvents:"none"}}>
      <ForestPlot result={result} {...figure} esType={esType} svgId="forestplot-svg" prec={prec}/>
    </div>
    {result&&(()=>{
      // 116.md §32 / 117.md §81 — the SAME resolved record the live plot uses reaches
      // every export path below (dialog SVG, dialog PNG and the on-page preview).
      const pubOpts={esType,...figure,prec};
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
      : esType==="PROP"
        ? <InfoBox>💡 Single-arm proportions are pooled on the logit scale and labelled as percentages. There is no no-effect value for a proportion, so the figure draws no null line and no favours labels.</InfoBox>
        : <InfoBox>💡 Squares left of the no-effect line ({measureNull==null?"—":measureNull}) indicate effects in one direction, right of it the other. Set the effect-measure type per study (Data Extraction) so the axis labels itself correctly.</InfoBox>}
    </>)}
  </div>);
}

/* ════════════ TAB: SENSITIVITY ANALYSIS ════════════ */
export function SensitivityTab({project,updateProject,onApplyPrecisionToAll}){
  const allStudies=Array.isArray(project&&project.studies)?project.studies:[];
  const prec = project?.analysisPrecision;
  // 116.md §30/§124 — the decimal control and the synthesis model are the SAME
  // project-level settings every other Analysis page reads and writes.
  const{setAnalysisPrecision,setAnalysisModel}=useAnalysisConfigOps(project,updateProject);
  const method=projectModel(project);
  const setMethod=(m)=>setAnalysisModel(m);
  // RoadMap/2.md recs — sensitivity analyses use the project-wide τ² estimator too.
  const tau2Method=(project&&project.analysisSettings&&project.analysisSettings.tau2Method)||"DL";
  // 86.md P1.6 / 107.md §21 — this tab used to run leave-one-out, Egger and trim-and-fill
  // over EVERY outcome at once, ignoring "exclude from analysis" too. Same outcome-pair
  // scoping as Analysis/Forest, so the robustness checks describe the pool they claim to.
  const outcomePairs=useMemo(()=>enumerateOutcomePairs(allStudies),[allStudies]);
  const[selectedKey,setSelectedKey]=useState("");
  useEffect(()=>{
    if(outcomePairs.length===1) setSelectedKey(outcomePairs[0].key);
    else if(outcomePairs.length>1&&!outcomePairs.find(p=>p.key===selectedKey)) setSelectedKey("");
  },[outcomePairs.length]);
  const effectiveKey=outcomePairs.length===1?outcomePairs[0].key:selectedKey;
  const activeOutcome=outcomePairs.find(p=>p.key===effectiveKey)||null;
  const proportionFilters=pairProportionFilter(project,activeOutcome);
  const studies=useMemo(
    ()=>applyProportionFilters(studiesForPair(allStudies,activeOutcome),proportionFilters),
    [allStudies,activeOutcome,proportionFilters]);

  const result=useMemo(()=>runMeta(studies,method,{tau2Method}),[studies,method,tau2Method]);
  const loo=useMemo(()=>leaveOneOut(studies,method,{tau2Method}),[studies,method,tau2Method]);
  const egger=useMemo(()=>eggersTest(studies),[studies]);
  const tf=useMemo(()=>trimFill(studies,method,{tau2Method}),[studies,method,tau2Method]);
  const influence=useMemo(()=>influenceDiagnostics(studies,method,{tau2Method}),[studies,method,tau2Method]);
  const esType=useMemo(()=>{const t=studies.map(s=>s.esType).filter(Boolean);return t.length?t[0]:"";},[studies]);
  // Primary-data-only re-run (exclude converted / non-primary studies)
  const primaryStudies=useMemo(()=>studies.filter(s=>s.es!==""&&!isNaN(+s.es)&&!isNonPrimary(s)),[studies]);
  const nonPrimaryCount=useMemo(()=>studies.filter(s=>s.es!==""&&!isNaN(+s.es)&&isNonPrimary(s)).length,[studies]);
  const primaryResult=useMemo(()=>runMeta(primaryStudies,method,{tau2Method}),[primaryStudies,method,tau2Method]);

  // 107.md §11/§12 — the SAME gate AnalysisTab applies. Without it this tab reported a
  // pooled estimate, leave-one-out, Egger and trim-and-fill over exactly the estimates
  // AnalysisTab refuses to pool, and offered a funnel-plot export of them.
  const gate=useMemo(()=>proportionGate(project,activeOutcome,studies),[project,activeOutcome,studies]);

  const outcomeSelector=(outcomePairs.length>1)?(
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:12,marginBottom:14,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:0.5,whiteSpace:"nowrap"}}>OUTCOME</span>
      <select value={selectedKey} onChange={e=>setSelectedKey(e.target.value)}
        style={{...inp,width:"auto",fontSize:12,padding:"5px 10px",flex:1,maxWidth:420}}>
        <option value="">— select an outcome —</option>
        {outcomePairs.map(p=>(<option key={p.key} value={p.key}>{p.label||p.outcome||"(unnamed)"}</option>))}
      </select>
      <span style={{fontSize:11,color:C.muted}}>Robustness checks run on one outcome at a time.</span>
      <ProportionFilterChips filters={proportionFilters}/>
    </div>
  ):(activeProportionFilters(proportionFilters).length>0?(
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"9px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
      <span style={{fontSize:10,fontWeight:700,color:C.acc,letterSpacing:0.8}}>ESTIMATES FILTERED</span>
      <ProportionFilterChips filters={proportionFilters}/>
    </div>
  ):null);

  if(!result) return (<div>
    <SectionHeader icon="activity" title="Sensitivity & Publication Bias" desc="Assess robustness and small-study effects. Needs ≥3 studies with effect sizes."/>
    {outcomeSelector}
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
      <div style={{fontSize:36,marginBottom:10}}>🎯</div>{outcomePairs.length>1&&!effectiveKey
        ?"Select an outcome above — each outcome is assessed separately."
        :"Add at least 3 studies with effect sizes"}
    </div>
  </div>);

  // Blocked: nothing below describes a pool that may legitimately exist, so no robustness
  // output and no funnel export is rendered at all.
  if(gate.blocked) return (<div>
    <SectionHeader icon="activity" title="Sensitivity & Publication Bias" desc="Robustness checks: leave-one-out, funnel plot, Egger's test."/>
    {outcomeSelector}
    <ProportionCompatibilityPanel compact check={gate.check} override={gate.override} stale={gate.stale} moot={gate.moot}/>
    <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:32,textAlign:"center",color:C.muted}}>
      <div style={{fontSize:32,marginBottom:10}}>🛑</div>
      <div style={{fontSize:14,marginBottom:4,color:C.txt}}>Robustness checks hidden until you confirm</div>
      <div style={{fontSize:12,maxWidth:480,margin:"0 auto",lineHeight:1.6}}>Leave-one-out, the funnel plot, Egger&apos;s test and trim-and-fill all describe one pooled estimate — and these estimates do not all measure the same quantity (see above).</div>
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
    {outcomeSelector}
    {gate.isPropPair&&(
      <ProportionCompatibilityPanel compact check={gate.check} override={gate.override} stale={gate.stale} moot={gate.moot}/>
    )}
    {result.k<10&&(
      <div style={{background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'44')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"10px 14px",marginBottom:14,fontSize:12,color:C.muted,lineHeight:1.6}}>
        <strong style={{color:C.yel}}>⚠ Only {result.k} studies.</strong> Cochrane and most guidance recommend assessing publication bias (funnel plot, Egger's test) <strong>only when ≥10 studies</strong> are pooled. With fewer, these tests have low power and the funnel is hard to read — interpret the results below with caution and don't over-rely on them.
      </div>
    )}
    <div style={{display:"flex",gap:8,marginBottom:20,alignItems:"center",flexWrap:"wrap"}}>
      {[["random","Random Effects"],["fixed","Fixed Effects"]].map(([m,label])=>(
        <button key={m} onClick={()=>setMethod(m)} style={btnS(method===m?"primary":"ghost")}>{label}</button>
      ))}
      {/* 116.md §30 — the decimal control lives on EVERY Analysis page. */}
      <span style={{marginLeft:"auto"}}/>
      <PrecisionControl prec={prec} onChange={updateProject?setAnalysisPrecision:undefined} onApplyAll={onApplyPrecisionToAll}/>
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
      const dv=makeScaledFormatter({isLog,isProp},prec);   // 116.md §31 — centralized, honours trailingZeros
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
      const dv=makeScaledFormatter({isLog,isProp},prec);   // 116.md §31 — centralized, honours trailingZeros
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
export function SubgroupTab({project,updateProject,onApplyPrecisionToAll}){
  const allStudies=Array.isArray(project&&project.studies)?project.studies:[];
  const prec = project?.analysisPrecision;
  const[groupKey,setGroupKey]=useState("design");
  // 116.md §30/§124 — shared project-level decimal + model settings.
  const{setAnalysisPrecision,setAnalysisModel}=useAnalysisConfigOps(project,updateProject);
  const method=projectModel(project);
  const setMethod=(m)=>setAnalysisModel(m);
  // RoadMap/2.md recs — subgroup pools use the project-wide τ² estimator too.
  const tau2Method=(project&&project.analysisSettings&&project.analysisSettings.tau2Method)||"DL";

  // 86.md P1.6 / 107.md §10 — this tab used to group the RAW project.studies: every
  // outcome at once, with no "exclude from analysis". Stratifying proportions by
  // denominator ACROSS outcomes would compare quantities that were never comparable,
  // so it now scopes to one (outcome, timepoint) pair exactly like Analysis/Forest and
  // honours the persisted proportion filter for that pair.
  const outcomePairs=useMemo(()=>enumerateOutcomePairs(allStudies),[allStudies]);
  const[selectedKey,setSelectedKey]=useState("");
  useEffect(()=>{
    if(outcomePairs.length===1) setSelectedKey(outcomePairs[0].key);
    else if(outcomePairs.length>1&&!outcomePairs.find(p=>p.key===selectedKey)) setSelectedKey("");
  },[outcomePairs.length]);
  const effectiveKey=outcomePairs.length===1?outcomePairs[0].key:selectedKey;
  const activeOutcome=outcomePairs.find(p=>p.key===effectiveKey)||null;
  const proportionFilters=pairProportionFilter(project,activeOutcome);
  const studies=useMemo(
    ()=>applyProportionFilters(studiesForPair(allStudies,activeOutcome),proportionFilters),
    [allStudies,activeOutcome,proportionFilters]);

  // 107.md §12 — the same dominant-measure fallback AnalysisTab uses. `enumerateOutcomePairs`
  // copies esType from the FIRST eligible row, so a PROP outcome whose first row has a
  // blank Effect measure would otherwise be denied the two stratification variables the
  // blocking card on the Analysis tab tells the reviewer to come here for.
  const isPropPair=pairIsProportion(activeOutcome,dominantEsType(studies));
  const keys=[
    {id:"design",label:"Study Design"},
    {id:"drugClass",label:"Drug Class"},
    {id:"country",label:"Country/Region"},
    {id:"timepoint",label:"Time Point"},
    {id:"adjusted",label:"Adjusted vs Unadjusted"},
    {id:"outcome",label:"Outcome Measured"},
    // 107.md §10 — the two per-estimate proportion classifications become first-class
    // stratification variables, offered only where they exist (PROP outcomes).
    ...(isPropPair?[
      {id:"denominatorPopulation",label:"Denominator population"},
      {id:"actionStatus",label:"Action status"},
    ]:[]),
  ];
  // Falls back cleanly if the reviewer switches from a PROP outcome to a non-PROP one.
  const activeGroupKey=keys.some(k=>k.id===groupKey)?groupKey:"design";
  // Time Point / Outcome Measured are constant INSIDE a pair, so pair scoping made them
  // permanent single-group no-ops. They deliberately step outside the pair instead.
  const crossRows=useMemo(()=>crossPairRowsForGrouping(allStudies,activeOutcome,activeGroupKey),
    [allStudies,activeOutcome,activeGroupKey]);
  const scopedRows=crossRows||studies;
  const crossPairs=useMemo(()=>(crossRows?enumerateOutcomePairs(crossRows).length:0),[crossRows]);
  const grouped=useMemo(()=>groupRowsForSubgroup(scopedRows,activeGroupKey),[scopedRows,activeGroupKey]);
  const result=useMemo(()=>subgroupAnalysis(grouped,activeGroupKey,method,{tau2Method}),[grouped,activeGroupKey,method,tau2Method]);

  return(<div>
    <SectionHeader icon="layers" title="Subgroup Analysis" desc="Explore heterogeneity by stratifying studies. The Q-between test asks whether subgroups differ more than chance."/>
    <div style={{background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'44')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"10px 14px",marginBottom:14,fontSize:12,color:C.muted,lineHeight:1.6}}>
      <strong style={{color:C.yel}}>⚠ Use subgroups responsibly.</strong> Subgroup analyses should be <strong>pre-specified in your protocol</strong>, not chosen after seeing the data. Treat post-hoc subgroups as exploratory only, and be cautious when any subgroup has fewer than ~5 studies — differences can easily arise by chance.
    </div>

    {/* ── OUTCOME SELECTOR — subgroups are computed within ONE outcome ── */}
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
          {outcomePairs.map(p=>(<option key={p.key} value={p.key}>{p.label||p.outcome||"(unnamed)"}</option>))}
        </select>
      )}
      {studies.length>0&&<span style={{fontSize:11,color:C.muted,marginLeft:"auto"}}>{studies.length} estimates</span>}
      <ProportionFilterChips filters={proportionFilters}/>
    </div>

    <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{fontSize:12,color:C.muted}}>Group by:</span>
      {keys.map(k=>(
        <button key={k.id} onClick={()=>setGroupKey(k.id)} style={btnS(activeGroupKey===k.id?"primary":"ghost")}>{k.label}</button>
      ))}
      <span style={{marginLeft:"auto",fontSize:11,color:C.muted}}>·</span>
      {[["random","Random"],["fixed","Fixed"]].map(([m,label])=>(
        <button key={m} onClick={()=>setMethod(m)} style={{...btnS(method===m?"primary":"ghost"),fontSize:11,padding:"4px 10px"}}>{label}</button>
      ))}
      {/* 116.md §30 — the decimal control lives on EVERY Analysis page. */}
      <PrecisionControl prec={prec} onChange={updateProject?setAnalysisPrecision:undefined} onApplyAll={onApplyPrecisionToAll}/>
    </div>

    {/* ── CROSS-PAIR NOTE — this comparison is deliberately NOT pair-scoped ── */}
    {crossRows&&(
      <div style={{background:"var(--t-yel-bg)",border:`1px solid ${themeAlpha(C.yel,'44')}`,borderLeft:`3px solid ${C.yel}`,borderRadius:6,padding:"10px 14px",marginBottom:14,fontSize:12,color:C.muted,lineHeight:1.6}}>
        <strong style={{color:C.yel}}>⚠ {CROSS_PAIR_SCOPE_HEADLINE}</strong>{" "}
        {crossPairScopeNote(activeGroupKey,activeOutcome,scopedRows.length,crossPairs)}
      </div>
    )}

    {!result || result.groups.length===0?(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:40,textAlign:"center",color:C.muted}}>
      <div style={{fontSize:36,marginBottom:10}}>🔬</div>{outcomePairs.length>1&&!effectiveKey
        ?"Select an outcome above — subgroups are computed within a single outcome."
        :"Need at least 2 studies per subgroup"}
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
    {/* P13 — CONTINUOUS sibling of subgroup analysis. Additive + self-gating: it
        renders nothing unless the `metaRegression` flag is ON, so this tab is
        byte-for-byte unchanged when the flag is off. It now regresses the SAME
        outcome-scoped rows the subgroups use (86.md P1.6 — it read raw project.studies). */}
    <MetaRegression project={project} studies={studies}/>
  </div>);
}

/* ════════════ TAB SECTION: META-REGRESSION (P13) ════════════
   Explores heterogeneity with a study-level covariate — the continuous
   complement to SubgroupTab. Additive + flag-gated (`metaRegression`); renders
   null when the flag is off so SubgroupTab is unchanged. Engine is the SAME
   `metaRegression` in the monolithStats barrel (read via the MonolithStats
   namespace so the bundle builds even before the engine lands). */

// Effect/variance/count/identity columns that must NEVER be offered as a
// covariate (they ARE the outcome or its raw inputs, or are free-text labels).
// Everything else is judged data-drivenly below, so free-text fields with many
// distinct values (title/abstract/notes/author) drop out automatically.
const MR_BLOCK = new Set([
  "id", "es", "lo", "hi", "estype", "se", "ci", "cilo", "cihi", "pval", "z", "weight",
  "a", "b", "c", "d", "events", "total", "nexp", "nctrl", "meanexp", "sdexp", "meanctrl", "sdctrl",
  "tp", "fp", "fn", "tn", "source", "converted", "conversions", "flags", "datanature", "adjustednote",
  "needsreview", "rob", "snapshot", "title", "authors", "author", "journal", "doi", "pmid", "pmcid",
  "abstract", "outcome", "primaryoutcome", "secondaryoutcomes", "populationdef", "interventiondef",
  "comparatordef", "funding", "enrollperiod", "notes", "note", "url", "fulltext", "tags", "decision",
  // 107.md §8A — the free-text description behind "Other/custom". It is a DEFINITION,
  // not a variable: two rows sharing the wording are the same denominator, and every
  // other wording is a one-off. `denominatorPopulation`/`actionStatus` stay discoverable
  // as ordinary categorical moderators; this one must never become a covariate.
  "denominatorcustom",
]);

const MR_FIELD_LABEL = {
  year: "Year", n: "Sample size", country: "Country/Region", design: "Study design",
  drugClass: "Drug class", followup: "Follow-up", timepoint: "Time point", adjusted: "Adjustment",
  dataSource: "Data source", meanAge: "Mean age", dose: "Dose", baselineRisk: "Baseline risk",
  region: "Region",
  // 107.md §10 — pretty names so the picker doesn't read "Denominator population" as
  // "Denominatorpopulation" via the camel-case fallback.
  denominatorPopulation: "Denominator population", actionStatus: "Action status",
};

function mrPretty(field) {
  if (!field) return "Covariate";
  if (MR_FIELD_LABEL[field]) return MR_FIELD_LABEL[field];
  const spaced = String(field).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
function mrTypeLabel(t) {
  return { continuous: "Continuous", binary: "Binary", categorical: "Categorical", ordinal: "Ordinal" }[t] || t;
}
function mrIsNum(v) { return v !== "" && v != null && isFinite(Number(v)); }
function mrPctish(v, prec) {
  if (v == null || !isFinite(Number(v))) return "—";
  const n = Number(v);
  const pct = Math.abs(n) <= 1.0000001 ? n * 100 : n;
  return `${fmtNum(pct, prec)}%`;
}

/* Auto-detect candidate covariates from the study rows: numeric → continuous
   (binary if only 2 distinct), few distinct strings → categorical/binary, free
   text → dropped. Users can override the detected type. */
export function detectCovariates(studies) {
  if (!Array.isArray(studies) || !studies.length) return [];
  const keys = new Set();
  studies.forEach((s) => { if (s && typeof s === "object") Object.keys(s).forEach((k) => keys.add(k)); });
  const out = [];
  keys.forEach((k) => {
    if (k.startsWith("_") || MR_BLOCK.has(String(k).toLowerCase())) return;
    const values = studies
      .map((s) => (s ? s[k] : undefined))
      .filter((v) => v !== "" && v != null && typeof v !== "object");
    if (values.length < 3) return; // too sparse to regress on
    const numeric = values.filter(mrIsNum).length;
    const numFrac = numeric / values.length;
    const distinct = new Set(values.map((v) => String(v).trim().toLowerCase())).size;
    let type;
    if (numFrac >= 0.8) {
      if (distinct === 2) type = "binary";
      else if (distinct >= 3) type = "continuous";
      else return; // constant
    } else if (distinct === 2) type = "binary";
    else if (distinct >= 2 && distinct <= 12) type = "categorical";
    else return; // free text
    out.push({ field: k, type, coverage: values.length, distinct, numeric: numFrac >= 0.8 });
  });
  const order = { continuous: 0, ordinal: 1, binary: 2, categorical: 3 };
  out.sort((a, b) => (order[a.type] - order[b.type]) || (b.coverage - a.coverage) || a.field.localeCompare(b.field));
  return out;
}

/* Dominant effect-measure across studies with a numeric ES (mirrors AnalysisTab). */
export function detectRegressionMeasure(studies) {
  if (!Array.isArray(studies)) return "";
  const types = studies.filter((s) => s && s.es !== "" && !isNaN(+s.es)).map((s) => s.esType).filter(Boolean);
  if (!types.length) return "";
  return types.slice().sort((a, b) => types.filter((t) => t === b).length - types.filter((t) => t === a).length)[0];
}

/* Manuscript-ready text (association-only wording — never causal, never "AI"). */
export function buildMetaRegNarrative({ result, measure, covLabel, type, method, prec }) {
  const isLog = !!(measure && ES_TYPES[measure] && ES_TYPES[measure].log);
  const measureName = (ES_TYPES[measure] && ES_TYPES[measure].label) || "effect size";
  const ratioName = ((ES_TYPES[measure] && ES_TYPES[measure].scale) || "effect size").replace("ln", "");
  const est = method === "REML" ? "restricted maximum likelihood (REML)" : "method-of-moments";
  const mods = Array.isArray(result.moderators) ? result.moderators : [];
  const primary = mods.length === 1 ? mods[0] : null;
  const perUnit = type === "continuous" || type === "ordinal";
  const resid = result.residual || {};
  const qeStr = resid.QE != null
    ? `Q_E = ${fmtNum(resid.QE, prec)}, df = ${resid.df}, ${resid.QEp < 0.001 ? "P < 0.001" : "P = " + fmtNum(resid.QEp, prec)}`
    : "not available";
  const coefSentence = primary
    ? `The regression coefficient ${perUnit ? `for each one-unit increase in ${covLabel}` : `for ${primary.name || covLabel}`} was ${fmtNum(primary.coef, prec)} (95% CI ${fmtNum(primary.ciLo, prec)} to ${fmtNum(primary.ciHi, prec)}), ${primary.pval < 0.001 ? "P < 0.001" : "P = " + fmtNum(primary.pval, prec)}${isLog ? ` (a ${ratioName} ratio of ${fmtES(Math.exp(primary.coef), prec)} per unit)` : ""}. ${(primary.pval != null && primary.pval < 0.05) ? "" : "The confidence interval included the null, so this covariate did not explain a statistically detectable amount of heterogeneity. "}`
    : "Coefficients for each moderator level are reported in the results table. ";
  const results = `A ${est} random-effects meta-regression related the ${measureName.toLowerCase()}${isLog ? " (natural-log scale)" : ""} to ${covLabel} across ${result.k} studies${result.kDropped ? ` (${result.kDropped} excluded for missing ${covLabel})` : ""}. ${coefSentence}The covariate explained ${mrPctish(result.R2, prec)} of the between-study variance (τ² ${fmtNum(result.tau2Before, prec)} → ${fmtNum(result.tau2, prec)}); residual heterogeneity was I² = ${mrPctish(result.I2resid, prec)} (${qeStr}). Because meta-regression is observational, this describes an association across studies and does not establish that ${covLabel} causes the difference in effect.`;
  const methods = `Between-study heterogeneity was explored using ${est} random-effects meta-regression, with ${covLabel} entered as a ${type} moderator of the ${measureName.toLowerCase()}${isLog ? ", modelled on the natural-log scale" : ""}. Regression coefficients with 95% confidence intervals, the residual-heterogeneity test (Q_E), and the proportion of between-study variance explained (R²) are reported. Meta-regression associations are study-level and observational and were interpreted as hypothesis-generating rather than causal; approximately ten studies per covariate are recommended, so results based on fewer studies were treated with caution. [State software here — e.g. analyses were verified in R using the metafor package.]`;
  const manuscript = `${results} These meta-regression findings are exploratory: with ${result.k} studies power is limited, aggregate (study-level) covariates are susceptible to ecological bias, and evaluating multiple covariates inflates the false-positive rate.`;
  return { results, methods, manuscript };
}

/* Presentational results block (exported for SSR tests). Given a non-null engine
   result it renders guardrail warnings, the coefficient table, the heterogeneity
   summary, the bubble plot, and the export/copy actions. ok:false → warnings only,
   never a chart. */
export function MetaRegressionResults({ result, measure, covLabel, type, method, prec }) {
  const [copied, setCopied] = useState("");
  const copy = (t, id) => { try { navigator.clipboard.writeText(t).then(() => { setCopied(id); setTimeout(() => setCopied(""), 1600); }); } catch { /* clipboard unavailable */ } };
  if (!result) return null;

  const isLog = !!(measure && ES_TYPES[measure] && ES_TYPES[measure].log);
  const rawScale = (ES_TYPES[measure] && ES_TYPES[measure].scale) || "Effect size";
  const measureName = (ES_TYPES[measure] && ES_TYPES[measure].label) || "effect size";

  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const Warnings = () => (warnings.length > 0 ? (
    <div style={{ marginBottom: 16 }}>
      {warnings.map((w, i) => {
        const err = w && (w.type === "error" || w.severity === "error");
        return (<div key={i} style={{ background: err ? "var(--t-red-bg)" : "var(--t-yel-bg)", border: `1px solid ${themeAlpha(err ? C.red : C.yel, "55")}`, borderLeft: `4px solid ${err ? C.red : C.yel}`, borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: C.txt, lineHeight: 1.6 }}>
            <strong style={{ color: err ? C.red : C.yel }}>{err ? "⛔ " : "⚠ "}</strong>{(w && (w.message || w.msg)) || "Check this analysis before relying on it."}
          </div>
        </div>);
      })}
    </div>
  ) : null);

  if (!result.ok) {
    return (<div>
      <Warnings />
      <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 28, textAlign: "center", color: C.muted }}>
        <div style={{ fontSize: 30, marginBottom: 8 }}>📈</div>
        Meta-regression could not be computed for this covariate{warnings.length ? " — see the notes above." : ". Add more studies with the covariate recorded."}
      </div>
    </div>);
  }

  const terms = [
    { name: "Intercept", ...(result.intercept || {}) },
    ...((result.moderators || []).map((m) => ({ name: (m.name || covLabel) + (m.level ? `: ${m.level}` : ""), ...m }))),
  ];
  const cols = isLog ? ["Term", "Coef (ln)", "exp(coef)", "SE", "95% CI (ln)", "z", "p"] : ["Term", "Coefficient", "SE", "95% CI", "z", "p"];

  const bubble = result.bubble;
  const hasBubble = bubble && Array.isArray(bubble.points) && bubble.points.filter((p) => p && isFinite(Number(p.x)) && isFinite(Number(p.y))).length >= 1;
  const isCategoricalView = type === "categorical" && !(bubble && bubble.line);

  // ---- exports ----
  const esc = (v) => { const x = String(v == null ? "" : v).replace(/"/g, '""'); return /[",\n]/.test(x) ? `"${x}"` : x; };
  const csvBody = terms.map((t) => [t.name, t.coef, t.se, t.ciLo, t.ciHi, t.z, t.pval].map(esc).join(","));
  const resid = result.residual || {};
  const meta = [
    "",
    ["Model", method === "REML" ? "REML random-effects meta-regression" : "Method-of-moments random-effects meta-regression"].map(esc).join(","),
    ["Effect measure", measureName + (isLog ? " (natural-log scale)" : "")].map(esc).join(","),
    ["Covariate", covLabel + ` (${mrTypeLabel(type)})`].map(esc).join(","),
    ["Studies included (k)", result.k].map(esc).join(","),
    ["Studies dropped (missing covariate)", result.kDropped].map(esc).join(","),
    ["tau2 before", result.tau2Before].map(esc).join(","),
    ["tau2 after", result.tau2].map(esc).join(","),
    ["tau2 reduction", result.tau2Reduction].map(esc).join(","),
    ["R2 (variance explained)", result.R2].map(esc).join(","),
    ["Residual I2", result.I2resid].map(esc).join(","),
    ["Residual QE", resid.QE].map(esc).join(","),
    ["Residual QE df", resid.df].map(esc).join(","),
    ["Residual QE p", resid.QEp].map(esc).join(","),
  ].join("\n");
  const csv = "﻿" + [["Term", "Coefficient", "SE", "CI_lower", "CI_upper", "z", "p_value"].join(","), ...csvBody].join("\n") + "\n" + meta;
  const tsv = [["Term", "Coefficient", "SE", "95% CI", "z", "p"].join("\t"), ...terms.map((t) => [t.name, fmtNum(t.coef, prec), fmtNum(t.se, prec), `${fmtNum(t.ciLo, prec)} to ${fmtNum(t.ciHi, prec)}`, fmtNum(t.z, prec), fmtP(t.pval, prec)].join("\t"))].join("\n");
  const narr = buildMetaRegNarrative({ result, measure, covLabel, type, method, prec });
  const blocks = [
    { id: "results", label: "Results paragraph", icon: "📊", text: narr.results },
    { id: "methods", label: "Statistical methods", icon: "🔬", text: narr.methods },
    { id: "manuscript", label: "Manuscript paragraph (with caveats)", icon: "✍️", text: narr.manuscript },
  ];
  const svgTitle = `Meta-regression: ${isLog ? "ln(" + rawScale.replace("ln", "") + ")" : rawScale} vs ${covLabel}`;
  const doSvg = () => { const b = buildBubbleSVG(bubble, { measure, covariateLabel: covLabel, title: svgTitle }); if (b) downloadText(SVG_XML_HEADER + b.svg, "meta-regression_bubble.svg", "image/svg+xml;charset=utf-8"); };
  const doPng = async () => { const b = buildBubbleSVG(bubble, { measure, covariateLabel: covLabel, title: svgTitle }); if (!b) return; const blob = await rasterizeSvg(b.svg, b.W, b.H, { targetWidthPx: 1280, background: "#0e1420" }); downloadBlob(blob, "meta-regression_bubble.png"); };

  return (<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    <Warnings />

    {/* COEFFICIENT TABLE */}
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 16, overflowX: "auto" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 1, marginBottom: 12 }}>REGRESSION COEFFICIENTS{isLog ? " — ON THE LOG SCALE" : ""}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr>{cols.map((h, i) => (<th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>))}</tr></thead>
        <tbody>
          {terms.map((t, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.brd}` }}>
              <td style={{ padding: "6px 10px", fontWeight: i === 0 ? 700 : 500, color: i === 0 ? C.muted : C.txt }}>{t.name}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700 }}>{fmtNum(t.coef, prec)}</td>
              {isLog && <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", color: C.muted }}>{t.coef == null ? "—" : fmtES(Math.exp(t.coef), prec)}</td>}
              <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", color: C.muted }}>{fmtNum(t.se, prec)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", color: C.muted }}>[{fmtNum(t.ciLo, prec)}, {fmtNum(t.ciHi, prec)}]</td>
              <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono',monospace", color: C.muted }}>{fmtNum(t.z, prec)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", color: (t.pval != null && t.pval < 0.05) ? C.grn : C.muted, fontWeight: (t.pval != null && t.pval < 0.05) ? 700 : 400 }}>{fmtP(t.pval, prec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isLog && <div style={{ fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>Coefficients are on the natural-log scale; exp(coef) is the multiplicative change in the {rawScale.replace("ln", "")} per one-unit change in {covLabel}.</div>}
    </div>

    {/* HETEROGENEITY SUMMARY */}
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.acc, letterSpacing: 1, marginBottom: 12 }}>HETEROGENEITY EXPLAINED</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14 }}>
        {[
          { label: "R² (variance explained)", value: mrPctish(result.R2, prec), note: "share of τ² the covariate accounts for", color: C.grn },
          { label: "τ² before → after", value: `${fmtNum(result.tau2Before, prec)} → ${fmtNum(result.tau2, prec)}`, note: `reduction ${mrPctish(result.tau2Reduction, prec)}`, color: C.txt },
          { label: "Residual I²", value: mrPctish(result.I2resid, prec), note: "heterogeneity left unexplained", color: (Number(result.I2resid) > (Number(result.I2resid) <= 1 ? 0.5 : 50)) ? C.yel : C.txt },
          { label: "Residual Q_E", value: resid.QE != null ? fmtNum(resid.QE, prec) : "—", note: resid.QE != null ? `df = ${resid.df} · p ${resid.QEp < 0.001 ? "< 0.001" : "= " + fmtNum(resid.QEp, prec)}` : "", color: C.txt },
          { label: "Studies (k)", value: `${result.k}`, note: result.kDropped ? `${result.kDropped} dropped (missing covariate)` : "all with covariate", color: (result.k < 10) ? C.yel : C.txt },
        ].map((m) => (
          <div key={m.label} style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{m.label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", color: m.color }}>{m.value}</div>
            {m.note && <div style={{ fontSize: 10, color: C.dim, marginTop: 3 }}>{m.note}</div>}
          </div>
        ))}
      </div>
      {result.k < 10 && <div style={{ marginTop: 12, fontSize: 11, color: C.yel, lineHeight: 1.5 }}>⚠ Fewer than ~10 studies per covariate — the coefficient and R² are unstable. Treat this as exploratory.</div>}
    </div>

    {/* BUBBLE PLOT */}
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 1 }}>BUBBLE PLOT</div>
        {hasBubble && <div style={{ display: "flex", gap: 8 }}>
          <button onClick={doSvg} style={{ ...btnS("ghost"), fontSize: 11, padding: "5px 10px" }}>⬇ SVG</button>
          <button onClick={doPng} style={{ ...btnS("ghost"), fontSize: 11, padding: "5px 10px" }}>⬇ PNG</button>
        </div>}
      </div>
      {hasBubble ? (<>
        <BubblePlot bubble={bubble} measure={measure} covariateLabel={covLabel} />
        <div style={{ fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>
          Each bubble is a study (radius ∝ weight); x = {covLabel}, y = effect estimate{isLog ? " on the log scale (axis ticks back-transformed)" : ""}.{(bubble && bubble.line) ? " The line is the fitted regression with its 95% confidence band." : isCategoricalView ? " Points are grouped by level; for categorical moderators the coefficient table above is the primary output." : ""}
        </div>
      </>) : (
        <div style={{ fontSize: 12, color: C.muted, padding: "8px 0" }}>No bubble plot for this covariate — the coefficient table above is the primary output.</div>
      )}
    </div>

    {/* EXPORTS */}
    <div style={{ background: C.card, border: `1px solid ${themeAlpha(C.acc, "55")}`, borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.acc, letterSpacing: 0.5, marginBottom: 10 }}>📤 EXPORT META-REGRESSION</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={() => copy(tsv, "clip")} style={btnS("primary")}>{copied === "clip" ? "✓ Copied table" : "📋 Copy table"}</button>
        <button onClick={() => downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "meta-regression_results.csv")} style={btnS("ghost")}>⬇ Download CSV</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {blocks.map((b) => (
          <div key={b.id} style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 6, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{b.icon} {b.label}</span>
              <button onClick={() => copy(b.text, b.id)} style={{ ...btnS("ghost"), fontSize: 10, padding: "3px 10px" }}>{copied === b.id ? "✓ Copied" : "📋 Copy"}</button>
            </div>
            <div style={{ fontSize: 12.5, color: C.txt, lineHeight: 1.7 }}>{b.text}</div>
          </div>
        ))}
      </div>
    </div>
  </div>);
}

export function MetaRegression({ project, studies: scopedStudies }) {
  // 86.md P1.6 — prefer the outcome-scoped rows the host tab already computed; fall back
  // to the raw blob only for callers that have not been scoped yet.
  const studies = Array.isArray(scopedStudies) ? scopedStudies
    : ((project && Array.isArray(project.studies)) ? project.studies : []);
  const prec = project && project.analysisPrecision;
  const [flagOn, setFlagOn] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/settings/public", { credentials: "include" })
      .then((r) => r.json())
      .then((s) => { if (alive) setFlagOn(!!(s && s.featureFlags && s.featureFlags.metaRegression)); })
      .catch(() => { if (alive) setFlagOn(false); });
    return () => { alive = false; };
  }, []);

  const candidates = useMemo(() => detectCovariates(studies), [studies]);
  const [covariate, setCovariate] = useState("");
  const [typeOverride, setTypeOverride] = useState("");
  const [method, setMethod] = useState("MM");
  // Pick a sensible default covariate once candidates are known (prefer year,
  // then any continuous field, then the first candidate).
  useEffect(() => {
    if (candidates.length && (!covariate || !candidates.find((c) => c.field === covariate))) {
      const pick = candidates.find((c) => c.field === "year") || candidates.find((c) => c.type === "continuous") || candidates[0];
      setCovariate(pick.field); setTypeOverride("");
    }
  }, [candidates, covariate]);

  const active = candidates.find((c) => c.field === covariate) || null;
  const type = typeOverride || (active && active.type) || "continuous";
  const measure = useMemo(() => detectRegressionMeasure(studies), [studies]);
  const covLabel = mrPretty(covariate);
  const engineFn = MonolithStats.metaRegression;
  const engineReady = typeof engineFn === "function";

  const result = useMemo(() => {
    if (!engineReady || !covariate) return null;
    try { return engineFn(studies, { covariate, type, method, measure }); }
    catch (e) { return { ok: false, warnings: [{ type: "error", message: "Meta-regression could not run: " + ((e && e.message) || e) }] }; }
  }, [engineReady, engineFn, studies, covariate, type, method, measure]);

  if (flagOn !== true) return null; // additive no-op: flag off or still loading

  return (<div style={{ marginTop: 32, paddingTop: 26, borderTop: `1px solid ${C.brd}` }}>
    <SectionHeader icon="activity" title="Meta-Regression" desc="Test whether a study-level covariate explains heterogeneity by regressing each study's effect on that covariate — the continuous complement to subgroup analysis." badge={result && result.ok ? `k = ${result.k}` : undefined} />

    <div style={{ background: "var(--t-yel-bg)", border: `1px solid ${themeAlpha(C.yel, "44")}`, borderLeft: `3px solid ${C.yel}`, borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
      <strong style={{ color: C.yel }}>⚠ Use meta-regression responsibly.</strong> Aim for at least ~10 studies per covariate; with fewer, estimates are unstable. Covariates should be <strong>pre-specified</strong>. Associations here are <strong>observational and study-level</strong> — they can be confounded and are prone to ecological bias, so do not read them as causal, and remember that testing several covariates inflates false positives.
    </div>

    {candidates.length === 0 ? (
      <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 32, textAlign: "center", color: C.muted }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📈</div>No usable covariate found. Add study-level fields (e.g. year, sample size, mean age, region) in Data Extraction to run a meta-regression.
      </div>
    ) : (<>
      <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 14, marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6 }}>COVARIATE</span>
          <select value={covariate} onChange={(e) => { setCovariate(e.target.value); setTypeOverride(""); }} style={{ ...inp, width: "auto", minWidth: 200, fontSize: 12, padding: "6px 10px" }}>
            {candidates.map((c) => (<option key={c.field} value={c.field}>{mrPretty(c.field)} · {mrTypeLabel(c.type)} (k={c.coverage})</option>))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6, display: "inline-flex", alignItems: "center" }}>TREAT AS<HelpTip text="Auto-detected from the data (numeric → continuous, a few repeated labels → categorical). Override if the field means something different — e.g. a numeric dose you want treated as ordered categories." /></span>
          <select value={type} onChange={(e) => setTypeOverride(e.target.value)} style={{ ...inp, width: "auto", fontSize: 12, padding: "6px 10px" }}>
            {["continuous", "binary", "categorical", "ordinal"].map((t) => (<option key={t} value={t}>{mrTypeLabel(t)}{active && active.type === t ? " (auto)" : ""}</option>))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.6 }}>ESTIMATOR</span>
          <div style={{ display: "flex", gap: 6 }}>
            {[["MM", "Method of moments"], ["REML", "REML"]].map(([m, label]) => (
              <button key={m} onClick={() => setMethod(m)} style={{ ...btnS(method === m ? "primary" : "ghost"), fontSize: 11, padding: "6px 12px" }}>{label}</button>
            ))}
          </div>
        </div>
        {measure && (
          <div style={{ marginLeft: "auto", fontSize: 11, color: C.muted, alignSelf: "center", lineHeight: 1.5, maxWidth: 240 }}>
            Measure: <strong style={{ color: C.txt }}>{(ES_TYPES[measure] && ES_TYPES[measure].label) || measure}</strong>{(ES_TYPES[measure] && ES_TYPES[measure].log) ? ` — modelled on the log scale; the y-axis and coefficients are on ln(${((ES_TYPES[measure] && ES_TYPES[measure].scale) || "").replace("ln", "")}).` : "."}
          </div>
        )}
      </div>

      {!engineReady ? (
        <InfoBox color={C.muted}>The meta-regression engine is not available in this build yet. The covariate picker and settings above are ready; results will appear here once the engine is enabled.</InfoBox>
      ) : !result ? (
        <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: 28, textAlign: "center", color: C.muted }}>Select a covariate above to run the regression.</div>
      ) : (
        <MetaRegressionResults result={result} measure={measure} covLabel={covLabel} type={type} method={method} prec={prec} />
      )}
    </>)}
  </div>);
}
