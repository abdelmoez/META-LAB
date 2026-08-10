/**
 * opsAuditActions.test.js — 109.md §§23, 42.
 *
 * Every audit action the Ops control plane writes must be REGISTERED in
 * src/shared/auditFormat.js. An unregistered string still stores fine, but it
 * renders as a humanised INFO label and is invisible to the Security tab's
 * severity filter — so the registration is the test, not an implementation
 * detail. These cases also pin the from→to rendering the new settings writers
 * depend on, and prove the pre-109 details shape (key names only) still renders.
 */
import { describe, it, expect } from 'vitest';
import {
  AUDIT_ACTIONS, SEVERITY_ORDER, describeAuditEvent, extractChanges,
  auditActionWhereForSeverity,
} from '../../src/shared/auditFormat.js';

const NEW_ACTIONS = [
  'UPDATE_FEATURE_FLAG',
  'UPDATE_FEATURE_FLAGS',
  'UPDATE_RESEARCH_GOVERNANCE',
  'RESET_SETTINGS_GROUP',
  'DUPLICATE_JOB_REQUEUE',
  'DUPLICATE_JOB_RERUN',
  'DUPLICATE_JOB_CANCEL',
  'DESIGN_SETTINGS_UPDATED',
];

describe('109 Ops audit actions are registered', () => {
  it.each(NEW_ACTIONS)('%s has a static severity, category, label and describe()', (action) => {
    const meta = AUDIT_ACTIONS[action];
    expect(meta).toBeTruthy();
    expect(SEVERITY_ORDER).toContain(meta.severity);
    expect(typeof meta.category).toBe('string');
    expect(typeof meta.label).toBe('string');
    expect(typeof meta.describe).toBe('function');
  });

  it('flag flips and config resets are HIGH severity (they change what users can do)', () => {
    for (const a of ['UPDATE_FEATURE_FLAG', 'UPDATE_FEATURE_FLAGS', 'RESET_SETTINGS_GROUP', 'DUPLICATE_JOB_RERUN']) {
      expect(AUDIT_ACTIONS[a].severity, a).toBe('high');
    }
  });

  it('the severity filter reaches the new actions (they are not stranded in INFO)', () => {
    const high = auditActionWhereForSeverity('high').in;
    expect(high).toContain('UPDATE_FEATURE_FLAG');
    expect(high).toContain('RESET_SETTINGS_GROUP');
    const medium = auditActionWhereForSeverity('medium').in;
    expect(medium).toContain('UPDATE_RESEARCH_GOVERNANCE');
    expect(medium).toContain('DUPLICATE_JOB_REQUEUE');
    // INFO is the "everything uncatalogued" bucket, so the new actions must be excluded.
    expect(auditActionWhereForSeverity('info').notIn).toContain('UPDATE_FEATURE_FLAG');
  });
});

describe('rendering the 109 settings-writer details shape', () => {
  const flagLog = {
    action: 'UPDATE_FEATURE_FLAG',
    entityType: 'SiteSetting',
    entityId: 'projectUndoRedo',
    admin: { name: 'Dr Ops' },
    details: JSON.stringify({
      domain: 'featureFlags', scope: 'global', updatedKeys: ['projectUndoRedo'],
      changes: [{ key: 'projectUndoRedo', label: 'Project-Wide Undo / Redo', scope: 'global', from: true, to: false }],
      before: { projectUndoRedo: true }, after: { projectUndoRedo: false },
    }),
  };

  it('names the flag and says plainly that it was disabled', () => {
    const out = describeAuditEvent(flagLog);
    expect(out.severity).toBe('high');
    expect(out.description).toContain('Dr Ops');
    expect(out.description).toContain('DISABLED');
    expect(out.description).toContain('Project-Wide Undo / Redo');
  });

  it('the before/after maps feed extractChanges() with no new renderer', () => {
    const changes = extractChanges(flagLog.details);
    expect(changes).toEqual([{ field: 'projectUndoRedo', before: true, after: false }]);
    expect(describeAuditEvent(flagLog).changes).toHaveLength(1);
  });

  it('an enable reads as "enabled"', () => {
    const on = { ...flagLog, details: JSON.stringify({ changes: [{ key: 'k', label: 'Keyword Suggestions', to: true, from: false }] }) };
    expect(describeAuditEvent(on).description).toContain('enabled the Keyword Suggestions feature flag');
  });

  it('a bulk flag write counts the changed flags', () => {
    const bulk = {
      action: 'UPDATE_FEATURE_FLAGS', admin: { email: 'a@b.c' },
      details: { updatedKeys: ['a', 'b'], changes: [{ key: 'a', to: true }, { key: 'b', to: false }] },
    };
    expect(describeAuditEvent(bulk).description).toContain('changed 2 feature flags');
  });

  it('a governance write lists the catalogue keys that moved', () => {
    const log = {
      action: 'UPDATE_RESEARCH_GOVERNANCE', entityId: 'researchGovernanceSettings',
      details: { domain: 'researchGovernanceSettings', scope: 'global', updatedKeys: ['interaction.historyCap'] },
    };
    const out = describeAuditEvent(log);
    expect(out.severity).toBe('medium');
    expect(out.description).toContain('interaction.historyCap');
  });

  it('a reset names the group it reset', () => {
    const log = { action: 'RESET_SETTINGS_GROUP', details: { domain: 'researchGovernanceSettings', updatedKeys: ['a'] } };
    expect(describeAuditEvent(log).description).toContain('researchGovernanceSettings');
  });

  it('the PRE-109 details shape (key names only) still renders — no regression', () => {
    const legacy = { action: 'UPDATE_SETTING', details: JSON.stringify({ updatedKeys: ['appSettings'] }) };
    const out = describeAuditEvent(legacy);
    expect(out.severity).toBe('low');
    expect(out.description).toContain('appSettings');
    expect(out.changes).toEqual([]);
  });

  it('a details blob with no changes array never throws', () => {
    for (const details of [null, '', 'not json', {}, { changes: 'nope' }]) {
      expect(() => describeAuditEvent({ action: 'UPDATE_FEATURE_FLAG', details })).not.toThrow();
    }
  });
});
