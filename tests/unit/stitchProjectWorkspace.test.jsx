/**
 * stitchProjectWorkspace.test.jsx — SSR smoke for the native Stitch deep-tool
 * workspace (design3). Confirms a deep-tool stage (?tab=pico) mounts the shared
 * Stitch project shell (workflow rail) in its initial loading state without a
 * network and without crashing (lazy editor bodies are not pulled during loading).
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../src/frontend/context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Lee', email: 'l@b.co', role: 'admin' } }),
}));
vi.mock('../../src/frontend/theme/ThemeContext.jsx', () => ({ useTheme: () => ({ theme: 'day', toggleTheme: () => {} }) }));
vi.mock('../../src/frontend/design/DesignModeContext.jsx', () => ({
  useDesignMode: () => ({ mode: 'stitch', isStitch: true, isAdmin: true, setMode: () => {}, toggle: () => {} }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: '/app/project/p1', search: '?tab=pico' }),
  useParams: () => ({ projectId: 'p1' }),
}));
const never = () => new Promise(() => {});
vi.mock('../../src/frontend/api-client/apiClient.js', () => ({
  api: { projects: { get: never, autosave: never } },
}));

const StitchProjectWorkspace = (await import('../../src/frontend/stitch/pages/StitchProjectWorkspace.jsx')).default;

describe('StitchProjectWorkspace (SSR smoke)', () => {
  it('mounts the shared project shell for a native deep-tool stage', () => {
    const html = renderToStaticMarkup(h(StitchProjectWorkspace));
    expect(html).toContain('aria-label="Project workflow"'); // shared rail mounted
    expect(html.toLowerCase()).toContain('loading');          // honest loading state, no crash
  });
});
