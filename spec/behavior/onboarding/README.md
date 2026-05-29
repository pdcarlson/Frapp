# Onboarding and Invites

## First-Officer Onboarding Wizard (Chunk 03)

- Fires on first sign-in when the authenticated user has **no chapter memberships** (`GET /v1/chapters` returns empty). Mounted in the dashboard shell as a full-screen overlay; it replaces the old `chapter-bootstrap` component.
- Submit calls `POST /v1/chapters/onboard` (cold path, NestJS + service-role Supabase — never the chat Edge Functions). `ChapterOnboardingService.onboard`:
  1. Materializes the chapter config from the chosen archetype via `buildChapterConfigFromArchetype` (deep-clones the seed with `structuredClone`), setting `org_archetype`, `enabled_modules`, `vocabulary`, and a derived `theme_palette`. The client never supplies the module map — it is resolved server-side from the archetype.
  2. Creates the chapter (`ChapterService.create`) with branding + `directory_id` (when the chapter was matched in the directory), plus default roles, the creator's President membership, and the default channels.
  3. Posts a one-time welcome `system_audit` message into `#general`: "Welcome to {greek_letters} {designation}. Invite your chapter to get the conversation started." Sent by the system user; best-effort (a failure does not roll back chapter creation).
  4. Navigates the client to `/chat?channel=general`.
- **Manual-entry path:** when the officer's chapter is not in the directory, the wizard submits with no `directory_id`. The service writes a `chapter_directory_requests` row (chapter_id, `requested_by` from the **session** — never the client, the typed identity fields, status `pending`) so the curated directory seed can be backfilled later (#232). RLS-enabled, API-only (no client policies), like `chapter_directory`.
- **Actor identity** for the chapter, membership, welcome message, and directory request is always resolved from the authenticated session, never from the request payload.

## Invite Token Rules

- Tokens expire after 24 hours.
- A token can only be used once (`used_at` is set on redemption).
- If a token is expired or already used, the API returns 410 Gone.
- Each token carries a `role` that determines the joining member's initial role.
- Only users with the `members:invite` permission can generate tokens.
- Admins can generate multiple tokens at once (batch invite). Batch creation is optimized to use a single bulk database operation to minimize network roundtrips and ensure efficiency.

## Edge Cases

- If a user already has an account and is a member of the chapter, attempting to use an invite token for the same chapter returns 409 Conflict.
- **Inviting members is free-tier and not billing-gated (Chunk 03).** `InviteService.create` / `createBatch` no longer check `subscription_status`; any chapter (including a brand-new `incomplete` one created by the onboarding wizard) can generate invite tokens. This realizes the redesign's free-tier wedge ("sign up, create a chapter, invite members, and chat — no Stripe gate"). Billing gates the paid ops modules, not chat/members/invites.
- If the token's role has been deleted between token creation and redemption, the user is assigned the default "Member" role instead.

## Chapter Directory Search (Chunk 02)

### GET /chapter-directory/search?q=...&university=...

Returns up to 20 matching chapter directory entries. Used by the onboarding autocomplete wizard.

- `q`: free-text query against org name, letters, designation, and university (full-text via tsvector)
- `university`: filters by university_short (case-insensitive prefix/contains)

**Response:** Array of `{ id, org_letters, org_name, archetype, chapter_designation, university, university_short, founded_year, default_colors, website }`.

## Onboarding Tutorial

When a new member joins a chapter (via invite token), they see a guided walkthrough on their first app launch.

### Walkthrough Screens

1. **Welcome** — Chapter name and logo (if uploaded). "Welcome to [Chapter Name] on Frapp!"
2. **Chat** — Brief overview: "This is where your chapter communicates. Channels, DMs, and announcements."
3. **Events** — "Check in to earn points. Never miss a meeting."
4. **Backwork** — "Find study materials uploaded by your brothers."
5. **Study Hours** — "Earn points by studying at approved locations."
6. **Profile Setup** — Prompt to set display name, upload a profile photo, and write a short bio.
7. **Done** — "You're all set! Start exploring." CTA to the home feed.

### Behavior

- The tutorial can be skipped at any point via a "Skip" button.
- The tutorial can be revisited from the settings screen (Profile > "Replay Tutorial").
- The walkthrough adapts to the surface: on mobile it is a swipeable card stack; on web it is a modal slideshow.
- A `has_completed_onboarding` flag is stored on the member record to control whether to show the tutorial.
