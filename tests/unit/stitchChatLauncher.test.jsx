/**
 * stitchChatLauncher.test.jsx — the Stitch header chat launcher (81.md model).
 *
 * READ-ONLY model: reading is never restricted, so any linked member's icon is
 * ENABLED (opens the drawer to read). "Restrict chat" and a per-member mute remove
 * POSTING only — surfaced as `readOnly`/`canPost` on an ENABLED launcher (composer +
 * server enforce), NOT by greying the icon. The icon greys ONLY when there is nothing
 * to open (no project / probing / probe error / no linked workspace).
 *
 * Two layers, both DOM-free (this repo's vitest runs in node; the Stitch suite uses
 * renderToStaticMarkup):
 *   1. deriveChatLauncherState — the pure enabled/greyed + read-only decision, now
 *      driven by the shared chatPolicy gate (the SAME rule the server enforces).
 *   2. An SSR render smoke for the no-project state.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StitchChatLauncher, { deriveChatLauncherState } from '../../src/frontend/components/chat/StitchChatLauncher.jsx';

const state = (over) => deriveChatLauncherState({
  projectId: 'mlp_1', status: 'linked', canChat: false, isLeader: false, isOwner: false, chatRestricted: false, projectName: 'Aspirin SR', ...over,
});

describe('deriveChatLauncherState — enabled/greyed + read-only decision (81.md)', () => {
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

  it('open chat, member WITH canChat → ENABLED, writable (canPost)', () => {
    const s = state({ status: 'linked', canChat: true, isLeader: false });
    expect(s.enabled).toBe(true);
    expect(s.canPost).toBe(true);
    expect(s.readOnly).toBe(false);
    expect(s.tipLabel).toBe('Chat — Aspirin SR');
  });

  it('project-wide "Restrict chat" ON + member has canChat, not a leader → ENABLED but READ-ONLY (was the untested gap)', () => {
    // The exact reported case: chatRestricted flips a canChat member to read-only.
    const s = state({ status: 'linked', canChat: true, isLeader: false, chatRestricted: true });
    expect(s.enabled).toBe(true);          // reading is never restricted — icon opens
    expect(s.canPost).toBe(false);         // …but posting is blocked (matches server canWriteChat)
    expect(s.readOnly).toBe(true);
    expect(s.blockReason).toBe('restricted');
    expect(s.tipLabel).toBe('Chat — Aspirin SR · read-only');
  });

  it('per-member mute (canChat=false, not a leader) → ENABLED but READ-ONLY, reason "muted"', () => {
    const s = state({ status: 'linked', canChat: false, isLeader: false });
    expect(s.enabled).toBe(true);
    expect(s.canPost).toBe(false);
    expect(s.readOnly).toBe(true);
    expect(s.blockReason).toBe('muted');
  });

  it('81.md v2 owner-only: the OWNER still posts when restricted', () => {
    const s = state({ status: 'linked', isOwner: true, isLeader: true, canChat: true, chatRestricted: true });
    expect(s.canPost).toBe(true);
    expect(s.enabled).toBe(true);
    expect(s.readOnly).toBe(false);
    expect(s.tipLabel).toBe('Chat — Aspirin SR');
  });

  it('81.md v2 owner-only: a non-owner LEADER is now READ-ONLY when restricted (was writable pre-v2)', () => {
    const s = state({ status: 'linked', isOwner: false, isLeader: true, canChat: true, chatRestricted: true });
    expect(s.canPost).toBe(false);
    expect(s.enabled).toBe(true);
    expect(s.readOnly).toBe(true);
    expect(s.blockReason).toBe('restricted');
    expect(s.tipLabel).toBe('Chat — Aspirin SR · read-only');
  });

  it('a leader posts normally when chat is OPEN (restriction off)', () => {
    const s = state({ status: 'linked', isLeader: true, canChat: false });
    expect(s.canPost).toBe(true);
    expect(s.readOnly).toBe(false);
  });

  it('while probing access, the icon stays inert (no clickable flash)', () => {
    const s = state({ status: 'probing', canChat: true, isLeader: true });
    expect(s.enabled).toBe(false);
    expect(s.tipLabel).toBe('Project chat');
  });

  it('a failed access probe (non-404 error) is greyed but NOT blamed on a person', () => {
    const s = state({ status: 'error', canChat: false, isLeader: false });
    expect(s.enabled).toBe(false);
    expect(s.disabledReason).toBe('Chat is unavailable right now');
    expect(s.disabledReason).not.toBe('Chat is restricted by a project owner or leader');
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
