# Points Ledger — Security, Audit, and Atomicity

## Core Invariant

Every point change is a row in `point_transactions`. There is no mutable "balance" column. A member's balance is always computed as `SUM(amount) WHERE user_id = ? AND chapter_id = ?`.

## Atomic Point Awarding

When a user checks into an event:

1. Validate the event exists and belongs to the chapter.
2. Validate the user has not already checked in (unique constraint on event_id + user_id).
3. In a single database transaction:
   a. Insert `event_attendance` with status PRESENT.
   b. Insert `point_transactions` with amount = event.point_value, category = ATTENDANCE.
4. If either insert fails, the entire transaction rolls back.

**This invariant governs every path that auto-awards points**, not just event check-in: the state change that earns the points and the `point_transactions` insert always commit or roll back together, in one transaction. Where a row carries a `points_awarded` flag (task confirmation → MANUAL, service-hour approval → SERVICE), the transaction is a **compare-and-set**: it updates the row only while it is still eligible (`points_awarded = false`), so concurrent or retried awards can't double-insert — exactly one caller wins and the rest are no-ops. Where the award is instead a fresh insert with no such flag (event check-in awards ATTENDANCE), the same guarantee comes from a unique constraint: the `check_in_event` RPC inserts the `event_attendance` row with `on conflict (event_id, user_id) do nothing` and awards points only when that insert wins, so concurrent or retried check-ins can't double-insert either. A guard read in the service layer is only a friendly fast path; the conditional write is the authoritative concurrency guard.

## Admin Adjustments

- Only users with the `points:adjust` permission can manually add or remove points.
- Every manual adjustment requires a **reason** field (non-empty string). This is displayed in the transaction log alongside the adjustment.
- All admin point changes record the admin's user ID as `adjusted_by` in the transaction metadata. This creates an irrefutable audit trail.
- Categories for manual adjustments: MANUAL (reward) or FINE (penalty).

## Anti-Fraud

