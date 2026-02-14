# Implementation Plan: Clerk Webhooks & User Synchronization

## Phase 1: Core Architecture Expansion [checkpoint: 7a5542f]

- [x] **Task:** Install dependencies: `class-validator`, `class-transformer`, `@nestjs/swagger`, `svix`. b36da23
- [x] **Task:** Refactor `apps/api` folder structure to follow layered architecture (`interface`, `application`, `infrastructure`, `domain`). 86855c1
- [x] **Task:** Define the `chapters` table in Drizzle schema and push to database. 5e81bc4
- [x] **Task:** Create repository interfaces in the `domain` layer and Drizzle implementations in `infrastructure`. 82bea5c
- [x] **Task:** Conductor - User Manual Verification 'Core Architecture' 7a5542f

## Phase 2: Webhook Endpoint & Security [checkpoint: 305ac73]

- [x] **Task:** Create `ClerkWebhookController` in the `interface` layer. a1aeaca
- [x] **Task:** Implement `SVIX` signature verification guard or interceptor for webhook security. a1aeaca
- [x] **Task:** Define DTOs for Clerk webhook events using `class-validator`. a1aeaca
- [x] **Task:** Conductor - User Manual Verification 'Webhook Security' 305ac73

## Phase 3: Synchronization Logic (The "Sync" Use Case)

- [x] **Task:** Implement `UserSyncService` in the `application` layer to handle user events. a4171d1
- [x] **Task:** Write unit tests for `UserSyncService` mocking the repository layer. a4171d1
- [x] **Task:** Implement `user.created` event logic (Insert into DB). a4171d1
- [x] **Task:** Implement `user.updated` event logic (Upsert in DB). a4171d1
- [x] **Task:** Implement `user.deleted` event logic (Soft or hard delete). a4171d1
- [x] **Task:** Conductor - User Manual Verification 'Synchronization Logic' 6569b6a

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
