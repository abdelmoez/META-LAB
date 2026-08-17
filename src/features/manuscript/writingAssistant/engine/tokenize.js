/**
 * features/manuscript/writingAssistant/engine/tokenize.js — 120.md §6 (Writing Assistant).
 *
 * The SCIENTIFIC-TOKEN FIREWALL. Everything the checker is allowed to look at passes
 * through here first, and the single most important product of this module is the set
 * of things it refuses to hand on: DOIs, PMIDs, NCT/PROSPERO ids, URLs, e-mail
 * addresses, file names, version numbers, chemical formulas, gene/protein symbols,
 * Greek letters, super/subscripts, en-dash numeric ranges, units (mg/dL, mmHg, kg/m²,
 * mL/min/1.73 m²), dosage expressions (5 mg/kg) and statistical notation (p < 0.05,
 * 95% CI, I², τ², OR = 1.25). §6 is explicit that these must never become spelling
 * errors, so the firewall lives BEFORE the dictionary rather than as a filter after it.
 *
 * Pure and dependency-free, exactly like richEditor/mdDom.js — no DOM, no React, no
 * fs. Everything here is a string→data transform so the whole engine is unit-testable
 * in Node and re-usable from the Web Worker.
 *
 * Offsets are the contract. Every token carries [start, end) into the ORIGINAL string
 * the caller passed in, because the decoration layer (Wave 4b) resolves those offsets
 * back into live editor text nodes. That is also why `maskNonProse()` replaces things
 * with SAME-LENGTH placeholder runs instead of deleting them: masking must never move
 * a single character.
 */

/** Token kinds. Only TOKEN.WORD is ever spell-checked (see `isCheckable`). */
export const TOKEN = Object.freeze({
  WORD: 'word',
  ACRONYM: 'acronym',
  GENE: 'gene',
  CHEMICAL: 'chemical',
  NUMBER: 'number',
  RANGE: 'range',
  UNIT: 'unit',
  STAT: 'stat',
  IDENTIFIER: 'identifier',
  URL: 'url',
  EMAIL: 'email',
  FILENAME: 'filename',
  VERSION: 'version',
  GREEK: 'greek',
  SUPERSCRIPT: 'superscript',
  PLACEHOLDER: 'placeholder',
  PUNCT: 'punct',
  SYMBOL: 'symbol',
  SPACE: 'space',
  /* 120.md r2 — a multi-word Latin scholarly phrase (`et al.`, `in vivo`, `de novo`).
     Firewalled as ONE token because its halves are not English words and never will
     be: the r2 review proved `Smith et al. reported` produced two spelling errors per
     citation (suggesting `er` for `et` and `all` for `al`), and `in vivo`/`in vitro`/
     `de novo`/`in silico` each flagged their second word, in every manuscript. */
  LATIN: 'latin',
});

/**
 * 120.md §6 — the mask character. U+FFFC OBJECT REPLACEMENT CHARACTER is the Unicode
 * stand-in for "a thing that is not text lives here", which is precisely what a
 * `[[cite:r1]]` chip, a code span or a link destination is to the checker. It never
 * occurs in manuscript prose, and the tokenizer classifies runs of it as
 * PLACEHOLDER (non-checkable), so offsets stay aligned with the real text.
 */
export const MASK_CHAR = '￼';

/** Whitespace the tokenizer treats as a separator (incl. NBSP / narrow NBSP / thin). */
const SPACE_RE = /[ \t       ]+/y;

/**
 * Hyphen-ish characters that may sit INSIDE a word (non-breaking hyphen, figure dash,
 * en/em dash, minus, and the plain hyphen). The plain `-` is LAST on purpose: these
 * are interpolated into character classes, and a `-` anywhere but the end would be
 * read as a range operator (which silently broke `IL-6` during development).
 */
const WORD_JOINERS = "‐‑‒–—―−-";
/** Apostrophes that may sit inside a word (straight + curly). */
const WORD_APOSTROPHES = "'’ʼ";

