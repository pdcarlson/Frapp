/**
 * The dashboard routes the suites in this directory cover.
 *
 * A shared module rather than a list inlined in the one spec that reads it
 * today, because this directory has held more than one suite over the same set
 * and will again: when it did, keeping the lists apart failed quietly in one
 * direction — a sixteenth route got added to one file and was simply never
 * checked by the other. That is the blind spot #1142 was filed about. Add a
 * route here, and every suite in this directory picks it up.
 *
 * Not derived from `nav-config.ts`: that list deliberately omits `/profile` and
 * carries hrefless `coming-soon` entries, so it answers a different question
 * again.
 */

export const DASHBOARD_ROUTES = [
  "/members",
  // `/alumni` now redirects into the Directory screen's Alumni tab (Wave 0 nav
  // restructure), so covering it would only re-test `/members` under a second
  // name. It is not in this list; the Alumni tab renders the same
  // `AlumniDirectory`.
  //
  // `/roles` likewise redirects into Settings → Roles (Chunk 07b, #538). That
  // surface is covered by `/settings`.
  "/events",
  "/tasks",
  "/service",
  "/documents",
  "/backwork",
  "/geofences",
  "/study",
  "/polls",
  "/chat",
  "/points",
  "/billing",
  "/reports",
  "/profile",
  "/settings",
] as const;
