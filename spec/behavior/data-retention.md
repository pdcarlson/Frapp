# Data Retention

## Chapter Cancellation

- When a chapter's subscription is canceled, all data is preserved **indefinitely** in read-only mode.
- Members can still log in and view all existing data (chat history, Backwork, points, events, etc.) but cannot create new content, invite members, or perform any write operations.
- If the chapter re-activates (resumes payment), full access is restored immediately with no data loss.
- "Indefinitely" is qualified by the reservation in [§ Inactive Chapter Cleanup](#inactive-chapter-cleanup), which has never been exercised and is not implemented. Read that section before answering any question about how long a canceled chapter's data is kept; it is not the only path by which chapter data is removed (see [§ Individual Account Deletion](#individual-account-deletion) and [`vault.md`](vault.md) § key lifecycle).

## Individual Account Deletion

- On request (`DELETE /v1/users/me`, authenticated self-service), a user's personally identifiable information (PII) is scrubbed: email, display name, bio, avatar, profile photo, graduation year, city, and company. A dedicated support-invoked path does not exist yet; until one ships, a support-received request requires an operator with service-role access to run the same `anonymize_user` RPC and Supabase Auth deletion by hand.
- Their point transactions, attendance records, chat messages, service entries, poll votes, reactions, and invoices are preserved but **anonymized** — the `users` row becomes an in-place tombstone (`display_name = "Deleted User"`, email replaced with a per-user undeliverable sentinel, all other PII nulled, `deleted_at` set), so every historical record that references the user renders as "Deleted User". The tombstone — rather than nulling each history row's user reference — is deliberate: several history tables cascade-delete on user removal and others require a non-null user reference, so an in-place scrub is the only mechanism that keeps history intact while removing identity.
- Current-state data is deleted outright: chapter memberships (and their custom-field values), user settings, push tokens, notifications, notification preferences, read cursors, and study sessions (location-presence history; the points they yielded remain in the preserved point transactions).
- System-generated chat cards embed display-name snapshots — task/points cards in both their card payload and their generated message text, event cards in the message text only. The deleted user's snapshots are rewritten to "Deleted User" everywhere they exist (the text rewrite keys on each row's own stored snapshot, so it also catches cards written under a former display name), so the name is neither rendered nor searchable in those rows. Free-text content that merely mentions the user (chat text typed by members, notification bodies sent to others) is preserved as-is, like any other message content.
- Avatar/profile-photo objects are removed from storage **before** the database scrub — the scrub deletes the memberships and avatar path that locate them, so the purge must succeed first. A storage failure aborts the (retryable) request with **no account data changed** (folders swept before the failure are already empty; the retry re-covers the rest); deletion never proceeds while photos remain locatable. A missing storage bucket counts as nothing-to-purge, not a failure. The purge sweeps every current chapter's folder plus the folder of the current avatar even when it lives in a chapter the user has since left; photos abandoned in long-left chapters (membership removal does not yet clean storage) are outside its reach. The prefix the purge computes must match the prefix the upload wrote to exactly, since storage keys are exact-case while the `chapter_id` a request carries is not (Postgres `uuid` comparison, and therefore chapter-membership authorization, is case-insensitive) — `ChapterGuard` normalizes every request's chapter id to lowercase once, at the single point every route reads it from, so an upload made under an uppercase `x-chapter-id`/JWT claim still lands under the same canonical-cased folder the purge looks in (#688). That fix is forward-only: a mis-cased object written *before* #688 shipped, then superseded by a later normal re-upload (the current `avatar_url` now points at the new, canonical-cased object) in a chapter the user is still a member of, is outside both mechanisms' reach — the membership-derived prefix is canonical and won't match the old folder, and the current-avatar-path recovery only knows about the *current* file. #1489 tracks a one-time audit of hosted storage for any surviving pre-#688 objects.
- **Generated report exports** are purged in the same pre-scrub step as profile photos. Branded PDF reports live in the private `reports` bucket, and roster exports embed member names, emails, roles, and join dates. Because a rendered PDF cannot have one member removed from it, the purge drops the **entire report prefix of every chapter the user is currently a member of** rather than attempting a per-member edit; officers re-export as needed. This is safe precisely because exports are derived artifacts — regenerable from the source tables, referenced by no database row — so deleting them never touches live data. Two bounds on its reach, both closed by the 24h sweep below rather than by this step: it reaches only *current* memberships, so an export in a chapter the user has already left is not purged here (membership rows are deleted on removal, exactly as with the profile-photo purge); and an export written in the seconds between the purge and the database scrub survives it. Unlike the photo purge, a failure here is **logged and the deletion continues** — report objects have an independent reaper and profile photos do not, so aborting would revoke the user's erasure over a delay the sweep already bounds. In the ordinary case each of those is closed by the sweep within ~25 hours. Two residues survive both mechanisms and are stated here rather than rounded away: an export whose stored-at timestamp storage never reported is never aged out by the sweep (it is removed only by a later purge of that chapter, or by hand), and a prefix the sweep cannot read is retried but never forced. The narrow worst case — an unknown-age export in a chapter the user had already left — is reached by neither, and persists until someone purges that chapter. Both failure modes are logged. See [`reports.md` § Retention](reports.md#retention).
- The user's Supabase Auth account is deleted **last**, and only after the analytics forget (below) is confirmed delivered to the provider — once the auth account is gone the user can never re-trigger the flow. (Delivery is what the API can verify; the provider-side deleted-users automation that consumes it is provisioned per environment as an ops prerequisite.) If any step fails, the API returns a retryable error and the request can simply be retried: the users-row scrub is atomic and **re-runs in full on every call** — and once more after auth deletion succeeds — so PII written onto the tombstone during a retry window (the auth account, and therefore the token, still works until auth deletion succeeds) is always scrubbed again; profile edits against a tombstoned row are additionally rejected outright.
- A sole President who deletes their account leaves the chapter without a President (deletion is never blocked on role). A claim flow for orphaned chapters is planned but not yet implemented; until it ships, recovering such a chapter requires operator intervention.
- This is irreversible.

## Inactive Chapter Cleanup

### The reservation

- Frapp reserves the right to delete data for chapters that have been inactive (canceled subscription, no logins) for more than 2 years.
- This is documented in the Terms of Service.
- Before deletion, an email notification is sent to the last known admin email with a 30-day warning.

**Nothing implements this, and nothing should until the questions below are answered.** No eligibility
query, no warning mail, no visibility surface, no dry-run and no deletion path exist in the codebase.
(That is a statement about the code, not about hosted data: a deletion performed by hand against a
hosted project would leave no trace here.)

Two things in the wording above are load-bearing and **neither is settled**:

- **Whether the two conditions are conjunctive or alternative is genuinely ambiguous.** "inactive
  (canceled subscription, no logins)" is a comma-separated gloss with no *and* and no *or*, and the
  reading decides who is eligible. This section does not resolve it — tracked in #1561.
- **The shipped Terms of Service do not currently carry this reservation.**
  `apps/landing/app/terms/page.tsx` contains no inactivity clause, no 2-year window and no 30-day
  warning; its only retention sentence defers to "retention terms". So the second bullet above
  describes an intent, not the deployed contract, and the terms page would need to say this before any
  deletion could rely on it — tracked in #1562.

### Why it cannot be implemented as written

The rule needs a clock for each of its two conditions. **Neither clock exists, and the obvious
substitute for the missing one does not work.**

- **No login clock.** No `last_login` / `last_seen` / `last_active` column exists in any migration, and
  `auth.users.last_sign_in_at` is read nowhere in the API — the only `auth.admin` call is `deleteUser`
  (`apps/api/src/infrastructure/supabase/supabase-auth-admin.service.ts`). It may also not be a
  drop-in substitute even if it were read — **verify before relying on it**: if GoTrue stamps it only
  at sign-in and not on token refresh, a continuously-active session leaves it stale and makes a live
  chapter look abandoned. That is a property of a third-party system, so it needs checking against
  hosted behavior rather than assuming; nothing in this repo establishes it either way.
- **No cancellation clock.** `chapters.subscription_status` is a `text` column with a `CHECK`
  constraint and no accompanying timestamp
  (`supabase/migrations/00000000000000_initial_schema.sql`). `past_due_since`
  (`supabase/migrations/20260602120000_chapter_past_due_since.sql`) is the precedent for adding one,
  including its `now()` backfill so that shipping the column cannot make any existing chapter
  immediately eligible. Any new status timestamp must also respect the out-of-order-webhook guard that
  `chapters.last_stripe_webhook_at`
  (`supabase/migrations/20260604121000_chapter_last_stripe_webhook_at.sql`) exists to enforce, or a
  retried Stripe event can stamp a date the billing layer itself rejected as stale.
- **Chapter activity cannot stand in for the login clock.** A canceled chapter is already hard-locked
  read-only — `subscriptionWriteState` returns `canceled` with no self-serve recovery, and it outranks
  even the free-tier carve-out (`packages/validation/src/subscription.ts`). So *no* member can write
  `chat_messages`, `point_transactions`, `events`, `attendance` or uploads once cancellation lands, and
  "no chapter-scoped writes" is true of every canceled chapter **by construction**. Content timestamps
  therefore cannot distinguish an abandoned chapter from one being read every week.

That last point is the crux rather than a detail: **reading is the only thing a canceled chapter's
members can still do, so a login record is the only signal that could ever separate a dormant chapter
from a living one — and it is not recorded in a usable form.** Until it is, any eligibility rule is
inferring abandonment from the absence of activity the product already forbids.

One further wrinkle for whoever writes the rule: `mapStripeStatus` folds `incomplete_expired` into
`canceled` ([`billing.md`](billing.md)), so a chapter that abandoned checkout and a former paying
customer of five years are indistinguishable by status alone.

### What deletion would have to reach

Two facts bound any strategy, and both are easy to miss:

- **The cascade is not universal.** `chapters` is the cascade root for most chapter-scoped tables, but
  not all of them: `chapter_directory_requests.chapter_id` is `on delete set null` *by deliberate
  design* (`supabase/migrations/20260524120000_chapter_directory_requests.sql` — "keep the backfill
  candidate even if the chapter is later deleted"), and the surviving row carries the chapter's
  identity plus `requested_by`.
- **Storage is outside the cascade entirely.** Every bucket keys on `chapters/{chapterId}/…`
  (`apps/api/src/domain/constants/storage.ts`), and nothing reaches those objects from a row delete.
  [§ Individual Account Deletion](#individual-account-deletion) also records the ordering this implies:
  storage must be purged **before** the database scrub, because the scrub deletes the rows that locate
  the objects.

**Whether cleanup is a hard delete or an anonymized archive is undecided — tracked in #1561**, and
nothing destructive ships until it is answered. One caution for that decision, because the analogy is
tempting and wrong: [§ Individual Account Deletion](#individual-account-deletion) records its in-place
scrub as **the only mechanism available** — several history tables cascade-delete on user removal and
others require a non-null user reference, so a row delete would be rejected outright — not as a
tradeoff anyone weighed. `chapters` has no such blocker, so that precedent does not transfer.

### Warning, reactivation, and authority — open questions

These are the design questions the flow raises, recorded so they are answered deliberately rather than
settled by whoever implements first. **None of them is settled spec.**

- **Recipient resolution.** The natural lookup is the current President via `roles.system_key =
  'PRESIDENT'` (`supabase/migrations/20260806220000_role_system_key.sql`), which is rename-proof —
  but only *forward*. That migration's backfill deliberately skips any chapter that had already renamed
  the role, which is disproportionately the dormant population this section targets, so the lookup
  returns nothing for exactly the chapters in scope.
- **Tombstoned recipients.** Account deletion replaces a user's email with an undeliverable sentinel
  and sets `users.deleted_at` (`apps/api/src/application/services/account-deletion.service.ts`), so a
  tombstoned recipient makes a send *succeed* while reaching nobody. Any recipient rule has to exclude
  them up front rather than discover it at send time.
- **What a bounce means.** If the 30 days run from delivery rather than send, a chapter whose admin
  mailbox has lapsed can never be cleaned up automatically — and that is the modal case in this
  population. If they run from send, the warning is a formality. Both readings have real cost; this is
  a product and legal call of the same weight as the strategy decision.
- **What counts as reactivation.** A member signing in can reset a *login* clock, but it cannot clear a
  cancellation timestamp that the Stripe webhook owns — a sign-in is not a billing event. Whether
  reading a canceled chapter should stop a deletion countdown, and how that is recorded without letting
  billing state and retention state diverge, needs deciding before either clock is built.
- **Who is allowed to run any of this.** There is no platform-administrator anywhere in the API: every
  route sits behind `SupabaseAuthGuard` + `ChapterGuard` + `PermissionsGuard` and is chapter-scoped.
  A cross-chapter sweep and an operator-triggered deletion have **no home in the current authorization
  model**, and "operator" elsewhere in this file means a human with service-role access, not a role the
  app can check. Mounting this on the standard guard chain would hand a chapter President a
  cross-tenant destructive capability. Naming the authority is a prerequisite, not an implementation
  detail.

### Before anything destructive ships

- The eligibility query runs in **report-only mode first**, producing the list of chapters it *would*
  warn, for at least one full warning cycle before any mail is sent or any row is touched.
- Deletion is executed **per chapter** and audit-logged, never as a bulk operation that can run away.
- The destructive step is **never** the default path of a scheduled job on first release.
  `apps/api/src/application/services/report-retention.service.ts` and
  `apps/api/src/modules/scheduled-jobs/` are the right *shape* for the sweep (including the
  `@Cron`-fires-on-every-instance caveat), but that service reaps **derived artifacts that are
  regenerable by construction** — the premise its entire safety argument rests on. None of that
  argument transfers here, and the machinery must not be reused as though it did.

### Prerequisites

Each of these must exist before the destructive path can be built, and the first three are
independently useful:

1. A cancellation timestamp on `chapters`, set and cleared by the billing webhook and respecting the
   existing webhook-ordering guard (#1559).
2. A general transactional-email capability. A working Resend transport is already wired and
   config-selected (`apps/api/src/modules/email/email.module.ts`); what is missing is a general send
   method on `IEmailProvider` — which declares only `sendInviteEmail`
   (`apps/api/src/domain/adapters/email.interface.ts`) — and a delivery result rich enough to
   distinguish accepted from bounced (#1560).
3. A login or chapter-activity signal that survives the read-only lock, per *Why it cannot be
   implemented as written* above.
4. The retention-strategy decision, the conjunctive-vs-alternative reading, and the authority question
   (#1561).
5. A report-only mode, exercised for a full cycle before any send.

## Analytics Events (Pseudonymous)

Frapp ships product analytics (PostHog or equivalent) to measure feature usage and find bugs. The pipeline is pseudonymous by construction:

- **User identity is a hash.** Events are keyed by `hmac_sha256(salt, user_id)`. The raw `user_id` is never sent to the analytics provider.
- **Chapter identity, where it appears, is also a hash.** Most events carry no chapter identifier at all — `chapter_id` is used server-side only to apply the opt-out. The exception is the activation funnel ([`observability.md`](observability.md#product-analytics--activation-funnel)), which measures chapters rather than users and is therefore keyed by `hmac_sha256(salt, chapter_id)` under the same salt. A raw `chapter_id` is never sent either.
- **Per-environment salt held outside the analytics provider.** The HMAC salt is provisioned per environment (prod / staging / local) and stored as a secret in the same secret store as other credentials — **not** in the analytics provider's environment. Compromise of the analytics dataset cannot be rainbow-tabled back to user IDs without access to the secret store.
- **Chapter-level opt-out.** Chapter presidents can disable analytics for their chapter from **Settings → Privacy** (gated by `chapter-config:manage`; see [`settings/README.md`](settings/README.md#privacy-tab)). The toggle writes the `chapters.analytics_opt_out` flag through the config PATCH (audit-logged, member-visible). When opted out, **web and mobile** emit zero events for that chapter's members regardless of the active environment. Opt-out is the fourth shared client-side gate — `isAnalyticsOptedOut` in `@repo/validation`, next to `can`, `isModuleEnabled`, and `subscriptionWriteState`. Web reads the flag from chapter config (`useOrgConfig`); mobile reads it from `GET /v1/chapters/current` (`useCurrentChapter`), the same payload it already uses for `isModuleEnabled`. Both providers enforce the gate at `track` before `POST /v1/analytics/events`. There is no public `useAnalytics` hook (removed: zero production callers); `track` is the React context value on each app's `AnalyticsProvider` (`apps/web/lib/providers/analytics-provider.tsx`, `apps/mobile/lib/analytics-provider.tsx`). The API repeats the check server-side as a defense-in-depth check before any server-originated event is sent. The server check cannot be sidestepped by omitting the chapter: a client event with no `chapter_id` is gated against **all** of the caller's chapter memberships and is suppressed when every one of them has opted out (a caller with no memberships still emits — there is no chapter to opt out of). Mobile additionally no-ops `track` when there is no active chapter id, so an event cannot escape the opt-out by omitting `chapter_id`.
- **Event payloads exclude content.** Event names and properties describe behavior ("opened-channel", "ran-slash-command"), not content. Message bodies, document contents, transcript text, and personal-information fields are never sent.
- **Account deletion clears the pseudonym mapping.** When a user account is deleted (per the *Individual Account Deletion* section above), the user's hashed ID is added to the analytics provider's "deleted users" list, which triggers a delete-all-events workflow for that hash.

### Keying happens server-side

To keep the salt out of every client bundle (a `NEXT_PUBLIC_`/`EXPO_PUBLIC_` salt would ship to the browser/app and defeat the pseudonymity guarantee above), the HMAC is computed **on the API**, never on the client:

- The keying function (`hmac_sha256(salt, user_id)`) is shared in `@repo/validation` so the server and any future server-side caller derive identical pseudonyms; the salt is read only by the API (`ANALYTICS_HMAC_SALT`).
- Clients (web, mobile) emit behavioral events through the API (`POST /v1/analytics/events`); the API verifies the caller is a member of the chapter the event is attributed to (a `chapter_id` the caller does not belong to is rejected with **403**, so events cannot be misattributed across chapters), keys them, enforces the per-chapter opt-out as defense in depth, rejects content/PII payloads, and forwards to the provider. The raw `user_id` and the salt never reach the client or the provider.
- A client that needs its own pseudonymous id (e.g. to initialise a provider SDK) fetches it from `GET /v1/analytics/identity`.
- Provider selection is config-driven: with no `POSTHOG_API_KEY` the API uses a no-op/logging provider, so non-prod environments emit nothing off-box.
