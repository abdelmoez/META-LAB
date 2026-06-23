/**
 * scripts/pecan-100-strategies.mjs — live diagnostic harness for the Pecan Search
 * Engine. Runs 100 diverse search strategies through ALL seven connectors:
 *   - translateQuery (offline, deterministic) — catches translation bugs, empty
 *     queries, silent-weakening warnings, malformed output.
 *   - previewCount  (LIVE, bounded per call) — catches 0-result regressions,
 *     provider rejections, timeouts, and cross-provider disagreement.
 *
 * It writes a machine-readable JSON report + a human Markdown summary and prints a
 * triage of the most important shortcomings (empty translations, 0-vs-siblings,
 * errors, query anomalies). NOT part of CI — a manual, real-network tool.
 *
 *   node scripts/pecan-100-strategies.mjs            # all 100, live
 *   node scripts/pecan-100-strategies.mjs --no-live  # translate only (instant)
 *   node scripts/pecan-100-strategies.mjs --limit 20 # first N strategies
 */
import { writeFileSync } from 'node:fs';
import { createEngineContext } from '../server/pecanSearch/connectors/registry.js';

const argv = process.argv.slice(2);
const LIVE = !argv.includes('--no-live');
const LIMIT = (() => { const i = argv.indexOf('--limit'); return i >= 0 ? parseInt(argv[i + 1], 10) : Infinity; })();
const PER_CALL_TIMEOUT_MS = 15000;   // harness-side hard bound per provider preview
const PER_CALL_RETRY = 1;

// ── canonical-query builders ───────────────────────────────────────────────────
const T = (text, opts = {}) => ({
  text,
  field: opts.field || 'tiab',
  ...(opts.type ? { type: opts.type } : {}),
  ...(opts.truncate ? { truncate: true } : {}),
  ...(opts.noExplode ? { noExplode: true } : {}),
  ...(opts.vocab ? { vocab: opts.vocab } : {}),
});
const C = (label, terms, op = 'AND') => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label, op, terms });
const Q = (concepts, filters = {}) => ({ concepts, filters: { dateFrom: '', dateTo: '', languages: [], pubTypes: [], ...filters } });
const syn = (...t) => t.map((x) => (typeof x === 'string' ? T(x) : x));

// ── 100 strategies ─────────────────────────────────────────────────────────────
const STRATEGIES = [];
const add = (name, query, note = '') => STRATEGIES.push({ id: STRATEGIES.length + 1, name, note, query });

