/**
 * medicalSynonyms.js — prompt40 Task 3. A small, EXTENSIBLE medical
 * abbreviation / synonym dictionary used by conceptExtraction.js to turn a PICO
 * phrase into multiple meaningful search concepts (phrase ladder + synonyms +
 * abbreviation expansions). Pure data + tiny helpers, no network, deterministic.
 *
 * HOW TO EXTEND — add an entry to CONCEPT_FAMILIES:
 *   { id, label, triggers:[...lowercase phrases/abbrevs...], terms:[...display terms...] }
 *   - `triggers`  = every lowercase form that should map a PICO segment to this
 *     family (full names, common variants, abbreviations).
 *   - `terms`     = the ordered display terms emitted into the concept; the FIRST
 *     is the primary term, the rest become OR'd synonyms. Keep clinically faithful
 *     casing (e.g. "HFrEF", "T2DM").
 * Unknown phrases still work (conceptExtraction emits the phrase as-is + any
 * single-token abbreviation expansion from ABBREVIATIONS).
 */

// Concept families — each maps many input forms → one ordered set of search terms.
export const CONCEPT_FAMILIES = [
  // ── Endocrine / metabolic ───────────────────────────────────────────────
  { id: 't2dm', label: 'type 2 diabetes',
    triggers: ['type 2 diabetes mellitus', 'type 2 diabetes', 'diabetes mellitus type 2', 't2dm', 'niddm', 'non-insulin-dependent diabetes', 'diabetes mellitus', 'diabetes'],
    terms: ['type 2 diabetes mellitus', 'diabetes mellitus', 'diabetes', 'T2DM'] },
  { id: 't1dm', label: 'type 1 diabetes',
    triggers: ['type 1 diabetes mellitus', 'type 1 diabetes', 't1dm', 'iddm', 'insulin-dependent diabetes'],
    terms: ['type 1 diabetes mellitus', 'type 1 diabetes', 'T1DM'] },
  { id: 'obesity', label: 'obesity',
    triggers: ['obesity', 'obese'],
    terms: ['obesity', 'obese'] },
  // ── Cardiovascular ──────────────────────────────────────────────────────
  { id: 'hfref', label: 'heart failure (HFrEF)',
    triggers: ['heart failure with reduced ejection fraction', 'hfref', 'reduced ejection fraction', 'systolic heart failure'],
    terms: ['heart failure with reduced ejection fraction', 'HFrEF', 'heart failure'] },
  { id: 'hfpef', label: 'heart failure (HFpEF)',
    triggers: ['heart failure with preserved ejection fraction', 'hfpef', 'preserved ejection fraction', 'diastolic heart failure'],
    terms: ['heart failure with preserved ejection fraction', 'HFpEF', 'heart failure'] },
  { id: 'hf', label: 'heart failure',
    triggers: ['congestive heart failure', 'chf', 'heart failure', 'cardiac failure'],
    terms: ['heart failure', 'congestive heart failure', 'CHF'] },
  { id: 'htn', label: 'hypertension',
    triggers: ['hypertension', 'high blood pressure', 'htn', 'elevated blood pressure'],
    terms: ['hypertension', 'high blood pressure', 'HTN'] },
  { id: 'mi', label: 'myocardial infarction',
    triggers: ['myocardial infarction', 'heart attack', 'mi', 'acute coronary syndrome', 'acs'],
    terms: ['myocardial infarction', 'heart attack', 'MI'] },
  { id: 'af', label: 'atrial fibrillation',
    triggers: ['atrial fibrillation', 'afib', 'af'],
    terms: ['atrial fibrillation', 'AF', 'AFib'] },
  { id: 'stroke', label: 'stroke',
    triggers: ['stroke', 'cerebrovascular accident', 'cva', 'brain attack'],
    terms: ['stroke', 'cerebrovascular accident', 'CVA'] },
  // ── Respiratory ─────────────────────────────────────────────────────────
  { id: 'copd', label: 'COPD',
    triggers: ['chronic obstructive pulmonary disease', 'copd'],
    terms: ['chronic obstructive pulmonary disease', 'COPD'] },
  { id: 'asthma', label: 'asthma',
    triggers: ['asthma', 'bronchial asthma'],
    terms: ['asthma'] },
  // ── Renal ───────────────────────────────────────────────────────────────
  { id: 'ckd', label: 'chronic kidney disease',
    triggers: ['chronic kidney disease', 'ckd', 'chronic renal failure', 'crf', 'chronic renal disease'],
    terms: ['chronic kidney disease', 'chronic renal failure', 'CKD'] },
  { id: 'aki', label: 'acute kidney injury',
    triggers: ['acute kidney injury', 'aki', 'acute renal failure', 'arf'],
    terms: ['acute kidney injury', 'acute renal failure', 'AKI'] },
  // ── GI / hepatology ─────────────────────────────────────────────────────
  { id: 'ibd', label: 'inflammatory bowel disease',
    triggers: ['inflammatory bowel disease', 'ibd'],
    terms: ['inflammatory bowel disease', 'IBD'] },
  { id: 'crohn', label: "Crohn's disease",
    triggers: ["crohn's disease", 'crohn disease', 'crohns disease', 'crohn'],
    terms: ["Crohn's disease", 'Crohn disease'] },
  { id: 'uc', label: 'ulcerative colitis',
    triggers: ['ulcerative colitis', 'uc'],
    terms: ['ulcerative colitis', 'UC'] },
  { id: 'nafld', label: 'NAFLD',
    triggers: ['non-alcoholic fatty liver disease', 'nonalcoholic fatty liver disease', 'nafld', 'masld', 'metabolic dysfunction-associated steatotic liver disease'],
    terms: ['non-alcoholic fatty liver disease', 'NAFLD', 'MASLD'] },
  // ── GI procedures ───────────────────────────────────────────────────────
  { id: 'esd', label: 'endoscopic submucosal dissection',
    triggers: ['endoscopic submucosal dissection', 'esd'],
    terms: ['endoscopic submucosal dissection', 'ESD'] },
  { id: 'emr', label: 'endoscopic mucosal resection',
    triggers: ['endoscopic mucosal resection', 'emr'],
    terms: ['endoscopic mucosal resection', 'EMR'] },
  { id: 'ercp', label: 'ERCP',
    triggers: ['endoscopic retrograde cholangiopancreatography', 'ercp'],
    terms: ['endoscopic retrograde cholangiopancreatography', 'ERCP'] },
  { id: 'eus', label: 'endoscopic ultrasound',
    triggers: ['endoscopic ultrasound', 'endoscopic ultrasonography', 'eus'],
    terms: ['endoscopic ultrasound', 'endoscopic ultrasonography', 'EUS'] },
  { id: 'eusgbd', label: 'EUS-guided gallbladder drainage',
    triggers: ['eus-guided gallbladder drainage', 'endoscopic ultrasound-guided gallbladder drainage', 'eus-gbd', 'eusgbd', 'eus gallbladder drainage'],
    terms: ['EUS-guided gallbladder drainage', 'endoscopic ultrasound-guided gallbladder drainage', 'EUS-GBD'] },
  { id: 'ptgbd', label: 'percutaneous cholecystostomy',
    triggers: ['percutaneous cholecystostomy', 'percutaneous gallbladder drainage', 'percutaneous transhepatic gallbladder drainage', 'pt-gbd', 'ptgbd'],
    terms: ['percutaneous cholecystostomy', 'percutaneous gallbladder drainage', 'PT-GBD'] },
  // ── Oncology ────────────────────────────────────────────────────────────
  { id: 'crc', label: 'colorectal cancer',
    triggers: ['colorectal cancer', 'colorectal carcinoma', 'crc', 'colon cancer', 'bowel cancer'],
    terms: ['colorectal cancer', 'colorectal carcinoma', 'colorectal neoplasm', 'CRC'] },
  { id: 'hcc', label: 'hepatocellular carcinoma',
    triggers: ['hepatocellular carcinoma', 'hcc', 'liver cancer'],
    terms: ['hepatocellular carcinoma', 'liver cancer', 'HCC'] },
  // ── Common outcomes ─────────────────────────────────────────────────────
  { id: 'mortality', label: 'mortality',
    triggers: ['all-cause mortality', 'mortality', 'death', 'survival'],
    terms: ['mortality', 'death', 'survival'] },
  { id: 'readmission', label: 'hospital readmission',
    triggers: ['hospital readmission', 'readmission', 'rehospitalization', 'rehospitalisation'],
    terms: ['readmission', 'hospital readmission', 'rehospitalization'] },
  { id: 'los', label: 'length of stay',
    triggers: ['length of stay', 'hospital stay', 'los'],
    terms: ['length of stay', 'hospital stay'] },
  { id: 'qol', label: 'quality of life',
    triggers: ['quality of life', 'qol', 'health-related quality of life', 'hrqol'],
    terms: ['quality of life', 'health-related quality of life', 'QoL'] },
  // ── Hepatobiliary / biliary obstruction (SB4) ────────────────────────────
  { id: 'mbo', label: 'malignant biliary obstruction',
    triggers: ['malignant biliary obstruction', 'malignant bile duct obstruction', 'distal malignant biliary obstruction', 'mbo'],
    terms: ['malignant biliary obstruction', 'malignant bile duct obstruction', 'biliary obstruction'] },
  { id: 'biliaryobstruction', label: 'biliary obstruction',
    triggers: ['biliary obstruction', 'bile duct obstruction', 'obstructive jaundice', 'biliary stricture'],
    terms: ['biliary obstruction', 'bile duct obstruction', 'obstructive jaundice'] },
  { id: 'eusbd', label: 'EUS-guided biliary drainage',
    triggers: ['eus-guided biliary drainage', 'endoscopic ultrasound-guided biliary drainage', 'eus-bd', 'eusbd', 'eus guided biliary drainage'],
    terms: ['EUS-guided biliary drainage', 'endoscopic ultrasound-guided biliary drainage', 'EUS-BD'] },
  { id: 'eusantegrade', label: 'EUS-guided antegrade/transpapillary drainage',
    triggers: ['eus-guided antegrade biliary drainage', 'eus-guided transpapillary biliary drainage', 'transpapillary biliary drainage', 'antegrade biliary drainage', 'eus antegrade', 'eus transpapillary'],
    terms: ['EUS-guided antegrade biliary drainage', 'EUS-guided transpapillary biliary drainage', 'transpapillary biliary drainage'] },
  { id: 'eustransluminal', label: 'transluminal biliary drainage',
    triggers: ['eus-guided transluminal biliary drainage', 'transluminal biliary drainage', 'eus transluminal', 'hepaticogastrostomy', 'choledochoduodenostomy'],
    terms: ['transluminal biliary drainage', 'EUS-guided transluminal biliary drainage', 'hepaticogastrostomy'] },
  // ── Endocrine drugs (SB4) ────────────────────────────────────────────────
  { id: 'glp1', label: 'GLP-1 receptor agonists',
    triggers: ['glp-1 receptor agonists', 'glp-1 receptor agonist', 'glucagon-like peptide-1 receptor agonist', 'glucagon-like peptide 1 receptor agonist', 'glp1', 'glp-1', 'glp-1 ra', 'incretin mimetic'],
    terms: ['GLP-1 receptor agonists', 'glucagon-like peptide-1 receptor agonists', 'GLP-1 RA'] },
  // ── Procedure / trial outcomes (SB4) ─────────────────────────────────────
  { id: 'adverseevents', label: 'adverse events',
    triggers: ['adverse events', 'adverse event', 'complications', 'adverse effects'],
    terms: ['adverse events', 'complications', 'adverse effects'] },
  { id: 'techsuccess', label: 'technical success',
    triggers: ['technical success', 'technical success rate'],
    terms: ['technical success', 'technical success rate'] },
  { id: 'clinsuccess', label: 'clinical success',
    triggers: ['clinical success', 'clinical success rate'],
    terms: ['clinical success', 'clinical success rate'] },
  { id: 'stentdysfunction', label: 'stent dysfunction',
    triggers: ['stent dysfunction', 'stent occlusion', 'stent obstruction', 'stent migration'],
    terms: ['stent dysfunction', 'stent occlusion', 'stent migration'] },
  { id: 'reintervention', label: 'reintervention',
    triggers: ['reintervention', 're-intervention', 'reinterventions'],
    terms: ['reintervention', 're-intervention'] },
  { id: 'discontinuation', label: 'treatment discontinuation',
    triggers: ['treatment discontinuation', 'drug discontinuation', 'treatment withdrawal'],
    terms: ['treatment discontinuation', 'drug discontinuation'] },
  { id: 'tumor', label: 'tumour',
    triggers: ['tumor', 'tumour', 'tumors', 'tumours', 'neoplasm', 'neoplasms'],
    terms: ['tumour', 'tumor', 'neoplasm'] },
];

