/**
 * RobPage.ts — page object for the Risk of Bias (RoB 2) engine (rob_engine_v2 ON).
 *
 * RoB has TWO entry points (router-shell + the rob-extraction-meta map):
 *   1. Embedded in the unified Stitch project workspace at `/app/project/:id?tab=rob`
 *      (the PRIMARY surface — RoBTab → ProjectRobPanel inside the Stitch shell).
 *   2. The standalone page at `/rob/:projectId` (RobPage.jsx → its own legacy Frame
 *      → the SAME ProjectRobPanel). This route renders its OWN chrome, NOT the Stitch
 *      shell, so callers must not assert Stitch there.
 *
 * The RoB engine surface carries NO data-testids (this authoring pass adds none), so
 * every UI locator below is a role/text selector taken from the area map's
 * `bestSelector` (ProjectRobPanel.jsx). Navigation/chrome is delegated to the shared
 * ShellNav; the RoB workflow step lives in the white submenu as `stitch-stepper-step-rob`
 * (RoB is a sub-step of the Extract category — there is NO `stitch-workflow-step-rob`).
 *
 * The owner-scoped REST helpers (static) seed/inspect state fast via the real
 * /api/rob/* service (all relative paths, per helpers/api.ts convention).
 */
import { Page, Locator, APIRequestContext, expect } from '@playwright/test';
import { ShellNav } from './ShellNav';

export class RobPage {
  readonly nav: ShellNav;

  constructor(public readonly page: Page) {
    this.nav = new ShellNav(page);
  }

  /* ── Navigation ─────────────────────────────────────────────────────────── */

  /** Open the RoB tab embedded in the unified Stitch workspace (asserts Stitch). */
  async gotoTab(projectId: string): Promise<void> {
    await this.nav.goto(`/app/project/${projectId}?tab=rob`);
  }

  /** Open the standalone RoB workspace (legacy Frame — does NOT assert Stitch). */
  async gotoStandalone(projectId: string): Promise<void> {
    await this.page.goto(`/rob/${projectId}`, { waitUntil: 'domcontentloaded' });
  }

  /* ── RoB engine surface (ProjectRobPanel) — role/text from the map ────────── */

  /** The "Assessment tool" selector label (always rendered by ProjectRobPanel). */
  get toolSelectorLabel(): Locator { return this.page.getByText(/assessment tool/i).first(); }
  /** The RoB 2 tool toggle (the only available instrument today). */
  get rob2ToolButton(): Locator { return this.page.getByRole('button', { name: /rob 2/i }).first(); }
  /** The "Only RoB 2 is available today…" footnote unique to the tool selector. */
  get onlyRob2Note(): Locator { return this.page.getByText(/only.*rob 2.*available today/i); }
  /** The RoBTab section-header description (unique to the embedded RoB tab). */
  get sectionHeaderDesc(): Locator { return this.page.getByText(/outcome-level rob 2 for this project/i); }
  /** Owner/assessor control to add a manual study. */
  get addManualStudyButton(): Locator { return this.page.getByRole('button', { name: /add manual study/i }); }
  /** The empty/setup state shown when the project has no studies yet. */
  get emptyStudiesNotice(): Locator { return this.page.getByText(/no studies yet/i); }
  /** Per-study control to start an assessment for a result (shown once studies exist). */
  get assessResultButton(): Locator { return this.page.getByRole('button', { name: /assess a result/i }).first(); }
  /** The "Add a manual study" modal heading. */
  get manualStudyModalHeading(): Locator { return this.page.getByRole('heading', { name: /add a manual study/i }); }
  /** Read-only ("View only") affordance shown to non-editing members. */
  get viewOnlyBadge(): Locator { return this.page.getByText(/view only/i); }
  /** Standalone-route header badge ("RoB 2 · beta"). */
  get standaloneBetaBadge(): Locator { return this.page.getByText(/rob 2.*beta/i); }

  /** Assert the RoB engine panel actually mounted (tool selector + RoB 2 toggle). */
  async expectEngineSurface(): Promise<void> {
    await expect(this.toolSelectorLabel).toBeVisible();
    await expect(this.rob2ToolButton).toBeVisible();
  }

  /* ── Rail + white-submenu workflow stepper (ShellNav testids) ──────────────── */

  /** RoB lives under the Extract category → this is its rail step. */
  get extractCategoryStep(): Locator { return this.nav.workflowStep('extract'); }   // stitch-workflow-step-extract
  /** The RoB workflow sub-step in the white submenu stepper. */
  get robSubStep(): Locator { return this.nav.stepperStep('rob'); }                 // stitch-stepper-step-rob
  /** The sibling Extract sub-step (Data Extraction). */
  get extractionSubStep(): Locator { return this.nav.stepperStep('extraction'); }   // stitch-stepper-step-extraction
  /** The white submenu's category title (e.g. "Extract"). */
  get contextRailTitle(): Locator { return this.page.getByTestId('stitch-context-rail-title'); }

  /* ── Owner-scoped /api/rob REST helpers (relative paths; admin request) ────── */

  /** GET the RoB 2 instrument definition (global; flag-gated only). */
  static async getInstrument(request: APIRequestContext): Promise<{ status: number; body: any }> {
    const res = await request.get('/api/rob/instruments/rob2');
    return { status: res.status(), body: res.ok() ? await res.json() : null };
  }

  /** GET a project's assessments + robvis summary matrix (owner / canAssessRiskOfBias). */
  static async getAssessments(request: APIRequestContext, projectId: string): Promise<{ status: number; body: any }> {
    const res = await request.get(`/api/rob/projects/${encodeURIComponent(projectId)}/assessments`);
    return { status: res.status(), body: res.ok() ? await res.json() : null };
  }

  /** GET the merged study universe (screening-derived + manual). */
  static async getStudies(request: APIRequestContext, projectId: string): Promise<{ status: number; body: any }> {
    const res = await request.get(`/api/rob/projects/${encodeURIComponent(projectId)}/studies`);
    return { status: res.status(), body: res.ok() ? await res.json() : null };
  }

  /** Seed a manual study directly via the engine API (fast, no UI driving). */
  static async createManualStudy(
    request: APIRequestContext,
    projectId: string,
    body: { title?: string; authors?: string; year?: string | number; doi?: string; pmid?: string; notes?: string },
  ): Promise<{ status: number; body: any }> {
    const res = await request.post(`/api/rob/projects/${encodeURIComponent(projectId)}/manual-studies`, { data: body });
    return { status: res.status(), body: res.ok() ? await res.json() : null };
  }
}
