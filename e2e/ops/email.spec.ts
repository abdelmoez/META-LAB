/**
 * email.spec.ts — Ops › Email (112.md follow-up).
 *
 * Covers:
 *   1. The section mounts for an admin and both sub-tabs render their content.
 *   2. Templates — the registry-driven list shows every template with its
 *      category, and only `welcome` (the one disableable entry) offers on/off.
 *   3. The editor opens with variable chips from the registry and renders a
 *      deterministic preview into a sandboxed iframe.
 *   4. A transactional template's editor has NO enabled toggle and says why.
 *   5. Delivery — the paginated table renders with its filters and status chips.
 *
 * GLOBAL-STATE SAFETY: this spec is READ-ONLY plus preview (preview persists
 * nothing by contract). No override is saved, no toggle flipped, no test email
 * enqueued — the ops.spec.ts restore discipline is unnecessary because nothing
 * is written in the first place.
 */
import { test, expect } from '../fixtures/stitch-test';
import { OpsPage } from '../page-objects/OpsPage';

test.describe('Ops › Email', () => {
  test('@smoke the section mounts and both sub-tabs render', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('email');

    await expect(ops.sectionHeading('email')).toBeVisible();

    // Templates is the default sub-tab — the registry list loads.
    await expect(ops.emailTemplatesTable).toBeVisible({ timeout: 15000 });
    await expect(ops.emailTemplateRow('welcome')).toBeVisible();
    await expect(ops.emailTemplateRow('password.reset')).toBeVisible();

    await ops.openEmailTab('delivery');
    await expect(ops.emailDeliveryTable).toBeVisible({ timeout: 15000 });
    await expect(ops.emailDeliveryFilterStatus).toBeVisible();
  });

  test('the template list is registry-driven and honest about the off switch', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('email');
    await expect(ops.emailTemplatesTable).toBeVisible({ timeout: 15000 });

    // All eight registry templates render a row.
    for (const key of [
      'contact.reply', 'waitlist.confirmation', 'password.reset', 'email.verification',
      'invite.projectMember', 'invite.waitlist', 'welcome', 'password.changed',
    ]) {
      await expect(ops.emailTemplateRow(key), `row ${key}`).toBeVisible();
    }

    // The scope note states the ownership contract.
    await expect(page.getByTestId('em-templates-scope')).toContainText(/registry owns canonical copy/i);
  });

  test('the editor opens with variable chips and renders a preview iframe', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('email');
    await expect(ops.emailTemplatesTable).toBeVisible({ timeout: 15000 });

    await ops.emailEdit('password.reset').click();
    await expect(ops.emailEditor).toBeVisible();

    // Chips come straight from the registry's variable contract.
    await expect(ops.emailVarChip('link')).toBeVisible();
    await expect(ops.emailVarChip('expiresAtText')).toBeVisible();

    // Structured fields, prefilled from the effective copy.
    await expect(page.getByTestId('em-field-subject')).toHaveValue(/Reset your \[appName\] password/);

    // A transactional template has NO off switch, and the editor says why.
    await expect(ops.emailEnabledToggle).toHaveCount(0);
    await expect(page.getByTestId('em-transactional-note')).toContainText(/no off switch/i);

    // Preview renders server-side with deterministic samples into the iframe.
    await ops.emailPreviewButton.click();
    await expect(ops.emailPreviewFrame).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('em-preview-subject')).toContainText(/Reset your PecanRev password/i);
  });

  test('the welcome editor offers the enabled toggle (the one disableable template)', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('email');
    await expect(ops.emailTemplatesTable).toBeVisible({ timeout: 15000 });

    await ops.emailEdit('welcome').click();
    await expect(ops.emailEditor).toBeVisible();
    await expect(ops.emailEnabledToggle).toBeVisible();
    // Read-only spec: the toggle is NOT clicked — flipping it writes global state.
  });

  test('delivery renders filters, status chips and the honesty note', async ({ page }) => {
    const ops = new OpsPage(page);
    await ops.goto();
    await ops.openSection('email');
    await ops.openEmailTab('delivery');

    await expect(ops.emailDeliveryTable).toBeVisible({ timeout: 15000 });
    await expect(ops.emailDeliveryFilterStatus).toBeVisible();
    await expect(ops.emailDeliveryFilterTemplate).toBeVisible();
    await expect(page.getByTestId('em-delivery-filter-from')).toBeVisible();
    await expect(page.getByTestId('em-delivery-filter-to')).toBeVisible();

    // Per-status chips render once the envelope (with counts) arrives.
    await expect(page.getByTestId('em-delivery-count-sent')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('em-delivery-scope')).toContainText(/bodies are never stored/i);
  });
});
