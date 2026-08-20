# REFACTOR-PROGRESS.md

Scaffold only. One line per [`REFACTOR-PLAN.md`](REFACTOR-PLAN.md) item. Each Wave 1 goal checks off
its own line with a one-line note and its test result.

- [ ] 1. Date-formatting functions → `@repo/formatting`
- [ ] 2. MIME/content-type allowlists + `field-limits.ts` → `@repo/validation`
- [ ] 3. Delete the dead `@repo/ui` package and its dependency entries
- [ ] 4. Chat shim imports → `@repo/chat-core`; delete the 6 shim files
- [ ] 5. Query-key call sites → `createChapterQueryKeys`
- [ ] 6. `getErrorMessage` → `apps/web/lib/utils.ts`; mobile `api-error.ts` → `@repo/api-sdk`
- [ ] 7. `AnalyticsProvider` (web/mobile) → `@repo/hooks`
- [ ] 8. 5 stranded web hooks → `@repo/hooks`; wire mobile's module-gating
- [ ] 9. `apps/web/lib/subscription.ts` → `@repo/validation`
