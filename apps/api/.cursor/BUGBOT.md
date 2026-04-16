# API review focus

- Prioritize security, input validation, SQL injection risks, and error handling.
- Protected endpoints should use the expected guard chain (`SupabaseAuthGuard`, `ChapterGuard`, and `PermissionsGuard` where applicable) plus explicit `@RequirePermissions()` declarations for protected reads and writes.
- DTO changes should preserve `class-validator` coverage and Swagger metadata so the API contract stays accurate.
- When controllers or DTOs change, the matching OpenAPI and SDK artifacts should be updated in the same PR.
