/**
 * features/manuscript/export/figures.js — 64.md (P3). CLIENT-side figure helpers:
 * render the forest plot and the PRISMA 2020 flow diagram to SVG (pure builders
 * reused from the analysis engine) and rasterize them to PNG for Word embedding.
 *
 * rasterizeSvg uses the DOM canvas, so this module is browser-only and must be
 * imported lazily from the export path (never from the pure engine).
 */
import { buildPubForestSVG, buildPrismaSVG } from '../../../frontend/workspace/charts/svgBuilders.js';
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

export default { forestPng, prismaPng, forestSvg, prismaSvg };
