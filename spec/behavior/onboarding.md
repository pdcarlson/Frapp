# Onboarding and Invites

This file covers the in-app onboarding behavior: the first-officer wizard, invite tokens, the new-member tutorial, and chapter-directory search. The signup/payment flow and chapter lifecycle are specced in [`../product/onboarding.md`](../product/onboarding.md) — cross-reference, not duplicated here.

## First-Officer Onboarding Wizard

- Fires on first sign-in when the authenticated user has **no chapter memberships** (`GET /v1/chapters` returns empty). **Web** mounts it as a full-screen overlay. **Mobile** is a deliberate route (`apps/mobile/app/(auth)/create-chapter.tsx`) reached from join, from the chapter-picker empty state, and from More when the account has zero memberships — so the wizard can own its lifecycle after submit flips the membership count to 1. `(auth)/_layout.tsx` exempts `/create-chapter` from the post-auth bounce into the tabs for that reason. Both surfaces read the archetype picker from `@repo/org-archetypes` (`ARCHETYPES` / `getArchetype`); mobile declares that workspace package in `apps/mobile/package.json` rather than keeping a local catalog.
- **"No chapter memberships" is the only robust (re-)trigger signal.** A wizard-created membership is written with `has_completed_onboarding=true`, and the chapters-list response does not expose `enabled_modules`, so a client cannot detect "chapter still at the default seed" from it. Once opened, the wizard owns its own lifecycle — the membership count flipping to 1 mid-flow does not auto-close it.
- Submit calls `POST /v1/chapters/onboard` on the **cold path** (NestJS + service-role Supabase), not the chat hot path. `ChapterOnboardingService.onboard`:
  1. Materializes the chapter config from the chosen archetype, **deep-copying the archetype seed** so per-chapter edits never mutate the shared reference. Sets `org_archetype`, `enabled_modules`, `vocabulary`, and a derived `theme_palette`. The client never supplies the module map — it is resolved server-side from the archetype.
  2. Creates the chapter with branding + `directory_id` (when matched in the directory), default roles, the creator's President membership, and the four default channels — `#general`, `#announcements`, `#chapter-audit` (all `PUBLIC`) and `#alumni` (`ROLE_GATED`, requiring `members:view` + `alumni:post`). Source of truth: `DEFAULT_CHANNELS` in `apps/api/src/domain/constants/permissions.ts`. Member-facing empty-state copy names only the three public channels, since `#alumni` is not visible without the gating permissions.
  3. Seeds the archetype's default custom fields into `chapter_custom_fields`, so Settings → Fields opens populated rather than empty. Best-effort and idempotent; the key derivation and skip rules live with the rest of the Fields-tab behavior in [`settings/customization.md`](settings/customization.md#fields-tab), not here.
  4. Posts a one-time welcome `system_audit` message into `#general`. Sent by the system user; best-effort (a failure does not roll back chapter creation).
  5. Navigates the client to chat (`/chat?channel=general` on web; `/(tabs)` — chat home — on mobile).
- **Manual-entry path:** when the officer's chapter is not in the directory, the wizard submits with no `directory_id`. The service writes a `chapter_directory_requests` row (status `pending`) so the curated directory seed can be backfilled later. The row is RLS-enabled and API-only (no client policies), like `chapter_directory`.
- **Actor identity** for the chapter, membership, welcome message, and directory request is **always resolved from the authenticated session**, never from the request payload. The `requested_by` on a directory request comes from the session.

## Invite Token Rules

