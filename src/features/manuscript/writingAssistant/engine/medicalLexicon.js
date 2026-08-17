/**
 * features/manuscript/writingAssistant/engine/medicalLexicon.js — 120.md §6.
 *
 * The versioned domain lexicon (§6 "Medical/scientific dictionary — maintained as a
 * versioned domain lexicon"). §6 also says, of its own list of representative terms:
 * "These examples are not an adequate dictionary by themselves. Build a scalable
 * terminology strategy." So this module is deliberately THREE things, not one list:
 *
 *   1. CURATED CORE — a few hundred terms a systematic review actually contains:
 *      databases, registries, reporting guidelines, risk-of-bias instruments,
 *      statistics, epidemiology, plus the high-frequency clinical vocabulary that
 *      general English dictionaries miss.
 *   2. SUFFIX MORPHOLOGY — the long tail. `-mab`, `-nib`, `-tinib`, `-itis`,
 *      `-ectomy`, `-aemia`… A rule that accepts `upadacitinib` also accepts every
 *      future `-tinib` without a release, which is the only way a hand-maintained
 *      list can keep up with drug approvals.
 *   3. PROJECT + USER DICTIONARIES (separate modules) — the rest of the tail.
 *
 * DELIBERATE NON-FEATURE: there is no PREFIX acceptor. `hepato-` + anything would
 * accept `hepatocelular`, and 120.md §6 names that exact misspelling as a case that
 * MUST be caught. Prefixes are the seductive wrong answer here; suffix families are
 * distinctive enough to be safe. See ACCEPTED SUFFIXES below for the residual risk.
 *
 * Pure: arrays, Sets and string tests. No I/O.
 */

/**
 * Bump when terms change. The worker reports it in its `ready` message so the host can
 * invalidate cached results across deploys (109.md-style versioned-artifact discipline).
 */
export const LEXICON_VERSION = '2026.08.1';

/* ------------------------------------------------------------ curated core ---- */

/** Bibliographic databases and platforms. */
const DATABASES = [
  'PubMed', 'MEDLINE', 'Embase', 'Scopus', 'CENTRAL', 'Cochrane', 'CINAHL', 'PsycINFO',
  'LILACS', 'SciELO', 'Ovid', 'EBSCOhost', 'ProQuest', 'Dimensions', 'Epistemonikos',
  'ClinicalTrials', 'openGrey', 'OpenGrey', 'Crossref', 'CrossRef', 'OpenAlex', 'Semantic',
  'medRxiv', 'bioRxiv', 'arXiv', 'PubMed Central', 'PMC', 'Web of Science', 'WorldCat',
  'AMED', 'BIOSIS', 'ERIC', 'HTA', 'NHS EED', 'DARE', 'TRIP', 'Google Scholar',
  'CNKI', 'Wanfang', 'KoreaMed', 'IndMED', 'AJOL', 'Sherpa', 'Zotero', 'EndNote',
  'Mendeley', 'RefWorks', 'Rayyan', 'Covidence', 'DistillerSR', 'EPPI', 'Abstrackr',
];

/** Reporting guidelines, registries, appraisal instruments and evidence-synthesis tools. */
const METHODS = [
  'PRISMA', 'PROSPERO', 'MOOSE', 'STROBE', 'CONSORT', 'SPIRIT', 'STARD', 'TRIPOD',
  'CARE', 'SQUIRE', 'AGREE', 'RECORD', 'CHEERS', 'ENTREQ', 'COREQ', 'SWiM', 'GRADE',
  'GRADEpro', 'AMSTAR', 'ROBIS', 'QUADAS', 'QUIPS', 'PROBAST', 'CLAIM', 'ARRIVE',
  'RoB', 'ROBINS', 'ROBINS-I', 'ROBINS-E', 'RoB 2', 'ROB-ME', 'Newcastle-Ottawa',
  'Newcastle–Ottawa', 'Newcastle', 'Ottawa', 'Jadad', 'Downs', 'Hoy', 'MINORS',
  'MeSH', 'Emtree', 'Boolean', 'PICO', 'PICOS', 'PICOT', 'SPIDER', 'PEO', 'PECO',
  'GRADEing', 'Cochrane Handbook', 'RevMan', 'Covidence', 'metafor', 'metan',
  'PRISMA-P', 'PRISMA-S', 'PRISMA-DTA', 'PRISMA-ScR', 'PRISMA-NMA', 'PRISMA-IPD',
  'COSMIN', 'GRRAS', 'TIDieR', 'CASP', 'JBI', 'SIGN', 'NICE', 'SUCRA', 'CINeMA',
  'certainty', 'downgrade', 'downgraded', 'upgrade', 'imprecision', 'indirectness',
  'incoherence', 'inconsistency', 'nonrandomised', 'nonrandomized', 'preregistered',
  'preregistration', 'prespecified', 'protocolised', 'protocolized', 'scoping',
  'umbrella', 'overview', 'rapid review', 'living review', 'evidence map',
];