/* SB4 — a per-family default PICO role hint, used ONLY to break ties when the SAME
   auto-extracted term leaks into more than one PICO concept (searchState dedup keeps
   it in the role group). Families that are genuinely ambiguous (e.g. ERCP can be the
   intervention or part of the population as "failed ERCP"; transluminal drainage is
   usually the comparator) are intentionally left unmapped so their term stays where
   the PICO author put it. Pure data; deterministic. */
export const FAMILY_PICO_ROLE = {
  // Population — conditions / diseases / problem
  t2dm: 'P', t1dm: 'P', obesity: 'P', hfref: 'P', hfpef: 'P', hf: 'P', htn: 'P',
  mi: 'P', af: 'P', stroke: 'P', copd: 'P', asthma: 'P', ckd: 'P', aki: 'P',
  ibd: 'P', crohn: 'P', uc: 'P', nafld: 'P', crc: 'P', hcc: 'P',
  mbo: 'P', biliaryobstruction: 'P', tumor: 'P',
  // Intervention / Exposure — procedures / drugs
  eus: 'I', esd: 'I', emr: 'I', eusgbd: 'I', eusbd: 'I', eusantegrade: 'I', glp1: 'I',
  // Outcomes
  mortality: 'O', readmission: 'O', los: 'O', qol: 'O', adverseevents: 'O',
  techsuccess: 'O', clinsuccess: 'O', stentdysfunction: 'O', reintervention: 'O',
  discontinuation: 'O',
};

