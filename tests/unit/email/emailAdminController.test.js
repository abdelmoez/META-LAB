/**
 * emailAdminController.test.js — 112.md follow-up — pure-function contracts for
 * the Ops › Email server half (server/controllers/emailAdminController.js):
 *
 *   - the PUT validation matrix (types, length caps, unknown keys, and the
 *     required-token gate over the EFFECTIVE subject+bodyParagraphs),
 *   - override diffing (only fields that differ from the registry defaults are
 *     stored; an edit back to defaults stores nothing),
 *   - preview determinism (sample values are a pure function of variable NAMES,
 *     so the same draft always renders byte-identically),
 *   - the disable verdict (only registry-disableable templates have an off
 *     switch; everything else is a 400 by construction),
 *   - delivery filter/paging maths (shared parseJobPage + the 109 r2 end-of-day
 *     widening for date-only `to` bounds),
 *   - the capability seam (mods read, admins write — by omission).
 *
 * Everything asserted here is a pure export — no database, no express.
 */
import { restoreShellEnv } from '../../screening/helpers/prismaEnvGuard.js'; // FIRST import
import { describe, it, expect } from 'vitest';
import {
  validateTemplateFields, diffFieldsAgainstDefaults, sampleValueFor, sampleVariables,
  canToggleTemplate, templateView, buildDeliveryWhere,
  OVERRIDABLE_FIELDS, TEMPLATE_FIELD_LIMITS, DELIVERY_STATUSES,
  TEST_SEND_HOURLY_CAP, TEST_SEND_ENTITY_ID,
} from '../../../server/controllers/emailAdminController.js';
import { parseJobPage } from '../../../server/controllers/researchOpsJobsController.js';
import {
  listEmailTemplates, getEmailTemplate, renderTemplate, isDisableableCategory,
} from '../../../server/services/emailTemplates.js';
import { MOD_GRANTED_PERMISSIONS } from '../../../server/middleware/requireAdmin.js';

restoreShellEnv();

const welcome = getEmailTemplate('welcome');
const reset = getEmailTemplate('password.reset');
const reply = getEmailTemplate('contact.reply');

/* ── PUT validation matrix ──────────────────────────────────────────────── */

describe('validateTemplateFields — types and caps', () => {
  it('rejects non-object fields', () => {
    for (const bad of [null, undefined, 'x', 42, ['a']]) {
      expect(validateTemplateFields(welcome, bad).ok).toBe(false);
    }
  });

  it('rejects unknown keys BY NAME', () => {
    const v = validateTemplateFields(welcome, { subject: 'Hi', html: '<b>evil</b>' });
    expect(v.ok).toBe(false);
    expect(v.error).toContain('html');
  });

  it('rejects a non-string scalar field, naming it', () => {
    const v = validateTemplateFields(welcome, { subject: 42 });
    expect(v.ok).toBe(false);
    expect(v.error).toContain('subject');
  });

  it('enforces the per-field length caps', () => {
    expect(validateTemplateFields(welcome, { subject: 'x'.repeat(TEMPLATE_FIELD_LIMITS.subject + 1) }).ok).toBe(false);
    expect(validateTemplateFields(welcome, { subject: 'x'.repeat(TEMPLATE_FIELD_LIMITS.subject) }).ok).toBe(true);
    expect(validateTemplateFields(welcome, { ctaHref: 'x'.repeat(TEMPLATE_FIELD_LIMITS.ctaHref + 1) }).ok).toBe(false);
    expect(validateTemplateFields(welcome, { footerNote: 'x'.repeat(TEMPLATE_FIELD_LIMITS.footerNote + 1) }).ok).toBe(false);
  });

  it('bodyParagraphs must be an array of strings, bounded in count and length', () => {
    expect(validateTemplateFields(welcome, { bodyParagraphs: 'one big string' }).ok).toBe(false);
    expect(validateTemplateFields(welcome, { bodyParagraphs: ['ok', 7] }).ok).toBe(false);
    const tooMany = Array.from({ length: TEMPLATE_FIELD_LIMITS.bodyParagraphCount + 1 }, () => 'p');
    expect(validateTemplateFields(welcome, { bodyParagraphs: tooMany }).ok).toBe(false);
    const long = validateTemplateFields(welcome, { bodyParagraphs: ['fine', 'x'.repeat(TEMPLATE_FIELD_LIMITS.bodyParagraph + 1)] });
    expect(long.ok).toBe(false);
    expect(long.error).toContain('bodyParagraphs[1]');
  });

  it('every registry default validates against its own entry', () => {
    for (const entry of listEmailTemplates()) {
      const v = validateTemplateFields(entry, entry.defaultFields);
      expect(v.ok, `${entry.key} defaults must self-validate`).toBe(true);
    }
  });
});