/** Statistical vocabulary that general dictionaries only half-cover. */
const STATISTICS = [
  'heterogeneity', 'homogeneity', 'meta-analysis', 'metaanalysis', 'meta-analyses',
  'meta-regression', 'metaregression', 'meta-analytic', 'metaanalytic',
  'bivariate', 'multivariable', 'multivariate', 'univariable', 'univariate',
  'covariate', 'covariates', 'confounder', 'confounders', 'confounding',
  'collinearity', 'multicollinearity', 'heteroscedasticity', 'homoscedasticity',
  'bootstrapped', 'bootstrapping', 'jackknife', 'winsorized', 'winsorised',
  'nonparametric', 'nonparametrics', 'parametric', 'semiparametric',
  'Kaplan-Meier', 'Kaplan–Meier', 'Kaplan', 'Meier', 'Cox', 'Poisson', 'Weibull',
  'Bonferroni', 'Holm', 'Sidak', 'Šidák', 'Benjamini', 'Hochberg', 'Tukey', 'Dunnett',
  'Kruskal', 'Wallis', 'Wilcoxon', 'Mann', 'Whitney', 'McNemar', 'Fisher', 'Levene',
  'Shapiro', 'Wilk', 'Kolmogorov', 'Smirnov', 'Spearman', 'Pearson', 'Kendall',
  'Cronbach', 'Cohen', 'Fleiss', 'Youden', 'Bland', 'Altman', 'Hosmer', 'Lemeshow',
  'Bayesian', 'frequentist', 'posterior', 'prior', 'priors', 'credible', 'MCMC',
  'DerSimonian', 'Laird', 'Hartung', 'Knapp', 'Sidik', 'Jonkman', 'Paule', 'Mandel',
  'restricted maximum likelihood', 'inverse-variance', 'Mantel-Haenszel',
  'Mantel–Haenszel', 'Mantel', 'Haenszel', 'Peto', 'Egger', 'Begg', 'Mazumdar',
  'trim-and-fill', 'funnel', 'forest', 'galbraith', 'Galbraith', 'L’Abbé',
  'nomogram', 'calibration', 'discrimination', 'recalibration', 'overfitting',
  'underpowered', 'overpowered', 'noninferiority', 'non-inferiority', 'equivalence',
  'intention-to-treat', 'per-protocol', 'as-treated', 'crossover', 'washout',
  'quantile', 'quartile', 'tertile', 'quintile', 'decile', 'percentile', 'centile',
  'odds ratio', 'risk ratio', 'hazard ratio', 'rate ratio', 'prevalence ratio',
  'confidence interval', 'prediction interval', 'credible interval', 'interquartile',
  'standardised mean difference', 'standardized mean difference', 'effect size',
  'Hedges', 'Glass', 'eta-squared', 'omega-squared', 'kappa', 'weighted kappa',
  'AUROC', 'AUPRC', 'ROC', 'sensitivity', 'specificity', 'calibrated', 'concordance',
  'Harrell', 'Brier', 'lasso', 'ridge', 'elastic-net', 'spline', 'restricted cubic',
  'GEE', 'ANOVA', 'ANCOVA', 'MANOVA', 'MANCOVA', 'ARIMA', 'DAG', 'IPTW', 'IPW',
  'acyclic', 'priori', 'posteriori', 'subscore', 'subscale', 'interobserver',
  'intraobserver', 'interrater', 'intrarater', 'intraclass', 'psychometric',
  'discriminant', 'dichotomised', 'dichotomized', 'categorised', 'categorized',
  'operationalised', 'operationalized', 'pharmacokinetic', 'pharmacokinetics',
  'pharmacodynamic', 'pharmacodynamics', 'pharmacovigilance', 'bioavailability',
  'bioequivalence', 'Stata', 'SPSS', 'WinBUGS', 'JAGS', 'netmeta', 'robvis',
  'MetaXL', 'OpenMeta', 'Comprehensive Meta-Analysis',
];