/**
 * Units the firewall recognises. Deliberately a CLOSED SET: an open "letters after a
 * number" rule would swallow `12 months` and `5 patients` and silently stop checking
 * ordinary prose. Anything not in here falls through to the normal word path.
 */
const UNIT_ATOMS = new Set([
  // length / area / volume
  'm', 'cm', 'mm', 'km', 'nm', 'µm', 'μm', 'um', 'dm',
  // mass
  'g', 'kg', 'mg', 'µg', 'μg', 'ug', 'ng', 'pg', 'mcg', 't',
  // volume
  'L', 'l', 'mL', 'ml', 'dL', 'dl', 'µL', 'μL', 'uL', 'ul', 'nL', 'cc',
  // amount / activity
  'mol', 'mmol', 'µmol', 'μmol', 'umol', 'nmol', 'pmol', 'fmol',
  'IU', 'kIU', 'mIU', 'U', 'mU', 'kU', 'mEq', 'Eq', 'osmol', 'mOsm',
  // time
  's', 'sec', 'ms', 'min', 'h', 'hr', 'd', 'wk', 'mo', 'yr',
  // pressure / frequency / energy / dose
  'Pa', 'kPa', 'mmHg', 'cmH2O', 'atm', 'bar', 'Hz', 'kHz', 'MHz',
  'J', 'kJ', 'kcal', 'cal', 'W', 'mW', 'Gy', 'cGy', 'mGy', 'Sv', 'mSv', 'µSv',
  'Bq', 'MBq', 'Ci', 'mCi', 'rad', 'R',
  // electrical / magnetic
  'V', 'mV', 'kV', 'A', 'mA', 'T', 'mT', 'ohm', 'dB',
  // concentration helpers / counts
  '%', 'ppm', 'ppb', 'cells', 'copies', 'beats', 'breaths', 'bpm', 'rpm',
  // temperature
  '°C', '°F', 'K',
]);

/**
 * Units safe to recognise WITHOUT a preceding number. `mmHg` alone is unambiguous;
 * a bare `T`, `s`, `d`, `A`, `R` or `min` is not, so those only count when a number
 * or a division chain makes the intent obvious.
 */
const UNIT_BARE_OK = new Set([
  'mmHg', 'cmH2O', 'kg', 'mg', 'µg', 'μg', 'ng', 'pg', 'mcg', 'mL', 'ml', 'dL', 'dl',
  'µL', 'μL', 'mmol', 'µmol', 'μmol', 'nmol', 'pmol', 'mEq', 'mOsm', 'kPa', 'kcal',
  'kJ', 'mSv', 'cGy', 'mGy', 'MBq', 'mCi', 'kHz', 'MHz', 'bpm', 'rpm', 'ppm', 'ppb',
  '°C', '°F', 'cm', 'mm', 'nm', 'µm', 'μm', 'km', 'IU', 'kIU', 'mIU',
]);

/** Length units that may carry a bare `2`/`3` exponent (`m2`, `cm3`). */
const EXPONENTIABLE = new Set(['m', 'cm', 'mm', 'km', 'µm', 'μm', 'nm', 'dm', 'in']);

/** Chemical element symbols, for telling `NaCl`/`CO2` apart from `MEDLINE`/`PRISMA`. */
const ELEMENTS = new Set(
  ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn '
   + 'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La '
   + 'Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po '
   + 'At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr').split(' '),
);

/**
 * Abbreviations that end in `.` without ending a sentence. Without these the sentence
 * splitter would cut "Smith et al. reported" in half and every rule downstream (initial
 * capitalisation, fragments, run-ons) would fire on the debris.
 */
const SENTENCE_ABBREV = new Set([
  'e.g', 'i.e', 'etc', 'et al', 'al', 'vs', 'cf', 'ca', 'approx', 'no', 'nos', 'fig',
  'figs', 'tab', 'eq', 'ref', 'refs', 'ed', 'eds', 'vol', 'vols', 'pp', 'p', 'ch',
  'dr', 'prof', 'mr', 'mrs', 'ms', 'st', 'inc', 'ltd', 'co', 'dept', 'univ', 'assoc',
  'jr', 'sr', 'ph.d', 'm.d', 'b.sc', 'm.sc', 'u.s', 'u.k', 'min', 'max', 'sd', 'se',
  'i.v', 'p.o', 'b.i.d', 't.i.d', 'q.d', 'mg', 'ml', 'wt', 'approx',
]);