// —— Realistic clinical PICO (multi-synonym concepts) ——
add('SGLT2i in HFpEF (user case)', Q([
  C('Population', syn('heart failure', 'congestive heart failure', 'CHF', 'heart failure with preserved ejection fraction', 'HFpEF', 'HFrEF', 'left ventricular dysfunction')),
  C('Intervention', syn('dapagliflozin', 'empagliflozin', 'canagliflozin', 'ertugliflozin', 'sotagliflozin', 'SGLT2 inhibitor')),
  C('Comparator', syn('placebo', 'standard medical therapy', 'guideline-directed medical therapy', 'usual care')),
  C('Outcomes', syn('heart failure hospitalization', 'hospitalization', 'mortality', 'death')),
]));
add('EUS biliary drainage vs ERCP', Q([
  C('Population', syn('malignant biliary obstruction', 'biliary obstruction', 'distal biliary obstruction')),
  C('Intervention', syn('endoscopic ultrasound', 'EUS-guided biliary drainage', 'transluminal biliary drainage')),
  C('Comparator', syn('ERCP', 'endoscopic retrograde cholangiopancreatography')),
  C('Outcomes', syn('mortality', 'death', 'survival', 'technical success')),
]));
add('Metformin in type 2 diabetes', Q([
  C('Population', syn('type 2 diabetes', 'T2DM', 'non-insulin-dependent diabetes mellitus', 'diabetes mellitus type 2')),
  C('Intervention', syn('metformin', 'glucophage', 'biguanide')),
  C('Outcomes', syn('HbA1c', 'glycemic control', 'cardiovascular mortality')),
]));
add('Bariatric surgery for obesity', Q([
  C('Population', syn('obesity', 'morbid obesity', 'severe obesity')),
  C('Intervention', syn('bariatric surgery', 'sleeve gastrectomy', 'gastric bypass', 'Roux-en-Y')),
  C('Comparator', syn('medical therapy', 'lifestyle intervention')),
  C('Outcomes', syn('weight loss', 'diabetes remission')),
]));
add('Statins for primary prevention', Q([
  C('Population', syn('cardiovascular disease', 'primary prevention')),
  C('Intervention', syn('statin', 'atorvastatin', 'rosuvastatin', 'simvastatin', 'HMG-CoA reductase inhibitor')),
  C('Outcomes', syn('myocardial infarction', 'stroke', 'all-cause mortality')),
]));
add('DOACs vs warfarin in AF', Q([
  C('Population', syn('atrial fibrillation', 'AF', 'nonvalvular atrial fibrillation')),
  C('Intervention', syn('apixaban', 'rivaroxaban', 'dabigatran', 'edoxaban', 'direct oral anticoagulant')),
  C('Comparator', syn('warfarin', 'vitamin K antagonist')),
  C('Outcomes', syn('stroke', 'major bleeding', 'systemic embolism')),
]));
add('Immunotherapy in NSCLC', Q([
  C('Population', syn('non-small cell lung cancer', 'NSCLC', 'lung carcinoma')),
  C('Intervention', syn('pembrolizumab', 'nivolumab', 'atezolizumab', 'immune checkpoint inhibitor', 'PD-1 inhibitor')),
  C('Outcomes', syn('overall survival', 'progression-free survival')),
]));
add('CBT for depression', Q([
  C('Population', syn('depression', 'major depressive disorder', 'MDD')),
  C('Intervention', syn('cognitive behavioral therapy', 'CBT', 'cognitive behavioural therapy')),
  C('Comparator', syn('waitlist', 'usual care', 'pharmacotherapy')),
  C('Outcomes', syn('depression severity', 'remission')),
]));
add('Probiotics in IBS', Q([
  C('Population', syn('irritable bowel syndrome', 'IBS')),
  C('Intervention', syn('probiotics', 'Lactobacillus', 'Bifidobacterium')),
  C('Outcomes', syn('symptom severity', 'quality of life')),
]));
add('Vitamin D and fractures', Q([
  C('Population', syn('older adults', 'postmenopausal women')),
  C('Intervention', syn('vitamin D', 'cholecalciferol', 'ergocalciferol')),
  C('Outcomes', syn('fracture', 'hip fracture', 'falls')),
]));
add('Antibiotics in acute otitis media', Q([
  C('Population', syn('acute otitis media', 'middle ear infection', 'children')),
  C('Intervention', syn('amoxicillin', 'antibiotics', 'antibacterial')),
  C('Comparator', syn('placebo', 'watchful waiting')),
  C('Outcomes', syn('pain', 'treatment failure')),
]));
add('Exercise for chronic low back pain', Q([
  C('Population', syn('chronic low back pain', 'low back pain', 'lumbago')),
  C('Intervention', syn('exercise therapy', 'physical therapy', 'pilates')),
  C('Outcomes', syn('pain intensity', 'disability')),
]));
add('PCSK9 inhibitors for LDL', Q([
  C('Population', syn('hypercholesterolemia', 'familial hypercholesterolemia')),
  C('Intervention', syn('evolocumab', 'alirocumab', 'PCSK9 inhibitor')),
  C('Outcomes', syn('LDL cholesterol', 'cardiovascular events')),
]));
add('Remdesivir for COVID-19', Q([
  C('Population', syn('COVID-19', 'SARS-CoV-2', 'coronavirus disease 2019')),
  C('Intervention', syn('remdesivir')),
  C('Comparator', syn('placebo', 'standard of care')),
  C('Outcomes', syn('mortality', 'time to recovery')),
]));
add('Mediterranean diet and CVD', Q([
  C('Population', syn('cardiovascular disease', 'coronary heart disease')),
  C('Intervention', syn('Mediterranean diet', 'dietary intervention')),
  C('Outcomes', syn('cardiovascular events', 'mortality')),
]));
add('Ketamine for resistant depression', Q([
  C('Population', syn('treatment-resistant depression', 'refractory depression')),
  C('Intervention', syn('ketamine', 'esketamine')),
  C('Outcomes', syn('depressive symptoms', 'suicidal ideation')),
]));
add('TAVR vs SAVR', Q([
  C('Population', syn('aortic stenosis', 'severe aortic stenosis')),
  C('Intervention', syn('transcatheter aortic valve replacement', 'TAVR', 'TAVI')),
  C('Comparator', syn('surgical aortic valve replacement', 'SAVR')),
  C('Outcomes', syn('mortality', 'stroke')),
]));
add('GLP-1 agonists for weight loss', Q([
  C('Population', syn('obesity', 'overweight')),
  C('Intervention', syn('semaglutide', 'liraglutide', 'tirzepatide', 'GLP-1 receptor agonist')),
  C('Outcomes', syn('body weight', 'weight loss')),
]));
add('Mindfulness for anxiety', Q([
  C('Population', syn('anxiety', 'generalized anxiety disorder', 'GAD')),
  C('Intervention', syn('mindfulness', 'mindfulness-based stress reduction', 'MBSR')),
  C('Outcomes', syn('anxiety symptoms')),
]));
add('ACE inhibitors in diabetic nephropathy', Q([
  C('Population', syn('diabetic nephropathy', 'diabetic kidney disease')),
  C('Intervention', syn('ACE inhibitor', 'enalapril', 'ramipril', 'lisinopril')),
  C('Outcomes', syn('proteinuria', 'end-stage renal disease')),
]));

