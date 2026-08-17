/**
 * 121.md §1 — the Symbols menu, pinned.
 *
 * Three kinds of assertion, each where it belongs:
 *
 *  1. THE CATALOGUE IS DATA, so its rules are pure and every row is checked. §1's
 *     "Exclude invisible characters, control characters, and symbols that cannot be
 *     safely stored or exported" is not a review promise here — it is
 *     `validateSymbolEntry` run over the whole catalogue, plus a mdToHtml∘htmlToMd
 *     round-trip of EVERY character, which is the actual definition of "can be safely
 *     stored" in a manuscript model that IS a markdown subset.
 *
 *  2. THE SEARCH NORMALISER, because §1 asks for five different ways to find one
 *     symbol (name, alias, character, code point, LaTeX name) and each is a rule
 *     rather than a UI detail.
 *
 *  3. SSR PINS for the picker: the ARIA surface, closed-on-first-paint, and the
 *     persistence key. This repo has no jsdom, so the interaction proof (bookmark →
 *     search → insert at the exact I-beam → undo → reload) is
 *     e2e/manuscript/manuscript-symbols-121.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readSource } from '../../helpers/readSource.js';
import {
  SYMBOL_CATEGORIES, ALL_SYMBOLS, MARKDOWN_UNSAFE_ASCII, SYMBOL_FONT_STACK,
  codePointsOf, symbolByChar, symbolByCp, buildSymbolSearch, searchSymbols,
  validateSymbolEntry, symbolPrefsKey, normalizeSymbolPrefs, clampSymbolPrefs,
  pushRecent, toggleFavorite, SYMBOL_RECENTS_CAP, SYMBOL_PREFS_BYTE_CAP,
} from '../../../src/features/manuscript/richEditor/symbolCatalog.js';
import { SymbolPicker } from '../../../src/features/manuscript/richEditor/SymbolPicker.jsx';
import { RichToolbar, RICH_EDITOR_CSS } from '../../../src/features/manuscript/richEditor/RichSectionEditor.jsx';
import { mdToHtml, htmlToMd } from '../../../src/features/manuscript/richEditor/mdDom.js';

const EDITOR = readSource('src/features/manuscript/richEditor/RichSectionEditor.jsx');
const PANELS = readSource('src/features/manuscript/manuscriptPanels.jsx');
const PICKER = readSource('src/features/manuscript/richEditor/SymbolPicker.jsx');

describe('121.md §1 — the catalogue is data, and every row is safe', () => {
  it('covers the groups §1 names, with a genuinely comprehensive body of entries', () => {
    const ids = SYMBOL_CATEGORIES.map((c) => c.id);
    for (const id of [
      'greek-lower', 'greek-upper', 'operators', 'comparison', 'statistics', 'calculus',
      'set-theory', 'logic', 'arrows', 'geometry', 'superscript', 'subscript', 'units',
      'equation', 'scientific', 'editorial', 'currency',
    ]) expect(ids, id).toContain(id);
    expect(ALL_SYMBOLS.length).toBeGreaterThan(300);
    // §1's own example line, end to end — including the "square too"
    for (const ch of 'αβγδεθλμπρστφχψωΔΣΩ±∓×÷·√∛∞≈≠≤≥∝∑∏∫∮∂∇∈∉∪∩⊂⊆∀∃∴→←↔⇒⇔°℃℉µÅ†‡§¶□') {
      expect(symbolByChar(ch), `${ch} (${codePointsOf(ch)})`).toBeTruthy();
    }
  });

  it('EVERY entry passes the per-entry invariants', () => {
    /* The rule that keeps one data row from corrupting a manuscript: no markdown
       metacharacter, no control/format/invisible character, NFC-stable, and never a
       lone combining mark (x̄ is legal only as the whole grapheme). */
    for (const sym of ALL_SYMBOLS) {
      const v = validateSymbolEntry(sym);
      expect(v.problems.join('; '), `${sym.name} ${sym.cp}`).toBe('');
      expect(v.ok).toBe(true);
    }
  });

  it('the validator actually REFUSES the things it exists to refuse', () => {
    const bad = (ch) => validateSymbolEntry({ ch, name: 'x', aliases: [], latex: null, cp: codePointsOf(ch) });
    for (const ch of ['|', '*', '`', '[', ']', '#', '-', '_']) {
      expect(bad(ch).ok, ch).toBe(false);              // markdown metacharacters
      expect(MARKDOWN_UNSAFE_ASCII.has(ch)).toBe(true);
    }
    expect(bad('\u00A0').ok).toBe(false);        // nbsp — silently folded to a space on every save
    expect(bad('\u200B').ok).toBe(false);        // zero-width space
    expect(bad('\u202E').ok).toBe(false);        // right-to-left override
    expect(bad('\u0007').ok).toBe(false);        // control character
    expect(bad('\uFEFF').ok).toBe(false);        // byte-order mark
    expect(bad('\u0304').ok).toBe(false);        // a LONE combining macron
    expect(bad('e\u0301').ok).toBe(false);       // not NFC-stable (composes to \u00E9)
    expect(bad('x\u0304').ok).toBe(true);        // …but the full grapheme is fine
    // a row whose cp disagrees with its own character is a data error
    expect(validateSymbolEntry({ ch: 'α', name: 'a', aliases: [], latex: null, cp: 'U+0000' }).ok).toBe(false);
  });

  it('no category repeats a character, and the derived code point describes it', () => {
    for (const cat of SYMBOL_CATEGORIES) {
      const seen = new Set();
      for (const sym of cat.symbols) {
        expect(seen.has(sym.ch), `${cat.id} ${sym.ch}`).toBe(false);
        seen.add(sym.ch);
        expect(sym.cp).toBe(codePointsOf(sym.ch));
      }
    }
    expect(codePointsOf('α')).toBe('U+03B1');
    expect(codePointsOf('x̄')).toBe('U+0078 U+0304');
    expect(symbolByCp('U+03B1').ch).toBe('α');
  });

  it('EVERY catalogue character survives the manuscript model unchanged', () => {
    /* The real definition of "can be safely stored or exported": what the editor
       renders from markdown and what the serializer writes back must be the same
       string. Anything that fails here is a character that would silently mutate on
       the researcher's next save. */
    for (const sym of ALL_SYMBOLS) {
      const inSentence = `Values were ${sym.ch} in the cohort.`;
      expect(htmlToMd(mdToHtml(inSentence)), sym.cp).toBe(inSentence);
      expect(htmlToMd(mdToHtml(sym.ch)), sym.cp).toBe(sym.ch);
    }
  });
});

