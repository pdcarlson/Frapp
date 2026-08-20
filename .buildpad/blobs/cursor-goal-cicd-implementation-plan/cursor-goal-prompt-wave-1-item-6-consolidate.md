Read `REFACTOR-PLAN.md`, section "Item 6 — getErrorMessage" ONLY (from PR #1095). Scope fence: the 9 implementations that section lists, their call sites, and promoting mobile's `api-error.ts` into `@repo/api-sdk`.

Do not add a test harness to `packages/api-sdk` as part of this — keep that package's scope exactly as it is today; only add the promoted function itself.

Consolidate into the `apps/web/lib/utils.ts` version. Flag for the reviewer (don't silently decide): roughly 7 call sites will change user-visible error copy as a result — this is intentional and correct (5 of the current copies use `instanceof Error` and silently swallow real server error messages), but call it out clearly in the PR so it gets read, not skimmed.

Create/append `REFACTOR-PROGRESS.md` listing every implementation and call site as an unchecked item; check off with a one-line note + test result as you go.

Definition of done: one shared implementation, old duplicates deleted, mobile's version lives in `@repo/api-sdk`, zero remaining duplicate implementations (paste the grep), typecheck passes, tests pass before and after, and the PR description explicitly lists which ~7 call sites now show different (more accurate) error copy. Open a draft PR if anything remains.