/** Epidemiology and study design. */
const EPIDEMIOLOGY = [
  'incidence', 'prevalence', 'cumulative incidence', 'person-years', 'person-time',
  'seroprevalence', 'seroconversion', 'seropositivity', 'seronegative', 'seropositive',
  'case-control', 'case–control', 'cohort', 'cross-sectional', 'longitudinal',
  'prospective', 'retrospective', 'nested case-control', 'case-cohort', 'case-crossover',
  'quasi-experimental', 'interrupted time series', 'stepped-wedge', 'cluster-randomised',
  'cluster-randomized', 'pragmatic', 'explanatory', 'open-label', 'single-blind',
  'double-blind', 'triple-blind', 'unblinded', 'blinded', 'allocation concealment',
  'randomisation', 'randomization', 'randomised', 'randomized', 'stratified',
  'multicentre', 'multicenter', 'monocentric', 'single-centre', 'single-center',
  'comorbidity', 'comorbidities', 'multimorbidity', 'polypharmacy', 'iatrogenic',
  'nosocomial', 'idiopathic', 'sequelae', 'prodromal', 'asymptomatic', 'symptomatic',
  'morbidity', 'mortality', 'lethality', 'case fatality', 'attributable risk',
  'number needed to treat', 'number needed to harm', 'immortal time', 'lead-time',
  'ascertainment', 'misclassification', 'attrition', 'loss to follow-up', 'follow-up',
  'washout', 'exposure', 'unexposed', 'index date', 'washing', 'propensity',
  'DALY', 'DALYs', 'QALY', 'QALYs', 'YLL', 'YLD', 'ICER', 'willingness-to-pay',
];

