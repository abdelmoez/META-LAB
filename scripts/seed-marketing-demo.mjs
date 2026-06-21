/**
 * seed-marketing-demo.mjs — ADDITIVE demo data for marketing screenshots.
 *
 * Creates ONE clearly-marked demo Review Project ("GLP-1 Receptor Agonists for
 * Weight Loss in Adults With Obesity") plus its linked screening workspace, demo
 * reviewers, decisions, a duplicate group, conflicts, and a populated PRISMA/
 * extraction/analysis dataset — so every main workflow tab looks realistic.
 *
 * SAFETY
 *  - Additive + idempotent: it removes ONLY its own demo data (owned by the demo
 *    user, by the exact demo title) and recreates it. It NEVER resets the DB or
 *    touches real users/projects.
 *  - Uses fake, reserved-domain emails (@pecanrev.example) and fake names. No real
 *    patient data, no secrets.
 *  - Enables the `searchEngine` + `serverBackedWorkflowState` feature flags
 *    (additively — other flags preserved) so the new Search Builder renders.
 *
 * USAGE
 *   node scripts/seed-marketing-demo.mjs            # create / refresh the demo
 *   node scripts/seed-marketing-demo.mjs --remove   # delete the demo data
 *
 * Requires the app's normal env (DATABASE_URL, JWT_SECRET) — see server/.env.
 * Run with the same DATABASE_URL the dev server uses.
 */
import '../server/load-env.js';
import { prisma } from '../server/db/client.js';
import { save, remove as removeProject } from '../server/store.js';
import { mkProject, mkStudy, uid, now } from '../src/research-engine/project-model/defaults.js';
import { hashPassword } from '../server/auth/password.js';

const PROJECT_TITLE = 'GLP-1 Receptor Agonists for Weight Loss in Adults With Obesity';
const CURATOR = { email: 'demo.curator@pecanrev.example', name: 'Dr. Demo Curator', role: 'admin' };
const REVIEWER = { email: 'demo.reviewer@pecanrev.example', name: 'Dr. Sam Reviewer', role: 'user' };
const DEMO_PASSWORD = 'PecanRevDemo2026!'; // demo-only; documented in marketing/README.md
const REMOVE = process.argv.includes('--remove');

const log = (...a) => console.log('[marketing-seed]', ...a);

/** MD effect size + 95% CI from two-arm continuous data (keeps es/CI internally consistent). */
function md(nE, mE, sE, nC, mC, sC) {
  const es = mE - mC;
  const se = Math.sqrt((sE * sE) / nE + (sC * sC) / nC);
  const r2 = (x) => Math.round(x * 100) / 100;
  return { es: String(r2(es)), lo: String(r2(es - 1.96 * se)), hi: String(r2(es + 1.96 * se)) };
}

async function ensureUser({ email, name, role }) {
  let u = await prisma.user.findUnique({ where: { email } });
  if (!u) {
    u = await prisma.user.create({ data: { email, name, role, password: await hashPassword(DEMO_PASSWORD) } });
    log('created demo user', email, `(${role})`);
  }
  // Best-effort: skip onboarding so screenshots land on the dashboard, not a wizard.
  try { await prisma.user.update({ where: { id: u.id }, data: { onboardingCompleted: true } }); } catch { /* field may not exist */ }
  return u;
}

async function cleanup(curatorId) {
  // Hard-remove prior demo data (demo-owned, exact title) so a re-run is a clean refresh.
  const blobs = await prisma.project.findMany({ where: { userId: curatorId, name: PROJECT_TITLE }, select: { id: true } });
  for (const b of blobs) {
    await prisma.screenProject.deleteMany({ where: { linkedMetaLabProjectId: b.id } });
    try { await prisma.robAssessment.deleteMany({ where: { projectId: b.id } }); } catch { /* RoB rows cascade on project delete anyway */ }
    try { await removeProject(b.id, curatorId); } catch { /* fall through to hard delete */ }
    await prisma.project.deleteMany({ where: { id: b.id } });
  }
  await prisma.screenProject.deleteMany({ where: { ownerId: curatorId, title: PROJECT_TITLE } });
  if (blobs.length) log('removed', blobs.length, 'prior demo project(s)');
}

