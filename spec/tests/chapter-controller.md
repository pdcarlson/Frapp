# Chapter Controller Test Specification

This document outlines the test coverage strategy and implementation details for the `ChapterController` in the `apps/api` workspace. It ensures the controller appropriately handles HTTP endpoints for chapter management and chapter asset (logo) operations.

## Test Suite Configuration

The test suite isolates the controller logic by employing the standard NestJS pattern of dependency injection mocking:

- **Mocked Provider**: The `ChapterService` is fully mocked using `jest.fn()` to prevent database operations and side effects during test execution.
- **Guard Overrides**:
  - `SupabaseAuthGuard`: Mocked to return `true`
  - `ChapterGuard`: Mocked to return `true`
  - `PermissionsGuard`: Mocked to return `true`
- **Interceptor Overrides**:
  - `AuthSyncInterceptor`: Bypassed via `.overrideInterceptor` returning `next.handle()`.

## Endpoint Coverage

The test suite provides comprehensive coverage for the following controller methods:

### 1. `create` (POST `/chapters`)
- Validates the method calls `ChapterService.create` with the correct extracted `@CurrentUser('id')` and `@Body()` DTO.
- Asserts that it successfully returns the generated chapter data.

### 2. `getCurrent` (GET `/chapters/current`)
- Validates the method calls `ChapterService.findById` using the `@CurrentChapterId()` extracted by the guard logic.
- Asserts the return payload matches the mocked chapter object.

### 3. `update` (PATCH `/chapters/current`)
- Verifies that `ChapterService.update` is correctly invoked with the current chapter ID and update DTO.
- Ensures the updated chapter structure is returned.

### 4. `requestLogoUploadUrl` (POST `/chapters/current/logo-url`)
- Confirms the extraction of `filename` and `content_type` from the body.
- Verifies the service method `requestLogoUploadUrl` is invoked correctly to generate signed upload URLs.

### 5. `confirmLogoUpload` (POST `/chapters/current/logo`)
- Ensures `ChapterService.confirmLogoUpload` is called with the provided `storage_path`.
- Validates the returned chapter payload reflects the updated branding options.

### 6. `deleteLogo` (DELETE `/chapters/current/logo`)
- Tests that `ChapterService.deleteLogo` is called to strip branding.
- Confirms that the returned object contains the stripped metadata.

## Maintenance Notes
- Tests explicitly bypass guard logic as guard functionality is tested within its own discrete test suites.
- Ensure that if new endpoints (e.g. adding onboarding assets) are added to `ChapterController`, an associated test block is authored mimicking the current structure.
