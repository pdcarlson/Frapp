# Phase 2 Backend (Attendance + Points) — Full Audit

**Date:** 2026-02-26  
**Branch:** feature/api-events-points  
**Scope:** Events, Event Attendance, Points ledger — implementation, tests, spec compliance, and client/SDK readiness.

---

## 1. Executive Summary

Phase 2 backend delivers **Events**, **Event Attendance**, and **Points** APIs as specified in the plan and aligned with `spec/behavior.md` (§4 Points, §9 Events & Attendance) and `spec/architecture.md` (data model). Unit and e2e tests have been added; all tests pass. **Remaining gaps:** rate limit on `points/adjust`; attendance check-in still uses best-effort rollback rather than a single DB transaction.

---

## 2. API Surface (Phase 2 Routes)

All routes are under **API version 1** (`/v1/`). Auth: `Authorization: Bearer <supabase_jwt>`, `x-chapter-id: <uuid>` required unless noted.

| Method | Path                                      | Auth | Permission        | Description                      |
| ------ | ----------------------------------------- | ---- | ----------------- | -------------------------------- |
| GET    | `/v1/events`                              | Yes  | (member)          | List chapter events              |
| GET    | `/v1/events/:id`                          | Yes  | (member)          | Get event by id                  |
| POST   | `/v1/events`                              | Yes  | `events:create`   | Create event                     |
| PATCH  | `/v1/events/:id`                          | Yes  | `events:update`   | Update event                     |
| DELETE | `/v1/events/:id`                          | Yes  | `events:delete`   | Delete event                     |
| POST   | `/v1/events/:eventId/attendance/check-in` | Yes  | (member)          | Self check-in                    |
| GET    | `/v1/events/:eventId/attendance`          | Yes  | `events:update`   | List attendance for event        |
| PATCH  | `/v1/events/:eventId/attendance/:userId`  | Yes  | `events:update`   | Update attendance status (admin) |
| GET    | `/v1/points/me`                           | Yes  | (member)          | Current user point summary       |
| GET    | `/v1/points/leaderboard`                  | Yes  | (member)          | Chapter leaderboard              |
| GET    | `/v1/points/members/:userId`              | Yes  | `points:view_all` | Member point summary             |
| POST   | `/v1/points/adjust`                       | Yes  | `points:adjust`   | Manually adjust points           |

## 3. Implementation Summary

### 3.1 Domain Layer

- **Entities:** `Event`, `EventAttendance`, `PointTransaction` (status/category enums match DB).
- **Repositories:** `IEventRepository`, `IAttendanceRepository`, `IPointTransactionRepository` with Supabase implementations.
- **Exports:** `domain/entities/index.ts`, `domain/repositories/index.ts` export Phase 2 types.

### 3.2 Application Layer

- **EventService:** findById, findByChapter, create (date validation), update (date validation), delete. Chapter-scoped.
- **AttendanceService:**
  - `checkIn(eventId, userId, chapterId)`: Validates event, time window (start_time ≤ now ≤ end_time + 15 minute grace period), role-target eligibility (when `required_role_ids` is set), and no duplicate (event_id, user_id). Creates `event_attendance` (PRESENT) then `point_transactions` (ATTENDANCE). On point failure, best-effort rollback (delete newly-created attendance row).
  - `getAttendance(eventId, chapterId)`: Returns all attendance for event (event must exist in chapter).
  - `updateStatus(eventId, userId, chapterId, status, excuseReason, markedBy)`: Admin only; updates status, excuse_reason, marked_by.
- **PointsService:**
  - Balance = SUM(amount) over transactions (no mutable balance column).
  - `getUserSummary(chapterId, userId, window?)`: window = `all` \| `semester` \| `month` (month = 1 calendar month back, semester = 6 months).
  - `getLeaderboard(chapterId, window?)`: Aggregates by user_id, sorted by total descending.
  - `adjustPoints(input)`: Non-empty reason required; self-adjustment forbidden; metadata includes `adjusted_by`, optional `flagged` (|amount| ≥ 100).

### 3.3 Interface Layer

- **DTOs:** Event (Create, Update), Attendance (CheckIn empty, UpdateAttendance status + excuse_reason), Points (AdjustPoints, PointsWindowQuery). All use class-validator and ApiProperty for Swagger.
- **Controllers:** EventController, AttendanceController (nested under events), PointsController. Guards: SupabaseAuthGuard, ChapterGuard, PermissionsGuard where required.
- **Validation package:** `@repo/validation` — `UpdateAttendanceSchema`, `PointsWindowSchema`, `AdjustPointsSchema` (Zod) and exported types.