describe('121.md §1 — the search normaliser', () => {
  it('finds a symbol by name, alias, character, LaTeX name and code point', () => {
    const chars = (q) => searchSymbols(q).map((x) => x.ch);
    expect(chars('alpha')).toContain('α');            // name
    expect(chars('standard deviation')).toContain('σ'); // alias
    expect(chars('≤')).toContain('≤');                // the character itself
    expect(chars('\\leq')).toContain('≤');            // LaTeX, with the backslash
    expect(chars('leq')).toContain('≤');              // …and without it
    expect(chars('U+00B0')).toContain('°');           // code point, U+ form
    expect(chars('00b0')).toContain('°');             // padded hex
    expect(chars('0xb0')).toContain('°');             // 0x form
    expect(chars('therefore')).toContain('∴');
    expect(chars('per mille')).toContain('‰');
  });

  it('terms are ANDed, results are de-duplicated, and an empty query matches nothing', () => {
    expect(searchSymbols('')).toEqual([]);
    expect(searchSymbols('   ')).toEqual([]);
    const sampleMean = searchSymbols('sample mean').map((x) => x.ch);
    expect(sampleMean).toContain('x̄');
    expect(sampleMean).not.toContain('α');
    // ° is deliberately in two categories; the search must still offer it once
    const deg = searchSymbols('degree sign');
    expect(deg.filter((x) => x.ch === '°')).toHaveLength(1);
    expect(searchSymbols('definitely not a symbol name')).toEqual([]);
  });

  it('the haystack is lowercase and carries all five searchable forms', () => {
    const hay = buildSymbolSearch(symbolByChar('≤'));
    expect(hay).toBe(hay.toLowerCase());
    expect(hay).toContain('less-than or equal to');
    expect(hay).toContain('\\leq');
    expect(hay).toContain('leq');
    expect(hay).toContain('u+2264');
    expect(hay).toContain('0x2264');
    expect(hay).toContain('≤');
  });
});

