/**
 * 105.md — the PRISMA connector/layout system.
 *
 * These assertions are geometric, because the reported defect was geometric: an
 * arrow that "points to nowhere". Every test here parses the emitted SVG and
 * checks that each arrow actually starts on one box's edge and ends on another's.
 * A diagram can be methodologically perfect and still be unreadable, and no test
 * in the suite previously looked at where a single line ended up.
 */
import { describe, it, expect } from 'vitest';
import { derivePrismaFlow } from '../../../src/research-engine/prisma/derive.js';
import { buildPrismaFlowSVG } from '../../../src/research-engine/prisma/svg.js';

let seq = 0;
const rec = (o = {}) => ({ id: `r${seq++}`, origin: 'search', sourceDb: 'PubMed', ...o });
const many = (n, o) => Array.from({ length: n }, () => rec(o));

/**
 * Every connector in the diagram, normalized to { x1,y1 (origin), x2,y2
 * (destination), pts (the full path) }. Straight connectors are <line>; a
 * connector that has to route around a box is a <polyline> elbow — both must obey
 * the same rule that the path starts on one box edge and ends on another.
 */
function lines(svg) {
  const out = [];
  const re = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g;
  let m;
  while ((m = re.exec(svg))) {
    const p = [[+m[1], +m[2]], [+m[3], +m[4]]];
    out.push({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], pts: p, bend: false });
  }
  const pre = /<polyline points="([^"]+)"/g;
  while ((m = pre.exec(svg))) {
    const p = m[1].trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
    const a = p[0]; const z = p[p.length - 1];
    out.push({ x1: a[0], y1: a[1], x2: z[0], y2: z[1], pts: p, bend: true });
  }
  return out;
}

/** The legs of a connector, as segments. */
const segments = (l) => l.pts.slice(1).map((pt, i) => ({
  x1: l.pts[i][0], y1: l.pts[i][1], x2: pt[0], y2: pt[1],
}));

const boxOf = (built, id) => built.boxes.find((b) => b.id === id);
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

/** A flow with a DEEP exclusion-reasons list — the case that broke the old maths. */
const REASONS = [
  'Wrong population', 'Wrong intervention', 'Wrong comparator', 'Wrong outcome',
  'Wrong study design', 'Duplicate publication',
];
const DEEP = derivePrismaFlow([
  ...many(800, { isDuplicate: true, dedupStage: 'search' }),
  ...many(2000, { screeningDecision: 'exclude' }),
  ...many(30, { screeningDecision: 'include', soughtRetrieval: true, retrieved: false }),
  ...REASONS.flatMap((reason) => many(20, {
    screeningDecision: 'include', soughtRetrieval: true, retrieved: true,
    fullTextDecision: 'exclude', exclusionReason: reason,
  })),
  ...many(90, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true }),
  ...many(8, { origin: 'mining', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true }),
]);

/* ═══════════════ the reported defect ═══════════════ */

describe('the arrow out of "Reports assessed for eligibility"', () => {
  const built = buildPrismaFlowSVG(DEEP, { perSource: true });
  const assessed = boxOf(built, 'assessed_db');
  const excluded = boxOf(built, 'excluded_full_text_db');
  const included = boxOf(built, 'included_studies');
  // Both arms' eligibility boxes share a row, so their bottom edges are at the same
  // y. Pick the database arm's connector by column, not by edge alone.
  const dbArrow = lines(built.svg).find((l) => near(l.y1, assessed.y + assessed.h)
    && l.x1 >= assessed.x && l.x1 <= assessed.x + assessed.w);

  it('sets up the case that broke the old layout — a much taller box beside it', () => {
    expect(excluded.h).toBeGreaterThan(assessed.h * 2);
  });

  it('starts at the eligibility box, not at the bottom of the tallest box in its row', () => {
    // The old code started this arrow at max(assessed.h, excluded.h) — i.e. far
    // below the assessed box, floating beside the exclusions list.
    expect(dbArrow).toBeTruthy();
    expect(dbArrow.y1).toBeLessThan(excluded.y + excluded.h);
  });

  it('reaches the included box and terminates on it', () => {
    expect(dbArrow).toBeTruthy();
    expect(near(dbArrow.y2, included.y)).toBe(true);
    // and lands inside the box horizontally, not past its edge
    expect(dbArrow.x2).toBeGreaterThan(included.x);
    expect(dbArrow.x2).toBeLessThan(included.x + included.w);
  });

  it('extends BELOW the exclusion box it has to clear', () => {
    expect(dbArrow.y2).toBeGreaterThan(excluded.y + excluded.h);
  });

  it('leaves the eligibility column rather than cutting through the exclusion box', () => {
    expect(dbArrow.x1).toBeLessThan(excluded.x);
  });

  it('routes around the exclusion box instead of over it', () => {
    // The terminal box is centred across both columns, so this connector cannot be
    // a straight drop — a straight line to it would cross the exclusions box.
    expect(dbArrow.bend).toBe(true);
    for (const seg of segments(dbArrow)) {
      const crosses = Math.min(seg.x1, seg.x2) < excluded.x + excluded.w
        && Math.max(seg.x1, seg.x2) > excluded.x
        && Math.min(seg.y1, seg.y2) < excluded.y + excluded.h
        && Math.max(seg.y1, seg.y2) > excluded.y;
      expect(crosses, 'a connector leg passes through the exclusion box').toBe(false);
    }
  });
});