describe('validateTemplateFields — the required-token gate', () => {
  it('an override that strips the last [link] from subject+body is refused, naming the token', () => {
    const v = validateTemplateFields(reset, {
      subject: 'Reset your password',
      bodyParagraphs: ['Click the button below.'],
    });
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(['link']);
    expect(v.error).toContain('[link]');
  });

  it('a token in the SUBJECT satisfies the gate', () => {
    const v = validateTemplateFields(reset, {
      subject: 'Reset: [link]',
      bodyParagraphs: ['Click the button below.'],
    });
    expect(v.ok).toBe(true);
  });

  it('a PARTIAL override inherits the defaults’ tokens (only heading changed)', () => {
    const v = validateTemplateFields(reset, { heading: 'New heading' });
    expect(v.ok).toBe(true);
  });

  it('contact.reply requires [bodyText] to survive a body rewrite', () => {
    const bad = validateTemplateFields(reply, { bodyParagraphs: ['Regards.'] });
    expect(bad.ok).toBe(false);
    expect(bad.missing).toEqual(['bodyText']);
    const good = validateTemplateFields(reply, { bodyParagraphs: ['[bodyText]', 'Regards.'] });
    expect(good.ok).toBe(true);
  });

  it('templates with no required variables accept any well-typed override', () => {
    expect(welcome.requiredVariables).toEqual([]);
    expect(validateTemplateFields(welcome, { bodyParagraphs: ['Totally new copy.'] }).ok).toBe(true);
  });

  it('requireTokens:false (the preview path) skips the gate but not the type checks', () => {
    expect(validateTemplateFields(reset, { bodyParagraphs: ['no token here'] }, { requireTokens: false }).ok).toBe(true);
    expect(validateTemplateFields(reset, { bodyParagraphs: 'nope' }, { requireTokens: false }).ok).toBe(false);
  });
});

/* ── override diffing ───────────────────────────────────────────────────── */

describe('diffFieldsAgainstDefaults — only real differences are stored', () => {
  it('a full submit identical to the defaults diffs to NOTHING', () => {
    for (const entry of listEmailTemplates()) {
      expect(diffFieldsAgainstDefaults(entry, { ...entry.defaultFields })).toEqual({});
    }
  });

  it('keeps exactly the changed fields', () => {
    const d = diffFieldsAgainstDefaults(welcome, { ...welcome.defaultFields, subject: 'Howdy' });
    expect(Object.keys(d)).toEqual(['subject']);
    expect(d.subject).toBe('Howdy');
  });

  it('bodyParagraphs compare structurally, not by reference', () => {
    const same = diffFieldsAgainstDefaults(welcome, { bodyParagraphs: [...welcome.defaultFields.bodyParagraphs] });
    expect(same).toEqual({});
    const diff = diffFieldsAgainstDefaults(welcome, { bodyParagraphs: ['different'] });
    expect(diff.bodyParagraphs).toEqual(['different']);
  });
});

/* ── preview determinism ────────────────────────────────────────────────── */

