# Store listing — App Store and Google Play

The text and answers the two store consoles ask for, kept next to the app so
they are reviewed like code. Nothing here is read by a build; it is what a human
pastes into App Store Connect and the Play Console when creating the listing
(build and EAS environment procedure:
[`docs/internal/ops/deployment/mobile.md`](../../../docs/internal/ops/deployment/mobile.md)
§ 6 — note that it covers `eas` setup only and says nothing about screenshots, listing
fields or submission, so there is no written capture procedure to follow). **Screenshots are not committed and none exist — App Store Connect does not
accept a submission without them**, and the documented route to them is itself blocked:
the EAS `preview` environment holds only `SENTRY_AUTH_TOKEN`
([#2415](https://github.com/pdcarlson/Frapp/issues/2415)), so a preview build installs
and then reports sign-in unavailable, because `getSupabaseClient()` returns `null`
without `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY`. Nothing fences `preview` the way
[`app.config.js`](../app.config.js) fences `production`, so that build fails at the
sign-in screen rather than at build time. Provision `preview` (#2415) and shoot from an
internal build, or shoot from TestFlight off the production binary (#938).

**Display name vs listing name — they differ, deliberately.** Chrome (home
screen, iOS Settings) is **Signet**, which comes from `expo.name` in
[`apps/mobile/app.json`](../app.json) and is what the icon reads on a phone. The
App Store **listing** name is **`Signet: Chapter Hub`**. That is a separate field
and it had to differ: `Signet` alone is already on the App Store (app id
`1483581287`, live in US/GB/BE/JP, alongside Signet Signing, Signet App and
Signet SIMS), and listing names are globally unique and claimed at record
creation — typing `Signet` is rejected. Bundle id (`live.frapp.mobile`), slug,
scheme, and every public URL stay **frapp** until the deferred rename. USPTO
remains on #1829 / #1901 — this file is the listing paste, not the trademark
search.

## Identity

| Field | Value |
| --- | --- |
| Name (App Store listing, 30 chars) | Signet: Chapter Hub |
| Display name (home screen, from `expo.name`) | Signet |
| Subtitle (iOS, 30 chars) / Short description (Android, 80 chars) | Your chapter, in one place |
| Bundle id / package | `live.frapp.mobile` |
| Category | Productivity (primary); Social Networking (secondary, iOS) |
| Age rating | **13+** (iOS) / Everyone (Android). See § Age rating below — 13+ is a deliberate override of the 4+ the questionnaire calculated. |
| Price | Free (chapters subscribe on the web dashboard. The app has no in-app purchases, and no payment can be taken in the app at all — card payments are not switched on for this build. **Basis: no Stripe key in the EAS `production` environment, per #2415's `env:list` of 2026-09-18. Re-run `eas env:list --environment production` against the build you actually submit before pasting this.** See § Review notes.) |
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
> `AllExceptionsFilter` drops `code` (#1020). That is the one prose-coupled contract in
> the window: it holds only while those refusal strings are byte-identical, which today
> they are. Reword a `chapter.guard.ts` message and deploy the API alone and the store
> binary stops recognizing a subscription refusal.
>
> `frapp-prod` migrations are **current** — its applied list ends at the same
> `20260915210100` the repo does (83 files; the old "81" was stale) — and it already
> carries `chat_reports_and_blocks`, so the Guideline 1.2 **write** path is deployed.
> That narrows #2257 to client work but does not close it: nothing anywhere reads
> `/v1/chat/reports`, including the web dashboard, and 1.2 requires acting on a report,
> not only accepting it — so an officer review surface is still owed. (`mcp__Render__list_deploys`
> on `srv-d6lqu41aae7s73f62df0`; `mcp__Supabase__list_migrations` on
> `unttyvyfezddlyafcydh`.) **Re-check again before submitting**; a 200 on `/health` says
> the service is up, not that it matches the app.
>
> **Superseded, kept as the provenance of the Resend gap (2026-09-14):** production then
> served `0ca478e` (2026-09-08), ~160 commits behind `main`, with 76 of the repo's 81
> migrations, and had no Resend key — the deployed commit was titled *"fix: do not claim
> invite email was sent when production has no Resend key"*. The Resend gap was **not**
> re-verified on 2026-09-21; it is owned by
> [`ENV_REFERENCE.md`](../../../docs/internal/environment/ENV_REFERENCE.md). It does not
> affect a reviewer, who is handed a token directly rather than emailed one.
>
> **What `frapp-prod` held on 2026-09-21:** 2 chapters, 7 member rows but only 2 auth
> users, 2 invites, 3 invoices of which 2 are OPEN, 5 events, 11 chat messages, 0 DM
> channels and 0 study zones. Produced with `mcp__Supabase__execute_sql` on
> `unttyvyfezddlyafcydh` — `select count(*)` over `chapters`, `members`, `auth.users`,
> `invites`, `financial_invoices` (total and `where status = 'OPEN'`), `events`,
> `chat_messages`, `chat_channels where type in ('DM','GROUP_DM')` and `study_geofences`.
> **These invert as soon as § Seed the reviewer's chapter is acted on — re-run the query
> rather than trusting the figures.** Three review notes below describe things a reviewer
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
true — Signet targets US Greek life. It was **not** a claim of non-trader status:
Signet charges $149/chapter/month ([`spec/behavior/billing.md`](../../../spec/behavior/billing.md)),
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
similar discovery method that visibly spreads content to many users." Signet has
no followers, no discovery and no resharing, and the activity feed has no client
surface at all (see the surface note at the top of
[`spec/behavior/activity-feed.md`](../../../spec/behavior/activity-feed.md)).

**Contests = None** despite points and leaderboards: Apple's descriptor means
prize competitions and sweepstakes. [`spec/behavior/points.md`](../../../spec/behavior/points.md)
has only `MANUAL` (reward) and `FINE` (penalty) adjustments plus task point
rewards — no prizes, entries or winners.

**Why 13+ rather than the calculated 4+:** the app ships chapter channels and
direct messages with no member-level report or block, and its real audience is
college students. 18+ was rejected because Apple reads it as mature content and
[`apps/landing/app/terms/page.tsx`](../../landing/app/terms/page.tsx) carries no
minimum-age clause to back it.

### Open before submitting

Found while completing the console on 2026-09-14. None blocked creating the
record; each is a review-time or launch risk.

| # | Risk |
| --- | --- |
| [#2257](https://github.com/pdcarlson/Frapp/issues/2257) | Guideline 1.2 — no member-level report or block, with DMs shipping |
| [#2258](https://github.com/pdcarlson/Frapp/issues/2258) | Guideline 5.2 — Backwork's v1 posture (**decision, not work**) |
| [#2259](https://github.com/pdcarlson/Frapp/issues/2259) | Guideline 2.1 — the ✦ Ask pill renders with Ask switched off |
| ~~[#2260](https://github.com/pdcarlson/Frapp/issues/2260)~~ | Closed 2026-09-18 — answered ("it is not set"), superseded by #2415 |
| [#2261](https://github.com/pdcarlson/Frapp/issues/2261) | Terms of Service carries no minimum-age clause |
| ~~[#2262](https://github.com/pdcarlson/Frapp/issues/2262)~~ | Fixed in the repo 2026-09-22: the FERPA notice no longer points at a redaction tool. Live only after the next Deploy production |

The rows above are what completing the console surfaced. These came from reading the
binary and the live providers on 2026-09-21, and the rows marked **hard gate** are gates rather than risks —
App Store Connect will not take the submission at all. Each links the issue that owns
the work; the detail lives there, not here.

| # | Risk | Kind |
| --- | --- | --- |
| [#2454](https://github.com/pdcarlson/Frapp/issues/2454) | **No screenshots exist**, and the preview route to them is blocked by #2415 (see the note at the top of this file). Filed 2026-09-21 because the gate's only tracker was #2196 §4, and #2196 was closed as completed with every box unticked | hard gate |
| [#2415](https://github.com/pdcarlson/Frapp/issues/2415) | EAS `preview` holds only `SENTRY_AUTH_TOKEN` — owns the screenshot route. Its other half, no Stripe key in `production`, stopped gating submission on 2026-09-21: this listing no longer claims card payments, so that key is a product decision rather than a blocker | hard gate |
| [#2195](https://github.com/pdcarlson/Frapp/issues/2195) | Apple Developer trader status (EU DSA) — **probably already done, and only needs confirming.** #2195 was filed 2026-09-13 off a banner reading "Developers must provide their trader status to submit new apps", which gates submission itself rather than only EU availability. The dialog it sends you to *is* the trader-status dialog, and § As submitted records answering it the next day, 2026-09-14, on the "I don't plan to distribute in the EU" limb. So the action has very likely been taken and the issue is stale. Confirm the banner is gone from the Apps page and close #2195; do not re-answer the dialog, because re-picking is how you end up declaring trader and publishing a home address on an EU listing | confirm, then close |
| [#2308](https://github.com/pdcarlson/Frapp/issues/2308) / [#2309](https://github.com/pdcarlson/Frapp/issues/2309) | No App Review demo user exists in `frapp-prod`; the demo seed is Docker-only. The reviewer cannot sign in | hard gate |
| [#2257](https://github.com/pdcarlson/Frapp/issues/2257) | Guideline 1.2 (restated as a blocker, not a risk): API and production DB ship report/block, **no client consumes either** | blocker |
| [#2305](https://github.com/pdcarlson/Frapp/issues/2305) | **Fixed in the repo 2026-09-22; live only after the next Deploy production.** The policy's photo-library clause read "choose a profile photo or attach an image", and the iOS app has no profile-photo picker, so it now names chat photos only. Resend (sign-in and invite email) and the two hosts, Render and Vercel, were added to § Service Providers. Both stores fetch the live URL, so deploy the landing before submitting | 5.1.2 |
| [#2298](https://github.com/pdcarlson/Frapp/issues/2298) / [#2301](https://github.com/pdcarlson/Frapp/issues/2301) | Sign-in tagline advertises Ask; the `sheet-demo` dev route ships and is reachable via `frapp://sheet-demo`. (The two permanently inert controls, [#2300](https://github.com/pdcarlson/Frapp/issues/2300), were removed 2026-09-22.) | 2.1 |
| [#2334](https://github.com/pdcarlson/Frapp/issues/2334) | **Smoke-test Sign in with Apple on the TestFlight build before submitting.** At the pinned `expo-apple-authentication ~57.0.2` a nil `keyWindow` reaches an uncatchable Swift `fatalError`, i.e. a SIGTRAP abort on the sign-in screen with the browser-OAuth fallback unreachable — and no live Apple sign-in has ever been observed against `frapp-prod`. The unit suite gives **zero** signal because it never loads the native module. A crash on the first screen a reviewer touches outranks the 4.8 question it also raises | 4.8 + crash |

## Description

> Deliberately omits Ask. [`spec/ui/brand-identity.md`](../../../spec/ui/brand-identity.md)
> gives the tagline as "Ask your chapter anything." and positions Signet as the
> AI-first operating system for Greek life, but Ask is gated behind
> `EXPO_PUBLIC_ASK_ENABLED` (default off, and set by no `eas.json` profile — but see the
> dues note below on why that is *not* proof it is off in a build: only
> `eas env:list --environment production` settles it) and answers
> from a hand-written table in `apps/mobile/lib/ask/corpus.ts`. Store metadata that
> advertised it would be inaccurate under Guideline 2.3. **Use the tagline as the
> subtitle once Ask genuinely ships** — the subtitle is editable on any new version.

Signet is the app your chapter actually runs on.

Members get one place for the things that used to live in six group chats: chapter announcements and channels, upcoming events with a check-in code at the door, study hours tracked inside your chapter's study zones, points and your house rank, dues and payment history, and the member directory.

> **Narrowed 2026-09-22 ([#2304](https://github.com/pdcarlson/Frapp/issues/2304)).** This
> sentence read "study hours that count toward chapter goals". No study goal or requirement
> exists anywhere in the schema (`components/study/week-summary.tsx` says so in its header),
> so the clause now says what the Study tab does, in its own subtitle's words. Study time
> does earn points, per zone (`minutes_per_point`), and the next item already covers points.

Officers get what they need on their feet: take attendance at the door with a QR code, assign a task to any member, and post an announcement every member gets. Setting the chapter up — roles and permissions, dues and who has paid, service-hour approvals, channels and points — is on the web dashboard.

> **Rewritten 2026-09-21; every verb re-verified against the binary (Guideline 2.3), and four of the six did not survive.** The sentence also gained one the old list never claimed: an officer holding `tasks:manage` gets a "New task" header action on the Tasks tab (`tasks.tsx`) opening `components/tasks/new-task-sheet.tsx`, which assigns to any roster member. `tasks:manage` is not in the seeded Member role, so it is genuinely officer-only — and a sentence that said "the two things" was wrong by one.
> The old sentence read "invite members with a link, assign roles and permissions, post to the right channel, take attendance by QR code, track service and study hours, and see who has paid". Verdicts, each confirmed by an independent adversarial pass:
>
> | Old claim | Verdict | Evidence |
> | --- | --- | --- |
> | take attendance by QR code | **ships on iOS** | `app/(tabs)/host-check-in.tsx`, reached from the "Host check-in" tile in `more.tsx` and gated `events:update` |
> | post to the right channel | **partly ships — kept, reworded** | An officer holding `announcements:post` gets a live composer in the read-only `#announcements` channel, and that send fans an URGENT push chapter-wide: `chat-thread.tsx` `canSend={canSend && channelCanPost}` off the server's `can_post`. But **creating or organising channels is web-only** (`useCreateChannel`'s only consumer is `apps/web/components/chat-admin/`), so "the right channel" overclaimed. Now "post an announcement every member gets" |
> | invite members with a link | **partial — dropped** | `useCreateInvite` has exactly one consumer in `apps/mobile`, the one-time founding wizard (`app/(auth)/create-chapter.tsx`), reachable only while the account belongs to **zero** chapters. An officer of an existing chapter has no invite affordance, the role is hardcoded `Member`, and the link points at the web app. Invites are already covered honestly by the invite-only paragraph below |
> | assign roles and permissions | **web only** | `components/directory/member-detail-sheet.tsx` renders a read-only `Role` value row; no mutation is imported. The editor is `apps/web/components/roles/` |
> | track service and study hours | **web only** | No approve control on iOS — `service-hours.tsx`'s only mutation is `useCreateServiceEntry`, and `approve_service_entry`'s single non-test caller is reached from the web page. Officer-wide *study* tracking exists nowhere: `study.controller.ts`'s list has no admin branch at all |
> | see who has paid | **web only** | Both mobile `useInvoices` call sites pass the viewer's id, and `selectInvoiceRows` filters to it. The chapter ledger is `apps/web/components/billing/invoice-list.tsx` |
>
> Two in-app strings were fixed in the same pass for the same reason, and a bug behind one of them: the Service hours tile promised review and approval, the invite-failure message sent officers to a directory with no invite affordance, and `GET /v1/service-entries` was read unscoped — which handed a `service:approve` holder the whole chapter's entries under a screen that says "you've logged". `lib/more/service-entry-scoping.spec.ts` pins the fix.

Signet is invite-only. Your chapter's officers create the chapter on the web and send you an invite link; open it on your phone and you are in.

Features
- Chapter channels, and direct messages your chapter has started
- Events with QR check-in and attendance
- Study hours with chapter study zones
- Points, house rank and service hours
- Dues, invoices and payment history
- Member directory with roles
- Push notifications you control, with quiet hours

> **Two bullets were narrowed 2026-09-21, because the wider version was not true of the
> iOS binary (Guideline 2.3).** "direct messages" → "direct messages your chapter has
> started": a member can read and reply in an existing DM, but **nothing in the iOS app
> can start one** — `useGetOrCreateDm` has exactly one consumer repo-wide and it is the
> web dashboard, and the DIRECT section is hidden entirely when the list is empty
> (`app/(tabs)/index.tsx`). `frapp-prod` has **0** DM channels, so a reviewer would have
> found neither the feature nor a way to produce it. "leaderboards" → "house rank": the
> leaderboard *routes* were deleted and what survives is the viewer's own rank tile
> ("House rank #N of M", composed in `components/tasks/points-summary-card.tsx` from the
> `{rank, of}` that `lib/tasks/points-card.ts` selects); the leaderboard list is web-only.
> The officer paragraph is reconciled as of 2026-09-21 — see the verdict table under it.
> (This note used to say the opposite and to hold the paste pending #2304; it was written
> before that work was done and quoted two verbs the paragraph no longer contains.)

## Keywords (iOS, 100 chars)

fraternity,sorority,chapter,greek life,dues,attendance,study hours,events,members,officers

## What's new (first release)

First release.

## Seed the reviewer's chapter

The review notes below promise a reviewer three things a fresh demo account cannot see.
A reviewer who follows the notes and finds nothing files it as the app not working, so
this is a prerequisite list, not a polish list. **Each of those three is a seeding step,
and each one inverts a count in § Identity's production reading** — re-run that query
afterwards rather than trusting either place. The last row is the inverse: a state to
leave alone, kept here because it is the one dues decision a submitter must not undo.
The work itself is tracked on the issues named; this table exists because nothing else
states what a reviewer will actually be shown.

| The notes say | Do before submitting |
| --- | --- |
| A reviewer account that can sign in | Create the App Review demo user in `frapp-prod` (#2309), **already joined to the seeded chapter**, and give App Review its email and password. Do not plan on an invite: 24h hardcoded, single-use, no override. The seeded chapter also needs `subscription_status` `active`, or paid-ops **writes** are refused on three surfaces (#2297) — reads are exempt (`chapter.guard.ts` returns early for `GET`/`HEAD`/`OPTIONS`), so every screen still loads |
| Location confirms "inside a chapter study zone" | Add one study zone to the reviewer's chapter. Zone creation is web-dashboard-only, so it cannot be done from the app being reviewed |
| "direct messages your chapter has started" | Start one DM into the reviewer's account from the web dashboard; the DIRECT section is hidden entirely when the list is empty |
| *(nothing — the dues sentence was dropped 2026-09-21)* | **Leave the reviewer with no invoices at all.** Zero rows is the only state that shows them nothing about payments — no Pay control and no Stripe footer; § Review notes owns the mechanics and is the copy to keep current. **Nothing to undo:** the ledger is viewer-scoped, so the 2 OPEN invoices in § Identity's production reading belong to the two pre-existing auth users and are invisible to the reviewer. **Do not void or delete those** — they are live beta-chapter billing. If a populated ledger is wanted anyway, insert a **PAID** row directly in SQL — never through the API, where `DRAFT → OPEN` is the only route to PAID and writes a persisted "New Invoice" notification deep-linked to the Dues tab (`financial-invoice.service.ts`). That fallback surfaces the Stripe footer, leaves the balance at $0.00, and inverts § Identity's invoice count — re-run that query too |

## Review notes (App Store Connect → App Review Information)

- The app is invite-only. **Give App Review an email and password for a seeded account that is already a member of a chapter — never an invite token.** Put them in the Sign-In Required fields, not prose. Invites cannot work here: `prepareInviteData` hardcodes `expiresAt.setHours(+24)` and `redeem` throws `GoneException` on `used_at` or on a past `expires_at`, with no override parameter anywhere — so a token is dead before a first review answers and certainly dead on a re-review. (Corrected 2026-09-21; this bullet used to hand over a token, and every earlier note about "minting one whose expiry outlasts review" was describing something the API cannot do.)
- Universal links are not configured, so tapping an `https://` invite link opens the web app, not this app — do not describe any link as opening the app. If a reviewer ever does need to redeem by hand, the join screen accepts a bare token or a full `https://app.frapp.live/join?token=…` pasted link and extracts the token from either; that is a fallback, not the route to describe.
- Camera is used only to scan a chapter's event check-in QR code. Location is used only while the app is open, to confirm the member is inside a chapter study zone or at the event being checked in to; there is no background location.
- Sign in with Apple and Sign in with Google are offered on the sign-in screen (Guideline 4.8: Apple is required once Google is offered). Password and magic-link remain. **Tell App Review to sign in with the email and password supplied above — and smoke-test that exact route on the TestFlight build first.** No sign-in of any kind has been exercised against `frapp-prod`, which still has no demo user (#2309), and [#2334](https://github.com/pdcarlson/Frapp/issues/2334) records that the Apple button can abort the app outright on the sign-in screen. An OAuth identity joins the seeded account **only when its email matches the seeded address** (GoTrue Automatic linking, [`deployment/supabase.md`](../../../docs/internal/ops/deployment/supabase.md)); a reviewer who signs in with their own Apple or Google account — or with Hide My Email, whose relay address can never match — becomes a *new* user in no chapter. That is not a blank app: `resolveAuthGate` routes a member-less account to the **join** screen, which asks for an invite they were never given and offers *Create a chapter*, and a chapter founded there is `incomplete`, which refuses paid-ops **writes** on three surfaces (#2297) while every screen still loads. Do not plan to rescue that with an invite — the first bullet's arithmetic holds here too: a token minted mid-review is usually dead before the reply lands. (Corrected 2026-09-22; this clause used to end "a reviewer still joins with the invite token after signing in". That is a real member's route — `redeem` binds whoever is signed in rather than matching the invite email, which is why the sign-in screen's Hide My Email promise is correct — and it is simply not the reviewer's, who is handed credentials rather than an invite. Do not delete that hint on the strength of this note.)
- No in-app purchases and no digital goods. **The app takes no payment of any kind.** `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is not set in the EAS `production` environment ([#2415](https://github.com/pdcarlson/Frapp/issues/2415)), so `isStripeAvailable()` is false and PaymentSheet never opens. Do not tell App Review the app takes dues by card, and do not argue guideline 3.1.5 from it — the beta chapter is not collecting dues by card (decided 2026-09-21). **That decision is the only thing making the two sentences above true, and reversing it needs no repo change** — `eas env:set` reaches the bundle server-side. If the key ever ships, this bullet and § Identity's Price row become false statements to App Review: change both in the same sitting as the privacy rows below. Chapter *subscriptions* to Signet itself are bought on the web dashboard and are not offered, linked or mentioned in the app.
  > **Seed no OPEN invoice for the reviewer and the question never arises.** Recorded
  > 2026-09-21, when the dues sentence came out of this note. What follows is the part
  > worth keeping: the code does not behave the way "no card payments" makes it sound.
  >
  > **A reviewer with an open invoice sees a *disabled* Pay button, not a missing one.**
  > `app/(tabs)/dues.tsx` gates the control's *existence* on there being an open invoice
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
  > invoices whatsoever gets the "No dues yet" empty state.
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
still named a profile-photo picker iOS does not have, and #2305 narrowed it to chat
photos on 2026-09-22 (live after the next Deploy production). The row's footnote has
the detail. The table below is **what was declared
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
  Two upload surfaces are still web-dashboard-only and still omit their
  affordance deliberately: `app/(tabs)/documents.tsx` (backwork/document
  upload) and `app/(tabs)/service-hours.tsx` (proof attachment). Both could now
  be built on the same picker, and neither is claimed here as shipped.
- **User ID carries Analytics** because PostHog identifies members with
  `distinct_id = hmac_sha256(salt, user_id)`. The derivation lives in
  `hashUserIdForAnalytics` (`packages/validation/src/analytics.ts`), called from
  `apps/api/src/application/services/analytics.service.ts`; it is server-side because
  the salt is API-only. `packages/observability/src/correlation.ts` only *names* the
  shape and states that clients never compute it — this file used to cite it as the
  implementation, which it is not. Pseudonymous, but we hold the salt, so Apple counts
  it as linked.
- **Product Interaction is Analytics only**, not App Functionality — nothing in the
  product depends on it. Be precise about what emits it, because "it is PostHog" was
  wrong on both halves: the client path is `POST /v1/analytics/events` via
  `lib/analytics-provider.tsx`, **and no screen in the iOS binary calls it** —
  `AnalyticsContext` has no product consumer. The PostHog RN SDK (key present in
  `production` per #2415) sends only `$identify`, `$groupidentify` and
  `$feature_flag_called`: `captureAppLifecycleEvents` is false and there is no
  autocapture. So the row is justified by **server-side** events, not by client
  telemetry — keep it, but do not defend it with a mechanism the binary does not run.
- **Crash and Performance Data** are Sentry. What switches Sentry on is
  `EXPO_PUBLIC_SENTRY_DSN`, **not** the `EXPO_PUBLIC_SENTRY_ENVIRONMENT` that `eas.json`
  sets: `app/_layout.tsx` calls `Sentry.init` only inside `if (sentryDsn)`, and the
  environment tag merely labels events that a DSN-less build never sends. Per #2415 the
  DSN **is** set in the EAS `production` environment, so both rows are real for a store
  build, and tracing is genuinely on at `tracesSampleRate = 0.1`
  (`lib/sentry/options.ts`), so Performance Data is not an over-declaration either.
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
  (`GET /v1/chapter-directory/search`). Neither reaches Sentry (the scrubber strips query
  strings structurally and in free text) or PostHog (no client capture at all), so the
  only way this becomes "collected" is if the API retains query strings in access logs.
  Confirm that it does not, or declare the row.
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

Google Play Data safety: data is encrypted in transit; users delete in the app or dashboard (support page § 4), or by emailing team@frapp.live if they cannot sign in; no data shared with third parties for advertising; the developer is not enrolled in the Families program.

## Android-specific

- Track for the first upload: **internal** (`eas.json` `submit.production.android.track`), then closed testing → production. A new personal developer account must run a closed test with at least 12 testers for 14 days before production is unlocked.
- Target audience: 18 and over (college students); not designed for children.

> **Read this next to § Identity, which declares iOS 13+ and an Android content rating
> of Everyone.** These are three separate declarations answering three separate
> questions, so "Everyone" beside an 18-and-over target audience is not self-evidently a
> contradiction, and this file asserts no cross-store consistency rule it can cite.
> **Do not "simplify" them to one number, and in particular do not lower the Android
> target audience.** An under-18 target audience pulls in Play's families and
> child-safety policy set, which an app shipping chapter channels and DMs with no
> member-level report or block (#2257, still open) does not satisfy — a harder rejection
> than any listing untidiness.
>
> The reasoning actually on record is in § Age rating: 13+ was chosen over the calculated
> 4+ **because** of the DMs-without-report-or-block situation and a college audience, and
> 18+ was rejected for two reasons, one of them Apple-specific. The live item is #2261 —
> the Terms carry no minimum-age clause — and it is a blocker on *raising* the floor, not
> an input to be traded off. Settle #2261; leave the three declarations as they are
> unless it changes the answer.
