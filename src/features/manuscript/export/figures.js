/**
 * features/manuscript/export/figures.js — 64.md (P3). CLIENT-side figure helpers:
 * render the forest plot and the PRISMA 2020 flow diagram to SVG (pure builders
 * reused from the analysis engine) and rasterize them to PNG for Word embedding.
 *
 * rasterizeSvg uses the DOM canvas, so this module is browser-only and must be
 * imported lazily from the export path (never from the pure engine).
 */
import { buildPubForestSVG, buildPrismaSVG, buildFunnelSVG } from '../../../frontend/workspace/charts/svgBuilders.js';
// buildTrafficLightSVG is a PURE exported string builder — importing it from the
// RoB feature module is safe here (this whole module is a lazy browser chunk).
import { buildTrafficLightSVG } from '../../../frontend/rob/RobTrafficLight.jsx';
import { rasterizeSvg } from '../../../frontend/components/exportCore.js';
import { countsToPrismaShape } from '../../../research-engine/manuscript/index.js';

/**
 * Render a forest-plot PNG from a runMeta result.
 * @returns {Promise<{blob:Blob,width:number,height:number,svg:string}>|null}
 */
export async function forestPng(result, opts = {}) {
  if (!result) return null;
  const built = buildPubForestSVG(result, { esType: opts.esType, title: opts.title, prec: opts.prec });
  if (!built || !built.svg) return null;
  const targetWidthPx = opts.targetWidthPx || 1100;
  const blob = await rasterizeSvg(built.svg, built.W, built.H, { targetWidthPx, background: '#ffffff' });
  return { blob, width: targetWidthPx, height: Math.round((built.H / built.W) * targetWidthPx), svg: built.svg };
}

/**
 * Render a PRISMA 2020 flow PNG from a computePrismaCounts() result (or a raw
 * prisma-shape object).
 * @returns {Promise<{blob:Blob,width:number,height:number,svg:string}>}
 */
export async function prismaPng(prismaResultOrShape, opts = {}) {
  const isResult = prismaResultOrShape && prismaResultOrShape.counts;
  const shape = isResult ? countsToPrismaShape(prismaResultOrShape) : (prismaResultOrShape || {});
  const resolved = isResult ? prismaResultOrShape.counts : undefined;
  const built = buildPrismaSVG(shape, { title: opts.title || '', resolved });
  if (!built || !built.svg) return null;
  const targetWidthPx = opts.targetWidthPx || 900;
  const blob = await rasterizeSvg(built.svg, built.W, built.H, { targetWidthPx, background: '#ffffff' });
  return { blob, width: targetWidthPx, height: Math.round((built.H / built.W) * targetWidthPx), svg: built.svg };
}

/**
 * Render a funnel-plot PNG from a runMeta result (85.md B1 buildFunnelSVG).
 * Mirrors forestPng; null when <3 usable studies (same guard as the Analysis tab).
 * @returns {Promise<{blob:Blob,width:number,height:number,svg:string}>|null}
 */
export async function funnelPng(result, opts = {}) {
  if (!result) return null;
  const built = buildFunnelSVG(result, { esType: opts.esType, title: opts.title, prec: opts.prec });
  if (!built || !built.svg) return null;
  const targetWidthPx = opts.targetWidthPx || 2200;
  const blob = await rasterizeSvg(built.svg, built.W, built.H, { targetWidthPx, background: '#ffffff' });
  return { blob, width: targetWidthPx, height: Math.round((built.H / built.W) * targetWidthPx), svg: built.svg };
}

/* RoB display labels (manuscriptData.mapRobAssessments output) → the judgment
   keys buildTrafficLightSVG/judgmentStyle understand. */
const ROB_LABEL_TO_KEY = {
  low: 'low',
  'some concerns': 'some',
  high: 'high',
  moderate: 'moderate',
  serious: 'serious',
  critical: 'critical',
  'no information': 'ni',
};