async function enableFlags() {
  const row = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
  let flags = {};
  try { flags = JSON.parse(row?.value || '{}'); } catch { flags = {}; }
  flags.searchEngine = true;             // render the new concept→DB Search Builder
  flags.serverBackedWorkflowState = true; // server-backed module persistence
  flags.rob_engine_v2 = true;             // render the RoB 2 assessment workspace (latest)
  await prisma.siteSetting.upsert({
    where: { key: 'featureFlags' },
    update: { value: JSON.stringify(flags) },
    create: { key: 'featureFlags', value: JSON.stringify(flags) },
  });
  log('feature flags enabled (additive): searchEngine, serverBackedWorkflowState, rob_engine_v2');
}

/* ── Demo citations (fake-but-plausible; safe for marketing) ─────────────────── */
const CITATIONS = [
  ['Wilding JPH, Batterham RL, Calanna S', '2021', 'New England Journal of Medicine', 'Once-Weekly Semaglutide in Adults with Overweight or Obesity', '10.1056/NEJMoa2032183', '33567185'],
  ['Davies M, Færch L, Jeppesen OK', '2021', 'The Lancet', 'Semaglutide 2.4 mg once a week in adults with overweight or obesity, and type 2 diabetes (STEP 2)', '10.1016/S0140-6736(21)00213-0', '33667417'],
  ['Jastreboff AM, Aronne LJ, Ahmad NN', '2022', 'New England Journal of Medicine', 'Tirzepatide Once Weekly for the Treatment of Obesity', '10.1056/NEJMoa2206038', '35658024'],
  ['Rubino D, Abrahamsson N, Davies M', '2021', 'JAMA', 'Effect of Continued Weekly Subcutaneous Semaglutide vs Placebo on Weight Loss Maintenance (STEP 4)', '10.1001/jama.2021.3224', '33755728'],
  ['Pi-Sunyer X, Astrup A, Fujioka K', '2015', 'New England Journal of Medicine', 'A Randomized, Controlled Trial of 3.0 mg of Liraglutide in Weight Management', '10.1056/NEJMoa1411892', '26132939'],
  ['Wadden TA, Bailey TS, Billings LK', '2021', 'JAMA', 'Effect of Subcutaneous Semaglutide vs Placebo as an Adjunct to Intensive Behavioral Therapy (STEP 3)', '10.1001/jama.2021.1831', '33625476'],
  ['Garvey WT, Frias JP, Jastreboff AM', '2023', 'The Lancet', 'Tirzepatide once weekly for the treatment of obesity in people with type 2 diabetes (SURMOUNT-2)', '10.1016/S0140-6736(23)01200-X', '37385275'],
  ["O'Neil PM, Birkenfeld AL, McGowan B", '2018', 'The Lancet', 'Efficacy and safety of semaglutide compared with liraglutide and placebo for weight loss', '10.1016/S0140-6736(18)31773-2', '30122305'],
  ['Aronne LJ, Sattar N, Horn DB', '2024', 'JAMA', 'Continued Treatment With Tirzepatide for Maintenance of Weight Reduction (SURMOUNT-4)', '10.1001/jama.2023.24945', '38078870'],
  ['Kushner RF, Calanna S, Davies M', '2020', 'Obesity', 'Semaglutide 2.4 mg for the Treatment of Obesity: Key Elements of the STEP Trials', '10.1002/oby.22794', '32090499'],
  ['Frias JP, Davies MJ, Rosenstock J', '2021', 'New England Journal of Medicine', 'Tirzepatide versus Semaglutide Once Weekly in Patients with Type 2 Diabetes', '10.1056/NEJMoa2107519', '34370970'],
  ['Lincoff AM, Brown-Frandsen K, Colhoun HM', '2023', 'New England Journal of Medicine', 'Semaglutide and Cardiovascular Outcomes in Obesity without Diabetes (SELECT)', '10.1056/NEJMoa2307563', '37952131'],
  ['Smith J, Doe A, Roe B', '2019', 'Diabetes Care', 'A pilot study of GLP-1 receptor agonists for weight management in primary care', '10.2337/dc19-0001', '30000001'],
  ['Smith J, Doe A, Roe B', '2019', 'Diabetes Care', 'A pilot study of GLP-1 receptor agonists for weight management in primary care', '10.2337/dc19-0001', '30000001'], // intentional duplicate → Duplicates tab
];

