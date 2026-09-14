# Store listing — App Store and Google Play

The text and answers the two store consoles ask for, kept next to the app so
they are reviewed like code. Nothing here is read by a build; it is what a human
pastes into App Store Connect and the Play Console when creating the listing
(procedure: [`docs/internal/ops/deployment/mobile.md`](../../../docs/internal/ops/deployment/mobile.md)
§ Mobile). Screenshots are not committed — take them from a `preview` build on a
device once one exists (#938).

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
| Price | Free (chapters subscribe on the web dashboard. The app has no in-app purchases. The only payment in the app is a member paying their own chapter's dues by card, a real-world service.) |
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
> **That reading is dated, not current.** As of 2026-09-14 the production API is live
> but serving commit `0ca478e` (2026-09-08) — 160 commits behind `main` — and
> `frapp-prod` has 76 of the repo's 81 migrations
> (`mcp__Render__list_deploys` on `srv-d6lqu41aae7s73f62df0`;
> `mcp__Supabase__list_migrations` on `unttyvyfezddlyafcydh`). Production also has no
> Resend key, so invite emails do not send there — the commit currently deployed is
> titled "fix: do not claim invite email was sent when production has no Resend key".
> **Re-check before submitting**; a 200 on `/health` says the service is up, not that
> it matches the app.

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
| [#2260](https://github.com/pdcarlson/Frapp/issues/2260) | Confirm the Stripe publishable key is in the EAS production environment |
| [#2261](https://github.com/pdcarlson/Frapp/issues/2261) | Terms of Service carries no minimum-age clause |
| [#2262](https://github.com/pdcarlson/Frapp/issues/2262) | The FERPA notice cites a redaction feature that is not built |

## Description

> Deliberately omits Ask. [`spec/ui/brand-identity.md`](../../../spec/ui/brand-identity.md)
> gives the tagline as "Ask your chapter anything." and positions Signet as the
> AI-first operating system for Greek life, but Ask is gated behind
> `EXPO_PUBLIC_ASK_ENABLED` (default off, set by no `eas.json` profile) and answers
> from a hand-written table in `apps/mobile/lib/ask/corpus.ts`. Store metadata that
> advertised it would be inaccurate under Guideline 2.3. **Use the tagline as the
> subtitle once Ask genuinely ships** — the subtitle is editable on any new version.

Signet is the app your chapter actually runs on.

Members get one place for the things that used to live in six group chats: chapter announcements and channels, upcoming events with a check-in code at the door, study hours that count toward chapter goals, points and the leaderboard, dues and payment history, and the member directory.

Officers get the tools to run the chapter without a spreadsheet: invite members with a link, assign roles and permissions, post to the right channel, take attendance by QR code, track service and study hours, and see who has paid.

Signet is invite-only. Your chapter's officers create the chapter on the web and send you an invite link; open it on your phone and you are in.

Features
- Chapter channels and direct messages
- Events with QR check-in and attendance
- Study hours with chapter study zones
- Points, leaderboards and service hours
- Dues, invoices and payment history
- Member directory with roles
- Push notifications you control, with quiet hours

## Keywords (iOS, 100 chars)

fraternity,sorority,chapter,greek life,dues,attendance,study hours,events,members,officers

## What's new (first release)

First release.

## Review notes (App Store Connect → App Review Information)

- The app is invite-only. A reviewer account and a test chapter invite are provided in the Notes field at submission time. Give the reviewer the **invite token** (or the full `https://app.frapp.live/join?token=…` link to paste): the join screen accepts either and extracts the token from a pasted link. Universal links are not configured, so tapping an `https://` invite link opens the web app, not this app — do not describe the link as opening the app.
- Camera is used only to scan a chapter's event check-in QR code. Location is used only while the app is open, to confirm the member is inside a chapter study zone or at the event being checked in to; there is no background location.
- Sign in with Apple and Sign in with Google are offered on the sign-in screen (Guideline 4.8: Apple is required once Google is offered). Password and magic-link remain. A reviewer still joins with the invite token after signing in — membership follows the signed-in user id, including Apple Hide My Email.
- No in-app purchases and no digital goods. The app is designed to take **chapter dues** by card (Stripe PaymentSheet on the Dues tab): these are membership dues owed to the member's own real-world organization, i.e. goods and services consumed outside the app (guideline 3.1.5), not digital content. Chapter *subscriptions* to Signet itself are bought on the web dashboard and are not offered, linked or mentioned in the app.
  > **Do not paste the dues sentence while card payments are off.** `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is set by no profile in [`apps/mobile/eas.json`](../eas.json), so `publishableKey()` returns `null` and the Pay affordance does not render in any build — a reviewer told to look for it would find nothing. Either ship the key or drop the sentence.

## Privacy questionnaire answers

Same facts as https://frapp.live/privacy. The table below is **what was declared
in App Store Connect on 2026-09-14**, in Apple's own data-type names — the console
offers a fixed list, so this is the paste, not a paraphrase.

| Apple data type | Purpose(s) | Linked | Tracking |
| --- | --- | --- | --- |
| Contact Info → Name | App Functionality | Yes | No |
| Contact Info → Email Address | App Functionality | Yes | No |
| Contact Info → Phone Number | App Functionality | Yes | No |
| Location → Precise Location | App Functionality | Yes | No |
| User Content → Photos or Videos | App Functionality | Yes | No |
| User Content → Other User Content | App Functionality | Yes | No |
| Identifiers → User ID | App Functionality, **Analytics** | Yes | No |
| Identifiers → Device ID | App Functionality | Yes | No |
| Usage Data → Product Interaction | **Analytics** | Yes | No |
| Diagnostics → Crash Data | App Functionality | No | No |
| Diagnostics → Performance Data | App Functionality | No | No |

Declared **not** collected: all Financial Info (including Payment Info),
Purchases, Sensitive Info, Contacts, Health & Fitness, Emails or Text Messages,
Advertising Data, Browsing History, Search History.

Where each answer comes from:

- **Phone Number** — chapters can define a member field of type `phone`
  (`CustomFieldTypeSchema` in `packages/validation/src/index.ts`). There is no
  address field type, which is why **Physical Address** is not declared.
- **Other User Content** — chat messages and Backwork file uploads. Apple's
  "Emails or Text Messages" type is not used; in-app chat belongs here.
- **User ID carries Analytics** because PostHog identifies members —
  `packages/observability/src/correlation.ts` sets
  `distinct_id = hmac_sha256(salt, user_id)`. Pseudonymous, but we hold the salt,
  so Apple counts it as linked.
- **Product Interaction is Analytics only**, not App Functionality — it is
  PostHog, and nothing in the product depends on it.
- **Crash and Performance Data** are Sentry, which is on in production
  (`eas.json` sets `EXPO_PUBLIC_SENTRY_ENVIRONMENT: "production"`), and are the
  only two rows that are **not** linked.
- **Payment Info is deliberately absent.** Stripe's key is unset in every
  `eas.json` profile, so no card data is collected by any shipped build. **If the
  key ships, revisit this row.**
- **Tracking is No on all eleven.** Apple's definition is linking app data with
  third-party data for targeted advertising or measurement, or sharing with a data
  broker. There are no ad SDKs, and PostHog and Sentry are first-party processors,
  not brokers. A single Yes would require an ATT prompt, which the app does not
  implement.

Google Play Data safety: data is encrypted in transit; users delete in the app or dashboard (support page § 4), or by emailing team@frapp.live if they cannot sign in; no data shared with third parties for advertising; the developer is not enrolled in the Families program.

## Android-specific

- Track for the first upload: **internal** (`eas.json` `submit.production.android.track`), then closed testing → production. A new personal developer account must run a closed test with at least 12 testers for 14 days before production is unlocked.
- Target audience: 18 and over (college students); not designed for children.
