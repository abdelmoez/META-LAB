/* ════════════ WORKSPACE OVERVIEW / HEADER / CONTROL TABS ════════════
   Extracted VERBATIM from meta-lab-3-patched.jsx (prompt46 Phase 6b). Holds:
   AuditPanel, ProjectTitle, ProjectHeaderBar, ScreeningWorkspaceFrame,
   EmbeddedScreening, OverviewTab, ControlTab. No logic changes — only the
   imports below were added so the moved code resolves identically. */
import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { screeningApi } from "../../screening/api-client/screeningApi.js";
import SiftProject from "../../screening/pages/SiftProject.jsx";
import { useRealtime } from "../../hooks/useRealtime.js";
import PresenceIndicator from "../../screening/components/PresenceIndicator.jsx";
import { flushStorage } from "../../storage/serverStorage.js";
import { alpha as themeAlpha } from "../../theme/tokens.js";
import { Icon } from "../../components/icons.jsx";
import Tooltip from "../../components/Tooltip.jsx";
import MetaLabChatLauncher from "../../components/chat/MetaLabChatLauncher.jsx";
import NotificationsBell from "../../components/NotificationsBell.jsx";
import UserMenu from "../../components/UserMenu.jsx";
import ProjectMembersPanel from "../../screening/tabs/ProjectMembersPanel.jsx";
import { api } from "../../api-client/apiClient.js";
import { useEntitlements } from "../../entitlements/useEntitlements.js";
import { runMeta } from "../../../research-engine/statistics/monolithStats.js";
import { C, btnS, inp, tagS } from "../ui/styles.js";
import { SwitchToggle, SectionHeader, InfoBox, ProgressBar } from "../ui/primitives.jsx";
import { TABS, readinessCheck, stepStatus, auditProject, projectPerms, linkedSiftId, CTRL_STATUS_OPTIONS } from "../projectHelpers.js";
/* 68.md (P8) — the public-synthesis publish workflow, mounted at the END of Project
   Control. Lazy so the chunk (and its lazily-pulled public page) never enters the
   main bundle; flag-gated INTERNALLY so it renders null when `publicSynthesis` is
   off, keeping this mount a minimal, flag-free append. */
const PublishPanel = lazy(() => import("../../../features/publicSynthesis/PublishPanel.jsx"));

/* fmtDate — verbatim copy of the monolith module-local helper (the monolith
   keeps its own copy for its other consumers). */
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";