### 3.4 Infrastructure

- **Supabase repositories:** `supabase-event.repository`, `supabase-attendance.repository`, `supabase-point-transaction.repository` implementing the domain interfaces.

### 3.5 Modules and App

- **EventModule**, **AttendanceModule**, **PointsModule** registered in **AppModule**. AttendanceModule provides EVENT_REPOSITORY and POINT_TRANSACTION_REPOSITORY for its service (no circular dependency; EventModule does not depend on Attendance/Points).

---

## 4. Spec Compliance

### 4.1 Points Ledger (§4 behavior.md)

| Requirement                                      | Status | Notes                                                                                             |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------- |
| Balance = SUM(amount), no mutable balance column | ✅     | Implemented.                                                                                      |
| Atomic point awarding on check-in                | ⚠️     | Attendance + point in sequence; best-effort rollback on point failure (no single DB transaction). |
| Admin adjustments: reason required               | ✅     | BadRequest if reason empty/whitespace.                                                            |
| adjusted_by in metadata                          | ✅     | Set on every adjust.                                                                              |
| Categories MANUAL, FINE for manual               | ✅     | DTO and service enforce.                                                                          |
| Append-only, no edit/delete                      | ✅     | Repositories only create; no update/delete on transactions.                                       |
| Rate limiting (e.g. 50/hour per admin)           | ❌     | Not implemented; spec says default 50/hour.                                                       |
| Anomaly flagging (e.g. ±100 points)              | ✅     | metadata.flagged when \|amount\| ≥ 100 (hardcoded threshold).                                     |
| No self-adjustment                               | ✅     | ForbiddenException if adminUserId === targetUserId.                                               |
| Leaderboard windows (all, semester, month)       | ✅     | Query param `window`; semester = 6 months, month = 1 month.                                       |

### 4.2 Events & Attendance (§9 behavior.md)

| Requirement                                               | Status | Notes                                                             |
| --------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| Check-in only during event time window                    | ✅     | start_time ≤ now ≤ end_time + grace.                              |
| Configurable grace period after end_time                  | ✅     | Implemented with a 15-minute default grace period.                |
| One attendance per (event, user), 409 on duplicate        | ✅     | Enforced.                                                         |
| Atomic attendance + points (single transaction)           | ⚠️     | Best-effort rollback via delete; no Supabase app-level transaction. |
| Role-targeted events: only matching roles can check in    | ✅     | required_role_ids enforced at check-in with 403 on mismatch.      |
| Admins view attendance; excuse workflow (EXCUSED, reason) | ✅     | GET/PATCH attendance gated by events:update.                      |
| Marking ABSENT does not reverse points                    | ✅     | No automatic point reversal; admin would use points/adjust.       |

### 4.3 Architecture (Data Model)

- **events**, **event_attendance**, **point_transactions** schemas match spec. Foreign keys and unique constraints (event_id, user_id) on event_attendance reflected in repository behavior.

---

## 5. Tests

### 5.1 Unit Tests

- **EventService:** 8 tests — findById, not found, list, create, invalid date range, update, invalid update times, delete.
- **AttendanceService:** 8 tests — checkIn success (with fake time), event not found, outside time window, duplicate check-in (wide-window event), getAttendance success/not found, updateStatus success/event not found/attendance not found.
- **PointsService:** 10 tests — getUserSummary (with data, empty, month window), getLeaderboard (sorted, empty), adjustPoints (success, metadata), empty reason, self-adjustment Forbidden, flagged for |amount| ≥ 100.

**Total:** 26 unit tests for Phase 2 services; 81 total API unit tests passing.

### 5.2 E2E Tests

- **test/attendance-points.e2e-spec.ts:** App created with `enableVersioning` and `ValidationPipe` (mirrors main.ts). Asserts that without auth, all Phase 2 routes return **401 Unauthorized** (route exists and guards run): events (GET list, GET :id), attendance (POST check-in, GET list, PATCH :userId), points (GET me, GET leaderboard, GET members/:userId, POST adjust).
- **test/app.e2e-spec.ts:** Health check (unchanged).

