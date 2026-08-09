# Onboarding and Invites

This file covers the in-app onboarding behavior: the first-officer wizard, invite tokens, the new-member tutorial, and chapter-directory search. The signup/payment flow and chapter lifecycle are specced in [`../product/onboarding.md`](../product/onboarding.md) — cross-reference, not duplicated here.

## First-Officer Onboarding Wizard

- Fires on first sign-in when the authenticated user has **no chapter memberships** (`GET /v1/chapters` returns empty), or has a chapter still at the default seed (wizard not yet completed). It mounts as a full-screen overlay and replaces the old `chapter-bootstrap` component.
- Submit calls `POST /v1/chapters/onboard` on the **cold path** (NestJS + service-role Supabase) — never the chat Edge Functions. `ChapterOnboardingService.onboard`:
  1. Materializes the chapter config from the chosen archetype, **deep-copying the archetype seed** so per-chapter edits never mutate the shared reference. Sets `org_archetype`, `enabled_modules`, `vocabulary`, and a derived `theme_palette`. The client never supplies the module map — it is resolved server-side from the archetype.
  2. Creates the chapter with branding + `directory_id` (when matched in the directory), default roles, the creator's President membership, and the default channels.
  3. Posts a one-time welcome `system_audit` message into `#general`. Sent by the system user; best-effort (a failure does not roll back chapter creation).
  4. Navigates the client to `/chat?channel=general`.
- **Manual-entry path:** when the officer's chapter is not in the directory, the wizard submits with no `directory_id`. The service writes a `chapter_directory_requests` row (status `pending`) so the curated directory seed can be backfilled later. The row is RLS-enabled and API-only (no client policies), like `chapter_directory`.
- **Actor identity** for the chapter, membership, welcome message, and directory request is **always resolved from the authenticated session**, never from the request payload. The `requested_by` on a directory request comes from the session.

## Invite Token Rules

- Tokens **expire after 24 hours**.
- A token can be used **only once** (`used_at` is set on redemption).
- An expired or already-used token returns **410 Gone**.
- Each token carries a `role` that determines the joining member's initial role. If that role was deleted between creation and redemption, the user is assigned the default "Member" role instead.
- Only users with the `members:invite` permission can generate tokens. Multiple tokens can be generated at once (batch invite).
- **Inviting is free-tier and not billing-gated.** `InviteService.create` / `createBatch` do not check `subscription_status`; any chapter — including a brand-new `incomplete` one from the onboarding wizard — can generate invite tokens. Billing gates the paid ops modules, not chat/members/invites.
- If a user is already a member of the chapter and attempts to use an invite token for it, the API returns **409 Conflict**.

## Chapter Directory Search

`GET /chapter-directory/search?q=...&university=...` returns up to 20 matching directory entries, used by the onboarding autocomplete wizard.

- `q`: free-text query against org name, letters, designation, and university (full-text via tsvector).
- `university`: filters by `university_short` (case-insensitive prefix/contains).
- Response rows: `{ id, org_letters, org_name, archetype, chapter_designation, university, university_short, founded_year, default_colors, website }`.

## Onboarding Tutorial

When a new member joins a chapter (via invite token), they see a guided walkthrough on their first app launch.

### Walkthrough Screens

1. **Welcome** — Chapter name and logo (if uploaded).
2. **Chat** — Overview of channels, DMs, and announcements.
3. **Events** — Check in to earn points; never miss a meeting.
4. **Backwork** — Find study materials uploaded by chapter members.
5. **Study Hours** — Earn points by studying at approved locations.
6. **Profile Setup** — Set display name, upload a profile photo, write a short bio.
7. **Done** — CTA to the member's landing surface: the Home tab on mobile, `/chat` on web (there is no web home screen).

### Behavior

- The tutorial can be skipped at any point via a "Skip" button.
- It can be revisited from settings (Profile > "Replay Tutorial").
- The walkthrough adapts to the surface: a swipeable card stack on mobile, a modal slideshow on web.
- A `has_completed_onboarding` flag on the member record controls whether the tutorial is shown.
