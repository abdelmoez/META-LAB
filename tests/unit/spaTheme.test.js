/**
 * spaTheme.test.js — server-side theme injection into index.html (prompt37
 * follow-up). Covers the pure buildThemeInjection: shape, hex-only palette
 * forwarding, default fallbacks, and the <script> escape (injection guard).
 */

import { describe, it, expect } from 'vitest';
import { buildThemeInjection } from '../../server/middleware/spaTheme.js';

const fullPalette = {
  day:   { acc: '#2563eb', acc2: '#1f54c8', accText: '#ffffff', accBg: '#e7eefc' },
  night: { acc: '#6ea0f5', acc2: '#5688ef', accText: '#0b1020', accBg: '#16213e' },
};

function parseGlobals(tag) {
  // Extract the two assignments from "<script>window.X=...;window.Y=...;</script>".
  const body = tag.replace(/^<script>/, '').replace(/<\/script>$/, '');
  const brand = JSON.parse(body.match(/window\.__METALAB_BRAND__=(.*?);window\./)[1]);
  const mode = JSON.parse(body.match(/window\.__METALAB_DEFAULT_THEME__=(.*?);$/)[1]);
  return { brand, mode };
}

describe('buildThemeInjection', () => {
  it('forwards a complete brand + mode', () => {
    const tag = buildThemeInjection(
      { brandColor: '#2563eb', preset: 'clinical', palette: fullPalette }, 'night');
    expect(tag.startsWith('<script>')).toBe(true);
    expect(tag.endsWith('</script>')).toBe(true);
    const { brand, mode } = parseGlobals(tag);
    expect(brand.brandColor).toBe('#2563eb');
    expect(brand.preset).toBe('clinical');
    expect(brand.palette.day.acc).toBe('#2563eb');
    expect(mode).toBe('night');
  });

  it('falls back to default indigo + day for empty/invalid settings', () => {
    const { brand, mode } = parseGlobals(buildThemeInjection({}, undefined));
    expect(brand.brandColor).toBe('#4f46e5');
    expect(brand.preset).toBe('default');
    expect(brand.palette).toBeNull();
    expect(mode).toBe('day');
  });

  it('drops a palette with any non-hex leaf (injection guard)', () => {
    const evil = JSON.parse(JSON.stringify(fullPalette));
    evil.day.acc = '#fff"; alert(1); var x="';
    const { brand } = parseGlobals(buildThemeInjection(
      { brandColor: '#2563eb', palette: evil }, 'day'));
    expect(brand.palette).toBeNull(); // whole palette rejected → default
  });

  it('escapes "<" so a value cannot close the script tag early', () => {
    const tag = buildThemeInjection({ brandColor: '#2563eb', preset: 'x</script><b>' }, 'day');
    // The raw "</script>" sequence must not appear inside the assignment.
    const body = tag.replace(/^<script>/, '').replace(/<\/script>$/, '');
    expect(body.includes('</script>')).toBe(false);
    expect(body.includes('\\u003c')).toBe(true);
  });

  it('coerces an unknown mode to day', () => {
    const { mode } = parseGlobals(buildThemeInjection({ brandColor: '#2563eb' }, 'rainbow'));
    expect(mode).toBe('day');
  });

  it('stamps a valid CSP nonce on the tag (prompt 51)', () => {
    const tag = buildThemeInjection({ brandColor: '#2563eb' }, 'day', 'AbCd_1234-EfGhIjKl');
    expect(tag.startsWith('<script nonce="AbCd_1234-EfGhIjKl">')).toBe(true);
    // globals still parse with the nonce attribute present
    const body = tag.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(body).toContain('window.__METALAB_BRAND__=');
  });

  it('ignores a malformed nonce (no attribute injection)', () => {
    const tag = buildThemeInjection({ brandColor: '#2563eb' }, 'day', 'evil" onload="x');
    expect(tag.startsWith('<script>')).toBe(true); // bad nonce dropped → bare tag
    expect(tag).not.toContain('onload');
  });
});
