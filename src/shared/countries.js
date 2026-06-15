/**
 * countries.js — canonical, dependency-free ISO-3166-1 country reference
 * (prompt22 Task 1). ONE source of truth shared by BOTH the server (the Ops
 * users-by-country aggregation + the editable-fields country picker options) and
 * the client (the Ops console country picker), mirroring the editableUserFields
 * pattern. No imports, no JSX, no Node/browser globals — safe to bundle and to
 * `import` from the Express controllers.
 *
 * WHY THIS EXISTS — the UAE-shows-as-Ukraine bug (prompt22):
 *   The Ops world map joins user data to country geometry by ISO alpha-2 code.
 *   When a country code was derived by TRUNCATING an abbreviation ("UAE".slice(0,2)
 *   → "UA"), a United-Arab-Emirates user landed on Ukraine's geometry (UA), and the
 *   stored country *name* ("United Arab Emirates") then mislabeled Ukraine in the
 *   tooltip. The fixes that use this module:
 *     1. The map's display name is now DERIVED FROM THE CODE (countryNameForCode),
 *        so the tooltip can never disagree with the geometry it colours.
 *     2. The Ops country field is a PICKER built from COUNTRY_OPTIONS, so a code
 *        can only ever be a real ISO alpha-2 — never a truncated abbreviation.
 *     3. normalizeCountryCode resolves alpha-3 / common aliases WITHOUT truncating
 *        ("UAE" → "AE", never "UA"; "ARE" → "AE"; "USA" → "US").
 */

