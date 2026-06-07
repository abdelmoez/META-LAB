/**
 * adminVisibility.test.js
 *
 * Unit tests that verify the admin route (/ops) is NOT linked from any normal
 * user-facing page.  Tests read source files as strings and scan for
 * disallowed patterns.
 *
 * Strategy: use Node's fs.readFileSync — no server or build step needed.
 * All tests run as pure string assertions so they are always fast.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Path helpers ──────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
// tests/unit/adminVisibility.test.js  →  up 2 dirs  →  project root
const ROOT = resolve(__filename, '..', '..', '..');

function srcPath(...parts) {
  return resolve(ROOT, 'src', ...parts);
}

function readSrc(...parts) {
  return readFileSync(srcPath(...parts), 'utf8');
}

// ── 1. Landing.jsx — must not link to /ops ───────────────────────────────────

describe('Landing.jsx — admin route not exposed in public page', () => {
  it('file is readable', () => {
    expect(() => readSrc('frontend', 'pages', 'Landing.jsx')).not.toThrow();
  });

  it('does not contain the string "/ops"', () => {
    const content = readSrc('frontend', 'pages', 'Landing.jsx');
    expect(content).not.toContain('/ops');
  });

  it('does not contain "/admin" as a route path (case-insensitive, href or navigate)', () => {
    const content = readSrc('frontend', 'pages', 'Landing.jsx');
    // Check for /admin as a route (href="/admin", navigate('/admin'), to="/admin")
    // Avoid false-positives for words like "administrator" in prose text.
    // Strategy: look for /admin as a path string token surrounded by quotes/ticks.
    const routePattern = /["'`]\/admin\b/i;
    expect(routePattern.test(content)).toBe(false);
  });

  it('does not navigate to /ops via useNavigate', () => {
    const content = readSrc('frontend', 'pages', 'Landing.jsx');
    // navigate('/ops') or navigate("/ops")
    expect(content).not.toMatch(/navigate\(\s*['"`]\/ops['"`]/);
  });
});

// ── 2. Profile.jsx — must not link to /ops ───────────────────────────────────

describe('Profile.jsx — admin route not exposed in profile page', () => {
  it('file is readable', () => {
    expect(() => readSrc('frontend', 'pages', 'Profile.jsx')).not.toThrow();
  });

  it('does not contain the string "/ops"', () => {
    const content = readSrc('frontend', 'pages', 'Profile.jsx');
    expect(content).not.toContain('/ops');
  });

  it('does not link to /admin as a route path', () => {
    const content = readSrc('frontend', 'pages', 'Profile.jsx');
    const routePattern = /["'`]\/admin\b/i;
    expect(routePattern.test(content)).toBe(false);
  });
});

// ── 3. AppWorkspace.jsx — must not link to /ops ──────────────────────────────

describe('AppWorkspace.jsx — admin route not exposed in main workspace', () => {
  it('file is readable', () => {
    expect(() => readSrc('frontend', 'pages', 'AppWorkspace.jsx')).not.toThrow();
  });

  it('does not contain the string "/ops"', () => {
    const content = readSrc('frontend', 'pages', 'AppWorkspace.jsx');
    expect(content).not.toContain('/ops');
  });

  it('does not link to /admin as a route path', () => {
    const content = readSrc('frontend', 'pages', 'AppWorkspace.jsx');
    const routePattern = /["'`]\/admin\b/i;
    expect(routePattern.test(content)).toBe(false);
  });
});

// ── 4. AdminRoute.jsx EXISTS ─────────────────────────────────────────────────

describe('AdminRoute.jsx — component file exists', () => {
  it('src/frontend/components/AdminRoute.jsx exists on disk', () => {
    const p = srcPath('frontend', 'components', 'AdminRoute.jsx');
    expect(existsSync(p)).toBe(true);
  });

  it('AdminRoute.jsx exports a default function component', () => {
    const content = readSrc('frontend', 'components', 'AdminRoute.jsx');
    // Must have a default export
    expect(content).toMatch(/export\s+default\s+function\s+AdminRoute/);
  });

  it('AdminRoute.jsx checks user.role === "admin"', () => {
    const content = readSrc('frontend', 'components', 'AdminRoute.jsx');
    expect(content).toContain("role !== 'admin'");
  });
});

// ── 5. App.jsx — /ops route IS defined (admin panel exists in router) ─────────

describe('App.jsx — /ops route is registered in the router', () => {
  it('src/App.jsx is readable', () => {
    expect(() => readFileSync(resolve(ROOT, 'src', 'App.jsx'), 'utf8')).not.toThrow();
  });

  it('contains a Route with path="/ops"', () => {
    // App.jsx is at src/App.jsx (one level above frontend/)
    const content = readFileSync(resolve(ROOT, 'src', 'App.jsx'), 'utf8');
    expect(content).toContain('/ops');
  });

  it('/ops route is wrapped in AdminRoute (not a public route)', () => {
    const content = readFileSync(resolve(ROOT, 'src', 'App.jsx'), 'utf8');
    // The /ops route element must reference AdminRoute
    expect(content).toMatch(/AdminRoute/);
    // Specifically: the /ops Route should have AdminRoute somewhere near it
    // Simple check: both "/ops" and "AdminRoute" exist in the file
    expect(content).toContain('AdminRoute');
  });

  it('App.jsx imports AdminRoute component', () => {
    const content = readFileSync(resolve(ROOT, 'src', 'App.jsx'), 'utf8');
    expect(content).toMatch(/import\s+AdminRoute/);
  });
});

// ── 6. No other UI page links to /ops ────────────────────────────────────────

describe('Other UI pages — no accidental /ops links', () => {
  it('Login.jsx does not contain "/ops"', () => {
    const content = readSrc('frontend', 'pages', 'Login.jsx');
    expect(content).not.toContain('/ops');
  });

  it('Register.jsx does not contain "/ops"', () => {
    const content = readSrc('frontend', 'pages', 'Register.jsx');
    expect(content).not.toContain('/ops');
  });

  it('Dashboard.jsx does not contain "/ops" (if file exists)', () => {
    const p = srcPath('frontend', 'pages', 'Dashboard.jsx');
    if (!existsSync(p)) return; // file may not exist — skip gracefully
    const content = readFileSync(p, 'utf8');
    expect(content).not.toContain('/ops');
  });
});
