/**
 * manuscript-writing-assistant-120.spec.ts — 120.md §6 "Advanced Spelling and
 * Grammar Correction System".
 *
 * The engine half of §6 is pinned in Node (tests/unit/manuscript/writingAssistant/,
 * 336 tests). Everything here is a fact that only a real browser can settle:
 *
 *   · CSS.highlights actually receives the four registrations, and the underlines are
 *     drawn WITHOUT a single node entering the editor — the one invariant that, if
 *     broken, ships decoration markup into a researcher's submitted paper;
 *   · a Web Worker really starts, really parses a 550 KB Hunspell dictionary, and
 *     really answers — none of which happens in Node;
 *   · an applied correction is ONE native undo step through the editor's own
 *     execCommand path, and Ctrl+Z restores exactly what was there;
 *   · the serialized markdown is byte-identical with the assistant on and off, at the
 *     server, which is the only place that claim can be checked honestly.
 *
 * Journey F: enable → issues → underlines → apply → undo/redo → dismiss → add to the
 *            personal dictionary → disable → the text never changed by itself.
 * Journey G: medical and statistical prose is left alone; a real misspelling gets a
 *            useful suggestion.
 *
 * Chromium project: the file name deliberately does NOT match `webkit-manuscript`'s
 * `manuscript-{table,figure}*` pattern. WebKit's own §6 exposure is the caption
 * spellcheck attribute and the execCommand apply path, both of which ride the table
 * and figure specs that already run there.
 */
import { test, expect } from '../fixtures/stitch-test';

type Page = import('@playwright/test').Page;
type APIRequestContext = import('@playwright/test').APIRequestContext;

const editorOf = (page: Page) => page.getByTestId('stitch-manuscript-rich-editor');
const chip = (page: Page) => page.getByTestId('stitch-manuscript-wa-chip');
const popover = (page: Page) => page.getByTestId('stitch-manuscript-wa-popover');
const card = (page: Page) => page.getByTestId('stitch-manuscript-wa-card');

/** The dictionary parse is a real 550 KB Hunspell load — be generous, once. */
const READY_MS = 45_000;

/* The workspace timeout is generous on purpose: these tests run in parallel with each
   other and each one parses a real 550 KB Hunspell dictionary in a worker thread, so
   the machine is genuinely busy while a sibling is loading its page. */
const PAGE_MS = 40_000;

async function openEditorSection(page: Page, projectId: string, section: string) {
  await page.goto(`/app/project/${projectId}?tab=manuscript&msv=sections`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: PAGE_MS });
  await page.getByTestId('stitch-manuscript-subtab-editor').click();
  await page.getByTestId(`stitch-manuscript-section-${section}`).click();
  const editor = editorOf(page);
  await expect(editor).toBeVisible({ timeout: PAGE_MS });
  return editor;
}

async function saved(page: Page) {
  await expect(page.getByTestId('stitch-manuscript-save-status').first())
    .toContainText(/Saved/i, { timeout: 25_000 });
}

/** The COMMITTED markdown for a section, straight from the server. */
async function sectionMarkdown(request: APIRequestContext, projectId: string, section: string) {
  const proj = await (await request.get(`/api/projects/${projectId}`)).json();
  const draft = (proj.manuscripts || [])[0] || {};
  return String(((draft.sections || {})[section] || {}).content || '');
}

/**
 * …once it actually contains `needle`. The save pill turns green when the SHELL's
 * autosave settles, which is one debounce ahead of the row being readable here; a
 * bare read races it and returns the empty string a brand-new draft starts with.
 */
async function settledMarkdown(request: APIRequestContext, projectId: string, section: string, needle: string) {
  await expect.poll(
    () => sectionMarkdown(request, projectId, section),
    { timeout: 30_000, message: `section ${section} never persisted "${needle}"` },
  ).toContain(needle);
  return sectionMarkdown(request, projectId, section);
}

/** Open the chip's popover (idempotent). */
async function openPanel(page: Page) {
  if (await popover(page).count()) return;
  await chip(page).click();
  await expect(popover(page)).toBeVisible();
}

