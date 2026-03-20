# RBAC Controller Testing Specification

## Overview
This document outlines the testing strategy for the `RbacController` in the `apps/api` workspace. It ensures that the RBAC domain has sufficient coverage for its exposed endpoints.

## Endpoints Tested
1. **`list`**
   - Verifies the service is called with the correct `chapterId`.
   - Asserts the expected roles are returned.

2. **`catalog`**
   - Verifies the service's `getPermissionsCatalog` is invoked.
   - Asserts the expected permissions catalog is returned.

3. **`create`**
   - Asserts the endpoint successfully forwards the DTO to the service.
   - Verifies the endpoint is guarded by the `SystemPermissions.ROLES_MANAGE` permission requirement using metadata reflection.

4. **`update`**
   - Asserts the endpoint successfully forwards the DTO to the service.
   - Verifies the endpoint is guarded by the `SystemPermissions.ROLES_MANAGE` permission requirement using metadata reflection.

5. **`delete`**
   - Asserts the endpoint successfully delegates deletion to the service.
   - Verifies the endpoint is guarded by the `SystemPermissions.ROLES_MANAGE` permission requirement using metadata reflection.

6. **`transferPresidency`**
   - Verifies presidency transfer is successfully forwarded to the service using the current member's ID and target member's ID.

## Mocks and Stubs
- The `RbacService` is mocked entirely, replacing all methods with `jest.fn()`.
- Common application guards (`SupabaseAuthGuard`, `ChapterGuard`, `PermissionsGuard`) are overridden to always return `true` to isolate testing to the controller layer logic.
