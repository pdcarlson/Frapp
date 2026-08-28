# Tasks

A lightweight task management system for chapter operations.

## Task Lifecycle

- Admins with `tasks:manage` permission create tasks with: title, description (optional), assignee (single member), due date, and optional point reward on completion.
- Task statuses: TODO → IN_PROGRESS → COMPLETED. Tasks past their due date that are not COMPLETED are flagged as OVERDUE.
- **OVERDUE is derived, not stored.** `toDisplayStatus` synthesizes it on every read for a task whose stored status is TODO or IN_PROGRESS and whose `due_date` is before today (UTC). An optimistic write must therefore predict the *rendered* status, or an overdue row visibly flips back on the next refetch.
- **Read paths carry `stored_status` alongside `status`.** Because TODO+past-due and IN_PROGRESS+past-due both render as OVERDUE with `completed_at: null`, the rendered value alone cannot tell a client which transition is legal — and the transition table below is checked against the *stored* status. So every read returns both: `status` (rendered, what to display and group by) and `stored_status` (persisted, what to compute the next action from). `POST /v1/tasks` returns the freshly created row and does **not** derive, so it carries no `stored_status`; the next read does. The field is additive — the server remains the only authority on whether a transition is accepted.

  Three rules follow for clients, and all three are load-bearing:

  1. **Badges and grouping read `status`; every action affordance reads `stored_status`.** Mixing the two on one row lets a task sit in the Overdue column offering an action its rendered status contradicts.
  2. **An optimistic write must patch *both*.** Patching only `status` leaves the affordance keyed to a stale value, so after a successful write the control does not change, the member acts again, and the second attempt is rejected — a failure reported for something that already worked.
  3. **A stored `OVERDUE` maps to the same affordance as `TODO`** (the table accepts `OVERDUE → IN_PROGRESS`), and an *absent* `stored_status` — a client talking to a pre-#1051 server — is ambiguous only when `status` is `OVERDUE`, since derivation can produce no other value. Offer nothing in that one case rather than guessing.

## Assignee Actions

- The assignee can mark their task IN_PROGRESS (signals they are working on it) or COMPLETED (signals they are done).
- Marking a task COMPLETED does not immediately award points. An admin must **confirm** completion.

## Admin Confirmation

- When an assignee marks a task COMPLETED, the admin is notified.
- The admin reviews and confirms completion. On confirmation:
  - If a point reward is attached, a point transaction (category: MANUAL, with task ID in metadata) is created for the assignee.
  - The `confirmed_at` timestamp is set.
- **Atomicity.** Setting `confirmed_at` / `points_awarded` and inserting the point transaction happen
  in a single database transaction (the `confirm_task_completion` RPC), consistent with the
  "Atomic Point Awarding" invariant in [`points.md`](points.md): if either write fails, neither
  persists. The transaction confirms only when the task is still COMPLETED and `points_awarded` is
  `false` (a compare-and-set), so concurrent confirmations cannot award points twice — at most one
  succeeds and the rest are rejected as already awarded.
- **No self-confirmation.** A member cannot confirm a task assigned to themselves, even holding
  `tasks:manage`. Confirmation writes `point_reward` to the assignee's ledger, so a self-confirm
  would move the confirmer's own balance with no second party — the same thing `points:adjust`
  refuses, and the "No self-award" rule in [`points.md`](points.md) binds the ledger rather than
  a single endpoint. The API returns 403; the check runs before the COMPLETED-status guard, so
  the refusal does not depend on the task's state. Clients hide the Confirm control on
  the viewer's own task rather than letting it 403 (`tasks-board.tsx`, chat `task-card.tsx`).
- **Consequence in a single-admin chapter.** Where the assignee is the chapter's only
  `tasks:manage` holder, a self-assigned task with a point reward cannot be confirmed by
  anyone, and there is no reassignment endpoint — so it stays COMPLETED with
  `points_awarded: false` until another admin exists or the task is deleted. Rejection only
  cycles it back to IN_PROGRESS. This is the accepted cost of the rule above: the
  alternative is a single-officer chapter where one member both earns and authorises every
  task award, which is the thing being prevented. Tracked as an open question in
  [#1340](https://github.com/pdcarlson/Frapp/issues/1340).
- The admin can reject the completion (revert to IN_PROGRESS) with an optional comment. Rejection
  is deliberately **not** subject to the rule above: it withholds points rather than awarding
  them, so there is no self-benefit to prevent.

## Notifications

- Assignee is notified when a task is assigned to them.
- Assignee is notified 1 day before the due date if the task is not COMPLETED.
- Assignee and admin are both notified when a task becomes OVERDUE. The admin notified is the task's creator — the member who assigned it — not every `tasks:manage` holder.
- The two due-date reminders above are sent by a daily scheduled sweep, each at most once per task: delivery is recorded in `scheduled_notification_dispatches`, so re-running a sweep, or running it on several API instances, cannot duplicate a reminder. A task that went overdue more than 7 days ago is not retro-notified.
- Assignee is notified when completion is confirmed (and points are awarded).

## Visibility

- Tasks are chapter-scoped.
- The assignee sees their own tasks.
- All admins (users with `tasks:manage`) see all tasks.
- Members without `tasks:manage` only see tasks assigned to themselves.

## Chat Integration

Tasks are surfaced inline in chat as a [chat integration](integrations.md) (slash command +
rich renderer + server-originated card).

- **Slash command.** `/task "<title>" @assignee <YYYY-MM-DD> [points]` (gated on the `tasks`
  module) creates and assigns a task, mirroring the existing dashboard create. It is a *heavy*
  command: the client posts an optimistic `loading` placeholder, calls `POST /v1/tasks` with the
  active `channel_id` + `client_message_id`, and the server posts the rich card after the row
  commits. `tasks:manage` is re-checked server-side and the assignee must be a chapter member.
- **Assignment card.** The posted `kind="task"` message is an immutable creation-time snapshot
  (`assigner → assignee`, title, due date, point reward). It is server-originated — a client
  cannot forge it (see `integrations.md` → *Server-originated kinds*).
- **Live status + inline actions.** The card reads the task's *live* status back through the task
  query (so OVERDUE and lifecycle changes render without mutating the chat row) and carries the
  same lifecycle controls as the dashboard: the assignee can mark IN_PROGRESS / COMPLETED and a
  `tasks:manage` admin can Confirm / Reject. Actions call the existing task REST endpoints
  (`PATCH /v1/tasks/:id/status`, `POST /v1/tasks/:id/confirm`, `POST /v1/tasks/:id/reject`) with
  optimistic cache updates; the server stays the trust boundary. The optimism itself lives in the
  shared hooks (`packages/hooks/src/use-tasks.ts`), not in the card — so the card, the dashboard
  board, and any later surface get one behaviour rather than a copy each.

Status changes are not broadcast on the chat channel, so a non-acting viewer sees a card's status
update on their next task-query refetch rather than instantly.
