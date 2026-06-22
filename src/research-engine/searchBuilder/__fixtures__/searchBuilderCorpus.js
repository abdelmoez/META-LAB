/**
 * searchBuilderCorpus.js — SB5. Deterministic, template-driven generator of realistic
 * systematic-review search cases for the Search Builder intelligence benchmark.
 *
 * It is NOT 1,000 hardcoded rules: it combines curated, role-labelled slot pools
 * (conditions → Population, procedures/drugs → Intervention, etc.) across many clinical
 * domains, so each generated case's EXPECTED PICO assignment is correct by construction.
 * Index-seeded (no Math.random / Date) → reproducible across runs and resumable.
 *
 * Each case mixes (a) family terms that exercise role classification, (b) clean
 * multi-word phrases that exercise no-fragmentation / no-leakage, and (c) an injected
 * noise word that must be rejected. Pure data; no I/O.
 */

// Clean, multi-word clinical phrases (survive extraction intact). Conditions are the
// Population; procedures/drugs are Intervention/Comparator. Drawn so the engine should
// classify them correctly (families carry PICO role hints; generics stay where placed).
const DOMAINS = [
  { id: 'gi-eus', populations: ['malignant biliary obstruction', 'distal biliary obstruction', 'bile duct obstruction'],
    interventions: ['EUS-guided biliary drainage', 'EUS-guided antegrade biliary drainage', 'endoscopic ultrasound'],
    comparators: ['transluminal biliary drainage', 'percutaneous transhepatic biliary drainage', 'hepaticogastrostomy'] },
  { id: 'gi-resection', populations: ['early gastric cancer', 'colorectal cancer', 'Barrett esophagus'],
    interventions: ['endoscopic submucosal dissection', 'endoscopic mucosal resection'],
    comparators: ['surgical resection', 'standard polypectomy'] },
  { id: 'ibd', populations: ["Crohn's disease", 'ulcerative colitis', 'inflammatory bowel disease'],
    interventions: ['ustekinumab', 'vedolizumab', 'anti-TNF biologics'],
    comparators: ['placebo', 'adalimumab'] },
  { id: 'hepatology', populations: ['hepatocellular carcinoma', 'liver cirrhosis', 'non-alcoholic fatty liver disease'],
    interventions: ['transarterial chemoembolization', 'transjugular intrahepatic portosystemic shunt'],
    comparators: ['sorafenib', 'endoscopic band ligation'] },
  { id: 'cardiology', populations: ['atrial fibrillation', 'heart failure with reduced ejection fraction', 'myocardial infarction'],
    interventions: ['catheter ablation', 'sacubitril-valsartan', 'ticagrelor'],
    comparators: ['antiarrhythmic drugs', 'ACE inhibitors', 'clopidogrel'] },
  { id: 'endocrine', populations: ['type 2 diabetes', 'obesity', 'thyroid nodules'],
    interventions: ['GLP-1 receptor agonists', 'SGLT2 inhibitors', 'metformin'],
    comparators: ['placebo', 'insulin glargine'] },
  { id: 'oncology', populations: ['non-small cell lung cancer', 'metastatic breast cancer', 'colorectal cancer'],
    interventions: ['immune checkpoint inhibitors', 'targeted therapy'],
    comparators: ['chemotherapy', 'placebo'] },
  { id: 'infectious', populations: ['drug-susceptible tuberculosis', 'community-acquired pneumonia', 'COVID-19'],
    interventions: ['rifapentine regimen', 'nirmatrelvir-ritonavir'],
    comparators: ['standard regimen', 'placebo'] },
  { id: 'nephrology', populations: ['chronic kidney disease', 'acute kidney injury', 'diabetic nephropathy'],
    interventions: ['SGLT2 inhibitors', 'early renal replacement therapy'],
    comparators: ['placebo', 'standard renal replacement therapy'] },
  { id: 'pulmonology', populations: ['COPD', 'severe eosinophilic asthma', 'idiopathic pulmonary fibrosis'],
    interventions: ['LABA-LAMA combination', 'anti-IL5 biologics', 'pirfenidone'],
    comparators: ['LABA-ICS combination', 'placebo'] },
  { id: 'critical-care', populations: ['sepsis', 'acute respiratory distress syndrome', 'septic shock'],
    interventions: ['balanced crystalloids', 'prone positioning'],
    comparators: ['normal saline', 'supine positioning'] },
  { id: 'surgery', populations: ['severe obesity', 'inguinal hernia', 'acute appendicitis'],
    interventions: ['Roux-en-Y gastric bypass', 'laparoscopic repair'],
    comparators: ['sleeve gastrectomy', 'open repair'] },
  { id: 'neurology', populations: ['acute ischemic stroke', 'multiple sclerosis', 'epilepsy'],
    interventions: ['mechanical thrombectomy', 'ocrelizumab'],
    comparators: ['intravenous thrombolysis', 'placebo'] },
  { id: 'dta', populations: ['suspected pulmonary embolism', 'suspected appendicitis', 'suspected coronary disease'],
    interventions: ['D-dimer testing', 'point-of-care ultrasound'],
    comparators: ['CT pulmonary angiography', 'CT imaging'] },
  { id: 'rheumatology', populations: ['rheumatoid arthritis', 'psoriatic arthritis', 'systemic lupus erythematosus'],
    interventions: ['JAK inhibitors', 'methotrexate'],
    comparators: ['placebo', 'adalimumab'] },
];