describe('preview — deterministic sample values', () => {
  it('sampleValueFor is a pure function of the name', () => {
    for (const entry of listEmailTemplates()) {
      for (const name of [...entry.requiredVariables, ...entry.optionalVariables]) {
        expect(sampleValueFor(name)).toEqual(sampleValueFor(name));
      }
    }
  });

  it('link-ish names sample to real https URLs (so the CTA renders)', () => {
    expect(String(sampleValueFor('link'))).toMatch(/^https:\/\//);
    expect(String(sampleValueFor('siteLink'))).toMatch(/^https:\/\//);
    expect(String(sampleValueFor('appBaseUrl'))).toMatch(/^https:\/\//);
  });

  it('sampleVariables covers every declared variable of every entry', () => {
    for (const entry of listEmailTemplates()) {
      const s = sampleVariables(entry);
      for (const name of [...entry.requiredVariables, ...entry.optionalVariables]) {
        expect(s[name], `${entry.key}.${name}`).not.toBe(undefined);
      }
      expect(sampleVariables(entry)).toEqual(s); // twice → identical
    }
  });

  it('every template renders with its samples: no missingRequired, byte-identical twice', () => {
    for (const entry of listEmailTemplates()) {
      const s = sampleVariables(entry);
      const a = renderTemplate(entry.key, s);
      const b = renderTemplate(entry.key, s);
      expect(a.missingRequired, entry.key).toEqual([]);
      expect(a.subject).toBe(b.subject);
      expect(a.html).toBe(b.html);
      expect(a.text).toBe(b.text);
      expect(a.subject.length).toBeGreaterThan(0);
    }
  });
});

/* ── disable verdict ────────────────────────────────────────────────────── */

describe('canToggleTemplate — only optional templates have an off switch', () => {
  it('welcome (the one disableable entry) is allowed', () => {
    const v = canToggleTemplate('welcome');
    expect(v.ok).toBe(true);
    expect(v.entry.key).toBe('welcome');
  });

  it('every non-disableable template is a 400, and the sets agree with the registry', () => {
    for (const entry of listEmailTemplates()) {
      const v = canToggleTemplate(entry.key);
      expect(v.ok, entry.key).toBe(isDisableableCategory(entry.key));
      if (!entry.disableable) {
        expect(v.status).toBe(400);
        expect(v.error).toContain(entry.key);
      }
    }
  });

  it('an unknown key is a 404, not a 400', () => {
    expect(canToggleTemplate('no.such.template')).toMatchObject({ ok: false, status: 404 });
  });
});

/* ── merged view ────────────────────────────────────────────────────────── */

describe('templateView — the registry ⊕ override merge', () => {
  it('with no override: defaults are effective, enabled true, hasOverride false', () => {
    const v = templateView(welcome, null);
    expect(v.hasOverride).toBe(false);
    expect(v.overrideFields).toBe(null);
    expect(v.enabled).toBe(true);
    expect(v.effectiveFields).toEqual(welcome.defaultFields);
  });

  it('override fields shadow defaults field-by-field', () => {
    const v = templateView(welcome, { fieldsJson: JSON.stringify({ subject: 'Custom' }), enabled: true, updatedAt: 'x' });
    expect(v.hasOverride).toBe(true);
    expect(v.effectiveFields.subject).toBe('Custom');
    expect(v.effectiveFields.heading).toBe(welcome.defaultFields.heading);
  });

  it('enabled:false only sticks on a DISABLEABLE template (the worker rule, mirrored)', () => {
    const row = { fieldsJson: '{}', enabled: false, updatedAt: 'x' };
    expect(templateView(welcome, row).enabled).toBe(false);
    expect(templateView(reset, row).enabled).toBe(true);
  });

  it('corrupt fieldsJson degrades to registry defaults, never a throw', () => {
    const v = templateView(welcome, { fieldsJson: '{not json', enabled: true, updatedAt: 'x' });
    expect(v.hasOverride).toBe(false);
    expect(v.effectiveFields).toEqual(welcome.defaultFields);
  });
});

/* ── delivery filter/paging maths ───────────────────────────────────────── */

describe('buildDeliveryWhere — junk-tolerant filters with the end-of-day rule', () => {
  it('a junk status is ignored, a known status filters', () => {
    expect(buildDeliveryWhere({ status: 'nonsense' })).toEqual({});
    for (const s of DELIVERY_STATUSES) {
      expect(buildDeliveryWhere({ status: s })).toEqual({ status: s });
    }
  });

  it('templateKey passes through bounded (historical keys stay filterable)', () => {
    expect(buildDeliveryWhere({ templateKey: 'welcome' })).toEqual({ templateKey: 'welcome' });
    expect(buildDeliveryWhere({ templateKey: 'renamed.legacy.key' })).toEqual({ templateKey: 'renamed.legacy.key' });
    expect(buildDeliveryWhere({ templateKey: 'x'.repeat(101) })).toEqual({});
  });

  it('a date-only `to` widens to END of day; `from` stays at midnight (109 r2 rule)', () => {
    const w = buildDeliveryWhere({ from: '2026-08-01', to: '2026-08-09' });
    expect(w.createdAt.gte.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(w.createdAt.lte.toISOString()).toBe('2026-08-09T23:59:59.999Z');
  });

  it('invalid dates are ignored rather than 400-ing the filter bar', () => {
    expect(buildDeliveryWhere({ from: 'not-a-date', to: '' })).toEqual({});
  });

  it('paging is the shared Ops parser: clamped limit, floor page, correct skip', () => {
    expect(parseJobPage({})).toEqual({ page: 1, limit: 25, skip: 0 });
    expect(parseJobPage({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10, skip: 20 });
    expect(parseJobPage({ limit: '99999' }).limit).toBe(100);
    expect(parseJobPage({ page: '-4' }).page).toBe(1);
  });
});

/* ── capability seam + constants ────────────────────────────────────────── */

describe('112 — the email capability seam', () => {
  it('mods may VIEW email delivery/templates and NOTHING that mutates them', () => {
    expect(MOD_GRANTED_PERMISSIONS).toContain('view_email_delivery');
    expect(MOD_GRANTED_PERMISSIONS).not.toContain('manage_email_templates');
  });

  it('the test-send cap and marker are pinned', () => {
    expect(TEST_SEND_HOURLY_CAP).toBe(5);
    expect(TEST_SEND_ENTITY_ID).toBe('ops-test-send');
  });

  it('the overridable field set matches the renderTemplate overrides contract', () => {
    expect(OVERRIDABLE_FIELDS).toEqual(['subject', 'heading', 'bodyParagraphs', 'ctaLabel', 'ctaHref', 'footerNote']);
  });
});
