/**
 * features/manuscript/richEditor/symbolCatalog.js — 121.md §1, "a comprehensive,
 * searchable, and extensible catalog of symbols commonly needed in scientific
 * manuscripts, medical research, statistics, and equations … The catalog should be
 * data-driven so additional symbols can be added without rebuilding the entire UI."
 *
 * PURE, in the caretBookmark.js/mdDom.js tradition: no React, no DOM, Node-testable.
 * Adding a symbol is ONE data row; the picker reads whatever is here.
 *
 * WHY A VALIDATION RULE LIVES BESIDE THE DATA
 *
 * This manuscript model is a markdown subset, and two classes of character are unsafe
 * in it — not "ugly", but silently corrupting:
 *
 *   · ASCII markdown metacharacters. `|` at the start of a line becomes a table row,
 *     `*` becomes emphasis, `#`/`-`/`1.` become block starts, a backtick opens code
 *     and `[` opens the citation/manual-input grammar (mdDom.js). A picker that
 *     offered them would let one click rewrite the paragraph's structure.
 *   · U+00A0 and the other invisible/format characters. `unescapeEntities` folds nbsp
 *     to a plain space on every save, so a "non-breaking space" symbol would silently
 *     become something else; zero-width and bidi controls cannot be seen, searched or
 *     safely exported at all — §1: "Exclude invisible characters, control characters,
 *     and symbols that cannot be safely stored or exported."
 *
 * Everything else transports losslessly: mdToHtml escapes only & < >, htmlToMd
 * serializes text nodes verbatim, and the docx exporter puts strings into TextRuns
 * unfiltered. So the safety question is answered ONCE, structurally, by
 * `validateSymbolEntry` plus the unit test that runs it over every row (and a
 * mdToHtml∘htmlToMd round-trip over every character).
 *
 * NOT AN EQUATION EDITOR. §1: "Do not turn this into a full equation editor unless an
 * equation system already exists." None does — there is no KaTeX, MathJax or MathML
 * anywhere in src, and mdDom drops pasted <math> and <svg> wholesale — so superscripts
 * and subscripts ship as Unicode CHARACTERS (¹ ² ³ ₀ ₁ …), which is the only form this
 * model can store, round-trip and export.
 */

/* ── the shape ──────────────────────────────────────────────────────────────────
   Rows are written with `s(ch, name, aliases, latex)`; `cp` is DERIVED so a row can
   never disagree with its own character. */

/** The one font stack the picker grid and the page body share, so what the researcher
    previews is what the paragraph renders (see RICH_EDITOR_CSS). */
export const SYMBOL_FONT_STACK = "Georgia, 'Times New Roman', 'Segoe UI Symbol', 'Noto Sans Symbols 2', serif";

/**
 * The ASCII characters this markdown subset gives a MEANING to, and which therefore
 * may never appear in a catalogue entry (see the header): the table pipe, emphasis,
 * code, the bracket grammars, the three line-start block markers, the escape, and the
 * two conventional markdown metacharacters this subset does not use today but which
 * an added rule would claim first. Space is here because an entry that inserts
 * whitespace is not a symbol.
 *
 * Every OTHER ASCII character is allowed — and is not merely assumed safe: the unit
 * test round-trips every catalogue character through mdToHtml∘htmlToMd, which is the
 * real contract ('<' and '>' survive because mdDom escapes and unescapes them
 * symmetrically, and a letter inside a grapheme like x̄ is just a letter).
 */
export const MARKDOWN_UNSAFE_ASCII = Object.freeze(new Set(
  ['|', '*', '`', '[', ']', '#', '-', '_', '\\', '~', '^', ' '],
));

/** Control, format and invisible characters. Anything matching cannot be seen,
    searched, or trusted to survive a save (§1's "exclude invisible characters"). */
const INVISIBLE_RE = /[\u0000-\u001F\u007F-\u009F\u00A0\u00AD\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\uFEFF\uFFF9-\uFFFB]/;
/** Combining marks: legal INSIDE a grapheme (x̄, p̂, c̄), never on their own — a lone
    mark attaches itself to whatever character happens to precede it in the sentence. */
const COMBINING_RE = /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/;

/** 'α' → 'U+03B1'; a multi-codepoint grapheme → 'U+0078 U+0304'. Pure. */
export function codePointsOf(ch) {
  return Array.from(String(ch == null ? '' : ch))
    .map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');
}

const s = (ch, name, aliases = [], latex = null) => ({
  ch, name, aliases, latex, cp: codePointsOf(ch),
});

/* ── the catalogue ─────────────────────────────────────────────────────────────
   §1's fourteen groups, in the order a researcher looks for them. A character may
   appear in two groups when it genuinely belongs to both (° is a unit AND a geometry
   symbol); the search de-duplicates by character so the result list never repeats. */