// —— Field-scoped + controlled-vocabulary ——
add('MeSH explode term', Q([C('Disease', [T('diabetes', { field: 'mesh', type: 'controlled', vocab: { mesh: 'Diabetes Mellitus' } })])]));
add('MeSH no-explode term', Q([C('Disease', [T('diabetes', { field: 'mesh', type: 'controlled', noExplode: true, vocab: { mesh: 'Diabetes Mellitus' } })])]));
add('MeSH + free text mix', Q([
  C('Disease', [T('neoplasms', { field: 'mesh', type: 'controlled', vocab: { mesh: 'Neoplasms' } }), T('cancer')]),
  C('Intervention', syn('chemotherapy', 'radiotherapy')),
]));
add('Author field search', Q([C('Author', [T('Ioannidis JP', { field: 'author' })])]));
add('Journal field search', Q([C('Journal', [T('New England Journal of Medicine', { field: 'journal' })]), C('Topic', syn('hypertension'))]));
add('DOI field search', Q([C('DOI', [T('10.1056/NEJMoa2034577', { field: 'doi' })])]));
add('PMID field search', Q([C('PMID', [T('33301246', { field: 'pmid' })])]));
add('Title-only scope', Q([C('Title', [T('machine learning', { field: 'title' }), T('deep learning', { field: 'title' })])]));
add('Keyword field', Q([C('Keyword', [T('biomarker', { field: 'keyword' })])]));
add('All-fields scope', Q([C('Any', [T('crispr', { field: 'all' })])]));

// —— Truncation / wildcards ——
add('Truncation on single word', Q([C('Topic', [T('diabet', { truncate: true })])]));
add('Truncation on multiple words', Q([C('Topic', [T('cardio', { truncate: true }), T('nephro', { truncate: true })])]));
add('Truncation on a phrase (warns)', Q([C('Topic', [T('heart failure', { truncate: true })])]));

