# Tasks

A lightweight task management system for chapter operations.

## Task Lifecycle

- Admins with `tasks:manage` permission create tasks with: title, description (optional), assignee (single member), due date, and optional point reward on completion.
- Task statuses: TODO → IN_PROGRESS → COMPLETED. Tasks past their due date that are not COMPLETED are flagged as OVERDUE.

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
- The admin can reject the completion (revert to IN_PROGRESS) with an optional comment.

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
  optimistic cache updates; the server stays the trust boundary.

Status changes are not broadcast on the chat channel, so a non-acting viewer sees a card's status
update on their next task-query refetch rather than instantly.
