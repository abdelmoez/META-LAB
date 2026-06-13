CLAUDE MAX / FABLE 5.0 — RESEARCH ENGINE MATHEMATICS FIX, EGGER TEST CORRECTION, VERSIONING, COMMIT, AND PUSH

Claude, I want you to treat this as a serious research-engine correctness task.

This is not just a UI bug.
This affects the mathematical validity of META·LAB.

I want you to think deeply, verify against known methods, test with real examples, and only then implement.

Use the current agent workflow:

Fable:
- You are the architect and advanced reasoning lead.
- You make the workflow.
- You assign easy execution tasks to Sonnet agents.
- You assign reasoning/statistical validation tasks to Opus agents.
- You keep advanced reasoning, mathematical correctness, integration decisions, and final judgment for Fable agents.

Sonnet:
- Handle straightforward code edits, UI updates, tests, documentation updates, and repeated implementation tasks.

Opus:
- Handle statistical reasoning, method verification, edge cases, equation validation, and comparison against canonical implementations.

Fable:
- Own final mathematical judgment, final integration, final QA acceptance, version bump decision, commit, and push.

I trust your judgment. If you think something I wrote needs adjustment for mathematical correctness, explain it in your implementation notes and then implement the correct version.

Do not ask me small questions.
Think, decide, implement, test, commit, push, and report.

====================================================
TASK 1 — FIX RAW DATA EFFECT SIZE CALCULATION WHEN ZERO IS VALID
====================================================

In the Data Extraction tab in META·LAB, when calculating effect size from raw data, zero values are currently treated as invalid.

Example copied from the app:

CALCULATE EFFECT SIZE FROM RAW DATA

Dichotomous → Risk Ratio

2×2 counts:
a = events in intervention
b = non-events intervention
c = events control
d = non-events control

Example:
a = 0
b = 64
c = 2
d = 62

When I click:
Calculate & Apply

It shows:
“Check inputs — values may be missing, zero, or out of range.”

This is wrong.

Zero can be a real, valid value in clinical research.
For example, zero events in one arm is common and should not automatically fail validation.

I want you to think about this mathematically and come up with a correct solution that does not disturb the whole app.

Important:
Zero is valid for event counts and non-event counts.
Missing, negative, non-numeric, or impossible values are invalid.
But zero itself is not invalid.

Expected behavior:
1. If a, b, c, or d is zero, do not reject only because it is zero.
2. For dichotomous effect sizes that require logarithms, such as Risk Ratio or Odds Ratio, handle zero cells correctly.
3. Do not produce Infinity, NaN, or broken calculations.
4. Do not silently produce misleading numbers.
5. Explain in UI when a continuity correction is applied.
6. Test with real-life article-like examples before returning.

Mathematical guidance:
For Risk Ratio and Odds Ratio:
- log(RR) and log(OR) cannot be computed directly when one needed event cell is zero.
- Use a continuity correction when appropriate.

Recommended practical implementation:
1. If calculating log RR or log OR and any cell in the 2×2 table is zero, apply a continuity correction.
2. Use Haldane–Anscombe correction as the default:
   - add 0.5 to all four cells when any cell is zero.
3. Clearly mark the result:
   - “Continuity correction applied because at least one cell was zero.”
4. Store metadata if the data model supports it:
   - continuityCorrectionApplied: true
   - continuityCorrectionValue: 0.5
   - correctionMethod: "Haldane-Anscombe"
5. For double-zero event studies:
   - example: a = 0 and c = 0
   - for RR/OR, this study is often non-informative for relative effect.
   - Do not crash.
   - Either:
     A. calculate with correction but warn strongly, or
     B. mark as not estimable for RR/OR and suggest Risk Difference.
   - I want your statistical opinion here. Choose the safest approach and document it.
6. For Risk Difference:
   - zero cells are naturally allowed.
   - no continuity correction is needed unless another issue exists.
7. Make validation distinguish:
   - missing value
   - negative value
   - non-integer count
   - impossible count
   - zero cell requiring correction
8. Update UI messaging:
   - Do not say “values may be missing, zero, or out of range.”
   - Instead say the real issue.
   - Example:
     “Zero event cell detected. A 0.5 continuity correction was applied for log Risk Ratio.”
     or:
     “Counts must be non-negative integers.”

Specific test example:
a = 0
b = 64
c = 2
d = 62

