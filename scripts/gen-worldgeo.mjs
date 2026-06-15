// One-shot generator for the Ops world-map geometry asset (prompt20 Task 6).
// Fetches Natural Earth 110m country polygons (already-decoded GeoJSON with ISO
// codes), projects them to a fixed equirectangular 1000x500 viewBox, rounds the
// coordinates, and emits compact SVG path `d` strings keyed by ISO-3166 alpha-2.
// No runtime map library — the React component just renders these <path>s.
import { writeFileSync } from 'node:fs';

const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const W = 1000, H = 500;
const px = (lon) => +(((lon + 180) / 360) * W).toFixed(1);
const py = (lat) => +(((90 - lat) / 180) * H).toFixed(1);

const valid2 = (c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c);
function ringToPath(ring) {
  let d = '';
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    d += (i === 0 ? 'M' : 'L') + px(lon) + ' ' + py(lat);
  }
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
 * Source: Natural Earth 1:110m admin-0 countries (public domain), projected to a
 * fixed equirectangular ${W}x${H} viewBox and rounded to 1 decimal. Each entry:
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
console.log(`wrote ${features.length} features (${withCode} with ISO a2), ~${Math.round(bytes/1024)}KB`);
const us = features.find(f => f.a2 === 'US');
const fr = features.find(f => f.a2 === 'FR');
console.log('US present:', !!us, us && us.name);
console.log('FR present:', !!fr, fr && fr.name);
