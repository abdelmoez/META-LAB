/**
 * StitchProjectSubnav.jsx — the persistent white secondary sidebar (55.md), now a
 * thin wrapper that renders the ONE shared vertical workflow stepper (57.md §5/§7).
 *
 * Every multi-child category — Plan & Protocol, Search, Screen, Extract, Analyze,
 * Report — gets the SAME guided stepper (numbered stages, continuous connectors,
 * progress state, contextual counts/helper text) from the shared
 * <StitchWorkflowStepper> + the pure `submenuSteps` model. The Screen category
 * additionally carries live screening counts/states (buildScreeningSteps). It is a
 * STABLE workspace navigator (never a hover flyout) rendered into the coordinated
 * nav shell's submenu slot; the active step is route-derived (`activeKey`) so deep
 * links + refresh restore it, and it animates WITH the purple rail.
 */
import { useNavigate } from 'react-router-dom';
import { StitchContextRail } from './shellParts.jsx';
import StitchWorkflowStepper from './StitchWorkflowStepper.jsx';
import { PROJECT_CATEGORIES } from '../nav/navConfig.js';
import { submenuSteps } from '../nav/stepperModel.js';
// P15 — the Citation Mining entry joins the Search submenu ONLY when its flag is ON.
// The flag hook lives in the feature (thin: it only reads the public settings flag),
// so the nav gate never pulls the heavy panel chunk. Off/loading → hidden (unchanged).
import { useCitationMiningEnabled } from '../../../features/citationMining/useCitationMiningEnabled.js';
// 75.md recs — the Search submenu must MATCH the body: it shows the numbered `?stage=`
// workflow only when the staged SearchWorkspace (searchWorkspaceV2) is on (Finding 1),
// and it must build that workflow for the project's PERSISTED search mode so an
// automated project never highlights a phantom Database Strategies stage (Finding 2).
// Both hooks are thin feature reads; searchMode is fetched ONLY for the active Search
// category with the flag on, so no other page pays for it.
import { useSearchWorkspaceV2Enabled } from '../../../features/searchWorkspace/useSearchWorkspaceV2Enabled.js';
import { useSearchMode, useSearchStageStatuses } from '../../../features/searchWorkspace/useSearchMode.js';

const CATEGORY_BY_ID = PROJECT_CATEGORIES.reduce((m, c) => { m[c.id] = c; return m; }, {});

export default function StitchProjectSubnav({ projectId, linkedSiftId, category, activeKey, statusMap = {}, screeningSteps = null }) {
  const navigate = useNavigate();
  const cat = CATEGORY_BY_ID[category];
  const citationMiningEnabled = useCitationMiningEnabled() === true;
  const searchWorkspaceV2Enabled = useSearchWorkspaceV2Enabled() === true;
  // Resolve the saved search mode only when it can actually change the submenu (the
  // Search category, staged workspace on) — otherwise skip the fetch (enabled=false).
  const searchMode = useSearchMode(projectId, category === 'search' && searchWorkspaceV2Enabled);
  // review-round #10 — live per-stage status glyphs: subscribing forces a re-render
  // when the mounted workspace publishes fresher statuses (navConfig reads the same
  // store cache while building the submenu, so no value needs threading here).
  useSearchStageStatuses(projectId, category === 'search' && searchWorkspaceV2Enabled);
  const steps = submenuSteps(
    category,
    { projectId, linkedSiftId, citationMiningEnabled, searchWorkspaceV2Enabled, searchMode },
    { statusMap, screeningSteps },
  );
  if (!cat || !steps) return null;

  const isScreen = cat.kind === 'screen';
  return (
    <StitchContextRail title={cat.label} subtitle={isScreen ? 'Screening workflow' : 'Workflow'}>
      <StitchWorkflowStepper
        steps={steps}
        activeKey={activeKey}
        ariaLabel={`${cat.label} workflow`}
        onNavigate={(step) => { if (step.href) navigate(step.href); }}
      />
    </StitchContextRail>
  );
}
