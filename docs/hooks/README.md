# Hooks

This directory documents hook-level conventions and test coverage for
`packages/hooks`.

## Testing

Hook tests live alongside source files in `packages/hooks/src` and use:

- Vitest (`packages/hooks/vitest.config.ts`)
- `@testing-library/react` `renderHook`
- `FrappClientProvider` + `QueryClientProvider` wrappers
- Query retries disabled in tests for deterministic assertions

### Current targeted hook specs

- `use-documents.spec.tsx` — mutation success/error behavior
- `use-roles.spec.tsx` — query success/error behavior for `GET /v1/roles`

### Run commands

- Single test: `npx vitest run --config packages/hooks/vitest.config.ts packages/hooks/src/use-roles.spec.tsx`
- Package tests: `npx vitest run` (from `packages/hooks`)
