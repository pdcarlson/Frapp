# Implementation Plan: Backwork (Academic Library)

## Phase 1: Schema & Domain Foundation
- [x] **Task:** Update `apps/api/src/infrastructure/database/schema.ts` with `backwork_courses`, `backwork_professors`, and `backwork_resources`.
- [x] **Task:** Create repository interfaces in `domain/repositories` for the new entities.
- [x] **Task:** Implement Drizzle repositories in `infrastructure/database/repositories`.
- [x] **Task:** Write unit tests for the new repositories.

## Phase 2: S3 Integration (Infrastructure Layer)
- [x] **Task:** Create `S3Service` in `infrastructure/storage` to handle presigned URL generation.
- [x] **Task:** Write unit tests for `S3Service` (mocking AWS SDK).

## Phase 3: Backwork Application Service (The Core Logic)
- [x] **Task:** Implement `BackworkService` in `application/services`.
    - **Logic:** Handle `upload-url` requests.
    - **Logic:** Handle resource creation with auto-vivification of courses/professors.
    - **Logic:** Handle duplicate detection.
- [x] **Task:** Write comprehensive unit tests for `BackworkService` (TDD).

## Phase 4: Interface Layer (Controllers & DTOs)
- [x] **Task:** Define Zod/Class-Validator DTOs for Backwork inputs.
- [x] **Task:** Implement `BackworkController` with the three required endpoints.
- [x] **Task:** Write E2E tests for the full Backwork flow.

## Phase 5: Finalization
- [x] **Task:** Update Swagger documentation.
- [x] **Task:** Ensure >80% test coverage.
- [x] **Task:** Run final Build, Lint, and Type checks.
- [x] **Task:** Conductor - Final Track Verification
