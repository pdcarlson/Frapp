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

## Admin Adjustments

- Only users with the `points:adjust` permission can manually add or remove points.
- Every manual adjustment requires a **reason** field (non-empty string). This is displayed in the transaction log alongside the adjustment.
- All admin point changes record the admin's user ID as `adjusted_by` in the transaction metadata. This creates an irrefutable audit trail.
- Categories for manual adjustments: MANUAL (reward) or FINE (penalty).

## Anti-Fraud

- **Append-only:** All transactions are immutable. No edits, no deletes. Corrections are new transactions with the inverse amount and a description referencing the original.
- **Rate limiting:** A single admin cannot create more than N point adjustments per hour (chapter-configurable, default 50). Exceeding the limit returns 429 Too Many Requests.
- **Anomaly flagging:** If a single transaction exceeds a configurable threshold (e.g. +/- 100 points, chapter-configurable), it is automatically flagged for review. Flagged transactions are visible in a dedicated "Audit" tab on the points ledger dashboard.
- **No self-adjustment:** An admin cannot award points to themselves. The API rejects `points:adjust` requests where the target user matches the requesting user.

## Leaderboard

- Chapter-scoped. Shows rank, member name, and total points.
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
- If a member is removed from a chapter, their point history is preserved for audit purposes but they no longer appear on the leaderboard.
- Points awarded for study sessions and events cannot be manually reversed by the recipient; only admins can create offsetting transactions.