/** Clinical / anatomical / pathological vocabulary missing from generic word lists. */
const CLINICAL = [
  'hepatocellular', 'hepatobiliary', 'hepatosplenomegaly', 'hepatotoxicity',
  'ileocolonic', 'ileocaecal', 'ileocecal', 'ileoanal', 'ileostomy', 'colostomy',
  'perianal', 'perianastomotic', 'anastomotic', 'anastomosis', 'anastomoses',
  'calprotectin', 'fecal calprotectin', 'faecal calprotectin', 'lactoferrin',
  'endoscopic', 'endoscopy', 'colonoscopy', 'sigmoidoscopy', 'gastroscopy',
  'histopathology', 'histopathological', 'immunohistochemistry', 'immunohistochemical',
  'cytokine', 'cytokines', 'chemokine', 'chemokines', 'interleukin', 'interleukins',
  'monocyte', 'monocytes', 'neutrophil', 'neutrophils', 'eosinophil', 'eosinophils',
  'basophil', 'lymphocyte', 'lymphocytes', 'macrophage', 'macrophages', 'phagocyte',
  'thrombocytopenia', 'thrombocytosis', 'leukopenia', 'leukocytosis', 'neutropenia',
  'lymphopenia', 'pancytopenia', 'anaemia', 'anemia', 'polycythaemia', 'polycythemia',
  'hyperglycaemia', 'hyperglycemia', 'hypoglycaemia', 'hypoglycemia', 'normoglycaemia',
  'hyperlipidaemia', 'hyperlipidemia', 'dyslipidaemia', 'dyslipidemia',
  'hypertension', 'hypotension', 'normotensive', 'prehypertension', 'antihypertensive',
  'atherosclerosis', 'atherosclerotic', 'atheroma', 'ischaemia', 'ischemia',
  'ischaemic', 'ischemic', 'infarction', 'infarct', 'reperfusion', 'revascularisation',
  'revascularization', 'thrombolysis', 'thrombectomy', 'angioplasty', 'stenting',
  'arrhythmia', 'arrhythmias', 'bradycardia', 'tachycardia', 'fibrillation', 'flutter',
  'cardiomyopathy', 'myocarditis', 'pericarditis', 'endocarditis', 'valvulopathy',
  'nephropathy', 'nephrotoxicity', 'nephrolithiasis', 'glomerulonephritis',
  'proteinuria', 'albuminuria', 'microalbuminuria', 'haematuria', 'hematuria',
  'creatinine', 'eGFR', 'azotaemia', 'azotemia', 'uraemia', 'uremia', 'dialysis',
  'haemodialysis', 'hemodialysis', 'haemodialytic', 'peritoneal dialysis',
  'bronchiectasis', 'bronchiolitis', 'bronchodilator', 'spirometry', 'spirometric',
  'pneumonitis', 'pneumothorax', 'pleural effusion', 'atelectasis', 'hypoxaemia',
  'hypoxemia', 'hypercapnia', 'ventilator-associated', 'extubation', 'intubation',
  'osteoarthritis', 'osteoporosis', 'osteopenia', 'osteonecrosis', 'arthroplasty',
  'spondyloarthritis', 'spondylitis', 'sacroiliitis', 'enthesitis', 'synovitis',
  'psoriatic', 'psoriasis', 'eczema', 'atopic dermatitis', 'urticaria', 'pruritus',
  'colitis', 'enteritis', 'gastritis', 'oesophagitis', 'esophagitis', 'duodenitis',
  'diverticulitis', 'appendicitis', 'cholecystitis', 'cholangitis', 'pancreatitis',
  'steatosis', 'steatohepatitis', 'cirrhosis', 'cirrhotic', 'fibrosis', 'fibrotic',
  'encephalopathy', 'neuropathy', 'polyneuropathy', 'radiculopathy', 'myelopathy',
  'myopathy', 'rhabdomyolysis', 'dysphagia', 'dysarthria', 'aphasia', 'ataxia',
  'dementia', 'delirium', 'parkinsonism', 'epilepsy', 'epileptic', 'seizure',
  'meningitis', 'encephalitis', 'sepsis', 'septicaemia', 'septicemia', 'bacteraemia',
  'bacteremia', 'viraemia', 'viremia', 'endotoxaemia', 'immunosuppression',
  'immunocompromised', 'immunomodulator', 'immunomodulatory', 'immunogenicity',
  'biologic', 'biologics', 'biosimilar', 'biosimilars', 'corticosteroid',
  'corticosteroids', 'glucocorticoid', 'glucocorticoids', 'aminosalicylate',
  'thiopurine', 'thiopurines', 'methotrexate', 'azathioprine', 'mercaptopurine',
  'ciclosporin', 'cyclosporine', 'tacrolimus', 'sirolimus', 'everolimus',
  'metformin', 'insulin', 'sulfonylurea', 'sulphonylurea', 'thiazolidinedione',
  'statin', 'statins', 'fibrate', 'ezetimibe', 'aspirin', 'clopidogrel', 'warfarin',
  'heparin', 'enoxaparin', 'rivaroxaban', 'apixaban', 'dabigatran', 'edoxaban',
  'paracetamol', 'acetaminophen', 'ibuprofen', 'naproxen', 'diclofenac', 'celecoxib',
  'omeprazole', 'pantoprazole', 'esomeprazole', 'lansoprazole', 'ranitidine',
  'amoxicillin', 'ciprofloxacin', 'levofloxacin', 'azithromycin', 'clarithromycin',
  'vancomycin', 'meropenem', 'piperacillin', 'tazobactam', 'ceftriaxone', 'cefepime',
  'remdesivir', 'favipiravir', 'oseltamivir', 'ritonavir', 'nirmatrelvir',
  'infliximab', 'adalimumab', 'golimumab', 'certolizumab', 'vedolizumab',
  'ustekinumab', 'risankizumab', 'guselkumab', 'secukinumab', 'ixekizumab',
  'rituximab', 'tocilizumab', 'abatacept', 'etanercept', 'anakinra', 'canakinumab',
  'tofacitinib', 'upadacitinib', 'filgotinib', 'baricitinib', 'ruxolitinib',
  'ozanimod', 'etrasimod', 'mirikizumab', 'natalizumab', 'pembrolizumab',
  'nivolumab', 'atezolizumab', 'durvalumab', 'ipilimumab', 'trastuzumab',
  'bevacizumab', 'cetuximab', 'panitumumab', 'osimertinib', 'erlotinib', 'gefitinib',
  'imatinib', 'sunitinib', 'sorafenib', 'lenvatinib', 'regorafenib', 'cabozantinib',
  'semaglutide', 'liraglutide', 'dulaglutide', 'tirzepatide', 'empagliflozin',
  'dapagliflozin', 'canagliflozin', 'sitagliptin', 'linagliptin', 'saxagliptin',
  // Added after a false-positive sweep over a full systematic-review Methods text:
  // every word below was rejected by the base dictionary in real manuscript prose.
  'ulcerative', 'mucosal', 'submucosal', 'transmural', 'glomerular', 'tubular',
  'interstitial', 'alveolar', 'myocardial', 'cortical', 'subcortical', 'luminal',
  'fistulising', 'fistulizing', 'fistula', 'fistulae', 'stricturing', 'stenotic',
  'dysplasia', 'dysplastic', 'metaplasia', 'neoplasia', 'neoplastic',
  'adenocarcinoma', 'cholangiocarcinoma', 'mellitus', 'thromboembolism',
  'thromboembolic', 'thrombotic', 'coagulopathy', 'haemostasis', 'hemostasis',
  'cytomegalovirus', 'herpesvirus', 'norovirus', 'rotavirus', 'adenovirus',
  'papillomavirus', 'varicella', 'candidiasis', 'aspergillosis', 'tuberculous',
  'antidrug', 'immunogenic', 'endoscopically', 'histologic', 'histological',
  'radiologic', 'radiological', 'enterography', 'colonography', 'elastography',
  'plasmacytosis', 'cryptitis', 'ulceration', 'granuloma', 'granulomatous',
  'budesonide', 'mesalamine', 'mesalazine', 'sulfasalazine', 'sulphasalazine',
  'prednisolone', 'prednisone', 'dexamethasone', 'hydrocortisone',
  'cyclophosphamide', 'mycophenolate', 'hydroxychloroquine', 'colchicine',
  'allopurinol', 'febuxostat', 'denosumab', 'teriparatide', 'bisphosphonate',
  'alendronate', 'zoledronic', 'levothyroxine', 'amiodarone', 'digoxin',
  'furosemide', 'frusemide', 'spironolactone', 'hydrochlorothiazide', 'amlodipine',
  'lisinopril', 'losartan', 'valsartan', 'atorvastatin', 'rosuvastatin',
  'simvastatin', 'evolocumab', 'alirocumab', 'sacubitril', 'ivabradine',
  'ticagrelor', 'prasugrel',
  // Eponyms — surnames that carry a disease, score or classification.
  'Crohn', 'Hodgkin', 'Parkinson', 'Alzheimer', 'Wegener', 'Behçet', 'Behcet',
  'Sjögren', 'Sjogren', 'Kawasaki', 'Guillain', 'Barré', 'Barre', 'Hashimoto',
  'Cushing', 'Addison', 'Marfan', 'Ehlers', 'Danlos', 'Duchenne', 'Huntington',
  'Creutzfeldt', 'Jakob', 'Charcot', 'Raynaud', 'Barrett', 'Whipple',
  'Klinefelter', 'Geboes', 'Montreal', 'Rutgeerts', 'Baron', 'Truelove', 'Witts',
];