// —— Filters ——
add('Date range full', Q([C('Topic', syn('sepsis'))], { dateFrom: '2015', dateTo: '2020' }));
add('Date from only', Q([C('Topic', syn('long covid'))], { dateFrom: '2021' }));
add('Date to only', Q([C('Topic', syn('thalidomide'))], { dateTo: '1965' }));
add('Full ISO dates', Q([C('Topic', syn('monkeypox'))], { dateFrom: '2022-05-01', dateTo: '2022-12-31' }));
add('Language English', Q([C('Topic', syn('tuberculosis'))], { languages: ['English'] }));
add('Language ISO code', Q([C('Topic', syn('malaria'))], { languages: ['eng'] }));
add('Language non-mappable', Q([C('Topic', syn('influenza'))], { languages: ['Klingon'] }));
add('Multiple languages', Q([C('Topic', syn('dengue'))], { languages: ['English', 'Spanish', 'French'] }));
add('PubType review', Q([C('Topic', syn('immunotherapy'))], { pubTypes: ['review'] }));
add('PubType RCT', Q([C('Topic', syn('aspirin'))], { pubTypes: ['randomized controlled trial'] }));
add('Date + lang + pubtype combo', Q([C('Topic', syn('vaccine hesitancy'))], { dateFrom: '2018', dateTo: '2023', languages: ['English'], pubTypes: ['review'] }));

// —— Structural edge cases ——
add('Single term', Q([C('Topic', syn('aspirin'))]));
add('Single concept, 15 synonyms', Q([C('Cancer', syn('cancer', 'carcinoma', 'neoplasm', 'tumor', 'tumour', 'malignancy', 'oncology', 'sarcoma', 'lymphoma', 'leukemia', 'leukaemia', 'adenocarcinoma', 'melanoma', 'glioma', 'blastoma'))]));
add('Six concepts AND', Q([
  C('A', syn('diabetes')), C('B', syn('hypertension')), C('C', syn('obesity')),
  C('D', syn('metformin')), C('E', syn('mortality')), C('F', syn('adults')),
]));
add('Inter-concept OR operator', Q([
  C('Drug', syn('aspirin', 'acetylsalicylic acid'), 'OR'),
  C('Drug2', syn('clopidogrel')),
]));
add('Two concepts both OR-joined', Q([
  C('Symptom', syn('fever', 'pyrexia'), 'OR'),
  C('Symptom2', syn('cough', 'dyspnea'), 'OR'),
]));

// —— "Dirty" user input (the real-world bugs) ——
add('Embedded AND inside a term', Q([C('Topic', [T('heart failure AND diabetes')])]), 'user typed a boolean into one term');
add('Embedded OR inside a term', Q([C('Topic', [T('stroke OR transient ischemic attack')])]));
add('Embedded NOT inside a term', Q([C('Topic', [T('diabetes NOT type 1')])]));
add('User pasted field tag', Q([C('Topic', [T('diabetes[tiab]')])]), 'user pasted a PubMed field tag literally');
add('User pasted full boolean line', Q([C('Topic', [T('(aspirin OR clopidogrel) AND stroke')])]));
add('Lowercase boolean operators', Q([C('Topic', [T('cancer and therapy')])]));

// —— Special characters in phrases ——
add('Hyphenated phrase', Q([C('Topic', [T('non-insulin-dependent diabetes mellitus')])]), 'DOAJ over-escape regression');
add('Slash in phrase', Q([C('Topic', [T('ICU/critical care')])]));
add('Parentheses in phrase', Q([C('Topic', [T('tumor (malignant)')])]));
add('Colon in phrase', Q([C('Topic', [T('ratio 2:1 randomization')])]));
add('Ampersand in phrase', Q([C('Topic', [T('obstetrics & gynecology')])]));
add('Percent sign', Q([C('Topic', [T('ejection fraction 40%')])]));
add('Plus and minus signs', Q([C('Topic', [T('CD4+ T-cells')])]));
add('Quote inside term', Q([C('Topic', [T('the "obesity paradox"')])]));
add('Pipe inside term', Q([C('Topic', [T('benefit|risk ratio')])]));
add('Comma inside term', Q([C('Topic', [T('Smith, John')], 'AND'), C('B', syn('trial'))]));
add('Brackets and braces', Q([C('Topic', [T('gene [BRCA1] {variant}')])]));
add('Asterisk literal in text', Q([C('Topic', [T('p*value significance')])]));
add('Question mark in phrase', Q([C('Topic', [T('does screening help?')])]));
add('Exclamation and caret', Q([C('Topic', [T('p<0.05 ^2 effect!')])]));
add('Backslash in term', Q([C('Topic', [T('dose mg\\day')])]));
add('Tilde in term', Q([C('Topic', [T('approximately ~50 mg')])]));
add('Greater/less than', Q([C('Topic', [T('age > 65 years')])]));
add('Equals sign', Q([C('Topic', [T('BMI = 30')])]));