For Risk Ratio:
- This should not fail validation.
- It should calculate using the chosen correction method.
- It should apply the effect size and SE correctly.
- It should not break downstream meta-analysis.

Files to inspect/update:
- Data Extraction raw effect-size calculator UI
- research-engine effect size calculation functions
- validation logic
- any identical copied logic in meta-lab-3-patched.jsx
- Methods & Equations page if equations or correction methods are described there

Required tests:
1. a=0, b=64, c=2, d=62 for Risk Ratio.
2. a=0, b=64, c=2, d=62 for Odds Ratio.
3. a=0, b=64, c=0, d=62 double-zero events.
4. Risk Difference with zeros.
5. Negative value should still fail.
6. Missing value should still fail.
7. Non-numeric value should still fail.
8. Downstream meta-analysis should not crash after applying corrected effect size.

Document:
- continuity correction method
- when it is applied
- limitations
- reference if included in Methods & Equations

====================================================
TASK 2 — FIX EGGER’S REGRESSION TEST TO MATCH CANONICAL EGGER 1997
====================================================

TASK:
Fix the Egger's regression test in META·LAB so it matches the canonical Egger (1997) test and standard implementations such as:

R:
metafor::regtest(..., model = "lm")

FILE / FUNCTION:
- eggersTest() in:
  src/research-engine/statistics/meta-analysis.js

Important:
The UI runs the identical copy in:
- meta-lab-3-patched.jsx

Update both.

Also update:
- “Egger's regression test” entry in the Methods & Equations page.

THE BUG:
The current implementation runs a WEIGHTED least-squares regression with weights:

w_i = 1 / SE_i^2

of:

y_i = ES_i / SE_i

on:

x_i = 1 / SE_i

The canonical Egger test is an UNWEIGHTED ordinary least-squares regression of the standard normal deviate on precision.

Applying 1/SE² weights in the ES/SE versus 1/SE space double-counts precision and changes the intercept, t statistic, and p-value.

The conclusion can sometimes still be correct, but the numbers are wrong and do not match metafor or the published method.

THE FIX:
Use ordinary unweighted least squares.

Concretely:
- set every regression weight to 1
- remove the 1/SE² weighting
- keep the rest of the structure if possible

Canonical equations:

For k studies:

y_i = ES_i / SE_i
x_i = 1 / SE_i

Sx  = sum(x_i)
Sy  = sum(y_i)
Sxx = sum(x_i^2)
Sxy = sum(x_i * y_i)

slope:

b1 = (k*Sxy - Sx*Sy) / (k*Sxx - Sx^2)

intercept:

b0 = (Sy - b1*Sx) / k

b0 is Egger's bias coefficient.

Residuals:

e_i = y_i - (b0 + b1*x_i)

Residual variance:

s2 = sum(e_i^2) / (k - 2)

Standard error of intercept:

SE(b0) = sqrt( s2 * Sxx / (k*Sxx - Sx^2) )

Test statistic:

t = b0 / SE(b0)

df = k - 2

p = 2 * (1 - tCDF(abs(t), k - 2))

Report:
- intercept b0
- t
- df = k - 2
- p

Test asymmetry via the intercept.

Keep:
- k >= 3 requirement
- interpretation at p < 0.10

UNIT TEST FIXTURE:

Effect = Cohen's d
SE as shown

studies = [
  {es:1.4623,se:0.6017},
  {es:1.3832,se:0.5950},
  {es:1.1427,se:0.3946},
  {es:-0.1032,se:0.2377},
  {es:-0.3918,se:0.2289},
  {es:2.1994,se:0.3028},
  {es:1.1561,se:0.6237},
  {es:0.0732,se:0.5775},
  {es:0.7774,se:0.2968},
  {es:0.1620,se:0.5008},
  {es:0.1659,se:0.5009},
  {es:0.5937,se:0.2867},
  {es:0.6990,se:0.2540},
  {es:-0.3172,se:0.3803}
]

k = 14

EXPECTED AFTER FIX:
Canonical / metafor-like result:

intercept ≈ 1.86
t ≈ 1.01
df = 12
p ≈ 0.334

CURRENT BUGGY OUTPUT FOR REFERENCE:
This confirms the old behavior:

intercept ≈ 3.94
t ≈ 1.42
df = 12
p ≈ 0.181

Cross-check in R:

metafor::regtest(rma(yi, sei, method="FE"), model="lm")

Expected:
intercept approximately 1.86
p approximately 0.33