// Standalone single-token abbreviation → expansion (for unknown phrases that
// happen to contain a well-known abbreviation but no full family entry).
export const ABBREVIATIONS = {
  rct: 'randomized controlled trial', rcts: 'randomized controlled trials',
  copd: 'chronic obstructive pulmonary disease', ckd: 'chronic kidney disease',
  aki: 'acute kidney injury', mi: 'myocardial infarction',
  htn: 'hypertension', af: 'atrial fibrillation', cad: 'coronary artery disease',
  pci: 'percutaneous coronary intervention', cabg: 'coronary artery bypass grafting',
  copds: 'chronic obstructive pulmonary disease', ibs: 'irritable bowel syndrome',
  gerd: 'gastroesophageal reflux disease', uti: 'urinary tract infection',
  dvt: 'deep vein thrombosis', pe: 'pulmonary embolism', vte: 'venous thromboembolism',
  bmi: 'body mass index', egfr: 'estimated glomerular filtration rate',
};

// Connector words that separate distinct concepts in a PICO phrase. Splitting on
// these turns "type 2 diabetes mellitus with HFrEF" into two concept segments.
export const CONNECTORS = [
  'compared with', 'compared to', 'in comparison with', 'as compared with',
  'versus', 'vs.', 'vs', 'undergoing', 'receiving', 'treated with', 'treated for',
  'with', 'without', 'and', 'plus', 'or', 'among', 'in',
];