// —— Unicode / internationalization ——
add('Accented characters', Q([C('Topic', [T("Sjögren's syndrome"), T('café-au-lait macules')])]));
add('German umlauts', Q([C('Topic', [T('Münchausen syndrome')])]));
add('Chinese term', Q([C('Topic', [T('糖尿病')])]), 'CJK');
add('Greek letters', Q([C('Topic', [T('β-blocker'), T('α-synuclein')])]));
add('Emoji in term', Q([C('Topic', [T('heart 💔 failure')])]));
add('Mixed scripts', Q([C('Topic', [T('COVID-19 病毒')])]));

// —— Degenerate / boundary ——
add('Whitespace-only term (dropped)', Q([C('Topic', [T('   '), T('asthma')])]));
add('Empty concept dropped', Q([C('Empty', []), C('Topic', syn('eczema'))]));
add('Very long term', Q([C('Topic', [T('chronic obstructive pulmonary disease exacerbation requiring hospitalization and noninvasive ventilation in elderly patients with multiple comorbidities including diabetes and chronic kidney disease and heart failure'.repeat(2))])]));
add('Numeric-only term', Q([C('Topic', [T('2019')])]));
add('Stopword-only term', Q([C('Topic', [T('the')])]));
add('Single character term', Q([C('Topic', [T('a')]), C('B', syn('vitamin'))]));
add('All terms special chars', Q([C('Topic', [T('!@#$%'), T('asthma')])]));
add('Duplicate terms in concept', Q([C('Topic', syn('asthma', 'asthma', 'asthma'))]));
add('Concept with mixed fields', Q([C('Mixed', [T('cancer', { field: 'title' }), T('Smith', { field: 'author' }), T('Nature', { field: 'journal' })])]));

// —— Date / filter edge cases ——
add('Invalid date string', Q([C('Topic', syn('gout'))], { dateFrom: 'soon', dateTo: 'later' }));
add('Reversed date range', Q([C('Topic', syn('psoriasis'))], { dateFrom: '2020', dateTo: '2010' }));
add('Future date', Q([C('Topic', syn('gene therapy'))], { dateFrom: '2030' }));
add('Two-digit year', Q([C('Topic', syn('HIV'))], { dateFrom: '99' }));

// —— Auto-generated domain combos to round out to 100 ——
const DOMAINS = [
  ['Parkinson disease', 'levodopa', 'motor symptoms'],
  ['rheumatoid arthritis', 'methotrexate', 'disease activity'],
  ['migraine', 'erenumab', 'headache days'],
  ['asthma', 'inhaled corticosteroid', 'exacerbations'],
  ['osteoporosis', 'denosumab', 'bone density'],
  ['epilepsy', 'levetiracetam', 'seizure frequency'],
  ['psoriasis', 'biologic therapy', 'PASI'],
  ['glaucoma', 'latanoprost', 'intraocular pressure'],
  ['stroke', 'thrombectomy', 'functional outcome'],
  ['sepsis', 'early goal-directed therapy', 'mortality'],
  ['chronic kidney disease', 'finerenone', 'eGFR decline'],
  ['ulcerative colitis', 'vedolizumab', 'clinical remission'],
];
for (const [pop, intv, out] of DOMAINS) {
  add(`Auto: ${pop}`, Q([C('Population', syn(pop)), C('Intervention', syn(intv)), C('Outcome', syn(out))]));
}

