/* ════════════ WORKSPACE UI PRIMITIVES ════════════
   Small presentational leaf components extracted VERBATIM from
   meta-lab-3-patched.jsx (prompt46 Phase 3).

   NOTE: SectionHeader / InfoBox / HelpTip / CriteriaList ALSO exist in
   src/features/protocol/picoUi.jsx. These are the MONOLITH's OWN copies and
   are intentionally NOT merged with that module — behaviour parity. */
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { alpha as themeAlpha } from "../../theme/tokens.js";
import { Icon } from "../../components/icons.jsx";
import { AI_FEATURES_ENABLED } from "../../services/aiService.js";
import { C, btnS, tagS } from "./styles.js";

/* prompt36 Task 5 — the app-standard on/off SWITCH (sliding pill + knob), matching
   the screening Toggle. Used for Project Control's Blind mode / Restrict chat so
   they read as real switches, not ambiguous text pills. Accessible (role="switch",
   aria-checked, real <button> ⇒ keyboard-activatable); the knob/track transitions
   are disabled under prefers-reduced-motion via the .ml-switch-knob CSS rule. */
export function SwitchToggle({on,busy,onClick,onLabel="On",offLabel="Off",ariaLabel}){
  return(
    <button type="button" role="switch" aria-checked={!!on} aria-label={ariaLabel} disabled={busy} onClick={onClick}
      style={{display:"inline-flex",alignItems:"center",gap:10,background:"none",border:"none",padding:0,cursor:busy?"default":"pointer",opacity:busy?0.6:1,fontFamily:"inherit"}}>
      <span aria-hidden="true" style={{width:38,height:22,borderRadius:11,position:"relative",flexShrink:0,boxSizing:"border-box",background:on?C.acc2:C.dim,border:`1px solid ${on?C.acc2:C.brd2}`,transition:"background 0.2s ease,border-color 0.2s ease"}}>
        <span className="ml-switch-knob" style={{position:"absolute",top:1,left:on?17:1,width:18,height:18,borderRadius:"50%",background:"#fff",boxShadow:"0 1px 3px rgba(0,0,0,0.35)",transition:"left 0.2s var(--ease-out)"}}/>
      </span>
      <span style={{fontSize:12,fontWeight:700,color:on?C.acc:C.muted,minWidth:62,textAlign:"left"}}>{on?onLabel:offLabel}</span>
    </button>
  );
}
export function SectionHeader({icon,title,desc,badge}){
  return(<div style={{marginBottom:28}}>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:7}}>
      <div style={{
        width:34,height:34,borderRadius:10,
        background:`${themeAlpha(C.acc,'18')}`,
        border:`1px solid ${themeAlpha(C.acc,'28')}`,
        display:"flex",alignItems:"center",justifyContent:"center",
        color:C.acc,flexShrink:0,
      }}>{/* <Icon> renders nothing for unknown names, so stray emoji props show nothing */}
        <Icon name={icon} size={15}/></div>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <h2 style={{margin:0,fontSize:18,fontWeight:700,letterSpacing:-0.4,color:C.txt,lineHeight:1.2}}>{title}</h2>
        {badge&&<span style={{...tagS("blue")}}>{badge}</span>}
      </div>
    </div>
    {desc&&<p style={{margin:0,fontSize:12.5,color:C.muted,lineHeight:1.7,paddingLeft:46}}>{desc}</p>}
  </div>);
}
export function InfoBox({children,color}){
  const col=color||C.acc;
  return(<div style={{
    background:`${themeAlpha(col,'0c')}`,border:`1px solid ${themeAlpha(col,'22')}`,borderLeft:`3px solid ${themeAlpha(col,'80')}`,
    borderRadius:10,padding:"12px 16px",marginTop:14,fontSize:12.5,color:C.txt2,lineHeight:1.7,
  }}>{children}</div>);
}
/* Hover tooltip with a help "?" trigger — for beginner guidance. prompt24
   follow-up: the bubble is PORTALED to <body> so it can never be clipped by an
   overflow-hidden table/card or a transformed ancestor (the old position:absolute
   z-300 bubble was getting trapped — e.g. the "?" beside Measure / Convert data in
   Data Extraction). It floats above everything at z 10000, flips below the "?"
   when there's no room above, and is clamped into the viewport. */