const RAW_CATEGORIES = [
  {
    id: 'greek-lower',
    label: 'Greek — lowercase',
    symbols: [
      s('α', 'Greek small alpha', ['alpha', 'significance level', 'type i error'], '\\alpha'),
      s('β', 'Greek small beta', ['beta', 'coefficient', 'type ii error'], '\\beta'),
      s('γ', 'Greek small gamma', ['gamma'], '\\gamma'),
      s('δ', 'Greek small delta', ['delta', 'difference'], '\\delta'),
      s('ε', 'Greek small epsilon', ['epsilon', 'error term'], '\\epsilon'),
      s('ζ', 'Greek small zeta', ['zeta'], '\\zeta'),
      s('η', 'Greek small eta', ['eta', 'effect size'], '\\eta'),
      s('θ', 'Greek small theta', ['theta', 'parameter', 'angle'], '\\theta'),
      s('ι', 'Greek small iota', ['iota'], '\\iota'),
      s('κ', 'Greek small kappa', ['kappa', 'agreement', 'cohen kappa'], '\\kappa'),
      s('λ', 'Greek small lambda', ['lambda', 'rate', 'eigenvalue'], '\\lambda'),
      s('μ', 'Greek small mu', ['mu', 'mean', 'population mean'], '\\mu'),
      s('ν', 'Greek small nu', ['nu', 'degrees of freedom'], '\\nu'),
      s('ξ', 'Greek small xi', ['xi'], '\\xi'),
      s('ο', 'Greek small omicron', ['omicron'], null),
      s('π', 'Greek small pi', ['pi', 'proportion'], '\\pi'),
      s('ρ', 'Greek small rho', ['rho', 'correlation', 'spearman'], '\\rho'),
      s('σ', 'Greek small sigma', ['sigma', 'standard deviation', 'sd'], '\\sigma'),
      s('ς', 'Greek small final sigma', ['final sigma', 'stigma'], '\\varsigma'),
      s('τ', 'Greek small tau', ['tau', 'kendall tau'], '\\tau'),
      s('υ', 'Greek small upsilon', ['upsilon'], '\\upsilon'),
      s('φ', 'Greek small phi', ['phi', 'phi coefficient'], '\\phi'),
      s('ϕ', 'Greek small phi symbol', ['straight phi', 'varphi'], '\\varphi'),
      s('χ', 'Greek small chi', ['chi', 'chi square'], '\\chi'),
      s('ψ', 'Greek small psi', ['psi'], '\\psi'),
      s('ω', 'Greek small omega', ['omega', 'omega squared'], '\\omega'),
      s('ϑ', 'Greek theta symbol', ['script theta', 'vartheta'], '\\vartheta'),
      s('ϖ', 'Greek pi symbol', ['varpi'], '\\varpi'),
      s('ϱ', 'Greek rho symbol', ['varrho'], '\\varrho'),
      s('ϵ', 'Greek lunate epsilon', ['varepsilon', 'lunate epsilon'], '\\varepsilon'),
    ],
  },
  {
    id: 'greek-upper',
    label: 'Greek — uppercase',
    symbols: [
      s('Α', 'Greek capital Alpha', ['alpha'], 'A'),
      s('Β', 'Greek capital Beta', ['beta'], 'B'),
      s('Γ', 'Greek capital Gamma', ['gamma', 'gamma function'], '\\Gamma'),
      s('Δ', 'Greek capital Delta', ['delta', 'change', 'difference'], '\\Delta'),
      s('Ε', 'Greek capital Epsilon', ['epsilon'], 'E'),
      s('Ζ', 'Greek capital Zeta', ['zeta'], 'Z'),
      s('Η', 'Greek capital Eta', ['eta'], 'H'),
      s('Θ', 'Greek capital Theta', ['theta'], '\\Theta'),
      s('Ι', 'Greek capital Iota', ['iota'], 'I'),
      s('Κ', 'Greek capital Kappa', ['kappa'], 'K'),
      s('Λ', 'Greek capital Lambda', ['lambda'], '\\Lambda'),
      s('Μ', 'Greek capital Mu', ['mu'], 'M'),
      s('Ν', 'Greek capital Nu', ['nu'], 'N'),
      s('Ξ', 'Greek capital Xi', ['xi'], '\\Xi'),
      s('Ο', 'Greek capital Omicron', ['omicron'], 'O'),
      s('Π', 'Greek capital Pi', ['pi', 'product'], '\\Pi'),
      s('Ρ', 'Greek capital Rho', ['rho'], 'P'),
      s('Σ', 'Greek capital Sigma', ['sigma', 'sum', 'summation'], '\\Sigma'),
      s('Τ', 'Greek capital Tau', ['tau'], 'T'),
      s('Υ', 'Greek capital Upsilon', ['upsilon'], '\\Upsilon'),
      s('Φ', 'Greek capital Phi', ['phi', 'normal cdf'], '\\Phi'),
      s('Χ', 'Greek capital Chi', ['chi'], 'X'),
      s('Ψ', 'Greek capital Psi', ['psi'], '\\Psi'),
      s('Ω', 'Greek capital Omega', ['omega', 'ohm'], '\\Omega'),
    ],
  },
  {
    id: 'operators',
    label: 'Mathematical operators',
    symbols: [
      s('+', 'Plus sign', ['plus', 'add'], '+'),
      s('−', 'Minus sign', ['minus', 'subtract', 'true minus'], '-'),
      s('±', 'Plus-minus sign', ['plus minus', 'plus or minus', 'tolerance'], '\\pm'),
      s('∓', 'Minus-plus sign', ['minus plus'], '\\mp'),
      s('×', 'Multiplication sign', ['times', 'multiply', 'cross'], '\\times'),
      s('÷', 'Division sign', ['divide', 'obelus'], '\\div'),
      s('⋅', 'Dot operator', ['dot product', 'multiply dot'], '\\cdot'),
      s('·', 'Middle dot', ['middot', 'unit product', 'interpunct'], '\\cdot'),
      s('∗', 'Asterisk operator', ['convolution', 'star operator'], '\\ast'),
      s('∘', 'Ring operator', ['composition', 'compose'], '\\circ'),
      s('∙', 'Bullet operator', ['bullet operator'], '\\bullet'),
      s('/', 'Solidus', ['slash', 'per', 'divide'], '/'),
      s('∕', 'Division slash', ['division slash'], null),
      s('⁄', 'Fraction slash', ['fraction slash'], null),
      s('√', 'Square root', ['radical', 'sqrt', 'root'], '\\sqrt'),
      s('∛', 'Cube root', ['cube root'], '\\sqrt[3]'),
      s('∜', 'Fourth root', ['fourth root'], '\\sqrt[4]'),
      s('∑', 'N-ary summation', ['sum', 'summation', 'sigma sum'], '\\sum'),
      s('∏', 'N-ary product', ['product', 'pi product'], '\\prod'),
      s('∐', 'N-ary coproduct', ['coproduct'], '\\coprod'),
      s('∞', 'Infinity', ['infinity', 'infinite'], '\\infty'),
      s('∝', 'Proportional to', ['proportional', 'varies as'], '\\propto'),
      s('%', 'Percent sign', ['percent', 'per cent'], '\\%'),
      s('‰', 'Per mille sign', ['per mille', 'per thousand'], '\\permil'),
      s('‱', 'Per ten thousand sign', ['basis point', 'per ten thousand'], null),
      s('⊕', 'Circled plus', ['direct sum', 'xor', 'oplus'], '\\oplus'),
      s('⊖', 'Circled minus', ['ominus'], '\\ominus'),
      s('⊗', 'Circled times', ['tensor product', 'otimes'], '\\otimes'),
      s('⊘', 'Circled division slash', ['oslash'], '\\oslash'),
      s('⊙', 'Circled dot operator', ['odot', 'hadamard'], '\\odot'),
      s('∎', 'End of proof', ['qed', 'tombstone', 'halmos'], '\\blacksquare'),
      s('!', 'Factorial', ['factorial', 'exclamation'], '!'),
    ],
  },
  {
    id: 'comparison',
    label: 'Comparison and equality',
    symbols: [
      s('=', 'Equals sign', ['equals', 'equal to'], '='),
      s('≠', 'Not equal to', ['not equal', 'ne'], '\\neq'),
      s('≈', 'Almost equal to', ['approximately', 'approx', 'about'], '\\approx'),
      s('≃', 'Asymptotically equal to', ['asymptotically equal', 'simeq'], '\\simeq'),
      s('≅', 'Approximately equal to', ['congruent', 'cong'], '\\cong'),
      s('≇', 'Neither approximately nor actually equal', ['not congruent'], '\\ncong'),
      s('≡', 'Identical to', ['identical', 'equivalent', 'defined as'], '\\equiv'),
      s('≢', 'Not identical to', ['not identical', 'not equivalent'], '\\nequiv'),
      s('≜', 'Delta equal to', ['defined as', 'triangleq'], '\\triangleq'),
      s('≝', 'Equal to by definition', ['by definition'], null),
      s('≟', 'Questioned equal to', ['equal question'], null),
      s('<', 'Less-than sign', ['less than', 'lt'], '<'),
      s('>', 'Greater-than sign', ['greater than', 'gt'], '>'),
      s('≤', 'Less-than or equal to', ['less or equal', 'leq', 'at most'], '\\leq'),
      s('≥', 'Greater-than or equal to', ['greater or equal', 'geq', 'at least'], '\\geq'),
      s('⩽', 'Less-than or slanted equal to', ['leqslant'], '\\leqslant'),
      s('⩾', 'Greater-than or slanted equal to', ['geqslant'], '\\geqslant'),
      s('≪', 'Much less-than', ['much less'], '\\ll'),
      s('≫', 'Much greater-than', ['much greater'], '\\gg'),
      s('≮', 'Not less-than', ['not less'], '\\nless'),
      s('≯', 'Not greater-than', ['not greater'], '\\ngtr'),
      s('≰', 'Neither less-than nor equal to', ['not less or equal'], '\\nleq'),
      s('≱', 'Neither greater-than nor equal to', ['not greater or equal'], '\\ngeq'),
      s('≶', 'Less-than or greater-than', ['less or greater'], '\\lessgtr'),
      s('≷', 'Greater-than or less-than', ['greater or less'], '\\gtrless'),
      s('∼', 'Tilde operator', ['similar to', 'distributed as', 'sim'], '\\sim'),
      s('≁', 'Not tilde', ['not similar'], '\\nsim'),
      s('≐', 'Approaches the limit', ['approaches limit'], '\\doteq'),
      s('≒', 'Approximately equal to or the image of', ['nearly equals'], null),
      s('≺', 'Precedes', ['precedes'], '\\prec'),
      s('≻', 'Succeeds', ['succeeds'], '\\succ'),
      s('⪯', 'Precedes or equal to', ['preceq'], '\\preceq'),
      s('⪰', 'Succeeds or equal to', ['succeq'], '\\succeq'),
    ],
  },
  {
    id: 'statistics',
    label: 'Statistics and probability',
    symbols: [
      s('x̄', 'x-bar (sample mean)', ['x bar', 'sample mean', 'average'], '\\bar{x}'),
      s('ȳ', 'y-bar (sample mean of y)', ['y bar', 'mean of y'], '\\bar{y}'),
      s('x̃', 'x-tilde (median)', ['x tilde', 'median'], '\\tilde{x}'),
      s('p̂', 'p-hat (sample proportion)', ['p hat', 'estimated proportion'], '\\hat{p}'),
      s('β̂', 'beta-hat (estimated coefficient)', ['beta hat', 'estimate'], '\\hat{\\beta}'),
      s('θ̂', 'theta-hat (estimator)', ['theta hat', 'estimator'], '\\hat{\\theta}'),
      s('σ̂', 'sigma-hat (estimated sd)', ['sigma hat'], '\\hat{\\sigma}'),
      s('μ', 'Population mean (mu)', ['mu', 'mean'], '\\mu'),
      s('σ', 'Standard deviation (sigma)', ['sigma', 'sd', 'standard deviation'], '\\sigma'),
      s('σ²', 'Variance (sigma squared)', ['variance', 'sigma squared'], '\\sigma^2'),
      s('ρ', 'Correlation (rho)', ['rho', 'correlation'], '\\rho'),
      s('τ', 'Kendall tau', ['tau', 'kendall'], '\\tau'),
      s('χ²', 'Chi-square', ['chi square', 'chisq', 'chi squared'], '\\chi^2'),
      s('κ', 'Cohen kappa', ['kappa', 'agreement'], '\\kappa'),
      s('η²', 'Eta squared (effect size)', ['eta squared', 'effect size'], '\\eta^2'),
      s('ω²', 'Omega squared (effect size)', ['omega squared'], '\\omega^2'),
      s('Φ', 'Standard normal CDF (Phi)', ['normal cdf', 'phi'], '\\Phi'),
      s('ℙ', 'Probability', ['probability', 'prob'], '\\mathbb{P}'),
      s('ℕ', 'Natural numbers', ['naturals', 'counting numbers'], '\\mathbb{N}'),
      s('∼', 'Distributed as', ['distributed as', 'follows distribution'], '\\sim'),
      s('⊥', 'Independent of / perpendicular', ['independent', 'orthogonal', 'perp'], '\\perp'),
      s('∈', 'Element of', ['in', 'member of'], '\\in'),
      s('≈', 'Approximately', ['approx', 'about'], '\\approx'),
      s('±', 'Plus or minus (interval)', ['plus minus', 'confidence interval'], '\\pm'),
      s('∑', 'Summation', ['sum'], '\\sum'),
      s('∏', 'Product', ['product'], '\\prod'),
      s('√', 'Square root', ['sqrt', 'root'], '\\sqrt'),
      s('°', 'Degree', ['degree'], '^\\circ'),
      s('‰', 'Per mille', ['per mille'], null),
      s('∅', 'Empty set / none', ['empty set', 'null', 'none'], '\\emptyset'),
      s('†', 'Dagger (footnote marker)', ['dagger', 'footnote'], '\\dagger'),
    ],
  },
  {
    id: 'calculus',
    label: 'Calculus and analysis',
    symbols: [
      s('∂', 'Partial differential', ['partial', 'partial derivative'], '\\partial'),
      s('∇', 'Nabla (gradient)', ['nabla', 'gradient', 'del'], '\\nabla'),
      s('∫', 'Integral', ['integral'], '\\int'),
      s('∬', 'Double integral', ['double integral'], '\\iint'),
      s('∭', 'Triple integral', ['triple integral'], '\\iiint'),
      s('∮', 'Contour integral', ['contour integral', 'line integral'], '\\oint'),
      s('∯', 'Surface integral', ['surface integral'], '\\oiint'),
      s('∰', 'Volume integral', ['volume integral'], null),
      s('∆', 'Increment', ['increment', 'change', 'delta'], '\\Delta'),
      s('′', 'Prime (derivative)', ['prime', 'derivative', 'minutes'], "'"),
      s('″', 'Double prime', ['double prime', 'second derivative', 'seconds'], "''"),
      s('‴', 'Triple prime', ['triple prime', 'third derivative'], null),
      s('⁗', 'Quadruple prime', ['quadruple prime'], null),
      s('∞', 'Infinity', ['infinity', 'limit'], '\\infty'),
      s('→', 'Tends to', ['tends to', 'approaches', 'limit'], '\\to'),
      s('↦', 'Maps to', ['maps to', 'mapsto'], '\\mapsto'),
      s('∘', 'Function composition', ['composition'], '\\circ'),
      s('⌠', 'Top half integral', ['integral top'], null),
      s('⌡', 'Bottom half integral', ['integral bottom'], null),
      s('∑', 'Summation', ['sum', 'series'], '\\sum'),
      s('≐', 'Approaches the limit', ['approaches limit'], '\\doteq'),
    ],
  },
  {
    id: 'set-theory',
    label: 'Set theory',
    symbols: [
      s('∈', 'Element of', ['in', 'member', 'belongs to'], '\\in'),
      s('∉', 'Not an element of', ['not in', 'not a member'], '\\notin'),
      s('∋', 'Contains as member', ['contains member'], '\\ni'),
      s('∌', 'Does not contain as member', ['does not contain'], '\\notni'),
      s('⊂', 'Subset of', ['subset', 'proper subset'], '\\subset'),
      s('⊃', 'Superset of', ['superset'], '\\supset'),
      s('⊄', 'Not a subset of', ['not subset'], '\\nsubset'),
      s('⊅', 'Not a superset of', ['not superset'], '\\nsupset'),
      s('⊆', 'Subset of or equal to', ['subset or equal', 'subseteq'], '\\subseteq'),
      s('⊇', 'Superset of or equal to', ['superset or equal', 'supseteq'], '\\supseteq'),
      s('⊈', 'Neither a subset of nor equal to', ['not subset or equal'], '\\nsubseteq'),
      s('⊉', 'Neither a superset of nor equal to', ['not superset or equal'], '\\nsupseteq'),
      s('⊊', 'Subset of with not equal to', ['proper subset', 'subsetneq'], '\\subsetneq'),
      s('⊋', 'Superset of with not equal to', ['proper superset'], '\\supsetneq'),
      s('∪', 'Union', ['union', 'cup', 'or'], '\\cup'),
      s('∩', 'Intersection', ['intersection', 'cap', 'and'], '\\cap'),
      s('⋃', 'N-ary union', ['big union'], '\\bigcup'),
      s('⋂', 'N-ary intersection', ['big intersection'], '\\bigcap'),
      s('∖', 'Set minus', ['set minus', 'difference', 'without'], '\\setminus'),
      s('∅', 'Empty set', ['empty set', 'null set'], '\\emptyset'),
      s('∁', 'Complement', ['complement'], '\\complement'),
      s('⊍', 'Multiset multiplication', ['multiset'], null),
      s('⊎', 'Multiset union', ['disjoint union'], '\\uplus'),
      s('⊔', 'Square cup', ['square cup', 'join'], '\\sqcup'),
      s('⊓', 'Square cap', ['square cap', 'meet'], '\\sqcap'),
      s('℘', 'Power set (Weierstrass p)', ['power set', 'weierstrass'], '\\wp'),
      s('ℕ', 'Set of natural numbers', ['naturals'], '\\mathbb{N}'),
      s('ℤ', 'Set of integers', ['integers'], '\\mathbb{Z}'),
      s('ℚ', 'Set of rational numbers', ['rationals'], '\\mathbb{Q}'),
      s('ℝ', 'Set of real numbers', ['reals'], '\\mathbb{R}'),
      s('ℂ', 'Set of complex numbers', ['complex numbers'], '\\mathbb{C}'),
      s('×', 'Cartesian product', ['cartesian product', 'cross product'], '\\times'),
    ],
  },
  {
    id: 'logic',
    label: 'Logic',
    symbols: [
      s('∀', 'For all', ['for all', 'universal quantifier', 'every'], '\\forall'),
      s('∃', 'There exists', ['there exists', 'existential quantifier'], '\\exists'),
      s('∄', 'There does not exist', ['does not exist'], '\\nexists'),
      s('∴', 'Therefore', ['therefore', 'so'], '\\therefore'),
      s('∵', 'Because', ['because', 'since'], '\\because'),
      s('¬', 'Not sign', ['not', 'negation', 'lnot'], '\\neg'),
      s('∧', 'Logical and', ['and', 'conjunction', 'wedge'], '\\land'),
      s('∨', 'Logical or', ['or', 'disjunction', 'vee'], '\\lor'),
      s('⊻', 'Exclusive or', ['xor', 'exclusive or'], '\\veebar'),
      s('⊼', 'Nand', ['nand'], '\\barwedge'),
      s('⊽', 'Nor', ['nor'], null),
      s('⇒', 'Implies', ['implies', 'rightarrow double'], '\\Rightarrow'),
      s('⇐', 'Is implied by', ['implied by'], '\\Leftarrow'),
      s('⇔', 'If and only if', ['iff', 'equivalent', 'if and only if'], '\\Leftrightarrow'),
      s('→', 'Conditional', ['implies', 'then'], '\\to'),
      s('↔', 'Biconditional', ['iff', 'both ways'], '\\leftrightarrow'),
      s('⊢', 'Proves / turnstile', ['proves', 'turnstile', 'entails'], '\\vdash'),
      s('⊣', 'Reverse turnstile', ['reverse turnstile'], '\\dashv'),
      s('⊨', 'Models / satisfies', ['models', 'satisfies', 'entails'], '\\models'),
      s('⊤', 'Tautology (top)', ['top', 'true', 'tautology'], '\\top'),
      s('⊥', 'Contradiction (bottom)', ['bottom', 'false', 'contradiction'], '\\bot'),
      s('≔', 'Colon equals (is defined as)', ['is defined as', 'assign'], '\\coloneqq'),
      s('∎', 'End of proof', ['qed', 'proved'], '\\blacksquare'),
    ],
  },
  {
    id: 'arrows',
    label: 'Arrows and vectors',
    symbols: [
      s('→', 'Rightwards arrow', ['right arrow', 'to', 'leads to'], '\\rightarrow'),
      s('←', 'Leftwards arrow', ['left arrow', 'from'], '\\leftarrow'),
      s('↑', 'Upwards arrow', ['up arrow', 'increased', 'raised'], '\\uparrow'),
      s('↓', 'Downwards arrow', ['down arrow', 'decreased', 'reduced'], '\\downarrow'),
      s('↔', 'Left right arrow', ['both directions', 'bidirectional'], '\\leftrightarrow'),
      s('↕', 'Up down arrow', ['up down'], '\\updownarrow'),
      s('↖', 'North west arrow', ['up left'], '\\nwarrow'),
      s('↗', 'North east arrow', ['up right', 'rising'], '\\nearrow'),
      s('↘', 'South east arrow', ['down right', 'falling'], '\\searrow'),
      s('↙', 'South west arrow', ['down left'], '\\swarrow'),
      s('⇒', 'Rightwards double arrow', ['double right', 'implies'], '\\Rightarrow'),
      s('⇐', 'Leftwards double arrow', ['double left'], '\\Leftarrow'),
      s('⇑', 'Upwards double arrow', ['double up'], '\\Uparrow'),
      s('⇓', 'Downwards double arrow', ['double down'], '\\Downarrow'),
      s('⇔', 'Left right double arrow', ['double both', 'iff'], '\\Leftrightarrow'),
      s('⇕', 'Up down double arrow', ['double up down'], '\\Updownarrow'),
      s('↦', 'Rightwards arrow from bar', ['maps to'], '\\mapsto'),
      s('↤', 'Leftwards arrow from bar', ['maps from'], '\\mapsfrom'),
      s('⟶', 'Long rightwards arrow', ['long right arrow'], '\\longrightarrow'),
      s('⟵', 'Long leftwards arrow', ['long left arrow'], '\\longleftarrow'),
      s('⟷', 'Long left right arrow', ['long both'], '\\longleftrightarrow'),
      s('⟹', 'Long rightwards double arrow', ['long implies'], '\\Longrightarrow'),
      s('⟸', 'Long leftwards double arrow', ['long implied by'], '\\Longleftarrow'),
      s('⟺', 'Long left right double arrow', ['long iff'], '\\Longleftrightarrow'),
      s('↝', 'Rightwards wave arrow', ['wave arrow', 'leads to'], '\\rightsquigarrow'),
      s('⇀', 'Rightwards harpoon with barb upwards', ['harpoon right'], '\\rightharpoonup'),
      s('↼', 'Leftwards harpoon with barb upwards', ['harpoon left'], '\\leftharpoonup'),
      s('⇌', 'Rightwards over leftwards harpoon', ['equilibrium', 'reversible reaction'], '\\rightleftharpoons'),
      s('⇄', 'Rightwards arrow over leftwards arrow', ['exchange', 'reversible'], '\\rightleftarrows'),
      s('↺', 'Anticlockwise open circle arrow', ['counterclockwise', 'undo'], '\\circlearrowleft'),
      s('↻', 'Clockwise open circle arrow', ['clockwise', 'redo'], '\\circlearrowright'),
      s('x⃗', 'Vector x (arrow above)', ['vector', 'vec x', 'arrow above'], '\\vec{x}'),
      s('n̂', 'Unit vector n (hat)', ['unit vector', 'n hat'], '\\hat{n}'),
    ],
  },
  {
    id: 'geometry',
    label: 'Geometry',
    symbols: [
      s('°', 'Degree sign', ['degree', 'degrees', 'angle'], '^\\circ'),
      s('∠', 'Angle', ['angle'], '\\angle'),
      s('∡', 'Measured angle', ['measured angle'], '\\measuredangle'),
      s('∢', 'Spherical angle', ['spherical angle'], '\\sphericalangle'),
      s('∟', 'Right angle', ['right angle'], null),
      s('⊾', 'Right angle with arc', ['right angle arc'], null),
      s('⊥', 'Perpendicular to', ['perpendicular', 'orthogonal'], '\\perp'),
      s('∥', 'Parallel to', ['parallel'], '\\parallel'),
      s('∦', 'Not parallel to', ['not parallel'], '\\nparallel'),
      s('△', 'White up-pointing triangle', ['triangle'], '\\triangle'),
      s('▲', 'Black up-pointing triangle', ['filled triangle', 'increase'], '\\blacktriangle'),
      s('▽', 'White down-pointing triangle', ['down triangle'], '\\triangledown'),
      s('▼', 'Black down-pointing triangle', ['filled down triangle', 'decrease'], '\\blacktriangledown'),
      s('□', 'White square', ['square', 'open square', 'box'], '\\square'),
      s('■', 'Black square', ['filled square', 'solid square'], '\\blacksquare'),
      s('▢', 'White square with rounded corners', ['rounded square'], null),
      s('▣', 'White square containing black small square', ['square in square'], null),
      s('▪', 'Black small square', ['small filled square', 'bullet square'], null),
      s('▫', 'White small square', ['small open square'], null),
      s('◻', 'White medium square', ['medium square'], null),
      s('◼', 'Black medium square', ['medium filled square'], null),
      s('▭', 'White rectangle', ['rectangle'], null),
      s('▱', 'White parallelogram', ['parallelogram'], null),
      s('◇', 'White diamond', ['diamond'], '\\diamond'),
      s('◆', 'Black diamond', ['filled diamond'], '\\blacklozenge'),
      s('◊', 'Lozenge', ['lozenge'], '\\lozenge'),
      s('○', 'White circle', ['circle', 'open circle'], '\\circ'),
      s('●', 'Black circle', ['filled circle', 'solid circle'], '\\bullet'),
      s('◯', 'Large circle', ['large circle'], '\\bigcirc'),
      s('◐', 'Circle with left half black', ['half filled circle'], null),
      s('⌒', 'Arc', ['arc'], null),
      s('⊙', 'Circled dot', ['circle with centre'], '\\odot'),
      s('≅', 'Congruent to', ['congruent'], '\\cong'),
      s('∽', 'Reversed tilde (similar)', ['similar shape'], null),
      s('★', 'Black star', ['star', 'filled star'], '\\bigstar'),
      s('☆', 'White star', ['open star'], null),
    ],
  },
  {
    id: 'superscript',
    label: 'Superscripts',
    symbols: [
      s('⁰', 'Superscript zero', ['superscript 0', 'sup 0'], '^0'),
      s('¹', 'Superscript one', ['superscript 1', 'sup 1'], '^1'),
      s('²', 'Superscript two', ['squared', 'superscript 2'], '^2'),
      s('³', 'Superscript three', ['cubed', 'superscript 3'], '^3'),
      s('⁴', 'Superscript four', ['superscript 4'], '^4'),
      s('⁵', 'Superscript five', ['superscript 5'], '^5'),
      s('⁶', 'Superscript six', ['superscript 6'], '^6'),
      s('⁷', 'Superscript seven', ['superscript 7'], '^7'),
      s('⁸', 'Superscript eight', ['superscript 8'], '^8'),
      s('⁹', 'Superscript nine', ['superscript 9'], '^9'),
      s('⁺', 'Superscript plus', ['superscript plus', 'positive'], '^+'),
      s('⁻', 'Superscript minus', ['superscript minus', 'inverse', 'per'], '^-'),
      s('⁼', 'Superscript equals', ['superscript equals'], '^='),
      s('⁽', 'Superscript left parenthesis', ['superscript open bracket'], '^('),
      s('⁾', 'Superscript right parenthesis', ['superscript close bracket'], '^)'),
      s('ⁿ', 'Superscript n', ['superscript n', 'to the n'], '^n'),
      s('ⁱ', 'Superscript i', ['superscript i'], '^i'),
      s('ᵃ', 'Superscript a', ['superscript a', 'footnote a'], '^a'),
      s('ᵇ', 'Superscript b', ['superscript b', 'footnote b'], '^b'),
      s('ᶜ', 'Superscript c', ['superscript c', 'footnote c'], '^c'),
      s('ᵈ', 'Superscript d', ['superscript d'], '^d'),
      s('ᵉ', 'Superscript e', ['superscript e'], '^e'),
      s('ᶠ', 'Superscript f', ['superscript f'], '^f'),
      s('ᵍ', 'Superscript g', ['superscript g'], '^g'),
      s('ʰ', 'Superscript h', ['superscript h'], '^h'),
      s('ʲ', 'Superscript j', ['superscript j'], '^j'),
      s('ᵏ', 'Superscript k', ['superscript k'], '^k'),
      s('ˡ', 'Superscript l', ['superscript l'], '^l'),
      s('ᵐ', 'Superscript m', ['superscript m'], '^m'),
      s('ᵒ', 'Superscript o', ['superscript o'], '^o'),
      s('ᵖ', 'Superscript p', ['superscript p'], '^p'),
      s('ʳ', 'Superscript r', ['superscript r'], '^r'),
      s('ˢ', 'Superscript s', ['superscript s'], '^s'),
      s('ᵗ', 'Superscript t', ['superscript t'], '^t'),
      s('ᵘ', 'Superscript u', ['superscript u'], '^u'),
      s('ᵛ', 'Superscript v', ['superscript v'], '^v'),
      s('ʷ', 'Superscript w', ['superscript w'], '^w'),
      s('ˣ', 'Superscript x', ['superscript x'], '^x'),
      s('ʸ', 'Superscript y', ['superscript y'], '^y'),
      s('ᶻ', 'Superscript z', ['superscript z'], '^z'),
      s('ᵀ', 'Superscript capital T', ['transpose', 'superscript T'], '^T'),
      s('™', 'Trade mark sign', ['trademark', 'tm'], null),
    ],
  },
  {
    id: 'subscript',
    label: 'Subscripts',
    symbols: [
      s('₀', 'Subscript zero', ['subscript 0', 'baseline'], '_0'),
      s('₁', 'Subscript one', ['subscript 1'], '_1'),
      s('₂', 'Subscript two', ['subscript 2'], '_2'),
      s('₃', 'Subscript three', ['subscript 3'], '_3'),
      s('₄', 'Subscript four', ['subscript 4'], '_4'),
      s('₅', 'Subscript five', ['subscript 5'], '_5'),
      s('₆', 'Subscript six', ['subscript 6'], '_6'),
      s('₇', 'Subscript seven', ['subscript 7'], '_7'),
      s('₈', 'Subscript eight', ['subscript 8'], '_8'),
      s('₉', 'Subscript nine', ['subscript 9'], '_9'),
      s('₊', 'Subscript plus', ['subscript plus'], '_+'),
      s('₋', 'Subscript minus', ['subscript minus'], '_-'),
      s('₌', 'Subscript equals', ['subscript equals'], '_='),
      s('₍', 'Subscript left parenthesis', ['subscript open bracket'], '_('),
      s('₎', 'Subscript right parenthesis', ['subscript close bracket'], '_)'),
      s('ₐ', 'Subscript a', ['subscript a'], '_a'),
      s('ₑ', 'Subscript e', ['subscript e'], '_e'),
      s('ₕ', 'Subscript h', ['subscript h'], '_h'),
      s('ᵢ', 'Subscript i', ['subscript i', 'index i'], '_i'),
      s('ⱼ', 'Subscript j', ['subscript j', 'index j'], '_j'),
      s('ₖ', 'Subscript k', ['subscript k'], '_k'),
      s('ₗ', 'Subscript l', ['subscript l'], '_l'),
      s('ₘ', 'Subscript m', ['subscript m'], '_m'),
      s('ₙ', 'Subscript n', ['subscript n', 'sample size'], '_n'),
      s('ₒ', 'Subscript o', ['subscript o'], '_o'),
      s('ₚ', 'Subscript p', ['subscript p'], '_p'),
      s('ᵣ', 'Subscript r', ['subscript r'], '_r'),
      s('ₛ', 'Subscript s', ['subscript s'], '_s'),
      s('ₜ', 'Subscript t', ['subscript t', 'time'], '_t'),
      s('ᵤ', 'Subscript u', ['subscript u'], '_u'),
      s('ᵥ', 'Subscript v', ['subscript v'], '_v'),
      s('ₓ', 'Subscript x', ['subscript x'], '_x'),
    ],
  },
  {
    id: 'units',
    label: 'Degrees, temperature and units',
    symbols: [
      s('°', 'Degree sign', ['degree', 'degrees'], '^\\circ'),
      s('℃', 'Degree Celsius', ['celsius', 'centigrade', 'degrees c'], null),
      s('℉', 'Degree Fahrenheit', ['fahrenheit', 'degrees f'], null),
      s('K', 'Kelvin', ['kelvin', 'absolute temperature'], null),
      s('µ', 'Micro sign', ['micro', 'micron', 'ug', 'micrometre'], '\\mu'),
      s('Å', 'Angstrom', ['angstrom'], '\\AA'),
      s('Ω', 'Ohm', ['ohm', 'resistance'], '\\Omega'),
      s('℧', 'Mho (inverted ohm)', ['mho', 'siemens'], '\\mho'),
      s('ℓ', 'Script small l (litre)', ['litre', 'liter'], '\\ell'),
      s('′', 'Prime (minutes / feet)', ['minutes', 'feet', 'arcminute'], "'"),
      s('″', 'Double prime (seconds / inches)', ['seconds', 'inches', 'arcsecond'], "''"),
      s('·', 'Middle dot (unit product)', ['unit product', 'newton metre'], '\\cdot'),
      s('⁻', 'Superscript minus (per)', ['per', 'inverse unit'], '^-'),
      s('¹', 'Superscript one', ['per unit'], '^1'),
      s('²', 'Superscript two (squared)', ['squared', 'square metre'], '^2'),
      s('³', 'Superscript three (cubed)', ['cubed', 'cubic'], '^3'),
      s('½', 'One half', ['half', 'one half'], '\\frac{1}{2}'),
      s('⅓', 'One third', ['third'], '\\frac{1}{3}'),
      s('¼', 'One quarter', ['quarter'], '\\frac{1}{4}'),
      s('¾', 'Three quarters', ['three quarters'], '\\frac{3}{4}'),
      s('⅔', 'Two thirds', ['two thirds'], '\\frac{2}{3}'),
      s('⅛', 'One eighth', ['eighth'], '\\frac{1}{8}'),
      s('%', 'Percent', ['percent'], '\\%'),
      s('‰', 'Per mille', ['per mille', 'per thousand'], null),
      s('⌀', 'Diameter sign', ['diameter'], null),
      s('№', 'Numero sign', ['number', 'numero'], null),
      s('×', 'By (dimensions)', ['by', 'dimensions', 'times'], '\\times'),
    ],
  },
  {
    id: 'equation',
    label: 'Common equation symbols',
    symbols: [
      s('⟨', 'Mathematical left angle bracket', ['left angle bracket', 'bra'], '\\langle'),
      s('⟩', 'Mathematical right angle bracket', ['right angle bracket', 'ket'], '\\rangle'),
      s('⌈', 'Left ceiling', ['ceiling'], '\\lceil'),
      s('⌉', 'Right ceiling', ['ceiling'], '\\rceil'),
      s('⌊', 'Left floor', ['floor'], '\\lfloor'),
      s('⌋', 'Right floor', ['floor'], '\\rfloor'),
      s('‖', 'Double vertical line (norm)', ['norm', 'magnitude'], '\\|'),
      s('∣', 'Divides', ['divides', 'such that', 'given'], '\\mid'),
      s('∤', 'Does not divide', ['does not divide'], '\\nmid'),
      s('…', 'Horizontal ellipsis', ['ellipsis', 'dots', 'and so on'], '\\ldots'),
      s('⋯', 'Midline horizontal ellipsis', ['centred dots'], '\\cdots'),
      s('⋮', 'Vertical ellipsis', ['vertical dots'], '\\vdots'),
      s('⋱', 'Down right diagonal ellipsis', ['diagonal dots'], '\\ddots'),
      s('(', 'Left parenthesis', ['open bracket', 'left bracket'], '('),
      s(')', 'Right parenthesis', ['close bracket', 'right bracket'], ')'),
      s('≔', 'Is defined as', ['defined as', 'assignment'], '\\coloneqq'),
      s('∝', 'Proportional to', ['proportional'], '\\propto'),
      s('∞', 'Infinity', ['infinity'], '\\infty'),
      s('±', 'Plus-minus', ['plus minus'], '\\pm'),
      s('√', 'Radical', ['root', 'sqrt'], '\\sqrt'),
      s('∑', 'Summation', ['sum'], '\\sum'),
      s('∫', 'Integral', ['integral'], '\\int'),
      s('′', 'Prime', ['prime'], "'"),
      s('ℯ', 'Script small e (Euler number)', ['euler', 'exponential'], null),
      s('ℹ', 'Information source', ['information'], null),
    ],
  },
  {
    id: 'scientific',
    label: 'Scientific and medical notation',
    symbols: [
      s('♀', 'Female sign', ['female', 'woman', 'women'], '\\female'),
      s('♂', 'Male sign', ['male', 'man', 'men'], '\\male'),
      s('℞', 'Prescription take', ['prescription', 'rx', 'take'], null),
      s('℈', 'Scruple', ['scruple', 'apothecary'], null),
      s('℥', 'Ounce', ['ounce', 'apothecary'], null),
      s('c̄', 'c with bar (with)', ['with', 'cum'], null),
      s('s̄', 's with bar (without)', ['without', 'sine'], null),
      s('p̄', 'p with bar (after)', ['after', 'post'], null),
      s('q̄', 'q with bar (every)', ['every', 'quaque'], null),
      s('ā', 'a with bar (before)', ['before', 'ante'], null),
      s('↑', 'Increased', ['increased', 'elevated', 'raised', 'high'], '\\uparrow'),
      s('↓', 'Decreased', ['decreased', 'reduced', 'low'], '\\downarrow'),
      s('Δ', 'Change from baseline', ['change', 'delta'], '\\Delta'),
      s('✓', 'Check mark', ['check', 'tick', 'yes', 'present'], '\\checkmark'),
      s('✔', 'Heavy check mark', ['heavy check', 'yes'], null),
      s('✗', 'Ballot X', ['cross', 'no', 'absent'], null),
      s('✘', 'Heavy ballot X', ['heavy cross', 'no'], null),
      s('●', 'Filled circle', ['filled', 'positive', 'present'], '\\bullet'),
      s('○', 'Open circle', ['open', 'negative', 'absent'], '\\circ'),
      s('◐', 'Half-filled circle', ['partial', 'unclear'], null),
      s('†', 'Dagger', ['dagger', 'died', 'deceased', 'footnote'], '\\dagger'),
      s('‡', 'Double dagger', ['double dagger', 'footnote'], '\\ddagger'),
      s('∅', 'None / empty', ['none', 'nil', 'no finding'], '\\emptyset'),
      s('≈', 'Approximately', ['approximately', 'about', 'circa'], '\\approx'),
      s('±', 'Plus or minus', ['plus minus', 'sd', 'range'], '\\pm'),
      s('µ', 'Micro (µg, µL)', ['micro', 'microgram', 'microlitre'], '\\mu'),
      s('°', 'Degrees', ['degrees', 'temperature'], '^\\circ'),
      s('⌀', 'Diameter', ['diameter'], null),
      s('№', 'Number', ['number'], null),
      s('⊕', 'Positive (circled plus)', ['positive'], '\\oplus'),
      s('⊖', 'Negative (circled minus)', ['negative'], '\\ominus'),
    ],
  },
  {
    id: 'editorial',
    label: 'Editorial and manuscript',
    symbols: [
      s('§', 'Section sign', ['section', 'paragraph section'], '\\S'),
      s('¶', 'Pilcrow (paragraph)', ['paragraph', 'pilcrow'], '\\P'),
      s('†', 'Dagger', ['dagger', 'footnote'], '\\dagger'),
      s('‡', 'Double dagger', ['double dagger', 'footnote'], '\\ddagger'),
      s('©', 'Copyright sign', ['copyright'], '\\copyright'),
      s('®', 'Registered sign', ['registered', 'trademark'], '\\textregistered'),
      s('™', 'Trade mark sign', ['trademark', 'tm'], '\\texttrademark'),
      s('℠', 'Service mark', ['service mark', 'sm'], null),
      s('℅', 'Care of', ['care of', 'c/o'], null),
      s('№', 'Numero sign', ['number sign', 'numero'], null),
      s('…', 'Ellipsis', ['ellipsis', 'omitted text'], '\\ldots'),
      s('–', 'En dash', ['en dash', 'range dash'], '--'),
      s('—', 'Em dash', ['em dash', 'long dash'], '---'),
      s('‐', 'Hyphen', ['hyphen'], null),
      s('•', 'Bullet', ['bullet', 'list dot'], '\\bullet'),
      s('‣', 'Triangular bullet', ['triangle bullet'], null),
      s('⁃', 'Hyphen bullet', ['hyphen bullet'], null),
      s('※', 'Reference mark', ['reference mark', 'note'], null),
      s('⁂', 'Asterism', ['asterism', 'section break'], null),
      s('“', 'Left double quotation mark', ['open quote', 'left quote'], '``'),
      s('”', 'Right double quotation mark', ['close quote', 'right quote'], "''"),
      s('‘', 'Left single quotation mark', ['open single quote'], '`'),
      s('’', 'Right single quotation mark', ['close single quote', 'apostrophe'], "'"),
      s('„', 'Double low quotation mark', ['german quote'], null),
      s('«', 'Left-pointing double angle quotation', ['guillemet', 'french quote'], '\\guillemotleft'),
      s('»', 'Right-pointing double angle quotation', ['guillemet', 'french quote'], '\\guillemotright'),
      s('‹', 'Single left-pointing angle quotation', ['single guillemet'], null),
      s('›', 'Single right-pointing angle quotation', ['single guillemet'], null),
      s('¡', 'Inverted exclamation mark', ['inverted exclamation'], null),
      s('¿', 'Inverted question mark', ['inverted question'], null),
      s('′', 'Prime', ['prime', 'minutes'], "'"),
      s('✓', 'Check mark', ['check', 'tick'], '\\checkmark'),
      s('✗', 'Ballot X', ['cross', 'delete'], null),
    ],
  },
  {
    id: 'currency',
    label: 'Currency',
    symbols: [
      s('$', 'Dollar sign', ['dollar', 'usd'], '\\$'),
      s('€', 'Euro sign', ['euro', 'eur'], '\\euro'),
      s('£', 'Pound sign', ['pound', 'sterling', 'gbp'], '\\pounds'),
      s('¥', 'Yen sign', ['yen', 'jpy', 'yuan'], '\\yen'),
      s('¢', 'Cent sign', ['cent'], null),
      s('₩', 'Won sign', ['won', 'krw'], null),
      s('₹', 'Indian rupee sign', ['rupee', 'inr'], null),
      s('₽', 'Ruble sign', ['ruble', 'rub'], null),
      s('₺', 'Turkish lira sign', ['lira', 'try'], null),
      s('₪', 'New sheqel sign', ['shekel', 'ils'], null),
      s('₫', 'Dong sign', ['dong', 'vnd'], null),
      s('₦', 'Naira sign', ['naira', 'ngn'], null),
      s('₱', 'Peso sign', ['peso', 'php'], null),
      s('₴', 'Hryvnia sign', ['hryvnia', 'uah'], null),
      s('₸', 'Tenge sign', ['tenge', 'kzt'], null),
      s('₭', 'Kip sign', ['kip', 'lak'], null),
      s('₮', 'Tugrik sign', ['tugrik', 'mnt'], null),
      s('₲', 'Guarani sign', ['guarani', 'pyg'], null),
      s('₵', 'Cedi sign', ['cedi', 'ghs'], null),
      s('₡', 'Colon sign', ['colon currency', 'crc'], null),
      s('₿', 'Bitcoin sign', ['bitcoin', 'btc'], null),
      s('¤', 'Currency sign', ['generic currency'], null),
      s('ƒ', 'Florin sign', ['florin', 'guilder'], null),
    ],
  },
];

