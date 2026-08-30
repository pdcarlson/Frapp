# Engineering Principles

This document is the canonical statement of Frapp's engineering standard: first the stance to take when changing existing code, then the correctness rules every part of the codebase must honor. The correctness rules exist because several recurring defect classes — hardcoded identities, unguarded lookups, shared mutable seeds, NaN-prone inputs, missing empty states, non-semantic interactives — are easy to introduce and expensive to find later. Each rule below names the failure mode and the required correction. Treat the rules as a checklist when writing or reviewing code, and this document as the source of truth when a feature spec is ambiguous about correctness or about how far a change should go.

## Changing existing code

> "The last thing I want to do is stick a band-aid on top of something that's been the standard for a while but just doesn't make any sense. I'm more in favor of just ripping it all up, building it all over again, doing everything right." — the owner, on how this repo treats code it has outgrown.

- **When the shape is wrong, replace the shape.** Age is not evidence of correctness: a convention that has been the standard for a long time and no longer makes sense has earned removal, not deference. Patching around it is the failure mode, not the cautious option — it preserves a design nobody would choose today and leaves two things to understand instead of one. Before extending something, decide whether it should exist at all; when the honest answer is no, the change is a rebuild.
- **A larger diff is an acceptable price for a more correct system.** Prefer the change that leaves the codebase more correct, more consistent, and easier to work with, even when it costs substantially more work and touches substantially more files than the minimal fix. Diff size is a cost to weigh, never the deciding argument — "it would be a big change" is not a reason to ship the worse design.
- **The gates exist so that this is safe.** Typecheck, lint, the unit and contract suites, the required CI checks, the migration gates, and PR review are what make a large refactor trustworthy rather than reckless — that is what they are _for_, and declining to lean on them for their purpose wastes them. The corollary binds equally: a rebuild whose correctness the gates cannot demonstrate is one to break into verifiable pieces, never one to ship on the strength of having read it carefully.
- **Rebuild in one change, and delete what you replace.** The new thing lands with its call sites moved and the old thing gone, so the tree never carries both — `AGENTS.md` § Tech debt protocol states the same rule for cutovers, and it is the half of this stance that keeps a rebuild from becoming an addition. A rebuild that leaves the old path live has not reduced the debt; it has added a second copy plus a decision about which one to read.
- **Sequence the work so each step is independently valuable and revertable.** A rebuild too large for one reviewable change becomes an ordered series of them, each shippable on its own and each revertable without unpicking the others. Declare that sequence before starting. This rule licenses the deliberate rebuild, not the patch that quietly grew into one mid-PR.

## Identity and ownership

- **Actor identity always comes from the authenticated session.** Reactions, message actions, RSVPs, votes, audit rows — every write attributes the actor via the authenticated viewer (`viewer.id` on the client, or the server-side `req.user.id` / `auth.uid()` from the RLS context), never a hardcoded literal. A hardcoded reaction owner such as `"u_05"` is the canonical anti-pattern.
- **Filters keyed on "me" / "mine" / "assigned-to-me" actually filter** by `viewer.id` against the right field (`hostId`, `assigneeId`, `participants`, etc.). They never short-circuit to `return true`.

## Catalog lookups and defaults

- **Every lookup against a shared catalog (`ARCHETYPES`, `MODULE_CATALOG`, `ROLE_PACKS`, etc.) guards for a missing key with a defined fallback** — typically the `ifc` archetype, the always-on module set, or the archetype-default role pack. Direct subscript like `ARCHETYPES[org.archetype]` without a fallback is forbidden; every consumer goes through a helper (`getArchetype(key)`, `getRolePack(key)`, `getModuleCatalogEntry(key)`) whose fallback is documented in its JSDoc.
- **Components that render derived columns or rows from a configurable source pull from that source at render time.** Permission matrices, kanban columns, dashboard tabs, etc. derive their column/row key list from the active `pack.roleKeys` (or equivalent) — never a hardcoded local array. Adding a custom role or column must extend the rendered set without a code change.

## Seeds and shared state