- **Append-only:** All transactions are immutable. No edits, no deletes. Corrections are new transactions with the inverse amount and a description referencing the original.
- **Rate limiting:** A single admin cannot create more than N point adjustments per hour **in a given chapter**. The counter is scoped to the `(admin, chapter)` pair — `countRecentAdjustments(adminUserId, chapterId, since)` filters on both — so the limit bounds one admin in one chapter, not the chapter as a whole. Exceeding it returns 429 Too Many Requests. N is `chapter_points_config.adjustment_rate_limit_per_hour`, **default 50**. This section is the canonical statement of the limit and its scoping; other docs link here rather than restating it.
- **Anomaly flagging:** If a single transaction's absolute amount reaches a configured threshold, it is automatically flagged for review. Flagged transactions are visible in a dedicated "Audit" tab on the points ledger dashboard, which also states the two active limits so an officer reading a flag knows what produced it. The threshold is `chapter_points_config.anomaly_threshold`, **default 100** (so ±100 flags).
- **A flag is historical, not a live predicate.** `metadata.flagged` is written into the ledger row at adjustment time and the Audit tab filters on the stored flag, so raising or lowering the threshold **never re-evaluates existing rows**. After a chapter moves the dial its ledger legitimately holds rows flagged under the old threshold and unflagged rows above the new one. This is the append-only rule doing its job — a flag records what the chapter's policy was when the adjustment was made — but it only became observable once the threshold could move, so the Audit tab says so.
- **Both limits above are chapter-configurable**, held in the `chapter_points_config` singleton row (PK `chapter_id`) and read on each `POST /v1/points/adjust`. They are set through `PATCH /v1/chapters/:id/config` under the `points` key, which audits the change like any other config write. **That route is gated on `chapter-config:manage` (or `*`)** — no seeded role but President's wildcard holds it, though a `roles:manage` holder can mint a custom role carrying it. Note what that means: a chapter that delegates config-manage for branding or dues also delegates the ability to loosen these two fraud controls. Every such change lands in `chapter_audit_log` and mirrors to `#chapter-audit`, so it is visible rather than silent, and both dials are bounded at the API (rate ≤ 1000/hr, threshold ≤ the ledger's own ±100,000 ceiling) so neither can be switched off outright. Whether tuning an anti-fraud limit deserves its own permission rather than riding the general config grant is [#1582](https://github.com/pdcarlson/Frapp/issues/1582). Each is floored at **1** by both the DTO and a column `CHECK`, for two different reasons: a rate limit of `0` would refuse every adjustment with no way back out through the API (the ledger is append-only, so there is no corrective write either), and a threshold of `0` would flag every row and make the Audit tab's filter meaningless. A chapter that wants no manual adjustments at all removes the `points:adjust` permission — that is the control for it. **A chapter with no row is not misconfigured:** the absent row means "use the defaults", which are exactly the values the service hardcoded before [#394](https://github.com/pdcarlson/Frapp/issues/394), so no chapter's behaviour changed when the limits became configurable and nothing provisions rows at onboarding.
- **Hard amount ceiling:** a single ledger write must fall within **±100,000 points**. This is a validation bound, not a flag — the request is rejected with 400 and no ledger row is written. Flagging above (which only marks a committed row for review) is the response to a *large* adjustment; this is the response to an implausible one. A legitimate correction larger than the ceiling is made as several adjustments, each with its own reason and audit row.
  - The ceiling applies to **every** award path, not just manual adjustment — attendance, tasks, study, and service accrual all write the same ledger, and several are reachable with a broader grant than `points:adjust` (submitting a service entry needs only `service:log`, which the default Member role holds). Since the ledger is append-only and the correcting adjustment is itself bound by this ceiling, an uncapped write would not be fully reversible through the API. Each path is bound at its **request field**; the enforced list lives in `apps/api/src/interface/dtos/dto-constraint-coverage.spec.ts` rather than here, because an enumeration written in prose goes stale without failing anything.
  - **Study awards are bounded at their input, not yet at their total.** A study award is `intervals × points_per_interval`, and the interval count comes from measured session length rather than the request, so a long enough session can still produce a row above the ceiling even with the rate capped. Whether a marathon session should be clamped, refused, or given a category-specific ceiling is an open product decision — [#948](https://github.com/pdcarlson/Frapp/issues/948). Service accrual is not affected: its award is `floor(duration_minutes / minutes_per_point)`, so capping the submitted duration bounds the row.
- **Idempotency:** `POST /v1/points/adjust` accepts a client-minted UUIDv4 `client_message_id`, and a replay carrying a key this chapter has already used **returns the original transaction instead of writing a second row**. This exists because the append-only rule above has a sharp edge: a lost response is indistinguishable from a lost write, and a retry that double-granted could not be undone — only offset by a further adjustment. A retry must therefore **reuse** the id rather than mint a new one (the contract `randomClientId` states). The key is the dedupe key for the ledger row *and* the chat card, enforced by the partial unique index `idx_point_transactions_dedupe` on `(chapter_id, client_message_id)`. Two consequences worth stating: a replay consumes **no** slot of the adjustments/hour limit and fires **none** of the side effects (no push notification, no second card) — it is a no-op that returns the original; and **dashboard adjustments send no key and are not deduplicated**, which is deliberate, because two identical grants made on purpose are two legitimate ledger rows. Scoping is per chapter, so one chapter's key can never resolve to another's row.
- **Adjustment reasons are capped at 500 characters.** The reason is not only stored: it is interpolated into the points chat card posted to the channel, so an uncapped reason would write a chat message far larger than the chat send path itself permits.
- **No self-award:** An admin must not be able to move their own balance without a second party. Like the ceiling above, this binds the **ledger**, not one endpoint: every path where the same member both earns and authorises an award is required to refuse it. Enforcement is per-path, and every award path that has an approver now refuses it — the sub-bullets record each one.
  - `points:adjust` rejects requests where the target user matches the requesting user.
  - **Task confirmation** rejects a confirm whose task is assigned to the confirming member ([`tasks.md`](tasks.md) § Admin Confirmation). Confirming awards `point_reward` to the assignee, so without this a `tasks:manage` holder could assign themselves a task, mark it COMPLETED, and confirm it alone.
  - Event check-in and study accrual sit outside this rule: they award the acting member against measured state rather than an authorisation, so there is no approver to be a second party. Note this is a statement about shape, not a guarantee of strength — study points derive from measured session minutes, but check-in's geofence is enforced only when the event defines a `check_in_zone` and the rotating token is verified when supplied rather than required, so a zone-less event's check-in is bounded by its `point_value` and its time window rather than by measurement.
  - **Service-hour approval** rejects an approval whose entry was submitted by the approving member ([`service-hours.md`](service-hours.md) § Approval Workflow). Approving awards SERVICE points to the submitter, so without this a member holding `service:log` **and** `service:approve` — a bundle an officer routinely holds, and a service chair holds by definition — could log their own hours and approve them alone. The refusal does not depend on the chapter's `minutes_per_point` rate: a sub-rate entry that would approve with no ledger row is refused just the same, so who may authorise an award never changes when a settings dial moves.

## Leaderboard

- Chapter-scoped. Shows rank, member name, and total points.
- **Names are resolved client-side against the chapter roster**, not joined onto
  the leaderboard response: `GET /v1/points/leaderboard` aggregates
  `point_transactions` and returns `{ user_id, total }` only. The web dashboard
  resolves each row at render from the display roster, whose payload is owned by
  [`chat/README.md`](chat/README.md) — deliberately not the full member profile.
- A row whose `user_id` does not resolve renders the shared `Member <first six
  hex>` label (`memberFallbackLabel`, `packages/hooks/src/display-names.ts`)
  rather than a bare uuid or a blank cell. Two cases reach it: a member who has
  left the chapter (see *Edge Cases*), and one who has never set a display name
  — `users.display_name` is `NOT NULL DEFAULT ''`, so an empty string means "no
  name set" and counts as unresolved.
- The **audit list** is the exception and keeps the full `user_id` on an
  unresolved row: it is a record officers read ids out of, not a name slot.
- Rank is the member's position on the **whole** board for the selected window.
  Filtering the view — by name or by pasted user id — never renumbers it.
- Configurable time window: all-time, this semester, this month, or one
  specific archived semester by id (`semester_archive_id`, resolved against
  that archive's own `[start_date, end_date]` calendar-day range) — the
  archive selection overrides the enum window entirely. `GET /v1/points/me`,
  `GET /v1/points/leaderboard`, `GET /v1/points/members/:userId`, and
  `POST /v1/reports/points` all accept it; the web Points page's "Archived
  period" picker (backed by `useSemesters()`) drives the leaderboard and
  balance summary. The Reports page and mobile do not yet expose it (#1526).
- Visible to all members.
- Admins see the full transaction ledger for all members. Members see only their own transactions plus the leaderboard rankings.

## Chapter-wide transaction list (web dashboard Audit)

- `GET /v1/points/transactions` returns a **newest-first**, cursor-paginated slice of `point_transactions` for the active chapter. It backs the Points **Audit** tab in the web dashboard (filters for member, category, flagged state, and deep pagination).
- Requires `points:view_all` (same permission as viewing another member’s point summary on `GET /v1/points/members/:userId`).
- Query parameters (all optional unless noted):
  - `user_id` — restrict to one member’s rows.
  - `category` — one of `ATTENDANCE`, `ACADEMIC`, `SERVICE`, `FINE`, `MANUAL`, `STUDY`.
  - `flagged` — boolean filter; when true, returns only rows the anomaly rules marked for review. The exact string-to-boolean parsing rules (`true`/`false`/`1`/`0`) are an API-layer detail documented in the OpenAPI spec.
  - `before` — ISO8601 timestamp cursor; return transactions created **strictly before** this instant (older page).
  - `limit` — page size; default **50**, clamped to **1–200** inclusive on the server.
- Ordering and caps are implementation details of the list endpoint; the **append-only** and **immutability** rules in *Anti-Fraud* still apply to underlying rows.

## Edge Cases

- Negative balances are allowed. The system does not block fines even if the balance would go negative.
- If a member is removed from a chapter, their point history is preserved for audit purposes **and they keep their leaderboard row**. `getLeaderboard` aggregates `point_transactions` by chapter and does not join `members`, so removing someone does not silently move everyone ranked below them. They are no longer on the roster, so their row resolves no name and renders the `Member <first six hex>` label described under *Leaderboard*.
- Points awarded for study sessions and events cannot be manually reversed by the recipient; only admins can create offsetting transactions.

## Chat Integration

Points is dispatched from chat by the `/points grant|deduct @member <amount> for <reason>` slash command (gated on the `points` module). `grant` posts a `+amount` `MANUAL` adjustment, `deduct` a `−amount` `FINE`; both run through `POST /v1/points/adjust`, so every chat-originated change inherits the same anti-fraud rules above (reason required, no self-adjust, the adjustments/hour rate limit, anomaly flagging, append-only, and idempotency on `client_message_id`).

The resulting **`points` card** (`actor → recipient`, signed amount, reason) is **server-originated**: only `PointsService.adjustPoints` writes it, after the ledger row commits, and a client cannot post a `kind:"points"` card directly (it is rejected by the chat send path). This makes the card impossible to forge — it can exist only if a real transaction does. The card is append-only and carries no actions; corrections are new adjustments, never edits. The card post is best-effort: a failed post never rolls back the committed ledger row.

Full slash/renderer/anti-forgery mechanics: see [`integrations.md`](integrations.md) → *Slash command dispatch* and *Server-originated kinds*.
