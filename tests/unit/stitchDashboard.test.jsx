/**
 * stitchDashboard.test.jsx — SSR smoke test for the Stitch Command Center.
 * Mocks auth + router + the api client so the component renders its initial
 * (loading) state without a network. Guards against import/render regressions in
 * the flagship Stitch page and confirms the shell chrome mounts (Dashboard label).
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../src/frontend/context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Test Admin', email: 'a@b.co', role: 'admin' }, logout: () => {} }),
}));
vi.mock('../../src/frontend/theme/ThemeContext.jsx', () => ({
  useTheme: () => ({ theme: 'day', toggleTheme: () => {} }),
}));
vi.mock('../../src/frontend/design/DesignModeContext.jsx', () => ({
  useDesignMode: () => ({ mode: 'stitch', isStitch: true, isAdmin: true, setMode: () => {}, toggle: () => {} }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: '/app', search: '' }),
  useParams: () => ({}),
}));
vi.mock('../../src/frontend/api-client/apiClient.js', () => ({
  api: { projects: { list: () => new Promise(() => {}) } }, // never resolves → loading state
}));

const StitchDashboard = (await import('../../src/frontend/stitch/pages/StitchDashboard.jsx')).default;

describe('StitchDashboard (Command Center)', () => {
  it('renders the shell + command center header in its initial state', () => {
    const html = renderToStaticMarkup(h(StitchDashboard));
    expect(html).toContain('Command Center');
    expect(html).toContain('Dashboard'); // breadcrumb / rail label
    // shell chrome present
    expect(html).toContain('aria-label="Primary"');
    // it shows a loading state (api never resolves) — no fake data leaked
    expect(html.toLowerCase()).toContain('loading');
  });
});
