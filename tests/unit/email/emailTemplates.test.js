/**
 * emailTemplates.test.js — the email template registry + renderTemplate.
 *
 * These are pure functions with no I/O, so nothing is mocked and nothing is
 * stubbed: the only environment coupling is APP_BASE_URL (the layout footer and
 * the text tail read it), which is saved/cleared/restored around every test so
 * the assertions are deterministic on any machine.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  renderTemplate,
  renderBaseEmailLayout,
  listEmailTemplates,
  getEmailTemplate,
  emailTemplateKeys,
  isDisableableCategory,
  escapeHtml,
} from '../../../server/services/emailTemplates.js';

const ENV = ['APP_BASE_URL'];
let saved;
beforeEach(() => { saved = {}; for (const k of ENV) saved[k] = process.env[k]; for (const k of ENV) delete process.env[k]; });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const TOKEN_RE = /\[([A-Za-z][A-Za-z0-9_]*)\]/g;
const COND_RE = /@(?:if|ifnot):([A-Za-z][A-Za-z0-9_]*)/g;
const CTA_SENTINEL = '[[cta]]';

/** Every copy string in an entry's defaultFields, sentinel removed. */
function copyStrings(entry) {
  const f = entry.defaultFields;
  return [f.subject, f.heading, f.ctaLabel, f.ctaHref, f.footerNote, ...f.bodyParagraphs]
    .filter((s) => typeof s === 'string')
    .map((s) => s.split(CTA_SENTINEL).join(''));
}

describe('registry integrity', () => {
  const entries = listEmailTemplates();

  it('every entry has the full contract shape', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(typeof e.key).toBe('string');
      expect(e.key.length).toBeGreaterThan(0);
      expect(['transactional', 'optional']).toContain(e.category);
      expect(typeof e.description).toBe('string');
      expect(e.description.length).toBeGreaterThan(10);
      expect(Array.isArray(e.requiredVariables)).toBe(true);
      expect(Array.isArray(e.optionalVariables)).toBe(true);
      expect(typeof e.defaultFields).toBe('object');
      expect(typeof e.defaultFields.subject).toBe('string');
      expect(typeof e.defaultFields.heading).toBe('string');
      expect(Array.isArray(e.defaultFields.bodyParagraphs)).toBe(true);
      // disableable is DERIVED from category — never set independently.
      expect(e.disableable).toBe(e.category === 'optional');
    }
  });

  it('keys are unique and cover the emails the product actually sends', () => {
    const keys = emailTemplateKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual([
      'chat.digest',
      'contact.reply',
      'email.verification',
      'invite.projectMember',
      'invite.waitlist',
      'password.changed',
      'password.reset',
      'waitlist.confirmation',
      'welcome',
    ]);
  });

  it("only 'welcome' and 'chat.digest' are disableable; everything else is transactional", () => {
    const optional = entries.filter((e) => e.category === 'optional').map((e) => e.key).sort();
    expect(optional).toEqual(['chat.digest', 'welcome']);
    expect(isDisableableCategory('welcome')).toBe(true);
    expect(isDisableableCategory('chat.digest')).toBe(true);
    expect(isDisableableCategory('password.reset')).toBe(false);
    expect(isDisableableCategory('nope')).toBe(false);
  });

  it('required and optional variable lists never overlap', () => {
    for (const e of entries) {
      const overlap = e.requiredVariables.filter((v) => e.optionalVariables.includes(v));
      expect(overlap, `${e.key} declares ${overlap.join(',')} twice`).toEqual([]);
    }
  });

  it('every [token] and every @if condition names a DECLARED variable', () => {
    for (const e of entries) {
      const declared = new Set([...e.requiredVariables, ...e.optionalVariables]);
      for (const copy of copyStrings(e)) {
        for (const m of copy.matchAll(TOKEN_RE)) {
          expect(declared.has(m[1]), `${e.key}: undeclared token [${m[1]}]`).toBe(true);
        }
        for (const m of copy.matchAll(COND_RE)) {
          expect(declared.has(m[1]), `${e.key}: undeclared condition ${m[1]}`).toBe(true);
        }
      }
    }
  });

  it('declares no dead variables (appName excepted — it is consumed by the chrome)', () => {
    for (const e of entries) {
      const blob = copyStrings(e).join('\n');
      for (const v of [...e.requiredVariables, ...e.optionalVariables]) {
        if (v === 'appName') continue;
        expect(blob.includes(`[${v}]`) || blob.includes(`:${v} `), `${e.key}: ${v} is never used`).toBe(true);
      }
    }
  });

  it('a CTA is always declared as a label/href pair', () => {
    for (const e of entries) {
      const { ctaLabel, ctaHref } = e.defaultFields;
      expect(Boolean(ctaLabel), `${e.key}`).toBe(Boolean(ctaHref));
    }
  });

  it('getEmailTemplate returns null for an unknown key and renderTemplate throws', () => {
    expect(getEmailTemplate('does.not.exist')).toBeNull();
    expect(() => renderTemplate('does.not.exist', {})).toThrow(/Unknown email template/);
  });
});

