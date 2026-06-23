/**
 * cspReport.test.js — CSP violation report sanitization (prompt 51).
 *
 * Proves the reporting endpoint never stores sensitive query parameters / user
 * data, redacts URLs, handles both wire formats and malformed input gracefully,
 * and classifies browser-extension noise.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeUrl,
  sanitizeCspReport,
  isExtensionNoise,
  cspReportHandler,
} from '../../../server/security/cspReport.js';

describe('sanitizeUrl', () => {
  it('strips query string, fragment and userinfo', () => {
    expect(sanitizeUrl('https://app.example.com/reset?token=SECRET&q=cancer#frag'))
      .toBe('https://app.example.com/reset');
    expect(sanitizeUrl('https://u:p@host/path?x=1')).toBe('https://host/path');
  });
  it('collapses data:/blob: URLs without leaking content', () => {
    expect(sanitizeUrl('data:image/png;base64,AAAAREALPAYLOAD')).toBe('data:');
    expect(sanitizeUrl('blob:https://app.example.com/uuid-123')).toBe('blob:');
  });
  it('keeps scheme-only sentinels', () => {
    expect(sanitizeUrl('inline')).toBe('inline');
    expect(sanitizeUrl('eval')).toBe('eval');
  });
  it('handles non-URL values', () => {
    expect(sanitizeUrl('')).toBe('');
    expect(sanitizeUrl(undefined)).toBe('');
    expect(sanitizeUrl('not a url?secret=1')).toBe('not a url');
  });
});

describe('sanitizeCspReport', () => {
  it('parses the legacy application/csp-report shape and drops script-sample', () => {
    const out = sanitizeCspReport({
      'csp-report': {
        'document-uri': 'https://app.example.com/login?next=/secret',
        'violated-directive': 'script-src',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.example/x.js?api_key=LEAK',
        'source-file': 'https://app.example.com/assets/a.js?v=1',
        'line-number': 12,
        'column-number': 5,
        disposition: 'report',
        'script-sample': 'const password = "hunter2"',
      },
    });
    expect(out.effectiveDirective).toBe('script-src-elem');
    expect(out.documentUri).toBe('https://app.example.com/login');
    expect(out.blockedUri).toBe('https://evil.example/x.js');
    expect(out.sourceFile).toBe('https://app.example.com/assets/a.js');
    expect(out.lineNumber).toBe(12);
    expect(out.columnNumber).toBe(5);
    // critically: no script-sample / raw query anywhere in the result
    expect(JSON.stringify(out)).not.toContain('hunter2');
    expect(JSON.stringify(out)).not.toContain('LEAK');
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('parses the modern Reporting API array shape', () => {
    const out = sanitizeCspReport([
      { type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://cdn.evil/x.png?u=1', documentURL: 'https://app/x' } },
    ]);
    expect(out.effectiveDirective).toBe('img-src');
    expect(out.blockedUri).toBe('https://cdn.evil/x.png');
  });

  it('returns null for unrecognizable / empty input', () => {
    expect(sanitizeCspReport(null)).toBeNull();
    expect(sanitizeCspReport({})).toBeNull();
    expect(sanitizeCspReport({ random: 'noise' })).toBeNull();
    expect(sanitizeCspReport('a string')).toBeNull();
  });
});

describe('isExtensionNoise', () => {
  it('flags extension-origin blocked URIs', () => {
    expect(isExtensionNoise('chrome-extension://abc/inject.js')).toBe(true);
    expect(isExtensionNoise('moz-extension://abc/x.js')).toBe(true);
    expect(isExtensionNoise('safari-web-extension://x')).toBe(true);
    expect(isExtensionNoise('https://app.example.com/x.js')).toBe(false);
  });
});

describe('cspReportHandler', () => {
  it('responds 204 and never throws on garbage', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const status = vi.fn().mockReturnThis();
    const end = vi.fn();
    cspReportHandler({ body: undefined }, { status, end });
    expect(status).toHaveBeenCalledWith(204);
    cspReportHandler({ body: { 'csp-report': { 'effective-directive': 'script-src', 'blocked-uri': 'inline' } } }, { status, end });
    expect(status).toHaveBeenCalledWith(204);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
