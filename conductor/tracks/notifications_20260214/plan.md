# Implementation Plan: Notification System

## Phase 1: Schema & Domain Foundation
- [x] **Task:** Update `apps/api/src/infrastructure/database/schema.ts` with `push_tokens` and `notifications`.
- [x] **Task:** Create repository interfaces for tokens and notification history.
- [x] **Task:** Implement Drizzle repositories.
- [x] **Task:** Write unit tests for repositories.

## Phase 2: Notification Infrastructure (The Adapter)
- [x] **Task:** Define `INotificationProvider` interface.
- [x] **Task:** Implement `ExpoNotificationProvider` using the `expo-server-sdk`.
- [x] **Task:** Create `NotificationModule` to house these components.
- [x] **Task:** Write unit tests for the provider (mocking Expo API).

## Phase 3: Notification Application Service
- [x] **Task:** Implement `NotificationService`.
    - **Logic:** `sendPush(userId, title, body, data)`.
    - **Logic:** `saveNotification(userId, chapterId, title, body, data)`.
- [x] **Task:** Write unit tests for `NotificationService` (TDD).

## Phase 4: Interface Layer
- [x] **Task:** Create `NotificationController`.
    - **Endpoint:** `POST /tokens` (Register token).
    - **Endpoint:** `GET /` (Fetch history).
    - **Endpoint:** `PATCH /:id/read` (Mark read).
- [x] **Task:** Write E2E tests for token registration and delivery flow.

## Phase 5: Finalization
- [x] **Task:** Update Swagger documentation.
- [x] **Task:** Ensure >80% test coverage.
- [x] **Task:** Run final Build, Lint, and Type checks.
- [x] **Task:** Conductor - Final Track Verification
