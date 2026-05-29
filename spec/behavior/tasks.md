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
- The admin can reject the completion (revert to IN_PROGRESS) with an optional comment.

## Notifications

- Assignee is notified when a task is assigned to them.
- Assignee is notified 1 day before the due date if the task is not COMPLETED.
- Assignee and admin are both notified when a task becomes OVERDUE.
- Assignee is notified when completion is confirmed (and points are awarded).

## Visibility

- Tasks are chapter-scoped.
- The assignee sees their own tasks.
- All admins (users with `tasks:manage`) see all tasks.
- Members without `tasks:manage` only see tasks assigned to themselves.
