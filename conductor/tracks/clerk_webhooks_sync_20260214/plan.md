# Implementation Plan: Clerk Webhooks & User Synchronization

## Phase 1: Core Architecture Expansion

- [ ] **Task:** Install dependencies: `class-validator`, `class-transformer`, `@nestjs/swagger`, `svix`.
- [ ] **Task:** Refactor `apps/api` folder structure to follow layered architecture (`interface`, `application`, `infrastructure`, `domain`).
- [ ] **Task:** Define the `chapters` table in Drizzle schema and push to database.
- [ ] **Task:** Create repository interfaces in the `domain` layer and Drizzle implementations in `infrastructure`.
- [ ] **Task:** Conductor - User Manual Verification 'Core Architecture'

## Phase 2: Webhook Endpoint & Security

- [ ] **Task:** Create `ClerkWebhookController` in the `interface` layer.
- [ ] **Task:** Implement `SVIX` signature verification guard or interceptor for webhook security.
- [ ] **Task:** Define DTOs for Clerk webhook events using `class-validator`.
- [ ] **Task:** Conductor - User Manual Verification 'Webhook Security'

## Phase 3: Synchronization Logic (The "Sync" Use Case)

- [ ] **Task:** Implement `UserSyncService` in the `application` layer to handle user events.
- [ ] **Task:** Write unit tests for `UserSyncService` mocking the repository layer.
- [ ] **Task:** Implement `user.created` event logic (Insert into DB).
- [ ] **Task:** Implement `user.updated` event logic (Upsert in DB).
- [ ] **Task:** Implement `user.deleted` event logic (Soft or hard delete).
- [ ] **Task:** Conductor - User Manual Verification 'Synchronization Logic'

## Phase 4: Observability & Documentation

- [ ] **Task:** Configure Swagger in `apps/api/main.ts` to document endpoints.
- [ ] **Task:** Add logging to webhook processing using the `Logger` service.
- [ ] **Task:** Prepare a `docker-compose` override or script for local webhook testing (e.g., using `svix-cli` or `ngrok`).
- [ ] **Task:** Conductor - User Manual Verification 'Observability'

## Phase 5: Final Verification & TDD Cleanup

- [ ] **Task:** Ensure >80% test coverage for all new modules.
- [ ] **Task:** Verify rate-limiting readiness (Throttler setup).
- [ ] **Task:** Run final build, lint, and type checks.
- [ ] **Task:** Conductor - Final Track Verification