/* ------------------------------------------------------------------ masking ---- */

const TOKEN_MARKER_RE = /\[\[[^\]\n]*\]\]/g;
const CODE_SPAN_RE = /`[^`\n]*`/g;
const MD_LINK_RE = /\[([^\]\n]*)\]\(([^)\s]*(?:\s+"[^"]*")?)\)/g;
const BARE_URL_RE = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"')\]]+/g;

const maskRun = (n) => MASK_CHAR.repeat(n);

/**
 * 120.md §6 — replace everything that is not editable prose with SAME-LENGTH runs of
 * MASK_CHAR. Same length is the whole point: Wave 4b's decoration layer resolves issue
 * offsets against the live DOM text of the block, so masking may never shift a
 * character. Idempotent (mask characters are inert), so a caller that masks twice is
 * not punished.
 *
 * Masked: `[[cite:…]]` / `[[fact:…]]` / `[[table:…]]` chips, inline code spans, the
 * `](destination)` half of a markdown link (the LABEL stays checkable prose), and bare
 * URLs. Emphasis markers (`**`, `*`) are left alone — they tokenize as punctuation and
 * cost nothing.
 */
export function maskNonProse(text) {
  let out = String(text ?? '');
  out = out.replace(TOKEN_MARKER_RE, (m) => maskRun(m.length));
  out = out.replace(CODE_SPAN_RE, (m) => maskRun(m.length));
  out = out.replace(MD_LINK_RE, (m, label) => `${MASK_CHAR}${label}${maskRun(m.length - label.length - 1)}`);
  out = out.replace(BARE_URL_RE, (m) => maskRun(m.length));
  return out;
}

/* ---------------------------------------------------------------- matchers ----- */

/** Sticky regex helper: match `re` at exactly `i`, return the matched length or 0. */
function stickyLen(re, text, i) {
  re.lastIndex = i;
  const m = re.exec(text);
  return m && m.index === i ? m[0].length : 0;
}

const RE_URL = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"' ]*[^\s<>"' .,;:)\]]/y;
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/y;
const RE_DOI = /(?:doi\s*:\s*)?10\.\d{4,9}\/[^\s]*[^\s.,;:)\]]/iy;
const RE_PMID = /PMID\s*:?\s*\d{4,9}/iy;
const RE_PMCID = /PMC\d{5,9}/y;
const RE_TRIAL_ID = /(?:NCT\d{6,11}|ISRCTN\d{6,10}|ACTRN\d{8,20}|ChiCTR[-A-Za-z0-9]*\d{4,}|UMIN\d{6,}|IRCT\d{6,}[A-Za-z0-9]*|EUCTR\d{4}-\d{6}-\d{2}(?:-[A-Z]{2})?|DRKS\d{6,})/y;
const RE_PROSPERO = /CRD\d{8,15}/y;
const RE_VERSION = /(?:v\d+\.\d+(?:\.\d+)*|\d+\.\d+\.\d+(?:\.\d+)*)(?:-[0-9A-Za-z.]+)?/y;
const RE_FILENAME = /[\w][\w-]*\.(?:pdf|docx?|xlsx?|pptx?|csv|tsv|txt|md|json|xml|zip|png|jpe?g|gif|svg|tiff?|sav|dta|sas|py|js|ts|rmd)\b/iy;
const RE_ISBN_ISSN = /(?:ISSN|ISBN)\s*:?\s*[\dX-]{8,17}/iy;

/** `p < 0.05`, `P = .04`, `p-value ≤ 0.001`. */
const RE_STAT_P = /[pP](?:\s*[-‐-―]?\s*values?)?\s*(?:<|>|=|≤|≥|≠|<=|>=)\s*\.?\d[\d.]*/y;
/** `95% CI`, `95 % confidence interval`, `95% CrI`. */
const RE_STAT_CI = /\d{1,3}(?:\.\d+)?\s*%\s*(?:CIs?|CrIs?|confidence\s+intervals?|credible\s+intervals?)\b/iy;
/** `I²`, `I2`, `τ²`, `χ²`, `R²` — but not the `H2` of `H2O` (lookahead). */
const RE_STAT_SQUARE = /(?:I|Q|H|R|r|τ|χ|κ|tau|chi|kappa)\s*(?:²|\^\s*2|2)(?![A-Za-z0-9])/y;
/** `OR = 1.25`, `aHR: 0.83`, `SMD = -0.42`. */
const RE_STAT_EFFECT = /(?:aOR|aHR|aRR|OR|RR|HR|SMD|WMD|MD|IRR|SE|SD|IQR|CI|AUC|ICC|NNT|NNH|RD|PR|ES|df|α|β)\s*(?:=|:|<|>|≤|≥)\s*[-−+]?\d[\d.,]*/y;
/** `n = 120`, `N=1,204`. */
const RE_STAT_N = /[nN]\s*=\s*\d+(?:,\d{3})*/y;
/** Bare comparison + number: `< 0.001`, `≥ 18`, `±1.4`. */
const RE_STAT_CMP = /(?:<|>|≤|≥|≠|±|≈|~)\s*\d[\d.,]*\s*%?/y;

/** En-dash (or hyphen/minus) numeric range: `12–15`, `2019–2021`, `1.2-3.4`. */
const RE_RANGE = /\d+(?:[.,]\d+)?\s*[‐-―−-]\s*\d+(?:[.,]\d+)?/y;
/** A plain number, including thousands separators, decimals and a trailing `%`. */
const RE_NUMBER = /[-−+]?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*%)?/y;
/**
 * Greek block + the MICRO SIGN (U+00B5), which is NOT the Greek mu (U+03BC).
 *
 * 120.md r2 — plus the MATHEMATICAL ALPHANUMERIC Greek ranges (U+1D6A8‥U+1D7CB).
 * Word's equation editor and MathType paste `β` as U+1D6FD MATHEMATICAL ITALIC SMALL
 * BETA, which is `\p{L}` but is not in the Greek block, so it fell through to RE_WORD
 * and — being TWO UTF-16 units — passed pipeline.js's `length < 2` guard and was
 * looked up: `“𝛽” is not in the dictionary`, suggesting A–E. §6 names Greek letters
 * as a must-not-flag class, and it does not stop at the BMP. The `u` flag is what
 * makes the astral range a range rather than four surrogate halves.
 */
const RE_GREEK = /[Ͱ-Ͽἀ-῿µ\u{1D6A8}-\u{1D7CB}]+/uy;

/**
 * 120.md r2 — the LATIN SCHOLARLY PHRASES, firewalled before the word scanner.
 *
 * `et`, `al`, `vivo`, `vitro`, `novo`, `silico` and `hoc` are in no English
 * dictionary, in no medical lexicon, and cannot be rescued by the project lexicon
 * (which rejects terms under three characters), so every one of them was a spelling
 * ERROR with junk suggestions — 2N underlines in a Discussion citing N studies.
 * Matching the PHRASE rather than teaching the halves as words is what keeps a bare
 * `al` (a plausible typo for `all`) checkable.
 */
const RE_LATIN = new RegExp(
  '(?:et[ \\t\\u00a0]+al\\.?'
  + '|in[ \\t\\u00a0]+(?:vivo|vitro|situ|silico|utero|toto|vacuo|extenso)'
  + '|ex[ \\t\\u00a0]+vivo'
  + '|de[ \\t\\u00a0]+novo'
  + '|post[ \\t\\u00a0]+hoc'
  + '|ad[ \\t\\u00a0]+(?:hoc|libitum)'
  + '|per[ \\t\\u00a0]+se)(?![\\p{L}\\p{N}])',
  'uiy',
);
/** Super/subscript digits and signs. */
const RE_SUPER = /[²³¹⁰-ₜ]+/y;
/** A run of mask characters. */
const RE_MASK = /￼+/y;
/** The generic word run: letters, then letter/digit, joined by hyphens/apostrophes. */
const RE_WORD = new RegExp(
  `[\\p{L}\\p{M}][\\p{L}\\p{M}\\p{N}]*(?:[${WORD_APOSTROPHES}${WORD_JOINERS}][\\p{L}\\p{M}\\p{N}]+)*`,
  'uy',
);
/** A letter run used by the unit scanner. */
const RE_LETTERS = /[A-Za-zµμ]+/y;

/* ----------------------------------------------------------- unit scanner ------ */

/**
 * Read one unit atom at `i` (`mg`, `mL`, `%`, `°C`, `m²`, `m2`). Returns the consumed
 * length and the canonical atom, or 0. Atoms are matched WHOLE — `minutes` is never
 * read as `min` + leftovers, which is what keeps ordinary prose checkable.
 */
function readUnitAtom(text, i) {
  if (text[i] === '%') return { len: 1, atom: '%' };
  if (text[i] === '°' && (text[i + 1] === 'C' || text[i + 1] === 'F')) {
    return { len: 2, atom: text.slice(i, i + 2) };
  }
  const letters = stickyLen(RE_LETTERS, text, i);
  if (!letters) return { len: 0, atom: '' };
  const atom = text.slice(i, i + letters);
  if (!UNIT_ATOMS.has(atom)) return { len: 0, atom: '' };
  let len = letters;
  const next = text[i + len];
  if (next === '²' || next === '³') len += 1;
  else if (next === '^' && (text[i + len + 1] === '2' || text[i + len + 1] === '3')) len += 2;
  else if (EXPONENTIABLE.has(atom) && (next === '2' || next === '3')
           && !/[\d.]/.test(text[i + len + 1] || '')) len += 1;
  return { len, atom };
}

/**
 * Read a unit EXPRESSION at `i`: `mg`, `mg/dL`, `kg/m²`, `mL/min/1.73 m²`, `mg·kg⁻¹`.
 * `bareOk` is false when no number precedes, so an isolated `d` or `T` cannot swallow
 * a word. Returns consumed length (0 = not a unit).
 */
function readUnitExpr(text, i, bareOk) {
  const first = readUnitAtom(text, i);
  if (!first.len) return 0;
  let end = i + first.len;
  let chain = 0;
  for (;;) {
    let j = end;
    while (text[j] === ' ' || text[j] === ' ') j += 1;
    if (text[j] !== '/' && text[j] !== '·' && text[j] !== '⋅' && text[j] !== '*') break;
    j += 1;
    while (text[j] === ' ' || text[j] === ' ') j += 1;
    // `mL/min/1.73 m²` — a numeric factor may sit inside the chain.
    const num = stickyLen(RE_NUMBER, text, j);
    let k = j + num;
    if (num) while (text[k] === ' ' || text[k] === ' ') k += 1;
    const atom = readUnitAtom(text, k);
    if (!atom.len) {
      // A trailing numeric factor with no unit (`/1.73`) still belongs to the chain.
      if (num && chain > 0) { end = j + num; chain += 1; continue; }
      break;
    }
    end = k + atom.len;
    chain += 1;
  }
  const hasSuper = /[²³]|\^[23]/.test(text.slice(i, end));
  if (!bareOk && chain === 0 && !hasSuper && !UNIT_BARE_OK.has(first.atom)) return 0;
  return end - i;
}

/** `5 mg/kg`, `12.4 mmol/L`, `95 %` — a number bound to a unit expression. */
function readQuantity(text, i) {
  const num = stickyLen(RE_NUMBER, text, i);
  if (!num) return 0;
  let j = i + num;
  while (text[j] === ' ' || text[j] === ' ' || text[j] === ' ') j += 1;
  const unit = readUnitExpr(text, j, true);
  if (!unit) return 0;
  return j + unit - i;
}

/* --------------------------------------------------------- classification ----- */

const hasDigit = (s) => /\d/.test(s);
const hasLower = (s) => /[a-z]/.test(s);
/** Any Greek letter, BMP or mathematical-alphanumeric (the RE_GREEK class, unanchored). */
const hasGreek = (s) => /[Ͱ-Ͽἀ-῿µ\u{1D6A8}-\u{1D7CB}]/u.test(s);

/** `NaCl`, `CO2`, `H2O2`, `CaCO3` — every segment must be a real element symbol. */
function isChemicalFormula(word) {
  if (word.length > 14) return false;
  if (!/^[A-Za-z0-9]+[+-]?$/.test(word)) return false;
  const re = /([A-Z][a-z]?)(\d*)/y;
  let i = 0;
  let segments = 0;
  while (i < word.length) {
    if (word[i] === '+' || word[i] === '-') { i += 1; continue; }
    re.lastIndex = i;
    const m = re.exec(word);
    if (!m || m.index !== i) return false;
    if (!ELEMENTS.has(m[1])) return false;
    segments += 1;
    i += m[0].length;
  }
  return segments >= 2;
}

/**
 * Classify a word-shaped run. Order matters: all-caps wins over chemistry so `SPIN`
 * stays an acronym rather than becoming S-P-I-N, and anything carrying a digit is a
 * gene/protein/marker symbol (`TP53`, `IL-6`, `HbA1c`, `COVID-19`, `SARS-CoV-2`).
 */
export function classifyWordRun(word) {
  if (!word) return TOKEN.WORD;
  if (/^[A-Z]{2,8}$/.test(word)) return TOKEN.ACRONYM;
  if (hasDigit(word) && /[\p{L}]/u.test(word) && word.length <= 16) return TOKEN.GENE;
  /* 120.md r2 — a protein/cytokine symbol carrying its conventional GREEK suffix:
     TNF-α, IFN-γ, TGF-β, NF-κB. RE_WORD consumes the whole run (Greek is \p{L}, the
     hyphen is a WORD_JOINER) and every existing guard missed it — /^[A-Z]{2,8}$/
     fails on the hyphen, there is no digit, and both mixed-case branches require an
     ASCII [a-z] that Greek lowercase can never satisfy. The run was therefore
     checkable, subWords split it, and `TNF`, `IFN` and `κB` were each reported as
     misspellings while a BARE `TNF` in the same paragraph was accepted as an acronym.
     Two or more capitals beside a Greek letter is the symbol signature; a Greek
     letter beside ordinary lower-case prose (`α-blocker`) is left alone. */
  if (hasGreek(word) && (word.match(/[A-Z]/g) || []).length >= 2) return TOKEN.GENE;
  if (hasLower(word) && isChemicalFormula(word)) return TOKEN.CHEMICAL;
  // Mixed-case abbreviations are everywhere in medicine — HRQoL, PubMed, MeSH, IgG,
  // mmHg. Two or more capitals inside a short token is the signature; an ordinary
  // Capitalized word has exactly one, so `Patients` stays checkable.
  if (hasLower(word) && word.length <= 10 && (word.match(/[A-Z]/g) || []).length >= 2) {
    return TOKEN.ACRONYM;
  }
  return TOKEN.WORD;
}

/** Only ordinary words reach the dictionary chain. Everything else is firewalled. */
export function isCheckable(token) {
  return token.kind === TOKEN.WORD;
}

/* --------------------------------------------------------------- tokenize ----- */

/**
 * The ordered phrase matchers. First match at a position wins, so the specific
 * (identifier / statistic / unit) always beats the generic (number / word).
 */
const PHRASES = [
  [TOKEN.URL, (t, i) => stickyLen(RE_URL, t, i)],
  [TOKEN.EMAIL, (t, i) => stickyLen(RE_EMAIL, t, i)],
  [TOKEN.IDENTIFIER, (t, i) => stickyLen(RE_DOI, t, i)],
  [TOKEN.IDENTIFIER, (t, i) => stickyLen(RE_PMID, t, i)],
  [TOKEN.IDENTIFIER, (t, i) => stickyLen(RE_PMCID, t, i)],
  [TOKEN.IDENTIFIER, (t, i) => stickyLen(RE_TRIAL_ID, t, i)],
  [TOKEN.IDENTIFIER, (t, i) => stickyLen(RE_PROSPERO, t, i)],
  [TOKEN.IDENTIFIER, (t, i) => stickyLen(RE_ISBN_ISSN, t, i)],
  [TOKEN.FILENAME, (t, i) => stickyLen(RE_FILENAME, t, i)],
  [TOKEN.STAT, (t, i) => stickyLen(RE_STAT_CI, t, i)],
  [TOKEN.STAT, (t, i) => stickyLen(RE_STAT_P, t, i)],
  [TOKEN.STAT, (t, i) => stickyLen(RE_STAT_EFFECT, t, i)],
  [TOKEN.STAT, (t, i) => stickyLen(RE_STAT_N, t, i)],
  [TOKEN.STAT, (t, i) => stickyLen(RE_STAT_SQUARE, t, i)],
  [TOKEN.VERSION, (t, i) => stickyLen(RE_VERSION, t, i)],
  [TOKEN.UNIT, (t, i) => readQuantity(t, i)],
  [TOKEN.RANGE, (t, i) => stickyLen(RE_RANGE, t, i)],
  [TOKEN.STAT, (t, i) => stickyLen(RE_STAT_CMP, t, i)],
  [TOKEN.NUMBER, (t, i) => stickyLen(RE_NUMBER, t, i)],
  [TOKEN.UNIT, (t, i) => readUnitExpr(t, i, false)],
  [TOKEN.GREEK, (t, i) => stickyLen(RE_GREEK, t, i)],
  [TOKEN.SUPERSCRIPT, (t, i) => stickyLen(RE_SUPER, t, i)],
  // 120.md r2 — the Latin phrase firewall. LAST of the phrase matchers and still
  // before the generic word scanner, so it can only ever claim a run RE_WORD would
  // otherwise have handed to the dictionary.
  [TOKEN.LATIN, (t, i) => stickyLen(RE_LATIN, t, i)],
];

/**
 * Tokenize a block of plain text.
 *
 * @param {string} input block text (already masked by `maskNonProse`, or `opts.mask`)
 * @param {{mask?: boolean, includeSpace?: boolean}} [opts]
 * @returns {{text: string, tokens: Array<{text:string,start:number,end:number,kind:string,checkable:boolean}>}}
 */
export function tokenize(input, opts = {}) {
  const raw = String(input ?? '');
  const text = opts.mask === false ? raw : maskNonProse(raw);
  const tokens = [];
  const len = text.length;
  let i = 0;

  const push = (kind, start, end) => {
    tokens.push({
      text: text.slice(start, end),
      start,
      end,
      kind,
      checkable: kind === TOKEN.WORD,
    });
  };

  while (i < len) {
    const ch = text[i];

    if (ch === '\n' || ch === '\r') {
      if (opts.includeSpace) push(TOKEN.SPACE, i, i + 1);
      i += 1;
      continue;
    }
    const sp = stickyLen(SPACE_RE, text, i);
    if (sp) {
      if (opts.includeSpace) push(TOKEN.SPACE, i, i + sp);
      i += sp;
      continue;
    }
    const mask = stickyLen(RE_MASK, text, i);
    if (mask) { push(TOKEN.PLACEHOLDER, i, i + mask); i += mask; continue; }

    let matched = false;
    for (const [kind, fn] of PHRASES) {
      const n = fn(text, i);
      if (n > 0) { push(kind, i, i + n); i += n; matched = true; break; }
    }
    if (matched) continue;

    const wordLen = stickyLen(RE_WORD, text, i);
    if (wordLen) {
      const word = text.slice(i, i + wordLen);
      push(classifyWordRun(word), i, i + wordLen);
      i += wordLen;
      continue;
    }

    push(/[\p{P}]/u.test(ch) ? TOKEN.PUNCT : TOKEN.SYMBOL, i, i + 1);
    i += 1;
  }

  return { text, tokens };
}

/* -------------------------------------------------------------- sub-words ----- */

/**
 * Split a word token into the pieces the dictionary chain actually looks up: hyphen
 * and en-dash compounds become parts (`Newcastle–Ottawa` → `Newcastle`, `Ottawa`),
 * possessives lose their `'s`. Each piece keeps its ABSOLUTE offsets so a spelling
 * issue underlines only the wrong half of a compound.
 */