describe('renderTemplate — substitution and escaping', () => {
  it('substitutes tokens: escaped in html, raw in text', () => {
    const { html, text } = renderTemplate('invite.projectMember', {
      projectName: 'Statins & CVD',
      inviterName: 'Dr Smith',
      roleLabel: 'reviewer',
      link: 'https://app.test/invite/abc',
    });
    expect(html).toContain('Statins &amp; CVD');
    expect(html).not.toContain('Statins & CVD');
    expect(text).toContain('Statins & CVD');
    expect(text).toContain('Dr Smith');
  });

  it('renders a <script> variable INERT in html and verbatim in text', () => {
    const XSS = '<script>alert(1)</script>';
    const { html, text } = renderTemplate('contact.reply', {
      bodyText: XSS,
      greeting: `Hi ${XSS},`,
      refLine: `In reply to: ${XSS}`,
      signoff: XSS,
    });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(text).toContain(XSS); // the plain-text part is not markup
  });

  it('escapes an attribute-breaking link instead of letting it close the href', () => {
    const evil = 'https://app.test/x?t=a"><img src=y>';
    const { html } = renderTemplate('password.reset', { link: evil });
    expect(html).not.toContain('"><img src=y>');
    expect(html).toContain('&quot;');
    expect(html).not.toContain('<img');
  });

  it('turns URL and email values into anchors, other values into plain text', () => {
    const { html } = renderTemplate('welcome', { supportEmail: 'help@pecanrev.test' });
    expect(html).toContain('href="mailto:help@pecanrev.test"');

    const plain = renderTemplate('waitlist.confirmation', { siteLink: 'PecanRev' }).html;
    expect(plain).toContain('Visit PecanRev');
    expect(plain).not.toContain('href="PecanRev"');
  });

  it('applies **emphasis** from the registry copy but never from a value', () => {
    const { html, text } = renderTemplate('invite.projectMember', {
      link: 'https://app.test/i',
      projectName: '**not bold**',
      inviterName: 'Ann',
      roleLabel: 'lead',
    });
    expect(html).toContain('<strong>');
    expect(html).toContain('**not bold**'); // the value's markers stay literal
    expect(text).not.toContain('<strong>');
    expect(text).toContain('**not bold**');
  });

  it('leaves UNKNOWN tokens literal in both parts', () => {
    const { html, text } = renderTemplate('welcome', {}, {
      overrides: { bodyParagraphs: ['Known [appName], unknown [notAVariable].'] },
    });
    expect(html).toContain('unknown [notAVariable].');
    expect(text).toContain('unknown [notAVariable].');
    expect(html).toContain('Known PecanRev');
  });

  it('drops paragraphs whose declared tokens resolve to nothing', () => {
    const withExpiry = renderTemplate('password.reset', { link: 'https://a.test/r', expiresAtText: '1 May 2030, 10:00' });
    const without = renderTemplate('password.reset', { link: 'https://a.test/r' });
    expect(withExpiry.html).toContain('This link expires on 1 May 2030, 10:00');
    expect(without.html).not.toContain('This link expires on');
    expect(without.text).not.toContain('expires on');
  });

  it('selects the @if / @ifnot copy variant', () => {
    const operator = renderTemplate('password.reset', { link: 'https://a.test/r', initiatedByOperator: true });
    const self = renderTemplate('password.reset', { link: 'https://a.test/r', initiatedByOperator: false });
    expect(operator.text).toContain('administrator started a password reset');
    expect(operator.text).not.toContain('We received a request');
    expect(self.text).toContain('We received a request to reset the password');
    expect(self.text).not.toContain('administrator started');
  });

  it('renders the CTA only when both halves resolve, at the sentinel position', () => {
    const withCta = renderTemplate('welcome', { appBaseUrl: 'https://app.test' });
    expect(withCta.html).toContain('>Open PecanRev</a>');
    expect(withCta.text).toContain('Open PecanRev: https://app.test');

    const noCta = renderTemplate('welcome', {});
    expect(noCta.html).not.toContain('Open PecanRev</a>');
    // …and the CTA sits between the steps and the beta callout, not at the end.
    const ctaAt = withCta.text.indexOf('Open PecanRev: https://app.test');
    expect(ctaAt).toBeGreaterThan(withCta.text.indexOf('Bring in records'));
    expect(ctaAt).toBeLessThan(withCta.text.indexOf("You're on the beta."));
  });

  it('reports every missing REQUIRED variable and nothing else', () => {
    expect(renderTemplate('password.reset', {}).missingRequired).toEqual(['link']);
    expect(renderTemplate('password.reset', { link: '   ' }).missingRequired).toEqual(['link']);
    expect(renderTemplate('password.reset', { link: 'https://a.test/r' }).missingRequired).toEqual([]);
    // optional variables are never "missing"
    expect(renderTemplate('welcome', {}).missingRequired).toEqual([]);
    expect(renderTemplate('contact.reply', {}).missingRequired).toEqual(['bodyText']);
  });

  it('still renders a usable document when a required variable is missing', () => {
    const r = renderTemplate('email.verification', {});
    expect(r.missingRequired).toEqual(['link']);
    expect(r.html).toContain('Confirm your email');
    expect(r.html).not.toContain('[link]'); // declared-but-empty, not literal
  });

  it('returns a substituted plain-text subject', () => {
    expect(renderTemplate('password.changed', {}).subject).toBe('Your PecanRev password was changed');
    expect(renderTemplate('invite.projectMember', { link: 'x', inviterName: 'Ann', projectName: 'Trial A' }).subject)
      .toBe('Ann invited you to "Trial A" on PecanRev');
  });

  it('honours field overrides', () => {
    const r = renderTemplate('welcome', { appName: 'Acme' }, {
      overrides: { subject: 'Custom [appName] subject', heading: 'Custom heading', bodyParagraphs: ['One line.'], footerNote: '' },
    });
    expect(r.subject).toBe('Custom Acme subject');
    expect(r.html).toContain('Custom heading');
    expect(r.html).toContain('One line.');
    expect(r.html).not.toContain('Bring in records');
  });
});

