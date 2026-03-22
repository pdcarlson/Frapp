# Implementation behavior notes

Supplements [`spec/behavior.md`](../spec/behavior.md). This file maps **admin UI intent** to **API and storage** for features that are easy to get wrong across “template vs instance” rows.

## Recurring chapter events (web admin)

This repo does **not** implement Appwrite `housing_schedules` / `housing_assignments`. The analogous model is **`events`**: the recurring **parent** row holds `recurrence_rule`; each generated occurrence is a separate row with `parent_event_id` set and `recurrence_rule` null.

| UI label | Client | API | Rows written |
| -------- | ------ | --- | ------------ |
| This instance only | `EventEditorDialog` / `EventDetailSheet` | `PATCH /v1/events/:id` without `scope` (default) or `scope=this_instance` | Single `events` row for `:id`. |
| This and future | `EventEditorDialog` | `PATCH /v1/events/:id` with `scope=this_and_future` | Parent row **and** every instance with `start_time >=` anchor (sorted by `start_time`). **Time** edits apply the same **start/end delta** to the parent (anchor index 0) and every row from the selected occurrence onward so the series stays aligned. |
| Entire series | `EventEditorDialog` | `PATCH /v1/events/:id` with `scope=entire_series` | Parent plus **all** child instances; `recurrence_rule` updates apply **only** to the parent. |
| Delete this instance | `EventDetailSheet` | `DELETE /v1/events/:id` (no query) | Single row. |
| Delete this and future | `EventDetailSheet` | `DELETE /v1/events/:id?scope=this_and_future` | Anchor instance, all later instances by `start_time`, and—when the anchor is the parent—the whole series (parent + all children) so no orphaned recurrence parent remains. |
| Delete entire series | `EventDetailSheet` | `DELETE /v1/events/:id?scope=entire_series` | All instances **then** parent (FK-safe order). |

**Cron / regeneration:** There is **no** background job that regenerates future `events` rows from the parent. “Silent revert next week” was the risk of editing **only** one instance while the parent (or other instances) still held old titles, points, or times. Scoped updates address that by writing the **set of rows** that share the series.

### Already correct (no code change required)

- **One-time events:** `PATCH` / `DELETE` behave as before (single row).
- **Event creation with recurrence:** `EventService.create` still generates instances once; no scheduler re-materializes them.
- **Tasks:** `TaskService` has no recurring series; no `housing_*` paths exist in this codebase.
