/**
 * manuscript.ts — the Manuscript Editor's shared e2e vocabulary (121.md).
 *
 * `openManuscript` / `openSplit` / `closeSplit` were written for
 * manuscript-pdf-split.spec.ts and are now needed by three files (the split spec, the
 * 121 §3 export-reveal spec, and anything else that has to reach the Editor with the
 * PDF pane in a known state). Hoisted rather than copied, because the assertions they
 * carry ARE the contract — "the pane is HIDDEN, not gone, once it has been opened"
 * (120.md §8's keep-alive rule) is exactly the kind of thing three private copies
 * would eventually disagree about.
 *
 * Everything here drives the Stitch workspace at `/app/project/:id?tab=manuscript`.
 */
import { Page, expect } from '@playwright/test';

/** The split ROW — carries data-split / data-layout / data-ratio. */
export const SPLIT = 'stitch-manuscript-split';

/* 120.md §8 — the pane is opened from the toolbar's PDF View DESTINATION (one state,
   one control), and choosing Editor closes it. These are the two ends of that pair. */
export const PDF_TAB = 'stitch-manuscript-subtab-pdfview';
export const EDITOR_TAB = 'stitch-manuscript-subtab-editor';

/** A desktop viewport wide enough for the two-column split (SPLIT_STACK_BELOW=1024). */
export const desktop = (page: Page) => page.setViewportSize({ width: 1600, height: 900 });

/**
 * Open the Manuscript Editor on a given destination and wait for it to be usable.
 * @param params extra query string, appended verbatim (e.g. `&msv=continuous`).
 */
export async function openManuscript(page: Page, projectId: string, params = ''): Promise<void> {
  await page.goto(`/app/project/${projectId}?tab=manuscript&ms=editor${params}`);
  await expect(page.getByTestId('stitch-manuscript-workspace')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('stitch-manuscript-editor')).toBeVisible({ timeout: 20_000 });
}

/** Choosing PDF View opens the pane. */
export async function openSplit(page: Page): Promise<void> {
  await page.getByTestId(PDF_TAB).click();
  await expect(page.getByTestId('stitch-manuscript-split-pdf')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(PDF_TAB)).toHaveAttribute('aria-selected', 'true');
}

/** …and choosing Editor closes it. The pane stays MOUNTED once it has been opened
 *  (120.md §8's keep-alive rule), so "closed" is HIDDEN, not gone. */
export async function closeSplit(page: Page): Promise<void> {
  await page.getByTestId(EDITOR_TAB).click();
  await expect(page.getByTestId('stitch-manuscript-split-pdf')).toBeHidden();
  await expect(page.getByTestId(EDITOR_TAB)).toHaveAttribute('aria-selected', 'true');
}

/** The split row's committed ratio, as the integer percentage it publishes. */
export const splitRatio = async (page: Page): Promise<number> =>
  Number(await page.getByTestId(SPLIT).getAttribute('data-ratio'));

/** Is the PAGE ITSELF in browser fullscreen (not merely a wide viewport)? */
export const isFullscreen = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.fullscreenElement === document.documentElement);

/** Included studies, so the article selector has real articles to offer. */
export async function seedStudies(
  request: import('@playwright/test').APIRequestContext,
  projectId: string,
): Promise<void> {
  const proj = await (await request.get(`/api/projects/${projectId}`)).json();
  proj.studies = [
    { id: 's1', title: 'Trial A statins after infarction', authors: 'Smith J', year: '2020', journal: 'Lancet', outcome: 'MACE', esType: 'OR', es: '-0.36', lo: '-0.6', hi: '-0.12', nExp: '500', nCtrl: '500' },
    { id: 's2', title: 'Trial B aspirin in prevention', authors: 'Lee K', year: '2021', journal: 'NEJM', outcome: 'MACE', esType: 'OR', es: '-0.22', lo: '-0.5', hi: '0.06', nExp: '300', nCtrl: '300' },
    { id: 's3', title: 'Trial C anticoagulation', authors: 'Brown T', year: '2019', journal: 'JAMA', outcome: 'MACE', esType: 'OR', es: '-0.30', lo: '-0.55', hi: '-0.05', nExp: '400', nCtrl: '400' },
  ];
  expect((await request.put(`/api/projects/${projectId}/autosave`, { data: proj })).ok()).toBeTruthy();
}