// Words that carry no search signal on their own — stripped from segments and,
// if a segment reduces to only these, the segment is dropped. (Beyond STOPWORDS.)
export const JUNK_WORDS = new Set([
  'patient', 'patients', 'adult', 'adults', 'people', 'person', 'persons',
  'subject', 'subjects', 'individual', 'individuals', 'participant', 'participants',
  'population', 'cohort', 'cases', 'case',
  'study', 'studies', 'trial', 'trials', 'effect', 'effects', 'group', 'groups',
  'men', 'women', 'children', 'use', 'using', 'undergoing', 'receiving',
  // SB5 (issue #3) — vague verbs / adverbs / qualifiers so conceptExtraction never
  // emits them as standalone concept terms (they are leading/trailing junk, or a
  // whole segment collapses to junk and is dropped). Multi-word clinical phrases are
  // matched by CONCEPT_FAMILIES first, so real phrases are unaffected.
  'underwent', 'undergo', 'undergoes', 'received', 'receive', 'receives',
  'including', 'included', 'include', 'includes', 'grouped', 'grouping',
  'across', 'possibly', 'appropriately', 'approximately', 'respectively',
  'generally', 'typically', 'usually', 'mainly', 'mostly', 'particularly',
  'specifically', 'overall', 'assessed', 'evaluated', 'measured', 'reported',
  'defined', 'considered', 'observed', 'investigated', 'examined', 'performed',
  'conducted', 'analysed', 'analyzed', 'given', 'followed', 'following', 'treated',
  // SB5 (issue #2) — weak clinical qualifiers, so a Population collapses to its clean
  // disease concept ("early gastric cancer" → "gastric cancer", "suspected pulmonary
  // embolism" → "pulmonary embolism"). Disease names that genuinely contain these are
  // matched as CONCEPT_FAMILIES phrases first, so they are not harmed.
  'failed', 'unsuccessful', 'suspected', 'confirmed', 'early', 'late',
  'severe', 'moderate', 'mild', 'resistant', 'critically', 'ill',
]);