export function subWords(token) {
  const parts = [];
  const { text, start } = token;
  const joiner = new RegExp(`[${WORD_JOINERS}]`);
  let cursor = 0;
  for (const chunk of text.split(joiner)) {
    const at = text.indexOf(chunk, cursor);
    cursor = at + chunk.length;
    if (!chunk) continue;
    let word = chunk;
    let offset = 0;
    const possessive = word.match(new RegExp(`[${WORD_APOSTROPHES}]s?$`));
    if (possessive) word = word.slice(0, word.length - possessive[0].length);
    // A leading apostrophe (’tis) is decoration, not spelling.
    const lead = word.match(new RegExp(`^[${WORD_APOSTROPHES}]+`));
    if (lead) { offset = lead[0].length; word = word.slice(lead[0].length); }
    if (!word) continue;
    parts.push({ word, start: start + at + offset, end: start + at + offset + word.length });
  }
  return parts;
}

/* -------------------------------------------------------------- sentences ----- */

const SENTENCE_END = /[.!?][)"'’”\]]*/g;

/**
 * Split text into sentence spans. Abbreviation-, decimal-, identifier- and
 * initial-aware: "Smith et al. reported p < 0.05 in Fig. 2." is ONE sentence. Every
 * grammar rule downstream depends on this, so it errs toward NOT splitting.
 */
