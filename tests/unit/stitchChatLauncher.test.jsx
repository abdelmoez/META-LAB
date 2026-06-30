/**
 * stitchChatLauncher.test.jsx — the Stitch header chat launcher.
 *
 * Two layers, both DOM-free (this repo's vitest runs in node; the existing Stitch
 * suite uses renderToStaticMarkup):
 *   1. deriveChatLauncherState — the pure enabled/greyed decision (the heart of the
 *      feature: "greyed + unclickable when restricted by a leader or owner").
 *   2. An SSR render smoke for the no-project state: greyed, aria-disabled, the
 *      accessible name explains why, and NO chat drawer/composer is mounted.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StitchChatLauncher, { deriveChatLauncherState } from '../../src/frontend/components/chat/StitchChatLauncher.jsx';

const state = (over) => deriveChatLauncherState({
  projectId: 'mlp_1', status: 'linked', canChat: false, isLeader: false, projectName: 'Aspirin SR', ...over,
});

describe('deriveChatLauncherState — enabled vs greyed decision', () => {
  it('no project in context → greyed, "Open a project to use chat"', () => {
    const s = state({ projectId: null, status: 'idle' });
    expect(s.enabled).toBe(false);
    expect(s.disabledReason).toBe('Open a project to use chat');
    expect(s.tipLabel).toBe('Open a project to use chat');
  });

  it('no linked Screening workspace (probe 404) → greyed, "Link a Screening project…"', () => {
    const s = state({ status: 'unlinked' });
    expect(s.enabled).toBe(false);
    expect(s.disabledReason).toBe('Link a Screening project to enable chat');
  });

  it('restricted: project-wide chatRestricted with no canChat and not a leader → greyed', () => {
    const s = state({ status: 'linked', canChat: false, isLeader: false });
    expect(s.enabled).toBe(false);
    expect(s.disabledReason).toBe('Chat is restricted by a project owner or leader');
  });

  it('restricted: a member whose canChat was turned off by a leader → greyed', () => {
    // Same gate — canChat=false, not a leader — regardless of the project flag.
    const s = state({ status: 'linked', canChat: false, isLeader: false });
    expect(s.mayParticipate).toBe(false);
    expect(s.enabled).toBe(false);
  });

  it('may participate: a member WITH canChat → active, drawer-eligible', () => {
    const s = state({ status: 'linked', canChat: true, isLeader: false });
    expect(s.enabled).toBe(true);
    expect(s.tipLabel).toBe('Chat — Aspirin SR');
  });

  it('leader override: isLeader posts even when canChat is false (matches canWriteChat)', () => {
    const s = state({ status: 'linked', canChat: false, isLeader: true });
    expect(s.mayParticipate).toBe(true);
    expect(s.enabled).toBe(true);
  });

  it('while probing access, the icon stays inert (no clickable flash)', () => {
    const s = state({ status: 'probing', canChat: true, isLeader: true });
    expect(s.enabled).toBe(false);
    expect(s.tipLabel).toBe('Project chat');
  });

  it('active tip falls back to a neutral label when the project name is unknown', () => {
    const s = state({ status: 'linked', canChat: true, projectName: '' });
    expect(s.enabled).toBe(true);
    expect(s.tipLabel).toBe('Project chat');
  });
});

describe('StitchChatLauncher render (no project) ', () => {
  it('renders a greyed, aria-disabled button that explains itself and mounts no drawer', () => {
    const html = renderToStaticMarkup(h(StitchChatLauncher, { projectId: null }));
    expect(html).toContain('<button');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-label="Open a project to use chat"');
    expect(html).toContain('data-testid="stitch-chat-button"');
    // The ChatDrawer (and its composer) must NOT mount in a disabled state.
    expect(html).not.toContain('role="dialog"');
    expect(html.toLowerCase()).not.toContain('placeholder');
  });
});
