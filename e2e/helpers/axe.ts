/**
 * axe.ts — a thin, deterministic wrapper around @axe-core/playwright for the
 * PecanRev accessibility specs (e2e/a11y/a11y.spec.ts).
 *
 * Design goals:
 *  - Scope a scan to the app's main content (`stitch-main-content`) when we only
 *    care about a single surface, so a known chrome issue does not fail every page.
 *  - Exclude a small set of third-party / portal nodes we do not author (pdf.js
 *    canvases, embedded iframes, transient toasts) — they add noise unrelated to
 *    our own markup.
 *  - Report ONLY `serious` + `critical` violations (the WCAG-blocking tiers). A
 *    per-page documented allowlist lets the suite assert a real baseline instead of
 *    a fake pass while the app's lower-severity debt is paid down.
 *
 * This module is a plain helper (no `.spec.ts`), so Playwright never treats it as a
 * test file.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

// Derive the result/violation shapes from AxeBuilder itself so we don't depend on
// `axe-core`'s type entrypoint resolving.
type AnalyzeResult = Awaited<ReturnType<InstanceType<typeof AxeBuilder>['analyze']>>;
export type AxeViolation = AnalyzeResult['violations'][number];

/** WCAG 2.0/2.1 A + AA — the conformance level PecanRev targets. */
export const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const BLOCKING = new Set(['serious', 'critical']);

/**
 * Nodes we do not own / that are inherently noisy. Excluded from EVERY scan so a
 * third-party widget can never fail our a11y gate.
 */
export const DEFAULT_EXCLUDES: string[] = [
  'iframe',                              // embedded viewers (pdf.js worker frame, etc.)
  'canvas',                             // pdf.js / chart canvases render their own a11y tree
  '[data-testid="stitch-toast"]',       // transient, portaled, already an aria-live region
  '[aria-hidden="true"]',               // decorative subtrees the app explicitly hides
];

export interface ScanOptions {
  /** CSS selector(s) to scope the scan to (e.g. the main content region). */
  include?: string | string[];
  /** Extra selectors to exclude on top of DEFAULT_EXCLUDES. */
  exclude?: string[];
  /** axe rule ids to turn off entirely for this scan. */
  disableRules?: string[];
  /** Override the WCAG tag set (defaults to WCAG_AA_TAGS). */
  tags?: string[];
}

/** Run AxeBuilder on the current page with the project's standard configuration. */
export async function scanA11y(page: Page, opts: ScanOptions = {}): Promise<AnalyzeResult> {
  let builder = new AxeBuilder({ page }).withTags(opts.tags ?? WCAG_AA_TAGS);

  const includes = opts.include == null
    ? []
    : Array.isArray(opts.include) ? opts.include : [opts.include];
  for (const inc of includes) builder = builder.include(inc);

  for (const ex of [...DEFAULT_EXCLUDES, ...(opts.exclude ?? [])]) builder = builder.exclude(ex);

  if (opts.disableRules?.length) builder = builder.disableRules(opts.disableRules);

  return builder.analyze();
}

/** Filter results down to the WCAG-blocking tiers, minus any allow-listed rule ids. */
export function seriousViolations(results: AnalyzeResult, allow: string[] = []): AxeViolation[] {
  const allowed = new Set(allow);
  return results.violations.filter(
    (v) => BLOCKING.has(String(v.impact ?? '')) && !allowed.has(v.id),
  );
}

/** Human-readable one-liner per violation for assertion failure messages. */
export function formatViolations(violations: AxeViolation[]): string {
  if (!violations.length) return '(none)';
  return violations
    .map((v) => {
      const targets = v.nodes
        .slice(0, 3)
        .map((n) => (Array.isArray(n.target) ? n.target.join(' ') : String(n.target)))
        .join(' | ');
      return `  • [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node(s)) → ${targets}`;
    })
    .join('\n');
}

export interface AssertOptions extends ScanOptions {
  /** Rule ids accepted as a documented baseline (see a11y.spec.ts ALLOW map). */
  allow?: string[];
  /** Attach the full violation list to the report when offenders are found. */
  testInfo?: TestInfo;
  /** Label used in the failure message + attachment name. */
  label?: string;
}

/**
 * Scan the page and assert there are NO serious/critical violations beyond the
 * documented allowlist. Returns the raw results so callers can make extra
 * assertions (e.g. that the allowlist is still actually needed).
 */
export async function expectNoSeriousA11y(page: Page, opts: AssertOptions = {}): Promise<AnalyzeResult> {
  const { allow = [], testInfo, label, ...scan } = opts;
  const results = await scanA11y(page, scan);
  const offenders = seriousViolations(results, allow);

  if (testInfo && offenders.length) {
    await testInfo.attach(`axe-${label ?? 'scan'}.json`, {
      body: JSON.stringify(offenders, null, 2),
      contentType: 'application/json',
    });
  }

  expect(
    offenders.map((v) => v.id),
    `Serious/critical a11y violations${label ? ` on "${label}"` : ''}:\n${formatViolations(offenders)}`,
  ).toEqual([]);

  return results;
}
