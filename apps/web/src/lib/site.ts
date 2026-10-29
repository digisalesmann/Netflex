/**
 * Site settings. Property-specific facts come from the API (name, support
 * contacts, plans). Anything that must be confirmed by the owner (coverage,
 * legal review) is configured here — never invented in page copy.
 */
export const site = {
  brand: 'NetFlex',
  propertySlug: process.env.NETFLEX_PROPERTY_SLUG ?? 'demo-lodge',
  siteUrl: process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000',
  /** Set to "true" only after the owner's legal adviser has reviewed the policies. */
  legalReviewed: process.env.NETFLEX_LEGAL_REVIEWED === 'true',
  /** Owner-provided coverage notes, e.g. "Strongest in rooms near the main corridor". */
  coverageNotes: process.env.NETFLEX_COVERAGE_NOTES ?? '',
  /** Policy effective date (owner sets on publication). */
  policiesUpdated: process.env.NETFLEX_POLICIES_UPDATED ?? '',
} as const;
