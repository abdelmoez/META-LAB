/**
 * waitlistTheme.js — the Beta Waitlist marketing accent palette.
 *
 * The public waitlist page is rendered NATIVE to the Stitch design system, so it
 * uses the shared `S` tokens for all neutrals (surfaces, text, outlines) — which
 * already match the "Vivid Enterprise" reference (Design/waitlist). BUT the
 * reference mock uses a distinct vivid INDIGO as its primary accent (not the app's
 * deep-purple brand). This small palette captures that indigo so the hero, the
 * primary CTAs, the stepper and the queue card match the example exactly, WITHOUT
 * touching the global Stitch brand token (which the rest of the app depends on).
 *
 * Values are taken verbatim from Design/waitlist/code.html's Tailwind config:
 *   primary #493ee5 · primary-container (hover) #635bff · on-primary #fff.
 * Soft/orb/ring values are translucent so they read correctly in BOTH day & night.
 */
export const WL = {
  primary:      '#493ee5', // mock "primary"
  primaryHover: '#635bff', // mock "primary-container" (hover/active fill)
  onPrimary:    '#ffffff',
  soft:         'rgba(73, 62, 229, 0.10)',  // tinted bg for the badge / icon tiles
  softBorder:   'rgba(73, 62, 229, 0.22)',
  squiggle:     '#5fce5b', // soft green underline (mock "secondary-container")
  orbA:         'rgba(99, 91, 255, 0.20)',  // indigo ambient orb
  orbB:         'rgba(150, 245, 145, 0.16)', // green ambient orb
  ring:         'rgba(73, 62, 229, 0.38)',  // focus ring
};