// —— A couple of pathological ones to finish ——
add('Override-style giant OR', Q([C('Topic', syn(...Array.from({ length: 30 }, (_, i) => `term${i}`)))]));
add('Many concepts single term each', Q(Array.from({ length: 8 }, (_, i) => C(`C${i}`, syn(['fever', 'cough', 'fatigue', 'anosmia', 'dyspnea', 'myalgia', 'headache', 'diarrhea'][i])))));

// ── runner ─────────────────────────────────────────────────────────────────────
function withTimeout(promise, ms, onTimeout) {
  let timer = null;
  const t = new Promise((resolve) => { timer = setTimeout(() => resolve(onTimeout()), ms); });
  return Promise.race([promise.finally(() => clearTimeout(timer)), t]);
}

function analyzeQueryString(provider, q) {
  const issues = [];
  const s = typeof q === 'string' ? q : '';
  if (provider !== 'crossref') { // crossref query is JSON params by design
    if (/\bundefined\b|\bnull\b/.test(s)) issues.push('contains literal undefined/null');
    if (/\bAND\s+AND\b|\bOR\s+OR\b|\(\s*\)/.test(s)) issues.push('empty group or doubled operator');
    const opens = (s.match(/\(/g) || []).length; const closes = (s.match(/\)/g) || []).length;
    if (opens !== closes) issues.push(`unbalanced parentheses (${opens} vs ${closes})`);
    if (/\b(AND|OR)\s*$|^\s*(AND|OR)\b/.test(s)) issues.push('dangling boolean operator');
  }
  return issues;
}

