/**
 * ProjectRobPanel.jsx — the per-project RoB experience, decoupled from any page
 * chrome so it can be rendered BOTH standalone (RobPage at /rob/:projectId) and
 * embedded natively inside the META·LAB project workspace "Risk of Bias" tab
 * (prompt28 Part 2). It always operates on ONE project id passed in by its host —
 * there is no project selector here.
 *
 * It loads the project's studies + assessments, shows the robvis summary plot, the
 * project-specific RoB tool selector (prompt28 Part 4), and opens the keyboard-
 * first RobWorkspace inline. The pure engine stays in research-engine/rob and the
 * data stays behind /api/rob — this component only orchestrates the UI.
 */
import { useState, useEffect, useCallback } from 'react';
import { C, FONT, MONO, alpha } from '../theme/tokens.js';
import Icon from '../components/icons.jsx';
import { api } from '../api-client/apiClient.js';
import { robApi, guidedRobAppraisalEnabled } from './robApi.js';
import RobWorkspace from './RobWorkspace.jsx';
import { judgmentStyle, judgmentStyleOn, overallScaleOf } from './judgmentStyle.js';
import ReviewerComparisonPanel from './ReviewerComparisonPanel.jsx';
import RobSummaryOutputs from './RobSummaryOutputs.jsx';
import RobExportButton from './RobExportButton.jsx';
import { ROB_TOOLS, normalizeRobTool, isRobToolActive } from '../../research-engine/rob/tools.js';
import { articleStatusOf } from './articleStatus.js';
import InstrumentSelector from './InstrumentSelector.jsx';
import { filterInstruments, designsInCatalogue, designLabelsFor } from './instrumentCatalog.js';
import { blindVisibility, blindNote } from './robOutputModel.js';
import { findInstrument } from '../../research-engine/rob/instruments/registry.js';

