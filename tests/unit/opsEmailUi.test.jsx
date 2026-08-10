/**
 * opsEmailUi.test.jsx — SSR-shape tests for the extracted Ops Email package
 * (112.md follow-up — src/frontend/pages/admin/email/).
 *
 * House style (the opsResearchGovernanceUi precedent): renderToStaticMarkup, no
 * jsdom, no RTL. Effects do not run, so everything asserted is what the package
 * renders from the SHARED REGISTRY alone — which is the contract worth pinning:
 *
 *   - the section shell renders the <h2> OpsPage.HEADINGS matches and both
 *     sub-tab buttons with their stable testids;
 *   - the template list is REGISTRY-DRIVEN: one row per registry key, category
 *     badges, and 'always' (no off switch) for every transactional entry;
 *   - the editor renders a variable chip for every declared variable of its
 *     template, structured fields only (never a raw-HTML box), the enabled
 *     toggle ONLY where the registry says disableable, and restore-default only
 *     when an override exists;
 *   - the delivery tab renders its filters with the full status vocabulary and
 *     the "bodies are never stored" honesty note;
 *   - the paragraphs ↔ textarea encoding round-trips every registry template;
 *   - the package is legacy-design only — no Stitch import, no hex-concat alpha.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listEmailTemplates, getEmailTemplate } from '../../server/services/emailTemplates.js';
import { templateView } from '../../server/controllers/emailAdminController.js';
import EmailSection, { EMAIL_TABS } from '../../src/frontend/pages/admin/email/EmailSection.jsx';
import TemplatesTab, { TemplateEditor } from '../../src/frontend/pages/admin/email/TemplatesTab.jsx';
import DeliveryTab from '../../src/frontend/pages/admin/email/DeliveryTab.jsx';
import {
  paragraphsToText, textToParagraphs, draftFromTemplate, fieldsFromDraft,
  DELIVERY_STATUSES, deliveryStatusLabel,
} from '../../src/frontend/pages/admin/email/fields.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const PKG = resolve(ROOT, 'src', 'frontend', 'pages', 'admin', 'email');

const render = (el) => renderToStaticMarkup(el);

/** The exact merged shape the API returns, built from the registry alone. */
const REGISTRY_VIEWS = listEmailTemplates().map((e) => templateView(e, null));

describe('Email section shell', () => {
  const html = render(h(EmailSection, {}));

  it('renders the <h2> the Ops page object matches on', () => {
    expect(html).toContain('<h2');
    expect(html).toContain('>Email</h2>');
  });

  it('renders both sub-tab buttons with their stable testids', () => {
    expect(EMAIL_TABS.map((t) => t.id)).toEqual(['templates', 'delivery']);
    for (const t of EMAIL_TABS) {
      expect(html, `sub-tab ${t.id}`).toContain(`data-testid="em-tab-${t.id}"`);
      expect(html).toContain(t.label);
    }
  });

  it('states the ownership contract up front (registry owns copy; no bodies stored)', () => {
    expect(html).toContain('registry');
    expect(html).toContain('never bodies');
  });
});

describe('Templates tab — registry-driven rows', () => {
  const html = render(h(TemplatesTab, { initialTemplates: REGISTRY_VIEWS }));

  it('renders one row per registry template', () => {
    expect(REGISTRY_VIEWS.length).toBe(9);
    for (const t of REGISTRY_VIEWS) {
      expect(html, `row ${t.key}`).toContain(`data-testid="em-template-row-${t.key}"`);
      expect(html, `edit ${t.key}`).toContain(`data-testid="em-edit-${t.key}"`);
    }
  });

  it('marks every non-disableable template "always" and only the optional ones get on/off', () => {
    const disableable = REGISTRY_VIEWS.filter((t) => t.disableable).map((t) => t.key).sort();
    expect(disableable).toEqual(['chat.digest', 'welcome']);
    // The transactional rows say "always"; each optional row shows an on/off badge.
    const transactional = REGISTRY_VIEWS.length - disableable.length;
    expect(html.match(/Transactional — cannot be disabled/g)).toHaveLength(transactional);
  });

  it('renders the scope note: overrides only, restore deletes, no bodies stored', () => {
    expect(html).toContain('data-testid="em-templates-scope"');
    expect(html).toContain('Restore Default deletes');
    expect(html).toContain('never stored');
  });
});

