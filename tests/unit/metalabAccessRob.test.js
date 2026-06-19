/**
 * metalabAccessRob.test.js — prompt41 Task 5. The pure RoB-permission mapping:
 * mlAccessFromMember must surface canAssessRiskOfBias (owner/leader always; members
 * by the explicit flag) so granting RoB access actually has an effect.
 */
import { describe, it, expect } from 'vitest';
import { mlAccessFromMember } from '../../server/screening/metalabAccess.js';

describe('mlAccessFromMember — canAssessRiskOfBias', () => {
  it('owner and leader always get RoB access', () => {
    expect(mlAccessFromMember({ role: 'owner' }).canAssessRiskOfBias).toBe(true);
    expect(mlAccessFromMember({ role: 'leader' }).canAssessRiskOfBias).toBe(true);
  });
  it('a member with the explicit flag gets RoB access', () => {
    const a = mlAccessFromMember({ role: 'member', canAssessRiskOfBias: true });
    expect(a.canAssessRiskOfBias).toBe(true);
  });
  it('a member WITHOUT the flag does NOT get RoB access', () => {
    const a = mlAccessFromMember({ role: 'member', canViewMetaLab: true, canEditMetaLab: true });
    expect(a.canAssessRiskOfBias).toBe(false);
  });
  it('the RoB flag is independent of view/edit flags', () => {
    // RoB-only grant: no general ML edit, but RoB is allowed.
    const a = mlAccessFromMember({ role: 'member', canAssessRiskOfBias: true, canViewMetaLab: false, canEditMetaLab: false });
    expect(a.canAssessRiskOfBias).toBe(true);
    expect(a.canEdit).toBe(false);
  });
});
