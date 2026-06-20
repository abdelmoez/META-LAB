/* ════════════ SCREENING / PRISMA TABS (extracted prompt46 Phase 6d — verbatim) ════════════
   Moved VERBATIM from meta-lab-3-patched.jsx: ScreeningModule, MetaSiftPrismaSync,
   PRISMATab, PrismaFigureExport. No logic changes — only import wiring.

   The components keep using the monolith-derived shared modules (C/btnS/inp from
   ui/styles.js; HelpTip/SectionHeader from ui/primitives.jsx; reference parsers;
   svgBuilders; exportCore) and the SAME openExportDialog singleton trampoline
   (via ../exportDialogBridge.js) that MetaLab registers into. */
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { alpha as themeAlpha } from "../../theme/tokens.js";
import { C, btnS, inp } from "../ui/styles.js";
import { HelpTip, SectionHeader } from "../ui/primitives.jsx";
import { parseReferences, dedupeRecords } from "../../../research-engine/import-export/referenceParsers.js";
import { SVG_XML_HEADER, presetTag, buildPrismaSVG } from "../charts/svgBuilders.js";
import { rasterizeSvg, downloadBlob, downloadText } from "../../components/exportCore.js";
import { openExportDialog } from "../exportDialogBridge.js";

/* uid — module-local util replicated verbatim from the monolith (only PRISMATab's
   addR uses it here). */
const uid = () => Math.random().toString(36).slice(2, 10);

