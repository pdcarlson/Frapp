**STATUS: DONE — merged via PR #1083 (Aug 20). Kept here as a record; see the "Code quality & architecture research" blob for what shipped vs what's still open (Wave 0D, new prompt on canvas).**

Our full Buildpad research canvas is committed in this repo under `.buildpad/` (blobs/, documents/, notes/). Before starting, find and read the document titled "Claude Code prompt: code quality/duplication audit" (contains the full audit findings, not just the prompt) and "Master execution plan: docs, code, and CI/CD overhaul" under `.buildpad/`. Use `rg -l` if filenames don't match titles exactly.

This phase stays supervised, not handed to an autonomous agent later, because the highest-risk piece here (the Supabase repository layer) has zero test coverage today. Go carefully, and pause for me before anything touching the repositories.

1. **Wire the generated Supabase Database type properly into the client** so the `as never` casts at the write boundary (168 Record<string, unknown> annotations, 83 as never casts, mostly in infrastructure/supabase/repositories/) disappear. The pattern: parameterize repository methods with `TablesInsert<T>` / `TablesUpdate<T>` generics from the generated database.types.ts, and make sure `createClient<Database>(...)` actually has the generated type passed in everywhere — the audit found this is likely just missing/misaligned, not a deep design problem. Before touching all 33 repositories, do 2-3 as a proof of concept and show me the diff and test results first. Do not attempt to build a generic base repository class here — the earlier research found that's not a good pattern for this; keep each repository's own query logic intact and only fix the typing.

2. **Build the chapter-scoped query-key factory shell in packages/hooks**, following the existing `taskKeys` factory pattern (use-tasks.ts) as the model. Make `chapterId` a mandatory first argument in the factory shape so a key missing the tenant scope becomes a type error. Don't migrate call sites yet — that's a later phase — just build the factory itself and verify it against a couple of existing hooks.

3. **Fix the three known live bugs, independent of anything else:**
   - `/polls` and `/backwork` spin forever for any member without the relevant `_view_all` permission — a disabled TanStack Query never resolves `isPending`. Needs an explicit enabled-but-false handling, not just a skin change.
   - The chat-card poll vote path (`actOnCard` → `recordMessageAction`) has no domain validation — no open/closed check, no option-index check, no single-choice enforcement — while the polls-page vote path validates correctly. Bring the chat-card path up to the same validation as the polls page.
   - `settings-page.tsx` shares one `isPending` across all 4 settings tabs, so toggling one module switch disables every other switch during the round-trip. Scope the pending state per-tab.

Show me each fix separately with tests passing before we move to the next.