/* ════════════ PLOT DIGITIZER MODAL (RoadMap/1.md Method 2 — figure) ════════════
   Local, DETERMINISTIC figure digitizer for the extraction workspace. The user
   draws no data from any model: every value is computed from the user's own
   clicks plus a two-point axis calibration, using the pure engine in
   src/research-engine/extraction/digitizer/ (calibration.js, figureExtract.js,
   kmGuyot.js). No network, no AI, nothing leaves the browser.

   Flow (a 4-step stepper inside the modal):
     1. figure type   forest / bar / box / KM / scatter
     2. calibration   two reference clicks per required axis + typed values
     3. capture       type-specific clicks (numbered markers, undo)
     4. review        computed values → onApply({ figureType, values, provenancePoints })

   All pixel coordinates are CANVAS pixels (x right, y down) — the calibration
   is built in canvas space, so the image→canvas scale factor cancels out. */

import { useState, useRef, useEffect } from "react";
import { C, btnS, inp, lbl } from "../../../frontend/workspace/ui/styles.js";
import { alpha as themeAlpha } from "../../../frontend/theme/tokens.js";
import { mkAxis, mkCalibration } from "../../../research-engine/extraction/digitizer/calibration.js";
import {
  forestFromClicks, barsFromClicks, boxFromClicks, scatterFromClicks, kmPointsFromTrace,
} from "../../../research-engine/extraction/digitizer/figureExtract.js";
import {
  reconstructIPD, coxHR, logRank, kmFromIPD,
} from "../../../research-engine/extraction/digitizer/kmGuyot.js";

/* ── constants / small helpers (module scope; no Date, no side effects) ── */
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (v) => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? "—" : String(+n.toPrecision(4));
};
const MONO = "'IBM Plex Mono',monospace";
// Canvas overlays need concrete colors (CSS vars don't resolve in canvas ctx).
const CAL_COLOR = "#f59e0b";
const MARK_COLOR = "#2563eb";
const ARM_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#0891b2", "#ca8a04"];

const FIGURE_TYPES = [
  { id: "forest", label: "Forest plot", hint: "point estimate + CI whisker ends" },
  { id: "bar", label: "Bar / mean±error", hint: "bar tops + optional error caps" },
  { id: "box", label: "Box plot", hint: "Q1 / median / Q3 → mean & SD (Wan 2014)" },
  { id: "km", label: "Kaplan–Meier / survival", hint: "trace both curves → HR (Guyot 2012)" },
  { id: "scatter", label: "Scatter", hint: "click points → data coordinates" },
];
const MEASURES = ["HR", "OR", "RR", "IRR", "SMD", "MD"];
const STEPS = ["Figure type", "Calibrate axes", "Capture points", "Review & apply"];

const neededAxes = (t) => ({
  x: t === "forest" || t === "km" || t === "scatter",
  y: t === "bar" || t === "box" || t === "km" || t === "scatter",
});
const slotsFor = (t) => {
  const need = neededAxes(t || "");
  const out = [];
  if (need.x) out.push("x1", "x2");
  if (need.y) out.push("y1", "y2");
  return out;
};
// Plain-language axis names (no jargon, no coordinates).
const axisName = (t, axis) => {
  if (axis === "x") return t === "forest" ? "effect-size" : t === "km" ? "time" : "horizontal";
  return t === "km" ? "survival" : t === "scatter" ? "vertical" : "value";
};
const slotTitle = (k, t) => `${axisName(t, k[0])} reference point ${k[1]}`;

// One clear, worked instruction for the currently-active calibration point.
function calExample(t, slot) {
  const axis = slot[0], n = slot[1];
  if (t === "km") {
    if (axis === "x") return n === "1"
      ? "On the TIME axis, click where time = 0 (the left edge), then type 0."
      : "Click a later time you can read off the axis — e.g. a tick at 12 — then type that number.";
    return n === "1"
      ? "On the SURVIVAL axis, click where survival = 1 (100%, the top), then confirm the value 1 below."
      : "Click where survival = 0 (0%, the bottom), then confirm the value 0 below.";
  }
  if (t === "forest") return n === "1"
    ? "Click a labelled tick on the effect-size axis (often the line of no effect = 1), then type its value."
    : "Click a second labelled tick (e.g. 2), then type its value.";
  if (t === "bar" || t === "box") return n === "1"
    ? "Click a labelled tick on the vertical value axis (e.g. 0), then type its value."
    : "Click a second labelled tick higher up (e.g. 10), then type its value.";
  // scatter
  return axis === "x"
    ? (n === "1" ? "Click a labelled tick on the horizontal axis, then type its value." : "Click a second labelled tick on the horizontal axis, then type its value.")
    : (n === "1" ? "Click a labelled tick on the vertical axis, then type its value." : "Click a second labelled tick on the vertical axis, then type its value.");
}

const emptyCalPts = () => ({
  x1: { px: null, py: null, value: "" },
  x2: { px: null, py: null, value: "" },
  y1: { px: null, py: null, value: "" },
  y2: { px: null, py: null, value: "" },
});
// Sensible defaults for Kaplan–Meier: survival runs 1→0, time starts at 0. The user still
// clicks WHERE those values sit on the axes; only the values are pre-filled.
const kmCalPts = () => ({
  x1: { px: null, py: null, value: "0" },
  x2: { px: null, py: null, value: "" },
  y1: { px: null, py: null, value: "1" },
  y2: { px: null, py: null, value: "0" },
});
const mkArm = (i) => ({ id: uid(), label: `Arm ${i}`, n: "", top: null, cap: null });
const emptyKmArm = () => ({ trace: [], atRisk: "", totalEvents: "" });

