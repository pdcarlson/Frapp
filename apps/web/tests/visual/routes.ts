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
  "/discord-import",
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

/**
 * The pre-auth routes, which need their own suite rather than a place in the
 * list above.
 *
 * `responsive-floor.spec.ts` asserts each route did **not** end up on
 * `/sign-in` — the guard that stops a regressed `SUPABASE_AUTH_BYPASS` from
 * turning all fifteen tests into green measurements of the sign-in card. For a
 * pre-auth route that assertion is backwards, so these carry their own
 * expected URL each.
 *
 * They are also the routes the sessionless harness renders **correctly**,
 * which is the opposite of its usual limitation: roughly ten of the fifteen
 * above render a 160–256px empty-state card because there is no active
 * chapter, while these four are exactly what a signed-out visitor sees.
 *
 * **`/join` is deliberately absent and is not covered.** It is in `proxy.ts`'s
 * protected prefixes, and the page itself calls `getSessionUser()` and
 * redirects to `/sign-in?redirectTo=/join` when there is no session — so a
 * sessionless harness can only ever measure the redirect target. Covering it
 * needs a seeded session, which `README.md` in this directory already scopes
 * as its own piece of work. Its 375px measurement is by hand for now.
 */
export const PRE_AUTH_ROUTES = [
  { route: "/", expectUrl: /\/$/ },
  { route: "/sign-in", expectUrl: /\/sign-in$/ },
  { route: "/sign-up", expectUrl: /\/sign-up$/ },
  { route: "/no-access", expectUrl: /\/no-access$/ },
] as const;