/* ═══════════════ no arrow anywhere points at nothing ═══════════════ */

describe('every arrow in the diagram has a real origin and a real destination', () => {
  const cases = {
    'both columns, deep reasons': buildPrismaFlowSVG(DEEP, { perSource: true }),
    'database column only': buildPrismaFlowSVG(derivePrismaFlow([
      ...many(10, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true }),
    ])),
    'no exclusion reasons recorded': buildPrismaFlowSVG(derivePrismaFlow([
      ...many(5, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude' }),
      ...many(5, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true }),
    ])),
    'updated-review template': buildPrismaFlowSVG(DEEP, { updated: true }),
    'empty review': buildPrismaFlowSVG(derivePrismaFlow([])),
  };

  for (const [name, built] of Object.entries(cases)) {
    it(`${name}: every arrow leaves a box edge and arrives at a box edge`, () => {
      for (const l of lines(built.svg)) {
        if (l.bend) {
          // An elbow still has to start on a box bottom and end on a box top.
          const from = built.boxes.find((bx) => near(l.y1, bx.y + bx.h)
            && l.x1 >= bx.x - 1 && l.x1 <= bx.x + bx.w + 1);
          const to = built.boxes.find((bx) => near(l.y2, bx.y)
            && l.x2 >= bx.x - 1 && l.x2 <= bx.x + bx.w + 1);
          expect(from, `elbow at y=${l.y1} has no source box`).toBeTruthy();
          expect(to, `elbow ending at y=${l.y2} has no destination box`).toBeTruthy();
          expect(l.y2).toBeGreaterThan(l.y1);
          // and no leg of it may pass through ANY box
          for (const seg of segments(l)) {
            for (const bx of built.boxes) {
              const crosses = Math.min(seg.x1, seg.x2) < bx.x + bx.w
                && Math.max(seg.x1, seg.x2) > bx.x
                && Math.min(seg.y1, seg.y2) < bx.y + bx.h
                && Math.max(seg.y1, seg.y2) > bx.y;
              expect(crosses, `elbow leg crosses ${bx.id}`).toBe(false);
            }
          }
        } else if (l.x1 === l.x2) {
          // vertical: bottom of some box → top of some other box
          const from = built.boxes.find((bx) => near(l.y1, bx.y + bx.h)
            && l.x1 >= bx.x - 1 && l.x1 <= bx.x + bx.w + 1);
          const to = built.boxes.find((bx) => near(l.y2, bx.y)
            && l.x2 >= bx.x - 1 && l.x2 <= bx.x + bx.w + 1);
          expect(from, `vertical arrow at y=${l.y1} has no source box`).toBeTruthy();
          expect(to, `vertical arrow ending at y=${l.y2} has no destination box`).toBeTruthy();
          expect(l.y2).toBeGreaterThan(l.y1); // always downstream, never backwards
        } else {
          // horizontal: right edge of some box → left edge of some other box
          const from = built.boxes.find((bx) => near(l.x1, bx.x + bx.w)
            && l.y1 >= bx.y && l.y1 <= bx.y + bx.h);
          const to = built.boxes.find((bx) => near(l.x2, bx.x)
            && l.y2 >= bx.y && l.y2 <= bx.y + bx.h);
          expect(from, `horizontal arrow at x=${l.x1} has no source box`).toBeTruthy();
          expect(to, `horizontal arrow ending at x=${l.x2} has no destination box`).toBeTruthy();
          expect(l.x2).toBeGreaterThan(l.x1);
        }
      }
    });

    it(`${name}: no zero-length or backwards arrow`, () => {
      for (const l of lines(built.svg)) {
        expect(Math.abs(l.x2 - l.x1) + Math.abs(l.y2 - l.y1)).toBeGreaterThan(4);
      }
    });
  }
});