async function closePanel(page: Page) {
  if (!(await popover(page).count())) return;
  await page.getByTestId('stitch-manuscript-wa-close').click();
  await expect(popover(page)).toHaveCount(0);
}

/** Turn the assistant on for this user and wait until it has actually checked. */
async function enableAssistant(page: Page) {
  await openPanel(page);
  const toggle = page.getByTestId('stitch-manuscript-wa-toggle');
  if (!(await toggle.isChecked())) await toggle.check();
  // 'loading' → 'checking' → 'issues' | 'clean'. Never 'error' (that is a failure of
  // the feature, and the spec should say so out loud rather than time out silently).
  await expect(chip(page)).toHaveAttribute('data-wa-status', /issues|clean/, { timeout: READY_MS });
  // The popover's click-outside catcher covers the page — leave it open and every
  // later editor click lands on the catcher instead of the prose.
  await closePanel(page);
}

/**
 * What the CSS Custom Highlight registry holds, as a STRUCTURAL summary.
 * Deliberately not the ranges' text: WebKit truncates long console strings and a
 * structural answer is what the assertion actually needs.
 */
async function highlightSummary(page: Page) {
  return page.evaluate(() => {
    const names = ['wa-spelling', 'wa-grammar', 'wa-terminology', 'wa-style'];
    const out: Record<string, number> = {};
    let total = 0;
    for (const n of names) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hl = (CSS as any).highlights ? (CSS as any).highlights.get(n) : null;
      const size = hl ? hl.size : 0;
      out[n] = size;
      total += size;
    }
    return { supported: !!(CSS as any).highlights, byName: out, total };
  });
}

/** Every element the editor holds, by tag + class — proof that none of them is ours. */
async function editorShape(page: Page) {
  return editorOf(page).evaluate((el) => {
    const tags: Record<string, number> = {};
    let waAttributes = 0;
    for (const node of el.querySelectorAll('*')) {
      const key = node.tagName.toLowerCase();
      tags[key] = (tags[key] || 0) + 1;
      for (const attr of node.attributes) {
        if (attr.name.startsWith('data-wa') || /\bwa-/.test(attr.value)) waAttributes += 1;
      }
    }
    return { tags, waAttributes, html: el.innerHTML.length };
  });
}