/** Parse a numbers-at-risk row typed as "time:n" pairs ("0:120, 12:84 24:40"). */
function parseAtRisk(text) {
  const rows = [];
  const toks = String(text || "").split(/[,;\s]+/).filter(Boolean);
  for (const tok of toks) {
    const parts = tok.split(":");
    if (parts.length !== 2) return { ok: false, error: `"${tok}" is not a time:n pair` };
    const t = Number(parts[0]);
    const n = Number(parts[1]);
    if (!Number.isFinite(t) || !Number.isFinite(n)) return { ok: false, error: `"${tok}" has a non-numeric time or n` };
    rows.push({ t, n });
  }
  return { ok: true, rows };
}

/* ── canvas overlay drawing ── */
function drawCross(ctx, x, y, label, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y);
  ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7);
  ctx.stroke();
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.strokeText(label, x + 8, y - 4);
  ctx.fillStyle = color;
  ctx.fillText(label, x + 8, y - 4);
}
function drawDot(ctx, x, y, label, color, r) {
  const rad = r || (String(label).length > 1 ? 9 : 8);
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 8px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(label), x, y);
}
function drawTrace(ctx, trace, color) {
  if (!trace.length) return;
  if (trace.length > 1) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(trace[0].px, trace[0].py);
    for (let i = 1; i < trace.length; i++) ctx.lineTo(trace[i].px, trace[i].py);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  trace.forEach((p, i) => drawDot(ctx, p.px, p.py, i + 1, color, 7));
}
/* Back-project a reconstructed KM step-function [{t,s}] onto the canvas via the calibration
   so the user sees the digitized curve tracking the printed one. */
