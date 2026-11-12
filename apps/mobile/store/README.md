# Store listing — App Store and Google Play

The text and answers the two store consoles ask for, kept next to the app so
they are reviewed like code. Nothing here is read by a build; it is what a human
pastes into App Store Connect and the Play Console when creating the listing
(build and EAS environment procedure:
[`docs/ops/deployment/mobile.md`](../../../docs/ops/deployment/mobile.md)
§ 6 — it covers `eas` setup and the screenshot capture, and says nothing about listing
fields or submission).

**Screenshots: produced by a script, uploaded by the owner.** App Store Connect does not
accept a submission without them ([#2454](https://github.com/pdcarlson/Frapp/issues/2454)).
The owner approved renders of the real app on Expo web as the screens (2026-09-22), so they
no longer wait on a device build or on `preview` (#2415), and picked a framed design for both
stores (2026-11-05): `node scripts/demo/capture-mobile.mjs --store` signs in to the local demo
chapter, captures seven screens once, and frames them with a caption in the feature graphic's
charcoal and gold, into `screenshots/app-store/` (1320 × 2868; the console took 1206 × 2622 instead, see § 6.4) and
`screenshots/google-play/` (1242 × 2208). No Ask screen, because production has none (#2259; the server's AI is off),
and no Dues screen, because a populated ledger shows the Stripe footer § Review notes keeps from
App Review. The procedure, the captions, and where the sizes come from are in
[`mobile.md` § 6.4](../../../docs/ops/deployment/mobile.md#64-store-screenshots).
They are generated rather than committed (`screenshots/` is gitignored). Whether they
have been uploaded is recorded on #2454 (App Store) and #2720 (Play), not here: until those
issues close, assume not.

**Graphics: rendered by a script, committed, uploaded by the owner.** Google Play's listing
needs a 512 × 512 icon and a 1024 × 500 feature graphic, and Play Console won't publish the
listing without the feature graphic. `npm run rasterize:brand-assets` renders both from the
emblem B vector, with every other brand raster, into [`graphics/`](graphics/):
`play-icon-512.png` and `play-feature-graphic-1024x500.png`. Unlike the screenshots they are
committed, because they render without the app or its data, and `check:brand-assets` fails
CI when they stop matching the mark, the renderer, or the shape Play takes. What the feature
graphic shows, and why, is in [`store-graphics.mjs`](../../../scripts/lib/store-graphics.mjs).
Upload them in Play Console under **Grow users → Store presence → Main store listing →
Graphics** *(path from Play Console Help search snippets; support.google.com is blocked from
the sandbox)*. Whether they have been uploaded is recorded on
[#2122](https://github.com/pdcarlson/Frapp/issues/2122), not here. App Store Connect has no
icon field: the iOS icon ships in the binary from `apps/mobile/app.json` and changes only
with a new build
([App Store Connect Help, "Add an app icon"](https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon);
dark and tinted variants: [`spec/ui/assets.md` § 7](../../../spec/ui/assets.md#7-mobile-expo-rasters)).

**App Store product page images: made by hand, committed, uploaded by the owner.** App Store
Connect's version page has a *Header and Search Results* panel with one optional asset per
tab. Both are in [`graphics/app-store/`](graphics/app-store/):
`app-store-header-5244x2950.png` (Header tab; it also takes 3840 × 1646) and
`app-store-search-results-3840x2560.png` (Search Results tab; it also takes 5244 × 2950 and
1920 × 1280). Sizes were read from the console on 2026-11-05. Without a search results asset,
App Store Connect uses the screenshots instead. Both images were composed on 2026-11-05 from
the charcoal screenshot set (`scripts/demo/store-frames.mjs`). Nothing renders them, so
`check:brand-assets` doesn't check them, and they go stale when the screenshots change. The
header is centered: on an iPhone the product page shows only its middle (about 62% of the
width, and the top three quarters above the app card), so the first, left-aligned version
lost its headline there and was replaced the same day.

**App Store screenshot size.** The console took 1206 × 2622 on 2026-11-05, not the
pipeline's 1320 × 2868: [`mobile.md` § 6.4](../../../docs/ops/deployment/mobile.md#64-store-screenshots).

**The product is Frapp** ([ADR-25](../../../spec/architecture/adr/adr-25.md),
2026-09-23). The App Store **listing** name is **`Frapp: Chapter Hub`**. The
owner claimed it in App Store Connect on 2026-09-23, replacing `Signet: Chapter
Hub`. The listing needs a suffix because listing names are globally unique, and
plain `Frapp` is already taken (app id `1540087188`), as plain `Signet` was (app
id `1483581287`).

**The home screen says Frapp.** Chrome (home screen, iOS Settings) comes from
`expo.name` in [`apps/mobile/app.json`](../app.json). ADR-25's step 2
([#2577](https://github.com/pdcarlson/Frapp/issues/2577)) moved that string, the
iOS permission prompts and the in-app copy from Signet to **Frapp**, and the
listing text below (description, review notes) with them. A build made before
step 2 merged still says Signet. Before submitting, check that `expo.name` is
`Frapp` in `app.json` at the build's commit, or that the installed TestFlight
build's home-screen name reads Frapp.
[`frapp-naming.test.mjs`](../../../scripts/ci/__tests__/frapp-naming.test.mjs)
fails CI when a line of `apps/mobile`'s source says Signet outside the comment
the line starts with. It can't see Signet on a line that itself starts like a
comment (a template or JSX text line beginning `*` or `//`), it reads the
source rather than the built binary, so look at the build itself too. Text the
server sends (API messages, the system actor's name) moved in ADR-25's step 3,
and the same test's API walk and system-actor pins keep it there. The bundle id and Android package (`live.frapp.mobile`), slug,
scheme, and every public URL are **frapp** permanently; the full list is
[`brand-identity.md` § 1](../../../spec/ui/brand-identity.md#1-identity). The
trademark record is on #1901; this file is the listing paste.

## Identity

| Field | Value |
| --- | --- |
| Name (App Store listing, 30 chars) | Frapp: Chapter Hub (claimed 2026-09-23; was Signet: Chapter Hub) |
| Name (Google Play listing, 30 chars) | Frapp: Chapter Hub, entered 2026-11-05 to match the App Store ([#2720](https://github.com/pdcarlson/Frapp/issues/2720)). Play names aren't unique, so plain Frapp should have been allowed *(rule unverified)*; the owner chose to match |
| Display name (home screen, from `expo.name`) | Frapp (Signet until ADR-25 step 2) |
| Subtitle (iOS, 30 chars) / Short description (Android, 80 chars) | Your chapter, in one place |
| Bundle id / package | `live.frapp.mobile` |
| Category | Productivity (primary); Social Networking (secondary, iOS) |
| Age rating | **13+** (iOS) / Everyone (Android: issued by the IARC questionnaire in Play Console on 2026-11-05, ESRB **Everyone** with the interactive element *Users Interact* and no content descriptors; North America is the only distribution region, [#2720](https://github.com/pdcarlson/Frapp/issues/2720)). See § Age rating below — 13+ is a deliberate override of the 4+ the questionnaire calculated. |
| Price | Free (chapters subscribe on the web dashboard. The app has no in-app purchases, and no payment can be taken in the app at all — card payments are not switched on for this build. **Basis: no Stripe key in the EAS `production` environment, per #2415's `env:list` of 2026-09-18. Re-run `npm run eas -- env:list --environment production` (from the repo root) against the build you actually submit before pasting this.** See § Review notes.) |
| Privacy policy URL | https://frapp.live/privacy |
| Terms URL | https://frapp.live/terms |
| Support URL | https://frapp.live/support |
| Marketing URL | https://frapp.live |
| Support email | team@frapp.live |

> **Production legal URLs (checked 2026-09-07 20:40Z):** `https://frapp.live/privacy`, `/terms`,
> and `/support` each return **200** after the apex 307 to `www.frapp.live/…`
> (`curl -sSI -L`; `x-matched-path` is the matching route). The 2026-09-06 23:55Z **404**
> reading was the March 2026-03-04 landing alias; Deploy production run 34155737950
> (`f2938a01`) replaced it. Both stores still fetch the privacy URL when the listing is
> saved and reviewers still open the support URL — those fetches now succeed. The app
> talks to `api.frapp.live`, whose `/health` and `/health/ready` also return 200 on the
> same check.
>
> **Re-checked 2026-09-21. The superseded 2026-09-14 reading is kept below rather than
> deleted, because it is the record of how the gap was found.** The production API is
> live on commit `7e47ec5` (2026-09-16, deploy `dep-dalvt9ou01pc73av5tq0`, status
> `live`) — **29** commits behind `main`, not 160
> (`git rev-list --count 7e47ec5..origin/main`). Of those, **five** touch `apps/api`
> and **six** touch `apps/api packages/api-sdk packages/validation`; run the command with
> the packages included, because the store binary compiles them too and an `apps/api`-only
> filter cannot see the client half of a contract.
>
> **No contract break, and here is the check rather than the characterization:**
> `git diff 7e47ec5 origin/main -- apps/api/src/interface/controllers apps/api/src/interface/dto apps/api/openapi.json packages/api-sdk`
> returns only `*.controller.spec.ts` changes — no route-decorator diff, no `openapi.json`
> change, no SDK change — and `apps/api/src/interface/guards/chapter.guard.ts` is
> byte-identical. Do not describe the window as only bumps and refactors: `a3a042d`
> (#2417) touches no `apps/api` file but adds `subscriptionRefusalFromServerMessage` to
> `packages/validation/src/subscription.ts`, which matches the API's 403 **prose** because
> `AllExceptionsFilter` dropped `code` until #1020 (2026-09-30). That is the one prose-coupled contract in
> the window: it holds only while those refusal strings are byte-identical, which today
> they are. Reword a `chapter.guard.ts` message and deploy the API alone and the store
> binary stops recognizing a subscription refusal.
>
> `frapp-prod` migrations are **current** — its applied list ends at the same
> `20260915210100` the repo does (83 files; the old "81" was stale) — and it already
> carries `chat_reports_and_blocks`, so the Guideline 1.2 **write** path is deployed.
> (`mcp__Render__list_deploys` on `srv-d6lqu41aae7s73f62df0`;
> `mcp__Supabase__list_migrations` on `unttyvyfezddlyafcydh`.) **Re-check again before
> submitting**; a 200 on `/health` says the service is up, not that it matches the app.
>
> That narrows #2257 to client work but does not close it. Both client halves were built
> later than the deploy verified above, so check that each shipped before relying on it.
> The member half (report a message, block and unblock a member, the tombstone and
> Settings → Blocked members) ships only in a binary built from `main` after the #2257
> member-side change merged; confirm the merge and the build. The officer half, which 1.2
> also requires (acting on a report, not only accepting it), is on the web dashboard only:
> Chat Admin reads `/v1/chat/reports` and can remove the one message an open report names
> (#2311). Both per `spec/behavior/chat/README.md` § Report and block.
>
> **Superseded, kept as the provenance of the Resend gap (2026-09-14):** production then
> served `0ca478e` (2026-09-08), ~160 commits behind `main`, with 76 of the repo's 81
> migrations, and had no Resend key — the deployed commit was titled *"fix: do not claim
> invite email was sent when production has no Resend key"*. The Resend gap was **not**
> re-verified on 2026-09-21; it is owned by
> [`ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md). It does not
> affect a reviewer, who signs in with the seeded account's email and password and is
> never emailed anything.
>
> **What `frapp-prod` held on 2026-09-21:** 2 chapters, 7 member rows but only 2 auth
> users, 2 invites, 3 invoices of which 2 are OPEN, 5 events, 11 chat messages, 0 DM
> channels and 0 study zones. Produced with `mcp__Supabase__execute_sql` on
> `unttyvyfezddlyafcydh` — `select count(*)` over `chapters`, `members`, `auth.users`,
> `invites`, `financial_invoices` (total and `where status = 'OPEN'`), `events`,
> `chat_messages`, `chat_channels where type in ('DM','GROUP_DM')` and `study_geofences`.
> **These invert as soon as § Seed the reviewer's chapter is acted on — re-run the query
> rather than trusting the figures.** Four review notes below describe things a reviewer
> cannot currently reach; that section is the fix.

## As submitted — App Store Connect (recorded 2026-09-14)

What was actually entered in the console, so a later problem can be traced to the
answer that caused it rather than re-derived.

| Field | Value |
| --- | --- |
| Apple ID | `6812025642` |
| SKU (permanent, internal) | `signet-ios-001` |
| Bundle ID | `live.frapp.mobile` |
| Platforms | iOS only |
| Primary language | English (U.S.) |
| Content Rights | **Yes** — third-party content present |

**EU Digital Services Act — declared non-trader / no EU distribution.** The
dialog's second option reads "I'm not a trader under the DSA **or I don't plan to
distribute in the EU**"; the declaration was made on the *second* limb, which is
true — Frapp targets US Greek life. It was **not** a claim of non-trader status:
Frapp charges chapters a paid subscription ([`spec/product/positioning.md` § Paid tier (Chapter Pro)](../../../spec/product/positioning.md#paid-tier-chapter-pro)),
which is trading under Apple's test. The consequence is that Apple withholds the
app from the 27 EU storefronts; availability follows the viewer's Apple Account
country, not their physical location, so a member travelling in Europe on a US
account is unaffected. **If EU distribution is ever wanted, the route is to
declare trader** (address, phone and email published on the EU listing, plus
documentation and Apple verification) — not to re-pick this option.

**Content Rights = Yes because of Backwork.**
[`spec/behavior/backwork.md`](../../../spec/behavior/backwork.md) indexes uploads
by department, course number and professor name, with an assignment-type enum
including `Exam`/`Final Exam` and a document-variant enum including `Answer Key`.
Those are third-party copyrighted works. The rights attestation rests on
[`spec/behavior/legal.md`](../../../spec/behavior/legal.md), which places the
obligation on the uploader.

> **That basis is gone (2026-09-23).** The owner decided Backwork stays off mobile for
> the beta, while the web dashboard keeps it ([#2258](https://github.com/pdcarlson/Frapp/issues/2258),
> option 1). The app had no Backwork screen, and its one mention, a sentence on the
> create-chapter checkbox, was removed with #2302. Whether the answer should stay Yes now
> turns on what members share in chat, photos included. Re-check it at submission
> ([#2478](https://github.com/pdcarlson/Frapp/issues/2478) § C) rather than flipping it
> from here. Either way, the review notes need no Backwork paragraph.

### Age rating

The questionnaire **calculated 4+**; it was **overridden to 13+**. Answers given:

| Question | Answer |
| --- | --- |
| Parental Controls / Age Assurance | No |
| Unrestricted Web Access | No — no embedded browser |
| User-Generated Content | **Yes** |
| Social Media | **No** |
| Social Media Disabled for Users Under 13 | No (not applicable) |
| Messaging and Chat | **Yes** |
| Advertising | No |
| Every content category (violence, sexual content, profanity, horror, drugs, gambling, contests, medical) | None |

**Social Media = No** is defensible on Apple's own wording — "redistribution,
amplification, or interaction with user-generated content through a social feed or
similar discovery method that visibly spreads content to many users." Frapp has
no followers, no discovery and no resharing, and the activity feed has no client
surface at all (see the surface note at the top of
[`spec/behavior/activity-feed.md`](../../../spec/behavior/activity-feed.md)).

**Contests = None** despite points and leaderboards: Apple's descriptor means
prize competitions and sweepstakes. [`spec/behavior/points.md`](../../../spec/behavior/points.md)
has only `MANUAL` (reward) and `FINE` (penalty) adjustments plus task point
rewards — no prizes, entries or winners.

**Why 13+ rather than the calculated 4+:** the app ships chapter channels and
direct messages, at the time of the override (2026-09-14) with no member-level report
or block, and its real audience is college students. Report and block exist only in a
binary built from `main` after the #2257 member-side change merged (§ Review notes). The
owner revisited the override on 2026-09-23 and kept 13+ (the correction below). 18+ was
rejected on 2026-09-14 because Apple reads it as mature content and
[`apps/landing/app/terms/page.tsx`](../../landing/app/terms/page.tsx) then carried no
minimum-age clause to back it.

> **Corrected 2026-09-23.** The Terms now set a minimum age of 18, and every user
> confirms it when they accept ([#2261](https://github.com/pdcarlson/Frapp/issues/2261),
> [#2302](https://github.com/pdcarlson/Frapp/issues/2302)). The rating stays 13+ by
> owner decision: it rates the app's content, not who may sign up, and the first reason
> above still holds. Only the second reason is gone.

### Open before submitting

Found while completing the console on 2026-09-14. None blocked creating the
record; each is a review-time or launch risk.

| # | Risk |
| --- | --- |
| [#2257](https://github.com/pdcarlson/Frapp/issues/2257) | Guideline 1.2 — member-level report and block ship on mobile only in a binary built from `main` after the #2257 member-side change merged; the officer queue that reads reports is on the web dashboard only (#2311). Filtering before posting: [`spec/behavior/chat/README.md` § No pre-post content filter](../../../spec/behavior/chat/README.md#no-pre-post-content-filter) |
| ~~[#2258](https://github.com/pdcarlson/Frapp/issues/2258)~~ | Decided 2026-09-23 (owner): Backwork stays off mobile for the beta; the web dashboard keeps it. See § Content Rights for what that changes in the console |
| ~~[#2259](https://github.com/pdcarlson/Frapp/issues/2259)~~ | Fixed in the repo 2026-09-22 (owner decision): with Ask off, Chat home and Events draw no ✦ pill, the sheet renders nothing, and `frapp://ask` redirects to Chat home, so **a reviewer is shown no Ask surface at all**. That is also why § Review notes says nothing about Ask: there is nothing on screen to explain. Live only in the next build. It needs `EXPO_PUBLIC_ASK_ENABLED` off in the EAS `production` environment, which the repo cannot see, and since 2026-09-22 an EAS `production` build refuses to evaluate its config when the flag is on (`apps/mobile/app.config.js`), so a set value fails the build instead of shipping Ask (§ Description's note) **Changed 2026-11-12 (#C4PR):** the build flag and its production fence are gone. Whether the app draws Ask is now the API's answer, so a reviewer sees no Ask while production runs with `AI_ENABLED` off, which is the default. Turning it on in production puts Ask, the AI sheet and minutes drafting in front of a reviewer in the binary already on the stores, so the listing, the review notes and the privacy answers must be updated first ([#3297](https://github.com/pdcarlson/Frapp/issues/3297)) |
| ~~[#2260](https://github.com/pdcarlson/Frapp/issues/2260)~~ | Closed 2026-09-18 — answered ("it is not set"), superseded by #2415 |
| ~~[#2261](https://github.com/pdcarlson/Frapp/issues/2261)~~ | Fixed in the repo 2026-09-23 with #2302: the Terms say 18 or older and carry the zero-tolerance clause Guideline 1.2 expects. The server refuses to add anyone to a chapter until they accept (join, onboarding). A member from before #2302 is asked by the app's Terms prompt, which is a client gate, not a server one: [`spec/behavior/legal.md`](../../../spec/behavior/legal.md#acceptance-record) § Acceptance record says what it can't block. Live only after the next Deploy production (landing, API and web) and in a binary built after it merged |
| ~~[#2262](https://github.com/pdcarlson/Frapp/issues/2262)~~ | Fixed in the repo 2026-09-22: the FERPA notice no longer points at a redaction tool. Live only after the next Deploy production |

The rows above are what completing the console surfaced. These came from reading the
binary and the live providers on 2026-09-21, and the rows marked **hard gate** are gates rather than risks —
App Store Connect will not take the submission at all. Each links the issue that owns
the work; the detail lives there, not here.

| # | Risk | Kind |
| --- | --- | --- |
| [#2454](https://github.com/pdcarlson/Frapp/issues/2454) | **Screenshots uploaded to both stores on 2026-11-05.** Filed 2026-09-21 because the gate's only tracker was #2196 §4, and #2196 was closed as completed with every box unticked. Since 2026-11-05 both stores' framed sets come from `capture-mobile.mjs --store` (see the note at the top of this file); the owner uploaded both on 2026-11-05, and the App Store slot took 1206 × 2622, not 1320 × 2868 (`mobile.md` § 6.4); what remains is the pipeline rendering that size itself in the console | hard gate |
| [#2415](https://github.com/pdcarlson/Frapp/issues/2415) | EAS `preview` holds only `SENTRY_AUTH_TOKEN`. It no longer owns the screenshot route (#2454 shoots from Expo web), but a `preview` build still cannot sign in. Its other half, no Stripe key in `production`, stopped gating submission on 2026-09-21: this listing no longer claims card payments, so that key is a product decision rather than a blocker. Neither half now gates submission, which ships the `production` build | no longer a gate (2026-09-22) |
| [#2195](https://github.com/pdcarlson/Frapp/issues/2195) | Apple Developer trader status (EU DSA) — **probably already done, and only needs confirming.** #2195 was filed 2026-09-13 off a banner reading "Developers must provide their trader status to submit new apps", which gates submission itself rather than only EU availability. The dialog it sends you to *is* the trader-status dialog, and § As submitted records answering it the next day, 2026-09-14, on the "I don't plan to distribute in the EU" limb. So the action has very likely been taken and the issue is stale. Confirm the banner is gone from the Apps page and close #2195; do not re-answer the dialog, because re-picking is how you end up declaring trader and publishing a home address on an EU listing | confirm, then close |
| [#2308](https://github.com/pdcarlson/Frapp/issues/2308) / [#2309](https://github.com/pdcarlson/Frapp/issues/2309) | The App Review login exists in `frapp-prod` (created 2026-09-17 and marked for the seed on 2026-09-24, #2309), but its chapter is seeded only on the day of submission, because the check-in event goes stale 43 to 67 hours after a seed (#2478 § D). Until that seed runs, the reviewer signs in to no chapter. The seed is ready: `scripts/demo/seed-demo.mjs --reviewer` targets a hosted project, and its `auth` → `sql` → `storage` → `verify` path passed end to end on staging on 2026-09-23 at `69e0021` (output in [#2537](https://github.com/pdcarlson/Frapp/pull/2537); staging was cleaned afterwards). Changes made after that run, which reached `main` in the follow-up PR that links back to #2537 rather than in #2537 itself, were verified against the local stack, unit tests and the `pglite-migrations` check only: `sql` (a guard that runs between its deletes, and a refusal to adopt a login that other rows reference), `storage` (`--remove` clears the chapter's folder in every bucket, and refuses while the chapter exists) and `verify` (a stricter staleness check). Applying it to production is the owner's step, [`demo-data.md` § Production (App Review)](../../../docs/guides/demo-data.md#production-app-review) | hard gate |
| [#2257](https://github.com/pdcarlson/Frapp/issues/2257) | Guideline 1.2 (restated as a blocker, not a risk): API and production DB ship report/block. The mobile client consumes both, but only in a binary built from `main` after the #2257 member-side change merged; the web dashboard's officer queue reads filed reports and acts on them (#2311), once that is deployed. Web members get the same block list and can unblock (#2313), and can report a message or block its sender from its More menu (#2687). The filtering half of 1.2: [spec § No pre-post content filter](../../../spec/behavior/chat/README.md#no-pre-post-content-filter). Stays a blocker until the submitted build and the deploy are confirmed; § Review notes' 1.2 bullet says what the deploy has to carry | blocker |
| [#2305](https://github.com/pdcarlson/Frapp/issues/2305) / [#2895](https://github.com/pdcarlson/Frapp/issues/2895) | **Fixed in the repo 2026-09-30; live only after the next Deploy production and in a binary built after it.** #2305 (2026-09-22) narrowed the policy's photo-library clause to chat photos, because iOS had no profile-photo picker then, and added Resend (sign-in and invite email) and the two hosts, Render and Vercel, to § Service Providers. #2897 (2026-09-29) then added one: s15 sets a profile photo from the library through the same picker chat uses. So #2895 names both uses again, in the iOS purpose string (`app.json` `photosPermission`) and in the policy, and bumped `LEGAL_POLICY_VERSION` to `2026-09.2`. The owner re-enters the console privacy answers (§ Privacy questionnaire answers). Both stores fetch the live URL, so deploy the landing before submitting | 5.1.1(i), 5.1.2 |
| ~~[#2298](https://github.com/pdcarlson/Frapp/issues/2298)~~ / ~~[#2301](https://github.com/pdcarlson/Frapp/issues/2301)~~ | **Fixed in the repo; live only in the next build.** The `sheet-demo` dev route, reachable via `frapp://sheet-demo`, was deleted on 2026-09-27. The sign-in tagline no longer advertises Ask (fixed 2026-09-22), and the two permanently inert controls, [#2300](https://github.com/pdcarlson/Frapp/issues/2300), were removed the same day. | 2.1 |
| [#2334](https://github.com/pdcarlson/Frapp/issues/2334) | **Smoke-test Sign in with Apple on the TestFlight build before submitting.** At the pinned `expo-apple-authentication ~57.0.2` a nil `keyWindow` reaches an uncatchable Swift `fatalError`, i.e. a SIGTRAP abort on the sign-in screen with the browser-OAuth fallback unreachable — and no live Apple sign-in has ever been observed against `frapp-prod`. The unit suite gives **zero** signal because it never loads the native module. A crash on the first screen a reviewer touches outranks the 4.8 question it also raises | 4.8 + crash |

## Description

> Deliberately omits Ask. [`spec/ui/brand-identity.md`](../../../spec/ui/brand-identity.md)
> gives the tagline as "Ask your chapter anything." and positions Frapp as the
> AI-first operating system for Greek life, but Ask is off in production: the app
> draws it only when the API says the server has AI on (`AI_ENABLED`, off by default;
> until 2026-11-12 a build flag, `EXPO_PUBLIC_ASK_ENABLED`, over a hand-written table,
> both since deleted). Store metadata that
> advertised it would be inaccurate under Guideline 2.3. **Use the tagline as the
> subtitle once Ask genuinely ships** — the subtitle is editable on any new version.
>
> **The binary now agrees (2026-09-22).** The sign-in screen used to open on the brand
> tagline, making in the app the claim this listing avoids. It now reads "Everything your
> chapter needs is already in chat." ([#2298](https://github.com/pdcarlson/Frapp/issues/2298)),
> and the app draws no Ask entry for a member without Ask ([#2259](https://github.com/pdcarlson/Frapp/issues/2259)).
> The copy lives in [`spec/ui/design-system/writing.md`](../../../spec/ui/design-system/writing.md)
> § 7, Sign in. When Ask ships, move the listing subtitle and the sign-in line together.

**Paste this** (App Store Connect and Play Console, entered by the owner on 2026-11-05):

```text
Frapp is where your chapter runs day to day.

Announcements, channels, events, study hours, points, dues and the member directory all live in one app, so nobody has to dig through six group chats to find out what's going on.

For members:
- Chat in chapter channels and direct messages
- See what's coming up and check in at events with a QR code
- Log study hours inside your chapter's study zones
- Log service hours and track your points and house rank
- See your dues and payment history
- Look up anyone in the member directory

For officers:
- Take attendance at the door with a QR code
- Assign a task to any member
- Post announcements that reach every member

Bigger setup jobs like roles, dues, service hour approvals, channels and points are handled on the web dashboard.

Members join by invite. Your officers send you a link, you open it on your phone, and you're in.

Notifications are yours to control, with quiet hours built in.
```

> **Rewritten 2026-11-05 at the owner's request** so it reads like a person wrote it, with no
> em dashes. It makes the same claims as the earlier text below, plus one: "Log service
> hours", which the member's Service hours log sheet does
> (`components/service-hours/log-hours-sheet.tsx`). The earlier text and its notes stay
> because the notes are the evidence that each claim holds in the binary (Guideline 2.3).
> Check a new claim against them before you add it.

**Before 2026-11-05** the listing read:

Frapp is the app your chapter actually runs on.

Members get one place for the things that used to live in six group chats: chapter announcements and channels, upcoming events with a check-in code at the door, study hours tracked inside your chapter's study zones, points and your house rank, dues and payment history, and the member directory.

> **Narrowed 2026-09-22 ([#2304](https://github.com/pdcarlson/Frapp/issues/2304)).** This
> sentence read "study hours that count toward chapter goals". No study goal or requirement
> exists anywhere in the schema (`components/study/week-summary.tsx` says so in its header),
> so the clause now says what the Study tab does, in its own subtitle's words. Study time
> does earn points, per zone (`minutes_per_point`), and the next item already covers points.
> *2026-11-04 ([#3023](https://github.com/pdcarlson/Frapp/issues/3023)):* that subtitle
> ("Tracked sessions inside your chapter's study zones.") is gone. The clause still holds on
> what the tab does: a session starts only inside one of the chapter's study zones, picked
> from the tab's zone sheet (`app/(app)/study.tsx`, `components/study/zone-picker-sheet.tsx`).

Officers get what they need on their feet: take attendance at the door with a QR code, assign a task to any member, and post an announcement every member gets. Setting the chapter up — roles and permissions, dues and who has paid, service-hour approvals, channels and points — is on the web dashboard.

> **Rewritten 2026-09-21; every verb re-verified against the binary (Guideline 2.3), and four of the six did not survive.** The sentence also gained one the old list never claimed: an officer holding `tasks:manage` gets a "New task" header action on the Tasks tab (`tasks.tsx`) opening `components/tasks/new-task-sheet.tsx`, which assigns to any roster member. `tasks:manage` is not in the seeded Member role, so it is genuinely officer-only — and a sentence that said "the two things" was wrong by one.
> The old sentence read "invite members with a link, assign roles and permissions, post to the right channel, take attendance by QR code, track service and study hours, and see who has paid". Verdicts, each confirmed by an independent adversarial pass:
>
> | Old claim | Verdict | Evidence |
> | --- | --- | --- |
> | take attendance by QR code | **ships on iOS** | `app/(app)/host-check-in.tsx`, reached from the "Host check-in" tile in `more.tsx` and gated `events:update` |
> | post to the right channel | **partly ships — kept, reworded** | An officer holding `announcements:post` gets a live composer in the read-only `#announcements` channel, and that send fans an URGENT push chapter-wide: `chat-thread.tsx` `canSend={canSend && channelCanPost}` off the server's `can_post`. But **creating or organising channels is web-only** (`useCreateChannel`'s only consumer is `apps/web/components/chat-admin/`), so "the right channel" overclaimed. Now "post an announcement every member gets" |
> | invite members with a link | **partial — dropped** | `useCreateInvite` has exactly one consumer in `apps/mobile`, the one-time founding wizard (`app/(auth)/create-chapter.tsx`), reachable only while the account belongs to **zero** chapters. An officer of an existing chapter has no invite affordance, the role is hardcoded `Member`, and the link points at the web app. Invites are already covered honestly by the invite-only paragraph below |
> | assign roles and permissions | **web only** | `components/directory/member-detail-sheet.tsx` renders a read-only `Role` value row; no mutation is imported. The editor is `apps/web/components/roles/` |
> | track service and study hours | **web only** | *Corrected 2026-11-11 (#3897): the next binary has an approve control. An officer holding `service:approve` approves or rejects a pending entry from the Activity sheet (`components/activity/activity-sheet.tsx`, `useReviewServiceEntry`). The listing text is unchanged, pending Paul; what follows is the 2026-09-21 record.* No approve control on iOS — Service hours' log sheet (`components/service-hours/log-hours-sheet.tsx`) holds its only two mutations, `useCreateServiceEntry` and the proof photo's `useRequestServiceProofUploadUrl`, neither of which approves anything, and `approve_service_entry`'s single non-test caller is reached from the web page. Officer-wide *study* tracking exists nowhere: `study.controller.ts`'s list has no admin branch at all |
> | see who has paid | **web only** | Both mobile `useInvoices` call sites pass the viewer's id, and `selectInvoiceRows` filters to it. The chapter ledger is `apps/web/components/billing/invoice-list.tsx` |
>
> Two in-app strings were fixed in the same pass for the same reason, and a bug behind one of them: the Service hours tile promised review and approval, the invite-failure message sent officers to a directory with no invite affordance, and `GET /v1/service-entries` was read unscoped — which handed a `service:approve` holder the whole chapter's entries under a screen that says "you've logged". `lib/more/service-hours-screen.spec.tsx` and `lib/more/profile-screen.spec.tsx` pin the fix.

Frapp is invite-only. Your chapter's officers create the chapter on the web and send you an invite link; open it on your phone and you are in.

> **Changed 2026-11-05, in both consoles** (Play first, then App Store Connect the same day). This read "Frapp is invite-only. Your chapter's officers create the chapter on the web
> and send you an invite link". Neither half holds: the app has its own create-chapter flow
> (`app/(auth)/create-chapter.tsx`, the founding wizard, reached from the join screen's "I'm starting
> our chapter" and from More), and `POST /v1/chapters/onboard` needs only a signed-in account, so a
> founder needs no invite. What is invite-only is joining an existing chapter.

Features
- Chapter channels and direct messages your chapter has started
- Events with QR check-in and attendance
- Study hours with chapter study zones
- Points, house rank and service hours
- Dues, invoices and payment history
- Member directory with roles
- Push notifications you control, with quiet hours

> **Two bullets were narrowed 2026-09-21, because the wider version was not true of the
> iOS binary (Guideline 2.3).** "direct messages" → "direct messages your chapter has
> started": a member can read and reply in an existing DM, but **nothing in the iOS app
> can start one** — the DIRECT section is hidden entirely when the list is empty
> (`app/(app)/(tabs)/index.tsx`), and the one mobile call of `useGetOrCreateDm` (before #2773,
> below) reopens a DM the member hid, from the Hidden conversations group: it passes the other member of a
> DM row the list already returned, so `findDm` matches the existing pair rather than
> creating one. *(Corrected 2026-09-25, #2303: this used to say the hook's only consumer
> was the web dashboard.)* `frapp-prod` has **0** DM channels, so a reviewer would have
> found neither the feature nor a way to produce it. "leaderboards" → "house rank": the
> leaderboard *routes* were deleted and what survives is the viewer's own rank tile
> ("House rank #N of M", composed in `components/tasks/points-summary-card.tsx` from the
> `{rank, of}` that `lib/tasks/points-card.ts` selects); the leaderboard list is web-only.
> The officer paragraph is reconciled as of 2026-09-21 — see the verdict table under it.
> (This note used to say the opposite and to hold the paste pending #2304; it was written
> before that work was done and quoted two verbs the paragraph no longer contains.)
>
> **Added 2026-09-28: #2773 changes the first bullet's premise.** Its directory Message
> action, a second mobile call of `useGetOrCreateDm`, starts a DM
> (`POST /v1/channels/dm`, get-or-create), so a binary built from `main` after #2773
> merged *can* start one; the "nothing in the iOS app can start one" above describes
> builds before it. The narrowed bullet stays true either way but undersells such a
> build: widen it back to "direct messages" only for a submitted build that contains
> #2773.
>
> **Widened 2026-11-05.** The 0.9.1 store builds (EAS iOS build 8 and Android build 3, both from
> `cca52dec` per their EAS build records) contain #2773, as does Android build 2 (`ea9bc12`): the directory's
> Message action (`components/directory/member-detail-sheet.tsx`) starts a DM. So the bullet now
> reads "Chapter channels and direct messages", on Play and in App Store Connect, both
> entered by the owner on 2026-11-05.

## Keywords (iOS, 100 chars)

fraternity,sorority,greek life,dues,attendance,study hours,service hours,events,points,officers

> **Changed 2026-11-05** (95 characters). "chapter" was dropped because it's already in the
> listing name, and Apple indexes name words for search on its own, so repeating it in the
> keywords wastes characters. "members" made room for "service hours" and "points". Before:
> `fraternity,sorority,chapter,greek life,dues,attendance,study hours,events,members,officers`.

## What's new (first release)

First release.

## Seed the reviewer's chapter

The review notes below promise a reviewer four things a fresh demo account cannot see.
A reviewer who follows the notes and finds nothing files it as the app not working, so
this is a prerequisite list, not a polish list. **All four, and the no-invoice row, are
what `scripts/demo/seed-demo.mjs --reviewer` seeds** ([`demo-data.md` § Seed a hosted
project](../../../docs/guides/demo-data.md#seed-a-hosted-project)), **and each one inverts
a count in § Identity's production reading**. Re-run that query afterwards rather than
trusting either place. The last row is the inverse: a state to
leave alone, kept here because it is the one dues decision a submitter must not undo.
The work itself is tracked on the issues named; this table exists because nothing else
states what a reviewer will actually be shown.

| The notes say | Do before submitting |
| --- | --- |
| A reviewer account that can sign in | The App Review login already exists in `frapp-prod`, carries the seed's namespace marker, and has the password entered in App Store Connect (#2309, done 2026-09-24), so don't run `seed-demo.mjs auth` again unless `verify` rejects that password. On the day of submission, seed: the seed makes that login, and only a login `auth` created or marked, the president of the demo chapter (namespace `a9900000`), and `verify` proves the sign-in lands there. Give App Review its email and password. Do not plan on an invite: 24h hardcoded, single-use, no override. The seed sets `subscription_status` `active`, without which paid-ops **writes** are refused (#2297) — reads are exempt (`chapter.guard.ts` returns early for `GET`/`HEAD`/`OPTIONS`), so every screen still loads |
| Location confirms "inside a chapter study zone" | Seeded: the chapter carries study zones at fixed coordinates on its campus in Akron, Ohio, and the reviewer has past sessions in them (the required `pglite-migrations` CI check asserts both). A reviewer anywhere else is told the device is outside a zone when starting one, which is the check working; § Review notes says so, so it does not read as broken. Zone creation is web-dashboard-only, so it cannot be done from the app being reviewed |
| "direct messages" (was "direct messages your chapter has started" until 2026-11-05) | Seeded by `--reviewer`: one DM from the chapter's treasurer into the reviewer's account. The DIRECT section is hidden entirely when the list is empty. Starting a new DM from the directory's Message action needs another real member in the roster, which the seeded chapter has |
| "Long-press any message from another member to report it or block them" | Seeded: #general and the chapter's other public channels carry ordinary text messages from other members, and `--reviewer` adds the treasurer's in the reviewer's DM, so a long-press in #general offers Block. The required `pglite-migrations` CI check goes red, blocking the merge, if #general has no such message left. A reseed or a hand edit must keep at least one such message, **from another real member of the seeded chapter**, in a channel the reviewer can read. The system actor's posts — the welcome post, the audit bridge — offer Report only, never Block (it is unblockable by design), and the reviewer's own messages offer nothing, so a chapter whose only chat is system posts cannot show Guideline 1.2's block control at all. Any real member's message offers Block, including one from a member who joined after the app loaded its roster; the only other member it is withheld for is one a block attempt already proved has left the chapter. It inverts the `chat_messages` count in § Identity |
| *(nothing — the dues sentence was dropped 2026-09-21)* | **Leave the reviewer with no invoices at all**, which `--reviewer` does. Zero rows is the only state that shows them nothing about payments — no Pay control and no Stripe footer; § Review notes owns the mechanics and is the copy to keep current. **Nothing to undo:** the ledger is viewer-scoped, so the 2 OPEN invoices in § Identity's production reading belong to the two pre-existing auth users and are invisible to the reviewer. **Do not void or delete those** — they are live beta-chapter billing. If a populated ledger is wanted anyway, insert a **PAID** row directly in SQL — never through the API, where `DRAFT → OPEN` is the only route to PAID and writes a persisted "New Invoice" notification deep-linked to the Dues tab (`financial-invoice.service.ts`). That fallback surfaces the Stripe footer, leaves the balance at $0.00, and inverts § Identity's invoice count — re-run that query too |

## Review notes (App Store Connect → App Review Information)

- Members join a chapter by invite. **Give App Review an email and password for a seeded account that is already a member of a chapter — never an invite token.** Put them in the Sign-In Required fields, not prose. Invites cannot work here: `prepareInviteData` hardcodes `expiresAt.setHours(+24)` and `redeem` throws `GoneException` on `used_at` or on a past `expires_at`, with no override parameter anywhere — so a token is dead before a first review answers and certainly dead on a re-review. (Corrected 2026-09-21; this bullet used to hand over a token, and every earlier note about "minting one whose expiry outlasts review" was describing something the API cannot do.)
- The account signs in as the president of a fictional demo chapter. On first sign-in the app asks the account to agree to the Terms of Service and Privacy Policy, which forbid objectionable content and abusive users; tick the box and continue. Worth trying: Chat (the chapter's channels, the officer composer in #announcements, and a direct message from the chapter's treasurer), Events, Tasks (including New task), and under More: Documents (open one), Directory, Service hours, Study hours, and Profile for points. Study hours lists past sessions; a new one starts only inside one of the chapter's study zones, and the demo chapter's zones are on its campus in Ohio, so elsewhere the app will say the device is outside a zone. These parts of running a chapter are on the web dashboard, not in this app: roles and permissions, dues and who has paid, service-hour approvals, channels, points, and study zones.
  > **Submitter note, not for the paste (2026-09-23, #2308).** Every screen named above
  > was checked against the binary (tabs in `app/(app)/(tabs)/_layout.tsx`, More in
  > `more.tsx`, the announcements composer and New task per § Description's verdicts)
  > and against the `--reviewer` seed: each one has the reviewer's own rows, since
  > Service hours, Study hours and Dues show the viewer's history only. **Dues is left
  > out** because the seed gives the reviewer no invoices on purpose (§ Seed the
  > reviewer's chapter), so it reads "You have no invoices.". The web-only list is § Description's
  > own sentence plus study zones. **Host check-in is deliberately left out too.** Its QR code needs `EVENT_CHECK_IN_TOKEN_SECRET` on the
  > production API; unset, the screen says the feature is not configured
  > ([`ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md)). Staging
  > has it, and production was not readable from the session that wrote this. Confirm it
  > in Infisical `prod` before adding Host check-in to the list.
- From 0.11.0 an `https://app.frapp.live/join?token=…` invite link opens this app (universal links, #4002), but only once the web serves the app-link files in production, and the reviewer is handed credentials, not an invite, so the review notes describe no link opening the app. If a reviewer ever does need to redeem by hand, the join screen accepts a bare token or a full `https://app.frapp.live/join?token=…` pasted link and extracts the token from either; that is a fallback, not the route to describe.
- **Report and block (Guideline 1.2).** Tell App Review where they are: "Long-press any message from another member and choose Report message; the report form and the Report sent screen offer Block <name>. Settings → Blocked members lists and removes blocks." A member's profile in the directory also has Block / Unblock. Then state how objectionable content is handled, because 1.2 also asks about filtering: "Members must agree to Terms of Service with zero tolerance for objectionable content and abusive users; the app asks before they reach anything else. Members can report any message and block any member. Chapter officers review reports from the web dashboard and can remove the reported message, including in a direct message." Do not claim a pre-post content filter: there is none ([`spec/behavior/chat/README.md` § No pre-post content filter](../../../spec/behavior/chat/README.md#no-pre-post-content-filter)).
  *Not for the note itself:*
  - Report and block are true only of a binary built from `main` after the #2257 member-side change merged.
  - Block needs the message § Seed the reviewer's chapter asks for, because a system post offers Report only.
  - **Run Deploy production (landing, API and web) before submitting; there is no version of this answer to paste without it.** Two of its three sentences describe code that production didn't carry when this was written (2026-09-28: the API and landing both ran `7e47ec55`, built 2026-09-17). The zero-tolerance clause and the acceptance prompt are #2302 (§ Open before submitting, #2261). The officer queue is Chat Admin's Reported messages section and its remove route (#2311, #2492). After the deploy, check that https://frapp.live/terms carries the zero-tolerance clause and that the section renders on `app.frapp.live`. The same applies to the reviewer-account bullet above, whose Terms sentence describes the same clause.
  - The reviewer's account is the demo chapter's president, so it can open that queue, but only on web; the app itself has no report-review screen, so do not describe one.
- Camera is used only to scan a chapter's event check-in QR code. Location is used only while the app is open, to confirm the member is inside a chapter study zone or at the event being checked in to; there is no background location.
- Sign in with Apple and Sign in with Google are offered on the sign-in screen (Guideline 4.8: Apple is required once Google is offered). Password and magic-link remain. **Tell App Review to sign in with the email and password supplied above (on the sign-in screen, tap Continue with email first) — and smoke-test that exact route on the TestFlight build first.** No sign-in from a store build has been exercised against `frapp-prod` yet, and its demo chapter is seeded only on the day of submission (#2309 readied the login on 2026-09-24), and [#2334](https://github.com/pdcarlson/Frapp/issues/2334) records that the Apple button can abort the app outright on the sign-in screen. An OAuth identity joins the seeded account **only when its email matches the seeded address** (GoTrue Automatic linking, [`deployment/supabase.md`](../../../docs/ops/deployment/supabase.md)); a reviewer who signs in with their own Apple or Google account — or with Hide My Email, whose relay address can never match — becomes a *new* user in no chapter. That is not a blank app: `resolveAuthGate` routes a member-less account to the **join** screen, which asks whether they have an invite (they were never given one) or are starting a chapter, and a chapter founded there is `incomplete`, which refuses paid-ops **writes** (#2297) while every screen still loads. Do not plan to rescue that with an invite — the first bullet's arithmetic holds here too: a token minted mid-review is usually dead before the reply lands. (Corrected 2026-09-22; this clause used to end "a reviewer still joins with the invite token after signing in". That is a real member's route — `redeem` binds whoever is signed in rather than matching the invite email, which is why the sign-in screen's Hide My Email promise is correct — and it is simply not the reviewer's, who is handed credentials rather than an invite. Do not delete that hint on the strength of this note.)
- No in-app purchases and no digital goods. **The app takes no payment of any kind.** `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is not set in the EAS `production` environment ([#2415](https://github.com/pdcarlson/Frapp/issues/2415)), so `isStripeAvailable()` is false and PaymentSheet never opens. Do not tell App Review the app takes dues by card, and do not argue guideline 3.1.5 from it — the beta chapter is not collecting dues by card (decided 2026-09-21). **That decision is the only thing making the two sentences above true, and reversing it needs no repo change** — `eas env:set` reaches the bundle server-side. If the key ever ships, this bullet and § Identity's Price row become false statements to App Review: change both in the same sitting as the privacy rows below. Chapter *subscriptions* to Frapp itself are bought on the web dashboard and are not offered, linked or mentioned in the app.
  > **Seed no OPEN invoice for the reviewer and the question never arises.** Recorded
  > 2026-09-21, when the dues sentence came out of this note. What follows is the part
  > worth keeping: the code does not behave the way "no card payments" makes it sound.
  >
  > **A reviewer with an open invoice sees a *disabled* Pay button, not a missing one.**
  > `app/(app)/dues.tsx` gates the control's *existence* on there being an open invoice
  > (`payLabel={target ? "Pay now" : null}`) and only its *enablement* on the key
  > (`disabledReason`); `components/dues/balance-card.tsx` then
  > renders "Pay now" at half opacity, captioned "Card payments aren't switched on for
  > this build yet. Ask your treasurer how to pay this invoice." That is the design
  > system's §5 disable-and-name-the-reason rule. `balance-card.spec.tsx` pins the
  > shape of it — disabled, reason as `accessibilityHint`, reason rendered as text — but
  > with the Expo Go sentence, not this one; **no test asserts this caption, the half
  > opacity, or the `dues.tsx` wiring above.** Re-read the code, not CI, before trusting
  > this paragraph.
  > [`ENV_REFERENCE.md` § apps/mobile](../../../docs/internal/environment/ENV_REFERENCE.md#appsmobile-expo--eas)
  > states the same behaviour and is its other home — move the two together.
  > It is inert rather than dead — the `Pressable` gets `disabled` and
  > `accessibilityState={{ disabled, busy: isPaying }}`, so it cannot be tapped into a
  > failure — but it
  > is still a control a reviewer can see and ask about. That is a Guideline 2.1
  > conversation nobody needs, and it is avoidable, which is why § Seed the reviewer's
  > chapter says to leave them no open invoice.
  >
  > **Only an open invoice produces it.** `target` comes from `selectNextDueInvoice`,
  > which reads open rows only, so a reviewer with none — or with PAID ones only — gets
  > no Pay control at all and a card reading "You're all paid up". A reviewer with no
  > invoices whatsoever gets the "You have no invoices." line.
  >
  > **Where the tab is not silent about Stripe.** Once the reviewer's *own* ledger has at
  > least one row and it has loaded, `dues.tsx` footers "Payments run through your
  > chapter's Stripe account." That is trust copy, not a purchase path: it names no
  > price, offers no control, and the build cannot take a payment behind it. With the
  > empty ledger § Seed the reviewer's chapter asks for, the reviewer never sees it — so
  > do not pre-emptively explain copy they will not be shown.
  >
  > **Do not re-derive any of this from `eas.json`.** No profile in
  > [`apps/mobile/eas.json`](../eas.json) sets `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, but
  > that does not establish the key is absent from a build: every profile declares
  > `"environment"`, so a server-side `eas env:set --environment production` reaches the
  > bundle with no repo change, which is exactly how `EXPO_PUBLIC_SENTRY_DSN` and
  > `EXPO_PUBLIC_POSTHOG_KEY` already arrive. The key's absence is an observation about
  > the EAS environment, recorded in
  > [#2415](https://github.com/pdcarlson/Frapp/issues/2415) (owner's `env:list`,
  > 2026-09-18): `production` holds both Supabase values, the Sentry DSN, the PostHog
  > key and `SENTRY_AUTH_TOKEN`, and **no** Stripe key. That `production` is otherwise
  > provisioned is what keeps the TestFlight screenshot route (#938) open while
  > `preview` is empty. Nothing in this repo can see any of it, so re-read #2415 rather
  > than `eas.json` before trusting this paragraph.

## Privacy questionnaire answers

Same facts as https://frapp.live/privacy. The photo-library row was the one place the
two agreed *and were both wrong* — the policy described collection the binary could not
perform after #2296 removed the picker. #2464 rebuilt that capability for real (chat
photo upload), so the table's row is correct again and its strike is gone. The policy
then named a profile-photo picker iOS did not have, so #2305 narrowed it to chat photos
on 2026-09-22. #2897 built that picker on 2026-09-29, and #2895 named both uses again
on 2026-09-30 (live after the next Deploy production). The row's footnote has the
detail. The table below is **what was declared
in App Store Connect on 2026-09-14**, in Apple's own data-type names — the console
offers a fixed list, so this is the paste, not a paraphrase. A struck row is an
answer since withdrawn: the recorded values stay as entered, and the footnote says
what still has to change where.

| Apple data type | Purpose(s) | Linked | Tracking |
| --- | --- | --- | --- |
| Contact Info → Name | App Functionality | Yes | No |
| Contact Info → Email Address | App Functionality | Yes | No |
| Contact Info → Phone Number | App Functionality | Yes | No |
| Location → Precise Location | App Functionality | Yes | No |
| User Content → Photos or Videos † | App Functionality | Yes | No |
| User Content → Other User Content | App Functionality | Yes | No |
| Identifiers → User ID | App Functionality, **Analytics** | Yes | No |
| Identifiers → Device ID | App Functionality | Yes | No |
| Usage Data → Product Interaction | **Analytics** | Yes | No |
| Diagnostics → Crash Data ‡ | App Functionality | No | No |
| Diagnostics → Performance Data ‡ | App Functionality | No | No |

Declared **not** collected: all Financial Info (including Payment Info),
Purchases, Sensitive Info, Contacts, Health & Fitness, Emails or Text Messages,
Advertising Data, Browsing History, Search History.

> † **Withdrawn, then reinstated — verify the console still carries it before
> submitting (owner action).** This row has been right, wrong, and right again, and
> the values were never edited in App Store Connect, so what to do now depends on
> what is actually in the console.
>
> The arc: entered 2026-09-14 on the strength of `expo-image-picker`'s declaration,
> which no source file ever imported. #2296 removed the package and its purpose
> string outright, at which point the console claimed a collection the binary could
> not perform, and this row was struck pending an owner correction (#2196 §4). #2464
> then built the surface the picker was always for — photo upload in chat
> (`lib/chat/attachment-upload.ts`) — so the app now genuinely does read the photo
> library and upload what the member picks. The declaration is accurate again and the
> strike is removed.
>
> **What this means in practice.** If nobody cleared the answer, the console is now
> correct by accident and no change is needed — confirm it reads as above and move on.
> If it *was* cleared in the window between #2296 and #2464, it must be re-added
> before the build that carries photo upload ships, or the label under-declares. Either
> way this is a console check nothing in CI can see, which is why the line stays.
>
> **#2305 left this row in place (2026-09-22).** Its acceptance criterion 3 asked for
> the row to be "removed, or set to not-collected", on the premise that the binary
> could not upload. #2464 falsified that premise. So the fix narrowed the privacy
> policy's clause to chat photos instead, and this answer stands.
>
> **Profile photos use this row too (#2895, 2026-09-30).** #2897 added a profile-photo
> picker to s15 (`lib/more/profile-photo.ts`, through the same `pickAndUploadImage`
> chat uses). A profile photo is a *Photos or Videos* item collected for *App
> Functionality* and linked to the member, so the row's values don't change and no
> new row is needed. What changed is the purpose string and the policy clause, both
> fixed in the repo. Per the owner's decision on #2895 (2026-09-29), the owner
> re-enters this row in App Store Connect before the build that carries #2897 is
> submitted, with the values above.
>
> **The chapter logo uses this row too (#3351, 2026-11-04).** Chapter setup's live
> step lets the officer who created the chapter pick a logo from the library
> (`lib/onboarding/chapter-wizard/chapter-logo.ts`, the same pipeline). It is the
> chapter's image rather than the member's, but the upload is still a *Photos or
> Videos* item collected for *App Functionality*, so the row's values don't change.
> The purpose string and the privacy policy's permissions clause both name it. The
> owner ruled the policy edit non-material on 2026-11-04 ([#3395](https://github.com/pdcarlson/Frapp/issues/3395)),
> so it moved only the page's pin and nobody is asked to accept again. Deploy the
> landing before submitting a binary that carries #3351.
>
> **Document photos use this row too (#3399, 2026-11-04).** s12's upload sheet (s21)
> lets a member holding `chapter_docs:upload` add a photo from the library to the
> chapter's documents (`lib/more/document-upload.ts`, the same pipeline). It is filed in
> the chapter's library rather than kept as the member's, but it is still a *Photos or
> Videos* item collected for *App Functionality*, so the row's values don't change. The
> privacy policy's permissions clause names it; the owner ruled that edit non-material
> on 2026-11-04, so it moved only the page's pin and nobody is asked to accept again.
> The iOS purpose string names it from the 0.9.1 store build on (widened 2026-11-05).
> Deploy the landing before submitting a binary that carries #3399.
>
> **Service-hour proof photos use this row too (2026-11-05).** s20's "Add photo proof"
> row lets a member attach a library photo to a service entry
> (`lib/more/service-proof.ts`, the same pipeline). It is a *Photos or Videos* item
> collected for *App Functionality* and linked to the member, so the row's values don't
> change. The privacy policy's permissions clause (`apps/landing/app/privacy/page.tsx`)
> names it, as #3399's did for documents, and on that precedent the edit moved only
> the page's pin. Whether that edit is material, and what each ruling does:
> [`legal.md` § Acceptance record](../../../spec/behavior/legal.md#acceptance-record).
> The iOS purpose string (`app.json`'s `photosPermission`) names it from the 0.9.1 store
> build on (widened 2026-11-05, split out of
> [#3401](https://github.com/pdcarlson/Frapp/issues/3401), which keeps the Files picker). Deploy the
> landing before submitting a binary that carries s20's photo row.
>
> ‡ **`Linked: No` on Crash Data and Performance Data is wrong, and this table's own
> reasoning is what proves it (owner action — console change).** Found 2026-09-21. The
> argument for calling User ID *linked* is that `distinct_id` is a pseudonym whose salt
> we hold. That same pseudonym is handed to Sentry as the user id:
> `lib/observability-identity-provider.tsx` passes `Sentry.setUser`, the scrubber's
> `/^[0-9a-f]{64}$/` gate exists precisely to let that value through, and
> `lib/sentry/options.ts` documents it as "the one identifier that *does* survive".
> So crash and performance events carry the same identifier, and under Apple's rules
> both rows are **Linked: Yes**. The two answers cannot both be right, and an internal
> contradiction in the privacy answers is the kind of thing a 5.1.2 review picks up.
> Change both rows **in App Store Connect**. As with the † row, the `No` values stay as
> written in the table above, because this table is the record of what was entered on
> 2026-09-14 — the `‡` marks them as answers to correct in the console, not values to
> edit here. Nothing in CI can see the console, so this footnote is the only reminder.
>
> **Done: the console reads Linked: Yes on both (checked 2026-11-05).** The owner's
> screenshots of App Privacy that day show all eleven data types in the table above, each
> linked to the user, and its product page preview has only a "Data Linked to You" section,
> so nothing is declared as tracking. Crash Data and Performance Data are both
> App Functionality, linked. Photos or Videos (†) is still declared.

Where each answer comes from:

- **Phone Number** — chapters can define a member field of type `phone`
  (`CustomFieldTypeSchema` in `packages/validation/src/index.ts`). There is no
  address field type, which is why **Physical Address** is not declared.
- **Other User Content** — chat messages **and chat photo attachments**. Apple's
  "Emails or Text Messages" type is not used; in-app chat belongs here.
  The iOS binary now does upload: #2464 shipped the chat photo picker
  (`lib/chat/attachment-upload.ts`), so a member's photo goes from the library
  to the chat bucket from the phone. That is also what reinstated the
  Photos or Videos row above — read its footnote before touching either.
  Documents now upload from the phone too, photos only (#3399): s12's sheet
  sends a library photo to the documents bucket, and that photo is declared
  under the Photos or Videos row above. A PDF or Office file still uploads only
  from the web dashboard, since picking one needs `expo-document-picker`, a
  native module no store build carries yet. Service-hour proof uploads from
  the phone too, photos only: the s20 sheet's "Add photo proof" row sends a
  library photo to the service bucket, declared under the same row. Backwork
  has no mobile screen, so it stays web-dashboard-only and is not claimed here
  as shipped.
- **User ID carries Analytics** because PostHog identifies members with
  `distinct_id = hmac_sha256(salt, user_id)`. The derivation lives in
  `hashUserIdForAnalytics` (`apps/api/src/domain/utils/analytics-keying.ts`), called from
  `apps/api/src/application/services/analytics.service.ts`; it is server-side because
  the salt is API-only. `packages/observability/src/correlation.ts` only *names* the
  shape and states that clients never compute it — this file used to cite it as the
  implementation, which it is not. Pseudonymous, but we hold the salt, so Apple counts
  it as linked.
- **Product Interaction is Analytics only**, not App Functionality — nothing in the
  product depends on it. Be precise about what emits it, because "it is PostHog" was
  wrong on both halves: the client path is `POST /v1/analytics/events` via
  `lib/analytics-provider.tsx`. Since 2026-11-06 (#3164) the client sends named
  events through it from two places: chat's outbox lifecycle (`outbox-*`, attempt
  counts and timings) and the push prompt's answer (`push-prompt-answered`), all
  content-free ([`observability.md` § Outbox
  Telemetry](../../../spec/behavior/observability.md#outbox-telemetry), [§ Push
  Prompt Telemetry](../../../spec/behavior/observability.md#push-prompt-telemetry)).
  The PostHog RN SDK (key present in
  `production` per #2415) sends `$identify`, `$groupidentify`,
  `$feature_flag_called` and, since #3382, one `$screen` per route visit (named by
  route template, never an id) plus the app lifecycle events
  (`captureAppLifecycleEvents` is on: Installed, Updated, Opened, Became Active,
  Backgrounded), all keyed to the same pseudonym and none while the chapter is opted
  out. There is still no autocapture. So the row is justified by **server-side**
  feature events, those client named events, **and** the SDK's screen and lifecycle
  events, all Analytics only; the declared category does not change ([`observability.md` § Route
  views](../../../spec/behavior/observability.md#route-views)).
- **Crash and Performance Data** are Sentry. What switches Sentry on is
  `EXPO_PUBLIC_SENTRY_DSN`, **not** the `EXPO_PUBLIC_SENTRY_ENVIRONMENT` that `eas.json`
  sets: `app/_layout.tsx` calls `Sentry.init` only inside `if (sentryDsn)`, and the
  environment tag merely labels events that a DSN-less build never sends. Per #2415 the
  DSN **is** set in the EAS `production` environment, so both rows are real for a store
  build, and tracing is genuinely on (`tracesSampleRate` in `lib/sentry/options.ts`, `1` during
  the beta per [`observability.md` §
  Sampling](../../../spec/behavior/observability.md#sampling)), so Performance Data is not an over-declaration either.
  This bullet used to end "and are the only two rows that are **not** linked" — that was
  wrong; see the ‡ footnote.
- **Payment Info is deliberately absent**, and the basis is #2415's `env:list`, not a
  read of `eas.json`. `@stripe/stripe-react-native` is a shipped dependency and
  PaymentSheet is fully wired end to end (the API's `POST /v1/invoices/{id}/payment-intent`
  exists and settles through webhooks); the only dark part is the key. The beta chapter
  is not collecting dues by card (decided 2026-09-21), so this row is right for the build
  being submitted and § Review notes no longer argues anything that depends on it. It is
  still a conditional rather than a settled fact: the key can be switched on from the EAS
  dashboard with no repo change and nothing in CI able to notice, and **the moment it
  ships this row is false** — declare Financial Info → Payment Info in the same sitting.
- **Search History is declared not collected, which turns on a retention question
  nobody has answered.** Two free-text boxes in the binary send the typed query to our
  own API — the directory (`GET /v1/members/search`) and the chapter finder
  (`GET /v1/chapter-directory/search`). Neither reaches PostHog (no client capture at all)
  or Sentry: query strings are cut from request breadcrumbs as they are recorded, so a
  native crash report, which never passes the JS scrubber, doesn't carry them either
  ([`observability.md` § Error Tracking](../../../spec/behavior/observability.md#error-tracking),
  #3104). So the only way this becomes "collected" is if the API retains query strings in
  access logs. Confirm that it does not, or declare the row.
- **Purchases is declared not collected** although the Dues tab renders the member's
  invoice ledger and payment history. The answer that engages Apple's definition is that
  what the ledger records are real-world membership dues owed to the member's own
  chapter, not purchases made in the app — the type is about purchase-history *data*, so
  "the build takes no payment" is a weaker second point, not the lead. **This row and
  Payment Info above turn on the same fact and change together:** if the Stripe key ever
  ships, revisit both in the same sitting.
- **Tracking is No on all eleven.** Apple's definition is linking app data with
  third-party data for targeted advertising or measurement, or sharing with a data
  broker. There are no ad SDKs, and PostHog and Sentry are first-party processors,
  not brokers. A single Yes would require an ATT prompt, which the app does not
  implement.

## Google Play answers

What Play Console asks under **Policy and programs → App content** before any release, including
the Data safety form. These are the answers to enter. The developer account exists, and the app
`live.frapp.mobile` was created in it on 2026-10-09
([#2556](https://github.com/pdcarlson/Frapp/issues/2556)). **The owner entered every App content
answer below, Data safety included, on 2026-11-05**; what was entered, and where it differs from
this file, is on [#2720](https://github.com/pdcarlson/Frapp/issues/2720). Written
2026-09-27 for [#2557](https://github.com/pdcarlson/Frapp/issues/2557). Where an answer rests on a
Play rule, the rule comes from search-result snippets of Play Console Help, because
support.google.com is blocked from the cloud sandbox. Those answers carry *(rule unverified)*: check
the console's own help text as you enter them, and fix this file where it disagrees.

The facts are the same ones the App Store table above rests on, read against Play's definitions.
Two of Play's definitions differ from Apple's, and they change answers:

- **Anything sent off the device counts as collected**, even if it's never stored. Play then asks
  whether it's *processed ephemerally* (held in memory only for the request) *(rule unverified)*.
  So search queries are collected here, though the App Store table declares Search History not
  collected.
- **Transfers to a service provider are not *sharing*** *(rule unverified)*. Supabase, Render,
  Sentry, PostHog, and Expo's push service with Firebase Cloud Messaging process data for us. What a
  member posts reaching other members of their chapter is a transfer the member starts, which Play
  also doesn't count as sharing. So every row reads **Shared: No**, and no data goes to advertisers
  or brokers.

### Data safety: data types

| Play category → type | Collected | Ephemeral | Required or optional | Purposes | On account deletion | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| Location → Precise location | Yes | **Yes** | Optional | App functionality | Nothing stored to delete | `lib/location.ts` sends lat/lng with each check-in and study heartbeat (`attendance.controller.ts`, `study.controller.ts`). The API tests it against the zone and stores no coordinates: `event_attendance` and `study_sessions` have no location columns. Optional because it sits behind the location permission, and the rest of the app works without it. No member ever sees another member's location |
| Personal info → Name | Yes | No | Required | App functionality, Account management | Scrubbed | The member profile |
| Personal info → Email address | Yes | No | Required | App functionality, Account management | Scrubbed | Sign-in |
| Personal info → Phone number | Yes | No | Optional | App functionality | Deleted | A chapter's `phone` member field, as in the App Store row |
| Personal info → User IDs | Yes | No | Required | App functionality, Analytics | Kept as an anonymous tombstone; the analytics id is forgotten | Member and account ids; the pseudonymous analytics `distinct_id` (see *User ID carries Analytics* above) |
| Messages → Other in-app messages | Yes | No | Optional | App functionality | **Kept, anonymised** | Chat channels and DMs |
| Photos and videos → Photos | Yes | No | Optional | App functionality | **Mixed**: chat photos and service-hour proof photos are kept, anonymised, with their messages and entries; the profile photo is deleted; a chapter logo and document photos stay with the chapter | Chat photo attachments (`lib/chat/attachment-upload.ts`), kept with their messages; a photo a member attaches as proof to a service-hour entry (s20, `lib/more/service-proof.ts`), kept in the private service bucket with its entry: deleting a pending entry deletes its photo, but account deletion keeps the entry, anonymised, and its photo with it, since the deletion purge reaches only profile photos and generated reports ([`data-retention.md`](../../../spec/behavior/data-retention.md#individual-account-deletion); whether it should reach proof is [#3425](https://github.com/pdcarlson/Frapp/issues/3425)) (a photo uploaded for an entry that never saved stays unclaimed until [#2197](https://github.com/pdcarlson/Frapp/issues/2197)'s sweep); the chapter logo an officer adds in chapter setup (`lib/onboarding/chapter-wizard/chapter-logo.ts`, #3351), which belongs to the chapter and stays until an officer replaces or removes it; a photo a member holding `chapter_docs:upload` adds to the chapter's documents (`lib/more/document-upload.ts`, #3399), which is filed in the chapter's library and stays, attributed to "Deleted User" after its uploader's account is deleted, until an officer deletes the document; and the member's profile photo (`lib/more/profile-photo.ts`, #2897), deleted when it is replaced or removed (best effort: a failed delete there is logged, not retried), when the member leaves the chapter, and on account deletion ([`data-retention.md`](../../../spec/behavior/data-retention.md#individual-account-deletion)). The camera only reads check-in codes on the device, and no frame leaves the phone. The owner entered this row in Play's Data safety form as written here, profile photo included, on 2026-11-05 (#2720, #2895) |
| App activity → App interactions | Yes | No | Required | Analytics | Forgotten (the analytics forget) | The server-side product events behind the App Store *Product Interaction* row, the client's named `outbox-*` and `push-prompt-answered` events (#3164), plus the SDK's `$screen` route views and app lifecycle events (#3382). Required because the only opt-out is a chapter setting, not the member's choice |
| App activity → In-app search history | Yes | **Yes** | Optional | App functionality | Nothing stored to delete | The directory and chapter-finder queries (`GET /v1/members/search`, `GET /v1/chapter-directory/search`). Ephemeral only while the App Store table's open question holds: if the API keeps query strings in its access logs, this answer is No |
| App activity → Other user-generated content | Yes | No | Optional | App functionality | **Kept, anonymised** | Free text a member writes outside chat: service-hour entries, tasks they create, the details of a report they file (kept whole, as moderation history), and a chapter they create |
| App activity → Other actions | Yes | No | Optional | App functionality | **Mixed**: event check-ins, task completions, poll votes and reactions are kept, anonymised; the Terms acceptance stays on the anonymised account record; study sessions, settings, notification preferences, read markers and the member's own blocks are deleted | Event check-ins (`event_attendance`), study sessions (`study_sessions`), task completions, poll votes, reactions, blocks, settings and notification preferences, read markers, and the Terms acceptance |
| App info and performance → Crash logs | Yes | No | Required | App functionality | Not deleted with the account; aged out by Sentry's retention | Sentry, when the build has `EXPO_PUBLIC_SENTRY_DSN` (EAS `production` does, per #2415) |
| App info and performance → Diagnostics | Yes | No | Required | App functionality | As Crash logs | Sentry tracing (`tracesSampleRate` in `lib/sentry/options.ts`; the rate is in [`observability.md` § Sampling](../../../spec/behavior/observability.md#sampling)) |
| Device or other IDs | Yes | No | Optional | App functionality | Deleted | The Expo push token (`lib/notifications/push.ts`). Optional because it sits behind the notification permission |

**On account deletion** is what `DELETE /v1/users/me` does to each type, and
[`data-retention.md` § Individual Account Deletion](../../../spec/behavior/data-retention.md#individual-account-deletion)
owns the rules. *Kept, anonymised* means the record stays for the chapter's history under "Deleted
User": the account's name, email and profile are scrubbed, and the record no longer points at a
person. What members wrote isn't rewritten, though. A message that mentions the member by name
keeps it, a report filed about them keeps a snapshot of their words, and a kept chat photo can
still show them. That's why the deletion answer below is "request deletion", not "all data is
deleted".

**Not collected:** Approximate location (the location permission grants coarse and fine together,
but only precise fixes are sent, so declare only Precise *(rule unverified)*), Financial info (every
type), Health and fitness, Emails, SMS or MMS, Videos, Audio files, Files and docs, Calendar,
Contacts, Installed apps, Web browsing, and the remaining Personal info types.

- **Files and docs:** the documents screen uploads photos only, declared under Photos (#3399). A
  PDF or Office document, a PDF service-hour proof, and backwork still upload only from the web
  dashboard (see *Other User Content* above).
- **Financial info is conditional, as on iOS.** Payment info and Purchase history are *not
  collected* only while EAS `production` has no Stripe key. If the key ships, re-answer both in
  the same sitting as the App Store *Payment Info* and *Purchases* rows.

### Data safety: security practices

| Question | Answer |
| --- | --- |
| Is all user data encrypted in transit? | **Yes.** Every endpoint the binary calls is HTTPS: `api.frapp.live`, Supabase, Sentry, PostHog and Expo |
| Do you provide a way for users to request that their data is deleted? | **Yes.** In the app: More → Settings → Delete account, or Delete account in the join screen's Account menu or on the Terms prompt. On the web dashboard: My Profile → Delete account. Anyone who can't sign in can email team@frapp.live. What deletion keeps, anonymised, is in the table's *On account deletion* column |
| Delete account URL | `https://frapp.live/support`; § 4 of that page describes all three routes. Play wants this page to name the app as the listing does *(rule unverified)*. It says Frapp on `main` since ADR-25 step 5 ([#2580](https://github.com/pdcarlson/Frapp/issues/2580)); enter this URL only after that's live on production |
| Independent security review | No |
| Families policy | Not applicable. The app isn't in the Families program, and its target audience is adults (§ Android-specific) |

### App content declarations

| Declaration | Answer |
| --- | --- |
| Privacy policy | `https://frapp.live/privacy` |
| App access | **All or some functionality is restricted.** Give the same login App Review gets, with the same caveats: § Seed the reviewer's chapter and § Review notes. The login exists in `frapp-prod` (#2309); seed its chapter before this submission too, since the seed goes stale |
| Ads | **No ads.** There is no ad SDK |
| Advertising ID | **No, the app doesn't use the advertising ID.** Nothing in `apps/mobile` reads it, and PostHog and Sentry identify members by the pseudonymous id instead. **Before entering this, confirm the first AAB's merged manifest has no `com.google.android.gms.permission.AD_ID`** ([#2720](https://github.com/pdcarlson/Frapp/issues/2720) tracks it): `bundletool dump manifest --bundle <the .aab>`, then search the output for `AD_ID`. Play checks the declaration against the manifest *(rule unverified)*. A static walk on 2026-09-27 found it in none of the Maven Central artifacts the native modules pull in (Stripe, Sentry, the image cropper, ShortcutBadger) or in any module's own manifest. It could not open the Google-hosted ones (`firebase-messaging`, `play-services-location`, `installreferrer`, and ML Kit and code-scanner from `expo-camera`), because the sandbox can't reach Google's Maven. If the AAB has it, don't answer Yes: add it to `expo.android.blockedPermissions` in `app.json` and rebuild. The same walk found no `READ_MEDIA_*` permission, so the photo-and-video permissions declaration shouldn't apply. `expo-location` does declare a `LocationTaskService` with `foregroundServiceType="location"`, but the app requests no `FOREGROUND_SERVICE*` permission, because background location is off in `app.json`. Whether Play Console still asks for a foreground-service declaration because of that service is unverified; #2720 records what it asks. **Checked 2026-11-05 and declared No:** Play Console's App bundle explorer lists 36 permissions for bundle 2 (0.9.0), with no `AD_ID` and no `FOREGROUND_SERVICE*`; `BIND_GET_INSTALL_REFERRER_SERVICE` is the install referrer, not the advertising ID. Bundle 3 (0.9.1, EAS Android build 3 from `cca52dec`, still building when this was written) changes the native layer in two ways: it adds `expo-haptics`, which declares only `VIBRATE`, and it moves `@sentry/react-native` from 8.28 to 8.33. Neither is known to add `AD_ID`, but that is derived from the dependency diff, not read from the bundle: recheck the same view for bundle 3 and every bundle after it |
| Content rating | Answer the IARC questionnaire with these inputs. **Users interact or communicate: yes** (channel chat, DMs and photo sharing, with member-level report and block, #2257). **Shares the user's location with other users: no** (location reaches our API only, as above). **Digital purchases: no. Unrestricted internet access: no.** Violence, sexual content, profanity, drugs and gambling: **none in the app's own content.** Whatever members post is user-generated, which the interaction answer covers. The rating is whatever the questionnaire issues; record it in § Identity ([#2720](https://github.com/pdcarlson/Frapp/issues/2720)) |
| Target audience and content | The target audience § Android-specific declares, which owns the answer and the reasons not to change it |
| News app | No |
| Government app | No |
| Financial features | **The app provides no financial features.** It shows a member the dues their chapter bills them, and no payment can be taken while EAS `production` has no Stripe key. The same conditional as the Financial info row: revisit if the key ships |
| Health apps | No health features. Study hours are an academic record |

## Android-specific

- Track for the first upload: **internal** (`eas.json` `submit.production.android.track`), then closed testing → production. A new personal developer account must run a closed test with at least 12 testers for 14 days before production is unlocked.
- Target audience: 18 and over (college students); not designed for children.

> **Read this next to § Identity, which declares iOS 13+ and an Android content rating
> of Everyone.** These are three separate declarations answering three separate
> questions, so "Everyone" beside an 18-and-over target audience is not self-evidently a
> contradiction, and this file asserts no cross-store consistency rule it can cite.
> **Do not "simplify" them to one number, and in particular do not lower the Android
> target audience on the strength of anything here.** This file cites no Play policy for
> what a lower target audience would require, and the 18-and-over declaration has not
> been re-examined since member-level report and block were added. What is verified is
> only what the app does: those controls exist in a binary built from `main` after the
> #2257 member-side change merged (long-press Report, with Block on the report form; Settings → Blocked
> members), and officers act on a filed report from the web dashboard's queue (#2311).
> Re-examining the audience is a decision with its own research, not a side
> effect of editing this note.
>
> The reasoning actually on record is in § Age rating: 13+ was chosen over the calculated
> 4+ **because** of the DMs-without-report-or-block situation and a college audience, and
> 18+ was rejected for two reasons, one of them Apple-specific. #2261 was settled on
> 2026-09-23: the Terms say 18 or older, which agrees with this target audience, and the
> owner kept the iOS rating at 13+ (§ Age rating). Leave the three declarations as they
> are.

## Shipped builds and the API contract

Every install keeps the API calls its binary was built with until its owner updates from the store,
so CI holds each pull request to the contract of every build that has shipped (#2619).
[`shipped-builds.json`](shipped-builds.json) lists those builds, and the required
`api-contract-check` job fails any PR whose `apps/api/openapi.json` breaks the contract at a listed
commit (`npm run check:api-breaking:shipped`). While the list is empty the check passes and says it
compared against nothing. Why it blocks, and how it fails:
[`quality-gates.md` § Two comparisons, two postures](../../../docs/ci-cd/quality-gates.md#two-comparisons-two-postures).

**Record a build when it is first uploaded to TestFlight or a Play track**, before any tester can
install it, in a PR that adds one entry per build. When **Deploy production** submits the build
(its `mobile_build` input), its `record` job opens that PR for you as soon as EAS accepts the
submission, while Expo may still be uploading it
([`mobile.md` § 6.6](../../../docs/ops/deployment/mobile.md#66-store-submission)). If that PR's
`api-contract-check` fails, `main` already breaks the build just uploaded: fix it on `main` before
the next production ship, or waive the route as below. A build uploaded by hand is recorded by
hand:

```json
{ "platform": "ios", "version": "0.9.0", "build": "12", "sha": "<40-character commit SHA>", "recorded": "2026-10-01" }
```

- `platform` is `ios` or `android`. `version` is the store version and `build` the native build
  number, as a string: the `<version>+<build>` the binary sends in `X-Client-Version`
  ([`spec/ui/mobile/patterns.md` § Minimum version](../../../spec/ui/mobile/patterns.md#minimum-version)).
- `sha` is the full commit the build was made from. Build store binaries from the latest `v*`
  tag, the commit production serves, never from `main`'s tip: a binary newer than production
  calls routes production doesn't serve yet. That commit is on `main`, which the check needs: CI
  reads the contract with `git show <sha>:apps/api/openapi.json`, and a SHA it can't read fails
  the check rather than being skipped.
- An iOS and an Android build from the same commit are two entries, and are compared once.

The newest entry per platform is also what each deploy's client check asks the API about
([`ci-cd.md` § Deploy verification](../../../docs/ops/deployment/ci-cd.md#deploy-verification)): a
production minimum above it fails the deploy, so record a build before raising the minimum to it.

**Drop an entry only once production's minimum for its platform is above it**, that is,
`MOBILE_MIN_VERSION_IOS` or `MOBILE_MIN_VERSION_ANDROID` on `frapp-api-prod` names a later build
([`ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md) § API-Only Settings), so
every install of it is held at the update gate until its owner updates. Until then the build is
still calling the API, whatever the stores show. The one exception is an entry for a build that
never reached a store: Deploy production records a build once EAS accepts its submission, and its
`confirm` job goes red when the upload then fails (#3483). No install of that build exists, and
keeping its entry would make each deploy's client check ask about a build nobody runs, so drop it
at once.

**To drop an entry, move it from `builds` to a top-level `dropped` list**, unchanged, adding the
date and the reason: the minimum and the date it went live, or the run whose upload failed. No
contract is compared against a dropped build, and no deploy probes it; the list is the record of
every drop, so it only grows too: CI fails a PR that removes a `dropped` entry or changes its
`dropped` date (its `reason` may be reworded). Its version's `mobile-vX.Y.Z` tag never
moves, but the Mobile release tags workflow rewrites that version's GitHub Release to list only the
builds still in `builds`, as it did when an entry was deleted.

```json
"dropped": [
  { "platform": "ios", "version": "0.9.1", "build": "8", "sha": "<40-character commit SHA>", "recorded": "2026-11-05", "dropped": "2026-12-01", "reason": "MOBILE_MIN_VERSION_IOS 0.10.0 live since 2026-11-30" }
]
```

**The registry only grows, and CI holds it to that (#3783).** On a pull request,
`api-contract-check` also fails when an entry the base branch has in `builds` is missing, or has a
different `platform`, `version`, `build`, `sha` or `recorded`, unless it moved to `dropped`. A
`note` may change. It also fails a key repeated inside one entry, which `JSON.parse` would resolve
by silently keeping one value: that is how a bad conflict resolution splices two builds into one
(`5df56abc`). Two record PRs always conflict, because each appends to the same array, so the
[PR base sync](../../../docs/ci-cd/pr-babysitting.md#base-branch-sync-scriptscipr-base-syncmjs) sweep
merges `main` into a conflicted PR itself when the registry is the only file it changes and it only
adds entries. Any other conflict still gets the usual wake comment, as does one whose merge GitHub
refuses, and is resolved by hand the same way: `main`'s registry plus the branch's new entries, and
nothing else.

**A break the shipped binaries don't depend on** (a route only the web dashboard calls) is waived
in [`api-breaking-ignore.txt`](api-breaking-ignore.txt), which the check hands to oasdiff's
`--err-ignore`. Each entry is one line holding `METHOD /path` and oasdiff's change text as the
failing run printed it, for example `POST /v1/chapters api path removed without deprecation`. Lines
starting with `#` are comments: the check removes them before oasdiff reads the file, because oasdiff
itself has no comment syntax and would still honour a commented-out entry. Put the evidence on a
comment line above the entry: that no listed SHA's `apps/mobile`, or a package it bundles, calls the
route (`git grep '<path>' <sha> -- apps/mobile packages`). Delete an entry once the check passes
without it.

**Lower-severity changes don't block.** The check fails on oasdiff's error level: a removed route, a
removed required response field, a parameter made required. A removed *optional* response field is
a warning: the generated SDK already types it as possibly absent, so the binary compiles against its
absence, but it may still lose whatever the field fed. The run prints each one as a `::warning::`;
read them before merging.
