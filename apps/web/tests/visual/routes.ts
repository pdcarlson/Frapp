/**
 * The dashboard routes both suites in this directory cover.
 *
 * One list, because there are two tests over the same set and they answer
 * different questions about it: `dashboard-routes.spec.ts` photographs each
 * route at 1440×960, and `responsive-floor.spec.ts` asserts each one holds the
 * 375px floor. Kept apart, the pair fails quietly in one direction — a
 * sixteenth route gets added to the screenshot suite, because that is the file
 * the README tells you to touch when you add a screen, and it is simply never
 * checked at 375px. That is the exact blind spot #1142 was filed about, so it
 * is worth one shared module to make it unrepresentable.
 *
 * Not derived from `nav-config.ts`: that list deliberately omits `/profile` and
 * carries hrefless `coming-soon` entries, so it answers a different question
 * again.
 */

export const DASHBOARD_ROUTES = [
  "/members",
  // `/alumni` now redirects into the Directory screen's Alumni tab (Wave 0 nav
  // restructure), so shooting it would only re-photograph `/members` under a
  // second name. It is not in this list; the Alumni tab renders the same
  // `AlumniDirectory` the retired snapshot covered. Its stale
  // `alumni-main-content-linux.png` is still on disk and is referenced by
  // nothing.
  //
  // `/roles` likewise redirects into Settings → Roles (Chunk 07b, #538); the
  // standalone snapshot is retired. That surface is covered by `/settings`.
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

export type DashboardRoute = (typeof DASHBOARD_ROUTES)[number];

/**
 * Baseline filename for a route. Mechanical rather than hand-listed — every
 * committed baseline already follows this shape, verified against the contents
 * of `dashboard-routes.spec.ts-snapshots/`.
 */
export function snapshotNameFor(route: DashboardRoute): string {
  return `${route.slice(1)}-main-content.png`;
}