/** The catalogue, frozen. Every entry carries its derived `cp`. */
export const SYMBOL_CATEGORIES = Object.freeze(RAW_CATEGORIES.map((c) => Object.freeze({
  id: c.id,
  label: c.label,
  symbols: Object.freeze(c.symbols.map((sym) => Object.freeze(sym))),
})));

/** Every entry, in catalogue order (duplicates across categories included). */
export const ALL_SYMBOLS = Object.freeze(SYMBOL_CATEGORIES.flatMap((c) => c.symbols));

/** cp → the FIRST entry that carries it. Recents and favourites are stored by
    codepoint string, so they survive JSON, sorting and a renamed category. */
const BY_CP = new Map();
for (const sym of ALL_SYMBOLS) if (!BY_CP.has(sym.cp)) BY_CP.set(sym.cp, sym);

export function symbolByCp(cp) { return BY_CP.get(String(cp || '')) || null; }
export function symbolByChar(ch) { return symbolByCp(codePointsOf(ch)); }

/* ── search ────────────────────────────────────────────────────────────────────
   §1: search by "Symbol name / Common alias / Unicode character / Unicode code point
   / Common LaTeX-style name". One precomputed lowercase haystack per entry answers
   all five — the `citeItemOf` precedent, where six searchable reference fields are
   flattened once so the filter needs no field knowledge. */

