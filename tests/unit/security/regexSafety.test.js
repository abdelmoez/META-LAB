/**
 * regexSafety.test.js — ReDoS / regex-injection guard (prompt 53, WS3). Pins the
 * invariant that user-supplied search/highlight terms are ESCAPED to literals
 * before reaching a RegExp constructor, so (a) attacker regex metacharacters are
 * inert and (b) a catastrophic-backtracking "pattern" typed as a search term
 * cannot blow up — it becomes a literal string match (linear time).
 */
import { describe, it, expect } from 'vitest';
import { escapeRegExp as escapeHighlight } from '../../../src/research-engine/screening/highlight.js';
import { escapeRegExp as escapePdf } from '../../../src/frontend/components/pdfSearch.js';

const META = 'a.b*c+d?e^f$g(h)i[j]k{l}m|n\\o';

describe.each([
  ['screening/highlight', escapeHighlight],
  ['pdf-search', escapePdf],
])('escapeRegExp (%s)', (_name, escapeRegExp) => {
  it('escapes every regex metacharacter', () => {
    const escaped = escapeRegExp(META);
    // a RegExp built from the escaped term matches the ORIGINAL string literally
    expect(new RegExp(escaped).test(META)).toBe(true);
    // and does NOT act as a pattern (e.g. "a.b" must not match "axb")
    expect(new RegExp(escapeRegExp('a.b')).test('axb')).toBe(false);
    expect(new RegExp(escapeRegExp('a.b')).test('a.b')).toBe(true);
  });

  it('neutralizes a catastrophic-backtracking payload typed as a search term', () => {
    // Classic ReDoS pattern entered as a literal search term.
    const evilTerm = '(a+)+$';
    const re = new RegExp(escapeRegExp(evilTerm)); // escaped → literal, not a bomb
    const hostile = 'a'.repeat(100_000) + '!';      // would hang an unescaped (a+)+$
    const t0 = Date.now();
    const matched = re.test(hostile);               // searching for the literal "(a+)+$"
    const ms = Date.now() - t0;
    expect(matched).toBe(false);
    expect(ms).toBeLessThan(2000);                  // generous bound; linear in practice
  });

  it('empty / nullish input is safe', () => {
    expect(escapeRegExp('')).toBe('');
    expect(() => new RegExp(escapeRegExp(''))).not.toThrow();
  });
});
