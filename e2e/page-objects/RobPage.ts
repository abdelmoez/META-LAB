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
  /**
   * 115.md — the tool-selector footnote. It used to read "Only RoB 2 is available
   * today; other instruments are in development", which was the copy half of the
   * hardcode 115.md removed: availability is now a REGISTRY fact and the note states
   * how many validated instruments the registry actually carries.
   */
  get toolAvailabilityNote(): Locator { return this.page.getByText(/validated instruments are available/i); }
  /** The "Change default (N tools)" disclosure on the project tool card. */
  get changeDefaultToolButton(): Locator { return this.page.getByRole('button', { name: /change default/i }); }
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

  /* ── 115.md — the redesigned Assess selector (data-testids on the new
       components; the pre-115 RoB surface still carries none) ───────────────── */

  get toolSelector(): Locator { return this.page.getByTestId('rob-tool-selector'); }
  get recommendedTools(): Locator { return this.page.getByTestId('rob-recommended-tools'); }
  get toolSearch(): Locator { return this.page.getByTestId('rob-tool-search'); }
  get toolDesignFilter(): Locator { return this.page.getByTestId('rob-tool-design-filter'); }
  get showAllTools(): Locator { return this.page.getByTestId('rob-tool-show-all'); }
  get startAssessment(): Locator { return this.page.getByTestId('rob-start-assessment'); }
  get mismatchWarning(): Locator { return this.page.getByTestId('rob-mismatch-warning'); }
  get mismatchContinue(): Locator { return this.page.getByTestId('rob-mismatch-continue'); }
  get existingAssessmentsNotice(): Locator { return this.page.getByTestId('rob-existing-assessments'); }
  toolCard(instrumentId: string): Locator { return this.page.getByTestId(`rob-tool-card-${instrumentId}`); }

  /* ── 115.md — the definition-driven assessment pane ──────────────────────── */

  get instrumentPanel(): Locator { return this.page.getByTestId('rob-instrument-panel'); }
  get panelProgress(): Locator { return this.page.getByTestId('rob-progress'); }
  get noOverallNotice(): Locator { return this.page.getByTestId('rob-no-overall'); }
  get finaliseButton(): Locator { return this.page.getByRole('button', { name: /^finalise$/i }); }
  get reopenButton(): Locator { return this.page.getByRole('button', { name: /re-open/i }); }
  get backToRob(): Locator { return this.page.getByRole('button', { name: /back to risk of bias/i }); }
  domainToggle(domainId: string): Locator { return this.page.getByTestId(`rob-domain-toggle-${domainId}`); }
  domainNav(domainId: string): Locator { return this.page.getByTestId(`rob-domain-nav-${domainId}`); }
  response(questionId: string, code: string): Locator { return this.page.getByTestId(`rob-response-${questionId}-${code}`); }
  robAxis(domainId: string): Locator { return this.page.getByTestId(`rob-axis-rob-${domainId}`); }
  applicabilityAxis(domainId: string): Locator { return this.page.getByTestId(`rob-axis-applicability-${domainId}`); }
  get overallAxis(): Locator { return this.page.getByTestId('rob-axis-overall'); }

  /**
   * Record a judgement on one axis: open it, pick a level, type the reason the API
   * requires for a domain/overall judgement, save. `testId` is the axis root
   * (`rob-axis-rob-D1`, `rob-axis-applicability-D1`, `rob-axis-overall`).
   */
  async recordJudgment(testId: string, level: string, reason = 'E2E reviewer judgement'): Promise<void> {
    const axis = this.page.getByTestId(testId);
    await axis.getByTestId(`${testId}-record`).click();
    await axis.getByTestId(`${testId}-level-${level}`).click();
    await axis.getByTestId(`${testId}-reason`).fill(reason);
    await axis.getByTestId(`${testId}-save`).click();
    await expect(axis.getByTestId(`${testId}-record`)).toHaveText(/change/i);
  }

  /** Answer every answerable item of the OPEN pane with `code` (e.g. 'Y'). */
  async answerAll(questionIds: string[], code: string): Promise<void> {
    for (const qid of questionIds) await this.response(qid, code).click();
  }

  /** Assert the RoB engine panel actually mounted (tool selector + RoB 2 toggle). */
  async expectEngineSurface(): Promise<void> {
    await expect(this.toolSelectorLabel).toBeVisible();
    await expect(this.rob2ToolButton).toBeVisible();
  }

  /** Open the Assess selector for the Nth study card (default: the first). */
  async openAssessSelector(index = 0): Promise<void> {
    await this.page.getByRole('button', { name: /assess a result/i }).nth(index).click();
    await expect(this.toolSelector).toBeVisible();
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

  /** GET the registry-driven catalogue of SELECTABLE instruments (115.md). */
  static async getInstruments(request: APIRequestContext): Promise<{ status: number; body: any }> {
    const res = await request.get('/api/rob/instruments');
    return { status: res.status(), body: res.ok() ? await res.json() : null };
  }

  /**
   * Set the project-level study design, which the RoB study universe inherits when
   * a study carries none of its own — the input the per-study recommendation is
   * derived from (`toolsForStudyDesign`). `PUT /api/projects/:id` strips `studies`,
   * so the project-level field is the seam an e2e can drive.
   */
  static async setProjectDesign(request: APIRequestContext, projectId: string, design: string): Promise<boolean> {
    const res = await request.put(`/api/projects/${encodeURIComponent(projectId)}`, { data: { studyDesign: design } });
    return res.ok();
  }

  /** GET one assessment's full view (answers, judgements, applicability, overall). */
  static async getAssessment(request: APIRequestContext, id: string): Promise<{ status: number; body: any }> {
    const res = await request.get(`/api/rob/assessments/${encodeURIComponent(id)}`);
    return { status: res.status(), body: res.ok() ? await res.json() : null };
  }

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
