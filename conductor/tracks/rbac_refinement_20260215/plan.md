# Implementation Plan: RBAC Refinement

## Phase 1: RBAC Schema
- [x] **Task:** Update `apps/api/src/infrastructure/database/schema.ts` with `roles` table. 774ab01
- [x] **Task:** Create `IRbacRepository` interface and `DrizzleRbacRepository` implementation. 774ab01
- [x] **Task:** Write unit tests for the repository. 774ab01
- [x] **Task:** Create `IMemberRepository` interface and `DrizzleMemberRepository` implementation. dafdc26
- [x] **Task:** Write unit tests for Member repository. dafdc26

## Phase 2: RBAC Core Logic
- [x] **Task:** Implement `RbacService`. dafdc26
- [x] **Task:** Define `Permissions` enum/constants. 774ab01
- [x] **Task:** Write unit tests for `RbacService`.

## Phase 3: Permissions Guard & Decorator
- [x] **Task:** Create `@RequirePermissions(...permissions)` decorator.
- [x] **Task:** Implement `PermissionsGuard` using `Reflector` and `RbacService`.
- [x] **Task:** Write unit tests for the Guard.

## Phase 4: Integration & Interface
- [x] **Task:** Create `RbacController` for role management.
- [x] **Task:** Update `MemberController` (or existing Invite/Chapter controller) to allow role assignment.
- [x] **Task:** Apply `@RequirePermissions` to sensitive endpoints (e.g. `POST /financials/invoices`).
- [x] **Task:** Write E2E tests verifying access control (Success vs Forbidden).

## Phase 5: Finalization
- [x] **Task:** Update Swagger documentation.
- [x] **Task:** Ensure >80% test coverage.
- [x] **Task:** Run final Build, Lint, and Type checks.
- [x] **Task:** Conductor - Final Track Verification
