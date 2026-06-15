// One-shot generator for the Ops world-map geometry asset (prompt20 Task 6,
// upgraded to 1:50m for small-nation coverage).
//
// Fetches Natural Earth 1:50m admin-0 country polygons (already-decoded GeoJSON
// with ISO codes), projects them to a fixed equirectangular 1000x500 viewBox,
// rounds to 1 decimal, then Douglas-Peucker–simplifies the big coastlines (with
// a fallback that NEVER drops a small nation) so the asset stays lean (~265KB,
// vs ~1.1MB unsimplified) while still rendering every country — including the
// micro-states 1:110m omits (Singapore, Hong Kong, Malta, Bahrain, Maldives…).
// Emits compact SVG path `d` strings keyed by ISO-3166 alpha-2. No runtime map
// library — the React component just renders these <path>s.
//
// Regenerate with: node scripts/gen-worldgeo.mjs  (run from the repo root).
import { writeFileSync } from 'node:fs';

const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const W = 1000, H = 500;
const EPS = 0.25; // DP tolerance in viewBox units (~0.15px at the ops render size)
const X = (lon) => +(((lon + 180) / 360) * W).toFixed(1);
const Y = (lat) => +(((90 - lat) / 180) * H).toFixed(1);
const valid2 = (c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c);

// Iterative Douglas-Peucker on an OPEN polyline of [x,y] points (no recursion →
// safe for the dense 50m rings). Keeps endpoints; drops points within EPS of the
// running chord.
function dp(pts, eps) {
  const n = pts.length;
  if (n < 3) return pts;
  const keep = new Uint8Array(n); keep[0] = 1; keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = pts[s], [bx, by] = pts[e];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    let dmax = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [pxv, pyv] = pts[i];
      const d = Math.abs((pxv - ax) * dy - (pyv - ay) * dx) / len;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (idx !== -1 && dmax > eps) { keep[idx] = 1; stack.push([s, idx]); stack.push([idx, e]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

function ringToPath(ring) {
  // Project + round, then collapse consecutive duplicate pixels.
  const dd = [];
  for (const [lon, lat] of ring) {
    const p = [X(lon), Y(lat)];
    const l = dd[dd.length - 1];
    if (!l || l[0] !== p[0] || l[1] !== p[1]) dd.push(p);
  }
  // Drop the closing duplicate so DP runs on an open polyline.
  if (dd.length > 1 && dd[0][0] === dd[dd.length - 1][0] && dd[0][1] === dd[dd.length - 1][1]) dd.pop();
  if (dd.length < 3) return ''; // genuinely sub-pixel ring
  // Simplify large rings; if simplification would collapse a small ring, keep it.
  let s = dp(dd, EPS);
  if (s.length < 3) s = dd;
  let d = '';
  for (let i = 0; i < s.length; i++) d += (i === 0 ? 'M' : 'L') + s[i][0] + ' ' + s[i][1];
  return d + 'Z';
}
function geomToPath(geom) {
  if (!geom) return '';
  if (geom.type === 'Polygon') return geom.coordinates.map(ringToPath).join('');
  if (geom.type === 'MultiPolygon') return geom.coordinates.map(poly => poly.map(ringToPath).join('')).join('');
  return '';
}

const res = await fetch(SRC);
if (!res.ok) throw new Error('fetch failed ' + res.status);
const gj = await res.json();

const features = [];
for (const f of gj.features) {
  const p = f.properties || {};
  // Natural Earth marks disputed/unrecognised entities ISO_A2 = "-99"; the
  // *_EH (de-facto) field carries the practical code (e.g. France FR, Norway NO).
  let a2 = null;
  if (valid2(p.ISO_A2_EH)) a2 = p.ISO_A2_EH;
  else if (valid2(p.ISO_A2)) a2 = p.ISO_A2;
  const name = p.NAME_EN || p.ADMIN || p.NAME || (a2 || '');
  const d = geomToPath(f.geometry);
  if (!d) continue;
  features.push({ a2: a2 ? a2.toUpperCase() : null, name, d });
}

// Stable order: named A2 first (for predictable rendering), then the rest.
features.sort((a, b) => (a.a2 || 'ZZ').localeCompare(b.a2 || 'ZZ') || a.name.localeCompare(b.name));

const banner = `/**
 * worldGeo.js — pre-projected world-country geometry for the Ops users map (prompt20 Task 6).
 *
 * Source: Natural Earth 1:50m admin-0 countries (public domain), projected to a
 * fixed equirectangular ${W}x${H} viewBox, rounded to 1 decimal and Douglas-Peucker
 * simplified (small nations preserved). Each entry:
 *   { a2: ISO-3166 alpha-2 (uppercase) | null, name: English name, d: SVG path }
 * Regenerate with: node scripts/gen-worldgeo.mjs  (run from the repo root).
 * No runtime map dependency — the React component just renders these paths.
 */
export const WORLD_VIEWBOX = { w: ${W}, h: ${H} };
export const WORLD_COUNTRIES = `;

writeFileSync(
  new URL('../src/frontend/pages/admin/worldGeo.js', import.meta.url),
  banner + JSON.stringify(features) + ';\n',
);
const withCode = features.filter(f => f.a2).length;
const bytes = Buffer.byteLength(JSON.stringify(features));
console.log(`wrote ${features.length} features (${withCode} with ISO a2), ~${Math.round(bytes / 1024)}KB`);
for (const code of ['US', 'FR', 'SG', 'HK', 'MT', 'BH', 'MV']) {
  console.log(`${code}:`, features.some(f => f.a2 === code) ? 'present' : 'MISSING');
}