function AuditPanel({project,onClose,onJump}){
  const items=useMemo(()=>auditProject(project),[project]);
  const high=items.filter(i=>i.sev==="high"),med=items.filter(i=>i.sev==="med"),low=items.filter(i=>i.sev==="low");
  const sevMeta={high:{c:C.red,label:"Must fix",bg:"var(--t-red-bg)"},med:{c:C.yel,label:"Should address",bg:"var(--t-yel-bg)"},low:{c:C.acc,label:"Consider",bg:"var(--t-acc-bg)"}};
  const phaseTab={Plan:"pico",Search:"search",Screen:"prisma",Extract:"extraction",Analyze:"analysis",Report:"report"};
  return(<div style={{position:"fixed",inset:0,background:"#00000099",zIndex:997,display:"flex",justifyContent:"flex-end"}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{width:420,maxWidth:"92vw",background:C.surf,borderLeft:`1px solid ${C.brd}`,height:"100%",overflowY:"auto",boxShadow:"-12px 0 40px var(--t-shadow)"}}>
      <div style={{position:"sticky",top:0,background:C.surf,borderBottom:`1px solid ${C.brd}`,padding:"16px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",zIndex:1}}>
        <div>
          <div style={{fontSize:15,fontWeight:800}}>Project Audit</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>{items.length===0?"Everything looks complete":`${items.length} item${items.length===1?"":"s"} to review`}</div>
        </div>
        <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:22,cursor:"pointer",padding:0,lineHeight:1}}>×</button>
      </div>
      <div style={{padding:18}}>
        {items.length===0?(
          <div style={{textAlign:"center",padding:"40px 20px",color:C.muted}}>
            <div style={{marginBottom:12,color:C.grn}}><Icon name="checkSquare" size={36}/></div>
            <div style={{fontSize:14,color:C.grn,fontWeight:600,marginBottom:6}}>No gaps detected</div>
            <div style={{fontSize:12,lineHeight:1.6}}>Your project meets the key methodological checkpoints. Keep your documentation up to date as you finish.</div>
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:18}}>
            {[["high",high],["med",med],["low",low]].map(([sev,list])=>list.length>0&&(
              <div key={sev}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:sevMeta[sev].c}}/>
                  <span style={{fontSize:11,fontWeight:800,color:sevMeta[sev].c,letterSpacing:0.5,textTransform:"uppercase"}}>{sevMeta[sev].label}</span>
                  <span style={{fontSize:10,color:C.dim,fontFamily:"'IBM Plex Mono',monospace"}}>{list.length}</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {list.map((it,i)=>(
                    <div key={i} onClick={()=>{onJump(phaseTab[it.phase]||"pico");onClose();}}
                      style={{background:sevMeta[it.sev].bg,border:`1px solid ${themeAlpha(sevMeta[it.sev].c,'44')}`,borderLeft:`3px solid ${sevMeta[it.sev].c}`,
                        borderRadius:6,padding:"10px 12px",cursor:"pointer",transition:"all 0.12s"}}
                      onMouseEnter={e=>e.currentTarget.style.transform="translateX(-3px)"}
                      onMouseLeave={e=>e.currentTarget.style.transform="translateX(0)"}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <span style={{fontSize:9,fontWeight:700,color:sevMeta[it.sev].c,letterSpacing:0.5,textTransform:"uppercase"}}>{it.phase}</span>
                        <span style={{fontSize:10,color:C.dim}}>Go →</span>
                      </div>
                      <div style={{fontSize:12,color:C.txt,lineHeight:1.55}}>{it.msg}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>);
}

/* ════════════ PROJECT META HELPERS (prompt6 Tasks 4/15/18) ════════════ */
/* projectPerms + linkedSiftId extracted VERBATIM to
   src/frontend/workspace/projectHelpers.js (prompt46 Phase 6a) and imported at
   the top of this file. */

/* Editable project title (prompt6 Task 18) — rename goes through the REAL
   PUT /api/projects/:id (via onRename), never the autosave blob path, so the
   server-side sync-if-in-sync rename of the linked META·SIFT title fires. */
function ProjectTitle({project,canRename,onRename}){
  const[editing,setEditing]=useState(false);
  const[draft,setDraft]=useState(project.name);
  const[busy,setBusy]=useState(false);
  const[err,setErr]=useState("");
  useEffect(()=>{if(!editing){setDraft(project.name);setErr("");}},[project.id,project.name,editing]);
  const submit=async()=>{
    if(busy)return;
    const name=draft.trim();
    if(!name||name===project.name){setEditing(false);setErr("");return;}
    setBusy(true);
    const r=await onRename(project.id,name);
    setBusy(false);
    if(r.ok){setEditing(false);setErr("");}
    else if(r.error)setErr(r.error);
  };
  if(!editing) return(
    <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0,marginBottom:5}}>
      <h1 title={project.name} style={{fontSize:22,fontWeight:700,letterSpacing:-0.5,margin:0,color:C.txt,lineHeight:1.2,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{project.name}</h1>
      {canRename&&(
        <button onClick={()=>setEditing(true)} title="Rename project"
          style={{background:"none",border:`1px solid ${C.brd2}`,color:C.muted,cursor:"pointer",fontSize:11,borderRadius:6,padding:"2px 8px",lineHeight:1.5,flexShrink:0}}>✎</button>
      )}
    </div>
  );
  return(
    <div style={{minWidth:0,marginBottom:5}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <input autoFocus value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter")submit();if(e.key==="Escape"){setEditing(false);setErr("");}}}
          style={{...inp,width:340,maxWidth:"70vw",fontSize:15,fontWeight:600,padding:"6px 10px"}}/>
        <button onClick={submit} disabled={busy||!draft.trim()} style={{...btnS("primary"),fontSize:11,opacity:(busy||!draft.trim())?0.5:1}}>{busy?"Saving…":"Save"}</button>
        <button onClick={()=>{setEditing(false);setErr("");}} disabled={busy} style={{...btnS("ghost"),fontSize:11}}>Cancel</button>
      </div>
      {err&&<div style={{fontSize:11,color:C.red,marginTop:5}}>{err}</div>}
    </div>
  );
}

/* prompt24 Tasks 2/3/4/7/8/9 — UNIVERSAL PROJECT HEADER. One sticky bar shown on
   EVERY project page (Overview, PICO, Screening, Extraction, Analysis, PRISMA,
   Report, Project Control). It owns the project context (☰ menu toggle · project
   title · ▸ current-section breadcrumb · Project overview / Projects nav) and the
   single right-side utility cluster ([presence][chat][notifications][account]).
   Flex layout with min-width:0 on the title region (truncates with ellipsis) and a
   non-shrinking right cluster, so the buttons are never overlapped (Task 4). The
   one PresenceIndicator here replaces the old floating chip + the screening-only
   one (Task 8); its popover is portaled so it can't be clipped (Task 3). */
function ProjectHeaderBar({project,tab,inScreening,focus,onToggleFocus,setTab,onBackToProjects,presenceUsers,presenceLocks,totalMembers,myUserId,spId,reqMissing=0,reqMissingList,missingItems=0,onShowAudit,onReport,onExport,onJournalZip,onImport}){
  const sectionLabel=(TABS.find(t=>t.id===tab)?.label)||"Overview";
  // 79.md §3 — project export is a tier feature. The hook is FAIL-OPEN (returns true
  // while loading / on error / for admins), so a Free user only sees the locked state
  // once a concrete entitlement map has loaded; the SERVER remains the final authority.
  const ent=useEntitlements();
  const exportLocked=!ent.has('projects.export');
  // prompt30 Part 5 — compact status badges + actions shown near the title on
  // every NON-overview page (the full detailed header now lives on Overview only).
  const compact=tab!=="overview";
  const badgeBtn=(color)=>({display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:11,fontSize:11,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",cursor:"pointer",background:themeAlpha(color,'18'),border:`1px solid ${themeAlpha(color,'55')}`,color,lineHeight:1.4,flexShrink:0});
  const hdrIconBtn={...btnS("ghost"),padding:"5px 8px",borderRadius:7,display:"inline-flex",alignItems:"center"};
  return(
    <div style={{
      display:"flex",alignItems:"center",gap:10,
      padding:"8px 16px",borderBottom:`1px solid ${C.brd}`,background:C.surf,
      flexShrink:0,minHeight:50,
    }}>
      {/* Left — prompt36 Task 4: directional ARROW toggle (left=collapse when open,
          right=expand when collapsed) + tooltip + state-aware aria-label, replacing
          the old ☰ hamburger. The chevron rotates 180° to swap direction smoothly
          (disabled under prefers-reduced-motion). Then the truncating breadcrumb. */}
      <Tooltip content={focus?"Expand workflow menu":"Collapse workflow menu"} wrapStyle={{flexShrink:0}}>
        <button onClick={onToggleFocus}
          aria-label={focus?"Expand workflow menu":"Collapse workflow menu"} aria-expanded={!focus}
          style={{background:focus?themeAlpha(C.acc,'14'):"none",border:`1px solid ${focus?themeAlpha(C.acc,'40'):C.brd2}`,color:focus?C.acc:C.txt2,cursor:"pointer",borderRadius:7,padding:"5px 9px",lineHeight:1,flexShrink:0,display:"inline-flex",alignItems:"center"}}>
          <span className="ml-menu-arrow" style={{display:"inline-flex",transition:"transform 0.2s var(--ease-out)",transform:focus?"rotate(180deg)":"none"}}><Icon name="chevronLeft" size={16}/></span>
        </button>
      </Tooltip>
      <div style={{display:"flex",alignItems:"center",gap:7,fontSize:12.5,minWidth:0,flex:"1 1 auto"}}>
        <button onClick={()=>setTab("overview")} title={project?.name||""}
          style={{background:"none",border:"none",color:C.txt,fontWeight:600,cursor:"pointer",fontFamily:"inherit",fontSize:13,padding:0,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{project?.name||"Project"}</button>
        <span style={{color:C.dim,flexShrink:0}}>▸</span>
        <span style={{fontWeight:700,color:C.txt2,flexShrink:0,whiteSpace:"nowrap"}}>{sectionLabel}</span>
        {/* Compact status badges near the title (non-overview only) */}
        {compact&&reqMissing>0&&(
          <Tooltip title="Requirements missing" description={(reqMissingList&&reqMissingList.length)?reqMissingList.slice(0,6).join(' · '):`${reqMissing} requirement${reqMissing===1?'':'s'} still needed before proceeding`}>
            <button onClick={onShowAudit} aria-label={`${reqMissing} requirement${reqMissing===1?'':'s'} missing — open audit`} style={badgeBtn(C.yel)}><Icon name="alertTriangle" size={11}/>{reqMissing}</button>
          </Tooltip>
        )}
        {compact&&missingItems>0&&(
          <Tooltip title="Missing items" description={`${missingItems} item${missingItems===1?'':'s'} need attention — open the audit to review`}>
            <button onClick={onShowAudit} aria-label={`${missingItems} missing item${missingItems===1?'':'s'} — open audit`} style={badgeBtn(C.red)}><span style={{width:6,height:6,borderRadius:"50%",background:C.red,display:"inline-block",flexShrink:0}}/>{missingItems}</button>
          </Tooltip>
        )}
      </div>
      {/* Middle — section nav + compact actions (report/export/import on non-overview) */}
      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        {compact&&onReport&&<>
          <Tooltip content="Export a full report (PDF / HTML)"><button onClick={onReport} aria-label="Export report" style={hdrIconBtn}><Icon name="fileText" size={13}/></button></Tooltip>
          {onJournalZip&&(exportLocked
            ? <Tooltip content="Exporting projects isn’t included in your current plan"><button aria-label="Export journal submission package (not included in your plan)" aria-disabled="true" disabled style={{...hdrIconBtn,opacity:0.5,cursor:"not-allowed"}}><Icon name="lock" size={13}/></button></Tooltip>
            : <Tooltip content="Journal submission package (ZIP): PRISMA, forest plots, methods text & study table"><button onClick={onJournalZip} aria-label="Export journal submission package" style={hdrIconBtn}><Icon name="layers" size={13}/></button></Tooltip>)}
          {exportLocked
            ? <Tooltip content="Exporting projects isn’t included in your current plan"><button aria-label="Export project (not included in your plan)" aria-disabled="true" disabled style={{...hdrIconBtn,opacity:0.5,cursor:"not-allowed"}}><Icon name="lock" size={13}/></button></Tooltip>
            : <Tooltip content="Export project as JSON"><button onClick={onExport} aria-label="Export project" style={hdrIconBtn}><Icon name="download" size={13}/></button></Tooltip>}
          <Tooltip content="Import project JSON"><button onClick={onImport} aria-label="Import project" style={hdrIconBtn}><Icon name="upload" size={13}/></button></Tooltip>
        </>}
        {tab!=="overview"&&<button onClick={()=>setTab("overview")} title="Project overview" style={{...btnS("ghost"),fontSize:11.5,display:"inline-flex",alignItems:"center",gap:5}}><Icon name="arrowLeft" size={12}/><span className="uh-navlabel">Project overview</span></button>}
        {onBackToProjects&&<button onClick={onBackToProjects} title="Back to all projects" style={{...btnS("ghost"),fontSize:11.5,display:"inline-flex",alignItems:"center",gap:5}}><Icon name="grid" size={12}/><span className="uh-navlabel">Projects</span></button>}
      </div>
      {/* Right — single utility cluster: [presence][chat][notifications][account] */}
      <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        {spId&&<PresenceIndicator users={presenceUsers} locks={presenceLocks} totalMembers={totalMembers} myUserId={myUserId}/>}
        {project&&<MetaLabChatLauncher metaLabProjectId={project.id} projectName={project.name}/>}
        <NotificationsBell/>
        <UserMenu context="metalab" onBeforeLogout={async()=>{try{await flushStorage();}catch(_){/* best-effort */}}}/>
      </div>
    </div>
  );
}

/* prompt19/24 — full-bleed Screening workspace frame. The universal header now
   owns the breadcrumb + nav + ☰ toggle, so the frame is just the embedded engine
   filling the available height. */
function ScreeningWorkspaceFrame({project,setTab}){
  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      {/* prompt22 Task 5 — Final Review's "Continue to Data Extraction" jumps to
          the SAME project's Data Extraction stage (no separate-project handoff). */}
      <div style={{flex:1,minHeight:0}}><EmbeddedScreening project={project} onGoToExtraction={()=>setTab("extraction")}/></div>
    </div>
  );
}

/* ════════════ TAB: SCREENING (prompt18 — embedded META·SIFT engine) ════════════ */
/* The Screening stage. META·SIFT stays a separate backend engine, but here it is
   shown as ONE in-project stage: resolve (and, for the owner, silently create)
   the linked screening module, then render its full workbench inline. The user
   never "links a META·SIFT project" — it is created/repaired automatically. */
function EmbeddedScreening({project,onGoToExtraction}){
  const lid=linkedSiftId(project);
  const pid=project&&project.id;
  const[spId,setSpId]=useState(lid||null);
  const[state,setState]=useState(lid?"ready":"loading"); // loading|ready|error|disabled
  const[msg,setMsg]=useState("");
  useEffect(()=>{
    let dead=false;
    if(lid){setSpId(lid);setState("ready");return undefined;}
    if(!pid){setState("error");setMsg("Open a project to start screening.");return undefined;}
    setState("loading");
    screeningApi.getWorkspace(pid)
      .then(r=>{ if(dead)return;
        if(r&&r.screenProjectId){setSpId(r.screenProjectId);setState("ready");}
        else {setState("error");setMsg("Couldn't open the screening workspace.");} })
      .catch(e=>{ if(dead)return;
        if(e&&e.status===503){setState("disabled");setMsg(e.message||"Screening is temporarily unavailable.");}
        else if(e&&e.status===404){setState("error");setMsg("Screening is available to the project owner and its members.");}
        else {setState("error");setMsg((e&&e.message)||"Couldn't open the screening workspace.");} });
    return()=>{dead=true;};
  },[lid,pid]);

  if(state==="ready"&&spId) return <div style={{height:"100%"}}><SiftProject embedded embeddedPid={spId} onGoToExtraction={onGoToExtraction}/></div>;

  const box={maxWidth:560,margin:"48px auto",textAlign:"center",border:`1px solid ${C.brd}`,borderRadius:12,background:C.card,padding:"32px 28px"};
  if(state==="loading") return <div style={box}><div style={{fontSize:13,color:C.muted}}>Opening screening…</div></div>;
  if(state==="disabled") return <div style={{...box,borderColor:themeAlpha(C.gold,'40'),background:themeAlpha(C.gold,'08')}}><div style={{fontSize:30,marginBottom:12}}>🔧</div><div style={{fontSize:15,fontWeight:600,color:C.gold,marginBottom:8}}>Screening is temporarily unavailable</div><div style={{fontSize:13,color:C.txt2}}>{msg}</div></div>;
  return <div style={box}><div style={{fontSize:30,marginBottom:12}}>📭</div><div style={{fontSize:14,fontWeight:600,color:C.txt,marginBottom:8}}>Screening unavailable</div><div style={{fontSize:13,color:C.txt2}}>{msg}</div></div>;
}

/* ════════════ TAB: OVERVIEW (prompt6 Task 15) ════════════ */
/* Project landing page — every project-enter path lands here: identity, team,
   linked screening workspace, PICO, progress, readiness, and the next step. */
function OverviewTab({project,setTab,onJournalZip,onRValidate}){
  const lid=linkedSiftId(project);
  const linkedTitle=(project._linkedMetaSift&&project._linkedMetaSift.title)||"";
  const perms=projectPerms(project);
  // 79.md §3 — project export (incl. the journal ZIP) is a tier feature; show a locked
  // state consistent with the header instead of a generic 403 (fail-open hook; server
  // remains authoritative).
  const ent=useEntitlements();
  const exportLocked=!ent.has('projects.export');
  // Members + leaders from the linked Review Workspace (graceful when unlinked).
  const[mem,setMem]=useState({loading:!!lid,members:null,error:null});
  useEffect(()=>{
    let dead=false;
    if(!lid){setMem({loading:false,members:null,error:null});return undefined;}
    setMem({loading:true,members:null,error:null});
    screeningApi.listMembers(lid)
      .then(d=>{if(!dead)setMem({loading:false,members:d.members||[],error:null});})
      .catch(e=>{if(!dead)setMem({loading:false,members:null,error:e.message||"Couldn't load members."});});
    return()=>{dead=true;};
  },[lid]);

  // prompt19 — live Screening progress for the overview card (PRISMA-shaped roll-up).
  // prompt21 follow-up — refetch on realtime screening pokes (accept / revert /
  // decisions / status) keyed on the linked screen project (lid), so this card
  // never shows stale numbers after a Final Review change made elsewhere.
  const[scr,setScr]=useState({loading:!!project?.id,data:null});
  const loadScr=useCallback(()=>{
    if(!project?.id)return;
    fetch(`/api/screening/metalab/${project.id}/summary`,{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(d=>setScr({loading:false,data:(d&&d.linked)?d:null}))
      .catch(()=>setScr({loading:false,data:null}));
  },[project?.id]);
  useEffect(()=>{
    if(!project?.id){setScr({loading:false,data:null});return undefined;}
    setScr(s=>({loading:true,data:s.data}));
    loadScr();
    return undefined;
  },[project?.id,loadScr]);
  useRealtime({
    "handoff.updated":ev=>{if(ev?.projectId===lid)loadScr();},
    "decision.saved": ev=>{if(ev?.projectId===lid)loadScr();},
    "status.changed": ev=>{if(ev?.projectId===lid)loadScr();},
  });

  const studies=project.studies||[];
  const withES=studies.filter(s=>s.es!=="").length;
  // prompt44 item 2 — a study is POOLABLE (and thus usable by the R validation script)
  // only with a complete effect size AND 95% CI; gate the .R download on this, not on
  // withES (which counts a bare es), so the button never offers an empty script.
  const poolable=studies.filter(s=>s.es!==""&&s.lo!==""&&s.hi!=="").length;
  const status=stepStatus(project, !!scr.data?.screeningComplete); // prompt29 Part 9
  const wfTabs=TABS.filter(t=>t.phase); // workflow steps only
  const doneCount=wfTabs.filter(t=>status[t.id]==="done").length;
  const nextStep=wfTabs.find(t=>status[t.id]!=="done")||null;
  const ready=readinessCheck(project);
  const meta=runMeta(studies,"random");
  const pico=project.pico||{},prisma=project.prisma||{};
  const owner=project._owner?(project._owner.name||project._owner.email):"You";
  const leaders=(mem.members||[]).filter(m=>m.role==="leader"||m.role==="owner");

  const card={background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16};
  const secLbl={fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:9};
  const kv=(k,v)=>(<div key={k} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:12,padding:"4px 0",minWidth:0}}>
    <span style={{color:C.muted,flexShrink:0}}>{k}</span>
    <span title={String(v)} style={{color:C.txt2,textAlign:"right",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v}</span>
  </div>);

  return(<div>
    <SectionHeader icon="grid" title="Overview" desc="Where this review stands right now — team, linked screening workspace, progress, and what to do next."/>

    {/* Stat row */}
    <div className="ov-grid4" style={{marginBottom:14}}>
      {[
        {n:studies.length,l:"Studies in extraction"},
        {n:withES,l:"With effect size"},
        {n:prisma.included||"0",l:"PRISMA included"},
        {n:mem.members?mem.members.length:mem.loading?"…":"—",l:"Workspace members"},
      ].map(s=>(
        <div key={s.l} style={{...card,padding:"12px 14px",textAlign:"center"}}>
          <div className="stat-num" style={{fontSize:22,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.txt}}>{s.n}</div>
          <div style={{fontSize:10,color:C.muted,marginTop:3}}>{s.l}</div>
        </div>
      ))}
    </div>

    <div className="ov-grid2" style={{marginBottom:14}}>
      {/* Project identity */}
      <div style={card}>
        <div style={secLbl}>Project</div>
        {kv("Title",project.name)}
        {kv("Owner",owner)}
        <div style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:12,padding:"4px 0",alignItems:"center"}}>
          <span style={{color:C.muted}}>Your role</span>
          <span style={tagS(perms.isOwner?"green":perms.readOnly?"yellow":"blue")}>
            {perms.readOnly?`${perms.role} · read-only`:perms.role}
          </span>
        </div>
        {kv("Created",fmtDate(project.created||project.createdAt))}
        {kv("Last modified",fmtDate(project.modified||project.updatedAt))}
      </div>

      {/* Screening Progress (prompt19) — live PRISMA-shaped numbers from the
          Screening stage + the next recommended action. NOT general project status. */}
      <div style={{...card,borderColor:themeAlpha("var(--t-teal)","40")}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:9}}>
          <div style={{...secLbl,color:"var(--t-teal)",marginBottom:0}}>Screening Progress</div>
          {scr.loading&&<span style={{fontSize:10,color:C.muted,fontFamily:"'IBM Plex Mono',monospace"}}>…</span>}
        </div>
        {scr.data&&scr.data.prisma?(()=>{
          const p=scr.data.prisma;
          const stat=(n,l)=>(<div key={l} style={{textAlign:"center",minWidth:0}}>
            <div style={{fontSize:18,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.txt,lineHeight:1}}>{n??0}</div>
            <div style={{fontSize:9.5,color:C.muted,marginTop:3}}>{l}</div>
          </div>);
          const nextAction=(p.identified||0)===0?"Import references":((p.included||0)===0?"Screen titles & abstracts":((p.fullTextAssessed||0)>((p.fullTextExcluded||0)+(p.included||0))?"Review full text":"Send included studies to extraction"));
          return(<>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:12}}>
              {stat(p.identified,"Imported")}
              {stat(p.duplicatesRemoved,"Duplicates")}
              {stat(p.screened,"Screened")}
              {stat(p.fullTextAssessed,"Full text")}
              {stat(p.included,"Included")}
            </div>
            <div style={{fontSize:11,color:C.muted,marginBottom:11}}>Next: <strong style={{color:C.txt2}}>{nextAction}</strong></div>
          </>);
        })():(
          <div style={{fontSize:12,color:C.muted,lineHeight:1.6,marginBottom:11}}>
            Import references, remove duplicates, screen titles &amp; abstracts with your team, resolve conflicts, and assess full text — all in the Screening stage. Accepted studies flow into Data Extraction and the PRISMA numbers fill in automatically.
          </div>
        )}
        <button onClick={()=>setTab("screening")}
          style={{background:"var(--t-teal)",border:"none",color:"var(--t-acc-text)",fontSize:11.5,fontWeight:700,fontFamily:"'IBM Plex Sans',sans-serif",padding:"7px 16px",borderRadius:7,cursor:"pointer"}}>
          {((scr.data&&scr.data.prisma&&(scr.data.prisma.identified||scr.data.prisma.included))||(project._linkedMetaSift&&project._linkedMetaSift.recordCount))?"Continue screening →":"Start screening →"}
        </button>
      </div>
    </div>

    <div className="ov-grid2" style={{marginBottom:14}}>
      {/* Team */}
      <div style={card}>
        <div style={secLbl}>Team</div>
        {!lid?<div style={{fontSize:12,color:C.muted,lineHeight:1.6}}>Open the Screening stage once to set up this project's workspace, then invite collaborators here.</div>
        :mem.loading?<div style={{fontSize:12,color:C.muted}}>Loading members…</div>
        :mem.error?<div style={{fontSize:12,color:C.yel}}>⚠ {mem.error}</div>
        :(<>
          {kv("Members",String(mem.members.length))}
          {kv("Leaders",leaders.length?leaders.map(m=>m.name||m.email).join(", "):"—")}
          <div style={{marginTop:8}}>
            <button onClick={()=>setTab("control")} style={{...btnS("ghost"),fontSize:11}}>Manage members →</button>
          </div>
        </>)}
      </div>

      {/* PICO summary */}
      <div style={card}>
        <div style={secLbl}>PICO</div>
        {pico.question&&<div style={{fontSize:12,color:C.txt2,lineHeight:1.6,marginBottom:8,fontStyle:"italic"}}>“{pico.question}”</div>}
        {(pico.P||pico.I||pico.C||pico.O)
          ?[["P",pico.P],["I",pico.I],["C",pico.C],["O",pico.O]].map(([k,v])=>v?(
            <div key={k} style={{display:"flex",gap:8,fontSize:11.5,padding:"2px 0"}}>
              <span style={{fontWeight:800,color:C.acc,minWidth:14,flexShrink:0}}>{k}</span>
              <span style={{color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v}</span>
            </div>):null)
          :(!pico.question&&<div style={{fontSize:12,color:C.muted}}>No PICO yet — start in the PICO &amp; Question tab.</div>)}
      </div>
    </div>

    {/* Progress */}
    <div style={{...card,marginBottom:14}}>
      <div style={secLbl}>Progress</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
        <div>
          <div style={{fontSize:11,color:C.muted,marginBottom:5}}>Workflow steps complete</div>
          <ProgressBar done={doneCount} total={wfTabs.length}/>
        </div>
        <div>
          <div style={{fontSize:11,color:C.muted,marginBottom:5}}>Extraction — studies with an effect size</div>
          <ProgressBar done={withES} total={studies.length}/>
        </div>
      </div>
      <div style={{fontSize:11,color:C.muted,marginTop:12,lineHeight:1.7}}>
        PRISMA: <strong style={{color:C.txt}}>{prisma.dbs||"0"}</strong> identified · <strong style={{color:C.txt}}>{prisma.dedupe||"0"}</strong> duplicates removed · <strong style={{color:C.red}}>{prisma.excTA||"0"}</strong> excluded (title/abstract) · <strong style={{color:C.red}}>{prisma.excFull||"0"}</strong> full-text excluded · <strong style={{color:C.grn}}>{prisma.included||"0"}</strong> included
        {meta&&<> · pooled: <strong style={{color:C.grn}}>k={meta.k}, I²={meta.I2}%</strong></>}
      </div>
    </div>

    <div className="ov-grid2">
      {/* Meta-analysis readiness */}
      <div style={{...card,borderColor:themeAlpha((ready.ok?C.grn:C.yel),'44')}}>
        <div style={{...secLbl,color:ready.ok?C.grn:C.yel}}>Meta-analysis readiness</div>
        {ready.ok
          ?<div style={{fontSize:12.5,color:C.grn,lineHeight:1.6}}>✓ All prerequisites met — PICO, databases, and search strategy are in place.</div>
          :(<div>
            <div style={{fontSize:12,color:C.muted,marginBottom:6}}>{ready.missing.length} requirement{ready.missing.length===1?"":"s"} missing:</div>
            {ready.missing.map((m,i)=>(
              <div key={i} style={{display:"flex",gap:7,fontSize:11.5,color:C.txt2,padding:"2px 0",lineHeight:1.5}}>
                <span style={{color:C.yel,flexShrink:0}}>⚠</span><span>{m}</span>
              </div>))}
          </div>)}
      </div>

      {/* Next suggested step */}
      <div style={{...card,borderColor:themeAlpha(C.acc,'40')}}>
        <div style={{...secLbl,color:C.acc}}>Next suggested step</div>
        {nextStep?(<>
          <div style={{fontSize:13,fontWeight:700,color:C.txt,marginBottom:4,display:"flex",alignItems:"center",gap:6}}><Icon name={nextStep.icon} size={14}/>{nextStep.label}</div>
          <div style={{fontSize:11.5,color:C.muted,lineHeight:1.6,marginBottom:10}}>
            {status[nextStep.id]==="partial"?"Started but not finished — pick up where you left off.":"The first incomplete step in the PRISMA workflow."}
          </div>
          <button onClick={()=>setTab(nextStep.id)} style={{...btnS("primary"),fontSize:12}}>Go to {nextStep.label} →</button>
        </>):(
          <div style={{fontSize:12.5,color:C.grn,lineHeight:1.6}}>✓ Every workflow step is complete — run the audit, export your report, and submit.</div>
        )}
      </div>
    </div>

    {/* prompt44 items 4 + 2 — Export & validation surfaced on the Overview: the
        one-click journal submission ZIP (reuses the existing export engine) and the
        R (metafor) validation script. Both are quick to reach without leaving Overview. */}
    {(onJournalZip||onRValidate)&&(
    <div style={{...card,marginTop:14}}>
      <div style={secLbl}>Export &amp; validation</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:14}}>
        {onJournalZip&&(
          <div style={{display:"flex",flexDirection:"column",gap:8,minWidth:0}}>
            <div style={{fontSize:12.5,fontWeight:700,color:C.txt}}>Journal submission package</div>
            <div style={{fontSize:11.5,color:C.muted,lineHeight:1.55,flex:1}}>One ZIP with the PRISMA diagram, per-outcome forest plots, methods text, study table, and a full report.</div>
            {exportLocked
              ? <button disabled title="Exporting projects isn’t included in your current plan" style={{...btnS("ghost"),fontSize:12,alignSelf:"flex-start",opacity:0.6,cursor:"not-allowed"}}><Icon name="lock" size={13}/> Not in your plan</button>
              : <button onClick={()=>onJournalZip()} style={{...btnS("primary"),fontSize:12,alignSelf:"flex-start"}}><Icon name="layers" size={13}/> Build ZIP package</button>}
          </div>
        )}
        {onRValidate&&(
          <div style={{display:"flex",flexDirection:"column",gap:8,minWidth:0}}>
            <div style={{fontSize:12.5,fontWeight:700,color:C.txt}}>R validation script</div>
            <div style={{fontSize:11.5,color:C.muted,lineHeight:1.55,flex:1}}>A <code style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:10.5}}>metafor</code> script that independently reproduces every outcome's pooled estimate, CI, and heterogeneity — run it in R/RStudio to validate the numbers.</div>
            <button onClick={()=>onRValidate()} disabled={poolable<2}
              title={poolable<2?"Add an effect size and 95% CI to at least 2 studies first":"Download the R validation script"}
              style={{...btnS("ghost"),fontSize:12,alignSelf:"flex-start",opacity:poolable<2?0.5:1,cursor:poolable<2?"not-allowed":"pointer"}}>
              <Icon name="download" size={13}/> Download .R script
            </button>
          </div>
        )}
      </div>
      <div style={{fontSize:10.5,color:C.muted,marginTop:11,lineHeight:1.5}}>The R script is generated locally and runs in your own R environment — PecanRev never executes R code.</div>
    </div>
    )}
  </div>);
}