- **Materializing a chapter's config from seed data deep-clones.** `[...CUSTOM_FIELDS_SEED]` and similar shallow spreads share object references with the seed, so per-chapter edits leak globally. Use a deep clone (`structuredClone`, or `JSON.parse(JSON.stringify(...))` for plain data) when copying `CUSTOM_FIELDS_SEED`, `ROLE_PACKS`, `WORKFLOWS_SEED`, or `VOCABULARY_DEFAULTS` into a chapter record. Seed exports are immutable references — freeze them at the leaf level (`Object.freeze`) or export `as const` — and any function that builds initial chapter config from a seed (`buildChapterConfigFromArchetype`, `seedCustomFields`, etc.) clones before mutating.
- **No `window.*` globals for application state.** Use ES module imports/exports. Shared packages must work without a DOM so they import cleanly into both Node.js (API) and Deno, and on both web and mobile.

## Input handling

- **Numeric input change handlers guard-parse.** Replace `+e.target.value` with a check that the parsed value is a finite number (`Number.isFinite(parsed)`) before calling the setter. On invalid intermediate state, preserve the previous value rather than storing `NaN`. This applies to every numeric form field — dues amounts (active / new-member / alumni), installment counts, grace days, late-fee cents, scholarship-pool cents, workflow thresholds, poll-option counts, and any slash-command argument that takes a number.
- **Validation schemas reject `NaN` and negative amounts** for any cents column (`active_amount_cents`, `late_fee_cents`, …). Use `z.number().int().nonnegative()` rather than `z.number()` so input that would have produced `NaN` is rejected at the boundary, on both the API and any edge surface that shares the schema.
- **Renderers that divide guard the denominator.** Progress bars, completion percentages, and similar widgets compute `denominator > 0 ? numerator / denominator : 0` before producing CSS or display values. A check-in progress bar of the form `checkedIds.size / attendees.length` with no zero guard is the canonical anti-pattern.
- **`find` / `first` lookups treat `undefined` as a real state.** Components reading `EVENTS_SEED.find(...)`, `messages.find(...)`, etc. render an explicit fallback UI (empty state, "no upcoming events", "no matching item") when the result is `undefined` rather than dereferencing properties on it. This covers jump-to-reply, mention previews, and pinned-message popovers where the target may have been deleted or not yet loaded.

## Empty states

- **Every list surface has an explicit empty state.** A channels list with no channels renders a "No channels yet" panel with the next-action CTA, not a blank pane. The same holds for the members directory, events list, tasks board, audit log, message threads ("Be the first to post"), DM lists ("Start a conversation"), and search results. The implementation explicitly checks `length === 0` (or `!active`) and renders the empty component before attempting to render headers, lists, or composers.

## Accessibility on interactive elements

- **Interactive controls use semantic elements.** `<button>` for actions, `<a>` (or the framework's `Link`) for navigation. Never `<div onClick>` for a clickable nav row, message action, settings tab, list item, or form control. Reaction chips are `<button>` with `aria-pressed` reflecting the viewer's vote state.
- **Soft-disabled items use `aria-disabled="true"` and `tabIndex={-1}`.** Hard-disabled items use the native `disabled` attribute on `<button>`. "Soon" / "coming-in-trial" items (e.g. in the Modules tab) are soft-disabled.
- **Root document layout sets `<html lang="en">`** (or the appropriate locale once internationalization is in scope).

## Aggregations in dashboards

- **Stacked/segmented bars use the outstanding portion of each segment, never the raw amount,** to avoid double-counting against an already-collected total. For dues: `outstanding = invoice.amount - (invoice.collected ?? 0)`, with a `Math.max(0, ...)` guard to clamp negative values. The same rule applies to points ledgers, task burn-downs, and hours rollups.

## Privacy in fixtures and seeds

- **No real identifiers in fixtures or seed data.** Test emails use `@example.com` / `@local.test`. Test names are generic and synthetic. The Greek-life chapter directory seed is the only exception — those are publicly listed chapter identities, not personal data.

## How to use this list

Read this document when you start a feature, when you write a verification checklist for a PR, and whenever you find yourself porting prototype or mock-up code one-to-one. Visual prototypes and design mock-ups routinely contain hardcoded ids, missing fallbacks, non-semantic interactives, and NaN-prone inputs because they were static. Do not reproduce those defects in the real implementation; this document is the canonical statement of the corrections.
