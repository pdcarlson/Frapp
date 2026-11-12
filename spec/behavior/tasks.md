# Tasks

A lightweight task management system for chapter operations.

## Task Lifecycle

- Admins with `tasks:manage` permission create tasks with: title, description (optional), assignee (single member), due date, and optional point reward on completion.
- **Setting a due date never needs the year** (Paul, 2026-11-09, #3928). Almost every task is due in the next days or weeks, so a month and a day are enough and the year is filled in as the next time that date comes round, today included. A date further out, an annual chore set a year ahead, is still reachable on purpose, and a date picked outside the current year shows its year in the field so it can't be misread.
  - **Web** types it (`apps/web/components/tasks/due-date-field.tsx`, on the board's Add a task row and the chat composer's Task form): `Nov 14`, `11/14`, `Friday`, `tomorrow`, with a year only when one is meant (`Nov 14 2027`). `parseDateEntry` in `@repo/formatting` owns what is read. The field writes the held date out (#3937), `Today`, `Saturday`, `November 14`, `March 14, 2027`, by the rule of the shared web date field ([`components.md` § Time and date pickers](../ui/design-system/components.md#time-and-date-pickers)), so a click also opens a month to pick from.
  - **The `/task` command** reads its date with the same reader: whatever follows the `@member` is the date, or the date and then the points, so `/task "Sweep" @sam 11/14 5` and `… Nov 14 2027` work; `YYYY-MM-DD` still does ([`integrations.md`](chat/integrations.md)).
  - **Mobile's** New task sheet offers Today, Tomorrow, Friday (when it isn't one of those two) and Next week as chips, and the platform's date picker for any other day, which opens on the current year. Its field label shows the year for a date in another one. Mobile's task rows and cards still print a due date without its year ([#3420](https://github.com/pdcarlson/Frapp/issues/3420)).
- **A due date can carry a time of day** (Paul, 2026-11-10, #4003). It is optional: most chores are due by a day, and a task with no time behaves exactly as before. A time is stored as `tasks.due_at`, the exact moment, read in the creator's device zone (chapters keep no zone of their own), beside `due_date`, which stays the calendar day the creator saw so every reader that groups by day keeps working. The API refuses a `due_at` more than a zone's width away from `due_date`.
  - **Web** reads the time in the same due field, before or after the date, the way Todoist reads one: `Fri 5pm`, `11/14 9:30am`, `tomorrow noon`, `17:30`, or `5pm` alone for today (tomorrow once that time has passed). A time needs `am`/`pm`, a colon or `noon`, so a bare number is never one. The field shows it as `Friday · 5 PM`. `parseDateEntryWithTime` in `@repo/formatting` owns what is read; `/task` reads the same (`/task "Trash" @sam fri 9pm 5`).
  - **Mobile's** New task sheet has a quiet "Add a time" line under the due chips. Tapping it gives the task a time (5 PM, or the next hour on a task due today after 5) and shows the platform's time picker; a clear button takes it off. A time already past today is refused with a line saying so, since the task would be overdue as it was made.
  - Rows and cards name the time: "Due today at 5 PM", "Due Friday at 11:59 PM", and once it passes "Overdue by 40 minutes", "Overdue by 3 hours", then by the day. A finished task reads "Due Nov 14 at 5 PM". Within a day, timed tasks sort by time ahead of untimed ones, which are due by the end of the day.
- **A task can carry subtasks** (Paul, 2026-11-11, #4003): the steps of a chore, as a checklist inside the task, the way Apple Reminders, Todoist and Asana show a sub-task count. A step is a title and a done mark, nothing else: no assignee, due date or points of its own, since a chore with its own owner is its own task. At most 20 steps of up to 200 characters (`TASK_SUBTASKS_MAX`, `TASK_SUBTASK_TITLE_MAX_LENGTH` in `@repo/validation`), stored in `task_subtasks` in the order they were typed.
  - **Adding them.** The creator types steps when making the task: on web, under "Add subtasks" on the board's Add a task row and in the New task form; on mobile, the "Add a subtask" field under "Add a time", where Return adds the step and keeps the keyboard up. A half-typed step is sent with the task. An officer with `tasks:manage` can also add a step at the end of an unconfirmed task, or remove one, from the task's checklist: on web under the tile and in its edit form, on mobile in the task's sheet (#4296). If the steps fail to save, the task is still made and the failure is logged; the officer adds them again rather than retrying into a duplicate task.
  - **Checking them off.** The assignee, or an officer with `tasks:manage`, ticks a step done or back (`PATCH /v1/tasks/:id/subtasks/:subtaskId`). The box flips at once and goes back if the server refuses. Steps don't move a task's status: finishing every step doesn't complete the task, and completing the task doesn't tick its steps, because the assignee still says when the chore is done. Once a task is confirmed its points are paid and its steps are frozen; the API refuses any change.
  - **Where they show.** Web board tiles show "2 of 5" beside the due date, which opens the checklist under the tile; mobile rows add it to their status line ("Due today · 2 of 5") and the task's sheet lists the steps to tick. Chat task cards show "2 of 5 subtasks" to anyone who can read the live task.
- **An officer can edit a task after it is made** (Paul, 2026-11-11, #4296): its title, description, assignee, due date and time, and points, through `PATCH /v1/tasks/:id` (`tasks:manage`). Any of them, at any status, until the task is confirmed. A confirmed task's points were paid on it as it stood, so it is a record and the API refuses the edit, and a confirm that lands while an edit is in flight wins (the write is a compare-and-set on `points_awarded = false`). An omitted field stays as it is; `null` clears the description, the time (the task is then due by the end of its day) or the points.
  - **A new assignee starts the task over.** It goes back to To do, with no completion and no send-back, since the old assignee's progress isn't the new one's, and the new assignee gets the assignment push (none when the officer assigns it to themselves). The forms say so under Assignee before Save on a task already under way. This is also how a chapter whose only officer completed a task they assigned themselves gets out of it: nobody may confirm that one ([#1340](https://github.com/pdcarlson/Frapp/issues/1340)), but it can be handed to someone else.
  - **A new due date or time, or a new assignee, re-arms the reminders.** The due-soon and overdue claims in `scheduled_notification_dispatches` are keyed on `due_date`, so a timed task moved within its own day would otherwise never be reminded again; the edit deletes the task's claims, and the sweeps send each reminder once more for the new due.
  - **The chat card stays as posted.** Its assignment snapshot (title, assignee, due date, points) is the record of what was assigned; its live status line reads the task, and its Start and Mark done follow the task's assignee now, not the snapshot's (`viewerIsCardAssignee` in `packages/hooks/src/task-card.ts`).
  - **Web**: an officer's tile has an Edit icon beside Delete. It turns the tile into the + card's task form, opened on the task, the way Todoist's board turns a card into its editor: Save and Cancel, with the task's live checklist in place of the steps typed for a new task. Save sends only the fields that changed. **Mobile**: an officer's task sheet has Edit at the top right, which opens the New task sheet's fields on the task, titled Edit task, and its checklist adds and removes steps. Mobile's board shows only the viewer's own tasks, so an officer edits other members' tasks on web; mobile has no description field, on create or edit.
- Task statuses: TODO → IN_PROGRESS → COMPLETED. Tasks past their due date that are not COMPLETED are flagged as OVERDUE.
- **OVERDUE is derived, not stored.** `toDisplayStatus` synthesizes it on every read for a task whose stored status is TODO or IN_PROGRESS and whose `due_date` is before today (UTC), or, for a task with a time, whose `due_at` has passed (#4003). An optimistic write must therefore predict the *rendered* status, or an overdue row visibly flips back on the next refetch.
- **Read paths carry `stored_status` alongside `status`.** Because TODO+past-due and IN_PROGRESS+past-due both render as OVERDUE with `completed_at: null`, the rendered value alone cannot tell a client which transition is legal — and the assignee transition table (`VALID_ASSIGNEE_TRANSITIONS` in `apps/api/src/application/services/task.service.ts`) is checked against the *stored* status. So every read returns both: `status` (rendered, what to display and group by) and `stored_status` (persisted, what to compute the next action from). `POST /v1/tasks` returns the freshly created row and does **not** derive, so it carries no `stored_status`; the next read does. The field is additive — the server remains the only authority on whether a transition is accepted.

  Three rules follow for clients, and all three are load-bearing:

  1. **Badges and grouping read `status`; every action affordance reads `stored_status`.** Mixing the two on one row lets a task sit in the Overdue column offering an action its rendered status contradicts.
  2. **An optimistic write must patch *both*.** Patching only `status` leaves the affordance keyed to a stale value, so after a successful write the control does not change, the member acts again, and the second attempt is rejected — a failure reported for something that already worked.
  3. **A stored `OVERDUE` maps to the same affordance as `TODO`** (`VALID_ASSIGNEE_TRANSITIONS` accepts `OVERDUE → IN_PROGRESS`), and an *absent* `stored_status` — a client talking to a pre-#1051 server — is ambiguous only when `status` is `OVERDUE`, since derivation can produce no other value. Offer nothing in that one case rather than guessing.

## Assignee Actions

- The assignee can mark their task IN_PROGRESS (signals they are working on it) or COMPLETED (signals they are done).
- Marking a task COMPLETED does not immediately award points. An admin must **confirm** completion.
- **The assignee can take back their own completion until it is confirmed** (`COMPLETED → IN_PROGRESS`, clearing `completed_at`). A mis-tap or a second look shouldn't need an officer to reject it. The write is a compare-and-set on `status = COMPLETED` and `points_awarded = false` (`reopenCompletion` in the task repository), so a confirm that lands first wins and the take-back is refused: a task whose points were paid never goes back to in progress. Only the assignee: an admin moving someone else's completion back is a rejection, which notifies the assignee, and goes through the reject endpoint. The creator's "needs your confirmation" notification is not withdrawn; an officer who opens it finds the task in progress again. Each completion notifies again, so a member who toggles a task done and back repeatedly sends the creator a push each time; collapsing those is [#3654](https://github.com/pdcarlson/Frapp/issues/3654).

## Status words

Every surface names a task's state with the same words, from `TASK_STATUS_LABELS` and `taskStatusLabel` in `packages/hooks/src/task-card.ts`: **To do**, **In progress**, **Overdue**, **Waiting on an officer** (COMPLETED, not yet confirmed) and **Confirmed** (COMPLETED with `points_awarded`). A completion is never called "Done" on its own: the member's half is done, but the points aren't theirs until an officer confirms, and mobile saying "Done" where web said "Awaiting confirmation" read as two different states (UI audit 2026-11-06, P6.1). The controls use the shared verbs in `TASK_ACTION_LABELS`: Start, Mark done, Mark not done, Confirm, Reject.

On mobile's task board only the row's checkbox changes a task; a tap elsewhere on the row opens the task's detail sheet (description, due date, points, who assigned it). Completing offers Undo for a few seconds, and the checkbox unchecks while the completion is unconfirmed. Web's board offers Undo on the "Marked done" toast and Mark not done on the assignee's own waiting tile; confirmed tasks leave the Waiting on an officer column for a Confirmed list under the board, newest first, the latest few shown with the rest behind Show all. Mobile's board, being personal, keeps a waiting row until it is confirmed and a confirmed row for a week after confirmation.

## Admin Confirmation

- When a task is marked COMPLETED, its creator is notified (same "notify the creator, not every `tasks:manage` holder" rule the OVERDUE notification below uses) — unless the creator is the one who marked it complete, in which case there is nothing to tell them.
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
  anyone. Rejection only cycles it back to IN_PROGRESS. This is the accepted cost of the
  rule above: the alternative is a single-officer chapter where one member both earns and
  authorises every task award, which is the thing being prevented. The way out is the
  edit: the officer reassigns the task, which starts it over at To do for the new assignee
  (§ Task Lifecycle; resolved 2026-11-11, #4296, closing
  [#1340](https://github.com/pdcarlson/Frapp/issues/1340)).
- The admin can reject the completion (revert to IN_PROGRESS) with an optional comment, through the same compare-and-set as the assignee's take-back, so a reject racing a confirm can't leave a paid task in progress. Rejection
  is deliberately **not** subject to the rule above: it withholds points rather than awarding
  them, so there is no self-benefit to prevent.
  A rejection stamps `sent_back_at`, so Activity shows the task to its assignee as unread again
  ([`activity.md` § Unread](activity.md#unread)); the assignee's own take-back doesn't.

## Notifications

- Assignee is notified when a task is assigned to them, at creation or when an edit hands it to them.
- Assignee is notified 1 day before the due date if the task is not COMPLETED. A task due at a time is reminded about two hours ahead instead ("Due in 2 hours"), by a five-minute sweep, and flagged overdue within five minutes of its time; the daily sweep leaves timed tasks out. Both claim the same `DUE_SOON` / `OVERDUE` keys, so each still goes out once. The assignment push names the time in the assignee's zone ("From Paul · due Fri, Nov 14, 5 PM"), or in the creator's with its zone label when the assignee has reported none.
- Assignee and admin are both notified when a task becomes OVERDUE. The admin notified is the task's creator — the member who assigned it — not every `tasks:manage` holder.
- The task's creator is notified when the task is marked COMPLETED (unless they are the one who marked it, or have since left the chapter) — the same creator-not-fan-out rule as the OVERDUE notification above.
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

- **Slash command.** `/task "<title>" @assignee <due date> [points]` (gated on the `tasks`
  module) creates and assigns a task, mirroring the existing dashboard create. It is a *heavy*
  command: the client posts an optimistic `loading` placeholder, calls `POST /v1/tasks` with the
  active `channel_id` + `client_message_id`, and the server posts the rich card after the row
  commits. `tasks:manage` is re-checked server-side and the assignee must be a chapter member.
- **Assignment card.** The posted `kind="task"` message is an immutable creation-time snapshot
  (`assigner → assignee`, title, due date, point reward). It is server-originated — a client
  cannot forge it (see `integrations.md` → *Server-originated kinds*).
- **Live status + inline actions.** The card reads the task's *live* status back through the task
  query (so OVERDUE and lifecycle changes render without mutating the chat row) and carries the
  same lifecycle controls as the dashboard: the assignee can Start / Mark done and a
  `tasks:manage` admin can Confirm / Reject. Actions call the existing task REST endpoints
  (`PATCH /v1/tasks/:id/status`, `POST /v1/tasks/:id/confirm`, `POST /v1/tasks/:id/reject`) with
  optimistic cache updates; the server stays the trust boundary. The optimism itself lives in the
  shared hooks (`packages/hooks/src/use-tasks.ts`), not in the card — so the card, the dashboard
  board, and any later surface get one behaviour rather than a copy each.

Status changes are not broadcast on the chat channel, so a non-acting viewer sees a card's status
update on their next task-query refetch rather than instantly. Only the assignee and a
`tasks:manage` holder can read a task (`GET /v1/tasks/:id` refuses anyone else, as the list returns a
member only their own), so any other member's card shows the creation-time snapshot with no status
badge and no controls, and never asks for the task. Web and mobile apply the same card rules from
`packages/hooks/src/task-card.ts`.
