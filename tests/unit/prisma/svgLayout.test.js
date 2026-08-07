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
