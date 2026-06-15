/**
 * countryStats.js — pure aggregation for the Ops users-by-country choropleth
 * (prompt22 Task 1). Extracted from adminController.getUserCountries so the join
 * logic is unit-testable without a DB, and so the country-NAME shown on the map is
 * DERIVED FROM THE ISO CODE (never the free-text stored name).
 *
 * THE BUG THIS FIXES: the map colours geometry by ISO alpha-2 code, but it used
 * to LABEL each country with the stored `registrationCountryName`. A record with
 * code 'UA' (Ukraine) but a stale name 'United Arab Emirates' therefore coloured
 * Ukraine's geometry AND labelled it "United Arab Emirates". By keying the display
 * name off the code, the tooltip can never disagree with the geometry it paints.
 *
 * Privacy: country-LEVEL only. No IPs, cities, or coordinates are read here.
 */
import { countryNameForCode } from '../../src/shared/countries.js';

const UNKNOWN = '__unknown__'; // sentinel key for the null/'' (no-code) bucket

function laterTimestamp(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) >= new Date(b) ? a : b;
}

/**
 * Build the country distribution from a list of users.
 * @param {Array<{registrationCountryCode?:string, registrationCountryName?:string, createdAt?:any}>} users
 * @returns {{ countries: Array, summary: { totalUsers:number, totalKnown:number, unknown:number, countriesRepresented:number } }}
 */
export function buildCountryDistribution(users) {
  const list = Array.isArray(users) ? users : [];
  const totalUsers = list.length;
  const buckets = new Map(); // key → { countryCode, countryName, userCount, latestRegistrationAt }

  for (const u of list) {
    const rawCode = (u.registrationCountryCode || '').trim().toUpperCase();
    // A code only counts as "known" when it's a real ISO alpha-2 — a 2-char
    // string that is NOT a valid country (e.g. junk) collapses to Unknown rather
    // than colouring a random country.
    const canonicalName = rawCode.length === 2 ? countryNameForCode(rawCode) : '';
    const isKnown = !!canonicalName;
    const key = isKnown ? rawCode : UNKNOWN;

    let b = buckets.get(key);
    if (!b) {
      b = {
        countryCode: isKnown ? rawCode : '',
        // KNOWN: canonical name from the code (authoritative — ignores any stale
        // stored name). UNKNOWN: the stored label ("Local") when present, else "Unknown".
        countryName: isKnown ? canonicalName : (u.registrationCountryName || 'Unknown'),
        userCount: 0,
        latestRegistrationAt: null,
      };
      buckets.set(key, b);
    }
    b.userCount += 1;
    // Keep a sensible Unknown-bucket label: "Local" beats a bare "Unknown".
    if (!isKnown && u.registrationCountryName && b.countryName === 'Unknown') {
      b.countryName = u.registrationCountryName;
    }
    if (u.createdAt) b.latestRegistrationAt = laterTimestamp(b.latestRegistrationAt, u.createdAt);
  }

  const countries = Array.from(buckets.values())
    .map(b => ({
      countryCode: b.countryCode,
      countryName: b.countryName,
      userCount: b.userCount,
      percentage: totalUsers > 0 ? Math.round((b.userCount / totalUsers) * 1000) / 10 : 0,
      latestRegistrationAt: b.latestRegistrationAt,
    }))
    .sort((a, b) => b.userCount - a.userCount || a.countryName.localeCompare(b.countryName));

  const unknownBucket = buckets.get(UNKNOWN);
  const unknown = unknownBucket ? unknownBucket.userCount : 0;
  const totalKnown = totalUsers - unknown;
  const countriesRepresented = countries.filter(c => c.countryCode).length;

  return { countries, summary: { totalUsers, totalKnown, unknown, countriesRepresented } };
}
