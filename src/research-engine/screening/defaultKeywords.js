/**
 * defaultKeywords.js — default include/exclude keyword suggestions seeded into
 * every new META·SIFT project (prompt2 Task 8). These are SUGGESTIONS: the
 * project leader can edit/replace them per project (ScreenProject.inclusion/
 * exclusionKeywords). Some entries are deliberate typos/variants ("trail",
 * "trails") kept to catch OCR/import text errors — they are editable.
 *
 * Shared by the server (createProject seeding) and the frontend keyword panel,
 * so neither owns the list. Keep this file dependency-free (plain data).
 */

export const DEFAULT_INCLUDE_KEYWORDS = [
  'randomized', 'trail', 'compared with', 'controlled trial', 'randomly',
  'randomized controlled trial', 'randomly assigned', 'assigned to', 'randomised',
  'double blind', 'controlled study', 'placebo', 'randomly allocated', 'RCT',
  'placebo controlled', 'single blind', 'randomised controlled trial',
  'parallel group', 'control groups', 'parallel groups', 'cross over',
  'double blinded', 'CCT', 'doubleblind', 'double marked', 'doubleblinded',
  'single masked', 'controlled design',
];

export const DEFAULT_EXCLUDE_KEYWORDS = [
  'trails', 'randomized controlled trials', 'meta-analysis', 'systematic review',
  'cohort', 'this review', 'observational', 'non-randomized', 'retrospectively',
  'retrospective study', 'sensitivity and specificity', 'literature review',
  'in Vitro', 'animal', 'prevalence', 'nonrandomized', 'case control',
  'case reports', 'cross-sectional', 'regression analysis', 'retrospective cohort',
  'randomised controlled trials', 'trail', 'animals', 'non-randomised', 'rat',
  'survey', 'single arm', 'case report', 'regression analyses', 'fish', 'porcine',
  'longitudinal', 'healthy controls', 'soil', 'beagle', 'equine', 'murine',
  'rabbit', 'rodent', 'beagles', 'broiler', 'cadaver', 'piglets', 'rabbits',
  'rodents', 'broilers', 'purebred', 'cadaveric', 'transgenic', 'age-matched',
  'healthy control',
];