/* ════════════ TAB: PROJECT CONTROL (prompt6 Task 4) ════════════ */
/* META·LAB-side port of META·SIFT's ProjectControlTab + MembersTab. ALL member
   and status operations go through screeningApi against the LINKED ScreenProject
   — the shared Review Workspace is the single source of truth. Permissions:
   owner everything; leaders manage members except the owner and cannot assign
   the Leader preset (server-enforced; mirrored here); members/viewers get a
   read-only rendering. Unlinked → project info + "Create & link" card. */
/* CTRL_STATUS_OPTIONS extracted VERBATIM to
   src/frontend/workspace/projectHelpers.js (prompt46 Phase 6a) and imported at
   the top of this file. */
function ControlTab({project,onAnnotate,setTab,presence,onDeleted}){
  const lid=linkedSiftId(project);
  const perms=projectPerms(project);
  const amProjectOwner=!project._shared;
  // prompt32 Task 10 — owner-only Danger Zone (archive / delete) state.
  const[archiveBusy,setArchiveBusy]=useState(false);
  const[archiveErr,setArchiveErr]=useState("");
  const[delOpen,setDelOpen]=useState(false);
  const[delConfirm,setDelConfirm]=useState("");
  const[delBusy,setDelBusy]=useState(false);
  const[delErr,setDelErr]=useState("");
  const isArchived=!!project._archived;
  const toggleArchive=async()=>{
    setArchiveBusy(true);setArchiveErr("");
    try{
      if(isArchived) await api.projects.unarchive(project.id);
      else await api.projects.archive(project.id);
      onAnnotate(project.id,{_archived:!isArchived,_archivedAt:isArchived?null:new Date().toISOString()});
    }catch(e){setArchiveErr(e.message||"Could not change the archive state.");}
    setArchiveBusy(false);
  };
  const doDelete=async()=>{
    if(delConfirm.trim()!==String(project.name||"").trim()){setDelErr("The name you typed does not match.");return;}
    setDelBusy(true);setDelErr("");
    try{
      // Owner-confirmed soft delete: server enforces owner-only, writes an audit
      // row, and (cascadeLinked) soft-deletes the linked screening workspace + its
      // RoB assessments. Then leave the workspace and let the dashboard reload.
      await api.projects.confirmDelete(project.id,{confirmName:delConfirm.trim(),cascadeLinked:true});
      if(onDeleted) onDeleted(project.id);
    }catch(e){setDelErr(e.message||"Could not delete the project.");setDelBusy(false);}
  };
  // Workspace membership payload — also resolves OUR authority in the workspace.
  const[data,setData]=useState({loading:!!lid,members:[],isOwner:false,isLeader:false,canManageMembers:false,myRole:null,error:null});
  const[sp,setSp]=useState(null);   // linked ScreenProject row (status, flags)
  const[spErr,setSpErr]=useState("");
  const[statusBusy,setStatusBusy]=useState(false);
  const[statusFlash,setStatusFlash]=useState(false);
  // prompt34 Task 9 — Screening & collaboration settings (blind mode / restrict
  // chat / required reviewers) edited here against the linked ScreenProject, which
  // is the SINGLE source of truth (Screening Settings shows the same values).
  const[spBusy,setSpBusy]=useState(false);
  const[spFlash,setSpFlash]=useState(false);
  const[linkBusy,setLinkBusy]=useState(false);
  const[linkErr,setLinkErr]=useState("");

  const loadMembers=useCallback(async()=>{
    if(!lid){setData(d=>({...d,loading:false}));return;}
    setData(d=>({...d,loading:true,error:null}));
    try{
      const d=await screeningApi.listMembers(lid);
      setData({loading:false,members:d.members||[],isOwner:!!d.isOwner,isLeader:!!d.isLeader,
        canManageMembers:!!d.canManageMembers,myRole:d.myRole||null,error:null});
    }catch(e){
      setData({loading:false,members:[],isOwner:false,isLeader:false,canManageMembers:false,myRole:null,
        error:e.message||"Couldn't load the workspace members."});
    }
  },[lid]);
  const loadSp=useCallback(async()=>{
    if(!lid){setSp(null);return;}
    try{setSp(await screeningApi.getProject(lid));setSpErr("");}
    catch(e){setSpErr(e.message||"Couldn't load the linked workspace.");}
  },[lid]);
  useEffect(()=>{loadMembers();loadSp();},[loadMembers,loadSp]);

  // prompt24 — member add/edit/remove now lives entirely inside the shared
  // MembersTab; ControlTab only needs `data` for the Project-info owner row and to
  // hand MembersTab our workspace authority hint.
  const canManageStatus=!!(sp&&(sp.canManageSettings||sp.isLeader||sp.isOwner));
  const ownerRow=data.members.find(m=>m.isOwner||m.role==="owner")||null;

  // Project status lives on the ScreenProject (the workspace) — optimistic + revert.
  const setStatus=async(v)=>{
    if(!sp)return;
    const prev=sp.progressStatus;
    setStatusBusy(true);setSpErr("");
    setSp(s=>({...s,progressStatus:v}));
    try{
      await screeningApi.updateProject(lid,{progressStatus:v});
      // 81.md — propagate onto the parent project's transient annotation so sibling
      // views reading project._linkedMetaSift.progressStatus (dashboard card, Overview
      // progress, Stitch stepper) update instantly, matching the twin ProjectControlTab
      // which calls refreshProject(). Spread the existing summary so recordCount/title/
      // decidedCount are preserved (only progressStatus changes).
      onAnnotate(project.id,{_linkedMetaSift:{...(project._linkedMetaSift||{}),progressStatus:v}});
      setStatusFlash(true);setTimeout(()=>setStatusFlash(false),1400);
    }catch(e){
      setSp(s=>({...s,progressStatus:prev}));
      setSpErr(e.message||"Could not change the project status.");
    }
    setStatusBusy(false);
  };
  // prompt34 Task 9 — optimistic save of a Screening setting onto the linked
  // ScreenProject (blindMode / chatRestricted / requiredScreeningReviewers). The
  // server re-validates owner/leader authority; we revert on failure.
  const saveSpSetting=async(patch)=>{
    if(!lid||!sp)return;
    const prev=sp;
    setSpBusy(true);setSpErr("");
    setSp(s=>({...s,...patch}));
    try{
      await screeningApi.updateProject(lid,patch);
      setSpFlash(true);setTimeout(()=>setSpFlash(false),1400);
    }catch(e){
      setSp(prev);
      setSpErr(e.message||"Could not save the setting.");
    }
    setSpBusy(false);
  };
  // "Create & link META·SIFT" (owner only — the server validates ownership).
  const createLink=async()=>{
    setLinkBusy(true);setLinkErr("");
    try{
      const created=await screeningApi.createProject({title:project.name||"Screening project",linkedMetaLabProjectId:project.id});
      // Refresh the local annotations so the whole app sees the link instantly.
      onAnnotate(project.id,{_linkedMetaSift:{id:created.id,title:created.title}});
    }catch(e){setLinkErr(e.message||"Could not create the screening project.");}
    setLinkBusy(false);
  };

  const card={background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:14};
  const secLbl={fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:0.8,textTransform:"uppercase",marginBottom:9};
  const spStatus=(sp&&sp.progressStatus)||"not_started";
  const statusMeta=CTRL_STATUS_OPTIONS.find(o=>o.value===spStatus);

  return(<div>
    <SectionHeader icon="sliders" title="Project Control"
      desc="Manage this review project — status, members, roles, and permissions — all in one place."
      badge={`Your role · ${perms.role}`}/>

    {perms.readOnly&&(
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:C.txt2,display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:14}}>🔒</span>
        Read-only access — you can view project information here, but only the owner or a leader can change settings.
      </div>
    )}

    {/* Project info */}
    <div style={card}>
      <div style={secLbl}>Project info</div>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",columnGap:24,rowGap:2}}>
        {[["Name",project.name],
          // prompt25 Task 5 — prefer the LIVE owner (project._owner, resolved fresh
          // from the User row server-side) so a rename shows immediately; members
          // list (now also live) is only a fallback.
          ["Owner",project._owner?(project._owner.name||project._owner.email):(ownerRow?(ownerRow.name||ownerRow.email):"You")],
          ["Created",fmtDate(project.created||project.createdAt)],
          ["Last modified",fmtDate(project.modified||project.updatedAt)],
          ["Studies in extraction",String((project.studies||[]).length)],
          // 78.md #1 — the linked screening workspace is BACKEND infrastructure; Project
          // Control presents ONE unified PecanRev project, so no "Screening" linkage row
          // is exposed here (admin diagnostics live in the Ops Console). The link itself
          // (linkedSiftId / _linkedMetaSift) and its sync are untouched.
        ].map(([k,v])=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:12,padding:"4px 0",minWidth:0}}>
            <span style={{color:C.muted,flexShrink:0}}>{k}</span>
            <span title={String(v)} style={{color:C.txt2,textAlign:"right",minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v}</span>
          </div>
        ))}
      </div>
    </div>

    {/* Project status. 78.md #1 — the engine-linkage framing (linked-workspace status,
        "Open Screening" handoff, "set up on open" prompt) is removed so Project Control
        reads as ONE unified project; the status itself is a normal project setting. The
        underlying linkage + sync are unchanged. Status is only editable once the shared
        workspace exists (linked) — it lives on the same shared record the team uses. */}
    {lid&&(
      <div style={card}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={secLbl}>Project status{statusFlash&&<span style={{marginLeft:8,color:C.grn,textTransform:"none",letterSpacing:0,fontFamily:"'IBM Plex Mono',monospace"}}>✓ saved</span>}</div>
        </div>
        {spErr&&<div style={{fontSize:11.5,color:C.red,marginBottom:8}}>{spErr}</div>}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:12.5,color:C.txt,fontWeight:600}}>Status</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>Where this review stands — shared across the whole project team.</div>
          </div>
          {canManageStatus?(
            <select value={spStatus} disabled={statusBusy}
              onChange={e=>setStatus(e.target.value)}
              style={{...inp,width:"auto",fontSize:12,padding:"6px 10px",opacity:statusBusy?0.6:1}}>
              {CTRL_STATUS_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ):(
            <span style={tagS(spStatus==="done"?"green":spStatus==="in_progress"?"blue":"")}>{statusMeta?statusMeta.label:spStatus}</span>
          )}
        </div>
      </div>
    )}

    {/* Collaboration & permissions (prompt34 Task 9). Blind mode, restrict chat and the
        required-reviewers quorum are edited HERE as the main place; they persist on the
        project's shared record (the single source of truth the whole team reads). 78.md
        #1 — the section is named for what the user manages (collaboration), not for the
        backend engine that stores it. */}
    {lid&&(
      <div style={card}>
        <div style={secLbl}>Collaboration &amp; permissions{spFlash&&<span style={{marginLeft:8,color:C.grn,textTransform:"none",letterSpacing:0,fontFamily:"'IBM Plex Mono',monospace"}}>✓ saved</span>}</div>
        {!canManageStatus&&<div style={{fontSize:11.5,color:C.muted,marginBottom:10,lineHeight:1.5}}>You can view these settings. Only the owner or a leader can change them.</div>}
        {spErr&&<div style={{fontSize:11.5,color:C.red,marginBottom:8}}>{spErr}</div>}
        {/* Blind mode */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:12.5,color:C.txt,fontWeight:600}}>Blind mode</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.45}}>Hide author / journal info from reviewers during screening.</div>
          </div>
          {canManageStatus
            ? <SwitchToggle on={!!sp?.blindMode} busy={spBusy} onClick={()=>saveSpSetting({blindMode:!sp?.blindMode})} ariaLabel={`Blind mode — currently ${sp?.blindMode?"on":"off"}`} onLabel="On" offLabel="Off"/>
            : <span style={tagS(sp?.blindMode?"gold":"")}>{sp?.blindMode?"On":"Off"}</span>}
        </div>
        {/* Restrict chat */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",borderTop:`1px solid ${C.brd}`,marginTop:12,paddingTop:12}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:12.5,color:C.txt,fontWeight:600}}>Restrict chat</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.45}}>When on, only the project owner and leaders can post — everyone else is read-only. Mute an individual member instead with their Chat permission.</div>
          </div>
          {canManageStatus
            ? <SwitchToggle on={!!sp?.chatRestricted} busy={spBusy} onClick={()=>saveSpSetting({chatRestricted:!sp?.chatRestricted})} ariaLabel={`Restrict chat — currently ${sp?.chatRestricted?"on":"off"}`} onLabel="Restricted" offLabel="Open"/>
            : <span style={tagS(sp?.chatRestricted?"gold":"")}>{sp?.chatRestricted?"Restricted":"Open"}</span>}
        </div>
        {/* Required reviewers */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",borderTop:`1px solid ${C.brd}`,marginTop:12,paddingTop:12}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:12.5,color:C.txt,fontWeight:600}}>Required reviewers</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.45}}>Independent title &amp; abstract decisions needed before a record can advance to Final Review. The research standard is 2; only the owner or a leader can change it.</div>
          </div>
          {canManageStatus
            ? <select value={sp?.requiredScreeningReviewers??2} disabled={spBusy} aria-label="Required reviewers"
                onChange={e=>saveSpSetting({requiredScreeningReviewers:parseInt(e.target.value,10)})}
                style={{...inp,width:"auto",fontSize:12,padding:"6px 10px",opacity:spBusy?0.6:1}}>
                {[2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n} reviewers</option>)}
              </select>
            : <span style={tagS("blue")}>{sp?.requiredScreeningReviewers??2} reviewers</span>}
        </div>
      </div>
    )}

    {/* Members & permissions (prompt24 Task 6) — reuses the SAME polished, grouped
        MembersTab as Screening Settings (Owner ▸ Leaders ▸ Members ▸ Viewers, role
        badges, presets, live presence/location) so the two never drift. The linked
        workspace (ScreenProject) is the single source of truth. */}
    <div style={card}>
      <div style={secLbl}>Members &amp; permissions</div>
      {!lid?(
        <div style={{fontSize:12,color:C.muted,lineHeight:1.6}}>
          Open the <strong style={{color:C.txt}}>Screening</strong> stage once to set up this project's workspace, then invite collaborators here —
          everyone you add participates across the whole project according to their permissions.
        </div>
      ):(
        <ProjectMembersPanel
          pid={lid}
          project={sp||project}
          access={{isLeader:data.isLeader,myRole:data.myRole}}
          presence={presence}
          refreshProject={()=>{loadMembers();loadSp();}}
          leaveRedirect="/app"
        />
      )}
    </div>

    <InfoBox>💡 This is the project's shared team — the source of truth for owner, leaders, members, roles, and permissions. Changes here apply across the whole project immediately. Leaders can manage members but cannot edit the owner or assign the Leader preset.</InfoBox>

    {/* prompt32 Task 10 — Danger Zone (OWNER ONLY). Archive is reversible; Delete
        is an owner-confirmed soft delete (server-enforced owner-only + audit log)
        that also removes the linked screening workspace and its RoB assessments. */}
    {amProjectOwner&&(
      <div style={{...card,border:`1px solid ${themeAlpha(C.red,'50')}`,background:themeAlpha(C.red,'08')}}>
        <div style={{...secLbl,color:C.red}}>Danger zone</div>
        {/* Archive / Unarchive */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",paddingBottom:12,borderBottom:`1px solid ${C.brd}`}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:12.5,color:C.txt,fontWeight:600}}>{isArchived?"Unarchive project":"Archive project"}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>{isArchived?"Restore this project to your active dashboard.":"Hide this project from the active dashboard. Reversible — nothing is deleted."}</div>
          </div>
          <button onClick={toggleArchive} disabled={archiveBusy} style={{...btnS("ghost"),fontSize:11.5,opacity:archiveBusy?0.6:1}}>
            <Icon name="folder" size={12}/> {archiveBusy?"Working…":(isArchived?"Unarchive":"Archive")}
          </button>
        </div>
        {archiveErr&&<div style={{fontSize:11.5,color:C.red,marginTop:8}}>{archiveErr}</div>}
        {/* Delete */}
        <div style={{paddingTop:12}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:12.5,color:C.txt,fontWeight:600}}>Delete project</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.5}}>
                Permanently remove this project from your dashboard, including its Data Extraction studies, linked Screening records, and Risk-of-Bias assessments. This cannot be undone from here.
              </div>
            </div>
            {!delOpen&&<button onClick={()=>{setDelOpen(true);setDelErr("");setDelConfirm("");}} style={{...btnS("ghost"),fontSize:11.5,color:C.red,borderColor:themeAlpha(C.red,'50')}}><Icon name="trash" size={12}/> Delete project</button>}
          </div>
          {delOpen&&(
            <div style={{marginTop:12,padding:12,borderRadius:8,background:C.bg,border:`1px solid ${themeAlpha(C.red,'40')}`}}>
              <div style={{fontSize:12,color:C.txt2,marginBottom:8,lineHeight:1.5}}>
                Type the project name <b style={{color:C.txt}}>{project.name}</b> to confirm deletion.
              </div>
              <input value={delConfirm} onChange={e=>setDelConfirm(e.target.value)} placeholder={project.name||"Project name"} disabled={delBusy}
                style={{...inp,width:"100%",marginBottom:10}}/>
              {delErr&&<div style={{fontSize:11.5,color:C.red,marginBottom:8}}>{delErr}</div>}
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button onClick={doDelete} disabled={delBusy||delConfirm.trim()!==String(project.name||"").trim()}
                  style={{...btnS("primary"),fontSize:11.5,background:C.red,borderColor:C.red,opacity:(delBusy||delConfirm.trim()!==String(project.name||"").trim())?0.5:1}}>
                  {delBusy?"Deleting…":"Permanently delete"}
                </button>
                <button onClick={()=>{setDelOpen(false);setDelErr("");setDelConfirm("");}} disabled={delBusy} style={{...btnS("ghost"),fontSize:11.5}}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}

    {/* 68.md (P8) — Public synthesis page. Renders null when the `publicSynthesis`
        flag is off or the viewer can't manage the project (quiet note otherwise). */}
    <Suspense fallback={null}>
      <PublishPanel projectId={project.id}/>
    </Suspense>
  </div>);
}

export { AuditPanel, ProjectTitle, ProjectHeaderBar, ScreeningWorkspaceFrame, EmbeddedScreening, OverviewTab, ControlTab };
