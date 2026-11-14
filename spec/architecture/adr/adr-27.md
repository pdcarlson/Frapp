### ADR-27: Tenant-scoped URLs; the page's URL, not the token, names the chapter a request acts in (proposed 2026-11-11)

**Status: Proposed, pending Paul.** Drafted for [#4192](https://github.com/pdcarlson/Frapp/issues/4192) at Winston's request (`whewitt-frapp`, 2026-11-11). Nothing here is built. Until Paul accepts it, [`spec/behavior/multi-tenancy.md`](../../behavior/multi-tenancy.md) describes the system and this ADR changes no spec. If it's accepted, rollout step 2 (below) rewrites every place that spec states the claim-first rule, in the same PR. Those places are its Enforcement layers, "How the claim is issued", "Changing the active chapter from a client", "The web's persisted store follows the claim", the Edge cases and "How the invariant is tested".

**Decision (proposed):**

1. **Every page inside a tenant carries the tenant in its path.**
   - Chapters and councils live at `/c/<slug>/…`, for example `/c/fiji-rpi/chat` or `/c/rpi-ifc/recruitment`. A council is a tenant of kind `council` in the same `chapters` table (the concept on #4192, option C), so it shares the `/c/` namespace.
   - Campus pages live at `/s/<school-slug>/…`, for example `/s/rpi`.
   - Pages that belong to the person, not a tenant, stay outside both:
     - `/`, which sends you to the right place;
     - `/me/…`, for profile and preferences across tenants (today's `/profile` and `/preferences`);
     - `/whats-new`;
     - `/join`, `/start` (a new chapter or council), `/no-access`, `/new-account`, sign-in and sign-up.
   - Public pages need no account: `/f/<form-slug>` is a chapter's interest form and the target of its QR code.
     - The route has no session and no `ChapterGuard`. The page reads only the form's public fields: the chapter's name and crest, and the questions.
     - Submitting needs a one-time code sent to an address on the school's domain. The API writes the submission into the chapter's pipeline on the server side, and the submitter is recorded as a PNM for the school. They become a school member (status `pnm`) when they create an account. A `school_members` row needs an account; the data-model design (`spec/architecture/school-layer.md`, #4222) owns that rule.
     - Requests are rate-limited per IP and per address. A form lives under `/f/`, not `/c/`, so a printed code survives a chapter rename and a form can be replaced without renaming anything.
2. **The URL supplies each request's chapter context.** The client resolves the slug in its path to a chapter id, using the person's own membership list, and sends it as `x-chapter-id` on every request from that page. The value is per tab: it is read from the tab's URL, never from storage that tabs share.
3. **`ChapterGuard` treats an explicit header as authoritative and the JWT claim as a default, and it checks the tenant's kind.**
   - **Header present:** the guard validates membership in that chapter, as it does today, and serves it. The claim is ignored for that request.
   - **Header absent:** the claim decides, then the sole membership, as today.
   - **The mismatch branch goes.** The guard stops refusing a header that differs from the claim, because two tabs in two tenants now share one token. `chapter.context.mismatch` itself stays: `ChapterConfigController.assertMatchesActiveChapter` (`apps/api/src/interface/controllers/chapter-config.controller.ts`) still throws it when a `:id` path segment disagrees with the resolved chapter, so its client handlers and its `packages/observability` entry stay too.
   - **New: tenant kind.** Kind comes from `chapters.kind` (`chapter` or `council`), never from `org_archetype`, where `ifc` already means an IFC-member fraternity. A route declares the kinds it serves, with route metadata such as `@TenantKinds('council')`. The default is `chapter` alone, so every existing route refuses a council tenant without being edited. A tenant of the wrong kind is refused with the same `403 chapter.context.invalid` a non-member gets, so the response doesn't reveal what the id is.
   - **Unchanged:** `chapter.context.invalid` for a non-member, `chapter.context.required` for a multi-chapter member who sent nothing, and the 503 on a failed lookup.
   - **The other claim-first reader flips with it.** `getOptionalChapterId` (`apps/api/src/interface/types/request-context.types.ts`, behind `GET /v1/analytics/identity`) changes to header first, so each tab's analytics group is its own tenant's.
   - **Campus pages aren't chapter tenants.** `/s/<school>` requests carry `x-school-id` to a separate `SchoolGuard`, which checks for a `school_members` row. Campus endpoints read only what chapters push up through the affiliation tables, never chapter tables live, which follows [#4068](https://github.com/pdcarlson/Frapp/issues/4068) decision 11. The schema is the data-model design's, on #4192.
4. **`users.active_chapter_id` means "the tenant you last chose", and only an explicit choice writes it.**
   - The switcher, a join and a create write it, exactly as today. Opening a tenant by URL, or having it open in a tab, doesn't.
   - This is load-bearing for mobile. Shipped builds read the claim on every token refresh, send it as `x-chapter-id`, and clear their cache when it changes (`apps/mobile/lib/frapp-client.tsx`, `lib/auth-session.tsx`). If merely opening a web tab moved the claim, the member's phone would switch chapters mid-use at its next refresh.
   - It decides where `/` sends you, the context for a client that sends no header, and where a push notification that names no tenant opens.
   - **Where `/` sends you,** in order: the tenant you last chose while you're still in it; else your only tenant; else the picker if you have several; else, with no chapter or council, your school's campus home `/s/<school>` (a PNM, or a member who left their chapter); else Get started (join, start, or request your school).
5. **Slugs.**
   - **Format:** 3 to 40 characters of lowercase `a–z`, `0–9` and single hyphens, with no hyphen at either end: `^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,39}$`. It's ASCII only, so there are no lookalike Unicode letters. School slugs use the same format.
   - **One registry per namespace:** `tenant_slugs(slug primary key, chapter_id, retired_at)` for chapters and councils, with a partial unique index on `chapter_id` where `retired_at is null` (one current slug each). The current slug is the row with no `retired_at`.
   - **Retired slugs can't be reused, and the database enforces it.** The primary key spans current and retired slugs, so another tenant can never take one, even in a race, and an old link, QR code or invite can never land in a different chapter. A tenant may take back its own retired slug, which clears that row's `retired_at` and so can't create a redirect loop.
   - **Schools** have the same shape in `school_slugs`. Only Frapp staff rename a school.
   - **Default:** the organization's short name plus the school's, for example `fiji-rpi` or `rpi-ifc`. Without a school, the organization plus its chapter designation (`phigam-alpha-chi`). On a collision a number is added (`fiji-rpi-2`), and the founder sees the result and can edit it.
   - **Renaming:** an officer who holds the chapter-settings permission can rename, at most once every 30 days, so a chapter can't churn through names. A slug assigned by the migration can be renamed once without the wait.
   - **Reserved:**
     - platform words: `new`, `join`, `start`, `me`, `settings`, `admin`, `api`, `app`, `www`, `help`, `support`, `status`, `frapp`, `signet`, `staff`, `official`;
     - council words on their own: `ifc`, `panhellenic`, `phc`, `nphc`, `mgc`, `council`, `school`;
     - every first-level route name.

     A chapter can be `rpi-ifc`, but not `ifc`. The list lives in `@repo/validation` beside the slug schema, so the API and both clients check against one copy.
6. **Old links redirect, and the redirect never picks a tenant for you silently.**
   - A flat dashboard path (`/chat`, `/events`, …) gets a `307` from `proxy.ts` to `/?next=<path>`. The root page has the member's tenant list. With one tenant it forwards straight to `/c/<slug>/<path>`. With several it shows the picker, headed "Open this in which chapter?", with the last-chosen tenant first.
   - There is no "last tenant" cookie. One cookie would be shared by every tab, so it would send a bookmark opened from a tab in chapter A into chapter B with no prompt.
   - Paths that leave the tenant tree get their own redirects: `/profile` and `/preferences` go to `/me/…`, and `/dashboard` goes to `/`. `/join`, `/no-access`, `/new-account` and `/whats-new` keep their paths.
   - Invite links keep their format, `/join?token=<uuid>` (`mintJoinUrl` in `@repo/validation`). The token names the chapter, and redeeming it lands on `/c/<slug>/chat`.
   - These redirects stay for at least a year after the web move.
7. **Switching tenants is a navigation.**
   - The switcher is a rail on web and a sheet on mobile, and it navigates to `/c/<slug>`. Because a choice made there is explicit, it also writes `active_chapter_id`.
   - The tenant layout (`app/c/[slug]/layout.tsx`) owns everything keyed to one tenant: the query cache, realtime subscriptions and the chat shell's state. It is keyed on the chapter id.
   - **A switch can be a soft navigation once step 4 lands.** Because the URL carries the context and the tenant layout is keyed on the chapter id, a remount drops the query cache and tears down realtime with no reload. Rollout step 2 keeps today's full page load until a test proves no module-level singleton outlives the remount; step 4 then switches to the soft navigation. Microsoft Teams reloads the whole app on every org switch, which is what this avoids.
   - **Unread counts span every space.** A per-user `GET /v1/me/unread` (auth only, scoped to the caller's own memberships) returns counts per tenant for the switcher's mention dot, and one per-user realtime channel keeps them live. A tab doesn't subscribe to every space it isn't showing. The response also carries one campus entry, computed from the school tables and `campus_read_state` rather than per tenant; the campus spaces design (#4276) owns it.

**Rollout steps** (each its own PR or short series; none ships a UI change before step 2):

1. **API only.**
   - The `tenant_slugs` registry, backfilled for every chapter.
   - The guard change and the tenant-kind check from item 3, and the `getOptionalChapterId` flip.
   - `slug`, `kind` and `school` on `GET /v1/chapters`, and `GET /v1/tenants/resolve`.
   - The cross-tenant tests below.
   - Every change is additive for clients, so `check:api-breaking:shipped` should pass. That is expected, not yet checked; step 1 runs it.
2. **Web moves to `/c/`.**
   - `app/(dashboard)/*` moves to `app/c/[slug]/*`, with the redirects from item 6, the full-load switch and the `multi-tenancy.md` rewrite.
   - The web items under Consequences land here.
3. **Mobile and links.** The integrator PR, universal links, and tenant-carrying push payloads.
4. **Keyed remount replaces the full load,** once a test proves that no module-level singleton (the realtime manager, the chat outbox) survives a remount still holding the old tenant.

Schools (`/s/`) and councils (kind `council`) follow #4192's phases on top of steps 1 and 2.

**Context:**

- **Today one token claim names one chapter for every tab.**
  - `ChapterGuard.readRequestedChapter` (`apps/api/src/interface/guards/chapter.guard.ts`) takes the JWT's `active_chapter_id` first and refuses any header that disagrees.
  - The web keeps its chapter in a persisted client store that every tab shares. `useSelectChapter` changes it by activating, refreshing the token and reloading the page.
  - So a member who is also a council officer can't keep their chapter in one tab and the council in another. A switch in one tab re-points the next request from the other.
- **The isolation control is membership, not the claim.**
  - The guard re-validates membership against the resolved chapter on every request.
  - The realtime RLS function `realtime_can_read_chapter_scope` checks membership by chapter id, and no RLS policy reads the claim.
  - The mismatch refusal kept a client consistent while a switch was half done. It never stopped anyone reaching a chapter they don't belong to.
  - So making the header authoritative moves no tenant boundary: a request can still act only in a tenant where a membership row exists. The new kind check is what keeps a council and a chapter apart once both sit in one table.
- **Links don't carry a chapter today.**
  - Every dashboard route is top level (`apps/web/app/(dashboard)/*`, with 11 hrefs in `nav-config.ts`).
  - Push payloads carry `data.target = { screen, …ids }` with no chapter (`notification.service.ts`, `expo-push.provider.ts`).
  - So a link or notification opens in whatever chapter the reader last used.
- **The school and council layer needs addresses.** The concept on #4192 puts councils beside chapters and campus pages above them. Putting the tenant in the path, as Slack (`/client/T…/C…`) and Linear do, gives each one a stable address.
- **It is cheapest before the beta grows,** while fewer bookmarks, QR codes and push payloads are in the wild.

**Consequences:**

- **API.** Covered by item 3 and rollout step 1. A new `GET /v1/tenants/resolve?slug=` answers only a member. For a slug that's current, it returns the tenant. For a slug that tenant has retired, it returns the redirect to the current slug. Anyone else gets the same `404` whether the slug is unknown, belongs to another tenant, or was retired by one, so it can't be used to probe which chapters are on Frapp or what they renamed to.
- **The cross-tenant tests have to prove these** (`apps/api/test/cross-tenant-isolation.e2e-spec.ts`):
  1. A member of A and B, whose token's claim is B, sends the header for A and is served A's rows only.
  2. The same token sends the header for C, where they're not a member, and gets `403 chapter.context.invalid`, whatever the claim says.
  3. Two concurrent requests on one token with different headers each get their own chapter.
  4. No header with a claim serves the claim's chapter, as today. No header and no claim, for a multi-chapter member, gets `400 chapter.context.required`.
  5. A council officer sending the council's id to a chapter-kind route gets `403 chapter.context.invalid`. A chapter member sending a chapter's id to a council-kind route gets the same.
  6. `resolve` returns an identical status and body to a non-member for an unknown slug, another tenant's current slug and another tenant's retired slug.
  7. Inserting another tenant's retired slug fails at the database. A tenant taking back its own retired slug resolves without a redirect.
  8. `GET /v1/analytics/identity` with header A and claim B returns A's group.
  9. The existing #866 tests of `chapter-config`'s `:id` mismatch still pass with a header present.
  10. Web e2e: two tabs, one in each chapter, each render only their own chapter's rows and realtime events.

  The repository-level tenant harness needs no change, because repositories still receive one resolved chapter id.
- **Web (step 2).**
  - **Links.** Every internal link to a tenant page goes through one `tenantHref(path)` helper that reads the slug from the route. That covers more than `href=` and `router.push`/`replace` in `apps/web`: the 11 `nav-config.ts` hrefs, the setup checklist's paths (`packages/hooks/src/setup-checklist.ts`), the notification drawer's `deepLinkFor`, and the chat deep-link builders. Step 2 starts by listing every quoted flat dashboard path in `apps/web` and `packages/*/src`, and its PR names the command it used.
  - **Proxy.** The `proxy.ts` matcher gains `/c/:path*` and `/s/:path*` and keeps the old prefixes for item 6's redirects.
  - **Chapter store.** The persisted chapter store stops supplying the header. `useClaimChapterSync` is deleted. `useSelectChapter` becomes a navigation plus the explicit `activate`.
  - **First-paint accent.** It is keyed on the route's slug, not the cookie token's claim. Today it comes from `apps/web/lib/theme/server-accent.ts` via `active-chapter-claim.ts`, so a tab in A whose claim is B would first paint in B's colors.
  - **Shared caches** become safe for two tabs. Today the chat first-chunk cache (`apps/web/lib/chat/first-chunk-cache.ts`) prunes every scope but the current one, and `frapp-client-provider.tsx` drops the shared IndexedDB database on a chapter change. With two tabs in two tenants, each would wipe the other's cache. Both become per-scope, and dropping a scope happens only on sign-out or an account change.
- **Mobile (step 3).**
  - **One integrator PR.** The `(app)` group moves under `app/(app)/c/[slug]/`. That touches at least five of the eight hotspot-frozen files: `app/_layout.tsx`, `app/(app)/_layout.tsx`, `app/(app)/(tabs)/_layout.tsx`, `lib/href.ts`, and `app.json` for the universal-link domains ([`spec/ui/mobile/navigation.md` § Hotspot freeze](../../ui/mobile/navigation.md#hotspot-freeze)).
  - **Old in-app links keep working.** The flat routes that are contracts stay as redirect shims to the last-chosen tenant: `event-details`, whose filename `.ics` files exported before the calendar export was withdrawn depend on (#3708), and `ask`.
  - **Context source.** The SDK's `getChapterId` reads the route's slug, resolved against the membership list, in place of the claim. Mobile still shows one tenant at a time, and the switcher sheet replaces the route.
  - **Shared links.** Mobile and web route names differ today (`event-details?id=` against `/events`, `directory` against `/members`, `dues` against `/billing`). A shared link uses the web path, and the app maps it to its own route in Expo Router's `+native-intent` rewrite. The https form, `https://app.frapp.live/c/fiji-rpi/events/<id>`, opens the app only once it declares the domain (iOS `associatedDomains`, Android `intentFilters`, and the two `.well-known` files on the web origin). Today `app.json` sets only the `frapp://` scheme, so https links, invites included, open the web app. *(Corrected 2026-11-11, #4002: from `expo.version` 0.11.0 the app declares `app.frapp.live` for the invite path `/join` only, through `associatedDomains` and a verified intent filter, and the web has routes for the two `.well-known` files for that path, which answer 404 until production sets the two values they publish (`ENV_REFERENCE.md` § References). Every other https link still opens the web, so step 3 still adds its own paths.)*
  - **The tab bar follows the tenant's kind.** The UI design on #4192 gives a council space Recruitment as its third tab, so the tabs layout under `c/[slug]` reads `kind` from the resolved tenant and draws the council set or the chapter set. The chapter tab table in [`spec/ui/mobile/navigation.md`](../../ui/mobile/navigation.md) stays as it is for chapters.
  - **Shipped builds.** They keep working: they send the claim's chapter as the header, which the guard still honors, and item 4 stops the web from moving that claim behind their back.
- **Push payloads gain the tenant.** `data.target` adds `chapterId` and `chapterSlug`. Mobile's `resolveNotificationTarget` and web's `deepLinkFor` open `/c/<slug>/<path>`. A payload from before the change has no tenant and opens in the last-chosen tenant, as it does today. The web drawer also starts using the `eventId` and `taskId` it ignores today. (Corrected 2026-11-13: since then the drawer reads `taskId` for a task submitted for review, opening `/activity?review=<taskId>`, which this change also scopes to the tenant.)
- **Cross-chapter sweeps get a `kind` filter.** Once councils are rows in `chapters`, every job that reads all tenants must say which kinds it means: the scheduled-job sweeps, the stale-palette sweep, the chapter directory and any chapter count.
- **A chapter's interest-form QR code points at `/f/<form-slug>`, not at the chapter's slug,** so a form can be replaced, and the chapter renamed, without reprinting codes.

**Alternatives considered and not chosen:**

- **Keep the claim authoritative and put the slug in the URL for display only.** Links would carry the chapter, but every switch would still need an activate, a token refresh and a reload, and two tabs would still fight over one claim. That removes the point of the change.
- **One token per tab, with the tab setting the claim.** Supabase keeps one session per browser in shared storage, so this needs a token exchange per tab and a second session store. That is more machinery for the isolation the header plus the membership check already gives.
- **Write `active_chapter_id` whenever a tenant is opened.** It would make `/` remember the last tab, but every web tab would then move the claim that shipped phones follow (item 4).
- **Nested `/s/<school>/c/<chapter>/…`.** It reads well, but it breaks for a chapter with no school, and every chapter link would change the day the chapter joins a school. Flat `/c/` keeps a chapter's links stable through the school migration.
- **The chapter's UUID in the path (`/c/7f3a…/chat`).** It's stable and needs no slug registry, but it's unreadable in a shared link and says nothing on a printed QR code.
- **A subdomain per chapter (`fiji-rpi.frapp.live`).** Every tenant would need its own cookie scope and CORS origin. A session wouldn't carry across tenants without cross-subdomain cookies, and certificates and the Vercel domain setup would grow with every chapter.
- **The slug, not the id, as the header (`x-chapter-slug`).** The guard would need a slug lookup on every request, and a rename would break requests already in flight. Resolving once on the client, against the member's own list, keeps the guard's input a UUID.
- **A "last tenant" cookie for old-path redirects.** It saves one tap for multi-tenant members, but it's shared across tabs, so it can silently open a link in the wrong chapter (item 6).