// Realistic (fake-but-plausible) abstracts so the Title & Abstract screening view reads
// like a real review. Assigned to records round-robin. No real patient data.
const ABSTRACTS = [
  'Background: Obesity is a chronic disease with limited pharmacologic options. We assessed once-weekly subcutaneous semaglutide 2.4 mg as an adjunct to lifestyle intervention in adults with overweight or obesity. Methods: In this 68-week, double-blind, randomized, placebo-controlled trial, 1,961 adults without diabetes (mean BMI 37.9) were assigned 2:1 to semaglutide or placebo. Results: Mean change in body weight was −14.9% with semaglutide versus −2.4% with placebo (P<0.001); 86.4% achieved ≥5% weight loss. Gastrointestinal adverse events were more common with semaglutide. Conclusions: Once-weekly semaglutide plus lifestyle intervention produced clinically meaningful, sustained weight loss.',
  'Background: Liraglutide, a GLP-1 receptor agonist, reduces body weight at the 3.0 mg dose. Methods: We randomized 3,731 adults with a BMI ≥30 (or ≥27 with a weight-related comorbidity) and without diabetes to liraglutide 3.0 mg or placebo, both with diet and exercise counseling, for 56 weeks. Results: The liraglutide group lost a mean of 8.4 kg versus 2.8 kg with placebo (difference −5.6 kg; 95% CI −6.0 to −5.1); more participants achieved ≥5% (63.2% vs 27.1%) and >10% (33.1% vs 10.6%) weight loss. Nausea and gallbladder events were more frequent. Conclusions: Liraglutide 3.0 mg led to significant weight loss and improved metabolic risk factors.',
  'Background: Tirzepatide is a once-weekly dual GIP/GLP-1 receptor agonist. Methods: In this 72-week, phase 3, double-blind trial, 2,539 adults with obesity and without diabetes were randomized to tirzepatide (5, 10, or 15 mg) or placebo. Results: Mean percentage weight change was −15.0%, −19.5%, and −20.9% across tirzepatide doses versus −3.1% with placebo (P<0.001 for all comparisons); up to 57% achieved ≥20% weight reduction. The most common adverse events were gastrointestinal and mostly mild to moderate. Conclusions: Tirzepatide produced substantial, dose-dependent weight reduction in adults with obesity.',
  'Background: Intensive behavioral therapy (IBT) for obesity typically yields modest weight loss. Methods: 611 adults with overweight or obesity were randomized to once-weekly semaglutide 2.4 mg or placebo, both with IBT and an initial low-calorie diet, over 68 weeks. Results: Mean body-weight change was −16.0% with semaglutide versus −5.7% with placebo (P<0.001); 75.3% achieved ≥10% weight loss versus 27.0%. Gastrointestinal events were more frequent with semaglutide. Conclusions: Semaglutide plus IBT resulted in significantly greater weight loss than IBT alone.',
  'Background: Whether continued GLP-1 treatment maintains weight loss is uncertain. Methods: After a 20-week run-in on semaglutide 2.4 mg, 803 adults were randomized to continue semaglutide or switch to placebo for 48 weeks. Results: Participants continuing semaglutide lost a further −7.9%, whereas those switched to placebo regained +6.9% (estimated difference −14.8 percentage points; P<0.001). Adverse events were consistent with the known profile. Conclusions: Maintaining semaglutide sustained and augmented weight loss, whereas withdrawal led to regain.',
  'Background: GLP-1 receptor agonists reduce weight, but cardiovascular effects in obesity without diabetes were unknown. Methods: 17,604 adults ≥45 years with established cardiovascular disease and a BMI ≥27, without diabetes, were randomized to semaglutide 2.4 mg or placebo and followed for a mean of 39.8 months. Results: A primary cardiovascular event occurred in 6.5% with semaglutide versus 8.0% with placebo (HR 0.80; 95% CI 0.72–0.90; P<0.001); mean weight reduction was 9.4%. Conclusions: In patients with obesity and cardiovascular disease, semaglutide reduced major adverse cardiovascular events.',
];