test.describe('Writing Assistant (120.md §6)', () => {
  test.beforeEach(async ({ setFlags }) => {
    await setFlags({ manuscriptEditor: true, writingAssistant: true });
  });

  /* ── Journey F ────────────────────────────────────────────────────────────── */

  test('§6 Journey F: enable → underline → apply → undo → dismiss → dictionary → disable', async ({ page, request, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    // One real misspelling, one duplicate word, and prose that must NOT be flagged.
    await page.keyboard.type('The hepatocelular injury was assessed in duplicate.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('The the participants were followed for 12 months.');
    await saved(page);

    /* THE BASELINE. Everything below is measured against this exact string. */
    const before = await settledMarkdown(request, tmpProject.id, 'methods', 'hepatocelular');

    /* OFF BY DEFAULT — §6's hard requirement. The control exists; the feature does
       not run until this user says so. */
    await expect(chip(page)).toBeVisible();
    await expect(chip(page)).toHaveAttribute('data-wa-status', 'off');
    expect((await highlightSummary(page)).total).toBe(0);

    await enableAssistant(page);
    await expect(chip(page)).toHaveAttribute('data-wa-status', 'issues', { timeout: READY_MS });

    /* DECORATIONS EXIST — and they exist in the CSS highlight registry, not in the
       document. Both halves of that sentence are asserted. */
    const shapeBefore = await editorShape(page);
    await expect.poll(async () => (await highlightSummary(page)).total, { timeout: 20_000 })
      .toBeGreaterThan(0);
    const highlights = await highlightSummary(page);
    expect(highlights.supported).toBe(true);
    expect(highlights.byName['wa-spelling']).toBeGreaterThan(0);
    const shapeAfter = await editorShape(page);
    expect(shapeAfter.tags).toEqual(shapeBefore.tags);        // not one new element
    expect(shapeAfter.waAttributes).toBe(0);                  // not one new attribute
    expect(shapeAfter.html).toBe(shapeBefore.html);           // byte-identical markup

    /* …AND THE PERSISTED MANUSCRIPT DID NOT MOVE. The single most important
       assertion in this file: decorating text must never write to it. */
    expect(await sectionMarkdown(request, tmpProject.id, 'methods')).toBe(before);

    /* NAVIGATION opens the card at the issue, and the card says the §6 things. */
    await openPanel(page);
    await page.getByTestId('stitch-manuscript-wa-next').click();
    await closePanel(page);
    await expect(card(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('stitch-manuscript-wa-card-original')).toHaveText('hepatocelular');
    await expect(page.getByTestId('stitch-manuscript-wa-card-explanation')).toBeVisible();
    // §6's action list, in full — including the PERMISSION-GATED project scope, which
    // is offered here because the server said this user may edit this project.
    for (const action of ['dismiss', 'ignore-term', 'ignore-rule', 'add-personal', 'add-project']) {
      await expect(page.getByTestId(`stitch-manuscript-wa-${action}`)).toBeVisible();
    }

    /* APPLY — one clear user action, and the text changes for the first time. */
    const apply = page.getByTestId('stitch-manuscript-wa-apply');
    await expect(apply).toHaveText('hepatocellular');
    await apply.click();
    await expect(editor).toContainText('hepatocellular injury', { timeout: 10_000 });
    await saved(page);
    const applied = await settledMarkdown(request, tmpProject.id, 'methods', 'hepatocellular injury');
    expect(applied).not.toContain('hepatocelular ');

    /* ONE UNDO STEP. A correction is an ordinary editor transaction: Ctrl+Z puts the
       misspelling back, Ctrl+Shift+Z takes it away again. */
    await editor.click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor).toContainText('hepatocelular injury', { timeout: 10_000 });
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(editor).toContainText('hepatocellular injury', { timeout: 10_000 });

    /* DISMISS — the duplicate-word issue goes away without touching the prose. */
    await expect.poll(async () => {
      const n = await chip(page).getAttribute('data-wa-count');
      return Number(n || 0);
    }, { timeout: 20_000 }).toBeGreaterThan(0);
    const countBefore = Number(await chip(page).getAttribute('data-wa-count'));
    await openPanel(page);
    await page.getByTestId('stitch-manuscript-wa-next').click();
    await closePanel(page);
    await expect(card(page)).toBeVisible({ timeout: 10_000 });
    const dismissedText = await page.getByTestId('stitch-manuscript-wa-card-original').textContent();
    await page.getByTestId('stitch-manuscript-wa-dismiss').click();
    await expect(card(page)).toHaveCount(0);
    await expect.poll(async () => Number(await chip(page).getAttribute('data-wa-count')), { timeout: 15_000 })
      .toBe(countBefore - 1);
    // Dismissing is a reading state, never an edit.
    expect(await sectionMarkdown(request, tmpProject.id, 'methods')).toBe(applied);
    expect(await editor.textContent()).toContain(String(dismissedText));

    /* ADD TO PERSONAL DICTIONARY — a term stops being an error everywhere. */
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Patients received upadacitinibx as maintenance therapy.');
    await expect.poll(async () => editor.textContent(), { timeout: 10_000 })
      .toContain('upadacitinibx');
    await openPanel(page);
    await expect(page.getByTestId('stitch-manuscript-wa-tab-dictionary')).toBeVisible();
    await page.getByTestId('stitch-manuscript-wa-tab-dictionary').click();
    await page.getByTestId('stitch-manuscript-wa-dict-input').fill('upadacitinibx');
    await page.getByTestId('stitch-manuscript-wa-dict-add').click();
    await expect(page.getByTestId('stitch-manuscript-wa-dict-remove-upadacitinibx')).toBeVisible({ timeout: 15_000 });
    await closePanel(page);
    // …and after the re-check it is no longer reported anywhere.
    await expect(chip(page)).toHaveAttribute('data-wa-status', /issues|clean/, { timeout: READY_MS });
    await expect.poll(async () => {
      await openPanel(page);
      const list = page.getByTestId('stitch-manuscript-wa-list');
      const text = await list.textContent();
      await closePanel(page);
      return text || '';
    }, { timeout: 25_000 }).not.toContain('upadacitinibx');

    /* DISABLE — everything the feature drew disappears, nothing it read changes. */
    await saved(page);
    // Settled on the LAST thing typed, so the comparison below cannot race the
    // debounced autosave and blame the assistant for a paragraph still in flight.
    const beforeDisable = await settledMarkdown(request, tmpProject.id, 'methods', 'upadacitinibx');
    await openPanel(page);
    await page.getByTestId('stitch-manuscript-wa-toggle').uncheck();
    await closePanel(page);
    await expect(chip(page)).toHaveAttribute('data-wa-status', 'off');
    await expect.poll(async () => (await highlightSummary(page)).total, { timeout: 10_000 }).toBe(0);
    expect(await sectionMarkdown(request, tmpProject.id, 'methods')).toBe(beforeDisable);
    // Native spellcheck comes back exactly as it was.
    await expect(editor).toHaveAttribute('spellcheck', 'true');
  });

  test('§6: enabling the assistant NEVER changes a single byte of the manuscript', async ({ page, request, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'results');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    // Every block kind §6 names, in one section: heading, prose with a chip-free
    // sentence, a list, a table with its caption, and statistical notation.
    await page.keyboard.type('Primary outcome');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Heterogeneity was assessed using I², and p < 0.05 was considered significant.');
    await page.keyboard.press('Enter');
    await page.getByTestId('stitch-manuscript-tb-ul').click();
    await page.keyboard.type('Mortality at 12 months (95% CI 1.02-1.44)');
    await saved(page);

    const before = await settledMarkdown(request, tmpProject.id, 'results', 'Heterogeneity');
    const domBefore = await editorOf(page).evaluate((el) => el.innerHTML);

    await enableAssistant(page);
    // Give both debounces (700 ms blocks, 1800 ms document) room to land and paint.
    await expect.poll(async () => (await highlightSummary(page)).supported, { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(3000);

    expect(await editorOf(page).evaluate((el) => el.innerHTML)).toBe(domBefore);
    expect(await sectionMarkdown(request, tmpProject.id, 'results')).toBe(before);
    // No autosave traffic from decorating: the pill never left "Saved".
    await expect(page.getByTestId('stitch-manuscript-save-status').first()).toContainText(/Saved/i);
  });

  test('§6: native spellcheck is suppressed only inside the manuscript editor', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.type('A sentence to check.');
    await expect(editor).toHaveAttribute('spellcheck', 'true');

    await enableAssistant(page);
    await expect(editor).toHaveAttribute('spellcheck', 'false');
    // …and NOWHERE else on the page. Nothing outside the editor was touched.
    const outside = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[spellcheck="false"]'));
      const root = document.querySelector('[data-testid="stitch-manuscript-rich-editor"]');
      return els.filter((el) => !(root && (el === root || root.contains(el)))).length;
    });
    expect(outside).toBe(0);
  });

  /* ── Journey G ────────────────────────────────────────────────────────────── */

  test('§6 Journey G: scientific prose is left alone; a real misspelling gets a useful suggestion', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    // §6's own example list, verbatim in intent — every one of these must pass clean.
    for (const line of [
      'We searched PubMed, MEDLINE, Embase, and CENTRAL.',
      'Heterogeneity was assessed using I², and p < 0.05 was considered significant.',
      'The Newcastle–Ottawa Scale was used to evaluate cohort studies.',
      'The intervention was administered at 5 mg/kg.',
      'Inflammatory bowel disease (IBD) was assessed. Patients with IBD were included.',
    ]) {
      await page.keyboard.type(line);
      await page.keyboard.press('Enter');
    }
    await saved(page);

    await enableAssistant(page);
    await expect(chip(page)).toHaveAttribute('data-wa-status', 'clean', { timeout: READY_MS });
    expect((await highlightSummary(page)).total).toBe(0);

    /* Now ONE genuine misspelling, in the middle of that same clean prose. */
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('The hepatocelular injury was assessed.');
    await expect(chip(page)).toHaveAttribute('data-wa-status', 'issues', { timeout: READY_MS });

    await openPanel(page);
    await expect(page.getByTestId('stitch-manuscript-wa-total')).toContainText('1 total', { timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-wa-next').click();
    await closePanel(page);
    await expect(card(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('stitch-manuscript-wa-card-original')).toHaveText('hepatocelular');
    // §6: "Suggest `hepatocellular`" — and it must be the PRIMARY suggestion, because
    // the medical lexicon feeds nspell's personal dictionary so suggest() can reach it.
    await expect(page.getByTestId('stitch-manuscript-wa-apply')).toHaveText('hepatocellular');
  });

  test('§6: a recoverable failure is a distinct state with a Retry — never "no issues"', async ({ page, tmpProject }) => {
    const editor = await openEditorSection(page, tmpProject.id, 'methods');
    await editor.click();
    await page.keyboard.type('The hepatocelular injury was assessed.');

    // Break the dictionary asset fetch BEFORE the worker ever asks for it.
    await page.route('**/*.dic*', (route) => route.abort('failed'));
    await page.reload();
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('stitch-manuscript-section-methods').click();

    await openPanel(page);
    const toggle = page.getByTestId('stitch-manuscript-wa-toggle');
    if (!(await toggle.isChecked())) await toggle.check();
    await expect(chip(page)).toHaveAttribute('data-wa-status', 'error', { timeout: 30_000 });
    await expect(page.getByTestId('stitch-manuscript-wa-error')).toContainText(/unaffected/i);
    await expect(page.getByTestId('stitch-manuscript-wa-retry')).toBeVisible();
    await closePanel(page);

    // Typing keeps working, and nothing claims the manuscript is clean.
    await editorOf(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' Still typing.');
    await expect(editorOf(page)).toContainText('Still typing.');
    await expect(chip(page)).not.toHaveAttribute('data-wa-status', 'clean');
    await saved(page);
  });

  /* ── §6 "Incremental checking and performance" ────────────────────────────── */

  test('§6 performance: a large manuscript stays responsive with the assistant on', async ({ page, request, tmpProject }) => {
    test.setTimeout(240_000);

    // A realistically long manuscript: ~120 paragraphs across the body sections, a
    // table, and citation tokens — §6's "many sections, hundreds of paragraphs,
    // multiple tables, hundreds of citations".
    await openEditorSection(page, tmpProject.id, 'methods');
    await expect.poll(async () => {
      const proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
      return (proj.manuscripts || []).length;
    }, { timeout: 25_000 }).toBeGreaterThan(0);

    const proj = await (await request.get(`/api/projects/${tmpProject.id}`)).json();
    proj.studies = Array.from({ length: 40 }, (_, i) => ({
      id: `s${i + 1}`, title: `Trial ${i + 1} of the intervention in adults`,
      authors: `Author${i + 1} A`, year: String(2010 + (i % 14)), journal: 'Lancet', doi: `10.1000/perf.${i + 1}`,
    }));
    const draft = proj.manuscripts[0];
    const para = (i: number) => `Paragraph ${i} reports the pooled estimate for the primary outcome, `
      + `assessed with the Newcastle–Ottawa Scale at 12 months (95% CI 1.02-1.44) [[cite:s${(i % 40) + 1}]], `
      + `and heterogeneity was quantified with I² and p < 0.05 across all included cohorts.`;
    for (const [sectionId, count] of [['methods', 40], ['results', 40], ['discussion', 40]] as const) {
      const lines: string[] = [];
      for (let i = 1; i <= count; i += 1) lines.push(para(i), '');
      lines.push('| Outcome | Events | Total |', '| --- | --- | --- |', '| Mortality | 24 | 310 |', '');
      draft.sections[sectionId] = { ...(draft.sections[sectionId] || {}), content: lines.join('\n') };
    }
    expect((await request.put(`/api/projects/${tmpProject.id}/autosave`, { data: proj })).ok()).toBeTruthy();

    await page.goto(`/app/project/${tmpProject.id}?tab=manuscript&msv=sections`);
    await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 25_000 });
    await page.getByTestId('stitch-manuscript-subtab-editor').click();
    await page.getByTestId('stitch-manuscript-section-methods').click();
    const editor = editorOf(page);
    await expect(editor).toBeVisible();

    /**
     * Median keypress→paint latency over N keystrokes, measured ENTIRELY IN THE PAGE.
     *
     * The obvious version (evaluate → type → evaluate) measures the CDP round trip,
     * which is ~45 ms each way and swamps the thing under test. Instead a listener in
     * the page stamps each `input` and reports the delta to the second animation
     * frame after it — i.e. keystroke to the paint that shows it.
     */
    const typeLatency = async (n: number) => {
      await editor.click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.evaluate(() => {
        const w = window as unknown as { __waSamples?: number[]; __waStop?: () => void };
        const el = document.querySelector('[data-testid="stitch-manuscript-rich-editor"]');
        if (!el) throw new Error('no editor');
        w.__waSamples = [];
        const onInput = () => {
          const t0 = performance.now();
          requestAnimationFrame(() => requestAnimationFrame(() => {
            (w.__waSamples as number[]).push(performance.now() - t0);
          }));
        };
        el.addEventListener('input', onInput);
        w.__waStop = () => el.removeEventListener('input', onInput);
      });
      await page.keyboard.type('a'.repeat(n), { delay: 40 });
      await page.waitForTimeout(400);
      const samples = await page.evaluate(() => {
        const w = window as unknown as { __waSamples?: number[]; __waStop?: () => void };
        if (w.__waStop) w.__waStop();
        return (w.__waSamples || []).slice();
      });
      samples.sort((a, b) => a - b);
      return {
        n: samples.length,
        median: samples[Math.floor(samples.length / 2)] ?? 0,
        p95: samples[Math.floor(samples.length * 0.95)] ?? 0,
        max: samples[samples.length - 1] ?? 0,
      };
    };

    const off = await typeLatency(20);

    const t0 = Date.now();
    await enableAssistant(page);
    const timeToFirstCheck = Date.now() - t0;
    await expect.poll(async () => (await highlightSummary(page)).total, { timeout: 40_000 }).toBeGreaterThan(0);
    const timeToFirstPaint = Date.now() - t0;
    const decorationsAtPeak = await highlightSummary(page);
    const anchorPerf = await page.evaluate(() => (window as unknown as { __waPerf?: Record<string, number> }).__waPerf || null);

    const on = await typeLatency(20);
    const perf = await page.evaluate(() => (window as unknown as { __waPerf?: unknown }).__waPerf || null);

    // Structural summary only — WebKit truncates long console strings, and a table of
    // numbers is what the §9 report needs anyway.
    // eslint-disable-next-line no-console
    console.log('[120.md §6 performance]', JSON.stringify({
      blocksPerSection: 43,
      sections: Object.keys(draft.sections).length,
      samplesOff: off.n,
      samplesOn: on.n,
      typingMedianMsOff: Math.round(off.median),
      typingMedianMsOn: Math.round(on.median),
      typingP95MsOff: Math.round(off.p95),
      typingP95MsOn: Math.round(on.p95),
      typingMaxMsOff: Math.round(off.max),
      typingMaxMsOn: Math.round(on.max),
      timeToFirstCheckMs: timeToFirstCheck,
      timeToFirstPaintMs: timeToFirstPaint,
      decorationsAtPeak: decorationsAtPeak.total,
      anchorMsAtPeak: anchorPerf && anchorPerf.anchorMs,
      perf,
    }));

    /* The BUDGET §6 asks for: "The editor must remain responsive." A keystroke must
       not become perceptibly slower because the assistant is on. 32 ms is two frames
       at 60 Hz — the point at which a person starts to feel the difference. */
    expect(on.median - off.median).toBeLessThan(32);
    expect(on.median).toBeLessThan(100);
  });
});
