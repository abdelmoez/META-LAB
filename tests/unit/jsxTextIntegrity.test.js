/**
 * jsxTextIntegrity.test.js — 116.md §57.
 *
 * A stray `)}` rendered under the Meta-Analysis "Plain-language interpretation"
 * card for the whole life of that component: the `{interp&&(` opener had been lost,
 * so its closing brace stopped being syntax and became JSX *text*, which React
 * dutifully printed. Nothing caught it — the file is still valid JSX, so the only
 * signal was an easily-missed build warning, and no test asserted on rendered
 * punctuation.
 *
 * This pins the CLASS, not the instance. Every tracked .jsx source is run through
 * esbuild's real JSX parser and any "The character ... is not valid inside a JSX
 * element" warning fails the suite — that warning fires exactly when a brace or
 * paren that was meant as syntax has degraded into rendered text.
 *
 * esbuild is used rather than a hand-rolled scan because only a real parser can
 * tell `))}` closing a .map() from `)}` sitting in the element body; the naive
 * regex version of this test flagged both. It reaches the repo through vite and is
 * already the house parse-check tool (`npx esbuild --loader:.jsx=jsx …`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Every tracked .jsx file (git ls-files keeps node_modules/build output out). */
function jsxSources() {
  const out = execFileSync('git', ['ls-files', '*.jsx'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** The parser's name for "this brace/paren is being rendered as text". */
const STRAY = /is not valid inside a JSX element/;

describe('116.md §57 — no orphaned JSX punctuation renders as text', () => {
  const files = jsxSources();

  it('finds .jsx sources to scan (the scan is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('the detector actually catches the 116.md §57 shape, and clears the legitimate one', () => {
    // The real bug: a card whose `{cond&&(` opener went missing.
    const broken = transformSync(
      'const A=()=><div>\n  <p>card</p>\n  )}\n  <p>next</p>\n</div>;',
      { loader: 'jsx' },
    );
    expect(broken.warnings.some((w) => STRAY.test(w.text))).toBe(true);

    // The shape the naive regex version of this test false-flagged: `))}` closing
    // a .map() callback between two elements.
    const fine = transformSync(
      'const A=({xs})=><div>\n  {xs.map((x)=>(\n    <p key={x}>{x}</p>\n  ))}\n  <p>next</p>\n</div>;',
      { loader: 'jsx' },
    );
    expect(fine.warnings.some((w) => STRAY.test(w.text))).toBe(false);
  });

  it('no .jsx file renders a stray brace or paren between elements', () => {
    const offenders = [];
    for (const rel of files) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      let warnings = [];
      try {
        ({ warnings } = transformSync(src, { loader: 'jsx', sourcefile: rel }));
      } catch {
        // A genuine syntax error is another suite's problem, not this one's.
        continue;
      }
      for (const w of warnings) {
        if (!STRAY.test(w.text)) continue;
        offenders.push(`${rel}:${w.location ? w.location.line : '?'} → ${w.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