describe('copy parity with the pre-registry templates', () => {
  // Three sentences lifted verbatim from the hand-written bodies that used to
  // live in emailService.js. If a registry edit ever silently rewrites the
  // product's voice, these fail.
  it('project invite keeps its collaboration sentence', () => {
    const { html, text } = renderTemplate('invite.projectMember', { link: 'https://a.test/i' });
    const sentence = 'Accept the invitation to start collaborating on screening, data extraction and analysis with the project team.';
    expect(html).toContain(sentence);
    expect(text).toContain(sentence);
  });

  it('waitlist confirmation keeps its not-an-account disclaimer', () => {
    const { html, text } = renderTemplate('waitlist.confirmation', {});
    const sentence = 'It does not create an account and is not a beta invitation — joining the waitlist does not guarantee immediate access.';
    expect(html).toContain(sentence);
    expect(text).toContain(sentence);
  });

  it('password-changed notice keeps its session-invalidation sentence', () => {
    const { text } = renderTemplate('password.changed', { whenText: '1 May 2030, 10:00' });
    expect(text).toContain('The password for your PecanRev account was changed on 1 May 2030, 10:00. All other signed-in sessions have been signed out.');
  });
});

describe('the invite email renders through the shared base layout', () => {
  it('produces exactly the base chrome around its body (no second inline document)', () => {
    process.env.APP_BASE_URL = 'https://app.test';
    const marker = '@@BODY@@';
    const chrome = renderBaseEmailLayout({ appName: 'PecanRev', bodyHtml: marker });
    const [prefix, suffix] = chrome.split(marker);

    const { html } = renderTemplate('invite.projectMember', {
      link: 'https://app.test/invite/abc',
      projectName: 'Trial A',
      inviterName: 'Dr Smith',
      roleLabel: 'reviewer',
    });

    expect(html.startsWith(prefix)).toBe(true);
    expect(html.endsWith(suffix)).toBe(true);
    // The duplicated document the invite used to carry would show up as a second
    // doctype / header / footer.
    expect(html.split('<!DOCTYPE html>').length - 1).toBe(1);
    expect(html.split('letter-spacing:0.04em').length - 1).toBe(1);
    expect(html).toContain(`&#169; ${new Date().getFullYear()} PecanRev`);
  });

  it('shares one CTA implementation with the other templates', () => {
    const invite = renderTemplate('invite.projectMember', { link: 'https://a.test/i' }).html;
    const reset = renderTemplate('password.reset', { link: 'https://a.test/i' }).html;
    const cta = (h) => h.slice(h.indexOf('border-radius:8px;background:#6366f1;'));
    expect(cta(invite).slice(0, 120)).toBe(cta(reset).slice(0, 120));
    expect(invite.split('background:#6366f1;').length - 1).toBe(1); // one button, not a clone
  });
});

describe('escapeHtml', () => {
  it('escapes every character that can break out of text or an attribute', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(escapeHtml(null)).toBe('');
  });
});
