/**
 * stitchPagesWave1.test.jsx — SSR smoke tests for the agent-built Stitch pages
 * (Project Overview + Ops Console). Mocks auth/router/theme/design + the data
 * layer so each renders its initial state without a network — guarding against
 * import/render regressions and confirming the shell chrome mounts.
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
  screeningApi: { listMembers: never, summary: never, getProject: never },
}));
vi.mock('../../src/frontend/pages/admin/adminApiClient.js', () => ({
  adminApi: new Proxy({}, { get: () => never }),
  fetchVersion: never,
  publicSettings: never,
}));

const StitchProjectOverview = (await import('../../src/frontend/stitch/pages/StitchProjectOverview.jsx')).default;
const StitchOpsConsole = (await import('../../src/frontend/stitch/pages/StitchOpsConsole.jsx')).default;

describe('StitchProjectOverview (SSR smoke)', () => {
  it('renders the shell without crashing in its initial state', () => {
    const html = renderToStaticMarkup(h(StitchProjectOverview));
    expect(html).toContain('aria-label="Primary"'); // shell primary rail mounted
    expect(html.length).toBeGreaterThan(200);
  });
});

describe('StitchOpsConsole (SSR smoke)', () => {
  it('renders the shell without crashing in its initial state', () => {
    const html = renderToStaticMarkup(h(StitchOpsConsole));
    expect(html).toContain('aria-label="Primary"');
    expect(html.length).toBeGreaterThan(200);
  });
});