/** Microbiology / genetics / laboratory. */
const LABORATORY = [
  'Staphylococcus', 'Streptococcus', 'Escherichia', 'Klebsiella', 'Pseudomonas',
  'Acinetobacter', 'Enterococcus', 'Clostridioides', 'Clostridium', 'Salmonella',
  'Shigella', 'Campylobacter', 'Helicobacter', 'Mycobacterium', 'Mycoplasma',
  'Chlamydia', 'Neisseria', 'Haemophilus', 'Legionella', 'Listeria', 'Bacteroides',
  'Candida', 'Aspergillus', 'Cryptococcus', 'Pneumocystis', 'Plasmodium', 'Giardia',
  'Toxoplasma', 'Entamoeba', 'Schistosoma', 'Leishmania', 'Trypanosoma',
  'coli', 'aureus', 'pneumoniae', 'aeruginosa', 'faecalis', 'faecium', 'difficile',
  'tuberculosis', 'albicans', 'fumigatus', 'jirovecii', 'falciparum', 'pylori',
  'genotype', 'genotypes', 'genotyping', 'phenotype', 'phenotypes', 'phenotypic',
  'haplotype', 'polymorphism', 'polymorphisms', 'allele', 'alleles', 'allelic',
  'heterozygous', 'homozygous', 'wildtype', 'wild-type', 'knockout', 'knockdown',
  'transcriptome', 'transcriptomic', 'proteome', 'proteomic', 'metabolome',
  'metabolomic', 'microbiome', 'microbiota', 'dysbiosis', 'metagenomic', 'amplicon',
  'sequencing', 'sequencer', 'bioinformatic', 'bioinformatics', 'immunoassay',
  'ELISA', 'PCR', 'qPCR', 'RT-PCR', 'Western blot', 'immunoblot', 'flow cytometry',
  'haemoglobin', 'hemoglobin', 'haematocrit', 'hematocrit', 'ferritin', 'transferrin',
  'albumin', 'bilirubin', 'transaminase', 'aminotransferase', 'alkaline phosphatase',
  'troponin', 'natriuretic', 'procalcitonin', 'fibrinogen', 'D-dimer', 'INR',
  'HbA1c', 'LDL', 'HDL', 'triglyceride', 'triglycerides', 'apolipoprotein',
  'biomarker', 'biomarkers', 'immunogen', 'antigen', 'antigens', 'antibody',
  'antibodies', 'autoantibody', 'autoantibodies', 'seroconversion', 'titre', 'titer',
  'alanine', 'aspartate', 'aminotransferase', 'aminotransferases', 'glutamyl',
  'urea', 'electrolyte', 'electrolytes', 'leucocyte', 'leukocyte', 'erythrocyte',
  'thrombocyte', 'reticulocyte', 'coagulation', 'prothrombin', 'fibrin',
  'glycated', 'glycaemic', 'glycemic', 'lipoprotein', 'homocysteine', 'cortisol',
  'thyrotropin', 'parathyroid', 'calcitonin', 'osteocalcin', 'procollagen',
  'telopeptide', 'interferon', 'integrin', 'selectin', 'caspase', 'peptidase',
  'dehydrogenase', 'reductase', 'synthase', 'transferase', 'calprotectin',
  'lipopolysaccharide', 'immunophenotype', 'immunophenotyping',
];

