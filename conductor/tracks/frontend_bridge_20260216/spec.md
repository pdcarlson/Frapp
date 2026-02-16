# Specification: Frontend Bridge

## Objective
Enable type-safe, contract-driven development for Web and Mobile frontends by centralizing validation logic and automating SDK generation.

## Deliverables
1. `packages/validation`: Zod schemas for all domain entities.
2. `packages/api-sdk`: Generated TypeScript types from OpenAPI and a pre-configured API client.
3. Automated sync script between `apps/api` and `packages/api-sdk`.

## Technical Constraints
- Use `zod` for validation.
- Use `openapi-typescript` for SDK generation.
- Support both `x-chapter-id` and Clerk JWT headers in the SDK client.
- Maintain compatibility with existing NestJS DTOs during migration.