function buildBlob() {
  const p = mkProject(PROJECT_TITLE);
  p.pico = {
    ...p.pico,
    question: 'In adults with obesity or overweight, do GLP-1 receptor agonists, compared with placebo or standard lifestyle intervention, improve weight loss and metabolic outcomes?',
    P: 'Adults (≥18 years) with obesity or overweight (BMI ≥ 27 kg/m²)',
    I: 'GLP-1 receptor agonists (e.g. semaglutide, liraglutide, tirzepatide)',
    C: 'Placebo or standard lifestyle intervention',
    O: 'Weight loss, HbA1c change, adverse events, treatment discontinuation',
    studyDesign: 'RCT',
    timeframeMode: 'last10',
    timeframe: 'Last 10 years',
    prosperoId: 'CRD42026000000',
    keywords: 'obesity, overweight, GLP-1 receptor agonists, semaglutide, liraglutide, tirzepatide, weight loss, HbA1c',
    incl: 'Randomised controlled trials; adults with obesity/overweight; GLP-1 RA vs placebo or lifestyle; reports weight or metabolic outcomes; published in the last 10 years.',
    excl: 'Non-randomised studies; paediatric populations; non-GLP-1 comparators only; conference abstracts without extractable data; case reports.',
    notes: 'Demo protocol generated for marketing screenshots.',
  };
  p.search = {
    ...p.search,
    dbs: { ...p.search.dbs, PubMed: true, Embase: true, 'Cochrane CENTRAL': true, Scopus: true, 'ClinicalTrials.gov': true },
    date: '2015-01-01 to 2025-12-31',
    string: '("glucagon-like peptide 1"[MeSH] OR GLP-1 OR semaglutide OR liraglutide OR tirzepatide) AND (obesity OR overweight OR "weight loss") AND (randomized controlled trial[pt])',
    notes: 'Demo search strategy; last run 2026-06-01.',
  };
  p.prisma = {
    ...p.prisma,
    dbs: '1284', reg: '96', other: '23', dedupe: '1107', screened: '1107',
    excTA: '942', excFull: '129',
    reasons: [
      { id: uid(), r: 'Not a randomised controlled trial', n: '58' },
      { id: uid(), r: 'Population did not meet criteria', n: '31' },
      { id: uid(), r: 'No eligible outcome reported', n: '24' },
      { id: uid(), r: 'No GLP-1 RA comparison', n: '16' },
    ],
    included: '36', qual: '36', quant: '28',
  };
  // Screening records (blob copy — the screening workspace mirrors these into Screen* rows).
  p.records = CITATIONS.slice(0, 13).map(([authors, year, journal, title, doi, pmid], i) => ({
    id: uid(), title, authors, year, journal, doi, pmid,
    abstract: ABSTRACTS[i % ABSTRACTS.length],
    source: 'PubMed',
  }));
  // Extracted studies with consistent mean-difference (kg) weight-loss effect sizes — clean
  // author/year labels + a drug-class field so Forest, Sensitivity, and Subgroup all read well.
  // RAW = [author, year, country, drugClass, nE, mE, sE, nC, mC, sC]
  const RAW = [
    ['Wilding', '2021', 'United Kingdom', 'Semaglutide', 200, -9.6, 6.5, 200, -3.4, 6.0],
    ['Davies', '2021', 'Denmark', 'Semaglutide', 180, -6.1, 5.8, 180, -1.9, 5.4],
    ['Rubino', '2021', 'United States', 'Semaglutide', 150, -8.9, 6.2, 150, -3.1, 5.7],
    ['Wadden', '2021', 'United States', 'Semaglutide', 130, -10.3, 6.8, 130, -3.0, 6.1],
    ['Kushner', '2020', 'United States', 'Semaglutide', 140, -8.2, 6.1, 140, -2.5, 5.5],
    ['Jastreboff', '2022', 'United States', 'Tirzepatide', 210, -12.4, 7.1, 210, -2.1, 5.9],
    ['Garvey', '2023', 'United States', 'Tirzepatide', 170, -11.1, 7.0, 170, -2.4, 5.8],
    ['Aronne', '2024', 'United States', 'Tirzepatide', 160, -10.6, 6.9, 160, -2.8, 5.9],
    ['Pi-Sunyer', '2015', 'United States', 'Liraglutide', 240, -5.4, 5.5, 240, -2.0, 5.1],
    ["O'Neil", '2018', 'United States', 'Liraglutide', 110, -7.8, 6.0, 110, -2.6, 5.6],
  ];
  p.studies = RAW.map(([author, year, country, drugClass, nE, mE, sE, nC, mC, sC]) => {
    const s = mkStudy();
    const { es, lo, hi } = md(nE, mE, sE, nC, mC, sC);
    return {
      ...s, author, year, country, drugClass, design: 'RCT', n: String(nE + nC),
      outcome: 'Body-weight change (kg) at 52 weeks',
      title: `${author} et al. (${year}) — ${drugClass} vs comparator`,
      authors: `${author} et al.`, journal: 'Demo Journal of Obesity', esType: 'MD',
      timepoint: '52 weeks', adjusted: 'unadjusted', dataNature: 'primary',
      nExp: String(nE), meanExp: String(mE), sdExp: String(sE),
      nCtrl: String(nC), meanCtrl: String(mC), sdCtrl: String(sC),
      es, lo, hi, source: 'table',
      extractedBy: CURATOR.name, extractedAt: now(), addedAt: now(), updatedAt: now(),
    };
  });
  return p;
}