**Total:** 10 e2e tests (9 attendance/points/events + 1 health), all passing.

---

## 6. Client SDK and OpenAPI

### 6.1 Current State (Post-Audit)

- **OpenAPI:** Swagger is configured in `main.ts`. **`apps/api/src/export-openapi.ts`** has been added: it bootstraps the NestJS app with versioning, builds the same Swagger document, and writes **`apps/api/openapi.json`**. The script sets placeholder Supabase env vars if missing so it can run without real credentials. Phase 2 routes (events, attendance, points) are present in the generated spec.
- **@repo/api-sdk:** After running `npm run openapi:export -w apps/api` and `npm run generate -w packages/api-sdk`, **`packages/api-sdk/src/types.ts`** is regenerated from the OpenAPI spec and includes paths for `/v1/events`, `/v1/events/{eventId}/attendance/*`, and `/v1/points/*`. Client (`createFrappClient`) works with the new types.

### 6.2 Recommended Follow-Ups for Client/SDK

1. **Commit or CI:** Either commit `openapi.json` so SDK generation is reproducible, or run `openapi:export` in CI and cache the artifact before `api-sdk generate`.
2. **Contract CI:** Per architecture §10, CI should verify openapi.json is up to date and that `@repo/api-sdk` compiles. Confirm or add this.
3. **Docs/spec:** If CI or PR rules require it, update `apps/docs` and/or `spec/` for any new endpoints or behaviors (e.g. points/attendance flows).

---

## 7. Permissions and Validation

- **Permissions:** `points:adjust`, `points:view_all` in `domain/constants/permissions.ts`. Used in PointsController. Default roles (Treasurer, etc.) include these where appropriate. No new permission constant for “mark attendance”; PATCH attendance uses `members:remove`.
- **Zod:** `UpdateAttendanceSchema`, `PointsWindowSchema`, `AdjustPointsSchema` in `packages/validation/src/index.ts`; types exported for use by clients.

---

## 8. Gaps and Recommendations

| Priority | Gap                                                          | Recommendation                                                                                                 |
| -------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| High     | OpenAPI export script missing; SDK not regenerated           | Add `export-openapi.ts`, generate openapi.json, regenerate api-sdk types.                                      |
| Medium   | Rate limit on POST /v1/points/adjust (spec: 50/hour default) | Add throttling (e.g. per chapter + admin user) or document as follow-up.                                       |
| Medium   | Check-in not in single DB transaction                        | Document; consider Supabase RPC or server-side function for atomic insert of attendance + point row if needed. |
| Low      | Anomaly threshold configurable per chapter                   | Currently 100; could move to chapter settings.                                                                 |

---

## 9. File and Route Checklist

**Phase 2–specific files:**

- `domain/entities/event.entity.ts`, `event-attendance.entity.ts`, `point-transaction.entity.ts`
- `domain/repositories/event.repository.interface.ts`, `attendance.repository.interface.ts`, `point-transaction.repository.interface.ts`
- `application/services/event.service.ts`, `attendance.service.ts`, `points.service.ts`
- `application/services/event.service.spec.ts`, `attendance.service.spec.ts`, `points.service.spec.ts`
- `interface/controllers/event.controller.ts`, `attendance.controller.ts`, `points.controller.ts`
- `interface/dtos/event.dto.ts`, `attendance.dto.ts`, `points.dto.ts`
- `infrastructure/supabase/repositories/supabase-event.repository.ts`, `supabase-attendance.repository.ts`, `supabase-point-transaction.repository.ts`
- `modules/event/event.module.ts`, `attendance/attendance.module.ts`, `points/points.module.ts`
- `test/attendance-points.e2e-spec.ts`
- `packages/validation` — UpdateAttendanceSchema, PointsWindowSchema, AdjustPointsSchema

**App wiring:** EventModule, AttendanceModule, PointsModule imported in `app.module.ts`.

---

## 10. Conclusion

Phase 2 backend is **implemented and tested**. Unit and e2e tests are in place and passing. Behavior and architecture are largely met, with known gaps (rate limit, full DB transaction for check-in + points). **OpenAPI export and SDK:** The export script is in place; `openapi.json` is generated and `@repo/api-sdk` has been regenerated, so web and mobile can call Phase 2 endpoints with typed clients. Optional follow-ups: rate limiting on adjust, true DB transaction semantics (RPC/SQL function), and docs/CI contract checks.
