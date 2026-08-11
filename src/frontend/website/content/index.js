/**
 * content/index.js — the content-file registry.
 *
 * 111.md §35 — "the infrastructure, not a CMS". Every public article body is a
 * Markdown document stored in this directory. Adding an article is: drop a file
 * here, add one line below, add one registry entry in publicPages.content.js.
 *
 * WHY THE BODIES ARE .js FILES CONTAINING MARKDOWN, NOT .md FILES
 * The Markdown has to be readable by three runtimes that do not share a loader:
 * the Vite browser build, the build-time prerenderer (plain node running
 * react-dom/server), and vitest. A `?raw` import works only in the first, and
 * adding a loader plugin for the other two is a bigger change than this round
 * should make. A module exporting a template literal is loadable everywhere
 * with zero configuration, and the authoring experience is unchanged: the file
 * is frontmatter plus Markdown between two backticks.
 *
 * Pure module: parsing happens once at import, no I/O, no window access.
 */

import { parseMarkdown } from '../markdown/parseMarkdown.js';

import aboutSource from './about.js';
import featuresIndexSource from './features-index.js';
import featuresSearchEngineSource from './features-search-engine.js';
import featuresScreeningSource from './features-screening.js';
import featuresDataExtractionSource from './features-data-extraction.js';
import featuresMetaAnalysisSource from './features-meta-analysis.js';
import featuresManuscriptSource from './features-manuscript.js';
import resourcesIndexSource from './resources-index.js';
import resourcesWhatIsSource from './resources-what-is-a-systematic-review.js';
import resourcesPrismaSource from './resources-prisma-2020-explained.js';
import resourcesScreeningSource from './resources-title-and-abstract-screening.js';
import resourcesMetaAnalysisSource from './resources-how-to-run-a-meta-analysis.js';

// 113 W1-A — commercial + feature + comparison pages.
import systematicReviewSoftwareSource from './systematic-review-software.js';
import aiSystematicReviewSource from './ai-systematic-review.js';
import featuresRiskOfBiasSource from './features-risk-of-bias.js';
import featuresPrismaFlowSource from './features-prisma-flow-diagram.js';
import featuresNetworkMetaAnalysisSource from './features-network-meta-analysis.js';
import featuresCaseSeriesSource from './features-case-series.js';
import compareIndexSource from './compare-index.js';
import compareCovidenceSource from './compare-pecanrev-vs-covidence.js';
import compareRayyanSource from './compare-pecanrev-vs-rayyan.js';

// 113 W1-B — methodology guides under /resources.
import resourcesConductSource from './resources-how-to-conduct-a-systematic-review.js';
import resourcesSearchStrategySource from './resources-systematic-review-search-strategy.js';
import resourcesDataExtractionSource from './resources-data-extraction-for-systematic-reviews.js';
import resourcesRiskOfBiasSource from './resources-risk-of-bias-assessment.js';
import resourcesForestPlotsSource from './resources-forest-plots-and-heterogeneity.js';
import resourcesPublicationBiasSource from './resources-publication-bias.js';
import resourcesNetworkMetaAnalysisSource from './resources-network-meta-analysis-explained.js';
import resourcesPrismaFlowSource from './resources-prisma-flow-diagram-guide.js';

const SOURCES = {
  'about': aboutSource,
  'features': featuresIndexSource,
  'features/search-engine': featuresSearchEngineSource,
  'features/screening': featuresScreeningSource,
  'features/data-extraction': featuresDataExtractionSource,
  'features/meta-analysis': featuresMetaAnalysisSource,
  'features/manuscript': featuresManuscriptSource,
  'resources': resourcesIndexSource,
  'resources/what-is-a-systematic-review': resourcesWhatIsSource,
  'resources/prisma-2020-explained': resourcesPrismaSource,
  'resources/title-and-abstract-screening': resourcesScreeningSource,
  'resources/how-to-run-a-meta-analysis': resourcesMetaAnalysisSource,
  // 113 W1-A
  'systematic-review-software': systematicReviewSoftwareSource,
  'ai-systematic-review': aiSystematicReviewSource,
  'features/risk-of-bias': featuresRiskOfBiasSource,
  'features/prisma-flow-diagram': featuresPrismaFlowSource,
  'features/network-meta-analysis': featuresNetworkMetaAnalysisSource,
  'features/case-series': featuresCaseSeriesSource,
  'compare': compareIndexSource,
  'compare/pecanrev-vs-covidence': compareCovidenceSource,
  'compare/pecanrev-vs-rayyan': compareRayyanSource,
  // 113 W1-B
  'resources/how-to-conduct-a-systematic-review': resourcesConductSource,
  'resources/systematic-review-search-strategy': resourcesSearchStrategySource,
  'resources/data-extraction-for-systematic-reviews': resourcesDataExtractionSource,
  'resources/risk-of-bias-assessment': resourcesRiskOfBiasSource,
  'resources/forest-plots-and-heterogeneity': resourcesForestPlotsSource,
  'resources/publication-bias': resourcesPublicationBiasSource,
  'resources/network-meta-analysis-explained': resourcesNetworkMetaAnalysisSource,
  'resources/prisma-flow-diagram-guide': resourcesPrismaFlowSource,
};

/** Required frontmatter keys. A document missing one is a build-time bug. */
export const REQUIRED_FRONTMATTER = ['title', 'description', 'slug', 'published', 'updated', 'author'];

function build() {
  const docs = {};
  for (const [slug, source] of Object.entries(SOURCES)) {
    const { frontmatter, blocks } = parseMarkdown(source);
    docs[slug] = {
      slug,
      path: `/${slug}`,
      frontmatter,
      blocks,
      source,
    };
  }
  return docs;
}

/** slug -> { slug, path, frontmatter, blocks, source } */
export const DOCS = build();

/** Throws if any document is missing required frontmatter. Used by tests. */
export function validateDocs(docs = DOCS) {
  const problems = [];
  for (const doc of Object.values(docs)) {
    for (const key of REQUIRED_FRONTMATTER) {
      if (!doc.frontmatter[key]) problems.push(`${doc.slug}: missing frontmatter "${key}"`);
    }
    if (doc.frontmatter.slug && doc.frontmatter.slug !== doc.slug) {
      problems.push(`${doc.slug}: frontmatter slug "${doc.frontmatter.slug}" does not match its key`);
    }
    if (!doc.blocks.some(b => b.type === 'heading' && b.level === 2)) {
      problems.push(`${doc.slug}: has no h2 section headings`);
    }
    if (doc.blocks.some(b => b.type === 'heading' && b.level < 2)) {
      problems.push(`${doc.slug}: content must not contain an h1 (the page shell owns it)`);
    }
  }
  return problems;
}

export function getDoc(slug) {
  const doc = DOCS[slug];
  if (!doc) throw new Error(`Unknown content document: ${slug}`);
  return doc;
}

export default DOCS;
