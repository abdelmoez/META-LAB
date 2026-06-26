/**
 * stitchPagesWave1.test.jsx — SSR smoke test for the agent-built Stitch Project
 * Overview page. Mocks auth/router/theme/design + the data layer so it renders its
 * initial state without a network — guarding against import/render regressions and
 * confirming the shell chrome mounts.
 *
 * (The Stitch Ops Console was removed — /ops is legacy-only — so its smoke test was
 * dropped with it.)
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../src/frontend/context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Admin', email: 'a@b.co', role: 'admin' }, logout: () => {}, refreshUser: () => {} }),
}));
vi.mock('../../src/frontend/theme/ThemeContext.jsx', () => ({ useTheme: () => ({ theme: 'day', toggleTheme: () => {} }) }));
vi.mock('../../src/frontend/design/DesignModeContext.jsx', () => ({
  useDesignMode: () => ({ mode: 'stitch', isStitch: true, isAdmin: true, setMode: () => {}, toggle: () => {} }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: '/app/project/p1', search: '' }),
  useParams: () => ({ projectId: 'p1' }),
}));
const never = () => new Promise(() => {});
vi.mock('../../src/frontend/api-client/apiClient.js', () => ({
  api: { projects: { get: never, list: never }, studies: { list: never }, exportProject: never },
}));
vi.mock('../../src/frontend/screening/api-client/screeningApi.js', () => ({
  screeningApi: { listMembers: never, getOverview: never, getProject: never },
}));
vi.mock('../../src/frontend/pages/admin/adminApiClient.js', () => ({
  adminApi: new Proxy({}, { get: () => never }),
  fetchVersion: never,
  publicSettings: never,
}));

const StitchProjectOverview = (await import('../../src/frontend/stitch/pages/StitchProjectOverview.jsx')).default;

describe('StitchProjectOverview (SSR smoke)', () => {
  it('renders the shell without crashing in its initial state', () => {
    const html = renderToStaticMarkup(h(StitchProjectOverview));
    expect(html).toContain('aria-label="Project workflow"'); // project workflow rail mounted
    expect(html.length).toBeGreaterThan(200);
  });
});