/* ════════════ SCREENING MODULE (import + dual-reviewer triage) ════════════ */
export function ScreeningModule({project,updateProject,activeId,updNested}){
  const records=project.records||[];
  const fileRef=useRef(null);
  const[importMsg,setImportMsg]=useState("");
  const[filter,setFilter]=useState("all");
  const[q,setQ]=useState("");
  const[reviewer,setReviewer]=useState(1);
  const[showImport,setShowImport]=useState(records.length===0);

  const setRecords=(next)=>updateProject(activeId,p=>({...p,records:typeof next==="function"?next(p.records||[]):next}));

  const onFile=async(e)=>{
    const files=Array.from(e.target.files||[]);
    if(!files.length) return;
    let allNew=[],fmts=[];
    for(const f of files){
      const text=await f.text();
      const {records:parsed,format}=parseReferences(text,f.name);
      if(parsed.length){ allNew=allNew.concat(parsed); fmts.push(`${f.name}: ${parsed.length} (${format})`); }
      else fmts.push(`${f.name}: 0 — unrecognised format`);
    }
    if(allNew.length){
      const {merged,dupCount,added}=dedupeRecords(records,allNew);
      setRecords(merged);
      setImportMsg(`Imported ${added} record${added!==1?"s":""} · ${dupCount} flagged as duplicate${dupCount!==1?"s":""}. ${fmts.join(" · ")}`);
      setShowImport(false);
    } else {
      setImportMsg(`No records parsed. ${fmts.join(" · ")}`);
    }
    if(fileRef.current) fileRef.current.value="";
  };

  const setDecision=(id,field,val)=>setRecords(rs=>rs.map(r=>r.id===id?{...r,[field]:r[field]===val?"":val}:r));
  const delRecord=(id)=>setRecords(rs=>rs.filter(r=>r.id!==id&&r.dupOf!==id));
  const clearAll=()=>{ setRecords([]); setImportMsg(""); setShowImport(true); };

  const consensus=(r)=>{
    const a=r.decision, b=r.reviewer2;
    if(r.dupOf) return "dup";
    if(!a&&!b) return "pending";
    if(a&&b){ if(a===b) return a; return "conflict"; }
    return a||b||"pending";
  };
  const counts=useMemo(()=>{
    const c={total:records.length,pending:0,include:0,exclude:0,maybe:0,conflict:0,dup:0};
    records.forEach(r=>{ const d=consensus(r); if(c[d]!==undefined)c[d]++; });
    return c;
  },[records]);

  const visible=records.filter(r=>{
    const d=consensus(r);
    if(filter!=="all"&&d!==filter) return false;
    if(q){ const hay=(r.title+" "+r.authors+" "+r.journal+" "+r.year+" "+r.abstract).toLowerCase(); if(!hay.includes(q.toLowerCase())) return false; }
    return true;
  });

  const syncToPrisma=()=>{
    const dups=records.filter(r=>r.dupOf).length;
    const afterDup=records.filter(r=>!r.dupOf);
    const excluded=afterDup.filter(r=>consensus(r)==="exclude").length;
    const included=afterDup.filter(r=>consensus(r)==="include").length;
    updateProject(activeId,p=>({...p,prisma:{...p.prisma,
      dbs:String(records.length),
      dedupe:String(dups),
      excTA:String(excluded),
      included:String(included),
    }}));
    setImportMsg(`PRISMA numbers updated: ${records.length} identified, ${dups} duplicates, ${excluded} excluded at screening, ${included} included.`);
  };

  const decBtn=(r,field,val,label,color)=>{
    const on=r[field]===val;
    return <button onClick={()=>setDecision(r.id,field,val)} style={{
      padding:"3px 9px",borderRadius:4,cursor:"pointer",fontSize:10,fontWeight:700,
      border:`1px solid ${on?color:C.brd}`,background:on?`${themeAlpha(color,'25')}`:"transparent",color:on?color:C.muted
    }}>{label}</button>;
  };
  const conColor={include:C.grn,exclude:C.red,maybe:C.yel,conflict:C.purp,pending:C.dim,dup:C.dim};

  return(<div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:20}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:12}}>
      <div style={{fontSize:12,fontWeight:800,color:C.acc,letterSpacing:0.5}}>📥 TITLE / ABSTRACT SCREENING</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button onClick={()=>setShowImport(s=>!s)} style={{...btnS("ghost"),fontSize:11}}>{showImport?"▲ Hide import":"＋ Import references"}</button>
        {records.length>0&&<button onClick={syncToPrisma} style={{...btnS("primary"),fontSize:11}}>↻ Update PRISMA counts</button>}
        {records.length>0&&<button onClick={clearAll} style={{...btnS("danger"),fontSize:11}}>Clear all</button>}
      </div>
    </div>

    {showImport&&(
      <div style={{background:C.bg,border:`1px dashed ${C.brd}`,borderRadius:8,padding:16,marginBottom:14,textAlign:"center"}}>
        <input ref={fileRef} type="file" multiple accept=".ris,.nbib,.bib,.txt,.xml" onChange={onFile} style={{display:"none"}}/>
        <div style={{fontSize:13,color:C.txt,marginBottom:6}}>Import your search results to screen them here</div>
        <div style={{fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.6}}>
          Export from each database as <strong style={{color:C.txt}}>RIS</strong>, <strong style={{color:C.txt}}>PubMed .nbib</strong>, <strong style={{color:C.txt}}>BibTeX</strong>, or <strong style={{color:C.txt}}>EndNote XML</strong>.<br/>Duplicates across files are detected automatically by DOI, PMID, then title+year.
        </div>
        <button onClick={()=>fileRef.current&&fileRef.current.click()} style={btnS("primary")}>Choose file(s)…</button>
      </div>
    )}
    {importMsg&&<div style={{fontSize:11,color:C.grn,marginBottom:12,lineHeight:1.5}}>{importMsg}</div>}

    {records.length===0?(
      <div style={{fontSize:12,color:C.muted,padding:"8px 0"}}>No references imported yet. You can still enter PRISMA numbers manually below.</div>
    ):(<>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
        {[["all","All",C.txt],["pending","Pending",C.dim],["include","Include",C.grn],["maybe","Maybe",C.yel],["exclude","Exclude",C.red],["conflict","Conflicts",C.purp],["dup","Duplicates",C.dim]].map(([f,label,color])=>(
          <button key={f} onClick={()=>setFilter(f)} style={{
            padding:"4px 10px",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600,
            border:`1px solid ${filter===f?color:C.brd}`,background:filter===f?`${themeAlpha(color,'22')}`:"transparent",color:filter===f?color:C.muted
          }}>{label} {f==="all"?counts.total:counts[f]||0}</button>
        ))}
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search titles/abstracts…" style={{...inp,width:200,fontSize:11,marginLeft:"auto"}}/>
      </div>
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:10,fontSize:11,color:C.muted}}>
        <span>Acting as:</span>
        {[1,2].map(n=><button key={n} onClick={()=>setReviewer(n)} style={{...btnS(reviewer===n?"primary":"ghost"),fontSize:10,padding:"3px 10px"}}>Reviewer {n}</button>)}
        <HelpTip text="Screen as Reviewer 1, then switch to Reviewer 2 to screen independently. Disagreements appear as Conflicts to resolve — the dual-reviewer standard for systematic reviews."/>
      </div>

      <div style={{maxHeight:520,overflowY:"auto",display:"flex",flexDirection:"column",gap:8}}>
        {visible.length===0?<div style={{fontSize:12,color:C.dim,padding:16,textAlign:"center"}}>No records in this view.</div>:
        visible.map(r=>{
          const dec=consensus(r);
          const dupTitle=r.dupOf?(records.find(x=>x.id===r.dupOf)||{}).title:"";
          return(
          <div key={r.id} style={{border:`1px solid ${r.dupOf?C.dim:themeAlpha(conColor[dec],"55")}`,borderLeft:`3px solid ${conColor[dec]}`,borderRadius:6,padding:"10px 12px",background:C.bg,opacity:r.dupOf?0.6:1}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:C.txt,lineHeight:1.4}}>{r.title||"(untitled record)"}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{r.authors||"—"}{r.year?` · ${r.year}`:""}{r.journal?` · ${r.journal}`:""}</div>
                {r.doi&&<div style={{fontSize:10,color:C.dim,marginTop:1,fontFamily:"'IBM Plex Mono',monospace"}}>doi:{r.doi}{r.pmid?` · PMID:${r.pmid}`:""}</div>}
                {r.abstract&&<details style={{marginTop:5}}><summary style={{fontSize:10,color:C.acc,cursor:"pointer"}}>Abstract</summary><div style={{fontSize:11,color:C.muted,marginTop:4,lineHeight:1.55}}>{r.abstract}</div></details>}
                {r.dupOf&&<div style={{fontSize:10,color:C.red,marginTop:4}}>⚠ Duplicate of: {dupTitle?dupTitle.slice(0,60):"another record"}</div>}
              </div>
              <div style={{flexShrink:0,textAlign:"right"}}>
                {!r.dupOf&&<>
                  <div style={{display:"flex",gap:4,marginBottom:5,justifyContent:"flex-end"}}>
                    {decBtn(r,reviewer===1?"decision":"reviewer2","include","✓ Incl",C.grn)}
                    {decBtn(r,reviewer===1?"decision":"reviewer2","maybe","? Maybe",C.yel)}
                    {decBtn(r,reviewer===1?"decision":"reviewer2","exclude","✗ Excl",C.red)}
                  </div>
                  <div style={{fontSize:9,color:C.dim}}>
                    R1: <span style={{color:conColor[r.decision]||C.dim}}>{r.decision||"—"}</span> · R2: <span style={{color:conColor[r.reviewer2]||C.dim}}>{r.reviewer2||"—"}</span>
                  </div>
                  {dec==="conflict"&&<div style={{fontSize:10,color:C.purp,fontWeight:700,marginTop:3}}>⚑ Conflict</div>}
                </>}
                <button onClick={()=>delRecord(r.id)} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:14,marginTop:4}}>×</button>
              </div>
            </div>
            {dec==="conflict"&&!r.dupOf&&(
              <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.brd}`,display:"flex",gap:6,alignItems:"center"}}>
                <span style={{fontSize:10,color:C.purp,fontWeight:700}}>Resolve to:</span>
                <button onClick={()=>setRecords(rs=>rs.map(x=>x.id===r.id?{...x,decision:"include",reviewer2:"include"}:x))} style={{...btnS("ghost"),fontSize:10,padding:"2px 8px",color:C.grn,borderColor:themeAlpha(C.grn,'55')}}>Include</button>
                <button onClick={()=>setRecords(rs=>rs.map(x=>x.id===r.id?{...x,decision:"exclude",reviewer2:"exclude"}:x))} style={{...btnS("ghost"),fontSize:10,padding:"2px 8px",color:C.red,borderColor:themeAlpha(C.red,'55')}}>Exclude</button>
              </div>
            )}
          </div>);
        })}
      </div>
      <div style={{marginTop:12,fontSize:11,color:C.muted,lineHeight:1.6,background:C.bg,border:`1px solid ${C.brd}`,borderRadius:6,padding:"8px 12px"}}>
        <strong style={{color:C.txt}}>{counts.include}</strong> include · <strong style={{color:C.txt}}>{counts.maybe}</strong> maybe · <strong style={{color:C.txt}}>{counts.exclude}</strong> exclude · <strong style={{color:C.purp}}>{counts.conflict}</strong> conflicts · <strong style={{color:C.dim}}>{counts.dup}</strong> duplicates · <strong style={{color:C.dim}}>{counts.pending}</strong> pending. Click <em>Update PRISMA counts</em> to push these into the flow diagram.
      </div>
    </>)}
  </div>);
}

/* META·SIFT link — auto-fills the PRISMA flow from the linked screening project (Part 12).
   The manual ScreeningModule above is preserved in source but no longer rendered:
   title/abstract screening is now owned by META·SIFT. project.records is never deleted. */
export function MetaSiftPrismaSync({project,updateProject,activeId,setTab}){
  const[st,setSt]=useState({loading:true});
  const[creating,setCreating]=useState(false);
  const apply=(summary)=>{
    const p=summary.prisma;
    const accepted=Array.isArray(summary.acceptedStudies)?summary.acceptedStudies:[];
    updateProject(activeId,proj=>{
      const cur=proj.prisma||{};
      const next={...cur,
        dbs:String(p.identified), reg:"0", other:"0",
        dedupe:String(p.duplicatesRemoved),
        excTA:String(p.excludedTitleAbstract),
        excFull:String(p.fullTextExcluded),
        included:String(p.included),
      };
      const samePrisma=["dbs","reg","other","dedupe","excTA","excFull","included"].every(k=>String(cur[k]||"")===String(next[k]||""));
      // Pull-merge accepted second-review studies into Data Extraction (BUG 5).
      // Idempotent: match by screeningRecordId / DOI / PMID / normalized title so
      // re-syncing never creates duplicates, and a stale-state autosave can't drop them.
      const existing=Array.isArray(proj.studies)?proj.studies:[];
      const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
      const dup=(st)=>existing.some(e=>
        (st.screeningRecordId&&e.screeningRecordId===st.screeningRecordId)||
        (st.doi&&e.doi&&String(e.doi).toLowerCase().trim()===String(st.doi).toLowerCase().trim())||
        (st.pmid&&e.pmid&&String(e.pmid).trim()===String(st.pmid).trim())||
        (norm(st.title)&&norm(e.title)===norm(st.title))
      );
      const toAdd=accepted.filter(st=>!dup(st));
      if(samePrisma&&toAdd.length===0) return proj;
      return {...proj,
        prisma:samePrisma?cur:next,
        studies:toAdd.length?[...existing,...toAdd]:existing,
      };
    });
  };
  const load=useCallback(async(doApply)=>{
    setSt(s=>({...s,loading:true,error:null}));
    try{
      const r=await fetch(`/api/screening/metalab/${project.id}/summary`,{credentials:"include"});
      if(!r.ok){ setSt({loading:false,error:r.status===503?"Screening is currently disabled by the administrator.":"Couldn't reach the screening service."}); return; }
      const data=await r.json();
      setSt({loading:false,...data});
      if(doApply&&data.linked) apply(data);
    }catch(e){ setSt({loading:false,error:"Couldn't reach the screening service."}); }
  },[project.id]);
  useEffect(()=>{ load(true); },[load]);

  const wrap={background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:16,marginBottom:20};
  if(st.loading) return <div style={wrap}><div style={{fontSize:12,color:C.muted}}>Checking screening…</div></div>;
  if(st.error) return <div style={{...wrap,borderColor:themeAlpha(C.yel,'55')}}>
    <div style={{fontSize:12,fontWeight:800,color:C.yel,letterSpacing:0.5,marginBottom:6}}>⬡ Screening</div>
    <div style={{fontSize:12,color:C.muted,marginBottom:10}}>{st.error} You can still enter PRISMA numbers manually below.</div>
    <button onClick={()=>load(true)} style={{...btnS("ghost"),fontSize:11}}>↻ Retry</button>
  </div>;
  const createLinked=async()=>{
    setCreating(true);
    try{
      const r=await fetch("/api/screening/projects",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({title:project.name||"Screening project",linkedMetaLabProjectId:project.id})});
      if(r.ok){ const sp=await r.json(); window.location.href=`/sift-beta/projects/${sp.id}`; }
      else { setCreating(false); load(true); }
    }catch{ setCreating(false); }
  };
  if(!st.linked) return <div style={{...wrap,borderColor:themeAlpha(C.acc,'40'),background:C.bg}}>
    <div style={{fontSize:12,fontWeight:800,color:C.acc,letterSpacing:0.5,marginBottom:6}}>⬡ PRISMA fills in from Screening</div>
    <div style={{fontSize:12,color:C.muted,lineHeight:1.6,marginBottom:12}}>
      Screen your references in the <strong style={{color:C.txt}}>Screening</strong> stage — import, de-duplicate, screen titles &amp; abstracts with your team, resolve conflicts, and assess full text. As you go, these PRISMA counts fill in automatically and accepted studies flow into Data Extraction.
    </div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      {setTab&&<button onClick={()=>setTab("screening")} style={btnS("primary")}>Go to Screening →</button>}
      <button onClick={()=>load(true)} style={btnS("ghost")}>↻ Sync now</button>
    </div>
  </div>;
  const p=st.prisma;
  return <div style={{...wrap,borderColor:themeAlpha(C.grn,'55')}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:8}}>
      <div style={{fontSize:12,fontWeight:800,color:C.grn,letterSpacing:0.5,minWidth:0,flex:"1 1 auto"}}>⬡ PRISMA — auto-filled from Screening</div>
      <div style={{display:"flex",gap:8,minWidth:0}}>
        <button onClick={()=>load(true)} style={{...btnS("ghost"),fontSize:11}}>↻ Sync now</button>
        {setTab&&<button onClick={()=>setTab("screening")} style={{...btnS("primary"),fontSize:11}}>Open Screening →</button>}
      </div>
    </div>
    <div style={{fontSize:11,color:C.muted,lineHeight:1.7}}>
      <strong style={{color:C.txt}}>{p.identified}</strong> identified · <strong style={{color:C.txt}}>{p.duplicatesRemoved}</strong> duplicates removed · <strong style={{color:C.txt}}>{p.screened}</strong> screened · <strong style={{color:C.red}}>{p.excludedTitleAbstract}</strong> excluded (title/abstract) · <strong style={{color:C.txt}}>{p.fullTextAssessed}</strong> full-text assessed · <strong style={{color:C.red}}>{p.fullTextExcluded}</strong> full-text excluded · <strong style={{color:C.grn}}>{p.included}</strong> included → Data Extraction.
    </div>
    <div style={{fontSize:10,color:C.dim,marginTop:8}}>These numbers update automatically from the Screening stage. You can still fine-tune the fields below; “Sync now” re-pulls the latest.</div>
  </div>;
}

export function PRISMATab({project,updNested,updateProject,activeId,setTab}){
  const{prisma}=project;
  const ch=(k,v)=>updNested("prisma",k,v);
  const addR=()=>ch("reasons",[...prisma.reasons,{id:uid(),r:"",n:""}]);
  const updR=(id,k,v)=>ch("reasons",prisma.reasons.map(r=>r.id===id?{...r,[k]:v}:r));
  const delR=id=>ch("reasons",prisma.reasons.filter(r=>r.id!==id));
  const dbs=+prisma.dbs||0,reg=+prisma.reg||0,other=+prisma.other||0,total=dbs+reg+other;
  const dedupe=+prisma.dedupe||0,screened=total-dedupe,excTA=+prisma.excTA||0,ftRet=screened-excTA,excFull=+prisma.excFull||0,included=ftRet-excFull;
  const FlowBox=({label,n,color=C.acc,small=false})=>(
    <div style={{background:C.card,border:`2px solid ${themeAlpha(color,'55')}`,borderRadius:8,padding:small?"8px 14px":"12px 18px",textAlign:"center",minWidth:140}}>
      <div style={{fontSize:small?18:26,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color}}>{n||"?"}</div>
      <div style={{fontSize:11,color:C.muted,marginTop:2}}>{label}</div>
    </div>);
  const Arrow=()=><div style={{textAlign:"center",color:C.dim,fontSize:16,margin:"4px 0"}}>↓</div>;
  return(<div>
    <SectionHeader icon="flow" title="PRISMA Flow" desc="Title/abstract screening happens in the Screening stage (two independent reviewers, with duplicates & conflicts). As you screen, the PRISMA 2020 flow diagram below fills in automatically."/>
    {updateProject&&<MetaSiftPrismaSync project={project} updateProject={updateProject} activeId={activeId} setTab={setTab}/>}
    <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:20}}>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {[{title:"IDENTIFICATION",fields:[["dbs","Records from databases"],["reg","Records from registers"],["other","Records from other sources"],["dedupe","Duplicates removed"]]},
          {title:"SCREENING",fields:[["excTA","Excluded after title/abstract"],["excFull","Excluded after full text"]]},
          {title:"INCLUDED",fields:[["included","Studies included (override)"],["qual","In qualitative synthesis"],["quant","In meta-analysis"]]}
        ].map(({title,fields})=>(
          <div key={title} style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:14}}>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1,marginBottom:10}}>{title}</div>
            {fields.map(([k,label])=>(
              <div key={k} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <label style={{fontSize:12,flex:1,color:C.muted}}>{label}</label>
                <input type="number" min="0" value={prisma[k]||""} onChange={e=>ch(k,e.target.value)}
                  style={{...inp,width:80,textAlign:"right",fontFamily:"'IBM Plex Mono',monospace"}}/>
              </div>
            ))}
            {title==="SCREENING"&&(<div style={{marginTop:8}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,marginBottom:6}}>
                <span>Exclusion reasons (full text)</span>
                <button onClick={addR} style={{...btnS("ghost"),padding:"1px 8px",fontSize:10}}>+ Add</button>
              </div>
              {prisma.reasons.map(r=>(
                <div key={r.id} style={{display:"flex",gap:6,marginBottom:5}}>
                  <input value={r.r} onChange={e=>updR(r.id,"r",e.target.value)} placeholder="Reason" style={{...inp,flex:3,fontSize:11}}/>
                  <input type="number" value={r.n} onChange={e=>updR(r.id,"n",e.target.value)} placeholder="n" style={{...inp,width:55,fontSize:11,textAlign:"right",fontFamily:"'IBM Plex Mono',monospace"}}/>
                  <button onClick={()=>delR(r.id)} style={{...btnS("ghost"),padding:"2px 8px",fontSize:13,color:C.dim}}>×</button>
                </div>
              ))}
            </div>)}
          </div>
        ))}
      </div>
      <div style={{background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,padding:20,display:"flex",flexDirection:"column",alignItems:"center"}}>
        <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:1,marginBottom:16}}>LIVE FLOW DIAGRAM</div>
        <FlowBox label={`Identified (DB:${dbs} Reg:${reg} Other:${other})`} n={total||0}/>
        <Arrow/><FlowBox label="After duplicates removed" n={screened}/>
        <Arrow/>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <FlowBox label="Screened" n={screened} small/>
          <span style={{color:C.dim}}>→</span>
          <FlowBox label={`Excluded (n=${excTA})`} n={excTA} color={C.red} small/>
        </div>
        <Arrow/>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <FlowBox label="Full texts assessed" n={ftRet} small/>
          <span style={{color:C.dim}}>→</span>
          <div style={{background:C.card,border:`2px solid ${themeAlpha(C.red,'55')}`,borderRadius:8,padding:"8px 14px",minWidth:140}}>
            <div style={{fontSize:18,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:C.red,textAlign:"center"}}>{excFull||"?"}</div>
            <div style={{fontSize:11,color:C.muted,textAlign:"center",marginTop:2}}>Excluded</div>
            {prisma.reasons.filter(r=>r.r&&r.n).map(r=><div key={r.id} style={{fontSize:10,color:C.dim,marginTop:2,textAlign:"center"}}>{r.r}: {r.n}</div>)}
          </div>
        </div>
        <Arrow/><FlowBox label="Studies included" n={included} color={C.grn}/>
        {(prisma.qual||prisma.quant)&&(<><Arrow/><div style={{display:"flex",gap:10}}>
          {prisma.qual&&<FlowBox label="Qualitative synthesis" n={prisma.qual} small color={C.purp}/>}
          {prisma.quant&&<FlowBox label="Meta-analysis" n={prisma.quant} small color={C.grn}/>}
        </div></>)}
      </div>
    </div>

    {/* PUBLICATION-STYLE PRISMA FIGURE EXPORT */}
    <PrismaFigureExport project={project} prisma={prisma}/>
  </div>);
}

/* White-background PRISMA figure with preview + PNG/SVG export (via ExportDialog) */
export function PrismaFigureExport({project,prisma}){
  const[show,setShow]=useState(false);
  const opts={title:project.name||""};
  const safe=(project.name||"prisma").replace(/[^a-z0-9]/gi,"_");
  const openExport=()=>openExportDialog({
    id:"prisma-figure",
    title:`PRISMA flow diagram — ${project.name||"project"}`,
    formats:[{id:"png",label:"PNG (raster)"},{id:"svg",label:"SVG (vector)"}],
    sizing:true,
    defaults:{format:"png",presetId:"journal-1col"},
    run:async(choice)=>{
      if(choice.format==="svg"){
        const built=buildPrismaSVG(prisma,opts);
        downloadText(SVG_XML_HEADER+built.svg,`${safe}_prisma.svg`,"image/svg+xml;charset=utf-8");
        return;
      }
      const built=buildPrismaSVG(prisma,{...opts,noBg:!!choice.transparent});
      const blob=await rasterizeSvg(built.svg,built.W,built.H,
        {targetWidthPx:choice.widthPx,transparent:choice.transparent,background:"#ffffff"});
      downloadBlob(blob,`${safe}_prisma${presetTag(choice)}.png`);
    },
  });
  return(<div style={{marginTop:18,background:C.card,border:`1px solid ${themeAlpha(C.grn,'55')}`,borderRadius:8,padding:14}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:4}}>
      <div style={{fontSize:12,fontWeight:800,color:C.grn,letterSpacing:0.5}}>📄 PRISMA 2020 FLOW DIAGRAM (publication figure)</div>
      <span style={{fontSize:11,color:C.muted}}>white background · journal style</span>
    </div>
    <div style={{fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.5}}>
      A clean black-on-white box-and-arrow PRISMA 2020 diagram built from the numbers above — identification, de-duplication, screening, exclusions (with reasons), and inclusion. Drop it straight into your manuscript.
    </div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
      <button onClick={openExport} style={btnS("success")}>⬇ Export figure…</button>
      <button onClick={()=>setShow(s=>!s)} style={{...btnS("ghost"),fontSize:12}}>{show?"▲ Hide preview":"👁 Preview"}</button>
    </div>
    {show&&(()=>{const built=buildPrismaSVG(prisma,opts);return(
      <div style={{marginTop:12,background:"#fff",borderRadius:6,padding:10,overflowX:"auto",border:`1px solid ${C.brd}`}}>
        <div style={{minWidth:built.W,maxWidth:"100%"}} dangerouslySetInnerHTML={{__html:built.svg}}/>
      </div>);})()}
  </div>);
}
