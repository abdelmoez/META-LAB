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
import RobTrafficLight from './RobTrafficLight.jsx';
import { judgmentStyle } from './judgmentStyle.js';
import { ROB_TOOLS, normalizeRobTool, isRobToolActive } from '../../research-engine/rob/tools.js';
import { articleStatusOf } from './articleStatus.js';

export default function ProjectRobPanel({ projectId, embedded = false, canEdit = true, robTool, onSelectTool, onContinue, onWorkspaceChange }) {
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
      setStudies(
        (studiesRes && Array.isArray(studiesRes.studies))
          ? studiesRes.studies
          : (Array.isArray(proj.studies) ? proj.studies.map(s => ({ ...s, source: 'screening' })) : []),
      );
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
      // Only send an instrument when guided appraisal is ON; when OFF the server
      // defaults to RoB 2 (behaviour identical to today).
      if (appraisalOn && instrumentId) body.instrumentId = instrumentId;
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

  return (
    <div>
      {error && <div style={{ marginBottom: 14 }}><ErrorBox msg={error} onRetry={reload} /></div>}

      <ToolSelector selected={selectedTool} canEdit={canEdit} onSelect={onSelectTool} appraisalOn={appraisalOn} />

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', margin: '4px 0 16px' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 2px' }}>{project.name}</h2>
          <p style={{ fontSize: 12.5, color: C.txt2, margin: 0 }}>
            {assessments.length} assessment{assessments.length === 1 ? '' : 's'} · {appraisalOn ? 'RoB 2 / ROBINS-I' : 'RoB 2 (effect of assignment)'} · per result
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

      {assessments.length > 0 && (
        <div style={{ ...card, marginBottom: 22 }}>
          <div style={{ fontSize: 12, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Summary (traffic light)</div>
          <RobTrafficLight matrix={matrix} title={`${project.name} — Risk of bias${matrix && matrix.instrumentId === 'ROBINS-I' ? ' (ROBINS-I)' : ' (RoB 2)'}`} />
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
                appraisalOn={appraisalOn}
                defaultInstrument={selectedTool}
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
            {orphans.map(a => <AssessmentRow key={a.id} a={a} canEdit={canEdit} orphan onOpen={() => setOpenId(a.id)} onRemove={() => removeAssessment(a.id)} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── RoB tool selector (prompt28 Part 4) ────────────────────────────────────────
// P14 — ROBINS-I only becomes selectable when the guided-appraisal flag is ON; with
// it OFF the panel offers RoB 2 only (behaviour identical to before P14).
function ToolSelector({ selected, canEdit, onSelect, appraisalOn }) {
  const interactive = canEdit && typeof onSelect === 'function';
  return (
    <div style={{ ...card, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon name="scale" size={14} />
        <span style={{ fontSize: 12, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Assessment tool</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ROB_TOOLS.map(t => {
          // RoB 2 is always available; ROBINS-I only when guided appraisal is ON.
          const active = isRobToolActive(t.id) && (t.id === 'RoB2' || appraisalOn);
          const on = selected === t.id;
          const clickable = interactive && active;
          return (
            <button
              key={t.id}
              type="button"
              disabled={!clickable}
              onClick={clickable ? () => { if (t.id !== selected) onSelect(t.id); } : undefined}
              title={active ? t.description : `${t.label} — under development`}
              aria-pressed={on}
              style={{
                position: 'relative', textAlign: 'left', minWidth: 168, flex: '1 1 168px', maxWidth: 240,
                padding: '10px 12px', borderRadius: 10, fontFamily: FONT,
                cursor: clickable ? 'pointer' : (active ? 'default' : 'not-allowed'),
                background: on ? alpha(C.acc, '14') : C.surf,
                border: `1px solid ${on ? alpha(C.acc, '60') : C.brd}`,
                opacity: active ? 1 : 0.6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: on ? C.acc : C.txt }}>{t.label}</span>
                {on && active && <Icon name="check" size={13} />}
                {!active && (
                  <span style={{ fontSize: 8.5, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.04em', color: C.muted, background: alpha(C.txt, '0c'), border: `1px solid ${C.brd}`, borderRadius: 5, padding: '1px 5px', textTransform: 'uppercase', marginLeft: 'auto' }}>Soon</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.35 }}>{t.sublabel}</div>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 9, lineHeight: 1.5 }}>
        {appraisalOn
          ? <><strong style={{ color: C.txt2 }}>RoB 2</strong> (randomised trials) and <strong style={{ color: C.txt2 }}>ROBINS-I</strong> (non-randomised studies) are available; other instruments are in development. Your choice is saved for this project.</>
          : <>Only <strong style={{ color: C.txt2 }}>RoB 2</strong> is available today; other instruments are in development. Your choice is saved for this project.</>}
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
  onToggleCreate, onCreate, onCancelCreate, appraisalOn, defaultInstrument,
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

        {canEdit && creating && <CreateForm onCancel={onCancelCreate} onCreate={onCreate} appraisalOn={appraisalOn} defaultInstrument={defaultInstrument} />}

        {list.length > 0 ? (
          <div style={{ marginTop: 12, display: 'grid', gap: 7 }}>
            {list.map((a) => <AssessmentRow key={a.id} a={a} canEdit={canEdit} onOpen={() => onOpenAssessment(a)} onRemove={() => onRemoveAssessment(a.id)} />)}
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

function AssessmentRow({ a, canEdit, onOpen, onRemove, orphan }) {
  const st = judgmentStyle(a.overall);
  // prompt46 #3 — default-allow when the backend omits canMutate (no regression for owners);
  // the server still enforces the real permission on every write.
  const canMutate = canEdit && (a.canMutate !== false);
  const toolLabel = a.instrumentLabel || (a.instrumentId === 'RoB2' ? 'RoB 2' : a.instrumentId) || 'Tool unknown';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 8, background: C.surf, border: `1px solid ${C.brd}` }}>
      {/* 79.md §1 — colour + REDUNDANT symbol (judgement icon) so completed/incomplete
          judgements are distinguishable without relying on colour alone. */}
      <span title={st.label} aria-label={`Risk of bias: ${st.label}`} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', background: st.bg, color: st.fg, border: `1px solid ${alpha(st.fg, '55')}`, flexShrink: 0, marginTop: 1, alignSelf: 'flex-start' }}>
        <Icon name={st.icon} size={11} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button onClick={onOpen} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, color: C.txt, fontSize: 13, padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.resultLabel || 'Result'} — <span style={{ color: st.fg, fontWeight: 700 }}>{st.label}</span> {a.status === 'complete' ? '· finalised' : '· draft'}{orphan ? ` · study ${a.studyId}` : ''}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          <ToolChip label={toolLabel} />
          {a.source && <SourceBadge source={a.source} small />}
          {a.reviewerName && <span style={{ fontSize: 10.5, color: C.muted }}>Started by {a.reviewerName}</span>}
        </div>
      </div>
      <button onClick={onOpen} style={miniBtn}>{canMutate ? 'Open' : 'View'}</button>
      {canMutate
        ? <button onClick={onRemove} style={{ ...miniBtn, color: C.muted }} title="Delete"><Icon name="trash" size={12} /></button>
        : (canEdit && <span title="Only the assessment creator, a project leader, or the owner can delete this assessment" style={{ display: 'inline-flex', padding: '4px 6px', color: C.dim }}><Icon name="lock" size={12} /></span>)}
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

// P14 — the two guided-appraisal instruments offered at assessment creation.
const INSTRUMENT_CHOICES = [
  { id: 'RoB2', label: 'RoB 2', sublabel: 'Randomised trials' },
  { id: 'ROBINS-I', label: 'ROBINS-I', sublabel: 'Non-randomised studies' },
];

function CreateForm({ onCancel, onCreate, appraisalOn, defaultInstrument }) {
  const [label, setLabel] = useState('');
  // Instrument selector only when guided appraisal is ON; otherwise RoB 2 (omitted
  // → server default) exactly as today.
  const [instrument, setInstrument] = useState(
    appraisalOn ? (normalizeRobTool(defaultInstrument) || 'RoB2') : 'RoB2',
  );
  const submit = () => onCreate(label, appraisalOn ? instrument : undefined);
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {appraisalOn && (
        <div>
          <div style={{ fontSize: 10.5, fontFamily: MONO, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Instrument</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {INSTRUMENT_CHOICES.map(ci => {
              const on = instrument === ci.id;
              return (
                <button key={ci.id} type="button" onClick={() => setInstrument(ci.id)} aria-pressed={on} title={ci.sublabel}
                  style={{ textAlign: 'left', padding: '7px 11px', borderRadius: 9, cursor: 'pointer', fontFamily: FONT,
                    background: on ? alpha(C.acc, '14') : C.surf, border: `1px solid ${on ? alpha(C.acc, '60') : C.brd2}` }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: on ? C.acc : C.txt }}>{ci.label}</span>
                    {on && <Icon name="check" size={12} />}
                  </span>
                  <span style={{ fontSize: 10.5, color: C.muted }}>{ci.sublabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder="Result / outcome being assessed (e.g. Mortality at 6 months)"
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
          style={{ flex: 1, minWidth: 240, padding: '8px 11px', background: C.surf, border: `1px solid ${C.brd2}`, borderRadius: 8, color: C.txt, fontSize: 13, fontFamily: FONT }} />
        <button onClick={submit} style={{ ...ghost, background: C.acc, color: C.accText, border: `1px solid ${C.acc}` }}>Start assessment</button>
        <button onClick={onCancel} style={ghost}>Cancel</button>
      </div>
    </div>
  );
}

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