NOTES:
1. This changes Egger output for every analysis.
2. Trim-and-fill, which centers on the pooled estimate, should be unaffected.
3. Verify trim-and-fill still imputes k0 = 0 for this fixture if currently expected.
4. Update Methods & Equations text:
   - The regression is UNWEIGHTED ordinary least squares of ES/SE on 1/SE.
   - Remove any language saying “weighted OLS, w = 1/SE².”
5. Reference:
   Egger M, Davey Smith G, Schneider M, Minder C. BMJ. 1997;315:629-634.

====================================================
TASK 3 — METHODS & EQUATIONS PAGE UPDATE
====================================================

Update the Methods & Equations page professionally.

Add or correct:

1. Egger’s regression test:
   - unweighted OLS
   - standard normal deviate ES/SE
   - precision 1/SE
   - intercept as asymmetry/bias coefficient
   - t test with df = k - 2
   - p < 0.10 convention if used
   - cite Egger 1997 BMJ

2. Zero-cell dichotomous calculations:
   - zero event cells are valid clinical data
   - log RR and log OR cannot be directly computed with zero cells
   - continuity correction approach
   - when correction is applied
   - double-zero event limitation
   - Risk Difference may be more appropriate in some zero-event contexts

Make the writing concise, professional, and academic.

Do not invent references.
If unsure, mark as needing verification or use only established sources.

====================================================
TASK 4 — TESTING REQUIREMENTS
====================================================

Opus agents should verify the math.
Sonnet agents should implement tests.
Fable should approve final correctness.

Required tests:

Raw data effect-size tests:
1. RR with a zero event cell:
   a=0, b=64, c=2, d=62
2. OR with a zero event cell:
   a=0, b=64, c=2, d=62
3. RD with zero event cell:
   a=0, b=64, c=2, d=62
4. Double-zero event case:
   a=0, b=64, c=0, d=62
5. Negative counts fail.
6. Missing counts fail.
7. Non-numeric counts fail.
8. Correct UI warning appears when continuity correction is applied.

Egger tests:
1. Fixture above returns approximately:
   - intercept ≈ 1.86
   - t ≈ 1.01
   - df = 12
   - p ≈ 0.334
2. Old weighted result should no longer appear.
3. k < 3 still fails gracefully.
4. Invalid SE <= 0 fails gracefully.
5. Trim-and-fill unaffected.
6. Methods & Equations text updated.

Integration tests:
1. Calculate effect size from raw data.
2. Apply to study.
3. Run meta-analysis.
4. Run Egger test.
5. No NaN/Infinity values.
6. UI does not crash.
7. Saved project reloads with applied values.

Manual QA:
Use at least one real-life style dichotomous example with zero events.
Confirm it works from UI, not just unit tests.

====================================================
TASK 5 — VERSION BUMP, COMMIT, AND PUSH
====================================================

After implementation and testing:

1. Decide version bump using your judgment.

Current example:
v2.7.0

Rules:
- Minor patch/bug fix:
  update third number
  example: v2.7.0 → v2.7.1

- Meaningful feature or important research-engine correction:
  update second number
  example: v2.7.0 → v2.8.0

- Major overhaul/state-of-the-art new system:
  update first number
  example: v2.7.0 → v3.0.0

This task fixes research-engine mathematical correctness and raw-data clinical calculation behavior. I trust your judgment whether this is patch or minor. Explain your reasoning.

2. Update version files/metadata.

3. Run tests.

4. Run build if available.

5. Commit changes with a clear commit message.

Suggested commit message:
fix: correct Egger regression and zero-cell raw effect calculations

6. Push to the current branch.

Important:
- If git remote is configured and safe, push.
- If push fails because of auth/remote issue, commit locally and report exact reason.
- Do not include secrets.
- Do not commit generated junk files.
- Do not commit broken test artifacts.

====================================================
FINAL REPORT
====================================================

When finished, report:

1. Your mathematical opinion on the zero-cell issue.
2. What continuity correction strategy you chose and why.
3. How double-zero event studies are handled.
4. Exact Egger bug found.
5. Exact Egger fix implemented.
6. Test results for the provided Egger fixture.
7. Test results for zero-cell raw data.
8. Methods & Equations updates.
9. Files changed.
10. Version bump decision and new version.
11. Commit hash.
12. Push status.
13. Any remaining limitations or recommendations.

Do not return until this is implemented, tested, versioned, committed, and pushed if possible.