# Store listing — App Store and Google Play

The text and answers the two store consoles ask for, kept next to the app so
they are reviewed like code. Nothing here is read by a build; it is what a human
pastes into App Store Connect and the Play Console when creating the listing
(procedure: [`docs/internal/ops/DEPLOYMENT.md`](../../../docs/internal/ops/DEPLOYMENT.md)
§ Mobile). Screenshots are not committed — take them from a `preview` build on a
device once one exists (#938).

**Open decision before either listing is created:** the product name. The
binary, bundle id (`live.frapp.mobile`) and every public URL say **Frapp**;
the specs say the product is becoming **Signet**, pending a trademark search
([`spec/ui/brand-identity.md`](../../../spec/ui/brand-identity.md)). A store
name cannot be changed without a new review, and the App Store name is unique
across the store. Decide the name first; everything below is written for
**Frapp** and reads correctly with a one-word swap.

## Identity

| Field | Value |
| --- | --- |
| Name | Frapp |
| Subtitle (iOS, 30 chars) / Short description (Android, 80 chars) | Your chapter, in one place |
| Bundle id / package | `live.frapp.mobile` |
| Category | Productivity (primary); Social Networking (secondary, iOS) |
| Age rating | 4+ / Everyone — no user-generated content is public; chat is private to a chapter |
| Price | Free (chapters pay a subscription through the web dashboard; the app has no in-app purchases — the only payment in the app is a member paying their own chapter's dues by card, a real-world service) |
| Privacy policy URL | https://frapp.live/privacy |
| Terms URL | https://frapp.live/terms |
| Support URL | https://frapp.live/support |
| Marketing URL | https://frapp.live |
| Support email | team@frapp.live |

## Description

Frapp is the app your chapter actually runs on.

Members get one place for the things that used to live in six group chats: chapter announcements and channels, upcoming events with a check-in code at the door, study hours that count toward chapter goals, points and the leaderboard, dues and payment history, and the member directory.

Officers get the tools to run the chapter without a spreadsheet: invite members with a link, assign roles and permissions, post to the right channel, take attendance by QR code, track service and study hours, and see who has paid.

Frapp is invite-only. Your chapter's officers create the chapter on the web and send you an invite link; open it on your phone and you are in.

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

- The app is invite-only. A reviewer account and a test chapter invite are provided in the Notes field at submission time; the invite link opens the app to the join screen.
- Camera is used only to scan a chapter's event check-in QR code. Location is used only while the app is open, to confirm the member is inside a chapter study zone or at the event being checked in to; there is no background location.
- Sign in with Apple is not offered because the app has no third-party sign-in of any kind: accounts are email + password through the chapter's invite.
- No in-app purchases and no digital goods. The app does take **chapter dues** by card (Stripe PaymentSheet on the Dues tab): these are membership dues owed to the member's own real-world organization, i.e. goods and services consumed outside the app (guideline 3.1.5), not digital content. Chapter *subscriptions* to Frapp itself are bought on the web dashboard and are not offered, linked or mentioned in the app.

## Privacy questionnaire answers

Same facts as https://frapp.live/privacy; the answers below are the store forms' vocabulary.

| Data | Collected | Linked to identity | Used for tracking | Purpose |
| --- | --- | --- | --- | --- |
| Name, email | Yes | Yes | No | App functionality (account, directory) |
| User content (messages, photos, files) | Yes | Yes | No | App functionality — private to the chapter |
| Precise location | Yes, foreground only, during study tracking and event check-in | Yes | No | App functionality |
| Photos | Only the photo a member chooses to upload | Yes | No | App functionality |
| Device id / push token | Yes, if notifications are enabled | Yes | No | App functionality (push) |
| Crash data, diagnostics | Yes (Sentry), pseudonymized | No | No | App functionality — diagnostics |
| Purchase history | Officers: dues ledger within the chapter | Yes | No | App functionality |
| Advertising data, browsing history, contacts, health, financial account numbers | No | — | — | — |

Google Play Data safety: data is encrypted in transit; users can request deletion (support page § 4); no data shared with third parties for advertising; the developer is not enrolled in the Families program.

## Android-specific

- Track for the first upload: **internal** (`eas.json` `submit.production.android.track`), then closed testing → production. A new personal developer account must run a closed test with at least 12 testers for 14 days before production is unlocked.
- Target audience: 18 and over (college students); not designed for children.
