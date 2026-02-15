# Implementation Plan: Location Tracking & Study Hours

## Phase 1: Location & Study Schema
- [x] **Task:** Update `apps/api/src/infrastructure/database/schema.ts` with `study_geofences` and `study_sessions`.
- [x] **Task:** Create repository interfaces for Geofences and Sessions.
- [x] **Task:** Implement Drizzle repositories.
- [x] **Task:** Write unit tests for repositories.

## Phase 2: Geometric Utilities & Location Logic
- [x] **Task:** Implement a `GeoService` or utility for Point-in-Polygon validation.
- [x] **Task:** Write unit tests for the geometric logic (TDD).

## Phase 3: Study Application Service
- [x] **Task:** Implement `StudyService`.
    - **Logic:** `startSession(userId, geofenceId, lat, lng)`.
    - **Logic:** `processHeartbeat(userId, lat, lng)`.
    - **Logic:** `stopSession(userId)`.
    - **Logic:** Calculate points and call `PointsService.awardPoints`.
- [x] **Task:** Write comprehensive unit tests for `StudyService`.

## Phase 4: Interface Layer
- [x] **Task:** Create `StudyController` with REST endpoints.
- [x] **Task:** Define DTOs for start/heartbeat/geofence requests.
- [x] **Task:** Write E2E tests for the full Study Session lifecycle.

## Phase 5: Finalization
- [x] **Task:** Update Swagger documentation.
- [x] **Task:** Ensure >80% test coverage.
- [x] **Task:** Run final Build, Lint, and Type checks.
- [x] **Task:** Conductor - Final Track Verification