export function HelpTip({text}){
  const[show,setShow]=useState(false);
  const[pos,setPos]=useState(null);
  const ref=useRef(null);
  const place=useCallback(()=>{
    const el=ref.current; if(!el) return;
    const r=el.getBoundingClientRect();
    const W=260, margin=8;
    let left=r.left+r.width/2-W/2;
    left=Math.max(margin,Math.min(left,window.innerWidth-W-margin));
    const above=r.top>150; // room above the trigger?
    setPos(above
      ?{left,bottom:window.innerHeight-r.top+8,top:"auto"}
      :{left,top:r.bottom+8,bottom:"auto"});
  },[]);
  const open=useCallback(()=>{place();setShow(true);},[place]);
  useEffect(()=>{
    if(!show) return undefined;
    const onMove=()=>place();
    window.addEventListener("scroll",onMove,true);
    window.addEventListener("resize",onMove);
    return ()=>{window.removeEventListener("scroll",onMove,true);window.removeEventListener("resize",onMove);};
  },[show,place]);
  return(<span ref={ref} style={{position:"relative",display:"inline-flex",marginLeft:6}}
    onMouseEnter={open} onMouseLeave={()=>setShow(false)}>
    <span style={{
      width:16,height:16,borderRadius:"50%",
      border:`1px solid ${C.brd2}`,color:C.muted,background:C.card2,
      fontSize:9,fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center",cursor:"help",
      transition:"border-color 0.15s",
    }}>?</span>
    {show&&pos&&createPortal(<span style={{
      position:"fixed",top:pos.top,bottom:pos.bottom,left:pos.left,
      background:C.surf,color:C.txt2,fontSize:11,fontWeight:400,lineHeight:1.6,
      padding:"9px 13px",borderRadius:8,width:260,maxWidth:"92vw",zIndex:10000,
      border:`1px solid ${C.brd2}`,boxShadow:"0 12px 40px var(--t-shadow)",
      textTransform:"none",letterSpacing:0,pointerEvents:"none",
    }}>{text}</span>,document.body)}
  </span>);
}
/* Small AI button used for refine actions.
   Renders nothing while AI features are hidden (prompt6 Task 16). */
export function AIButton({onClick,loading,label,disabled}){
  if(!AI_FEATURES_ENABLED) return null; // AI features hidden pending future implementation
  return(<button onClick={onClick} disabled={loading||disabled}
    style={{
      ...btnS("ghost"),fontSize:11,color:C.purp,borderColor:themeAlpha(C.purp,'44'),
      opacity:(loading||disabled)?0.5:1,
      background:loading?`${themeAlpha(C.purp,'0a')}`:"transparent",
    }}>
    {loading?<><span className="spin-ico">⟳</span> Working…</>:<>✦ {label}</>}
  </button>);
}
export function ProgressBar({done,total,color}){
  const col=color||C.acc;
  const pct=total?Math.round((done/total)*100):0;
  const barColor=pct===100?C.grn:col;
  return(<div style={{display:"flex",alignItems:"center",gap:10}}>
    <div style={{flex:1,background:C.brd,borderRadius:99,height:5,overflow:"hidden"}}>
      <div style={{width:`${pct}%`,height:"100%",background:barColor,borderRadius:99,transition:"width 0.45s cubic-bezier(0.23,1,0.32,1)"}}/>
    </div>
    <span style={{fontSize:11,fontFamily:"'IBM Plex Mono',monospace",color:pct===100?C.grn:C.muted,minWidth:50,textAlign:"right"}}>{done}/{total}</span>
  </div>);
}

/* Tiny stacked-fraction helper for equation display (no TeX dependency) */
export const MATH_FONT="'STIX Two Math','Cambria Math','Times New Roman',Georgia,serif";
export function Frac({num,den}){
  return(<span style={{display:"inline-flex",flexDirection:"column",alignItems:"center",verticalAlign:"middle",margin:"0 3px",lineHeight:1.3}}>
    <span style={{borderBottom:`1px solid ${C.txt2}`,padding:"0 5px"}}>{num}</span>
    <span style={{padding:"0 5px"}}>{den}</span>
  </span>);
}

/* CriteriaList — structured inclusion/exclusion editor (prompt23 Task 8C). Each
   criterion is its own add/removable row instead of one opaque blob, but it
   serialises back to the SAME "• item\n• item" string stored in pico.incl /
   pico.excl — so screening keyword extraction, export, and older projects keep
   working unchanged. */
export function CriteriaList({ value, onChange, accent, placeholders }) {
  const rows = String(value || "").split("\n").map(l => l.replace(/^\s*[•\-*]\s?/, ""));
  const eff = rows.length ? rows : [""];
  const commit = (next) => onChange(next.map(r => "• " + r).join("\n"));
  const upd = (i, v) => { const n = [...eff]; n[i] = v; commit(n); };
  const add = () => commit([...eff, ""]);
  const remove = (i) => { const n = eff.filter((_, j) => j !== i); commit(n.length ? n : [""]); };
  const ph = placeholders || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
      {eff.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input value={r} onChange={e => upd(i, e.target.value)}
            placeholder={ph[i] || ph[ph.length - 1] || "Add a criterion…"}
            style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 6, padding: "7px 10px", color: C.txt, fontSize: 12, fontFamily: "inherit" }} />
          <button type="button" onClick={() => remove(i)} title="Remove criterion" aria-label="Remove criterion"
            style={{ background: "none", border: `1px solid ${C.brd}`, color: C.muted, cursor: "pointer", borderRadius: 6, width: 28, height: 28, flexShrink: 0, lineHeight: 1, fontSize: 15 }}>×</button>
        </div>
      ))}
      <button type="button" onClick={add}
        style={{ alignSelf: "flex-start", background: themeAlpha(accent, '14'), border: `1px dashed ${themeAlpha(accent, '55')}`, color: accent, cursor: "pointer", borderRadius: 6, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", marginTop: 2 }}>
        + Add criterion
      </button>
    </div>
  );
}