/** All the ways a researcher might type a codepoint: U+03B1, 03b1, 3b1, 0x3b1. */
function cpForms(ch) {
  const out = [];
  for (const c of Array.from(String(ch || ''))) {
    const hex = c.codePointAt(0).toString(16).toLowerCase();
    const padded = hex.padStart(4, '0');
    out.push(`u+${padded}`, padded, hex, `0x${hex}`);
  }
  return out;
}

/** The lowercase haystack for one entry. Pure. */
export function buildSymbolSearch(sym) {
  if (!sym) return '';
  const latex = sym.latex ? String(sym.latex) : '';
  const parts = [
    sym.name || '',
    ...(Array.isArray(sym.aliases) ? sym.aliases : []),
    sym.ch || '',
    latex,
    latex.replace(/^\\+/, ''),          // "alpha" as well as "\alpha"
    ...cpForms(sym.ch),
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

const HAYSTACK = new WeakMap();
const haystackOf = (sym) => {
  let h = HAYSTACK.get(sym);
  if (h == null) { h = buildSymbolSearch(sym); HAYSTACK.set(sym, h); }
  return h;
};

/**
 * Search the whole catalogue. Terms are ANDed (so "greek small a" narrows), results
 * keep catalogue order and are de-duplicated by character. Pure.
 */
export function searchSymbols(query, opts = {}) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const limit = Number.isFinite(opts.limit) ? Math.max(1, Math.floor(opts.limit)) : 200;
  const seen = new Set();
  const out = [];
  for (const sym of ALL_SYMBOLS) {
    if (seen.has(sym.cp)) continue;
    const hay = haystackOf(sym);
    if (!terms.every((t) => hay.includes(t))) continue;
    seen.add(sym.cp);
    out.push(sym);
    if (out.length >= limit) break;
  }
  return out;
}

/* ── validation ────────────────────────────────────────────────────────────────
   The rule that keeps the catalogue safe to store and export. Run over EVERY entry
   by tests/unit/manuscript/symbols121.test.jsx, so a new data row cannot quietly
   introduce a character this manuscript model would corrupt. */

/**
 * @returns {{ok:boolean, problems:string[]}}  Pure.
 */
export function validateSymbolEntry(sym) {
  const problems = [];
  const push = (p) => problems.push(p);
  if (!sym || typeof sym !== 'object') return { ok: false, problems: ['not an object'] };
  const ch = typeof sym.ch === 'string' ? sym.ch : '';
  if (!ch) push('empty character');
  if (ch.length > 8) push('character is longer than one grapheme');
  if (typeof sym.name !== 'string' || !sym.name.trim()) push('missing name');
  if (!Array.isArray(sym.aliases) || sym.aliases.some((a) => typeof a !== 'string' || !a)) push('aliases must be non-empty strings');
  if (sym.latex != null && typeof sym.latex !== 'string') push('latex must be a string or null');
  if (sym.cp !== codePointsOf(ch)) push('cp does not describe ch');
  if (ch) {
    if (INVISIBLE_RE.test(ch)) push('contains a control, format or invisible character');
    if (typeof ch.normalize === 'function' && ch.normalize('NFC') !== ch) push('not NFC-stable');
    const cps = Array.from(ch);
    if (COMBINING_RE.test(cps[0])) push('starts with a combining mark');
    for (const c of cps) {
      if (MARKDOWN_UNSAFE_ASCII.has(c)) push(`"${c}" has a meaning in the markdown subset`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/* ── persistence (Recently Used + Favorites) ───────────────────────────────────
   §1 asks for both. They are READING STATE, not manuscript data: per user, in
   localStorage under the `metalab.<x>.${userId}` house key (the viewPrefKey /
   waPrefsKey precedent), byte-capped like clampWaPrefs, and NEVER in the project blob
   — the byte-stability convention. Stored by codepoint string, which is JSON-safe and
   survives a renamed category. */

export const SYMBOL_RECENTS_CAP = 18;
export const SYMBOL_FAVORITES_CAP = 40;
export const SYMBOL_PREFS_BYTE_CAP = 1200;

export const symbolPrefsKey = (userId) => (userId ? `metalab.symbolPicker.${userId}` : null);

export const EMPTY_SYMBOL_PREFS = Object.freeze({ recents: Object.freeze([]), favorites: Object.freeze([]) });

/** Keep only codepoints this build still knows, de-duplicated and capped. Pure. */
export function normalizeSymbolPrefs(raw) {
  const clean = (list, cap) => {
    const out = [];
    for (const v of Array.isArray(list) ? list : []) {
      const cp = String(v || '');
      if (!cp || out.includes(cp) || !BY_CP.has(cp)) continue;
      out.push(cp);
      if (out.length >= cap) break;
    }
    return out;
  };
  const r = raw && typeof raw === 'object' ? raw : {};
  return { recents: clean(r.recents, SYMBOL_RECENTS_CAP), favorites: clean(r.favorites, SYMBOL_FAVORITES_CAP) };
}

function prefsBytes(prefs) {
  const json = JSON.stringify(prefs);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length;
  return Buffer.from(json, 'utf8').length;
}

/** Shrink until it fits the cap, in the order that loses the least: the oldest
    recent first (one click re-adds it), then the oldest favourite. Pure. */
export function clampSymbolPrefs(raw) {
  const prefs = normalizeSymbolPrefs(raw);
  while (prefsBytes(prefs) > SYMBOL_PREFS_BYTE_CAP && prefs.recents.length) prefs.recents.pop();
  while (prefsBytes(prefs) > SYMBOL_PREFS_BYTE_CAP && prefs.favorites.length) prefs.favorites.pop();
  return prefs;
}

/** Most recent FIRST, no duplicates, capped. Pure. */
export function pushRecent(prefs, cp) {
  const key = String(cp || '');
  const cur = normalizeSymbolPrefs(prefs);
  if (!BY_CP.has(key)) return cur;
  return clampSymbolPrefs({
    recents: [key, ...cur.recents.filter((x) => x !== key)],
    favorites: cur.favorites,
  });
}

/** Star / un-star. Pure. */
export function toggleFavorite(prefs, cp) {
  const key = String(cp || '');
  const cur = normalizeSymbolPrefs(prefs);
  if (!BY_CP.has(key)) return cur;
  const on = cur.favorites.includes(key);
  return clampSymbolPrefs({
    recents: cur.recents,
    favorites: on ? cur.favorites.filter((x) => x !== key) : [...cur.favorites, key],
  });
}

export default {
  SYMBOL_CATEGORIES,
  ALL_SYMBOLS,
  SYMBOL_FONT_STACK,
  codePointsOf,
  symbolByCp,
  symbolByChar,
  buildSymbolSearch,
  searchSymbols,
  validateSymbolEntry,
  symbolPrefsKey,
  normalizeSymbolPrefs,
  clampSymbolPrefs,
  pushRecent,
  toggleFavorite,
};
