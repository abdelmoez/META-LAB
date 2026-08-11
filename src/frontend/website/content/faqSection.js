/**
 * faqSection.js — renders a registry entry's `faq` array as Markdown.
 *
 * 113 W1-A. FAQPage schema that does not match the visible copy is a hard
 * prohibition (111.md §17), and the only reliable way to guarantee parity is to
 * make divergence impossible. HOMEPAGE_FAQ solves this for '/' by having
 * Landing.jsx render the same array the '/' entry builds FAQPage from; the
 * pages added in this round solve it the same way, one level down: the array
 * lives on the PUBLIC_PAGES entry as `faq`, the entry's jsonLd passes it to
 * faqJsonLd(), and the content document interpolates THIS function's output —
 * so both sides read the same objects.
 *
 * Pure module: no I/O, no window access, safe for the build prerenderer. It
 * imports publicPages.js (which is itself dependency-free), never the reverse.
 */

import { getPublicPage } from '../publicPages.js';

/**
 * Markdown for one FAQ: each question an h3, each answer a paragraph.
 * @param {string} path registry path carrying the `faq` array
 * @returns {string} markdown block (no trailing newline)
 */
export function faqMarkdown(path) {
  const entry = getPublicPage(path);
  if (!entry) throw new Error(`faqMarkdown: ${path} is not a registry page`);
  if (!Array.isArray(entry.faq) || !entry.faq.length) {
    throw new Error(`faqMarkdown: ${path} carries no faq array`);
  }
  return entry.faq.map(item => `### ${item.question}\n\n${item.answer}`).join('\n\n');
}

export default faqMarkdown;