// Outcomes (role O families + clean generic outcome phrases).
const OUTCOMES = [
  'mortality', 'all-cause mortality', 'quality of life', 'length of stay', 'hospital readmission',
  'adverse events', 'technical success', 'clinical success', 'stent dysfunction', 'reintervention',
  'major adverse cardiovascular events', 'treatment discontinuation', 'progression-free survival',
];

// Noise words injected into the Population text — must be rejected by the engine.
const NOISE = [
  'underwent', 'including', 'grouped', 'appropriately', 'possibly', 'across',
  'received', 'using', 'the', 'and', 'with', 'patients', 'subjects', 'adults',
];

// Population descriptors prepended to the condition (also exercise noise rejection).
const POP_PREFIX = ['patients with', 'adults with', 'people with', ''];

function pick(arr, i) { const n = arr.length; return arr[((i % n) + n) % n]; }

/**
 * generateCorpus(n=1000) → array of benchmark cases. Deterministic for a given n.
 * Each case:
 *   { caseId, reviewTitle, domain, pico:{P,I,C,O}, expected:{population,intervention,
 *     comparator,outcomes}, rejectNoise:[noise], notInPopulation:[intervention], generated:true }
 */
export function generateCorpus(n = 1000) {
  const cases = [];
  for (let i = 0; i < n; i++) {
    const dom = pick(DOMAINS, i);
    const pop = pick(dom.populations, i * 1 + 0);
    const intervention = pick(dom.interventions, i * 3 + 1);
    const comparator = pick(dom.comparators, i * 5 + 2);
    const outcome = pick(OUTCOMES, i * 7 + 3);
    const noise = pick(NOISE, i * 11 + 4);
    const prefix = pick(POP_PREFIX, i * 13 + 5);
    const includeOutcome = i % 3 !== 0;   // ~2/3 of cases carry outcomes
    const includeComparator = i % 5 !== 0; // ~4/5 carry a comparator
    const pico = {
      question: '',
      P: `${prefix} ${pop} ${noise}`.replace(/\s+/g, ' ').trim(),
      I: intervention,
      C: includeComparator ? comparator : '',
      O: includeOutcome ? outcome : '',
    };
    cases.push({
      caseId: `gen-${dom.id}-${i}`,
      reviewTitle: `${intervention} versus ${comparator} for ${pop}`,
      domain: dom.id,
      pico,
      expected: {
        population: [pop],
        intervention: [intervention],
        comparator: includeComparator ? [comparator] : [],
        outcomes: includeOutcome ? [outcome] : [],
      },
      rejectNoise: [noise],
      notInPopulation: [intervention],
      expectedDuplicates: [],
      expectedSynonyms: [],
      generated: true,
    });
  }
  return cases;
}

export default generateCorpus;
