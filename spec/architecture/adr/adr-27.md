### ADR-27: Tenant-scoped URLs; the page's URL, not the token, names the chapter a request acts in (proposed 2026-11-11)

**Status: Proposed, pending Paul.** Drafted for [#4192](https://github.com/pdcarlson/Frapp/issues/4192) at Winston's request (`whewitt-frapp`, 2026-11-11). Nothing here is built. Until Paul accepts it, [`spec/behavior/multi-tenancy.md`](../../behavior/multi-tenancy.md) remains the current behavior, and this ADR changes no spec. If it is accepted, the PR that builds step 1 below rewrites that spec's "How the claim is issued" and "Changing the active chapter" sections in the same change.

**Decision (proposed):**

1. **Every page inside a tenant carries the tenant in its path.**
   - Chapters and councils live at `/c/<slug>/…`, for example `/c/fiji-rpi/chat` or `/c/rpi-ifc/recruitment`. A council is a tenant of kind `council` in the same `chapters` table (the concept on #4192, option C), so it shares the `/c/` namespace.
   - Campus pages live at `/s/<school-slug>/…`, for example `/s/rpi`.
   - Pages that belong to the person, not a tenant, stay at the top level: `/` (which sends you on to the right place), `/me` (profile and preferences across tenants), `/join`, `/start` (new chapter or council), sign-in and sign-up.
   - Public pages need no account and sit outside both: `/f/<form-slug>` for a chapter's interest form, the target of its QR code.
   - The mobile app uses the same paths in Expo Router, so one link can work on both: `frapp://c/fiji-rpi/events/<id>` in the app, and `https://app.frapp.live/c/fiji-rpi/events/<id>` on the web. That https link opens the app only once the app declares the domain (iOS `associatedDomains`, Android `intentFilters`, plus the two `.well-known` files on the web origin). Today `app.json` sets only the `frapp://` scheme, so https links, invite links included, open the web app.
2. **The URL supplies each request's chapter context.** The client resolves the slug in its path to a chapter id from the person's own membership list, and sends it as `x-chapter-id` on every request from that page. The header is per tab, because it is read from the tab's URL and never from storage that tabs share.
3. **`ChapterGuard` treats an explicit header as authoritative and the JWT claim as a default.**
   - Header present: the guard validates membership in that chapter, as it does today, and serves it. The claim is ignored for that request.
   - Header absent: the claim decides, then the sole membership. This is today's rule, and it keeps every shipped mobile build working.
   - The `chapter.context.mismatch` refusal is removed, because a header that differs from the claim is now normal: two tabs in two chapters share one token.
   - Everything else is unchanged: `chapter.context.invalid` for a non-member, `chapter.context.required` for a multi-chapter member who sent nothing, and the 503 on a failed lookup.
4. **`users.active_chapter_id` becomes "last tenant used".** It no longer names the context of any request that carries a header. It decides only where `/` sends you, the context for clients that send no header, and the chapter a push notification without a slug opens in. The client updates it, without waiting, when you open a tenant. A failure to update it changes nothing on the page.
5. **Slugs.**
   - **Format:** 3 to 40 characters of lowercase `a–z`, `0–9` and single hyphens, not starting or ending with a hyphen: `^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,39}$`. ASCII only, so no lookalike Unicode.
   - **One namespace** for chapters and councils, enforced by a unique index on `chapters.slug`. School slugs are a separate namespace on `schools.slug`, because `/s/` and `/c/` never collide.
   - **Default:** the organization's short name and the school's, for example `fiji-rpi` or `rpi-ifc`. Without a school it's the organization and its chapter designation (`phigam-alpha-chi`). On a collision a number is added (`fiji-rpi-2`) and the founder is shown the result to edit.
   - **Renaming:** an officer holding the chapter-settings permission can rename. Each old slug goes into `chapter_slug_history(slug primary key, chapter_id, retired_at)`, and a request for it gets a permanent redirect to the current slug. **A retired slug is never given to another tenant**, so an old link, QR code or invite can never land someone in a different chapter. A rename is limited to once every 30 days, so a chapter can't burn through names.
   - **Reserved:** platform and route words (`new`, `join`, `start`, `me`, `settings`, `admin`, `api`, `app`, `www`, `help`, `support`, `status`, `frapp`, `signet`, `staff`, `official`), council words used alone (`ifc`, `panhellenic`, `phc`, `nphc`, `mgc`, `council`, `school`), and every first-level route name. A chapter can still be `rpi-ifc`; it can't be `ifc`. The list lives in `@repo/validation`, next to the slug schema, so the API and both clients check against one copy.
6. **Old links redirect, and the redirect never guesses wrong silently.**
   - A flat dashboard path (`/chat`, `/events/<id>`, …) gets a `307` from `proxy.ts` to `/c/<last-slug>/<same path>`. `<last-slug>` comes from a `frapp_last_tenant` cookie that the tenant layout sets. The proxy does no database read.
   - With no cookie, the proxy sends you to `/?next=<path>`. One membership forwards straight through. Several show the picker headed "Open /events in which chapter?" and keep the path.
   - The redirect target is still membership-checked like any other tenant page. A stale cookie therefore lands on the picker, never on another chapter's data.
   - `/dashboard`, which goes to `/chat` today, redirects to `/`. `/` stops sending everyone to `/chat` and sends a signed-in person to their last tenant. The default `redirectTo` (`apps/web/lib/auth/redirect.ts`) becomes `/`.
   - Invite links keep their format, `/join?token=<uuid>` (`mintJoinUrl` in `@repo/validation`). The token names the chapter, so an invite needs no slug, and redeeming one lands on `/c/<slug>/chat`. These redirects stay for at least one year after the cutover.
7. **Switching tenants is a navigation.**
   - The switcher (a rail on web, a sheet on mobile) navigates to `/c/<slug>`. The tenant layout, `app/c/[slug]/layout.tsx`, owns everything keyed to one tenant: the query cache, the realtime subscriptions and the chat shell's state. It is keyed on the chapter id, so arriving in a different tenant remounts it from scratch.
   - Step 1 keeps today's full page load on a switch, so the cache-clearing invariant in `multi-tenancy.md` holds while the move lands. Step 3 swaps it for the keyed remount, once a test proves that no module-level singleton (the realtime manager, the chat outbox) survives the remount still holding the old tenant.

**Context:**

- **Today one token claim names one chapter for every tab.** `ChapterGuard` (`apps/api/src/interface/guards/chapter.guard.ts`, `readRequestedChapter`) takes the JWT's `active_chapter_id` first and refuses any header that disagrees. The web keeps its chapter in a persisted client store that every tab shares, and `useSelectChapter` changes it by activating, refreshing the token and then reloading the page. So a member who is also a council officer can't keep their chapter in one tab and the council in another. Switching in one tab silently re-points the other tab's next request.
- **The isolation control is membership, not the claim.** The guard re-validates membership against the resolved chapter on every request, and the realtime RLS functions (`realtime_can_read_chapter_scope`) check membership by chapter id. Neither reads the claim. The mismatch refusal kept a client consistent: it stopped a stale store and a fresh token from disagreeing mid-switch. It never stopped someone reaching a chapter they don't belong to. So making the header authoritative moves no tenant boundary. A request can still act only in a chapter whose membership row exists.
- **Links don't carry a chapter today.** Every dashboard route is top level (`apps/web/app/(dashboard)/*`, 11 nav hrefs in `nav-config.ts`). A link sent in one chapter's chat opens in whatever chapter the reader last used.
- **The school and council layer needs addresses.** The concept on #4192 puts councils beside chapters and campus pages above them. Putting the tenant in the path, as Slack (`/client/T…/C…`) and Linear do, gives each one a stable address.
- **It is cheapest before the beta grows.** Fewer bookmarks, QR codes and push payloads are in the wild to keep working.

**Consequences:**

- **What changes in the API.** `ChapterGuard.readRequestedChapter` drops the mismatch branch and prefers the header. Nothing else in the guard changes. `chapter.context.mismatch` is no longer thrown. The client code that treats it as a transient 403 (`packages/hooks/src/card-read-miss.ts`, `use-rush.ts`, `use-service-entries.ts`, `packages/chat-core/src/channels-refused-copy.ts`) and its entry in `packages/observability` stay until no shipped build can receive it, then go. `GET /v1/chapters` (the member's own list) gains `slug`, `kind` and `school` so the client can resolve a slug with no extra request. A new `GET /v1/tenants/resolve?slug=` answers only for a member, or with the redirect for a retired slug. For anyone else it returns the same `404` whether or not the slug exists, so it can't be used to probe which chapters are on Frapp.
- **Cross-tenant tests have to prove the new rules** (`apps/api/test/cross-tenant-isolation.e2e-spec.ts`):
  - A member of A and B, holding a token whose claim is B, sends the header for A and is served A's rows only.
  - The same token sends the header for C, where they aren't a member, and gets `403 chapter.context.invalid`, whatever the claim says.
  - Two concurrent requests on one token with different headers each get their own chapter. The guard's `InFlightLookups` deduplication must not cross them.
  - No header with a claim serves the claim's chapter, as today. No header and no claim, for a multi-chapter member, gets `400 chapter.context.required`.
  - A council-only officer gets `403` on every chapter route, and a chapter-only member on every council route.
  - `resolve` returns the same body and status for a slug that doesn't exist and for one that belongs to someone else's chapter.
  - A retired slug can't be claimed by another tenant.
  - Web e2e: two tabs, one in each chapter, each render only their own chapter's rows and realtime events.

  The repository-level tenant harness needs no change, because repositories still receive one resolved chapter id.
- **What changes on web.**
  - `app/(dashboard)/*` moves to `app/c/[slug]/*`.
  - Every internal link goes through one `tenantHref(path)` helper that reads the slug from the route: the 11 nav hrefs in `nav-config.ts`, and 33 more hard-coded `href="/…"`, `router.push("/…")` and `router.replace("/…")` sites outside specs (by grep on 2026-11-11).
  - The `proxy.ts` matcher gains `/c/:path*` and `/s/:path*`, and keeps the old prefixes for the redirects.
  - The persisted chapter store stops supplying the header and only remembers the last tenant. `useClaimChapterSync` is deleted, and `useSelectChapter` becomes a navigation plus a background `activate`.
- **What changes on mobile.**
  - The `(app)` group moves under `app/(app)/c/[slug]/`. That edits four of the eight hotspot-frozen files (`app/_layout.tsx`, `app/(app)/_layout.tsx`, `lib/href.ts`, and `app.json` for the universal-link domains), so it lands as one integrator PR ([`spec/ui/mobile/navigation.md` § Hotspot freeze](../../ui/mobile/navigation.md#hotspot-freeze)).
  - The SDK's `getChapterId` reads the route's slug in place of the token claim.
  - Mobile still shows one tenant at a time. The switcher sheet replaces the route.
  - Shipped builds that send no header keep working through the claim default. The guard is the only API change, and it adds no field and removes no endpoint, so `check:api-breaking:shipped` has nothing to flag.
- **Push payloads gain the tenant.** Today `data.target` is `{ screen, …ids }` (`notification.service.ts`, `expo-push.provider.ts`) with no chapter id, so a tap opens in whichever chapter is active, which is wrong for anyone in two tenants. The target gains `chapterId` and `chapterSlug`. Mobile's `resolveNotificationTarget` and web's `deepLinkFor` build `/c/<slug>/<path>` from them. A payload from before the change, with no chapter, keeps today's behavior and opens in the last tenant used. The web drawer also starts using the ids it ignores today (`eventId`, `taskId`).
- **The QR code on a chapter's interest form points at `/f/<form-slug>`, not at the chapter's slug.** A form can be retired and replaced without renaming the chapter, and printed codes keep working after a rename.

**Alternatives considered and not chosen:**

- **Keep the token claim as the authority and put the slug in the URL for display only.** Links would carry the chapter, but every switch would still need an activate, a token refresh and a reload, and two tabs would still fight over one claim. That removes the point of the change.
- **One token per tab, with the claim set by the tab.** Supabase keeps one session per browser in shared storage, so this needs a token exchange per tab and a second session store. It is more machinery to reach the same isolation the header plus membership check already gives.
- **Nested `/s/<school>/c/<chapter>/…`.** It reads well, but it breaks for a chapter with no school, and every chapter link would change on the day the chapter joins a school. Flat `/c/` keeps a chapter's links stable through the school migration.
- **The chapter's UUID in the path (`/c/7f3a…/chat`).** It's stable and needs no slug table, but it's unreadable in a link someone sends, and on a printed QR code it says nothing about where it goes.
- **A subdomain per chapter (`fiji-rpi.frapp.live`).** Every tenant would need its own cookie scope and CORS origin, a session wouldn't carry across tenants without cross-subdomain cookies, and wildcard certificates and the Vercel domain setup grow with every chapter.
- **Send the slug, not the id, as the header (`x-chapter-slug`).** The guard would need a slug lookup on every request, and a rename would break requests already in flight. Resolving once on the client, against the member's own list, keeps the guard's input a UUID.