- Tokens **expire after 24 hours**.
- A token can be used **only once** (`used_at` is set on redemption).
- An expired or already-used token returns **410 Gone**.
- Each token carries a `role` that determines the joining member's initial role. If that role was deleted between creation and redemption, the user is assigned the default "Member" role instead.
- Only users with the `members:invite` permission can generate tokens. Multiple tokens can be generated at once (batch invite), or one per address via a bulk email send (`POST /v1/invites/email`) that mints a token per address and emails each a join link. Email delivery is best-effort per address — a send failure never invalidates the token, it is only reported back so the caller can retry or share the link manually.
- **Minting an invite is part of the free-tier wedge, but it is not ungated.** `InviteService.create` / `createBatch` / `createWithEmails` never check `subscription_status` themselves — the gate lives in `ChapterGuard`, via `@FreeTier()` on the controller class plus `@GraceBlocked()` on those three creating routes. So a brand-new `incomplete` chapter from the onboarding wizard **can** mint tokens, but a `past_due` chapter **cannot**: creation is refused with **403** (guard code `chapter.subscription.invite_blocked`, which `AllExceptionsFilter` does not yet put in the response body — #1020) even inside the 3-day grace window that still permits its other free-tier writes, and a null `past_due_since` counts as within grace. A `canceled` chapter cannot mint either. Billing gates the paid ops modules more broadly than it gates chat/members/invites, but "free-tier" never means "always allowed". Full matrix: [`docs/guides/api-architecture.md`](../../docs/guides/api-architecture.md) § Subscription enforcement (ChapterGuard).
- **Redeeming is never subscription-gated.** `POST /v1/invites/redeem` carries no `ChapterGuard`: `InviteController` applies `ChapterGuard`/`PermissionsGuard` per route and `redeem` declares neither. It is still authenticated — `SupabaseAuthGuard` is class-level. The reason it _cannot_ simply be guarded is not that the caller lacks chapter context (`ChapterGuard` resolves the JWT's `active_chapter_id` first, falls back to `x-chapter-id`, and auto-resolves a single-chapter user) but that the chapter which matters here is `invite.chapter_id`, which the guard never sees — adding the guard would gate the redeemer's _current_ chapter instead, and 400 a brand-new user who has none. So a token minted before a lapse still redeems afterwards, and `redeem` writes a membership row into that chapter. Tokens live 24 hours, so the exposure is bounded to a one-day tail — but it is **not** confined to any single transition: `handleSubscriptionDeleted` writes `canceled` over whatever status preceded it with no dwell requirement, and `incomplete_expired` maps to `canceled` too. So a token minted legitimately while `active` — or while `incomplete`, which may also mint — can outlive a lapse by up to a day, including on the `past_due` path. Only _minting_ is gated.
- Email delivery itself is optional infrastructure: with no `RESEND_API_KEY` configured, the API logs invite emails instead of sending them rather than failing the request — tokens are still created and can be shared as links. See `docs/internal/environment/ENV_REFERENCE.md` § Invite Email.
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
6. **Points** — Balance, the chapter leaderboard, and the transaction log.
7. **Profile Setup** — Set display name and write a short bio. Photo upload is **mobile-only** today; the web half is tracked separately and the web slide does not promise it.
8. **Done** — CTA into chat, the landing surface on both web (`/chat`) and mobile. There is no web home screen; see [`chat/README.md`](chat/README.md).

This list said **seven** and omitted Points until the #920 Profile & pre-auth slice. The code has carried eight slides since `STEPS` was written, so the doc was stale rather than the implementation — behavior spec wins on what the product does, and here the shipped product *is* what it does. `apps/web/components/onboarding/onboarding-tutorial.spec.tsx` now asserts the eight titles in order, so the two cannot drift apart again.

### Behavior

- The tutorial can be skipped at any point via a "Skip" button.
- It can be revisited from settings (Profile > "Replay Tutorial").
- The walkthrough adapts to the surface: **web** is a modal slideshow (`apps/web/components/onboarding/onboarding-tutorial.tsx`). **Mobile** is the s03 first-run screen (`apps/mobile/app/(auth)/welcome.tsx`): auto-joined public channels plus the push primer, then a Skip / Go to chat CTA. Canvas s03 is the drawing; the eight web slides are not restated as extra mobile cards.
- A `has_completed_onboarding` flag on the member record controls whether the tutorial is shown. On mobile the auth gate reads it from `GET /v1/chapters` and routes to s03 when the active membership's flag is false (`apps/mobile/lib/auth-gate.ts`). Completing or skipping s03 PATCHes `PATCH /v1/members/me/onboarding`. Wizard-created memberships are written with the flag already true, so first officers skip s03.
- An authenticated mobile session with **zero** memberships is routed to s02 (`(auth)/join.tsx`) to redeem an invite token. First-officer chapter creation is the same screen's secondary **Create a chapter** control, which opens `(auth)/create-chapter` (#1102).