describe('121.md §1 — Recently Used and Favorites are per-user reading state', () => {
  it('lives under the house per-user localStorage key, never in the project blob', () => {
    expect(symbolPrefsKey('u1')).toBe('metalab.symbolPicker.u1');
    expect(symbolPrefsKey(null)).toBe(null);
    // the picker persists through localStorage only — nothing reaches the draft
    expect(PICKER).toContain('localStorage.setItem(key, JSON.stringify(clampSymbolPrefs(prefs)));');
    expect(PICKER).not.toMatch(/setDraft|updateSection|onChange\(/);
  });

  it('recents are most-recent-first, de-duplicated and capped', () => {
    let prefs = normalizeSymbolPrefs(null);
    expect(prefs).toEqual({ recents: [], favorites: [] });
    prefs = pushRecent(prefs, codePointsOf('α'));
    prefs = pushRecent(prefs, codePointsOf('β'));
    prefs = pushRecent(prefs, codePointsOf('α'));
    expect(prefs.recents).toEqual([codePointsOf('α'), codePointsOf('β')]);
    for (const sym of ALL_SYMBOLS.slice(0, 40)) prefs = pushRecent(prefs, sym.cp);
    expect(prefs.recents.length).toBeLessThanOrEqual(SYMBOL_RECENTS_CAP);
  });

  it('favourites toggle, and unknown or corrupt entries are dropped on read', () => {
    let prefs = toggleFavorite(normalizeSymbolPrefs(null), codePointsOf('≤'));
    expect(prefs.favorites).toEqual([codePointsOf('≤')]);
    prefs = toggleFavorite(prefs, codePointsOf('≤'));
    expect(prefs.favorites).toEqual([]);
    // junk from a hand-edited localStorage entry never reaches the grid
    const junk = normalizeSymbolPrefs({ recents: ['U+0000', 42, null, codePointsOf('π')], favorites: 'nope' });
    expect(junk).toEqual({ recents: [codePointsOf('π')], favorites: [] });
  });

  it('is byte-capped like every other per-user preference blob', () => {
    const all = { recents: ALL_SYMBOLS.map((x) => x.cp), favorites: ALL_SYMBOLS.map((x) => x.cp) };
    const clamped = clampSymbolPrefs(all);
    expect(JSON.stringify(clamped).length).toBeLessThanOrEqual(SYMBOL_PREFS_BYTE_CAP);
    // the recents go first — a favourite is a deliberate choice, a recent is not
    expect(clamped.favorites.length).toBeGreaterThan(0);
  });
});

describe('121.md §1 — the picker surface (SSR)', () => {
  const html = (props = {}) => renderToStaticMarkup(<SymbolPicker onInsert={() => {}} {...props} />);

  it('is a labelled dialog trigger, closed on first paint', () => {
    const out = html();
    expect(out).toContain('aria-label="Insert symbol"');
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('data-testid="stitch-manuscript-symbols-open"');
    expect(out).toContain('Ω Symbols');
    // no popover, no grid, no search field until the researcher opens it
    expect(out).not.toContain('stitch-manuscript-symbols-popover');
    expect(out).not.toContain('role="dialog"');
    expect(out).not.toContain('aria-live');
  });

  it('renders without a host, and disabled when the section is locked', () => {
    expect(html({ disabled: true })).toContain('aria-label="Insert symbol"');
    expect(html({ disabled: true })).toContain('disabled=""');
    expect(renderToStaticMarkup(<SymbolPicker />)).toContain('aria-haspopup="dialog"');
  });

  it('joins the ribbon between Picture and Cross-reference', () => {
    const bar = renderToStaticMarkup(
      <RichToolbar getApi={() => null} citeRefs={[]} refLabel={(r) => r.id} onInsertPicture={() => {}} />,
    );
    const at = (t) => bar.indexOf(t);
    expect(at('stitch-manuscript-tb-picture')).toBeGreaterThan(-1);
    expect(at('stitch-manuscript-symbols-open')).toBeGreaterThan(at('stitch-manuscript-tb-picture'));
    expect(at('stitch-manuscript-crossref-open')).toBeGreaterThan(at('stitch-manuscript-symbols-open'));
  });
});

describe('121.md §1 — the insertion path and its keyboard/a11y discipline', () => {
  it('the picker bookmarks the caret BEFORE the popover (its search field autofocuses)', () => {
    const fn = PICKER.slice(PICKER.indexOf('const toggleOpen = () => {'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('if (onSessionStart) onSessionStart();');
    expect(body.indexOf('if (onSessionStart) onSessionStart();')).toBeLessThan(body.indexOf('setOpen(true);'));
    // …and every close that did NOT insert ends the session (§5's cancel contract)
    expect(PICKER).toContain('if (cancelled && onSessionEnd) onSessionEnd();');
    expect(PICKER).toContain('close(false, true);');     // backdrop
    expect(PICKER).toContain('close(true, true);');      // Escape / re-click
    expect(PICKER).toContain('close(false, false);');    // insert — the session is CONSUMED
  });

  it('reproduces the grid discipline: roving tabindex, arrows, Enter, Escape latch', () => {
    expect(PICKER).toContain('tabIndex={active ? 0 : -1}');
    expect(PICKER).toContain("const ARROWS = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: SYMBOL_GRID_COLS, ArrowUp: -SYMBOL_GRID_COLS };");
    // 117.md §44 — mark BEFORE consuming, or dismissing this popover in Focus Mode
    // would drop the whole fullscreen layout with it
    const keys = PICKER.slice(PICKER.indexOf('const onKeyDown = (e) => {'));
    const keyBody = keys.slice(0, keys.indexOf('\n  };'));
    expect(keyBody).toContain('markOverlayEscape();');
    expect(keyBody.indexOf('markOverlayEscape();')).toBeLessThan(keyBody.indexOf('e.preventDefault();'));
    expect(keyBody.indexOf('markOverlayEscape();')).toBeLessThan(keyBody.indexOf('close(true, true);'));
    // 108.md §23 — a modified chord is never claimed
    expect(PICKER).toContain('if (e.ctrlKey || e.metaKey || e.altKey) return;');
    expect(PICKER).toContain("if (!fromSearch && (e.key === 'Enter' || e.key === ' ')) {");
    // every cell is named for a screen reader, and the active one is announced
    expect(PICKER).toContain('aria-label={label}');
    expect(PICKER).toContain('aria-live="polite"');
    // the popover is clamped to the viewport — the grid is wider than the list pickers
    expect(PICKER).toContain('const over = r.right - (window.innerWidth - 8);');
  });

  it('a symbol is PLAIN TEXT at the caret — no wrapper, no nbsp, never insertMarkdown', () => {
    const fn = EDITOR.slice(EDITOR.indexOf('insertSymbol: (ch) => {'));
    const body = fn.slice(0, fn.indexOf('\n    },'));
    expect(body).toContain("insertAtCaret({ kind: 'text', text: s });");
    expect(body).not.toContain('insertMarkdown');       // mdToHtml would wrap it in a <p>
    expect(body).not.toContain('wrapInlineChip');       // htmlToMd would drop a span
    expect(body).not.toContain('&nbsp;');
    // …and the text plan reaches the document through the WebKit-verified plain-text
    // insert, which is a native undo step and island-legal (caption titles)
    const commit = EDITOR.slice(EDITOR.indexOf('const commitInsertion = (payload) => {'));
    expect(commit.slice(0, commit.indexOf('\n  };'))).toContain('else insertPlainText(plan.text);');
    // the workspace routes it through the SAME session as the other two pickers
    expect(PANELS).toContain('withBookmarkedCaret((api) => { if (api.insertSymbol) api.insertSymbol(ch); });');
    expect(PANELS).toContain('onInsertSymbol={insertSymbol}');
  });

  it('the page font stack gains symbol-capable faces, and the grid previews in it', () => {
    /* Georgia has no glyph for most of the catalogue, so without this the same
       manuscript renders differently on two machines. Per-glyph fallback leaves
       ordinary prose in Georgia. */
    expect(RICH_EDITOR_CSS).toContain(".ms-page-body{font-family:Georgia,'Times New Roman','Segoe UI Symbol','Noto Sans Symbols 2',serif;");
    expect(SYMBOL_FONT_STACK).toContain('Segoe UI Symbol');
    expect(SYMBOL_FONT_STACK).toContain('Noto Sans Symbols 2');
    expect(PICKER).toContain('fontFamily: SYMBOL_FONT_STACK');
  });

  it('no equation editor was smuggled in (§1: only if one already exists — none does)', () => {
    /* Comments are stripped first: the code SAYS why there is no equation system, and
       naming KaTeX/MathJax in that explanation must not read as using them. */
    const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const src of [EDITOR, PICKER, readSource('src/features/manuscript/richEditor/symbolCatalog.js')]) {
      expect(code(src)).not.toMatch(/katex|mathjax|MathML|<math/i);
    }
    // superscripts and subscripts ship as Unicode CHARACTERS, which is the only form
    // this markdown subset can store, round-trip and export
    for (const ch of '⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ₀₁₂₃₄₅₆₇₈₉ₙ') expect(symbolByChar(ch), ch).toBeTruthy();
    expect(EDITOR).not.toMatch(/<sup>|<sub>/);
  });
});
