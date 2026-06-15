/**
 * presenceIndicator.test.js — the ONE shared project-presence chip (prompt24
 * Tasks 2/3/8). Verifies the closed-state render contract with renderToStaticMarkup
 * (no jsdom, matching the repo convention). The popover is portaled + only mounts
 * on open, so the default closed render is a plain chip — perfect for SSR assertions.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PresenceIndicator from '../../src/frontend/screening/components/PresenceIndicator.jsx';

const render = (props) => renderToStaticMarkup(createElement(PresenceIndicator, props));

describe('PresenceIndicator (prompt24 — single shared project presence chip)', () => {
  it('renders nothing when nobody else is active (self-hides)', () => {
    expect(render({ users: [], totalMembers: 6 })).toBe('');
  });

  it('shows "active / total" when teammates are present', () => {
    const html = render({
      users: [{ userId: 'a', name: 'Ada' }, { userId: 'b', name: 'Bo' }],
      totalMembers: 6,
      myUserId: 'a',
    });
    expect(html).toContain('2 / 6');
  });

  it('exposes an accessible active-users label including the member total', () => {
    const html = render({ users: [{ userId: 'a', name: 'Ada' }], totalMembers: 4 });
    expect(html).toContain('aria-label="1 active of 4 members"');
  });

  it('omits the "/ total" when membership is unknown', () => {
    const html = render({ users: [{ userId: 'a', name: 'Ada' }] });
    expect(html).toContain('aria-label="1 active"');
    expect(html).not.toContain(' / ');
  });

  it('does not mount the popover until opened (default closed → no portal render)', () => {
    // The "Active now" header lives only inside the portaled popover; a closed
    // chip must never render it (and must never invoke createPortal during SSR).
    const html = render({ users: [{ userId: 'a', name: 'Ada' }], totalMembers: 2 });
    expect(html).not.toContain('Active now');
  });
});