/**
 * Terms whose CASE carries meaning. Checked exactly; a case mismatch is not a spelling
 * error but feeds consistency.js ("Different capitalization of the same database").
 */
const CASE_SENSITIVE = [
  'PubMed', 'MEDLINE', 'Embase', 'CENTRAL', 'Cochrane', 'Scopus', 'CINAHL', 'PsycINFO',
  'MeSH', 'Emtree', 'PRISMA', 'PROSPERO', 'GRADE', 'AMSTAR', 'ROBIS', 'QUADAS',
  'RoB', 'ROBINS-I', 'ROBINS-E', 'CONSORT', 'STROBE', 'MOOSE', 'SPIRIT', 'STARD',
  'TRIPOD', 'RevMan', 'GRADEpro', 'medRxiv', 'bioRxiv', 'arXiv', 'openGrey',
  'HbA1c', 'eGFR', 'mRNA', 'tRNA', 'rRNA', 'siRNA', 'miRNA', 'cDNA', 'pH', 'pKa',
  'iPSC', 'CoV', 'SARS-CoV-2', 'COVID-19', 'mAb', 'IgG', 'IgA', 'IgM', 'IgE',
];

const ALL_CURATED = [
  ...DATABASES, ...METHODS, ...STATISTICS, ...EPIDEMIOLOGY, ...CLINICAL, ...LABORATORY,
];

/** Flat, de-duplicated term list — also what feeds nspell's personal dictionary. */
export const MEDICAL_TERMS = Object.freeze([...new Set([...ALL_CURATED, ...CASE_SENSITIVE])]);

/** Categorised view, for a future Ops/settings surface and for issue explanations. */
export const MEDICAL_TERM_CATEGORIES = Object.freeze({
  databases: Object.freeze([...new Set(DATABASES)]),
  methods: Object.freeze([...new Set(METHODS)]),
  statistics: Object.freeze([...new Set(STATISTICS)]),
  epidemiology: Object.freeze([...new Set(EPIDEMIOLOGY)]),
  clinical: Object.freeze([...new Set(CLINICAL)]),
  laboratory: Object.freeze([...new Set(LABORATORY)]),
});

/* -------------------------------------------------------------- lookup ------- */

const LOWER_INDEX = new Set();
const EXACT_INDEX = new Set();
const CANONICAL_CASE = new Map();

for (const term of MEDICAL_TERMS) {
  for (const part of term.split(/\s+/)) {
    if (!part) continue;
    LOWER_INDEX.add(part.toLowerCase());
    EXACT_INDEX.add(part);
    const lower = part.toLowerCase();
    // First writing of a term wins as canonical; only record forms that are not
    // plain lowercase, since those are the ones consistency.js can act on.
    if (part !== lower && !CANONICAL_CASE.has(lower)) CANONICAL_CASE.set(lower, part);
  }
  LOWER_INDEX.add(term.toLowerCase());
  EXACT_INDEX.add(term);
}
for (const term of CASE_SENSITIVE) CANONICAL_CASE.set(term.toLowerCase(), term);

