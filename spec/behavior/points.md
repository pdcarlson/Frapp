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
- **Rate limiting:** A single admin cannot create more than N point adjustments per hour (chapter-configurable, default 50). Exceeding the limit returns 429 Too Many Requests.
- **Anomaly flagging:** If a single transaction exceeds a configurable threshold (e.g. +/- 100 points, chapter-configurable), it is automatically flagged for review. Flagged transactions are visible in a dedicated "Audit" tab on the points ledger dashboard.
- **Hard amount ceiling:** a single ledger write must fall within **±100,000 points**. This is a validation bound, not a flag — the request is rejected with 400 and no ledger row is written. Flagging above (which only marks a committed row for review) is the response to a *large* adjustment; this is the response to an implausible one. A legitimate correction larger than the ceiling is made as several adjustments, each with its own reason and audit row.
  - The ceiling applies to **every** award path, not just manual adjustment — attendance, tasks, study, and service accrual all write the same ledger, and several are reachable with a broader grant than `points:adjust` (submitting a service entry needs no special permission at all). Since the ledger is append-only and the correcting adjustment is itself bound by this ceiling, an uncapped write would not be fully reversible through the API. Each path is bound at its **request field**; the enforced list lives in `apps/api/src/interface/dtos/dto-constraint-coverage.spec.ts` rather than here, because an enumeration written in prose goes stale without failing anything.
  - **Study awards are bounded at their input, not yet at their total.** A study award is `intervals × points_per_interval`, and the interval count comes from measured session length rather than the request, so a long enough session can still produce a row above the ceiling even with the rate capped. Whether a marathon session should be clamped, refused, or given a category-specific ceiling is an open product decision — [#948](https://github.com/pdcarlson/Frapp/issues/948). Service accrual is not affected: its award is `floor(duration_minutes / minutes_per_point)`, so capping the submitted duration bounds the row.
- **Adjustment reasons are capped at 500 characters.** The reason is not only stored: it is interpolated into the points chat card posted to the channel, so an uncapped reason would write a chat message far larger than the chat send path itself permits.
- **No self-adjustment:** An admin cannot award points to themselves. The API rejects `points:adjust` requests where the target user matches the requesting user.

## Leaderboard

- Chapter-scoped. Shows rank, member name, and total points.
- **Names are resolved client-side against the chapter roster**, not joined onto
  the leaderboard response: `GET /v1/points/leaderboard` aggregates
  `point_transactions` and returns `{ user_id, total }` only. Surfaces read
  `GET /v1/members/roster` (id, display name and avatar — never the full member
  profile) and resolve each row at render.
- A row whose `user_id` does not resolve renders the shared `Member <first six
  hex>` label rather than a bare uuid or a blank cell. Two cases reach it: a
  member who has left the chapter (see *Edge Cases*), and one who has never set
  a display name — `users.display_name` is `NOT NULL DEFAULT ''`, so an empty
  string means "no name set" and counts as unresolved.
- Rank is the member's position on the **whole** board for the selected window.
  Filtering the view — by name or by pasted user id — never renumbers it.
- Configurable time window: all-time, this semester, this month.
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

Points is dispatched from chat by the `/points grant|deduct @member <amount> for <reason>` slash command (gated on the `points` module). `grant` posts a `+amount` `MANUAL` adjustment, `deduct` a `−amount` `FINE`; both run through `POST /v1/points/adjust`, so every chat-originated change inherits the same anti-fraud rules above (reason required, no self-adjust, the 50/hr rate limit, anomaly flagging, append-only).

The resulting **`points` card** (`actor → recipient`, signed amount, reason) is **server-originated**: only `PointsService.adjustPoints` writes it, after the ledger row commits, and a client cannot post a `kind:"points"` card directly (it is rejected by the chat send path). This makes the card impossible to forge — it can exist only if a real transaction does. The card is append-only and carries no actions; corrections are new adjustments, never edits. The card post is best-effort: a failed post never rolls back the committed ledger row.

Full slash/renderer/anti-forgery mechanics: see [`integrations.md`](integrations.md) → *Slash command dispatch* and *Server-originated kinds*.
