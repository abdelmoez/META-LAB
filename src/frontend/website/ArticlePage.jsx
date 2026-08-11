/**
 * ArticlePage.jsx — renders one content document inside the public page shell.
 *
 * 111.md §§9, 24, 31 — one component for every markdown-backed public page, so
 * heading hierarchy, breadcrumbs, byline and "last reviewed" date are identical
 * everywhere and cannot drift per page.
 *
 * SSR-safe: pure function, no hooks, no window/document, no router context.
 */

import { PageShell, RelatedLinks } from './PageShell.jsx';
import { MarkdownContent } from './markdown/MarkdownContent.jsx';
import { inlineText } from './markdown/parseMarkdown.js';
import { getDoc } from './content/index.js';
import { resolveRelated } from './publicPages.js';

/**
 * Derives the visible lede from the document's first paragraph, so the page
 * summary and the meta description come from the same authored text and cannot
 * contradict each other.
 */
function firstParagraph(blocks) {
  const block = (blocks || []).find(b => b.type === 'paragraph');
  return block ? inlineText(block.children) : '';
}

/** Strips the lede paragraph from the body so it is not printed twice. */
function bodyBlocks(blocks) {
  const idx = (blocks || []).findIndex(b => b.type === 'paragraph');
  if (idx === -1) return blocks || [];
  return [...blocks.slice(0, idx), ...blocks.slice(idx + 1)];
}

/**
 * @param {object} props
 * @param {string} props.slug          content-document slug; the route path is `/${slug}`
 * @param {string} props.relatedTitle  heading for the related block ("Continue reading", …)
 * @param {Record<string,string>} props.relatedNotes
 *        targetPath → the one-line note shown beside that link. 113 §5 — WHICH pages
 *        appear, and in what order, comes from the registry entry's `related` array
 *        (resolveRelated); this prop only decorates them. A page therefore cannot
 *        render an onward link the internal-link graph does not know about, which is
 *        what the orphan test in publicPagesRegistry.test.js relies on.
 */
export function ArticlePage({ slug, eyebrow, trail, relatedNotes, relatedTitle, footerCta }) {
  const doc = getDoc(slug);
  const { frontmatter, blocks } = doc;
  const related = resolveRelated(`/${slug}`, relatedNotes);
  return (
    <PageShell
      eyebrow={eyebrow}
      h1={frontmatter.h1 || frontmatter.title.split('|')[0].split(' — ')[0].trim()}
      lede={firstParagraph(blocks)}
      trail={trail}
      updated={frontmatter.updated}
      author={frontmatter.author}
      footerCta={footerCta}
    >
      <article>
        <MarkdownContent blocks={bodyBlocks(blocks)} />
      </article>
      <RelatedLinks title={relatedTitle} links={related} />
    </PageShell>
  );
}

export default ArticlePage;