async function seedScreening(blobId, curator, reviewer) {
  const sp = await prisma.screenProject.create({
    data: {
      ownerId: curator.id, linkedMetaLabProjectId: blobId, title: PROJECT_TITLE,
      description: 'Demo systematic review workspace for marketing screenshots.',
      reviewQuestion: 'GLP-1 receptor agonists vs placebo/lifestyle for weight loss in adults with obesity.',
      stage: 'title_abstract', progressStatus: 'in_progress', requiredScreeningReviewers: 2,
      inclusionKeywords: JSON.stringify(['semaglutide', 'liraglutide', 'tirzepatide', 'weight loss', 'randomised']),
      exclusionKeywords: JSON.stringify(['paediatric', 'animal', 'case report']),
      picoSnapshot: JSON.stringify({ P: 'Adults with obesity', I: 'GLP-1 RA', C: 'Placebo/lifestyle', O: 'Weight loss' }),
    },
  });
  await prisma.screenImportBatch.create({
    data: { projectId: sp.id, filename: 'pubmed_glp1_export.ris', format: 'RIS', recordCount: CITATIONS.length, importedByName: curator.name, parser: 'RIS' },
  });
  const dupGroup = await prisma.screenDuplicateGroup.create({ data: { projectId: sp.id } });

  const records = [];
  for (let i = 0; i < CITATIONS.length; i++) {
    const [authors, year, journal, title, doi, pmid] = CITATIONS[i];
    const isDup = i === CITATIONS.length - 1;            // last is the planted duplicate
    const isPrimaryDup = i === CITATIONS.length - 2;     // its primary
    const stageFull = i < 5;                             // first 5 promoted to full text
    const accepted = i < 3;                              // first 3 accepted → extraction
    const rejected = i === 5 || i === 6;                 // a couple rejected at full text
    const rec = await prisma.screenRecord.create({
      data: {
        projectId: sp.id, title, authors, year, journal, doi, pmid,
        abstract: ABSTRACTS[i % ABSTRACTS.length],
        sourceDb: 'PubMed',
        duplicateGroupId: (isDup || isPrimaryDup) ? dupGroup.id : null,
        isDuplicate: isDup, isPrimary: isPrimaryDup,
        currentStage: stageFull ? 'full_text' : 'title_abstract',
        promotedVia: stageFull ? 'quorum' : '', promotedAt: stageFull ? new Date() : null,
        finalStatus: accepted ? 'accepted' : (rejected ? 'rejected' : ''),
        acceptedAt: accepted ? new Date() : null,
        handoffStatus: accepted ? 'sent' : '', handoffAt: accepted ? new Date() : null,
        rejectedReason: rejected ? 'No eligible outcome reported' : '',
      },
    });
    records.push(rec);
  }
  if (records.length >= 2) {
    await prisma.screenDuplicateGroup.update({ where: { id: dupGroup.id }, data: { primaryId: records[records.length - 2].id } });
  }

  // Two reviewers decide every record; records 7 & 8 are deliberate conflicts.
  const reviewers = [{ id: curator.id, name: curator.name }, { id: reviewer.id, name: reviewer.name }];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const conflict = i === 7 || i === 8;
    for (let r = 0; r < reviewers.length; r++) {
      let decision = i < 9 ? 'include' : 'exclude';
      if (conflict) decision = r === 0 ? 'include' : 'exclude';
      await prisma.screenDecision.create({
        data: {
          recordId: rec.id, projectId: sp.id, reviewerId: reviewers[r].id, reviewerName: reviewers[r].name,
          stage: 'title_abstract', decision,
          exclusionReason: decision === 'exclude' ? 'Population did not meet criteria' : '',
        },
      });
    }
    if (conflict) {
      await prisma.screenConflict.create({
        data: {
          projectId: sp.id, recordId: rec.id,
          reviewerDecisions: JSON.stringify({ [reviewers[0].id]: 'include', [reviewers[1].id]: 'exclude' }),
          finalDecision: '',
        },
      });
    }
  }

  // Members table (owner + active reviewer + pending leader/viewer) — fake emails.
  const members = [
    { userId: curator.id, name: curator.name, email: curator.email, role: 'owner', status: 'active', canScreen: true, canChat: true, canResolveConflicts: true, canManageMembers: true, canManageSettings: true, permissionPreset: 'owner' },
    { userId: reviewer.id, name: reviewer.name, email: reviewer.email, role: 'reviewer', status: 'active', canScreen: true, canChat: true, permissionPreset: 'reviewer' },
    { userId: null, name: 'Dr. Priya Lead', email: 'priya.lead@pecanrev.example', role: 'leader', status: 'pending', canScreen: true, canChat: true, canResolveConflicts: true, canManageMembers: true, permissionPreset: 'leader' },
    { userId: null, name: 'Alex Viewer', email: 'alex.viewer@pecanrev.example', role: 'viewer', status: 'pending', canScreen: false, permissionPreset: 'viewer' },
  ];
  for (const m of members) {
    await prisma.screenProjectMember.create({ data: { projectId: sp.id, ...m } });
  }
  log('screening workspace seeded:', records.length, 'records, 2 conflicts, 1 duplicate group,', members.length, 'members');
  return sp;
}

