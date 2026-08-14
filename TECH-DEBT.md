# TECH-DEBT.md

Running ledger of known tech debt in the Frapp → Signet rebuild. This file is the **durable record** of rot that has been *found*; [GitHub Issues](https://github.com/pdcarlson/Frapp/issues) remain the **tracker** for work that is actually *scheduled*. Log here first, open an issue when an item is ready to be worked, and cross-reference both ways.

**Protocol:** [`AGENTS.md` § Tech debt protocol](AGENTS.md#tech-debt-protocol-non-optional). In short — confirm code has real consumers before building on it, never silently work around orphaned or contradictory code, treat shipped code as ground truth for behavior while flagging the stale doc, delete superseded code in the cutover that replaces it, and end every task with a "debt spotted" note.

## How to use this file

- **Add an entry** the moment you find orphaned, superseded, or contradictory code — even if it's outside your task's scope. One entry per item.
- **Fields:** `id` (`TD-###`, monotonic — never reuse), `area` (matches the repo's `area:<x>` issue labels), `description` (what's wrong, with exact paths), `recommended action`, `status`, `first flagged` (date, `YYYY-MM-DD`).
- **Status:** `open` — still present. `resolved` — fixed; keep the row and note the PR/issue that closed it. Flip the status in the **same PR** that does the work; don't delete rows.
- **Don't duplicate** — grep this file before adding. If an existing entry grew, extend it rather than filing a second one.

---

### TD-001 — `useToggleReaction` targets the legacy reactions table

- **Area:** `web`
- **Description:** `useToggleReaction` in `packages/hooks/src/use-chat.ts` writes to the legacy `message_reactions` table, which has been superseded by `chat_message_actions`. The hook has zero consumers. The legacy path is still live on the API side too (`apps/api/src/infrastructure/supabase/repositories/supabase-message-reaction.repository.ts`, referenced from `apps/api/src/application/services/chat.service.ts`), so the old and new mechanisms are both shipping.
- **Recommended action:** Delete the hook. Sweep the API-side `message_reactions` repository and its `chat.service.ts` call path in the same change, and confirm nothing but the superseded code reads the table before dropping it.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-002 — ADR-03 describes an optimistic-update mechanism the code doesn't use

- **Area:** `docs`
- **Description:** ADR-03 in `spec/architecture/README.md:479` states that "TanStack Query `onMutate`/`onError` handles this" for the sent → confirmed transition. The shipped chat code does not use `onMutate`; it uses an explicit `upsertOptimistic` / `mergeServerRow` / `markFailed` trio. The decision and rationale are still correct — only the stated mechanism is stale.
- **Recommended action:** Correct the ADR-03 **Consequences** paragraph to describe the actual `upsertOptimistic`/`mergeServerRow`/`markFailed` flow. Leave the decision and rationale intact; this is a mechanism correction, not a re-decision.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-003 — Chat-card poll vote has no domain validation

- **Area:** `api`
- **Description:** `ChatService.recordMessageAction` (`apps/api/src/application/services/chat.service.ts:759`, exposed via `apps/api/src/interface/controllers/chat.controller.ts:337`) performs **zero** domain validation on a poll vote cast from a chat card: no open/closed check, no option-index bounds check, and no single-choice enforcement. The polls-page vote path validates all three. A client can therefore vote on a closed poll, submit an out-of-range option index, or multi-vote a single-choice poll by routing through the chat card.
- **Recommended action:** Extract the polls-page vote validation into a shared domain check and call it from `recordMessageAction`, so both surfaces enforce identical rules. Add service-level specs covering closed-poll, bad-index, and multi-vote-on-single-choice cases.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-004 — `/polls` spins forever for members without `polls:view_all`

- **Area:** `web`
- **Description:** In `apps/web/components/polls/polls-page.tsx`, the polls query is disabled for users lacking `polls:view_all`, but the render still gates on `pollsQuery.isPending`. A disabled TanStack query never leaves the pending state, so those members get an infinite spinner instead of the intended permission-denied surface.
- **Recommended action:** Gate on the permission **before** the pending check — render the denied/empty state when the query is disabled, and reserve the spinner for genuinely in-flight fetches. Audit the other disabled-query call sites for the same `isPending` shape.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-005 — `/backwork` has the same infinite-spinner shape plus a missing chapter-ID guard

- **Area:** `web`
- **Description:** `apps/web/components/backwork/backwork-page.tsx` repeats the TD-004 pattern (`resourcesQuery.isPending` gating a query that can be disabled, so the spinner never resolves) and additionally lacks a chapter-ID guard before firing its queries.
- **Recommended action:** Fix alongside TD-004 with the same permission-before-pending ordering, and add the missing chapter-ID guard so the page doesn't query with an absent chapter.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-006 — Settings tabs share one mutation's pending state

- **Area:** `web`
- **Description:** `apps/web/components/settings/settings-page.tsx` threads a single `patchOrgConfig.isPending` into all four settings tabs (module, field, workflow, and org panels — e.g. lines 591, 621, 634, 700). Because every switch shares one mutation's pending flag, toggling any one module switch disables every other switch on every tab until the request settles.
- **Recommended action:** Scope pending state per control — track the in-flight key (or use per-row mutation state) so only the toggled switch shows a busy/disabled state.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-007 — Task mutations are optimistic on the chat card but not on the board

- **Area:** `web`
- **Description:** `useUpdateTaskStatus` / `useConfirmTask` / `useRejectTask` are consumed by both `apps/web/components/chat/renderers/task-card.tsx:133+` and `apps/web/components/tasks/tasks-board.tsx:113-115`. The chat-card renderer wraps them with optimistic updates and permission gating; the tasks board calls the same hooks raw. Identical actions behave differently depending on which surface the user is looking at.
- **Recommended action:** Lift the optimistic-update and gating behavior into the hooks themselves so both surfaces inherit it, rather than duplicating the wrapper on the board. Decide the canonical behavior once and make the two surfaces agree.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-008 — 11 destructive confirmations use browser `window.confirm()`

- **Area:** `ux`
- **Description:** Eleven destructive actions across `apps/web` and `packages` confirm via the native `window.confirm()` dialog instead of a styled in-app dialog. These are unstyled, unbranded, un-themeable, block the main thread, and are inconsistent with every other modal in the product.
- **Recommended action:** Replace all 11 with a shared confirm-dialog component (AlertDialog-based), wired to the design system. Do it as one sweep so the pattern lands consistently, and add a lint rule or review check against reintroducing `window.confirm`.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-009 — Two toast systems vendored, one dead

- **Area:** `web`
- **Description:** `apps/web/components/ui/sonner.tsx` and `apps/web/components/ui/toaster.tsx` both ship. Only `toaster.tsx` is wired — it's mounted in `apps/web/app/layout.tsx:6`. `sonner.tsx` has zero importers anywhere in the repo.
- **Recommended action:** Delete `apps/web/components/ui/sonner.tsx` and drop the `sonner` dependency if nothing else pulls it in. Keep `toaster.tsx` + `hooks/use-toast.ts` as the single toast system.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-010 — Landing OG image still ships the old navy/royal-blue palette

- **Area:** `ux`
- **Description:** `apps/landing/app/opengraph-image.tsx` renders the pre-rebrand navy / royal-blue palette. This directly contradicts `spec/ui/brand-identity.md`, which specifies no royal blue anywhere. The OG image is the highest-visibility brand surface the product has — it's what renders in every link preview.
- **Recommended action:** Regenerate the OG image against the current brand tokens. Sequence after TD-011 so it's rebuilt once, against the Signet palette, rather than twice.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-011 — `brand-identity.md` is authoritative but specifies the pre-Signet direction

- **Area:** `docs`
- **Description:** `spec/ui/brand-identity.md` is the authoritative brand spec and is cited as ground truth by other docs and by agents doing UI work — but it locks in the old light-first bone/bronze/ink direction, which the Signet rebuild supersedes. Every agent that reads it for guidance currently gets pointed at the previous brand.
- **Recommended action:** Full rewrite for Signet. This is the root of the brand-doc cluster (TD-010, TD-012 both depend on it) — do it first, then cascade. Until it's rewritten, treat shipped Signet UI as ground truth over this file.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-012 — `assets.md` instructs the old lockup classes

- **Area:** `docs`
- **Description:** `spec/ui/assets.md` still tells implementers to use `text-navy` and other pre-rebrand classes for the lockup, so following the doc reproduces the old palette in new code.
- **Recommended action:** Update alongside TD-011 in the same pass, so the asset instructions and the brand spec land on the same Signet direction simultaneously.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-013 — `design-reference/README.md` points at paths that don't exist

- **Area:** `docs`
- **Description:** `docs/internal/design-reference/README.md` describes the bundle's contents under a `project/` subdirectory (`project/styles.css`, `project/shell.jsx`, `project/org-config.jsx`, `project/settings*.jsx`, `project/screenshots/`, `project/assets/`) — but no `project/` directory exists; those files live at the directory root. It also references `chats/chat1.md` and `BUNDLE_README.md`, neither of which is present. The README tells agents to read the chat transcript "when a design choice is ambiguous," so the missing file is a dead end at exactly the moment it's reached for.
- **Recommended action:** Strip the `project/` prefix throughout to match the real layout, and either restore `chats/chat1.md` + `BUNDLE_README.md` or delete the references to them. If the bundle is fully superseded by the Signet direction, delete the directory outright rather than fixing paths into a dead reference.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-014 — 27 mutation hooks in `packages/hooks` have zero consumers

- **Area:** `web`
- **Description:** 27 exported mutation hooks in `packages/hooks` are never called anywhere. The heaviest concentration is `use-chat.ts` (15 of its 17 mutation hooks are unconsumed); the rest are scattered across `use-polls.ts`, `use-chapters.ts`, `use-user.ts`, `use-backwork.ts`, `use-notifications.ts`, `use-invoices.ts`, and `use-billing.ts`. Because they're exported from the package index, they read as live API surface and invite new code to be built on paths nothing exercises.
- **Recommended action:** Resolve the `use-chat.ts` group per the chat-core extraction plan (they're intended consumers of that work, not dead weight). Delete the rest. Treat this as a single sweep so the package's exported surface matches what's actually live.
- **Status:** open
- **First flagged:** 2026-08-14

### TD-015 — Mobile never registers a push token despite working server infra

- **Area:** `product`
- **Description:** `useRegisterPushToken` and `useRemovePushToken` (`packages/hooks/src/use-notifications.ts:53` and `:64`) have no consumers. The server-side push infrastructure exists and works, but no client ever registers a token — so push notifications cannot be delivered to any device. Unlike the rest of TD-014's orphans, this one is a **missing feature**, not dead code: the hooks are correct and simply unwired.
- **Recommended action:** Wire token registration into the mobile app lifecycle (register on login / permission grant, remove on logout). Do **not** fold this into the TD-014 deletion sweep — these two hooks should survive it. Verify end-to-end against a real device; Expo Go is required, so this can't be confirmed from a headless VM.
- **Status:** open
- **First flagged:** 2026-08-14