/**
 * Convert the manuscript's structured RoB map into the traffic-light matrix
 * shape ({domains, rows, instrumentId}). Row order follows project studies;
 * assessed ids without a matching study append after (labelled by id). PURE —
 * exported for unit tests.
 * @param {object} assessments { [studyId]: { domains:{D1:'Low',…}, overall, tool } }
 * @param {Array}  studies     project.studies (labels)
 */
export function robMatrixFromAssessments(assessments, studies = []) {
  const byId = (assessments && typeof assessments === 'object') ? assessments : {};
  const ids = Object.keys(byId);
  if (!ids.length) return null;
  const key = (label) => ROB_LABEL_TO_KEY[String(label == null ? '' : label).toLowerCase().trim()] || 'na';
  // Stable domain order: first-seen across the study order below.
  const studyOrder = [];
  const seen = new Set();
  for (const s of (Array.isArray(studies) ? studies : [])) {
    if (s && s.id && byId[s.id]) { studyOrder.push(s); seen.add(s.id); }
  }
  for (const id of ids) if (!seen.has(id)) studyOrder.push({ id });
  const domains = [];
  const domSeen = new Set();
  for (const s of studyOrder) {
    const dj = (byId[s.id] && byId[s.id].domains) || {};
    for (const d of Object.keys(dj)) {
      if (!domSeen.has(d)) { domSeen.add(d); domains.push({ id: d, shortLabel: d }); }
    }
  }
  const label = (s) => {
    const author = String(s.authors || '').split(',')[0].trim();
    if (author) return s.year ? `${author} ${s.year}` : author;
    return s.title || s.id;
  };
  const rows = studyOrder.map((s) => {
    const a = byId[s.id] || {};
    const dj = a.domains || {};
    return {
      label: label(s),
      cells: domains.map((d) => ({ domainId: d.id, judgment: dj[d.id] != null ? key(dj[d.id]) : 'na' })),
      overall: key(a.overall),
    };
  });
  const withTool = ids.map((id) => byId[id]).find((a) => a && a.tool);
  return { domains, rows, instrumentId: (withTool && withTool.tool) || undefined };
}

/**
 * Render the RoB traffic-light PNG from the structured assessments map.
 * @returns {Promise<{blob:Blob,width:number,height:number,svg:string}>|null}
 */
export async function robPng(assessments, opts = {}) {
  const matrix = opts.matrix || robMatrixFromAssessments(assessments, opts.studies);
  if (!matrix || !matrix.rows.length) return null;
  const built = buildTrafficLightSVG(matrix, { title: opts.title || 'Risk of bias' });
  if (!built || !built.svg) return null;
  const targetWidthPx = opts.targetWidthPx || 1800;
  const blob = await rasterizeSvg(built.svg, built.width, built.height, { targetWidthPx, background: '#ffffff' });
  return { blob, width: targetWidthPx, height: Math.round((built.height / built.width) * targetWidthPx), svg: built.svg };
}

/** Forest SVG string (no rasterization) for the repro bundle. */
export function forestSvg(result, opts = {}) {
  if (!result) return null;
  const built = buildPubForestSVG(result, { esType: opts.esType, title: opts.title, prec: opts.prec });
  return built ? built.svg : null;
}

/** PRISMA SVG string (no rasterization) for the repro bundle. */
export function prismaSvg(prismaResultOrShape, opts = {}) {
  const isResult = prismaResultOrShape && prismaResultOrShape.counts;
  const shape = isResult ? countsToPrismaShape(prismaResultOrShape) : (prismaResultOrShape || {});
  const resolved = isResult ? prismaResultOrShape.counts : undefined;
  const built = buildPrismaSVG(shape, { title: opts.title || '', resolved });
  return built ? built.svg : null;
}

export default { forestPng, prismaPng, funnelPng, robPng, robMatrixFromAssessments, forestSvg, prismaSvg };
