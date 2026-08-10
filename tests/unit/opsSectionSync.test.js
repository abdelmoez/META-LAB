/**
 * opsSectionSync.test.js — 109.md §9 — the drift gate nobody had.
 *
 * An Ops section id must exist in FOUR places at once:
 *   1. server getConsole()  — the AUTHORITY (AdminConsole replaces its `allowed`
 *      set with this array, so a section missing here is invisible even to an admin)
 *   2. NAV_SECTIONS         — the sidebar registry (src/frontend/pages/admin/opsSections.js)
 *   3. the `sections` id → element map in AdminConsole.jsx (a nav button whose id
 *      is not in the map renders nothing)
 *   4. OPS_SECTION_IDS in e2e/page-objects/OpsPage.ts (the e2e "every section
 *      reachable" loop)
 *
 * Before 109 nothing checked any of that, which is exactly how you ship a dead
 * section. (3) and (4) are read as source text — importing AdminConsole.jsx would
 * drag React Router + the auth/theme contexts into a unit test, and importing the
 * page object would pull in @playwright/test; the adminVisibility.test.js
 * source-scanning precedent applies.
 */
import { restoreShellEnv } from '../screening/helpers/prismaEnvGuard.js'; // FIRST import
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_SECTIONS, MOD_SECTIONS, roleSections } from '../../src/frontend/pages/admin/opsSections.js';
import { getConsole } from '../../server/controllers/adminController.js';

restoreShellEnv();

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const read = (...parts) => readFileSync(resolve(ROOT, ...parts), 'utf8');

/** Call the real handler with a stub req/res and return the JSON body. */
async function consoleFor(role) {
  let body = null;
  const res = { json: (b) => { body = b; return res; }, status: () => res };
  await getConsole({ user: { id: 'u1', role } }, res);
  return body;
}

/** The keys of AdminConsole's `const sections = { … }` id → element map. */
function adminConsoleSectionMapKeys() {
  const src = read('src', 'frontend', 'pages', 'admin', 'AdminConsole.jsx');
  const start = src.indexOf('const sections = {');
  expect(start, 'AdminConsole.jsx must declare `const sections = {`').toBeGreaterThan(-1);
  // The map is a flat object literal of `id: <Element />,` lines; stop at the line
  // that closes it at the same indentation.
  const end = src.indexOf('\n  };', start);
  expect(end).toBeGreaterThan(start);
  const block = src.slice(start, end);
  return [...block.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):\s/gm)].map((m) => m[1]);
}

/** OPS_SECTION_IDS from the Playwright page object, read as text. */
function opsPageSectionIds() {
  const src = read('e2e', 'page-objects', 'OpsPage.ts');
  const m = src.match(/export const OPS_SECTION_IDS = \[([\s\S]*?)\] as const;/);
  expect(m, 'OpsPage.ts must declare OPS_SECTION_IDS').toBeTruthy();
  return [...m[1].matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((x) => x[1]);
}

const navIds = NAV_SECTIONS.map((s) => s.id);

describe('Ops section registry — internal consistency', () => {
  it('NAV_SECTIONS ids are unique and every entry has a label + icon', () => {
    expect(new Set(navIds).size).toBe(navIds.length);
    for (const s of NAV_SECTIONS) {
      expect(typeof s.label, `${s.id} label`).toBe('string');
      expect(s.label.length).toBeGreaterThan(0);
      expect(typeof s.icon, `${s.id} icon`).toBe('string');
    }
  });

  it('every NAV_SECTIONS icon exists in the icon set', () => {
    const icons = read('src', 'frontend', 'components', 'icons.jsx');
    for (const s of NAV_SECTIONS) {
      expect(new RegExp(`^\\s{2}${s.icon}:`, 'm').test(icons), `icon "${s.icon}" (section ${s.id}) must exist in icons.jsx`).toBe(true);
    }
  });

  it('the 109 research section is registered in the sidebar', () => {
    expect(navIds).toContain('research');
    expect(NAV_SECTIONS.find((s) => s.id === 'research').label).toBe('Research Governance');
  });

  it('roleSections() gives an admin every section and a mod the minimal set', () => {
    expect(roleSections('admin')).toEqual(navIds);
    expect(roleSections('mod')).toEqual(MOD_SECTIONS);
    expect(roleSections('user')).toEqual(MOD_SECTIONS); // fallback is never show-all
  });
});

describe('Ops section registry — server ↔ client ↔ e2e sync', () => {
  it('server getConsole(admin) and NAV_SECTIONS describe the SAME set of ids', async () => {
    const body = await consoleFor('admin');
    expect(Array.isArray(body.sections)).toBe(true);
    expect([...body.sections].sort()).toEqual([...navIds].sort());
  });

  it('server getConsole(mod) matches the client MOD_SECTIONS fallback', async () => {
    const body = await consoleFor('mod');
    expect([...body.sections].sort()).toEqual([...MOD_SECTIONS].sort());
  });

  it('a non-staff role gets no sections at all', async () => {
    const body = await consoleFor('user');
    expect(body.sections).toEqual([]);
  });

  it('AdminConsole mounts a component for every sidebar section (no dead nav button)', () => {
    const mapped = adminConsoleSectionMapKeys();
    for (const id of navIds) expect(mapped, `sections map is missing "${id}"`).toContain(id);
    // …and nothing in the map is unreachable from the sidebar.
    for (const id of mapped) expect(navIds, `sections map has orphan "${id}"`).toContain(id);
  });

  it('OpsPage.OPS_SECTION_IDS matches NAV_SECTIONS in order', () => {
    expect(opsPageSectionIds()).toEqual(navIds);
  });

  it('OpsPage.HEADINGS covers every section id', () => {
    const src = read('e2e', 'page-objects', 'OpsPage.ts');
    const block = src.slice(src.indexOf('HEADINGS: Record<OpsSectionId, RegExp> = {'));
    for (const id of navIds) {
      expect(new RegExp(`^\\s+${id}:`, 'm').test(block), `OpsPage HEADINGS is missing "${id}"`).toBe(true);
    }
  });
});