/**
 * The canonical spelling/casing of a known proper term, or null. consistency.js uses
 * this to suggest `Embase` for `EMBASE` without ever calling either a misspelling.
 */
export function canonicalCase(word) {
  return CANONICAL_CASE.get(String(word || '').toLowerCase()) || null;
}

/* ---------------------------------------------------------- morphology ------- */

/**
 * ACCEPTED SUFFIXES — the scalable half of the strategy.
 *
 * Each entry is [suffix, minLength]. minLength is the guard: `-nib` is distinctive
 * enough at 6 characters (`afatinib`), while `-osis` needs more stem to be safe.
 * Morphology is consulted ONLY after the base English dictionary has already said
 * "unknown", so the false-accept surface is limited to misspellings that happen to
 * end in a medical suffix (`artritis` for `arthritis` is the honest example). That is
 * a deliberate trade: one missed typo per thousand against hundreds of false
 * positives on legitimate drug and disease names.
 */
const SUFFIXES = [
  // pathology / disease
  ['itis', 8], ['itides', 9], ['osis', 8], ['oses', 8], ['iasis', 9], ['oma', 7],
  ['omas', 8], ['omata', 9], ['pathy', 8], ['pathies', 10], ['penia', 8],
  ['cytosis', 9], ['megaly', 9], ['algia', 8], ['dynia', 8], ['plegia', 9],
  ['paresis', 10], ['aemia', 8], ['emia', 7], ['uria', 7], ['aemic', 8], ['emic', 7],
  ['trophy', 9], ['plasia', 9], ['plastic', 10], ['genesis', 10], ['sclerosis', 11],
  // procedures / imaging
  ['ectomy', 9], ['ostomy', 9], ['otomy', 8], ['plasty', 9], ['scopy', 8],
  ['graphy', 9], ['gram', 8], ['centesis', 11], ['pexy', 8], ['rrhaphy', 10],
  ['desis', 8], ['tripsy', 9],
  // cell / molecule
  ['cyte', 7], ['cytes', 8], ['blast', 8], ['ase', 6], ['ases', 7], ['gen', 8],
  ['philia', 9], ['phobia', 9], ['tropin', 9], ['relin', 8], ['kinin', 8],
  // drug stems — the reason `upadacitinib` never needs a lexicon release
  ['mab', 6], ['nib', 6], ['tinib', 7], ['ciclib', 8], ['parib', 7], ['rafenib', 9],
  ['lisib', 7], ['degib', 7], ['zomib', 7], ['tide', 8], ['glutide', 10],
  ['pril', 7], ['prilat', 9], ['sartan', 9], ['statin', 9], ['vastatin', 11],
  ['olol', 7], ['dipine', 9], ['azole', 8], ['prazole', 10], ['cillin', 9],
  ['mycin', 8], ['micin', 8], ['oxacin', 9], ['cycline', 10], ['floxacin', 11],
  ['navir', 8], ['ovir', 7], ['ciclovir', 11], ['triptan', 10], ['setron', 9],
  ['grel', 8], ['parin', 8], ['gliptin', 10], ['gliflozin', 12], ['afil', 7],
  ['coxib', 7], ['profen', 9], ['fenac', 8], ['caine', 8], ['barbital', 11],
  ['azolam', 9], ['azepam', 9], ['done', 8], ['orphan', 9], ['cept', 7],
  ['kinra', 8], ['limus', 8], ['mustine', 10], ['platin', 9], ['rubicin', 10],
  ['taxel', 8], ['citabine', 11], ['tinib', 8], ['lukast', 9], ['terol', 8],
  ['sone', 8], ['solone', 9], ['onide', 8], ['tadine', 9], ['zosin', 8],
];

/** Suffixes valid ONLY on lowercase generic names (drugs never carry capitals). */
const LOWER_ONLY = new Set(SUFFIXES.map(([s]) => s));

/**
 * Does the suffix morphology accept this word? The word must be alphabetic and
 * predominantly lowercase (generic drug and disease names are), long enough for the
 * matched family, and must leave a stem of at least three letters.
 */
export function acceptsMorphology(word) {
  const w = String(word || '');
  if (!/^[a-z]{5,30}$/.test(w)) return false;
  for (const [suffix, minLength] of SUFFIXES) {
    if (w.length < minLength) continue;
    if (!w.endsWith(suffix)) continue;
    if (!LOWER_ONLY.has(suffix)) continue;
    if (w.length - suffix.length < 3) continue;
    return true;
  }
  return false;
}

