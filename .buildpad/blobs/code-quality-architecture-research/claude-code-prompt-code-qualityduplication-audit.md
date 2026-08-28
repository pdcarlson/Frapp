I want to improve our actual code quality — reusability, consistency, maintainability. Audit only, no fixes yet.

1. **Duplicate/near-duplicate logic.** Find functions or blocks across apps/web, apps/mobile, apps/api, and the shared packages that do essentially the same thing in slightly different ways (e.g. the same validation, formatting, permission check, or data-shaping logic re-implemented per-surface instead of shared). Name specific examples with file paths, not just a category count.

2. **Shared package usage consistency.** We have 13 packages under packages/ (api-sdk, chapter-theme, chat-core, theme, ui, validation, hooks, etc). For each, is it actually used consistently everywhere it applies, or do some apps bypass it and reimplement locally? Flag the worst offenders.

3. **Architectural consistency.** Do API modules follow one consistent structure/pattern, or has each module evolved its own shape? Same question for how web and mobile each handle data-fetching, mutations, and error states — is there one pattern or several competing ones?

4. **Type safety gaps.** Where does `any` or untyped/loosely-typed data show up, especially at boundaries (API responses, form data, DTOs)? Any duplicated type definitions that should be shared from one place.

5. **The worst 5-10 offenders.** Rank the most valuable consolidation targets — where fixing one thing removes the most duplication or prevents the most future inconsistency. Include rough size/effort per item.

6. Anything you noticed in the earlier docs audit that's relevant here (e.g. patterns tied to the recurring "archetypes" you identified) — connect the dots if there's overlap.

Report back with specifics — file paths, line counts, concrete examples — not general impressions.