// [alpha-2, alpha-3, English short name]. ISO-3166-1; the few common political
// names follow Natural Earth so map tooltips read naturally.
const ISO_3166 = [
  ['AD', 'AND', 'Andorra'],
  ['AE', 'ARE', 'United Arab Emirates'],
  ['AF', 'AFG', 'Afghanistan'],
  ['AG', 'ATG', 'Antigua and Barbuda'],
  ['AI', 'AIA', 'Anguilla'],
  ['AL', 'ALB', 'Albania'],
  ['AM', 'ARM', 'Armenia'],
  ['AO', 'AGO', 'Angola'],
  ['AQ', 'ATA', 'Antarctica'],
  ['AR', 'ARG', 'Argentina'],
  ['AS', 'ASM', 'American Samoa'],
  ['AT', 'AUT', 'Austria'],
  ['AU', 'AUS', 'Australia'],
  ['AW', 'ABW', 'Aruba'],
  ['AX', 'ALA', 'Åland Islands'],
  ['AZ', 'AZE', 'Azerbaijan'],
  ['BA', 'BIH', 'Bosnia and Herzegovina'],
  ['BB', 'BRB', 'Barbados'],
  ['BD', 'BGD', 'Bangladesh'],
  ['BE', 'BEL', 'Belgium'],
  ['BF', 'BFA', 'Burkina Faso'],
  ['BG', 'BGR', 'Bulgaria'],
  ['BH', 'BHR', 'Bahrain'],
  ['BI', 'BDI', 'Burundi'],
  ['BJ', 'BEN', 'Benin'],
  ['BL', 'BLM', 'Saint Barthélemy'],
  ['BM', 'BMU', 'Bermuda'],
  ['BN', 'BRN', 'Brunei'],
  ['BO', 'BOL', 'Bolivia'],
  ['BQ', 'BES', 'Bonaire, Sint Eustatius and Saba'],
  ['BR', 'BRA', 'Brazil'],
  ['BS', 'BHS', 'Bahamas'],
  ['BT', 'BTN', 'Bhutan'],
  ['BV', 'BVT', 'Bouvet Island'],
  ['BW', 'BWA', 'Botswana'],
  ['BY', 'BLR', 'Belarus'],
  ['BZ', 'BLZ', 'Belize'],
  ['CA', 'CAN', 'Canada'],
  ['CC', 'CCK', 'Cocos (Keeling) Islands'],
  ['CD', 'COD', 'Democratic Republic of the Congo'],
  ['CF', 'CAF', 'Central African Republic'],
  ['CG', 'COG', 'Republic of the Congo'],
  ['CH', 'CHE', 'Switzerland'],
  ['CI', 'CIV', "Côte d'Ivoire"],
  ['CK', 'COK', 'Cook Islands'],
  ['CL', 'CHL', 'Chile'],
  ['CM', 'CMR', 'Cameroon'],
  ['CN', 'CHN', 'China'],
  ['CO', 'COL', 'Colombia'],
  ['CR', 'CRI', 'Costa Rica'],
  ['CU', 'CUB', 'Cuba'],
  ['CV', 'CPV', 'Cabo Verde'],
  ['CW', 'CUW', 'Curaçao'],
  ['CX', 'CXR', 'Christmas Island'],
  ['CY', 'CYP', 'Cyprus'],
  ['CZ', 'CZE', 'Czechia'],
  ['DE', 'DEU', 'Germany'],
  ['DJ', 'DJI', 'Djibouti'],
  ['DK', 'DNK', 'Denmark'],
  ['DM', 'DMA', 'Dominica'],
  ['DO', 'DOM', 'Dominican Republic'],
  ['DZ', 'DZA', 'Algeria'],
  ['EC', 'ECU', 'Ecuador'],
  ['EE', 'EST', 'Estonia'],
  ['EG', 'EGY', 'Egypt'],
  ['EH', 'ESH', 'Western Sahara'],
  ['ER', 'ERI', 'Eritrea'],
  ['ES', 'ESP', 'Spain'],
  ['ET', 'ETH', 'Ethiopia'],
  ['FI', 'FIN', 'Finland'],
  ['FJ', 'FJI', 'Fiji'],
  ['FK', 'FLK', 'Falkland Islands'],
  ['FM', 'FSM', 'Micronesia'],
  ['FO', 'FRO', 'Faroe Islands'],
  ['FR', 'FRA', 'France'],
  ['GA', 'GAB', 'Gabon'],
  ['GB', 'GBR', 'United Kingdom'],
  ['GD', 'GRD', 'Grenada'],
  ['GE', 'GEO', 'Georgia'],
  ['GF', 'GUF', 'French Guiana'],
  ['GG', 'GGY', 'Guernsey'],
  ['GH', 'GHA', 'Ghana'],
  ['GI', 'GIB', 'Gibraltar'],
  ['GL', 'GRL', 'Greenland'],
  ['GM', 'GMB', 'Gambia'],
  ['GN', 'GIN', 'Guinea'],
  ['GP', 'GLP', 'Guadeloupe'],
  ['GQ', 'GNQ', 'Equatorial Guinea'],
  ['GR', 'GRC', 'Greece'],
  ['GS', 'SGS', 'South Georgia and the South Sandwich Islands'],
  ['GT', 'GTM', 'Guatemala'],
  ['GU', 'GUM', 'Guam'],
  ['GW', 'GNB', 'Guinea-Bissau'],
  ['GY', 'GUY', 'Guyana'],
  ['HK', 'HKG', 'Hong Kong'],
  ['HM', 'HMD', 'Heard Island and McDonald Islands'],
  ['HN', 'HND', 'Honduras'],
  ['HR', 'HRV', 'Croatia'],
  ['HT', 'HTI', 'Haiti'],
  ['HU', 'HUN', 'Hungary'],
  ['ID', 'IDN', 'Indonesia'],
  ['IE', 'IRL', 'Ireland'],
  ['IL', 'ISR', 'Israel'],
  ['IM', 'IMN', 'Isle of Man'],
  ['IN', 'IND', 'India'],
  ['IO', 'IOT', 'British Indian Ocean Territory'],
  ['IQ', 'IRQ', 'Iraq'],
  ['IR', 'IRN', 'Iran'],
  ['IS', 'ISL', 'Iceland'],
  ['IT', 'ITA', 'Italy'],
  ['JE', 'JEY', 'Jersey'],
  ['JM', 'JAM', 'Jamaica'],
  ['JO', 'JOR', 'Jordan'],
  ['JP', 'JPN', 'Japan'],
  ['KE', 'KEN', 'Kenya'],
  ['KG', 'KGZ', 'Kyrgyzstan'],
  ['KH', 'KHM', 'Cambodia'],
  ['KI', 'KIR', 'Kiribati'],
  ['KM', 'COM', 'Comoros'],
  ['KN', 'KNA', 'Saint Kitts and Nevis'],
  ['KP', 'PRK', 'North Korea'],
  ['KR', 'KOR', 'South Korea'],
  ['KW', 'KWT', 'Kuwait'],
  ['KY', 'CYM', 'Cayman Islands'],
  ['KZ', 'KAZ', 'Kazakhstan'],
  ['LA', 'LAO', 'Laos'],
  ['LB', 'LBN', 'Lebanon'],
  ['LC', 'LCA', 'Saint Lucia'],
  ['LI', 'LIE', 'Liechtenstein'],
  ['LK', 'LKA', 'Sri Lanka'],
  ['LR', 'LBR', 'Liberia'],
  ['LS', 'LSO', 'Lesotho'],
  ['LT', 'LTU', 'Lithuania'],
  ['LU', 'LUX', 'Luxembourg'],
  ['LV', 'LVA', 'Latvia'],
  ['LY', 'LBY', 'Libya'],
  ['MA', 'MAR', 'Morocco'],
  ['MC', 'MCO', 'Monaco'],
  ['MD', 'MDA', 'Moldova'],
  ['ME', 'MNE', 'Montenegro'],
  ['MF', 'MAF', 'Saint Martin'],
  ['MG', 'MDG', 'Madagascar'],
  ['MH', 'MHL', 'Marshall Islands'],
  ['MK', 'MKD', 'North Macedonia'],
  ['ML', 'MLI', 'Mali'],
  ['MM', 'MMR', 'Myanmar'],
  ['MN', 'MNG', 'Mongolia'],
  ['MO', 'MAC', 'Macao'],
  ['MP', 'MNP', 'Northern Mariana Islands'],
  ['MQ', 'MTQ', 'Martinique'],
  ['MR', 'MRT', 'Mauritania'],
  ['MS', 'MSR', 'Montserrat'],
  ['MT', 'MLT', 'Malta'],
  ['MU', 'MUS', 'Mauritius'],
  ['MV', 'MDV', 'Maldives'],
  ['MW', 'MWI', 'Malawi'],
  ['MX', 'MEX', 'Mexico'],
  ['MY', 'MYS', 'Malaysia'],
  ['MZ', 'MOZ', 'Mozambique'],
  ['NA', 'NAM', 'Namibia'],
  ['NC', 'NCL', 'New Caledonia'],
  ['NE', 'NER', 'Niger'],
  ['NF', 'NFK', 'Norfolk Island'],
  ['NG', 'NGA', 'Nigeria'],
  ['NI', 'NIC', 'Nicaragua'],
  ['NL', 'NLD', 'Netherlands'],
  ['NO', 'NOR', 'Norway'],
  ['NP', 'NPL', 'Nepal'],
  ['NR', 'NRU', 'Nauru'],
  ['NU', 'NIU', 'Niue'],
  ['NZ', 'NZL', 'New Zealand'],
  ['OM', 'OMN', 'Oman'],
  ['PA', 'PAN', 'Panama'],
  ['PE', 'PER', 'Peru'],
  ['PF', 'PYF', 'French Polynesia'],
  ['PG', 'PNG', 'Papua New Guinea'],
  ['PH', 'PHL', 'Philippines'],
  ['PK', 'PAK', 'Pakistan'],
  ['PL', 'POL', 'Poland'],
  ['PM', 'SPM', 'Saint Pierre and Miquelon'],
  ['PN', 'PCN', 'Pitcairn'],
  ['PR', 'PRI', 'Puerto Rico'],
  ['PS', 'PSE', 'Palestine'],
  ['PT', 'PRT', 'Portugal'],
  ['PW', 'PLW', 'Palau'],
  ['PY', 'PRY', 'Paraguay'],
  ['QA', 'QAT', 'Qatar'],
  ['RE', 'REU', 'Réunion'],
  ['RO', 'ROU', 'Romania'],
  ['RS', 'SRB', 'Serbia'],
  ['RU', 'RUS', 'Russia'],
  ['RW', 'RWA', 'Rwanda'],
  ['SA', 'SAU', 'Saudi Arabia'],
  ['SB', 'SLB', 'Solomon Islands'],
  ['SC', 'SYC', 'Seychelles'],
  ['SD', 'SDN', 'Sudan'],
  ['SE', 'SWE', 'Sweden'],
  ['SG', 'SGP', 'Singapore'],
  ['SH', 'SHN', 'Saint Helena'],
  ['SI', 'SVN', 'Slovenia'],
  ['SJ', 'SJM', 'Svalbard and Jan Mayen'],
  ['SK', 'SVK', 'Slovakia'],
  ['SL', 'SLE', 'Sierra Leone'],
  ['SM', 'SMR', 'San Marino'],
  ['SN', 'SEN', 'Senegal'],
  ['SO', 'SOM', 'Somalia'],
  ['SR', 'SUR', 'Suriname'],
  ['SS', 'SSD', 'South Sudan'],
  ['ST', 'STP', 'São Tomé and Príncipe'],
  ['SV', 'SLV', 'El Salvador'],
  ['SX', 'SXM', 'Sint Maarten'],
  ['SY', 'SYR', 'Syria'],
  ['SZ', 'SWZ', 'Eswatini'],
  ['TC', 'TCA', 'Turks and Caicos Islands'],
  ['TD', 'TCD', 'Chad'],
  ['TF', 'ATF', 'French Southern Territories'],
  ['TG', 'TGO', 'Togo'],
  ['TH', 'THA', 'Thailand'],
  ['TJ', 'TJK', 'Tajikistan'],
  ['TK', 'TKL', 'Tokelau'],
  ['TL', 'TLS', 'Timor-Leste'],
  ['TM', 'TKM', 'Turkmenistan'],
  ['TN', 'TUN', 'Tunisia'],
  ['TO', 'TON', 'Tonga'],
  ['TR', 'TUR', 'Turkey'],
  ['TT', 'TTO', 'Trinidad and Tobago'],
  ['TV', 'TUV', 'Tuvalu'],
  ['TW', 'TWN', 'Taiwan'],
  ['TZ', 'TZA', 'Tanzania'],
  ['UA', 'UKR', 'Ukraine'],
  ['UG', 'UGA', 'Uganda'],
  ['UM', 'UMI', 'United States Minor Outlying Islands'],
  ['US', 'USA', 'United States'],
  ['UY', 'URY', 'Uruguay'],
  ['UZ', 'UZB', 'Uzbekistan'],
  ['VA', 'VAT', 'Vatican City'],
  ['VC', 'VCT', 'Saint Vincent and the Grenadines'],
  ['VE', 'VEN', 'Venezuela'],
  ['VG', 'VGB', 'British Virgin Islands'],
  ['VI', 'VIR', 'United States Virgin Islands'],
  ['VN', 'VNM', 'Vietnam'],
  ['VU', 'VUT', 'Vanuatu'],
  ['WF', 'WLF', 'Wallis and Futuna'],
  ['WS', 'WSM', 'Samoa'],
  ['YE', 'YEM', 'Yemen'],
  ['YT', 'MYT', 'Mayotte'],
  ['ZA', 'ZAF', 'South Africa'],
  ['ZM', 'ZMB', 'Zambia'],
  ['ZW', 'ZWE', 'Zimbabwe'],
];