describe('Template editor', () => {
  const welcomeView = templateView(getEmailTemplate('welcome'), null);
  const resetView = templateView(getEmailTemplate('password.reset'), null);
  const welcomeHtml = render(h(TemplateEditor, { template: welcomeView, onSaved: () => {}, onClose: () => {} }));
  const resetHtml = render(h(TemplateEditor, { template: resetView, onSaved: () => {}, onClose: () => {} }));

  it('renders a variable chip for EVERY declared variable, from the registry', () => {
    for (const name of [...resetView.requiredVariables, ...resetView.optionalVariables]) {
      expect(resetHtml, `chip ${name}`).toContain(`data-testid="em-var-${name}"`);
    }
    for (const name of welcomeView.optionalVariables) {
      expect(welcomeHtml, `chip ${name}`).toContain(`data-testid="em-var-${name}"`);
    }
  });

  it('renders structured fields only — every field control, no raw-HTML editor', () => {
    for (const id of ['em-field-subject', 'em-field-heading', 'em-field-body', 'em-field-ctaLabel', 'em-field-ctaHref', 'em-field-footerNote']) {
      expect(welcomeHtml).toContain(`data-testid="${id}"`);
    }
    expect(welcomeHtml.toLowerCase()).not.toContain('raw html');
  });

  it('the enabled toggle exists ONLY on the disableable template', () => {
    expect(welcomeHtml).toContain('data-testid="em-enabled-toggle"');
    expect(resetHtml).not.toContain('data-testid="em-enabled-toggle"');
    // …and the transactional editor says WHY there is no off switch.
    expect(resetHtml).toContain('data-testid="em-transactional-note"');
    expect(resetHtml).toContain('no off switch');
  });

  it('preview, save and test-send are present; restore only when an override exists', () => {
    for (const id of ['em-preview-btn', 'em-save', 'em-test-send']) {
      expect(welcomeHtml).toContain(`data-testid="${id}"`);
    }
    expect(welcomeHtml).not.toContain('data-testid="em-restore"');
    const overridden = templateView(getEmailTemplate('welcome'), {
      fieldsJson: JSON.stringify({ subject: 'Custom' }), enabled: true, updatedAt: new Date().toISOString(),
    });
    const html = render(h(TemplateEditor, { template: overridden, onSaved: () => {}, onClose: () => {} }));
    expect(html).toContain('data-testid="em-restore"');
    expect(html).toContain('Customized');
  });

  it('prefills the draft from the EFFECTIVE fields', () => {
    expect(welcomeHtml).toContain('Welcome to the [appName] beta');
  });
});

describe('Delivery tab', () => {
  const html = render(h(DeliveryTab, {}));

  it('renders the filter bar with the FULL status vocabulary', () => {
    for (const id of ['em-delivery-filter-status', 'em-delivery-filter-template', 'em-delivery-filter-from', 'em-delivery-filter-to']) {
      expect(html).toContain(`data-testid="${id}"`);
    }
    expect(DELIVERY_STATUSES).toEqual(['pending', 'sending', 'sent', 'failed', 'skipped_disabled', 'skipped_unconfigured']);
    for (const s of DELIVERY_STATUSES) {
      expect(html, `status option ${s}`).toContain(`value="${s}"`);
    }
    // The two skip states explain themselves in the label.
    expect(deliveryStatusLabel('skipped_disabled')).toContain('disabled');
    expect(deliveryStatusLabel('skipped_unconfigured')).toContain('SMTP');
  });

  it('renders the honesty note — delivery metadata, never bodies or variable payloads', () => {
    expect(html).toContain('data-testid="em-delivery-scope"');
    expect(html).toContain('never stored');
    expect(html).toContain('never returned');
  });

  it('renders the delivery card shell (table paints after the effect fetch)', () => {
    expect(html).toContain('data-testid="em-delivery"');
    expect(html).toContain('data-testid="em-delivery-reload"');
  });
});

describe('paragraph ↔ textarea encoding', () => {
  it('round-trips every registry template losslessly', () => {
    for (const entry of listEmailTemplates()) {
      const paragraphs = entry.defaultFields.bodyParagraphs;
      expect(textToParagraphs(paragraphsToText(paragraphs)), entry.key).toEqual(paragraphs);
    }
  });

  it('a single newline stays INSIDE a paragraph; a blank line splits', () => {
    expect(textToParagraphs('one\ntwo')).toEqual(['one\ntwo']);
    expect(textToParagraphs('one\n\ntwo')).toEqual(['one', 'two']);
    expect(textToParagraphs('one\n\n\n\ntwo')).toEqual(['one', 'two']);
    expect(textToParagraphs('  \n\n')).toEqual([]);
  });

  it('draftFromTemplate → fieldsFromDraft reproduces the effective fields', () => {
    for (const view of REGISTRY_VIEWS) {
      const fields = fieldsFromDraft(draftFromTemplate(view));
      expect(fields.subject, view.key).toBe(view.effectiveFields.subject);
      expect(fields.bodyParagraphs, view.key).toEqual(view.effectiveFields.bodyParagraphs);
      expect(fields.ctaLabel, view.key).toBe(String(view.effectiveFields.ctaLabel || ''));
      expect(fields.ctaHref, view.key).toBe(String(view.effectiveFields.ctaHref || ''));
      expect(fields.footerNote, view.key).toBe(String(view.effectiveFields.footerNote || ''));
    }
  });
});

describe('Legacy design constraint', () => {
  const files = readdirSync(PKG).filter((f) => f.endsWith('.jsx') || f.endsWith('.js'));

  it('the package has the expected modules', () => {
    expect(files.sort()).toEqual(['DeliveryTab.jsx', 'EmailSection.jsx', 'TemplatesTab.jsx', 'fields.js']);
  });

  it('no module imports a Stitch primitive or design-system component', () => {
    for (const f of files) {
      const src = readFileSync(resolve(PKG, f), 'utf8');
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(/stitch|design-system|\/ds\//i.test(spec), `${f} must not import "${spec}" — /ops is legacy-design only`).toBe(false);
      }
    }
  });

  it('alpha() is used instead of hex concatenation onto CSS vars', () => {
    for (const f of files) {
      const body = readFileSync(resolve(PKG, f), 'utf8');
      expect(/\$\{C\.[a-zA-Z0-9]+\}[0-9a-fA-F]{2}[^0-9a-fA-F]/.test(body), `${f} concatenates a hex alpha onto a CSS var`).toBe(false);
    }
  });
});
