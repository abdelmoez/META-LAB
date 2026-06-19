/**
 * routes/workflowState.js — server-backed per-module workflow state (prompt38).
 * Mounted at /api/workspaces with requireAuth applied at the mount (index.js).
 * Each handler additionally gates on the serverBackedWorkflowState feature flag
 * (default OFF → 404) and the caller's META·LAB project access.
 */
import { Router } from 'express';
import {
  getWorkspaceState,
  getWorkspaceModuleState,
  getWorkspaceAudit,
  patchWorkspaceModuleState,
} from '../controllers/workflowStateController.js';

const router = Router();

router.get('/:projectId/state', getWorkspaceState);
router.get('/:projectId/audit', getWorkspaceAudit);
router.get('/:projectId/modules/:moduleKey/state', getWorkspaceModuleState);
router.patch('/:projectId/modules/:moduleKey/state', patchWorkspaceModuleState);

export default router;
