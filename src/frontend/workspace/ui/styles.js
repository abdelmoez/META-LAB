/* ════════════ WORKSPACE THEME TOKENS + STYLE HELPERS ════════════
   Extracted VERBATIM from meta-lab-3-patched.jsx (prompt46 Phase 3).

   This `C` is the MONOLITH's OWN local theme-token object — it is NOT the
   same artifact as `src/frontend/theme/tokens.js`'s `C` (which is built via a
   `v()` helper and exposes extra keys like surf/gold/teal/grnBg/…). They
   resolve to the SAME CSS custom properties for the keys they share, but are
   distinct sources; keeping the monolith's copy here preserves behaviour
   parity and the exact key set the workspace relies on.

   Theme tokens — CSS custom properties defined in src/frontend/theme/tokens.js
   ([data-theme] on <html> switches night/day). Alpha tints MUST go through
   themeAlpha(C.x,'NN') — `${C.x}NN` concatenation breaks on var() strings. */
import { alpha as themeAlpha } from "../../theme/tokens.js";

export const C={
  bg:"var(--t-bg)",        // deep background
  surf:"var(--t-surf)",    // sidebar / elevated surface
  card:"var(--t-card)",    // card background
  card2:"var(--t-card2)",  // slightly lighter card for nesting
  brd:"var(--t-brd)",      // border
  brd2:"var(--t-brd2)",    // slightly lighter border
  acc:"var(--t-acc)",      // accent
  acc2:"var(--t-acc2)",    // deeper accent for hover/active
  accText:"var(--t-acc-text)", // text on accent/saturated fills (theme-aware)
  grn:"var(--t-grn)",      // green
  grn2:"var(--t-grn2)",    // deeper green
  yel:"var(--t-yel)",      // amber
  red:"var(--t-red)",      // red
  purp:"var(--t-purp)",    // purple
  txt:"var(--t-txt)",      // primary text
  txt2:"var(--t-txt2)",    // secondary text
  muted:"var(--t-muted)",  // muted text
  dim:"var(--t-dim)",      // very dim
};
export const btnS=(v="primary")=>({
  padding:"7px 16px",borderRadius:8,border:"none",cursor:"pointer",
  fontSize:12,fontFamily:"'IBM Plex Sans',sans-serif",fontWeight:600,
  transition:"transform 0.12s cubic-bezier(0.23,1,0.32,1),box-shadow 0.18s ease,filter 0.15s ease,background 0.18s ease,border-color 0.15s ease,opacity 0.15s ease",
  letterSpacing:0.2,display:"inline-flex",alignItems:"center",gap:5,whiteSpace:"nowrap",
  ...(v==="primary"?{
    background:`linear-gradient(145deg,${C.acc},${C.acc2})`,
    color:"var(--t-acc-text)",boxShadow:`0 1px 0 0 rgba(255,255,255,0.12) inset, 0 2px 12px ${themeAlpha(C.acc2,'40')}`}:
  v==="ghost"?{
    background:"transparent",color:C.txt2,
    border:`1px solid ${C.brd2}`}:
  v==="danger"?{
    background:`${themeAlpha(C.red,'10')}`,color:C.red,
    border:`1px solid ${themeAlpha(C.red,'30')}`}:
  v==="success"?{
    background:`linear-gradient(145deg,${C.grn},${C.grn2})`,
    color:"var(--t-acc-text)",boxShadow:`0 2px 10px ${themeAlpha(C.grn,'30')}`}:
  {background:C.card2,color:C.txt,border:`1px solid ${C.brd2}`})
});
export const inp={
  background:C.card,border:`1px solid ${C.brd}`,borderRadius:8,
  padding:"8px 12px",color:C.txt,fontFamily:"'IBM Plex Sans',sans-serif",
  fontSize:12.5,outline:"none",width:"100%",boxSizing:"border-box",
  transition:"border-color 0.15s,box-shadow 0.15s",
};
export const lbl={
  fontSize:10,fontWeight:700,color:C.muted,display:"block",
  marginBottom:5,letterSpacing:0.8,textTransform:"uppercase",
};
export const th={
  padding:"9px 14px",background:C.bg,color:C.muted,fontWeight:700,
  fontSize:10,letterSpacing:0.7,textTransform:"uppercase",textAlign:"right",
  borderBottom:`1px solid ${C.brd}`,whiteSpace:"nowrap",
};
export const tagS=(c)=>({
  display:"inline-flex",alignItems:"center",padding:"2px 10px",borderRadius:99,
  fontSize:10,fontWeight:600,letterSpacing:0.3,whiteSpace:"nowrap",
  ...(c==="green"?{background:`${themeAlpha(C.grn,'14')}`,color:C.grn,border:`1px solid ${themeAlpha(C.grn,'30')}`}:
    c==="red"?{background:`${themeAlpha(C.red,'14')}`,color:C.red,border:`1px solid ${themeAlpha(C.red,'30')}`}:
    c==="yellow"?{background:`${themeAlpha(C.yel,'14')}`,color:C.yel,border:`1px solid ${themeAlpha(C.yel,'30')}`}:
    c==="blue"?{background:`${themeAlpha(C.acc,'14')}`,color:C.acc,border:`1px solid ${themeAlpha(C.acc,'30')}`}:
    c==="purple"?{background:`${themeAlpha(C.purp,'14')}`,color:C.purp,border:`1px solid ${themeAlpha(C.purp,'30')}`}:
    {background:C.card2,color:C.muted,border:`1px solid ${C.brd}`})
});
