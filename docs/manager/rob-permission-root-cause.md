# RoB Permission — Root Cause & Fix — prompt41 Task 5

## Symptom
An owner grants a member the **Risk of Bias** permission, but the member still cannot
view or use the RoB engine (they see "Risk of Bias is managed by the project owner").

## Root cause
The permission `canAssessRiskOfBias` was defined (`permissionPresets.js`) and editable
(`MembersTab`), but **never enforced**: every `robController.js` handler authorized
ONLY via `getOwnedProject(projectId, userId)` (strict project ownership → non-owner
404). Two gaps:
1. `robController` had no membership path at all — granting the permission had zero
   effect on the API.
2. `metalabAccess.mlAccessFromMember()` computed view/edit/export but **did not expose
   `canAssessRiskOfBias`**, so even consumers that looked never saw it.

So all 9 RoB endpoints 404'd for members, and `ProjectRobPanel` fell back to the
owner-only notice.

## Permission keys
- `canAssessRiskOfBias` (`ScreenProjectMember` column / preset key) — "complete and
  edit Risk of Bias assessments". Owner/leader implicitly always.

## Fix (backend-enforced)
1. **`metalabAccess.js`** — `mlAccessFromMember` now returns
   `canAssessRiskOfBias: full || !!m.canAssessRiskOfBias`. New
   `getRobMemberAccess(projectId, userId)` resolves RoB access for a linked-workspace
   member (NOT gated on canViewMetaLab — RoB is a distinct grant; edit additionally
   requires not project-read-only), with the same security invariant (linked project
   must be the owner's + live).
2. **`robController.js`** — new `resolveRobAccess(projectId, userId)` → `{ project,
   canEdit }` (OWNER full, OR member with `canAssessRiskOfBias`; member's project is
   loaded via its verified owner id since the store is owner-scoped). `loadAssessment`
   authorizes through it and tags `_canEdit`. Applied to every handler:
   - **View** (list, get, export): owner OR RoB member.
   - **Edit** (create, answers, override, finalise, reopen, delete): additionally
     require `canEdit` (view-only RoB members get **403**, not 404).
   Non-permitted users still get **404** (existence hidden). Feature-flag gate
   (`rob_engine_v2`) unchanged.
3. **`projectsController.js`** — `_permissions` (owned + shared) now includes
   `canAssessRiskOfBias`, so the UI can show edit controls.
4. **Frontend** — the monolith RoB tab computes
   `canEdit = (perms.canEdit || perms.canAssessRiskOfBias) && !project._readOnly`, so a
   member granted RoB sees the assess/edit UI (not view-only).

## Permission model after fix
| Actor | View RoB | Edit RoB |
|---|---|---|
| Owner / leader | yes | yes |
| Member with `canAssessRiskOfBias` (not read-only) | yes | yes |
| Member with `canAssessRiskOfBias` but project read-only | yes | no (403 on write) |
| Member without `canAssessRiskOfBias` | no (404) | no (404) |
| Non-member | no (404) | no (404) |

## Tests / QA
- Unit: `tests/unit/metalabAccessRob.test.js` — `mlAccessFromMember` surfaces
  `canAssessRiskOfBias` (owner/leader always; member by flag; independent of view/edit).
- Manual QA: owner grants RoB → member refresh → sees + opens RoB, can save when not
  read-only; owner revokes → member loses access; direct API calls 404/403 as above.

## Known limitation
Granting `canAssessRiskOfBias` should accompany project view (the `data_extractor`
preset grants both). A RoB-only grant with NO project-view permission lets the API
authorize RoB but `ProjectRobPanel`'s project fetch (which needs view) would not load
the study list — an unsupported edge; use the preset.
