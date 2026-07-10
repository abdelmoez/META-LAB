/**
 * chatPolicy.test.js — 81.md. The ONE shared chat-access rule.
 *
 * canPostProjectChat is the exact gate the server enforces on every chat WRITE
 * route (screeningChatController.canWriteChat re-exports it) AND the gate the
 * client composer + all three launchers use, so client and server can never drift.
 * canAccessProjectChat governs READING (never restricted for a resolved member).
 */
import { describe, it, expect } from 'vitest';
import {
  canPostProjectChat, canAccessProjectChat, chatPostBlockReason,
  canPostChatFlat, chatPostBlockReasonFlat, chatBlockMessage,
} from '../../src/research-engine/screening/chatPolicy.js';
import { canWriteChat } from '../../server/controllers/screeningChatController.js';

const acc = (o) => ({ isLeader: false, canChat: false, active: true, project: { chatRestricted: false }, ...o });

describe('canPostProjectChat — leadership-lock write gate', () => {
  it('leaders/owner always post (even muted, even restricted)', () => {
    expect(canPostProjectChat(acc({ isLeader: true }))).toBe(true);
    expect(canPostProjectChat(acc({ isLeader: true, canChat: false, project: { chatRestricted: true } }))).toBe(true);
  });
  it('muted member (canChat=false) never posts', () => {
    expect(canPostProjectChat(acc({ canChat: false }))).toBe(false);
    expect(canPostProjectChat(acc({ canChat: false, project: { chatRestricted: true } }))).toBe(false);
  });
  it('open chat: a canChat member posts', () => {
    expect(canPostProjectChat(acc({ canChat: true }))).toBe(true);
  });
  it('restrict chat: a canChat member is read-only (the reported bug)', () => {
    expect(canPostProjectChat(acc({ canChat: true, project: { chatRestricted: true } }))).toBe(false);
  });
  it('null / missing project handled', () => {
    expect(canPostProjectChat(null)).toBe(false);
    expect(canPostProjectChat({ isLeader: false, canChat: true })).toBe(true); // no project ⇒ unrestricted
  });
});

describe('server canWriteChat delegates to the shared policy (no drift)', () => {
  const cases = [
    acc({ isLeader: true }),
    acc({ canChat: false }),
    acc({ canChat: true }),
    acc({ canChat: true, project: { chatRestricted: true } }),
    acc({ isLeader: true, canChat: false, project: { chatRestricted: true } }),
  ];
  it('returns identical verdicts to canPostProjectChat for every shape', () => {
    for (const a of cases) expect(canWriteChat(a)).toBe(canPostProjectChat(a));
    expect(canWriteChat(null)).toBe(canPostProjectChat(null));
  });
});

describe('canAccessProjectChat — reading is never restricted', () => {
  it('any resolved member reads, incl. muted + restricted', () => {
    expect(canAccessProjectChat(acc({ canChat: false, project: { chatRestricted: true } }))).toBe(true);
    expect(canAccessProjectChat(acc({ canChat: true }))).toBe(true);
    expect(canAccessProjectChat(acc({ isLeader: true }))).toBe(true);
  });
  it('inactive / no context cannot access', () => {
    expect(canAccessProjectChat(acc({ active: false }))).toBe(false);
    expect(canAccessProjectChat(null)).toBe(false);
  });
});

describe('chatPostBlockReason — honest UI copy', () => {
  it('classifies ok / restricted / muted / no-access', () => {
    expect(chatPostBlockReason(acc({ canChat: true }))).toBe('ok');
    expect(chatPostBlockReason(acc({ isLeader: true, project: { chatRestricted: true } }))).toBe('ok');
    expect(chatPostBlockReason(acc({ canChat: true, project: { chatRestricted: true } }))).toBe('restricted');
    expect(chatPostBlockReason(acc({ canChat: false }))).toBe('muted');
    expect(chatPostBlockReason(null)).toBe('no-access');
  });
  it('flat helpers agree with the nested rule', () => {
    expect(canPostChatFlat({ isLeader: false, canChat: true, chatRestricted: true })).toBe(false);
    expect(chatPostBlockReasonFlat({ isLeader: false, canChat: true, chatRestricted: true })).toBe('restricted');
    expect(chatPostBlockReasonFlat({ isLeader: false, canChat: false, chatRestricted: false })).toBe('muted');
  });
  it('flat helpers are null-safe and mirror the nested twins on nullish input', () => {
    for (const bad of [null, undefined]) {
      expect(canPostChatFlat(bad)).toBe(canPostProjectChat(null));          // false, no throw
      expect(chatPostBlockReasonFlat(bad)).toBe(chatPostBlockReason(null)); // 'no-access', no throw
    }
  });
  it('chatBlockMessage gives distinct, non-empty copy for restricted vs muted', () => {
    expect(chatBlockMessage('restricted')).toMatch(/restrict/i);
    expect(chatBlockMessage('muted')).toMatch(/turned off/i);
    expect(chatBlockMessage('restricted')).not.toBe(chatBlockMessage('muted'));
    expect(chatBlockMessage('ok')).toBe('');
  });
});
