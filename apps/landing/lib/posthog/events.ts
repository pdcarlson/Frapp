export const LANDING_CTA_EVENT = "landing-cta-clicked";

/*
 * The page's CTA vocabulary, closed on purpose: `captureLandingCta` drops
 * anything outside these two sets, so an unlisted id is silently not measured
 * rather than quietly polluting the funnel.
 *
 * `log-in` keeps its id although the button now reads "Sign in" (D5, sentence
 * case). The id is the join key for every `landing-cta-clicked` row PostHog
 * already holds; renaming it to `sign-in` would split one funnel in two at the
 * reskin's merge commit and make the before/after comparison the reskin exists
 * to justify impossible to run. Label and id are allowed to disagree — the
 * label is copy, the id is a measurement.
 *
 * `start-free-trial` and `explore-the-product` are gone with the sections that
 * fired them (#2367): the single $149 card's CTA and the hero's anchor button.
 * Nothing replaces them. The trial now opens at in-app checkout rather than
 * from this page, and there is no second hero action to anchor-scroll to.
 */
export const LANDING_CTAS = [
  "get-started",
  "log-in",
  "join-chapter",
] as const;

/*
 * Unchanged by the rebuild, and the set is what matters rather than the order:
 * every surface below still renders at least one tracked control, so no id here
 * is dead. `cta-band` names the closing section, which is no longer a band —
 * the id stays for the same continuity reason `log-in` does.
 */
export const LANDING_CTA_SURFACES = [
  "header",
  "hero",
  "pricing",
  "footer",
  "cta-band",
] as const;

export type LandingCta = (typeof LANDING_CTAS)[number];
export type LandingCtaSurface = (typeof LANDING_CTA_SURFACES)[number];

export const LANDING_CTA_SET: ReadonlySet<string> = new Set(LANDING_CTAS);
export const LANDING_CTA_SURFACE_SET: ReadonlySet<string> = new Set(
  LANDING_CTA_SURFACES,
);
