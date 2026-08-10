/**
 * opsSections.js — the Ops Console sidebar registry.
 *
 * Extracted from AdminConsole.jsx in 109.md §9 (section sync) for ONE reason: the
 * server's getConsole section allow-list is the AUTHORITY for what the sidebar
 * shows, AdminConsole replaces its `allowed` set with it, and until now nothing
 * guarded the two lists against drift — a section added here but not there is
 * invisible even to an admin, and vice versa it renders AccessDenied. Living in
 * its own dependency-free module makes the registry importable by
 * tests/unit/opsSectionSync.test.js without pulling the 9k-line console (and its
 * React context tree) into a unit test.
 *
 * KEEP IN LOCKSTEP, all four places:
 *   1. this file (sidebar order + labels + icons)
 *   2. the `sections` id → element map in AdminConsole.jsx
 *   3. `getConsole` in server/controllers/adminController.js (the authority)
 *   4. OPS_SECTION_IDS + HEADINGS in e2e/page-objects/OpsPage.ts
 */

/** Sidebar sections in render order. `icon` must exist in components/icons.jsx. */
export const NAV_SECTIONS = [
  { id: 'overview',   icon: 'grid',      label: 'Overview'      },
  { id: 'users',      icon: 'users',     label: 'Users'         },
  { id: 'onboarding', icon: 'clipboard', label: 'Onboarding'    },
  { id: 'projects',   icon: 'folders',   label: 'Projects'      },
  { id: 'sift',       icon: 'hexagon',   label: 'Screening'     },
  // 109.md §4 — ONE section (with sub-tabs) for the duplicate-detection, keyword,
  // extraction/analysis, interaction and client-error control plane, rather than
  // the thirteen top-level entries the prompt enumerates.
  { id: 'research',   icon: 'flow',      label: 'Research Governance' },
  { id: 'rob',        icon: 'scale',     label: 'Risk of Bias'  },
  { id: 'searchProviders', icon: 'search', label: 'Search Providers' },
  { id: 'waitlist',   icon: 'flask',     label: 'Beta Waitlist' },
  { id: 'content',    icon: 'fileText',  label: 'Content'       },
  { id: 'settings',   icon: 'settings',  label: 'Settings'      },
  { id: 'style',      icon: 'eye',       label: 'Appearance'    },
  { id: 'flags',      icon: 'sliders',   label: 'Flags'         },
  { id: 'tiers',      icon: 'award',     label: 'Tiers'         },
  { id: 'extractionAi',   icon: 'clipboard', label: 'Extraction Assist'  },
  { id: 'livingReviews',  icon: 'activity',  label: 'Living Reviews' },
  { id: 'messages',   icon: 'mail',      label: 'Messages'      },
  { id: 'security',   icon: 'shield',    label: 'Security'      },
  { id: 'health',     icon: 'activity',  label: 'Health'        },
  { id: 'engineVersions', icon: 'layers', label: 'Engine Versions' },
];

/**
 * Role-derived section sets — a mirror of server getConsole used ONLY as the
 * bootstrap/failure fallback (never show-all).
 *
 * Mods keep user support (messages + replies) and limited user management. They
 * are deliberately NOT given `research`, even though the §39 capability seam
 * grants them `view_research_diagnostics` at the API layer: widening the mod
 * console is a product decision outside this round's scope, so a mod holds read
 * access to the duplicate-job and client-error endpoints with no UI for it. That
 * asymmetry is intentional and documented in the 109 report.
 */
export const MOD_SECTIONS = ['users', 'messages'];

export const roleSections = (r) => (r === 'admin' ? NAV_SECTIONS.map((s) => s.id) : MOD_SECTIONS);