export function splitSentences(text) {
  const src = String(text ?? '');
  const spans = [];
  let start = 0;
  SENTENCE_END.lastIndex = 0;
  let m;
  while ((m = SENTENCE_END.exec(src)) !== null) {
    const dot = m.index;
    const after = src.slice(dot + m[0].length);
    const before = src.slice(start, dot);

    // A decimal point / DOI / version dot: digit on both sides.
    if (src[dot] === '.' && /\d$/.test(before) && /^\d/.test(after)) continue;
    // A known abbreviation immediately before the dot.
    const tail = before.match(/[A-Za-z.]+$/);
    if (src[dot] === '.' && tail && SENTENCE_ABBREV.has(tail[0].toLowerCase())) continue;
    // A single-letter initial ("J. Smith", "A. B. Author").
    if (src[dot] === '.' && /(?:^|[\s(])[A-Za-z]$/.test(before)) continue;
    // Not followed by whitespace/end → still inside a token (`e.g.`, `U.S.A`).
    if (after && !/^[\s ]/.test(after)) continue;

    const end = dot + m[0].length;
    if (src.slice(start, end).trim()) spans.push({ start, end, text: src.slice(start, end) });
    start = end;
    while (/[\s ]/.test(src[start] || '')) start += 1;
    SENTENCE_END.lastIndex = start;
  }
  if (start < src.length && src.slice(start).trim()) {
    spans.push({ start, end: src.length, text: src.slice(start) });
  }
  return spans;
}

/** Trim a span to its non-whitespace core, keeping absolute offsets truthful. */
export function trimSpan(text, start, end) {
  let s = start;
  let e = end;
  while (s < e && /[\s ]/.test(text[s])) s += 1;
  while (e > s && /[\s ]/.test(text[e - 1])) e -= 1;
  return { start: s, end: e };
}

export const __internal = { readUnitExpr, readQuantity, isChemicalFormula, UNIT_ATOMS, ELEMENTS };
