# Implementation Plan: House Points & Attendance

## Phase 1: Point & Event Schema
- [x] **Task:** Update `apps/api/src/infrastructure/database/schema.ts` with `point_transactions`, `events`, and `event_attendance`.
- [x] **Task:** Create repository interfaces for Points and Events.
- [x] **Task:** Implement Drizzle repositories.
- [x] **Task:** Write unit tests for repositories.

## Phase 2: Points Application Service
- [x] **Task:** Implement `PointsService`.
    - **Logic:** `awardPoints(userId, amount, category, description, metadata)`.
    - **Logic:** `getBalance(userId)`.
    - **Logic:** `getLeaderboard(chapterId)`.
- [x] **Task:** Write unit tests for `PointsService`.

## Phase 3: Event & Attendance Logic
- [x] **Task:** Implement `EventService` (CRUD for events).
- [x] **Task:** Implement `AttendanceService`.
    - **Logic:** `checkIn(userId, eventId)`. This must call `PointsService.awardPoints` atomically.
- [x] **Task:** Write unit tests for `AttendanceService` (TDD).

## Phase 4: Interface Layer
- [x] **Task:** Create `PointsController`.
- [x] **Task:** Create `EventController`.
- [x] **Task:** Write E2E tests for Check-in -> Point Award flow.

## Phase 5: Finalization
- [x] **Task:** Update Swagger documentation.
- [x] **Task:** Ensure >80% test coverage.
- [x] **Task:** Run final Build, Lint, and Type checks.
- [x] **Task:** Conductor - Final Track Verification
