Read `REFACTOR-PLAN.md`, section "Item 4 — chat shim imports" ONLY (from PR #1095). Scope fence: only the 21 files listed there importing shim paths, plus the 6 shim files themselves.

Rewrite every import to point at `@repo/chat-core` directly, then delete the 6 shim files.

Important: your zero-match proof must catch both alias-style (`@/...`) and relative-style (`../...`) imports of the shim paths — a prior draft of this plan only grepped the alias style and missed 8 relative imports, which would have shipped a "zero-match" PR with 2 files still silently importing the shims. Use a pattern (or two passes) that covers both import styles.

Create/append `REFACTOR-PROGRESS.md` listing every file as an unchecked item; check each off with a one-line note + test result as you go. After each file: typecheck + scoped test, don't advance until it passes, revert and mark BLOCKED after 3 failed attempts.

Definition of done: no file imports the shim paths under either style, all 6 shim files deleted, typecheck passes with the shims removed, tests pass before and after, paste both grep passes (alias and relative) into the PR showing zero matches. Open a draft PR if anything remains.