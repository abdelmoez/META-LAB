/**
 * memberOrder.test.js (prompt22 Task 2) — the project members roster always reads
 * Owner → Leaders → Members → Viewers, each group sorted by name, split into
 * labelled sections. Owner is always first regardless of input order.
 */
import { describe, it, expect } from 'vitest';
import { groupMembers, groupRoleFor } from '../../src/frontend/screening/tabs/memberOrder.js';

const flat = (sections) => sections.flatMap(s => s.members);

describe('groupRoleFor', () => {
  it('detects owner/leader from flags OR role; defaults unknown to reviewer', () => {
    expect(groupRoleFor({ isOwner: true })).toBe('owner');
    expect(groupRoleFor({ role: 'owner' })).toBe('owner');
    expect(groupRoleFor({ isLeader: true })).toBe('leader');
    expect(groupRoleFor({ role: 'leader' })).toBe('leader');
    expect(groupRoleFor({ role: 'reviewer' })).toBe('reviewer');
    expect(groupRoleFor({ role: 'viewer' })).toBe('viewer');
    expect(groupRoleFor({})).toBe('reviewer'); // unknown → Members group
  });
});

describe('groupMembers — owner → leaders → members → viewers', () => {
  it('orders groups correctly regardless of input order', () => {
    const members = [
      { id: 1, role: 'viewer',   name: 'Zoe' },
      { id: 2, role: 'reviewer', name: 'Bob' },
      { id: 3, role: 'owner',    name: 'Olivia' },
      { id: 4, role: 'leader',   name: 'Liam' },
      { id: 5, role: 'reviewer', name: 'Ana' },
    ];
    const sections = groupMembers(members);
    expect(sections.map(s => s.label)).toEqual(['Owner', 'Leaders', 'Members', 'Viewers']);
    // Owner is always first.
    expect(flat(sections)[0].role).toBe('owner');
    // Members group is alphabetical by name (Ana before Bob).
    const membersSection = sections.find(s => s.label === 'Members');
    expect(membersSection.members.map(m => m.name)).toEqual(['Ana', 'Bob']);
  });

  it('omits absent groups and keeps a single owner first', () => {
    const sections = groupMembers([
      { id: 1, role: 'reviewer', name: 'Bob' },
      { id: 2, isOwner: true, name: 'Olivia' },
      { id: 3, role: 'reviewer', name: 'Ana' },
    ]);
    expect(sections.map(s => s.label)).toEqual(['Owner', 'Members']);
    expect(sections[0].members).toHaveLength(1);
    expect(sections[0].members[0].name).toBe('Olivia');
  });

  it('every member appears exactly once', () => {
    const members = Array.from({ length: 12 }, (_, i) => ({
      id: i,
      role: ['owner', 'leader', 'reviewer', 'viewer'][i % 4],
      name: `User ${String.fromCharCode(90 - i)}`,
    }));
    expect(flat(groupMembers(members))).toHaveLength(12);
  });

  it('falls back gracefully on empty / nullish input', () => {
    expect(groupMembers([])).toEqual([]);
    expect(groupMembers(undefined)).toEqual([]);
  });
});
