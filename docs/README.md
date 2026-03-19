
## Main changes

Replaced `console.log` with NestJS `Logger` in `apps/api/src/main.ts` to ensure standardized application bootstrap logs.

Also refactored `console.log` and `console.error` to use NestJS `Logger` in `apps/api/src/export-openapi.ts` for consistent code health and logging standardization across the API.