async function seedRob(projectId, studies, curator) {
  // RoB 2 demo (rob_engine_v2): one COMPLETE assessment per study with D1–D5 domain
  // judgments + overall, so the workspace shows a populated traffic-light. D1 signalling
  // questions are answered too (populated domain view if opened). Best-effort.
  const DOMAINS = ['D1', 'D2', 'D3', 'D4', 'D5'];
  const PROFILES = [
    { D1: 'low', D2: 'low', D3: 'low', D4: 'low', D5: 'some', overall: 'some' },
    { D1: 'low', D2: 'some', D3: 'low', D4: 'low', D5: 'low', overall: 'some' },
    { D1: 'low', D2: 'low', D3: 'low', D4: 'low', D5: 'low', overall: 'low' },
    { D1: 'some', D2: 'high', D3: 'low', D4: 'some', D5: 'low', overall: 'high' },
    { D1: 'low', D2: 'low', D3: 'some', D4: 'low', D5: 'low', overall: 'some' },
  ];
  const targets = (studies || []).slice(0, 5);
  for (let i = 0; i < targets.length; i++) {
    const st = targets[i]; const prof = PROFILES[i % PROFILES.length];
    const a = await prisma.robAssessment.create({ data: {
      projectId, studyId: st.id, resultLabel: 'Body-weight change at 52 weeks',
      instrumentId: 'RoB2', reviewerId: curator.id, reviewerName: curator.name, status: 'complete',
    } });
    for (const d of DOMAINS) {
      await prisma.robDomainJudgment.create({ data: { assessmentId: a.id, domainId: d, proposedJudgment: prof[d], finalJudgment: prof[d] } });
    }
    const d1 = prof.D1;
    const ans = d1 === 'low' ? ['Y', 'Y', 'PY'] : d1 === 'high' ? ['N', 'PN', 'NI'] : ['PY', 'NI', 'Y'];
    for (let q = 0; q < 3; q++) {
      await prisma.robAnswer.create({ data: { assessmentId: a.id, domainId: 'D1', questionId: `1.${q + 1}`, response: ans[q], rationale: 'Allocation sequence and concealment reported; baseline groups balanced. (Demo rationale.)' } });
    }
    await prisma.robOverall.create({ data: { assessmentId: a.id, proposedOverall: prof.overall, finalOverall: prof.overall } });
  }
  log('RoB seeded:', targets.length, 'RoB 2 assessments (D1–D5 + overall)');
}

async function main() {
  const curator = await ensureUser(CURATOR);
  const reviewer = await ensureUser(REVIEWER);

  if (REMOVE) {
    await cleanup(curator.id);
    log('demo data removed. (Demo users + feature flags left in place.)');
    return;
  }

  await cleanup(curator.id);
  await enableFlags();

  const blob = buildBlob();
  const saved = await save(blob, curator.id);
  log('demo project created:', saved.id, '—', saved.name);

  try {
    await seedScreening(saved.id, curator, reviewer);
  } catch (e) {
    log('NOTE: screening workspace seed failed (blob project is still fully usable):', e.message);
  }

  try {
    await seedRob(saved.id, saved.studies || blob.studies, curator);
  } catch (e) {
    log('NOTE: RoB seed failed (rob_engine_v2 is on; the new RoB UI still renders):', e.message);
  }

  log('done. Log in as', CURATOR.email, '/', DEMO_PASSWORD);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error('[marketing-seed] FAILED:', e); await prisma.$disconnect(); process.exit(1); });
