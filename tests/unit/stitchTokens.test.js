/**
 * stitchTokens.test.js — the Stitch design tokens + scoped-CSS generation.
 *
 * The critical invariant for legacy protection: EVERY selector the Stitch
 * stylesheet emits must be rooted under html[data-ui-design="stitch"] so it can
 * never affect the legacy UI. We also check the design.md reference values made
 * it into the tokens, and that the `S` accessor returns var() strings.
 */
import { describe, it, expect } from 'vitest';
import {
  S, STITCH_LIGHT, STITCH_DARK, STITCH_SHAPE, buildStitchCss, salpha,
} from '../../src/frontend/stitch/theme/stitchTokens.js';

describe('Stitch tokens', () => {
  it('carries the design.md reference identity values', () => {
    expect(STITCH_LIGHT.surface).toBe('#f7f9ff');
    expect(STITCH_LIGHT.card).toBe('#ffffff');
    expect(STITCH_LIGHT.brand).toBe('#5d509b');
    expect(STITCH_LIGHT.success).toBe('#016e1c');
    expect(STITCH_LIGHT.danger).toBe('#ba1a1a');
    expect(STITCH_LIGHT.textPrimary).toBe('#181c21');
    expect(STITCH_LIGHT.textSecondary).toBe('#464555');
  });
  it('defines the reference spacing (72px rail, 280px context, 24px gutter, 20px pad)', () => {
    expect(STITCH_SHAPE.railPrimary).toBe('72px');
    expect(STITCH_SHAPE.railContext).toBe('280px');
    expect(STITCH_SHAPE.gutter).toBe('24px');
    expect(STITCH_SHAPE.cardPad).toBe('20px');
  });
  it('has a dark variant for every light token (night-mode parity)', () => {
    for (const k of Object.keys(STITCH_LIGHT)) {
      expect(STITCH_DARK[k], `dark token ${k}`).toBeTruthy();
    }
  });
  it('S accessor returns theme-aware var() strings', () => {
    expect(S.brand).toBe('var(--stitch-brand)');
    expect(S.surface).toBe('var(--stitch-surface)');
    expect(S.textPrimary).toBe('var(--stitch-text-primary)');
  });
});

describe('salpha', () => {
  it('emits color-mix for var() colors and hex passthrough for hex', () => {
    expect(salpha('var(--stitch-brand)', 0.3)).toBe('color-mix(in srgb, var(--stitch-brand) 30%, transparent)');
    expect(salpha('#5d509b', 0.5)).toBe('#5d509b80');
  });
});

describe('buildStitchCss — legacy-protection scoping', () => {
  const css = buildStitchCss();

  it('roots EVERY rule under html[data-ui-design="stitch"] (no bare global selectors)', () => {
    // Strip @keyframes (one level of nested {from/to} blocks) and @media openers
    // — their inner selectors are themselves scoped — then assert every remaining
    // rule opener references the design-mode root.
    const withoutAtRules = css
      .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '')
      .replace(/@media[^{]+\{/g, '');
    const ruleOpeners = withoutAtRules.match(/[^{}]+\{/g) || [];
    const offenders = ruleOpeners
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('}'))
      .filter((sel) => !sel.includes('[data-ui-design="stitch"]'));
    expect(offenders).toEqual([]);
  });

  it('defines both day and night palettes scoped to the stitch root', () => {
    expect(css).toContain('html[data-ui-design="stitch"]:not([data-theme="night"])');
    expect(css).toContain('html[data-ui-design="stitch"][data-theme="night"]');
  });

  it('re-maps legacy --t-* tokens (so embedded shared widgets harmonize)', () => {
    expect(css).toContain('--t-acc:');
    expect(css).toContain('--t-bg:');
    expect(css).toContain('--stitch-brand:');
  });
});