function drawStepCurve(ctx, pts, cal, color) {
  if (!cal || !pts || pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.25;
  ctx.setLineDash([5, 3]);
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  // kmFromIPD emits post-drop survival at each event time; a right-continuous KM curve HOLDS
  // the higher (previous) level until the next event, then drops — so draw horizontal-then-
  // vertical. Seed the leading S=1 plateau from t=0 when the first event is after 0.
  const seq = (pts[0] && pts[0].t > 0) ? [{ t: 0, s: 1 }, ...pts] : pts;
  let prev = null;
  for (const p of seq) {
    const c = cal.toPx({ x: p.t, y: p.s });
    if (!c || !Number.isFinite(c.px) || !Number.isFinite(c.py)) continue;
    if (prev == null) ctx.moveTo(c.px, c.py);
    else { ctx.lineTo(c.px, prev.py); ctx.lineTo(c.px, c.py); } // hold previous level, then drop
    prev = c;
  }
  ctx.stroke();
  ctx.restore();
}

/* ════════════ COMPONENT ════════════ */
export default function PlotDigitizer({ imageUrl, onCancel, onApply }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const calRef = useRef(null); // built mkCalibration cal (closures — kept in a ref)

  const [imgState, setImgState] = useState(imageUrl ? "loading" : "missing");
  const [dims, setDims] = useState({ w: 640, h: 400 });

  const [step, setStep] = useState(1);
  const [figureType, setFigureType] = useState(null);

  /* calibration state */
  const [calPts, setCalPts] = useState(emptyCalPts);
  const [activeCal, setActiveCal] = useState(null);
  const [logX, setLogX] = useState(true); // forest only
  const [calErr, setCalErr] = useState("");

  /* capture state */
  const [capErr, setCapErr] = useState("");
  const [measure, setMeasure] = useState("HR");         // forest
  const [fClicks, setFClicks] = useState([]);           // forest: est, lo, hi
  const [arms, setArms] = useState(() => [mkArm(1)]);   // bar
  const [activeArm, setActiveArm] = useState(null);
  const [barOrder, setBarOrder] = useState([]);         // bar undo stack {armId,slot}
  const [errorType, setErrorType] = useState("SD");
  const [bClicks, setBClicks] = useState([]);           // box: q1, median, q3
  const [boxN, setBoxN] = useState("");
  const [kmArm, setKmArm] = useState("A");              // km
  const [km, setKm] = useState({ A: emptyKmArm(), B: emptyKmArm() });
  const [kmResult, setKmResult] = useState(null);
  const [kmDiag, setKmDiag] = useState(null);
  const [kmErr, setKmErr] = useState("");
  const [kmIpd, setKmIpd] = useState(null);
  const [sClicks, setSClicks] = useState([]);           // scatter

  const [result, setResult] = useState(null);

  /* ── load the figure image ── */
  useEffect(() => {
    if (!imageUrl) { setImgState("missing"); return undefined; }
    let alive = true;
    setImgState("loading");
    const im = new Image();
    im.onload = () => {
      if (!alive) return;
      imgRef.current = im;
      const nw = Math.max(1, im.naturalWidth);
      const nh = Math.max(1, im.naturalHeight);
      const scale = Math.min(640 / nw, 460 / nh);
      setDims({ w: Math.max(1, Math.round(nw * scale)), h: Math.max(1, Math.round(nh * scale)) });
      setImgState("ready");
    };
    im.onerror = () => { if (alive) setImgState("error"); };
    im.src = imageUrl;
    return () => { alive = false; };
  }, [imageUrl]);

  /* ── auto-activate the first empty calibration slot on entering step 2 ── */
  useEffect(() => {
    if (step !== 2) return;
    const nxt = slotsFor(figureType).find((k) => calPts[k].px == null) || null;
    setActiveCal(nxt);
    // calPts intentionally not a dep — only runs on step entry / type change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, figureType]);

  /* ── redraw: image + calibration crosses + capture markers ── */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const im = imgRef.current;
    if (!im || imgState !== "ready") return;
    ctx.drawImage(im, 0, 0, cv.width, cv.height);
    for (const k of slotsFor(figureType)) {
      const p = calPts[k];
      if (p.px == null) continue;
      drawCross(ctx, p.px, p.py, k.toUpperCase(), CAL_COLOR);
    }
    if (figureType === "forest") {
      fClicks.forEach((c, i) => drawDot(ctx, c.px, c.py, i + 1, MARK_COLOR));
    } else if (figureType === "bar") {
      arms.forEach((a, i) => {
        const col = ARM_COLORS[i % ARM_COLORS.length];
        if (a.top) drawDot(ctx, a.top.px, a.top.py, `${i + 1}T`, col);
        if (a.cap) drawDot(ctx, a.cap.px, a.cap.py, `${i + 1}E`, col);
      });
    } else if (figureType === "box") {
      const names = ["Q1", "M", "Q3"];
      bClicks.forEach((c, i) => drawDot(ctx, c.px, c.py, names[i] || "?", MARK_COLOR));
    } else if (figureType === "km") {
      drawTrace(ctx, km.A.trace, ARM_COLORS[0]);
      drawTrace(ctx, km.B.trace, ARM_COLORS[1]);
      // Live overlay: the reconstructed step-function back-projected onto the figure so the
      // reviewer can confirm the digitized curve tracks the printed one.
      const cal = calRef.current;
      if (kmIpd && cal) {
        try { drawStepCurve(ctx, kmFromIPD(kmIpd.A), cal, ARM_COLORS[0]); } catch { /* noop */ }
        try { drawStepCurve(ctx, kmFromIPD(kmIpd.B), cal, ARM_COLORS[1]); } catch { /* noop */ }
      }
    } else if (figureType === "scatter") {
      sClicks.forEach((c, i) => drawDot(ctx, c.px, c.py, i + 1, MARK_COLOR));
    }
  }, [imgState, dims, figureType, calPts, fClicks, arms, bClicks, km, sClicks, step, kmIpd]);

  /* ── type selection (step 1) resets everything downstream ── */
  const chooseType = (t) => {
    if (t === figureType) return;
    setFigureType(t);
    setCalPts(t === "km" ? kmCalPts() : emptyCalPts());
    setActiveCal(null);
    setCalErr("");
    setLogX(t === "forest");
    calRef.current = null;
    setCapErr("");
    setMeasure("HR");
    setFClicks([]);
    setArms([mkArm(1)]);
    setActiveArm(null);
    setBarOrder([]);
    setErrorType("SD");
    setBClicks([]);
    setBoxN("");
    setKmArm("A");
    setKm({ A: emptyKmArm(), B: emptyKmArm() });
    setKmResult(null);
    setKmDiag(null);
    setKmErr("");
    setKmIpd(null);
    setSClicks([]);
    setResult(null);
  };

  /* ── canvas clicks ── */
  const onCanvasClick = (e) => {
    const cv = canvasRef.current;
    if (!cv || imgState !== "ready") return;
    const rect = cv.getBoundingClientRect();
    const px = Math.round(((e.clientX - rect.left) * (cv.width / rect.width)) * 100) / 100;
    const py = Math.round(((e.clientY - rect.top) * (cv.height / rect.height)) * 100) / 100;
    const p = { px, py };
    if (step === 2) {
      if (!activeCal) return;
      const nextPts = { ...calPts, [activeCal]: { ...calPts[activeCal], px: p.px, py: p.py } };
      setCalPts(nextPts);
      setCalErr("");
      setActiveCal(slotsFor(figureType).find((k) => nextPts[k].px == null) || null);
    } else if (step === 3) {
      handleCaptureClick(p);
    }
  };

  const handleCaptureClick = (p) => {
    setCapErr("");
    if (figureType === "forest") {
      if (fClicks.length >= 3) { setCapErr("All 3 clicks recorded — use Undo to re-click."); return; }
      setFClicks([...fClicks, p]);
    } else if (figureType === "bar") {
      const arm = arms.find((a) => a.id === activeArm) || arms[0];
      if (!arm) { setCapErr("Add an arm first."); return; }
      if (arm.top == null) {
        setArms(arms.map((a) => (a.id === arm.id ? { ...a, top: p } : a)));
        setBarOrder([...barOrder, { armId: arm.id, slot: "top" }]);
      } else if (arm.cap == null) {
        setArms(arms.map((a) => (a.id === arm.id ? { ...a, cap: p } : a)));
        setBarOrder([...barOrder, { armId: arm.id, slot: "cap" }]);
      } else {
        setCapErr(`${arm.label || "This arm"} already has a bar top and error cap — Undo, or select another arm.`);
      }
    } else if (figureType === "box") {
      if (bClicks.length >= 3) { setCapErr("Q1, median and Q3 recorded — use Undo to re-click."); return; }
      setBClicks([...bClicks, p]);
    } else if (figureType === "km") {
      setKm({ ...km, [kmArm]: { ...km[kmArm], trace: [...km[kmArm].trace, p] } });
      setKmResult(null); setKmDiag(null); setKmIpd(null); setKmErr("");
    } else if (figureType === "scatter") {
      setSClicks([...sClicks, p]);
    }
  };

  const undoCapture = () => {
    setCapErr("");
    if (figureType === "forest") setFClicks(fClicks.slice(0, -1));
    else if (figureType === "bar") {
      const last = barOrder[barOrder.length - 1];
      if (!last) return;
      setArms(arms.map((a) => (a.id === last.armId ? { ...a, [last.slot]: null } : a)));
      setBarOrder(barOrder.slice(0, -1));
    } else if (figureType === "box") setBClicks(bClicks.slice(0, -1));
    else if (figureType === "km") {
      const tr = km[kmArm].trace;
      if (!tr.length) return;
      setKm({ ...km, [kmArm]: { ...km[kmArm], trace: tr.slice(0, -1) } });
      setKmResult(null); setKmDiag(null); setKmIpd(null); setKmErr("");
    } else if (figureType === "scatter") setSClicks(sClicks.slice(0, -1));
  };

  /* ── calibration → cal object ── */
  const buildCal = () => {
    const need = neededAxes(figureType);
    const dummy = { p1: { px: 0, value: 0 }, p2: { px: 100, value: 100 } };
    const xSpec = need.x
      ? { p1: { px: calPts.x1.px, value: Number(calPts.x1.value) },
          p2: { px: calPts.x2.px, value: Number(calPts.x2.value) },
          log: figureType === "forest" && logX }
      : dummy;
    const ySpec = need.y
      ? { p1: { px: calPts.y1.py, value: Number(calPts.y1.value) },
          p2: { px: calPts.y2.py, value: Number(calPts.y2.value) },
          log: false }
      : dummy;
    return mkCalibration({ x: xSpec, y: ySpec });
  };

  const calComplete = slotsFor(figureType).every(
    (k) => calPts[k].px != null && calPts[k].value !== "" && Number.isFinite(Number(calPts[k].value))
  );

  const axisLiveError = (axisKey) => {
    const p1 = calPts[`${axisKey}1`];
    const p2 = calPts[`${axisKey}2`];
    if (p1.px == null || p2.px == null || p1.value === "" || p2.value === "") return null;
    const pick = (p) => (axisKey === "x" ? p.px : p.py);
    const r = mkAxis({
      p1: { px: pick(p1), value: Number(p1.value) },
      p2: { px: pick(p2), value: Number(p2.value) },
      log: axisKey === "x" && figureType === "forest" && logX,
    });
    return r.ok ? null : r.error;
  };

  const goCapture = () => {
    const r = buildCal();
    if (!r.ok) { setCalErr(r.error); return; }
    calRef.current = r.cal;
    setCalErr("");
    setStep(3);
  };

  /* ── KM: reconstruct IPD per arm, then HR (Cox, with log-rank fallback) ── */
  const computeKm = (method) => {
    setKmErr("");
    const cal = calRef.current;
    if (!cal) { setKmErr("Calibration missing — go back to step 2."); return; }
    const prep = (key) => {
      const armData = km[key];
      if (armData.trace.length < 3) return { err: `Arm ${key}: trace at least 3 points along the curve.` };
      const curve = kmPointsFromTrace({ points: armData.trace, cal });
      if (curve.length < 2) return { err: `Arm ${key}: the traced points do not map to a usable curve — check the calibration.` };
      const ar = parseAtRisk(armData.atRisk);
      if (!ar.ok) return { err: `Arm ${key} numbers-at-risk: ${ar.error}` };
      if (!ar.rows.length) return { err: `Arm ${key}: enter at least the initial number at risk (e.g. "0:120").` };
      const te = armData.totalEvents === "" ? null : Number(armData.totalEvents);
      if (te != null && !Number.isFinite(te)) return { err: `Arm ${key}: total events must be a number.` };
      const recon = reconstructIPD({ curve, atRisk: ar.rows, totalEvents: te });
      if (!recon.ok) return { err: `Arm ${key}: IPD reconstruction failed — ${recon.error}. Adjust the trace or the at-risk row and retry.` };
      return { curve, recon };
    };
    const A = prep("A");
    if (A.err) { setKmErr(A.err); setKmResult(null); setKmDiag(null); setKmIpd(null); return; }
    const B = prep("B");
    if (B.err) { setKmErr(B.err); setKmResult(null); setKmDiag(null); setKmIpd(null); return; }
    const ipdA = A.recon.ipd;
    const ipdB = B.recon.ipd;
    setKmIpd({ A: ipdA, B: ipdB });
    const sum = (xs) => xs.reduce((a, b) => a + b, 0);
    const lastS = (steps) => (steps.length ? steps[steps.length - 1].s : null);
    const mkDiag = (r, ipd) => ({
      n: ipd.length,
      events: sum(r.recon.diagnostics.eventsPerInterval),
      atRiskError: r.recon.diagnostics.finalAtRiskError,
      reconFinalS: lastS(kmFromIPD(ipd)),
      digitFinalS: r.curve[r.curve.length - 1].s,
    });
    setKmDiag({ A: mkDiag(A, ipdA), B: mkDiag(B, ipdB) });
    if (method === "logrank") {
      const lr = logRank(ipdA, ipdB);
      if (!Number.isFinite(lr.hr)) {
        setKmErr("The log-rank estimate is undefined (zero variance) — check that both arms have events.");
        setKmResult(null);
        return;
      }
      setKmResult({ est: lr.hr, lo: lr.lo, hi: lr.hi, method: "logRank", methodLabel: "log-rank / Peto one-step", warnings: [] });
    } else {
      const cox = coxHR(ipdA, ipdB);
      if (!cox.ok) {
        setKmErr(`Cox model failed: ${cox.reason}. Use the log-rank (Peto) fallback below.`);
        setKmResult(null);
        return;
      }
      const warnings = cox.converged ? [] : ["Cox Newton–Raphson did not fully converge — interpret the CI with caution."];
      setKmResult({ est: cox.hr, lo: cox.lo, hi: cox.hi, method: "cox", methodLabel: "Cox (Breslow partial likelihood)", warnings });
    }
  };

  /* ── step 3 → 4: compute the result via the pure engine ── */
  const goReview = () => {
    const cal = calRef.current;
    if (!cal) { setCapErr("Calibration missing — go back to step 2."); return; }
    if (figureType === "forest") {
      if (fClicks.length < 3) { setCapErr("Click the point estimate and both CI whisker ends (3 clicks)."); return; }
      const r = forestFromClicks({ pointPx: fClicks[0], loPx: fClicks[1], hiPx: fClicks[2], cal });
      if (!r) { setCapErr("Could not map the clicks — check the calibration (a log axis needs values > 0)."); return; }
      setResult({ figureType: "forest", values: { measure, est: r.est, lo: r.lo, hi: r.hi }, warnings: [] });
    } else if (figureType === "bar") {
      const armsIn = arms.filter((a) => a.top).map((a) => ({ label: a.label || "arm", topPx: a.top, capPx: a.cap, n: a.n }));
      if (!armsIn.length) { setCapErr("Click at least one bar top."); return; }
      const r = barsFromClicks({ arms: armsIn, cal, errorType });
      if (!r.arms.length) { setCapErr(`No arm could be extracted${r.warnings[0] ? ` — ${r.warnings[0]}` : "."}`); return; }
      setResult({
        figureType: "bar",
        values: { arms: r.arms.map((a) => ({ label: a.label, mean: a.mean, sd: a.sd, n: a.n })) },
        warnings: r.warnings,
      });
    } else if (figureType === "box") {
      if (bClicks.length < 3) { setCapErr("Click Q1 (lower hinge), the median line, then Q3 (upper hinge)."); return; }
      const r = boxFromClicks({ q1Px: bClicks[0], medianPx: bClicks[1], q3Px: bClicks[2], n: boxN, cal });
      if (!r.ok) { setCapErr(r.error); return; }
      setResult({
        figureType: "box",
        values: { q1: r.q1, median: r.median, q3: r.q3, mean: r.mean, sd: r.sd, n: Number(boxN) },
        warnings: [],
      });
    } else if (figureType === "km") {
      if (!kmResult) { setCapErr("Compute the HR first (trace both arms, enter numbers-at-risk, then Compute HR)."); return; }
      setResult({
        figureType: "km",
        values: { measure: "HR", est: kmResult.est, lo: kmResult.lo, hi: kmResult.hi, method: kmResult.method },
        warnings: kmResult.warnings || [],
      });
    } else if (figureType === "scatter") {
      const pts = scatterFromClicks({ points: sClicks, cal });
      if (!pts.length) { setCapErr("Click at least one data point that falls inside the calibrated axes."); return; }
      setResult({ figureType: "scatter", values: { points: pts }, warnings: [] });
    } else return;
    setCapErr("");
    setStep(4);
  };

  /* ── provenance: every raw canvas click, tagged with its role ── */
  const collectProvenance = () => {
    const pts = [];
    for (const k of slotsFor(figureType)) {
      const p = calPts[k];
      if (p.px != null) pts.push({ px: p.px, py: p.py, role: `cal:${k}` });
    }
    if (figureType === "forest") {
      const roles = ["est", "lo", "hi"];
      fClicks.forEach((c, i) => pts.push({ px: c.px, py: c.py, role: roles[i] || "click" }));
    } else if (figureType === "bar") {
      arms.forEach((a, i) => {
        if (a.top) pts.push({ px: a.top.px, py: a.top.py, role: `arm${i + 1}:top` });
        if (a.cap) pts.push({ px: a.cap.px, py: a.cap.py, role: `arm${i + 1}:cap` });
      });
    } else if (figureType === "box") {
      const roles = ["q1", "median", "q3"];
      bClicks.forEach((c, i) => pts.push({ px: c.px, py: c.py, role: roles[i] || "click" }));
    } else if (figureType === "km") {
      km.A.trace.forEach((c) => pts.push({ px: c.px, py: c.py, role: "A:trace" }));
      km.B.trace.forEach((c) => pts.push({ px: c.px, py: c.py, role: "B:trace" }));
    } else if (figureType === "scatter") {
      sClicks.forEach((c) => pts.push({ px: c.px, py: c.py, role: "point" }));
    }
    return pts;
  };

  const apply = () => {
    if (!result) return;
    if (onApply) onApply({ figureType: result.figureType, values: result.values, provenancePoints: collectProvenance() });
  };

  /* ── derived bits for rendering ── */
  const cal = calRef.current;
  const curArm = arms.find((a) => a.id === activeArm) || arms[0] || null;
  const nextDisabled =
    step === 1 ? !figureType || imgState !== "ready"
    : step === 2 ? !calComplete
    : step === 3 && figureType === "km" ? !kmResult
    : false;
  const clickable = (step === 2 && !!activeCal) || step === 3;

  const stepInstruction =
    step === 1 ? "Choose the figure type you are digitizing."
    : step === 2
      ? activeCal
        ? calExample(figureType, activeCal)
        : "All reference points are set — you can adjust a value below, or re-click a point to move it. Then press Next."
    : step === 3
      ? figureType === "forest" ? "Click 3 points on the row: (1) the point estimate, (2) the LOWER CI whisker end, (3) the UPPER CI whisker end."
      : figureType === "bar" ? "Select an arm, click its bar top, then (optionally) its error-bar cap. Set SD/SE and each arm's n below."
      : figureType === "box" ? "Click 3 points on the box: (1) Q1 — the lower hinge, (2) the median line, (3) Q3 — the upper hinge. Enter n below."
      : figureType === "km" ? "Select an arm, then click points along its survival curve left to right (include every visible step). Enter the numbers-at-risk row per arm, then Compute HR."
      : "Click each data point you want to capture."
    : "Check the computed values, then apply them to the extraction draft.";

  const smallInp = { ...inp, fontSize: 11, fontFamily: MONO, padding: "5px 8px" };
  const secTitle = { fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 };
  const warnBox = { fontSize: 11, color: C.yel, lineHeight: 1.5, marginTop: 6 };
  const errTxt = { fontSize: 11.5, color: C.red, lineHeight: 1.5 };

  /* ════════════ render ════════════ */
  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000099", zIndex: 998, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: C.surf, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 22, width: "100%", maxWidth: 720, maxHeight: "92vh", overflowY: "auto" }}>

        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, color: C.txt }}>Figure digitizer</div>
            <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>
              Local, deterministic digitizing — every value is computed from your clicks and the axis
              calibration only. No AI, and nothing leaves your browser.
            </div>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", color: C.muted, fontSize: 22, cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
        </div>

        {/* stepper */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {STEPS.map((s, i) => {
            const n = i + 1;
            const on = step === n;
            const done = step > n;
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                  background: on ? C.acc : done ? themeAlpha(C.acc, "33") : C.card,
                  color: on ? C.accText : done ? C.acc : C.dim,
                  border: `1px solid ${on || done ? C.acc : C.brd}`,
                }}>{n}</div>
                <span style={{ fontSize: 10, fontWeight: on ? 700 : 500, color: on ? C.txt : C.dim, whiteSpace: "nowrap" }}>{s}</span>
                {i < STEPS.length - 1 && <span style={{ width: 14, height: 1, background: C.brd }} />}
              </div>
            );
          })}
        </div>

        {/* instruction banner */}
        <div style={{ background: C.bg, border: `1px solid ${themeAlpha(C.acc, "33")}`, borderLeft: `3px solid ${C.acc}`, borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>
          {stepInstruction}
        </div>

        {/* canvas / image */}
        {imgState === "ready" ? (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <canvas
              ref={canvasRef}
              width={dims.w}
              height={dims.h}
              onClick={onCanvasClick}
              style={{ maxWidth: "100%", border: `1px solid ${C.brd}`, borderRadius: 6, background: "#ffffff", cursor: clickable ? "crosshair" : "default" }}
            />
          </div>
        ) : (
          <div style={{ border: `1px dashed ${C.brd}`, borderRadius: 8, padding: 30, textAlign: "center", color: C.muted, fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
            {imgState === "loading" ? "Loading figure image…"
              : imgState === "missing" ? "No figure image was provided. Close this dialog and select a figure region (or upload an image) first."
              : "The figure image could not be loaded. Close this dialog and try re-capturing the figure."}
          </div>
        )}

        {/* ── STEP 1: figure type ── */}
        {step === 1 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 8, marginBottom: 12 }}>
            {FIGURE_TYPES.map((t) => {
              const on = figureType === t.id;
              return (
                <button key={t.id} onClick={() => chooseType(t.id)} style={{
                  textAlign: "left", cursor: "pointer", borderRadius: 8, padding: "10px 12px",
                  background: on ? themeAlpha(C.acc, "18") : C.card,
                  border: `1px solid ${on ? C.acc : C.brd}`,
                  color: C.txt, fontFamily: "inherit",
                }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 3, color: on ? C.acc : C.txt }}>{t.label}</div>
                  <div style={{ fontSize: 10.5, color: C.dim, lineHeight: 1.4 }}>{t.hint}</div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── STEP 2: axis calibration — one reference point at a time, no pixels ── */}
        {step === 2 && (
          <div style={{ marginBottom: 12 }}>
            <div style={secTitle}>Tell the digitizer where two known values sit on each axis</div>
            {/* progress chips: each reference point, plainly labelled, click to (re)set */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {slotsFor(figureType).map((k) => {
                const p = calPts[k];
                const isActive = activeCal === k;
                const set = p.px != null;
                const label = p.value !== "" ? `${axisName(figureType, k[0])} = ${p.value}` : slotTitle(k, figureType);
                return (
                  <button key={k} onClick={() => setActiveCal(k)} style={{
                    display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 99, cursor: "pointer",
                    fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                    background: isActive ? themeAlpha(C.acc, "18") : set ? themeAlpha(C.grn, "12") : C.card,
                    border: `1px solid ${isActive ? C.acc : set ? themeAlpha(C.grn, "44") : C.brd}`,
                    color: isActive ? C.acc : set ? C.grn : C.muted,
                  }}>
                    <span>{set ? "✓" : "•"}</span>{label}
                  </button>
                );
              })}
            </div>
            {/* the active point's value input (prominent). The worked instruction is in the banner above. */}
            {activeCal ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: C.bg, border: `1px solid ${themeAlpha(C.acc, "33")}`, borderRadius: 8, padding: "10px 12px" }}>
                <span style={{ fontSize: 12, color: C.txt, fontWeight: 600 }}>
                  {calPts[activeCal].px == null ? "① Click the point on the figure" : "① Point marked ✓"} · ② its value =
                </span>
                <input
                  value={calPts[activeCal].value}
                  onChange={(e) => setCalPts((prev) => ({ ...prev, [activeCal]: { ...prev[activeCal], value: e.target.value } }))}
                  placeholder="value"
                  autoFocus
                  style={{ ...smallInp, width: 90, fontSize: 13 }}
                />
                {calPts[activeCal].px != null && (
                  <button onClick={() => setCalPts((prev) => ({ ...prev, [activeCal]: { ...prev[activeCal], px: null, py: null } }))} style={{ ...btnS("ghost"), padding: "4px 10px", fontSize: 11 }}>Re-click</button>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: C.grn }}>All reference points set — press Next to start capturing.</div>
            )}
            {figureType === "forest" && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted, marginTop: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={logX} onChange={(e) => setLogX(e.target.checked)} />
                Log-scaled axis (typical for ratio measures: OR / RR / HR / IRR — both reference values must be &gt; 0)
              </label>
            )}
            {["x", "y"].map((ax) => {
              if (!neededAxes(figureType)[ax]) return null;
              const err = axisLiveError(ax);
              return err ? <div key={ax} style={{ ...errTxt, marginTop: 6 }}>{axisName(figureType, ax)}: {err}</div> : null;
            })}
            {calErr && <div style={{ ...errTxt, marginTop: 6 }}>{calErr}</div>}
          </div>
        )}

        {/* ── STEP 3: capture ── */}
        {step === 3 && (
          <div style={{ marginBottom: 12 }}>

            {figureType === "forest" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                  <div>
                    <label style={lbl}>Effect measure</label>
                    <select value={measure} onChange={(e) => setMeasure(e.target.value)} style={{ ...inp, width: "auto", fontSize: 12 }}>
                      {MEASURES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div style={{ fontSize: 11, color: C.dim, alignSelf: "flex-end", paddingBottom: 8 }}>
                    {fClicks.length}/3 clicks — next: {["point estimate", "lower CI end", "upper CI end", "done"][fClicks.length]}
                  </div>
                </div>
                {fClicks.length > 0 && (
                  <div style={{ fontSize: 11, fontFamily: MONO, color: C.txt, lineHeight: 1.7 }}>
                    {fClicks.map((c, i) => (
                      <div key={i}>{i + 1}. {["estimate", "lower", "upper"][i]} → {cal ? fmt(cal.x.toData(c.px)) : "—"}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {figureType === "bar" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: C.muted }}>Error bars show:</span>
                  {["SD", "SE"].map((t) => (
                    <button key={t} onClick={() => setErrorType(t)} style={{
                      ...btnS("ghost"), padding: "4px 12px", fontSize: 11,
                      ...(errorType === t ? { background: themeAlpha(C.acc, "22"), color: C.acc, border: `1px solid ${C.acc}` } : {}),
                    }}>{t}</button>
                  ))}
                  <span style={{ fontSize: 10, color: C.dim }}>(SE needs each arm's n to convert to SD)</span>
                </div>
                {arms.map((a, i) => {
                  const col = ARM_COLORS[i % ARM_COLORS.length];
                  const isA = curArm && curArm.id === a.id;
                  return (
                    <div key={a.id} style={{
                      display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap",
                      padding: "6px 8px", borderRadius: 6,
                      border: `1px solid ${isA ? col : C.brd}`, background: isA ? themeAlpha(C.acc, "0d") : "transparent",
                    }}>
                      <button onClick={() => { setActiveArm(a.id); setCapErr(""); }} style={{
                        ...btnS("ghost"), padding: "3px 10px", fontSize: 10.5,
                        ...(isA ? { color: col, border: `1px solid ${col}` } : {}),
                      }}>{isA ? "Active" : "Select"}</button>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: col, flexShrink: 0 }} />
                      <input value={a.label} onChange={(e) => setArms(arms.map((x) => (x.id === a.id ? { ...x, label: e.target.value } : x)))}
                        placeholder={`Arm ${i + 1}`} style={{ ...smallInp, width: 120 }} />
                      <input value={a.n} onChange={(e) => setArms(arms.map((x) => (x.id === a.id ? { ...x, n: e.target.value } : x)))}
                        placeholder="n" style={{ ...smallInp, width: 60 }} />
                      <span style={{ fontSize: 10, fontFamily: MONO, color: a.top ? C.grn : C.dim }}>
                        top {a.top ? (cal ? `= ${fmt(cal.y.toData(a.top.py))}` : "set") : "—"}
                      </span>
                      <span style={{ fontSize: 10, fontFamily: MONO, color: a.cap ? C.grn : C.dim }}>cap {a.cap ? "set" : "—"}</span>
                      {arms.length > 1 && (
                        <button onClick={() => {
                          setArms(arms.filter((x) => x.id !== a.id));
                          setBarOrder(barOrder.filter((o) => o.armId !== a.id));
                          if (activeArm === a.id) setActiveArm(null);
                        }} style={{ background: "none", border: "none", color: C.muted, fontSize: 15, cursor: "pointer", padding: 0, lineHeight: 1, marginLeft: "auto" }}>×</button>
                      )}
                    </div>
                  );
                })}
                <button onClick={() => { const na = mkArm(arms.length + 1); setArms([...arms, na]); setActiveArm(na.id); }}
                  style={{ ...btnS("ghost"), padding: "4px 12px", fontSize: 11 }}>+ Add arm</button>
              </div>
            )}

            {figureType === "box" && (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
                <div>
                  <label style={lbl}>Sample size n</label>
                  <input value={boxN} onChange={(e) => setBoxN(e.target.value)} placeholder="n (≥ 2)" style={{ ...smallInp, width: 90 }} />
                </div>
                <div style={{ fontSize: 11, fontFamily: MONO, color: C.txt, lineHeight: 1.7 }}>
                  {bClicks.map((c, i) => (
                    <div key={i}>{["Q1", "Median", "Q3"][i]} → {cal ? fmt(cal.y.toData(c.py)) : "—"}</div>
                  ))}
                  {bClicks.length < 3 && <div style={{ color: C.dim }}>next: {["Q1 (lower hinge)", "median line", "Q3 (upper hinge)"][bClicks.length]}</div>}
                </div>
              </div>
            )}

            {figureType === "km" && (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  {["A", "B"].map((key, i) => (
                    <button key={key} onClick={() => setKmArm(key)} style={{
                      ...btnS("ghost"), padding: "4px 14px", fontSize: 11,
                      ...(kmArm === key ? { color: ARM_COLORS[i], border: `1px solid ${ARM_COLORS[i]}`, background: themeAlpha(C.acc, "0d") } : {}),
                    }}>Trace arm {key}</button>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
                  {["A", "B"].map((key, i) => (
                    <div key={key} style={{ border: `1px solid ${kmArm === key ? ARM_COLORS[i] : C.brd}`, borderRadius: 6, padding: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: ARM_COLORS[i], marginBottom: 6 }}>
                        Arm {key} — {km[key].trace.length} trace point{km[key].trace.length === 1 ? "" : "s"}
                      </div>
                      <label style={lbl}>Numbers at risk (time:n pairs)</label>
                      <input value={km[key].atRisk}
                        onChange={(e) => { setKm({ ...km, [key]: { ...km[key], atRisk: e.target.value } }); setKmResult(null); setKmErr(""); }}
                        placeholder="0:120, 12:84, 24:40" style={{ ...smallInp, marginBottom: 8 }} />
                      <label style={lbl}>Total events (optional)</label>
                      <input value={km[key].totalEvents}
                        onChange={(e) => { setKm({ ...km, [key]: { ...km[key], totalEvents: e.target.value } }); setKmResult(null); setKmErr(""); }}
                        placeholder="e.g. 57" style={{ ...smallInp, width: 100 }} />
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10.5, color: C.dim, marginBottom: 8, lineHeight: 1.5 }}>
                  The hazard ratio is reported as <b>Arm B vs Arm A</b> — trace the comparator as Arm A and the intervention as Arm B (or note which is which; you can flip it later).
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={() => computeKm("cox")} style={btnS("primary")}>Compute HR</button>
                  <button onClick={() => computeKm("logrank")} style={btnS("ghost")}>Alternative estimate</button>
                  {kmIpd && !kmResult && <span style={{ fontSize: 10.5, color: C.dim }}>Curve reconstructed — pick a method above.</span>}
                </div>
                {kmErr && <div style={{ ...errTxt, marginTop: 8 }}>{kmErr}</div>}
                {kmResult && (
                  <div style={{ background: C.bg, border: `1px solid ${themeAlpha(C.grn, "44")}`, borderRadius: 6, padding: 10, marginTop: 8 }}>
                    <div style={{ fontSize: 13, fontFamily: MONO, color: C.grn, marginBottom: 4 }}>
                      HR (Arm B vs Arm A) = {fmt(kmResult.est)} [{fmt(kmResult.lo)}, {fmt(kmResult.hi)}]
                    </div>
                    {(kmResult.warnings || []).map((w, i) => <div key={i} style={warnBox}>{w}</div>)}
                    {kmDiag && (
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ fontSize: 10.5, color: C.muted, cursor: "pointer" }}>Method &amp; reconstruction details</summary>
                        <div style={{ fontSize: 10, color: C.dim, marginTop: 4, lineHeight: 1.6 }}>
                          {kmResult.methodLabel} on Guyot (2012) reconstructed pseudo-individual-patient data.
                        </div>
                        <div style={{ fontSize: 10, fontFamily: MONO, color: C.dim, marginTop: 4, lineHeight: 1.7 }}>
                          {["A", "B"].map((key) => (
                            <div key={key}>
                              arm {key}: n={kmDiag[key].n}, events={kmDiag[key].events}, at-risk error={fmt(kmDiag[key].atRiskError)},
                              {" "}final S reconstructed {fmt(kmDiag[key].reconFinalS)} vs digitized {fmt(kmDiag[key].digitFinalS)}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}

            {figureType === "scatter" && (
              <div style={{ fontSize: 11, color: C.muted }}>
                {sClicks.length} point{sClicks.length === 1 ? "" : "s"} captured.
                {sClicks.length > 0 && cal && (
                  <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.txt, marginTop: 6, maxHeight: 90, overflowY: "auto", lineHeight: 1.7 }}>
                    {sClicks.map((c, i) => {
                      const d = cal.toData({ px: c.px, py: c.py });
                      return <div key={i}>{i + 1}. x={fmt(d.x)}, y={fmt(d.y)}</div>;
                    })}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button onClick={undoCapture} style={{ ...btnS("ghost"), padding: "4px 12px", fontSize: 11 }}>Undo last click</button>
              {capErr && <span style={errTxt}>{capErr}</span>}
            </div>
          </div>
        )}

        {/* ── STEP 4: review ── */}
        {step === 4 && result && (
          <div style={{ marginBottom: 12 }}>
            <div style={secTitle}>Computed values</div>
            <div style={{ background: C.bg, border: `1px solid ${themeAlpha(C.grn, "44")}`, borderRadius: 8, padding: 14 }}>
              {result.figureType === "forest" && (
                <div style={{ fontSize: 13, fontFamily: MONO, color: C.txt }}>
                  {result.values.measure} = {fmt(result.values.est)} [{fmt(result.values.lo)}, {fmt(result.values.hi)}]
                  {logX && <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Read from a log-scaled axis.</div>}
                </div>
              )}
              {result.figureType === "bar" && (
                <div style={{ fontSize: 11.5, fontFamily: MONO, color: C.txt, lineHeight: 1.8 }}>
                  {result.values.arms.map((a, i) => (
                    <div key={i}>{a.label}: mean = {fmt(a.mean)}, SD = {fmt(a.sd)}, n = {a.n == null ? "—" : a.n}</div>
                  ))}
                </div>
              )}
              {result.figureType === "box" && (
                <div style={{ fontSize: 11.5, fontFamily: MONO, color: C.txt, lineHeight: 1.8 }}>
                  <div>Q1 = {fmt(result.values.q1)}, median = {fmt(result.values.median)}, Q3 = {fmt(result.values.q3)}</div>
                  <div>mean = {fmt(result.values.mean)}, SD = {fmt(result.values.sd)} (Wan et al. 2014), n = {result.values.n}</div>
                </div>
              )}
              {result.figureType === "km" && (
                <div style={{ fontSize: 13, fontFamily: MONO, color: C.txt }}>
                  HR (arm B vs arm A) = {fmt(result.values.est)} [{fmt(result.values.lo)}, {fmt(result.values.hi)}]
                  <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>
                    {result.values.method === "cox" ? "Cox (Breslow)" : "log-rank / Peto"} on Guyot-reconstructed pseudo-IPD.
                  </div>
                </div>
              )}
              {result.figureType === "scatter" && (
                <div style={{ fontSize: 11.5, color: C.txt }}>
                  <div style={{ marginBottom: 4 }}>{result.values.points.length} data point{result.values.points.length === 1 ? "" : "s"} (informational):</div>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, maxHeight: 110, overflowY: "auto", lineHeight: 1.7 }}>
                    {result.values.points.map((p, i) => <div key={i}>{i + 1}. x={fmt(p.x)}, y={fmt(p.y)}</div>)}
                  </div>
                </div>
              )}
              {(result.warnings || []).map((w, i) => <div key={i} style={warnBox}>{w}</div>)}
            </div>
            <div style={{ fontSize: 10.5, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>
              {collectProvenance().length} raw canvas clicks (calibration + capture) will be stored with the record
              as figure-region provenance, so the extraction stays auditable.
            </div>
          </div>
        )}

        {/* footer nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, paddingTop: 12, borderTop: `1px solid ${C.brd}` }}>
          <button onClick={onCancel} style={btnS("ghost")}>Cancel</button>
          <div style={{ flex: 1 }} />
          {step > 1 && (
            <button onClick={() => { setStep(step - 1); setCapErr(""); setCalErr(""); }} style={btnS("ghost")}>← Back</button>
          )}
          {step < 4 && (
            <button
              onClick={() => { if (step === 1) setStep(2); else if (step === 2) goCapture(); else goReview(); }}
              disabled={nextDisabled}
              style={{ ...btnS("primary"), ...(nextDisabled ? { opacity: 0.45, cursor: "not-allowed" } : {}) }}
            >
              {step === 3 ? "Review →" : "Next →"}
            </button>
          )}
          {step === 4 && (
            <button onClick={apply} style={btnS("success")}>Apply to draft</button>
          )}
        </div>
      </div>
    </div>
  );
}
