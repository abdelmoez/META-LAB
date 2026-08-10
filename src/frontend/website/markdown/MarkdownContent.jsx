/**
 * MarkdownContent.jsx — renders a parseMarkdown() AST as React elements.
 *
 * 111.md §35 — no dangerouslySetInnerHTML anywhere: every node becomes a real
 * element, so author text is escaped by React and raw HTML in a content file
 * is displayed literally instead of being executed.
 *
 * Pure and SSR-safe: no hooks, no window/document access, deterministic output
 * so the build-time prerenderer produces the same markup as the browser.
 */

import { C, FONT, MONO } from '../../theme/tokens.js';
import { parseBlocks, slugify, inlineText } from './parseMarkdown.js';

const OUTBOUND_REL = 'noopener noreferrer';

function isExternal(href) {
  return /^https?:\/\//i.test(href);
}

function renderInline(nodes, keyPrefix) {
  return (nodes || []).map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    if (node.type === 'text') return node.value;
    if (node.type === 'strong') {
      return <strong key={key} style={{ fontWeight: 700, color: C.txt }}>{renderInline(node.children, key)}</strong>;
    }
    if (node.type === 'em') return <em key={key}>{renderInline(node.children, key)}</em>;
    if (node.type === 'code') {
      return (
        <code key={key} style={{ fontFamily: MONO, fontSize: '0.92em', background: C.card2 || C.surf, border: `1px solid ${C.brd}`, borderRadius: 4, padding: '1px 5px' }}>
          {node.value}
        </code>
      );
    }
    if (node.type === 'link') {
      const external = isExternal(node.href);
      return (
        <a
          key={key}
          href={node.href}
          {...(external ? { target: '_blank', rel: OUTBOUND_REL } : {})}
          style={{ color: C.acc, textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
          {renderInline(node.children, key)}
        </a>
      );
    }
    return null;
  });
}

const HEADING_STYLE = {
  2: { fontSize: 'clamp(22px, 2.6vw, 28px)', fontWeight: 800, letterSpacing: '-0.025em', margin: '48px 0 14px', lineHeight: 1.24 },
  3: { fontSize: 'clamp(17px, 2vw, 20px)', fontWeight: 700, letterSpacing: '-0.015em', margin: '32px 0 10px', lineHeight: 1.34 },
  4: { fontSize: 16, fontWeight: 700, margin: '24px 0 8px', lineHeight: 1.4 },
};

function renderBlock(block, i) {
  const key = `b${i}`;
  if (block.type === 'heading') {
    const level = Math.min(Math.max(block.level, 2), 4);
    const Tag = `h${level}`;
    const text = inlineText(block.children);
    return (
      <Tag key={key} id={slugify(text)} style={{ ...HEADING_STYLE[level], color: C.txt, fontFamily: FONT }}>
        {renderInline(block.children, key)}
      </Tag>
    );
  }
  if (block.type === 'paragraph') {
    return (
      <p key={key} style={{ fontSize: 16.5, lineHeight: 1.78, color: C.txt2, margin: '0 0 18px' }}>
        {renderInline(block.children, key)}
      </p>
    );
  }
  if (block.type === 'list') {
    const Tag = block.ordered ? 'ol' : 'ul';
    return (
      <Tag key={key} style={{ margin: '0 0 20px', paddingLeft: 24, color: C.txt2, fontSize: 16.5, lineHeight: 1.78 }}>
        {block.items.map((item, j) => (
          <li key={`${key}-${j}`} style={{ margin: '0 0 8px' }}>{renderInline(item, `${key}-${j}`)}</li>
        ))}
      </Tag>
    );
  }
  if (block.type === 'quote') {
    return (
      <blockquote key={key} style={{ margin: '0 0 22px', padding: '12px 20px', borderLeft: `3px solid ${C.acc}`, background: C.accBg, color: C.txt2, fontSize: 16, lineHeight: 1.7, borderRadius: '0 8px 8px 0' }}>
        {renderInline(block.children, key)}
      </blockquote>
    );
  }
  if (block.type === 'code') {
    return (
      <pre key={key} style={{ margin: '0 0 22px', padding: '16px 18px', background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 10, overflowX: 'auto', fontFamily: MONO, fontSize: 13.5, lineHeight: 1.65, color: C.txt2 }}>
        <code>{block.value}</code>
      </pre>
    );
  }
  if (block.type === 'hr') {
    return <hr key={key} style={{ border: 0, borderTop: `1px solid ${C.brd}`, margin: '40px 0' }} />;
  }
  return null;
}

/**
 * @param {{ blocks?: object[], source?: string }} props
 * Pass a pre-parsed `blocks` array, or a raw markdown `source` string.
 */
export function MarkdownContent({ blocks, source }) {
  const nodes = blocks || parseBlocks(source || '');
  return <div style={{ fontFamily: FONT }}>{nodes.map(renderBlock)}</div>;
}

export default MarkdownContent;