/**
 * Inflectional variants of an accepted stem: plurals, possessives and the `-s`/`-es`/
 * `-ies` families. §6 requires "Inflections and conjugations", "Possessives" and
 * "Hyphenated words" to be handled, and the curated list stores base forms only.
 */
function inflections(word) {
  const w = word;
  const out = [w];
  const lower = w.toLowerCase();
  if (lower.endsWith("'s") || lower.endsWith('’s')) out.push(w.slice(0, -2));
  if (lower.endsWith('s') && !lower.endsWith('ss')) out.push(w.slice(0, -1));
  if (lower.endsWith('es')) out.push(w.slice(0, -2));
  if (lower.endsWith('ies')) out.push(`${w.slice(0, -3)}y`);
  if (lower.endsWith('ae')) out.push(`${w.slice(0, -2)}a`);
  if (lower.endsWith('i')) out.push(`${w.slice(0, -1)}us`);
  if (lower.endsWith('a')) out.push(`${w.slice(0, -1)}um`);
  return out;
}

/**
 * The lexicon's verdict on a single word.
 *
 * @param {string} word
 * @param {{caseSensitive?: boolean}} [opts] when true, `pubmed` does NOT match `PubMed`
 * @returns {boolean}
 */
export function isMedicalTerm(word, opts = {}) {
  const w = String(word || '');
  if (!w) return false;
  for (const form of inflections(w)) {
    if (EXACT_INDEX.has(form)) return true;
    if (!opts.caseSensitive && LOWER_INDEX.has(form.toLowerCase())) return true;
  }
  if (acceptsMorphology(w.toLowerCase())) return true;
  // Hyphenated compounds: every part must be acceptable on its own.
  if (/[-‐-―−]/.test(w)) {
    const parts = w.split(/[-‐-―−]/).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => isMedicalTerm(p, opts))) return true;
  }
  return false;
}

/**
 * Cheap bounded Damerau–Levenshtein used to guarantee that a near-miss of a curated
 * term is offered as a suggestion. 120.md §6's `hepatocelular` → `hepatocellular`
 * case must not depend on the base dictionary's suggestion heuristics alone.
 */
export function editDistanceAtMost(a, b, max) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return false;
  let prev2 = null;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j += 1) prev[j] = j;
  for (let i = 1; i <= la; i += 1) {
    const cur = new Array(lb + 1);
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= lb; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return false;
    prev2 = prev;
    prev = cur;
  }
  return prev[lb] <= max;
}

/** Length-bucketed index so `nearestTerms` scans a few hundred candidates, not all. */
const BY_LENGTH = new Map();
for (const term of MEDICAL_TERMS) {
  if (/\s/.test(term)) continue;
  const bucket = BY_LENGTH.get(term.length) || [];
  bucket.push(term);
  BY_LENGTH.set(term.length, bucket);
}

/**
 * Curated terms within `maxDistance` of `word`, closest first. Used to prepend
 * domain-aware suggestions ahead of the generic dictionary's guesses.
 */
export function nearestTerms(word, { maxDistance = 2, limit = 3 } = {}) {
  const w = String(word || '').toLowerCase();
  if (w.length < 4) return [];
  const found = [];
  for (let len = w.length - maxDistance; len <= w.length + maxDistance; len += 1) {
    for (const term of BY_LENGTH.get(len) || []) {
      const lower = term.toLowerCase();
      if (lower === w) continue;
      if (lower[0] !== w[0] && Math.abs(lower.length - w.length) > 1) continue;
      for (let d = 1; d <= maxDistance; d += 1) {
        if (editDistanceAtMost(w, lower, d)) { found.push({ term, d }); break; }
      }
    }
  }
  found.sort((a, b) => a.d - b.d || a.term.length - b.term.length);
  return found.slice(0, limit).map((f) => f.term);
}

/** Everything the spell checker should learn, so `suggest()` can reach medical terms. */
export function personalDictionaryWords() {
  const words = new Set();
  for (const term of MEDICAL_TERMS) {
    for (const part of term.split(/\s+/)) {
      if (part.length >= 3 && /^[\p{L}'’-]+$/u.test(part)) words.add(part);
    }
  }
  return [...words];
}

export const __internal = { SUFFIXES, LOWER_INDEX, EXACT_INDEX };
