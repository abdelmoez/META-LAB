/**
 * 91.md — access-state component tests. SSR markup assertions (repo convention:
 * renderToStaticMarkup, no jsdom). Verifies the restricted states render the
 * specific message, an accessible reason (not just a lock icon), the current/required
 * role, a real next action, and the correct hide/inline/restrict behavior.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { deny, allow } from '../../../src/shared/access/index.js';
import AccessDeniedState from '../../../src/frontend/components/access/AccessDeniedState.jsx';
import RestrictedAction from '../../../src/frontend/components/access/RestrictedAction.jsx';
import PermissionGate from '../../../src/frontend/components/access/PermissionGate.jsx';
import LockedFeatureCard from '../../../src/frontend/components/access/LockedFeatureCard.jsx';

const denyDelete = deny('owner_only', { capability: 'deleteProject', currentRole: 'reviewer', requiredRole: 'owner', message: 'Only the project owner can delete this project.' });
const denyTier = deny('tier', { capability: 'wordExport', currentTier: 'free', requiredTier: 'professional', message: 'Word (.docx) export is not included in your current plan.' });

describe('AccessDeniedState', () => {
  it('renders the specific message, badge, role line and next action', () => {
    const html = renderToStaticMarkup(<AccessDeniedState decision={denyDelete} onAction={() => {}} />);
    expect(html).toContain('Only the project owner can delete this project.');
    expect(html).toContain('Owner only');            // badge
    expect(html).toContain('Reviewer');               // current role
    expect(html).toContain('Contact the project owner'); // next action (has onAction)
    expect(html).not.toContain('403');                // no raw status in the primary body
  });
  it('page variant is a centered restricted-route state', () => {
    const html = renderToStaticMarkup(<AccessDeniedState decision={denyDelete} variant="page" />);
    expect(html).toContain('Only the project owner can delete this project.');
  });
  it('renders nothing when allowed', () => {
    expect(renderToStaticMarkup(<AccessDeniedState decision={allow('x')} />)).toBe('');
  });
  it('shows technical detail only in a secondary <details>', () => {
    const d = deny('permission', { capability: 'screen', message: 'Ask a leader.', technical: 'HTTP 403' });
    const html = renderToStaticMarkup(<AccessDeniedState decision={d} />);
    expect(html).toContain('<details');
    expect(html).toContain('HTTP 403');
    expect(html.indexOf('Ask a leader.')).toBeLessThan(html.indexOf('HTTP 403')); // message before technical
  });
});

describe('RestrictedAction', () => {
  it('renders an aria-disabled, focusable, not-broken control with an accessible reason', () => {
    const html = renderToStaticMarkup(<RestrictedAction decision={denyDelete} label="Delete project" onExplain={() => {}} />);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Delete project');
    expect(html).toContain('data-restriction="owner_only"');
    expect(html).toContain('not-allowed');           // disabled cursor, not hidden
    expect(html).toContain('unavailable: Only the project owner'); // sr-only reason (not icon-only)
  });
  it('renders children unchanged when allowed', () => {
    const html = renderToStaticMarkup(<RestrictedAction decision={allow('x')}><button>Go</button></RestrictedAction>);
    expect(html).toBe('<button>Go</button>');
  });
});

describe('PermissionGate', () => {
  it('hide mode renders fallback (or nothing)', () => {
    expect(renderToStaticMarkup(<PermissionGate decision={denyDelete} mode="hide"><button>x</button></PermissionGate>)).toBe('');
  });
  it('inline mode renders the AccessDeniedState', () => {
    const html = renderToStaticMarkup(<PermissionGate decision={denyDelete} mode="inline" />);
    expect(html).toContain('Only the project owner can delete this project.');
  });
  it('restrict mode renders the locked action', () => {
    const html = renderToStaticMarkup(<PermissionGate decision={denyDelete} mode="restrict" label="Delete" />);
    expect(html).toContain('aria-disabled="true"');
  });
  it('resolves client-side from capability + ctx', () => {
    const html = renderToStaticMarkup(<PermissionGate capability="deleteProject" ctx={{ role: 'reviewer' }} mode="inline" />);
    expect(html).toContain('owner'); // resolved owner_only denial
  });
  it('allowed → children', () => {
    const html = renderToStaticMarkup(<PermissionGate capability="deleteProject" ctx={{ isOwner: true }}><button>Delete</button></PermissionGate>);
    expect(html).toBe('<button>Delete</button>');
  });
  it('loading → neutral skeleton, never the protected child', () => {
    const html = renderToStaticMarkup(<PermissionGate loading decision={allow('x')}><button>secret</button></PermissionGate>);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('secret');
  });
});

describe('LockedFeatureCard', () => {
  it('renders a tier upsell with the plan reason + action', () => {
    const html = renderToStaticMarkup(<LockedFeatureCard decision={denyTier} onAction={() => {}} />);
    expect(html).toContain('Word (.docx) export is not included');
    expect(html).toContain('View plans');
  });
});