export default function ProjectRobPanel({
  projectId, embedded = false, canEdit = true, robTool, onSelectTool, onContinue, onWorkspaceChange,
  // r2 review finding 1 — the viewer's identity, which is what makes "my rows" a
  // decidable question. Normally resolved from the session below; the prop exists
  // so a host that already knows (and the tests) can supply it without a fetch.
  currentUserId: currentUserIdProp = null,
}) {
  const [project, setProject] = useState(null);
  const [assessments, setAssessments] = useState([]);
  const [matrix, setMatrix] = useState(null);
  const [error, setError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [openId, setOpenId] = useState(null);          // open assessment in the workspace
  // 79.md §1 — the study whose assessment was last opened; its card is briefly
  // highlighted on return so the reviewer never loses their place in a long list.
  const [recentStudyId, setRecentStudyId] = useState(null);
  const [creatingFor, setCreatingFor] = useState(null); // study being created-for
  const [studies, setStudies] = useState([]);          // prompt46 #4 — merged study universe (screening + manual)
  // 115.md decision 3 — the SELECTABLE instrument catalogue, from the registry via
  // the API. This is what killed `INSTRUMENT_CHOICES`: nothing in this component
  // knows which instruments exist, so registering one makes it appear here.
  const [catalogue, setCatalogue] = useState([]);
  // 115.md decision 7 — per-instrument assessment groups, so a mixed-tool project
  // never renders one plot over incompatible tools.
  const [groups, setGroups] = useState([]);
  const [showAddStudy, setShowAddStudy] = useState(false);
  // 65.md UX-12 — { study, count } while the force-remove confirm modal is open
  // (replaces window.confirm; assessments are kept either way).
  const [confirmRemove, setConfirmRemove] = useState(null);
  // P14 — guided-appraisal flag. When OFF this panel behaves EXACTLY as today
  // (RoB 2 only, no instrument selector at creation, no validation card).
  const [appraisalOn, setAppraisalOn] = useState(false);
  useEffect(() => {
    let alive = true;
    guidedRobAppraisalEnabled().then(v => { if (alive) setAppraisalOn(!!v); }).catch(() => { /* stays OFF */ });
    return () => { alive = false; };
  }, []);

  // ── Who is reading this page? (r2 review finding 1) ─────────────────────────
  // The reviewer blind is a rule about WHOSE work a row is, so the panel needs the
  // viewer's id. It comes from the session (`GET /api/auth/me`) — the same session
  // that already authorised every request on this page — and the blind FAILS
  // CLOSED if it cannot be resolved: an unknown viewer sees no in-progress row of
  // a blinded pair at all, rather than everybody's.
  const [currentUserId, setCurrentUserId] = useState(currentUserIdProp || null);
  useEffect(() => {
    if (currentUserIdProp) { setCurrentUserId(currentUserIdProp); return undefined; }
    let alive = true;
    api.auth.me()
      .then((r) => { if (alive) setCurrentUserId((r && r.user && r.user.id) || (r && r.id) || null); })
      .catch(() => { /* stays null — the blind fails closed */ });
    return () => { alive = false; };
  }, [currentUserIdProp]);

  // prompt39 Task 3 — tell the host when the per-study assessment workspace is open
  // so it can hide the RoB overview intro header (focus mode inside the tool).
  useEffect(() => { if (typeof onWorkspaceChange === 'function') onWorkspaceChange(openId != null); }, [openId, onWorkspaceChange]);

  const reload = useCallback(async () => {
    setAccessDenied(false);
    try {
      const [proj, list, studiesRes] = await Promise.all([
        api.projects.get(projectId),
        robApi.listAssessments(projectId),
        // prompt46 #4 — merged universe (screening-derived + manual). Fall back to the
        // project blob if the endpoint is unavailable so the panel still renders.
        robApi.listStudies(projectId).catch(() => null),
      ]);
      setProject(proj);
      setAssessments(list.assessments || []);
      setMatrix(list.matrix || null);
      setGroups(Array.isArray(list.groups) ? list.groups : []);
      setStudies(
        (studiesRes && Array.isArray(studiesRes.studies))
          ? studiesRes.studies
          : (Array.isArray(proj.studies) ? proj.studies.map(s => ({ ...s, source: 'screening' })) : []),
      );
      // The catalogue travels WITH the study universe (one round-trip). Older
      // servers omit it; fall back to the dedicated endpoint rather than to a
      // hardcoded list, so the selector is never quietly narrowed back to two tools.
      // The rows arrive complete: every one of the thirteen DEFINITIONS carries its
      // own organisation / citation / guidance URL / licence, so the §32 provenance
      // panel reads the server's catalogue and nothing is merged in client-side.
      if (studiesRes && Array.isArray(studiesRes.instruments) && studiesRes.instruments.length) {
        setCatalogue(studiesRes.instruments);
      } else {
        robApi.listInstruments()
          .then(r => setCatalogue(Array.isArray(r.instruments) ? r.instruments : []))
          .catch(() => { /* selector falls back to the project's stored tool */ });
      }
      setError('');
    } catch (e) {
      // Owner-scoped API: a non-owner (shared / read-only collaborator) gets 404.
      // Surface that as a clear "managed by the owner" state rather than an error.
      if (e && e.status === 404) { setAccessDenied(true); setError(''); }
      else setError(e.message || 'Failed to load risk-of-bias data');
    }
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  // The selected tool is controlled by the host when embedded (persisted to the
  // project); standalone falls back to the project's stored choice or the default.
  const selectedTool = normalizeRobTool(robTool != null ? robTool : project?.robTool);

  async function createFor(study, resultLabel, instrumentId) {
    try {
      const body = { projectId, studyId: study.id, resultLabel: resultLabel || '' };
      // 115.md decision 3 — the reviewer's chosen instrument is ALWAYS sent. This
      // line used to read `if (appraisalOn && instrumentId)`: with the
      // `guidedRobAppraisal` flag off, every assessment silently became RoB 2 no
      // matter what the reviewer picked. Which instruments exist is a registry
      // question; the guided-appraisal flag gates the guided appraiser and nothing
      // else. The server validates the id against the registry and rejects an
      // unknown one by name.
      if (instrumentId) body.instrumentId = instrumentId;
      const res = await robApi.createAssessment(body);
      setCreatingFor(null);
      setRecentStudyId(study.id);
      await reload();
      setOpenId(res.assessment.id);
    } catch (e) { setError(e.message); }
  }
  async function removeAssessment(id) {
    // 86.md P3.56 — a full assessment (all domain answers + rationales) was
    // discarded on a single trash-icon click with no confirmation. Guard it.
    if (typeof window !== 'undefined' && window.confirm
      && !window.confirm('Delete this risk-of-bias assessment? All domain answers and rationales for it will be lost. This cannot be undone.')) return;
    try { await robApi.remove(id); await reload(); } catch (e) { setError(e.message); }
  }
  // prompt46 #4 — delete a MANUAL study (creator/owner/leader). If it has
  // assessments the server replies 409; a styled confirm modal (65.md UX-12)
  // gates the force-remove (assessments are kept).
  async function removeManualStudy(study) {
    try {
      await robApi.removeManualStudy(projectId, study.id);
      await reload();
    } catch (e) {
      if (e && e.status === 409) {
        setConfirmRemove({ study, count: (e.body && e.body.assessmentCount) || null });
      } else { setError(e.message); }
    }
  }
  async function forceRemoveManualStudy(study) {
    setConfirmRemove(null);
    try { await robApi.removeManualStudy(projectId, study.id, { force: true }); await reload(); }
    catch (e2) { setError(e2.message); }
  }
  async function addManualStudy(body) {
    try { await robApi.createManualStudy(projectId, body); setShowAddStudy(false); await reload(); } catch (e) { setError(e.message); }
  }

  if (openId) {
    return <RobWorkspace assessmentId={openId} readOnly={!canEdit} onContinue={onContinue} onClose={() => { setOpenId(null); reload(); }} onChanged={reload} />;
  }
  if (accessDenied) return <OwnerOnlyNotice />;
  if (error && !project) return <ErrorBox msg={error} onRetry={reload} />;
  if (!project) return <Center>Loading…</Center>;

  const studyIds = new Set(studies.map(s => s.id));
  const byStudy = {};
  for (const a of assessments) { (byStudy[a.studyId] = byStudy[a.studyId] || []).push(a); }
  // Assessments whose study has since been removed from the project (kept safely;
  // shown separately so nothing silently disappears).
  const orphans = assessments.filter(a => !studyIds.has(a.studyId));

  // r2 review finding 1 — the blind, computed ONCE for the whole page and applied
  // to every surface that renders a judgement: the summary tables/distributions/
  // traffic-light plot (via RobSummaryOutputs) and the per-article assessment rows
  // below. ReviewerComparisonPanel enforces it independently at the network
  // boundary; this is the same rule applied to the data the list already holds.
  //
  // Rows stay LISTED while blinded (reviewer name, status, tool) — what is
  // withheld is the judgement, because "Grace has started" is workflow state and
  // "Grace says high risk" is the thing independence exists to protect.
  const blind = blindVisibility(assessments, { currentUserId });
  const maskedIds = blind.hiddenIds;

  return (
    <div>
      {error && <div style={{ marginBottom: 14 }}><ErrorBox msg={error} onRetry={reload} /></div>}

      <ToolSelector selected={selectedTool} canEdit={canEdit} onSelect={onSelectTool} catalogue={catalogue} />

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '4px 0 16px' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 2px' }}>{project.name}</h2>
          {/* 115.md — this line used to hardcode "RoB 2 / ROBINS-I" (or "RoB 2"
              with the guided flag off), which stopped being true the moment the
              registry grew. It now states what is actually available. */}
          <p style={{ fontSize: 12.5, color: C.txt2, margin: 0 }}>
            {assessments.length} assessment{assessments.length === 1 ? '' : 's'}
            {catalogue.length ? ` · ${catalogue.length} assessment tools available` : ''} · per result
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {canEdit && (
            <button onClick={() => setShowAddStudy(true)} style={{ ...ghost, background: C.acc, color: C.accText, border: `1px solid ${C.acc}` }}>
              <Icon name="plus" size={13} /> Add manual study
            </button>
          )}
          {!canEdit && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.muted, fontFamily: MONO }}>
              <Icon name="lock" size={13} /> View only
            </span>
          )}
        </div>
      </div>

      {/* 115.md W2-B — project-level summary outputs: per-instrument summary
          tables, traffic lights ONLY where decision 11 allows (supportsTrafficLight
          = allowlist ∩ risk vocabulary — this is what keeps an AMSTAR-2 "High
          confidence" from rendering in high-risk red), distributions, and the
          project-wide sectioned-CSV export. Mixed-tool projects grouped, never
          merged. */}
      {assessments.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <RobSummaryOutputs
            groups={groups}
            assessments={assessments}
            currentUserId={currentUserId}
            loadAssessment={async (id) => (await robApi.getAssessment(id)).assessment}
            exportSlot={<RobExportButton projectId={projectId} assessmentCount={assessments.length} />}
          />
        </div>
      )}

      {/* P14 — guided-vs-reviewer agreement (flag ON). Endpoint 404s when OFF. */}
      {appraisalOn && <RobValidationCard projectId={projectId} />}

      {studies.length === 0 ? (
        <Center>This project has no studies yet. Add studies in <strong>Data Extraction</strong>, or use <strong>Add manual study</strong> above to assess a study directly here.</Center>
      ) : (
        <>
          {/* 79.md §1 — status overview strip: how many articles are not started /
              in progress / complete, scannable at a glance (icon + count, not colour
              alone). Clarifies the shape of the work before diving into the list. */}
          <ArticleStatusSummary studies={studies} byStudy={byStudy} />
          <div style={{ display: 'grid', gap: 14 }} role="list" aria-label="Articles for risk-of-bias assessment">
            {studies.map((s, i) => (
              <ArticleCard
                key={s.id}
                index={i + 1}
                study={s}
                assessments={byStudy[s.id] || []}
                canEdit={canEdit}
                recent={recentStudyId === s.id}
                creating={creatingFor === s.id}
                onToggleCreate={() => setCreatingFor(creatingFor === s.id ? null : s.id)}
                onCreate={(label2, inst) => createFor(s, label2, inst)}
                onCancelCreate={() => setCreatingFor(null)}
                catalogue={catalogue}
                defaultInstrument={selectedTool}
                projectId={projectId}
                maskedIds={maskedIds}
                onChanged={reload}
                onOpenAssessment={(a) => { setRecentStudyId(s.id); setOpenId(a.id); }}
                onRemoveAssessment={removeAssessment}
                onRemoveStudy={() => removeManualStudy(s)}
              />
            ))}
          </div>
        </>
      )}

      {showAddStudy && <ManualStudyModal onClose={() => setShowAddStudy(false)} onAdd={addManualStudy} />}
      {confirmRemove && (
        <ConfirmRemoveStudyModal
          study={confirmRemove.study} count={confirmRemove.count}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => forceRemoveManualStudy(confirmRemove.study)} />
      )}

      {orphans.length > 0 && (
        <div style={{ ...card, marginTop: 18, borderColor: alpha(C.yel, '50'), background: alpha(C.yel, '08') }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Icon name="alertTriangle" size={14} />
            <span style={{ fontWeight: 700, fontSize: 13 }}>Assessments for studies no longer in this project</span>
          </div>
          <p style={{ fontSize: 12, color: C.txt2, margin: '0 0 10px' }}>These results were assessed earlier; their study has since been removed from the project. They are kept so no work is lost — open to review, or delete.</p>
          <div style={{ display: 'grid', gap: 6 }}>
            {orphans.map(a => <AssessmentRow key={a.id} a={a} canEdit={canEdit} orphan masked={maskedIds.has(a.id)} onOpen={() => setOpenId(a.id)} onRemove={() => removeAssessment(a.id)} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── RoB tool selector (prompt28 Part 4; redesigned by 115.md decision 3) ───────
//
// This card sets the project's DEFAULT assessment tool — the one pre-selected when
// a reviewer starts an assessment. It is not a restriction: a mixed-design review
// legitimately assesses different studies with different instruments (§25), and the
// per-study Assess selector below can pick any registered tool regardless of what is
// set here.
//
// What changed: availability used to be `isRobToolActive(t.id) && (t.id === 'RoB2'
// || appraisalOn)` — the Newcastle-Ottawa tiles were rendered but clickable only
// when the *guided-appraisal* flag was on, a flag the NOS does not conceptually
// depend on, while the caption underneath flatly denied that any tool but RoB 2 and
// ROBINS-I existed. Availability is now a REGISTRY fact: a tool is selectable when
// the server catalogue carries it (or, before the catalogue loads, when the pure
// tools catalogue marks it active). No feature flag is consulted here at all.
//
// With thirteen instruments a flat grid of tiles would swamp the page, so the
// current default is shown on its own and the full, filterable list is one click
// away (progressive disclosure, §30).
function ToolSelector({ selected, canEdit, onSelect, catalogue = [] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [designId, setDesignId] = useState('');
  const interactive = canEdit && typeof onSelect === 'function';

  // The server catalogue is the source of truth; the pure catalogue is the
  // pre-load fallback so the card is never empty (and never narrower than the
  // registry). `custom` is deliberately excluded — it is advertised, not built.
  const tools = catalogue.length
    ? catalogue
    : ROB_TOOLS.filter(t => isRobToolActive(t.id)).map(t => ({
      id: t.id, label: t.label, sublabel: t.sublabel, description: t.description,
      designs: t.designs || [], instrumentVersion: t.version, organization: t.organization,
      abbreviation: t.abbreviation, citation: t.citation, guidanceUrl: t.guidanceUrl, license: t.license,
    }));
  const current = tools.find(t => t.id === selected) || null;
  const designs = designsInCatalogue(tools);
  const filtered = filterInstruments(tools, { query, designId });

  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <Icon name="scale" size={14} />
        <span style={{ fontSize: 12, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Assessment tool</span>
        <span aria-hidden style={{ flex: 1 }} />
        {interactive && (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} style={{ ...ghost, padding: '5px 11px' }}>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} /> {open ? 'Hide' : `Change default (${tools.length} tools)`}
          </button>
        )}
      </div>

      {/* The project's current default, always visible. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled aria-pressed
          title={current ? (current.description || current.label) : selected}
          style={{ textAlign: 'left', minWidth: 168, flex: '1 1 220px', maxWidth: 320, padding: '10px 12px', borderRadius: 10, fontFamily: FONT, cursor: 'default', background: alpha(C.acc, '14'), border: `1px solid ${alpha(C.acc, '60')}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.acc }}>{current ? (current.label || current.name) : selected}</span>
            <Icon name="check" size={13} />
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.35 }}>
            {current ? (designLabelsFor(current).join(' · ') || current.sublabel || '') : ''}
          </div>
        </button>
      </div>

      {open && interactive && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 9 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 200px', minWidth: 160, padding: '6px 10px', borderRadius: 8, background: C.surf, border: `1px solid ${C.brd2}` }}>
              <Icon name="search" size={13} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tools" aria-label="Search assessment tools"
                style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: C.txt, fontSize: 12.5, fontFamily: FONT }} />
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Study design</span>
              <select value={designId} onChange={e => setDesignId(e.target.value)} aria-label="Filter tools by study design"
                style={{ padding: '6px 9px', borderRadius: 8, background: C.surf, border: `1px solid ${C.brd2}`, color: C.txt, fontSize: 12.5, fontFamily: FONT }}>
                <option value="">All designs</option>
                {designs.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))', maxHeight: 300, overflowY: 'auto' }}>
            {filtered.map(t => {
              const on = selected === t.id;
              return (
                <button key={t.id} type="button" onClick={() => { if (t.id !== selected) onSelect(t.id); setOpen(false); }}
                  aria-pressed={on} title={t.description || t.label}
                  style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, fontFamily: FONT, cursor: 'pointer', background: on ? alpha(C.acc, '14') : C.surf, border: `1px solid ${on ? alpha(C.acc, '60') : C.brd}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: on ? C.acc : C.txt }}>{t.label || t.name}</span>
                    {on && <Icon name="check" size={13} />}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.35 }}>{designLabelsFor(t).join(' · ') || t.sublabel || ''}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: C.muted, marginTop: 9, lineHeight: 1.5 }}>
        {tools.length} validated instruments are available, each connected to the full assessment workflow. This sets the
        project <strong style={{ color: C.txt2 }}>default</strong>; every study can be assessed with whichever instrument
        suits its design.
      </div>
    </div>
  );
}

// ── 79.md §1 — article-list distinction ──────────────────────────────────────
// `articleStatusOf` (pure) lives in ./articleStatus.js so it is unit-testable
// without the PDF/React tree. Icon + label encoding, never colour alone.

function ArticleStatusChip({ status }) {
  return (
    <span role="status" aria-label={`Assessment status: ${status.label}`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20,
      background: alpha(status.tone, '1c'), border: `1px solid ${alpha(status.tone, '4d')}`,
      color: status.tone, fontSize: 11, fontWeight: 700, fontFamily: FONT, whiteSpace: 'nowrap',
    }}>
      <Icon name={status.icon} size={12} /> {status.label}
    </span>
  );
}

// A scannable count of Not started / In progress / Complete across the whole list.
function ArticleStatusSummary({ studies, byStudy }) {
  let notStarted = 0, inProgress = 0, complete = 0;
  for (const s of studies) {
    const st = articleStatusOf(byStudy[s.id] || []);
    if (st.key === 'complete') complete++;
    else if (st.key === 'not-started') notStarted++;
    else inProgress++;
  }
  const item = (icon, tone, n, label) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.txt2 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 6, background: alpha(tone, '1c'), color: tone }}><Icon name={icon} size={12} /></span>
      <strong style={{ color: C.txt }}>{n}</strong> {label}
    </span>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', margin: '2px 0 14px' }}>
      {item('minus', C.muted, notStarted, 'not started')}
      {item('clock', C.yel, inProgress, 'in progress')}
      {item('circleCheck', C.grn, complete, 'complete')}
      <span style={{ marginLeft: 'auto', fontSize: 11.5, color: C.muted, fontFamily: MONO }}>{studies.length} article{studies.length === 1 ? '' : 's'}</span>
    </div>
  );
}

// A compact monospace identity chip (study id / DOI / PMID); a href makes it a
// link that never bubbles a click up to the card.
function IdChip({ icon, label, href, title }) {
  const inner = (
    <span title={title || label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontFamily: MONO, fontWeight: 600,
      color: C.muted, background: alpha(C.txt, '08'), border: `1px solid ${C.brd}`, borderRadius: 6,
      padding: '1px 7px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {icon && <Icon name={icon} size={10} />}{label}
    </span>
  );
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none' }}>{inner}</a>;
  return inner;
}

// One article as a distinct, elevated card: number · title-first identity · id
// chips · a status chip · nested assessment rows. Hover lifts it; the just-assessed
// article keeps an accent ring so the reviewer never loses their place (79.md §1).
function ArticleCard({
  index, study: s, assessments: list, canEdit, recent, creating,
  onToggleCreate, onCreate, onCancelCreate, catalogue, defaultInstrument,
  projectId, onChanged, maskedIds = null,
  onOpenAssessment, onRemoveAssessment, onRemoveStudy,
}) {
  const [hover, setHover] = useState(false);
  const manual = s.source === 'manual';
  const status = articleStatusOf(list);
  const title = s.title || `${s.author || ''} ${s.year ? `(${s.year})` : ''}`.trim() || `Study ${s.id}`;
  const metaBits = [s.author, s.year, s.journal].map((x) => (x == null ? '' : String(x).trim())).filter(Boolean);
  return (
    <div role="listitem" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', background: C.card, borderRadius: 14, overflow: 'hidden',
        border: `1px solid ${recent ? alpha(C.acc, '80') : hover ? C.brd2 : C.brd}`,
        boxShadow: recent ? `0 0 0 3px ${alpha(C.acc, '24')}` : hover ? `0 8px 20px -12px ${C.shadow}` : `0 1px 2px ${C.shadow}`,
        transition: 'box-shadow .15s ease, border-color .15s ease',
      }}>
      {/* Identity spine: violet for a manual study, a subtle accent for screening. */}
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: manual ? C.purp : alpha(C.acc, '40') }} />
      <div style={{ padding: '14px 16px 14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <span aria-hidden title={`Article ${index}`} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 26, height: 26, padding: '0 7px', borderRadius: 8, background: C.surf, border: `1px solid ${C.brd}`, color: C.txt2, fontSize: 12, fontWeight: 800, fontFamily: MONO }}>{index}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span title={title} className="t-truncate" style={{ display: 'block', fontWeight: 800, fontSize: 14.5, color: C.txt, lineHeight: 1.3 }}>{title}</span>
            {metaBits.length > 0 && <div className="t-truncate" style={{ fontSize: 12, color: C.txt2, marginTop: 3 }}>{metaBits.join(' · ')}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <IdChip label={`ID ${String(s.id).slice(0, 8)}`} title={`Study identifier ${s.id}`} />
              {s.doi && <IdChip icon="link" label={`DOI ${s.doi}`} href={`https://doi.org/${s.doi}`} />}
              {s.pmid && <IdChip icon="fileText" label={`PMID ${s.pmid}`} href={`https://pubmed.ncbi.nlm.nih.gov/${s.pmid}`} />}
              <SourceBadge source={s.source} small />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <ArticleStatusChip status={status} />
            {canEdit && <button onClick={onToggleCreate} style={ghost}><Icon name="plus" size={13} /> Assess a result</button>}
            {canEdit && manual && <button onClick={onRemoveStudy} style={{ ...miniBtn, color: C.muted }} title="Delete manual study"><Icon name="trash" size={12} /></button>}
          </div>
        </div>

        {/* 115.md §6-§8/§37-§39 — the redesigned Assess selector. It is fed the
            registry catalogue and this study's own recommendation + existing
            assessments, so it can recommend without restricting, warn without
            blocking, and surface earlier work under other tools before a second
            instrument is started. */}
        {canEdit && creating && (
          <InstrumentSelector
            catalogue={catalogue}
            recommendation={s.recommendation}
            existingAssessments={s.existingAssessments && s.existingAssessments.length ? s.existingAssessments : list}
            defaultToolId={defaultInstrument}
            onStart={({ instrumentId, resultLabel }) => onCreate(resultLabel, instrumentId)}
            onCancel={onCancelCreate}
            onOpenExisting={onOpenAssessment}
          />
        )}

        {list.length > 0 ? (
          <div style={{ marginTop: 12, display: 'grid', gap: 7 }}>
            {list.map((a) => (
              <AssessmentRow key={a.id} a={a} canEdit={canEdit}
                masked={!!(maskedIds && maskedIds.has(a.id))}
                onOpen={() => onOpenAssessment(a)} onRemove={() => onRemoveAssessment(a.id)} />
            ))}
            {maskedIds && list.some(a => maskedIds.has(a.id)) && (
              <p style={{ margin: '2px 0 0', fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
                <Icon name="eye" size={11} /> {blindNote(list.filter(a => maskedIds.has(a.id)).length)}
              </p>
            )}
            {/* 115.md decision 10 — one comparison per INSTRUMENT: two RoB 2 rows
                and a QUADAS-2 row on the same study are different questions
                entirely. Only rendered once a study has >1 row for an instrument
                (single-reviewer studies stay uncluttered). */}
            {[...new Set(list.map(a => a.instrumentId || 'RoB2'))]
              .filter(iid => list.filter(a => (a.instrumentId || 'RoB2') === iid).length > 1)
              .map(iid => (
                <ReviewerComparisonPanel
                  key={iid}
                  projectId={projectId}
                  studyId={s.id}
                  studyLabel={title}
                  instrumentId={iid}
                  instrumentLabel={(list.find(a => (a.instrumentId || 'RoB2') === iid) || {}).instrumentLabel || iid}
                  rows={list.filter(a => (a.instrumentId || 'RoB2') === iid)}
                  canEdit={canEdit}
                  onChanged={onChanged}
                  onOpenAssessment={onOpenAssessment}
                />
              ))}
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="minus" size={12} /> No risk-of-bias result assessed yet.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The OVERALL judgement of one row, resolved ON ITS OWN SCALE (r2 review finding
 * 4). This used to be a flat `judgmentStyle(a.overall)`, i.e. the risk-of-bias
 * vocabulary applied to every tool — which painted an AMSTAR 2 review rated
 * "High confidence" (its BEST result) in high-risk red, and rendered a JBI
 * "Include" decision as "Not assessed" because the risk map has no such level.
 *
 * The scale comes from the instrument definition's own `overall.axis`
 * (`overallScaleOf`), so a tool added to the registry is styled correctly here
 * with no edit. An unknown instrument falls back to the risk scale, which is the
 * historical behaviour and the only safe default for a tool we cannot resolve.
 *
 * @returns {{ style, scale: string|null, aria: string }}
 *   `scale === null` means the instrument PRESCRIBES NO OVERALL (QUADAS-2), and
 *   the caller must not claim one.
 */
export function overallPresentation(a, instrumentFor = findInstrument) {
  const instrument = typeof instrumentFor === 'function' ? instrumentFor(a.instrumentId || 'RoB2') : null;
  const scale = instrument ? overallScaleOf(instrument) : 'rob';
  if (scale == null) {
    return { style: judgmentStyle('na'), scale: null, aria: 'This tool prescribes no overall judgement' };
  }
  const style = judgmentStyleOn(scale, a.overall || 'na');
  const prefix = scale === 'confidence' ? 'Overall confidence'
    : scale === 'decision' ? 'Appraisal decision'
      : 'Overall risk';
  // The confidence/decision labels already carry their noun ("High confidence"),
  // so the short form keeps the announcement from reading "confidence: High
  // confidence"; the risk labels ("Some concerns") need their full wording.
  const value = (scale === 'confidence' || scale === 'decision') ? style.short : style.label;
  return { style, scale, aria: `${prefix}: ${value}` };
}

export function AssessmentRow({ a, canEdit, onOpen, onRemove, orphan, masked = false }) {
  const { style: st, scale, aria } = overallPresentation(a);
  // prompt46 #3 — default-allow when the backend omits canMutate (no regression for owners);
  // the server still enforces the real permission on every write.
  const canMutate = canEdit && (a.canMutate !== false);
  const toolLabel = a.instrumentLabel || (a.instrumentId === 'RoB2' ? 'RoB 2' : a.instrumentId) || 'Tool unknown';
  // r2 review finding 1 — a colleague's row mid-blind. It is still LISTED (who is
  // assessing, with which tool, how far along) because that is workflow state; its
  // JUDGEMENT is replaced by an explicit "hidden", not by a blank that could be
  // read as "not assessed".
  const chip = masked
    ? { icon: 'eye', bg: alpha(C.acc, '12'), fg: C.muted, label: 'Hidden' }
    : { icon: st.icon, bg: st.bg, fg: st.fg, label: st.label };
  const chipAria = masked ? 'Judgement hidden — independent review in progress' : aria;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 8, background: C.surf, border: `1px solid ${C.brd}` }}>
      {/* 79.md §1 — colour + REDUNDANT symbol (judgement icon) so completed/incomplete
          judgements are distinguishable without relying on colour alone. */}
      <span title={chip.label} aria-label={chipAria} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', background: chip.bg, color: chip.fg, border: `1px solid ${alpha(chip.fg, '55')}`, flexShrink: 0, marginTop: 1, alignSelf: 'flex-start' }}>
        <Icon name={chip.icon} size={11} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button onClick={onOpen} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, color: C.txt, fontSize: 13, padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.resultLabel || 'Result'} — {masked
            ? <span style={{ color: C.muted, fontWeight: 700 }}>Judgement hidden</span>
            : scale == null
              ? <span style={{ color: C.muted, fontWeight: 700 }}>No overall judgement</span>
              : <span style={{ color: st.fg, fontWeight: 700 }}>{st.label}</span>} {a.status === 'complete' ? '· finalised' : '· draft'}{orphan ? ` · study ${a.studyId}` : ''}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          <ToolChip label={toolLabel} />
          {a.source && <SourceBadge source={a.source} small />}
          {a.reviewerName && <span style={{ fontSize: 10.5, color: C.muted }}>Started by {a.reviewerName}</span>}
        </div>
      </div>
      {/* Opening a blinded colleague's assessment would defeat the same blind the
          row is enforcing, so the action is withheld with a reason rather than
          offered and then refused. */}
      {masked
        ? <span title="Hidden until every independent assessment of this study is complete" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', fontSize: 11, color: C.muted }}><Icon name="eye" size={12} /> Blinded</span>
        : <button onClick={onOpen} style={miniBtn}>{canMutate ? 'Open' : 'View'}</button>}
      {!masked && (canMutate
        ? <button onClick={onRemove} style={{ ...miniBtn, color: C.muted }} title="Delete"><Icon name="trash" size={12} /></button>
        : (canEdit && <span title="Only the assessment creator, a project leader, or the owner can delete this assessment" style={{ display: 'inline-flex', padding: '4px 6px', color: C.dim }}><Icon name="lock" size={12} /></span>))}
    </div>
  );
}

// prompt46 #5 — the assessment tool chip (e.g. "RoB 2").
function ToolChip({ label }) {
  return <span style={{ fontSize: 9.5, fontFamily: MONO, fontWeight: 700, color: C.acc, background: alpha(C.acc, '12'), border: `1px solid ${alpha(C.acc, '30')}`, borderRadius: 6, padding: '1px 6px' }}>{label}</span>;
}

// prompt46 #4 — study source badge: Manual (accent purple) vs From Screening (muted).
function SourceBadge({ source, small }) {
  const fs = small ? 9 : 9.5;
  if (source === 'manual') {
    return <span style={{ fontSize: fs, fontFamily: MONO, fontWeight: 700, color: C.purp, background: alpha(C.purp, '14'), border: `1px solid ${alpha(C.purp, '40')}`, borderRadius: 6, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Manual</span>;
  }
  return <span style={{ fontSize: fs, fontFamily: MONO, fontWeight: 700, color: C.muted, background: alpha(C.txt, '08'), border: `1px solid ${C.brd}`, borderRadius: 6, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>From screening</span>;
}

// prompt46 #4 — compact modal to add a manual study directly in the RoB engine.
function ManualStudyModal({ onClose, onAdd }) {
  const [f, setF] = useState({ title: '', authors: '', year: '', doi: '', pmid: '', notes: '' });
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.value }));
  const canSubmit = !!(f.title.trim() || f.authors.trim());
  const submit = () => { if (canSubmit) onAdd(f); };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#00000099', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Add a manual study</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: 4 }}><Icon name="x" size={16} /></button>
        </div>
        <p style={{ fontSize: 12, color: C.muted, margin: '0 0 14px', lineHeight: 1.5 }}>Add a study that isn&apos;t in screening/extraction. It is marked <strong style={{ color: C.purp }}>Manual</strong> and can be deleted here — it does not affect your screening results.</p>
        <ModalField label="Study title *"><input autoFocus value={f.title} onChange={set('title')} style={modalInp} placeholder="e.g. Effect of X on Y: a randomised trial" /></ModalField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
          <ModalField label="Authors"><input value={f.authors} onChange={set('authors')} style={modalInp} placeholder="e.g. Smith et al." /></ModalField>
          <ModalField label="Year"><input value={f.year} onChange={set('year')} style={modalInp} placeholder="2024" /></ModalField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <ModalField label="DOI"><input value={f.doi} onChange={set('doi')} style={modalInp} placeholder="10.xxxx/…" /></ModalField>
          <ModalField label="PMID"><input value={f.pmid} onChange={set('pmid')} style={modalInp} placeholder="PubMed ID" /></ModalField>
        </div>
        <ModalField label="Notes"><textarea value={f.notes} onChange={set('notes')} rows={2} style={{ ...modalInp, resize: 'vertical' }} placeholder="Optional" /></ModalField>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} style={ghost}>Cancel</button>
          <button onClick={submit} disabled={!canSubmit} style={{ ...ghost, background: canSubmit ? C.acc : C.brd, color: canSubmit ? C.accText : C.muted, border: `1px solid ${canSubmit ? C.acc : C.brd}`, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>Add study</button>
        </div>
      </div>
    </div>
  );
}
// 65.md UX-12 — styled confirm for the destructive force-remove (was window.confirm).
function ConfirmRemoveStudyModal({ study, count, onCancel, onConfirm }) {
  return (
    <div onClick={onCancel} role="dialog" aria-modal="true" aria-label="Remove manual study"
      style={{ position: 'fixed', inset: 0, background: '#00000099', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: '100%', maxWidth: 440 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Icon name="alertTriangle" size={15} />
          <h3 style={{ fontSize: 15.5, fontWeight: 800, margin: 0 }}>Remove this manual study?</h3>
        </div>
        <p style={{ fontSize: 12.5, color: C.txt2, margin: '0 0 6px', lineHeight: 1.55 }}>
          <strong style={{ color: C.txt }}>{study.title || study.authors || 'This study'}</strong> has{' '}
          {count || 'existing'} risk-of-bias assessment{count === 1 ? '' : 's'}.
        </p>
        <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 16px', lineHeight: 1.55 }}>
          The study entry is removed from this list; its assessments are kept and will appear under
          &ldquo;assessments without a study&rdquo;.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} autoFocus style={ghost}>Cancel</button>
          <button onClick={onConfirm} style={{ ...ghost, background: C.red, color: '#fff', border: `1px solid ${C.red}` }}>Remove study</button>
        </div>
      </div>
    </div>
  );
}

function ModalField({ label, children }) {
  return <div style={{ marginBottom: 10 }}><label style={{ display: 'block', fontSize: 11.5, color: C.txt2, fontWeight: 600, marginBottom: 4 }}>{label}</label>{children}</div>;
}
const modalInp = { width: '100%', boxSizing: 'border-box', padding: '8px 11px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt, fontSize: 13, fontFamily: FONT };

// 115.md decision 3 — `INSTRUMENT_CHOICES` + `CreateForm` were DELETED here.
//
// `INSTRUMENT_CHOICES = [RoB 2, ROBINS-I]` was the single hardcode behind the whole
// problem 115.md exists to fix: the Newcastle–Ottawa forms were fully implemented
// server-side and fully renderable in the workspace, yet could not be chosen because
// this two-entry constant was the only thing the Assess flow ever offered — and it
// was rendered only when `guidedRobAppraisal` was ON, with the chosen instrument
// dropped from the request when it was OFF.
//
// Its replacement is ./InstrumentSelector.jsx, driven by the server's registry
// catalogue and the per-study recommendation. Adding an instrument to the registry
// now makes it appear in Assess with no change to this file — which is the
// architectural fix, not another hardcoded option.

// ── P14 — Guided vs reviewer agreement ────────────────────────────────────────
// Weighted-κ agreement between the guided SUGGESTIONS (proposed answers) and the
// reviewer's FINAL judgements, per domain, with a disagreement queue and a CSV
// export. Endpoint 404s when the guidedRobAppraisal flag is OFF → the card hides
// itself (returns null) so nothing regresses.
function RobValidationCard({ projectId }) {
  const [state, setState] = useState({ loading: true, data: null, hidden: false, error: '' });

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const data = await robApi.robValidation(projectId);
      setState({ loading: false, data, hidden: false, error: '' });
    } catch (e) {
      // 404 = flag off / not available → hide entirely; other errors → inline retry.
      if (e && e.status === 404) setState({ loading: false, data: null, hidden: true, error: '' });
      else setState({ loading: false, data: null, hidden: false, error: e.message || 'Could not load agreement' });
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function exportCsv() {
    try {
      const res = await fetch(robApi.robValidationCsvUrl(projectId), { credentials: 'include' });
      if (!res.ok) throw new Error('Export failed');
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a'); a.href = url; a.download = 'rob-guided-vs-reviewer.csv';
        document.body.appendChild(a); a.click(); a.remove();
      } finally { URL.revokeObjectURL(url); }
    } catch { setState(s => ({ ...s, error: 'Export failed' })); }
  }

  if (state.hidden) return null;

  const d = state.data;
  const overall = d && d.overall;
  const kap = (k) => (k == null || Number.isNaN(k) ? '—' : Number(k).toFixed(2));
  const pct = (p) => (p == null ? '—' : `${Math.round(Number(p) * 100)}%`);

  return (
    <div style={{ ...card, marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Icon name="activity" size={14} />
        <span style={{ fontSize: 12, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Guided vs reviewer agreement</span>
        <span aria-hidden style={{ flex: 1 }} />
        {d && d.n > 0 && <button onClick={exportCsv} style={ghost}><Icon name="download" size={13} /> Export CSV</button>}
      </div>

      {state.loading ? (
        <div style={{ fontSize: 12.5, color: C.muted }}>Loading agreement…</div>
      ) : state.error ? (
        <ErrorBox msg={state.error} onRetry={load} />
      ) : !d || !d.n ? (
        <p style={{ fontSize: 12.5, color: C.muted, margin: 0, lineHeight: 1.6 }}>
          No paired guided-vs-reviewer judgements yet. Run a guided appraisal, accept some suggestions, and finalise an
          assessment — the weighted-κ agreement between the suggestions and your final judgements appears here.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {/* Overall weighted κ + interpretation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.txt, fontFamily: MONO }}>{kap(overall && overall.kappa)}</div>
              <div style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>weighted κ</div>
            </div>
            <div style={{ fontSize: 12.5, color: C.txt2, lineHeight: 1.55 }}>
              {overall && overall.interpretation && <div><strong style={{ color: C.txt }}>{overall.interpretation}</strong> agreement</div>}
              <div style={{ color: C.muted }}>
                {overall && overall.ciLo != null && overall.ciHi != null ? `95% CI ${kap(overall.ciLo)}–${kap(overall.ciHi)} · ` : ''}
                {pct(d.percentAgreement)} exact agreement over {d.n} judgement{d.n === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          {/* Per-domain agreement */}
          {Array.isArray(d.byDomain) && d.byDomain.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: C.muted, fontFamily: MONO }}>
                    <th style={vth}>Domain</th><th style={vth}>κ</th><th style={vth}>Exact agreement</th><th style={vth}>n</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byDomain.map(row => (
                    <tr key={row.domainId} style={{ borderTop: `1px solid ${C.brd}` }}>
                      <td style={vtd}>{row.domainId}</td>
                      <td style={{ ...vtd, fontFamily: MONO }}>{kap(row.kappa)}</td>
                      <td style={vtd}>{pct(row.agreementPct)}</td>
                      <td style={{ ...vtd, fontFamily: MONO, color: C.muted }}>{row.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Disagreement queue */}
          {Array.isArray(d.disagreements) && d.disagreements.length > 0 && (
            <div>
              <div style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Disagreements ({d.disagreements.length})
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {d.disagreements.slice(0, 40).map((dz, i) => {
                  const sa = judgmentStyle(dz.a); const sb = judgmentStyle(dz.b);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 11px', borderRadius: 8, background: C.surf, border: `1px solid ${C.brd}`, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11.5, fontFamily: MONO, color: C.txt2 }}>{dz.domainId}</span>
                      {dz.studyId && <span style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{dz.studyId}</span>}
                      <span aria-hidden style={{ flex: 1 }} />
                      <span title="Suggested" style={vChip(sa)}>Suggested: {sa.label}</span>
                      <Icon name="arrowRight" size={12} />
                      <span title="Reviewer final" style={vChip(sb)}>Final: {sb.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const vth = { padding: '4px 10px 8px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em' };
const vtd = { padding: '7px 10px', color: C.txt2 };
function vChip(st) {
  return { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, fontFamily: FONT, color: st.fg, background: st.bg, border: `1px solid ${alpha(st.hex, 0.5)}`, whiteSpace: 'nowrap' };
}

function OwnerOnlyNotice() {
  return (
    <div style={{ ...card, textAlign: 'center', padding: '36px 24px', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'inline-flex', padding: 14, borderRadius: '50%', background: alpha(C.acc, '12'), marginBottom: 14 }}><Icon name="lock" size={22} /></div>
      <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 6px' }}>Risk of Bias is managed by the project owner</h3>
      <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.6, margin: 0 }}>
        Risk-of-bias assessments are kept with the owner&apos;s copy of this project. Ask the owner to share results or add you as the assessor.
      </p>
    </div>
  );
}

function Center({ children }) { return <div style={{ padding: 50, textAlign: 'center', color: C.muted, fontSize: 13.5, lineHeight: 1.6 }}>{children}</div>; }
function ErrorBox({ msg, onRetry }) {
  return (
    <div style={{ padding: '12px 14px', background: alpha(C.red, '12'), border: `1px solid ${alpha(C.red, '40')}`, borderRadius: 8, color: C.red, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <span>{msg}</span>
      {onRetry && <button onClick={onRetry} style={{ ...ghost, color: C.txt2 }}><Icon name="refresh" size={13} /> Retry</button>}
    </div>
  );
}

const card = { background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: '14px 16px' };
const ghost = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt2, fontSize: 12.5, cursor: 'pointer', fontFamily: FONT };
const miniBtn = { padding: '4px 10px', background: 'transparent', border: `1px solid ${C.brd2}`, borderRadius: 6, color: C.txt2, fontSize: 11.5, cursor: 'pointer', fontFamily: FONT };