/* ═══════════════ the layout responds to the data ═══════════════ */

describe('the layout adapts instead of assuming', () => {
  const short = buildPrismaFlowSVG(derivePrismaFlow([
    ...many(5, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'exclude', exclusionReason: 'Wrong population' }),
    ...many(5, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true }),
  ]));
  const tall = buildPrismaFlowSVG(derivePrismaFlow([
    ...REASONS.flatMap((reason) => many(3, {
      screeningDecision: 'include', soughtRetrieval: true, retrieved: true,
      fullTextDecision: 'exclude', exclusionReason: reason,
    })),
    ...many(5, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true }),
  ]));

  it('pushes the included box lower when there are more exclusion reasons', () => {
    expect(boxOf(tall, 'included_studies').y).toBeGreaterThan(boxOf(short, 'included_studies').y);
    expect(tall.H).toBeGreaterThan(short.H);
  });

  it('compacts again when there are fewer — no leftover gap', () => {
    const shortGap = boxOf(short, 'included_studies').y
      - (boxOf(short, 'excluded_full_text_db').y + boxOf(short, 'excluded_full_text_db').h);
    const tallGap = boxOf(tall, 'included_studies').y
      - (boxOf(tall, 'excluded_full_text_db').y + boxOf(tall, 'excluded_full_text_db').h);
    // The gap below the tallest box in the row is the SAME either way — the
    // diagram grew because its content did, not because of slack.
    expect(near(shortGap, tallGap, 2)).toBe(true);
    expect(shortGap).toBeLessThan(40);
  });

  it('never lets two boxes overlap, at any data shape', () => {
    for (const built of [short, tall, buildPrismaFlowSVG(DEEP, { perSource: true })]) {
      const bs = built.boxes;
      for (let i = 0; i < bs.length; i += 1) {
        for (let j = i + 1; j < bs.length; j += 1) {
          const a = bs[i]; const c = bs[j];
          const overlap = a.x < c.x + c.w && c.x < a.x + a.w
            && a.y < c.y + c.h && c.y < a.y + a.h;
          expect(overlap, `${a.id} overlaps ${c.id}`).toBe(false);
        }
      }
    }
  });

  it('keeps every box inside the canvas it reports', () => {
    for (const built of [short, tall, buildPrismaFlowSVG(DEEP, { perSource: true })]) {
      for (const bx of built.boxes) {
        expect(bx.x).toBeGreaterThanOrEqual(0);
        expect(bx.x + bx.w).toBeLessThanOrEqual(built.W);
        expect(bx.y + bx.h).toBeLessThanOrEqual(built.H);
      }
    }
  });
});

/* ═══════════════ both arms converge on one terminal box ═══════════════ */

describe('the two identification arms feed the single included box', () => {
  const built = buildPrismaFlowSVG(DEEP, { perSource: true });
  const included = boxOf(built, 'included_studies');

  it('draws one arrow from each arm, both landing on the box', () => {
    const incoming = lines(built.svg).filter((l) => near(l.y2, included.y));
    expect(incoming).toHaveLength(2);
    for (const l of incoming) {
      expect(l.x2).toBeGreaterThan(included.x);
      expect(l.x2).toBeLessThan(included.x + included.w);
    }
  });

  it('starts each from its own arm’s eligibility box', () => {
    const db = boxOf(built, 'assessed_db');
    const other = boxOf(built, 'assessed_other');
    const incoming = lines(built.svg).filter((l) => near(l.y2, included.y));
    const starts = incoming.map((l) => l.y1).sort((a, x) => a - x);
    expect(starts.some((v) => near(v, db.y + db.h))).toBe(true);
    expect(starts.some((v) => near(v, other.y + other.h))).toBe(true);
  });
});

