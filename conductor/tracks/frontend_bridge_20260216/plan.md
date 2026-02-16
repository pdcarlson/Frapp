# Implementation Plan: Frontend Bridge (Phase 6.1)

This track focuses on the infrastructure required to bridge the NestJS API with the upcoming Web and Mobile frontends.

## Phase 1: Shared Infrastructure [checkpoint: d47a1b3]

- [x] **Task:** Create `packages/validation` workspace for shared Zod schemas. d47a1b3
- [x] **Task:** Create `packages/api-sdk` workspace for generated types and client. d47a1b3
- [x] **Task:** Install `zod` and `openapi-typescript` dependencies. 17296

## Phase 2: API Export & SDK Generation [checkpoint: 17244]

- [x] **Task:** Add Swagger-to-JSON export script to `apps/api`. 8708
- [x] **Task:** Implement automated SDK generation in `packages/api-sdk`. 17244
- [x] **Task:** Create a base `FrappClient` in `packages/api-sdk`. 3140

## Phase 3: Zod Migration [checkpoint: 16024]

- [x] **Task:** Re-implement key API validation logic (Auth, Chapters, Members) in `packages/validation`. 16732
- [x] **Task:** Integrate `packages/validation` into `apps/api` (TDD: verify existing endpoints still work). 16024

## Phase 4: Verification [checkpoint: 31292]

- [x] **Task:** Run final Build, Lint, and Type checks. 27696
- [x] **Task:** Conductor - Final Track Verification 31292
