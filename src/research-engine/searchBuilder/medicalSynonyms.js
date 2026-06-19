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
];

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
  'subject', 'subjects', 'individual', 'individuals', 'population', 'cases',
  'study', 'studies', 'trial', 'trials', 'effect', 'effects', 'group', 'groups',
  'men', 'women', 'children', 'use', 'using', 'undergoing', 'receiving',
]);