/* ═══════════════ 116.md §18/§19 — no text escapes its box ═══════════════ */

describe('text extents: no text run may exceed its box width', () => {
  /* ── 116.md §18 (r2) — THIS GUARD USED TO BE A TAUTOLOGY ────────────────────
   *
   * It measured text as `content.length * (10.5 * 0.52)` — the SAME scalar average
   * wrapBoxLines budgeted with — and compared against `box.x + box.w`, while drawBox
   * draws at `box.x + 10`. So it asserted `len <= (w - 10) / 5.46` against a wrapper
   * that already guaranteed `len <= floor((w - 20) / 5.46)`: satisfied by
   * construction, for every possible input, with ~2 characters of permanent slack.
   * A 200,000-case fuzz over wrapBoxLines never produced a line that could fail it.
   * Meanwhile a genuinely overflowing all-caps line (Georgia capitals are 0.68 em,
   * W is 0.98 — up to 88% above the estimate) measured as comfortably INSIDE the box.
   *
   * So the guard now measures with REAL Georgia advances, from an independent
   * fixture (below), and asserts against the right-hand inset the wrapper claims to
   * reserve. The last test in this block proves the guard can go red.
   */

  /**
   * Georgia advance widths in em, read from the font itself (georgia.ttf,
   * unitsPerEm 2048, hmtx via cmap format 4). CHECKED IN DELIBERATELY: this fixture
   * must not import or re-derive svg.js's table, or the guard becomes circular
   * again. If the production wrapper's own widths drift from the font, these numbers
   * stay put and the assertions go red.
   */
  const GEORGIA_EM = {
    ' ': 0.2412, '!': 0.3311, '"': 0.4116, '#': 0.6431, $: 0.6099, '%': 0.8174, '&': 0.7104,
    "'": 0.2153, '(': 0.375, ')': 0.375, '*': 0.4722, '+': 0.6431, ',': 0.2695, '-': 0.374,
    '.': 0.2695, '/': 0.4688, ':': 0.3125, ';': 0.3125, '<': 0.6431, '=': 0.6431, '>': 0.6431,
    '?': 0.4785, '@': 0.9287, '[': 0.375, '\\': 0.4688, ']': 0.375, '^': 0.6431, _: 0.6431,
    '`': 0.5, '{': 0.4302, '|': 0.375, '}': 0.4302, '~': 0.6431,
    0: 0.6138, 1: 0.4297, 2: 0.5586, 3: 0.5518, 4: 0.5649, 5: 0.5283, 6: 0.5659, 7: 0.5024,
    8: 0.5962, 9: 0.5659,
    A: 0.6709, B: 0.6538, C: 0.6421, D: 0.749, E: 0.6533, F: 0.5991, G: 0.7251, H: 0.8149,
    I: 0.3896, J: 0.5176, K: 0.6943, L: 0.6035, M: 0.9272, N: 0.7671, O: 0.7441, P: 0.6099,
    Q: 0.7441, R: 0.7017, S: 0.561, T: 0.6187, U: 0.7563, V: 0.6665, W: 0.9756, X: 0.7104,
    Y: 0.6152, Z: 0.6016,
    a: 0.5039, b: 0.5601, c: 0.4541, d: 0.5742, e: 0.4834, f: 0.3252, g: 0.5093, h: 0.582,
    i: 0.293, j: 0.292, k: 0.5356, l: 0.2861, m: 0.8809, n: 0.5908, o: 0.5391, p: 0.5713,
    q: 0.5596, r: 0.4097, s: 0.4321, t: 0.3452, u: 0.5752, v: 0.4966, w: 0.7373, x: 0.5049,
    y: 0.4922, z: 0.4438,
    '–': 0.6431, '—': 0.8569, '‘': 0.2266, '’': 0.2266, '“': 0.4102, '”': 0.4102,
    '…': 0.8071, '·': 0.2793, '−': 0.6431, '≤': 0.6431, '≥': 0.6431, '≠': 0.6431,
  };
  const FONT_PX = 10.5;
  const PAD_X = 10; // drawBox's left inset, which it also reserves on the right
  /** Rendered px width using real metrics; an unknown glyph is charged 0.75 em. */
  const measure = (s) => Array.from(String(s))
    .reduce((a, ch) => a + (GEORGIA_EM[ch] ?? 0.75), 0) * FONT_PX;

  const decode = (s) => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

  /** Every `<text>` run inside each box group, with its x and content. */
  function boxTexts(svg) {
    const out = [];
    const groupRe = /<g data-box="([^"]+)">([\s\S]*?)<\/g>/g;
    let g;
    while ((g = groupRe.exec(svg))) {
      const textRe = /<text x="([-\d.]+)"[^>]*>([^<]*)<\/text>/g;
      let t;
      while ((t = textRe.exec(g[2]))) {
        out.push({ boxId: g[1], x: +t[1], content: decode(t[2]) });
      }
    }
    return out;
  }

  const LONG_REASON = 'Population did not meet the pre-specified inclusion criteria for age, comorbidity burden and prior treatment exposure as defined in the registered protocol (secondary screening of supplementary appendix material)';
  // 116.md §18 (r2) — the two shapes the 0.52-average estimate was blind to.
  const CAPS_REASON = 'WRONG POPULATION NON ADULT COHORT ONLY';
  const WM_REASON = 'WOMEN WITH MMSE MEASUREMENT WINDOW MISMATCH';
  const ftExcluded = (reason, n) => many(n, {
    screeningDecision: 'include', soughtRetrieval: true, retrieved: true,
    fullTextDecision: 'exclude', exclusionReason: reason,
  });
  const cases = {
    'both columns, deep reasons': buildPrismaFlowSVG(DEEP, { perSource: true }),
    'empty review (the fixed automation line)': buildPrismaFlowSVG(derivePrismaFlow([])),
    'updated-review template': buildPrismaFlowSVG(DEEP, { updated: true, perSource: true }),
    'long automation line + 200-char reason + long source label (§21 Scenario E)': buildPrismaFlowSVG(derivePrismaFlow([
      ...many(6, { sourceDb: 'the Cochrane Central Register of Controlled Trials (CENTRAL)' }),
      ...ftExcluded(LONG_REASON, 4),
      ...many(2, { screeningDecision: 'include', soughtRetrieval: true, retrieved: true, fullTextDecision: 'include', included: true }),
    ]), { perSource: true }),
    'CAPS-heavy reasons and a CAPS-heavy database label (§18 r2)': buildPrismaFlowSVG(derivePrismaFlow([
      ...many(6, { sourceDb: 'EMBASE CLASSIC+EMBASE (OVID)' }),
      ...ftExcluded(CAPS_REASON, 3),
      ...ftExcluded(WM_REASON, 2),
    ]), { perSource: true }),
  };

  for (const [name, built] of Object.entries(cases)) {
    it(`${name}: every text run stays inside its box`, () => {
      const byId = Object.fromEntries(built.boxes.map((b) => [b.id, b]));
      const texts = boxTexts(built.svg);
      expect(texts.length).toBeGreaterThan(0);
      for (const t of texts) {
        const box = byId[t.boxId];
        expect(box, `text in unknown box ${t.boxId}`).toBeTruthy();
        const right = t.x + measure(t.content);
        // The wrapper reserves BOX_PAD_X on the right as well as the left, so the
        // real bound is the inset edge — not the box edge with 10px of free slack.
        const limit = box.x + box.w - PAD_X;
        expect(right, `"${t.content}" escapes ${t.boxId} (${right.toFixed(1)} > ${limit.toFixed(1)})`)
          .toBeLessThanOrEqual(limit + 0.01);
        expect(t.x).toBeGreaterThanOrEqual(box.x);
      }
    });
  }

  it('THE GUARD CAN GO RED: the all-caps reason really would have overflowed', () => {
    // Proof the assertion above is not satisfiable by construction. The reviewer's
    // reproducing string, unwrapped, measured with real metrics, blows the budget…
    const unwrapped = `   ${CAPS_REASON}`;
    expect(measure(unwrapped)).toBeGreaterThan(250 - 2 * PAD_X);
    // …while the OLD character-count estimate declared the very same string safe.
    // That gap is the tautology this suite used to encode.
    expect(unwrapped.length * (10.5 * 0.52)).toBeLessThan(250 - PAD_X);
    // And the shipped diagram wraps it, so it never reaches the box edge.
    const built = cases['CAPS-heavy reasons and a CAPS-heavy database label (§18 r2)'];
    const runs = boxTexts(built.svg).filter((t) => t.boxId === 'excluded_full_text_db');
    expect(runs.some((t) => /WRONG POPULATION/.test(t.content))).toBe(true);
    expect(runs.some((t) => t.content.includes(CAPS_REASON))).toBe(false);
  });

  it('the automation-tools sub-line WRAPS instead of overflowing (the §18 bug)', () => {
    const built = cases['empty review (the fixed automation line)'];
    const texts = boxTexts(built.svg).filter((t) => t.boxId === 'removed_before_screening');
    // The official sub-line is split across ≥2 runs and never emitted whole…
    expect(texts.some((t) => /Records marked as ineligible/.test(t.content))).toBe(true);
    expect(texts.some((t) => /tools \(n = \d+\)/.test(t.content))).toBe(true);
    expect(texts.some((t) => /Records marked as ineligible by automation tools \(n = \d+\)/.test(t.content))).toBe(false);
    // …and the box grew to hold them (was 4 lines ⇒ 72px before wrapping).
    const box = built.boxes.find((b) => b.id === 'removed_before_screening');
    expect(box.h).toBeGreaterThan(72);
  });

  it('a very long reason is clipped in the LABEL, never in the count (116.md §18 r2)', () => {
    const built = cases['long automation line + 200-char reason + long source label (§21 Scenario E)'];
    const texts = boxTexts(built.svg).filter((t) => t.boxId === 'excluded_full_text_db');
    // The prose is still summarised with an ellipsis — the inspector is the detail
    // layer — but the ellipsis now sits INSIDE the line, before the protected count.
    const clipped = texts.find((t) => t.content.includes('…'));
    expect(clipped).toBeTruthy();
    expect(clipped.content.endsWith('…')).toBe(false);
    expect(clipped.content).toMatch(/…\s*\(n = \d+\)$/);
  });

  it('every reason sub-count survives the 3-line cap and sums to the box total', () => {
    // The §12 defect: with the count at the end of the logical line, the cap
    // ellipsized exactly the "(n = 6)" — leaving a PRISMA figure whose visible
    // sub-counts (5 + 4) did not reconcile with its own box total (15).
    const LONG = 'Wrong study population: paediatric cohort only, and the authors did not respond to a request for adult subgroup data';
    const MID = 'Population outside the pre-specified age window with no subgroup data available on request';
    const SHORT = 'Wrong study design: narrative review with no primary outcome reported';
    const flow = derivePrismaFlow([
      ...ftExcluded(LONG, 6), ...ftExcluded(MID, 5), ...ftExcluded(SHORT, 4),
    ]);
    const built = buildPrismaFlowSVG(flow, { perSource: true });
    const runs = boxTexts(built.svg).filter((t) => t.boxId === 'excluded_full_text_db');
    // Sub-lines are the indented runs; the box header carries no leading space.
    const subCounts = runs
      .filter((t) => /^\s/.test(t.content))
      .map((t) => t.content.match(/\(n = (\d+)\)\s*$/))
      .filter(Boolean)
      .map((m) => Number(m[1]));
    expect(subCounts).toHaveLength(3);
    expect(subCounts.reduce((a, b) => a + b, 0)).toBe(flow.boxes.excluded_full_text_db.n);
    expect(flow.boxes.excluded_full_text_db.n).toBe(15);
  });
});

/* ═══════════════ live view and export are one drawing ═══════════════ */

describe('export and live view use the same layout', () => {
  it('produces identical geometry regardless of the export-only options', () => {
    const live = buildPrismaFlowSVG(DEEP, { perSource: true });
    const png = buildPrismaFlowSVG(DEEP, { perSource: true, noBg: true });
    expect(png.boxes).toEqual(live.boxes);
    expect(png.W).toBe(live.W);
    expect(png.H).toBe(live.H);
  });

  it('the interactive hit-targets sit exactly on the drawn boxes', () => {
    // The overlay positions its buttons from `boxes`; if that drifted from what
    // is drawn, a user would click a count and inspect a different one.
    const built = buildPrismaFlowSVG(DEEP, { perSource: true });
    for (const bx of built.boxes) {
      expect(built.svg).toContain(`data-box="${bx.id}"`);
      expect(built.svg).toContain(`<rect x="${bx.x}" y="${bx.y}" width="${bx.w}" height="${bx.h}"`);
    }
  });
});