async function run() {
  const engine = createEngineContext(process.env, {}, {});
  const providerIds = Object.keys(engine.connectors);
  const list = STRATEGIES.slice(0, Math.min(STRATEGIES.length, LIMIT));
  console.log(`Pecan harness: ${list.length} strategies x ${providerIds.length} providers (live=${LIVE})`);
  console.log(`Providers: ${providerIds.join(', ')}\n`);

  const results = [];
  for (const strat of list) {
    const row = { id: strat.id, name: strat.name, note: strat.note, providers: {} };
    // translate offline for every provider
    for (const pid of providerIds) {
      const conn = engine.connectors[pid];
      const cell = { provider: pid };
      try {
        const tr = conn.translateQuery(strat.query, {});
        cell.query = tr.query;
        cell.warnings = (tr.warnings || []).map((w) => (typeof w === 'string' ? w : w.message || JSON.stringify(w)));
        cell.unsupported = (tr.unsupported || []).length;
        cell.emptyQuery = !tr.query || (typeof tr.query === 'string' && tr.query.trim() === '');
        cell.anomalies = analyzeQueryString(pid, tr.query);
      } catch (e) {
        cell.translateError = e && (e.code || e.message) ? `${e.code || ''} ${e.message || ''}`.trim() : 'translate threw';
      }
      row.providers[pid] = cell;
    }
    // live previewCount
    if (LIVE) {
      await Promise.all(providerIds.map(async (pid) => {
        const cell = row.providers[pid];
        if (cell.translateError || cell.emptyQuery) return; // nothing to query
        const conn = engine.connectors[pid];
        const tr = conn.translateQuery(strat.query, {});
        const ac = new AbortController();
        const t0 = Date.now();
        try {
          const pc = await withTimeout(
            conn.previewCount(tr, { signal: ac.signal, timeoutMs: PER_CALL_TIMEOUT_MS, retryLimit: PER_CALL_RETRY }),
            PER_CALL_TIMEOUT_MS + 2000,
            () => { try { ac.abort(); } catch { /* ignore */ } return { count: null, kind: 'harness-timeout' }; },
          );
          cell.count = pc.count;
          cell.kind = pc.kind;
          cell.ms = Date.now() - t0;
        } catch (e) {
          cell.count = null;
          cell.kind = 'error';
          cell.previewError = e && (e.code || e.message) ? `${e.code || ''} ${e.message || ''}`.trim() : 'preview threw';
          cell.ms = Date.now() - t0;
        }
      }));
    }
    // per-strategy cross-provider signal: a provider returning 0 while >=2 others > 0
    const counts = providerIds.map((pid) => row.providers[pid].count).filter((c) => typeof c === 'number');
    const positive = counts.filter((c) => c > 0).length;
    for (const pid of providerIds) {
      const cell = row.providers[pid];
      if (cell.count === 0 && positive >= 3) cell.suspiciousZero = true;
    }
    results.push(row);
    const summary = providerIds.map((pid) => {
      const c = row.providers[pid];
      const v = c.translateError ? 'TXERR' : c.emptyQuery ? 'EMPTY' : c.kind === undefined ? '·' : c.count != null ? String(c.count) : (c.kind || '?');
      return `${pid.slice(0, 4)}=${v}${c.suspiciousZero ? '!' : ''}`;
    }).join(' ');
    console.log(`[${String(strat.id).padStart(3)}] ${strat.name.slice(0, 38).padEnd(38)} ${summary}`);
  }

  // ── triage ──
  const findings = { emptyTranslations: [], translateErrors: [], anomalies: [], suspiciousZeros: [], previewErrors: [], timeouts: [], silentWeakening: [] };
  for (const row of results) {
    for (const pid of Object.keys(row.providers)) {
      const c = row.providers[pid];
      const ref = `#${row.id} ${row.name} / ${pid}`;
      if (c.emptyQuery) findings.emptyTranslations.push(ref);
      if (c.translateError) findings.translateErrors.push(`${ref}: ${c.translateError}`);
      if (c.anomalies && c.anomalies.length) findings.anomalies.push(`${ref}: ${c.anomalies.join('; ')} :: ${c.query}`);
      if (c.suspiciousZero) findings.suspiciousZeros.push(`${ref}: 0 results (siblings positive) :: ${typeof c.query === 'string' ? c.query.slice(0, 160) : ''}`);
      if (c.previewError) findings.previewErrors.push(`${ref}: ${c.previewError}`);
      if (c.kind === 'harness-timeout' || c.kind === 'timeout') findings.timeouts.push(ref);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = `scripts/pecan-harness-report.json`;
  writeFileSync(jsonPath, JSON.stringify({ generatedAt: stamp, live: LIVE, providerIds, strategies: results, findings }, null, 2));

  const md = [];
  md.push(`# Pecan Search Engine — 100-strategy diagnostic\n`);
  md.push(`- Strategies: ${results.length} · Providers: ${providerIds.join(', ')} · Live: ${LIVE}\n`);
  md.push(`## Triage summary\n`);
  md.push(`| Finding | Count |\n|---|---|`);
  md.push(`| Empty translations | ${findings.emptyTranslations.length} |`);
  md.push(`| Translate errors | ${findings.translateErrors.length} |`);
  md.push(`| Query anomalies | ${findings.anomalies.length} |`);
  md.push(`| Suspicious zeros (0 vs siblings) | ${findings.suspiciousZeros.length} |`);
  md.push(`| Preview errors | ${findings.previewErrors.length} |`);
  md.push(`| Timeouts | ${findings.timeouts.length} |\n`);
  for (const [k, arr] of Object.entries(findings)) {
    if (!arr.length) continue;
    md.push(`\n### ${k} (${arr.length})\n`);
    for (const line of arr.slice(0, 80)) md.push(`- ${line}`);
  }
  writeFileSync('scripts/pecan-harness-report.md', md.join('\n'));

  console.log(`\n── TRIAGE ──`);
  console.log(`empty translations : ${findings.emptyTranslations.length}`);
  console.log(`translate errors   : ${findings.translateErrors.length}`);
  console.log(`query anomalies    : ${findings.anomalies.length}`);
  console.log(`suspicious zeros   : ${findings.suspiciousZeros.length}`);
  console.log(`preview errors     : ${findings.previewErrors.length}`);
  console.log(`timeouts           : ${findings.timeouts.length}`);
  console.log(`\nWrote ${jsonPath} + scripts/pecan-harness-report.md`);
}

run().catch((e) => { console.error('HARNESS FAILED:', e); process.exit(1); });
