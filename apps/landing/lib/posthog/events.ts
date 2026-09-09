export const LANDING_CTA_EVENT = "landing-cta-clicked";

export const LANDING_CTAS = [
  "get-started",
  "log-in",
  "start-free-trial",
  "explore-the-product",
] as const;

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

export const SENTRY_CORRELATION_MARKER_ALLOWLIST = new Set([
  "sentry_event_id",
  "trace_id",
  "request_id",
  "route",
  "status_class",
  "release",
]);
