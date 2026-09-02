# Data Retention

## Chapter Cancellation

- When a chapter's subscription is canceled, all data is preserved **indefinitely** in read-only mode.
- Members can still log in and view all existing data (chat history, Backwork, points, events, etc.) but cannot create new content, invite members, or perform any write operations.
- If the chapter re-activates (resumes payment), full access is restored immediately with no data loss.
- "Indefinitely" is bounded by exactly one thing, and only after a warning: the *Inactive Chapter Cleanup* reservation below, which requires **cancellation _and_ two years of no logins** together. Cancellation alone never expires — a canceled chapter whose members still sign in is preserved with no end date. See [§ Inactive Chapter Cleanup](#inactive-chapter-cleanup).

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

The two conditions are **conjunctive**: cancellation alone is never sufficient, and a chapter whose
members still sign in is never eligible however long its subscription has lapsed. This is what bounds
the "indefinitely" in [§ Chapter Cancellation](#chapter-cancellation), and it is the only thing that does.

### Status: reserved, not implemented — and it must not be built yet

**Nothing here runs today.** There is no eligibility query, no warning mail, no admin visibility, no
dry-run, and no deletion path; the reservation is a stated right the product has never exercised. That
is the correct state, because **three of the four nouns in the policy above have no referent in the
schema**:

| The policy says | What exists |
| --- | --- |
| "no logins" for 2 years | **No login clock anywhere.** No `last_login` / `last_seen` / `last_active` column in any migration, and `auth.users.last_sign_in_at` is read by nothing — the only `auth.admin` call in the API is `deleteUser` (`infrastructure/supabase/supabase-auth-admin.service.ts`) |
| "canceled subscription" for 2 years | **No cancellation clock.** `chapters.subscription_status` is a bare enum (`supabase/migrations/00000000000000_initial_schema.sql`); the only status timestamp on the table is `past_due_since` |
| "an email … to the last known admin email" | **No transactional email path.** `IEmailProvider` (`domain/adapters/email.interface.ts`) declares exactly one method, `sendInviteEmail` |
| "delete data" | `chapters` is the cascade root — `members`, `roles` and every chapter-scoped table are `on delete cascade` from it |

A job written against today's schema could not measure either half of its own eligibility rule. It would
have to *infer* inactivity, and an inference that is wrong deletes a chapter's entire history with no
undo. **Do not implement any part of the destructive path until the prerequisites below have landed and
the open decision has been made.**

### Eligibility — the source of truth for each term

Eligibility is evaluated per chapter and every clause must hold:

1. **`subscription_status = 'canceled'`**, continuously, for ≥ 2 years — measured from a
   `chapters.canceled_at` timestamp that does not exist yet. `past_due_since`
   (`supabase/migrations/20260602120000_chapter_past_due_since.sql`) is the precedent to copy exactly,
   including its `now()` backfill: a legacy row that was canceled before the column shipped starts its
   clock at the migration, so shipping the column can never make a chapter *immediately* eligible.
   A re-activation clears it, which is what makes the two-year window continuous rather than cumulative.
2. **No login by any member** for ≥ 2 years. `auth.users.last_sign_in_at` is the only real login record,
   and it is **not sufficient on its own** — GoTrue stamps it at sign-in, not at token refresh, so a
   continuously-active session can leave it stale and make a live chapter look abandoned. Chapter-level
   activity must be the operative signal, with `last_sign_in_at` as corroboration only.
3. **No chapter-scoped write** for ≥ 2 years — the cross-check that makes clause 2 safe. Content
   timestamps (`chat_messages`, `point_transactions`, `events`, `attendance`, uploads) are records the
   application itself writes, so they cannot go stale the way a session field can.
4. **A deliverable admin address exists** (see the warning flow). A chapter with no reachable admin is
   **not** eligible; it is escalated for manual review instead. Silence that nobody could have broken is
   not consent.

Eligibility is a **read-only query** and must be independently runnable — see *Dry-run* below.

### The warning and reactivation flow

- **Recipient.** The current President, resolved via `roles.system_key = 'PRESIDENT'`
  (`supabase/migrations/20260806220000_role_system_key.sql` — rename-proof, unlike `roles.name`), then
  each remaining admin, then the chapter's last active member. Every candidate whose `users.deleted_at`
  is set is skipped: account deletion replaces the email with an undeliverable sentinel
  (`application/services/account-deletion.service.ts`), so a tombstoned recipient would make the send
  *succeed* while reaching nobody. This is checked at eligibility time, not discovered at send time.
- **The 30 days start on delivery, not on send.** A bounce or a provider failure means the warning did
  not happen; the chapter stays ineligible and is escalated for manual review. A warning nobody received
  cannot start a countdown that ends in deletion.
- **Reactivation is a plain login.** Any member signing in, or any resumption of payment, cancels the
  countdown and resets both clocks. No support ticket, no form, no acknowledgement of the email is
  required — the escape hatch has to be the thing the member would already do.
- **The warning states what will happen, when, and how to stop it**, and it is sent once per eligibility
  window rather than repeatedly.

### What deletion does — the open decision

**This is the one question in this section that is not settled, and it is deliberately left open for
owner sign-off rather than defaulted.** Two viable strategies:

| Strategy | What it costs |
| --- | --- |
| **Hard delete** — remove the `chapters` row and let the cascade take the graph | Honours the strongest reading of erasure. Irreversible, and one wrong eligibility verdict destroys a chapter's entire history with nothing to restore from |
| **Anonymized archive** — scrub PII in place, keep aggregate/structural rows, mirroring [§ Individual Account Deletion](#individual-account-deletion) | Removes the personal data the retention promise is actually about while leaving a recoverable shell. Keeps storage cost and a residual dataset the ToS implies would be gone |

**Recommendation: anonymized archive, with hard delete available as an explicit operator action.** The
reason is asymmetry, not preference — the failure modes are not comparable. Account deletion already
solved this exact problem the same way, for the same reason its own section records: an in-place scrub
was chosen over row removal because the cascade was destructive in ways the promise did not require. The
argument transfers directly. But which one Frapp actually promises is a **product and legal call, not an
engineering one**, and it must be made before any implementation issue is worked.

Whichever is chosen: deletion is executed **per chapter**, is audit-logged, and is never a bulk
operation that can run away.

### Dry-run and admin visibility, before anything destructive

- The eligibility query ships and runs in **report-only mode first**, producing the list of chapters it
  *would* warn, for at least one full warning cycle before any mail is sent or any row is touched.
- Every stage (eligible / warned / deleted) is visible to an operator, with the evidence that put each
  chapter there.
- The destructive step is **never** the default path of a scheduled job on first release. The precedent
  for the sweep's shape is `application/services/report-retention.service.ts` and
  `modules/scheduled-jobs/` (note its `@Cron`-fires-on-every-instance caveat), but that service reaps
  *derived artifacts that are regenerable by construction* — the premise its whole design rests on. No
  part of that safety argument transfers here, and the machinery must not be reused as if it did.

### Prerequisites

None of these is optional, and each is independently useful:

| # | Prerequisite | Tracked |
| --- | --- | --- |
| 1 | `chapters.canceled_at`, set and cleared by the billing webhook on the cancel/reactivate transitions, modelled on `past_due_since` | #1559 |
| 2 | A chapter-level activity timestamp that does not depend on `auth.users.last_sign_in_at` | with the eventual implementation |
| 3 | A general transactional-email capability on `IEmailProvider` (it can send exactly one kind of mail today) | #1560 |
| 4 | The retention-strategy decision above | #1561 |
| 5 | The dry-run/report-only mode, exercised for a full cycle before any send | with the eventual implementation |

Prerequisites 1 and 3 are independently useful and are not gated on the decision; 2 and 5 only become
meaningful once it is made.

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
