
## Main changes

Replaced `console.log` with NestJS `Logger` in `apps/api/src/main.ts` to ensure standardized application bootstrap logs.

Also refactored `console.log` and `console.error` to use NestJS `Logger` in `apps/api/src/export-openapi.ts` for consistent code health and logging standardization across the API.
Removed hardcoded Stripe credential fallbacks in `apps/api/src/export-openapi.ts` to enforce environment variable provision for openapi export.

## Test Coverage
Added comprehensive unit tests for `NotificationController` in `apps/api/src/interface/controllers/notification.controller.spec.ts` to ensure stability of notification and user settings endpoints.
