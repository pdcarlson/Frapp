# Frapp PR review rubric

The automated reviewer (`.github/workflows/claude-review.yml`, ADR-14) reads this file on every PR.
It ports the security/quality focus that previously lived in `.coderabbit.yaml`. Keep it focused —
long rubrics dilute the rules that matter. The reviewer reads it together with
[`learnings.md`](learnings.md) (narrower, dated lessons from real PRs).

## Severity

- **Important** — would break behavior, leak data, bypass auth, corrupt state, or block a rollback.
- **Nit** — maintainability/correctness polish; worth fixing, not blocking. Cap inline Nits at ~5;
  mention the rest as a count in the summary.

**Important findings block merge** via the `claude-review-gate` required check; add the
`claude-review-override` label to bypass a false positive. Nits never block.

## apps/api (NestJS) — highest priority

- **Auth guard chain.** Protected endpoints must use `SupabaseAuthGuard → ChapterGuard →
  PermissionsGuard` where applicable, with explicit `@RequirePermissions(...)` on protected reads
  and writes. Flag missing or incomplete guard/permission coverage on any endpoint that touches
  chapter-scoped or user data.
- **Input validation.** Request bodies/params validated via `class-validator` DTOs. Flag
  unvalidated or over-permissive DTOs.
- **API contract.** Swagger/OpenAPI metadata present and accurate; flag drift between the
  implementation and `apps/api/openapi.json` / the generated `packages/api-sdk` types.
- General: authorization logic, sensitive-data exposure in responses/logs.

## supabase/migrations — treat every migration as production-impacting

- Flag: destructive SQL; **missing RLS on new `public` tables** (default-deny + explicit policies
  are the repo invariant); lock-heavy operations / downtime risk; missing rollback notes; and API
  contract incompatibility.

## apps/web (Next.js App Router)

- App Router server/client boundaries; browser exposure of sensitive data; accessibility; loading,
  empty, and error states; offline/degraded behavior.

## apps/mobile (Expo)

- iOS/Android behavior differences; Expo integration; AsyncStorage and notification-permission
  handling; effect cleanup and subscriptions; degraded/offline UX.

## packages/*

- Shared code reaches API, web, and mobile. Flag breaking exports, hidden coupling, or
  uncoordinated downstream changes.

## .github/workflows

- Treat as release infrastructure: secret exposure, minimal `permissions:`, production-branch
  conditions, `workflow_run` conclusions, required-check names, and branch-protection doc drift.

## Do NOT flag (false positives to avoid)

- **Supabase query builder is parameterized.** `.from()/.select()/.insert()/.update()/.rpc()` calls
  are not SQL injection. Only flag SQLi when raw or string-interpolated SQL is actually constructed.
- **Anything CI already enforces:** ESLint/Prettier, TypeScript types, `check-docs-impact`,
  `check:migration-safety`, `check:api-contract`, the PGlite RLS-smoke job. Don't restate these.
- **Generated/vendored files:** `**/*.generated.*`, `dist/**`, `coverage/**`.
