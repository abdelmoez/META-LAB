/**
 * worldGeo.test.js (prompt20 Task 6) — integrity of the pre-projected world
 * country geometry that backs the Ops users-by-country choropleth. If this asset
 * regenerates wrong (missing countries, bad ISO codes, malformed paths), the map
 * silently breaks — so pin the shape down.
 */
import { describe, it, expect } from 'vitest';
import { WORLD_COUNTRIES, WORLD_VIEWBOX } from '../../src/frontend/pages/admin/worldGeo.js';

describe('worldGeo asset', () => {
  it('uses the fixed 1000x500 equirectangular viewBox', () => {
    expect(WORLD_VIEWBOX).toEqual({ w: 1000, h: 500 });
  });

  it('renders a full set of country polygons', () => {
    expect(Array.isArray(WORLD_COUNTRIES)).toBe(true);
    // Natural Earth 110m has ~170+ admin-0 features.
    expect(WORLD_COUNTRIES.length).toBeGreaterThan(150);
  });

  it('every feature has a valid SVG path and a 2-letter ISO code or null', () => {
    for (const f of WORLD_COUNTRIES) {
      expect(typeof f.d).toBe('string');
      expect(f.d.startsWith('M')).toBe(true);   // path must begin with a moveto
      expect(typeof f.name).toBe('string');
      if (f.a2 !== null) expect(f.a2).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('includes well-known countries keyed by ISO alpha-2 (the join key)', () => {
    const byCode = Object.fromEntries(WORLD_COUNTRIES.filter(f => f.a2).map(f => [f.a2, f]));
    for (const code of ['US', 'FR', 'BR', 'CN', 'IN', 'ZA', 'AU']) {
      expect(byCode[code], `expected geometry for ${code}`).toBeTruthy();
    }
  });

  it('keeps the asset lean (no runtime map dependency)', () => {
    // Sanity ceiling — a blown-up asset usually means rounding/simplification broke.
    expect(JSON.stringify(WORLD_COUNTRIES).length).toBeLessThan(400_000);
  });
});
