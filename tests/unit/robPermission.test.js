/**
 * robPermission.test.js — prompt31 Part 4. The project-level "Risk of Bias
 * assessment" permission must exist in the shared permission model, default OFF
 * for plain reviewers/viewers, ON for owner/leader (full) and the data extractor.
 */
import { describe, it, expect } from 'vitest';
import { PERMISSION_KEYS, PERMISSION_PRESETS, fullPermissions, resolvePreset } from '../../src/research-engine/screening/permissionPresets.js';

describe('canAssessRiskOfBias permission', () => {
  it('is a known permission key', () => {
    expect(PERMISSION_KEYS).toContain('canAssessRiskOfBias');
  });
  it('owner/leader (full access) have it', () => {
    expect(fullPermissions().canAssessRiskOfBias).toBe(true);
    expect(PERMISSION_PRESETS.owner.perms.canAssessRiskOfBias).toBe(true);
    expect(PERMISSION_PRESETS.leader.perms.canAssessRiskOfBias).toBe(true);
  });
  it('the data extractor preset grants it', () => {
    expect(resolvePreset('data_extractor').perms.canAssessRiskOfBias).toBe(true);
  });
  it('plain reviewer / viewer do NOT have it by default', () => {
    expect(resolvePreset('reviewer').perms.canAssessRiskOfBias).toBe(false);
    expect(resolvePreset('viewer').perms.canAssessRiskOfBias).toBe(false);
    expect(resolvePreset('readonly_metalab').perms.canAssessRiskOfBias).toBe(false);
  });
});