/** alpha-2 (UPPER) → English country name. */
export const ISO_A2_TO_NAME = Object.freeze(
  Object.fromEntries(ISO_3166.map(([a2, , name]) => [a2, name])),
);

/** alpha-3 (UPPER) → alpha-2 (UPPER), for normalizing legacy/3-letter codes. */
export const ISO_A3_TO_A2 = Object.freeze(
  Object.fromEntries(ISO_3166.map(([a2, a3]) => [a3, a2])),
);

/** Picker options for the Ops country field — alphabetical by name. */
export const COUNTRY_OPTIONS = Object.freeze(
  ISO_3166
    .map(([code, , name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name)),
);

// Common NON-ISO abbreviations people actually type. The whole point is that
// these resolve to the RIGHT code instead of being truncated — "UAE" must become
// "AE", never "UA" (Ukraine). Keys are UPPER-cased.
const ALIASES = Object.freeze({
  UAE: 'AE',
  UK: 'GB',
  USA: 'US',   // also handled by the alpha-3 table; kept explicit for clarity
  ROK: 'KR',
  DRC: 'CD',
});

// name (lowercased, punctuation-insensitive) → alpha-2, for resolving a stored
// country *name* back to its code without ever truncating.
const NAME_TO_A2 = Object.freeze(
  Object.fromEntries(ISO_3166.map(([a2, , name]) => [normName(name), a2])),
);

function normName(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Canonical English name for an ISO alpha-2 code. Returns '' for a blank/unknown
 * code so callers can fall back. Case-insensitive.
 */
export function countryNameForCode(code) {
  if (!code || typeof code !== 'string') return '';
  return ISO_A2_TO_NAME[code.trim().toUpperCase()] || '';
}

/** True iff `code` is a recognised ISO-3166-1 alpha-2 code (case-insensitive). */
export function isAlpha2(code) {
  return !!code && typeof code === 'string' && !!ISO_A2_TO_NAME[code.trim().toUpperCase()];
}

/**
 * Resolve any country input to its ISO alpha-2 code WITHOUT TRUNCATING:
 *   - exact alpha-2 ("ae" → "AE")
 *   - alpha-3 ("ARE" → "AE", "UKR" → "UA", "USA" → "US")
 *   - common alias ("UAE" → "AE", "UK" → "GB")
 *   - full country name ("United Arab Emirates" → "AE")
 * Returns '' when nothing matches. NEVER returns a substring of the input — the
 * exact bug this guards against ("UAE" → "UA").
 */
export function normalizeCountryCode(input) {
  if (input == null) return '';
  const s = String(input).trim();
  if (!s) return '';
  const upper = s.toUpperCase();
  if (ISO_A2_TO_NAME[upper]) return upper;          // already alpha-2
  if (upper.length === 3 && ISO_A3_TO_A2[upper]) return ISO_A3_TO_A2[upper];
  if (ALIASES[upper]) return ALIASES[upper];
  const byName = NAME_TO_A2[normName(s)];
  return byName || '';
}
